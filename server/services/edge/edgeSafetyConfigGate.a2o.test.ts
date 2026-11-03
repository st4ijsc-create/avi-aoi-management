/**
 * R1b-2b-2a A2(o) — an edge node never writes to a device while it lacks a safety PLC that guards the device, nor while central has
 * announced a newer config it has not adopted. ONE helper (edgeDeviceRuntime.edgeNonStopConfigGate) on BOTH non-STOP edge paths
 * (otEdgeDispatch, robotEdgeDispatch), after the authorisation is verified and before the driver / preflight / slot / consume.
 *
 *   O1 — the device is guarded ONLY by PLC #7, which the edge's verified snapshot lacks; the node has ANOTHER PLC (#8) reading
 *        clean (the facade answers OK), central's preflight was off (it signed [7] without reading it) ⇒ the write is REFUSED
 *        (base e361adbca: sent — the edge never read the signed `safetyConfigIds`). OT and robot motion.
 *   O5 — a pinned OT STOP / robot abort with the PLC missing AND the config stale ⇒ still sent (L-7), no config gate.
 *   O6 — the SAME helper is used by both front ends (behaviour above + a source scan of both files).
 *   O7 — a stale-marked config (rt.configStale) ⇒ every non-STOP refused, with the versions + age; not stale ⇒ allowed; a
 *        staleness that cannot be read ⇒ refused (fail-closed).
 * Real signing (Ed25519), fake driver / journal / facade; the DB module is a trap.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const H = vi.hoisted(() => ({
  driver: null as null | { writes: Array<Array<Record<string, unknown>>>; writeTags: (w: Array<Record<string, unknown>>) => Promise<unknown>; readTags: () => Promise<unknown[]> },
  robot: null as null | Record<string, any>,
  fingerprint: "f".repeat(64) as string | undefined,
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
vi.mock("../ot/otManager", () => ({
  getActiveDriver: () => H.driver ?? undefined,
  getActiveConnectionFingerprint: () => H.fingerprint,
  listActiveAdapters: () => [],
  adapterSessionResetBoundMs: () => 1000,
  resetAdapterSession: async () => ({ reset: true, via: "test" }),
}));
vi.mock("../robot/robotManager", () => ({ getActiveRobot: () => H.robot ?? undefined }));
// the node's OTHER safety PLC (#8) reads clean: the facade over the shipped configs answers OK
vi.mock("../ot/adapterFacade", () => ({
  createAdapterFacade: () => ({
    getSafetyStatus: async () => {
      H.safetyReads++;
      return { state: "OK", source: "test", ts: new Date().toISOString() };
    },
  }),
}));

import { EDGE_TYP_NAME, EdgeTrustStore, edgePinnedKeyset, generateEdgeSigningKey, signEdgeObject } from "./edgeSigning";
import { edgeCommandPayloadHash, type EdgeStepAuthorization } from "./edgeAuthorizationVerifier";
import type { EdgeConfigStaleness, EdgeDeviceRuntime, EdgeDispatchJournal } from "./edgeDeviceRuntime";
import type { EdgeConfigSnapshot } from "./edgeProtocol";
import { dispatchOtOnEdge } from "../ot/otEdgeDispatch";
import { _resetAdapterCommandQueuesForTests } from "../ot/otDeviceWrite";
import { dispatchRobotOnEdge } from "../robot/robotEdgeDispatch";
import { MotionLock, type RobotJobSpec } from "../robot/robotDriver";
import { robotMotionInFlight } from "../robot/robotDeviceRun";

const T0 = Date.now();
const NODE = 7;
const CRED = 31;
const NONCE = "n0nce_AAAAAAAAAAAAAAAAAA";
const JTI = "0b8f3c1e-5d7a-4c1b-9a2e-3f4d5c6b7a81";
const key = generateEdgeSigningKey().key;
const pin = edgePinnedKeyset([{ kid: key.kid, publicKeyPem: key.publicKeyPem, notBefore: T0 - 60_000 }], T0 - 60_000);
let mono = 1_500;
const sentAt = 1_000;

/** PLC #8 — the node's OTHER safety PLC (real backend, mapped), shipped; PLC #7 (the device's only guard) is NOT in this snapshot */
const PLC8 = {
  id: 8,
  trustDigest: "a".repeat(64),
  approved: true,
  config: { id: 8, code: "PLC-8", vendor: "generic", backend: "modbus", endpoint: "tcp://plc8", statusMap: { ok: "40001" }, robotId: null, stationId: 3, lineId: null, factoryId: null, enabled: true },
};
function config(): EdgeConfigSnapshot {
  const tag = (id: number, tagKey: string, address: string, dataType: "int" | "bool", stopValue: unknown = null) => ({
    id, tagKey, address, dataType, scale: null, offset: null, writable: true, isEnabled: true, stopValue, updatedAt: T0,
  });
  return {
    kind: "config_snapshot", protocolVersion: 2, configVersion: 3, issuedAt: T0 - 90_000,
    node: { id: NODE, code: "EDGE-A", credentialId: CRED, factoryCode: "F1", lineCodes: ["L1"] },
    adapters: [
      {
        id: 5, code: "PLC-5", machineId: 50, protocol: "stub", endpoint: "stub://5", connectionOptions: null, pollIntervalMs: 1000, isEnabled: true,
        connectionFingerprint: "f".repeat(64), ownerEpoch: 2, updatedAt: T0,
        tags: [tag(1, "speed", "40001", "int"), tag(2, "run", "00001", "bool", false)],
      },
    ],
    robots: [
      {
        id: 12, code: "R12", name: "r12", vendor: "sim", model: null, kind: "arm", endpoint: "sim://12", connectionOptions: null, pollIntervalMs: 1000,
        isEnabled: true, commissioned: true, lineId: 1, stationId: 3, motionLock: null, motionLockGenerationFloor: 0, ownerEpoch: 3, updatedAt: T0,
      },
    ],
    machines: [],
    safetyPlcConfigs: [PLC8],
    keyset: signEdgeObject("keyset", { v: 1, version: 1, issuedAt: T0, keys: [] }, key) as never,
    limits: { authTtlMs: 10_000, maxClockSkewMs: 5_000, journalMaxBytes: 1_000_000, programReportMs: 30_000, programReportMaxAgeMs: 60_000, heartbeatMs: 5_000, pullMs: 2_000 },
  } as EdgeConfigSnapshot;
}

