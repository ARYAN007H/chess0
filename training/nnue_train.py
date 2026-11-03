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
    raw = np.fromfile(path, dtype=np.uint8)
    if raw.size < 8 or bytes(raw[:4]) != b"NDD1":
        raise ValueError(f"{path}: not an NDD1 file")
    count = int.from_bytes(raw[4:8], "little")
    recs = raw[8:8 + count * 36].reshape(count, 36)
    stm = recs[:, 0].astype(np.int64)

    # decode nibbles -> (N, 64) piece codes
    lo = (recs[:, 1:33] & 0x0F).astype(np.int64)
    hi = (recs[:, 1:33] >> 4).astype(np.int64)
    codes = np.empty((count, 64), dtype=np.int64)
    codes[:, 0::2] = lo
    codes[:, 1::2] = hi

    sq = np.arange(64, dtype=np.int64)
    sq_flip = sq ^ 56
    sqA = np.where(stm[:, None] == 1, sq_flip[None, :], sq[None, :])
    is_white = codes < 6
    valid = codes < 12
    type_ = codes % 6
    own_a = is_white == (stm[:, None] == 0)

    typeA = np.where(own_a, type_, type_ + 6)
    typeB = np.where(own_a, type_ + 6, type_)
    featA = typeA * 64 + sqA
    featB = typeB * 64 + (sqA ^ 56)

    # pack to fixed 32 slots (pad index 0 + mask); positions have ≤32 pieces
    featA = np.where(valid, featA, 0)
    featB = np.where(valid, featB, 0)
    labels = recs[:, 33:35].copy().view(np.int16).astype(np.float32).reshape(count)
    results = recs[:, 35].astype(np.int64)
    return featA, featB, labels, results, valid.astype(np.float32)



