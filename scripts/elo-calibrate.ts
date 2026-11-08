/**
 * External Elo calibration ladder: Chess0 (the gate-path engine — v3 search
 * + NNUE override on data/nnue-v1.bin) vs Stockfish pinned to UCI_Elo steps
 * via UCI_LimitStrength, at the gate time control (movetime 250ms, 6-book
 * plies, alternating colors, same draw rules as match.ts).
 *
 *   npx tsx scripts/elo-calibrate.ts --sf /path/to/stockfish --elo 1600,2000,2400
 *
 * Caveats printed with the result: SF's UCI_Elo is calibrated for ~1min/game
 * blitz, so at 250ms/move every level plays weaker than its label; the ladder
 * yields a BRACKET (between which SF levels we score ~50%) rather than an
 * absolute rating. Both sides share the machine, hardware effects cancel.
 */

import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Writable, Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { Engine } from '../src/engine/engine';
import { newStartPosition } from '../src/engine/position';
import type { Position } from '../src/engine/position';
import { probeBookV3 } from '../src/engine/bookV3';
import { insufficientMaterial } from '../src/engine/eval';
import { inCheckOf } from '../src/engine/movegen';
import { setEvalOverride, clearEvalCaches } from '../src/engine/evalV3';
import { loadNnueWeights, evalNnueWhitePov } from '../src/engine/nnue';

