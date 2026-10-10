/**
 * U5 (doc 26 §2.3) — OVERSIGHT / "Hộp phê duyệt" gộp toàn module Kỹ thuật & Điều khiển.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Một query GỘP đếm mọi việc đang chờ trưởng ca (L3) duyệt/xử lý trên toàn tầng
 * Kỹ thuật & Điều khiển, để không phải đi lần lượt Recipes → Interlock →
 * Orchestration → Safety → ECN → Changeover:
 *   • recipe chưa duyệt (draft) — machine_recipes: status='draft' AND approvedBy IS NULL
 *   • recipe ĐANG CHẠY mà chưa duyệt — machine_recipes: status='active' AND approvedBy IS NULL
 *     (doc 80 Phụ lục D RCP-06/HUB-02: bất biến "chỉ chạy recipe đã duyệt" đã vỡ trên dữ
 *     liệu thật — SCRW-RECIPE-01 v2 — và trước bản vá này KHÔNG nhánh nào đếm nó)
 *   • interlock rule chưa duyệt — interlock_rules: approvedBy IS NULL
 *   • sự kiện interlock ĐANG MỞ (chưa resolve) — interlock_events: resolvedAt IS NULL
 *   • run đang chờ        — orchestration_runs: status IN (held, awaiting_confirm)
 *   • sự cố safety chưa audit — safety_events: auditedAt IS NULL
 *   • deadlock đội xe      — trafficManager.detectDeadlocks() cycles
 *   • ECN đang chờ duyệt  — engineering_changes: status IN (submitted, in_review)
 *   • changeover (đổi model / "deployment") đang chờ duyệt — changeover_requests: status='pending'
 *   • doc 81 Đợt 3 Task 4 — `mine`: cùng năm nhóm CHỜ DUYỆT (ECN · recipe nháp · rule · changeover · run) nhưng
 *     CHỈ các mục mà phân công ACTIVE (`engineering_assignments`) trỏ tới người gọi. Vị từ "chờ duyệt" lấy từ
 *     `PENDING_WHERE` (một nguồn cho cả hai phạm vi); không cộng vào `total` (là tập con, không phải nguồn mới).
 *
 * SAFETY / READ-ONLY: chỉ ĐẾM + lấy vài mục mẫu từ dữ liệu sẵn có. KHÔNG duyệt,
 * KHÔNG mutation, KHÔNG mở đường lệnh thiết bị. Mọi cổng quyền/HITL/SoD của từng
 * router đích vẫn giữ nguyên — trang này chỉ điều hướng người dùng tới đó.
 *
 * FAIL-SAFE (bắt buộc): mỗi loại đếm nằm trong try/catch riêng — loại nào lỗi
 * (bảng thiếu, flag off, DB rớt) → count 0 + samples [] + degraded:true, KHÔNG
 * throw. Cả query không bao giờ đổ vỡ vì một nguồn hỏng. Doc 80 Đợt 1 Task 2
 * (HUB-02) — mọi nhánh chạy SONG SONG qua `Promise.all` (trước đây 10 truy vấn
 * TUẦN TỰ — HUB-06).
 *
 * RBAC: machine_monitoring / canView để GỌI được thủ tục này (khớp fleet/
 * orchestration/safety read — mức "biết có việc chờ"). Doc 80 Đợt 1 Task 2
 * (HUB-02 P3) — mức đó KHÔNG đủ để đọc TÊN các mục: một người chỉ có
 * `machine_status` (alias của `machine_monitoring`) chỉ nhận SỐ ĐẾM; TÊN mục
 * (`samples`) chỉ trả khi người gọi cũng có quyền xem THẬT của trang đích
 * (`machine_control` cho recipe/ECN/changeover, `interlock` cho rule/sự kiện) —
 * đúng mức mà `machineRecipeRouter`/`ecnRouter`/`interlockRouter` đòi hỏi.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, desc, eq, inArray, isNull, isNotNull, or, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission, checkPermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import {
  machineRecipes,
  interlockRules,
  interlockEvents,
  orchestrationRuns,
  safetyEvents,
  engineeringChanges,
  changeoverRequests,
  machines,
} from "../../drizzle/schema";
import { detectDeadlocks } from "../services/fleet/trafficManager";
// Fix round 1 (doc 80 Đợt 1 Task 2) — ILK-06: dùng ĐÚNG cùng allowlist action mà cổng
// inline thật sự chặn lệnh (`evaluateInterlockGate`), để "độ phủ interlock" không đếm
// rule chỉ `alert` (không chặn gì) là "có phủ" — chính hình dạng báo-xanh-giả cần tránh.
import { INTERLOCK_GATE_ACTIONS } from "../services/interlock/interlockGate";
// Doc 80 Đợt 1 final wave (item 5) — `posture` đọc CÙNG vị từ mà các cổng thật dùng (không tự parse env):
// OT/auto-block = commandDispatcher · robot = robotCommandDispatcher · deploy = programmingService ·
// engine interlock = interlockEngine. Xem `oversightRouter.test.ts` (lật từng biến ⇒ bảng == cổng).
import { isOtControlEnabled, isInterlockAutoBlockEnabled } from "../services/ot/commandDispatcher";
import { isRobotControlEnabled } from "../services/robot/robotCommandDispatcher";
import { dpcDeployEnabled as isDpcDeployEnabled } from "../services/programming/programmingService";
import { isInterlockEngineEnabled } from "../services/interlock/interlockEngine";
// doc 81 Đợt 3 Task 4 — "Của tôi": vị từ CHỜ DUYỆT dùng chung (một nguồn cho cả "Chờ duyệt" lẫn "Của tôi") +
// đếm theo phân công active (bảng `engineering_assignments`, mig 0363).
import { PENDING_WHERE, fetchMineSummary } from "../services/engineeringAssignment/assignmentService";
import { visibleWorkflowIds } from "../services/orchestration/foe/foeEngine"; // doc 81 Đợt 5 task E fix 1
import { resolveUserFoeScope } from "../services/orchestration/foe/foeScope";
import { ASSIGNABLE, ASSIGNABLE_ENTITY_TYPES, type AssignablePendingKey, type AssignableEntityType } from "@shared/engineeringAssignment";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

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

/**
 * Fix round 1 (doc 80 Đợt 1 Task 2) — `checkPermission` NGOÀI try/catch mâu thuẫn với
 * đúng lời khai của file này ("không nhánh nào được làm vỡ cả query"): nó ném là
 * `pendingSummary` ném theo, mất luôn CẢ chín nhánh chỉ vì một lượt kiểm quyền lỗi.
 * Lỗi ⇒ coi như KHÔNG có quyền xem tên (an toàn hơn: chỉ ẩn tên, KHÔNG hạ đếm/không throw).
 */
