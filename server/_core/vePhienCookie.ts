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
import { parse as parseCookieHeader } from "cookie";

/** The session ticket string as auth reads it, or undefined (no header / no such cookie). */
export function docVePhienTuCookie(cookieHeader: string | undefined | null): string | undefined {
  if (!cookieHeader) return undefined;
  return parseCookieHeader(cookieHeader)[COOKIE_NAME];
}
