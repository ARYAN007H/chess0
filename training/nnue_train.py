"""
Chess0 NNUE trainer — 768×32×2 → 32 → 1, quantized export.

Reads the binary data produced by scripts/gen-nnue-data.ts (36-byte records),
trains a small half-perspective network with AdamW, and exports the quantized
weight file consumed by src/engine/nnue.ts.

DATA RECORD (36 bytes, little-endian) — spec mirrored from the TS generator:
  byte 0:      stm (0 white, 1 black)
  bytes 1-32:  64 nibbles (square 0..63, WHITE view, a1=0..h8=63);
               even s64 → low nibble, odd s64 → high nibble;
               nibble 0..5 = white P N B R Q K, 6..11 = black p..k, 15 = empty
  bytes 33-34: int16 LE label (search score cp, STM POV, clamped ±3200)
  byte 35:     result from STM POV (0 loss, 1 draw, 2 win)
File: magic "NDD1" | u32 LE count | records.

FEATURES (must mirror src/engine/nnue.ts exactly):
  view A (side to move): for each piece — type = code % 6 (0..5);
    ownA = (code < 6) == (stm == 0);
    sqA  = s64 if stm == 0 else (s64 ^ 56);   # board flips for black
    featureA = (type + (0 if ownA else 6)) * 64 + sqA
  view B (opponent): roles swapped, board flipped the other way:
    featureB = (type + (6 if ownA else 0)) * 64 + (sqA ^ 56)

QUANTIZATION (must mirror src/engine/nnue.ts exactly):
  L1: w1q = round(clip(w, ±0.95) * QA), int16  (accumulator-safe)
  L2: w2q = round(clip(w, ±1.95) * QB), QB=64,   int8
  L3: w3q = round(clip(w, ±1.95) * QB),          int8
  forward (integer, crelu): act=clamp(acc,0,QA); l2act=clamp(l2>>6,0,QA);
  forward (integer, screlu): act=clamp(acc,0,QA)**2;
                             l2act=clamp(l2//(QB*QA),0,QA);
  cp = round(y_raw * SCALE / (QB*QA)), SCALE=400  (y in "w3 units" ≈ cp/400)
  Two schemes, flagged by the file magic:
    C0NNUE01 = v1 crelu,    QA=1024
    C0NNUE02 = v2 screlu,   QA=400  (act^2 ≤ QA^2; l2 sums stay in i32:
                              64 * 124 * 400^2 ≈ 1.27e9 < 2^31)
  Weight file w1 is written FEATURE-MAJOR [view][feature][row] — the TS
  inference loop is contiguous per feature; L2 is written in-major [in][out].

Usage (Kaggle GPU or CPU):
  python nnue_train.py --data nnue-data.bin --out nnue-v1.bin \
      --epochs 8 --batch 16384 --lr 1e-3
"""

import argparse
import json
import math
import os

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

IN = 768
QB = 64
SCALE = 400
ACT = "crelu"  # "crelu" (v1, QA=1024) | "screlu" (v2, QA=400) — set by main()
QA = 1024

MAGIC = {"crelu": b"C0NNUE01", "screlu": b"C0NNUE02"}
QA_BY_ACT = {"crelu": 1024, "screlu": 400}


def set_activation(act: str):
    """Select the quant scheme before training/quantizing (script = one run
    per process, so module globals are the honest way to carry this)."""
    global ACT, QA
    ACT = act
    QA = QA_BY_ACT[act]


# ---------------------------------------------------------------- data ----

def load_data(path: str):
    """NDD1 binary loader (scripts/gen-nnue-data.ts output). Decodes in
    100k-row chunks into preallocated small-dtype arrays so peak RSS stays
    ~flat with N (the naive full-array version needed ~60x the final arrays
    and OOMs Kaggle at the 3-10M merge target). The result byte is decoded
    and returned but unused — reserved for WDL-blended targets (distillation)."""
    raw = np.fromfile(path, dtype=np.uint8)
    if raw.size < 8 or bytes(raw[:4]) != b"NDD1":
        raise ValueError(f"{path}: not an NDD1 file")
    count = int.from_bytes(raw[4:8], "little")
    if raw.size < 8 + count * 36:
        raise ValueError(f"{path}: truncated ({raw.size} bytes < 8 + {count} * 36)")
    if count == 0:
        raise SystemExit(f"{path}: no positions in file")

    CH = 100_000
    featA = np.empty((count, 32), np.int16)
    featB = np.empty((count, 32), np.int16)
    maskA = np.empty((count, 32), np.uint8)
    labels = np.empty(count, np.float32)
    results = np.empty(count, np.int64)
    audit = PovAudit()
    sq = np.arange(64, dtype=np.int16)
    sq_flip = sq ^ 56
    for s in range(0, count, CH):
        e = min(s + CH, count)
        recs = raw[8 + s * 36: 8 + e * 36].reshape(e - s, 36)
        stm = recs[:, 0].astype(np.int8)
        codes = np.empty((e - s, 64), dtype=np.int16)
        codes[:, 0::2] = recs[:, 1:33] & 0x0F
        codes[:, 1::2] = recs[:, 1:33] >> 4

        sqA = np.where(stm[:, None] == 1, sq_flip[None, :], sq[None, :])
        is_white = codes < 6
        valid = codes < 12
        type_ = codes % 6
        own_a = is_white == (stm[:, None] == 0)

        typeA = np.where(own_a, type_, type_ + 6)
        typeB = np.where(own_a, type_ + 6, type_)
        fA = np.where(valid, typeA * 64 + sqA, 0)
        fB = np.where(valid, typeB * 64 + (sqA ^ 56), 0)
        pA, mA = pack32(fA, valid)
        pB, _ = pack32(fB, valid)
        featA[s:e] = pA
        featB[s:e] = pB
        maskA[s:e] = mA
        labels[s:e] = recs[:, 33:35].copy().view("<i2").reshape(e - s)
        results[s:e] = recs[:, 35]
        if not np.isin(stm, (0, 1)).all():
            bad = int(np.argmax(~np.isin(stm, (0, 1))))
            raise SystemExit(f"{path}: invalid stm byte {int(stm[bad])} at record {s + bad}")
        bad_code = (codes >= 12) & (codes != 15)
        if bad_code.any():
            r, c = np.argwhere(bad_code)[0]
            raise SystemExit(f"{path}: invalid piece code {int(codes[r, c])} at record {s + r}")
        if (results[s:e] > 2).any():
            bad = int(np.argmax(results[s:e] > 2))
            raise SystemExit(f"{path}: invalid result byte {int(results[s:e][bad])} at record {s + bad}")
        audit.add_batch((val_map[codes]).sum(axis=1), stm, labels[s:e])
    audit.final_check()
    return featA, featB, labels, results, maskA


