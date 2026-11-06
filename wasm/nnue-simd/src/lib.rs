//! Chess0 NNUE layer-2/3 in WASM SIMD (wasm32-unknown-unknown, no-bindgen).
//!
//! Mirrors src/engine/nnue.ts exactly — TS and Rust must agree bit-for-bit:
//!   crelu  (act=0, QA=1024): act = clamp(acc, 0, QA)                (i16 lanes)
//!     l2[j]    = Σ_in w2[in][j] * act[in]                           (i32, exact)
//!     y        = Σ_j  w3[j] * clamp(l2[j] >> 6, 0, QA)              (i32, exact)
//!   screlu  (act=1, QA=400): act = clamp(acc, 0, QA)²  (≤ 160_000, i32)
//!     l2[j]    = Σ_in w2[in][j] * act[in]²                          (i32, exact)
//!     y        = Σ_j  w3[j] * clamp(l2[j] / (QB*QA), 0, QA)         (i32, exact)
//!     i32 division truncates toward zero; negative quotients clamp to 0
//!     either way, so this matches the JS `|0` and the Python floor+clip.
//! cp = round(y * SCALE / (QB*QA)) is done on the JS side.
//!
//! SIMD layout: JS writes layer-2 weights TRANSPOSED — w2t[j][i] = w2[i][j]
//! (out-major) — so each output's weights are contiguous. Crelu runs the
//! i16x8 dot instruction over 8 input lanes; screlu squares the clamped
//! activations into an i32 buffer first (act² breaks the i16 lane range),
//! then multiplies per-lane in i32 SIMD — exact, ~2× the crelu inner cost.
//!
//! JS contract (src/engine/nnueWasm.ts):
//!   1. set_dims(h1, h2, act, qa) — validates caps (act: 0=crelu, 1=screlu;
//!      qa = the net's QA clamp bound), returns 0 on success
//!   2. write w2t (h2 × 2h1 i8) at w2t_ptr(), w3 (h2 i8) at w3_ptr()
//!   3. per eval: copy the two h1-wide i32 accumulator slots into acc_ptr()
//!      scratch as [A (h1 i32) | B (h1 i32)], then call eval_l23().
//!
//! No allocation; single-threaded by contract.

#![no_std]

use core::arch::wasm32::*;

// The SIMD path caps dimensions; larger nets use the JS fallback in nnue.ts.
const MAX_H1: usize = 256;
const MAX_H2: usize = 256;
const QB: i32 = 64;

#[repr(align(16))]
struct A16<T, const N: usize>([T; N]);

static mut H1: usize = 0;
static mut H2: usize = 0;
static mut SCRELU: bool = false;
static mut QA: i32 = 1024;
// Transposed layer-2 weights: h2 rows × 2h1 bytes.
static mut W2T: A16<u8, { MAX_H2 * 2 * MAX_H1 }> = A16([0; MAX_H2 * 2 * MAX_H1]);
static mut W3: A16<u8, MAX_H2> = A16([0; MAX_H2]);
static mut ACTS: A16<i16, { 2 * MAX_H1 }> = A16([0; 2 * MAX_H1]);
static mut ACC: A16<i32, { 2 * MAX_H1 }> = A16([0; 2 * MAX_H1]);
// screlu only: squared clamped activations, i32 lanes (act² ≤ 400² = 160_000).
static mut ACT2: A16<i32, { 2 * MAX_H1 }> = A16([0; 2 * MAX_H1]);
// l2 can exceed i32 for screlu (2·h1·125·qa²: h1=256 → 2.56e9 > 2^31), so the
// per-lane SIMD sums (each ≤ (2·h1/16)·125·qa² = 6.4e8 ✓ i32) are reduced
// horizontally in i64 and stored here as i64.
static mut L2OUT: [i64; MAX_H2] = [0; MAX_H2];

#[panic_handler]
fn ph(_: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}

#[no_mangle]
pub unsafe extern "C" fn set_dims(h1: i32, h2: i32, act: i32, qa: i32) -> i32 {
    let (h1, h2) = (h1 as usize, h2 as usize);
    if h1 == 0 || h2 == 0 || h1 > MAX_H1 || h2 > MAX_H2 || h1 % 8 != 0 || h2 % 8 != 0 {
        return -1;
    }
    if act != 0 && act != 1 {
        return -1;
    }
    if qa <= 0 || qa > 32767 {
        return -1;
    }
    H1 = h1;
    H2 = h2;
    SCRELU = act == 1;
    QA = qa;
    0
}

