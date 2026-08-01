/**
 * Doc 31 Đợt B (MP1 / PM6) — INTEGRATION test of the BOM-driven componentCode
 * backfill AND proof that filling componentCode lights up the (previously dead)
 * Pareto-by-package chain end-to-end.
 *
 * Runs against the ISOLATED test DB (vitest.setup.ts rewrites DATABASE_URL to
 * <db>_test). Applies 0191 itself (idempotent) so it works on a clone that
 * predates it.
 *
 * Scenario (one product, one BOM):
 *   BOM line  R1 → MAT-<run>   (material MAT-<run> has a package)
 *   BOM line  R2 → OTHER-<run>
 *   point A   refdes R1, componentCode NULL      ⇒ backfilled to MAT-<run>
 *   point B   refdes R2, componentCode PRESET    ⇒ LEFT ALONE (already linked)
 *   point C   refdes R99, componentCode NULL     ⇒ unmatched (no_bom_match)
 *   point D   refdes NULL, componentCode NULL     ⇒ unmatched (no_refdesignator)
 *   NG result on point A → after backfill, Pareto returns a NON-UNLINKED bucket.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { backfillComponentCodesFromBom } from "./componentLinkBackfill";
import { getPackageDefectPareto } from "./componentPackageAnalytics";

const DB_URL = process.env.DATABASE_URL;
const root = path.resolve(__dirname, "..", "..");
const RUN = `MP1${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
const ids = {
  factory: 0, workshop: 0, line: 0, station: 0, machine: 0, product: 0,
  pkg: 0, material: 0, materialOther: 0,
  bom: 0,
  pointA: 0, pointB: 0, pointC: 0, pointD: 0,
  inspection: 0, resultA: 0,
};

const MAT = `MAT-${RUN}`;
const OTHER = `OTHER-${RUN}`;
const PRESET = `PRESET-${RUN}`;

describe.skipIf(!DB_URL)("MP1 componentCode BOM backfill + Pareto chain (seeded)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    await sql.unsafe(fs.readFileSync(path.join(root, "drizzle", "0191_component_library_capabilities.sql"), "utf-8"));

    const [f] = await sql`INSERT INTO factories (code, name) VALUES (${"F-" + RUN}, 'MP1 factory') RETURNING id`;
    ids.factory = f.id;
    const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'MP1 workshop') RETURNING id`;
    ids.workshop = w.id;
    const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'MP1 line') RETURNING id`;
    ids.line = l.id;
    const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'MP1 station') RETURNING id`;
    ids.station = s.id;
    const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${ids.station}, ${"M-" + RUN}, 'MP1 machine', 'AOI') RETURNING id`;
    ids.machine = m.id;
    const [p] = await sql`INSERT INTO product_models (code, name, "lifecycleStatus") VALUES (${"P-" + RUN}, 'MP1 product', 'development') RETURNING id`;
    ids.product = p.id;

    // Package + linked material (MAT), plus an unlinked-to-package material (OTHER).
    const [pkg] = await sql`
      INSERT INTO component_packages (code, family, "mountType", origin)
      VALUES (${"PKG-" + RUN}, 'CHIP', 'SMT', 'manual') RETURNING id`;
    ids.pkg = pkg.id;
    const [mat] = await sql`INSERT INTO materials (code, name, "packageId") VALUES (${MAT}, 'MP1 linked material', ${ids.pkg}) RETURNING id`;
    ids.material = mat.id;
    const [matO] = await sql`INSERT INTO materials (code, name) VALUES (${OTHER}, 'MP1 other material') RETURNING id`;
    ids.materialOther = matO.id;

    // BOM: active def + two lines (R1 → MAT, R2 → OTHER).
    const [bom] = await sql`
      INSERT INTO bom_definitions ("productModelId", code, version, name, status, "isActive")
      VALUES (${ids.product}, ${"BOM-" + RUN}, 1, 'MP1 BOM', 'active', true) RETURNING id`;
    ids.bom = bom.id;
    await sql`INSERT INTO bom_line_items ("bomId", "componentCode", "qtyPer", "refDesignator") VALUES (${ids.bom}, ${MAT}, 1, 'R1')`;
    await sql`INSERT INTO bom_line_items ("bomId", "componentCode", "qtyPer", "refDesignator") VALUES (${ids.bom}, ${OTHER}, 1, 'R2')`;

    // Points across the four states.
    const mkPoint = async (code: string, refdes: string | null, componentCode: string | null) => {
      const [r] = await sql`
        INSERT INTO measurement_point_defs
          ("productModelId", code, name, "measurementType", "positionX", "positionY", "refDesignator", "componentCode")
        VALUES (${ids.product}, ${code}, ${code}, 'VISUAL', 10, 10, ${refdes}, ${componentCode})
        RETURNING id`;
      return r.id as number;
    };
    ids.pointA = await mkPoint(`PT-A-${RUN}`, "R1", null);       // → MAT
    ids.pointB = await mkPoint(`PT-B-${RUN}`, "R2", PRESET);     // already linked → keep
    ids.pointC = await mkPoint(`PT-C-${RUN}`, "R99", null);      // no BOM match
    ids.pointD = await mkPoint(`PT-D-${RUN}`, null, null);       // no refdes

    // One NG inspection result on point A (linked once backfilled).
    const [insp] = await sql`
      INSERT INTO product_inspections
        ("machineId", "productModelId", "serialNumber", "overallResult", "originalResult", "inspectionTime")
      VALUES (${ids.machine}, ${ids.product}, ${"SN-" + RUN}, 'NG', 'NG', now())
      RETURNING id`;
    ids.inspection = insp.id;
    const [res] = await sql`INSERT INTO measurement_results ("inspectionId", "pointDefId", result) VALUES (${ids.inspection}, ${ids.pointA}, 'NG') RETURNING id`;
    ids.resultA = res.id;
  }, 120_000);

  afterAll(async () => {
    try {
      if (ids.resultA) await sql`DELETE FROM measurement_results WHERE id = ${ids.resultA}`;
      if (ids.inspection) await sql`DELETE FROM product_inspections WHERE id = ${ids.inspection}`;
      await sql`DELETE FROM measurement_point_defs WHERE id IN ${sql([ids.pointA, ids.pointB, ids.pointC, ids.pointD].filter(Boolean))}`;
      if (ids.bom) await sql`DELETE FROM bom_line_items WHERE "bomId" = ${ids.bom}`;
      if (ids.bom) await sql`DELETE FROM bom_definitions WHERE id = ${ids.bom}`;
      if (ids.material) await sql`DELETE FROM materials WHERE id = ${ids.material}`;
      if (ids.materialOther) await sql`DELETE FROM materials WHERE id = ${ids.materialOther}`;
      if (ids.pkg) await sql`DELETE FROM component_packages WHERE id = ${ids.pkg}`;
      if (ids.product) await sql`DELETE FROM product_models WHERE id = ${ids.product}`;
      if (ids.machine) await sql`DELETE FROM machines WHERE id = ${ids.machine}`;
      if (ids.station) await sql`DELETE FROM stations WHERE id = ${ids.station}`;
      if (ids.line) await sql`DELETE FROM production_lines WHERE id = ${ids.line}`;
      if (ids.workshop) await sql`DELETE FROM workshops WHERE id = ${ids.workshop}`;
      if (ids.factory) await sql`DELETE FROM factories WHERE id = ${ids.factory}`;
    } finally {
      await sql?.end();
    }
  }, 60_000);

  it("dry-run reports the plan without writing", async () => {
    const r = await backfillComponentCodesFromBom(ids.product, { dryRun: true });
    expect(r.bomDefinitionId).toBe(ids.bom);
    expect(r.matched).toBe(1);              // point A only
    expect(r.updated).toBe(0);              // dry-run writes nothing
    expect(r.skippedAlreadyLinked).toBe(1); // point B
    const reasons = r.unmatched.map((u) => u.reason).sort();
    expect(reasons).toEqual(["no_bom_match", "no_refdesignator"]); // C + D

    // nothing written
    const [a] = await sql`SELECT "componentCode" FROM measurement_point_defs WHERE id = ${ids.pointA}`;
    expect(a.componentCode).toBeNull();
  });

  it("apply fills the empty point and leaves the already-linked point alone", async () => {
    const r = await backfillComponentCodesFromBom(ids.product, { dryRun: false });
    expect(r.updated).toBe(1);

    const [a] = await sql`SELECT "componentCode" FROM measurement_point_defs WHERE id = ${ids.pointA}`;
    expect(a.componentCode).toBe(MAT); // filled from BOM
    const [b] = await sql`SELECT "componentCode" FROM measurement_point_defs WHERE id = ${ids.pointB}`;
    expect(b.componentCode).toBe(PRESET); // NON-DESTRUCTIVE — untouched

    // second apply is a no-op (idempotent): A is now linked → skipped.
    const again = await backfillComponentCodesFromBom(ids.product, { dryRun: false });
    expect(again.updated).toBe(0);
    expect(again.matched).toBe(0);
    expect(again.skippedAlreadyLinked).toBe(2); // A + B now both linked
  });

  it("Pareto-by-package now resolves the NG to a real package bucket (feature no longer dead)", async () => {
    const start = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const r = await getPackageDefectPareto({ startDate: start, endDate: end, machineId: ids.machine });

    expect(r.totalDefects).toBe(1);
    expect(r.linkedDefects).toBe(1);   // ← was 0 before the backfill
    expect(r.unlinkedDefects).toBe(0);
    const pkgItem = r.items.find((i) => i.bucket === "package");
    expect(pkgItem).toMatchObject({ code: `PKG-${RUN}`, count: 1, packageId: ids.pkg });
    // No UNLINKED bucket at all — the chain is fully resolved.
    expect(r.items.some((i) => i.bucket === "unlinked")).toBe(false);
  });
});
