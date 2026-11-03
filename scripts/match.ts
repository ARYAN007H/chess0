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
const MOVETIME = Math.max(50, arg('movetime', 250));
const BOOK_PLIES = Math.max(0, arg('book-plies', 6));
const MAX_PLIES = 300;

type Variant = 'v2' | 'v3' | 'v3tuned' | 'v3base' | 'v2tuned' | 'v2base' | 'v3nnue';
const SIDE_A = argStr('a', 'v2') as Variant;
const SIDE_B = argStr('b', 'v3') as Variant;

// --- per-variant eval params (for the *tuned/*base variants) --------------------

const PARAMS_SPEC: Partial<Record<Variant, { file: string; kind: 'v3' | 'v2' }>> = {
  v3tuned: { file: 'data/tuned-params.json', kind: 'v3' },
  v3base: { file: 'data/params-current.json', kind: 'v3' },
  v2tuned: { file: 'data/tuned-params-v2.json', kind: 'v2' },
  v2base: { file: 'data/params-current-v2.json', kind: 'v2' },
};

const NNUE_FILE = 'data/nnue-v1.bin';
let nnueLoadedFor: Variant | null = null;

const paramsCache = new Map<Variant, { scalars: Record<string, number>; tables: Record<string, number[]> } | null>();

function applySideParams(side: Variant): void {
  // NNUE eval override: v3 search (make/unmake, TT, ordering) with the net
  // answering leaf evaluations. Mutually exclusive with v3 eval-params tweaks.
  if (side === 'v3nnue') {
    resetEvalParams();
    resetEvalV2Params();
    if (nnueLoadedFor !== side) {
      clearNnue();
      loadNnueWeights(readFileSync(NNUE_FILE));
      nnueLoadedFor = side;
      console.log(`loaded ${NNUE_FILE}`);
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
};
let games = 0;
const t0 = Date.now();

for (let p = 1; p <= PAIRS; p++) {
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
}

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
if (s > 0.5) console.log(`VERDICT: ${SIDE_B} is stronger`);
else if (s < 0.5) console.log(`VERDICT: ${SIDE_A} is stronger`);
else console.log('VERDICT: even');
