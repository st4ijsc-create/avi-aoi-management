/**
 * Khối 2 (doc 16 §7) — Fleet orchestrator wiring.  Flag: FLEET_ORCH_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Subscribes to the internal eventBus `order.created` (emitted by the R0 ERP intake,
 * server/api/v1/erpIntake.ts) and DECOMPOSES the production order into one or more
 * `tasks`, then kicks an allocation pass for each. Idempotent: tasks carry a stable
 * `taskKey` (uniqueIndex) so a replayed event never double-creates.
 *
 * DECOMPOSITION (documented, deliberately simple for G1): one transport+handle task
 * per order — capability `run_job` (the canonical robot job verb). A richer
 * routing-aware decomposition (one task per MES operation/step) is deferred to G2
 * (Operation→Skill→Program). The taskKey is `order:<orderId>:t1` so re-emission is a
 * no-op.
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

let installed = false;
const unsubscribers: Array<() => void> = [];

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
}

/** Tear down subscribers (tests / shutdown). */
export function uninstallFleetOrchestrator(): void {
  while (unsubscribers.length) unsubscribers.pop()!();
  installed = false;
}
