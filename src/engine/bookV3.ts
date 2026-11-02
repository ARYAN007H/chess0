/**
 * Chess0 v3 Hybrid Opening Book, ECO Detector & Repertoire Explorer.
 *
 * Provides:
 *   1. Position-keyed Grandmaster book candidates with ECO codes, variation
 *      names, preference weights, and master Win/Draw/Loss percentages.
 *   2. Live opening classification (`detectOpening`) for any move sequence.
 *   3. Browseable Opening Repertoire & Famous Tactical Presets.
 */

import { newStartPosition, makeMove } from './position';
import type { Position } from './position';
import { legalMoves } from './movegen';
import { moveToUci } from './types';
import { moveToSan } from './san';

export interface BookCandidate {
  move: number;
  uci: string;
  san: string;
  weight: number; // 1..100 preference weight
  eco: string;
  opening: string;
  whiteWinPct: number;
  drawPct: number;
  blackWinPct: number;
}

export interface OpeningLineDef {
  eco: string;
  name: string;
  weight: number;
  w: number;
  d: number;
  b: number;
  moves: string;
}

interface RawBookEntry {
  uci: string;
  san: string;
  weight: number;
  eco: string;
  opening: string;
  w: number;
  d: number;
  b: number;
}

export const OPENING_REPERTOIRE: OpeningLineDef[] = [
  // Open Games (1.e4 e5)
  {
    eco: 'C88',
    name: 'Ruy Lopez · Closed Morphy Defense',
    weight: 100,
    w: 39,
    d: 41,
    b: 20,
    moves: 'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 e8g8 h2h3',
  },
  {
    eco: 'C67',
    name: 'Ruy Lopez · Berlin Defense',
    weight: 96,
    w: 34,
    d: 48,
    b: 18,
    moves: 'e2e4 e7e5 g1f3 b8c6 f1b5 g8f6 e1g1 f6e4 d2d4 f8e7 d1e2 e4d6 b5c6 b7c6 d4e5 d6b7',
  },
  {
    eco: 'C89',
    name: 'Ruy Lopez · Marshall Attack',
    weight: 92,
    w: 35,
    d: 45,
    b: 20,
    moves: 'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 e8g8 c2c3 d7d5 e4d5 f6d5',
  },
  {
    eco: 'C54',
    name: 'Italian Game · Giuoco Pianissimo',
    weight: 96,
    w: 38,
    d: 40,
    b: 22,
    moves: 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6 e1g1 a7a5 f1e1 e8g8 h2h3',
  },
  {
    eco: 'C57',
    name: 'Italian Game · Two Knights Defense',
    weight: 90,
    w: 40,
    d: 34,
    b: 26,
    moves: 'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d4 e5d4 e1g1 f6e4 f1e1 d7d5 c4d5 d8d5 b1c3',
  },
  {
    eco: 'C51',
    name: 'Italian Game · Evans Gambit',
    weight: 85,
    w: 44,
    d: 28,
    b: 28,
    moves: 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b4 c2c3 b4a5 d2d4 e5d4 e1g1',
  },
  {
    eco: 'C45',
    name: 'Scotch Game · Classical Variation',
    weight: 89,
    w: 39,
    d: 37,
    b: 24,
    moves: 'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 f8c5 c1e3 d8f6 c2c3 g8e7 f1c4',
  },
  {
    eco: 'C42',
    name: 'Petrov Defense · Classical Mainline',
    weight: 88,
    w: 33,
    d: 49,
    b: 18,
    moves: 'e2e4 e7e5 g1f3 g8f6 f3e5 d7d6 e5f3 f6e4 d2d4 d6d5 f1d3 b8c6 e1g1 f8e7 c2c4',
  },
  // Sicilian Defense (1.e4 c5)
  {
    eco: 'B90',
    name: 'Sicilian · Najdorf English Attack',
    weight: 100,
    w: 38,
    d: 33,
    b: 29,
    moves: 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 f2f3 e7e5 d4b3 c8e6 c1e3 f8e7 d1d2',
  },
  {
    eco: 'B96',
    name: 'Sicilian · Najdorf 6.Bg5 Sharp',
    weight: 93,
    w: 41,
    d: 30,
    b: 29,
    moves: 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1g5 e7e6 f2f4 f8e7 d1f3',
  },
  {
    eco: 'B33',
    name: 'Sicilian · Sveshnikov Variation',
    weight: 95,
    w: 37,
    d: 38,
    b: 25,
    moves: 'e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6 b1c3 e7e5 d4b5 d7d6 c1g5 a7a6 b5a3 b7b5',
  },
  {
    eco: 'B76',
    name: 'Sicilian · Dragon Yugoslav Attack',
    weight: 89,
    w: 42,
    d: 29,
    b: 29,
    moves: 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 g7g6 c1e3 f8g7 f2f3 e8g8 d1d2 b8c6',
  },
  {
    eco: 'B48',
    name: 'Sicilian · Taimanov Variation',
    weight: 91,
    w: 38,
    d: 36,
    b: 26,
    moves: 'e2e4 c7c5 g1f3 e7e6 d2d4 c5d4 f3d4 b8c6 b1c3 d8c7 f1e2 a7a6 e1g1 g8f6 c1e3',
  },
  {
    eco: 'B22',
    name: 'Sicilian · Alapin 2.c3',
    weight: 87,
    w: 39,
    d: 36,
    b: 25,
    moves: 'e2e4 c7c5 c2c3 g8f6 e4e5 f6d5 d2d4 c5d4 g1f3 b8c6 f1c4 d5b6 c4b3',
  },
  {
    eco: 'B31',
    name: 'Sicilian · Rossolimo Attack',
    weight: 92,
    w: 40,
    d: 37,
    b: 23,
    moves: 'e2e4 c7c5 g1f3 b8c6 f1b5 g7g6 e1g1 f8g7 c2c3 g8f6 f1e1 e8g8 d2d4',
  },
  // French & Caro-Kann & Pirc
  {
    eco: 'C07',
    name: 'French Defense · Tarrasch Open',
    weight: 91,
    w: 39,
    d: 39,
    b: 22,
    moves: 'e2e4 e7e6 d2d4 d7d5 b1d2 c7c5 e4d5 d8d5 g1f3 c5d4 f1c4 d5d6 e1g1 g8f6',
  },
  {
    eco: 'C18',
    name: 'French Defense · Winawer Poisoned Pawn',
    weight: 89,
    w: 41,
    d: 31,
    b: 28,
    moves: 'e2e4 e7e6 d2d4 d7d5 b1c3 f8b4 e4e5 c7c5 a2a3 b4c3 b2c3 g8e7 d1g4',
  },
  {
    eco: 'C02',
    name: 'French Defense · Advance Variation',
    weight: 86,
    w: 38,
    d: 35,
    b: 27,
    moves: 'e2e4 e7e6 d2d4 d7d5 e4e5 c7c5 c2c3 b8c6 g1f3 d8b6 f1d3 c5d4 c3d4',
  },
  {
    eco: 'B18',
    name: 'Caro-Kann · Classical Mainline',
    weight: 93,
    w: 38,
    d: 40,
    b: 22,
    moves: 'e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5 e4g3 f5g6 h2h4 h7h6 g1f3 b8d7',
  },
  {
    eco: 'B12',
    name: 'Caro-Kann · Advance Short System',
    weight: 91,
    w: 40,
    d: 38,
    b: 22,
    moves: 'e2e4 c7c6 d2d4 d7d5 e4e5 c8f5 g1f3 e7e6 f1e2 c7c5 c1e3 b8c6 e1g1',
  },
  // Queen's Pawn (1.d4)
  {
    eco: 'D37',
    name: "Queen's Gambit Declined · Classical",
    weight: 100,
    w: 40,
    d: 42,
    b: 18,
    moves: 'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c4d5 e6d5 c1g5 f8e7 e2e3 e8g8 f1d3 c7c6 d1c2 b8d7',
  },
  {
    eco: 'D47',
    name: 'Semi-Slav Defense · Meran Variation',
    weight: 95,
    w: 38,
    d: 39,
    b: 23,
    moves: 'd2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 e7e6 e2e3 b8d7 f1d3 d5c4 d3c4 b7b5 c4d3',
  },
  {
    eco: 'E04',
    name: 'Catalan Opening · Open Defense',
    weight: 99,
    w: 43,
    d: 41,
    b: 16,
    moves: 'd2d4 g8f6 c2c4 e7e6 g2g3 d7d5 f1g2 d5c4 g1f3 f8e7 e1g1 e8g8 d1c2 a7a6 c2c4 b7b5',
  },
  {
    eco: 'D27',
    name: "Queen's Gambit Accepted · Mainline",
    weight: 89,
    w: 39,
    d: 41,
    b: 20,
    moves: 'd2d4 d7d5 c2c4 d5c4 g1f3 g8f6 e2e3 e7e6 f1c4 c7c5 e1g1 a7a6',
  },
  {
    eco: 'D02',
    name: 'London System · Active Counter',
    weight: 87,
    w: 37,
    d: 38,
    b: 25,
    moves: 'd2d4 d7d5 c1f4 g8f6 e2e3 c7c5 c2c3 b8c6 b1d2 e7e6 g1f3 f8d6 f4g3 e8g8',
  },
  // Indian Defenses (1.d4 Nf6)
  {
    eco: 'E54',
    name: 'Nimzo-Indian · Rubinstein System',
    weight: 98,
    w: 37,
    d: 42,
    b: 21,
    moves: 'd2d4 g8f6 c2c4 e7e6 b1c3 f8b4 e2e3 e8g8 f1d3 d7d5 g1f3 c7c5 e1g1 d5c4 d3c4',
  },
  {
    eco: 'E99',
    name: "King's Indian · Mar del Plata Attack",
    weight: 95,
    w: 41,
    d: 30,
    b: 29,
    moves: 'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8 f1e2 e7e5 e1g1 b8c6 d4d5 c6e7',
  },
  {
    eco: 'D85',
    name: 'Grünfeld Defense · Exchange Variation',
    weight: 97,
    w: 38,
    d: 40,
    b: 22,
    moves: 'd2d4 g8f6 c2c4 g7g6 b1c3 d7d5 c4d5 f6d5 e2e4 d5c3 b2c3 f8g7 f1c4 c7c5 g1e2 b8c6 c1e3 e8g8',
  },
  // Flank Openings (1.c4, 1.Nf3)
  {
    eco: 'A29',
    name: 'English Opening · Four Knights Kingside',
    weight: 93,
    w: 39,
    d: 39,
    b: 22,
    moves: 'c2c4 e7e5 b1c3 g8f6 g1f3 b8c6 g2g3 d7d5 c4d5 f6d5 f1g2 d5b6 e1g1 f8e7',
  },
  {
    eco: 'A34',
    name: 'English Opening · Symmetrical Variation',
    weight: 89,
    w: 36,
    d: 44,
    b: 20,
    moves: 'c2c4 c7c5 g1f3 g8f6 b1c3 b8c6 d2d4 c5d4 f3d4 e7e6 g2g3 f8b4 f1g2',
  },
  {
    eco: 'A07',
    name: "Réti Opening · King's Indian Attack",
    weight: 87,
    w: 38,
    d: 40,
    b: 22,
    moves: 'g1f3 d7d5 g2g3 g8f6 f1g2 c7c6 e1g1 c8f5 d2d3 e7e6 b1d2 h7h6',
  },
];

