/**
 * doc 48 R4 — RBAC procedure migration proof. The 19 Part-A procedures were moved
 * off admin-hardgate onto requirePermission(module, action). This asserts the
 * new gate logic end-to-end via checkPermission with REAL dev users:
 *  - a granted non-admin (supervisor1, has production_orders canCreate) passes,
 *  - an ungranted non-admin (operator1) is denied,
 *  - admin still passes (scoped-admin OFF by default).
 * Also implicitly validates resolvePermissionModule doesn't mis-alias the module.
 *
 * Run: npx tsx scripts/verify/rbac-migration-proof.ts
 */
import "dotenv/config";
import { checkPermission } from "../../server/_core/accessControl";

let pass = true;
const c = (n: string, got: boolean, want: boolean) => {
  if (got !== want) pass = false;
  console.log(`  ${got === want ? "✓" : "✗ FAIL"} ${n}: got ${got}, want ${want}`);
};

async function main() {
  console.log("=== migrated production_orders gate (writeProcedure path) ===");
  c("supervisor1 (granted) canCreate", await checkPermission(49, "supervisor", "production_orders", "canCreate"), true);
  c("operator1 (ungranted) canCreate", await checkPermission(48, "operator", "production_orders", "canCreate"), false);
  c("admin still allowed (scoped-admin OFF)", await checkPermission(1, "admin", "production_orders", "canCreate"), true);

  console.log(`\nRESULT: ${pass ? "PASS ✓ — granted non-admin passes, ungranted denied, admin OK" : "FAIL ✗"}`);
  process.exit(pass ? 0 : 1);
}
main().catch((e) => {
  console.error("proof error:", e);
  process.exit(2);
});
