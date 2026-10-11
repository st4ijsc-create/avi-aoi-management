/**
 * doc 81 Đợt 10 task A — edgeSigning (design §2.13): Ed25519 over canonical JSON with the domain prefix
 * "avi-edge-v1\n" + typ + "\n", typ ∈ {auth, config, runpkg, cmd, keyset}; kid handling; keyset chain; key endorsement.
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
import { describe, expect, it } from "vitest";
import {
  EDGE_SIGNED_TYPS,
  EDGE_TYP_NAME,
  EdgeCanonicalJsonError,
  buildEdgeKeyset,
  edgeCanonicalJson,
  edgeKidOf,
  edgeSigningInput,
  edgeSigningKeyFromPem,
  endorseEdgeKey,
  generateEdgeSigningKey,
  loadEdgeSigningKey,
  parseEdgeKeyset,
  signEdgeObject,
  verifyEdgeKeyEndorsement,
  verifyEdgeKeysetChain,
  verifyEdgeKeysetUpdate,
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

function keysetOf(...keys: Array<{ key: EdgeSigningKey; status?: "next" | "active" | "retired"; notBefore?: number; notAfter?: number | null }>): EdgeKeyset {
  return {
    v: 1,
    version: 1,
    issuedAt: T0,
    keys: keys.map((k) => ({ kid: k.key.kid, publicKeyPem: k.key.publicKeyPem, status: k.status ?? "active", notBefore: k.notBefore ?? T0 - 60_000, notAfter: k.notAfter ?? null })),
  };
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
    expect(edgeCanonicalJson({ z: -0, y: undefined, x: true, w: "é \"" })).toBe('{"w":"é\\u2028\\"","x":true,"z":0}'.replace("\\u2028", " "));
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

  it("an own '__proto__' key (as JSON.parse produces it) is serialised as data, never as a prototype", () => {
    const parsed = JSON.parse('{"__proto__":{"x":1},"a":2}');
    expect(edgeCanonicalJson(parsed)).toBe('{"__proto__":{"x":1},"a":2}');
  });
});

describe("signing input + test vector (domain separation)", () => {
  it("the exact bytes: 'avi-edge-v1\\n' + typ + '\\n' + canonical({kid,payload}) — verified with node:crypto directly", () => {
    const key = edgeSigningKeyFromPem(rfcPrivatePem);
    const payload = { b: [1, "two"], a: { y: false, x: null } };
    const byHand = Buffer.from(`avi-edge-v1\nconfig\n{"kid":"${rfcKidByHand}","payload":{"a":{"x":null,"y":false},"b":[1,"two"]}}`, "utf8");
    expect(edgeSigningInput("config", key.kid, payload).equals(byHand)).toBe(true);
    const env = signEdgeObject("config", payload, key);
    expect(env).toEqual({ typ: "avi-edge-config+v1", alg: "EdDSA", kid: rfcKidByHand, payload, sig: expect.stringMatching(/^[A-Za-z0-9_-]{86}$/) });
    const rawPub = createPublicKey({ key: rfcSpkiDer, format: "der", type: "spki" });
    expect(cryptoVerify(null, byHand, rawPub, Buffer.from(env.sig, "base64url"))).toBe(true);
    // pinned regression vector (Ed25519 is deterministic): any change of the byte format changes this
    expect(env.sig).toBe(PINNED_CONFIG_SIG);
  });

  it("every typ has its own prefix and full name", () => {
    expect([...EDGE_SIGNED_TYPS]).toEqual(["auth", "config", "runpkg", "cmd", "keyset"]);
    for (const t of EDGE_SIGNED_TYPS) {
      expect(EDGE_TYP_NAME[t]).toBe(`avi-edge-${t}+v1`);
      expect(edgeSigningInput(t, "edk_AAAAAAAAAAAAAAAAAAAAAA", {}).toString("utf8").startsWith(`avi-edge-v1\n${t}\n`)).toBe(true);
    }
  });
});

/** Regression vector: the RFC 8032 TEST 1 key signing {b:[1,"two"],a:{y:false,x:null}} as typ config (computed once, pinned). */
const PINNED_CONFIG_SIG = "8aT0d9Ltt2Ok2N-vZMTgFkNJKWiikZf1kjcGQ_sXOqBMWux5-Pu9OLXpl3QDeqWOQhan_0Zqw7Hu_az56oPBBA";