const argStr = (name: string, def: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const argNum = (name: string, def: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
};

const numArg = (v: number, name: string): number => {
  if (!Number.isFinite(v)) {
    console.error(`--${name} must be a finite number`);
    process.exit(1);
  }
  return v;
};

const SF_PATH = argStr('sf', '');
const ELO_STEPS = argStr('elo', '1600,2000,2400').split(',').map(Number);
if (ELO_STEPS.length === 0 || ELO_STEPS.some((e) => !Number.isFinite(e))) {
  console.error('--elo must be a comma-separated list of finite numbers');
  process.exit(1);
}
const PAIRS = Math.max(1, numArg(argNum('pairs', 25), 'pairs'));
const MOVETIME = Math.max(50, numArg(argNum('movetime', 250), 'movetime'));
const BOOK_PLIES = Math.max(0, numArg(argNum('book-plies', 6), 'book-plies'));
const MAX_PLIES = 300;
const NET = argStr('net', 'data/nnue-v1.bin');

if (!SF_PATH || !existsSync(SF_PATH)) {
  console.error('--sf <path to stockfish binary> is required');
  process.exit(1);
}
if (!existsSync(NET)) {
  console.error(`no net at ${NET}`);
  process.exit(1);
}

// --- Chess0 side: the exact gate path -----------------------------------------

loadNnueWeights(new Uint8Array(readFileSync(NET)));
setEvalOverride(evalNnueWhitePov);
clearEvalCaches();
console.log(`chess0: ${NET} (v3 search + NNUE override)`);

// --- minimal UCI client for the reference engine -------------------------------

class UciEngine {
  private proc: ChildProcessByStdio<Writable, Readable, null>;
  private queue: string[] = [];
  private waiter: (() => void) | null = null;
  private quitting = false;
  private dead: string | null = null; // set by process error/exit; until() throws it
  private options = new Set<string>();
  name = '';

  constructor(path: string) {
    this.proc = spawn(path, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    const rl = createInterface({ input: this.proc.stdout, terminal: false });
    rl.on('line', (line) => {
      if (line.startsWith('id name ')) this.name = line.slice(8).trim();
      if (line.startsWith('option name ')) this.options.add(line.split(/\s+/)[2] ?? '');
      this.queue.push(line);
      this.waiter?.();
    });
    // every failure path routes through `dead` so until() throws cleanly
    // (throwing inside an EventEmitter callback would bypass the top-level catch)
    this.proc.on('error', (err) => {
      if (!this.quitting && this.dead === null) this.dead = `stockfish spawn error: ${err.message}`;
      this.waiter?.();
    });
    this.proc.stdin.on('error', () => {
      if (!this.quitting && this.dead === null) this.dead = 'stockfish stdin closed';
      this.waiter?.();
    });
    this.proc.on('exit', (code) => {
      if (!this.quitting && this.dead === null) this.dead = `stockfish exited early (code ${code})`;
      this.waiter?.();
    });
  }

  private async send(cmd: string): Promise<void> {
    this.proc.stdin.write(cmd + '\n');
  }

  private async until(pred: (line: string) => boolean, timeoutMs: number): Promise<string> {
    const t0 = Date.now();
    for (;;) {
      const idx = this.queue.findIndex(pred);
      // drain everything up to and including the match — the `info depth` spam
      // before a bestmove is dead weight; unbounded growth would both leak
      // memory and make every subsequent findIndex O(n²) over stale lines
      if (idx >= 0) {
        const matched = this.queue[idx];
        this.queue.splice(0, idx + 1);
        return matched;
      }
      if (this.dead) throw new Error(this.dead);
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for UCI reply`);
      await new Promise<void>((r) => {
        this.waiter = r;
        setTimeout(r, 25);
      });
      this.waiter = null;
    }
  }

  async handshake(): Promise<void> {
    await this.send('uci');
    await this.until((l) => l === 'uciok', 10000);
    if (!this.options.has('UCI_LimitStrength') || !this.options.has('UCI_Elo')) {
      throw new Error(`${this.name || 'engine'} does not expose UCI_LimitStrength/UCI_Elo — cannot pin strength`);
    }
    await this.send('isready');
    await this.until((l) => l === 'readyok', 10000);
  }

  async setStrength(elo: number): Promise<void> {
    await this.send('setoption name UCI_LimitStrength value true');
    await this.send(`setoption name UCI_Elo value ${elo}`);
    await this.send('isready');
    await this.until((l) => l === 'readyok', 10000);
  }

  async newGame(): Promise<void> {
    await this.send('ucinewgame');
    await this.send('isready');
    await this.until((l) => l === 'readyok', 10000);
  }

  async move(fen: string, movetime: number): Promise<string> {
    await this.send(`position fen ${fen}`);
    await this.send(`go movetime ${movetime}`);
    const line = await this.until((l) => l.startsWith('bestmove'), 120000);
    return line.split(/\s+/)[1] ?? '';
  }

  quit(): void {
    this.quitting = true;
    this.send('quit').catch(() => {});
    this.proc.kill();
  }
}

// --- shared game state (mirrors match.ts) --------------------------------------

function makeUci(pos: Position, uci: string): void {
  const eng = new Engine();
  eng.pos = pos;
  const m = eng.uciToMove(uci);
  if (m === null) throw new Error(`book move ${uci} illegal`);
  eng.applyMove(m);
}

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

function repetitionKey(pos: Position): string {
  const eng = new Engine();
  eng.pos = pos;
  const parts = eng.fen().split(' ');
  return `${parts[0]} ${parts[1]} ${parts[2]} ${parts[3]}`;
}

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

// --- play -----------------------------------------------------------------------

interface Outcome {
  result: '1-0' | '0-1' | '1/2-1/2';
  plies: number;
  nodes: number; // chess0's nodes
}

/** chess0White: which side the NNUE engine takes. */
async function playGame(sf: UciEngine, openingUci: string[], chess0White: boolean): Promise<Outcome> {
  const game = new Engine();
  for (const uci of openingUci) game.applyUci(uci);

  const history = new Map<string, number>();
  let nodes = 0;
  let plies = 0;

  for (;;) {
    const res = gameResult(game.pos, history);
    if (res) return { result: res, plies, nodes };
    if (plies >= MAX_PLIES) return { result: '1/2-1/2', plies, nodes };

    const key = repetitionKey(game.pos);
    history.set(key, (history.get(key) ?? 0) + 1);

    const whiteToMove = game.stm === 0;
    const chess0Moves = whiteToMove === chess0White;
    let uci: string | null = null;
    if (chess0Moves) {
      const engine = new Engine();
      engine.reset(game.fen());
      const search = engine.search({ movetime: MOVETIME, variant: 'v3' });
      nodes += search.nodes;
      uci = search.bestMoveUci;
    } else {
      uci = await sf.move(game.fen(), MOVETIME);
    }
    if (!uci || game.applyUci(uci) === null) {
      console.error(`  !! ${chess0Moves ? 'chess0' : 'sf'} returned illegal move ${uci}`);
      return { result: chess0Moves ? '0-1' : '1-0', plies, nodes };
    }
    plies++;
  }
}

// --- ladder ----------------------------------------------------------------------

interface LevelTally {
  elo: number;
  win: number;
  draw: number;
  loss: number;
  nodes: number;
  plies: number;
}

function scoreOf(t: LevelTally): number {
  const n = t.win + t.draw + t.loss;
  return n === 0 ? 0 : (t.win + 0.5 * t.draw) / n;
}

function eloLine(t: LevelTally, games: number): string {
  const s = scoreOf(t);
  if (s <= 0) return `scored 0% (level too strong)`;
  if (s >= 1) return `scored 100% (level too weak)`;
  const diff = 400 * Math.log10(s / (1 - s));
  const sigmaScore = Math.sqrt((s * (1 - s)) / games);
  const sigmaElo = (400 * sigmaScore) / (Math.LN10 * s * (1 - s));
  return `${diff >= 0 ? '+' : ''}${diff.toFixed(0)} Elo vs SF@${t.elo}  ±${(1.96 * sigmaElo).toFixed(0)} (95% CI)`;
}

(async () => {
  const results: LevelTally[] = [];
  for (const elo of ELO_STEPS) {
    const sf = new UciEngine(SF_PATH);
    await sf.handshake();
    await sf.setStrength(elo);
    console.log(`\n=== level SF@${elo}  (${sf.name}) ===`);
    const t: LevelTally = { elo, win: 0, draw: 0, loss: 0, nodes: 0, plies: 0 };
    let games = 0;
    for (let p = 1; p <= PAIRS; p++) {
      const opening = sampleOpening(BOOK_PLIES);
      for (const chess0White of [true, false]) {
        await sf.newGame();
        const out = await playGame(sf, opening, chess0White);
        games++;
        t.plies += out.plies;
        t.nodes += out.nodes;
        const chess0Score = out.result === '1/2-1/2' ? 0.5 : (out.result === '1-0') === chess0White ? 1 : 0;
        if (chess0Score === 1) t.win++;
        else if (chess0Score === 0.5) t.draw++;
        else t.loss++;
        console.log(
          `game ${games} [chess0 ${chess0White ? 'W' : 'B'} vs SF@${elo}] ${out.result} in ${out.plies} plies`,
        );
      }
    }
    sf.quit();
    results.push(t);
    console.log(`SF@${elo}: chess0 ${t.win}W ${t.draw}D ${t.loss}L  avg nodes/game ${(t.nodes / games / 1000).toFixed(0)}k  avg plies ${(t.plies / games).toFixed(0)}  → ${eloLine(t, games)}`);
  }

  // Bracket: the two levels around 50% (log-linear interpolation between steps)
  console.log('\n========== CALIBRATION LADDER ==========');
  for (const t of results) {
    const games = t.win + t.draw + t.loss;
    console.log(`SF@${String(t.elo).padStart(4)}: ${t.win}W ${t.draw}D ${t.loss}L   ${eloLine(t, games)}`);
  }
  let bracket = 'outside the tested range';
  for (let i = 0; i < results.length - 1; i++) {
    const a = scoreOf(results[i]);
    const b = scoreOf(results[i + 1]);
    if ((a - 0.5) * (b - 0.5) <= 0 && a !== b) {
      const frac = (0.5 - a) / (b - a);
      const est = results[i].elo + frac * (results[i + 1].elo - results[i].elo);
      bracket = `≈ ${est.toFixed(0)} (between SF@${results[i].elo} and SF@${results[i + 1].elo})`;
      break;
    }
  }
  const allStrong = results.every((t) => scoreOf(t) >= 0.5);
  const allWeak = results.every((t) => scoreOf(t) <= 0.5);
  if (allStrong) bracket = `above SF@${Math.max(...results.map((r) => r.elo))} — extend the ladder upward`;
  else if (allWeak) bracket = `below SF@${Math.min(...results.map((r) => r.elo))} — extend the ladder downward`;
  console.log(`chess0 (${NET}) at ${MOVETIME}ms/move: ${bracket}`);
  console.log(
    `caveat: SF UCI_Elo is calibrated for ~1min/game blitz; at ${MOVETIME}ms every level plays ` +
      `weaker than its label, so read this as a bracket between SF strength levels, not an absolute rating.`,
  );
  // exitCode (not exit): console.log to a pipe is async — a synchronous exit
  // in the same tick can truncate the ladder summary this script exists to print
  process.exitCode = 0;
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
