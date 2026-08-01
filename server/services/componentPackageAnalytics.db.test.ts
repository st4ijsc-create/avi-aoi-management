/**
 * W8-A (doc 27 M12a / doc 29 §1.3) — INTEGRATION test of the package-Pareto
 * read path against the ISOLATED test DB (vitest.setup.ts rewrites
 * DATABASE_URL to <db>_test). Applies 0191 itself (idempotent) so it works on
 * a clone that predates it.
 *
 * Proves the full linkage chain with SEEDED data:
 *   NG results on a point WITH componentCode → material → package  ⇒ package bucket
 *   NG results on a point WITHOUT componentCode                    ⇒ UNLINKED (no_component_code)
 *   NG results whose componentCode matches NO material             ⇒ UNLINKED (no_material)
 *   NG results whose material has NO packageId                     ⇒ UNLINKED (no_package)
 *   OK results are never counted; machineId filter isolates the fixture.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { getPackageDefectPareto } from "./componentPackageAnalytics";

const DB_URL = process.env.DATABASE_URL;
const root = path.resolve(__dirname, "..", "..");
const RUN = `W8A${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
const ids = {
  factory: 0, workshop: 0, line: 0, station: 0, machine: 0, product: 0,
  material: 0, materialNoPkg: 0, pkg: 0,
  pointLinked: 0, pointNoCode: 0, pointNoMaterial: 0, pointNoPkg: 0,
  inspection: 0,
  results: [] as number[],
};

describe.skipIf(!DB_URL)("W8-A package Pareto (0191 linkage chain, seeded)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    // 0191 is idempotent — safe on a clone that already has it.
    await sql.unsafe(fs.readFileSync(path.join(root, "drizzle", "0191_component_library_capabilities.sql"), "utf-8"));

    // Scratch hierarchy chain (unique codes — clone content must not collide).
    const [f] = await sql`INSERT INTO factories (code, name) VALUES (${"F-" + RUN}, 'W8A pareto factory') RETURNING id`;
    ids.factory = f.id;
    const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'W8A workshop') RETURNING id`;
    ids.workshop = w.id;
    const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'W8A line') RETURNING id`;
    ids.line = l.id;
    const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'W8A station') RETURNING id`;
    ids.station = s.id;
    const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${ids.station}, ${"M-" + RUN}, 'W8A machine', 'AOI') RETURNING id`;
    ids.machine = m.id;
    const [p] = await sql`INSERT INTO product_models (code, name) VALUES (${"P-" + RUN}, 'W8A product') RETURNING id`;
    ids.product = p.id;

    // Package + materials.
    const [pkg] = await sql`
      INSERT INTO component_packages (code, family, "mountType", origin)
      VALUES (${"PKG-" + RUN}, 'CHIP', 'SMT', 'manual') RETURNING id`;
    ids.pkg = pkg.id;
    const [mat] = await sql`
      INSERT INTO materials (code, name, "packageId")
      VALUES (${"MAT-" + RUN}, 'W8A linked material', ${ids.pkg}) RETURNING id`;
    ids.material = mat.id;
    const [matNoPkg] = await sql`
      INSERT INTO materials (code, name)
      VALUES (${"MATNP-" + RUN}, 'W8A material without package') RETURNING id`;
    ids.materialNoPkg = matNoPkg.id;

    // Point defs — the four linkage states.
    const mkPoint = async (code: string, componentCode: string | null) => {
      const [r] = await sql`
        INSERT INTO measurement_point_defs
          ("productModelId", code, name, "measurementType", "positionX", "positionY", "componentCode", "refDesignator")
        VALUES (${ids.product}, ${code}, ${code}, 'VISUAL', 10, 10, ${componentCode}, ${componentCode ? "R1" : null})
        RETURNING id`;
      return r.id as number;
    };
    ids.pointLinked = await mkPoint(`PT-L-${RUN}`, `MAT-${RUN}`);
    ids.pointNoCode = await mkPoint(`PT-NC-${RUN}`, null);
    ids.pointNoMaterial = await mkPoint(`PT-NM-${RUN}`, `GHOST-${RUN}`);
    ids.pointNoPkg = await mkPoint(`PT-NP-${RUN}`, `MATNP-${RUN}`);

    // One inspection + NG results across the four states (+1 OK control row).
    const [insp] = await sql`
      INSERT INTO product_inspections
        ("machineId", "productModelId", "serialNumber", "overallResult", "originalResult", "inspectionTime")
      VALUES (${ids.machine}, ${ids.product}, ${"SN-" + RUN}, 'NG', 'NG', now())
      RETURNING id`;
    ids.inspection = insp.id;
    const addResult = async (pointDefId: number, result: "OK" | "NG") => {
      const [r] = await sql`
        INSERT INTO measurement_results ("inspectionId", "pointDefId", result)
        VALUES (${ids.inspection}, ${pointDefId}, ${result}) RETURNING id`;
      ids.results.push(r.id);
    };
    // 3 NG on the linked point, 2 NG no-code, 1 NG no-material, 1 NG no-package, 1 OK (ignored).
    await addResult(ids.pointLinked, "NG");
    await addResult(ids.pointLinked, "NG");
    await addResult(ids.pointLinked, "NG");
    await addResult(ids.pointNoCode, "NG");
    await addResult(ids.pointNoCode, "NG");
    await addResult(ids.pointNoMaterial, "NG");
    await addResult(ids.pointNoPkg, "NG");
    await addResult(ids.pointLinked, "OK");
  }, 120_000);

  afterAll(async () => {
    try {
      if (ids.results.length) await sql`DELETE FROM measurement_results WHERE id IN ${sql(ids.results)}`;
      if (ids.inspection) await sql`DELETE FROM product_inspections WHERE id = ${ids.inspection}`;
      await sql`DELETE FROM measurement_point_defs WHERE id IN ${sql([ids.pointLinked, ids.pointNoCode, ids.pointNoMaterial, ids.pointNoPkg].filter(Boolean))}`;
      if (ids.material) await sql`DELETE FROM materials WHERE id = ${ids.material}`;
      if (ids.materialNoPkg) await sql`DELETE FROM materials WHERE id = ${ids.materialNoPkg}`;
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

  it("0191 artifacts exist (tables, columns, ≥40 seed packages)", async () => {
    const [tbl] = await sql`
      SELECT count(*)::int AS cnt FROM information_schema.tables
      WHERE table_name IN ('component_packages','component_footprints')`;
    expect(tbl.cnt).toBe(2);
    const [cols] = await sql`
      SELECT count(*)::int AS cnt FROM information_schema.columns
      WHERE (table_name = 'materials' AND column_name = 'packageId')
         OR (table_name = 'measurement_point_defs' AND column_name IN ('componentCode','refDesignator'))
         OR (table_name = 'machines' AND column_name = 'capabilitiesValidation')`;
    expect(cols.cnt).toBe(4);
    const [seed] = await sql`SELECT count(*)::int AS cnt FROM component_packages WHERE origin = 'seed'`;
    expect(seed.cnt).toBeGreaterThanOrEqual(40);
  });

  it("groups NG results by package with an honest UNLINKED bucket + reason breakdown", async () => {
    // ±48h window: inspectionTime is a DB-local `timestamp` (now()) while the
    // JS Date is serialized in UTC — a wide window absorbs any server-TZ
    // offset; the machineId filter already isolates this fixture.
    const start = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const r = await getPackageDefectPareto({ startDate: start, endDate: end, machineId: ids.machine });

    expect(r.totalDefects).toBe(7); // the OK row never counts
    expect(r.linkedDefects).toBe(3);
    expect(r.unlinkedDefects).toBe(4);
    expect(r.unlinkedBreakdown).toEqual({ noComponentCode: 2, noMaterial: 1, noPackage: 1 });

    const pkgItem = r.items.find((i) => i.bucket === "package");
    expect(pkgItem).toMatchObject({ code: `PKG-${RUN}`, family: "CHIP", count: 3, packageId: ids.pkg });
    const unlinked = r.items.find((i) => i.bucket === "unlinked");
    expect(unlinked).toMatchObject({ code: "UNLINKED", count: 4 });
    // 4 > 3 → UNLINKED ranks first; cumulative reaches 100.
    expect(r.items[0].bucket).toBe("unlinked");
    expect(r.items[r.items.length - 1].cumulativePercentage).toBe(100);
  });

  it("hierarchy filter path (factoryId) returns the same fixture counts", async () => {
    const start = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const r = await getPackageDefectPareto({ startDate: start, endDate: end, factoryId: ids.factory });
    expect(r.totalDefects).toBe(7);
    expect(r.unlinkedDefects).toBe(4);
  });
});
