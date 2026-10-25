/**
 * Doc 27 Đợt 2 / W2-C — machine.register throttle + default-station validation
 * (gap M4, throttle/validate part ONLY — full lifecycle is Đợt 3).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../db", () => ({
  getMachineBySerialNumber: vi.fn(),
  createMachine: vi.fn(async () => 1),
  updateMachine: vi.fn(async () => undefined),
  getPendingMachines: vi.fn(async () => []),
  getDefaultStation: vi.fn(async () => ({ id: 42, code: "ST-42", name: "Default station" })),
  // W3-B (M7): register now pre-checks the generated SN-code among active machines
  getMachineByCode: vi.fn(async () => undefined),
  // W3-B (M5): register is audited via auditTrailService → db.createAuditLog
  createAuditLog: vi.fn(async () => ({ id: 1 })),
}));

import { machineRouter, _resetRegisterThrottle } from "./hierarchyRouters";
import * as db from "../db";
import type { TrpcContext } from "../_core/context";

function ctx(ip = "10.0.0.9"): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {}, ip } as unknown as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function input(serial: string) {
  return {
    serialNumber: serial,
    name: "New AOI",
    machineType: "AOI" as const,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetRegisterThrottle();
  delete process.env.MACHINE_REGISTER_RATE_LIMIT_PER_HOUR;
  delete process.env.MACHINE_REGISTER_PENDING_CAP;
  (db.getMachineBySerialNumber as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (db.getPendingMachines as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (db.getDefaultStation as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 42, code: "ST-42", name: "Default" });
  (db.createMachine as ReturnType<typeof vi.fn>).mockResolvedValue(1);
});

describe("machine.register (public) — M4 hardening", () => {
  it("assigns the RESOLVED default station (not hardcoded stationId 1)", async () => {
    const caller = machineRouter.createCaller(ctx());
    const r = await caller.register(input(`SN-${Date.now()}`));
    expect(r.registrationStatus).toBe("pending");
    expect(db.getDefaultStation).toHaveBeenCalled();
    const createArgs = (db.createMachine as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArgs.stationId).toBe(42);
  });

  it("fails with PRECONDITION_FAILED when no active station exists (no orphan rows)", async () => {
    (db.getDefaultStation as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const caller = machineRouter.createCaller(ctx());
    await expect(caller.register(input("SN-NOSTATION"))).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(db.createMachine).not.toHaveBeenCalled();
  });

  it("throttles per IP (TOO_MANY_REQUESTS above the hourly limit)", async () => {
    process.env.MACHINE_REGISTER_RATE_LIMIT_PER_HOUR = "2";
    const caller = machineRouter.createCaller(ctx("192.168.7.7"));
    await caller.register(input("SN-T1"));
    await caller.register(input("SN-T2"));
    await expect(caller.register(input("SN-T3"))).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    // a different IP is not affected
    const other = machineRouter.createCaller(ctx("192.168.7.8"));
    await expect(other.register(input("SN-T4"))).resolves.toMatchObject({
      registrationStatus: "pending",
    });
  });

  it("caps the global pending queue (PRECONDITION_FAILED at the cap)", async () => {
    process.env.MACHINE_REGISTER_PENDING_CAP = "2";
    (db.getPendingMachines as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const caller = machineRouter.createCaller(ctx());
    await expect(caller.register(input("SN-CAP"))).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(db.createMachine).not.toHaveBeenCalled();
  });

  it("W15: khi hàng chờ ĐẦY, serial CÓ SẴN nhận CÙNG lỗi như serial mới (không lộ tồn tại), máy có sẵn không bị sửa", async () => {
    process.env.MACHINE_REGISTER_PENDING_CAP = "2";
    (db.getPendingMachines as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const caller = machineRouter.createCaller(ctx());
    const moi = await caller.register(input("SN-FULL-NEW")).then(() => null, (e: { code?: string; message?: string }) => ({ code: e.code, message: e.message }));
    (db.getMachineBySerialNumber as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 8 });
    const co = await caller.register(input("SN-FULL-EXISTS")).then(() => null, (e: { code?: string; message?: string }) => ({ code: e.code, message: e.message }));
    expect(moi).not.toBeNull();
    expect(co).toEqual(moi);
    expect(db.updateMachine).not.toHaveBeenCalled();
  });

  it("an EXISTING serial is NOT modified (W15): generic response, no update, no status change, no id", async () => {
    (db.getMachineBySerialNumber as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 8 });
    const caller = machineRouter.createCaller(ctx());
    const r = await caller.register(input("SN-EXISTS"));
    expect(r).toEqual({ registrationStatus: "pending", message: "Machine registered, awaiting admin approval" });
    expect(db.updateMachine).not.toHaveBeenCalled();
    expect(db.createMachine).not.toHaveBeenCalled();
  });
});
