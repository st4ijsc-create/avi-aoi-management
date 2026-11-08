/**
 * Phase E4 — Factory Control Plane: EDGE CONTROL RUNTIME tests (vitest).
 *
 * Covers:
 *   • node register / heartbeat; stale → offline (markStaleNodesOffline).
 *   • assignRun sets orchestration_runs.edgeNodeId.
 *   • syncRunResult reconciles steps IDEMPOTENTLY (replay upserts, no dup).
 *   • offline buffer queues when central unreachable + replays idempotently on reconnect.
 *   • executeAssignedRun REUSES foeEngine (mocked) in dry-run.
 *   • flag-off → every mutating entry point is a disabled no-op.
 *   • fail-safe — a thrown engine error → buffered, no crash.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── tiny in-memory drizzle stand-in (only the chains the coordinator uses) ──
import { getTableName } from "drizzle-orm";
import type { StartRunResult } from "../orchestration/foe/foeEngine";

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

function colName(col: any): string {
  return col?.name ?? col?.config?.name ?? String(col);
}

// `eq`/`desc`/`and`/`lt`/`inArray` are mocked to capture predicate descriptors.
vi.mock("drizzle-orm", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (col: any, val: unknown) => ({ __op: "eq", col, val }),
    lt: (col: any, val: unknown) => ({ __op: "lt", col, val }),
    inArray: (col: any, vals: unknown[]) => ({ __op: "inArray", col, vals }),
    and: (...conds: any[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
    desc: (col: any) => ({ __op: "desc", col }),
  };
});

function matchOne(r: Row, cond: any): boolean {
  if (!cond) return true;
  switch (cond.__op) {
    case "eq": return r[colName(cond.col)] === cond.val;
    case "lt": {
      const v = r[colName(cond.col)];
      return v != null && new Date(v).getTime() < new Date(cond.val).getTime();
    }
    case "inArray": return cond.vals.includes(r[colName(cond.col)]);
    case "and": return cond.conds.every((c: any) => matchOne(r, c));
    default: return true;
  }
}
function applyWhere(list: Row[], cond: any): Row[] {
  if (!cond) return list;
  return list.filter((r) => matchOne(r, cond));
}

function makeSelect(tableName: string) {
  let current = [...rows(tableName)];
  const chain: any = {
    from() { current = [...rows(tableName)]; return chain; },
    where(cond: any) { current = applyWhere(current, cond); return chain; },
    orderBy() { return chain; },
    limit(n: number) { return Promise.resolve(current.slice(0, n)); },
    then(res: any, rej: any) { return Promise.resolve(current).then(res, rej); },
  };
  return chain;
}

const fakeDb = {
  async execute() { return []; }, // R-11-p: registerNode sets "protocolVersion" = 2 through raw SQL
  select() {
    const c: any = { from(t: any) { return makeSelect(tbl(t)).from(); } };
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
      returning() { rows(tableName).push(...pending); return Promise.resolve(pending); },
      onConflictDoUpdate(opts: any) {
        const list = rows(tableName);
        for (const row of pending) {
          const existing = list.find((r) => r.runId === row.runId && r.stepId === row.stepId);
          if (existing) Object.assign(existing, opts.set);
          else list.push(row);
        }
        return Promise.resolve();
      },
      then(res: any, rej: any) { rows(tableName).push(...pending); return Promise.resolve(pending).then(res, rej); },
    };
    return ins;
  },
  update(t: any) {
    const tableName = tbl(t);
    let patch: Row = {};
    const upd: any = {
      set(p: Row) { patch = p; return upd; },
      where(cond: any) {
        const matched = applyWhere(rows(tableName), cond);
        for (const r of matched) Object.assign(r, patch);
        return Promise.resolve();
      },
      returning() {
        // returning() is called after where() in the coordinator; emulate by
        // re-resolving from the last set+match — but the coordinator chains
        // .where(...).returning(). We approximate: return the matched rows.
        return Promise.resolve([]);
      },
    };
    // support .where(...).returning()
    const origWhere = upd.where.bind(upd);
    upd.where = (cond: any) => {
      const matched = applyWhere(rows(tableName), cond);
      for (const r of matched) Object.assign(r, patch);
      upd.__matched = matched;
      return upd;
    };
    upd.returning = () => Promise.resolve(upd.__matched ?? []);
    void origWhere;
    return upd;
  },
};

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => fakeDb) }));

// ── mock the shared FOE engine (executeAssignedRun must REUSE it, not fork) ──
function defaultGetRun(runId: number) {
  return {
    run: { id: runId, status: "completed", error: null, currentStepId: null, startedAt: new Date(), finishedAt: new Date() },
    steps: [
      { stepId: "s1", stepType: "command", status: "completed", attempt: 1, result: { simulated: true }, error: null, startedAt: new Date(), finishedAt: new Date() },
    ],
  };
}
const { startRunMock, getRunMock, abortRunMock } = vi.hoisted(() => ({
  startRunMock: vi.fn(async (..._a: unknown[]): Promise<StartRunResult> => ({ ok: true, enabled: true, runId: 1, status: "completed" as const })),
  /** doc 81 Đợt 7 I1 — the LOCAL abort the edge runs when central stopped the run. */
  abortRunMock: vi.fn(async (runId: number, ..._a: unknown[]) => ({ ok: true, enabled: true, runId, status: "aborted" as const })),
  getRunMock: vi.fn(async (runId: number) => defaultGetRun(runId)),
}));
vi.mock("../orchestration/foe/foeEngine", () => ({
  startRun: startRunMock,
  getRun: getRunMock,
  abortRun: abortRunMock,
  foeEnabled: () => true,
}));

