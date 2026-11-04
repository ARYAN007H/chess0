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
    <div className="animate-fade absolute inset-0 z-30 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
      <div className="animate-pop w-76 rounded-2xl border border-line bg-surface p-6 text-center shadow-board">
        <div className="mb-1 text-5xl leading-none text-accent">{icon}</div>
        <h2 className="text-xl font-black tracking-tight text-ink">{title}</h2>
        <p className="text-sm text-ink-3">{detail}</p>

        {eloDelta !== undefined && eloDelta !== null && compElo !== undefined && (
          <div className="mt-3 rounded-lg border border-line bg-sunken px-3 py-1.5 font-mono text-xs text-ink">
            Competitive Rating: <strong>{compElo}</strong>{' '}
            <span
              className={`font-bold ${
                eloDelta >= 0 ? 'text-accent-text' : 'text-rose-500'
              }`}
            >
              ({eloDelta >= 0 ? `+${eloDelta}` : eloDelta})
            </span>
          </div>
        )}

        <div className="mt-5 flex justify-center gap-2">
          <button type="button" className="btn-primary px-4 py-2 text-xs" onClick={onNewGame}>
            New Match
          </button>
          <button type="button" className="btn-quiet px-4 py-2 text-xs" onClick={onDismiss}>
            Game Review
          </button>
        </div>
      </div>
    </div>
  );
}
