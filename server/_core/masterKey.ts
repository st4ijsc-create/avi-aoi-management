import { timingSafeEqual } from "node:crypto";

/**
 * Master API key validation (security hardening — Phase 0 WS0.2).
 *
 * The MASTER_API_KEY grants broad external/admin access. Previously every
 * call site read `process.env.MASTER_API_KEY || "master_api_key_change_me"`,
 * so an unconfigured deployment accepted a well-known default as a valid key
 * (a backdoor). This module centralizes validation and, in production,
 * DISABLES master-key auth entirely when the key is unset or left at an
 * insecure default — rather than silently trusting the placeholder.
 *
 * DB-registered machine clients (x-api-key / x-machine-code) are unaffected;
 * only the shared master-key shortcut is gated.
 */
const INSECURE_DEFAULTS = new Set([
  "",
  "master_api_key_change_me",
  "change_this_master_api_key",
]);

let warned = false;
function warnOnce(message: string): void {
  if (!warned) {
    console.error(message);
    warned = true;
  }
}

/** True when MASTER_API_KEY is configured to a non-default, usable value. */
export function isMasterKeyConfigured(): boolean {
  const configured = (process.env.MASTER_API_KEY ?? "").trim();
  return !INSECURE_DEFAULTS.has(configured);
}

/**
 * Constant-time validation of a provided master key against MASTER_API_KEY.
 * Returns false (auth disabled) in production when the env is unset/default.
 */
export function isValidMasterKey(provided: string | undefined | null): boolean {
  const configured = (process.env.MASTER_API_KEY ?? "").trim();
  const isProd = process.env.NODE_ENV === "production";

  if (INSECURE_DEFAULTS.has(configured)) {
    if (isProd) {
      warnOnce(
        "[SECURITY] MASTER_API_KEY is unset or uses an insecure default — " +
          "master-key auth is DISABLED in production. Set a strong MASTER_API_KEY to enable it.",
      );
      return false;
    }
    // Non-production: allow matching the placeholder for local convenience.
  }

  const supplied = (provided ?? "").trim();
  if (!supplied || !configured) return false;

  const a = Buffer.from(supplied);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
