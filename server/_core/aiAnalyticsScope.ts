/**
 * AI Analytics/Report — factory scope + per-user rate limit (doc 69 Wave 0 / T3).
 *
 * server/routers/aiInspectionAnalyticsRouter.ts and server/routers/aiReportRouter.ts
 * accept client-supplied machineId/factoryCode/lineCode/factoryId filters with NO
 * ownership check against the calling user — any authenticated user in the rollout
 * could query ANY factory's inspection data, and only the GLOBAL (IP/session-keyed)
 * `/api` rate limiter (server/_core/rateLimitConfig.ts createApiLimiter) guarded these
 * (expensive) aggregation endpoints — no per-user throttle.
 *
 * STEP 0 finding (do NOT invent a new authorization model — mirror what exists):
 *   - `ctx.user` is a full `User` row (drizzle `users` table) — id, role, etc. It does
 *     NOT carry a factory/tenant scope field directly.
 *   - The codebase's ESTABLISHED factory-scope pattern lives in
 *     server/_core/accessControl.ts `getUserAssignmentCodes(userId, role)`: role
 *     'admin' is the ONLY global/unrestricted role (isAdmin=true, empty code arrays =
 *     "no filter"); every other role is restricted to the factory codes resolved from
 *     `userFactoryAssignments` rows (server/db/auth.ts getUserFactoryAssignments). This
 *     exact helper already backs `getTenantScope` (RLS, trpc.ts tenantScopeMiddleware)
 *     and `getAccessFilterConditions` (productInspections filtering). A THIRD sibling,
 *     server/services/aiActionInbox.ts `factoryScope()`, applies the identical rule
 *     ("admin → null/unrestricted, others → their factoryCodes, possibly empty") to
 *     scope AI insights/alerts by factory — the closest existing precedent for AI
 *     surfaces specifically. This module mirrors all three.
 *   - Rate limiting: server/services/aiGateway.ts already runs a per-user, in-process
 *     fixed-window limiter (`checkRateLimit`, keyed `${userId}:${bucket}`) for AI
 *     inference tiers. `checkNamedRateLimit` (exported from aiGateway.ts) generalizes
 *     that SAME mechanism (same `windows` store, same window length) to an arbitrary
 *     bucket name/limit, so this module reuses it with a DEDICATED bucket
 *     ("ai_analytics_report") instead of borrowing budget from LLM inference tiers.
 *
 * Kept at the ROUTER boundary on purpose: the analytics/report SERVICES
 * (server/services/aiInspectionAnalytics.ts, server/services/aiReportGenerator.ts) stay
 * pure, user-unaware query builders — callers here narrow/validate the filter object
 * before invoking them.
 */
import { appError } from "./appError";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { User } from "../../drizzle/schema";
import { factories, machines, productionLines, stations, workshops } from "../../drizzle/schema";
import { getDb } from "../db/connection";
import { getUserAssignmentCodes } from "./accessControl";
import { checkNamedRateLimit } from "../services/aiGateway";

// ─── Factory scope resolution (mirrors accessControl.getUserAssignmentCodes) ──────

export interface FactoryScope {
  /** true for 'admin' — unrestricted, mirrors getUserAssignmentCodes()/getTenantScope(). */
  isGlobal: boolean;
  /** Assigned factory codes for a non-global user (possibly empty = no access at all). */
  factoryCodes: string[];
  /**
   * Assigned corporate codes. `getAccessFilterConditions` (the pattern this module
   * mirrors) grants by `corporateCode OR factoryCode` — a corporate-level user
   * (factoryCodes empty, corporateCodes set) legitimately has access to every factory
   * under that corporate. Dropping this (as the original T3 pass did) wrongly denied
   * corporate-scoped users. See `isFactoryCodeInScope`.
   */
  corporateCodes: string[];
}

