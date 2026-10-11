/**
 * doc 81 Đợt 10 task A (design §2.13) — Ed25519 signing of everything central hands the edge that the edge must trust:
 * per-step authorisations (`auth`), the config snapshot (`config`), the run package / sweep picture (`runpkg`), central's
 * commands (`cmd`) and keyset updates (`keyset`).
 *
 * WIRE FORM (EdgeSignedEnvelope, strict — unknown keys refused):
 *   { typ: "avi-edge-<typ>+v1", alg: "EdDSA", kid: "edk_<22 b64url>", payload: <JSON>, sig: <86 b64url chars = 64 bytes> }
 * SIGNED BYTES (edgeSigningInput):
 *   "avi-edge-v1\n" + <typ> + "\n" + canonicalJSON({ kid, payload })
 *   — the domain prefix carries the SHORT typ, so a config / command / keyset signature can never be passed off as an
 *     authorisation (and relabelling the envelope's `typ` breaks the signature); `kid` is inside the signed bytes.
 * CANONICAL JSON (edgeCanonicalJson): keys sorted (UTF-16 order) at every depth, arrays in order, no whitespace, -0 → 0,
 *   undefined object members dropped; NaN / ±Infinity / bigint / Date / Map / Buffer / functions / undefined in an array /
 *   nesting deeper than 64 are REFUSED (they have no single JSON form, so signer and verifier could disagree).
 * KID = "edk_" + first 22 base64url chars of sha256(SPKI DER) — a fingerprint: a keyset entry whose kid is not its own
 *   key's fingerprint is refused (parseEdgeKeyset), so "an attacker key under a valid kid" can only fail the signature.
 *
 * KEY CUSTODY (central, the internalCa.ts discipline): the PRIVATE key comes from EDGE_SIGNING_KEY_PEM or
 * EDGE_SIGNING_KEY_FILE (mode 0600 on POSIX) and is NEVER in the DB; scripts/edge-signing-key.ts manages it. Public keys go
 * to `edge_auth_signing_keys` (mig 0373) for audit and distribution. A DB writer alone must never be able to add a trusted
 * key: every non-genesis key row carries an ENDORSEMENT signed by the key that was active when it was generated
 * (endorseEdgeKey — typ `keyset`, payload kind "key_endorsement"), and buildEdgeKeyset includes only the loaded signer, the
 * rows it endorsed (transitively) and the rows that endorsed it (its ancestors). Rows without a verifiable endorsement are
 * left out.
 *
 * TRUST ON THE EDGE: the keyset pinned at provisioning (edge-keyset.json, parseEdgeKeyset); afterwards only keyset updates
 * signed by a currently trusted, non-retired key, with a strictly higher version (verifyEdgeKeysetUpdate / Chain).
 * Validity: a key verifies only inside [notBefore − skew, notAfter + skew]; `status` is informational except that a retired
 * key can never sign a keyset update.
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

function assertTyp(typ: unknown): asserts typ is EdgeSignedTyp {
  if (!(EDGE_SIGNED_TYPS as readonly unknown[]).includes(typ)) throw new Error(`edgeSigning: unknown typ ${String(typ)}`);
}

/** The exact bytes signed for (typ, kid, payload). Throws on a payload without one JSON form or a bad typ. */
export function edgeSigningInput(typ: EdgeSignedTyp, kid: string, payload: unknown): Buffer {
  assertTyp(typ);
  return Buffer.from(`${EDGE_SIGNING_DOMAIN}\n${typ}\n${edgeCanonicalJson({ kid, payload })}`, "utf8");
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

let _centralKey: { key: EdgeSigningKey | null } | null = null;
/** loadEdgeSigningKey(process.env), cached for the process after the first successful load (null is not cached). */
export function getCentralEdgeSigningKey(): EdgeSigningKey | null {
  if (_centralKey?.key) return _centralKey.key;
  const key = loadEdgeSigningKey();
  if (key) _centralKey = { key };
  return key;
}
/** Tests only. */
export function __resetCentralEdgeSigningKeyForTests(): void {
  _centralKey = null;
}

// ── envelope ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface EdgeSignedEnvelope<T = unknown> {
  typ: string;
  alg: typeof EDGE_SIG_ALG;
  kid: string;
  payload: T;
  sig: string;
}

/** Strict wire schema of a signed envelope (the payload is checked by the caller's own strict schema after verification). */
export const edgeSignedEnvelopeSchema = z.strictObject({
  typ: z.enum(Object.values(EDGE_TYP_NAME) as [string, ...string[]]),
  alg: z.literal(EDGE_SIG_ALG),
  kid: z.string().regex(EDGE_KID_RE),
  payload: z.unknown(),
  sig: z.string().regex(SIG_RE),
});

