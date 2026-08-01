/**
 * Doc 31 Đợt C (MP7/MP8) — deep bulk-import ROUTER wiring.
 *
 * Proves: (a) tolerance-v2 rows derive legacy limits, (b) measurementTypeCode
 * maps to the legacy enum, (c) 3D fields thread through, (d) a LIVE product
 * strips imported limits and surfaces `skipped`, (e) db per-row failures are
 * passed through (import not aborted). db + gate are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const bulkCreateSpy = vi.fn(async (rows: any[]) => ({ success: rows.length, failed: 0, errors: [] as string[] }));
const getProductSpy = vi.fn(async () => ({ id: 5, imageWidth: 1000, imageHeight: 500 }));
const getCatalogSpy = vi.fn(async (code: string) =>
  code === "DIM_LINEAR" ? { category: "DIMENSION" } : code === "SOLDER_VOLUME" ? { category: "SOLDER" } : undefined,
);

vi.mock("../db", () => ({
  bulkCreateMeasurementPoints: (...a: any[]) => bulkCreateSpy(...a),
  getProductModelById: (...a: any[]) => getProductSpy(...a),
  getMeasurementTypeCatalogByCode: (...a: any[]) => getCatalogSpy(...a),
}));

const gateSpy = vi.fn(async () => ({
  decision: "direct" as const, productModelId: 5, lifecycleStatus: "development",
  hasReleasedProgram: false, enforced: true,
}));
vi.mock("../services/thresholdGovernanceService", () => ({
  resolveProductThresholdGate: (...a: any[]) => gateSpy(...a),
}));

import { bulkImportRouter } from "./statusTemplateRouters";

const adminCtx = { user: { id: 1, role: "admin", twoFactorEnabled: true, name: "Admin" }, req: { ip: null, headers: {} } } as any;
const caller = bulkImportRouter.createCaller(adminCtx);

beforeEach(() => {
  bulkCreateSpy.mockClear();
  getProductSpy.mockClear();
  getCatalogSpy.mockClear();
  gateSpy.mockClear();
  gateSpy.mockResolvedValue({
    decision: "direct", productModelId: 5, lifecycleStatus: "development",
    hasReleasedProgram: false, enforced: true,
  } as any);
});

const points = () => [
  {
    code: "MP-1", name: "Dim", measurementTypeCode: "DIM_LINEAR",
    toleranceMode: "bilateral", nominalValue: 10, tolPlus: 0.2, tolMinus: 0.1,
    positionX: 100, positionY: 250, componentCode: "C-0402", refDesignator: "R7",
  },
  {
    code: "MP-2", name: "Solder", measurementTypeCode: "SOLDER_VOLUME",
    positionX: 200, positionY: 300, heightMin: 0.05, volumeMax: 140, coplanarityMax: 0.1,
    lowerLimit: 1, upperLimit: 9,
  },
];

describe("bulkImport.measurementPoints — development product", () => {
  it("derives limits, maps typeCode, threads 3D + component, normalizes, skipped=0", async () => {
    const res = await caller.measurementPoints({ productModelId: 5, points: points() });
    expect(res.success).toBe(2);
    expect(res.skipped).toBe(0);
    expect(bulkCreateSpy).toHaveBeenCalledTimes(1);
    const rows = bulkCreateSpy.mock.calls[0][0];

    // row 1 — bilateral tolerance → legacy limits, typeCode → DIMENSION, normalized
    expect(rows[0].measurementType).toBe("DIMENSION");
    expect(Number(rows[0].lowerLimit)).toBeCloseTo(9.9, 6);
    expect(Number(rows[0].upperLimit)).toBeCloseTo(10.2, 6);
    expect(rows[0].componentCode).toBe("C-0402");
    expect(rows[0].normalizedX).toBe("0.10000000"); // 100/1000
    expect(rows[0].normalizedY).toBe("0.50000000"); // 250/500

    // row 2 — SOLDER catalog category maps to VISUAL legacy enum; 3D windows kept
    expect(rows[1].measurementType).toBe("VISUAL");
    expect(rows[1].heightMin).toBe("0.05");
    expect(rows[1].coplanarityMax).toBe("0.1");
    expect(rows[1].lowerLimit).toBe("1");
  });
});

describe("bulkImport.measurementPoints — LIVE product", () => {
  it("strips imported limits and surfaces skipped", async () => {
    gateSpy.mockResolvedValue({
      decision: "requires_approval", productModelId: 5, lifecycleStatus: "active",
      hasReleasedProgram: false, enforced: true,
    } as any);
    const res = await caller.measurementPoints({ productModelId: 5, points: points() });
    expect(res.skipped).toBe(2); // both rows carry limit fields
    expect(res.errors.some((e: string) => /without limits/i.test(e))).toBe(true);
    const rows = bulkCreateSpy.mock.calls[0][0];
    expect(rows[0].lowerLimit).toBeUndefined();
    expect(rows[1].heightMin).toBeUndefined();
    // geometry + component still imported
    expect(rows[0].componentCode).toBe("C-0402");
    expect(rows[1].positionX).toBe(200);
  });
});

describe("bulkImport.measurementPoints — partial db failure is passed through (not aborted)", () => {
  it("merges db per-row failures with skipped into the response", async () => {
    bulkCreateSpy.mockResolvedValueOnce({ success: 1, failed: 1, errors: ["MP-2: duplicate"] });
    const res = await caller.measurementPoints({ productModelId: 5, points: points() });
    expect(res.success).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.errors).toContain("MP-2: duplicate");
  });
});
