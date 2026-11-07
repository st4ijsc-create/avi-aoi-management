/**
 * Đĩa edge treo (a2n) — the CENTRAL half, both layers. No database: FakeDb with drizzle's operators as predicates (the read filters and the durable 24 h
 * dedup against real rows are edgeJournalStallAlert.a2n.db.test). The STOP analysis and raiseCriticalStopAlert are stubbed: what is measured here is what
 * central decides to say, to whom, how often.
 *   LAYER 1 — `progress` with journalStalledSinceMs, through the REAL progressForNodeV2: one URGENT per (node, stall), naming the node, its runs, the STOPs
 *             central cannot confirm and Abort; never a failure of `progress`.
 *   THE END OF IT — EDGE_JOURNAL_STALL_RECOVERED: one URGENT; healthy=false ⇒ it says the node still refuses non-STOP until restarted.
 *   LAYER 2 — baoRunMatProgress: a run central holds as running whose node stopped reporting. It needs nothing from the edge, so it speaks in the two
 *             shapes layer 1 cannot: every libuv thread held (no `progress`, no `pull`) and a walker that ended while `complete` waits on the disk. It stays
 *             quiet for a node that went down by the book (restart ⇒ interrupted; held ⇒ claim cleared), no claim, an ended run, a central that just booted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  alerts: [] as Array<Record<string, any>>,
  raiseThrows: false,
  /** verified STOPs of each run (edgeRunAnalysis stub) */
  stops: new Map<number, string[]>(),
  analysisThrows: new Set<number>(),
  docClaimLoi: false,
  docClaimTreo: null as null | Promise<void>,
}));

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  type R = Record<string, unknown>;
  return {
    ...actual,
    eq: (c: { name: string }, v: unknown) => (r: R) => r[c.name] === v,
    gt: (c: { name: string }, v: any) => (r: R) => (r[c.name] as any) > v,
    isNotNull: (c: { name: string }) => (r: R) => r[c.name] != null,
    inArray: (c: { name: string }, vs: unknown[]) => (r: R) => vs.includes(r[c.name]),
    and: (...cs: unknown[]) => (r: R) => cs.every((x) => typeof x !== "function" || (x as (q: R) => boolean)(r)), // an sql`…` part is the CAS guard, not modelled
    asc: (c: { name: string }) => ({ name: c.name, dir: "asc" }),
  };
});
const dbGia = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../../db/connection", () => ({ getDb: async () => dbGia.db }));
vi.mock("../robot/criticalStopAlert", () => ({
  raiseCriticalStopAlert: async (a: Record<string, unknown>) => {
    if (H.raiseThrows) throw new Error("raise failed");
    H.alerts.push(a);
  },
}));
vi.mock("./edgeCentralCommon", async (orig) => ({ ...(await orig<typeof import("./edgeCentralCommon")>()), nodeProtocolVersion: async () => 2 }));
vi.mock("./edgeNodeCommands", async (orig) => ({ ...(await orig<typeof import("./edgeNodeCommands")>()), commandsForNode: async () => ({ signed: [], unsignedStops: [], incomplete: false }) }));
vi.mock("./edgeRunAnalysis", async (orig) => ({
  ...(await orig<typeof import("./edgeRunAnalysis")>()),
  loadMachineMap: async () => new Map(),
  analyseDefinition: async (_d: unknown, runId: number) => {
    if (H.analysisThrows.has(runId)) throw new Error("analysis unreadable");
    return { verifiedStops: (H.stops.get(runId) ?? []).map((stepId) => ({ kind: "robot", stepId, robotId: 12 })), stopsUnsure: [], resolvedAdapters: [], robotIds: [], adapterIds: [], unresolved: [] };
  },
}));
vi.mock("./edgeReportsCentral", async (orig) => ({ ...(await orig<typeof import("./edgeReportsCentral")>()), assignedDefinition: async () => ({ steps: [] }) }));