async function canSeeNamesSafe(userId: number, userRole: string, moduleName: string): Promise<boolean> {
  try {
    return await checkPermission(userId, userRole, moduleName, "canView");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[oversight] permission check "${moduleName}" failed — ẩn tên, KHÔNG chặn query:`, err instanceof Error ? err.message : err);
    return false;
  }
}

// ── recipe chưa duyệt (draft + chưa có second-approver) ────────────────────────
async function fetchRecipesDraftPending(d: Db, showNames: boolean): Promise<CategoryCount> {
  try {
    const cond = PENDING_WHERE.recipe; // draft AND approvedBy IS NULL
    const [{ c }] = await d.select({ c: sql<number>`count(*)::int` }).from(machineRecipes).where(cond);
    const rows = showNames
      ? await d
          .select({ id: machineRecipes.id, code: machineRecipes.code, name: machineRecipes.name, version: machineRecipes.version })
          .from(machineRecipes)
          .where(cond)
          .orderBy(desc(machineRecipes.createdAt))
          .limit(5)
      : [];
    return {
      count: c ?? 0,
      degraded: false,
      samples: rows.map((r) => ({ id: r.id, label: `${r.code} · ${r.name}`, hint: `v${r.version}` })),
    };
  } catch (err) {
    return degradedCategory(err, "recipes");
  }
}

// ── recipe ĐANG CHẠY (active) mà CHƯA DUYỆT — RCP-06 / HUB-02 ──────────────────
async function fetchRecipesActiveUnapproved(d: Db, showNames: boolean): Promise<CategoryCount> {
  try {
    const cond = and(eq(machineRecipes.status, "active"), isNull(machineRecipes.approvedBy));
    const [{ c }] = await d.select({ c: sql<number>`count(*)::int` }).from(machineRecipes).where(cond);
    const rows = showNames
      ? await d
          .select({
            id: machineRecipes.id,
            code: machineRecipes.code,
            name: machineRecipes.name,
            version: machineRecipes.version,
            machineId: machineRecipes.machineId,
          })
          .from(machineRecipes)
          .where(cond)
          .orderBy(desc(machineRecipes.updatedAt))
          .limit(5)
      : [];
    return {
      count: c ?? 0,
      degraded: false,
      samples: rows.map((r) => ({
        id: r.id,
        label: `${r.code} · ${r.name}`,
        hint: r.machineId != null ? `v${r.version} · #${r.machineId}` : `v${r.version}`,
      })),
    };
  } catch (err) {
    return degradedCategory(err, "recipeActiveUnapproved");
  }
}

