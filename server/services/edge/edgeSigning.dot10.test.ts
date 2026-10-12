/**
 * doc 81 Đợt 10 task A — edgeSigning (design §2.13, ruling R-10-a): Ed25519 over the CANONICAL payload text with the domain
 * prefix "avi-edge-v1\n" + typ + "\n" + kid + "\n", typ ∈ {auth, config, runpkg, cmd, keyset}; kid handling; keyset chain
 * keeping the pinned root; key endorsement. The scan-fix cases (allow-list verifier, strict canonical form, chain rules) are
 * in edgeSigning.scan.dot10.test.ts.
 *
 * ORACLES independent of the product code:
 *   • RFC 8032 §7.1 TEST 1 (secret / public key / signature of the empty message) — proves the key import;
 *   • the signing input bytes are written out BY HAND here and checked with node:crypto `verify` directly (not through
 *     verifyEdgeObject), and the kid is recomputed here from the SPKI DER bytes assembled by hand.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  EDGE_KEYRING_MAX_KEYS,
  EDGE_PIN_KIND,
  EDGE_SIGNED_TYPS,
  EDGE_TYP_NAME,
  EdgeTrustError,
  parseEdgeKeysetPin,
  pruneEdgeKeyring,
  EdgeCanonicalJsonError,
  buildEdgeKeysetFromKeyring,
  edgePinFromKeyring,
  readEdgeKeyring,
  writeEdgeKeyring,
  edgeCanonicalJson,
  edgeKidOf,
  edgePinnedKeyset,
  edgeSigningInput,
  edgeSigningKeyFromPem,
  generateEdgeSigningKey,
  loadEdgeSigningKey,
  parseEdgeKeyset,
  signEdgeObject,
  EdgeTrustStore,
  verifyEdgeObject,
  type EdgeKeyset,
  type EdgeSigningKey,
} from "./edgeSigning";

// ── RFC 8032 §7.1 TEST 1 ──────────────────────────────────────────────────────────────────────────────────────────────
const RFC_SECRET = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const RFC_PUBLIC = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const RFC_SIG_EMPTY =
  "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";
const PKCS8_PREFIX = "302e020100300506032b657004220420";
const SPKI_PREFIX = "302a300506032b6570032100";
const rfcPrivatePem = createPrivateKey({ key: Buffer.from(PKCS8_PREFIX + RFC_SECRET, "hex"), format: "der", type: "pkcs8" })
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const rfcSpkiDer = Buffer.from(SPKI_PREFIX + RFC_PUBLIC, "hex");
const rfcKidByHand = "edk_" + createHash("sha256").update(rfcSpkiDer).digest("base64url").slice(0, 22);

const T0 = 1_790_000_000_000; // fixed "now" (ms)

type KeyOpt = { key: EdgeSigningKey; status?: "next" | "active" | "retired"; notBefore?: number; notAfter?: number | null };
const entry = (k: KeyOpt) => ({ kid: k.key.kid, publicKeyPem: k.key.publicKeyPem, status: k.status ?? "active", notBefore: k.notBefore ?? T0 - 60_000, notAfter: k.notAfter ?? null });
function keysetOf(...keys: KeyOpt[]): EdgeKeyset {
  return { v: 1, version: 1, issuedAt: T0, keys: keys.map(entry) };
}
let clock = T0;
const NODE = 7;
const pinOf = (root: EdgeSigningKey) => edgePinnedKeyset([{ kid: root.kid, publicKeyPem: root.publicKeyPem, notBefore: T0 - 60_000 }], T0);
/** A genuine trust store pinned on `root`, plus (optionally) one chained update signed by root adding `extra`. */
function storeWith(root: EdgeSigningKey, extra: KeyOpt[] = []): EdgeTrustStore {
  const pin = pinOf(root);
  const s = EdgeTrustStore.fromPinned(pin, { nodeId: NODE, now: () => clock, skewMs: 5_000 });
  if (extra.length) {
    const r = s.acceptKeysetUpdate(signEdgeObject("keyset", { v: 1, version: 2, issuedAt: T0, keys: [pin.keyset.keys[0], ...extra.map(entry)] }, root));
    if (!r.ok) throw new Error("storeWith: " + r.reason);
  }
  return s;
}
/** Re-serialise a signed envelope's payload after an edit (the attacker's view: a canonical but altered payload). */
function withPayload(env: { payload: string }, edit: (p: Record<string, unknown>) => void) {
  const p = JSON.parse(env.payload);
  edit(p);
  return { ...env, payload: edgeCanonicalJson(p) };
}

/** A complete authorisation claim set (design §2.5) — every field is tampered below. */
function authClaims(kid: string) {
  return {
    typ: EDGE_TYP_NAME.auth,
    kid,
    jti: "0b8f3c1e-5d7a-4c1b-9a2e-3f4d5c6b7a81",
    nodeId: 7,
    credentialId: 31,
    runId: 9001,
    claimSeq: 2,
    stepId: "move_a",
    attempt: 1,
    idempotencyKey: "foe:9001:move_a:1",
    kind: "robot",
    target: { robotId: 12, jobType: "move" },
    payloadHash: "sha256:" + "ab".repeat(32),
    approval: { approvedBy: 4, gateStepId: "gate1" },
    mode: "real",
    verdicts: { commissioned: true, policy: "allow", interlock: "pass" },
    safetyConfigIds: [3, 5],
    reqNonce: "n0nce-AAAAAAAAAAAAAAAAAAAA",
    iat: T0,
    ttlMs: 10_000,
  };
}

