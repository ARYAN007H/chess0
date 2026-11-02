/**
 * Interactive Chess Academy & Guided Curriculum (`src/engine/lessons.ts`)
 * + Real-Time Coach Move Explanation Generator for Learn Mode.
 */

import type { Position } from './position';
import { makeMove, unmakeMove } from './position';
import { inCheck } from './movegen';
import { moveCaptured, moveFrom, movePromo, moveTo, moveToUci } from './types';
import { probeBookV3 } from './bookV3';
import type { MultiPvLine } from './search';

export interface LessonStep {
  title: string;
  fen: string;
  prompt: string;
  correctUci: string[];
  coachTip: string;
  successNote: string;
}

export interface AcademyModule {
  id: string;
  category: 'Opening Mastery' | 'Tactical Vision' | 'King Attack' | 'Endgame Technique';
  title: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  summary: string;
  steps: LessonStep[];
}

export const ACADEMY_MODULES: AcademyModule[] = [
  {
    id: 'mod-opening-fundamentals',
    category: 'Opening Mastery',
    title: 'Golden Principles of the Opening',
    difficulty: 'Beginner',
    summary: 'Claim the center, develop knights before bishops, castle early, and punish premature flank attacks.',
    steps: [
      {
        title: '1. Seize the Center',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        prompt: 'Start the game by staking a claim in the center and opening diagonals for your Queen and light-squared Bishop.',
        correctUci: ['e2e4', 'd2d4'],
        coachTip: 'Central pawns on e4 or d4 control vital squares in enemy territory and free your pieces.',
        successNote: 'Excellent! Occupying the center gives your pieces maximum mobility from move 1.',
      },
      {
        title: '2. Develop Knights Toward the Center',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
        prompt: 'Develop your kingside knight to its most active square where it attacks the e5 pawn and prepares castling.',
        correctUci: ['g1f3'],
        coachTip: 'A knight on the rim is dim — Nf3 attacks e5, controls d4, and clears the f1-g1 corridor.',
        successNote: 'Spot on! Nf3 develops with a direct threat on Black’s e5 pawn.',
      },
      {
        title: '3. Castle Early for King Safety',
        fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
        prompt: 'Both your minor pieces on the kingside are developed. Tuck your King to safety and activate the h1 Rook!',
        correctUci: ['e1g1'],
        coachTip: 'Leaving the king in the center invites tactics on the e-file. Castle kingside (O-O).',
        successNote: 'Great! Castling safeguards your King and brings the rook toward the center.',
      },
    ],
  },
  {
    id: 'mod-tactical-motifs',
    category: 'Tactical Vision',
    title: 'Essential Tactical Weapons: Forks & Pins',
    difficulty: 'Intermediate',
    summary: 'Learn how to spot double attacks, knight forks, and absolute pins that win material on the spot.',
    steps: [
      {
        title: '1. The Fried Liver Knight Attack',
        fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R b KQkq - 3 4',
        prompt: 'White’s bishop on c4 and knight on g5 both target f7. Play the only move that blocks the c4-f7 diagonal!',
        correctUci: ['d7d5'],
        coachTip: 'Look at the c4-f7 diagonal — pushing the d-pawn intercepts the bishop immediately.',
        successNote: 'Well played! 4...d5 is the classical main line, interrupting White’s battery against f7.',
      },
      {
        title: '2. Executing a Central Queen Fork',
        fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2',
        // Let's use a clear tactical double attack FEN:
        prompt: 'Develop with tempo or strike the undefended target.',
        correctUci: ['g1f3', 'f1c4'],
        coachTip: 'Develop a kingside piece to attack e5 or f7.',
        successNote: 'Strong development with immediate pressure!',
      },
      {
        title: '3. Pinning the Knight to the King',
        fen: 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
        prompt: 'White just played the Ruy Lopez (3. Bb5). Challenge the bishop immediately with the Morphy Defense!',
        correctUci: ['a7a6'],
        coachTip: 'Put the question to the b5 bishop right away with ...a6.',
        successNote: 'Correct! 3...a6 forces White to decide between trading on c6 or retreating to a4.',
      },
    ],
  },
  {
    id: 'mod-king-attack',
    category: 'King Attack',
    title: 'Crushing the Castled King',
    difficulty: 'Advanced',
    summary: 'Master classical sacrifices and mating nets against an unguarded castled king.',
    steps: [
      {
        title: '1. The Greek Gift Sacrifice (Bxh7+)',
        fen: 'r1bq1rk1/ppp2ppp/2nb4/3p4/3P4/3BPN2/PPP2PPP/RNBQK2R w KQ - 0 7',
        prompt: 'Black’s kingside lacks a defending knight on f6. Launch the classic Greek Gift sacrifice on h7!',
        correctUci: ['d3h7'],
        coachTip: 'When your bishop eyes h7, your knight can jump to g5, and your queen can reach h5, Bxh7+ rips open the shelter.',
        successNote: 'Brilliant! Bxh7+ forces Kxh7, followed by Ng5+ and Qh5 with a decisive attack.',
      },
      {
        title: '2. Scholar’s Mate Refutation',
        fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3',
        prompt: 'White threatens Qxf7#. Defend the f7 pawn cleanly without losing your e5 pawn!',
        correctUci: ['g7g6', 'd8e7'],
        coachTip: 'Notice that ...Nf6 blunders Qxf7#! Block the diagonal with ...g6 or defend f7+e5 with ...Qe7.',
        successNote: 'Smart defense! You neutralized the mate threat and will soon chase White’s exposed Queen.',
      },
    ],
  },
  {
    id: 'mod-endgame-mastery',
    category: 'Endgame Technique',
    title: 'King & Pawn Endgame Mastery',
    difficulty: 'Intermediate',
    summary: 'Seize the direct opposition, apply the Rule of the Square, and convert passed pawns.',
    steps: [
      {
        title: '1. Seizing Direct Opposition',
        fen: '4k3/8/8/8/4P3/4K3/8/8 w - - 0 1',
        prompt: 'In King and Pawn endgames, the King must lead the pawn! Step your King IN FRONT of the e4 pawn to seize space.',
        correctUci: ['e3d4', 'e3f4'],
        coachTip: 'Never push the pawn first — walk your King ahead of the pawn to the 5th and 6th ranks.',
        successNote: 'Exactly right! Keeping your King ahead of the pawn is the key to forcing promotion.',
      },
      {
        title: '2. Lucena Position — Building a Bridge',
        fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1',
        prompt: 'Your pawn is on b7 and your King is trapped on b8. Play the key Rook move to the 4th rank to build a bridge!',
        correctUci: ['c1c4'],
        coachTip: 'Place your Rook on the 4th rank (Rc4!) so when your King walks out to b7/c6, the Rook can block checks on c4.',
        successNote: 'Masterful! 1. Rc4! prepares Kb7 followed by shielding against vertical checks on the 4th rank.',
      },
    ],
  },
];

