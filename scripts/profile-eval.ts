/**
 * evalV3 profiling harness (run with `npx tsx scripts/profile-eval.ts`).
 *
 * Measures evalV3WhitePov ns/call over bench FENs plus real search-tree
 * positions (random walks), and reports pawn-TT hit rate via the flag-gated
 * counters in evalV3. Used to quantify the speed pass; does not touch v1.
 */

import { newStartPosition, parseFen, makeMove, unmakeMove } from '../src/engine/position';
import type { Position } from '../src/engine/position';
import { legalMoves } from '../src/engine/movegen';
import { evalV3WhitePov, evalV3Stats } from '../src/engine/evalV3';
import { moveToUci } from '../src/engine/types';

const FENS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
  'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
  '8/8/1p4p1/3pP3/1P6/5KP1/5P2/7k w - - 0 1',
];

function load(fen: string): Position {
  const pos = newStartPosition();
  parseFen(pos, fen);
  return pos;
}

/** Deterministic-ish random walk positions (mirrors search-tree leaf variety). */
function walkPositions(count: number, plies: number): Position[] {
  const out: Position[] = [];
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed ^= seed << 13; seed |= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed |= 0;
    return (seed >>> 0) / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const pos = load(FENS[i % FENS.length]);
    for (let p = 0; p < plies; p++) {
      const moves = legalMoves(pos);
      if (moves.length === 0) break;
      makeMove(pos, moves[Math.floor(rnd() * moves.length)]);
    }
    out.push(pos);
  }
  return out;
}

function benchNs(label: string, positions: Position[], iters: number): number {
  // warmup
  for (let i = 0; i < 2000; i++) evalV3WhitePov(positions[i % positions.length]);
  const t0 = performance.now();
  let acc = 0;
  for (let i = 0; i < iters; i++) acc += evalV3WhitePov(positions[i % positions.length]);
  const ns = ((performance.now() - t0) * 1e6) / iters;
  console.log(`  ${label.padEnd(28)} ${ns.toFixed(0).padStart(6)} ns/call   (checksum ${acc & 0xffff})`);
  return ns;
}

console.log('evalV3 profile');
const staticPos = FENS.map(load);
const walkPos = walkPositions(4096, 24);

const nsStatic = benchNs('bench FENs (static)', staticPos, 200_000);
const nsWalk = benchNs('search-leaf-like (walks)', walkPos, 500_000);

// pawn-TT + eval-cache hit rates over the walk set
evalV3Stats.on = true;
evalV3Stats.calls = 0;
evalV3Stats.pawnTtHits = 0;
evalV3Stats.evalCacheHits = 0;
// two passes so the eval cache is warm (search revisits transpositions)
for (let pass = 0; pass < 2; pass++) {
  for (let i = 0; i < 50_000; i++) evalV3WhitePov(walkPos[i % walkPos.length]);
}
const hitRate = (100 * evalV3Stats.pawnTtHits) / evalV3Stats.calls;
const cacheRate = (100 * evalV3Stats.evalCacheHits) / evalV3Stats.calls;
evalV3Stats.on = false;
console.log(`  pawn-TT hit rate              ${hitRate.toFixed(1)}%  (${evalV3Stats.calls} calls)`);
console.log(`  eval-cache hit rate           ${cacheRate.toFixed(1)}%`);

console.log(`\n  blended estimate (80% walk): ${(0.8 * nsWalk + 0.2 * nsStatic).toFixed(0)} ns/call`);
