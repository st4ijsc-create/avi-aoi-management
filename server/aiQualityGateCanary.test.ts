/**
 * B6 — processQualityGate canary live-path unit test.
 *
 * Verifies that when a config has activeExperimentId set and the experiment is
 * RUNNING, processQualityGate writes BOTH ai_quality_gate_results (production
 * decision) AND ab_test_results (canary variant) — with the canary inference mocked.
 *
 * Also verifies the no-canary path (activeExperimentId == null) does NOT touch
 * ab_test_results (legacy behaviour unchanged).
 *
 * Strategy: a chainable in-memory drizzle mock records which tables receive insert()
 * calls. runInference is mocked so no ONNX/model is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../server/db/connection");
vi.mock("../server/services/aiInferenceEngine");
vi.mock("../server/db/ai");

import * as dbConnection from "../server/db/connection";
import * as engine from "../server/services/aiInferenceEngine";
import {
  aiQualityGateResults,
  abTestResults,
  abTestExperiments,
  productInspections,
} from "../drizzle/schema";
import { processQualityGate } from "../server/services/aiQualityGate";

// ── Chainable drizzle mock ────────────────────────────────────────────────────
function makeMockDb(opts: { experiment: any }) {
  const insertedTables: any[] = [];

  const db: any = {
    insert(table: any) {
      insertedTables.push(table);
      return { values: async () => [{ id: 1 }] };
    },
    update(_table: any) {
      return {
        set() {
          return { where: async () => [{ id: 1 }] };
        },
      };
    },
    // select() is only used by the canary path to load the experiment row.
    select() {
      return {
        from(table: any) {
          const rows = table === abTestExperiments ? [opts.experiment] : [];
          return {
            where() {
              return { limit: async () => rows };
            },
          };
        },
      };
    },
  };

  return { db, insertedTables };
}

const BASE_CONFIG: any = {
  id: 7,
  modelId: 10,
  enabled: true,
  autoOkThreshold: "0.95",
  autoNgThreshold: "0.85",
  reviewThreshold: "0.60",
  ngLabels: ["NG"],
  okLabels: ["OK"],
  ensembleConfigId: null,
  activeExperimentId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (engine.runInference as any).mockResolvedValue({
    modelCode: "m",
    modelVersion: "v1",
    predictions: [{ label: "OK", confidence: 0.97 }],
    topLabel: "OK",
    confidence: 0.97,
    processingTimeMs: 4,
    status: "COMPLETED",
  });
});

describe("processQualityGate — canary live path", () => {
  it("writes BOTH ai_quality_gate_results and ab_test_results when canary is active", async () => {
    const experiment = {
      id: 99, status: "RUNNING", trafficSplitPercent: 50,
      modelAId: 10, modelBId: 20, modelAVersion: "vA", modelBVersion: "vB",
      totalInferences: 0, modelAInferences: 0, modelBInferences: 0,
    };
    const { db, insertedTables } = makeMockDb({ experiment });
    (dbConnection.getDb as any).mockResolvedValue(db);

    const config = { ...BASE_CONFIG, activeExperimentId: 99 };
    const decision = await processQualityGate(123, Buffer.from("img"), config);

    expect(decision.decision).toBe("AUTO_OK");
    expect(insertedTables).toContain(aiQualityGateResults);
    expect(insertedTables).toContain(abTestResults);
  });

  it("does NOT write ab_test_results when activeExperimentId is null (legacy path)", async () => {
    const { db, insertedTables } = makeMockDb({ experiment: null });
    (dbConnection.getDb as any).mockResolvedValue(db);

    const config = { ...BASE_CONFIG, activeExperimentId: null };
    await processQualityGate(123, Buffer.from("img"), config);

    expect(insertedTables).toContain(aiQualityGateResults);
    expect(insertedTables).not.toContain(abTestResults);
  });

  it("does NOT write ab_test_results when the experiment is not RUNNING", async () => {
    const experiment = {
      id: 99, status: "PAUSED", trafficSplitPercent: 50,
      modelAId: 10, modelBId: 20, modelAVersion: "vA", modelBVersion: "vB",
      totalInferences: 0, modelAInferences: 0, modelBInferences: 0,
    };
    const { db, insertedTables } = makeMockDb({ experiment });
    (dbConnection.getDb as any).mockResolvedValue(db);

    const config = { ...BASE_CONFIG, activeExperimentId: 99 };
    await processQualityGate(123, Buffer.from("img"), config);

    expect(insertedTables).toContain(aiQualityGateResults);
    expect(insertedTables).not.toContain(abTestResults);
  });
});

// Touch productInspections import so it isn't flagged unused (the update path uses it).
void productInspections;