export function signEdgeObject<T>(typ: EdgeSignedTyp, payload: T, key: EdgeSigningKey): EdgeSignedEnvelope<T> {
  const input = edgeSigningInput(typ, key.kid, payload);
  const sig = cryptoSign(null, input, key.privateKey).toString("base64url");
  return { typ: EDGE_TYP_NAME[typ], alg: EDGE_SIG_ALG, kid: key.kid, payload, sig };
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
}

// ── verification ────────────────────────────────────────────────────────────────────────────────────────────────────

export type EdgeVerifyFailure = "malformed" | "bad_alg" | "wrong_typ" | "unknown_kid" | "key_not_valid" | "bad_signature" | "claim_mismatch";
export type EdgeVerifyResult<T = unknown> = { ok: true; payload: T; kid: string } | { ok: false; reason: EdgeVerifyFailure };
export interface EdgeVerifyOptions {
  /** wall clock for the key validity window (default Date.now()) */
  nowMs?: number;
  /** tolerated clock skew for the key validity window (default 5 s) */
  skewMs?: number;
}

function keyUsableAt(k: EdgeKeysetKey, nowMs: number, skewMs: number): boolean {
  if (nowMs + skewMs < k.notBefore) return false;
  if (k.notAfter !== null && nowMs - skewMs > k.notAfter) return false;
  return true;
}

function verifyWithKey(raw: unknown, expectedTyp: EdgeSignedTyp, keyset: EdgeKeyset, opts: EdgeVerifyOptions): (EdgeVerifyResult & { key?: EdgeKeysetKey }) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "malformed" };
  if ((raw as Record<string, unknown>).alg !== EDGE_SIG_ALG) return { ok: false, reason: "bad_alg" };
  const p = edgeSignedEnvelopeSchema.safeParse(raw);
  if (!p.success) return { ok: false, reason: "malformed" };
  const env = p.data;
  const sig = Buffer.from(env.sig, "base64url");
  if (sig.length !== 64 || sig.toString("base64url") !== env.sig) return { ok: false, reason: "malformed" };
  if (env.typ !== EDGE_TYP_NAME[expectedTyp]) return { ok: false, reason: "wrong_typ" };
  const key = keyset.keys.find((k) => k.kid === env.kid);
  if (!key) return { ok: false, reason: "unknown_kid" };
  if (!keyUsableAt(key, opts.nowMs ?? Date.now(), opts.skewMs ?? 5_000)) return { ok: false, reason: "key_not_valid" };
  let input: Buffer;
  try {
    input = edgeSigningInput(expectedTyp, env.kid, env.payload);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  let good = false;
  try {
    good = cryptoVerify(null, input, publicKeyOf(key.publicKeyPem), sig);
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: "bad_signature" };
  const pl = env.payload;
  if (pl && typeof pl === "object" && !Array.isArray(pl)) {
    const o = pl as Record<string, unknown>;
    if ("kid" in o && o.kid !== env.kid) return { ok: false, reason: "claim_mismatch" };
    if ("typ" in o && o.typ !== EDGE_TYP_NAME[expectedTyp]) return { ok: false, reason: "claim_mismatch" };
  }
  return { ok: true, payload: pl, kid: env.kid, key };
}

/**
 * Verify a signed envelope of the expected typ against an ALREADY-TRUSTED keyset. Never throws. On success the payload
 * is returned as parsed JSON — the caller still validates it with its own strict schema (edgeProtocol).
 */
export function verifyEdgeObject<T = unknown>(raw: unknown, expectedTyp: EdgeSignedTyp, keyset: EdgeKeyset, opts: EdgeVerifyOptions = {}): EdgeVerifyResult<T> {
  const r = verifyWithKey(raw, expectedTyp, keyset, opts);
  if (!r.ok) return r;
  return { ok: true, payload: r.payload as T, kid: r.kid };
}

export type EdgeKeysetUpdateFailure = EdgeVerifyFailure | "rollback" | "invalid_keyset";

