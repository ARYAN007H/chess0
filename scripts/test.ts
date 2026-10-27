/**
 * Correctness test suite (run with `npm test`).
 *
 * Covers FEN round-trips, make/unmake + incremental state consistency under
 * random walks, eval invariants (mirrored-position symmetry, <100ns gate),
 * SAN output and basic game-state detection.
 */

import { parseFen, toFen, newStartPosition, makeMove, unmakeMove, makeNullMove, unmakeNullMove, computeDerived } from '../src/engine/position';
import { Position } from '../src/engine/position';
import { legalMoves, genMoves, inCheckOf, filterLegal } from '../src/engine/movegen';
import { MAX_MOVES } from '../src/engine/types';
import { moveToUci, moveFrom, moveTo, movePromo, encodeMove } from '../src/engine/types';
import { evalPos, evalWhitePov, insufficientMaterial } from '../src/engine/eval';
import { moveToSan } from '../src/engine/san';

let failures = 0;
function check(cond: boolean, label: string) {
  if (!cond) {
    failures++;
    console.error(`  FAIL  ${label}`);
  }
}

// ---------------------------------------------------------------------------
// FEN round-trip
// ---------------------------------------------------------------------------

const FENS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
  '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
  'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 b - - 3 12',
  '8/8/1k6/2b5/2pP4/8/5K2/8 b - d3 0 1',
  '5k2/8/8/8/8/8/8/4K2R w K - 12 34',
];

console.log('FEN round-trip:');
for (const fen of FENS) {
  const pos = newStartPosition();
  parseFen(pos, fen);
  const out = toFen(pos);
  check(out === fen, `round-trip "${fen}" -> "${out}"`);
}

// Invalid FENs must throw.
console.log('FEN validation:');
for (const bad of [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w KQkq - 0 1', // short rank
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w - - 0 1', // missing back rank
  '8/8/8/8/8/8/8/8 w - - 0 1', // no kings
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1', // bad side
  'P3k2r/8/8/8/8/8/8/4K3 w - - 0 1', // pawn on rank 8
]) {
  let threw = false;
  try {
    const pos = newStartPosition();
    parseFen(pos, bad);
  } catch {
    threw = true;
  }
  check(threw, `invalid FEN rejected: "${bad}"`);
}

// ---------------------------------------------------------------------------
// make/unmake + incremental state consistency (random walks)
// ---------------------------------------------------------------------------

console.log('make/unmake + zobrist/eval consistency:');

function snapshot(pos: Position): string {
  return (
    toFen(pos) +
    '|' +
    pos.hashLo +
    ',' +
    pos.hashHi +
    '|' +
    pos.mg +
    ',' +
    pos.eg +
    ',' +
    pos.phase +
    '|' +
    [...pos.pawnCount, ...pos.minorCount, ...pos.rqCount, ...pos.npmCount].join(',')
  );
}

/** Recompute hash/eval from scratch; must equal the incremental values. */
function assertDerivedConsistent(pos: Position, label: string) {
  const fenBefore = toFen(pos);
  const incHash = `${pos.hashLo},${pos.hashHi}`;
  const incMg = pos.mg;
  const incEg = pos.eg;
  const incPhase = pos.phase;
  const incCounts = [...pos.pawnCount, ...pos.minorCount, ...pos.rqCount, ...pos.npmCount].join(',');
  computeDerived(pos);
  check(`${pos.hashLo},${pos.hashHi}` === incHash, `${label}: incremental hash == recomputed (${fenBefore})`);
  check(pos.mg === incMg && pos.eg === incEg, `${label}: incremental eval == recomputed (${fenBefore})`);
  check(pos.phase === incPhase, `${label}: incremental phase == recomputed (${fenBefore})`);
  check(
    [...pos.pawnCount, ...pos.minorCount, ...pos.rqCount, ...pos.npmCount].join(',') === incCounts,
    `${label}: piece counts == recomputed (${fenBefore})`,
  );
}

const WALK_FENS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
  'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
];

// Simple deterministic LCG so failures reproduce.
let rngState = 0x2f6e2b1;
function rng(): number {
  rngState = (Math.imul(rngState, 1664525) + 1013904223) | 0;
  return (rngState >>> 0) / 4294967296;
}

const pseudo = new Int32Array(MAX_MOVES);
const legal = new Int32Array(MAX_MOVES);

