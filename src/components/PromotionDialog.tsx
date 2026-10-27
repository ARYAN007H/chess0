import type { Side } from '../useChessGame';

const GLYPHS: Record<number, string> = { 5: '♕', 4: '♖', 3: '♗', 2: '♘' };
const NAMES: Record<number, string> = { 5: 'Queen', 4: 'Rook', 3: 'Bishop', 2: 'Knight' };

interface PromotionDialogProps {
  side: Side;
  onChoose: (pieceType: number) => void;
}

export function PromotionDialog({ side, onChoose }: PromotionDialogProps) {
  return (
    <div className="animate-fade absolute inset-0 z-30 flex items-center justify-center bg-slate-950/40 backdrop-blur-[2px]">
      <div className="animate-pop rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-3 text-center text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Promote to
        </p>
        <div className="flex gap-2">
          {[5, 4, 3, 2].map((t) => (
            <button
              key={t}
              title={NAMES[t]}
              className={`flex h-16 w-16 items-center justify-center rounded-xl border text-5xl leading-none transition hover:scale-105 hover:border-sky-400 active:scale-95 ${
                side === 'white'
                  ? 'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-600 dark:bg-slate-100'
                  : 'border-slate-300 bg-slate-800 text-slate-100 dark:border-slate-500 dark:bg-slate-800'
              }`}
              onClick={() => onChoose(t)}
            >
              {GLYPHS[t]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
