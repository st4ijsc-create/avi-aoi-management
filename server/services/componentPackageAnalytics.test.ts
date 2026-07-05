/**
 * W8-A (doc 27 M12a / doc 29 §1.3) — pure unit tests for the package-Pareto
 * builder: linked ranking, honest UNLINKED bucket (+reason breakdown), OTHERS
 * tail folding, true cumulative % over the FULL population, empty input.
 */
import { describe, it, expect } from "vitest";
import { buildPackagePareto, type PackageCountRow } from "./componentPackageAnalytics";

const pkg = (id: number, code: string, count: number, family = "CHIP"): PackageCountRow => ({
  packageId: id, code, family, unlinkedReason: null, count,
});
const unlinked = (reason: NonNullable<PackageCountRow["unlinkedReason"]>, count: number): PackageCountRow => ({
  packageId: null, code: null, family: null, unlinkedReason: reason, count,
});

describe("buildPackagePareto", () => {
  it("ranks linked packages and computes true cumulative % over the full population", () => {
    const r = buildPackagePareto([pkg(1, "0402", 60), pkg(2, "SOT-23-3", 30), pkg(3, "QFN-48-7x7", 10)]);
    expect(r.totalDefects).toBe(100);
    expect(r.linkedDefects).toBe(100);
    expect(r.unlinkedDefects).toBe(0);
    expect(r.items.map((i) => i.code)).toEqual(["0402", "SOT-23-3", "QFN-48-7x7"]);
    expect(r.items[0].percentage).toBe(60);
    expect(r.items[1].cumulativePercentage).toBe(90);
    expect(r.items[2].cumulativePercentage).toBe(100);
    expect(r.items.every((i) => i.bucket === "package")).toBe(true);
  });

  it("emits ONE honest UNLINKED bucket that competes in the ranking, with a reason breakdown", () => {
    const r = buildPackagePareto([
      pkg(1, "0402", 20),
      unlinked("no_component_code", 30),
      unlinked("no_material", 10),
      unlinked("no_package", 5),
    ]);
    expect(r.totalDefects).toBe(65);
    expect(r.unlinkedDefects).toBe(45);
    expect(r.linkedDefects).toBe(20);
    expect(r.unlinkedBreakdown).toEqual({ noComponentCode: 30, noMaterial: 10, noPackage: 5 });
    // 45 > 20 → UNLINKED ranks FIRST (never hidden, never appended last).
    expect(r.items[0]).toMatchObject({ code: "UNLINKED", bucket: "unlinked", count: 45 });
    expect(r.items[1]).toMatchObject({ code: "0402", bucket: "package", count: 20 });
    expect(r.items[1].cumulativePercentage).toBe(100);
  });

  it("folds the tail beyond topN into OTHERS without losing counts", () => {
    const rows = Array.from({ length: 6 }, (_, i) => pkg(i + 1, `PKG-${i + 1}`, 60 - i * 10)); // 60..10
    const r = buildPackagePareto(rows, 3);
    const others = r.items.find((i) => i.bucket === "others");
    expect(others).toBeDefined();
    expect(others!.count).toBe(30 + 20 + 10);
    expect(r.items.filter((i) => i.bucket === "package")).toHaveLength(3);
    expect(r.totalDefects).toBe(60 + 50 + 40 + 30 + 20 + 10);
    // Cumulative of the last emitted item is always 100%.
    expect(r.items[r.items.length - 1].cumulativePercentage).toBe(100);
  });

  it("drops zero-count rows and survives empty input", () => {
    expect(buildPackagePareto([]).items).toEqual([]);
    expect(buildPackagePareto([]).totalDefects).toBe(0);
    const r = buildPackagePareto([pkg(1, "0402", 0), unlinked("no_material", 0)]);
    expect(r.items).toEqual([]);
    expect(r.totalDefects).toBe(0);
    expect(r.unlinkedDefects).toBe(0);
  });

  it("legacy unknown unlinked reasons fall into the noComponentCode bucket (fail-safe)", () => {
    const r = buildPackagePareto([{ packageId: null, code: null, family: null, unlinkedReason: null, count: 7 }]);
    expect(r.unlinkedDefects).toBe(7);
    expect(r.unlinkedBreakdown.noComponentCode).toBe(7);
  });
});
