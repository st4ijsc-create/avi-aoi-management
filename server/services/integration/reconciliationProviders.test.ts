/**
 * Enterprise reconciliation provider tests — doc 44 W6-5 (G5.24).
 *
 * Covers: configurable REST metric mapping (field-map, no vendor shape hardcoded),
 * anti-corruption external-id → canonical resolution, the real WMS-inventory provider
 * fetching both sides and surfacing drift as a ticket, the real internal DB inventory
 * source, and env registration. HTTP + DB mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../db/connection", () => ({
  getDb: async () => (await import("./enterpriseIntegration.testkit")).makeFakeDb(),
}));

import {
  resolveMetrics, makeGenericReconcileProvider, makeWmsInventoryReconcileProvider,
  internalLineInventoryMetrics, registerEnterpriseReconcileProviders,
} from "./reconciliationProviders";
import { reconcile } from "../contracts/reconciliation";
import type { ReconcileProvider } from "../contracts/reconciliationCron";
import { enterpriseIdMap, feederMaterials } from "../../../drizzle/schema";
import { resetFakeDb, queueSelect } from "./enterpriseIntegration.testkit";

function mockFetch(body: any): typeof fetch {
  return (async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
});

describe("configurable REST metric source (no vendor shape hardcoded)", () => {
  it("maps by configured itemsPath/keyField/valueField", async () => {
    const src = {
      kind: "rest" as const,
      url: "u",
      itemsPath: "data.rows",
      keyField: "code",
      valueField: "qty",
      fetchImpl: mockFetch({ data: { rows: [{ code: "R100", qty: "150" }, { code: "R200", qty: 40 }] } }),
    };
    expect(await resolveMetrics(src)).toEqual({ R100: 150, R200: 40 });
  });

  it("resolves external ids to canonical codes via the id-map (anti-corruption)", async () => {
    queueSelect(enterpriseIdMap, [{ internalId: "R100" }]);
    queueSelect(enterpriseIdMap, [{ internalId: "R200" }]);
    const src = {
      kind: "rest" as const,
      url: "u",
      keyField: "sku",
      valueField: "onHand",
      keyIsExternalId: true,
      system: "wms" as const,
      entityType: "material",
      fetchImpl: mockFetch({ items: [{ sku: "SKU-1", onHand: 150 }, { sku: "SKU-2", onHand: 40 }] }),
    };
    expect(await resolveMetrics(src)).toEqual({ R100: 150, R200: 40 });
  });
});

describe("generic provider + engine", () => {
  it("compares two independently-fetched sides and raises a ticket on drift", async () => {
    const provider = makeGenericReconcileProvider({
      id: "x",
      description: "d",
      internal: { kind: "fn", fetch: async () => ({ R100: 150 }) },
      external: { kind: "fn", fetch: async () => ({ R100: 160 }) },
      toleranceRel: 0.02,
    });
    const input = await provider.pull();
    const report = reconcile(input);
    expect(report.ok).toBe(false);
    expect(report.tickets).toHaveLength(1);
    expect(report.tickets[0].key).toBe("R100");
  });
});

describe("real WMS inventory provider (external REST vs internal DB)", () => {
  it("pulls both sides, maps external ids, and flags the drifting material", async () => {
    // external SKU ids → canonical codes
    queueSelect(enterpriseIdMap, [{ internalId: "R100" }]);
    queueSelect(enterpriseIdMap, [{ internalId: "R200" }]);
    const provider: ReconcileProvider = makeWmsInventoryReconcileProvider({
      url: "https://wms.test/inv",
      keyField: "sku",
      valueField: "onHand",
      keyIsExternalId: true,
      toleranceRel: 0.02,
      internalSource: { kind: "fn", fetch: async () => ({ R100: 150, R200: 40 }) },
      fetchImpl: mockFetch({ items: [{ sku: "SKU-1", onHand: 150 }, { sku: "SKU-2", onHand: 99 }] }),
    });
    const report = reconcile(await provider.pull());
    expect(report.checked).toBe(2);
    expect(report.tickets).toHaveLength(1); // R200: 40 vs 99
    expect(report.tickets[0].key).toBe("R200");
  });

  it("internalLineInventoryMetrics sums feeder qty by componentCode (real DB path)", async () => {
    queueSelect(feederMaterials, [{ code: "R100", qty: 150 }, { code: "R200", qty: 40 }]);
    expect(await internalLineInventoryMetrics()).toEqual({ R100: 150, R200: 40 });
  });
});

describe("env registration (honest — nothing without config)", () => {
  it("registers nothing without *_RECONCILE_URL", () => {
    const got: ReconcileProvider[] = [];
    expect(registerEnterpriseReconcileProviders((p) => got.push(p), {} as NodeJS.ProcessEnv)).toBe(0);
  });

  it("registers the WMS provider from env; both WMS+MES when configured", () => {
    const a: ReconcileProvider[] = [];
    expect(registerEnterpriseReconcileProviders((p) => a.push(p), { WMS_RECONCILE_URL: "https://wms" } as any)).toBe(1);
    expect(a[0].id).toBe("wms-inventory");

    const b: ReconcileProvider[] = [];
    const n = registerEnterpriseReconcileProviders(
      (p) => b.push(p),
      { WMS_RECONCILE_URL: "https://wms", MES_RECONCILE_URL: "https://mes", MES_RECONCILE_INTERNAL_URL: "https://internal" } as any,
    );
    expect(n).toBe(2);
    expect(b.map((p) => p.id).sort()).toEqual(["mes-production", "wms-inventory"]);
  });
});
