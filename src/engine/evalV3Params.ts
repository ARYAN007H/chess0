/**
 * evalV3 tunable parameters — the single source of truth for every
 * hand-written eval constant (scripts/texel-tune.ts rewrites these).
 *
 * Defaults are byte-identical to the original hardcoded values, so consuming
 * them from here is a pure refactor. `applyEvalParams` mutates the tables in
 * place; callers must also call `clearEvalCaches()` (evalV3) afterwards so no
 * stale pawn-TT / eval-cache entry survives a parameter change.
 */

// Rank-indexed tables (relative rank 0..7; ranks 0/7 are structurally 0).
// Exported so evalV3 can read them directly; presets mutate in place.
export const connectedMgT = new Int16Array([0, 0, 5, 8, 14, 26, 48, 0]);
export const connectedEgT = new Int16Array([0, 0, 4, 7, 12, 24, 42, 0]);
export const phalanxMgT = new Int16Array([0, 0, 4, 7, 12, 22, 36, 0]);
export const phalanxEgT = new Int16Array([0, 0, 3, 6, 10, 20, 32, 0]);
export const passedMgT = new Int16Array([0, 4, 10, 20, 42, 78, 135, 0]);
export const passedEgT = new Int16Array([0, 12, 24, 46, 82, 138, 215, 0]);
export const passedFreeMgT = new Int16Array([0, 2, 4, 8, 16, 30, 52, 0]);
export const passedFreeEgT = new Int16Array([0, 6, 12, 22, 40, 68, 105, 0]);

export const TABLES: Record<string, Int16Array> = {
  connectedMg: connectedMgT,
  connectedEg: connectedEgT,
  phalanxMg: phalanxMgT,
  phalanxEg: phalanxEgT,
  passedMg: passedMgT,
  passedEg: passedEgT,
  passedFreeMg: passedFreeMgT,
  passedFreeEg: passedFreeEgT,
};

/** Flat scalar params (mg/eg suffix = tapered pair member). */
export const evalV3Params = {
  tempo: 14,

  bishopPairMg: 28,
  bishopPairEg: 54,
  doubledMg: -11,
  doubledEg: -26,
  isolatedMg: -15,
  isolatedEg: -14,
  backwardMg: -12,
  backwardEg: -10,
  passedProtMg: 14,
  passedProtEg: 22,
  rookBehindPasserMg: 16,
  rookBehindPasserEg: 30,

  // Passer/king interaction (rule of the square)
  passerKingEnemyW: 5,
  passerKingOurW: 2,
  unstoppableBase: 320,
  unstoppablePerRank: 40,

  knightOutpostMg: 28,
  knightOutpostEg: 18,
  knightOutpostCenterMg: 8,
  knightOutpostCenterEg: 4,
  bishopOutpostMg: 18,
  bishopOutpostEg: 12,
  bishopOutpostCenterMg: 6,
  bishopOutpostCenterEg: 4,

  rookOpenMg: 32,
  rookOpenEg: 12,
  rookSemiMg: 16,
  rookSemiEg: 6,
  rook7thMg: 22,
  rook7thEg: 32,
  rookBatteryMg: 14,
  rookBatteryEg: 10,

  mobNMg: 5,
  mobNEg: 5,
  mobBMg: 5,
  mobBEg: 5,
  mobRMg: 3,
  mobREg: 5,
  mobQMg: 2,
  mobQEg: 3,
  baseN: 4,
  baseB: 6,
  baseR: 7,
  baseQ: 13,

  pawnThreatMinorMg: 36,
  pawnThreatMinorEg: 28,
  pawnThreatMajorMg: 58,
  pawnThreatMajorEg: 42,
  minorThreatRookMg: 30,
  minorThreatRookEg: 22,
  minorThreatQueenMg: 44,
  minorThreatQueenEg: 32,

  shieldNear: 14,
  shieldFar: 7,
  shieldOpenFile: -20,
  shieldOpenExtra: -10,

  kingAttackNBase: 20,
  kingAttackNPer: 8,
  kingAttackBBase: 20,
  kingAttackBPer: 8,
  kingAttackRBase: 36,
  kingAttackRPer: 10,
  kingAttackQBase: 65,
  kingAttackQPer: 12,
  kingDangerCap: 350,

  ocbScale: 3, // applied as (score * ocbScale) >> 2
  mopupEdge: 14,
  mopupClose: 6,
  mopupMargin: 250,
  mopupMaxPhase: 6,
};

export type EvalV3ParamsShape = typeof evalV3Params;

const DEFAULTS: EvalV3ParamsShape = { ...evalV3Params };
const DEFAULT_TABLES: Record<string, Int16Array> = {};
for (const k of Object.keys(TABLES)) DEFAULT_TABLES[k] = new Int16Array(TABLES[k]);

/** Overwrite scalars and/or rank tables (table arrays must be length 8). */
export function applyEvalParams(
  scalars?: Partial<Record<keyof EvalV3ParamsShape, number>>,
  tables?: Partial<Record<string, number[]>>,
): void {
  if (scalars) {
    for (const k of Object.keys(scalars) as (keyof EvalV3ParamsShape)[]) {
      if (k in evalV3Params) (evalV3Params[k] as number) = scalars[k]!;
    }
  }
  if (tables) {
    for (const k of Object.keys(tables)) {
      const t = TABLES[k];
      const v = tables[k];
      if (t && v && v.length === 8) t.set(v);
    }
  }
}

/** Restore factory defaults (does NOT clear caches — call clearEvalCaches). */
export function resetEvalParams(): void {
  Object.assign(evalV3Params, DEFAULTS);
  for (const k of Object.keys(TABLES)) TABLES[k].set(DEFAULT_TABLES[k]);
}
