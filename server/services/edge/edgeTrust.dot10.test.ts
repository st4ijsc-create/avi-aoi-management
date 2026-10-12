/**
 * doc 81 Đợt 10 task A fix scan 2 — the typed verifiers (edgeTrust.ts): node / credential / run / claim / step binding, the
 * nonce + jti single-use hooks, the payload hash, TTL ≤ configured max, iat not in the future / not stale, the validity
 * window on the edge's MONOTONIC clock from the request send, keyset updates verified with the OLD keys, no kid substitution.
 * (edgeTrust.ts did not exist at 98786da5d — every case here was absent there.)
 */
import { describe, expect, it } from "vitest";
import { EDGE_TYP_NAME, EdgeTrustStore, edgePinnedKeyset, generateEdgeSigningKey, signEdgeObject, type EdgeKeyset, type EdgeSigningKey } from "./edgeSigning";
import {
  verifyEdgeAuthorization,
  verifyEdgeCommand,
  verifyEdgeConfig,
  verifyEdgeRunPackage,
  verifyEdgeSweepPicture,
  type EdgeAuthorizationContext,
} from "./edgeTrust";

const T0 = 1_790_000_000_000;
let clock = T0;
const NODE = 7;
const PH = "sha256:" + "c".repeat(64);
const H64 = "d".repeat(64);
const JTI = "0b8f3c1e-5d7a-4c1b-9a2e-3f4d5c6b7a81";
const NONCE = "n0nce_AAAAAAAAAAAAAAAAAA";
const key = generateEdgeSigningKey().key;
const pin = edgePinnedKeyset([{ kid: key.kid, publicKeyPem: key.publicKeyPem, notBefore: T0 - 60_000 }], T0);
const store = () => EdgeTrustStore.fromPinned(pin, { nodeId: NODE, now: () => clock, skewMs: 5_000 });

function claims(k: EdgeSigningKey, over: Record<string, unknown> = {}) {
  return {
    typ: EDGE_TYP_NAME.auth, kid: k.kid, jti: JTI, nodeId: NODE, credentialId: 31, runId: 9, claimSeq: 2, stepId: "m1", attempt: 1,
    idempotencyKey: "foe:9:m1:1", kind: "robot", target: { robotId: 12, jobType: "move" }, payloadHash: PH, approval: { approvedBy: 4, gateStepId: "g" },
    mode: "real", verdicts: { commissioned: true, policy: "allow", interlock: "pass" }, safetyConfigIds: [], reqNonce: NONCE, iat: T0, ttlMs: 10_000,
    ...over,
  };
}
function ctx(over: Partial<EdgeAuthorizationContext> = {}): EdgeAuthorizationContext {
  return {
    credentialId: 31, runId: 9, claimSeq: 2, stepId: "m1", attempt: 1, idempotencyKey: "foe:9:m1:1", kind: "robot", payloadHash: PH, reqNonce: NONCE,
    maxTtlMs: 10_000, requestSentMonoMs: 1_000, nowMonoMs: 1_500, isNoncePending: (n) => n === NONCE, isJtiConsumed: () => false,
    ...over,
  };
}

