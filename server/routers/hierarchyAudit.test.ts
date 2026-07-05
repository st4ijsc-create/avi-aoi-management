/**
 * Doc 27 Đợt 3 / W3-B — gap M5: EVERY master-data mutation in
 * hierarchyRouters.ts writes an audit row (actor + diff snapshot), and machine
 * snapshots NEVER leak the apiKey.
 *
 * auditTrailService is REAL here — the tests assert what actually lands in
 * db.createAuditLog (mocked sink), i.e. the true persisted payload shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => next({ ctx }),
}));

const dbm = vi.hoisted(() => ({
  createAuditLog: vi.fn(async (): Promise<any> => ({ id: 1 })),
  getDb: vi.fn(async (): Promise<any> => ({ fake: true })),
  // factory
  createFactory: vi.fn(async (): Promise<any> => 11),
  getFactoryById: vi.fn(async (): Promise<any> => ({ id: 11, code: "F1", name: "Factory 1", description: "old desc", isActive: true })),
  updateFactory: vi.fn(async (): Promise<any> => {}),
  deleteFactory: vi.fn(async (): Promise<any> => {}),
  cascadeDeleteFactory: vi.fn(async (): Promise<any> => {}),
  restoreFactory: vi.fn(async (): Promise<any> => {}),
  // workshop
  createWorkshop: vi.fn(async (): Promise<any> => 21),
  getWorkshopById: vi.fn(async (): Promise<any> => ({ id: 21, code: "W1", name: "Workshop 1" })),
  updateWorkshop: vi.fn(async (): Promise<any> => {}),
  deleteWorkshop: vi.fn(async (): Promise<any> => {}),
  restoreWorkshop: vi.fn(async (): Promise<any> => {}),
  // line
  createProductionLine: vi.fn(async (): Promise<any> => 31),
  getLineById: vi.fn(async (): Promise<any> => ({ id: 31, code: "L1", name: "Line 1" })),
  updateProductionLine: vi.fn(async (): Promise<any> => {}),
  deleteProductionLine: vi.fn(async (): Promise<any> => {}),
  restoreLine: vi.fn(async (): Promise<any> => {}),
  // station
  createStation: vi.fn(async (): Promise<any> => 41),
  getStationById: vi.fn(async (): Promise<any> => ({ id: 41, code: "S1", name: "Station 1" })),
  updateStation: vi.fn(async (): Promise<any> => {}),
  deleteStation: vi.fn(async (): Promise<any> => {}),
  restoreStation: vi.fn(async (): Promise<any> => {}),
  // machine
  getMachineById: vi.fn(async (): Promise<any> => ({
    id: 51, code: "AOI-01", name: "AOI 1", stationId: 41,
    registrationStatus: "pending", lifecycleStatus: "commissioning",
    apiKey: "mach_SUPER_SECRET_KEY",
  })),
  getMachineByCode: vi.fn(async (_code?: string): Promise<any> => undefined),
  createMachine: vi.fn(async (_data?: any): Promise<any> => 51),
  updateMachine: vi.fn(async (): Promise<any> => {}),
  deleteMachine: vi.fn(async (): Promise<any> => {}),
  restoreMachine: vi.fn(async (): Promise<any> => {}),
  approveMachine: vi.fn(async (): Promise<any> => {}),
  rejectMachine: vi.fn(async (): Promise<any> => {}),
  // register path
  getMachineBySerialNumber: vi.fn(async (_sn?: string): Promise<any> => undefined),
  getPendingMachines: vi.fn(async (): Promise<any> => []),
  getDefaultStation: vi.fn(async (): Promise<any> => ({ id: 41, code: "S1", name: "Station 1" })),
}));
vi.mock("../db", () => dbm);

import { factoryRouter, workshopRouter, lineRouter, stationRouter, machineRouter } from "./hierarchyRouters";

const ctx = { user: { id: 7, name: "Admin", role: "admin" }, req: { headers: { "user-agent": "vitest" }, ip: "10.1.1.1" } } as any;

// The global WS0.5 middleware ALSO logs each authenticated mutation as a
// generic `trpc_mutation` row (fire-and-forget → racy). These tests assert the
// ENTITY-LEVEL audits added by W3-B, so filter the generic rows out.
function entityAudits(): any[] {
  return dbm.createAuditLog.mock.calls
    .map((c: any[]) => c[0])
    .filter((e: any) => e.entityType !== "trpc_mutation");
}

function lastAudit(): any {
  const audits = entityAudits();
  expect(audits.length).toBeGreaterThan(0);
  return audits.at(-1);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("M5 — hierarchy CRUD audit coverage", () => {
  it("factory.create → action 'create' with actor + after snapshot", async () => {
    await factoryRouter.createCaller(ctx).create({ code: "F1", name: "Factory 1" });
    const e = lastAudit();
    expect(e).toMatchObject({ userId: 7, userName: "Admin", action: "create", entityType: "factory", entityId: 11, status: "success" });
    expect(e.details.after).toMatchObject({ code: "F1", name: "Factory 1" });
  });

  it("factory.update → diff-only before/after (changed fields)", async () => {
    await factoryRouter.createCaller(ctx).update({ id: 11, description: "new desc" });
    const e = lastAudit();
    expect(e.action).toBe("update");
    expect(e.details.before).toMatchObject({ description: "old desc" });
    expect(e.details.after).toMatchObject({ description: "new desc" });
    // diff-only: unchanged columns of the row are NOT dumped into the snapshot
    expect(e.details.before).not.toHaveProperty("code");
  });

  it("factory.delete (cascade) → action 'delete' with cascade flag", async () => {
    await factoryRouter.createCaller(ctx).delete({ id: 11, cascade: true });
    const e = lastAudit();
    expect(e).toMatchObject({ action: "delete", entityType: "factory", entityId: 11 });
    expect(e.details.metadata.cascade).toBe(true);
    expect(dbm.cascadeDeleteFactory).toHaveBeenCalledWith(11);
  });

  it("factory.restore → 'factory.restore'", async () => {
    await factoryRouter.createCaller(ctx).restore({ id: 11 });
    expect(lastAudit().action).toBe("factory.restore");
  });

  it("workshop / line / station create+update+delete+restore are all audited", async () => {
    await workshopRouter.createCaller(ctx).create({ factoryId: 11, code: "W1", name: "Workshop 1" });
    await workshopRouter.createCaller(ctx).update({ id: 21, name: "Workshop 1b" });
    await workshopRouter.createCaller(ctx).delete({ id: 21 });
    await workshopRouter.createCaller(ctx).restore({ id: 21 });
    await lineRouter.createCaller(ctx).create({ workshopId: 21, code: "L1", name: "Line 1" });
    await lineRouter.createCaller(ctx).update({ id: 31, name: "Line 1b" });
    await lineRouter.createCaller(ctx).delete({ id: 31 });
    await lineRouter.createCaller(ctx).restore({ id: 31 });
    await stationRouter.createCaller(ctx).create({ lineId: 31, code: "S1", name: "Station 1" });
    await stationRouter.createCaller(ctx).update({ id: 41, name: "Station 1b" });
    await stationRouter.createCaller(ctx).delete({ id: 41 });
    await stationRouter.createCaller(ctx).restore({ id: 41 });

    const actions = entityAudits().map((e: any) => `${e.entityType}:${e.action}`);
    expect(actions).toEqual([
      "workshop:create", "workshop:update", "workshop:delete", "workshop:workshop.restore",
      "line:create", "line:update", "line:delete", "line:line.restore",
      "station:create", "station:update", "station:delete", "station:station.restore",
    ]);
    // every row carries the actor
    for (const e of entityAudits()) {
      expect(e.userId).toBe(7);
    }
  });
});

describe("M5 — machine mutations audited, secrets never leak", () => {
  it("machine.approve → 'machine.approve' with before/after and NO apiKey anywhere", async () => {
    const r = await machineRouter.createCaller(ctx).approve({ id: 51, code: "AOI-NEW", stationId: 42 });
    expect(r.success).toBe(true);
    const e = lastAudit();
    expect(e.action).toBe("machine.approve");
    expect(e.details.before).toMatchObject({ code: "AOI-01", registrationStatus: "pending" });
    expect(e.details.after).toMatchObject({ code: "AOI-NEW", stationId: 42, registrationStatus: "approved" });
    expect(JSON.stringify(e)).not.toContain("mach_SUPER_SECRET_KEY");
  });

  it("machine.reject → 'machine.reject' with reason", async () => {
    await machineRouter.createCaller(ctx).reject({ id: 51, reason: "duplicate S/N" });
    const e = lastAudit();
    expect(e.action).toBe("machine.reject");
    expect(e.details.metadata.reason).toBe("duplicate S/N");
  });

  it("machine.create → 'create' (generated apiKey NOT logged)", async () => {
    await machineRouter.createCaller(ctx).create({ stationId: 41, code: "AVI-02", name: "AVI 2", machineType: "AVI" });
    const e = lastAudit();
    expect(e).toMatchObject({ action: "create", entityType: "machine", entityId: 51 });
    expect(JSON.stringify(e)).not.toContain("mach_");
  });

  it("machine.update with apiKey in the payload → value is REDACTED in the snapshot", async () => {
    await machineRouter.createCaller(ctx).update({ id: 51, name: "AOI 1b", apiKey: "mach_NEW_PLAINTEXT" });
    const e = lastAudit();
    expect(e.action).toBe("update");
    expect(e.details.after.name).toBe("AOI 1b");
    expect(e.details.after.apiKey).toBe("***REDACTED***");
    expect(e.details.before.apiKey).toBe("***REDACTED***");
    expect(JSON.stringify(e)).not.toContain("mach_NEW_PLAINTEXT");
    expect(JSON.stringify(e)).not.toContain("mach_SUPER_SECRET_KEY");
  });

  it("machine.delete → 'delete' with tombstone snapshot (code + lifecycle)", async () => {
    await machineRouter.createCaller(ctx).delete({ id: 51 });
    const e = lastAudit();
    expect(e).toMatchObject({ action: "delete", entityType: "machine", entityId: 51 });
    expect(e.details.before).toMatchObject({ code: "AOI-01", lifecycleStatus: "commissioning" });
  });

  it("machine.restore → 'machine.restore' recording the decommissioned landing state", async () => {
    await machineRouter.createCaller(ctx).restore({ id: 51 });
    const e = lastAudit();
    expect(e.action).toBe("machine.restore");
    expect(e.details.after).toMatchObject({ isActive: true, lifecycleStatus: "decommissioned" });
  });

  it("machine.regenerateApiKey → audited WITHOUT the key value", async () => {
    // regenerateApiKey talks to drizzle directly through getDb
    const update = vi.fn(() => ({ set: () => ({ where: async () => {} }) }));
    dbm.getDb.mockResolvedValue({ update } as any);
    const r = await machineRouter.createCaller(ctx).regenerateApiKey({ id: 51 });
    expect(r.apiKey).toMatch(/^mach_/);
    const e = lastAudit();
    expect(e.action).toBe("machine.regenerateApiKey");
    expect(JSON.stringify(e)).not.toContain(r.apiKey);
  });

  it("public machine.register (created) → audited with null actor + metadata", async () => {
    const pubCtx = { user: null, req: { headers: {}, ip: "10.9.9.9" } } as any;
    const { _resetRegisterThrottle } = await import("./hierarchyRouters");
    _resetRegisterThrottle();
    await machineRouter.createCaller(pubCtx).register({ serialNumber: "SN123", name: "New AOI", machineType: "AOI" });
    const e = lastAudit();
    expect(e.action).toBe("machine.register");
    expect(e.userId ?? null).toBeNull();
    expect(e.details.metadata).toMatchObject({ mode: "created", serialNumber: "SN123" });
  });
});
