/**
 * Chess0 v2 evaluation: the incremental PeSTO tapered base (material +
 * piece-square tables, maintained in make/unmake) plus on-demand positional
 * terms — pawn structure (doubled / isolated / passed), bishop pair, rook
 * placement (open files, seventh rank), piece mobility and king pawn-shield
 * safety.
 *
 * Every term is computed symmetrically for both colors and accumulated as
 * white-relative mg/eg pairs, blended by game phase at the end.
 */

import { BISHOP, BLACK, KING, KNIGHT, PAWN, QUEEN, ROOK, WHITE } from './types';
import type { Position } from './position';
import { TOTAL_PHASE } from './psto';

export const TEMPO = 12;

// mg/eg value pairs (centipawns).
const BISHOP_PAIR = [22, 45];
const DOUBLED = [-12, -28];
const ISOLATED = [-14, -10];
/** Indexed by (relative) rank; ranks 0 and 7 are impossible for pawns. */
const PASSED_MG = [0, 2, 6, 14, 28, 52, 90, 0];
const PASSED_EG = [0, 8, 16, 32, 58, 92, 140, 0];
const ROOK_OPEN = [30, 8];
const ROOK_SEMI = [14, 4];
const ROOK_7TH = [16, 24];
/** Per counted move beyond the baseline expectation. */
const MOBILITY_N = [4, 4];
const MOBILITY_B = [4, 4];
const MOBILITY_R = [2, 5];
const MOBILITY_Q = [1, 2];
const MOB_BASE_N = 4;
const MOB_BASE_B = 6;
const MOB_BASE_R = 7;
const MOB_BASE_Q = 14;
/** Pawn-shield per file around the king (midgame only). */
const SHIELD_CLOSE = 12;
const SHIELD_OPEN = -16;

const KNIGHT_OFFSETS = [33, 31, 18, 14, -33, -31, -18, -14];
const BISHOP_DIRS = [15, 17, -15, -17];
const ROOK_DIRS = [16, 1, -16, -1];
const QUEEN_DIRS = [15, 17, 16, 1, -15, -17, -16, -1];

// Preallocated scratch (eval runs millions of times — nothing may allocate).
const pawnFileCount = [new Int32Array(8), new Int32Array(8)];
const pawnMaxRank = [new Int32Array(8), new Int32Array(8)];
const pawnMinRank = [new Int32Array(8), new Int32Array(8)];
const pawnRankCount = [new Int32Array(8), new Int32Array(8)];
const pawnSqs = [new Int32Array(10), new Int32Array(10)];
const pieces = [new Int32Array(16), new Int32Array(16)]; // packed: sq | type << 8

/** Number of empty or enemy squares attacked by the slider/knight from `sq`. */
function mobilityOf(pos: Position, sq: number, type: number): number {
  const b = pos.board;
  const us = b[sq] > 0 ? WHITE : BLACK;
  const dirs =
    type === KNIGHT ? null : type === BISHOP ? BISHOP_DIRS : type === ROOK ? ROOK_DIRS : QUEEN_DIRS;
  let count = 0;

  if (type === KNIGHT) {
    for (let i = 0; i < 8; i++) {
      const to = sq + KNIGHT_OFFSETS[i];
      if (to & 0x88) continue;
      const t = b[to];
      if (t === 0 || (us === WHITE ? t < 0 : t > 0)) count++;
    }
    return count;
  }

  const sliding = type !== KING;
  for (let i = 0; i < dirs!.length; i++) {
    const d = dirs![i];
    let to = sq + d;
    while (!(to & 0x88)) {
      const t = b[to];
      if (t === 0) {
        count++;
      } else {
        if (us === WHITE ? t < 0 : t > 0) count++;
        break;
      }
      if (!sliding) break;
      to += d;
    }
  }
  return count;
}