import { orchestrationRunSteps } from "../../../drizzle/schema";
import { FakeDb, resetSeq } from "../../routers/__otFakeDb";
import { __edgeConfigAlertsSettledForTests, __resetEdgeConfigAlertsForTests, alertForEdgeAnomaly } from "./edgeConfigCentral";
import { choDen, edgeTrenDiaGia, thuMucTam, type EdgeTrenDiaGia } from "./edgeDiskStall.testkit";
import { EDGE_JOURNAL_STALL_ALERT_MS } from "./edgeExecutionAgent";
import { __resetJournalTreoForTests, baoJournalTreo, baoRunMatProgress, edgeClaimStaleMs, edgeProgressLostAlertMs, progressForNodeV2 } from "./edgeExecutionCentral";
import { EDGE_JOURNAL_STALL_RECOVERED_CODE, edgeProgressRequestSchema } from "./edgeProtocol";
import { hashEdgeSecret, type EdgeNodePrincipal } from "./edgeNodeCredentials";
import { z } from "zod";

type Row = Record<string, any>;
const NODE = { nodeId: 7, nodeCode: "edge-a", credentialId: 31, factoryCode: "F1", lineCodes: ["L1"] } as unknown as EdgeNodePrincipal;
const TOKEN = (n: number) => `ect_${String(n).repeat(43).slice(0, 43)}`;

/** FakeDb + the one join these reads use: rows flattened for the WHERE, answered in the shape of the projection */
class DbGia extends FakeDb {
  execute = vi.fn(async () => [{ id: 1 }, { id: 2 }]);
  override select(p?: Record<string, any>) {
    if (!p || !("a" in p)) return super.select(p);
    const self = this;
    let cond: ((r: Row) => boolean) | undefined;
    let lim = Infinity;
    const b: any = {
      from: () => b,
      innerJoin: () => b,
      where: (c: (r: Row) => boolean) => ((cond = c), b),
      orderBy: () => b,
      limit: (n: number) => ((lim = n), b),
      then(res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) {
        const run = async () => {
          if (H.docClaimTreo) await H.docClaimTreo;
          if (H.docClaimLoi) throw new Error("claims unreadable");
          const as = [...(self.store.get("orchestration_run_edge_assignments") ?? [])].sort((x, y) => x.runId - y.runId);
          const out: unknown[] = [];
          for (const a of as) {
            const run = (self.store.get("orchestration_runs") ?? []).find((r) => r.id === a.runId) ?? {};
            if (cond && !cond({ ...run, ...a })) continue;
            out.push({ a: { ...a }, run: { id: run.id, status: run.status, contextJson: run.contextJson ?? null }, ...("nodeCode" in p ? { nodeCode: "edge-a" } : {}) });
          }
          return out.slice(0, lim);
        };
        return run().then(res, rej);
      },
    };
    return b;
  }
}
let d: DbGia;
const tam = thuMucTam();
const don: Array<() => Promise<void>> = [];

function themRun(runId: number, o: { status?: string; claimed?: boolean; lastProgressAt?: Date; claimSeq?: number; stops?: string[] } = {}) {
  const claimSeq = o.claimSeq ?? 1;
  d.store.set("orchestration_runs", [...(d.store.get("orchestration_runs") ?? []), { id: runId, status: o.status ?? "running", contextJson: null }]);
  d.store.set("orchestration_run_edge_assignments", [
    ...(d.store.get("orchestration_run_edge_assignments") ?? []),
    { runId, edgeNodeId: NODE.nodeId, workflowId: 1, workflowVersion: 1, defHash: "d", claimSeq, claimTokenHash: o.claimed === false ? null : hashEdgeSecret(TOKEN(runId % 10)), claimedAt: new Date(0), progressSeq: 0, lastProgressAt: o.lastProgressAt ?? new Date() },
  ]);
  H.stops.set(runId, o.stops ?? []);
}
const hangClaim = (runId: number) => (d.store.get("orchestration_run_edge_assignments") as Row[]).find((a) => a.runId === runId)!;
const hangRun = (runId: number) => (d.store.get("orchestration_runs") as Row[]).find((r) => r.id === runId)!;
const body = (runId: number, seq: number, since?: number) => ({ claimSeq: 1, claimToken: TOKEN(runId % 10), seq, ...(since === undefined ? {} : { journalStalledSinceMs: since }) });
const settled = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await vi.waitFor(() => __edgeConfigAlertsSettledForTests());
  await new Promise((r) => setTimeout(r, 0));
  await __edgeConfigAlertsSettledForTests();
};
const treo = () => H.alerts.filter((a) => a.kind === "edge_journal_stalled");
const mat = () => H.alerts.filter((a) => a.kind === "edge_run_progress_lost");

