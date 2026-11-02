/**
 * useChessGame: comprehensive game, multiplayer, puzzle, academy & analysis
 * orchestration for the Chess0 v3 Grandmaster Workbench.
 *
 * Manages:
 *   - Play vs Bot with 2 distinct modes:
 *       1. 'learn' (Assisted Coach Mode: shows 3-line player suggestions, explanations, arrows, eval bar, takebacks)
 *       2. 'comp'  (Competitive Mode: hides all suggestions, arrows, eval bar & takebacks until game end; tracks Competitive Elo)
 *   - Play vs Player (Real-Time Invite Link via WebSockets + WebRTC PeerJS + BroadcastChannel, or Local Pass & Play)
 *   - Interactive Tactical Puzzle Trainer (multi-ply verification, rating & streak)
 *   - Interactive Chess Academy (guided step-by-step on-board lessons)
 *   - Real-time Move Analysis, Accuracy %, and Opening Explorer
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Engine } from './engine/engine';
import type { GameEnd, SearchInfo } from './engine/engine';
import {
  moveFrom,
  moveTo,
  movePromo,
  moveToUci,
  parseSquare,
  squareName,
  START_FEN,
} from './engine/engine';
import type { MultiPvLine } from './engine/search';
import { newStartPosition, parseFen } from './engine/position';
import { evalV3WhitePov } from './engine/evalV3';
import { detectOpening, probeBookV3 } from './engine/bookV3';
import type { BookCandidate } from './engine/bookV3';
import { analyzeMoveExecution, computeGameSummary } from './engine/analysis';
import type { GameSummaryStats, MoveAnalysisData } from './engine/analysis';
import { PUZZLE_LIBRARY } from './engine/puzzles';
import type { ChessPuzzle } from './engine/puzzles';
import { ACADEMY_MODULES, describeCoachSuggestion } from './engine/lessons';
import type { AcademyModule } from './engine/lessons';
import {
  MultiplayerSession,
  generateRoomCode,
  getOrCreatePlayerId,
} from './multiplayer';
import type { MultiplayerRoomSnapshot } from './multiplayer';
import type { EngineBestMove, EngineInfoEvent } from './engineClient';
import { EnginePoolClient, defaultThreadCount } from './enginePool';
import { playSound } from './sound';

export type Mode = 'hve' | 'pvp' | 'puzzle' | 'academy' | 'eve' | 'analysis';
export type BotPlayStyle = 'learn' | 'comp';
export type PvpSubMode = 'online' | 'local';
export type Level = 'random' | 'beginner' | 'intermediate' | 'full' | 'v2' | 'v3';
export type Side = 'white' | 'black';
export type Theme = 'light' | 'dark';
export type BoardTheme = 'walnut' | 'slate' | 'emerald' | 'arctic';

export const LEVEL_LABELS: Record<Level, string> = {
  random: 'Random Mover (400 Elo)',
  beginner: 'Beginner · Depth 2 (850 Elo)',
  intermediate: 'Club Player · Depth 4 (1350 Elo)',
  full: 'Chess0 v1 · Classic (1850 Elo)',
  v2: 'Chess0 v2 · Positional (2300 Elo)',
  v3: 'Chess0 v3 · Grandmaster (3-Line Multi-PV · 2850+)',
};

export const LEVEL_ELO: Record<Level, number> = {
  random: 400,
  beginner: 850,
  intermediate: 1350,
  full: 1850,
  v2: 2300,
  v3: 2850,
};

const LEVEL_LIMITS: Record<
  Exclude<Level, 'random'>,
  { depth?: number; movetime?: number; variant?: 'v1' | 'v2' | 'v3'; multiPv?: number }
> = {
  beginner: { depth: 2, variant: 'v1' },
  intermediate: { depth: 4, variant: 'v2' },
  full: { movetime: 1000, variant: 'v1' },
  v2: { movetime: 1000, variant: 'v2' },
  v3: { movetime: 4200, variant: 'v3', multiPv: 3 },
};

export interface HistoryEntry {
  ply: number;
  uci: string;
  san: string;
  fenBefore: string;
  fenAfter: string;
  from: string;
  to: string;
  analysis: MoveAnalysisData;
}

export interface EnginePanelInfo {
  thinking: boolean;
  depth: number;
  seldepth: number;
  nodes: number;
  nps: number;
  timeMs: number;
  scoreCp?: number;
  scoreMate?: number;
  pvSan: string[];
  pvUci: string[];
  bookOpening?: string;
  multiPv: MultiPvLine[];
}

export interface CoachSuggestion {
  rank: number;
  uci: string;
  san: string;
  scoreText: string;
  explanation: string;
  pvSan: string[];
}

const EMPTY_INFO: EnginePanelInfo = {
  thinking: false,
  depth: 0,
  seldepth: 0,
  nodes: 0,
  nps: 0,
  timeMs: 0,
  pvSan: [],
  pvUci: [],
  multiPv: [],
};

export interface EvalPov {
  cp?: number;
  mate?: number;
}

const sideOf = (color: 0 | 1): Side => (color === 0 ? 'white' : 'black');
const colorOf = (side: Side): 0 | 1 => (side === 'white' ? 0 : 1);

export function useChessGame() {
  const engineRef = useRef<Engine | null>(null);
  const clientRef = useRef<EnginePoolClient | null>(null);
  const tokenRef = useRef(0);
  const preCandidatesRef = useRef<MultiPvLine[]>([]);
  const mpSessionRef = useRef<MultiplayerSession | null>(null);

  const [mode, setMode] = useState<Mode>('hve');
  const [botPlayStyle, setBotPlayStyle] = useState<BotPlayStyle>('learn');
  const [pvpSubMode, setPvpSubMode] = useState<PvpSubMode>('online');
  const [playerSide, setPlayerSide] = useState<Side>('white');
  const [levels, setLevels] = useState<Record<Side, Level>>({ white: 'v3', black: 'v3' });
  const [eveRunning, setEveRunning] = useState(false);
  const [autoFlip, setAutoFlip] = useState(false);

  // Competitive Elo rating (persisted)
  const [compElo, setCompElo] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem('chess0-comp-elo'));
      if (Number.isFinite(v) && v >= 100) return v;
    } catch {}
    return 1200;
  });
  const [lastEloDelta, setLastEloDelta] = useState<number | null>(null);

  // Multiplayer Room State
  const [playerName, setPlayerName] = useState<string>(() => {
    try {
      return localStorage.getItem('chess0-player-name') || 'Grandmaster';
    } catch {
      return 'Grandmaster';
    }
  });
  const [roomState, setRoomState] = useState<MultiplayerRoomSnapshot | null>(null);

  // Puzzle State
  const [activePuzzleIndex, setActivePuzzleIndex] = useState(0);
  const [puzzleStepIndex, setPuzzleStepIndex] = useState(0);
  const [puzzleStatus, setPuzzleStatus] = useState<
    'solving' | 'correct_step' | 'solved' | 'failed'
  >('solving');
  const [puzzleHintLevel, setPuzzleHintLevel] = useState<0 | 1 | 2>(0);
  const [puzzleHintSquare, setPuzzleHintSquare] = useState<string | null>(null);
  const puzzleShowHint = puzzleHintLevel > 0;
  const [academyShowHint, setAcademyShowHint] = useState(false);
  const [puzzleRating, setPuzzleRating] = useState<number>(() => {
    try {
      const r = Number(localStorage.getItem('chess0-puzzle-rating'));
      if (Number.isFinite(r) && r >= 400) return r;
    } catch {}
    return 1350;
  });
  const [puzzleStreak, setPuzzleStreak] = useState<number>(() => {
    try {
      return Number(localStorage.getItem('chess0-puzzle-streak')) || 0;
    } catch {
      return 0;
    }
  });
  const [solvedPuzzleIds, setSolvedPuzzleIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('chess0-solved-puzzles');
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  // Academy State
  const [activeModuleId, setActiveModuleId] = useState<string>(ACADEMY_MODULES[0].id);
  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);
  const [lessonStatus, setLessonStatus] = useState<'prompt' | 'completed' | 'wrong'>('prompt');
  const [completedLessons, setCompletedLessons] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('chess0-completed-lessons');
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  const [initialFen, setInitialFen] = useState(START_FEN);
  const [fen, setFen] = useState(START_FEN);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [viewPly, setViewPly] = useState<number | null>(null);

  const [gameEnd, setGameEnd] = useState<GameEnd>(null);
  const [customResultBanner, setCustomResultBanner] = useState<{
    title: string;
    detail: string;
  } | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [selected, setSelected] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const [thinkingSide, setThinkingSide] = useState<Side | null>(null);
  const [engineInfo, setEngineInfo] = useState<EnginePanelInfo>(EMPTY_INFO);
  const [evalPov, setEvalPov] = useState<EvalPov>({ cp: 15 });
  const [pvArrow, setPvArrow] = useState<[string, string] | null>(null);
  const [showMultiPvArrows, setShowMultiPvArrows] = useState(true);
  const [gameId, setGameId] = useState(0);
  const [engineReview, setEngineReview] = useState<{ done: number; total: number } | null>(null);
  const [reviewedGameId, setReviewedGameId] = useState<number | null>(null);
  const reviewRunningRef = useRef(false);

  const [soundOn, setSoundOn] = useState(() => {
    try {
      return localStorage.getItem('chess0-sound') !== 'off';
    } catch {
      return true;
    }
  });
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('chess0-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return 'dark';
  });
  const [boardTheme, setBoardTheme] = useState<BoardTheme>(() => {
    try {
      const saved = localStorage.getItem('chess0-board-theme') as BoardTheme | null;
      if (saved && ['walnut', 'slate', 'emerald', 'arctic'].includes(saved)) return saved;
    } catch {}
    return 'emerald';
  });

  const configRef = useRef({
    mode,
    botPlayStyle,
    pvpSubMode,
    playerSide,
    levels,
    eveRunning,
    autoFlip,
    soundOn,
  });
  configRef.current = {
    mode,
    botPlayStyle,
    pvpSubMode,
    playerSide,
    levels,
    eveRunning,
    autoFlip,
    soundOn,
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('chess0-theme', theme);
    } catch {}
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem('chess0-sound', soundOn ? 'on' : 'off');
    } catch {}
  }, [soundOn]);

  useEffect(() => {
    try {
      localStorage.setItem('chess0-board-theme', boardTheme);
    } catch {}
  }, [boardTheme]);

  useEffect(() => {
    try {
      localStorage.setItem('chess0-player-name', playerName);
    } catch {}
  }, [playerName]);

  // Search threads (worker fan-out). Changing it rebuilds the worker pool.
  const searchThreadsRef = useRef(defaultThreadCount());
  const [searchThreads, setSearchThreadsState] = useState(() => {
    try {
      const v = Number(localStorage.getItem('chess0-threads'));
      if (Number.isFinite(v) && v >= 1 && v <= 8) return v;
    } catch {}
    return defaultThreadCount();
  });
  useEffect(() => {
    try {
      localStorage.setItem('chess0-threads', String(searchThreads));
    } catch {}
  }, [searchThreads]);

  const setSearchThreads = useCallback((n: number) => {
    const v = Math.max(1, Math.min(8, n | 0));
    searchThreadsRef.current = v;
    setSearchThreadsState(v);
    if (clientRef.current) {
      clientRef.current.terminate();
      clientRef.current = new EnginePoolClient(v);
      if (engineRef.current) clientRef.current.reset(engineRef.current.fen());
    }
  }, []);

  const ensureInit = useCallback(() => {
    if (engineRef.current === null) engineRef.current = new Engine();
    if (clientRef.current === null) clientRef.current = new EnginePoolClient(searchThreadsRef.current);
    return { engine: engineRef.current, client: clientRef.current };
  }, []);

  // Determine whether engine assistance (arrows, suggestions, eval bar, book hints) is hidden
  // Competitive Bot mode or active Online PvP hides engine assistance until the match ends!
  const isAssistanceHidden = useMemo(() => {
    const matchOngoing = gameEnd === null && customResultBanner === null;
    if (!matchOngoing) return false;
    if (mode === 'hve' && botPlayStyle === 'comp') return true;
    if (mode === 'pvp' && pvpSubMode === 'online') return true;
    if (mode === 'puzzle') return true;
    return false;
  }, [mode, botPlayStyle, pvpSubMode, gameEnd, customResultBanner]);

  // --- eval / info plumbing ----------------------------------------------

  const applyScore = useCallback(
    (info: { stm: 0 | 1 } & { scoreCp?: number; scoreMate?: number }) => {
      if (info.scoreMate !== undefined) {
        const mate = info.stm === 0 ? info.scoreMate : -info.scoreMate;
        setEvalPov({ mate });
      } else if (info.scoreCp !== undefined) {
        const cp = info.stm === 0 ? info.scoreCp : -info.scoreCp;
        setEvalPov({ cp });
      }
    },
    [],
  );

  const applyMoveInfo = useCallback(
    (info: EngineInfoEvent, isThinking = true) => {
      setEngineInfo((prev) => ({
        thinking: isThinking,
        depth: info.depth,
        seldepth: info.seldepth,
        nodes: info.nodes,
        nps: info.nps,
        timeMs: info.timeMs,
        scoreCp: info.scoreCp,
        scoreMate: info.scoreMate,
        pvSan: info.pvSan,
        pvUci: info.pvUci,
        bookOpening: info.bookOpening ?? prev.bookOpening,
        multiPv: info.multiPv && info.multiPv.length > 0 ? info.multiPv : prev.multiPv,
      }));
      applyScore(info);
      if (info.pvUci.length >= 1) {
        setPvArrow([info.pvUci[0].slice(0, 2), info.pvUci[0].slice(2, 4)]);
      }
    },
    [applyScore],
  );

  // --- Elo update when Competitive Bot match ends ------------------------

  const updateCompetitiveElo = useCallback(
    (end: NonNullable<GameEnd> | 'resign') => {
      if (configRef.current.mode !== 'hve' || configRef.current.botPlayStyle !== 'comp') return;
      const pSide = configRef.current.playerSide;
      const botSide: Side = pSide === 'white' ? 'black' : 'white';
      const botElo = LEVEL_ELO[configRef.current.levels[botSide]];

      let score = 0.5;
      if (end === 'resign') {
        score = 0;
      } else if (end.type === 'checkmate') {
        const winnerSide: Side = end.winner === 0 ? 'white' : 'black';
        score = winnerSide === pSide ? 1 : 0;
      }

      setCompElo((prev) => {
        const expected = 1 / (1 + Math.pow(10, (botElo - prev) / 400));
        const delta = Math.round(32 * (score - expected));
        const next = Math.max(100, prev + delta);
        setLastEloDelta(delta);
        try {
          localStorage.setItem('chess0-comp-elo', String(next));
        } catch {}
        return next;
      });
    },
    [],
  );

  // --- move application & real-time classification -------------------------

  const scheduleNextRef = useRef<() => void>(() => {});

  const applyMoveInternal = useCallback(
    (move: number, engineSearchResult?: EngineInfoEvent, broadcastToRoom = true) => {
      const { engine, client } = ensureInit();
      const fenBefore = engine.fen();
      const posBefore = engine.pos.clone();
      const san = engine.sanFor(move);
      const uci = moveToUci(move);
      const fromSq = squareName(moveFrom(move));
      const toSq = squareName(moveTo(move));

      const preCandidates =
        engineSearchResult?.multiPv && engineSearchResult.multiPv.length > 0
          ? engineSearchResult.multiPv
          : preCandidatesRef.current;

      let postWhiteCpOverride: number | undefined;
      let postWhiteMateOverride: number | undefined;
      if (engineSearchResult) {
        if (engineSearchResult.scoreMate !== undefined) {
          postWhiteMateOverride =
            engineSearchResult.stm === 0
              ? engineSearchResult.scoreMate
              : -engineSearchResult.scoreMate;
        } else if (engineSearchResult.scoreCp !== undefined) {
          postWhiteCpOverride =
            engineSearchResult.stm === 0
              ? engineSearchResult.scoreCp
              : -engineSearchResult.scoreCp;
        }
      }

      const analysis = analyzeMoveExecution(
        posBefore,
        move,
        preCandidates,
        postWhiteCpOverride,
        postWhiteMateOverride,
      );

      engine.applyMove(move);
      client.move(uci);
      preCandidatesRef.current = [];

      const fenAfter = engine.fen();
      setHistory((h) => [
        ...h,
        {
          ply: h.length + 1,
          uci,
          san,
          fenBefore,
          fenAfter,
          from: fromSq,
          to: toSq,
          analysis,
        },
      ]);
      setViewPly(null);
      setFen(fenAfter);
      setLastMove({ from: fromSq, to: toSq });
      setSelected(null);
      setPromotion(null);
      setEngineInfo((prev) => ({ ...prev, thinking: false }));
      setPvArrow(null);

      // Broadcast move if in Online PvP
      if (
        broadcastToRoom &&
        configRef.current.mode === 'pvp' &&
        configRef.current.pvpSubMode === 'online' &&
        mpSessionRef.current
      ) {
        mpSessionRef.current.sendMove(uci);
      }

      const end = engine.gameEnd();
      setGameEnd(end);
      if (end !== null) {
        updateCompetitiveElo(end);
      }

      if (configRef.current.soundOn) {
        if (end !== null || san.includes('#')) playSound('end');
        else if (engine.inCheck()) playSound('check');
        else if (san.includes('x')) playSound('capture');
        else playSound('move');
      }
      if (
        (configRef.current.mode === 'eve' ||
          (configRef.current.mode === 'pvp' && configRef.current.pvpSubMode === 'local')) &&
        configRef.current.autoFlip
      ) {
        setOrientation(sideOf(engine.stm));
      }
      scheduleNextRef.current();
    },
    [ensureInit, updateCompetitiveElo],
  );

  // --- background 3-line Multi-PV evaluation for human / learn / analysis --

  const runPositionAnalysis = useCallback(
    (movetimeMs = 480, targetFen?: string) => {
      // Post-game full review owns the worker while running; skip interleaved evals.
      if (reviewRunningRef.current) return;
      const { client } = ensureInit();
      const token = tokenRef.current;
      if (targetFen !== undefined) {
        client.reset(targetFen);
      }
      client
        .search({ movetime: movetimeMs, variant: 'v3', multiPv: 3, intent: 'eval' }, (info) => {
          if (token !== tokenRef.current) return;
          if (info.multiPv && info.multiPv.length > 0 && targetFen === undefined) {
            preCandidatesRef.current = info.multiPv;
          }
          applyMoveInfo(info, true);
        })
        .then((result) => {
          if (token !== tokenRef.current) return;
          if (result.multiPv && result.multiPv.length > 0 && targetFen === undefined) {
            preCandidatesRef.current = result.multiPv;
          }
          applyMoveInfo(result, false);
          if (targetFen !== undefined && engineRef.current) {
            client.reset(engineRef.current.fen());
          }
        });
    },
    [applyMoveInfo, ensureInit],
  );

  const scheduleNext = useCallback(() => {
    scheduleNextRef.current();
  }, []);

  scheduleNextRef.current = () => {
    const { engine } = ensureInit();
    if (engine.gameEnd() !== null) {
      setThinkingSide(null);
      return;
    }
    const cfg = configRef.current;
    if (cfg.mode === 'puzzle' || cfg.mode === 'academy') {
      setThinkingSide(null);
      return;
    }

    const stm = sideOf(engine.stm);

    let engineLevel: Level | null = null;
    if (cfg.mode === 'hve') {
      if (stm !== cfg.playerSide) engineLevel = cfg.levels[stm];
    } else if (cfg.mode === 'eve' && cfg.eveRunning) {
      engineLevel = cfg.levels[stm];
    }

    if (engineLevel === null) {
      setThinkingSide(null);
      // In Learn mode, Free Analysis, or Local PvP, compute 3-line suggestions for the player
      if (cfg.mode === 'analysis' || (cfg.mode === 'hve' && cfg.botPlayStyle === 'learn')) {
        runPositionAnalysis(cfg.mode === 'analysis' ? 1100 : 520);
      } else {
        // Still run a fast silent background eval so post-game move classifications are accurate
        runPositionAnalysis(260);
      }
      return;
    }

    const token = tokenRef.current;
    const client = clientRef.current!;

    if (engineLevel === 'random') {
      setThinkingSide(stm);
      window.setTimeout(() => {
        if (token !== tokenRef.current) return;
        const moves = engine.legalMoves();
        if (moves.length === 0) return;
        const move = moves[Math.floor(Math.random() * moves.length)];
        setThinkingSide(null);
        applyMoveInternal(move);
      }, 400);
      return;
    }

    setThinkingSide(stm);
    const started = performance.now();
    client
      .search({ ...LEVEL_LIMITS[engineLevel], multiPv: 3 }, (info) => {
        if (token !== tokenRef.current) return;
        if (info.intent !== 'eval') applyMoveInfo(info, true);
      })
      .then((result) => {
        if (token !== tokenRef.current) return;
        applyMoveInfo(result, false);
        const minDelay =
          engineLevel === 'full' || engineLevel === 'v2' || engineLevel === 'v3' ? 0 : 320;
        const wait = Math.max(0, minDelay - (performance.now() - started));
        window.setTimeout(() => {
          if (token !== tokenRef.current) return;
          setThinkingSide(null);
          if (result.uci) {
            const move = engineRef.current!.uciToMove(result.uci);
            if (move !== null) applyMoveInternal(move, result);
          }
        }, wait);
      });
  };

  // --- public game actions -------------------------------------------------

  const newGame = useCallback(
    (opts?: {
      mode?: Mode;
      side?: Side;
      startFen?: string;
      botPlayStyle?: BotPlayStyle;
      pvpSubMode?: PvpSubMode;
    }) => {
      const { engine, client } = ensureInit();
      const targetFen = opts?.startFen ?? START_FEN;
      tokenRef.current++;
      engine.reset(targetFen);
      client.reset(targetFen);
      preCandidatesRef.current = [];
      setGameId((g) => g + 1);
      setLastEloDelta(null);
      setCustomResultBanner(null);

      const nextMode = opts?.mode ?? configRef.current.mode;
      const nextSide = opts?.side ?? configRef.current.playerSide;
      const nextStyle = opts?.botPlayStyle ?? configRef.current.botPlayStyle;
      const nextPvpSub = opts?.pvpSubMode ?? configRef.current.pvpSubMode;

      setMode(nextMode);
      setPlayerSide(nextSide);
      setBotPlayStyle(nextStyle);
      setPvpSubMode(nextPvpSub);

      configRef.current = {
        ...configRef.current,
        mode: nextMode,
        playerSide: nextSide,
        botPlayStyle: nextStyle,
        pvpSubMode: nextPvpSub,
      };

      setInitialFen(targetFen);
      setHistory([]);
      setViewPly(null);
      setFen(engine.fen());
      setGameEnd(engine.gameEnd());
      setLastMove(null);
      setSelected(null);
      setPromotion(null);
      setThinkingSide(null);
      setEngineInfo(EMPTY_INFO);
      setEvalPov({ cp: evalV3WhitePov(engine.pos) });
      setPvArrow(null);
      setOrientation(nextMode === 'eve' && configRef.current.autoFlip ? 'white' : nextSide);
      const eveStart = nextMode === 'eve';
      setEveRunning(eveStart);
      configRef.current = { ...configRef.current, eveRunning: eveStart };

      window.setTimeout(() => scheduleNext(), 60);
    },
    [ensureInit, scheduleNext],
  );

  // --- Multiplayer Invite Link Orchestration -------------------------------

  const syncBoardFromRoom = useCallback(
    (snap: MultiplayerRoomSnapshot) => {
      const { engine, client } = ensureInit();
      const mySide = mpSessionRef.current?.myAssignedSide() ?? 'white';
      setPlayerSide(mySide);
      setOrientation(mySide);
      configRef.current = { ...configRef.current, playerSide: mySide };

      // Replay room moves if they differ from our current live history
      engine.reset(snap.startFen || START_FEN);
      client.reset(snap.startFen || START_FEN);
      const newHist: HistoryEntry[] = [];
      let lastFromTo: { from: string; to: string } | null = null;

      for (let i = 0; i < snap.movesUci.length; i++) {
        const uciStr = snap.movesUci[i];
        const fenBefore = engine.fen();
        const posBefore = engine.pos.clone();
        const move = engine.uciToMove(uciStr);
        if (move === null) break;
        const san = engine.sanFor(move);
        const uci = moveToUci(move);
        const from = squareName(moveFrom(move));
        const to = squareName(moveTo(move));
        const analysis = analyzeMoveExecution(posBefore, move);
        engine.applyMove(move);
        client.move(uci);
        const fenAfter = engine.fen();
        newHist.push({
          ply: i + 1,
          uci,
          san,
          fenBefore,
          fenAfter,
          from,
          to,
          analysis,
        });
        lastFromTo = { from, to };
      }

      setInitialFen(snap.startFen || START_FEN);
      setHistory(newHist);
      setViewPly(null);
      setFen(engine.fen());
      setLastMove(lastFromTo);
      setSelected(null);
      setPromotion(null);
      setEvalPov({ cp: evalV3WhitePov(engine.pos) });

      const end = engine.gameEnd();
      setGameEnd(end);

      if (snap.resignedBy) {
        const winner = snap.resignedBy === 'white' ? 'Black' : 'White';
        setCustomResultBanner({
          title: `${winner} wins`,
          detail: `by resignation (${snap.resignedBy} resigned)`,
        });
      } else if (snap.drawAgreed) {
        setCustomResultBanner({
          title: 'Draw',
          detail: 'by mutual agreement',
        });
      } else {
        setCustomResultBanner(null);
      }
    },
    [ensureInit],
  );

  const createInviteRoom = useCallback(
    (preferredSide: Side | 'random' = 'white', customName?: string) => {
      if (mpSessionRef.current) {
        mpSessionRef.current.destroy();
        mpSessionRef.current = null;
      }
      const chosenSide: Side =
        preferredSide === 'random'
          ? Math.random() < 0.5
            ? 'white'
            : 'black'
          : preferredSide;
      const code = generateRoomCode();
      const pid = getOrCreatePlayerId();
      const nameToUse = (customName ?? playerName).trim() || 'Grandmaster';
      setPlayerName(nameToUse);

      newGame({ mode: 'pvp', pvpSubMode: 'online', side: chosenSide });

      // Update URL query param without reloading
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('room', code);
        window.history.replaceState({}, '', url.toString());
      } catch {}

      const session = new MultiplayerSession({
        roomId: code,
        playerId: pid,
        playerName: nameToUse,
        isHost: true,
        preferredSide: chosenSide,
        onState: (snap) => {
          setRoomState({ ...snap });
          syncBoardFromRoom(snap);
        },
      });
      mpSessionRef.current = session;
      setRoomState(session.getSnapshot());
      return code;
    },
    [newGame, playerName, syncBoardFromRoom],
  );

  const joinInviteRoom = useCallback(
    (roomCodeInput: string, customName?: string) => {
      const cleaned = roomCodeInput.trim().toUpperCase();
      if (!cleaned) return;
      if (mpSessionRef.current) {
        mpSessionRef.current.destroy();
        mpSessionRef.current = null;
      }
      const pid = getOrCreatePlayerId();
      const nameToUse = (customName ?? playerName).trim() || 'Challenger';
      setPlayerName(nameToUse);

      newGame({ mode: 'pvp', pvpSubMode: 'online', side: 'black' });

      try {
        const url = new URL(window.location.href);
        url.searchParams.set('room', cleaned);
        window.history.replaceState({}, '', url.toString());
      } catch {}

      const session = new MultiplayerSession({
        roomId: cleaned,
        playerId: pid,
        playerName: nameToUse,
        isHost: false,
        onState: (snap) => {
          setRoomState({ ...snap });
          syncBoardFromRoom(snap);
        },
      });
      mpSessionRef.current = session;
      setRoomState(session.getSnapshot());
    },
    [newGame, playerName, syncBoardFromRoom],
  );

  const leaveInviteRoom = useCallback(() => {
    if (mpSessionRef.current) {
      mpSessionRef.current.destroy();
      mpSessionRef.current = null;
    }
    setRoomState(null);
    setCustomResultBanner(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.replaceState({}, '', url.toString());
    } catch {}
  }, []);

  const resignMatch = useCallback(() => {
    if (mode === 'pvp' && pvpSubMode === 'online' && mpSessionRef.current) {
      mpSessionRef.current.sendResign(playerSide);
      return;
    }
    if (mode === 'hve') {
      const winner = playerSide === 'white' ? 'Black' : 'White';
      setCustomResultBanner({
        title: `${winner} wins`,
        detail: 'by resignation',
      });
      updateCompetitiveElo('resign');
    }
  }, [mode, playerSide, pvpSubMode, updateCompetitiveElo]);

  const agreeDraw = useCallback(() => {
    if (mode === 'pvp' && pvpSubMode === 'online' && mpSessionRef.current) {
      mpSessionRef.current.sendDrawAgree();
    }
  }, [mode, pvpSubMode]);

  const requestRematch = useCallback(() => {
    if (mode === 'pvp' && pvpSubMode === 'online' && mpSessionRef.current) {
      mpSessionRef.current.sendRematch();
      return;
    }
    newGame();
  }, [mode, newGame, pvpSubMode]);

  const sendRoomChat = useCallback((text: string) => {
    mpSessionRef.current?.sendChat(text);
  }, []);

  // --- Interactive Puzzle Trainer Actions ----------------------------------

  const activePuzzle: ChessPuzzle = useMemo(
    () => PUZZLE_LIBRARY[activePuzzleIndex % PUZZLE_LIBRARY.length],
    [activePuzzleIndex],
  );

  const startPuzzle = useCallback(
    (indexOrPuzzle?: number | ChessPuzzle) => {
      const { engine, client } = ensureInit();
      tokenRef.current++;

      let targetIdx = activePuzzleIndex;
      if (typeof indexOrPuzzle === 'number') {
        targetIdx = indexOrPuzzle % PUZZLE_LIBRARY.length;
        setActivePuzzleIndex(targetIdx);
      } else if (indexOrPuzzle) {
        const found = PUZZLE_LIBRARY.findIndex((p) => p.id === indexOrPuzzle.id);
        targetIdx = found >= 0 ? found : 0;
        setActivePuzzleIndex(targetIdx);
      }
      const puz = PUZZLE_LIBRARY[targetIdx];

      setMode('puzzle');
      configRef.current = { ...configRef.current, mode: 'puzzle', eveRunning: false };
      setEveRunning(false);
      setThinkingSide(null);
      setCustomResultBanner(null);

      engine.reset(puz.initialFen);
      client.reset(puz.initialFen);

      let lastFromTo: { from: string; to: string } | null = null;
      if (puz.setupMoveUci) {
        const setupMove = engine.uciToMove(puz.setupMoveUci);
        if (setupMove !== null) {
          lastFromTo = {
            from: squareName(moveFrom(setupMove)),
            to: squareName(moveTo(setupMove)),
          };
          engine.applyMove(setupMove);
          client.move(puz.setupMoveUci);
        }
      }

      setInitialFen(engine.fen());
      setFen(engine.fen());
      setHistory([]);
      setViewPly(null);
      setGameEnd(null);
      setLastMove(lastFromTo);
      setSelected(null);
      setPromotion(null);
      setOrientation(puz.sideToSolve);
      setPlayerSide(puz.sideToSolve);
      setPuzzleStepIndex(0);
      setPuzzleStatus('solving');
      setPuzzleHintLevel(0);
      setPuzzleHintSquare(null);
      setPvArrow(null);
      setEngineInfo(EMPTY_INFO);
      setEvalPov({ cp: evalV3WhitePov(engine.pos) });
      setGameId((g) => g + 1);
    },
    [activePuzzleIndex, ensureInit],
  );

  const nextPuzzle = useCallback(() => {
    const nextIdx = (activePuzzleIndex + 1) % PUZZLE_LIBRARY.length;
    startPuzzle(nextIdx);
  }, [activePuzzleIndex, startPuzzle]);

  const retryPuzzle = useCallback(() => {
    startPuzzle(activePuzzleIndex);
  }, [activePuzzleIndex, startPuzzle]);

  const revealPuzzleSolution = useCallback(
    (forceArrow = false) => {
      const puz = PUZZLE_LIBRARY[activePuzzleIndex % PUZZLE_LIBRARY.length];
      const nextExpectedUci = puz.solutionUci[puzzleStepIndex];
      if (!nextExpectedUci) return;
      const fromSq = nextExpectedUci.slice(0, 2);
      const toSq = nextExpectedUci.slice(2, 4);

      if (puzzleHintLevel === 0 && !forceArrow) {
        // Stage 1: Give verbal hint + highlight the piece to move on the board (no arrow spoiler yet)
        setPuzzleHintLevel(1);
        setPuzzleHintSquare(fromSq);
        setPvArrow(null);
      } else {
        // Stage 2: Draw full solution arrow on the board
        setPuzzleHintLevel(2);
        setPuzzleHintSquare(fromSq);
        setPvArrow([fromSq, toSq]);
      }
    },
    [activePuzzleIndex, puzzleHintLevel, puzzleStepIndex],
  );

  // --- Interactive Chess Academy Actions -----------------------------------

  const activeModule: AcademyModule = useMemo(
    () => ACADEMY_MODULES.find((m) => m.id === activeModuleId) ?? ACADEMY_MODULES[0],
    [activeModuleId],
  );

  const startAcademyLesson = useCallback(
    (moduleId: string, stepIdx = 0) => {
      const { engine, client } = ensureInit();
      tokenRef.current++;
      const mod = ACADEMY_MODULES.find((m) => m.id === activeModuleId || m.id === moduleId);
      const resolvedMod = ACADEMY_MODULES.find((m) => m.id === moduleId) ?? mod ?? ACADEMY_MODULES[0];
      const clampedStep = Math.max(0, Math.min(stepIdx, resolvedMod.steps.length - 1));
      const step = resolvedMod.steps[clampedStep];

      setActiveModuleId(resolvedMod.id);
      setActiveStepIndex(clampedStep);
      setLessonStatus('prompt');
      setAcademyShowHint(false);
      setMode('academy');
      setEveRunning(false);
      setThinkingSide(null);
      setCustomResultBanner(null);
      configRef.current = { ...configRef.current, mode: 'academy', eveRunning: false };

      engine.reset(step.fen);
      client.reset(step.fen);
      const stm = sideOf(engine.stm);

      setInitialFen(step.fen);
      setFen(step.fen);
      setHistory([]);
      setViewPly(null);
      setGameEnd(null);
      setLastMove(null);
      setSelected(null);
      setPromotion(null);
      setOrientation(stm);
      setPlayerSide(stm);
      setPvArrow(null);
      setEngineInfo(EMPTY_INFO);
      setEvalPov({ cp: evalV3WhitePov(engine.pos) });
      setGameId((g) => g + 1);
    },
    [activeModuleId, ensureInit],
  );

  const revealAcademyHint = useCallback(
    (uciOverride?: string) => {
      const step = activeModule.steps[activeStepIndex];
      const uci = uciOverride || step?.correctUci[0];
      setAcademyShowHint(true);
      if (uci && uci.length >= 4) {
        setPvArrow([uci.slice(0, 2), uci.slice(2, 4)]);
      }
    },
    [activeModule.steps, activeStepIndex],
  );

  // --- Mode & Settings Switchers -------------------------------------------

  const switchMode = useCallback(
    (m: Mode) => {
      if (m === configRef.current.mode) return;
      if (m === 'puzzle') {
        startPuzzle(activePuzzleIndex);
        return;
      }
      if (m === 'academy') {
        startAcademyLesson(activeModuleId, activeStepIndex);
        return;
      }
      if (m === 'analysis') {
        tokenRef.current++;
        setMode('analysis');
        setEveRunning(false);
        setThinkingSide(null);
        configRef.current = { ...configRef.current, mode: 'analysis', eveRunning: false };
        runPositionAnalysis(1200);
        return;
      }
      if (m === 'pvp') {
        newGame({ mode: 'pvp', pvpSubMode: configRef.current.pvpSubMode });
        return;
      }
      newGame({ mode: m });
    },
    [
      activeModuleId,
      activePuzzleIndex,
      activeStepIndex,
      newGame,
      runPositionAnalysis,
      startAcademyLesson,
      startPuzzle,
    ],
  );

  const chooseSide = useCallback(
    (side: Side | 'random') => {
      const s: Side = side === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : side;
      newGame({ side: s });
    },
    [newGame],
  );

  const setEngineLevel = useCallback((side: Side, level: Level) => {
    setLevels((l) => {
      const next = { ...l, [side]: level };
      configRef.current = { ...configRef.current, levels: next };
      return next;
    });
  }, []);

  const toggleEve = useCallback(() => {
    const running = !configRef.current.eveRunning;
    setEveRunning(running);
    configRef.current = { ...configRef.current, eveRunning: running };
    if (running) scheduleNext();
    else {
      tokenRef.current++;
      setThinkingSide(null);
    }
  }, [scheduleNext]);

  const takeback = useCallback(() => {
    // Disallow takebacks during active Competitive mode or Online PvP
    if (isAssistanceHidden) return;
    const engine = engineRef.current;
    const client = clientRef.current;
    if (engine === null || client === null || engine.ply === 0) return;
    tokenRef.current++;

    const human = colorOf(configRef.current.playerSide);
    const plies = configRef.current.mode === 'hve' ? (engine.stm === human ? 2 : 1) : 1;
    const n = Math.min(plies, engine.ply);
    engine.undo(n);
    client.undo(n);
    const hist = history.slice(0, history.length - n);
    setHistory(hist);
    setViewPly(null);
    setFen(engine.fen());
    setGameEnd(null);
    setCustomResultBanner(null);
    setLastMove(
      hist.length > 0
        ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to }
        : null,
    );
    setSelected(null);
    setPromotion(null);
    setThinkingSide(null);
    setEngineInfo(EMPTY_INFO);
    setPvArrow(null);
    scheduleNext();
  }, [history, isAssistanceHidden, scheduleNext]);

  const flipBoard = useCallback(() => {
    setOrientation((o) => (o === 'white' ? 'black' : 'white'));
  }, []);

  const loadFen = useCallback(
    (fenStr: string): string | null => {
      const { engine } = ensureInit();
      const trimmed = fenStr.trim();
      try {
        const testPos = newStartPosition();
        parseFen(testPos, trimmed);
      } catch (err) {
        return err instanceof Error ? err.message : 'Invalid FEN';
      }
      newGame({ startFen: trimmed, mode: configRef.current.mode });
      void engine;
      return null;
    },
    [ensureInit, newGame],
  );

  const loadOpeningLine = useCallback(
    (uciMovesStr: string) => {
      const { engine, client } = ensureInit();
      tokenRef.current++;
      engine.reset(START_FEN);
      client.reset(START_FEN);
      preCandidatesRef.current = [];
      setGameId((g) => g + 1);
      setCustomResultBanner(null);

      const ucis = uciMovesStr.trim().split(/\s+/).filter(Boolean);
      const newHist: HistoryEntry[] = [];
      let lastFromTo: { from: string; to: string } | null = null;

      for (let i = 0; i < ucis.length; i++) {
        const fenBefore = engine.fen();
        const posBefore = engine.pos.clone();
        const move = engine.uciToMove(ucis[i]);
        if (move === null) break;
        const san = engine.sanFor(move);
        const uci = moveToUci(move);
        const from = squareName(moveFrom(move));
        const to = squareName(moveTo(move));
        const analysis = analyzeMoveExecution(posBefore, move);
        engine.applyMove(move);
        client.move(uci);
        const fenAfter = engine.fen();
        newHist.push({
          ply: i + 1,
          uci,
          san,
          fenBefore,
          fenAfter,
          from,
          to,
          analysis,
        });
        lastFromTo = { from, to };
      }

      setInitialFen(START_FEN);
      setHistory(newHist);
      setViewPly(null);
      setFen(engine.fen());
      setGameEnd(engine.gameEnd());
      setLastMove(lastFromTo);
      setSelected(null);
      setPromotion(null);
      setThinkingSide(null);
      setEvalPov({ cp: evalV3WhitePov(engine.pos) });
      setPvArrow(null);
      if (configRef.current.soundOn) playSound('move');
      window.setTimeout(() => scheduleNext(), 60);
    },
    [ensureInit, scheduleNext],
  );

  const setAutoFlipAndApply = useCallback((on: boolean) => {
    setAutoFlip(on);
    configRef.current = { ...configRef.current, autoFlip: on };
  }, []);

  // --- Post-game full engine review ------------------------------------------
  // One search per position (v3, MultiPV). Result j doubles as the "after" eval
  // for move j-1 (mate-aware, replacing the static-eval fallback) and the
  // "before" candidates for move j, so classifications and accuracy are
  // computed from real searches — chess.com-style review.

  const REVIEW_MOVETIME_MS = 400;

  const runFullReview = useCallback(async () => {
    if (reviewRunningRef.current || history.length === 0) return;
    const { client } = ensureInit();
    const token = tokenRef.current;
    reviewRunningRef.current = true;
    setEngineReview({ done: 0, total: history.length + 1 });

    try {
      const results: EngineBestMove[] = [];
      const fens = history.map((h) => h.fenBefore);
      fens.push(history[history.length - 1].fenAfter);

      for (let j = 0; j < fens.length; j++) {
        if (token !== tokenRef.current) return;
        client.reset(fens[j]);
        const res = await client.search(
          { movetime: REVIEW_MOVETIME_MS, variant: 'v3', multiPv: 3, intent: 'eval' },
          () => {},
        );
        if (token !== tokenRef.current) return;
        results.push(res);
        setEngineReview({ done: j + 1, total: fens.length });

        if (j > 0) {
          const idx = j - 1;
          const entry = history[idx];
          const pre = results[j - 1].multiPv ?? [];
          const post = results[j];
          // scoreMate encoding collapses to 0 for an already-mated position;
          // normalize to "mated now" (±1) from White's POV.
          const postMate =
            post.scoreMate !== undefined
              ? post.scoreMate === 0
                ? post.stm === 0
                  ? -1
                  : 1
                : post.stm === 0
                  ? post.scoreMate
                  : -post.scoreMate
              : undefined;
          const postCp =
            postMate === undefined && post.scoreCp !== undefined
              ? post.stm === 0
                ? post.scoreCp
                : -post.scoreCp
              : undefined;
          const eng = new Engine();
          eng.reset(entry.fenBefore);
          const move = eng.uciToMove(entry.uci);
          if (move !== null) {
            const analysis = analyzeMoveExecution(eng.pos, move, pre, postCp, postMate);
            setHistory((h) => h.map((e, i) => (i === idx ? { ...e, analysis } : e)));
          }
        }
      }
      if (token === tokenRef.current) setReviewedGameId(gameId);
    } finally {
      reviewRunningRef.current = false;
      setEngineReview(null);
    }
  }, [ensureInit, gameId, history]);

  // Auto-review as soon as a match ends (any mode except puzzles/academy drills).
  useEffect(() => {
    if (gameEnd === null && customResultBanner === null) return;
    if (history.length === 0) return;
    if (mode === 'puzzle' || mode === 'academy') return;
    if (reviewedGameId === gameId) return;
    void runFullReview();
  }, [customResultBanner, gameEnd, gameId, history.length, mode, reviewedGameId, runFullReview]);

  // --- History Scrubbing & Deep Analysis -----------------------------------

  const activePly =
    viewPly === null ? history.length : Math.max(0, Math.min(viewPly, history.length));
  const isViewingHistory = viewPly !== null && viewPly < history.length;

  const displayedFen = useMemo(() => {
    if (activePly === 0) return initialFen;
    return history[activePly - 1]?.fenAfter ?? fen;
  }, [activePly, fen, history, initialFen]);

  const displayedLastMove = useMemo(() => {
    if (activePly === 0) return lastMove;
    const entry = history[activePly - 1];
    return entry ? { from: entry.from, to: entry.to } : lastMove;
  }, [activePly, history, lastMove]);

  const displayedMoveEntry = useMemo(() => {
    if (activePly === 0) return null;
    return history[activePly - 1] ?? null;
  }, [activePly, history]);

  const selectPly = useCallback(
    (ply: number | null) => {
      setSelected(null);
      setPromotion(null);
      if (ply === null || ply >= history.length) {
        setViewPly(null);
        if (history.length > 0) {
          const last = history[history.length - 1];
          setEvalPov(
            last.analysis.evalWhiteMate !== undefined
              ? { mate: last.analysis.evalWhiteMate }
              : { cp: last.analysis.evalWhiteCp },
          );
        }
        return;
      }
      const clamped = Math.max(0, ply);
      setViewPly(clamped);
      if (clamped === 0) {
        setEvalPov({ cp: 15 });
      } else {
        const entry = history[clamped - 1];
        if (entry) {
          setEvalPov(
            entry.analysis.evalWhiteMate !== undefined
              ? { mate: entry.analysis.evalWhiteMate }
              : { cp: entry.analysis.evalWhiteCp },
          );
        }
      }
    },
    [history],
  );

  const stepFirst = useCallback(() => selectPly(0), [selectPly]);
  const stepPrev = useCallback(
    () => selectPly(Math.max(0, activePly - 1)),
    [activePly, selectPly],
  );
  const stepNext = useCallback(() => {
    if (activePly + 1 >= history.length) selectPly(null);
    else selectPly(activePly + 1);
  }, [activePly, history.length, selectPly]);
  const stepLast = useCallback(() => selectPly(null), [selectPly]);

  const analyzeDisplayedPosition = useCallback(() => {
    if (isAssistanceHidden) return;
    tokenRef.current++;
    runPositionAnalysis(2000, isViewingHistory ? displayedFen : undefined);
  }, [displayedFen, isAssistanceHidden, isViewingHistory, runPositionAnalysis]);

  // --- Opening Explorer, Coach Suggestions & Summary Derived Data ----------

  const viewedPositionObj = useMemo(() => {
    const p = newStartPosition();
    try {
      parseFen(p, displayedFen);
    } catch {}
    return p;
  }, [displayedFen]);

  const currentOpening = useMemo(() => {
    const ucis = history.slice(0, activePly).map((h) => h.uci);
    return detectOpening(viewedPositionObj, ucis);
  }, [activePly, history, viewedPositionObj]);

  const bookExplorerMoves: BookCandidate[] = useMemo(() => {
    return probeBookV3(viewedPositionObj);
  }, [viewedPositionObj]);

  const gameSummary: GameSummaryStats = useMemo(() => {
    return computeGameSummary(history);
  }, [history]);

  // Build 3-line Coach Suggestions for Learn Mode
  const coachSuggestions: CoachSuggestion[] = useMemo(() => {
    if (isAssistanceHidden || engineInfo.multiPv.length === 0) return [];
    const sign = viewedPositionObj.stm === 0 ? 1 : -1;
    return engineInfo.multiPv.slice(0, 3).map((line) => {
      let scoreText = '0.00';
      if (line.scoreMate !== undefined) {
        const m = line.scoreMate * sign;
        scoreText = `${m > 0 ? '+' : '−'}M${Math.abs(m)}`;
      } else if (line.scoreCp !== undefined) {
        const cp = line.scoreCp * sign;
        scoreText = `${cp > 0 ? '+' : cp < 0 ? '−' : ''}${(Math.abs(cp) / 100).toFixed(2)}`;
      }
      return {
        rank: line.rank,
        uci: line.uci,
        san: line.san,
        scoreText,
        explanation: describeCoachSuggestion(viewedPositionObj, line),
        pvSan: line.pvSan,
      };
    });
  }, [engineInfo.multiPv, isAssistanceHidden, viewedPositionObj]);

  // --- Board Turn & Move Execution (including Puzzle & Academy validation) --

  const stmSide: Side = sideOf(colorOfFromFen(displayedFen));

  const isHumanTurn = useMemo(() => {
    if (isViewingHistory || gameEnd !== null || customResultBanner !== null || thinkingSide !== null) {
      return false;
    }
    if (mode === 'analysis') return true;
    if (mode === 'hve') return stmSide === playerSide;
    if (mode === 'pvp') {
      if (pvpSubMode === 'local') return true;
      return stmSide === playerSide;
    }
    if (mode === 'puzzle') {
      return (
        (puzzleStatus === 'solving' || puzzleStatus === 'correct_step') &&
        stmSide === activePuzzle.sideToSolve
      );
    }
    if (mode === 'academy') {
      return lessonStatus !== 'completed';
    }
    return false;
  }, [
    activePuzzle.sideToSolve,
    customResultBanner,
    gameEnd,
    isViewingHistory,
    lessonStatus,
    mode,
    playerSide,
    puzzleStatus,
    pvpSubMode,
    stmSide,
    thinkingSide,
  ]);

  const legalTargetsFor = useCallback(
    (square: string): number[] => {
      if (isViewingHistory) return [];
      const engine = engineRef.current;
      if (engine === null) return [];
      const sq = parseSquare(square);
      const moves = engine.legalMoves();
      const out: number[] = [];
      for (let i = 0; i < moves.length; i++) {
        if (moveFrom(moves[i]) === sq) out.push(moves[i]);
      }
      return out;
    },
    [isViewingHistory],
  );

  // Handle a move attempted in Puzzle or Academy mode, or normal game mode
  const handlePlayerMoveExecution = useCallback(
    (move: number) => {
      const { engine } = ensureInit();
      const uci = moveToUci(move);

      // 1. Puzzle Mode Validation
      if (configRef.current.mode === 'puzzle') {
        const expectedUci = activePuzzle.solutionUci[puzzleStepIndex];
        // Also check if the player's move delivers immediate checkmate (alternative mate in 1)
        const testClone = engine.pos.clone();
        const san = engine.sanFor(move);
        const isImmediateMate = san.endsWith('#');
        void testClone;

        if (uci === expectedUci || isImmediateMate) {
          applyMoveInternal(move, undefined, false);
          const nextStep = puzzleStepIndex + 1;

          if (nextStep >= activePuzzle.solutionUci.length || isImmediateMate) {
            setPuzzleStatus('solved');
            setPuzzleStreak((s) => {
              const nextS = s + 1;
              try {
                localStorage.setItem('chess0-puzzle-streak', String(nextS));
              } catch {}
              return nextS;
            });
            setPuzzleRating((r) => {
              const nextR = r + (puzzleShowHint ? 6 : 16);
              try {
                localStorage.setItem('chess0-puzzle-rating', String(nextR));
              } catch {}
              return nextR;
            });
            setSolvedPuzzleIds((ids) => {
              if (ids.includes(activePuzzle.id)) return ids;
              const nextIds = [...ids, activePuzzle.id];
              try {
                localStorage.setItem('chess0-solved-puzzles', JSON.stringify(nextIds));
              } catch {}
              return nextIds;
            });
          } else {
            // Play opponent's forced reply after 320ms
            setPuzzleStatus('correct_step');
            setPuzzleHintLevel(0);
            setPuzzleHintSquare(null);
            setPvArrow(null);
            const replyUci = activePuzzle.solutionUci[nextStep];
            window.setTimeout(() => {
              const replyMove = engineRef.current?.uciToMove(replyUci) ?? null;
              if (replyMove !== null) {
                applyMoveInternal(replyMove, undefined, false);
                setPuzzleStepIndex(nextStep + 1);
                setPuzzleStatus('solving');
              }
            }, 340);
          }
        } else {
          // Wrong puzzle move!
          if (configRef.current.soundOn) playSound('check');
          setPuzzleStatus('failed');
          setPuzzleStreak(0);
          try {
            localStorage.setItem('chess0-puzzle-streak', '0');
          } catch {}
          setPuzzleRating((r) => {
            const nextR = Math.max(400, r - 12);
            try {
              localStorage.setItem('chess0-puzzle-rating', String(nextR));
            } catch {}
            return nextR;
          });
        }
        return;
      }

      // 2. Academy Mode Validation
      if (configRef.current.mode === 'academy') {
        const step = activeModule.steps[activeStepIndex];
        if (step && step.correctUci.includes(uci)) {
          applyMoveInternal(move, undefined, false);
          setLessonStatus('completed');
          const key = `${activeModule.id}:${activeStepIndex}`;
          setCompletedLessons((prev) => {
            if (prev.includes(key)) return prev;
            const next = [...prev, key];
            try {
              localStorage.setItem('chess0-completed-lessons', JSON.stringify(next));
            } catch {}
            return next;
          });
        } else {
          if (configRef.current.soundOn) playSound('check');
          setLessonStatus('wrong');
        }
        return;
      }

      // 3. Standard Match / Analysis Move
      tokenRef.current++;
      applyMoveInternal(move);
    },
    [
      activeModule,
      activePuzzle,
      activeStepIndex,
      applyMoveInternal,
      ensureInit,
      puzzleShowHint,
      puzzleStepIndex,
    ],
  );

  const playUciMove = useCallback(
    (uci: string): boolean => {
      if (isViewingHistory) {
        setViewPly(null);
      }
      const engine = engineRef.current;
      if (!engine || thinkingSide !== null || engine.gameEnd() !== null) return false;
      const move = engine.uciToMove(uci);
      if (move === null) return false;
      handlePlayerMoveExecution(move);
      return true;
    },
    [handlePlayerMoveExecution, isViewingHistory, thinkingSide],
  );

  const tryMove = useCallback(
    (move: number) => {
      if (movePromo(move) !== 0) {
        setPromotion({ from: squareName(moveFrom(move)), to: squareName(moveTo(move)) });
        return;
      }
      handlePlayerMoveExecution(move);
    },
    [handlePlayerMoveExecution],
  );

  const onSquareClick = useCallback(
    (square: string) => {
      if (!isHumanTurn || promotion !== null) {
        setSelected(null);
        return;
      }
      const engine = engineRef.current!;
      const sq = parseSquare(square);
      if (selected !== null) {
        const from = parseSquare(selected);
        const candidate = legalTargetsFor(selected).find(
          (m) => moveTo(m) === sq && moveFrom(m) === from,
        );
        if (candidate !== undefined) {
          tryMove(candidate);
          return;
        }
      }
      const piece = engine.pos.board[sq];
      const own = engine.stm === 0 ? piece > 0 : piece < 0;
      setSelected(own ? square : null);
    },
    [isHumanTurn, legalTargetsFor, promotion, selected, tryMove],
  );

  const onPieceDrop = useCallback(
    (from: string, to: string): boolean => {
      if (!isHumanTurn || promotion !== null) return false;
      if (from === to) return false;
      const fromSq = parseSquare(from);
      const toSq = parseSquare(to);
      const candidates = legalTargetsFor(from).filter(
        (m) => moveTo(m) === toSq && moveFrom(m) === fromSq,
      );
      if (candidates.length === 0) return false;
      const promoting = candidates.some((m) => movePromo(m) !== 0);
      if (promoting) {
        setPromotion({ from, to });
        return false;
      }
      handlePlayerMoveExecution(candidates[0]);
      return true;
    },
    [handlePlayerMoveExecution, isHumanTurn, legalTargetsFor, promotion],
  );

  const choosePromotion = useCallback(
    (pieceType: number) => {
      if (promotion === null) return;
      const engine = engineRef.current!;
      const letters = ['', '', 'n', 'b', 'r', 'q'];
      const move = engine.uciToMove(promotion.from + promotion.to + letters[pieceType]);
      setPromotion(null);
      if (move !== null) {
        handlePlayerMoveExecution(move);
      }
    },
    [handlePlayerMoveExecution, promotion],
  );

  // Keyboard navigation for move scrubbing (Left / Right arrows)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stepNext, stepPrev]);

  // Initial startup & URL `?room=` auto-join detection
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const { client } = ensureInit();

    let urlRoom: string | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      urlRoom = params.get('room');
    } catch {}

    void client.waitReady().then(() => {
      if (urlRoom && urlRoom.trim().length > 0) {
        joinInviteRoom(urlRoom.trim());
      } else {
        scheduleNext();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    // state
    mode,
    botPlayStyle,
    pvpSubMode,
    playerSide,
    levels,
    eveRunning,
    autoFlip,
    compElo,
    lastEloDelta,
    isAssistanceHidden,
    coachSuggestions,
    playerName,
    roomState,
    activePuzzle,
    activePuzzleIndex,
    puzzleStepIndex,
    puzzleStatus,
    puzzleShowHint,
    puzzleHintLevel,
    puzzleHintSquare,
    puzzleRating,
    puzzleStreak,
    solvedPuzzleIds,
    activeModule,
    activeStepIndex,
    lessonStatus,
    academyShowHint,
    completedLessons,
    fen: displayedFen,
    liveFen: fen,
    history,
    activePly,
    isViewingHistory,
    displayedMoveEntry,
    gameEnd,
    customResultBanner,
    lastMove: displayedLastMove,
    orientation,
    selected,
    promotion,
    thinkingSide,
    engineInfo,
    evalPov,
    pvArrow,
    showMultiPvArrows,
    soundOn,
    theme,
    boardTheme,
    stmSide,
    isHumanTurn,
    gameId,
    engineRef,
    currentOpening,
    bookExplorerMoves,
    gameSummary,
    engineReview,
    reviewedGame: reviewedGameId === gameId,
    runFullReview,
    searchThreads,
    setSearchThreads,
    // actions
    newGame,
    switchMode,
    setBotPlayStyle: (style: BotPlayStyle) => newGame({ mode: 'hve', botPlayStyle: style }),
    setPvpSubMode: (sub: PvpSubMode) => newGame({ mode: 'pvp', pvpSubMode: sub }),
    chooseSide,
    setEngineLevel,
    toggleEve,
    setAutoFlipAndApply,
    takeback,
    flipBoard,
    loadFen,
    loadOpeningLine,
    playUciMove,
    selectPly,
    stepFirst,
    stepPrev,
    stepNext,
    stepLast,
    analyzeDisplayedPosition,
    setShowMultiPvArrows,
    setSoundOn,
    setTheme,
    setBoardTheme,
    setPlayerName,
    createInviteRoom,
    joinInviteRoom,
    leaveInviteRoom,
    resignMatch,
    agreeDraw,
    requestRematch,
    sendRoomChat,
    startPuzzle,
    nextPuzzle,
    retryPuzzle,
    revealPuzzleSolution,
    startAcademyLesson,
    revealAcademyHint,
    onSquareClick,
    onPieceDrop,
    choosePromotion,
    legalTargetsFor,
  };
}

function colorOfFromFen(fen: string): 0 | 1 {
  return fen.split(' ')[1] === 'b' ? 1 : 0;
}

export type { SearchInfo };
