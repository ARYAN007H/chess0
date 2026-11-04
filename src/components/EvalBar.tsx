import { useMemo } from 'react';

interface EvalBarProps {
  evalPov: { cp?: number; mate?: number };
  orientation: 'white' | 'black';
  locked?: boolean;
  heightPx?: number;
}

/** Map centipawns to a white-share percentage with a smooth win-probability sigmoid. */
function whiteShare(ev: { cp?: number; mate?: number }): number {
  if (ev.mate !== undefined) return ev.mate > 0 ? 100 : 0;
  const cp = Math.max(-1600, Math.min(1600, ev.cp ?? 0));
  return 100 / (1 + Math.exp(-0.00368 * cp));
}

function label(ev: { cp?: number; mate?: number }): string {
  if (ev.mate !== undefined) return `M${Math.abs(ev.mate)}`;
  const cp = ev.cp ?? 0;
  return (Math.abs(cp) / 100).toFixed(1);
}

export function EvalBar({ evalPov, orientation, locked, heightPx }: EvalBarProps) {
  const share = useMemo(() => (locked ? 50 : whiteShare(evalPov)), [evalPov, locked]);
  const whiteAtBottom = orientation === 'white';
  const whiteAhead = (evalPov.mate !== undefined ? evalPov.mate : (evalPov.cp ?? 0)) >= 0;

  return (
    <div
      className="relative flex w-6 shrink-0 flex-col overflow-hidden rounded-md bg-[#403d39] shadow-card ring-1 ring-black/25 select-none"
      style={heightPx ? { height: `${heightPx}px` } : { height: '100%' }}
      title={locked ? 'Evaluation hidden during Competitive / Puzzle play' : undefined}
    >
      <div className={`flex h-full w-full flex-col ${whiteAtBottom ? 'flex-col-reverse' : ''}`}>
        <div
          className="w-full bg-[#ffffff] transition-[height] duration-300 ease-out"
          style={{ height: `${share}%` }}
        />
        <div className="w-full flex-1 bg-[#403d39] transition-all duration-300 ease-out" />
      </div>

      {/* Center equality tick */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[1.5px] bg-[#81b64c]/60" />

      {/* Score label pinned inside top or bottom of the bar like Chess.com */}
      {!locked && (
        <span
          className={`pointer-events-none absolute inset-x-0 text-center font-mono text-2xs font-extrabold tracking-tighter tabular-nums ${
            (whiteAhead && whiteAtBottom) || (!whiteAhead && !whiteAtBottom)
              ? 'bottom-1.5 text-[#403d39]'
              : 'top-1.5 text-[#ffffff]'
          }`}
        >
          {label(evalPov)}
        </span>
      )}
    </div>
  );
}

