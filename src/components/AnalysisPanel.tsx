import type { HistoryEntry } from '../useChessGame';
import type { GameSummaryStats, MoveClassification } from '../engine/analysis';
import { CLASSIFICATION_META, cpToWinProb } from '../engine/analysis';

interface AnalysisPanelProps {
  history: HistoryEntry[];
  activePly: number;
  displayedMove: HistoryEntry | null;
  summary: GameSummaryStats;
  onSelectPly: (ply: number) => void;
  onAnalyzeDeeper: () => void;
  reviewProgress: { done: number; total: number } | null;
  reviewDone: boolean;
  onRunReview: () => void;
}

const BREAKDOWN_ORDER: MoveClassification[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'blunder',
];

function formatEvalText(cp: number, mate?: number): string {
  if (mate !== undefined) return `${mate > 0 ? '+' : '−'}M${Math.abs(mate)}`;
  return `${cp > 0 ? '+' : cp < 0 ? '−' : ''}${(Math.abs(cp) / 100).toFixed(2)}`;
}

export function AnalysisPanel({
  history,
  activePly,
  displayedMove,
  summary,
  onSelectPly,
  onAnalyzeDeeper,
  reviewProgress,
  reviewDone,
  onRunReview,
}: AnalysisPanelProps) {
  const width = 340;
  const height = 80;
  const points = [
    { ply: 0, y: height * (1 - cpToWinProb(15) / 100) },
    ...history.map((h) => {
      const effectiveCp =
        h.analysis.evalWhiteMate !== undefined
          ? h.analysis.evalWhiteMate > 0
            ? 1500
            : -1500
          : h.analysis.evalWhiteCp;
      const wp = cpToWinProb(effectiveCp) / 100;
      return {
        ply: h.ply,
        y: Math.max(4, Math.min(height - 4, height * (1 - wp))),
      };
    }),
  ];

  const maxPly = Math.max(1, history.length);
  const polylinePoints = points
    .map((p) => `${((p.ply / maxPly) * width).toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
  const areaPoints = `0,${height} ${polylinePoints} ${width},${height}`;
  const cursorX = (activePly / maxPly) * width;
  const activePoint = points[Math.min(activePly, points.length - 1)] ?? points[0];

  const moveMeta = displayedMove ? CLASSIFICATION_META[displayedMove.analysis.classification] : null;

  return (
    <div className="space-y-3">
      {/* Full engine review: progress / trigger */}
      {reviewProgress ? (
        <div className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 dark:border-sky-400/30 dark:bg-sky-400/10">
          <div className="mb-1.5 flex items-center justify-between text-2xs font-semibold text-sky-800 dark:text-sky-200">
            <span>Engine reviewing game…</span>
            <span className="font-mono tabular-nums">
              {reviewProgress.done}/{reviewProgress.total}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-sky-200 dark:bg-sky-400/20">
            <div
              className="h-full rounded-full bg-sky-500 transition-all duration-200"
              style={{ width: `${(reviewProgress.done / Math.max(1, reviewProgress.total)) * 100}%` }}
            />
          </div>
        </div>
      ) : (
        !reviewDone &&
        history.length > 0 && (
          <button
            onClick={onRunReview}
            className="w-full rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-800 transition hover:bg-sky-100 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200 dark:hover:bg-sky-400/20"
          >
            Run full engine review (mate-aware classifications &amp; accuracy)
          </button>
        )
      )}

      {/* Move coach / classification card */}
      <div className="panel-sunken rounded-lg p-3">
        {displayedMove && moveMeta ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 font-mono text-xs font-extrabold text-white shadow-card"
                  style={{ backgroundColor: moveMeta.badgeBg }}
                >
                  {moveMeta.symbol}
                </span>
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-bold text-ink">
                    <span>
                      {Math.ceil(displayedMove.ply / 2)}
                      {displayedMove.ply % 2 === 1 ? '.' : '…'} {displayedMove.san}
                    </span>
                    <span className="text-ink-3">·</span>
                    <span style={{ color: moveMeta.badgeBg }}>{moveMeta.label}</span>
                  </div>
                  <p className="text-xs text-ink-3">{moveMeta.description}</p>
                </div>
              </div>

              <div className="text-right font-mono">
                <div className="text-xs font-bold tabular-nums text-ink">
                  {formatEvalText(displayedMove.analysis.evalWhiteCp, displayedMove.analysis.evalWhiteMate)}
                </div>
                <div className="text-2xs tabular-nums text-ink-3">
                  {displayedMove.analysis.moveAccuracy.toFixed(0)}% acc
                </div>
              </div>
            </div>

            {displayedMove.analysis.bestAlternativeSan &&
              displayedMove.analysis.bestAlternativeUci &&
              displayedMove.analysis.bestAlternativeUci !== displayedMove.uci &&
              (displayedMove.analysis.classification === 'inaccuracy' ||
                displayedMove.analysis.classification === 'mistake' ||
                displayedMove.analysis.classification === 'blunder') && (
                <div className="flex items-center justify-between rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs">
                  <span className="text-ink-2">
                    Best was{' '}
                    <strong className="font-mono font-bold text-accent-text">
                      {displayedMove.analysis.bestAlternativeSan}
                    </strong>{' '}
                    <span className="font-mono text-2xs text-ink-3">
                      (−{(displayedMove.analysis.cpLoss / 100).toFixed(2)})
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={onAnalyzeDeeper}
                    className="font-bold text-accent-text hover:underline"
                  >
                    Inspect 3 Lines
                  </button>
                </div>
              )}
          </div>
        ) : (
          <div className="flex items-center justify-between text-xs text-ink-3">
            <span>Make a move or click any ply in the move list to inspect move quality.</span>
            <button
              type="button"
              onClick={onAnalyzeDeeper}
              className="shrink-0 font-bold text-accent-text hover:underline"
            >
              Scan Position
            </button>
          </div>
        )}
      </div>

      {/* Interactive SVG evaluation timeline graph */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="micro-label">Evaluation Graph</span>
          <span className="font-mono text-2xs tabular-nums text-ink-3">
            Ply {activePly}/{history.length}
          </span>
        </div>
        <div className="relative overflow-hidden rounded-lg border border-line bg-[#1f1e1b]">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="block h-20 w-full cursor-pointer"
            onClick={(e) => {
              if (history.length === 0) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              const targetPly = Math.round(relX * history.length);
              onSelectPly(targetPly);
            }}
          >
            <line
              x1={0}
              y1={height / 2}
              x2={width}
              y2={height / 2}
              stroke="rgba(129, 182, 76, 0.35)"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <polygon points={areaPoints} fill="rgba(255, 255, 255, 0.88)" />
            <polyline fill="none" stroke="#81b64c" strokeWidth={2} points={polylinePoints} />
            {history.length > 0 && (
              <>
                <line
                  x1={cursorX}
                  y1={0}
                  x2={cursorX}
                  y2={height}
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                />
                <circle
                  cx={cursorX}
                  cy={activePoint.y}
                  r={3.5}
                  fill="#f59e0b"
                  stroke="#1f1e1b"
                  strokeWidth={1.5}
                />
              </>
            )}
          </svg>
        </div>
      </div>

      {/* Per-side accuracy cards */}
      <div className="grid grid-cols-2 gap-2">
        <div className="panel-sunken rounded-lg px-3 py-2">
          <div className="micro-label">♔ White Accuracy</div>
          <div className="mt-0.5 font-mono text-lg font-black tabular-nums text-ink">
            {summary.whiteAccuracy !== null ? `${summary.whiteAccuracy.toFixed(1)}%` : '—'}
          </div>
        </div>
        <div className="panel-sunken rounded-lg px-3 py-2">
          <div className="micro-label">♚ Black Accuracy</div>
          <div className="mt-0.5 font-mono text-lg font-black tabular-nums text-ink">
            {summary.blackAccuracy !== null ? `${summary.blackAccuracy.toFixed(1)}%` : '—'}
          </div>
        </div>
      </div>

      {/* Classification breakdown table */}
      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line bg-sunken text-2xs font-bold tracking-wider uppercase text-ink-3">
              <th className="py-1.5 pl-2.5 text-left">Move Type</th>
              <th className="py-1.5 text-center">White</th>
              <th className="py-1.5 pr-2.5 text-center">Black</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {BREAKDOWN_ORDER.map((cl) => {
              const meta = CLASSIFICATION_META[cl];
              const wCount = summary.counts.white[cl];
              const bCount = summary.counts.black[cl];
              return (
                <tr key={cl} className="hover:bg-black/[0.03] dark:hover:bg-white/[0.03]">
                  <td className="flex items-center gap-2 py-1 pl-2.5 font-semibold text-ink-2">
                    <span
                      className="inline-flex h-4 w-5 items-center justify-center rounded text-2xs font-extrabold text-white"
                      style={{ backgroundColor: meta.badgeBg }}
                    >
                      {meta.symbol}
                    </span>
                    <span>{meta.label}</span>
                  </td>
                  <td className="py-1 text-center font-mono font-bold tabular-nums text-ink">
                    {wCount}
                  </td>
                  <td className="py-1 pr-2.5 text-center font-mono font-bold tabular-nums text-ink">
                    {bCount}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