export async function resolveFactoryScope(user: Pick<User, "id" | "role">): Promise<FactoryScope> {
  const { factoryCodes, corporateCodes, isAdmin } = await getUserAssignmentCodes(user.id, String(user.role));
  return { isGlobal: isAdmin, factoryCodes, corporateCodes };
}

/** factories.id → factories.code, or null when not found / DB unavailable. */
export async function getFactoryCodeById(factoryId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ code: factories.code })
    .from(factories)
    .where(eq(factories.id, factoryId))
    .limit(1);
  return row?.code ?? null;
}

/** factories.code → its owning corporates.code, or null when not found / no corporate / DB unavailable. */
export async function getFactoryCorporateCode(factoryCode: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ corporateCode: factories.corporateCode })
    .from(factories)
    .where(eq(factories.code, factoryCode))
    .limit(1);
  return row?.corporateCode ?? null;
}

/**
 * True when `factoryCode` is within `scope` — either directly assigned, OR (mirroring
 * `getAccessFilterConditions`'s OR-of-corporate-or-factory rule) owned by one of the
 * user's assigned corporates. Reduces to a plain `factoryCodes.includes(...)` check
 * when the user has no corporate assignments (corporateCodes=[]), so this is a
 * behavior-preserving superset of the pre-existing check for every caller that only
 * ever had factory-level assignments.
 */
export async function isFactoryCodeInScope(scope: FactoryScope, factoryCode: string): Promise<boolean> {
  if (scope.factoryCodes.includes(factoryCode)) return true;
  if (scope.corporateCodes.length === 0) return false;
  const corporateCode = await getFactoryCorporateCode(factoryCode);
  return !!corporateCode && scope.corporateCodes.includes(corporateCode);
}

/**
 * doc 69 T9 review fix (Important) — deterministically pick ONE factory code out of a
 * non-global scope, for read-only endpoints that must never hard-error a caller who is
 * legitimately assigned to more than one factory (or is corporate-only) just because they
 * didn't specify which one they meant. `enforceAnalyticsFactoryScope` still throws
 * FORBIDDEN for that ambiguous case where the caller is expected to disambiguate
 * (aiInspectionAnalyticsRouter); this helper is for callers that instead want to fall back
 * to "show me MY OWN data, whichever factory happens to come first" rather than erroring.
 *
 * Directly-assigned factories win (sorted ascending so the pick is stable regardless of
 * assignment-row insertion order or cache state). A corporate-only caller (no direct
 * factory assignment) falls back to the alphabetically-first factory owned by any of their
 * assigned corporates. Returns null only when nothing is resolvable at all (0 factories, 0
 * corporates, or a corporate that currently owns no factories) — callers MUST treat null
 * as "cannot default, go through the normal FORBIDDEN path", never as "show everything".
 */
export async function firstFactoryCodeInScope(scope: FactoryScope): Promise<string | null> {
  if (scope.factoryCodes.length > 0) {
    return [...scope.factoryCodes].sort()[0];
  }
  if (scope.corporateCodes.length === 0) return null;
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ code: factories.code })
    .from(factories)
    .where(inArray(factories.corporateCode, scope.corporateCodes))
    .orderBy(asc(factories.code))
    .limit(1);
  return row?.code ?? null;
}

