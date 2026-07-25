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
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import type { TrpcContext } from "../_core/context";
import { getExecutiveSummaries, runExecutiveReportNow } from "../services/aiExecutiveReport";
import { getExecutiveReportSchedulerStatus } from "../services/reportScheduler";
import { enforceAnalyticsFactoryScope, enforceAiAnalyticsRateLimit } from "../_core/aiAnalyticsScope";

const periodEnum = z.enum(["shift", "day", "week"]);
const langEnum = z.enum(["vi", "en"]);

/**
 * Resolve the caller's factory scope for a read endpoint that takes NO client-supplied
 * factoryCode (list/latest/schedulerStatus never accepted one — the factory is always
 * derived from the caller's own assignment, never chosen by them):
 *  - admin (global) → `{ factoryCode: undefined }` — unrestricted, unchanged behavior.
 *  - scoped, exactly ONE assigned factory → silently narrowed to it (mirrors
 *    `enforceAnalyticsFactoryScope`'s rule for aiInspectionAnalyticsRouter — unambiguous,
 *    zero-friction, zero leakage).
 *  - scoped, 0 or >1 assigned factories → FORBIDDEN (ambiguous / no access; there is no
 *    per-call way to pick one, and never guess).
 * Also enforces the per-user rate limit (dedicated `ai_analytics_report` bucket, same as
 * every other AI analytics/report endpoint T3 touched) BEFORE the (DB-hitting) scope
 * check, consistent with the sibling routers.
 */
async function applyExecutiveReportReadScope(ctx: {
  user: TrpcContext["user"];
}): Promise<{ factoryCode?: string }> {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Login required" });
  }
  enforceAiAnalyticsRateLimit(ctx.user.id);
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
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const { factoryCode } = await applyExecutiveReportReadScope(ctx);
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
    .input(z.object({ period: periodEnum.optional() }).optional())
    .query(async ({ input, ctx }) => {
      const { factoryCode } = await applyExecutiveReportReadScope(ctx);
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