for (const fen of WALK_FENS) {
  const pos = newStartPosition();
  parseFen(pos, fen);
  assertDerivedConsistent(pos, `initial ${fen}`);
  const startSnap = snapshot(pos);

  for (let step = 0; step < 60; step++) {
    // Take 1-3 legal moves, regenerating the legal list before each one
    // (each move changes the position, so the old list is stale).
    const take = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < take; k++) {
      const count = genMoves(pos, pseudo);
      const n = filterLegal(pos, pseudo, count, legal);
      if (n === 0) break;
      const m = legal[Math.floor(rng() * n)];
      makeMove(pos, m);
      assertDerivedConsistent(pos, `walk ${fen} step ${step} after ${moveToUci(m)}`);
    }
    // Unmake everything we applied.
    const applied = take;
    // Null-move round trip as well.
    const nullOk = pos.ply < 2000;
    if (nullOk) {
      const beforeNull = snapshot(pos);
      makeNullMove(pos);
      unmakeNullMove(pos);
      check(snapshot(pos) === beforeNull, `null round-trip ${fen} step ${step}`);
    }
    for (let k = 0; k < applied; k++) {
      // The move to unmake is the last on the stack.
      const m = pos.histMove[pos.ply - 1];
      unmakeMove(pos, m);
    }
    check(snapshot(pos) === startSnap, `unmake restores position ${fen} step ${step}`);
  }
}

// ---------------------------------------------------------------------------
// Eval invariants
// ---------------------------------------------------------------------------

console.log('eval invariants:');

/** Mirrored position: colors and ranks flipped. eval must negate. */
function mirroredFen(fen: string): string {
  const pos = newStartPosition();
  parseFen(pos, fen);
  const rows = toFen(pos).split(' ')[0].split('/');
  const flip: Record<string, string> = { P: 'p', N: 'n', B: 'b', R: 'r', Q: 'q', K: 'k', p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };
  const mapped = rows.map((r) => [...r].map((c) => flip[c] ?? c).join(''));
  const placement = mapped.reverse().join('/');
  const side = pos.stm === 0 ? 'b' : 'w';
  let castling = '';
  if (pos.castling & 1) castling += 'k';
  if (pos.castling & 2) castling += 'q';
  if (pos.castling & 4) castling += 'K';
  if (pos.castling & 8) castling += 'Q';
  const ep = pos.ep >= 0 ? 'abcdefgh'[pos.ep & 7] + (1 + (pos.ep >> 4)) : '-';
  return `${placement} ${side} ${castling || '-'} ${ep} 0 1`;
}

for (const fen of WALK_FENS) {
  const a = newStartPosition();
  parseFen(a, fen);
  const b = newStartPosition();
  parseFen(b, mirroredFen(fen));
  check(evalWhitePov(a) === -evalWhitePov(b), `mirror symmetry ${fen}: ${evalWhitePov(a)} vs ${-evalWhitePov(b)}`);
}

// Insufficient material cases.
{
  const t = (fen: string, expected: boolean, label: string) => {
    const pos = newStartPosition();
    parseFen(pos, fen);
    check(insufficientMaterial(pos) === expected, `${label}: insufficientMaterial=${insufficientMaterial(pos)} want ${expected}`);
  };
  t('4k3/8/8/8/8/8/8/4K3 w - - 0 1', true, 'K vs K');
  t('4k3/8/8/8/8/8/8/4KB2 w - - 0 1', true, 'KB vs K');
  t('4k3/8/8/8/8/8/8/4KN2 w - - 0 1', true, 'KN vs K');
  t('4k3/8/8/8/8/8/8/4KNB1 w - - 0 1', false, 'KBN vs K');
  t('4k3/8/8/2b5/8/8/8/2B1K3 w - - 0 1', true, 'KB vs KB same color');
  t('4k3/8/8/2b5/8/8/8/3BK3 w - - 0 1', false, 'KB vs KB opposite color');
  t('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', false, 'KP vs K');
  t('4k3/8/8/8/2r5/8/8/4K3 w - - 0 1', false, 'KR vs K');
}

// ---------------------------------------------------------------------------
// SAN
// ---------------------------------------------------------------------------

console.log('SAN:');

