/**
 * Puzzle forge — candidate accept/reject harness for handcrafted puzzles.
 *
 * Instead of hand-writing FEN rank strings (error-prone), candidates specify
 * positions as algebraic-square piece maps and the forge builds the FEN,
 * then runs the SAME checks as scripts/verify-puzzles.ts:
 *   structural → FEN legality → line replay → outcome →
 *   mate: exact DFS uniqueness | material: v3 search margins + node checks
 * and dedupes against every existing batch in src/engine/puzzleData/.
 *
 * Usage:
 *   npx tsx scripts/puzzle-forge.ts /tmp/cand-b03.ts --emit /tmp/b03.ts --max 50
 *
 * Candidate file: `export default [ ... ]` with `pieces: Record<string,string>`
 * (uppercase = white, lowercase = black; 'K'/'k' exactly once each — builder
 * throws on overlap / missing kings / pawns on rank 1|8).
 */

import { readdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { Engine } from '../src/engine/engine';
import { searchPositionV3, clearTTV3 } from '../src/engine/searchV3';
import { Position, parseFen, toFen, makeMove, unmakeMove } from '../src/engine/position';
import { genMoves, filterLegal, inCheckOf } from '../src/engine/movegen';
import {
  moveToUci,
  parseSquare,
  WHITE,
  BLACK,
  PAWN,
  KING,
  QUEEN,
  ROOK,
  BISHOP,
  KNIGHT,
  CASTLE_WK,
  CASTLE_WQ,
  CASTLE_BK,
  CASTLE_BQ,
} from '../src/engine/types';
import type { ChessPuzzle, PuzzleTheme } from '../src/engine/puzzles';

const MAX_MOVES_BUF = 256;
const DFS_NODE_CAP = 4_000_000;
const MATE_SCORE_BASE = 90000;

const genBuf = new Int32Array(MAX_MOVES_BUF);
const legalBuf = new Int32Array(MAX_MOVES_BUF);

// --- candidate shape ---------------------------------------------------------

interface Cand {
  id: string;
  title: string;
  theme: PuzzleTheme;
  rating: number;
  side: 'w' | 'b';
  pieces: Record<string, string>;
  solution: string[];
  goal: 'mate' | 'material';
  materialGain?: number;
  hint: string;
  explanation: string;
}

// --- programmatic FEN builder ------------------------------------------------

const FILES = 'abcdefgh';

function fenFrom(pieces: Record<string, string>, stm: 'w' | 'b'): string {
  const board: (string | null)[] = new Array(64).fill(null);
  for (const [sq, pc] of Object.entries(pieces)) {
    if (!/^[a-h][1-8]$/.test(sq)) throw new Error(`bad square '${sq}'`);
    if (!/^[KQRBNPkqrbnp]$/.test(pc)) throw new Error(`bad piece '${pc}'`);
    const idx = (Number(sq[1]) - 1) * 8 + FILES.indexOf(sq[0]);
    if (board[idx] !== null) throw new Error(`overlap on ${sq}`);
    board[idx] = pc;
  }
  let wk = 0;
  let bk = 0;
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p === 'K') wk++;
    if (p === 'k') bk++;
    if ((p === 'P' || p === 'p') && (i < 8 || i >= 56))
      throw new Error(`pawn on rank ${i < 8 ? 1 : 8}`);
  }
  if (wk !== 1 || bk !== 1) throw new Error(`king count w=${wk} b=${bk}`);
  const ranks: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let s = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = board[r * 8 + f];
      if (p === null) {
        empty++;
        continue;
      }
      if (empty > 0) {
        s += String(empty);
        empty = 0;
      }
      s += p;
    }
    if (empty > 0) s += String(empty);
    ranks.push(s);
  }
  return `${ranks.join('/')} ${stm} - - 0 1`;
}

// --- material helpers (mirror verify-puzzles.ts) -----------------------------

const PIECE_VALUE: Record<number, number> = {
  [PAWN]: 1,
  [KNIGHT]: 3,
  [BISHOP]: 3,
  [ROOK]: 5,
  [QUEEN]: 9,
  [KING]: 0,
};

