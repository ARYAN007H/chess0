import { useState } from 'react';
import type { BoardTheme, Level, Mode, Side } from '../useChessGame';
import { LEVEL_LABELS } from '../useChessGame';
import { BOARD_PALETTES } from './BoardPanel';

interface ControlsProps {
  mode: Mode;
  playerSide: Side;
  levels: Record<Side, Level>;
  eveRunning: boolean;
  autoFlip: boolean;
  boardTheme: BoardTheme;
  canTakeback: boolean;
  onSwitchMode: (m: Mode) => void;
  onChooseSide: (s: Side | 'random') => void;
  onSetEngineLevel: (side: Side, level: Level) => void;
  onToggleEve: () => void;
  onSetAutoFlip: (on: boolean) => void;
  onSetBoardTheme: (t: BoardTheme) => void;
  onNewGame: () => void;
  onTakeback: () => void;
  onFlip: () => void;
  onLoadFen: (fen: string) => string | null;
}

function LevelSelect({
  side,
  value,
  onChange,
  accent,
}: {
  side: string;
  value: Level;
  onChange: (l: Level) => void;
  accent: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${accent}`} />
      <span className="w-14 shrink-0 font-semibold text-slate-600 dark:text-slate-300">
        {side}
      </span>
      <select
        className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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
  'rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-500 hover:text-emerald-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-emerald-500 dark:hover:text-emerald-400';

export function Controls(props: ControlsProps) {
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState<string | null>(null);

  return (
    <div className="space-y-3.5 rounded-xl border border-stone-200/90 bg-white/85 p-3.5 dark:border-slate-800 dark:bg-slate-900/60">
      {/* Mode Selector */}
      <div>
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Workbench Mode
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-stone-100 p-1 dark:bg-slate-800/90">
          {(
            [
              ['hve', 'Human vs Bot'],
              ['eve', 'Bot vs Bot'],
              ['analysis', 'Free Sandbox'],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              className={`rounded-md px-2 py-1.5 text-xs font-bold transition ${
                props.mode === m
                  ? 'bg-white text-emerald-700 shadow-xs dark:bg-slate-900 dark:text-emerald-400'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
              onClick={() => props.onSwitchMode(m)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Mode-specific Engine & Side Settings */}
      {props.mode === 'hve' && (
        <div className="space-y-2.5">
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Your Pieces
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(['white', 'random', 'black'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`${btn} capitalize ${
                    props.playerSide === s
                      ? '!border-emerald-500 !bg-emerald-500/10 !text-emerald-700 dark:!text-emerald-300'
                      : ''
                  }`}
                  onClick={() => props.onChooseSide(s)}
                >
                  {s === 'random' ? 'Random' : s}
                </button>
              ))}
            </div>
          </div>

          <LevelSelect
            side="Opponent"
            accent="bg-emerald-500"
            value={props.levels[props.playerSide === 'white' ? 'black' : 'white']}
            onChange={(l) =>
              props.onSetEngineLevel(props.playerSide === 'white' ? 'black' : 'white', l)
            }
          />
        </div>
      )}

      {props.mode === 'eve' && (
        <div className="space-y-2">
          <LevelSelect
            side="White"
            accent="bg-stone-300 ring-1 ring-stone-400"
            value={props.levels.white}
            onChange={(l) => props.onSetEngineLevel('white', l)}
          />
          <LevelSelect
            side="Black"
            accent="bg-slate-900 ring-1 ring-slate-600"
            value={props.levels.black}
            onChange={(l) => props.onSetEngineLevel('black', l)}
          />
          <div className="flex items-center justify-between pt-1">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-emerald-600"
                checked={props.autoFlip}
                onChange={(e) => props.onSetAutoFlip(e.target.checked)}
              />
              Auto-flip board on turn
            </label>
            <button
              type="button"
              className={`${btn} ${
                props.eveRunning
                  ? '!border-amber-500/60 !text-amber-600 dark:!text-amber-400'
                  : '!border-emerald-500/60 !text-emerald-600 dark:!text-emerald-400'
              }`}
              onClick={props.onToggleEve}
            >
              {props.eveRunning ? 'Pause Match' : 'Resume Match'}
            </button>
          </div>
        </div>
      )}

      {/* Board Surface Palette */}
      <div>
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Board Finish
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(BOARD_PALETTES) as BoardTheme[]).map((key) => {
            const p = BOARD_PALETTES[key];
            const active = props.boardTheme === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => props.onSetBoardTheme(key)}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                    : 'border-stone-200 bg-white text-slate-700 hover:border-stone-300 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300'
                }`}
              >
                <span className="flex h-4 w-4 shrink-0 overflow-hidden rounded-xs ring-1 ring-black/15">
                  <span className="w-1/2" style={{ backgroundColor: p.light }} />
                  <span className="w-1/2" style={{ backgroundColor: p.dark }} />
                </span>
                <span className="truncate">{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom FEN Loader */}
      <div className="border-t border-stone-200/80 pt-3 dark:border-slate-800">
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Load Custom FEN Position
        </div>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={fenInput}
            onChange={(e) => {
              setFenInput(e.target.value);
              if (fenError) setFenError(null);
            }}
            placeholder="Paste FEN string…"
            className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            type="button"
            className={btn}
            onClick={() => {
              if (!fenInput.trim()) return;
              const err = props.onLoadFen(fenInput);
              if (err === null) {
                setFenInput('');
                setFenError(null);
              } else {
                setFenError(err);
              }
            }}
          >
            Load
          </button>
        </div>
        {fenError !== null && (
          <p className="mt-1 text-[11px] font-medium text-rose-500">{fenError}</p>
        )}
      </div>
    </div>
  );
}
