/**
 * doc 81 Đợt 10 task D (design §2.9, §2.13, §2.14) — the EDGE front end of a robot job (robotEdgeDispatch.ts), with NO database:
 *   MOTION: verify the signed per-step authorisation → local gates (owned + enabled in the signed snapshot, driver connected,
 *   in-memory motion lock, motion slot R14, journal admission, safety preflight) → journal consume BEFORE the driver → device
 *   stage (robotDeviceRun: one channel, deadline, lock-then-stop on an unknown outcome) → journal report.
 *   STOP: the canonical abort goes straight to the driver and NEVER asks — no authorisation, no verifier, no consume (L-7); a
 *   robot the snapshot KNOWS to be uncommissioned records it simulated, unknown ⇒ sent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  robot: null as null | Record<string, any>,
  safety: { state: "OK" } as { state: string },
  safetyReads: 0,
  dbCalls: 0,
}));
vi.mock("../../db/connection", () => ({
  getDb: async () => {
    H.dbCalls++;
    throw new Error("EDGE_DB_TRAP: getDb() on the edge");
  },
  isEdgeProcessRole: () => true,
}));
vi.mock("./robotManager", () => ({ getActiveRobot: () => H.robot ?? undefined }));
vi.mock("../ot/adapterFacade", () => ({
  createAdapterFacade: () => ({
    getSafetyStatus: async () => {
      H.safetyReads++;
      return { ...H.safety, source: "test", ts: new Date().toISOString() };
    },
  }),
}));

import { EDGE_TYP_NAME, EdgeTrustStore, edgePinnedKeyset, generateEdgeSigningKey, signEdgeObject } from "../edge/edgeSigning";
import { edgeCommandPayloadHash, type EdgeStepAuthorization } from "../edge/edgeAuthorizationVerifier";
import type { EdgeDeviceRuntime, EdgeDispatchJournal } from "../edge/edgeDeviceRuntime";
import type { EdgeConfigSnapshot } from "../edge/edgeProtocol";
import { dispatchRobotOnEdge } from "./robotEdgeDispatch";
import { MotionLock, type RobotJobSpec } from "./robotDriver";
import { claimRobotMotionSlot, releaseRobotMotionSlot, robotMotionInFlight } from "./robotDeviceRun";

const T0 = 1_790_000_000_000;
const NODE = 7;
const CRED = 31;
const NONCE = "n0nce_AAAAAAAAAAAAAAAAAA";
const JTI = "2b8f3c1e-5d7a-4c1b-9a2e-3f4d5c6b7a81";
const key = generateEdgeSigningKey().key;
const pin = edgePinnedKeyset([{ kid: key.kid, publicKeyPem: key.publicKeyPem, notBefore: T0 - 60_000 }], T0);
let mono = 1_500;
const sentAt = 1_000;

const MOVE: RobotJobSpec = { jobType: "move", params: { x: 1 } };
function config(over: Record<string, unknown> = {}): EdgeConfigSnapshot {
  return {
    kind: "config_snapshot", protocolVersion: 2, configVersion: 3, issuedAt: T0,
    node: { id: NODE, code: "EDGE-A", credentialId: CRED, factoryCode: "F1", lineCodes: ["L1"] },
    adapters: [],
    robots: [
      {
        id: 12, code: "R12", name: "r12", vendor: "sim", model: null, kind: "arm", endpoint: "sim://12", connectionOptions: null, pollIntervalMs: 1000,
        isEnabled: true, commissioned: true, lineId: 1, stationId: null, motionLock: null, motionLockGenerationFloor: 0, ownerEpoch: 3, updatedAt: T0, ...over,
      },
    ],
    machines: [], safetyPlcConfigs: [],
    keyset: signEdgeObject("keyset", { v: 1, version: 1, issuedAt: T0, keys: [] }, key) as never,
    limits: { authTtlMs: 10_000, maxClockSkewMs: 5_000, journalMaxBytes: 1_000_000, programReportMs: 30_000, programReportMaxAgeMs: 60_000, heartbeatMs: 5_000, pullMs: 2_000 },
  } as EdgeConfigSnapshot;
}
function claims(over: Record<string, unknown> = {}) {
  return {
    typ: EDGE_TYP_NAME.auth, kid: key.kid, jti: JTI, nodeId: NODE, credentialId: CRED, runId: 9, claimSeq: 2, stepId: "m1", attempt: 1,
    idempotencyKey: "foe:9:m1:1", kind: "robot", target: { robotId: 12, jobType: "move" },
    payloadHash: edgeCommandPayloadHash({ kind: "robot", robotId: 12, jobType: "move", params: { x: 1 } }), approval: { approvedBy: 4, gateStepId: "g" },
    mode: "real", verdicts: { commissioned: true, policy: "allow", interlock: "pass" }, safetyConfigIds: [], reqNonce: NONCE, iat: T0, ttlMs: 10_000, ...over,
  };
}
const auth = (over: Record<string, unknown> = {}): EdgeStepAuthorization => ({
  envelope: signEdgeObject("auth", claims(over), key), runId: 9, claimSeq: 2, stepId: "m1", attempt: 1, idempotencyKey: "foe:9:m1:1", reqNonce: NONCE,
});

type Journal = EdgeDispatchJournal & { consumed: string[]; runs: any[]; events: any[]; order: string[]; full: boolean };
function journal(): Journal {
  const j: Journal = {
    consumed: [], runs: [], events: [], order: [], full: false,
    async consumeAuthorization(c) {
      j.order.push("consume");
      if (j.consumed.includes(c.jti)) return { ok: false, reason: "jti_consumed" };
      j.consumed.push(c.jti);
      return { ok: true };
    },
    isJtiConsumed: (jti) => j.consumed.includes(jti),
    admitNonStop: () => !j.full,
    async appendRun(runId, claimSeq, rec) {
      j.runs.push({ runId, claimSeq, ...rec });
      return { seq: j.runs.length, durable: true };
    },
    async appendEvent(rec) {
      j.events.push(rec);
      return { seq: j.events.length, durable: true };
    },
  };
  return j;
}
let pendingCalls = 0;
function runtime(j: Journal, over: Partial<EdgeDeviceRuntime> = {}): EdgeDeviceRuntime {
  return {
    nodeId: NODE,
    config: () => config(),
    journal: j,
    auth: () => ({
      trust: EdgeTrustStore.fromPinned(pin, { nodeId: NODE, now: () => T0, skewMs: 5_000 }),
      credentialId: CRED,
      maxTtlMs: 10_000,
      pendingNonce: (n: string) => {
        pendingCalls++;
        return n === NONCE ? { sentMonoMs: sentAt } : null;
      },
      nowMonoMs: () => mono,
    }),
    otControlEnabled: () => true,
    robotControlEnabled: () => true,
    ...over,
  };
}

let jobs: RobotJobSpec[];
let lock: MotionLock;
let runJobImpl: (job: RobotJobSpec) => Promise<unknown>;
beforeEach(() => {
  mono = 1_500;
  pendingCalls = 0;
  H.safety = { state: "OK" };
  H.safetyReads = 0;
  H.dbCalls = 0;
  jobs = [];
  lock = new MotionLock();
  runJobImpl = async () => ({ ok: true, status: "done" });
  H.robot = {
    id: 12, code: "R12", vendor: "sim",
    driver: {
      vendor: "sim",
      isConnected: () => true,
      getMotionLock: () => lock.snapshot(),
      lockMotion: (r: string, d?: string) => lock.lock(r, d),
      runJob: async (job: RobotJobSpec) => {
        jobs.push(job);
        return runJobImpl(job);
      },
      abort: async () => {
        jobs.push({ jobType: "abort", params: {} });
      },
    },
  };
  process.env.ROBOT_CONTROL_TIMEOUT_MS = "1000";
});

const run = { runId: 9, claimSeq: 2, stepId: "m1", attempt: 1 };

describe("robotEdgeDispatch — MOTION needs a valid, fresh, single-use authorisation", () => {
  it("control: valid ⇒ consume BEFORE the driver, one runJob with the exact job, ledger quotes the jti; no DB", async () => {
    const j = journal();
    runJobImpl = async () => {
      j.order.push("runJob");
      return { ok: true, status: "done" };
    };
    const r = await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: auth(), run }, runtime(j));
    expect(r).toMatchObject({ ok: true, status: "done", stop: false, jti: JTI });
    expect(jobs).toEqual([MOVE]);
    expect(j.order).toEqual(["consume", "runJob"]);
    expect(j.runs).toMatchObject([{ kind: "ledger", stepId: "m1", jti: JTI, stop: false, status: "done", target: { robotId: 12, jobType: "move" } }]);
    expect(robotMotionInFlight(12)).toBeNull();
    expect(H.dbCalls).toBe(0);
  });

  it("★ payload-hash mismatch (params about to be sent ≠ authorised) ⇒ refused; 0 driver calls, 0 consume", async () => {
    const j = journal();
    const r = await dispatchRobotOnEdge({ robotId: 12, job: { jobType: "move", params: { x: 2 } }, idempotencyKey: "foe:9:m1:1", authorization: auth(), run }, runtime(j));
    expect(r).toMatchObject({ ok: false, status: "rejected", reason: "AUTHORIZATION_INVALID", detail: "payload_mismatch" });
    expect(jobs).toHaveLength(0);
    expect(j.consumed).toHaveLength(0);
  });

  it("★ another robot / job type than authorised ⇒ refused (target bound by the signature)", async () => {
    const j = journal();
    const r = await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: auth({ target: { robotId: 12, jobType: "home" } }), run }, runtime(j));
    expect(r).toMatchObject({ reason: "AUTHORIZATION_INVALID", detail: "target_mismatch" });
    expect(jobs).toHaveLength(0);
  });

  it("★ EXPIRED ⇒ refused; REPLAYED ⇒ refused jti_consumed (one motion only)", async () => {
    const j = journal();
    mono = sentAt + 10_001;
    expect(await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: auth(), run }, runtime(j))).toMatchObject({ detail: "expired" });
    mono = 1_500;
    const a = auth();
    expect((await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: a, run }, runtime(j))).ok).toBe(true);
    expect(await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: a, run }, runtime(j))).toMatchObject({ reason: "AUTHORIZATION_INVALID", detail: "jti_consumed" });
    expect(jobs).toHaveLength(1);
    expect(j.order.filter((x) => x === "consume")).toHaveLength(1); // the verifier refuses before the journal is even asked
  });

  it("★ REPLAYED after a restart (nonce no longer pending in this process) ⇒ refused nonce_not_pending; a failed consume ⇒ nothing sent", async () => {
    const j = journal();
    const restarted = runtime(j, { auth: () => ({ ...runtime(j).auth()!, pendingNonce: () => null }) });
    expect(await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: auth(), run }, restarted)).toMatchObject({ reason: "AUTHORIZATION_INVALID", detail: "nonce_not_pending" });
    j.consumeAuthorization = async () => ({ ok: false, reason: "io_error" });
    expect(await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: auth(), run }, runtime(j))).toMatchObject({ reason: "JOURNAL_CONSUME_FAILED" });
    expect(jobs).toHaveLength(0);
  });

  it("local gates: in-memory MOTION_LOCKED, disabled in the snapshot, not owned, journal full, safety not OK, slot busy — all BEFORE the consume", async () => {
    const j = journal();
    lock.lock("motion_outcome_unknown");
    expect(await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: auth(), run }, runtime(j))).toMatchObject({ reason: "MOTION_LOCKED" });
    lock = new MotionLock();
    expect(await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: auth(), run }, runtime(j, { config: () => config({ isEnabled: false }) }))).toMatchObject({ reason: "ROBOT_DISABLED" });
    expect(await dispatchRobotOnEdge({ robotId: 13, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: auth(), run }, runtime(j))).toMatchObject({ reason: "NOT_OWNED" });
    j.full = true;
    expect(await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: auth(), run }, runtime(j))).toMatchObject({ reason: "JOURNAL_FULL" });
    j.full = false;
    H.safety = { state: "UNKNOWN" };
    expect(await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: auth(), run }, runtime(j))).toMatchObject({ reason: "SAFETY_UNKNOWN" });
    expect(j.consumed).toHaveLength(0);
    expect(jobs).toHaveLength(0);
  });

  it("R14: a motion already in flight on the robot ⇒ ROBOT_MOTION_IN_PROGRESS before the consume; the slot is released after a run", async () => {
    const j = journal();
    expect(claimRobotMotionSlot(12, "pick_place")).toBeNull();
    try {
      expect(await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: auth(), run }, runtime(j))).toMatchObject({ reason: "robot_motion_in_progress" });
      expect(j.consumed).toHaveLength(0);
      expect(jobs).toHaveLength(0);
    } finally {
      releaseRobotMotionSlot(12);
    }
    expect((await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: auth(), run }, runtime(j))).ok).toBe(true);
    expect(robotMotionInFlight(12)).toBeNull();
  });

  it("central's signed verdict commissioned=false ⇒ simulated (as central's commissioning gate), no driver call", async () => {
    const j = journal();
    expect(await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: auth({ verdicts: { commissioned: false, policy: "allow", interlock: "pass" } }), run }, runtime(j))).toMatchObject({ status: "simulated" });
    expect(jobs).toHaveLength(0);
  });

  it("an unknown motion outcome (deadline) ⇒ the robot is LOCKED and the stop goes out before the answer (device stage shared with central)", async () => {
    const j = journal();
    runJobImpl = () => new Promise(() => undefined);
    const r = await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: auth(), run }, runtime(j));
    expect(r).toMatchObject({ ok: false, status: "failed" });
    expect(lock.isLocked()).toBe(true);
    expect(jobs.map((x) => x.jobType)).toEqual(["move", "abort"]);
    expect(j.runs[0]).toMatchObject({ status: "failed", result: { abort: "abort_sent" } });
  });

  it("central's kill switch (mode simulated) / commissioned=false verdict / local ROBOT_CONTROL off ⇒ simulated, no driver call", async () => {
    const j = journal();
    expect(await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: auth({ mode: "simulated" }), run }, runtime(j))).toMatchObject({ status: "simulated" });
    expect(jobs).toHaveLength(0);
  });
});

describe("robotEdgeDispatch — ★ a STOP never asks (L-7)", () => {
  const STOP = { robotId: 12, job: { jobType: "abort" as const, params: { order: { evil: true } } }, idempotencyKey: "abort:9:m1" };

  it("★ the canonical abort goes to the driver with NO authorisation, no verifier call, no consume — even with no keyset, a full journal, a locked robot, the safety PLC blocked and a motion in flight", async () => {
    const j = journal();
    j.full = true;
    lock.lock("motion_outcome_unknown");
    H.safety = { state: "BLOCKED" };
    const rt = runtime(j, { auth: () => {
      throw new Error("the verifier must never be consulted for a STOP");
    } });
    const r = await dispatchRobotOnEdge({ ...STOP, run }, rt);
    expect(r).toMatchObject({ ok: true, status: "done", stop: true });
    expect(jobs).toEqual([{ jobType: "abort", params: {} }]); // caller params dropped (R-1C-m)
    expect(pendingCalls).toBe(0);
    expect(j.order).toEqual([]);
    expect(H.safetyReads).toBe(0);
    expect(j.runs).toMatchObject([{ kind: "ledger", jti: null, stop: true, status: "done", target: { robotId: 12, jobType: "abort" } }]);
  });

  it("a robot the snapshot KNOWS is uncommissioned ⇒ STOP recorded simulated (R-1C-d); commissioned UNKNOWN (null) ⇒ SENT", async () => {
    const j = journal();
    expect(await dispatchRobotOnEdge({ ...STOP, run }, runtime(j, { config: () => config({ commissioned: false }) }))).toMatchObject({ status: "simulated", stop: true });
    expect(jobs).toHaveLength(0);
    expect(await dispatchRobotOnEdge({ ...STOP, run }, runtime(j, { config: () => config({ commissioned: null }) }))).toMatchObject({ status: "done", stop: true });
    expect(jobs).toHaveLength(1);
  });

  it("★ no runtime at all (config never fetched) ⇒ the STOP is still SENT; a console STOP is journaled on events", async () => {
    const saved = process.env.ROBOT_CONTROL_ENABLED;
    process.env.ROBOT_CONTROL_ENABLED = "true"; // no runtime ⇒ the edge's own env decides the mode
    try {
      const r = await dispatchRobotOnEdge({ ...STOP }, null);
      expect(r).toMatchObject({ ok: true, stop: true, status: "done" });
    } finally {
      if (saved === undefined) delete process.env.ROBOT_CONTROL_ENABLED;
      else process.env.ROBOT_CONTROL_ENABLED = saved;
    }
    const j = journal();
    await dispatchRobotOnEdge({ ...STOP, source: "command", requestId: 5 }, runtime(j));
    expect(j.events).toMatchObject([{ kind: "stop", target: { robotId: 12 }, source: "command", requestId: 5, outcome: "sent" }]);
  });
});

describe("robotEdgeDispatch — R-10-i: an OVERDUE central STOP command is still applied", () => {
  it("★ a signed `stop` past its expiresAt verifies with expired=true — the front end SENDS it anyway (never discarded for being old)", async () => {
    const { verifyEdgeCommand } = await import("../edge/edgeTrust");
    const cmd = { kind: "stop", requestId: 41, nodeId: NODE, credentialId: CRED, ownerEpoch: 3, issuedAt: T0 - 120_000, expiresAt: T0 - 60_000, target: { robotId: 12 } };
    const v = verifyEdgeCommand(EdgeTrustStore.fromPinned(pin, { nodeId: NODE, now: () => T0, skewMs: 5_000 }), signEdgeObject("cmd", cmd, key), { credentialId: CRED });
    expect(v).toMatchObject({ ok: true, expired: true });
    const j = journal();
    const r = await dispatchRobotOnEdge({ robotId: 12, job: { jobType: "abort", params: {} }, idempotencyKey: "cmd:41", source: "command", requestId: 41 }, runtime(j));
    expect(r).toMatchObject({ ok: true, stop: true, status: "done" });
    expect(jobs).toEqual([{ jobType: "abort", params: {} }]);
    expect(j.events).toMatchObject([{ kind: "stop", source: "command", requestId: 41, outcome: "sent" }]);
  });
});
