"""Stockfish teacher labeler (round 3 SF-teacher pipeline, step 2).

Relabels positions from an NDD1 file with Stockfish scores, writing a new
NDD1 that keeps every original byte except the int16 label (byte 33-34),
which becomes SF's `score cp` from the side to move's POV — the same POV
convention the self-play generator used (trainer spec: "search score cp,
STM POV, clamped ±3200"). Mate scores are SKIPPED (the Lichess CSV path in
gen-corpus.ts drops mate rows too, so the label distribution stays
consistent with the nets' training data).

Runs on a Kaggle CPU kernel (zero GPU quota): apt/pip install stockfish or
point --sf at the official binary. Records without labels on exit are
carried over UNCHANGED from the input (so a crashed run still produces a
valid mixed dataset rather than nothing).

Checkpoint: workers write their slice to <out>.part<N> every --every
records; a completed run writes <out> atomically. Re-running skips records
already labeled in the part files.

Usage:
  python sf_label.py --in nnue-data-v1.bin --fens fens.txt [--sf stockfish] \
      --out nnue-data-sf12.bin --workers 4 --depth 12 [--every 50000]
"""

import argparse
import os
import queue
import struct
import subprocess
import sys
import tempfile
import threading
import time

MAGIC = b"NDD1"
RECORD = 36
CP_CLAMP = 3200


def read_ndd1(path):
    raw = open(path, "rb").read()
    if len(raw) < 8 or raw[:4] != MAGIC:
        sys.exit(f"{path}: not an NDD1 file")
    (count,) = struct.unpack_from("<I", raw, 4)
    if len(raw) != 8 + count * RECORD:
        sys.exit(f"{path}: size {len(raw)} != 8 + {count}×{RECORD}")
    return raw, count


class Stockfish:
    """Minimal UCI wrapper: one engine per worker, Threads=1."""

    def __init__(self, sf_path, depth, hash_mb=64):
        self.depth = depth
        self.proc = subprocess.Popen(
            [sf_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )
        self._send("uci")
        while self._recv() != "uciok":  # UCI handshake ends with uciok
            pass
        self._send(f"setoption name Threads value 1")
        self._send(f"setoption name Hash value {hash_mb}")
        self._send("isready")
        while self._recv() != "readyok":
            pass

    def _send(self, cmd):
        self.proc.stdin.write(cmd + "\n")
        self.proc.stdin.flush()

    def _recv(self):
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError("stockfish died")
        return line.strip()

    def label(self, fen):
        """→ int cp from STM POV, or None for mate / no score."""
        self._send(f"position fen {fen}")
        self._send(f"go depth {self.depth}")
        cp = None
        while True:
            line = self._recv()
            if line.startswith("info") and " score cp " in line:
                # last info line before bestmove wins
                parts = line.split()
                cp = int(parts[parts.index("score") + 2])
            elif line.startswith("bestmove"):
                break
        return cp

    def quit(self):
        try:
            self._send("quit")
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()


def worker(wid, fen_slice, rec_slice, sf_path, depth, out_path, every, progress):
    """Labels a contiguous slice; writes (index, cp) to its part file."""
    done = set()
    if os.path.exists(out_path):
        with open(out_path) as f:
            for line in f:
                idx_s, cp_s = line.split()
                done.add(int(idx_s))
    todo = [(i, fen) for i, fen in zip(rec_slice, fen_slice) if i not in done]
    engine = Stockfish(sf_path, depth)
    buf = []
    t0 = time.time()
    try:
        for k, (idx, fen) in enumerate(todo):
            cp = engine.label(fen)
            if cp is not None:
                buf.append(f"{idx} {max(-CP_CLAMP, min(CP_CLAMP, cp))}\n")
            if (k + 1) % 2000 == 0:
                progress.put((wid, k + 1, len(todo), time.time() - t0))
            if buf and (k + 1) % every == 0:
                with open(out_path, "a") as f:
                    f.writelines(buf)
                buf = []
    finally:
        if buf:
            with open(out_path, "a") as f:
                f.writelines(buf)
        engine.quit()
    progress.put((wid, -1, len(todo), time.time() - t0))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--in", dest="inp", required=True, help="NDD1 .bin (positions + result bytes)")
    ap.add_argument("--fens", required=True, help="FEN list from nnue_to_fen.py")
    ap.add_argument("--out", required=True, help="output NDD1 with SF labels")
    ap.add_argument("--sf", default="stockfish", help="stockfish binary path")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--depth", type=int, default=12)
    ap.add_argument("--every", type=int, default=50000, help="checkpoint interval per worker")
    args = ap.parse_args()

    raw, count = read_ndd1(args.inp)
    fens = open(args.fens).read().splitlines()
    idxs = [int(x) for x in open(args.fens + ".idx").read().split()]
    if len(fens) != len(idxs):
        sys.exit("fens/.idx length mismatch")
    print(f"labeling {len(fens)} of {count} records at depth {args.depth} with {args.workers} workers")

    # Contiguous slices per worker.
    bounds = [len(fens) * i // args.workers for i in range(args.workers + 1)]
    threads = []
    progress = queue.Queue()
    for w in range(args.workers):
        lo, hi = bounds[w], bounds[w + 1]
        threads.append(
            threading.Thread(
                target=worker,
                args=(w, fens[lo:hi], idxs[lo:hi], args.sf, args.depth,
                      f"{args.out}.part{w}", args.every, progress),
                daemon=True,
            )
        )
    for t in threads:
        t.start()
    live = args.workers
    while live:
        wid, k, total, dt = progress.get()
        if k < 0:
            print(f"worker {wid} done: {total} pos in {dt:.0f}s", flush=True)
            live -= 1
        else:
            print(f"worker {wid}: {k}/{total} ({k / max(dt, 1):.0f}/s)", flush=True)
    for t in threads:
        t.join()

    # Merge part files into the output NDD1: replace bytes 33-34 of each
    # labeled record; unlabeled records keep their original label bytes.
    labels = {}
    for w in range(args.workers):
        p = f"{args.out}.part{w}"
        if os.path.exists(p):
            for line in open(p):
                idx_s, cp_s = line.split()
                labels[int(idx_s)] = int(cp_s)
    out = bytearray(raw)
    for i, cp in labels.items():
        struct.pack_into("<h", out, 8 + i * RECORD + 33, cp)
    tmp = args.out + ".tmp"
    with open(tmp, "wb") as f:
        f.write(out)
    os.replace(tmp, args.out)
    print(f"wrote {args.out}: {len(labels)} SF labels, {len(fens) - len(labels)} carried over, {count} total")


if __name__ == "__main__":
    main()
