/**
 * doc 81 Đợt 10 task A fix scan (security scan on 6109f5e7c: "authentication-bypass", "authorization"; ruling R-10-a).
 * Every case below was RED on 6109f5e7c (run against an untracked copy of that commit — see group-A-report.md).
 *
 * R-10-a: verification is an ALLOW-LIST — the kid must be in the trusted set; status active, or retired inside its
 * TTL + skew window (verify only, never sign); typ exactly equal; strict canonical form (duplicate keys / non-canonical
 * input refused); any exception = invalid. Keyset updates: signed by a currently trusted ACTIVE key, strictly increasing
 * version, never removing the pinned provisioning key (only re-provisioning replaces it).
 */
import { sign as cryptoSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EDGE_TYP_NAME,
  edgeCanonicalJson,
  generateEdgeSigningKey,
  parseEdgeCanonicalJson,
  signEdgeObject,
  verifyEdgeKeysetChain,
  verifyEdgeKeysetUpdate,
  verifyEdgeObject,
  type EdgeKeyset,
  type EdgeSigningKey,
} from "./edgeSigning";

const T0 = 1_790_000_000_000;
type St = "next" | "active" | "retired";
const entry = (key: EdgeSigningKey, status: St = "active", notAfter: number | null = null, notBefore = T0 - 60_000) => ({
  kid: key.kid,
  publicKeyPem: key.publicKeyPem,
  status,
  notBefore,
  notAfter,
});
const ks = (version: number, ...keys: ReturnType<typeof entry>[]): EdgeKeyset => ({ v: 1, version, issuedAt: T0, keys });
/** Sign arbitrary TEXT the way the signer would (domain prefix + kid) — to prove the verifier refuses non-canonical text even with a valid signature. */
function signText(typ: string, key: EdgeSigningKey, text: string) {
  const sig = cryptoSign(null, Buffer.from(`avi-edge-v1\n${typ}\n${key.kid}\n${text}`, "utf8"), key.privateKey).toString("base64url");
  return { typ: `avi-edge-${typ}+v1`, alg: "EdDSA", kid: key.kid, payload: text, sig };
}

