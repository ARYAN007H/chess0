/**
 * Champion/challenger tuning session driver (used by .github/workflows/tune.yml
 * and runnable locally: `npx tsx scripts/tune-session.ts --cycles 3`).
 *
 * Each cycle:
 *   1. Generate a fresh self-play corpus with the CURRENT CHAMPION params.
 *   2. Tune a challenger starting from the champion (validation early-stopping).
 *   3. Gate: challenger vs champion in a real played match. The champion is
 *      replaced ONLY if the challenger's score exceeds the acceptance
 *      threshold. Otherwise the challenger is discarded.
 *   4. On acceptance, data/params-current.json is updated and committed.
 *
 * All artifacts (corpora, challenger params, match logs) land in data/artifacts/
 * for upload by the workflow.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';

const arg = (name: string, def: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
};
const CYCLES = arg('cycles', 3);
const CORPUS_GAMES = arg('corpus-games', 3000);
const CORPUS_DEPTH = arg('corpus-depth', 5);
const SWEEPS = arg('sweeps', 8);
const MATCH_PAIRS = arg('match-pairs', 20); // 2x pairs games
const MOVETIME = arg('movetime', 250);
const ACCEPT_MIN_SCORE = arg('accept-score', 52); // challenger must score > this % vs champion

const CHAMPION = 'data/params-current.json';
const CHALLENGER = 'data/tuned-params.json';
const ARTIFACTS = 'data/artifacts';
mkdirSync(ARTIFACTS, { recursive: true });

if (!existsSync(CHAMPION)) {
  writeFileSync(
    CHAMPION,
    JSON.stringify({ note: 'factory defaults (see src/engine/evalV3Params.ts)', scalars: {}, tables: {} }, null, 2) + '\n',
  );
  console.log(`seeded ${CHAMPION} with factory defaults`);
}

interface ApplyShape {
  scalars: Record<string, number>;
  tables: Record<string, number[]>;
}

function run(cmd: string, args: string[], label: string): string {
  console.log(`\n=== ${label}: ${cmd} ${args.join(' ')}`);
  const t0 = Date.now();
  const res = spawnSync('npx', ['tsx', cmd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (res.stdout ?? '') + (res.stderr ?? '');
  process.stdout.write(out.slice(-4000));
  console.log(`(${((Date.now() - t0) / 60000).toFixed(1)} min, exit ${res.status})`);
  if (res.status !== 0) throw new Error(`${label} failed with exit ${res.status}`);
  return out;
}

let accepted = 0;
for (let cycle = 1; cycle <= CYCLES; cycle++) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  console.log(`\n########## CYCLE ${cycle}/${CYCLES} ##########`);

  const corpus = `${ARTIFACTS}/corpus-${cycle}.txt`;
  run('scripts/gen-corpus.ts', ['--games', String(CORPUS_GAMES), '--depth', String(CORPUS_DEPTH), '--out', corpus, '--params', CHAMPION], `cycle ${cycle} corpus`);

  run('scripts/texel-tune.ts', ['--corpus', corpus, '--base', CHAMPION, '--sweeps', String(SWEEPS)], `cycle ${cycle} tune`);
  copyFileSync(CHALLENGER, `${ARTIFACTS}/challenger-${cycle}.json`);

  const matchOut = run('scripts/match.ts', ['--a', 'v3base', '--b', 'v3tuned', '--pairs', String(MATCH_PAIRS), '--movetime', String(MOVETIME)], `cycle ${cycle} gate`);
  writeFileSync(`${ARTIFACTS}/gate-${cycle}.log`, matchOut);

  // Parse the challenger's score percentage from the match output.
  const m = matchOut.match(/v3tuned: (\d+)W (\d+)D (\d+)L/);
  let scorePct = 50;
  if (m) {
    const [w, d] = [Number(m[1]), Number(m[2])];
    const n = Number(m[1]) + Number(m[2]) + Number(m[3]);
    scorePct = (100 * (w + 0.5 * d)) / Math.max(1, n);
  }
  const acceptedThis = scorePct > ACCEPT_MIN_SCORE;
  console.log(`\nCYCLE ${cycle} GATE: challenger scored ${scorePct.toFixed(1)}% vs champion (accept > ${ACCEPT_MIN_SCORE}%) -> ${acceptedThis ? 'ACCEPT' : 'DISCARD'}`);

  if (acceptedThis) {
    copyFileSync(CHALLENGER, CHAMPION);
    accepted++;
    try {
      spawnSync('git', ['add', CHAMPION], { encoding: 'utf8' });
      const c = spawnSync(
        'git',
        ['commit', '-m', `tune: accept cycle ${cycle} challenger (${scorePct.toFixed(1)}% vs champion, ${MOVETIME}ms)`],
        { encoding: 'utf8' },
      );
      if (c.status === 0) console.log(`committed new champion (${CHAMPION})`);
    } catch {
      /* local runs without git: keep going */
    }
  } else {
    // Restore the challenger file to the champion so the next cycle starts clean.
    copyFileSync(CHAMPION, CHALLENGER);
  }
}

console.log(`\n########## SESSION DONE: ${accepted}/${CYCLES} cycles accepted ##########`);
