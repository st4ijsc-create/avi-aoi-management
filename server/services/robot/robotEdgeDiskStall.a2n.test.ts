/**
 * Đĩa edge treo (a2n) — the whole edge on a hung disk, nothing between the agent and the driver mocked: real agent, real walker (driveEdgeRunFromPackage), real
 * store, real equipment route, real robotEdgeDispatch, real journal over real files. Fake: the disk's hand, FakeCentral, the robot driver. Central's answer to
 * `progress` is the REAL progressForNodeV2 over FakeDb rows; the alert stops at raiseCriticalStopAlert. No STOP comes earlier for any of this; these cases
 * measure who gets told, and that the way out holds:
 *   C1  the driver took a real `move`, the dispatcher waits on its ledger record, the walker stands ⇒ URGENT; Abort sends the STOP with the disk still hung;
 *   the real consumeAuthorization past its bound ⇒ nothing reaches the driver, non-STOP closed until restart, the run still reports and ends once the disk
 *   returns, the URGENT of the end says so;
 *   a restarted node takes the run again (a fresh central: not central's real Continue, see that case);
 *   a STOP in a compensation on the failing path reaches the driver once the disk returns; a forward STOP behind that step does not, as for any failed step of a run;
 *   round C: the walker as it was, the END of such a segment says held(journalFull) instead of failed, so Abort stays open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  robot: null as null | Record<string, any>,
  alerts: [] as Array<Record<string, any>>,
  db: null as unknown,
  stops: new Map<number, string[]>(),
  /** the edge's config staleness (A2(o)): a step refused CONFIG_STALE is held and its authorisation reported unused: the B5 shape */
  stale: null as null | { centralVersion: number; localVersion: number; sinceMs: number; configIssuedAt: number | null },
  defs: new Map<number, unknown>(),
  /** the next safety preflight waits on this: a dispatch that passed the journal's admission and has not reached its consume yet */
  preflight: null as null | Promise<void>,
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
    notInArray: (c: { name: string }, vs: unknown[]) => (r: R) => !vs.includes(r[c.name]),
  };
});
vi.mock("../../db/connection", () => ({ getDb: async () => H.db, isEdgeProcessRole: () => true }));
vi.mock("./robotManager", () => ({ getActiveRobot: () => H.robot ?? undefined }));
vi.mock("../ot/adapterFacade", () => ({
  createAdapterFacade: () => ({
    getSafetyStatus: async () => {
      const g = H.preflight;
      H.preflight = null;
      if (g) await g;
      return { state: "OK", source: "test", ts: new Date().toISOString() };
    },
  }),
}));
vi.mock("./criticalStopAlert", async (orig) => ({
  ...(await orig<typeof import("./criticalStopAlert")>()),
  raiseCriticalStopAlert: async (a: Record<string, unknown>) => void H.alerts.push(a),
}));
vi.mock("../edge/edgeCentralCommon", async (orig) => ({ ...(await orig<typeof import("../edge/edgeCentralCommon")>()), nodeProtocolVersion: async () => 2, centralSigner: () => ({}) }));
vi.mock("../edge/edgeNodeCommands", async (orig) => ({ ...(await orig<typeof import("../edge/edgeNodeCommands")>()), commandsForNode: async () => ({ signed: [], unsignedStops: [], incomplete: false }) }));
vi.mock("../edge/edgeRunAnalysis", async (orig) => ({
  ...(await orig<typeof import("../edge/edgeRunAnalysis")>()),
  loadMachineMap: async () => new Map(),
  analyseDefinition: async (_d: unknown, runId: number) => ({ verifiedStops: (H.stops.get(runId) ?? []).map((stepId) => ({ kind: "robot", stepId, robotId: 12 })), stopsUnsure: [], resolvedAdapters: [], robotIds: [], adapterIds: [], unresolved: [] }),
}));
vi.mock("../edge/edgeReportsCentral", async (orig) => ({
  ...(await orig<typeof import("../edge/edgeReportsCentral")>()),
  assignedDefinition: async (_d: unknown, a: { runId: number }) => H.defs.get(a.runId) ?? { steps: [] },
  cursorLastSeq: async () => Number.MAX_SAFE_INTEGER, // the shipper's acks are FakeCentral's: complete only asks that the run was reported through
}));

