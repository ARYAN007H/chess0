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
  L1: w1q = round(clip(w, ±0.95) * QA), QA=1024, int16  (accumulator-safe)
  L2: w2q = round(clip(w, ±1.95) * QB), QB=64,   int8
  L3: w3q = round(clip(w, ±1.95) * QB),          int8
  forward (integer): act=clamp(acc,0,QA); l2act=clamp(l2>>6,0,QA);
  cp = round(y_raw * SCALE / (QB*QA)), SCALE=400  (y in "w3 units" ≈ cp/400)
  Weight file w1 is written FEATURE-MAJOR [view][feature][row] — the TS
  inference loop is contiguous per feature; L2 is written in-major [in][out].

Usage (Kaggle GPU or CPU):
  python nnue_train.py --data nnue-data.bin --out nnue-v1.bin \
      --epochs 8 --batch 16384 --lr 1e-3
"""

import argparse
import os

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

IN = 768
QA = 1024
QB = 64
SCALE = 400


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

    def fail_reason(self):
        _, _, gap, ov, tot = self.rates()
        if tot < 1000:
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


def load_parquet(pattern: str, max_positions: int = 0, min_depth: int = 15):
    """Lichess evaluations dataset (dedup Parquet): columns fen, depth,
    knodes, cp, mate. Filters depth >= min_depth, cp present, mate absent.
    Labels WHITE-POV cp -> STM POV (convention verified against the official
    DB). Chunked compact storage (~196B/position)."""
    import glob as _glob
    import pyarrow.dataset as pads
    files = sorted(_glob.glob(pattern, recursive=True))  # ** supported
    if not files:
        raise ValueError(f"no parquet files match {pattern}")
    ds = pads.dataset(files, format="parquet")

    CHUNK = 100_000
    blocks_a, blocks_b, blocks_m, blocks_l = [], [], [], []
    cur_a = np.zeros((CHUNK, 32), np.int16)
    cur_b = np.zeros((CHUNK, 32), np.int16)
    cur_m = np.zeros((CHUNK, 32), np.uint8)
    cur_l = np.zeros(CHUNK, np.float32)
    cur_n = 0

    def flush():
        nonlocal cur_a, cur_b, cur_m, cur_l, cur_n
        if cur_n == 0:
            return
        blocks_a.append(cur_a[:cur_n].copy())
        blocks_b.append(cur_b[:cur_n].copy())
        blocks_m.append(cur_m[:cur_n].copy())
        blocks_l.append(cur_l[:cur_n].copy())
        cur_a = np.zeros((CHUNK, 32), np.int16)
        cur_b = np.zeros((CHUNK, 32), np.int16)
        cur_m = np.zeros((CHUNK, 32), np.uint8)
        cur_l = np.zeros(CHUNK, np.float32)
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
    audit.fast_check()  # covers runs smaller than FAST_N
    if not blocks_a:
        raise SystemExit("parquet: no positions matched the data filter")
    featA = np.concatenate(blocks_a)
    featB = np.concatenate(blocks_b)
    mask = np.concatenate(blocks_m)  # uint8; cast to float per batch on GPU
    labels = np.concatenate(blocks_l)
    print(f"parquet: kept {kept} positions (scanned {scanned}, skipped {skipped}) at depth >= {min_depth}")
    audit.final_check()
    return featA, featB, labels, None, mask


# ---------------------------------------------------------------- model ----

class SmallNNUE(nn.Module):
    def __init__(self, h1: int = 32, h2: int = 32):
        super().__init__()
        self.h1, self.h2 = h1, h2
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
        h = torch.cat([actA, actB], dim=1)                            # (B, 2*h1)
        l2 = (h @ self.w2).clamp(0.0, 1.0)
        return (l2 @ self.w3).squeeze(-1)                             # (B,) in "w3 units"


# ---------------------------------------------------------------- train ----

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
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
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device: {device}")

    if args.data.endswith(".csv"):
        featA, featB, labels, results, mask = load_csv(args.data, args.max_positions)
    elif args.data.endswith(".bin"):
        featA, featB, labels, results, mask = load_data(args.data)
    elif "*" in args.data or args.data.endswith(".parquet"):
        featA, featB, labels, results, mask = load_parquet(
            args.data, args.max_positions, args.min_depth)
    else:
        raise SystemExit(f"--data must be .csv, .bin, .parquet or a glob (got {args.data})")
    n = featA.shape[0]
    print(f"data: {n} positions")

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
    fA = torch.from_numpy(featA)      # int16 (N, 32) on CPU
    fB = torch.from_numpy(featB)      # int16 (N, 32) on CPU
    y = torch.from_numpy(labels / SCALE).to(dev)          # network trains in w3 units (cp/400)
    msk = torch.from_numpy(mask)      # uint8 (N, 32) on CPU

    model = SmallNNUE().to(dev)
    opt = torch.optim.AdamW(
        [{"params": [model.w1, model.w2, model.w3], "weight_decay": args.weight_decay},
         {"params": [model.b1], "weight_decay": 0.0}],
        lr=args.lr)
    steps_per_epoch = max(1, trn_idx.numel() // args.batch)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs * steps_per_epoch, eta_min=1e-5)

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
    for epoch in range(args.epochs):
        rp = trn_idx[torch.randperm(trn_idx.numel())]
        loss_sum = torch.zeros((), device=dev)  # GPU-side sum; .item() once per epoch
        nb = 0
        for s in range(0, rp.numel() - args.batch + 1, args.batch):
            b = rp[s:s + args.batch]
            iA, iB, mk, yb = batch_to_device(b)
            pred = model(iA, iB, mk)
            tgt = torch.sigmoid(yb)
            loss = F.mse_loss(torch.sigmoid(pred), tgt)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            sched.step()
            step += 1
            nb += 1
            loss_sum += loss.detach()
            if args.max_steps and step >= args.max_steps:
                stop = True
                break
        # Per-epoch validation + checkpoint: overfitting is visible in the log
        # and a crashed background run never loses more than one epoch.
        torch.save(model.state_dict(), args.checkpoint)
        print(f"epoch {epoch + 1}/{args.epochs} step {step}: "
              f"train {loss_sum.item() / max(nb, 1):.6f} valid {eval_loss(val_idx):.6f}")
        if stop:
            break
    print(f"final: train {eval_loss(trn_idx):.6f}  valid {eval_loss(val_idx):.6f}")

    torch.save(model.state_dict(), args.checkpoint)
    q = quantize_and_save(model, args.out)
    print_reference_evals(q)


# ------------------------------------------------------------ quantize ----

def quantize_and_save(model: SmallNNUE, out: str):
    """Quantize to the TS layout, write atomically, and return the quantized
    arrays (w1 feature-major, b1, w2 in-major, w3) for the integer reference
    forward in print_reference_evals."""
    w1 = model.w1.detach().cpu().numpy().clip(-0.95, 0.95)
    b1 = model.b1.detach().cpu().numpy().clip(-0.95, 0.95)
    w2 = model.w2.detach().cpu().numpy().clip(-1.95, 1.95)
    w3 = model.w3.detach().cpu().numpy().clip(-1.95, 1.95)

    w1q = np.round(w1 * QA).astype("<i2")
    b1q = np.round(b1 * QA).astype("<i2")
    w2q = np.round(w2 * QB).astype(np.int8)
    w3q = np.round(w3 * QB).astype(np.int8)

    h1, h2 = model.h1, model.h2
    # TS layout: w1 [view][feature][row] (feature-major), w2 [in][out] (in-major)
    w1_fm = np.transpose(w1q, (0, 2, 1))  # (2, IN, h1)

    blob = bytearray()
    blob += b"C0NNUE01"
    blob += int(IN).to_bytes(4, "little")
    blob += int(h1).to_bytes(4, "little")
    blob += int(h2).to_bytes(4, "little")
    blob += int(QA).to_bytes(2, "little", signed=True)
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
    print(f"quantized net -> {out} ({len(blob) / 1024:.0f}KB)")
    return w1_fm, b1q, w2q, w3q


def nnue_forward_int(q, codes, stm):
    """Exact integer mirror of src/engine/nnue.ts evalNnueWhitePov for one
    position: white-POV cp from the quantized weights. Every op mirrors the
    TS (b1-seeded accumulators, clamp [0,QA], l2>>6, Math.round semantics)."""
    w1_fm, b1q, w2q, w3q = q
    h1 = b1q.shape[1]
    featA, featB, maskA = _features_from_codes(codes, stm)
    act = np.empty(2 * h1, np.int64)
    for v, feats in ((0, featA), (1, featB)):
        acc = w1_fm[v][feats[maskA.astype(bool)]].sum(axis=0) + b1q[v]
        act[v * h1:(v + 1) * h1] = np.clip(acc, 0, QA)
    l2 = (w2q.astype(np.int64) * act[:, None]).sum(axis=0)
    l2act = np.clip(l2 >> 6, 0, QA)  # arithmetic shift, matches TS >>
    y = int((w3q.astype(np.int64) * l2act).sum())
    cp = int(np.floor(y * SCALE / (QB * QA) + 0.5))  # Math.round semantics
    return -cp if stm == 1 else cp


def print_reference_evals(q):
    """Integer evals of the quantized net on the same FENs as
    scripts/nnue-verify.ts — the two outputs must match line-for-line."""
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
