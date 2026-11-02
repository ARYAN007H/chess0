/**
 * Chess0 v3 Search — Grandmaster-grade Alpha-Beta + PVS + Hybrid Novelty Engine.
 *
 * Advances over v2:
 *   - 2M-entry Transposition Table probed in BOTH main search and qsearch,
 *     with TT-score static evaluation refinement
 *   - Singular Extensions (excluded-move verification search)
 *   - Continuation History (1-ply piece-to-square), True Countermove Heuristic,
 *     Capture History, and History Gravity (Bonus + Malus on fail-high)
 *   - SEE-classified Move Ordering (winning/equal captures before killers,
 *     losing captures after quiet moves)
 *   - Improving heuristic, Razoring, Reverse Futility Pruning, ProbCut,
 *     Late Move Pruning (LMP), and History-modulated Late Move Reductions (LMR)
 *   - Hybrid Opening Book + Novelty Discovery at Root: evaluates book theory
 *     alongside full search and deviates when it calculates a stronger novelty
 *   - Adaptive Time Management (<10s hard cap): fast on forced/book/stable
 *     moves, deep extension on sharp tactical complexities
 */

import {
  INF,
  MAX_MOVES,
  MAX_PLY,
  MATE,
  MATE_BOUND,
  QUEEN,
  moveCaptured,
  moveFrom,
  movePromo,
  moveTo,
  moveToUci,
  pieceIndex,
  sqTo64,
} from './types';
import { makeMove, makeNullMove, unmakeMove, unmakeNullMove } from './position';
import type { Position } from './position';
import { genCaptures, genMoves, inCheckOf, moveIsLegal, filterLegal } from './movegen';
import { evalV3 } from './evalV3';
import { hasNonPawnMaterial, insufficientMaterial } from './eval';
import { see } from './see';
import { moveToSan } from './san';
import { probeBookV3 } from './bookV3';
import type { MultiPvLine, SearchInfo, SearchLimits, SearchResult } from './search';

// ---------------------------------------------------------------------------
// Transposition Table: 2^21 slots (2,097,152 entries)
// data = score(16) | depth(7)<<16 | flag(2)<<23 | age(4)<<25
// ---------------------------------------------------------------------------

const TT_BITS = 21;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const TT_KEY_HI = new Int32Array(TT_SIZE);
const TT_MOVE = new Int32Array(TT_SIZE);
const TT_DATA = new Int32Array(TT_SIZE);

const FLAG_EXACT = 1;
const FLAG_LOWER = 2;
const FLAG_UPPER = 3;

let ttAge = 0;

function ttStore(idx: number, hashHi: number, move: number, score: number, depth: number, flag: number): void {
  const oldData = TT_DATA[idx];
  const oldDepth = (oldData >>> 16) & 0x7f;
  const oldAge = (oldData >>> 25) & 15;
  const sameKey = TT_KEY_HI[idx] === hashHi;

  if (!sameKey || oldAge !== ttAge || depth >= oldDepth - 1 || flag === FLAG_EXACT) {
    // Preserve existing bestMove if the new store is an upper bound with no move
    const keptMove = move !== 0 ? move : sameKey ? TT_MOVE[idx] : 0;
    TT_KEY_HI[idx] = hashHi;
    TT_MOVE[idx] = keptMove;
    TT_DATA[idx] = (score & 0xffff) | ((depth & 0x7f) << 16) | (flag << 23) | (ttAge << 25);
  }
}

// ---------------------------------------------------------------------------
// Per-node scratch & History Tables (zero allocation on hot path)
// ---------------------------------------------------------------------------

const MOVE_LISTS: Int32Array[] = Array.from({ length: MAX_PLY }, () => new Int32Array(MAX_MOVES));
const SCORE_LISTS: Int32Array[] = Array.from({ length: MAX_PLY }, () => new Int32Array(MAX_MOVES));
const QUIETS_TRIED: Int32Array[] = Array.from({ length: MAX_PLY }, () => new Int32Array(MAX_MOVES));

const killers = new Int32Array(MAX_PLY * 2);
// Butterfly quiet history: [stm (2)][from (128)][to (128)]
const history = new Int32Array(2 * 128 * 128);
// True countermoves: indexed by [opponentStm (2)][prevFrom (128)][prevTo (128)]
const counterMoves = new Int32Array(2 * 128 * 128);
// 1-ply Continuation History: [prevPieceIdx (12) * 64 + prevTo64 (64)][currPieceIdx (12) * 64 + currTo64 (64)]
// 768 * 768 = 589,824 ints (~2.3 MB)
const contHistory = new Int32Array(768 * 768);
// Capture History: [pieceIdx (12) * 64 + to64 (64)][capturedType (7)]
const capHistory = new Int32Array(768 * 8);

// Per-ply stack tracking the move played, moving piece/to64, static eval, and excluded move
const plyMove = new Int32Array(MAX_PLY);
const plyPieceTo = new Int32Array(MAX_PLY); // pieceIndex * 64 + to64, or -1
const staticEvalStack = new Int32Array(MAX_PLY);
const excludedMoveStack = new Int32Array(MAX_PLY);

// Triangular PV table
const pvLength = new Int32Array(MAX_PLY);
const pvTable = new Int32Array(MAX_PLY * MAX_PLY);

