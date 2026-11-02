/**
 * v3 determinism parity snapshot (run with `npx tsx scripts/parity.ts [--save|--check path]`).
 *
 * Runs fixed-depth v3 searches on standard positions and prints
 * `fenTag depth bestMoveUci score nodes`. Fixed-depth searches are fully
 * deterministic, so a pure speed refactor must reproduce every line exactly.
 */

import { newStartPosition, parseFen } from '../src/engine/position';
import type { Position } from '../src/engine/position';
import { searchPositionV3 } from '../src/engine/searchV3';

const CASES: Array<[string, string, number]> = [
  ['startpos', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 10],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 9],
  ['endgame', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 12],
  ['midgame', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', 9],
  ['tactic', 'r1bqk2r/pp2bppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2QK2R w KQkq - 0 8', 9],
  ['endgame2', '8/8/1p4p1/3pP3/1P6/5KP1/5P2/7k w - - 0 1', 13],
];

function load(fen: string): Position {
  const pos = newStartPosition();
  parseFen(pos, fen);
  return pos;
}

const lines: string[] = [];
for (const [tag, fen, depth] of CASES) {
  const r = searchPositionV3(load(fen), { depth });
  const score = r.scoreMate !== undefined ? `M${r.scoreMate}` : `${r.scoreCp}`;
  lines.push(`${tag} d${depth} ${r.bestMoveUci} ${score} nodes=${r.nodes}`);
}

const out = lines.join('\n');
const saveIdx = process.argv.indexOf('--save');
if (saveIdx >= 0 && process.argv[saveIdx + 1]) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.argv[saveIdx + 1], out + '\n');
  console.log(out);
  console.log(`\nsaved -> ${process.argv[saveIdx + 1]}`);
} else {
  console.log(out);
}
