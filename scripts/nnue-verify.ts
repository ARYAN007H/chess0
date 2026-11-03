/**
 * NNUE net verifier (run with `npx tsx scripts/nnue-verify.ts [path]`).
 *
 * Loads a quantized net and prints evaluations for reference FENs so the
 * Python trainer's printed reference evals (training/nnue_train.py) can be
 * cross-checked — TS and Python must agree within quantization tolerance.
 */

import { readFileSync } from 'node:fs';
import { newStartPosition, parseFen } from '../src/engine/position';
import { loadNnueWeights, evalNnueWhitePov, nnueLoaded } from '../src/engine/nnue';

const path = process.argv[2] ?? 'data/nnue-v1.bin';
const bytes = readFileSync(path);
console.log(loadNnueWeights(bytes));
console.log('nnueLoaded:', nnueLoaded());

const FENS: Array<[string, string]> = [
  ['startpos', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'],
  ['endgame', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'],
  ['endgame-black', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 b - - 0 1'],
];

for (const [name, fen] of FENS) {
  const pos = newStartPosition();
  parseFen(pos, fen);
  console.log(`eval ${name}: ${evalNnueWhitePov(pos)} cp (white POV)`);
}

// sanity: eval speed
const pos = newStartPosition();
parseFen(pos, FENS[0][1]);
const t0 = performance.now();
let acc = 0;
for (let i = 0; i < 100_000; i++) acc += evalNnueWhitePov(pos);
const us = (performance.now() - t0) * 1000 / 100_000;
console.log(`eval speed: ${us.toFixed(2)} µs/eval (checksum ${acc & 0xffff})`);
