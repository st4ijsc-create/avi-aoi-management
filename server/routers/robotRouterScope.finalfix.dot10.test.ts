/**
 * doc 81 Đợt 10 final fix wave — security scan on robotRouter.ts ("authorization / missing tenant (factory) scope"). Every robot
 * procedure this wave touched, against the caller's FACTORY scope (R-10-bc):
 *   • robot.requestMotionLock (M-5, new) — fail-CLOSED like motion: the robot must exist AND sit inside the caller's scope (line /
 *     station, strict resolver); outside it or missing ⇒ the SAME NOT_FOUND; the scope cannot be resolved ⇒ refused; nothing is
 *     audited as done, nothing queued, nothing locked;
 *   • robot.actuate STOP on an edge-owned robot (I-3 touched its no-session path) — R-10-bc: refused only when BOTH factories are
 *     known and differ (nothing queued, no fallback STOP); an unknown scope is allowed (L-7) as before.
 * (robot.consoleStop's scope is applied by robotStopProcedure — pinned in robotStopDegradedAuth.dot10.db; unchanged here.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const audit = vi.hoisted(() => ({ calls: [] as any[] }));
vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
  phaiDoiMatKhau: vi.fn(async () => false),
  createAuditLog: vi.fn(async (data: any) => {
    audit.calls.push(data);
    return { id: 1 };
  }),
}));
const W = vi.hoisted(() => ({ robotsRow: { lineId: 1, stationId: null as number | null } as null | { lineId: number | null; stationId: number | null }, scopeLines: null as null | number[], scopeThrows: false, userFactories: null as null | number[], robotFactory: null as null | number }));
vi.mock("../db/connection", async () => {
  const { robotOwnership } = await import("../services/edge/edgeControlSchema");
  return {
    getDb: async () => ({
      select: () => ({
        from: (t: unknown) => ({
          where: () => ({
            limit: async () => (t === robotOwnership ? [{ id: 12, edgeNodeId: 4, ownerEpoch: 2, motionLockGenerationFloor: 0 }] : W.robotsRow ? [{ id: 12, ...W.robotsRow }] : []),
          }),
        }),
      }),
    }),
  };
});
vi.mock("../db/hierarchy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/hierarchy")>()),
  idsTrongPhamVi: async () => {
    if (W.scopeThrows) throw new Error("scope lookup failed");
    return W.scopeLines;
  },
}));
vi.mock("../services/robot/robotStopAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/robot/robotStopAuth")>()),
  userFactoryIds: async () => W.userFactories,
  robotFactoryIdFromDb: async () => W.robotFactory,
  robotFactoryFromMemory: async () => () => null,
  noteRobotFactoryInMemory: async () => undefined,
}));
vi.mock("../_core/accessControl", () => ({ requirePermission: () => async ({ ctx, next }: any) => next({ ctx }) }));
const central = vi.hoisted(() => ({ calls: [] as number[] }));
vi.mock("../services/robot/deviceOwnershipService", () => ({
  sendCentralRobotStop: async (id: number) => (central.calls.push(id), { ok: true, sent: "sent", detail: "x" }),
}));
vi.mock("../services/robot/criticalStopAlert", () => ({ raiseCriticalStopAlert: async () => undefined }));
vi.mock("../services/robot/robotManager", () => ({ getActiveRobot: () => undefined }));
vi.mock("../services/robot/robotCommandDispatcher", () => ({
  dispatchRobotJob: vi.fn(async () => ({ ok: false, status: "rejected", error: "ROBOT_OWNED_BY_EDGE" })),
  robotInterlockTarget: (robotId: number) => ({ adapterId: -1, machineId: robotId, tagKeys: [] }),
}));

import { robotRouter } from "./robotRouter";
import { setEdgeDeviceRequestPort, type EdgeDeviceRequestInput } from "../services/robot/robotEdgeCommandPort";

const engineer = robotRouter.createCaller({ user: { id: 7, role: "engineer", name: "Eng", twoFactorEnabled: true } } as any);
const queued: EdgeDeviceRequestInput[] = [];
beforeEach(() => {
  audit.calls.length = 0;
  queued.length = 0;
  central.calls.length = 0;
  W.robotsRow = { lineId: 1, stationId: null };
  W.scopeLines = null;
  W.scopeThrows = false;
  W.userFactories = null;
  W.robotFactory = null;
  setEdgeDeviceRequestPort({
    async enqueue(i) {
      queued.push(i);
      return { requestId: 90, edgeNodeId: 4, ownerEpoch: 2 };
    },
    async reachable() {
      return { reachable: false, basis: "pull" as const, ageMs: 60_000 };
    },
  });
});

describe("scan: robot.requestMotionLock applies the caller's factory scope (fail-closed)", () => {
  it("★ in scope (or unrestricted) ⇒ queued", async () => {
    W.scopeLines = [1];
    await expect(engineer.requestMotionLock({ robotId: 12, reason: "hold for maintenance" })).resolves.toMatchObject({ queuedOnEdge: { requestId: 90 } });
    W.scopeLines = null;
    await expect(engineer.requestMotionLock({ robotId: 12, reason: "hold for maintenance" })).resolves.toMatchObject({ queuedOnEdge: { requestId: 90 } });
  });
  it("★ another factory's robot / a missing robot ⇒ the same NOT_FOUND; nothing audited, nothing queued", async () => {
    W.scopeLines = [99];
    await expect(engineer.requestMotionLock({ robotId: 12, reason: "hold for maintenance" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    W.scopeLines = null;
    W.robotsRow = null;
    await expect(engineer.requestMotionLock({ robotId: 12, reason: "hold for maintenance" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(queued).toEqual([]);
    expect(audit.calls).toEqual([]);
  });
  it("★ the scope cannot be resolved ⇒ refused (fail-closed), nothing queued", async () => {
    W.scopeThrows = true;
    await expect(engineer.requestMotionLock({ robotId: 12, reason: "hold for maintenance" })).rejects.toThrow();
    expect(queued).toEqual([]);
  });
});

describe("scan: robot.actuate STOP to an UNREACHABLE edge-owned robot keeps R-10-bc", () => {
  it("★ both factories known and different ⇒ refused NOT_FOUND: nothing queued, no fallback STOP", async () => {
    W.userFactories = [1];
    W.robotFactory = 2;
    await expect(engineer.actuate({ robotId: 12, command: "stop" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(queued).toEqual([]);
    expect(central.calls).toEqual([]);
  });
  it("same factory ⇒ queued_edge_unreachable + fallback; unknown scope ⇒ allowed (L-7)", async () => {
    W.userFactories = [2];
    W.robotFactory = 2;
    await expect(engineer.actuate({ robotId: 12, command: "stop" })).resolves.toMatchObject({ status: "queued_edge_unreachable" });
    W.userFactories = null;
    W.robotFactory = null;
    await expect(engineer.actuate({ robotId: 12, command: "abort" })).resolves.toMatchObject({ status: "queued_edge_unreachable" });
    expect(central.calls).toEqual([12, 12]);
  });
});
