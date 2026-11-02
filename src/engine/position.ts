/**
 * The 0x88 Position: board state, incremental Zobrist hash, incremental
 * tapered-eval accumulators and the make/unmake move machinery.
 *
 * Nothing here allocates during make/unmake — all undo data lives in
 * preallocated history stacks, so search and perft run allocation-free.
 */

import {
  BLACK,
  CASTLE_MASK,
  Color,
  E1,
  E8,
  FLAG_CASTLE,
  FLAG_DOUBLE,
  FLAG_EP,
  KING,
  MAX_HIST,
  PAWN,
  QUEEN,
  ROOK,
  START_FEN,
  WHITE,
  charToPiece,
  moveCaptured,
  moveFrom,
  movePromo,
  moveTo,
  pieceIndex,
  sqTo64,
} from './types';
import { Z_CASTLE_LO, Z_CASTLE_HI, Z_EP_LO, Z_EP_HI, Z_PIECE_LO, Z_PIECE_HI, Z_STM_LO, Z_STM_HI } from './zobrist';
import { PST_EG, PST_MG, PHASE_BY_TYPE } from './psto';

export class Position {
  board = new Int8Array(128);
  stm: Color = WHITE;
  castling = 0;
  ep = -1;
  halfmove = 0;
  fullmove = 1;
  kingSq = new Int32Array(2);
  hashLo = 0;
  hashHi = 0;
  /** Zobrist of pawn placements only (both colors) — keys the eval pawn TT. */
  pawnHashLo = 0;
  pawnHashHi = 0;

  // White-relative incremental tapered-eval accumulators.
  mg = 0;
  eg = 0;
  phase = 0;
  pawnCount = new Int32Array(2);
  minorCount = new Int32Array(2);
  rqCount = new Int32Array(2);
  npmCount = new Int32Array(2); // knights + bishops + rooks + queens

  ply = 0;

  histMove = new Int32Array(MAX_HIST);
  histCastling = new Int32Array(MAX_HIST);
  histEp = new Int32Array(MAX_HIST);
  histHalfmove = new Int32Array(MAX_HIST);
  histHashLo = new Int32Array(MAX_HIST);
  histHashHi = new Int32Array(MAX_HIST);
  histPawnHashLo = new Int32Array(MAX_HIST);
  histPawnHashHi = new Int32Array(MAX_HIST);
  histMg = new Int32Array(MAX_HIST);
  histEg = new Int32Array(MAX_HIST);
  histPhase = new Int32Array(MAX_HIST);
  histPawns = new Int32Array(MAX_HIST);
  histMinors = new Int32Array(MAX_HIST);
  histRq = new Int32Array(MAX_HIST);
  histNpm = new Int32Array(MAX_HIST);

  clone(): Position {
    const p = new Position();
    p.board.set(this.board);
    p.stm = this.stm;
    p.castling = this.castling;
    p.ep = this.ep;
    p.halfmove = this.halfmove;
    p.fullmove = this.fullmove;
    p.kingSq.set(this.kingSq);
    p.hashLo = this.hashLo;
    p.hashHi = this.hashHi;
    p.pawnHashLo = this.pawnHashLo;
    p.pawnHashHi = this.pawnHashHi;
    p.mg = this.mg;
    p.eg = this.eg;
    p.phase = this.phase;
    p.pawnCount.set(this.pawnCount);
    p.minorCount.set(this.minorCount);
    p.rqCount.set(this.rqCount);
    p.npmCount.set(this.npmCount);
    p.ply = this.ply;
    p.histMove.set(this.histMove);
    p.histCastling.set(this.histCastling);
    p.histEp.set(this.histEp);
    p.histHalfmove.set(this.histHalfmove);
    p.histHashLo.set(this.histHashLo);
    p.histHashHi.set(this.histHashHi);
    p.histPawnHashLo.set(this.histPawnHashLo);
    p.histPawnHashHi.set(this.histPawnHashHi);
    p.histMg.set(this.histMg);
    p.histEg.set(this.histEg);
    p.histPhase.set(this.histPhase);
    p.histPawns.set(this.histPawns);
    p.histMinors.set(this.histMinors);
    p.histRq.set(this.histRq);
    p.histNpm.set(this.histNpm);
    return p;
  }

  /**
   * True when the side to move can pseudo-legally capture on the current ep
   * square. The ep square is only hashed when this holds, so transpositions
   * that differ in an irrelevant ep square hash identically.
   */
  epCapturable(): boolean {
    if (this.ep < 0) return false;
    const pawn = this.stm === WHITE ? PAWN : -PAWN;
    return this.board[this.ep - 1] === pawn || this.board[this.ep + 1] === pawn;
  }
}

