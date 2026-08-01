import { describe, it, expect } from "vitest";
import {
  buildMachineComparison,
  buildFactoryComparison,
  buildOnDemandReportFilters,
} from "./reportsData";

// doc 32 P0 #2 — the Reports "By machine" / "By factory" tabs + their Excel/PDF
// sheets were hardcoded []. These prove the aggregator mappings now emit real,
// non-empty rows.

const MACHINES = [
  { id: 1, factoryId: 10 },
  { id: 2, factoryId: 10 },
  { id: 3, factoryId: 20 },
];

const TOP_BOTTOM = {
  top: [
    { id: 1, name: "AOI-01", code: "A01", total: 100, ok: 96, ng: 3, ntf: 1, finalYield: 97 },
    { id: 3, name: "AVI-03", code: "V03", total: 200, ok: 190, ng: 8, ntf: 2, finalYield: 96 },
  ],
  bottom: [
    { id: 2, name: "AOI-02", code: "A02", total: 50, ng: 10, finalYield: 80 },
    // duplicate id 1 across top+bottom must be deduped
    { id: 1, name: "AOI-01", code: "A01", total: 100, ng: 3, finalYield: 97 },
  ],
};

describe("buildMachineComparison", () => {
  it("returns [] when no data has arrived (honest empty)", () => {
    expect(buildMachineComparison(undefined, MACHINES, "all")).toEqual([]);
    expect(buildMachineComparison(null, MACHINES, "all")).toEqual([]);
  });

  it("merges top+bottom, dedupes, and derives yield + ng rate", () => {
    const rows = buildMachineComparison(TOP_BOTTOM, MACHINES, "all");
    expect(rows.length).toBe(3); // 1, 3, 2 (id 1 deduped)
    // sorted by yieldRate desc
    expect(rows.map((r) => r.code)).toEqual(["A01", "V03", "A02"]);
    const a01 = rows.find((r) => r.code === "A01")!;
    expect(a01.yieldRate).toBe(97);
    expect(a01.ngRate).toBeCloseTo(3, 5); // 3/100 * 100
    const a02 = rows.find((r) => r.code === "A02")!;
    expect(a02.ngRate).toBeCloseTo(20, 5); // 10/50 * 100
  });

  it("scopes to a single factory via the machine list", () => {
    const rows = buildMachineComparison(TOP_BOTTOM, MACHINES, "10");
    expect(rows.map((r) => r.code).sort()).toEqual(["A01", "A02"]); // factory 10 only
    expect(rows.every((r) => r.code !== "V03")).toBe(true);
  });
});

const FACTORY_YIELD = [
  { corporateCode: "C1", factoryCode: "F1", totalInspections: 300, yieldRate: "96.50" },
  { corporateCode: "C1", factoryCode: "F2", totalInspections: 150, yieldRate: "88.00" },
];
const FACTORIES = [
  { id: 10, code: "F1", name: "Factory One" },
  { id: 20, code: "F2", name: "Factory Two" },
];

describe("buildFactoryComparison", () => {
  it("returns [] before data arrives", () => {
    expect(buildFactoryComparison(undefined, FACTORIES, MACHINES, "all")).toEqual([]);
  });

  it("resolves names, machine counts, and parses yield (sorted by output)", () => {
    const rows = buildFactoryComparison(FACTORY_YIELD, FACTORIES, MACHINES, "all");
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ name: "Factory One", code: "F1", total: 300, yieldRate: 96.5, machines: 2 });
    expect(rows[1]).toMatchObject({ name: "Factory Two", code: "F2", total: 150, yieldRate: 88, machines: 1 });
  });

  it("scopes to the selected factory id", () => {
    const rows = buildFactoryComparison(FACTORY_YIELD, FACTORIES, MACHINES, "20");
    expect(rows.map((r) => r.code)).toEqual(["F2"]);
  });
});

describe("buildOnDemandReportFilters", () => {
  it("omits 'all' / empty and coerces ids (item 15)", () => {
    expect(
      buildOnDemandReportFilters({ lineId: "all", stationId: "5", productModelId: "all", shift: "  A " }),
    ).toEqual({ stationId: 5, shift: "A" });
  });

  it("returns an empty object when nothing is filtered", () => {
    expect(buildOnDemandReportFilters({})).toEqual({});
    expect(buildOnDemandReportFilters({ lineId: "all", shift: "  " })).toEqual({});
  });
});
