/**
 * R1b-2b-2a T2B (backlog 78) - the engine does NOT resend a command whose dispatch result is `timeout` (outcome unknown)
 * for a NON-STOP step (precedent: outcomeUnknownOf); a real `failed` is still retried; a STOP is still retried.
 * Real engine + in-memory drizzle stand-in (same harness as foe.test.ts); only the dispatchers are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock the EXISTING dispatchers (E0 routes sendCommand here in dry-run) ──
const { otDispatchMock, robotDispatchMock } = vi.hoisted(() => ({
  otDispatchMock: vi.fn(async () => ({
    ok: true,
    simulated: true,
    status: "simulated" as const,
    results: [],
    commandLogIds: [1],
  })),
  robotDispatchMock: vi.fn(async () => ({ ok: true, status: "simulated" as const, jobId: 7 })),
}));
// the REAL stop-type predicate (the engine classifies a STOP with it); only dispatch is mocked
vi.mock("../../ot/commandDispatcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/commandDispatcher")>();
  return { isStopCommandType: orig.isStopCommandType, dispatch: otDispatchMock };
});
vi.mock("../../robot/robotCommandDispatcher", () => ({ dispatchRobotJob: robotDispatchMock }));

// ── tiny in-memory drizzle stand-in (only the chains the engine uses) ──
import { getTableName } from "drizzle-orm";

type Row = Record<string, any>;
const store = new Map<string, Row[]>();
const seqs = new Map<string, number>();

function tbl(t: any): string {
  return getTableName(t);
}
function nextId(name: string): number {
  const n = (seqs.get(name) ?? 0) + 1;
  seqs.set(name, n);
  return n;
}
function rows(name: string): Row[] {
  let r = store.get(name);
  if (!r) {
    r = [];
    store.set(name, r);
  }
  return r;
}

// `eq`/`desc` are mocked to capture {col,val}; WHERE is applied as JS.
vi.mock("drizzle-orm", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (col: any, val: unknown) => ({ __op: "eq", col, val }),
    desc: (col: any) => ({ __op: "desc", col }),
    // doc 80 ORC-01/02 — engine dùng UPDATE có điều kiện (and/ne/inArray/notInArray) + returning().
    and: (...conds: any[]) => ({ __op: "and", conds }),
    ne: (col: any, val: unknown) => ({ __op: "ne", col, val }),
    inArray: (col: any, vals: unknown[]) => ({ __op: "in", col, vals }),
    notInArray: (col: any, vals: unknown[]) => ({ __op: "notIn", col, vals }),
  };
});

function colName(col: any): string {
  return col?.name ?? col?.config?.name ?? String(col);
}
function matchCond(r: Row, cond: any): boolean {
  if (!cond) return true;
  switch (cond.__op) {
    case "eq": return r[colName(cond.col)] === cond.val;
    case "ne": return r[colName(cond.col)] !== cond.val;
    case "in": return cond.vals.includes(r[colName(cond.col)]);
    case "notIn": return !cond.vals.includes(r[colName(cond.col)]);
    case "and": return cond.conds.every((c: any) => matchCond(r, c));
    default: return true;
  }
}
function applyWhere(list: Row[], cond: any): Row[] {
  if (!cond) return list;
  return list.filter((r) => matchCond(r, cond));
}

function makeSelect(tableName: string) {
  let current = [...rows(tableName)];
  const chain: any = {
    from() {
      current = [...rows(tableName)];
      return chain;
    },
    where(cond: any) {
      current = applyWhere(current, cond);
      return chain;
    },
    orderBy() {
      return chain;
    },
    limit(n: number) {
      return Promise.resolve(current.slice(0, n));
    },
    then(res: any, rej: any) {
      return Promise.resolve(current).then(res, rej);
    },
  };
  return chain;
}

const fakeDb = {
  select() {
    let tableName = "";
    const c: any = {
      from(t: any) {
        tableName = tbl(t);
        return makeSelect(tableName).from();
      },
    };
    return c;
  },
  insert(t: any) {
    const tableName = tbl(t);
    let pending: Row[] = [];
    const ins: any = {
      values(v: Row | Row[]) {
        const arr = Array.isArray(v) ? v : [v];
        pending = arr.map((row) => ({ id: nextId(tableName), ...row }));
        return ins;
      },
      returning() {
        rows(tableName).push(...pending);
        return Promise.resolve(pending);
      },
      onConflictDoUpdate(opts: any) {
        // upsert on (runId, stepId) for run_steps
        const list = rows(tableName);
        for (const row of pending) {
          const existing = list.find((r) => r.runId === row.runId && r.stepId === row.stepId);
          if (existing) Object.assign(existing, opts.set);
          else list.push(row);
        }
        return Promise.resolve();
      },
      then(res: any, rej: any) {
        rows(tableName).push(...pending);
        return Promise.resolve(pending).then(res, rej);
      },
    };
    return ins;
  },
  update(t: any) {
    const tableName = tbl(t);
    let patch: Row = {};
    const upd: any = {
      set(p: Row) {
        patch = p;
        return upd;
      },
      where(cond: any) {
        const matched = applyWhere(rows(tableName), cond);
        for (const r of matched) Object.assign(r, patch);
        const result = matched.map((r) => ({ ...r }));
        return {
          returning: () => Promise.resolve(result),
          then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
        };
      },
    };
    return upd;
  },
  // doc 81 Đợt 9 final wave F4 — the edge hand-back of an approval is one transaction; this in-memory fake runs the callback on
  // itself (no rollback modelled — the atomicity is measured on the real DB: edgeExecution.fw.dot9fw.db.test.ts).
  transaction(fn: (tx: unknown) => unknown) {
    return Promise.resolve().then(() => fn(fakeDb));
  },
};

vi.mock("../../../db/connection", () => ({
  getDb: vi.fn(async () => fakeDb),
}));

import {
  validateWorkflow,
  evaluateCondition,
  type WorkflowDefinition,
} from "./workflowModel";
import {
  deployWorkflow,
  rollbackWorkflow,
  startRun,
  resumeRun,
  getRun,
  rehydrateInterruptedRuns,
} from "./foeEngine";

const USER = { id: 42, role: "admin", name: "tester" };
/**
 * doc 81 Đợt 4 Task A5 (QĐ-4a option (a)) — an OT/robot step now runs only after an earlier hitl_gate of the run
 * approved by someone OTHER than the run owner (USER). Tests about engine mechanics put a gate `gate0` first and have
 * APPROVER approve it; the gate rule itself is tested in foeGateApproval.dot4.test.ts.
 */
