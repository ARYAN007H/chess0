/**
 * Texel-style eval parameter tuner (run with `npx tsx scripts/texel-tune.ts`).
 *
 * Minimizes MSE between sigmoid(eval/400) and game results over a corpus of
 * quiet self-play positions (scripts/gen-corpus.ts), via integer coordinate
 * descent with adaptive step sizes. The pawn TT and eval cache are cleared on
 * every candidate evaluation. 80/20 train/validation split guards overfit.
 *
 *   npx tsx scripts/texel-tune.ts [--corpus data/tuning-corpus.txt] [--sweeps 6]
 *
 * Writes data/tuned-params.json and prints a human-readable diff.
 */

import { newStartPosition, parseFen } from '../src/engine/position';
import { evalV3WhitePov, clearEvalCaches } from '../src/engine/evalV3';
import { evalV3Params, TABLES, applyEvalParams, resetEvalParams, type EvalV3ParamsShape } from '../src/engine/evalV3Params';
import { evalV2WhitePov } from '../src/engine/evalV2';
import { evalV2Params, TABLES2, applyEvalV2Params, resetEvalV2Params, type EvalV2ParamsShape } from '../src/engine/evalV2Params';

// Which eval to tune (v3 flagship by default). Abstracted so the descent loop
// below is engine-agnostic.
const EVAL = (() => {
  const i = process.argv.indexOf('--eval');
  const v = i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'v3';
  if (v !== 'v3' && v !== 'v2') throw new Error(`--eval must be v3|v2, got ${v}`);
  return v;
})();

const evalPos = EVAL === 'v3' ? evalV3WhitePov : evalV2WhitePov;
const paramsObj: Record<string, number> = EVAL === 'v3' ? evalV3Params : evalV2Params;
const tablesMap: Record<string, Int16Array> = EVAL === 'v3' ? TABLES : TABLES2;
type ParamsShape = typeof evalV3Params | typeof evalV2Params;

function applyForEngine(
  scalars?: Partial<Record<string, number>>,
  tables?: Partial<Record<string, number[]>>,
): void {
  if (EVAL === 'v3') applyEvalParams(scalars as never, tables);
  else applyEvalV2Params(scalars as never, tables);
}
function resetForEngine(): void {
  if (EVAL === 'v3') resetEvalParams();
  else resetEvalV2Params();
}
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (name: string, def: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
};
const CORPUS = (() => {
  const i = process.argv.indexOf('--corpus');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'data/tuning-corpus.txt';
})();
// Optional champion params: tuning starts FROM the champion (challenger =
// champion + deltas) so accepted improvements compound across cycles.
const BASE = (() => {
  const i = process.argv.indexOf('--base');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
})();
const MAX_SWEEPS = arg('sweeps', 6);
const OUT_PATH = EVAL === 'v3' ? 'data/tuned-params.json' : 'data/tuned-params-v2.json';

if (BASE) {
  const raw = JSON.parse(readFileSync(BASE, 'utf8')) as {
    scalars: Record<string, number>;
    tables: Record<string, number[]>;
  };
  applyForEngine(raw.scalars, raw.tables);
  if (EVAL === 'v3') clearEvalCaches();
  console.log(`tuner (${EVAL}): starting from champion params ${BASE}`);
}

// --- corpus ------------------------------------------------------------------

const raw = readFileSync(CORPUS, 'utf8').trim().split('\n');
const positions: { pos: ReturnType<typeof newStartPosition>; wdl: number }[] = [];
for (const line of raw) {
  const sp = line.lastIndexOf(' ');
  const fen = line.slice(0, sp);
  const wdl = Number(line.slice(sp + 1));
  if (!Number.isFinite(wdl)) continue;
  const pos = newStartPosition();
  try {
    parseFen(pos, fen);
  } catch {
    continue;
  }
  positions.push({ pos, wdl });
}
if (positions.length < 500) {
  console.error(`corpus too small: ${positions.length} positions`);
  process.exit(1);
}
const split = Math.floor(positions.length * 0.8);
const train = positions.slice(0, split);
const valid = positions.slice(split);
console.log(`corpus: ${positions.length} positions (train ${train.length}, valid ${valid.length})`);

