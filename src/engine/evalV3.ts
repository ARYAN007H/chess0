/**
 * Chess0 v3 Evaluation — Grandmaster-grade static evaluation with Pawn TT
 * and 64-bit register bitmasks for pawn attacks.
 *
 * Combines the incremental PeSTO tapered base (material + piece-square tables)
 * with a zero-allocation, mirror-symmetric evaluation of:
 *   1. Pawn structure cached in a 16K-entry Pawn Hash Table (doubled, isolated,
 *      backward, connected, phalanx, and passed-pawn identification)
 *   2. Advanced passed pawns (rank bonus, protected, unblocked path,
 *      Tarrasch rook-behind-passer, endgame king proximity, rule-of-square)
 *   3. Minor piece outposts (knights & bishops on ranks 4-6 immune to enemy pawns)
 *   4. Rook activity (open/semi-open files, 7th rank, connected battery)
 *   5. Safe piece mobility (using register bitmasks to exclude squares controlled by enemy pawns)
 *   6. Non-linear King Safety & King Zone attack units + pawn shield/storm
 *   7. Tactical threats (pawns attacking pieces, minors attacking majors)
 *   8. Endgame scaling (opposite-colored bishops, mop-up king cornering)
 */

import { BISHOP, BLACK, KING, KNIGHT, PAWN, QUEEN, ROOK, WHITE } from './types';
import type { Position } from './position';
import { TOTAL_PHASE } from './psto';
import {
  connectedEgT as CONNECTED_EG,
  connectedMgT as CONNECTED_MG,
  evalV3Params as P,
  passedEgT as PASSED_EG,
  passedFreeEgT as PASSED_FREE_EG,
  passedFreeMgT as PASSED_FREE_MG,
  passedMgT as PASSED_MG,
  phalanxEgT as PHALANX_EG,
  phalanxMgT as PHALANX_MG,
} from './evalV3Params';

export const TEMPO_V3 = P.tempo;

const BISHOP_DIRS = new Int32Array([15, 17, -15, -17]);
const ROOK_DIRS = new Int32Array([16, 1, -16, -1]);
const QUEEN_DIRS = new Int32Array([15, 17, 16, 1, -15, -17, -16, -1]);
const KNIGHT_OFFSETS = new Int32Array([-33, -31, -18, -14, 14, 18, 31, 33]);

// Center distance for mop-up eval (0..64 sq index -> distance from center)
const CENTER_DIST = new Int32Array(64);
for (let r = 0; r < 8; r++) {
  for (let f = 0; f < 8; f++) {
    const dr = r < 4 ? 3 - r : r - 4;
    const df = f < 4 ? 3 - f : f - 4;
    CENTER_DIST[r * 8 + f] = dr + df;
  }
}

// ---------------------------------------------------------------------------
// Pawn Hash Table (16,384 entries) — caches pure pawn-structure mg/eg
// ---------------------------------------------------------------------------

const PAWN_TT_SIZE = 1 << 14;
const PAWN_TT_MASK = PAWN_TT_SIZE - 1;
const PAWN_TT_HI = new Int32Array(PAWN_TT_SIZE);
const PAWN_TT_MG = new Int32Array(PAWN_TT_SIZE);
const PAWN_TT_EG = new Int32Array(PAWN_TT_SIZE);
const PAWN_TT_VALID = new Uint8Array(PAWN_TT_SIZE);

// Preallocated scratch buffers (zero allocation on hot path)
const pawnFileCount = [new Int32Array(8), new Int32Array(8)];
const pawnMaxRank = [new Int32Array(8), new Int32Array(8)];
const pawnMinRank = [new Int32Array(8), new Int32Array(8)];
const pawnRankCount = [new Int32Array(8), new Int32Array(8)];
const pawnSqs = [new Int32Array(10), new Int32Array(10)];
const pieces = [new Int32Array(16), new Int32Array(16)]; // sq | (type << 8)