export interface TacticalPreset {
  id: string;
  title: string;
  subtitle: string;
  eco: string;
  fen: string;
  description: string;
}

export const TACTICAL_PRESETS: TacticalPreset[] = [
  {
    id: 'kiwipete',
    title: 'Kiwipete Tactical Complex',
    subtitle: 'Sharp Middlegame · White to move',
    eco: 'B46',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    description: 'High-branching tactical benchmark rich in sacrifices, pins, and king-safety clashes.',
  },
  {
    id: 'kasparov-immortal',
    title: 'Kasparov vs Topalov (Wijk aan Zee 1999)',
    subtitle: 'Rook Sacrifice Crossroads · White to move',
    eco: 'B07',
    fen: 'b2r3r/k3qp1p/p1np1np1/2p1p3/4P3/P1NPBN1P/1PP1QPP1/3RR1K1 w - - 0 18',
    description: 'Dynamic central tension where piece activity and king attack outweigh static material.',
  },
  {
    id: 'greek-gift',
    title: 'Classical Bxh7+ Greek Gift Sacrifice',
    subtitle: 'King Attack · White to move',
    eco: 'C02',
    fen: 'r1bq1rk1/ppp2ppp/2n1pn2/3pP3/3P4/2PB1N2/PP3PPP/RNBQK2R w KQ - 1 8',
    description: 'Classic kingside bishop sacrifice pattern exposing the castled king.',
  },
  {
    id: 'outpost-mastery',
    title: 'Boleslavsky Hole & d5 Outpost',
    subtitle: 'Positional Squeeze · White to move',
    eco: 'B33',
    fen: 'r2qk2r/ppp2ppp/2np1n2/3Np3/4P3/8/PPPP1PPP/R1BQKBNR w KQkq - 0 6',
    description: 'Demonstrates Chess0 v3 outpost evaluation on d5 supported by the e4 pawn.',
  },
  {
    id: 'lucena-bridge',
    title: 'Lucena Endgame Position',
    subtitle: 'Rook + Pawn vs Rook · White to move',
    eco: 'END',
    fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1',
    description: 'Fundamental winning rook endgame technique ("building a bridge").',
  },
  {
    id: 'passed-race',
    title: 'Outside Passed Pawn Race',
    subtitle: 'Endgame Calculation · White to move',
    eco: 'END',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    description: 'Deep horizon calculation involving passed pawns, checks, and king escort.',
  },
];

