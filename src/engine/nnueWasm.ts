/**
 * WASM SIMD acceleration for NNUE layer-2/3 (see wasm/nnue-simd/src/lib.rs).
 *
 * JS keeps the incremental accumulator stack (placement-only updates in
 * makeMove stay in TS); per eval the two h1-wide i32 accumulator slots are
 * copied into the module's scratch (~256B) and eval_l23() runs the heavy
 * inner products in wasm SIMD (i32x4_dot_i16x8, exact i32 accumulation).
 *
 * The kernel is bit-exact with the JS path by construction and by test —
 * the nnue test suite exercises whichever path is active. If WebAssembly
 * (or simd128) is unavailable, or the net's dimensions exceed the kernel's
 * caps, every hook returns false/0 and nnue.ts falls back to the JS loop.
 */

import { NNUE_SIMD_WASM_B64 } from './nnueSimdWasmB64';

// Must match wasm/nnue-simd/src/lib.rs caps.
const MAX_H1 = 256;
const MAX_H2 = 256;

interface WasmExports {
  memory: WebAssembly.Memory;
  set_dims(h1: number, h2: number, act: number, qa: number): number;
  w2t_ptr(): number;
  w3_ptr(): number;
  acc_ptr(): number;
  eval_l23(): number;
}

let exports: WasmExports | null = null;
let accView: Int32Array | null = null;

/** One-shot sync init (the module is <1KB — sync compile is fine). */
export function nnueWasmInit(): boolean {
  if (exports !== null) return true;
  if (typeof WebAssembly === 'undefined') return false;
  try {
    const bytes = Uint8Array.from(atob(NNUE_SIMD_WASM_B64), (c) => c.charCodeAt(0));
    const module = new WebAssembly.Module(bytes);
    const instance = new WebAssembly.Instance(module, {});
    const e = instance.exports as unknown as WasmExports;
    if (!e || !e.memory || typeof e.eval_l23 !== 'function' || typeof e.set_dims !== 'function') {
      return false;
    }
    exports = e;
    accView = new Int32Array(e.memory.buffer, e.acc_ptr(), 2 * MAX_H1);
    return true;
  } catch {
    exports = null;
    return false;
  }
}

/** Debug surface: the module's linear memory (weights + scratch + L2OUT). */
export function nnueWasmMemory(): WebAssembly.Memory | null {
  return exports !== null ? exports.memory : null;
}

export function nnueWasmActive(): boolean {
  return exports !== null && accView !== null;
}

/**
 * Writes the net's weights (layer-2 TRANSPOSED to out-major for contiguous
 * dot products), dimensions and activation scheme (act: 0=crelu, 1=screlu;
 * qa = the net's QA clamp bound). Returns false → caller uses the JS path.
 */
export function nnueWasmLoadNet(
  h1: number,
  h2: number,
  w2: Int8Array,
  w3: Int8Array,
  act: 'crelu' | 'screlu',
  qa: number,
): boolean {
  if (!nnueWasmActive() || exports === null) return false;
  if (h1 > MAX_H1 || h2 > MAX_H2 || h1 % 8 !== 0 || h2 % 8 !== 0) return false;
  if (exports.set_dims(h1, h2, act === 'screlu' ? 1 : 0, qa) !== 0) return false;
  const mem = new Uint8Array(exports.memory.buffer);
  const w2tOff = exports.w2t_ptr();
  // transpose: w2 is in-major [(2h1) rows × h2 cols]; w2t is [j][i] out-major
  for (let i = 0; i < 2 * h1; i++) {
    const row = i * h2;
    for (let j = 0; j < h2; j++) {
      mem[w2tOff + j * 2 * h1 + i] = w2[row + j];
    }
  }
  mem.set(w3, exports.w3_ptr());
  return true;
}

/**
 * yRaw (i32, exact) over the two accumulator slots — [A | B] scratch order
 * matches eval_l23's layout in the Rust crate.
 */
export function nnueWasmEvalL23(
  acc: Int32Array,
  offA: number,
  offB: number,
  h1: number,
): number {
  if (exports === null || accView === null) return 0;
  accView.set(acc.subarray(offA, offA + h1), 0);
  accView.set(acc.subarray(offB, offB + h1), h1);
  return exports.eval_l23();
}