// Flag-gated profiling counters (scripts/profile-eval.ts). The branches are
// predictable-never while off, so the hot path is unaffected.
export const evalV3Stats = { on: false, calls: 0, pawnTtHits: 0, evalCacheHits: 0 };

// ---------------------------------------------------------------------------
// Eval cache (16,384 entries) — memoizes the full White-POV score per
// (board, castling, ep) state; the side to move is XORed out of the key since
// the score is stm-independent. Generation-invalidated when params change.
// ---------------------------------------------------------------------------

const EVAL_CACHE_SIZE = 1 << 14;
const EVAL_CACHE_MASK = EVAL_CACHE_SIZE - 1;
const EVAL_CACHE_KEY = new Int32Array(EVAL_CACHE_SIZE); // hashLo ^ keySalt
const EVAL_CACHE_HI = new Int32Array(EVAL_CACHE_SIZE); // hashHi ^ keySaltHi
const EVAL_CACHE_SCORE = new Int32Array(EVAL_CACHE_SIZE);
let evalCacheGen = -1;

/** Bumps the cache generation (call after any eval-param change). */
export function invalidateEvalCaches(): void {
  evalCacheGen++;
}

// King-zone adjacency masks: for each 64-square king square, a 64-bit (lo/hi)
// bitmask of squares within Chebyshev distance 1. Lets analyzePiece count
// king-zone hits with two shifts instead of two Math.abs per visited square.
const KING_ZONE_LO = new Int32Array(64);
const KING_ZONE_HI = new Int32Array(64);
for (let k = 0; k < 64; k++) {
  const kr = k >> 3;
  const kf = k & 7;
  let lo = 0;
  let hi = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let df = -1; df <= 1; df++) {
      const r = kr + dr;
      const f = kf + df;
      if (r < 0 || r > 7 || f < 0 || f > 7) continue;
      const s64 = (r << 3) | f;
      if (s64 < 32) lo |= 1 << s64;
      else hi |= 1 << (s64 - 32);
    }
  }
  KING_ZONE_LO[k] = lo;
  KING_ZONE_HI[k] = hi;
}

/** Chebyshev distance between two 0x88 squares. */
function kingDist(sq1: number, sq2: number): number {
  const dr = Math.abs((sq1 >> 4) - (sq2 >> 4));
  const df = Math.abs((sq1 & 7) - (sq2 & 7));
  return dr > df ? dr : df;
}

/** Manhattan distance between two 0x88 squares. */
function manhattanDist(sq1: number, sq2: number): number {
  return Math.abs((sq1 >> 4) - (sq2 >> 4)) + Math.abs((sq1 & 7) - (sq2 & 7));
}

/** Test bit in 64-square bitmask split into (lo, hi). */
function isBitSet(lo: number, hi: number, sq0x88: number): boolean {
  const s64 = ((sq0x88 >> 4) << 3) | (sq0x88 & 7);
  return s64 < 32 ? ((lo >>> s64) & 1) !== 0 : ((hi >>> (s64 - 32)) & 1) !== 0;
}

/**
 * Computes safe mobility and king-zone attack units for a piece at `sq`.
 * Returns packed `safeMob | (kingHits << 8) | (threatBonus << 16)`.
 * `kzLo`/`kzHi` are the enemy king's zone adjacency mask (64-bit lo/hi pair).
 */
