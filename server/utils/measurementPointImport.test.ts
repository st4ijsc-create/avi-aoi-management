/**
 * Doc 31 Đợt C (MP7/MP8) — deep bulk-import derivation (pure, no DB).
 */
import { describe, it, expect } from "vitest";
import {
  deepImportPointSchema,
  deriveLegacyLimits,
  mapCatalogCategoryToLegacyType,
  buildInsertFromImportPoint,
} from "./measurementPointImport";

describe("deriveLegacyLimits — tolerance v2 → legacy LSL/USL", () => {
  it("bilateral expands nominal ± tol", () => {
    const r = deriveLegacyLimits({ toleranceMode: "bilateral", nominalValue: 10, tolPlus: 0.2, tolMinus: 0.1 });
    expect(r.lowerLimit).toBeCloseTo(9.9, 6);
    expect(r.upperLimit).toBeCloseTo(10.2, 6);
  });
  it("non-bilateral keeps explicit limits", () => {
    const r = deriveLegacyLimits({ toleranceMode: "range", lowerLimit: 1, upperLimit: 9 });
    expect(r).toEqual({ lowerLimit: 1, upperLimit: 9 });
  });
  it("bilateral with a missing part falls back to explicit", () => {
    const r = deriveLegacyLimits({ toleranceMode: "bilateral", nominalValue: 10, tolPlus: 0.2, lowerLimit: 5, upperLimit: 15 });
    expect(r).toEqual({ lowerLimit: 5, upperLimit: 15 });
  });
});

describe("mapCatalogCategoryToLegacyType", () => {
  it("GD_T → DIMENSION, SOLDER → VISUAL (default), ELECTRICAL passthrough", () => {
    expect(mapCatalogCategoryToLegacyType("GD_T")).toBe("DIMENSION");
    expect(mapCatalogCategoryToLegacyType("DIMENSION")).toBe("DIMENSION");
    expect(mapCatalogCategoryToLegacyType("SOLDER")).toBe("VISUAL");
    expect(mapCatalogCategoryToLegacyType("ELECTRICAL")).toBe("ELECTRICAL");
    expect(mapCatalogCategoryToLegacyType(null)).toBe("VISUAL");
  });
});

describe("deepImportPointSchema", () => {
  it("parses a full deep row (tolerance + 3D + typeCode + component)", () => {
    const p = deepImportPointSchema.parse({
      code: "MP-1", name: "Solder", measurementTypeCode: "SOLDER_VOLUME",
      toleranceMode: "bilateral", nominalValue: 10, tolPlus: 0.2, tolMinus: 0.1,
      positionX: 100, positionY: 150, heightMin: 0.05, volumeMax: 140, coplanarityMax: 0.1,
      componentCode: "U-QFN48", refDesignator: "U3",
    });
    expect(p.code).toBe("MP-1");
    expect(p.heightMin).toBe(0.05);
  });
  it("still parses a bare legacy row", () => {
    const p = deepImportPointSchema.parse({ code: "MP-2", name: "Vis", positionX: 1, positionY: 2 });
    expect(p.radius).toBe(20); // default
  });
});

