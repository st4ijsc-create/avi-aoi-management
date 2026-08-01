/**
 * Service-identity verification middleware seam — doc 37 Đợt-C2 (năng lực 14).
 *
 * The ONE enforcement seam for SPIFFE-lite service-to-service auth. A caller presents a
 * JWT-SVID via `Authorization: SVID <token>` (or the `x-svid` header); this verifies it
 * against the internal CA and, on success, attaches `req.serviceIdentity`.
 *
 * FAIL-SAFE (doc 37):
 *   • SERVICE_MTLS_ENABLED OFF  → pass-through, NO enforcement (current behaviour preserved).
 *   • flag ON + valid SVID      → allow, attach identity.
 *   • flag ON + missing/invalid → 401 deny.
 *   • flag ON + transient error → allow-with-log (never hard-fail an internal call on a
 *                                 verifier hiccup; the crypto path already threw only on
 *                                 CA-unavailable, which is logged).
 *
 * Kept framework-light: `requireServiceIdentity()` returns an Express-style middleware, and
 * `checkPeerIdentity(headers)` is a pure helper any other seam (tRPC ctx, socket handshake)
 * can call directly.
 */
import { serviceMtlsEnabled, verifyJwtSvid, type VerifyJwtSvidResult } from "./serviceIdentityService";

/** Minimal header bag (case-insensitive keys as delivered by Node/Express). */
export type HeaderBag = Record<string, string | string[] | undefined>;

function headerValue(headers: HeaderBag, name: string): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/** Extract a bearer SVID from `Authorization: SVID <t>` / `Bearer <t>` or `x-svid`. */
export function extractSvid(headers: HeaderBag): string | undefined {
  const auth = headerValue(headers, "authorization");
  if (auth) {
    const m = /^(?:SVID|Bearer)\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  const x = headerValue(headers, "x-svid");
  return x?.trim() || undefined;
}

export interface PeerIdentityResult extends VerifyJwtSvidResult {
  /** True when the request may proceed (allow / soft-allow / transient allow-with-log). */
  allow: boolean;
}

/**
 * Pure verification of a peer's headers. Encapsulates the fail-safe policy so every seam
 * (Express, tRPC, socket) shares ONE decision.
 */
export async function checkPeerIdentity(
  headers: HeaderBag,
  opts: { audience?: string; enabled?: boolean } = {},
): Promise<PeerIdentityResult> {
  const enabled = opts.enabled ?? serviceMtlsEnabled();
  if (!enabled) return { allow: true, valid: true, reason: "flag-off" };

  const token = extractSvid(headers);
  if (!token) return { allow: false, valid: false, reason: "missing SVID" };

  const res = await verifyJwtSvid(token, { audience: opts.audience, enabled: true });
  if (res.valid) return { allow: true, ...res };

  // Transient CA-unavailable → allow-with-log; cryptographic invalidity → deny.
  if (/CA unavailable/i.test(res.reason)) {
    console.warn("[security/serviceIdentity] transient verify failure (allow-with-log):", res.reason);
    return { allow: true, ...res, reason: `allow-with-log: ${res.reason}` };
  }
  return { allow: false, ...res };
}

/** Express-style req shape (structural — no express type dependency). */
interface ReqLike {
  headers: HeaderBag;
  serviceIdentity?: { spiffeId?: string; claims?: unknown };
}
interface ResLike {
  status(code: number): { json(body: unknown): unknown };
}
type NextFn = (err?: unknown) => void;

/**
 * Build the Express middleware. Wire onto internal service routes the wave-lead designates
 * (NOT wired here). Non-breaking to mount: does nothing until SERVICE_MTLS_ENABLED=true.
 */
export function requireServiceIdentity(opts: { audience?: string } = {}) {
  return async (req: ReqLike, res: ResLike, next: NextFn): Promise<void> => {
    try {
      const result = await checkPeerIdentity(req.headers, opts);
      if (result.allow) {
        if (result.spiffeId) req.serviceIdentity = { spiffeId: result.spiffeId, claims: result.claims };
        return next();
      }
      res.status(401).json({ error: "service identity required", reason: result.reason });
    } catch (err) {
      // Never crash a request on an unexpected verifier error under fail-safe.
      console.warn("[security/serviceIdentity] middleware error (allow-with-log):", (err as Error).message);
      next();
    }
  };
}
