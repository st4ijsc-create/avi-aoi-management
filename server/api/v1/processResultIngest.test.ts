/**
 * doc 56 nhóm C — /api/v1 ingest RESULT + TELEMETRY tests.
 *
 * Covers the two NEW ingest surfaces added alongside inspection:
 *   • POST /api/v1/ingest/process-result — reuses machineApi.submitProcessResult
 *     (mocked), 201 envelope, machine-principal machineCode adoption, 400 on throw.
 *   • POST /api/v1/ingest/telemetry — versioned alias of POST /api/ot/ingest,
 *     funnels into ingestTelemetry (mocked) with normalized CanonicalSample[], 202.
 *   • openapi.json exposes both new paths + their component schemas.
 *
 * Runs against a real Express app on an ephemeral port using global `fetch`
 * (mirrors apiV1.test.ts — supertest is not a dependency here).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

// ── mocks (hoisted so they exist when the module factories run) ──────────────
const h = vi.hoisted(() => ({
  submitProcessResultMock: vi.fn(async (_input: Record<string, unknown>) => ({ success: true, processResultId: 999 })),
  submitInspectionMock: vi.fn(async () => ({ success: true, inspectionId: 123 })),
  ingestTelemetryMock: vi.fn(async (samples: unknown[]) => samples.length),
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

// Ingest reuses the tRPC callers (process-result + inspection).
vi.mock("../../routers", () => ({
  appRouter: {
    createCaller: () => ({
      machineApi: {
        submitProcessResult: h.submitProcessResultMock,
        submitInspection: h.submitInspectionMock,
      },
    }),
  },
}));
vi.mock("../../_core/context", () => ({ createContext: vi.fn(async () => ({})) }));

// Telemetry alias funnels into the unified bus (mocked — no DB touched).
vi.mock("../../services/telemetryBus", () => ({
  ingestTelemetry: h.ingestTelemetryMock,
}));

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

const VALID_PROCESS = {
  schemaVersion: "1.0",
  machineCode: "AOI-01",
  serialNumber: "SN-2002",
  stepType: "press-fit",
  result: "pass",
  ts: "2026-07-17T08:00:00+07:00",
  metrics: [{ name: "force", value: 1220.5, unit: "N" }],
};

describe("/api/v1/ingest/process-result", () => {
  it("no key → 401 envelope", async () => {
    const res = await call("/api/v1/ingest/process-result", { method: "POST", body: JSON.stringify(VALID_PROCESS) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("unauthorized");
  });

  it("reuses submitProcessResult (mocked) → 201", async () => {
    h.submitProcessResultMock.mockClear();
    const res = await call("/api/v1/ingest/process-result", {
      key: "MASTER",
      method: "POST",
      body: JSON.stringify(VALID_PROCESS),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.processResultId).toBe(999);
    expect(h.submitProcessResultMock).toHaveBeenCalledTimes(1);
  });

  it("machine-credential caller adopts its machineCode when the body omits it", async () => {
    h.submitProcessResultMock.mockClear();
    const { machineCode, ...noCode } = VALID_PROCESS;
    const res = await call("/api/v1/ingest/process-result", {
      key: "MACHINE_KEY", // resolves to a machine principal (scope ingest:write, name = AOI-01)
      method: "POST",
      body: JSON.stringify(noCode),
    });
    expect(res.status).toBe(201);
    const arg = h.submitProcessResultMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.machineCode).toBe("AOI-01");
  });

  it("a validation/auth throw from submitProcessResult → 400 ingest_failed", async () => {
    h.submitProcessResultMock.mockRejectedValueOnce(new Error("boom: bad payload"));
    const res = await call("/api/v1/ingest/process-result", {
      key: "MASTER",
      method: "POST",
      body: JSON.stringify(VALID_PROCESS),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("ingest_failed");
    expect(body.error.message).toContain("boom");
  });
});

describe("/api/v1/ingest/telemetry (alias of POST /api/ot/ingest)", () => {
  it("normalizes samples into the unified bus → 202", async () => {
    h.ingestTelemetryMock.mockClear();
    const res = await call("/api/v1/ingest/telemetry", {
      key: "MASTER",
      method: "POST",
      body: JSON.stringify({
        samples: [
          { deviceId: "dev-9", metric: "temperature", value: 42.5, unit: "C", protocol: "modbus", quality: "good" },
          { metric: "pressure", value: 1.2, protocol: "WEIRD" }, // unknown protocol → normalized to "other"
        ],
      }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.received).toBe(2);
    expect(body.data.accepted).toBe(2);
    expect(h.ingestTelemetryMock).toHaveBeenCalledTimes(1);
    const samples = h.ingestTelemetryMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(samples[0].metric).toBe("temperature");
    expect(samples[0].protocol).toBe("modbus");
    expect(samples[0].deviceId).toBe("dev-9");
    expect(samples[1].protocol).toBe("other"); // normalized
    expect(samples[1].quality).toBe("good"); // defaulted
  });

  it("accepts a bare array body too", async () => {
    h.ingestTelemetryMock.mockClear();
    const res = await call("/api/v1/ingest/telemetry", {
      key: "MASTER",
      method: "POST",
      body: JSON.stringify([{ metric: "rpm", value: 3000, protocol: "opcua" }]),
    });
    expect(res.status).toBe(202);
    expect(h.ingestTelemetryMock).toHaveBeenCalledTimes(1);
  });

  it("empty samples → 400 bad_request", async () => {
    const res = await call("/api/v1/ingest/telemetry", {
      key: "MASTER",
      method: "POST",
      body: JSON.stringify({ samples: [] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
  });
});

describe("/api/v1/openapi.json exposes the new ingest paths", () => {
  it("documents process-result + telemetry with their component schemas", async () => {
    const res = await call("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.paths["/api/v1/ingest/process-result"].post).toBeTruthy();
    expect(spec.paths["/api/v1/ingest/telemetry"].post).toBeTruthy();
    expect(spec.components.schemas.ProcessResultIngest).toBeTruthy();
    expect(spec.components.schemas.TelemetryIngest).toBeTruthy();
    expect(spec.components.schemas.TelemetrySample).toBeTruthy();
  });
});