// ---------------------------------------------------------------------------
// Incremental eval bookkeeping
// ---------------------------------------------------------------------------

function addPieceEval(pos: Position, piece: number, sq: number): void {
  const pi = pieceIndex(piece);
  const s = sqTo64(sq);
  pos.mg += PST_MG[pi * 64 + s];
  pos.eg += PST_EG[pi * 64 + s];
  const type = piece < 0 ? -piece : piece;
  pos.phase += PHASE_BY_TYPE[type];
  const color = piece > 0 ? WHITE : BLACK;
  if (type === PAWN) {
    pos.pawnCount[color]++;
    pos.pawnHashLo ^= Z_PIECE_LO[pi * 128 + sq];
    pos.pawnHashHi ^= Z_PIECE_HI[pi * 128 + sq];
  } else if (type === QUEEN || type === ROOK) {
    pos.rqCount[color]++;
    pos.npmCount[color]++;
  } else if (type !== KING) {
    pos.minorCount[color]++;
    pos.npmCount[color]++;
  }
}

function removePieceEval(pos: Position, piece: number, sq: number): void {
  const pi = pieceIndex(piece);
  const s = sqTo64(sq);
  pos.mg -= PST_MG[pi * 64 + s];
  pos.eg -= PST_EG[pi * 64 + s];
  const type = piece < 0 ? -piece : piece;
  pos.phase -= PHASE_BY_TYPE[type];
  const color = piece > 0 ? WHITE : BLACK;
  if (type === PAWN) {
    pos.pawnCount[color]--;
    pos.pawnHashLo ^= Z_PIECE_LO[pi * 128 + sq];
    pos.pawnHashHi ^= Z_PIECE_HI[pi * 128 + sq];
  } else if (type === QUEEN || type === ROOK) {
    pos.rqCount[color]--;
    pos.npmCount[color]--;
  } else if (type !== KING) {
    pos.minorCount[color]--;
    pos.npmCount[color]--;
  }
}

// ---------------------------------------------------------------------------
// Full recomputation (used by FEN parsing and by the consistency tests)
// ---------------------------------------------------------------------------

export function computeDerived(pos: Position): void {
  pos.mg = 0;
  pos.eg = 0;
  pos.phase = 0;
  pos.pawnHashLo = 0;
  pos.pawnHashHi = 0;
  pos.pawnCount.fill(0);
  pos.minorCount.fill(0);
  pos.rqCount.fill(0);
  pos.npmCount.fill(0);
  pos.kingSq[WHITE] = pos.kingSq[BLACK] = -1;

  let lo = 0;
  let hi = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const piece = pos.board[sq];
    if (piece === 0) continue;
    addPieceEval(pos, piece, sq);
    const pi = pieceIndex(piece);
    lo ^= Z_PIECE_LO[pi * 128 + sq];
    hi ^= Z_PIECE_HI[pi * 128 + sq];
    if (piece === KING) pos.kingSq[WHITE] = sq;
    if (piece === -KING) pos.kingSq[BLACK] = sq;
  }
  if (pos.ep >= 0 && pos.epCapturable()) {
    lo ^= Z_EP_LO[pos.ep];
    hi ^= Z_EP_HI[pos.ep];
  }
  lo ^= Z_CASTLE_LO[pos.castling];
  hi ^= Z_CASTLE_HI[pos.castling];
  if (pos.stm === BLACK) {
    lo ^= Z_STM_LO;
    hi ^= Z_STM_HI;
  }
  pos.hashLo = lo | 0;
  pos.hashHi = hi | 0;
}

// ---------------------------------------------------------------------------
// make / unmake
// ---------------------------------------------------------------------------

