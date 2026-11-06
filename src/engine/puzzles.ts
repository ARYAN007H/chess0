/**
 * Puzzle catalog — 500 handcrafted tactical puzzles, engine-verified.
 *
 * Every puzzle in `src/engine/puzzleData/` is handcrafted with a forced,
 * unique solution, proven by scripts/verify-puzzles.ts. Positions are
 * individually composed; within some theme families several puzzles share a
 * structural skeleton and differ in the attacking route (flagged for
 * diversification as later batches land).
 * The strict verifier (`scripts/verify-puzzles.ts`) proves, using this repo's
 * own engine:
 *   - the FEN is fully legal,
 *   - the whole solution line is legal and ends in checkmate or a counted
 *     material gain,
 *   - the key move is the ONLY move that solves the puzzle (mate: exact DFS;
 *     material: decisive search margin),
 *   - every opponent reply in the stored line is the engine's best defense.
 *
 * Batch layout (50 puzzles per file):
 *   batch-01  Back-Rank Mate / Deflection
 *   batch-02  Mating Net
 *   batch-03  Mating Net / Smothered / Arabian / Greek Gift
 *   batch-04  Greek Gift / Queen Sacrifice / Interference
 *   batch-05  Royal Fork / Fork & Double Attack
 *   batch-06  Fork & Double Attack / Pin & Win / Skewer & X-Ray
 *   batch-07  Skewer & X-Ray / Discovered Attack / Deflection
 *   batch-08  Deflection / Overloading / Interference / Zwischenzug / Trapped
 *   batch-09  Trapped Piece / Promotion / Endgame Technique
 *   batch-10  Endgame Technique / Sacrificial Attack / Deflection
 */

export type PuzzleTheme =
  | 'Back-Rank Mate'
  | 'Mating Net'
  | 'Smothered Mate'
  | 'Arabian Mate'
  | 'Greek Gift'
  | 'Queen Sacrifice'
  | 'Royal Fork'
  | 'Fork & Double Attack'
  | 'Pin & Win'
  | 'Skewer & X-Ray'
  | 'Discovered Attack'
  | 'Deflection'
  | 'Overloading'
  | 'Interference'
  | 'Zwischenzug'
  | 'Trapped Piece'
  | 'Promotion Tactic'
  | 'Endgame Technique'
  | 'Sacrificial Attack';

export const ALL_PUZZLE_THEMES: PuzzleTheme[] = [
  'Back-Rank Mate',
  'Mating Net',
  'Smothered Mate',
  'Arabian Mate',
  'Greek Gift',
  'Queen Sacrifice',
  'Royal Fork',
  'Fork & Double Attack',
  'Pin & Win',
  'Skewer & X-Ray',
  'Discovered Attack',
  'Deflection',
  'Overloading',
  'Interference',
  'Zwischenzug',
  'Trapped Piece',
  'Promotion Tactic',
  'Endgame Technique',
  'Sacrificial Attack',
];

export interface ChessPuzzle {
  id: string;
  title: string;
  theme: PuzzleTheme;
  rating: number;
  sideToSolve: 'white' | 'black';
  initialFen: string;
  /** Optional opponent move played first (a blunder that creates the chance). */
  setupMoveUci?: string;
  /** Solver moves on even indices (0,2,…), forced opponent replies on odd. */
  solutionUci: string[];
  /** What the line must achieve — drives strict verification. */
  goal: 'mate' | 'material';
  /** Pawns of net material the solver gains by the end (material puzzles). */
  materialGain?: number;
  hint: string;
  explanation: string;
}

import { batch01 } from './puzzleData/batch-01';
import { batch02 } from './puzzleData/batch-02';
import { batch03 } from './puzzleData/batch-03';
import { batch04 } from './puzzleData/batch-04';
import { batch05 } from './puzzleData/batch-05';
import { batch06 } from './puzzleData/batch-06';
import { batch07 } from './puzzleData/batch-07';
import { batch08 } from './puzzleData/batch-08';
import { batch09 } from './puzzleData/batch-09';
import { batch10 } from './puzzleData/batch-10';

const BATCHES: ChessPuzzle[][] = [
  batch01,
  batch02,
  batch03,
  batch04,
  batch05,
  batch06,
  batch07,
  batch08,
  batch09,
  batch10,
];

function buildCatalog(): ChessPuzzle[] {
  const all = BATCHES.flat();
  // Learning curve: easy → hard. IDs stay the stable per-batch ids
  // (b01-01 … b10-50) so persisted player progress survives future batches
  // inserting into the rating order.
  return [...all].sort((a, b) => a.rating - b.rating);
}

export const PUZZLE_LIBRARY: ChessPuzzle[] = buildCatalog();
