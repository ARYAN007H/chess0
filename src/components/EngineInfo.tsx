import type { EnginePanelInfo } from '../useChessGame';
import type { Side } from '../useChessGame';

interface EngineInfoProps {
  info: EnginePanelInfo;
  thinkingSide: Side | null;
}

function fmtCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

function scoreText(info: EnginePanelInfo): string {
  if (info.scoreMate !== undefined) return `${info.scoreMate > 0 ? '+' : '−'}M${Math.abs(info.scoreMate)}`;
  if (info.scoreCp === undefined) return '—';
  const cp = info.scoreCp;
  return `${cp > 0 ? '+' : cp < 0 ? '−' : ''}${(Math.abs(cp) / 100).toFixed(2)}`;
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-lg bg-slate-100 px-2.5 py-1.5 dark:bg-slate-800/70 ${wide ? 'col-span-2' : ''}`}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      <div className="truncate text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function EngineInfo({ info, thinkingSide }: EngineInfoProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/70 p-3 dark:border-slate-700/60 dark:bg-slate-900/50">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Engine</h3>
        <span
          className={`flex items-center gap-1.5 text-[11px] font-semibold ${
            thinkingSide !== null ? 'text-sky-500' : 'text-slate-400 dark:text-slate-500'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${thinkingSide !== null ? 'animate-pulse bg-sky-500' : 'bg-slate-300 dark:bg-slate-600'}`}
          />
          {thinkingSide !== null ? `thinking (${thinkingSide})` : 'idle'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Stat label="depth" value={`${info.depth}${info.seldepth > info.depth ? `/${info.seldepth}` : ''}`} />
        <Stat label="score" value={scoreText(info)} />
        <Stat label="nodes" value={info.nodes > 0 ? fmtCount(info.nodes) : '—'} />
        <Stat label="speed" value={info.nps > 0 ? `${fmtCount(info.nps)} n/s` : '—'} />
        <div className="col-span-2 rounded-lg bg-slate-100 px-2.5 py-1.5 dark:bg-slate-800/70">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
            best line (SAN)
          </div>
          <div className="min-h-[1.25rem] text-sm font-medium leading-snug">
            {info.pvSan.length > 0 ? info.pvSan.slice(0, 10).join(' ') : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}