const SPEED = { adapterId: 5, machineId: 50, commandType: "set_speed", writes: [{ tagKey: "speed", value: 10 }] };
const MOVE: RobotJobSpec = { jobType: "move", params: { x: 1 } };
const otRun = { runId: 9, claimSeq: 2, stepId: "w1", attempt: 1 };
const robotRun = { runId: 9, claimSeq: 2, stepId: "m1", attempt: 1 };

function otAuth(safetyConfigIds: number[]): EdgeStepAuthorization {
  const claims = {
    typ: EDGE_TYP_NAME.auth, kid: key.kid, jti: JTI, nodeId: NODE, credentialId: CRED, runId: 9, claimSeq: 2, stepId: "w1", attempt: 1,
    idempotencyKey: "foe:9:w1:1", kind: "ot", target: { adapterId: 5, writes: [{ tagKey: "speed", address: "40001", dataType: "int", scale: null, offset: null }] },
    payloadHash: edgeCommandPayloadHash({ kind: "ot", ...SPEED }), approval: { approvedBy: 4, gateStepId: "g" }, mode: "real",
    verdicts: { commissioned: true, policy: "allow", interlock: "pass" }, safetyConfigIds, reqNonce: NONCE, iat: T0, ttlMs: 10_000,
  };
  return { envelope: signEdgeObject("auth", claims, key), runId: 9, claimSeq: 2, stepId: "w1", attempt: 1, idempotencyKey: "foe:9:w1:1", reqNonce: NONCE };
}
function robotAuth(safetyConfigIds: number[]): EdgeStepAuthorization {
  const claims = {
    typ: EDGE_TYP_NAME.auth, kid: key.kid, jti: JTI, nodeId: NODE, credentialId: CRED, runId: 9, claimSeq: 2, stepId: "m1", attempt: 1,
    idempotencyKey: "foe:9:m1:1", kind: "robot", target: { robotId: 12, jobType: "move" },
    payloadHash: edgeCommandPayloadHash({ kind: "robot", robotId: 12, jobType: "move", params: { x: 1 } }), approval: { approvedBy: 4, gateStepId: "g" },
    mode: "real", verdicts: { commissioned: true, policy: "allow", interlock: "pass" }, safetyConfigIds, reqNonce: NONCE, iat: T0, ttlMs: 10_000,
  };
  return { envelope: signEdgeObject("auth", claims, key), runId: 9, claimSeq: 2, stepId: "m1", attempt: 1, idempotencyKey: "foe:9:m1:1", reqNonce: NONCE };
}