describe("R-10-a (1) verify is an allow-list", () => {
  const k = generateEdgeSigningKey().key;
  const other = generateEdgeSigningKey().key;
  const trusted = ks(1, entry(k));

  it("a kid that is not in the trusted set, a missing kid, or an envelope relabelled to another kid — never 'any key'", () => {
    const env = signEdgeObject("cmd", { kind: "stop" }, k);
    expect(verifyEdgeObject({ ...env, kid: other.kid }, "cmd", trusted, { nowMs: T0 })).toEqual({ ok: false, reason: "unknown_kid" });
    const { kid: _k, ...noKid } = env;
    expect(verifyEdgeObject(noKid, "cmd", trusted, { nowMs: T0 })).toEqual({ ok: false, reason: "malformed" });
    expect(verifyEdgeObject(env, "cmd", ks(1, entry(other)), { nowMs: T0 })).toEqual({ ok: false, reason: "unknown_kid" });
    // a keyset listing the same kid twice (an unparsed / hostile keyset object) is ambiguous ⇒ refused, never "first match"
    const dup = ks(1, { ...entry(other), kid: k.kid }, entry(k));
    expect(verifyEdgeObject(env, "cmd", dup, { nowMs: T0 })).toEqual({ ok: false, reason: "unknown_kid" });
  });

  it("★ a `next` key never verifies, even inside its window; a retired key only inside [notBefore, notAfter] ± skew; a retired key without notAfter never", () => {
    const env = signEdgeObject("auth", { a: 1 }, k);
    expect(verifyEdgeObject(env, "auth", ks(1, entry(k, "next")), { nowMs: T0 })).toEqual({ ok: false, reason: "key_not_valid" });
    expect(verifyEdgeObject(env, "auth", ks(1, entry(k, "retired", T0 + 10_000)), { nowMs: T0 }).ok).toBe(true);
    expect(verifyEdgeObject(env, "auth", ks(1, entry(k, "retired", T0 - 10_000)), { nowMs: T0, skewMs: 5_000 })).toEqual({ ok: false, reason: "key_not_valid" });
    expect(verifyEdgeObject(env, "auth", ks(1, entry(k, "retired", null)), { nowMs: T0 })).toEqual({ ok: false, reason: "key_not_valid" });
    expect(verifyEdgeObject(env, "auth", ks(1, entry(k, "active", null, T0 + 60_000)), { nowMs: T0, skewMs: 5_000 })).toEqual({ ok: false, reason: "key_not_valid" });
    expect(verifyEdgeObject(env, "auth", ks(1, entry(k, "active", T0 - 60_000)), { nowMs: T0, skewMs: 5_000 })).toEqual({ ok: false, reason: "key_not_valid" });
    expect(verifyEdgeObject(env, "auth", ks(1, { ...entry(k), status: "bogus" as St }), { nowMs: T0 })).toEqual({ ok: false, reason: "key_not_valid" });
  });

  it("typ is enforced exactly, before the signature: a valid config signature relabelled / asked as auth is refused; an unknown expected typ is refused", () => {
    const env = signEdgeObject("config", { a: 1 }, k);
    expect(verifyEdgeObject(env, "auth", trusted, { nowMs: T0 })).toEqual({ ok: false, reason: "wrong_typ" });
    expect(verifyEdgeObject({ ...env, typ: EDGE_TYP_NAME.auth }, "auth", trusted, { nowMs: T0 })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyEdgeObject({ ...env, typ: "avi-edge-config+v2" }, "config", trusted, { nowMs: T0 })).toEqual({ ok: false, reason: "malformed" });
    expect(verifyEdgeObject(env, "bogus" as never, trusted, { nowMs: T0 }).ok).toBe(false);
  });

  it("★ ONE accepted encoding: duplicate keys, whitespace, key order, number / string spellings, precision loss, prototype keys ⇒ non_canonical (even when validly signed)", () => {
    const variants = [
      '{"a":1,"a":2}',
      '{"a":2,"a":2}',
      '{ "a":1}',
      '{"b":1,"a":2}',
      '{"a":1.0}',
      '{"a":1e2}',
      '{"a":"\\u0041"}',
      '{"a":9007199254740993}',
      '{"__proto__":{"x":1}}',
      '{"constructor":1}',
      '{"a":{"prototype":1}}',
      '{"a":-0}',
      "[1,2 ]",
      '"x" ',
    ];
    for (const text of variants) {
      expect(() => parseEdgeCanonicalJson(text), text).toThrow();
      expect(verifyEdgeObject(signText("cmd", k, text), "cmd", trusted, { nowMs: T0 }), text).toEqual({ ok: false, reason: "non_canonical" });
    }
    // the canonical spelling of the same value verifies
    expect(verifyEdgeObject(signText("cmd", k, '{"a":100}'), "cmd", trusted, { nowMs: T0 }).ok).toBe(true);
    expect(() => edgeCanonicalJson(JSON.parse('{"__proto__":{"x":1}}'))).toThrow();
  });

  it("★ any exception is invalid: a garbage key in the keyset, a keyset that throws on access, a payload getter that throws", () => {
    const env = signEdgeObject("cmd", { kind: "stop" }, k);
    const garbage = ks(1, { ...entry(k), publicKeyPem: "-----BEGIN PUBLIC KEY-----\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n-----END PUBLIC KEY-----\n" });
    expect(verifyEdgeObject(env, "cmd", garbage, { nowMs: T0 }).ok).toBe(false);
    const throwing = { v: 1, version: 1, issuedAt: T0, get keys(): never { throw new Error("boom"); } } as unknown as EdgeKeyset;
    expect(() => verifyEdgeObject(env, "cmd", throwing, { nowMs: T0 })).not.toThrow();
    expect(verifyEdgeObject(env, "cmd", throwing, { nowMs: T0 }).ok).toBe(false);
    const hostile = { ...env, get payload(): string { throw new Error("boom"); } };
    expect(verifyEdgeObject(hostile, "cmd", trusted, { nowMs: T0 }).ok).toBe(false);
  });
});

