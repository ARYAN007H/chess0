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

const RANK_DOTS: Record<number, string> = {
  1: 'bg-emerald-500',
  2: 'bg-sky-500',
  3: 'bg-amber-500',
};

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
    <div className="space-y-3.5">
      {/* Top Arena Selector: Play vs Bot | Play vs Friend (Invite Link) */}
      <div className="rounded-xl border border-stone-200/90 bg-white/85 p-3.5 dark:border-slate-800 dark:bg-slate-900/60">
        <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-stone-100 p-1 dark:bg-slate-800/90">
          <button
            type="button"
            onClick={() => props.onSwitchMode('hve')}
            className={`rounded-md py-1.5 text-xs font-bold transition ${
              props.mode === 'hve'
                ? 'bg-white text-emerald-700 shadow-xs dark:bg-slate-900 dark:text-emerald-400'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Play vs Bot
          </button>
          <button
            type="button"
            onClick={() => props.onSwitchMode('pvp')}
            className={`rounded-md py-1.5 text-xs font-bold transition ${
              props.mode === 'pvp'
                ? 'bg-white text-emerald-700 shadow-xs dark:bg-slate-900 dark:text-emerald-400'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Play vs Player · Invite Link
          </button>
        </div>

        {/* PLAY VS BOT CONFIGURATION */}
        {props.mode === 'hve' && (
          <div className="mt-3 space-y-3">
            {/* Learn Mode vs Competitive Mode Toggle */}
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                <span>Bot Match Mode</span>
                <span>
                  {props.botPlayStyle === 'learn'
                    ? 'Coach suggestions & arrows enabled'
                    : 'No hints · Official Elo rated'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => props.onSetBotPlayStyle('learn')}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    props.botPlayStyle === 'learn'
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
                      : 'border-stone-200/90 bg-white text-slate-700 hover:border-stone-300 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300'
                  }`}
                >
                  <div className="text-xs font-extrabold">Learn &amp; Coach Mode</div>
                  <div className="mt-0.5 text-[11px] opacity-80">
                    Shows 3-line player suggestions, arrows &amp; undo
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => props.onSetBotPlayStyle('comp')}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    props.botPlayStyle === 'comp'
                      ? 'border-amber-500 bg-amber-500/10 text-amber-900 dark:text-amber-200'
                      : 'border-stone-200/90 bg-white text-slate-700 hover:border-stone-300 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-extrabold">
                    <span>Competitive Mode</span>
                    <span className="font-mono text-[11px] tabular-nums">
                      {props.compElo} Elo
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] opacity-80">
                    Locks out hints, eval bar &amp; takebacks
                  </div>
                </button>
              </div>
            </div>

            {/* Bot Strength & Color Row */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
              <select
                value={currentBotLevel}
                onChange={(e) => props.onSetEngineLevel(botSide, e.target.value as Level)}
                className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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
                    onClick={() => props.onChooseSide(s)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold capitalize transition ${
                      props.playerSide === s
                        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-stone-300 bg-white text-slate-600 hover:border-stone-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
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
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                2-Player Connection
              </span>
              <div className="flex gap-1">
                {(
                  [
                    ['online', 'Online Invite Link'],
                    ['local', 'Pass & Play (1 Device)'],
                  ] as [PvpSubMode, string][]
                ).map(([sub, label]) => (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => props.onSetPvpSubMode(sub)}
                    className={`rounded-md px-2 py-1 text-[11px] font-bold transition ${
                      props.pvpSubMode === sub
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
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
                  <div className="space-y-2.5 rounded-lg border border-stone-200/80 bg-stone-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Your Display Name
                      </label>
                      <input
                        type="text"
                        value={props.playerName}
                        onChange={(e) => props.onSetPlayerName(e.target.value)}
                        placeholder="Enter your name…"
                        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => props.onCreateInviteRoom('white', props.playerName)}
                        className="rounded-lg bg-emerald-600 px-2.5 py-2 text-xs font-bold text-white transition hover:bg-emerald-500"
                      >
                        Host as White
                      </button>
                      <button
                        type="button"
                        onClick={() => props.onCreateInviteRoom('random', props.playerName)}
                        className="rounded-lg bg-emerald-600 px-2.5 py-2 text-xs font-bold text-white transition hover:bg-emerald-500"
                      >
                        Host Random
                      </button>
                      <button
                        type="button"
                        onClick={() => props.onCreateInviteRoom('black', props.playerName)}
                        className="rounded-lg bg-emerald-600 px-2.5 py-2 text-xs font-bold text-white transition hover:bg-emerald-500"
                      >
                        Host as Black
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5 pt-1">
                      <input
                        type="text"
                        value={joinCodeInput}
                        onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                        placeholder="Or enter 6-digit Room Code…"
                        className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-xs uppercase text-slate-800 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (joinCodeInput.trim()) {
                            props.onJoinInviteRoom(joinCodeInput.trim(), props.playerName);
                          }
                        }}
                        className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:border-emerald-500 hover:text-emerald-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        Join Room
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/[0.06] p-3 dark:border-emerald-500/30 dark:bg-emerald-500/[0.08]">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-extrabold text-emerald-700 dark:text-emerald-300">
                            Room {props.roomState.roomId}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                            {props.roomState.connectedCount >= 2 || props.roomState.guestId
                              ? 'Opponent Connected · Live'
                              : 'Waiting for opponent…'}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          Send this invite link to a friend (or open it in another tab/browser to play immediately):
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={props.onLeaveInviteRoom}
                        className="shrink-0 rounded border border-stone-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      >
                        Leave
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        readOnly
                        value={inviteUrl}
                        className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-700 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      />
                      <button
                        type="button"
                        onClick={copyInviteLink}
                        className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-500"
                      >
                        {linkCopied ? '✓ Link Copied!' : 'Copy Invite Link'}
                      </button>
                    </div>

                    {/* Match controls: Resign / Draw / Rematch */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={props.onResign}
                        className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-600 transition hover:border-rose-400 dark:border-slate-700 dark:bg-slate-900 dark:text-rose-400"
                      >
                        🏳 Resign
                      </button>
                      <button
                        type="button"
                        onClick={props.onAgreeDraw}
                        className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      >
                        ½ Agree Draw
                      </button>
                      <button
                        type="button"
                        onClick={props.onRequestRematch}
                        className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition hover:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-emerald-400"
                      >
                        ⟳ Rematch (Swap Colors)
                      </button>
                    </div>

                    {/* Live Room Chat */}
                    <div className="border-t border-stone-200/70 pt-2 dark:border-slate-800">
                      <div className="scroll-thin max-h-24 space-y-1 overflow-y-auto pr-1 text-xs">
                        {props.roomState.chat.length === 0 ? (
                          <p className="text-[11px] text-slate-400">
                            Match chat ready — say hello to your opponent!
                          </p>
                        ) : (
                          props.roomState.chat.map((c) => (
                            <div key={c.id} className="text-[11px]">
                              <strong className="font-bold text-slate-800 dark:text-slate-200">
                                {c.sender}:
                              </strong>{' '}
                              <span className="text-slate-600 dark:text-slate-300">
                                {c.text}
                              </span>
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
                          placeholder="Send message to opponent…"
                          className="min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          Send
                        </button>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-stone-200/80 bg-stone-50/70 p-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
                Pass &amp; Play active — both White and Black moves can be played directly on this board.
              </div>
            )}
          </div>
        )}
      </div>

      {/* LEARN MODE PLAYER SUGGESTIONS OR COMPETITIVE SHIELD */}
      {props.isAssistanceHidden ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4 dark:border-amber-500/30 dark:bg-amber-500/[0.08]">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                {props.mode === 'pvp'
                  ? 'Fair-Play Live Multiplayer Lock'
                  : 'Competitive Rated Match · Fair-Play Lock'}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                Engine suggestions, Multi-PV arrows, evaluation bar, and takebacks are hidden during active competitive play so neither player can use assistance.
              </p>
            </div>
          </div>

          {props.mode === 'hve' && (
            <div className="mt-3 flex items-center justify-between border-t border-amber-500/20 pt-2.5 text-xs">
              <div className="font-mono tabular-nums text-slate-700 dark:text-slate-200">
                Your Rating: <strong>{props.compElo} Elo</strong> · Bot:{' '}
                <strong>{currentBotElo} Elo</strong>
                {props.lastEloDelta !== null && (
                  <span
                    className={`ml-2 font-bold ${
                      props.lastEloDelta >= 0 ? 'text-emerald-600' : 'text-rose-500'
                    }`}
                  >
                    ({props.lastEloDelta >= 0 ? `+${props.lastEloDelta}` : props.lastEloDelta})
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={props.onResign}
                className="rounded-lg border border-rose-400/50 bg-white px-2.5 py-1 text-[11px] font-bold text-rose-600 transition hover:bg-rose-50 dark:bg-slate-900 dark:text-rose-400"
              >
                🏳 Resign Match
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* In Learn Mode vs Bot, show dedicated Player Coach Suggestions */}
          {props.mode === 'hve' && props.botPlayStyle === 'learn' && (
            <div className="space-y-2.5 rounded-xl border border-emerald-500/40 bg-white/90 p-3.5 dark:border-emerald-500/30 dark:bg-slate-900/70">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    Learn Mode · Coach Move Suggestions
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Top 3 recommended moves for {props.stmSide === 'white' ? 'White' : 'Black'} with tactical explanations:
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => props.onToggleArrows(!props.showMultiPvArrows)}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                    props.showMultiPvArrows
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-stone-300 text-slate-500 dark:border-slate-700'
                  }`}
                >
                  {props.showMultiPvArrows ? 'Arrows On' : 'Arrows Off'}
                </button>
              </div>

              {props.coachSuggestions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-stone-200 p-3 text-center text-xs text-slate-400 dark:border-slate-800">
                  Calculating 3 candidate move suggestions…
                </div>
              ) : (
                <div className="space-y-1.5">
                  {props.coachSuggestions.map((sug) => (
                    <div
                      key={sug.rank}
                      className="flex items-center justify-between gap-2 rounded-lg border border-stone-200/80 bg-stone-50/70 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/45"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${
                              RANK_DOTS[sug.rank] ?? 'bg-emerald-500'
                            }`}
                          />
                          <span className="font-mono text-xs font-extrabold text-slate-900 dark:text-white">
                            {sug.san}
                          </span>
                          <span className="font-mono text-[11px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                            {sug.scoreText}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                          {sug.explanation}
                        </p>
                      </div>

                      {props.canPlayMove && (
                        <button
                          type="button"
                          onClick={() => props.onPlayUciMove(sug.uci)}
                          className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-emerald-500"
                        >
                          Play {sug.san}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 3-Line Multi-PV Engine Telemetry */}
          <EngineInfo
            info={props.engineInfo}
            thinkingSide={props.thinkingSide}
            stmSide={props.stmSide}
            canPlayMove={props.canPlayMove}
            showMultiPvArrows={props.showMultiPvArrows}
            onToggleArrows={props.onToggleArrows}
            onPlayUciMove={props.onPlayUciMove}
            onAnalyzeDeeper={props.onAnalyzeDeeper}
          />
        </>
      )}
    </div>
  );
}
