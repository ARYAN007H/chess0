/**
 * Chess0 v2 search: iterative-deepening negamax with aspiration windows,
 * principal variation search, transposition table (Zobrist), quiescence with
 * SEE + delta pruning, MVV-LVA + killers + countermoves + history ordering,
 * null-move pruning, reverse-futility and futility pruning, SEE-based capture
 * pruning, late move reductions, check extension and internal iterative
 * reduction.
 *
 * Evaluation comes from evalV2 (PeSTO base + pawn structure / mobility /
 * king safety). All per-node state lives in preallocated module arrays; the
 * search itself allocates nothing.
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
} from './types';
import { makeMove, makeNullMove, unmakeMove, unmakeNullMove } from './position';
import type { Position } from './position';
import { genCaptures, genMoves, inCheckOf, moveIsLegal, filterLegal } from './movegen';
import { evalV2 } from './evalV2';
import { hasNonPawnMaterial, insufficientMaterial } from './eval';
import { see } from './see';
import { moveToSan } from './san';
import type { SearchInfo, SearchLimits, SearchResult } from './search';

// ---------------------------------------------------------------------------
// Transposition table: 2^20 slots x {key-hi, move, packed data}.
// data = score(16) | depth(7)<<16 | flag(2)<<23 | age(4)<<25
// ---------------------------------------------------------------------------

const TT_BITS = 20;
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
  const oldDepth = (TT_DATA[idx] >>> 16) & 0x7f;
  const oldAge = (TT_DATA[idx] >>> 25) & 15;
  if (oldAge !== ttAge || depth >= oldDepth || flag === FLAG_EXACT) {
    TT_KEY_HI[idx] = hashHi;
    TT_MOVE[idx] = move;
    TT_DATA[idx] = (score & 0xffff) | ((depth & 0x7f) << 16) | (flag << 23) | (ttAge << 25);
  }
}

// ---------------------------------------------------------------------------
// Per-node scratch
// ---------------------------------------------------------------------------

const MOVE_LISTS: Int32Array[] = Array.from({ length: MAX_PLY }, () => new Int32Array(MAX_MOVES));
const SCORE_LISTS: Int32Array[] = Array.from({ length: MAX_PLY }, () => new Int32Array(MAX_MOVES));

const killers = new Int32Array(MAX_PLY * 2);
const history = new Int32Array(2 * 128 * 128);
const counterMoves = new Int32Array(2 * 128 * 128);

// Triangular PV table.
const pvLength = new Int32Array(MAX_PLY);
const pvTable = new Int32Array(MAX_PLY * MAX_PLY);

// LMR reduction table [depth][moveIndex].
const LMR = new Int32Array(64 * 64);
for (let d = 1; d < 64; d++) {
  for (let i = 1; i < 64; i++) {
    LMR[d * 64 + i] = Math.max(0, Math.round(0.5 + (Math.log(d) * Math.log(i)) / 2.25));
  }
}

const PIECE_V = [0, 100, 320, 330, 500, 900, 20000];

// Futility margins by remaining depth (applied to quiet moves at the horizon).
const FUTILITY = [0, 150, 300, 480];

let nodes = 0;
let seldepth = 0;
let stopped = false;
let deadline = Number.POSITIVE_INFINITY;

// Scratch for PV extraction and legality fallbacks.
const pvPseudo = new Int32Array(MAX_MOVES);
const pvLegal = new Int32Array(MAX_MOVES);
const anyPseudo = new Int32Array(MAX_MOVES);

// ---------------------------------------------------------------------------

function isRepetition(pos: Position): boolean {
  const start = Math.max(0, pos.ply - pos.halfmove);
  for (let h = pos.ply - 2; h >= start; h -= 2) {
    if (pos.histHashLo[h] === pos.hashLo && pos.histHashHi[h] === pos.hashHi) return true;
  }
  return false;
}

function scoreMoves(pos: Position, moves: Int32Array, count: number, scores: Int32Array, ttMove: number, ply: number): void {
  const stm = pos.stm;
  const k1 = killers[ply * 2];
  const k2 = killers[ply * 2 + 1];
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
    if (captured !== 0) {
      const attacker = pos.board[from];
      const attackerType = attacker < 0 ? -attacker : attacker;
      scores[i] = (1 << 26) + PIECE_V[captured] * 16 - PIECE_V[attackerType];
      if (promo !== 0) scores[i] += PIECE_V[promo];
    } else if (promo !== 0) {
      scores[i] = (1 << 26) + PIECE_V[promo] * 8;
    } else if (m === k1) {
      scores[i] = 1 << 25;
    } else if (m === k2) {
      scores[i] = (1 << 25) - 1;
    } else if (counterMoves[(stm << 14) | (from << 7) | to] === m) {
      scores[i] = 1 << 24;
    } else {
      scores[i] = history[(stm << 14) | (from << 7) | to];
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

/** Does the side to move have any legal move? (Slow; only used after pruning skipped everything.) */
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

