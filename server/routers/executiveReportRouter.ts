/**
 * Phase B4.3 — Executive Report router.
 *
 * Read access to persisted AI executive summaries (shift/day/week) plus an
 * admin-only manual trigger to generate one on demand (for testing without
 * waiting for the cron scheduler). Generation/persistence logic lives in
 * services/aiExecutiveReport.ts; this router is a thin tRPC surface for the UI.
 *
 * doc 69 T9 (security fast-follow, mirrors Wave-0 T3) — STEP 0 found `list`/`latest`
 * were `protectedProcedure` with NO ownership check: `getExecutiveSummaries` (the
 * service) reads persisted `ai_insights` rows with no factory filter at all, so ANY
 * authenticated user — including a factory-scoped one — could read every factory's
 * executive/management data. Consumer: client/src/pages/ManagementInsight.tsx, whose
 * route is explicitly "read-open to all roles" (doc 69 T6, App.tsx comment) — NOT just
 * managers/supervisors — and whose own UI copy ("Chỉ quản trị viên mới có thể tạo báo
 * cáo. Hiển thị báo cáo gần nhất (chỉ đọc).") already promises every role a read-only
 * view of the latest report. Admin-only (T3's fix for the analogous inherently-global
 * `aiReportRouter.executiveSummary`) would break that explicit product intent, so this
 * task closes the leak with REAL factory-scoping instead (see aiExecutiveReport.ts for
 * how the KPI bundle itself was made factory-filterable) — reusing T3's
 * `enforceAnalyticsFactoryScope`/`enforceAiAnalyticsRateLimit`
 * (server/_core/aiAnalyticsScope.ts) exactly as-is, no new authorization model.
 *
 * doc 69 T9 REVIEW FIX (Important) — `list`/`latest` called the scope helper with NO
 * factoryCode input at all, so per `enforceAnalyticsFactoryScope`'s ambiguity rule ANY
 * non-admin caller assigned to >1 factory, OR assigned only at the corporate level, hit
 * FORBIDDEN on every call — including on page MOUNT (`ManagementInsight.tsx`,
 * `controlTower/panels.tsx`, `ExecutiveMobile.tsx` all call `latest` with no input). Fix:
 * (a) accept an OPTIONAL `factoryCode` input on both, validated against the caller's scope
 * exactly like `aiInspectionAnalyticsRouter` does (out-of-scope → FORBIDDEN, the leak stays
 * closed); (b) when a non-admin supplies none AND is ambiguous (multi-factory/corporate),
 * default to their FIRST in-scope factory (`firstFactoryCodeInScope`, deterministic)
 * instead of throwing — the page renders THEIR OWN data instead of hard-erroring. Single-
 * factory managers and admin are unaffected (unchanged paths).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import type { TrpcContext } from "../_core/context";
import { getExecutiveSummaries, runExecutiveReportNow } from "../services/aiExecutiveReport";
import { getExecutiveReportSchedulerStatus } from "../services/reportScheduler";
import {
  enforceAnalyticsFactoryScope,
  enforceAiAnalyticsRateLimit,
  resolveFactoryScope,
  firstFactoryCodeInScope,
} from "../_core/aiAnalyticsScope";

const periodEnum = z.enum(["shift", "day", "week"]);
const langEnum = z.enum(["vi", "en"]);

/**
 * Resolve the caller's factory scope for `list`/`latest` (`schedulerStatus` still takes no
 * factoryCode — no business data to scope):
 *  - admin (global) → `{ factoryCode: undefined }` — unrestricted, unchanged behavior
 *    (an explicit `factoryCode` from an admin is passed through unvalidated, same as
 *    `enforceAnalyticsFactoryScope`'s existing admin rule elsewhere).
 *  - explicit `factoryCode` supplied (non-admin) → validated against the caller's scope
 *    via `enforceAnalyticsFactoryScope` (in-scope, including corporate-owned → used;
 *    out-of-scope → FORBIDDEN). The leak stays closed: an out-of-scope factoryCode never
 *    reaches the service.
 *  - no `factoryCode`, exactly ONE assigned factory → silently narrowed to it (unchanged —
 *    unambiguous, zero-friction, zero leakage).
 *  - no `factoryCode`, 0 factories AND 0 corporate assignments → FORBIDDEN (no access at
 *    all; defers to `enforceAnalyticsFactoryScope` for the exact message).
 *  - no `factoryCode`, ambiguous (>1 assigned factory, or corporate-only) → doc 69 T9
 *    REVIEW FIX: default to the caller's FIRST in-scope factory
 *    (`firstFactoryCodeInScope`, deterministic) instead of throwing FORBIDDEN. Before this
 *    fix every multi-factory manager and every corporate-only exec hard-errored on mount
 *    (`ManagementInsight.tsx`/`controlTower/panels.tsx`/`ExecutiveMobile.tsx` all call
 *    `latest` with no input). This can only ever resolve to one of the caller's OWN
 *    factories — never another's, never the unscoped/global view — so the leak stays
 *    closed. TODO(doc69 Wave 2): factory picker for multi-factory exec reports.
 * Also enforces the per-user rate limit (dedicated `ai_analytics_report` bucket, same as
 * every other AI analytics/report endpoint T3 touched) BEFORE the (DB-hitting) scope
 * check, consistent with the sibling routers.
 */
