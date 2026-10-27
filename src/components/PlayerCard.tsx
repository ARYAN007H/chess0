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
  /** Pieces this side has captured (glyphs of the opponent). */
  captured: number[];
  materialDiff: number; // positive = this side is ahead
  dark: boolean;
}

export function PlayerCard({ side, name, subtitle, isTurn, thinking, captured, materialDiff, dark }: PlayerCardProps) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 transition-colors ${
        isTurn
          ? 'border-sky-400/70 bg-sky-50 dark:border-sky-500/50 dark:bg-sky-950/40'
          : 'border-slate-200 bg-white/70 dark:border-slate-700/60 dark:bg-slate-900/50'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-lg ${
            side === 'white'
              ? 'bg-slate-100 text-slate-800 shadow-inner dark:bg-slate-200'
              : 'bg-slate-800 text-slate-100 shadow-inner dark:bg-slate-950 dark:ring-1 dark:ring-slate-600'
          }`}
        >
          {side === 'white' ? '♔' : '♚'}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate text-sm font-semibold">
            {name}
            {thinking && (
              <span className="animate-thinking text-xs font-bold text-sky-500" title="engine is thinking">
                ●●●
              </span>
            )}
          </div>
          {subtitle !== undefined && subtitle !== '' && (
            <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {materialDiff > 0 && <span className="text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">+{materialDiff}</span>}
        <span className={`text-lg leading-none ${dark ? 'text-slate-900' : 'text-slate-700 dark:text-slate-200'}`}>
          {captured.map((t, i) => (
            <span key={i}>{GLYPHS[t]}</span>
          ))}
        </span>
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
  // Sort captures by value for a tidy display.
  const byValue = (a: number, b: number) => VALUES[a] - VALUES[b];
  whiteCaptured.sort(byValue);
  blackCaptured.sort(byValue);
  return { whiteCaptured, blackCaptured, whiteDiff };
}
