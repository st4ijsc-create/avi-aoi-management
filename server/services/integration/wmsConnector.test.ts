/**
 * WMS connector tests — doc 44 W6-5 (G5.24).
 *
 * Covers: PURE anti-corruption inventory mapping, OUTBOUND idempotency (no double
 * publish), INBOUND inventory upsert (id-map + canonical metrics), and AUTONOMY when
 * the WMS is down (pull fails-safe, never throws). HTTP + DB are mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./erpOutbox", () => {
  const store = new Map<string, number>();
  let id = 0;
  return {
    enqueueOutbox: vi.fn(async (input: any) => {
      if (input.idempotencyKey && store.has(input.idempotencyKey)) return { ok: true, id: store.get(input.idempotencyKey), duplicate: true };
      id += 1;
      if (input.idempotencyKey) store.set(input.idempotencyKey, id);
      return { ok: true, id };
    }),
  };
});

vi.mock("../../db/connection", () => ({
  getDb: async () => (await import("./enterpriseIntegration.testkit")).makeFakeDb(),
}));

import {
  mapWmsInventory, ingestInventorySnapshot, requestMaterial, confirmMaterialConsumption,
  reportFinishedGoodsPallet, pullInventory,
} from "./wmsConnector";
import { enterpriseIdMap } from "../../../drizzle/schema";
import { resetFakeDb, queueSelect, fakeDbState } from "./enterpriseIntegration.testkit";
import { enqueueOutbox } from "./erpOutbox";

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  process.env.WMS_INTEGRATION_ENABLED = "true";
  process.env.WMS_OUTBOUND_ENDPOINT = "https://wms.test/hook";
});

describe("anti-corruption inventory mapping (pure)", () => {
  it("maps by configured fields and drops every other WMS field", () => {
    const body = {
      items: [
        { sku: "SKU-1", onHand: "150", warehouseBin: "A1", vendorNote: "ignore me", ourCode: "R100" },
        { sku: "SKU-2", onHand: 30 },
        { sku: "SKU-3" }, // no qty → dropped
      ],
    };
    const mapped = mapWmsInventory(body, { externalIdField: "sku", quantityField: "onHand", componentCodeField: "ourCode" });
    expect(mapped).toEqual([
      { externalId: "SKU-1", componentCode: "R100", quantity: 150 },
      { externalId: "SKU-2", componentCode: null, quantity: 30 },
    ]);
    // No warehouseBin / vendorNote leak.
    expect(Object.keys(mapped[0])).toEqual(["externalId", "componentCode", "quantity"]);
  });
});

describe("outbound (durable + idempotent)", () => {
  it("requestMaterial enqueues once; an identical request dedupes", async () => {
    const a = await requestMaterial({ orderCode: "ORD-1", componentCode: "R100", quantity: 500 });
    const b = await requestMaterial({ orderCode: "ORD-1", componentCode: "R100", quantity: 500 });
    expect(a.ok).toBe(true);
    expect(a.duplicate).toBeFalsy();
    expect(b.duplicate).toBe(true); // no double publish
    expect(a.id).toBe(b.id);
    expect((enqueueOutbox as any).mock.calls[0][0].payload.kind).toBe("wms.material.request");
  });

  it("confirmMaterialConsumption + finished-goods pallet route to the right families", async () => {
    await confirmMaterialConsumption({ orderCode: "ORD-1", componentCode: "R100", quantity: 10, lotCode: "L9" });
    await reportFinishedGoodsPallet({ palletCode: "PLT-1", orderCode: "ORD-1", quantity: 24 });
    const calls = (enqueueOutbox as any).mock.calls;
    expect(calls[0][0].payload.kind).toBe("wms.material.confirm");
    expect(calls[0][0].eventType).toBe("production-event");
    expect(calls[1][0].payload.kind).toBe("wms.fg.pallet");
    expect(calls[1][0].eventType).toBe("genealogy-record"); // pallet = genealogy family
  });

  it("does not enqueue when the WMS flag is OFF (autonomous no-op)", async () => {
    process.env.WMS_INTEGRATION_ENABLED = "false";
    const r = await requestMaterial({ orderCode: "ORD-2", componentCode: "R100", quantity: 1 });
    expect(r.disabled).toBe(true);
    expect(enqueueOutbox).not.toHaveBeenCalled();
  });
});

describe("inbound inventory upsert (anti-corruption id-map → canonical metrics)", () => {
  it("maps external ids to canonical codes and returns a canonical metric map", async () => {
    // item 1 carries our code → upsertIdMap does an existing-lookup (none) then insert.
    queueSelect(enterpriseIdMap, []);
    // item 2 has no code → resolveInternalId finds a prior mapping.
    queueSelect(enterpriseIdMap, [{ internalId: "R200" }]);

    const res = await ingestInventorySnapshot([
      { externalId: "SKU-1", componentCode: "R100", quantity: 150 },
      { externalId: "SKU-2", componentCode: null, quantity: 40 },
    ]);

    expect(res.ok).toBe(true);
    expect(res.metrics).toEqual({ R100: 150, R200: 40 });
    expect(res.mapped).toBe(2);
    expect(res.unmapped).toBe(0);
    // The WMS external id was recorded in the id-map, never inside canonical metrics.
    expect(fakeDbState.inserts.some((i) => i.table === enterpriseIdMap)).toBe(true);
  });

  it("counts an unmapped external material (bookkept, not silently dropped)", async () => {
    queueSelect(enterpriseIdMap, []); // resolveInternalId → none
    // upsertIdMap (bookkeep null) → existing lookup none
    queueSelect(enterpriseIdMap, []);
    const res = await ingestInventorySnapshot([{ externalId: "SKU-UNKNOWN", componentCode: null, quantity: 5 }]);
    expect(res.metrics).toEqual({});
    expect(res.unmapped).toBe(1);
  });
});

describe("autonomy when the WMS is down", () => {
  it("pullInventory fails-safe (returns ok:false, never throws)", async () => {
    const fetchImpl = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const res = await pullInventory({ url: "https://wms.test/inv", externalIdField: "sku", quantityField: "onHand", fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ECONNREFUSED/);
    expect(res.metrics).toEqual({});
  });

  it("pullInventory is a no-op when disabled", async () => {
    process.env.WMS_INTEGRATION_ENABLED = "false";
    const res = await pullInventory({ url: "u", externalIdField: "sku", quantityField: "onHand" });
    expect(res.disabled).toBe(true);
  });
});
