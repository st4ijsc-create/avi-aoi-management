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
  //
  // ★★★ 2026-08-19 — bảng này TỪNG chỉ có hai dòng dưới đây, và cả hai chỉ là **ý định**:
  //     `causalGraph` chưa bao giờ được nối dây (nay đã), còn `anomalyBank` **KHÔNG TỒN TẠI** —
  //     không có `anomalyBankRouter.ts` nào; màn `/anomaly-banks` dùng `aiAnomaly.*`. Giữ lại dòng
  //     chết ấy là để bảng nói dối, nên nó bị xoá.
  // ⚠⚠ Bảng này KHÔNG có người tiêu thụ lúc chạy (đã grep toàn `server/`): nó là **TÀI LIỆU**.
  //     Nguồn sự thật ĐO ĐƯỢC về "thủ tục nào đứng sau cổng nào" là bộ suy AST
  //     `server/routers/congGiayPhepScan.ts` + cổng `congGiayPhepAiCensus.test.ts`. Nếu bảng này
  //     và bộ suy ấy lệch nhau, tin bộ suy.
  causalGraph: MOD.AI,
  aiActiveLearning: MOD.AI,
  aiAdvanced: MOD.AI,
  aiAdvancedVision: MOD.AI,
  aiAgent: MOD.AI,
  aiAgentCenter: MOD.AI,
  aiAnalysisHub: MOD.AI,
  aiAnomaly: MOD.AI,
  aiCalibration: MOD.AI,
  aiChat: MOD.AI,
  aiCopilot: MOD.AI,
  aiEval: MOD.AI,
  aiGguf: MOD.AI,
  aiImageSearch: MOD.AI,
  aiLocalKb: MOD.AI,
  aiLocalTraining: MOD.AI,
  aiModel: MOD.AI,
  aiQualityGate: MOD.AI,
  aiReport: MOD.AI,
  aiRobotAnomaly: MOD.AI,
  aiSegmentation: MOD.AI,
  aiSettings: MOD.AI,
  aiSpecialistAgent: MOD.AI,
  aiTimeSeries: MOD.AI,
  aiVision: MOD.AI,
  aiVisionLanguage: MOD.AI,
  repoWorkspace: MOD.AI,
  // ⚠⚠⚠ **KHÔNG** có mặt ở đây, CỐ Ý — mười router mang tên `ai…` nhưng phục vụ dữ liệu VẬN HÀNH
  //     mà khách KHÔNG mua AI vẫn phải dùng: `aiInbox` · `aiInsight` · `aiInspectionAnalytics` ·
  //     `aiOrchestration` · `aiProgrammingKb` · `aiRcaCopilot` · `aiSetupAdvisor` ·
  //     `aiSmartAlertRouting` · `aiThresholdAdvisor` · `aiToday`, cộng `rootCause` +
  //     `predictiveAlert` (`aiRouters.ts`). Lý do TỪNG THỦ TỤC được ký tên trong
  //     `MIEN_TRU_VAN_HANH` ở `server/routers/congGiayPhepAiCensus.test.ts` — đọc ở đó trước khi
  //     thêm bất kỳ tên nào trong số đó vào bảng này.

  // ── Federation (MOD_FEDERATION) ────────────────────────────────────────────
  sites: MOD.FEDERATION,
  federation: MOD.FEDERATION,
};

/** Look up the SKU module for a router key (undefined → CORE / ungated). */
export function moduleForRouter(routerKey: string): ModuleCode | undefined {
  return MODULE_ACCESS_MAP[routerKey];
}
