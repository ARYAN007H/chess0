import { useEffect, useMemo, useState } from 'react';
import { useChessGame } from './useChessGame';
import type { Level, Side } from './useChessGame';
import { BoardPanel } from './components/BoardPanel';
import { EvalBar } from './components/EvalBar';
import { PlayerCard, materialStatus } from './components/PlayerCard';
import { MatchArenaPanel } from './components/MatchArenaPanel';
import { PuzzleTrainer } from './components/PuzzleTrainer';
import { LearnCenter } from './components/LearnCenter';
import { AnalysisPanel } from './components/AnalysisPanel';
import { OpeningExplorer } from './components/OpeningExplorer';
import { MoveList } from './components/MoveList';
import { Controls } from './components/Controls';
import { PromotionDialog } from './components/PromotionDialog';
import { ResultModal } from './components/ResultModal';
import { squareName } from './engine/engine';
import { moveCaptured } from './engine/types';

type WorkbenchTab = 'arena' | 'puzzles' | 'academy' | 'analysis' | 'openings' | 'setup';

function shortLevel(level: Level): string {
  switch (level) {
    case 'random':
      return 'Random · 400 Elo';
    case 'beginner':
      return 'Beginner · 850 Elo';
    case 'intermediate':
      return 'Club · 1350 Elo';
    case 'full':
      return 'v1 Classic · 1850 Elo';
    case 'v2':
      return 'v2 Positional · 2300 Elo';
    case 'v3':
      return 'v3 Grandmaster · 2850+';
  }
}

