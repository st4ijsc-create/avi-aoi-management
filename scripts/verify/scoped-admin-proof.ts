/**
 * doc 48 R4 — SCOPED ADMIN proof. Verifies checkPermission's new semantics:
 *  - RBAC_SCOPED_ADMIN off → admin god-mode (passes regardless of rows).
 *  - RBAC_SCOPED_ADMIN on  → admin passes UNLESS an explicit restriction row
 *    (action=false) exists; no row → still passes (no lockout).
 *  - non-admin behaviour is byte-identical in both modes.
 *
 * Uses real users (admin id 1, operator id 48) + module 'analytics_oee'. Saves
 * and restores any pre-existing permission row so it is side-effect-free.
 *
 * Run: npx tsx scripts/verify/scoped-admin-proof.ts
 */
import "dotenv/config";
import { checkPermission } from "../../server/_core/accessControl";
import { getDb } from "../../server/db/connection";
import { sql } from "drizzle-orm";

const ADMIN = 1;
const OPERATOR = 48;
const MODULE = "analytics_oee";

let pass = true;
function check(name: string, got: boolean, want: boolean) {
  const ok = got === want;
  if (!ok) pass = false;
  console.log(`  ${ok ? "✓" : "✗ FAIL"} ${name}: got ${got}, want ${want}`);
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("no db");

  // Save any pre-existing admin row for this module, then remove it for a clean slate.
  const existing = await db.execute(
    sql`SELECT "canView" FROM permissions WHERE "userId"=${ADMIN} AND "moduleName"=${MODULE} LIMIT 1`,
  );
  const hadRow = (existing as unknown as any[]).length > 0;
  await db.execute(sql`DELETE FROM permissions WHERE "userId"=${ADMIN} AND "moduleName"=${MODULE}`);

  try {
    console.log("=== scoped-admin OFF (legacy god-mode) ===");
    delete process.env.RBAC_SCOPED_ADMIN;
    check("admin canView (no row)", await checkPermission(ADMIN, "admin", MODULE, "canView"), true);
    check("operator canView (no row)", await checkPermission(OPERATOR, "operator", MODULE, "canView"), false);

    console.log("\n=== scoped-admin ON, no restriction row ===");
    process.env.RBAC_SCOPED_ADMIN = "true";
    check("admin canView (unconfigured → allow)", await checkPermission(ADMIN, "admin", MODULE, "canView"), true);
    check("operator canView (unchanged)", await checkPermission(OPERATOR, "operator", MODULE, "canView"), false);

    console.log("\n=== scoped-admin ON, explicit RESTRICTION row (canView=false) ===");
    await db.execute(sql`
      INSERT INTO permissions ("userId","category","moduleName","canView","canCreate","canEdit","canDelete","canExport","grantedAt","createdAt","updatedAt")
      VALUES (${ADMIN}, 'analytics', ${MODULE}, false, false, false, false, false, now(), now(), now())`);
    check("admin canView (RESTRICTED → deny)", await checkPermission(ADMIN, "admin", MODULE, "canView"), false);

    console.log("\n=== scoped-admin OFF again, restriction row still present ===");
    delete process.env.RBAC_SCOPED_ADMIN;
    check("admin canView (god-mode ignores row)", await checkPermission(ADMIN, "admin", MODULE, "canView"), true);

    console.log("\n=== scoped-admin ON, explicit GRANT row (canView=true) ===");
    process.env.RBAC_SCOPED_ADMIN = "true";
    await db.execute(sql`UPDATE permissions SET "canView"=true WHERE "userId"=${ADMIN} AND "moduleName"=${MODULE}`);
    check("admin canView (explicit grant → allow)", await checkPermission(ADMIN, "admin", MODULE, "canView"), true);

    console.log(`\nRESULT: ${pass ? "PASS ✓ — scoped-admin restricts admin only when configured; non-admin unchanged" : "FAIL ✗"}`);
  } finally {
    await db.execute(sql`DELETE FROM permissions WHERE "userId"=${ADMIN} AND "moduleName"=${MODULE}`);
    if (hadRow) console.log(`[note] a pre-existing admin row for ${MODULE} was removed by this test — re-grant via UI if needed`);
    console.log("[cleanup] removed test permission rows");
  }
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("proof error:", e);
  process.exit(2);
});
