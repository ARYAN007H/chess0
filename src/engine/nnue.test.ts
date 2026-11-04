/**
 * NNUE incremental-accumulator tests. Requires a quantized net at
 * data/nnue-v1.bin (any architecture — dims are read from the header); the
 * whole file is skipped when the net is absent so CI suites without nets
 * stay green.
 *
 * The core invariant: evalNnueWhitePov reads layer 1 from a per-ply stack
 * maintained by makeMove/makeNullMove (placement-only updates). It must
 * equal a full from-scratch recompute at every reachable position, survive
 * unmake round-trips, and stay correct through mid-line lazy refreshes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Position, makeMove, makeNullMove, newStartPosition, parseFen, toFen, unmakeMove, unmakeNullMove } from './position';
import { legalMoves } from './movegen';
import { evalNnueWhitePov, loadNnueWeights } from './nnue';
import { moveTo, moveFrom } from './types';

const NET_PATH = 'data/nnue-v1.bin';

/** Deterministic RNG so failures reproduce. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Full from-scratch eval: a clone starts with a null stack, so its first
 *  eval recomputes the accumulator from the board. */
function evalFullRecompute(pos: Position): number {
  return evalNnueWhitePov(pos.clone());
}

/** Plays `games` random games up to `maxPlies`, invoking `visit(pos, game, ply)`. */
function randomGames(
  seed: number,
  games: number,
  maxPlies: number,
  visit: (pos: Position, game: number, ply: number) => void,
): void {
  const rng = mulberry32(seed);
  for (let g = 0; g < games; g++) {
    const pos = newStartPosition();
    for (let ply = 0; ply < maxPlies; ply++) {
      const moves = legalMoves(pos);
      if (moves.length === 0) break;
      const pick = moves[Math.floor(rng() * moves.length)];
      visit(pos, g, ply);
      makeMove(pos, pick);
      if (ply === maxPlies - 1) visit(pos, g, ply + 1);
    }
  }
}

test('nnue incremental accumulator matches full recompute across random games', { skip: !existsSync(NET_PATH) ? 'no net at ' + NET_PATH : false }, () => {
  loadNnueWeights(new Uint8Array(readFileSync(NET_PATH)));
  let checked = 0;
  let mismatch: string | null = null;
  randomGames(20260917, 30, 80, (pos, g, ply) => {
    const inc = evalNnueWhitePov(pos);
    const full = evalFullRecompute(pos);
    checked++;
    if (inc !== full && mismatch === null) {
      mismatch = `game ${g} ply ${ply}: incremental ${inc} != full ${full}`;
    }
  });
  assert.ok(checked > 1000, `too few positions checked (${checked})`);
  assert.equal(mismatch, null, mismatch ?? undefined);
});

test('nnue accumulators survive make/unmake round-trips', { skip: !existsSync(NET_PATH) ? 'no net at ' + NET_PATH : false }, () => {
  loadNnueWeights(new Uint8Array(readFileSync(NET_PATH)));
  const rng = mulberry32(424242);
  for (let g = 0; g < 10; g++) {
    const pos = newStartPosition();
    const evals: number[] = [];
    const moves: number[] = [];
    for (let ply = 0; ply < 60; ply++) {
      const legal = legalMoves(pos);
      if (legal.length === 0) break;
      evals.push(evalNnueWhitePov(pos));
      const m = legal[Math.floor(rng() * legal.length)];
      moves.push(m);
      makeMove(pos, m);
    }
    // Walk back to the start: every ply's eval must be exactly what it was.
    for (let p = moves.length - 1; p >= 0; p--) {
      unmakeMove(pos, moves[p]);
      assert.equal(evalNnueWhitePov(pos), evals[p], `game ${g} unmake to ply ${p}`);
    }
  }
});

