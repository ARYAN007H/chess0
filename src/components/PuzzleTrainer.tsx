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
    <div className="space-y-3 p-3.5">
      {/* Sub-navigation: Active Puzzle vs 540 Catalog */}
      <div className="flex items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-2 gap-1 rounded-lg bg-stone-200/80 p-1 dark:bg-[#1f1e1b]">
          <button
            type="button"
            onClick={() => setViewTab('solve')}
            className={`rounded-md py-1.5 text-xs font-extrabold transition ${
              viewTab === 'solve'
                ? 'bg-white text-stone-900 shadow-xs dark:bg-[#302e2b] dark:text-white'
                : 'text-stone-600 hover:text-stone-900 dark:text-[#989795] dark:hover:text-white'
            }`}
          >
            Solve Puzzle
          </button>
          <button
            type="button"
            onClick={() => setViewTab('catalog')}
            className={`rounded-md py-1.5 text-xs font-extrabold transition ${
              viewTab === 'catalog'
                ? 'bg-white text-stone-900 shadow-xs dark:bg-[#302e2b] dark:text-white'
                : 'text-stone-600 hover:text-stone-900 dark:text-[#989795] dark:hover:text-white'
            }`}
          >
            Catalog ({PUZZLE_LIBRARY.length})
          </button>
        </div>
      </div>

      {/* Rating & Streak Telemetry Bar */}
      <div className="grid grid-cols-3 gap-2 rounded-xl bg-stone-100 p-2.5 text-center dark:bg-[#1f1e1b]">
        <div>
          <div className="text-[10px] font-bold tracking-wider text-stone-500 uppercase dark:text-[#989795]">
            Your Rating
          </div>
          <div className="mt-0.5 font-mono text-base font-black tabular-nums text-[#81b64c]">
            {puzzleRating}
          </div>
        </div>
        <div className="border-x border-stone-200/80 dark:border-white/10">
          <div className="text-[10px] font-bold tracking-wider text-stone-500 uppercase dark:text-[#989795]">
            Win Streak
          </div>
          <div className="mt-0.5 font-mono text-base font-black tabular-nums text-amber-500">
            🔥 {puzzleStreak}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold tracking-wider text-stone-500 uppercase dark:text-[#989795]">
            Solved
          </div>
          <div className="mt-0.5 font-mono text-base font-black tabular-nums text-stone-800 dark:text-white">
            {solvedPuzzleIds.length}
            <span className="text-xs font-normal text-stone-400">/{PUZZLE_LIBRARY.length}</span>
          </div>
        </div>
      </div>

      {viewTab === 'solve' ? (
        <div className="space-y-3">
          {/* Turn to Move Banner (Chess.com style) */}
          <div className="flex items-center justify-between rounded-xl border border-stone-200/90 bg-stone-50 p-3 dark:border-white/10 dark:bg-[#302e2b]">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg font-bold shadow-sm ring-1 ${
                  activePuzzle.sideToSolve === 'white'
                    ? 'bg-[#ebecd0] text-[#302e2b] ring-black/15'
                    : 'bg-[#1f1e1b] text-[#ebecd0] ring-white/20'
                }`}
              >
                {activePuzzle.sideToSolve === 'white' ? '♔' : '♚'}
              </span>
              <div>
                <div className="text-sm font-black capitalize text-stone-900 dark:text-white">
                  {activePuzzle.sideToSolve} to Move
                </div>
                <div className="text-[11px] font-medium text-stone-500 dark:text-[#989795]">
                  Puzzle #{activePuzzle.id.replace('puz-', '')} · Rated {activePuzzle.rating} Elo
                </div>
              </div>
            </div>

            <div className="text-right">
              <span className="inline-block rounded-md bg-stone-200/80 px-2 py-1 font-mono text-[11px] font-bold text-stone-700 dark:bg-[#1f1e1b] dark:text-[#bababa]">
                Move { Math.min(completedUserMoves + 1, totalUserMoves) } of {totalUserMoves}
              </span>
            </div>
          </div>

          {/* Puzzle Progress & Feedback Box */}
          {puzzleStatus === 'solving' && (
            <div className="space-y-2.5 rounded-xl border border-stone-200/90 bg-stone-50/70 p-3.5 dark:border-white/10 dark:bg-[#1f1e1b]/80">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-stone-700 dark:text-[#bababa]">
                  Find the best tactical continuation on the board.
                </span>
                <span className="rounded bg-stone-200/70 px-2 py-0.5 text-[10px] font-bold text-stone-600 dark:bg-[#302e2b] dark:text-[#989795]">
                  {showThemeName ? activePuzzle.theme : 'Theme Hidden'}
                </span>
              </div>

              {/* Progressive Hint Box (Only shown if user explicitly asked for Hint!) */}
              {puzzleHintLevel >= 1 && (
                <div className="rounded-lg border border-[#81b64c]/40 bg-[#81b64c]/10 p-2.5 text-xs text-stone-800 dark:text-[#e2f0d5]">
                  <div className="font-extrabold text-[#629924] dark:text-[#81b64c]">
                    💡 Coach Hint ({activePuzzle.theme}):
                  </div>
                  <p className="mt-0.5 leading-relaxed">{activePuzzle.hint}</p>
                  {puzzleHintLevel === 1 && (
                    <p className="mt-1 text-[11px] opacity-80">
                      The piece you should move is highlighted in green on the board.
                    </p>
                  )}
                </div>
              )}

              {/* Chess.com Bottom Puzzle Buttons: Hint (Stage 1 -> Stage 2) & Skip */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                {puzzleHintLevel === 0 ? (
                  <button
                    type="button"
                    onClick={() => onRevealHint(false)}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-stone-200/90 py-2.5 text-xs font-extrabold text-stone-800 transition hover:bg-stone-300 dark:bg-[#302e2b] dark:text-white dark:hover:bg-[#3d3b37]"
                  >
                    <span>💡</span>
                    <span>Hint</span>
                  </button>
                ) : puzzleHintLevel === 1 ? (
                  <button
                    type="button"
                    onClick={() => onRevealHint(true)}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-amber-500/20 py-2.5 text-xs font-extrabold text-amber-700 ring-1 ring-amber-500/40 transition hover:bg-amber-500/30 dark:text-amber-300"
                  >
                    <span>🎯</span>
                    <span>Show Move Arrow</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-stone-200/50 py-2.5 text-xs font-bold text-stone-400 dark:bg-[#302e2b]/50 dark:text-[#7c7a77]"
                  >
                    <span>✓</span>
                    <span>Arrow Shown</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={onNextPuzzle}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-stone-200/90 py-2.5 text-xs font-extrabold text-stone-700 transition hover:bg-stone-300 dark:bg-[#302e2b] dark:text-[#bababa] dark:hover:bg-[#3d3b37] dark:hover:text-white"
                >
                  <span>Next Puzzle</span>
                  <span>→</span>
                </button>
              </div>
            </div>
          )}

          {puzzleStatus === 'correct_step' && (
            <div className="rounded-xl border border-[#81b64c]/50 bg-[#81b64c]/15 p-3.5 text-xs font-extrabold text-[#537a28] dark:text-[#a3d160]">
              ✓ Best move! Opponent is responding — find the follow-up move…
            </div>
          )}

          {puzzleStatus === 'solved' && (
            <div className="space-y-3 rounded-xl border border-[#81b64c]/50 bg-[#81b64c]/15 p-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-black text-[#4e7822] dark:text-[#a3d160]">
                    ★ Correct! Puzzle Solved ({puzzleShowHint ? '+6' : '+16'})
                  </div>
                  <div className="mt-0.5 text-[11px] font-bold text-stone-600 dark:text-[#bababa]">
                    Theme: {activePuzzle.theme} · {activePuzzle.title}
                  </div>
                </div>
              </div>

              <p className="text-xs leading-relaxed text-stone-700 dark:text-[#e4e4e0]">
                {activePuzzle.explanation}
              </p>

              <div className="grid grid-cols-[auto_1fr] gap-2 pt-1">
                <button
                  type="button"
                  onClick={onRetryPuzzle}
                  className="rounded-lg bg-stone-200 px-3.5 py-2.5 text-xs font-extrabold text-stone-700 transition hover:bg-stone-300 dark:bg-[#302e2b] dark:text-[#bababa]"
                >
                  ↺ Retry
                </button>
                <button
                  type="button"
                  onClick={onNextPuzzle}
                  className="rounded-lg bg-[#81b64c] py-2.5 text-xs font-black text-white shadow-[0_3px_0_#537a28] transition hover:bg-[#8ec356] active:translate-y-[1px]"
                >
                  Next Puzzle →
                </button>
              </div>
            </div>
          )}

          {puzzleStatus === 'failed' && (
            <div className="space-y-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5">
              <div className="text-sm font-black text-rose-600 dark:text-rose-400">
                ✗ Incorrect Move (-12)
              </div>
              <p className="text-xs text-stone-600 dark:text-[#bababa]">
                There is a stronger tactical strike in this position. Try again or ask Coach Viktor for a hint!
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onRetryPuzzle}
                  className="rounded-lg bg-[#81b64c] py-2 text-xs font-black text-white shadow-[0_3px_0_#537a28] transition hover:bg-[#8ec356]"
                >
                  ↺ Try Again
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onRetryPuzzle();
                    window.setTimeout(() => onRevealHint(true), 80);
                  }}
                  className="rounded-lg bg-stone-200 py-2 text-xs font-extrabold text-stone-800 transition hover:bg-stone-300 dark:bg-[#302e2b] dark:text-white"
                >
                  🎯 Show Solution
                </button>
              </div>
            </div>
          )}

          {/* Quick Theme Jump Pills */}
          <div className="pt-1">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold tracking-wider text-stone-400 uppercase dark:text-[#7c7a77]">
              <span>Train by Tactical Motif</span>
              <button
                type="button"
                onClick={pickRandomFiltered}
                className="font-bold text-[#81b64c] hover:underline"
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
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                    showThemeName && activePuzzle.theme === theme
                      ? 'bg-[#81b64c]/20 text-[#81b64c] ring-1 ring-[#81b64c]/40'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-[#1f1e1b] dark:text-[#bababa] dark:hover:bg-[#302e2b]'
                  }`}
                >
                  {theme}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* BROWSE 540 PUZZLE CATALOG VIEW */
        <div className="space-y-2.5">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <select
              aria-label="Filter puzzles by tactical theme"
              value={selectedTheme}
              onChange={(e) => setSelectedTheme(e.target.value as PuzzleTheme | 'all')}
              className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-800 focus:border-[#81b64c] focus:outline-none dark:border-white/10 dark:bg-[#1f1e1b] dark:text-white"
            >
              <option value="all">All 12 Themes ({PUZZLE_LIBRARY.length})</option>
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
              className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-800 focus:border-[#81b64c] focus:outline-none dark:border-white/10 dark:bg-[#1f1e1b] dark:text-white"
            >
              <option value="all">All Ratings (600 – 2650)</option>
              <option value="beginner">Beginner (&lt; 1100)</option>
              <option value="intermediate">Intermediate (1100 – 1499)</option>
              <option value="advanced">Advanced (1500 – 1849)</option>
              <option value="master">Master (1850+)</option>
            </select>
          </div>

          <div className="flex gap-1.5">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search 540 puzzles by #number or motif…"
              className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-stone-800 placeholder:text-stone-400 focus:border-[#81b64c] focus:outline-none dark:border-white/10 dark:bg-[#1f1e1b] dark:text-white"
            />
            <button
              type="button"
              onClick={pickRandomFiltered}
              className="shrink-0 rounded-lg bg-[#81b64c] px-3 py-1.5 text-xs font-extrabold text-white transition hover:bg-[#72a341]"
            >
              🎲 Random
            </button>
          </div>

          <div className="scroll-thin max-h-64 space-y-1 overflow-y-auto pr-1">
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
                      ? 'border-[#81b64c] bg-[#81b64c]/15'
                      : 'border-stone-200/80 bg-stone-50/70 hover:border-stone-300 dark:border-white/5 dark:bg-[#1f1e1b] dark:hover:bg-[#302e2b]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {isDone && (
                        <span className="font-mono text-xs font-black text-[#81b64c]">✓</span>
                      )}
                      <span className="truncate text-xs font-bold text-stone-800 dark:text-white">
                        {puz.title}
                      </span>
                    </div>
                    <div className="text-[10px] text-stone-500 dark:text-[#989795]">
                      {puz.theme} · {puz.sideToSolve} to move
                    </div>
                  </div>
                  <span className="shrink-0 rounded bg-stone-200/70 px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-stone-700 dark:bg-[#302e2b] dark:text-[#bababa]">
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

