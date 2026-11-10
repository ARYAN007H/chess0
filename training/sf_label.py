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
import glob
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


class EngineDied(RuntimeError):
    """The engine process closed its stdout (crash / OOM kill / bad binary)."""


class Stockfish:
    """Minimal UCI wrapper: one engine per worker, Threads=1."""

    def __init__(self, sf_path, depth, hash_mb=64, movetime=0, no_nnue=False):
        self.depth = depth
        self.movetime = movetime  # optional wall cap per position (seconds)
        self.recent: list[str] = []
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
        if no_nnue:
            # Classical eval: no SIMD NNUE kernels. Escape hatch for VMs whose
            # CPUID advertises features the hypervisor actually SIGILLs on —
            # SF dies mid-search at the first NNUE eval (Kaggle, 2026-11-05).
            self._send("setoption name Use NNUE value false")
        self._send("isready")
        while self._recv() != "readyok":
            pass

    def _send(self, cmd):
        self.proc.stdin.write(cmd + "\n")
        self.proc.stdin.flush()

    def _recv(self):
        line = self.proc.stdout.readline()
        if not line:
            tail = " | ".join(self.recent[-3:])
            raise EngineDied(f"engine stdout closed (recent: {tail or 'nothing'})")
        line = line.strip()
        if line:
            self.recent.append(line[:120])
        return line

    def label(self, fen):
        """→ int cp from STM POV, or None for mate / no score."""
        self._send(f"position fen {fen}")
        go = f"go depth {self.depth}"
        if self.movetime > 0:
            go += f" movetime {self.movetime * 1000}"
        self._send(go)
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

    def quit(self):
        try:
            self._send("quit")
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()


def worker(wid, fen_slice, rec_slice, sf_path, depth, out_path, every, progress, movetime=0, no_nnue=False):
    """Labels a contiguous slice; writes (index, cp) to its part file.

    Hardened (v2): respawns the engine when it dies (corrupted binary, OOM
    kill, ...), retries the same position, skips after repeated failures, and
    ALWAYS sends the done-sentinel so the main thread can never block forever.
    """
    done = set()
    if os.path.exists(out_path):
        with open(out_path) as f:
            for line in f:
                idx_s, cp_s = line.split()
                done.add(int(idx_s))
    todo = [(i, fen) for i, fen in zip(rec_slice, fen_slice) if i not in done]
    total = len(todo)
    engine = None
    labeled = 0
    fails = 0
    skipped = 0
    t0 = time.time()
    k = 0
    try:
        while k < total:
            idx, fen = todo[k]
            if engine is None:
                engine = Stockfish(sf_path, depth, movetime=movetime, no_nnue=no_nnue)
            try:
                cp = engine.label(fen)
            except EngineDied as e:
                # quiet log: full reason only for the first death of a streak,
                # then one summary line per 50 skips — a dense poison region
                # otherwise buries the run log in respawn spam (looked broken
                # to a human watching; the worker was fine)
                if fails == 0:
                    print(f"[w{wid}] engine died at record {idx}: {e}", flush=True)
                elif fails % 50 == 0:
                    print(f"[w{wid}] ... {fails} deaths so far (record {idx})", flush=True)
                try:
                    if engine is not None:
                        engine.quit()
                except Exception:
                    pass
                engine = None
                fails += 1
                if fails >= 2:
                    # two fresh engines died on this record: a deterministic
                    # poison position (kills SF mid-search on current CPU fleets,
                    # 2026-11-09 investigation — silent SIGILL during NNUE eval,
                    # ISA-independent, position-deterministic). Skip the record
                    # (carried over UNCHANGED with its original depth-6 label);
                    # the old abandon-at-20 logic turned small poison clusters
                    # into total slice failure (runs 42500963402, 42699040490,
                    # 42703527040, 42709275808 all produced ~300 labels/shard).
                    skipped += 1
                    k += 1
                    fails = 0
                    if skipped * 4 > total:
                        print(f"[w{wid}] >25% of slice poisoned — abandoning", flush=True)
                        break
                continue  # first death: retry once with a fresh engine (transient rate ~0.5%)
            fails = 0
            k += 1
            labeled += 1
            if cp is not None:
                with open(out_path, "a") as f:
                    f.write(f"{idx} {max(-CP_CLAMP, min(CP_CLAMP, cp))}\n")
            if labeled % 2000 == 0:
                progress.put((wid, labeled, total, time.time() - t0))
    finally:
        if engine is not None:
            engine.quit()
        progress.put((wid, -1, labeled, time.time() - t0))
        if skipped:
            print(f"[w{wid}] skipped {skipped} positions", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--in", dest="inp", required=True, help="NDD1 .bin (positions + result bytes)")
    ap.add_argument("--fens", required=True, help="FEN list from nnue_to_fen.py")
    ap.add_argument("--out", required=True, help="output NDD1 with SF labels")
    ap.add_argument("--sf", default="stockfish", help="stockfish binary path")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--depth", type=int, default=12)
    ap.add_argument("--every", type=int, default=50000, help="checkpoint interval per worker")
    ap.add_argument("--movetime", type=int, default=0, help="optional per-position wall cap, seconds (0 = off)")
    ap.add_argument("--no-nnue", action="store_true", help="classical eval (Use NNUE false) — for VMs that SIGILL on NNUE kernels")
    ap.add_argument("--shard", type=int, default=0, help="shard index (0-based)")
    ap.add_argument("--shards", type=int, default=1, help="total shards; >1 slices the FEN list")
    ap.add_argument("--merge-only", action="store_true", help="skip labeling; merge existing part files into --out")
    args = ap.parse_args()

    raw, count = read_ndd1(args.inp)
    if args.merge_only:
        _merge(args, raw, count, 0)
        return
    fens = open(args.fens).read().splitlines()
    idxs = [int(x) for x in open(args.fens + ".idx").read().split()]
    if len(fens) != len(idxs):
        sys.exit("fens/.idx length mismatch")
    if args.shards > 1:
        lo = len(fens) * args.shard // args.shards
        hi = len(fens) * (args.shard + 1) // args.shards
        fens, idxs = fens[lo:hi], idxs[lo:hi]
    print(f"labeling {len(fens)} of {count} records at depth {args.depth} with {args.workers} workers"
          + (f" (shard {args.shard}/{args.shards})" if args.shards > 1 else ""))

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
                      f"{args.out}.part{args.shard * 100 + w}", args.every, progress, args.movetime, args.no_nnue),
                daemon=True,
            )
        )
    for t in threads:
        t.start()
    done_workers = 0
    while done_workers < args.workers:
        try:
            wid, k, total, dt = progress.get(timeout=180)
        except queue.Empty:
            alive = sum(1 for t in threads if t.is_alive())
            print(f"[watchdog] {alive}/{args.workers} workers alive", flush=True)
            if alive == 0:
                print("[watchdog] all workers dead — merging what we have", flush=True)
                break
            continue
        if k < 0:
            print(f"worker {wid} done: {total} pos in {dt:.0f}s", flush=True)
            done_workers += 1
        else:
            print(f"worker {wid}: {k}/{total} ({k / max(dt, 1):.0f}/s)", flush=True)
    for t in threads:
        t.join()

    _merge(args, raw, count, len(fens))




def _merge(args, raw, count, n_fens):
    """Merge part files into the output NDD1: replace bytes 33-34 of each
    labeled record; unlabeled records keep their original label bytes."""
    labels = {}
    for p in glob.glob(args.out + ".part*"):
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
    print(f"wrote {args.out}: {len(labels)} SF labels, {n_fens - len(labels)} carried over, {count} total")


if __name__ == "__main__":
    main()
