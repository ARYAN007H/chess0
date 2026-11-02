import type { EnginePanelInfo, Side } from '../useChessGame';
import type { MultiPvLine } from '../engine/search';

interface EngineInfoProps {
  info: EnginePanelInfo;
  thinkingSide: Side | null;
  stmSide: Side;
  canPlayMove: boolean;
  showMultiPvArrows: boolean;
  onToggleArrows: (show: boolean) => void;
  onPlayUciMove: (uci: string) => void;
  onAnalyzeDeeper: () => void;
}

function fmtCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

function formatLineScore(
  line: { scoreCp?: number; scoreMate?: number },
  stmSide: Side,
): { text: string; positive: boolean } {
  const sign = stmSide === 'white' ? 1 : -1;
  if (line.scoreMate !== undefined) {
    const m = line.scoreMate * sign;
    return {
      text: `${m > 0 ? '+' : '−'}M${Math.abs(m)}`,
      positive: m >= 0,
    };
  }
  const cp = (line.scoreCp ?? 0) * sign;
  return {
    text: `${cp > 0 ? '+' : cp < 0 ? '−' : ''}${(Math.abs(cp) / 100).toFixed(2)}`,
    positive: cp >= 0,
  };
}

const RANK_ACCENTS: Record<number, { dot: string; label: string }> = {
  1: { dot: 'bg-emerald-500', label: '#1 Best Pick' },
  2: { dot: 'bg-sky-500', label: '#2 Candidate' },
  3: { dot: 'bg-amber-500', label: '#3 Candidate' },
};

export function EngineInfo({
  info,
  thinkingSide,
  stmSide,
  canPlayMove,
  showMultiPvArrows,
  onToggleArrows,
  onPlayUciMove,
  onAnalyzeDeeper,
}: EngineInfoProps) {
  const lines: MultiPvLine[] =
    info.multiPv.length > 0
      ? info.multiPv
      : info.pvSan.length > 0
        ? [
            {
              rank: 1,
              move: 0,
              scoreCp: info.scoreCp,
              scoreMate: info.scoreMate,
              pvSan: info.pvSan,
              pvUci: info.pvUci,
              uci: info.pvUci[0] ?? '',
              san: info.pvSan[0] ?? '',
              selected: true,
            },
          ]
        : [];

  return (
    <div className="space-y-3 rounded-xl border border-stone-200/90 bg-white/85 p-3.5 dark:border-slate-800 dark:bg-slate-900/60">
      {/* Header & Telemetry Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200/80 pb-2.5 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
              Chess0 v3 · 3-Line Multi-PV
            </h3>
            { (thinkingSide !== null || info.thinking) && (
              <span className="animate-thinking font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                searching…
              </span>
            )}
          </div>
          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
            Depth {info.depth}
            {info.seldepth > info.depth ? `/${info.seldepth}` : ''} ·{' '}
            {info.nodes > 0 ? `${fmtCount(info.nodes)} nodes` : '0 nodes'} ·{' '}
            {info.nps > 0 ? `${fmtCount(info.nps)} n/s` : 'ready'}
            {info.bookOpening ? ` · ${info.bookOpening}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onToggleArrows(!showMultiPvArrows)}
            title="Toggle 3-line candidate arrows on the board"
            className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
              showMultiPvArrows
                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-stone-300 bg-transparent text-slate-500 hover:text-slate-800 dark:border-slate-700 dark:text-slate-400'
            }`}
          >
            3-Line Arrows
          </button>
          <button
            type="button"
            onClick={onAnalyzeDeeper}
            title="Run deep 3-line search on this position"
            className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-emerald-500 hover:text-emerald-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-emerald-500 dark:hover:text-emerald-400"
          >
            Deep Scan
          </button>
        </div>
      </div>

      {/* 3 Candidate Lines Comparison */}
      <div className="space-y-1.5">
        {[1, 2, 3].map((rank) => {
          const line = lines.find((l) => l.rank === rank);
          const accent = RANK_ACCENTS[rank];
          if (!line) {
            return (
              <div
                key={rank}
                className="flex items-center justify-between rounded-lg border border-dashed border-stone-200/80 px-2.5 py-2 text-xs text-slate-400 dark:border-slate-800/80 dark:text-slate-600"
              >
                <span className="font-mono text-[11px]">Line #{rank}</span>
                <span className="text-[11px]">Awaiting candidate line…</span>
              </div>
            );
          }

          const score = formatLineScore(line, stmSide);
          const isBest = rank === 1;

          return (
            <div
              key={rank}
              className={`group rounded-lg border px-2.5 py-2 transition ${
                isBest
                  ? 'border-emerald-500/40 bg-emerald-500/[0.06] dark:border-emerald-500/35 dark:bg-emerald-500/[0.08]'
                  : 'border-stone-200/80 bg-stone-50/70 dark:border-slate-800 dark:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${accent.dot}`} />
                  <span
                    className={`font-mono text-xs font-bold tabular-nums ${
                      score.positive
                        ? 'text-slate-900 dark:text-slate-100'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {score.text}
                  </span>
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    · {accent.label}
                  </span>
                  {line.san && (
                    <span className="font-mono text-xs font-bold text-emerald-700 dark:text-emerald-300">
                      {line.san}
                    </span>
                  )}
                </div>

                {canPlayMove && line.uci && (
                  <button
                    type="button"
                    onClick={() => onPlayUciMove(line.uci)}
                    className="shrink-0 rounded border border-stone-300 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-700 opacity-85 transition hover:border-emerald-500 hover:text-emerald-600 group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-emerald-400"
                  >
                    Play {line.san}
                  </button>
                )}
              </div>

              <div className="mt-1 truncate font-mono text-[11px] text-slate-600 dark:text-slate-400">
                {line.pvSan.slice(0, 10).join(' ')}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
