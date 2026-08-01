/**
 * Doc 31 Đợt C (PM3 / PM8) — product package export→import ROUND-TRIP (seeded DB)
 * + normalized-coord backfill proof.
 *
 * Runs against the ISOLATED test DB (vitest.setup.ts rewrites DATABASE_URL).
 * Seeds one product with points (limits/tolerance/3D/component + a preferred
 * sampling plan ref), a fiducial, a sampling plan, and a 2-up panel; exports the
 * package; re-imports it as a NEW product; asserts counts + field values are
 * lossless and that the sampling-plan reference was remapped by code.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { exportProductPackage, importProductPackage } from "./productPackageService";
import { backfillNormalizedCoordsForProduct } from "../db/product";

const DB_URL = process.env.DATABASE_URL;
const RUN = `PKG${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
const ids = { product: 0, plan: 0, panel: 0, importedProduct: 0, bfProduct: 0 };
const NEW_CODE = `IMP-${RUN}`;
const PLAN_CODE = `SP-${RUN}`;
const PANEL_CODE = `PNL-${RUN}`;

describe.skipIf(!DB_URL)("PM3 product package export→import round-trip (seeded)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });

    const [p] = await sql`
      INSERT INTO product_models (code, name, "lifecycleStatus", "imageWidth", "imageHeight")
      VALUES (${"SRC-" + RUN}, 'Package source', 'development', 1000, 500) RETURNING id`;
    ids.product = p.id;

    const [plan] = await sql`
      INSERT INTO sampling_plans ("productModelId", code, name, strategy, "sampleSize")
      VALUES (${ids.product}, ${PLAN_CODE}, 'AQL plan', 'aql', 20) RETURNING id`;
    ids.plan = plan.id;

    // point 1: full — limits/tolerance/3D/component + preferred sampling plan
    await sql`
      INSERT INTO measurement_point_defs
        ("productModelId", code, name, "measurementType", "measurementTypeCode", unit,
         "lowerLimit", "upperLimit", "nominalValue", "toleranceMode", "tolPlus", "tolMinus",
         "positionX", "positionY", radius, "orderIndex",
         "heightMin", "coplanarityMax", "componentCode", "refDesignator", "preferredSamplingPlanId")
      VALUES (${ids.product}, ${"MP1-" + RUN}, 'Dim point', 'DIMENSION', 'DIM_LINEAR', 'mm',
         9.9, 10.2, 10, 'bilateral', 0.2, 0.1,
         100, 250, 20, 1,
         0.05, 0.1, ${"C-0402-" + RUN}, 'R7', ${ids.plan})`;
    // point 2: bare visual
    await sql`
      INSERT INTO measurement_point_defs
        ("productModelId", code, name, "measurementType", "positionX", "positionY", "orderIndex")
      VALUES (${ids.product}, ${"MP2-" + RUN}, 'Vis point', 'VISUAL', 300, 320, 2)`;

    // one fiducial
    await sql`
      INSERT INTO fiducial_marks ("productModelId", code, name, type, "positionX", "positionY", "orderIndex")
      VALUES (${ids.product}, ${"F1-" + RUN}, 'Fid 1', 'cross', 5, 6, 1)`;

    // panel def + 2 boards
    const [panel] = await sql`
      INSERT INTO product_panel_defs ("productModelId", code, name, rows, cols, "nUp", "originCorner")
      VALUES (${ids.product}, ${PANEL_CODE}, '2-up', 1, 2, 2, 'top_left') RETURNING id`;
    ids.panel = panel.id;
    await sql`INSERT INTO product_panel_boards ("panelDefId", "boardIndex", "offsetXMm", "offsetYMm") VALUES (${ids.panel}, 1, 0, 0)`;
    await sql`INSERT INTO product_panel_boards ("panelDefId", "boardIndex", "offsetXMm", "offsetYMm", "rotationDeg", mirrored) VALUES (${ids.panel}, 2, 50, 0, 90, true)`;
  }, 120_000);

  afterAll(async () => {
    try {
      for (const pid of [ids.product, ids.importedProduct, ids.bfProduct].filter(Boolean)) {
        const panels = await sql`SELECT id FROM product_panel_defs WHERE "productModelId" = ${pid}`;
        for (const pn of panels) await sql`DELETE FROM product_panel_boards WHERE "panelDefId" = ${pn.id}`;
        await sql`DELETE FROM product_panel_defs WHERE "productModelId" = ${pid}`;
        await sql`DELETE FROM fiducial_marks WHERE "productModelId" = ${pid}`;
        await sql`DELETE FROM measurement_point_defs WHERE "productModelId" = ${pid}`;
        await sql`DELETE FROM sampling_plans WHERE "productModelId" = ${pid}`;
        await sql`DELETE FROM product_models WHERE id = ${pid}`;
      }
    } finally {
      await sql?.end();
    }
  }, 60_000);

  it("export produces the full bundle", async () => {
    const pkg = await exportProductPackage(ids.product);
    expect(pkg.formatVersion).toBe(1);
    expect(pkg.model.code).toBe(`SRC-${RUN}`);
    expect(pkg.points.length).toBe(2);
    expect(pkg.fiducials.length).toBe(1);
    expect(pkg.samplingPlans.length).toBe(1);
    expect(pkg.panelDefs.length).toBe(1);
    expect(pkg.panelDefs[0].boards.length).toBe(2);
    // no image blob — only ref metadata + dims
    expect(pkg.model.imageWidth).toBe(1000);
    // the full point carries its plan's CODE (portable), not the DB id
    const full = pkg.points.find((p: any) => p.code === `MP1-${RUN}`)!;
    expect((full as any).preferredSamplingPlanCode).toBe(PLAN_CODE);
  });

  it("import recreates a NEW product, lossless for covered entities + remapped plan ref", async () => {
    const pkg = await exportProductPackage(ids.product);
    const res = await importProductPackage(pkg, { newCode: NEW_CODE, newName: "Imported copy" });
    ids.importedProduct = res.productModelId;

    expect(res.code).toBe(NEW_CODE);
    expect(res.counts).toEqual({ points: 2, fiducials: 1, samplingPlans: 1, panelDefs: 1, panelBoards: 2 });

    // new product forced to development
    const [np] = await sql`SELECT * FROM product_models WHERE id = ${res.productModelId}`;
    expect(np.lifecycleStatus).toBe("development");
    expect(np.name).toBe("Imported copy");
    expect(np.imageWidth).toBe(1000);
    expect(np.imageHeight).toBe(500);

    // points — field values preserved
    const pts = await sql`SELECT * FROM measurement_point_defs WHERE "productModelId" = ${res.productModelId} ORDER BY "orderIndex"`;
    expect(pts.length).toBe(2);
    const full = pts[0];
    expect(full.code).toBe(`MP1-${RUN}`);
    expect(full.measurementTypeCode).toBe("DIM_LINEAR");
    expect(Number(full.lowerLimit)).toBeCloseTo(9.9, 6);
    expect(Number(full.upperLimit)).toBeCloseTo(10.2, 6);
    expect(full.toleranceMode).toBe("bilateral");
    expect(Number(full.tolPlus)).toBeCloseTo(0.2, 6);
    expect(Number(full.heightMin)).toBeCloseTo(0.05, 6);
    expect(full.componentCode).toBe(`C-0402-${RUN}`);
    expect(full.refDesignator).toBe("R7");
    expect(full.positionX).toBe(100);

    // sampling-plan reference REMAPPED to the freshly-created plan (by code)
    const [newPlan] = await sql`SELECT id FROM sampling_plans WHERE "productModelId" = ${res.productModelId} AND code = ${PLAN_CODE}`;
    expect(full.preferredSamplingPlanId).toBe(newPlan.id);
    expect(full.preferredSamplingPlanId).not.toBe(ids.plan); // it's a new id

    // fiducial + panel boards
    const fids = await sql`SELECT * FROM fiducial_marks WHERE "productModelId" = ${res.productModelId}`;
    expect(fids.length).toBe(1);
    expect(fids[0].code).toBe(`F1-${RUN}`);
    const [newPanel] = await sql`SELECT * FROM product_panel_defs WHERE "productModelId" = ${res.productModelId}`;
    const boards = await sql`SELECT * FROM product_panel_boards WHERE "panelDefId" = ${newPanel.id} ORDER BY "boardIndex"`;
    expect(boards.length).toBe(2);
    expect(boards[1].mirrored).toBe(true);
    expect(Number(boards[1].offsetXMm)).toBe(50);
  });

  it("rejects a duplicate newCode", async () => {
    const pkg = await exportProductPackage(ids.product);
    await expect(importProductPackage(pkg, { newCode: NEW_CODE })).rejects.toThrow(/already exists/i);
  });
});

describe.skipIf(!DB_URL)("PM8 backfillNormalizedCoordsForProduct (seeded)", () => {
  it("recomputes normalized coords from image dims", async () => {
    const s = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    try {
      const [p] = await s`
        INSERT INTO product_models (code, name, "lifecycleStatus")
        VALUES (${"BF-" + RUN}, 'Backfill product', 'development') RETURNING id`;
      ids.bfProduct = p.id;
      await s`
        INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY", radius)
        VALUES (${p.id}, ${"BFP-" + RUN}, 'pt', 'VISUAL', 100, 50, 10)`;

      const r = await backfillNormalizedCoordsForProduct(p.id, 200, 100);
      expect(r.points).toBe(1);

      const [pt] = await s`SELECT "normalizedX", "normalizedY", "normalizedRadius" FROM measurement_point_defs WHERE "productModelId" = ${p.id}`;
      expect(Number(pt.normalizedX)).toBeCloseTo(0.5, 6); // 100/200
      expect(Number(pt.normalizedY)).toBeCloseTo(0.5, 6); // 50/100
      expect(Number(pt.normalizedRadius)).toBeCloseTo(0.05, 6); // 10/200
    } finally {
      await s.end();
    }
  });
});