export function makeMove(pos: Position, move: number): void {
  const h = pos.ply;
  const from = moveFrom(move);
  const to = moveTo(move);
  const flags = move & (FLAG_EP | FLAG_CASTLE | FLAG_DOUBLE);
  const piece = pos.board[from];
  const type = piece < 0 ? -piece : piece;
  const us = pos.stm;
  const them = (us ^ 1) as Color;

  pos.histMove[h] = move;
  pos.histCastling[h] = pos.castling;
  pos.histEp[h] = pos.ep;
  pos.histHalfmove[h] = pos.halfmove;
  pos.histHashLo[h] = pos.hashLo;
  pos.histHashHi[h] = pos.hashHi;
  pos.histPawnHashLo[h] = pos.pawnHashLo;
  pos.histPawnHashHi[h] = pos.pawnHashHi;
  pos.histMg[h] = pos.mg;
  pos.histEg[h] = pos.eg;
  pos.histPhase[h] = pos.phase;
  pos.histPawns[h] = pos.pawnCount[WHITE] | (pos.pawnCount[BLACK] << 16);
  pos.histMinors[h] = pos.minorCount[WHITE] | (pos.minorCount[BLACK] << 16);
  pos.histRq[h] = pos.rqCount[WHITE] | (pos.rqCount[BLACK] << 16);
  pos.histNpm[h] = pos.npmCount[WHITE] | (pos.npmCount[BLACK] << 16);

  let lo = pos.hashLo ^ Z_STM_LO;
  let hi = pos.hashHi ^ Z_STM_HI;

  if (pos.ep >= 0 && pos.epCapturable()) {
    lo ^= Z_EP_LO[pos.ep];
    hi ^= Z_EP_HI[pos.ep];
  }
  lo ^= Z_CASTLE_LO[pos.castling];
  hi ^= Z_CASTLE_HI[pos.castling];

  // Remove the moving piece from its origin.
  const pi = pieceIndex(piece);
  lo ^= Z_PIECE_LO[pi * 128 + from];
  hi ^= Z_PIECE_HI[pi * 128 + from];
  removePieceEval(pos, piece, from);
  pos.board[from] = 0;

  // Remove the captured piece.
  const capturedType = moveCaptured(move);
  if (capturedType !== 0) {
    const capSq = flags & FLAG_EP ? (us === WHITE ? to - 16 : to + 16) : to;
    const capPiece = us === WHITE ? -capturedType : capturedType;
    const capPi = pieceIndex(capPiece);
    lo ^= Z_PIECE_LO[capPi * 128 + capSq];
    hi ^= Z_PIECE_HI[capPi * 128 + capSq];
    removePieceEval(pos, capPiece, capSq);
    pos.board[capSq] = 0;
    pos.halfmove = 0;
  } else if (type === PAWN) {
    pos.halfmove = 0;
  } else {
    pos.halfmove++;
  }

  // Place the mover (or the promoted piece).
  const promo = movePromo(move);
  const newType = promo !== 0 ? promo : type;
  const newPiece = us === WHITE ? newType : -newType;
  const newPi = pieceIndex(newPiece);
  lo ^= Z_PIECE_LO[newPi * 128 + to];
  hi ^= Z_PIECE_HI[newPi * 128 + to];
  addPieceEval(pos, newPiece, to);
  pos.board[to] = newPiece;
  if (type === KING) pos.kingSq[us] = to;

  // Castling: also move the rook.
  if (flags & FLAG_CASTLE) {
    const rookFrom = to > from ? to + 1 : to - 2;
    const rookTo = to > from ? to - 1 : to + 1;
    const rook = us === WHITE ? ROOK : -ROOK;
    const rkPi = pieceIndex(rook);
    lo ^= Z_PIECE_LO[rkPi * 128 + rookFrom] ^ Z_PIECE_LO[rkPi * 128 + rookTo];
    hi ^= Z_PIECE_HI[rkPi * 128 + rookFrom] ^ Z_PIECE_HI[rkPi * 128 + rookTo];
    removePieceEval(pos, rook, rookFrom);
    addPieceEval(pos, rook, rookTo);
    pos.board[rookFrom] = 0;
    pos.board[rookTo] = rook;
  }

  // New ep square (stored for FEN fidelity even if no capture is possible).
  pos.ep = flags & FLAG_DOUBLE ? (us === WHITE ? from + 16 : from - 16) : -1;

  // Flip the side to move *before* hashing the new ep square: capturability
  // is a property of the side that will move next.
  pos.stm = them;

  if (pos.ep >= 0 && pos.epCapturable()) {
    lo ^= Z_EP_LO[pos.ep];
    hi ^= Z_EP_HI[pos.ep];
  }

  pos.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
  lo ^= Z_CASTLE_LO[pos.castling];
  hi ^= Z_CASTLE_HI[pos.castling];

  if (us === BLACK) pos.fullmove++;
  pos.ply++;
  pos.hashLo = lo | 0;
  pos.hashHi = hi | 0;
}