def fen_row_to_codes(fen: str):
    """FEN board -> (64,) piece codes (0-5 white, 6-11 black, 15 empty)."""
    piece_map = {"P": 0, "N": 1, "B": 2, "R": 3, "Q": 4, "K": 5,
                 "p": 6, "n": 7, "b": 8, "r": 9, "q": 10, "k": 11}
    parts = fen.split()
    if len(parts) < 2 or parts[1] not in ("w", "b"):
        return None, None
    stm = 0 if parts[1] == "w" else 1
    codes = np.full(64, 15, dtype=np.int64)
    r, f = 7, 0
    for ch in parts[0]:
        if ch == "/":
            if f != 8:  # rank width must be exactly 8 (rejects "9/..." etc.)
                return None, None
            r, f = r - 1, 0
        elif ch.isdigit():
            f += int(ch)
        elif ch in piece_map:
            if r < 0 or f > 7:
                return None, None
            codes[r * 8 + f] = piece_map[ch]
            f += 1
        else:
            return None, None
    if r != 0 or f != 8:  # exactly 8 ranks (start r=7, no trailing '/'), full last rank
        return None, None
    return codes, stm


def _features_from_codes(codes: np.ndarray, stm: int):
    """Both views' feature ids + validity for one position (packed 32 slots)."""
    sq = np.arange(64, dtype=np.int64)
    sqA = sq_flip64 if stm == 1 else sq
    is_white = codes < 6
    valid = codes < 12
    type_ = codes % 6
    own_a = is_white == (stm == 0)
    featA64 = (np.where(own_a, type_, type_ + 6) * 64 + sqA).astype(np.int16)
    featB64 = (np.where(own_a, type_ + 6, type_) * 64 + (sqA ^ 56)).astype(np.int16)
    featA64[~valid] = 0
    featB64[~valid] = 0
    featA, maskA = pack32(featA64[None], valid[None])
    featB, _ = pack32(featB64[None], valid[None])
    return featA[0], featB[0], maskA[0]


def pack32(feat: np.ndarray, valid: np.ndarray):
    """Stable-partition valid features into the first 32 slots (positions have
    ≤32 pieces); returns (packed, mask). The model is slot-agnostic: the mask
    still zeroes padding."""
    order = np.argsort(~valid, axis=1, kind="stable")
    packed = np.take_along_axis(feat, order, axis=1)[:, :32]
    m = np.take_along_axis(valid, order, axis=1)[:, :32]
    return packed, m


sq_flip64 = np.arange(64, dtype=np.int64) ^ 56
val_map = np.array([1, 3, 3, 5, 9, 0, -1, -3, -3, -5, -9, 0, 0, 0, 0, 0])


def load_csv(path: str, max_positions: int = 0):
    """Kaggle FEN,eval CSV (white-POV labels) -> compact feature arrays."""
    import csv
    audit = PovAudit()
    featA_l, featB_l, mask_l, label_l = [], [], [], []
    kept = skipped = 0
    with open(path, newline="") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        if header is None:
            raise SystemExit(f"{path}: empty CSV")
        fen_col, eval_col = 0, 1
        for i, col in enumerate(header):
            if col.strip().lower() == "fen":
                fen_col = i
            elif col.strip().lower() in ("evaluation", "eval"):
                eval_col = i
        for row in reader:
            if len(row) <= max(fen_col, eval_col):
                continue
            ev_s = row[eval_col].strip()
            if ev_s == "" or ev_s.startswith("#"):
                skipped += 1
                continue
            try:
                eval_white = float(ev_s)
            except ValueError:
                skipped += 1
                continue
            if not math.isfinite(eval_white):
                skipped += 1
                continue
            codes, stm = fen_row_to_codes(row[fen_col].strip())
            if codes is None:
                skipped += 1
                continue
            label_stm = eval_white if stm == 0 else -eval_white
            label_stm = max(-3200.0, min(3200.0, label_stm))
            audit.add(row[fen_col].strip(), eval_white, stm, int((val_map[codes]).sum()), label_stm)
            featA, featB, maskA = _features_from_codes(codes, stm)
            featA_l.append(featA)
            featB_l.append(featB)
            mask_l.append(maskA.astype(np.uint8))
            label_l.append(label_stm)
            kept += 1
            if kept % 1_000_000 == 0:
                print(f"  parsed {kept} positions (skipped {skipped})")
                audit.fast_check()
            if max_positions and kept >= max_positions:
                break
    if kept == 0:
        raise SystemExit(f"{path}: no usable positions (all mate/unparseable?)")
    audit.fast_check()
    featA = np.stack(featA_l)
    featB = np.stack(featB_l)
    mask = np.stack(mask_l)
    labels = np.array(label_l, dtype=np.float32)
    print(f"csv: kept {kept} positions, skipped {skipped} (mate/unparseable)")
    audit.final_check()
    return featA, featB, labels, None, mask


