/**
 * Phase E1 — Unified Machine API (/api/v1) tests.
 *
 * Covers: scoped API-key auth (no key → 401, wrong scope → 403, master key → ok),
 * the `{ ok, data?, error? }` envelope, command POST routing through the dispatcher
 * in dry-run (mocked), ingest reusing submitInspection (mocked), orchestration stubs
 * returning 501, and openapi.json validity + documented paths.
 *
 * Runs against a real Express app on an ephemeral port using global `fetch`
 * (supertest is not a dependency here).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

// ── mocks (hoisted so they exist when the module factories run) ──────────────
const h = vi.hoisted(() => ({
  sendCommandMock: vi.fn(async () => ({
    ok: true,
    status: "simulated" as const,
    routedTo: "ot-dispatcher" as const,
    detail: { simulated: true, commandLogIds: [1] },
  })),
  submitInspectionMock: vi.fn(async () => ({ success: true, inspectionId: 123 })),
}));

// Master key validation: accept only "MASTER" in tests.
vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));

// DB layer the router/auth depend on.
const MACHINE = {
  id: 1,
  code: "AOI-01",
  name: "AOI One",
  machineType: "AOI",
  operationStatus: "running",
  capabilities: null,
  stationId: 5,
  apiKey: "MACHINE_KEY",
};
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null), // no api_keys table in test → only master/machine paths
  getMachineById: vi.fn(async (id: number) => (id === 1 ? MACHINE : undefined)),
  getMachines: vi.fn(async () => [MACHINE]),
  getMachineByApiKey: vi.fn(async (k: string) => (k === "MACHINE_KEY" ? MACHINE : undefined)),
}));

// Telemetry read.
vi.mock("../../db/otTelemetry", () => ({
  getLatestTelemetry: vi.fn(async () => [
    { id: 1, machineId: 1, tagKey: "yield", valueNumeric: 98.5, valueText: null, quality: "good", timestamp: "2026-06-28T00:00:00.000Z", unit: "%" },
  ]),
}));

// Equipment adapter facade → sendCommand routes to the HITL dispatcher (mocked).
vi.mock("../../services/equipment/equipmentAdapter", async () => {
  const actual = await vi.importActual<typeof import("../../services/equipment/equipmentAdapter")>(
    "../../services/equipment/equipmentAdapter",
  );
  return {
    ...actual,
    equipmentRegistry: {
      ...actual.equipmentRegistry,
      getAdapter: () => ({ kind: "vision", delegatesTo: "vision", sendCommand: h.sendCommandMock }),
    },
  };
});

// Inspection ingest reuses the tRPC submitInspection caller.
vi.mock("../../routers", () => ({
  appRouter: { createCaller: () => ({ machineApi: { submitInspection: h.submitInspectionMock } }) },
}));
vi.mock("../../_core/context", () => ({ createContext: vi.fn(async () => ({})) }));

import { createV1Router } from "./router";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use("/api/v1", createV1Router());
  await new Promise<void>((resolve) => {
    server = createServer(app).listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(path: string, init?: RequestInit & { key?: string }) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init?.key) headers["authorization"] = `Bearer ${init.key}`;
  return fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) } });
}

describe("/api/v1 auth", () => {
  it("no key → 401 with error envelope", async () => {
    const res = await call("/api/v1/equipment");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("unauthorized");
  });

  it("master key → 200 + ok envelope", async () => {
    const res = await call("/api/v1/equipment", { key: "MASTER" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.equipment)).toBe(true);
    expect(body.data.equipment[0].machineId).toBe(1);
  });

  it("machine key (ingest:write only) → 403 on equipment:read", async () => {
    const res = await call("/api/v1/equipment", { key: "MACHINE_KEY" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("forbidden");
  });
});

describe("/api/v1 reads", () => {
  it("capabilities resolves the AOI profile", async () => {
    const res = await call("/api/v1/equipment/1/capabilities", { key: "MASTER" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.capability.adapterKind).toBe("vision");
    expect(body.data.capability.supportedCommands.length).toBeGreaterThan(0);
  });

  it("telemetry returns latest samples", async () => {
    const res = await call("/api/v1/equipment/1/telemetry?from=x&to=y", { key: "MASTER" });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.samples[0].tagKey).toBe("yield");
  });

  it("state projects PackML", async () => {
    const res = await call("/api/v1/equipment/1/state", { key: "MASTER" });
    const body = await res.json();
    expect(body.data.packmlState).toBe("Execute");
  });

  it("unknown machine → 404 envelope", async () => {
    const res = await call("/api/v1/equipment/999/capabilities", { key: "MASTER" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });
});

describe("/api/v1 commands → HITL dispatcher (dry-run)", () => {
  it("routes a supported command through sendCommand (simulated)", async () => {
    h.sendCommandMock.mockClear();
    const res = await call("/api/v1/equipment/1/commands", {
      key: "MASTER",
      method: "POST",
      body: JSON.stringify({ command: "start", idempotencyKey: "k1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("simulated");
    expect(h.sendCommandMock).toHaveBeenCalledTimes(1);
    // HITL provenance present; no direct device write.
    const arg = h.sendCommandMock.mock.calls[0][0] as any;
    expect(arg.hitl.actionId).toContain("apiv1-");
  });

  it("unsupported command → 400", async () => {
    const res = await call("/api/v1/equipment/1/commands", {
      key: "MASTER",
      method: "POST",
      body: JSON.stringify({ command: "frobnicate" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unsupported_command");
  });
});

describe("/api/v1 ingest", () => {
  it("reuses submitInspection (mocked) → 201", async () => {
    h.submitInspectionMock.mockClear();
    const res = await call("/api/v1/ingest/inspection", {
      key: "MASTER",
      method: "POST",
      body: JSON.stringify({ machineCode: "AOI-01", serialNumber: "SN1", overallResult: "OK", measurements: [] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.inspectionId).toBe(123);
    expect(h.submitInspectionMock).toHaveBeenCalledTimes(1);
  });
});

describe("/api/v1 orchestration stubs", () => {
  it("POST workflows → 501", async () => {
    const res = await call("/api/v1/orchestration/workflows", { key: "MASTER", method: "POST", body: "{}" });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error.code).toBe("not_implemented");
  });
  it("GET runs/:id → 501", async () => {
    const res = await call("/api/v1/orchestration/runs/abc", { key: "MASTER" });
    expect(res.status).toBe(501);
  });
});

describe("/api/v1/openapi.json", () => {
  it("is valid JSON with the documented paths + auth scheme", async () => {
    const res = await call("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.paths["/api/v1/equipment"]).toBeTruthy();
    expect(spec.paths["/api/v1/equipment/{id}/commands"].post).toBeTruthy();
    expect(spec.paths["/api/v1/ingest/inspection"].post).toBeTruthy();
    expect(spec.paths["/api/v1/orchestration/runs/{id}"].get).toBeTruthy();
    expect(spec.components.securitySchemes.bearerAuth).toBeTruthy();
    expect(spec.components.securitySchemes.apiKeyHeader).toBeTruthy();
  });
});
