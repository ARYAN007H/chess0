/**
 * Perft (performance test) — counts leaf nodes of the legal move tree.
 *
 * Legality is enforced with the same make + king-attack + unmake path the
 * search uses, so a passing perft verifies the entire rules layer: castling,
 * en passant (including the ep-discovered-check edge cases), promotions,
 * pins and check evasions.
 */

import { MAX_PLY, MAX_MOVES } from '../src/engine/types';
import { parseFen, makeMove, unmakeMove, newStartPosition } from '../src/engine/position';
import type { Position } from '../src/engine/position';
import { genMoves, inCheckOf, filterLegal, moveIsLegal } from '../src/engine/movegen';
import { moveToUci } from '../src/engine/types';

const MOVE_LISTS: Int32Array[] = Array.from({ length: MAX_PLY }, () => new Int32Array(MAX_MOVES));

export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  const moves = MOVE_LISTS[pos.ply];
  const count = genMoves(pos, moves);
  const wasInCheck = inCheckOf(pos, pos.stm);
  let nodes = 0;
  for (let i = 0; i < count; i++) {
    makeMove(pos, moves[i]);
    if (moveIsLegal(pos, moves[i], wasInCheck)) {
      nodes += depth === 1 ? 1 : perft(pos, depth - 1);
    }
    unmakeMove(pos, moves[i]);
  }
  return nodes;
}

/** Per-move subtree counts — the standard debugging aid for perft mismatches. */
export function divide(pos: Position, depth: number): Map<string, number> {
  const result = new Map<string, number>();
  const pseudo = new Int32Array(MAX_MOVES);
  const count = genMoves(pos, pseudo);
  const legal = new Int32Array(MAX_MOVES);
  const n = filterLegal(pos, pseudo, count, legal);
  for (let i = 0; i < n; i++) {
    const m = legal[i];
    makeMove(pos, m);
    const nodes = depth <= 1 ? 1 : perft(pos, depth - 1);
    unmakeMove(pos, m);
    result.set(moveToUci(m), nodes);
  }
  return result;
}

export interface PerftCase {
  name: string;
  fen: string;
  depth: number;
  expected: number;
}

