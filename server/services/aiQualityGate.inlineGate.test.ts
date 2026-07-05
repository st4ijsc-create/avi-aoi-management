/**
 * W7-A (doc 27 Đợt 7.1 — V1/V18) — runInlineQualityGate unit tests.
 *
 * Covers: flag gate (default OFF ⇒ no-op), per-machine/product config gate,
 * SUCCESS write shape (identical to the on-demand path — processQualityGate is
 * reused), the AI-down circuit breaker (N consecutive failures within window →
 * OPEN → skip with honest {skipped:'ai_unavailable'} marker → half-open probe →
 * recovery / re-open), image problems never tripping the breaker, and the
 * health-page breaker getter.
 *
 * Strategy: chainable in-memory drizzle mock (same style as
 * aiQualityGateCanary.test.ts) + mocked runInference — no ONNX model needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db/connection");
vi.mock("./aiInferenceEngine");
vi.mock("../db/ai");
// W7-B seam — mocked so this unit test never depends on the (parallel-built)
// NTF predictor's internals; the seam contract (called with inspectionId) is
// asserted here.
vi.mock("./ai/ntfPredictorService", () => ({
  scoreInspectionNtf: vi.fn(async () => undefined),
}));

import * as dbConnection from "../db/connection";
import * as engine from "./aiInferenceEngine";
import { scoreInspectionNtf } from "./ai/ntfPredictorService";
import {
  aiQualityGateConfigs,
  aiQualityGateResults,
  productInspections,
} from "../../drizzle/schema";
import {
  runInlineQualityGate,
  getInlineGateBreakerState,
  _resetInlineGateBreaker,
  invalidateConfigCache,
  isInlineGateEnabled,
} from "./aiQualityGate";

// ── Chainable drizzle mock ────────────────────────────────────────────────────
function makeMockDb(opts: { config?: any } = {}) {
  const inserted: Array<{ table: any; values: any }> = [];
  const updates: Array<{ table: any; set: any }> = [];
  const db: any = {
    insert(table: any) {
      return {
        values: async (v: any) => {
          inserted.push({ table, values: v });
          return [{ id: 1 }];
        },
      };
    },
    update(table: any) {
      return {
        set: (s: any) => {
          updates.push({ table, set: s });
          return { where: async () => [{ id: 1 }] };
        },
      };
    },
    select() {
      return {
        from(table: any) {
          const rows = table === aiQualityGateConfigs && opts.config ? [opts.config] : [];
          const chain: any = {
            where: () => chain,
            orderBy: () => chain,
            limit: async () => rows,
          };
          return chain;
        },
      };
    },
  };
  return { db, inserted, updates };
}

let nextMachineId = 91_000; // unique per test — getQualityGateConfig caches per machine

function makeConfig(machineId: number, over: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: "w7a-test",
    machineId,
    productModelId: null,
    modelId: 10,
    enabled: true,
    autoOkThreshold: "0.95",
    autoNgThreshold: "0.85",
    reviewThreshold: "0.60",
    ngLabels: ["NG"],
    okLabels: ["OK"],
    ensembleConfigId: null,
    activeExperimentId: null,
    ...over,
  };
}

function makeInput(machineId: number, over: Record<string, unknown> = {}) {
  return {
    inspectionId: 42,
    machineId,
    productModelId: null,
    source: "machine_api" as const,
    getImage: () => Buffer.from("img"),
    ...over,
  };
}

const OK_INFERENCE = {
  modelCode: "m",
  modelVersion: "v1",
  predictions: [{ label: "OK", confidence: 0.97 }],
  topLabel: "OK",
  confidence: 0.97,
  processingTimeMs: 4,
  status: "COMPLETED",
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetInlineGateBreaker();
  invalidateConfigCache();
  process.env.AI_INLINE_GATE_ENABLED = "true";
  process.env.AI_INLINE_BREAKER_THRESHOLD = "3";
  process.env.AI_INLINE_BREAKER_WINDOW_MS = "60000";
  process.env.AI_INLINE_BREAKER_COOLDOWN_MS = "10000";
  (engine.runInference as any).mockResolvedValue(OK_INFERENCE);
});

afterEach(() => {
  delete process.env.AI_INLINE_GATE_ENABLED;
  delete process.env.AI_INLINE_BREAKER_THRESHOLD;
  delete process.env.AI_INLINE_BREAKER_WINDOW_MS;
  delete process.env.AI_INLINE_BREAKER_COOLDOWN_MS;
  vi.useRealTimers();
});

describe("runInlineQualityGate — flag & config gates", () => {
  it("flag OFF (code default) ⇒ status 'disabled', zero side effects", async () => {
    delete process.env.AI_INLINE_GATE_ENABLED;
    expect(isInlineGateEnabled()).toBe(false);

    const machineId = nextMachineId++;
    const { db, inserted, updates } = makeMockDb({ config: makeConfig(machineId) });
    (dbConnection.getDb as any).mockResolvedValue(db);

    const outcome = await runInlineQualityGate(makeInput(machineId));
    expect(outcome).toEqual({ status: "disabled" });
    expect(engine.runInference).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(scoreInspectionNtf).not.toHaveBeenCalled();
  });

  it("no enabled config for (machine, product) ⇒ 'no_config', no inference", async () => {
    const machineId = nextMachineId++;
    const { db, updates } = makeMockDb({}); // no config rows
    (dbConnection.getDb as any).mockResolvedValue(db);

    const outcome = await runInlineQualityGate(makeInput(machineId));
    expect(outcome).toEqual({ status: "no_config" });
    expect(engine.runInference).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("no image (null) ⇒ 'no_image', breaker untouched", async () => {
    const machineId = nextMachineId++;
    const { db } = makeMockDb({ config: makeConfig(machineId) });
    (dbConnection.getDb as any).mockResolvedValue(db);

    const outcome = await runInlineQualityGate(makeInput(machineId, { getImage: () => null }));
    expect(outcome).toEqual({ status: "no_image" });
    expect(engine.runInference).not.toHaveBeenCalled();
    expect(getInlineGateBreakerState().consecutiveFailures).toBe(0);
  });

  it("image resolver THROWS ⇒ 'no_image' (data problem — never trips the breaker)", async () => {
    const machineId = nextMachineId++;
    const { db } = makeMockDb({ config: makeConfig(machineId) });
    (dbConnection.getDb as any).mockResolvedValue(db);

    const outcome = await runInlineQualityGate(
      makeInput(machineId, {
        getImage: () => {
          throw new Error("corrupt zip entry");
        },
      }),
    );
    expect(outcome).toEqual({ status: "no_image" });
    expect(getInlineGateBreakerState().consecutiveFailures).toBe(0);
    expect(getInlineGateBreakerState().state).toBe("closed");
  });
});

describe("runInlineQualityGate — success path (V1)", () => {
  it("processes via processQualityGate: SAME write shape as the on-demand path + NTF seam called", async () => {
    const machineId = nextMachineId++;
    const config = makeConfig(machineId);
    const { db, inserted, updates } = makeMockDb({ config });
    (dbConnection.getDb as any).mockResolvedValue(db);

    const outcome = await runInlineQualityGate(makeInput(machineId));
    expect(outcome).toEqual({ status: "processed", decision: "AUTO_OK" });

    // ai_quality_gate_results row (audit) — exactly like aiQualityGateRouter.processInspection.
    const qg = inserted.find((i) => i.table === aiQualityGateResults);
    expect(qg?.values?.decision).toBe("AUTO_OK");
    expect(qg?.values?.inspectionId).toBe(42);

    // product_inspections stamp — the shared shape the UI reads.
    const stamp = updates.find((u) => u.table === productInspections);
    expect(stamp?.set?.aiDecision).toBe("AUTO_OK");
    expect(stamp?.set?.aiConfidence).toBe("0.9700");
    expect(stamp?.set?.aiModelId).toBe(config.modelId);
    expect(stamp?.set?.aiProcessedAt).toBeInstanceOf(Date);
    expect(stamp?.set?.aiDetails?.predictions?.[0]?.label).toBe("OK");
    expect(stamp?.set?.aiDetails?.skipped).toBeUndefined(); // real verdict — no degrade marker

    expect(getInlineGateBreakerState().state).toBe("closed");
    expect(scoreInspectionNtf).toHaveBeenCalledWith(42, expect.objectContaining({ machineId }));
  });
});

describe("runInlineQualityGate — circuit breaker (V18)", () => {
  it("a single AI failure stamps NEEDS_REVIEW + {skipped:'ai_error'}, breaker still closed", async () => {
    const machineId = nextMachineId++;
    const { db, updates } = makeMockDb({ config: makeConfig(machineId) });
    (dbConnection.getDb as any).mockResolvedValue(db);
    (engine.runInference as any).mockRejectedValue(new Error("CUDA out of memory"));

    const outcome = await runInlineQualityGate(makeInput(machineId));
    expect(outcome.status).toBe("failed");

    const stamp = updates.find((u) => u.table === productInspections);
    expect(stamp?.set?.aiDecision).toBe("NEEDS_REVIEW");
    expect(stamp?.set?.aiDetails?.skipped).toBe("ai_error");
    expect(stamp?.set?.aiDetails?.inline).toBe(true);
    expect(stamp?.set?.aiConfidence).toBeUndefined(); // honest: no inference ran
    expect(stamp?.set?.aiModelId).toBeUndefined();

    const state = getInlineGateBreakerState();
    expect(state.state).toBe("closed");
    expect(state.consecutiveFailures).toBe(1);
    expect(state.lastError).toContain("CUDA out of memory");
  });

  it("OPENs after N consecutive failures; while open, skips inference and stamps {skipped:'ai_unavailable'}", async () => {
    const machineId = nextMachineId++;
    const { db, updates } = makeMockDb({ config: makeConfig(machineId) });
    (dbConnection.getDb as any).mockResolvedValue(db);
    (engine.runInference as any).mockRejectedValue(new Error("model service down"));

    for (let i = 0; i < 3; i++) {
      const o = await runInlineQualityGate(makeInput(machineId));
      expect(o.status).toBe("failed");
    }
    expect(getInlineGateBreakerState().state).toBe("open");
    expect(getInlineGateBreakerState().totalOpens).toBe(1);
    expect(engine.runInference).toHaveBeenCalledTimes(3);

    // 4th call while OPEN: no inference attempt, honest skip marker instead.
    const skipped = await runInlineQualityGate(makeInput(machineId));
    expect(skipped).toEqual({ status: "skipped", reason: "ai_unavailable" });
    expect(engine.runInference).toHaveBeenCalledTimes(3); // unchanged
    const stamp = updates[updates.length - 1];
    expect(stamp.table).toBe(productInspections);
    expect(stamp.set?.aiDecision).toBe("NEEDS_REVIEW");
    expect(stamp.set?.aiDetails?.skipped).toBe("ai_unavailable");
    expect(getInlineGateBreakerState().totalSkips).toBe(1);
    // NTF seam still runs while AI is down (heuristic scoring needs no model).
    expect(scoreInspectionNtf).toHaveBeenCalledTimes(4);
  });

  it("half-open probe SUCCESS after cooldown closes the breaker (recovery)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T08:00:00Z"));
    const machineId = nextMachineId++;
    const { db } = makeMockDb({ config: makeConfig(machineId) });
    (dbConnection.getDb as any).mockResolvedValue(db);

    (engine.runInference as any).mockRejectedValue(new Error("down"));
    for (let i = 0; i < 3; i++) await runInlineQualityGate(makeInput(machineId));
    expect(getInlineGateBreakerState().state).toBe("open");
    expect(getInlineGateBreakerState().cooldownRemainingMs).toBeGreaterThan(0);

    // Before cooldown elapses: still skipped.
    vi.setSystemTime(new Date("2026-07-04T08:00:05Z")); // 5s < 10s cooldown
    expect((await runInlineQualityGate(makeInput(machineId))).status).toBe("skipped");

    // After cooldown: ONE probe is allowed; AI recovered → breaker closes.
    vi.setSystemTime(new Date("2026-07-04T08:00:11Z"));
    (engine.runInference as any).mockResolvedValue(OK_INFERENCE);
    const recovered = await runInlineQualityGate(makeInput(machineId));
    expect(recovered).toEqual({ status: "processed", decision: "AUTO_OK" });
    expect(getInlineGateBreakerState().state).toBe("closed");
    expect(getInlineGateBreakerState().consecutiveFailures).toBe(0);
  });

  it("half-open probe FAILURE re-opens with a fresh cooldown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T09:00:00Z"));
    const machineId = nextMachineId++;
    const { db } = makeMockDb({ config: makeConfig(machineId) });
    (dbConnection.getDb as any).mockResolvedValue(db);

    (engine.runInference as any).mockRejectedValue(new Error("still down"));
    for (let i = 0; i < 3; i++) await runInlineQualityGate(makeInput(machineId));
    expect(getInlineGateBreakerState().state).toBe("open");

    vi.setSystemTime(new Date("2026-07-04T09:00:11Z")); // past cooldown → probe
    const probe = await runInlineQualityGate(makeInput(machineId));
    expect(probe.status).toBe("failed"); // probe ran (and failed honestly)

    const state = getInlineGateBreakerState();
    expect(state.state).toBe("open");
    expect(state.totalOpens).toBe(2);
    expect(state.cooldownRemainingMs).toBeGreaterThan(9000); // fresh cooldown
  });

  it("getter exposes the health-page snapshot shape", () => {
    const s = getInlineGateBreakerState();
    expect(s).toMatchObject({
      enabled: true,
      state: "closed",
      consecutiveFailures: 0,
      failureThreshold: 3,
      windowMs: 60000,
      cooldownMs: 10000,
      openedAt: null,
      lastFailureAt: null,
      lastError: null,
      cooldownRemainingMs: 0,
      totalOpens: 0,
      totalSkips: 0,
    });
  });
});
