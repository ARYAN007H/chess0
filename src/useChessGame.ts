/**
 * useChessGame: all game orchestration for the UI.
 *
 * Holds a main-thread Engine (legal moves, SAN, game state) plus an
 * EngineClient (the worker that runs searches). Every applied move goes
 * through both so the worker's search position stays in sync.
 *
 * A monotonically increasing token invalidates in-flight async results after
 * resets, takebacks and FEN loads.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { EngineClient } from './engineClient';
import type { EngineInfoEvent } from './engineClient';
import { playSound } from './sound';

export type Mode = 'hve' | 'eve';
export type Level = 'random' | 'beginner' | 'intermediate' | 'full' | 'v2';
export type Side = 'white' | 'black';
export type Theme = 'light' | 'dark';

export const LEVEL_LABELS: Record<Level, string> = {
  random: 'Random',
  beginner: 'Beginner (depth 2)',
  intermediate: 'Intermediate (depth 4)',
  full: 'Full strength (1s / move)',
  v2: 'Chess0 v2 — strongest (1s / move)',
};

const LEVEL_LIMITS: Record<Exclude<Level, 'random'>, { depth?: number; movetime?: number; variant?: 'v1' | 'v2' }> = {
  beginner: { depth: 2 },
  intermediate: { depth: 4 },
  full: { movetime: 1000 },
  v2: { movetime: 1000, variant: 'v2' },
};

export interface HistoryEntry {
  uci: string;
  san: string;
  fenAfter: string;
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
}

const EMPTY_INFO: EnginePanelInfo = { thinking: false, depth: 0, seldepth: 0, nodes: 0, nps: 0, timeMs: 0, pvSan: [] };

export interface EvalPov {
  cp?: number;
  mate?: number;
}

const sideOf = (color: 0 | 1): Side => (color === 0 ? 'white' : 'black');
const colorOf = (side: Side): 0 | 1 => (side === 'white' ? 0 : 1);

export function useChessGame() {
  const engineRef = useRef<Engine | null>(null);
  const clientRef = useRef<EngineClient | null>(null);
  const tokenRef = useRef(0);

  const [mode, setMode] = useState<Mode>('hve');
  const [playerSide, setPlayerSide] = useState<Side>('white');
  const [levels, setLevels] = useState<Record<Side, Level>>({ white: 'intermediate', black: 'intermediate' });
  const [eveRunning, setEveRunning] = useState(false);
  const [autoFlip, setAutoFlip] = useState(true);

  const [fen, setFen] = useState(START_FEN);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [gameEnd, setGameEnd] = useState<GameEnd>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [selected, setSelected] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const [thinkingSide, setThinkingSide] = useState<Side | null>(null);
  const [engineInfo, setEngineInfo] = useState<EnginePanelInfo>(EMPTY_INFO);
  const [evalPov, setEvalPov] = useState<EvalPov>({});
  const [pvArrow, setPvArrow] = useState<[string, string] | null>(null);
  const [gameId, setGameId] = useState(0);

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
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  // Mirror the config that async callbacks need, so they never see stale state.
  const configRef = useRef({ mode, playerSide, levels, eveRunning, autoFlip, soundOn });
  configRef.current = { mode, playerSide, levels, eveRunning, autoFlip, soundOn };

  // Apply theme to <html>.
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

  // --- init ---------------------------------------------------------------

  const ensureInit = useCallback(() => {
    if (engineRef.current === null) engineRef.current = new Engine();
    if (clientRef.current === null) clientRef.current = new EngineClient();
    return { engine: engineRef.current, client: clientRef.current };
  }, []);

  // --- eval / info plumbing ----------------------------------------------

  const applyScore = useCallback((info: { stm: 0 | 1 } & { scoreCp?: number; scoreMate?: number }) => {
    // Convert side-to-move POV into white POV for the eval bar.
    if (info.scoreMate !== undefined) {
      const mate = info.stm === 0 ? info.scoreMate : -info.scoreMate;
      setEvalPov({ mate });
    } else if (info.scoreCp !== undefined) {
      const cp = info.stm === 0 ? info.scoreCp : -info.scoreCp;
      setEvalPov({ cp });
    }
  }, []);

  const applyMoveInfo = useCallback(
    (info: EngineInfoEvent) => {
      setEngineInfo({
        thinking: true,
        depth: info.depth,
        seldepth: info.seldepth,
        nodes: info.nodes,
        nps: info.nps,
        timeMs: info.timeMs,
        scoreCp: info.scoreCp,
        scoreMate: info.scoreMate,
        pvSan: info.pvSan,
      });
      applyScore(info);
      if (info.pvUci.length >= 2) {
        setPvArrow([info.pvUci[0].slice(0, 2), info.pvUci[0].slice(2, 4)]);
      }
    },
    [applyScore],
  );

  // --- move application ----------------------------------------------------

  const applyMoveInternal = useCallback(
    (move: number) => {
      const { engine, client } = ensureInit();
      const san = engine.sanFor(move);
      const uci = moveToUci(move);
      engine.applyMove(move);
      client.move(uci);

      const fenAfter = engine.fen();
      setHistory((h) => [...h, { uci, san, fenAfter }]);
      setFen(fenAfter);
      setLastMove({ from: squareName(moveFrom(move)), to: squareName(moveTo(move)) });
      setSelected(null);
      setPromotion(null);
      setEngineInfo(EMPTY_INFO);
      setPvArrow(null);

      const end = engine.gameEnd();
      setGameEnd(end);
      if (configRef.current.soundOn) {
        if (end !== null || san.includes('#')) playSound('end');
        else if (engine.inCheck()) playSound('check');
        else if (san.includes('x')) playSound('capture');
        else playSound('move');
      }
      if (configRef.current.mode === 'eve' && configRef.current.autoFlip) {
        setOrientation(sideOf(engine.stm));
      }
      // Hand the turn over (engine reply, or a background eval for the human).
      scheduleNextRef.current();
    },
    [ensureInit],
  );

  // --- turn scheduling -----------------------------------------------------

  const scheduleNextRef = useRef<() => void>(() => {});

  const runBackgroundEval = useCallback(() => {
    const { client } = ensureInit();
    const token = tokenRef.current;
    client.search({ movetime: 150, intent: 'eval' }, (info) => {
      if (token !== tokenRef.current) return;
      if (info.intent === 'eval') applyScore(info);
    }).then((result) => {
      if (token !== tokenRef.current) return;
      applyScore(result);
    });
  }, [applyScore, ensureInit]);

  const scheduleNext = useCallback(() => {
    scheduleNextRef.current();
  }, []);

  scheduleNextRef.current = () => {
    const { engine } = ensureInit();
    if (engine.gameEnd() !== null) {
      setThinkingSide(null);
      return;
    }
    const stm = sideOf(engine.stm);
    const cfg = configRef.current;

    let engineLevel: Level | null = null;
    if (cfg.mode === 'hve') {
      if (stm !== cfg.playerSide) engineLevel = cfg.levels[stm];
    } else if (cfg.eveRunning) {
      engineLevel = cfg.levels[stm];
    }

    if (engineLevel === null) {
      setThinkingSide(null);
      runBackgroundEval();
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
      }, 500);
      return;
    }

    setThinkingSide(stm);
    const started = performance.now();
    client.search(LEVEL_LIMITS[engineLevel], (info) => {
      if (token !== tokenRef.current) return;
      if (info.intent !== 'eval') applyMoveInfo(info);
    }).then((result) => {
      if (token !== tokenRef.current) return;
      applyScore(result);
      // Keep fast levels feeling deliberate.
      const minDelay = engineLevel === 'full' || engineLevel === 'v2' ? 0 : 400;
      const wait = Math.max(0, minDelay - (performance.now() - started));
      window.setTimeout(() => {
        if (token !== tokenRef.current) return;
        setThinkingSide(null);
        if (result.uci) {
          const move = engineRef.current!.uciToMove(result.uci);
          if (move !== null) applyMoveInternal(move);
        }
      }, wait);
    });
  };

  // --- public actions ------------------------------------------------------

  const newGame = useCallback(
    (opts?: { mode?: Mode; side?: Side }) => {
      const { engine, client } = ensureInit();
      tokenRef.current++;
      engine.reset();
      client.reset();
      setGameId((g) => g + 1);

      if (opts?.mode !== undefined) setMode(opts.mode);
      if (opts?.side !== undefined) setPlayerSide(opts.side);
      const nextMode = opts?.mode ?? configRef.current.mode;
      const nextSide = opts?.side ?? configRef.current.playerSide;
      configRef.current = { ...configRef.current, mode: nextMode, playerSide: nextSide };

      setHistory([]);
      setFen(START_FEN);
      setGameEnd(null);
      setLastMove(null);
      setSelected(null);
      setPromotion(null);
      setThinkingSide(null);
      setEngineInfo(EMPTY_INFO);
      setEvalPov({});
      setPvArrow(null);
      setOrientation(nextMode === 'eve' && configRef.current.autoFlip ? 'white' : nextSide);
      const eveStart = nextMode === 'eve';
      setEveRunning(eveStart);
      configRef.current = { ...configRef.current, eveRunning: eveStart };

      // Give React a tick to paint the fresh board before the engine moves.
      window.setTimeout(() => scheduleNext(), 60);
    },
    [ensureInit],
  );

  const switchMode = useCallback(
    (m: Mode) => {
      if (m === configRef.current.mode) return;
      newGame({ mode: m });
    },
    [newGame],
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
    else tokenRef.current++; // invalidate any in-flight search
  }, [scheduleNext]);

  const takeback = useCallback(() => {
    if (configRef.current.mode !== 'hve') return;
    const engine = engineRef.current;
    const client = clientRef.current;
    if (engine === null || client === null || engine.ply === 0) return;
    tokenRef.current++;

    const human = colorOf(configRef.current.playerSide);
    const plies = engine.stm === human ? 2 : 1;
    const n = Math.min(plies, engine.ply);
    engine.undo(n);
    client.undo(n);
    const hist = history.slice(0, history.length - n);
    setHistory(hist);
    setFen(engine.fen());
    setGameEnd(null);
    setLastMove(
      hist.length > 0
        ? { from: hist[hist.length - 1].uci.slice(0, 2), to: hist[hist.length - 1].uci.slice(2, 4) }
        : null,
    );
    setSelected(null);
    setPromotion(null);
    setThinkingSide(null);
    setEngineInfo(EMPTY_INFO);
    setEvalPov({});
    setPvArrow(null);
    scheduleNext();
  }, [history, scheduleNext]);

  const flipBoard = useCallback(() => {
    setOrientation((o) => (o === 'white' ? 'black' : 'white'));
  }, []);

  const loadFen = useCallback(
    (fen: string): string | null => {
      const { engine, client } = ensureInit();
      try {
        engine.reset(fen.trim());
      } catch (err) {
        return err instanceof Error ? err.message : 'Invalid FEN';
      }
      tokenRef.current++;
      client.reset(fen.trim());
      setGameId((g) => g + 1);
      setHistory([]);
      setFen(engine.fen());
      setGameEnd(engine.gameEnd());
      setLastMove(null);
      setSelected(null);
      setPromotion(null);
      setThinkingSide(null);
      setEngineInfo(EMPTY_INFO);
      setEvalPov({});
      setPvArrow(null);
      setOrientation(configRef.current.mode === 'eve' ? sideOf(engine.stm) : configRef.current.playerSide);
      scheduleNext();
      return null;
    },
    [ensureInit, scheduleNext],
  );

  const setAutoFlipAndApply = useCallback((on: boolean) => {
    setAutoFlip(on);
    configRef.current = { ...configRef.current, autoFlip: on };
  }, []);

  // --- board interaction ---------------------------------------------------

  const stmSide: Side = sideOf(colorOfFromFen(fen));
  const isHumanTurn =
    mode === 'hve' && gameEnd === null && thinkingSide === null && stmSide === playerSide;

  const legalTargetsFor = useCallback(
    (square: string): number[] => {
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
    [],
  );

  const tryMove = useCallback(
    (move: number) => {
      if (movePromo(move) !== 0) {
        setPromotion({ from: squareName(moveFrom(move)), to: squareName(moveTo(move)) });
        return;
      }
      applyMoveInternal(move);
    },
    [applyMoveInternal],
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
        const candidate = legalTargetsFor(selected).find((m) => moveTo(m) === sq && moveFrom(m) === from);
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
      const engine = engineRef.current!;
      const fromSq = parseSquare(from);
      const toSq = parseSquare(to);
      const candidates = legalTargetsFor(from).filter((m) => moveTo(m) === toSq && moveFrom(m) === fromSq);
      if (candidates.length === 0) return false;
      const promoting = candidates.some((m) => movePromo(m) !== 0);
      if (promoting) {
        setPromotion({ from, to });
        return false; // snap back; the dialog completes the move
      }
      applyMoveInternal(candidates[0]);
      return true;
    },
    [applyMoveInternal, isHumanTurn, legalTargetsFor, promotion],
  );

  const choosePromotion = useCallback(
    (pieceType: number) => {
      if (promotion === null) return;
      const engine = engineRef.current!;
      const letters = ['', '', 'n', 'b', 'r', 'q'];
      const move = engine.uciToMove(promotion.from + promotion.to + letters[pieceType]);
      setPromotion(null);
      if (move !== null) applyMoveInternal(move);
    },
    [applyMoveInternal, promotion],
  );

  // Kick things off once the worker is alive.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const { client } = ensureInit();
    void client.waitReady().then(() => scheduleNext());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    // state
    mode,
    playerSide,
    levels,
    eveRunning,
    autoFlip,
    fen,
    history,
    gameEnd,
    lastMove,
    orientation,
    selected,
    promotion,
    thinkingSide,
    engineInfo,
    evalPov,
    pvArrow,
    soundOn,
    theme,
    stmSide,
    isHumanTurn,
    gameId,
    engineRef,
    // actions
    newGame,
    switchMode,
    chooseSide,
    setEngineLevel,
    toggleEve,
    setAutoFlipAndApply,
    takeback,
    flipBoard,
    loadFen,
    setSoundOn,
    setTheme,
    onSquareClick,
    onPieceDrop,
    choosePromotion,
    legalTargetsFor,
  };
}

// Local helper that avoids extra engine imports in component code.
function colorOfFromFen(fen: string): 0 | 1 {
  return fen.split(' ')[1] === 'b' ? 1 : 0;
}

export type { SearchInfo };
