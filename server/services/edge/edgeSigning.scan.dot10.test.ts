/**
 * doc 81 Đợt 10 task A fix scan (security scan on 6109f5e7c: "authentication-bypass", "authorization"; ruling R-10-a).
 * Every case below except the typ one was RED on 6109f5e7c (see group-A-report.md). Fix scan 2 moved verification onto the
 * local EdgeTrustStore (the cases are unchanged in substance; the keysets are now built through the chain).
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
  EdgeTrustStore,
  edgeCanonicalJson,
  edgePinnedKeyset,
  generateEdgeSigningKey,
  parseEdgeCanonicalJson,
  signEdgeObject,
  verifyEdgeObject,
  type EdgeKeyset,
  type EdgeSigningKey,
} from "./edgeSigning";

const T0 = 1_790_000_000_000;
let clock = T0;
type St = "next" | "active" | "retired";
const entry = (key: EdgeSigningKey, status: St = "active", notAfter: number | null = null, notBefore = T0 - 60_000) => ({
  kid: key.kid,
  publicKeyPem: key.publicKeyPem,
  status,
  notBefore,
  notAfter,
});
const ks = (version: number, ...keys: ReturnType<typeof entry>[]): EdgeKeyset => ({ v: 1, version, issuedAt: T0, keys });
const pinOf = (root: EdgeSigningKey) => edgePinnedKeyset([{ kid: root.kid, publicKeyPem: root.publicKeyPem, notBefore: T0 - 60_000 }], T0);
const storeOf = (root: EdgeSigningKey, updates: unknown[] = []) => EdgeTrustStore.fromPinned(pinOf(root), { nodeId: 7, now: () => clock, skewMs: 5_000 }, updates);
/** root-pinned store whose current keyset is {root, ...extra} (one update signed by root). */
const storeWith = (root: EdgeSigningKey, ...extra: ReturnType<typeof entry>[]) => storeOf(root, [signEdgeObject("keyset", ks(2, entry(root), ...extra), root)]);
/** Sign arbitrary TEXT the way the signer would (domain prefix + kid) — to prove the verifier refuses non-canonical text even with a valid signature. */
function signText(typ: string, key: EdgeSigningKey, text: string) {
  const sig = cryptoSign(null, Buffer.from(`avi-edge-v1\n${typ}\n${key.kid}\n${text}`, "utf8"), key.privateKey).toString("base64url");
  return { typ: `avi-edge-${typ}+v1`, alg: "EdDSA", kid: key.kid, payload: text, sig };
}

describe("R-10-a (1) verify is an allow-list", () => {
  const k = generateEdgeSigningKey().key;
  const other = generateEdgeSigningKey().key;
  const trusted = storeOf(k);

  it("a kid that is not in the trusted set, a missing kid, or an envelope relabelled to another kid — never 'any key'", () => {
    clock = T0;
    const env = signEdgeObject("cmd", { kind: "stop" }, k);
    expect(verifyEdgeObject({ ...env, kid: other.kid }, "cmd", trusted)).toEqual({ ok: false, reason: "unknown_kid" });
    const { kid: _k, ...noKid } = env;
    expect(verifyEdgeObject(noKid, "cmd", trusted)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyEdgeObject(env, "cmd", storeOf(other))).toEqual({ ok: false, reason: "unknown_kid" });
    // a keyset listing the same kid twice never becomes trusted
    expect(trusted.acceptKeysetUpdate(signEdgeObject("keyset", ks(2, entry(k), { ...entry(other), kid: k.kid }), k))).toEqual({ ok: false, reason: "invalid_keyset" });
  });

  it("★ a `next` key never verifies, even inside its window; a retired key only inside [notBefore, notAfter] ± skew", () => {
    clock = T0;
    const root = generateEdgeSigningKey().key;
    const env = signEdgeObject("auth", { a: 1 }, k);
    expect(verifyEdgeObject(env, "auth", storeWith(root, entry(k, "next")))).toEqual({ ok: false, reason: "key_not_valid" });
    expect(verifyEdgeObject(env, "auth", storeWith(root, entry(k, "retired", T0 + 10_000))).ok).toBe(true);
    expect(verifyEdgeObject(env, "auth", storeWith(root, entry(k, "retired", T0 - 10_000)))).toEqual({ ok: false, reason: "key_not_valid" });
    expect(verifyEdgeObject(env, "auth", storeWith(root, entry(k, "active", null, T0 + 60_000)))).toEqual({ ok: false, reason: "key_not_valid" });
    expect(verifyEdgeObject(env, "auth", storeWith(root, entry(k, "active", T0 - 60_000)))).toEqual({ ok: false, reason: "key_not_valid" });
    // a retired key without notAfter / an unknown status never even enters the trusted set
    expect(storeOf(root).acceptKeysetUpdate(signEdgeObject("keyset", ks(2, entry(root), entry(k, "retired", null)), root))).toEqual({ ok: false, reason: "invalid_keyset" });
    expect(storeOf(root).acceptKeysetUpdate(signEdgeObject("keyset", ks(2, entry(root), { ...entry(k), status: "bogus" as St }), root))).toEqual({ ok: false, reason: "invalid_keyset" });
  });

  it("typ is enforced exactly, before the signature: a valid config signature relabelled / asked as auth is refused; an unknown expected typ is refused", () => {
    clock = T0;
    const env = signEdgeObject("config", { a: 1 }, k);
    expect(verifyEdgeObject(env, "auth", trusted)).toEqual({ ok: false, reason: "wrong_typ" });
    expect(verifyEdgeObject({ ...env, typ: EDGE_TYP_NAME.auth }, "auth", trusted)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyEdgeObject({ ...env, typ: "avi-edge-config+v2" }, "config", trusted)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyEdgeObject(env, "bogus" as never, trusted).ok).toBe(false);
  });

  it("★ ONE accepted encoding: duplicate keys, whitespace, key order, number / string spellings, precision loss, prototype keys ⇒ non_canonical (even when validly signed)", () => {
    clock = T0;
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
      expect(verifyEdgeObject(signText("cmd", k, text), "cmd", trusted), text).toEqual({ ok: false, reason: "non_canonical" });
    }
    expect(verifyEdgeObject(signText("cmd", k, '{"a":100}'), "cmd", trusted).ok).toBe(true);
    expect(() => edgeCanonicalJson(JSON.parse('{"__proto__":{"x":1}}'))).toThrow();
  });

  it("★ any exception is invalid: a store whose clock throws, a payload getter that throws", () => {
    const env = signEdgeObject("cmd", { kind: "stop" }, k);
    const broken = EdgeTrustStore.fromPinned(pinOf(k), {
      nodeId: 7,
      now: () => {
        throw new Error("boom");
      },
    });
    expect(() => verifyEdgeObject(env, "cmd", broken)).not.toThrow();
    expect(verifyEdgeObject(env, "cmd", broken).ok).toBe(false);
    expect(() => broken.acceptKeysetUpdate(signEdgeObject("keyset", ks(2, entry(k)), k))).not.toThrow();
    expect(broken.acceptKeysetUpdate(signEdgeObject("keyset", ks(2, entry(k)), k)).ok).toBe(false);
    const hostile = {
      ...env,
      get payload(): string {
        throw new Error("boom");
      },
    };
    clock = T0;
    expect(verifyEdgeObject(hostile, "cmd", trusted).ok).toBe(false);
  });
});