function materialCp(pos: Position, forWhite: boolean): number {
  let sum = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const p = pos.board[sq];
    if (p === 0) continue;
    const type = Math.abs(p);
    if (type === KING) continue;
    sum += ((p > 0) === forWhite ? 1 : -1) * PIECE_VALUE[type];
  }
  return sum * 100;
}

// --- position legality -------------------------------------------------------

function kingsAdjacent(pos: Position): boolean {
  const wk = pos.kingSq[WHITE];
  const bk = pos.kingSq[BLACK];
  return Math.abs((wk & 7) - (bk & 7)) <= 1 && Math.abs((wk >> 4) - (bk >> 4)) <= 1;
}

function checkFenLegality(fen: string, solverWhite: boolean): string | null {
  const pos = new Position();
  try {
    parseFen(pos, fen);
  } catch (e) {
    return `FEN unparseable: ${(e as Error).message}`;
  }
  let wk = 0;
  let bk = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    if (pos.board[sq] === KING) wk++;
    if (pos.board[sq] === -KING) bk++;
    if (Math.abs(pos.board[sq]) === PAWN) {
      const rank = sq >> 4;
      if (rank === 0 || rank === 7) return 'pawn on rank 1 or 8';
    }
  }
  if (wk !== 1 || bk !== 1) return `king count wrong (w=${wk} b=${bk})`;
  if (kingsAdjacent(pos)) return 'kings adjacent';
  if (pos.castling !== 0) {
    if (pos.castling & CASTLE_WK && (pos.board[parseSquare('e1')] !== KING || pos.board[parseSquare('h1')] !== ROOK))
      return 'castling K right without K on e1 / R on h1';
    if (pos.castling & CASTLE_WQ && (pos.board[parseSquare('e1')] !== KING || pos.board[parseSquare('a1')] !== ROOK))
      return 'castling Q right without K on e1 / R on a1';
    if (pos.castling & CASTLE_BK && (pos.board[parseSquare('e8')] !== -KING || pos.board[parseSquare('h8')] !== -ROOK))
      return 'castling k right without k on e8 / r on h8';
    if (pos.castling & CASTLE_BQ && (pos.board[parseSquare('e8')] !== -KING || pos.board[parseSquare('a8')] !== -ROOK))
      return 'castling q right without k on e8 / r on a8';
  }
  const solverWhiteStm = pos.stm === WHITE;
  if (solverWhiteStm !== solverWhite) return 'sideToSolve does not match FEN side to move';
  if (inCheckOf(pos, solverWhiteStm ? BLACK : WHITE)) return 'side not to move is in check';
  if (inCheckOf(pos, solverWhiteStm ? WHITE : BLACK)) return 'solver starts in check';
  return null;
}

// --- move / mate helpers -----------------------------------------------------

function legalMoveList(pos: Position): number[] {
  const count = genMoves(pos, genBuf);
  const n = filterLegal(pos, genBuf, count, legalBuf);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(legalBuf[i]);
  return out;
}

function mateScore(pos: Position, forWhite: boolean): 0 | 1 | -1 {
  const count = genMoves(pos, genBuf);
  const n = filterLegal(pos, genBuf, count, legalBuf);
  if (n > 0) return 0;
  return inCheckOf(pos, forWhite ? BLACK : WHITE) ? 1 : -1;
}

let dfsNodes = 0;

function canForceMate(pos: Position, movesLeft: number): boolean {
  if (movesLeft <= 0) return false;
  const solverWhite = pos.stm === WHITE;
  const moves = legalMoveList(pos);
  const ordered = moves
    .map((m) => {
      makeMove(pos, m);
      const chk = inCheckOf(pos, solverWhite ? BLACK : WHITE);
      unmakeMove(pos, m);
      return { m, chk };
    })
    .sort((a, b) => (a.chk === b.chk ? 0 : a.chk ? -1 : 1));
  for (const { m } of ordered) {
    if (++dfsNodes > DFS_NODE_CAP) throw new Error('dfs-node-cap');
    makeMove(pos, m);
    if (mateScore(pos, solverWhite) === 1) {
      unmakeMove(pos, m);
      return true;
    }
    let forced = false;
    if (movesLeft > 1) {
      const replies = legalMoveList(pos);
      if (replies.length === 0) {
        forced = false;
      } else {
        forced = true;
        for (const r of replies) {
          if (++dfsNodes > DFS_NODE_CAP) throw new Error('dfs-node-cap');
          makeMove(pos, r);
          const ok = canForceMate(pos, movesLeft - 1);
          unmakeMove(pos, r);
          if (!ok) {
            forced = false;
            break;
          }
        }
      }
    }
    unmakeMove(pos, m);
    if (forced) return true;
  }
  return false;
}

