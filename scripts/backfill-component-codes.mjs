#!/usr/bin/env node
/**
 * Doc 31 Đợt B (MP1 / PM6) — bulk BOM-driven componentCode backfill.
 *
 * Fills empty measurement_point_defs."componentCode" from each product's BOM
 * (bom_line_items.refDesignator → componentCode), which lights up the
 * Pareto-by-package analytic (W8-A / 0191). NON-DESTRUCTIVE: points that already
 * have a componentCode are never overwritten.
 *
 * DRY-RUN BY DEFAULT — prints the plan and writes nothing. Pass --apply to write.
 *
 * Usage:
 *   node scripts/backfill-component-codes.mjs                 # dry-run, ALL products
 *   node scripts/backfill-component-codes.mjs --apply         # write, ALL products
 *   node scripts/backfill-component-codes.mjs --product 12    # single product (dry-run)
 *   node scripts/backfill-component-codes.mjs --product 12 --apply
 *
 * Requires DATABASE_URL (read from .env) and the 0191 columns (already present).
 * Delegates to the SAME service the tRPC endpoint uses (no duplicated logic).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { register } from "tsx/esm/api";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── .env loader (same minimal parser as the migration runners) ───────────────
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.substring(0, idx).trim();
    let value = trimmed.substring(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(path.join(__dirname, "..", ".env"));

if (!process.env.DATABASE_URL) {
  console.error("[backfill-cc] DATABASE_URL not set (checked .env)");
  process.exit(1);
}

// ── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const apply = args.includes("--apply");
function intArg(name) {
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return undefined;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}
const onlyProduct = intArg("--product");

// ── resolve target product ids (raw SQL; independent of the drizzle app pool) ─
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
let productIds = [];
try {
  if (onlyProduct) {
    productIds = [onlyProduct];
  } else {
    const rows = await sql`
      SELECT id FROM product_models WHERE "deletedAt" IS NULL ORDER BY id`;
    productIds = rows.map((r) => r.id);
  }
} finally {
  await sql.end();
}

// ── run through the real service (tsx loader — no duplicated logic) ──────────
register();
const serviceUrl = pathToFileURL(
  path.join(__dirname, "..", "server", "services", "componentLinkBackfill.ts"),
).href;
const { backfillComponentCodesFromBom } = await import(serviceUrl);

console.log(
  `[backfill-cc] ${apply ? "APPLYING" : "DRY-RUN"} over ${productIds.length} product(s)${onlyProduct ? ` (product ${onlyProduct})` : ""} ...`,
);

const totals = { matched: 0, updated: 0, skippedAlreadyLinked: 0, unmatched: 0, products: 0 };
for (const pid of productIds) {
  const r = await backfillComponentCodesFromBom(pid, { dryRun: !apply });
  if (r.bomDefinitionId == null && r.matched === 0 && r.skippedAlreadyLinked === 0 && r.unmatched.length === 0) {
    continue; // nothing to do for this product (no BOM / no points)
  }
  totals.products++;
  totals.matched += r.matched;
  totals.updated += r.updated;
  totals.skippedAlreadyLinked += r.skippedAlreadyLinked;
  totals.unmatched += r.unmatched.length;
  console.log(
    `  product ${pid} (bom ${r.bomDefinitionId ?? "-"}): matched ${r.matched}, ` +
      `${apply ? `updated ${r.updated}` : "would update " + r.matched}, ` +
      `already-linked ${r.skippedAlreadyLinked}, unmatched ${r.unmatched.length}`,
  );
}

console.log(
  `[backfill-cc] done — products touched ${totals.products}, matched ${totals.matched}, ` +
    `${apply ? `updated ${totals.updated}` : "would update " + totals.matched}, ` +
    `already-linked ${totals.skippedAlreadyLinked}, unmatched ${totals.unmatched}.` +
    (apply ? "" : "  (dry-run — pass --apply to write)"),
);
process.exit(0);
