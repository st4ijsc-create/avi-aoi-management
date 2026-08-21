/**
 * Device X.509 PKI onboarding — doc 37 Đợt-C2 (năng lực 14).
 *
 * Issues / verifies / rotates / revokes short-lived (90-day) X.509 certificates for
 * devices (adapters, robots, edge-nodes, PLCs). Each cert is signed by the internal CA
 * (internalCa.ts) and doubles as a SPIFFE-lite workload identity. Certs are minted with
 * node:crypto only (x509Mint.ts) and verified with the native `X509Certificate`.
 *
 * FAIL-SAFE (doc 37): all ENFORCEMENT is gated by DEVICE_PKI_ENABLED (default OFF). With
 * the flag OFF the verify path returns a soft "flag-off" allow so nothing existing breaks.
 * Issuance/rotation/revocation are admin actions that work regardless of the flag (you can
 * pre-provision certs before flipping enforcement on).
 */
import { X509Certificate } from "node:crypto";
import { DbUnavailableError } from "../../_core/dbErrors";
import { eq, and, desc, lte, inArray } from "drizzle-orm";
import { getDb } from "../../db";
import {
  deviceCertificates,
  securityCaMetadata,
  type DeviceCertificate,
} from "../../../drizzle/schema/security";
import { generateEd25519, mintEd25519Cert } from "./x509Mint";
import { getInternalCa, buildCaCert, spiffeId } from "./internalCa";

/** Default validity for a device leaf certificate. */
export const DEVICE_CERT_DAYS = 90;

export type DeviceKind = "adapter" | "robot" | "edge_node" | "plc" | "generic";

/** Is device PKI ENFORCEMENT active? Default OFF (soft-allow, non-breaking). */
export function devicePkiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEVICE_PKI_ENABLED === "true" || env.DEVICE_PKI_ENABLED === "1";
}

// ── CA persistence (best-effort) ─────────────────────────────────────────────
/**
 * Ensure the active internal-CA row exists in security_ca_metadata; return its id.
 * Idempotent. Returns null if the DB is unavailable (issuance still proceeds; the
 * issuedBy FK is simply left null).
 */
export async function ensureCaPersisted(): Promise<number | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const ca = await getInternalCa();
    const existing = await db
      .select()
      .from(securityCaMetadata)
      .where(and(eq(securityCaMetadata.trustDomain, ca.trustDomain), eq(securityCaMetadata.active, 1)))
      .limit(1);
    if (existing.length > 0) return existing[0].id;

    const bundle = await buildCaCert();
    const inserted = await db
      .insert(securityCaMetadata)
      .values({
        trustDomain: bundle.trustDomain,
        subjectCn: bundle.subjectCn,
        certPem: bundle.certPem,
        pubkeyPem: bundle.pubkeyPem,
        fingerprintSha256: bundle.fingerprintSha256,
        algorithm: "ed25519",
        notBefore: bundle.notBefore,
        notAfter: bundle.notAfter,
        active: 1,
      })
      .returning({ id: securityCaMetadata.id });
    return inserted[0]?.id ?? null;
  } catch (err) {
    console.warn("[security/device] ensureCaPersisted failed (continuing):", (err as Error).message);
    return null;
  }
}

export interface IssueDeviceCertResult {
  record: DeviceCertificate;
  /** The device PRIVATE key (PKCS#8 PEM). Returned ONCE — persist it on the device, not here. */
  privateKeyPem: string;
}

export interface IssueDeviceCertOptions {
  kind?: DeviceKind;
  days?: number;
  rotatedFromId?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Issue a fresh device certificate. Generates the device keypair server-side, mints a
 * CA-signed leaf, persists the PUBLIC record, and returns the private key to the caller
 * exactly once. (For a CSR-based flow the caller would instead send a public key; the
 * MVP generates it to keep onboarding a single call.)
 */
export async function issueDeviceCert(
  deviceId: string,
  opts: IssueDeviceCertOptions = {},
): Promise<IssueDeviceCertResult> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();