type Journal = EdgeDispatchJournal & { consumed: string[]; runs: any[]; events: any[] };
function journal(): Journal {
  const j: Journal = {
    consumed: [], runs: [], events: [],
    async consumeAuthorization(c) {
      if (j.consumed.includes(c.jti)) return { ok: false, reason: "jti_consumed" };
      j.consumed.push(c.jti);
      return { ok: true };
    },
    isJtiConsumed: (jti) => j.consumed.includes(jti),
    admitNonStop: () => true,
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
let refreshAsks = 0;
function runtime(j: Journal, over: Partial<EdgeDeviceRuntime> = {}): EdgeDeviceRuntime {
  return {
    nodeId: NODE,
    config: () => config(),
    journal: j,
    auth: () => ({
      trust: EdgeTrustStore.fromPinned(pin, { nodeId: NODE, skewMs: 5_000 }),
      credentialId: CRED,
      maxTtlMs: 10_000,
      pendingNonce: (n: string) => (n === NONCE ? { sentMonoMs: sentAt } : null),
      nowMonoMs: () => mono,
    }),
    otControlEnabled: () => true,
    robotControlEnabled: () => true,
    requestConfigRefresh: () => void refreshAsks++,
    ...over,
  };
}
const STALE: EdgeConfigStaleness = { centralVersion: 4, localVersion: 3, sinceMs: T0 - 42_000, configIssuedAt: T0 - 90_000 };
const flush = () => new Promise((r) => setTimeout(r, 0));
const anomalies = (j: Journal) => j.events.filter((e) => e.kind === "anomaly").map((e) => e.code);

let jobs: Array<Record<string, unknown>>;
beforeEach(() => {
  _resetAdapterCommandQueuesForTests();
  mono = 1_500;
  refreshAsks = 0;
  H.fingerprint = "f".repeat(64);
  H.safetyReads = 0;
  H.dbCalls = 0;
  const writes: Array<Array<Record<string, unknown>>> = [];
  H.driver = {
    writes,
    writeTags: async (w) => {
      writes.push(w.map((x) => ({ ...x })));
      return w.map((x) => ({ tagKey: x.tagKey, ok: true }));
    },
    readTags: async () => [],
  };
  jobs = [];
  const lock = new MotionLock();
  H.robot = {
    id: 12, code: "R12", vendor: "sim",
    driver: {
      vendor: "sim",
      isConnected: () => true,
      getMotionLock: () => lock.snapshot(),
      lockMotion: (r: string, d?: string) => lock.lock(r, d),
      runJob: async (job: Record<string, unknown>) => {
        jobs.push(job);
        return { ok: true, status: "done" };
      },
      abort: async () => {
        jobs.push({ jobType: "abort", params: {} });
      },
    },
  };
  delete process.env.OT_CMD_SERIALIZE_ENABLED;
  delete process.env.OT_READBACK_ENABLED;
  delete process.env.OT_SAFETY_PREFLIGHT_ENABLED;
  delete process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED;
  process.env.ROBOT_CONTROL_TIMEOUT_MS = "1000";
});

describe("A2(o) O1 — the device's ONLY guard (PLC #7) is missing from the edge's snapshot, another PLC (#8) reads clean ⇒ REFUSED", () => {
  it("★ O1 OT: signed [7], snapshot [8], preflight would say OK ⇒ SAFETY_CONFIG_MISSING; 0 writes, jti NOT consumed, preflight not even read, anomaly + refresh asked", async () => {
    const j = journal();
    const r = await dispatchOtOnEdge({ ...SPEED, idempotencyKey: "foe:9:w1:1", authorization: otAuth([7]), run: otRun }, runtime(j));
    await flush();
    expect(r).toMatchObject({ ok: false, status: "rejected", reason: "SAFETY_CONFIG_MISSING" });
    expect(r.detail).toContain("#7");
    expect(H.driver!.writes).toHaveLength(0);
    expect(j.consumed).toHaveLength(0);
    expect(H.safetyReads).toBe(0);
    expect(anomalies(j)).toEqual(["EDGE_SAFETY_CONFIG_MISSING"]);
    expect(j.events[0].detail).toContain("adapter 5");
    expect(j.events[0].detail).toContain("v3");
    expect(refreshAsks).toBe(1);
    expect(H.dbCalls).toBe(0);
  });

  it("★ O1 robot: signed [7], snapshot [8] ⇒ SAFETY_CONFIG_MISSING; no runJob, no consume, no motion slot claimed", async () => {
    const j = journal();
    const r = await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: robotAuth([7]), run: robotRun }, runtime(j));
    await flush();
    expect(r).toMatchObject({ ok: false, status: "rejected", reason: "SAFETY_CONFIG_MISSING" });
    expect(jobs).toHaveLength(0);
    expect(j.consumed).toHaveLength(0);
    expect(robotMotionInFlight(12)).toBeNull();
    expect(anomalies(j)).toEqual(["EDGE_SAFETY_CONFIG_MISSING"]);
    expect(refreshAsks).toBe(1);
  });

  it("control: signed [8] (in the snapshot) or [] ⇒ the write / motion goes (the gate is the only cause above)", async () => {
    for (const ids of [[8], []]) {
      _resetAdapterCommandQueuesForTests();
      const j = journal();
      const r = await dispatchOtOnEdge({ ...SPEED, idempotencyKey: "foe:9:w1:1", authorization: otAuth(ids), run: otRun }, runtime(j));
      expect(r, JSON.stringify(ids)).toMatchObject({ ok: true, status: "acked" });
      const jr = journal();
      const rr = await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: robotAuth(ids), run: robotRun }, runtime(jr));
      expect(rr, JSON.stringify(ids)).toMatchObject({ ok: true, status: "done" });
    }
    expect(H.driver!.writes).toHaveLength(2);
    expect(jobs).toHaveLength(2);
    expect(refreshAsks).toBe(0);
  });
});