// LMR table [depth 0..63][moveIndex 0..63]
const LMR = new Int32Array(64 * 64);
for (let d = 1; d < 64; d++) {
  for (let i = 1; i < 64; i++) {
    LMR[d * 64 + i] = Math.max(0, Math.round(0.65 + (Math.log(d) * Math.log(i)) / 2.15));
  }
}

const PIECE_V = [0, 100, 320, 330, 500, 900, 20000];
const FUTILITY_MARGIN = [0, 110, 220, 340, 470, 610];
const LMP_COUNTS = [0, 5, 9, 15, 23];

const HISTORY_MAX = 16384;

let nodes = 0;
let seldepth = 0;
let stopped = false;
let hardDeadline = Number.POSITIVE_INFINITY;
let rootExcluded0 = 0;
let rootExcluded1 = 0;

// Scratch for PV extraction and legality fallbacks
const pvPseudo = new Int32Array(MAX_MOVES);
const pvLegal = new Int32Array(MAX_MOVES);
const anyPseudo = new Int32Array(MAX_MOVES);

// ---------------------------------------------------------------------------
// History Gravity Helpers
// ---------------------------------------------------------------------------

function updateHistoryVal(arr: Int32Array, idx: number, bonus: number): void {
  const clamped = bonus > 1600 ? 1600 : bonus < -1600 ? -1600 : bonus;
  const cur = arr[idx];
  arr[idx] = (cur + clamped - ((cur * Math.abs(clamped)) >> 14)) | 0;
}

function updateQuietHistories(pos: Position, bestMove: number, ply: number, depth: number, quiets: Int32Array, quietCount: number): void {
  const stm = pos.stm;
  const bonus = Math.min(1500, depth * depth * 16 + depth * 16);
  const prevPt = ply > 0 ? plyPieceTo[ply - 1] : -1;

  // Bonus for the move that caused beta cutoff
  const bf = moveFrom(bestMove);
  const bt = moveTo(bestMove);
  const bPiece = pos.board[bf];
  const bPt = pieceIndex(bPiece) * 64 + sqTo64(bt);
  const bHistIdx = (stm << 14) | (bf << 7) | bt;
  updateHistoryVal(history, bHistIdx, bonus);
  if (prevPt >= 0) {
    updateHistoryVal(contHistory, prevPt * 768 + bPt, bonus);
  }

  // Record countermove against opponent's previous move
  if (ply > 0 && plyMove[ply - 1] !== 0) {
    const prevMove = plyMove[ply - 1];
    const pf = moveFrom(prevMove);
    const pt = moveTo(prevMove);
    counterMoves[(stm << 14) | (pf << 7) | pt] = bestMove;
  }

  // Malus for all quiet moves searched before the beta cutoff
  const malus = -bonus;
  for (let i = 0; i < quietCount; i++) {
    const qm = quiets[i];
    if (qm === bestMove) continue;
    const qf = moveFrom(qm);
    const qt = moveTo(qm);
    const qPiece = pos.board[qf];
    const qPt = pieceIndex(qPiece) * 64 + sqTo64(qt);
    const qHistIdx = (stm << 14) | (qf << 7) | qt;
    updateHistoryVal(history, qHistIdx, malus);
    if (prevPt >= 0) {
      updateHistoryVal(contHistory, prevPt * 768 + qPt, malus);
    }
  }
}

// ---------------------------------------------------------------------------
// Move Ordering
// ---------------------------------------------------------------------------

function isRepetition(pos: Position): boolean {
  const start = Math.max(0, pos.ply - pos.halfmove);
  for (let h = pos.ply - 2; h >= start; h -= 2) {
    if (pos.histHashLo[h] === pos.hashLo && pos.histHashHi[h] === pos.hashHi) return true;
  }
  return false;
}

function scoreMovesV3(
  pos: Position,
  moves: Int32Array,
  count: number,
  scores: Int32Array,
  ttMove: number,
  ply: number,
  inQsearch: boolean,
): void {
  const stm = pos.stm;
  const k1 = killers[ply * 2];
  const k2 = killers[ply * 2 + 1];
  const prevMove = ply > 0 ? plyMove[ply - 1] : 0;
  const counter =
    prevMove !== 0
      ? counterMoves[(stm << 14) | (moveFrom(prevMove) << 7) | moveTo(prevMove)]
      : 0;
  const prevPt = ply > 0 ? plyPieceTo[ply - 1] : -1;

  for (let i = 0; i < count; i++) {
    const m = moves[i];
    if (m === ttMove) {
      scores[i] = 1 << 30;
      continue;
    }
    const captured = moveCaptured(m);
    const promo = movePromo(m);
    const from = moveFrom(m);
    const to = moveTo(m);
    const movingPiece = pos.board[from];
    const attackerType = movingPiece < 0 ? -movingPiece : movingPiece;

    if (captured !== 0 || promo !== 0) {
      const mvvLva = PIECE_V[captured] * 16 - PIECE_V[attackerType] + (promo !== 0 ? PIECE_V[promo] * 8 : 0);
      const pt = pieceIndex(movingPiece) * 64 + sqTo64(to);
      const cHist = capHistory[pt * 8 + captured] >> 4;
      if (inQsearch || PIECE_V[attackerType] <= PIECE_V[captured]) {
        scores[i] = (1 << 27) + mvvLva + cHist;
      } else {
        // Only run SEE when a higher-value piece captures a lower-value piece
        const seeVal = captured !== 0 ? see(pos, m) : 100;
        if (seeVal >= 0) {
          scores[i] = (1 << 27) + mvvLva + cHist;
        } else {
          // Losing captures ordered after quiet killers/countermoves
          scores[i] = -(1 << 20) + seeVal * 16 + mvvLva;
        }
      }
    } else if (m === k1) {
      scores[i] = 1 << 25;
    } else if (m === k2) {
      scores[i] = (1 << 25) - 1;
    } else if (m === counter) {
      scores[i] = (1 << 25) - 2;
    } else {
      const hScore = history[(stm << 14) | (from << 7) | to];
      const pt = pieceIndex(movingPiece) * 64 + sqTo64(to);
      const cScore = prevPt >= 0 ? contHistory[prevPt * 768 + pt] : 0;
      scores[i] = hScore + cScore;
    }
  }
}

