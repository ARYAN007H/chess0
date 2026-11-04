import type { Side } from '../useChessGame';

const GLYPHS: Record<number, string> = { 5: '♕', 4: '♖', 3: '♗', 2: '♘' };
const NAMES: Record<number, string> = { 5: 'Queen', 4: 'Rook', 3: 'Bishop', 2: 'Knight' };

interface PromotionDialogProps {
  side: Side;
  onChoose: (pieceType: number) => void;
}

export function PromotionDialog({ side, onChoose }: PromotionDialogProps) {
  return (
    <div className="animate-fade absolute inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
      <div className="animate-pop rounded-2xl border border-line bg-surface p-4 shadow-board">
        <p className="micro-label mb-3 text-center">Promote to</p>
        <div className="flex gap-2">
          {[5, 4, 3, 2].map((t) => (
            <button
              key={t}
              title={NAMES[t]}
              className={`flex h-16 w-16 items-center justify-center rounded-xl border text-5xl leading-none transition hover:scale-105 hover:border-accent active:scale-95 ${
                side === 'white'
                  ? 'border-black/15 bg-[#ebecd0] text-[#302e2b]'
                  : 'border-white/15 bg-[#1f1e1b] text-[#ebecd0]'
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
