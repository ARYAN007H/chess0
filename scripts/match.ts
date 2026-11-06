/**
 * Strength match between engine variants (run with `npx tsx scripts/match.ts`).
 *
 * Plays paired games with color-swapped openings sampled from the shared
 * opening book, counts results, and estimates an Elo difference with a 95% CI.
 *
 *   npx tsx scripts/match.ts [--pairs 15] [--movetime 250] [--book-plies 6]
 *                            [--a v2] [--b v3]
 *
 * Variants: v2 | v3 | v3tuned (v3 with data/tuned-params.json applied).
 *
 * Add --sprt for a sequential promotion gate instead of a fixed game count.
 * SPRT defaults: H0 = 0 Elo, H1 = +30 Elo, alpha = 0.05, beta = 0.10,
 * draw-rate = 0.50. It emits `SPRT: ACCEPT|REJECT|INCONCLUSIVE`, which
 * tune-session parses; the legacy fixed-score bar remains for --no-sprt.
 */

import { newStartPosition } from '../src/engine/position';
import type { Position } from '../src/engine/position';
import { Engine } from '../src/engine/engine';
import { probeBookV3 } from '../src/engine/bookV3';
import { insufficientMaterial } from '../src/engine/eval';
import { inCheckOf } from '../src/engine/movegen';
import { evalV3Params, applyEvalParams, resetEvalParams } from '../src/engine/evalV3Params';
import { evalV2Params, applyEvalV2Params, resetEvalV2Params } from '../src/engine/evalV2Params';
import { setEvalOverride } from '../src/engine/evalV3';
import { loadNnueWeights, evalNnueWhitePov, clearNnue } from '../src/engine/nnue';
import { clearEvalCaches } from '../src/engine/evalV3';
import { readFileSync } from 'node:fs';

// --- args -------------------------------------------------------------------