const APPROVER = { id: 77, role: "admin", name: "approver" };
function withGate0(def: WorkflowDefinition): WorkflowDefinition {
  return { ...def, steps: [{ id: "gate0", type: "hitl_gate", prompt: "Approve the run" }, ...def.steps] };
}
/** Start as USER, then APPROVER approves gate0 (the run pauses there first). */
async function startApproved(ref: string, params: Record<string, unknown> = {}) {
  const r = await startRun(ref, params, USER);
  expect(r.status).toBe("awaiting_confirm");
  return resumeRun(r.runId!, { approved: true }, APPROVER);
}

// Seed machines: id 1 = AUTOMATION (ot-opcua, supports start/stop), id 2 = AOI (vision).
function seedMachines() {
  store.set("machines", [
    { id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "Auto-1", operationStatus: "stopped", stationId: 1 },
    { id: 2, machineType: "AOI", capabilities: null, code: "M2", name: "Aoi-1", operationStatus: "stopped", stationId: 1 },
  ]);
  // doc 81 Đợt 4 fix round 1 (R-4-d): an OT step writes through the adapter BOUND to its machine (no more adapterId = machineId).
  store.set("device_adapters", [{ id: 501, machineId: 1, isEnabled: true }]);
}

function reset() {
  store.clear();
  seqs.clear();
  otDispatchMock.mockClear();
  robotDispatchMock.mockClear();
  process.env.FOE_ENABLED = "true";
  process.env.OT_CONTROL_ENABLED = ""; // dry-run (the existing dispatcher is mocked anyway)
  seedMachines();
}

beforeEach(() => { reset(); otDispatchMock.mockReset(); });

const TIMEOUT = { ok: false, simulated: false, status: "timeout", results: [], commandLogIds: [] } as never;
const FAILED = { ok: false, simulated: false, status: "rejected", results: [], commandLogIds: [] } as never;

function def(ref: string, command: string, withComp: boolean): WorkflowDefinition {
  return {
    ref,
    name: ref,
    steps: [
      {
        id: "main",
        type: "command",
        machineId: 1,
        command,
        maxAttempts: 2, // 3 attempts in all
        ...(withComp ? { compensation: { id: "undo", type: "command", machineId: 1, command: "stop" } } : {}),
      },
    ],
  };
}
async function run(d: WorkflowDefinition) {
  const dep = await deployWorkflow(withGate0(d), USER);
  expect(dep.ok).toBe(true);
  return startApproved(d.ref);
}

describe("T2B - no resend after an unknown outcome", () => {
  it("non-STOP + dispatch timeout => dispatched EXACTLY once, failed with FOE_OUTCOME_UNKNOWN, compensation once", async () => {
    otDispatchMock.mockResolvedValue(TIMEOUT);
    // the compensation (a stop) also times out - it is a STOP and keeps its own behaviour; count only the main command
    const res = await run(def("t2b-1", "start", true));
    expect(res.status).toBe("failed");
    const types = otDispatchMock.mock.calls.map((c: any) => c[0].commandType);
    expect(types.filter((t: string) => t === "start")).toHaveLength(1);
    const view = await getRun(res.runId!);
    const main = view?.steps.find((s) => s.stepId === "main");
    expect(main?.status).toBe("failed");
    expect(String(main?.error)).toContain("FOE_OUTCOME_UNKNOWN");
    expect(String(main?.error)).toMatch(/not sent again/);
    expect(types).toContain("stop"); // compensation ran
  });

  it("control: non-STOP + dispatch failed (device answered an error) => retried to maxAttempts (3)", async () => {
    otDispatchMock.mockResolvedValue(FAILED);
    const res = await run(def("t2b-2", "start", false));
    expect(res.status).toBe("failed");
    expect(otDispatchMock.mock.calls.filter((c: any) => c[0].commandType === "start")).toHaveLength(3);
    const main = (await getRun(res.runId!))?.steps.find((s) => s.stepId === "main");
    expect(String(main?.error)).not.toContain("FOE_OUTCOME_UNKNOWN");
  });

  it("STOP + dispatch timeout => still retried to maxAttempts (3), never held back as unknown", async () => {
    otDispatchMock.mockResolvedValue(TIMEOUT);
    const res = await run(def("t2b-3", "stop", false));
    expect(res.status).toBe("failed");
    expect(otDispatchMock.mock.calls.filter((c: any) => c[0].commandType === "stop")).toHaveLength(3);
    const main = (await getRun(res.runId!))?.steps.find((s) => s.stepId === "main");
    expect(String(main?.error)).not.toContain("FOE_OUTCOME_UNKNOWN");
  });
});
