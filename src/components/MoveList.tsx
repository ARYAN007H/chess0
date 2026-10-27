import { useEffect, useRef } from 'react';
import type { HistoryEntry } from '../useChessGame';

interface MoveListProps {
  history: HistoryEntry[];
}

export function MoveList({ history }: MoveListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [history.length]);

  const rows: { no: number; white?: HistoryEntry; black?: HistoryEntry }[] = [];
  for (let i = 0; i < history.length; i += 2) {
    rows.push({ no: i / 2 + 1, white: history[i], black: history[i + 1] });
  }

  return (
    <div className="scroll-thin h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white/70 p-1 dark:border-slate-700/60 dark:bg-slate-900/50">
      {rows.length === 0 && (
        <p className="px-3 py-4 text-center text-xs text-slate-400 dark:text-slate-500">No moves yet</p>
      )}
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.no} className={idx % 2 === 0 ? 'bg-transparent' : undefined}>
              <td className="w-9 py-0.5 pl-2 pr-1 text-right text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
                {row.no}.
              </td>
              <td className="py-0.5 pl-1 font-medium">
                <span
                  className={`rounded px-1.5 py-0.5 ${
                    history.length - 1 === idx * 2 ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/60 dark:text-sky-100' : ''
                  }`}
                >
                  {row.white?.san}
                </span>
              </td>
              <td className="py-0.5 pl-1 font-medium">
                <span
                  className={`rounded px-1.5 py-0.5 ${
                    history.length - 1 === idx * 2 + 1 ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/60 dark:text-sky-100' : ''
                  }`}
                >
                  {row.black?.san}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div ref={endRef} />
    </div>
  );
}
