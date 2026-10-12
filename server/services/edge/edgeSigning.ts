/**
 * doc 81 Đợt 10 task A (design §2.13) — Ed25519 signing of everything central hands the edge that the edge must trust:
 * per-step authorisations (`auth`), the config snapshot (`config`), the run package / sweep picture (`runpkg`), central's
 * commands (`cmd`) and keyset updates (`keyset`).
 *
 * WIRE FORM (EdgeSignedEnvelope, strict — unknown keys refused):
 *   { typ: "avi-edge-<typ>+v1", alg: "EdDSA", kid: "edk_<22 b64url>", payload: "<CANONICAL JSON TEXT>", sig: <86 b64url> }
 *   The payload travels as its canonical JSON TEXT (fix scan, ruling R-10-a): the verifier refuses a payload text that is
 *   not exactly edgeCanonicalJson(JSON.parse(text)) — so duplicate keys, whitespace, another key order, "1.0" / "1e2" /
 *   "A" spellings, precision-losing numbers and prototype keys can never verify: ONE accepted encoding per value.
 * SIGNED BYTES (edgeSigningInput):
 *   "avi-edge-v1\n" + <typ> + "\n" + <kid> + "\n" + <payload text>
 *   — the domain prefix carries the SHORT typ, so a config / command / keyset signature can never be passed off as an
 *     authorisation (and relabelling the envelope's `typ` breaks the signature); `kid` (fixed charset, no newline) is signed.
 * CANONICAL JSON (edgeCanonicalJson): keys sorted (UTF-16 order) at every depth, arrays in order, no whitespace, -0 → 0,
 *   undefined object members dropped; NaN / ±Infinity / bigint / Date / Map / Buffer / functions / undefined in an array /
 *   the keys "__proto__" / "constructor" / "prototype" / nesting deeper than 64 are REFUSED.
 * KID = "edk_" + first 22 base64url chars of sha256(SPKI DER) — a fingerprint: a keyset entry whose kid is not its own
 *   key's fingerprint is refused (parseEdgeKeyset), so "an attacker key under a valid kid" can only fail the signature.
 *
 * VERIFICATION IS AN ALLOW-LIST (R-10-a): the kid must be in the trusted keyset (no fallback to "any key"); the key must be
 *   `active` inside [notBefore − skew, notAfter + skew], or `retired` inside that window (verify only — a retired key never
 *   signs a keyset); a `next` key NEVER verifies (it is published ahead, not usable); typ must match exactly; any exception
 *   anywhere ⇒ invalid. Nothing secret is compared (signatures are checked by crypto.verify).
 *
 * KEY CUSTODY (central, the internalCa.ts discipline; fix scan 2 ruling R-10-c): the PRIVATE keys are FILES in the keyring
 * directory (EDGE_SIGNING_KEY_DIR: `<kid>.pem` mode 0600 + `keyring.json`), the signer is EDGE_SIGNING_KEY_FILE (or
 * EDGE_SIGNING_KEY_PEM); scripts/edge-signing-key.ts manages them. The keyset central publishes and the provisioning pin are
 * derived ONLY from these files (readEdgeKeyring → buildEdgeKeysetFromKeyring / edgePinFromKeyring). The DB table
 * `edge_auth_signing_keys` (mig 0373) is an audit / distribution MIRROR, read by nothing here: a planted row is never trusted.
 *
 * TRUST ON THE EDGE (fix scan 2): the ONLY trust anchor is an EdgeTrustStore — LOCAL state built from the keyset PINNED
 * at provisioning (edge-keyset.json, every pinned key active and open-ended) plus the keyset updates it accepted itself,
 * each verified with the keys trusted BEFORE it (never the keys the update brings), signed by a key ACTIVE there, with a
 * strictly higher version, keeping EVERY pinned key unchanged and active — the pinned root is only replaced by
 * re-provisioning. verifyEdgeObject refuses any other anchor (a plain keyset object, e.g. one carried by the same message,
 * is never trusted: `untrusted_keyset`). Validity windows use the store's own clock, never a time from a claim. The typed
 * verifiers (node / run / claim / TTL binding) are in edgeTrust.ts. Rotation = add a new signer (generate → next, activate →
 * both active, ≥ 2 config cycles, switch central's key file, retire the previous non-root signer); it never revokes the root.
 * fix review 1: the pin file is `{ kind: "avi-edge-pin+v1", keyset }` at the keyring VERSION of provisioning (I5 — no keyset
 * below it is ever accepted); EdgeTrustStore.fromPinned accepts nothing else (M3) and fromPinFile is the boot path; the
 * keyring records who changed it (history) and is pruned at its 16-key cap without touching the root / active keys (M5).
 *
 * Nothing here touches the DB or the network. Verification never throws: it answers { ok:false, reason }.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// ── constants ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const EDGE_SIGNING_DOMAIN = "avi-edge-v1";
export const EDGE_SIGNED_TYPS = ["auth", "config", "runpkg", "cmd", "keyset"] as const;
export type EdgeSignedTyp = (typeof EDGE_SIGNED_TYPS)[number];
export const EDGE_TYP_NAME: Readonly<Record<EdgeSignedTyp, string>> = Object.freeze({
  auth: "avi-edge-auth+v1",
  config: "avi-edge-config+v1",
  runpkg: "avi-edge-runpkg+v1",
  cmd: "avi-edge-cmd+v1",
  keyset: "avi-edge-keyset+v1",
});
export const EDGE_SIG_ALG = "EdDSA" as const;
export const EDGE_KID_RE = /^edk_[A-Za-z0-9_-]{22}$/;
/** 64 bytes, base64url without padding. */
const SIG_RE = /^[A-Za-z0-9_-]{86}$/;
const MAX_DEPTH = 64;
/** Upper bound of a signed payload text (a config snapshot with 500 adapters × tags stays well below). */
export const EDGE_PAYLOAD_MAX_CHARS = 8_000_000;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// ── canonical JSON ──────────────────────────────────────────────────────────────────────────────────────────────────

