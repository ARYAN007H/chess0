import { useState } from 'react';
import type {
  BotPlayStyle,
  CoachSuggestion,
  EnginePanelInfo,
  Level,
  Mode,
  PvpSubMode,
  Side,
} from '../useChessGame';
import { LEVEL_ELO, LEVEL_LABELS } from '../useChessGame';
import type { MultiplayerRoomSnapshot } from '../multiplayer';
import { EngineInfo } from './EngineInfo';

interface MatchArenaPanelProps {
  mode: Mode;
  botPlayStyle: BotPlayStyle;
  pvpSubMode: PvpSubMode;
  playerSide: Side;
  levels: Record<Side, Level>;
  compElo: number;
  lastEloDelta: number | null;
  isAssistanceHidden: boolean;
  coachSuggestions: CoachSuggestion[];
  engineInfo: EnginePanelInfo;
  thinkingSide: Side | null;
  stmSide: Side;
  canPlayMove: boolean;
  showMultiPvArrows: boolean;
  playerName: string;
  roomState: MultiplayerRoomSnapshot | null;
  onSwitchMode: (m: Mode) => void;
  onSetBotPlayStyle: (style: BotPlayStyle) => void;
  onSetPvpSubMode: (sub: PvpSubMode) => void;
  onChooseSide: (s: Side | 'random') => void;
  onSetEngineLevel: (side: Side, level: Level) => void;
  onToggleArrows: (show: boolean) => void;
  onPlayUciMove: (uci: string) => void;
  onAnalyzeDeeper: () => void;
  onSetPlayerName: (name: string) => void;
  onCreateInviteRoom: (side: Side | 'random', name?: string) => string;
  onJoinInviteRoom: (code: string, name?: string) => void;
  onLeaveInviteRoom: () => void;
  onResign: () => void;
  onAgreeDraw: () => void;
  onRequestRematch: () => void;
  onSendChat: (text: string) => void;
}

