/**
 * doc 44 W5-A2 — parameterGuardrailRouter RBAC.
 *
 *   list/get/set/delete = actuationProcedure (admin/supervisor/engineer + 2FA):
 *     dải min–max là ràng buộc AN TOÀN — chỉ kỹ sư quá trình đặt/xem.
 *   changeLog / materialForecast = protectedProcedure (any authenticated user, read).
 */
import { describe, it, expect, vi } from "vitest";

// Disable the global audit-mutation middleware for this router test (fire-and-forget
// DB write otherwise). Must run before trpc.ts is imported (hoisted).
vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
});

vi.mock("../services/ai/parameterGuardrailService", () => ({
  listGuardrails: vi.fn(async () => []),
  getGuardrail: vi.fn(async () => null),
  setGuardrail: vi.fn(async () => ({ ok: true, id: 1, created: true })),
  deleteGuardrail: vi.fn(async () => true),
  listChangeLog: vi.fn(async () => []),
}));
vi.mock("../services/ai/materialForecastService", () => ({
  forecastTimeToEmpty: vi.fn(async () => ({ status: "no_current_qty" })),
  forecastMachineMaterials: vi.fn(async () => []),
}));

import { parameterGuardrailRouter } from "./parameterGuardrailRouter";

const ctx = (user: any) => ({ user, req: { ip: "127.0.0.1", headers: {} }, res: {}, sessionToken: "t" }) as any;
const engineer2fa = { id: 3, role: "engineer", name: "Eng", twoFactorEnabled: true };
const engineerNo2fa = { id: 4, role: "engineer", name: "Eng2", twoFactorEnabled: false };
const viewer = { id: 5, role: "viewer", name: "V", twoFactorEnabled: true };

describe("guardrail CRUD — actuation role-floor + 2FA", () => {
  it("viewer → FORBIDDEN on list (role floor)", async () => {
    const caller = parameterGuardrailRouter.createCaller(ctx(viewer));
    await expect(caller.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("engineer without 2FA → FORBIDDEN on list (2FA floor)", async () => {
    const caller = parameterGuardrailRouter.createCaller(ctx(engineerNo2fa));
    await expect(caller.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("engineer + 2FA → list allowed", async () => {
    const caller = parameterGuardrailRouter.createCaller(ctx(engineer2fa));
    expect(await caller.list()).toEqual([]);
  });

  it("engineer + 2FA → set allowed (returns service result)", async () => {
    const caller = parameterGuardrailRouter.createCaller(ctx(engineer2fa));
    const r = await caller.set({ scope: "machine", machineId: 5, paramKey: "torque_nm", minValue: 1.6, maxValue: 1.9 });
    expect(r).toMatchObject({ ok: true });
  });

  it("viewer → FORBIDDEN on set (mutation, role floor before resolver)", async () => {
    const caller = parameterGuardrailRouter.createCaller(ctx(viewer));
    await expect(caller.set({ scope: "machine", machineId: 5, paramKey: "x", minValue: 0, maxValue: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("read surfaces — protectedProcedure", () => {
  it("unauthenticated → UNAUTHORIZED on changeLog", async () => {
    const caller = parameterGuardrailRouter.createCaller(ctx(null));
    await expect(caller.changeLog()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("any authenticated user → changeLog + materialForecast allowed", async () => {
    const caller = parameterGuardrailRouter.createCaller(ctx(viewer));
    expect(await caller.changeLog()).toEqual([]);
    expect(await caller.materialForecast.machine({ machineId: 5 })).toEqual([]);
  });
});
