/**
 * doc 81 Đợt 10 task D fix review 4 — ruling R-10-av (L-7) on robot.actuate STOP:
 *   1. a robot with a LIVE in-memory session: the STOP reaches its driver with ZERO database reads before it — the DB HANGING
 *      (every query never answers) still stops the attached robot at once; the reply comes within the STOP bound (the ledger row
 *      after the send is bounded, reported as ledgerError);
 *   2. NF-2 — no session here, a slow DB (450 ms per query): the owner read and the robot-row read run IN PARALLEL under one bound,
 *      the transient STOP's connect starts ≤ ~0.5 s after the request and the reply comes at the 2 s bound counted from ENTRY
 *      (measured 2.94 s before: two sequential reads, timer started after the first);
 *   3. no session + the DB dead ⇒ nothing can be sent (documented limit) and the alert says so truthfully, retried until persisted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const H = vi.hoisted(() => ({
  mode: "hang" as "hang" | "slow" | "dead",
  dbCalls: 0,
  dbCallsAtSend: -1,
  sent: [] as Array<{ jobType: string; at: number }>,
  live: true,
  connectAt: -1,
  t0: 0,
  alerts: [] as Array<{ message: string; retry?: unknown }>,
}));
vi.mock("../db", () => ({ getDb: vi.fn(async () => null), phaiDoiMatKhau: vi.fn(async () => false), createAuditLog: vi.fn(async () => ({ id: 1 })) }));
vi.mock("../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/connection")>();
  const { robotOwnership } = await import("../services/edge/edgeControlSchema");
  const never = () => new Promise<never>(() => undefined);
  const slow = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 450));
  return {
    ...actual,
    getDb: vi.fn(async () => {
      H.dbCalls++;
      if (H.mode === "hang") return never();
      if (H.mode === "dead") throw new Error("connect ECONNREFUSED 127.0.0.1:5434");
      return {
        select: () => ({
          from: (t: unknown) => ({
            where: () => ({
              limit: async () => (t === robotOwnership ? slow([{ id: 21, edgeNodeId: null, ownerEpoch: 1 }]) : slow([{ id: 21, vendor: "fanuc", endpoint: "tcp://192.0.2.9:1", connectionOptions: null }])),
            }),
          }),
        }),
        insert: () => ({ values: () => ({ returning: () => never() }) }),
        execute: () => never(),
      };
    }),
  };
});
vi.mock("../_core/accessControl", () => ({ requirePermission: () => async ({ ctx, next }: any) => next({ ctx }) }));
vi.mock("../services/robot/criticalStopAlert", () => ({
  raiseCriticalStopAlert: async (a: { message: string; retryUntilPersisted?: unknown }) => void H.alerts.push({ message: a.message, retry: a.retryUntilPersisted }),
}));
vi.mock("../services/robot/robotManager", () => ({
  getActiveRobot: (id: number) =>
    H.live && id === 21
      ? {
          id: 21,
          code: "R21",
          vendor: "fanuc",
          driver: {
            vendor: "fanuc",
            isConnected: () => true,
            runJob: async (job: { jobType: string }) => {
              if (H.dbCallsAtSend < 0) H.dbCallsAtSend = H.dbCalls;
              H.sent.push({ jobType: job.jobType, at: Date.now() - H.t0 });
              return { ok: true };
            },
          },
        }
      : undefined,
}));
vi.mock("../services/robot/driverRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/robot/driverRegistry")>()),
  // the transient session of a no-session STOP: the robot never answers the connect (silent)
  createRobotDriver: () => ({
    connect: () => {
      if (H.connectAt < 0) H.connectAt = Date.now() - H.t0;
      return new Promise<never>(() => undefined);
    },
    disconnect: async () => undefined,
    runJob: async () => ({ ok: true }),
  }),
}));

import { robotRouter } from "./robotRouter";

const engineer = robotRouter.createCaller({ user: { id: 7, role: "engineer", name: "Eng", twoFactorEnabled: true } } as any);
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ["ROBOT_CONTROL_ENABLED", "ROBOT_CONTROL_TIMEOUT_MS"]) saved[k] = process.env[k];
  process.env.ROBOT_CONTROL_ENABLED = "true";
  process.env.ROBOT_CONTROL_TIMEOUT_MS = "3000";
  Object.assign(H, { mode: "hang", dbCalls: 0, dbCallsAtSend: -1, sent: [], live: true, connectAt: -1, alerts: [] });
  H.t0 = Date.now();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
});

describe("R-10-av — console STOP bound", () => {
  it("★ LIVE session + the DB HANGING ⇒ the abort reaches the driver with ZERO DB reads before it; the reply comes within the bound", async () => {
    H.t0 = Date.now();
    const r = await engineer.actuate({ robotId: 21, command: "stop" });
    const took = Date.now() - H.t0;
    expect(H.sent.map((s) => s.jobType)).toEqual(["abort"]);
    expect(H.dbCallsAtSend).toBe(0); // nothing touched the DB before the STOP
    expect(H.sent[0].at).toBeLessThan(200);
    expect(r).toMatchObject({ ok: true, status: "done" });
    expect((r as { ledgerError?: string }).ledgerError).toBeTruthy(); // the row after the send could not be written — said so
    expect(took).toBeLessThan(1_600); // the send + ONE bounded ledger step (1 s)
  });

  it("★ NF-2 — no session, DB 450 ms per query: the two reads run in parallel, the send starts ≤ ~0.6 s, the reply comes at ≤ 2 s from entry", async () => {
    H.live = false;
    H.mode = "slow";
    H.t0 = Date.now();
    const r = await engineer.actuate({ robotId: 21, command: "abort" });
    const took = Date.now() - H.t0;
    expect(H.connectAt).toBeGreaterThanOrEqual(0);
    expect(H.connectAt).toBeLessThan(700); // one bound, not two sequential reads (≈ 0.9–1.9 s before)
    expect(took).toBeLessThan(2_150); // the 2 s reply bound counted from request entry (2.94 s before)
    expect(r).toMatchObject({ ok: true, status: "stop_in_progress" });
    expect(H.alerts.length).toBeGreaterThanOrEqual(1);
  });

  it("★ no session + DB DEAD ⇒ nothing can be sent (documented limit); the alert says so and is retried until persisted", async () => {
    H.live = false;
    H.mode = "dead";
    const r = await engineer.actuate({ robotId: 21, command: "abort" });
    expect(r).toMatchObject({ ok: false });
    expect(H.connectAt).toBe(-1);
    const a = H.alerts.map((x) => x.message).join("\n");
    expect(a).toMatch(/NO STOP WAS SENT/);
    expect(a).toMatch(/hardware E-STOP/);
    expect(H.alerts[0].retry).toMatchObject({ attempts: expect.any(Number) });
  });
});