// ── interlock rule chưa duyệt (approvedBy IS NULL) ──────────────────────────────
async function fetchInterlockRulesPending(d: Db, showNames: boolean): Promise<CategoryCount> {
  try {
    const cond = PENDING_WHERE.interlock_rule; // approvedBy IS NULL
    const [{ c }] = await d.select({ c: sql<number>`count(*)::int` }).from(interlockRules).where(cond);
    const rows = showNames
      ? await d
          .select({ id: interlockRules.id, name: interlockRules.name, action: interlockRules.action })
          .from(interlockRules)
          .where(cond)
          .orderBy(desc(interlockRules.createdAt))
          .limit(5)
      : [];
    return {
      count: c ?? 0,
      degraded: false,
      samples: rows.map((r) => ({ id: r.id, label: r.name, hint: r.action })),
    };
  } catch (err) {
    return degradedCategory(err, "interlock");
  }
}

// ── sự kiện interlock ĐANG MỞ (chưa resolve) — HUB-02 mới ──────────────────────
async function fetchInterlockEventsOpen(d: Db, showNames: boolean): Promise<CategoryCount> {
  try {
    const cond = isNull(interlockEvents.resolvedAt);
    const [{ c }] = await d.select({ c: sql<number>`count(*)::int` }).from(interlockEvents).where(cond);
    const rows = showNames
      ? await d
          .select({
            id: interlockEvents.id,
            ruleId: interlockEvents.ruleId,
            status: interlockEvents.status,
            action: interlockEvents.action,
          })
          .from(interlockEvents)
          .where(cond)
          .orderBy(desc(interlockEvents.firedAt))
          .limit(5)
      : [];
    return {
      count: c ?? 0,
      degraded: false,
      samples: rows.map((r) => ({ id: r.id, label: `Rule #${r.ruleId}`, hint: r.status ?? r.action ?? undefined })),
    };
  } catch (err) {
    return degradedCategory(err, "interlockEventsOpen");
  }
}

// ── orchestration run đang giữ / chờ xác nhận (KHÔNG đổi hành vi) ──────────────
async function fetchOrchestrationHeld(d: Db, workflowIds: number[] | null): Promise<CategoryCount> {
  try {
    // doc 81 Đợt 5 task E fix 1 (R-5-d, review #2) — count AND samples only over runs whose workflow the caller may see
    // (`visibleWorkflowIds`, null = unrestricted); filtered in SQL, so the count is the caller's count.
    const cond = and(
      PENDING_WHERE.orchestration_run, // status IN (held, awaiting_confirm)
      workflowIds === null ? undefined : inArray(orchestrationRuns.workflowId, workflowIds.length ? workflowIds : [-1]),
    );
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
    return {
      count: c ?? 0,
      degraded: false,
      samples: rows.map((r) => ({
        id: r.id,
        label: r.workflowRef ?? `run #${r.id}`,
        hint: r.currentStepId ? `${r.status} · ${r.currentStepId}` : r.status,
      })),
    };
  } catch (err) {
    return degradedCategory(err, "orchestration");
  }
}

// ── sự cố safety chưa audit (auditedAt IS NULL) — KHÔNG đổi hành vi ────────────
async function fetchSafetyUnaudited(d: Db): Promise<CategoryCount> {
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
    return {
      count: c ?? 0,
      degraded: false,
      samples: rows.map((r) => ({
        id: r.id,
        label: r.eventType,
        hint: r.isNearMiss ? "near-miss" : undefined,
      })),
    };
  } catch (err) {
    return degradedCategory(err, "safety");
  }
}

