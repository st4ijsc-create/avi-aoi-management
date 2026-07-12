/**
 * W3-A3 (doc 44 G3.6 + G3.7) — ORDER LIFECYCLE state machine + line allocation.
 * SYNAPSE LDS-L3: §8.2 (order lifecycle) · §9.1 (phân bổ & giữ chỗ) · §13.1
 * (Orchestration API — served by api/v1/ordersLifecycle + orderLifecycleRouter).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LAYERED LIFECYCLE (the batch's core constraint): the legacy
 * production_orders.status enum (pending/in_progress/completed/cancelled/paused)
 * is NOT changed — clients and station software keep reading it. The §8.2
 * lifecycle lives in the NEW nullable lifecycle_state column (mig 0258):
 *
 *   CREATED ─▶ ALLOCATED ─▶ RUNNING ⇄ HELD ─▶ DONE
 *      │           │           │
 *      │           │           └─(lỗi)─▶ COMPENSATING ─▶ FAILED
 *      └───────────┴─(không phân bổ được)─▶ REJECTED
 *
 * PROJECTION (explicit, both directions):
 *   lifecycle → legacy status (written on every transition, keeps old clients alive):
 *     created/allocated → pending · running → in_progress · held → paused ·
 *     done → completed · compensating/failed/rejected → cancelled
 *   legacy status → effective lifecycle (read-side, for rows with NULL lifecycle_state):
 *     pending → created · in_progress → running · paused → held ·
 *     completed → done · cancelled → failed
 *
 * ALLOCATION LOCKING DECISION (G3.7 §9.1, đọc kỹ schema rồi chọn — ghi rõ):
 *   resource_reservations (fleetResource.ts) carries the partial unique index
 *   uq_res_res_active_resource = at most ONE active reservation per resource
 *   (capacity-1 semantics for jigs/grippers). A production line allows
 *   maxConcurrentOrders > 1, so that table CANNOT model line reservations —
 *   a second concurrent order would violate the unique index. Instead:
 *     • SELECT ... FOR UPDATE on the production_lines row(s) is the allocation
 *       MUTEX (auto-select locks all candidates in stable id order → deadlock-free);
 *     • occupancy is COUNTED inside the same transaction: orders on the line in
 *       an occupying state (lifecycle allocated|running|held, or legacy NULL with
 *       status in_progress|paused);
 *     • occupancy is therefore DERIVED from order lifecycle states — cancel /
 *       compensation frees the slot by the state change itself; there is no
 *       reservation row to clean up (no orphan risk).
 *   Two concurrent allocates against a max=1 line serialize on the row lock;
 *   the loser counts occupied ≥ max and the order is REJECTED per spec §8.2.
 *
 * POLICY SEAM: every transition is checked through evaluateCommandPolicy with
 * action `order.command.{toState}` (backward-compat seam — the W3-A1 policy
 * engine upgrade plugs in behind it). Deny → policy_denied, nothing written.
 *
 * COMPENSATION v1 (§18.2): running/held → compensating → failed in one call.
 * Business-level compensation steps (FOE templates) are W3-B — honestly out of
 * scope here; v1 releases the line implicitly (derived occupancy, see above).
 *
 * HOÀN CÔNG (§10.1 QT-1 step 4): → done fires publishOrderCompletion via the
 * durable ERP outbox (existing "production-event" family, idempotent per order).
 *
 * FLAG: ORDER_LIFECYCLE_ENABLED (default OFF). All WRITE paths refuse when off
 * (order_lifecycle_disabled, 503) — also protects an un-migrated DB (0258).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  productionOrders,
  productionLines,
  orderStateTransitions,
  productInspections,
} from "../../../drizzle/schema";
import { evaluateCommandPolicy } from "../security/policyGate";
import { getCorrelationId } from "../observability/correlation";
import { eventBus } from "../../_core/eventBus";
import { publishOrderCompletion } from "../integration/outboxProducers";

// ── Flag ──────────────────────────────────────────────────────────────────────

/** True when the order-lifecycle layer is enabled (default OFF for safety). */
export function orderLifecycleEnabled(): boolean {
  return process.env.ORDER_LIFECYCLE_ENABLED === "true" || process.env.ORDER_LIFECYCLE_ENABLED === "1";
}

