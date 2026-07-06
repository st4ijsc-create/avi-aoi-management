/**
 * Internal CA key management — doc 37 Đợt-C2 (năng lực 14).
 *
 * Manages the single internal Certificate Authority that signs device + service leaf
 * certs. Mirrors the license-key discipline: the CA PRIVATE key is generated ONCE and
 * kept OUT of the database (OS-keystore / ENV). Only the PUBLIC CA cert + metadata are
 * persisted (security_ca_metadata) so verifiers can pin the trust anchor.
 *
 * Key resolution order (first hit wins), most-secure first:
 *   1. ENV  INTERNAL_CA_PRIVATE_KEY_PEM  — operator-injected (prod; from an OS keystore).
 *   2. FILE  INTERNAL_CA_KEY_FILE  (or default keystore path under this module's dir).
 *            If the file is absent it is GENERATED and written 0600 (dev convenience).
 * The resolved key is cached in-process. Nothing here throws to callers on DB failure —
 * persistence is best-effort so cert issuance still works offline / pre-migration.
 */
import { createPrivateKey, createPublicKey, KeyObject } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateEd25519, mintEd25519Cert } from "./x509Mint";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Trust domain anchoring all SPIFFE-lite IDs + the CA subject. */
export function getTrustDomain(env: NodeJS.ProcessEnv = process.env): string {
  return (env.SECURITY_TRUST_DOMAIN || "st4i.local").trim();
}

export function getCaSubjectCn(env: NodeJS.ProcessEnv = process.env): string {
  return (env.INTERNAL_CA_SUBJECT_CN || `ST4I-Internal-CA-${getTrustDomain(env)}`).trim();
}

function keystorePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.INTERNAL_CA_KEY_FILE) return env.INTERNAL_CA_KEY_FILE;
  return path.resolve(__dirname, ".keystore", `internal-ca-${getTrustDomain(env)}.pem`);
}

export interface InternalCa {
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicKeyPem: string;
  subjectCn: string;
  trustDomain: string;
}

let _ca: InternalCa | null = null;

/** Load the CA private key from ENV, else from the keystore file, else generate+persist. */
async function resolveCaKey(env: NodeJS.ProcessEnv = process.env): Promise<KeyObject> {
  // 1. ENV (production)
  const envPem = (env.INTERNAL_CA_PRIVATE_KEY_PEM || "").trim();
  if (envPem) return createPrivateKey(envPem);

  // 2. Keystore file
  const file = keystorePath(env);
  try {
    const pem = await fs.readFile(file, "utf8");
    if (pem.trim()) return createPrivateKey(pem);
  } catch {
    /* missing → generate below */
  }

  // 3. Generate once + persist (dev convenience). Best-effort write; never fatal.
  const kp = generateEd25519();
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, kp.privateKeyPem, { mode: 0o600 });
    // Harden perms where supported (no-op on FAT/Windows).
    try {
      await fs.chmod(file, 0o600);
    } catch {
      /* ignore */
    }
  } catch (err) {
    console.warn(
      `[security/internalCa] could not persist CA key to ${file} — using in-memory CA for this process:`,
      (err as Error).message,
    );
  }
  return kp.privateKey;
}

/** Get the process-cached internal CA (loads/creates the key on first call). */
export async function getInternalCa(env: NodeJS.ProcessEnv = process.env): Promise<InternalCa> {
  if (_ca) return _ca;
  const privateKey = await resolveCaKey(env);
  const publicKey = createPublicKey(privateKey);
  _ca = {
    privateKey,
    publicKey,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    subjectCn: getCaSubjectCn(env),
    trustDomain: getTrustDomain(env),
  };
  return _ca;
}

/** Test-only: drop the cached CA so a fresh key/env is picked up. */
export function _resetInternalCaCache(): void {
  _ca = null;
}

export interface CaCertBundle {
  certPem: string;
  pubkeyPem: string;
  fingerprintSha256: string;
  subjectCn: string;
  trustDomain: string;
  notBefore: Date;
  notAfter: Date;
}

/** Mint (or re-mint) the self-signed CA certificate for the current CA key. */
export async function buildCaCert(days = 3650, env: NodeJS.ProcessEnv = process.env): Promise<CaCertBundle> {
  const ca = await getInternalCa(env);
  const spki = ca.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const r = mintEd25519Cert({
    subjectCN: ca.subjectCn,
    issuerCN: ca.subjectCn,
    subjectSpkiDer: spki,
    signingKey: ca.privateKey,
    days,
    isCa: true,
    serial: Buffer.from([0x01]),
  });
  return {
    certPem: r.pem,
    pubkeyPem: ca.publicKeyPem,
    fingerprintSha256: r.fingerprintSha256,
    subjectCn: ca.subjectCn,
    trustDomain: ca.trustDomain,
    notBefore: r.notBefore,
    notAfter: r.notAfter,
  };
}

/** Build a SPIFFE-lite ID for a workload name in this trust domain. */
export function spiffeId(kind: "service" | "device", name: string, env: NodeJS.ProcessEnv = process.env): string {
  const safe = String(name).replace(/[^a-zA-Z0-9._:\-/]/g, "-");
  return `spiffe://${getTrustDomain(env)}/${kind}/${safe}`;
}
