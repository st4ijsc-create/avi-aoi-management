/**
 * W3-A3 (doc 44 G3.6/G3.7) — /api/v1 order-lifecycle REST surface tests.
 *
 * Mounts the registered routes on a real Express app and drives them over
 * fetch (matching erpIntake.test.ts / apiV1.test.ts). The SERVICE is mocked —
 * this file asserts the HTTP contract: envelope shape, scope auth, flag-off
 * 503, id validation 400, not-found 404, typed-error mapping (409/403), and
 * that domain outcomes (allocation rejected) surface as 200 + data.state.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

// ── service mock (controllable per test) ──────────────────────────────────────
const svc = vi.hoisted(() => ({
  enabled: true,
  listOrders: vi.fn(),
  getOrderDetail: vi.fn(),
  traceOrder: vi.fn(),
  allocateOrder: vi.fn(),
  holdOrder: vi.fn(),
  resumeOrder: vi.fn(),
  cancelOrder: vi.fn(),
}));

// vi.mock factories are hoisted above module bodies — the class must be
// hoisted too (a plain `class` declaration would hit the TDZ).
const MockLifecycleError = vi.hoisted(
  () =>
    class MockLifecycleError extends Error {
      code: string;
      httpStatus: number;
      constructor(code: string, message: string, httpStatus = 400) {
        super(message);
        this.name = "OrderLifecycleError";
        this.code = code;
        this.httpStatus = httpStatus;
      }
    },
);

vi.mock("../../services/orders/orderLifecycleService", () => ({
  orderLifecycleEnabled: () => svc.enabled,
  OrderLifecycleError: MockLifecycleError,
  listOrders: (...a: unknown[]) => svc.listOrders(...a),
  getOrderDetail: (...a: unknown[]) => svc.getOrderDetail(...a),
  traceOrder: (...a: unknown[]) => svc.traceOrder(...a),
  allocateOrder: (...a: unknown[]) => svc.allocateOrder(...a),
  holdOrder: (...a: unknown[]) => svc.holdOrder(...a),
  resumeOrder: (...a: unknown[]) => svc.resumeOrder(...a),
  cancelOrder: (...a: unknown[]) => svc.cancelOrder(...a),
}));

// ── auth mocks (master key "MASTER", mirrors erpIntake.test.ts) ───────────────
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  getMachineByApiKey: vi.fn(async () => undefined),
}));
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));

import { registerOrdersLifecycleRoutes } from "./ordersLifecycle";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const r = express.Router();
  registerOrdersLifecycleRoutes(r);
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
  svc.enabled = true;
  svc.listOrders.mockReset().mockResolvedValue({ orders: [], count: 0 });
  svc.getOrderDetail.mockReset().mockResolvedValue(null);
  svc.traceOrder.mockReset().mockResolvedValue(null);
  svc.allocateOrder.mockReset();
  svc.holdOrder.mockReset();
  svc.resumeOrder.mockReset();
  svc.cancelOrder.mockReset();
});

const AUTH = { Authorization: "Bearer MASTER", "Content-Type": "application/json" };

describe("flag + auth gates", () => {
  it("returns 503 order_lifecycle_disabled when the flag is off (GET and POST)", async () => {
    svc.enabled = false;
    const g = await fetch(`${baseUrl}/api/v1/orders`, { headers: AUTH });
    expect(g.status).toBe(503);
    expect((await g.json()).error.code).toBe("order_lifecycle_disabled");

    const p = await fetch(`${baseUrl}/api/v1/orders/1/hold`, { method: "POST", headers: AUTH, body: "{}" });
    expect(p.status).toBe(503);
    expect((await p.json()).error.code).toBe("order_lifecycle_disabled");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const resp = await fetch(`${baseUrl}/api/v1/orders`);
    expect(resp.status).toBe(401);
  });
});

describe("GET /orders + /orders/:id + /orders/:id/trace", () => {
  it("lists orders in the envelope shape and forwards validated query filters", async () => {
    svc.listOrders.mockResolvedValue({
      orders: [{ id: 1, orderCode: "WO-1", lifecycle: "running", status: "in_progress" }],
      count: 1,
    });
    const resp = await fetch(`${baseUrl}/api/v1/orders?lifecycle=running&limit=10&lineId=3`, { headers: AUTH });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.data.count).toBe(1);
    expect(body.data.orders[0].lifecycle).toBe("running");
    expect(svc.listOrders).toHaveBeenCalledWith({ lifecycle: "running", limit: 10, lineId: 3 });
  });

  it("400s an invalid lifecycle filter", async () => {
    const resp = await fetch(`${baseUrl}/api/v1/orders?lifecycle=warp`, { headers: AUTH });
    expect(resp.status).toBe(400);
    expect((await resp.json()).error.code).toBe("bad_request");
  });

  it("400s a non-numeric order id", async () => {
    const resp = await fetch(`${baseUrl}/api/v1/orders/abc`, { headers: AUTH });
    expect(resp.status).toBe(400);
  });

  it("404s an unknown order (detail + trace)", async () => {
    const d = await fetch(`${baseUrl}/api/v1/orders/7`, { headers: AUTH });
    expect(d.status).toBe(404);
    const t = await fetch(`${baseUrl}/api/v1/orders/7/trace`, { headers: AUTH });
    expect(t.status).toBe(404);
  });

  it("returns detail with transitions", async () => {
    svc.getOrderDetail.mockResolvedValue({
      order: { id: 7, orderCode: "WO-7", lifecycle: "held" },
      transitions: [{ id: 1, fromState: "running", toState: "held" }],
    });
    const resp = await fetch(`${baseUrl}/api/v1/orders/7`, { headers: AUTH });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.order.lifecycle).toBe("held");
    expect(body.data.transitions.length).toBe(1);
  });

  it("returns the honest-empty trace", async () => {
    svc.traceOrder.mockResolvedValue({
      order: { id: 7, orderCode: "WO-7", lifecycle: "created" },
      transitions: [],
      genealogy: { serials: [], serialCount: 0, source: "product_inspections.productionOrderCode", perUnitEndpoint: "/api/v1/genealogy/{unitId}", note: "No genealogy references recorded for this order yet (honest-empty)." },
    });
    const resp = await fetch(`${baseUrl}/api/v1/orders/7/trace`, { headers: AUTH });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.genealogy.serials).toEqual([]);
    expect(body.data.genealogy.note).toContain("honest-empty");
  });
});

describe("POST lifecycle commands", () => {
  it("allocate: forwards lineId + actor and returns the result", async () => {
    svc.allocateOrder.mockResolvedValue({ orderId: 5, allocated: true, state: "allocated", lineId: 2, strategy: "requested", transitionId: 1 });
    const resp = await fetch(`${baseUrl}/api/v1/orders/5/allocate`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ lineId: 2 }),
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.state).toBe("allocated");
    expect(svc.allocateOrder).toHaveBeenCalledWith(5, expect.objectContaining({ lineId: 2, actor: expect.stringContaining("api-key") }));
  });

  it("allocate: a capacity REJECTED outcome is 200 with data.state=rejected (domain result)", async () => {
    svc.allocateOrder.mockResolvedValue({ orderId: 5, allocated: false, state: "rejected", reason: "no_capacity", capacity: { max: 1, occupied: 1 }, transitionId: 2 });
    const resp = await fetch(`${baseUrl}/api/v1/orders/5/allocate`, { method: "POST", headers: AUTH, body: "{}" });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.data.state).toBe("rejected");
    expect(body.data.reason).toBe("no_capacity");
  });

  it("allocate: 400s an invalid body (negative lineId)", async () => {
    const resp = await fetch(`${baseUrl}/api/v1/orders/5/allocate`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ lineId: -1 }),
    });
    expect(resp.status).toBe(400);
    expect(svc.allocateOrder).not.toHaveBeenCalled();
  });

  it("maps typed service errors: invalid_transition → 409, policy_denied → 403, not_found → 404", async () => {
    svc.holdOrder.mockRejectedValue(new MockLifecycleError("invalid_transition", "created → held not allowed", 409));
    const h = await fetch(`${baseUrl}/api/v1/orders/5/hold`, { method: "POST", headers: AUTH, body: "{}" });
    expect(h.status).toBe(409);
    expect((await h.json()).error.code).toBe("invalid_transition");

    svc.resumeOrder.mockRejectedValue(new MockLifecycleError("policy_denied", "denied", 403));
    const r = await fetch(`${baseUrl}/api/v1/orders/5/resume`, { method: "POST", headers: AUTH, body: "{}" });
    expect(r.status).toBe(403);

    svc.cancelOrder.mockRejectedValue(new MockLifecycleError("not_found", "gone", 404));
    const c = await fetch(`${baseUrl}/api/v1/orders/5/cancel`, { method: "POST", headers: AUTH, body: "{}" });
    expect(c.status).toBe(404);
  });

  it("hold/resume/cancel: forwards reason + actor and returns the transition result", async () => {
    svc.holdOrder.mockResolvedValue({ orderId: 5, from: "running", to: "held", legacyStatus: "paused", transitionId: 3 });
    const h = await fetch(`${baseUrl}/api/v1/orders/5/hold`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ reason: "shortage" }),
    });
    expect(h.status).toBe(200);
    expect((await h.json()).data.to).toBe("held");
    expect(svc.holdOrder).toHaveBeenCalledWith(5, expect.objectContaining({ reason: "shortage" }));

    svc.cancelOrder.mockResolvedValue({ orderId: 5, state: "failed", via: "compensation" });
    const c = await fetch(`${baseUrl}/api/v1/orders/5/cancel`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ reason: "fault" }),
    });
    expect(c.status).toBe(200);
    const cBody = await c.json();
    expect(cBody.data.state).toBe("failed");
    expect(cBody.data.via).toBe("compensation");
    expect(svc.cancelOrder).toHaveBeenCalledWith(5, "fault", expect.objectContaining({ actor: expect.any(String) }));
  });
});
