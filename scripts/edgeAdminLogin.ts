/**
 * doc 81 Đợt 10 task F2 round 2 — Đợt 9 final-wave N7, in full, for the edge operator CLIs (edge-node-credential.ts,
 * edge-device-owner.ts): the admin's password / 2FA code come from EXACTLY two channels —
 *   • a TTY: a hidden prompt (password, then the 2FA code when the account has 2FA on and none was given);
 *   • no TTY: PIPED STDIN — line 1 the password, line 2 (optional) the current 2FA code, e.g.
 *       printf '%s\n%s\n' "$PW" "$CODE" | npx tsx scripts/edge-node-credential.ts issue …   (or < a 0600 file)
 * — and NEVER from argv (any `--password…` / `--otp…` spelling is refused by the CLIs) or from an ENVIRONMENT VARIABLE: an env
 * var set inline lands in shell history, is inherited by every child process and invites keeping it in `.env`. The previous
 * variables (EDGE_CRED_ADMIN_PASSWORD / _OTP, EDGE_OWNER_ADMIN_PASSWORD / _OTP) are REFUSED with exit 2, not ignored, so a
 * script still exporting them fails loudly instead of silently prompting.
 */
import type { Readable } from "node:stream";

export interface AdminLoginIo {
  /** a hidden prompt on the controlling terminal; null ⇒ no terminal */
  promptSecret?: (label: string) => Promise<string | null>;
  /** everything piped on stdin; null ⇒ stdin is a terminal (nothing piped) */
  readStdin?: () => Promise<string | null>;
}
export interface AdminSecrets {
  password: string | null;
  otp: string | null;
  /** true ⇒ read from a terminal, a missing 2FA code may be asked */
  interactive: boolean;
}

/** The secret environment variables that are SET (non-empty) — the caller refuses with exit 2 when any is. */
export function setSecretEnv(env: NodeJS.ProcessEnv, names: readonly string[]): string[] {
  return names.filter((n) => typeof env[n] === "string" && env[n]!.length > 0);
}

/** Password (+ optional 2FA code) from the TTY prompt, else from piped stdin; nothing ⇒ nulls (the proof then refuses). */
export async function readAdminSecrets(io: AdminLoginIo, actorName: string): Promise<AdminSecrets> {
  if (io.promptSecret) {
    const pw = await io.promptSecret(`password of ${actorName}: `);
    if (pw !== null) return { password: pw, otp: null, interactive: true };
  }
  if (io.readStdin) {
    const text = await io.readStdin();
    if (text !== null) {
      const lines = text.split(/\r?\n/);
      const otp = (lines[1] ?? "").trim();
      return { password: lines[0] ?? "", otp: otp || null, interactive: false };
    }
  }
  return { password: null, otp: null, interactive: false };
}

/** Run the admin proof; a missing 2FA code is asked ONCE on the terminal (never on piped stdin — give it as line 2 there). */
export async function proveAdminWith<T>(
  verify: (login: { username: string; password: string | null; otp: string | null }) => Promise<T>,
  io: AdminLoginIo,
  actorName: string,
  secrets: AdminSecrets,
): Promise<T> {
  try {
    return await verify({ username: actorName, password: secrets.password, otp: secrets.otp });
  } catch (err) {
    if ((err as { code?: string })?.code !== "otpRequired" || secrets.otp || !secrets.interactive || !io.promptSecret) throw err;
    const otp = await io.promptSecret("2FA code: ");
    return verify({ username: actorName, password: secrets.password, otp });
  }
}

/** MAX bytes read from piped stdin (a password + a code; anything bigger is not a login). */
export const STDIN_LIMIT_BYTES = 64 * 1024;

/** The real stdin reader for the CLIs' main: null on a TTY; else all piped bytes (≤ STDIN_LIMIT_BYTES, else refused). */
export function stdinReader(stdin: Readable & { isTTY?: boolean } = process.stdin): () => Promise<string | null> {
  return () =>
    new Promise((resolve, reject) => {
      if (stdin.isTTY) return resolve(null);
      const chunks: Buffer[] = [];
      let size = 0;
      stdin.on("data", (c: Buffer | string) => {
        const b = typeof c === "string" ? Buffer.from(c) : c;
        size += b.length;
        if (size > STDIN_LIMIT_BYTES) {
          stdin.destroy();
          return reject(new Error(`stdin larger than ${STDIN_LIMIT_BYTES} bytes — not a login`));
        }
        chunks.push(b);
      });
      stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      stdin.on("error", reject);
    });
}