class PovAudit:
    """Gate on the label perspective via sign agreement between the STM label
    and the mover's material sign.

    Calibrated on the official Lichess evaluations DB (white-POV, 407k-row
    sample): 68.5% overall agreement, white- vs black-to-move rates within
    2.2 pts. Absolute agreement on this distribution is LOW (fortress draws,
    sacrifices, compensation) and is NOT evidence of a bug. A perspective bug
    instead shows up as a huge white/black-to-move gap (~50 pts) with overall
    near 50%; garbage labels sit at ~50% overall."""

    GAP_ABORT = 8.0      # pts between white- and black-to-move rates
    FLOOR_ABORT = 52.0   # overall %; coin-flip labels = 50%
    FAST_N = 1_500_000   # early verdict once this many comparable rows seen

    def __init__(self):
        self.aw = self.tw = self.ab = self.tb = 0
        self.n_equal = self.n_zero = 0
        self.samples = []  # (fen, cp_white, stm, white-minus-black material)
        self.fast_done = False

    def add(self, fen, cp_white, stm, mat_diff, label_stm):
        if mat_diff == 0:
            self.n_equal += 1
            return
        if label_stm == 0:
            self.n_zero += 1
            return
        ok = (label_stm > 0) == ((mat_diff if stm == 0 else -mat_diff) > 0)
        if stm == 0:
            self.aw += ok
            self.tw += 1
        else:
            self.ab += ok
            self.tb += 1
        if not ok and len(self.samples) < 12:
            self.samples.append((fen, int(cp_white), "w" if stm == 0 else "b", int(mat_diff)))

    def add_batch(self, mat_diffs, stms, labels_arr):
        """Vectorized add() for decoded .bin chunks (records carry no FEN)."""
        mat = np.asarray(mat_diffs, dtype=np.int64)
        lab = np.asarray(labels_arr, dtype=np.float32)
        stms = np.asarray(stms)
        self.n_equal += int((mat == 0).sum())
        self.n_zero += int((lab == 0).sum())
        comp = (mat != 0) & (lab != 0)
        if not comp.any():
            return
        exp = np.where(stms == 0, mat, -mat)[comp]
        ok = np.sign(lab[comp]) == np.sign(exp)
        w = stms[comp] == 0
        self.aw += int(ok[w].sum())
        self.tw += int(w.sum())
        self.ab += int(ok[~w].sum())
        self.tb += int((~w).sum())

    def merge(self, other: "PovAudit"):
        self.aw += other.aw
        self.tw += other.tw
        self.ab += other.ab
        self.tb += other.tb
        self.n_equal += other.n_equal
        self.n_zero += other.n_zero
        for s in other.samples:
            if len(self.samples) < 12:
                self.samples.append(s)

    def rates(self):
        rw = 100.0 * self.aw / self.tw if self.tw else 0.0
        rb = 100.0 * self.ab / self.tb if self.tb else 0.0
        tot = self.tw + self.tb
        ov = 100.0 * (self.aw + self.ab) / tot if tot else 0.0
        return rw, rb, abs(rw - rb), ov, tot

    def report(self):
        rw, rb, gap, ov, tot = self.rates()
        return "\n".join([
            f"POV audit: {ov:.1f}% overall | white-to-move {rw:.1f}% (n={self.tw:,}) | "
            f"black-to-move {rb:.1f}% (n={self.tb:,}) | stm gap {gap:.1f} pts",
            f"  excluded: {self.n_equal:,} equal-material, {self.n_zero:,} zero-label rows",
            f"  healthy on this data: 55-75% overall, gap < {PovAudit.GAP_ABORT:.0f} pts "
            f"(official Lichess DB calibrates at 68.5% overall, 2.2 pt gap)",
        ])

    def fail_reason(self, min_rows: int = 1000):
        _, _, gap, ov, tot = self.rates()
        if tot < min_rows:
            return None
        if gap > self.GAP_ABORT:
            return (f"stm gap {gap:.1f} pts - white- and black-to-move rows disagree at "
                    f"different rates, the label perspective conversion is broken")
        if ov < self.FLOOR_ABORT:
            return f"overall agreement {ov:.1f}% ~ coin flip - labels look unrelated to the position"
        return None

    def fast_check(self):
        if self.fast_done:
            return
        _, _, _, _, tot = self.rates()
        if tot < self.FAST_N:
            return
        self.fast_done = True
        why = self.fail_reason()
        print(self.report())
        if why:
            self.print_samples()
            raise SystemExit(f"POV AUDIT FAILED (early, {tot:,} rows): {why}; aborting before a wasted training run")

    def final_check(self):
        print(self.report())
        why = self.fail_reason()
        if why:
            self.print_samples()
            raise SystemExit(f"POV AUDIT FAILED: {why}; aborting before a wasted training run")

    def print_samples(self):
        print("sample disagreements (fen | cp_white | stm | white-minus-black material):")
        for fen, cp, stm, mat in self.samples:
            print(f"  {fen} | {cp} | {stm} | {mat:+d}")


def _parse_parquet_file(job):
    """Worker: decode one parquet file to scratch raw files (spawn-safe).
    Uses a dataset scanner so the depth/cp/mate filter is pushed down into
    pyarrow (C++) and worker memory is bounded by batch_size, matching the
    sequential loader's semantics. Returns (idx, prefix, kept, audit fields).
    max_rows > 0 caps kept rows (canary mode)."""
    idx, path, prefix, min_depth, max_rows = job
    import pyarrow.dataset as pads
    audit = PovAudit()
    outs = {k: open(prefix + k + ".raw", "wb") for k in ("fa", "fb", "m", "l")}
    cur_a = np.zeros((CHUNK_ROWS, 32), np.int16)
    cur_b = np.zeros((CHUNK_ROWS, 32), np.int16)
    cur_m = np.zeros((CHUNK_ROWS, 32), np.uint8)
    cur_l = np.zeros(CHUNK_ROWS, np.float32)
    cur_n = kept = 0

    def flush():
        nonlocal cur_n
        if cur_n == 0:
            return
        outs["fa"].write(cur_a[:cur_n].tobytes())
        outs["fb"].write(cur_b[:cur_n].tobytes())
        outs["m"].write(cur_m[:cur_n].tobytes())
        outs["l"].write(cur_l[:cur_n].tobytes())
        cur_n = 0

    ds = pads.dataset(path, format="parquet")
    filt = (pads.field("depth") >= min_depth) & (pads.field("cp").is_valid()) & (pads.field("mate").is_valid() == False)
    scanner = ds.scanner(filter=filt, columns=["fen", "cp"], batch_size=65536)
    for batch in scanner.to_batches():
        fens = batch.column("fen").to_pylist()
        cps = batch.column("cp").to_pylist()
        for fen, cp_white in zip(fens, cps):
            codes, stm = fen_row_to_codes(fen)
            if codes is None:
                continue
            label_stm = max(-3200.0, min(3200.0, float(cp_white if stm == 0 else -cp_white)))
            featA, featB, maskA = _features_from_codes(codes, stm)
            cur_a[cur_n] = featA
            cur_b[cur_n] = featB
            cur_m[cur_n] = maskA.astype(np.uint8)
            cur_l[cur_n] = label_stm
            audit.add(fen, cp_white, stm, int((val_map[codes]).sum()), label_stm)
            cur_n += 1
            kept += 1
            if cur_n >= CHUNK_ROWS:
                flush()
            if max_rows and kept >= max_rows:
                break
        if max_rows and kept >= max_rows:
            break
    flush()
    for f in outs.values():
        f.close()
    return (idx, prefix, kept, audit.aw, audit.tw, audit.ab, audit.tb,
            audit.n_equal, audit.n_zero, audit.samples)


CHUNK_ROWS = 100_000


