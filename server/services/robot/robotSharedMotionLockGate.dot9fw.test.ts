/**
 * doc 81 Đợt 9 final wave F1 (final review I1) — on an EDGE that executes runs, MOTION honours the motion lock CENTRAL persisted
 * (robot_motion_locks): a row ⇒ refused MOTION_LOCKED; unreadable (no DB / error / hang — bounded) ⇒ refused (fail-closed);
 * a STOP never reads it and still goes (L-7). On central (no edge flag) nothing changes: the row is not read.
 *
 * Real dispatcher + real robotSharedMotionLockGate; fake DB (robots + robot_motion_locks + ai_pending_actions + robot_jobs);
 * dry-run (a motion that passes every gate ends 'simulated'). Explicit bound for the hang case.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = Record<string, any>;
const S = vi.hoisted(() => ({
  pending: new Map<string, Record<string, any>>(),
  robots: [] as Array<Record<string, any>>,
  locks: [] as Array<Record<string, any>>,
  jobs: [] as Array<Record<string, any>>,
  seq: 1,
  mode: "ok" as "ok" | "hang-locks" | "throw-locks",
  lockReads: 0,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __k: col.__name, __v: val, __op: "eq" }),
}));
function matches(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  return true;
}
function tableFor(table: any): Row[] {
  switch (table.__table) {
    case "ai_pending_actions": return Array.from(S.pending.values());
    case "robot_jobs": return S.jobs;
    case "robots": return S.robots;
    case "robot_motion_locks": return S.locks;
    default: return [];
  }
}
function makeFakeDb() {
  return {
    select: () => ({
      from: (table: any) => ({
        where: (pred: any) => ({
          limit: async () => {
            if (table.__table === "robot_motion_locks") {
              S.lockReads++;
              if (S.mode === "hang-locks") return new Promise(() => undefined);
              if (S.mode === "throw-locks") throw new Error("simulated DB error on robot_motion_locks");
            }
            return tableFor(table).filter((r) => matches(r, pred)).slice(0, 1);
          },
        }),
      }),
    }),
    insert: (table: any) => ({
      values: (vals: Row) => ({
        returning: async () => {
          const row = { id: S.seq++, ...vals };
          if (table.__table === "robot_jobs") S.jobs.push(row);
          return [{ id: row.id }];
        },
      }),
    }),
  };
}
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));
vi.mock("../../../drizzle/schema", () => ({
  robotJobs: { __table: "robot_jobs", idempotencyKey: { __name: "idempotencyKey" } },
  robots: { __table: "robots", id: { __name: "id" }, isEnabled: { __name: "isEnabled" }, kind: { __name: "kind" } },
  robotMotionLocks: { __table: "robot_motion_locks", robotId: { __name: "robotId" } },
  aiPendingActions: { __table: "ai_pending_actions", id: { __name: "id" }, status: { __name: "status" }, userId: { __name: "userId" } },
}));
const runJobSpy = vi.fn(async () => ({ ok: true, detail: {} }));
vi.mock("./robotManager", () => ({
  // the edge's in-memory lock is NOT set: only central's persisted row can refuse
  getActiveRobot: vi.fn((_id: number) => ({ driver: { isConnected: () => true, getMotionLock: () => ({ locked: false }), runJob: (...a: any[]) => (runJobSpy as any)(...a) } })),
}));

import { dispatchRobotJob } from "./robotCommandDispatcher";
import { persistedMotionLockCheckRequired } from "./robotSharedMotionLockGate";
import { STOP_DB_STEP_DEADLINE_MS } from "./stopJob";

const MOTION = { robotId: 3, job: { jobType: "home" as const, params: {} }, triggerKind: "hitl" as const, actionId: "act-m", requestedBy: 7, confirmedBy: 7 };
const STOP = { robotId: 3, job: { jobType: "abort" as const, params: {} }, triggerKind: "hitl" as const, requestedBy: 7, confirmedBy: 7 };
const CENTRAL_LOCK = { robotId: 3, reasonCode: "motion_outcome_unknown", detail: "central: reply timeout", generation: 4, lockedAt: new Date("2026-10-12T01:00:00Z") };

const saved = { exec: process.env.EDGE_EXECUTION_ENABLED, gw: process.env.EDGE_GATEWAY_MODE };
beforeEach(() => {
  S.pending.clear();
  S.jobs.length = 0;
  S.robots = [{ id: 3, isEnabled: true, kind: "arm" }];
  S.locks = [];
  S.seq = 1;
  S.mode = "ok";
  S.lockReads = 0;
  vi.clearAllMocks();
  process.env.ROBOT_CONTROL_ENABLED = "false"; // dry-run: a motion that passes every gate ends 'simulated'
  delete process.env.FIELD_V2_ENABLED;
  process.env.EDGE_EXECUTION_ENABLED = "true"; // this process is an edge executing runs
  delete process.env.EDGE_GATEWAY_MODE;
  S.pending.set("act-m", { id: "act-m", status: "executed", userId: 7 });
});
afterEach(() => {
  for (const [k, v] of [["EDGE_EXECUTION_ENABLED", saved.exec], ["EDGE_GATEWAY_MODE", saved.gw]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("final wave F1 — the edge honours the motion lock central persisted", () => {
  it("which processes check: an edge executing runs, or the edge gateway mode; central (neither) does not", () => {
    expect(persistedMotionLockCheckRequired({ EDGE_EXECUTION_ENABLED: "true" })).toBe(true);
    expect(persistedMotionLockCheckRequired({ EDGE_EXECUTION_ENABLED: "1" })).toBe(true);
    expect(persistedMotionLockCheckRequired({ EDGE_GATEWAY_MODE: "true" })).toBe(true);
    expect(persistedMotionLockCheckRequired({})).toBe(false);
    expect(persistedMotionLockCheckRequired({ EDGE_EXECUTION_ENABLED: "false", EDGE_GATEWAY_MODE: "0" })).toBe(false);
  });

  it("control: no persisted lock ⇒ motion passes the gate (simulated)", async () => {
    const r = await dispatchRobotJob(MOTION);
    expect(r.status).toBe("simulated");
    expect(S.lockReads).toBe(1);
  });

  it("★ central's persisted lock row ⇒ motion on the edge REFUSED MOTION_LOCKED, ledgered, no driver call", async () => {
    S.locks = [CENTRAL_LOCK];
    const r = await dispatchRobotJob(MOTION);
    expect(r).toMatchObject({ ok: false, status: "rejected", error: "MOTION_LOCKED" });
    expect(runJobSpy).not.toHaveBeenCalled();
    const row = S.jobs.find((j) => j.status === "rejected")!;
    expect(String(row.errorText ?? row.error)).toMatch(/MOTION_LOCKED: a persisted motion lock is set \(motion_outcome_unknown/);
    expect(row.result?.persistedMotionLock).toMatchObject({ locked: true, generation: 4 });
  });

  it("★ L-7: a STOP is NOT refused by the persisted lock and never reads it", async () => {
    S.locks = [CENTRAL_LOCK];
    const r = await dispatchRobotJob(STOP);
    expect(r.status).not.toBe("rejected");
    expect(S.lockReads).toBe(0);
  });

  it("★ lock row unreadable (DB error) ⇒ motion refused (fail-closed); a STOP still goes", async () => {
    S.mode = "throw-locks";
    const r = await dispatchRobotJob(MOTION);
    expect(r).toMatchObject({ status: "rejected", error: "MOTION_LOCKED" });
    expect(String(S.jobs.find((j) => j.status === "rejected")!.errorText)).toMatch(/could not be read/);
    expect((await dispatchRobotJob(STOP)).status).not.toBe("rejected");
  });

  it("★ HUNG lock read ⇒ motion refused within the robot DB-step deadline (bounded, explicit); a STOP unaffected", async () => {
    S.mode = "hang-locks";
    const t0 = Date.now();
    const r = await Promise.race([dispatchRobotJob(MOTION), new Promise<"HUNG">((res) => setTimeout(() => res("HUNG"), STOP_DB_STEP_DEADLINE_MS + 1500))]);
    expect(r).not.toBe("HUNG");
    expect(r).toMatchObject({ status: "rejected", error: "MOTION_LOCKED" });
    expect(Date.now() - t0).toBeLessThan(STOP_DB_STEP_DEADLINE_MS + 700);
    const t1 = Date.now();
    expect((await dispatchRobotJob(STOP)).status).not.toBe("rejected");
    expect(Date.now() - t1).toBeLessThan(500);
  });

  it("central (no edge flag): the persisted row is NOT read — central's in-memory lock stays the source of truth (unchanged)", async () => {
    delete process.env.EDGE_EXECUTION_ENABLED;
    S.locks = [CENTRAL_LOCK];
    const r = await dispatchRobotJob(MOTION);
    expect(r.status).toBe("simulated");
    expect(S.lockReads).toBe(0);
  });
});
