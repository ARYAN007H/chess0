/**
 * Main-thread wrapper around the engine Web Worker: promise-based search
 * requests with streaming info callbacks, all requests tagged with an id so
 * stale results can be discarded.
 */

export interface EngineScore {
  scoreCp?: number;
  scoreMate?: number;
}

export interface EngineInfoEvent extends EngineScore {
  intent?: 'move' | 'eval';
  depth: number;
  seldepth: number;
  nodes: number;
  nps: number;
  timeMs: number;
  stm: 0 | 1;
  pvUci: string[];
  pvSan: string[];
}

export interface EngineBestMove extends EngineInfoEvent {
  uci: string;
}

export interface SearchOptions {
  depth?: number;
  movetime?: number;
  /** 'v2' selects the stronger v2 search/eval stack in the worker. */
  variant?: 'v1' | 'v2';
  intent?: 'move' | 'eval';
}

type InfoHandler = (info: EngineInfoEvent) => void;

export class EngineClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: EngineBestMove) => void; onInfo?: InfoHandler }>();
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;

  constructor() {
    this.worker = new Worker(new URL('./engine/worker.ts', import.meta.url), { type: 'module' });
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
    this.worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.type) {
        case 'ready':
          this.readyResolve();
          break;
        case 'moved':
        case 'error':
          if (msg.type === 'error') console.error('[chess0 worker]', msg.message);
          break;
        case 'info': {
          const entry = this.pending.get(msg.id);
          entry?.onInfo?.(msg);
          break;
        }
        case 'bestmove': {
          const entry = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          entry?.resolve(msg);
          break;
        }
      }
    };
    this.worker.onerror = (err) => console.error('[chess0 worker]', err.message ?? err);
  }

  waitReady(): Promise<void> {
    return this.readyPromise;
  }

  search(options: SearchOptions, onInfo?: InfoHandler): Promise<EngineBestMove> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, onInfo });
      this.worker.postMessage({ type: 'search', id, ...options });
    });
  }

  reset(fen?: string): void {
    this.worker.postMessage({ type: 'reset', fen });
  }

  move(uci: string): void {
    this.worker.postMessage({ type: 'move', uci });
  }

  undo(plies: number): void {
    this.worker.postMessage({ type: 'undo', plies });
  }

  terminate(): void {
    this.worker.terminate();
  }
}