function analyzePiece(
  board: Int8Array,
  sq: number,
  type: number,
  us: 0 | 1,
  enemyAtkLo: number,
  enemyAtkHi: number,
  kzLo: number,
  kzHi: number,
): number {
  let safeMob = 0;
  let kingHits = 0;
  let threatBonus = 0;

  if (type === KNIGHT) {
    for (let i = 0; i < 8; i++) {
      const to = sq + KNIGHT_OFFSETS[i];
      if (to & 0x88) continue;
      const t = board[to];
      const s64 = ((to >> 4) << 3) | (to & 7);
      if (s64 < 32 ? (kzLo >>> s64) & 1 : (kzHi >>> (s64 - 32)) & 1) kingHits++;
      if (t === 0) {
        const atk = s64 < 32 ? (enemyAtkLo >>> s64) & 1 : (enemyAtkHi >>> (s64 - 32)) & 1;
        if (atk === 0) safeMob++;
      } else if (us === WHITE ? t < 0 : t > 0) {
        const atk = s64 < 32 ? (enemyAtkLo >>> s64) & 1 : (enemyAtkHi >>> (s64 - 32)) & 1;
        if (atk === 0) safeMob++;
        const victim = t < 0 ? -t : t;
        if (victim === ROOK) threatBonus += 1;
        else if (victim === QUEEN) threatBonus += 2;
      }
    }
    return safeMob | (kingHits << 8) | (threatBonus << 16);
  }

  const dirs = type === BISHOP ? BISHOP_DIRS : type === ROOK ? ROOK_DIRS : QUEEN_DIRS;
  for (let i = 0; i < dirs.length; i++) {
    const d = dirs[i];
    let to = sq + d;
    while (!(to & 0x88)) {
      const t = board[to];
      const s64 = ((to >> 4) << 3) | (to & 7);
      if (s64 < 32 ? (kzLo >>> s64) & 1 : (kzHi >>> (s64 - 32)) & 1) kingHits++;
      if (t === 0) {
        const atk = s64 < 32 ? (enemyAtkLo >>> s64) & 1 : (enemyAtkHi >>> (s64 - 32)) & 1;
        if (atk === 0) safeMob++;
      } else {
        if (us === WHITE ? t < 0 : t > 0) {
          const atk = s64 < 32 ? (enemyAtkLo >>> s64) & 1 : (enemyAtkHi >>> (s64 - 32)) & 1;
          if (atk === 0) safeMob++;
          if (type === BISHOP) {
            const victim = t < 0 ? -t : t;
            if (victim === ROOK) threatBonus += 1;
            else if (victim === QUEEN) threatBonus += 2;
          }
        }
        break;
      }
      to += d;
    }
  }
  return safeMob | (kingHits << 8) | (threatBonus << 16);
}

// Optional eval override (NNUE): when set, evalV3WhitePov delegates to it.
// The override bypasses the v3 eval cache entirely, so switching it on/off
// cannot pollute cached v3 scores. Single-threaded sequential use only
// (set before a search, clear after) — see scripts/match.ts `v3nnue`.
let evalOverride: ((pos: Position) => number) | null = null;
export function setEvalOverride(fn: ((pos: Position) => number) | null): void {
  evalOverride = fn;
}

