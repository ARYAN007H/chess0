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
 *
 * INCREMENTAL ACCUMULATORS: layer 1 is kept incrementally on the Position as
 * a per-ply stack (`pos.nnueStack`). Because the two trained views use
 * INDEPENDENT weight tensors (w1[0] = stm-view, w1[1] = opponent-view), the
 * stack holds FOUR H1-wide accumulators per ply — white-perspective and
 * black-perspective placements, each under both weight tables:
 *   slot layout: [V0W | V0B | V1W | V1B]
 * where VnX = b1[n] + Σ w1[n][featureX]. Which two are read at eval time
 * depends only on stm: stm=white reads (V0W, V1B); stm=black reads (V0B,
 * V1W). The accumulators are functions of the piece PLACEMENT alone — stm,
 * castling and ep never enter — so makeMove updates ≤5 feature rows per
 * accumulator and unmakeMove is a pure pointer decrement.
 */

import type { Position } from './position';
import { MAX_HIST, WHITE } from './types';

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

// Bumped on every (re)load/clear. Positions stamp their accumulator stack
// against it; a mismatch forces a full refresh before the next eval. This is
// what makes net swaps safe without walking live Positions.
let loadStamp = 0;

// Module-level scratch (allocated on load) — zero allocation per eval.
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
  if (h1 < 1 || h1 > 8192 || h2 < 1 || h2 > 8192) {
    throw new Error(`nnue: implausible dims h1=${h1} h2=${h2}`);
  }
  const expected = 26 + 2 * h1 * IN * 2 + 2 * h1 * 2 + 2 * h1 * h2 + h2;
  if (bytes.length !== expected) {
    throw new Error(`nnue: file size ${bytes.length} != expected ${expected} for h1=${h1} h2=${h2}`);
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
  l2 = new Int32Array(h2);
  loadStamp++;
  return `nnue: loaded net (768×${h1}×2→${h2}→1, ${(bytes.length / 1024).toFixed(0)}KB)`;
}

export function nnueLoaded(): boolean {
  return net !== null;
}

/** Read-only view of the loaded net (for benchmark/reference tooling). */
export interface NnueNetView {
  h1: number;
  h2: number;
  w1: Int16Array;
  b1: Int16Array;
  w2: Int8Array;
  w3: Int8Array;
}
export function nnueNet(): NnueNetView | null {
  return net;
}

export function clearNnue(): void {
  net = null;
  loadStamp++;
}

// ---------------------------------------------------------------------------
// Incremental accumulator stack (owned by Position, maintained by makeMove)
// ---------------------------------------------------------------------------
// Two buffer tiers keep memory flat without giving up incrementality:
//   1. A shared module-level SCRATCH slot (4×H1 ints) for transient evals —
//      positions without a live stack evaluate via a full recompute into the
//      scratch (never allocating anything). FEN-then-eval scripts stay 0 MB.
//   2. A per-Position stack (MAX_HIST slots), allocated only when a position
//      actually makes moves with a net loaded (nnueAccPush bootstraps it).
//      Search roots are the only long-lived instances (~1MB each at H1=32).
// The stack is placement-only: makeMove updates ≤5 feature rows per
// accumulator at slot ply+1; unmakeMove is a pointer decrement. nnueValidFrom
// is the lowest ply holding valid data (a mid-line refresh leaves shallower
// slots stale); pushes below it re-refresh instead of copying garbage.

let scratch = new Int32Array(0); // 4*h1, single shared slot (see tier 1)

/** True when pos carries a live stack for the currently-loaded net at ply. */
function stackLive(pos: Position): boolean {
  return (
    pos.nnueStack !== null &&
    pos.nnueStamp === loadStamp &&
    net !== null &&
    pos.ply >= pos.nnueValidFrom &&
    pos.ply + 1 < MAX_HIST
  );
}

/**
 * Copies the accumulator slot at `pos.ply` to `pos.ply + 1`, so makeMove's
 * feature deltas land on a fresh slot and unmakeMove stays a pure pointer
 * decrement. Bootstraps (allocates + fully recomputes slot ply) when the
 * position has no live stack — this is the ONLY place a Position's stack is
 * allocated. No-op when no net is loaded.
 */
export function nnueAccPush(pos: Position): void {
  const n = net;
  if (n === null) return;
  const h1 = n.h1;
  if (pos.ply + 1 >= MAX_HIST) return; // beyond the engine's history cap
  if (!stackLive(pos)) {
    // Bootstrap: allocate (or reuse) the stack and recompute slot `ply`.
    const need = MAX_HIST * 4 * h1;
    if (pos.nnueStack === null || pos.nnueStack.length !== need) {
      pos.nnueStack = new Int32Array(need);
    }
    refreshSlot(pos, n, pos.nnueStack, pos.ply);
  }
  const w = 4 * h1;
  const src = pos.ply * w;
  pos.nnueStack!.copyWithin(src + w, src, src + w);
}

