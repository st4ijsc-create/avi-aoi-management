/**
 * maintenanceRouter tests — work-order CRUD + close→MTTR loop closer.
 *
 * Covers:
 *   • create → row shape (workOrderNumber generated, status OPEN, machineCode resolved).
 *   • update → assign / priority / status; IN_PROGRESS stamps repairStartedAt.
 *   • close  → status COMPLETED + closedAt set + downtimeMinutes computed (the
 *              PdM-loop closer that enables MTTR); double-close rejected.
 *   • delete → removes the row; NOT_FOUND for a missing id.
 *   • RBAC gate denies when the caller lacks machine_monitoring.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq } from "./__otFakeDb";
import { maintenanceWorkOrders, machines } from "../../drizzle/schema";

const fake = new FakeDb();

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, desc: makeDesc };
});
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

const perm = { allow: true };
vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => {
    if (!perm.allow) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({ code: "FORBIDDEN", message: "no machine_monitoring" });
    }
    return next({ ctx });
  },
}));

import { maintenanceRouter } from "./maintenanceRouter";

const ctx = { user: { id: 7, role: "admin", name: "Admin" } } as any;
const caller = maintenanceRouter.createCaller(ctx);

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  perm.allow = true;
  // a machine to resolve machineCode from
  fake.seed(machines, [{ id: 10, code: "M-10" }]);
});

describe("createWorkOrder", () => {
  it("inserts an OPEN order with a generated workOrderNumber + resolved machineCode", async () => {
    const row = await caller.createWorkOrder({ machineId: 10, title: "Replace nozzle", type: "CORRECTIVE", priority: 2 });
    expect(row.status).toBe("OPEN");
    expect(row.trigger).toBe("MANUAL");
    expect(row.priority).toBe(2);
    expect(row.machineCode).toBe("M-10");
    expect(row.workOrderNumber).toMatch(/^WO-10-\d+-[0-9A-Z]{4}$/);
    expect(row.title).toBe("Replace nozzle");
  });

  it("defaults type=CORRECTIVE / priority=3 / status=OPEN", async () => {
    const row = await caller.createWorkOrder({ machineId: 10, title: "Generic check" });
    expect(row.type).toBe("CORRECTIVE");
    expect(row.priority).toBe(3);
    expect(row.status).toBe("OPEN");
  });
});

describe("updateWorkOrder", () => {
  it("assigns + changes priority and status", async () => {
    const created = await caller.createWorkOrder({ machineId: 10, title: "wo title" });
    const updated = await caller.updateWorkOrder({ id: created.id, assignedTo: 42, priority: 1, status: "ON_HOLD" });
    expect(updated.assignedTo).toBe(42);
    expect(updated.priority).toBe(1);
    expect(updated.status).toBe("ON_HOLD");
  });

  it("stamps repairStartedAt on first transition into IN_PROGRESS", async () => {
    const created = await caller.createWorkOrder({ machineId: 10, title: "wo title" });
    expect(created.repairStartedAt ?? null).toBeNull();
    const updated = await caller.updateWorkOrder({ id: created.id, status: "IN_PROGRESS" });
    expect(updated.repairStartedAt).toBeInstanceOf(Date);
  });

  it("throws NOT_FOUND for a missing id", async () => {
    await expect(caller.updateWorkOrder({ id: 999, priority: 1 })).rejects.toThrow(/not found/i);
  });
});

describe("closeWorkOrder (PdM-loop closer → MTTR)", () => {
  it("sets COMPLETED + closedAt + computes downtimeMinutes from repairStartedAt", async () => {
    const created = await caller.createWorkOrder({ machineId: 10, title: "wo title" });
    // backdate repairStartedAt 30 min ago so the computed downtime is ~30
    const past = new Date(Date.now() - 30 * 60_000);
    fake.store.get((maintenanceWorkOrders as any)[Symbol.for("drizzle:Name")])![0].repairStartedAt = past;

    const closed = await caller.closeWorkOrder({ id: created.id, resolutionNotes: "fixed" });
    expect(closed.status).toBe("COMPLETED");
    expect(closed.closedAt).toBeInstanceOf(Date);
    expect(closed.resolutionNotes).toBe("fixed");
    expect(closed.downtimeMinutes).toBeGreaterThanOrEqual(29);
    expect(closed.downtimeMinutes).toBeLessThanOrEqual(31);
  });

  it("honors an explicit downtimeMinutes override", async () => {
    const created = await caller.createWorkOrder({ machineId: 10, title: "wo title" });
    const closed = await caller.closeWorkOrder({ id: created.id, downtimeMinutes: 120 });
    expect(closed.downtimeMinutes).toBe(120);
  });

  it("rejects closing an already-completed order", async () => {
    const created = await caller.createWorkOrder({ machineId: 10, title: "wo title" });
    await caller.closeWorkOrder({ id: created.id });
    await expect(caller.closeWorkOrder({ id: created.id })).rejects.toThrow(/already completed/i);
  });
});

describe("deleteWorkOrder", () => {
  it("removes the row", async () => {
    const created = await caller.createWorkOrder({ machineId: 10, title: "wo title" });
    const res = await caller.deleteWorkOrder({ id: created.id });
    expect(res.deleted).toBe(true);
    const list = await caller.listWorkOrders({});
    expect(list.find((r) => r.id === created.id)).toBeUndefined();
  });

  it("throws NOT_FOUND for a missing id", async () => {
    await expect(caller.deleteWorkOrder({ id: 12345 })).rejects.toThrow(/not found/i);
  });
});

describe("RBAC gate", () => {
  it("denies create when the caller lacks machine_monitoring", async () => {
    perm.allow = false;
    await expect(caller.createWorkOrder({ machineId: 10, title: "wo title" })).rejects.toThrow(/machine_monitoring|FORBIDDEN/i);
  });
  it("denies close when the caller lacks machine_monitoring", async () => {
    perm.allow = false;
    await expect(caller.closeWorkOrder({ id: 1 })).rejects.toThrow(/machine_monitoring|FORBIDDEN/i);
  });
  it("denies delete when the caller lacks machine_monitoring", async () => {
    perm.allow = false;
    await expect(caller.deleteWorkOrder({ id: 1 })).rejects.toThrow(/machine_monitoring|FORBIDDEN/i);
  });
});
