import { useEffect, useRef, useState } from 'react';
import type { HistoryEntry } from '../useChessGame';
import { CLASSIFICATION_META } from '../engine/analysis';

interface MoveListProps {
  history: HistoryEntry[];
  activePly: number;
  onSelectPly: (ply: number) => void;
  onCopyFen: () => void;
}

export function MoveList({ history, activePly, onSelectPly, onCopyFen }: MoveListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pgnCopied, setPgnCopied] = useState(false);
  const [fenCopied, setFenCopied] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (activePly === history.length) {
      el.scrollTop = el.scrollHeight;
    }
  }, [history.length, activePly]);

  const rows: { no: number; white?: HistoryEntry; black?: HistoryEntry }[] = [];
  for (let i = 0; i < history.length; i += 2) {
    rows.push({ no: i / 2 + 1, white: history[i], black: history[i + 1] });
  }

  const copyPgn = () => {
    const parts: string[] = [];
    for (let i = 0; i < history.length; i += 2) {
      const w = history[i];
      const b = history[i + 1];
      parts.push(`${i / 2 + 1}. ${w.san}${b ? ` ${b.san}` : ''}`);
    }
    void navigator.clipboard?.writeText(parts.join(' ')).catch(() => {});
    setPgnCopied(true);
    window.setTimeout(() => setPgnCopied(false), 1200);
  };

  const handleCopyFen = () => {
    onCopyFen();
    setFenCopied(true);
    window.setTimeout(() => setFenCopied(false), 1200);
  };

  const renderCell = (entry?: HistoryEntry) => {
    if (!entry) return <td className="w-[44%] py-1 px-2" />;
    const isSelected = activePly === entry.ply;
    const meta = CLASSIFICATION_META[entry.analysis.classification];
    const showBadge =
      entry.analysis.classification === 'brilliant' ||
      entry.analysis.classification === 'great' ||
      entry.analysis.classification === 'best' ||
      entry.analysis.classification === 'inaccuracy' ||
      entry.analysis.classification === 'mistake' ||
      entry.analysis.classification === 'blunder' ||
      entry.analysis.classification === 'book';

    return (
      <td className="w-[44%] py-0.5 px-1">
        <button
          type="button"
          onClick={() => onSelectPly(entry.ply)}
          className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left font-mono text-xs transition ${
            isSelected
              ? 'bg-emerald-500/15 font-bold text-emerald-800 ring-1 ring-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-200'
              : 'font-medium text-slate-700 hover:bg-stone-100 dark:text-slate-200 dark:hover:bg-slate-800/70'
          }`}
        >
          <span className="truncate">{entry.san}</span>
          {showBadge && (
            <span
              title={meta.label}
              className="ml-1.5 shrink-0 font-mono text-[10px] font-extrabold"
              style={{ color: meta.badgeBg }}
            >
              {meta.symbol}
            </span>
          )}
        </button>
      </td>
    );
  };

  return (
    <div className="rounded-xl border border-stone-200/90 bg-white/85 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex items-center justify-between border-b border-stone-200/80 px-3 py-2 dark:border-slate-800">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Move Notation · {history.length} {history.length === 1 ? 'ply' : 'plies'}
        </span>
        <div className="flex items-center gap-2 text-[11px] font-semibold">
          <button
            type="button"
            onClick={handleCopyFen}
            className="text-slate-500 transition hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-400"
          >
            {fenCopied ? '✓ FEN Copied' : 'Copy FEN'}
          </button>
          <span className="text-slate-300 dark:text-slate-700">·</span>
          <button
            type="button"
            onClick={copyPgn}
            disabled={history.length === 0}
            className="text-slate-500 transition hover:text-emerald-600 disabled:opacity-40 dark:text-slate-400 dark:hover:text-emerald-400"
          >
            {pgnCopied ? '✓ PGN Copied' : 'Copy PGN'}
          </button>
        </div>
      </div>

      <div ref={containerRef} className="scroll-thin h-44 overflow-y-auto p-1.5">
        {rows.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-400 dark:text-slate-500">
            No moves played yet. Make a move on the board or select an opening line.
          </p>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {rows.map((row) => (
                <tr key={row.no} className="border-b border-stone-100/80 last:border-none dark:border-slate-800/40">
                  <td className="w-[12%] py-1 pl-2 pr-1 text-right font-mono text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
                    {row.no}.
                  </td>
                  {renderCell(row.white)}
                  {renderCell(row.black)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
