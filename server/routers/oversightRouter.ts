/**
 * U5 (doc 26 §2.3) — OVERSIGHT / "Hộp phê duyệt" gộp toàn module Kỹ thuật & Điều khiển.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Một query GỘP đếm mọi việc đang chờ trưởng ca (L3) duyệt/xử lý trên toàn tầng
 * Kỹ thuật & Điều khiển, để không phải đi lần lượt Recipes → Interlock →
 * Orchestration → Safety → Fleet:
 *   • recipe chưa duyệt   — machine_recipes: status='draft' AND approvedBy IS NULL
 *   • interlock chưa duyệt — interlock_rules: approvedBy IS NULL
 *   • run đang chờ        — orchestration_runs: status IN (held, awaiting_confirm)
 *   • sự cố safety chưa audit — safety_events: auditedAt IS NULL
 *   • deadlock đội xe      — trafficManager.detectDeadlocks() cycles
 *
 * SAFETY / READ-ONLY: chỉ ĐẾM + lấy vài mục mẫu từ dữ liệu sẵn có. KHÔNG duyệt,
 * KHÔNG mutation, KHÔNG mở đường lệnh thiết bị. Mọi cổng quyền/HITL/SoD của từng
 * router đích vẫn giữ nguyên — trang này chỉ điều hướng người dùng tới đó.
 *
 * FAIL-SAFE (bắt buộc): mỗi loại đếm nằm trong try/catch riêng — loại nào lỗi
 * (bảng thiếu, flag off, DB rớt) → count 0 + samples [] + degraded:true, KHÔNG
 * throw. Cả query không bao giờ đổ vỡ vì một nguồn hỏng.
 *
 * RBAC: machine_monitoring / canView (khớp fleet/orchestration/safety read).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, desc, eq, isNull, inArray, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import { machineRecipes, interlockRules, orchestrationRuns, safetyEvents } from "../../drizzle/schema";
import { detectDeadlocks } from "../services/fleet/trafficManager";

/** Một mục mẫu tối giản để hiển thị dưới thẻ đếm. */
interface SampleItem {
  id: number;
  /** Nhãn chính (code/name/eventType…) — đã sẵn sàng hiển thị. */
  label: string;
  /** Phụ đề tùy chọn (version/status/thời điểm…). */
  hint?: string;
}

interface CategoryCount {
  count: number;
  samples: SampleItem[];
  /** true khi nguồn này lỗi/không đọc được → đếm 0 nhưng KHÔNG chặn cả query. */
  degraded: boolean;
}

function emptyCategory(): CategoryCount {
  return { count: 0, samples: [], degraded: false };
}

function degradedCategory(err: unknown, tag: string): CategoryCount {
  // eslint-disable-next-line no-console
  console.error(`[oversight] ${tag} count failed:`, err instanceof Error ? err.message : err);
  return { count: 0, samples: [], degraded: true };
}