// ── States, transition map, projections (spec §8.2 — explicit) ───────────────

export const ORDER_LIFECYCLE_STATES = [
  "created",
  "allocated",
  "running",
  "held",
  "compensating",
  "done",
  "failed",
  "rejected",
] as const;
export type OrderLifecycleState = (typeof ORDER_LIFECYCLE_STATES)[number];

/** Legacy production_orders.status enum values (drizzle statusEnum). */
export type LegacyOrderStatus = "pending" | "in_progress" | "completed" | "cancelled" | "paused";

/** Valid transitions per spec §8.2. Terminal states have no exits. */
export const LIFECYCLE_TRANSITIONS: Readonly<Record<OrderLifecycleState, readonly OrderLifecycleState[]>> = {
  created: ["allocated", "rejected"],
  allocated: ["running", "rejected"],
  running: ["held", "done", "compensating"],
  held: ["running", "done", "compensating"],
  compensating: ["failed"],
  done: [],
  failed: [],
  rejected: [],
};

export const TERMINAL_LIFECYCLE_STATES: ReadonlySet<OrderLifecycleState> = new Set(["done", "failed", "rejected"]);

/** lifecycle → legacy status (write-side projection; keeps old clients alive). */
export const LIFECYCLE_TO_LEGACY_STATUS: Readonly<Record<OrderLifecycleState, LegacyOrderStatus>> = {
  created: "pending",
  allocated: "pending",
  running: "in_progress",
  held: "paused",
  compensating: "cancelled",
  done: "completed",
  failed: "cancelled",
  rejected: "cancelled",
};

/** legacy status → effective lifecycle (read-side projection for NULL lifecycle_state). */
export const LEGACY_STATUS_TO_LIFECYCLE: Readonly<Record<LegacyOrderStatus, OrderLifecycleState>> = {
  pending: "created",
  in_progress: "running",
  paused: "held",
  completed: "done",
  cancelled: "failed",
};

/** States that OCCUPY a line capacity slot (allocation §9.1 — derived occupancy). */
export const OCCUPYING_LIFECYCLE_STATES: readonly OrderLifecycleState[] = ["allocated", "running", "held"];
/** Legacy statuses (lifecycle_state NULL) that occupy a slot: projections of running/held. */
export const OCCUPYING_LEGACY_STATUSES: readonly LegacyOrderStatus[] = ["in_progress", "paused"];

/** Project a lifecycle state down to the legacy status enum (total mapping). */
export function projectLegacyStatus(state: OrderLifecycleState): LegacyOrderStatus {
  return LIFECYCLE_TO_LEGACY_STATUS[state];
}

/**
 * The EFFECTIVE lifecycle of an order row: lifecycle_state when present, else
 * the read-side projection of the legacy status (never null — unknown legacy
 * values conservatively project to "created").
 */
export function effectiveLifecycleState(order: { lifecycleState?: string | null; status: string }): OrderLifecycleState {
  const raw = order.lifecycleState;
  if (raw && (ORDER_LIFECYCLE_STATES as readonly string[]).includes(raw)) return raw as OrderLifecycleState;
  return LEGACY_STATUS_TO_LIFECYCLE[order.status as LegacyOrderStatus] ?? "created";
}

/** Is `from → to` a valid spec-§8.2 transition? (Same-state is NOT valid.) */
export function canTransition(from: OrderLifecycleState, to: OrderLifecycleState): boolean {
  return (LIFECYCLE_TRANSITIONS[from] ?? []).includes(to);
}

// ── Errors ────────────────────────────────────────────────────────────────────

/** Typed lifecycle error → mapped to HTTP/tRPC codes by the API layers. */
export class OrderLifecycleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number = 400,
  ) {
    super(message);
    this.name = "OrderLifecycleError";
  }
}

