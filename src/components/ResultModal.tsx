import type { GameEnd } from '../engine/engine';

interface ResultModalProps {
  gameEnd: NonNullable<GameEnd>;
  onNewGame: () => void;
  onDismiss: () => void;
}

function resultText(gameEnd: NonNullable<GameEnd>): { title: string; detail: string; icon: string } {
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

export function ResultModal({ gameEnd, onNewGame, onDismiss }: ResultModalProps) {
  const { title, detail, icon } = resultText(gameEnd);
  return (
    <div className="animate-fade absolute inset-0 z-30 flex items-center justify-center bg-slate-950/50 backdrop-blur-[2px]">
      <div className="animate-pop w-72 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-1 text-5xl leading-none text-sky-500">{icon}</div>
        <h2 className="text-xl font-black tracking-tight">{title}</h2>
        <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">{detail}</p>
        <div className="flex justify-center gap-2">
          <button
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-400 active:scale-95"
            onClick={onNewGame}
          >
            New game
          </button>
          <button
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold transition hover:border-sky-400 dark:border-slate-600"
            onClick={onDismiss}
          >
            Review
          </button>
        </div>
      </div>
    </div>
  );
}
