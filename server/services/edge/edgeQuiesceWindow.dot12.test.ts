/**
 * doc 81 Đợt 12 task N fix 1 — review I-1, ruling R-12-d: the QUIESCE WINDOW of an edge robot.
 *
 * When a robot leaves the node or its settings change, the edge quiesces it: lock → STOP (D's dispatch) → detach. A CONFIRMED STOP
 * clears a lock that is not an operator hold (every session driver, and the SIM driver since Đợt 12), and the lock was taken again
 * only after the STOP's journal write (≤ STOP_DB_STEP_DEADLINE_MS). On the "reconfigured" path the robot is still in the signed
 * config, so a run's signed motion arriving in that window passed the edge gate.
 *
 * Now a QUIESCING state is set BEFORE the STOP is sent: the edge motion path refuses while it is set (ROBOT_QUIESCING), a STOP
 * never clears it, a signed clear of the old session does not either; only the detach (the session is gone) ends it — the NEW
 * session (re-attach) starts without it and needs its own fresh signed clear when it starts locked. The STOP is never delayed (L-7).
 *
 * REAL robotManager (edge attach of the PRODUCT sim driver), REAL robotEdgeDispatch with a signed per-step authorisation, REAL
 * quiesce (the reconciler's step); the motion is injected deterministically INSIDE the window: during the STOP's journal write.
 * No DB (EDGE trap).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";

const H = vi.hoisted(() => ({ dbCalls: 0, duringPreflight: null as null | (() => void), safetyReads: 0 }));
vi.mock("../../db/connection", () => ({
  getDb: async () => {
    H.dbCalls++;
    throw new Error("EDGE_DB_TRAP: getDb() on the edge");
  },
  isEdgeProcessRole: () => true,
}));
vi.mock("../ot/adapterFacade", () => ({
  createAdapterFacade: () => ({
    getSafetyStatus: async () => {
      H.safetyReads++;
      const f = H.duringPreflight;
      H.duringPreflight = null;
      if (f) f(); // something happens to the robot WHILE the motion awaits its safety preflight
      return { state: "OK", source: "test", ts: new Date().toISOString() };
    },
  }),
}));

import { EDGE_TYP_NAME, EdgeTrustStore, edgePinnedKeyset, generateEdgeSigningKey, signEdgeObject } from "./edgeSigning";
import { edgeCommandPayloadHash, type EdgeStepAuthorization } from "./edgeAuthorizationVerifier";
import { installEdgeDeviceRuntime, _resetEdgeDeviceRuntimeForTests, type EdgeDeviceRuntime, type EdgeDispatchJournal } from "./edgeDeviceRuntime";
import type { EdgeConfigSnapshot } from "./edgeProtocol";
import type { RobotJobSpec } from "../robot/robotDriver";

const T0 = 1_790_000_000_000;
const NODE = 7;
const CRED = 31;
const NONCE = "n0nce_AAAAAAAAAAAAAAAAAA";
const key = generateEdgeSigningKey().key;
const pin = edgePinnedKeyset([{ kid: key.kid, publicKeyPem: key.publicKeyPem, notBefore: T0 - 60_000 }], T0);
const MOVE: RobotJobSpec = { jobType: "move", params: { x: 1 } };
const ROW = {
  id: 12, code: "R12", name: "r12", vendor: "sim", model: null, kind: "arm", endpoint: "sim://12", connectionOptions: null, pollIntervalMs: 60_000,
  isEnabled: true, commissioned: true, lineId: 1, stationId: null, motionLock: null, motionLockGenerationFloor: 0, ownerEpoch: 3, updatedAt: T0,
};
const config = (): EdgeConfigSnapshot =>
  ({
    kind: "config_snapshot", protocolVersion: 2, configVersion: 3, issuedAt: T0,
    node: { id: NODE, code: "EDGE-A", credentialId: CRED, factoryCode: "F1", lineCodes: ["L1"] },
    adapters: [], robots: [ROW], machines: [], safetyPlcConfigs: [],
    keyset: signEdgeObject("keyset", { v: 1, version: 1, issuedAt: T0, keys: [] }, key) as never,
    limits: { authTtlMs: 10_000, maxClockSkewMs: 5_000, journalMaxBytes: 1_000_000, programReportMs: 30_000, programReportMaxAgeMs: 60_000, heartbeatMs: 5_000, pullMs: 2_000 },
  }) as EdgeConfigSnapshot;
let jtiN = 0;
function auth(stepId: string): { authorization: EdgeStepAuthorization; run: { runId: number; claimSeq: number; stepId: string; attempt: number }; idempotencyKey: string } {
  const jti = `2b8f3c1e-5d7a-4c1b-9a2e-${String(++jtiN).padStart(12, "0")}`;
  const idem = `foe:9:${stepId}:1`;
  const claims = {
    typ: EDGE_TYP_NAME.auth, kid: key.kid, jti, nodeId: NODE, credentialId: CRED, runId: 9, claimSeq: 2, stepId, attempt: 1,
    idempotencyKey: idem, kind: "robot", target: { robotId: 12, jobType: "move" },
    payloadHash: edgeCommandPayloadHash({ kind: "robot", robotId: 12, jobType: "move", params: { x: 1 } }), approval: { approvedBy: 4, gateStepId: "g" },
    mode: "real", verdicts: { commissioned: true, policy: "allow", interlock: "pass" }, safetyConfigIds: [], reqNonce: NONCE, iat: T0, ttlMs: 10_000,
  };
  return {
    authorization: { envelope: signEdgeObject("auth", claims, key), runId: 9, claimSeq: 2, stepId, attempt: 1, idempotencyKey: idem, reqNonce: NONCE },
    run: { runId: 9, claimSeq: 2, stepId, attempt: 1 },
    idempotencyKey: idem,
  };
}

/** the journal; `onStopRecord` runs INSIDE the STOP's journal write (the window between the driver's STOP and the re-lock) */
let onStopRecord: null | (() => Promise<void>) = null;
/** R-12-e I-2 — runs INSIDE a motion's journal consume (the fsync, up to 5 s on a real journal): the consume resolves when it does */
let onConsume: null | (() => Promise<void>) = null;
const consumed: string[] = [];
const runRecords: Array<Record<string, unknown>> = [];
const journal: EdgeDispatchJournal = {
  async consumeAuthorization(c) {
    if (consumed.includes(c.jti)) return { ok: false, reason: "jti_consumed" };
    consumed.push(c.jti);
    if (onConsume) {
      const f = onConsume;
      onConsume = null;
      await f();
    }
    return { ok: true };
  },
  isJtiConsumed: (jti) => consumed.includes(jti),
  admitNonStop: () => true,
  async appendRun(_runId, _claimSeq, rec) {
    runRecords.push(rec as Record<string, unknown>);
    return { seq: 1, durable: true };
  },
  async appendEvent(rec) {
    if ((rec as { kind?: string }).kind === "stop" && onStopRecord) {
      const f = onStopRecord;
      onStopRecord = null;
      await f();
    }
    return { seq: 1, durable: true };
  },
};
const runtime: EdgeDeviceRuntime = {
  nodeId: NODE,
  config,
  journal,
  auth: () => ({
    trust: EdgeTrustStore.fromPinned(pin, { nodeId: NODE, now: () => T0, skewMs: 5_000 }),
    credentialId: CRED,
    maxTtlMs: 10_000,
    pendingNonce: (n: string) => (n === NONCE ? { sentMonoMs: 1_000 } : null),
    nowMonoMs: () => 1_500,
  }),
  otControlEnabled: () => true,
  robotControlEnabled: () => true,
};