function ensureEnabled(): void {
  if (!orderLifecycleEnabled()) {
    throw new OrderLifecycleError(
      "order_lifecycle_disabled",
      "Order lifecycle is disabled (ORDER_LIFECYCLE_ENABLED, default OFF; requires migration 0258).",
      503,
    );
  }
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type OrderRow = typeof productionOrders.$inferSelect;

async function requireDb(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new OrderLifecycleError("db_unavailable", "Database not connected.", 500);
  return db;
}

// ── Core transition (in-transaction) ─────────────────────────────────────────

export interface TransitionOptions {
  reason?: string;
  /** Actor tag ("erp-intake", "api-key:<name>", "user:<id>"…). Default "system". */
  actor?: string;
  /** Correlation id; defaults to the ALS context (observability/correlation). */
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export interface AppliedTransition {
  transitionId: number;
  from: OrderLifecycleState;
  to: OrderLifecycleState;
  legacyStatus: LegacyOrderStatus;
  reason: string | null;
  correlationId: string | null;
}

/** Lock the order row FOR UPDATE inside `tx`; 404 when missing. */
async function lockOrder(tx: Tx, orderId: number): Promise<OrderRow> {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw new OrderLifecycleError("bad_request", "Invalid order id.", 400);
  }
  const [order] = await tx
    .select()
    .from(productionOrders)
    .where(eq(productionOrders.id, orderId))
    .for("update")
    .limit(1);
  if (!order) throw new OrderLifecycleError("not_found", `Order ${orderId} not found.`, 404);
  return order as OrderRow;
}

/**
 * Validate + apply one transition INSIDE an open transaction: policy seam →
 * update lifecycle_state + PROJECTED legacy status (+ actual dates) → append
 * the audit row. Throws OrderLifecycleError; writes nothing on failure
 * (validation and policy run before any statement).
 */
async function applyTransitionInTx(
  tx: Tx,
  order: OrderRow,
  to: OrderLifecycleState,
  opts: TransitionOptions,
): Promise<AppliedTransition> {
  const from = effectiveLifecycleState(order);
  if (!canTransition(from, to)) {
    throw new OrderLifecycleError(
      "invalid_transition",
      `Order ${order.id}: transition "${from}" → "${to}" is not allowed (spec §8.2).`,
      409,
    );
  }

  // Policy seam (W3-A1 engine plugs in behind evaluateCommandPolicy).
  const verdict = evaluateCommandPolicy({
    action: `order.command.${to}`,
    orderId: order.id,
    orderCode: order.orderCode,
    fromState: from,
    toState: to,
    actor: opts.actor ?? "system",
    reason: opts.reason,
  });
  if (!verdict.allow) {
    throw new OrderLifecycleError("policy_denied", `Policy denied order.command.${to}: ${verdict.reason}`, 403);
  }

  const now = new Date();
  const legacyStatus = projectLegacyStatus(to);
  await tx
    .update(productionOrders)
    .set({
      lifecycleState: to,
      status: legacyStatus,
      updatedAt: now,
      // Legacy-friendly niceties: first entry into running stamps the actual
      // start; entering a terminal state stamps the actual end (only when unset).
      ...(to === "running" && !order.actualStartDate ? { actualStartDate: now } : {}),
      ...(TERMINAL_LIFECYCLE_STATES.has(to) && !order.actualEndDate ? { actualEndDate: now } : {}),
    })
    .where(eq(productionOrders.id, order.id));

  const correlationId = opts.correlationId ?? getCorrelationId() ?? null;
  const [row] = await tx
    .insert(orderStateTransitions)
    .values({
      orderId: order.id,
      fromState: from,
      toState: to,
      reason: opts.reason ?? null,
      triggeredBy: opts.actor ?? "system",
      correlationId,
      metadata: opts.metadata ?? null,
    })
    .returning({ id: orderStateTransitions.id });

  return {
    transitionId: row?.id ?? 0,
    from,
    to,
    legacyStatus,
    reason: opts.reason ?? null,
    correlationId,
  };
}

/** Post-commit side effects: eventBus + hoàn công outbox on → done. Fail-safe. */
function emitTransitionEffects(order: OrderRow, applied: AppliedTransition): void {
  try {
    eventBus.publish(
      "order.lifecycle.transitioned",
      {
        orderId: order.id,
        orderCode: order.orderCode,
        from: applied.from,
        to: applied.to,
        legacyStatus: applied.legacyStatus,
        reason: applied.reason,
        correlationId: applied.correlationId,
      },
      "order-lifecycle",
    );
  } catch (err) {
    console.error("[orderLifecycle] eventBus publish failed:", (err as Error)?.message ?? err);
  }
  if (applied.to === "done") {
    try {
      // Hoàn công về ERP (spec §10.1 QT-1 bước 4) — durable outbox, idempotent per order.
      publishOrderCompletion({
        orderId: order.id,
        orderCode: order.orderCode,
        productModelId: order.productModelId,
        targetQuantity: order.targetQuantity,
        completedQuantity: order.completedQuantity,
        okQuantity: order.okQuantity,
        ngQuantity: order.ngQuantity,
        correlationId: applied.correlationId,
        corporateCode: order.companyCode,
      });
    } catch (err) {
      console.error("[orderLifecycle] completion outbox publish failed:", (err as Error)?.message ?? err);
    }
  }
}

// ── Public API: generic transition ────────────────────────────────────────────

export interface TransitionResult {
  orderId: number;
  from: OrderLifecycleState;
  to: OrderLifecycleState;
  legacyStatus: LegacyOrderStatus;
  transitionId: number;
}

/**
 * Move an order to `to` (validated against the §8.2 map, policy-gated,
 * transactional: order row + audit row commit together).
 */
export async function transitionOrder(
  orderId: number,
  to: OrderLifecycleState,
  opts: TransitionOptions = {},
): Promise<TransitionResult> {
  ensureEnabled();
  if (!(ORDER_LIFECYCLE_STATES as readonly string[]).includes(to)) {
    throw new OrderLifecycleError("invalid_state", `Unknown lifecycle state "${to}".`, 400);
  }
  const db = await requireDb();
  const { order, applied } = await db.transaction(async (tx) => {
    const lockedOrder = await lockOrder(tx, orderId);
    const appliedTransition = await applyTransitionInTx(tx, lockedOrder, to, opts);
    return { order: lockedOrder, applied: appliedTransition };
  });
  emitTransitionEffects(order, applied);
  return {
    orderId: order.id,
    from: applied.from,
    to: applied.to,
    legacyStatus: applied.legacyStatus,
    transitionId: applied.transitionId,
  };
}

/** Hold a running order (spec §13.1 /orders/{id}/hold). */
export async function holdOrder(orderId: number, opts: TransitionOptions = {}): Promise<TransitionResult> {
  return transitionOrder(orderId, "held", { ...opts, reason: opts.reason ?? "hold requested" });
}

/** Resume a held order (spec §13.1 /orders/{id}/resume). */
export async function resumeOrder(orderId: number, opts: TransitionOptions = {}): Promise<TransitionResult> {
  return transitionOrder(orderId, "running", { ...opts, reason: opts.reason ?? "resume requested" });
}

// ── Allocation (§9.1 v1 — simple least-loaded, NOT CP-SAT/APS) ───────────────

/** Orders occupying a slot on `lineId` (see OCCUPYING_* — derived occupancy). */
async function countLineOccupancy(tx: Tx, lineId: number): Promise<number> {
  const rows = await tx
    .select({ id: productionOrders.id })
    .from(productionOrders)
    .where(
      and(
        eq(productionOrders.lineId, lineId),
        or(
          inArray(productionOrders.lifecycleState, [...OCCUPYING_LIFECYCLE_STATES]),
          and(
            isNull(productionOrders.lifecycleState),
            inArray(productionOrders.status, [...OCCUPYING_LEGACY_STATUSES]),
          ),
        ),
      ),
    );
  return rows.length;
}

export interface AllocateOptions extends TransitionOptions {
  /** Explicit target line; omitted → least-loaded active line in the order's workshop. */
  lineId?: number;
}

export interface AllocateResult {
  orderId: number;
  /** True when the order reached ALLOCATED; false → REJECTED (terminal, per spec). */
  allocated: boolean;
  state: "allocated" | "rejected";
  lineId?: number;
  strategy?: "requested" | "least-loaded";
  reason?: string;
  capacity?: { max: number; occupied: number };
  transitionId: number;
}

/**
 * Allocate a CREATED order to a line (§9.1): explicit line → capacity-validated;
 * no line → least-loaded active line with free capacity in the order's workshop.
 * Race-safe via FOR UPDATE on production_lines rows (see header DECISION).
 * Capacity exhausted → the order is REJECTED (terminal) with a reason, per §8.2.
 * A nonexistent/inactive requested line throws (400-family) WITHOUT consuming
 * the order — a caller typo must not kill it.
 */
export async function allocateOrder(orderId: number, opts: AllocateOptions = {}): Promise<AllocateResult> {
  ensureEnabled();
  const db = await requireDb();

  const outcome = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    const from = effectiveLifecycleState(order);
    if (from !== "created") {
      throw new OrderLifecycleError(
        "invalid_transition",
        `Order ${orderId} is "${from}" — only a "created" order can be allocated.`,
        409,
      );
    }

    // ── Explicit line requested ────────────────────────────────────────────
    if (opts.lineId != null) {
      const [line] = await tx
        .select()
        .from(productionLines)
        .where(eq(productionLines.id, opts.lineId))
        .for("update")
        .limit(1);
      if (!line) throw new OrderLifecycleError("line_not_found", `Production line ${opts.lineId} not found.`, 404);
      if (!line.isActive) {
        throw new OrderLifecycleError("line_inactive", `Production line ${opts.lineId} is inactive.`, 409);
      }
      const max = line.maxConcurrentOrders ?? 1;
      const occupied = await countLineOccupancy(tx, line.id);
      if (occupied >= max) {
        const reason = `no_capacity: line ${line.id} at ${occupied}/${max}`;
        const applied = await applyTransitionInTx(tx, order, "rejected", {
          ...opts,
          reason: opts.reason ?? reason,
          metadata: { ...(opts.metadata ?? {}), lineId: line.id, occupied, max, strategy: "requested" },
        });
        return {
          order,
          applied,
          result: {
            orderId: order.id,
            allocated: false,
            state: "rejected",
            lineId: line.id,
            strategy: "requested",
            reason: "no_capacity",
            capacity: { max, occupied },
            transitionId: applied.transitionId,
          } satisfies AllocateResult,
        };
      }
      await tx
        .update(productionOrders)
        .set({ lineId: line.id, updatedAt: new Date() })
        .where(eq(productionOrders.id, order.id));
      const applied = await applyTransitionInTx(tx, order, "allocated", {
        ...opts,
        reason: opts.reason ?? `allocated to line ${line.id}`,
        metadata: { ...(opts.metadata ?? {}), lineId: line.id, occupied, max, strategy: "requested" },
      });
      return {
        order,
        applied,
        result: {
          orderId: order.id,
          allocated: true,
          state: "allocated",
          lineId: line.id,
          strategy: "requested",
          capacity: { max, occupied: occupied + 1 },
          transitionId: applied.transitionId,
        } satisfies AllocateResult,
      };
    }

    // ── Auto-select: least-loaded ACTIVE line in the order's workshop ──────
    // Lock ALL candidate rows in stable id order (deadlock-free mutex).
    const candidates = await tx
      .select()
      .from(productionLines)
      .where(and(eq(productionLines.workshopId, order.workshopId), eq(productionLines.isActive, true)))
      .orderBy(asc(productionLines.id))
      .for("update");

    let best: { line: (typeof candidates)[number]; occupied: number; max: number } | null = null;
    for (const line of candidates) {
      const max = line.maxConcurrentOrders ?? 1;
      const occupied = await countLineOccupancy(tx, line.id);
      if (occupied >= max) continue;
      if (!best || occupied < best.occupied) best = { line, occupied, max };
    }

    if (!best) {
      const reason = `no_capacity: no eligible active line in workshop ${order.workshopId}`;
      const applied = await applyTransitionInTx(tx, order, "rejected", {
        ...opts,
        reason: opts.reason ?? reason,
        metadata: {
          ...(opts.metadata ?? {}),
          strategy: "least-loaded",
          workshopId: order.workshopId,
          candidates: candidates.length,
        },
      });
      return {
        order,
        applied,
        result: {
          orderId: order.id,
          allocated: false,
          state: "rejected",
          strategy: "least-loaded",
          reason: "no_capacity",
          transitionId: applied.transitionId,
        } satisfies AllocateResult,
      };
    }

    await tx
      .update(productionOrders)
      .set({ lineId: best.line.id, updatedAt: new Date() })
      .where(eq(productionOrders.id, order.id));
    const applied = await applyTransitionInTx(tx, order, "allocated", {
      ...opts,
      reason: opts.reason ?? `allocated to line ${best.line.id} (least-loaded)`,
      metadata: {
        ...(opts.metadata ?? {}),
        lineId: best.line.id,
        occupied: best.occupied,
        max: best.max,
        strategy: "least-loaded",
      },
    });
    return {
      order,
      applied,
      result: {
        orderId: order.id,
        allocated: true,
        state: "allocated",
        lineId: best.line.id,
        strategy: "least-loaded",
        capacity: { max: best.max, occupied: best.occupied + 1 },
        transitionId: applied.transitionId,
      } satisfies AllocateResult,
    };
  });

  emitTransitionEffects(outcome.order, outcome.applied);
  return outcome.result;
}