export class EdgeCanonicalJsonError extends Error {
  readonly code = "EDGE_CANONICAL_JSON";
}

function enc(v: unknown, depth: number): string {
  if (depth > MAX_DEPTH) throw new EdgeCanonicalJsonError(`nesting deeper than ${MAX_DEPTH}`);
  if (v === null) return "null";
  switch (typeof v) {
    case "string":
      return JSON.stringify(v);
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new EdgeCanonicalJsonError(`non-finite number ${String(v)}`);
      return JSON.stringify(Object.is(v, -0) ? 0 : v);
    case "object": {
      if (Array.isArray(v)) {
        return `[${v
          .map((x, i) => {
            if (x === undefined) throw new EdgeCanonicalJsonError(`undefined at array index ${i}`);
            return enc(x, depth + 1);
          })
          .join(",")}]`;
      }
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) {
        throw new EdgeCanonicalJsonError(`not a plain object (${(v as object).constructor?.name ?? "unknown"})`);
      }
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort();
      for (const k of keys) if (FORBIDDEN_KEYS.has(k)) throw new EdgeCanonicalJsonError(`prototype key "${k}" refused`);
      return `{${keys.map((k) => `${JSON.stringify(k)}:${enc(o[k], depth + 1)}`).join(",")}}`;
    }
    default:
      throw new EdgeCanonicalJsonError(`a ${typeof v} has no JSON form`);
  }
}

/** The one canonical serialisation signer and verifier both use. Throws EdgeCanonicalJsonError. */
export function edgeCanonicalJson(value: unknown): string {
  return enc(value, 0);
}

/**
 * Parse a payload text that must ALREADY be canonical: JSON.parse, re-serialise, compare. Any difference (duplicate key,
 * whitespace, key order, number / string spelling, precision loss, prototype key) ⇒ EdgeCanonicalJsonError.
 */
export function parseEdgeCanonicalJson(text: string): unknown {
  if (typeof text !== "string" || text.length > EDGE_PAYLOAD_MAX_CHARS) throw new EdgeCanonicalJsonError("payload text missing or too large");
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new EdgeCanonicalJsonError("payload text is not JSON");
  }
  if (edgeCanonicalJson(v) !== text) throw new EdgeCanonicalJsonError("payload text is not in canonical form");
  return v;
}

function assertTyp(typ: unknown): asserts typ is EdgeSignedTyp {
  if (!(EDGE_SIGNED_TYPS as readonly unknown[]).includes(typ)) throw new Error(`edgeSigning: unknown typ ${String(typ)}`);
}

/** The exact bytes signed for (typ, kid, canonical payload text). Throws on a bad typ / kid or a non-canonical text. */
export function edgeSigningInput(typ: EdgeSignedTyp, kid: string, payloadText: string): Buffer {
  assertTyp(typ);
  if (!EDGE_KID_RE.test(kid)) throw new Error("edgeSigning: bad kid");
  parseEdgeCanonicalJson(payloadText);
  return Buffer.from(`${EDGE_SIGNING_DOMAIN}\n${typ}\n${kid}\n${payloadText}`, "utf8");
}

// ── keys ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface EdgeSigningKey {
  kid: string;
  privateKey: KeyObject;
  publicKeyPem: string;
}

export class EdgeSigningKeyError extends Error {
  constructor(
    readonly code: "not_ed25519" | "bad_key" | "key_file_permissions" | "key_file_unreadable" | "both_sources",
    message: string,
  ) {
    super(message);
  }
}

const pubCache = new Map<string, KeyObject>();
function publicKeyOf(pem: string): KeyObject {
  let k = pubCache.get(pem);
  if (!k) {
    k = createPublicKey(pem);
    if (k.asymmetricKeyType !== "ed25519") throw new EdgeSigningKeyError("not_ed25519", "edge keys must be Ed25519");
    if (pubCache.size > 256) pubCache.clear();
    pubCache.set(pem, k);
  }
  return k;
}

/** kid of a public key (PEM or KeyObject): "edk_" + 22 base64url chars of sha256(SPKI DER). */
export function edgeKidOf(publicKey: KeyObject | string): string {
  const k = typeof publicKey === "string" ? publicKeyOf(publicKey) : publicKey;
  const der = k.export({ type: "spki", format: "der" }) as Buffer;
  return `edk_${createHash("sha256").update(der).digest("base64url").slice(0, 22)}`;
}

/** A signing key from a PKCS#8 PEM (Ed25519 only). Throws EdgeSigningKeyError. */
export function edgeSigningKeyFromPem(privateKeyPem: string): EdgeSigningKey {
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(privateKeyPem);
  } catch {
    throw new EdgeSigningKeyError("bad_key", "edge signing key: not a readable private key PEM");
  }
  if (privateKey.asymmetricKeyType !== "ed25519") throw new EdgeSigningKeyError("not_ed25519", "edge signing key must be Ed25519");
  const pub = createPublicKey(privateKey);
  const publicKeyPem = pub.export({ type: "spki", format: "pem" }).toString();
  return { kid: edgeKidOf(pub), privateKey, publicKeyPem };
}