import { FakeDb } from "../../routers/__otFakeDb";
import { __edgeConfigAlertsSettledForTests, __resetEdgeConfigAlertsForTests, alertForEdgeAnomaly } from "../edge/edgeConfigCentral";
import { _resetEdgeDeviceRuntimeForTests, installEdgeDeviceRuntime } from "../edge/edgeDeviceRuntime";
import { choDen, diskGia, edgeTrenDiaGia, nghi, thuMucTam, type DiskGia, type EdgeTrenDiaGia } from "../edge/edgeDiskStall.testkit";
import { EDGE_JOURNAL_STALL_ALERT_MS, loadDefaultEdgeWalker } from "../edge/edgeExecutionAgent";
import { __resetJournalTreoForTests, completeForNodeV2, progressForNodeV2 } from "../edge/edgeExecutionCentral";
import { FakeCentral, kitHashDefinition } from "../edge/edgeFakeCentral.testkit";
import { hashEdgeSecret, type EdgeNodePrincipal } from "../edge/edgeNodeCredentials";
import { orchestrationRunSteps } from "../../../drizzle/schema";
import { equipmentRegistry } from "../equipment/equipmentAdapter";
import { abortRun, applyEdgeSegmentEnd, edgePriorPictureOf, recordEdgeStepRows, resumeRun } from "../orchestration/foe/foeEngine";
import { RESUME_STATE_CTX_KEY } from "../orchestration/foe/foeRunStore";
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
  H.defs.clear();
  H.preflight = null;
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
  delete process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED;
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
  H.defs.set(runId, { ref: `r${runId}`, name: `r${runId}`, steps });
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
    // pin changed in round C: a consume past its bound no longer ends a run failed, Abort has to stay open
    expect(x.central.callsTo("complete")[0].body).toMatchObject({ outcome: "held", heldReason: "journalFull" });
    expect(String(x.central.callsTo("complete")[0].body.error)).toContain("JOURNAL_CONSUME_FAILED");

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

    // the restart: everything down, the same journal directory, a new epoch; the run is queued again, its STOP not yet sent. A FRESH central on purpose: this measures that
    // a restarted node takes and walks a run. It is NOT central's real Continue: there the authorisation m1 got, never reported, is in the ledger, edgeResumeStateOf
    // answers outcomeUnknown, and the re-walk fails m1 without reaching s1 (measured, round 2 report).
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

describe("a2n — consumeAuthorization past its bound with a STOP in a compensation: locked, the STOP reaches the driver; held, not failed, so Abort stays open", () => {
  const HANG_M2 = /"k":"auth\.consumed".*"stepId":"m2"/;
  const sauKhiDiaVe = async (x: EdgeTrenDiaGia) => {
    x.dia.tha();
    await x.journal.flush();
    await x.shipper.flushAll();
    await choDen(() => x.agent.liveRunIds().length === 0, "the walker ended");
    await x.agent.tick();
    await x.journal.flush();
    await x.shipper.flushAll();
    await x.agent.tick();
    await choDen(() => x.central.callsTo("complete").length === 1, "complete");
  };

  it("★ the failing step's own compensation: nothing past m1 while the disk hangs; the disk returns, the STOP goes, the run ends held", async () => {
    const x = await dung();
    themRun(x.central, 65, [move("m1"), { ...move("m2"), compensation: stop("c1") }], ["c1"]);
    x.dia.treoSauKhiGhi(HANG_M2);
    await x.agent.tick();
    await choDen(() => x.journal.admitNonStop() === false, "the consume overran");
    await nghi(60);
    expect(ten()).toEqual(["move"]);
    await sauKhiDiaVe(x);
    expect(ten()).toEqual(["move", "abort"]);
    expect(x.central.callsTo("complete")[0].body).toMatchObject({ outcome: "held", heldReason: "journalFull" }); // pin changed in round C, as above
    await x.shipper.flushAll();
    expect(x.central.received.report.some((r: Row) => r.kind === "step" && r.stepId === "c1" && r.status === "compensated")).toBe(true);
  }, 20_000);

  it("★ the compensation of the container around it: the same", async () => {
    const x = await dung();
    themRun(x.central, 66, [{ id: "q", type: "sequence", steps: [move("m1"), move("m2")], compensation: stop("c1") }], ["c1"]);
    x.dia.treoSauKhiGhi(HANG_M2);
    await x.agent.tick();
    await choDen(() => x.journal.admitNonStop() === false, "the consume overran");
    await nghi(60);
    expect(ten()).toEqual(["move"]);
    await sauKhiDiaVe(x);
    expect(ten()).toEqual(["move", "abort"]);
    expect(x.central.callsTo("complete")[0].body).toMatchObject({ outcome: "held", heldReason: "journalFull" }); // pin changed in round C, as above
  }, 20_000);
});

