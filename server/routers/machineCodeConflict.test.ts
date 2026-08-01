/**
 * Doc 27 Đợt 3 / W3-B — gaps M7 + M3 (router layer):
 *  - machine.create duplicate code → clean CONFLICT (pre-check + TOCTOU race path)
 *  - machine.approve rename onto a taken code → CONFLICT
 *  - machine.register: SN-code collision → suffix retry (documented policy),
 *    exhausted suffixes → CONFLICT; retired/decommissioned serial → CONFLICT
 *  - machine.restore onto a reused code → CONFLICT (M3 tombstone semantics)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => next({ ctx }),
}));

const dbm = vi.hoisted(() => ({
  createAuditLog: vi.fn(async (): Promise<any> => ({ id: 1 })),
  getDb: vi.fn(async (): Promise<any> => ({ fake: true })),
  getMachineById: vi.fn(async (): Promise<any> => ({ id: 51, code: "AOI-01", name: "AOI 1", stationId: 41, registrationStatus: "pending" })),
  getMachineByCode: vi.fn(async (_code?: string): Promise<any> => undefined),
  createMachine: vi.fn(async (_data?: any): Promise<any> => 51),
  updateMachine: vi.fn(async (): Promise<any> => {}),
  restoreMachine: vi.fn(async (_id?: number): Promise<any> => {}),
  approveMachine: vi.fn(async (): Promise<any> => {}),
  getMachineBySerialNumber: vi.fn(async (_sn?: string): Promise<any> => undefined),
  getPendingMachines: vi.fn(async (): Promise<any> => []),
  getDefaultStation: vi.fn(async (): Promise<any> => ({ id: 41, code: "S1", name: "Station 1" })),
}));
vi.mock("../db", () => dbm);

import { machineRouter, _resetRegisterThrottle } from "./hierarchyRouters";

const adminCtx = { user: { id: 7, name: "Admin", role: "admin" }, req: { headers: {} } } as any;
const pubCtx = { user: null, req: { headers: {}, ip: "10.2.2.2" } } as any;

beforeEach(() => {
  vi.clearAllMocks();
  _resetRegisterThrottle();
  dbm.getMachineByCode.mockResolvedValue(undefined);
  dbm.getMachineBySerialNumber.mockResolvedValue(undefined);
  dbm.createMachine.mockResolvedValue(51);
});

describe("M7 — machine.create duplicate pre-check", () => {
  it("existing active code → CONFLICT naming the holder (no raw 500)", async () => {
    dbm.getMachineByCode.mockResolvedValue({ id: 9, code: "AOI-01", name: "Old AOI" });
    await expect(machineRouter.createCaller(adminCtx).create({
      stationId: 41, code: "AOI-01", name: "New AOI", machineType: "AOI",
    })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("AOI-01"),
    });
    expect(dbm.createMachine).not.toHaveBeenCalled();
  });

  it("TOCTOU race: pre-check passes but insert hits the partial unique → CONFLICT", async () => {
    const race = new Error("Machine code 'AOI-01' is already in use by an active machine");
    race.name = "MachineCodeCollisionError";
    dbm.createMachine.mockRejectedValue(race);
    await expect(machineRouter.createCaller(adminCtx).create({
      stationId: 41, code: "AOI-01", name: "New AOI", machineType: "AOI",
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("machine.approve renaming onto a code held by ANOTHER machine → CONFLICT", async () => {
    dbm.getMachineByCode.mockResolvedValue({ id: 60, code: "AOI-99", name: "Other machine" });
    await expect(machineRouter.createCaller(adminCtx).approve({ id: 51, code: "AOI-99" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(dbm.approveMachine).not.toHaveBeenCalled();
  });

  it("machine.approve keeping its OWN code is not a conflict", async () => {
    dbm.getMachineByCode.mockResolvedValue({ id: 51, code: "AOI-01", name: "AOI 1" });
    const r = await machineRouter.createCaller(adminCtx).approve({ id: 51, code: "AOI-01" });
    expect(r.success).toBe(true);
  });
});

describe("M7 — register generated SN-code collision (suffix-retry policy)", () => {
  it("SN-<serial> taken by an active machine → retries with -2 suffix", async () => {
    dbm.getMachineByCode.mockImplementation(async (code: string) =>
      code === "SN-777" ? { id: 3, code: "SN-777", name: "clash" } : undefined);
    const r = await machineRouter.createCaller(pubCtx).register({
      serialNumber: "777", name: "New AOI", machineType: "AOI",
    });
    expect(r.registrationStatus).toBe("pending");
    const created = dbm.createMachine.mock.calls[0][0] as any;
    expect(created.code).toBe("SN-777-2");
    expect(created.lifecycleStatus).toBe("commissioning");
  });

  it("all suffixes exhausted → CONFLICT (documented cap of 5 attempts)", async () => {
    dbm.getMachineByCode.mockResolvedValue({ id: 3, code: "taken", name: "clash" });
    await expect(machineRouter.createCaller(pubCtx).register({
      serialNumber: "888", name: "New AOI", machineType: "AOI",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(dbm.createMachine).not.toHaveBeenCalled();
  });
});

describe("M2 — register vs decommissioned/retired assets", () => {
  it.each(["retired", "decommissioned"] as const)("existing %s machine cannot re-register (CONFLICT)", async (state) => {
    dbm.getMachineBySerialNumber.mockResolvedValue({ id: 8, code: "AOI-08", lifecycleStatus: state });
    await expect(machineRouter.createCaller(pubCtx).register({
      serialNumber: "SN8", name: "AOI 8", machineType: "AOI",
    })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining(state),
    });
    expect(dbm.updateMachine).not.toHaveBeenCalled();
  });

  it("existing active machine still updates in place (unchanged behaviour)", async () => {
    dbm.getMachineBySerialNumber.mockResolvedValue({ id: 8, code: "AOI-08", lifecycleStatus: "active" });
    const r = await machineRouter.createCaller(pubCtx).register({
      serialNumber: "SN8", name: "AOI 8", machineType: "AOI",
    });
    expect(r.id).toBe(8);
    expect(dbm.updateMachine).toHaveBeenCalled();
  });
});

describe("M3 — restore vs reused code", () => {
  it("restore collision → CONFLICT with the db layer's clear message", async () => {
    const err = new Error("Cannot restore: code 'AOI-01' has been reused by active machine #9 (New AOI)");
    err.name = "MachineCodeCollisionError";
    dbm.restoreMachine.mockRejectedValue(err);
    await expect(machineRouter.createCaller(adminCtx).restore({ id: 51 }))
      .rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("reused") });
  });

  it("restore of unknown machine → NOT_FOUND", async () => {
    dbm.restoreMachine.mockRejectedValue(new Error("Machine not found"));
    await expect(machineRouter.createCaller(adminCtx).restore({ id: 404 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("clean restore succeeds", async () => {
    dbm.restoreMachine.mockResolvedValue(undefined);
    const r = await machineRouter.createCaller(adminCtx).restore({ id: 51 });
    expect(r.success).toBe(true);
  });
});
