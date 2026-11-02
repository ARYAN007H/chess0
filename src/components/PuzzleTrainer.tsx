import type { ChessPuzzle } from '../engine/puzzles';
import { PUZZLE_LIBRARY } from '../engine/puzzles';

interface PuzzleTrainerProps {
  activePuzzle: ChessPuzzle;
  puzzleStepIndex: number;
  puzzleStatus: 'solving' | 'correct_step' | 'solved' | 'failed';
  puzzleShowHint: boolean;
  puzzleRating: number;
  puzzleStreak: number;
  solvedPuzzleIds: string[];
  onStartPuzzle: (puzzle: ChessPuzzle) => void;
  onNextPuzzle: () => void;
  onRetryPuzzle: () => void;
  onRevealHint: () => void;
}

export function PuzzleTrainer({
  activePuzzle,
  puzzleStepIndex,
  puzzleStatus,
  puzzleShowHint,
  puzzleRating,
  puzzleStreak,
  solvedPuzzleIds,
  onStartPuzzle,
  onNextPuzzle,
  onRetryPuzzle,
  onRevealHint,
}: PuzzleTrainerProps) {
  const totalUserMoves = Math.ceil(activePuzzle.solutionUci.length / 2);
  const completedUserMoves =
    puzzleStatus === 'solved' ? totalUserMoves : Math.floor(puzzleStepIndex / 2);

  return (
    <div className="space-y-3.5 rounded-xl border border-stone-200/90 bg-white/85 p-3.5 dark:border-slate-800 dark:bg-slate-900/60">
      {/* Rating & Streak Header */}
      <div className="flex items-center justify-between border-b border-stone-200/80 pb-2.5 dark:border-slate-800">
        <div>
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
            Tactical Puzzle Trainer
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Solved {solvedPuzzleIds.length}/{PUZZLE_LIBRARY.length} puzzles
          </p>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs">
          <div>
            <span className="text-slate-400">Rating </span>
            <strong className="font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">
              {puzzleRating}
            </strong>
          </div>
          <span className="text-slate-300 dark:text-slate-700">·</span>
          <div>
            <span className="text-slate-400">Streak </span>
            <strong className="font-extrabold tabular-nums text-amber-600 dark:text-amber-400">
              {puzzleStreak}
            </strong>
          </div>
        </div>
      </div>

      {/* Active Puzzle Card */}
      <div className="rounded-lg border border-stone-200/80 bg-stone-50/80 p-3 dark:border-slate-800 dark:bg-slate-800/45">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-extrabold text-slate-900 dark:text-white">
              {activePuzzle.title}
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Theme: {activePuzzle.theme} · Puzzle Rating {activePuzzle.rating} · Step{' '}
              {completedUserMoves}/{totalUserMoves}
            </div>
          </div>
          <span className="shrink-0 font-mono text-xs font-bold capitalize text-emerald-600 dark:text-emerald-400">
            {activePuzzle.sideToSolve} to move
          </span>
        </div>

        {/* Dynamic Status Prompt */}
        <div className="mt-3">
          {puzzleStatus === 'solving' && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900">
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                Find the winning tactical continuation on the board!
              </span>
              <button
                type="button"
                onClick={onRevealHint}
                className="shrink-0 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-300"
              >
                💡 Hint &amp; Arrow
              </button>
            </div>
          )}

          {puzzleStatus === 'correct_step' && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-800 dark:text-emerald-300">
              ✓ Strong move! Opponent is responding — find the follow-up…
            </div>
          )}

          {puzzleStatus === 'solved' && (
            <div className="space-y-2 rounded-lg border border-emerald-500/50 bg-emerald-500/15 p-3 dark:border-emerald-500/40 dark:bg-emerald-500/15">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-emerald-800 dark:text-emerald-200">
                  ★ Puzzle Solved! ({puzzleShowHint ? '+6' : '+16'} Rating)
                </span>
                <button
                  type="button"
                  onClick={onNextPuzzle}
                  className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white transition hover:bg-emerald-500"
                >
                  Next Puzzle →
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-700 dark:text-slate-200">
                {activePuzzle.explanation}
              </p>
            </div>
          )}

          {puzzleStatus === 'failed' && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs">
              <span className="font-bold text-rose-700 dark:text-rose-300">
                ✗ That wasn’t the strongest tactical shot.
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onRetryPuzzle}
                  className="rounded-md bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-rose-500"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onRetryPuzzle();
                    window.setTimeout(() => onRevealHint(), 80);
                  }}
                  className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  Show Hint
                </button>
              </div>
            </div>
          )}

          {puzzleShowHint && puzzleStatus !== 'solved' && (
            <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-200">
              <strong>Coach Hint:</strong> {activePuzzle.hint}
            </div>
          )}
        </div>
      </div>

      {/* Curated Puzzle Browser */}
      <div>
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Select Tactical Challenge
        </div>
        <div className="scroll-thin max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {PUZZLE_LIBRARY.map((puz) => {
            const isCurrent = puz.id === activePuzzle.id;
            const isDone = solvedPuzzleIds.includes(puz.id);
            return (
              <button
                key={puz.id}
                type="button"
                onClick={() => onStartPuzzle(puz)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition ${
                  isCurrent
                    ? 'border-emerald-500 bg-emerald-500/10 dark:border-emerald-500/60'
                    : 'border-stone-200/80 bg-white hover:border-stone-300 dark:border-slate-800 dark:bg-slate-800/40'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {isDone && (
                      <span className="font-mono text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
                        ✓
                      </span>
                    )}
                    <span className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">
                      {puz.title}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {puz.theme} · {puz.sideToSolve} to move
                  </div>
                </div>
                <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-slate-600 dark:text-slate-300">
                  {puz.rating}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
