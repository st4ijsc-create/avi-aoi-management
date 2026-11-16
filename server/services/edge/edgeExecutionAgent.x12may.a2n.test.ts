/**
 * X-12 (DO-66 vòng 4) — the node's half of the A2(n) gate through the REAL engine re-send, robot only: real agent, real walker (loadDefaultEdgeWalker:
 * foeEngine.resendStopsOfAbortedRun over edgeRunStore.createEdgeSweepStore), real equipment route, real robotEdgeDispatch, real device port
 * (edgeDispatchDevicePort), real journal. Fake: FakeCentral, the robot driver (every STOP reaching it is counted). Mocks as robotEdgeDiskStall.a2n.test.ts.
 * Measured: over the re-send window, the robot reaches its driver ONCE when the node's own queued STOP on it succeeded after it learned of the abort;
 * twice when that STOP failed, or ran before any answer listed the run. OT through the real engine is a named limit (see the DO-66 report, round 4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  robot: null as null | Record<string, any>,
  db: null as unknown,
  /** the next STOP reaching the driver fails (once) */
  hongLanDau: false,
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
vi.mock("../robot/robotManager", () => ({ getActiveRobot: () => H.robot ?? undefined }));
vi.mock("../ot/adapterFacade", () => ({ createAdapterFacade: () => ({ getSafetyStatus: async () => ({ state: "OK", source: "test", ts: new Date().toISOString() }) }) }));
vi.mock("../robot/criticalStopAlert", async (orig) => ({
  ...(await orig<typeof import("../robot/criticalStopAlert")>()),
  raiseCriticalStopAlert: async (a: Record<string, unknown>) => void (a.baoBen as ((b: boolean) => void) | undefined)?.(true),
}));
vi.mock("./edgeCentralCommon", async (orig) => ({ ...(await orig<typeof import("./edgeCentralCommon")>()), nodeProtocolVersion: async () => 2, centralSigner: () => ({}) }));

import { FakeDb } from "../../routers/__otFakeDb";
import { __resetEdgeConfigAlertsForTests } from "./edgeConfigCentral";
import { _resetEdgeDeviceRuntimeForTests, installEdgeDeviceRuntime } from "./edgeDeviceRuntime";
import { edgeTrenDiaGia, nghi, thuMucTam, type EdgeTrenDiaGia } from "./edgeDiskStall.testkit";
import { edgeDispatchDevicePort, loadDefaultEdgeWalker, type EdgeDevicePort } from "./edgeExecutionAgent";
import { __resetJournalTreoForTests } from "./edgeExecutionCentral";
import { kitHashDefinition } from "./edgeFakeCentral.testkit";
import type { RobotJobSpec } from "../robot/robotDriver";
import { MotionLock } from "../robot/robotDriver";

const MACHINES = [{ id: 2, machineType: "ROBOT", capabilities: null }];
const move = (id: string) => ({ id, type: "command", machineId: 2, command: "run_job", args: { robotId: 12, jobType: "move", params: { x: 1 } } });
const stop = (id: string) => ({ id, type: "command", machineId: 2, command: "abort", args: { robotId: 12 } });
/** the run moved (m1 completed on this node) before it was aborted: a run that never actuated needs no STOP (the engine answers abortStopNotNeeded / runNeverActuated) */
const priorM1 = { completed: ["m1"], settled: ["m1"], attempted: ["m1"], startOrder: ["m1"], branches: [], abortSentBefore: [] as string[], unknown: false };

const tam = thuMucTam();
const don: Array<() => Promise<void>> = [];
let jobs: RobotJobSpec[];
/** STOPs on robot 12 that came from a central STOP REQUEST (handleCommand ⇒ the device port, source "command"): the rest of the driver's aborts are the picture's re-sends */
let lenhRobot = 0;

