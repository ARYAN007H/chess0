/**
 * Search benchmark (run with `npm run bench`).
 *
 * Gate (v1): single-thread, modern laptop — >= 1M nodes/sec and depth >= 9 in 1s
 * from the starting position. v2 rows are informational: fewer nps but a
 * richer evaluation and deeper effective search.
 */

import { newStartPosition, parseFen } from '../src/engine/position';
import type { Position } from '../src/engine/position';
import { searchPosition } from '../src/engine/search';
import { searchPositionV2 } from '../src/engine/searchV2';
import type { SearchInfo } from '../src/engine/search';
import { moveToUci } from '../src/engine/types';

const BENCH_POSITIONS = [
  { name: 'startpos', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
  { name: 'kiwipete', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1' },
  { name: 'endgame', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1' },
];

function load(fen: string): Position {
  const pos = newStartPosition();
  parseFen(pos, fen);
  return pos;
}

function fmtScore(info: { scoreCp?: number; scoreMate?: number }): string {
  if (info.scoreMate !== undefined) return `#${info.scoreMate > 0 ? '' : '-'}M${Math.abs(info.scoreMate)}`;
  return (info.scoreCp! / 100).toFixed(2);
}

function runNamed(
  name: string,
  fen: string,
  movetime: number,
  run: (pos: Position, movetime: number, onInfo: (info: SearchInfo) => void) => void,
): { depth: number; nps: number; score: string; pv: string[] } {
  const pos = load(fen);
  let lastInfo: SearchInfo | null = null;
  const t0 = performance.now();
  run(pos, movetime, (info) => {
    lastInfo = info;
  });
  const wall = performance.now() - t0;
  const info = lastInfo!;
  console.log(
    `${name.padEnd(10)} ${movetime / 1000}s:  score ${fmtScore(info).padStart(7)}  depth ${String(info.depth).padStart(2)}/${String(info.seldepth).padEnd(2)}  ` +
      `${info.nodes.toLocaleString().padStart(12)} nodes  ${(info.nps / 1e6).toFixed(2)}M nps  (${wall.toFixed(0)} ms)  pv: ${info.pvSan.slice(0, 8).join(' ')}`,
  );
  return { depth: info.depth, nps: info.nps, score: fmtScore(info), pv: info.pvSan };
}

function main() {
  const args = process.argv.slice(2);
  const time = args[0] === '--long' ? 10000 : 1000;
  console.log(`Chess0 benchmark — ${time / 1000}s per position, v1 vs v2\n`);

  let startV1Depth = 0;
  const minV1Nps = [];
  const minV2Nps = [];
  let startV2Depth = 0;

  for (const p of BENCH_POSITIONS) {
    const r1 = runNamed(p.name, p.fen, time, (pos, mt, onInfo) => {
      searchPosition(pos, { movetime: mt }, onInfo);
    });
    if (p.name === 'startpos') startV1Depth = r1.depth;
    minV1Nps.push(r1.nps);
    const r2 = runNamed(`${p.name} (v2)`, p.fen, time, (pos, mt, onInfo) => {
      searchPositionV2(pos, { movetime: mt }, onInfo);
    });
    if (p.name === 'startpos') startV2Depth = r2.depth;
    minV2Nps.push(r2.nps);
    console.log('');
  }

  const min1 = Math.min(...minV1Nps);
  const min2 = Math.min(...minV2Nps);
  console.log(`GATE v1: nps >= 1M          ${min1 >= 1e6 ? 'PASS' : 'FAIL'}  (min ${(min1 / 1e6).toFixed(2)}M)`);
  console.log(`GATE v1: depth >= 9 @1s     ${startV1Depth >= 9 || time > 1000 ? 'PASS' : 'FAIL'}  (startpos depth ${startV1Depth})`);
  console.log(`INFO v2: nps                (min ${(min2 / 1e6).toFixed(2)}M)`);
  console.log(`INFO v2: startpos depth     ${startV2Depth}`);
}

main();