/**
 * ★★★ 2026-08-18 (nhóm B #1/#4) — **PHẠM VI THEO `factories.id`**, cho các bề mặt lọc bằng
 * KHOÁ SỐ chứ không bằng mã chuỗi.
 *
 * `firstFactoryCodeInScope` cố tình thu về **ĐÚNG MỘT** mã, vì nơi gọi nó
 * (`getTopNGMeasurementPointsEnhanced`) chỉ nhận một `factoryCode`. Nhưng ba bề mặt của đợt này —
 * `get_factory_stats` (tổng hợp **NHIỀU** nhà máy theo định nghĩa), `get_ng_compare` và
 * `aiTimeSeries.analyzeMetric` — đọc thẳng `daily_statistics`, bảng có `factoryId` **NOT NULL**
 * kèm index `idx_stats_factory_date`. Thu về một mã ở đó sẽ **cắt mất** dữ liệu hợp lệ của một
 * người được gán hai nhà máy (chặt quá tay), còn bỏ trống thì rò **toàn hệ thống**.
 *
 * ⇒ Hàm này trả **TẬP** id nhà máy trong phạm vi, theo ĐÚNG luật `getAccessFilterConditions` đang
 * dùng (`corporateCode` HOẶC `factoryCode`) — không luật thứ hai. Mảng **RỖNG** nghĩa là *"phạm vi
 * rỗng"*, và nơi gọi **PHẢI** hiểu nó là **từ chối**, KHÔNG BAO GIỜ là "không lọc gì cả".
 *
 * ⚠ Gọi với `scope.isGlobal === true` là một **lỗi lập trình**: vai toàn quyền không có tập id nào
 * để liệt kê (và liệt kê được cũng sai — nhà máy tạo sau lượt liệt kê sẽ vô hình). Nơi gọi phải
 * rẽ nhánh trên `isGlobal` TRƯỚC. Hàm ném để lỗi ấy kêu thay vì lặng lẽ trả rỗng ⇒ khoá admin.
 */
export async function factoryIdsInScope(scope: FactoryScope): Promise<number[]> {
  if (scope.isGlobal) {
    throw new Error(
      "factoryIdsInScope() gọi với phạm vi TOÀN CỤC — vai toàn quyền không được liệt kê theo tập id. " +
        "Nơi gọi phải rẽ nhánh trên `scope.isGlobal` trước (bỏ hẳn mệnh đề lọc).",
    );
  }
  if (scope.factoryCodes.length === 0 && scope.corporateCodes.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  const dieuKien = [
    scope.factoryCodes.length > 0 ? inArray(factories.code, scope.factoryCodes) : undefined,
    scope.corporateCodes.length > 0 ? inArray(factories.corporateCode, scope.corporateCodes) : undefined,
  ].filter((c): c is Exclude<typeof c, undefined> => c !== undefined);
  // `dieuKien` chắc chắn có ≥1 phần tử ở nhánh này (đã loại trường hợp cả hai rỗng ở trên),
  // nên `or()` không thể trả undefined — KHÔNG dùng `!` (xem docblock DENY_ALL_ROWS ở
  // accessControl.ts: đúng dấu `!` ấy đã che một lỗ "undefined ⇒ thấy TẤT CẢ").
  const rows = await db
    .select({ id: factories.id })
    .from(factories)
    .where(dieuKien.length === 1 ? dieuKien[0] : or(...dieuKien));
  return rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
}

/** machines.id → its owning factory's code (station → line → workshop → factory), or null. */
export async function getMachineFactoryCode(machineId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ code: factories.code })
    .from(machines)
    .innerJoin(stations, eq(machines.stationId, stations.id))
    .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
    .innerJoin(workshops, eq(productionLines.workshopId, workshops.id))
    .innerJoin(factories, eq(workshops.factoryId, factories.id))
    .where(eq(machines.id, machineId))
    .limit(1);
  return row?.code ?? null;
}

/**
 * True when `lineCode` belongs (via workshop → factory) to `factoryCode`. lineCode is
 * only unique PER-WORKSHOP (uq_production_lines_workshop_code_active), so the same code
 * string can legitimately exist in more than one factory — this checks the specific
 * (lineCode, factoryCode) pair rather than trying to resolve lineCode alone.
 */
export async function lineExistsInFactory(lineCode: string, factoryCode: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [row] = await db
    .select({ id: productionLines.id })
    .from(productionLines)
    .innerJoin(workshops, eq(productionLines.workshopId, workshops.id))
    .innerJoin(factories, eq(workshops.factoryId, factories.id))
    .where(and(eq(productionLines.code, lineCode), eq(factories.code, factoryCode)))
    .limit(1);
  return !!row;
}

