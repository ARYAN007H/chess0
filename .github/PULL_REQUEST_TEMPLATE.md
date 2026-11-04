<!--
Thanks for contributing to Chess0! Keep the PR small and focused.
See CONTRIBUTING.md for the gate table — paste the relevant output below.
-->

## What & why

<!-- One paragraph: what changes, and why. Link the issue if there is one. -->

## Gates run

<!-- Check what you ran and paste a short output tail. -->

- [ ] `npx tsc --noEmit`
- [ ] `npm test`
- [ ] `npm run perft` (required for `position.ts` / `movegen.ts` / `types.ts` changes)
- [ ] `npm run bench` (required for eval/search changes — cite depth/nodes/nps)
- [ ] `npx tsx scripts/nnue-verify.ts` (required if `nnue.ts` / `nnue_train.py` changed)
- [ ] Visual check in light **and** dark themes (required for UI changes)

## Notes for reviewers

<!-- Anything subtle: invariants touched, perf trade-offs, what you rejected. -->