// --- tunable inventory ---------------------------------------------------------

interface Tunable {
  kind: 'scalar' | 'table';
  name: string; // scalar key in evalV3Params, or table name
  index?: number; // table slot
  step0: number;
  min: number;
  max: number;
}

const SKIP_SCALARS = new Set([
  'tempo', 'ocbScale', 'mopupEdge', 'mopupClose', 'mopupMargin', 'mopupMaxPhase',
]);

const tunables: Tunable[] = [];
for (const k of Object.keys(paramsObj)) {
  if (SKIP_SCALARS.has(k)) continue;
  const def = paramsObj[k];
  tunables.push({ kind: 'scalar', name: k, step0: 4, min: def - 64, max: def + 64 });
}
for (const tName of Object.keys(tablesMap)) {
  for (let r = 1; r <= 6; r++) {
    const def = tablesMap[tName][r];
    tunables.push({ kind: 'table', name: tName, index: r, step0: 4, min: def - 64, max: def + 64 });
  }
}
console.log(`tunables: ${tunables.length}`);

// --- loss ------------------------------------------------------------------------

function lossOver(set: { pos: ReturnType<typeof newStartPosition>; wdl: number }[]): number {
  let sum = 0;
  for (const { pos, wdl } of set) {
    const e = evalPos(pos);
    // sigmoid(eval/400)
    const p = 1 / (1 + Math.pow(10, -e / 400));
    const d = p - wdl;
    sum += d * d;
  }
  return sum / set.length;
}

function trainLoss(): number {
  return lossOver(train);
}

function setScalar(name: string, v: number): void {
  paramsObj[name] = v;
}
function getScalar(name: string): number {
  return paramsObj[name];
}
function setTableValue(name: string, index: number, v: number): void {
  tablesMap[name][index] = v;
}
function getTableValue(name: string, index: number): number {
  return tablesMap[name][index];
}

let trials = 0;
function candidateLoss(): number {
  if (EVAL === 'v3') clearEvalCaches();
  trials++;
  return trainLoss();
}

// --- coordinate descent ------------------------------------------------------------

const startTrain = trainLoss();
const startValid = lossOver(valid);
console.log(`baseline: train MSE ${startTrain.toFixed(6)}  valid MSE ${startValid.toFixed(6)}`);

resetForEngine();
if (EVAL === 'v3') clearEvalCaches();

let best = trainLoss();
const improvedKeys = new Set<string>();

function snapshotParams(): { scalars: Record<string, number>; tables: Record<string, number[]> } {
  const scalars: Record<string, number> = {};
  for (const k of Object.keys(paramsObj)) scalars[k] = paramsObj[k];
  const tables: Record<string, number[]> = {};
  for (const k of Object.keys(tablesMap)) tables[k] = Array.from(tablesMap[k]);
  return { scalars, tables };
}
function restoreParams(s: { scalars: Record<string, number>; tables: Record<string, number[]> }): void {
  applyForEngine(s.scalars, s.tables);
  if (EVAL === 'v3') clearEvalCaches();
}

// Early stopping on VALIDATION loss: keep the best-valid config, abort after
// two consecutive sweeps that fail to improve it (train-only gains = overfit).
let bestValid = lossOver(valid);
let bestSnap = snapshotParams();
let validStagnation = 0;

