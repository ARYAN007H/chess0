/**
 * Zobrist hashing: two independent 32-bit halves (Lo, Hi) per feature.
 * 32-bit index + 32-bit verification gives an effective 64-bit key while
 * staying in plain int32 XOR arithmetic.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) | 0;
  };
}

const rnd = mulberry32(0x0badf00d);

function makeTable(size: number): { lo: Int32Array; hi: Int32Array } {
  const lo = new Int32Array(size);
  const hi = new Int32Array(size);
  for (let i = 0; i < size; i++) {
    lo[i] = rnd() | 0;
    hi[i] = rnd() | 0;
  }
  return { lo, hi };
}

/** 12 piece indices (white P..K then black P..K) x 128 squares. */
export const Z_PIECE_LO = makeTable(12 * 128).lo;
export const Z_PIECE_HI = makeTable(12 * 128).hi;

/** 16 possible castling-right combinations. */
export const Z_CASTLE_LO = makeTable(16).lo;
export const Z_CASTLE_HI = makeTable(16).hi;

/** En-passant target squares (only hashed when a capture is possible). */
export const Z_EP_LO = makeTable(128).lo;
export const Z_EP_HI = makeTable(128).hi;

export const Z_STM_LO = rnd() | 0;
export const Z_STM_HI = rnd() | 0;
