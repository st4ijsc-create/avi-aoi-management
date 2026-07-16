#!/usr/bin/env node
/**
 * Master-data orphan/duplicate REPAIR helper (doc 27 §2 M1/M6/M11 — W3-A).
 * Companion to migrations 0179 (orphan audit) + 0180 (conditional enforcement)
 * and server/services/integrityScanService.ts (weekly scan). The scanKey list
 * below is kept in sync with those files (a vitest test cross-checks).
 *
 * MODES (never destructive by default):
 *   --dry-run   (DEFAULT) print per-relationship violation counts + sample rows.
 *   --fix       apply SAFE fixes only: NULL out dangling soft references
 *               (strategy 'set-null'). Structural orphans print guidance.
 *   --allow-delete  (only with --fix) additionally DELETE garbage join rows in
 *               product_machine_mappings (strategy 'delete-row') — a mapping
 *               row whose product/machine no longer exists carries no data.
 *   --rel <scanKey>  restrict to one relationship (repeatable).
 *
 * After a fix, the script attempts ALTER TABLE … VALIDATE CONSTRAINT for the
 * now-clean FK (harmless if the constraint is absent/already valid). Deferred
 * UNIQUE indexes still need a re-run of migration 0180 after dedupe:
 *   node run-0179-0180-migration.mjs --force
 *
 * Usage:
 *   node scripts/repair-orphans.mjs                       # report only
 *   node scripts/repair-orphans.mjs --fix                 # NULL-out soft refs
 *   node scripts/repair-orphans.mjs --fix --allow-delete  # + drop garbage mappings
 *   node scripts/repair-orphans.mjs --rel "fk:measurement_results.defectCatalogId->defect_catalog.id" --fix
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const FIX = argv.includes("--fix");
const ALLOW_DELETE = argv.includes("--allow-delete");
const ONLY = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === "--rel" && argv[i + 1]) ONLY.push(argv[i + 1]);

// Minimal .env loader (no deps) — same behaviour as scripts/migrate-standalone.mjs
if (!process.env.DATABASE_URL) {
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  }
}
if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL not set (env or .env).");
  process.exit(1);
}

/**
 * Relationship catalogue — keys/SQL mirror integrityScanService.ts + 0179/0180.
 * strategy: 'set-null' | 'delete-row' | 'manual'
 *   set-null   → fixSql NULLs the dangling reference (safe: soft annotation).
 *   delete-row → fixSql deletes the garbage row; gated behind --allow-delete.
 *   manual     → guidance only (structural data that a human must re-home).
 */
