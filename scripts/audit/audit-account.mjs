// Bật/tắt account audit p1_audit_admin cho POC (doc 64 S5-OPT). node audit-account.mjs on|off
import postgres from "postgres";
import bcrypt from "bcryptjs";

const mode = process.argv[2];
const sql = postgres("postgresql://aoi:aoi@127.0.0.1:5434/aoi_management", { max: 1 });
try {
  if (mode === "on") {
    const hash = await bcrypt.hash("P1audit_2026x", 10);
    // doc65: account audit BẬT 2FA thật (adminProcedure đòi 2FA theo IEC 62443 — trạng thái
    // admin thật của hệ). Secret base32 cố định cho harness sinh TOTP (RFC test vector).
    // ★ Pha 7 Task 9 (9c) — hash + hạt giống TOTP ở `user_secrets`; cờ 2FA ở `users`.
    const r = await sql`UPDATE users SET "isActive" = true, two_factor_enabled = true, "passwordChangedAt" = now() WHERE username = 'p1_audit_admin' RETURNING id, username, "isActive", two_factor_enabled`;
    for (const u of r) {
      await sql`INSERT INTO user_secrets ("userId", "passwordHash", "twoFactorSecret", "updatedAt")
                VALUES (${u.id}, ${hash}, 'JBSWY3DPEHPK3PXP', now())
                ON CONFLICT ("userId") DO UPDATE
                  SET "passwordHash" = EXCLUDED."passwordHash",
                      "twoFactorSecret" = EXCLUDED."twoFactorSecret", "updatedAt" = now()`;
    }
    console.log("ACTIVATED:", JSON.stringify(r));
  } else if (mode === "off") {
    // ⚠ Sentinel `LOCKED-no-valid-hash` KHÔNG phải bcrypt — `comparePasswordConstantTime` đã biết
    //   và vẫn tốn đúng thời gian CPU (xem `server/_core/authService.ts`).
    const r = await sql`UPDATE users SET "isActive" = false WHERE username LIKE ${"p1_audit_%"} RETURNING id, username, "isActive"`;
    for (const u of r) {
      await sql`INSERT INTO user_secrets ("userId", "passwordHash", "updatedAt")
                VALUES (${u.id}, 'LOCKED-no-valid-hash', now())
                ON CONFLICT ("userId") DO UPDATE
                  SET "passwordHash" = 'LOCKED-no-valid-hash', "updatedAt" = now()`;
    }
    console.log("NEUTRALIZED:", JSON.stringify(r));
  } else {
    console.log("usage: on|off");
  }
} finally {
  await sql.end();
}
