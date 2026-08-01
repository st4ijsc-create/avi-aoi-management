/**
 * G4.30 (doc 44 W5-A3) — tests for the SYNAPSE Tầng-4 Advice API (advice.ts).
 *
 * Mounts a bespoke Express router with registerAdviceRoutes() (the batch does NOT
 * self-register in router.ts) behind the SAME scoped-API-key auth. Covers:
 *   • scope gating (no key → 401),
 *   • POST /predict/forecast + /predict/anomaly shape (+ honest-null anomaly),
 *   • POST /predict/defect → honest 501, unknown task → 400,
 *   • POST /recommend shape (guardrail + requires) for both action types + 400,
 *   • GET /recommendations lists ai_pending_actions incl. contract guardrail/requires.
 * Mirrors pdmModelReads.test.ts: real Express on an ephemeral port, global fetch.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  machines: [{ id: 1, code: "AOI-01" }],
  anomalyRows: [
    {
      id: 11, predictedValue: "0.85", currentValue: "0.7", threshold: "0.6", confidenceScore: "82",
      predictedTimeframe: "within 6h", title: "Vibration RMS drift", description: "RMS up 8%",
      createdAt: new Date("2026-07-01T00:00:00Z"),
    },
  ],
  pendingRows: [
    {
      id: "act-1", tool: "adjust_ng_threshold", status: "proposed", summary: "Tighten NG",
      requiredPermissionJson: { module: "engineering", action: "canUpdate" },
      previewJson: { changes: [], contract: { requires: ["policy_permit"], guardrail: { min: 0, max: 100, key: "warningThreshold" }, confidence: 0.6 } },
      createdAt: new Date(), expiresAt: new Date(Date.now() + 300000),
    },
  ],
  computeFailureRisk: vi.fn(async (machineId: number) => ({
    machineId, failureRisk: 62, confidenceScore: 71,
    predictedTimeframe: "within 4 days", predictedTimeframeHours: 96,
    recommendedMaintenanceDate: new Date(), maintenanceUrgency: "HIGH",
    factors: [{ name: "trend", contribution: 55, description: "declining health" }], dataPoints: 42,
  })),
  recommendNgThreshold: vi.fn(async () => ({
    ok: true, ngThresholdId: 7, name: "NG-1", current: { warning: 6, critical: 12 },
    recommended: { warning: 5, critical: 10 }, sampleSize: 20, basis: "20 days", degraded: false, note: undefined,
  })),
  recommendForMeasurementPoint: vi.fn(async () => ({
    ok: true, pointDefId: 12, code: "MP12", name: "P12", unit: "mm",
    current: { lsl: 8, usl: 10, target: 9, cpk: 1.1 },
    recommended: { lsl: 8.2, usl: 9.8, target: 9, projectedCpk: 1.4 },
    sampleSize: 500, confidence: 0.8, basis: "500 results", degraded: false, needsReview: false,
  })),
}));

vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));
vi.mock("../../db", () => ({ getDb: vi.fn(async () => null), getMachineByApiKey: vi.fn(async () => undefined) }));

function chain(rows: unknown[]) {
  const p: any = Promise.resolve(rows);
  p.from = () => p;
  p.where = () => p;
  p.orderBy = () => p;
  p.limit = () => p;
  return p;
}
function makeDb() {
  return {
    select: () => ({
      from: (table: any) => {
        const key = table?.__mockName ?? "";
        if (key === "machines") {
          return {
            where: (cond: any) => {
              const id = Array.isArray(cond) ? cond[1] : undefined;
              return chain(h.machines.filter((m) => m.id === id));
            },
          };
        }
        const byTable: Record<string, unknown[]> = {
          predictiveAlerts: h.anomalyRows,
          aiPendingActions: h.pendingRows,
        };
        return chain(byTable[key] ?? []);
      },
    }),
  };
}
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeDb()) }));

vi.mock("../../../drizzle/schema", () => ({
  machines: { __mockName: "machines", id: "id", code: "code" },
  predictiveAlerts: {
    __mockName: "predictiveAlerts", id: "id", machineId: "machineId", alertType: "alertType",
    predictedValue: "predictedValue", currentValue: "currentValue", threshold: "threshold",
    confidenceScore: "confidenceScore", predictedTimeframe: "predictedTimeframe",
    title: "title", description: "description", createdAt: "createdAt",
  },
  aiPendingActions: {
    __mockName: "aiPendingActions", id: "id", tool: "tool", status: "status", summary: "summary",
    requiredPermissionJson: "requiredPermissionJson", previewJson: "previewJson",
    createdAt: "createdAt", expiresAt: "expiresAt",
  },
  apiKeys: { __mockName: "apiKeys", keyHash: "keyHash", isActive: "isActive", id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  desc: (x: unknown) => x,
  eq: (...a: unknown[]) => a,
}));

vi.mock("../../services/predictiveMaintenanceService", () => ({ computeFailureRisk: h.computeFailureRisk }));
vi.mock("../../services/aiThresholdAdvisor", () => ({
  recommendNgThreshold: h.recommendNgThreshold,
  recommendForMeasurementPoint: h.recommendForMeasurementPoint,
}));

import { registerAdviceRoutes } from "./advice";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const r = express.Router();
  registerAdviceRoutes(r);
  app.use("/api/v1", r);
  await new Promise<void>((resolve) => {
    server = createServer(app).listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(path: string, key?: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) };
  if (key) headers["authorization"] = `Bearer ${key}`;
  return fetch(`${base}${path}`, { ...init, headers });
}
const post = (path: string, key: string | undefined, body: unknown) =>
  call(path, key, { method: "POST", body: JSON.stringify(body) });

describe("advice API — scope gating", () => {
  it("no key → 401", async () => {
    const res = await post("/api/v1/predict/forecast", undefined, { assetId: 1 });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });
});

describe("POST /predict/:task", () => {
  it("forecast → Prediction shape (RUL + normalized confidence)", async () => {
    const body = await (await post("/api/v1/predict/forecast", "MASTER", { assetId: 1 })).json();
    expect(body.ok).toBe(true);
    expect(body.data.type).toBe("forecast");
    expect(body.data.asset).toBe("AOI-01");
    expect(body.data.value.rul_hours).toBe(96);
    expect(body.data.value.rul_days).toBe(4);
    expect(body.data.confidence).toBeCloseTo(0.71);
    expect(body.data.explain[0]).toMatch(/declining health/);
  });

  it("anomaly → Prediction from the latest PATTERN_ANOMALY row", async () => {
    const body = await (await post("/api/v1/predict/anomaly", "MASTER", { assetId: 1 })).json();
    expect(body.data.type).toBe("anomaly");
    expect(body.data.pred_id).toBe("PRD-an-11");
    expect(body.data.value.predicted).toBe(0.85);
    expect(body.data.confidence).toBeCloseTo(0.82); // 82 → 0.82
    expect(body.data.explain).toContain("Vibration RMS drift");
  });

  it("anomaly → honest null value when no prediction on record", async () => {
    const saved = h.anomalyRows.splice(0, h.anomalyRows.length);
    try {
      const body = await (await post("/api/v1/predict/anomaly", "MASTER", { assetId: 1 })).json();
      expect(body.data.value).toBeNull();
      expect(body.data.pred_id).toBeNull();
    } finally {
      h.anomalyRows.push(...saved);
    }
  });

  it("defect → honest 501 pointing at the internal AOI ingest path", async () => {
    const res = await post("/api/v1/predict/defect", "MASTER", { assetId: 1 });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error.code).toBe("not_implemented");
    expect(body.error.message).toMatch(/ingest\/inspection/);
  });

  it("unknown task → 400; unknown asset → 404", async () => {
    expect((await post("/api/v1/predict/foobar", "MASTER", { assetId: 1 })).status).toBe(400);
    expect((await post("/api/v1/predict/forecast", "MASTER", { assetId: 999 })).status).toBe(404);
  });
});

describe("POST /recommend", () => {
  it("adjust_ng_threshold → Recommendation with guardrail + requires[policy_permit]", async () => {
    const body = await (await post("/api/v1/recommend", "MASTER", {
      target: { ngThresholdId: 7 }, action_type: "adjust_ng_threshold",
    })).json();
    expect(body.ok).toBe(true);
    expect(body.data.rec_id).toBe("REC-ng-7");
    expect(body.data.action).toBe("adjust_ng_threshold");
    expect(body.data.proposal).toEqual({ warningThreshold: 5, criticalThreshold: 10 });
    expect(body.data.guardrail).toMatchObject({ min: 0, max: 100, key: "warningThreshold" });
    expect(body.data.requires).toEqual(["policy_permit"]);
    expect(body.data.advisory).toBe(true);
    expect(h.recommendNgThreshold).toHaveBeenCalled();
  });

  it("adjust_param → Recommendation with guardrail from current limits + twin_validation", async () => {
    const body = await (await post("/api/v1/recommend", "MASTER", {
      target: { measurementPointId: 12 }, action_type: "adjust_param",
    })).json();
    expect(body.data.rec_id).toBe("REC-mp-12");
    expect(body.data.action).toBe("adjust_param");
    expect(body.data.proposal).toEqual({ lsl: 8.2, usl: 9.8, target: 9 });
    expect(body.data.expected.projectedCpk).toBe(1.4);
    expect(body.data.confidence).toBe(0.8);
    expect(body.data.guardrail).toMatchObject({ min: 8, max: 10, unit: "mm", key: "target" });
    expect(body.data.requires).toEqual(["twin_validation", "policy_permit"]);
  });

  it("unknown action_type → 400", async () => {
    const res = await post("/api/v1/recommend", "MASTER", { target: {}, action_type: "nope" });
    expect(res.status).toBe(400);
  });
});

describe("GET /recommendations", () => {
  it("lists ai_pending_actions incl. contract guardrail/requires", async () => {
    const body = await (await call("/api/v1/recommendations?status=proposed", "MASTER")).json();
    expect(body.ok).toBe(true);
    expect(body.data.count).toBe(1);
    const rec = body.data.recommendations[0];
    expect(rec.rec_id).toBe("act-1");
    expect(rec.tool).toBe("adjust_ng_threshold");
    expect(rec.requires).toEqual(["policy_permit"]);
    expect(rec.guardrail).toMatchObject({ min: 0, max: 100, key: "warningThreshold" });
    expect(rec.confidence).toBe(0.6);
  });

  it("invalid status → 400", async () => {
    expect((await call("/api/v1/recommendations?status=bogus", "MASTER")).status).toBe(400);
  });
});