let bookMap: Map<string, RawBookEntry[]> | null = null;
let positionOpeningMap: Map<string, { eco: string; name: string }> | null = null;

function posKey(pos: Position): string {
  return `${pos.hashLo}:${pos.hashHi}`;
}

function ensureBookBuilt(): Map<string, RawBookEntry[]> {
  if (bookMap !== null) return bookMap;
  bookMap = new Map<string, RawBookEntry[]>();
  positionOpeningMap = new Map<string, { eco: string; name: string }>();
  const pos = newStartPosition();

  for (const line of OPENING_REPERTOIRE) {
    const ucis = line.moves.trim().split(/\s+/);
    const scratch = pos.clone();
    for (let ply = 0; ply < ucis.length; ply++) {
      const uci = ucis[ply];
      const key = posKey(scratch);
      const legals = legalMoves(scratch);
      let matched = 0;
      for (let i = 0; i < legals.length; i++) {
        if (moveToUci(legals[i]) === uci) {
          matched = legals[i];
          break;
        }
      }
      if (matched === 0) break;

      const san = moveToSan(scratch, matched);
      let list = bookMap.get(key);
      if (!list) {
        list = [];
        bookMap.set(key, list);
      }
      const existing = list.find((e) => e.uci === uci);
      if (!existing) {
        list.push({
          uci,
          san,
          weight: line.weight,
          eco: line.eco,
          opening: line.name,
          w: line.w,
          d: line.d,
          b: line.b,
        });
      } else if (line.weight > existing.weight) {
        existing.weight = line.weight;
        existing.eco = line.eco;
        existing.opening = line.name;
        existing.w = line.w;
        existing.d = line.d;
        existing.b = line.b;
      }

      makeMove(scratch, matched);
      positionOpeningMap.set(posKey(scratch), { eco: line.eco, name: line.name });
    }
  }

  return bookMap;
}

