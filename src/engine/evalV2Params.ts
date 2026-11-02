/**
 * evalV2 tunable parameters — same contract as evalV3Params.ts: defaults are
 * identical to the original hardcoded constants (pure refactor), and callers
 * must not need cache invalidation (evalV2 keeps no caches).
 */

export const passedMgT2 = new Int16Array([0, 2, 6, 14, 28, 52, 90, 0]);
export const passedEgT2 = new Int16Array([0, 8, 16, 32, 58, 92, 140, 0]);

export const TABLES2: Record<string, Int16Array> = {
  passedMg: passedMgT2,
  passedEg: passedEgT2,
};

export const evalV2Params = {
  tempo: 12,

  bishopPairMg: 22,
  bishopPairEg: 45,
  doubledMg: -12,
  doubledEg: -28,
  isolatedMg: -14,
  isolatedEg: -10,

  rookOpenMg: 30,
  rookOpenEg: 8,
  rookSemiMg: 14,
  rookSemiEg: 4,
  rook7thMg: 16,
  rook7thEg: 24,

  mobNMg: 4,
  mobNEg: 4,
  mobBMg: 4,
  mobBEg: 4,
  mobRMg: 2,
  mobREg: 5,
  mobQMg: 1,
  mobQEg: 2,
  baseN: 4,
  baseB: 6,
  baseR: 7,
  baseQ: 14,

  shieldClose: 12,
  shieldOpen: -16,
};

export type EvalV2ParamsShape = typeof evalV2Params;

const DEFAULTS2: EvalV2ParamsShape = { ...evalV2Params };
const DEFAULT_TABLES2: Record<string, Int16Array> = {};
for (const k of Object.keys(TABLES2)) DEFAULT_TABLES2[k] = new Int16Array(TABLES2[k]);

/** Overwrite scalars and/or rank tables (table arrays must be length 8). */
export function applyEvalV2Params(
  scalars?: Partial<Record<keyof EvalV2ParamsShape, number>>,
  tables?: Partial<Record<string, number[]>>,
): void {
  if (scalars) {
    for (const k of Object.keys(scalars) as (keyof EvalV2ParamsShape)[]) {
      if (k in evalV2Params) (evalV2Params[k] as number) = scalars[k]!;
    }
  }
  if (tables) {
    for (const k of Object.keys(tables)) {
      const t = TABLES2[k];
      const v = tables[k];
      if (t && v && v.length === 8) t.set(v);
    }
  }
}

/** Restore factory defaults. */
export function resetEvalV2Params(): void {
  Object.assign(evalV2Params, DEFAULTS2);
  for (const k of Object.keys(TABLES2)) TABLES2[k].set(DEFAULT_TABLES2[k]);
}
