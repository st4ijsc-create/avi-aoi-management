/**
 * Service identity — SPIFFE-lite JWT-SVID — doc 37 Đợt-C2 (năng lực 14).
 *
 * Gives every internal service a workload identity `spiffe://<trust-domain>/service/<name>`
 * and a short-lived JWT-SVID (Ed25519 / EdDSA, signed by the internal CA key) it presents
 * for service-to-service auth. This is the MVP form of mTLS: instead of a full TLS-client-cert
 * handshake (a transport/deployment concern — reverse-proxy / mesh), the caller carries a
 * signed bearer SVID and the callee verifies it with requireServiceIdentity().
 *
 * WHY JWT-SVID and not X.509-SVID here: an app-layer JWT verifies with zero transport changes
 * and no per-connection cert plumbing, which is the right altitude for an MVP seam. An X.509
 * service SVID can still be minted (issueServiceIdentity persists an optional leaf) for meshes
 * that want it later. FAIL-SAFE: enforcement gated by SERVICE_MTLS_ENABLED (default OFF).
 */
import { sign, verify } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { getDb } from "../../db";
import { serviceIdentities, type ServiceIdentity } from "../../../drizzle/schema/security";
import { getInternalCa, getTrustDomain, spiffeId, buildCaCert } from "./internalCa";
import { ensureCaPersisted } from "./deviceIdentityService";

/** Default JWT-SVID lifetime (seconds). Short-lived by design. */
export const SVID_TTL_SECONDS = 3600;

/** Is service mTLS / SPIFFE-lite ENFORCEMENT active? Default OFF. */
export function serviceMtlsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SERVICE_MTLS_ENABLED === "true" || env.SERVICE_MTLS_ENABLED === "1";
}

// ── base64url helpers ────────────────────────────────────────────────────────
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlJson(obj: unknown): string {
  return b64url(JSON.stringify(obj));
}
function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export interface JwtSvidClaims {
  /** SPIFFE-lite subject id. */
  sub: string;
  iss: string;
  aud?: string | string[];
  iat: number;
  exp: number;
  [k: string]: unknown;
}

/**
 * Mint a compact JWT-SVID for a service name, signed EdDSA by the internal CA key.
 * `header.kid` carries the CA fingerprint so a verifier can pin the anchor.
 */
export async function issueJwtSvid(
  serviceName: string,
  opts: { audience?: string | string[]; ttlSeconds?: number } = {},
): Promise<{ token: string; spiffeId: string; expiresAt: Date }> {
  const ca = await getInternalCa();
  const bundle = await buildCaCert().catch(() => null);
  const sub = spiffeId("service", serviceName);
  const now = Math.floor(Date.now() / 1000);
  const ttl = opts.ttlSeconds ?? SVID_TTL_SECONDS;
  const exp = now + ttl;

  const header = { alg: "EdDSA", typ: "JWT", kid: bundle?.fingerprintSha256 ?? "internal-ca" };
  const payload: JwtSvidClaims = {
    sub,
    iss: `spiffe://${getTrustDomain()}`,
    aud: opts.audience,
    iat: now,
    exp,
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const signature = sign(null, Buffer.from(signingInput, "utf8"), ca.privateKey);
  return { token: `${signingInput}.${b64url(signature)}`, spiffeId: sub, expiresAt: new Date(exp * 1000) };
}

export interface VerifyJwtSvidResult {
  valid: boolean;
  reason: string;
  spiffeId?: string;
  claims?: JwtSvidClaims;
}

/**
 * Verify a JWT-SVID: EdDSA signature against the internal CA public key + exp/nbf + audience.
 * FAIL-SAFE: SERVICE_MTLS_ENABLED OFF → {valid:true, reason:"flag-off"} (soft allow).
 */
export async function verifyJwtSvid(
  token: string,
  opts: { audience?: string; enabled?: boolean } = {},
): Promise<VerifyJwtSvidResult> {
  const enabled = opts.enabled ?? serviceMtlsEnabled();
  if (!enabled) return { valid: true, reason: "flag-off" };

  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "malformed token" };
  const [h, p, s] = parts;

  let claims: JwtSvidClaims;
  try {
    const header = JSON.parse(fromB64url(h).toString("utf8")) as { alg?: string };
    if (header.alg !== "EdDSA") return { valid: false, reason: "unsupported alg" };
    claims = JSON.parse(fromB64url(p).toString("utf8")) as JwtSvidClaims;
  } catch {
    return { valid: false, reason: "unparseable token" };
  }

  try {
    const ca = await getInternalCa();
    const ok = verify(null, Buffer.from(`${h}.${p}`, "utf8"), ca.publicKey, fromB64url(s));
    if (!ok) return { valid: false, reason: "bad signature" };
  } catch (err) {
    return { valid: false, reason: `CA unavailable: ${(err as Error).message}` };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && claims.exp < now) return { valid: false, reason: "expired" };
  if (typeof claims.iat === "number" && claims.iat > now + 60) return { valid: false, reason: "issued in the future" };
  if (opts.audience && claims.aud) {
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(opts.audience)) return { valid: false, reason: "audience mismatch" };
  }
  if (!claims.sub?.startsWith(`spiffe://${getTrustDomain()}/`)) {
    return { valid: false, reason: "subject not in trust domain" };
  }
  return { valid: true, reason: "ok", spiffeId: claims.sub, claims };
}