async function applyExecutiveReportReadScope(
  ctx: { user: TrpcContext["user"] },
  input?: { factoryCode?: string },
): Promise<{ factoryCode?: string }> {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Login required" });
  }
  enforceAiAnalyticsRateLimit(ctx.user.id);

  if (input?.factoryCode) {
    return enforceAnalyticsFactoryScope({ user: ctx.user, factoryCode: input.factoryCode });
  }

  const scope = await resolveFactoryScope(ctx.user);
  if (scope.isGlobal) return { factoryCode: undefined };
  if (scope.factoryCodes.length === 1) return { factoryCode: scope.factoryCodes[0] };

  const defaultFactoryCode = await firstFactoryCodeInScope(scope);
  if (defaultFactoryCode) return { factoryCode: defaultFactoryCode };

  // Nothing resolvable (0 factories + 0 corporates, or a corporate owning no factories) —
  // defer to the shared helper for the exact FORBIDDEN behavior/message.
  return enforceAnalyticsFactoryScope({ user: ctx.user });
}

export const executiveReportRouter = router({
  /** List persisted executive summaries (latest first), optionally by period. */
  list: protectedProcedure
    .input(
      z
        .object({
          period: periodEnum.optional(),
          limit: z.number().min(1).max(100).default(20),
          // doc 69 T9 review fix — OPTIONAL, validated against the caller's scope in
          // `applyExecutiveReportReadScope` (out-of-scope → FORBIDDEN, never trusted
          // as-is). Omitted → admin sees everything; non-admin defaults per the scope
          // helper (single factory silently, ambiguous → first in-scope factory).
          factoryCode: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const { factoryCode } = await applyExecutiveReportReadScope(ctx, { factoryCode: input?.factoryCode });
      // factoryCode undefined (admin) → every row, exactly as before this task.
      // factoryCode set (scoped) → only rows tagged for THIS caller's factory; existing
      // (pre-task) rows carry no factory tag at all, so they never match and stay
      // invisible to a scoped caller — the leak is closed for ALL history, not just new
      // rows. NOTE (known limitation, see report): unlike `latest` below, `list` does
      // NOT auto-generate — a scoped caller's history only grows as their own `latest`
      // reads populate it, until a scheduler-side per-factory fan-out (Wave 2) exists.
      return getExecutiveSummaries({ period: input?.period, limit: input?.limit ?? 20, factoryCode });
    }),

  /** Latest single summary (optionally for a period). */
  latest: protectedProcedure
    .input(
      z
        .object({
          period: periodEnum.optional(),
          // doc 69 T9 review fix — see `list`'s identical field for the rationale.
          factoryCode: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const { factoryCode } = await applyExecutiveReportReadScope(ctx, { factoryCode: input?.factoryCode });
      const period = input?.period;
      const rows = await getExecutiveSummaries({ period, limit: 1, factoryCode });
      if (rows[0]) return rows[0];
      if (!factoryCode) return null; // global/admin: nothing generated yet — unchanged.
      // Factory-scoped caller with nothing persisted for their factory/period yet:
      // compute one now so "latest" isn't permanently empty for non-admin roles (doc 69
      // T6 — this workspace is read-open to all roles, not just admin). Cheap + safe:
      //  - skipLlm — rule-based summary only, no deep-model inference triggered by a
      //    mere page view (avoids GPU contention with other AI features).
      //  - notify:false — resolveExecReportRecipients is role-based, NOT factory-aware
      //    (see aiExecutiveReport.ts), so notifying here would broadcast to every
      //    admin/supervisor system-wide for a report a low-privilege READ triggered.
      // Persisted (tagged with this factoryCode) so it also appears in this factory's
      // `list` history and a subsequent `latest` read doesn't recompute.
      await runExecutiveReportNow(period ?? "day", undefined, factoryCode, { notify: false, skipLlm: true });
      const generated = await getExecutiveSummaries({ period, limit: 1, factoryCode });
      return generated[0] ?? null;
    }),

  /** Scheduler + flag status for dashboards. No factory-scoped business data returned. */
  schedulerStatus: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Login required" });
    }
    enforceAiAnalyticsRateLimit(ctx.user.id);
    return getExecutiveReportSchedulerStatus();
  }),

  /** Admin-only: generate + persist a report immediately (manual trigger / testing). */
  generateNow: adminProcedure
    .input(
      z
        .object({
          period: periodEnum.default("day"),
          lang: langEnum.optional(),
        })
        .optional(),
    )
    .mutation(async ({ input }) => {
      return runExecutiveReportNow(input?.period ?? "day", input?.lang);
    }),
});
