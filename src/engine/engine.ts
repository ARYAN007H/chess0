/**
 * Engine facade: one Position plus the legal-move / SAN / status / search
 * API used by the web worker, the UCI CLI and the UI's main-thread copy.
 */

import { WHITE, START_FEN, moveToUci, squareName, parseSquare, moveFrom, moveTo, movePromo, KING, PAWN, KNIGHT, BISHOP, ROOK, QUEEN } from './types';
import { Position, parseFen, toFen, makeMove, unmakeMove, newStartPosition } from './position';
import { legalMoves, inCheckOf } from './movegen';
import { moveToSan } from './san';
import { searchPosition } from './search';
import type { SearchInfo, SearchLimits, SearchResult } from './search';
import { searchPositionV2 } from './searchV2';
import { searchPositionV3 } from './searchV3';
import { insufficientMaterial } from './eval';

export type GameEnd =
  | null
  | { type: 'checkmate'; winner: 0 | 1 }
  | { type: 'stalemate' }
  | { type: 'fifty-move' }
  | { type: 'repetition' }
  | { type: 'insufficient-material' };

export interface PieceCounts {
  /** counts per type index 1..6 (pawn..king) */
  white: number[];
  black: number[];
}

export class Engine {
  pos: Position = newStartPosition();

  reset(fen: string = START_FEN): void {
    parseFen(this.pos, fen);
  }

  fen(): string {
    return toFen(this.pos);
  }

  get stm(): 0 | 1 {
    return this.pos.stm;
  }

  get ply(): number {
    return this.pos.ply;
  }

  legalMoves(): Int32Array {
    return legalMoves(this.pos);
  }

  /** Find the legal move matching a UCI string (tolerates x, +, #, = decorations). */
  uciToMove(uci: string): number | null {
    const norm = uci.toLowerCase().replace(/[x+#?!]/g, '').replace('=', '');
    const moves = this.legalMoves();
    for (let i = 0; i < moves.length; i++) {
      if (moveToUci(moves[i]) === norm) return moves[i];
    }
    return null;
  }

  /** Apply a move from UCI. Returns the encoded move, or null if illegal. */
  applyUci(uci: string): number | null {
    const move = this.uciToMove(uci);
    if (move === null) return null;
    makeMove(this.pos, move);
    return move;
  }

  applyMove(move: number): void {
    makeMove(this.pos, move);
  }

  /** Undo the last `plies` moves. */
  undo(plies: number): void {
    for (let i = 0; i < plies; i++) {
      if (this.pos.ply === 0) break;
      const move = this.pos.histMove[this.pos.ply - 1];
      unmakeMove(this.pos, move);
    }
  }

  sanFor(move: number): string {
    return moveToSan(this.pos, move);
  }

  /** How many times has the current position already occurred (incl. now)? */
  repetitionCount(): number {
    let count = 1;
    const lo = this.pos.hashLo;
    const hi = this.pos.hashHi;
    for (let h = this.pos.ply - 2; h >= 0; h -= 2) {
      if (this.pos.histHashLo[h] === lo && this.pos.histHashHi[h] === hi) count++;
    }
    return count;
  }

  /** Terminal state after the last applied move, or null while playing. */
  gameEnd(): GameEnd {
    const moves = legalMoves(this.pos);
    if (moves.length === 0) {
      if (inCheckOf(this.pos, this.pos.stm)) {
        return { type: 'checkmate', winner: (this.pos.stm ^ 1) as 0 | 1 };
      }
      return { type: 'stalemate' };
    }
    if (insufficientMaterial(this.pos)) return { type: 'insufficient-material' };
    if (this.pos.halfmove >= 100) return { type: 'fifty-move' };
    if (this.repetitionCount() >= 3) return { type: 'repetition' };
    return null;
  }

  inCheck(): boolean {
    return inCheckOf(this.pos, this.pos.stm);
  }

  pieceCounts(): PieceCounts {
    const white = [0, 0, 0, 0, 0, 0, 0];
    const black = [0, 0, 0, 0, 0, 0, 0];
    const b = this.pos.board;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const p = b[sq];
      if (p === 0) continue;
      if (p > 0) white[p]++;
      else black[-p]++;
    }
    return { white, black };
  }

  search(limits: SearchLimits, onInfo?: (info: SearchInfo) => void): SearchResult {
    if (limits.variant === 'v3') return searchPositionV3(this.pos, limits, onInfo);
    if (limits.variant === 'v2') return searchPositionV2(this.pos, limits, onInfo);
    return searchPosition(this.pos, limits, onInfo);
  }

  static START_FEN = START_FEN;
}

export type { SearchInfo, SearchLimits, SearchResult };
export { moveToUci, squareName, parseSquare, moveFrom, moveTo, movePromo, START_FEN } from './types';
export { KING, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, WHITE };
