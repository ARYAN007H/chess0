/**
 * Multi-worker search fan-out ("lazy SMP" via message passing).
 *
 * Wraps N EngineClient workers behind the exact EngineClient API surface.
 * Every position-changing message (reset/move/undo) is broadcast to all
 * workers so their private positions stay mirrored with the UI engine.
 * Searches fan out to all workers; the best result wins (deepest completed
 * iteration, then most nodes), while node counts are summed for display.
 * The leader (worker 0) streams `info` events so the live panel stays fed.
 *
 * Independent-TT message-passing SMP needs no SharedArrayBuffer, so it works
 * on static hosting (GitHub Pages) as well as locally. Depth-limited searches
 * are deterministic — they run on the leader only.
 */

import { EngineClient } from './engineClient';
import type { EngineBestMove, EngineInfoEvent, SearchOptions } from './engineClient';

type InfoHandler = (info: EngineInfoEvent) => void;

export function defaultThreadCount(): number {
  const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(1, Math.min(4, hc - 1));
}

export class EnginePoolClient {
  private workers: EngineClient[] = [];
  private readyPromise: Promise<void>;

  constructor(threads: number) {
    const n = Math.max(1, Math.min(8, threads | 0));
    for (let i = 0; i < n; i++) this.workers.push(new EngineClient());
    this.readyPromise = Promise.all(this.workers.map((w) => w.waitReady())).then(() => undefined);
  }

  get size(): number {
    return this.workers.length;
  }

  waitReady(): Promise<void> {
    return this.readyPromise;
  }

  reset(fen?: string): void {
    for (const w of this.workers) w.reset(fen);
  }

  move(uci: string): void {
    for (const w of this.workers) w.move(uci);
  }

  undo(plies: number): void {
    for (const w of this.workers) w.undo(plies);
  }

  search(options: SearchOptions, onInfo?: InfoHandler): Promise<EngineBestMove> {
    // Deterministic fixed-depth searches gain nothing from identical workers.
    if (options.depth !== undefined || this.workers.length === 1) {
      return this.workers[0].search(options, onInfo);
    }

    return Promise.all(
      this.workers.map((w, i) => w.search(options, i === 0 ? onInfo : undefined)),
    ).then((results) => {
      let best = results[0];
      for (const r of results) {
        if (r.depth > best.depth || (r.depth === best.depth && r.nodes > best.nodes)) best = r;
      }
      // Sum the fleet's work for the info panel; keep the winner's line/score.
      return {
        ...best,
        nodes: results.reduce((a, r) => a + r.nodes, 0),
        nps: results.reduce((a, r) => a + r.nps, 0),
        timeMs: results.reduce((a, r) => Math.max(a, r.timeMs), 0),
      };
    });
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}
