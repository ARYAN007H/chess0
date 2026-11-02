/**
 * Web worker entry: owns the searching Position and answers requests from
 * the UI. One search at a time; results carry the request `id` so the UI can
 * discard stale ones after takebacks or resets.
 */

import { Engine } from './engine';
import type { SearchLimits } from './search';

const engine = new Engine();
const ctx = self as unknown as Worker;

export interface WorkerRequest {
  type: 'reset' | 'move' | 'undo' | 'search';
  id?: number;
  fen?: string;
  uci?: string;
  plies?: number;
  depth?: number;
  movetime?: number;
  variant?: 'v1' | 'v2' | 'v3';
  multiPv?: number;
  intent?: 'move' | 'eval';
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'reset': {
        engine.reset(msg.fen);
        ctx.postMessage({ type: 'ready', fen: engine.fen() });
        break;
      }
      case 'move': {
        const move = engine.applyUci(msg.uci!);
        if (move === null) {
          ctx.postMessage({ type: 'error', message: `illegal move: ${msg.uci}` });
        } else {
          ctx.postMessage({ type: 'moved', uci: msg.uci, fen: engine.fen() });
        }
        break;
      }
      case 'undo': {
        engine.undo(msg.plies ?? 1);
        ctx.postMessage({ type: 'moved', fen: engine.fen() });
        break;
      }
      case 'search': {
        const limits: SearchLimits = {};
        if (msg.depth !== undefined) limits.depth = msg.depth;
        if (msg.movetime !== undefined) limits.movetime = msg.movetime;
        if (msg.variant !== undefined) limits.variant = msg.variant;
        if (msg.multiPv !== undefined) limits.multiPv = msg.multiPv;
        const result = engine.search(limits, (info) => {
          ctx.postMessage({ type: 'info', id: msg.id, intent: msg.intent, ...info });
        });
        ctx.postMessage({
          type: 'bestmove',
          id: msg.id,
          intent: msg.intent,
          uci: result.bestMoveUci,
          depth: result.depth,
          seldepth: result.seldepth,
          nodes: result.nodes,
          nps: result.nps,
          timeMs: result.timeMs,
          stm: result.stm,
          scoreCp: result.scoreCp,
          scoreMate: result.scoreMate,
          pvSan: result.pvSan,
          pvUci: result.pvUci,
          bookOpening: result.bookOpening,
          multiPv: result.multiPv,
        });
        break;
      }
    }
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