// ─── Analytics filter scoping (server/routers/aiInspectionAnalyticsRouter.ts) ─────

export interface AnalyticsScopeInput {
  user: Pick<User, "id" | "role">;
  factoryCode?: string;
  machineId?: number;
  lineCode?: string;
}

/**
 * Enforce the user's factory scope on an analytics filter. Admin (global) → passthrough,
 * unchanged (full access). Scoped (non-admin) user:
 *  - explicit `factoryCode` outside their assignments → FORBIDDEN. Before this task,
 *    aiInspectionAnalyticsRouter passed this straight through to the (user-unaware)
 *    service, so ANY authenticated user could read ANY factory's data this way.
 *  - no `factoryCode` + exactly ONE assigned factory → silently narrowed to it (the
 *    brief's "silently narrow" allowance — unambiguous, zero-friction, zero leakage).
 *  - no `factoryCode` + 0 or >1 assigned factories → FORBIDDEN. The analytics service
 *    only accepts a single factoryCode per call, so an ambiguous/unscoped request is
 *    never guessed at — the caller must say which of their factories they mean.
 *  - `machineId` / `lineCode` outside the (now-resolved) factory → FORBIDDEN.
 * Returns the filter with `factoryCode` set to the enforced value (undefined only for
 * a global user who did not supply one).
 */
export async function enforceAnalyticsFactoryScope<T extends AnalyticsScopeInput>(
  params: T,
): Promise<{ factoryCode?: string }> {
  const scope = await resolveFactoryScope(params.user);
  if (scope.isGlobal) {
    return { factoryCode: params.factoryCode };
  }

  if (scope.factoryCodes.length === 0 && scope.corporateCodes.length === 0) {
    throw appError(
      "FORBIDDEN",
      "PERMISSION_DENIED",
      { action: "viewAiAnalytics", reason: "noFactoryAssigned" },
      "Tài khoản chưa được gán nhà máy nào — không có dữ liệu phân tích để xem.",
    );
  }

  let factoryCode: string;
  if (params.factoryCode) {
    if (!(await isFactoryCodeInScope(scope, params.factoryCode))) {
      // factoryCode cụ thể là giá trị TỰ DO (mã nhà máy do khách hàng đặt,
      // không phải enum cố định) — giữ nguyên trong fallbackMessage, mất khi
      // đã dịch (cùng giới hạn với moduleName ở accessControl.ts).
      throw appError(
        "FORBIDDEN",
        "PERMISSION_DENIED",
        { action: "viewAiAnalytics", reason: "factoryOutsideScope" },
        `Nhà máy "${params.factoryCode}" nằm ngoài phạm vi được gán cho tài khoản này.`,
      );
    }
    factoryCode = params.factoryCode;
  } else if (scope.factoryCodes.length === 1) {
    factoryCode = scope.factoryCodes[0];
  } else {
    // Không phải "không có quyền" mà là "cần thêm input để hết mơ hồ" — tài
    // khoản CÓ quyền xem nhiều nhà máy, chỉ chưa nói xem nhà máy nào.
    throw appError(
      "FORBIDDEN",
      "FIELD_REQUIRED",
      { field: "factoryCode" },
      "Tài khoản được gán nhiều nhà máy — vui lòng chỉ định factoryCode cụ thể.",
    );
  }

  if (params.machineId != null) {
    const machineFactory = await getMachineFactoryCode(params.machineId);
    if (!machineFactory || !(await isFactoryCodeInScope(scope, machineFactory))) {
      throw appError(
        "FORBIDDEN",
        "PERMISSION_DENIED",
        { action: "viewAiAnalytics", reason: "machineOutsideScope" },
        "Máy được yêu cầu nằm ngoài phạm vi nhà máy được gán cho tài khoản này.",
      );
    }
  }

  if (params.lineCode) {
    const ok = await lineExistsInFactory(params.lineCode, factoryCode);
    if (!ok) {
      // KHÁC 2 nhánh trên: đây không phải "ngoài phạm vi được GÁN cho tài
      // khoản" mà là quan hệ SỞ HỮU giữa 2 entity (lineCode có thật, chỉ
      // không thuộc factoryCode đang xét) — đúng ngữ nghĩa SCOPE_MISMATCH đã
      // dùng ở aoiPackageRouter.ts/machineApiRouters.ts (entity không thuộc
      // parent), không phải PERMISSION_DENIED.
      throw appError(
        "FORBIDDEN",
        "SCOPE_MISMATCH",
        { entity: "line", parent: "factory" },
        `Dây chuyền "${params.lineCode}" không thuộc nhà máy "${factoryCode}".`,
      );
    }
  }

  return { factoryCode };
}