/**
 * Returns legal book candidate moves for `pos`, sorted by descending weight.
 */
export function probeBookV3(pos: Position): BookCandidate[] {
  if (pos.fullmove > 16) return [];
  const map = ensureBookBuilt();
  const entries = map.get(posKey(pos));
  if (!entries || entries.length === 0) return [];

  const legals = legalMoves(pos);
  const out: BookCandidate[] = [];
  for (const e of entries) {
    for (let i = 0; i < legals.length; i++) {
      if (moveToUci(legals[i]) === e.uci) {
        out.push({
          move: legals[i],
          uci: e.uci,
          san: e.san,
          weight: e.weight,
          eco: e.eco,
          opening: e.opening,
          whiteWinPct: e.w,
          drawPct: e.d,
          blackWinPct: e.b,
        });
        break;
      }
    }
  }
  out.sort((a, b) => b.weight - a.weight);
  return out;
}

const PREFIX_OPENINGS: [string, string, string][] = [
  ['e2e4 e7e5 g1f3 b8c6 f1b5', 'C60', 'Ruy Lopez (Spanish Game)'],
  ['e2e4 e7e5 g1f3 b8c6 f1c4', 'C50', 'Italian Game'],
  ['e2e4 e7e5 g1f3 b8c6 d2d4', 'C44', 'Scotch Game'],
  ['e2e4 e7e5 g1f3 g8f6', 'C42', "Petrov's Defense"],
  ['e2e4 e7e5 f2f4', 'C30', "King's Gambit"],
  ['e2e4 e7e5 b1c3', 'C25', 'Vienna Game'],
  ['e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6', 'B90', 'Sicilian Defense · Najdorf'],
  ['e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 g7g6', 'B70', 'Sicilian Defense · Dragon'],
  ['e2e4 c7c5 g1f3 b8c6 d2d4', 'B32', 'Sicilian Defense · Open'],
  ['e2e4 c7c5 c2c3', 'B22', 'Sicilian Defense · Alapin'],
  ['e2e4 c7c5', 'B20', 'Sicilian Defense'],
  ['e2e4 e7e6 d2d4 d7d5', 'C01', 'French Defense'],
  ['e2e4 e7e6', 'C00', 'French Defense'],
  ['e2e4 c7c6 d2d4 d7d5', 'B12', 'Caro-Kann Defense'],
  ['e2e4 c7c6', 'B10', 'Caro-Kann Defense'],
  ['e2e4 d7d5', 'B01', 'Scandinavian Defense'],
  ['e2e4 d7d6', 'B07', 'Pirc Defense'],
  ['e2e4 g8f6', 'B02', "Alekhine's Defense"],
  ['d2d4 d7d5 c2c4 e7e6', 'D30', "Queen's Gambit Declined"],
  ['d2d4 d7d5 c2c4 c7c6', 'D10', 'Slav Defense'],
  ['d2d4 d7d5 c2c4 d5c4', 'D20', "Queen's Gambit Accepted"],
  ['d2d4 d7d5 c2c4', 'D06', "Queen's Gambit"],
  ['d2d4 d7d5 c1f4', 'D00', 'London System'],
  ['d2d4 g8f6 c2c4 e7e6 b1c3 f8b4', 'E20', 'Nimzo-Indian Defense'],
  ['d2d4 g8f6 c2c4 e7e6 g1f3 b7b6', 'E12', "Queen's Indian Defense"],
  ['d2d4 g8f6 c2c4 e7e6 g2g3', 'E00', 'Catalan Opening'],
  ['d2d4 g8f6 c2c4 g7g6 b1c3 d7d5', 'D80', 'Grünfeld Defense'],
  ['d2d4 g8f6 c2c4 g7g6', 'E60', "King's Indian Defense"],
  ['d2d4 g8f6 c2c4 c7c5', 'A56', 'Benoni Defense'],
  ['d2d4 f7f5', 'A80', 'Dutch Defense'],
  ['c2c4 e7e5', 'A20', 'English Opening · Reversed Sicilian'],
  ['c2c4 c7c5', 'A30', 'English Opening · Symmetrical'],
  ['c2c4', 'A10', 'English Opening'],
  ['g1f3 d7d5', 'A06', 'Réti Opening'],
  ['g1f3', 'A04', 'Zukertort / Réti Opening'],
  ['e2e4', 'B00', "King's Pawn Opening"],
  ['d2d4', 'D00', "Queen's Pawn Opening"],
];

/**
 * Identifies the ECO code and opening name for the current position / move history.
 */
export function detectOpening(pos: Position, historyUci: string[]): { eco: string; name: string } {
  ensureBookBuilt();
  const exact = positionOpeningMap?.get(posKey(pos));
  if (exact) return exact;

  const joined = historyUci.join(' ');
  let bestMatch: { eco: string; name: string } | null = null;
  let bestLen = 0;

  for (const line of OPENING_REPERTOIRE) {
    const ucis = line.moves.trim().split(/\s+/);
    let prefix = '';
    for (let i = 0; i < Math.min(ucis.length, historyUci.length); i++) {
      prefix = i === 0 ? ucis[0] : `${prefix} ${ucis[i]}`;
      if (joined.startsWith(prefix) && i + 1 > bestLen) {
        bestLen = i + 1;
        bestMatch = { eco: line.eco, name: line.name };
      }
    }
  }
  if (bestMatch && bestLen >= 3) return bestMatch;

  for (const [pref, eco, name] of PREFIX_OPENINGS) {
    if (joined.startsWith(pref)) {
      return { eco, name };
    }
  }

  return { eco: 'A00', name: historyUci.length === 0 ? 'Starting Position' : 'Custom / Unorthodox Position' };
}
