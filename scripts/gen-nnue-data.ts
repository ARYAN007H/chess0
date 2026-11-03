/**
 * NNUE training-data generator (run with `npx tsx scripts/gen-nnue-data.ts`).
 *
 * Plays v3 self-play games from book openings using the CURRENT champion
 * params, and for every quiet position writes one 36-byte training record:
 *
 *   byte 0:      stm (0 white, 1 black)
 *   bytes 1-32:  64 nibbles, square 0..63 (WHITE view, a1=0..h8=63);
 *                even s64 → low nibble, odd s64 → high nibble;
 *                nibble 0..5 = white P N B R Q K, 6..11 = black p..k, 15 = empty
 *   bytes 33-34: int16 LE label — search score in cp from STM's POV, clamped ±3200
 *   byte 35:     result from STM POV (0 loss, 1 draw, 2 win)
 *
 * The label is a depth-L search score using the tuned champion eval — the
 * search embeds tactics the static eval can't see, which is what lets the
 * trained net exceed its teacher. File layout: magic "NND1" | u32 count | records.
 *
 *   npx tsx scripts/gen-nnue-data.ts [--games 3000] [--depth 6] [--out data/nnue-shard-1.bin]
 *                                    [--params data/params-current.json] [--seed N]
 *
 * Spec mirrored by training/nnue_train.py — keep both in sync.
 */

import { newStartPosition, parseFen, makeMove } from '../src/engine/position';
import type { Position } from '../src/engine/position';
import { Engine } from '../src/engine/engine';
import { legalMoves, inCheckOf } from '../src/engine/movegen';
import { probeBookV3 } from '../src/engine/bookV3';
import { insufficientMaterial } from '../src/engine/eval';
import { searchPositionV3 } from '../src/engine/searchV3';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (name: string, def: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
};
const GAMES = Math.max(1, arg('games', 3000));
const DEPTH = Math.max(3, arg('depth', 6));
const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'data/nnue-data.bin';
})();
const PARAMS = (() => {
  const i = process.argv.indexOf('--params');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
})();
const MAX_PLIES = 160;
const LABEL_CLAMP = 3200;

if (PARAMS) {
  const { applyEvalParams, evalV3Params } = await import('../src/engine/evalV3Params');
  const { clearEvalCaches } = await import('../src/engine/evalV3');
  const raw = JSON.parse(readFileSync(PARAMS, 'utf8')) as {
    scalars: Record<string, number>;
    tables: Record<string, number[]>;
  };
  applyEvalParams(raw.scalars as Partial<Record<keyof typeof evalV3Params, number>>, raw.tables);
  clearEvalCaches();
  console.log(`nnue data generator: labeling with params from ${PARAMS}`);
}

const SEED = arg('seed', 0);
let seed = SEED > 0 ? (SEED & 0x7fffffff) | 1 : (Date.now() & 0x7fffffff) | 1;
const rnd = () => {
  seed ^= seed << 13; seed |= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed |= 0;
  return (seed >>> 0) / 4294967296;
};

function sampleOpening(plies: number): string[] {
  const pos = newStartPosition();
  const uci: string[] = [];
  for (let i = 0; i < plies; i++) {
    const candidates = probeBookV3(pos);
    if (candidates.length === 0) break;
    let total = 0;
    for (const c of candidates) total += c.weight;
    let roll = Math.random() * total;
    let picked = candidates[candidates.length - 1];
    for (const c of candidates) {
      roll -= c.weight;
      if (roll <= 0) { picked = c; break; }
    }
    uci.push(picked.uci);
    const eng = new Engine();
    eng.pos = pos;
    const m = eng.uciToMove(picked.uci);
    if (m === null) break;
    eng.applyMove(m);
  }
  return uci;
}

// --- binary writing -------------------------------------------------------------

const records: number[] = []; // flat byte stream