export function MatchArenaPanel(props: MatchArenaPanelProps) {
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [chatInput, setChatInput] = useState('');

  const botSide: Side = props.playerSide === 'white' ? 'black' : 'white';
  const currentBotLevel = props.levels[botSide];
  const currentBotElo = LEVEL_ELO[currentBotLevel];

  const inviteUrl =
    props.roomState && typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}?room=${props.roomState.roomId}`
      : '';

  const copyInviteLink = () => {
    if (!inviteUrl) return;
    void navigator.clipboard?.writeText(inviteUrl).catch(() => {});
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 1600);
  };

  return (
    <div className="space-y-3">
      {/* Top arena selector: Play vs Bot | Play a Friend (invite link) */}
      <div className="panel-sunken space-y-2.5 p-3">
        <div className="seg grid grid-cols-2">
          <button
            type="button"
            onClick={() => props.onSwitchMode('hve')}
            className={`seg-btn py-1.5 ${props.mode === 'hve' ? 'seg-btn-active' : ''}`}
          >
            Play vs Bot
          </button>
          <button
            type="button"
            onClick={() => props.onSwitchMode('pvp')}
            className={`seg-btn py-1.5 ${props.mode === 'pvp' ? 'seg-btn-active' : ''}`}
          >
            Play a Friend · Invite
          </button>
        </div>

        {/* PLAY VS BOT CONFIGURATION */}
        {props.mode === 'hve' && (
          <div className="space-y-2.5">
            {/* Learn mode vs competitive mode toggle */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => props.onSetBotPlayStyle('learn')}
                className={`rounded-lg border p-2.5 text-left transition ${
                  props.botPlayStyle === 'learn'
                    ? 'border-accent bg-accent/15 text-ink'
                    : 'border-line bg-surface text-ink-2 hover:border-line-strong'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-black">
                  <span>Coach Assisted</span>
                  <span className="rounded bg-accent/20 px-1.5 py-0.5 text-2xs font-extrabold text-accent-text">
                    LEARN
                  </span>
                </div>
                <div className="mt-0.5 text-2xs opacity-80">
                  3-line hints, arrows &amp; takebacks
                </div>
              </button>

              <button
                type="button"
                onClick={() => props.onSetBotPlayStyle('comp')}
                className={`rounded-lg border p-2.5 text-left transition ${
                  props.botPlayStyle === 'comp'
                    ? 'border-amber-500 bg-amber-500/15 text-ink'
                    : 'border-line bg-surface text-ink-2 hover:border-line-strong'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-black">
                  <span>Competitive</span>
                  <span className="font-mono text-2xs font-extrabold tabular-nums text-amber-600 dark:text-amber-400">
                    {props.compElo}
                  </span>
                </div>
                <div className="mt-0.5 text-2xs opacity-80">
                  No hints · Official Elo rated
                </div>
              </button>
            </div>

            {/* Bot strength & color row */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
              <select
                aria-label="Bot difficulty level"
                value={currentBotLevel}
                onChange={(e) => props.onSetEngineLevel(botSide, e.target.value as Level)}
                className="field min-w-0"
              >
                {(Object.keys(LEVEL_LABELS) as Level[]).map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {LEVEL_LABELS[lvl]}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1.5">
                {(['white', 'random', 'black'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-label={s === 'random' ? 'Play random side' : `Play as ${s}`}
                    onClick={() => props.onChooseSide(s)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold capitalize transition ${
                      props.playerSide === s
                        ? 'border-accent bg-accent/20 text-accent-text'
                        : 'border-line-strong bg-surface text-ink-2 hover:border-ink-3'
                    }`}
                  >
                    {s === 'random' ? '🎲' : s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* PLAY VS PLAYER (INVITE LINK & PASS-AND-PLAY) */}
        {props.mode === 'pvp' && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="micro-label">2-Player Mode</span>
              <div className="flex gap-1">
                {(
                  [
                    ['online', 'Online Invite Link'],
                    ['local', 'Pass & Play'],
                  ] as [PvpSubMode, string][]
                ).map(([sub, label]) => (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => props.onSetPvpSubMode(sub)}
                    className={`rounded-md px-2 py-1 text-2xs font-bold transition ${
                      props.pvpSubMode === sub
                        ? 'bg-accent/15 text-accent-text'
                        : 'text-ink-3 hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {props.pvpSubMode === 'online' ? (
              <div className="space-y-2.5">
                {!props.roomState ? (
                  <div className="panel space-y-2.5 p-2.5">
                    <div>
                      <label className="micro-label block">Your Display Name</label>
                      <input
                        type="text"
                        value={props.playerName}
                        onChange={(e) => props.onSetPlayerName(e.target.value)}
                        placeholder="Enter your name…"
                        className="field mt-1"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => props.onCreateInviteRoom('white', props.playerName)}
                        className="btn-primary px-2 py-2 text-xs"
                      >
                        Host White
                      </button>
                      <button
                        type="button"
                        onClick={() => props.onCreateInviteRoom('random', props.playerName)}
                        className="btn-primary px-2 py-2 text-xs"
                      >
                        Host 🎲
                      </button>
                      <button
                        type="button"
                        onClick={() => props.onCreateInviteRoom('black', props.playerName)}
                        className="btn-primary px-2 py-2 text-xs"
                      >
                        Host Black
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5 pt-0.5">
                      <input
                        type="text"
                        value={joinCodeInput}
                        onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                        placeholder="Or enter 6-digit Room Code…"
                        className="field min-w-0 flex-1 font-mono uppercase"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (joinCodeInput.trim()) {
                            props.onJoinInviteRoom(joinCodeInput.trim(), props.playerName);
                          }
                        }}
                        className="btn-quiet px-3 py-1.5 text-xs"
                      >
                        Join
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 rounded-lg border border-accent/40 bg-accent/10 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-black text-accent-text">
                            Room {props.roomState.roomId}
                          </span>
                          <span className="text-ink-3">·</span>
                          <span className="text-xs font-bold text-ink">
                            {props.roomState.connectedCount >= 2 || props.roomState.guestId
                              ? 'Opponent Connected · Live'
                              : 'Waiting for friend…'}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={props.onLeaveInviteRoom}
                        className="shrink-0 rounded-md border border-line bg-sunken px-2 py-0.5 text-2xs font-bold text-ink-2 transition hover:text-rose-600"
                      >
                        Leave
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        readOnly
                        value={inviteUrl}
                        className="field min-w-0 flex-1 px-2 py-1 font-mono text-2xs"
                      />
                      <button
                        type="button"
                        onClick={copyInviteLink}
                        className="btn-primary shrink-0 px-2.5 py-1 text-2xs"
                      >
                        {linkCopied ? '✓ Copied!' : 'Copy Link'}
                      </button>
                    </div>

                    {/* Match controls: resign / draw / rematch */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={props.onResign}
                        className="rounded-md border border-line bg-sunken px-2 py-1 text-2xs font-bold text-rose-600 dark:text-rose-400"
                      >
                        🏳 Resign
                      </button>
                      <button
                        type="button"
                        onClick={props.onAgreeDraw}
                        className="rounded-md border border-line bg-sunken px-2 py-1 text-2xs font-bold text-ink-2"
                      >
                        ½ Draw
                      </button>
                      <button
                        type="button"
                        onClick={props.onRequestRematch}
                        className="rounded-md border border-line bg-sunken px-2 py-1 text-2xs font-bold text-accent-text"
                      >
                        ⟳ Rematch
                      </button>
                    </div>

                    {/* Live room chat */}
                    <div className="border-t border-line pt-2">
                      <div className="scroll-thin max-h-20 space-y-1 overflow-y-auto pr-1 text-xs">
                        {props.roomState.chat.length === 0 ? (
                          <p className="text-2xs text-ink-3">
                            Match chat ready — say hello!
                          </p>
                        ) : (
                          props.roomState.chat.map((c) => (
                            <div key={c.id} className="text-2xs">
                              <strong className="font-bold text-ink">{c.sender}:</strong>{' '}
                              <span className="text-ink-2">{c.text}</span>
                            </div>
                          ))
                        )}
                      </div>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!chatInput.trim()) return;
                          props.onSendChat(chatInput);
                          setChatInput('');
                        }}
                        className="mt-1.5 flex gap-1.5"
                      >
                        <input
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder="Message opponent…"
                          className="field min-w-0 flex-1 px-2 py-1"
                        />
                        <button
                          type="submit"
                          className="btn-quiet px-2.5 py-1 text-xs"
                        >
                          Send
                        </button>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-line bg-surface p-2 text-xs text-ink-2">
                Pass &amp; Play active — both White and Black moves can be played on this board.
              </div>
            )}
          </div>
        )}
      </div>

      {/* LEARN MODE PLAYER SUGGESTIONS & 3-LINE MULTI-PV OR COMPETITIVE SHIELD */}
      {props.isAssistanceHidden ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <h3 className="text-2xs font-extrabold tracking-wider text-amber-700 uppercase dark:text-amber-300">
            {props.mode === 'pvp'
              ? '🔒 Live Multiplayer Fair-Play Lock'
              : '🔒 Competitive Rated Match · Fair-Play Lock'}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-2">
            Coach suggestions, 3-line arrows, evaluation bar, and takebacks are locked during active competitive play. Full Game Review unlocks when the match ends!
          </p>

          {props.mode === 'hve' && (
            <div className="mt-3 flex items-center justify-between border-t border-amber-500/20 pt-2.5 text-xs">
              <div className="font-mono tabular-nums text-ink">
                Your Elo: <strong>{props.compElo}</strong> · Bot: <strong>{currentBotElo}</strong>
                {props.lastEloDelta !== null && (
                  <span
                    className={`ml-2 font-bold ${
                      props.lastEloDelta >= 0 ? 'text-accent' : 'text-rose-500'
                    }`}
                  >
                    ({props.lastEloDelta >= 0 ? `+${props.lastEloDelta}` : props.lastEloDelta})
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={props.onResign}
                className="rounded-md bg-rose-500/20 px-2.5 py-1 text-2xs font-extrabold text-rose-600 transition hover:bg-rose-500/30 dark:text-rose-300"
              >
                🏳 Resign
              </button>
            </div>
          )}
        </div>
      ) : (
        <EngineInfo
          info={props.engineInfo}
          coachSuggestions={props.coachSuggestions}
          isLearnMode={props.mode === 'hve' && props.botPlayStyle === 'learn'}
          thinkingSide={props.thinkingSide}
          stmSide={props.stmSide}
          canPlayMove={props.canPlayMove}
          showMultiPvArrows={props.showMultiPvArrows}
          onToggleArrows={props.onToggleArrows}
          onPlayUciMove={props.onPlayUciMove}
          onAnalyzeDeeper={props.onAnalyzeDeeper}
        />
      )}
    </div>
  );
}
