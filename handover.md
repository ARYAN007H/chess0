# Chess0 NNUE Campaign — Handover (2026-11-05)

New sessions: read this file top to bottom. It supersedes chat history.
Related docs: `ROADMAP.md` (phased plan), `agentchat.md` (multi-agent hub — DeepSeek
works here as "agent-1"; read its rules before touching the shared tree),
`training/README.md` (NNUE runbook), `training/nnue_train.py` header (data/feature/quant specs).

## 1. Project & goal

- Repo: `~/Documents/projects/chess engine` → `github.com/ARYAN007H/chess0` (public). TypeScript
  chess engine + React/Vite UI, GitHub Pages deploy (bun, `deploy.yml`).
- Goal: ~3000-strength bot. Measured reality: browser ceiling ~2600-2900. Path = NNUE nets
  (quality) × WASM SIMD (speed) × distillation (teacher quality). Hand-written v3 eval ships today.
- User: Aryan. Learning ML through this project — explain ML concepts from chess-engine examples.
  Prefers direct answers ("just answer" when asked a yes/no). Potato PC: 8GB RAM, slow hotspot
  (~300kB/s). All heavy compute is cloud (GitHub Actions CPU, Kaggle GPU/CPU).

## 2. Gate ladder — every NNUE net so far (all vs `v3base` = **factory hand eval**, 80 games, 250ms)