const RELATIONSHIPS = [
  {
    key: "fk:machines.stationId->stations.id",
    constraint: ["machines", "fk_machines_station"], strategy: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM machines c LEFT JOIN stations p ON c."stationId" = p.id WHERE p.id IS NULL',
    sampleSql: 'SELECT c.id, c.code, c."stationId" FROM machines c LEFT JOIN stations p ON c."stationId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20',
    guidance: "Re-home each machine to a real station (UPDATE machines SET \"stationId\" = <station> WHERE id = <id>) or soft-delete it. A machine without a station breaks the hierarchy rollup.",
  },
  {
    key: "fk:stations.lineId->production_lines.id",
    constraint: ["stations", "fk_stations_line"], strategy: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM stations c LEFT JOIN production_lines p ON c."lineId" = p.id WHERE p.id IS NULL',
    sampleSql: 'SELECT c.id, c.code, c."lineId" FROM stations c LEFT JOIN production_lines p ON c."lineId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20',
    guidance: "Re-home each station to a real production line, or recreate the missing line.",
  },
  {
    key: "fk:production_lines.workshopId->workshops.id",
    constraint: ["production_lines", "fk_production_lines_workshop"], strategy: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM production_lines c LEFT JOIN workshops p ON c."workshopId" = p.id WHERE p.id IS NULL',
    sampleSql: 'SELECT c.id, c.code, c."workshopId" FROM production_lines c LEFT JOIN workshops p ON c."workshopId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20',
    guidance: "Re-home each line to a real workshop, or recreate the missing workshop.",
  },
  {
    key: "fk:workshops.factoryId->factories.id",
    constraint: ["workshops", "fk_workshops_factory"], strategy: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM workshops c LEFT JOIN factories p ON c."factoryId" = p.id WHERE p.id IS NULL',
    sampleSql: 'SELECT c.id, c.code, c."factoryId" FROM workshops c LEFT JOIN factories p ON c."factoryId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20',
    guidance: "Re-home each workshop to a real factory, or recreate the missing factory.",
  },
  {
    key: "fk:factories.corporateCode->corporates.code",
    constraint: ["factories", "fk_factories_corporate"], strategy: "set-null",
    countSql: 'SELECT count(*)::bigint AS n FROM factories c LEFT JOIN corporates p ON c."corporateCode" = p.code WHERE c."corporateCode" IS NOT NULL AND p.id IS NULL',
    sampleSql: 'SELECT c.id, c.code, c."corporateCode" FROM factories c LEFT JOIN corporates p ON c."corporateCode" = p.code WHERE c."corporateCode" IS NOT NULL AND p.id IS NULL ORDER BY c.id LIMIT 20',
    fixSql: 'UPDATE factories c SET "corporateCode" = NULL WHERE c."corporateCode" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM corporates p WHERE p.code = c."corporateCode")',
    guidance: "NULL means 'no corporate' (legal). Alternatively recreate the corporate row with the referenced code.",
  },
  {
    key: "fk:product_inspections.machineId->machines.id",
    constraint: ["product_inspections", "fk_product_inspections_machine"], strategy: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM product_inspections c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL',
    sampleSql: 'SELECT c.id, c."machineId", c."serialNumber" FROM product_inspections c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20',
    guidance: "Inspection history for a hard-deleted machine. Either recreate a tombstone machine row with the old id, or archive these inspections. Do NOT bulk-delete quality records.",
  },
  {
    key: "fk:measurement_results.inspectionId->product_inspections.id",
    constraint: ["measurement_results", "fk_measurement_results_inspection"], strategy: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM measurement_results c LEFT JOIN product_inspections p ON c."inspectionId" = p.id WHERE p.id IS NULL',
    sampleSql: 'SELECT c.id, c."inspectionId" FROM measurement_results c LEFT JOIN product_inspections p ON c."inspectionId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20',
    guidance: "Results whose parent inspection is gone are unreachable by every query path. Review a sample, then delete them explicitly if confirmed garbage (DELETE ... WHERE id IN (...)). This script will not bulk-delete measurement data.",
  },
  {
    key: "fk:measurement_results.pointDefId->measurement_point_defs.id",
    constraint: ["measurement_results", "fk_measurement_results_point_def"], strategy: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM measurement_results c LEFT JOIN measurement_point_defs p ON c."pointDefId" = p.id WHERE p.id IS NULL',
    sampleSql: 'SELECT c."pointDefId", count(*)::int AS results FROM measurement_results c LEFT JOIN measurement_point_defs p ON c."pointDefId" = p.id WHERE p.id IS NULL GROUP BY c."pointDefId" ORDER BY results DESC LIMIT 20',
    guidance: "Legacy hard-deleted point definitions. Recommended: recreate placeholder rows in measurement_point_defs for the referenced ids (INSERT with the old id under the __UNMAPPED__ product model — see measurementPointResolver), which preserves analytics grouping; then re-apply 0180 to VALIDATE. Column is NOT NULL so it cannot be NULLed.",
  },
  {
    key: "fk:measurement_results.defectCatalogId->defect_catalog.id",
    constraint: ["measurement_results", "fk_measurement_results_defect_catalog"], strategy: "set-null",
    countSql: 'SELECT count(*)::bigint AS n FROM measurement_results c LEFT JOIN defect_catalog p ON c."defectCatalogId" = p.id WHERE c."defectCatalogId" IS NOT NULL AND p.id IS NULL',
    sampleSql: 'SELECT c.id, c."defectCatalogId" FROM measurement_results c LEFT JOIN defect_catalog p ON c."defectCatalogId" = p.id WHERE c."defectCatalogId" IS NOT NULL AND p.id IS NULL ORDER BY c.id LIMIT 20',
    fixSql: 'UPDATE measurement_results c SET "defectCatalogId" = NULL WHERE c."defectCatalogId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM defect_catalog p WHERE p.id = c."defectCatalogId")',
    guidance: "Soft annotation — NULLing detaches the dangling defect reference (M11).",
  },
  {
    key: "fk:product_machine_mappings.productModelId->product_models.id",
    constraint: ["product_machine_mappings", "fk_pm_mappings_product"], strategy: "delete-row",
    countSql: 'SELECT count(*)::bigint AS n FROM product_machine_mappings c LEFT JOIN product_models p ON c."productModelId" = p.id WHERE p.id IS NULL',
    sampleSql: 'SELECT c.id, c."productModelId", c."machineId" FROM product_machine_mappings c LEFT JOIN product_models p ON c."productModelId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20',
    fixSql: 'DELETE FROM product_machine_mappings c WHERE NOT EXISTS (SELECT 1 FROM product_models p WHERE p.id = c."productModelId")',
    guidance: "A join row without its product carries no information — delete (requires --fix --allow-delete).",
  },
  {
    key: "fk:product_machine_mappings.machineId->machines.id",
    constraint: ["product_machine_mappings", "fk_pm_mappings_machine"], strategy: "delete-row",
    countSql: 'SELECT count(*)::bigint AS n FROM product_machine_mappings c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL',
    sampleSql: 'SELECT c.id, c."productModelId", c."machineId" FROM product_machine_mappings c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20',
    fixSql: 'DELETE FROM product_machine_mappings c WHERE NOT EXISTS (SELECT 1 FROM machines p WHERE p.id = c."machineId")',
    guidance: "A join row without its machine carries no information — delete (requires --fix --allow-delete).",
  },
  {
    key: "fk:machine_recipes.machineId->machines.id",
    constraint: ["machine_recipes", "fk_machine_recipes_machine"], strategy: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM machine_recipes c LEFT JOIN machines p ON c."machineId" = p.id WHERE c."machineId" IS NOT NULL AND p.id IS NULL',
    sampleSql: 'SELECT c.id, c.code, c.version, c."machineId" FROM machine_recipes c LEFT JOIN machines p ON c."machineId" = p.id WHERE c."machineId" IS NOT NULL AND p.id IS NULL ORDER BY c.id LIMIT 20',
    guidance: "Decide per recipe: re-point to the replacement machine, or NULL machineId to demote it to a machine-TYPE recipe (semantic change — do it deliberately, not in bulk).",
  },
  {
    key: "fk:recipe_deployments.recipeId->machine_recipes.id",
    constraint: ["recipe_deployments", "fk_recipe_deployments_recipe"], strategy: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM recipe_deployments c LEFT JOIN machine_recipes p ON c."recipeId" = p.id WHERE p.id IS NULL',
    sampleSql: 'SELECT c.id, c."recipeId", c."machineId", c."deployedAt" FROM recipe_deployments c LEFT JOIN machine_recipes p ON c."recipeId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20',
    guidance: "Audit-grade deploy records referencing a hard-deleted recipe. Keep for audit; recreate a tombstone recipe row, or archive the deployment rows to cold storage before deleting.",
  },
  {
    key: "fk:recipe_deployments.machineId->machines.id",
    constraint: ["recipe_deployments", "fk_recipe_deployments_machine"], strategy: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM recipe_deployments c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL',
    sampleSql: 'SELECT c.id, c."recipeId", c."machineId", c."deployedAt" FROM recipe_deployments c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL ORDER BY c.id LIMIT 20',
    guidance: "Same as above — audit records; keep/tombstone/archive, do not bulk-delete silently.",
  },
  {
    key: "fk:recipe_deployments.previousRecipeId->machine_recipes.id",
    constraint: ["recipe_deployments", "fk_recipe_deployments_previous_recipe"], strategy: "set-null",
    countSql: 'SELECT count(*)::bigint AS n FROM recipe_deployments c LEFT JOIN machine_recipes p ON c."previousRecipeId" = p.id WHERE c."previousRecipeId" IS NOT NULL AND p.id IS NULL',
    sampleSql: 'SELECT c.id, c."previousRecipeId" FROM recipe_deployments c LEFT JOIN machine_recipes p ON c."previousRecipeId" = p.id WHERE c."previousRecipeId" IS NOT NULL AND p.id IS NULL ORDER BY c.id LIMIT 20',
    fixSql: 'UPDATE recipe_deployments c SET "previousRecipeId" = NULL WHERE c."previousRecipeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM machine_recipes p WHERE p.id = c."previousRecipeId")',
    guidance: "Rollback pointer to a gone recipe — NULLing degrades gracefully (one-step rollback unavailable for that record).",
  },
  // ── unique duplicates [M6] — always manual (merging masters needs a human) ──
  {
    key: "uq:workshops(factoryId,code)[active]",
    constraint: null, strategy: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM (SELECT 1 FROM workshops WHERE "isActive" GROUP BY "factoryId", code HAVING count(*) > 1) d',
    sampleSql: 'SELECT "factoryId", code, count(*)::int AS n, array_agg(id ORDER BY id) AS ids FROM workshops WHERE "isActive" GROUP BY "factoryId", code HAVING count(*) > 1 ORDER BY "factoryId", code LIMIT 20',
    guidance: "Pick ONE survivor per (factoryId, code): re-point children (production_lines.workshopId) to it, then soft-delete (isActive=false) or rename the others. Re-run 0180 afterwards: node run-0179-0180-migration.mjs --force",
  },
  {
    key: "uq:production_lines(workshopId,code)[active]",
    constraint: null, strategy: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM (SELECT 1 FROM production_lines WHERE "isActive" GROUP BY "workshopId", code HAVING count(*) > 1) d',
    sampleSql: 'SELECT "workshopId", code, count(*)::int AS n, array_agg(id ORDER BY id) AS ids FROM production_lines WHERE "isActive" GROUP BY "workshopId", code HAVING count(*) > 1 ORDER BY "workshopId", code LIMIT 20',
    guidance: "Merge duplicates (survivor keeps children: stations.lineId), soft-delete/rename the rest, re-run 0180.",
  },
  {
    key: "uq:stations(lineId,code)[active]",
    constraint: null, strategy: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM (SELECT 1 FROM stations WHERE "isActive" GROUP BY "lineId", code HAVING count(*) > 1) d',
    sampleSql: 'SELECT "lineId", code, count(*)::int AS n, array_agg(id ORDER BY id) AS ids FROM stations WHERE "isActive" GROUP BY "lineId", code HAVING count(*) > 1 ORDER BY "lineId", code LIMIT 20',
    guidance: "Merge duplicates (survivor keeps machines.stationId children), soft-delete/rename the rest, re-run 0180.",
  },
  {
    key: "uq:product_machine_mappings(productModelId,machineId)",
    constraint: null, strategy: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM (SELECT 1 FROM product_machine_mappings GROUP BY "productModelId", "machineId" HAVING count(*) > 1) d',
    sampleSql: 'SELECT "productModelId", "machineId", count(*)::int AS n, array_agg(id ORDER BY id) AS ids FROM product_machine_mappings GROUP BY "productModelId", "machineId" HAVING count(*) > 1 ORDER BY 1, 2 LIMIT 20',
    guidance: "Keep the newest row per pair, delete the rest: DELETE FROM product_machine_mappings a USING product_machine_mappings b WHERE a.\"productModelId\" = b.\"productModelId\" AND a.\"machineId\" = b.\"machineId\" AND a.id < b.id; then re-run 0180.",
  },
  // ── soft-orphan (doc 51 P2 — CASE #6) — recoverable, NOT an FK violation ──────
  // Inspections that arrived before their product model existed keep the raw
  // `productModel` code but productModelId=NULL. Once the model exists the link
  // is derivable — backfill it so by-model reports stop dropping the rows. SAFE
  // (NULL → the now-known id, only when the code maps to exactly ONE model), so it
  // runs under plain --fix. productRouters does this automatically on model create;
  // this entry recovers the historical backlog. NOTE: key is prefixed "soft:" (not
  // "fk:"/"uq:") because it is deliberately OUTSIDE the 0179/0180 constraint contract.
  {
    key: "soft:product_inspections.productModel->product_models.code",
    constraint: null, strategy: "backfill",
    countSql: 'SELECT count(*)::bigint AS n FROM product_inspections c WHERE c."productModelId" IS NULL AND c."productModel" IS NOT NULL AND EXISTS (SELECT 1 FROM product_models p WHERE p.code = c."productModel")',
    sampleSql: 'SELECT c.id, c."productModel" FROM product_inspections c WHERE c."productModelId" IS NULL AND c."productModel" IS NOT NULL AND EXISTS (SELECT 1 FROM product_models p WHERE p.code = c."productModel") ORDER BY c.id LIMIT 20',
    fixSql: 'UPDATE product_inspections c SET "productModelId" = (SELECT p.id FROM product_models p WHERE p.code = c."productModel" ORDER BY p.id DESC LIMIT 1) WHERE c."productModelId" IS NULL AND c."productModel" IS NOT NULL AND (SELECT count(*) FROM product_models p WHERE p.code = c."productModel") = 1',
    guidance: "Backfill productModelId from the matching product_models.code (only where the code maps to exactly one model). Restores these inspections to by-model yield/defect/SPC reports.",
  },
];

