/**
 * Attack detection and move generation for the 0x88 board.
 *
 * genMoves/genCaptures produce pseudo-legal moves (into caller-owned typed
 * arrays); legality is enforced by make + "own king attacked?" + unmake,
 * which the search, perft and UI all share. genMoves does reject castling
 * through/out of check at generation time, since that is not observable
 * by the post-move king test alone.
 */

import {
  BISHOP,
  BLACK,
  Color,
  FLAG_CASTLE,
  FLAG_DOUBLE,
  FLAG_EP,
  KING,
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
  encodeMove,
} from './types';
import { makeMove, unmakeMove } from './position';
import type { Position } from './position';

const KNIGHT_OFFSETS = [33, 31, 18, 14, -33, -31, -18, -14];
const BISHOP_DIRS = [15, 17, -15, -17];
const ROOK_DIRS = [16, 1, -16, -1];
const KING_DIRS = [15, 17, 16, 1, -15, -17, -16, -1];
const QUEEN_DIRS = [15, 17, 16, 1, -15, -17, -16, -1];

/** Is `sq` attacked by any piece of color `by`? */
export function isSquareAttacked(pos: Position, sq: number, by: Color): boolean {
  const b = pos.board;
  let s: number;
  let p: number;

  if (by === WHITE) {
    s = sq - 15;
    if (!(s & 0x88) && b[s] === PAWN) return true;
    s = sq - 17;
    if (!(s & 0x88) && b[s] === PAWN) return true;
    for (let i = 0; i < 8; i++) {
      s = sq + KNIGHT_OFFSETS[i];
      if (!(s & 0x88) && b[s] === KNIGHT) return true;
    }
    for (let i = 0; i < 8; i++) {
      s = sq + KING_DIRS[i];
      if (!(s & 0x88) && b[s] === KING) return true;
    }
    for (let i = 0; i < 4; i++) {
      const d = ROOK_DIRS[i];
      s = sq + d;
      while (!(s & 0x88)) {
        p = b[s];
        if (p !== 0) {
          if (p === ROOK || p === QUEEN) return true;
          break;
        }
        s += d;
      }
    }
    for (let i = 0; i < 4; i++) {
      const d = BISHOP_DIRS[i];
      s = sq + d;
      while (!(s & 0x88)) {
        p = b[s];
        if (p !== 0) {
          if (p === BISHOP || p === QUEEN) return true;
          break;
        }
        s += d;
      }
    }
  } else {
    s = sq + 15;
    if (!(s & 0x88) && b[s] === -PAWN) return true;
    s = sq + 17;
    if (!(s & 0x88) && b[s] === -PAWN) return true;
    for (let i = 0; i < 8; i++) {
      s = sq + KNIGHT_OFFSETS[i];
      if (!(s & 0x88) && b[s] === -KNIGHT) return true;
    }
    for (let i = 0; i < 8; i++) {
      s = sq + KING_DIRS[i];
      if (!(s & 0x88) && b[s] === -KING) return true;
    }
    for (let i = 0; i < 4; i++) {
      const d = ROOK_DIRS[i];
      s = sq + d;
      while (!(s & 0x88)) {
        p = b[s];
        if (p !== 0) {
          if (p === -ROOK || p === -QUEEN) return true;
          break;
        }
        s += d;
      }
    }
    for (let i = 0; i < 4; i++) {
      const d = BISHOP_DIRS[i];
      s = sq + d;
      while (!(s & 0x88)) {
        p = b[s];
        if (p !== 0) {
          if (p === -BISHOP || p === -QUEEN) return true;
          break;
        }
        s += d;
      }
    }
  }
  return false;
}

/** Is the side to move in check? */
export function inCheck(pos: Position): boolean {
  return isSquareAttacked(pos, pos.kingSq[pos.stm], (pos.stm ^ 1) as Color);
}

export function inCheckOf(pos: Position, color: Color): boolean {
  return isSquareAttacked(pos, pos.kingSq[color], (color ^ 1) as Color);
}

// ---------------------------------------------------------------------------
// Cheap legality test
// ---------------------------------------------------------------------------

/**
 * DELTA_DIR[diff + 119]: queen-direction from square a to aligned square b
 * (0 when not aligned). Filled for all multiples d*i, i = 1..7 of the eight
 * ray directions; knight/king deltas are never such multiples, so no collision.
 */
const DELTA_DIR = new Int8Array(240);
{
  const dirs = [16, 1, -16, -1, 15, 17, -15, -17];
  for (const d of dirs) {
    for (let i = 1; i <= 7; i++) DELTA_DIR[d * i + 119] = d;
  }
}

/**
 * Is `move` legal given the post-make position and whether the mover was in
 * check before the move?
 *
 * A quiet non-king move (and every non-ep capture: the capturing piece still
 * occupies the victim's square, so it cannot uncover a line through `to`) can
 * only expose its own king along the king-origin line. Everything else — king
 * moves, ep captures, moves made while in check — falls back to the full
 * attack scan.
 */