export function unmakeMove(pos: Position, move: number): void {
  pos.ply--;
  pos.stm = (pos.stm ^ 1) as Color;
  const us = pos.stm;
  if (us === BLACK) pos.fullmove--;

  const h = pos.ply;
  const from = moveFrom(move);
  const to = moveTo(move);
  const promo = movePromo(move);
  const capturedType = moveCaptured(move);
  const flags = move & (FLAG_EP | FLAG_CASTLE | FLAG_DOUBLE);

  pos.castling = pos.histCastling[h];
  pos.ep = pos.histEp[h];
  pos.halfmove = pos.histHalfmove[h];
  pos.hashLo = pos.histHashLo[h];
  pos.hashHi = pos.histHashHi[h];
  pos.pawnHashLo = pos.histPawnHashLo[h];
  pos.pawnHashHi = pos.histPawnHashHi[h];
  pos.mg = pos.histMg[h];
  pos.eg = pos.histEg[h];
  pos.phase = pos.histPhase[h];
  pos.pawnCount[WHITE] = pos.histPawns[h] & 0xffff;
  pos.pawnCount[BLACK] = pos.histPawns[h] >>> 16;
  pos.minorCount[WHITE] = pos.histMinors[h] & 0xffff;
  pos.minorCount[BLACK] = pos.histMinors[h] >>> 16;
  pos.rqCount[WHITE] = pos.histRq[h] & 0xffff;
  pos.rqCount[BLACK] = pos.histRq[h] >>> 16;
  pos.npmCount[WHITE] = pos.histNpm[h] & 0xffff;
  pos.npmCount[BLACK] = pos.histNpm[h] >>> 16;

  // The piece standing on `to` moves back (a promotion means the origin held a pawn).
  const movedType = promo !== 0 ? PAWN : Math.abs(pos.board[to]);
  pos.board[to] = 0;
  pos.board[from] = us === WHITE ? movedType : -movedType;
  if (movedType === KING) pos.kingSq[us] = from;

  if (flags & FLAG_CASTLE) {
    const rookFrom = to > from ? to + 1 : to - 2;
    const rookTo = to > from ? to - 1 : to + 1;
    pos.board[rookFrom] = us === WHITE ? ROOK : -ROOK;
    pos.board[rookTo] = 0;
  }

  if (capturedType !== 0) {
    const capSq = flags & FLAG_EP ? (us === WHITE ? to - 16 : to + 16) : to;
    pos.board[capSq] = us === WHITE ? -capturedType : capturedType;
  }
}

/** Null move (for null-move pruning). move slot 0 marks a null in the stack. */
export function makeNullMove(pos: Position): void {
  const h = pos.ply;
  pos.histMove[h] = 0;
  pos.histCastling[h] = pos.castling;
  pos.histEp[h] = pos.ep;
  pos.histHalfmove[h] = pos.halfmove;
  pos.histHashLo[h] = pos.hashLo;
  pos.histHashHi[h] = pos.hashHi;
  pos.histPawnHashLo[h] = pos.pawnHashLo;
  pos.histPawnHashHi[h] = pos.pawnHashHi;
  pos.histMg[h] = pos.mg;
  pos.histEg[h] = pos.eg;
  pos.histPhase[h] = pos.phase;
  pos.histPawns[h] = pos.pawnCount[WHITE] | (pos.pawnCount[BLACK] << 16);
  pos.histMinors[h] = pos.minorCount[WHITE] | (pos.minorCount[BLACK] << 16);
  pos.histRq[h] = pos.rqCount[WHITE] | (pos.rqCount[BLACK] << 16);
  pos.histNpm[h] = pos.npmCount[WHITE] | (pos.npmCount[BLACK] << 16);

  let lo = pos.hashLo ^ Z_STM_LO;
  let hi = pos.hashHi ^ Z_STM_HI;
  if (pos.ep >= 0 && pos.epCapturable()) {
    lo ^= Z_EP_LO[pos.ep];
    hi ^= Z_EP_HI[pos.ep];
  }
  pos.ep = -1;
  pos.halfmove++;
  pos.stm = (pos.stm ^ 1) as Color;
  pos.ply++;
  pos.hashLo = lo | 0;
  pos.hashHi = hi | 0;
}

export function unmakeNullMove(pos: Position): void {
  pos.ply--;
  pos.stm = (pos.stm ^ 1) as Color;
  const h = pos.ply;
  pos.castling = pos.histCastling[h];
  pos.ep = pos.histEp[h];
  pos.halfmove = pos.histHalfmove[h];
  pos.hashLo = pos.histHashLo[h];
  pos.hashHi = pos.histHashHi[h];
  pos.pawnHashLo = pos.histPawnHashLo[h];
  pos.pawnHashHi = pos.histPawnHashHi[h];
  // Eval accumulators and piece counts are untouched by a null move.
}

// ---------------------------------------------------------------------------
// FEN
// ---------------------------------------------------------------------------

