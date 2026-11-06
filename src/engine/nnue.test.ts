/**
 * NNUE incremental-accumulator tests. Requires a quantized net at
 * data/nnue-v1.bin (any architecture — dims are read from the header); the
 * net-dependent file is skipped when the net is absent so CI suites without
 * nets stay green. The synthetic-net tests at the bottom build nets in code
 * and run everywhere: they pin the v1/v2 activation schemes (crelu QA=1024,
 * screlu QA=400) against an inline oracle and regression-test the
 * stale-wasm guard (a net the kernel can't hold must fall back to JS).
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

// ---------------------------------------------------------------------------
// Synthetic-net tests (no net file needed — run everywhere, incl. CI).
// w1 is all zeros so every accumulator equals its b1 bias regardless of the
// position; the expected cp then follows from the documented scheme by plain
// arithmetic below — an oracle independent of the engine's eval path.
// ---------------------------------------------------------------------------

const IN = 768;
const QB = 64;
const SCALE = 400;
const QA_BY_MAGIC: Record<number, number> = { 1: 1024, 2: 400 };

/** Builds a little-endian net blob with the given scheme/dims/biases. */
function buildNetBlob(ver: 1 | 2, h1: number, h2: number, b1: Int16Array, w2: Int8Array, w3: Int8Array): Uint8Array {
  const bytes = new Uint8Array(26 + 2 * IN * h1 * 2 + 2 * h1 * 2 + 2 * h1 * h2 + h2);
  const dv = new DataView(bytes.buffer);
  const magic = `C0NNUE0${ver}`;
  for (let i = 0; i < 8; i++) bytes[i] = magic.charCodeAt(i);
  dv.setUint32(8, IN, true);
  dv.setUint32(12, h1, true);
  dv.setUint32(16, h2, true);
  dv.setInt16(20, QA_BY_MAGIC[ver], true);
  dv.setInt16(22, QB, true);
  dv.setInt16(24, SCALE, true);
  let off = 26;
  off += 2 * IN * h1 * 2; // w1 stays zero
  for (let i = 0; i < 2 * h1; i++, off += 2) dv.setInt16(off, b1[i], true);
  bytes.set(w2, off);
  off += 2 * h1 * h2;
  bytes.set(w3, off);
  return bytes;
}

/** Expected white-POV cp for a w1=0 net from the scheme spec, startpos (white). */
function oracleCp(ver: 1 | 2, h1: number, h2: number, b1: Int16Array, w2: Int8Array, w3: Int8Array): number {
  const qa = QA_BY_MAGIC[ver];
  const act = (acc: number): number => {
    const c = acc < 0 ? 0 : acc > qa ? qa : acc;
    return ver === 2 ? c * c : c;
  };
  let y = 0;
  for (let j = 0; j < h2; j++) {
    let l2 = 0;
    for (let i = 0; i < h1; i++) l2 += w2[i * h2 + j] * act(b1[i]);
    for (let i = 0; i < h1; i++) l2 += w2[(h1 + i) * h2 + j] * act(b1[h1 + i]);
    const la = ver === 2
      ? Math.trunc(l2 / (QB * qa))
      : l2 >> 6;
    const clamped = la < 0 ? 0 : la > qa ? qa : la;
    y += w3[j] * clamped;
  }
  return Math.round((y * SCALE) / (QB * qa));
}

/** Small deterministic weights that exercise clamps and signs. */
function syntheticWeights(h1: number, h2: number): { b1: Int16Array; w2: Int8Array; w3: Int8Array } {
  // Biases straddle every clamp boundary: negative, zero, mid, at-QA, over-QA.
  const b1 = new Int16Array(2 * h1);
  const biasVals = [-7, 0, 3, 300, 400, 500, 1024, 2000];
  for (let i = 0; i < 2 * h1; i++) b1[i] = biasVals[i % biasVals.length];
  const w2 = new Int8Array(2 * h1 * h2);
  for (let i = 0; i < w2.length; i++) w2[i] = ((i * 37) % 13) - 6; // -6..6, sign mix
  const w3 = new Int8Array(h2);
  for (let j = 0; j < h2; j++) w3[j] = j % 2 === 0 ? 3 : -4;
  return { b1, w2, w3 };
}