import {
  registerNode,
  heartbeat,
  listNodes,
  markStaleNodesOffline,
  assignRun,
  syncRunResult,
  edgeRuntimeEnabled,
} from "./edgeCoordinator";
import {
  executeAssignedRun,
  setCentralSync,
  replayBuffer,
  bufferedCount,
  _clearBuffer,
  EDGE_CENTRAL_ABORT_USER,
} from "./edgeRuntime";
import { FOE_REJECT_CLAIM_CTX_KEY } from "../orchestration/foe/foeGateApproval";
import { KET_CUC_KHONG_RO_CHOT_CTX_KEY, KET_CUC_KHONG_RO_DA_BAO_CTX_KEY, loiGiuChuaRa } from "../orchestration/foe/foeKetCucKhongRo"; // A2(n) T7c
import { stopChuaRaTuHang } from "../orchestration/foe/foeRunStore"; // A2(n) T12-P4

function reset() {
  store.clear();
  seqs.clear();
  startRunMock.mockClear();
  getRunMock.mockClear();
  abortRunMock.mockClear();
  _clearBuffer();
  process.env.EDGE_ABORT_POLL_MS = "50";
  process.env.EDGE_RUNTIME_ENABLED = "true";
  // seed one workflow run + node
  store.set("orchestration_runs", [
    { id: 1, workflowId: 10, workflowRef: "wf-1", status: "queued", paramsJson: {}, contextJson: {}, edgeNodeId: null, startedBy: 5, createdAt: new Date() },
  ]);
  // final wave F4 — the principals that started runs centrally (the edge starts the run AS them, with their REAL role)
  store.set("users", [
    { id: 5, role: "admin", isActive: true, name: "admin" },
    { id: 6, role: "engineer", isActive: true, name: "eng" },
    { id: 7, role: "engineer", isActive: false, name: "disabled" },
  ]);
}

beforeEach(reset);

