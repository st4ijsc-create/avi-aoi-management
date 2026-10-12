/**
 * doc 81 Đợt 10 task D (design §2.8 / §2.11) — the operator console on a robot an EDGE node owns. Central has no session for it
 * (central's robotManager skips edge-owned robots), so:
 *   • robot.clearMotionLock ⇒ audited FIRST, then queued for the owning node as a signed `clear` with the generation the
 *     operator saw (compare-and-clear happens at the edge); a queue failure ⇒ refused, nothing cleared;
 *   • robot.actuate STOP / abort ⇒ queued as a signed `stop` for the node (sent there at once, L-7) — never "not active";
 *   • robot.actuate MOTION ⇒ the dispatcher (which refuses ROBOT_OWNED_BY_EDGE); a central robot keeps every existing answer.
 * Through the port (robotEdgeCommandPort) — group B's edgeNodeCommands is replaced by a fake queue here.
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
const own = vi.hoisted(() => ({ owners: new Map<number, number | null>() }));
vi.mock("../db/connection", async () => {
  const { robotOwnership } = await import("../services/edge/edgeControlSchema");
  return {
    getDb: async () => ({
      select: () => ({
        from: (t: unknown) => ({
          where: () => ({
            limit: async () => {
              if (t !== robotOwnership) return [];
              return [...own.owners.entries()].map(([id, edgeNodeId]) => ({ id, edgeNodeId, ownerEpoch: 2, motionLockGenerationFloor: 0 })).slice(0, 1);
            },
          }),
        }),
      }),
    }),
  };
});
vi.mock("../_core/accessControl", () => ({ requirePermission: () => async ({ ctx, next }: any) => next({ ctx }) }));
const disp = vi.hoisted(() => ({ calls: [] as any[] }));
vi.mock("../services/robot/robotCommandDispatcher", () => ({
  dispatchRobotJob: vi.fn(async (i: any) => {
    disp.calls.push(i);
    return { ok: false, status: "rejected", error: "ROBOT_OWNED_BY_EDGE" };
  }),
  robotInterlockTarget: (robotId: number) => ({ adapterId: -1, machineId: robotId, tagKeys: [] }),
}));
vi.mock("../services/robot/robotManager", () => ({ getActiveRobot: () => undefined }));

import { robotRouter } from "./robotRouter";
import { setEdgeDeviceRequestPort, type EdgeDeviceRequestInput } from "../services/robot/robotEdgeCommandPort";

const engineer = robotRouter.createCaller({ user: { id: 7, role: "engineer", name: "Eng", twoFactorEnabled: true } } as any);
const queued: EdgeDeviceRequestInput[] = [];
let queueFails: null | string = null;

beforeEach(() => {
  audit.calls.length = 0;
  disp.calls.length = 0;
  queued.length = 0;
  queueFails = null;
  own.owners = new Map([[12, 4]]); // robot 12 owned by edge node 4
  setEdgeDeviceRequestPort({
    async enqueue(i) {
      if (queueFails) throw Object.assign(new Error("queue failed"), { code: queueFails });
      queued.push(i);
      return { requestId: 77, edgeNodeId: 4, ownerEpoch: 2 };
    },
  });
});

describe("console on an EDGE-owned robot (no central session)", () => {
  it("★ clearMotionLock ⇒ audit FIRST, then a `clear` for the owning node carrying the operator's generation; nothing cleared here", async () => {
    const r = await engineer.clearMotionLock({ robotId: 12, reason: "verified on site", expectedGeneration: 5 });
    expect(r).toMatchObject({ robotId: 12, changed: false, queuedOnEdge: { requestId: 77, edgeNodeId: 4 } });
    expect(queued).toEqual([{ kind: "clear", robotId: 12, expectedGeneration: 5, reason: "verified on site", requestedBy: 7 }]);
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0]).toMatchObject({ action: "robot.clearMotionLock", entityId: 12, details: { edgeNodeId: 4, via: "edge_command", expectedGeneration: 5 } });
  });

  it("the queue fails (owner changed / DB) ⇒ refused PRECONDITION_FAILED edgeCommandNotQueued — nothing cleared", async () => {
    queueFails = "stale";
    await expect(engineer.clearMotionLock({ robotId: 12, reason: "verified on site", expectedGeneration: 5 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(queued).toEqual([]);
  });

  it("a central robot (no edge owner) keeps the existing answer: robotNotActive, no queue", async () => {
    own.owners = new Map([[13, null]]);
    await expect(engineer.clearMotionLock({ robotId: 13, reason: "verified on site", expectedGeneration: 1 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(queued).toEqual([]);
  });

  it("★ console STOP / abort ⇒ a signed `stop` queued for the node (never 'not active'); the dispatcher is not called", async () => {
    for (const command of ["stop", "abort"] as const) {
      const r = await engineer.actuate({ robotId: 12, command });
      expect(r).toMatchObject({ ok: true, status: "queued_on_edge", queuedOnEdge: { requestId: 77, edgeNodeId: 4 } });
    }
    expect(queued.map((q) => [q.kind, q.robotId])).toEqual([["stop", 12], ["stop", 12]]);
    expect(disp.calls).toEqual([]);
  });

  it("console MOTION ⇒ the dispatcher (which refuses ROBOT_OWNED_BY_EDGE); nothing queued", async () => {
    const r = await engineer.actuate({ robotId: 12, command: "home" });
    expect(r).toMatchObject({ ok: false, error: "ROBOT_OWNED_BY_EDGE" });
    expect(disp.calls).toHaveLength(1);
    expect(queued).toEqual([]);
  });
});