function qsearch(pos: Position, alpha: number, beta: number, ply: number): number {
  nodes++;
  if ((nodes & 2047) === 0 && performance.now() >= deadline) {
    stopped = true;
    return 0;
  }
  if (ply >= MAX_PLY - 1) return evalV2(pos);
  if (ply > seldepth) seldepth = ply;

  const checked = inCheckOf(pos, pos.stm);
  let stand = 0;
  let bestScore = -INF;

  if (!checked) {
    stand = evalV2(pos);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    bestScore = stand;
  }

  const moves = MOVE_LISTS[ply];
  const scores = SCORE_LISTS[ply];
  const count = checked ? genMoves(pos, moves) : genCaptures(pos, moves);
  scoreMoves(pos, moves, count, scores, 0, ply);

  let legalCount = 0;
  for (let i = 0; i < count; i++) {
    pickBest(moves, scores, i, count);
    const move = moves[i];
    const captured = moveCaptured(move);
    const promo = movePromo(move);

    if (!checked) {
      // Delta pruning: skip hopeless captures/promotions.
      let gain = captured !== 0 ? PIECE_V[captured] : 0;
      if (promo === QUEEN) gain += 800;
      if (stand + gain + 200 <= alpha) continue;
      // SEE pruning: never spend a node on a capture that loses material.
      if (captured !== 0 && see(pos, move) < 0) continue;
    }

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
      if (score > alpha) {
        alpha = score;
        if (alpha >= beta) break;
      }
    }
  }

  if (checked && legalCount === 0) return -MATE + ply;
  return bestScore;
}

// ---------------------------------------------------------------------------