/** One link of the chain: signed (typ keyset) by a trusted NON-retired key, a valid keyset, a strictly higher version. */
export function verifyEdgeKeysetUpdate(
  trusted: EdgeKeyset,
  update: unknown,
  opts: EdgeVerifyOptions = {},
): { ok: true; keyset: EdgeKeyset } | { ok: false; reason: EdgeKeysetUpdateFailure } {
  const r = verifyWithKey(update, "keyset", trusted, opts);
  if (!r.ok) return r;
  if (!r.key || r.key.status === "retired") return { ok: false, reason: "key_not_valid" };
  const parsed = parseEdgeKeyset(r.payload);
  if (!parsed.ok) return { ok: false, reason: "invalid_keyset" };
  if (parsed.keyset.version <= trusted.version) return { ok: false, reason: "rollback" };
  return { ok: true, keyset: parsed.keyset };
}

/** Apply updates in order from the pinned keyset; the first broken link stops the chain (its index is returned). */
export function verifyEdgeKeysetChain(
  pinned: EdgeKeyset,
  updates: readonly unknown[],
  opts: EdgeVerifyOptions = {},
): { ok: true; keyset: EdgeKeyset } | { ok: false; reason: EdgeKeysetUpdateFailure; index: number } {
  let cur = pinned;
  for (let i = 0; i < updates.length; i++) {
    const r = verifyEdgeKeysetUpdate(cur, updates[i], opts);
    if (!r.ok) return { ok: false, reason: r.reason, index: i };
    cur = r.keyset;
  }
  return { ok: true, keyset: cur };
}

// ── key endorsement + central keyset assembly ──────────────────────────────────────────────────────────────────────

/** What an endorsement covers (the key row's identity; mig 0373 keeps these write-once). */
export interface EdgeKeyRowIdentity {
  kid: string;
  publicKeyPem: string;
  /** epoch ms (a Date from the DB is accepted) */
  notBefore: number | Date;
}
function endorsementPayload(row: EdgeKeyRowIdentity) {
  return { kind: "key_endorsement", kid: row.kid, publicKeyPem: row.publicKeyPem, notBefore: new Date(row.notBefore).getTime() };
}

/** The endorsement (base64url signature) of a new key row by the key active when it was generated (the CLI). */
export function endorseEdgeKey(endorser: EdgeSigningKey, row: EdgeKeyRowIdentity): string {
  return cryptoSign(null, edgeSigningInput("keyset", endorser.kid, endorsementPayload(row)), endorser.privateKey).toString("base64url");
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
    return cryptoVerify(null, edgeSigningInput("keyset", row.endorsedByKid, endorsementPayload(row)), publicKeyOf(endorserPublicKeyPem), sig);
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
 *   • rows it endorsed, transitively (next keys), and rows that endorsed it, transitively (its retired predecessors),
 *     each endorsement verified; a row whose kid is not its key's fingerprint is never included;
 *   • a retired row only until retiredAt + retiredGraceMs (max auth TTL + skew), as notAfter.
 * Order: notBefore, then kid. Pure — no DB.
 */
export function buildEdgeKeyset(
  rows: readonly EdgeSigningKeyRow[],
  signer: EdgeSigningKey,
  opts: { version: number; nowMs?: number; retiredGraceMs: number },
): EdgeKeyset {
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
  // ancestors: walk back along verified endorsements
  let cur = byKid.get(signer.kid);
  const guard = new Set<string>([signer.kid]);
  while (cur?.endorsedByKid && !guard.has(cur.endorsedByKid)) {
    const parent = byKid.get(cur.endorsedByKid);
    if (!parent || !verifyEdgeKeyEndorsement(cur, parent.publicKeyPem)) break;
    trusted.set(parent.kid, parent.publicKeyPem);
    guard.add(parent.kid);
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
    if (kid === signer.kid) {
      keys.push({ kid, publicKeyPem: signer.publicKeyPem, status: "active", notBefore: r ? Math.min(new Date(r.notBefore).getTime(), nowMs) : nowMs, notAfter: null });
      continue;
    }
    if (!r) continue;
    const notBefore = new Date(r.notBefore).getTime();
    if (r.status === "retired") {
      const retiredAt = r.retiredAt === null ? nowMs : new Date(r.retiredAt).getTime();
      const notAfter = retiredAt + opts.retiredGraceMs;
      if (notAfter < nowMs) continue;
      keys.push({ kid, publicKeyPem: r.publicKeyPem, status: "retired", notBefore: Math.min(notBefore, notAfter), notAfter });
    } else {
      // a second "active" row other than the loaded signer is published as next (only the loaded key signs)
      keys.push({ kid, publicKeyPem: r.publicKeyPem, status: "next", notBefore, notAfter: null });
    }
  }
  keys.sort((a, b) => a.notBefore - b.notBefore || (a.kid < b.kid ? -1 : a.kid > b.kid ? 1 : 0));
  return { v: 1, version: opts.version, issuedAt: nowMs, keys };
}