export function parseFen(pos: Position, fen: string): void {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) throw new Error(`Invalid FEN: "${fen}"`);
  const [placement, side, castlingField = '-', epField = '-', halfField = '0', moveField = '1'] = parts;

  pos.board.fill(0);
  pos.ply = 0;
  pos.ep = -1;
  pos.halfmove = 0;
  pos.fullmove = 1;

  let rank = 7;
  let file = 0;
  for (const c of placement) {
    if (c === '/') {
      if (file !== 8) throw new Error(`Invalid FEN: rank ${rank + 1} has ${file} squares`);
      rank--;
      file = 0;
      if (rank < 0) throw new Error('Invalid FEN: too many ranks');
    } else if (c >= '1' && c <= '8') {
      file += c.charCodeAt(0) - 48;
      if (file > 8) throw new Error('Invalid FEN: rank overflow');
    } else {
      const piece = charToPiece(c);
      if (piece === 0) throw new Error(`Invalid FEN: bad piece "${c}"`);
      if (file > 7) throw new Error('Invalid FEN: too many files');
      pos.board[(rank << 4) | file] = piece;
      file++;
    }
  }
  if (file !== 8) throw new Error(`Invalid FEN: last rank has ${file} squares`);

  pos.stm = side === 'w' ? WHITE : side === 'b' ? BLACK : (() => { throw new Error(`Invalid FEN side "${side}"`); })();

  pos.castling = 0;
  if (castlingField !== '-') {
    for (const c of castlingField) {
      if (c === 'K') pos.castling |= 1;
      else if (c === 'Q') pos.castling |= 2;
      else if (c === 'k') pos.castling |= 4;
      else if (c === 'q') pos.castling |= 8;
      else throw new Error(`Invalid FEN castling "${castlingField}"`);
    }
  }
  // Drop rights whose king/rook is not on its home square.
  if (pos.castling & 3) {
    if (pos.board[E1] !== KING) pos.castling &= ~3;
    if (pos.board[0x07] !== ROOK) pos.castling &= ~1;
    if (pos.board[0x00] !== ROOK) pos.castling &= ~2;
  }
  if (pos.castling & 12) {
    if (pos.board[E8] !== -KING) pos.castling &= ~12;
    if (pos.board[0x77] !== -ROOK) pos.castling &= ~4;
    if (pos.board[0x70] !== -ROOK) pos.castling &= ~8;
  }

  if (epField !== '-') {
    const f = 'abcdefgh'.indexOf(epField[0]);
    const r = epField.charCodeAt(1) - 49;
    if (f < 0 || r < 0 || r > 7 || epField.length !== 2) throw new Error(`Invalid FEN ep "${epField}"`);
    const sq = (r << 4) | f;
    // Only meaningful on ranks 3 and 6.
    pos.ep = r === 2 || r === 5 ? sq : -1;
  }

  const hm = parseInt(halfField, 10);
  if (!Number.isNaN(hm)) pos.halfmove = hm;
  const fm = parseInt(moveField, 10);
  if (!Number.isNaN(fm)) pos.fullmove = Math.max(1, fm);

  computeDerived(pos);

  if (pos.kingSq[WHITE] < 0 || pos.kingSq[BLACK] < 0) throw new Error('Invalid FEN: missing king');
  if (pos.pawnCount[WHITE] > 8 || pos.pawnCount[BLACK] > 8) throw new Error('Invalid FEN: too many pawns');
  // Reject pawns on ranks 1/8.
  for (let f = 0; f < 8; f++) {
    if (pos.board[0x00 + f] === PAWN || pos.board[0x00 + f] === -PAWN) throw new Error('Invalid FEN: pawn on rank 1');
    if (pos.board[0x70 + f] === PAWN || pos.board[0x70 + f] === -PAWN) throw new Error('Invalid FEN: pawn on rank 8');
  }
}

export function toFen(pos: Position): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = pos.board[(rank << 4) | file];
      if (piece === 0) {
        empty++;
      } else {
        if (empty > 0) {
          row += empty;
          empty = 0;
        }
        row += piece > 0 ? 'PNBRQK'[piece - 1] : 'pnbrqk'[-piece - 1];
      }
    }
    if (empty > 0) row += empty;
    rows.push(row);
  }
  const castling =
    (pos.castling & 1 ? 'K' : '') +
    (pos.castling & 2 ? 'Q' : '') +
    (pos.castling & 4 ? 'k' : '') +
    (pos.castling & 8 ? 'q' : '');
  return [
    rows.join('/'),
    pos.stm === WHITE ? 'w' : 'b',
    castling || '-',
    pos.ep >= 0 ? 'abcdefgh'[pos.ep & 7] + (1 + (pos.ep >> 4)) : '-',
    pos.halfmove,
    pos.fullmove,
  ].join(' ');
}

export function newStartPosition(): Position {
  const pos = new Position();
  parseFen(pos, START_FEN);
  return pos;
}
