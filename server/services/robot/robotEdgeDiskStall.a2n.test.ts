/**
 * Đĩa edge treo (a2n) — the whole edge on a hung disk, nothing between the agent and the driver mocked: real agent, real walker (driveEdgeRunFromPackage), real
 * store, real equipment route, real robotEdgeDispatch, real journal over real files. Fake: the disk's hand, FakeCentral, the robot driver. Central's answer to
 * `progress` is the REAL progressForNodeV2 over FakeDb rows; the alert stops at raiseCriticalStopAlert. No STOP comes earlier for any of this; these cases
 * measure who gets told, and that the way out holds:
 *   C1  the driver took a real `move`, the dispatcher waits on its ledger record, the walker stands ⇒ URGENT; Abort sends the STOP with the disk still hung;
 *   the real consumeAuthorization past its bound ⇒ nothing reaches the driver, non-STOP closed until restart, the run still reports and ends once the disk
 *   returns, the URGENT of the end says so;
 *   Continue on that node after a restart ⇒ the run is walked again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  robot: null as null | Record<string, any>,
  alerts: [] as Array<Record<string, any>>,
  db: null as unknown,
  stops: new Map<number, string[]>(),
  /** the edge's config staleness (A2(o)): a step refused CONFIG_STALE is held and its authorisation reported unused: the B5 shape */
  stale: null as null | { centralVersion: number; localVersion: number; sinceMs: number; configIssuedAt: number | null },
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
    and: (...cs: unknown[]) => (r: R) => cs.every((x) => typeof x !== "function" || (x as (q: R) => boolean)(r)),
    asc: (c: { name: string }) => ({ name: c.name, dir: "asc" }),
  };
});
vi.mock("../../db/connection", () => ({ getDb: async () => H.db, isEdgeProcessRole: () => true }));
vi.mock("./robotManager", () => ({ getActiveRobot: () => H.robot ?? undefined }));
vi.mock("../ot/adapterFacade", () => ({ createAdapterFacade: () => ({ getSafetyStatus: async () => ({ state: "OK", source: "test", ts: new Date().toISOString() }) }) }));
vi.mock("./criticalStopAlert", async (orig) => ({
  ...(await orig<typeof import("./criticalStopAlert")>()),
  raiseCriticalStopAlert: async (a: Record<string, unknown>) => void H.alerts.push(a),
}));
vi.mock("../edge/edgeCentralCommon", async (orig) => ({ ...(await orig<typeof import("../edge/edgeCentralCommon")>()), nodeProtocolVersion: async () => 2 }));
vi.mock("../edge/edgeNodeCommands", async (orig) => ({ ...(await orig<typeof import("../edge/edgeNodeCommands")>()), commandsForNode: async () => ({ signed: [], unsignedStops: [], incomplete: false }) }));
vi.mock("../edge/edgeRunAnalysis", async (orig) => ({
  ...(await orig<typeof import("../edge/edgeRunAnalysis")>()),
  loadMachineMap: async () => new Map(),
  analyseDefinition: async (_d: unknown, runId: number) => ({ verifiedStops: (H.stops.get(runId) ?? []).map((stepId) => ({ kind: "robot", stepId, robotId: 12 })), stopsUnsure: [], resolvedAdapters: [], robotIds: [], adapterIds: [], unresolved: [] }),
}));
vi.mock("../edge/edgeReportsCentral", async (orig) => ({ ...(await orig<typeof import("../edge/edgeReportsCentral")>()), assignedDefinition: async () => ({ steps: [] }) }));

import { FakeDb } from "../../routers/__otFakeDb";
import { __edgeConfigAlertsSettledForTests, __resetEdgeConfigAlertsForTests, alertForEdgeAnomaly } from "../edge/edgeConfigCentral";
import { _resetEdgeDeviceRuntimeForTests, installEdgeDeviceRuntime } from "../edge/edgeDeviceRuntime";
import { choDen, diskGia, edgeTrenDiaGia, nghi, thuMucTam, type DiskGia, type EdgeTrenDiaGia } from "../edge/edgeDiskStall.testkit";
import { EDGE_JOURNAL_STALL_ALERT_MS, loadDefaultEdgeWalker } from "../edge/edgeExecutionAgent";
import { __resetJournalTreoForTests, progressForNodeV2 } from "../edge/edgeExecutionCentral";
import { FakeCentral } from "../edge/edgeFakeCentral.testkit";
import { hashEdgeSecret, type EdgeNodePrincipal } from "../edge/edgeNodeCredentials";
import type { RobotJobSpec } from "./robotDriver";
import { MotionLock } from "./robotDriver";

