import { useMemo } from 'react';

interface EvalBarProps {
  evalPov: { cp?: number; mate?: number };
  orientation: 'white' | 'black';
  locked?: boolean;
}

/** Map centipawns to a white-share percentage with a smooth win-probability sigmoid. */
function whiteShare(ev: { cp?: number; mate?: number }): number {
  if (ev.mate !== undefined) return ev.mate > 0 ? 100 : 0;
  const cp = Math.max(-1600, Math.min(1600, ev.cp ?? 0));
  return 100 / (1 + Math.exp(-0.00368 * cp));
}

function label(ev: { cp?: number; mate?: number }): string {
  if (ev.mate !== undefined) return `${ev.mate > 0 ? '+' : '−'}M${Math.abs(ev.mate)}`;
  const cp = ev.cp ?? 0;
  return `${cp > 0 ? '+' : cp < 0 ? '−' : ''}${(Math.abs(cp) / 100).toFixed(1)}`;
}

export function EvalBar({ evalPov, orientation, locked }: EvalBarProps) {
  const share = useMemo(() => (locked ? 50 : whiteShare(evalPov)), [evalPov, locked]);
  const whiteAtBottom = orientation === 'white';
  const whiteAhead = (evalPov.mate !== undefined ? evalPov.mate : (evalPov.cp ?? 0)) >= 0;

  return (
    <div
      className="flex h-full flex-col items-center gap-1.5 select-none"
      title={locked ? 'Evaluation locked during Competitive / Live PvP match' : undefined}
    >
      <div className="relative flex w-6 flex-1 flex-col overflow-hidden rounded-lg border border-stone-300/80 bg-[#18202c] shadow-inner dark:border-slate-700/80 dark:bg-[#131924]">
        <div className={`flex h-full w-full flex-col ${whiteAtBottom ? 'flex-col-reverse' : ''}`}>
          <div
            className="w-full bg-[#f4f1ea] transition-[height] duration-300 ease-out dark:bg-slate-200"
            style={{ height: `${share}%` }}
          />
          <div className="w-full flex-1 bg-[#1e2634] transition-all duration-300 ease-out dark:bg-[#151c28]" />
        </div>
        {/* Equal evaluation tick mark */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[1.5px] bg-emerald-500/70" />
      </div>
      <span
        className={`w-11 text-center font-mono text-[10px] font-bold tabular-nums tracking-tight ${
          locked
            ? 'text-amber-600 dark:text-amber-400'
            : whiteAhead
              ? 'text-slate-800 dark:text-slate-200'
              : 'text-slate-500 dark:text-slate-400'
        }`}
      >
        {locked ? 'LOCK' : label(evalPov)}
      </span>
    </div>
  );
}