export default function App() {
  const game = useChessGame();
  const [activeTab, setActiveTab] = useState<WorkbenchTab>('arena');
  const [resultDismissed, setResultDismissed] = useState(false);

  // Sync activeTab when mode changes to puzzle/academy or when game ends
  useEffect(() => {
    setResultDismissed(false);
    if (game.gameEnd !== null || game.customResultBanner !== null) {
      // Unlock post-game review
    }
  }, [game.gameEnd, game.customResultBanner]);

  const handleNavSelect = (tab: WorkbenchTab) => {
    setActiveTab(tab);
    if (tab === 'puzzles' && game.mode !== 'puzzle') {
      game.switchMode('puzzle');
    } else if (tab === 'academy' && game.mode !== 'academy') {
      game.switchMode('academy');
    } else if (
      tab === 'arena' &&
      (game.mode === 'puzzle' || game.mode === 'academy')
    ) {
      game.switchMode('hve');
    }
  };

  const engine = game.engineRef.current;

  // Board-derived legal move target squares
  const targets = useMemo(() => {
    if (game.selected === null || engine === null || game.isViewingHistory) {
      return { dots: new Set<string>(), captures: new Set<string>() };
    }
    const moves = game.legalTargetsFor(game.selected);
    const dots = new Set<string>();
    const captures = new Set<string>();
    for (const m of moves) {
      const to = squareName((m >>> 7) & 127);
      dots.add(to);
      if (moveCaptured(m) !== 0) captures.add(to);
    }
    return { dots, captures };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.selected, game.fen, game.isViewingHistory]);

  const checkSquare = useMemo(() => {
    if (engine === null || game.isViewingHistory) return null;
    if (!engine.inCheck()) return null;
    return squareName(engine.pos.kingSq[engine.stm]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.fen, game.gameEnd, game.isViewingHistory]);

  const counts = useMemo(() => engine?.pieceCounts() ?? null, [game.fen, engine]);
  const material = useMemo(() => (counts !== null ? materialStatus(counts) : null), [counts]);

  const copyFen = () => {
    void navigator.clipboard?.writeText(game.fen).catch(() => {});
  };

  const topSide: Side = game.orientation === 'white' ? 'black' : 'white';
  const bottomSide: Side = game.orientation === 'white' ? 'white' : 'black';

  const playerName = (side: Side): string => {
    if (game.mode === 'puzzle') {
      return side === game.activePuzzle.sideToSolve
        ? `You (${game.puzzleRating} Rating)`
        : `Tactical Challenge (${game.activePuzzle.rating})`;
    }
    if (game.mode === 'academy') {
      return side === game.playerSide ? 'Student (You)' : 'Academy Coach';
    }
    if (game.mode === 'pvp') {
      if (game.pvpSubMode === 'online' && game.roomState) {
        const hostIsSide = game.roomState.hostSide === side;
        if (hostIsSide) return game.roomState.hostName || 'Host';
        return game.roomState.guestName || 'Waiting for Challenger…';
      }
      return side === 'white' ? 'Player 1 (White)' : 'Player 2 (Black)';
    }
    const lvl = game.levels[side];
    const engineTitle =
      lvl === 'v3' ? 'Chess0 v3 GM' : lvl === 'v2' ? 'Chess0 v2' : 'Chess0';
    if (game.mode === 'analysis') return side === 'white' ? 'White' : 'Black';
    if (game.mode === 'eve') return `${engineTitle} (${side === 'white' ? 'W' : 'B'})`;
    return side === game.playerSide
      ? game.botPlayStyle === 'comp'
        ? `${game.playerName} (${game.compElo} Elo)`
        : `${game.playerName} (Learn Mode)`
      : engineTitle;
  };

  const playerSubtitle = (side: Side): string => {
    if (game.mode === 'puzzle') return game.activePuzzle.theme;
    if (game.mode === 'academy') return game.activeModule.title;
    if (game.mode === 'pvp') {
      return game.pvpSubMode === 'online'
        ? game.roomState
          ? `Room ${game.roomState.roomId}`
          : 'Online Match'
        : 'Pass & Play';
    }
    if (game.mode === 'analysis') return 'Analysis Sandbox';
    if (game.mode === 'eve') return shortLevel(game.levels[side]);
    if (side === game.playerSide) {
      return game.botPlayStyle === 'comp'
        ? 'Competitive · No Assistance'
        : 'Coach Assisted · 3-Line Hints';
    }
    return shortLevel(game.levels[side]);
  };

  const cardProps = (side: Side) => ({
    side,
    name: playerName(side),
    subtitle: playerSubtitle(side),
    isTurn:
      game.stmSide === side &&
      game.gameEnd === null &&
      game.customResultBanner === null &&
      !game.isViewingHistory,
    thinking: game.thinkingSide === side,
    captured:
      material === null
        ? []
        : side === 'white'
          ? material.whiteCaptured
          : material.blackCaptured,
    materialDiff:
      material === null ? 0 : side === 'white' ? material.whiteDiff : -material.whiteDiff,
    accuracy: game.isAssistanceHidden
      ? null
      : side === 'white'
        ? game.gameSummary.whiteAccuracy
        : game.gameSummary.blackAccuracy,
  });

  const navItems: { id: WorkbenchTab; label: string }[] = [
    { id: 'arena', label: 'Play Arena' },
    { id: 'puzzles', label: 'Puzzles' },
    { id: 'academy', label: 'Learn Chess' },
    { id: 'analysis', label: 'Game Review' },
    { id: 'openings', label: 'Opening Book' },
  ];

  const showResultModal =
    (game.gameEnd !== null || game.customResultBanner !== null) && !resultDismissed;

  return (
    <div className="min-h-screen">
      {/* Top Bar Contract: 3 Clean Zones separated by gap-8 */}
      <header className="border-b border-stone-200/90 bg-white/80 backdrop-blur-md dark:border-slate-800/80 dark:bg-[#0b0f17]/80">
        <div className="mx-auto flex max-w-[1380px] items-center justify-between gap-8 px-5 py-3">
          {/* Zone 1: Single-element Brand Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              handleNavSelect('arena');
            }}
            className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-white"
          >
            Chess<span className="text-emerald-600 dark:text-emerald-400">0</span>
          </a>

          {/* Zone 2: Primary Navigation (5 single-line links) */}
          <nav className="hidden items-center gap-6 md:flex">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavSelect(item.id)}
                className={`whitespace-nowrap text-sm font-semibold transition ${
                  activeTab === item.id
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: Action Cluster (1 Primary CTA) */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setActiveTab('arena');
                if (!game.roomState) {
                  game.createInviteRoom('white');
                }
              }}
              className="whitespace-nowrap rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-500 active:scale-[0.98]"
            >
              Invite Friend
            </button>
          </div>
        </div>
      </header>

      {/* Main Workbench Canvas */}
      <main className="mx-auto max-w-[1380px] px-4 py-5 sm:px-6">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(380px,640px)_1fr]">
          {/* Left Column: Board Stage + Eval Bar + Transport Scrubber */}
          <section className="mx-auto w-full max-w-[640px] space-y-2.5">
            <PlayerCard {...cardProps(topSide)} />

            <div className="relative flex items-stretch gap-3">
              <div className="flex w-8 shrink-0 flex-col pb-5">
                <EvalBar
                  evalPov={game.evalPov}
                  orientation={game.orientation}
                  locked={game.isAssistanceHidden}
                />
              </div>

              <div className="relative flex-1">
                <BoardPanel
                  fen={game.fen}
                  orientation={game.orientation}
                  selected={game.selected}
                  legalTargets={targets.dots}
                  captureTargets={targets.captures}
                  lastMove={game.lastMove}
                  checkSquare={checkSquare}
                  pvArrow={
                    game.isAssistanceHidden &&
                    game.mode !== 'puzzle' &&
                    game.mode !== 'academy'
                      ? null
                      : game.pvArrow
                  }
                  multiPv={game.isAssistanceHidden ? [] : game.engineInfo.multiPv}
                  showMultiPvArrows={game.showMultiPvArrows && !game.isAssistanceHidden}
                  lastMoveAnalysis={
                    game.isAssistanceHidden
                      ? null
                      : (game.displayedMoveEntry?.analysis ?? null)
                  }
                  gameId={game.gameId}
                  onSquareClick={game.onSquareClick}
                  onPieceDrop={game.onPieceDrop}
                  boardTheme={game.boardTheme}
                />

                {game.promotion !== null && (
                  <PromotionDialog side={game.stmSide} onChoose={game.choosePromotion} />
                )}

                {showResultModal && (
                  <ResultModal
                    gameEnd={game.gameEnd}
                    customBanner={game.customResultBanner}
                    eloDelta={game.lastEloDelta}
                    compElo={
                      game.mode === 'hve' && game.botPlayStyle === 'comp'
                        ? game.compElo
                        : undefined
                    }
                    onNewGame={() => game.requestRematch()}
                    onDismiss={() => {
                      setResultDismissed(true);
                      setActiveTab('analysis');
                    }}
                  />
                )}
              </div>
            </div>

            <PlayerCard {...cardProps(bottomSide)} />

            {/* Board Command & History Scrubber Dock */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200/90 bg-white/85 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60">
              {/* Scrubber transport */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="First position"
                  disabled={game.activePly === 0}
                  onClick={game.stepFirst}
                  className="rounded-lg border border-stone-200/80 px-2.5 py-1 font-mono text-xs font-bold text-slate-700 transition hover:border-emerald-500 disabled:opacity-35 dark:border-slate-800 dark:text-slate-200"
                >
                  |&lt;
                </button>
                <button
                  type="button"
                  title="Previous move (Left Arrow)"
                  disabled={game.activePly === 0}
                  onClick={game.stepPrev}
                  className="rounded-lg border border-stone-200/80 px-2.5 py-1 font-mono text-xs font-bold text-slate-700 transition hover:border-emerald-500 disabled:opacity-35 dark:border-slate-800 dark:text-slate-200"
                >
                  &lt;
                </button>
                <button
                  type="button"
                  title="Next move (Right Arrow)"
                  disabled={game.activePly >= game.history.length}
                  onClick={game.stepNext}
                  className="rounded-lg border border-stone-200/80 px-2.5 py-1 font-mono text-xs font-bold text-slate-700 transition hover:border-emerald-500 disabled:opacity-35 dark:border-slate-800 dark:text-slate-200"
                >
                  &gt;
                </button>
                <button
                  type="button"
                  title="Live board tip"
                  disabled={!game.isViewingHistory}
                  onClick={game.stepLast}
                  className="rounded-lg border border-stone-200/80 px-2.5 py-1 font-mono text-xs font-bold text-slate-700 transition hover:border-emerald-500 disabled:opacity-35 dark:border-slate-800 dark:text-slate-200"
                >
                  &gt;|
                </button>
              </div>

              {/* Board actions & environment toggles */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  title={
                    game.isAssistanceHidden
                      ? 'Undo is locked in Competitive & Online matches'
                      : 'Takeback move'
                  }
                  disabled={game.history.length === 0 || game.isAssistanceHidden}
                  onClick={game.takeback}
                  className="rounded-lg border border-stone-200/80 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:border-emerald-500 disabled:opacity-35 dark:border-slate-800 dark:text-slate-200"
                >
                  ↩ Undo
                </button>
                <button
                  type="button"
                  title="Flip board orientation"
                  onClick={game.flipBoard}
                  className="rounded-lg border border-stone-200/80 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:border-emerald-500 dark:border-slate-800 dark:text-slate-200"
                >
                  ⇅ Flip
                </button>
                <button
                  type="button"
                  title={game.soundOn ? 'Mute move audio' : 'Unmute move audio'}
                  onClick={() => game.setSoundOn(!game.soundOn)}
                  className="rounded-lg border border-stone-200/80 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:border-emerald-500 dark:border-slate-800 dark:text-slate-200"
                >
                  {game.soundOn ? 'Sound On' : 'Muted'}
                </button>
                <button
                  type="button"
                  title="Switch Light / Dark surface theme"
                  onClick={() => game.setTheme(game.theme === 'dark' ? 'light' : 'dark')}
                  className="rounded-lg border border-stone-200/80 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:border-emerald-500 dark:border-slate-800 dark:text-slate-200"
                >
                  {game.theme === 'dark' ? 'Light UI' : 'Dark UI'}
                </button>
              </div>
            </div>
          </section>

          {/* Right Column: Workbench Suite */}
          <aside className="space-y-3.5">
            {/* Segmented Tab Switcher */}
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-stone-200/90 bg-stone-200/60 p-1 sm:grid-cols-6 dark:border-slate-800 dark:bg-slate-900/90">
              {(
                [
                  ['arena', 'Play'],
                  ['puzzles', 'Puzzles'],
                  ['academy', 'Learn'],
                  ['analysis', 'Review'],
                  ['openings', 'Openings'],
                  ['setup', 'Settings'],
                ] as [WorkbenchTab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleNavSelect(id)}
                  className={`rounded-lg py-1.5 text-xs font-bold transition ${
                    activeTab === id
                      ? 'bg-white text-emerald-700 shadow-xs dark:bg-slate-800 dark:text-emerald-400'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Active Workbench Panel */}
            {activeTab === 'arena' && (
              <MatchArenaPanel
                mode={game.mode}
                botPlayStyle={game.botPlayStyle}
                pvpSubMode={game.pvpSubMode}
                playerSide={game.playerSide}
                levels={game.levels}
                compElo={game.compElo}
                lastEloDelta={game.lastEloDelta}
                isAssistanceHidden={game.isAssistanceHidden}
                coachSuggestions={game.coachSuggestions}
                engineInfo={game.engineInfo}
                thinkingSide={game.thinkingSide}
                stmSide={game.stmSide}
                canPlayMove={game.isHumanTurn}
                showMultiPvArrows={game.showMultiPvArrows}
                playerName={game.playerName}
                roomState={game.roomState}
                onSwitchMode={game.switchMode}
                onSetBotPlayStyle={game.setBotPlayStyle}
                onSetPvpSubMode={game.setPvpSubMode}
                onChooseSide={game.chooseSide}
                onSetEngineLevel={game.setEngineLevel}
                onToggleArrows={game.setShowMultiPvArrows}
                onPlayUciMove={game.playUciMove}
                onAnalyzeDeeper={game.analyzeDisplayedPosition}
                onSetPlayerName={game.setPlayerName}
                onCreateInviteRoom={game.createInviteRoom}
                onJoinInviteRoom={game.joinInviteRoom}
                onLeaveInviteRoom={game.leaveInviteRoom}
                onResign={game.resignMatch}
                onAgreeDraw={game.agreeDraw}
                onRequestRematch={game.requestRematch}
                onSendChat={game.sendRoomChat}
              />
            )}

            {activeTab === 'puzzles' && (
              <PuzzleTrainer
                activePuzzle={game.activePuzzle}
                puzzleStepIndex={game.puzzleStepIndex}
                puzzleStatus={game.puzzleStatus}
                puzzleShowHint={game.puzzleShowHint}
                puzzleRating={game.puzzleRating}
                puzzleStreak={game.puzzleStreak}
                solvedPuzzleIds={game.solvedPuzzleIds}
                onStartPuzzle={game.startPuzzle}
                onNextPuzzle={game.nextPuzzle}
                onRetryPuzzle={game.retryPuzzle}
                onRevealHint={game.revealPuzzleSolution}
              />
            )}

            {activeTab === 'academy' && (
              <LearnCenter
                activeModule={game.activeModule}
                activeStepIndex={game.activeStepIndex}
                lessonStatus={game.lessonStatus}
                completedLessons={game.completedLessons}
                onStartLesson={game.startAcademyLesson}
                onShowArrowHint={() => {
                  game.analyzeDisplayedPosition();
                }}
              />
            )}

            {activeTab === 'analysis' &&
              (game.isAssistanceHidden ? (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4 text-xs text-slate-600 dark:text-slate-300">
                  <strong className="block font-extrabold text-amber-800 dark:text-amber-300">
                    Game Review Locked During Active Competitive Match
                  </strong>
                  Finish or resign the current competitive game to unlock the full Evaluation Timeline, Accuracy %, and Move Coach breakdown.
                </div>
              ) : (
                <AnalysisPanel
                  history={game.history}
                  activePly={game.activePly}
                  displayedMove={game.displayedMoveEntry}
                  summary={game.gameSummary}
                  onSelectPly={game.selectPly}
                  onAnalyzeDeeper={() => {
                    game.analyzeDisplayedPosition();
                    setActiveTab('arena');
                  }}
                />
              ))}

            {activeTab === 'openings' &&
              (game.isAssistanceHidden ? (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4 text-xs text-slate-600 dark:text-slate-300">
                  <strong className="block font-extrabold text-amber-800 dark:text-amber-300">
                    Opening Book Locked During Active Competitive Match
                  </strong>
                  Switch to Learn Mode or finish the current competitive match to browse opening continuations and win/draw/loss statistics.
                </div>
              ) : (
                <OpeningExplorer
                  currentOpening={game.currentOpening}
                  continuations={game.bookExplorerMoves}
                  canPlayMove={game.isHumanTurn}
                  onPlayUciMove={game.playUciMove}
                  onLoadOpeningLine={game.loadOpeningLine}
                  onLoadFenPreset={(presetFen) => {
                    game.loadFen(presetFen);
                    setActiveTab('arena');
                  }}
                />
              ))}

            {activeTab === 'setup' && (
              <Controls
                mode={game.mode}
                playerSide={game.playerSide}
                levels={game.levels}
                eveRunning={game.eveRunning}
                autoFlip={game.autoFlip}
                boardTheme={game.boardTheme}
                canTakeback={game.history.length > 0 && !game.isAssistanceHidden}
                onSwitchMode={game.switchMode}
                onChooseSide={game.chooseSide}
                onSetEngineLevel={game.setEngineLevel}
                onToggleEve={game.toggleEve}
                onSetAutoFlip={game.setAutoFlipAndApply}
                onSetBoardTheme={game.setBoardTheme}
                onNewGame={() => game.newGame()}
                onTakeback={game.takeback}
                onFlip={game.flipBoard}
                onLoadFen={game.loadFen}
              />
            )}

            {/* Persistent Algebraic Move Table & Scrubber */}
            <MoveList
              history={game.history}
              activePly={game.activePly}
              onSelectPly={(ply) => {
                game.selectPly(ply);
              }}
              onCopyFen={copyFen}
            />
          </aside>
        </div>
      </main>
    </div>
  );
}