def _load_parquet_parallel(files, min_depth: int, workers: int, scratch_dir: str = ""):
    """Full-dataset decode: a canary audits a bounded sample per the first
    file with an explicit row floor (fail fast), then one spawn worker per
    parquet file streams to scratch; audits merge incrementally as files land
    (a poisoned file aborts the pool mid-decode). Worker raws are copied into
    the final files and unlinked immediately — peak scratch ~= final size, not
    2x — and sizes are asserted before memmap (a short write would SIGBUS).
    The tmpdir survives on success: the returned memmaps map those files."""
    import shutil
    import tempfile
    import time
    import multiprocessing as mp
    tmpdir = tempfile.mkdtemp(prefix="nnue-parquet-", dir=scratch_dir or None)
    t0 = time.time()
    canary_prefix = tmpdir + "/canary-"
    print(f"parquet: canary audit (first 2M rows of {files[0].rsplit('/', 1)[-1]}) ...")
    _, _, ckept, aw, tw, ab, tb, neq, nzero, samples = _parse_parquet_file(
        (-1, files[0], canary_prefix, min_depth, 2_000_000))
    for key in ("fa", "fb", "m", "l"):
        os.unlink(canary_prefix + key + ".raw")
    canary = PovAudit()
    canary.aw, canary.tw, canary.ab, canary.tb = aw, tw, ab, tb
    canary.n_equal, canary.n_zero, canary.samples = neq, nzero, samples
    print(canary.report())
    why = canary.fail_reason(min_rows=100_000)  # NOT fast_check: its 1.5M floor
    if why:                                     # can exceed the canary's sample
        raise SystemExit(f"POV AUDIT FAILED (canary): {why}; aborting before a wasted training run")

    n = len(files)
    w = max(1, min(workers, n))
    print(f"parquet: parallel decode of {n} files with {w} workers ...", flush=True)
    jobs = [(i, f, tmpdir + f"/w{i:03d}-", min_depth, 0) for i, f in enumerate(files)]
    # spawn, not fork: pyarrow runs internal thread pools, and forking a
    # process with live threadpool state crashes the children (measured).
    ctx = mp.get_context("spawn")
    results = [None] * n
    merged = PovAudit()
    kept = 0
    pool = ctx.Pool(w)
    try:
        for (idx, prefix, k, aw, tw, ab, tb, neq, nzero, samples) in pool.imap_unordered(_parse_parquet_file, jobs):
            part = PovAudit()
            part.aw, part.tw, part.ab, part.tb = aw, tw, ab, tb
            part.n_equal, part.n_zero, part.samples = neq, nzero, samples
            merged.merge(part)
            kept += k
            results[idx] = (prefix, k)
            print(f"  [{len([x for x in results if x])}/{n}] {os.path.basename(files[idx])}: "
                  f"{k:,} rows  ({time.time() - t0:.0f}s)", flush=True)
            why = merged.fail_reason(min_rows=200_000)
            if why:
                raise SystemExit(f"POV AUDIT FAILED mid-decode: {why}")
        pool.close()
        pool.join()
    except BaseException:
        pool.terminate()
        for r in results:
            if r:
                for key in ("fa", "fb", "m", "l"):
                    try:
                        os.unlink(r[0] + key + ".raw")
                    except OSError:
                        pass
        raise
    if kept == 0:
        raise SystemExit("parquet: no positions matched the data filter")
    merged.final_check()

    row_bytes = {"fa": 64, "fb": 64, "m": 32, "l": 4}
    need = kept * sum(row_bytes.values())
    free = shutil.disk_usage(tmpdir).free
    if free < need * 1.05:
        raise SystemExit(f"parquet: scratch too small for concatenated arrays "
                         f"({need / 1e9:.1f}GB needed, {free / 1e9:.1f}GB free) - use --scratch-dir")
    for key, rb in row_bytes.items():
        with open(tmpdir + f"/{key}.raw", "wb") as out:
            for prefix, k in results:  # file order: results is indexed by job idx
                p = prefix + key + ".raw"
                actual = os.path.getsize(p)
                if actual != k * rb:
                    raise SystemExit(f"parquet: short scratch write {p}: {actual} bytes, expected {k * rb}")
                with open(p, "rb") as src:
                    shutil.copyfileobj(src, out, 1 << 22)
                os.unlink(p)  # free each worker raw immediately: peak ~= final size
    print(f"parquet: decoded {kept:,} positions from {n} files in {time.time() - t0:.0f}s")
    featA = np.memmap(tmpdir + "/fa.raw", dtype=np.int16, mode="c", shape=(kept, 32))
    featB = np.memmap(tmpdir + "/fb.raw", dtype=np.int16, mode="c", shape=(kept, 32))
    mask = np.memmap(tmpdir + "/m.raw", dtype=np.uint8, mode="c", shape=(kept, 32))
    labels = np.memmap(tmpdir + "/l.raw", dtype=np.float32, mode="c", shape=(kept,))
    load_parquet.last_scratch_dir = tmpdir
    return featA, featB, labels, None, mask


def load_parquet(pattern: str, max_positions: int = 0, min_depth: int = 15, workers: int = 0, scratch_dir: str = "", shard: int = 0, shards: int = 1):
    """Lichess evaluations dataset (dedup Parquet). Capped/subsampled runs use
    the proven sequential loader; uncapped multi-file runs (full-dataset
    pretrains) use the parallel decoder (one process per file, canary audit
    first). Both return disk-backed memmaps — RAM stays ~flat with N.

    shards > 1 splits the FILE LIST by index (files[shard::shards]) so a big
    corpus can be decoded in parallel Kaggle sessions (the --decode-only
    chunks assemble into a --predecoded dataset). last_scratch_dir records
    where the memmaps landed so --decode-only can write its manifest."""
    import glob as _glob
    files = sorted(_glob.glob(pattern, recursive=True))  # ** supported
    if not files:
        raise ValueError(f"no parquet files match {pattern}")
    if not (0 <= shard < shards) or shards < 1:
        raise ValueError(f"invalid shard split: shard={shard} shards={shards}")
    if shards > 1:
        files = files[shard::shards]
        print(f"shard {shard}/{shards}: decoding {len(files)} parquet files (every {shards}th of the sorted list)")
    if max_positions or workers == 1 or len(files) == 1:
        out = _load_parquet_sequential(files, max_positions, min_depth, scratch_dir)
        return out
    import multiprocessing as _mp
    return _load_parquet_parallel(files, min_depth, workers or min(_mp.cpu_count() or 1, 8), scratch_dir)


# Set by the parquet loaders: the directory holding fa/fb/m/l.raw for the
# most recent load (used by --decode-only to write its manifest).
load_parquet.last_scratch_dir = ""


