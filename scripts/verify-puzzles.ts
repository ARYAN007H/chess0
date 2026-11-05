/**
 * Strict puzzle-catalog verifier — the repo engine is the oracle.
 *
 * Usage:
 *   npx tsx scripts/verify-puzzles.ts all
 *   npx tsx scripts/verify-puzzles.ts file src/engine/puzzleData/batch-03.ts
 *
 * Every puzzle must pass ALL of:
 *   1. Structural: fields present, valid theme, rating range, odd-length line,
 *      `goal` set ('mate' | 'material'), materialGain for material puzzles,
 *      hint/explanation non-boilerplate (no identical string > 3×).
 *   2. FEN legality: parseable, one king per side, kings not adjacent,
 *      side NOT to move not in check, solver not in check, no pawns on
 *      ranks 1/8, castling rights consistent (or none), solver side == stm.
 *   3. Line replay: setupMove + every solution move legal, solver moves on
 *      even indices, opponent on odd. Outcome: 'mate' → final move mates and
 *      NO earlier solver move mates; 'material' → final diff ≥ start +
 *      materialGain − 0.5 pawns and not mate/stalemate.
 *   4. Soundness:
 *      - mate puzzles: exact DFS proves the key move forces mate in ≤ N
 *        against every defense, and NO other legal first move does.
 *      - material puzzles: v3 search (d9, multiPv 4) ranks the stored first
 *        move #1 with ≥ 60cp margin over #2 (or forced-mate / only-move);
 *        at every later solver node the stored continuation is engine-best
 *        (≤ 25cp off #1); at every opponent node the stored defense is
 *        engine-best (≤ 30cp off #1 or the only legal move).
 *   5. Cross-puzzle (mode `all`): no duplicate FENs, no duplicate
 *      (theme, first-move) pairs.
 */

import { pathToFileURL } from 'node:url';
import { Engine } from '../src/engine/engine';
import { searchPositionV3, clearTTV3 } from '../src/engine/searchV3';
import {
  Position,
  parseFen,
  toFen,
  makeMove,
  unmakeMove,
} from '../src/engine/position';
import {
  genMoves,
  filterLegal,
  inCheckOf,
} from '../src/engine/movegen';
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
import type { ChessPuzzle } from '../src/engine/puzzles';

const MAX_MOVES_BUF = 256;
const DFS_NODE_CAP = 4_000_000;
const MATE_SCORE_BASE = 90000;

const genBuf = new Int32Array(MAX_MOVES_BUF);
const legalBuf = new Int32Array(MAX_MOVES_BUF);

interface Failure {
  id: string;
  title: string;
  reason: string;
}

// --- material helpers -------------------------------------------------------

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

// --- position legality ------------------------------------------------------

