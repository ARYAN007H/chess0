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
    if (!entry) return <td className="w-[44%] px-2 py-0.5" />;
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
      <td className="w-[44%] px-1 py-0.5">
        <button
          type="button"
          onClick={() => onSelectPly(entry.ply)}
          className={`flex w-full items-center justify-between rounded px-2 py-0.5 text-left font-mono text-xs transition ${
            isSelected
              ? 'bg-accent/15 font-bold text-accent-text ring-1 ring-accent/40'
              : 'font-medium text-ink-2 hover:bg-[var(--seg)] hover:text-ink'
          }`}
        >
          <span className="truncate">{entry.san}</span>
          {showBadge && (
            <span
              title={meta.label}
              className="ml-1.5 shrink-0 font-mono text-2xs font-extrabold"
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
    <div className="panel-sunken rounded-lg">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="micro-label">
          Moves · {history.length} {history.length === 1 ? 'ply' : 'plies'}
        </span>
        <div className="flex items-center gap-2 text-2xs font-bold">
          <button
            type="button"
            onClick={handleCopyFen}
            className="text-ink-3 transition hover:text-accent-text"
          >
            {fenCopied ? '✓ FEN' : 'FEN'}
          </button>
          <span className="text-line-strong">·</span>
          <button
            type="button"
            onClick={copyPgn}
            disabled={history.length === 0}
            className="text-ink-3 transition hover:text-accent-text disabled:opacity-40"
          >
            {pgnCopied ? '✓ PGN' : 'PGN'}
          </button>
        </div>
      </div>

      <div ref={containerRef} className="scroll-thin max-h-36 overflow-y-auto p-1">
        {rows.length === 0 ? (
          <p className="py-4 text-center text-2xs text-ink-3">
            Make a move on the board to begin recording notation.
          </p>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={row.no}
                  className={idx % 2 === 1 ? 'bg-black/[0.03] dark:bg-white/[0.02]' : ''}
                >
                  <td className="w-[12%] py-0.5 pr-1 pl-2 text-right font-mono text-2xs tabular-nums text-ink-3">
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
