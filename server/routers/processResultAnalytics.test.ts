// doc 56 Đ3 — ProcessAnalytics router: flag gating + helper wiring.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const stats = vi.fn(async () => ({ pass: 10, fail: 2, warn: 1, skip: 0 }));
const series = vi.fn(async () => [{ bucket: "2026-07-17T00:00:00.000Z", ts: 1, value: 12.1, samples: 5 }]);
const steps = vi.fn(async () => [{ code: "screw_tightening", nameVi: "Siết vít", machineType: null }]);
// doc 56 Đ5 — new helpers.
const points = vi.fn(async () =>
  Array.from({ length: 8 }, (_, i) => ({ value: 12 + (i % 2 ? 0.05 : -0.05), measuredAt: new Date(2026, 6, 18, 0, 0, i) })),
);
const byType = vi.fn(async () => [{ machineType: "SCREWDRIVE", pass: 8, fail: 2, warn: 0, skip: 0, total: 10 }]);
const refresh = vi.fn(async () => 3);
const daily = vi.fn(async () => [{ day: "2026-07-18", machineId: 1, machineType: "SCREWDRIVE", stepType: "screw_tightening", pass: 8, fail: 2, warn: 0, skip: 0, total: 10, firstPassYield: 0.8 }]);
const telemetry = vi.fn(async () => [{ ts: 1, value: 31.4 }]);

vi.mock("../db/processResult", () => ({
  listProcessResultsBySerial: vi.fn(async () => []),
  aggregateProcessResultStats: (...a: unknown[]) => stats(...a),
  getProcessMetricSeries: (...a: unknown[]) => series(...a),
  getProcessMetricPoints: (...a: unknown[]) => points(...a),
  aggregateProcessResultStatsByType: (...a: unknown[]) => byType(...a),
  refreshProcessResultDaily: (...a: unknown[]) => refresh(...a),
  readProcessResultDaily: (...a: unknown[]) => daily(...a),
  listActiveStepTypes: (...a: unknown[]) => steps(...a),
}));
vi.mock("../db/otTelemetry", () => ({ getTelemetrySeries: (...a: unknown[]) => telemetry(...a) }));
vi.mock("../services/processResultService", () => ({ recordProcessResult: vi.fn() }));

const importRouter = async () => (await import("./processResultRouter")).processResultRouter;
const ctx = { user: { id: 1 } } as never;

describe("processResult analytics — PROCESS_ANALYTICS_ENABLED gating", () => {
  beforeEach(() => {
    stats.mockClear();
    series.mockClear();
    steps.mockClear();
    points.mockClear();
    byType.mockClear();
    refresh.mockClear();
    daily.mockClear();
    telemetry.mockClear();
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

  it("Đ5 OFF (default) → spcChart/fleetRollup/envSeries/dailyRollup/refreshDaily all inert", async () => {
    delete process.env.PROCESS_ANALYTICS_ENABLED;
    const caller = (await importRouter()).createCaller(ctx);
    expect(await caller.spcChart({ metricKey: "torque" })).toMatchObject({ ok: false, points: [] });
    expect(await caller.fleetRollup({})).toEqual([]);
    expect(await caller.envSeries({ machineId: 244, tagKey: "temperature" })).toEqual([]);
    expect(await caller.dailyRollup({})).toEqual([]);
    expect(await caller.refreshDaily({})).toEqual({ written: 0, enabled: false });
    expect(points).not.toHaveBeenCalled();
    expect(byType).not.toHaveBeenCalled();
    expect(telemetry).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("Đ5 ON → spcChart builds an I-MR chart; fleetRollup tags deviceClass; mart refresh/read wired", async () => {
    process.env.PROCESS_ANALYTICS_ENABLED = "true";
    const caller = (await importRouter()).createCaller(ctx);

    const chart = await caller.spcChart({ machineId: 243, metricKey: "torque", usl: 13.5, lsl: 10.5 });
    expect(points).toHaveBeenCalledOnce();
    expect(chart.ok).toBe(true);
    expect(chart.n).toBe(8);
    expect(chart.limits).not.toBeNull();
    expect(chart.limits!.UCL).toBeGreaterThan(chart.limits!.CL);
    expect(chart.capability).not.toBeNull(); // usl/lsl supplied

    const fleet = await caller.fleetRollup({ sinceDays: 30 });
    expect(byType).toHaveBeenCalledOnce();
    expect(fleet[0].machineType).toBe("SCREWDRIVE");
    expect(fleet[0].deviceClass).toBe("automation"); // DEVICE_CLASS_BY_TYPE[SCREWDRIVE]
    expect(fleet[0].firstPassYield).toBeCloseTo(0.8, 5);

    const written = await caller.refreshDaily({ sinceDays: 14 });
    expect(refresh).toHaveBeenCalledWith(14);
    expect(written).toEqual({ written: 3, enabled: true });

    const rollup = await caller.dailyRollup({ machineId: 243 });
    expect(daily).toHaveBeenCalledOnce();
    expect(rollup[0].firstPassYield).toBe(0.8);

    const env = await caller.envSeries({ machineId: 244, tagKey: "temperature", sinceDays: 3 });
    expect(telemetry).toHaveBeenCalledOnce();
    expect(env).toEqual([{ ts: 1, value: 31.4 }]);
  });
});
