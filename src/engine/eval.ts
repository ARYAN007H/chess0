/**
 * Evaluation: PeSTO tapered eval (midgame/endgame piece-square tables blended
 * by game phase) maintained *incrementally* in make/unmake, so evalPos() is a
 * constant-time interpolation of three accumulators — well under 100ns.
 */

import { BLACK, INF, MATE, MATE_BOUND, WHITE } from './types';
import type { Position } from './position';
import { TOTAL_PHASE } from './psto';

export const TEMPO = 12;

/** White-relative score in centipawns, tempo included. */
export function evalPos(pos: Position): number {
  const phase = pos.phase > TOTAL_PHASE ? TOTAL_PHASE : pos.phase;
  const score = ((pos.mg * phase + pos.eg * (TOTAL_PHASE - phase)) / TOTAL_PHASE) | 0;
  return pos.stm === WHITE ? score + TEMPO : -score + TEMPO;
}

/** Raw white-relative score without tempo (for tests / display). */
export function evalWhitePov(pos: Position): number {
  const phase = pos.phase > TOTAL_PHASE ? TOTAL_PHASE : pos.phase;
  return ((pos.mg * phase + pos.eg * (TOTAL_PHASE - phase)) / TOTAL_PHASE) | 0;
}

/**
 * Dead-position test (FIDE §5.2.2): no checkmate is possible by any sequence
 * of legal moves. True for K vs K, K+minor vs K, and KB vs KB with same-colored
 * bishops. Used for search draw scores and UI game-end detection.
 */
export function insufficientMaterial(pos: Position): boolean {
  if (pos.pawnCount[WHITE] | pos.pawnCount[BLACK] || pos.rqCount[WHITE] | pos.rqCount[BLACK]) {
    return false;
  }
  const wm = pos.minorCount[WHITE];
  const bm = pos.minorCount[BLACK];
  if (wm + bm <= 1) return true;
  if (wm === 1 && bm === 1) {
    // Only KB vs KB (same square color) is a dead position.
    let wb = -1;
    let bb = -1;
    let knightFound = false;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const p = pos.board[sq];
      if (p === 2 || p === -2) knightFound = true; // knights
      else if (p === 3) wb = sq;
      else if (p === -3) bb = sq;
    }
    if (knightFound) return false;
    if (wb >= 0 && bb >= 0) {
      const wbLight = (((wb >> 4) + wb) & 1) === 1;
      const bbLight = (((bb >> 4) + bb) & 1) === 1;
      return wbLight === bbLight;
    }
  }
  return false;
}

/**
 * Does the side to move have any real winning material (used by null-move
 * pruning to stay out of zugzwang)?
 */
export function hasNonPawnMaterial(pos: Position): boolean {
  return pos.npmCount[pos.stm] > 0;
}

/** Convert a stm-relative search score into white-relative and mate-in-N info. */
export function scoreToWhitePov(score: number, stm: 0 | 1): { cp?: number; mate?: number } {
  const s = stm === WHITE ? score : -score;
  if (s > MATE_BOUND) return { mate: Math.ceil((MATE - s + 1) / 2) };
  if (s < -MATE_BOUND) return { mate: -Math.ceil((MATE + s + 1) / 2) };
  return { cp: s };
}

export const SCORE_INF = INF;
export const COLOR_BLACK = BLACK;