describe("R-10-a (2) keyset chain", () => {
  const root = generateEdgeSigningKey().key;
  const k2 = generateEdgeSigningKey().key;
  const k3 = generateEdgeSigningKey().key;
  const att = generateEdgeSigningKey().key;
  const pinned = ks(1, entry(root));
  const v2 = ks(2, entry(root), entry(k2));

  it("an update signed by a key that is not ALREADY trusted is refused (even if the update itself lists that key)", () => {
    const self = ks(2, entry(root), entry(att));
    expect(verifyEdgeKeysetUpdate(pinned, pinned, signEdgeObject("keyset", self, att), { nowMs: T0 })).toEqual({ ok: false, reason: "unknown_kid" });
  });

  it("★ a retired key cannot sign a keyset, even inside its verify window", () => {
    const trusted = ks(2, entry(root), entry(k2, "retired", T0 + 30_000));
    expect(verifyEdgeKeysetUpdate(pinned, trusted, signEdgeObject("keyset", ks(3, entry(root)), k2), { nowMs: T0 })).toEqual({ ok: false, reason: "signer_not_active" });
  });

  it("★ a next key cannot sign before activation", () => {
    const trusted = ks(2, entry(root), entry(k2, "next"));
    expect(verifyEdgeKeysetUpdate(pinned, trusted, signEdgeObject("keyset", ks(3, entry(root), entry(k2)), k2), { nowMs: T0 }).ok).toBe(false);
    // the same through the chain API (a pin that lists a next key): the next key's signature is not a trust anchor
    expect(verifyEdgeKeysetChain(trusted, [signEdgeObject("keyset", ks(3, entry(root), entry(k2)), k2)], { nowMs: T0 }).ok).toBe(false);
  });

  it("no downgrade / rollback: a lower or equal version is refused, also when replayed later in a chain", () => {
    const u2 = signEdgeObject("keyset", v2, root);
    expect(verifyEdgeKeysetUpdate(pinned, v2, u2, { nowMs: T0 })).toEqual({ ok: false, reason: "rollback" });
    expect(verifyEdgeKeysetChain(pinned, [u2, signEdgeObject("keyset", ks(3, entry(root), entry(k2)), k2), u2], { nowMs: T0 })).toEqual({ ok: false, reason: "rollback", index: 2 });
  });

  it("★ the pinned root can never be dropped, demoted, time-limited or swapped by an update — only re-provisioning replaces it", () => {
    const sign = (body: EdgeKeyset) => verifyEdgeKeysetUpdate(pinned, v2, signEdgeObject("keyset", body, k2), { nowMs: T0 });
    expect(sign(ks(3, entry(k2)))).toEqual({ ok: false, reason: "pinned_removed" });
    expect(sign(ks(3, entry(k2), entry(root, "retired", T0 + 30_000)))).toEqual({ ok: false, reason: "pinned_removed" });
    expect(sign(ks(3, entry(k2), entry(root, "next")))).toEqual({ ok: false, reason: "pinned_removed" });
    expect(sign(ks(3, entry(k2), entry(root, "active", T0 + 3_600_000)))).toEqual({ ok: false, reason: "pinned_removed" });
    expect(sign(ks(3, entry(k2), entry(root), entry(k3, "next")))).toEqual({ ok: true, keyset: ks(3, entry(k2), entry(root), entry(k3, "next")) });
    // the root itself can no more drop itself than anyone else can
    expect(verifyEdgeKeysetUpdate(pinned, pinned, signEdgeObject("keyset", ks(2, entry(k2)), root), { nowMs: T0 })).toEqual({ ok: false, reason: "pinned_removed" });
  });

  it("a chain whose later link drops the root is cut there; everything before stays valid", () => {
    const r = verifyEdgeKeysetChain(pinned, [signEdgeObject("keyset", v2, root), signEdgeObject("keyset", ks(3, entry(k2)), k2)], { nowMs: T0 });
    expect(r).toEqual({ ok: false, reason: "pinned_removed", index: 1 });
    // only the PIN is kept forever: a non-root signer (k2) may be dropped by a later link
    const v3 = ks(3, entry(root), entry(k3));
    expect(verifyEdgeKeysetChain(pinned, [signEdgeObject("keyset", v2, root), signEdgeObject("keyset", v3, k2)], { nowMs: T0 })).toEqual({ ok: true, keyset: v3 });
  });

  it("any exception in the update path is invalid, never thrown", () => {
    const throwing = { v: 1, version: 1, issuedAt: T0, get keys(): never { throw new Error("boom"); } } as unknown as EdgeKeyset;
    expect(() => verifyEdgeKeysetUpdate(throwing, pinned, signEdgeObject("keyset", v2, root), { nowMs: T0 })).not.toThrow();
    expect(verifyEdgeKeysetUpdate(throwing, pinned, signEdgeObject("keyset", v2, root), { nowMs: T0 }).ok).toBe(false);
    expect(() => verifyEdgeKeysetChain(throwing, [signEdgeObject("keyset", v2, root)], { nowMs: T0 })).not.toThrow();
    expect(verifyEdgeKeysetChain(throwing, [signEdgeObject("keyset", v2, root)], { nowMs: T0 }).ok).toBe(false);
  });
});
