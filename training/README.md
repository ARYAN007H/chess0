# NNUE Training Runbook — zero local compute required

Everything runs on GitHub Actions (data) and Kaggle (GPU training). Your PC is
only used for a browser.

## Step 0 — prerequisites

- A GitHub account (have it) with the repo's Actions enabled
- A Kaggle account (free, kaggle.com — sign in with Google works)
- Nothing installed locally. No Kaggle CLI.

## Step 0.5 — shortcut: the Stockfish-22 Kaggle dataset (RECOMMENDED for v1)

Skip generating data entirely: the Kaggle dataset
[`ronakbadhe/chess-evaluations`](https://www.kaggle.com/datasets/ronakbadhe/chess-evaluations)
has ~12.9M positions labeled by **Stockfish 11 at depth 22** — stronger
teachers than our own depth-6 labels. The trainer reads its CSV directly:

- In the Kaggle notebook, **Add Input** → search → add `chess-evaluations`
- Train with: `!python nnue_train.py --data /kaggle/input/chess-evaluations/chessData.csv --max-positions 6000000 ...`
  (the `--csv` path converts white-POV labels to STM-POV, skips mate rows,
  and subsamples; first parse takes ~10 min for the full file)
- Check the dataset's license on its Data Card before we bake derived weights
  into the repo (most of these are permissive; confirm).

Our own Data Factory (below) matters later — distillation rounds need labels
from searches that use the *net itself*, which no external dataset provides.

## Step 1 — generate training data (GitHub Actions, one click)

1. Repo → **Actions** → **NNUE Data Factory** → **Run workflow**
2. Inputs: `games` = 12000 (more = better; this takes a few hours), `depth` = 6
3. Wait for both stages to finish. The final artifact is named
   `nnue-data-v1-<run id>` and contains `data/nnue-data-v1.bin`
   (12k games ≈ 1.1M positions ≈ ~40MB — a good first dataset; rerun the
   workflow a few times and merge datasets on Kaggle for 3-10M+ positions).

## Step 2 — get the data into Kaggle

1. Download the `nnue-data-v1-<run id>` artifact from the run page (browser
   unzip if needed — you want the `.bin` inside)
2. kaggle.com → **Datasets** → **New Dataset** → drag the `.bin` in → name it
   `chess0-nnue-data` → Create (private is fine)

## Step 3 — train (Kaggle GPU, free)

1. kaggle.com → **Code** → **New Notebook**
2. Right panel → **Session options** → **Accelerator** → **GPU T4 x2** (any GPU)
3. **Input** → **Add Input** → your `chess0-nnue-data` dataset
4. **File** → **Import Notebook** — or simply create these cells:

Cell 1 (upload the trainer — copy the contents of `training/nnue_train.py`):

```
%%writefile nnue_train.py
<paste the full contents of training/nnue_train.py here>
```

Cell 2 (train — Kaggle data mounts at `/kaggle/input/`):

```
!python nnue_train.py \
    --data /kaggle/input/chess0-nnue-data/nnue-data-v1.bin \
    --out /kaggle/working/nnue-v1.bin \
    --checkpoint /kaggle/working/nnue_float.pt \
    --epochs 8 --batch 16384 --lr 1e-3
```

5. **Run All**. Expect: ~1-3 hours on the T4 for ~1M positions × 8 epochs
   (the trainer prints baseline/epoch/final losses and 3 reference evals).
6. Notebook **Save Version** → the output pane will contain `nnue-v1.bin` →
   download it.

## Step 4 — validate (one command to me, or one click in Actions)

Drop `nnue-v1.bin` into the repo (or hand it over in chat — it's ~110KB) and:

- Quick sanity: `npx tsx scripts/nnue-verify.ts data/nnue-v1.bin` — the evals
  printed must match the trainer's reference evals within a few cp.
- The real test: `npx tsx scripts/match.ts --a v3base --b v3nnue --pairs 40`
  — the net plays v3 search with the NNUE eval vs the tuned hand-written
  champion. It ships only if it wins (same 60% bar).

## Step 5 — what's next (distillation)

If the net wins: it becomes the new eval. Re-run the Data Factory — it now
labels positions with searches that use the *net*, which are stronger than
the net itself. Train a bigger/refreshed net on that data. Each round stacks.
(That's Phase 2 in ROADMAP.md.)

## Troubleshooting

- **Trainer prints "data: 0 positions"** — the `.bin` didn't upload; check the
  Kaggle dataset contains the file at the path given to `--data`.
- **Reference evals differ wildly from TS** — the feature extraction or
  quantization spec drifted between `nnue_train.py` and `src/engine/nnue.ts`;
  both files carry the same spec block, diff them.
- **Kaggle session dies at ~9-12h** — the trainer checkpoints `nnue_float.pt`;
  re-attach and continue, or just rerun with more data (the schedule restarts).
- **GPU quota exhausted** — Kaggle gives ~30 GPU-hours/week; the CPU path also
  works (same command, no accelerator), just ~5-8× slower.
