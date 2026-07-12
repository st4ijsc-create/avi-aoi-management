/**
 * Khối 2 (doc 16 §7) — Fleet orchestrator wiring.  Flag: FLEET_ORCH_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Subscribes to the internal eventBus `order.created` (emitted by the R0 ERP intake,
 * server/api/v1/erpIntake.ts) and DECOMPOSES the production order into one or more
 * `tasks`, then kicks an allocation pass for each. Idempotent: tasks carry a stable
 * `taskKey` (uniqueIndex) so a replayed event never double-creates.
 *
 * DECOMPOSITION:
 *   • G1 (mặc định, FLAG OFF — hành vi cũ GIỮ NGUYÊN byte-for-byte): one
 *     transport+handle task per order — capability `run_job`, taskKey
 *     `order:<orderId>:t1` so a re-emission is a no-op.
 *   • G3.10 (doc 44 W3-B3, cờ FLEET_MULTISTEP_DECOMP_ENABLED — default OFF):
 *     order → NHIỀU task theo operation (pick → transport → dock_handoff) với
 *     DEPENDENCY TUYẾN TÍNH. Bảng `tasks` KHÔNG có cột dependency (đọc schema
 *     drizzle/schema/fleet.ts — quyết định ghi rõ): tuần-tự-hóa bằng TRẠNG THÁI —
 *     task đầu 'pending', các task sau 'blocked' + payload.dependsOnTaskId; khi
 *     task trước done, promoteBlockedSuccessors() (event 'task.completed' + sweep
 *     phòng hộ trong install) đưa task kế về 'pending' rồi allocate. 'blocked' là
 *     varchar status mới NHƯNG vô hình với allocator/drain hiện có (chúng chỉ đọc
 *     pending/assigned/running) — không đổi hành vi G1. Predecessor failed/cancelled
 *     ⇒ successors bị cancel (saga: hủy nhiệm vụ kế, không chạy mù).
 *
 * HANDOFF TO FOE: an assigned task is consumed by a FOE workflow (orchestration
 * router / engine) or a scheduler, which issues the actual device command THROUGH
 * the gated robotCommandDispatcher / commandDispatcher. This module opens NO control
 * path; FOE_ENABLED stays the operator toggle (we do NOT force it on).
 *
 * SAFETY / NO-OP: when FLEET_ORCH_ENABLED is off, the subscriber is still registered
 * (cheap) but the handler returns immediately — zero DB writes.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { tasks, productionOrders } from "../../../drizzle/schema";
import { eventBus, type DomainEvent } from "../../_core/eventBus";
import { fleetOrchEnabled, allocateTask } from "./taskAllocator";

/** doc 44 G3.10 — cờ decomposition đa bước (default OFF → hành vi G1 cũ). */
export function fleetMultistepDecompEnabled(): boolean {
  return (
    process.env.FLEET_MULTISTEP_DECOMP_ENABLED === "true" || process.env.FLEET_MULTISTEP_DECOMP_ENABLED === "1"
  );
}

let installed = false;
const unsubscribers: Array<() => void> = [];
let promoteTimer: ReturnType<typeof setInterval> | null = null;
let promoting = false;

interface OrderCreatedPayload {
  orderId: number;
  orderCode?: string;
  productModelId?: number;
  source?: string;
}

/**
 * Decompose one production order into tasks (idempotent on taskKey). Returns the
 * created/existing task ids. Exposed (and not flag-gated internally) so tests can
 * drive it directly; the eventBus handler below applies the flag gate.
 */
export async function decomposeOrderToTasks(orderId: number): Promise<{ taskIds: number[]; created: number }> {
  const db = await getDb();
  if (!db) return { taskIds: [], created: 0 };

  const [order] = await db.select().from(productionOrders).where(eq(productionOrders.id, orderId)).limit(1);
  if (!order) return { taskIds: [], created: 0 };

  // ── G3.10 (cờ OFF mặc định) — decomposition đa bước pick→transport→dock ─────
  if (fleetMultistepDecompEnabled()) {
    return decomposeOrderMultistep(db, order, orderId);
  }

  // G1 simple decomposition: a single robot handling task per order.
  const taskKey = `order:${orderId}:t1`;
  const [existing] = await db.select().from(tasks).where(eq(tasks.taskKey, taskKey)).limit(1);
  if (existing) return { taskIds: [existing.id], created: 0 };

  const [row] = await db
    .insert(tasks)
    .values({
      taskKey,
      sourceWorkOrderId: orderId,
      requiredCapability: "run_job",
      // Map the order priority (0..N) onto the task 1..5 band (default 3).
      priority: clampPriority(order.priority),
      status: "pending",
      corporateCode: order.companyCode ?? null,
      factoryId: order.factoryId ?? null,
      payload: { orderCode: order.orderCode, productModelId: order.productModelId },
    })
    .returning({ id: tasks.id });
  return { taskIds: row ? [row.id] : [], created: row ? 1 : 0 };
}

