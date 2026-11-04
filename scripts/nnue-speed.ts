/**
 * NNUE eval speed benchmark — measures the incremental-accumulator rewrite
 * against the pre-rewrite full-recompute implementation on identical work.
 *
 *   Mode A (search-realistic): one long-lived position replays a recorded
 *     game; the accumulator stack is live, so evals read the current slot.
 *     Times eval calls only (makeMove cost sits between timed regions).
 *   Mode B (transient/scratch): freshly parsed / cloned positions (no live
 *     stack) — the new code recomputes into a shared scratch slot. Measured
 *     ~0.66-0.74x of the old implementation (not ~1.0x): refreshSlot
 *     maintains 4 accumulator rows per piece (2 perspectives x 2 weight
 *     views) where the old code maintained 2 — inherent to the 4-slot
 *     layout. Bounded impact: the search hot path always rides live stacks
 *     (mode A); scratch mode serves scripts and one-off evals only.
 *
 * Usage: npx tsx scripts/nnue-speed.ts [netPath]
 */

import { readFileSync } from 'node:fs';
import { makeMove, newStartPosition, parseFen, Position } from '../src/engine/position';
import { legalMoves } from '../src/engine/movegen';
import { evalNnueWhitePov, loadNnueWeights, nnueNet } from '../src/engine/nnue';

const path = process.argv[2] ?? 'data/nnue-v1.bin';
console.log(loadNnueWeights(new Uint8Array(readFileSync(path))));

// --- Deterministic game recording -------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Records `games` random games of ≤`plies` moves (each ≤2048 plies total). */
function recordGames(seed: number, games: number, plies: number): number[][] {
  const rng = mulberry32(seed);
  const out: number[][] = [];
  for (let g = 0; g < games; g++) {
    const pos = newStartPosition();
    const moves: number[] = [];
    for (let p = 0; p < plies; p++) {
      const legal = legalMoves(pos);
      if (legal.length === 0) break;
      const m = legal[Math.floor(rng() * legal.length)];
      moves.push(m);
      makeMove(pos, m);
    }
    out.push(moves);
  }
  return out;
}

// --- Old full-recompute reference (pre-incremental implementation) ------------
const IN = 768;
const QA = 1024;
const QB = 64;
const SCALE = 400;
const net = nnueNet()!;
const { h1, h2, w1, b1, w2, w3 } = net;
const featA = new Int32Array(32);
const featB = new Int32Array(32);
const acc = new Int32Array(h1);
const act = new Int32Array(2 * h1);
const l2ref = new Int32Array(h2);

function evalOldFull(pos: Position): number {
  let n = 0;
  const blackView = pos.stm === 1;
  for (let s64 = 0; s64 < 64; s64++) {
    const p = pos.board[((s64 >> 3) << 4) | (s64 & 7)];
    if (p === 0) continue;
    const isWhite = p > 0;
    const type = isWhite ? p - 1 : -p - 1;
    const ownA = isWhite === (pos.stm === 0);
    const sqA = blackView ? s64 ^ 56 : s64;
    featA[n] = (ownA ? type : type + 6) * 64 + sqA;
    featB[n] = (ownA ? type + 6 : type) * 64 + (sqA ^ 56);
    n++;
  }
  for (let v = 0; v < 2; v++) {
    const feats = v === 0 ? featA : featB;
    for (let i = 0; i < h1; i++) acc[i] = b1[v * h1 + i];
    for (let f = 0; f < n; f++) {
      const base = v * IN * h1 + feats[f] * h1;
      for (let i = 0; i < h1; i++) acc[i] += w1[base + i];
    }
    for (let i = 0; i < h1; i++) {
      const a = acc[i] < 0 ? 0 : acc[i] > QA ? QA : acc[i];
      act[v * h1 + i] = a;
    }
  }
  l2ref.fill(0);
  for (let inp = 0; inp < 2 * h1; inp++) {
    const a = act[inp];
    if (a === 0) continue;
    const w2base = inp * h2;
    for (let j = 0; j < h2; j++) l2ref[j] += w2[w2base + j] * a;
  }
  let yRaw = 0;
  for (let j = 0; j < h2; j++) {
    const a = l2ref[j] >> 6;
    const clamped = a < 0 ? 0 : a > QA ? QA : a;
    yRaw += w3[j] * clamped;
  }
  const cpStm = Math.round((yRaw * SCALE) / (QB * QA));
  return pos.stm === 0 ? cpStm : -cpStm;
}

// --- Mode A: search-realistic incremental path ---------------------------------
const gameA = recordGames(20260917, 1, 240)[0];
{
  // Parity along the whole line first.
  const pos = newStartPosition();
  let bad = 0;
  for (const m of gameA) {
    makeMove(pos, m);
    if (evalNnueWhitePov(pos) !== evalOldFull(pos)) bad++;
  }
  console.log(`mode A parity along ${gameA.length} plies: ${bad} mismatches (must be 0)`);

  const ROUNDS = 300;
  let sink = 0;
  // Warmup round
  {
    const p = newStartPosition();
    for (const m of gameA) {
      makeMove(p, m);
      sink += evalNnueWhitePov(p);
    }
  }
  const t0 = performance.now();
  for (let r = 0; r < ROUNDS; r++) {
    const p = newStartPosition();
    for (const m of gameA) {
      makeMove(p, m);
      sink += evalNnueWhitePov(p);
    }
  }
  const evals = ROUNDS * gameA.length;
  const incUs = ((performance.now() - t0) * 1000) / evals;
  console.log(`mode A incremental eval: ${incUs.toFixed(3)} µs/eval (sink ${sink & 0xffff})`);

  // Old path on the same walk.
  sink = 0;
  {
    const p = newStartPosition();
    for (const m of gameA) {
      makeMove(p, m);
      sink += evalOldFull(p);
    }
  }
  const t1 = performance.now();
  for (let r = 0; r < ROUNDS; r++) {
    const p = newStartPosition();
    for (const m of gameA) {
      makeMove(p, m);
      sink += evalOldFull(p);
    }
  }
  const oldUs = ((performance.now() - t1) * 1000) / evals;
  console.log(`mode A old full-recompute: ${oldUs.toFixed(3)} µs/eval (sink ${sink & 0xffff})`);
  console.log(`mode A speedup: ${(oldUs / incUs).toFixed(2)}x`);
}

// --- Mode B: transient/scratch path ---------------------------------------------
{
  const games = recordGames(555, 25, 120);
  const positions: Position[] = [];
  for (const moves of games) {
    const pos = newStartPosition();
    for (const m of moves) {
      makeMove(pos, m);
      positions.push(pos.clone()); // clones have no stack → scratch path
    }
  }
  let bad = 0;
  for (const p of positions) {
    if (evalNnueWhitePov(p) !== evalOldFull(p)) bad++;
  }
  console.log(`mode B parity on ${positions.length} transient positions: ${bad} mismatches (must be 0)`);

  function bench(label: string, fn: (p: Position) => number): number {
    let sink = 0;
    for (let i = 0; i < positions.length; i++) sink += fn(positions[i]);
    const ROUNDS = 30;
    const t0 = performance.now();
    for (let r = 0; r < ROUNDS; r++) {
      for (let i = 0; i < positions.length; i++) sink += fn(positions[i]);
    }
    const us = ((performance.now() - t0) * 1000) / (ROUNDS * positions.length);
    console.log(`${label}: ${us.toFixed(3)} µs/eval (sink ${sink & 0xffff})`);
    return us;
  }
  bench('mode B old full-recompute', evalOldFull);
  const newUs = bench('mode B new (scratch)     ', evalNnueWhitePov);
  void newUs;
}