// --- search helpers ----------------------------------------------------------

interface RootEval {
  best: string | null;
  bestScore: number;
  secondScore: number;
  lines: Map<string, number>;
  mates: boolean;
}

function evalRoot(pos: Position, depth: number, multiPv: number): RootEval {
  clearTTV3();
  const r = searchPositionV3(pos, { depth, variant: 'v3', multiPv });
  const lines = new Map<string, number>();
  let bestScore = -Infinity;
  let secondScore = -Infinity;
  let best: string | null = null;
  let mates = false;
  if (r.multiPv && r.multiPv.length > 0) {
    for (const l of r.multiPv) {
      const sc =
        l.scoreMate !== undefined
          ? l.scoreMate > 0
            ? MATE_SCORE_BASE + 1000 - l.scoreMate
            : -MATE_SCORE_BASE - 1000 - l.scoreMate
          : (l.scoreCp ?? 0);
      lines.set(l.uci, sc);
      if (sc > bestScore) {
        secondScore = bestScore;
        bestScore = sc;
        best = l.uci;
      } else if (sc > secondScore) {
        secondScore = sc;
      }
      if (l.scoreMate !== undefined && l.scoreMate > 0) mates = true;
    }
  }
  return { best, bestScore, secondScore, lines, mates };
}

function canonicalFen(fen: string): string {
  const pos = new Position();
  parseFen(pos, fen);
  return toFen(pos);
}

// --- candidate verification (mirrors verifyPuzzle) ---------------------------

function candToPuzzle(c: Cand, fen: string): ChessPuzzle {
  return {
    id: c.id,
    title: c.title,
    theme: c.theme,
    rating: c.rating,
    sideToSolve: c.side === 'w' ? 'white' : 'black',
    initialFen: fen,
    solutionUci: c.solution,
    goal: c.goal,
    materialGain: c.materialGain,
    hint: c.hint,
    explanation: c.explanation,
  };
}

