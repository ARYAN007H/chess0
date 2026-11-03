/**
 * NNUE inference — 768×32×2 → 32 → 1, fully-quantized (int16/int8).
 *
 * Architecture (must match training/nnue_train.py exactly):
 *   - Input: 768 = 12 piece-types × 64 squares, computed from the side to
 *     move's perspective (own pieces types 0-5, opponent 6-11; board flipped
 *     when black is to move). Two views: stm-view and opponent-view.
 *   - Layer 1: per-view accumulator = b1 + Σ w1[feature] over the ~32 active
 *     features (int16 weights × QA=1024 scale).
 *   - ClippedReLU: clamp accumulator to [0, QA].
 *   - Layer 2: 2×H1 → H2 int8 weights × QB=64, then >>6 and clamp to [0, QA].
 *   - Layer 3: H2 → 1 int8 weights; cp = y × SCALE / (QB×QA) with SCALE=400.
 *
 * Weight file layout (`data/nnue-v1.bin`, little-endian):
 *   magic "C0NNUE01" (8B) | u32 IN | u32 H1 | u32 H2 | i16 QA | i16 QB |
 *   i16 SCALE | w1 i16[2×768×H1] (view→feature→row, feature-major for cache) |
 *   b1 i16[2×H1] | w2 i8[2×H1×H2] (in-major) | w3 i8[H2]
 *
 * The feature extraction and every quantization step are mirrored in
 * nnue_train.py; a mismatch between the two silently produces a bad net, so
 * both files carry the same spec block and the trainer prints reference evals
 * for cross-checking.
 */

import type { Position } from './position';
import { WHITE } from './types';

const IN = 768;
const QA = 1024;
const QB = 64;
const SCALE = 400;

const MAGIC = [0x43, 0x30, 0x4e, 0x4e, 0x55, 0x45, 0x30, 0x31]; // "C0NNUE01"

interface NnueNet {
  h1: number;
  h2: number;
  w1: Int16Array; // 2 * h1 * 768 (view-major)
  b1: Int16Array; // 2 * h1
  w2: Int8Array; // (2 * h1) * h2 (in-major)
  w3: Int8Array; // h2
}

let net: NnueNet | null = null;

// Module-level scratch (allocated on load) — zero allocation per eval.
let act = new Int32Array(0);
let acc = new Int32Array(0);
let l2 = new Int32Array(0);

/** Loads a quantized net from bytes; returns a description or throws. */
export function loadNnueWeights(bytes: Uint8Array): string {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== MAGIC[i]) throw new Error('nnue: bad magic');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const inp = dv.getUint32(8, true);
  const h1 = dv.getUint32(12, true);
  const h2 = dv.getUint32(16, true);
  const qa = dv.getInt16(20, true);
  const qb = dv.getInt16(22, true);
  const scale = dv.getInt16(24, true);
  if (inp !== IN || qa !== QA || qb !== QB || scale !== SCALE) {
    throw new Error(`nnue: header mismatch (in=${inp} qa=${qa} qb=${qb} scale=${scale})`);
  }
  let off = 26;
  const w1Len = 2 * h1 * IN;
  const w1 = new Int16Array(w1Len);
  for (let i = 0; i < w1Len; i++, off += 2) w1[i] = dv.getInt16(off, true);
  const b1 = new Int16Array(2 * h1);
  for (let i = 0; i < 2 * h1; i++, off += 2) b1[i] = dv.getInt16(off, true);
  const w2Len = 2 * h1 * h2;
  const w2 = new Int8Array(w2Len);
  for (let i = 0; i < w2Len; i++, off += 1) w2[i] = dv.getInt8(off);
  const w3 = new Int8Array(h2);
  for (let i = 0; i < h2; i++, off += 1) w3[i] = dv.getInt8(off);
  net = { h1, h2, w1, b1, w2, w3 };
  act = new Int32Array(2 * h1);
  acc = new Int32Array(h1);
  l2 = new Int32Array(h2);
  return `nnue: loaded net (768×${h1}×2→${h2}→1, ${(bytes.length / 1024).toFixed(0)}KB)`;
}

export function nnueLoaded(): boolean {
  return net !== null;
}

export function clearNnue(): void {
  net = null;
}

// Feature extraction: both views' feature ids for the ≤32 occupied squares.
const featA = new Int32Array(32);
const featB = new Int32Array(32);

function extractFeatures(pos: Position): number {
  let n = 0;
  const blackView = pos.stm === 1;
  for (let s64 = 0; s64 < 64; s64++) {
    const p = pos.board[((s64 >> 3) << 4) | (s64 & 7)];
    if (p === 0) continue;
    const isWhite = p > 0;
    const type = isWhite ? p - 1 : -p - 1; // 0..5
    const ownA = isWhite === (pos.stm === 0);
    const sqA = blackView ? s64 ^ 56 : s64;
    featA[n] = (ownA ? type : type + 6) * 64 + sqA;
    featB[n] = (ownA ? type + 6 : type) * 64 + (sqA ^ 56);
    n++;
  }
  return n;
}

/**
 * White-point-of-view evaluation in centipawns (tempo excluded — the caller
 * in searchV3 applies tempo the same way it does for evalV3).
 */
export function evalNnueWhitePov(pos: Position): number {
  const n = extractFeatures(pos);
  if (net === null) return 0;
  const { h1, h2, w1, b1, w2, w3 } = net;

  // Layer 1: two accumulators (int32-safe: 32 features × ≤31129).
  let l2out = 0;
  let yRaw = 0;
  for (let v = 0; v < 2; v++) {
    const feats = v === 0 ? featA : featB;
    for (let i = 0; i < h1; i++) acc[i] = b1[v * h1 + i];
    for (let f = 0; f < n; f++) {
      // w1 layout is [view][feature][row] — contiguous per feature.
      const base = v * IN * h1 + feats[f] * h1;
      for (let i = 0; i < h1; i++) acc[i] += w1[base + i];
    }
    for (let i = 0; i < h1; i++) {
      const a = acc[i] < 0 ? 0 : acc[i] > QA ? QA : acc[i];
      act[v * h1 + i] = a;
    }
  }

  // Layer 2 + 3 fused pass (int32-safe: ≤64×127×1024 ≈ 8.3M).
  l2.fill(0); // scratch is reused across evals — must be re-zeroed (the old
              // per-eval `new Int32Array` doubled as initialization)
  for (let inp = 0; inp < 2 * h1; inp++) {
    const a = act[inp];
    if (a === 0) continue;
    const w2base = inp * h2;
    for (let j = 0; j < h2; j++) l2[j] += w2[w2base + j] * a;
  }
  for (let j = 0; j < h2; j++) {
    const a = l2[j] >> 6; // /QB
    const clamped = a < 0 ? 0 : a > QA ? QA : a;
    l2out += w3[j] * clamped;
  }
  yRaw = l2out;

  // cp (stm POV): y × SCALE / (QB × QA); yRaw×400 ≤ 1.7e9 < 2^31 ✓
  const cpStm = Math.round((yRaw * SCALE) / (QB * QA));
  return pos.stm === WHITE ? cpStm : -cpStm;
}