function writeRecord(pos: Position, labelCp: number, resultStmPov: number): void {
  records.push(pos.stm);
  for (let s64 = 0; s64 < 64; s64 += 2) {
    const sqEven = (s64 >> 3) << 4 | (s64 & 7);
    const sqOdd = ((s64 + 1) >> 3) << 4 | ((s64 + 1) & 7);
    const pEven = pos.board[sqEven];
    const pOdd = pos.board[sqOdd];
    const nib = (p: number): number => {
      if (p === 0) return 15;
      return p > 0 ? p - 1 : -p + 5;
    };
    records.push((nib(pEven) & 0xf) | ((nib(pOdd) & 0xf) << 4));
  }
  const label = Math.max(-LABEL_CLAMP, Math.min(LABEL_CLAMP, labelCp));
  records.push(label & 0xff, (label >> 8) & 0xff, resultStmPov & 0xff);
}



// --- play ------------------------------------------------------------------------

let positions = 0;
let skippedMate = 0;
const t0 = Date.now();

for (let g = 1; g <= GAMES; g++) {
  const pos = newStartPosition();
  for (const uci of sampleOpening(6)) {
    const eng = new Engine();
    eng.pos = pos;
    const m = eng.uciToMove(uci);
    if (m === null) break;
    eng.applyMove(m);
  }

  let resultWhite: number | null = null; // 1 white win, 0.5 draw, 0 black win
  const repKeys = new Map<string, number>();
  const pending: Array<{ pos: Position; label: number }> = [];

  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const moves = legalMoves(pos);
    if (moves.length === 0) {
      resultWhite = inCheckOf(pos, pos.stm) ? (pos.stm === 0 ? 0 : 1) : 0.5;
      break;
    }
    if (insufficientMaterial(pos)) { resultWhite = 0.5; break; }
    if (pos.halfmove >= 100) { resultWhite = 0.5; break; }

    const key = `${pos.hashLo},${pos.hashHi}`;
    const seen = (repKeys.get(key) ?? 0) + 1;
    repKeys.set(key, seen);
    if (seen >= 3) { resultWhite = 0.5; break; }

    // One search per position: the score labels the quiet position, the best
    // move drives the game (single source of truth for both).
    const quiet = ply >= 6 && !inCheckOf(pos, pos.stm);
    const r = searchPositionV3(pos, { depth: DEPTH });
    if (quiet) {
      if (r.scoreMate === undefined && r.scoreCp !== undefined) {
        pending.push({ pos: pos.clone(), label: r.scoreCp });
      } else {
        skippedMate++;
      }
    }

    const eng = new Engine();
    eng.pos = pos;
    const m = eng.uciToMove(r.bestMoveUci);
    if (m === null) break;
    makeMove(pos, m);
  }

  if (resultWhite === null) {
    const r = searchPositionV3(pos, { depth: DEPTH });
    const stmSign = pos.stm === 0 ? 1 : -1;
    const whiteCp = (r.scoreCp ?? 0) * stmSign;
    resultWhite = whiteCp > 350 ? 1 : whiteCp < -350 ? 0 : 0.5;
  }

  for (const { pos: p, label } of pending) {
    // result from STM POV: 2 win, 1 draw, 0 loss
    const stmWhite = p.stm === 0;
    const res = resultWhite === 0.5 ? 1 : (resultWhite === 1) === stmWhite ? 2 : 0;
    writeRecord(p, label, res);
    positions++;
  }

  if (g % 200 === 0) {
    const rate = (Date.now() - t0) / 1000 / g;
    console.log(`game ${g}/${GAMES}  positions=${positions}  (skipped mate-labeled: ${skippedMate})  ${rate.toFixed(2)}s/game  eta ${((GAMES - g) * rate / 60).toFixed(1)}min`);
  }
}

mkdirSync(dirname(OUT), { recursive: true });
const header = [0x4e, 0x44, 0x44, 0x31]; // "NDD1"
const count = positions;
const bytes = new Uint8Array(8 + records.length);
bytes.set(header, 0);
new DataView(bytes.buffer).setUint32(4, count, true);
bytes.set(records, 8);
writeFileSync(OUT, bytes);
console.log(`\nwrote ${count} positions -> ${OUT} (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
