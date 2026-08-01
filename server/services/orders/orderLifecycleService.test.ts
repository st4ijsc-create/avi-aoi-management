/**
 * W3-A3 (doc 44 G3.6/G3.7) — order lifecycle service tests.
 *
 * Hermetic: DB is a stateful in-memory fake whose `transaction()` SERIALIZES
 * concurrent transactions (models the FOR-UPDATE row-lock semantics the real
 * service relies on — the second concurrent allocate only proceeds after the
 * first commits, exactly what the production_lines row lock guarantees).
 * drizzle-orm operators are mocked to structured condition objects the fake
 * evaluates; policyGate / outbox / eventBus are capture mocks.
 *
 * Covers: transition map (valid/invalid) · status projection both directions ·
 * allocation (requested/auto/capacity/race/not-found) · hold/resume/cancel ·
 * compensation releasing capacity (derived occupancy) · intake CREATED mark ·
 * →done hoàn công outbox · policy deny · flag off.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── shared fake state ─────────────────────────────────────────────────────────
const state = vi.hoisted(() => ({
  orders: [] as any[],
  lines: [] as any[],
  transitions: [] as any[],
  inspections: [] as any[],
  nextTransitionId: 1,
  txQueue: Promise.resolve() as Promise<unknown>,
}));

const policyState = vi.hoisted(() => ({
  verdict: { allow: true, effect: "allow", reason: "", policyId: null } as any,
  calls: [] as any[],
}));

const outboxCalls = vi.hoisted(() => ({ completions: [] as any[] }));
const events = vi.hoisted(() => ({ published: [] as Array<{ type: string; payload: any }> }));

// ── mocks ─────────────────────────────────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ op: "eq", col, val }),
  and: (...cs: any[]) => ({ op: "and", cs: cs.filter(Boolean) }),
  or: (...cs: any[]) => ({ op: "or", cs: cs.filter(Boolean) }),
  inArray: (col: any, vals: any[]) => ({ op: "in", col, vals }),
  isNull: (col: any) => ({ op: "isnull", col }),
  asc: (c: any) => c,
  desc: (c: any) => c,
}));

vi.mock("../../../drizzle/schema", () => {
  const table = (name: string, cols: string[]) => {
    const t: any = { __name: name };
    for (const c of cols) t[c] = { __col: c, __table: name };
    return t;
  };
  return {
    productionOrders: table("production_orders", [
      "id", "orderCode", "companyCode", "factoryId", "workshopId", "lineId", "productModelId",
      "targetQuantity", "completedQuantity", "okQuantity", "ngQuantity", "status", "priority",
      "lifecycleState", "plannedStartDate", "plannedEndDate", "actualStartDate", "actualEndDate",
      "notes", "externalId", "sourceSystem", "createdBy", "createdAt", "updatedAt",
    ]),
    productionLines: table("production_lines", [
      "id", "workshopId", "code", "name", "isActive", "maxConcurrentOrders", "capacityPerHour",
    ]),
    orderStateTransitions: table("order_state_transitions", [
      "id", "orderId", "fromState", "toState", "reason", "triggeredBy", "correlationId", "metadata", "ts",
    ]),
    productInspections: table("product_inspections", ["id", "serialNumber", "productionOrderCode"]),
  };
});

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));
vi.mock("../security/policyGate", () => ({
  evaluateCommandPolicy: (ctx: any) => {
    policyState.calls.push(ctx);
    return policyState.verdict;
  },
}));
vi.mock("../integration/outboxProducers", () => ({
  publishOrderCompletion: (input: any) => outboxCalls.completions.push(input),
  publishToOutbox: () => {},
}));
vi.mock("../../_core/eventBus", () => ({
  eventBus: { publish: (type: string, payload: any) => events.published.push({ type, payload }) },
}));

// ── fake db (condition-evaluating, transaction-serializing) ──────────────────
function colName(ref: any): string {
  return ref?.__col;
}
function matches(row: any, cond: any): boolean {
  if (!cond) return true;
  switch (cond.op) {
    case "eq": return row[colName(cond.col)] === cond.val;
    case "and": return cond.cs.every((c: any) => matches(row, c));
    case "or": return cond.cs.some((c: any) => matches(row, c));
    case "in": return cond.vals.includes(row[colName(cond.col)]);
    case "isnull": return row[colName(cond.col)] == null;
    default: return true;
  }
}
function tableRows(t: any): any[] {
  switch (t?.__name) {
    case "production_orders": return state.orders;
    case "production_lines": return state.lines;
    case "order_state_transitions": return state.transitions;
    case "product_inspections": return state.inspections;
    default: return [];
  }
}
function project(row: any, cols?: any): any {
  if (!cols) return { ...row };
  const out: any = {};
  for (const [k, ref] of Object.entries(cols)) out[k] = row[colName(ref)];
  return out;
}
function selectChain(cols?: any) {
  const q: any = { _table: null, _cond: null, _limit: Infinity, _offset: 0 };
  q.from = (t: any) => { q._table = t; return q; };
  q.where = (c: any) => { q._cond = c; return q; };
  q.orderBy = () => q;
  q.for = () => q; // FOR UPDATE — serialization is modeled at transaction()
  q.limit = (n: number) => { q._limit = n; return q; };
  q.offset = (n: number) => { q._offset = n; return q; };
  q.then = (resolve: any, reject: any) => {
    try {
      const rows = tableRows(q._table)
        .filter((r) => matches(r, q._cond))
        .slice(q._offset, q._offset + q._limit)
        .map((r) => project(r, cols));
      return Promise.resolve(rows).then(resolve, reject);
    } catch (e) {
      return Promise.reject(e).then(resolve, reject);
    }
  };
  return q;
}
function makeFakeDb() {
  const db: any = {
    select: (cols?: any) => selectChain(cols),
    insert: (t: any) => ({
      values: (vals: any) => ({
        returning: async () => {
          if (t?.__name === "order_state_transitions") {
            const row = { ts: new Date(), ...vals, id: state.nextTransitionId++ };
            state.transitions.push(row);
            return [{ id: row.id }];
          }
          const row = { id: tableRows(t).length + 1, ...vals };
          tableRows(t).push(row);
          return [{ id: row.id }];
        },
        then: (resolve: any) => {
          tableRows(t).push({ ...vals });
          return resolve(undefined);
        },
      }),
    }),
    update: (t: any) => ({
      set: (vals: any) => ({
        where: async (c: any) => {
          for (const r of tableRows(t)) if (matches(r, c)) Object.assign(r, vals);
        },
      }),
    }),
    transaction: (fn: any) => {
      // SERIALIZE: models the production_lines/order row FOR-UPDATE mutex —
      // a concurrent transaction proceeds only after the previous commits.
      const run = state.txQueue.then(() => fn(db));
      state.txQueue = run.catch(() => undefined);
      return run;
    },
  };
  return db;
}

import {
  ORDER_LIFECYCLE_STATES,
  LIFECYCLE_TRANSITIONS,
  LIFECYCLE_TO_LEGACY_STATUS,
  canTransition,
  projectLegacyStatus,
  effectiveLifecycleState,
  transitionOrder,
  allocateOrder,
  holdOrder,
  resumeOrder,
  cancelOrder,
  compensateOrder,
  markOrderCreated,
  listOrders,
  getOrderDetail,
  traceOrder,
  orderLifecycleEnabled,
} from "./orderLifecycleService";

// ── seeding helpers ───────────────────────────────────────────────────────────
function seedOrder(over: Record<string, unknown> = {}) {
  const o = {
    id: state.orders.length + 1,
    orderCode: `WO-${state.orders.length + 1}`,
    companyCode: "ACME",
    factoryId: 1,
    workshopId: 1,
    lineId: 1,
    productModelId: 7,
    targetQuantity: 100,
    completedQuantity: 0,
    okQuantity: 0,
    ngQuantity: 0,
    status: "pending",
    lifecycleState: null,
    priority: 0,
    plannedStartDate: null,
    plannedEndDate: null,
    actualStartDate: null,
    actualEndDate: null,
    externalId: null,
    sourceSystem: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
  state.orders.push(o);
  return o;
}
function seedLine(over: Record<string, unknown> = {}) {
  const l = {
    id: state.lines.length + 1,
    workshopId: 1,
    code: `L${state.lines.length + 1}`,
    name: "Line",
    isActive: true,
    maxConcurrentOrders: 1,
    ...over,
  };
  state.lines.push(l);
  return l;
}

beforeEach(() => {
  state.orders = [];
  state.lines = [];
  state.transitions = [];
  state.inspections = [];
  state.nextTransitionId = 1;
  state.txQueue = Promise.resolve();
  policyState.verdict = { allow: true, effect: "allow", reason: "", policyId: null };
  policyState.calls = [];
  outboxCalls.completions = [];
  events.published = [];
  process.env.ORDER_LIFECYCLE_ENABLED = "true";
});

// ── 1. transition map + projection (pure) ────────────────────────────────────
describe("transition map (spec §8.2)", () => {
  it("allows exactly the spec transitions", () => {
    expect(canTransition("created", "allocated")).toBe(true);
    expect(canTransition("created", "rejected")).toBe(true);
    expect(canTransition("allocated", "running")).toBe(true);
    expect(canTransition("allocated", "rejected")).toBe(true);
    expect(canTransition("running", "held")).toBe(true);
    expect(canTransition("running", "done")).toBe(true);
    expect(canTransition("running", "compensating")).toBe(true);
    expect(canTransition("held", "running")).toBe(true);
    expect(canTransition("held", "done")).toBe(true);
    expect(canTransition("held", "compensating")).toBe(true);
    expect(canTransition("compensating", "failed")).toBe(true);
  });

  it("rejects invalid transitions incl. skipping allocation and leaving terminals", () => {
    expect(canTransition("created", "running")).toBe(false); // must allocate first
    expect(canTransition("created", "done")).toBe(false);
    expect(canTransition("allocated", "held")).toBe(false);
    expect(canTransition("running", "rejected")).toBe(false);
    expect(canTransition("running", "failed")).toBe(false); // only via compensating
    expect(canTransition("compensating", "running")).toBe(false);
    for (const t of ["done", "failed", "rejected"] as const) {
      for (const to of ORDER_LIFECYCLE_STATES) expect(canTransition(t, to)).toBe(false);
    }
    // same-state is never a transition
    for (const s of ORDER_LIFECYCLE_STATES) expect(canTransition(s, s)).toBe(false);
  });

  it("every non-terminal state has at least one exit (no dead ends)", () => {
    for (const s of ORDER_LIFECYCLE_STATES) {
      const exits = LIFECYCLE_TRANSITIONS[s];
      if (["done", "failed", "rejected"].includes(s)) expect(exits.length).toBe(0);
      else expect(exits.length).toBeGreaterThan(0);
    }
  });
});

describe("status projection (both directions, total)", () => {
  it("projects every lifecycle state onto the legacy enum", () => {
    expect(projectLegacyStatus("created")).toBe("pending");
    expect(projectLegacyStatus("allocated")).toBe("pending");
    expect(projectLegacyStatus("running")).toBe("in_progress");
    expect(projectLegacyStatus("held")).toBe("paused");
    expect(projectLegacyStatus("compensating")).toBe("cancelled");
    expect(projectLegacyStatus("done")).toBe("completed");
    expect(projectLegacyStatus("failed")).toBe("cancelled");
    expect(projectLegacyStatus("rejected")).toBe("cancelled");
    // total: no lifecycle state maps to undefined
    for (const s of ORDER_LIFECYCLE_STATES) expect(LIFECYCLE_TO_LEGACY_STATUS[s]).toBeTruthy();
  });

  it("projects legacy NULL-lifecycle rows to the effective state", () => {
    expect(effectiveLifecycleState({ lifecycleState: null, status: "pending" })).toBe("created");
    expect(effectiveLifecycleState({ lifecycleState: null, status: "in_progress" })).toBe("running");
    expect(effectiveLifecycleState({ lifecycleState: null, status: "paused" })).toBe("held");
    expect(effectiveLifecycleState({ lifecycleState: null, status: "completed" })).toBe("done");
    expect(effectiveLifecycleState({ lifecycleState: null, status: "cancelled" })).toBe("failed");
  });

  it("prefers the explicit lifecycle_state over the legacy projection", () => {
    expect(effectiveLifecycleState({ lifecycleState: "allocated", status: "pending" })).toBe("allocated");
    expect(effectiveLifecycleState({ lifecycleState: "compensating", status: "cancelled" })).toBe("compensating");
  });
});

// ── 2. transitionOrder ────────────────────────────────────────────────────────
describe("transitionOrder", () => {
  it("refuses when ORDER_LIFECYCLE_ENABLED is off (default)", async () => {
    process.env.ORDER_LIFECYCLE_ENABLED = "false";
    expect(orderLifecycleEnabled()).toBe(false);
    seedOrder();
    await expect(transitionOrder(1, "allocated")).rejects.toMatchObject({
      code: "order_lifecycle_disabled",
      httpStatus: 503,
    });
    expect(state.transitions.length).toBe(0);
  });

  it("404s an unknown order", async () => {
    await expect(transitionOrder(999, "held")).rejects.toMatchObject({ code: "not_found", httpStatus: 404 });
  });

  it("applies a valid transition: lifecycle + PROJECTED legacy status + audit row", async () => {
    const o = seedOrder(); // pending/null → effective created
    const r = await transitionOrder(o.id, "allocated", {
      reason: "test",
      actor: "user:9",
      correlationId: "corr-1",
    });
    expect(r).toMatchObject({ from: "created", to: "allocated", legacyStatus: "pending" });
    expect(state.orders[0].lifecycleState).toBe("allocated");
    expect(state.orders[0].status).toBe("pending"); // projection keeps old clients alive
    expect(state.transitions.length).toBe(1);
    expect(state.transitions[0]).toMatchObject({
      orderId: o.id,
      fromState: "created",
      toState: "allocated",
      reason: "test",
      triggeredBy: "user:9",
      correlationId: "corr-1",
    });
    expect(events.published.some((e) => e.type === "order.lifecycle.transitioned")).toBe(true);
  });

  it("uses the LEGACY projection as the from-state for un-migrated rows", async () => {
    const o = seedOrder({ status: "in_progress", lifecycleState: null }); // effective running
    await transitionOrder(o.id, "held");
    expect(state.orders[0].lifecycleState).toBe("held");
    expect(state.orders[0].status).toBe("paused");
    expect(state.transitions[0]).toMatchObject({ fromState: "running", toState: "held" });
  });

  it("rejects an invalid transition with 409 and writes nothing", async () => {
    const o = seedOrder(); // created
    await expect(transitionOrder(o.id, "running")).rejects.toMatchObject({
      code: "invalid_transition",
      httpStatus: 409,
    });
    expect(state.orders[0].lifecycleState).toBeNull();
    expect(state.transitions.length).toBe(0);
  });

  it("terminal states have no exits", async () => {
    const o = seedOrder({ lifecycleState: "done", status: "completed" });
    await expect(transitionOrder(o.id, "running")).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("consults the policy seam (order.command.{to}) and denies cleanly", async () => {
    policyState.verdict = { allow: false, effect: "deny", reason: "not in shift", policyId: "p1" };
    const o = seedOrder({ lifecycleState: "running", status: "in_progress" });
    await expect(transitionOrder(o.id, "held")).rejects.toMatchObject({ code: "policy_denied", httpStatus: 403 });
    expect(policyState.calls[0]).toMatchObject({ action: "order.command.held", fromState: "running", toState: "held" });
    expect(state.orders[0].lifecycleState).toBe("running"); // nothing written
    expect(state.transitions.length).toBe(0);
  });

  it("→ done stamps actualEndDate, projects completed and emits the hoàn-công outbox event", async () => {
    const o = seedOrder({ lifecycleState: "running", status: "in_progress", completedQuantity: 100, okQuantity: 98, ngQuantity: 2 });
    await transitionOrder(o.id, "done", { reason: "all units through" });
    expect(state.orders[0].status).toBe("completed");
    expect(state.orders[0].actualEndDate).toBeInstanceOf(Date);
    expect(outboxCalls.completions.length).toBe(1);
    expect(outboxCalls.completions[0]).toMatchObject({
      orderId: o.id,
      orderCode: o.orderCode,
      okQuantity: 98,
      ngQuantity: 2,
    });
  });

  it("→ running stamps actualStartDate once", async () => {
    const o = seedOrder({ lifecycleState: "allocated", status: "pending" });
    await transitionOrder(o.id, "running");
    expect(state.orders[0].actualStartDate).toBeInstanceOf(Date);
    expect(outboxCalls.completions.length).toBe(0); // no completion on running
  });
});

// ── 3. allocation (§9.1) ─────────────────────────────────────────────────────
describe("allocateOrder", () => {
  it("allocates to the requested line when capacity allows and stores the line", async () => {
    seedLine({ maxConcurrentOrders: 2 });
    const o = seedOrder({ lineId: 99 }); // created; lineId placeholder from creation
    const r = await allocateOrder(o.id, { lineId: 1, actor: "user:1" });
    expect(r).toMatchObject({ allocated: true, state: "allocated", lineId: 1, strategy: "requested" });
    expect(state.orders[0].lineId).toBe(1);
    expect(state.orders[0].lifecycleState).toBe("allocated");
    expect(state.transitions[0]).toMatchObject({ toState: "allocated" });
    expect(state.transitions[0].metadata).toMatchObject({ lineId: 1, strategy: "requested" });
  });

  it("REJECTS (terminal, per spec) when the requested line is at capacity", async () => {
    seedLine({ maxConcurrentOrders: 1 });
    seedOrder({ lifecycleState: "running", status: "in_progress", lineId: 1 }); // occupies the slot
    const o = seedOrder(); // created
    const r = await allocateOrder(o.id, { lineId: 1 });
    expect(r).toMatchObject({ allocated: false, state: "rejected", reason: "no_capacity", capacity: { max: 1, occupied: 1 } });
    expect(state.orders[1].lifecycleState).toBe("rejected");
    expect(state.orders[1].status).toBe("cancelled"); // projection
  });

  it("counts LEGACY in_progress/paused rows as occupying (projection-aware)", async () => {
    seedLine({ maxConcurrentOrders: 1 });
    seedOrder({ lifecycleState: null, status: "paused", lineId: 1 }); // legacy held occupies
    const o = seedOrder();
    const r = await allocateOrder(o.id, { lineId: 1 });
    expect(r.state).toBe("rejected");
  });

  it("auto-selects the least-loaded active line with free capacity", async () => {
    seedLine({ maxConcurrentOrders: 2 }); // line 1
    seedLine({ maxConcurrentOrders: 2 }); // line 2
    seedOrder({ lifecycleState: "running", status: "in_progress", lineId: 1 }); // load on line 1
    const o = seedOrder({ lineId: 1 });
    const r = await allocateOrder(o.id, {});
    expect(r).toMatchObject({ allocated: true, state: "allocated", lineId: 2, strategy: "least-loaded" });
    expect(state.orders[1].lineId).toBe(2);
  });

  it("skips inactive lines during auto-select and REJECTS when nothing is eligible", async () => {
    seedLine({ maxConcurrentOrders: 5, isActive: false });
    const o = seedOrder();
    const r = await allocateOrder(o.id, {});
    expect(r).toMatchObject({ allocated: false, state: "rejected", reason: "no_capacity" });
    expect(state.orders[0].lifecycleState).toBe("rejected");
  });

  it("throws (WITHOUT consuming the order) on an unknown requested line", async () => {
    const o = seedOrder();
    await expect(allocateOrder(o.id, { lineId: 42 })).rejects.toMatchObject({ code: "line_not_found", httpStatus: 404 });
    expect(state.orders[0].lifecycleState).toBeNull(); // still effectively created
    expect(state.transitions.length).toBe(0);
  });

  it("refuses to allocate an order that is not in CREATED", async () => {
    seedLine();
    const o = seedOrder({ lifecycleState: "running", status: "in_progress" });
    await expect(allocateOrder(o.id, { lineId: 1 })).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("RACE: two concurrent allocates on a max=1 line → exactly one wins, one is rejected", async () => {
    seedLine({ maxConcurrentOrders: 1 });
    const a = seedOrder({ lineId: 1 });
    const b = seedOrder({ lineId: 1 });
    const [ra, rb] = await Promise.all([
      allocateOrder(a.id, { lineId: 1 }),
      allocateOrder(b.id, { lineId: 1 }),
    ]);
    const states = [ra.state, rb.state].sort();
    expect(states).toEqual(["allocated", "rejected"]);
    const allocatedCount = state.orders.filter((o) => o.lifecycleState === "allocated").length;
    const rejectedCount = state.orders.filter((o) => o.lifecycleState === "rejected").length;
    expect(allocatedCount).toBe(1);
    expect(rejectedCount).toBe(1);
    expect(state.transitions.length).toBe(2);
  });
});

// ── 4. hold / resume / cancel / compensation ─────────────────────────────────
describe("hold / resume / cancel / compensation", () => {
  it("hold: running → held (status paused)", async () => {
    const o = seedOrder({ lifecycleState: "running", status: "in_progress" });
    const r = await holdOrder(o.id, { reason: "material shortage" });
    expect(r).toMatchObject({ from: "running", to: "held", legacyStatus: "paused" });
  });

  it("resume: held → running", async () => {
    const o = seedOrder({ lifecycleState: "held", status: "paused" });
    const r = await resumeOrder(o.id);
    expect(r).toMatchObject({ from: "held", to: "running", legacyStatus: "in_progress" });
  });

  it("hold on a created order is invalid", async () => {
    const o = seedOrder();
    await expect(holdOrder(o.id)).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("cancel(created) → rejected via the reject path", async () => {
    const o = seedOrder();
    const r = await cancelOrder(o.id, "customer cancelled");
    expect(r).toMatchObject({ state: "rejected", via: "reject" });
    expect(state.orders[0].lifecycleState).toBe("rejected");
    expect(state.orders[0].status).toBe("cancelled");
  });

  it("cancel(allocated) → rejected", async () => {
    const o = seedOrder({ lifecycleState: "allocated", status: "pending" });
    const r = await cancelOrder(o.id);
    expect(r.state).toBe("rejected");
  });

  it("cancel(running) → compensating → failed with BOTH transitions audited", async () => {
    const o = seedOrder({ lifecycleState: "running", status: "in_progress" });
    const r = await cancelOrder(o.id, "fatal jam");
    expect(r).toMatchObject({ state: "failed", via: "compensation" });
    expect(state.orders[0].lifecycleState).toBe("failed");
    expect(state.orders[0].status).toBe("cancelled");
    expect(state.orders[0].actualEndDate).toBeInstanceOf(Date);
    expect(state.transitions.map((t) => t.toState)).toEqual(["compensating", "failed"]);
    expect(state.transitions[1].reason).toContain("compensation complete");
    expect(outboxCalls.completions.length).toBe(0); // failed ≠ hoàn công
  });

  it("cancel on a terminal order is invalid", async () => {
    const o = seedOrder({ lifecycleState: "done", status: "completed" });
    await expect(cancelOrder(o.id)).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("compensateOrder refuses a non-running/held order", async () => {
    const o = seedOrder(); // created
    await expect(compensateOrder(o.id, "x")).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("compensation RELEASES the line slot (derived occupancy): a new order can allocate after", async () => {
    seedLine({ maxConcurrentOrders: 1 });
    const a = seedOrder({ lifecycleState: "running", status: "in_progress", lineId: 1 });
    const b = seedOrder({ lineId: 1 });
    // While A runs, B cannot get the slot…
    // (verified above; here: after compensation the slot is free again)
    await compensateOrder(a.id, "line fault");
    expect(state.orders[0].lifecycleState).toBe("failed");
    const r = await allocateOrder(b.id, { lineId: 1 });
    expect(r).toMatchObject({ allocated: true, state: "allocated", lineId: 1 });
  });
});

// ── 5. intake CREATED mark ────────────────────────────────────────────────────
describe("markOrderCreated (ERP intake hook)", () => {
  it("marks a fresh order CREATED + appends the first transition (fromState null)", async () => {
    const o = seedOrder();
    const ok = await markOrderCreated(o.id, { actor: "erp-intake", reason: "intake WO-1" });
    expect(ok).toBe(true);
    expect(state.orders[0].lifecycleState).toBe("created");
    expect(state.transitions[0]).toMatchObject({
      orderId: o.id,
      fromState: null,
      toState: "created",
      triggeredBy: "erp-intake",
    });
  });

  it("is a no-op when the flag is off", async () => {
    process.env.ORDER_LIFECYCLE_ENABLED = "false";
    const o = seedOrder();
    expect(await markOrderCreated(o.id)).toBe(false);
    expect(state.orders[0].lifecycleState).toBeNull();
    expect(state.transitions.length).toBe(0);
  });

  it("never overrides an order already in the lifecycle", async () => {
    const o = seedOrder({ lifecycleState: "running", status: "in_progress" });
    expect(await markOrderCreated(o.id)).toBe(false);
    expect(state.orders[0].lifecycleState).toBe("running");
    expect(state.transitions.length).toBe(0);
  });
});

// ── 6. read side ──────────────────────────────────────────────────────────────
describe("read side (list / detail / trace)", () => {
  it("listOrders reports the EFFECTIVE lifecycle and the projection-aware filter matches legacy rows", async () => {
    seedOrder({ lifecycleState: "running", status: "in_progress" });
    seedOrder({ lifecycleState: null, status: "in_progress" }); // legacy running
    seedOrder({ lifecycleState: null, status: "pending" }); // legacy created
    const all = await listOrders({});
    expect(all.count).toBe(3);
    const running = await listOrders({ lifecycle: "running" });
    expect(running.count).toBe(2);
    for (const o of running.orders) expect(o.lifecycle).toBe("running");
    const created = await listOrders({ lifecycle: "created" });
    expect(created.count).toBe(1);
    expect(created.orders[0].lifecycleRaw).toBeNull();
  });

  it("getOrderDetail returns the transition history; null when unknown", async () => {
    const o = seedOrder({ lifecycleState: "held", status: "paused" });
    state.transitions.push(
      { id: 1, orderId: o.id, fromState: "running", toState: "held", reason: "r", triggeredBy: "u", correlationId: null, metadata: null, ts: new Date() },
    );
    const detail = await getOrderDetail(o.id);
    expect(detail?.order.lifecycle).toBe("held");
    expect(detail?.transitions.length).toBe(1);
    expect(await getOrderDetail(999)).toBeNull();
  });

  it("traceOrder returns genealogy serial references, honest-empty when none", async () => {
    const o = seedOrder();
    const empty = await traceOrder(o.id);
    expect(empty?.genealogy.serials).toEqual([]);
    expect(empty?.genealogy.note).toContain("honest-empty");

    state.inspections.push(
      { id: 1, serialNumber: "SN-1", productionOrderCode: o.orderCode },
      { id: 2, serialNumber: "SN-1", productionOrderCode: o.orderCode }, // dup → dedup
      { id: 3, serialNumber: "SN-2", productionOrderCode: o.orderCode },
      { id: 4, serialNumber: "SN-X", productionOrderCode: "OTHER" },
    );
    const trace = await traceOrder(o.id);
    expect(trace?.genealogy.serialCount).toBe(2);
    expect(trace?.genealogy.serials.sort()).toEqual(["SN-1", "SN-2"]);
    expect(trace?.genealogy.note).toBeUndefined();
  });
});
