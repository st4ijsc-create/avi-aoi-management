/**
 * W2-B1 (doc 44 G2.16 + G2.18) — genealogy API tests: FULL GenealogyRecord
 * assembly (spec §10.3) from mocked chain/inspection/process/installation
 * rows (time-ordered steps, materials with supplier-lot codes, carton/pallet
 * from chain payloads, product/line fallbacks), honest 404 when every source
 * is empty, and reverse search (union + intersection semantics, payload
 * carton criterion, missing-criterion 400). Mirrors the assets.test.ts app
 * bootstrap.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

// ── mocks (hoisted) ──────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  rows: {
    genealogyChain: [] as unknown[],
    productInspections: [] as unknown[],
    processResults: [] as unknown[],
    componentInstallations: [] as unknown[],
    productModels: [] as unknown[],
  },
}));

vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  getMachineByApiKey: vi.fn(async (k: string) => (k === "MACHINE_KEY" ? { id: 1, code: "AOI-01" } : undefined)),
}));

function chain(rows: unknown[]) {
  const p: any = Promise.resolve(rows);
  p.from = () => p;
  p.leftJoin = () => p;
  p.innerJoin = () => p;
  p.where = () => p;
  p.orderBy = () => p;
  p.groupBy = () => p;
  p.limit = () => p;
  return p;
}

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: (table: any) => {
        const key = (table && table.__mockName) || "";
        const rows = (h.rows as Record<string, unknown[]>)[key] ?? [];
        return chain(rows);
      },
    }),
    execute: vi.fn(async () => []),
  })),
}));

vi.mock("../../../drizzle/schema", () => ({
  genealogyChain: { __mockName: "genealogyChain", id: "id", serialNumber: "serialNumber", lotCode: "lotCode", recordedAt: "recordedAt", payload: "payload" },
  productInspections: { __mockName: "productInspections", id: "id", serialNumber: "serialNumber", machineId: "machineId", inspectionTime: "inspectionTime" },
  processResults: { __mockName: "processResults", id: "id", serialNumber: "serialNumber", machineId: "machineId", measuredAt: "measuredAt" },
  componentInstallations: { __mockName: "componentInstallations", serialNumber: "serialNumber", componentCode: "componentCode", supplierLotId: "supplierLotId", installedAt: "installedAt" },
  supplierLots: { __mockName: "supplierLots", id: "id", supplierLotNumber: "supplierLotNumber" },
  machines: { __mockName: "machines", id: "id", code: "code" },
  productModels: { __mockName: "productModels", id: "id", code: "code" },
  machineTypeEnum: { enumValues: ["AVI", "AOI", "ROBOT"] },
  MACHINE_LIFECYCLE_STATUSES: ["registered", "commissioning", "active", "faulted", "maintenance", "decommissioned", "retired"],
}));

vi.mock("drizzle-orm", () => {
  const sqlTag: any = (strings: TemplateStringsArray, ...vals: unknown[]) => ({ strings, vals });
  sqlTag.raw = (s: unknown) => s;
  sqlTag.join = (arr: unknown[], sep: unknown) => ({ arr, sep });
  return {
    and: (...a: unknown[]) => a,
    or: (...a: unknown[]) => a,
    eq: (...a: unknown[]) => a,
    ne: (...a: unknown[]) => a,
    asc: (x: unknown) => x,
    desc: (x: unknown) => x,
    inArray: (...a: unknown[]) => a,
    gte: (...a: unknown[]) => a,
    lte: (...a: unknown[]) => a,
    sql: sqlTag,
  };
});

import { createV1Router } from "./router";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use("/api/v1", createV1Router());
  await new Promise<void>((resolve) => {
    server = createServer(app).listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.rows.genealogyChain = [];
  h.rows.productInspections = [];
  h.rows.processResults = [];
  h.rows.componentInstallations = [];
  h.rows.productModels = [];
});

function call(path: string, key?: string, init?: RequestInit) {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init?.headers as never) };
  if (key) headers["authorization"] = `Bearer ${key}`;
  return fetch(`${base}${path}`, { ...init, headers });
}

// ── GET /genealogy/{unitId} — record assembly ────────────────────────────────
describe("G2.18 — GenealogyRecord assembly", () => {
  beforeEach(() => {
    h.rows.genealogyChain = [
      { id: 1, eventType: "born", serialNumber: "SN-1", parentSerial: null, stationCode: null, lotCode: "L1", productModelId: 10, payload: {}, recordedAt: "2026-07-10T00:00:00.000Z" },
      { id: 2, eventType: "merge", serialNumber: "SN-1", parentSerial: "COMP-9", stationCode: "ST-2", lotCode: null, productModelId: null, payload: { result: "PASS" }, recordedAt: "2026-07-10T01:00:00.000Z" },
      { id: 3, eventType: "ship", serialNumber: "SN-1", parentSerial: null, stationCode: null, lotCode: null, productModelId: null, payload: { carton: "CTN-8842", pallet: "PLT-334" }, recordedAt: "2026-07-10T05:00:00.000Z" },
    ];
    h.rows.productInspections = [
      { id: 100, machineId: 1, machineCode: "AOI-01", stageCode: "AOI", lineCode: "LINE1", productModel: "MODEL-X", overallResult: "OK", inspectionTime: "2026-07-10T02:00:00.000Z", cycleTime: "12.5", productionOrderCode: "PO-1" },
    ];
    h.rows.processResults = [
      { id: 200, machineId: 2, machineCode: "SCREW-01", stepType: "screw", lineCode: null, result: "pass", metrics: { torque_nm: 1.81 }, measuredAt: "2026-07-10T03:00:00.000Z", recipeRef: null },
    ];
    h.rows.componentInstallations = [
      { componentCode: "shield-A", componentSerial: null, qty: "1", refDesignator: "R1", installedAt: "2026-07-10T01:30:00.000Z", supplierLotNumber: "L2291" },
    ];
  });

  it("assembles the FULL spec §10.3 record: steps time-ordered across ALL sources", async () => {
    const res = await call("/api/v1/genealogy/SN-1", "MASTER");
    expect(res.status).toBe(200);
    const rec = (await res.json()).data;

    expect(rec.unit_id).toBe("SN-1");
    expect(rec.product).toBe("MODEL-X"); // from the inspection row
    expect(rec.line).toBe("LINE1");
    expect(rec.carton).toBe("CTN-8842"); // from the 'ship' chain payload
    expect(rec.pallet).toBe("PLT-334");
    expect(rec.started).toBe("2026-07-10T00:00:00.000Z");
    expect(rec.finished).toBe("2026-07-10T05:00:00.000Z");

    // 3 chain + 1 inspection + 1 process, merged and time-ordered.
    expect(rec.steps.map((s: any) => [s.source, s.ts])).toEqual([
      ["genealogy_chain", "2026-07-10T00:00:00.000Z"],
      ["genealogy_chain", "2026-07-10T01:00:00.000Z"],
      ["product_inspections", "2026-07-10T02:00:00.000Z"],
      ["process_results", "2026-07-10T03:00:00.000Z"],
      ["genealogy_chain", "2026-07-10T05:00:00.000Z"],
    ]);
    const merge = rec.steps[1];
    expect(merge.station).toBe("ST-2");
    expect(merge.result).toBe("PASS");
    expect(merge.data.parentSerial).toBe("COMP-9");
    const insp = rec.steps[2];
    expect(insp.station).toBe("AOI-01");
    expect(insp.result).toBe("OK");
    const proc = rec.steps[3];
    expect(proc.station).toBe("SCREW-01");
    expect(proc.data.metrics.torque_nm).toBe(1.81);

    // materials [{part, lot}] via supplier_lots join
    expect(rec.materials).toEqual([{ part: "shield-A", lot: "L2291", qty: 1, ref: "R1" }]);
    expect(rec.sources).toEqual({ chain_events: 3, inspections: 1, process_results: 1, installations: 1 });
  });

  it("product falls back to the chain's productModelId → product_models.code", async () => {
    h.rows.productInspections = []; // no inspection carrying productModel
    h.rows.productModels = [{ code: "MODEL-FROM-PM" }];
    const rec = (await (await call("/api/v1/genealogy/SN-1", "MASTER")).json()).data;
    expect(rec.product).toBe("MODEL-FROM-PM");
  });

  it("carton/pallet are HONESTLY null when never recorded", async () => {
    h.rows.genealogyChain = [
      { id: 1, eventType: "born", serialNumber: "SN-1", parentSerial: null, stationCode: null, lotCode: null, productModelId: null, payload: {}, recordedAt: "2026-07-10T00:00:00.000Z" },
    ];
    const rec = (await (await call("/api/v1/genealogy/SN-1", "MASTER")).json()).data;
    expect(rec.carton).toBeNull();
    expect(rec.pallet).toBeNull();
  });

  it("unit with NO data in ANY source → 404", async () => {
    h.rows.genealogyChain = [];
    h.rows.productInspections = [];
    h.rows.processResults = [];
    h.rows.componentInstallations = [];
    const res = await call("/api/v1/genealogy/GHOST-1", "MASTER");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});

// ── POST /genealogy/search — reverse lookup ──────────────────────────────────
describe("G2.18 — reverse search", () => {
  it("lot criterion unions chain lotCode hits with supplier-lot installations", async () => {
    h.rows.genealogyChain = [{ serialNumber: "SN-1" }, { serialNumber: "SN-2" }, { serialNumber: "SN-1" }];
    h.rows.componentInstallations = [{ serialNumber: "SN-3" }];
    const res = await call("/api/v1/genealogy/search", "MASTER", {
      method: "POST",
      body: JSON.stringify({ lot: "L2291" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.units).toEqual(["SN-1", "SN-2", "SN-3"]); // deduped + sorted
    expect(body.data.criteria).toEqual(["lot"]);
    expect(body.data.semantics).toBe("intersection");
  });

  it("multiple criteria INTERSECT (AND)", async () => {
    h.rows.genealogyChain = [{ serialNumber: "SN-1" }, { serialNumber: "SN-3" }];
    h.rows.componentInstallations = [{ serialNumber: "SN-3" }];
    const body = await (
      await call("/api/v1/genealogy/search", "MASTER", {
        method: "POST",
        body: JSON.stringify({ lot: "L2291", part: "shield-A" }),
      })
    ).json();
    // lot → {SN-1, SN-3 (chain)} ∪ {SN-3 (installations)}; part → {SN-3} ⇒ ∩ = {SN-3}
    expect(body.data.units).toEqual(["SN-3"]);
    expect(body.data.criteria).toEqual(["lot", "part"]);
  });

  it("carton criterion matches genealogy_chain payload keys", async () => {
    h.rows.genealogyChain = [{ serialNumber: "SN-9" }];
    const body = await (
      await call("/api/v1/genealogy/search", "MASTER", {
        method: "POST",
        body: JSON.stringify({ carton: "CTN-8842" }),
      })
    ).json();
    expect(body.data.units).toEqual(["SN-9"]);
    expect(body.data.criteria).toEqual(["carton"]);
  });

  it("no criterion → 400; invalid dateRange → 400", async () => {
    let res = await call("/api/v1/genealogy/search", "MASTER", { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
    res = await call("/api/v1/genealogy/search", "MASTER", {
      method: "POST",
      body: JSON.stringify({ lot: "L1", dateRange: { from: "not-a-date" } }),
    });
    expect(res.status).toBe(400);
  });
});
