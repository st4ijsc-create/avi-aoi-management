/**
 * API key hashing utilities (GAP G13 — secrets at rest).
 *
 * Machine API keys are currently stored in plaintext in `machines.apiKey`.
 * This module provides the cryptographic primitives to migrate towards
 * hashed-at-rest storage without leaking secrets in the database.
 *
 * Design:
 *  - SHA-256(pepper || key) — deterministic so a presented key can be looked
 *    up by hash (unlike bcrypt). The optional pepper (API_KEY_PEPPER env) adds
 *    defence-in-depth against offline cracking if the DB is exfiltrated.
 *  - Constant-time comparison to avoid timing side-channels.
 *
 * Rollout is intentionally additive: generation/validation continue to work on
 * plaintext until the `apiKeyHash` column is backfilled and validation is
 * switched over. Use these helpers when wiring the hashed path.
 */
import { createHash, timingSafeEqual } from "node:crypto";

const PEPPER = process.env.API_KEY_PEPPER ?? "";

/** Deterministically hash an API key for at-rest storage / lookup. */
export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(PEPPER).update(apiKey).digest("hex");
}

/** Constant-time comparison of a presented key against a stored hash. */
export function verifyApiKey(presentedKey: string, storedHash: string): boolean {
  if (!presentedKey || !storedHash) return false;
  const a = Buffer.from(hashApiKey(presentedKey), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
