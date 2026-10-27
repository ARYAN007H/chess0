import { useEffect, useMemo, useState } from 'react';
import { useChessGame } from './useChessGame';
import type { Side } from './useChessGame';
import { LEVEL_LABELS } from './useChessGame';
import { BoardPanel } from './components/BoardPanel';
import { EvalBar } from './components/EvalBar';
import { PlayerCard, materialStatus } from './components/PlayerCard';
import { EngineInfo } from './components/EngineInfo';
import { MoveList } from './components/MoveList';
import { Controls } from './components/Controls';
import { PromotionDialog } from './components/PromotionDialog';
import { ResultModal } from './components/ResultModal';
import { parseSquare, squareName } from './engine/engine';
import { moveCaptured } from './engine/types';

const REPO_URL = 'https://github.com/ARYAN007H/chess0';

function shortLevel(level: keyof typeof LEVEL_LABELS): string {
  switch (level) {
    case 'random':
      return 'Random';
    case 'beginner':
      return 'Beginner';
    case 'intermediate':
      return 'Intermediate';
    case 'full':
      return 'Full strength';
    case 'v2':
      return 'v2 · strongest';
  }
}

export default function App() {
  const game = useChessGame();
  const [resultDismissed, setResultDismissed] = useState(false);
  const [fenCopied, setFenCopied] = useState(false);

  useEffect(() => {
    setResultDismissed(false);
  }, [game.gameEnd]);

  const engine = game.engineRef.current;

  // Board-derived view data.
  const targets = useMemo(() => {
    if (game.selected === null || engine === null) return { dots: new Set<string>(), captures: new Set<string>() };
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
  }, [game.selected, game.fen]);

  const checkSquare = useMemo(() => {
    if (engine === null) return null;
    if (!engine.inCheck()) return null;
    return squareName(engine.pos.kingSq[engine.stm]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.fen, game.gameEnd]);

  const counts = useMemo(() => engine?.pieceCounts() ?? null, [game.fen, engine]);
  const material = useMemo(() => (counts !== null ? materialStatus(counts) : null), [counts]);

  const copyFen = () => {
    void navigator.clipboard?.writeText(game.fen).catch(() => {});
    setFenCopied(true);
    window.setTimeout(() => setFenCopied(false), 1200);
  };

  const topSide: Side = game.orientation === 'white' ? 'black' : 'white';
  const bottomSide: Side = game.orientation === 'white' ? 'white' : 'black';

  const playerName = (side: Side): string => {
    const engineName = game.levels[side] === 'v2' ? 'Chess0 v2' : 'Chess0';
    if (game.mode === 'eve') return `${engineName} (${side})`;
    return side === game.playerSide ? 'You' : engineName;
  };
  const playerSubtitle = (side: Side): string => {
    if (game.mode === 'eve') return shortLevel(game.levels[side]);
    if (side === game.playerSide) return side === 'white' ? 'White' : 'Black';
    return `Engine · ${shortLevel(game.levels[side])}`;
  };

  const cardProps = (side: Side) => ({
    side,
    name: playerName(side),
    subtitle: playerSubtitle(side),
    isTurn: game.stmSide === side && game.gameEnd === null,
    thinking: game.thinkingSide === side,
    captured: material === null ? [] : side === 'white' ? material.whiteCaptured : material.blackCaptured,
    materialDiff: material === null ? 0 : side === 'white' ? material.whiteDiff : -material.whiteDiff,
    dark: side === 'black',
  });

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl px-4 pb-10 pt-5">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-2xl text-white shadow-lg shadow-sky-500/25">
              ♞
            </span>
            <div>
              <h1 className="text-xl font-black tracking-tight">
                Chess<span className="text-sky-500">0</span>
              </h1>
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                from-scratch engine · perft-verified · Web Worker
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              title={game.soundOn ? 'Mute sounds' : 'Enable sounds'}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/70 text-base transition hover:border-sky-400 dark:border-slate-700 dark:bg-slate-900/60"
              onClick={() => game.setSoundOn(!game.soundOn)}
            >
              {game.soundOn ? '🔊' : '🔇'}
            </button>
            <button
              title="Toggle dark mode"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/70 text-base transition hover:border-sky-400 dark:border-slate-700 dark:bg-slate-900/60"
              onClick={() => game.setTheme(game.theme === 'dark' ? 'light' : 'dark')}
            >
              {game.theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              title="Source code"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/70 transition hover:border-sky-400 dark:border-slate-700 dark:bg-slate-900/60"
            >
              <svg viewBox="0 0 16 16" className="h-5 w-5 fill-current" aria-hidden>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
            </a>
          </div>
        </header>

        {/* Main layout */}
        <main className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(340px,1fr)_370px]">
          {/* Board column */}
          <section className="space-y-2">
            <PlayerCard {...cardProps(topSide)} />
            <div className="relative flex items-stretch gap-3">
              <div className="flex w-8 shrink-0 flex-col pb-6">
                <EvalBar evalPov={game.evalPov} orientation={game.orientation} />
              </div>
              <div className="relative min-w-0 flex-1">
                <BoardPanel
                  fen={game.fen}
                  orientation={game.orientation}
                  selected={game.selected}
                  legalTargets={targets.dots}
                  captureTargets={targets.captures}
                  lastMove={game.lastMove}
                  checkSquare={checkSquare}
                  pvArrow={game.pvArrow}
                  gameId={game.gameId}
                  dark={game.theme === 'dark'}
                  onSquareClick={game.onSquareClick}
                  onPieceDrop={game.onPieceDrop}
                />
                {game.promotion !== null && (
                  <PromotionDialog side={game.stmSide} onChoose={game.choosePromotion} />
                )}
                {game.gameEnd !== null && !resultDismissed && (
                  <ResultModal
                    gameEnd={game.gameEnd}
                    onNewGame={() => game.newGame()}
                    onDismiss={() => setResultDismissed(true)}
                  />
                )}
              </div>
            </div>
            <PlayerCard {...cardProps(bottomSide)} />
          </section>

          {/* Side panel */}
          <aside className="space-y-3">
            <Controls
              mode={game.mode}
              playerSide={game.playerSide}
              levels={game.levels}
              eveRunning={game.eveRunning}
              autoFlip={game.autoFlip}
              canTakeback={game.mode === 'hve' && game.history.length > 0}
              onSwitchMode={game.switchMode}
              onChooseSide={game.chooseSide}
              onSetEngineLevel={game.setEngineLevel}
              onToggleEve={game.toggleEve}
              onSetAutoFlip={game.setAutoFlipAndApply}
              onNewGame={() => game.newGame()}
              onTakeback={game.takeback}
              onFlip={game.flipBoard}
              onCopyFen={copyFen}
              onLoadFen={game.loadFen}
            />
            <EngineInfo info={game.engineInfo} thinkingSide={game.thinkingSide} />
            <div>
              <h3 className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Moves {fenCopied && <span className="ml-2 font-semibold normal-case text-emerald-500">FEN copied to clipboard</span>}
              </h3>
              <MoveList history={game.history} />
            </div>
          </aside>
        </main>

        <footer className="mt-8 text-center text-[11px] text-slate-400 dark:text-slate-500">
          Every rule, move and search on this page is hand-written TypeScript — no chess.js, no engine libraries.
          Rules verified by 20M+ perft nodes; search runs at ~1.5M nodes/s in a Web Worker.
        </footer>
      </div>
    </div>
  );
}
