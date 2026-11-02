import { useMemo, useState } from 'react';
import type { BookCandidate } from '../engine/bookV3';
import { OPENING_REPERTOIRE, TACTICAL_PRESETS } from '../engine/bookV3';

interface OpeningExplorerProps {
  currentOpening: { eco: string; name: string } | null;
  continuations: BookCandidate[];
  canPlayMove: boolean;
  onPlayUciMove: (uci: string) => void;
  onLoadOpeningLine: (uciMoves: string) => void;
  onLoadFenPreset: (fen: string) => void;
}

export function OpeningExplorer({
  currentOpening,
  continuations,
  canPlayMove,
  onPlayUciMove,
  onLoadOpeningLine,
  onLoadFenPreset,
}: OpeningExplorerProps) {
  const [subTab, setSubTab] = useState<'explorer' | 'repertoire' | 'tactics'>('explorer');
  const [query, setQuery] = useState('');

  const filteredRepertoire = useMemo(() => {
    const q = query.trim().toLowerCase();
    const unique = OPENING_REPERTOIRE.filter(
      (line, idx, arr) =>
        arr.findIndex((x) => x.eco === line.eco && x.name === line.name) === idx,
    );
    if (!q) return unique;
    return unique.filter(
      (line) =>
        line.name.toLowerCase().includes(q) ||
        line.eco.toLowerCase().includes(q) ||
        line.moves.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className="space-y-3">
      {/* Current Opening Banner */}
      <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 dark:border-white/10 dark:bg-[#1f1e1b]">
        <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-[#9e9c98]">
          Current Opening
        </div>
        {currentOpening ? (
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="font-mono text-xs font-extrabold text-[#5d8c30] dark:text-[#95c95e]">
              {currentOpening.eco}
            </span>
            <span className="truncate text-sm font-bold text-stone-900 dark:text-white">
              {currentOpening.name}
            </span>
          </div>
        ) : (
          <div className="mt-0.5 text-xs font-medium text-stone-500 dark:text-[#a09e99]">
            Starting position or independent middlegame
          </div>
        )}
      </div>

      {/* Sub-navigation */}
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-stone-100 p-1 dark:bg-[#1c1b19]">
        {(
          [
            ['explorer', 'Book Moves'],
            ['repertoire', 'GM Repertoire'],
            ['tactics', 'Test Positions'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            className={`rounded-md py-1.5 text-xs font-extrabold transition ${
              subTab === id
                ? 'bg-[#81b64c] text-white shadow-xs'
                : 'text-stone-600 hover:text-stone-900 dark:text-[#a09e99] dark:hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === 'explorer' && (
        <div className="space-y-2">
          {continuations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-stone-200 p-4 text-center text-xs text-stone-500 dark:border-white/10 dark:text-[#a09e99]">
              Position is beyond the Grandmaster opening book. Chess0 v3 calculates novel lines from scratch using 3-line Multi-PV search.
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1 text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-[#9e9c98]">
                <span>Move · Continuation</span>
                <span>Master W / D / L %</span>
              </div>
              {continuations.map((cand) => (
                <button
                  key={cand.uci}
                  type="button"
                  disabled={!canPlayMove}
                  onClick={() => onPlayUciMove(cand.uci)}
                  className="group block w-full rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-left transition hover:border-[#81b64c] disabled:cursor-default dark:border-white/10 dark:bg-[#1f1e1b] dark:hover:border-[#81b64c]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-mono text-xs font-extrabold text-[#5d8c30] dark:text-[#95c95e]">
                        {cand.san}
                      </span>
                      <span className="truncate text-xs font-semibold text-stone-700 dark:text-[#d5d4d0]">
                        {cand.eco} · {cand.opening}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-stone-400">
                      wt {cand.weight}
                    </span>
                  </div>

                  {/* W / D / L horizontal bar */}
                  <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-xs bg-stone-700">
                    <div
                      style={{ width: `${cand.whiteWinPct}%` }}
                      className="bg-[#f4f1ea]"
                      title={`White wins ${cand.whiteWinPct}%`}
                    />
                    <div
                      style={{ width: `${cand.drawPct}%` }}
                      className="bg-stone-400"
                      title={`Draws ${cand.drawPct}%`}
                    />
                    <div
                      style={{ width: `${cand.blackWinPct}%` }}
                      className="bg-[#262522]"
                      title={`Black wins ${cand.blackWinPct}%`}
                    />
                  </div>
                  <div className="mt-0.5 flex justify-between font-mono text-[10px] tabular-nums text-stone-500 dark:text-[#9e9c98]">
                    <span>W {cand.whiteWinPct}%</span>
                    <span>D {cand.drawPct}%</span>
                    <span>B {cand.blackWinPct}%</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {subTab === 'repertoire' && (
        <div className="space-y-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by ECO or opening name (e.g. Sicilian, B90, Najdorf)…"
            className="w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-stone-800 placeholder:text-stone-400 focus:border-[#81b64c] focus:outline-none dark:border-white/10 dark:bg-[#1f1e1b] dark:text-white"
          />
          <div className="scroll-thin max-h-60 space-y-1.5 overflow-y-auto pr-1">
            {filteredRepertoire.map((line, i) => (
              <button
                key={`${line.eco}-${line.name}-${i}`}
                type="button"
                onClick={() => onLoadOpeningLine(line.moves)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-left transition hover:border-[#81b64c] dark:border-white/10 dark:bg-[#1f1e1b] dark:hover:border-[#81b64c]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-bold text-[#5d8c30] dark:text-[#95c95e]">
                      {line.eco}
                    </span>
                    <span className="truncate text-xs font-bold text-stone-800 dark:text-white">
                      {line.name}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-stone-500 dark:text-[#9e9c98]">
                    {line.moves}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] font-bold text-[#5d8c30] dark:text-[#95c95e]">
                  Load →
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {subTab === 'tactics' && (
        <div className="scroll-thin max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {TACTICAL_PRESETS.map((preset) => (
            <button
              key={preset.title}
              type="button"
              onClick={() => onLoadFenPreset(preset.fen)}
              className="block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-left transition hover:border-[#81b64c] dark:border-white/10 dark:bg-[#1f1e1b] dark:hover:border-[#81b64c]"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-stone-900 dark:text-white">
                  {preset.title}
                </span>
                <span className="font-mono text-[11px] font-bold text-[#5d8c30] dark:text-[#95c95e]">
                  Analyze →
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-stone-500 dark:text-[#9e9c98]">
                {preset.subtitle}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
