# Chess0 — Strength Roadmap

State at 2026-11-03: v3 engine + tuned hand-written eval, continuous
champion/challenger tuning running on GitHub Actions (12k games/cycle,
80-game gates, ~7% false-accept). Deployed site plays factory defaults until
a harvest step deliberately wires champions into the build.

Long-term goal: ~3000 Elo bot. Honest in-browser ceiling: ~2600-2900 measured.

## Phase 0 — Texel eval tuning (RUNNING, autonomous)

- Two chains (v3 flagship, v2 ladder), each: corpus → tune → 80-game gate →
  promote-or-discard → auto-chain. Stop switches:
  `gh variable set TUNING_V3_ENABLED --body false` (same for `V2`).
- **Harvest**: stop both, then wire `data/params-current[-v2].json` into the
  build so the site bot plays the tuned eval (deliberate, gated step).
- Exit signal for this phase: gates reject challengers for many consecutive
  cycles → hand-written eval is squeezed dry → start Phase 1.

## Phase 1 — NNUE v1 (code built; training after Phase 0 harvest)

- **Architecture**: 768×16×2 → 32 → 1. STM-perspective piece-square features
  (12×64, sparse ~32 active), two accumulator views (own/opponent),
  int16/int8 quantized, **~25,700 params (~51KB)**.
- **Data**: `scripts/gen-nnue-data.ts` — self-play positions labeled by
  depth-6 search scores using the tuned champion eval (the search embeds
  tactics the static eval can't see — this is what lets the net exceed its
  teacher). 4-VM matrix shards, same machinery as the corpus pipeline.
  Target: 10-40M positions (~360MB binary per 10M).
- **Training**: `training/nnue_train.py` (PyTorch) on free Kaggle/Colab GPU —
  no local compute needed. Exports quantized `data/nnue-v1.bin`.
- **Validation**: `scripts/match.ts --a v3base --b v3nnue` — the net ships
  only if it beats the hand-written champion in the same 80-game gate.
- **Integration**: eval-override hook in evalV3 (`setEvalOverride`) +
  `v3nnue` match variant.
- **Expected**: +150-250 Elo over the tuned hand eval.

## Phase 1.5 — Rust/WASM speed pass

- NNUE eval rewritten in **Rust → wasm-pack (WASM SIMD)** for the browser:
  ~2-5× JS eval speed; the accumulator update vectorizes perfectly.
- Same Rust source compiles to a **native Linux binary** for the Actions
  labelers → 3-5× labeling throughput → more training data per day.
- Drop-in swap via the eval-override hook; no search changes.
- WebGPU deliberately excluded: NNUE-in-search is latency-bound, not
  throughput-bound.

## Phase 2 — Distillation ladder (the Stockfish method)

- Retrain the net on positions labeled by deep searches that **use the
  current net** (net → deeper searches → better labels → better net).
- Each round stacks +100-300 Elo with diminishing returns; data needs grow.
- This is the loop that actually climbs toward the ceiling.

## Phase 3 — Bigger nets

- 768×32×2 → 32 → 1 (~100KB), then HalfKAv2-style king-bucket features
  (32 king buckets × 768) — the real king-safety learner (~25MB net).
- Requires: incremental accumulator updates in make/unmake (the true NNUE
  trick) and the WASM hot path from Phase 1.5.

## Phase 4 — Native core (optional)

- Full Rust core (search + eval) with napi-rs for the Node server + wasm for
  the browser. Only worth it if self-hosting a native bot; the TS engine is
  working and tested, and the site bot stays browser-bound on GH Pages.

## Other deferred items

- **Leaderboard + Elo ranking system** — key decision: where ratings live
  (server-side in `server.ts` for online rooms vs localStorage for the static
  Pages site). Likely hybrid.
- **Syzygy tablebases** (WASM, endgame-only) — perfect endgames, modest Elo.
- **Site harvest ritual** — after each phase: wire champion params / winning
  net into the deployed build, re-run the 80-game gate as regression proof,
  redeploy, verify live.