function pickBest(moves: Int32Array, scores: Int32Array, from: number, to: number): void {
  let best = from;
  for (let i = from + 1; i < to; i++) {
    if (scores[i] > scores[best]) best = i;
  }
  if (best !== from) {
    const tm = moves[from];
    moves[from] = moves[best];
    moves[best] = tm;
    const ts = scores[from];
    scores[from] = scores[best];
    scores[best] = ts;
  }
}

function hasAnyLegalMove(pos: Position, wasInCheck: boolean): boolean {
  const count = genMoves(pos, anyPseudo);
  for (let i = 0; i < count; i++) {
    const m = anyPseudo[i];
    makeMove(pos, m);
    const legal = moveIsLegal(pos, m, wasInCheck);
    unmakeMove(pos, m);
    if (legal) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Quiescence Search (with TT Probe/Store + SEE + Delta Pruning)
// ---------------------------------------------------------------------------

function qsearch(pos: Position, alpha: number, beta: number, ply: number): number {
  nodes++;
  if ((nodes & 2047) === 0 && performance.now() >= hardDeadline) {
    stopped = true;
    return 0;
  }
  if (ply > seldepth) seldepth = ply;
  if (ply >= MAX_PLY - 1) return evalV3(pos);

  // TT probe in qsearch
  const idx = pos.hashLo & TT_MASK;
  let ttMove = 0;
  let ttHit = false;
  let ttScore = 0;
  let ttFlag = 0;

  if (TT_KEY_HI[idx] === pos.hashHi) {
    ttHit = true;
    const data = TT_DATA[idx];
    ttScore = (data << 16) >> 16;
    ttFlag = (data >>> 23) & 3;
    ttMove = TT_MOVE[idx];
    if (ttScore > MATE_BOUND) ttScore -= ply;
    else if (ttScore < -MATE_BOUND) ttScore += ply;

    if (ttFlag === FLAG_EXACT) return ttScore;
    if (ttFlag === FLAG_LOWER && ttScore >= beta) return ttScore;
    if (ttFlag === FLAG_UPPER && ttScore <= alpha) return ttScore;
  }

  const checked = inCheckOf(pos, pos.stm);
  let stand = 0;
  let bestScore = -INF;

  if (!checked) {
    stand = evalV3(pos);
    // Refine stand-pat with TT score if available
    if (ttHit && Math.abs(ttScore) < MATE_BOUND) {
      if (
        ttFlag === FLAG_EXACT ||
        (ttFlag === FLAG_LOWER && ttScore > stand) ||
        (ttFlag === FLAG_UPPER && ttScore < stand)
      ) {
        stand = ttScore;
      }
    }
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    bestScore = stand;
  }

  const moves = MOVE_LISTS[ply];
  const scores = SCORE_LISTS[ply];
  const count = checked ? genMoves(pos, moves) : genCaptures(pos, moves);
  scoreMovesV3(pos, moves, count, scores, ttMove, ply, true);

  const alphaOrig = alpha;
  let bestMove = 0;
  let legalCount = 0;

  for (let i = 0; i < count; i++) {
    pickBest(moves, scores, i, count);
    const move = moves[i];
    const captured = moveCaptured(move);
    const promo = movePromo(move);

    if (!checked) {
      let gain = captured !== 0 ? PIECE_V[captured] : 0;
      if (promo === QUEEN) gain += 800;
      if (stand + gain + 190 <= alpha) continue;
      if (captured !== 0 && promo === 0 && see(pos, move) < 0) continue;
    }

    const movingPiece = pos.board[moveFrom(move)];
    plyMove[ply] = move;
    plyPieceTo[ply] = pieceIndex(movingPiece) * 64 + sqTo64(moveTo(move));

    makeMove(pos, move);
    if (!moveIsLegal(pos, move, checked)) {
      unmakeMove(pos, move);
      continue;
    }
    legalCount++;
    const score = -qsearch(pos, -beta, -alpha, ply + 1);
    unmakeMove(pos, move);
    if (stopped) return 0;

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
      if (score > alpha) {
        alpha = score;
        if (alpha >= beta) break;
      }
    }
  }

  if (checked && legalCount === 0) return -MATE + ply;

  let storeScore = bestScore;
  if (storeScore > MATE_BOUND) storeScore += ply;
  else if (storeScore < -MATE_BOUND) storeScore -= ply;
  const flag = bestScore >= beta ? FLAG_LOWER : bestScore > alphaOrig ? FLAG_EXACT : FLAG_UPPER;
  ttStore(idx, pos.hashHi, bestMove, storeScore, 0, flag);

  return bestScore;
}

// ---------------------------------------------------------------------------
// Main PVS Search
// ---------------------------------------------------------------------------

function search(
  pos: Position,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  canNull: boolean,
): number {
  if (stopped) return 0;
  nodes++;
  if ((nodes & 2047) === 0 && performance.now() >= hardDeadline) {
    stopped = true;
    return 0;
  }
  if (ply > seldepth) seldepth = ply;
  if (ply >= MAX_PLY - 2) return evalV3(pos);
  pvLength[ply] = 0;

  const isRoot = ply === 0;
  const isPv = beta - alpha > 1;
  const excludedMove = excludedMoveStack[ply];

  if (!isRoot) {
    if (pos.halfmove >= 100 || insufficientMaterial(pos) || isRepetition(pos)) return 0;

    // Mate distance pruning
    const mateAlpha = -MATE + ply;
    const mateBeta = MATE - ply - 1;
    if (alpha < mateAlpha) alpha = mateAlpha;
    if (beta > mateBeta) beta = mateBeta;
    if (alpha >= beta) return alpha;
  }

  const checked = inCheckOf(pos, pos.stm);
  if (checked) depth++; // Check extension

  if (depth <= 0) return qsearch(pos, alpha, beta, ply);

  // TT Probe (skipped when testing singular exclusion)
  const idx = pos.hashLo & TT_MASK;
  let ttMove = 0;
  let ttHit = false;
  let ttScore = 0;
  let ttDepth = 0;
  let ttFlag = 0;

  if (excludedMove === 0 && TT_KEY_HI[idx] === pos.hashHi) {
    ttHit = true;
    const data = TT_DATA[idx];
    ttScore = (data << 16) >> 16;
    ttDepth = (data >>> 16) & 0x7f;
    ttFlag = (data >>> 23) & 3;
    ttMove = TT_MOVE[idx];
    if (ttScore > MATE_BOUND) ttScore -= ply;
    else if (ttScore < -MATE_BOUND) ttScore += ply;

    if (!isPv && !isRoot && ttDepth >= depth) {
      if (ttFlag === FLAG_EXACT) return ttScore;
      if (ttFlag === FLAG_LOWER && ttScore >= beta) return ttScore;
      if (ttFlag === FLAG_UPPER && ttScore <= alpha) return ttScore;
    }
  }

  // Static Evaluation + Improving Heuristic
  let staticEval = 0;
  let evalScore = 0;
  let improving = false;

  if (!checked) {
    staticEval = evalV3(pos);
    staticEvalStack[ply] = staticEval;
    improving = ply >= 2 && staticEval > staticEvalStack[ply - 2];
    evalScore = staticEval;
    if (ttHit && Math.abs(ttScore) < MATE_BOUND) {
      if (
        ttFlag === FLAG_EXACT ||
        (ttFlag === FLAG_LOWER && ttScore > evalScore) ||
        (ttFlag === FLAG_UPPER && ttScore < evalScore)
      ) {
        evalScore = ttScore;
      }
    }
  } else {
    staticEvalStack[ply] = ply >= 2 ? staticEvalStack[ply - 2] : 0;
  }

  // Pre-move-loop forward pruning (non-PV, not in check, no excluded move)
  if (!isPv && !checked && !isRoot && excludedMove === 0) {
    // 1. Razoring
    if (depth <= 2 && evalScore + 190 * depth <= alpha && alpha > -MATE_BOUND) {
      const qVal = qsearch(pos, alpha, alpha + 1, ply);
      if (stopped) return 0;
      if (qVal <= alpha) return qVal;
    }

    // 2. Reverse Futility Pruning (Static Null Move)
    const rfpMargin = (improving ? 65 : 85) * depth;
    if (depth <= 6 && evalScore - rfpMargin >= beta && Math.abs(beta) < MATE_BOUND) {
      return evalScore;
    }

    // 3. Null-Move Pruning
    if (canNull && depth >= 3 && evalScore >= beta && hasNonPawnMaterial(pos)) {
      const r = 3 + (depth >> 2) + Math.min(3, ((evalScore - beta) / 180) | 0);
      plyMove[ply] = 0;
      plyPieceTo[ply] = -1;
      makeNullMove(pos);
      const nullScore = -search(pos, depth - r, -beta, -beta + 1, ply + 1, false);
      unmakeNullMove(pos);
      if (stopped) return 0;
      if (nullScore >= beta) {
        return nullScore >= MATE_BOUND ? beta : nullScore;
      }
    }

    // 4. ProbCut: if a good capture beats beta + margin at shallow depth, prune early
    if (depth >= 5 && Math.abs(beta) < MATE_BOUND) {
      const pbBeta = beta + 190;
      const pbMoves = MOVE_LISTS[ply];
      const pbScores = SCORE_LISTS[ply];
      const pbCount = genCaptures(pos, pbMoves);
      scoreMovesV3(pos, pbMoves, pbCount, pbScores, ttMove, ply, true);
      for (let i = 0; i < pbCount; i++) {
        pickBest(pbMoves, pbScores, i, pbCount);
        const m = pbMoves[i];
        if (see(pos, m) < pbBeta - staticEval) continue;
        const mp = pos.board[moveFrom(m)];
        plyMove[ply] = m;
        plyPieceTo[ply] = pieceIndex(mp) * 64 + sqTo64(moveTo(m));
        makeMove(pos, m);
        if (!moveIsLegal(pos, m, false)) {
          unmakeMove(pos, m);
          continue;
        }
        let s = -qsearch(pos, -pbBeta, -pbBeta + 1, ply + 1);
        if (s >= pbBeta) {
          s = -search(pos, depth - 4, -pbBeta, -pbBeta + 1, ply + 1, false);
        }
        unmakeMove(pos, m);
        if (stopped) return 0;
        if (s >= pbBeta) return s;
      }
    }
  }

  // Internal Iterative Reduction (IIR)
  if (depth >= 4 && ttMove === 0 && excludedMove === 0) {
    depth--;
  }

  // Clear child killers for clean deeper lookahead
  if (ply + 1 < MAX_PLY) {
    killers[(ply + 1) * 2] = 0;
    killers[(ply + 1) * 2 + 1] = 0;
  }

  const moves = MOVE_LISTS[ply];
  const scores = SCORE_LISTS[ply];
  const quiets = QUIETS_TRIED[ply];
  const count = genMoves(pos, moves);
  scoreMovesV3(pos, moves, count, scores, ttMove, ply, false);

  let bestScore = -INF;
  let bestMove = 0;
  const alphaOrig = alpha;
  let legalCount = 0;
  let quietCount = 0;
  let prunedAny = false;

  for (let i = 0; i < count; i++) {
    pickBest(moves, scores, i, count);
    const move = moves[i];
    if (move === excludedMove) continue;
    if (isRoot && (move === rootExcluded0 || move === rootExcluded1)) continue;

    const captured = moveCaptured(move);
    const promo = movePromo(move);
    const isQuiet = captured === 0 && promo === 0;

    // Forward pruning on late moves (only after at least 1 legal move has been searched)
    if (!isRoot && !checked && legalCount > 0 && bestScore > -MATE_BOUND) {
      if (isQuiet) {
        // Late Move Pruning (LMP)
        if (!isPv && depth <= 4) {
          const lmpLimit = improving ? LMP_COUNTS[depth] : (LMP_COUNTS[depth] >> 1) + 2;
          if (quietCount >= lmpLimit && scores[i] < 1 << 24) {
            prunedAny = true;
            continue;
          }
        }
        // Futility Pruning
        if (depth <= 5 && evalScore + FUTILITY_MARGIN[depth] <= alpha && Math.abs(alpha) < MATE_BOUND) {
          prunedAny = true;
          continue;
        }
      } else {
        // SEE Pruning for losing captures (scores[i] < 0 means SEE was already negative)
        if (depth <= 4 && scores[i] < 0) {
          prunedAny = true;
          continue;
        }
      }
    }

    // Singular Extension check on the TT move
    let extension = 0;
    if (
      !isRoot &&
      move === ttMove &&
      excludedMove === 0 &&
      depth >= 7 &&
      ttDepth >= depth - 3 &&
      (ttFlag === FLAG_LOWER || ttFlag === FLAG_EXACT) &&
      Math.abs(ttScore) < MATE_BOUND &&
      ply + 2 < MAX_PLY
    ) {
      const sBeta = ttScore - depth * 2;
      const sDepth = (depth - 1) >> 1;
      excludedMoveStack[ply] = move;
      const sScore = search(pos, sDepth, sBeta - 1, sBeta, ply, false);
      excludedMoveStack[ply] = 0;
      if (stopped) return 0;
      // Restore move list & scores since recursion at `ply` overwrote MOVE_LISTS[ply]
      const restoredCount = genMoves(pos, moves);
      scoreMovesV3(pos, moves, restoredCount, scores, ttMove, ply, false);
      // Put `move` at index `i` (since i === 0 for ttMove)
      pickBest(moves, scores, i, restoredCount);
      if (sScore < sBeta) {
        extension = 1;
      } else if (sBeta >= beta) {
        return sBeta; // Multi-cut
      }
    }

    const movingPiece = pos.board[moveFrom(move)];
    const movingPt = pieceIndex(movingPiece) * 64 + sqTo64(moveTo(move));
    plyMove[ply] = move;
    plyPieceTo[ply] = movingPt;

    makeMove(pos, move);
    if (!moveIsLegal(pos, move, checked)) {
      unmakeMove(pos, move);
      continue;
    }
    legalCount++;
    if (isQuiet) quiets[quietCount++] = move;

    const newDepth = depth - 1 + extension;
    let score: number;

    if (legalCount === 1) {
      score = -search(pos, newDepth, -beta, -alpha, ply + 1, true);
    } else {
      let reduce = 0;
      if (depth >= 3 && legalCount > 2 && isQuiet && !checked) {
        const d = depth < 64 ? depth : 63;
        const mIdx = legalCount < 64 ? legalCount : 63;
        reduce = LMR[d * 64 + mIdx];

        if (isPv) reduce--;
        if (!improving) reduce++;
        if (scores[i] >= (1 << 25) - 2) reduce--; // killer or countermove
        // History modulation
        const histMod = (scores[i] / 6000) | 0;
        reduce -= histMod;

        if (reduce > newDepth - 1) reduce = newDepth - 1;
        if (reduce < 0) reduce = 0;
      }

      score = -search(pos, newDepth - reduce, -alpha - 1, -alpha, ply + 1, true);
      if (score > alpha && reduce > 0) {
        score = -search(pos, newDepth, -alpha - 1, -alpha, ply + 1, true);
      }
      if (score > alpha && score < beta) {
        score = -search(pos, newDepth, -beta, -alpha, ply + 1, true);
      }
    }

    unmakeMove(pos, move);
    if (stopped) return 0;

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
      if (score > alpha) {
        alpha = score;

        if (excludedMove === 0) {
          pvTable[ply * MAX_PLY] = move;
          const childLen = pvLength[ply + 1];
          for (let j = 0; j < childLen; j++) {
            pvTable[ply * MAX_PLY + 1 + j] = pvTable[(ply + 1) * MAX_PLY + j];
          }
          pvLength[ply] = childLen + 1;
        }

        if (alpha >= beta) {
          if (isQuiet) {
            const k = ply * 2;
            if (killers[k] !== move) {
              killers[k + 1] = killers[k];
              killers[k] = move;
            }
            updateQuietHistories(pos, move, ply, depth, quiets, quietCount);
          } else if (captured !== 0) {
            const cBonus = Math.min(1200, depth * depth * 12);
            updateHistoryVal(capHistory, movingPt * 8 + captured, cBonus);
          }
          break;
        }
      }
    }
  }

  if (legalCount === 0) {
    if (excludedMove !== 0 || (isRoot && rootExcluded0 !== 0)) return alpha;
    if (prunedAny && hasAnyLegalMove(pos, checked)) {
      return evalScore;
    }
    return checked ? -MATE + ply : 0;
  }

  if (excludedMove === 0 && (!isRoot || rootExcluded0 === 0)) {
    let storeScore = bestScore;
    if (storeScore > MATE_BOUND) storeScore += ply;
    else if (storeScore < -MATE_BOUND) storeScore -= ply;
    const flag = bestScore >= beta ? FLAG_LOWER : bestScore > alphaOrig ? FLAG_EXACT : FLAG_UPPER;
    ttStore(idx, pos.hashHi, bestMove, storeScore, depth, flag);
  }

  return bestScore;
}

