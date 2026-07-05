/**
 * Doc 31 — Đợt C (MP5 / PM4) — centroid import service tests.
 *
 * Two layers:
 *  1. PURE (always run): buildCentroidPointDefRows idempotency / componentCode
 *     fill / normalized coords / order sequencing; candidate <-> source mapping.
 *  2. INTEGRATION (skipIf !DATABASE_URL): commit → apply → re-apply(idempotent)
 *     → overlap-skip against the isolated test DB (mirrors
 *     componentLinkBackfill.db.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCentroidPointDefRows,
  candidateToSource,
  centroidCandidateToInsertRow,
  commitCentroidImport,
  applyCentroidImport,
  type CentroidPointSource,
} from "./centroidImportService";
import type { CentroidCandidate } from "./centroidParser";

// ── 1. PURE builder ─────────────────────────────────────────────────────────

const src = (over: Partial<CentroidPointSource>): CentroidPointSource => ({
  code: "R1", name: "R1", positionX: 100.6, positionY: 200.4,
  refDesignator: "R1", ...over,
});

describe("buildCentroidPointDefRows", () => {
  const product = { imageWidth: 1000, imageHeight: 500, coordinateMode: "pixel" };

  it("fills componentCode + refDesignator, rounds coords, sets normalized", () => {
    const { rows, appliedCodes, skippedCodes } = buildCentroidPointDefRows(
      [src({ code: "R1", refDesignator: "R1", componentCode: "C-0402-10K", package: "0402", rotation: 90, side: "top" })],
      new Set(),
      product,
      { measurementType: "VISUAL", radius: 15 },
      1,
    );
    expect(appliedCodes).toEqual(["R1"]);
    expect(skippedCodes).toEqual([]);
    const r = rows[0] as any;
    expect(r.code).toBe("R1");
    expect(r.refDesignator).toBe("R1");
    expect(r.componentCode).toBe("C-0402-10K");
    expect(r.positionX).toBe(101); // rounded
    expect(r.positionY).toBe(200);
    expect(r.radius).toBe(15);
    expect(r.measurementType).toBe("VISUAL");
    expect(Number(r.normalizedX)).toBeCloseTo(101 / 1000, 6);
    expect(Number(r.normalizedY)).toBeCloseTo(200 / 500, 6);
    // centroid metadata preserved in geometry
    expect(r.geometry.centroid.rotation).toBe(90);
    expect(r.geometry.centroid.side).toBe("top");
    expect(r.geometry.centroid.package).toBe("0402");
  });

  it("is IDEMPOTENT — skips codes/refdes already present", () => {
    const existing = new Set(["r1", "u3"]); // lowercased
    const { appliedCodes, skippedCodes } = buildCentroidPointDefRows(
      [src({ code: "R1", refDesignator: "R1" }), src({ code: "R2", refDesignator: "R2" }), src({ code: "X", refDesignator: "U3" })],
      existing,
      product,
      {},
      1,
    );
    expect(appliedCodes).toEqual(["R2"]);
    expect(skippedCodes.sort()).toEqual(["R1", "X"]); // R1 by code, X by its refdes U3
  });

  it("dedupes within the same batch", () => {
    const { appliedCodes, skippedCodes } = buildCentroidPointDefRows(
      [src({ code: "R5", refDesignator: "R5" }), src({ code: "R5", refDesignator: "R5" })],
      new Set(),
      product,
      {},
      1,
    );
    expect(appliedCodes).toEqual(["R5"]);
    expect(skippedCodes).toEqual(["R5"]);
  });

  it("sequences orderIndex from the given start", () => {
    const { rows } = buildCentroidPointDefRows(
      [src({ code: "A", refDesignator: "A" }), src({ code: "B", refDesignator: "B" })],
      new Set(),
      product,
      {},
      42,
    );
    expect((rows[0] as any).orderIndex).toBe(42);
    expect((rows[1] as any).orderIndex).toBe(43);
  });

  it("defaults measurementType to VISUAL and radius to 20; omits normalized when no dims", () => {
    const { rows } = buildCentroidPointDefRows(
      [src({ code: "A", refDesignator: "A" })],
      new Set(),
      { imageWidth: null, imageHeight: null, coordinateMode: "mm" },
      {},
      1,
    );
    const r = rows[0] as any;
    expect(r.measurementType).toBe("VISUAL");
    expect(r.radius).toBe(20);
    expect(r.normalizedX).toBeUndefined();
  });
});

describe("candidateToSource / centroidCandidateToInsertRow round-trip", () => {
  const cand: CentroidCandidate = {
    candidateIndex: 3, code: "U7", name: "U7 · QFN48", shape: "circle",
    positionX: 123.4, positionY: 56.7, normalizedX: 0.1, normalizedY: 0.2,
    refDesignator: "U7", rotation: 270, side: "bottom", package: "QFN48",
    componentCode: "MCU", placedStatus: "placed",
    rawX: 12.34, rawY: 5.67, mmX: 12.34, mmY: 5.67, unit: "mm",
  };
  it("insert-row carries centroid meta in geometry; source reads it back", () => {
    const row = centroidCandidateToInsertRow(99, cand);
    expect(row.jobId).toBe(99);
    expect(row.code).toBe("U7");
    expect((row.geometry as any).centroid.componentCode).toBe("MCU");
    // Simulate the DB shape (decimals come back as strings) then map to source.
    const dbRow: any = {
      candidateIndex: 3, code: "U7", name: "U7 · QFN48",
      positionX: "123.4", positionY: "56.7", geometry: row.geometry,
    };
    const s = candidateToSource(dbRow);
    expect(s.refDesignator).toBe("U7");
    expect(s.componentCode).toBe("MCU");
    expect(s.side).toBe("bottom");
    expect(s.rotation).toBe(270);
    expect(s.positionX).toBeCloseTo(123.4, 3);
  });
});

// ── 2. INTEGRATION (isolated test DB) ───────────────────────────────────────

const DB_URL = process.env.DATABASE_URL;
const RUN = `CEN${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let sql: ReturnType<typeof postgres>;
let productId = 0;

const CSV = [
  "refdes,x,y,rotation,side,package,value",
  "R1,10,20,0,top,0402,10K",
  "R2,15,20,90,top,0402,4K7",
  "U1,30,40,270,top,QFN48,MCU",
].join("\n");

const COLUMN_MAP = {
  refDesignator: "refdes", x: "x", y: "y", rotation: "rotation",
  side: "side", package: "package", componentCode: "value",
} as const;

describe.skipIf(!DB_URL)("centroid import — commit → apply lifecycle (seeded)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    // Apply 0196 idempotently so this runs on a clone predating the migration
    // (allows format='centroid' on cad_import_jobs).
    const here = dirname(fileURLToPath(import.meta.url));
    const migPath = join(here, "..", "..", "..", "drizzle", "0196_cad_import_centroid_format.sql");
    await sql.unsafe(readFileSync(migPath, "utf-8"));
    const [p] = await sql`
      INSERT INTO product_models (code, name, "lifecycleStatus", "coordinateMode", "imageWidth", "imageHeight")
      VALUES (${"PC-" + RUN}, 'Centroid product', 'development', 'pixel', 1000, 800)
      RETURNING id`;
    productId = p.id;
  });

  afterAll(async () => {
    if (!sql) return;
    try {
      await sql`DELETE FROM measurement_point_defs WHERE "productModelId" = ${productId}`;
      await sql`DELETE FROM cad_import_candidates WHERE "jobId" IN (SELECT id FROM cad_import_jobs WHERE "productModelId" = ${productId})`;
      await sql`DELETE FROM cad_import_jobs WHERE "productModelId" = ${productId}`;
      await sql`DELETE FROM product_models WHERE id = ${productId}`;
    } catch { /* best-effort */ }
    await sql.end({ timeout: 5 });
  });

  it("commit persists a centroid job + candidates", async () => {
    const res = await commitCentroidImport({
      productModelId: productId,
      fileName: "seed.csv",
      text: CSV,
      columnMap: COLUMN_MAP as any,
      transformOptions: { unit: "mm", targetMode: "pixel", fitToImage: true },
      uploadedBy: 0,
    });
    expect(res.candidates).toBe(3);
    const [job] = await sql`SELECT * FROM cad_import_jobs WHERE id = ${res.jobId}`;
    expect(job.format).toBe("centroid");
    const cands = await sql`SELECT * FROM cad_import_candidates WHERE "jobId" = ${res.jobId}`;
    expect(cands.length).toBe(3);
  });

  it("apply generates point defs with componentCode filled; re-apply is idempotent; overlap is skipped", async () => {
    // Pre-existing point with refdes R1 → must be skipped on apply.
    await sql`
      INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY", "refDesignator")
      VALUES (${productId}, 'R1', 'pre-existing R1', 'VISUAL', 1, 1, 'R1')`;

    const commit = await commitCentroidImport({
      productModelId: productId,
      fileName: "apply.csv",
      text: CSV,
      columnMap: COLUMN_MAP as any,
      transformOptions: { unit: "mm", targetMode: "pixel", fitToImage: true },
      uploadedBy: 0,
    });

    const applied = await applyCentroidImport({ jobId: commit.jobId, appliedBy: 0 });
    // R2 + U1 applied; R1 skipped (overlap with the pre-existing point).
    expect(applied.applied).toBe(2);
    expect(applied.skipped).toBe(1);
    expect(applied.skippedCodes).toContain("R1");

    const defs = await sql`
      SELECT code, "componentCode", "refDesignator" FROM measurement_point_defs
      WHERE "productModelId" = ${productId} AND code IN ('R2','U1') ORDER BY code`;
    expect(defs.length).toBe(2);
    const u1 = defs.find((d: any) => d.code === "U1")!;
    expect(u1.componentCode).toBe("MCU");
    expect(u1.refDesignator).toBe("U1");

    // Re-applying the same (now applied) job does nothing.
    const again = await applyCentroidImport({ jobId: commit.jobId, appliedBy: 0 });
    expect(again.applied).toBe(0);
  });
});
