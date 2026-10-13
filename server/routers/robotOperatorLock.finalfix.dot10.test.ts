/**
 * doc 81 Đợt 10 final fix wave — M-5 (ruling R-10-br): the central "lock" command (design §2.11) is WIRED to a route, and a
 * confirmed STOP never clears an operator's lock.
 *   • MotionLock: a lock taken by an OPERATOR (`centralLock`) — or an operator lock added onto a lock that is already set — is
 *     NOT cleared by clearByStop() (a confirmed STOP); only the audited operator clear removes it. A link-loss lock is still
 *     cleared by a confirmed STOP (unchanged).
 *   • robot.requestMotionLock (machine_control:canEdit, reason ≥ 3): audited FIRST (no audit ⇒ nothing locked);
 *       – an EDGE-owned robot ⇒ a signed `lock` command queued for its node (the edge locks with `centralLock`);
 *       – a robot this process holds a session for ⇒ its in-memory lock is set with `centralLock` (persisted as any lock);
 *       – neither ⇒ PRECONDITION_FAILED robotNotActive.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const audit = vi.hoisted(() => ({ calls: [] as any[], fail: false }));
vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
  phaiDoiMatKhau: vi.fn(async () => false),
  createAuditLog: vi.fn(async (data: any) => {
    if (audit.fail) throw new Error("audit store down");
    audit.calls.push(data);
    return { id: 1 };
  }),
}));
const own = vi.hoisted(() => ({ owners: new Map<number, number | null>() }));
vi.mock("../db/connection", async () => {
  const { robotOwnership } = await import("../services/edge/edgeControlSchema");
  return {
    getDb: async () => ({
      select: () => ({
        from: (t: unknown) => ({
          where: () => ({
            // the robot row (line / station — the factory scope; the caller here is unrestricted) or its owner
            limit: async () => (t !== robotOwnership ? [{ lineId: 1, stationId: null }] : [...own.owners.entries()].map(([id, edgeNodeId]) => ({ id, edgeNodeId, ownerEpoch: 2, motionLockGenerationFloor: 0 })).slice(0, 1)),
          }),
        }),
      }),
    }),
  };
});
vi.mock("../db/hierarchy", async (importOriginal) => ({ ...(await importOriginal<typeof import("../db/hierarchy")>()), idsTrongPhamVi: async () => null })); // unrestricted caller (scope: robotRouterScope.finalfix)
vi.mock("../_core/accessControl", () => ({ requirePermission: () => async ({ ctx, next }: any) => next({ ctx }) }));
const session = vi.hoisted(() => ({ lock: null as null | import("../services/robot/robotDriver").MotionLock }));
vi.mock("../services/robot/robotManager", () => ({
  getActiveRobot: (id: number) => (session.lock && id === 13 ? { id: 13, code: "R13", vendor: "sim", driver: { motionLockController: () => session.lock } } : undefined),
}));

import { robotRouter } from "./robotRouter";
import { setEdgeDeviceRequestPort, type EdgeDeviceRequestInput } from "../services/robot/robotEdgeCommandPort";
import { MotionLock, OPERATOR_MOTION_LOCK_REASON_CODE } from "../services/robot/robotDriver";

const engineer = robotRouter.createCaller({ user: { id: 7, role: "engineer", name: "Eng", twoFactorEnabled: true } } as any);
const queued: EdgeDeviceRequestInput[] = [];

beforeEach(() => {
  audit.calls.length = 0;
  audit.fail = false;
  queued.length = 0;
  own.owners = new Map([[12, 4]]);
  session.lock = null;
  setEdgeDeviceRequestPort({
    async enqueue(i) {
      queued.push(i);
      return { requestId: 88, edgeNodeId: 4, ownerEpoch: 2 };
    },
    async reachable() {
      return { reachable: true, basis: "pull" as const, ageMs: 10 };
    },
  });
});

describe("final fix wave M-5 — MotionLock: a confirmed STOP never clears an OPERATOR lock", () => {
  it("★ centralLock survives clearByStop; the audited operator clear removes it", () => {
    const l = new MotionLock();
    l.lock(OPERATOR_MOTION_LOCK_REASON_CODE, "maintenance");
    l.clearByStop();
    expect(l.isLocked()).toBe(true);
    l.clearByOperator({ reason: "done", userId: 1, expectedGeneration: l.snapshot().generation! });
    expect(l.isLocked()).toBe(false);
  });
  it("★ an operator lock added onto a link-loss lock is kept past the confirmed STOP", () => {
    const l = new MotionLock();
    l.lock("line_connection_closed");
    l.lock(OPERATOR_MOTION_LOCK_REASON_CODE, "hold for inspection");
    l.clearByStop();
    expect(l.isLocked()).toBe(true);
  });
  it("unchanged: a link-loss lock alone is cleared by a confirmed STOP; a restored operator lock is still an operator lock", () => {
    const l = new MotionLock();
    l.lock("line_connection_closed");
    l.clearByStop();
    expect(l.isLocked()).toBe(false);
    const r = new MotionLock();
    r.restore({ reasonCode: OPERATOR_MOTION_LOCK_REASON_CODE, detail: "maintenance", since: new Date().toISOString(), generation: 4 });
    r.clearByStop();
    expect(r.isLocked()).toBe(true);
  });
});

describe("final fix wave M-5 — robot.requestMotionLock (the central lock route)", () => {
  it("★ edge-owned robot ⇒ audited FIRST, then a `lock` queued for its node", async () => {
    const r = await engineer.requestMotionLock({ robotId: 12, reason: "hold for maintenance" });
    expect(r).toMatchObject({ robotId: 12, queuedOnEdge: { requestId: 88, edgeNodeId: 4 } });
    expect(queued).toEqual([{ kind: "lock", robotId: 12, reason: "hold for maintenance", requestedBy: 7 }]);
    expect(audit.calls[0]).toMatchObject({ action: "robot.requestMotionLock", entityId: 12, details: { via: "edge_command", edgeNodeId: 4 } });
  });
  it("★ the audit cannot be written ⇒ nothing is locked / queued", async () => {
    audit.fail = true;
    await expect(engineer.requestMotionLock({ robotId: 12, reason: "hold for maintenance" })).rejects.toThrow();
    expect(queued).toEqual([]);
  });
  it("★ a robot with a session HERE ⇒ its lock is set as an operator lock (a confirmed STOP will not clear it)", async () => {
    own.owners = new Map([[13, null]]);
    session.lock = new MotionLock();
    const r = await engineer.requestMotionLock({ robotId: 13, reason: "hold for maintenance" });
    expect(r).toMatchObject({ robotId: 13, changed: true, motionLock: { locked: true, reasonCode: OPERATOR_MOTION_LOCK_REASON_CODE } });
    session.lock.clearByStop();
    expect(session.lock.isLocked()).toBe(true);
    expect(queued).toEqual([]);
  });
  it("neither edge-owned nor active here ⇒ PRECONDITION_FAILED, nothing audited as done", async () => {
    own.owners = new Map([[14, null]]);
    await expect(engineer.requestMotionLock({ robotId: 14, reason: "hold for maintenance" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(queued).toEqual([]);
  });
});
