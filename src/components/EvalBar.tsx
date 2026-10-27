import { useMemo } from 'react';

interface EvalBarProps {
  evalPov: { cp?: number; mate?: number };
  orientation: 'white' | 'black';
}

/** Map centipawns to a white-share percentage with a smooth sigmoid. */
function whiteShare(ev: { cp?: number; mate?: number }): number {
  if (ev.mate !== undefined) return ev.mate > 0 ? 100 : 0;
  const cp = Math.max(-1500, Math.min(1500, ev.cp ?? 0));
  return 100 / (1 + Math.exp(-cp / 320));
}

function label(ev: { cp?: number; mate?: number }): string {
  if (ev.mate !== undefined) return `${ev.mate > 0 ? '+' : '-'}M${Math.abs(ev.mate)}`;
  const cp = ev.cp ?? 0;
  return `${cp > 0 ? '+' : cp < 0 ? '−' : ''}${(Math.abs(cp) / 100).toFixed(1)}`;
}

export function EvalBar({ evalPov, orientation }: EvalBarProps) {
  const share = useMemo(() => whiteShare(evalPov), [evalPov]);
  const whiteAtBottom = orientation === 'white';

  const whiteSeg = (
    <div
      className="w-full bg-slate-100 transition-[height] duration-500 ease-out dark:bg-slate-200"
      style={{ height: `${share}%` }}
    />
  );
  const blackSeg = (
    <div
      className="w-full flex-1 bg-slate-800 transition-[flex] duration-500 ease-out dark:bg-slate-700"
      style={{ flexGrow: 1 }}
    />
  );

  return (
    <div className="flex h-full flex-col items-center gap-1.5">
      <div className="relative flex w-6 flex-1 flex-col overflow-hidden rounded-full border border-slate-300 bg-slate-800 dark:border-slate-600 dark:bg-slate-700">
        <div className={`flex h-full w-full flex-col ${whiteAtBottom ? 'flex-col-reverse' : ''}`}>
          {whiteSeg}
          {blackSeg}
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-sky-400/60" />
      </div>
      <span className="w-10 text-center text-[10px] font-semibold tabular-nums text-slate-600 dark:text-slate-300">
        {label(evalPov)}
      </span>
    </div>
  );
}