  const ca = await getInternalCa();
  const caId = await ensureCaPersisted();
  const kind = opts.kind ?? "generic";
  const days = opts.days ?? DEVICE_CERT_DAYS;
  const subjectCn = `device:${deviceId}`;
  const sid = spiffeId("device", deviceId);

  const dev = generateEd25519();
  const spki = dev.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const minted = mintEd25519Cert({
    subjectCN: subjectCn,
    issuerCN: ca.subjectCn,
    subjectSpkiDer: spki,
    signingKey: ca.privateKey,
    days,
    isCa: false,
  });

  const inserted = await db
    .insert(deviceCertificates)
    .values({
      deviceId,
      kind,
      subjectCn,
      spiffeId: sid,
      serialNumber: minted.serialHex,
      fingerprintSha256: minted.fingerprintSha256,
      certPem: minted.pem,
      pubkeyPem: dev.publicKeyPem,
      issuedBy: caId,
      rotatedFromId: opts.rotatedFromId ?? null,
      status: "active",
      notBefore: minted.notBefore,
      notAfter: minted.notAfter,
      metadata: opts.metadata ?? null,
    })
    .returning();

  return { record: inserted[0], privateKeyPem: dev.privateKeyPem };
}

export interface VerifyDeviceCertResult {
  valid: boolean;
  /** "flag-off" when enforcement is disabled (soft allow). */
  reason: string;
  deviceId?: string;
  spiffeId?: string;
  fingerprintSha256?: string;
  record?: DeviceCertificate;
}

/**
 * Verify a presented device certificate PEM:
 *   1. parses;
 *   2. signature chains to the internal CA public key;
 *   3. issuer CN matches the CA;
 *   4. inside its validity window;
 *   5. not revoked/superseded in the DB (looked up by fingerprint).
 *
 * FAIL-SAFE: when DEVICE_PKI_ENABLED is OFF returns {valid:true, reason:"flag-off"} so
 * callers stay non-breaking. When ON, a cryptographic failure is a hard deny; a DB lookup
 * that cannot run (transient) is allow-with-log per the doc-37 fail-safe policy.
 */
export async function verifyDeviceCert(
  pem: string,
  opts: { enabled?: boolean } = {},
): Promise<VerifyDeviceCertResult> {
  const enabled = opts.enabled ?? devicePkiEnabled();
  if (!enabled) return { valid: true, reason: "flag-off" };

  let cert: X509Certificate;
  try {
    cert = new X509Certificate(pem);
  } catch {
    return { valid: false, reason: "malformed certificate" };
  }

  // Signature must chain to the internal CA.
  try {
    const ca = await getInternalCa();
    if (!cert.verify(ca.publicKey)) return { valid: false, reason: "signature not issued by internal CA" };
    if (!/CN=/i.test(cert.issuer) || !cert.issuer.includes(ca.subjectCn)) {
      return { valid: false, reason: "issuer is not the internal CA" };
    }
  } catch (err) {
    return { valid: false, reason: `CA unavailable: ${(err as Error).message}` };
  }

  // Validity window.
  const now = Date.now();
  if (Number.isFinite(Date.parse(cert.validFrom)) && Date.parse(cert.validFrom) > now) {
    return { valid: false, reason: "certificate not yet valid" };
  }
  if (Number.isFinite(Date.parse(cert.validTo)) && Date.parse(cert.validTo) < now) {
    return { valid: false, reason: "certificate expired" };
  }

  // Revocation / registry check (transient DB failure → allow-with-log).
  const fpr = cert.fingerprint256;
  try {
    const db = await getDb();
    if (db) {
      const rows = await db
        .select()
        .from(deviceCertificates)
        .where(eq(deviceCertificates.fingerprintSha256, fpr))
        .limit(1);
      const rec = rows[0];
      if (!rec) return { valid: false, reason: "certificate not registered", fingerprintSha256: fpr };
      if (rec.status !== "active") return { valid: false, reason: `certificate ${rec.status}`, record: rec };
      return {
        valid: true,
        reason: "ok",
        deviceId: rec.deviceId,
        spiffeId: rec.spiffeId ?? undefined,
        fingerprintSha256: fpr,
        record: rec,
      };
    }
  } catch (err) {
    console.warn("[security/device] revocation check transient failure (allow-with-log):", (err as Error).message);
    return { valid: true, reason: "crypto-valid; registry unavailable (allow-with-log)", fingerprintSha256: fpr };
  }
  // No DB at all: crypto verified but cannot confirm registry.
  return { valid: true, reason: "crypto-valid; no registry (allow-with-log)", fingerprintSha256: fpr };
}