for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
  let sweepImproved = 0;
  for (const t of tunables) {
    const key = t.kind === 'scalar' ? t.name : `${t.name}[${t.index}]`;
    const get = () => (t.kind === 'scalar' ? getScalar(t.name) : getTableValue(t.name, t.index!));
    const set = (v: number) => (t.kind === 'scalar' ? setScalar(t.name, v) : setTableValue(t.name, t.index!, v));

    // adaptive step: starts at step0, halves each sweep, floor 1
    const step = Math.max(1, Math.round(t.step0 / Math.pow(2, sweep)));

    const base = get();
    let lastGood = base;
    let anyImproved = false;

    for (const dir of [1, -1] as const) {
      set(lastGood); // resume from the best value found so far
      let v = lastGood + dir * step;
      while (true) {
        if (v < t.min || v > t.max) break;
        set(v);
        const l = candidateLoss();
        if (l < best - 1e-9) {
          best = l;
          lastGood = v;
          anyImproved = true;
          improvedKeys.add(key);
          v += dir * step; // keep walking in the winning direction
        } else {
          set(lastGood);
          break;
        }
      }
    }
    if (anyImproved) sweepImproved++;
  }

  const vLoss = lossOver(valid);
  if (vLoss < bestValid - 1e-9) {
    bestValid = vLoss;
    bestSnap = snapshotParams();
    validStagnation = 0;
  } else {
    validStagnation++;
  }
  console.log(
    `sweep ${sweep + 1}/${MAX_SWEEPS}: train MSE ${best.toFixed(6)}  valid MSE ${vLoss.toFixed(6)}  ` +
      `improved ${sweepImproved} params  trials ${trials}`,
  );
  if (sweepImproved === 0 || validStagnation >= 2) {
    console.log('stopping: ' + (sweepImproved === 0 ? 'no train improvement' : 'validation stagnation'));
    break;
  }
}

restoreParams(bestSnap);

const endTrain = trainLoss();
const endValid = lossOver(valid);
console.log(`\nresult: train ${startTrain.toFixed(6)} -> ${endTrain.toFixed(6)}   valid ${startValid.toFixed(6)} -> ${endValid.toFixed(6)}`);
console.log(`improved params: ${improvedKeys.size} of ${tunables.length}`);

// --- guard rails --------------------------------------------------------------------

{
  const sp = newStartPosition();
  const e = evalPos(sp);
  if (Math.abs(e) >= 60) console.warn(`WARNING: startpos eval ${e} outside ±60 (test npm test will fail)`);
  else console.log(`guard: startpos eval ${e} OK (±60)`);
}

// --- output --------------------------------------------------------------------------

const scalarsOut: Record<string, number> = {};
for (const k of Object.keys(paramsObj)) scalarsOut[k] = paramsObj[k];
const tablesOut: Record<string, number[]> = {};
for (const k of Object.keys(tablesMap)) tablesOut[k] = Array.from(tablesMap[k]);

mkdirSync('data', { recursive: true });
writeFileSync(
  OUT_PATH,
  JSON.stringify({ engine: EVAL, scalars: scalarsOut, tables: tablesOut }, null, 2) + '\n',
);
console.log(`\nwrote ${OUT_PATH}`);

// human-readable diff vs defaults
resetForEngine();
if (EVAL === 'v3') clearEvalCaches();
console.log('\nparam changes (default -> tuned):');
const tuned = JSON.parse(readFileSync(OUT_PATH, 'utf8')) as {
  scalars: Record<string, number>;
  tables: Record<string, number[]>;
};
for (const [k, v] of Object.entries(tuned.scalars)) {
  const d = paramsObj[k];
  if (d !== undefined && d !== v) console.log(`  ${k}: ${d} -> ${v}`);
}
for (const [k, arr] of Object.entries(tuned.tables)) {
  const def = tablesMap[k];
  if (!def || def.length !== arr.length) continue; // stale file from another engine
  const differs = arr.some((val, i) => def[i] !== val);
  if (differs) {
    console.log(`  ${k}: [${def.join(',')}] -> [${arr.join(',')}]`);
  }
}
resetForEngine();
if (EVAL === 'v3') clearEvalCaches();