// ── Compensation v1 (§18.2) ───────────────────────────────────────────────────

export interface CompensationResult {
  orderId: number;
  from: OrderLifecycleState;
  state: "failed";
  transitionIds: number[];
}

/**
 * Compensate a RUNNING/HELD order: running|held → compensating → failed, both
 * audited in ONE transaction. Resource release is IMPLICIT: line occupancy is
 * derived from lifecycle states, so leaving running/held frees the slot at the
 * first transition (no reservation rows exist for lines — header DECISION).
 * Deeper business compensation (FOE template steps) is W3-B.
 */
export async function compensateOrder(
  orderId: number,
  reason: string,
  opts: TransitionOptions = {},
): Promise<CompensationResult> {
  ensureEnabled();
  const db = await requireDb();
  const { order, first, second } = await db.transaction(async (tx) => {
    const lockedOrder = await lockOrder(tx, orderId);
    const from = effectiveLifecycleState(lockedOrder);
    if (from !== "running" && from !== "held") {
      throw new OrderLifecycleError(
        "invalid_transition",
        `Order ${orderId} is "${from}" — only a running/held order can be compensated.`,
        409,
      );
    }
    const t1 = await applyTransitionInTx(tx, lockedOrder, "compensating", { ...opts, reason });
    // Snapshot forward so the second hop validates from "compensating".
    const t2 = await applyTransitionInTx(
      tx,
      { ...lockedOrder, lifecycleState: "compensating" },
      "failed",
      { ...opts, reason: `compensation complete: ${reason}` },
    );
    return { order: lockedOrder, first: t1, second: t2 };
  });
  emitTransitionEffects(order, first);
  emitTransitionEffects(order, second);
  return { orderId: order.id, from: first.from, state: "failed", transitionIds: [first.transitionId, second.transitionId] };
}