#[no_mangle]
pub unsafe extern "C" fn w2t_ptr() -> *mut u8 {
    let p: *mut A16<u8, { MAX_H2 * 2 * MAX_H1 }> = &raw mut W2T;
    (*p).0.as_mut_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn w3_ptr() -> *mut i8 {
    let p: *mut A16<u8, MAX_H2> = &raw mut W3;
    (*p).0.as_mut_ptr() as *mut i8
}

#[no_mangle]
pub unsafe extern "C" fn acc_ptr() -> *mut i32 {
    let p: *mut A16<i32, { 2 * MAX_H1 }> = &raw mut ACC;
    (*p).0.as_mut_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn l2_ptr() -> *mut i64 {
    L2OUT.as_mut_ptr()
}

/// Layer 2+3 over the scratch accumulators. Returns yRaw (i32, exact).
#[no_mangle]
pub unsafe extern "C" fn eval_l23() -> i32 {
    let h1 = H1;
    let h2 = H2;
    if h1 == 0 {
        return 0;
    }
    let qa = QA;
    let acc: *const i32 = (&raw const ACC) as *const i32;
    let w2t: *const u8 = (&raw const W2T) as *const u8;
    let w3: *const i8 = (&raw const W3) as *const i8;
    let qa_v = i32x4_splat(qa);
    let zero_v = i32x4_splat(0i32);

    // Clamp all 2*h1 accumulator lanes to [0, QA]; crelu narrows to i16
    // lanes, screlu squares into the i32 ACT2 buffer.
    let mut i = 0;
    if SCRELU {
        let act2: *mut i32 = (&raw mut ACT2) as *mut i32;
        while i < 2 * h1 {
            let a0 = v128_load(acc.add(i) as *const v128);
            let a1 = v128_load(acc.add(i + 4) as *const v128);
            let c0 = i32x4_min(i32x4_max(a0, zero_v), qa_v);
            let c1 = i32x4_min(i32x4_max(a1, zero_v), qa_v);
            v128_store(act2.add(i) as *mut v128, i32x4_mul(c0, c0));
            v128_store(act2.add(i + 4) as *mut v128, i32x4_mul(c1, c1));
            i += 8;
        }
    } else {
        let acts: *mut i16 = (&raw mut ACTS) as *mut i16;
        while i < 2 * h1 {
            let a0 = v128_load(acc.add(i) as *const v128);
            let a1 = v128_load(acc.add(i + 4) as *const v128);
            let c0 = i32x4_min(i32x4_max(a0, zero_v), qa_v);
            let c1 = i32x4_min(i32x4_max(a1, zero_v), qa_v);
            v128_store(acts.add(i) as *mut v128, i16x8_narrow_i32x4(c0, c1));
            i += 8;
        }
    }

    let mut y = 0i32;
    for j in 0..h2 {
        let row = w2t.add(j * 2 * h1);
        let mut sum4 = i32x4_splat(0i32);
        if SCRELU {
            // act² broke the i16 lane range, so no dot instruction: extend
            // the 16 i8 weights to four i32x4 vectors and multiply against
            // the squared activations per lane (exact i32).
            let act2: *const i32 = (&raw const ACT2) as *const i32;
            let mut i = 0;
            while i < 2 * h1 {
                let w16 = v128_load(row.add(i) as *const v128);
                let w_lo = i16x8_extend_low_i8x16(w16);
                let w_hi = i16x8_extend_high_i8x16(w16);
                let wa = i32x4_extend_low_i16x8(w_lo);
                let wb = i32x4_extend_high_i16x8(w_lo);
                let wc = i32x4_extend_low_i16x8(w_hi);
                let wd = i32x4_extend_high_i16x8(w_hi);
                let a0 = v128_load(act2.add(i) as *const v128);
                let a1 = v128_load(act2.add(i + 4) as *const v128);
                let a2 = v128_load(act2.add(i + 8) as *const v128);
                let a3 = v128_load(act2.add(i + 12) as *const v128);
                sum4 = i32x4_add(sum4, i32x4_mul(wa, a0));
                sum4 = i32x4_add(sum4, i32x4_mul(wb, a1));
                sum4 = i32x4_add(sum4, i32x4_mul(wc, a2));
                sum4 = i32x4_add(sum4, i32x4_mul(wd, a3));
                i += 16;
            }
        } else {
            let acts: *const i16 = (&raw const ACTS) as *const i16;
            let mut i = 0;
            while i < 2 * h1 {
                // 16 i8 weights → two i16x8 halves → two exact i32 dot products
                // against the matching 16 activation lanes.
                let w16 = v128_load(row.add(i) as *const v128);
                let w_lo = i16x8_extend_low_i8x16(w16);
                let w_hi = i16x8_extend_high_i8x16(w16);
                let a_lo = v128_load(acts.add(i) as *const v128);
                let a_hi = v128_load(acts.add(i + 8) as *const v128);
                sum4 = i32x4_add(sum4, i32x4_dot_i16x8(w_lo, a_lo));
                sum4 = i32x4_add(sum4, i32x4_dot_i16x8(w_hi, a_hi));
                i += 16;
            }
        }
        let l0 = i32x4_extract_lane::<0>(sum4);
        let l1 = i32x4_extract_lane::<1>(sum4);
        let l2s = i32x4_extract_lane::<2>(sum4);
        let l3 = i32x4_extract_lane::<3>(sum4);
        // Per-lane SIMD sums are i32-safe by the set_dims caps: each
        // accumulates (2·h1/16) products of ≤ 125·qa² (h1=256, qa=400 →
        // 6.4e8; qa=1024 → 4.1e6). The HORIZONTAL sum can pass i32 for
        // screlu (2·h1·125·qa² ≤ 2.56e9), so widen before adding.
        let total: i64 = if SCRELU {
            (l0 as i64) + (l1 as i64) + (l2s as i64) + (l3 as i64)
        } else {
            (l0 + l1 + l2s + l3) as i64
        };
        L2OUT[j] = total;
        // crelu: l2 is on the QB scale (>>6); screlu: on the QB×QA scale.
        // i64 division truncates toward zero — negative quotients clamp to 0
        // either way, matching the JS Math.trunc and the Python floor+clip.
        let l2 = if SCRELU {
            ((total / (QB as i64 * qa as i64)).clamp(0, qa as i64)) as i32
        } else {
            ((total >> 6).clamp(0, qa as i64)) as i32
        };
        // i8 read — w3 weights are SIGNED (the u8 read cost a 1-9 incident above)
        y += (*w3.add(j) as i32) * l2;
    }
    y
}