const saved: Record<string, string | undefined> = {};
beforeAll(async () => {
  for (const k of ["ROBOT_GATEWAY_ENABLED", "ROBOT_CONTROL_ENABLED", "ROBOT_CONTROL_TIMEOUT_MS"]) saved[k] = process.env[k];
  process.env.ROBOT_GATEWAY_ENABLED = "true";
  process.env.ROBOT_CONTROL_ENABLED = "true";
  process.env.ROBOT_CONTROL_TIMEOUT_MS = "2000";
  await installEdgeDeviceRuntime(runtime);
});
afterAll(async () => {
  const rm = await import("../robot/robotManager");
  await rm.stopRobots();
  await _resetEdgeDeviceRuntimeForTests();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** attach robot 12 on this edge (the product sim driver), its lock persisted to a no-op sink, starting UNLOCKED */
/** what the lock's persistence sink was told (the journal / row of the lock) */
const persisted: string[] = [];
async function attach() {
  const rm = await import("../robot/robotManager");
  const { attachEdgeMotionLockPersistence } = await import("../robot/robotMotionLockStore");
  const r = await rm.attachEdgeRobot(ROW as never, {
    attachLock: (robot, lock) => {
      attachEdgeMotionLockPersistence(robot.id, lock, { locked: null, generationBase: 0 }, { locked: () => void persisted.push("locked"), cleared: () => void persisted.push("cleared") });
    },
  });
  expect(r).toMatchObject({ ok: true });
  return rm.getActiveRobot(12)!;
}
/** count what reaches the robot (the session's own driver instance) */
function counted(robot: { driver: { runJob: (j: RobotJobSpec) => Promise<unknown> } }) {
  const jobs: string[] = [];
  const orig = robot.driver.runJob.bind(robot.driver);
  robot.driver.runJob = async (j: RobotJobSpec) => {
    jobs.push(j.jobType);
    return orig(j);
  };
  return jobs;
}

beforeEach(async () => {
  onStopRecord = null;
  onConsume = null;
  H.duringPreflight = null;
  const rm = await import("../robot/robotManager");
  if (rm.getActiveRobot(12)) await rm.detachRobot(12);
});

describe("doc 81 Đợt 12 N fix 1 (I-1, R-12-d) — the edge quiesce window", () => {
  it("control: an attached, unlocked robot takes a signed motion", async () => {
    const { dispatchRobotOnEdge } = await import("../robot/robotEdgeDispatch");
    const robot = await attach();
    const jobs = counted(robot as never);
    const r = await dispatchRobotOnEdge({ robotId: 12, job: MOVE, ...auth("c1") });
    expect(r).toMatchObject({ ok: true, status: "done" });
    expect(jobs).toEqual(["move"]);
  });

  it("★ a signed motion arriving INSIDE the window (after the confirmed STOP cleared the lock, before the re-lock) is REFUSED; the STOP went at once; the robot is detached", async () => {
    const { dispatchRobotOnEdge } = await import("../robot/robotEdgeDispatch");
    const { _quiesceRobotForTests } = await import("./edgeGatewayRuntime");
    const robot = await attach();
    const jobs = counted(robot as never);
    let inWindow: Awaited<ReturnType<typeof dispatchRobotOnEdge>> | null = null;
    let lockInWindow: boolean | null = null;
    let safetyReadsInWindow = -1;
    onStopRecord = async () => {
      lockInWindow = robot.driver.motionLockController!().snapshot().locked; // the raw lock: cleared by the confirmed STOP
      const r0 = H.safetyReads;
      inWindow = await dispatchRobotOnEdge({ robotId: 12, job: MOVE, ...auth("w1") });
      safetyReadsInWindow = H.safetyReads - r0;
    };
    const q = await _quiesceRobotForTests(12, "reconfigured (test)");
    // R-12-e I-2 — a confirmed STOP no longer clears the lock a quiesce took (was: false, the STOP cleared the raw lock)
    expect(lockInWindow).toBe(true);
    expect(inWindow).toMatchObject({ ok: false, status: "rejected", reason: "ROBOT_QUIESCING" });
    expect(jobs).toEqual(["abort"]); // the STOP reached the robot; the motion never did
    expect(consumed).not.toContain(`2b8f3c1e-5d7a-4c1b-9a2e-${String(jtiN).padStart(12, "0")}`); // its authorisation unused
    expect(safetyReadsInWindow).toBe(0); // refused at the gate's entry: not even a safety-PLC read for it
    expect(q).toMatchObject({ ok: true });
  });

  it("★ quiescing is set BEFORE the STOP is sent and a failed quiesce keeps it: a STOP and a signed clear of the old session do not lift it — only the detach does; the NEW session is not quiescing", async () => {
    const { dispatchRobotOnEdge } = await import("../robot/robotEdgeDispatch");
    const { _quiesceRobotForTests } = await import("./edgeGatewayRuntime");
    const rm = await import("../robot/robotManager");
    const robot = await attach();
    let quiescingAtStop: unknown = null;
    const orig = robot.driver.runJob.bind(robot.driver);
    let stopFails = true;
    robot.driver.runJob = async (j: RobotJobSpec) => {
      if (j.jobType === "abort") {
        quiescingAtStop = rm.robotQuiescing(12);
        if (stopFails) return { ok: false, status: "failed", error: "controller rejected" };
      }
      return orig(j);
    };
    const q = await _quiesceRobotForTests(12, "reconfigured (test)");
    expect(q).toMatchObject({ ok: false, cause: "stop" });
    expect(quiescingAtStop).toMatchObject({ why: expect.stringMatching(/reconfigured/) });
    expect(rm.getActiveRobot(12)).toBe(robot); // the OLD session is kept …
    // … quiescing: an operator's signed clear of its lock + a STOP that succeeds do not lift it
    const lc = robot.driver.motionLockController!();
    lc.clearByOperator({ reason: "signed clear", userId: 1, expectedGeneration: lc.snapshot().generation ?? 0 });
    stopFails = false;
    expect(await dispatchRobotOnEdge({ robotId: 12, job: { jobType: "abort", params: {} }, idempotencyKey: "stop-k1", source: "local" })).toMatchObject({ ok: true, stop: true }); // L-7
    expect(rm.robotQuiescing(12)).not.toBeNull();
    expect(await dispatchRobotOnEdge({ robotId: 12, job: MOVE, ...auth("k1") })).toMatchObject({ ok: false, reason: "ROBOT_QUIESCING" });
    // the detach ends it; the NEW session starts without it
    await rm.detachRobot(12);
    expect(rm.robotQuiescing(12)).toBeNull();
    const { sessionQuiescing } = await import("../robot/robotQuiesce");
    expect(sessionQuiescing(robot.driver)).toBeNull(); // the detached session's state is gone with it
    await attach();
    expect(rm.robotQuiescing(12)).toBeNull();
    expect(await dispatchRobotOnEdge({ robotId: 12, job: MOVE, ...auth("n1") })).toMatchObject({ ok: true, status: "done" });
  });

  it("★ R-12-e I-2: a signed motion WAITING on its journal consume while the quiesce STOP completes is refused after the consume (ROBOT_QUIESCING) — the robot gets only the STOP; the jti is consumed and reported unused; the confirmed STOP did not clear the quiesce lock", async () => {
    const { dispatchRobotOnEdge } = await import("../robot/robotEdgeDispatch");
    const { _quiesceRobotForTests } = await import("./edgeGatewayRuntime");
    const robot = await attach();
    const jobs = counted(robot as never);
    let consumeEntered!: () => void;
    let releaseConsume!: () => void;
    const entered = new Promise<void>((r) => (consumeEntered = r));
    onConsume = () => {
      consumeEntered();
      return new Promise<void>((r) => (releaseConsume = r));
    };
    const a = auth("i2");
    const jti = `2b8f3c1e-5d7a-4c1b-9a2e-${String(jtiN).padStart(12, "0")}`;
    const pMotion = dispatchRobotOnEdge({ robotId: 12, job: MOVE, ...a });
    await entered; // the motion passed every gate and its re-check; it now waits on the consume
    let motion: Awaited<typeof pMotion> | null = null;
    let lockAfterStop: boolean | null = null;
    onStopRecord = async () => {
      // the quiesce STOP was CONFIRMED by the robot; its journal write is in progress (the old re-lock waited behind it): NOW the consume resolves
      lockAfterStop = robot.driver.motionLockController!().snapshot().locked;
      releaseConsume();
      motion = await pMotion;
    };
    const q = await _quiesceRobotForTests(12, "reconfigured (test)");
    expect(motion).toMatchObject({ ok: false, status: "rejected", reason: "ROBOT_QUIESCING", jti });
    expect(jobs).toEqual(["abort"]); // no runJob(motion): the STOP only
    expect(consumed).toContain(jti); // consumed …
    expect(runRecords.filter((r) => r.jti === jti)).toEqual([expect.objectContaining({ jti, stop: false, status: "rejected", result: expect.objectContaining({ reason: "ROBOT_QUIESCING" }) })]); // … and reported unused
    expect(lockAfterStop).toBe(true); // (a) the confirmed STOP did not clear the quiesce lock
    expect(q).toMatchObject({ ok: true }); // the session was still released (detach)
  });

  it("R-12-e I-2 (b): the post-consume re-check also refuses a LOCK taken (MOTION_LOCKED) or a session REPLACED (ROBOT_NOT_ACTIVE) while the motion awaited its consume — nothing sent, the jti reported unused", async () => {
    const { dispatchRobotOnEdge } = await import("../robot/robotEdgeDispatch");
    const rm = await import("../robot/robotManager");
    for (const what of ["lock", "replace"] as const) {
      const robot = await attach();
      const jobs = counted(robot as never);
      onConsume = async () => {
        if (what === "lock") robot.driver.lockMotion!("line_connection_closed", "during the consume");
        else {
          await rm.detachRobot(12);
          await attach();
        }
      };
      const a = auth(`b-${what}`);
      const jti = `2b8f3c1e-5d7a-4c1b-9a2e-${String(jtiN).padStart(12, "0")}`;
      const r = await dispatchRobotOnEdge({ robotId: 12, job: MOVE, ...a });
      expect(r).toMatchObject({ ok: false, status: "rejected", reason: what === "lock" ? "MOTION_LOCKED" : "ROBOT_NOT_ACTIVE", jti });
      expect(jobs).toEqual([]);
      expect(runRecords.filter((x) => x.jti === jti)).toEqual([expect.objectContaining({ status: "rejected" })]);
      await rm.detachRobot(12);
    }
  });

  it("R-12-e I-2 (a): a confirmed STOP does not clear a quiesce lock even when the quiesce never completes (failed detach) — only the detach ends the session; a lock that is NOT a quiesce lock is still cleared by a confirmed STOP", async () => {
    const { dispatchRobotOnEdge } = await import("../robot/robotEdgeDispatch");
    const rm = await import("../robot/robotManager");
    let robot = await attach();
    // control: an ordinary lock (link loss) is cleared by a confirmed STOP, as before
    robot.driver.lockMotion!("line_connection_closed", "test");
    expect(await dispatchRobotOnEdge({ robotId: 12, job: { jobType: "abort", params: {} }, idempotencyKey: "stop-c1", source: "local" })).toMatchObject({ ok: true, stop: true });
    expect(robot.driver.motionLockController!().snapshot().locked).toBe(false);
    // a quiesce lock survives a confirmed STOP — in memory AND in its persisted record (never "cleared" by the STOP)
    const lc = robot.driver.motionLockController!();
    lc.lock("ownershipRemoved", "test");
    lc.holdForQuiesce("test quiesce");
    persisted.length = 0;
    expect(await dispatchRobotOnEdge({ robotId: 12, job: { jobType: "abort", params: {} }, idempotencyKey: "stop-c2", source: "local" })).toMatchObject({ ok: true, stop: true }); // L-7: the STOP is sent
    expect(lc.snapshot().locked).toBe(true);
    expect(lc.isLocked()).toBe(true);
    expect(persisted).toEqual([]); // the STOP did not clear the persisted lock either
    // not even an operator clear of the old session lifts the quiesce hold (motion stays refused; only the detach ends it)
    lc.clearByOperator({ reason: "signed clear", userId: 1, expectedGeneration: lc.snapshot().generation ?? 0 });
    expect(lc.isLocked()).toBe(true);
    expect(lc.snapshot()).toMatchObject({ locked: true, reasonCode: "ownershipRemoved" });
    await rm.detachRobot(12);
    robot = await attach(); // the new session starts without the hold
    expect(robot.driver.motionLockController!().isLocked()).toBe(false);
  });

  it("★ R-12-e M-5: a FAILED quiesce is VISIBLE (edge health lists the robot as quiescing and reports degraded) and is RETRIED even when the settings were reverted meanwhile (the session key matches again)", async () => {
    const { _quiesceRobotForTests, edgeRobotsQuiescing, edgeRobotSessionUpToDate, getEdgeGatewayHealth, setReachabilityProbe } = await import("./edgeGatewayRuntime");
    const rm = await import("../robot/robotManager");
    setReachabilityProbe(() => true);
    try {
      const robot = await attach();
      expect(await edgeRobotsQuiescing()).toEqual([]);
      expect((await getEdgeGatewayHealth()).robotsQuiescing).toEqual([]);
      const orig = robot.driver.runJob.bind(robot.driver);
      robot.driver.runJob = async (j: RobotJobSpec) => (j.jobType === "abort" ? { ok: false, status: "failed" as const, error: "controller rejected" } : orig(j));
      expect(await _quiesceRobotForTests(12, "reconfigured (test)")).toMatchObject({ ok: false, cause: "stop" });
      // visible: the node health (shipped as the heartbeat status) names the robot and is degraded
      expect(await edgeRobotsQuiescing()).toEqual([{ robotId: 12, since: expect.any(String), why: expect.stringMatching(/reconfigured/) }]);
      const h = await getEdgeGatewayHealth();
      expect(h.robotsQuiescing).toEqual([expect.objectContaining({ robotId: 12 })]);
      expect(h.status).toBe("degraded");
      // retried: the session counts as NOT up to date while it is quiescing, even with the same key (reverted settings)
      expect(edgeRobotSessionUpToDate("k1", "k1", rm.robotQuiescing(12) !== null)).toBe(false);
      expect(edgeRobotSessionUpToDate("k1", "k1", false)).toBe(true);
      expect(edgeRobotSessionUpToDate("k1", "k2", false)).toBe(false);
      expect(edgeRobotSessionUpToDate(undefined, "k1", false)).toBe(false);
      await rm.detachRobot(12);
      expect(await edgeRobotsQuiescing()).toEqual([]);
    } finally {
      setReachabilityProbe(null);
    }
  });

  it("★ the gate is RE-CHECKED after the motion's own awaits: quiescing (or a lock) that starts while it awaits its safety preflight ⇒ refused before the consume, nothing sent", async () => {
    const { dispatchRobotOnEdge } = await import("../robot/robotEdgeDispatch");
    const { markSessionQuiescing } = await import("../robot/robotQuiesce");
    const rm = await import("../robot/robotManager");
    let robot = await attach();
    let jobs = counted(robot as never);
    H.duringPreflight = () => markSessionQuiescing(robot.driver, "settings changed (test)");
    expect(await dispatchRobotOnEdge({ robotId: 12, job: MOVE, ...auth("p1") })).toMatchObject({ ok: false, reason: "ROBOT_QUIESCING" });
    expect(jobs).toEqual([]);
    await rm.detachRobot(12);
    robot = await attach();
    jobs = counted(robot as never);
    H.duringPreflight = () => robot.driver.lockMotion!("line_connection_closed", "test");
    expect(await dispatchRobotOnEdge({ robotId: 12, job: MOVE, ...auth("p2") })).toMatchObject({ ok: false, reason: "MOTION_LOCKED" });
    expect(jobs).toEqual([]);
  });
});