export function moveIsLegal(pos: Position, move: number, wasInCheck: boolean): boolean {
  const us = (pos.stm ^ 1) as Color; // the side that just moved (pos.stm is already the opponent)
  const k = pos.kingSq[us];
  const from = move & 127;
  const to = (move >>> 7) & 127;
  // After make, the moved piece stands on `to` (post-promotion it is no
  // longer a pawn, but promotion moves are never king moves).
  const moved = pos.board[to];
  const movedType = moved < 0 ? -moved : moved;

  if (movedType === KING || wasInCheck || (move & FLAG_EP) !== 0) {
    return !isSquareAttacked(pos, k, (us ^ 1) as Color);
  }

  const dir = DELTA_DIR[from - k + 119];
  if (dir === 0) return true; // origin not aligned with the king: no exposure possible

  // Is there any piece between king and origin? Then the line stays blocked.
  let s = k + dir;
  while (s !== from) {
    if (pos.board[s] !== 0) return true;
    s += dir;
  }

  // First piece beyond the origin decides: enemy slider of the matching kind
  // = discovered check. (The mover itself may be on this ray at its `to`
  // square — the board already reflects that and blocks the ray correctly.)
  const straight = dir === 16 || dir === -16 || dir === 1 || dir === -1;
  s = from + dir;
  while (!(s & 0x88)) {
    const p = pos.board[s];
    if (p !== 0) {
      const enemy = us === WHITE ? p < 0 : p > 0;
      if (enemy) {
        const t = p < 0 ? -p : p;
        if (t === QUEEN || (straight ? t === ROOK : t === BISHOP)) return false;
      }
      return true;
    }
    s += dir;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Move generation
// ---------------------------------------------------------------------------

function genPawnMoves(pos: Position, sq: number, out: Int32Array, n: number, capturesOnly: boolean): number {
  const b = pos.board;
  const us = pos.stm;
  const white = us === WHITE;

  const push = white ? sq + 16 : sq - 16;
  if (!(push & 0x88) && b[push] === 0) {
    const promoRank = white ? push >= 0x70 : push <= 7;
    if (promoRank) {
      out[n++] = encodeMove(sq, push, QUEEN, 0, 0);
      out[n++] = encodeMove(sq, push, ROOK, 0, 0);
      out[n++] = encodeMove(sq, push, BISHOP, 0, 0);
      out[n++] = encodeMove(sq, push, KNIGHT, 0, 0);
    } else if (!capturesOnly) {
      out[n++] = encodeMove(sq, push, 0, 0, 0);
      const startRank = white ? sq >= 0x10 && sq <= 0x17 : sq >= 0x60 && sq <= 0x67;
      if (startRank && b[white ? sq + 32 : sq - 32] === 0) {
        out[n++] = encodeMove(sq, white ? sq + 32 : sq - 32, 0, 0, FLAG_DOUBLE);
      }
    }
  }

  const c1 = white ? sq + 15 : sq - 15;
  const c2 = white ? sq + 17 : sq - 17;
  for (let k = 0; k < 2; k++) {
    const to = k === 0 ? c1 : c2;
    if (to & 0x88) continue;
    const tp = b[to];
    if (tp !== 0 && (white ? tp < 0 : tp > 0)) {
      const captured = tp < 0 ? -tp : tp;
      if (white ? to >= 0x70 : to <= 7) {
        out[n++] = encodeMove(sq, to, QUEEN, captured, 0);
        out[n++] = encodeMove(sq, to, ROOK, captured, 0);
        out[n++] = encodeMove(sq, to, BISHOP, captured, 0);
        out[n++] = encodeMove(sq, to, KNIGHT, captured, 0);
      } else {
        out[n++] = encodeMove(sq, to, 0, captured, 0);
      }
    } else if (tp === 0 && to === pos.ep) {
      out[n++] = encodeMove(sq, to, 0, PAWN, FLAG_EP);
    }
  }
  return n;
}

function genPieceMoves(pos: Position, sq: number, out: Int32Array, n: number, dirs: number[], sliding: boolean, capturesOnly: boolean): number {
  const b = pos.board;
  const us = pos.stm;
  const white = us === WHITE;
  for (let i = 0; i < dirs.length; i++) {
    const d = dirs[i];
    let to = sq + d;
    while (!(to & 0x88)) {
      const tp = b[to];
      if (tp === 0) {
        if (!capturesOnly) out[n++] = encodeMove(sq, to, 0, 0, 0);
        if (!sliding) break;
        to += d;
        continue;
      }
      if (white ? tp < 0 : tp > 0) {
        out[n++] = encodeMove(sq, to, 0, tp < 0 ? -tp : tp, 0);
      }
      break;
    }
  }
  return n;
}

function genCastles(pos: Position, out: Int32Array, n: number): number {
  const b = pos.board;
  if (pos.stm === WHITE) {
    if (
      pos.castling & 1 &&
      b[0x05] === 0 && b[0x06] === 0 &&
      !isSquareAttacked(pos, 0x04, BLACK) &&
      !isSquareAttacked(pos, 0x05, BLACK) &&
      !isSquareAttacked(pos, 0x06, BLACK)
    ) {
      out[n++] = encodeMove(0x04, 0x06, 0, 0, FLAG_CASTLE);
    }
    if (
      pos.castling & 2 &&
      b[0x03] === 0 && b[0x02] === 0 && b[0x01] === 0 &&
      !isSquareAttacked(pos, 0x04, BLACK) &&
      !isSquareAttacked(pos, 0x03, BLACK) &&
      !isSquareAttacked(pos, 0x02, BLACK)
    ) {
      out[n++] = encodeMove(0x04, 0x02, 0, 0, FLAG_CASTLE);
    }
  } else {
    if (
      pos.castling & 4 &&
      b[0x75] === 0 && b[0x76] === 0 &&
      !isSquareAttacked(pos, 0x74, WHITE) &&
      !isSquareAttacked(pos, 0x75, WHITE) &&
      !isSquareAttacked(pos, 0x76, WHITE)
    ) {
      out[n++] = encodeMove(0x74, 0x76, 0, 0, FLAG_CASTLE);
    }
    if (
      pos.castling & 8 &&
      b[0x73] === 0 && b[0x72] === 0 && b[0x71] === 0 &&
      !isSquareAttacked(pos, 0x74, WHITE) &&
      !isSquareAttacked(pos, 0x73, WHITE) &&
      !isSquareAttacked(pos, 0x72, WHITE)
    ) {
      out[n++] = encodeMove(0x74, 0x72, 0, 0, FLAG_CASTLE);
    }
  }
  return n;
}

/** Pseudo-legal moves for all pieces. Returns the count written into `out`. */
export function genMoves(pos: Position, out: Int32Array): number {
  let n = 0;
  const b = pos.board;
  const us = pos.stm;
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const sq = (rank << 4) | file;
      const piece = b[sq];
      if (piece === 0 || (us === WHITE ? piece < 0 : piece > 0)) continue;
      const type = piece < 0 ? -piece : piece;
      switch (type) {
        case PAWN:
          n = genPawnMoves(pos, sq, out, n, false);
          break;
        case KNIGHT:
          n = genPieceMoves(pos, sq, out, n, KNIGHT_OFFSETS, false, false);
          break;
        case BISHOP:
          n = genPieceMoves(pos, sq, out, n, BISHOP_DIRS, true, false);
          break;
        case ROOK:
          n = genPieceMoves(pos, sq, out, n, ROOK_DIRS, true, false);
          break;
        case QUEEN:
          n = genPieceMoves(pos, sq, out, n, QUEEN_DIRS, true, false);
          break;
        case KING:
          n = genPieceMoves(pos, sq, out, n, KING_DIRS, false, false);
          n = genCastles(pos, out, n);
          break;
      }
    }
  }
  return n;
}