describe("RFC 8032 oracle — the Ed25519 key import is right", () => {
  it("TEST 1: the PEM built from the RFC secret signs the empty message to the RFC signature; its public key is the RFC one", () => {
    const sig = cryptoSign(null, Buffer.alloc(0), createPrivateKey(rfcPrivatePem)).toString("hex");
    expect(sig).toBe(RFC_SIG_EMPTY);
    const key = edgeSigningKeyFromPem(rfcPrivatePem);
    const spki = createPublicKey(key.publicKeyPem).export({ type: "spki", format: "der" }) as Buffer;
    expect(spki.toString("hex")).toBe(SPKI_PREFIX + RFC_PUBLIC);
  });

  it("kid = edk_ + first 22 base64url chars of sha256(SPKI DER) — recomputed by hand", () => {
    const key = edgeSigningKeyFromPem(rfcPrivatePem);
    expect(key.kid).toBe(rfcKidByHand);
    expect(edgeKidOf(key.publicKeyPem)).toBe(rfcKidByHand);
    expect(key.kid).toMatch(/^edk_[A-Za-z0-9_-]{22}$/);
  });

  it("a non-Ed25519 private key is refused", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    expect(() => edgeSigningKeyFromPem(privateKey.export({ type: "pkcs8", format: "pem" }).toString())).toThrow(/ed25519/i);
  });
});

describe("canonical JSON", () => {
  it("vectors: sorted keys at every depth, arrays in order, no whitespace, -0 → 0, undefined object members dropped", () => {
    expect(edgeCanonicalJson({ b: 1, a: [2, { d: null, c: "x" }] })).toBe('{"a":[2,{"c":"x","d":null}],"b":1}');
    expect(edgeCanonicalJson({ z: -0, y: undefined, x: true, w: "é \"" })).toBe('{"w":"é \\"","x":true,"z":0}');
    expect(edgeCanonicalJson([])).toBe("[]");
    expect(edgeCanonicalJson({})).toBe("{}");
    expect(edgeCanonicalJson({ B: 1, a: 2, _: 3 })).toBe('{"B":1,"_":3,"a":2}');
  });

  it("refuses what has no single JSON form: NaN / Infinity, bigint, Date, Map, Buffer, undefined in arrays, functions, too deep", () => {
    for (const bad of [NaN, Infinity, -Infinity, 1n, new Date(0), new Map(), Buffer.from("x"), [undefined], () => 1, Symbol("s")]) {
      expect(() => edgeCanonicalJson({ v: bad }), String(bad)).toThrow(EdgeCanonicalJsonError);
    }
    expect(() => edgeCanonicalJson(undefined)).toThrow(EdgeCanonicalJsonError);
    let deep: unknown = 1;
    for (let i = 0; i < 80; i++) deep = { d: deep };
    expect(() => edgeCanonicalJson(deep)).toThrow(EdgeCanonicalJsonError);
  });
});

describe("signing input + test vector (domain separation)", () => {
  it("the exact bytes: 'avi-edge-v1\\n' + typ + '\\n' + kid + '\\n' + canonical payload — verified with node:crypto directly", () => {
    const key = edgeSigningKeyFromPem(rfcPrivatePem);
    const payload = { b: [1, "two"], a: { y: false, x: null } };
    const text = '{"a":{"x":null,"y":false},"b":[1,"two"]}';
    const byHand = Buffer.from(`avi-edge-v1\nconfig\n${rfcKidByHand}\n${text}`, "utf8");
    expect(edgeSigningInput("config", key.kid, text).equals(byHand)).toBe(true);
    const env = signEdgeObject("config", payload, key);
    expect(env).toEqual({ typ: "avi-edge-config+v1", alg: "EdDSA", kid: rfcKidByHand, payload: text, sig: expect.stringMatching(/^[A-Za-z0-9_-]{86}$/) });
    const rawPub = createPublicKey({ key: rfcSpkiDer, format: "der", type: "spki" });
    expect(cryptoVerify(null, byHand, rawPub, Buffer.from(env.sig, "base64url"))).toBe(true);
    // pinned regression vector (Ed25519 is deterministic): any change of the byte format changes this
    expect(env.sig).toBe(PINNED_CONFIG_SIG);
  });

  it("every typ has its own prefix and full name; a non-canonical text or a bad kid is never signed", () => {
    expect([...EDGE_SIGNED_TYPS]).toEqual(["auth", "config", "runpkg", "cmd", "keyset"]);
    for (const t of EDGE_SIGNED_TYPS) {
      expect(EDGE_TYP_NAME[t]).toBe(`avi-edge-${t}+v1`);
      expect(edgeSigningInput(t, "edk_AAAAAAAAAAAAAAAAAAAAAA", "{}").toString("utf8")).toBe(`avi-edge-v1\n${t}\nedk_AAAAAAAAAAAAAAAAAAAAAA\n{}`);
    }
    expect(() => edgeSigningInput("auth", "edk_AAAAAAAAAAAAAAAAAAAAAA", '{ "a":1}')).toThrow(EdgeCanonicalJsonError);
    expect(() => edgeSigningInput("auth", "edk_short\n", "{}")).toThrow(/kid/);
  });
});

