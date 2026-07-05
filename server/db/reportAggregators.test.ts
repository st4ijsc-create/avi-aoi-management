/**
 * Wave R1 (doc 32) — PURE unit tests for buildDimensionPareto (no DB).
 * Proves the honesty contract: true cumulative %, top-N + OTHERS folding, the
 * never-hidden UNCLASSIFIED bucket, and the UNSPECIFIED bucket for classified
 * rows whose dimension column is null (nullable ipcSection).
 */
import { describe, it, expect } from "vitest";
import { buildDimensionPareto, type DimensionCountRow } from "./reportAggregators";

describe("buildDimensionPareto", () => {
  it("rolls up by category with a competing, never-hidden UNCLASSIFIED bucket", () => {
    const rows: DimensionCountRow[] = [
      { key: "solder", classified: true, count: 5 },
      { key: "component", classified: true, count: 3 },
      { key: "pcb", classified: true, count: 2 },
      { key: null, classified: false, count: 4 }, // no defectCatalogId
    ];
    const r = buildDimensionPareto(rows, "category");

    expect(r.dimension).toBe("category");
    expect(r.totalDefects).toBe(14);
    expect(r.classifiedDefects).toBe(10);
    expect(r.unclassifiedDefects).toBe(4);

    // Ranking: solder(5) > UNCLASSIFIED(4) > component(3) > pcb(2).
    expect(r.items.map((i) => i.key)).toEqual(["solder", "UNCLASSIFIED", "component", "pcb"]);
    expect(r.items[0]).toMatchObject({ key: "solder", count: 5, bucket: "value" });
    expect(r.items[1]).toMatchObject({ key: "UNCLASSIFIED", count: 4, bucket: "unclassified" });

    // True cumulative % over the FULL population reaches 100 on the last row.
    expect(r.items[0].percentage).toBeCloseTo(35.71, 1);
    expect(r.items[r.items.length - 1].cumulativePercentage).toBe(100);
  });

  it("folds the tail beyond topN into OTHERS but keeps UNCLASSIFIED separate", () => {
    const rows: DimensionCountRow[] = [
      { key: "solder", classified: true, count: 5 },
      { key: "component", classified: true, count: 3 },
      { key: "pcb", classified: true, count: 2 },
      { key: "marking", classified: true, count: 1 },
      { key: null, classified: false, count: 4 },
    ];
    const r = buildDimensionPareto(rows, "category", 2);

    // head = solder,component ; tail = pcb,marking → OTHERS(3) ; + UNCLASSIFIED(4)
    const others = r.items.find((i) => i.bucket === "others");
    expect(others).toMatchObject({ key: "OTHERS", count: 3 });
    const unclassified = r.items.find((i) => i.bucket === "unclassified");
    expect(unclassified).toMatchObject({ key: "UNCLASSIFIED", count: 4 });
    expect(r.totalDefects).toBe(15);
    expect(r.items[r.items.length - 1].cumulativePercentage).toBe(100);
  });

  it("routes classified rows with a null dimension value into UNSPECIFIED (not UNCLASSIFIED)", () => {
    const rows: DimensionCountRow[] = [
      { key: "8", classified: true, count: 6 },
      { key: null, classified: true, count: 2 }, // classified but ipcSection null
      { key: null, classified: false, count: 1 }, // truly unclassified
    ];
    const r = buildDimensionPareto(rows, "ipcSection");

    const unspecified = r.items.find((i) => i.bucket === "unspecified");
    expect(unspecified).toMatchObject({ key: "UNSPECIFIED", count: 2 });
    expect(r.unclassifiedDefects).toBe(1);
    expect(r.classifiedDefects).toBe(8); // 6 + 2 (UNSPECIFIED is still classified)
    expect(r.totalDefects).toBe(9);
  });

  it("ignores zero/negative counts and handles an empty input", () => {
    expect(buildDimensionPareto([], "category")).toMatchObject({ totalDefects: 0, items: [] });
    const r = buildDimensionPareto(
      [
        { key: "solder", classified: true, count: 0 },
        { key: "pcb", classified: true, count: 4 },
      ],
      "category",
    );
    expect(r.totalDefects).toBe(4);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ key: "pcb", count: 4 });
  });
});