beforeEach(() => {
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
  process.env.AVI_PROCESS_ROLE = "edge";
  process.env.FOE_ENABLED = "true";
  process.env.ROBOT_CONTROL_TIMEOUT_MS = "1000";
  H.db = new FakeDb();
  H.hongLanDau = false;
  jobs = [];
  lenhRobot = 0;
  const lock = new MotionLock();
  const toiDriver = async (job: RobotJobSpec) => {
    jobs.push(job);
    if (job.jobType === "abort" && H.hongLanDau) {
      H.hongLanDau = false;
      throw new Error("driver error (test)");
    }
    return { ok: true, status: "done" };
  };
  H.robot = {
    id: 12,
    code: "rb-12",
    vendor: "sim",
    driver: {
      vendor: "sim",
      isConnected: () => true,
      getMotionLock: () => lock.snapshot(),
      lockMotion: (r: string, x?: string) => lock.lock(r, x),
      runJob: toiDriver,
      abort: async () => void (await toiDriver({ jobType: "abort", params: {} })),
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

/** the real edge with the REAL device port (a central STOP request reaches the same driver as the engine's re-send) and its device runtime installed */
async function dung(): Promise<EdgeTrenDiaGia> {
  let that: EdgeDevicePort | null = null;
  const tre: EdgeDevicePort = {
    stopRobot: (...a) => (a[2].source === "command" && lenhRobot++, that!.stopRobot(...a)),
    stopAdapter: (...a) => that!.stopAdapter(...a),
    lockRobot: (...a) => that!.lockRobot(...a),
    clearRobot: (...a) => that!.clearRobot(...a),
  };
  const x = await edgeTrenDiaGia(tam, { walker: await loadDefaultEdgeWalker(), devices: tre, progressMs: 15, requestTimeoutMs: 200 });
  that = edgeDispatchDevicePort(x.config);
  await _resetEdgeDeviceRuntimeForTests();
  await installEdgeDeviceRuntime({
    nodeId: x.central.nodeId,
    config: () => x.config.current(),
    journal: x.journal,
    robotControlEnabled: () => true,
    otControlEnabled: () => true,
    configStale: () => null,
    auth: () => ({ trust: x.config.trust(), credentialId: x.config.credentialId() as number, maxTtlMs: 10_000, pendingNonce: (n: string) => (x.authorize.nonceSentAt(n) === null ? null : { sentMonoMs: x.authorize.nonceSentAt(n) as number }), nowMonoMs: () => x.client.monoNow() }),
  });
  don.push(x.dong);
  return x;
}
/** the signed sweep picture of aborted run `runId` (definition: m1 moves robot 12, then the robot STOP s1), aborted 5 s ago on central's clock */
function anh(x: EdgeTrenDiaGia, runId: number) {
  const def = { ref: `r${runId}`, name: `r${runId}`, steps: [move("m1"), stop("s1")] };
  return { runId, picture: x.central.sign("runpkg", x.central.sweepPicture(runId, { definition: def as never, defHash: kitHashDefinition(def), machines: MACHINES as never, verifiedStops: [{ kind: "robot", stepId: "s1", robotId: 12 }], prior: { ...priorM1 }, abortedAt: Date.now() - 5_000 })) };
}
const stopXep = (x: EdgeTrenDiaGia, requestId: number) => x.central.sign("cmd", x.central.commandPayload({ requestId, kind: "stop", target: { robotId: 12 } }));
const soAbort = () => jobs.filter((j) => j.jobType === "abort").length;
/** central, modelled: a run leaves the list on a non-failed `sweep_stop` of it; the node pulls each time its re-send is due (agent clock +31 s), `n` pulls */
async function quaCuaSo(x: EdgeTrenDiaGia, n = 10) {
  for (let i = 0; i < n; i++) {
    await x.agent.tick();
    // why a wait (DO-66 vòng 5, read): the engine records a SENT STOP's `abort:` row WITHOUT awaiting it (foeEngine.ts:6307, :6325, :7076-7078 — only a
    // failed one is kept in ghiNo); on the node that row is what writes the `sweep_stop` (edgeRunStore.ts:767-777 ⇒ edgeExecutionAgent.ts:1224-1236). So
    // tick() can return before the record exists. Central (modelled) must see every record of a re-send that reached the driver before the node's clock
    // jumps past its back-off — the production node takes >= 10 s (stopResendMinMs) between re-sends, the model 0 ms. Waited ON THAT CONDITION, bounded.
    const canBanGhi = () => soAbort() - lenhRobot;
    for (let k = 0; k < 400; k++) {
      await x.journal.flush();
      await x.shipper.flushAll();
      if (x.central.received.locksEvents.filter((r) => r.kind === "sweep_stop").length >= canBanGhi()) break;
      await nghi(5);
    }
    expect(x.central.received.locksEvents.filter((r) => r.kind === "sweep_stop").length, "every re-send that reached the driver is recorded at central").toBe(canBanGhi());
    x.central.commands = [];
    const xacNhan = new Set(x.central.received.locksEvents.filter((r) => r.kind === "sweep_stop" && r.status !== "failed").map((r) => r.runId));
    x.central.stopsUnconfirmed = x.central.stopsUnconfirmed.filter((s) => !xacNhan.has(s.runId));
    x.clock.t += 31_000;
  }
}

describe("X-12 — the real engine re-send of a signed sweep picture, robot (edge half of the A2(n) gate)", () => {
  it("X12MAY-ROBOT-ANH-GUI-MOT-LAN (phủ) no STOP of the node's own: the picture's s1 reaches the robot's driver ONCE through the real engine, bound to the picture, then confirmed", async () => {
    const x = await dung();
    x.central.stopsUnconfirmed = [anh(x, 81)];
    await quaCuaSo(x);
    expect(soAbort()).toBe(1);
    expect(x.central.received.locksEvents.filter((r) => r.kind === "sweep_stop").map((r) => [r.runId, r.stepId, r.target, r.status])).toEqual([[81, "s1", { robotId: 12 }, "completed"]]);
    expect(x.central.stopsUnconfirmed).toEqual([]);
  }, 20_000);

  // đỏ trước sửa; đổi thành it ở commit 2 (X-12)
  it.fails("X12MAY-ROBOT-CUNG-LUOT-TONG-MOT-LAN (1) the answer that first lists the run also carries a signed STOP request on robot 12; it succeeds ⇒ over the window the robot reaches its driver ONCE: the engine never sends s1 again", async () => {
    const x = await dung();
    x.central.commands = [stopXep(x, 120)];
    x.central.stopsUnconfirmed = [anh(x, 82)];
    await quaCuaSo(x);
    expect(soAbort()).toBe(1);
  }, 20_000);

  it("X12MAY-ROBOT-STOP-LOI-VAN-GUI (1-đối chứng) the queued STOP on robot 12 FAILS at the driver ⇒ not known to have gone out: the engine sends s1 (two STOPs reach the driver), confirmed", async () => {
    const x = await dung();
    H.hongLanDau = true;
    x.central.commands = [stopXep(x, 121)];
    x.central.stopsUnconfirmed = [anh(x, 83)];
    await quaCuaSo(x);
    expect(soAbort()).toBe(2);
    expect(x.central.stopsUnconfirmed).toEqual([]);
  }, 20_000);

  it("X12MAY-ROBOT-TRUOC-LIET-KE-VAN-GUI (1-đối chứng) the queued STOP on robot 12 succeeded in a pull BEFORE any answer listed the run ⇒ not proven after the abort: the engine sends s1", async () => {
    const x = await dung();
    x.central.commands = [stopXep(x, 122)];
    await x.agent.tick();
    x.central.commands = [];
    x.clock.t += 31_000;
    x.central.stopsUnconfirmed = [anh(x, 84)];
    await quaCuaSo(x);
    expect(soAbort()).toBe(2);
  }, 20_000);
});
