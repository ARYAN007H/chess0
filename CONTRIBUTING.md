# Contributing to Chess0

Thanks for your interest! Chess0 is a from-scratch chess engine and
workbench — no chess libraries anywhere — and there's genuinely fun work at
every layer: the engine core, the React UI, the NNUE pipeline, and the
self-tuning loop.

New here? Read [ARCHITECTURE.md](ARCHITECTURE.md) for the map of the
codebase, then come back. If you work with AI coding agents, also see
[AGENTS.md](AGENTS.md) — this repo has an established multi-agent workflow.

## Getting started

```bash
git clone <your fork>
cd chess0
npm install        # or: bun install
npm run dev        # app + multiplayer server at http://localhost:3000
npm test           # correctness suite
npm run perft:quick
```

If all gates pass on a fresh clone, your environment is right.

## Finding something to work on

- **[ROADMAP.md](ROADMAP.md)** tracks the strength roadmap (texel tuning →
  NNUE → distillation → bigger nets → optional native core).
- Good first contributions that don't require engine PhD:
  - **UI polish** — the workbench is actively developed; check both themes
  - **Puzzle & lesson content** — `src/engine/puzzles.ts`,
    `src/engine/lessons.ts` are data-driven and easy to extend
  - **Opening book data** — expand `src/engine/bookV3.ts` repertoire
  - **Docs & examples** — corrections are as welcome as features
  - **Test coverage** — edge cases in SAN, FEN, draw detection, analysis
- Engine-eval/search changes are welcome too, but they must pass the
  strength gate (see below) — ideas alone don't move Elo, games do.

## The rules of the engine

1. `src/engine/` contains **no DOM, React, or I/O** — it must keep running
   in a Web Worker and under UCI (`npm run uci`).
2. **Zero allocation on the hot path** — packed 32-bit moves, typed arrays,
   preallocated undo stacks.
3. **Incremental == recomputed** — board, Zobrist hash, eval accumulators,
   piece counts and NNUE accumulators are maintained incrementally and
   verified by random-walk tests. If you add cached state, add such a test.
4. **NNUE parity** — `src/engine/nnue.ts` and `training/nnue_train.py`
   mirror each other bit-for-bit. Change both or neither, and run
   `npx tsx scripts/nnue-verify.ts`.

## Gates before every PR

| Command | When |
| --- | --- |
| `npx tsc --noEmit` | always |
| `npm test` | always |
| `npm run perft` | if you touched `position.ts`, `movegen.ts` or `types.ts` |
| `npm run bench` | if you touched eval/search — cite the numbers in your PR |
| `npx tsx scripts/nnue-verify.ts` | if you touched the NNUE pair |
| manual look in light + dark | if you touched UI |

Paste the relevant gate output into your PR description. Strength claims
("my eval change is +30 Elo") need a reproducible run:
`npx tsx scripts/match.ts --help` shows the champion/challenger harness
(80 games, ≥ 60 % to accept).

## Process

1. **Fork & branch** from `main` — `feat/<topic>`, `fix/<topic>`, `docs/<topic>`.
2. **Small, focused PRs** — one idea per PR; a bug fix shouldn't refactor
   three files along the way.
3. **Commit style** matches history: `feat:`, `fix:`, `docs:`, `chore:`,
   `tune:`, `harden:` prefixes, imperative mood, under ~72 chars.
4. **Describe the why** — especially for engine changes: what did you try,
   what did the gate say, what did you reject?
5. CI runs on your PR; a maintainer reviews. For anything touching the
   tuning/data pipelines, ping the maintainer first — those workflows have
   cost and safety implications (see AGENTS.md §CI workflows).

## Style notes

- TypeScript strict mode; match the surrounding code's comment density and
  naming. Spec blocks at the top of engine files are load-bearing — update
  them when you change the code they describe.
- UI styling goes through the **semantic token system** in `src/index.css`
  (`bg-surface`, `text-ink-2`, `border-line`, …) — no new arbitrary hex
  colors, and every screen should look deliberate in both themes.
- No new runtime dependencies without discussion first.

## Conduct & questions

Be decent — the short version of the
[Code of Conduct](CODE_OF_CONDUCT.md) is: critique code, not people.
If something in the docs is wrong or stale, that's a bug — open an issue or
PR against it.