| net | data | gate | note |
|---|---|---|---|
| 20M prefix | first 20M rows | **−158 ±84** | |
| 50M prefix | first 50M | **−93 ±79** | draw rate jumped 7.5%→~50% |
| 100M prefix | first 100M | **−89 ±79** | saturation vs 50M within noise |
| distilled R1 | 100M net + 1.26M depth-6 self-play labels (lr 1e-4 × 2ep) | **−127 ±81** | WEAK TEACHER regression |
| **100M + incremental acc** | same 100M data, 2.8× faster eval (PR #1) | **+22 ±76 PASS** | FIRST POSITIVE GATE — the speed work is worth ~+111 vs the −89 pre-acc benchmark (80 games, 38W 9D 33L) |
| **100M+acc + SF-teacher** | fine-tuned on 868,742 SF-17 depth-12 labels (GH Actions pipeline, PR #5) | **+48 ±76 PASS** | NEW CHAMPION — teacher-quality axis delivered ~+26 over +22. Round 3 skipped the weak depth-8 teacher entirely; labels from `nnue-sf-labels.yml` run 42060471468 |
| uniform-20m + acc | uniform 20M sample, 32-wide | **−89 ±79 REJECT** | composition helped vs 20M-prefix (−158) but volume wins: 100M-prefix+acc = +22, gap ~+111. 100M-uniform pretrain DEMOTED below SF-teacher / arch v2 |
| 64-wide 100M + acc | same 100M data, 2× width | **−44 ±77 REJECT** | width tax confirmed: 1805k nodes/game vs the 32w's 3922k (9.7µs vs 4.15µs walk). Capacity axis CLOSED at current eval speed — revisit only AFTER WASM; arch v2 (SCReLU) should stay 32-wide-first |

- Node deficit is constant across ALL gates: nets search ~43% fewer nodes (eval ~4-4.5µs JS vs
  ~0.3µs hand eval). This is the primary structural deficit → WASM SIMD (Phase 1.5) is the fix.
- Fair-holdout numbers (1M rows from shards the nets never saw, SF depth-20 labels,
  via `training/eval_nnue.py`): 100M float MAE 178.7 / sign 77.9%; distilled 182.9 / 77.2%
  (worse in every bucket → weak-teacher regression proven statistically). Endgames weakest by far
  (MAE 453 vs 93 opening) — a training-round target. Val losses across runs are NOT comparable
  (different splits); only gates + this fair holdout compare.

## 3. The five key discoveries (do not re-learn these the hard way)

1. **The Lichess dedup dataset is FEN-SORTED before sharding.** `--max-positions N` trains on a
   narrow lexicographic FEN-range prefix (shard mate% varies 11→26→3). Every prefix run this week
   was composition-biased; the 50M→100M "saturation" is confounded by it. agent-1 built uniform
   resamples over all 259M filtered rows (depth≥20 labels): `data/lichess-uniform-20m.bin` (train),
   `-1m.bin` (holdout), `-fair-1m.bin` (zero-leakage, shards 4-9 only) + `manifest.json`.
   Validated through our gates: 73.3%/71.5% POV agreement, 2-3pt gaps, zero spec violations.
   **Never use --max-positions prefixes on this dataset for final runs.**
2. **Data volume is DONE as a lever at 32-wide.** 50M→100M bought +4 Elo (noise). The 340M pretrain
   was CANCELLED. Remaining levers: teacher quality (SF/deeper labels), width (64-wide test running),
   eval speed (WASM), composition (uniform experiment pending).
3. **Distillation needs a stronger teacher than the student already had.** Round 1 fine-tuned the
   100M net (SF depth-15 labels) toward depth-6 factory-search labels → net regressed −89→−127.
   The 0.0056 "better fit" was faithfully learning a shallower evaluator. Round 2 uses depth-8
   self-play labels (dispatched); round 3 should use **Stockfish itself as teacher on Kaggle CPU**
   (designed, see §7; license OK per Lichess-CC0 precedent — we never embed SF code).
4. **The texel tuning loop never worked.** 75 runs, ZERO published champions: both early accepts
   were eaten by a dirty-index push bug; post-fix challengers average ~49-51% (the 60%-of-80 gate
   needed ~+70 Elo). `data/params-current*.json` on main are FACTORY defaults — the NNUE "tuned
   champion" framing was wrong; v3base is the plain hand eval (still the right yardstick — it ships).
   agent-1's T1-T4 (uncommitted, review verdict APPROVE) fixes: champion-base preservation +
   semantic bounds (T1), game-grouped validation + `g<id>` corpus format (T2), SPRT gate in
   match.ts `--sprt` H0=0/H1=+30, fail-safe parse, engine draw-rates 0.5/0.7 (T3), accept markers +
   post-push byte-verify (T4). tsc/tests/smokes all green on that tree.
5. **POV audit calibration** (don't "fix" the thresholds back): material-sign agreement on Lichess
   data is 68-73% — HEALTHY. Real perspective bugs show as white-vs-black stm-gap >8pts and/or
   <52% overall. All three data paths (parquet/csv/bin) now carry the audit; .bin also validates
   stm/piece-code/result bytes per chunk.

## 4. Infrastructure

### Kaggle (CLI fully operational)
- CLI: `~/.venvs/kaggle/bin/kaggle` (v2.2.5). Token: `~/.kaggle/access_token` (KGAT, picked up
  natively; or env KAGGLE_API_TOKEN). Account: **imhumon**.
- Kernels: `imhumon/v2-nnue` (pretrain history: v2=20M, v3=50M, v4?=100M — outputs contain
  nnue-v3-100m.bin + nnue_float_100m.pt), `imhumon/v2-nnue-finetune` (distilled R1:
  nnue-distilled-r1.bin + nnue_distilled_r1.pt), `imhumon/v2-nnue-64w` (RUNNING: 64-wide,
  outputs will be nnue-v4-64w.bin + nnue_float_64w.pt).
- Datasets: `imhumon/chess0-nnue-selfplay-r1` (1.26M depth-6 self-play),
  `imhumon/chess0-lichess-uniform` (UPLOADING: uniform-20m + both holdouts + the 2 float
  checkpoints), `mateuszgrzybpl/lichess-chess-positions-ml-ready-and-deduplicated` (source parquet,
  340M rows, FEN-sorted!).
- Push pattern: build `<slug>.ipynb` + `kernel-metadata.json` (id/title/code_file/enable_gpu/
  enable_internet/dataset_sources/kernel_sources) → `kaggle kernels push -p dir` → poll
  `kernels status` → `kernels output <ref> -p dir`. **kernel_sources mounts the LATEST version's
  output — only push dependent kernels after the source kernel status is COMPLETE.** Use
  `$(find /kaggle/input -name ...)` paths in cells (mount paths vary). GPU quota was ~26h
  (resets ~Nov 7); CPU sessions don't burn GPU quota.

### GitHub
- `nnue-data.yml` data factory: dispatch inputs games/depth; 4 shards → merged artifact
  `nnue-data-v1-<run_id>` (NDD1). Depth-8/8k-games run **41863006262 in flight** (round-2 teacher).
  Note: matrix contended by the tune chains; shards timeout at 350min (GH job cap 360).
- `nnue-smoke.yml`: smoke train + **TS↔PY reference-eval diff gate** (line-for-line).
- `tune.yml` champion/challenger chains (12k/cycle, 80-game gates) — still running but per the
  audit never publishes; stop switches: `gh variable set TUNING_V3_ENABLED --body false` (+V2).
- Gates are local: install net to `data/nnue-v1.bin` (match.ts hardcodes it; swap file per gate),
  verify `npx tsx scripts/nnue-verify.ts data/nnue-v1.bin` (must match the trainer's printed
  `eval ...` lines line-for-line), then `npx tsx scripts/match.ts --a v3base --b v3nnue --pairs 40
  --movetime 250` (~32 min; agent-1's `--sprt` available on the parallel-testing tree).

### Local
- Test kit: `/tmp/pov-probe/` (test_gate.py POV scenarios, test_trainer.py e2e+parity+guards+poison,
  test_parallel.py parallel≡sequential). Venv: `/tmp/nnue-venv` (pyarrow numpy fsspec aiohttp +
  torch from the CPU wheel index). **`/tmp` WIPES ON REBOOT (happened twice)** — recreate venv +
  re-stage `/tmp/kk/` bundles (uniform-train staged; finetune bundle needs re-staging before round 2).
- Staged kernel bundles: `/tmp/kk/uniform-train` (ready), `/tmp/kk/64w` (pushed), finetune (gone).
- Trainer (`training/nnue_train.py`) features: POV audit all paths, .bin spec validation, blob
  round-trip reference evals, block-shuffle epochs, atomic checkpoints + best-val quantization,
  grad clip, parallel parquet decoder (spawn NOT fork — pyarrow threadpools crash forked children;
  canary with explicit floor; imap_unordered incremental audit; scratch streaming+unlink),
  `--h1/--h2` width flags, `--resume`, `--scratch-dir`, `--workers`, `--seed`.

## 5. In flight right now (2026-11-05 ~02:00, session 2)

1. **80-game gate RUNNING locally** (`/tmp/gate-final.log`): v3base vs v3nnue with the 100M net +
   the NEW incremental-accumulator eval (see §10). A pre-fix run collapsed 0-26 via the
   stale-slot trap (§7) — fixed, bisected (old-code control 5-5, accumulators-only 1-9,
   post-fix 10-game probe +35 ±216). Next: uniform-20m gate (net pulled + parity-verified at
   /tmp/kk/uniform-out/nnue-v5-uniform20m.bin; trainer refs 27/36/170/-106 match TS exactly).
2. **SF-teacher kernel `imhumon/v2-nnue-sf-teacher` RUNNING** (Kaggle CPU, zero GPU): labels the
   depth-8 self-play set (868,742 positions, dataset `chess0-nnue-selfplay-depth8`) with
   Stockfish depth-12 via `training/sf_label.py` (+ `training/nnue_to_fen.py`; both live in the
   dataset, smoke-tested locally with SF 17.1: handshake fix uciok, 200-pos round-trip clean,
   corr(orig,sf)=0.40). Output `nnue-data-sf12.bin` → fine-tune nnue_float_100m.pt → gate.
   Round 2 (depth-8 self-play labels) was SKIPPED — same weak-teacher trap as R1 (depth-8 is
   still weaker than the 100M net's depth-15 diet); the depth-8 set is used as the position
   source instead.
3. 64-wide kernel RUNNING → pull → gate vs −89 (64-wide eval ~2× cost — with incremental
   accumulators the tax is ~1.3×, re-measure with scripts/nnue-speed.ts before gating).
4. Texel chains cycling (no publishes expected — that's known).
5. agent-1's T1-T4 sit uncommitted on branch `parallel-testing` (= main). Review APPROVE. Needs
   Aryan's merge decision; hub rules want branch→PR→CI→review.
6. Uncommitted this session (mine): src/engine/{nnue,position,evalV3}.ts (incremental acc +
   eval-cache-for-override), src/engine/nnue.test.ts (5 tests), scripts/{nnue-speed,nnue-nodes,
   nnue-probe-game}.ts, training/{nnue_to_fen,sf_label}.py, handover trap. Awaiting gate + Aryan
   before committing (hub rules).

## 6. Pending queue (decision-ordered)

1. **Uniform-20m gate** (net verified, waiting for the current gate to finish — one match at a
   time). Benchmark to beat: 20M-prefix −158. If uniform lands near −89 or better → composition
   confirmed → next: 100M-uniform pretrain (corrected ladder).
2. **SF-teacher round 3**: when `v2-nnue-sf-teacher` completes → pull `nnue-data-sf12.bin` →
   fine-tune `nnue_float_100m.pt` (LOWER lr than R1: 2e-5, 1 epoch — R1's 2ep@1e-4 moved too far)
   → gate. License: Lichess CC0 precedent; unmodified SF as offline tool; document lineage.
3. **WASM SIMD (Phase 1.5)**: incremental accumulators (TS) already banked the first ~2.8× (§10);
   WASM attacks the remaining layer2/3 cost. Same Rust source compiles native for fast GitHub
   labeling. Start after uniform verdict.
4. **Merge agent-1's T1-T4** (after Aryan approves) → the chains start publishing + SPRT everywhere.
5. **CP-scale calibration** (Gemini #3): measure net-vs-label regression slope on fair-1m → one
   multiplier in the engine path. Now MORE relevant: with the node tax gone, eval scale drives
   pruning margins (rfp 65×d etc. tuned for the hand eval's scale).
6. Later: QAT-lite, quiet filter, tempo double-count A/B, WDL blending, endgame-focused data,
   arch v2 (b2/b3 + SCReLU), harvest wiring.

## 7. Traps (each one actually bit us)

- **NNUE accumulator stacks must be invalidated by parseFen (2026-11-05, cost a 1-9 gate).**
  Engine.reset() re-parses FENs on the SAME Position every move; computeDerived now stamps
  nnueStamp=-1/validFrom=Infinity. A stale slot 0 poisoned every root eval while eval-vs-recompute
  tests stayed bit-exact (they all use fresh Positions; clones null the stack). Any new placement
  mutation outside makeMove needs the same invalidation. Regression test: nnue.test.ts
  "invalidates on parseFen of a REUSED position".
- `pkill -f "match.ts ..."` matches YOUR OWN tool-call shell — kill by PID from pgrep, or split
  the pattern.
- `/tmp` wipes on reboot; `nohup X &` inside a tool call dies with the shell — use run_in_background.
- match.ts is hardcoded to `data/nnue-v1.bin` — swap the file per gate, keep `data/nnue-v1-<n>.bin`
  backups. The shared tree carries agent-1's uncommitted edits — `git status` + check diffs before
  running repo scripts; his changes were verified additive-safe once already.
- Spawn (not fork) for any pyarrow multiprocessing. Test scripts need `if __name__ == "__main__"`
  guards or spawn re-executes them.
- Kaggle notebook cells: trainer code comes from `curl raw.githubusercontent.com/.../main/...` —
  verify with the grep-echo cell before training; multi-line `\`-continuation inside `!` cells works.
- Dataset/kernel mount paths vary — use `$(find /kaggle/input -name ...)`.
- `kaggle datasets status` prints junk on missing datasets; verify with `datasets list --mine`.
- PEP 668: system python is externally managed — always use venvs locally.
- Slow hotspot: big uploads/downloads must be run_in_background; 719MB ≈ 30-40 min.
- npm installs locally: `npm install --no-package-lock` (bun.lock is authoritative).
- POV audit floors are calibrated (52% floor / 8pt gap) — a Lichess-like dataset scoring ~70% is
  HEALTHY. Early canary floor is explicit (`fail_reason(min_rows=...)`).

## 9. External review triage — Gemini ("argon"), 2026-11-05 (10-point repo review, no chat context)

**Adopt (new items, ranked):**
1. **Incremental accumulators** — store `accStack = Int16Array(MAX_PLY × 2 × H1)` on Position (like
   histMg/histEg); makeMove updates 1-2 features (2×H1 ops), unmakeMove = pointer decrement.
   ~3-5× eval speedup in PURE TS (Gemini says 5-8× — optimistic; layer2/3 + gather remain).
   Our v1 deliberately deferred this; it is now the TOP speed lever, before/instead of WASM.
   Traps: castling/ep/promotion multi-piece updates; searchV3 clone paths must carry the stack.
2. **Eval cache with distinct salt for v3nnue** — move `evalOverride` inside the cache-miss path
   (evalV3.ts:214 short-circuits before EVAL_CACHE today, by my old anti-pollution design).
   Gives v3nnue the ~25-40% hit rate v3base gets. Cheap.
3. **CP-scale calibration** — modern SF normalizes its eval scale; Lichess labels may be new-scale
   while searchV3 margins (rfp 65×d, futility 110/220, delta 190) assume classic scale. Measure the
   net-vs-label regression slope on fair-1m → one multiplier in the engine path. (Was queued as
   "eval-scale calibration"; Gemini adds the SF-normalization cause.)
4. **QAT-lite** — post-step `w1.data.clamp_(-0.95, 0.95)` + per-epoch INTEGER-parity loss via
   `load_quantized_bin` (already built) so best-val selection is quantization-exact. Full STE: skip.
5. **Quiet filter** — drop parquet rows with `|cp − material_cp| > 600` (pending tactical shots) as
   a composition experiment. In-check filter needs legality code (~40 lines) — later.
6. **Architecture v2 (later)**: b2/b3 biases (currently absent by v1 design, not a bug) + SCReLU
   activation (modern standard; careful: act² overflows int32 at QA=1024 → format version bump).
   Width choice informed by the 64-wide result.

**Wrong / already-done (don't follow blindly):**
- "More unfiltered rows hurt the net" — FALSE: 50M→100M was −93→−89 (flat); the R1 regression was
  the weak teacher. Quiet-filtering still worth testing as composition, not as bug fix.
- Shard-bias fix (#7) — already shipped better: agent-1's uniform sampler + fair-1m holdout.
- SPRT (#10) — already implemented by agent-1 (verified live). match.ts opening seeding: check.
- WDL blending (#9) — already queued; result byte exists for it.
- Blind mop-up/OCB on NNUE scores (#2b) — gate as an experiment; hand rules aren't calibrated
  with the net's endgame scale.
- "30-60 min parse" — actually 2.5h at 100M (worse than stated → their pre-bake point is MORE
  right); agent-1's uniform .bin already implements the pattern for that corpus.

**Synthesis:** Gemini independently re-derived our top conclusion (node tax = primary lever) from
code alone. Revised order: uniform verdict → #1+#2 (TS speed, no toolchain) → SF teacher ×
uniform data → #3/#4/#5 cheap wins → arch v2 → WASM on top of incremental.

## 8. Reply-style notes for the next agent

- User checks screenshots/logs rather than pasting text — read them carefully and answer the
  actual question first, then act.
- Quality guarantee the user cares about: "genuinely producing improvements and not reducing
  quality" — nothing ships without the 80-game gate; report failures plainly (the user rewards
  honest "this failed and here's why").
- The user is quota- and time-conscious: prefer experiments that are cheap, parallel, and
  decision-relevant; cancel runs whose projected value collapsed (we killed 340M).
- Live status reports with tables work well for this user.

## 10. Session 2 (2026-11-05 ~02:00) — incremental accumulators + eval cache SHIPPED (pending gate)

**Gemini #1 + #2 implemented and verified; numbers:**

| metric | before | after |
|---|---|---|
| NNUE eval (search path, live stack, kiwipete) | ~4-4.5 µs | **1.55 µs** (≈2.8×) |
| search throughput vs v3base (fixed d9, 6 FENs) | 0.57× | **1.17×** |
| node deficit vs v3base (handover baseline) | −43% | **flipped to surplus** on 5/6 FENs |

- **Design**: `pos.nnueStack` Int32Array MAX_HIST × 4 × H1 (slot layout [V0W|V0B|V1W|V1B]; the two
  trained views have INDEPENDENT w1 tensors, so 4 accumulators cover both perspectives; read
  (V0W,V1B) when white moves, (V0B,V1W) when black). makeMove: `nnueAccPush` copies slot ply→ply+1
  (copyWithin) then ≤5 feature-row updates; unmake = ply decrement; makeNullMove = push only.
  nnueStamp guards net reloads; nnueValidFrom guards mid-line bootstraps; transient evals (no live
  stack) recompute into a shared module scratch slot (zero alloc, cost ≈ old full recompute —
  it does 2× layer-1 arithmetic by computing all 4 views).
- **eval-cache for the override** (evalV3.ts): override scores BYPASS the eval cache entirely —
  evalV3WhitePov returns evalOverride(pos) before any cache read/write (structurally pollution-
  free; no cache entry can mix hand-eval and NNUE scores). setEvalOverride does NOT bump
  evalCacheGen (only invalidateEvalCaches/clearEvalCaches do). Correction of an earlier
  description that claimed cache-flow + gen-bumps (review P2-2, 2026-11-05).
- **Speed/sanity kit** (keep using): `scripts/nnue-speed.ts` (old-vs-new parity + µs, two modes),
  `scripts/nnue-nodes.ts` (alternating fixed-depth node rates), `scripts/nnue-probe-game.ts`
  (move-by-move single game; CLEAR_TT=1 env toggles per-ply TT clear), `scripts/nnue-verify.ts`
  (TS↔PY reference lines — must match trainer stdout line-for-line).
- **Verification state**: tsc clean; 5 nnue tests green (random-game parity 30×80 plies,
  make/unmake round-trips, clone+below-watermark+null, re-used-position parseFen regression,
  castling/ep/promotion); npm test green; nnue-verify parity exact for BOTH nets (100M: 48/0/111/−52;
  uniform-20m: 27/36/170/−106).
- **The 1-9 incident**: pre-fix match collapsed 0-26 then 1-9 (old-code control 5-5 = even) —
  root cause stale slot 0 on Engine.reset() re-parse (§7 trap #1). Fixed in computeDerived.
  Benchmarks below were measured POST-fix except the fixed-depth table above (which used fresh
  positions per FEN — unaffected by that bug).
