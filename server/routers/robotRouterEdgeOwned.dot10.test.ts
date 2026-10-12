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
const own = vi.hoisted(() => ({ owners: new Map<number, number | null>(), throws: false }));
vi.mock("../db/connection", async () => {
  const { robotOwnership } = await import("../services/edge/edgeControlSchema");
  return {
    getDb: async () => ({
      select: () => ({
        from: (t: unknown) => ({
          where: () => ({
            limit: async () => {
              if (t !== robotOwnership) return [];
              if (own.throws) throw new Error("simulated DB timeout on the owner read");
              return [...own.owners.entries()].map(([id, edgeNodeId]) => ({ id, edgeNodeId, ownerEpoch: 2, motionLockGenerationFloor: 0 })).slice(0, 1);
            },
          }),
        }),
      }),
    }),
  };
});
const central = vi.hoisted(() => ({ calls: [] as number[], result: { ok: true, sent: "sent", detail: "abort sent on a transient session" } as { ok: boolean; sent: string; detail: string }, alerts: [] as string[] }));
vi.mock("../services/robot/deviceOwnershipService", () => ({
  sendCentralRobotStop: async (id: number) => (central.calls.push(id), central.result),
}));
vi.mock("../services/robot/criticalStopAlert", () => ({
  raiseCriticalStopAlert: async (a: { message: string }) => {
    central.alerts.push(a.message);
  },
}));
vi.mock("../_core/accessControl", () => ({ requirePermission: () => async ({ ctx, next }: any) => next({ ctx }) }));
const disp = vi.hoisted(() => ({ calls: [] as any[] }));
vi.mock("../services/robot/robotCommandDispatcher", () => ({
  dispatchRobotJob: vi.fn(async (i: any) => {
    disp.calls.push(i);
    return { ok: false, status: "rejected", error: "ROBOT_OWNED_BY_EDGE" };
  }),
  robotInterlockTarget: (robotId: number) => ({ adapterId: -1, machineId: robotId, tagKeys: [] }),
}));
const stale = vi.hoisted(() => ({ on: false, clears: 0 }));
vi.mock("../services/robot/robotManager", () => ({
  // a STALE central session (an ownership change not yet applied in this process) only when stale.on
  getActiveRobot: () =>
    stale.on
      ? {
          id: 12,
          code: "R12",
          vendor: "mitsubishi",
          driver: {
            vendor: "mitsubishi",
            isConnected: () => true,
            getMotionLock: () => ({ locked: true, generation: 3, reasonCode: "x" }),
            clearMotionLock: () => {
              stale.clears++;
              return { locked: false, generation: 3 };
            },
          },
        }
      : undefined,
}));

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
  own.throws = false;
  stale.on = false;
  stale.clears = 0;
  central.calls.length = 0;
  central.alerts.length = 0;
  central.result = { ok: true, sent: "sent", detail: "abort sent on a transient session" };
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

describe("fix review 1 — R-10-v / M-2: a console STOP with no central session is never a silent 'robot not active'", () => {
  it("★ central-owned robot, no session here ⇒ a TRANSIENT-session STOP + a durable alert; the dispatcher is not the answer", async () => {
    own.owners = new Map([[12, null]]);
    const r = await engineer.actuate({ robotId: 12, command: "stop" });
    expect(r).toMatchObject({ ok: true, status: "done" });
    expect(central.calls).toEqual([12]);
    expect(queued).toEqual([]);
    expect(disp.calls).toEqual([]);
    expect(central.alerts.join("\n")).toMatch(/held no session/);
  });

  it("★ the transient STOP fails too ⇒ an error the user sees + the alert names the hardware E-STOP", async () => {
    own.owners = new Map([[12, null]]);
    central.result = { ok: false, sent: "failed", detail: "connect timed out" };
    const r = await engineer.actuate({ robotId: 12, command: "abort" });
    expect(r).toMatchObject({ ok: false, error: "EDGE_STOP_NOT_QUEUED" });
    expect(central.alerts.join("\n")).toMatch(/hardware E-STOP/);
  });

  it("★ M-2 — the owner read FAILS ⇒ the central transient STOP AND the edge queue are both tried, and alerted", async () => {
    own.throws = true;
    const r = await engineer.actuate({ robotId: 12, command: "stop" });
    expect(r.ok).toBe(true);
    expect(central.calls).toEqual([12]);
    expect(queued.map((q) => [q.kind, q.robotId])).toEqual([["stop", 12]]);
    expect(central.alerts.join("\n")).toMatch(/owner unreadable/);
    expect(disp.calls).toEqual([]);
  });

  it("★ M-3 — an edge-owned robot this process still holds a stale session for: the clear goes to the NODE, the stale lock is not touched", async () => {
    stale.on = true;
    const r = await engineer.clearMotionLock({ robotId: 12, reason: "verified on site", expectedGeneration: 3 });
    expect(r).toMatchObject({ changed: false, queuedOnEdge: { edgeNodeId: 4 } });
    expect(stale.clears).toBe(0);
    expect(queued).toEqual([{ kind: "clear", robotId: 12, expectedGeneration: 3, reason: "verified on site", requestedBy: 7 }]);
  });
});
