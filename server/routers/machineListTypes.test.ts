/**
 * Doc 56 Đ0 việc 6 (TAX-1/TAX-3) — machine.listTypes: the ONE server-served
 * machine-type vocabulary {type, deviceClass, labelKey} the client dropdowns
 * consume instead of forking compile-time lists.
 *
 * Proves:
 *  - the full 24-type taxonomy is served, in MACHINE_TYPES (enum) order;
 *  - deviceClass derivation is correct per class family (AVI→aoi_avi,
 *    SCREWDRIVE→automation, IOT_SENSOR→iot) and partitions 4/18/2;
 *  - labelKey follows the existing i18n convention `machineType_<TYPE>`;
 *  - the projection is a pure constant — no db call is made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => next({ ctx }),
}));

const dbm = vi.hoisted(() => ({
  createAuditLog: vi.fn(async (): Promise<any> => ({ id: 1 })),
  getDb: vi.fn(async (): Promise<any> => ({ fake: true })),
  getMachines: vi.fn(async (): Promise<any> => []),
  getMachinesPaged: vi.fn(async (_opts?: any): Promise<any> => ({ items: [], total: 0 })),
}));
vi.mock("../db", () => dbm);

import { machineRouter } from "./hierarchyRouters";
import { MACHINE_TYPES, DEVICE_CLASS_BY_TYPE } from "../constants/machineTypes";

const userCtx = { user: { id: 7, name: "User", role: "operator" }, req: { headers: {} } } as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Đ0 việc 6 — machine.listTypes", () => {
  it("serves the full 24-type taxonomy in enum (MACHINE_TYPES) order", async () => {
    const res = await machineRouter.createCaller(userCtx).listTypes();
    expect(res).toHaveLength(24);
    expect(res.map((r) => r.type)).toEqual([...MACHINE_TYPES]);
    // The 3 new 0287 types are present.
    for (const t of ["WELDER", "IOT_SENSOR", "IOT_GATEWAY"]) {
      expect(res.map((r) => r.type)).toContain(t);
    }
  });

  it("derives the correct deviceClass per family (spot checks + full map parity)", async () => {
    const res = await machineRouter.createCaller(userCtx).listTypes();
    const byType = Object.fromEntries(res.map((r) => [r.type, r.deviceClass]));
    expect(byType.AVI).toBe("aoi_avi");
    expect(byType.SCREWDRIVE).toBe("automation");
    expect(byType.IOT_SENSOR).toBe("iot");
    expect(byType.IOT_GATEWAY).toBe("iot");
    expect(byType.WELDER).toBe("automation");
    // Every row mirrors the ONE server-side map (no drift possible).
    for (const r of res) {
      expect(r.deviceClass).toBe(DEVICE_CLASS_BY_TYPE[r.type]);
    }
    // Partition: 4 inspection (aoi_avi) + 18 automation + 2 iot = 24.
    const count = (c: string) => res.filter((r) => r.deviceClass === c).length;
    expect(count("aoi_avi")).toBe(4);
    expect(count("automation")).toBe(18);
    expect(count("iot")).toBe(2);
  });

  it("labelKey follows the i18n convention machineType_<TYPE>", async () => {
    const res = await machineRouter.createCaller(userCtx).listTypes();
    for (const r of res) {
      expect(r.labelKey).toBe(`machineType_${r.type}`);
    }
  });

  it("is a pure constant projection — no db access", async () => {
    await machineRouter.createCaller(userCtx).listTypes();
    expect(dbm.getMachines).not.toHaveBeenCalled();
    expect(dbm.getMachinesPaged).not.toHaveBeenCalled();
    expect(dbm.getDb).not.toHaveBeenCalled();
  });
});