class ChunkedRows:
    """Global-row indexing over a list of disk-backed (N_i, C) memmaps —
    zero copy at load, per-batch gather at access (the training loop's only
    access pattern is obj[LongTensor] → (len, C) tensor)."""

    def __init__(self, parts):
        self.parts = parts
        self.sizes = [int(p.shape[0]) for p in parts]
        self.starts = np.concatenate(([0], np.cumsum(self.sizes))).astype(np.int64)
        self.N = int(self.starts[-1])
        self.C = int(parts[0].shape[1])
        self.tdtype = torch.from_numpy(np.empty(1, parts[0].dtype)).dtype

    @property
    def shape(self):
        return (self.N, self.C)

    def __getitem__(self, b):
        idx = b.detach().cpu().numpy() if isinstance(b, torch.Tensor) else np.asarray(b)
        out = torch.empty((len(idx), self.C), dtype=self.tdtype)
        cid = np.searchsorted(self.starts, idx, side="right") - 1
        for k in np.unique(cid):
            m = cid == k
            local = idx[m] - self.starts[k]
            out[torch.from_numpy(m)] = torch.from_numpy(np.asarray(self.parts[k][local]))
        return out


def load_predecoded(dirs):
    """Reassembles a --decode-only chunk set (dirs containing fa/fb/m/l.raw +
    manifest.json) into zero-copy ChunkedRows sources. Validates every chunk
    against its manifest and the on-disk sizes before trusting it."""
    if not dirs:
        raise ValueError("--predecoded got no directories")
    pa, pb, pm, pl = [], [], [], []
    for d in dirs:
        man_path = os.path.join(d, "manifest.json")
        if not os.path.isfile(man_path):
            raise ValueError(f"{d}: no manifest.json (is this a --decode-only chunk dir?)")
        man = json.load(open(man_path))
        n = int(man["positions"])
        expect = {"fa": (np.int16, (n, 32)), "fb": (np.int16, (n, 32)),
                  "m": (np.uint8, (n, 32)), "l": (np.float32, (n,))}
        for key, (dt, shape) in expect.items():
            p = os.path.join(d, key + ".raw")
            want = int(np.prod(shape)) * np.dtype(dt).itemsize
            got = os.path.getsize(p)
            if got != want:
                raise ValueError(f"{d}/{key}.raw: size {got} != expected {want} for {n} positions")
        pa.append(np.memmap(os.path.join(d, "fa.raw"), np.int16, "r", shape=(n, 32)))
        pb.append(np.memmap(os.path.join(d, "fb.raw"), np.int16, "r", shape=(n, 32)))
        pm.append(np.memmap(os.path.join(d, "m.raw"), np.uint8, "r", shape=(n, 32)))
        pl.append(np.memmap(os.path.join(d, "l.raw"), np.float32, "r", shape=(n, 1)))
        print(f"predecoded chunk {d}: {n} positions (min_depth {man.get('min_depth')}, shard {man.get('shard')}/{man.get('shards')})")
    featA, featB, mask = ChunkedRows(pa), ChunkedRows(pb), ChunkedRows(pm)
    labels = ChunkedRows(pl)
    print(f"predecoded total: {labels.N} positions from {len(dirs)} chunks")
    return featA, featB, labels, mask


def _load_parquet_sequential(files, max_positions: int, min_depth: int, scratch_dir: str = ""):
    import tempfile
    import pyarrow.dataset as pads
    ds = pads.dataset(files, format="parquet")

    CHUNK = CHUNK_ROWS
    tmpdir = tempfile.mkdtemp(prefix="nnue-parquet-", dir=scratch_dir or None)
    outs = {k: open(os.path.join(tmpdir, k + ".raw"), "wb")
            for k in ("fa", "fb", "m", "l")}
    cur_a = np.zeros((CHUNK, 32), np.int16)
    cur_b = np.zeros((CHUNK, 32), np.int16)
    cur_m = np.zeros((CHUNK, 32), np.uint8)
    cur_l = np.zeros(CHUNK, np.float32)
    cur_n = 0

    def flush():
        nonlocal cur_n
        if cur_n == 0:
            return
        outs["fa"].write(cur_a[:cur_n].tobytes())
        outs["fb"].write(cur_b[:cur_n].tobytes())
        outs["m"].write(cur_m[:cur_n].tobytes())
        outs["l"].write(cur_l[:cur_n].tobytes())
        cur_n = 0

    audit = PovAudit()
    kept = skipped = scanned = 0
    filt = (pads.field("depth") >= min_depth) & (pads.field("cp").is_valid()) & (pads.field("mate").is_valid() == False)
    scanner = ds.scanner(filter=filt, columns=["fen", "cp"], batch_size=65536)
    for batch in scanner.to_batches():
        fens = batch.column("fen").to_pylist()
        cps = batch.column("cp").to_pylist()
        for fen, cp_white in zip(fens, cps):
            scanned += 1
            codes, stm = fen_row_to_codes(fen)
            if codes is None:
                skipped += 1
                continue
            label_stm = cp_white if stm == 0 else -cp_white
            label_stm = max(-3200.0, min(3200.0, float(label_stm)))
            featA, featB, maskA = _features_from_codes(codes, stm)

            cur_a[cur_n] = featA
            cur_b[cur_n] = featB
            cur_m[cur_n] = maskA.astype(np.uint8)
            cur_l[cur_n] = label_stm
            audit.add(fen, cp_white, stm, int((val_map[codes]).sum()), label_stm)
            cur_n += 1
            if cur_n >= CHUNK:
                flush()
            kept += 1
            if kept % 1_000_000 == 0:
                print(f"  parsed {kept} positions (scanned {scanned}, skipped {skipped})")
                audit.fast_check()  # early verdict ~2M rows in
            if max_positions and kept >= max_positions:
                break
        if max_positions and kept >= max_positions:
            break

    flush()
    for f in outs.values():
        f.close()
    audit.fast_check()  # covers runs smaller than FAST_N
    if kept == 0:
        raise SystemExit("parquet: no positions matched the data filter")
    # mode "c" = copy-on-write: writable flag (no torch warning), pages cached,
    # accidental writes never reach disk
    featA = np.memmap(os.path.join(tmpdir, "fa.raw"), dtype=np.int16, mode="c", shape=(kept, 32))
    featB = np.memmap(os.path.join(tmpdir, "fb.raw"), dtype=np.int16, mode="c", shape=(kept, 32))
    mask = np.memmap(os.path.join(tmpdir, "m.raw"), dtype=np.uint8, mode="c", shape=(kept, 32))
    labels = np.memmap(os.path.join(tmpdir, "l.raw"), dtype=np.float32, mode="c", shape=(kept,))
    print(f"parquet: kept {kept} positions (scanned {scanned}, skipped {skipped}) at depth >= {min_depth}")
    audit.final_check()
    load_parquet.last_scratch_dir = tmpdir
    return featA, featB, labels, None, mask


# ---------------------------------------------------------------- model ----

