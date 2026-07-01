/**
 * R0-3 (doc 16 §4 Khối 0) — inbound ERP intake tests.
 *
 * Mounts the registered routes on a real Express app and drives them over fetch
 * (matching apiV1.test.ts). Asserts:
 *   • disabled flag (ERP_INBOUND_ENABLED off) → 503 erp_inbound_disabled;
 *   • missing idempotency key → 400;
 *   • a valid order intake inserts once + returns 201 + emits order.created;
 *   • a DUPLICATE idempotency key REPLAYS the prior result (no second insert).
 *
 * The DB + auth are mocked (master key "MASTER"), so the test is hermetic.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

// ── fake DB state ─────────────────────────────────────────────────────────────
const state = vi.hoisted(() => ({
  productionOrders: [] as any[],
  inboundIdem: [] as any[],
  nextOrderId: 1,
  publishedEvents: [] as Array<{ type: string; payload: any }>,
}));

function makeFakeDb() {
  return {
    select: (_c?: any) => ({
      from: (table: any) => ({
        where: (_p: any) => ({
          limit: async (_n: number) => {
            if (table?.__name === "integration_inbound_idempotency") {
              // Return ALL recorded rows; the handler reads result of [0].
              return state.inboundIdem.length ? [state.inboundIdem[state.inboundIdem.length - 1]] : [];
            }
            if (table?.__name === "production_orders") {
              return _matchedOrders;
            }
            return [];
          },
        }),
      }),
    }),
    insert: (table: any) => ({
      values: (vals: any) => ({
        returning: async (_c?: any) => {
          if (table?.__name === "production_orders") {
            const id = state.nextOrderId++;
            state.productionOrders.push({ id, ...vals });
            return [{ id }];
          }
          return [{ id: 1 }];
        },
        then: (resolve: any) => {
          if (table?.__name === "integration_inbound_idempotency") {
            state.inboundIdem.push(vals);
          }
          return resolve(undefined);
        },
      }),
    }),
    update: (_table: any) => ({ set: (_v: any) => ({ where: async () => undefined }) }),
    delete: (_table: any) => ({ where: async () => undefined }),
  };
}

// What the production_orders existence lookup returns (set per test).
let _matchedOrders: any[] = [];

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));
vi.mock("../../db", () => ({ getDb: vi.fn(async () => makeFakeDb()), getMachineByApiKey: vi.fn(async () => undefined) }));
vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));
vi.mock("../../../drizzle/schema", () => ({
  productionOrders: { __name: "production_orders", id: "id", orderCode: "orderCode" },
  bomDefinitions: { __name: "bom_definitions", id: "id", productModelId: "productModelId", code: "code", version: "version" },
  bomLineItems: { __name: "bom_line_items", bomId: "bomId" },
  integrationInboundIdempotency: { __name: "integration_inbound_idempotency", resource: "resource", idempotencyKey: "idempotencyKey" },
  apiKeys: { __name: "api_keys", keyHash: "keyHash", isActive: "isActive", id: "id" },
}));
vi.mock("drizzle-orm", () => ({ and: (...a: any[]) => a, eq: (...a: any[]) => a }));
vi.mock("../../_core/eventBus", () => ({
  eventBus: { publish: (type: string, payload: any) => state.publishedEvents.push({ type, payload }) },
}));

import { registerErpIntakeRoutes } from "./erpIntake";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const r = express.Router();
  registerErpIntakeRoutes(r);
  app.use("/api/v1", r);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.productionOrders = [];
  state.inboundIdem = [];
  state.nextOrderId = 1;
  state.publishedEvents = [];
  _matchedOrders = [];
  process.env.ERP_INBOUND_ENABLED = "true";
});

const AUTH = { Authorization: "Bearer MASTER", "Content-Type": "application/json" };

function validOrder(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0",
    orderCode: "WO-1001",
    companyCode: "ACME",
    factoryId: 1,
    workshopId: 1,
    lineId: 1,
    productModelId: 1,
    targetQuantity: 500,
    ...over,
  };
}

describe("R0-3 inbound order intake", () => {
  it("returns 503 when ERP_INBOUND_ENABLED is off", async () => {
    process.env.ERP_INBOUND_ENABLED = "false";
    const resp = await fetch(`${baseUrl}/api/v1/orders`, {
      method: "POST",
      headers: { ...AUTH, "X-Idempotency-Key": "k1" },
      body: JSON.stringify(validOrder()),
    });
    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("erp_inbound_disabled");
  });

  it("rejects a missing idempotency key with 400", async () => {
    const resp = await fetch(`${baseUrl}/api/v1/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(validOrder()),
    });
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error.code).toBe("idempotency_required");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const resp = await fetch(`${baseUrl}/api/v1/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Idempotency-Key": "k1" },
      body: JSON.stringify(validOrder()),
    });
    expect(resp.status).toBe(401);
  });

  it("creates a new order (201) and emits order.created", async () => {
    const resp = await fetch(`${baseUrl}/api/v1/orders`, {
      method: "POST",
      headers: { ...AUTH, "X-Idempotency-Key": "key-new" },
      body: JSON.stringify(validOrder()),
    });
    expect(resp.status).toBe(201);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.data.created).toBe(true);
    expect(body.data.orderCode).toBe("WO-1001");
    expect(state.productionOrders.length).toBe(1);
    expect(state.publishedEvents.some((e) => e.type === "order.created")).toBe(true);
  });

  it("replays the prior result on a duplicate idempotency key (no double insert)", async () => {
    // First call records the result.
    await fetch(`${baseUrl}/api/v1/orders`, {
      method: "POST",
      headers: { ...AUTH, "X-Idempotency-Key": "dup-key" },
      body: JSON.stringify(validOrder()),
    });
    expect(state.productionOrders.length).toBe(1);
    const ordersAfterFirst = state.productionOrders.length;
    const eventsAfterFirst = state.publishedEvents.length;

    // Second call with the SAME key → replay, no new insert, no new event.
    const resp2 = await fetch(`${baseUrl}/api/v1/orders`, {
      method: "POST",
      headers: { ...AUTH, "X-Idempotency-Key": "dup-key" },
      body: JSON.stringify(validOrder()),
    });
    expect(resp2.status).toBe(200);
    const body2 = await resp2.json();
    expect(body2.data.replayed).toBe(true);
    expect(state.productionOrders.length).toBe(ordersAfterFirst); // no double insert
    expect(state.publishedEvents.length).toBe(eventsAfterFirst); // no duplicate event
  });

  it("rejects an invalid payload with 400 validation_failed", async () => {
    const resp = await fetch(`${baseUrl}/api/v1/orders`, {
      method: "POST",
      headers: { ...AUTH, "X-Idempotency-Key": "bad-1" },
      body: JSON.stringify({ schemaVersion: "1.0", orderCode: "X" }), // missing required fields
    });
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error.code).toBe("validation_failed");
  });
});

// ── K0+-b: inbound B2MML XML path maps to the SAME upsert ──────────────────────
describe("K0+-b inbound B2MML XML order intake", () => {
  it("decodes a B2MML ProductionSchedule and upserts via the same path (201)", async () => {
    process.env.ERP_B2MML_ENABLED = "true";
    const { encodeOrderB2MML } = await import("../../services/integration/b2mmlCodec");
    const xml = encodeOrderB2MML({
      schemaVersion: "1.0",
      orderCode: "WO-XML-1",
      companyCode: "ACME",
      factoryId: 1,
      workshopId: 1,
      lineId: 1,
      productModelId: 1,
      targetQuantity: 250,
    });
    const resp = await fetch(`${baseUrl}/api/v1/orders`, {
      method: "POST",
      headers: { Authorization: "Bearer MASTER", "Content-Type": "application/xml", "X-Idempotency-Key": "xml-1" },
      body: xml,
    });
    expect(resp.status).toBe(201);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.data.orderCode).toBe("WO-XML-1");
    // The SAME upsert path ran: a production_orders row was inserted.
    expect(state.productionOrders.length).toBe(1);
    delete process.env.ERP_B2MML_ENABLED;
  });

  it("refuses XML with 415 b2mml_disabled when ERP_B2MML_ENABLED is off", async () => {
    delete process.env.ERP_B2MML_ENABLED;
    const { encodeOrderB2MML } = await import("../../services/integration/b2mmlCodec");
    const xml = encodeOrderB2MML({
      schemaVersion: "1.0",
      orderCode: "WO-XML-2",
      companyCode: "ACME",
      factoryId: 1,
      workshopId: 1,
      lineId: 1,
      productModelId: 1,
      targetQuantity: 10,
    });
    const resp = await fetch(`${baseUrl}/api/v1/orders`, {
      method: "POST",
      headers: { Authorization: "Bearer MASTER", "Content-Type": "application/xml", "X-Idempotency-Key": "xml-2" },
      body: xml,
    });
    expect(resp.status).toBe(415);
    const body = await resp.json();
    expect(body.error.code).toBe("b2mml_disabled");
  });
});
