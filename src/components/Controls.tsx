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
      <span className="w-14 shrink-0 font-bold text-ink-2">{side}</span>
      <select
        className="field min-w-0 flex-1"
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

const btn = 'btn-quiet px-3 py-1.5 text-xs';

export function Controls(props: ControlsProps) {
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState<string | null>(null);

  return (
    <div className="space-y-3.5">
      {/* Mode selector */}
      <div>
        <div className="micro-label mb-1.5">Workbench Mode</div>
        <div className="seg grid grid-cols-3">
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
              className={`seg-btn py-1.5 ${props.mode === m ? 'seg-btn-active' : ''}`}
              onClick={() => props.onSwitchMode(m)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Mode-specific engine & side settings */}
      {props.mode === 'hve' && (
        <div className="space-y-2.5">
          <div>
            <div className="micro-label mb-1">Your Pieces</div>
            <div className="grid grid-cols-3 gap-1.5">
              {(['white', 'random', 'black'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`${btn} capitalize ${
                    props.playerSide === s ? 'border-accent bg-accent/15 text-accent-text' : ''
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
            accent="bg-accent"
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
            accent="bg-[#f2f0ea] ring-1 ring-line-strong"
            value={props.levels.white}
            onChange={(l) => props.onSetEngineLevel('white', l)}
          />
          <LevelSelect
            side="Black"
            accent="bg-[#26241f] ring-1 ring-black/40"
            value={props.levels.black}
            onChange={(l) => props.onSetEngineLevel('black', l)}
          />
          <div className="flex items-center justify-between pt-1">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-ink-2">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-accent"
                checked={props.autoFlip}
                onChange={(e) => props.onSetAutoFlip(e.target.checked)}
              />
              Auto-flip board on turn
            </label>
            <button
              type="button"
              className={`${btn} ${
                props.eveRunning
                  ? 'border-amber-500/60 text-amber-600 dark:text-amber-400'
                  : 'border-accent/60 text-accent-text'
              }`}
              onClick={props.onToggleEve}
            >
              {props.eveRunning ? 'Pause Match' : 'Resume Match'}
            </button>
          </div>
        </div>
      )}

      {/* Board surface palette */}
      <div>
        <div className="micro-label mb-1.5">Board Theme</div>
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
                    ? 'border-accent bg-accent/15 text-accent-text'
                    : 'border-line bg-surface text-ink-2 hover:border-line-strong'
                }`}
              >
                <span className="flex h-4 w-4 shrink-0 overflow-hidden rounded-[3px] ring-1 ring-black/15">
                  <span className="w-1/2" style={{ backgroundColor: p.light }} />
                  <span className="w-1/2" style={{ backgroundColor: p.dark }} />
                </span>
                <span className="truncate">{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom FEN loader */}
      <div className="border-t border-line pt-3">
        <div className="micro-label mb-1.5">Load Custom FEN Position</div>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={fenInput}
            onChange={(e) => {
              setFenInput(e.target.value);
              if (fenError) setFenError(null);
            }}
            placeholder="Paste FEN string…"
            className="field min-w-0 flex-1 font-mono text-2xs"
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
          <p className="mt-1 text-2xs font-medium text-rose-500">{fenError}</p>
        )}
      </div>
    </div>
  );
}