const arg = (name: string, def: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
};
const argStr = (name: string, def: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const PAIRS = Math.max(1, arg('pairs', 15));
const WALL_BUDGET_MIN = Math.max(0, arg('wall-budget-min', 0)); // 0 = off (review P2: SPRT ceiling vs job cap)
const MOVETIME = Math.max(50, arg('movetime', 250));
const BOOK_PLIES = Math.max(0, arg('book-plies', 6));
const MAX_PLIES = 300;

type Variant = 'v2' | 'v3' | 'v3tuned' | 'v3base' | 'v2tuned' | 'v2base' | 'v3nnue' | 'v3nnue2';
const SIDE_A = argStr('a', 'v2') as Variant;
const SIDE_B = argStr('b', 'v3') as Variant;

// --- SPRT gate ---------------------------------------------------------------
// Trinomial model: with an assumed draw rate d, score p implies
// win = p - d/2 and loss = 1 - p - d/2. Draws carry no evidence when d is the
// same under both hypotheses; wins/losses drive the LLR.
const SPRT = process.argv.includes('--sprt');
const SPRT_ELO0 = arg('sprt-elo0', 0);
const SPRT_ELO1 = arg('sprt-elo1', 30);
const SPRT_ALPHA = arg('alpha', 0.05);
const SPRT_BETA = arg('beta', 0.1);
const SPRT_DRAW_RATE = arg('draw-rate', 0.5);

const sprtConfig = (() => {
  if (!SPRT) return null;
  if (!(SPRT_ELO1 > SPRT_ELO0)) throw new Error(`--sprt-elo1 (${SPRT_ELO1}) must exceed --sprt-elo0 (${SPRT_ELO0})`);
  if (!(SPRT_ALPHA > 0 && SPRT_ALPHA < 1)) throw new Error(`--alpha must be in (0,1), got ${SPRT_ALPHA}`);
  if (!(SPRT_BETA > 0 && SPRT_BETA < 1)) throw new Error(`--beta must be in (0,1), got ${SPRT_BETA}`);
  if (!(SPRT_DRAW_RATE >= 0 && SPRT_DRAW_RATE < 1)) throw new Error(`--draw-rate must be in [0,1), got ${SPRT_DRAW_RATE}`);
  const score = (elo: number): number => 1 / (1 + Math.pow(10, -elo / 400));
  const p0 = score(SPRT_ELO0);
  const p1 = score(SPRT_ELO1);
  const w0 = p0 - SPRT_DRAW_RATE / 2;
  const l0 = 1 - p0 - SPRT_DRAW_RATE / 2;
  const w1 = p1 - SPRT_DRAW_RATE / 2;
  const l1 = 1 - p1 - SPRT_DRAW_RATE / 2;
  if (Math.min(w0, l0, w1, l1) <= 0) {
    throw new Error(`draw rate ${SPRT_DRAW_RATE} makes an implied W/L probability non-positive`);
  }
  return {
    lower: Math.log(SPRT_BETA / (1 - SPRT_ALPHA)),
    upper: Math.log((1 - SPRT_BETA) / SPRT_ALPHA),
    llrWin: Math.log(w1 / w0),
    llrLoss: Math.log(l1 / l0),
    p0,
    p1,
  };
})();

// --- per-variant eval params (for the *tuned/*base variants) --------------------

const PARAMS_SPEC: Partial<Record<Variant, { file: string; kind: 'v3' | 'v2' }>> = {
  v3tuned: { file: 'data/tuned-params.json', kind: 'v3' },
  v3base: { file: 'data/params-current.json', kind: 'v3' },
  v2tuned: { file: 'data/tuned-params-v2.json', kind: 'v2' },
  v2base: { file: 'data/params-current-v2.json', kind: 'v2' },
};

const NNUE_FILE = 'data/nnue-v1.bin';
// Second NNUE slot (net-vs-net gates: champion vs challenger). Each NNUE
// side reloads its file only when the OTHER NNUE side played last; the swap
// bumps loadStamp, so per-switch accumulator repair costs hit both sides
// equally.
const NNUE_FILE2 = argStr('nnue2', '');
const NNUE_FILES: Partial<Record<Variant, string>> = { v3nnue: NNUE_FILE, v3nnue2: NNUE_FILE2 };
if ((SIDE_A === 'v3nnue2' || SIDE_B === 'v3nnue2') && !NNUE_FILE2) {
  throw new Error('--nnue2 <file> is required when a side is v3nnue2');
}
let nnueLoadedFor: Variant | null = null;

const paramsCache = new Map<Variant, { scalars: Record<string, number>; tables: Record<string, number[]> } | null>();

function applySideParams(side: Variant): void {
  // NNUE eval override: v3 search (make/unmake, TT, ordering) with the net
  // answering leaf evaluations. Mutually exclusive with v3 eval-params tweaks.
  const nnueFile = NNUE_FILES[side];
  if (nnueFile) {
    resetEvalParams();
    resetEvalV2Params();
    if (nnueLoadedFor !== side) {
      clearNnue();
      loadNnueWeights(readFileSync(nnueFile));
      nnueLoadedFor = side;
      console.log(`loaded ${nnueFile}`);
    }
    setEvalOverride(evalNnueWhitePov);
    clearEvalCaches();
    return;
  }
  setEvalOverride(null);
  const spec = PARAMS_SPEC[side];
  if (!paramsCache.has(side)) {
    paramsCache.set(
      side,
      spec
        ? (JSON.parse(readFileSync(spec.file, 'utf8')) as {
            scalars: Record<string, number>;
            tables: Record<string, number[]>;
          })
        : null,
    );
  }
  const raw = paramsCache.get(side);
  if (raw && spec) {
    if (spec.kind === 'v3') {
      applyEvalParams(raw.scalars as Partial<Record<keyof typeof evalV3Params, number>>, raw.tables);
    } else {
      applyEvalV2Params(raw.scalars as Partial<Record<keyof typeof evalV2Params, number>>, raw.tables);
    }
  } else {
    resetEvalParams();
    resetEvalV2Params();
  }
  clearEvalCaches();
}

function searchVariant(side: Variant): 'v2' | 'v3' {
  return side === 'v2' || side === 'v2base' || side === 'v2tuned' ? 'v2' : 'v3';
}

interface Tally {
  win: number;
  draw: number;
  loss: number;
  nodes: number;
  plies: number;
}

function newTally(): Tally {
  return { win: 0, draw: 0, loss: 0, nodes: 0, plies: 0 };
}

// --- opening sampling ---------------------------------------------------------

/** Sample `plies` book moves (weighted random) for opening variety. */
function sampleOpening(plies: number): string[] {
  const pos = newStartPosition();
  const uci: string[] = [];
  for (let i = 0; i < plies; i++) {
    const candidates = probeBookV3(pos);
    if (candidates.length === 0) break;
    let total = 0;
    for (const c of candidates) total += c.weight;
    let roll = Math.random() * total;
    let picked = candidates[candidates.length - 1];
    for (const c of candidates) {
      roll -= c.weight;
      if (roll <= 0) {
        picked = c;
        break;
      }
    }
    uci.push(picked.uci);
    makeUci(pos, picked.uci);
  }
  return uci;
}

function makeUci(pos: Position, uci: string): void {
  const eng = new Engine();
  eng.pos = pos;
  const m = eng.uciToMove(uci);
  if (m === null) throw new Error(`book move ${uci} illegal in ${toFenSafe(pos)}`);
  eng.applyMove(m);
}

function toFenSafe(pos: Position): string {
  const eng = new Engine();
  eng.pos = pos;
  return eng.fen();
}

// --- game state ---------------------------------------------------------------

function repetitionKey(pos: Position): string {
  // board + stm + castling + ep (ignore move counters)
  const eng = new Engine();
  eng.pos = pos;
  const parts = eng.fen().split(' ');
  return `${parts[0]} ${parts[1]} ${parts[2]} ${parts[3]}`;
}

/** Returns '1-0' | '0-1' | '1/2-1/2' | null (game continues). */
function gameResult(pos: Position, history: Map<string, number>): '1-0' | '0-1' | '1/2-1/2' | null {
  const eng = new Engine();
  eng.pos = pos;
  const moves = eng.legalMoves();
  if (moves.length === 0) {
    if (inCheckOf(pos, pos.stm)) return pos.stm === 0 ? '0-1' : '1-0';
    return '1/2-1/2';
  }
  if (insufficientMaterial(pos)) return '1/2-1/2';
  if (pos.halfmove >= 100) return '1/2-1/2';
  const key = repetitionKey(pos);
  if ((history.get(key) ?? 0) >= 3) return '1/2-1/2';
  return null;
}

// --- play one game -------------------------------------------------------------

interface GameOutcome {
  result: '1-0' | '0-1' | '1/2-1/2';
  plies: number;
  nodesA: number;
  nodesB: number;
}

function playGame(openingUci: string[], aWhite: boolean): GameOutcome {
  // One engine instance per side per game (TTs live at module level and persist
  // across moves, exactly like the UI engine's long-lived instance).
  const engines: Record<'A' | 'B', Engine> = { A: new Engine(), B: new Engine() };
  const game = new Engine();
  for (const uci of openingUci) game.applyUci(uci);

  const sideToMove = (): 'A' | 'B' => {
    const whiteToMove = game.stm === 0;
    const aIsMover = whiteToMove === aWhite;
    return aIsMover ? 'A' : 'B';
  };

  const history = new Map<string, number>();
  const nodes = { A: 0, B: 0 };
  let plies = 0;

  for (;;) {
    const res = gameResult(game.pos, history);
    if (res) return { result: res, plies, nodesA: nodes.A, nodesB: nodes.B };
    if (plies >= MAX_PLIES) return { result: '1/2-1/2', plies, nodesA: nodes.A, nodesB: nodes.B };

    const key = repetitionKey(game.pos);
    history.set(key, (history.get(key) ?? 0) + 1);

    const side = sideToMove();
    const variant = side === 'A' ? SIDE_A : SIDE_B;
    applySideParams(variant);
    const engine = engines[side];
    engine.reset(game.fen());
    let uci: string | null = null;
    try {
      const search = engine.search({ movetime: MOVETIME, variant: searchVariant(variant) });
      nodes[side] += search.nodes;
      uci = search.bestMoveUci;
    } catch (err) {
      console.error(`  !! ${variant} search threw at ply ${plies}: ${err}`);
      return { result: side === 'A' ? '0-1' : '1-0', plies, nodesA: nodes.A, nodesB: nodes.B };
    }
    if (!uci || game.applyUci(uci) === null) {
      console.error(`  !! ${variant} returned illegal move ${uci}`);
      return { result: side === 'A' ? '0-1' : '1-0', plies, nodesA: nodes.A, nodesB: nodes.B };
    }
    plies++;
  }
}

// --- main -----------------------------------------------------------------------

const tally: Record<Variant, Tally> = {
  v2: newTally(),
  v3: newTally(),
  v3tuned: newTally(),
  v3base: newTally(),
  v2tuned: newTally(),
  v2base: newTally(),
  v3nnue: newTally(),
  v3nnue2: newTally(),
};
let games = 0;
let sprtResult: 'ACCEPT' | 'REJECT' | 'INCONCLUSIVE' | null = null;
let sprtLlr = 0;
const t0 = Date.now();

outer: for (let p = 1; p <= PAIRS; p++) {
  // Review P2: a borderline SPRT challenger can walk to the full pair ceiling
  // (~290-580 min) and hit the job's 330-min timeout. Stop early as
  // INCONCLUSIVE instead; the next cron cycle re-runs it. SPRT-only — the
  // legacy --no-sprt gate keeps its fixed pair count.
  if (sprtConfig && WALL_BUDGET_MIN > 0 && p > 1 && (Date.now() - t0) / 60000 >= WALL_BUDGET_MIN) {
    console.log(`wall budget ${WALL_BUDGET_MIN} min reached after ${games} games — stopping (INCONCLUSIVE)`);
    break outer;
  }
  const opening = sampleOpening(BOOK_PLIES);
  const openName = opening.join(' ') || '(startpos)';

  for (const aWhite of [true, false]) {
    const out = playGame(opening, aWhite);
    games++;
    const bWhite = !aWhite;
    // Side B's score from B's perspective
    let bScore: number;
    if (out.result === '1/2-1/2') bScore = 0.5;
    else {
      const whiteWon = out.result === '1-0';
      bScore = whiteWon === bWhite ? 1 : 0;
    }
    const aScore = 1 - bScore;
    const bump = (side: Variant, s: number) => {
      if (s === 1) tally[side].win++;
      else if (s === 0.5) tally[side].draw++;
      else tally[side].loss++;
    };
    bump(SIDE_A, aScore);
    bump(SIDE_B, bScore);
    tally[SIDE_A].nodes += out.nodesA;
    tally[SIDE_B].nodes += out.nodesB;
    tally[SIDE_A].plies += out.plies;
    tally[SIDE_B].plies += out.plies;

    const w = aWhite ? SIDE_A : SIDE_B;
    const b = aWhite ? SIDE_B : SIDE_A;
    console.log(
      `game ${String(games).padStart(2)} [${w} W vs ${b} B] ${out.result} in ${out.plies} plies  ` +
        `opening: ${openName.length > 48 ? openName.slice(0, 45) + '...' : openName}`,
    );
  }

  if (sprtConfig) {
    const t = tally[SIDE_B];
    sprtLlr = t.win * sprtConfig.llrWin + t.loss * sprtConfig.llrLoss;
    const scorePct = (100 * (t.win + 0.5 * t.draw)) / games;
    if (p % 10 === 0 || sprtLlr >= sprtConfig.upper || sprtLlr <= sprtConfig.lower) {
      console.log(
        `SPRT p=${p} games=${games} score=${scorePct.toFixed(1)}% LLR=${sprtLlr.toFixed(2)} ` +
          `bounds=[${sprtConfig.lower.toFixed(2)}, ${sprtConfig.upper.toFixed(2)}]`,
      );
    }
    if (sprtLlr >= sprtConfig.upper) {
      sprtResult = 'ACCEPT';
      break outer;
    }
    if (sprtLlr <= sprtConfig.lower) {
      sprtResult = 'REJECT';
      break outer;
    }
  }
}
if (sprtConfig && sprtResult === null) sprtResult = 'INCONCLUSIVE';

// --- elo estimate -----------------------------------------------------------------

// Measured from SIDE_B's perspective (the "challenger" side).
const s = (tally[SIDE_B].win + 0.5 * tally[SIDE_B].draw) / games;
let eloLine: string;
if (s <= 0 || s >= 1) {
  eloLine = s >= 1 ? `${SIDE_B} won 100% — Elo gap exceeds ~800` : `${SIDE_B} scored 0%`;
} else {
  const diff = 400 * Math.log10(s / (1 - s));
  const sigmaScore = Math.sqrt((s * (1 - s)) / games);
  const sigmaElo = (400 * sigmaScore) / (Math.LN10 * s * (1 - s));
  eloLine = `${SIDE_B} = +${diff.toFixed(0)} Elo vs ${SIDE_A}  ±${(1.96 * sigmaElo).toFixed(0)} (95% CI)`;
}

const mins = ((Date.now() - t0) / 60000).toFixed(1);
console.log('\n========== MATCH RESULT ==========');
console.log(`${SIDE_A} vs ${SIDE_B}   games: ${games}  movetime: ${MOVETIME}ms  book plies: ${BOOK_PLIES}  wall: ${mins} min`);
for (const side of [SIDE_A, SIDE_B]) {
  const t = tally[side];
  console.log(`${side}: ${t.win}W ${t.draw}D ${t.loss}L   avg nodes/game ${(t.nodes / games / 1000).toFixed(0)}k`);
}
console.log(`avg game length: ${((tally[SIDE_A].plies + tally[SIDE_B].plies) / (2 * games)).toFixed(0)} plies`);
console.log(eloLine);
if (sprtConfig) {
  const t = tally[SIDE_B];
  const scorePct = (100 * (t.win + 0.5 * t.draw)) / games;
  console.log(
    `SPRT: ${sprtResult}  H0 ${SPRT_ELO0} Elo vs H1 ${SPRT_ELO1} Elo  ` +
      `alpha ${SPRT_ALPHA} beta ${SPRT_BETA} draw ${SPRT_DRAW_RATE}  ` +
      `games ${games}  score ${scorePct.toFixed(1)}%  LLR ${sprtLlr.toFixed(2)}`,
  );
  if (sprtResult === 'ACCEPT') console.log(`VERDICT: ${SIDE_B} is stronger`);
  else if (sprtResult === 'REJECT' && s < 0.5) console.log(`VERDICT: ${SIDE_A} is stronger`);
  else console.log('VERDICT: inconclusive');
} else if (s > 0.5) console.log(`VERDICT: ${SIDE_B} is stronger`);
else if (s < 0.5) console.log(`VERDICT: ${SIDE_A} is stronger`);
else console.log('VERDICT: even');
