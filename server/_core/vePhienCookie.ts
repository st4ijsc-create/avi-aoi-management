/**
 * ★★★ ONE reader of the session ticket in a Cookie header (SCADA R1b-2a T3 fix round 3, re-review C-2).
 *
 * Callers, which MUST agree byte for byte on the ticket string:
 *   · `sdk.xacThucTho` — the real authentication path (createContext → authenticateRequest, REST);
 *   · `trpcGioiHanThuTuc.phienKyVaVe` — the HMI STOP tier's ticket (rateLimitConfig `createHmiStopLimiter` key + skip).
 * Before this helper the limiter used a hand-written regex while auth used `cookie.parse`. `cookie` trims spaces / tabs around the name AND
 * the value, so `app_session_id= T`, `app_session_id =T` and `app_session_id =T; app_session_id=junk` looked unsigned to the STOP tier
 * (⇒ general tier, a fresh raw-text bucket per variant) while auth accepted T ⇒ one revoked ticket had unbounded STOPs, one ledger SELECT
 * each. Same parser ⇒ same string ⇒ the STOP tier sees exactly the ticket auth will verify.
 *
 * Semantics are `cookie` 1.x `parse`: names and values are trimmed, the FIRST occurrence of a duplicated name wins, values are %-decoded
 * (a bad %-sequence is returned raw — the verifier then rejects it).
 * ⚠ Not the general limiter's key function (`rateLimitConfig.credentialKey`) — that one is owned elsewhere (kiem-dinh W21) and is untouched.
 */
import { COOKIE_NAME } from "@shared/const";
import { createHash } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";

/** The session ticket string as auth reads it, or undefined (no header / no such cookie). */
export function docVePhienTuCookie(cookieHeader: string | undefined | null): string | undefined {
  if (!cookieHeader) return undefined;
  return parseCookieHeader(cookieHeader)[COOKIE_NAME];
}

/**
 * Ticket SHAPE test: a compact JWS has exactly three "."-separated segments (empty ones allowed here — a malformed `a.b.` still has the SHAPE
 * of a ticket and is then refused by the verifier, i.e. it is counted per IP, never per its raw text). Used by the general limiter (W21) to tell a
 * session ticket (Bearer / cookie) from an API key (no dots). Not a validity check.
 */
export function coHinhJws(ve: string): boolean {
  return ve.split(".").length === 3;
}

/**
 * The SIGNED part of a compact JWS: `header.payload`, i.e. everything before the last ".", which is the literal HMAC input.
 * The whole token string is NOT canonical: jose still verifies a ticket whose SIGNATURE segment carries whitespace / newlines, a trailing space,
 * "=" padding or a non-canonical last base64url char, so a key over the whole string gave one ticket unlimited buckets (kiem-dinh W21 / R1b-2a T3 C-1).
 * Any change to `header.payload` breaks verification; the random `jti` keeps two sessions of one person apart. null unless the ticket is a compact
 * JWS of EXACTLY 3 non-empty "."-separated segments, so a caller can never hash a non-JWS.
 */
export function phanDaKyCuaVe(ve: string): string | null {
  const phan = ve.split(".");
  if (phan.length !== 3 || phan.some((x) => x.length === 0)) return null;
  return `${phan[0]}.${phan[1]}`;
}

/**
 * First `doDai` hex chars of sha256(the signed part) of a ticket — the "which session" half of every rate-limit key (general tier W21: 32, HMI STOP
 * tier: 16). null when the ticket is not a 3-segment JWS. The raw token is never logged or stored — only this prefix appears, inside a limiter key.
 */
export function bamPhanDaKy(ve: string, doDai: number): string | null {
  const daKy = phanDaKyCuaVe(ve);
  return daKy === null ? null : createHash("sha256").update(daKy).digest("hex").slice(0, doDai);
}