function search(pos: Position, depth: number, alpha: number, beta: number, ply: number, canNull: boolean): number {
  if (stopped) return 0;
  nodes++;
  if ((nodes & 2047) === 0 && performance.now() >= deadline) {
    stopped = true;
    return 0;
  }
  if (ply >= MAX_PLY - 2) return evalV2(pos);
  pvLength[ply] = 0;

  if (ply > 0) {
    if (pos.halfmove >= 100 || insufficientMaterial(pos) || isRepetition(pos)) return 0;

    // Mate distance pruning.
    const mateAlpha = -MATE + ply;
    const mateBeta = MATE - ply - 1;
    if (alpha < mateAlpha) alpha = mateAlpha;
    if (beta > mateBeta) beta = mateBeta;
    if (alpha >= beta) return alpha;
  }

  const checked = inCheckOf(pos, pos.stm);
  if (checked) depth++; // check extension

  if (depth <= 0) return qsearch(pos, alpha, beta, ply);

  // TT probe.
  const idx = pos.hashLo & TT_MASK;
  let ttMove = 0;
  if (TT_KEY_HI[idx] === pos.hashHi) {
    const data = TT_DATA[idx];
    let score = (data << 16) >> 16; // sign-extend low 16 bits
    const entryDepth = (data >>> 16) & 0x7f;
    const flag = (data >>> 23) & 3;
    ttMove = TT_MOVE[idx];
    if (entryDepth >= depth && ply > 0) {
      if (score > MATE_BOUND) score -= ply;
      else if (score < -MATE_BOUND) score += ply;
      if (flag === FLAG_EXACT) return score;
      if (flag === FLAG_LOWER && score >= beta) return score;
      if (flag === FLAG_UPPER && score <= alpha) return score;
    }
  }

  const staticEval = evalV2(pos);

  // Reverse futility pruning: the position is already too good to be undone.
  if (!checked && ply > 0 && depth <= 4 && staticEval - 70 * depth >= beta && beta > -MATE_BOUND && beta < MATE_BOUND) {
    return staticEval;
  }

  // Null-move pruning.
  if (canNull && !checked && ply > 0 && depth >= 3 && staticEval >= beta && hasNonPawnMaterial(pos)) {
    const r = depth >= 6 ? 3 : 2;
    makeNullMove(pos);
    const score = -search(pos, depth - 1 - r, -beta, -beta + 1, ply + 1, false);
    unmakeNullMove(pos);
    if (stopped) return 0;
    if (score >= beta && Math.abs(score) < MATE_BOUND) return score;
  }

  // Internal iterative reduction: without a TT move, search one ply shallower.
  if (depth >= 4 && ttMove === 0) depth--;

  const moves = MOVE_LISTS[ply];
  const scores = SCORE_LISTS[ply];
  const count = genMoves(pos, moves);
  scoreMoves(pos, moves, count, scores, ttMove, ply);

  let bestScore = -INF;
  let bestMove = 0;
  const alphaOrig = alpha;
  let legalCount = 0;
  let prunedAny = false;

  for (let i = 0; i < count; i++) {
    pickBest(moves, scores, i, count);
    const move = moves[i];
    const captured = moveCaptured(move);
    const promo = movePromo(move);
    const isQuiet = captured === 0 && promo === 0;

    // Futility pruning: quiet moves too weak to raise alpha at the horizon.
    // The legalCount > 0 guard keeps the only legal move from being skipped.
    if (!checked && ply > 0 && depth <= 3 && isQuiet && legalCount > 0 && staticEval + FUTILITY[depth] <= alpha && alpha > -MATE_BOUND && alpha < MATE_BOUND) {
      prunedAny = true;
      continue;
    }

    // SEE pruning: losing captures at low depth are not worth a node.
    if (!checked && ply > 0 && captured !== 0 && depth <= 4 && see(pos, move) < -30 * depth) {
      prunedAny = true;
      continue;
    }

    makeMove(pos, move);
    if (!moveIsLegal(pos, move, checked)) {
      unmakeMove(pos, move);
      continue;
    }
    legalCount++;

    let score: number;
    if (legalCount === 1) {
      score = -search(pos, depth - 1, -beta, -alpha, ply + 1, true);
    } else {
      let reduce = 0;
      if (depth >= 3 && legalCount > 2 && isQuiet && !checked) {
        const d = depth < 64 ? depth : 63;
        reduce = LMR[d * 64 + (legalCount < 64 ? legalCount : 63)];
        if (move === killers[ply * 2] || move === killers[ply * 2 + 1]) reduce--;
        if (reduce > depth - 2) reduce = depth - 2;
        if (reduce < 0) reduce = 0;
      }
      score = -search(pos, depth - 1 - reduce, -alpha - 1, -alpha, ply + 1, true);
      if (score > alpha && reduce > 0) {
        score = -search(pos, depth - 1, -alpha - 1, -alpha, ply + 1, true);
      }
      if (score > alpha && score < beta) {
        score = -search(pos, depth - 1, -beta, -alpha, ply + 1, true);
      }
    }
    unmakeMove(pos, move);
    if (stopped) return 0;

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
      if (score > alpha) {
        alpha = score;

        pvTable[ply * MAX_PLY] = move;
        const childLen = pvLength[ply + 1];
        for (let j = 0; j < childLen; j++) {
          pvTable[ply * MAX_PLY + 1 + j] = pvTable[(ply + 1) * MAX_PLY + j];
        }
        pvLength[ply] = childLen + 1;

        if (alpha >= beta) {
          if (isQuiet) {
            const k = ply * 2;
            if (killers[k] !== move) {
              killers[k + 1] = killers[k];
              killers[k] = move;
            }
            const hIdx = (pos.stm << 14) | (moveFrom(move) << 7) | moveTo(move);
            counterMoves[hIdx] = move;
            history[hIdx] += depth * depth;
            if (history[hIdx] > 1 << 20) history[hIdx] = 1 << 20;
          }
          break;
        }
      }
    }
  }

  if (legalCount === 0) {
    if (prunedAny && hasAnyLegalMove(pos, checked)) {
      // Everything was pruned, but a legal move exists: not mate/stalemate.
      return staticEval;
    }
    return checked ? -MATE + ply : 0;
  }

  let storeScore = bestScore;
  if (storeScore > MATE_BOUND) storeScore += ply;
  else if (storeScore < -MATE_BOUND) storeScore -= ply;
  const flag = bestScore >= beta ? FLAG_LOWER : bestScore > alphaOrig ? FLAG_EXACT : FLAG_UPPER;
  ttStore(idx, pos.hashHi, bestMove, storeScore, depth, flag);

  return bestScore;
}

