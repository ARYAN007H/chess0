/**
 * Core types and constants for the Chess0 engine.
 *
 * Board representation: 0x88 mailbox. A square index is `rank * 16 + file`,
 * on-board iff `(sq & 0x88) === 0`. This makes off-board tests a single AND.
 *
 * Pieces are signed Int8 values: positive = white, negative = black.
 * Moves are packed into 32-bit integers so move lists are typed arrays
 * and the whole engine allocates nothing on the hot path.
 */

export const WHITE = 0;
export const BLACK = 1;
export type Color = 0 | 1;

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

/** Piece index 0..11 for table lookups: white P,N,B,R,Q,K then black P,N,B,R,Q,K. */
export function pieceIndex(piece: number): number {
  return piece > 0 ? piece - 1 : 5 - piece;
}

export const PIECE_CHARS = '.PNBRQKpnbrqk';
/** SAN letter by piece type (index = type), empty for pawns. */
export const PIECE_LETTERS = ['', '', 'N', 'B', 'R', 'Q', 'K'];
export function pieceToChar(piece: number): string {
  return PIECE_CHARS[piece < 0 ? 6 - piece : piece];
}
export function charToPiece(c: string): number {
  const i = PIECE_CHARS.indexOf(c);
  if (i <= 0) return 0; // '.' or unknown character
  return i > 6 ? 6 - i : i;
}

// ---------------------------------------------------------------------------
// Move encoding: bits 0-6 from, 7-13 to, 14-16 promotion, 17-19 captured type,
// 20-22 flags.
// ---------------------------------------------------------------------------

export const FLAG_EP = 1 << 20;
export const FLAG_CASTLE = 1 << 21;
export const FLAG_DOUBLE = 1 << 22;

export function encodeMove(
  from: number,
  to: number,
  promo: number,
  captured: number,
  flags: number,
): number {
  return from | (to << 7) | (promo << 14) | (captured << 17) | flags;
}

export const moveFrom = (m: number): number => m & 127;
export const moveTo = (m: number): number => (m >>> 7) & 127;
export const movePromo = (m: number): number => (m >>> 14) & 7;
export const moveCaptured = (m: number): number => (m >>> 17) & 7;
export const isEpMove = (m: number): boolean => (m & FLAG_EP) !== 0;
export const isCastleMove = (m: number): boolean => (m & FLAG_CASTLE) !== 0;
export const isDoublePush = (m: number): boolean => (m & FLAG_DOUBLE) !== 0;

const PROMO_CHARS = ['', '', 'n', 'b', 'r', 'q'];

/** Long algebraic (UCI) coordinate, e.g. e2e4, e7e8q. */
export function moveToUci(m: number): string {
  return (
    squareName(moveFrom(m)) +
    squareName(moveTo(m)) +
    (movePromo(m) ? PROMO_CHARS[movePromo(m)] : '')
  );
}

// ---------------------------------------------------------------------------
// Squares
// ---------------------------------------------------------------------------

const FILES = 'abcdefgh';

export const onBoard = (sq: number): boolean => (sq & 0x88) === 0;
export const rankOf = (sq: number): number => sq >> 4;
export const fileOf = (sq: number): number => sq & 7;
/** 0x88 square -> 0..64 index with a1 = 0, h8 = 63. */
export const sqTo64 = (sq: number): number => ((sq >> 4) << 3) | (sq & 7);

export function squareName(sq: number): string {
  return FILES[sq & 7] + (1 + (sq >> 4));
}

export function parseSquare(name: string): number {
  const file = FILES.indexOf(name[0]);
  const rank = name.charCodeAt(1) - 49; // '1' -> 0
  if (file < 0 || rank < 0 || rank > 7 || name.length !== 2) return -1;
  return (rank << 4) | file;
}

export const A1 = 0x00;
export const E1 = 0x04;
export const H1 = 0x07;
export const A8 = 0x70;
export const E8 = 0x74;
export const H8 = 0x77;

// Castling right bits.
export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

/**
 * CASTLE_MASK[sq]: AND-ing the current rights with this mask after any move
 * touching `sq` (as origin or destination) keeps rights correct — king and
 * rook home squares clear the right to castle on that wing.
 */
export const CASTLE_MASK = new Int8Array(128).fill(15);
CASTLE_MASK[A1] = 15 & ~CASTLE_WQ;
CASTLE_MASK[E1] = 15 & ~(CASTLE_WK | CASTLE_WQ);
CASTLE_MASK[H1] = 15 & ~CASTLE_WK;
CASTLE_MASK[A8] = 15 & ~CASTLE_BQ;
CASTLE_MASK[E8] = 15 & ~(CASTLE_BK | CASTLE_BQ);
CASTLE_MASK[H8] = 15 & ~CASTLE_BK;

// ---------------------------------------------------------------------------
// Search constants
// ---------------------------------------------------------------------------

export const MAX_HIST = 2048;
export const MAX_PLY = 128;
export const MAX_MOVES = 256;

export const MATE = 30000;
export const MATE_BOUND = 29000;
export const INF = 32000;

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
