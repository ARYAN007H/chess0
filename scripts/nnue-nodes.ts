/**
 * Node-rate diagnostic for the NNUE eval path: v3base (hand eval) vs
 * v3nnue (incremental-accumulator net) at FIXED DEPTH, alternating variants
 * per FEN so machine-load drift cancels. nps is the speed metric; the
 * handover's "node tax" (~43% with the full-recompute eval) shows up as
 * nps(nnue)/nps(base).
 *
 * Usage: npx tsx scripts/nnue-nodes.ts [depth] (default 9)
 */

import { readFileSync } from 'node:fs';
import { makeMove, makeNullMove, newStartPosition, parseFen, unmakeNullMove, Position } from '../src/engine/position';
import { legalMoves } from '../src/engine/movegen';
import { searchPositionV3, clearTTV3 } from '../src/engine/searchV3';
import { evalNnueWhitePov, loadNnueWeights } from '../src/engine/nnue';
import { setEvalOverride, clearEvalCaches } from '../src/engine/evalV3';
import { resetEvalParams } from '../src/engine/evalV3Params';
import { resetEvalV2Params } from '../src/engine/evalV2Params';

const DEPTH = Number(process.argv[2] ?? 9);

const FENS: Array<[string, string]> = [
  ['startpos', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'],
  ['cpw-mid', 'r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1'],
  ['endgame', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'],
  ['rook-end', '8/8/4kpp1/3p4/p1pP4/P1P4K/6P1/7r b - - 0 1'],
  ['queens', '2Q5/8/4k3/8/8/4K3/6q1/8 w - - 0 1'],
];

function prepare(nnue: boolean): void {
  resetEvalParams();
  resetEvalV2Params();
  if (nnue) {
    loadNnueWeights(readFileSync('data/nnue-v1.bin'));
    setEvalOverride(evalNnueWhitePov);
  } else {
    setEvalOverride(null);
  }
  clearEvalCaches();
  clearTTV3();
}

function load(fen: string): Position {
  const pos = newStartPosition();
  parseFen(pos, fen);
  return pos;
}

// --- Hot eval probe on a LIVE stack (the path search actually takes) ---------
{
  loadNnueWeights(readFileSync('data/nnue-v1.bin'));
  const probe = load(FENS[1][1]); // kiwipete
  // Bootstrap the accumulator stack: a null-move push allocates + recomputes.
  makeNullMove(probe);
  unmakeNullMove(probe);
  let sink = 0;
  for (let i = 0; i < 50_000; i++) sink += evalNnueWhitePov(probe); // warmup
  const t0 = performance.now();
  for (let i = 0; i < 200_000; i++) sink += evalNnueWhitePov(probe);
  const hotUs = ((performance.now() - t0) * 1000) / 200_000;
  console.log(`hot eval (live stack, kiwipete): ${hotUs.toFixed(2)} µs (sink ${sink & 0xffff})`);
  // Sanity: live-stack eval equals scratch eval on the same position.
  const clone = probe.clone();
  if (evalNnueWhitePov(probe) !== evalNnueWhitePov(clone)) {
    throw new Error('live-stack eval != scratch eval');
  }
  setEvalOverride(null);
  clearEvalCaches();
}

// --- Alternating fixed-depth searches -----------------------------------------
interface Row {
  name: string;
  baseNps: number;
  nnueNps: number;
  baseNodes: number;
  nnueNodes: number;
}
const rows: Row[] = [];

// Alternate order per index to cancel drift.
for (let i = 0; i < FENS.length; i++) {
  const [name, fen] = FENS[i];
  const nnueFirst = i % 2 === 0;

  const runOnce = (nnue: boolean) => {
    prepare(nnue);
    const pos = load(fen);
    const r = searchPositionV3(pos, { depth: DEPTH, multiPv: 1 });
    clearTTV3();
    return r;
  };

  const a = runOnce(nnueFirst);
  const b = runOnce(!nnueFirst);
  const nnueRes = nnueFirst ? a : b;
  const baseRes = nnueFirst ? b : a;
  rows.push({
    name,
    baseNps: baseRes.nps,
    nnueNps: nnueRes.nps,
    baseNodes: baseRes.nodes,
    nnueNodes: nnueRes.nodes,
  });
}

console.log(`\nfixed depth ${DEPTH}, alternating variants (browser load present — ratios are the signal):`);
console.log(`${'FEN'.padEnd(11)} ${'base nps'.padStart(11)} ${'nnue nps'.padStart(11)} ${'nnue/base'.padStart(10)} ${'base nodes'.padStart(12)} ${'nnue nodes'.padStart(12)}`);
let sBase = 0;
let sNnue = 0;
for (const r of rows) {
  sBase += r.baseNps;
  sNnue += r.nnueNps;
  console.log(
    `${r.name.padEnd(11)} ${(r.baseNps / 1e6).toFixed(2).padStart(9)}M ${(r.nnueNps / 1e6).toFixed(2).padStart(9)}M ` +
      `${(r.nnueNps / r.baseNps).toFixed(2).padStart(9)}x ${r.baseNodes.toLocaleString().padStart(12)} ${r.nnueNodes.toLocaleString().padStart(12)}`,
  );
}
console.log(`\nSUM nps: base ${(sBase / 1e6).toFixed(2)}M  nnue ${(sNnue / 1e6).toFixed(2)}M  →  ratio ${(sNnue / sBase).toFixed(2)}x`);
console.log('(handover baseline: full-recompute eval ran ~0.57x of v3base node throughput)');
void makeMove;
void legalMoves;