/** White-relative score without tempo (for tests / display). */
export function evalV2WhitePov(pos: Position): number {
  const board = pos.board;

  for (let c = 0; c < 2; c++) {
    pawnFileCount[c].fill(0);
    pawnMaxRank[c].fill(-1);
    pawnMinRank[c].fill(8);
    pawnRankCount[c].fill(0);
  }
  let pawnNWhite = 0;
  let pawnNBlack = 0;
  let pieceNWhite = 0;
  let pieceNBlack = 0;
  let bishopsWhite = 0;
  let bishopsBlack = 0;

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = (r << 4) | f;
      const p = board[sq];
      if (p === 0) continue;
      const color = p > 0 ? WHITE : BLACK;
      const type = p > 0 ? p : -p;
      if (type === PAWN) {
        pawnFileCount[color][f]++;
        pawnRankCount[color][r]++;
        if (r > pawnMaxRank[color][f]) pawnMaxRank[color][f] = r;
        if (r < pawnMinRank[color][f]) pawnMinRank[color][f] = r;
        if (color === WHITE) pawnSqs[WHITE][pawnNWhite++] = sq;
        else pawnSqs[BLACK][pawnNBlack++] = sq;
      } else if (type !== KING) {
        if (color === WHITE) pieces[WHITE][pieceNWhite++] = sq | (type << 8);
        else pieces[BLACK][pieceNBlack++] = sq | (type << 8);
        if (type === BISHOP) {
          if (color === WHITE) bishopsWhite++;
          else bishopsBlack++;
        }
      }
    }
  }

  let mg = pos.mg; // material + PST from the incremental accumulators
  let eg = pos.eg;

  for (let c = 0; c < 2; c++) {
    const color = c as 0 | 1;
    const them = (color ^ 1) as 0 | 1;
    const sign = color === WHITE ? 1 : -1;
    const counts = pawnFileCount[color];
    const enemyCounts = pawnFileCount[them];
    let tmg = 0;
    let teg = 0;

    // Bishop pair.
    if ((color === WHITE ? bishopsWhite : bishopsBlack) >= 2) {
      tmg += BISHOP_PAIR[0];
      teg += BISHOP_PAIR[1];
    }

    // Pawn structure per file.
    for (let f = 0; f < 8; f++) {
      const n = counts[f];
      if (n === 0) continue;
      if (n > 1) {
        tmg += DOUBLED[0] * (n - 1);
        teg += DOUBLED[1] * (n - 1);
      }
      const left = f > 0 ? counts[f - 1] : 0;
      const right = f < 7 ? counts[f + 1] : 0;
      if (left === 0 && right === 0) {
        tmg += ISOLATED[0] * n;
        teg += ISOLATED[1] * n;
      }
    }

    // Passed pawns (one pass per own pawn).
    const own = pawnSqs[color];
    const nPawns = color === WHITE ? pawnNWhite : pawnNBlack;
    for (let i = 0; i < nPawns; i++) {
      const sq = own[i];
      const r = sq >> 4;
      const f = sq & 7;
      let passed: boolean;
      if (color === WHITE) {
        passed =
          pawnMaxRank[BLACK][f] <= r &&
          (f === 0 || pawnMaxRank[BLACK][f - 1] < r) &&
          (f === 7 || pawnMaxRank[BLACK][f + 1] < r);
      } else {
        passed =
          pawnMinRank[WHITE][f] >= r &&
          (f === 0 || pawnMinRank[WHITE][f - 1] > r) &&
          (f === 7 || pawnMinRank[WHITE][f + 1] > r);
      }
      if (passed) {
        const relRank = color === WHITE ? r : 7 - r;
        tmg += PASSED_MG[relRank];
        teg += PASSED_EG[relRank];
      }
    }

    // Rooks: open/semi-open files and the seventh rank.
    const list = pieces[color];
    const nPieces = color === WHITE ? pieceNWhite : pieceNBlack;
    for (let i = 0; i < nPieces; i++) {
      const packed = list[i];
      const sq = packed & 0xff;
      const type = packed >> 8;
      const f = sq & 7;
      const r = sq >> 4;
      if (type === ROOK) {
        if (counts[f] === 0) {
          if (enemyCounts[f] === 0) {
            tmg += ROOK_OPEN[0];
            teg += ROOK_OPEN[1];
          } else {
            tmg += ROOK_SEMI[0];
            teg += ROOK_SEMI[1];
          }
        }
        const seventh = color === WHITE ? r === 6 : r === 1;
        const enemyKingRank = pos.kingSq[them] >> 4;
        const enemyPawnRank = color === WHITE ? 6 : 1; // pawns trapped on their own seventh
        if (seventh && (enemyKingRank === (color === WHITE ? 7 : 0) || pawnRankCount[them][enemyPawnRank] > 0)) {
          tmg += ROOK_7TH[0];
          teg += ROOK_7TH[1];
        }
      }
      // Mobility.
      const mob = mobilityOf(pos, sq, type);
      if (type === KNIGHT) {
        tmg += MOBILITY_N[0] * (mob - MOB_BASE_N);
        teg += MOBILITY_N[1] * (mob - MOB_BASE_N);
      } else if (type === BISHOP) {
        tmg += MOBILITY_B[0] * (mob - MOB_BASE_B);
        teg += MOBILITY_B[1] * (mob - MOB_BASE_B);
      } else if (type === ROOK) {
        tmg += MOBILITY_R[0] * (mob - MOB_BASE_R);
        teg += MOBILITY_R[1] * (mob - MOB_BASE_R);
      } else if (type === QUEEN) {
        tmg += MOBILITY_Q[0] * (mob - MOB_BASE_Q);
        teg += MOBILITY_Q[1] * (mob - MOB_BASE_Q);
      }
    }

    // King pawn shield (midgame-weighted via the mg column only).
    const ksq = pos.kingSq[color];
    const kr = ksq >> 4;
    const kf = ksq & 7;
    const dir = color === WHITE ? 1 : -1;
    if (color === WHITE ? kr <= 5 : kr >= 2) {
      const fLo = kf > 0 ? kf - 1 : 0;
      const fHi = kf < 7 ? kf + 1 : 7;
      for (let f = fLo; f <= fHi; f++) {
        const near = ((kr + dir) << 4) | f;
        const far = ((kr + 2 * dir) << 4) | f;
        const pawn = color === WHITE ? PAWN : -PAWN;
        if (board[near] === pawn || board[far] === pawn) {
          tmg += SHIELD_CLOSE;
        } else if (counts[f] === 0) {
          tmg += SHIELD_OPEN;
        }
        // A pawn on the file but not next to the king: no term.
      }
    }

    mg += sign * tmg;
    eg += sign * teg;
  }

  return ((mg * phaseClamped(pos) + eg * (TOTAL_PHASE - phaseClamped(pos))) / TOTAL_PHASE) | 0;
}

function phaseClamped(pos: Position): number {
  return pos.phase > TOTAL_PHASE ? TOTAL_PHASE : pos.phase;
}

/** Side-to-move-relative score in centipawns, tempo included. */
export function evalV2(pos: Position): number {
  const white = evalV2WhitePov(pos);
  return pos.stm === WHITE ? white + TEMPO : -white + TEMPO;
}
