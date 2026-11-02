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
    <div className="space-y-3 p-3.5">
      {/* Top Arena Selector: Play vs Bot | Play a Friend (Invite Link) */}
      <div className="space-y-2.5 rounded-xl border border-stone-200/90 bg-stone-50/80 p-3 dark:border-white/10 dark:bg-[#1f1e1b]">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-stone-200/80 p-1 dark:bg-[#302e2b]">
          <button
            type="button"
            onClick={() => props.onSwitchMode('hve')}
            className={`rounded-md py-1.5 text-xs font-extrabold transition ${
              props.mode === 'hve'
                ? 'bg-white text-stone-900 shadow-xs dark:bg-[#21201d] dark:text-white'
                : 'text-stone-600 hover:text-stone-900 dark:text-[#989795] dark:hover:text-white'
            }`}
          >
            Play vs Bot
          </button>
          <button
            type="button"
            onClick={() => props.onSwitchMode('pvp')}
            className={`rounded-md py-1.5 text-xs font-extrabold transition ${
              props.mode === 'pvp'
                ? 'bg-white text-stone-900 shadow-xs dark:bg-[#21201d] dark:text-white'
                : 'text-stone-600 hover:text-stone-900 dark:text-[#989795] dark:hover:text-white'
            }`}
          >
            Play a Friend · Invite
          </button>
        </div>

        {/* PLAY VS BOT CONFIGURATION */}
        {props.mode === 'hve' && (
          <div className="space-y-2.5">
            {/* Learn Mode vs Competitive Mode Toggle */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => props.onSetBotPlayStyle('learn')}
                className={`rounded-lg border p-2.5 text-left transition ${
                  props.botPlayStyle === 'learn'
                    ? 'border-[#81b64c] bg-[#81b64c]/15 text-stone-900 dark:text-white'
                    : 'border-stone-200/90 bg-white text-stone-600 hover:border-stone-300 dark:border-white/5 dark:bg-[#262522] dark:text-[#bababa]'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-black">
                  <span>Coach Assisted</span>
                  <span className="rounded bg-[#81b64c]/25 px-1.5 py-0.5 text-[9.5px] font-extrabold text-[#629924] dark:text-[#a3d160]">
                    LEARN
                  </span>
                </div>
                <div className="mt-0.5 text-[10.5px] opacity-80">
                  3-line hints, arrows &amp; takebacks
                </div>
              </button>

              <button
                type="button"
                onClick={() => props.onSetBotPlayStyle('comp')}
                className={`rounded-lg border p-2.5 text-left transition ${
                  props.botPlayStyle === 'comp'
                    ? 'border-amber-500 bg-amber-500/15 text-stone-900 dark:text-white'
                    : 'border-stone-200/90 bg-white text-stone-600 hover:border-stone-300 dark:border-white/5 dark:bg-[#262522] dark:text-[#bababa]'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-black">
                  <span>Competitive</span>
                  <span className="font-mono text-[10.5px] font-extrabold tabular-nums text-amber-600 dark:text-amber-400">
                    {props.compElo}
                  </span>
                </div>
                <div className="mt-0.5 text-[10.5px] opacity-80">
                  No hints · Official Elo rated
                </div>
              </button>
            </div>

            {/* Bot Strength & Color Row */}
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[1fr_auto]">
              <select
                aria-label="Bot difficulty level"
                value={currentBotLevel}
                onChange={(e) => props.onSetEngineLevel(botSide, e.target.value as Level)}
                className="min-w-0 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-bold text-stone-800 focus:border-[#81b64c] focus:outline-none dark:border-white/10 dark:bg-[#262522] dark:text-white"
              >
                {(Object.keys(LEVEL_LABELS) as Level[]).map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {LEVEL_LABELS[lvl]}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1">
                {(['white', 'random', 'black'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-label={s === 'random' ? 'Play random side' : `Play as ${s}`}
                    onClick={() => props.onChooseSide(s)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold capitalize transition ${
                      props.playerSide === s
                        ? 'border-[#81b64c] bg-[#81b64c]/20 text-[#537a28] dark:text-[#a3d160]'
                        : 'border-stone-300 bg-white text-stone-600 hover:border-stone-400 dark:border-white/10 dark:bg-[#262522] dark:text-[#bababa]'
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
              <span className="text-[10px] font-bold tracking-wider text-stone-400 uppercase dark:text-[#7c7a77]">
                2-Player Mode
              </span>
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
                    className={`rounded-md px-2 py-1 text-[11px] font-bold transition ${
                      props.pvpSubMode === sub
                        ? 'bg-[#81b64c]/20 text-[#537a28] dark:text-[#a3d160]'
                        : 'text-stone-500 hover:text-stone-800 dark:text-[#989795]'
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
                  <div className="space-y-2.5 rounded-lg border border-stone-200/80 bg-white p-2.5 dark:border-white/10 dark:bg-[#262522]">
                    <div>
                      <label className="block text-[10px] font-bold tracking-wider text-stone-400 uppercase">
                        Your Display Name
                      </label>
                      <input
                        type="text"
                        value={props.playerName}
                        onChange={(e) => props.onSetPlayerName(e.target.value)}
                        placeholder="Enter your name…"
                        className="mt-1 w-full rounded-lg border border-stone-300 bg-stone-50 px-2.5 py-1.5 text-xs font-semibold text-stone-800 focus:border-[#81b64c] focus:outline-none dark:border-white/10 dark:bg-[#1f1e1b] dark:text-white"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => props.onCreateInviteRoom('white', props.playerName)}
                        className="rounded-lg bg-[#81b64c] px-2 py-2 text-xs font-extrabold text-white shadow-[0_2px_0_#537a28] transition hover:bg-[#8ec356]"
                      >
                        Host White
                      </button>
                      <button
                        type="button"
                        onClick={() => props.onCreateInviteRoom('random', props.playerName)}
                        className="rounded-lg bg-[#81b64c] px-2 py-2 text-xs font-extrabold text-white shadow-[0_2px_0_#537a28] transition hover:bg-[#8ec356]"
                      >
                        Host 🎲
                      </button>
                      <button
                        type="button"
                        onClick={() => props.onCreateInviteRoom('black', props.playerName)}
                        className="rounded-lg bg-[#81b64c] px-2 py-2 text-xs font-extrabold text-white shadow-[0_2px_0_#537a28] transition hover:bg-[#8ec356]"
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
                        className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-stone-50 px-2.5 py-1.5 font-mono text-xs uppercase text-stone-800 focus:border-[#81b64c] focus:outline-none dark:border-white/10 dark:bg-[#1f1e1b] dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (joinCodeInput.trim()) {
                            props.onJoinInviteRoom(joinCodeInput.trim(), props.playerName);
                          }
                        }}
                        className="rounded-lg bg-stone-200 px-3 py-1.5 text-xs font-extrabold text-stone-800 transition hover:bg-stone-300 dark:bg-[#302e2b] dark:text-white"
                      >
                        Join
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 rounded-lg border border-[#81b64c]/40 bg-[#81b64c]/10 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-black text-[#629924] dark:text-[#a3d160]">
                            Room {props.roomState.roomId}
                          </span>
                          <span className="text-stone-400">·</span>
                          <span className="text-xs font-bold text-stone-700 dark:text-white">
                            {props.roomState.connectedCount >= 2 || props.roomState.guestId
                              ? 'Opponent Connected · Live'
                              : 'Waiting for friend…'}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={props.onLeaveInviteRoom}
                        className="shrink-0 rounded bg-stone-200 px-2 py-0.5 text-[11px] font-bold text-stone-700 hover:text-rose-600 dark:bg-[#302e2b] dark:text-[#bababa]"
                      >
                        Leave
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        readOnly
                        value={inviteUrl}
                        className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2 py-1 font-mono text-[11px] text-stone-700 focus:outline-none dark:border-white/10 dark:bg-[#1f1e1b] dark:text-[#bababa]"
                      />
                      <button
                        type="button"
                        onClick={copyInviteLink}
                        className="shrink-0 rounded-lg bg-[#81b64c] px-2.5 py-1 text-xs font-extrabold text-white transition hover:bg-[#72a341]"
                      >
                        {linkCopied ? '✓ Copied!' : 'Copy Link'}
                      </button>
                    </div>

                    {/* Match controls: Resign / Draw / Rematch */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={props.onResign}
                        className="rounded-md bg-stone-200 px-2 py-1 text-[11px] font-bold text-rose-600 dark:bg-[#302e2b] dark:text-rose-400"
                      >
                        🏳 Resign
                      </button>
                      <button
                        type="button"
                        onClick={props.onAgreeDraw}
                        className="rounded-md bg-stone-200 px-2 py-1 text-[11px] font-bold text-stone-700 dark:bg-[#302e2b] dark:text-[#bababa]"
                      >
                        ½ Draw
                      </button>
                      <button
                        type="button"
                        onClick={props.onRequestRematch}
                        className="rounded-md bg-stone-200 px-2 py-1 text-[11px] font-bold text-[#629924] dark:bg-[#302e2b] dark:text-[#a3d160]"
                      >
                        ⟳ Rematch
                      </button>
                    </div>

                    {/* Live Room Chat */}
                    <div className="border-t border-stone-200/70 pt-2 dark:border-white/10">
                      <div className="scroll-thin max-h-20 space-y-1 overflow-y-auto pr-1 text-xs">
                        {props.roomState.chat.length === 0 ? (
                          <p className="text-[11px] text-stone-400 dark:text-[#7c7a77]">
                            Match chat ready — say hello!
                          </p>
                        ) : (
                          props.roomState.chat.map((c) => (
                            <div key={c.id} className="text-[11px]">
                              <strong className="font-bold text-stone-800 dark:text-white">
                                {c.sender}:
                              </strong>{' '}
                              <span className="text-stone-600 dark:text-[#bababa]">{c.text}</span>
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
                          className="min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-2 py-1 text-xs text-stone-800 focus:border-[#81b64c] focus:outline-none dark:border-white/10 dark:bg-[#1f1e1b] dark:text-white"
                        />
                        <button
                          type="submit"
                          className="rounded-md bg-stone-200 px-2.5 py-1 text-xs font-bold text-stone-700 dark:bg-[#302e2b] dark:text-white"
                        >
                          Send
                        </button>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-stone-200/80 bg-white p-2 text-xs text-stone-600 dark:border-white/10 dark:bg-[#262522] dark:text-[#bababa]">
                Pass &amp; Play active — both White and Black moves can be played on this board.
              </div>
            )}
          </div>
        )}
      </div>

      {/* LEARN MODE PLAYER SUGGESTIONS & 3-LINE MULTI-PV OR COMPETITIVE SHIELD */}
      {props.isAssistanceHidden ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5">
          <h3 className="text-xs font-extrabold tracking-wider text-amber-700 uppercase dark:text-amber-300">
            {props.mode === 'pvp'
              ? '🔒 Live Multiplayer Fair-Play Lock'
              : '🔒 Competitive Rated Match · Fair-Play Lock'}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-stone-600 dark:text-[#bababa]">
            Coach suggestions, 3-line arrows, evaluation bar, and takebacks are locked during active competitive play. Full Game Review unlocks when the match ends!
          </p>

          {props.mode === 'hve' && (
            <div className="mt-3 flex items-center justify-between border-t border-amber-500/20 pt-2.5 text-xs">
              <div className="font-mono tabular-nums text-stone-700 dark:text-white">
                Your Elo: <strong>{props.compElo}</strong> · Bot: <strong>{currentBotElo}</strong>
                {props.lastEloDelta !== null && (
                  <span
                    className={`ml-2 font-bold ${
                      props.lastEloDelta >= 0 ? 'text-[#81b64c]' : 'text-rose-500'
                    }`}
                  >
                    ({props.lastEloDelta >= 0 ? `+${props.lastEloDelta}` : props.lastEloDelta})
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={props.onResign}
                className="rounded-lg bg-rose-500/20 px-2.5 py-1 text-[11px] font-extrabold text-rose-600 transition hover:bg-rose-500/30 dark:text-rose-300"
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