// ── deadlock đội xe (cycles trong wait-graph) — KHÔNG đổi hành vi ──────────────
// detectDeadlocks() đã tự fail-safe: flag off → { enabled:false, cycles:[] }.
async function fetchDeadlocks(): Promise<CategoryCount> {
  try {
    const { cycles } = await detectDeadlocks();
    return {
      count: cycles.length,
      degraded: false,
      samples: cycles.slice(0, 5).map((cycle, i) => ({
        id: i,
        label: `cycle #${i + 1}`,
        hint: cycle.join(" → "),
      })),
    };
  } catch (err) {
    return degradedCategory(err, "deadlocks");
  }
}

// ── ECN đang chờ duyệt (submitted | in_review) — HUB-02 mới ────────────────────
async function fetchEcnPending(d: Db, showNames: boolean): Promise<CategoryCount> {
  try {
    const cond = PENDING_WHERE.ecn; // status IN (submitted, in_review)
    const [{ c }] = await d.select({ c: sql<number>`count(*)::int` }).from(engineeringChanges).where(cond);
    const rows = showNames
      ? await d
          .select({
            id: engineeringChanges.id,
            ecnKey: engineeringChanges.ecnKey,
            title: engineeringChanges.title,
            status: engineeringChanges.status,
          })
          .from(engineeringChanges)
          .where(cond)
          .orderBy(desc(engineeringChanges.updatedAt))
          .limit(5)
      : [];
    return {
      count: c ?? 0,
      degraded: false,
      samples: rows.map((r) => ({ id: r.id, label: `${r.ecnKey} · ${r.title}`, hint: r.status })),
    };
  } catch (err) {
    return degradedCategory(err, "ecn");
  }
}

// ── changeover (đổi model / "deployment") đang chờ duyệt — HUB-02 mới ──────────
async function fetchChangeoverPending(d: Db, showNames: boolean): Promise<CategoryCount> {
  try {
    const cond = PENDING_WHERE.changeover; // status = 'pending'
    const [{ c }] = await d.select({ c: sql<number>`count(*)::int` }).from(changeoverRequests).where(cond);
    const rows = showNames
      ? await d
          .select({
            id: changeoverRequests.id,
            machineName: machines.name,
            machineCode: machines.code,
            recipeCode: machineRecipes.code,
            recipeVersion: machineRecipes.version,
          })
          .from(changeoverRequests)
          .leftJoin(machines, eq(changeoverRequests.machineId, machines.id))
          .leftJoin(machineRecipes, eq(changeoverRequests.recipeId, machineRecipes.id))
          .where(cond)
          .orderBy(desc(changeoverRequests.createdAt))
          .limit(5)
      : [];
    return {
      count: c ?? 0,
      degraded: false,
      samples: rows.map((r) => ({
        id: r.id,
        label: r.machineName ?? r.machineCode ?? `#${r.id}`,
        hint: r.recipeCode != null ? `${r.recipeCode} v${r.recipeVersion}` : undefined,
      })),
    };
  } catch (err) {
    return degradedCategory(err, "changeover");
  }
}

/** doc 81 Đợt 3 Task 4 — phạm vi "Của tôi": một nhóm cho mỗi loại GIAO ĐƯỢC (`shared/engineeringAssignment.ts`). */
type MineSummary = Record<AssignablePendingKey, CategoryCount>;
function zeroMine(): MineSummary {
  return Object.fromEntries(ASSIGNABLE_ENTITY_TYPES.map((t) => [ASSIGNABLE[t].pendingKey, emptyCategory()])) as MineSummary;
}

const ZERO_SUMMARY = {
  recipes: emptyCategory(),
  recipeActiveUnapproved: emptyCategory(),
  interlock: emptyCategory(),
  interlockEventsOpen: emptyCategory(),
  orchestration: emptyCategory(),
  safety: emptyCategory(),
  deadlocks: emptyCategory(),
  ecn: emptyCategory(),
  changeover: emptyCategory(),
  total: 0,
};

