"""NDD1 → FEN converter (round 3 SF-teacher pipeline, step 1).

Inverts the placement encoding of scripts/gen-nnue-data.ts so self-play
positions can be relabeled by Stockfish (training/sf_label.py on a Kaggle
CPU kernel — zero GPU quota).

NDD1 record (36 bytes, little-endian) — spec from training/nnue_train.py:
  byte 0:      stm (0 white, 1 black)
  bytes 1-32:  64 nibbles, square 0..63 (WHITE view, a1=0..h8=63);
               even s64 → low nibble, odd s64 → high nibble;
               nibble 0..5 = white P N B R Q K, 6..11 = black p..k, 15 = empty
  bytes 33-34: int16 label (kept out of the FEN output)
  byte 35:     result, STM POV (carried through to the labeler's NDD1)

Castling and ep are NOT stored in NDD1. Castling rights are inferred from
placement (the same rule parseFen applies: right only when king+rook sit on
their home squares); ep is always '-'. For depth-12 teacher labels the
difference is noise.

Output: one 4-field FEN per line (halfmove/fullmove are not in NDD1; SF
defaults them). Order matches the input file, and a sidecar index file lists
which input records were kept, so sf_label.py can reattach result bytes:

  fens.txt   : "rnbq... w KQkq -" per kept record
  fens.idx   : decimal record index per line of fens.txt

Usage:
  python nnue_to_fen.py --in nnue-data-v1.bin --out fens.txt
"""

import argparse
import struct
import sys

MAGIC = b"NDD1"
RECORD = 36
PIECE_CHARS = "PNBRQKpnbrqk"  # nibble 0..11 → piece letter (15 = empty)
CASTLE_HOME = {  # (kingSq, rookSq, flag) for each right, in 0..63 WHITE view
    "K": (4, 7),
    "Q": (4, 0),
    "k": (60, 63),
    "q": (60, 56),
}


def decode_record(rec: bytes):
    """→ (stm, [64 codes], result) or None on a spec violation."""
    stm = rec[0]
    if stm > 1:
        return None
    board = [0] * 64
    for byte_i in range(32):
        b = rec[1 + byte_i]
        for half in range(2):
            code = (b >> (4 * half)) & 0x0F  # even s64 → low nibble
            if code != 15:
                if code > 11:
                    return None
                board[byte_i * 2 + half] = code
    return stm, board, rec[35]


def codes_to_fen(board, stm):
    """Placement + inferred castling → 4-field FEN (or None if kingless)."""
    rows = []
    for rank in range(7, -1, -1):  # FEN prints rank 8 first
        row = ""
        empty = 0
        for file in range(8):
            code = board[rank * 8 + file]
            if code == 0:
                empty += 1
            else:
                if empty:
                    row += str(empty)
                    empty = 0
                row += PIECE_CHARS[code]
        if empty:
            row += str(empty)
        rows.append(row)
    placement = "/".join(rows)

    if 5 not in board:
        return None  # white king missing
    if 11 not in board:
        return None  # black king missing

    castle = ""
    for flag, (ksq, rsq) in CASTLE_HOME.items():
        king_code = 5 if flag.isupper() else 11
        rook_code = 3 if flag.isupper() else 9
        if board[ksq] == king_code and board[rsq] == rook_code:
            castle += flag
    return f"{placement} {'wb'[stm]} {castle or '-'} -"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--in", dest="inp", required=True, help="NDD1 .bin from gen-nnue-data.ts")
    ap.add_argument("--out", dest="out", required=True, help="output FEN list (one per line)")
    args = ap.parse_args()

    raw = open(args.inp, "rb").read()
    if len(raw) < 8 or raw[:4] != MAGIC:
        sys.exit(f"{args.inp}: not an NDD1 file")
    (count,) = struct.unpack_from("<I", raw, 4)
    if len(raw) != 8 + count * RECORD:
        sys.exit(f"{args.inp}: size {len(raw)} != 8 + {count}×{RECORD}")

    kept = 0
    skipped = 0
    with open(args.out, "w") as f_fen, open(args.out + ".idx", "w") as f_idx:
        for i in range(count):
            rec = decode_record(raw[8 + i * RECORD : 8 + (i + 1) * RECORD])
            if rec is None:
                skipped += 1
                continue
            stm, board, _result = rec
            fen = codes_to_fen(board, stm)
            if fen is None:
                skipped += 1  # kingless — SF cannot label it
                continue
            f_fen.write(fen + "\n")
            f_idx.write(f"{i}\n")
            kept += 1

    print(f"ndd1→fen: kept {kept}, skipped {skipped} (invalid code / kingless) of {count}")
    if kept == 0:
        sys.exit("no usable positions")


if __name__ == "__main__":
    main()