beforeEach(() => {
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
  d = new DbGia();
  dbGia.db = d;
  resetSeq();
  H.alerts.length = 0;
  H.raiseThrows = false;
  H.stops.clear();
  H.analysisThrows.clear();
  H.docClaimLoi = false;
  H.docClaimTreo = null;
  __resetEdgeConfigAlertsForTests();
  __resetJournalTreoForTests();
});
afterEach(async () => {
  for (const f of don.splice(0)) await f();
  await tam.don();
  vi.restoreAllMocks();
});

const T = 1_800_000_000_000;

describe("a2n layer 1 — the real line in progressForNodeV2", () => {
  it("★ the field raises one URGENT naming the node, the run, the unconfirmed STOP and Abort; the answer is the plain 200", async () => {
    themRun(41, { stops: ["s1"] });
    const r = await progressForNodeV2(NODE, 41, body(41, 2, T));
    expect(r).toMatchObject({ http: 200, data: { abortRequested: false, status: "running" } });
    await settled();
    expect(treo()).toHaveLength(1);
    const a = treo()[0];
    expect(a.title).toContain("edge-a");
    expect(a.message).toContain("edge-a");
    expect(a.message).toContain("run 41");
    expect(a.message).toContain("s1");
    expect(a.message).toContain("Abort");
    expect(a).toMatchObject({ source: "ot", entityType: "edge_node", entityId: 7, khuTrungBenVung: {}, recipients: [1, 2] });
  });

  it("★ no field, no URGENT; a refused progress (replay) raises none either", async () => {
    themRun(41);
    await progressForNodeV2(NODE, 41, body(41, 2));
    await settled();
    expect(H.alerts).toEqual([]);
    hangClaim(41).progressSeq = 9;
    expect(await progressForNodeV2(NODE, 41, body(41, 3, T))).toMatchObject({ http: 409, code: "replayed" });
    await settled();
    expect(H.alerts).toEqual([]);
  });

  it("★ two walkers on one disk: one URGENT, naming both runs", async () => {
    themRun(41, { stops: ["s1"] });
    themRun(42, { stops: ["s2"] });
    await progressForNodeV2(NODE, 41, body(41, 2, T));
    await progressForNodeV2(NODE, 42, body(42, 2, T));
    await progressForNodeV2(NODE, 41, body(41, 3, T));
    await settled();
    expect(treo()).toHaveLength(1);
    expect(treo()[0].message).toContain("run 41");
    expect(treo()[0].message).toContain("run 42");
  });

  it("★ a later stall (another `since`) is a new URGENT, with another text: the durable dedup also matches on kind + message", async () => {
    themRun(41, { stops: ["s1"] });
    await progressForNodeV2(NODE, 41, body(41, 2, T));
    await progressForNodeV2(NODE, 41, body(41, 3, T + 60_000));
    await settled();
    expect(treo()).toHaveLength(2);
    expect(treo()[0].dedupKey).not.toBe(treo()[1].dedupKey);
    expect(treo()[0].message).not.toBe(treo()[1].message);
  });

  it("★ a STOP already done, by its step or by an abort row, is not named; one still open is", async () => {
    themRun(41, { stops: ["s1", "s2", "s3"] });
    d.seed(orchestrationRunSteps, [
      { runId: 41, stepId: "s1", status: "completed" },
      { runId: 41, stepId: "abort:s2", status: "completed" },
      { runId: 41, stepId: "abort:s3", status: "failed" },
    ]);
    await progressForNodeV2(NODE, 41, body(41, 2, T));
    await settled();
    const m = treo()[0].message as string;
    expect(m).toContain("s3");
    expect(m).not.toMatch(/\bs1\b/);
    expect(m).not.toMatch(/\bs2\b/);
  });

  it("★ a run central no longer holds as running is not named", async () => {
    themRun(41, { stops: ["s1"] });
    themRun(42, { status: "aborted", stops: ["s9"] });
    await progressForNodeV2(NODE, 41, body(41, 2, T));
    await settled();
    expect(treo()[0].message).not.toContain("run 42");
  });

  it("★ one run whose analysis cannot be read does not cost the URGENT: its STOPs read as unknown", async () => {
    themRun(41, { stops: ["s1"] });
    themRun(42, { stops: ["s2"] });
    H.analysisThrows.add(42);
    await progressForNodeV2(NODE, 41, body(41, 2, T));
    await settled();
    expect(treo()).toHaveLength(1);
    expect(treo()[0].message).toContain("s1");
    expect(treo()[0].message).toContain("run 42 (STOP not confirmed: unknown)");
  });

  it("★ a failing alert never fails `progress`, and the next tick tries again", async () => {
    themRun(41, { stops: ["s1"] });
    H.docClaimLoi = true;
    expect(await progressForNodeV2(NODE, 41, body(41, 2, T))).toMatchObject({ http: 200 });
    await settled();
    expect(H.alerts).toEqual([]);
    H.docClaimLoi = false;
    await progressForNodeV2(NODE, 41, body(41, 3, T));
    await settled();
    expect(treo()).toHaveLength(1);
  });

  it("★ a hung alert never holds `progress`: the answer does not wait for it", async () => {
    themRun(41);
    let mo: () => void = () => undefined;
    H.docClaimTreo = new Promise<void>((r) => (mo = r));
    const r = await Promise.race([progressForNodeV2(NODE, 41, body(41, 2, T)), new Promise((res) => setTimeout(() => res("held"), 1_000))]);
    mo();
    expect(r).toMatchObject({ http: 200 });
  });

  it("a stall read within the last minute is not read again on every tick", async () => {
    themRun(41);
    const spy = vi.spyOn(d, "select");
    await baoJournalTreo(d as never, NODE, T);
    const n = spy.mock.calls.length;
    await baoJournalTreo(d as never, NODE, T);
    expect(spy.mock.calls.length).toBe(n);
  });

  it("★ schema: a new central takes the field and an old edge's body; an OLD strict central refuses the field (why centralAccepts is mandatory)", () => {
    const oldEdge = { claimSeq: 1, claimToken: TOKEN(1), seq: 2 };
    expect(edgeProgressRequestSchema.safeParse(oldEdge).success).toBe(true);
    expect(edgeProgressRequestSchema.safeParse({ ...oldEdge, journalStalledSinceMs: T }).success).toBe(true);
    expect(edgeProgressRequestSchema.safeParse({ ...oldEdge, journalStalledSinceMs: -1 }).success).toBe(false);
    const oldCentral = z.strictObject({ claimSeq: z.number(), claimToken: z.string(), seq: z.number(), status: z.string().optional(), currentStepId: z.string().nullable().optional() });
    expect(oldCentral.safeParse({ ...oldEdge, journalStalledSinceMs: T }).success).toBe(false);
  });
});