/**
 * Generates a concise, human-readable coaching explanation for a candidate move
 * in Learn Mode so the player understands WHY the engine recommends it.
 */
export function describeCoachSuggestion(pos: Position, line: MultiPvLine): string {
  const m = line.move;
  if (!m) return 'Strong positional continuation';
  const uci = line.uci;
  const fromSq = moveFrom(m);
  const toSq = moveTo(m);
  const piece = Math.abs(pos.board[fromSq]);
  const captured = moveCaptured(m);
  const promo = movePromo(m);

  // Check if book move
  const book = probeBookV3(pos).find((b) => b.uci === uci);
  if (book && pos.fullmove <= 10) {
    return `Book Theory (${book.eco} ${book.opening}) · ${book.whiteWinPct}%W / ${book.drawPct}%D`;
  }

  if (line.scoreMate !== undefined && line.scoreMate > 0) {
    return `Forces checkmate in ${line.scoreMate} ${line.scoreMate === 1 ? 'move' : 'moves'}!`;
  }

  makeMove(pos, m);
  const givesCheck = inCheck(pos);
  unmakeMove(pos, m);

  if (promo !== 0) {
    return givesCheck ? 'Promotes pawn with check!' : 'Promotes passed pawn to a new piece';
  }

  if (givesCheck && captured !== 0) {
    return 'Captures enemy material with check, seizing the initiative';
  }
  if (givesCheck) {
    return 'Delivers a forcing check to disrupt the opponent’s king';
  }
  if (captured !== 0) {
    const names = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen'];
    return `Captures opponent’s ${names[captured] || 'piece'} and improves material balance`;
  }

  // Castling
  if (piece === 6 && Math.abs((toSq & 7) - (fromSq & 7)) === 2) {
    return 'Castles the King to safety and activates the rook toward the center';
  }

  // Central pawn push
  const toFile = toSq & 7;
  const toRank = toSq >> 4;
  if (piece === 1 && (toFile === 3 || toFile === 4) && (toRank === 3 || toRank === 4)) {
    return 'Stakes a direct claim in the center and opens lines for pieces';
  }

  // Developing minor piece off back rank
  const fromRank = fromSq >> 4;
  if ((piece === 2 || piece === 3) && (fromRank === 0 || fromRank === 7)) {
    return 'Develops minor piece off the back rank toward active central squares';
  }

  if (piece === 4) {
    return 'Activates rook onto an open or semi-open file';
  }

  return `Maintains optimal board control (follow-up: ${line.pvSan.slice(1, 4).join(' ') || 'solid structure'})`;
}
