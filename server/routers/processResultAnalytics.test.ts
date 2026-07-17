// doc 56 Đ3 — ProcessAnalytics router: flag gating + helper wiring.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const stats = vi.fn(async () => ({ pass: 10, fail: 2, warn: 1, skip: 0 }));
const series = vi.fn(async () => [{ bucket: "2026-07-17T00:00:00.000Z", ts: 1, value: 12.1, samples: 5 }]);
const steps = vi.fn(async () => [{ code: "screw_tightening", nameVi: "Siết vít", machineType: null }]);

vi.mock("../db/processResult", () => ({
  listProcessResultsBySerial: vi.fn(async () => []),
  aggregateProcessResultStats: (...a: unknown[]) => stats(...a),
  getProcessMetricSeries: (...a: unknown[]) => series(...a),
  listActiveStepTypes: (...a: unknown[]) => steps(...a),
}));
vi.mock("../services/processResultService", () => ({ recordProcessResult: vi.fn() }));

const importRouter = async () => (await import("./processResultRouter")).processResultRouter;
const ctx = { user: { id: 1 } } as never;

describe("processResult analytics — PROCESS_ANALYTICS_ENABLED gating", () => {
  beforeEach(() => {
    stats.mockClear();
    series.mockClear();
    steps.mockClear();
  });
  afterEach(() => {
    delete process.env.PROCESS_ANALYTICS_ENABLED;
    vi.resetModules();
  });

  it("OFF (default) → empty results, helpers NOT called (ship-dark)", async () => {
    delete process.env.PROCESS_ANALYTICS_ENABLED;
    const caller = (await importRouter()).createCaller(ctx);
    expect(await caller.stats({ machineId: 5 })).toEqual({ pass: 0, fail: 0, warn: 0, skip: 0 });
    expect(await caller.metricSeries({ machineId: 5, metricKey: "torque" })).toEqual([]);
    expect(await caller.stepTypes()).toEqual([]);
    expect(stats).not.toHaveBeenCalled();
    expect(series).not.toHaveBeenCalled();
    expect(steps).not.toHaveBeenCalled();
  });

  it("ON → wires the aggregate helpers with a resolved `since` window", async () => {
    process.env.PROCESS_ANALYTICS_ENABLED = "true";
    const caller = (await importRouter()).createCaller(ctx);

    const s = await caller.stats({ machineId: 5, stepType: "screw_tightening", sinceDays: 3 });
    expect(s).toEqual({ pass: 10, fail: 2, warn: 1, skip: 0 });
    expect(stats).toHaveBeenCalledOnce();
    const statsArg = stats.mock.calls[0][0] as { machineId?: number; stepType?: string; since: Date };
    expect(statsArg.machineId).toBe(5);
    expect(statsArg.stepType).toBe("screw_tightening");
    expect(statsArg.since).toBeInstanceOf(Date);

    const ms = await caller.metricSeries({ machineId: 5, metricKey: "torque", bucket: "day" });
    expect(ms).toHaveLength(1);
    expect((series.mock.calls[0][0] as { metricKey: string; bucket?: string }).metricKey).toBe("torque");
    expect((series.mock.calls[0][0] as { bucket?: string }).bucket).toBe("day");

    const st = await caller.stepTypes({ machineType: "SCREWDRIVE" });
    expect(st).toHaveLength(1);
    expect((steps.mock.calls[0] as unknown[])[0]).toBe("SCREWDRIVE");
  });
});