export const oversightRouter = router({
  /**
   * Đếm gộp mọi việc đang chờ duyệt/xử lý trên tầng Kỹ thuật & Điều khiển.
   * Fail-safe từng nhánh; trả về shape ổn định kể cả khi DB rớt.
   */
  pendingSummary: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async () => {
      const d = await getDb();
      // DB chưa kết nối → trả 0 cho mọi loại (không throw): Hub vẫn render dải trống.
      if (!d) {
        const zero = emptyCategory();
        return {
          recipes: { ...zero },
          interlock: { ...zero },
          orchestration: { ...zero },
          safety: { ...zero },
          deadlocks: { ...zero },
          total: 0,
          generatedAt: new Date().toISOString(),
        };
      }

      // ── recipe chưa duyệt (draft + chưa có second-approver) ──────────────────
      let recipes = emptyCategory();
      try {
        const cond = and(eq(machineRecipes.status, "draft"), isNull(machineRecipes.approvedBy));
        const [{ c }] = await d.select({ c: sql<number>`count(*)::int` }).from(machineRecipes).where(cond);
        const rows = await d
          .select({ id: machineRecipes.id, code: machineRecipes.code, name: machineRecipes.name, version: machineRecipes.version })
          .from(machineRecipes)
          .where(cond)
          .orderBy(desc(machineRecipes.createdAt))
          .limit(5);
        recipes = {
          count: c ?? 0,
          degraded: false,
          samples: rows.map((r) => ({ id: r.id, label: `${r.code} · ${r.name}`, hint: `v${r.version}` })),
        };
      } catch (err) {
        recipes = degradedCategory(err, "recipes");
      }

      // ── interlock rule chưa duyệt (approvedBy IS NULL) ──────────────────────
      let interlock = emptyCategory();
      try {
        const cond = isNull(interlockRules.approvedBy);
        const [{ c }] = await d.select({ c: sql<number>`count(*)::int` }).from(interlockRules).where(cond);
        const rows = await d
          .select({ id: interlockRules.id, name: interlockRules.name, action: interlockRules.action })
          .from(interlockRules)
          .where(cond)
          .orderBy(desc(interlockRules.createdAt))
          .limit(5);
        interlock = {
          count: c ?? 0,
          degraded: false,
          samples: rows.map((r) => ({ id: r.id, label: r.name, hint: r.action })),
        };
      } catch (err) {
        interlock = degradedCategory(err, "interlock");
      }

      // ── orchestration run đang giữ / chờ xác nhận ───────────────────────────
      let orchestration = emptyCategory();
      try {
        const cond = inArray(orchestrationRuns.status, ["held", "awaiting_confirm"]);
        const [{ c }] = await d.select({ c: sql<number>`count(*)::int` }).from(orchestrationRuns).where(cond);
        const rows = await d
          .select({
            id: orchestrationRuns.id,
            workflowRef: orchestrationRuns.workflowRef,
            status: orchestrationRuns.status,
            currentStepId: orchestrationRuns.currentStepId,
          })
          .from(orchestrationRuns)
          .where(cond)
          .orderBy(desc(orchestrationRuns.updatedAt))
          .limit(5);
        orchestration = {
          count: c ?? 0,
          degraded: false,
          samples: rows.map((r) => ({
            id: r.id,
            label: r.workflowRef ?? `run #${r.id}`,
            hint: r.currentStepId ? `${r.status} · ${r.currentStepId}` : r.status,
          })),
        };
      } catch (err) {
        orchestration = degradedCategory(err, "orchestration");
      }

      // ── sự cố safety chưa audit (auditedAt IS NULL) ─────────────────────────
      let safety = emptyCategory();
      try {
        const cond = isNull(safetyEvents.auditedAt);
        const [{ c }] = await d.select({ c: sql<number>`count(*)::int` }).from(safetyEvents).where(cond);
        const rows = await d
          .select({
            id: safetyEvents.id,
            eventType: safetyEvents.eventType,
            isNearMiss: safetyEvents.isNearMiss,
            createdAt: safetyEvents.createdAt,
          })
          .from(safetyEvents)
          .where(cond)
          .orderBy(desc(safetyEvents.createdAt))
          .limit(5);
        safety = {
          count: c ?? 0,
          degraded: false,
          samples: rows.map((r) => ({
            id: r.id,
            label: r.eventType,
            hint: r.isNearMiss ? "near-miss" : undefined,
          })),
        };
      } catch (err) {
        safety = degradedCategory(err, "safety");
      }

      // ── deadlock đội xe (cycles trong wait-graph) ──────────────────────────
      // detectDeadlocks() đã tự fail-safe: flag off → { enabled:false, cycles:[] }.
      let deadlocks = emptyCategory();
      try {
        const { cycles } = await detectDeadlocks();
        deadlocks = {
          count: cycles.length,
          degraded: false,
          samples: cycles.slice(0, 5).map((cycle, i) => ({
            id: i,
            label: `cycle #${i + 1}`,
            hint: cycle.join(" → "),
          })),
        };
      } catch (err) {
        deadlocks = degradedCategory(err, "deadlocks");
      }

      const total =
        recipes.count + interlock.count + orchestration.count + safety.count + deadlocks.count;

      return {
        recipes,
        interlock,
        orchestration,
        safety,
        deadlocks,
        total,
        generatedAt: new Date().toISOString(),
      };
    }),
});
