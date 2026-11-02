/**
 * Clean-room Move Analysis, Classification & Game Review Engine.
 *
 * Classifies moves into Book, Brilliant, Great, Best, Excellent, Good,
 * Inaccuracy, Mistake, and Blunder using win-probability delta and
 * Multi-PV candidate comparison. Computes per-side 0-100% Accuracy scores.
 */

import { WHITE, moveCaptured, moveFrom, moveToUci } from './types';
import type { Position } from './position';
import { makeMove, unmakeMove } from './position';
import { evalV3WhitePov } from './evalV3';
import { probeBookV3 } from './bookV3';
import { see } from './see';
import { moveToSan } from './san';
import type { MultiPvLine } from './search';

export type MoveClassification =
  | 'book'
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder';

export interface ClassificationMeta {
  label: string;
  symbol: string;
  colorClass: string;
  badgeBg: string;
  description: string;
}

export const CLASSIFICATION_META: Record<MoveClassification, ClassificationMeta> = {
  book: {
    label: 'Book',
    symbol: '📖',
    colorClass: 'text-amber-700 dark:text-amber-300',
    badgeBg: '#a88865',
    description: 'Established Grandmaster opening theory move.',
  },
  brilliant: {
    label: 'Brilliant',
    symbol: '!!',
    colorClass: 'text-cyan-600 dark:text-cyan-300',
    badgeBg: '#1baca6',
    description: 'A sharp material sacrifice that seizes a winning advantage.',
  },
  great: {
    label: 'Great',
    symbol: '!',
    colorClass: 'text-sky-600 dark:text-sky-300',
    badgeBg: '#5c8bb0',
    description: 'Finds the critical only-move resource in a sharp position.',
  },
  best: {
    label: 'Best',
    symbol: '★',
    colorClass: 'text-emerald-600 dark:text-emerald-400',
    badgeBg: '#81b64c',
    description: 'Matches the top engine Multi-PV recommendation.',
  },
  excellent: {
    label: 'Excellent',
    symbol: '✓',
    colorClass: 'text-lime-600 dark:text-lime-400',
    badgeBg: '#96bc4b',
    description: 'Maintains virtually full winning probability.',
  },
  good: {
    label: 'Good',
    symbol: '○',
    colorClass: 'text-slate-600 dark:text-slate-300',
    badgeBg: '#6b7280',
    description: 'Solid positional continuation with minimal evaluation loss.',
  },
  inaccuracy: {
    label: 'Inaccuracy',
    symbol: '?!',
    colorClass: 'text-amber-600 dark:text-amber-400',
    badgeBg: '#f0c15c',
    description: 'Suboptimal move that concedes a noticeable positional edge.',
  },
  mistake: {
    label: 'Mistake',
    symbol: '?',
    colorClass: 'text-orange-600 dark:text-orange-400',
    badgeBg: '#e6912c',
    description: 'Serious error that significantly harms the evaluation.',
  },
  blunder: {
    label: 'Blunder',
    symbol: '??',
    colorClass: 'text-rose-600 dark:text-rose-400',
    badgeBg: '#ca3431',
    description: 'Critical oversight that loses material or the game.',
  },
};

export interface MoveAnalysisData {
  classification: MoveClassification;
  /** White-POV evaluation in centipawns after the move. */
  evalWhiteCp: number;
  /** Mate score from White's POV after the move, if applicable. */
  evalWhiteMate?: number;
  /** Centipawn loss from the mover's perspective (>= 0). */
  cpLoss: number;
  /** Win probability loss (0..100). */
  winProbLoss: number;
  /** Move accuracy (0..100). */
  moveAccuracy: number;
  /** Best move in SAN if a stronger move existed. */
  bestAlternativeSan?: string;
  bestAlternativeUci?: string;
  /** Top 3 engine candidate lines at the position before this move. */
  candidatesBefore?: MultiPvLine[];
}