describe("a2n — the end of a stall", () => {
  const rec = (healthy: boolean, since = T) => ({ code: EDGE_JOURNAL_STALL_RECOVERED_CODE, detail: `journal stall since ${since} ended after 9000 ms; healthy=${healthy}` });
  const ban = async () => [1];

  it("★ healthy=false: the URGENT says plainly that the node refuses non-STOP until it is restarted, and that STOP and Abort still go", async () => {
    expect(alertForEdgeAnomaly(NODE, rec(false), ban)).toBe(true);
    await settled();
    const a = H.alerts[0];
    expect(a.kind).toBe("edge_journal_stall_recovered");
    expect(a.message).toMatch(/refuses non-STOP .*until (the edge|it) is restarted/);
    expect(a.message).toContain("STOP");
    expect(a.message).toContain("Abort");
  });

  it("★ healthy=true: no word of a restart — it is not needed", async () => {
    alertForEdgeAnomaly(NODE, rec(true), ban);
    await settled();
    expect(H.alerts[0].message).not.toMatch(/restart/i);
  });

  it("★ one per stall: the same `since` again is suppressed, another `since` speaks", async () => {
    expect(alertForEdgeAnomaly(NODE, rec(false), ban)).toBe(true);
    expect(alertForEdgeAnomaly(NODE, rec(false), ban)).toBe(false);
    expect(alertForEdgeAnomaly(NODE, rec(false, T + 1), ban)).toBe(true);
  });

  it("every other anomaly code stays as it was: no URGENT", () => {
    expect(alertForEdgeAnomaly(NODE, { code: "EDGE_CONFIG_STALE", detail: "x" }, ban)).toBe(false);
  });
});

