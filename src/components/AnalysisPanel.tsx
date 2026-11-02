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
}: AnalysisPanelProps) {
  // Build SVG points for the evaluation graph (0..100 win prob for White)
  const width = 340;
  const height = 84;
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
    <div className="space-y-3 rounded-xl border border-stone-200/90 bg-white/85 p-3.5 dark:border-slate-800 dark:bg-slate-900/60">
      {/* Move Coach / Classification Card */}
      <div className="rounded-lg border border-stone-200/80 bg-stone-50/80 p-3 dark:border-slate-800 dark:bg-slate-800/45">
        {displayedMove && moveMeta ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className="flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 font-mono text-xs font-extrabold text-white shadow-sm"
                  style={{ backgroundColor: moveMeta.badgeBg }}
                >
                  {moveMeta.symbol}
                </span>
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                    <span>
                      {Math.ceil(displayedMove.ply / 2)}
                      {displayedMove.ply % 2 === 1 ? '.' : '…'} {displayedMove.san}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span style={{ color: moveMeta.badgeBg }}>{moveMeta.label}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {moveMeta.description}
                  </p>
                </div>
              </div>

              <div className="text-right font-mono">
                <div className="text-xs font-bold tabular-nums text-slate-900 dark:text-slate-100">
                  {formatEvalText(displayedMove.analysis.evalWhiteCp, displayedMove.analysis.evalWhiteMate)}
                </div>
                <div className="text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
                  {displayedMove.analysis.moveAccuracy.toFixed(0)}% move acc
                </div>
              </div>
            </div>

            {displayedMove.analysis.bestAlternativeSan &&
              displayedMove.analysis.bestAlternativeUci &&
              displayedMove.analysis.bestAlternativeUci !== displayedMove.uci &&
              (displayedMove.analysis.classification === 'inaccuracy' ||
                displayedMove.analysis.classification === 'mistake' ||
                displayedMove.analysis.classification === 'blunder') && (
                <div className="flex items-center justify-between rounded border border-stone-200/80 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700/80 dark:bg-slate-900/70">
                  <span className="text-slate-600 dark:text-slate-300">
                    Best alternative was{' '}
                    <strong className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {displayedMove.analysis.bestAlternativeSan}
                    </strong>{' '}
                    <span className="font-mono text-[11px] text-slate-400">
                      (−{(displayedMove.analysis.cpLoss / 100).toFixed(2)} eval loss)
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={onAnalyzeDeeper}
                    className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
                  >
                    Inspect 3 Lines
                  </button>
                </div>
              )}
          </div>
        ) : (
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Make a move or click any ply in the move list to inspect move quality.</span>
            <button
              type="button"
              onClick={onAnalyzeDeeper}
              className="shrink-0 font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
            >
              Scan Position
            </button>
          </div>
        )}
      </div>

      {/* Interactive SVG Evaluation Timeline Graph */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span className="font-semibold uppercase tracking-wider">Evaluation Timeline</span>
          <span className="font-mono tabular-nums">
            Ply {activePly}/{history.length}
          </span>
        </div>
        <div className="relative overflow-hidden rounded-lg border border-stone-300/80 bg-[#1a2230] dark:border-slate-800">
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
            {/* Midline (0.00 Equal) */}
            <line
              x1={0}
              y1={height / 2}
              x2={width}
              y2={height / 2}
              stroke="rgba(16, 185, 129, 0.35)"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            {/* White advantage fill */}
            <polygon points={areaPoints} fill="rgba(244, 241, 234, 0.88)" />
            {/* Evaluation curve */}
            <polyline fill="none" stroke="#10b981" strokeWidth={2} points={polylinePoints} />
            {/* Active ply cursor */}
            {history.length > 0 && (
              <>
                <line
                  x1={cursorX}
                  y1={0}
                  x2={cursorX}
                  y2={height}
                  stroke="#38bdf8"
                  strokeWidth={1.5}
                />
                <circle
                  cx={cursorX}
                  cy={activePoint.y}
                  r={3.5}
                  fill="#38bdf8"
                  stroke="#0b0f17"
                  strokeWidth={1.5}
                />
              </>
            )}
          </svg>
        </div>
      </div>

      {/* Per-Side Accuracy Cards */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-stone-200/90 bg-stone-50/70 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            ♔ White Accuracy
          </div>
          <div className="mt-0.5 font-mono text-lg font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
            {summary.whiteAccuracy !== null ? `${summary.whiteAccuracy.toFixed(1)}%` : '—'}
          </div>
        </div>
        <div className="rounded-lg border border-stone-200/90 bg-stone-50/70 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            ♚ Black Accuracy
          </div>
          <div className="mt-0.5 font-mono text-lg font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
            {summary.blackAccuracy !== null ? `${summary.blackAccuracy.toFixed(1)}%` : '—'}
          </div>
        </div>
      </div>

      {/* Classification Breakdown Table */}
      <div className="overflow-hidden rounded-lg border border-stone-200/80 dark:border-slate-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-stone-200/80 bg-stone-100/70 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
              <th className="py-1.5 pl-2.5 text-left">Classification</th>
              <th className="py-1.5 text-center">White</th>
              <th className="py-1.5 pr-2.5 text-center">Black</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200/50 dark:divide-slate-800/60">
            {BREAKDOWN_ORDER.map((cl) => {
              const meta = CLASSIFICATION_META[cl];
              const wCount = summary.counts.white[cl];
              const bCount = summary.counts.black[cl];
              return (
                <tr key={cl} className="hover:bg-stone-100/50 dark:hover:bg-slate-800/30">
                  <td className="flex items-center gap-2 py-1 pl-2.5 font-medium text-slate-700 dark:text-slate-300">
                    <span
                      className="inline-flex h-4 w-5 items-center justify-center rounded text-[10px] font-extrabold text-white"
                      style={{ backgroundColor: meta.badgeBg }}
                    >
                      {meta.symbol}
                    </span>
                    <span>{meta.label}</span>
                  </td>
                  <td className="py-1 text-center font-mono font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                    {wCount}
                  </td>
                  <td className="py-1 pr-2.5 text-center font-mono font-semibold tabular-nums text-slate-800 dark:text-slate-200">
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
