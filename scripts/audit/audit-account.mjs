// Bật/tắt account audit p1_audit_admin cho POC (doc 64 S5-OPT). node audit-account.mjs on|off
import postgres from "postgres";
import bcrypt from "bcryptjs";

const mode = process.argv[2];
const sql = postgres("postgresql://aoi:aoi@127.0.0.1:5434/aoi_management", { max: 1 });
try {
  if (mode === "on") {
    const hash = await bcrypt.hash("P1audit_2026x", 10);
    // two_factor_enabled=false: account POC không 2FA (neutralize phiên trước có thể đã bật)
    const r = await sql`UPDATE users SET "passwordHash" = ${hash}, "isActive" = true, two_factor_enabled = false, two_factor_secret = NULL WHERE username = 'p1_audit_admin' RETURNING id, username, "isActive", two_factor_enabled`;
    console.log("ACTIVATED:", JSON.stringify(r));
  } else if (mode === "off") {
    const r = await sql`UPDATE users SET "isActive" = false, "passwordHash" = 'LOCKED-no-valid-hash' WHERE username LIKE ${"p1_audit_%"} RETURNING username, "isActive"`;
    console.log("NEUTRALIZED:", JSON.stringify(r));
  } else {
    console.log("usage: on|off");
  }
} finally {
  await sql.end();
}
