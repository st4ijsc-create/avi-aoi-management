/**
 * Tests for W0-D — proactive SPC-alert sweep scheduler.
 *
 * Mirrors aiBatchRcaScheduler's test shape (see
 * server/services/aiPredictiveRcaConverge.test.ts Part 2): a queued
 * db.execute() response list feeds fetchActiveMachines(), and
 * getControlChart/triggerSpcAlerts are mocked at the module boundary — pure
 * orchestration test, no real DB/cron/model.
 *
 * Covers:
 *  (a) active machines with violations → triggerSpcAlerts called with those
 *      violations + correct controlLimits mapping (cl = summary.mean) +
 *      stats.violationsFired correct.
 *  (b) a machine whose getControlChart() throws → sweep continues, `failed`
 *      incremented, other machines still processed.
 *  (c) AI_SPC_ALERT_SWEEP_ENABLED unset (default OFF) → initSpcAlertScheduler()
 *      does NOT schedule a cron job.
 *  (d) AI_SPC_ALERT_SWEEP_ENABLED=true → initSpcAlertScheduler() DOES schedule
 *      (the flip side of (c), proving the gate isn't trivially always-off).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (before importing the SUT) ─────────────────────────────────────────

// db.execute is called once per fetchActiveMachines() call — queued responses
// consumed in call order (mirrors aiPredictiveRcaConverge.test.ts).
let executeResponses: any[][] = [];
let executeCallIndex = 0;
const fakeDb = {
  execute: vi.fn(async () => {
    const r = executeResponses[executeCallIndex] ?? [];
    executeCallIndex++;
    return r;
  }),
};
vi.mock("../db", () => ({ getDb: async () => fakeDb }));

const getControlChart = vi.fn();
const triggerSpcAlerts = vi.fn();
vi.mock("./aiInspectionAnalytics", () => ({
  getControlChart: (...a: any[]) => getControlChart(...a),
  triggerSpcAlerts: (...a: any[]) => triggerSpcAlerts(...a),
}));

const cronScheduleMock = vi.fn(() => ({ stop: vi.fn() }));
vi.mock("node-cron", () => ({ schedule: (...a: any[]) => cronScheduleMock(...a) }));

beforeEach(() => {
  vi.clearAllMocks();
  executeResponses = [];
  executeCallIndex = 0;
});

describe("aiSpcAlertScheduler.runSpcAlertSweepOnce (W0-D)", () => {
  it("(a) fires triggerSpcAlerts for machines with violations, with the correct controlLimits mapping", async () => {
    const { runSpcAlertSweepOnce } = await import("./aiSpcAlertScheduler");
    executeResponses = [[{ id: 7, code: "M-07", ng_count: 3 }]]; // fetchActiveMachines
    const spcViolations = [
      { ruleId: "nelson_1", ruleName: "Beyond 3-sigma", severity: "critical" as const, pointIndices: [4] },
    ];
    getControlChart.mockResolvedValue({
      metric: "defectRate",
      points: [],
      summary: { mean: 5, stdDev: 1, ucl: 8, lcl: 2, cpk: null, outOfControlCount: 1, spcViolations },
    });
    triggerSpcAlerts.mockResolvedValue(undefined);

    const stats = await runSpcAlertSweepOnce();

    expect(getControlChart).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: 7 }),
      "defectRate",
    );
    expect(triggerSpcAlerts).toHaveBeenCalledWith(
      expect.objectContaining({
        violations: spcViolations,
        metric: "defectRate",
        machineId: 7,
        controlLimits: { ucl: 8, lcl: 2, cl: 5 }, // cl = summary.mean
      }),
    );
    expect(stats.machinesSwept).toBe(1);
    expect(stats.violationsFired).toBe(1);
    expect(stats.failed).toBe(0);
  });

  it("(b) a machine whose getControlChart() throws does not abort the sweep — other machines still processed", async () => {
    const { runSpcAlertSweepOnce } = await import("./aiSpcAlertScheduler");
    executeResponses = [[
      { id: 1, code: "M-01", ng_count: 2 },
      { id: 2, code: "M-02", ng_count: 4 },
    ]];
    getControlChart
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        metric: "defectRate",
        points: [],
        summary: { mean: 1, stdDev: 0.2, ucl: 2, lcl: 0, cpk: null, outOfControlCount: 0, spcViolations: [] },
      });
    triggerSpcAlerts.mockResolvedValue(undefined);

    const stats = await runSpcAlertSweepOnce();

    expect(getControlChart).toHaveBeenCalledTimes(2);
    expect(stats.machinesSwept).toBe(2);
    expect(stats.failed).toBe(1);
    // Second machine had zero violations → triggerSpcAlerts never called for it.
    expect(triggerSpcAlerts).not.toHaveBeenCalled();
  });

  it("skips machines with zero violations without calling triggerSpcAlerts", async () => {
    const { runSpcAlertSweepOnce } = await import("./aiSpcAlertScheduler");
    executeResponses = [[{ id: 9, code: "M-09", ng_count: 1 }]];
    getControlChart.mockResolvedValue({
      metric: "defectRate",
      points: [],
      summary: { mean: 1, stdDev: 0.1, ucl: 1.3, lcl: 0.7, cpk: null, outOfControlCount: 0, spcViolations: [] },
    });

    const stats = await runSpcAlertSweepOnce();

    expect(triggerSpcAlerts).not.toHaveBeenCalled();
    expect(stats.violationsFired).toBe(0);
    expect(stats.failed).toBe(0);
  });
});

describe("aiSpcAlertScheduler — default-OFF flag gate (W0-D)", () => {
  const savedFlag = process.env.AI_SPC_ALERT_SWEEP_ENABLED;

  afterEach(() => {
    if (savedFlag === undefined) delete process.env.AI_SPC_ALERT_SWEEP_ENABLED;
    else process.env.AI_SPC_ALERT_SWEEP_ENABLED = savedFlag;
  });

  it("(c) AI_SPC_ALERT_SWEEP_ENABLED unset (default) → initSpcAlertScheduler() does NOT schedule a cron job", async () => {
    delete process.env.AI_SPC_ALERT_SWEEP_ENABLED;
    vi.resetModules();
    const mod = await import("./aiSpcAlertScheduler");

    mod.initSpcAlertScheduler();

    expect(cronScheduleMock).not.toHaveBeenCalled();
    expect(mod.getSpcAlertStatus().enabled).toBe(false);
    expect(mod.getSpcAlertStatus().running).toBe(false);
  });

  it("(d) AI_SPC_ALERT_SWEEP_ENABLED=true → initSpcAlertScheduler() DOES schedule a cron job", async () => {
    process.env.AI_SPC_ALERT_SWEEP_ENABLED = "true";
    vi.resetModules();
    const mod = await import("./aiSpcAlertScheduler");

    mod.initSpcAlertScheduler();

    expect(cronScheduleMock).toHaveBeenCalledTimes(1);
    expect(mod.getSpcAlertStatus().enabled).toBe(true);
    expect(mod.getSpcAlertStatus().running).toBe(true);

    mod.stopSpcAlertScheduler();
    expect(mod.getSpcAlertStatus().running).toBe(false);
  });
});