/** A fresh Ed25519 key (the CLI writes privateKeyPem to a 0600 file — never to the DB). */
export function generateEdgeSigningKey(): { key: EdgeSigningKey; privateKeyPem: string } {
  const { privateKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return { key: edgeSigningKeyFromPem(privateKeyPem), privateKeyPem };
}

/**
 * Central's signing key from EDGE_SIGNING_KEY_PEM (inline; literal "\n" accepted) or EDGE_SIGNING_KEY_FILE (on POSIX the
 * file must not be readable by group / others — mode 0600). Neither ⇒ null (the v2 node routes then answer 503). Both ⇒
 * refused (ambiguous custody). Throws EdgeSigningKeyError on a bad key / file.
 */
export function loadEdgeSigningKey(env: NodeJS.ProcessEnv = process.env): EdgeSigningKey | null {
  const pem = env.EDGE_SIGNING_KEY_PEM?.trim();
  const file = env.EDGE_SIGNING_KEY_FILE?.trim();
  if (pem && file) throw new EdgeSigningKeyError("both_sources", "set EDGE_SIGNING_KEY_PEM or EDGE_SIGNING_KEY_FILE, not both");
  if (pem) return edgeSigningKeyFromPem(pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem);
  if (!file) return null;
  let text: string;
  try {
    if (process.platform !== "win32" && (statSync(file).mode & 0o077) !== 0) {
      throw new EdgeSigningKeyError("key_file_permissions", `edge signing key file ${file} must be mode 0600 (no group / other access)`);
    }
    text = readFileSync(file, "utf8");
  } catch (err) {
    if (err instanceof EdgeSigningKeyError) throw err;
    throw new EdgeSigningKeyError("key_file_unreadable", `edge signing key file ${file} cannot be read`);
  }
  return edgeSigningKeyFromPem(text);
}

let _centralKey: EdgeSigningKey | null = null;
/** loadEdgeSigningKey(process.env), cached for the process after the first successful load (null is not cached). */
export function getCentralEdgeSigningKey(): EdgeSigningKey | null {
  if (_centralKey) return _centralKey;
  const key = loadEdgeSigningKey();
  if (key) _centralKey = key;
  return key;
}
/** Tests only. */
export function __resetCentralEdgeSigningKeyForTests(): void {
  _centralKey = null;
}

// ── envelope ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface EdgeSignedEnvelope {
  typ: string;
  alg: typeof EDGE_SIG_ALG;
  kid: string;
  /** the payload's CANONICAL JSON TEXT */
  payload: string;
  sig: string;
}

/** Strict wire schema of a signed envelope (the payload is checked by the caller's own strict schema after verification). */
export const edgeSignedEnvelopeSchema = z.strictObject({
  typ: z.enum(Object.values(EDGE_TYP_NAME) as [string, ...string[]]),
  alg: z.literal(EDGE_SIG_ALG),
  kid: z.string().regex(EDGE_KID_RE),
  payload: z.string().min(1).max(EDGE_PAYLOAD_MAX_CHARS),
  sig: z.string().regex(SIG_RE),
});

/** Sign a payload (serialised canonically here). Throws on a payload without one JSON form or a bad typ. */
export function signEdgeObject(typ: EdgeSignedTyp, payload: unknown, key: EdgeSigningKey): EdgeSignedEnvelope {
  assertTyp(typ);
  const text = edgeCanonicalJson(payload);
  const sig = cryptoSign(null, edgeSigningInput(typ, key.kid, text), key.privateKey).toString("base64url");
  return { typ: EDGE_TYP_NAME[typ], alg: EDGE_SIG_ALG, kid: key.kid, payload: text, sig };
}

// ── keyset ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type EdgeKeyStatus = "next" | "active" | "retired";
export interface EdgeKeysetKey {
  kid: string;
  publicKeyPem: string;
  status: EdgeKeyStatus;
  /** epoch ms */
  notBefore: number;
  /** epoch ms; null = open-ended (a retired key always has one) */
  notAfter: number | null;
}
export interface EdgeKeyset {
  v: 1;
  /** strictly increasing across updates (no rollback) */
  version: number;
  issuedAt: number;
  keys: EdgeKeysetKey[];
}

const epochMs = z.number().int().nonnegative().max(8_640_000_000_000_000);
export const edgeKeysetKeySchema = z.strictObject({
  kid: z.string().regex(EDGE_KID_RE),
  publicKeyPem: z.string().min(40).max(1000).startsWith("-----BEGIN PUBLIC KEY-----"),
  status: z.enum(["next", "active", "retired"]),
  notBefore: epochMs,
  notAfter: epochMs.nullable(),
});
export const edgeKeysetSchema = z.strictObject({
  v: z.literal(1),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  issuedAt: epochMs,
  keys: z.array(edgeKeysetKeySchema).min(1).max(16),
});