type Row = Record<string, any>;
const NODE = { nodeId: 7, nodeCode: "edge-a", credentialId: 31, factoryCode: "F1", lineCodes: ["L1"] } as unknown as EdgeNodePrincipal;
const MACHINES = [{ id: 2, machineType: "ROBOT", capabilities: null }];
const move = (id: string) => ({ id, type: "command", machineId: 2, command: "run_job", args: { robotId: 12, jobType: "move", params: { x: 1 } } });
const stop = (id: string) => ({ id, type: "command", machineId: 2, command: "abort", args: { robotId: 12 } });

class DbGia extends FakeDb {
  execute = vi.fn(async () => [{ id: 1 }]);
  override select(p?: Record<string, any>) {
    if (!p || !("a" in p)) return super.select(p);
    const self = this;
    let cond: ((r: Row) => boolean) | undefined;
    const b: any = {
      from: () => b,
      innerJoin: () => b,
      where: (c: (r: Row) => boolean) => ((cond = c), b),
      orderBy: () => b,
      limit: () => b,
      then(res: (v: unknown[]) => unknown) {
        const out = (self.store.get("orchestration_run_edge_assignments") ?? []).flatMap((a) => {
          const run = (self.store.get("orchestration_runs") ?? []).find((r) => r.id === a.runId) ?? {};
          return !cond || cond({ ...run, ...a }) ? [{ a: { ...a }, run: { id: run.id, status: run.status, contextJson: null } }] : [];
        });
        return Promise.resolve(out).then(res);
      },
    };
    return b;
  }
}

const tam = thuMucTam();
const don: Array<() => Promise<void>> = [];
let d: DbGia;
let jobs: RobotJobSpec[];
let runJobImpl: (job: RobotJobSpec) => Promise<unknown>;

beforeEach(() => {
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
  process.env.AVI_PROCESS_ROLE = "edge";
  process.env.FOE_ENABLED = "true";
  process.env.ROBOT_CONTROL_TIMEOUT_MS = "1000";
  d = new DbGia();
  H.db = d;
  H.alerts.length = 0;
  H.stops.clear();
  H.stale = null;
  jobs = [];
  runJobImpl = async () => ({ ok: true, status: "done" });
  const lock = new MotionLock();
  H.robot = {
    id: 12,
    code: "rb-12",
    vendor: "sim",
    driver: {
      vendor: "sim",
      isConnected: () => true,
      getMotionLock: () => lock.snapshot(),
      lockMotion: (r: string, x?: string) => lock.lock(r, x),
      runJob: async (job: RobotJobSpec) => {
        jobs.push(job);
        return runJobImpl(job);
      },
      abort: async () => void jobs.push({ jobType: "abort", params: {} }),
    },
  };
  __resetEdgeConfigAlertsForTests();
  __resetJournalTreoForTests();
});
afterEach(async () => {
  for (const f of don.splice(0)) await f();
  await _resetEdgeDeviceRuntimeForTests();
  await tam.don();
  delete process.env.AVI_PROCESS_ROLE;
  delete process.env.ROBOT_CONTROL_TIMEOUT_MS;
  vi.restoreAllMocks();
});