// ─── Report filter scoping (server/routers/aiReportRouter.ts) ─────────────────────
// aiReportGenerator's queries only ever filter by `machineId` — `params.factoryId` is
// currently DEAD in that service (never applied to a WHERE clause; see
// collectInspectionStats/collectTopDefects). Scope enforcement therefore centers on
// machineId. A scoped user omitting machineId would otherwise get an UNSCOPED report
// spanning every factory in the system, so machineId is REQUIRED for non-global users
// (the conservative choice — never silently aggregate across factories the caller
// cannot see; the service has no way to narrow to a *set* of factories in one query).
// `factoryId`, though currently unused downstream, is still validated when supplied
// (defense-in-depth + closes the gap the moment the service starts honoring it).

export interface ReportScopeInput {
  user: Pick<User, "id" | "role">;
  machineId?: number;
  factoryId?: number;
}

export async function enforceReportFactoryScope(params: ReportScopeInput): Promise<void> {
  const scope = await resolveFactoryScope(params.user);
  if (scope.isGlobal) return;

  if (scope.factoryCodes.length === 0 && scope.corporateCodes.length === 0) {
    throw appError(
      "FORBIDDEN",
      "PERMISSION_DENIED",
      { action: "generateAiReport", reason: "noFactoryAssigned" },
      "Tài khoản chưa được gán nhà máy nào — không có báo cáo để tạo.",
    );
  }

  if (params.machineId == null) {
    // Cần thêm input để hết mơ hồ, không phải "không có quyền" — cùng lý do
    // với nhánh factoryCode ở enforceAnalyticsFactoryScope().
    throw appError(
      "FORBIDDEN",
      "FIELD_REQUIRED",
      { field: "machineId" },
      "Vui lòng chỉ định machineId thuộc nhà máy được gán cho tài khoản này.",
    );
  }

  const machineFactory = await getMachineFactoryCode(params.machineId);
  if (!machineFactory || !(await isFactoryCodeInScope(scope, machineFactory))) {
    throw appError(
      "FORBIDDEN",
      "PERMISSION_DENIED",
      { action: "generateAiReport", reason: "machineOutsideScope" },
      "Máy được yêu cầu nằm ngoài phạm vi nhà máy được gán cho tài khoản này.",
    );
  }

  if (params.factoryId != null) {
    const factoryCode = await getFactoryCodeById(params.factoryId);
    if (!factoryCode || !(await isFactoryCodeInScope(scope, factoryCode))) {
      throw appError(
        "FORBIDDEN",
        "PERMISSION_DENIED",
        { action: "generateAiReport", reason: "factoryOutsideScope" },
        "factoryId được yêu cầu nằm ngoài phạm vi được gán cho tài khoản này.",
      );
    }
  }
}

/**
 * doc 69 W0-3 SECURITY REVIEW FIX (Important #1) — `generateExecutiveSummary` and
 * `generateModelPerformanceReport` (server/services/aiReportGenerator.ts) are
 * INHERENTLY global: they ignore `machineId` entirely and aggregate across every
 * factory in the system (executive summary's KPIs/machine-rankings; model performance's
 * global AI model list). `enforceReportFactoryScope` above cannot narrow them — there is
 * no factory-level filter to narrow WITH. Wave 0 fix: close the leak by restricting
 * these two report types to the global (admin) role outright. A factory-scoped variant
 * would require the service itself to accept and apply a factory filter — deferred to
 * Wave 2 (service-layer change, out of scope here).
 */