function verifyCand(c: Cand, fen: string, seenFens: Map<string, string>, seenKeys: Map<string, string>): string[] {
  const errs: string[] = [];
  const fail = (r: string) => errs.push(r);
  const puz = candToPuzzle(c, fen);

  // structural
  if (!puz.id || !puz.title || !puz.theme || !puz.hint || !puz.explanation) fail('missing field(s)');
  if (!Array.isArray(puz.solutionUci) || puz.solutionUci.length === 0) fail('empty solutionUci');
  else if (puz.solutionUci.length % 2 === 0)
    fail(`solution line length ${puz.solutionUci.length} is even (solver must start AND end)`);
  if (typeof puz.rating !== 'number' || puz.rating < 600 || puz.rating > 2650)
    fail(`rating out of range: ${puz.rating}`);
  if (puz.goal !== 'mate' && puz.goal !== 'material') fail(`bad goal ${String(puz.goal)}`);
  if (puz.goal === 'material' && (typeof puz.materialGain !== 'number' || puz.materialGain < 1))
    fail('material puzzle needs materialGain >= 1');
  if (puz.hint && puz.hint.length < 20) fail('hint too short');
  if (puz.explanation && puz.explanation.length < 30) fail('explanation too short');
  if (puz.hint === puz.explanation) fail('hint === explanation');
  if (errs.length > 0) return errs;

  // FEN legality
  const fenErr = checkFenLegality(puz.initialFen, puz.sideToSolve === 'white');
  if (fenErr) {
    fail(fenErr);
    return errs;
  }

  // replay
  const eng = new Engine();
  eng.reset(puz.initialFen);
  const solverWhite = puz.sideToSolve === 'white';
  const startDiff = materialCp(eng.pos, solverWhite);

  const sans: string[] = [];
  for (let i = 0; i < puz.solutionUci.length; i++) {
    const uci = puz.solutionUci[i];
    const m = eng.uciToMove(uci);
    if (m === null) {
      fail(`solution move #${i + 1} (${uci}) illegal in ${eng.fen()}`);
      return errs;
    }
    const solverMoving = (eng.stm === 0) === solverWhite;
    if (solverMoving !== (i % 2 === 0)) {
      fail(`move #${i + 1} (${uci}) out of turn`);
      return errs;
    }
    sans.push(eng.sanFor(m));
    eng.applyMove(m);
  }

  const end = eng.gameEnd();
  if (puz.goal === 'mate') {
    if (!end || end.type !== 'checkmate') {
      fail(`goal mate but line ends: ${end ? end.type : 'open'} (${sans.join(' ')})`);
    } else if ((end.winner === 0) !== solverWhite) {
      fail('mate delivered but wrong side wins');
    } else {
      const eng2 = new Engine();
      eng2.reset(puz.initialFen);
      for (let i = 0; i < puz.solutionUci.length - 1; i++) {
        const m = eng2.uciToMove(puz.solutionUci[i]);
        if (m === null) break;
        const solverMoving = (eng2.stm === 0) === solverWhite;
        eng2.applyMove(m);
        if (solverMoving && eng2.gameEnd()?.type === 'checkmate') {
          fail(`intermediate solver move #${i + 1} already mates — trim the line`);
          break;
        }
      }
    }
  } else {
    const endDiff = materialCp(eng.pos, solverWhite);
    const gained = (endDiff - startDiff) / 100;
    if (gained < 1) fail(`no real material gain (${gained.toFixed(1)})`);
    else if (gained + 0.5 < (puz.materialGain ?? 0))
      fail(`material gain ${gained.toFixed(1)} < claimed ${puz.materialGain}`);
    if (end?.type === 'checkmate') fail('material line ends in mate — use goal mate');
    if (end?.type === 'stalemate') fail('material line ends in stalemate');
    if (errs.length === 0) {
      const ev = evalRoot(eng.pos, 8, 1);
      if (ev.bestScore > -100)
        fail(`after best defense solver not clearly ahead (opp POV ${ev.bestScore})`);
      else if ((puz.materialGain ?? 0) * 100 > -ev.bestScore + 250)
        fail(`claimed gain ${puz.materialGain} overstates realistic +${(-ev.bestScore / 100).toFixed(1)}`);
    }
  }

  // mate soundness (exact DFS, key uniqueness)
  if (puz.goal === 'mate' && errs.length === 0) {
    const pos = new Position();
    parseFen(pos, puz.initialFen);
    const N = Math.ceil(puz.solutionUci.length / 2);
    dfsNodes = 0;
    let storedForces = false;
    let otherKey: string | null = null;
    try {
      const rootMoves = legalMoveList(pos);
      const storedUci = puz.solutionUci[0];
      for (const m of rootMoves) {
        const uci = moveToUci(m);
        makeMove(pos, m);
        let forces = mateScore(pos, solverWhite) === 1;
        if (!forces && N > 1) {
          const replies = legalMoveList(pos);
          if (replies.length > 0) {
            forces = true;
            for (const r of replies) {
              if (++dfsNodes > DFS_NODE_CAP) throw new Error('dfs-node-cap');
              makeMove(pos, r);
              const ok = canForceMate(pos, N - 1);
              unmakeMove(pos, r);
              if (!ok) {
                forces = false;
                break;
              }
            }
          }
        }
        unmakeMove(pos, m);
        if (forces) {
          if (uci === storedUci) storedForces = true;
          else otherKey = otherKey ?? uci;
        }
      }
    } catch {
      fail('mate-uniqueness DFS hit node cap');
      return errs;
    }
    if (!storedForces) fail(`stored key ${puz.solutionUci[0]} does NOT force mate in ${N}`);
    if (otherKey) fail(`non-unique key: ${otherKey} also forces mate in ≤${N}`);
  }

  // material soundness (search-based)
  if (puz.goal === 'material' && errs.length === 0) {
    const pos = new Position();
    parseFen(pos, puz.initialFen);
    const stored0 = puz.solutionUci[0];
    const rootEval = evalRoot(pos, 9, 4);
    if (rootEval.mates) {
      const storedScore = rootEval.lines.get(stored0);
      if (storedScore === undefined || storedScore < MATE_SCORE_BASE)
        fail(`root: forced mate exists but stored key ${stored0} is not a mating move`);
    } else if (legalMoveList(pos).length === 1) {
      // only legal move — unique by law
    } else {
      const storedScore = rootEval.lines.get(stored0);
      if (storedScore === undefined) {
        fail(`root: stored key ${stored0} not among engine top-4 (best ${rootEval.best})`);
      } else if (rootEval.best !== stored0 && rootEval.bestScore - storedScore > 25) {
        fail(`root: ${rootEval.best} (${rootEval.bestScore}) beats stored ${stored0} (${storedScore}) by ${rootEval.bestScore - storedScore}cp`);
      } else if (rootEval.best === stored0 && rootEval.secondScore > -Infinity && rootEval.bestScore - rootEval.secondScore < 60) {
        fail(`root: margin only ${(rootEval.bestScore - rootEval.secondScore).toFixed(0)}cp over #2`);
      }
    }

    const engN = new Engine();
    engN.reset(puz.initialFen);
    for (let i = 0; i < puz.solutionUci.length - 1; i++) {
      const uci = puz.solutionUci[i];
      const isSolverNode = (engN.stm === 0) === solverWhite;
      const ev = evalRoot(engN.pos, 8, 4);
      if (ev.lines.size === 0) break;
      const onlyMove = legalMoveList(engN.pos).length === 1;
      const storedScore = ev.lines.get(uci);
      if (!onlyMove) {
        if (storedScore === undefined) {
          fail(`node ${i + 1}: stored ${uci} not in engine top-4 (best ${ev.best})`);
        } else {
          const tol = isSolverNode ? 25 : 30;
          if (ev.best !== uci && ev.bestScore - storedScore > tol) {
            fail(`node ${i + 1}: ${ev.best} (${ev.bestScore}) beats stored ${uci} (${storedScore}) by ${ev.bestScore - storedScore}cp`);
          }
        }
      }
      const m = engN.uciToMove(uci);
      if (m === null) break;
      engN.applyMove(m);
    }
  }

  // cross-puzzle identity
  const fenKey = canonicalFen(puz.initialFen);
  const prev = seenFens.get(fenKey);
  if (prev) fail(`duplicate position of ${prev}`);
  else seenFens.set(fenKey, puz.id);
  const key = `${puz.theme}|${puz.solutionUci[0] ?? ''}`;
  const prevKey = seenKeys.get(key);
  if (prevKey) fail(`same theme + same first move as ${prevKey}`);
  else seenKeys.set(key, puz.id);

  return errs;
}