/**
 * Round C: the walker is as it was (m2 failed, compensations and parallels as ever); only the END of a segment that had a consume past its bound says held(journalFull)
 * where it would say failed. Central's half is real from here on, over FakeDb: rows through recordEdgeStepRows, the end through completeForNodeV2 and applyEdgeSegmentEnd,
 * Abort through abortRun with central's own sweep (its dispatcher answers as central does for a device it cannot reach), the Continue through resumeRun. Still fake: FakeCentral's
 * /authorize, its signature on the sweep picture, the rows' SQL. Those run on real rows in edgeHeldConsume.a2n.db.test.
 */
describe("a2n round C — a consume past its bound ends the segment held", () => {
  const HANG_M2 = /"k":"auth\.consumed".*"stepId":"m2"/;
  const NGUOI = { id: 0, role: "system", name: "a2n" } as never;
  const moveC = (id: string, c: unknown) => ({ ...move(id), compensation: c });
  const hangBuoc = (runId: number) => ((d.store.get("orchestration_run_steps") ?? []) as Row[]).filter((r) => r.runId === runId).map((r) => ({ ...r }));
  const trangThai = (runId: number) => Object.fromEntries(hangBuoc(runId).map((r) => [r.stepId, r.status]));

  async function chepHang(x: EdgeTrenDiaGia, runId: number) {
    const recs = x.central.received.report.filter((r: Row) => r.kind === "step");
    await recordEdgeStepRows(d as never, runId, recs.map((r: Row) => ({ stepId: r.stepId, stepType: r.stepType, status: r.status, attempt: r.attempt ?? 0, startedAt: r.startedAt ? new Date(r.startedAt) : null, finishedAt: r.finishedAt ? new Date(r.finishedAt) : null, error: r.error ?? null, result: r.result ?? undefined })));
  }
  /** the real end of a segment: its rows, then the real complete */
  async function dungThat(o: Parameters<typeof dung>[0] = {}): Promise<EdgeTrenDiaGia> {
    const x = await dung(o);
    d.setUnique(orchestrationRunSteps, [["runId", "stepId"]]);
    x.central.handlers.complete = async (b, runId) => {
      await chepHang(x, runId as number);
      hangClaim(runId as number).claimTokenHash = hashEdgeSecret(b.claimToken);
      hangClaim(runId as number).claimSeq = b.claimSeq;
      const r = await completeForNodeV2(NODE, runId as number, b);
      return r.http === 200 ? { status: 200, data: r.data } : { status: r.http, code: r.code };
    };
    return x;
  }
  async function hetDoan(x: EdgeTrenDiaGia, n = 1) {
    x.dia.tha();
    await x.journal.flush();
    await x.shipper.flushAll();
    await choDen(() => x.agent.liveRunIds().length === 0, "the walker ended");
    await x.agent.tick();
    await x.journal.flush();
    await x.shipper.flushAll();
    await x.agent.tick();
    await choDen(() => x.central.callsTo("complete").length === n, "complete");
  }
  async function chayTreo(runId: number, steps: unknown[], stops: string[], dir?: string) {
    const x = await dungThat({ dir });
    themRun(x.central, runId, steps, stops);
    x.dia.treoSauKhiGhi(HANG_M2);
    await x.agent.tick();
    await choDen(() => x.journal.admitNonStop() === false, "the consume overran");
    await nghi(60);
    await hetDoan(x);
    return x;
  }
  /** what central holds besides the rows: the workflow, the machine, the authorisations it issued (FakeCentral's /authorize calls), none superseded */
  function hatGiong(x: EdgeTrenDiaGia, runId: number) {
    d.store.set("orchestration_workflows", [{ id: 1, ref: `r${runId}`, name: `r${runId}`, definitionJson: H.defs.get(runId), version: 1, status: "active", scopeKey: "global" }]);
    d.store.set("machines", MACHINES.map((m) => ({ ...m, name: "m", code: "m" })));
    d.store.set("edge_step_authorizations", x.central.callsTo("authorize").map((c) => ({ runId, claimSeq: 1, stepId: (c.body as { stepId: string }).stepId, supersededAt: null })));
    Object.assign(hangRun(runId), { workflowId: 1, workflowRef: `r${runId}`, paramsJson: {}, startedBy: 4 });
  }
  /** a person presses Abort: the real abortRun and central's real sweep; then what the node re-sends from a sweep picture holding the real prior of those rows */
  async function abortRoiGuiLai(x: EdgeTrenDiaGia, runId: number, stops: string[]) {
    hatGiong(x, runId);
    const prior = edgePriorPictureOf(hangBuoc(runId) as never);
    const spy = vi.spyOn(equipmentRegistry, "getAdapter").mockImplementation((() => ({ sendCommand: async () => ({ ok: false, status: "rejected", routedTo: "central", error: "central cannot reach this device" }) })) as never);
    const a = (await abortRun(runId, NGUOI, "a2n")) as unknown as { ok: boolean; abortStops?: { failed: string[]; sent: string[] } };
    spy.mockRestore();
    const def = H.defs.get(runId) as Record<string, unknown>;
    const n0 = jobs.length;
    x.central.stopsUnconfirmed = [{ runId, picture: x.central.sign("runpkg", x.central.sweepPicture(runId, { definition: def as never, defHash: kitHashDefinition(def), machines: MACHINES as never, verifiedStops: stops.map((stepId) => ({ kind: "robot" as const, stepId, robotId: 12 })), prior })) }];
    await x.agent.tick();
    await nghi(30);
    return { a, moi: jobs.slice(n0).map((j) => j.jobType) };
  }
  /** the restart, then the real Continue: everything down, the same journal directory; the package carries the context resumeRun wrote */
  async function tiepTuc(x: EdgeTrenDiaGia, dir: string, runId: number, steps: unknown[], stops: string[]) {
    hatGiong(x, runId);
    const hang = hangBuoc(runId);
    const r = await resumeRun(runId, { approved: true } as never, NGUOI);
    expect(r).toMatchObject({ ok: true, status: "queued" });
    expect(hangClaim(runId).claimTokenHash).toBeNull();
    const ctx = (hangRun(runId).contextJson ?? {}) as Row;
    const rs = (ctx[RESUME_STATE_CTX_KEY] ?? {}) as Row;
    await don.pop()!();
    const c2 = new FakeCentral();
    jobs = [];
    d.store.clear();
    const y = await dung({ central: c2, dir, dia: diskGia() });
    themRun(c2, runId, steps, stops);
    c2.packageOver.set(runId, { ...(c2.packageOver.get(runId) as Record<string, unknown>), context: ctx, prior: edgePriorPictureOf(hang as never) } as never);
    await y.agent.tick();
    await choDen(() => c2.callsTo("claim").length === 1, "claimed");
    await choDen(() => y.agent.liveRunIds().length === 0, "the walker ended");
    await y.journal.flush();
    await y.shipper.flushAll();
    await y.agent.tick();
    await choDen(() => c2.callsTo("complete").length === 1, "complete");
    return { rs, ket: c2.callsTo("complete")[0].body as Row };
  }

  it("★ O1: m2 stays failed, the run is held at central, no STOP on its own; Abort answers ok and only s1 goes", async () => {
    const x = await chayTreo(71, [move("m1"), move("m2"), stop("s1")], ["s1"]);
    expect(x.central.callsTo("complete")[0].body).toMatchObject({ outcome: "held", heldReason: "journalFull" });
    expect(String(x.central.callsTo("complete")[0].body.error)).toMatch(/^EDGE_HELD\(journalFull\): EDGE_CONSUME_OVERRUN: /); // the string contract, the sending side, literally
    expect(hangRun(71).status).toBe("held");
    expect(trangThai(71)).toEqual({ m1: "completed", m2: "failed" });
    expect(ten()).toEqual(["move"]);
    const { a, moi } = await abortRoiGuiLai(x, 71, ["s1"]);
    expect(a.ok).toBe(true);
    expect(a.abortStops?.failed).toEqual(["s1"]); // central's sweep tried s1 and only s1, and could not reach it: the failed row is what the node re-sends
    expect(hangRun(71).status).toBe("aborted");
    expect(hangBuoc(71).find((r) => r.stepId === "abort:s1")?.status).toBe("failed");
    expect(moi).toEqual(["abort"]);
  }, 20_000);

  it("★ O1 Continue after the restart: m2 is not unknown, it is authorised anew, s1 goes, completed", async () => {
    const dir = await tam.mk();
    const steps = [move("m1"), move("m2"), stop("s1")];
    const x = await chayTreo(72, steps, ["s1"], dir);
    const { rs, ket } = await tiepTuc(x, dir, 72, steps, ["s1"]);
    expect(rs).toEqual({});
    expect(ten()).toEqual(["move", "abort"]);
    expect(ket.outcome).toBe("completed");
  }, 20_000);

  it("★ O2: the STOP of the compensation went on its own; Abort answers ok and sends nothing again", async () => {
    const x = await chayTreo(73, [move("m1"), moveC("m2", stop("c1"))], ["c1"]);
    expect(hangRun(73).status).toBe("held");
    expect(trangThai(73)).toEqual({ m1: "completed", m2: "failed", c1: "compensated" });
    expect(ten()).toEqual(["move", "abort"]);
    const { a, moi } = await abortRoiGuiLai(x, 73, ["c1"]);
    expect(a.ok).toBe(true);
    expect(a.abortStops?.failed).toEqual([]);
    expect(moi).toEqual([]);
  }, 20_000);

  it("★ MIX, Abort: c1 went on its own, Abort sends one STOP more, never c1 again", async () => {
    const x = await chayTreo(74, [move("m1"), moveC("m2", stop("c1")), stop("s1")], ["c1", "s1"]);
    expect(ten()).toEqual(["move", "abort"]);
    expect(hangRun(74).status).toBe("held");
    const { a, moi } = await abortRoiGuiLai(x, 74, ["c1", "s1"]);
    expect(a.ok).toBe(true);
    expect(a.abortStops?.failed).toEqual(["s1"]); // never c1: it went on its own
    expect(moi).toEqual(["abort"]);
  }, 20_000);

  it("★ MIX, Continue instead of Abort: s1 is lost, and the run's text said so before the button was pressed", async () => {
    const dir = await tam.mk();
    const steps = [move("m1"), moveC("m2", stop("c1")), stop("s1")];
    const x = await chayTreo(75, steps, ["c1", "s1"], dir);
    const chu = String(hangRun(75).error);
    expect(chu).toContain("A compensation may already have run.");
    expect(chu).toContain("use Abort");
    expect(chu).toContain("Continue may end the run without sending it.");
    expect(chu).not.toContain("nothing further was sent");
    expect(chu).not.toContain("Continue to resume it");
    const { rs, ket } = await tiepTuc(x, dir, 75, steps, ["c1", "s1"]);
    expect(rs).toMatchObject({ m2: { state: "doneFailed" } });
    expect(ten()).toEqual([]); // not c1 again, not s1
    expect(ket.outcome).toBe("failed");
  }, 20_000);

  it("★ PAR: the walk went on past m2 and completed: nothing to hold, the end is left alone", async () => {
    const x = await chayTreo(76, [{ id: "p", type: "parallel", steps: [{ id: "w1", type: "delay", ms: 5 }, move("m2")] }, stop("s1")], ["s1"]);
    expect(x.central.callsTo("complete")[0].body.outcome).toBe("completed");
    expect(hangRun(76).status).toBe("completed");
    expect(ten()).toEqual(["abort"]);
  }, 20_000);

  it("★ an Abort during the hang stays an abort: the end is aborted, not held", async () => {
    const x = await dungThat();
    themRun(x.central, 77, [move("m1"), move("m2"), stop("s1")], ["s1"]);
    x.dia.treoSauKhiGhi(HANG_M2);
    await x.agent.tick();
    await choDen(() => x.journal.admitNonStop() === false, "the consume overran");
    hangRun(77).status = "aborted";
    await choDen(() => ten().includes("abort"), "the STOP reaches the driver");
    await hetDoan(x);
    expect(x.central.callsTo("complete")[0].body.outcome).toBe("aborted");
  }, 20_000);

  it("★ no disk in it: an ordinary refusal before the driver ends failed, Abort already terminal: the end only moves for a consume past its bound", async () => {
    const x = await dungThat();
    themRun(x.central, 78, [move("m1"), move("m2"), stop("s1")], ["s1"]);
    runJobImpl = async () => {
      (H.robot as Row).driver.lockMotion("test", "locked after m1");
      return { ok: true, status: "done" };
    };
    await x.agent.tick();
    await hetDoan(x);
    expect(x.central.callsTo("complete")[0].body).toMatchObject({ outcome: "failed", error: expect.stringMatching(/^MOTION_LOCKED /) }); // A2(n): every end that is not `completed` carries its report rider
    expect(hangRun(78).status).toBe("failed");
    expect(ten()).toEqual(["move"]);
    expect((await abortRun(78, NGUOI, "a2n")).message).toContain("already terminal");
  }, 20_000);

  it("★ the narrow case, measured: a run past the admission when another run's consume overran is refused on the unhealthy check: it counts, it ends held", async () => {
    process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED = "true";
    const x = await dungThat();
    let tha: () => void = () => undefined;
    H.preflight = new Promise<void>((r) => (tha = r));
    themRun(x.central, 81, [move("b1"), stop("s1")], ["s1"]);
    await x.agent.tick();
    await choDen(() => H.preflight === null, "run 81 waits in its preflight, past the admission");
    expect(x.journal.admitNonStop()).toBe(true);
    themRun(x.central, 82, [move("m2")], []);
    x.dia.treoSauKhiGhi(HANG_M2);
    await x.agent.tick();
    await choDen(() => x.journal.admitNonStop() === false, "run 82's consume overran");
    tha();
    await nghi(60);
    await hetDoan(x, 2);
    const ket = Object.fromEntries(x.central.callsTo("complete").map((c) => [c.runId, c.body.outcome]));
    expect(ket).toEqual({ 81: "held", 82: "held" });
    expect(ten()).toEqual([]);
  }, 20_000);

  it("★ the narrow case with an auth.unused past its bound behind it: it does not count, the run ends failed", async () => {
    process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED = "true";
    const x = await dungThat();
    let tha: () => void = () => undefined;
    H.preflight = new Promise<void>((r) => (tha = r));
    themRun(x.central, 83, [move("b1"), stop("s1")], ["s1"]);
    await x.agent.tick();
    await choDen(() => H.preflight === null, "run 83 waits in its preflight, past the admission");
    H.stale = { centralVersion: 2, localVersion: 1, sinceMs: 1_000, configIssuedAt: null };
    themRun(x.central, 84, [move("m2")], []);
    x.dia.treoSauKhiGhi("auth.unused");
    await x.agent.tick();
    await choDen(() => x.journal.admitNonStop() === false, "run 84's auth.unused overran");
    H.stale = null;
    tha();
    await nghi(60);
    await hetDoan(x, 2);
    const ket = Object.fromEntries(x.central.callsTo("complete").map((c) => [c.runId, c.body.outcome]));
    expect(ket[83]).toBe("failed");
  }, 20_000);

  it("★ the narrow case with another refusal: a run refused MOTION_LOCKED while another run's consume overran does not count, it ends failed", async () => {
    process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED = "true";
    const x = await dungThat();
    let tha: () => void = () => undefined;
    H.preflight = new Promise<void>((r) => (tha = r));
    themRun(x.central, 88, [move("b1"), stop("s1")], ["s1"]);
    await x.agent.tick();
    await choDen(() => H.preflight === null, "run 88 waits in its preflight, past the admission");
    themRun(x.central, 89, [move("m2")], []);
    x.dia.treoSauKhiGhi(HANG_M2);
    await x.agent.tick();
    await choDen(() => x.journal.admitNonStop() === false, "run 89's consume overran");
    expect(x.journal.consumeOverran()).toBe(true);
    (H.robot as Row).driver.lockMotion("test", "locked while run 88 waited");
    tha();
    await nghi(60);
    await hetDoan(x, 2);
    const ket = Object.fromEntries(x.central.callsTo("complete").map((c) => [c.runId, c.body]));
    expect(ket[88]).toMatchObject({ outcome: "failed", error: expect.stringMatching(/^MOTION_LOCKED /) });
    expect(ket[89]).toMatchObject({ outcome: "held", heldReason: "journalFull" });
  }, 20_000);

  it("★ B5: Continue fails the step, nothing forward goes, the verified STOP behind it goes, and the run's text says so", async () => {
    const dir = await tam.mk();
    const steps = [move("m1"), stop("s1")];
    const x = await dungThat({ dir });
    themRun(x.central, 85, steps, ["s1"]);
    H.stale = { centralVersion: 2, localVersion: 1, sinceMs: 1_000, configIssuedAt: null };
    x.dia.treoSauKhiGhi("auth.unused");
    await x.agent.tick();
    await choDen(() => x.journal.admitNonStop() === false, "auth.unused overran");
    H.stale = null;
    await hetDoan(x);
    expect(String(x.central.callsTo("complete")[0].body.error)).toMatch(/^EDGE_HELD\(configStale\): EDGE_UNUSED_NOT_REPORTED: /); // the string contract, the sending side, literally
    expect(hangRun(85).status).toBe("held");
    const chu = String(hangRun(85).error);
    expect(chu).toContain("Continue fails that step, sends nothing forward, and sends the verified STOPs behind it.");
    expect(chu).toContain("Abort sends them too.");
    expect(chu).not.toContain("nothing further was sent");
    expect(chu).not.toContain("Continue to resume it");
    expect(chu).not.toContain("Continue it once");
    const { rs, ket } = await tiepTuc(x, dir, 85, steps, ["s1"]);
    expect(rs).toMatchObject({ m1: { state: "outcomeUnknown" } });
    expect(ten()).toEqual(["abort"]);
    expect(ket).toMatchObject({ outcome: "failed" });
    expect(String(ket.error)).toContain("EDGE_OUTCOME_UNKNOWN");
  }, 20_000);

  it("★ another journalFull hold keeps its text: an end without the mark, the real central wording", async () => {
    const x = await dung();
    themRun(x.central, 86, [move("m1")], []);
    await applyEdgeSegmentEnd(d as never, 86, { outcome: "held", heldReason: "journalFull", error: "EDGE_HELD(journalFull): the journal refused a record (full)", nodeCode: "edge-a", claimSeq: 1, def: { steps: [] } as never });
    expect(String(hangRun(86).error)).toContain("nothing further was sent; Continue to resume it.");
    expect(String(hangRun(86).error)).not.toContain("use Abort");
  }, 20_000);

  it("★ the words STOPs and Abort still go stay true on a held run: the URGENT of the end says them, the real Abort answers ok and the STOP goes", async () => {
    const x = await dungThat();
    themRun(x.central, 87, [move("m1"), move("m2"), stop("s1")], ["s1"]);
    x.dia.treoSauKhiGhi(HANG_M2);
    await x.agent.tick();
    await choDen(() => x.journal.admitNonStop() === false, "the consume overran");
    x.clock.t += EDGE_JOURNAL_STALL_ALERT_MS;
    await choDen(() => canhBao("edge_journal_stalled").length === 1, "the URGENT");
    await hetDoan(x);
    await x.journal.flush();
    await x.shipper.flushAll();
    await x.agent.tick();
    await x.journal.flush();
    await x.shipper.flushAll();
    await choDen(() => canhBao("edge_journal_stall_recovered").length === 1, "the URGENT of the end");
    expect(canhBao("edge_journal_stall_recovered")[0].message).toContain("STOPs and Abort still go.");
    expect(hangRun(87).status).toBe("held");
    const { a, moi } = await abortRoiGuiLai(x, 87, ["s1"]);
    expect(a.ok).toBe(true);
    expect(moi).toEqual(["abort"]);
  }, 20_000);
});