// ── ILK-06 (doc 80 Phụ lục D §6/§7.1) — số rule interlock THỰC SỰ CHẶN ĐƯỢC LỆNH ──
// "Độ phủ interlock" phải khớp CHÍNH XÁC tập rule mà `evaluateInterlockGate` xét
// (`interlockGate.ts:207-215`): enabled + ĐÃ DUYỆT (approvedBy IS NOT NULL) + action nằm
// trong allowlist chặn (`INTERLOCK_GATE_ACTIONS` — không tính `alert`, KHÔNG chặn gì) + có
// đích (targetMachineId/targetAdapterId). Fix round 1 — bản trước chỉ xét enabled+có đích,
// nên một rule `alert` có đích nhưng CHƯA DUYỆT vẫn được đếm là "có phủ" — đúng hình dạng
// báo-xanh-giả mà ILK-06 tồn tại để ngăn (rule đó không chặn được lệnh nào cả).
async function fetchInterlockCoverage(d: Db | null): Promise<{ count: number; degraded: boolean }> {
  if (!d) return { count: 0, degraded: true };
  try {
    const cond = and(
      eq(interlockRules.enabled, true),
      isNotNull(interlockRules.approvedBy),
      // `INTERLOCK_GATE_ACTIONS` is typed `ReadonlySet<string>` (kept broad so
      // `interlockGate.ts#isTargeted`'s `.has(rule.action)` — where `rule.action` is the
      // FULL action enum, including `alert` — still type-checks). Narrow the SPREAD here to
      // the three literal values it actually holds so drizzle's typed enum column accepts it.
      inArray(interlockRules.action, [...INTERLOCK_GATE_ACTIONS] as Array<"block_downstream" | "stop_line" | "reduce_speed">),
      or(isNotNull(interlockRules.targetMachineId), isNotNull(interlockRules.targetAdapterId)),
    );
    const [{ c }] = await d.select({ c: sql<number>`count(*)::int` }).from(interlockRules).where(cond);
    return { count: c ?? 0, degraded: false };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[oversight] posture interlock coverage failed:", err instanceof Error ? err.message : err);
    return { count: 0, degraded: true };
  }
}