// ── Cancel (§13.1 /orders/{id}/cancel) ────────────────────────────────────────

export interface CancelResult {
  orderId: number;
  state: "rejected" | "failed";
  via: "reject" | "compensation";
}

/**
 * Cancel per spec: created/allocated → REJECTED (no resources consumed);
 * running/held → COMPENSATING → FAILED (resources released — derived occupancy).
 * The chosen path re-validates under the row lock (a raced state change can
 * still surface as invalid_transition, never as a wrong write).
 */
export async function cancelOrder(
  orderId: number,
  reason?: string,
  opts: TransitionOptions = {},
): Promise<CancelResult> {
  ensureEnabled();
  const db = await requireDb();
  const [order] = await db.select().from(productionOrders).where(eq(productionOrders.id, orderId)).limit(1);
  if (!order) throw new OrderLifecycleError("not_found", `Order ${orderId} not found.`, 404);

  const from = effectiveLifecycleState(order as OrderRow);
  if (from === "created" || from === "allocated") {
    const r = await transitionOrder(orderId, "rejected", { ...opts, reason: reason ?? "cancelled" });
    return { orderId: r.orderId, state: "rejected", via: "reject" };
  }
  if (from === "running" || from === "held") {
    const r = await compensateOrder(orderId, reason ?? "cancelled", opts);
    return { orderId: r.orderId, state: "failed", via: "compensation" };
  }
  throw new OrderLifecycleError(
    "invalid_transition",
    `Order ${orderId} is "${from}" (terminal or compensating) — cannot cancel.`,
    409,
  );
}

