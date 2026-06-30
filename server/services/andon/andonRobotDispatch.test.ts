/**
 * S1-c (doc 16 Khối 3) — Andon → robot dispatch loop tests.
 *
 * In-memory fake db keyed on the REAL drizzle column .name; taskAllocator is mocked
 * (fleetOrchEnabled + allocateTask). Asserts: a 'call'/help Andon for a dispatchable
 * reason creates an assist task + allocates when both flags on; no-op when the dispatch
 * flag is off; no-op when fleet is off; no-op for a non-dispatchable Andon; idempotent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __op: "eq", __k: col?.name, __v: val }),
}));

type Row = Record<string, any>;
const store: Record<string, Row[]> = { tasks: [] };
const seq: Record<string, number> = {};
function nextId(t: string): number { seq[t] = (seq[t] ?? 0) + 1; return seq[t]; }
function reset() { for (const k of Object.keys(store)) store[k] = []; for (const k of Object.keys(seq)) seq[k] = 0; }
function tableName(t: any): string {
  const sym = Object.getOwnPropertySymbols(t).find((s) => String(s).includes("Name"));
  return sym ? (t as any)[sym] : t?._?.name;
}
function matchPred(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  return true;
}
function makeFakeDb() {
  return {
    select: () => ({
      from: (t: any) => {
        const name = tableName(t);
        let pred: any = null;
        const q: any = {
          where: (p: any) => { pred = p; return q; },
          limit: async (n: number) => (store[name] ?? []).filter((r) => matchPred(r, pred)).slice(0, n),
        };
        return q;
      },
    }),
    insert: (t: any) => ({
      values: (vals: Row) => ({
        returning: async () => {
          const name = tableName(t);
          const row = { id: nextId(name), ...vals };
          store[name].push(row);
          return [{ id: row.id }];
        },
      }),
    }),
  };
}
vi.mock("../../db/connection", () => ({ getDb: async () => makeFakeDb() }));

const allocateTask = vi.fn(async (_id: number) => ({ ok: true, enabled: true, assignedDeviceId: 42 }));
vi.mock("../fleet/taskAllocator", () => ({
  fleetOrchEnabled: () => process.env.FLEET_ORCH_ENABLED === "true",
  allocateTask: (...a: any[]) => allocateTask(...a),
}));

import { maybeDispatchRobotForAndon } from "./andonRobotDispatch";

function andon(over: Partial<Row> = {}): any {
  return { id: 1, state: "call", reason: "maintenance", status: "raised", title: "help", stationId: 10, lineId: 1, machineId: null, ...over };
}

beforeEach(() => {
  reset();
  allocateTask.mockClear();
  delete process.env.ANDON_ROBOT_DISPATCH_ENABLED;
  delete process.env.FLEET_ORCH_ENABLED;
});

describe("maybeDispatchRobotForAndon", () => {
  it("flag OFF → no-op", async () => {
    const r = await maybeDispatchRobotForAndon(andon());
    expect(r.enabled).toBe(false);
    expect(store.tasks).toHaveLength(0);
    expect(allocateTask).not.toHaveBeenCalled();
  });

  it("dispatch flag ON but FLEET off → no task created", async () => {
    process.env.ANDON_ROBOT_DISPATCH_ENABLED = "true";
    const r = await maybeDispatchRobotForAndon(andon());
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/FLEET_ORCH_ENABLED off/);
    expect(store.tasks).toHaveLength(0);
  });

  it("both flags ON + dispatchable help → creates assist task + allocates", async () => {
    process.env.ANDON_ROBOT_DISPATCH_ENABLED = "true";
    process.env.FLEET_ORCH_ENABLED = "true";
    const r = await maybeDispatchRobotForAndon(andon());
    expect(r.ok).toBe(true);
    expect(r.taskId).toBeDefined();
    expect(r.assignedDeviceId).toBe(42);
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0].taskKey).toBe("andon:1:assist");
    expect(store.tasks[0].requiredCapability).toBe("run_job");
    expect(allocateTask).toHaveBeenCalledWith(r.taskId);
  });

  it("non-'call' Andon (e.g. red/quality) → no-op even with flags on", async () => {
    process.env.ANDON_ROBOT_DISPATCH_ENABLED = "true";
    process.env.FLEET_ORCH_ENABLED = "true";
    const r = await maybeDispatchRobotForAndon(andon({ state: "red", reason: "quality" }));
    expect(r.ok).toBe(false);
    expect(store.tasks).toHaveLength(0);
  });

  it("non-dispatchable reason (safety) → no-op", async () => {
    process.env.ANDON_ROBOT_DISPATCH_ENABLED = "true";
    process.env.FLEET_ORCH_ENABLED = "true";
    const r = await maybeDispatchRobotForAndon(andon({ reason: "safety" }));
    expect(r.ok).toBe(false);
    expect(store.tasks).toHaveLength(0);
  });

  it("idempotent: re-dispatch the same Andon reuses the assist task", async () => {
    process.env.ANDON_ROBOT_DISPATCH_ENABLED = "true";
    process.env.FLEET_ORCH_ENABLED = "true";
    await maybeDispatchRobotForAndon(andon());
    await maybeDispatchRobotForAndon(andon());
    expect(store.tasks).toHaveLength(1);
  });
});
