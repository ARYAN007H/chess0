import { useState } from 'react';
import type { Level, Mode, Side } from '../useChessGame';
import { LEVEL_LABELS } from '../useChessGame';

interface ControlsProps {
  mode: Mode;
  playerSide: Side;
  levels: Record<Side, Level>;
  eveRunning: boolean;
  autoFlip: boolean;
  canTakeback: boolean;
  onSwitchMode: (m: Mode) => void;
  onChooseSide: (s: Side | 'random') => void;
  onSetEngineLevel: (side: Side, level: Level) => void;
  onToggleEve: () => void;
  onSetAutoFlip: (on: boolean) => void;
  onNewGame: () => void;
  onTakeback: () => void;
  onFlip: () => void;
  onCopyFen: () => void;
  onLoadFen: (fen: string) => string | null;
}

function LevelSelect({ side, value, onChange, accent }: { side: string; value: Level; onChange: (l: Level) => void; accent: string }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${accent}`} />
      <span className="w-12 font-medium text-slate-500 dark:text-slate-400">{side}</span>
      <select
        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium dark:border-slate-600 dark:bg-slate-800"
        value={value}
        onChange={(e) => onChange(e.target.value as Level)}
      >
        {(Object.keys(LEVEL_LABELS) as Level[]).map((l) => (
          <option key={l} value={l}>
            {LEVEL_LABELS[l]}
          </option>
        ))}
      </select>
    </label>
  );
}

const btn =
  'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold transition hover:border-sky-400 hover:text-sky-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:hover:border-sky-500 dark:hover:text-sky-400';

export function Controls(props: ControlsProps) {
  const [copied, setCopied] = useState(false);
  const [fenOpen, setFenOpen] = useState(false);
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState<string | null>(null);

  const copyFen = () => {
    props.onCopyFen();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white/70 p-3 dark:border-slate-700/60 dark:bg-slate-900/50">
      {/* Mode */}
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
        {(
          [
            ['hve', 'vs Engine'],
            ['eve', 'Engine vs Engine'],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button
            key={m}
            className={`rounded-md px-2 py-1.5 text-xs font-bold transition ${
              props.mode === m
                ? 'bg-white text-sky-600 shadow dark:bg-slate-900 dark:text-sky-400'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
            onClick={() => props.onSwitchMode(m)}
          >
            {label}
          </button>
        ))}
      </div>

      {props.mode === 'hve' ? (
        <>
          <div>
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Play as
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(['white', 'random', 'black'] as const).map((s) => (
                <button
                  key={s}
                  className={`${btn} capitalize ${props.playerSide === s ? '!border-sky-400 !text-sky-600 dark:!text-sky-400' : ''}`}
                  onClick={() => props.onChooseSide(s)}
                >
                  {s === 'random' ? '🎲 Random' : s}
                </button>
              ))}
            </div>
          </div>
          <LevelSelect
            side="Engine"
            accent="bg-sky-400"
            value={props.levels[props.playerSide === 'white' ? 'black' : 'white']}
            onChange={(l) => props.onSetEngineLevel(props.playerSide === 'white' ? 'black' : 'white', l)}
          />
        </>
      ) : (
        <div className="space-y-2">
          <LevelSelect side="White" accent="bg-slate-200" value={props.levels.white} onChange={(l) => props.onSetEngineLevel('white', l)} />
          <LevelSelect side="Black" accent="bg-slate-800" value={props.levels.black} onChange={(l) => props.onSetEngineLevel('black', l)} />
          <div className="flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-sky-500"
                checked={props.autoFlip}
                onChange={(e) => props.onSetAutoFlip(e.target.checked)}
              />
              Auto-flip board
            </label>
            <button className={`${btn} ${props.eveRunning ? '!border-amber-400 !text-amber-600' : '!border-emerald-400 !text-emerald-600'}`} onClick={props.onToggleEve}>
              {props.eveRunning ? '⏸ Pause' : '▶ Start'}
            </button>
          </div>
        </div>
      )}

      {/* Game actions */}
      <div className="grid grid-cols-2 gap-1.5 border-t border-slate-200 pt-2.5 dark:border-slate-700/60">
        <button className={btn} onClick={props.onNewGame}>
          ⟳ New game
        </button>
        <button className={btn} onClick={props.onTakeback} disabled={!props.canTakeback}>
          ↩ Takeback
        </button>
        <button className={btn} onClick={props.onFlip}>
          ⇅ Flip board
        </button>
        <button className={btn} onClick={copyFen}>
          {copied ? '✓ Copied!' : '⧉ Copy FEN'}
        </button>
        <button className={`${btn} col-span-2`} onClick={() => setFenOpen((o) => !o)}>
          ⌨ Load FEN
        </button>
      </div>

      {fenOpen && (
        <div className="animate-fade space-y-1.5">
          <textarea
            className="h-16 w-full resize-none rounded-lg border border-slate-300 bg-white p-2 font-mono text-[11px] dark:border-slate-600 dark:bg-slate-800"
            placeholder="Paste a FEN string…"
            value={fenInput}
            onChange={(e) => setFenInput(e.target.value)}
          />
          {fenError !== null && <p className="text-[11px] font-medium text-rose-500">{fenError}</p>}
          <div className="flex justify-end gap-1.5">
            <button
              className={btn}
              onClick={() => {
                const err = props.onLoadFen(fenInput);
                if (err === null) {
                  setFenOpen(false);
                  setFenInput('');
                  setFenError(null);
                } else {
                  setFenError(err);
                }
              }}
            >
              Load
            </button>
            <button
              className={btn}
              onClick={() => {
                setFenOpen(false);
                setFenError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