describe("R-10-a (2) keyset chain", () => {
  const root = generateEdgeSigningKey().key;
  const k2 = generateEdgeSigningKey().key;
  const k3 = generateEdgeSigningKey().key;
  const att = generateEdgeSigningKey().key;
  const v2 = ks(2, entry(root), entry(k2));

  it("an update signed by a key that is not ALREADY trusted is refused (even if the update itself lists that key)", () => {
    clock = T0;
    expect(storeOf(root).acceptKeysetUpdate(signEdgeObject("keyset", ks(2, entry(root), entry(att)), att))).toEqual({ ok: false, reason: "unknown_kid" });
  });

  it("★ a retired key cannot sign a keyset, even inside its verify window", () => {
    clock = T0;
    const s = storeOf(root, [signEdgeObject("keyset", v2, root), signEdgeObject("keyset", ks(3, entry(root), entry(k2, "retired", T0 + 30_000)), k2)]);
    expect(s.acceptKeysetUpdate(signEdgeObject("keyset", ks(4, entry(root)), k2))).toEqual({ ok: false, reason: "signer_not_active" });
  });

  it("★ a next key cannot sign before activation", () => {
    clock = T0;
    const s = storeWith(root, entry(k2, "next"));
    expect(s.acceptKeysetUpdate(signEdgeObject("keyset", ks(3, entry(root), entry(k2)), k2))).toEqual({ ok: false, reason: "key_not_valid" });
  });

  it("no downgrade / rollback: a lower version, or the same version with other content, is refused", () => {
    clock = T0;
    const s = storeOf(root, [signEdgeObject("keyset", v2, root), signEdgeObject("keyset", ks(3, entry(root), entry(k2)), k2)]);
    expect(s.acceptKeysetUpdate(signEdgeObject("keyset", v2, root))).toEqual({ ok: false, reason: "rollback" });
    expect(s.acceptKeysetUpdate(signEdgeObject("keyset", ks(3, entry(root)), root))).toEqual({ ok: false, reason: "rollback" });
    expect(s.version).toBe(3);
  });

  it("★ the pinned root can never be dropped, demoted, time-limited or swapped by an update — only re-provisioning replaces it", () => {
    clock = T0;
    const offer = (body: EdgeKeyset) => storeOf(root, [signEdgeObject("keyset", v2, root)]).acceptKeysetUpdate(signEdgeObject("keyset", body, k2));
    expect(offer(ks(3, entry(k2)))).toEqual({ ok: false, reason: "pinned_removed" });
    expect(offer(ks(3, entry(k2), entry(root, "retired", T0 + 30_000)))).toEqual({ ok: false, reason: "pinned_removed" });
    expect(offer(ks(3, entry(k2), entry(root, "next")))).toEqual({ ok: false, reason: "pinned_removed" });
    expect(offer(ks(3, entry(k2), entry(root, "active", T0 + 3_600_000)))).toEqual({ ok: false, reason: "pinned_removed" });
    expect(offer(ks(3, entry(k2), entry(root), entry(k3, "next")))).toEqual({ ok: true, version: 3, changed: true });
    expect(storeOf(root).acceptKeysetUpdate(signEdgeObject("keyset", ks(2, entry(k2)), root))).toEqual({ ok: false, reason: "pinned_removed" });
    // a pin itself must be active and open-ended
    expect(() => EdgeTrustStore.fromPinned(ks(1, entry(root, "active", T0 + 1)), { nodeId: 7 })).toThrow();
  });

  it("only the PIN is kept forever: a non-root signer (k2) may be dropped by a later link", () => {
    clock = T0;
    const s = storeOf(root, [signEdgeObject("keyset", v2, root)]);
    expect(s.acceptKeysetUpdate(signEdgeObject("keyset", ks(3, entry(root), entry(k3)), k2))).toEqual({ ok: true, version: 3, changed: true });
  });
});
