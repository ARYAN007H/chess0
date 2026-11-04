# AGENTS.md — operating rules for AI agents in this repo

This repository is developed partly by AI agents (Claude Code, ZCode and
friends) working alongside the human maintainer. If you are an agent, this
file is your briefing. Read it fully before touching anything.

## What this repo is

Chess0 — a from-scratch TypeScript chess engine (0x88, zero-alloc, three
search generations), a React workbench UI, a Python NNUE training pipeline,
and a self-play tuning loop on GitHub Actions.

- Architecture deep-dive: [ARCHITECTURE.md](ARCHITECTURE.md)
- Contributor mechanics: [CONTRIBUTING.md](CONTRIBUTING.md)
- Strength roadmap: [ROADMAP.md](ROADMAP.md)

## First, read the room

1. **[agentchat.md](agentchat.md)** — the multi-agent coordination log.
   Entries are appended with `### <date> — agent-<name>` and carry
   `STATUS` / `WHAT` / notes. Read the last several entries before doing
   anything: they describe in-flight branches, held merges, and hazards.
2. **[handover.md](handover.md)** — cold-start handover for the NNUE
   campaign: gate ladder results, key discoveries, traps that actually bit,
   infrastructure runbooks, pending queue.
3. **`git status` and `git log --oneline -10`** — the shared working tree
   often carries uncommitted work from another session. Do not revert,
   stage, or "clean up" files you did not touch.

## Mandatory gates

Run from the repo root. A change is not done until the relevant gates pass.

| Change touches | Gates |
| --- | --- |
| Anything | `npx tsc --noEmit` |
| Engine, UI, scripts | `npm test` |
| `position.ts` / `movegen.ts` / `types.ts` (movegen semantics) | `npm run perft:quick` — full `npm run perft` before the PR |
| Eval or search strength claims | `npm run bench` (reproduce numbers, cite them) |
| `src/engine/nnue.ts` or `training/nnue_train.py` | `npx tsx scripts/nnue-verify.ts` (TS↔PY parity) and change **both files or neither** |
| Styling | visual check in **both** light and dark themes (`npm run dev`, port 3000) |

The engine laws (see ARCHITECTURE.md §Design invariants) are enforced by
tests, but understand them before refactoring: no DOM in `src/engine/`,
zero allocation on the hot path, incremental state must equal recomputed
state after arbitrary make/unmake walks.

## Git discipline

- Branch from `main`; branch names like `feat/<area>-<topic>`.
- Commit prefixes match history: `feat:`, `fix:`, `docs:`, `chore:`,
  `tune:`, `harden:`.
- **Never force-push `main`. Never commit directly to `main`** unless the
  maintainer explicitly asks.
- Only stage files **you** created or modified. The working tree routinely
  contains another session's in-flight work (e.g. tuning files that predate
  a pipeline repair). Before staging anything you did not author, `git diff`
  it against `main` and ask the maintainer if unsure.
- Never commit `data/*.bin` (multi-GB training artifacts), `node_modules`,
  or scratch/worktree directories. `agentchat.md` and `handover.md` are
  living docs — commit them only when the maintainer asks.

## Multi-agent protocol

- **Log your session** in `agentchat.md` when you start meaningful work and
  when you finish or pause: timestamp, your agent name, `STATUS`, what you
  changed, and — critically — the exact file list that is "yours" so other
  sessions don't stage your half-done work by mistake.
- If your session left work uncommitted, say so explicitly in the log with
  the branch and file list.
- Held decisions (merges, publishes, workflow triggers) belong to the human
  maintainer. Do not merge PRs, trigger the tuning/data workflows, or push
  to `main` without an explicit instruction.
- External review results (Gemini/DeepSeek/Claude review passes) are logged
  in `agentchat.md` and `handover.md` — search them before re-reporting a
  known issue.

## CI workflows (`.github/workflows/`)

| Workflow | What it does | Caution |
| --- | --- | --- |
| `deploy.yml` | builds and publishes GitHub Pages on push to `main` | automatic, no action needed |
| `tune.yml` | matrix-parallel overnight texel-tune + match sessions | costs Actions minutes; maintainer triggers |
| `nnue-data.yml` | samples + labels Lichess data into `.bin` corpora | large artifacts; maintainer triggers |
| `nnue-smoke.yml` | trainer smoke test on tiny data | safe |

## UI conventions

Tailwind v4 with a semantic token system in `src/index.css` (`bg-surface`,
`bg-sunken`, `text-ink-2`, `border-line`, `text-accent-text`, `.btn-primary`,
`.field`, `.seg`, …). Do not add new arbitrary hex colors or one-off
component classes — extend the token system instead, and keep both themes
deliberate (equal treatment, not light-plus-afterthought).