describe("buildInsertFromImportPoint", () => {
  const dims = { imageWidth: 1000, imageHeight: 500 };

  it("development product: derives limits, keeps 3D + component, computes normalized coords", () => {
    const p = deepImportPointSchema.parse({
      code: "MP-1", name: "Dim", measurementTypeCode: "DIM_LINEAR",
      toleranceMode: "bilateral", nominalValue: 10, tolPlus: 0.2, tolMinus: 0.1,
      positionX: 100, positionY: 250, radius: 20,
      heightMin: 0.05, volumeMax: 140, coplanarityMax: 0.1,
      componentCode: "C-0402", refDesignator: "R7",
    });
    const { row, limitsStripped } = buildInsertFromImportPoint(p, 5, "DIMENSION", 3, dims, false);
    expect(limitsStripped).toBe(false);
    expect(row.measurementType).toBe("DIMENSION");
    expect(Number(row.lowerLimit)).toBeCloseTo(9.9, 6);
    expect(Number(row.upperLimit)).toBeCloseTo(10.2, 6);
    expect(row.heightMin).toBe("0.05");
    expect(row.coplanarityMax).toBe("0.1");
    expect(row.componentCode).toBe("C-0402");
    expect(row.refDesignator).toBe("R7");
    expect(row.orderIndex).toBe(3);
    // normalized: 100/1000, 250/500
    expect(row.normalizedX).toBe("0.10000000");
    expect(row.normalizedY).toBe("0.50000000");
  });

  it("LIVE product: strips ALL limit-bearing fields but keeps geometry/component", () => {
    const p = deepImportPointSchema.parse({
      code: "MP-2", name: "Solder", toleranceMode: "bilateral", nominalValue: 10, tolPlus: 0.2, tolMinus: 0.1,
      positionX: 100, positionY: 200, lowerLimit: 1, upperLimit: 9,
      heightMin: 0.05, volumeMax: 140, coplanarityMax: 0.1, componentCode: "U-QFN", refDesignator: "U3",
    });
    const { row, limitsStripped } = buildInsertFromImportPoint(p, 5, "VISUAL", 1, dims, true);
    expect(limitsStripped).toBe(true);
    expect(row.lowerLimit).toBeUndefined();
    expect(row.upperLimit).toBeUndefined();
    expect(row.nominalValue).toBeUndefined();
    expect(row.toleranceMode).toBeUndefined();
    expect(row.heightMin).toBeUndefined();
    expect(row.coplanarityMax).toBeUndefined();
    // non-limit fields survive
    expect(row.componentCode).toBe("U-QFN");
    expect(row.refDesignator).toBe("U3");
    expect(row.positionX).toBe(100);
  });

  it("LIVE product with NO limit fields: nothing stripped (limitsStripped=false)", () => {
    const p = deepImportPointSchema.parse({ code: "MP-3", name: "Vis", positionX: 10, positionY: 20, componentCode: "R-1" });
    const { row, limitsStripped } = buildInsertFromImportPoint(p, 5, "VISUAL", 1, dims, true);
    expect(limitsStripped).toBe(false);
    expect(row.componentCode).toBe("R-1");
  });

  // Task 8 Khối C (Task 7 review F2) — trước bản vá `unit` được gán VÔ ĐIỀU
  // KIỆN ở buildInsertFromImportPoint, không qua touchesLimits nào: một sheet
  // đổi CHỈ `unit` trên sản phẩm live ghi thẳng, lách hàng đợi duyệt hoàn toàn.
  it("LIVE product with ONLY `unit` set: unit IS a limit field — gate strips it too", () => {
    const p = deepImportPointSchema.parse({
      code: "MP-5", name: "Vis", positionX: 10, positionY: 20, unit: "mm",
    });
    const { row, limitsStripped } = buildInsertFromImportPoint(p, 5, "VISUAL", 1, dims, true);
    expect(limitsStripped).toBe(true);
    expect(row.unit).toBeUndefined();
  });

  it("DEVELOPMENT product: `unit` alone is kept (no gate on a non-live product)", () => {
    const p = deepImportPointSchema.parse({
      code: "MP-6", name: "Vis", positionX: 10, positionY: 20, unit: "mm",
    });
    const { row, limitsStripped } = buildInsertFromImportPoint(p, 5, "VISUAL", 1, dims, false);
    expect(limitsStripped).toBe(false);
    expect(row.unit).toBe("mm");
  });

  it("geometry rect derives the legacy anchor (centroid + bounding radius)", () => {
    const p = deepImportPointSchema.parse({
      code: "MP-4", name: "Rect", positionX: 0, positionY: 0,
      shape: "rect", geometry: { shape: "rect", x: 100, y: 200, width: 40, height: 20 },
    });
    const { row } = buildInsertFromImportPoint(p, 5, "VISUAL", 1, null, false);
    expect(row.positionX).toBe(120); // 100 + 40/2
    expect(row.positionY).toBe(210); // 200 + 20/2
    expect(row.radius).toBe(20);     // max(40,20)/2
    expect(row.shape).toBe("rect");
    expect(row.normalizedX).toBeUndefined(); // no dims → no normalization
  });
});
