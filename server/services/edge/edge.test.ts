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
const { startRunMock, getRunMock } = vi.hoisted(() => ({
  startRunMock: vi.fn(async () => ({ ok: true, enabled: true, runId: 1, status: "completed" as const })),
  getRunMock: vi.fn(async (runId: number) => ({
    run: { id: runId, status: "completed", error: null, currentStepId: null, startedAt: new Date(), finishedAt: new Date() },
    steps: [
      { stepId: "s1", stepType: "command", status: "completed", attempt: 1, result: { simulated: true }, error: null, startedAt: new Date(), finishedAt: new Date() },
    ],
  })),
}));
vi.mock("../orchestration/foe/foeEngine", () => ({
  startRun: startRunMock,
  getRun: getRunMock,
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
} from "./edgeRuntime";

function reset() {
  store.clear();
  seqs.clear();
  startRunMock.mockClear();
  getRunMock.mockClear();
  _clearBuffer();
  process.env.EDGE_RUNTIME_ENABLED = "true";
  // seed one workflow run + node
  store.set("orchestration_runs", [
    { id: 1, workflowId: 10, workflowRef: "wf-1", status: "queued", paramsJson: {}, contextJson: {}, edgeNodeId: null, startedBy: 5, createdAt: new Date() },
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
    const res = await executeAssignedRun({ id: 1, workflowRef: "wf-1", paramsJson: {}, startedBy: 5 });
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

    const res = await executeAssignedRun({ id: 1, workflowRef: "wf-1", paramsJson: {} });
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
    const res = await executeAssignedRun({ id: 1, workflowRef: "wf-1" });
    expect(res.ok).toBe(false);
    expect(res.status).toBe("failed");
    expect(res.buffered).toBe(true);
    expect(bufferedCount()).toBe(1);
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
    const res = await executeAssignedRun({ id: 1, workflowRef: "wf-1" });
    expect(res.enabled).toBe(false);
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("replayBuffer is a no-op when disabled", async () => {
    const r = await replayBuffer();
    expect(r.enabled).toBe(false);
  });
});
