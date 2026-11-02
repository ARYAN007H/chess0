import { useEffect, useMemo, useRef, useState } from 'react';
import { useChessGame } from './useChessGame';
import type { Level, Side } from './useChessGame';
import { BoardPanel } from './components/BoardPanel';
import { EvalBar } from './components/EvalBar';
import { PlayerCard, materialStatus } from './components/PlayerCard';
import { CoachBanner } from './components/CoachBanner';
import type { CoachMessage } from './components/CoachBanner';
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
import { CLASSIFICATION_META } from './engine/analysis';
import { PUZZLE_LIBRARY } from './engine/puzzles';
import { TOTAL_ACADEMY_LESSONS } from './engine/lessons';
import { coachVoice } from './coachTts';

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

function NavIcon({ id }: { id: WorkbenchTab }) {
  switch (id) {
    case 'arena':
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
          <path d="M13 3H7v2l1.5 1.5c.3 2.5-.4 4.3-1.5 5.5H5v2h10v-2h-2c-1.1-1.2-1.8-3-1.5-5.5L13 5V3zM4 16h12v2H4v-2z" />
        </svg>
      );
    case 'puzzles':
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
          <path d="M10 2a2 2 0 0 1 2 2v1h2a2 2 0 0 1 2 2v2h-1a2 2 0 1 0 0 4h1v2a2 2 0 0 1-2 2h-2v-1a2 2 0 1 0-4 0v1H6a2 2 0 0 1-2-2v-2h1a2 2 0 1 0 0-4H4V7a2 2 0 0 1 2-2h2V4a2 2 0 0 1 2-2z" />
        </svg>
      );
    case 'academy':
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
          <path d="M10 2L1 6.5 10 11l7-3.5V14h2V6.5L10 2zm-5 7.2V13c0 2.2 2.2 4 5 4s5-1.8 5-4V9.2l-5 2.5-5-2.5z" />
        </svg>
      );
    case 'analysis':
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
          <path d="M2 15h3V9H2v6zm5 0h3V5H7v10zm5 0h3v-4h-3v4zm5 0h1v2H2v-2h15V3h2v12z" />
        </svg>
      );
    case 'openings':
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
          <path d="M3 4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v12a1 1 0 0 0-1-1H4a1 1 0 0 1-1-1V4zm14 0a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v12a1 1 0 0 1 1-1h6a1 1 0 0 0 1-1V4z" />
        </svg>
      );
    case 'setup':
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
          <path d="M11.5 2h-3l-.4 2.2a6 6 0 0 0-1.6.9l-2.1-.8-1.5 2.6 1.7 1.4a6 6 0 0 0 0 1.8l-1.7 1.4 1.5 2.6 2.1-.8c.5.4 1 .7 1.6.9L8.5 18h3l.4-2.2c.6-.2 1.1-.5 1.6-.9l2.1.8 1.5-2.6-1.7-1.4a6 6 0 0 0 0-1.8l1.7-1.4-1.5-2.6-2.1.8a6 6 0 0 0-1.6-.9L11.5 2zM10 13a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" />
        </svg>
      );
  }
}