// ── ERP intake hook (additive; called from erpIntake on a NEW order) ─────────

/**
 * Mark a freshly-intaken order CREATED: set lifecycle_state='created' (only
 * when still NULL) + append the first audit row (fromState=null). FAIL-SAFE:
 * never throws (intake must never break on the lifecycle layer); returns
 * whether the mark was applied. No-op when the flag is off.
 */
export async function markOrderCreated(
  orderId: number,
  opts: TransitionOptions = {},
): Promise<boolean> {
  try {
    if (!orderLifecycleEnabled()) return false;
    const db = await getDb();
    if (!db) return false;
    const [order] = await db.select().from(productionOrders).where(eq(productionOrders.id, orderId)).limit(1);
    if (!order || order.lifecycleState != null) return false;
    await db
      .update(productionOrders)
      .set({ lifecycleState: "created" })
      .where(and(eq(productionOrders.id, orderId), isNull(productionOrders.lifecycleState)));
    await db.insert(orderStateTransitions).values({
      orderId,
      fromState: null,
      toState: "created",
      reason: opts.reason ?? "order intake",
      triggeredBy: opts.actor ?? "erp-intake",
      correlationId: opts.correlationId ?? getCorrelationId() ?? null,
      metadata: opts.metadata ?? null,
    }).returning({ id: orderStateTransitions.id });
    return true;
  } catch (err) {
    console.error("[orderLifecycle] markOrderCreated failed (non-fatal):", (err as Error)?.message ?? err);
    return false;
  }
}