// ---------------------------------------------------------------------------
// Root driver
// ---------------------------------------------------------------------------

function extractPv(pos: Position, len: number): { pvUci: string[]; pvSan: string[] } {
  const pvUci: string[] = [];
  const pvSan: string[] = [];
  const made: number[] = [];
  for (let i = 0; i < len; i++) {
    const m = pvTable[i];
    // Validate each PV move against the position (TT corruption guard).
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

function buildInfo(pos: Position, depth: number, score: number, start: number, pvLen: number): SearchInfo {
  const { pvUci, pvSan } = extractPv(pos, pvLen);
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
  };
  if (score > MATE_BOUND) info.scoreMate = Math.ceil((MATE - score + 1) / 2);
  else if (score < -MATE_BOUND) info.scoreMate = -Math.ceil((MATE + score + 1) / 2);
  else info.scoreCp = score;
  return info;
}

const rootPseudo = new Int32Array(MAX_MOVES);
const rootLegal = new Int32Array(MAX_MOVES);

/** Full iterative-deepening v2 search on `pos`. The position is unchanged after. */
export function searchPositionV2(pos: Position, limits: SearchLimits, onInfo?: (info: SearchInfo) => void): SearchResult {
  const start = performance.now();
  nodes = 0;
  seldepth = 0;
  stopped = false;
  deadline = limits.movetime !== undefined ? start + limits.movetime : Number.POSITIVE_INFINITY;
  const maxDepth = Math.max(1, Math.min(limits.depth ?? MAX_PLY - 8, MAX_PLY - 8));

  ttAge = (ttAge + 1) & 15;
  killers.fill(0);
  counterMoves.fill(0);
  for (let i = 0; i < history.length; i++) history[i] >>= 1;

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

  let bestMove = rootLegal[0];
  let bestInfo: SearchInfo = buildInfo(pos, 0, 0, start, 0);
  let completedDepth = 0;
  let prevScore = 0;

  for (let depth = 1; depth <= maxDepth; depth++) {
    let score: number;
    if (depth >= 4 && completedDepth > 0 && Math.abs(prevScore) < MATE_BOUND) {
      // Aspiration window around the previous iteration's score.
      let delta = 40;
      let alpha = Math.max(-INF, prevScore - delta);
      let beta = Math.min(INF, prevScore + delta);
      for (;;) {
        score = search(pos, depth, alpha, beta, 0, true);
        if (stopped) break;
        if (score <= alpha) {
          delta += delta >> 1;
          alpha = Math.max(-INF, alpha - delta);
        } else if (score >= beta) {
          delta += delta >> 1;
          beta = Math.min(INF, beta + delta);
        } else break;
      }
    } else {
      score = search(pos, depth, -INF, INF, 0, true);
    }

    if (stopped) {
      if (completedDepth > 0) break;
      // Depth 1 was interrupted (extremely small budget): re-run it with a
      // generous deadline so we always return a sound move.
      stopped = false;
      deadline = start + limits.movetime! + 5000;
      const s = search(pos, 1, -INF, INF, 0, true);
      if (stopped) {
        stopped = false;
      }
      prevScore = s;
      bestMove = pvLength[0] > 0 ? pvTable[0] : bestMove;
      completedDepth = 1;
      bestInfo = buildInfo(pos, 1, s, start, pvLength[0]);
      onInfo?.(bestInfo);
      break;
    }

    prevScore = score;
    bestMove = pvLength[0] > 0 ? pvTable[0] : bestMove;
    completedDepth = depth;
    bestInfo = buildInfo(pos, depth, score, start, pvLength[0]);
    onInfo?.(bestInfo);

    // Don't start the next iteration if it is unlikely to finish.
    const budget = limits.movetime ?? Number.POSITIVE_INFINITY;
    if (performance.now() - start > budget * 0.6) break;
    if (Math.abs(score) > MATE_BOUND) break;
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

export function clearTTV2(): void {
  TT_KEY_HI.fill(0);
  TT_MOVE.fill(0);
  TT_DATA.fill(0);
  ttAge = 0;
}
