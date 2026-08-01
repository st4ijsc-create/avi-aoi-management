/**
 * Master-data Integrity Scan Service (doc 27 §2 M1/M6/M11 — Đợt 3 item 3.1, W3-A)
 * ================================================================================
 * Re-runs the EXACT orphan/duplicate scans from migration 0179 on demand and on a
 * weekly cron, appending results to `integrity_scan_results` (created by 0179) so
 * drift is visible during the transition period in which some constraints from
 * 0180 are still NOT VALID / deferred (dirty legacy data) or intentionally
 * skipped (TimescaleDB cannot hold an FK referencing a hypertable — the
 * measurement_results.inspectionId relationship is covered HERE instead).
 *
 * SCAN KEY CONTRACT: `key` strings below are shared verbatim with migrations
 * 0179/0180 and scripts/repair-orphans.mjs (a test cross-checks the lists).
 *
 * Design: read-only scans + one INSERT per relationship into the report table;
 * fail-safe (a broken relationship marks itself degraded, never throws out);
 * single-flight; scheduler mirrors kbSyncScheduler/aiAnomalyBankScheduler.
 *
 * Env flags:
 *   INTEGRITY_SCAN_ENABLED (default "true" — this is a transitional SAFETY NET;
 *                           read-only counts, bounded work. Set "false" to disable.)
 *   INTEGRITY_SCAN_CRON    (default "30 3 * * 0" — Sunday 03:30, off-peak)
 *   INTEGRITY_SCAN_TZ      (default "Asia/Ho_Chi_Minh")
 */
import * as cron from "node-cron";
import { sql } from "drizzle-orm";
// W4-D (doc 27 §8 B5): integrity scans are long full-table LEFT JOIN counts —
// route them through the dedicated background-jobs pool (DB_POOL_MAX_JOBS) so
// a slow weekly scan never starves interactive API requests.
import { getJobsDb as getDb } from "../db/connection";

// ─── Relationship catalogue (single source of truth on the app side) ──────────

export type IntegrityKind = "fk-orphan" | "unique-duplicate" | "fk-soft-orphan";
/** How scripts/repair-orphans.mjs may fix violations of this relationship. */
export type RepairStrategy =
  | "set-null"      // safe auto-fix: NULL out the dangling soft reference
  | "delete-row"    // auto-fix only with --fix --allow-delete: drop garbage join rows
  | "manual";       // structural — print guidance, never auto-fix

export interface IntegrityRelationship {
  /** Stable scan key — matches integrity_scan_results."scanKey" (0179/0180). */
  key: string;
  kind: IntegrityKind;
  childTable: string;
  childColumn: string;
  parentTable?: string;
  parentColumn?: string;
  /** FK constraint name / unique index name created by migration 0180. */
  constraintName: string;
  /** ON DELETE behaviour (FKs) or "unique". Documentation for the UI. */
  enforcement: "RESTRICT" | "CASCADE" | "SET NULL" | "UNIQUE";
  repair: RepairStrategy;
  /** SELECT returning a single row { n: bigint } — violation count. */
  countSql: string;
  /** SELECT returning ≤20 sample rows (child ids or duplicate key tuples). */
  sampleSql: string;
}

const fkPair = (childFrag: string) => ({
  countSql: `SELECT count(*)::bigint AS n ${childFrag}`,
  sampleSql: `SELECT c.id ${childFrag} ORDER BY c.id LIMIT 20`,
});

