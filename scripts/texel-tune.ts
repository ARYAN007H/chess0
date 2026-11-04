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

// Review P2 (PR #2): bounds anchor to FACTORY defaults, not the loaded
// champion. Champion-relative bounds ratchet ±64 outward per accept (a random
// walk across cycles); factory-anchored bounds keep every parameter within
// ±64 of a sane value forever. Snapshot before --base is applied below.
const FACTORY_SCALARS: Record<string, number> = { ...paramsObj };
const FACTORY_TABLES: Record<string, number[]> = Object.fromEntries(
  Object.keys(tablesMap).map((k) => [k, Array.from(tablesMap[k])]),
);

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
// Compact storage: a full Position drags ~120KB of history stacks, so a 12k-
// game corpus (~1.16M positions) would need >140GB if kept as objects. We
// parse each FEN once and keep only the fields evalV3/evalV2 read (~170B per
// position, ~200MB total), restoring a single scratch Position per eval.

const MAX_POSITIONS = arg('max-positions', 400000); // subsample cap (seeded)
const TIME_BUDGET_MIN = arg('time-budget', 90); // hard stop inside the job timeout
const TRAIN_CAP = Math.floor(MAX_POSITIONS * 0.8);
const VALID_CAP = MAX_POSITIONS - TRAIN_CAP;

const rawLines = readFileSync(CORPUS, 'utf8').trim().split('\n');

// Corpus formats:
//   legacy:  <fen> <wdl>
//   current: <fen> <wdl> g<gameId>
// The game id is what lets us split by game: positions in one game share the
// same result label, so a position-level split leaks validation information.
const gameByLine = new Int32Array(rawLines.length);
gameByLine.fill(-1);
const wdlByLine = new Float64Array(rawLines.length);
const validLineIndices: number[] = [];
let validLines = 0;
let linesWithGame = 0;
for (let i = 0; i < rawLines.length; i++) {
  const parts = rawLines[i].split(' ');
  let game = -1;
  const last = parts[parts.length - 1];
  if (last && /^g\d+$/.test(last)) {
    game = Number(last.slice(1));
    parts.pop();
  }
  const wdl = Number(parts.pop());
  if (!Number.isFinite(wdl)) continue;
  gameByLine[i] = game;
  wdlByLine[i] = wdl;
  validLineIndices.push(i);
  validLines++;
  if (game >= 0) linesWithGame++;
}
if (validLines === 0) {
  console.error(`corpus is empty: ${CORPUS}`);
  process.exit(1);
}
const grouped = linesWithGame === validLines;

// Seeded shuffle used for game assignment and subsampling. Keeps runs
// reproducible without depending on Math.random().
let splitSeed = 0x2545f491;
const rnd = () => {
  splitSeed ^= splitSeed << 13; splitSeed |= 0;
  splitSeed ^= splitSeed >>> 17;
  splitSeed ^= splitSeed << 5; splitSeed |= 0;
  return (splitSeed >>> 0) / 4294967296;
};
function shuffle<T>(a: T[]): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

let trainLines: number[] = [];
let validLinesIdx: number[] = [];
if (grouped) {
  const games = new Map<number, number[]>();
  for (let i = 0; i < rawLines.length; i++) {
    const g = gameByLine[i];
    if (g < 0) continue;
    const bucket = games.get(g);
    if (bucket) bucket.push(i);
    else games.set(g, [i]);
  }
  const keys = [...games.keys()];
  shuffle(keys);
  // Split by GAME count (80/20), not by position count: the point is to hold
  // out whole games, and every game must land entirely on one side.
  const targetTrainGames = Math.max(1, Math.min(keys.length - 1, Math.floor(keys.length * 0.8)));
  const trainGames = new Set<number>();
  for (const g of keys) {
    if (trainGames.size >= targetTrainGames) break;
    trainGames.add(g);
  }
  for (const [g, lines] of games) {
    const target = trainGames.has(g) ? trainLines : validLinesIdx;
    for (const li of lines) target.push(li);
  }
  console.log(
    `corpus split: ${games.size} games, ${trainGames.size} train / ${games.size - trainGames.size} valid ` +
      `(grouped by game id; ${trainLines.length} train positions / ${validLinesIdx.length} valid positions before cap)`,
  );
} else {
  // Legacy corpora were written game-by-game, so a contiguous split keeps
  // whole games together. Warn because we cannot prove the boundary.
  const ordered = validLineIndices;
  const splitAt = Math.floor(ordered.length * 0.8);
  trainLines = ordered.slice(0, splitAt);
  validLinesIdx = ordered.slice(splitAt);
  console.log(
    `corpus split: no game ids (legacy format) — using contiguous game-order split ` +
      `(${trainLines.length} train / ${validLinesIdx.length} valid positions before cap)`,
  );
}