describe("verifyEdgeAuthorization — every binding", () => {
  it("a correct authorisation passes; expiresAtMonoMs = requestSent + ttl", () => {
    clock = T0;
    const r = verifyEdgeAuthorization(store(), signEdgeObject("auth", claims(key), key), ctx());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.expiresAtMonoMs).toBe(11_000);
  });

  it("★ node binding: an authorisation minted for another node ⇒ node_mismatch (A3); another credential ⇒ credential_mismatch", () => {
    clock = T0;
    expect(verifyEdgeAuthorization(store(), signEdgeObject("auth", claims(key, { nodeId: 8 }), key), ctx())).toEqual({ ok: false, reason: "node_mismatch" });
    expect(verifyEdgeAuthorization(store(), signEdgeObject("auth", claims(key, { credentialId: 32 }), key), ctx())).toEqual({ ok: false, reason: "credential_mismatch" });
  });

  it("★ each context field must match (run, claim, step, attempt, idempotency key, kind, nonce); the payload hash must match", () => {
    clock = T0;
    const env = signEdgeObject("auth", claims(key), key);
    for (const over of [{ runId: 10 }, { claimSeq: 3 }, { stepId: "m2" }, { attempt: 2 }, { idempotencyKey: "x" }, { kind: "ot" as const }, { reqNonce: "other_nonce_AAAAAAAAAAAA" }]) {
      expect(verifyEdgeAuthorization(store(), env, ctx(over)), JSON.stringify(over)).toEqual({ ok: false, reason: "context_mismatch" });
    }
    expect(verifyEdgeAuthorization(store(), env, ctx({ payloadHash: "sha256:" + "e".repeat(64) }))).toEqual({ ok: false, reason: "payload_mismatch" });
  });

  it("★ TTL ≤ the configured maximum; iat not in the future beyond skew, not older than ttl + skew", () => {
    clock = T0;
    expect(verifyEdgeAuthorization(store(), signEdgeObject("auth", claims(key, { ttlMs: 20_000 }), key), ctx({ maxTtlMs: 10_000 }))).toEqual({ ok: false, reason: "ttl_too_long" });
    expect(verifyEdgeAuthorization(store(), signEdgeObject("auth", claims(key, { ttlMs: 30_000 }), key), ctx({ maxTtlMs: 600_000 })).ok).toBe(true); // capped at 30 s, 30 s ok
    expect(verifyEdgeAuthorization(store(), signEdgeObject("auth", claims(key, { iat: T0 + 6_000 }), key), ctx())).toEqual({ ok: false, reason: "iat_in_future" });
    expect(verifyEdgeAuthorization(store(), signEdgeObject("auth", claims(key, { iat: T0 + 4_000 }), key), ctx()).ok).toBe(true);
    expect(verifyEdgeAuthorization(store(), signEdgeObject("auth", claims(key, { iat: T0 - 16_000 }), key), ctx())).toEqual({ ok: false, reason: "iat_too_old" });
  });

  it("★ the window is the edge's monotonic clock from the request SEND — a fresh iat cannot extend it", () => {
    clock = T0;
    const env = signEdgeObject("auth", claims(key, { iat: T0 + 4_000 }), key); // as fresh as the signer can make it
    expect(verifyEdgeAuthorization(store(), env, ctx({ requestSentMonoMs: 1_000, nowMonoMs: 10_999 })).ok).toBe(true);
    expect(verifyEdgeAuthorization(store(), env, ctx({ requestSentMonoMs: 1_000, nowMonoMs: 11_000 }))).toEqual({ ok: false, reason: "expired" });
    expect(verifyEdgeAuthorization(store(), env, ctx({ requestSentMonoMs: 1_000, nowMonoMs: 999 }))).toEqual({ ok: false, reason: "clock" });
    expect(verifyEdgeAuthorization(store(), env, ctx({ requestSentMonoMs: Number.NaN }))).toEqual({ ok: false, reason: "clock" });
  });

  it("★ single use: the nonce must be pending in THIS process, the jti never consumed", () => {
    clock = T0;
    const env = signEdgeObject("auth", claims(key), key);
    expect(verifyEdgeAuthorization(store(), env, ctx({ isNoncePending: () => false }))).toEqual({ ok: false, reason: "nonce_not_pending" });
    expect(verifyEdgeAuthorization(store(), env, ctx({ isJtiConsumed: () => true }))).toEqual({ ok: false, reason: "jti_consumed" });
    expect(verifyEdgeAuthorization(store(), env, ctx({ isJtiConsumed: () => undefined as never }))).toEqual({ ok: false, reason: "jti_consumed" });
  });

  it("schema: a claim set with extra / missing fields ⇒ schema; a signature problem keeps its reason; a hook that throws ⇒ invalid", () => {
    clock = T0;
    expect(verifyEdgeAuthorization(store(), signEdgeObject("auth", claims(key, { trusted: true }), key), ctx())).toEqual({ ok: false, reason: "schema" });
    expect(verifyEdgeAuthorization(store(), signEdgeObject("cmd", claims(key, { typ: undefined }), key), ctx())).toEqual({ ok: false, reason: "wrong_typ" });
    const r = verifyEdgeAuthorization(store(), signEdgeObject("auth", claims(key), key), ctx({ isJtiConsumed: () => { throw new Error("x"); } }));
    expect(r.ok).toBe(false);
  });
});

