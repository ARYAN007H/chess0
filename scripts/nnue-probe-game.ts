/**
 * One-game probe: v3nnue vs v3base from a fixed opening, printing every
 * move with the mover's search score. Big score swings locate the blunder.
 * Usage: npx tsx scripts/nnue-probe-game.ts [movetimeMs]
 */

import { readFileSync } from 'node:fs';
import { makeMove, newStartPosition, parseFen, Position } from '../src/engine/position';
import { searchPositionV3, clearTTV3 } from '../src/engine/searchV3';
import { evalNnueWhitePov, loadNnueWeights } from '../src/engine/nnue';
import { setEvalOverride, clearEvalCaches } from '../src/engine/evalV3';
import { resetEvalParams } from '../src/engine/evalV3Params';
import { resetEvalV2Params } from '../src/engine/evalV2Params';
import { moveFrom, moveTo, movePromo } from '../src/engine/types';

const MOVETIME = Number(process.argv[2] ?? 250);
const OPENING = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'g8f6'];

function uci(m: number): string {
  const files = 'abcdefgh';
  const from = moveFrom(m);
  const to = moveTo(m);
  const promo = movePromo(m);
  const pc = promo ? ' nbrq'[promo] : '';
  return files[from & 7] + (1 + (from >> 4)) + files[to & 7] + (1 + (to >> 4)) + pc;
}

function sq(s: number): string {
  return 'abcdefgh'[s & 7] + (1 + (s >> 4));
}

// Opening phase: both sides play book moves blindly.
const pos = newStartPosition();
for (const u of OPENING) {
  const r = searchPositionV3(pos, { movetime: 1, multiPv: 1 }); // warm struct
  void r;
  // find the book move among legal moves by UCI match — use the search to
  // generate the legal list via a 0-time search's pv? simpler: brute force
  const { legalMoves } = await import('../src/engine/movegen');
  const moves = legalMoves(pos);
  const m = moves.find((x) => uci(x) === u)!;
  makeMove(pos, m);
}

resetEvalParams();
resetEvalV2Params();
loadNnueWeights(readFileSync('data/nnue-v1.bin'));

const CLEAR_TT = process.env.CLEAR_TT === '1';
if (CLEAR_TT) console.log('(clearing TT each ply)');

for (let ply = 0; ply < 200; ply++) {
  const nnueToMove = ply % 2 === 0; // after even plies, white to move → nnue is white
  setEvalOverride(nnueToMove ? evalNnueWhitePov : null);
  clearEvalCaches();
  if (CLEAR_TT) clearTTV3();
  const r = searchPositionV3(pos, { movetime: MOVETIME, multiPv: 1 });
  const side = pos.stm === 0 ? 'W' : 'B';
  const who = nnueToMove ? 'nnue' : 'base';
  const score = r.scoreMate !== undefined ? `#M${r.scoreMate}` : `${((r.scoreCp ?? 0) / 100).toFixed(2)}`;
  console.log(
    `ply ${String(ply).padStart(3)} ${side}(${who}) ${uci(r.bestMove).padEnd(6)} score(stm) ${score.padStart(7)} d${r.depth} nodes ${r.nodes}`,
  );
  if (!r.bestMove) break;
  makeMove(pos, r.bestMove);
  if (r.scoreMate !== undefined) {
    console.log('MATE');
    break;
  }
}
void sq;
void Position;