// ════════════════════════════════════════════════════════════════════════════
// G3.10 (doc 44 W3-B3) — multi-step decomposition + successor promotion.
// ════════════════════════════════════════════════════════════════════════════

/** Chuỗi operation tuyến tính chuẩn cho một order vận chuyển/xử lý (spec order→goal). */
const MULTISTEP_OPERATIONS = [
  { operation: "pick", suffix: "pick" },
  { operation: "transport", suffix: "transport" },
  { operation: "dock_handoff", suffix: "dock" },
] as const;

type DbHandle = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * Order → 3 task theo operation với dependency tuyến tính bằng TRẠNG THÁI (xem header):
 * task[0]='pending', task[i>0]='blocked' + payload.dependsOnTaskId=task[i-1].id.
 * Idempotent per taskKey; nếu order đã decompose kiểu G1 (`order:<id>:t1`) thì giữ
 * nguyên task cũ (không double-decompose một order sau khi flip cờ).
 */
async function decomposeOrderMultistep(
  db: DbHandle,
  order: typeof productionOrders.$inferSelect,
  orderId: number,
): Promise<{ taskIds: number[]; created: number }> {
  const [legacy] = await db.select().from(tasks).where(eq(tasks.taskKey, `order:${orderId}:t1`)).limit(1);
  if (legacy) return { taskIds: [legacy.id], created: 0 };

  const taskIds: number[] = [];
  let created = 0;
  let prevTaskId: number | null = null;
  for (let i = 0; i < MULTISTEP_OPERATIONS.length; i++) {
    const { operation, suffix } = MULTISTEP_OPERATIONS[i];
    const taskKey = `order:${orderId}:${suffix}`;
    const [existing] = await db.select().from(tasks).where(eq(tasks.taskKey, taskKey)).limit(1);
    if (existing) {
      taskIds.push(existing.id);
      prevTaskId = existing.id;
      continue; // replay idempotent — giữ chain hiện có
    }
    const inserted: Array<{ id: number }> = await db
      .insert(tasks)
      .values({
        taskKey,
        sourceWorkOrderId: orderId,
        requiredCapability: "run_job", // verb robot chuẩn (capabilityModel không có verb pick/transport riêng)
        priority: clampPriority(order.priority),
        // Tuần tự hóa bằng trạng thái: chỉ task đầu chạy được ngay.
        status: i === 0 ? "pending" : "blocked",
        corporateCode: order.companyCode ?? null,
        factoryId: order.factoryId ?? null,
        payload: {
          orderCode: order.orderCode,
          productModelId: order.productModelId,
          operation,
          seq: i + 1,
          chainKey: `order:${orderId}`,
          dependsOnTaskId: prevTaskId,
        },
      })
      .returning({ id: tasks.id });
    const row = inserted[0];
    if (row) {
      taskIds.push(row.id);
      prevTaskId = row.id;
      created += 1;
    }
  }
  if (created > 0) {
    console.log(`[Fleet] order ${orderId} → multi-step decomposition: ${created} task(s) (pick→transport→dock)`);
  }
  return { taskIds, created };
}

export interface PromoteResult {
  ok: boolean;
  enabled: boolean;
  scanned: number;
  promoted: number;
  cancelled: number;
  message?: string;
}

/**
 * Đưa các task 'blocked' có predecessor ĐÃ completed về 'pending' (+ allocate);
 * predecessor failed/cancelled → cancel successor (saga: không chạy bước kế mù).
 * Gọi từ: event 'task.completed' + sweep phòng hộ (event này hiện CHƯA có producer
 * ngoài test — ghi nhận honest trong báo cáo batch) + có thể gọi on-demand.
 * No-op trừ khi CẢ FLEET_ORCH_ENABLED và FLEET_MULTISTEP_DECOMP_ENABLED bật.
 */
