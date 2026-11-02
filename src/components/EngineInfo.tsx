import type { CoachSuggestion, EnginePanelInfo, Side } from '../useChessGame';
import type { MultiPvLine } from '../engine/search';

interface EngineInfoProps {
  info: EnginePanelInfo;
  coachSuggestions?: CoachSuggestion[];
  isLearnMode?: boolean;
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
  1: { dot: 'bg-[#81b64c]', label: 'Best Move' },
  2: { dot: 'bg-sky-400', label: '2nd Choice' },
  3: { dot: 'bg-amber-400', label: '3rd Idea' },
};

export function EngineInfo({
  info,
  coachSuggestions = [],
  isLearnMode = false,
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
    <div className="space-y-2.5 rounded-xl border border-stone-200/90 bg-stone-50/80 p-3 dark:border-white/10 dark:bg-[#1f1e1b]">
      {/* Header & Telemetry Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200/80 pb-2 dark:border-white/10">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[11px] font-extrabold tracking-wider text-stone-800 uppercase dark:text-[#f8f8f6]">
              {isLearnMode ? 'Coach Move Suggestions (3 Lines)' : 'Chess0 v3 · 3-Line Multi-PV'}
            </h3>
            {(thinkingSide !== null || info.thinking) && (
              <span className="animate-thinking font-mono text-[10px] font-bold text-[#81b64c]">
                calculating…
              </span>
            )}
          </div>
          <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-stone-500 dark:text-[#989795]">
            Depth {info.depth}
            {info.seldepth > info.depth ? `/${info.seldepth}` : ''} ·{' '}
            {info.nodes > 0 ? `${fmtCount(info.nodes)} nodes` : 'ready'}
            {info.nps > 0 ? ` · ${fmtCount(info.nps)} n/s` : ''}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onToggleArrows(!showMultiPvArrows)}
            title="Toggle 3-line candidate arrows on the board"
            className={`rounded-md px-2 py-1 text-[10.5px] font-bold transition ${
              showMultiPvArrows
                ? 'bg-[#81b64c]/20 text-[#629924] ring-1 ring-[#81b64c]/50 dark:text-[#a3d160]'
                : 'bg-stone-200/80 text-stone-600 dark:bg-[#302e2b] dark:text-[#989795]'
            }`}
          >
            {showMultiPvArrows ? 'Arrows On' : 'Arrows Off'}
          </button>
          <button
            type="button"
            onClick={onAnalyzeDeeper}
            title="Run deep 3-line search on this position"
            className="rounded-md bg-stone-200/80 px-2 py-1 text-[10.5px] font-bold text-stone-700 transition hover:bg-[#81b64c] hover:text-white dark:bg-[#302e2b] dark:text-[#bababa] dark:hover:bg-[#81b64c] dark:hover:text-white"
          >
            Deep Scan
          </button>
        </div>
      </div>

      {/* 3 Candidate Lines Comparison */}
      <div className="space-y-1.5">
        {[1, 2, 3].map((rank) => {
          const line = lines.find((l) => l.rank === rank);
          const coachSug = coachSuggestions.find((c) => c.rank === rank);
          const accent = RANK_ACCENTS[rank];
          if (!line) {
            return (
              <div
                key={rank}
                className="flex items-center justify-between rounded-lg border border-dashed border-stone-200/80 px-2.5 py-2 text-xs text-stone-400 dark:border-white/10 dark:text-[#7c7a77]"
              >
                <span className="font-mono text-[11px]">Line #{rank}</span>
                <span className="text-[11px]">Evaluating candidate line…</span>
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
                  ? 'border-[#81b64c]/50 bg-[#81b64c]/10 dark:border-[#81b64c]/40 dark:bg-[#81b64c]/[0.12]'
                  : 'border-stone-200/80 bg-white dark:border-white/5 dark:bg-[#262522]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${accent.dot}`} />
                  {line.san && (
                    <span className="font-mono text-xs font-black text-stone-900 dark:text-white">
                      {line.san}
                    </span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] font-bold tabular-nums ${
                      score.positive
                        ? 'bg-stone-200/80 text-stone-900 dark:bg-[#f8f8f6] dark:text-[#262522]'
                        : 'bg-stone-800 text-white dark:bg-[#141412] dark:text-[#bababa]'
                    }`}
                  >
                    {score.text}
                  </span>
                  <span className="truncate text-[10.5px] font-bold text-stone-500 dark:text-[#989795]">
                    {accent.label}
                  </span>
                </div>

                {canPlayMove && line.uci && (
                  <button
                    type="button"
                    onClick={() => onPlayUciMove(line.uci)}
                    className="shrink-0 rounded-md bg-[#81b64c] px-2.5 py-1 text-[10.5px] font-extrabold text-white shadow-xs transition hover:bg-[#72a341]"
                  >
                    Play {line.san}
                  </button>
                )}
              </div>

              {coachSug?.explanation && (
                <p className="mt-1 text-[11px] leading-snug text-stone-600 dark:text-[#d4d4d0]">
                  {coachSug.explanation}
                </p>
              )}

              <div className="mt-1 truncate font-mono text-[10.5px] text-stone-400 dark:text-[#8b8986]">
                Line: {line.pvSan.slice(0, 8).join(' ')}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