describe("a2n layer 2 — a running run whose node stopped reporting (baoRunMatProgress)", () => {
  const nguong = () => edgeProgressLostAlertMs();
  const lau = T - 3_600_000; // this central has been up for an hour

  it("★ quiet one ms before the threshold, one URGENT at it, naming node, run, STOP, the last progress and the direct STOP", async () => {
    themRun(41, { lastProgressAt: new Date(T - nguong() + 1), stops: ["s1"] });
    expect(await baoRunMatProgress(T, lau)).toEqual([]);
    await settled();
    expect(mat()).toEqual([]);
    hangClaim(41).lastProgressAt = new Date(T - nguong());
    expect(await baoRunMatProgress(T, lau)).toEqual([41]);
    await settled();
    expect(mat()).toHaveLength(1);
    const a = mat()[0];
    expect(a.title).toContain("edge-a");
    expect(a.message).toContain("Run 41");
    expect(a.message).toContain("s1");
    expect(a.message).toContain(new Date(T - nguong()).toISOString());
    expect(a.message).toContain("Abort");
    expect(a.message).toContain("E-STOP");
    expect(a).toMatchObject({ source: "ot", entityType: "edge_node", entityId: 7, khuTrungBenVung: {} });
  });

  it("★ the threshold leaves room for the book: stale first, then the node's interrupted, only then an alert", () => {
    expect(nguong()).toBeGreaterThan(edgeClaimStaleMs());
  });

  it("★ one URGENT per outage, however many passes; progress that came back and stopped again is a new one", async () => {
    themRun(41, { lastProgressAt: new Date(T - nguong() - 5) });
    await baoRunMatProgress(T, lau);
    await baoRunMatProgress(T + 30_000, lau);
    await settled();
    expect(mat()).toHaveLength(1);
    hangClaim(41).lastProgressAt = new Date(T + 40_000);
    await baoRunMatProgress(T + 40_000 + nguong(), lau);
    await settled();
    expect(mat()).toHaveLength(2);
  });

  it("★ quiet: no claim (the node holds no run)", async () => {
    themRun(41, { claimed: false, lastProgressAt: new Date(T - 10 * nguong()) });
    expect(await baoRunMatProgress(T, lau)).toEqual([]);
  });

  it.each(["completed", "failed", "aborted", "held", "awaiting_confirm", "queued"])("★ quiet: a run in %s, even with a claim left on it", async (status) => {
    themRun(41, { status, lastProgressAt: new Date(T - 10 * nguong()) });
    expect(await baoRunMatProgress(T, lau)).toEqual([]);
  });

  it("★ `compensating` is a run still walking: it speaks", async () => {
    themRun(41, { status: "compensating", lastProgressAt: new Date(T - nguong()) });
    expect(await baoRunMatProgress(T, lau)).toEqual([41]);
  });

  it("★ quiet: a central that just booted (nodes had no one to report to): the wait counts from its start", async () => {
    themRun(41, { lastProgressAt: new Date(T - 10 * nguong()) });
    expect(await baoRunMatProgress(T, T - nguong() + 1)).toEqual([]);
    expect(await baoRunMatProgress(T, T - nguong())).toEqual([41]);
  });

  it("★ a node that goes down by the book is quiet: restart ⇒ claim stale ⇒ interrupted before the threshold ⇒ held, claim cleared", async () => {
    const { interruptedForNode } = await import("./edgeExecutionCentral");
    themRun(41, { lastProgressAt: new Date(Date.now() - edgeClaimStaleMs() - 1) });
    expect(await interruptedForNode(NODE, 41, { claimSeq: 1 })).toMatchObject({ http: 200, data: { status: "held" } });
    expect(hangRun(41).status).toBe("held");
    expect(hangClaim(41).claimTokenHash).toBeNull();
    expect(await baoRunMatProgress(Date.now() + nguong(), lau)).toEqual([]);
  });

  it("★ a degraded node whose walker still reports is quiet: the sweep reads progress, not the node's mood", async () => {
    themRun(41, { lastProgressAt: new Date(T - 1_000) });
    expect(await baoRunMatProgress(T, lau)).toEqual([]);
  });

  it("★ one run's unreadable analysis does not cost the alert of the other", async () => {
    themRun(41, { lastProgressAt: new Date(T - nguong()), stops: ["s1"] });
    themRun(42, { lastProgressAt: new Date(T - nguong()), stops: ["s2"] });
    H.analysisThrows.add(41);
    expect(await baoRunMatProgress(T, lau)).toEqual([41, 42]);
    await settled();
    expect(mat()).toHaveLength(2);
    expect(mat().find((a) => a.message.includes("Run 41"))!.message).toContain("unknown");
  });

  it("a sweep that cannot read the claims throws to its caller (the scheduler logs it); nothing is raised", async () => {
    themRun(41, { lastProgressAt: new Date(T - nguong()) });
    H.docClaimLoi = true;
    await expect(baoRunMatProgress(T, lau)).rejects.toThrow("claims unreadable");
    expect(H.alerts).toEqual([]);
  });
});

