/**
 * moduleAccessMap — central router → SKU (module code) mapping (doc 38 Đợt Q).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PURPOSE
 * A single authoritative table that says which optional SKU module each tRPC
 * router belongs to, so per-module license enforcement (`moduleGate` /
 * `moduleProcedure`, server/_core/moduleGate.ts) can be applied comprehensively
 * and consistently instead of ad-hoc per-router.
 *
 * The values are `MOD_*` codes from `shared/module-registry.ts` (10 optional
 * modules). Routers NOT listed here are either CORE (auth/dashboard/settings/
 * admin — always allowed) or intentionally ungated (public ingest, license).
 *
 * ── How it is applied ────────────────────────────────────────────────────────
 * Each gated router shadows its base procedure with the module gate, mirroring the
 * pattern in orchestrationRouter / fleetRouter:
 *
 *     import { router, moduleProcedure } from "../_core/trpc";
 *     const protectedProcedure = moduleProcedure(MODULE_FOR.spc);   // MOD_QUALITY
 *
 * Whole-router gating is safe because `moduleGate` is a pure pass-through unless
 * `LICENSE_MODULE_GATE_ENABLED` is on AND the deployment's SKU is explicitly
 * populated (no-brick — see moduleGate.ts). RBAC (`requirePermission`) and role
 * floors (`actuationProcedure`) still compose ON TOP; this only adds the license
 * dimension.
 *
 * NOTE: this table documents the FULL intended coverage. Wiring is rolled out
 * router-by-router; a router present here but not yet shadowing `moduleProcedure`
 * simply is not license-gated yet (RBAC still applies). Keep this the source of
 * truth when wiring the remainder.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** Optional SKU module codes (must match shared/module-registry.ts). */
export const MOD = {
  QUALITY: "MOD_QUALITY",
  PRODUCTION: "MOD_PRODUCTION",
  ANALYTICS: "MOD_ANALYTICS",
  MONITORING: "MOD_MONITORING",
  DATA_MANAGEMENT: "MOD_DATA_MANAGEMENT",
  CORPORATE: "MOD_CORPORATE",
  OT_CONTROL: "MOD_OT_CONTROL",
  ENGINEERING: "MOD_ENGINEERING",
  AI: "MOD_AI",
  FEDERATION: "MOD_FEDERATION",
} as const;

export type ModuleCode = (typeof MOD)[keyof typeof MOD];

/**
 * routerKey → module code. `routerKey` is the router's basename without the
 * "Router" suffix (e.g. `spcAnalysisRouter.ts` → "spcAnalysis"). Central reference
 * for wiring `moduleProcedure(...)`.
 */
export const MODULE_ACCESS_MAP: Record<string, ModuleCode> = {
  // ── Quality (MOD_QUALITY) ──────────────────────────────────────────────────
  spcAnalysis: MOD.QUALITY,
  spcAdvanced: MOD.QUALITY,
  paretoAnalysis: MOD.QUALITY,
  defectHeatmap: MOD.QUALITY,
  defectDisposition: MOD.QUALITY,
  ncr: MOD.QUALITY,
  nonconformance: MOD.QUALITY,
  goldenSample: MOD.QUALITY,
  repairStation: MOD.QUALITY,
  thresholdApproval: MOD.QUALITY,

  // ── Production / MES (MOD_PRODUCTION) ──────────────────────────────────────
  production: MOD.PRODUCTION,
  traceability: MOD.PRODUCTION,
  genealogy: MOD.PRODUCTION,
  wip: MOD.PRODUCTION,
  routing: MOD.PRODUCTION,
  bom: MOD.PRODUCTION,

  // ── OT & Machine Control (MOD_OT_CONTROL) ──────────────────────────────────
  machineRecipe: MOD.OT_CONTROL,
  safety: MOD.OT_CONTROL,
  secsGem: MOD.OT_CONTROL,
  vda5050: MOD.OT_CONTROL,
  mtconnect: MOD.OT_CONTROL,
  fleet: MOD.OT_CONTROL,
  robot: MOD.OT_CONTROL,
  interlock: MOD.OT_CONTROL,

  // ── Engineering & Programming (MOD_ENGINEERING) ────────────────────────────
  ir: MOD.ENGINEERING,
  programming: MOD.ENGINEERING,
  ecn: MOD.ENGINEERING,
  engineeringChange: MOD.ENGINEERING,
  orchestration: MOD.ENGINEERING,

  // ── AI (MOD_AI) ────────────────────────────────────────────────────────────
  anomalyBank: MOD.AI,
  causalGraph: MOD.AI,

  // ── Federation (MOD_FEDERATION) ────────────────────────────────────────────
  sites: MOD.FEDERATION,
  federation: MOD.FEDERATION,
};

/** Look up the SKU module for a router key (undefined → CORE / ungated). */
export function moduleForRouter(routerKey: string): ModuleCode | undefined {
  return MODULE_ACCESS_MAP[routerKey];
}