def load_csv(path: str, max_positions: int = 0):
    """Stream a Kaggle-style FEN,eval CSV (white-POV labels, e.g. the
    ronakbadhe/chess-evaluations 12.9M-row dataset) into the same compact
    feature arrays the NDD1 path produces. Labels: white-POV cp -> STM POV
    (negated when black to move). Rows with mate ('#') or unparseable evals
    are skipped. int16 feature storage keeps ~13M positions ≈ 2.5GB."""
    import csv, sys
    piece_map = {"P": 0, "N": 1, "B": 2, "R": 3, "Q": 4, "K": 5,
                 "p": 6, "n": 7, "b": 8, "r": 9, "q": 10, "k": 11}
    sq = np.arange(64, dtype=np.int64)
    sq_flip = sq ^ 56

    featA_l, featB_l, mask_l, label_l = [], [], [], []
    kept = skipped = 0
    with open(path, newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
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
            if ev_s.startswith("#") or ev_s == "":
                skipped += 1
                continue
            try:
                eval_white = float(ev_s)
            except ValueError:
                skipped += 1
                continue
            fen = row[fen_col].strip()
            parts = fen.split()
            if len(parts) < 2:
                skipped += 1
                continue
            stm = 0 if parts[1] == "w" else 1
            codes = np.full(64, 15, dtype=np.int64)
            r, f = 7, 0
            ok = True
            for ch in parts[0]:
                if ch == "/":
                    r, f = r - 1, 0
                elif ch.isdigit():
                    f += int(ch)
                elif ch in piece_map:
                    if r < 0 or f > 7:
                        ok = False
                        break
                    codes[r * 8 + f] = piece_map[ch]
                    f += 1
                else:
                    ok = False
                    break
            if not ok:
                skipped += 1
                continue
            label_stm = eval_white if stm == 0 else -eval_white
            label_stm = max(-3200.0, min(3200.0, label_stm))

            sqA = sq_flip if stm == 1 else sq
            is_white = codes < 6
            valid = codes < 12
            type_ = codes % 6
            own_a = is_white == (stm == 0)
            featA = (np.where(own_a, type_, type_ + 6) * 64 + sqA).astype(np.int16)
            featB = (np.where(own_a, type_ + 6, type_) * 64 + (sqA ^ 56)).astype(np.int16)
            featA[~valid] = 0
            featB[~valid] = 0

            featA_l.append(featA)
            featB_l.append(featB)
            mask_l.append(valid.astype(np.uint8))
            label_l.append(label_stm)
            kept += 1
            if kept % 1_000_000 == 0:
                print(f"  parsed {kept} positions (skipped {skipped})")
            if max_positions and kept >= max_positions:
                break

    featA = np.stack(featA_l)
    featB = np.stack(featB_l)
    mask = np.stack(mask_l).astype(np.float32)
    labels = np.array(label_l, dtype=np.float32)
    print(f"csv: kept {kept} positions, skipped {skipped} (mate/unparseable)")
    return featA, featB, labels, None, mask



def load_parquet(pattern: str, max_positions: int = 0, min_depth: int = 15):
    """Load the Lichess evaluations dataset (dedup Parquet version) directly:
    columns fen, depth, knodes, cp, mate. Filters: depth >= min_depth, cp
    present, mate skipped. Labels are WHITE-POV cp -> converted to STM POV.
    Streams row-groups via pyarrow; keeps int16 features (~196B/position)."""
    import glob as _glob
    import pyarrow.dataset as pads
    files = sorted(_glob.glob(pattern))
    if not files:
        raise ValueError(f"no parquet files match {pattern}")
    ds = pads.dataset(files, format="parquet")

    featA_l, featB_l, mask_l, label_l = [], [], [], []
    kept = skipped = scanned = 0
    piece_map = {"P": 0, "N": 1, "B": 2, "R": 3, "Q": 4, "K": 5,
                 "p": 6, "n": 7, "b": 8, "r": 9, "q": 10, "k": 11}
    sq = np.arange(64, dtype=np.int64)
    sq_flip = sq ^ 56

    filt = (pads.field("depth") >= min_depth) & (pads.field("cp").is_valid()) & (pads.field("mate").is_valid() == False)
    scanner = ds.scan(filter=filt, columns=["fen", "cp"], batch_size=65536)
    for batch in scanner.to_batches():
        fens = batch.column("fen").to_pylist()
        cps = batch.column("cp").to_pylist()
        for fen, cp_white in zip(fens, cps):
            scanned += 1
            parts = fen.split()
            if len(parts) < 2:
                skipped += 1
                continue
            stm = 0 if parts[1] == "w" else 1
            codes = np.full(64, 15, dtype=np.int64)
            r, f = 7, 0
            ok = True
            for ch in parts[0]:
                if ch == "/":
                    r, f = r - 1, 0
                elif ch.isdigit():
                    f += int(ch)
                elif ch in piece_map:
                    if r < 0 or f > 7:
                        ok = False
                        break
                    codes[r * 8 + f] = piece_map[ch]
                    f += 1
                else:
                    ok = False
                    break
            if not ok:
                skipped += 1
                continue
            label_stm = cp_white if stm == 0 else -cp_white
            label_stm = max(-3200.0, min(3200.0, float(label_stm)))

            sqA = sq_flip if stm == 1 else sq
            is_white = codes < 6
            valid = codes < 12
            type_ = codes % 6
            own_a = is_white == (stm == 0)
            featA = (np.where(own_a, type_, type_ + 6) * 64 + sqA).astype(np.int16)
            featB = (np.where(own_a, type_ + 6, type_) * 64 + (sqA ^ 56)).astype(np.int16)
            featA[~valid] = 0
            featB[~valid] = 0

            featA_l.append(featA)
            featB_l.append(featB)
            mask_l.append(valid.astype(np.uint8))
            label_l.append(label_stm)
            kept += 1
            if kept % 1_000_000 == 0:
                print(f"  parsed {kept} positions (scanned {scanned}, skipped {skipped})")
            if max_positions and kept >= max_positions:
                break
        if max_positions and kept >= max_positions:
            break

    featA = np.stack(featA_l)
    featB = np.stack(featB_l)
    mask = np.stack(mask_l).astype(np.float32)
    labels = np.array(label_l, dtype=np.float32)
    print(f"parquet: kept {kept} positions (scanned {scanned}, skipped {skipped}) at depth >= {min_depth}")
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
    args = ap.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device: {device}")

    if args.data.endswith(".csv"):
        featA, featB, labels, results, mask = load_csv(args.data, args.max_positions)
    elif "*" in args.data or args.data.endswith(".parquet"):
        featA, featB, labels, results, mask = load_parquet(
            args.data, args.max_positions, args.min_depth)
    else:
        featA, featB, labels, results, mask = load_data(args.data)
    n = featA.shape[0]
    print(f"data: {n} positions")

    # shuffle + 2% validation split
    rng = np.random.default_rng(12345)
    perm = rng.permutation(n)
    n_val = max(1, min(int(n * 0.02), n - 1))  # 2% validation; never swallows tiny debug sets
    val_idx = torch.from_numpy(perm[:n_val])
    trn_idx = torch.from_numpy(perm[n_val:])
    dev = torch.device(device)
    fA = torch.from_numpy(featA).to(dev)
    fB = torch.from_numpy(featB).to(dev)
    y = torch.from_numpy(labels / SCALE).to(dev)          # network trains in w3 units (cp/400)
    msk = torch.from_numpy(mask).to(dev)

    model = SmallNNUE().to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    steps_per_epoch = max(1, trn_idx.numel() // args.batch)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs * steps_per_epoch, eta_min=1e-5)

    def eval_loss(idx: torch.Tensor) -> float:
        model.eval()
        tot = 0.0
        with torch.no_grad():
            for s in range(0, idx.numel(), args.batch):
                b = idx[s:s + args.batch]
                pred = model(fA[b], fB[b], msk[b])
                tgt = torch.sigmoid(y[b])
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
        for s in range(0, rp.numel() - args.batch + 1, args.batch):
            b = rp[s:s + args.batch]
            pred = model(fA[b], fB[b], msk[b])
            tgt = torch.sigmoid(y[b])
            loss = F.mse_loss(torch.sigmoid(pred), tgt)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            sched.step()
            step += 1
            if args.max_steps and step >= args.max_steps:
                stop = True
                break
        if step % max(1, steps_per_epoch // 4) < steps_per_epoch // 4 or stop:
            print(f"epoch {epoch + 1}/{args.epochs} step {step}: loss {loss.item():.6f}")
        if stop:
            break
    print(f"final: train {eval_loss(trn_idx):.6f}  valid {eval_loss(val_idx):.6f}")

    torch.save(model.state_dict(), args.checkpoint)
    quantize_and_save(model, args.out)
    print("reference evals (quantized weights, white POV):")
    print_reference_evals(model)


# ------------------------------------------------------------ quantize ----

def quantize_and_save(model: SmallNNUE, out: str):
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
    with open(out, "wb") as f:
        f.write(blob)
    print(f"quantized net -> {out} ({len(blob) / 1024:.0f}KB)")


def fen_to_features(fen: str):
    """Mini FEN decoder for reference evals (mirrors the record decoding)."""
    parts = fen.split()
    board, stm_s = parts[0], parts[1]
    stm = 0 if stm_s == "w" else 1
    codes = np.full(64, 15, dtype=np.int64)
    piece_map = {"P": 0, "N": 1, "B": 2, "R": 3, "Q": 4, "K": 5,
                 "p": 6, "n": 7, "b": 8, "r": 9, "q": 10, "k": 11}
    r, f = 7, 0
    for ch in board:
        if ch == "/":
            r, f = r - 1, 0
        elif ch.isdigit():
            f += int(ch)
        else:
            codes[r * 8 + f] = piece_map[ch]
            f += 1
    sq = np.arange(64, dtype=np.int64)
    sqA = sq if stm == 0 else (sq ^ 56)
    is_white = codes < 6
    valid = codes < 12
    type_ = codes % 6
    own_a = is_white == (stm == 0)
    featA = (np.where(own_a, type_, type_ + 6) * 64 + sqA)
    featB = (np.where(own_a, type_ + 6, type_) * 64 + (sqA ^ 56))
    mask = valid.astype(np.float32)
    return (torch.from_numpy(featA)[None].long(),
            torch.from_numpy(featB)[None].long(),
            torch.from_numpy(mask)[None])


def print_reference_evals(model: SmallNNUE):
    """Print quantized-style cp for sample FENs; cross-check vs src/engine/nnue.ts."""
    model.eval()
    fens = [
        ("startpos", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"),
        ("kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"),
        ("endgame", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1"),
    ]
    with torch.no_grad():
        for name, fen in fens:
            idxA, idxB, mask = fen_to_features(fen)
            y = model(idxA, idxB, mask).item()
            print(f"reference eval {name}: {y * SCALE:.1f} cp (white POV)")


if __name__ == "__main__":
    main()