// Cap inside each split. Shuffling after the grouped split preserves the
// train/valid separation while keeping the position sample unbiased.
shuffle(trainLines);
shuffle(validLinesIdx);
trainLines = trainLines.slice(0, TRAIN_CAP);
validLinesIdx = validLinesIdx.slice(0, VALID_CAP);

const N = trainLines.length + validLinesIdx.length;
const cBoard = new Int8Array(128 * N);
const cStm = new Int8Array(N);
const cMg = new Int32Array(N);
const cEg = new Int32Array(N);
const cPhase = new Int32Array(N);
const cPawnHashLo = new Int32Array(N);
const cPawnHashHi = new Int32Array(N);
const cHashLo = new Int32Array(N);
const cHashHi = new Int32Array(N);
const cKingW = new Int32Array(N);
const cKingB = new Int32Array(N);
const cNpmW = new Int32Array(N);
const cNpmB = new Int32Array(N);
const cWdl = new Float64Array(N);

const scratch = newStartPosition();
let kept = 0;
let split = 0;
function ingest(li: number): void {
  const parts = rawLines[li].split(' ');
  const last = parts[parts.length - 1];
  if (last && /^g\d+$/.test(last)) parts.pop();
  parts.pop(); // wdl
  try {
    parseFen(scratch, parts.join(' '));
  } catch {
    return;
  }
  cBoard.set(scratch.board, kept * 128);
  cStm[kept] = scratch.stm;
  cMg[kept] = scratch.mg;
  cEg[kept] = scratch.eg;
  cPhase[kept] = scratch.phase;
  cPawnHashLo[kept] = scratch.pawnHashLo;
  cPawnHashHi[kept] = scratch.pawnHashHi;
  cHashLo[kept] = scratch.hashLo;
  cHashHi[kept] = scratch.hashHi;
  cKingW[kept] = scratch.kingSq[0];
  cKingB[kept] = scratch.kingSq[1];
  cNpmW[kept] = scratch.npmCount[0];
  cNpmB[kept] = scratch.npmCount[1];
  cWdl[kept] = wdlByLine[li];
  kept++;
}
for (const li of trainLines) {
  ingest(li);
  split = kept;
}
for (const li of validLinesIdx) ingest(li);
if (kept < 500) {
  console.error(`corpus too small: ${kept} positions`);
  process.exit(1);
}
if (split === 0 || split === kept) {
  console.error(`corpus split produced no ${split === 0 ? 'train' : 'validation'} positions (${kept} kept)`);
  process.exit(1);
}
console.log(
  `corpus: ${kept} positions (train ${split}, valid ${kept - split}), ` +
    `source ${validLines} lines, grouped=${grouped}, compact ~${((kept * 173) / 1e6).toFixed(0)}MB`,
);

function restoreAt(i: number): void {
  scratch.board.set(cBoard.subarray(i * 128, i * 128 + 128));
  scratch.stm = cStm[i] as 0 | 1;
  scratch.mg = cMg[i];
  scratch.eg = cEg[i];
  scratch.phase = cPhase[i];
  scratch.pawnHashLo = cPawnHashLo[i];
  scratch.pawnHashHi = cPawnHashHi[i];
  scratch.hashLo = cHashLo[i];
  scratch.hashHi = cHashHi[i];
  scratch.kingSq[0] = cKingW[i];
  scratch.kingSq[1] = cKingB[i];
  scratch.npmCount[0] = cNpmW[i];
  scratch.npmCount[1] = cNpmB[i];
}