describe("A2(o) O7 — central announced a newer config the edge has not adopted ⇒ every non-STOP refused until refreshed", () => {
  it("★ O7: stale ⇒ OT and robot refused CONFIG_STALE naming both versions and the ages; nothing sent / consumed; anomaly + refresh asked", async () => {
    const j = journal();
    const rt = runtime(j, { configStale: () => STALE });
    const r = await dispatchOtOnEdge({ ...SPEED, idempotencyKey: "foe:9:w1:1", authorization: otAuth([8]), run: otRun }, rt);
    const rr = await dispatchRobotOnEdge({ robotId: 12, job: MOVE, idempotencyKey: "foe:9:m1:1", authorization: robotAuth([8]), run: robotRun }, rt);
    await flush();
    for (const x of [r, rr]) {
      expect(x).toMatchObject({ ok: false, status: "rejected", reason: "CONFIG_STALE" });
      expect(x.detail).toMatch(/v4 4[0-9] s ago/);
      expect(x.detail).toMatch(/v3 \(issued (8|9)[0-9] s ago\)/);
    }
    expect(H.driver!.writes).toHaveLength(0);
    expect(jobs).toHaveLength(0);
    expect(j.consumed).toHaveLength(0);
    expect(anomalies(j)).toEqual(["EDGE_CONFIG_STALE", "EDGE_CONFIG_STALE"]);
    expect(refreshAsks).toBe(2);
  });

  it("★ O7: refreshed (staleness null) ⇒ the same write goes", async () => {
    let stale: EdgeConfigStaleness | null = STALE;
    const j = journal();
    const rt = runtime(j, { configStale: () => stale });
    expect((await dispatchOtOnEdge({ ...SPEED, idempotencyKey: "foe:9:w1:1", authorization: otAuth([8]), run: otRun }, rt)).reason).toBe("CONFIG_STALE");
    stale = null;
    expect(await dispatchOtOnEdge({ ...SPEED, idempotencyKey: "foe:9:w1:1", authorization: otAuth([8]), run: otRun }, rt)).toMatchObject({ ok: true, status: "acked" });
    expect(H.driver!.writes).toHaveLength(1);
  });

  it("★ O7: a staleness that cannot be READ ⇒ refused (fail-closed), never treated as fresh", async () => {
    const j = journal();
    const r = await dispatchOtOnEdge(
      { ...SPEED, idempotencyKey: "foe:9:w1:1", authorization: otAuth([]), run: otRun },
      runtime(j, {
        configStale: () => {
          throw new Error("state unreadable");
        },
      }),
    );
    expect(r).toMatchObject({ ok: false, reason: "CONFIG_STALE" });
    expect(H.driver!.writes).toHaveLength(0);
  });
});