// ── Read side (list / detail / trace — served by §13.1 GET endpoints) ────────

export interface OrderLifecycleView {
  id: number;
  orderCode: string;
  /** Effective lifecycle (projection applied for legacy NULL rows). */
  lifecycle: OrderLifecycleState;
  /** Raw column — null = legacy row still living on the status projection. */
  lifecycleRaw: string | null;
  status: string;
  allocation: { lineId: number; factoryId: number; workshopId: number };
  productModelId: number;
  quantities: { target: number; completed: number; ok: number; ng: number };
  priority: number;
  plannedStartDate: Date | null;
  plannedEndDate: Date | null;
  actualStartDate: Date | null;
  actualEndDate: Date | null;
  externalId: string | null;
  sourceSystem: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toView(row: OrderRow): OrderLifecycleView {
  return {
    id: row.id,
    orderCode: row.orderCode,
    lifecycle: effectiveLifecycleState(row),
    lifecycleRaw: row.lifecycleState ?? null,
    status: row.status,
    allocation: { lineId: row.lineId, factoryId: row.factoryId, workshopId: row.workshopId },
    productModelId: row.productModelId,
    quantities: {
      target: row.targetQuantity,
      completed: row.completedQuantity,
      ok: row.okQuantity,
      ng: row.ngQuantity,
    },
    priority: row.priority,
    plannedStartDate: row.plannedStartDate ?? null,
    plannedEndDate: row.plannedEndDate ?? null,
    actualStartDate: row.actualStartDate ?? null,
    actualEndDate: row.actualEndDate ?? null,
    externalId: row.externalId ?? null,
    sourceSystem: row.sourceSystem ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface ListOrdersFilter {
  lifecycle?: OrderLifecycleState;
  lineId?: number;
  limit?: number;
  offset?: number;
}

/**
 * List orders with their EFFECTIVE lifecycle. The lifecycle filter is
 * projection-aware: it matches lifecycle_state = X OR (NULL AND the legacy
 * statuses that project to X) — legacy rows are never invisible.
 */
export async function listOrders(filter: ListOrdersFilter = {}): Promise<{ orders: OrderLifecycleView[]; count: number }> {
  const db = await requireDb();
  const conds: unknown[] = [];
  if (filter.lineId != null) conds.push(eq(productionOrders.lineId, filter.lineId));
  if (filter.lifecycle) {
    const legacyMatches = (Object.entries(LEGACY_STATUS_TO_LIFECYCLE) as Array<[LegacyOrderStatus, OrderLifecycleState]>)
      .filter(([, v]) => v === filter.lifecycle)
      .map(([k]) => k);
    const parts: unknown[] = [eq(productionOrders.lifecycleState, filter.lifecycle)];
    if (legacyMatches.length > 0) {
      parts.push(and(isNull(productionOrders.lifecycleState), inArray(productionOrders.status, legacyMatches)));
    }
    conds.push(parts.length > 1 ? or(...(parts as never[])) : parts[0]);
  }

  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  let query = db.select().from(productionOrders);
  if (conds.length > 0) {
    query = query.where(conds.length > 1 ? and(...(conds as never[])) : (conds[0] as never)) as typeof query;
  }
  const rows = (await query.orderBy(desc(productionOrders.id)).limit(limit).offset(offset)) as OrderRow[];
  const orders = rows.map(toView);
  return { orders, count: orders.length };
}

export interface OrderDetail {
  order: OrderLifecycleView;
  transitions: Array<{
    id: number;
    fromState: string | null;
    toState: string;
    reason: string | null;
    triggeredBy: string | null;
    correlationId: string | null;
    metadata: Record<string, unknown> | null;
    ts: Date;
  }>;
}

/** Order detail + full transition history (time order). Null when not found. */
export async function getOrderDetail(orderId: number): Promise<OrderDetail | null> {
  const db = await requireDb();
  const [order] = await db.select().from(productionOrders).where(eq(productionOrders.id, orderId)).limit(1);
  if (!order) return null;
  const transitions = await db
    .select()
    .from(orderStateTransitions)
    .where(eq(orderStateTransitions.orderId, orderId))
    .orderBy(asc(orderStateTransitions.ts), asc(orderStateTransitions.id))
    .limit(1000);
  return {
    order: toView(order as OrderRow),
    transitions: transitions.map((t) => ({
      id: t.id,
      fromState: t.fromState ?? null,
      toState: t.toState,
      reason: t.reason ?? null,
      triggeredBy: t.triggeredBy ?? null,
      correlationId: t.correlationId ?? null,
      metadata: (t.metadata as Record<string, unknown> | null) ?? null,
      ts: t.ts,
    })),
  };
}

export interface OrderTrace extends OrderDetail {
  genealogy: {
    /** Distinct unit serials referencing this order (product_inspections.productionOrderCode). */
    serials: string[];
    serialCount: number;
    source: string;
    perUnitEndpoint: string;
    note?: string;
  };
}

/**
 * Trace (§13.1 /orders/{id}/trace): transitions + genealogy REFERENCES — the
 * distinct unit serials whose inspections carry this orderCode. HONEST-EMPTY:
 * when nothing links yet, serials=[] with an explicit note (never fabricated).
 * Per-unit assembly stays with GET /v1/genealogy/{unitId} (W2-B1).
 */
export async function traceOrder(orderId: number): Promise<OrderTrace | null> {
  const detail = await getOrderDetail(orderId);
  if (!detail) return null;
  const db = await requireDb();
  const rows = await db
    .select({ serialNumber: productInspections.serialNumber })
    .from(productInspections)
    .where(eq(productInspections.productionOrderCode, detail.order.orderCode))
    .limit(2000);
  const serials = [...new Set(rows.map((r) => r.serialNumber))];
  return {
    ...detail,
    genealogy: {
      serials: serials.slice(0, 500),
      serialCount: serials.length,
      source: "product_inspections.productionOrderCode",
      perUnitEndpoint: "/api/v1/genealogy/{unitId}",
      ...(serials.length === 0
        ? { note: "No genealogy references recorded for this order yet (honest-empty)." }
        : {}),
    },
  };
}
