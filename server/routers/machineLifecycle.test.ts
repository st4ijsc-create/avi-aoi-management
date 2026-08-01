/**
 * Doc 27 Đợt 3 / W3-B — gap M2 (router layer): machine.setLifecycleStatus.
 *
 * Covers: RBAC gate, reason mandatory for decommissioned/retired, illegal
 * transition → CONFLICT, unknown machine → NOT_FOUND, and the DUAL audit write
 * (audit_logs via auditTrailService/db.createAuditLog + append-only
 * control_audit_log via recordAuditEvent). Also machine.lifecycleTransitions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// RBAC middleware — toggled per test (admin always passes in the real impl)
const perm = vi.hoisted(() => ({ allow: true }));
vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => {
    if (!perm.allow) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({ code: "FORBIDDEN", message: "no machine_control/canEdit" });
    }
    return next({ ctx });
  },
}));

const mocks = vi.hoisted(() => ({
  recordAuditEvent: vi.fn(async () => null),
  transitionMachineLifecycle: vi.fn(),
  createAuditLog: vi.fn(async () => ({ id: 1 })),
  getDb: vi.fn(async () => ({ fake: true })),
  getMachineById: vi.fn(),
}));

vi.mock("../services/audit/controlAuditService", () => ({
  recordAuditEvent: mocks.recordAuditEvent,
}));

// auditTrailService is REAL — it writes through db.createAuditLog (mocked below),
// so these tests verify the actual audit payload shape end-to-end.
vi.mock("../db", () => ({
  transitionMachineLifecycle: mocks.transitionMachineLifecycle,
  createAuditLog: mocks.createAuditLog,
  getDb: mocks.getDb,
  getMachineById: mocks.getMachineById,
}));

import { machineRouter } from "./hierarchyRouters";

const ctx = { user: { id: 42, name: "Kỹ sư A", role: "supervisor" }, req: { headers: {} } } as any;
const caller = machineRouter.createCaller(ctx);

function transitionOk(from: string, to: string) {
  mocks.transitionMachineLifecycle.mockResolvedValue({
    before: { id: 1, code: "AOI-01", name: "AOI 1", lifecycleStatus: from },
    after: { id: 1, code: "AOI-01", name: "AOI 1", lifecycleStatus: to },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  perm.allow = true;
  mocks.getDb.mockResolvedValue({ fake: true } as any);
});

describe("machine.setLifecycleStatus — RBAC + validation", () => {
  it("rejects without machine_control/canEdit", async () => {
    perm.allow = false;
    await expect(caller.setLifecycleStatus({ id: 1, status: "maintenance" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.transitionMachineLifecycle).not.toHaveBeenCalled();
  });

  it("requires a reason for 'decommissioned' (BAD_REQUEST, no transition attempted)", async () => {
    await expect(caller.setLifecycleStatus({ id: 1, status: "decommissioned" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.setLifecycleStatus({ id: 1, status: "decommissioned", reason: "   " }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.transitionMachineLifecycle).not.toHaveBeenCalled();
  });

  it("requires a reason for 'retired'", async () => {
    await expect(caller.setLifecycleStatus({ id: 1, status: "retired" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects unknown statuses at the zod boundary", async () => {
    await expect(caller.setLifecycleStatus({ id: 1, status: "scrapped" as never }))
      .rejects.toThrow();
  });
});

describe("machine.setLifecycleStatus — transitions + error mapping", () => {
  it("legal transition succeeds and returns the new state", async () => {
    transitionOk("active", "maintenance");
    const r = await caller.setLifecycleStatus({ id: 1, status: "maintenance" });
    expect(r).toEqual({ success: true, lifecycleStatus: "maintenance" });
    expect(mocks.transitionMachineLifecycle).toHaveBeenCalledWith(1, "maintenance");
  });

  it("illegal transition → CONFLICT (message passed through)", async () => {
    const err = new Error("Illegal lifecycle transition 'active' → 'retired'");
    err.name = "LifecycleTransitionError";
    mocks.transitionMachineLifecycle.mockRejectedValue(err);
    await expect(caller.setLifecycleStatus({ id: 1, status: "retired", reason: "scrap" }))
      .rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("Illegal lifecycle transition") });
  });

  it("unknown machine → NOT_FOUND", async () => {
    mocks.transitionMachineLifecycle.mockRejectedValue(new Error("Machine not found"));
    await expect(caller.setLifecycleStatus({ id: 999, status: "maintenance" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// The global WS0.5 middleware also logs every authenticated mutation as a
// generic `trpc_mutation` row, FIRE-AND-FORGET (racy vs assertions) — filter
// it out and assert only the entity-level audits this wave added.
function entityAudits(): any[] {
  return mocks.createAuditLog.mock.calls
    .map((c) => c[0] as any)
    .filter((e) => e.entityType !== "trpc_mutation");
}

describe("machine.setLifecycleStatus — M5 dual audit", () => {
  it("writes audit_logs (actor + before/after snapshot + reason)", async () => {
    transitionOk("active", "decommissioned");
    await caller.setLifecycleStatus({ id: 1, status: "decommissioned", reason: "EOL replacement" });

    expect(entityAudits()).toHaveLength(1);
    const entry = entityAudits()[0];
    expect(entry.userId).toBe(42);
    expect(entry.userName).toBe("Kỹ sư A");
    expect(entry.action).toBe("machine.setLifecycleStatus");
    expect(entry.entityType).toBe("machine");
    expect(entry.entityId).toBe(1);
    expect(entry.details.before).toEqual({ lifecycleStatus: "active" });
    expect(entry.details.after).toEqual({ lifecycleStatus: "decommissioned" });
    expect(entry.details.metadata.reason).toBe("EOL replacement");
  });

  it("ALSO appends to control_audit_log (control-grade event)", async () => {
    transitionOk("decommissioned", "retired");
    await caller.setLifecycleStatus({ id: 1, status: "retired", reason: "scrapped" });

    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(1);
    const [dbArg, event] = mocks.recordAuditEvent.mock.calls[0] as any[];
    expect(dbArg).toBeTruthy(); // resolved db handle is passed through
    expect(event).toMatchObject({
      entityType: "machine",
      entityId: 1,
      action: "lifecycle.retired",
      actorId: 42,
      before: { lifecycleStatus: "decommissioned" },
      after: { lifecycleStatus: "retired" },
      reason: "scrapped",
    });
  });

  it("no ENTITY audit rows are written when the transition is rejected", async () => {
    const err = new Error("Illegal lifecycle transition");
    err.name = "LifecycleTransitionError";
    mocks.transitionMachineLifecycle.mockRejectedValue(err);
    await expect(caller.setLifecycleStatus({ id: 1, status: "maintenance" })).rejects.toBeTruthy();
    // (the generic trpc_mutation failure row from the WS0.5 middleware is expected)
    expect(entityAudits()).toHaveLength(0);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });
});

describe("machine.lifecycleTransitions — UI helper", () => {
  it("returns the legal next states for the machine's current state", async () => {
    mocks.getMachineById.mockResolvedValue({ id: 1, lifecycleStatus: "decommissioned" });
    const r = await caller.lifecycleTransitions({ id: 1 });
    expect(r.current).toBe("decommissioned");
    expect(r.allowed).toEqual(["retired", "active"]);
  });

  it("treats missing lifecycleStatus as 'active'", async () => {
    mocks.getMachineById.mockResolvedValue({ id: 1 });
    const r = await caller.lifecycleTransitions({ id: 1 });
    expect(r.current).toBe("active");
    // doc 44 W2-A2 (G1.10): 'faulted' added to active's legal next states.
    expect(r.allowed).toEqual(["maintenance", "decommissioned", "faulted"]);
  });

  it("NOT_FOUND for unknown machine", async () => {
    mocks.getMachineById.mockResolvedValue(undefined);
    await expect(caller.lifecycleTransitions({ id: 9 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
