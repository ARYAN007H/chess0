/**
 * Standard Algebraic Notation. Moves are described from the position *before*
 * they are made; the position is temporarily advanced to add +/# suffixes.
 */

import {
  KING,
  KNIGHT,
  MAX_MOVES,
  PAWN,
  PIECE_LETTERS,
  QUEEN,
  isCastleMove,
  moveCaptured,
  moveFrom,
  movePromo,
  moveTo,
  squareName,
  moveToUci,
  encodeMove,
} from './types';
import { makeMove, unmakeMove } from './position';
import type { Position } from './position';
import { genMoves, filterLegal, inCheckOf } from './movegen';

const pseudoBuf = new Int32Array(MAX_MOVES);
const legalBuf = new Int32Array(MAX_MOVES);

function countLegalMoves(pos: Position): number {
  const count = genMoves(pos, pseudoBuf);
  return filterLegal(pos, pseudoBuf, count, legalBuf);
}

export function moveToSan(pos: Position, move: number): string {
  const from = moveFrom(move);
  const to = moveTo(move);
  const promo = movePromo(move);
  const captured = moveCaptured(move);

  let san: string;
  if (isCastleMove(move)) {
    san = to > from ? 'O-O' : 'O-O-O';
  } else {
    const piece = pos.board[from];
    const type = piece < 0 ? -piece : piece;
    if (type === PAWN) {
      san = captured !== 0 ? squareName(from)[0] + 'x' + squareName(to) : squareName(to);
      if (promo !== 0) san += '=' + PIECE_LETTERS[promo];
    } else {
      // Disambiguate against other legal moves of the same piece type to `to`.
      let ambiguous = false;
      let sameFile = false;
      let sameRank = false;
      const count = genMoves(pos, pseudoBuf);
      const n = filterLegal(pos, pseudoBuf, count, legalBuf);
      for (let i = 0; i < n; i++) {
        const m = legalBuf[i];
        if (m === move) continue;
        if (moveTo(m) !== to) continue;
        const p2 = pos.board[moveFrom(m)];
        if ((p2 < 0 ? -p2 : p2) !== type) continue;
        ambiguous = true;
        if ((moveFrom(m) & 7) === (from & 7)) sameFile = true;
        if (moveFrom(m) >> 4 === from >> 4) sameRank = true;
      }
      let disamb = '';
      if (ambiguous) {
        if (!sameFile) disamb = squareName(from)[0];
        else if (!sameRank) disamb = squareName(from)[1];
        else disamb = squareName(from);
      }
      san = PIECE_LETTERS[type] + disamb + (captured !== 0 ? 'x' : '') + squareName(to);
    }
  }

  makeMove(pos, move);
  if (inCheckOf(pos, pos.stm)) {
    san += countLegalMoves(pos) > 0 ? '+' : '#';
  }
  unmakeMove(pos, move);
  return san;
}

/** SAN for a sequence of moves played from `pos` (position is restored). */
export function moveListToSan(pos: Position, moves: number[]): string[] {
  const out: string[] = [];
  for (const m of moves) {
    out.push(moveToSan(pos, m));
    makeMove(pos, m);
  }
  for (let i = moves.length - 1; i >= 0; i--) unmakeMove(pos, moves[i]);
  return out;
}

export { moveToUci, encodeMove };
