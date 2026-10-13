/**
 * doc 81 Đợt 10 task D (design §2.9, §2.13, §2.14) — the EDGE front end of an OT write (otEdgeDispatch.ts), with NO database:
 *   verify the signed per-step authorisation (edgeAuthorizationVerifier → A's edgeTrust) → local gates (owned adapter + tags from
 *   the signed snapshot, driver, journal admission, safety preflight from the snapshot configs) → journal consume (write-ahead of
 *   single use, BEFORE the send) → device stage (otDeviceWrite) → journal report.
 *   A PINNED OT STOP (pins + connection fingerprint from the signed snapshot) is sent at once and NEVER asks: no authorisation, no
 *   verifier call, no consume — even with no keyset, a full journal, or the safety PLC blocked (L-7).
 * Real signing (Ed25519, A's EdgeTrustStore), fake driver / journal / facade; the DB module is a trap that fails the test if used.
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
  delete process.env.OT_CMD_SERIALIZE_ENABLED;
  delete process.env.OT_READBACK_ENABLED;
});

const run = { runId: 9, claimSeq: 2, stepId: "w1", attempt: 1 };

describe("otEdgeDispatch — a non-STOP write needs a valid, fresh, single-use authorisation", () => {
  it("control: a valid authorisation ⇒ consume (write-ahead) BEFORE the write, the exact bytes go out once, ledger quotes the jti; no DB", async () => {
    const j = journal();
    const order: string[] = j.order;
    const w = H.driver!.writeTags;
    H.driver!.writeTags = async (x) => {
      order.push("write");
      return w(x);
    };
    const r = await dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: auth(), run }, runtime(j));
    expect(r).toMatchObject({ ok: true, status: "acked", stop: false, jti: JTI });
    expect(H.driver!.writes).toEqual([[{ tagKey: "speed", address: "40001", value: 10, dataType: "int", scale: undefined, offset: undefined }]]);
    expect(order).toEqual(["consume", "write"]);
    expect(j.runs).toMatchObject([{ runId: 9, claimSeq: 2, kind: "ledger", stepId: "w1", jti: JTI, stop: false, ownerEpoch: 2, status: "acked", target: { adapterId: 5, commandType: "set_speed" } }]);
    expect(H.dbCalls).toBe(0);
  });

  it("★ no authorisation ⇒ refused before anything; nothing consumed, nothing written", async () => {
    const j = journal();
    const r = await dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: null, run }, runtime(j));
    expect(r).toMatchObject({ ok: false, status: "rejected", reason: "AUTHORIZATION_REQUIRED" });
    expect(H.driver!.writes).toHaveLength(0);
    expect(j.consumed).toHaveLength(0);
  });

  it("★ payload-hash mismatch (the value about to be sent ≠ the one authorised) ⇒ refused payload_mismatch; 0 writes, 0 consume, anomaly journaled", async () => {
    const j = journal();
    const r = await dispatchOtOnEdge({ ...SPEED_CMD, writes: [{ tagKey: "speed", value: 11 }], idempotencyKey: "foe:9:w1:1", authorization: auth(), run }, runtime(j));
    expect(r).toMatchObject({ ok: false, status: "rejected", reason: "AUTHORIZATION_INVALID", detail: "payload_mismatch" });
    expect(H.driver!.writes).toHaveLength(0);
    expect(j.consumed).toHaveLength(0);
    expect(j.events).toMatchObject([{ kind: "anomaly", code: "EDGE_AUTHORIZATION_REFUSED", runId: 9 }]);
  });

  it("★ the authorised TARGET must be the snapshot's resolved write (address / dataType) — another address ⇒ refused target_mismatch", async () => {
    const j = journal();
    const other = auth({ target: { adapterId: 5, writes: [{ ...RESOLVED[0], address: "40002" }] } });
    const r = await dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: other, run }, runtime(j));
    expect(r).toMatchObject({ reason: "AUTHORIZATION_INVALID", detail: "target_mismatch" });
    expect(H.driver!.writes).toHaveLength(0);
  });

  it("★ EXPIRED (TTL measured from the request SEND on the monotonic clock) ⇒ refused; 0 writes", async () => {
    const j = journal();
    mono = sentAt + 10_000;
    const r = await dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: auth(), run }, runtime(j));
    expect(r).toMatchObject({ ok: false, reason: "AUTHORIZATION_INVALID", detail: "expired" });
    expect(H.driver!.writes).toHaveLength(0);
    expect(j.consumed).toHaveLength(0);
  });

  it("★ REPLAYED: the same authorisation a second time ⇒ refused jti_consumed; exactly ONE write in total", async () => {
    const j = journal();
    const a = auth();
    expect((await dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: a, run }, runtime(j))).ok).toBe(true);
    const again = await dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: a, run }, runtime(j));
    expect(again).toMatchObject({ ok: false, reason: "AUTHORIZATION_INVALID", detail: "jti_consumed" });
    expect(H.driver!.writes).toHaveLength(1);
  });

  it("★ REPLAYED after a restart (the nonce is no longer pending in this process) ⇒ refused nonce_not_pending", async () => {
    const j = journal();
    const rt = runtime(j);
    const r = await dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: auth({ reqNonce: "another_nonce_AAAAAAAAAA" }), run: run }, {
      ...rt,
    });
    // the context names the pending NONCE but the claim another ⇒ the binding fails before the nonce lookup
    expect(r).toMatchObject({ ok: false, reason: "AUTHORIZATION_INVALID" });
    const restarted = runtime(j, { auth: () => ({ ...rt.auth()!, pendingNonce: () => null }) });
    const r2 = await dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: auth(), run }, restarted);
    expect(r2).toMatchObject({ ok: false, reason: "AUTHORIZATION_INVALID", detail: "nonce_not_pending" });
    expect(H.driver!.writes).toHaveLength(0);
  });

  it("★ forged: signed by a key the edge does not trust ⇒ refused; 0 writes", async () => {
    const j = journal();
    const forged = { ...auth(), envelope: signEdgeObject("auth", { ...claims(), kid: attacker.kid }, attacker) };
    const r = await dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: forged, run }, runtime(j));
    expect(r).toMatchObject({ ok: false, reason: "AUTHORIZATION_INVALID" });
    expect(H.driver!.writes).toHaveLength(0);
  });

  it("keyset / config unknown ⇒ a non-STOP is refused (fail-closed); unowned adapter ⇒ NOT_OWNED; read-only tag ⇒ TAG_NOT_WRITABLE", async () => {
    const j = journal();
    expect(await dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: auth(), run }, runtime(j, { auth: () => null }))).toMatchObject({ reason: "KEYSET_UNKNOWN" });
    expect(await dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: auth(), run }, runtime(j, { config: () => null }))).toMatchObject({ reason: "CONFIG_UNKNOWN" });
    expect(await dispatchOtOnEdge({ ...SPEED_CMD, adapterId: 6, idempotencyKey: "foe:9:w1:1", authorization: auth(), run }, runtime(j))).toMatchObject({ reason: "NOT_OWNED" });
    expect(await dispatchOtOnEdge({ ...SPEED_CMD, writes: [{ tagKey: "ro", value: 1 }], idempotencyKey: "foe:9:w1:1", authorization: auth(), run }, runtime(j))).toMatchObject({ reason: "TAG_NOT_WRITABLE" });
    expect(H.driver!.writes).toHaveLength(0);
    expect(j.consumed).toHaveLength(0);
  });

  it("local gates refuse BEFORE the consume: safety preflight not OK, journal full, no driver", async () => {
    const j = journal();
    H.safety = { state: "BLOCKED" };
    expect(await dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: auth(), run }, runtime(j))).toMatchObject({ reason: "SAFETY_BLOCKED" });
    H.safety = { state: "OK" };
    j.full = true;
    expect(await dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: auth(), run }, runtime(j))).toMatchObject({ reason: "JOURNAL_FULL" });
    j.full = false;
    const d = H.driver;
    H.driver = null;
    expect(await dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: auth(), run }, runtime(j))).toMatchObject({ reason: "ADAPTER_OFFLINE" });
    H.driver = d;
    expect(j.consumed).toHaveLength(0);
    expect(H.driver!.writes).toHaveLength(0);
  });

  it("the consume fails (journal IO) ⇒ nothing is sent", async () => {
    const j = journal();
    j.consumeFails = true;
    const r = await dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: auth(), run }, runtime(j));
    expect(r).toMatchObject({ ok: false, reason: "JOURNAL_CONSUME_FAILED" });
    expect(H.driver!.writes).toHaveLength(0);
  });

  it("central's kill switch (claims.mode simulated) or the local OT_CONTROL off ⇒ simulated, nothing written", async () => {
    const j = journal();
    expect(await dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: auth({ mode: "simulated" }), run }, runtime(j))).toMatchObject({ ok: true, status: "simulated" });
    expect(await dispatchOtOnEdge({ ...SPEED_CMD, idempotencyKey: "foe:9:w1:1", authorization: auth({ jti: "1b8f3c1e-5d7a-4c1b-9a2e-3f4d5c6b7a81" }), run }, runtime(j, { otControlEnabled: () => false }))).toMatchObject({ status: "simulated" });
    expect(H.driver!.writes).toHaveLength(0);
  });
});

describe("otEdgeDispatch — ★ a PINNED OT STOP never asks (L-7)", () => {
  const STOP = { adapterId: 5, machineId: 50, commandType: "stop", writes: [{ tagKey: "run", value: false }], idempotencyKey: "abort:9:w1" };

  it("★ sent at once with the pinned value: no authorisation, no verifier / nonce lookup, no consume — even with NO keyset, a FULL journal and the safety PLC BLOCKED", async () => {
    const j = journal();
    j.full = true;
    H.safety = { state: "BLOCKED" };
    const rt = runtime(j, { auth: () => {
      throw new Error("the verifier must never be consulted for a STOP");
    } });
    const r = await dispatchOtOnEdge({ ...STOP, run }, rt);
    expect(r).toMatchObject({ ok: true, stop: true, pinnedStop: true, status: "acked" });
    expect(H.driver!.writes).toEqual([[{ tagKey: "run", address: "00001", value: false, dataType: "bool", scale: undefined, offset: undefined }]]);
    expect(authCalls.pending).toBe(0);
    expect(j.order).toEqual([]);
    expect(H.safetyReads).toBe(0);
    expect(j.runs).toMatchObject([{ kind: "ledger", stepId: "w1", jti: null, stop: true, ownerEpoch: 2 /* R-10-bn */, status: "acked" }]);
  });

  it("a console STOP (central command, no run) is journaled on the events stream", async () => {
    const j = journal();
    const r = await dispatchOtOnEdge({ ...STOP, source: "command", requestId: 44 }, runtime(j));
    expect(r).toMatchObject({ ok: true, stop: true });
    expect(j.events).toMatchObject([{ kind: "stop", target: { adapterId: 5 }, source: "command", requestId: 44, outcome: "sent" }]);
  });

  it("★ the caller's value is canonicalised to the PIN (1 ⇒ false is a value mismatch ⇒ NOT a stop ⇒ needs an authorisation)", async () => {
    const j = journal();
    const r = await dispatchOtOnEdge({ ...STOP, writes: [{ tagKey: "run", value: true }], run }, runtime(j));
    expect(r).toMatchObject({ ok: false, stop: false, reason: "AUTHORIZATION_REQUIRED", detail: "stop_not_pinned:value_mismatch" });
    expect(H.driver!.writes).toHaveLength(0);
    // M-1 (fix review 1) — never silent: journaled
    await new Promise((x) => setTimeout(x, 10));
    expect(j.events).toMatchObject([{ kind: "anomaly", code: "EDGE_STOP_NOT_PINNED", runId: 9 }]);
  });

  it("★ the running connection was made for another device (fingerprint ≠ the signed snapshot's) ⇒ not a verified STOP ⇒ refused without authorisation", async () => {
    const j = journal();
    H.fingerprint = "e".repeat(64);
    const r = await dispatchOtOnEdge({ ...STOP, run }, runtime(j));
    expect(r).toMatchObject({ ok: false, stop: false, reason: "AUTHORIZATION_REQUIRED", detail: "stop_not_pinned:adapter_connection_stale" });
    expect(H.driver!.writes).toHaveLength(0);
  });

  it("local OT_CONTROL off ⇒ the STOP is recorded simulated (dry-run, as central); no driver ⇒ failed, journaled", async () => {
    const j = journal();
    expect(await dispatchOtOnEdge({ ...STOP, run }, runtime(j, { otControlEnabled: () => false }))).toMatchObject({ status: "simulated", stop: true });
    H.driver = null;
    expect(await dispatchOtOnEdge({ ...STOP, run }, runtime(j))).toMatchObject({ ok: false, status: "failed", reason: "ADAPTER_OFFLINE", stop: true });
    expect(j.runs).toHaveLength(2);
  });

  it("M-1 — a central console STOP that is not a verified pinned stop ⇒ a FAILED `stop` record on the events stream (requestId kept)", async () => {
    const j = journal();
    H.fingerprint = "e".repeat(64);
    const r = await dispatchOtOnEdge({ ...STOP, source: "command", requestId: 45 }, runtime(j));
    expect(r).toMatchObject({ ok: false, stop: false });
    await new Promise((x) => setTimeout(x, 10));
    expect(j.events).toMatchObject([{ kind: "stop", target: { adapterId: 5 }, source: "command", requestId: 45, outcome: "failed" }]);
    expect(H.driver!.writes).toHaveLength(0);
  });
});
