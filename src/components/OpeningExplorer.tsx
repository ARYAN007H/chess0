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
      {/* Current opening banner */}
      <div className="panel-sunken rounded-lg px-3 py-2">
        <div className="micro-label">Current Opening</div>
        {currentOpening ? (
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="font-mono text-xs font-extrabold text-accent-text">
              {currentOpening.eco}
            </span>
            <span className="truncate text-sm font-bold text-ink">{currentOpening.name}</span>
          </div>
        ) : (
          <div className="mt-0.5 text-xs font-medium text-ink-3">
            Starting position or independent middlegame
          </div>
        )}
      </div>

      {/* Sub-navigation */}
      <div className="seg grid grid-cols-3">
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
            className={`seg-btn py-1.5 ${subTab === id ? 'seg-btn-active' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === 'explorer' && (
        <div className="space-y-2">
          {continuations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line p-4 text-center text-xs text-ink-3">
              Position is beyond the Grandmaster opening book. Chess0 v3 calculates novel lines from scratch using 3-line Multi-PV search.
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <span className="micro-label">Move · Continuation</span>
                <span className="micro-label">Master W / D / L %</span>
              </div>
              {continuations.map((cand) => (
                <button
                  key={cand.uci}
                  type="button"
                  disabled={!canPlayMove}
                  onClick={() => onPlayUciMove(cand.uci)}
                  className="group block w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-left transition hover:border-accent disabled:cursor-default"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-mono text-xs font-extrabold text-accent-text">
                        {cand.san}
                      </span>
                      <span className="truncate text-xs font-semibold text-ink-2">
                        {cand.eco} · {cand.opening}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-2xs tabular-nums text-ink-3">
                      wt {cand.weight}
                    </span>
                  </div>

                  {/* W / D / L horizontal bar */}
                  <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-[3px] bg-ink-3">
                    <div
                      style={{ width: `${cand.whiteWinPct}%` }}
                      className="bg-[#f6f5f0]"
                      title={`White wins ${cand.whiteWinPct}%`}
                    />
                    <div
                      style={{ width: `${cand.drawPct}%` }}
                      className="bg-[#9a968e]"
                      title={`Draws ${cand.drawPct}%`}
                    />
                    <div
                      style={{ width: `${cand.blackWinPct}%` }}
                      className="bg-[#26241f]"
                      title={`Black wins ${cand.blackWinPct}%`}
                    />
                  </div>
                  <div className="mt-0.5 flex justify-between font-mono text-2xs tabular-nums text-ink-3">
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
            className="field"
          />
          <div className="scroll-thin max-h-60 space-y-1.5 overflow-y-auto pr-1">
            {filteredRepertoire.map((line, i) => (
              <button
                key={`${line.eco}-${line.name}-${i}`}
                type="button"
                onClick={() => onLoadOpeningLine(line.moves)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2.5 py-2 text-left transition hover:border-accent"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-bold text-accent-text">
                      {line.eco}
                    </span>
                    <span className="truncate text-xs font-bold text-ink">{line.name}</span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-2xs text-ink-3">
                    {line.moves}
                  </div>
                </div>
                <span className="shrink-0 text-2xs font-bold text-accent-text">Load</span>
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
              className="block w-full rounded-lg border border-line bg-surface px-3 py-2 text-left transition hover:border-accent"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-ink">{preset.title}</span>
                <span className="font-mono text-2xs font-bold text-accent-text">Analyze</span>
              </div>
              <p className="mt-0.5 text-2xs text-ink-3">{preset.subtitle}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