function kingsAdjacent(pos: Position): boolean {
  const wk = pos.kingSq[WHITE];
  const bk = pos.kingSq[BLACK];
  const fd = Math.abs((wk & 7) - (bk & 7));
  const rd = Math.abs((wk >> 4) - (bk >> 4));
  return fd <= 1 && rd <= 1;
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

// --- move / mate helpers ----------------------------------------------------

function legalMoveList(pos: Position): number[] {
  const count = genMoves(pos, genBuf);
  const n = filterLegal(pos, genBuf, count, legalBuf);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(legalBuf[i]);
  return out;
}

/** +1 if the side that just moved (`forWhite` POV) delivered mate, −1 stalemate, else 0. */
function mateScore(pos: Position, forWhite: boolean): 0 | 1 | -1 {
  const count = genMoves(pos, genBuf);
  const n = filterLegal(pos, genBuf, count, legalBuf);
  if (n > 0) return 0;
  return inCheckOf(pos, forWhite ? BLACK : WHITE) ? 1 : -1;
}

let dfsNodes = 0;

/** Can the side to move force checkmate within `movesLeft` of its own moves? */
function canForceMate(pos: Position, movesLeft: number): boolean {
  if (movesLeft <= 0) return false;
  const solverWhite = pos.stm === WHITE;
  const moves = legalMoveList(pos);
  // checks first — mating keys are usually checks
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
        forced = false; // stalemate — not a win
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

// --- search helpers ---------------------------------------------------------

interface RootEval {
  best: string | null;
  bestScore: number; // stm POV
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

// --- per-puzzle verification ------------------------------------------------

function canonicalFen(fen: string): string {
  const pos = new Position();
  parseFen(pos, fen);
  return toFen(pos);
}

function verifyPuzzle(
  puz: ChessPuzzle,
  seenFens: Map<string, string>,
  seenKeys: Map<string, string>,
): string[] {
  const errs: string[] = [];
  const fail = (r: string) => errs.push(r);

  // 1. structural
  if (!puz.id || !puz.title || !puz.theme || !puz.hint || !puz.explanation) fail('missing field(s)');
  if (!Array.isArray(puz.solutionUci) || puz.solutionUci.length === 0) fail('empty solutionUci');
  else if (puz.solutionUci.length % 2 === 0)
    fail(`solution line length ${puz.solutionUci.length} is even (solver must start AND end)`);
  if (puz.sideToSolve !== 'white' && puz.sideToSolve !== 'black') fail('bad sideToSolve');
  if (typeof puz.rating !== 'number' || puz.rating < 600 || puz.rating > 2650)
    fail(`rating out of range: ${puz.rating}`);
  if (puz.goal !== 'mate' && puz.goal !== 'material') fail(`goal must be 'mate'|'material', got ${String(puz.goal)}`);
  if (puz.goal === 'material' && (typeof puz.materialGain !== 'number' || puz.materialGain < 1))
    fail('material puzzle needs materialGain >= 1');
  if (puz.hint && puz.hint.length < 20) fail('hint too short / boilerplate');
  if (puz.explanation && puz.explanation.length < 30) fail('explanation too short / boilerplate');
  if (puz.hint && puz.explanation && puz.hint === puz.explanation) fail('hint === explanation');
  if (errs.length > 0) return errs;

  // 2. FEN legality
  const fenErr = checkFenLegality(puz.initialFen, puz.sideToSolve === 'white');
  if (fenErr) {
    fail(fenErr);
    return errs;
  }

  // 3. replay the full line
  const eng = new Engine();
  eng.reset(puz.initialFen);
  const solverWhite = puz.sideToSolve === 'white';
  const startDiff = materialCp(eng.pos, solverWhite);

  if (puz.setupMoveUci) {
    const sm = eng.uciToMove(puz.setupMoveUci);
    if (sm === null) {
      fail(`setupMove ${puz.setupMoveUci} illegal`);
      return errs;
    }
    eng.applyMove(sm);
    if (eng.gameEnd() !== null) {
      fail('setup move ends the game');
      return errs;
    }
    if ((eng.stm === 0) !== solverWhite) {
      fail('after setupMove it is not the solver’s turn');
      return errs;
    }
  }

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
      fail(`move #${i + 1} (${uci}) is out of turn (solver must move on odd move numbers 1,3,5…)`);
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
      // no earlier solver move may already be mate (UI ends the puzzle early)
      const eng2 = new Engine();
      eng2.reset(puz.initialFen);
      if (puz.setupMoveUci) {
        const sm = eng2.uciToMove(puz.setupMoveUci);
        if (sm !== null) eng2.applyMove(sm);
      }
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
    else if (gained + 0.5 < (puz.materialGain ?? 0)) fail(`material gain ${gained.toFixed(1)} < claimed ${puz.materialGain}`);
    if (end?.type === 'checkmate') fail('material puzzle line ends in mate — use goal mate');
    if (end?.type === 'stalemate') fail('material puzzle line ends in stalemate');
    // Honesty: even after black's best continuation (recaptures included),
    // the solver must remain clearly ahead — and the claim must not overstate.
    if (errs.length === 0) {
      const ev = evalRoot(eng.pos, 8, 1);
      if (ev.bestScore > -100) {
        fail(`after black's best defense solver is not clearly ahead (opp POV ${ev.bestScore})`);
      } else if ((puz.materialGain ?? 0) * 100 > -ev.bestScore + 250) {
        fail(`claimed gain ${puz.materialGain} overstates the realistic +${(-ev.bestScore / 100).toFixed(1)}`);
      }
    }
  }

  // 4a. mate soundness (exact DFS, key uniqueness)
  if (puz.goal === 'mate' && errs.length === 0) {
    const pos = new Position();
    parseFen(pos, puz.initialFen);
    if (puz.setupMoveUci) {
      const probe = new Engine();
      probe.reset(puz.initialFen);
      const sm = probe.uciToMove(puz.setupMoveUci);
      if (sm !== null) makeMove(pos, sm);
    }
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
      fail('mate-uniqueness DFS hit node cap — review manually');
      return errs;
    }
    if (!storedForces) fail(`stored key ${puz.solutionUci[0]} does NOT force mate in ${N}`);
    if (otherKey) fail(`non-unique key: ${otherKey} also forces mate in ≤${N}`);
  }

  // 4b. material soundness (search-based)
  if (puz.goal === 'material' && errs.length === 0) {
    const pos = new Position();
    parseFen(pos, puz.initialFen);
    const stored0 = puz.solutionUci[0];
    const rootEval = evalRoot(pos, 9, 4);
    if (rootEval.mates) {
      const storedScore = rootEval.lines.get(stored0);
      if (storedScore === undefined || storedScore < MATE_SCORE_BASE)
        fail(`root: a forced mate exists but stored key ${stored0} is not a mating move`);
    } else if (legalMoveList(pos).length === 1) {
      // only legal move — unique by law
    } else {
      const storedScore = rootEval.lines.get(stored0);
      if (storedScore === undefined) {
        fail(`root: stored key ${stored0} not among engine top-4 (best ${rootEval.best})`);
      } else if (rootEval.best !== stored0 && rootEval.bestScore - storedScore > 25) {
        fail(`root: ${rootEval.best} (${rootEval.bestScore}) beats stored ${stored0} (${storedScore}) by ${rootEval.bestScore - storedScore}cp`);
      } else if (rootEval.best === stored0 && rootEval.secondScore > -Infinity && rootEval.bestScore - rootEval.secondScore < 60) {
        fail(`root: margin only ${(rootEval.bestScore - rootEval.secondScore).toFixed(0)}cp over #2 — tactic not decisive`);
      }
    }

    // node checks: solver continuations & opponent defenses along the stored line
    const engN = new Engine();
    engN.reset(puz.initialFen);
    if (puz.setupMoveUci) {
      const sm = engN.uciToMove(puz.setupMoveUci);
      if (sm !== null) engN.applyMove(sm);
    }
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

  // 5. cross-puzzle identity
  const fenKey = canonicalFen(puz.initialFen);
  const prev = seenFens.get(fenKey);
  if (prev) fail(`duplicate position of ${prev}`);
  else seenFens.set(fenKey, puz.id);
  const key = `${puz.theme}|${puz.solutionUci[0] ?? ''}`;
  const prevKey = seenKeys.get(key);
  if (prevKey) fail(`same theme + same first move as ${prevKey} (${puz.solutionUci[0]})`);
  else seenKeys.set(key, puz.id);

  return errs;
}

// --- text boilerplate detector ---------------------------------------------

function textRepeatFailures(puzzles: ChessPuzzle[]): Failure[] {
  const out: Failure[] = [];
  for (const field of ['hint', 'explanation'] as const) {
    const counts = new Map<string, string[]>();
    for (const p of puzzles) {
      const t = (p[field] ?? '').trim().toLowerCase();
      const arr = counts.get(t) ?? [];
      arr.push(p.id);
      counts.set(t, arr);
    }
    for (const [t, ids] of counts) {
      if (t.length > 0 && ids.length > 3) {
        out.push({ id: ids.join(','), title: field, reason: `text repeats ${ids.length}×: "${t.slice(0, 60)}…"` });
      }
    }
  }
  return out;
}

// --- main -------------------------------------------------------------------

async function loadPuzzles(arg: string): Promise<ChessPuzzle[]> {
  if (arg === 'all') {
    const mod = await import('../src/engine/puzzles');
    return mod.PUZZLE_LIBRARY;
  }
  if (arg === 'file') {
    const path = process.argv[3];
    if (!path) throw new Error('file mode needs a path');
    const mod = await import(pathToFileURL(path).href);
    const arr = (mod.default ?? Object.values(mod).find((v) => Array.isArray(v))) as ChessPuzzle[];
    if (!Array.isArray(arr)) throw new Error('no puzzle array exported (use default export)');
    return arr;
  }
  throw new Error(`unknown mode "${arg}" (use: all | file <path>)`);
}

async function main() {
  const arg = process.argv[2] ?? 'all';
  const puzzles = await loadPuzzles(arg);
  console.log(`Verifying ${puzzles.length} puzzles (${arg}${arg === 'file' ? ' ' + process.argv[3] : ''})…`);

  const seenFens = new Map<string, string>();
  const seenKeys = new Map<string, string>();
  const failures: Failure[] = [];
  const t0 = Date.now();

  for (let i = 0; i < puzzles.length; i++) {
    const p = puzzles[i];
    const errs = verifyPuzzle(p, seenFens, seenKeys);
    for (const e of errs) failures.push({ id: p.id, title: p.title, reason: e });
    if ((i + 1) % 25 === 0) {
      process.stdout.write(`  …${i + 1}/${puzzles.length} checked (${failures.length} fails, ${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
    }
  }
  failures.push(...textRepeatFailures(puzzles));

  // stats
  const byTheme = new Map<string, number>();
  const byBracket = { beginner: 0, intermediate: 0, advanced: 0, master: 0 };
  const bySide = { white: 0, black: 0 };
  const byMoves = new Map<number, number>();
  for (const p of puzzles) {
    byTheme.set(p.theme, (byTheme.get(p.theme) ?? 0) + 1);
    if (p.rating < 1100) byBracket.beginner++;
    else if (p.rating < 1500) byBracket.intermediate++;
    else if (p.rating < 1850) byBracket.advanced++;
    else byBracket.master++;
    if (p.sideToSolve === 'white') bySide.white++;
    else bySide.black++;
    const nm = Math.ceil((p.solutionUci?.length ?? 0) / 2);
    byMoves.set(nm, (byMoves.get(nm) ?? 0) + 1);
  }

  console.log('\n=== RESULT ===');
  if (failures.length === 0) {
    console.log(`✅ ALL ${puzzles.length} PUZZLES PASS`);
  } else {
    console.log(`❌ ${failures.length} failures across ${new Set(failures.map((f) => f.id)).size} puzzles:`);
    for (const f of failures) console.log(`  FAIL ${f.id} (${f.title}): ${f.reason}`);
  }
  console.log('\nStats:');
  console.log('  themes:', [...byTheme.entries()].map(([k, v]) => `${k}=${v}`).join(', '));
  console.log('  brackets:', JSON.stringify(byBracket));
  console.log('  sides:', JSON.stringify(bySide));
  console.log('  solution lengths:', [...byMoves.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}mv=${v}`).join(', '));
  console.log(`  time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (failures.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