function lossOver(from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) {
    restoreAt(i);
    const e = evalPos(scratch);
    const p = 1 / (1 + Math.pow(10, -e / 400));
    const d = p - cWdl[i];
    sum += d * d;
  }
  return sum / (to - from);
}



// --- tunable inventory ---------------------------------------------------------

interface Tunable {
  kind: 'scalar' | 'table';
  name: string; // scalar key in paramsObj, or table name
  index?: number; // table slot
  step0: number;
  min: number;
  max: number;
}

const SKIP_SCALARS = new Set([
  'tempo', 'ocbScale', 'mopupEdge', 'mopupClose', 'mopupMargin', 'mopupMaxPhase',
]);

// Semantic bounds. Without these the ±64 displacement cap allows nonsense
// like baseB = -19 (the recovered v2 challenger) or negative passed-pawn
// bonuses. Terms whose names describe a bonus are non-negative; terms whose
// names describe a penalty are non-positive.
const NON_NEGATIVE = new Set([
  'bishopPairMg', 'bishopPairEg',
  'passedProtMg', 'passedProtEg', 'rookBehindPasserMg', 'rookBehindPasserEg',
  'passerKingEnemyW', 'passerKingOurW',
  'unstoppableBase', 'unstoppablePerRank',
  'knightOutpostMg', 'knightOutpostEg', 'knightOutpostCenterMg', 'knightOutpostCenterEg',
  'bishopOutpostMg', 'bishopOutpostEg', 'bishopOutpostCenterMg', 'bishopOutpostCenterEg',
  'rookOpenMg', 'rookOpenEg', 'rookSemiMg', 'rookSemiEg',
  'rook7thMg', 'rook7thEg', 'rookBatteryMg', 'rookBatteryEg',
  'mobNMg', 'mobNEg', 'mobBMg', 'mobBEg', 'mobRMg', 'mobREg', 'mobQMg', 'mobQEg',
  'baseN', 'baseB', 'baseR', 'baseQ',
  'pawnThreatMinorMg', 'pawnThreatMinorEg', 'pawnThreatMajorMg', 'pawnThreatMajorEg',
  'minorThreatRookMg', 'minorThreatRookEg', 'minorThreatQueenMg', 'minorThreatQueenEg',
  'shieldNear', 'shieldFar', 'shieldClose',
  'kingAttackNBase', 'kingAttackNPer', 'kingAttackBBase', 'kingAttackBPer',
  'kingAttackRBase', 'kingAttackRPer', 'kingAttackQBase', 'kingAttackQPer',
  'kingDangerCap',
]);
const NON_POSITIVE = new Set([
  'doubledMg', 'doubledEg', 'isolatedMg', 'isolatedEg', 'backwardMg', 'backwardEg',
  'shieldOpenFile', 'shieldOpenExtra', 'shieldOpen',
]);

function scalarBounds(name: string, def: number): { min: number; max: number } {
  // Anchor to the factory value (`def` is the current champion when --base is
  // used — see the FACTORY_* snapshot comment).
  const f = FACTORY_SCALARS[name] ?? def;
  let min = f - 64;
  let max = f + 64;
  if (NON_NEGATIVE.has(name)) min = 0;
  if (NON_POSITIVE.has(name)) max = 0;
  return { min, max };
}

const tunables: Tunable[] = [];
for (const k of Object.keys(paramsObj)) {
  if (SKIP_SCALARS.has(k)) continue;
  const def = paramsObj[k];
  const { min, max } = scalarBounds(k, def);
  tunables.push({ kind: 'scalar', name: k, step0: 4, min, max });
}
for (const tName of Object.keys(tablesMap)) {
  for (let r = 1; r <= 6; r++) {
    const def = tablesMap[tName][r];
    // Rank tables are bonuses; rank 0 and 7 are structurally zero.
    // Factory-anchored max (review P2) — same anti-ratchet as scalarBounds.
    const fMax = (FACTORY_TABLES[tName]?.[r] ?? def) + 64;
    tunables.push({ kind: 'table', name: tName, index: r, step0: 4, min: 0, max: fMax });
  }
}
console.log(`tunables: ${tunables.length}`);

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

