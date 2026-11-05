import { useMemo, useState } from 'react';
import type { ChessPuzzle, PuzzleTheme } from '../engine/puzzles';
import { ALL_PUZZLE_THEMES, PUZZLE_LIBRARY } from '../engine/puzzles';

interface PuzzleTrainerProps {
  activePuzzle: ChessPuzzle;
  puzzleStepIndex: number;
  puzzleStatus: 'solving' | 'correct_step' | 'solved' | 'failed';
  puzzleShowHint: boolean;
  puzzleHintLevel?: 0 | 1 | 2;
  puzzleRating: number;
  puzzleStreak: number;
  solvedPuzzleIds: string[];
  onStartPuzzle: (puzzle: ChessPuzzle) => void;
  onNextPuzzle: () => void;
  onRetryPuzzle: () => void;
  onRevealHint: (forceArrow?: boolean) => void;
}

type RatingBracket = 'all' | 'beginner' | 'intermediate' | 'advanced' | 'master';
type PuzzleViewTab = 'solve' | 'catalog';

export function PuzzleTrainer({
  activePuzzle,
  puzzleStepIndex,
  puzzleStatus,
  puzzleShowHint,
  puzzleHintLevel = 0,
  puzzleRating,
  puzzleStreak,
  solvedPuzzleIds,
  onStartPuzzle,
  onNextPuzzle,
  onRetryPuzzle,
  onRevealHint,
}: PuzzleTrainerProps) {
  const [viewTab, setViewTab] = useState<PuzzleViewTab>('solve');
  const [selectedTheme, setSelectedTheme] = useState<PuzzleTheme | 'all'>('all');
  const [ratingBracket, setRatingBracket] = useState<RatingBracket>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const totalUserMoves = Math.ceil(activePuzzle.solutionUci.length / 2);
  const completedUserMoves =
    puzzleStatus === 'solved' ? totalUserMoves : Math.floor(puzzleStepIndex / 2);

  const filteredPuzzles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return PUZZLE_LIBRARY.filter((p) => {
      if (selectedTheme !== 'all' && p.theme !== selectedTheme) return false;
      if (ratingBracket === 'beginner' && p.rating >= 1100) return false;
      if (ratingBracket === 'intermediate' && (p.rating < 1100 || p.rating >= 1500))
        return false;
      if (ratingBracket === 'advanced' && (p.rating < 1500 || p.rating >= 1850))
        return false;
      if (ratingBracket === 'master' && p.rating < 1850) return false;
      if (
        q &&
        !p.title.toLowerCase().includes(q) &&
        !p.theme.toLowerCase().includes(q) &&
        !p.id.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [selectedTheme, ratingBracket, searchQuery]);

  const pickRandomFiltered = () => {
    const pool = filteredPuzzles.length > 0 ? filteredPuzzles : PUZZLE_LIBRARY;
    const unsolved = pool.filter((p) => !solvedPuzzleIds.includes(p.id));
    const source = unsolved.length > 0 ? unsolved : pool;
    const chosen = source[Math.floor(Math.random() * source.length)];
    if (chosen) {
      onStartPuzzle(chosen);
      setViewTab('solve');
    }
  };

  // Only reveal the tactical theme once solved, failed, or hint requested so it doesn't spoil the puzzle!
  const showThemeName = puzzleStatus === 'solved' || puzzleStatus === 'failed' || puzzleShowHint;

  return (
    <div className="space-y-3">
      {/* Sub-navigation: active puzzle vs catalog */}
      <div className="flex items-center justify-between gap-2">
        <div className="seg grid flex-1 grid-cols-2">
          <button
            type="button"
            onClick={() => setViewTab('solve')}
            className={`seg-btn py-1.5 ${viewTab === 'solve' ? 'seg-btn-active' : ''}`}
          >
            Solve Puzzle
          </button>
          <button
            type="button"
            onClick={() => setViewTab('catalog')}
            className={`seg-btn py-1.5 ${viewTab === 'catalog' ? 'seg-btn-active' : ''}`}
          >
            Catalog ({PUZZLE_LIBRARY.length})
          </button>
        </div>
      </div>

      {/* Rating & streak telemetry bar */}
      <div className="panel-sunken grid grid-cols-3 gap-2 p-2.5 text-center">
        <div>
          <div className="micro-label">Your Rating</div>
          <div className="mt-0.5 font-mono text-base font-black tabular-nums text-accent-text">
            {puzzleRating}
          </div>
        </div>
        <div className="border-x border-line">
          <div className="micro-label">Win Streak</div>
          <div className="mt-0.5 font-mono text-base font-black tabular-nums text-amber-500">
            🔥 {puzzleStreak}
          </div>
        </div>
        <div>
          <div className="micro-label">Solved</div>
          <div className="mt-0.5 font-mono text-base font-black tabular-nums text-ink">
            {solvedPuzzleIds.length}
            <span className="text-xs font-normal text-ink-3">/{PUZZLE_LIBRARY.length}</span>
          </div>
        </div>
      </div>

      {viewTab === 'solve' ? (
        <div className="space-y-3">
          {/* Turn to move banner */}
          <div className="panel flex items-center justify-between p-3">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg font-bold shadow-card ring-1 ${
                  activePuzzle.sideToSolve === 'white'
                    ? 'bg-[#ebecd0] text-[#302e2b] ring-black/15'
                    : 'bg-[#1f1e1b] text-[#ebecd0] ring-white/20'
                }`}
              >
                {activePuzzle.sideToSolve === 'white' ? '♔' : '♚'}
              </span>
              <div>
                <div className="text-sm font-black capitalize text-ink">
                  {activePuzzle.sideToSolve} to Move
                </div>
                <div className="text-2xs font-medium text-ink-3">
                  Puzzle #{activePuzzle.id.replace('puz-', '')} · Rated {activePuzzle.rating} Elo
                </div>
              </div>
            </div>

            <div className="text-right">
              <span className="inline-block rounded-md bg-sunken px-2 py-1 font-mono text-2xs font-bold text-ink-2">
                Move { Math.min(completedUserMoves + 1, totalUserMoves) } of {totalUserMoves}
              </span>
            </div>
          </div>

          {/* Puzzle progress & feedback box */}
          {puzzleStatus === 'solving' && (
            <div className="panel-sunken space-y-2.5 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-ink-2">
                  Find the best tactical continuation on the board.
                </span>
                <span className="rounded border border-line bg-surface px-2 py-0.5 text-2xs font-bold text-ink-3">
                  {showThemeName ? activePuzzle.theme : 'Theme Hidden'}
                </span>
              </div>

              {/* Progressive hint box (only shown if user explicitly asked for a hint) */}
              {puzzleHintLevel >= 1 && (
                <div className="rounded-lg border border-accent/40 bg-accent/10 p-2.5 text-xs text-ink">
                  <div className="font-extrabold text-accent-text">
                    💡 Coach Hint ({activePuzzle.theme}):
                  </div>
                  <p className="mt-0.5 leading-relaxed">{activePuzzle.hint}</p>
                  {puzzleHintLevel === 1 && (
                    <p className="mt-1 text-2xs opacity-80">
                      The piece you should move is highlighted in green on the board.
                    </p>
                  )}
                </div>
              )}

              {/* Bottom puzzle buttons: hint (stage 1 -> stage 2) & skip */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                {puzzleHintLevel === 0 ? (
                  <button
                    type="button"
                    onClick={() => onRevealHint(false)}
                    className="btn-quiet flex items-center justify-center gap-1.5 py-2.5 text-xs"
                  >
                    <span>💡</span>
                    <span>Hint</span>
                  </button>
                ) : puzzleHintLevel === 1 ? (
                  <button
                    type="button"
                    onClick={() => onRevealHint(true)}
                    className="flex items-center justify-center gap-1.5 rounded-md bg-amber-500/20 py-2.5 text-xs font-extrabold text-amber-700 ring-1 ring-amber-500/40 transition hover:bg-amber-500/30 dark:text-amber-300"
                  >
                    <span>🎯</span>
                    <span>Show Move Arrow</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="flex items-center justify-center gap-1.5 rounded-md border border-line bg-sunken py-2.5 text-xs font-bold text-ink-3"
                  >
                    <span>✓</span>
                    <span>Arrow Shown</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={onNextPuzzle}
                  className="btn-quiet flex items-center justify-center gap-1.5 py-2.5 text-xs"
                >
                  <span>Next Puzzle</span>
                </button>
              </div>
            </div>
          )}

          {puzzleStatus === 'correct_step' && (
            <div className="rounded-lg border border-accent/50 bg-accent/15 p-3 text-xs font-extrabold text-accent-text">
              ✓ Best move! Opponent is responding — find the follow-up move…
            </div>
          )}

          {puzzleStatus === 'solved' && (
            <div className="space-y-3 rounded-lg border border-accent/50 bg-accent/15 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-black text-accent-text">
                    ★ Correct! Puzzle Solved ({puzzleShowHint ? '+6' : '+16'})
                  </div>
                  <div className="mt-0.5 text-2xs font-bold text-ink-2">
                    Theme: {activePuzzle.theme} · {activePuzzle.title}
                  </div>
                </div>
              </div>

              <p className="text-xs leading-relaxed text-ink">{activePuzzle.explanation}</p>

              <div className="grid grid-cols-[auto_1fr] gap-2 pt-1">
                <button
                  type="button"
                  onClick={onRetryPuzzle}
                  className="btn-quiet px-3 py-2.5 text-xs"
                >
                  ↺ Retry
                </button>
                <button
                  type="button"
                  onClick={onNextPuzzle}
                  className="btn-primary py-2.5 text-xs font-black"
                >
                  Next Puzzle
                </button>
              </div>
            </div>
          )}

          {puzzleStatus === 'failed' && (
            <div className="space-y-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3">
              <div className="text-sm font-black text-rose-600 dark:text-rose-400">
                ✗ Incorrect Move (-12)
              </div>
              <p className="text-xs text-ink-2">
                There is a stronger tactical strike in this position. Try again or ask Coach Viktor for a hint!
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onRetryPuzzle}
                  className="btn-primary py-2 text-xs font-black"
                >
                  ↺ Try Again
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onRetryPuzzle();
                    window.setTimeout(() => onRevealHint(true), 80);
                  }}
                  className="btn-quiet py-2 text-xs"
                >
                  🎯 Show Solution
                </button>
              </div>
            </div>
          )}

          {/* Quick theme jump pills */}
          <div className="pt-1">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="micro-label">Train by Tactical Motif</span>
              <button
                type="button"
                onClick={pickRandomFiltered}
                className="text-2xs font-bold text-accent-text hover:underline"
              >
                🎲 Random Unsolved
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {ALL_PUZZLE_THEMES.slice(0, 6).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  onClick={() => {
                    const match = PUZZLE_LIBRARY.find(
                      (p) => p.theme === theme && !solvedPuzzleIds.includes(p.id),
                    );
                    if (match) onStartPuzzle(match);
                  }}
                  className={`rounded-md px-2 py-1 text-2xs font-semibold transition ${
                    showThemeName && activePuzzle.theme === theme
                      ? 'bg-accent/15 text-accent-text ring-1 ring-accent/40'
                      : 'border border-line bg-sunken text-ink-2 hover:bg-raised-hover'
                  }`}
                >
                  {theme}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Browse puzzle catalog view */
        <div className="space-y-2.5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select
              aria-label="Filter puzzles by tactical theme"
              value={selectedTheme}
              onChange={(e) => setSelectedTheme(e.target.value as PuzzleTheme | 'all')}
              className="field"
            >
              <option value="all">All {ALL_PUZZLE_THEMES.length} Themes ({PUZZLE_LIBRARY.length})</option>
              {ALL_PUZZLE_THEMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter puzzles by Elo rating bracket"
              value={ratingBracket}
              onChange={(e) => setRatingBracket(e.target.value as RatingBracket)}
              className="field"
            >
              <option value="all">All Ratings (600 – 2650)</option>
              <option value="beginner">Beginner (&lt; 1100)</option>
              <option value="intermediate">Intermediate (1100 – 1499)</option>
              <option value="advanced">Advanced (1500 – 1849)</option>
              <option value="master">Master (1850+)</option>
            </select>
          </div>

          <div className="flex gap-2">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${PUZZLE_LIBRARY.length} puzzles by #number or motif…`}
              className="field min-w-0 flex-1"
            />
            <button
              type="button"
              onClick={pickRandomFiltered}
              className="btn-primary shrink-0 px-3 py-1.5 text-xs"
            >
              🎲 Random
            </button>
          </div>

          <div className="scroll-thin max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {filteredPuzzles.slice(0, 100).map((puz) => {
              const isCurrent = puz.id === activePuzzle.id;
              const isDone = solvedPuzzleIds.includes(puz.id);
              return (
                <button
                  key={puz.id}
                  type="button"
                  onClick={() => {
                    onStartPuzzle(puz);
                    setViewTab('solve');
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition ${
                    isCurrent
                      ? 'border-accent bg-accent/15'
                      : 'border-line bg-sunken hover:border-line-strong'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {isDone && (
                        <span className="font-mono text-xs font-black text-accent-text">✓</span>
                      )}
                      <span className="truncate text-xs font-bold text-ink">{puz.title}</span>
                    </div>
                    <div className="text-2xs text-ink-3">
                      {puz.theme} · {puz.sideToSolve} to move
                    </div>
                  </div>
                  <span className="shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-ink-2">
                    {puz.rating}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