describe("verifyEdgeObject", () => {
  const key = generateEdgeSigningKey().key;
  const ks = keysetOf({ key });

  it("round trip through JSON transport (keys reordered) verifies; payload and kid come back", () => {
    const claims = authClaims(key.kid);
    const env = signEdgeObject("auth", claims, key);
    const wire = JSON.parse(JSON.stringify({ sig: env.sig, payload: { ...claims }, kid: env.kid, alg: env.alg, typ: env.typ }));
    const r = verifyEdgeObject(wire, "auth", ks, { nowMs: T0 });
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
      const t = JSON.parse(JSON.stringify(env));
      let o = t.payload;
      for (const k of p.slice(0, -1)) o = o[k];
      o[p[p.length - 1]] = mutate(o[p[p.length - 1]]);
      const r = verifyEdgeObject(t, "auth", ks, { nowMs: T0 });
      expect(r, p.join(".")).toEqual({ ok: false, reason: "bad_signature" });
    }
    // removing a field / adding one
    const removed = JSON.parse(JSON.stringify(env));
    delete removed.payload.ttlMs;
    expect(verifyEdgeObject(removed, "auth", ks, { nowMs: T0 })).toEqual({ ok: false, reason: "bad_signature" });
    const added = JSON.parse(JSON.stringify(env));
    added.payload.trusted = true;
    expect(verifyEdgeObject(added, "auth", ks, { nowMs: T0 })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("★ cross-typ confusion: a config (or cmd / runpkg / keyset) signature presented as auth is refused — relabelled or not", () => {
    for (const other of ["config", "runpkg", "cmd", "keyset"] as const) {
      const env = signEdgeObject(other, authClaims(key.kid), key);
      expect(verifyEdgeObject(env, "auth", ks, { nowMs: T0 })).toEqual({ ok: false, reason: "wrong_typ" });
      const relabelled = { ...env, typ: EDGE_TYP_NAME.auth };
      expect(verifyEdgeObject(relabelled, "auth", ks, { nowMs: T0 })).toEqual({ ok: false, reason: "bad_signature" });
    }
  });

  it("★ alg none / other alg ⇒ bad_alg; empty / short / non-canonical / missing signature ⇒ malformed", () => {
    const env = signEdgeObject("auth", authClaims(key.kid), key);
    for (const alg of ["none", "NONE", "HS256", "ES256", "", null]) {
      expect(verifyEdgeObject({ ...env, alg }, "auth", ks, { nowMs: T0 }), String(alg)).toEqual({ ok: false, reason: "bad_alg" });
    }
    const { alg: _drop, ...noAlg } = env;
    expect(verifyEdgeObject(noAlg, "auth", ks, { nowMs: T0 })).toEqual({ ok: false, reason: "bad_alg" });
    for (const sig of ["", "AA", env.sig.slice(0, 85), env.sig + "A", env.sig.slice(0, 85) + "=", Buffer.alloc(64).toString("base64"), null, 0]) {
      expect(verifyEdgeObject({ ...env, sig }, "auth", ks, { nowMs: T0 }), String(sig)).toEqual({ ok: false, reason: "malformed" });
    }
    const { sig: _s, ...noSig } = env;
    expect(verifyEdgeObject(noSig, "auth", ks, { nowMs: T0 })).toEqual({ ok: false, reason: "malformed" });
    // a NON-canonical spelling of the SAME 64 bytes (the 4 unused low bits of the last char flipped) ⇒ malformed
    const B64U = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const alt = env.sig.slice(0, 85) + B64U[B64U.indexOf(env.sig[85]) ^ 1];
    expect(Buffer.from(alt, "base64url").equals(Buffer.from(env.sig, "base64url"))).toBe(true);
    expect(verifyEdgeObject({ ...env, sig: alt }, "auth", ks, { nowMs: T0 })).toEqual({ ok: false, reason: "malformed" });
    // an all-zero (well-formed) signature is just wrong
    expect(verifyEdgeObject({ ...env, sig: Buffer.alloc(64).toString("base64url") }, "auth", ks, { nowMs: T0 })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("unknown envelope keys, non-object input, a payload without one JSON form ⇒ malformed", () => {
    const env = signEdgeObject("auth", authClaims(key.kid), key);
    expect(verifyEdgeObject({ ...env, x5u: "http://evil" }, "auth", ks, { nowMs: T0 })).toEqual({ ok: false, reason: "malformed" });
    for (const raw of [null, undefined, "x", 1, [], [env]]) expect(verifyEdgeObject(raw, "auth", ks, { nowMs: T0 })).toEqual({ ok: false, reason: "malformed" });
    expect(verifyEdgeObject({ ...env, payload: { n: Infinity } }, "auth", ks, { nowMs: T0 })).toEqual({ ok: false, reason: "malformed" });
  });

  it("★ an attacker key under a VALID kid ⇒ bad_signature; an unknown kid ⇒ unknown_kid", () => {
    const attacker = generateEdgeSigningKey().key;
    const forged = signEdgeObject("auth", authClaims(key.kid), { ...attacker, kid: key.kid });
    expect(forged.kid).toBe(key.kid);
    expect(verifyEdgeObject(forged, "auth", ks, { nowMs: T0 })).toEqual({ ok: false, reason: "bad_signature" });
    const own = signEdgeObject("auth", authClaims(attacker.kid), attacker);
    expect(verifyEdgeObject(own, "auth", ks, { nowMs: T0 })).toEqual({ ok: false, reason: "unknown_kid" });
  });

  it("claim cross-check: a payload `kid` / `typ` that disagrees with the envelope ⇒ claim_mismatch", () => {
    const wrongKid = signEdgeObject("auth", { ...authClaims(key.kid), kid: "edk_BBBBBBBBBBBBBBBBBBBBBB" }, key);
    expect(verifyEdgeObject(wrongKid, "auth", ks, { nowMs: T0 })).toEqual({ ok: false, reason: "claim_mismatch" });
    const wrongTyp = signEdgeObject("auth", { ...authClaims(key.kid), typ: EDGE_TYP_NAME.cmd }, key);
    expect(verifyEdgeObject(wrongTyp, "auth", ks, { nowMs: T0 })).toEqual({ ok: false, reason: "claim_mismatch" });
  });

  it("key validity window: before notBefore / after notAfter (± skew) ⇒ key_not_valid; status alone does not decide", () => {
    const env = signEdgeObject("cmd", { kind: "stop" }, key);
    const future = keysetOf({ key, status: "next", notBefore: T0 + 60_000 });
    expect(verifyEdgeObject(env, "cmd", future, { nowMs: T0, skewMs: 5_000 })).toEqual({ ok: false, reason: "key_not_valid" });
    expect(verifyEdgeObject(env, "cmd", keysetOf({ key, status: "next", notBefore: T0 + 4_000 }), { nowMs: T0, skewMs: 5_000 }).ok).toBe(true);
    const retired = keysetOf({ key, status: "retired", notBefore: T0 - 100_000, notAfter: T0 - 10_000 });
    expect(verifyEdgeObject(env, "cmd", retired, { nowMs: T0, skewMs: 5_000 })).toEqual({ ok: false, reason: "key_not_valid" });
    expect(verifyEdgeObject(env, "cmd", keysetOf({ key, status: "retired", notBefore: T0 - 100_000, notAfter: T0 - 1_000 }), { nowMs: T0, skewMs: 5_000 }).ok).toBe(true);
  });

  it("signing refuses a payload without one JSON form, and a bad typ", () => {
    expect(() => signEdgeObject("auth", { n: NaN }, key)).toThrow(EdgeCanonicalJsonError);
    expect(() => signEdgeObject("bogus" as never, {}, key)).toThrow(/typ/);
  });
});

describe("keyset parse + chain", () => {
  const k1 = generateEdgeSigningKey().key;
  const k2 = generateEdgeSigningKey().key;
  const k3 = generateEdgeSigningKey().key;
  const pinned = keysetOf({ key: k1 });

  it("parseEdgeKeyset: strict shape; kid must be the fingerprint of its key; unique kids; ≥1 active; retired needs notAfter", () => {
    expect(parseEdgeKeyset(pinned)).toEqual({ ok: true, keyset: pinned });
    const bad = (ks: unknown) => parseEdgeKeyset(ks).ok;
    expect(bad({ ...pinned, extra: 1 })).toBe(false);
    expect(bad({ ...pinned, keys: [{ ...pinned.keys[0], kid: k2.kid }] })).toBe(false);
    expect(bad({ ...pinned, keys: [pinned.keys[0], pinned.keys[0]] })).toBe(false);
    expect(bad({ ...pinned, keys: [{ ...pinned.keys[0], status: "next" }] })).toBe(false);
    expect(bad({ ...pinned, keys: [pinned.keys[0], { ...keysetOf({ key: k2 }).keys[0], status: "retired", notAfter: null }] })).toBe(false);
    expect(bad({ ...pinned, keys: [{ ...pinned.keys[0], publicKeyPem: "-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n" }] })).toBe(false);
    expect(bad({ ...pinned, keys: [{ ...pinned.keys[0], trusted: true }] })).toBe(false);
    expect(bad({ ...pinned, v: 2 })).toBe(false);
    expect(bad({ ...pinned, keys: [] })).toBe(false);
  });

  it("★ chain: pinned {k1} → v2 {k1 retired, k2 active} signed by k1 → v3 {k2, k3 next} signed by k2 ⇒ ok; then k3 verifies", () => {
    const v2: EdgeKeyset = { v: 1, version: 2, issuedAt: T0, keys: [{ ...pinned.keys[0], status: "retired", notAfter: T0 + 30_000 }, keysetOf({ key: k2 }).keys[0]] };
    const v3: EdgeKeyset = { v: 1, version: 3, issuedAt: T0, keys: [keysetOf({ key: k2 }).keys[0], { ...keysetOf({ key: k3 }).keys[0], status: "next" }] };
    const u2 = signEdgeObject("keyset", v2, k1);
    const u3 = signEdgeObject("keyset", v3, k2);
    const r = verifyEdgeKeysetChain(pinned, [u2, u3], { nowMs: T0 });
    expect(r).toEqual({ ok: true, keyset: v3 });
    if (!r.ok) return;
    expect(verifyEdgeObject(signEdgeObject("auth", authClaims(k3.kid), k3), "auth", r.keyset, { nowMs: T0 }).ok).toBe(true);
    expect(verifyEdgeObject(signEdgeObject("auth", authClaims(k1.kid), k1), "auth", r.keyset, { nowMs: T0 })).toEqual({ ok: false, reason: "unknown_kid" });
  });

  it("★ chain refusals: unknown signer, rollback / same version, signed by a RETIRED key, invalid keyset body, wrong typ", () => {
    const v2: EdgeKeyset = { v: 1, version: 2, issuedAt: T0, keys: [keysetOf({ key: k2 }).keys[0]] };
    expect(verifyEdgeKeysetUpdate(pinned, signEdgeObject("keyset", v2, k3), { nowMs: T0 })).toEqual({ ok: false, reason: "unknown_kid" });
    expect(verifyEdgeKeysetUpdate(pinned, signEdgeObject("keyset", { ...v2, version: 1 }, k1), { nowMs: T0 })).toEqual({ ok: false, reason: "rollback" });
    expect(verifyEdgeKeysetUpdate({ ...pinned, version: 5 }, signEdgeObject("keyset", { ...v2, version: 4 }, k1), { nowMs: T0 })).toEqual({ ok: false, reason: "rollback" });
    const retiredTrust: EdgeKeyset = { v: 1, version: 1, issuedAt: T0, keys: [keysetOf({ key: k2 }).keys[0], { ...pinned.keys[0], status: "retired", notAfter: T0 + 30_000 }] };
    expect(verifyEdgeKeysetUpdate(retiredTrust, signEdgeObject("keyset", { ...v2, version: 2 }, k1), { nowMs: T0 })).toEqual({ ok: false, reason: "key_not_valid" });
    expect(verifyEdgeKeysetUpdate(pinned, signEdgeObject("keyset", { ...v2, keys: [] }, k1), { nowMs: T0 })).toEqual({ ok: false, reason: "invalid_keyset" });
    expect(verifyEdgeKeysetUpdate(pinned, signEdgeObject("config", v2, k1), { nowMs: T0 })).toEqual({ ok: false, reason: "wrong_typ" });
    // a broken link stops the chain: nothing after it is applied
    const r = verifyEdgeKeysetChain(pinned, [signEdgeObject("keyset", v2, k3), signEdgeObject("keyset", { ...v2, version: 3 }, k2)], { nowMs: T0 });
    expect(r).toEqual({ ok: false, reason: "unknown_kid", index: 0 });
  });
});

describe("key endorsement + buildEdgeKeyset (a DB writer alone can never add a trusted key)", () => {
  const k1 = generateEdgeSigningKey().key;
  const k2 = generateEdgeSigningKey().key;
  const k3 = generateEdgeSigningKey().key;
  const att = generateEdgeSigningKey().key;
  const att2 = generateEdgeSigningKey().key;
  const row =(k: EdgeSigningKey, status: "next" | "active" | "retired", by: EdgeSigningKey | null, extra: Partial<{ retiredAt: number }> = {}) => {
    const base = { kid: k.kid, publicKeyPem: k.publicKeyPem, status, notBefore: T0 - 100_000, retiredAt: extra.retiredAt ?? null };
    return { ...base, endorsedByKid: by ? by.kid : null, endorsementSig: by ? endorseEdgeKey(by, base) : null };
  };

  it("endorsement verifies only for the endorser's key and the exact row (kid, key, notBefore)", () => {
    const r = row(k2, "next", k1);
    expect(verifyEdgeKeyEndorsement(r, k1.publicKeyPem)).toBe(true);
    expect(verifyEdgeKeyEndorsement(r, att.publicKeyPem)).toBe(false);
    expect(verifyEdgeKeyEndorsement({ ...r, notBefore: r.notBefore + 1 }, k1.publicKeyPem)).toBe(false);
    expect(verifyEdgeKeyEndorsement({ ...r, publicKeyPem: att.publicKeyPem }, k1.publicKeyPem)).toBe(false);
    expect(verifyEdgeKeyEndorsement({ ...r, endorsementSig: null }, k1.publicKeyPem)).toBe(false);
  });

  it("★ the keyset holds the signer, its endorsed descendants and its endorsing ancestors — never an unendorsed / self-endorsed / mis-fingerprinted row", () => {
    const rows = [
      row(k1, "retired", null, { retiredAt: T0 - 5_000 }), // genesis, retired 5 s ago
      row(k2, "active", k1), // the loaded signer
      row(k3, "next", k2),
      row(att, "next", null), // a DB writer's row
      row(att, "next", att), // self-endorsed
      { ...row(k3, "next", k2), kid: att.kid }, // k3's endorsement under the attacker's kid
      { ...row(att2, "next", att2), endorsedByKid: k2.kid }, // claims the signer as endorser, signed by itself
    ];
    const ks = buildEdgeKeyset(rows, k2, { version: 7, nowMs: T0, retiredGraceMs: 40_000 });
    expect(ks.version).toBe(7);
    const byKid = (a: unknown[], b: unknown[]) => (String(a[0]) < String(b[0]) ? -1 : 1);
    expect(ks.keys.map((k) => [k.kid, k.status, k.notAfter]).sort(byKid)).toEqual(
      [
        [k1.kid, "retired", T0 + 35_000],
        [k2.kid, "active", null],
        [k3.kid, "next", null],
      ].sort(byKid),
    );
    expect(parseEdgeKeyset(ks).ok).toBe(true);
  });

  it("an ancestor is included only through a VERIFIED endorsement of the signer's row (a forged parent link is ignored)", () => {
    const signerRow = { ...row(k2, "active", null), endorsedByKid: att.kid, endorsementSig: endorseEdgeKey(k1, row(k2, "active", null)) };
    const ks = buildEdgeKeyset([signerRow, row(att, "retired", null, { retiredAt: T0 })], k2, { version: 1, nowMs: T0, retiredGraceMs: 40_000 });
    expect(ks.keys.map((k) => k.kid)).toEqual([k2.kid]);
  });

  it("a retired key past its grace is dropped; the loaded signer is always present and active even if the DB says otherwise", () => {
    const rows = [row(k1, "retired", null, { retiredAt: T0 - 50_000 }), row(k2, "retired", k1, { retiredAt: T0 - 50_000 })];
    const ks = buildEdgeKeyset(rows, k2, { version: 1, nowMs: T0, retiredGraceMs: 40_000 });
    expect(ks.keys.map((k) => [k.kid, k.status])).toEqual([[k2.kid, "active"]]);
    expect(buildEdgeKeyset([], k2, { version: 1, nowMs: T0, retiredGraceMs: 40_000 }).keys.map((k) => k.kid)).toEqual([k2.kid]);
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
