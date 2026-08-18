/**
 * U2 (doc 21 §6 / §3 G-3) — Ecosystem Command Center: tRPC router.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ONE aggregation router so the Command Center page renders a single pane of glass
 * without hitting 10 routers itself. Every procedure is a THIN wrapper over the
 * commandCenterService aggregation helpers — which in turn REUSE existing services
 * (twin.sceneGraph, oeeService, mesControlTower data, andon/safety stores, federation
 * roll-ups, aiActionInbox, deviceTypeRegistry). NO data is recomputed here.
 *
 * Procedures:
 *   • hierarchy    — nested live tree site→factory→line→station→{machine,robot} with
 *                    status rolled UP + registry-resolved device types + counts.
 *   • kpiSummary   — the command strip (oee/wip/alarms/energy/aiInsights/sites/fleet),
 *                    each field honest-null when its source is disabled/absent.
 *   • recentAlerts — the SEED snapshot for the alarm rail (andon+safety → U1 envelope).
 *                    Live deltas arrive via U1 `alerts:stream` (client subscribes direct).
 *   • status       — the live-vs-poll dependency (ECOSYSTEM_EVENTS_ENABLED) so the page
 *                    can badge "live" vs "polling".
 *
 * RBAC: read-only; every procedure requires machine_monitoring/canView (mirrors
 * twinRouter / fleetRouter / safetyRouter). Tenant scope is honored via the optional
 * `scope.corporateCode` / `scope.factoryId` filter. NO control path, NO writes.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import {
  buildHierarchy,
  buildKpiSummary,
  buildRecentAlerts,
  commandCenterStatus,
} from "../services/ecosystem/commandCenterService";
import { resolveAlertScope, resolveKpiScope } from "../services/ecosystem/commandCenterScope";

const scopeInput = z
  .object({
    factoryId: z.number().int().positive().optional(),
    corporateCode: z.string().max(50).optional(),
  })
  .optional();

export const commandCenterRouter = router({
  /** Live-vs-poll dependency badge (is U1 re-broadcast on?). */
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => commandCenterStatus()),

  /** The whole-ecosystem live hierarchy tree (status rolled UP, registry-driven types). */
  hierarchy: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ scope: scopeInput }).optional())
    .query(async ({ input }) => {
      const tree = await buildHierarchy(input?.scope ?? undefined);
      return { ...tree, status: commandCenterStatus() };
    }),

  /** The KPI command strip — each field sourced from an existing service (honest nulls). */
  kpiSummary: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ scope: scopeInput }).optional())
    .query(async ({ input, ctx }) => {
      const user = { id: ctx.user.id, role: String(ctx.user.role), name: ctx.user.name ?? null };
      // ★★★ 2026-08-18 — `ctx` KHÔNG còn chỉ dùng để đếm hộp thư AI. NĂM ô của dải KPI được
      // thu hẹp theo nhà máy của NGƯỜI XEM (không phải theo `input` — `input` là lời tự khai):
      // `oee` · `wip` · `alarms` · `fleet` lọc theo phạm vi, `sites` fail-closed vì không
      // phân giải được về nhà máy (xem docblock `buildKpiSummary`).
      //
      // ⚠ `resolveKpiScope` chứ KHÔNG phải `resolveAlertScope`: cùng luật phạm vi, nhưng câu
      // rỗng phải nói về CẢ DẢI KPI. Câu của họ báo động chỉ nhắc "danh sách báo động trống",
      // đặt dưới một dải mà OEE hiện 0% và WIP hiện 0 thì thành khai THIẾU.
      const tenant = await resolveKpiScope({ id: ctx.user.id, role: String(ctx.user.role) });
      const summary = await buildKpiSummary(user, input?.scope ?? undefined, {
        factoryIds: tenant.factoryIds,
        // Danh tính đi kèm CHỈ để ô `oee` gọi lại cổng RIÊNG của `oeeService` — không phải
        // để dựng thêm một bộ luật phạm vi thứ hai ở tầng này.
        userId: ctx.user.id,
        userRole: String(ctx.user.role),
      });
      // ⚠ Trải `tenant.labels` (đúng BA ô chữ), TUYỆT ĐỐI không trải `tenant`/`resolveDataScope`:
      // ô `filter` là SQL drizzle có tham chiếu vòng ⇒ superjson chết `Converting circular
      // structure to JSON` ⇒ 500 cho MỌI người dùng (đã xảy ra thật 2026-08-17 ở
      // `dashboard.getStats`, sống sót qua `tsc` sạch cả hai config + 220 ca xanh).
      return { ...summary, status: commandCenterStatus(), ...tenant.labels };
    }),

  /** Seed alert snapshot for the rail (live deltas come from U1 `alerts:stream`). */
  recentAlerts: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ scope: scopeInput, limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const tenant = await resolveAlertScope({ id: ctx.user.id, role: String(ctx.user.role) });
      const alerts = await buildRecentAlerts({
        limit: input?.limit,
        corporateCode: input?.scope?.corporateCode ?? null,
        factoryIds: tenant.factoryIds,
      });
      // Ba ô nhãn để màn hình KHÔNG được phép trình bày phạm vi rỗng thành "không có cảnh
      // báo nào" — trên rail báo động, câu ấy người vận hành đọc thành "đang yên ổn".
      return { alerts, status: commandCenterStatus(), ...tenant.labels };
    }),
});