/** White-relative evaluation in centipawns (without tempo). */
export function evalV3WhitePov(pos: Position): number {
  if (evalOverride !== null) return evalOverride(pos);
  // Eval cache: keyed on the FULL position hash. The score is mostly
  // stm-independent, but the unstoppable-passer (rule-of-the-square) term
  // reads pos.stm, so the side to move MUST stay part of the key.
  if (evalV3Stats.on) evalV3Stats.calls++;
  const genSalt = (evalCacheGen * 0x61c88637) | 0;
  const keyLo = pos.hashLo;
  const keyHi = pos.hashHi;
  const eIdx = keyLo & EVAL_CACHE_MASK;
  if (EVAL_CACHE_KEY[eIdx] === (keyLo ^ genSalt) && EVAL_CACHE_HI[eIdx] === (keyHi ^ genSalt)) {
    if (evalV3Stats.on) evalV3Stats.evalCacheHits++;
    return EVAL_CACHE_SCORE[eIdx];
  }

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
  let whiteBishopSq = -1;
  let blackBishopSq = -1;

  let wAtkLo = 0;
  let wAtkHi = 0;
  let bAtkLo = 0;
  let bAtkHi = 0;

  for (let r = 0; r < 8; r++) {
    const rShift = r << 4;
    for (let f = 0; f < 8; f++) {
      const sq = rShift | f;
      const p = board[sq];
      if (p === 0) continue;
      if (p > 0) {
        if (p === PAWN) {
          pawnFileCount[WHITE][f]++;
          pawnRankCount[WHITE][r]++;
          if (r > pawnMaxRank[WHITE][f]) pawnMaxRank[WHITE][f] = r;
          if (r < pawnMinRank[WHITE][f]) pawnMinRank[WHITE][f] = r;
          pawnSqs[WHITE][pawnNWhite++] = sq;
          const a1 = sq + 15;
          if (!(a1 & 0x88)) {
            const s64 = ((a1 >> 4) << 3) | (a1 & 7);
            if (s64 < 32) wAtkLo |= 1 << s64;
            else wAtkHi |= 1 << (s64 - 32);
          }
          const a2 = sq + 17;
          if (!(a2 & 0x88)) {
            const s64 = ((a2 >> 4) << 3) | (a2 & 7);
            if (s64 < 32) wAtkLo |= 1 << s64;
            else wAtkHi |= 1 << (s64 - 32);
          }
        } else if (p !== KING) {
          pieces[WHITE][pieceNWhite++] = sq | (p << 8);
          if (p === BISHOP) {
            bishopsWhite++;
            whiteBishopSq = sq;
          }
        }
      } else {
        const type = -p;
        if (type === PAWN) {
          pawnFileCount[BLACK][f]++;
          pawnRankCount[BLACK][r]++;
          if (r > pawnMaxRank[BLACK][f]) pawnMaxRank[BLACK][f] = r;
          if (r < pawnMinRank[BLACK][f]) pawnMinRank[BLACK][f] = r;
          pawnSqs[BLACK][pawnNBlack++] = sq;
          const a1 = sq - 15;
          if (!(a1 & 0x88)) {
            const s64 = ((a1 >> 4) << 3) | (a1 & 7);
            if (s64 < 32) bAtkLo |= 1 << s64;
            else bAtkHi |= 1 << (s64 - 32);
          }
          const a2 = sq - 17;
          if (!(a2 & 0x88)) {
            const s64 = ((a2 >> 4) << 3) | (a2 & 7);
            if (s64 < 32) bAtkLo |= 1 << s64;
            else bAtkHi |= 1 << (s64 - 32);
          }
        } else if (type !== KING) {
          pieces[BLACK][pieceNBlack++] = sq | (type << 8);
          if (type === BISHOP) {
            bishopsBlack++;
            blackBishopSq = sq;
          }
        }
      }
    }
  }

  let mg = pos.mg;
  let eg = pos.eg;

  // Probe Pawn TT for pure pawn-structure static terms (doubled, isolated, backward, connected, phalanx, base passed)
  const pIdx = pos.pawnHashLo & PAWN_TT_MASK;
  if (PAWN_TT_VALID[pIdx] === 1 && PAWN_TT_HI[pIdx] === pos.pawnHashHi) {
    if (evalV3Stats.on) evalV3Stats.pawnTtHits++;
    mg += PAWN_TT_MG[pIdx];
    eg += PAWN_TT_EG[pIdx];
  } else {
    let pmg = 0;
    let peg = 0;

    for (let c = 0; c < 2; c++) {
      const color = c as 0 | 1;
      const sign = color === WHITE ? 1 : -1;
      const dir = color === WHITE ? 1 : -1;
      const counts = pawnFileCount[color];
      const ourAtkLo = color === WHITE ? wAtkLo : bAtkLo;
      const ourAtkHi = color === WHITE ? wAtkHi : bAtkHi;
      const enemyAtkLo = color === WHITE ? bAtkLo : wAtkLo;
      const enemyAtkHi = color === WHITE ? bAtkHi : wAtkHi;
      const ownPawns = pawnSqs[color];
      const nPawns = color === WHITE ? pawnNWhite : pawnNBlack;
      const ownPawnPiece = color === WHITE ? PAWN : -PAWN;

      let cmg = 0;
      let ceg = 0;

      // File-level: doubled & isolated
      for (let f = 0; f < 8; f++) {
        const n = counts[f];
        if (n === 0) continue;
        if (n > 1) {
          cmg += P.doubledMg * (n - 1);
          ceg += P.doubledEg * (n - 1);
        }
        const left = f > 0 ? counts[f - 1] : 0;
        const right = f < 7 ? counts[f + 1] : 0;
        if (left === 0 && right === 0) {
          cmg += P.isolatedMg * n;
          ceg += P.isolatedEg * n;
        }
      }

      // Per-pawn static structure
      for (let i = 0; i < nPawns; i++) {
        const sq = ownPawns[i];
        const r = sq >> 4;
        const f = sq & 7;
        const relRank = color === WHITE ? r : 7 - r;

        const isDefended = isBitSet(ourAtkLo, ourAtkHi, sq);
        const hasPhalanx =
          (f > 0 && board[sq - 1] === ownPawnPiece) ||
          (f < 7 && board[sq + 1] === ownPawnPiece);

        if (isDefended) {
          cmg += CONNECTED_MG[relRank];
          ceg += CONNECTED_EG[relRank];
        }
        if (hasPhalanx) {
          cmg += PHALANX_MG[relRank];
          ceg += PHALANX_EG[relRank];
        }

        if (!isDefended && !hasPhalanx) {
          const left = f > 0 ? counts[f - 1] : 0;
          const right = f < 7 ? counts[f + 1] : 0;
          if (left > 0 || right > 0) {
            let behindSupport = false;
            if (color === WHITE) {
              if (f > 0 && pawnMinRank[WHITE][f - 1] <= r) behindSupport = true;
              if (f < 7 && pawnMinRank[WHITE][f + 1] <= r) behindSupport = true;
            } else {
              if (f > 0 && pawnMaxRank[BLACK][f - 1] >= r) behindSupport = true;
              if (f < 7 && pawnMaxRank[BLACK][f + 1] >= r) behindSupport = true;
            }
            const stopSq = sq + (dir << 4);
            if (!behindSupport && !(stopSq & 0x88) && isBitSet(enemyAtkLo, enemyAtkHi, stopSq)) {
              cmg += P.backwardMg;
              ceg += P.backwardEg;
            }
          }
        }
      }

      pmg += sign * cmg;
      peg += sign * ceg;
    }

    PAWN_TT_VALID[pIdx] = 1;
    PAWN_TT_HI[pIdx] = pos.pawnHashHi;
    PAWN_TT_MG[pIdx] = pmg;
    PAWN_TT_EG[pIdx] = peg;
    mg += pmg;
    eg += peg;
  }

  // Dynamic terms: Passed pawns (with king/piece interaction), Pieces, Mobility, King Safety, Threats
  for (let c = 0; c < 2; c++) {
    const color = c as 0 | 1;
    const them = (color ^ 1) as 0 | 1;
    const sign = color === WHITE ? 1 : -1;
    const dir = color === WHITE ? 1 : -1;
    const counts = pawnFileCount[color];
    const enemyCounts = pawnFileCount[them];
    const ourAtkLo = color === WHITE ? wAtkLo : bAtkLo;
    const ourAtkHi = color === WHITE ? wAtkHi : bAtkHi;
    const enemyAtkLo = color === WHITE ? bAtkLo : wAtkLo;
    const enemyAtkHi = color === WHITE ? bAtkHi : wAtkHi;
    const ourKingSq = pos.kingSq[color];
    const enemyKingSq = pos.kingSq[them];
    const ek64 = ((enemyKingSq >> 4) << 3) | (enemyKingSq & 7);
    const kzLo = KING_ZONE_LO[ek64];
    const kzHi = KING_ZONE_HI[ek64];

    let tmg = 0;
    let teg = 0;

    // 1. Bishop pair
    const nBishops = color === WHITE ? bishopsWhite : bishopsBlack;
    if (nBishops >= 2) {
      tmg += P.bishopPairMg;
      teg += P.bishopPairEg;
    }

    // 2. Passed pawns (dynamic interactions with board occupancy, rooks, and kings)
    const ownPawns = pawnSqs[color];
    const nPawns = color === WHITE ? pawnNWhite : pawnNBlack;
    const ownPawnPiece = color === WHITE ? PAWN : -PAWN;

    for (let i = 0; i < nPawns; i++) {
      const sq = ownPawns[i];
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

        const isDefended = isBitSet(ourAtkLo, ourAtkHi, sq);
        const hasPhalanx =
          (f > 0 && board[sq - 1] === ownPawnPiece) ||
          (f < 7 && board[sq + 1] === ownPawnPiece);
        if (isDefended || hasPhalanx) {
          tmg += P.passedProtMg;
          teg += P.passedProtEg;
        }

        const frontSq = sq + (dir << 4);
        if (!(frontSq & 0x88)) {
          if (board[frontSq] === 0 && !isBitSet(enemyAtkLo, enemyAtkHi, frontSq)) {
            tmg += PASSED_FREE_MG[relRank];
            teg += PASSED_FREE_EG[relRank];
          }
          if (relRank >= 3) {
            const wFactor = relRank - 2;
            const ourDist = kingDist(ourKingSq, frontSq);
            const enemyDist = kingDist(enemyKingSq, frontSq);
            teg += (enemyDist * P.passerKingEnemyW - ourDist * P.passerKingOurW) * wFactor;
          }
        }

        if (pos.npmCount[them] === 0 && !(frontSq & 0x88) && board[frontSq] === 0) {
          const promoSq = ((color === WHITE ? 7 : 0) << 4) | f;
          const distToPromo = 7 - relRank;
          const enemyKingToPromo = kingDist(enemyKingSq, promoSq) - (pos.stm === them ? 1 : 0);
          if (distToPromo < enemyKingToPromo) {
            if ((ourKingSq & 7) !== f || (color === WHITE ? (ourKingSq >> 4) < r : (ourKingSq >> 4) > r)) {
              teg += P.unstoppableBase + relRank * P.unstoppablePerRank;
            }
          }
        }

        if (pos.rqCount[color] > 0) {
          let scanSq = sq - (dir << 4);
          const ownRook = color === WHITE ? ROOK : -ROOK;
          while (!(scanSq & 0x88)) {
            const bPiece = board[scanSq];
            if (bPiece !== 0) {
              if (bPiece === ownRook) {
                tmg += P.rookBehindPasserMg;
                teg += P.rookBehindPasserEg;
              }
              break;
            }
            scanSq -= dir << 4;
          }
        }
      }
    }

    // 3. Pieces: Rooks, Outposts, Mobility, King Danger, Tactical Threats
    const list = pieces[color];
    const nPieces = color === WHITE ? pieceNWhite : pieceNBlack;
    let kingAttackersCount = 0;
    let kingAttackWeight = 0;
    let hasQueen = false;

    for (let i = 0; i < nPieces; i++) {
      const packed = list[i];
      const sq = packed & 0xff;
      const type = packed >> 8;
      const f = sq & 7;
      const r = sq >> 4;
      const relRank = color === WHITE ? r : 7 - r;

      if (isBitSet(enemyAtkLo, enemyAtkHi, sq)) {
        if (type === KNIGHT || type === BISHOP) {
          tmg -= P.pawnThreatMinorMg;
          teg -= P.pawnThreatMinorEg;
        } else if (type === ROOK || type === QUEEN) {
          tmg -= P.pawnThreatMajorMg;
          teg -= P.pawnThreatMajorEg;
        }
      }

      if ((type === KNIGHT || type === BISHOP) && relRank >= 3 && relRank <= 5) {
        if (isBitSet(ourAtkLo, ourAtkHi, sq) && !isBitSet(enemyAtkLo, enemyAtkHi, sq)) {
          let canBeDrivenAway = false;
          if (color === WHITE) {
            if (f > 0 && pawnMaxRank[BLACK][f - 1] > r) canBeDrivenAway = true;
            if (f < 7 && pawnMaxRank[BLACK][f + 1] > r) canBeDrivenAway = true;
          } else {
            if (f > 0 && pawnMinRank[WHITE][f - 1] < r) canBeDrivenAway = true;
            if (f < 7 && pawnMinRank[WHITE][f + 1] < r) canBeDrivenAway = true;
          }
          if (!canBeDrivenAway) {
            const centerBonus = f >= 2 && f <= 5 ? 1 : 0;
            if (type === KNIGHT) {
              tmg += P.knightOutpostMg + centerBonus * P.knightOutpostCenterMg;
              teg += P.knightOutpostEg + centerBonus * P.knightOutpostCenterEg;
            } else {
              tmg += P.bishopOutpostMg + centerBonus * P.bishopOutpostCenterMg;
              teg += P.bishopOutpostEg + centerBonus * P.bishopOutpostCenterEg;
            }
          }
        }
      }

      if (type === ROOK) {
        if (counts[f] === 0) {
          if (enemyCounts[f] === 0) {
            tmg += P.rookOpenMg;
            teg += P.rookOpenEg;
          } else {
            tmg += P.rookSemiMg;
            teg += P.rookSemiEg;
          }
        }
        const seventh = color === WHITE ? r === 6 : r === 1;
        const enemyKingRank = enemyKingSq >> 4;
        const enemyPawnRank = color === WHITE ? 6 : 1;
        if (seventh && (enemyKingRank === (color === WHITE ? 7 : 0) || pawnRankCount[them][enemyPawnRank] > 0)) {
          tmg += P.rook7thMg;
          teg += P.rook7thEg;
        }
        for (let j = i + 1; j < nPieces; j++) {
          const p2 = list[j];
          if ((p2 >> 8) === ROOK) {
            const sq2 = p2 & 0xff;
            if ((sq2 & 7) === f || (seventh && (sq2 >> 4) === r)) {
              tmg += P.rookBatteryMg;
              teg += P.rookBatteryEg;
            }
          }
        }
      }

      if (type === QUEEN) hasQueen = true;

      const analysis = analyzePiece(board, sq, type, color, enemyAtkLo, enemyAtkHi, kzLo, kzHi);
      const mob = analysis & 0xff;
      const kingHits = (analysis >> 8) & 0xff;
      const threats = analysis >> 16;

      if (threats > 0) {
        if (threats & 1) {
          tmg += P.minorThreatRookMg;
          teg += P.minorThreatRookEg;
        }
        if (threats >= 2) {
          tmg += P.minorThreatQueenMg;
          teg += P.minorThreatQueenEg;
        }
      }

      if (type === KNIGHT) {
        tmg += P.mobNMg * (mob - P.baseN);
        teg += P.mobNEg * (mob - P.baseN);
        if (kingHits > 0) {
          kingAttackersCount++;
          kingAttackWeight += P.kingAttackNBase + kingHits * P.kingAttackNPer;
        }
      } else if (type === BISHOP) {
        tmg += P.mobBMg * (mob - P.baseB);
        teg += P.mobBEg * (mob - P.baseB);
        if (kingHits > 0) {
          kingAttackersCount++;
          kingAttackWeight += P.kingAttackBBase + kingHits * P.kingAttackBPer;
        }
      } else if (type === ROOK) {
        tmg += P.mobRMg * (mob - P.baseR);
        teg += P.mobREg * (mob - P.baseR);
        if (kingHits > 0) {
          kingAttackersCount++;
          kingAttackWeight += P.kingAttackRBase + kingHits * P.kingAttackRPer;
        }
      } else if (type === QUEEN) {
        tmg += P.mobQMg * (mob - P.baseQ);
        teg += P.mobQEg * (mob - P.baseQ);
        if (kingHits > 0) {
          kingAttackersCount++;
          kingAttackWeight += P.kingAttackQBase + kingHits * P.kingAttackQPer;
        }
      }
    }

    if (kingAttackersCount >= 2 && (hasQueen || kingAttackersCount >= 3)) {
      const danger = (kingAttackWeight * kingAttackersCount) >> 2;
      tmg += danger > P.kingDangerCap ? P.kingDangerCap : danger;
    }

    // 4. Own King Pawn Shield (midgame)
    const kr = ourKingSq >> 4;
    const kf = ourKingSq & 7;
    if (color === WHITE ? kr <= 2 : kr >= 5) {
      const fLo = kf > 0 ? kf - 1 : 0;
      const fHi = kf < 7 ? kf + 1 : 7;
      for (let f = fLo; f <= fHi; f++) {
        const near = ((kr + dir) << 4) | f;
        const far = ((kr + 2 * dir) << 4) | f;
        if (!(near & 0x88) && board[near] === ownPawnPiece) {
          tmg += P.shieldNear;
        } else if (!(far & 0x88) && board[far] === ownPawnPiece) {
          tmg += P.shieldFar;
        } else if (counts[f] === 0) {
          tmg += P.shieldOpenFile;
          if (enemyCounts[f] === 0) tmg += P.shieldOpenExtra;
        }
      }
    }

    mg += sign * tmg;
    eg += sign * teg;
  }

  const phase = pos.phase > TOTAL_PHASE ? TOTAL_PHASE : pos.phase;
  let score = ((mg * phase + eg * (TOTAL_PHASE - phase)) / TOTAL_PHASE) | 0;

  // 5. Endgame Scaling & Mop-Up
  if (
    pos.npmCount[WHITE] === 1 &&
    pos.npmCount[BLACK] === 1 &&
    bishopsWhite === 1 &&
    bishopsBlack === 1
  ) {
    const wLight = (((whiteBishopSq >> 4) + whiteBishopSq) & 1) === 1;
    const bLight = (((blackBishopSq >> 4) + blackBishopSq) & 1) === 1;
    if (wLight !== bLight) {
      score = (score * P.ocbScale) >> 2;
    }
  }

  if (phase <= P.mopupMaxPhase) {
    if (score >= P.mopupMargin && pos.npmCount[BLACK] === 0) {
      const bkSq = pos.kingSq[BLACK];
      const wkSq = pos.kingSq[WHITE];
      const bk64 = ((bkSq >> 4) << 3) | (bkSq & 7);
      const edgeBonus = CENTER_DIST[bk64] * P.mopupEdge;
      const closeBonus = (14 - manhattanDist(wkSq, bkSq)) * P.mopupClose;
      score += edgeBonus + closeBonus;
    } else if (score <= -P.mopupMargin && pos.npmCount[WHITE] === 0) {
      const wkSq = pos.kingSq[WHITE];
      const bkSq = pos.kingSq[BLACK];
      const wk64 = ((wkSq >> 4) << 3) | (wkSq & 7);
      const edgeBonus = CENTER_DIST[wk64] * P.mopupEdge;
      const closeBonus = (14 - manhattanDist(bkSq, wkSq)) * P.mopupClose;
      score -= edgeBonus + closeBonus;
    }
  }

  EVAL_CACHE_KEY[eIdx] = keyLo ^ genSalt;
  EVAL_CACHE_HI[eIdx] = keyHi ^ genSalt;
  EVAL_CACHE_SCORE[eIdx] = score;
  return score;
}

/** Clears the eval cache and pawn TT — required after any eval-param change. */
export function clearEvalCaches(): void {
  evalCacheGen++;
  PAWN_TT_VALID.fill(0);
}

/** Side-to-move-relative score in centipawns, tempo included. */
export function evalV3(pos: Position): number {
  const white = evalV3WhitePov(pos);
  return pos.stm === WHITE ? white + TEMPO_V3 : -white + TEMPO_V3;
}
