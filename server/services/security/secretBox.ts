/**
 * doc 54 A3 — reversible secret-at-rest box (AES-256-GCM).
 *
 * For secrets the server must be able to READ BACK to USE (unlike passwords, which are
 * one-way hashed) — e.g. an outbound broker connection password. Format:
 *
 *     enc:v1:<base64( iv(12) | tag(16) | ciphertext )>
 *
 * TRANSITIONAL: `decryptSecret` returns any NON-prefixed value verbatim, so legacy
 * plaintext rows keep working until they are re-written or backfilled. `encryptSecret`
 * is idempotent (already-encrypted input passes through unchanged).
 *
 * Key: `SECRET_ENCRYPTION_KEY` (preferred) else derived from `JWT_SECRET` via scrypt with
 * a fixed app salt (deterministic across restarts so ciphertext stays decryptable). Mirrors
 * the AES-256-GCM idiom already used by backupService.encryptConfigBundle.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const PREFIX = "enc:v1:";
const APP_SALT = "avi-secretbox-v1"; // fixed, non-secret salt → deterministic key derivation

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.SECRET_ENCRYPTION_KEY || process.env.JWT_SECRET || "";
  if (!raw) {
    throw new Error(
      "secretBox: neither SECRET_ENCRYPTION_KEY nor JWT_SECRET is set — cannot encrypt/decrypt secrets at rest.",
    );
  }
  cachedKey = scryptSync(raw, APP_SALT, 32);
  return cachedKey;
}

/** True if the value is already an `enc:v1:` ciphertext produced by this box. */
export function isEncrypted(v: string | null | undefined): boolean {
  return typeof v === "string" && v.startsWith(PREFIX);
}

/**
 * Encrypt a secret for at-rest storage. Passes through null/empty and already-encrypted
 * values unchanged (idempotent). Never throws for empty input; throws only if no key.
 */
export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === "") return (plaintext ?? null) as string | null;
  if (isEncrypted(plaintext)) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/**
 * Decrypt an at-rest secret. Returns null for null/empty. Returns a NON-prefixed value
 * verbatim (legacy plaintext passthrough). Returns null on tamper / wrong key (fail-safe).
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored == null || stored === "") return null;
  if (!isEncrypted(stored)) return String(stored);
  try {
    const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
