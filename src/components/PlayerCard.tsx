import type { Side } from '../useChessGame';
import type { PieceCounts } from '../engine/engine';

const VALUES: Record<number, number> = { 1: 1, 2: 3, 3: 3, 4: 5, 5: 9, 6: 0 };
const GLYPHS: Record<number, string> = { 1: '♟', 2: '♞', 3: '♝', 4: '♜', 5: '♛' };

interface PlayerCardProps {
  side: Side;
  name: string;
  subtitle?: string;
  badge?: string;
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
  badge,
  isTurn,
  thinking,
  captured,
  materialDiff,
  accuracy,
}: PlayerCardProps) {
  return (
    <div className="flex h-11 w-full items-center justify-between gap-3 px-0.5 select-none">
      <div className="flex min-w-0 items-center gap-2.5">
        {/* Square avatar tile, themed like the board squares */}
        <div
          className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg font-bold shadow-card ring-1 transition ${
            side === 'white'
              ? 'bg-[#ebecd0] text-[#302e2b] ring-black/15'
              : 'bg-[#1f1e1b] text-[#ebecd0] ring-white/15'
          } ${isTurn ? 'ring-2 ring-accent' : ''}`}
        >
          {side === 'white' ? '♔' : '♚'}
          {isTurn && (
            <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-bg" />
          )}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {badge && (
              <span className="shrink-0 rounded bg-[#b33430] px-1.5 py-0.5 font-mono text-2xs font-extrabold tracking-wide text-white uppercase">
                {badge}
              </span>
            )}
            <span className="truncate text-sm font-bold text-ink">{name}</span>
            {subtitle && (
              <span className="hidden truncate text-xs font-medium text-ink-3 sm:inline">
                ({subtitle})
              </span>
            )}
            {thinking && (
              <span className="animate-thinking ml-1 inline-flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-2xs font-bold text-accent-text">
                thinking…
              </span>
            )}
          </div>

          {/* Net material advantage row */}
          <div className="flex items-center gap-1.5 text-xs leading-none">
            {captured.length > 0 ? (
              <span className="flex items-center text-sm leading-none tracking-tighter text-ink-2">
                {captured.slice(0, 10).map((t, i) => (
                  <span key={i}>{GLYPHS[t]}</span>
                ))}
              </span>
            ) : (
              <span className="text-2xs text-ink-3 sm:hidden">{subtitle}</span>
            )}
            {materialDiff > 0 && (
              <span className="font-mono text-2xs font-bold tabular-nums text-ink-2">
                +{materialDiff}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right side: accuracy pill or turn status pill */}
      <div className="flex shrink-0 items-center gap-2">
        {accuracy !== undefined && accuracy !== null && (
          <div className="rounded-md border border-line bg-sunken px-2 py-1 font-mono text-xs font-extrabold tabular-nums text-ink">
            {accuracy.toFixed(1)}%
          </div>
        )}
        <div
          className={`flex h-7 items-center rounded-md border px-2.5 font-mono text-xs font-bold tabular-nums ${
            isTurn
              ? 'border-transparent bg-ink text-bg'
              : 'border-line bg-sunken text-ink-3'
          }`}
        >
          {thinking ? '•••' : isTurn ? 'Turn' : 'Wait'}
        </div>
      </div>
    </div>
  );
}

/**
 * Compute Chess.com-style net material imbalance between White and Black.
 * Only shows excess piece types on the side that has more of that piece,
 * avoiding 12-icon clutter in endgames and puzzles.
 */
export function materialStatus(counts: PieceCounts): {
  whiteCaptured: number[];
  blackCaptured: number[];
  whiteDiff: number;
} {
  const whiteCaptured: number[] = [];
  const blackCaptured: number[] = [];
  let whitePointTotal = 0;
  let blackPointTotal = 0;

  for (let t = 1; t <= 5; t++) {
    const wCount = counts.white[t] ?? 0;
    const bCount = counts.black[t] ?? 0;
    whitePointTotal += wCount * VALUES[t];
    blackPointTotal += bCount * VALUES[t];

    if (wCount > bCount) {
      for (let i = 0; i < wCount - bCount; i++) whiteCaptured.push(t);
    } else if (bCount > wCount) {
      for (let i = 0; i < bCount - wCount; i++) blackCaptured.push(t);
    }
  }

  const byValue = (a: number, b: number) => VALUES[a] - VALUES[b];
  whiteCaptured.sort(byValue);
  blackCaptured.sort(byValue);

  return {
    whiteCaptured,
    blackCaptured,
    whiteDiff: whitePointTotal - blackPointTotal,
  };
}
