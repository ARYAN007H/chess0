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
    // Deduplicate by ECO + Name
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
    <div className="space-y-3 rounded-xl border border-stone-200/90 bg-white/85 p-3.5 dark:border-slate-800 dark:bg-slate-900/60">
      {/* Current Opening Banner */}
      <div className="rounded-lg border border-stone-200/80 bg-stone-50/80 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/50">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Detected Opening
        </div>
        {currentOpening ? (
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="font-mono text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
              {currentOpening.eco}
            </span>
            <span className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
              {currentOpening.name}
            </span>
          </div>
        ) : (
          <div className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            Out of book · Independent middle/endgame position
          </div>
        )}
      </div>

      {/* Sub-navigation */}
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-stone-100 p-1 dark:bg-slate-800/80">
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
            className={`rounded-md py-1 text-xs font-bold transition ${
              subTab === id
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === 'explorer' && (
        <div className="space-y-2">
          {continuations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-stone-200 p-4 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              Position is beyond the Grandmaster opening book. Chess0 v3 calculates novel lines from scratch using 3-line Multi-PV search.
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                <span>Move · Continuation</span>
                <span>Master W / D / L %</span>
              </div>
              {continuations.map((cand) => (
                <button
                  key={cand.uci}
                  type="button"
                  disabled={!canPlayMove}
                  onClick={() => onPlayUciMove(cand.uci)}
                  className="group block w-full rounded-lg border border-stone-200/80 bg-white px-2.5 py-2 text-left transition hover:border-emerald-500/60 disabled:cursor-default dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-emerald-500/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-mono text-xs font-extrabold text-emerald-700 group-hover:text-emerald-600 dark:text-emerald-400">
                        {cand.san}
                      </span>
                      <span className="truncate text-xs font-medium text-slate-700 dark:text-slate-300">
                        {cand.eco} · {cand.opening}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-slate-400">
                      wt {cand.weight}
                    </span>
                  </div>

                  {/* W / D / L horizontal bar */}
                  <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-sm bg-slate-700">
                    <div
                      style={{ width: `${cand.whiteWinPct}%` }}
                      className="bg-[#f4f1ea] text-[9px]"
                      title={`White wins ${cand.whiteWinPct}%`}
                    />
                    <div
                      style={{ width: `${cand.drawPct}%` }}
                      className="bg-slate-400"
                      title={`Draws ${cand.drawPct}%`}
                    />
                    <div
                      style={{ width: `${cand.blackWinPct}%` }}
                      className="bg-slate-900"
                      title={`Black wins ${cand.blackWinPct}%`}
                    />
                  </div>
                  <div className="mt-0.5 flex justify-between font-mono text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
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
            className="w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <div className="scroll-thin max-h-60 space-y-1.5 overflow-y-auto pr-1">
            {filteredRepertoire.map((line, i) => (
              <button
                key={`${line.eco}-${line.name}-${i}`}
                type="button"
                onClick={() => onLoadOpeningLine(line.moves)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-stone-200/80 bg-white px-2.5 py-2 text-left transition hover:border-emerald-500/60 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-emerald-500/50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      {line.eco}
                    </span>
                    <span className="truncate text-xs font-bold text-slate-800 dark:text-slate-200">
                      {line.name}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500 dark:text-slate-400">
                    {line.moves}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  Load →
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {subTab === 'tactics' && (
        <div className="scroll-thin max-h-68 space-y-1.5 overflow-y-auto pr-1">
          {TACTICAL_PRESETS.map((preset) => (
            <button
              key={preset.title}
              type="button"
              onClick={() => onLoadFenPreset(preset.fen)}
              className="block w-full rounded-lg border border-stone-200/80 bg-white px-3 py-2 text-left transition hover:border-emerald-500/60 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-emerald-500/50"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  {preset.title}
                </span>
                <span className="font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  Analyze →
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {preset.subtitle}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