// ════════════════════════════════════════════════════════════════════════════════
describe("edge node registry", () => {
  it("registers a node online with a heartbeat", async () => {
    const res = await registerNode({ code: "edge-1", name: "Line 1", factoryCode: "F1" });
    expect(res.ok).toBe(true);
    expect(res.data?.status).toBe("online");
    expect(res.data?.lastHeartbeatAt).toBeTruthy();

    const list = await listNodes();
    expect(list.length).toBe(1);
    expect(list[0].code).toBe("edge-1");
  });

  it("re-register upserts (no duplicate) and refreshes heartbeat", async () => {
    await registerNode({ code: "edge-1", name: "Line 1" });
    await registerNode({ code: "edge-1", name: "Line 1 renamed", version: "2.0" });
    const list = await listNodes();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("Line 1 renamed");
    expect(list[0].version).toBe("2.0");
  });

  it("heartbeat refreshes status + health; rejects unknown node", async () => {
    await registerNode({ code: "edge-1" });
    const hb = await heartbeat({ code: "edge-1", status: "degraded", health: { q: 3 } });
    expect(hb.ok).toBe(true);
    expect(hb.data?.status).toBe("degraded");

    const miss = await heartbeat({ code: "nope" });
    expect(miss.ok).toBe(false);
    expect(miss.message).toMatch(/not registered/i);
  });

  it("marks a stale node OFFLINE past the threshold", async () => {
    await registerNode({ code: "edge-1" });
    // backdate the heartbeat 10 minutes
    rows("edge_nodes")[0].lastHeartbeatAt = new Date(Date.now() - 10 * 60_000);
    const flipped = await markStaleNodesOffline(2);
    expect(flipped).toContain("edge-1");
    expect(rows("edge_nodes")[0].status).toBe("offline");
  });

  it("does NOT flip a fresh node", async () => {
    await registerNode({ code: "edge-1" });
    const flipped = await markStaleNodesOffline(2);
    expect(flipped).not.toContain("edge-1");
    expect(rows("edge_nodes")[0].status).toBe("online");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe("run assignment", () => {
  it("assignRun sets edgeNodeId on the run", async () => {
    const node = await registerNode({ code: "edge-1" });
    const res = await assignRun(1, node.data!.id);
    expect(res.ok).toBe(true);
    expect(rows("orchestration_runs")[0].edgeNodeId).toBe(node.data!.id);
  });

  it("rejects a terminal run", async () => {
    const node = await registerNode({ code: "edge-1" });
    rows("orchestration_runs")[0].status = "completed";
    const res = await assignRun(1, node.data!.id);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/terminal/i);
  });

  it("rejects an unknown node", async () => {
    const res = await assignRun(1, 999);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not found/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe("syncRunResult reconcile (idempotent)", () => {
  it("upserts step rows; a replay does NOT duplicate", async () => {
    const node = await registerNode({ code: "edge-1" });
    await assignRun(1, node.data!.id);

    const payload = {
      edgeNodeCode: "edge-1",
      runId: 1,
      status: "completed",
      steps: [
        { stepId: "s1", stepType: "command", status: "completed", attempt: 1, result: { ok: true } },
        { stepId: "s2", stepType: "command", status: "completed", attempt: 1 },
      ],
    };
    const first = await syncRunResult(payload as never);
    expect(first.ok).toBe(true);
    expect(first.data?.stepsApplied).toBe(2);
    expect(rows("orchestration_run_steps").length).toBe(2);

    // REPLAY the same payload → still 2 rows (idempotent on runId+stepId)
    const second = await syncRunResult(payload as never);
    expect(second.ok).toBe(true);
    expect(rows("orchestration_run_steps").length).toBe(2);
    expect(rows("orchestration_runs")[0].status).toBe("completed");
  });

  it("doc 81 Đợt 4 fix round 1 (R-4-h): a synced step result is stamped approvalSource 'edge' — a forged server approval never survives", async () => {
    const node = await registerNode({ code: "edge-1" });
    await assignRun(1, node.data!.id);
    const res = await syncRunResult({
      edgeNodeCode: "edge-1",
      runId: 1,
      status: "held",
      currentStepId: "bogus",
      steps: [
        { stepId: "G", stepType: "hitl_gate", status: "completed", attempt: 0, result: { approved: true, approvedBy: 4242, approvalSource: "server", defHash: "x" } },
        { stepId: "s1", stepType: "command", status: "completed", attempt: 1 },
      ],
    } as never);
    expect(res.ok).toBe(true);
    const g = rows("orchestration_run_steps").find((r: any) => r.stepId === "G") as any;
    expect(g.resultJson).toMatchObject({ approved: true, approvedBy: 4242, approvalSource: "edge" });
    const s1 = rows("orchestration_run_steps").find((r: any) => r.stepId === "s1") as any;
    expect(s1.resultJson).toBeNull();
  });

  it("rejects a sync for a run assigned to a DIFFERENT node", async () => {
    await registerNode({ code: "edge-1" });
    const other = await registerNode({ code: "edge-2" });
    await assignRun(1, other.data!.id);
    const res = await syncRunResult({ edgeNodeCode: "edge-1", runId: 1, status: "completed", steps: [] } as never);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not assigned/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe("edge runtime — offline buffer + replay + foeEngine reuse", () => {
  it("executeAssignedRun reuses foeEngine.startRun and syncs when central reachable", async () => {
    setCentralSync(async () => true); // central reachable
    const res = await executeAssignedRun({ id: 1, workflowId: 10, workflowRef: "wf-1", paramsJson: {}, startedBy: 5 });
    expect(res.ok).toBe(true);
    expect(startRunMock).toHaveBeenCalledOnce();
    expect(getRunMock).toHaveBeenCalledWith(1);
    expect(res.synced).toBe(true);
    expect(bufferedCount()).toBe(0);
  });

  it("BUFFERS when central is unreachable, then REPLAYS idempotently on reconnect", async () => {
    let reachable = false;
    const calls: number[] = [];
    setCentralSync(async (p) => { calls.push(p.runId); return reachable; });

    const res = await executeAssignedRun({ id: 1, workflowId: 10, workflowRef: "wf-1", paramsJson: {}, startedBy: 6 });
    expect(res.ok).toBe(true);
    expect(res.synced).toBe(false);
    expect(res.buffered).toBe(true);
    expect(bufferedCount()).toBe(1);

    // reconnect → replay drains the buffer
    reachable = true;
    const drained = await replayBuffer();
    expect(drained.drained).toBe(1);
    expect(bufferedCount()).toBe(0);
    // central received the same runId twice (offline attempt + replay) — idempotent.
    expect(calls.filter((r) => r === 1).length).toBe(2);
  });

  it("FAIL-SAFE: a thrown engine error is buffered, never crashes", async () => {
    startRunMock.mockRejectedValueOnce(new Error("boom"));
    getRunMock.mockRejectedValueOnce(new Error("boom"));
    setCentralSync(async () => false);
    const res = await executeAssignedRun({ id: 1, workflowId: 10, workflowRef: "wf-1", startedBy: 6 });
    expect(res.ok).toBe(false);
    expect(res.status).toBe("failed");
    expect(res.buffered).toBe(true);
    expect(bufferedCount()).toBe(1);
  });

  // doc 81 Đợt 5 final wave F4 (final review M1) — the edge starts a run AS the principal that started it centrally, with
  // that account's REAL role (its real factory scope; an admin keeps the admin bypass), never as an anonymous "edge" role
  // (which resolved an empty / wrong scope). No principal, an unknown or a disabled account ⇒ NOT started (fail-closed).
  it("★ F4: the run is started AS its starting principal with the account's REAL role (admin keeps the admin bypass)", async () => {
    setCentralSync(async () => true);
    await executeAssignedRun({ id: 1, workflowId: 10, workflowRef: "wf-1", paramsJson: {}, startedBy: 5 });
    // (4th argument since doc 81 Đợt 7 I1: { onStarted } — the edge watches central for an abort while the run walks)
    expect(startRunMock).toHaveBeenLastCalledWith("wf-1", {}, expect.objectContaining({ id: 5, role: "admin" }), { workflowId: 10, onStarted: expect.any(Function) });
    await executeAssignedRun({ id: 1, workflowId: 10, workflowRef: "wf-1", paramsJson: {}, startedBy: 6 });
    expect(startRunMock).toHaveBeenLastCalledWith("wf-1", {}, expect.objectContaining({ id: 6, role: "engineer" }), { workflowId: 10, onStarted: expect.any(Function) });
  });

  // doc 81 Đợt 7 final wave F2 — the edge starts the CENTRAL run's workflow by its id; without it the run is not started.
  for (const [label, workflowId] of [["no workflowId", undefined], ["a null workflowId", null], ["a non-integer workflowId", 1.5], ["workflowId 0", 0]] as const) {
    it(`★ F2: ${label} ⇒ the engine is NOT called (fail-closed), a failed result is buffered`, async () => {
      setCentralSync(async () => false);
      const res = await executeAssignedRun({ id: 1, workflowId, workflowRef: "wf-1", paramsJson: {}, startedBy: 5 });
      expect(startRunMock).not.toHaveBeenCalled();
      expect(res).toMatchObject({ ok: false, status: "failed", buffered: true });
      expect(res.message).toMatch(/no central workflow id/);
    });
  }

  it("★ F2: the engine is called with the central workflowId pin (never by the plain ref alone)", async () => {
    setCentralSync(async () => true);
    await executeAssignedRun({ id: 1, workflowId: 42, workflowRef: "wf-1", paramsJson: {}, startedBy: 6 });
    expect(startRunMock).toHaveBeenCalledOnce();
    expect(startRunMock.mock.calls[0][3]).toMatchObject({ workflowId: 42 });
  });

  for (const [label, startedBy] of [["no principal", null], ["an unknown account", 999], ["a disabled account", 7]] as const) {
    it(`★ F4: ${label} ⇒ the engine is NOT called (fail-closed), a failed result is buffered / synced`, async () => {
      setCentralSync(async () => false);
      const res = await executeAssignedRun({ id: 1, workflowId: 10, workflowRef: "wf-1", paramsJson: {}, startedBy });
      expect(startRunMock).not.toHaveBeenCalled();
      expect(res.ok).toBe(false);
      expect(res.status).toBe("failed");
      expect(res.message).toMatch(/starting principal/);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// doc 81 Đợt 7 task I1 — a CENTRAL abort / rejection stops the walker of a run executing on an edge node
// ════════════════════════════════════════════════════════════════════════════════
describe("doc 81 Đợt 7 I1 — central: an edge sync never overwrites a central abort / rejection, and tells the edge to stop", () => {
  const run1 = () => rows("orchestration_runs")[0];
  const ABORTED_AT = new Date("2026-10-11T01:00:00Z");

  it("★ an 'aborted' run keeps status / error / finish time / context; the edge's step rows are recorded; abortRequested", async () => {
    Object.assign(run1(), { status: "aborted", error: "Aborted by user 12.", finishedAt: ABORTED_AT, contextJson: { foeDispatchedSteps: ["s1"] } });
    const res = await syncRunResult({
      edgeNodeCode: "edge-x",
      runId: 1,
      status: "completed",
      error: null,
      currentStepId: "s9",
      finishedAt: new Date("2026-10-11T02:00:00Z"),
      contextJson: { wiped: true },
      steps: [{ stepId: "s1", stepType: "command", status: "completed", attempt: 1 }],
    } as never);
    expect(res).toMatchObject({ ok: true, data: { abortRequested: true, stepsApplied: 1 } });
    expect(run1()).toMatchObject({ status: "aborted", error: "Aborted by user 12.", finishedAt: ABORTED_AT, contextJson: { foeDispatchedSteps: ["s1"] } });
    expect(rows("orchestration_run_steps").map((r: any) => r.stepId)).toEqual(["s1"]);
  });

  it("★ a run CLAIMED by a central rejection (claim token, 'compensating') is not rewritten either; abortRequested", async () => {
    Object.assign(run1(), { status: "compensating", contextJson: { [FOE_REJECT_CLAIM_CTX_KEY]: "tok-1" } });
    const res = await syncRunResult({ edgeNodeCode: "edge-x", runId: 1, status: "running", steps: [] } as never);
    expect(res).toMatchObject({ ok: true, data: { abortRequested: true } });
    expect(run1()).toMatchObject({ status: "compensating", contextJson: { [FOE_REJECT_CLAIM_CTX_KEY]: "tok-1" } });
  });

  it("★ the abort lands BETWEEN the sync's read and its write ⇒ the write changes nothing (compare-and-set), abortRequested", async () => {
    Object.assign(run1(), { status: "running" });
    // the step upsert runs between the read and the run-level write: land the central abort right there
    const realInsert = fakeDb.insert;
    (fakeDb as any).insert = (t: any) => {
      // a NEW row object (another writer's committed update) — the sync's own read of the row keeps the old status
      const list = rows("orchestration_runs");
      list[0] = { ...list[0], status: "aborted", error: "Aborted by user 12." };
      return realInsert(t);
    };
    try {
      const res = await syncRunResult({ edgeNodeCode: "edge-x", runId: 1, status: "completed", steps: [{ stepId: "s1", stepType: "command", status: "completed" }] } as never);
      expect(res).toMatchObject({ ok: true, data: { abortRequested: true } });
    } finally {
      (fakeDb as any).insert = realInsert;
    }
    expect(run1()).toMatchObject({ status: "aborted", error: "Aborted by user 12." });
  });

  it("★ an edge never writes central's `abort:<id>` STOP-sweep rows, nor sets / clears the rejection claim token", async () => {
    Object.assign(run1(), { status: "running", contextJson: {} });
    const res = await syncRunResult({
      edgeNodeCode: "edge-x",
      runId: 1,
      status: "running",
      contextJson: { [FOE_REJECT_CLAIM_CTX_KEY]: "forged", k: 1 },
      steps: [
        { stepId: "abort:stop", stepType: "command", status: "completed", result: { abortStop: "sent", stepId: "stop" } },
        { stepId: "s1", stepType: "command", status: "running" },
      ],
    } as never);
    expect(res).toMatchObject({ ok: true, data: { abortRequested: false, stepsApplied: 1 } });
    expect(rows("orchestration_run_steps").map((r: any) => r.stepId)).toEqual(["s1"]);
    expect(run1().contextJson).toEqual({ k: 1 });
  });

  for (const done of ["completed", "failed"] as const) {
    it(`★ fix 1 (I-1): a ${done} run is never moved back by a stale NON-terminal payload (no status / step rewrite)`, async () => {
      Object.assign(run1(), { status: done, finishedAt: ABORTED_AT });
      rows("orchestration_run_steps").push({ id: 900, runId: 1, stepId: "s1", status: "completed" });
      const res = await syncRunResult({ edgeNodeCode: "edge-x", runId: 1, status: "running", steps: [{ stepId: "s1", stepType: "command", status: "running" }] } as never);
      expect(res).toMatchObject({ ok: true, data: { stale: true, stepsApplied: 0 } });
      expect(run1()).toMatchObject({ status: done, finishedAt: ABORTED_AT });
      expect(rows("orchestration_run_steps").find((r: any) => r.stepId === "s1")!.status).toBe("completed");
      // a TERMINAL replay (the same final payload again) is idempotent and still never moves the run
      const again = await syncRunResult({ edgeNodeCode: "edge-x", runId: 1, status: done, steps: [] } as never);
      expect(again).toMatchObject({ ok: true, data: { stale: true } });
      expect(run1().status).toBe(done);
    });
  }

  it("control: a run central has NOT stopped advances as before (abortRequested false)", async () => {
    const res = await syncRunResult({ edgeNodeCode: "edge-x", runId: 1, status: "completed", steps: [] } as never);
    expect(res).toMatchObject({ ok: true, data: { abortRequested: false } });
    expect(run1().status).toBe("completed");
  });
});

describe("doc 81 Đợt 7 I1 — edge: central's abort request stops the LOCAL walker (non-STOP steps), via the shared engine's abort", () => {
  /** startRun that creates local run 77, reports it, then "walks" until abortRun is called (or `ms` elapse). */
  const walkingStart = (ms = 3000) =>
    startRunMock.mockImplementationOnce(async (...a: unknown[]) => {
      (a[3] as { onStarted: (id: number) => void }).onStarted(77);
      const until = Date.now() + ms;
      while (abortRunMock.mock.calls.length === 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
      return { ok: false, enabled: true, runId: 77, status: abortRunMock.mock.calls.length ? ("aborted" as const) : ("completed" as const) };
    });

  it("★ a progress sync during the walk answers abortRequested ⇒ the local run 77 is aborted once, as the edge system user", async () => {
    walkingStart();
    const seen: Array<{ runId: number; status: string }> = [];
    setCentralSync(async (p) => {
      seen.push({ runId: p.runId, status: p.status });
      return { ack: true, abortRequested: true };
    });
    const t0 = Date.now();
    const res = await executeAssignedRun({ id: 1, workflowId: 10, workflowRef: "wf-1", paramsJson: {}, startedBy: 5 });
    expect(Date.now() - t0).toBeLessThan(1500); // stopped by the abort, not by the 3 s walk
    expect(abortRunMock).toHaveBeenCalledTimes(1);
    expect(abortRunMock.mock.calls[0][0]).toBe(77); // the LOCAL run
    expect(abortRunMock.mock.calls[0][1]).toEqual({ ...EDGE_CENTRAL_ABORT_USER });
    expect(EDGE_CENTRAL_ABORT_USER.id).toBe(0);
    expect(seen.every((x) => x.runId === 1)).toBe(true); // synced under the CENTRAL run id
    expect(getRunMock).toHaveBeenCalledWith(77); // progress + final read of the LOCAL run
    expect(res.ok).toBe(true);
  });

  it("★ central unreachable during the walk ⇒ no abort can be learned: the walk goes on, said loudly; nothing aborted", async () => {
    walkingStart(400);
    setCentralSync(async () => false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const res = await executeAssignedRun({ id: 1, workflowId: 10, workflowRef: "wf-1", paramsJson: {}, startedBy: 5 });
      expect(res).toMatchObject({ ok: true, buffered: true });
      expect(abortRunMock).not.toHaveBeenCalled();
      expect(warn.mock.calls.map((c) => String(c[0])).some((l) => /central unreachable.*cannot be learned/.test(l))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("★ the FINAL sync (e.g. the run paused at a gate here) answers abortRequested ⇒ the local run is aborted", async () => {
    startRunMock.mockImplementationOnce(async (...a: unknown[]) => {
      (a[3] as { onStarted: (id: number) => void }).onStarted(78);
      return { ok: true, enabled: true, runId: 78, status: "awaiting_confirm" as const };
    });
    setCentralSync(async () => ({ ack: true, abortRequested: true }));
    await executeAssignedRun({ id: 1, workflowId: 10, workflowRef: "wf-1", paramsJson: {}, startedBy: 5 });
    expect(abortRunMock.mock.calls.map((c) => c[0])).toEqual([78]);
    expect(getRunMock.mock.calls.map((c) => c[0])).toEqual([78]); // the final payload is read from the LOCAL run
  });

  it("★ a BUFFERED payload replayed later gets abortRequested ⇒ the local run is aborted then", async () => {
    startRunMock.mockImplementationOnce(async (...a: unknown[]) => {
      (a[3] as { onStarted: (id: number) => void }).onStarted(79);
      return { ok: true, enabled: true, runId: 79, status: "awaiting_confirm" as const };
    });
    let online = false;
    setCentralSync(async () => (online ? { ack: true, abortRequested: true } : false));
    await executeAssignedRun({ id: 1, workflowId: 10, workflowRef: "wf-1", paramsJson: {}, startedBy: 5 });
    expect(abortRunMock).not.toHaveBeenCalled();
    online = true;
    await replayBuffer();
    expect(abortRunMock.mock.calls.map((c) => c[0])).toEqual([79]);
  });

  it("★ fix 1 (I-1): a progress sync IN FLIGHT when the walk ends lands BEFORE the final sync (stop awaits it); the last payload central gets is the final one", async () => {
    let walkDone = false;
    startRunMock.mockImplementationOnce(async (...a: unknown[]) => {
      (a[3] as { onStarted: (id: number) => void }).onStarted(80);
      await new Promise((r) => setTimeout(r, 120)); // ≥ 1 progress tick starts (poll 50 ms)
      walkDone = true;
      return { ok: true, enabled: true, runId: 80, status: "completed" as const };
    });
    getRunMock.mockImplementation(async (runId: number) => ({
      run: { id: runId, status: walkDone ? "completed" : "running", error: null, currentStepId: null, startedAt: new Date(), finishedAt: walkDone ? new Date() : null },
      steps: [],
    }) as never);
    const got: string[] = [];
    setCentralSync(async (p) => {
      if (p.status === "running") await new Promise((r) => setTimeout(r, 200)); // a SLOW progress sync
      got.push(p.status);
      return true;
    });
    try {
      await executeAssignedRun({ id: 1, workflowId: 10, workflowRef: "wf-1", paramsJson: {}, startedBy: 5 });
    } finally {
      getRunMock.mockImplementation(async (runId: number) => defaultGetRun(runId) as never);
    }
    expect(got.length).toBeGreaterThanOrEqual(2);
    expect(got.at(-1)).toBe("completed");
    expect(got.slice(0, -1).every((x) => x === "running")).toBe(true);
  });

  it("★ fix 1 (I-1): progress syncs never touch the offline buffer — a failed progress buffers nothing; the buffered FINAL payload is never replaced by a stale one", async () => {
    let walkDone = false;
    let bufferedDuringWalk = -1;
    startRunMock.mockImplementationOnce(async (...a: unknown[]) => {
      (a[3] as { onStarted: (id: number) => void }).onStarted(81);
      await new Promise((r) => setTimeout(r, 160));
      bufferedDuringWalk = bufferedCount(); // failed progress syncs happened by now
      walkDone = true;
      return { ok: true, enabled: true, runId: 81, status: "completed" as const };
    });
    getRunMock.mockImplementation(async (runId: number) => ({
      run: { id: runId, status: walkDone ? "completed" : "running", error: null, currentStepId: null, startedAt: null, finishedAt: null },
      steps: [],
    }) as never);
    const seen: string[] = [];
    let online = false;
    setCentralSync(async (p) => {
      seen.push(`${p.status}:${online}`);
      return online;
    });
    try {
      await executeAssignedRun({ id: 1, workflowId: 10, workflowRef: "wf-1", paramsJson: {}, startedBy: 5 });
      expect(seen.filter((x) => x.startsWith("running")).length).toBeGreaterThan(0); // progress was tried (and failed)
      expect(bufferedDuringWalk).toBe(0); // … and buffered nothing
      expect(bufferedCount()).toBe(1); // only the FINAL payload
      online = true;
      seen.length = 0;
      await replayBuffer();
      expect(seen).toEqual(["completed:true"]);
    } finally {
      getRunMock.mockImplementation(async (runId: number) => defaultGetRun(runId) as never);
    }
  });

  it("control: central answers a plain `true` (no abort) ⇒ nothing aborted", async () => {
    walkingStart(200);
    setCentralSync(async () => true);
    await executeAssignedRun({ id: 1, workflowId: 10, workflowRef: "wf-1", paramsJson: {}, startedBy: 5 });
    expect(abortRunMock).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe("doc 81 Đợt 8 task Q1 — no central transport wired ⇒ an assigned run is NOT started (a central abort could never reach it)", () => {
  it("★ setCentralSync never called on this host ⇒ the engine is NOT called, a failed result is buffered (fail-closed)", async () => {
    // reset() → _clearBuffer() also forgets the wired transport (a fresh host)
    const res = await executeAssignedRun({ id: 1, workflowId: 10, workflowRef: "wf-1", paramsJson: {}, startedBy: 5 });
    expect(startRunMock).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false, enabled: true, runId: 1, status: "failed", buffered: true });
    expect(res.message).toMatch(/no central sync transport/);
    expect(bufferedCount()).toBe(1);
  });

  it("control: once the host wires a transport (even one that is unreachable right now), the run starts as before", async () => {
    setCentralSync(async () => false); // wired, central currently unreachable ⇒ offline execution is allowed (Đợt 7 I1)
    const res = await executeAssignedRun({ id: 1, workflowId: 10, workflowRef: "wf-1", paramsJson: {}, startedBy: 5 });
    expect(startRunMock).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe("flag-off no-op", () => {
  beforeEach(() => { process.env.EDGE_RUNTIME_ENABLED = "false"; });

  it("edgeRuntimeEnabled() reflects the flag", () => {
    expect(edgeRuntimeEnabled()).toBe(false);
  });

  it("registerNode / heartbeat / assignRun / syncRunResult return disabled", async () => {
    expect((await registerNode({ code: "x" })).enabled).toBe(false);
    expect((await heartbeat({ code: "x" })).enabled).toBe(false);
    expect((await assignRun(1, 1)).enabled).toBe(false);
    expect((await syncRunResult({ edgeNodeCode: "x", runId: 1, status: "completed", steps: [] } as never)).enabled).toBe(false);
  });

  it("executeAssignedRun is a disabled no-op (does NOT touch foeEngine)", async () => {
    const res = await executeAssignedRun({ id: 1, workflowId: 10, workflowRef: "wf-1" });
    expect(res.enabled).toBe(false);
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("replayBuffer is a no-op when disabled", async () => {
    const r = await replayBuffer();
    expect(r.enabled).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe("A2(n) T7c — central: a sync never ends, nor rewrites, a latched run (plan point 3 row 16: refused, the rows and the latch stay)", () => {
  const run1 = () => rows("orchestration_runs")[0];
  const CHOT = { stepId: "x", ma: "FOE_OUTCOME_UNKNOWN", at: "2026-11-08T00:00:00.000Z" };
  const DA_BAO = { stepId: "x", at: "2026-11-08T00:00:01.000Z" };
  /** the STOP central could not send: the row of state C (foeRunStore.laHangChuaRa), written by its own writer */
  const hangSt = () => ({ id: 801, runId: 1, stepId: "st", stepType: "command", status: "failed", attempt: 1, resultJson: null, error: loiGiuChuaRa("st", { nguon: "tuChoi", ma: "CHUA_GHIM_STOP" }) });
  /** the step whose outcome is unknown: the code on its row */
  const hangX = () => ({ id: 802, runId: 1, stepId: "x", stepType: "command", status: "failed", attempt: 1, resultJson: null, error: "FOE_OUTCOME_UNKNOWN: command x may have reached the device" });
  const PAYLOAD_XONG = {
    edgeNodeCode: "edge-x",
    runId: 1,
    status: "completed",
    error: null,
    currentStepId: "end",
    finishedAt: new Date("2026-11-08T03:00:00Z"),
    contextJson: { k: 1 },
    steps: [
      { stepId: "st", stepType: "command", status: "completed", attempt: 2 },
      { stepId: "x", stepType: "command", status: "completed", attempt: 2 },
      { stepId: "s9", stepType: "command", status: "completed", attempt: 1 },
    ],
  };
  const anh = () => JSON.stringify({ run: rows("orchestration_runs"), steps: rows("orchestration_run_steps") });
  const tuChoi = async (payload: Record<string, unknown>, lyDo: RegExp) => {
    const truoc = anh();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const res = await syncRunResult(payload as never);
      expect(res).toMatchObject({ ok: false, enabled: true });
      expect(res.data).toBeUndefined();
      expect(res.message).toMatch(/^EDGE_SYNC_RUN_LATCHED: run 1 /);
      expect(res.message).toMatch(lyDo);
      expect(anh()).toBe(truoc); // the step rows, the context, the status: byte for byte
      expect(warn.mock.calls.some((c) => /run 1\b/.test(String(c[0])) && lyDo.test(String(c[0])))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  };

  it("★ T7C-SYNC-KHOA a held run, latched, its STOP not sent, no assignment, a 'completed' payload: refused; st, the latch, DA_BAO and 'held' stay", async () => {
    Object.assign(run1(), { status: "held", contextJson: { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: CHOT, [KET_CUC_KHONG_RO_DA_BAO_CTX_KEY]: DA_BAO, foeDispatchedSteps: ["x"] } });
    rows("orchestration_run_steps").push(hangX(), hangSt());
    await tuChoi(PAYLOAD_XONG, /\(chot\)/);
    expect(run1().status).toBe("held");
    expect(run1().contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toEqual(CHOT);
    expect(rows("orchestration_run_steps").find((r: any) => r.stepId === "st")!.error).toMatch(/^FOE_STOP_NOT_SENT: STOP "st"/);
    expect(rows("orchestration_run_steps").some((r: any) => r.stepId === "s9")).toBe(false);
  });

  it("★ T7C-SYNC-KHOA the latch in the context alone (no row yet): refused", async () => {
    Object.assign(run1(), { status: "running", contextJson: { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: CHOT } });
    await tuChoi(PAYLOAD_XONG, /\(chot\)/);
  });

  it("★ T7C-SYNC-KHOA the latch on the rows alone (chotTuHang: the code on x's row), context clean: refused", async () => {
    Object.assign(run1(), { status: "running", contextJson: {} });
    rows("orchestration_run_steps").push(hangX());
    await tuChoi(PAYLOAD_XONG, /\(hangKhongRo\)/);
  });

  it("★ T7C-SYNC-KHOA a STOP still owed on the rows alone (stopChuaRaTuHang), context clean: refused", async () => {
    Object.assign(run1(), { status: "held", contextJson: {} });
    rows("orchestration_run_steps").push(hangSt());
    await tuChoi(PAYLOAD_XONG, /\(stopChuaRa\)/);
  });

  /** T7c fix 1 (P1) — a latched run central has STOPPED: nothing written, the stale answer (no new field), so the edge is told to stop. */
  const dungBao = async (payload: Record<string, unknown>, lyDo: RegExp) => {
    const truoc = anh();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const res = await syncRunResult(payload as never);
      expect(res).toEqual({ ok: true, enabled: true, data: { runId: 1, stepsApplied: 0, abortRequested: true, stale: true } });
      expect(anh()).toBe(truoc); // the step rows, the context, the status: byte for byte
      expect(warn.mock.calls.some((c) => /EDGE_SYNC_RUN_LATCHED/.test(String(c[0])) && /run 1\b/.test(String(c[0])) && lyDo.test(String(c[0])))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  };

  it("★ T7C-KHOA-ABORTED an aborted latched run, a terminal payload: nothing written (st stays), the answer tells the edge to stop (ok, abortRequested)", async () => {
    Object.assign(run1(), { status: "aborted", error: "Aborted by user 12.", contextJson: { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: CHOT } });
    rows("orchestration_run_steps").push(hangSt());
    await dungBao(PAYLOAD_XONG, /\(chot\)/);
    expect(rows("orchestration_run_steps").find((r: any) => r.stepId === "st")!.error).toMatch(/^FOE_STOP_NOT_SENT: STOP "st"/);
  });

  it("★ T7C-KHOA-ABORTED a latched run under a central rejection (compensating + claim), a progress payload: nothing written, abortRequested", async () => {
    Object.assign(run1(), { status: "compensating", contextJson: { [FOE_REJECT_CLAIM_CTX_KEY]: "tok", [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: CHOT } });
    await dungBao({ ...PAYLOAD_XONG, status: "running" }, /\(chot\)/);
  });

  for (const [tag, ctx, coSt] of [
    ["a STOP owed on the rows", { [FOE_REJECT_CLAIM_CTX_KEY]: "tok" }, true],
    ["the latch in the context", { [FOE_REJECT_CLAIM_CTX_KEY]: "tok", [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: CHOT }, false],
  ] as const) {
    it(`★ T7C-KHOA-DUNG-CLAIM central 'compensating' + claim, ${tag}, the edge walking: the real sync's answer reaches the edge, its walker stops (abortRun), st and the run stay`, async () => {
      Object.assign(run1(), { status: "compensating", contextJson: { ...ctx } });
      if (coSt) rows("orchestration_run_steps").push(hangSt());
      const truoc = anh();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      // the edge's own view says st completed: a sync that wrote would overwrite central's row of state C
      getRunMock.mockImplementation(async (runId: number) => ({ run: { id: runId, status: "running", error: null, currentStepId: "s1", startedAt: new Date(), finishedAt: null }, steps: [{ stepId: "st", stepType: "command", status: "completed", attempt: 2, result: null, error: null, startedAt: new Date(), finishedAt: new Date() }] }) as never);
      // the local walk: goes on until the edge aborts it, at most 1.2 s
      let ketThucWalk = "";
      startRunMock.mockImplementationOnce(async (...a: unknown[]) => {
        (a[3] as { onStarted: (id: number) => void }).onStarted(77);
        const until = Date.now() + 1200;
        while (abortRunMock.mock.calls.length === 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
        ketThucWalk = abortRunMock.mock.calls.length ? "aborted" : "completed";
        return { ok: true, enabled: true, runId: 77, status: ketThucWalk as "aborted" | "completed" };
      });
      // the transport as a host maps central's answer (POST /edge/sync 202 data / tRPC data): ack = ok
      setCentralSync(async (p) => {
        const r = await syncRunResult(p as never);
        return { ack: r.ok === true, abortRequested: (r.data as { abortRequested?: boolean } | undefined)?.abortRequested === true };
      });
      try {
        const res = await executeAssignedRun({ id: 1, workflowId: 10, workflowRef: "wf-1", paramsJson: {}, startedBy: 5 });
        expect(abortRunMock).toHaveBeenCalledTimes(1);
        expect(abortRunMock.mock.calls[0]![0]).toBe(77);
        expect(ketThucWalk).toBe("aborted"); // the local walk ended because the edge aborted it, not by running out
        expect(res.ok).toBe(true);
        expect(bufferedCount()).toBe(0); // every answer acknowledged: nothing left to replay
        expect(anh()).toBe(truoc);
      } finally {
        getRunMock.mockImplementation(async (runId: number) => defaultGetRun(runId) as never);
        warn.mockRestore();
      }
    });
  }

  it("★ T7C-TIEN-DO-HELD a held latched run, a PROGRESS payload ('running'): refused, the run stays 'held', st stays", async () => {
    Object.assign(run1(), { status: "held", contextJson: { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: CHOT } });
    rows("orchestration_run_steps").push(hangSt());
    await tuChoi({ ...PAYLOAD_XONG, status: "running", finishedAt: null }, /\(chot\)/);
    expect(run1().status).toBe("held");
    expect(rows("orchestration_run_steps").find((r: any) => r.stepId === "st")!.error).toMatch(/^FOE_STOP_NOT_SENT: STOP "st"/);
  });

  it("★ T7C-NGU-CANH-MANG the run context is an array: refused (nguCanhKhongDoc), nothing written", async () => {
    Object.assign(run1(), { status: "running", contextJson: ["a"] });
    await tuChoi(PAYLOAD_XONG, /\(nguCanhKhongDoc\)/);
  });

  it("★ T7C-HANG-KHONG-MANG the step rows read back as something not an array: refused with the code (hangKhongDoc), nothing written", async () => {
    Object.assign(run1(), { status: "running", contextJson: {} });
    const realSelect = fakeDb.select;
    (fakeDb as any).select = () => ({
      from(t: any) {
        if (tbl(t) === "orchestration_run_steps") return { where: () => Promise.resolve({ not: "an array" }) };
        return makeSelect(tbl(t)).from();
      },
    });
    try {
      await tuChoi(PAYLOAD_XONG, /\(hangKhongDoc\)/);
    } finally {
      (fakeDb as any).select = realSelect;
    }
  });

  it("★ T7C-SYNC-KHONG-DOC the step rows cannot be read: refused (nothing can say no STOP is owed), nothing written", async () => {
    Object.assign(run1(), { status: "running", contextJson: {} });
    const realSelect = fakeDb.select;
    (fakeDb as any).select = () => ({
      from(t: any) {
        if (tbl(t) === "orchestration_run_steps") throw new Error("read failed");
        return makeSelect(tbl(t)).from();
      },
    });
    try {
      await tuChoi(PAYLOAD_XONG, /\(hangKhongDoc\)/);
    } finally {
      (fakeDb as any).select = realSelect;
    }
  });

  it("★ T7C-SYNC-KHONG-DOC the run context is not an object: refused, nothing written", async () => {
    Object.assign(run1(), { status: "running", contextJson: "garbled" });
    await tuChoi(PAYLOAD_XONG, /\(nguCanhKhongDoc\)/);
  });

  it("control T7C-CHUA-KHOA a run NOT latched, no assignment, a valid payload: written as before", async () => {
    Object.assign(run1(), { status: "running", contextJson: { foeDispatchedSteps: ["s1"] } });
    const res = await syncRunResult(PAYLOAD_XONG as never);
    expect(res).toMatchObject({ ok: true, data: { runId: 1, stepsApplied: 3, abortRequested: false } });
    expect(run1()).toMatchObject({ status: "completed", contextJson: { k: 1 }, currentStepId: "end" });
    expect(rows("orchestration_run_steps").map((r: any) => r.stepId)).toEqual(["st", "x", "s9"]);
  });

  it("control T7C-CHUA-KHOA a STOP the sweep already sent (abort:st completed) owes nothing: written as before", async () => {
    Object.assign(run1(), { status: "running", contextJson: {} });
    rows("orchestration_run_steps").push(hangSt(), { id: 803, runId: 1, stepId: "abort:st", stepType: "command", status: "completed", attempt: 1, resultJson: { stepId: "st" }, error: null });
    const res = await syncRunResult(PAYLOAD_XONG as never);
    expect(res).toMatchObject({ ok: true, data: { stepsApplied: 3, abortRequested: false } });
    expect(run1().status).toBe("completed");
  });

  it("control an edge node syncing its own run (not latched): written as before", async () => {
    const node = await registerNode({ code: "edge-own" });
    await assignRun(1, node.data!.id);
    const res = await syncRunResult({ ...PAYLOAD_XONG, edgeNodeCode: "edge-own" } as never);
    expect(res).toMatchObject({ ok: true, data: { stepsApplied: 3, abortRequested: false } });
    expect(run1().status).toBe("completed");
  });

  it("control a run under the node protocol (a run_edge_assignments row), latched or not: the refusal stays the node-protocol one", async () => {
    Object.assign(run1(), { status: "held", contextJson: { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: CHOT } });
    rows("orchestration_run_edge_assignments").push({ id: 1, runId: 1, edgeNodeId: 3 });
    const truoc = anh();
    const res = await syncRunResult(PAYLOAD_XONG as never);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/executed by an edge node under the node protocol/);
    expect(anh()).toBe(truoc);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe("A2(n) T12 (P4, red until T12) — a payload that itself carries the latch, on a run NOT latched", () => {
  const run1 = () => rows("orchestration_runs")[0];
  it("T12-P4-PAYLOAD-MANG-KHOA a 'completed' payload with x FOE_OUTCOME_UNKNOWN and st FOE_STOP_NOT_SENT: the run is not ended outside the gate, st stays owed", async () => {
    Object.assign(run1(), { status: "running", contextJson: {} });
    const res = await syncRunResult({
      edgeNodeCode: "edge-x",
      runId: 1,
      status: "completed",
      contextJson: { k: 1 },
      steps: [
        { stepId: "x", stepType: "command", status: "failed", attempt: 1, error: "FOE_OUTCOME_UNKNOWN: command x may have reached the device" },
        { stepId: "st", stepType: "command", status: "failed", attempt: 1, error: loiGiuChuaRa("st", { nguon: "tuChoi", ma: "CHUA_GHIM_STOP" }) },
      ],
    } as never);
    void res;
    expect(run1().status).not.toBe("completed");
    expect(stopChuaRaTuHang(rows("orchestration_run_steps") as never).has("st")).toBe(true);
  });
});
