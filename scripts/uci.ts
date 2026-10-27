/**
 * UCI protocol adapter (stretch goal): plug Chess0 into real chess GUIs.
 *
 *   npm run uci
 *   echo -e "uci\nposition startpos\ngo depth 10\nquit" | npm run uci
 *
 * Note: `go` runs synchronously, so `stop` is honored between searches.
 * Time-managed searches (wtime/btime) keep their budgets bounded so GUIs
 * stay responsive.
 */

import { Engine } from '../src/engine/engine';
import * as readline from 'node:readline';

const engine = new Engine();

const rl = readline.createInterface({ input: process.stdin, terminal: false });

function infoLine(depth: number, seldepth: number, nodes: number, timeMs: number, scoreStr: string, pvUci: string[]): string {
  const nps = Math.round(nodes / (Math.max(1, timeMs) / 1000));
  return `info depth ${depth} seldepth ${seldepth} multipv 1 score ${scoreStr} nodes ${nodes} nps ${nps} time ${Math.round(timeMs)} pv ${pvUci.join(' ')}`;
}

function scoreUci(info: { scoreCp?: number; scoreMate?: number }): string {
  if (info.scoreMate !== undefined) return `mate ${info.scoreMate}`;
  return `cp ${info.scoreCp}`;
}

interface GoParams {
  depth?: number;
  movetime?: number;
  wtime?: number;
  btime?: number;
  winc?: number;
  binc?: number;
  movestogo?: number;
  infinite?: boolean;
}

function planTime(p: GoParams): number | undefined {
  if (p.movetime !== undefined) return p.movetime;
  const myTime = engine.stm === 0 ? p.wtime : p.btime;
  const myInc = engine.stm === 0 ? p.winc : p.binc;
  if (myTime === undefined) return undefined;
  const base = myTime / 40 + (myInc ?? 0) * 0.9;
  return Math.max(20, Math.min(base, myTime / 3));
}

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  const [cmd, ...args] = trimmed.split(/\s+/);

  switch (cmd) {
    case 'uci':
      console.log('id name Chess0 1.0');
      console.log('id author Chess0 project');
      console.log('option name Hash type spin default 128 min 16 max 1024');
      console.log('uciok');
      break;

    case 'isready':
      console.log('readyok');
      break;

    case 'ucinewgame':
      engine.reset();
      break;

    case 'position': {
      let rest: string[] = [];
      if (args[0] === 'startpos') {
        engine.reset();
        rest = args.slice(1);
      } else if (args[0] === 'fen') {
        const fenEnd = args.findIndex((a, i) => i > 0 && a === 'moves');
        const fenArgs = fenEnd === -1 ? args.slice(1) : args.slice(1, fenEnd);
        engine.reset(fenArgs.join(' '));
        rest = fenEnd === -1 ? [] : args.slice(fenEnd);
      }
      const movesIdx = rest.indexOf('moves');
      if (movesIdx !== -1) {
        for (const uci of rest.slice(movesIdx + 1)) {
          if (engine.applyUci(uci) === null) {
            console.error(`info string illegal move in position: ${uci}`);
            break;
          }
        }
      }
      break;
    }

    case 'go': {
      const p: GoParams = {};
      for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
          case 'depth': p.depth = parseInt(args[++i], 10); break;
          case 'movetime': p.movetime = parseInt(args[++i], 10); break;
          case 'wtime': p.wtime = parseInt(args[++i], 10); break;
          case 'btime': p.btime = parseInt(args[++i], 10); break;
          case 'winc': p.winc = parseInt(args[++i], 10); break;
          case 'binc': p.binc = parseInt(args[++i], 10); break;
          case 'movestogo': p.movestogo = parseInt(args[++i], 10); break;
          case 'infinite': p.infinite = true; break;
        }
      }
      const limits: { depth?: number; movetime?: number } = {};
      if (p.depth !== undefined) limits.depth = p.depth;
      const movetime = planTime(p);
      if (p.depth === undefined) {
        limits.movetime = p.infinite ? 30000 : movetime ?? 3000;
      }
      const result = engine.search(limits, (info) => {
        console.log(infoLine(info.depth, info.seldepth, info.nodes, info.timeMs, scoreUci(info), info.pvUci));
      });
      console.log(`bestmove ${result.bestMoveUci || '(none)'}`);
      break;
    }

    case 'stop':
      // Search runs synchronously; stop takes effect between searches.
      break;

    case 'quit':
      process.exit(0);
      break;

    default:
      // Unknown commands are ignored per the UCI spec.
      break;
  }
});