// ---------------------------------------------------------------------------
// Root Driver with Hybrid Book + Novelty Synthesis & Adaptive Time Management
// ---------------------------------------------------------------------------

function extractPv(pos: Position, len: number): { pvUci: string[]; pvSan: string[] } {
  const pvUci: string[] = [];
  const pvSan: string[] = [];
  const made: number[] = [];
  for (let i = 0; i < len; i++) {
    const m = pvTable[i];
    const count = genMoves(pos, pvPseudo);
    const n = filterLegal(pos, pvPseudo, count, pvLegal);
    let found = -1;
    for (let k = 0; k < n; k++) {
      if (pvLegal[k] === m) {
        found = m;
        break;
      }
    }
    if (found < 0) break;
    pvSan.push(moveToSan(pos, m));
    pvUci.push(moveToUci(m));
    makeMove(pos, m);
    made.push(m);
  }
  for (let i = made.length - 1; i >= 0; i--) unmakeMove(pos, made[i]);
  return { pvUci, pvSan };
}

function formatMultiPvLine(
  pos: Position,
  rank: number,
  move: number,
  rawScore: number,
  pvUci: string[],
  pvSan: string[],
  selected: boolean,
): MultiPvLine {
  const line: MultiPvLine = {
    rank,
    move,
    uci: moveToUci(move),
    san: pvSan[0] ?? moveToSan(pos, move),
    pvUci,
    pvSan,
    selected,
  };
  if (rawScore > MATE_BOUND) line.scoreMate = Math.ceil((MATE - rawScore + 1) / 2);
  else if (rawScore < -MATE_BOUND) line.scoreMate = -Math.ceil((MATE + rawScore + 1) / 2);
  else line.scoreCp = rawScore;
  return line;
}

