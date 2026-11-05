import { readFileSync } from 'node:fs';
import { makeMove, newStartPosition, parseFen, Position } from '../src/engine/position';
import { legalMoves } from '../src/engine/movegen';
import { evalNnueWhitePov, loadNnueWeights, nnueNet } from '../src/engine/nnue';
import { nnueWasmActive } from '../src/engine/nnueWasm';

console.log('wasm active:', nnueWasmActive());
loadNnueWeights(new Uint8Array(readFileSync('data/nnue-v1.bin')));
console.log('wasm active after load:', nnueWasmActive());

// Pure-JS reference (the pre-wasm implementation, verbatim)
const IN = 768, QA = 1024, QB = 64, SCALE = 400;
const net = nnueNet()!;
const { h1, h2, w1, b1, w2, w3 } = net;
const featA = new Int32Array(32), featB = new Int32Array(32);
const acc = new Int32Array(h1), act = new Int32Array(2 * h1), l2ref = new Int32Array(h2);
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

// Random-walk parity
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(777);
let checked = 0, bad = 0;
for (let g = 0; g < 25; g++) {
  const pos = newStartPosition();
  for (let ply = 0; ply < 120; ply++) {
    const moves = legalMoves(pos);
    if (moves.length === 0) break;
    const inc = evalNnueWhitePov(pos);          // wasm path (active)
    const ref = evalOldFull(pos);               // pure JS reference
    checked++;
    if (inc !== ref) bad++;
    makeMove(pos, moves[Math.floor(rng() * moves.length)]);
  }
}
console.log(`wasm-vs-JS-reference parity: ${checked} positions, ${bad} mismatches (must be 0)`);
if (bad > 0) process.exit(1);
console.log('OK');