// --- text repeat check -------------------------------------------------------

function textRepeatWarnings(puzzles: ChessPuzzle[]): string[] {
  const out: string[] = [];
  for (const field of ['hint', 'explanation'] as const) {
    const counts = new Map<string, string[]>();
    for (const p of puzzles) {
      const t = (p[field] ?? '').trim().toLowerCase();
      const arr = counts.get(t) ?? [];
      arr.push(p.id);
      counts.set(t, arr);
    }
    for (const [t, ids] of counts) {
      if (t.length > 0 && ids.length > 3)
        out.push(`${field} repeats ${ids.length}×: "${t.slice(0, 60)}…" (${ids.join(',')})`);
    }
  }
  return out;
}

// --- batch emission ----------------------------------------------------------

function q(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function emitBatch(puzzles: ChessPuzzle[], varName: string, header: string): string {
  const lines: string[] = [];
  lines.push('/**');
  for (const l of header.split('\n')) lines.push(` * ${l}`);
  lines.push(' */');
  lines.push(`import type { ChessPuzzle } from '../puzzles';`);
  lines.push('');
  lines.push(`const ${varName}: ChessPuzzle[] = [`);
  for (const p of puzzles) {
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined && k !== 'materialGain' && k !== 'setupMoveUci')
        throw new Error(`emit: puzzle ${p.id} field ${k} is undefined`);
    }
    lines.push('  {');
    lines.push(`    id: ${q(p.id)},`);
    lines.push(`    title: ${q(p.title)},`);
    lines.push(`    theme: ${q(p.theme)},`);
    lines.push(`    rating: ${p.rating},`);
    lines.push(`    sideToSolve: ${q(p.sideToSolve)},`);
    lines.push(`    initialFen: ${q(p.initialFen)},`);
    lines.push(`    solutionUci: [${p.solutionUci.map((m) => q(m)).join(', ')}],`);
    lines.push(`    goal: ${q(p.goal)},`);
    if (p.materialGain !== undefined) lines.push(`    materialGain: ${p.materialGain},`);
    lines.push(`    hint: ${q(p.hint)},`);
    lines.push(`    explanation: ${q(p.explanation)},`);
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');
  lines.push(`export { ${varName} };`);
  lines.push('');
  return lines.join('\n');
}