export const INTEGRITY_RELATIONSHIPS: IntegrityRelationship[] = [
  {
    key: "fk:machines.stationId->stations.id",
    kind: "fk-orphan", childTable: "machines", childColumn: "stationId",
    parentTable: "stations", parentColumn: "id",
    constraintName: "fk_machines_station", enforcement: "RESTRICT", repair: "manual",
    ...fkPair('FROM machines c LEFT JOIN stations p ON c."stationId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:stations.lineId->production_lines.id",
    kind: "fk-orphan", childTable: "stations", childColumn: "lineId",
    parentTable: "production_lines", parentColumn: "id",
    constraintName: "fk_stations_line", enforcement: "RESTRICT", repair: "manual",
    ...fkPair('FROM stations c LEFT JOIN production_lines p ON c."lineId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:production_lines.workshopId->workshops.id",
    kind: "fk-orphan", childTable: "production_lines", childColumn: "workshopId",
    parentTable: "workshops", parentColumn: "id",
    constraintName: "fk_production_lines_workshop", enforcement: "RESTRICT", repair: "manual",
    ...fkPair('FROM production_lines c LEFT JOIN workshops p ON c."workshopId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:workshops.factoryId->factories.id",
    kind: "fk-orphan", childTable: "workshops", childColumn: "factoryId",
    parentTable: "factories", parentColumn: "id",
    constraintName: "fk_workshops_factory", enforcement: "RESTRICT", repair: "manual",
    ...fkPair('FROM workshops c LEFT JOIN factories p ON c."factoryId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:factories.corporateCode->corporates.code",
    kind: "fk-orphan", childTable: "factories", childColumn: "corporateCode",
    parentTable: "corporates", parentColumn: "code",
    constraintName: "fk_factories_corporate", enforcement: "RESTRICT", repair: "set-null",
    ...fkPair('FROM factories c LEFT JOIN corporates p ON c."corporateCode" = p.code WHERE c."corporateCode" IS NOT NULL AND p.id IS NULL'),
  },
  {
    key: "fk:product_inspections.machineId->machines.id",
    kind: "fk-orphan", childTable: "product_inspections", childColumn: "machineId",
    parentTable: "machines", parentColumn: "id",
    constraintName: "fk_product_inspections_machine", enforcement: "RESTRICT", repair: "manual",
    ...fkPair('FROM product_inspections c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL'),
  },
  {
    // ⚠ Hypertable-sensitive: when 0172 made these two tables hypertables, the
    // DB holds NO FK here (0180 skips it) — this weekly scan IS the guard.
    key: "fk:measurement_results.inspectionId->product_inspections.id",
    kind: "fk-orphan", childTable: "measurement_results", childColumn: "inspectionId",
    parentTable: "product_inspections", parentColumn: "id",
    constraintName: "fk_measurement_results_inspection", enforcement: "CASCADE", repair: "manual",
    ...fkPair('FROM measurement_results c LEFT JOIN product_inspections p ON c."inspectionId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:measurement_results.pointDefId->measurement_point_defs.id",
    kind: "fk-orphan", childTable: "measurement_results", childColumn: "pointDefId",
    parentTable: "measurement_point_defs", parentColumn: "id",
    constraintName: "fk_measurement_results_point_def", enforcement: "RESTRICT", repair: "manual",
    ...fkPair('FROM measurement_results c LEFT JOIN measurement_point_defs p ON c."pointDefId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:measurement_results.defectCatalogId->defect_catalog.id",
    kind: "fk-orphan", childTable: "measurement_results", childColumn: "defectCatalogId",
    parentTable: "defect_catalog", parentColumn: "id",
    constraintName: "fk_measurement_results_defect_catalog", enforcement: "SET NULL", repair: "set-null",
    ...fkPair('FROM measurement_results c LEFT JOIN defect_catalog p ON c."defectCatalogId" = p.id WHERE c."defectCatalogId" IS NOT NULL AND p.id IS NULL'),
  },
  {
    key: "fk:product_machine_mappings.productModelId->product_models.id",
    kind: "fk-orphan", childTable: "product_machine_mappings", childColumn: "productModelId",
    parentTable: "product_models", parentColumn: "id",
    constraintName: "fk_pm_mappings_product", enforcement: "CASCADE", repair: "delete-row",
    ...fkPair('FROM product_machine_mappings c LEFT JOIN product_models p ON c."productModelId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:product_machine_mappings.machineId->machines.id",
    kind: "fk-orphan", childTable: "product_machine_mappings", childColumn: "machineId",
    parentTable: "machines", parentColumn: "id",
    constraintName: "fk_pm_mappings_machine", enforcement: "CASCADE", repair: "delete-row",
    ...fkPair('FROM product_machine_mappings c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:machine_recipes.machineId->machines.id",
    kind: "fk-orphan", childTable: "machine_recipes", childColumn: "machineId",
    parentTable: "machines", parentColumn: "id",
    constraintName: "fk_machine_recipes_machine", enforcement: "RESTRICT", repair: "manual",
    ...fkPair('FROM machine_recipes c LEFT JOIN machines p ON c."machineId" = p.id WHERE c."machineId" IS NOT NULL AND p.id IS NULL'),
  },
  {
    key: "fk:recipe_deployments.recipeId->machine_recipes.id",
    kind: "fk-orphan", childTable: "recipe_deployments", childColumn: "recipeId",
    parentTable: "machine_recipes", parentColumn: "id",
    constraintName: "fk_recipe_deployments_recipe", enforcement: "RESTRICT", repair: "manual",
    ...fkPair('FROM recipe_deployments c LEFT JOIN machine_recipes p ON c."recipeId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:recipe_deployments.machineId->machines.id",
    kind: "fk-orphan", childTable: "recipe_deployments", childColumn: "machineId",
    parentTable: "machines", parentColumn: "id",
    constraintName: "fk_recipe_deployments_machine", enforcement: "RESTRICT", repair: "manual",
    ...fkPair('FROM recipe_deployments c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:recipe_deployments.previousRecipeId->machine_recipes.id",
    kind: "fk-orphan", childTable: "recipe_deployments", childColumn: "previousRecipeId",
    parentTable: "machine_recipes", parentColumn: "id",
    constraintName: "fk_recipe_deployments_previous_recipe", enforcement: "SET NULL", repair: "set-null",
    ...fkPair('FROM recipe_deployments c LEFT JOIN machine_recipes p ON c."previousRecipeId" = p.id WHERE c."previousRecipeId" IS NOT NULL AND p.id IS NULL'),
  },
  // ── Unique-duplicate relationships [M6] (violationCount = duplicate GROUPS) ──
  {
    key: "uq:workshops(factoryId,code)[active]",
    kind: "unique-duplicate", childTable: "workshops", childColumn: "factoryId,code",
    constraintName: "uq_workshops_factory_code_active", enforcement: "UNIQUE", repair: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM (SELECT 1 FROM workshops WHERE "isActive" GROUP BY "factoryId", code HAVING count(*) > 1) d',
    sampleSql: 'SELECT "factoryId", code, count(*)::int AS n FROM workshops WHERE "isActive" GROUP BY "factoryId", code HAVING count(*) > 1 ORDER BY "factoryId", code LIMIT 20',
  },
  {
    key: "uq:production_lines(workshopId,code)[active]",
    kind: "unique-duplicate", childTable: "production_lines", childColumn: "workshopId,code",
    constraintName: "uq_production_lines_workshop_code_active", enforcement: "UNIQUE", repair: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM (SELECT 1 FROM production_lines WHERE "isActive" GROUP BY "workshopId", code HAVING count(*) > 1) d',
    sampleSql: 'SELECT "workshopId", code, count(*)::int AS n FROM production_lines WHERE "isActive" GROUP BY "workshopId", code HAVING count(*) > 1 ORDER BY "workshopId", code LIMIT 20',
  },
  {
    key: "uq:stations(lineId,code)[active]",
    kind: "unique-duplicate", childTable: "stations", childColumn: "lineId,code",
    constraintName: "uq_stations_line_code_active", enforcement: "UNIQUE", repair: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM (SELECT 1 FROM stations WHERE "isActive" GROUP BY "lineId", code HAVING count(*) > 1) d',
    sampleSql: 'SELECT "lineId", code, count(*)::int AS n FROM stations WHERE "isActive" GROUP BY "lineId", code HAVING count(*) > 1 ORDER BY "lineId", code LIMIT 20',
  },
  {
    key: "uq:product_machine_mappings(productModelId,machineId)",
    kind: "unique-duplicate", childTable: "product_machine_mappings", childColumn: "productModelId,machineId",
    constraintName: "uq_pm_mappings_pair", enforcement: "UNIQUE", repair: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM (SELECT 1 FROM product_machine_mappings GROUP BY "productModelId", "machineId" HAVING count(*) > 1) d',
    sampleSql: 'SELECT "productModelId", "machineId", count(*)::int AS n FROM product_machine_mappings GROUP BY "productModelId", "machineId" HAVING count(*) > 1 ORDER BY 1, 2 LIMIT 20',
  },
];

// ─── Soft-orphan checks (doc 51 P2 — CASE #6) ────────────────────────────────
//
// DISTINCT from INTEGRITY_RELATIONSHIPS above: those model REAL foreign keys that
// migrations 0179/0180 audit + enforce, and a contract test asserts the app list
// matches 0179 and repair-orphans.mjs verbatim. A "soft orphan" is NOT an FK
// violation — it is a RECOVERABLE dangling soft-link that no constraint can catch:
//
//   An AOI/AVI machine posts an inspection for a product model that does not exist
//   yet. Ingest stores productModelId = NULL but keeps the raw `productModel` code
//   string. Later an engineer creates that model — but the historical inspections
//   stay NULL forever, so they vanish from every by-model report (all of which
//   GROUP/JOIN on productModelId). The row is not an FK orphan (NULL FKs are legal);
//   it is a link that BECAME resolvable and nobody re-anchored it.
//
// These live in a SEPARATE list (and a SEPARATE `softResults` bucket on the run)
// precisely so they do NOT enter the 0179/0180/repair-script key contract. They
// are surfaced (count + sample) and persisted to integrity_scan_results like the
// FK scans, and are auto-repaired going forward by the model-create backfill in
// productRouters (and in bulk by `repair-orphans.mjs` over the historical backlog).
export const SOFT_INTEGRITY_CHECKS: IntegrityRelationship[] = [
  {
    key: "soft:product_inspections.productModel->product_models.code",
    kind: "fk-soft-orphan",
    childTable: "product_inspections", childColumn: "productModel",
    parentTable: "product_models", parentColumn: "code",
    // No DB constraint exists for this relationship — enforcement is documentation
    // only (a NULL productModelId is a legal FK state). Repaired by backfill.
    constraintName: "(none — recoverable soft link; backfilled on model create)",
    enforcement: "SET NULL", repair: "manual",
    countSql:
      'SELECT count(*)::bigint AS n FROM product_inspections c ' +
      'WHERE c."productModelId" IS NULL AND c."productModel" IS NOT NULL ' +
      'AND EXISTS (SELECT 1 FROM product_models p WHERE p.code = c."productModel")',
    sampleSql:
      'SELECT c.id, c."productModel" AS "productModel" FROM product_inspections c ' +
      'WHERE c."productModelId" IS NULL AND c."productModel" IS NOT NULL ' +
      'AND EXISTS (SELECT 1 FROM product_models p WHERE p.code = c."productModel") ' +
      'ORDER BY c.id LIMIT 20',
  },
];

// ─── Scan execution ───────────────────────────────────────────────────────────

export interface RelationshipScanResult {
  key: string;
  kind: IntegrityKind;
  childTable: string;
  violationCount: number;
  samples: unknown[];
  /** true when this relationship's scan failed (table missing, timeout, …). */
  degraded: boolean;
  error?: string;
}

export interface IntegrityScanRunResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  totalViolations: number;
  dirtyRelationships: number;
  results: RelationshipScanResult[];
  /**
   * doc 51 P2 (CASE #6) — soft-orphan checks (SOFT_INTEGRITY_CHECKS). Kept OUT of
   * `results` so the 0179/0180/repair-script key-contract test (which asserts
   * results.length === INTEGRITY_RELATIONSHIPS.length) is unaffected.
   */
  softResults: RelationshipScanResult[];
  durationMs: number;
  scannedAt: string;
}

let running = false;
let lastRunAt: Date | null = null;
let lastRunResult: IntegrityScanRunResult | null = null;

function enabled(): boolean {
  // Default ON: transitional safety net, read-only + bounded (see header).
  return String(process.env.INTEGRITY_SCAN_ENABLED ?? "true").toLowerCase() !== "false";
}

/**
 * Run every relationship scan once, persist to integrity_scan_results and
 * return the summary. Fail-safe: never throws; per-relationship degradation.
 */
export async function runIntegrityScanNow(scanSource: string = "service"): Promise<IntegrityScanRunResult> {
  const start = Date.now();
  const scannedAt = new Date().toISOString();
  if (running) {
    return { ok: true, skipped: true, reason: "already_running", totalViolations: 0, dirtyRelationships: 0, results: [], softResults: [], durationMs: 0, scannedAt };
  }
  running = true;
  const results: RelationshipScanResult[] = [];
  const softResults: RelationshipScanResult[] = [];
  try {
    const db = await getDb();
    if (!db) {
      return { ok: false, skipped: true, reason: "db_unavailable", totalViolations: 0, dirtyRelationships: 0, results: [], softResults: [], durationMs: Date.now() - start, scannedAt };
    }

    // Scan ONE relationship (count + sample + best-effort persist) into `bucket`.
    // Shared by the FK/unique scans and the doc 51 P2 soft-orphan checks.
    const scanInto = async (rel: IntegrityRelationship, bucket: RelationshipScanResult[]) => {
      try {
        const countRows = (await db.execute(sql.raw(rel.countSql))) as unknown as Array<{ n: string | number | bigint }>;
        const violationCount = Number(countRows?.[0]?.n ?? 0);
        let samples: unknown[] = [];
        if (violationCount > 0) {
          samples = (await db.execute(sql.raw(rel.sampleSql))) as unknown as unknown[];
        }
        bucket.push({ key: rel.key, kind: rel.kind, childTable: rel.childTable, violationCount, samples, degraded: false });

        // Persist (best-effort — report table comes from 0179).
        try {
          await db.execute(sql`
            INSERT INTO integrity_scan_results
              ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
            VALUES (${rel.key}, ${rel.kind}, ${rel.childTable}, ${rel.childColumn},
                    ${rel.parentTable ?? null}, ${rel.parentColumn ?? null},
                    ${violationCount}, ${JSON.stringify(samples)}::jsonb, ${scanSource})`);
        } catch (persistErr) {
          console.warn(`[integrityScan] could not persist result for ${rel.key} (run migration 0179?):`, (persistErr as Error)?.message);
        }
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        console.error(`[integrityScan] scan failed for ${rel.key}:`, msg);
        bucket.push({ key: rel.key, kind: rel.kind, childTable: rel.childTable, violationCount: 0, samples: [], degraded: true, error: msg });
      }
    };

    for (const rel of INTEGRITY_RELATIONSHIPS) await scanInto(rel, results);
    // doc 51 P2 (CASE #6): soft-orphan checks — separate bucket (see interface).
    for (const rel of SOFT_INTEGRITY_CHECKS) await scanInto(rel, softResults);
  } finally {
    running = false;
  }

  const dirty = results.filter((r) => r.violationCount > 0);
  const softDirty = softResults.filter((r) => r.violationCount > 0);
  const totalViolations = dirty.reduce((s, r) => s + r.violationCount, 0);
  const run: IntegrityScanRunResult = {
    ok: results.every((r) => !r.degraded) && softResults.every((r) => !r.degraded),
    totalViolations,
    dirtyRelationships: dirty.length,
    results,
    softResults,
    durationMs: Date.now() - start,
    scannedAt,
  };
  lastRunAt = new Date();
  lastRunResult = run;

  if (dirty.length > 0) {
    console.warn(
      `[integrityScan] ${dirty.length} relationship(s) dirty (${totalViolations} total violation(s)) — ` +
      dirty.map((r) => `${r.key}=${r.violationCount}`).join(", ") +
      ` — repair: node scripts/repair-orphans.mjs, then re-apply migration 0180 to validate.`,
    );
  } else {
    console.log(`[integrityScan] clean — ${results.length} relationships scanned in ${run.durationMs}ms`);
  }
  if (softDirty.length > 0) {
    console.warn(
      `[integrityScan] soft-orphan(s) recoverable — ` +
      softDirty.map((r) => `${r.key}=${r.violationCount}`).join(", ") +
      ` — inspections predating their product model; repair: node scripts/repair-orphans.mjs --fix ` +
      `--rel "soft:product_inspections.productModel->product_models.code".`,
    );
  }
  return run;
}

// ─── Live constraint state (is the DB actually enforcing?) ───────────────────

export interface ConstraintState {
  key: string;
  constraintName: string;
  enforcement: string;
  /** FK exists / unique index exists. */
  exists: boolean;
  /** For FKs: convalidated (NOT VALID ⇒ false). Unique indexes: same as exists. */
  validated: boolean;
}

/** Read pg_constraint / pg_indexes to report the REAL enforcement state. */
export async function getConstraintStates(): Promise<ConstraintState[]> {
  const db = await getDb();
  if (!db) return [];
  const out: ConstraintState[] = [];
  let fkRows: Array<{ conname: string; convalidated: boolean }> = [];
  let idxRows: Array<{ indexname: string }> = [];
  try {
    fkRows = (await db.execute(sql`
      SELECT conname, convalidated FROM pg_constraint WHERE contype = 'f'`)) as unknown as typeof fkRows;
    idxRows = (await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`)) as unknown as typeof idxRows;
  } catch (err) {
    console.error("[integrityScan] constraint-state query failed:", (err as Error)?.message);
    return [];
  }
  const fkMap = new Map(fkRows.map((r) => [r.conname, r.convalidated]));
  const idxSet = new Set(idxRows.map((r) => r.indexname));
  for (const rel of INTEGRITY_RELATIONSHIPS) {
    if (rel.kind === "fk-orphan") {
      const validated = fkMap.get(rel.constraintName);
      out.push({ key: rel.key, constraintName: rel.constraintName, enforcement: rel.enforcement, exists: validated !== undefined, validated: validated === true });
    } else {
      const exists = idxSet.has(rel.constraintName);
      out.push({ key: rel.key, constraintName: rel.constraintName, enforcement: rel.enforcement, exists, validated: exists });
    }
  }
  return out;
}

// ─── Scheduler lifecycle (mirror the other schedulers) ────────────────────────

let job: cron.ScheduledTask | null = null;

/** Register the weekly cron job. No-op when INTEGRITY_SCAN_ENABLED="false". */
export function startIntegrityScanScheduler(): void {
  if (!enabled()) {
    console.log("[integrityScan] disabled (INTEGRITY_SCAN_ENABLED=false)");
    return;
  }
  if (job) return; // already started
  const CRON = process.env.INTEGRITY_SCAN_CRON || "30 3 * * 0";
  const TZ = process.env.INTEGRITY_SCAN_TZ || "Asia/Ho_Chi_Minh";
  job = cron.schedule(
    CRON,
    () => {
      runIntegrityScanNow("service").catch((e) => console.error("[integrityScan] cron error:", e));
    },
    { timezone: TZ },
  );
  console.log(`[integrityScan] scheduled '${CRON}' (${TZ}) — ${INTEGRITY_RELATIONSHIPS.length} relationships`);
}

/** Stop the cron job (shutdown). Safe to call when not started. */
export function stopIntegrityScanScheduler(): void {
  if (job) {
    job.stop();
    job = null;
    console.log("[integrityScan] stopped");
  }
}

/** Status for dashboards / the integrity tRPC router. */
export function getIntegrityScanSchedulerStatus() {
  return {
    enabled: enabled(),
    cron: process.env.INTEGRITY_SCAN_CRON || "30 3 * * 0",
    timezone: process.env.INTEGRITY_SCAN_TZ || "Asia/Ho_Chi_Minh",
    relationshipCount: INTEGRITY_RELATIONSHIPS.length,
    softCheckCount: SOFT_INTEGRITY_CHECKS.length,
    running: !!job,
    scanInFlight: running,
    lastRunAt,
    lastRunResult,
  };
}