function sanOf(fen: string, uci: string): string {
  const pos = newStartPosition();
  parseFen(pos, fen);
  const moves = legalMoves(pos);
  for (let i = 0; i < moves.length; i++) {
    if (moveToUci(moves[i]) === uci) return moveToSan(pos, moves[i]);
  }
  return `<illegal ${uci}>`;
}

check(sanOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4') === 'e4', 'e4');
check(sanOf('rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1', 'g8f6') === 'Nf6', 'Nf6');
check(sanOf('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2', 'e4d5') === 'exd5', 'exd5');
check(sanOf('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 'e1g1') === 'O-O', 'O-O');
check(sanOf('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 'e1c1') === 'O-O-O', 'O-O-O');
check(sanOf('8/P7/8/8/8/8/k6K/8 w - - 0 1', 'a7a8q') === 'a8=Q+', 'a8=Q+');
check(sanOf('1k6/8/8/4N3/1N6/8/8/1K6 w - - 0 1', 'b4c6') === 'Nbc6+', 'Nbc6+ (file disambiguation + check)');
check(sanOf('1k6/8/3N4/8/3N4/8/8/1K6 w - - 0 1', 'd4b5') === 'N4b5', 'N4b5 (rank disambiguation)');
check(sanOf('6k1/R7/1R6/8/8/8/8/K7 w - - 0 1', 'b6b8') === 'Rb8#', 'Rb8# (mate)');

// ---------------------------------------------------------------------------
// Search sanity: known mates
// ---------------------------------------------------------------------------

console.log('search sanity (known mates):');
{
  const { searchPosition } = await import('../src/engine/search');

  // Scholar's mate one move away: Qxf7#
  const pos = newStartPosition();
  parseFen(pos, 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1');
  const r1 = searchPosition(pos, { depth: 3 });
  check(moveToUci(r1.bestMove) === 'f3f7', `finds Qxf7# (got ${moveToUci(r1.bestMove)})`);
  check(r1.scoreMate === 1, `Qxf7# scored as mate in 1 (got scoreMate=${r1.scoreMate} cp=${r1.scoreCp})`);

  // Random-ish endgame: engine must return a legal move.
  const pos2 = newStartPosition();
  parseFen(pos2, '7k/8/8/8/8/8/R7/K7 w - - 0 1');
  const r2 = searchPosition(pos2, { movetime: 300 });
  const legal2 = legalMoves(pos2);
  check([...legal2].some((m) => m === r2.bestMove), 'KRvK returns a legal move');

  // Back-rank mate in 1.
  const pos3 = newStartPosition();
  parseFen(pos3, '6k1/5ppp/8/8/8/8/8/K2R4 w - - 0 1');
  const r3 = searchPosition(pos3, { depth: 3 });
  check(
    moveToUci(r3.bestMove) === 'd1d8' && r3.scoreMate === 1,
    `finds Rd8# (got ${moveToUci(r3.bestMove)}, scoreMate=${r3.scoreMate})`,
  );

  // Mate in 2: Anastasia-style — queen sac into knight mate is complex; use
  // the classic 2-move ladder: white Ra1/Rb2 vs bare king on h8.
  const pos4 = newStartPosition();
  parseFen(pos4, '7k/8/8/8/8/8/1R6/R6K w - - 0 1');
  const r4 = searchPosition(pos4, { depth: 5 });
  check(r4.scoreMate === 2, `ladder mate in 2 (got scoreMate=${r4.scoreMate} move ${moveToUci(r4.bestMove)})`);
}

// ---------------------------------------------------------------------------
// v2 engine: SEE, evalV2 invariants, search sanity
// ---------------------------------------------------------------------------

console.log('v2 engine:');
{
  const { see } = await import('../src/engine/see');
  const { evalV2WhitePov, evalV2 } = await import('../src/engine/evalV2');
  const { searchPositionV2 } = await import('../src/engine/searchV2');

  const load = (fen: string) => {
    const p = newStartPosition();
    parseFen(p, fen);
    return p;
  };
  const moveByUci = (fen: string, uci: string) => {
    const p = load(fen);
    const moves = legalMoves(p);
    for (let i = 0; i < moves.length; i++) {
      if (moveToUci(moves[i]) === uci) return { pos: p, move: moves[i] };
    }
    throw new Error(`v2 test: move ${uci} not legal in ${fen}`);
  };

  // SEE: static exchange values on crafted positions.
  const seeCases: [string, string, number, string][] = [
    ['4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'e4d5', 100, 'PxP undefended'],
    ['4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1', 'd1d5', 100, 'QxP undefended'],
    ['2k5/8/2p5/3p4/8/8/8/3QK3 w - - 0 1', 'd1d5', -800, 'QxP defended by pawn'],
    ['3rk3/8/8/3r4/8/8/8/3R1K2 w - - 0 1', 'd1d5', 0, 'RxR defended by rook'],
    ['2k5/8/2p5/3q4/2P5/8/8/2K5 w - - 0 1', 'c4d5', 800, 'PxQ defended by pawn'],
    ['4k3/8/2p5/8/4P3/8/8/4K3 w - - 0 1', 'e4e5', 0, 'quiet move'],
  ];
  for (const [fen, uci, want, label] of seeCases) {
    const { pos, move } = moveByUci(fen, uci);
    const got = see(pos, move);
    check(got === want, `see ${label}: got ${got} want ${want}`);
  }

  // evalV2: mirror symmetry on the walk positions.
  for (const fen of WALK_FENS) {
    const a = load(fen);
    const b = load(mirroredFen(fen));
    check(
      evalV2WhitePov(a) === -evalV2WhitePov(b),
      `v2 mirror symmetry ${fen}: ${evalV2WhitePov(a)} vs ${-evalV2WhitePov(b)}`,
    );
  }

  // evalV2: material dominates.
  check(Math.abs(evalV2WhitePov(load('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'))) < 60, 'v2 startpos eval near 0');
  const upQueen = load('rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  check(evalV2WhitePov(upQueen) > 800, `v2 white up a queen scores >800 (got ${evalV2WhitePov(upQueen)})`);
  const stmW = load('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const stmB = load('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1');
  check(evalV2(stmW) === evalV2(stmB), 'v2 eval is side-to-move relative');

  // searchV2: known mates.
  const m1 = load('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1');
  const r1 = searchPositionV2(m1, { depth: 4 });
  check(moveToUci(r1.bestMove) === 'f3f7' && r1.scoreMate === 1, `v2 finds Qxf7# (got ${moveToUci(r1.bestMove)}, mate=${r1.scoreMate})`);

  const m2 = load('7k/8/8/8/8/8/1R6/R6K w - - 0 1');
  const r2 = searchPositionV2(m2, { depth: 6 });
  check(r2.scoreMate === 2, `v2 ladder mate in 2 (got mate=${r2.scoreMate} move ${moveToUci(r2.bestMove)})`);

  const kr = load('7k/8/8/8/8/8/R7/K7 w - - 0 1');
  const r3 = searchPositionV2(kr, { movetime: 300 });
  const legalKr = legalMoves(kr);
  check([...legalKr].some((m) => m === r3.bestMove), 'v2 KRvK returns a legal move');

  // searchV2: startpos move is a reasonable developing move (sanity, not a gate).
  const sp = load('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const r4 = searchPositionV2(sp, { movetime: 500 });
  check(
    ['b1c3', 'g1f3', 'd2d4', 'e2e4', 'c2c4', 'd2d3', 'e2e3', 'g2g3', 'b2b3', 'c2c3', 'a2a3', 'f2f3', 'h2h3', 'g2g4', 'b2b4', 'a2a4', 'f2f4', 'h2h4'].includes(moveToUci(r4.bestMove)),
    `v2 startpos plays a plausible move (got ${moveToUci(r4.bestMove)})`,
  );
}

// ---------------------------------------------------------------------------
// Eval speed gate (< 100ns per call)
// ---------------------------------------------------------------------------

console.log('eval speed gate:');
{
  const positions: Position[] = [];
  const pos = newStartPosition();
  parseFen(pos, 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  positions.push(pos);

  let evals = 0;
  // Warm up.
  for (let i = 0; i < 100000; i++) evals += evalPos(positions[0]);
  const N = 20_000_000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) evals += evalPos(positions[0]);
  const ns = ((performance.now() - t0) * 1e6) / N;
  check(evals !== -1, 'eval loop ran');
  check(ns < 100, `eval takes ${ns.toFixed(1)}ns/call (gate: <100ns)`);
  console.log(`  evalPos: ${ns.toFixed(2)} ns/call`);
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
if (failures > 0) process.exit(1);