// --- main --------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const batchDir = path.join(here, '..', 'src', 'engine', 'puzzleData');

async function existingBatchKeys(): Promise<{ fens: Map<string, string>; keys: Map<string, string> }> {
  const fens = new Map<string, string>();
  const keys = new Map<string, string>();
  const files = readdirSync(batchDir)
    .filter((f) => /^batch-\d+\.ts$/.test(f))
    .sort();
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(batchDir, f)).href);
    const arr = (mod.default ?? Object.values(mod).find((v) => Array.isArray(v))) as ChessPuzzle[];
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      let fk: string;
      try {
        fk = canonicalFen(p.initialFen);
      } catch {
        fk = `raw:${p.initialFen}`; // unparseable FEN still dedupes by raw string
      }
      fens.set(fk, p.id);
      keys.set(`${p.theme}|${p.solutionUci[0] ?? ''}`, p.id);
    }
  }
  return { fens, keys };
}

async function main() {
  const candPath = process.argv[2];
  if (!candPath) {
    console.error('usage: npx tsx scripts/puzzle-forge.ts <candidates.ts> [--emit out.ts] [--max 50]');
    process.exit(1);
  }
  const emitIdx = process.argv.indexOf('--emit');
  const emitPath = emitIdx >= 0 ? process.argv[emitIdx + 1] : undefined;
  const maxIdx = process.argv.indexOf('--max');
  const max = maxIdx >= 0 ? Number(process.argv[maxIdx + 1]) : 50;

  const mod = await import(pathToFileURL(path.resolve(candPath)).href);
  const cands: Cand[] = mod.default;
  if (!Array.isArray(cands)) throw new Error('candidates file must default-export an array');

  console.log(`Forging ${cands.length} candidates (existing batches auto-deduped)…`);
  const { fens: seenFens, keys: seenKeys } = await existingBatchKeys();
  console.log(`  existing batches: ${seenFens.size} FENs, ${seenKeys.size} theme|move keys`);

  const passed: { c: Cand; fen: string }[] = [];
  for (const c of cands) {
    let fen: string;
    try {
      fen = fenFrom(c.pieces, c.side);
    } catch (e) {
      console.log(`  FAIL ${c.id}: fenFrom: ${(e as Error).message}`);
      continue;
    }
    const errs = verifyCand(c, fen, seenFens, seenKeys);
    if (errs.length === 0) {
      passed.push({ c, fen });
      console.log(`  PASS ${c.id}  (${c.theme}, ${Math.ceil(c.solution.length / 2)}mv, ${c.side === 'w' ? 'white' : 'black'})`);
    } else {
      for (const e of errs) console.log(`  FAIL ${c.id}: ${e}\n        fen: ${fen}`);
    }
  }

  console.log(`\n${passed.length}/${cands.length} candidates pass`);

  const puzzles = passed.map(({ c, fen }) => candToPuzzle(c, fen));
  for (const w of textRepeatWarnings(puzzles)) console.log(`  TEXT-WARN ${w}`);

  if (emitPath) {
    const varMatch = path.basename(emitPath).match(/batch-(\d+)/);
    const varName = varMatch ? `batch${varMatch[1].padStart(2, '0')}` : 'puzzles';
    const header = [
      'Generated by scripts/puzzle-forge.ts from individually composed positions —',
      'every entry engine-verified (see scripts/verify-puzzles.ts).',
    ].join('\n');
    const out = puzzles.slice(0, max);
    writeFileSync(emitPath, emitBatch(out, varName, header));
    console.log(`Emitted ${out.length} puzzles → ${emitPath}`);
  }

  if (passed.length < Math.min(max, cands.length)) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