describe("A2(o) O5 — a pinned STOP is never blocked by the config gate (L-7)", () => {
  it("★ O5 edge OT: a pinned STOP with the PLC missing AND the config stale ⇒ SENT, no config anomaly, no refresh asked", async () => {
    const j = journal();
    const rt = runtime(j, { configStale: () => STALE });
    const r = await dispatchOtOnEdge({ adapterId: 5, machineId: 50, commandType: "stop", writes: [{ tagKey: "run", value: false }], idempotencyKey: "stop-1", source: "local" }, rt);
    await flush();
    expect(r).toMatchObject({ ok: true, stop: true, pinnedStop: true });
    expect(H.driver!.writes).toEqual([[expect.objectContaining({ tagKey: "run", value: false })]]);
    expect(anomalies(j)).toEqual([]);
    expect(refreshAsks).toBe(0);
  });

  it("★ O5 edge robot: the abort with the config stale ⇒ SENT (straight to the driver)", async () => {
    const j = journal();
    const r = await dispatchRobotOnEdge({ robotId: 12, job: { jobType: "abort" }, idempotencyKey: "stop-r", source: "local" }, runtime(j, { configStale: () => STALE }));
    await flush();
    expect(r).toMatchObject({ ok: true, stop: true });
    expect(jobs.map((x) => x.jobType)).toEqual(["abort"]);
    expect(anomalies(j)).toEqual([]);
  });
});

describe("A2(o) O6 — ONE helper on BOTH front ends (source scan)", () => {
  const src = (rel: string) => readFileSync(path.join(__dirname, rel), "utf8");
  for (const [rel, before] of [
    ["../ot/otEdgeDispatch.ts", "const driver = getActiveDriver(input.adapterId);"],
    ["../robot/robotEdgeDispatch.ts", "const robot = getActiveRobot(input.robotId);"],
  ] as const) {
    it(`${rel}: imports edgeNonStopConfigGate from edgeDeviceRuntime, calls it ONCE with the signed ids, after the context check and before the driver / preflight / consume`, () => {
      const s = src(rel);
      expect(s).toMatch(/import \{[^}]*\bedgeNonStopConfigGate\b[^}]*\} from "\.\.\/edge\/edgeDeviceRuntime";/);
      const calls = [...s.matchAll(/edgeNonStopConfigGate\(rt, cfg, verdict\.claims\.safetyConfigIds,/g)];
      expect(calls).toHaveLength(1);
      const at = calls[0].index!;
      const ctxCheck = s.indexOf(`detail: "context_mismatch"`);
      expect(ctxCheck).toBeGreaterThan(0);
      expect(at).toBeGreaterThan(ctxCheck);
      // the NON-STOP path's driver lookup / preflight / consume all come after the gate
      for (const later of [before, "getSafetyStatus(", "consumeAuthorization("]) {
        const i = s.indexOf(later, ctxCheck);
        expect(i, later).toBeGreaterThan(at);
      }
      // the STOP branch returns before it (L-7)
      expect(at).toBeGreaterThan(s.lastIndexOf("return res;", at));
      // no second, local copy of the rule
      expect(s.match(/safetyConfigIds/g)).toHaveLength(1);
    });
  }
});