/**
 * Register (or refresh) a service identity row. Optionally mints an X.509 SVID leaf too.
 * Idempotent on spiffeId.
 */
export async function issueServiceIdentity(
  serviceName: string,
  opts: { withCert?: boolean; days?: number } = {},
): Promise<ServiceIdentity> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const caId = await ensureCaPersisted();
  const sid = spiffeId("service", serviceName);

  let certPem: string | null = null;
  let pubkeyPem: string | null = null;
  let fpr: string | null = null;
  let notBefore: Date | null = null;
  let notAfter: Date | null = null;

  if (opts.withCert) {
    const { generateEd25519, mintEd25519Cert } = await import("./x509Mint");
    const ca = await getInternalCa();
    const kp = generateEd25519();
    const spki = kp.publicKey.export({ type: "spki", format: "der" }) as Buffer;
    const minted = mintEd25519Cert({
      subjectCN: sid,
      issuerCN: ca.subjectCn,
      subjectSpkiDer: spki,
      signingKey: ca.privateKey,
      days: opts.days ?? 30,
      isCa: false,
    });
    certPem = minted.pem;
    pubkeyPem = kp.publicKeyPem;
    fpr = minted.fingerprintSha256;
    notBefore = minted.notBefore;
    notAfter = minted.notAfter;
  }

  const existing = await db
    .select()
    .from(serviceIdentities)
    .where(eq(serviceIdentities.spiffeId, sid))
    .limit(1);

  if (existing.length > 0) {
    const updated = await db
      .update(serviceIdentities)
      .set({
        serviceName,
        status: "active",
        certPem,
        pubkeyPem,
        fingerprintSha256: fpr,
        issuedBy: caId,
        notBefore,
        notAfter,
        updatedAt: new Date(),
      })
      .where(eq(serviceIdentities.id, existing[0].id))
      .returning();
    return updated[0];
  }

  const inserted = await db
    .insert(serviceIdentities)
    .values({
      serviceName,
      spiffeId: sid,
      certPem,
      pubkeyPem,
      fingerprintSha256: fpr,
      issuedBy: caId,
      status: "active",
      notBefore,
      notAfter,
    })
    .returning();
  return inserted[0];
}

export async function listServiceIdentities(): Promise<ServiceIdentity[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(serviceIdentities).orderBy(desc(serviceIdentities.createdAt)).limit(500);
}

export async function revokeServiceIdentity(id: number): Promise<ServiceIdentity | null> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const updated = await db
    .update(serviceIdentities)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(eq(serviceIdentities.id, id))
    .returning();
  return updated[0] ?? null;
}