describe("config / run package / sweep picture / command — bound to this node", () => {
  const limits = { authTtlMs: 10_000, maxClockSkewMs: 5_000, journalMaxBytes: 1_000_000, programReportMs: 30_000, programReportMaxAgeMs: 60_000, heartbeatMs: 5_000, pullMs: 2_000 };
  const config = (over: Record<string, unknown> = {}) => ({
    kind: "config_snapshot", protocolVersion: 2, configVersion: 3, issuedAt: T0, node: { id: NODE, code: "edge-a", credentialId: 31, factoryCode: null, lineCodes: [] },
    adapters: [], robots: [], machines: [], safetyPlcConfigs: [], keyset: signEdgeObject("keyset", pin, key), limits, ...over,
  });
  const prior = { completed: [], settled: [], attempted: [], startOrder: [], branches: [], abortSentBefore: [], unknown: false };
  const pkg = (over: Record<string, unknown> = {}) => ({
    kind: "run_package", runId: 9, nodeId: NODE, defHash: H64, definition: { steps: [] }, machines: [], verifiedStops: [], stopsUnsure: [], prior, issuedAt: T0,
    claimSeq: 2, workflowId: 1, workflowVersion: 1, params: {}, context: {}, owner: null, startedViaApi: false, resolvedAdapters: [], approvals: [], bindingDigest: null, ...over,
  });

  it("★ config: other node ⇒ node_mismatch; other credential ⇒ credential_mismatch; older version ⇒ rollback; future issuedAt ⇒ refused", () => {
    clock = T0;
    expect(verifyEdgeConfig(store(), signEdgeObject("config", config(), key), { credentialId: 31, lastConfigVersion: 3 }).ok).toBe(true);
    expect(verifyEdgeConfig(store(), signEdgeObject("config", config({ node: { id: 8, code: "b", credentialId: 31, factoryCode: null, lineCodes: [] } }), key))).toEqual({ ok: false, reason: "node_mismatch" });
    expect(verifyEdgeConfig(store(), signEdgeObject("config", config(), key), { credentialId: 30 })).toEqual({ ok: false, reason: "credential_mismatch" });
    expect(verifyEdgeConfig(store(), signEdgeObject("config", config(), key), { lastConfigVersion: 4 })).toEqual({ ok: false, reason: "rollback" });
    expect(verifyEdgeConfig(store(), signEdgeObject("config", config({ issuedAt: T0 + 60_000 }), key))).toEqual({ ok: false, reason: "iat_in_future" });
  });

  it("★ the config's embedded keyset is never self-trusting: signed by an attacker key it is refused by the store (old keys verify it)", () => {
    clock = T0;
    const att = generateEdgeSigningKey().key;
    const s = store();
    const evil: EdgeKeyset = { v: 1, version: 9, issuedAt: T0, keys: [...pin.keys, { kid: att.kid, publicKeyPem: att.publicKeyPem, status: "active", notBefore: T0 - 1, notAfter: null }] };
    const env = signEdgeObject("config", config({ keyset: signEdgeObject("keyset", evil, att) }), key);
    const r = verifyEdgeConfig(s, env);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(s.acceptKeysetUpdate(r.config.keyset)).toEqual({ ok: false, reason: "unknown_kid" });
    expect(s.version).toBe(1);
    // and an object signed by that attacker key stays unverifiable
    expect(verifyEdgeCommand(s, signEdgeObject("cmd", { kind: "stop", requestId: 1, nodeId: NODE, issuedAt: T0, expiresAt: T0 + 1, target: { robotId: 1 } }, att))).toEqual({ ok: false, reason: "unknown_kid" });
  });

  it("★ a later keyset may not substitute another key under a trusted kid (kid = fingerprint)", () => {
    clock = T0;
    const att = generateEdgeSigningKey().key;
    const s = store();
    const swapped = { v: 1, version: 2, issuedAt: T0, keys: [{ ...pin.keys[0], publicKeyPem: att.publicKeyPem }] };
    expect(s.acceptKeysetUpdate(signEdgeObject("keyset", swapped, key))).toEqual({ ok: false, reason: "invalid_keyset" });
  });

  it("★ run package: node, run and claim must match; sweep picture: node and run", () => {
    clock = T0;
    expect(verifyEdgeRunPackage(store(), signEdgeObject("runpkg", pkg(), key), { runId: 9, claimSeq: 2 }).ok).toBe(true);
    expect(verifyEdgeRunPackage(store(), signEdgeObject("runpkg", pkg({ nodeId: 8 }), key), { runId: 9, claimSeq: 2 })).toEqual({ ok: false, reason: "node_mismatch" });
    expect(verifyEdgeRunPackage(store(), signEdgeObject("runpkg", pkg(), key), { runId: 10, claimSeq: 2 })).toEqual({ ok: false, reason: "context_mismatch" });
    expect(verifyEdgeRunPackage(store(), signEdgeObject("runpkg", pkg(), key), { runId: 9, claimSeq: 3 })).toEqual({ ok: false, reason: "context_mismatch" });
    const sweep = { kind: "sweep_picture", runId: 9, nodeId: NODE, defHash: H64, definition: { steps: [] }, machines: [], verifiedStops: [], stopsUnsure: [], prior, issuedAt: T0 };
    expect(verifyEdgeSweepPicture(store(), signEdgeObject("runpkg", sweep, key), { runId: 9 }).ok).toBe(true);
    expect(verifyEdgeSweepPicture(store(), signEdgeObject("runpkg", { ...sweep, nodeId: 8 }, key), { runId: 9 })).toEqual({ ok: false, reason: "node_mismatch" });
    expect(verifyEdgeSweepPicture(store(), signEdgeObject("runpkg", sweep, key), { runId: 1 })).toEqual({ ok: false, reason: "context_mismatch" });
    // a run package is never accepted as a sweep picture and vice versa
    expect(verifyEdgeSweepPicture(store(), signEdgeObject("runpkg", pkg(), key), { runId: 9 })).toEqual({ ok: false, reason: "schema" });
  });

  it("★ command: node bound; expiry / not-yet-valid come from the store's clock (the caller sends a STOP anyway)", () => {
    clock = T0;
    const cmd = (over: Record<string, unknown> = {}) => ({ kind: "clear", requestId: 5, nodeId: NODE, issuedAt: T0, expiresAt: T0 + 30_000, robotId: 12, expectedGeneration: 4, clearedBy: 2, reason: "ok", ...over });
    expect(verifyEdgeCommand(store(), signEdgeObject("cmd", cmd(), key))).toEqual({ ok: true, command: cmd(), expired: false, notYetValid: false });
    expect(verifyEdgeCommand(store(), signEdgeObject("cmd", cmd({ nodeId: 8 }), key))).toEqual({ ok: false, reason: "node_mismatch" });
    clock = T0 + 40_000;
    expect(verifyEdgeCommand(store(), signEdgeObject("cmd", cmd(), key))).toMatchObject({ ok: true, expired: true });
    clock = T0;
    expect(verifyEdgeCommand(store(), signEdgeObject("cmd", cmd({ issuedAt: T0 + 60_000, expiresAt: T0 + 90_000 }), key))).toMatchObject({ ok: true, notYetValid: true });
  });
});