/** Strict shape + semantics: kid = fingerprint of its key (Ed25519), unique kids, ≥ 1 active, a retired key has notAfter. */
export function parseEdgeKeyset(raw: unknown): { ok: true; keyset: EdgeKeyset } | { ok: false; reason: string } {
  try {
    const p = edgeKeysetSchema.safeParse(raw);
    if (!p.success) return { ok: false, reason: `shape: ${p.error.issues[0]?.path.join(".") ?? "?"} ${p.error.issues[0]?.message ?? ""}`.trim() };
    const ks = p.data as EdgeKeyset;
    const seen = new Set<string>();
    for (const k of ks.keys) {
      if (seen.has(k.kid)) return { ok: false, reason: `duplicate kid ${k.kid}` };
      seen.add(k.kid);
      let kid: string;
      try {
        kid = edgeKidOf(k.publicKeyPem);
      } catch {
        return { ok: false, reason: `kid ${k.kid}: not an Ed25519 public key` };
      }
      if (kid !== k.kid) return { ok: false, reason: `kid ${k.kid} is not the fingerprint of its key` };
      if (k.status === "retired" && k.notAfter === null) return { ok: false, reason: `retired key ${k.kid} has no notAfter` };
      if (k.notAfter !== null && k.notAfter < k.notBefore) return { ok: false, reason: `key ${k.kid}: notAfter before notBefore` };
    }
    if (!ks.keys.some((k) => k.status === "active")) return { ok: false, reason: "no active key" };
    return { ok: true, keyset: ks };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

// ── the provisioning PIN (edge-keyset.json) — fix review 1 (I5, M3) ─────────────────────────────────────────────────
//
// A pin is NOT a bare keyset: it is `{ kind: "avi-edge-pin+v1", keyset }` (strict), so a keyset lifted from a message (a
// config's keyset payload, a request body) can never be passed off as a trust anchor — EdgeTrustStore.fromPinned refuses
// anything but this shape. keyset.version = the keyring version at provisioning (I5): the store refuses every keyset update
// BELOW it, so a captured, genuinely signed OLDER keyset (one that still trusted a since-retired key) is refused as a rollback.
// The first update AT the pin version is accepted once (the pin holds the root only; central's keyset of that version holds
// every published key) — after that, versions must strictly increase.
export const EDGE_PIN_KIND = "avi-edge-pin+v1" as const;
export interface EdgeKeysetPin {
  kind: typeof EDGE_PIN_KIND;
  keyset: EdgeKeyset;
}
export const edgeKeysetPinSchema = z.strictObject({ kind: z.literal(EDGE_PIN_KIND), keyset: edgeKeysetSchema });

/** Strict pin shape (plain JSON data only) + keyset semantics + every pinned key active and open-ended. */
export function parseEdgeKeysetPin(raw: unknown): { ok: true; pin: EdgeKeysetPin } | { ok: false; reason: string } {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not an object" };
    const proto = Object.getPrototypeOf(raw);
    if (proto !== Object.prototype && proto !== null) return { ok: false, reason: "not plain data" };
    // plain JSON data only (no getters / class instances / prototype keys): one canonical round-trip
    const data = parseEdgeCanonicalJson(edgeCanonicalJson(raw));
    const p = edgeKeysetPinSchema.safeParse(data);
    if (!p.success) return { ok: false, reason: `shape: ${p.error.issues[0]?.path.join(".") ?? "?"} ${p.error.issues[0]?.message ?? ""}`.trim() };
    const ks = parseEdgeKeyset(p.data.keyset);
    if (!ks.ok) return { ok: false, reason: ks.reason };
    if (!ks.keyset.keys.every((k) => k.status === "active" && k.notAfter === null)) return { ok: false, reason: "every pinned key must be active and open-ended" };
    return { ok: true, pin: { kind: EDGE_PIN_KIND, keyset: ks.keyset } };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/**
 * The pin file content written at provisioning: the provisioning root(s) only, active, open-ended, at keyset VERSION `version`
 * (I5 — pass the keyring version; edgePinFromKeyring does). The default 1 is for tests / a brand-new keyring only.
 */
export function edgePinnedKeyset(roots: ReadonlyArray<{ kid: string; publicKeyPem: string; notBefore: number }>, nowMs = Date.now(), version = 1): EdgeKeysetPin {
  const ks: EdgeKeyset = { v: 1, version, issuedAt: nowMs, keys: roots.map((r) => ({ kid: r.kid, publicKeyPem: r.publicKeyPem, status: "active", notBefore: r.notBefore, notAfter: null })) };
  const p = parseEdgeKeysetPin({ kind: EDGE_PIN_KIND, keyset: ks });
  if (!p.ok) throw new Error(`edgePinnedKeyset: ${p.reason}`);
  return p.pin;
}

// ── verification (allow-list, R-10-a; fix scan 2: the trust anchor is LOCAL state, never a request) ─────────────────

export type EdgeVerifyFailure =
  | "untrusted_keyset"
  | "malformed"
  | "bad_alg"
  | "wrong_typ"
  | "unknown_kid"
  | "key_not_valid"
  | "non_canonical"
  | "bad_signature"
  | "claim_mismatch";
export type EdgeVerifyResult<T = unknown> = { ok: true; payload: T; kid: string } | { ok: false; reason: EdgeVerifyFailure };
export type EdgeKeysetUpdateFailure = EdgeVerifyFailure | "signer_not_active" | "rollback" | "invalid_keyset" | "pinned_removed";

export class EdgeTrustError extends Error {
  readonly code = "EDGE_TRUST";
}

/** May this keyset entry VERIFY now? active or retired, inside [notBefore − skew, notAfter + skew]; next ⇒ never. */
function keyUsableAt(k: EdgeKeysetKey, nowMs: number, skewMs: number): boolean {
  if (k.status !== "active" && k.status !== "retired") return false;
  if (k.status === "retired" && k.notAfter === null) return false;
  if (nowMs + skewMs < k.notBefore) return false;
  if (k.notAfter !== null && nowMs - skewMs > k.notAfter) return false;
  return true;
}

function verifyInner(raw: unknown, expectedTyp: EdgeSignedTyp, keyset: EdgeKeyset, nowMs: number, skewMs: number): EdgeVerifyResult & { key?: EdgeKeysetKey } {
  if (!(EDGE_SIGNED_TYPS as readonly unknown[]).includes(expectedTyp)) return { ok: false, reason: "wrong_typ" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "malformed" };
  if ((raw as Record<string, unknown>).alg !== EDGE_SIG_ALG) return { ok: false, reason: "bad_alg" };
  const p = edgeSignedEnvelopeSchema.safeParse(raw);
  if (!p.success) return { ok: false, reason: "malformed" };
  const env = p.data;
  const sig = Buffer.from(env.sig, "base64url");
  if (sig.length !== 64 || sig.toString("base64url") !== env.sig) return { ok: false, reason: "malformed" };
  if (env.typ !== EDGE_TYP_NAME[expectedTyp]) return { ok: false, reason: "wrong_typ" };
  const matches = keyset.keys.filter((k) => k.kid === env.kid);
  if (matches.length !== 1) return { ok: false, reason: "unknown_kid" };
  const key = matches[0];
  // a kid IS the fingerprint of its key: an entry whose key is not the kid's (collision / substitution) never verifies
  if (edgeKidOf(key.publicKeyPem) !== env.kid) return { ok: false, reason: "unknown_kid" };
  if (!keyUsableAt(key, nowMs, skewMs)) return { ok: false, reason: "key_not_valid" };
  let payload: unknown;
  try {
    // the EXACT received text is what is verified; it must already be canonical (no re-serialisation of a parsed object)
    payload = parseEdgeCanonicalJson(env.payload);
  } catch {
    return { ok: false, reason: "non_canonical" };
  }
  const good = cryptoVerify(null, edgeSigningInput(expectedTyp, env.kid, env.payload), publicKeyOf(key.publicKeyPem), sig);
  if (good !== true) return { ok: false, reason: "bad_signature" };
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const o = payload as Record<string, unknown>;
    if ("kid" in o && o.kid !== env.kid) return { ok: false, reason: "claim_mismatch" };
    if ("typ" in o && o.typ !== EDGE_TYP_NAME[expectedTyp]) return { ok: false, reason: "claim_mismatch" };
  }
  return { ok: true, payload, kid: env.kid, key };
}

function verifyAgainst(raw: unknown, expectedTyp: EdgeSignedTyp, keyset: EdgeKeyset, nowMs: number, skewMs: number): EdgeVerifyResult & { key?: EdgeKeysetKey } {
  try {
    return verifyInner(raw, expectedTyp, keyset, nowMs, skewMs);
  } catch {
    return { ok: false, reason: "malformed" }; // any exception ⇒ invalid (R-10-a)
  }
}

/** One chain link, verified with the OLD (currently trusted) keyset — never with the keys the update itself brings. */
function checkKeysetUpdate(
  pinned: EdgeKeyset,
  trusted: EdgeKeyset,
  update: unknown,
  nowMs: number,
  skewMs: number,
  atPin: boolean,
): { ok: true; keyset: EdgeKeyset; same: boolean } | { ok: false; reason: EdgeKeysetUpdateFailure } {
  try {
    const r = verifyAgainst(update, "keyset", trusted, nowMs, skewMs);
    if (!r.ok) return { ok: false, reason: r.reason };
    if (!r.key || r.key.status !== "active") return { ok: false, reason: "signer_not_active" };
    const parsed = parseEdgeKeyset(r.payload);
    if (!parsed.ok) return { ok: false, reason: "invalid_keyset" };
    if (parsed.keyset.version === trusted.version && edgeCanonicalJson(parsed.keyset) === edgeCanonicalJson(trusted)) return { ok: true, keyset: trusted, same: true };
    // I5: never below the PIN's version; the first update may be AT it (the pin is the root-only projection of that version)
    const minVersion = atPin ? pinned.version : trusted.version + 1;
    if (!(parsed.keyset.version >= minVersion)) return { ok: false, reason: "rollback" };
    for (const pk of pinned.keys) {
      const k = parsed.keyset.keys.find((x) => x.kid === pk.kid);
      if (!k || k.publicKeyPem !== pk.publicKeyPem || k.status !== "active" || k.notAfter !== null) return { ok: false, reason: "pinned_removed" };
    }
    return { ok: true, keyset: parsed.keyset, same: false };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

export interface EdgeTrustOptions {
  /** this node's id (from the provisioning bundle) — the typed verifiers (edgeTrust.ts) bind every object to it */
  nodeId: number;
  /** the verifier's OWN wall clock (default Date.now) — never a time from a claim */
  now?: () => number;
  /** tolerated clock skew (default 5 s, bounded to [0, 300 s]) */
  skewMs?: number;
}
interface TrustState {
  pinned: EdgeKeyset;
  current: EdgeKeyset;
  /** no update accepted yet (the current keyset IS the pin) */
  atPin: boolean;
  updates: EdgeSignedEnvelope[];
  nodeId: number;
  now: () => number;
  skewMs: number;
}
/** The ONLY trust anchors: stores built by EdgeTrustStore.fromPinned (a plain keyset object is never trusted). */
const TRUST = new WeakMap<object, TrustState>();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * The edge's trust anchor, kept in LOCAL state (fix scan 2): built only from the keyset PINNED at provisioning
 * (edge-keyset.json — every pinned key active and open-ended) plus keyset updates it accepted itself, in order (each verified
 * with the keys trusted BEFORE it). A keyset carried by a message (a config, a package, a request) is never a trust anchor:
 * it is only ever offered to acceptKeysetUpdate. Persist acceptedUpdates() and pass them back to fromPinned at boot.
 */
export class EdgeTrustStore {
  private constructor() {}

  /**
   * fix review 1 (M3): `pin` must be the PIN shape `{ kind: "avi-edge-pin+v1", keyset }` (parseEdgeKeysetPin — strict, plain
   * data, every key active + open-ended); a bare keyset (e.g. one taken from a message) is refused. Prefer fromPinFile.
   */
  static fromPinned(pin: unknown, opts: EdgeTrustOptions, updates: readonly unknown[] = []): EdgeTrustStore {
    const p = parseEdgeKeysetPin(pin);
    if (!p.ok) throw new EdgeTrustError(`pinned keyset refused: ${p.reason}`);
    if (!opts || !Number.isSafeInteger(opts.nodeId) || opts.nodeId <= 0) throw new EdgeTrustError("nodeId must be a positive integer");
    const skew = opts.skewMs ?? 5_000;
    const state: TrustState = {
      pinned: clone(p.pin.keyset),
      current: clone(p.pin.keyset),
      atPin: true,
      updates: [],
      nodeId: opts.nodeId,
      now: opts.now ?? Date.now,
      skewMs: Number.isFinite(skew) ? Math.min(300_000, Math.max(0, skew)) : 5_000,
    };
    const store = new EdgeTrustStore();
    TRUST.set(store, state);
    for (let i = 0; i < updates.length; i++) {
      const r = store.acceptKeysetUpdate(updates[i]);
      if (!r.ok) throw new EdgeTrustError(`persisted keyset update ${i} refused: ${r.reason}`);
    }
    return store;
  }

  /** THE edge boot path: read the provisioning pin FILE (edge-keyset.json, written by `edge-signing-key.ts pin`), then fromPinned. */
  static fromPinFile(file: string, opts: EdgeTrustOptions, updates: readonly unknown[] = []): EdgeTrustStore {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new EdgeTrustError(`pin file ${file} missing or not JSON`);
    }
    return EdgeTrustStore.fromPinned(raw, opts, updates);
  }

  private st(): TrustState {
    const s = TRUST.get(this);
    if (!s) throw new EdgeTrustError("not a genuine EdgeTrustStore");
    return s;
  }
  get nodeId(): number {
    return this.st().nodeId;
  }
  get skewMs(): number {
    return this.st().skewMs;
  }
  now(): number {
    return this.st().now();
  }
  get version(): number {
    return this.st().current.version;
  }
  /** A copy of the currently trusted keyset (changing it changes nothing). */
  keyset(): EdgeKeyset {
    return clone(this.st().current);
  }
  /** The signed updates accepted since the pin, in order (persist them; replay with fromPinned). */
  acceptedUpdates(): EdgeSignedEnvelope[] {
    return clone(this.st().updates);
  }
  /**
   * Offer a signed keyset (e.g. config.keyset). Accepted only if signed by a key ACTIVE in the CURRENT trusted keyset, with
   * a strictly higher version (the same version, identical, is a no-op) — never below the PIN's version, the first update may
   * be at it (I5) — keeping every pinned key active and open-ended.
   * The state changes only on success. Never throws.
   */
  acceptKeysetUpdate(update: unknown): { ok: true; version: number; changed: boolean } | { ok: false; reason: EdgeKeysetUpdateFailure } {
    const s = TRUST.get(this);
    if (!s) return { ok: false, reason: "untrusted_keyset" };
    let now: number;
    try {
      now = s.now();
    } catch {
      return { ok: false, reason: "malformed" };
    }
    const r = checkKeysetUpdate(s.pinned, s.current, update, now, s.skewMs, s.atPin);
    if (!r.ok) return r;
    if (r.same) return { ok: true, version: s.current.version, changed: false };
    s.current = clone(r.keyset);
    s.atPin = false;
    s.updates.push(clone(update as EdgeSignedEnvelope));
    return { ok: true, version: s.current.version, changed: true };
  }
}

/**
 * Verify a signed envelope of the expected typ against a GENUINE EdgeTrustStore (its current keyset and its own clock).
 * Anything else as the anchor (a plain keyset object, a forged store) ⇒ untrusted_keyset. Never throws. The returned
 * payload is NOT bound to this node yet — use the typed verifiers in edgeTrust.ts (node / run / claim / time binding).
 */
export function verifyEdgeObject<T = unknown>(raw: unknown, expectedTyp: EdgeSignedTyp, store: EdgeTrustStore): EdgeVerifyResult<T> {
  const s = store && typeof store === "object" ? TRUST.get(store) : undefined;
  if (!s) return { ok: false, reason: "untrusted_keyset" };
  let now: number;
  try {
    now = s.now();
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const r = verifyAgainst(raw, expectedTyp, s.current, now, s.skewMs);
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, payload: r.payload as T, kid: r.kid };
}

// ── central keyring: the KEY FILES are the only source of trust (fix scan 2, ruling R-10-c) ─────────────────────────
//
// The keyring is a directory on central (EDGE_SIGNING_KEY_DIR, default the directory of EDGE_SIGNING_KEY_FILE) holding one
// private key file per key, `<kid>.pem` (mode 0600), and `keyring.json` (mode 0600): the status of each key. Only
// scripts/edge-signing-key.ts writes it. Every keyset central publishes and the provisioning pin are derived from these FILES:
// each non-retired entry must have its `<kid>.pem` whose public key IS the entry's key. The DB table edge_auth_signing_keys is
// an audit / distribution MIRROR only — nothing here reads it, so a row planted there (by any DB writer) is never trusted.

export interface EdgeKeyringEntry {
  kid: string;
  publicKeyPem: string;
  status: EdgeKeyStatus;
  /** epoch ms */
  notBefore: number;
  /** epoch ms when retired; null otherwise */
  retiredAt: number | null;
  /** the provisioning root (pinned by every edge): always active, never retired here */
  root: boolean;
}
/** fix review 1 (I7) — who changed the keyring: a PROVEN active admin (scripts/edge-signing-key.ts --actor + verifyCredentialAdmin). */
export interface EdgeKeyringHistoryEntry {
  /** the keyring version this change produced */
  version: number;
  action: "generate" | "activate" | "retire" | "prune";
  kid: string;
  actorUserId: number;
  actorName: string;
  /** epoch ms */
  at: number;
}
export interface EdgeKeyring {
  v: 1;
  /** bumped by every change — the version of the keyset central publishes */
  version: number;
  /** epoch ms of the last change — the published keyset's issuedAt (so one version ⇒ one byte-identical keyset) */
  updatedAt: number;
  keys: EdgeKeyringEntry[];
  /** every change, oldest first (absent on a keyring written before fix review 1) */
  history?: EdgeKeyringHistoryEntry[];
}
export const edgeKeyringSchema = z.strictObject({
  v: z.literal(1),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  updatedAt: epochMs,
  keys: z
    .array(
      z.strictObject({
        kid: z.string().regex(EDGE_KID_RE),
        publicKeyPem: z.string().min(40).max(1000).startsWith("-----BEGIN PUBLIC KEY-----"),
        status: z.enum(["next", "active", "retired"]),
        notBefore: epochMs,
        retiredAt: epochMs.nullable(),
        root: z.boolean(),
      }),
    )
    .min(1)
    .max(16),
  history: z
    .array(
      z.strictObject({
        version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        action: z.enum(["generate", "activate", "retire", "prune"]),
        kid: z.string().regex(EDGE_KID_RE),
        actorUserId: z.number().int().positive(),
        actorName: z.string().min(1).max(200),
        at: epochMs,
      }),
    )
    .max(5_000)
    .optional(),
});
export const EDGE_KEYRING_FILE = "keyring.json";

/** The keyring directory: EDGE_SIGNING_KEY_DIR, else the directory of EDGE_SIGNING_KEY_FILE, else null. */
export function edgeKeyDirOf(env: NodeJS.ProcessEnv = process.env): string | null {
  const dir = env.EDGE_SIGNING_KEY_DIR?.trim();
  if (dir) return dir;
  const file = env.EDGE_SIGNING_KEY_FILE?.trim();
  return file ? path.dirname(file) : null;
}

/**
 * Read + validate the keyring FILES of `dir`. Throws EdgeTrustError on anything inconsistent: bad shape, a kid that is not its
 * key's fingerprint, duplicate kids, not exactly one root, a root that is not active, a retired key without retiredAt (or the
 * reverse), and — for every non-retired key — a missing / unreadable / group-or-world-readable `<kid>.pem` or one whose public
 * key is not the entry's.
 */
export function readEdgeKeyring(dir: string): EdgeKeyring {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path.join(dir, EDGE_KEYRING_FILE), "utf8"));
  } catch {
    throw new EdgeTrustError(`keyring ${path.join(dir, EDGE_KEYRING_FILE)} missing or not JSON`);
  }
  const p = edgeKeyringSchema.safeParse(raw);
  if (!p.success) throw new EdgeTrustError(`keyring shape: ${p.error.issues[0]?.path.join(".") ?? "?"}`);
  const kr = p.data as EdgeKeyring;
  const seen = new Set<string>();
  for (const k of kr.keys) {
    if (seen.has(k.kid)) throw new EdgeTrustError(`keyring: duplicate kid ${k.kid}`);
    seen.add(k.kid);
    let fp: string;
    try {
      fp = edgeKidOf(k.publicKeyPem);
    } catch {
      throw new EdgeTrustError(`keyring: ${k.kid} is not an Ed25519 public key`);
    }
    if (fp !== k.kid) throw new EdgeTrustError(`keyring: ${k.kid} is not the fingerprint of its key`);
    if ((k.status === "retired") !== (k.retiredAt !== null)) throw new EdgeTrustError(`keyring: ${k.kid} retiredAt iff retired`);
    if (k.root && k.status !== "active") throw new EdgeTrustError(`keyring: the root ${k.kid} must stay active (replace it only by re-provisioning)`);
    if (k.status !== "retired") {
      const key = loadEdgeSigningKey({ EDGE_SIGNING_KEY_FILE: path.join(dir, `${k.kid}.pem`) });
      if (!key || key.kid !== k.kid) throw new EdgeTrustError(`keyring: ${k.kid}.pem does not hold the key ${k.kid}`);
    }
  }
  if (kr.keys.filter((k) => k.root).length !== 1) throw new EdgeTrustError("keyring: exactly one root key is required");
  return kr;
}