/** Converts White-POV centipawns to White win probability (0..100). */
export function cpToWinProb(cp: number): number {
  const clamped = Math.max(-1500, Math.min(1500, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/** Converts a single move's win-probability loss into a 0..100 accuracy score. */
export function winProbLossToAccuracy(wpLoss: number): number {
  const loss = Math.max(0, wpLoss);
  const acc = 103.1668 * Math.exp(-0.04354 * loss) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

/**
 * Evaluates a move played on `posBefore` (before `move` is applied) and returns
 * its classification, accuracy, centipawn loss, and best alternative.
 */
export function analyzeMoveExecution(
  posBefore: Position,
  move: number,
  preCandidates?: MultiPvLine[],
  postWhiteCpOverride?: number,
  postWhiteMateOverride?: number,
): MoveAnalysisData {
  const mover = posBefore.stm; // 0 = White, 1 = Black
  const sign = mover === WHITE ? 1 : -1;
  const uci = moveToUci(move);

  // Check if move is in Grandmaster opening book
  const bookMoves = probeBookV3(posBefore);
  const isBookMove = bookMoves.some((b) => b.uci === uci);

  // Mover-POV evaluation before the move
  let bestBeforeMoverCp: number;
  let bestMoveUci = uci;
  let bestMoveSan = moveToSan(posBefore, move);
  let secondBestMoverCp: number | null = null;

  if (preCandidates && preCandidates.length > 0) {
    const top = preCandidates[0];
    bestMoveUci = top.uci;
    bestMoveSan = top.san;
    if (top.scoreMate !== undefined) {
      bestBeforeMoverCp = top.scoreMate > 0 ? 1200 : -1200;
    } else {
      bestBeforeMoverCp = top.scoreCp ?? evalV3WhitePov(posBefore) * sign;
    }
    if (preCandidates.length >= 2) {
      const sec = preCandidates[1];
      secondBestMoverCp =
        sec.scoreMate !== undefined
          ? sec.scoreMate > 0
            ? 1200
            : -1200
          : (sec.scoreCp ?? bestBeforeMoverCp - 30);
    }
  } else {
    bestBeforeMoverCp = evalV3WhitePov(posBefore) * sign;
  }

  // Compute evaluation after the move
  makeMove(posBefore, move);
  const staticWhiteAfter = evalV3WhitePov(posBefore);
  unmakeMove(posBefore, move);

  const whiteCpAfter = postWhiteCpOverride !== undefined ? postWhiteCpOverride : staticWhiteAfter;
  const afterMoverCp =
    postWhiteMateOverride !== undefined
      ? postWhiteMateOverride * sign > 0
        ? 1200
        : -1200
      : whiteCpAfter * sign;

  const isEngineBest = uci === bestMoveUci;
  const rawCpLoss = isEngineBest ? 0 : Math.max(0, bestBeforeMoverCp - afterMoverCp);

  const wpBefore = cpToWinProb(bestBeforeMoverCp);
  const wpAfter = cpToWinProb(afterMoverCp);
  const wpLoss = isEngineBest ? 0 : Math.max(0, wpBefore - wpAfter);
  const moveAccuracy = winProbLossToAccuracy(wpLoss);

  // Detect sacrifices / tactical brilliance
  const movingPiece = Math.abs(posBefore.board[moveFrom(move)]);
  const captured = moveCaptured(move);
  const seeScore = see(posBefore, move);
  const isSacrifice = movingPiece > 1 && seeScore < -80 && captured < movingPiece;

  let classification: MoveClassification;
  if (isBookMove && posBefore.fullmove <= 12) {
    classification = 'book';
  } else if (isSacrifice && (isEngineBest || rawCpLoss <= 18) && afterMoverCp >= 80) {
    classification = 'brilliant';
  } else if (
    (isEngineBest || rawCpLoss <= 12) &&
    secondBestMoverCp !== null &&
    bestBeforeMoverCp - secondBestMoverCp >= 95 &&
    afterMoverCp >= -50
  ) {
    classification = 'great';
  } else if (isEngineBest || wpLoss <= 1.8 || rawCpLoss <= 12) {
    classification = 'best';
  } else if (wpLoss <= 4.8 || rawCpLoss <= 30) {
    classification = 'excellent';
  } else if (wpLoss <= 9.0 || rawCpLoss <= 60) {
    classification = 'good';
  } else if (wpLoss <= 16.5 || rawCpLoss <= 115) {
    classification = 'inaccuracy';
  } else if (wpLoss <= 28.0 || rawCpLoss <= 220) {
    classification = 'mistake';
  } else {
    classification = 'blunder';
  }

  return {
    classification,
    evalWhiteCp: whiteCpAfter,
    evalWhiteMate: postWhiteMateOverride,
    cpLoss: Math.round(rawCpLoss),
    winProbLoss: Number(wpLoss.toFixed(1)),
    moveAccuracy: Number(moveAccuracy.toFixed(1)),
    bestAlternativeSan: !isEngineBest ? bestMoveSan : undefined,
    bestAlternativeUci: !isEngineBest ? bestMoveUci : undefined,
    candidatesBefore: preCandidates,
  };
}

export interface GameSummaryStats {
  whiteAccuracy: number | null;
  blackAccuracy: number | null;
  counts: {
    white: Record<MoveClassification, number>;
    black: Record<MoveClassification, number>;
  };
}

export function computeGameSummary(
  entries: { analysis?: MoveAnalysisData }[],
): GameSummaryStats {
  const emptyCounts = (): Record<MoveClassification, number> => ({
    book: 0,
    brilliant: 0,
    great: 0,
    best: 0,
    excellent: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
  });

  const counts = { white: emptyCounts(), black: emptyCounts() };
  let wAccSum = 0;
  let wCount = 0;
  let bAccSum = 0;
  let bCount = 0;

  for (let i = 0; i < entries.length; i++) {
    const a = entries[i].analysis;
    if (!a) continue;
    const isWhite = i % 2 === 0;
    if (isWhite) {
      counts.white[a.classification]++;
      wAccSum += a.moveAccuracy;
      wCount++;
    } else {
      counts.black[a.classification]++;
      bAccSum += a.moveAccuracy;
      bCount++;
    }
  }

  return {
    whiteAccuracy: wCount > 0 ? Number((wAccSum / wCount).toFixed(1)) : null,
    blackAccuracy: bCount > 0 ? Number((bAccSum / bCount).toFixed(1)) : null,
    counts,
  };
}
