/**
 * W0-F (doc 44) — tests for the new /api/v1 PdM health + model-registry surface.
 *
 * Covers: scope gating (no key → 401), response envelope + shape for
 * GET /health/assets/:id (incl. 404 + honest health:null), GET /predictions
 * (filters + honest empty), GET /models (catalogue + versions/stage),
 * POST /models/:id/promote + /rollback (501 with the flag OFF — the default —
 * and the wrapped internal path with the flag ON), GET /monitoring/drift, and
 * that openapi.json documents the new paths. Mirrors moduleReads.test.ts:
 * a real Express app on an ephemeral port, global fetch, hermetic mocks.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

// ── hoisted fixtures ─────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  machines: [{ id: 1, code: "AOI-01", name: "AOI machine 1" }],
  healthRows: [{ healthScore: 87, timestamp: new Date("2026-07-01T00:00:00Z"), calculationMethod: "WEIGHTED" }],
  predictionRows: [
    { id: 11, type: "MACHINE_FAILURE", severity: "HIGH", assetId: 1, status: "ACTIVE", createdAt: new Date() },
  ],
  aiModelRows: [
    { id: 3, code: "aoi-defect-v1", name: "Defect classifier", modelType: "classification", format: "ONNX", currentVersion: "1.2.0", status: "ACTIVE", productModelId: null, updatedAt: new Date() },
  ],
  modelVersionRows: [
    { id: 31, modelId: 3, version: "1.2.0", status: "ACTIVE", accuracy: "97.10", createdAt: new Date() },
    { id: 30, modelId: 3, version: "1.1.0", status: "INACTIVE", accuracy: "96.00", createdAt: new Date(Date.now() - 86400_000) },
  ],
  driftAlertRows: [
    { id: 7, modelId: 3, alertType: "CONFIDENCE_SHIFT", severity: "HIGH", message: "PSI 0.31", createdAt: new Date() },
  ],
  computeFailureRisk: vi.fn(async (machineId: number) => ({
    machineId,
    failureRisk: 62,
    confidenceScore: 71,
    predictedTimeframe: "within 4 days",
    predictedTimeframeHours: 96,
    recommendedMaintenanceDate: new Date("2026-07-16T00:00:00Z"),
    maintenanceUrgency: "HIGH",
    factors: [{ name: "trend", contribution: 55, description: "declining" }],
    dataPoints: 42,
  })),
  // doc69 W0-2 follow-up: /promote now routes through the GATED wrapper, not the
  // raw activateModelVersion.
  activateModelVersionManual: vi.fn(async (_modelId: number, versionId: number, _opts?: unknown) => ({ id: versionId, version: "1.1.0" })),
  manualRollback: vi.fn(async (modelId: number, toVersionId: number) => ({
    rolledBack: true,
    modelId,
    reason: "test",
    fromVersionId: 31,
    toVersionId,
    eventId: 99,
  })),
  pickRollbackTarget: vi.fn((versions: Array<{ id: number }>) => versions.find((v) => v.id === 30) ?? null),
  getDriftMetrics: vi.fn(() => ({ enabled: false, counters: { "3:HIGH": 2 } })),
  isDriftMonitorEnabled: vi.fn(() => false),
}));

vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));

// Auth DB path — no api_keys table, no machine keys.
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  getMachineByApiKey: vi.fn(async () => undefined),
}));

// Chainable fake drizzle db: resolves rows per table; `where` on machines filters
// by the eq() tuple so the 404 path is real.
function makeDb() {
  function chain(rows: unknown[]) {
    const p: any = Promise.resolve(rows);
    p.from = () => p;
    p.where = () => p;
    p.orderBy = () => p;
    p.limit = () => p;
    return p;
  }
  return {
    select: () => ({
      from: (table: any) => {
        const key = table?.__mockName ?? "";
        if (key === "machines") {
          return {
            where: (cond: any) => {
              // drizzle-orm eq() is mocked to (...a) => a → cond = [col, value]
              const id = Array.isArray(cond) ? cond[1] : undefined;
              return chain(h.machines.filter((m) => m.id === id));
            },
          };
        }
        const rowsByTable: Record<string, unknown[]> = {
          machineHealthHistory: h.healthRows,
          predictiveAlerts: h.predictionRows,
          aiModels: h.aiModelRows,
          modelVersions: h.modelVersionRows,
          modelDriftAlerts: h.driftAlertRows,
        };
        return chain(rowsByTable[key] ?? []);
      },
    }),
  };
}
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeDb()) }));

vi.mock("../../../drizzle/schema", () => ({
  machines: { __mockName: "machines", id: "id", code: "code", name: "name" },
  machineHealthHistory: { __mockName: "machineHealthHistory", machineId: "machineId", timestamp: "timestamp", healthScore: "healthScore", calculationMethod: "calculationMethod" },
  predictiveAlerts: {
    __mockName: "predictiveAlerts",
    id: "id", alertType: "alertType", severity: "severity", title: "title", description: "description",
    machineId: "machineId", machineCode: "machineCode", predictedValue: "predictedValue",
    currentValue: "currentValue", threshold: "threshold", confidenceScore: "confidenceScore",
    predictedTimeframe: "predictedTimeframe", status: "status", createdAt: "createdAt",
  },
  aiModels: {
    __mockName: "aiModels",
    id: "id", code: "code", name: "name", modelType: "modelType", format: "format",
    currentVersion: "currentVersion", status: "status", productModelId: "productModelId", updatedAt: "updatedAt",
  },
  modelVersions: { __mockName: "modelVersions", id: "id", modelId: "modelId", version: "version", status: "status", accuracy: "accuracy", createdAt: "createdAt" },
  modelDriftAlerts: { __mockName: "modelDriftAlerts", id: "id", modelId: "modelId", createdAt: "createdAt" },
  apiKeys: { __mockName: "apiKeys", keyHash: "keyHash", isActive: "isActive", id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  desc: (x: unknown) => x,
  eq: (...a: unknown[]) => a,
  gte: (...a: unknown[]) => a,
  lte: (...a: unknown[]) => a,
  inArray: (...a: unknown[]) => a,
}));

vi.mock("../../services/predictiveMaintenanceService", () => ({ computeFailureRisk: h.computeFailureRisk }));
vi.mock("../../services/aiModelService", () => ({ activateModelVersionManual: h.activateModelVersionManual }));
vi.mock("../../services/ai/modelAutoRollback", () => ({
  manualRollback: h.manualRollback,
  pickRollbackTarget: h.pickRollbackTarget,
}));
vi.mock("../../services/aiDriftMonitor", () => ({
  getDriftMetrics: h.getDriftMetrics,
  isDriftMonitorEnabled: h.isDriftMonitorEnabled,
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
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
afterEach(() => {
  delete process.env.V1_MODEL_MUTATIONS_ENABLED;
});

function call(path: string, key?: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) };
  if (key) headers["authorization"] = `Bearer ${key}`;
  return fetch(`${base}${path}`, { ...init, headers });
}

describe("W0-F — scope gating", () => {
  it("no key → 401 on every new endpoint", async () => {
    for (const [method, ep] of [
      ["GET", "/api/v1/health/assets/1"],
      ["GET", "/api/v1/predictions"],
      ["GET", "/api/v1/models"],
      ["POST", "/api/v1/models/3/promote"],
      ["POST", "/api/v1/models/3/rollback"],
      ["GET", "/api/v1/monitoring/drift"],
    ] as const) {
      const res = await call(ep, undefined, { method });
      expect(res.status, `${method} ${ep}`).toBe(401);
      expect((await res.json()).error.code).toBe("unauthorized");
    }
  });
});

describe("W0-F G4.11 — PdM health + predictions", () => {
  it("GET /health/assets/:id wraps computeFailureRisk + latest snapshot (correct shape)", async () => {
    h.computeFailureRisk.mockClear();
    const res = await call("/api/v1/health/assets/1", "MASTER");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(h.computeFailureRisk).toHaveBeenCalledWith(1, undefined);
    expect(body.data.assetId).toBe(1);
    expect(body.data.assetCode).toBe("AOI-01");
    expect(body.data.health.score).toBe(87);
    expect(body.data.failureRisk).toBe(62);
    expect(body.data.confidenceScore).toBe(71);
    expect(body.data.rul.hours).toBe(96);
    expect(body.data.rul.method).toBe("heuristic-proxy"); // honest label
    expect(body.data.factors).toHaveLength(1);
  });

  it("GET /health/assets/:id → 404 for an unknown asset", async () => {
    const res = await call("/api/v1/health/assets/999", "MASTER");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("GET /health/assets/:id → honest health:null when no snapshot exists", async () => {
    const saved = h.healthRows.splice(0, h.healthRows.length);
    try {
      const body = await (await call("/api/v1/health/assets/1", "MASTER")).json();
      expect(body.data.health).toBeNull();
      expect(body.data.failureRisk).toBe(62); // risk still computed
    } finally {
      h.healthRows.push(...saved);
    }
  });

  it("GET /predictions returns rows + count; garbage type → 400", async () => {
    const body = await (await call("/api/v1/predictions?assetId=1&type=MACHINE_FAILURE&limit=10", "MASTER")).json();
    expect(body.ok).toBe(true);
    expect(body.data.count).toBe(1);
    expect(body.data.predictions[0].id).toBe(11);

    const bad = await call("/api/v1/predictions?type=NOT_A_TYPE", "MASTER");
    expect(bad.status).toBe(400);
  });

  it("GET /predictions is honest-empty when the table has no rows", async () => {
    const saved = h.predictionRows.splice(0, h.predictionRows.length);
    try {
      const body = await (await call("/api/v1/predictions", "MASTER")).json();
      expect(body.data.predictions).toEqual([]);
      expect(body.data.count).toBe(0);
    } finally {
      h.predictionRows.push(...saved);
    }
  });
});

describe("W0-F G4.27 — model registry", () => {
  it("GET /models returns the catalogue with versions/stage", async () => {
    const body = await (await call("/api/v1/models", "MASTER")).json();
    expect(body.ok).toBe(true);
    expect(body.data.count).toBe(1);
    const m = body.data.models[0];
    expect(m.code).toBe("aoi-defect-v1");
    expect(m.currentVersion).toBe("1.2.0");
    expect(m.versions).toHaveLength(2);
    expect(m.versions[0].stage).toBe("ACTIVE");
    expect(body.data.mutationsEnabled).toBe(false); // flag default OFF
  });

  it("POST promote/rollback → 501 v1_model_mutations_disabled with the flag OFF (default)", async () => {
    for (const ep of ["/api/v1/models/3/promote", "/api/v1/models/3/rollback"]) {
      const res = await call(ep, "MASTER", { method: "POST", body: JSON.stringify({ versionId: 30, toVersionId: 30 }) });
      expect(res.status, ep).toBe(501);
      const body = await res.json();
      expect(body.error.code).toBe("v1_model_mutations_disabled");
    }
    expect(h.activateModelVersionManual).not.toHaveBeenCalled();
    expect(h.manualRollback).not.toHaveBeenCalled();
  });

  it("flag ON: promote wraps the GATED activateModelVersionManual path (doc69 W0-2)", async () => {
    process.env.V1_MODEL_MUTATIONS_ENABLED = "true";
    h.activateModelVersionManual.mockClear();
    const res = await call("/api/v1/models/3/promote", "MASTER", { method: "POST", body: JSON.stringify({ versionId: 30 }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(h.activateModelVersionManual).toHaveBeenCalledWith(3, 30, { force: false, reason: undefined, actorUserId: null });
    expect(body.data.promotedVersionId).toBe(30);

    // missing versionId → 400
    const bad = await call("/api/v1/models/3/promote", "MASTER", { method: "POST", body: JSON.stringify({}) });
    expect(bad.status).toBe(400);
  });

  it("flag ON: promote surfaces an eval-gate rejection as 422 eval_gate_rejected (doc69 W0-2)", async () => {
    process.env.V1_MODEL_MUTATIONS_ENABLED = "true";
    h.activateModelVersionManual.mockImplementationOnce(async () => {
      throw new Error(
        "Cannot activate model 3 version 30 (1.1.0): the eval quality gate has not passed " +
        "(evalReport.gate.pass !== true). Pass { force: true, reason } to explicitly override (audited).",
      );
    });
    const res = await call("/api/v1/models/3/promote", "MASTER", { method: "POST", body: JSON.stringify({ versionId: 30 }) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("eval_gate_rejected");
  });

  it("flag ON: promote maps an unknown-version rejection to 404 not_found (preserved)", async () => {
    process.env.V1_MODEL_MUTATIONS_ENABLED = "true";
    h.activateModelVersionManual.mockImplementationOnce(async () => {
      throw new Error("Version 999 not found for model 3");
    });
    const res = await call("/api/v1/models/3/promote", "MASTER", { method: "POST", body: JSON.stringify({ versionId: 999 }) });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("flag ON: promote threads force+reason through for an audited override (doc69 W0-2)", async () => {
    process.env.V1_MODEL_MUTATIONS_ENABLED = "true";
    h.activateModelVersionManual.mockClear();
    const res = await call("/api/v1/models/3/promote", "MASTER", {
      method: "POST",
      body: JSON.stringify({ versionId: 30, force: true, reason: "API override: known-good rebuild" }),
    });
    expect(res.status).toBe(200);
    expect(h.activateModelVersionManual).toHaveBeenCalledWith(3, 30, {
      force: true, reason: "API override: known-good rebuild", actorUserId: null,
    });
  });

  it("flag ON: rollback wraps manualRollback; auto-selects a stable target when toVersionId omitted", async () => {
    process.env.V1_MODEL_MUTATIONS_ENABLED = "true";
    h.manualRollback.mockClear();
    const res = await call("/api/v1/models/3/rollback", "MASTER", { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    // pickRollbackTarget (the SAME selector the auto-sweep uses) picked v30.
    expect(h.manualRollback).toHaveBeenCalled();
    expect(h.manualRollback.mock.calls[0][0]).toBe(3);
    expect(h.manualRollback.mock.calls[0][1]).toBe(30);
    expect(body.data.rolledBack).toBe(true);
    expect(body.data.eventId).toBe(99); // append-only audit row id surfaced
  });

  it("GET /monitoring/drift returns the advisory report (flag state + counters + alerts)", async () => {
    const body = await (await call("/api/v1/monitoring/drift", "MASTER")).json();
    expect(body.ok).toBe(true);
    expect(body.data.advisory).toBe(true);
    expect(body.data.monitorEnabled).toBe(false);
    expect(body.data.counters["3:HIGH"]).toBe(2);
    expect(body.data.count).toBe(1);
    expect(body.data.alerts[0].alertType).toBe("CONFIDENCE_SHIFT");
  });
});

describe("W0-F — openapi documents the new endpoints", () => {
  it("openapi.json includes the new paths + scopes", async () => {
    const spec = await (await call("/api/v1/openapi.json")).json();
    expect(spec.paths["/api/v1/health/assets/{id}"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/predictions"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/models"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/models/{id}/promote"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/models/{id}/rollback"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/monitoring/drift"]?.get).toBeTruthy();
    expect(spec.info.description).toMatch(/models:read/);
    expect(spec.info.description).toMatch(/models:write/);
  });
});
