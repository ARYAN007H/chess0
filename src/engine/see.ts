/**
 * Static Exchange Evaluation (swap-off algorithm) for the 0x88 mailbox.
 *
 * Simulates all recaptures on the destination square, in least-valuable-
 * attacker order, and returns the net material balance for the side that
 * made the move. X-rays are handled naturally: each simulated capture clears
 * its origin square on a scratch board, so sliders behind the attacker are
 * discovered by the next attacker scan.
 */

import { BISHOP, FLAG_EP, KING, KNIGHT, PAWN, QUEEN, ROOK, WHITE, moveCaptured, moveFrom, movePromo, moveTo } from './types';
import type { Position } from './position';

const SEE_VAL = [0, 100, 320, 330, 500, 900, 20000];

const KNIGHT_OFFSETS = [33, 31, 18, 14, -33, -31, -18, -14];
const BISHOP_DIRS = [15, 17, -15, -17];
const ROOK_DIRS = [16, 1, -16, -1];
const KING_DIRS = [15, 17, 16, 1, -15, -17, -16, -1];

const seeBoard = new Int8Array(128);
const gain = new Int32Array(32);

interface Attacker {
  sq: number;
  type: number;
}
const attackerBuf: Attacker = { sq: -1, type: 0 };

/** Least valuable piece of color `byWhite` attacking `sq` on the scratch board. */
function leastValuableAttacker(sq: number, byWhite: boolean): Attacker | null {
  const b = seeBoard;
  let s: number;
  let p: number;

  // Pawns.
  if (byWhite) {
    s = sq - 15;
    if (!(s & 0x88) && b[s] === PAWN) {
      attackerBuf.sq = s;
      attackerBuf.type = PAWN;
      return attackerBuf;
    }
    s = sq - 17;
    if (!(s & 0x88) && b[s] === PAWN) {
      attackerBuf.sq = s;
      attackerBuf.type = PAWN;
      return attackerBuf;
    }
  } else {
    s = sq + 15;
    if (!(s & 0x88) && b[s] === -PAWN) {
      attackerBuf.sq = s;
      attackerBuf.type = PAWN;
      return attackerBuf;
    }
    s = sq + 17;
    if (!(s & 0x88) && b[s] === -PAWN) {
      attackerBuf.sq = s;
      attackerBuf.type = PAWN;
      return attackerBuf;
    }
  }

  // Knights.
  const knight = byWhite ? KNIGHT : -KNIGHT;
  for (let i = 0; i < 8; i++) {
    s = sq + KNIGHT_OFFSETS[i];
    if (!(s & 0x88) && b[s] === knight) {
      attackerBuf.sq = s;
      attackerBuf.type = KNIGHT;
      return attackerBuf;
    }
  }

  // Bishops (on diagonal rays, first blocker).
  const bishop = byWhite ? BISHOP : -BISHOP;
  for (let i = 0; i < 4; i++) {
    const d = BISHOP_DIRS[i];
    s = sq + d;
    while (!(s & 0x88)) {
      p = b[s];
      if (p !== 0) {
        if (p === bishop) {
          attackerBuf.sq = s;
          attackerBuf.type = BISHOP;
          return attackerBuf;
        }
        break;
      }
      s += d;
    }
  }

  // Rooks (on straight rays, first blocker).
  const rook = byWhite ? ROOK : -ROOK;
  for (let i = 0; i < 4; i++) {
    const d = ROOK_DIRS[i];
    s = sq + d;
    while (!(s & 0x88)) {
      p = b[s];
      if (p !== 0) {
        if (p === rook) {
          attackerBuf.sq = s;
          attackerBuf.type = ROOK;
          return attackerBuf;
        }
        break;
      }
      s += d;
    }
  }

  // Queens (either ray class, first blocker).
  const queen = byWhite ? QUEEN : -QUEEN;
  for (let i = 0; i < 4; i++) {
    const d = ROOK_DIRS[i];
    s = sq + d;
    while (!(s & 0x88)) {
      p = b[s];
      if (p !== 0) {
        if (p === queen) {
          attackerBuf.sq = s;
          attackerBuf.type = QUEEN;
          return attackerBuf;
        }
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
        if (p === queen) {
          attackerBuf.sq = s;
          attackerBuf.type = QUEEN;
          return attackerBuf;
        }
        break;
      }
      s += d;
    }
  }

  // King (only matters once all other attackers are gone; value order keeps it last).
  const king = byWhite ? KING : -KING;
  for (let i = 0; i < 8; i++) {
    s = sq + KING_DIRS[i];
    if (!(s & 0x88) && b[s] === king) {
      attackerBuf.sq = s;
      attackerBuf.type = KING;
      return attackerBuf;
    }
  }

  return null;
}

/**
 * Net material balance (centipawns, mover's point of view) after all
 * exchanges on the destination square of `move`.
 *
 * Classic swap-off: each found attacker's capture is speculatively stored
 * (gain[d] = value of the piece standing on the target minus the previous
 * balance) before looking for the next attacker, then the gains are resolved
 * by backward induction: the side to move at each level picks the better of
 * standing pat or continuing the exchange.
 */
export function see(pos: Position, move: number): number {
  const from = moveFrom(move);
  const to = moveTo(move);
  const promo = movePromo(move);
  const moving = pos.board[from];
  const ep = (move & FLAG_EP) !== 0;

  seeBoard.set(pos.board);

  // Remove the victim (en passant captures remove the pawn from its own square).
  const victimType = ep ? PAWN : moveCaptured(move);
  if (victimType !== 0) {
    const victimSq = ep ? (pos.stm === WHITE ? to - 16 : to + 16) : to;
    seeBoard[victimSq] = 0;
  }

  // The moving piece leaves its origin; it is the piece "standing" on `to`.
  // It never needs to be placed on the scratch board: attacker scans start at
  // `to` and stop at the first piece they meet, so the target's occupancy
  // never blocks a scan.
  seeBoard[from] = 0;

  let d = 0;
  gain[0] = SEE_VAL[victimType] + (promo !== 0 ? SEE_VAL[promo] - SEE_VAL[PAWN] : 0);
  let capVal = SEE_VAL[promo !== 0 ? promo : (moving < 0 ? -moving : moving)];
  let side = (pos.stm ^ 1) as 0 | 1; // opponent recaptures first

  for (;;) {
    d++;
    // Speculative store: the piece standing on the target gets captured next.
    gain[d] = capVal - gain[d - 1];
    const a = leastValuableAttacker(to, side === WHITE);
    if (a === null) break;
    // Clear the attacker's origin so x-rays behind it open up for later scans.
    seeBoard[a.sq] = 0;
    capVal = SEE_VAL[a.type];
    side = (side ^ 1) as 0 | 1;
  }

  while (--d > 0) {
    gain[d - 1] = -Math.max(-gain[d - 1], gain[d]);
  }
  return gain[0];
}
