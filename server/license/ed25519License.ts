/**
 * Ed25519 license signing/verification — SYNAPSE §4.3 (doc 33 §3.3 / F4 · P2).
 *
 * The current license is RSA-2048 signed; SYNAPSE specifies Ed25519 (smaller, faster, modern).
 * This adds an Ed25519 path ALONGSIDE RSA (additive, non-breaking) so licenses can be issued
 * either way and verified offline. Uses Node's built-in Ed25519 (no dependency).
 *
 * Also scaffolds TPM-bound hardware fingerprints: the fingerprint combines CPU/MAC/disk and,
 * when available, a TPM endorsement key — the strongest anti-clone binding for conservative
 * air-gapped customers. Reading the TPM EK needs a platform agent (deferred); this module
 * defines the strategy + combines whatever sources are provided.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, createHash } from "node:crypto";

/** Stable, key-sorted JSON so signing/verification are deterministic (self-contained). */
export function canonicalClaims(claims: unknown): string {
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(norm);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = norm((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return JSON.stringify(norm(claims));
}

export interface Ed25519Keypair {
  publicKeyPem: string;
  privateKeyPem: string;
}

/** Generate an Ed25519 keypair (PEM). For the license issuer (offline). */
export function generateEd25519Keypair(): Ed25519Keypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/** Sign license claims → base64 signature. */
export function signLicenseEd25519(claims: unknown, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  const data = Buffer.from(canonicalClaims(claims), "utf8");
  // Ed25519: algorithm MUST be null (PureEdDSA).
  return sign(null, data, key).toString("base64");
}

/** Verify license claims against an Ed25519 signature (base64). Never throws → false on error. */
export function verifyLicenseEd25519(claims: unknown, signatureB64: string, publicKeyPem: string): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    const data = Buffer.from(canonicalClaims(claims), "utf8");
    return verify(null, data, key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

// ── TPM-bound hardware fingerprint (scaffold) ────────────────────────────────

export interface FingerprintSources {
  cpuId?: string;
  macAddresses?: string[];
  diskSerial?: string;
  motherboardId?: string;
  /** TPM 2.0 endorsement-key public (hex/base64) — strongest binding when present. */
  tpmEkPublic?: string;
}

export interface FingerprintResult {
  fingerprint: string;
  /** Which sources contributed (transparency for support). */
  usedSources: string[];
  /** True when a TPM EK was included (highest assurance). */
  tpmBound: boolean;
}

/**
 * Derive a stable machine fingerprint from whatever sources are available. TPM-bound when a
 * TPM EK is supplied; otherwise falls back to CPU/MAC/disk/mobo (still stable, weaker binding).
 */
export function deriveFingerprint(sources: FingerprintSources): FingerprintResult {
  const parts: string[] = [];
  const used: string[] = [];
  const add = (label: string, val?: string | string[]) => {
    if (val === undefined) return;
    const s = Array.isArray(val) ? [...val].sort().join(",") : val;
    if (s.length === 0) return;
    parts.push(`${label}:${s}`);
    used.push(label);
  };
  add("tpm", sources.tpmEkPublic);
  add("cpu", sources.cpuId);
  add("mac", sources.macAddresses);
  add("disk", sources.diskSerial);
  add("mobo", sources.motherboardId);
  const fingerprint = createHash("sha256").update(parts.join("|")).digest("hex");
  return { fingerprint, usedSources: used, tpmBound: !!sources.tpmEkPublic };
}
