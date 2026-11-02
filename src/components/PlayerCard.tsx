import type { Side } from '../useChessGame';
import type { PieceCounts } from '../engine/engine';

const STARTING: Record<number, number> = { 1: 8, 2: 2, 3: 2, 4: 2, 5: 1, 6: 1 };
const VALUES: Record<number, number> = { 1: 1, 2: 3, 3: 3, 4: 5, 5: 9, 6: 0 };
const GLYPHS: Record<number, string> = { 1: '♟', 2: '♞', 3: '♝', 4: '♜', 5: '♛' };

interface PlayerCardProps {
  side: Side;
  name: string;
  subtitle?: string;
  isTurn: boolean;
  thinking: boolean;
  captured: number[];
  materialDiff: number;
  accuracy?: number | null;
}

export function PlayerCard({
  side,
  name,
  subtitle,
  isTurn,
  thinking,
  captured,
  materialDiff,
  accuracy,
}: PlayerCardProps) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2 transition-colors ${
        isTurn
          ? 'border-emerald-500/60 bg-white shadow-sm dark:border-emerald-500/45 dark:bg-slate-900/90'
          : 'border-stone-200/90 bg-white/75 dark:border-slate-800 dark:bg-slate-900/45'
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-lg ring-1 ${
            side === 'white'
              ? 'bg-[#f4f1ea] text-slate-900 ring-stone-300 dark:bg-slate-100 dark:ring-slate-300'
              : 'bg-slate-900 text-slate-100 ring-slate-700 dark:bg-slate-950 dark:ring-slate-700'
          }`}
        >
          {side === 'white' ? '♔' : '♚'}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 truncate text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">
            <span className="truncate">{name}</span>
            {thinking && (
              <span
                className="animate-thinking font-mono text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
                title="Engine is computing 3-line Multi-PV"
              >
                calculating…
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
            {subtitle && <span>{subtitle}</span>}
            {accuracy !== undefined && accuracy !== null && (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                  {accuracy.toFixed(1)}% acc
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {captured.length > 0 && (
          <span className="flex items-center text-base leading-none tracking-tighter text-slate-600 dark:text-slate-300">
            {captured.map((t, i) => (
              <span key={i}>{GLYPHS[t]}</span>
            ))}
          </span>
        )}
        {materialDiff > 0 && (
          <span className="font-mono text-xs font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            +{materialDiff}
          </span>
        )}
      </div>
    </div>
  );
}

/** Compute captured pieces and material advantage for both sides. */
export function materialStatus(counts: PieceCounts): {
  whiteCaptured: number[];
  blackCaptured: number[];
  whiteDiff: number;
} {
  const whiteCaptured: number[] = [];
  const blackCaptured: number[] = [];
  let whiteDiff = 0;
  for (let t = 1; t <= 5; t++) {
    const missingBlack = Math.max(0, STARTING[t] - counts.black[t]);
    const missingWhite = Math.max(0, STARTING[t] - counts.white[t]);
    for (let i = 0; i < missingBlack; i++) whiteCaptured.push(t);
    for (let i = 0; i < missingWhite; i++) blackCaptured.push(t);
    whiteDiff += (missingBlack - missingWhite) * VALUES[t];
  }
  const byValue = (a: number, b: number) => VALUES[a] - VALUES[b];
  whiteCaptured.sort(byValue);
  blackCaptured.sort(byValue);
  return { whiteCaptured, blackCaptured, whiteDiff };
}