export async function enforceGlobalReportScope(user: Pick<User, "id" | "role">): Promise<void> {
  const scope = await resolveFactoryScope(user);
  if (scope.isGlobal) return;
  // Câu TĨNH (không tham số động) — full-fidelity: reason mang trọn ý nghĩa
  // gốc, không mất chi tiết khi đã dịch (khác 2 hàm scope ở trên, nơi
  // factoryCode/machineId cụ thể chỉ còn ở fallbackMessage).
  throw appError(
    "FORBIDDEN",
    "PERMISSION_DENIED",
    { action: "viewGlobalAiReport", reason: "systemWideReportAdminOnly" },
    "Báo cáo này tổng hợp dữ liệu TOÀN HỆ THỐNG (không lọc theo máy/nhà máy) — chỉ tài khoản quản trị toàn cục mới được xem.",
  );
}

// ─── Composed router-boundary guards ───────────────────────────────────────────────
// Reused VERBATIM by both server/routers/aiReportRouter.ts and
// server/routers/aiAnalysisHubRouter.ts (doc 69 W0-3 security review fix #3 — the hub
// router exposed the exact same aiReportGenerator functions with NO scope/rate-limit
// check at all, bypassing every guard applied to aiReportRouter).

export interface ReportScopeCtx {
  user: Pick<User, "id" | "role"> | null | undefined;
}

/** Rate-limit + factory-scope guard for machineId-filterable report endpoints (dailySummary/rcaReport/generate). */
export async function applyReportScope(
  ctx: ReportScopeCtx,
  input: { machineId?: number; factoryId?: number },
): Promise<void> {
  if (!ctx.user) {
    throw appError("UNAUTHORIZED", "AUTH_REQUIRED", undefined, "Login required");
  }
  enforceAiAnalyticsRateLimit(ctx.user.id);
  await enforceReportFactoryScope({ user: ctx.user, machineId: input.machineId, factoryId: input.factoryId });
}

/** Rate-limit + admin-only guard for inherently-global report endpoints (modelPerformance/executiveSummary). */
export async function applyGlobalReportScope(ctx: ReportScopeCtx): Promise<void> {
  if (!ctx.user) {
    throw appError("UNAUTHORIZED", "AUTH_REQUIRED", undefined, "Login required");
  }
  enforceAiAnalyticsRateLimit(ctx.user.id);
  await enforceGlobalReportScope(ctx.user);
}

// ─── Per-user rate limit (reuses aiGateway's in-process fixed-window limiter) ─────

const DEFAULT_ANALYTICS_RATE_LIMIT_PER_MIN = 20;

function analyticsRateLimitMax(): number {
  const raw = process.env.AI_ANALYTICS_RATE_LIMIT_PER_MIN;
  if (!raw) return DEFAULT_ANALYTICS_RATE_LIMIT_PER_MIN;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ANALYTICS_RATE_LIMIT_PER_MIN;
}

/** Throws TOO_MANY_REQUESTS once the calling user exceeds their per-minute budget. */
export function enforceAiAnalyticsRateLimit(userId: number): void {
  const retryMs = checkNamedRateLimit(userId, "ai_analytics_report", analyticsRateLimitMax());
  if (retryMs != null) {
    // RATE_LIMITED params:{} — số giây chờ lại giữ ở fallbackMessage, đúng
    // quyết định Task 8 (không có 1 đơn vị chung cho mọi nơi gọi RATE_LIMITED).
    throw appError(
      "TOO_MANY_REQUESTS",
      "RATE_LIMITED",
      undefined,
      `Vượt giới hạn truy vấn phân tích AI — thử lại sau ~${Math.ceil(retryMs / 1000)}s.`,
    );
  }
}