export async function promoteBlockedSuccessors(limit = 100): Promise<PromoteResult> {
  if (!fleetOrchEnabled() || !fleetMultistepDecompEnabled()) {
    return { ok: false, enabled: false, scanned: 0, promoted: 0, cancelled: 0, message: "flags off" };
  }
  const db = await getDb();
  if (!db) return { ok: false, enabled: true, scanned: 0, promoted: 0, cancelled: 0, message: "db unavailable" };

  const blocked = await db.select().from(tasks).where(eq(tasks.status, "blocked"));
  const slice = blocked.slice(0, Math.max(0, limit));
  let promoted = 0;
  let cancelled = 0;
  for (const t of slice) {
    try {
      const dep = (t.payload as Record<string, unknown> | null)?.dependsOnTaskId;
      if (typeof dep !== "number") continue; // không rõ dependency — để nguyên (không đoán)
      const [pre] = await db.select().from(tasks).where(eq(tasks.id, dep)).limit(1);
      if (!pre) continue;
      if (pre.status === "completed") {
        await db
          .update(tasks)
          .set({ status: "pending", updatedAt: new Date() })
          .where(eq(tasks.id, t.id));
        promoted += 1;
        console.log(`[Fleet] multistep: task ${t.id} unblocked (predecessor ${dep} completed)`);
        await allocateTask(t.id); // best-effort; không có device → task ở pending, drain sweep nhặt lại
      } else if (pre.status === "failed" || pre.status === "cancelled") {
        await db
          .update(tasks)
          .set({ status: "cancelled", lastError: `predecessor ${dep} ${pre.status}`, updatedAt: new Date() })
          .where(eq(tasks.id, t.id));
        cancelled += 1;
        console.log(`[Fleet] multistep: task ${t.id} cancelled (predecessor ${dep} ${pre.status})`);
      }
    } catch (err) {
      console.error(`[Fleet] multistep promote task ${t.id} failed:`, (err as Error)?.message ?? err);
    }
  }
  return { ok: true, enabled: true, scanned: slice.length, promoted, cancelled };
}

/** eventBus handler — promote successors khi một task done. Flag-gated; never throws. */
async function onTaskCompleted(_e: DomainEvent<{ taskId?: number }>): Promise<void> {
  if (!fleetOrchEnabled() || !fleetMultistepDecompEnabled()) return;
  try {
    await promoteBlockedSuccessors();
  } catch (err) {
    console.error("[Fleet] task.completed promote handler failed:", (err as Error)?.message ?? err);
  }
}

function clampPriority(p: number | null | undefined): number {
  if (p == null) return 3;
  if (p <= 0) return 3; // 0 = "unset" in production_orders → default band
  return Math.max(1, Math.min(5, p));
}

/** eventBus handler — decompose + allocate. Flag-gated; never throws to the bus. */
async function onOrderCreated(e: DomainEvent<OrderCreatedPayload>): Promise<void> {
  if (!fleetOrchEnabled()) return;
  const orderId = e.payload?.orderId;
  if (typeof orderId !== "number") return;
  try {
    const { taskIds, created } = await decomposeOrderToTasks(orderId);
    if (created > 0) console.log(`[Fleet] order ${orderId} → ${created} task(s) created`);
    // Kick an allocation pass for each pending task (best-effort; allocate is gated too).
    for (const id of taskIds) await allocateTask(id);
  } catch (err) {
    console.error(`[Fleet] order.created handler failed for order ${orderId}:`, (err as Error)?.message ?? err);
  }
}

/**
 * Register the fleet subscribers on the eventBus. Idempotent; safe at startup. The
 * handler itself is flag-gated, so registering when the flag is off costs nothing.
 */
export function installFleetOrchestrator(): void {
  if (installed) return;
  installed = true;
  unsubscribers.push(eventBus.subscribe<OrderCreatedPayload>("order.created", onOrderCreated));
  console.log(`[Fleet] orchestrator subscribed to order.created (FLEET_ORCH_ENABLED=${fleetOrchEnabled()})`);

  // G3.10 — promote successors: theo event 'task.completed' + sweep phòng hộ (event
  // hiện chưa có producer prod — poll rẻ, unref'd, non-overlap, self-gated per tick).
  unsubscribers.push(eventBus.subscribe<{ taskId?: number }>("task.completed", onTaskCompleted));
  if (!promoteTimer && fleetOrchEnabled() && fleetMultistepDecompEnabled()) {
    const intervalMs = Math.max(5_000, Number(process.env.FLEET_MULTISTEP_PROMOTE_MS ?? 30_000));
    promoteTimer = setInterval(() => {
      if (promoting) return; // không chồng lượt
      promoting = true;
      void promoteBlockedSuccessors()
        .catch((err) => console.error("[Fleet] multistep promote sweep failed:", (err as Error)?.message ?? err))
        .finally(() => {
          promoting = false;
        });
    }, intervalMs);
    if (typeof promoteTimer.unref === "function") promoteTimer.unref();
    console.log(`[Fleet] multistep promote sweep started (every ${intervalMs}ms)`);
  }
}

/** Tear down subscribers (tests / shutdown). */
export function uninstallFleetOrchestrator(): void {
  while (unsubscribers.length) unsubscribers.pop()!();
  if (promoteTimer) {
    clearInterval(promoteTimer);
    promoteTimer = null;
  }
  promoting = false;
  installed = false;
}