test('nnue accumulators handle clones, below-watermark unpicking and null moves', { skip: !existsSync(NET_PATH) ? 'no net at ' + NET_PATH : false }, () => {
  loadNnueWeights(new Uint8Array(readFileSync(NET_PATH)));
  const rng = mulberry32(777);
  const pos = newStartPosition();
  // Play 40 random moves (the stack bootstraps on the first makeMove).
  const played: number[] = [];
  for (let i = 0; i < 40; i++) {
    const legal = legalMoves(pos);
    if (legal.length === 0) break;
    const m = legal[Math.floor(rng() * legal.length)];
    played.push(m);
    makeMove(pos, m);
  }
  assert.equal(evalNnueWhitePov(pos), evalFullRecompute(pos), 'deep live-stack eval');
  // Clone mid-game: the clone has NO stack (lazy) but ply=40. Making a move
  // on it bootstraps at ply 40; shallower slots of the CLONE hold garbage.
  const branched = pos.clone();
  {
    const legal = legalMoves(branched);
    makeMove(branched, legal[Math.floor(rng() * legal.length)]);
    assert.equal(evalNnueWhitePov(branched), evalFullRecompute(branched), 'clone bootstrap eval');
  }
  // Unmake BELOW the clone's bootstrap point (ply 40) down to ply 35: evals
  // must route through the scratch recompute, and re-branching from ply 37
  // must re-bootstrap without reading stale slots.
  for (let i = 0; i < 5; i++) unmakeMove(branched, played.pop()!);
  assert.equal(evalNnueWhitePov(branched), evalFullRecompute(branched), 'below-watermark eval');
  for (let i = 0; i < 3; i++) {
    const legal = legalMoves(branched);
    makeMove(branched, legal[Math.floor(rng() * legal.length)]);
  }
  assert.equal(evalNnueWhitePov(branched), evalFullRecompute(branched), 're-branch eval');
  // Null-move round trip on the long-lived position: eval after unmakeNull
  // must restore exactly.
  const before = evalNnueWhitePov(pos);
  makeNullMove(pos);
  const duringNull = evalNnueWhitePov(pos); // may legitimately differ (stm flip)
  void duringNull;
  unmakeNullMove(pos);
  assert.equal(evalNnueWhitePov(pos), before, 'null-move round trip');
});

test('nnue stack invalidates on parseFen of a REUSED position (Engine.reset path)', { skip: !existsSync(NET_PATH) ? 'no net at ' + NET_PATH : false }, () => {
  loadNnueWeights(new Uint8Array(readFileSync(NET_PATH)));
  const rng = mulberry32(31337);
  // Reproduce the match.ts flow: one Position object, reset() re-parses a
  // new game FEN every move while the module-level search bootstraps stacks
  // on it. A stale slot 0 here poisoned every root eval (the 1-9 bisect).
  const pos = newStartPosition();
  for (let game = 0; game < 20; game++) {
    // Play a random opening on a throwaway board to produce a mid-game FEN.
    const gen = newStartPosition();
    const plies = 1 + Math.floor(rng() * 12);
    for (let p = 0; p < plies; p++) {
      const legal = legalMoves(gen);
      if (legal.length === 0) break;
      makeMove(gen, legal[Math.floor(rng() * legal.length)]);
    }
    const fen = toFen(gen);
    // reset path: parse a DIFFERENT position onto the reused object, then
    // search-style make/unmake must evaluate exactly.
    parseFen(pos, fen);
    const rootEval = evalNnueWhitePov(pos);
    assert.equal(rootEval, evalFullRecompute(pos), `game ${game} root eval after re-parse`);
    const legal = legalMoves(pos);
    for (let t = 0; t < Math.min(6, legal.length); t++) {
      const m = legal[t];
      makeMove(pos, m);
      assert.equal(evalNnueWhitePov(pos), evalFullRecompute(pos), `game ${game} child ${t}`);
      unmakeMove(pos, m);
      assert.equal(evalNnueWhitePov(pos), rootEval, `game ${game} unmake back to root ${t}`);
    }
  }
});

test('nnue castling/ep/promotion positions eval identically to recompute', { skip: !existsSync(NET_PATH) ? 'no net at ' + NET_PATH : false }, () => {
  loadNnueWeights(new Uint8Array(readFileSync(NET_PATH)));
  // Positions that force the multi-piece accumulator updates: castling
  // (king + rook rows), en passant (pawn vanishing off-line), promotions.
  const tricky: Array<[string, string]> = [
    ['castle-white', 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'],
    ['castle-black', 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1'],
    ['ep-white', 'rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 2'],
    ['ep-black', 'rnbqkbnr/pppppppp/8/8/8/4P3/PPPP1PPP/RNBQKBNR b KQkq - 0 1'],
    ['promo-rank', '2K5/1P6/8/8/8/8/6k1/8 w - - 0 1'],
    ['promo-capture', '1K6/1P1q4/8/8/8/8/6k1/8 w - - 0 1'],
    ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'],
  ];
  for (const [name, fen] of tricky) {
    const pos = newStartPosition();
    parseFen(pos, fen);
    assert.equal(evalNnueWhitePov(pos), evalFullRecompute(pos), `${name} (static)`);
    // Play every legal move; each successor must also match.
    const legal = legalMoves(pos);
    for (let i = 0; i < legal.length; i++) {
      const m = legal[i];
      const from = moveFrom(m);
      const to = moveTo(m);
      makeMove(pos, m);
      assert.equal(
        evalNnueWhitePov(pos),
        evalFullRecompute(pos),
        `${name} after ${from}->${to}`,
      );
      unmakeMove(pos, m);
    }
  }
});
