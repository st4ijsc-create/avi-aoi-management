/**
 * W3-A (doc 27 §2 M1/M6/M11) — integration tests for the two-phase master-data
 * integrity rollout (migrations 0179/0180), the integrityScanService and the
 * repair-orphans script contract.
 *
 * Runs against the ISOLATED test DB (vitest.setup.ts rewrites DATABASE_URL to
 * <db>_test — a clone of dev). The suite applies 0179+0180 itself (both are
 * idempotent), so it works on a fresh clone that predates them.
 *
 * Proves:
 *   1. 0179 report table exists and holds a snapshot per relationship.
 *   2. An enforced FK blocks a NEW orphan insert (even while NOT VALID).
 *   3. The unique mapping pair blocks duplicates (or is recorded as deferred).
 *   4. The scanner detects a seeded orphan.
 *   5. repair-orphans --dry-run reports without mutating.
 *   6. Scan-key contract holds across service ↔ repair script.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import {
  INTEGRITY_RELATIONSHIPS,
  runIntegrityScanNow,
  getConstraintStates,
} from "./integrityScanService";

const DB_URL = process.env.DATABASE_URL;
const root = path.resolve(__dirname, "..", "..");

// Random suffix so scratch master-data rows never collide with clone content.
const RUN = `W3A${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
// Scratch hierarchy chain (created in beforeAll, removed in afterAll).
const ids = {
  factory: 0, workshop: 0, line: 0, station: 0, machine: 0,
  product: 0, pointDef: 0, inspection: 0, orphanResult: 0,
};

const apply0180 = async () => {
  const file = fs.readFileSync(path.join(root, "drizzle", "0180_integrity_enforce_fk_unique.sql"), "utf-8");
  await sql.unsafe(file);
};

describe.skipIf(!DB_URL)("W3-A master-data integrity (0179/0180 + scanner + repair)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    // Apply both migrations (idempotent; safe on a dirty clone).
    await sql.unsafe(fs.readFileSync(path.join(root, "drizzle", "0179_integrity_orphan_scan.sql"), "utf-8"));
    await apply0180();

    // Scratch hierarchy chain with unique codes (clone may enforce global codes).
    const [f] = await sql`INSERT INTO factories (code, name) VALUES (${"F-" + RUN}, 'W3A test factory') RETURNING id`;
    ids.factory = f.id;
    const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'W3A test workshop') RETURNING id`;
    ids.workshop = w.id;
    const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'W3A test line') RETURNING id`;
    ids.line = l.id;
    const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'W3A test station') RETURNING id`;
    ids.station = s.id;
    const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${ids.station}, ${"M-" + RUN}, 'W3A test machine', 'AOI') RETURNING id`;
    ids.machine = m.id;
    const [p] = await sql`INSERT INTO product_models (code, name) VALUES (${"P-" + RUN}, 'W3A test product') RETURNING id`;
    ids.product = p.id;
  }, 120_000);

  afterAll(async () => {
    // Remove scratch data (children first — the FKs are real now). Best-effort.
    try {
      if (ids.orphanResult) await sql`DELETE FROM measurement_results WHERE id = ${ids.orphanResult}`;
      if (ids.inspection) await sql`DELETE FROM product_inspections WHERE id = ${ids.inspection}`;
      if (ids.pointDef) await sql`DELETE FROM measurement_point_defs WHERE id = ${ids.pointDef}`;
      if (ids.product) await sql`DELETE FROM product_models WHERE id = ${ids.product}`; // mappings cascade
      if (ids.machine) await sql`DELETE FROM machines WHERE id = ${ids.machine}`;
      if (ids.station) await sql`DELETE FROM stations WHERE id = ${ids.station}`;
      if (ids.line) await sql`DELETE FROM production_lines WHERE id = ${ids.line}`;
      if (ids.workshop) await sql`DELETE FROM workshops WHERE id = ${ids.workshop}`;
      if (ids.factory) await sql`DELETE FROM factories WHERE id = ${ids.factory}`;
      // Restore any constraint the orphan-seeding test dropped.
      await apply0180();
    } finally {
      await sql.end();
    }
  }, 120_000);

  it("0179 created the report table with one snapshot per relationship", async () => {
    const [row] = await sql`
      SELECT count(DISTINCT "scanKey")::int AS n FROM integrity_scan_results
      WHERE "scanSource" = 'migration-0179'`;
    expect(Number(row.n)).toBeGreaterThanOrEqual(INTEGRITY_RELATIONSHIPS.length);
  });

  it("every relationship resolved to a real constraint state (validated / not-valid / missing)", async () => {
    const states = await getConstraintStates();
    expect(states.length).toBe(INTEGRITY_RELATIONSHIPS.length);
    // The structurally-clean hierarchy FKs must be fully validated on the test DB.
    const machinesFk = states.find((s) => s.key === "fk:machines.stationId->stations.id");
    expect(machinesFk?.exists).toBe(true);
    expect(machinesFk?.validated).toBe(true);
  });

  it("FK blocks a NEW orphan insert on machines.stationId (M1)", async () => {
    await expect(
      sql`INSERT INTO machines ("stationId", code, name, "machineType")
          VALUES (2147480000, ${"M-orphan-" + RUN}, 'orphan machine', 'AOI')`,
    ).rejects.toThrow(/foreign key|fk_machines_station/i);
  });

  it("FK blocks a NEW orphan insert on product_inspections.machineId (M1)", async () => {
    await expect(
      sql`INSERT INTO product_inspections ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime")
          VALUES (2147480000, ${"SN-" + RUN}, 'OK', 'OK', now())`,
    ).rejects.toThrow(/foreign key|fk_product_inspections_machine/i);
  });

  it("unique pair blocks a duplicate product↔machine mapping (M6) — or is recorded deferred", async () => {
    const [idx] = await sql`
      SELECT count(*)::int AS n FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'uq_pm_mappings_pair'`;
    if (Number(idx.n) === 0) {
      // Two-phase contract: a dirty clone defers the index but records why.
      const [st] = await sql`
        SELECT count(*)::int AS n FROM db_feature_status
        WHERE feature = 'integrity_uq_pm_mappings_pair' AND status = 'deferred'`;
      expect(Number(st.n)).toBe(1);
      return;
    }
    await sql`INSERT INTO product_machine_mappings ("productModelId", "machineId") VALUES (${ids.product}, ${ids.machine})`;
    await expect(
      sql`INSERT INTO product_machine_mappings ("productModelId", "machineId") VALUES (${ids.product}, ${ids.machine})`,
    ).rejects.toThrow(/duplicate key|uq_pm_mappings_pair/i);
    await sql`DELETE FROM product_machine_mappings WHERE "productModelId" = ${ids.product} AND "machineId" = ${ids.machine}`;
  });

  it("scanner detects a seeded orphan (defectCatalogId, M11) and persists a snapshot", async () => {
    // The SET NULL FK (if present) would block seeding — drop it to simulate the
    // unenforced/hypertable world the weekly scanner exists for. afterAll re-applies 0180.
    await sql`ALTER TABLE measurement_results DROP CONSTRAINT IF EXISTS fk_measurement_results_defect_catalog`;

    const [pd] = await sql`
      INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY")
      VALUES (${ids.product}, ${"PD-" + RUN}, 'W3A test point', 'VISUAL', 0, 0) RETURNING id`;
    ids.pointDef = pd.id;
    const [insp] = await sql`
      INSERT INTO product_inspections ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime")
      VALUES (${ids.machine}, ${"SN-" + RUN}, 'NG', 'NG', now()) RETURNING id`;
    ids.inspection = insp.id;
    const [mr] = await sql`
      INSERT INTO measurement_results ("inspectionId", "pointDefId", result, "defectCatalogId")
      VALUES (${ids.inspection}, ${ids.pointDef}, 'NG', 2147480000) RETURNING id`;
    ids.orphanResult = mr.id;

    const run = await runIntegrityScanNow("manual");
    expect(run.skipped).toBeFalsy();
    expect(run.results.length).toBe(INTEGRITY_RELATIONSHIPS.length);
    const defectScan = run.results.find(
      (r) => r.key === "fk:measurement_results.defectCatalogId->defect_catalog.id",
    );
    expect(defectScan?.degraded).toBe(false);
    expect(defectScan!.violationCount).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(defectScan!.samples)).toContain(String(ids.orphanResult));

    // Snapshot persisted for the admin router / trend history.
    const [persisted] = await sql`
      SELECT count(*)::int AS n FROM integrity_scan_results
      WHERE "scanKey" = 'fk:measurement_results.defectCatalogId->defect_catalog.id'
        AND "scanSource" = 'manual' AND "violationCount" >= 1`;
    expect(Number(persisted.n)).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("repair-orphans --dry-run reports the orphan without mutating (default-safe)", () => {
    const out = execFileSync(process.execPath, [path.join(root, "scripts", "repair-orphans.mjs"), "--dry-run"], {
      env: { ...process.env, DATABASE_URL: DB_URL },
      encoding: "utf-8",
      timeout: 110_000,
    });
    expect(out).toContain("mode: DRY-RUN");
    expect(out).toContain("DRY-RUN made NO changes");
    // Output shape: one status line per relationship key.
    for (const rel of INTEGRITY_RELATIONSHIPS) {
      expect(out).toContain(rel.key);
    }
    expect(out).toMatch(/fk:measurement_results\.defectCatalogId->defect_catalog\.id — \d+ violation/);
  }, 120_000);

  it("dry-run really did not touch the seeded orphan", async () => {
    const [row] = await sql`
      SELECT "defectCatalogId" FROM measurement_results WHERE id = ${ids.orphanResult}`;
    expect(Number(row.defectCatalogId)).toBe(2147480000);
  });

  it("scan-key contract: every service relationship exists in the repair script (and counts match 0179)", () => {
    const script = fs.readFileSync(path.join(root, "scripts", "repair-orphans.mjs"), "utf-8");
    const migration = fs.readFileSync(path.join(root, "drizzle", "0179_integrity_orphan_scan.sql"), "utf-8");
    for (const rel of INTEGRITY_RELATIONSHIPS) {
      expect(script, `repair script missing ${rel.key}`).toContain(`"${rel.key}"`);
      expect(migration, `0179 missing ${rel.key}`).toContain(`'${rel.key}'`);
    }
    // No stray keys on either side (same count of fk:/uq: declarations).
    const scriptKeys = script.match(/key: "(fk|uq):/g) ?? [];
    expect(scriptKeys.length).toBe(INTEGRITY_RELATIONSHIPS.length);
  });
});
