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
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
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
}

export async function resolveFactoryScope(user: Pick<User, "id" | "role">): Promise<FactoryScope> {
  const { factoryCodes, isAdmin } = await getUserAssignmentCodes(user.id, String(user.role));
  return { isGlobal: isAdmin, factoryCodes };
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

  if (scope.factoryCodes.length === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Tài khoản chưa được gán nhà máy nào — không có dữ liệu phân tích để xem.",
    });
  }

  let factoryCode: string;
  if (params.factoryCode) {
    if (!scope.factoryCodes.includes(params.factoryCode)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Nhà máy "${params.factoryCode}" nằm ngoài phạm vi được gán cho tài khoản này.`,
      });
    }
    factoryCode = params.factoryCode;
  } else if (scope.factoryCodes.length === 1) {
    factoryCode = scope.factoryCodes[0];
  } else {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Tài khoản được gán nhiều nhà máy — vui lòng chỉ định factoryCode cụ thể.",
    });
  }

  if (params.machineId != null) {
    const machineFactory = await getMachineFactoryCode(params.machineId);
    if (!machineFactory || !scope.factoryCodes.includes(machineFactory)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Máy được yêu cầu nằm ngoài phạm vi nhà máy được gán cho tài khoản này.",
      });
    }
  }

  if (params.lineCode) {
    const ok = await lineExistsInFactory(params.lineCode, factoryCode);
    if (!ok) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Dây chuyền "${params.lineCode}" không thuộc nhà máy "${factoryCode}".`,
      });
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

  if (scope.factoryCodes.length === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Tài khoản chưa được gán nhà máy nào — không có báo cáo để tạo.",
    });
  }

  if (params.machineId == null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Vui lòng chỉ định machineId thuộc nhà máy được gán cho tài khoản này.",
    });
  }

  const machineFactory = await getMachineFactoryCode(params.machineId);
  if (!machineFactory || !scope.factoryCodes.includes(machineFactory)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Máy được yêu cầu nằm ngoài phạm vi nhà máy được gán cho tài khoản này.",
    });
  }

  if (params.factoryId != null) {
    const factoryCode = await getFactoryCodeById(params.factoryId);
    if (!factoryCode || !scope.factoryCodes.includes(factoryCode)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "factoryId được yêu cầu nằm ngoài phạm vi được gán cho tài khoản này.",
      });
    }
  }
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
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Vượt giới hạn truy vấn phân tích AI — thử lại sau ~${Math.ceil(retryMs / 1000)}s.`,
    });
  }
}