export const oversightRouter = router({
  /**
   * Đếm gộp mọi việc đang chờ duyệt/xử lý trên tầng Kỹ thuật & Điều khiển.
   * Fail-safe từng nhánh (chạy SONG SONG qua `Promise.all`); trả về shape ổn định
   * kể cả khi DB rớt. HUB-02 — TÊN mục (`samples`) chỉ trả cho người gọi có quyền
   * xem THẬT của trang đích; người chỉ có `machine_status` nhận SỐ ĐẾM mà thôi.
   */
  pendingSummary: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async ({ ctx }) => {
      const d = await getDb();
      // DB chưa kết nối → trả 0 cho mọi loại (không throw): Hub vẫn render dải trống.
      if (!d) {
        return { ...ZERO_SUMMARY, mine: zeroMine(), generatedAt: new Date().toISOString() };
      }

      // HUB-02 — mức quyền THẬT của trang đích (không phải `machine_status` — mức
      // Hub dùng để GỌI thủ tục này) quyết định ai thấy TÊN mục. Tính MỘT LẦN.
      // Fix round 1 — mỗi lượt kiểm quyền tự bọc try/catch (`canSeeNamesSafe`): lỗi ở
      // đây chỉ ẩn tên, KHÔNG được làm vỡ cả chín nhánh còn lại.
      const [showMachineControlNames, showInterlockNames, orchestrationWorkflowIds] = await Promise.all([
        canSeeNamesSafe(ctx.user.id, ctx.user.role, "machine_control"),
        canSeeNamesSafe(ctx.user.id, ctx.user.role, "interlock"),
        // doc 81 Đợt 5 task E fix 1 (R-5-d) — the orchestration factory scope of the caller (ctx.user only).
        visibleWorkflowIds(resolveUserFoeScope({ id: ctx.user.id, role: String(ctx.user.role) })),
      ]);

      const [
        recipes,
        recipeActiveUnapproved,
        interlock,
        interlockEventsOpen,
        orchestration,
        safety,
        deadlocks,
        ecn,
        changeover,
      ] = await Promise.all([
        fetchRecipesDraftPending(d, showMachineControlNames),
        fetchRecipesActiveUnapproved(d, showMachineControlNames),
        fetchInterlockRulesPending(d, showInterlockNames),
        fetchInterlockEventsOpen(d, showInterlockNames),
        fetchOrchestrationHeld(d, orchestrationWorkflowIds),
        fetchSafetyUnaudited(d),
        fetchDeadlocks(),
        fetchEcnPending(d, showMachineControlNames),
        fetchChangeoverPending(d, showMachineControlNames),
      ]);

      // doc 81 Đợt 3 Task 4 — "Của tôi": mục CÒN chờ duyệt mà phân công active trỏ tới người gọi. Luật tên GIỮ
      // NGUYÊN HUB-02: tên chỉ khi người gọi có quyền xem THẬT của trang đích (cùng cờ với nhánh "Chờ duyệt" tương
      // ứng; orchestration như nhánh cũ — tên luôn trả, cùng mức quyền gọi thủ tục này). Fail-safe từng nhóm.
      const showNamesFor: Record<AssignablePendingKey, boolean> = {
        ecn: showMachineControlNames,
        recipes: showMachineControlNames,
        changeover: showMachineControlNames,
        interlock: showInterlockNames,
        orchestration: true,
      };
      // Final wave (M-5) — MỘT truy vấn cho cả năm loại (trước: 5 lượt đếm + tới 5 lượt mẫu mỗi lần gọi); lỗi ⇒ rơi về
      // đường cũ từng loại (fail-safe từng nhánh giữ nguyên). Kết quả bằng đường cũ — engineeringAssignment.db.test §7.
      const mineByType = await fetchMineSummary(
        d,
        ctx.user.id,
        Object.fromEntries(ASSIGNABLE_ENTITY_TYPES.map((t) => [t, showNamesFor[ASSIGNABLE[t].pendingKey]])) as Record<AssignableEntityType, boolean>,
        orchestrationWorkflowIds, // E fix 1 — "mine" runs filtered by the caller's orchestration scope
      );
      const mine = Object.fromEntries(ASSIGNABLE_ENTITY_TYPES.map((t) => [ASSIGNABLE[t].pendingKey, mineByType[t]])) as MineSummary;

      const total =
        recipes.count +
        recipeActiveUnapproved.count +
        interlock.count +
        interlockEventsOpen.count +
        orchestration.count +
        safety.count +
        deadlocks.count +
        ecn.count +
        changeover.count;

      return {
        recipes,
        recipeActiveUnapproved,
        interlock,
        interlockEventsOpen,
        orchestration,
        safety,
        deadlocks,
        ecn,
        changeover,
        total,
        mine,
        generatedAt: new Date().toISOString(),
      };
    }),

  /**
   * Doc 80 Phụ lục D §6/§7.1 (ILK-06) — "Tư thế an toàn", CHỈ ĐỌC. Đọc trạng thái
   * các cờ ghi lệnh thật (OT/robot/nạp chương trình) + engine interlock ở server,
   * KHÔNG BAO GIỜ trả tên biến `.env` thô ra client (client tự dịch số liệu này
   * thành chữ qua i18n) — client chỉ nhận booleans + một số đếm.
   *
   * `writesOnEngineOff` = true khi CÓ đường ghi lệnh thật đang BẬT (OT hoặc robot)
   * trong khi engine interlock đang TẮT: cổng inline (`commandDispatcher`) vẫn
   * chạy, nhưng KHÔNG rule nào được engine tự động đánh giá/nạp lại theo lịch —
   * Hub phải cảnh báo VÀNG rõ ràng thay vì im lặng (ILK-06).
   */
  posture: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async () => {
      // Final wave item 5 — KHÔNG parse env ở đây: đọc đúng vị từ của từng cổng thật.
      const otControlEnabled = isOtControlEnabled();
      const robotControlEnabled = isRobotControlEnabled();
      const dpcDeployEnabled = isDpcDeployEnabled();
      const interlockEngineEnabled = isInterlockEngineEnabled();
      const interlockAutoBlockEnabled = isInterlockAutoBlockEnabled();

      const d = await getDb();
      const coverage = await fetchInterlockCoverage(d);

      return {
        otControlEnabled,
        robotControlEnabled,
        dpcDeployEnabled,
        interlockEngineEnabled,
        interlockAutoBlockEnabled,
        interlockRulesEnabledWithTarget: coverage.count,
        interlockCoverageDegraded: coverage.degraded,
        // ILK-06 — ghi lệnh thật BẬT (OT hoặc robot) mà engine interlock TẮT.
        writesOnEngineOff: (otControlEnabled || robotControlEnabled) && !interlockEngineEnabled,
        generatedAt: new Date().toISOString(),
      };
    }),
});

// Xuất riêng cho test đơn vị (không đi qua tRPC caller) — mỗi nhánh + đường degraded.
export const _internal = {
  fetchRecipesDraftPending,
  fetchRecipesActiveUnapproved,
  fetchInterlockRulesPending,
  fetchInterlockEventsOpen,
  fetchOrchestrationHeld,
  fetchSafetyUnaudited,
  fetchDeadlocks,
  fetchEcnPending,
  fetchChangeoverPending,
  fetchInterlockCoverage,
  canSeeNamesSafe,
};