test('synthetic v1 crelu net matches the scheme oracle', () => {
  const h1 = 8;
  const h2 = 8;
  const { b1, w2, w3 } = syntheticWeights(h1, h2);
  const desc = loadNnueWeights(buildNetBlob(1, h1, h2, b1, w2, w3));
  assert.ok(desc.includes('crelu'), desc);
  assert.equal(evalNnueWhitePov(newStartPosition()), oracleCp(1, h1, h2, b1, w2, w3));
});

test('synthetic v2 screlu net matches the scheme oracle', () => {
  const h1 = 8;
  const h2 = 8;
  const { b1, w2, w3 } = syntheticWeights(h1, h2);
  const desc = loadNnueWeights(buildNetBlob(2, h1, h2, b1, w2, w3));
  assert.ok(desc.includes('screlu'), desc);
  assert.equal(evalNnueWhitePov(newStartPosition()), oracleCp(2, h1, h2, b1, w2, w3));
});

test('screlu and crelu schemes actually diverge on the same biases', () => {
  // Guards against a v2 loader silently taking the v1 branch (or vice versa):
  // the squared activation must change the result for these bias values.
  const h1 = 8;
  const h2 = 8;
  const { b1, w2, w3 } = syntheticWeights(h1, h2);
  loadNnueWeights(buildNetBlob(1, h1, h2, b1, w2, w3));
  const crelu = evalNnueWhitePov(newStartPosition());
  loadNnueWeights(buildNetBlob(2, h1, h2, b1, w2, w3));
  const screlu = evalNnueWhitePov(newStartPosition());
  assert.notEqual(crelu, screlu);
});

test('net loader rejects a QA that does not match the magic scheme', () => {
  const h1 = 8;
  const h2 = 8;
  const { b1, w2, w3 } = syntheticWeights(h1, h2);
  const blob = buildNetBlob(2, h1, h2, b1, w2, w3);
  new DataView(blob.buffer).setInt16(20, 1024, true); // screlu magic, v1 QA
  assert.throws(() => loadNnueWeights(blob), /header mismatch/);
  const blob2 = buildNetBlob(1, h1, h2, b1, w2, w3);
  new DataView(blob2.buffer).setInt16(20, 400, true); // crelu magic, v2 QA
  assert.throws(() => loadNnueWeights(blob2), /header mismatch/);
});

test('net too wide for the wasm kernel falls back to JS and still matches', () => {
  // h1=264 exceeds the kernel's MAX_H1=256: nnueWasmLoadNet must refuse, and
  // the eval must route through the JS loop (regression for the stale-wasm
  // guard — previously a failed load silently kept the PREVIOUS net's
  // weights in the module).
  const h1 = 264;
  const h2 = 8;
  const { b1, w2, w3 } = syntheticWeights(h1, h2);
  loadNnueWeights(buildNetBlob(2, h1, h2, b1, w2, w3));
  assert.equal(evalNnueWhitePov(newStartPosition()), oracleCp(2, h1, h2, b1, w2, w3));
});

test('crelu JS fallback path matches the oracle too', () => {
  // h2=12 is not a multiple of 8, so the wasm kernel refuses the net and the
  // eval must run the plain-JS loop — otherwise the crelu JS path is only
  // ever covered on wasm-less machines.
  const h1 = 8;
  const h2 = 12;
  const { b1, w2, w3 } = syntheticWeights(h1, h2);
  loadNnueWeights(buildNetBlob(1, h1, h2, b1, w2, w3));
  assert.equal(evalNnueWhitePov(newStartPosition()), oracleCp(1, h1, h2, b1, w2, w3));
});