class SmallNNUE(nn.Module):
    def __init__(self, h1: int = 32, h2: int = 32, act: str = "crelu"):
        super().__init__()
        self.h1, self.h2, self.act = h1, h2, act
        self.w1 = nn.Parameter(torch.zeros(2, h1, IN))
        self.b1 = nn.Parameter(torch.zeros(2, h1))
        self.w2 = nn.Parameter(torch.zeros(2 * h1, h2))
        self.w3 = nn.Parameter(torch.zeros(h2))
        nn.init.normal_(self.w1, std=0.05)
        nn.init.normal_(self.b1, std=0.05)
        nn.init.normal_(self.w2, std=0.15)
        nn.init.normal_(self.w3, std=0.15)

    def forward(self, idxA: torch.Tensor, idxB: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        # gather → (B, 64 slots, h1); mask (B,64,1) zeroes padding slots;
        # sum over slots → (B, h1). w1[v] is (h1, IN) → .T is (IN, h1) so the
        # first-dim gather yields slot-major (B, 64, h1).
        m3 = mask.unsqueeze(-1)
        accA = (self.w1[0].T[idxA] * m3).sum(dim=1) + self.b1[0]      # (B, h1)
        accB = (self.w1[1].T[idxB] * m3).sum(dim=1) + self.b1[1]
        actA = accA.clamp(0.0, 1.0)
        actB = accB.clamp(0.0, 1.0)
        if self.act == "screlu":
            # squared clamp on L1 only — L2 keeps plain crelu so the A/B vs
            # v1 isolates the activation change (no b2/b3 either)
            actA = actA * actA
            actB = actB * actB
        h = torch.cat([actA, actB], dim=1)                            # (B, 2*h1)
        l2 = (h @ self.w2).clamp(0.0, 1.0)
        return (l2 @ self.w3).squeeze(-1)                             # (B,) in "w3 units"


# ---------------------------------------------------------------- train ----

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="")
    ap.add_argument("--out", default="nnue-v1.bin")
    ap.add_argument("--checkpoint", default="nnue_float.pt")
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--batch", type=int, default=16384)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--weight-decay", type=float, default=0.01)
    ap.add_argument("--max-steps", type=int, default=0, help="debug cap on optimizer steps (0 = off)")
    ap.add_argument("--max-positions", type=int, default=0, help="csv/parquet subsample cap (0 = all)")
    ap.add_argument("--min-depth", type=int, default=15, help="parquet label quality filter (lichess depth)")
    ap.add_argument("--seed", type=int, default=12345, help="torch seed (numpy split is already seeded)")
    ap.add_argument("--h1", type=int, default=32, help="layer-1 width (TS reads H1 from the file header)")
    ap.add_argument("--h2", type=int, default=32, help="layer-2 width")
    ap.add_argument("--workers", type=int, default=0, help="parallel parquet decode workers (0 = auto, 1 = sequential)")
    ap.add_argument("--scratch-dir", default="", help="directory for decode scratch files (default: system temp)")
    ap.add_argument("--clip-grad", type=float, default=1.0, help="gradient L2 norm clip (0 = off)")
    ap.add_argument("--activation", choices=("crelu", "screlu"), default="crelu",
                    help="L1 activation: crelu=clamp(v,0,1) [v1, magic C0NNUE01, QA=1024]; "
                         "screlu=clamp(v,0,1)^2 [v2, magic C0NNUE02, QA=400]")
    ap.add_argument("--shard", type=int, default=0, help="0-based shard index for --data parquet globs")
    ap.add_argument("--shards", type=int, default=1, help="total shards (>1 splits the file list by index)")
    ap.add_argument("--predecoded", default="",
                    help="comma-separated --decode-only chunk dirs to train from (skips parquet decode)")
    ap.add_argument("--decode-only", action="store_true",
                    help="decode the parquet shard into --scratch-dir and exit (writes manifest.json); no training")
    ap.add_argument("--resume", default="",
                    help="float .pt state_dict to fine-tune from (default: random init)")
    args = ap.parse_args()

    if args.workers < 0 or args.max_positions < 0 or args.min_depth < 1 or args.epochs < 0 or args.batch < 1:
        raise SystemExit("invalid arguments: workers/max-positions/epochs must be >= 0, min-depth >= 1, batch >= 1")
    if not (0 <= args.shard < args.shards) or args.shards < 1:
        raise SystemExit(f"invalid --shard/--shards: {args.shard}/{args.shards}")
    if bool(args.predecoded) + bool(args.decode_only) > 1:
        raise SystemExit("--predecoded and --decode-only are mutually exclusive")
    if args.decode_only and not args.data:
        raise SystemExit("--decode-only needs --data (a parquet glob)")
    if args.predecoded and args.data:
        raise SystemExit("pass either --data or --predecoded, not both")
    set_activation(args.activation)
    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device: {device}  net: 768x{args.h1}x2 -> {args.h2} -> 1  act: {ACT} (QA={QA}, magic {MAGIC[ACT].decode()})")

    if args.predecoded:
        featA, featB, labels, mask = load_predecoded([d for d in args.predecoded.split(",") if d])
        results = None
    elif not args.data:
        raise SystemExit("--data is required unless --predecoded is given")
    elif "*" in args.data or os.path.isdir(args.data):
        # globs/directories are parquet-only; a non-parquet glob fails inside
        # load_parquet with "no parquet files match" (no silent .bin misroute)
        featA, featB, labels, results, mask = load_parquet(
            args.data, args.max_positions, args.min_depth, args.workers, args.scratch_dir,
            args.shard, args.shards)
    elif args.data.endswith(".csv"):
        featA, featB, labels, results, mask = load_csv(args.data, args.max_positions)
    elif args.data.endswith(".bin"):
        featA, featB, labels, results, mask = load_data(args.data)
    elif args.data.endswith(".parquet"):
        featA, featB, labels, results, mask = load_parquet(
            args.data, args.max_positions, args.min_depth, args.workers, args.scratch_dir,
            args.shard, args.shards)
    else:
        raise SystemExit(f"--data must be .csv, .bin or .parquet (got {args.data})")
    n = featA.shape[0]
    print(f"data: {n} positions")

    if args.decode_only:
        # the memmaps already live in the loader's scratch dir (--scratch-dir
        # should point at the output chunk dir on Kaggle); persist the manifest
        sdir = load_parquet.last_scratch_dir
        if not sdir or not os.path.isfile(os.path.join(sdir, "fa.raw")):
            raise SystemExit("--decode-only: no chunk memmaps found (sequential loader stash missing?)")
        json.dump({
            "positions": n, "min_depth": args.min_depth,
            "shard": args.shard, "shards": args.shards,
            "files": ["fa.raw", "fb.raw", "m.raw", "l.raw"],
        }, open(os.path.join(sdir, "manifest.json"), "w"))
        print(f"decode-only: manifest written to {sdir} ({n} positions)")
        return

    # shuffle + 2% validation split
    rng = np.random.default_rng(12345)
    perm = rng.permutation(n)
    n_val = max(1, min(int(n * 0.02), n - 1))  # 2% validation; never swallows tiny debug sets
    val_idx = torch.from_numpy(perm[:n_val])
    trn_idx = torch.from_numpy(perm[n_val:])
    if trn_idx.numel() < args.batch:
        raise SystemExit(f"training split ({trn_idx.numel()}) < --batch {args.batch}; lower --batch or add data")
    dev = torch.device(device)
    # Feature indices stay on CPU as int16 (2.6GB host for 20M positions);
    # per batch we slice → cast to long → move (≈8MB/step). Storing int64 on
    # the GPU would need 10.2GB VRAM and OOM the T4. Mask stays uint8 host-side
    # (saves ~1.9GB at 20M) and casts to float on the GPU.
    if isinstance(featA, ChunkedRows):
        # --predecoded: zero-copy chunked row sources; labels flatten to one
        # GPU tensor (340M float32 = 1.4GB VRAM, fine on a T4)
        fA, fB, msk = featA, featB, mask
        y = torch.empty(n, dtype=torch.float32)
        for k, part in enumerate(labels.parts):
            lo, hi = int(labels.starts[k]), int(labels.starts[k + 1])
            y[lo:hi] = torch.from_numpy(np.asarray(part[:, 0])) / SCALE
        y = y.to(dev)                     # network trains in w3 units (cp/400)
    else:
        fA = torch.from_numpy(featA)      # int16 (N, 32) on CPU
        fB = torch.from_numpy(featB)      # int16 (N, 32) on CPU
        y = torch.from_numpy(labels / SCALE).to(dev)      # network trains in w3 units (cp/400)
        msk = torch.from_numpy(mask)      # uint8 (N, 32) on CPU

    model = SmallNNUE(h1=args.h1, h2=args.h2, act=ACT).to(dev)
    if args.resume:
        model.load_state_dict(torch.load(args.resume, map_location=dev))
        # the .pt is a plain state_dict (pre-v2 checkpoints too), so it cannot
        # record the activation — the caller must pass the matching --activation
        print(f"resumed weights from {args.resume} (act={ACT}; fine-tune: use a low --lr)")
    opt = torch.optim.AdamW(
        [{"params": [model.w1, model.w2, model.w3], "weight_decay": args.weight_decay},
         {"params": [model.b1], "weight_decay": 0.0}],
        lr=args.lr)
    steps_per_epoch = max(1, trn_idx.numel() // args.batch)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs * steps_per_epoch, eta_min=1e-5)
    best_val = float("inf")
    best_epoch = 0
    best_state = None

    def save_ckpt(path):
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)
        tmp = path + ".tmp"
        torch.save(model.state_dict(), tmp)
        os.replace(tmp, path)  # atomic: a crash mid-save can't corrupt the checkpoint

    def batch_to_device(b: torch.Tensor):
        return (fA[b].to(dev).long(), fB[b].to(dev).long(), msk[b].to(dev).float(), y[b])

    def eval_loss(idx: torch.Tensor) -> float:
        if idx.numel() == 0:
            return 0.0
        model.eval()
        tot = 0.0
        with torch.no_grad():
            for s in range(0, idx.numel(), args.batch):
                b = idx[s:s + args.batch]
                iA, iB, mk, yb = batch_to_device(b)
                pred = model(iA, iB, mk)
                tgt = torch.sigmoid(yb)
                tot += F.mse_loss(torch.sigmoid(pred), tgt, reduction="sum").item()
        model.train()
        return tot / idx.numel()

    trn_loss = eval_loss(trn_idx)
    val_loss = eval_loss(val_idx)
    print(f"baseline: train {trn_loss:.6f}  valid {val_loss:.6f}")

    model.train()
    step = 0
    stop = False
    SHUFFLE_BLOCK = 1 << 22  # 4M rows: a full-epoch int64 permutation costs 8B x N
    nblocks = (trn_idx.numel() + SHUFFLE_BLOCK - 1) // SHUFFLE_BLOCK
    for epoch in range(args.epochs):
        loss_sum = torch.zeros((), device=dev)  # GPU-side sum; .item() once per epoch
        nb = 0
        for blk in torch.randperm(nblocks).tolist():
            lo = blk * SHUFFLE_BLOCK
            chunk = trn_idx[lo:min(lo + SHUFFLE_BLOCK, trn_idx.numel())]
            rp = chunk[torch.randperm(chunk.numel())]
            for s in range(0, rp.numel() - args.batch + 1, args.batch):
                b = rp[s:s + args.batch]
                iA, iB, mk, yb = batch_to_device(b)
                pred = model(iA, iB, mk)
                tgt = torch.sigmoid(yb)
                loss = F.mse_loss(torch.sigmoid(pred), tgt)
                opt.zero_grad(set_to_none=True)
                loss.backward()
                if args.clip_grad:
                    torch.nn.utils.clip_grad_norm_(model.parameters(), args.clip_grad)
                opt.step()
                sched.step()
                step += 1
                nb += 1
                loss_sum += loss.detach()
                if args.max_steps and step >= args.max_steps:
                    stop = True
                    break
            if stop:
                break
        # Per-epoch validation + checkpoint: overfitting is visible in the log
        # and a crashed background run never loses more than one epoch.
        val_e = eval_loss(val_idx)
        if val_e < best_val:
            best_val = val_e
            best_epoch = epoch + 1
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        save_ckpt(args.checkpoint)
        print(f"epoch {epoch + 1}/{args.epochs} step {step}: "
              f"train {loss_sum.item() / max(nb, 1):.6f} valid {val_e:.6f}")
        if stop:
            break
    print(f"final: train {eval_loss(trn_idx):.6f}  valid {eval_loss(val_idx):.6f}")

    if best_state is not None and best_epoch != args.epochs:
        print(f"quantizing the best-validation epoch ({best_epoch}, valid {best_val:.6f}) "
              f"instead of the final epoch")
        model.load_state_dict(best_state)
    save_ckpt(args.checkpoint)
    quantize_and_save(model, args.out)
    print_reference_evals(args.out)  # round-trip: evals read back from the written .bin


