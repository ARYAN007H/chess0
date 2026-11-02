import type { GameEnd } from '../engine/engine';

interface ResultModalProps {
  gameEnd: GameEnd;
  customBanner?: { title: string; detail: string } | null;
  eloDelta?: number | null;
  compElo?: number;
  onNewGame: () => void;
  onDismiss: () => void;
}

function resultText(
  gameEnd: GameEnd,
  customBanner?: { title: string; detail: string } | null,
): { title: string; detail: string; icon: string } {
  if (customBanner) {
    return {
      title: customBanner.title,
      detail: customBanner.detail,
      icon: customBanner.title.startsWith('Draw') ? '½' : '♚',
    };
  }
  if (!gameEnd) {
    return { title: 'Match Finished', detail: '', icon: '♚' };
  }
  switch (gameEnd.type) {
    case 'checkmate':
      return {
        title: `${gameEnd.winner === 0 ? 'White' : 'Black'} wins`,
        detail: 'by checkmate',
        icon: '♚',
      };
    case 'stalemate':
      return { title: 'Draw', detail: 'by stalemate', icon: '½' };
    case 'fifty-move':
      return { title: 'Draw', detail: 'by the fifty-move rule', icon: '½' };
    case 'repetition':
      return { title: 'Draw', detail: 'by threefold repetition', icon: '½' };
    case 'insufficient-material':
      return { title: 'Draw', detail: 'by insufficient material', icon: '½' };
  }
}

export function ResultModal({
  gameEnd,
  customBanner,
  eloDelta,
  compElo,
  onNewGame,
  onDismiss,
}: ResultModalProps) {
  const { title, detail, icon } = resultText(gameEnd, customBanner);
  return (
    <div className="animate-fade absolute inset-0 z-30 flex items-center justify-center bg-slate-950/55 backdrop-blur-[2px]">
      <div className="animate-pop w-76 rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-1 text-5xl leading-none text-emerald-500">{icon}</div>
        <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">
          {title}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">{detail}</p>

        {eloDelta !== undefined && eloDelta !== null && compElo !== undefined && (
          <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 font-mono text-xs dark:border-slate-800 dark:bg-slate-800/70">
            Competitive Rating: <strong>{compElo}</strong>{' '}
            <span
              className={`font-bold ${
                eloDelta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'
              }`}
            >
              ({eloDelta >= 0 ? `+${eloDelta}` : eloDelta})
            </span>
          </div>
        )}

        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500 active:scale-95"
            onClick={onNewGame}
          >
            New Match
          </button>
          <button
            type="button"
            className="rounded-lg border border-stone-300 px-4 py-2 text-xs font-bold text-slate-700 transition hover:border-emerald-500 dark:border-slate-700 dark:text-slate-200"
            onClick={onDismiss}
          >
            Game Review
          </button>
        </div>
      </div>
    </div>
  );
}
