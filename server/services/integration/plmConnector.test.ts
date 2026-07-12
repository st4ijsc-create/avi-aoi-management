/**
 * PLM connector tests — doc 44 W6-5 (G5.24).
 *
 * Covers: PURE anti-corruption maps (PLM vocabulary → canonical whitelist, extra PLM
 * fields dropped, lifecycle/status translated), canonical UPSERTS (idempotent by
 * natural key: product by code, BOM by product+code+version with line replacement),
 * and AUTONOMY on a bad PLM object / dead endpoint. DB is mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../db/connection", () => ({
  getDb: async () => (await import("./enterpriseIntegration.testkit")).makeFakeDb(),
}));

import {
  mapPlmProduct, mapPlmBom, mapPlmRecipe, mapPlmEcn, mapLifecycle,
  upsertProduct, upsertBom, ingestPlmEntity, pullPlm,
} from "./plmConnector";
import { productModels, bomDefinitions, bomLineItems, enterpriseIdMap } from "../../../drizzle/schema";
import { resetFakeDb, queueSelect, fakeDbState } from "./enterpriseIntegration.testkit";

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  process.env.PLM_INTEGRATION_ENABLED = "true";
});

describe("anti-corruption maps (pure — PLM vocabulary never leaks)", () => {
  it("mapPlmProduct translates fields and drops PLM-only ones", () => {
    const canonical = mapPlmProduct({
      partNumber: "PN-500",
      itemName: "Sensor Board",
      lifecyclePhase: "Released",
      revision: "C",
      objectId: "PLM-OID-9",
      vendorClassification: "SECRET_PLM_ENUM", // must NOT survive
      workflowState: "In Approval",
    });
    expect(canonical).toEqual({
      code: "PN-500",
      name: "Sensor Board",
      description: null,
      revision: "C",
      lifecycleStatus: "active", // "Released" → canonical active
      externalId: "PLM-OID-9",
    });
    expect(Object.keys(canonical!)).not.toContain("vendorClassification");
    expect(Object.keys(canonical!)).not.toContain("workflowState");
  });

  it("mapLifecycle maps PLM phases onto the canonical enum", () => {
    expect(mapLifecycle("Released")).toBe("active");
    expect(mapLifecycle("Obsolete")).toBe("eol");
    expect(mapLifecycle("In Work")).toBe("development");
    expect(mapLifecycle("Superseded")).toBe("archived");
    expect(mapLifecycle(undefined)).toBe("active");
  });

  it("mapPlmBom translates lines (uom→unit, referenceDesignators→refDesignator, quantity→qtyPer)", () => {
    const bom = mapPlmBom({
      parentPartNumber: "PN-500",
      bomNumber: "PN-500-BOM",
      revision: "2",
      components: [
        { partNumber: "R100", description: "Res 10k", quantity: "4", uom: "pcs", referenceDesignators: "R1,R2,R3,R4", plmInternalFlag: true },
        { partNumber: "C200", quantity: 2 },
        { description: "no part number" }, // dropped
      ],
    });
    expect(bom!.productCode).toBe("PN-500");
    expect(bom!.version).toBe(2);
    expect(bom!.lines).toEqual([
      { componentCode: "R100", componentName: "Res 10k", qtyPer: 4, unit: "pcs", refDesignator: "R1,R2,R3,R4" },
      { componentCode: "C200", componentName: null, qtyPer: 2, unit: "pcs", refDesignator: null },
    ]);
    expect(JSON.stringify(bom)).not.toContain("plmInternalFlag");
  });

  it("mapPlmRecipe / mapPlmEcn produce canonical whitelist shapes", () => {
    expect(mapPlmRecipe({ recipeCode: "REC-1", status: "Released", revision: "3" })).toMatchObject({ code: "REC-1", status: "active", version: 3 });
    expect(mapPlmEcn({ ecnNumber: "ECN-77", title: "Swap cap", status: "Approved" })).toMatchObject({ ecnKey: "ECN-77", status: "approved" });
  });
});

describe("canonical upserts (idempotent by natural key)", () => {
  it("upsertProduct inserts a new product model then records the id-map", async () => {
    queueSelect(productModels, []); // no existing by code
    queueSelect(enterpriseIdMap, []); // id-map existing lookup
    const r = await upsertProduct({ code: "PN-500", name: "Sensor Board", description: null, revision: "C", lifecycleStatus: "active", externalId: "PLM-OID-9" });
    expect(r.ok).toBe(true);
    expect(r.created).toBe(true);
    expect(fakeDbState.inserts.some((i) => i.table === productModels)).toBe(true);
    expect(fakeDbState.inserts.some((i) => i.table === enterpriseIdMap)).toBe(true);
    // Canonical row carries NO PLM externalId column.
    const prodInsert = fakeDbState.inserts.find((i) => i.table === productModels)!.values as any;
    expect(prodInsert.externalId).toBeUndefined();
  });

  it("upsertProduct updates when the product already exists (no second insert)", async () => {
    queueSelect(productModels, [{ id: 42 }]);
    queueSelect(enterpriseIdMap, []);
    const r = await upsertProduct({ code: "PN-500", name: "Sensor Board v2", description: null, revision: "D", lifecycleStatus: "active", externalId: "PLM-OID-9" });
    expect(r.created).toBe(false);
    expect(r.id).toBe(42);
    expect(fakeDbState.inserts.some((i) => i.table === productModels)).toBe(false);
    expect(fakeDbState.updates.some((u) => u.table === productModels)).toBe(true);
  });

  it("upsertBom resolves the product, inserts the def and its line items", async () => {
    queueSelect(productModels, [{ id: 5 }]); // product resolve
    queueSelect(bomDefinitions, []); // no existing def
    queueSelect(enterpriseIdMap, []); // id-map
    const r = await upsertBom({
      productCode: "PN-500", code: "PN-500-BOM", version: 2, name: null, status: "active", externalId: "PLM-BOM-1",
      lines: [{ componentCode: "R100", componentName: "Res", qtyPer: 4, unit: "pcs", refDesignator: "R1" }],
    });
    expect(r.ok).toBe(true);
    expect(r.created).toBe(true);
    expect(r.lineCount).toBe(1);
    expect(fakeDbState.inserts.some((i) => i.table === bomDefinitions)).toBe(true);
    expect(fakeDbState.inserts.some((i) => i.table === bomLineItems)).toBe(true);
  });

  it("upsertBom fails cleanly for an unknown product (never throws)", async () => {
    queueSelect(productModels, []); // product not found
    const r = await upsertBom({ productCode: "PN-UNKNOWN", code: "x", version: 1, name: null, status: "draft", externalId: null, lines: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown product/);
  });
});

describe("ingest + autonomy", () => {
  it("ingestPlmEntity records the sync and returns the upsert result", async () => {
    queueSelect(productModels, []);
    queueSelect(enterpriseIdMap, []);
    const r = await ingestPlmEntity("product", { partNumber: "PN-9", itemName: "Widget", lifecyclePhase: "Released" });
    expect(r.ok).toBe(true);
    // a sync-log row was written
    const { enterpriseSyncLog } = await import("../../../drizzle/schema");
    expect(fakeDbState.inserts.some((i) => i.table === enterpriseSyncLog)).toBe(true);
  });

  it("pullPlm fails-safe when PLM is down (ok:false, no throw)", async () => {
    const fetchImpl = (async () => { throw new Error("ETIMEDOUT"); }) as unknown as typeof fetch;
    const r = await pullPlm({ entity: "bom", url: "https://plm.test/boms", fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ETIMEDOUT/);
  });

  it("pullPlm is a no-op when disabled", async () => {
    process.env.PLM_INTEGRATION_ENABLED = "false";
    const r = await pullPlm({ entity: "product", url: "u" });
    expect(r.disabled).toBe(true);
  });
});