# ------------------------------------------------------------ quantize ----

def quantize_and_save(model: SmallNNUE, out: str):
    """Quantize to the TS layout, write atomically, and return the quantized
    arrays (w1 feature-major, b1, w2 in-major, w3) plus (act, qa) so the
    integer reference forward in print_reference_evals mirrors this net.
    The scheme is derived from model.act (not the session globals) so a
    mismatched set_activation cannot silently mislabel the file."""
    act, qa = model.act, QA_BY_ACT[model.act]
    w1 = model.w1.detach().cpu().numpy().clip(-0.95, 0.95)
    b1 = model.b1.detach().cpu().numpy().clip(-0.95, 0.95)
    w2 = model.w2.detach().cpu().numpy().clip(-1.95, 1.95)
    w3 = model.w3.detach().cpu().numpy().clip(-1.95, 1.95)

    for name, arr in (("w1", w1), ("b1", b1), ("w2", w2), ("w3", w3)):
        if not np.isfinite(arr).all():
            raise SystemExit(f"quantize: {name} contains NaN/Inf - training diverged; refusing to write a corrupt net")
    w1q = np.round(w1 * qa).astype("<i2")
    b1q = np.round(b1 * qa).astype("<i2")
    w2q = np.round(w2 * QB).astype(np.int8)
    w3q = np.round(w3 * QB).astype(np.int8)

    h1, h2 = model.h1, model.h2
    # TS layout: w1 [view][feature][row] (feature-major), w2 [in][out] (in-major)
    w1_fm = np.transpose(w1q, (0, 2, 1))  # (2, IN, h1)

    blob = bytearray()
    blob += MAGIC[act]
    blob += int(IN).to_bytes(4, "little")
    blob += int(h1).to_bytes(4, "little")
    blob += int(h2).to_bytes(4, "little")
    blob += int(qa).to_bytes(2, "little", signed=True)
    blob += int(QB).to_bytes(2, "little", signed=True)
    blob += int(SCALE).to_bytes(2, "little", signed=True)
    blob += w1_fm.astype("<i2").tobytes()
    blob += b1q.astype("<i2").tobytes()
    blob += w2q.astype(np.int8).tobytes()
    blob += w3q.astype(np.int8).tobytes()
    d = os.path.dirname(out)
    if d:
        os.makedirs(d, exist_ok=True)
    tmp = out + ".tmp"
    with open(tmp, "wb") as f:
        f.write(blob)
    os.replace(tmp, out)  # atomic: a killed run can't leave a half-written net
    print(f"quantized net -> {out} ({len(blob) / 1024:.0f}KB, magic {MAGIC[act].decode()}, QA={qa})")
    return w1_fm, b1q, w2q, w3q, act, qa


