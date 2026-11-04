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
  1: { dot: 'bg-accent', label: 'Best Move' },
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
    <div className="panel-sunken space-y-2.5 p-3">
      {/* Header & telemetry bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-2xs font-extrabold tracking-wider text-ink uppercase">
              {isLearnMode ? 'Coach Move Suggestions (3 Lines)' : 'Chess0 v3 · 3-Line Multi-PV'}
            </h3>
            {(thinkingSide !== null || info.thinking) && (
              <span className="animate-thinking font-mono text-2xs font-bold text-accent-text">
                calculating…
              </span>
            )}
          </div>
          <p className="mt-0.5 font-mono text-2xs tabular-nums text-ink-3">
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
            className={`rounded-md px-2 py-1 text-2xs font-bold transition ${
              showMultiPvArrows
                ? 'bg-accent/15 text-accent-text ring-1 ring-accent/40'
                : 'border border-line bg-raised text-ink-2'
            }`}
          >
            {showMultiPvArrows ? 'Arrows On' : 'Arrows Off'}
          </button>
          <button
            type="button"
            onClick={onAnalyzeDeeper}
            title="Run deep 3-line search on this position"
            className="rounded-md border border-line bg-raised px-2 py-1 text-2xs font-bold text-ink-2 transition hover:bg-accent hover:text-on-accent"
          >
            Deep Scan
          </button>
        </div>
      </div>

      {/* 3 candidate lines comparison */}
      <div className="space-y-1.5">
        {[1, 2, 3].map((rank) => {
          const line = lines.find((l) => l.rank === rank);
          const coachSug = coachSuggestions.find((c) => c.rank === rank);
          const accent = RANK_ACCENTS[rank];
          if (!line) {
            return (
              <div
                key={rank}
                className="flex items-center justify-between rounded-lg border border-dashed border-line px-2.5 py-2 text-xs text-ink-3"
              >
                <span className="font-mono text-2xs">Line #{rank}</span>
                <span className="text-2xs">Evaluating candidate line…</span>
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
                  ? 'border-accent/50 bg-accent/10'
                  : 'border-line bg-surface'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${accent.dot}`} />
                  {line.san && (
                    <span className="font-mono text-xs font-black text-ink">{line.san}</span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-2xs font-bold tabular-nums ${
                      score.positive
                        ? 'border border-line bg-sunken text-ink'
                        : 'bg-ink text-bg'
                    }`}
                  >
                    {score.text}
                  </span>
                  <span className="truncate text-2xs font-bold text-ink-3">{accent.label}</span>
                </div>

                {canPlayMove && line.uci && (
                  <button
                    type="button"
                    onClick={() => onPlayUciMove(line.uci)}
                    className="btn-primary shrink-0 px-2.5 py-1 text-2xs"
                  >
                    Play {line.san}
                  </button>
                )}
              </div>

              {coachSug?.explanation && (
                <p className="mt-1 text-xs leading-snug text-ink-2">{coachSug.explanation}</p>
              )}

              <div className="mt-1 truncate font-mono text-2xs text-ink-3">
                Line: {line.pvSan.slice(0, 8).join(' ')}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
