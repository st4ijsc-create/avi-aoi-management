/**
 * doc 65 — login account audit VỚI 2FA thật (adminProcedure đòi 2FA theo IEC 62443;
 * audit-account.mjs "on" set secret base32 cố định). Dùng chung cho s5-poc/s6-pro-audit.
 */
import speakeasy from "speakeasy";

export const AUDIT_SECRET_B32 = "JBSWY3DPEHPK3PXP";

/** Login p1_audit_admin trên context Playwright: POST login → verify-2fa bằng TOTP. */
export async function loginAuditAdmin(ctx, BASE) {
  const r1 = await ctx.request.post(BASE + "/api/auth/login", {
    data: { username: "p1_audit_admin", password: "P1audit_2026x" },
    headers: { "Content-Type": "application/json" },
  });
  const j1 = await r1.json().catch(() => ({}));
  if (j1?.requires2FA) {
    const token = speakeasy.totp({ secret: AUDIT_SECRET_B32, encoding: "base32" });
    const r2 = await ctx.request.post(BASE + "/api/auth/verify-2fa", {
      data: { userId: j1.userId, token },
      headers: { "Content-Type": "application/json" },
    });
    if (!r2.ok()) throw new Error("verify-2fa failed: " + r2.status());
  } else if (!j1?.success) {
    throw new Error("login failed: " + JSON.stringify(j1).slice(0, 200));
  }
}
