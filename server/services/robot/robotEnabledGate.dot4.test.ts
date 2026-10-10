/**
 * doc 81 Đợt 4 final wave R-4-x — MOTION to a robot whose `robots.isEnabled` is now false is refused at COMMAND time.
 *
 * Pre-merge finding: the robot dispatcher sends to the active set loaded at BOOT (robotManager.getActiveRobot) and
 * robot.setEnabled only updates the row — before this fix a robot disabled after boot kept receiving MOTION. Now the
 * dispatcher re-reads the row before any motion driver call, bounded by the robot DB-step deadline
 * (STOP_DB_STEP_DEADLINE_MS); disabled / missing row / DB error or timeout ⇒ motion refused ROBOT_DISABLED. A STOP
 * (abort/stop/e_stop) never reads it and still goes out (L-7).
 *
 * Real dispatcher + real robotEnabledGate; fake DB (robots + ai_pending_actions + robot_jobs); dry-run (motion that passes
 * every gate ends 'simulated'). Explicit bounds for the hang case.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;
const S = vi.hoisted(() => ({
  pending: new Map<string, Record<string, any>>(),
  robots: [] as Array<Record<string, any>>,
  jobs: [] as Array<Record<string, any>>,
  seq: 1,
  mode: "ok" as "ok" | "hang-robots" | "throw-robots" | "no-db",
  robotReads: 0,
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
    default: return [];
  }
}
function makeFakeDb() {
  return {
    select: () => ({
      from: (table: any) => ({
        where: (pred: any) => ({
          limit: async () => {
            if (table.__table === "robots") {
              S.robotReads++;
              if (S.mode === "hang-robots") return new Promise(() => undefined);
              if (S.mode === "throw-robots") throw new Error("simulated DB error on robots");
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
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => (S.mode === "no-db" ? null : makeFakeDb())) }));
vi.mock("../../../drizzle/schema", () => ({
  robotJobs: { __table: "robot_jobs", idempotencyKey: { __name: "idempotencyKey" } },
  robots: { __table: "robots", id: { __name: "id" }, isEnabled: { __name: "isEnabled" }, kind: { __name: "kind" } },
  aiPendingActions: { __table: "ai_pending_actions", id: { __name: "id" }, status: { __name: "status" }, userId: { __name: "userId" } },
}));
const runJobSpy = vi.fn(async () => ({ ok: true, detail: {} }));
vi.mock("./robotManager", () => ({
  getActiveRobot: vi.fn((_id: number) => ({ driver: { isConnected: () => true, runJob: (...a: any[]) => (runJobSpy as any)(...a) } })),
}));

import { dispatchRobotJob, ROBOT_DISABLED_REASON_CODE } from "./robotCommandDispatcher";
import { STOP_DB_STEP_DEADLINE_MS } from "./stopJob";

const MOTION = { robotId: 3, job: { jobType: "home" as const, params: {} }, triggerKind: "hitl" as const, actionId: "act-m", requestedBy: 7, confirmedBy: 7 };
const STOP = { robotId: 3, job: { jobType: "abort" as const, params: {} }, triggerKind: "hitl" as const, requestedBy: 7, confirmedBy: 7 };

beforeEach(() => {
  S.pending.clear();
  S.jobs.length = 0;
  S.robots = [{ id: 3, isEnabled: true, kind: "arm" }];
  S.seq = 1;
  S.mode = "ok";
  S.robotReads = 0;
  vi.clearAllMocks();
  process.env.ROBOT_CONTROL_ENABLED = "false"; // dry-run: a motion that passes every gate ends 'simulated'
  delete process.env.FIELD_V2_ENABLED;
  S.pending.set("act-m", { id: "act-m", status: "executed", userId: 7 });
});

describe("final wave R-4-x — the robot dispatcher refuses MOTION to a robot disabled after boot (row re-read at command time)", () => {
  it("control: robot row enabled ⇒ motion passes the gate (simulated)", async () => {
    const r = await dispatchRobotJob(MOTION);
    expect(r.status).toBe("simulated");
    expect(S.robotReads).toBe(1);
  });

  it("★ row now DISABLED (robot still in the boot-loaded active set) ⇒ motion REFUSED ROBOT_DISABLED, ledgered, no driver call", async () => {
    S.robots[0].isEnabled = false;
    const r = await dispatchRobotJob(MOTION);
    expect(r).toMatchObject({ ok: false, status: "rejected", error: ROBOT_DISABLED_REASON_CODE });
    expect(runJobSpy).not.toHaveBeenCalled();
    const row = S.jobs.find((j) => j.status === "rejected")!;
    expect(String(row.error ?? row.errorText ?? JSON.stringify(row))).toMatch(/ROBOT_DISABLED: robot is disabled/);
  });

  it("★ L-7: a STOP to the disabled robot is NOT refused and never reads the row", async () => {
    S.robots[0].isEnabled = false;
    const r = await dispatchRobotJob(STOP);
    expect(r.status).not.toBe("rejected");
    expect(S.robotReads).toBe(0);
  });

  it("missing robots row ⇒ motion refused (fail-closed)", async () => {
    S.robots = [];
    expect(await dispatchRobotJob(MOTION)).toMatchObject({ status: "rejected", error: ROBOT_DISABLED_REASON_CODE });
  });

  it("★ DB error / no DB ⇒ motion refused; a STOP still goes", async () => {
    S.mode = "throw-robots";
    expect(await dispatchRobotJob(MOTION)).toMatchObject({ status: "rejected", error: ROBOT_DISABLED_REASON_CODE });
    expect((await dispatchRobotJob(STOP)).status).not.toBe("rejected");
  });

  it("★ HUNG robots read ⇒ motion refused within the robot DB-step deadline (bounded, explicit), a STOP unaffected", async () => {
    S.mode = "hang-robots";
    const t0 = Date.now();
    const r = await Promise.race([dispatchRobotJob(MOTION), new Promise<"HUNG">((res) => setTimeout(() => res("HUNG"), STOP_DB_STEP_DEADLINE_MS + 1500))]);
    expect(r).not.toBe("HUNG");
    expect(r).toMatchObject({ status: "rejected", error: ROBOT_DISABLED_REASON_CODE });
    expect(Date.now() - t0).toBeLessThan(STOP_DB_STEP_DEADLINE_MS + 700);
    const t1 = Date.now();
    expect((await dispatchRobotJob(STOP)).status).not.toBe("rejected");
    expect(Date.now() - t1).toBeLessThan(500);
  });
});
