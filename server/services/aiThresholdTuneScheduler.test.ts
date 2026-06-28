/**
 * Unit tests for the Threshold Auto-Tune Scheduler.
 *
 * Covers:
 *   • decidePointTune / decideNgTune pure logic: proposes when Cpk<target +
 *     material + enough samples; skips when degraded / sub-min samples /
 *     immaterial change / already-good Cpk / disabled.
 *   • runThresholdTuneNow: enumeration → decision → MAX cap → HITL proposal
 *     creation (NG inbox propose / point approval request), with per-scope
 *     failure isolation.
 *   • startThresholdTuneScheduler registers cron when ON.
 *   • Flag-OFF run is a safe no-op (verified in a separate module instance).
 *
 * The advisor + proposeAction + db helpers are mocked → pure/offline test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Flag must be ON at module-load (the SUT captures consts at import). vi.hoisted runs
// BEFORE the hoisted static import below, so the flag is set in time.
vi.hoisted(() => {
  process.env.AI_THRESHOLD_AUTOTUNE_ENABLED = "true";
});

// ── Mocks (declared before importing the SUT) ─────────────────────────────────
const enumerateNgTuneScopes = vi.fn();
const enumeratePointTuneScopes = vi.fn();
const factoryCodeForMachine = vi.fn();
const recommendNgThreshold = vi.fn();
const recommendForMeasurementPoint = vi.fn();
const proposeAction = vi.fn();

vi.mock("../db/aiThresholdTune", () => ({
  enumerateNgTuneScopes: (...a: any[]) => enumerateNgTuneScopes(...a),
  enumeratePointTuneScopes: (...a: any[]) => enumeratePointTuneScopes(...a),
  factoryCodeForMachine: (...a: any[]) => factoryCodeForMachine(...a),
}));
vi.mock("./aiThresholdAdvisor", () => ({
  recommendNgThreshold: (...a: any[]) => recommendNgThreshold(...a),
  recommendForMeasurementPoint: (...a: any[]) => recommendForMeasurementPoint(...a),
}));
vi.mock("./aiCopilotActions", () => ({
  proposeAction: (...a: any[]) => proposeAction(...a),
}));

// Tool registry: a fake adjust_ng_threshold write-tool.
const fakeTool = {
  name: "adjust_ng_threshold",
  requiredPermission: { module: "engineering", action: "update" },
  parameters: { safeParse: () => ({ success: true }) },
};
vi.mock("./aiLocalTools/toolRegistry", () => ({
  getTool: (n: string) => (n === "adjust_ng_threshold" ? fakeTool : null),
  isWriteTool: () => true,
}));
vi.mock("./aiLocalTools/writeHandlers/engineering", () => ({}));

// DB: thresholdApprovals insert (point path) + responsible-user query.
const insertValues = vi.fn(async () => undefined);
const fakeDb = {
  insert: vi.fn(() => ({ values: insertValues })),
  select: vi.fn(() => ({ from: () => ({ where: async () => [] }) })),
};
vi.mock("../db/connection", () => ({
  getDb: async () => fakeDb,
}));
vi.mock("../../drizzle/schema/product", () => ({ thresholdApprovals: {} }));
vi.mock("../../drizzle/schema", () => ({ users: {}, userFactoryAssignments: {} }));
vi.mock("../_core/accessControl", () => ({ checkPermission: async () => true }));

// node-cron mock (capture schedule; never run a real timer).
const cronSchedule = vi.fn(() => ({ stop: vi.fn() }));
vi.mock("node-cron", () => ({
  schedule: (...a: any[]) => cronSchedule(...a),
}));

import {
  decideNgTune,
  decidePointTune,
  runThresholdTuneNow,
  startThresholdTuneScheduler,
  type TuneConfig,
} from "./aiThresholdTuneScheduler";

const CFG: TuneConfig = { minSamples: 300, cpkTarget: 1.33, minDelta: 0.1 };

function pointRec(over: Partial<any> = {}): any {
  return {
    ok: true,
    disabled: false,
    pointDefId: 1,
    code: "MP1",
    name: "MP1",
    unit: "mm",
    current: { lsl: 0, usl: 10, target: 5, cpk: 1.0 },
    recommended: { lsl: 1, usl: 9, target: 5, projectedCpk: 1.4 },
    sampleSize: 400,
    confidence: 0.8,
    basis: "",
    degraded: false,
    ...over,
  };
}

function ngRec(over: Partial<any> = {}): any {
  return {
    ok: true,
    disabled: false,
    ngThresholdId: 1,
    name: "NG1",
    current: { warning: 5, critical: 10 },
    recommended: { warning: 8, critical: 14 },
    sampleSize: 400,
    basis: "",
    degraded: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  enumerateNgTuneScopes.mockResolvedValue([]);
  enumeratePointTuneScopes.mockResolvedValue([]);
  factoryCodeForMachine.mockResolvedValue("F1");
  recommendNgThreshold.mockResolvedValue(ngRec());
  recommendForMeasurementPoint.mockResolvedValue(pointRec());
  proposeAction.mockResolvedValue({ ok: true });
});

// ── Pure decide: measurement point ────────────────────────────────────────────
describe("decidePointTune", () => {
  it("proposes when Cpk<target, enough samples, material improvement", () => {
    expect(decidePointTune(pointRec(), CFG)).toEqual({ propose: true, reason: "ok_point" });
  });

  it("skips when degraded", () => {
    expect(decidePointTune(pointRec({ degraded: true }), CFG).propose).toBe(false);
    expect(decidePointTune(pointRec({ degraded: true }), CFG).reason).toBe("degraded");
  });

  it("skips when sub-min samples", () => {
    expect(decidePointTune(pointRec({ sampleSize: 100 }), CFG).reason).toBe("sub_min_samples");
  });

  it("skips when current Cpk already at/above target", () => {
    const r = pointRec({ current: { lsl: 0, usl: 10, target: 5, cpk: 1.5 } });
    expect(decidePointTune(r, CFG).reason).toBe("already_good");
  });

  it("skips when improvement is immaterial (< minDelta)", () => {
    const r = pointRec({ recommended: { lsl: 1, usl: 9, target: 5, projectedCpk: 1.05 } });
    expect(decidePointTune(r, CFG).reason).toBe("immaterial");
  });

  it("skips when advisor result disabled", () => {
    expect(decidePointTune(pointRec({ disabled: true }), CFG).reason).toBe("disabled");
  });
});

// ── Pure decide: NG threshold ─────────────────────────────────────────────────
describe("decideNgTune", () => {
  it("proposes when warn/crit drift ≥ minDelta with enough samples", () => {
    expect(decideNgTune(ngRec(), CFG)).toEqual({ propose: true, reason: "ok_ng" });
  });

  it("skips when degraded", () => {
    expect(decideNgTune(ngRec({ degraded: true }), CFG).reason).toBe("degraded");
  });

  it("skips when sub-min samples", () => {
    expect(decideNgTune(ngRec({ sampleSize: 50 }), CFG).reason).toBe("sub_min_samples");
  });

  it("skips when drift is immaterial", () => {
    const r = ngRec({ current: { warning: 5, critical: 10 }, recommended: { warning: 5.05, critical: 10.1 } });
    expect(decideNgTune(r, CFG).reason).toBe("immaterial");
  });
});

// ── Run orchestration ─────────────────────────────────────────────────────────
describe("runThresholdTuneNow", () => {
  it("proposes adjust_ng_threshold to responsible users for a qualifying NG scope", async () => {
    enumerateNgTuneScopes.mockResolvedValue([
      { kind: "ng", ngThresholdId: 101, machineId: 7, measurementPointId: null, sampleCount: 400 },
    ]);
    recommendNgThreshold.mockResolvedValue(ngRec({ ngThresholdId: 101 }));
    // factoryCode null → skip the assignment-filter branch (single candidates select).
    factoryCodeForMachine.mockResolvedValue(null);
    // responsible-user candidates select → one permitted user
    fakeDb.select.mockReturnValue({ from: () => ({ where: async () => [{ id: 9, role: "maintenance", name: "U9" }] }) } as any);

    const stats = await runThresholdTuneNow();
    expect(proposeAction).toHaveBeenCalledTimes(1);
    expect(stats.ngProposed).toBe(1);
    expect(stats.proposed).toBe(1);
  });

  it("creates a threshold-approval request for a qualifying point scope", async () => {
    enumeratePointTuneScopes.mockResolvedValue([
      { kind: "point", pointDefId: 201, productModelId: 2, machineId: 3, sampleCount: 400 },
    ]);
    recommendForMeasurementPoint.mockResolvedValue(pointRec({ pointDefId: 201 }));
    const stats = await runThresholdTuneNow();
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(stats.pointRequested).toBe(1);
    expect(stats.proposed).toBe(1);
  });

  it("caps proposals at MAX_PER_RUN and logs cappedOut", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      kind: "point" as const,
      pointDefId: 300 + i,
      productModelId: 1,
      machineId: 1,
      sampleCount: 400,
    }));
    enumeratePointTuneScopes.mockResolvedValue(many);
    const stats = await runThresholdTuneNow();
    expect(stats.considered).toBe(25);
    expect(stats.cappedOut).toBe(5); // default MAX_PER_RUN=20
    expect(stats.proposed).toBe(20);
  });

  it("isolates a per-scope advisor failure (other scopes still proposed)", async () => {
    enumerateNgTuneScopes.mockResolvedValue([
      { kind: "ng", ngThresholdId: 401, machineId: 7, measurementPointId: null, sampleCount: 400 },
      { kind: "ng", ngThresholdId: 402, machineId: 8, measurementPointId: null, sampleCount: 400 },
    ]);
    recommendNgThreshold
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(ngRec({ ngThresholdId: 402 }));
    factoryCodeForMachine.mockResolvedValue(null);
    fakeDb.select.mockReturnValue({ from: () => ({ where: async () => [{ id: 9, role: "maintenance", name: "U9" }] }) } as any);

    const stats = await runThresholdTuneNow();
    expect(stats.failures).toBe(1);
    expect(stats.proposed).toBe(1); // the second scope still went through
  });

  it("skips a scope that does not qualify (immaterial)", async () => {
    enumeratePointTuneScopes.mockResolvedValue([
      { kind: "point", pointDefId: 501, productModelId: 2, machineId: 3, sampleCount: 400 },
    ]);
    recommendForMeasurementPoint.mockResolvedValue(
      pointRec({ pointDefId: 501, recommended: { lsl: 1, usl: 9, target: 5, projectedCpk: 1.02 } }),
    );
    const stats = await runThresholdTuneNow();
    expect(stats.proposed).toBe(0);
    expect(insertValues).not.toHaveBeenCalled();
  });
});

// ── Scheduler lifecycle ───────────────────────────────────────────────────────
describe("startThresholdTuneScheduler", () => {
  it("registers a cron job when enabled", () => {
    startThresholdTuneScheduler();
    expect(cronSchedule).toHaveBeenCalledTimes(1);
  });
});

// ── Flag-OFF no-op (isolated module instance) ─────────────────────────────────
describe("flag OFF", () => {
  it("runThresholdTuneNow is a safe no-op when disabled", async () => {
    vi.resetModules();
    const prev = process.env.AI_THRESHOLD_AUTOTUNE_ENABLED;
    process.env.AI_THRESHOLD_AUTOTUNE_ENABLED = "false";
    // Re-mock for the fresh module graph.
    vi.doMock("../db/aiThresholdTune", () => ({
      enumerateNgTuneScopes: vi.fn(async () => [{ kind: "ng", ngThresholdId: 1, machineId: 7, measurementPointId: null, sampleCount: 999 }]),
      enumeratePointTuneScopes: vi.fn(async () => []),
      factoryCodeForMachine: vi.fn(async () => null),
    }));
    const mod = await import("./aiThresholdTuneScheduler");
    const stats = await mod.runThresholdTuneNow();
    expect(stats.considered).toBe(0);
    expect(stats.proposed).toBe(0);
    process.env.AI_THRESHOLD_AUTOTUNE_ENABLED = prev;
  });
});
