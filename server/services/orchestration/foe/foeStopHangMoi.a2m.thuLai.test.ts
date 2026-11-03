/**
 * SCADA R1b-2b-2a A2(m) fix round 1 — the walker's retry budget of a STOP step is decided PER ATTEMPT, and the pause between pinned-STOP
 * retries is really awaited. Real engine (execStep retry loop, central store) + in-memory drizzle stand-in (the harness of
 * foeKhongGuiLaiKhiKhongRo.r1b2b2.test.ts); only the dispatchers and the pinned-STOP predicate (`phanLoaiStopGhimChoFoe`) are mocked.
 *   • pinned on attempt 1, NOT pinned on attempt 2 (pins removed) ⇒ no attempt 3 (a non-pinned stop-typed step gets one attempt, R-5-j);
 *   • pinned on every attempt ⇒ 3 attempts, the 2nd ≥ 250 ms and the 3rd ≥ 500 ms after the previous one (stopGhimLuiMs, awaited);
 *   • explicit maxAttempts 0 ⇒ 1 attempt even when pinned; never pinned ⇒ 1 attempt.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock the EXISTING dispatchers (E0 routes sendCommand here in dry-run) ──
const { otDispatchMock, robotDispatchMock, phanLoaiMock, alertMock } = vi.hoisted(() => ({
  alertMock: vi.fn(async (_a: Record<string, unknown>) => undefined),
  phanLoaiMock: vi.fn(async (_db: unknown, _input: unknown) => ({ pinnedStop: false, loiDocGhim: null as string | null })),
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
  return { isStopCommandType: orig.isStopCommandType, dispatch: otDispatchMock, phanLoaiStopGhimChoFoe: phanLoaiMock };
});
vi.mock("../../robot/robotCommandDispatcher", () => ({ dispatchRobotJob: robotDispatchMock }));
vi.mock("../../robot/criticalStopAlert", async (orig) => ({ ...((await orig()) as Record<string, unknown>), raiseCriticalStopAlert: alertMock }));

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

import type { WorkflowDefinition } from "./workflowModel";
import { deployWorkflow, startRun, resumeRun, getRun } from "./foeEngine";

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


beforeEach(() => {
  reset();
  otDispatchMock.mockReset();
  phanLoaiMock.mockReset();
  phanLoaiMock.mockImplementation(async () => ({ pinnedStop: false, loiDocGhim: null }));
  alertMock.mockReset();
  alertMock.mockImplementation(async () => undefined);
});

const FAILED = { ok: false, simulated: false, status: "failed", results: [], commandLogIds: [] } as never;

function defStop(ref: string, maxAttempts?: number): WorkflowDefinition {
  return { ref, name: ref, steps: [{ id: "main", type: "command", machineId: 1, command: "stop", args: { tagKey: "a", value: 0 }, ...(maxAttempts === undefined ? {} : { maxAttempts }) }] };
}
async function run(d: WorkflowDefinition) {
  const dep = await deployWorkflow(withGate0(d), USER);
  expect(dep.ok).toBe(true);
  return startApproved(d.ref);
}
const stopCalls = () => otDispatchMock.mock.calls.filter((c: any) => c[0].commandType === "stop");

describe("A2(m) fix 1 — pinned-STOP retry budget per attempt; the pause is awaited", () => {
  it("★ pinned on attempt 1, NOT pinned on attempt 2 (pins removed) ⇒ NO attempt 3 — the STOP default is not sticky", async () => {
    let n = 0;
    phanLoaiMock.mockImplementation(async () => ({ pinnedStop: ++n === 1, loiDocGhim: null }));
    otDispatchMock.mockResolvedValue(FAILED);
    const res = await run(defStop("a2m-f1-a"));
    expect(res.status).toBe("failed");
    expect(stopCalls()).toHaveLength(2);
    const main = (await getRun(res.runId!))?.steps.find((s) => s.stepId === "main");
    expect(main?.attempt).toBe(2);
    // attempt 1 rode on a fresh (pinned) row, attempt 2 on the deterministic one
    const ids = stopCalls().map((c: any) => String(c[0].triggeredBy?.actionId));
    expect(ids[0]).toMatch(/^foe-run\d+-main-a1#stop-a1-/);
    expect(ids[1]).toMatch(/^foe-run\d+-main-a2$/);
  });

  it("★ pinned on every attempt ⇒ 3 attempts, each retry AFTER its pause (≥ 250 ms, then ≥ 500 ms) — the sleep is awaited", async () => {
    phanLoaiMock.mockImplementation(async () => ({ pinnedStop: true, loiDocGhim: null }));
    const at: number[] = [];
    otDispatchMock.mockImplementation(async () => {
      at.push(performance.now());
      return FAILED;
    });
    const res = await run(defStop("a2m-f1-b"));
    expect(res.status).toBe("failed");
    expect(stopCalls()).toHaveLength(3);
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(240); // 250 ms pause (small timer slack)
    expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(490); // 500 ms pause
  });

  it("explicit maxAttempts 0 ⇒ ONE attempt even when pinned; never pinned (maxAttempts unset) ⇒ ONE attempt", async () => {
    phanLoaiMock.mockImplementation(async () => ({ pinnedStop: true, loiDocGhim: null }));
    otDispatchMock.mockResolvedValue(FAILED);
    await run(defStop("a2m-f1-c", 0));
    expect(stopCalls()).toHaveLength(1);
    otDispatchMock.mockClear();
    phanLoaiMock.mockImplementation(async () => ({ pinnedStop: false, loiDocGhim: null }));
    await run(defStop("a2m-f1-d"));
    expect(stopCalls()).toHaveLength(1);
  });
});

// ── kiem-dinh's surviving mutants of A2(m): r7 (alert for a non-STOP step) and e9 (stopGhim leaks into the outcome) ──
const pinAlerts = () => alertMock.mock.calls.filter((c) => (c[0] as Record<string, unknown>).kind === "foe_stop_pin_unverified");
const settle = () => new Promise<void>((r) => setTimeout(r, 60)); // the alert is raised fire-and-forget (dynamic import): let it land

function defStart(ref: string): WorkflowDefinition {
  return { ref, name: ref, steps: [{ id: "main", type: "command", machineId: 1, command: "start", args: { tagKey: "a", value: 1 } }] };
}
const OK = { ok: true, simulated: true, status: "simulated", results: [], commandLogIds: [1] } as never;

describe("A2(m)-test r7 — the URGENT 'pin not verified' alert is for a STOP step only", () => {
  it("★ a NON-STOP step whose pin read throws / reports an error ⇒ the step still runs, 0 URGENT alerts", async () => {
    otDispatchMock.mockResolvedValue(OK);
    for (const [i, impl] of [
      async () => {
        throw new Error("pins table gone");
      },
      async () => ({ pinnedStop: false, loiDocGhim: "connection reset" as string | null }),
    ].entries()) {
      phanLoaiMock.mockImplementation(impl as never);
      const res = await run(defStart(`a2m-t-r7-${i}`));
      expect(res.status).toBe("completed");
    }
    expect(phanLoaiMock).toHaveBeenCalled(); // the pin read really happened for the non-STOP step (else this proves nothing)
    await settle();
    expect(pinAlerts()).toHaveLength(0);
  });

  it("positive control: a STOP step with the SAME read error ⇒ exactly ONE URGENT alert (run / step / adapter)", async () => {
    phanLoaiMock.mockImplementation(async () => {
      throw new Error("pins table gone");
    });
    otDispatchMock.mockResolvedValue(OK);
    const res = await run(defStop("a2m-t-r7-ctl"));
    expect(res.status).toBe("completed");
    await vi.waitFor(() => expect(pinAlerts()).toHaveLength(1));
    await settle();
    expect(pinAlerts()).toHaveLength(1);
    const a = pinAlerts()[0]![0] as Record<string, any>;
    expect(a.dedupKey).toBe(`foe_stop_pin_unverified:${res.runId}:main:501`);
    expect(a.message).toMatch(/: pins table gone\./);
  });
});

describe("A2(m)-test e9 — the stopGhim flag never leaves the step (outcome after the attempts are exhausted)", () => {
  it("★ a pinned STOP whose 3 attempts all fail, inside a sequence: the container's own retry loop sees NO flag ⇒ exactly 3 sends (not 9)", async () => {
    // execStep's outcome is only observable through its container: execSequence returns the child's outcome as is, and the CONTAINER's retry loop
    // would treat a leaked `stopGhim: true` (unset maxAttempts) as 'pinned STOP' and re-run the whole child 3 times over.
    phanLoaiMock.mockImplementation(async () => ({ pinnedStop: true, loiDocGhim: null }));
    otDispatchMock.mockResolvedValue(FAILED);
    const d: WorkflowDefinition = { ref: "a2m-t-e9", name: "a2m-t-e9", steps: [{ id: "seq", type: "sequence", steps: [{ id: "main", type: "command", machineId: 1, command: "stop", args: { tagKey: "a", value: 0 } }] }] };
    const res = await run(d);
    expect(res.status).toBe("failed");
    expect(stopCalls()).toHaveLength(3);
    const steps = (await getRun(res.runId!))?.steps ?? [];
    expect(steps.find((s) => s.stepId === "main")?.attempt).toBe(3);
    expect(steps.find((s) => s.stepId === "seq")?.attempt).toBe(1); // the container ran ONCE
  });
});