/** The 6 standard CPW positions — the Phase 1 correctness gate. */
export const STANDARD_SUITE: PerftCase[] = [
  { name: 'startpos', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', depth: 5, expected: 4865609 },
  {
    name: 'kiwipete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    depth: 4,
    expected: 4085603,
  },
  { name: 'position3', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', depth: 6, expected: 11030083 },
  {
    name: 'position4',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    depth: 5,
    expected: 15833292,
  },
  {
    name: 'position5',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    depth: 4,
    expected: 2103487,
  },
  {
    name: 'position6',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    depth: 4,
    expected: 3894594,
  },
];

/** TalkChess edge-case suite: ep pins, castle checks, promotions, stalemates. */
export const EXTENDED_SUITE: PerftCase[] = [
  { name: 'ep-pin', fen: '3k4/3p4/8/K1P4r/8/8/8/8 b - - 0 1', depth: 6, expected: 1134888 },
  { name: 'ep-pin-2', fen: '8/8/4k3/8/2p5/8/B2P2K1/8 w - - 0 1', depth: 6, expected: 1015133 },
  { name: 'ep-capture-checks', fen: '8/8/1k6/2b5/2pP4/8/5K2/8 b - d3 0 1', depth: 6, expected: 1440467 },
  { name: 'short-castle-check', fen: '5k2/8/8/8/8/8/8/4K2R w K - 0 1', depth: 6, expected: 661072 },
  { name: 'long-castle-check', fen: '3k4/8/8/8/8/8/8/R3K3 w Q - 0 1', depth: 6, expected: 803711 },
  { name: 'castle-rights', fen: 'r3k2r/1b4bq/8/8/8/8/7B/R3K2R w KQkq - 0 1', depth: 4, expected: 1274206 },
  { name: 'castle-prevented', fen: 'r3k2r/8/3Q4/8/8/5q2/8/R3K2R b KQkq - 0 1', depth: 4, expected: 1720476 },
  { name: 'promote-out-of-check', fen: '2K2r2/4P3/8/8/8/8/8/3k4 w - - 0 1', depth: 6, expected: 3821001 },
  { name: 'discovered-check', fen: '8/8/1P2K3/8/2n5/1q6/8/5k2 b - - 0 1', depth: 5, expected: 1004658 },
  { name: 'promote-to-check', fen: '4k3/1P6/8/8/8/8/K7/8 w - - 0 1', depth: 6, expected: 217342 },
  { name: 'underpromote-check', fen: '8/P1k5/K7/8/8/8/8/8 w - - 0 1', depth: 6, expected: 92683 },
  { name: 'self-stalemate', fen: 'K1k5/8/P7/8/8/8/8/8 w - - 0 1', depth: 6, expected: 2217 },
  { name: 'stalemate-and-checkmate', fen: '8/k1P5/8/1K6/8/8/8/8 w - - 0 1', depth: 7, expected: 567584 },
  { name: 'double-check', fen: '8/8/2k5/5q2/5n2/8/5K2/8 b - - 0 1', depth: 4, expected: 23527 },
];

export function runCase(c: PerftCase, verbose = true): boolean {
  const pos = newStartPosition();
  parseFen(pos, c.fen);
  const t0 = performance.now();
  const nodes = perft(pos, c.depth);
  const ms = performance.now() - t0;
  const ok = nodes === c.expected;
  if (verbose) {
    const nps = nodes / (ms / 1000) / 1e6;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(22)} d${c.depth}  ${nodes.toLocaleString()} nodes` +
        `${ok ? '' : `  (expected ${c.expected.toLocaleString()})`}  ${ms.toFixed(0)} ms  ${nps.toFixed(1)}M nps`,
    );
  }
  return ok;
}

const QUICK_CASES = [
  { name: 'startpos d1', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', depth: 1, expected: 20 },
  { name: 'startpos d2', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', depth: 2, expected: 400 },
  { name: 'startpos d3', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', depth: 3, expected: 8902 },
  { name: 'startpos d4', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', depth: 4, expected: 197281 },
  { name: 'kiwipete d1', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', depth: 1, expected: 48 },
  { name: 'kiwipete d2', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', depth: 2, expected: 2039 },
  { name: 'kiwipete d3', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', depth: 3, expected: 97862 },
  { name: 'position3 d4', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', depth: 4, expected: 43238 },
  { name: 'position4 d3', fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', depth: 3, expected: 9467 },
  { name: 'position5 d3', fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', depth: 3, expected: 62379 },
  { name: 'position6 d3', fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', depth: 3, expected: 89890 },
];

function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'divide') {
    const pos = newStartPosition();
    parseFen(pos, args[1]);
    const depth = parseInt(args[2], 10);
    let total = 0;
    for (const [uci, nodes] of divide(pos, depth)) {
      console.log(uci, nodes.toLocaleString());
      total += nodes;
    }
    console.log('total', total.toLocaleString());
    return;
  }

  if (args[0] === '--quick') {
    let allOk = true;
    for (const c of QUICK_CASES) allOk = runCase(c) && allOk;
    console.log(allOk ? '\nQUICK SUITE: PASS' : '\nQUICK SUITE: FAIL');
    if (!allOk) process.exit(1);
    return;
  }

  console.log('=== Standard perft suite (Phase 1 gate) ===');
  let allOk = true;
  const t0 = performance.now();
  for (const c of STANDARD_SUITE) allOk = runCase(c) && allOk;
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(allOk ? `\nGATE 1 PASSED in ${elapsed}s — all 6 standard perft numbers match exactly.` : `\nGATE 1 FAILED (${elapsed}s)`);
  if (!allOk) process.exit(1);

  console.log('\n=== Extended edge-case suite ===');
  let extOk = true;
  for (const c of EXTENDED_SUITE) extOk = runCase(c) && extOk;
  console.log(extOk ? '\nEXTENDED SUITE: PASS' : '\nEXTENDED SUITE: FAIL');
  if (!extOk) process.exit(1);
}

main();
