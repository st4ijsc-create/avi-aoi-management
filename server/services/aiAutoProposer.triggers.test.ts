/**
 * W7-E (doc 27 V21) — advanced auto-proposer trigger tests.
 *
 * Pure deciders (yield_drop / false_call_spike / machine_drift): fire on seeded
 * conditions with the right tool + bounded args; refuse on thin data / immaterial
 * signals. Sweep orchestration: one proposal per seeded condition, cooldown dedup
 * (no re-propose within the window), PROPOSE-ONLY invariant (only proposeAction
 * is ever called — never confirm/execute).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const savedFlag = process.env.AI_AUTO_PROPOSE_ENABLED;
afterAll(() => {
  if (savedFlag === undefined) delete process.env.AI_AUTO_PROPOSE_ENABLED;
  else process.env.AI_AUTO_PROPOSE_ENABLED = savedFlag;
});

// ── Mocks (before importing the SUT) ─────────────────────────────────────────
const proposeAction = vi.fn(async () => ({ ok: true }));
vi.mock("./aiCopilotActions", () => ({
  proposeAction: (...a: any[]) => proposeAction(...a),
}));

// Tool registry: fake write-tools for all three advanced triggers.
const fakeTools: Record<string, any> = {
  run_rca_analysis: {
    name: "run_rca_analysis",
    kind: "write",
    requiredPermission: { module: "machine_monitoring", action: "canView" },
    parameters: { safeParse: (a: unknown) => ({ success: true, data: a }) },
  },
  request_threshold_review: {
    name: "request_threshold_review",
    kind: "write",
    requiredPermission: { module: "settings_alerts", action: "canView" },
    parameters: { safeParse: (a: unknown) => ({ success: true, data: a }) },
  },
  create_maintenance_workorder: {
    name: "create_maintenance_workorder",
    kind: "write",
    requiredPermission: { module: "machine_monitoring", action: "canCreate" },
    parameters: { safeParse: (a: unknown) => ({ success: true, data: a }) },
  },
  adjust_ng_threshold: {
    name: "adjust_ng_threshold",
    kind: "write",
    requiredPermission: { module: "engineering", action: "canEdit" },
    parameters: { safeParse: (a: unknown) => ({ success: true, data: a }) },
  },
};
vi.mock("./aiLocalTools/toolRegistry", () => ({
  getTool: (n: string) => fakeTools[n] ?? null,
  isWriteTool: (t: any) => !!t && t.kind === "write",
}));
vi.mock("./aiLocalTools/writeHandlers/engineering", () => ({}));
vi.mock("./aiLocalTools/writeHandlers/maintenance", () => ({}));
vi.mock("./aiLocalTools/writeHandlers/qualityAdvisory", () => ({}));

// Responsible-user plumbing.
vi.mock("../db/aiThresholdTune", () => ({
  factoryCodeForMachine: vi.fn(async () => null),
}));
vi.mock("../../drizzle/schema", () => ({
  users: {},
  userFactoryAssignments: {},
  machines: {},
  productInspections: {},
  measurementResults: {},
}));
vi.mock("../_core/accessControl", () => ({ checkPermission: async () => true }));

// Cpk source (machine_drift): controllable per test.
const getControlChart = vi.fn(async () => ({ summary: { cpk: null } }));
vi.mock("./aiInspectionAnalytics", () => ({
  getControlChart: (...a: any[]) => getControlChart(...a),
}));

// DB: execute → sweep metrics rows; select → responsible-user candidates.
let metricsRows: any[] = [];
const fakeDb = {
  execute: vi.fn(async () => metricsRows),
  select: vi.fn(() => ({ from: () => ({ where: async () => [{ id: 9, role: "maintenance", name: "U9" }] }) })),
};
vi.mock("../db/connection", () => ({ getDb: async () => fakeDb }));

import {
  advancedTriggerConfig,
  decideFalseCallSpike,
  decideMachineDrift,
  decideYieldDrop,
  runAdvancedTriggerSweep,
  __resetAdvancedTriggerStateForTests,
  type AdvancedTriggerConfig,
} from "./aiAutoProposer";

const CFG: AdvancedTriggerConfig = {
  minRecentSamples: 50,
  yieldDropPct: 5,
  ntfSpikeFactor: 2,
  ntfSpikeMinPts: 5,
  cpkDropDelta: 0.3,
  cpkFloor: 1.33,
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetAdvancedTriggerStateForTests();
  metricsRows = [];
  process.env.AI_AUTO_PROPOSE_ENABLED = "true";
  getControlChart.mockResolvedValue({ summary: { cpk: null } } as any);
});

// ── Pure deciders ─────────────────────────────────────────────────────────────

describe("decideYieldDrop", () => {
  const base = { recentTotal: 100, baselineTotal: 500, recentYieldPct: 85, baselineYieldPct: 97 };

  it("fires run_rca_analysis on a material final-yield drop", () => {
    const d = decideYieldDrop(7, base, CFG);
    expect(d.reason).toBe("OK");
    expect(d.draft?.tool).toBe("run_rca_analysis");
    expect(d.draft?.args).toEqual({ machineId: 7, defectType: "yield_drop" });
  });

  it("refuses on thin recent/baseline data", () => {
    expect(decideYieldDrop(7, { ...base, recentTotal: 10 }, CFG).reason).toBe("SUB_MIN_RECENT_SAMPLES");
    expect(decideYieldDrop(7, { ...base, baselineTotal: 10 }, CFG).reason).toBe("SUB_MIN_BASELINE_SAMPLES");
  });

  it("refuses an immaterial drop", () => {
    const d = decideYieldDrop(7, { ...base, recentYieldPct: 94 }, CFG); // −3 pts < 5
    expect(d.draft).toBeNull();
    expect(d.reason).toBe("NO_MATERIAL_YIELD_DROP");
  });
});

describe("decideFalseCallSpike", () => {
  const base = { recentTotal: 100, baselineTotal: 500, recentNtfRatePct: 14, baselineNtfRatePct: 3 };

  it("fires request_threshold_review on an NTF-rate spike (factor + abs floor)", () => {
    const d = decideFalseCallSpike(7, base, CFG);
    expect(d.reason).toBe("OK");
    expect(d.draft?.tool).toBe("request_threshold_review");
    expect(d.draft?.args).toMatchObject({ machineId: 7, maxPoints: 3 });
  });

  it("mentions the corrections rate when W7-B's table supplied one", () => {
    const d = decideFalseCallSpike(7, { ...base, recentCorrectionsRatePct: 12.3 }, CFG);
    expect(d.draft?.rationale).toContain("12.3%");
  });

  it("zero baseline: fires only on the absolute floor", () => {
    expect(decideFalseCallSpike(7, { ...base, baselineNtfRatePct: 0, recentNtfRatePct: 6 }, CFG).reason).toBe("OK");
    expect(decideFalseCallSpike(7, { ...base, baselineNtfRatePct: 0, recentNtfRatePct: 3 }, CFG).reason).toBe("NO_NTF_SPIKE");
  });

  it("refuses a jump below the factor or the absolute floor", () => {
    // factor ok (4× > 2×) but abs jump 3 pts < 5 pts
    expect(decideFalseCallSpike(7, { ...base, baselineNtfRatePct: 1, recentNtfRatePct: 4 }, CFG).reason).toBe("NO_NTF_SPIKE");
    // abs jump 6 pts but factor 1.6× < 2×
    expect(decideFalseCallSpike(7, { ...base, baselineNtfRatePct: 10, recentNtfRatePct: 16 }, CFG).reason).toBe("NO_NTF_SPIKE");
  });
});

describe("decideMachineDrift", () => {
  it("fires create_maintenance_workorder on Cpk decline below the floor", () => {
    const d = decideMachineDrift(7, { recentCpk: 0.9, baselineCpk: 1.5 }, CFG);
    expect(d.reason).toBe("OK");
    expect(d.draft?.tool).toBe("create_maintenance_workorder");
    expect(d.draft?.args).toMatchObject({ machineId: 7, type: "INSPECTION", priority: 3 });
  });

  it("refuses when Cpk data is missing (honest — no fabricated trend)", () => {
    expect(decideMachineDrift(7, { recentCpk: null, baselineCpk: 1.5 }, CFG).reason).toBe("NO_CPK_DATA");
  });

  it("refuses when the decline is immaterial or recent Cpk is still good", () => {
    expect(decideMachineDrift(7, { recentCpk: 1.3, baselineCpk: 1.4 }, CFG).reason).toBe("NO_MATERIAL_CPK_DECLINE");
    expect(decideMachineDrift(7, { recentCpk: 1.5, baselineCpk: 2.0 }, CFG).reason).toBe("RECENT_CPK_STILL_GOOD");
  });
});

// ── Sweep orchestration + cooldown dedup ─────────────────────────────────────

describe("runAdvancedTriggerSweep", () => {
  it("proposes ONE yield_drop draft for a seeded machine, then dedupes within the cooldown", async () => {
    // recent 80% yield vs baseline 98% → material drop; NTF stays flat (no spike).
    metricsRows = [
      {
        machine_id: 1,
        machine_code: "M1",
        recent_total: 100,
        recent_pass: 80,
        recent_ntf: 2,
        base_total: 500,
        base_pass: 490,
        base_ntf: 5,
      },
    ];
    const t0 = Date.now();
    const s1 = await runAdvancedTriggerSweep(t0);
    expect(s1.byTrigger.yield_drop).toBe(1);
    expect(s1.byTrigger.false_call_spike).toBeUndefined();
    expect(proposeAction).toHaveBeenCalledTimes(1);
    expect(proposeAction.mock.calls[0][0].name).toBe("run_rca_analysis");

    // Second sweep inside the cooldown → deduped, nothing new proposed.
    const s2 = await runAdvancedTriggerSweep(t0 + 60_000);
    expect(s2.proposed).toBe(0);
    expect(proposeAction).toHaveBeenCalledTimes(1);

    // After the cooldown expires the same condition may fire again.
    const s3 = await runAdvancedTriggerSweep(t0 + 25 * 60 * 60 * 1000);
    expect(s3.byTrigger.yield_drop).toBe(1);
    expect(proposeAction).toHaveBeenCalledTimes(2);
  });

  it("proposes false_call_spike and machine_drift independently", async () => {
    // Yield healthy; NTF spikes 2% → 14%; Cpk declines 1.6 → 0.9.
    metricsRows = [
      {
        machine_id: 2,
        machine_code: "M2",
        recent_total: 200,
        recent_pass: 196,
        recent_ntf: 28, // 14%
        base_total: 1000,
        base_pass: 985,
        base_ntf: 20, // 2%
      },
    ];
    // Window-aware (call ORDER inside Promise.all is not guaranteed): the recent
    // window is 24h long, the baseline one 7d — return 0.9 recent / 1.6 baseline.
    getControlChart.mockImplementation(async (filter: any) => {
      const spanH = (filter.endDate.getTime() - filter.startDate.getTime()) / 3600_000;
      return { summary: { cpk: spanH <= 25 ? 0.9 : 1.6 } } as any;
    });
    const s = await runAdvancedTriggerSweep(Date.now());
    expect(s.byTrigger.false_call_spike).toBe(1);
    expect(s.byTrigger.machine_drift).toBe(1);
    expect(s.byTrigger.yield_drop).toBeUndefined();
    const proposedTools = proposeAction.mock.calls.map((c: any[]) => c[0].name).sort();
    expect(proposedTools).toEqual(["create_maintenance_workorder", "request_threshold_review"]);
  });

  it("is a safe no-op when AI_AUTO_PROPOSE_ENABLED is off", async () => {
    process.env.AI_AUTO_PROPOSE_ENABLED = "false";
    metricsRows = [{ machine_id: 3, machine_code: "M3", recent_total: 100, recent_pass: 10, recent_ntf: 0, base_total: 500, base_pass: 495, base_ntf: 0 }];
    const s = await runAdvancedTriggerSweep(Date.now());
    expect(s.machinesConsidered).toBe(0);
    expect(proposeAction).not.toHaveBeenCalled();
  });

  it("advancedTriggerConfig falls back to safe defaults", () => {
    const cfg = advancedTriggerConfig();
    expect(cfg.minRecentSamples).toBeGreaterThan(0);
    expect(cfg.yieldDropPct).toBeGreaterThan(0);
    expect(cfg.cpkFloor).toBeGreaterThan(0);
  });
});