/** the real edge, its device runtime installed as the gateway installs it, central's progress + events answered by the real code over the rows */
async function dung(o: { central?: FakeCentral; dir?: string; dia?: DiskGia; authSyncTimeoutMs?: number } = {}): Promise<EdgeTrenDiaGia> {
  const x = await edgeTrenDiaGia(tam, { ...o, walker: await loadDefaultEdgeWalker(), progressMs: 15, requestTimeoutMs: 200 });
  await _resetEdgeDeviceRuntimeForTests();
  await installEdgeDeviceRuntime({
    nodeId: x.central.nodeId,
    config: () => x.config.current(),
    journal: x.journal,
    robotControlEnabled: () => true,
    otControlEnabled: () => true,
    configStale: () => H.stale,
    auth: () => ({ trust: x.config.trust(), credentialId: x.config.credentialId() as number, maxTtlMs: 10_000, pendingNonce: (n: string) => (x.authorize.nonceSentAt(n) === null ? null : { sentMonoMs: x.authorize.nonceSentAt(n) as number }), nowMonoMs: () => x.client.monoNow() }),
  });
  x.central.handlers.progress = async (b, runId) => {
    hangClaim(runId as number).claimTokenHash = hashEdgeSecret(b.claimToken);
    hangClaim(runId as number).claimSeq = b.claimSeq;
    const r = await progressForNodeV2(NODE, runId as number, b);
    return r.http === 200 ? { status: 200, data: r.data } : { status: r.http, code: r.code };
  };
  x.central.handlers.locksEvents = async (b) => {
    for (const r of b.records) if (r.kind === "anomaly") alertForEdgeAnomaly(NODE, { code: r.code, detail: r.detail }, async () => [1]);
    return { status: 200, data: { ackedSeq: b.records[b.records.length - 1]?.seq ?? 0, applied: b.records.length, duplicates: 0 } };
  };
  don.push(x.dong);
  return x;
}
function themRun(c: FakeCentral, runId: number, steps: unknown[], stops: string[]) {
  c.addRun(runId, { ref: `r${runId}`, name: `r${runId}`, steps });
  c.packageOver.set(runId, { machines: MACHINES as never, verifiedStops: stops.map((stepId) => ({ kind: "robot" as const, stepId, robotId: 12 })) });
  d.store.set("orchestration_runs", [...(d.store.get("orchestration_runs") ?? []), { id: runId, status: "running", contextJson: null }]);
  d.store.set("orchestration_run_edge_assignments", [...(d.store.get("orchestration_run_edge_assignments") ?? []), { runId, edgeNodeId: 7, workflowId: 1, workflowVersion: 1, defHash: "d", claimSeq: 0, claimTokenHash: "x", claimedAt: new Date(), progressSeq: 0, lastProgressAt: new Date() }]);
  H.stops.set(runId, stops);
}
const hangClaim = (runId: number) => (d.store.get("orchestration_run_edge_assignments") as Row[]).find((a) => a.runId === runId)!;
const hangRun = (runId: number) => (d.store.get("orchestration_runs") as Row[]).find((r) => r.id === runId)!;
const ten = () => jobs.map((j) => j.jobType);
const canhBao = (kind: string) => H.alerts.filter((a) => a.kind === kind);

describe("a2n C1 — the driver took the command, the dispatcher waits on its ledger record", () => {
  it("★ URGENT from the real line; Abort: the STOP reaches the driver with the disk still hung; the disk returns, the run ends", async () => {
    const x = await dung();
    themRun(x.central, 61, [move("m1"), stop("s1")], ["s1"]);
    runJobImpl = async () => {
      x.dia.treoSync();
      return { ok: true, status: "done" };
    };
    await x.agent.tick();
    await choDen(() => ten().includes("move"), "the driver took the move");
    await choDen(() => x.journal.stalledSince() !== null, "the ledger record's fsync hangs");
    await nghi(60);
    expect(ten()).toEqual(["move"]); // STOP s1 stands behind it, as on main: this lot does not make it earlier
    expect(x.central.callsTo("complete")).toEqual([]);

    x.clock.t += EDGE_JOURNAL_STALL_ALERT_MS;
    await choDen(() => x.central.callsTo("progress").some((c) => c.body.journalStalledSinceMs !== undefined), "the field goes");
    await choDen(() => canhBao("edge_journal_stalled").length === 1, "the URGENT");
    await __edgeConfigAlertsSettledForTests();
    const a = canhBao("edge_journal_stalled")[0];
    expect(a.message).toContain("run 61");
    expect(a.message).toContain("s1");

    // a person presses Abort: central's row says aborted, the next tick carries it
    hangRun(61).status = "aborted";
    const t0 = Date.now();
    await choDen(() => ten().includes("abort"), "the STOP reaches the driver");
    expect(Date.now() - t0).toBeLessThan(2_000); // measured 33 ms: one progress tick
    expect(x.journal.stalledSince()).not.toBeNull();

    x.dia.tha();
    await x.journal.flush();
    await x.shipper.flushAll();
    await choDen(() => x.agent.liveRunIds().length === 0, "the walker let go");
    await x.agent.tick();
    await choDen(() => x.central.callsTo("complete").length === 1, "complete");
    expect(x.central.callsTo("complete")[0].body.outcome).toBe("aborted");
    expect(ten().filter((j) => j === "move")).toHaveLength(1);
  }, 20_000);
});

