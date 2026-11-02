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
    if (!entry) return <td className="w-[44%] py-0.5 px-2" />;
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
          className={`flex w-full items-center justify-between rounded px-2 py-0.5 text-left font-mono text-xs transition ${
            isSelected
              ? 'bg-[#81b64c]/20 font-bold text-[#6fa13d] ring-1 ring-[#81b64c]/50 dark:bg-[#81b64c]/25 dark:text-[#b2e07c]'
              : 'font-medium text-stone-700 hover:bg-stone-200/70 dark:text-[#d5d4d0] dark:hover:bg-white/5'
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
    <div className="rounded-lg border border-stone-200 bg-stone-50 dark:border-white/10 dark:bg-[#1f1e1b]">
      <div className="flex items-center justify-between border-b border-stone-200 px-3 py-1.5 dark:border-white/10">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-stone-500 dark:text-[#9e9c98]">
          Moves · {history.length} {history.length === 1 ? 'ply' : 'plies'}
        </span>
        <div className="flex items-center gap-2 text-[11px] font-bold">
          <button
            type="button"
            onClick={handleCopyFen}
            className="text-stone-500 transition hover:text-[#5d8c30] dark:text-[#9e9c98] dark:hover:text-[#95c95e]"
          >
            {fenCopied ? '✓ FEN' : 'FEN'}
          </button>
          <span className="text-stone-300 dark:text-white/15">·</span>
          <button
            type="button"
            onClick={copyPgn}
            disabled={history.length === 0}
            className="text-stone-500 transition hover:text-[#5d8c30] disabled:opacity-40 dark:text-[#9e9c98] dark:hover:text-[#95c95e]"
          >
            {pgnCopied ? '✓ PGN' : 'PGN'}
          </button>
        </div>
      </div>

      <div ref={containerRef} className="scroll-thin max-h-36 overflow-y-auto p-1">
        {rows.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-stone-400 dark:text-[#7c7a75]">
            Make a move on the board to begin recording notation.
          </p>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={row.no}
                  className={idx % 2 === 1 ? 'bg-stone-100/60 dark:bg-white/[0.02]' : ''}
                >
                  <td className="w-[12%] py-0.5 pl-2 pr-1 text-right font-mono text-[11px] tabular-nums text-stone-400 dark:text-[#7c7a75]">
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