/** Applies ±w1 rows for one piece to all four accumulators at `slot` of `into`. */
function accDelta(into: Int32Array, slot: number, n: NnueNet, piece: number, sq: number, sign: number): void {
  const h1 = n.h1;
  const s64 = ((sq >> 4) << 3) | (sq & 7);
  const type = (piece < 0 ? -piece : piece) - 1;
  const isWhite = piece > 0;
  // Perspective feature ids (mirror the trainer's `_features_from_codes`):
  // white view keeps white-oriented squares; black view flips vertically.
  const fW = (isWhite ? type : type + 6) * 64 + s64;
  const fB = (isWhite ? type + 6 : type) * 64 + (s64 ^ 56);
  const w1 = n.w1;
  // w1 layout [view][feature][row], view stride 768*h1 — rows are contiguous.
  const r0W = fW * h1;
  const r0B = fB * h1;
  const r1W = (IN + fW) * h1;
  const r1B = (IN + fB) * h1;
  const base = slot * 4 * h1;
  const b0 = base;
  const b1 = base + h1;
  const b2 = base + 2 * h1;
  const b3 = base + 3 * h1;
  for (let i = 0; i < h1; i++) {
    into[b0 + i] += sign * w1[r0W + i];
    into[b1 + i] += sign * w1[r0B + i];
    into[b2 + i] += sign * w1[r1W + i];
    into[b3 + i] += sign * w1[r1B + i];
  }
}

/**
 * Full recompute of the four accumulators at `slot` of `into` from pos.board.
 * Marks the position's stack valid at `pos.ply` when writing to it.
 */
function refreshSlot(pos: Position, n: NnueNet, into: Int32Array, slot: number): void {
  const h1 = n.h1;
  const slotBase = slot * 4 * h1;
  const { b1 } = n;
  // b1 is view-major: both V0 accumulators start at b1[0], both V1 at b1[h1].
  for (let i = 0; i < h1; i++) {
    into[slotBase + i] = b1[i];
    into[slotBase + h1 + i] = b1[i];
    into[slotBase + 2 * h1 + i] = b1[h1 + i];
    into[slotBase + 3 * h1 + i] = b1[h1 + i];
  }
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const piece = pos.board[sq];
    if (piece === 0) continue;
    accDelta(into, slot, n, piece, sq, 1);
  }
  if (into === pos.nnueStack) {
    pos.nnueStamp = loadStamp;
    pos.nnueValidFrom = slot;
  }
}

/**
 * Adds a piece's feature rows to the accumulators at `slot` (makeMove side
 * effects — the slot push already happened via nnueAccPush).
 */
export function nnueAccAdd(pos: Position, slot: number, piece: number, sq: number): void {
  if (!stackLive(pos)) return;
  accDelta(pos.nnueStack!, slot, net!, piece, sq, 1);
}

/** Removes a piece's feature rows from the accumulators at `slot`. */
export function nnueAccRemove(pos: Position, slot: number, piece: number, sq: number): void {
  if (!stackLive(pos)) return;
  accDelta(pos.nnueStack!, slot, net!, piece, sq, -1);
}

/**
 * White-point-of-view evaluation in centipawns (tempo excluded — the caller
 * in searchV3 applies tempo the same way it does for evalV3). Reads layer 1
 * from the position's incremental stack when live at this ply, else from a
 * full recompute into the shared scratch (no allocation).
 */
export function evalNnueWhitePov(pos: Position): number {
  const n = net;
  if (n === null) return 0;
  const { h1, h2, w2, w3 } = n;
  const white = pos.stm === WHITE;
  // Pick the accumulator source: live stack slot, or a scratch recompute.
  let buf: Int32Array;
  let base: number;
  if (
    pos.nnueStack !== null &&
    pos.nnueStamp === loadStamp &&
    pos.ply >= pos.nnueValidFrom &&
    pos.ply < MAX_HIST
  ) {
    buf = pos.nnueStack;
    base = pos.ply * 4 * h1;
  } else {
    if (scratch.length !== 4 * h1) scratch = new Int32Array(4 * h1);
    refreshSlot(pos, n, scratch, 0);
    buf = scratch;
    base = 0;
  }
  // View 0 (stm): white-persp accumulator under view-0 weights when white
  // moves, black-persp otherwise. View 1 (opponent): the complementary
  // perspective under the view-1 weights. Slot layout [V0W|V0B|V1W|V1B].
  const off0 = white ? base : base + h1;
  const off1 = white ? base + 3 * h1 : base + 2 * h1;

  // Layers 2+3 fused, ClippedReLU applied inline while reading the buffer
  // (int32-safe: ≤64×127×1024 ≈ 8.3M).
  l2.fill(0); // scratch is reused across evals — must be re-zeroed
  for (let i = 0; i < h1; i++) {
    let a = buf[off0 + i];
    if (a <= 0) continue; // negative clamps to 0 → no contribution
    if (a > QA) a = QA;
    const w2base = i * h2;
    for (let j = 0; j < h2; j++) l2[j] += w2[w2base + j] * a;
  }
  for (let i = 0; i < h1; i++) {
    let a = buf[off1 + i];
    if (a <= 0) continue;
    if (a > QA) a = QA;
    const w2base = (h1 + i) * h2;
    for (let j = 0; j < h2; j++) l2[j] += w2[w2base + j] * a;
  }
  let yRaw = 0;
  for (let j = 0; j < h2; j++) {
    const a = l2[j] >> 6; // /QB
    const clamped = a < 0 ? 0 : a > QA ? QA : a;
    yRaw += w3[j] * clamped;
  }

  // cp (stm POV): y × SCALE / (QB × QA); yRaw×400 ≤ 1.7e9 < 2^31 ✓
  const cpStm = Math.round((yRaw * SCALE) / (QB * QA));
  return white ? cpStm : -cpStm;
}
