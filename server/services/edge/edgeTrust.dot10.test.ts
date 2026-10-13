/**
 * doc 81 Đợt 10 task A fix scan 2 — the typed verifiers (edgeTrust.ts): node / credential / run / claim / step binding, the
 * nonce + jti single-use hooks, the payload hash, TTL ≤ configured max, iat not in the future / not stale, the validity
 * window on the edge's MONOTONIC clock from the request send, keyset updates verified with the OLD keys, no kid substitution.
 * (edgeTrust.ts did not exist at 98786da5d — every case here was absent there.)
 * fix review 1: I3 — the TTL window starts at the FIRST send of the nonce, returned by the pending-nonce lookup itself
 * (pendingNonceSentAt); I4 — credentialId is REQUIRED for every typ (auth / config / runpkg / sweep / cmd) and the config
 * rollback check is REQUIRED (lastConfigVersion: number | null).
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
    maxTtlMs: 10_000, nowMonoMs: 1_500, pendingNonceSentAt: (n) => (n === NONCE ? 1_000 : undefined), isJtiConsumed: () => false,
    ...over,
  };
}

describe("verifyEdgeAuthorization — every binding", () => {
  it("a correct authorisation passes; expiresAtMonoMs = first send of the nonce + ttl", () => {
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
    expect(verifyEdgeAuthorization(store(), env, ctx({ nowMonoMs: 10_999 })).ok).toBe(true);
    expect(verifyEdgeAuthorization(store(), env, ctx({ nowMonoMs: 11_000 }))).toEqual({ ok: false, reason: "expired" });
    expect(verifyEdgeAuthorization(store(), env, ctx({ nowMonoMs: 999 }))).toEqual({ ok: false, reason: "clock" });
    expect(verifyEdgeAuthorization(store(), env, ctx({ pendingNonceSentAt: () => Number.NaN }))).toEqual({ ok: false, reason: "clock" });
    expect(verifyEdgeAuthorization(store(), env, ctx({ nowMonoMs: Number.NaN }))).toEqual({ ok: false, reason: "clock" });
  });

  it("★ I3: the TTL start is the FIRST send of the nonce, from the pending-nonce lookup — a retry's later send never widens the window", () => {
    clock = T0;
    // /authorize sent at mono 1 000, retried with the SAME nonce at mono 9 000: central returns the SAME token (§2.5 step 9)
    const sends = new Map<string, number>();
    const send = (nonce: string, at: number) => {
      if (!sends.has(nonce)) sends.set(nonce, at); // the pending set keeps the FIRST send
    };
    send(NONCE, 1_000);
    send(NONCE, 9_000);
    const env = signEdgeObject("auth", claims(key), key);
    const lookup = (n: string) => sends.get(n);
    expect(verifyEdgeAuthorization(store(), env, ctx({ pendingNonceSentAt: lookup, nowMonoMs: 10_999 }))).toMatchObject({ ok: true, expiresAtMonoMs: 11_000 });
    expect(verifyEdgeAuthorization(store(), env, ctx({ pendingNonceSentAt: lookup, nowMonoMs: 11_000 }))).toEqual({ ok: false, reason: "expired" });
    // a caller-supplied start is not part of the contract any more: it changes nothing
    const legacy = { ...ctx({ pendingNonceSentAt: lookup, nowMonoMs: 11_000 }), requestSentMonoMs: 9_000 } as unknown as EdgeAuthorizationContext;
    expect(verifyEdgeAuthorization(store(), env, legacy)).toEqual({ ok: false, reason: "expired" });
    // the lookup decides "pending" too: unknown nonce ⇒ nonce_not_pending, whatever the clock
    expect(verifyEdgeAuthorization(store(), env, ctx({ pendingNonceSentAt: () => undefined, nowMonoMs: 1_001 }))).toEqual({ ok: false, reason: "nonce_not_pending" });
    // a start in the future of now (a broken lookup) ⇒ clock
    expect(verifyEdgeAuthorization(store(), env, ctx({ pendingNonceSentAt: () => 5_000, nowMonoMs: 1_500 }))).toEqual({ ok: false, reason: "clock" });
  });

  it("★ single use: the nonce must be pending in THIS process, the jti never consumed", () => {
    clock = T0;
    const env = signEdgeObject("auth", claims(key), key);
    expect(verifyEdgeAuthorization(store(), env, ctx({ pendingNonceSentAt: () => undefined }))).toEqual({ ok: false, reason: "nonce_not_pending" });
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
    adapters: [], robots: [], machines: [], safetyPlcConfigs: [], keyset: signEdgeObject("keyset", pin.keyset, key), limits, ...over,
  });
  const prior = { completed: [], settled: [], attempted: [], startOrder: [], branches: [], abortSentBefore: [], unknown: false };
  const pkg = (over: Record<string, unknown> = {}) => ({
    kind: "run_package", runId: 9, nodeId: NODE, credentialId: 31, defHash: H64, definition: { steps: [] }, machines: [], verifiedStops: [], stopsUnsure: [], prior, issuedAt: T0,
    claimSeq: 2, workflowId: 1, workflowVersion: 1, params: {}, context: {}, owner: null, startedViaApi: false, resolvedAdapters: [], approvals: [], bindingDigest: null, ...over,
  });

  const C = { credentialId: 31, lastConfigVersion: null };
  it("★ config: other node ⇒ node_mismatch; other credential ⇒ credential_mismatch; older version ⇒ rollback; future issuedAt ⇒ refused", () => {
    clock = T0;
    expect(verifyEdgeConfig(store(), signEdgeObject("config", config(), key), { credentialId: 31, lastConfigVersion: 3 }).ok).toBe(true);
    expect(verifyEdgeConfig(store(), signEdgeObject("config", config(), key), C).ok).toBe(true); // first config ever (explicit null)
    expect(verifyEdgeConfig(store(), signEdgeObject("config", config({ node: { id: 8, code: "b", credentialId: 31, factoryCode: null, lineCodes: [] } }), key), C)).toEqual({ ok: false, reason: "node_mismatch" });
    expect(verifyEdgeConfig(store(), signEdgeObject("config", config(), key), { ...C, credentialId: 30 })).toEqual({ ok: false, reason: "credential_mismatch" });
    expect(verifyEdgeConfig(store(), signEdgeObject("config", config(), key), { ...C, lastConfigVersion: 4 })).toEqual({ ok: false, reason: "rollback" });
    expect(verifyEdgeConfig(store(), signEdgeObject("config", config({ issuedAt: T0 + 60_000 }), key), C)).toEqual({ ok: false, reason: "iat_in_future" });
  });

  it("★ I4: the credential binding and the rollback check are REQUIRED — an omitted / malformed context field fails closed", () => {
    clock = T0;
    const env = signEdgeObject("config", config(), key);
    const loose = (c: unknown) => verifyEdgeConfig(store(), env, c as never);
    expect(loose({ credentialId: 31 })).toEqual({ ok: false, reason: "context_mismatch" }); // lastConfigVersion omitted
    expect(loose({ credentialId: 31, lastConfigVersion: Number.NaN })).toEqual({ ok: false, reason: "context_mismatch" });
    expect(loose({ lastConfigVersion: null })).toEqual({ ok: false, reason: "credential_mismatch" }); // credentialId omitted
    expect(loose({ credentialId: 0, lastConfigVersion: null })).toEqual({ ok: false, reason: "credential_mismatch" });
    expect(loose(undefined)).toEqual({ ok: false, reason: "context_mismatch" });
    // run package / sweep picture / command without a credential context ⇒ credential_mismatch
    expect(verifyEdgeRunPackage(store(), signEdgeObject("runpkg", pkg(), key), { runId: 9, claimSeq: 2 } as never)).toEqual({ ok: false, reason: "credential_mismatch" });
    expect(verifyEdgeCommand(store(), signEdgeObject("cmd", { kind: "stop", requestId: 1, nodeId: NODE, credentialId: 31, ownerEpoch: 1, issuedAt: T0, expiresAt: T0 + 1, target: { robotId: 1 } }, key), {} as never)).toEqual({ ok: false, reason: "credential_mismatch" });
  });

  it("★ the config's embedded keyset is never self-trusting: signed by an attacker key it is refused by the store (old keys verify it)", () => {
    clock = T0;
    const att = generateEdgeSigningKey().key;
    const s = store();
    const evil: EdgeKeyset = { v: 1, version: 9, issuedAt: T0, keys: [...pin.keyset.keys, { kid: att.kid, publicKeyPem: att.publicKeyPem, status: "active", notBefore: T0 - 1, notAfter: null }] };
    const env = signEdgeObject("config", config({ keyset: signEdgeObject("keyset", evil, att) }), key);
    const r = verifyEdgeConfig(s, env, C);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(s.acceptKeysetUpdate(r.config.keyset)).toEqual({ ok: false, reason: "unknown_kid" });
    expect(s.version).toBe(1);
    // and an object signed by that attacker key stays unverifiable
    expect(verifyEdgeCommand(s, signEdgeObject("cmd", { kind: "stop", requestId: 1, nodeId: NODE, credentialId: 31, ownerEpoch: 1, issuedAt: T0, expiresAt: T0 + 1, target: { robotId: 1 } }, att), { credentialId: 31 })).toEqual({ ok: false, reason: "unknown_kid" });
  });

  it("★ a later keyset may not substitute another key under a trusted kid (kid = fingerprint)", () => {
    clock = T0;
    const att = generateEdgeSigningKey().key;
    const s = store();
    const swapped = { v: 1, version: 2, issuedAt: T0, keys: [{ ...pin.keyset.keys[0], publicKeyPem: att.publicKeyPem }] };
    expect(s.acceptKeysetUpdate(signEdgeObject("keyset", swapped, key))).toEqual({ ok: false, reason: "invalid_keyset" });
  });

  it("★ run package: node, credential, run and claim must match; sweep picture: node, credential and run", () => {
    clock = T0;
    const R = { credentialId: 31, runId: 9, claimSeq: 2 };
    expect(verifyEdgeRunPackage(store(), signEdgeObject("runpkg", pkg(), key), R).ok).toBe(true);
    expect(verifyEdgeRunPackage(store(), signEdgeObject("runpkg", pkg({ nodeId: 8 }), key), R)).toEqual({ ok: false, reason: "node_mismatch" });
    expect(verifyEdgeRunPackage(store(), signEdgeObject("runpkg", pkg({ credentialId: 32 }), key), R)).toEqual({ ok: false, reason: "credential_mismatch" });
    expect(verifyEdgeRunPackage(store(), signEdgeObject("runpkg", pkg(), key), { ...R, runId: 10 })).toEqual({ ok: false, reason: "context_mismatch" });
    expect(verifyEdgeRunPackage(store(), signEdgeObject("runpkg", pkg(), key), { ...R, claimSeq: 3 })).toEqual({ ok: false, reason: "context_mismatch" });
    const { credentialId: _c, ...noCred } = pkg();
    expect(verifyEdgeRunPackage(store(), signEdgeObject("runpkg", noCred, key), R)).toEqual({ ok: false, reason: "schema" }); // the field is required
    const sweep = { kind: "sweep_picture", runId: 9, nodeId: NODE, credentialId: 31, defHash: H64, definition: { steps: [] }, machines: [], verifiedStops: [], stopsUnsure: [], prior, issuedAt: T0 };
    const S = { credentialId: 31, runId: 9 };
    expect(verifyEdgeSweepPicture(store(), signEdgeObject("runpkg", sweep, key), S).ok).toBe(true);
    expect(verifyEdgeSweepPicture(store(), signEdgeObject("runpkg", { ...sweep, nodeId: 8 }, key), S)).toEqual({ ok: false, reason: "node_mismatch" });
    expect(verifyEdgeSweepPicture(store(), signEdgeObject("runpkg", { ...sweep, credentialId: 32 }, key), S)).toEqual({ ok: false, reason: "credential_mismatch" });
    expect(verifyEdgeSweepPicture(store(), signEdgeObject("runpkg", sweep, key), { ...S, runId: 1 })).toEqual({ ok: false, reason: "context_mismatch" });
    // a run package is never accepted as a sweep picture and vice versa
    expect(verifyEdgeSweepPicture(store(), signEdgeObject("runpkg", pkg(), key), S)).toEqual({ ok: false, reason: "schema" });
  });

  it("★ command: node + credential bound; expiry / not-yet-valid come from the store's clock (the caller sends a STOP anyway)", () => {
    clock = T0;
    const K = { credentialId: 31 };
    const cmd = (over: Record<string, unknown> = {}) => ({ kind: "clear", requestId: 5, nodeId: NODE, credentialId: 31, ownerEpoch: 2, issuedAt: T0, expiresAt: T0 + 30_000, robotId: 12, expectedGeneration: 4, clearedBy: 2, reason: "ok", ...over });
    expect(verifyEdgeCommand(store(), signEdgeObject("cmd", cmd(), key), K)).toEqual({ ok: true, command: cmd(), expired: false, notYetValid: false });
    expect(verifyEdgeCommand(store(), signEdgeObject("cmd", cmd({ nodeId: 8 }), key), K)).toEqual({ ok: false, reason: "node_mismatch" });
    expect(verifyEdgeCommand(store(), signEdgeObject("cmd", cmd({ credentialId: 32 }), key), K)).toEqual({ ok: false, reason: "credential_mismatch" });
    const { credentialId: _c, ...noCred } = cmd();
    expect(verifyEdgeCommand(store(), signEdgeObject("cmd", noCred, key), K)).toEqual({ ok: false, reason: "schema" });
    clock = T0 + 40_000;
    expect(verifyEdgeCommand(store(), signEdgeObject("cmd", cmd(), key), K)).toMatchObject({ ok: true, expired: true });
    clock = T0;
    expect(verifyEdgeCommand(store(), signEdgeObject("cmd", cmd({ issuedAt: T0 + 60_000, expiresAt: T0 + 90_000 }), key), K)).toMatchObject({ ok: true, notYetValid: true });
  });
});
