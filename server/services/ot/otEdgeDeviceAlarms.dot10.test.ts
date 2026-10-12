/**
 * doc 81 Đợt 10 task D fix review 1 — ruling R-10-x: on the EDGE the device stage's alarms never reach a database. With the REAL
 * connection module under AVI_PROCESS_ROLE=edge + EDGE_DB_TRAP=throw, the B3 path that alarms runs end to end through the edge
 * front end:
 *   a non-STOP write (authorised) times out ⇒ its queue slot is held; the session reset fails ⇒ `ot_write_overlap_risk`;
 *   a pinned STOP follows ⇒ its read-only watch reads the STOP tag back as NOT the stop value ⇒ `ot_stop_unverified` (critical).
 * Both arrive as `anomaly` events through the injected journal (E's report sink), and the edge DB trap counts 0 hits.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

const H = vi.hoisted(() => ({ writes: [] as Array<Array<Record<string, unknown>>>, runValue: true as unknown }));
vi.mock("./otManager", () => {
  const driver = {
    isConnected: () => true,
    writeTags: async (w: Array<Record<string, unknown>>) => {
      H.writes.push(w.map((x) => ({ ...x })));
      if (w.some((x) => x.tagKey === "speed")) return new Promise(() => undefined); // the write never answers ⇒ timeout
      return w.map((x) => ({ tagKey: x.tagKey, ok: true }));
    },
    readTags: async (tags: Array<{ tagKey: string }>) => tags.map((t) => ({ tagKey: t.tagKey, value: H.runValue, quality: "good", timestamp: new Date() })),
    disconnect: async () => undefined,
  };
  return {
    getActiveDriver: () => driver,
    getActiveConnectionFingerprint: () => "f".repeat(64),
    listActiveAdapters: () => [],
    adapterSessionResetBoundMs: () => 100,
    resetAdapterSession: async () => ({ reset: false, error: "reset refused (test)" }),
  };
});

import { EDGE_TYP_NAME, EdgeTrustStore, edgePinnedKeyset, generateEdgeSigningKey, signEdgeObject } from "../edge/edgeSigning";
import { edgeCommandPayloadHash } from "../edge/edgeAuthorizationVerifier";
import type { EdgeDeviceRuntime, EdgeDispatchJournal } from "../edge/edgeDeviceRuntime";
import type { EdgeConfigSnapshot } from "../edge/edgeProtocol";
import { dispatchOtOnEdge } from "./otEdgeDispatch";
import { _resetAdapterCommandQueuesForTests } from "./otDeviceWrite";
import { edgeDbTrapCount } from "../../db/connection";

const T0 = Date.now();
const NODE = 7;
const CRED = 31;
const NONCE = "n0nce_AAAAAAAAAAAAAAAAAA";
const key = generateEdgeSigningKey().key;
const pin = edgePinnedKeyset([{ kid: key.kid, publicKeyPem: key.publicKeyPem, notBefore: T0 - 60_000 }], T0);
const saved: Record<string, string | undefined> = {};
const KEYS = ["AVI_PROCESS_ROLE", "EDGE_DB_TRAP", "OT_CMD_SERIALIZE_ENABLED", "OT_CONTROL_TIMEOUT_MS", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_CONTROL_ENABLED"];

beforeAll(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.AVI_PROCESS_ROLE = "edge";
  process.env.EDGE_DB_TRAP = "throw";
  process.env.OT_CMD_SERIALIZE_ENABLED = "true";
  process.env.OT_CONTROL_TIMEOUT_MS = "200";
  process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false";
  process.env.OT_CONTROL_ENABLED = "true";
  _resetAdapterCommandQueuesForTests();
});
afterAll(() => {
  for (const k of KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
  _resetAdapterCommandQueuesForTests();
});

function config(): EdgeConfigSnapshot {
  const tag = (id: number, tagKey: string, address: string, dataType: "int" | "bool", stopValue: unknown = null) => ({ id, tagKey, address, dataType, scale: null, offset: null, writable: true, isEnabled: true, stopValue, updatedAt: T0 });
  return {
    kind: "config_snapshot", protocolVersion: 2, configVersion: 3, issuedAt: T0,
    node: { id: NODE, code: "EDGE-A", credentialId: CRED, factoryCode: "F1", lineCodes: ["L1"] },
    adapters: [{ id: 5, code: "PLC-5", machineId: 50, protocol: "stub", endpoint: "stub://5", connectionOptions: null, pollIntervalMs: 1000, isEnabled: true, connectionFingerprint: "f".repeat(64), ownerEpoch: 2, updatedAt: T0, tags: [tag(1, "speed", "40001", "int"), tag(2, "run", "00001", "bool", false)] }],
    robots: [], machines: [], safetyPlcConfigs: [],
    keyset: signEdgeObject("keyset", { v: 1, version: 1, issuedAt: T0, keys: [] }, key) as never,
    limits: { authTtlMs: 10_000, maxClockSkewMs: 5_000, journalMaxBytes: 1_000_000, programReportMs: 30_000, programReportMaxAgeMs: 60_000, heartbeatMs: 5_000, pullMs: 2_000 },
  } as EdgeConfigSnapshot;
}

describe("R-10-x — edge device-stage alarms go through the journal sink, never the DB", () => {
  it("★ overlap risk + unverified STOP ⇒ two anomaly events in the journal; the edge DB trap is hit 0 times (EDGE_DB_TRAP=throw)", async () => {
    const before = edgeDbTrapCount();
    const events: Array<Record<string, unknown>> = [];
    const journal: EdgeDispatchJournal = {
      consumeAuthorization: async () => ({ ok: true }),
      isJtiConsumed: () => false,
      admitNonStop: () => true,
      appendRun: async () => ({ seq: 1, durable: true }),
      appendEvent: async (rec) => (events.push(rec as never), { seq: events.length, durable: true }),
    };
    const sentAt = performance.now();
    const rt: EdgeDeviceRuntime = {
      nodeId: NODE,
      config: () => config(),
      journal,
      auth: () => ({ trust: EdgeTrustStore.fromPinned(pin, { nodeId: NODE, now: () => T0, skewMs: 5_000 }), credentialId: CRED, maxTtlMs: 10_000, pendingNonce: (n) => (n === NONCE ? { sentMonoMs: sentAt } : null) }),
      otControlEnabled: () => true,
    };
    const cmd = { adapterId: 5, machineId: 50, commandType: "set_speed", writes: [{ tagKey: "speed", value: 10 }] };
    const claims = {
      typ: EDGE_TYP_NAME.auth, kid: key.kid, jti: "3b8f3c1e-5d7a-4c1b-9a2e-3f4d5c6b7a81", nodeId: NODE, credentialId: CRED, runId: 9, claimSeq: 2, stepId: "w1", attempt: 1,
      idempotencyKey: "foe:9:w1:1", kind: "ot", target: { adapterId: 5, writes: [{ tagKey: "speed", address: "40001", dataType: "int", scale: null, offset: null }] },
      payloadHash: edgeCommandPayloadHash({ kind: "ot", ...cmd }), approval: null, mode: "real", verdicts: { commissioned: true, policy: "allow", interlock: "pass" }, safetyConfigIds: [], reqNonce: NONCE, iat: T0, ttlMs: 10_000,
    };
    const authz = { envelope: signEdgeObject("auth", claims, key), runId: 9, claimSeq: 2, stepId: "w1", attempt: 1, idempotencyKey: "foe:9:w1:1", reqNonce: NONCE };
    const w = await dispatchOtOnEdge({ ...cmd, idempotencyKey: "foe:9:w1:1", authorization: authz, run: { runId: 9, claimSeq: 2, stepId: "w1", attempt: 1 } }, rt);
    expect(w).toMatchObject({ status: "timeout" });
    const stop = await dispatchOtOnEdge({ adapterId: 5, machineId: 50, commandType: "stop", writes: [{ tagKey: "run", value: false }], idempotencyKey: "abort:9:w1", source: "local" }, rt);
    expect(stop).toMatchObject({ ok: true, stop: true, pinnedStop: true });
    const t0 = Date.now();
    while (!events.some((e) => e.code === "ot_stop_unverified") && Date.now() - t0 < 5_000) await new Promise((r) => setTimeout(r, 50));
    const codes = events.filter((e) => e.kind === "anomaly").map((e) => e.code);
    expect(codes).toContain("ot_write_overlap_risk");
    expect(codes).toContain("ot_stop_unverified");
    expect(edgeDbTrapCount() - before).toBe(0);
  }, 15_000);
});
