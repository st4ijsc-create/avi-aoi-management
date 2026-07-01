/**
 * K0+-b (doc 16 §4 Khối 0 / doc 18 §6) — ISA-95 / B2MML codec tests.
 *
 * Round-trip: encode(json) → decode(xml) == json, for order + BOM. Plus the
 * ProductionPerformance encode and XXE protection. Pure (no DB, no HTTP).
 */
import { describe, it, expect } from "vitest";
import {
  encodeOrderB2MML,
  decodeOrderB2MML,
  encodeBomB2MML,
  decodeBomB2MML,
  encodePerformanceB2MML,
  parseXml,
  looksLikeXml,
  type OrderMessage,
  type BomMessage,
} from "./b2mmlCodec";

describe("K0+-b B2MML order codec (ProductionSchedule/ProductionRequest)", () => {
  const order: OrderMessage = {
    schemaVersion: "1.0",
    idempotencyKey: "idem-123",
    orderCode: "WO-1001",
    companyCode: "ACME",
    factoryId: 3,
    workshopId: 7,
    lineId: 12,
    productModelId: 42,
    targetQuantity: 500,
    priority: 2,
    plannedStartDate: "2026-07-01T08:00:00.000Z",
    plannedEndDate: "2026-07-02T08:00:00.000Z",
    notes: "rush & <urgent>",
  };

  it("round-trips encode → decode back to the same order JSON", () => {
    const xml = encodeOrderB2MML(order);
    expect(xml).toContain("<ProductionSchedule");
    expect(xml).toContain("<ProductionRequest>");
    const decoded = decodeOrderB2MML(xml);
    expect(decoded).toEqual(order);
  });

  it("escapes/unescapes special XML characters losslessly (notes)", () => {
    const decoded = decodeOrderB2MML(encodeOrderB2MML(order));
    expect(decoded.notes).toBe("rush & <urgent>");
  });

  it("round-trips a minimal order (only required fields)", () => {
    const minimal: OrderMessage = {
      schemaVersion: "2.0",
      orderCode: "WO-2",
      companyCode: "CO",
      factoryId: 1,
      workshopId: 1,
      lineId: 1,
      productModelId: 1,
      targetQuantity: 10,
    };
    expect(decodeOrderB2MML(encodeOrderB2MML(minimal))).toEqual(minimal);
  });
});

describe("K0+-b B2MML BOM codec (MaterialInformation/MaterialDefinition)", () => {
  const bom: BomMessage = {
    schemaVersion: "1.0",
    idempotencyKey: "bom-idem-1",
    productModelId: 42,
    code: "BOM-A",
    version: 3,
    name: "Main board BOM",
    status: "active",
    notes: "top-level",
    lines: [
      { componentCode: "R0402-10K", componentName: "10k resistor", qtyPer: 4, unit: "pcs", refDesignator: "R1,R2,R3,R4", isOptional: false },
      { componentCode: "C0603-100n", qtyPer: "2.5", unit: "pcs", alternateGroup: "cap-A", isOptional: true, notes: "alt ok" },
    ],
  };

  it("round-trips encode → decode back to the same BOM JSON", () => {
    const xml = encodeBomB2MML(bom);
    expect(xml).toContain("<MaterialInformation");
    expect(xml).toContain("<AssemblyDefinition>");
    const decoded = decodeBomB2MML(xml);
    // qtyPer is emitted as a string in XML; compare via normalization.
    expect(decoded.code).toBe(bom.code);
    expect(decoded.productModelId).toBe(bom.productModelId);
    expect(decoded.version).toBe(3);
    expect(decoded.status).toBe("active");
    expect(decoded.lines.length).toBe(2);
    expect(decoded.lines[0].componentCode).toBe("R0402-10K");
    expect(decoded.lines[0].componentName).toBe("10k resistor");
    expect(decoded.lines[0].isOptional).toBe(false);
    expect(decoded.lines[0].refDesignator).toBe("R1,R2,R3,R4");
    expect(decoded.lines[1].alternateGroup).toBe("cap-A");
    expect(decoded.lines[1].isOptional).toBe(true);
    expect(String(decoded.lines[1].qtyPer)).toBe("2.5");
  });

  it("handles an empty-line BOM", () => {
    const empty: BomMessage = { schemaVersion: "1.0", productModelId: 1, code: "EMPTY", lines: [] };
    const decoded = decodeBomB2MML(encodeBomB2MML(empty));
    expect(decoded.code).toBe("EMPTY");
    expect(decoded.lines).toEqual([]);
  });
});

describe("K0+-b B2MML ProductionPerformance encode + safety", () => {
  it("encodes an outbound event as ProductionPerformance/ProductionResponse", () => {
    const xml = encodePerformanceB2MML({
      eventType: "quality-result",
      timestamp: "2026-07-01T00:00:00.000Z",
      data: { inspectionId: 9, serialNumber: "SN-1", overallResult: "OK" },
    });
    expect(xml).toContain("<ProductionPerformance>");
    expect(xml).toContain("<ID>quality-result</ID>");
    expect(xml).toContain("<Value>SN-1</Value>");
    const root = parseXml(xml);
    expect(root.tag).toBe("ProductionPerformance");
  });

  it("rejects DOCTYPE/ENTITY (XXE protection)", () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "boom">]><ProductionSchedule/>`;
    expect(() => parseXml(evil)).toThrow(/XXE|DOCTYPE|ENTITY/i);
  });

  it("looksLikeXml detects B2MML bodies", () => {
    expect(looksLikeXml('<?xml version="1.0"?><ProductionSchedule/>')).toBe(true);
    expect(looksLikeXml('  <MaterialInformation></MaterialInformation>')).toBe(true);
    expect(looksLikeXml('{"orderCode":"WO-1"}')).toBe(false);
  });
});