export default function App() {
  const game = useChessGame();
  const [activeTab, setActiveTab] = useState<WorkbenchTab>('arena');
  const [resultDismissed, setResultDismissed] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(() => coachVoice.isEnabled());

  // Dynamically measure the center board stage so the board is ALWAYS a crisp square
  // that fits 100% inside both its column width AND the viewport height without overlapping.
  const stageRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState<number>(480);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const updateSize = () => {
      const isDesktop = window.innerWidth >= 1024;
      const rightDockW = window.innerWidth >= 1280 ? 430 : 395;
      const leftNavW = 176;
      const stageW = isDesktop
        ? Math.min(el.clientWidth, window.innerWidth - leftNavW - rightDockW)
        : el.clientWidth;
      // Subtract horizontal padding (32px) + EvalBar & gap (36px) + breathing room (12px) = 80px
      const availW = Math.max(260, stageW - 80);
      const availH = isDesktop
        ? Math.max(280, window.innerHeight - 118)
        : Math.max(280, window.innerHeight - 200);
      const next = Math.floor(Math.min(availW, availH, 640));
      setBoardWidth(next);
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    window.addEventListener('resize', updateSize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  useEffect(() => {
    document.body.dataset.state =
      game.gameEnd !== null || game.customResultBanner !== null ? 'gameover' : 'playing';
  }, [game.gameEnd, game.customResultBanner]);

  useEffect(() => {
    setResultDismissed(false);
  }, [game.gameEnd, game.customResultBanner]);

  const handleToggleTts = (on: boolean) => {
    setTtsEnabled(on);
    coachVoice.setEnabled(on);
  };

  const handleNavSelect = (tab: WorkbenchTab) => {
    setActiveTab(tab);
    if (tab === 'puzzles' && game.mode !== 'puzzle') {
      game.switchMode('puzzle');
    } else if (tab === 'academy' && game.mode !== 'academy') {
      game.switchMode('academy');
    } else if (tab === 'arena' && (game.mode === 'puzzle' || game.mode === 'academy')) {
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
        ? `You (${game.puzzleRating})`
        : `Puzzle Opponent (${game.activePuzzle.rating})`;
    }
    if (game.mode === 'academy') {
      return side === game.playerSide ? 'Student (You)' : 'GM Coach Viktor';
    }
    if (game.mode === 'pvp') {
      if (game.pvpSubMode === 'online' && game.roomState) {
        const hostIsSide = game.roomState.hostSide === side;
        if (hostIsSide) return game.roomState.hostName || 'Host';
        return game.roomState.guestName || 'Waiting for Friend…';
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
        ? `${game.playerName} (${game.compElo})`
        : `${game.playerName} (Coach Assisted)`
      : engineTitle;
  };

  const playerSubtitle = (side: Side): string => {
    if (game.mode === 'puzzle') {
      // Never spoil the tactical motif until solved or hinted!
      return game.puzzleStatus === 'solved' || game.puzzleHintLevel >= 1
        ? game.activePuzzle.theme
        : 'Tactical Challenge';
    }
    if (game.mode === 'academy') return game.activeModule.title;
    if (game.mode === 'pvp') {
      return game.pvpSubMode === 'online'
        ? game.roomState
          ? `Room ${game.roomState.roomId}`
          : 'Online Match'
        : 'Pass & Play';
    }
    if (game.mode === 'analysis') return 'Sandbox';
    if (game.mode === 'eve') return shortLevel(game.levels[side]);
    if (side === game.playerSide) {
      return game.botPlayStyle === 'comp' ? 'Rated · No Hints' : 'Learn Mode';
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
    accuracy:
      game.isAssistanceHidden || game.mode === 'puzzle' || game.mode === 'academy'
        ? null
        : side === 'white'
          ? game.gameSummary.whiteAccuracy
          : game.gameSummary.blackAccuracy,
  });

  // Strict opt-in arrow & hint square visibility on the board
  const effectivePvArrow = useMemo(() => {
    if (game.mode === 'puzzle') {
      return game.puzzleHintLevel >= 2 ? game.pvArrow : null;
    }
    if (game.mode === 'academy') {
      return game.academyShowHint ? game.pvArrow : null;
    }
    if (game.isAssistanceHidden) {
      return null;
    }
    return game.pvArrow;
  }, [
    game.academyShowHint,
    game.isAssistanceHidden,
    game.mode,
    game.puzzleHintLevel,
    game.pvArrow,
  ]);

  const effectiveHintSquare = useMemo(() => {
    if (game.mode === 'puzzle' && game.puzzleHintLevel >= 1) {
      return game.puzzleHintSquare;
    }
    return null;
  }, [game.mode, game.puzzleHintLevel, game.puzzleHintSquare]);

  // Dynamic 2D Coach Viktor Message across all modes (strictly no spoilers in Puzzle mode until asked!)
  const coachMessage: CoachMessage = useMemo(() => {
    if (game.mode === 'puzzle') {
      if (game.puzzleStatus === 'solved') {
        return {
          mood: 'excited',
          headline: 'Puzzle Solved!',
          body: game.activePuzzle.explanation,
          badgeText: `${game.activePuzzle.theme} · +16`,
          badgeColor: '#81b64c',
          actionLabel: 'Next Puzzle',
          onAction: game.nextPuzzle,
        };
      }
      if (game.puzzleStatus === 'failed') {
        return {
          mood: 'warning',
          headline: "That's not the winning move.",
          body: 'Look for checks, captures, and forcing threats—or click Hint below if you want a clue.',
          badgeText: 'Incorrect',
          badgeColor: '#ca3431',
          actionLabel: 'Retry',
          onAction: game.retryPuzzle,
        };
      }
      if (game.puzzleHintLevel === 1) {
        return {
          mood: 'thinking',
          headline: `Hint 1 · Move your piece on ${game.puzzleHintSquare?.toUpperCase() ?? ''}`,
          body: game.activePuzzle.hint,
          badgeText: game.activePuzzle.theme,
          badgeColor: '#f59e0b',
        };
      }
      if (game.puzzleHintLevel >= 2) {
        return {
          mood: 'thinking',
          headline: 'Solution Arrow Revealed',
          body: `${game.activePuzzle.hint} Follow the green arrow on the board to complete the step.`,
          badgeText: game.activePuzzle.theme,
          badgeColor: '#81b64c',
        };
      }
      return {
        mood: 'neutral',
        headline: `Find the best move for ${game.activePuzzle.sideToSolve === 'white' ? 'White' : 'Black'}.`,
        body: 'Calculate forcing checks, captures, and tactical threats before making your move. Need a nudge? Click Hint below.',
        badgeText: `Rated ${game.activePuzzle.rating}`,
        badgeColor: '#5c5953',
      };
    }

    if (game.mode === 'academy') {
      const step = game.activeModule.steps[game.activeStepIndex] ?? game.activeModule.steps[0];
      if (game.lessonStatus === 'completed') {
        return {
          mood: 'excited',
          headline: `Lesson Mastered: ${step.title}`,
          body: step.successNote,
          badgeText: 'Mastered ✓',
          badgeColor: '#81b64c',
        };
      }
      if (game.lessonStatus === 'wrong') {
        return {
          mood: 'warning',
          headline: 'Not quite the move this lesson teaches.',
          body: step.coachTip,
          badgeText: 'Try Again',
          badgeColor: '#ca3431',
        };
      }
      return {
        mood: 'neutral',
        headline: step.title,
        body: step.prompt,
        badgeText: game.activeModule.difficulty,
        badgeColor: '#81b64c',
      };
    }

    if (game.isAssistanceHidden) {
      return {
        mood: 'locked',
        headline:
          game.mode === 'pvp'
            ? 'Live Multiplayer · Fair-Play Active'
            : `Competitive Rated Game (${game.compElo} Elo)`,
        body: 'Coach suggestions and evaluation bars are hidden during rated play. Full 3-line Game Review unlocks as soon as the match finishes.',
        badgeText: 'Rated',
        badgeColor: '#5c5953',
      };
    }

    const lastEntry = game.displayedMoveEntry;
    const topSug = game.coachSuggestions[0];

    if (lastEntry) {
      const meta = CLASSIFICATION_META[lastEntry.analysis.classification];
      const cl = lastEntry.analysis.classification;
      const isMistake = cl === 'inaccuracy' || cl === 'mistake' || cl === 'blunder';
      const isGreat = cl === 'brilliant' || cl === 'great' || cl === 'best';

      let body = meta.description;
      if (isMistake && lastEntry.analysis.bestAlternativeSan) {
        body = `${lastEntry.san} was a ${meta.label.toLowerCase()} (better was ${lastEntry.analysis.bestAlternativeSan}).`;
      } else if (game.currentOpening && lastEntry.ply <= 14) {
        body = `${game.currentOpening.eco} ${game.currentOpening.name}.`;
      }
      if (topSug && game.isHumanTurn) {
        body += ` Best continuation now is ${topSug.san}: ${topSug.explanation}`;
      }

      return {
        mood: isMistake ? 'warning' : isGreat ? 'excited' : 'neutral',
        headline: `${Math.ceil(lastEntry.ply / 2)}${lastEntry.ply % 2 === 1 ? '.' : '…'} ${lastEntry.san} is ${meta.label}`,
        body,
        badgeText: `${meta.symbol} ${meta.label}`,
        badgeColor: meta.badgeBg,
        actionLabel: topSug && game.isHumanTurn ? `Play ${topSug.san}` : undefined,
        onAction:
          topSug && game.isHumanTurn ? () => game.playUciMove(topSug.uci) : undefined,
      };
    }

    return {
      mood: 'neutral',
      headline: "Hi, I'm Coach Viktor! Ready to play or train?",
      body: topSug
        ? `Recommended opening move: 1. ${topSug.san} — ${topSug.explanation}`
        : `Choose a classical opening move on the board, or explore ${PUZZLE_LIBRARY.length} Puzzles and ${TOTAL_ACADEMY_LESSONS} Lessons.`,
      badgeText: 'Coach Mode',
      badgeColor: '#81b64c',
      actionLabel: topSug && game.isHumanTurn ? `Play 1. ${topSug.san}` : undefined,
      onAction:
        topSug && game.isHumanTurn ? () => game.playUciMove(topSug.uci) : undefined,
    };
  }, [
    game.activeModule,
    game.activePuzzle,
    game.activeStepIndex,
    game.coachSuggestions,
    game.compElo,
    game.currentOpening,
    game.displayedMoveEntry,
    game.isAssistanceHidden,
    game.isHumanTurn,
    game.lessonStatus,
    game.mode,
    game.nextPuzzle,
    game.playUciMove,
    game.puzzleHintLevel,
    game.puzzleHintSquare,
    game.puzzleStatus,
    game.retryPuzzle,
  ]);

  const navItems: {
    id: WorkbenchTab;
    label: string;
    badge?: string;
  }[] = [
    { id: 'arena', label: 'Play' },
    { id: 'puzzles', label: 'Puzzles', badge: String(PUZZLE_LIBRARY.length) },
    { id: 'academy', label: 'Learn', badge: String(TOTAL_ACADEMY_LESSONS) },
    { id: 'analysis', label: 'Game Review' },
    { id: 'openings', label: 'Openings' },
    { id: 'setup', label: 'Settings' },
  ];

  const showResultModal =
    (game.gameEnd !== null || game.customResultBanner !== null) && !resultDismissed;

  const boardRowWidth = boardWidth + 36;

  return (
    <div className="flex min-h-screen flex-col bg-[#f3f2ee] text-stone-900 dark:bg-[#302e2b] dark:text-[#e8e6e3] lg:h-screen lg:flex-row lg:overflow-hidden">
      {/* Left Vertical Chess.com Studio Sidebar (#21201d) */}
      <aside className="flex shrink-0 flex-row items-center justify-between border-b border-black/20 bg-[#21201d] px-3 py-2 text-[#c4c2bd] lg:w-44 lg:flex-col lg:items-stretch lg:justify-between lg:border-b-0 lg:border-r lg:border-black/30 lg:px-2.5 lg:py-3.5">
        <div className="flex items-center gap-3 lg:flex-col lg:items-stretch lg:gap-4">
          {/* Chess0 Wordmark */}
          <button
            type="button"
            onClick={() => handleNavSelect('arena')}
            className="flex items-center gap-2 px-1.5 text-left focus:outline-none"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#81b64c] text-white shadow-xs">
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                <path d="M17 19H7v-1.8l1.6-1.6c.3-2.8-.4-4.8-1.6-6 1-1.3 2.4-2 4.1-2-.4-.9-.4-2 .4-3 1.2 0 2.2.6 2.8 1.5 2.1.4 3.9 2.1 4.2 4.6.2 1.1-.2 2-1.1 2-.7 0-1.3-.4-1.6-1.1-.4 1.3-.1 3 .9 4.4l.7 1.4V19zm-11 2h12v1.5H6V21z" />
              </svg>
            </span>
            <div>
              <div className="text-base font-black leading-none tracking-tight text-white">
                Chess<span className="text-[#81b64c]">0</span>
              </div>
              <div className="hidden text-[10px] font-bold text-[#8b8987] lg:block">
                v3 Grandmaster
              </div>
            </div>
          </button>

          {/* Primary Navigation */}
          <nav
            aria-label="Primary Workbench Navigation"
            className="flex items-center gap-1 lg:flex-col lg:items-stretch lg:gap-1"
          >
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavSelect(item.id)}
                  className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-extrabold transition ${
                    active
                      ? 'bg-[#81b64c] text-white shadow-xs'
                      : 'text-[#c4c2bd] hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <NavIcon id={item.id} />
                    <span className="hidden sm:inline lg:inline">{item.label}</span>
                  </span>
                  {item.badge && (
                    <span
                      className={`hidden rounded px-1.5 py-0.5 font-mono text-[10px] font-extrabold lg:inline ${
                        active
                          ? 'bg-black/25 text-white'
                          : 'bg-white/10 text-[#95c95e]'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Actions */}
        <div className="flex items-center gap-1.5 lg:flex-col lg:items-stretch lg:gap-2 lg:border-t lg:border-white/10 lg:pt-3">
          <button
            type="button"
            data-start="true"
            onClick={() => {
              setActiveTab('arena');
              if (!game.roomState) {
                game.createInviteRoom('white');
              }
            }}
            className="whitespace-nowrap rounded-lg bg-[#383632] px-2.5 py-2 text-xs font-extrabold text-white transition hover:bg-[#45433e]"
          >
            Invite Friend
          </button>

          <div className="hidden grid-cols-2 gap-1.5 lg:grid">
            <button
              type="button"
              onClick={() => game.setSoundOn(!game.soundOn)}
              className="rounded-md bg-[#2c2b28] px-2 py-1.5 text-[11px] font-bold text-[#c4c2bd] transition hover:bg-[#383632] hover:text-white"
            >
              {game.soundOn ? 'Sound On' : 'Muted'}
            </button>
            <button
              type="button"
              onClick={() => game.setTheme(game.theme === 'dark' ? 'light' : 'dark')}
              className="rounded-md bg-[#2c2b28] px-2 py-1.5 text-[11px] font-bold text-[#c4c2bd] transition hover:bg-[#383632] hover:text-white"
            >
              {game.theme === 'dark' ? 'Light UI' : 'Dark UI'}
            </button>
          </div>
        </div>
      </aside>

      {/* Center Stage + Right Unified Chess.com Dock */}
      <main className="flex min-w-0 flex-1 flex-col lg:h-full lg:flex-row lg:overflow-hidden">
        {/* Center Column: Measured Square Board Stage */}
        <section
          ref={stageRef}
          className="flex min-w-0 flex-1 flex-col items-center justify-center px-3 py-2 sm:px-4 lg:h-full lg:overflow-hidden"
        >
          <div
            style={{ width: `${boardRowWidth}px`, maxWidth: '100%' }}
            className="flex flex-col gap-1.5"
          >
            <PlayerCard {...cardProps(topSide)} />

            <div className="flex items-center gap-2">
              <EvalBar
                evalPov={game.evalPov}
                orientation={game.orientation}
                locked={game.isAssistanceHidden || game.mode === 'puzzle'}
                heightPx={boardWidth}
              />

              <div
                style={{ width: `${boardWidth}px`, height: `${boardWidth}px` }}
                className="relative shrink-0"
              >
                <BoardPanel
                  fen={game.fen}
                  orientation={game.orientation}
                  selected={game.selected}
                  legalTargets={targets.dots}
                  captureTargets={targets.captures}
                  lastMove={game.lastMove}
                  checkSquare={checkSquare}
                  hintSquare={effectiveHintSquare}
                  pvArrow={effectivePvArrow}
                  multiPv={
                    game.isAssistanceHidden ||
                    game.mode === 'puzzle' ||
                    game.mode === 'academy'
                      ? []
                      : game.engineInfo.multiPv
                  }
                  showMultiPvArrows={
                    game.showMultiPvArrows &&
                    !game.isAssistanceHidden &&
                    game.mode !== 'puzzle' &&
                    game.mode !== 'academy'
                  }
                  lastMoveAnalysis={
                    game.isAssistanceHidden || game.mode === 'puzzle'
                      ? null
                      : (game.displayedMoveEntry?.analysis ?? null)
                  }
                  gameId={game.gameId}
                  onSquareClick={game.onSquareClick}
                  onPieceDrop={game.onPieceDrop}
                  boardTheme={game.boardTheme}
                  boardWidth={boardWidth}
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
          </div>
        </section>

        {/* Right Column: Unified Chess.com Full-Height Studio Dock (#262522) */}
        <section className="flex w-full shrink-0 flex-col border-t border-stone-300 bg-white dark:border-black/40 dark:bg-[#262522] lg:h-full lg:w-[395px] lg:border-l lg:border-t-0 xl:w-[430px]">
          {/* Top Coach Viktor Speech Bubble Header */}
          <CoachBanner
            message={coachMessage}
            ttsEnabled={ttsEnabled}
            onToggleTts={handleToggleTts}
          />

          {/* Scrollable Active Tab Body + Move Notation */}
          <div className="scroll-thin flex-1 space-y-3 overflow-y-auto p-3.5">
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
                puzzleHintLevel={game.puzzleHintLevel}
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
                onShowArrowHint={game.revealAcademyHint}
              />
            )}

            {activeTab === 'analysis' &&
              (game.isAssistanceHidden ? (
                <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3.5 text-xs text-stone-700 dark:text-[#d5d4d0]">
                  <strong className="block font-extrabold text-amber-800 dark:text-amber-300">
                    Game Review Locked During Active Rated Match
                  </strong>
                  Finish or resign the current competitive match to unlock the Evaluation Graph, Accuracy %, and Move Coach breakdown.
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
                <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3.5 text-xs text-stone-700 dark:text-[#d5d4d0]">
                  <strong className="block font-extrabold text-amber-800 dark:text-amber-300">
                    Opening Explorer Locked During Active Rated Match
                  </strong>
                  Switch to Coach Mode or finish the current match to browse master continuations.
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

            {/* Move Notation Table (shown in Play, Review, Openings, Settings) */}
            {activeTab !== 'puzzles' && activeTab !== 'academy' && (
              <MoveList
                history={game.history}
                activePly={game.activePly}
                onSelectPly={(ply) => {
                  game.selectPly(ply);
                }}
                onCopyFen={copyFen}
              />
            )}
          </div>

          {/* Pinned Bottom Chess.com Transport & Action Bar */}
          <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-stone-200 bg-stone-100 px-3.5 py-2.5 dark:border-black/40 dark:bg-[#1f1e1b]">
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="First move"
                aria-label="First move"
                disabled={game.activePly === 0}
                onClick={game.stepFirst}
                className="rounded-md bg-white px-2.5 py-1.5 font-mono text-xs font-extrabold text-stone-700 shadow-2xs transition hover:bg-stone-50 disabled:opacity-35 dark:bg-[#2c2b28] dark:text-[#d5d4d0] dark:hover:bg-[#383632]"
              >
                |◀
              </button>
              <button
                type="button"
                title="Previous move"
                aria-label="Previous move"
                disabled={game.activePly === 0}
                onClick={game.stepPrev}
                className="rounded-md bg-white px-2.5 py-1.5 font-mono text-xs font-extrabold text-stone-700 shadow-2xs transition hover:bg-stone-50 disabled:opacity-35 dark:bg-[#2c2b28] dark:text-[#d5d4d0] dark:hover:bg-[#383632]"
              >
                ◀
              </button>
              <button
                type="button"
                title="Next move"
                aria-label="Next move"
                disabled={game.activePly >= game.history.length}
                onClick={game.stepNext}
                className="rounded-md bg-white px-2.5 py-1.5 font-mono text-xs font-extrabold text-stone-700 shadow-2xs transition hover:bg-stone-50 disabled:opacity-35 dark:bg-[#2c2b28] dark:text-[#d5d4d0] dark:hover:bg-[#383632]"
              >
                ▶
              </button>
              <button
                type="button"
                title="Latest position"
                aria-label="Latest position"
                disabled={!game.isViewingHistory}
                onClick={game.stepLast}
                className="rounded-md bg-white px-2.5 py-1.5 font-mono text-xs font-extrabold text-stone-700 shadow-2xs transition hover:bg-stone-50 disabled:opacity-35 dark:bg-[#2c2b28] dark:text-[#d5d4d0] dark:hover:bg-[#383632]"
              >
                ▶|
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                title="Takeback move"
                disabled={
                  game.history.length === 0 ||
                  game.isAssistanceHidden ||
                  game.mode === 'puzzle'
                }
                onClick={game.takeback}
                className="rounded-md bg-white px-2.5 py-1.5 text-xs font-bold text-stone-700 shadow-2xs transition hover:bg-stone-50 disabled:opacity-35 dark:bg-[#2c2b28] dark:text-[#d5d4d0] dark:hover:bg-[#383632]"
              >
                Undo
              </button>
              <button
                type="button"
                title="Flip board"
                onClick={game.flipBoard}
                className="rounded-md bg-white px-2.5 py-1.5 text-xs font-bold text-stone-700 shadow-2xs transition hover:bg-stone-50 dark:bg-[#2c2b28] dark:text-[#d5d4d0] dark:hover:bg-[#383632]"
              >
                Flip
              </button>
              <button
                type="button"
                onClick={() => {
                  if (game.mode === 'puzzle') {
                    game.nextPuzzle();
                  } else {
                    game.newGame();
                  }
                }}
                className="btn-chess-green rounded-md px-3 py-1.5 text-xs font-extrabold"
              >
                {game.mode === 'puzzle' ? 'Next Puzzle' : 'New Game'}
              </button>
            </div>
          </footer>
        </section>
      </main>
    </div>
  );
}