describe("a2n — the real consumeAuthorization past its bound", () => {
  it("★ nothing reaches the driver; non-STOP closed; disk back: the run reports and ends, no late command, no new claim, the URGENT says restart", async () => {
    const x = await dung();
    themRun(x.central, 62, [move("m1"), stop("s1")], ["s1"]);
    x.dia.treoSauKhiGhi("auth.consumed");
    await x.agent.tick();
    await choDen(() => x.journal.admitNonStop() === false, "the consume overran");
    expect(ten()).toEqual([]);
    x.clock.t += EDGE_JOURNAL_STALL_ALERT_MS;
    await choDen(() => canhBao("edge_journal_stalled").length === 1, "the URGENT");

    x.dia.tha();
    await x.journal.flush();
    await x.shipper.flushAll();
    await choDen(() => x.agent.liveRunIds().length === 0, "the walker ended");
    await x.agent.tick();
    await x.journal.flush();
    await x.shipper.flushAll();
    await x.agent.tick();
    await choDen(() => x.central.callsTo("complete").length === 1, "complete after the disk returned");
    expect(ten().filter((j) => j === "move")).toEqual([]);
    expect(x.journal.admitNonStop()).toBe(false);
    expect(x.central.callsTo("complete")[0].body).toMatchObject({ outcome: "failed", error: "JOURNAL_CONSUME_FAILED" });

    themRun(x.central, 63, [move("m2")], []);
    await x.agent.tick();
    await nghi(30);
    expect(x.central.callsTo("claim").filter((c) => c.runId === 63)).toEqual([]);

    await x.journal.flush();
    await x.shipper.flushAll();
    await choDen(() => canhBao("edge_journal_stall_recovered").length === 1, "the URGENT of the end");
    expect(canhBao("edge_journal_stall_recovered")[0].message).toMatch(/refuses non-STOP .*until it is restarted/);
  }, 20_000);

  it("★ B5 then Continue: auth.unused overran, the run is HELD once the disk returns, the node refuses Continue's work until restarted; after the restart it walks", async () => {
    const dir = await tam.mk();
    const x = await dung({ dir });
    themRun(x.central, 64, [move("m1"), stop("s1")], ["s1"]);
    H.stale = { centralVersion: 2, localVersion: 1, sinceMs: 1_000, configIssuedAt: null };
    x.dia.treoSauKhiGhi("auth.unused");
    await x.agent.tick();
    await choDen(() => x.journal.admitNonStop() === false, "auth.unused overran");
    x.clock.t += EDGE_JOURNAL_STALL_ALERT_MS;
    await choDen(() => canhBao("edge_journal_stalled").length === 1, "the URGENT");
    expect(x.central.callsTo("complete")).toEqual([]); // standing, central still shows running
    x.dia.tha();
    await x.journal.flush();
    await x.shipper.flushAll();
    await choDen(() => x.agent.liveRunIds().length === 0, "the walker ended");
    await x.journal.flush();
    await x.shipper.flushAll();
    await x.agent.tick();
    await choDen(() => x.central.callsTo("complete").length === 1, "complete");
    expect(x.central.callsTo("complete")[0].body).toMatchObject({ outcome: "held" });
    expect(ten()).toEqual([]);

    // Continue before a restart: central re-queues the run, this node does not take it
    H.stale = null;
    x.central.addRun(64, x.central.definitions.get(64) as Record<string, unknown>, 1);
    await x.agent.tick();
    await nghi(30);
    expect(x.central.callsTo("claim").filter((c) => c.runId === 64)).toHaveLength(1);
    expect(ten()).toEqual([]);

    // the restart: everything down, the same journal directory, a new epoch; the run is queued again, its STOP not yet sent
    await don.pop()!();
    const c2 = new FakeCentral();
    d.store.clear();
    const y = await dung({ central: c2, dir, dia: diskGia() });
    expect(y.journal.admitNonStop()).toBe(true);
    themRun(c2, 64, [move("m1"), stop("s1")], ["s1"]);
    await y.agent.tick();
    await choDen(() => c2.callsTo("claim").length === 1, "claimed on the restarted node");
    await choDen(() => ten().length >= 2, "walked to its STOP");
    expect(ten()).toEqual(["move", "abort"]);
    await choDen(() => y.agent.liveRunIds().length === 0, "the walker ended");
    await y.journal.flush();
    await y.shipper.flushAll();
    await y.agent.tick();
    await choDen(() => c2.callsTo("complete").length === 1, "complete");
    expect(c2.callsTo("complete")[0].body.outcome).toBe("completed");
  }, 20_000);
});