describe("a2n — layer 2 on a real edge, in the two shapes `progress` cannot carry", () => {
  /** FakeCentral's progress answered by the REAL progressForNodeV2 over the same rows */
  const noiTrungTam = (x: EdgeTrenDiaGia) => {
    x.central.handlers.progress = async (b, runId) => {
      const r = await progressForNodeV2(NODE, runId as number, b);
      return r.http === 200 ? { status: 200, data: r.data } : { status: r.http, code: r.code };
    };
  };
  async function runThat(o: { stops?: string[] } = {}) {
    const x = await edgeTrenDiaGia(tam);
    don.push(x.dong);
    noiTrungTam(x);
    x.central.addRun(41);
    themRun(41, { stops: o.stops ?? ["s1"] });
    await x.agent.tick();
    // the token FakeCentral handed out is the one the row must hold
    hangClaim(41).claimTokenHash = hashEdgeSecret(x.central.claimTokenOf(41) as string);
    await choDen(() => Number(hangClaim(41).progressSeq) > 1, "the run reports progress");
    return x;
  }
  const dangChay = (x: EdgeTrenDiaGia) => x.central.callsTo("progress").length;

  it("★ all libuv threads held, as measured: fetch by name fails ⇒ no progress and no pull reach central; only this layer speaks", async () => {
    const x = await runThat();
    x.central.down = true; // what the node's client gets when getaddrinfo finds no thread: `fetch failed` on every new connection
    const n = dangChay(x);
    await choDen(() => dangChay(x) > n + 3, "the agent keeps trying");
    await x.agent.tick();
    const cuoi = hangClaim(41).lastProgressAt as Date;
    const moc = cuoi.getTime() + edgeProgressLostAlertMs();
    expect(await baoRunMatProgress(moc, moc - 3_600_000)).toEqual([41]);
    await settled();
    expect(treo()).toEqual([]); // layer 1 never heard of it
    expect(mat()).toHaveLength(1);
    expect(mat()[0].message).toContain("s1");
    x.central.down = false;
  });

  it("★ the walker ended, `complete` waits on the disk, no tick is left: this layer speaks; the disk returns, complete goes, the next pass is quiet", async () => {
    const x = await runThat();
    x.dia.treoSync();
    void x.journal.appendRun(41, 1, { kind: "step", stepId: "m1", stepType: "command", status: "running", attempt: 1, startedAt: 1, finishedAt: null, error: null, result: null, jti: null });
    x.tha({ outcome: "completed" });
    await choDen(() => x.agent.liveRunIds().length === 0, "segment over");
    x.clock.t += EDGE_JOURNAL_STALL_ALERT_MS * 3;
    await new Promise((r) => setTimeout(r, 40));
    const cuoi = hangClaim(41).lastProgressAt as Date;
    const moc = cuoi.getTime() + edgeProgressLostAlertMs();
    expect(x.central.callsTo("complete")).toEqual([]);
    expect(await baoRunMatProgress(moc, moc - 3_600_000)).toEqual([41]);
    await settled();
    expect(mat()).toHaveLength(1);
    x.central.handlers.complete = (b) => {
      hangClaim(41).claimTokenHash = null;
      hangRun(41).status = b.outcome;
      return { status: 200, data: { abortRequested: false, status: b.outcome } };
    };
    x.dia.tha();
    await x.journal.flush();
    await x.shipper.flushAll();
    await x.agent.tick();
    await choDen(() => x.central.callsTo("complete").length === 1, "complete after the disk returned");
    expect(await baoRunMatProgress(moc + 60_000, moc - 3_600_000)).toEqual([]);
  });
});