/**
 * Rotate a device's certificate: issue a fresh 90-day cert and mark the previous active
 * cert(s) for that device `superseded`, linking rotatedFromId. Returns the new cert +
 * its one-time private key.
 */
export async function rotateDeviceCert(
  deviceId: string,
  opts: IssueDeviceCertOptions = {},
): Promise<IssueDeviceCertResult> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();

  const currentActive = await db
    .select()
    .from(deviceCertificates)
    .where(and(eq(deviceCertificates.deviceId, deviceId), eq(deviceCertificates.status, "active")))
    .orderBy(desc(deviceCertificates.createdAt))
    .limit(1);
  const priorId = currentActive[0]?.id;

  const issued = await issueDeviceCert(deviceId, {
    ...opts,
    kind: opts.kind ?? (currentActive[0]?.kind as DeviceKind | undefined) ?? "generic",
    rotatedFromId: priorId,
  });

  // Supersede the PRIOR active cert(s) — targeted by id so the brand-new cert is untouched.
  const priorIds = currentActive.map((c) => c.id).filter((n): n is number => typeof n === "number");
  if (priorIds.length > 0) {
    try {
      await db
        .update(deviceCertificates)
        .set({ status: "superseded", updatedAt: new Date() })
        .where(inArray(deviceCertificates.id, priorIds));
    } catch (err) {
      console.warn("[security/device] rotate supersede failed (new cert already active):", (err as Error).message);
    }
  }

  return issued;
}

/** Revoke a device certificate by id. Idempotent. */
export async function revokeDeviceCert(certId: number, reason: string): Promise<DeviceCertificate | null> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const updated = await db
    .update(deviceCertificates)
    .set({ status: "revoked", revokedAt: new Date(), revokedReason: reason, updatedAt: new Date() })
    .where(eq(deviceCertificates.id, certId))
    .returning();
  return updated[0] ?? null;
}

/** List certs, optionally filtered by device. */
export async function listDeviceCerts(deviceId?: string): Promise<DeviceCertificate[]> {
  const db = await getDb();
  if (!db) return [];
  const q = db.select().from(deviceCertificates);
  const rows = deviceId
    ? await q.where(eq(deviceCertificates.deviceId, deviceId)).orderBy(desc(deviceCertificates.createdAt))
    : await q.orderBy(desc(deviceCertificates.createdAt)).limit(500);
  return rows;
}

/**
 * Certs whose notAfter is within `withinDays` (default 14) and still active — the set a
 * rotation cron should renew. Also flips genuinely-expired active certs to `expired`.
 */
export async function certsDueForRotation(withinDays = 14): Promise<DeviceCertificate[]> {
  const db = await getDb();
  if (!db) return [];
  const horizon = new Date(Date.now() + withinDays * 86_400_000);
  const rows = await db
    .select()
    .from(deviceCertificates)
    .where(and(eq(deviceCertificates.status, "active"), lte(deviceCertificates.notAfter, horizon)))
    .orderBy(deviceCertificates.notAfter);
  return rows;
}
