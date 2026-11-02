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
      <span className="w-14 shrink-0 font-bold text-stone-600 dark:text-[#c4c2bd]">
        {side}
      </span>
      <select
        className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-bold text-stone-800 focus:border-[#81b64c] focus:outline-none dark:border-white/10 dark:bg-[#1f1e1b] dark:text-white"
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
  'rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-bold text-stone-700 transition hover:border-[#81b64c] hover:text-[#5d8c30] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-[#1f1e1b] dark:text-[#d5d4d0] dark:hover:border-[#81b64c] dark:hover:text-[#95c95e]';

export function Controls(props: ControlsProps) {
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState<string | null>(null);

  return (
    <div className="space-y-3.5">
      {/* Mode Selector */}
      <div>
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-[#9e9c98]">
          Workbench Mode
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-stone-100 p-1 dark:bg-[#1c1b19]">
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
              className={`rounded-md px-2 py-1.5 text-xs font-extrabold transition ${
                props.mode === m
                  ? 'bg-[#81b64c] text-white shadow-xs'
                  : 'text-stone-600 hover:text-stone-900 dark:text-[#a09e99] dark:hover:text-white'
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
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-[#9e9c98]">
              Your Pieces
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(['white', 'random', 'black'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`${btn} capitalize ${
                    props.playerSide === s
                      ? '!border-[#81b64c] !bg-[#81b64c]/15 !text-[#4c7824] dark:!text-[#b2e07c]'
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
            accent="bg-[#81b64c]"
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
            accent="bg-stone-200 ring-1 ring-stone-400"
            value={props.levels.white}
            onChange={(l) => props.onSetEngineLevel('white', l)}
          />
          <LevelSelect
            side="Black"
            accent="bg-stone-900 ring-1 ring-stone-600"
            value={props.levels.black}
            onChange={(l) => props.onSetEngineLevel('black', l)}
          />
          <div className="flex items-center justify-between pt-1">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-stone-600 dark:text-[#c4c2bd]">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[#81b64c]"
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
                  : '!border-[#81b64c]/60 !text-[#5d8c30] dark:!text-[#95c95e]'
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
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-[#9e9c98]">
          Board Theme
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
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${
                  active
                    ? 'border-[#81b64c] bg-[#81b64c]/15 text-[#4c7824] dark:text-[#b2e07c]'
                    : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300 dark:border-white/10 dark:bg-[#1f1e1b] dark:text-[#d5d4d0]'
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
      <div className="border-t border-stone-200 pt-3 dark:border-white/10">
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-[#9e9c98]">
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
            className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-[11px] text-stone-800 placeholder:text-stone-400 focus:border-[#81b64c] focus:outline-none dark:border-white/10 dark:bg-[#1f1e1b] dark:text-white"
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