function buildInfo(
  pos: Position,
  depth: number,
  score: number,
  start: number,
  pvUci: string[],
  pvSan: string[],
  bookOpening?: string,
  multiPv?: MultiPvLine[],
): SearchInfo {
  const timeMs = Math.max(1, performance.now() - start);
  const info: SearchInfo = {
    depth,
    seldepth,
    nodes,
    timeMs: Math.round(timeMs),
    nps: Math.round(nodes / (timeMs / 1000)),
    stm: pos.stm,
    pvUci,
    pvSan,
    ...(bookOpening ? { bookOpening } : {}),
    ...(multiPv ? { multiPv } : {}),
  };
  if (score > MATE_BOUND) info.scoreMate = Math.ceil((MATE - score + 1) / 2);
  else if (score < -MATE_BOUND) info.scoreMate = -Math.ceil((MATE + score + 1) / 2);
  else info.scoreCp = score;
  return info;
}

const rootPseudo = new Int32Array(MAX_MOVES);
const rootLegal = new Int32Array(MAX_MOVES);

/**
 * Full iterative-deepening v3 search on `pos` with 3-Line Multi-PV candidate
 * evaluation, Hybrid Book + Novelty synthesis, and adaptive time management.
 */
export function searchPositionV3(
  pos: Position,
  limits: SearchLimits,
  onInfo?: (info: SearchInfo) => void,
): SearchResult {
  const start = performance.now();
  nodes = 0;
  seldepth = 0;
  stopped = false;
  excludedMoveStack.fill(0);
  rootExcluded0 = 0;
  rootExcluded1 = 0;

  const maxBudget = limits.movetime !== undefined ? limits.movetime : Number.POSITIVE_INFINITY;
  hardDeadline = limits.movetime !== undefined ? start + maxBudget : Number.POSITIVE_INFINITY;
  const maxDepth = Math.max(1, Math.min(limits.depth ?? MAX_PLY - 8, MAX_PLY - 8));

  ttAge = (ttAge + 1) & 15;
  killers.fill(0);
  for (let i = 0; i < history.length; i++) history[i] >>= 1;
  for (let i = 0; i < contHistory.length; i++) contHistory[i] >>= 1;
  for (let i = 0; i < capHistory.length; i++) capHistory[i] >>= 1;

  const pseudoCount = genMoves(pos, rootPseudo);
  const rootCount = filterLegal(pos, rootPseudo, pseudoCount, rootLegal);

  if (rootCount === 0) {
    const mated = inCheckOf(pos, pos.stm);
    return {
      bestMove: 0,
      bestMoveUci: '',
      depth: 0,
      seldepth: 0,
      nodes: 0,
      timeMs: 0,
      nps: 0,
      stm: pos.stm,
      pvUci: [],
      pvSan: [],
      ...(mated ? { scoreMate: 0 } : { scoreCp: 0 }),
    };
  }

  const multiPvTarget = Math.max(1, Math.min(limits.multiPv ?? 3, rootCount, 3));

  // Probe Hybrid Opening Book for prelearned theory candidates
  const bookCandidates = probeBookV3(pos);
  const topBookMove = bookCandidates.length > 0 ? bookCandidates[0].move : 0;

  // Seed the TT root entry with the top book move so PVS searches the
  // Grandmaster mainline first while still evaluating all alternatives!
  if (topBookMove !== 0) {
    const rootIdx = pos.hashLo & TT_MASK;
    ttStore(rootIdx, pos.hashHi, topBookMove, 0, 1, FLAG_UPPER);
  }

  const labelForMove = (m: number): string | undefined => {
    if (bookCandidates.length === 0) return undefined;
    const match = bookCandidates.find((b) => b.move === m);
    if (match) return `Book · ${match.opening}`;
    return `Engine Novelty (vs ${bookCandidates[0].opening.split('·')[0].trim()})`;
  };

  let bestMove = topBookMove !== 0 ? topBookMove : rootLegal[0];
  let bestInfo: SearchInfo = buildInfo(pos, 0, 0, start, [], [], labelForMove(bestMove), []);
  let completedDepth = 0;
  let prevScore = 0;
  let moveStability = 0;

  // Adaptive soft time target (under 10s budget, fast when clear, deep when complex)
  const isTimed = limits.movetime !== undefined && limits.depth === undefined;
  const softBudget = isTimed
    ? maxBudget <= 2000
      ? maxBudget * 0.72
      : topBookMove !== 0
        ? Math.min(1400, maxBudget * 0.3) // Fast verification when in book
        : maxBudget * 0.65
    : Number.POSITIVE_INFINITY;

  for (let depth = 1; depth <= maxDepth; depth++) {
    rootExcluded0 = 0;
    rootExcluded1 = 0;
    let score1: number;

    if (depth >= 5 && completedDepth > 0 && Math.abs(prevScore) < MATE_BOUND) {
      let delta = 22;
      let alpha = Math.max(-INF, prevScore - delta);
      let beta = Math.min(INF, prevScore + delta);
      for (;;) {
        score1 = search(pos, depth, alpha, beta, 0, true);
        if (stopped) break;
        if (score1 <= alpha) {
          beta = (alpha + beta) >> 1;
          delta += delta >> 1;
          alpha = Math.max(-INF, alpha - delta);
        } else if (score1 >= beta) {
          delta += delta >> 1;
          beta = Math.min(INF, beta + delta);
        } else {
          break;
        }
      }
    } else {
      score1 = search(pos, depth, -INF, INF, 0, true);
    }

    if (stopped) {
      if (completedDepth > 0) break;
      stopped = false;
      hardDeadline = start + (limits.movetime ?? 1000) + 5000;
      const s = search(pos, 1, -INF, INF, 0, true);
      stopped = false;
      prevScore = s;
      bestMove = pvLength[0] > 0 ? pvTable[0] : bestMove;
      const pv1 = extractPv(pos, pvLength[0]);
      const line1 = formatMultiPvLine(pos, 1, bestMove, s, pv1.pvUci, pv1.pvSan, true);
      completedDepth = 1;
      bestInfo = buildInfo(pos, 1, s, start, pv1.pvUci, pv1.pvSan, labelForMove(bestMove), [line1]);
      onInfo?.(bestInfo);
      break;
    }

    const move1 = pvLength[0] > 0 ? pvTable[0] : bestMove;
    const pv1 = extractPv(pos, pvLength[0]);
    const candidates: { move: number; rawScore: number; pvUci: string[]; pvSan: string[] }[] = [
      { move: move1, rawScore: score1, pvUci: pv1.pvUci, pvSan: pv1.pvSan },
    ];

    // Search 2nd and 3rd distinct candidate lines so v3 compares 3 different lines and picks the best
    const altDepth = depth <= 4 ? depth : Math.max(2, depth - 2);
    if (multiPvTarget >= 2 && !stopped) {
      rootExcluded0 = move1;
      rootExcluded1 = 0;
      let score2 = search(pos, altDepth, -INF, INF, 0, true);
      if (!stopped && pvLength[0] > 0) {
        const move2 = pvTable[0];
        // If candidate #2 beat candidate #1 at altDepth, verify it at full depth!
        if (altDepth < depth && score2 > score1) {
          const fullScore2 = search(pos, depth, -INF, INF, 0, true);
          if (!stopped && pvLength[0] > 0) {
            score2 = fullScore2;
          }
        }
        const pv2 = extractPv(pos, pvLength[0]);
        candidates.push({ move: move2, rawScore: score2, pvUci: pv2.pvUci, pvSan: pv2.pvSan });

        if (multiPvTarget >= 3 && !stopped) {
          rootExcluded0 = move1;
          rootExcluded1 = move2;
          let score3 = search(pos, altDepth, -INF, INF, 0, true);
          if (!stopped && pvLength[0] > 0) {
            const move3 = pvTable[0];
            if (altDepth < depth && score3 > score1) {
              const fullScore3 = search(pos, depth, -INF, INF, 0, true);
              if (!stopped && pvLength[0] > 0) {
                score3 = fullScore3;
              }
            }
            const pv3 = extractPv(pos, pvLength[0]);
            candidates.push({ move: move3, rawScore: score3, pvUci: pv3.pvUci, pvSan: pv3.pvSan });
          }
        }
      }
      rootExcluded0 = 0;
      rootExcluded1 = 0;
      // Restore stopped flag if an alternate line ran out of time after Line 1 already succeeded
      if (stopped) {
        stopped = true;
      }
    }

    // Rank all 3 candidate lines by their evaluated score (with master book weight tie-breaker in opening)
    candidates.sort((a, b) => {
      const diff = b.rawScore - a.rawScore;
      if (Math.abs(diff) <= 10 && bookCandidates.length > 0 && pos.fullmove <= 8) {
        const wA = bookCandidates.find((bm) => bm.move === a.move)?.weight ?? 0;
        const wB = bookCandidates.find((bm) => bm.move === b.move)?.weight ?? 0;
        if (wA !== wB) return wB - wA;
      }
      return diff;
    });
    const winner = candidates[0];

    // Ensure root TT stores the winning move
    ttStore(pos.hashLo & TT_MASK, pos.hashHi, winner.move, winner.rawScore, depth, FLAG_EXACT);

    if (winner.move === bestMove) {
      moveStability++;
    } else {
      moveStability = 0;
    }

    const scoreDrop = completedDepth > 0 ? prevScore - winner.rawScore : 0;
    prevScore = winner.rawScore;
    bestMove = winner.move;
    completedDepth = depth;

    const multiPvLines = candidates.map((c, idx) =>
      formatMultiPvLine(pos, idx + 1, c.move, c.rawScore, c.pvUci, c.pvSan, idx === 0),
    );

    bestInfo = buildInfo(
      pos,
      depth,
      winner.rawScore,
      start,
      winner.pvUci,
      winner.pvSan,
      labelForMove(bestMove),
      multiPvLines,
    );
    onInfo?.(bestInfo);

    if (stopped) break;

    // Forced single legal move: finish quickly after a shallow sanity search
    if (isTimed && rootCount === 1 && depth >= 4) break;

    // Stop immediately if a forced mate is proven
    if (Math.abs(winner.rawScore) > MATE_BOUND && depth >= 4) break;

    if (isTimed) {
      const elapsed = performance.now() - start;
      let dynamicSoft = softBudget;
      if (scoreDrop > 35) {
        dynamicSoft = Math.min(maxBudget * 0.88, softBudget * 1.6);
      } else if (moveStability === 0 && depth >= 6) {
        dynamicSoft = Math.min(maxBudget * 0.82, softBudget * 1.38);
      } else if (moveStability >= 5 && depth >= 9 && scoreDrop <= 10) {
        dynamicSoft = softBudget * 0.72;
      }

      if (elapsed >= dynamicSoft) break;
    }
  }

  const timeMs = Math.max(1, performance.now() - start);
  return {
    ...bestInfo,
    bestMove,
    bestMoveUci: moveToUci(bestMove),
    timeMs: Math.round(timeMs),
    nps: Math.round(nodes / (timeMs / 1000)),
  };
}

export function clearTTV3(): void {
  TT_KEY_HI.fill(0);
  TT_MOVE.fill(0);
  TT_DATA.fill(0);
  ttAge = 0;
}
