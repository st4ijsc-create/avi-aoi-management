/**
 * MB7 (doc 27 Đợt 6) — Short-lived signed tokens for the FactoryAlertSystem
 * APK download endpoint (GET /api/factory-alert/download/:version/:filename).
 *
 * Design:
 *  - GET /api/factory-alert/version.json mints a `downloadToken` bound to the
 *    active version + APK filename (HMAC-SHA256, 15-min TTL by default).
 *  - The app appends it as `?token=` (updateService.appendDownloadToken); the
 *    download route validates it. Android's DownloadManager/browser carries no
 *    session cookie, hence a query token instead of header/cookie auth.
 *  - Legacy fleet migration: app versions ≤ 1.0.15 download WITHOUT a token.
 *    While env FACTORY_ALERT_DOWNLOAD_OPEN is unset or "true" (current
 *    default) token-less requests are still allowed so the old fleet can
 *    update to the token-aware version. Tighten-later path: once the fleet is
 *    on ≥ 1.0.16, set FACTORY_ALERT_DOWNLOAD_OPEN=false — from then on only
 *    token-bearing (or session/master-key) requests succeed.
 *
 * Token format: `v1.<expEpochSeconds>.<hmacHex>` where
 *   hmacHex = HMAC_SHA256(secret, `${version}/${filename}:${exp}`)
 *
 * Env:
 *  - FACTORY_ALERT_DOWNLOAD_SECRET (optional dedicated secret; falls back to
 *    SESSION_SECRET → JWT_SECRET → MASTER_API_KEY → documented dev fallback,
 *    same convention as server/api/v1/erpOauth.ts)
 *  - FACTORY_ALERT_DOWNLOAD_TOKEN_TTL_SECONDS (default 900, clamped 60..86400)
 *  - FACTORY_ALERT_DOWNLOAD_OPEN ("true"/unset = legacy open mode; "false" = enforce)
 */
import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_VERSION = "v1";

function getSigningSecret(): string {
  return (
    process.env.FACTORY_ALERT_DOWNLOAD_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.JWT_SECRET ||
    process.env.MASTER_API_KEY ||
    "dev-factory-alert-download-secret-change-me"
  );
}

export function tokenTtlSeconds(): number {
  const v = Number(process.env.FACTORY_ALERT_DOWNLOAD_TOKEN_TTL_SECONDS);
  if (!Number.isFinite(v) || v <= 0) return 15 * 60;
  return Math.min(Math.max(Math.floor(v), 60), 24 * 60 * 60);
}

/**
 * Legacy open mode — token-less downloads allowed. Default TRUE for now so the
 * pre-token fleet keeps updating; flip to false after fleet reaches ≥ 1.0.16.
 */
export function isDownloadOpen(): boolean {
  const v = (process.env.FACTORY_ALERT_DOWNLOAD_OPEN ?? "true").trim().toLowerCase();
  return v !== "false" && v !== "0";
}

function signPayload(version: string, filename: string, exp: number): string {
  return createHmac("sha256", getSigningSecret())
    .update(`${version}/${filename}:${exp}`)
    .digest("hex");
}

/** Mint a download token bound to a specific version + APK filename. */
export function mintDownloadToken(version: string, filename: string, nowMs: number = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + tokenTtlSeconds();
  return `${TOKEN_VERSION}.${exp}.${signPayload(version, filename, exp)}`;
}

/**
 * Validate a download token for the given version + filename.
 * Returns { ok: true } or { ok: false, reason } (reason is for logs only —
 * callers should respond with a generic 401/403).
 */
export function verifyDownloadToken(
  token: string | undefined,
  version: string,
  filename: string,
  nowMs: number = Date.now(),
): { ok: boolean; reason?: string } {
  if (!token || typeof token !== "string") return { ok: false, reason: "missing" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return { ok: false, reason: "malformed" };
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp)) return { ok: false, reason: "malformed" };
  if (Math.floor(nowMs / 1000) > exp) return { ok: false, reason: "expired" };

  const expected = signPayload(version, filename, exp);
  const given = parts[2];
  if (given.length !== expected.length) return { ok: false, reason: "bad-signature" };
  try {
    const match = timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(expected, "utf8"));
    return match ? { ok: true } : { ok: false, reason: "bad-signature" };
  } catch {
    return { ok: false, reason: "bad-signature" };
  }
}