const { default: postgres } = await import("postgres");
const needsSsl = process.env.DATABASE_URL.includes("sslmode=require");
const sql = postgres(process.env.DATABASE_URL, {
  ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  max: 1,
  connect_timeout: 30,
});

const mode = FIX ? (ALLOW_DELETE ? "FIX (+allow-delete)" : "FIX (set-null only)") : "DRY-RUN";
console.log(`repair-orphans — mode: ${mode}${ONLY.length ? ` — only: ${ONLY.join(", ")}` : ""}`);
console.log("".padEnd(78, "─"));

let totalViolations = 0;
let totalFixed = 0;
let failed = false;

try {
  for (const rel of RELATIONSHIPS) {
    if (ONLY.length && !ONLY.includes(rel.key)) continue;
    let n = 0;
    try {
      const [row] = await sql.unsafe(rel.countSql);
      n = Number(row?.n ?? 0);
    } catch (e) {
      console.error(`  [ERR ] ${rel.key} — scan failed: ${e.message}`);
      failed = true;
      continue;
    }
    if (n === 0) {
      console.log(`  [ok  ] ${rel.key} — 0 violations`);
      continue;
    }
    totalViolations += n;
    console.log(`  [DIRTY] ${rel.key} — ${n} violation(s) [strategy: ${rel.strategy}]`);
    try {
      const samples = await sql.unsafe(rel.sampleSql);
      for (const s of samples.slice(0, 5)) console.log(`          sample: ${JSON.stringify(s)}`);
      if (samples.length > 5) console.log(`          … ${n - 5} more (see integrity_scan_results)`);
    } catch { /* sample failure is non-fatal */ }

    const canFix =
      FIX &&
      ((rel.strategy === "set-null" && rel.fixSql) ||
        (rel.strategy === "backfill" && rel.fixSql) ||
        (rel.strategy === "delete-row" && rel.fixSql && ALLOW_DELETE));

    if (canFix) {
      const res = await sql.unsafe(rel.fixSql);
      const affected = res.count ?? 0;
      totalFixed += affected;
      const verb = rel.strategy === "set-null" ? "NULLed" : rel.strategy === "backfill" ? "backfilled" : "deleted";
      console.log(`          FIXED: ${affected} row(s) ${verb}`);
      // Try to validate the now-clean FK so enforcement is complete.
      if (rel.constraint) {
        const [tbl, con] = rel.constraint;
        try {
          await sql.unsafe(`ALTER TABLE "${tbl}" VALIDATE CONSTRAINT "${con}"`);
          console.log(`          VALIDATED: ${con}`);
        } catch (e) {
          console.log(`          (validate ${con} skipped: ${e.message})`);
        }
      }
    } else if (FIX && rel.strategy === "delete-row" && !ALLOW_DELETE) {
      console.log("          refused: deletion needs --allow-delete (rows are garbage join rows, but say so explicitly).");
    } else if (FIX && rel.strategy === "manual") {
      console.log(`          refused (structural — manual repair required):`);
      console.log(`          ${rel.guidance}`);
    } else {
      console.log(`          guidance: ${rel.guidance}`);
    }
  }

  console.log("".padEnd(78, "─"));
  console.log(
    FIX
      ? `done — ${totalViolations} violation(s) found, ${totalFixed} row(s) fixed. Re-run migration 0180 (node run-0179-0180-migration.mjs --force) to validate/build anything still deferred.`
      : `done — ${totalViolations} violation(s) found. DRY-RUN made NO changes. Use --fix (and --allow-delete for join-row deletion) to repair.`,
  );
  if (failed) process.exitCode = 1;
} catch (e) {
  console.error("[FAIL]", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
