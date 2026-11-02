/**
 * Strength match between engine variants (run with `npx tsx scripts/match.ts`).
 *
 * Plays paired games with color-swapped openings sampled from the shared
 * opening book, counts results, and estimates an Elo difference with a 95% CI.
 *
 *   npx tsx scripts/match.ts [--pairs 15] [--movetime 250] [--book-plies 6]
 */

import { newStartPosition } from '../src/engine/position';
import type { Position } from '../src/engine/position';
import { Engine } from '../src/engine/engine';
import { probeBookV3 } from '../src/engine/bookV3';
import { insufficientMaterial } from '../src/engine/eval';
import { inCheckOf } from '../src/engine/movegen';

// --- args -------------------------------------------------------------------

const arg = (name: string, def: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
};
const PAIRS = Math.max(1, arg('pairs', 15));
const MOVETIME = Math.max(50, arg('movetime', 250));
const BOOK_PLIES = Math.max(0, arg('book-plies', 6));
const MAX_PLIES = 300;

type Variant = 'v2' | 'v3';

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
  nodesV2: number;
  nodesV3: number;
}

function playGame(openingUci: string[], v2White: boolean): GameOutcome {
  // One engine instance per variant per game (TTs live at module level and persist
  // across moves, exactly like the UI engine's long-lived instance).
  const engines: Record<Variant, Engine> = { v2: new Engine(), v3: new Engine() };
  const game = new Engine();
  for (const uci of openingUci) game.applyUci(uci);

  const variantOf = (): Variant => {
    const whiteToMove = game.stm === 0;
    const mover: Variant = whiteToMove === v2White ? 'v2' : 'v3';
    return mover;
  };

  const history = new Map<string, number>();
  const counts: Record<Variant, { nodes: number }> = { v2: { nodes: 0 }, v3: { nodes: 0 } };
  let plies = 0;

  for (;;) {
    const res = gameResult(game.pos, history);
    if (res) return { result: res, plies, nodesV2: counts.v2.nodes, nodesV3: counts.v3.nodes };
    if (plies >= MAX_PLIES) return { result: '1/2-1/2', plies, nodesV2: counts.v2.nodes, nodesV3: counts.v3.nodes };

    const key = repetitionKey(game.pos);
    history.set(key, (history.get(key) ?? 0) + 1);

    const variant = variantOf();
    const engine = engines[variant];
    engine.reset(game.fen());
    let uci: string | null = null;
    try {
      const search = engine.search({ movetime: MOVETIME, variant });
      counts[variant].nodes += search.nodes;
      uci = search.bestMoveUci;
    } catch (err) {
      console.error(`  !! ${variant} search threw at ply ${plies}: ${err}`);
      return { result: variant === 'v2' ? '0-1' : '1-0', plies, nodesV2: counts.v2.nodes, nodesV3: counts.v3.nodes };
    }
    if (!uci || game.applyUci(uci) === null) {
      console.error(`  !! ${variant} returned illegal move ${uci}`);
      return { result: variant === 'v2' ? '0-1' : '1-0', plies, nodesV2: counts.v2.nodes, nodesV3: counts.v3.nodes };
    }
    plies++;
  }
}

// --- main -----------------------------------------------------------------------

const tally: Record<Variant, Tally> = { v2: newTally(), v3: newTally() };
let games = 0;
const t0 = Date.now();

for (let p = 1; p <= PAIRS; p++) {
  const opening = sampleOpening(BOOK_PLIES);
  const openName = opening.join(' ') || '(startpos)';

  for (const v2White of [true, false]) {
    const out = playGame(opening, v2White);
    games++;
    const v3White = !v2White;
    // v3 result from v3's perspective
    let v3Score: number;
    if (out.result === '1/2-1/2') v3Score = 0.5;
    else {
      const whiteWon = out.result === '1-0';
      v3Score = whiteWon === v3White ? 1 : 0;
    }
    const v2Score = 1 - v3Score;
    if (v3Score === 1) tally.v3.win++;
    else if (v3Score === 0.5) tally.v3.draw++;
    else tally.v3.loss++;
    if (v2Score === 1) tally.v2.win++;
    else if (v2Score === 0.5) tally.v2.draw++;
    else tally.v2.loss++;
    tally.v3.nodes += out.nodesV3;
    tally.v2.nodes += out.nodesV2;
    tally.v3.plies += out.plies;
    tally.v2.plies += out.plies;

    const w = v2White ? 'v2' : 'v3';
    const b = v2White ? 'v3' : 'v2';
    console.log(
      `game ${String(games).padStart(2)} [${w} W vs ${b} B] ${out.result} in ${out.plies} plies  ` +
        `opening: ${openName.length > 48 ? openName.slice(0, 45) + '...' : openName}`,
    );
  }
}

// --- elo estimate -----------------------------------------------------------------

const s = (tally.v3.win + 0.5 * tally.v3.draw) / games;
let eloLine: string;
if (s <= 0 || s >= 1) {
  eloLine = s >= 1 ? 'v3 won 100% — Elo gap exceeds ~800' : 'v3 scored 0% — v2 stronger at this TC?';
} else {
  const diff = 400 * Math.log10(s / (1 - s));
  const sigmaScore = Math.sqrt((s * (1 - s)) / games);
  const sigmaElo = (400 * sigmaScore) / (Math.LN10 * s * (1 - s));
  eloLine = `v3 = +${diff.toFixed(0).padStart(3)} Elo vs v2  ±${(1.96 * sigmaElo).toFixed(0)} (95% CI)`;
}

const mins = ((Date.now() - t0) / 60000).toFixed(1);
console.log('\n========== MATCH RESULT ==========');
console.log(`games: ${games}  movetime: ${MOVETIME}ms  book plies: ${BOOK_PLIES}  wall: ${mins} min`);
console.log(`v3: ${tally.v3.win}W ${tally.v3.draw}D ${tally.v3.loss}L   v2: ${tally.v2.win}W ${tally.v2.draw}D ${tally.v2.loss}L`);
console.log(`avg nodes/game:  v3 ${(tally.v3.nodes / games / 1000).toFixed(0)}k   v2 ${(tally.v2.nodes / games / 1000).toFixed(0)}k`);
console.log(`avg game length: ${((tally.v3.plies + tally.v2.plies) / (2 * games)).toFixed(0)} plies`);
console.log(eloLine);
if (s > 0.5) console.log('VERDICT: v3 is stronger');
else if (s < 0.5) console.log('VERDICT: v2 is stronger');
else console.log('VERDICT: even');