// Rank tables are monotone bonuses (rank 1 <= ... <= rank 6). Each trial is
// clamped to the current neighbours, so any update preserves monotonicity for
// the rest of the sweep. Static per-rank bounds still apply.
function effectiveBounds(t: Tunable): { min: number; max: number } {
  let { min, max } = t;
  if (t.kind === 'table') {
    const r = t.index!;
    if (r > 1) min = Math.max(min, getTableValue(t.name, r - 1));
    if (r < 6) max = Math.min(max, getTableValue(t.name, r + 1));
    if (max < min) max = min;
  }
  return { min, max };
}

let trials = 0;
function candidateLoss(): number {
  if (EVAL === 'v3') clearEvalCaches();
  trials++;
  return lossOver(0, split);
}

// --- coordinate descent ------------------------------------------------------------

const startTrain = lossOver(0, split);
const startValid = lossOver(split, kept);
console.log(`baseline: train MSE ${startTrain.toFixed(6)}  valid MSE ${startValid.toFixed(6)}`);
if (BASE) console.log(`tuning continues from the loaded champion (${BASE}); factory defaults are only the final diff reference`);

// Intentionally do NOT reset here. Coordinate descent must continue from the
// champion loaded via --base; resetting would silently discard every accepted
// improvement and make the champion/challenger loop non-compounding.
let best = startTrain;
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
// The champion is the initial best-valid candidate, so a challenger that never
// beats it is written back unchanged.
let bestValid = startValid;
let bestSnap = snapshotParams();
let validStagnation = 0;

const budgetMs = TIME_BUDGET_MIN * 60_000;
const t0 = Date.now();
for (let sweep = 0; sweep < MAX_SWEEPS && Date.now() - t0 < budgetMs; sweep++) {
  let sweepImproved = 0;
  for (const t of tunables) {
    if (Date.now() - t0 > budgetMs) { console.log('time budget reached — stopping sweep early'); break; }
    const key = t.kind === 'scalar' ? t.name : `${t.name}[${t.index}]`;
    const get = () => (t.kind === 'scalar' ? getScalar(t.name) : getTableValue(t.name, t.index!));
    const set = (v: number) => (t.kind === 'scalar' ? setScalar(t.name, v) : setTableValue(t.name, t.index!, v));

    // adaptive step: starts at step0, halves each sweep, floor 1
    const step = Math.max(1, Math.round(t.step0 / Math.pow(2, sweep)));

    const base = get();
    let lastGood = base;
    let anyImproved = false;
    const { min, max } = effectiveBounds(t);

    for (const dir of [1, -1] as const) {
      set(lastGood); // resume from the best value found so far
      let v = lastGood + dir * step;
      while (true) {
        if (v < min || v > max) break;
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

  const vLoss = lossOver(split, kept);
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

const endTrain = lossOver(0, split);
const endValid = lossOver(split, kept);
console.log(`\nresult: train ${startTrain.toFixed(6)} -> ${endTrain.toFixed(6)}   valid ${startValid.toFixed(6)} -> ${endValid.toFixed(6)}`);
console.log(`improved params: ${improvedKeys.size} of ${tunables.length}`);

// --- guard rails --------------------------------------------------------------------

{
  const sp = newStartPosition();
  const e = evalPos(sp);
  // Review P1 (PR #2): this guard was warn-only and nothing ran `npm test`
  // before the publish step, so an accepted challenger could silently break
  // the suite on main. Fail the tuner instead; tune-session aborts on exit != 0.
  if (Math.abs(e) >= 60) {
    console.warn(`FATAL: startpos eval ${e} outside ±60 — refusing to write params (npm test would fail on main)`);
    process.exit(1);
  }
  console.log(`guard: startpos eval ${e} OK (±60)`);
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
