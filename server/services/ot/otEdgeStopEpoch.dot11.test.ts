/**
 * doc 81 Đợt 11 K-fix (ruling R-11-d) — the EDGE front end: a non-STOP write still in its gates (here: held in the journal's
 * write-ahead CONSUME, the last gate before the device stage) when a pinned STOP for the same adapter arrives and completes is
 * cancelled right before its device write (STOPPED_BEFORE_WRITE, nothing written, ledger record says so). Flag OFF and ON.
 * Scaffolding (real Ed25519 signing, fake driver / journal / facade, DB trap) copied from otEdgeDispatch.dot10.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  driver: null as null | { writes: Array<Array<Record<string, unknown>>>; writeTags: (w: Array<Record<string, unknown>>) => Promise<unknown>; readTags: () => Promise<unknown[]> },
  fingerprint: "f".repeat(64) as string | undefined,
  safety: { state: "OK" } as { state: string; basis?: string },
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
vi.mock("./otManager", () => ({
  getActiveDriver: () => H.driver ?? undefined,
  getActiveConnectionFingerprint: () => H.fingerprint,
  listActiveAdapters: () => [],
  adapterSessionResetBoundMs: () => 1000,
  resetAdapterSession: async () => ({ reset: true, via: "test" }),
}));
vi.mock("./adapterFacade", () => ({
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
import { dispatchOtOnEdge } from "./otEdgeDispatch";
import { _resetAdapterCommandQueuesForTests } from "./otDeviceWrite";

const T0 = 1_790_000_000_000;
const NODE = 7;
const CRED = 31;
const NONCE = "n0nce_AAAAAAAAAAAAAAAAAA";
const JTI = "0b8f3c1e-5d7a-4c1b-9a2e-3f4d5c6b7a81";
const key = generateEdgeSigningKey().key;
const attacker = generateEdgeSigningKey().key;
const pin = edgePinnedKeyset([{ kid: key.kid, publicKeyPem: key.publicKeyPem, notBefore: T0 - 60_000 }], T0);

let mono = 1_500;
const sentAt = 1_000;
const trust = () => EdgeTrustStore.fromPinned(pin, { nodeId: NODE, now: () => T0, skewMs: 5_000 });

function config(): EdgeConfigSnapshot {
  const tag = (id: number, tagKey: string, address: string, dataType: "int" | "bool", stopValue: unknown = null, writable = true) => ({
    id, tagKey, address, dataType, scale: null, offset: null, writable, isEnabled: true, stopValue, updatedAt: T0,
  });
  return {
    kind: "config_snapshot", protocolVersion: 2, configVersion: 3, issuedAt: T0,
    node: { id: NODE, code: "EDGE-A", credentialId: CRED, factoryCode: "F1", lineCodes: ["L1"] },
    adapters: [
      {
        id: 5, code: "PLC-5", machineId: 50, protocol: "stub", endpoint: "stub://5", connectionOptions: null, pollIntervalMs: 1000, isEnabled: true,
        connectionFingerprint: "f".repeat(64), ownerEpoch: 2, updatedAt: T0,
        tags: [tag(1, "speed", "40001", "int"), tag(2, "run", "00001", "bool", false), tag(3, "ro", "30001", "int", null, false)],
      },
    ],
    robots: [], machines: [], safetyPlcConfigs: [],
    keyset: signEdgeObject("keyset", { v: 1, version: 1, issuedAt: T0, keys: [] }, key) as never,
    limits: { authTtlMs: 10_000, maxClockSkewMs: 5_000, journalMaxBytes: 1_000_000, programReportMs: 30_000, programReportMaxAgeMs: 60_000, heartbeatMs: 5_000, pullMs: 2_000 },
  } as EdgeConfigSnapshot;
}

const SPEED_CMD = { adapterId: 5, machineId: 50, commandType: "set_speed", writes: [{ tagKey: "speed", value: 10 }] };
const RESOLVED = [{ tagKey: "speed", address: "40001", dataType: "int" as const, scale: null, offset: null }];
function claims(over: Record<string, unknown> = {}, cmd = SPEED_CMD) {
  return {
    typ: EDGE_TYP_NAME.auth, kid: key.kid, jti: JTI, nodeId: NODE, credentialId: CRED, runId: 9, claimSeq: 2, stepId: "w1", attempt: 1,
    idempotencyKey: "foe:9:w1:1", kind: "ot", target: { adapterId: 5, writes: RESOLVED },
    payloadHash: edgeCommandPayloadHash({ kind: "ot", ...cmd }), approval: { approvedBy: 4, gateStepId: "g" }, mode: "real",
    verdicts: { commissioned: true, policy: "allow", interlock: "pass" }, safetyConfigIds: [], reqNonce: NONCE, iat: T0, ttlMs: 10_000, ...over,
  };
}
function auth(over: Record<string, unknown> = {}, signer = key): EdgeStepAuthorization {
  return { envelope: signEdgeObject("auth", claims(over), signer), runId: 9, claimSeq: 2, stepId: "w1", attempt: 1, idempotencyKey: "foe:9:w1:1", reqNonce: NONCE };
}

type Journal = EdgeDispatchJournal & { consumed: string[]; runs: unknown[]; events: unknown[]; order: string[]; full: boolean; consumeFails: boolean };
function journal(): Journal {
  const j: Journal = {
    consumed: [], runs: [], events: [], order: [], full: false, consumeFails: false,
    async consumeAuthorization(c) {
      j.order.push("consume");
      if (j.consumeFails) return { ok: false, reason: "io_error" };
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

const authCalls = { pending: 0 };
function runtime(j: Journal, over: Partial<EdgeDeviceRuntime> = {}): EdgeDeviceRuntime {
  return {
    nodeId: NODE,
    config: () => config(),
    journal: j,
    auth: () => ({
      trust: trust(),
      credentialId: CRED,
      maxTtlMs: 10_000,
      pendingNonce: (n: string) => {
        authCalls.pending++;
        return n === NONCE ? { sentMonoMs: sentAt } : null;
      },
      nowMonoMs: () => mono,
    }),
    otControlEnabled: () => true,
    robotControlEnabled: () => true,
    ...over,
  };
}

const run = { runId: 9, claimSeq: 2, stepId: "w1", attempt: 1 };
const STOP = { adapterId: 5, machineId: 50, commandType: "stop", writes: [{ tagKey: "run", value: false }], idempotencyKey: "abort:9:w1" };

beforeEach(() => {
  _resetAdapterCommandQueuesForTests();
  mono = 1_500;
  authCalls.pending = 0;
  H.fingerprint = "f".repeat(64);
  H.safety = { state: "OK" };
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
  delete process.env.OT_READBACK_ENABLED;
});

describe("Đợt 11 K-fix / K-fix 2 — edge: STOP epoch (bumped when a true STOP is sent), STOP by content, bounded lane", () => {
  for (const flag of [false, true]) {
    it(`[flag ${flag ? "ON" : "OFF"}] the write held in its consume gate while the STOP completes ⇒ STOPPED_BEFORE_WRITE, only the STOP on the wire`, async () => {
      if (flag) process.env.OT_CMD_SERIALIZE_ENABLED = "true";
      else delete process.env.OT_CMD_SERIALIZE_ENABLED;
      try {
        const j = journal();
        let entered!: () => void;
        let release!: () => void;
        const inGate = new Promise<void>((r) => (entered = r));
        const gate = new Promise<void>((r) => (release = r));
        const consume = j.consumeAuthorization.bind(j);
        j.consumeAuthorization = async (c) => {
          entered();
          await gate;
          return consume(c);
        };
        const rt = runtime(j);
        const pWrite = dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: auth(), run }, rt);
        await inGate;
        const rStop = await dispatchOtOnEdge({ ...STOP }, rt);
        expect(rStop).toMatchObject({ ok: true, stop: true, pinnedStop: true });
        release();
        const r = await pWrite;
        expect(r).toMatchObject({ ok: false, status: "rejected", reason: "STOPPED_BEFORE_WRITE", jti: JTI });
        expect(r.detail).toContain("abort:9:w1");
        expect(H.driver!.writes).toEqual([[{ tagKey: "run", address: "00001", value: false, dataType: "bool", scale: undefined, offset: undefined }]]);
        expect(j.runs).toMatchObject([{ kind: "ledger", jti: JTI, stop: false, status: "rejected", result: { reason: "STOPPED_BEFORE_WRITE" } }]);
        expect(H.dbCalls).toBe(0);
      } finally {
        delete process.env.OT_CMD_SERIALIZE_ENABLED;
      }
    });
  }

  for (const flag of [false, true]) {
    it(`[flag ${flag ? "ON" : "OFF"}] ★ K-fix 2 (R-11-i b, pre-auth-state-change): a STOP-labelled command REFUSED before authorisation moves nothing — the write in its gate is written`, async () => {
      if (flag) process.env.OT_CMD_SERIALIZE_ENABLED = "true";
      else delete process.env.OT_CMD_SERIALIZE_ENABLED;
      try {
        const j = journal();
        let entered!: () => void;
        let release!: () => void;
        const inGate = new Promise<void>((r) => (entered = r));
        const gate = new Promise<void>((r) => (release = r));
        const consume = j.consumeAuthorization.bind(j);
        j.consumeAuthorization = async (c) => {
          entered();
          await gate;
          return consume(c);
        };
        const rt = runtime(j);
        const pWrite = dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: auth(), run }, rt);
        await inGate;
        // an UNAUTHORISED "stop" with arbitrary writes (not the snapshot's pins) — refused before anything
        const rFake = await dispatchOtOnEdge({ adapterId: 5, machineId: 50, commandType: "stop", writes: [{ tagKey: "speed", value: 0 }], idempotencyKey: "x:1", authorization: null, run }, rt);
        expect(rFake).toMatchObject({ ok: false, reason: "AUTHORIZATION_REQUIRED" });
        release();
        const r = await pWrite;
        expect(r).toMatchObject({ ok: true, status: "acked" });
        expect(H.driver!.writes).toHaveLength(1);
      } finally {
        delete process.env.OT_CMD_SERIALIZE_ENABLED;
      }
    });
  }

  it("★ K-fix 2 (R-11-i a/b): an AUTHORISED stop-labelled command with ARBITRARY writes, executed while a write waits in its gate, does not move the epoch — the write is written", async () => {
    const j = journal();
    let entered!: () => void;
    let release!: () => void;
    const inGate = new Promise<void>((r) => (entered = r));
    const gate = new Promise<void>((r) => (release = r));
    const consume = j.consumeAuthorization.bind(j);
    let first = true;
    j.consumeAuthorization = async (c) => {
      if (first) {
        first = false;
        entered();
        await gate;
      }
      return consume(c);
    };
    const rt = runtime(j);
    const pWrite = dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: auth(), run }, rt);
    await inGate;
    const ARB = { adapterId: 5, machineId: 50, commandType: "stop", writes: [{ tagKey: "speed", value: 0 }] };
    const aArb: EdgeStepAuthorization = { envelope: signEdgeObject("auth", claims({ jti: "3b8f3c1e-5d7a-4c1b-9a2e-3f4d5c6b7a81" }, ARB), key), runId: 9, claimSeq: 2, stepId: "w1", attempt: 1, idempotencyKey: "foe:9:w1:1", reqNonce: NONCE };
    const rArb = await dispatchOtOnEdge({ ...ARB, idempotencyKey: "foe:9:w1:1", authorization: aArb, run }, rt);
    expect(rArb).toMatchObject({ ok: true, status: "acked" });
    release();
    expect(await pWrite).toMatchObject({ ok: true, status: "acked" });
    expect(H.driver!.writes.map((w) => w[0].value)).toEqual([0, 10]);
  });

  it("★ K-fix 2 (R-11-i a): an authorised stop-LABELLED command with ARBITRARY writes is ordinary — BUSY on a full queue; a content stop (authorised 'set' of the pinned value) is not", async () => {
    process.env.OT_CMD_SERIALIZE_ENABLED = "true";
    process.env.OT_CMD_QUEUE_MAX = "1";
    try {
      let releaseA!: () => void;
      const held = new Promise<string>((r) => (releaseA = () => r("held")));
      const { tryEnqueueAdapterCommand } = await import("./otDeviceWrite");
      expect(tryEnqueueAdapterCommand(5, () => held).accepted).toBe(true); // the queue is FULL (depth 1 = max)
      const ARB = { adapterId: 5, machineId: 50, commandType: "stop", writes: [{ tagKey: "speed", value: 0 }] }; // speed has no pin
      const aArb: EdgeStepAuthorization = { envelope: signEdgeObject("auth", claims({}, ARB), key), runId: 9, claimSeq: 2, stepId: "w1", attempt: 1, idempotencyKey: "foe:9:w1:1", reqNonce: NONCE };
      const rArb = await dispatchOtOnEdge({ ...ARB, idempotencyKey: "foe:9:w1:1", authorization: aArb, run }, runtime(journal()));
      expect(rArb).toMatchObject({ ok: false, reason: "BUSY" });
      const CONTENT = { adapterId: 5, machineId: 50, commandType: "set_run", writes: [{ tagKey: "run", value: false }] }; // the pinned value
      const target = { adapterId: 5, writes: [{ tagKey: "run", address: "00001", dataType: "bool", scale: null, offset: null }] };
      const aC: EdgeStepAuthorization = { envelope: signEdgeObject("auth", claims({ target, jti: "2b8f3c1e-5d7a-4c1b-9a2e-3f4d5c6b7a81" }, CONTENT as unknown as typeof SPEED_CMD), key), runId: 9, claimSeq: 2, stepId: "w1", attempt: 1, idempotencyKey: "foe:9:w1:1", reqNonce: NONCE };
      const pC = dispatchOtOnEdge({ ...CONTENT, idempotencyKey: "foe:9:w1:1", authorization: aC, run }, runtime(journal()));
      await new Promise((r) => setTimeout(r, 30));
      expect(H.driver!.writes).toHaveLength(0); // waits for the in-flight command, not refused
      releaseA();
      const rC = await pC;
      expect(rC.reason).not.toBe("BUSY");
      expect(rC).toMatchObject({ ok: true, status: "acked" });
      expect(H.driver!.writes).toEqual([[{ tagKey: "run", address: "00001", value: false, dataType: "bool", scale: undefined, offset: undefined }]]);
    } finally {
      delete process.env.OT_CMD_SERIALIZE_ENABLED;
      delete process.env.OT_CMD_QUEUE_MAX;
    }
  });

  it("★ K-fix 2 (R-11-i c): a pinned-STOP flood on the edge ⇒ one waiting group, ONE device write, every STOP answered and journaled", async () => {
    process.env.OT_CMD_SERIALIZE_ENABLED = "true";
    try {
      let releaseA!: () => void;
      const held = new Promise<string>((r) => (releaseA = () => r("held")));
      const { tryEnqueueAdapterCommand, _adapterCommandQueueDepthForTests, _stopLaneWaitingMembersForTests } = await import("./otDeviceWrite");
      tryEnqueueAdapterCommand(5, () => held);
      const j = journal();
      const rt = runtime(j);
      const ps = Array.from({ length: 12 }, (_, i) => dispatchOtOnEdge({ ...STOP, idempotencyKey: `abort:${i}` }, rt));
      for (let t = 0; t < 200 && _stopLaneWaitingMembersForTests(5) < 12; t++) await new Promise((r) => setTimeout(r, 5));
      expect(_stopLaneWaitingMembersForTests(5)).toBe(12);
      expect(_adapterCommandQueueDepthForTests(5)).toBe(2);
      releaseA();
      const rs = await Promise.all(ps);
      expect(rs.every((r) => r.ok && r.stop && r.pinnedStop)).toBe(true);
      expect(H.driver!.writes).toHaveLength(1);
      expect(j.events.filter((e) => (e as { kind?: string }).kind === "stop")).toHaveLength(12);
    } finally {
      delete process.env.OT_CMD_SERIALIZE_ENABLED;
    }
  });

  it("control: a write whose gates begin AFTER the STOP is written", async () => {
    const j = journal();
    const rt = runtime(j);
    expect((await dispatchOtOnEdge({ ...STOP }, rt)).ok).toBe(true);
    const r = await dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: auth(), run }, rt);
    expect(r).toMatchObject({ ok: true, status: "acked" });
    expect(H.driver!.writes).toHaveLength(2);
  });
});