/** Regression vector: the RFC 8032 TEST 1 key signing {b:[1,"two"],a:{y:false,x:null}} as typ config (computed once, pinned). */
const PINNED_CONFIG_SIG = "p9YjvXk2jxE8MPjvrzUheHZ3kbNvmo5gdyRNvSsLcNwfBPa4M8Vlj46L1Ne5YiQhRZLdn4XXv3stO3ChzBQqDA";

describe("verifyEdgeObject", () => {
  const key = generateEdgeSigningKey().key;
  const ks = storeWith(key);

  it("round trip through JSON transport (envelope keys reordered) verifies; parsed payload and kid come back", () => {
    const claims = authClaims(key.kid);
    const env = signEdgeObject("auth", claims, key);
    const wire = JSON.parse(JSON.stringify({ sig: env.sig, payload: env.payload, kid: env.kid, alg: env.alg, typ: env.typ }));
    const r = verifyEdgeObject(wire, "auth", ks);
    expect(r).toEqual({ ok: true, payload: claims, kid: key.kid });
  });

  it("★ tampering ANY claim field (top level and nested) ⇒ bad_signature", () => {
    const claims = authClaims(key.kid);
    const env = signEdgeObject("auth", claims, key);
    const mutate = (v: unknown): unknown =>
      typeof v === "number" ? v + 1 : typeof v === "string" ? v + "x" : typeof v === "boolean" ? !v : Array.isArray(v) ? [...v, 1] : v === null ? 0 : { ...(v as object), extra: 1 };
    const paths: string[][] = [];
    for (const [k, v] of Object.entries(claims)) {
      paths.push([k]);
      if (v && typeof v === "object" && !Array.isArray(v)) for (const k2 of Object.keys(v)) paths.push([k, k2]);
    }
    expect(paths.length).toBe(27); // 20 top-level + target 2 + approval 2 + verdicts 3
    for (const p of paths) {
      const t = withPayload(env, (o) => {
        let x = o as Record<string, unknown>;
        for (const k of p.slice(0, -1)) x = x[k] as Record<string, unknown>;
        x[p[p.length - 1]] = mutate(x[p[p.length - 1]]);
      });
      expect(verifyEdgeObject(t, "auth", ks), p.join(".")).toEqual({ ok: false, reason: "bad_signature" });
    }
    expect(verifyEdgeObject(withPayload(env, (o) => delete o.ttlMs), "auth", ks)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyEdgeObject(withPayload(env, (o) => (o.trusted = true)), "auth", ks)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("★ cross-typ confusion: a config (or cmd / runpkg / keyset) signature presented as auth is refused — relabelled or not", () => {
    for (const other of ["config", "runpkg", "cmd", "keyset"] as const) {
      const env = signEdgeObject(other, { ...authClaims(key.kid), typ: undefined }, key);
      expect(verifyEdgeObject(env, "auth", ks)).toEqual({ ok: false, reason: "wrong_typ" });
      const relabelled = { ...env, typ: EDGE_TYP_NAME.auth };
      expect(verifyEdgeObject(relabelled, "auth", ks)).toEqual({ ok: false, reason: "bad_signature" });
    }
  });

  it("★ alg none / other alg ⇒ bad_alg; empty / short / non-canonical / missing signature ⇒ malformed", () => {
    const env = signEdgeObject("auth", authClaims(key.kid), key);
    for (const alg of ["none", "NONE", "HS256", "ES256", "", null]) {
      expect(verifyEdgeObject({ ...env, alg }, "auth", ks), String(alg)).toEqual({ ok: false, reason: "bad_alg" });
    }
    const { alg: _drop, ...noAlg } = env;
    expect(verifyEdgeObject(noAlg, "auth", ks)).toEqual({ ok: false, reason: "bad_alg" });
    for (const sig of ["", "AA", env.sig.slice(0, 85), env.sig + "A", env.sig.slice(0, 85) + "=", Buffer.alloc(64).toString("base64"), null, 0]) {
      expect(verifyEdgeObject({ ...env, sig }, "auth", ks), String(sig)).toEqual({ ok: false, reason: "malformed" });
    }
    const { sig: _s, ...noSig } = env;
    expect(verifyEdgeObject(noSig, "auth", ks)).toEqual({ ok: false, reason: "malformed" });
    // a NON-canonical spelling of the SAME 64 bytes (the 4 unused low bits of the last char flipped) ⇒ malformed
    const B64U = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const alt = env.sig.slice(0, 85) + B64U[B64U.indexOf(env.sig[85]) ^ 1];
    expect(Buffer.from(alt, "base64url").equals(Buffer.from(env.sig, "base64url"))).toBe(true);
    expect(verifyEdgeObject({ ...env, sig: alt }, "auth", ks)).toEqual({ ok: false, reason: "malformed" });
    // an all-zero (well-formed) signature is just wrong
    expect(verifyEdgeObject({ ...env, sig: Buffer.alloc(64).toString("base64url") }, "auth", ks)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("unknown envelope keys, non-object input, an object payload ⇒ malformed; a payload text that is not canonical JSON ⇒ non_canonical", () => {
    const env = signEdgeObject("auth", authClaims(key.kid), key);
    expect(verifyEdgeObject({ ...env, x5u: "http://evil" }, "auth", ks)).toEqual({ ok: false, reason: "malformed" });
    for (const raw of [null, undefined, "x", 1, [], [env]]) expect(verifyEdgeObject(raw, "auth", ks)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyEdgeObject({ ...env, payload: JSON.parse(env.payload) }, "auth", ks)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyEdgeObject({ ...env, payload: "not json" }, "auth", ks)).toEqual({ ok: false, reason: "non_canonical" });
  });

  it("★ an attacker key under a VALID kid ⇒ bad_signature; an unknown kid ⇒ unknown_kid", () => {
    const attacker = generateEdgeSigningKey().key;
    const forged = signEdgeObject("auth", authClaims(key.kid), { ...attacker, kid: key.kid });
    expect(forged.kid).toBe(key.kid);
    expect(verifyEdgeObject(forged, "auth", ks)).toEqual({ ok: false, reason: "bad_signature" });
    const own = signEdgeObject("auth", authClaims(attacker.kid), attacker);
    expect(verifyEdgeObject(own, "auth", ks)).toEqual({ ok: false, reason: "unknown_kid" });
  });

  it("claim cross-check: a payload `kid` / `typ` that disagrees with the envelope ⇒ claim_mismatch", () => {
    const wrongKid = signEdgeObject("auth", { ...authClaims(key.kid), kid: "edk_BBBBBBBBBBBBBBBBBBBBBB" }, key);
    expect(verifyEdgeObject(wrongKid, "auth", ks)).toEqual({ ok: false, reason: "claim_mismatch" });
    const wrongTyp = signEdgeObject("auth", { ...authClaims(key.kid), typ: EDGE_TYP_NAME.cmd }, key);
    expect(verifyEdgeObject(wrongTyp, "auth", ks)).toEqual({ ok: false, reason: "claim_mismatch" });
  });

  it("key validity window (active / retired, ± skew, the STORE's clock) — outside ⇒ key_not_valid", () => {
    const root = generateEdgeSigningKey().key;
    const env = signEdgeObject("cmd", { kind: "stop" }, key);
    clock = T0;
    expect(verifyEdgeObject(env, "cmd", storeWith(root, [{ key, notBefore: T0 + 60_000 }]))).toEqual({ ok: false, reason: "key_not_valid" });
    expect(verifyEdgeObject(env, "cmd", storeWith(root, [{ key, notBefore: T0 + 4_000 }])).ok).toBe(true);
    expect(verifyEdgeObject(env, "cmd", storeWith(root, [{ key, status: "retired", notBefore: T0 - 100_000, notAfter: T0 - 10_000 }]))).toEqual({ ok: false, reason: "key_not_valid" });
    const inWindow = storeWith(root, [{ key, status: "retired", notBefore: T0 - 100_000, notAfter: T0 - 1_000 }]);
    expect(verifyEdgeObject(env, "cmd", inWindow).ok).toBe(true);
    clock = T0 + 10_000; // the store's own clock moves on: the same object is now outside the window
    expect(verifyEdgeObject(env, "cmd", inWindow)).toEqual({ ok: false, reason: "key_not_valid" });
    clock = T0;
  });

  it("signing refuses a payload without one JSON form, and a bad typ", () => {
    expect(() => signEdgeObject("auth", { n: NaN }, key)).toThrow(EdgeCanonicalJsonError);
    expect(() => signEdgeObject("bogus" as never, {}, key)).toThrow(/typ/);
  });
});

describe("keyset parse + chain (pinned root kept)", () => {
  const k1 = generateEdgeSigningKey().key;
  const k2 = generateEdgeSigningKey().key;
  const k3 = generateEdgeSigningKey().key;
  const pinnedKs = keysetOf({ key: k1 });
  const pinned = { kind: EDGE_PIN_KIND, keyset: pinnedKs };

  it("parseEdgeKeyset: strict shape; kid must be the fingerprint of its key; unique kids; ≥1 active; retired needs notAfter", () => {
    expect(parseEdgeKeyset(pinnedKs)).toEqual({ ok: true, keyset: pinnedKs });
    const bad = (ks: unknown) => parseEdgeKeyset(ks).ok;
    expect(bad({ ...pinnedKs, extra: 1 })).toBe(false);
    expect(bad({ ...pinnedKs, keys: [{ ...pinnedKs.keys[0], kid: k2.kid }] })).toBe(false);
    expect(bad({ ...pinnedKs, keys: [pinnedKs.keys[0], pinnedKs.keys[0]] })).toBe(false);
    expect(bad({ ...pinnedKs, keys: [{ ...pinnedKs.keys[0], status: "next" }] })).toBe(false);
    expect(bad({ ...pinnedKs, keys: [pinnedKs.keys[0], { ...entry({ key: k2 }), status: "retired", notAfter: null }] })).toBe(false);
    expect(bad({ ...pinnedKs, keys: [{ ...pinnedKs.keys[0], publicKeyPem: "-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n" }] })).toBe(false);
    expect(bad({ ...pinnedKs, keys: [{ ...pinnedKs.keys[0], trusted: true }] })).toBe(false);
    expect(bad({ ...pinnedKs, v: 2 })).toBe(false);
    expect(bad({ ...pinnedKs, keys: [] })).toBe(false);
    expect(pinOf(k1)).toEqual(pinned);
  });

  it("★ rotation: pin {k1} → v2 {k1,k2 active} by k1 → v3 {+k3 next} by k2 → v4 {k1,k3 active, k2 retired} by k2", () => {
    clock = T0;
    const v2: EdgeKeyset = { v: 1, version: 2, issuedAt: T0, keys: [entry({ key: k1 }), entry({ key: k2 })] };
    const v3: EdgeKeyset = { ...v2, version: 3, keys: [...v2.keys, entry({ key: k3, status: "next" })] };
    const v4: EdgeKeyset = { ...v2, version: 4, keys: [entry({ key: k1 }), entry({ key: k3 }), entry({ key: k2, status: "retired", notAfter: T0 + 30_000 })] };
    const u = [signEdgeObject("keyset", v2, k1), signEdgeObject("keyset", v3, k2)];
    const store = EdgeTrustStore.fromPinned(pinned, { nodeId: NODE, now: () => clock }, u);
    expect(store.version).toBe(3);
    expect(store.keyset()).toEqual(v3);
    expect(store.acceptedUpdates()).toEqual(u);
    // a next key never verifies
    expect(verifyEdgeObject(signEdgeObject("cmd", { kind: "stop" }, k3), "cmd", store)).toEqual({ ok: false, reason: "key_not_valid" });
    expect(store.acceptKeysetUpdate(signEdgeObject("keyset", v4, k2))).toEqual({ ok: true, version: 4, changed: true });
    expect(store.acceptKeysetUpdate(signEdgeObject("keyset", v4, k3))).toEqual({ ok: true, version: 4, changed: false }); // same keyset re-sent: no-op
    expect(verifyEdgeObject(signEdgeObject("auth", authClaims(k3.kid), k3), "auth", store).ok).toBe(true);
    expect(verifyEdgeObject(signEdgeObject("auth", authClaims(k2.kid), k2), "auth", store).ok).toBe(true); // retired, in window
    clock = T0 + 40_000;
    expect(verifyEdgeObject(signEdgeObject("auth", authClaims(k2.kid), k2), "auth", store)).toEqual({ ok: false, reason: "key_not_valid" });
    clock = T0;
    // restart: the persisted updates replay to the same state
    const again = EdgeTrustStore.fromPinned(pinned, { nodeId: NODE, now: () => clock }, store.acceptedUpdates());
    expect(again.keyset()).toEqual(v4);
  });

  it("chain refusals: unknown signer, rollback, invalid body, wrong typ; a refused update changes nothing", () => {
    clock = T0;
    const v2: EdgeKeyset = { v: 1, version: 2, issuedAt: T0, keys: [entry({ key: k1 }), entry({ key: k2 })] };
    const store = EdgeTrustStore.fromPinned({ ...pinned, keyset: { ...pinnedKs, version: 2 } }, { nodeId: NODE, now: () => clock }); // pinned at version 2
    expect(store.acceptKeysetUpdate(signEdgeObject("keyset", v2, k3))).toEqual({ ok: false, reason: "unknown_kid" });
    expect(store.acceptKeysetUpdate(signEdgeObject("keyset", { ...v2, version: 1 }, k1))).toEqual({ ok: false, reason: "rollback" }); // below the pin
    expect(store.acceptKeysetUpdate(signEdgeObject("keyset", { ...v2, keys: [] }, k1))).toEqual({ ok: false, reason: "invalid_keyset" });
    expect(store.acceptKeysetUpdate(signEdgeObject("config", v2, k1))).toEqual({ ok: false, reason: "wrong_typ" });
    expect(store.version).toBe(2);
    expect(store.acceptKeysetUpdate(signEdgeObject("keyset", { ...v2, version: 5 }, k1)).ok).toBe(true);
    expect(store.acceptKeysetUpdate(signEdgeObject("keyset", { ...v2, version: 4 }, k1))).toEqual({ ok: false, reason: "rollback" });
    expect(() => EdgeTrustStore.fromPinned(pinned, { nodeId: NODE, now: () => clock }, [signEdgeObject("keyset", v2, k3)])).toThrow(/refused/);
  });
});

describe("fix review 1 — the PIN: its version is a floor (I5); only the pin shape is an anchor (M3)", () => {
  const k1 = generateEdgeSigningKey().key;
  const kOld = generateEdgeSigningKey().key;
  const kNew = generateEdgeSigningKey().key;
  const root = (v: number) => edgePinnedKeyset([{ kid: k1.kid, publicKeyPem: k1.publicKeyPem, notBefore: T0 - 60_000 }], T0, v);

  it("★ I5: an edge provisioned at keyring version 5 refuses a captured, root-signed OLDER keyset (one that still trusted a since-retired key)", () => {
    clock = T0;
    const store = EdgeTrustStore.fromPinned(root(5), { nodeId: NODE, now: () => clock });
    expect(store.version).toBe(5);
    // version 3: root + kOld active — genuinely signed by the root back then; kOld has since been retired
    const captured: EdgeKeyset = { v: 1, version: 3, issuedAt: T0, keys: [entry({ key: k1 }), entry({ key: kOld })] };
    expect(store.acceptKeysetUpdate(signEdgeObject("keyset", captured, k1))).toEqual({ ok: false, reason: "rollback" });
    expect(verifyEdgeObject(signEdgeObject("cmd", { kind: "stop" }, kOld), "cmd", store)).toEqual({ ok: false, reason: "unknown_kid" });
    // so kOld can never sign a huge-version keyset that would make central's real keysets look like a rollback
    const hijack: EdgeKeyset = { v: 1, version: Number.MAX_SAFE_INTEGER, issuedAt: T0, keys: [entry({ key: k1 }), entry({ key: kOld })] };
    expect(store.acceptKeysetUpdate(signEdgeObject("keyset", hijack, kOld))).toEqual({ ok: false, reason: "unknown_kid" });
    expect(store.version).toBe(5);
  });

  it("★ I5: central's keyset AT the pin version is accepted once (the pin is its root-only projection); after that versions strictly increase", () => {
    clock = T0;
    const store = EdgeTrustStore.fromPinned(root(5), { nodeId: NODE, now: () => clock });
    const v5: EdgeKeyset = { v: 1, version: 5, issuedAt: T0, keys: [entry({ key: k1 }), entry({ key: kNew })] };
    expect(store.acceptKeysetUpdate(signEdgeObject("keyset", v5, k1))).toEqual({ ok: true, version: 5, changed: true });
    expect(store.acceptKeysetUpdate(signEdgeObject("keyset", v5, kNew))).toEqual({ ok: true, version: 5, changed: false }); // re-sent: no-op
    const v5b: EdgeKeyset = { ...v5, keys: [entry({ key: k1 })] };
    expect(store.acceptKeysetUpdate(signEdgeObject("keyset", v5b, k1))).toEqual({ ok: false, reason: "rollback" }); // same version, other content
    expect(store.acceptKeysetUpdate(signEdgeObject("keyset", { ...v5, version: 6 }, kNew))).toEqual({ ok: true, version: 6, changed: true });
    // restart: the persisted updates replay from the pin
    const again = EdgeTrustStore.fromPinned(root(5), { nodeId: NODE, now: () => clock }, store.acceptedUpdates());
    expect(again.version).toBe(6);
    // a pin at version 7 refuses that history (the persisted updates are older than the pin)
    expect(() => EdgeTrustStore.fromPinned(root(7), { nodeId: NODE, now: () => clock }, store.acceptedUpdates())).toThrow(/rollback/);
  });

  it("★ M3: fromPinned accepts ONLY the pin shape — a bare keyset (e.g. lifted from a message), extra keys, a next / time-limited key, non-plain data are refused", () => {
    const ok = root(1);
    expect(parseEdgeKeysetPin(ok)).toEqual({ ok: true, pin: ok });
    const refuse = (x: unknown) => expect(() => EdgeTrustStore.fromPinned(x, { nodeId: NODE }), JSON.stringify(x)?.slice(0, 80)).toThrow(EdgeTrustError);
    refuse(ok.keyset); // a bare keyset is never an anchor
    refuse({ ...ok, extra: 1 });
    refuse({ ...ok, kind: "avi-edge-keyset" });
    refuse({ ...ok, keyset: { ...ok.keyset, keys: [{ ...ok.keyset.keys[0], status: "next" }] } });
    refuse({ ...ok, keyset: { ...ok.keyset, keys: [{ ...ok.keyset.keys[0], notAfter: T0 + 1 }] } });
    refuse(Object.assign(new (class Pin {})(), ok));
    refuse(JSON.stringify(ok));
    refuse(null);
    const getter = { kind: EDGE_PIN_KIND, get keyset() { return ok.keyset; } };
    expect(parseEdgeKeysetPin(getter).ok).toBe(true); // a getter is read once into plain data — never a live object
    expect(() => EdgeTrustStore.fromPinned(ok, { nodeId: 0 })).toThrow(EdgeTrustError);
  });

  it("M3: fromPinFile reads the pin file written at provisioning; a missing / non-JSON file is refused", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "edge-pin-"));
    try {
      const file = path.join(dir, "edge-keyset.json");
      writeFileSync(file, JSON.stringify(root(4), null, 2));
      expect(EdgeTrustStore.fromPinFile(file, { nodeId: NODE }).version).toBe(4);
      expect(() => EdgeTrustStore.fromPinFile(path.join(dir, "none.json"), { nodeId: NODE })).toThrow(/pin file/);
      writeFileSync(path.join(dir, "bad.json"), "{");
      expect(() => EdgeTrustStore.fromPinFile(path.join(dir, "bad.json"), { nodeId: NODE })).toThrow(/pin file/);
      writeFileSync(path.join(dir, "bare.json"), JSON.stringify(root(4).keyset));
      expect(() => EdgeTrustStore.fromPinFile(path.join(dir, "bare.json"), { nodeId: NODE })).toThrow(/pinned keyset refused/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("fix review 1 (M5) — pruning the keyring at its cap never removes the root or an active / next key", () => {
  const H = 3_600_000;
  const gen = () => generateEdgeSigningKey().key;
  const e = (k: EdgeSigningKey, status: "active" | "next" | "retired", rootFlag = false, retiredAt: number | null = null) => ({ kid: k.kid, publicKeyPem: k.publicKeyPem, status, notBefore: T0 - 100 * H, retiredAt, root: rootFlag });
  it("drops the OLDEST retired keys past the age bound, just enough for the room asked; refuses when not enough", () => {
    const rootK = gen();
    const active = gen();
    const next = gen();
    const retired = Array.from({ length: 13 }, (_, i) => e(gen(), "retired", false, T0 - (50 - i) * H)); // retired 50 h … 38 h ago
    const kr = { v: 1 as const, version: 20, updatedAt: T0, keys: [e(rootK, "active", true), e(active, "active"), e(next, "next"), ...retired] };
    expect(kr.keys).toHaveLength(EDGE_KEYRING_MAX_KEYS);
    const r = pruneEdgeKeyring(kr, { nowMs: T0, room: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pruned).toEqual([retired[0].kid]); // the oldest retired only
    expect(r.keyring.keys).toHaveLength(EDGE_KEYRING_MAX_KEYS - 1);
    expect(r.keyring.keys.some((k) => k.root)).toBe(true);
    expect(r.keyring.keys.filter((k) => k.status !== "retired").map((k) => k.kid).sort()).toEqual([rootK.kid, active.kid, next.kid].sort());
    // below the cap: nothing to do
    expect(pruneEdgeKeyring(r.keyring, { nowMs: T0, room: 1 })).toEqual({ ok: true, keyring: r.keyring, pruned: [] });
    // retired too recently (age bound 24 h by default) ⇒ refused, nothing dropped
    const fresh = { ...kr, keys: [e(rootK, "active", true), e(active, "active"), e(next, "next"), ...retired.map((k) => ({ ...k, retiredAt: T0 - H }))] };
    expect(pruneEdgeKeyring(fresh, { nowMs: T0, room: 1 })).toMatchObject({ ok: false });
    // a keyring of only non-retired keys at the cap is never pruned
    const allLive = { ...kr, keys: [e(rootK, "active", true), ...Array.from({ length: 15 }, () => e(gen(), "active"))] };
    expect(pruneEdgeKeyring(allLive, { nowMs: T0, room: 1 })).toMatchObject({ ok: false });
  });
});

describe("central keyring FILES — the only source of the published keyset and the pin (R-10-c)", () => {
  const k1 = generateEdgeSigningKey();
  const k2 = generateEdgeSigningKey();
  const k3 = generateEdgeSigningKey();
  const ent = (g: { key: EdgeSigningKey }, status: "next" | "active" | "retired", root = false, retiredAt: number | null = null) => ({
    kid: g.key.kid, publicKeyPem: g.key.publicKeyPem, status, notBefore: T0 - 100_000, retiredAt, root,
  });
  function ring(keys: ReturnType<typeof ent>[], files: Array<{ key: EdgeSigningKey; privateKeyPem: string }>, version = 3): string {
    const dir = mkdtempSync(path.join(tmpdir(), "edge-keyring-"));
    for (const g of files) writeFileSync(path.join(dir, `${g.key.kid}.pem`), g.privateKeyPem, { mode: 0o600 });
    writeEdgeKeyring(dir, { v: 1, version, updatedAt: T0, keys });
    return dir;
  }
  const dirs: string[] = [];
  const mk = (...a: Parameters<typeof ring>) => {
    const d = ring(...a);
    dirs.push(d);
    return d;
  };
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it("reads a consistent keyring; the published keyset is a pure function of it (one version ⇒ byte-identical keyset)", () => {
    const dir = mk([ent(k1, "active", true), ent(k2, "active"), ent(k3, "next")], [k1, k2, k3]);
    const kr = readEdgeKeyring(dir);
    expect(kr.keys.map((k) => k.kid)).toEqual([k1.key.kid, k2.key.kid, k3.key.kid]);
    const a = buildEdgeKeysetFromKeyring(kr, k2.key, { retiredGraceMs: 40_000 });
    const b = buildEdgeKeysetFromKeyring(readEdgeKeyring(dir), k2.key, { retiredGraceMs: 40_000 });
    expect(edgeCanonicalJson(a)).toBe(edgeCanonicalJson(b));
    expect(a.version).toBe(3);
    expect(a.keys.find((k) => k.kid === k3.key.kid)?.status).toBe("next");
    // an edge pinned on the root accepts the chain root → (keyset signed by the root) → (keyset signed by k2)
    clock = T0;
    const pin = edgePinFromKeyring(kr);
    expect(pin.keyset.keys.map((k) => k.kid)).toEqual([k1.key.kid]);
    expect(pin.keyset.version).toBe(kr.version); // I5: the pin records the keyring version at provisioning
    const store = EdgeTrustStore.fromPinned(pin, { nodeId: NODE, now: () => clock });
    expect(store.acceptKeysetUpdate(signEdgeObject("keyset", buildEdgeKeysetFromKeyring(kr, k1.key, { retiredGraceMs: 40_000 }), k1.key))).toMatchObject({ ok: true, changed: true });
    expect(store.acceptKeysetUpdate(signEdgeObject("keyset", a, k2.key))).toMatchObject({ ok: true, changed: false }); // same version, same bytes
  });

  it("retired keys stay with notAfter = retiredAt + grace; the signer must be ACTIVE in the keyring", () => {
    const dir = mk([ent(k1, "active", true), ent(k2, "retired", false, T0 - 5_000), ent(k3, "active")], [k1, k3]); // a retired key's file may be gone
    const kr = readEdgeKeyring(dir);
    const ks = buildEdgeKeysetFromKeyring(kr, k3.key, { retiredGraceMs: 40_000 });
    expect(ks.keys.find((k) => k.kid === k2.key.kid)).toMatchObject({ status: "retired", notAfter: T0 + 35_000 });
    expect(() => buildEdgeKeysetFromKeyring(kr, k2.key, { retiredGraceMs: 40_000 })).toThrow(/not an ACTIVE key/);
    const stranger = generateEdgeSigningKey().key;
    expect(() => buildEdgeKeysetFromKeyring(kr, stranger, { retiredGraceMs: 40_000 })).toThrow(/not an ACTIVE key/);
  });

  it("★ refuses an inconsistent keyring: no key file / a file of another key / two roots / a retired root / kid ≠ fingerprint / retiredAt mismatch", () => {
    expect(() => readEdgeKeyring(mk([ent(k1, "active", true), ent(k2, "next")], [k1]))).toThrow(/k[^ ]*\.pem|does not hold/);
    const swapped = mk([ent(k1, "active", true)], []);
    writeFileSync(path.join(swapped, `${k1.key.kid}.pem`), k2.privateKeyPem, { mode: 0o600 });
    expect(() => readEdgeKeyring(swapped)).toThrow(/does not hold/);
    expect(() => readEdgeKeyring(mk([ent(k1, "active", true), ent(k2, "active", true)], [k1, k2]))).toThrow(/exactly one root/);
    expect(() => readEdgeKeyring(mk([ent(k1, "retired", true, T0)], [k1]))).toThrow(/root/);
    expect(() => readEdgeKeyring(mk([ent(k1, "active", true), { ...ent(k2, "next"), kid: k3.key.kid }], [k1, k2, k3]))).toThrow(/fingerprint/);
    expect(() => readEdgeKeyring(mk([ent(k1, "active", true), ent(k2, "retired", false, null)], [k1]))).toThrow(/retiredAt/);
    expect(() => readEdgeKeyring(mkdtempSync(path.join(tmpdir(), "edge-keyring-empty-")))).toThrow(/missing/);
  });
});

describe("loadEdgeSigningKey (central custody: env PEM or a 0600 file, never the DB)", () => {
  const gen = generateEdgeSigningKey();

  it("EDGE_SIGNING_KEY_PEM (also with literal \\n) or EDGE_SIGNING_KEY_FILE; none ⇒ null", () => {
    expect(loadEdgeSigningKey({})).toBeNull();
    expect(loadEdgeSigningKey({ EDGE_SIGNING_KEY_PEM: gen.privateKeyPem })?.kid).toBe(gen.key.kid);
    expect(loadEdgeSigningKey({ EDGE_SIGNING_KEY_PEM: gen.privateKeyPem.replace(/\n/g, "\\n") })?.kid).toBe(gen.key.kid);
    const dir = mkdtempSync(path.join(tmpdir(), "edge-key-"));
    try {
      const f = path.join(dir, "k.pem");
      writeFileSync(f, gen.privateKeyPem, { mode: 0o600 });
      expect(loadEdgeSigningKey({ EDGE_SIGNING_KEY_FILE: f })?.kid).toBe(gen.key.kid);
      if (process.platform !== "win32") {
        chmodSync(f, 0o644);
        expect(() => loadEdgeSigningKey({ EDGE_SIGNING_KEY_FILE: f })).toThrow(/0600|permission/i);
      }
      expect(() => loadEdgeSigningKey({ EDGE_SIGNING_KEY_FILE: path.join(dir, "missing.pem") })).toThrow();
      expect(() => loadEdgeSigningKey({ EDGE_SIGNING_KEY_PEM: "not a key" })).toThrow();
      expect(() => loadEdgeSigningKey({ EDGE_SIGNING_KEY_PEM: gen.privateKeyPem, EDGE_SIGNING_KEY_FILE: f })).toThrow(/both/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