/** Write `keyring.json` atomically (temp file 0600 + rename). Callers: the CLI only. */
export function writeEdgeKeyring(dir: string, keyring: EdgeKeyring): void {
  const p = edgeKeyringSchema.safeParse(keyring);
  if (!p.success) throw new EdgeTrustError("writeEdgeKeyring: invalid keyring");
  const tmp = path.join(dir, `.${EDGE_KEYRING_FILE}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, JSON.stringify(keyring, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(tmp, path.join(dir, EDGE_KEYRING_FILE));
}

/**
 * The keyset central publishes, derived ONLY from the keyring files. The signer must be an ACTIVE key of the keyring (else
 * throws). Deterministic: one keyring version ⇒ one byte-identical keyset (issuedAt = keyring.updatedAt), so a re-sent
 * keyset is a no-op on the edge. Root: active, open-ended; active / next as recorded; retired: kept with notAfter = retiredAt +
 * retiredGraceMs (the CLI prunes it later, with a version bump).
 */
export function buildEdgeKeysetFromKeyring(keyring: EdgeKeyring, signer: EdgeSigningKey, opts: { retiredGraceMs: number }): EdgeKeyset {
  const me = keyring.keys.find((k) => k.kid === signer.kid);
  if (!me || me.status !== "active" || me.publicKeyPem.trim() !== signer.publicKeyPem.trim()) {
    throw new EdgeTrustError(`the loaded signing key ${signer.kid} is not an ACTIVE key of the keyring`);
  }
  const keys: EdgeKeysetKey[] = keyring.keys.map((k) =>
    k.status === "retired"
      ? { kid: k.kid, publicKeyPem: k.publicKeyPem, status: "retired", notBefore: Math.min(k.notBefore, (k.retiredAt as number) + opts.retiredGraceMs), notAfter: (k.retiredAt as number) + opts.retiredGraceMs }
      : { kid: k.kid, publicKeyPem: k.publicKeyPem, status: k.root ? "active" : k.status, notBefore: k.notBefore, notAfter: null },
  );
  keys.sort((a, b) => a.notBefore - b.notBefore || (a.kid < b.kid ? -1 : a.kid > b.kid ? 1 : 0));
  const ks: EdgeKeyset = { v: 1, version: keyring.version, issuedAt: keyring.updatedAt, keys };
  const parsed = parseEdgeKeyset(ks);
  if (!parsed.ok) throw new EdgeTrustError(`keyset from keyring invalid: ${parsed.reason}`);
  return parsed.keyset;
}

/**
 * The provisioning pin (edge-keyset.json): the keyring's ROOT only — from the files, never from the DB — at the keyring's
 * CURRENT version (I5): the edge refuses every keyset older than the one in force when it was provisioned.
 */
export function edgePinFromKeyring(keyring: EdgeKeyring): EdgeKeysetPin {
  const root = keyring.keys.find((k) => k.root);
  if (!root) throw new EdgeTrustError("keyring has no root");
  return edgePinnedKeyset([{ kid: root.kid, publicKeyPem: root.publicKeyPem, notBefore: root.notBefore }], keyring.updatedAt, keyring.version);
}

/** fix review 1 (M5): the keyring cap (= the keyset's 16 keys) and how long a retired key is kept before it may be pruned. */
export const EDGE_KEYRING_MAX_KEYS = 16;
export const EDGE_RETIRED_PRUNE_AFTER_MS = 24 * 3_600_000;
/**
 * fix review 1 (M5) — make room at the keyring cap: drop RETIRED keys retired at least `minRetiredAgeMs` ago (far past auth
 * TTL + skew), oldest first, until `room` slots are free. NEVER the root, never an active or next key. Returns the pruned
 * keyring (version unchanged — the caller bumps it) and the kids removed; `ok:false` when not enough retired keys are old
 * enough (the caller refuses the change).
 */
export function pruneEdgeKeyring(
  keyring: EdgeKeyring,
  opts: { nowMs: number; room: number; minRetiredAgeMs?: number },
): { ok: true; keyring: EdgeKeyring; pruned: string[] } | { ok: false; reason: string } {
  const minAge = opts.minRetiredAgeMs ?? EDGE_RETIRED_PRUNE_AFTER_MS;
  const need = keyring.keys.length + opts.room - EDGE_KEYRING_MAX_KEYS;
  if (need <= 0) return { ok: true, keyring, pruned: [] };
  const candidates = keyring.keys
    .filter((k) => !k.root && k.status === "retired" && k.retiredAt !== null && k.retiredAt + minAge <= opts.nowMs)
    .sort((a, b) => (a.retiredAt as number) - (b.retiredAt as number) || (a.kid < b.kid ? -1 : 1));
  if (candidates.length < need) {
    return {
      ok: false,
      reason: `the keyring is at its cap of ${EDGE_KEYRING_MAX_KEYS} keys and only ${candidates.length} retired key(s) are older than ${Math.round(minAge / 3_600_000)} h — retire one and wait; an active / next key or the root is never dropped`,
    };
  }
  const drop = new Set(candidates.slice(0, need).map((k) => k.kid));
  return { ok: true, keyring: { ...keyring, keys: keyring.keys.filter((k) => !drop.has(k.kid)) }, pruned: [...drop] };
}