/** Captures, en passant, and promotions (all four) — for quiescence search. */
export function genCaptures(pos: Position, out: Int32Array): number {
  let n = 0;
  const b = pos.board;
  const us = pos.stm;
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const sq = (rank << 4) | file;
      const piece = b[sq];
      if (piece === 0 || (us === WHITE ? piece < 0 : piece > 0)) continue;
      const type = piece < 0 ? -piece : piece;
      switch (type) {
        case PAWN:
          n = genPawnMoves(pos, sq, out, n, true);
          break;
        case KNIGHT:
          n = genPieceMoves(pos, sq, out, n, KNIGHT_OFFSETS, false, true);
          break;
        case BISHOP:
          n = genPieceMoves(pos, sq, out, n, BISHOP_DIRS, true, true);
          break;
        case ROOK:
          n = genPieceMoves(pos, sq, out, n, ROOK_DIRS, true, true);
          break;
        case QUEEN:
          n = genPieceMoves(pos, sq, out, n, QUEEN_DIRS, true, true);
          break;
        case KING:
          n = genPieceMoves(pos, sq, out, n, KING_DIRS, false, true);
          break;
      }
    }
  }
  return n;
}

/**
 * Filter pseudo-legal moves down to strictly legal ones (make + king-attack
 * test + unmake). Used by perft bulk counting, the UI and SAN.
 */
export function filterLegal(pos: Position, moves: Int32Array, count: number, out: Int32Array): number {
  let n = 0;
  const wasInCheck = inCheckOf(pos, pos.stm);
  for (let i = 0; i < count; i++) {
    const m = moves[i];
    makeMove(pos, m);
    if (moveIsLegal(pos, m, wasInCheck)) out[n++] = m;
    unmakeMove(pos, m);
  }
  return n;
}

/** List of strictly legal moves (fresh Int32Array — not for the hot path). */
export function legalMoves(pos: Position): Int32Array {
  const pseudo = new Int32Array(256);
  const count = genMoves(pos, pseudo);
  const out = new Int32Array(count);
  const n = filterLegal(pos, pseudo, count, out);
  return out.subarray(0, n);
}