def nnue_forward_int(q, codes, stm):
    """Exact integer mirror of src/engine/nnue.ts evalNnueWhitePov for one
    position: white-POV cp from the quantized weights. Every op mirrors the
    TS (b1-seeded accumulators, clamp [0,QA], crelu l2>>6 / screlu l2//(QB*QA),
    Math.round semantics)."""
    w1_fm, b1q, w2q, w3q, act, qa = q
    h1 = b1q.shape[1]
    featA, featB, maskA = _features_from_codes(codes, stm)
    actv = np.empty(2 * h1, np.int64)
    for v, feats in ((0, featA), (1, featB)):
        acc = w1_fm[v][feats[maskA.astype(bool)]].sum(axis=0) + b1q[v]
        a = np.clip(acc, 0, qa)
        actv[v * h1:(v + 1) * h1] = a * a if act == "screlu" else a
    l2 = (w2q.astype(np.int64) * actv[:, None]).sum(axis=0)
    if act == "screlu":
        # floor division: sign-safe vs wasm/TS truncation because any negative
        # l2 (or l2 < QB*QA) clamps to 0 either way
        l2act = np.clip(l2 // (QB * qa), 0, qa)
    else:
        l2act = np.clip(l2 >> 6, 0, qa)  # arithmetic shift, matches TS >>
    y = int((w3q.astype(np.int64) * l2act).sum())
    cp = int(np.floor(y * SCALE / (QB * qa) + 0.5))  # Math.round semantics
    return -cp if stm == 1 else cp


def load_quantized_bin(path):
    """Parse the written weight file back (round-trip) — a layout/offset bug
    in the serializer cannot pass the reference evals unnoticed."""
    raw = open(path, "rb").read()
    if raw[:8] not in (b"C0NNUE01", b"C0NNUE02"):
        raise ValueError(f"{path}: bad magic")
    act = "screlu" if raw[:8] == b"C0NNUE02" else "crelu"
    h1 = int.from_bytes(raw[12:16], "little")
    h2 = int.from_bytes(raw[16:20], "little")
    qa = int.from_bytes(raw[20:22], "little", signed=True)
    qb = int.from_bytes(raw[22:24], "little", signed=True)
    scale = int.from_bytes(raw[24:26], "little", signed=True)
    if (act, qa, qb, scale) != (ACT, QA, QB, SCALE) or not (1 <= h1 <= 8192 and 1 <= h2 <= 8192):
        raise ValueError(f"{path}: bad header act={act} h1={h1} h2={h2} qa={qa} qb={qb} scale={scale}")
    expected = 26 + 2 * IN * h1 * 2 + 2 * h1 * 2 + 2 * h1 * h2 + h2
    if len(raw) != expected:
        raise ValueError(f"{path}: size {len(raw)} != expected {expected} for h1={h1} h2={h2}")
    off = 26
    w1_fm = np.frombuffer(raw, "<i2", 2 * IN * h1, off).reshape(2, IN, h1)
    off += 2 * IN * h1 * 2
    b1q = np.frombuffer(raw, "<i2", 2 * h1, off).reshape(2, h1)
    off += 2 * h1 * 2
    w2q = np.frombuffer(raw, "i1", 2 * h1 * h2, off).reshape(2 * h1, h2)
    off += 2 * h1 * h2
    w3q = np.frombuffer(raw, "i1", h2, off)
    return w1_fm, b1q, w2q, w3q, act, qa


def print_reference_evals(path):
    """Integer evals of the SERIALIZED net on the same FENs as
    scripts/nnue-verify.ts — the two outputs must match line-for-line."""
    q = load_quantized_bin(path)
    fens = [
        ("startpos", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"),
        ("kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"),
        ("endgame", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1"),
        ("endgame-black", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 b - - 0 1"),
    ]
    print("reference evals (integer forward of the quantized net, white POV):")
    for name, fen in fens:
        codes, stm = fen_row_to_codes(fen)
        cp = nnue_forward_int(q, codes, stm)
        print(f"eval {name}: {cp} cp (white POV)")


if __name__ == "__main__":
    main()
