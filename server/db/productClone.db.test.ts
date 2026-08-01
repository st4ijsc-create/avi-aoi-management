/**
 * Doc 31 Đợt C (PM1 / PM2, WC-2) — INTEGRATION test of cloneProductModel.
 *
 * Runs against the ISOLATED test DB (vitest.setup.ts rewrites DATABASE_URL to
 * <db>_test). Applies 0197 itself (idempotent) so it works on a clone predating it.
 *
 * Proves the clone:
 *   • deep-copies measurement points (with componentCode/limits), fiducials, panel
 *     defs + boards, and sampling plans (counts match the source);
 *   • does NOT copy inspection results, golden samples, or program releases;
 *   • resets lifecycle to 'development', persists the new revision, sets clonedFromId;
 *   • REMAPS point.preferredSamplingPlanId to the freshly-cloned plan + CLEARS
 *     productViewId (views out of scope);
 *   • respects copyMappings (false → 0 machine mappings, true → copies them);
 *   • rejects a code collision (unique index).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { cloneProductModel } from "./product";

const DB_URL = process.env.DATABASE_URL;
const root = path.resolve(__dirname, "..", "..");
const RUN = `PM1${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
const ids = {
  factory: 0, workshop: 0, line: 0, station: 0, machine: 0,
  product: 0, plan: 0, view: 0,
  pointA: 0, pointB: 0, fidA: 0, fidB: 0,
  panel: 0, inspection: 0, resultA: 0, golden: 0,
  clone1: 0, clone2: 0,
};

describe.skipIf(!DB_URL)("PM1 cloneProductModel — deep copy (seeded)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    // Idempotent: ensure revision + clonedFromId columns exist on a clone predating 0197.
    await sql.unsafe(fs.readFileSync(path.join(root, "drizzle", "0197_product_revision_clone.sql"), "utf-8"));

    const [f] = await sql`INSERT INTO factories (code, name) VALUES (${"F-" + RUN}, 'PM1 factory') RETURNING id`;
    ids.factory = f.id;
    const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'PM1 workshop') RETURNING id`;
    ids.workshop = w.id;
    const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'PM1 line') RETURNING id`;
    ids.line = l.id;
    const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'PM1 station') RETURNING id`;
    ids.station = s.id;
    const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${ids.station}, ${"M-" + RUN}, 'PM1 machine', 'AOI') RETURNING id`;
    ids.machine = m.id;

    // Source product: ACTIVE + revision "A" + a reference image key + dims.
    const [p] = await sql`
      INSERT INTO product_models (code, name, "lifecycleStatus", revision, "referenceImageKey", "imageWidth", "imageHeight")
      VALUES (${"P-" + RUN}, 'PM1 source', 'active', 'A', ${"img/" + RUN + ".png"}, 1024, 768)
      RETURNING id`;
    ids.product = p.id;

    // A product-scoped sampling plan + product view (to prove remap + view clear).
    const [plan] = await sql`
      INSERT INTO sampling_plans ("productModelId", code, name, strategy) VALUES (${ids.product}, ${"SP-" + RUN}, 'PM1 plan', 'fixed_n') RETURNING id`;
    ids.plan = plan.id;
    const [view] = await sql`
      INSERT INTO product_views ("productModelId", code, name, "viewType") VALUES (${ids.product}, ${"VW-" + RUN}, 'Top', 'top') RETURNING id`;
    ids.view = view.id;

    // Point A: rich — componentCode + limits + preferredSamplingPlanId + productViewId.
    const [pa] = await sql`
      INSERT INTO measurement_point_defs
        ("productModelId", code, name, "measurementType", "positionX", "positionY",
         "componentCode", "refDesignator", "lowerLimit", "upperLimit", "nominalValue",
         "preferredSamplingPlanId", "productViewId")
      VALUES (${ids.product}, ${"PT-A-" + RUN}, 'Cap C12', 'DIMENSION', 100, 150,
              'C-0402-10K', 'C12', '1.500000', '2.500000', '2.000000', ${ids.plan}, ${ids.view})
      RETURNING id`;
    ids.pointA = pa.id;
    const [pb] = await sql`
      INSERT INTO measurement_point_defs
        ("productModelId", code, name, "measurementType", "positionX", "positionY")
      VALUES (${ids.product}, ${"PT-B-" + RUN}, 'Res R7', 'VISUAL', 200, 250)
      RETURNING id`;
    ids.pointB = pb.id;

    // Fiducials.
    const [fa] = await sql`
      INSERT INTO fiducial_marks ("productModelId", code, name, "positionX", "positionY") VALUES (${ids.product}, ${"FID-A-" + RUN}, 'F1', 10, 10) RETURNING id`;
    ids.fidA = fa.id;
    const [fb] = await sql`
      INSERT INTO fiducial_marks ("productModelId", code, name, "positionX", "positionY") VALUES (${ids.product}, ${"FID-B-" + RUN}, 'F2', 900, 700) RETURNING id`;
    ids.fidB = fb.id;

    // Panel def + 3 boards.
    const [panel] = await sql`
      INSERT INTO product_panel_defs ("productModelId", code, rows, cols, "nUp") VALUES (${ids.product}, ${"PNL-" + RUN}, 1, 3, 3) RETURNING id`;
    ids.panel = panel.id;
    for (let i = 1; i <= 3; i++) {
      await sql`INSERT INTO product_panel_boards ("panelDefId", "boardIndex", "offsetXMm", "offsetYMm") VALUES (${ids.panel}, ${i}, ${i * 10}, 0)`;
    }

    // Machine mapping (only copied when copyMappings=true).
    await sql`INSERT INTO product_machine_mappings ("productModelId", "machineId", priority) VALUES (${ids.product}, ${ids.machine}, 5)`;

    // A golden sample keyed by the SOURCE product code — must NOT follow the clone.
    const [g] = await sql`
      INSERT INTO golden_sample_references ("productCode", "productModelId", "grayBase64", width, height, status)
      VALUES (${"P-" + RUN}, ${ids.product}, 'AAAA', 8, 8, 'approved') RETURNING id`;
    ids.golden = g.id;

    // An inspection + NG result on point A — results must NOT follow the clone.
    const [insp] = await sql`
      INSERT INTO product_inspections ("machineId", "productModelId", "serialNumber", "overallResult", "originalResult", "inspectionTime")
      VALUES (${ids.machine}, ${ids.product}, ${"SN-" + RUN}, 'NG', 'NG', now()) RETURNING id`;
    ids.inspection = insp.id;
    const [res] = await sql`INSERT INTO measurement_results ("inspectionId", "pointDefId", result) VALUES (${ids.inspection}, ${ids.pointA}, 'NG') RETURNING id`;
    ids.resultA = res.id;
  }, 120_000);

  afterAll(async () => {
    try {
      // Clean children of clones first (points/fiducials/plans/panels + boards).
      for (const cid of [ids.clone1, ids.clone2].filter(Boolean)) {
        const panels = await sql`SELECT id FROM product_panel_defs WHERE "productModelId" = ${cid}`;
        for (const pn of panels) await sql`DELETE FROM product_panel_boards WHERE "panelDefId" = ${pn.id}`;
        await sql`DELETE FROM product_panel_defs WHERE "productModelId" = ${cid}`;
        await sql`DELETE FROM measurement_point_defs WHERE "productModelId" = ${cid}`;
        await sql`DELETE FROM fiducial_marks WHERE "productModelId" = ${cid}`;
        await sql`DELETE FROM sampling_plans WHERE "productModelId" = ${cid}`;
        await sql`DELETE FROM product_machine_mappings WHERE "productModelId" = ${cid}`;
        await sql`DELETE FROM product_models WHERE id = ${cid}`;
      }
      if (ids.resultA) await sql`DELETE FROM measurement_results WHERE id = ${ids.resultA}`;
      if (ids.inspection) await sql`DELETE FROM product_inspections WHERE id = ${ids.inspection}`;
      if (ids.golden) await sql`DELETE FROM golden_sample_references WHERE id = ${ids.golden}`;
      await sql`DELETE FROM product_machine_mappings WHERE "productModelId" = ${ids.product}`;
      await sql`DELETE FROM product_panel_boards WHERE "panelDefId" = ${ids.panel}`;
      if (ids.panel) await sql`DELETE FROM product_panel_defs WHERE id = ${ids.panel}`;
      await sql`DELETE FROM fiducial_marks WHERE "productModelId" = ${ids.product}`;
      await sql`DELETE FROM measurement_point_defs WHERE "productModelId" = ${ids.product}`;
      await sql`DELETE FROM product_views WHERE "productModelId" = ${ids.product}`;
      await sql`DELETE FROM sampling_plans WHERE "productModelId" = ${ids.product}`;
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

  it("deep-copies children (counts match), resets lifecycle, persists revision + clonedFromId", async () => {
    const r = await cloneProductModel({
      sourceId: ids.product,
      newCode: `P-${RUN}-B`,
      newName: "PM1 clone B",
      newRevision: "B",
      copyMappings: false,
    });
    ids.clone1 = r.newProductId;

    // Summary counts.
    expect(r.summary).toMatchObject({
      measurementPoints: 2,
      fiducialMarks: 2,
      panelDefs: 1,
      panelBoards: 3,
      samplingPlans: 1,
      machineMappings: 0, // copyMappings=false
      revision: "B",
      clonedFromId: ids.product,
    });

    // Product row: reset + provenance + shared image.
    const [prod] = await sql`SELECT * FROM product_models WHERE id = ${r.newProductId}`;
    expect(prod.lifecycleStatus).toBe("development");
    expect(prod.revision).toBe("B");
    expect(prod.clonedFromId).toBe(ids.product);
    expect(prod.code).toBe(`P-${RUN}-B`);
    expect(prod.referenceImageKey).toBe(`img/${RUN}.png`); // image copied so the clone is usable
    expect(prod.pointsConfigVersion).toBe(1);

    // Child counts in the DB match the source.
    const [pts] = await sql`SELECT count(*)::int AS c FROM measurement_point_defs WHERE "productModelId" = ${r.newProductId} AND "deletedAt" IS NULL`;
    expect(pts.c).toBe(2);
    const [fids] = await sql`SELECT count(*)::int AS c FROM fiducial_marks WHERE "productModelId" = ${r.newProductId} AND "deletedAt" IS NULL`;
    expect(fids.c).toBe(2);
    const [plans] = await sql`SELECT count(*)::int AS c FROM sampling_plans WHERE "productModelId" = ${r.newProductId} AND "deletedAt" IS NULL`;
    expect(plans.c).toBe(1);
    const panels = await sql`SELECT id FROM product_panel_defs WHERE "productModelId" = ${r.newProductId} AND "deletedAt" IS NULL`;
    expect(panels.length).toBe(1);
    const [boards] = await sql`SELECT count(*)::int AS c FROM product_panel_boards WHERE "panelDefId" = ${panels[0].id}`;
    expect(boards.c).toBe(3);
  });

  it("copies componentCode + limits, REMAPS preferredSamplingPlanId, and CLEARS productViewId", async () => {
    const [clonedA] = await sql`
      SELECT * FROM measurement_point_defs
      WHERE "productModelId" = ${ids.clone1} AND "componentCode" = 'C-0402-10K'`;
    expect(clonedA).toBeTruthy();
    expect(clonedA.refDesignator).toBe("C12");
    expect(Number(clonedA.lowerLimit)).toBe(1.5);
    expect(Number(clonedA.upperLimit)).toBe(2.5);

    // preferredSamplingPlanId points at the NEW plan, not the source plan.
    const [newPlan] = await sql`SELECT id FROM sampling_plans WHERE "productModelId" = ${ids.clone1}`;
    expect(clonedA.preferredSamplingPlanId).toBe(newPlan.id);
    expect(clonedA.preferredSamplingPlanId).not.toBe(ids.plan);
    // productViewId cleared (views are not in clone scope).
    expect(clonedA.productViewId).toBeNull();
  });

  it("does NOT copy inspection results, golden samples, or program releases", async () => {
    // No results reference the cloned points.
    const [res] = await sql`
      SELECT count(*)::int AS c FROM measurement_results mr
      JOIN measurement_point_defs mp ON mp.id = mr."pointDefId"
      WHERE mp."productModelId" = ${ids.clone1}`;
    expect(res.c).toBe(0);
    // No goldens by FK or by the new product code.
    const [gFk] = await sql`SELECT count(*)::int AS c FROM golden_sample_references WHERE "productModelId" = ${ids.clone1}`;
    expect(gFk.c).toBe(0);
    const [gCode] = await sql`SELECT count(*)::int AS c FROM golden_sample_references WHERE "productCode" = ${`P-${RUN}-B`}`;
    expect(gCode.c).toBe(0);
  });

  it("respects copyMappings=true (copies machine mappings)", async () => {
    const r = await cloneProductModel({
      sourceId: ids.product,
      newCode: `P-${RUN}-C`,
      copyMappings: true,
    });
    ids.clone2 = r.newProductId;
    expect(r.summary.machineMappings).toBe(1);
    const [maps] = await sql`SELECT count(*)::int AS c FROM product_machine_mappings WHERE "productModelId" = ${r.newProductId}`;
    expect(maps.c).toBe(1);
    // Default revision when not overridden: carried from the source ("A").
    const [prod] = await sql`SELECT revision FROM product_models WHERE id = ${r.newProductId}`;
    expect(prod.revision).toBe("A");
  });

  it("rejects a code collision (unique index)", async () => {
    await expect(cloneProductModel({
      sourceId: ids.product,
      newCode: `P-${RUN}-B`, // already used by clone1
      copyMappings: false,
    })).rejects.toThrow();
  });
});
