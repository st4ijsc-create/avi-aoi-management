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
 * KEY CUSTODY (central, the internalCa.ts discipline): the PRIVATE key comes from EDGE_SIGNING_KEY_PEM or
 * EDGE_SIGNING_KEY_FILE (mode 0600 on POSIX) and is NEVER in the DB; scripts/edge-signing-key.ts manages it. Public keys go
 * to `edge_auth_signing_keys` (mig 0373) for audit and distribution. A DB writer alone must never be able to add a trusted
 * key: every non-genesis key row carries an ENDORSEMENT signed by the key that was active when it was generated
 * (endorseEdgeKey), and buildEdgeKeyset includes only the loaded signer, the rows it endorsed (transitively) and the rows that
 * endorsed it (its ancestors, up to the GENESIS = provisioning root).
 *
 * TRUST ON THE EDGE (fix scan 2): the ONLY trust anchor is an EdgeTrustStore — LOCAL state built from the keyset PINNED
 * at provisioning (edge-keyset.json, every pinned key active and open-ended) plus the keyset updates it accepted itself,
 * each verified with the keys trusted BEFORE it (never the keys the update brings), signed by a key ACTIVE there, with a
 * strictly higher version, keeping EVERY pinned key unchanged and active — the pinned root is only replaced by
 * re-provisioning. verifyEdgeObject refuses any other anchor (a plain keyset object, e.g. one carried by the same message,
 * is never trusted: `untrusted_keyset`). Validity windows use the store's own clock, never a time from a claim. The typed
 * verifiers (node / run / claim / TTL binding) are in edgeTrust.ts. Rotation = add a new signer (generate → next, activate →
 * both active, ≥ 2 config cycles, switch central's key file, retire the previous non-root signer); it never revokes the root.
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
import { readFileSync, statSync } from "node:fs";
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

/** The pin file content written at provisioning: the provisioning root(s) only, active, open-ended. */
export function edgePinnedKeyset(roots: ReadonlyArray<{ kid: string; publicKeyPem: string; notBefore: number }>, nowMs = Date.now()): EdgeKeyset {
  const ks: EdgeKeyset = { v: 1, version: 1, issuedAt: nowMs, keys: roots.map((r) => ({ kid: r.kid, publicKeyPem: r.publicKeyPem, status: "active", notBefore: r.notBefore, notAfter: null })) };
  const p = parseEdgeKeyset(ks);
  if (!p.ok) throw new Error(`edgePinnedKeyset: ${p.reason}`);
  return p.keyset;
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
): { ok: true; keyset: EdgeKeyset; same: boolean } | { ok: false; reason: EdgeKeysetUpdateFailure } {
  try {
    const r = verifyAgainst(update, "keyset", trusted, nowMs, skewMs);
    if (!r.ok) return { ok: false, reason: r.reason };
    if (!r.key || r.key.status !== "active") return { ok: false, reason: "signer_not_active" };
    const parsed = parseEdgeKeyset(r.payload);
    if (!parsed.ok) return { ok: false, reason: "invalid_keyset" };
    if (parsed.keyset.version === trusted.version && edgeCanonicalJson(parsed.keyset) === edgeCanonicalJson(trusted)) return { ok: true, keyset: trusted, same: true };
    if (!(parsed.keyset.version > trusted.version)) return { ok: false, reason: "rollback" };
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

  static fromPinned(pin: unknown, opts: EdgeTrustOptions, updates: readonly unknown[] = []): EdgeTrustStore {
    const p = parseEdgeKeyset(pin);
    if (!p.ok) throw new EdgeTrustError(`pinned keyset refused: ${p.reason}`);
    if (!p.keyset.keys.every((k) => k.status === "active" && k.notAfter === null)) throw new EdgeTrustError("pinned keyset: every pinned key must be active and open-ended");
    if (!Number.isSafeInteger(opts.nodeId) || opts.nodeId <= 0) throw new EdgeTrustError("nodeId must be a positive integer");
    const skew = opts.skewMs ?? 5_000;
    const state: TrustState = {
      pinned: clone(p.keyset),
      current: clone(p.keyset),
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
   * a strictly higher version (the same version, identical, is a no-op), keeping every pinned key active and open-ended.
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
    const r = checkKeysetUpdate(s.pinned, s.current, update, now, s.skewMs);
    if (!r.ok) return r;
    if (r.same) return { ok: true, version: s.current.version, changed: false };
    s.current = clone(r.keyset);
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

// ── key endorsement + central keyset assembly ──────────────────────────────────────────────────────────────────────

/** What an endorsement covers (the key row's identity; mig 0373 keeps these write-once). */
export interface EdgeKeyRowIdentity {
  kid: string;
  publicKeyPem: string;
  /** epoch ms (a Date from the DB is accepted) */
  notBefore: number | Date;
}
function endorsementText(row: EdgeKeyRowIdentity): string {
  return edgeCanonicalJson({ kind: "key_endorsement", kid: row.kid, publicKeyPem: row.publicKeyPem, notBefore: new Date(row.notBefore).getTime() });
}

/** The endorsement (base64url signature) of a new key row by the key active when it was generated (the CLI). */
export function endorseEdgeKey(endorser: EdgeSigningKey, row: EdgeKeyRowIdentity): string {
  return cryptoSign(null, edgeSigningInput("keyset", endorser.kid, endorsementText(row)), endorser.privateKey).toString("base64url");
}

export function verifyEdgeKeyEndorsement(
  row: EdgeKeyRowIdentity & { endorsedByKid: string | null; endorsementSig: string | null },
  endorserPublicKeyPem: string,
): boolean {
  try {
    if (!row.endorsedByKid || !row.endorsementSig || !SIG_RE.test(row.endorsementSig)) return false;
    if (edgeKidOf(endorserPublicKeyPem) !== row.endorsedByKid) return false;
    if (edgeKidOf(row.publicKeyPem) !== row.kid) return false;
    const sig = Buffer.from(row.endorsementSig, "base64url");
    if (sig.length !== 64 || sig.toString("base64url") !== row.endorsementSig) return false;
    return cryptoVerify(null, edgeSigningInput("keyset", row.endorsedByKid, endorsementText(row)), publicKeyOf(endorserPublicKeyPem), sig) === true;
  } catch {
    return false;
  }
}

/** A row of `edge_auth_signing_keys` as buildEdgeKeyset reads it. */
export interface EdgeSigningKeyRow extends EdgeKeyRowIdentity {
  status: EdgeKeyStatus;
  retiredAt: number | Date | null;
  endorsedByKid: string | null;
  endorsementSig: string | null;
}

/**
 * The keyset central distributes (B signs it with `signEdgeObject("keyset", …)` and ships it in the config). Included:
 *   • the LOADED signer — always, status active, open-ended (whatever its row says: central signs with it right now);
 *   • the PROVISIONING ROOT — the first ancestor of the signer without an endorsement (the genesis key, pinned by every
 *     edge): always active and open-ended, whatever its row says (edges refuse a keyset without it — R-10-a);
 *   • rows it endorsed, transitively, and rows that endorsed it, transitively — each endorsement verified; a row whose kid
 *     is not its key's fingerprint is never included; DB status active ⇒ active (a published second signer), next ⇒ next
 *     (cannot verify yet), retired ⇒ retired until retiredAt + retiredGraceMs (max auth TTL + skew), then dropped.
 * Returns { keyset, rootKid } — rootKid = the provisioning root (to write the pin file: edgePinnedKeyset). Keys ordered by
 * notBefore, then kid. Pure — no DB.
 */
export function buildEdgeKeyset(
  rows: readonly EdgeSigningKeyRow[],
  signer: EdgeSigningKey,
  opts: { version: number; nowMs?: number; retiredGraceMs: number },
): { keyset: EdgeKeyset; rootKid: string } {
  const nowMs = opts.nowMs ?? Date.now();
  const sane = rows.filter((r) => {
    try {
      return EDGE_KID_RE.test(r.kid) && edgeKidOf(r.publicKeyPem) === r.kid;
    } catch {
      return false;
    }
  });
  const byKid = new Map<string, EdgeSigningKeyRow>();
  for (const r of sane) if (!byKid.has(r.kid)) byKid.set(r.kid, r);
  const trusted = new Map<string, string>([[signer.kid, signer.publicKeyPem]]);
  // ancestors: walk back along verified endorsements; the last one reached is the provisioning root
  let rootKid = signer.kid;
  let cur = byKid.get(signer.kid);
  const guard = new Set<string>([signer.kid]);
  while (cur?.endorsedByKid && !guard.has(cur.endorsedByKid)) {
    const parent = byKid.get(cur.endorsedByKid);
    if (!parent || !verifyEdgeKeyEndorsement(cur, parent.publicKeyPem)) break;
    trusted.set(parent.kid, parent.publicKeyPem);
    guard.add(parent.kid);
    rootKid = parent.kid;
    cur = parent;
  }
  // descendants: fixpoint over rows endorsed by a trusted key
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of byKid.values()) {
      if (trusted.has(r.kid) || !r.endorsedByKid) continue;
      const by = trusted.get(r.endorsedByKid);
      if (by && verifyEdgeKeyEndorsement(r, by)) {
        trusted.set(r.kid, r.publicKeyPem);
        changed = true;
      }
    }
  }
  const keys: EdgeKeysetKey[] = [];
  for (const kid of trusted.keys()) {
    const r = byKid.get(kid);
    const rowNotBefore = r ? new Date(r.notBefore).getTime() : nowMs;
    if (kid === signer.kid || kid === rootKid) {
      keys.push({ kid, publicKeyPem: trusted.get(kid)!, status: "active", notBefore: Math.min(rowNotBefore, nowMs), notAfter: null });
      continue;
    }
    if (!r) continue;
    if (r.status === "retired") {
      const retiredAt = r.retiredAt === null ? nowMs : new Date(r.retiredAt).getTime();
      const notAfter = retiredAt + opts.retiredGraceMs;
      if (notAfter < nowMs) continue;
      keys.push({ kid, publicKeyPem: r.publicKeyPem, status: "retired", notBefore: Math.min(rowNotBefore, notAfter), notAfter });
    } else {
      keys.push({ kid, publicKeyPem: r.publicKeyPem, status: r.status, notBefore: rowNotBefore, notAfter: null });
    }
  }
  keys.sort((a, b) => a.notBefore - b.notBefore || (a.kid < b.kid ? -1 : a.kid > b.kid ? 1 : 0));
  return { keyset: { v: 1, version: opts.version, issuedAt: nowMs, keys }, rootKid };
}
