/**
 * doc 81 Đợt 10 task A fix scan 2 (security scan on 98786da5d, again "authentication-bypass" / "authorization").
 * Uses ONLY names that also existed in 98786da5d, so it runs against an untracked copy of that commit: it was RED there
 * (see group-A-report.md) — verifyEdgeObject accepted ANY keyset object the caller passed, so a keyset carried by the same
 * message (or the config's own `keyset`) was self-certifying: the attacker supplies both the key and the signature.
 * Now the only anchor is a genuine EdgeTrustStore (local state from the pin + accepted chained updates).
 */
import { describe, expect, it } from "vitest";
import * as signing from "./edgeSigning";
import { generateEdgeSigningKey, signEdgeObject, verifyEdgeObject } from "./edgeSigning";

const T0 = Date.now();

describe("fix scan 2 — the trust anchor is never taken from a message", () => {
  const attacker = generateEdgeSigningKey().key;
  const attackerKeyset = {
    v: 1,
    version: 99,
    issuedAt: T0,
    keys: [{ kid: attacker.kid, publicKeyPem: attacker.publicKeyPem, status: "active", notBefore: T0 - 60_000, notAfter: null }],
  };

  it("★ a keyset object passed by the caller (e.g. carried in the same message) is never trusted — untrusted_keyset", () => {
    const forged = signEdgeObject("auth", { typ: "avi-edge-auth+v1", kid: attacker.kid, nodeId: 7, runId: 1 }, attacker);
    const r = verifyEdgeObject(forged, "auth", attackerKeyset as never);
    expect(r).toEqual({ ok: false, reason: "untrusted_keyset" });
  });

  it("★ a config verified with the keyset it carries itself is refused", () => {
    const keysetEnv = signEdgeObject("keyset", attackerKeyset, attacker);
    const config = signEdgeObject("config", { kind: "config_snapshot", node: { id: 7 }, keyset: keysetEnv }, attacker);
    const carried = JSON.parse((JSON.parse(config.payload) as { keyset: { payload: string } }).keyset.payload);
    expect(verifyEdgeObject(config, "config", carried as never).ok).toBe(false);
  });

  it("★ a fake store (an object with the store's prototype, or a look-alike) is not a trust anchor", () => {
    const Store = (signing as Record<string, unknown>).EdgeTrustStore as { prototype: object } | undefined;
    expect(Store).toBeDefined();
    const fake = Object.create(Store!.prototype);
    const lookAlike = { keyset: () => attackerKeyset, version: 99, nodeId: 7, now: () => T0, skewMs: 5_000 };
    const env = signEdgeObject("cmd", { kind: "stop" }, attacker);
    expect(verifyEdgeObject(env, "cmd", fake)).toEqual({ ok: false, reason: "untrusted_keyset" });
    expect(verifyEdgeObject(env, "cmd", lookAlike as never)).toEqual({ ok: false, reason: "untrusted_keyset" });
  });
});
