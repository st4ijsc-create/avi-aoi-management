/**
 * doc 44 W2-A3 — G1.4 report-by-exception per tag (deadband + samplingMs) tests.
 *
 * Exercises the EXPORTED sink factory `makeDeadbandSink` + pure decision
 * `shouldForwardSample` (no driver/DB needed; fake timers drive Date.now()):
 *   - flag OFF (default) → pure pass-through (every sample forwarded, no stats)
 *   - first value ALWAYS forwarded
 *   - samplingMs throttle: suppressed inside the window, forwarded after
 *   - deadband: |Δ| < deadband suppressed, |Δ| ≥ deadband forwarded
 *   - quality change ALWAYS forwarded (even inside window / below deadband)
 *   - non-number value ALWAYS forwarded
 *   - heartbeat (DEADBAND_HEARTBEAT_MS) forces a forward → liveness kept
 *   - unconfigured tag (no deadband/samplingMs) → old behaviour (all forwarded)
 *   - suppressed/forwarded counters exposed via getDeadbandStats
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  makeDeadbandSink,
  shouldForwardSample,
  getDeadbandStats,
  listDeadbandStats,
  _resetDeadbandStatsForTests,
  deadbandHeartbeatMs,
  DEADBAND_HEARTBEAT_MS,
} from "./otManager";
import type { RuntimeAdapter } from "./deviceAdapter";
import type { OtSample, OtQuality } from "./otDriver";

function makeAdapter(): RuntimeAdapter {
  return {
    adapterId: 1,
    code: "DB-A1",
    machineId: null,
    protocol: "stub",
    connection: { endpoint: "stub://" },
    pollIntervalMs: 1000,
    tags: [
      { tagKey: "temp", address: "t", dataType: "float", deadband: 0.5, samplingMs: 100 },
      { tagKey: "pressure", address: "p", dataType: "float", deadband: 2 }, // deadband only
      { tagKey: "count", address: "c", dataType: "int", samplingMs: 100 }, // sampling only
      { tagKey: "state", address: "s", dataType: "string" }, // unconfigured
    ],
    driver: {} as never,
  };
}

function sample(tagKey: string, value: number | string | boolean | null, quality: OtQuality = "good"): OtSample {
  return { tagKey, raw: value, value, quality, timestamp: new Date() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  _resetDeadbandStatsForTests();
  delete process.env.OT_TAG_DEADBAND_ENABLED;
  delete process.env.DEADBAND_HEARTBEAT_MS;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("G1.4 — flag OFF (default): pass-through", () => {
  it("forwards EVERY sample untouched and records no stats", () => {
    const next = vi.fn();
    const sink = makeDeadbandSink(makeAdapter(), next);
    sink(sample("temp", 20));
    sink(sample("temp", 20)); // identical, inside any window — still forwarded
    sink(sample("temp", 20.001));
    expect(next).toHaveBeenCalledTimes(3);
    expect(getDeadbandStats(1)).toBeUndefined();
  });
});

describe("G1.4 — flag ON: report-by-exception", () => {
  beforeEach(() => {
    process.env.OT_TAG_DEADBAND_ENABLED = "true";
  });

  it("first value is ALWAYS forwarded", () => {
    const next = vi.fn();
    const sink = makeDeadbandSink(makeAdapter(), next);
    sink(sample("temp", 20));
    expect(next).toHaveBeenCalledTimes(1);
    expect(getDeadbandStats(1)).toMatchObject({ forwarded: 1, suppressed: 0 });
  });

  it("samplingMs throttles: suppressed inside the window, forwarded after it elapsed", () => {
    const next = vi.fn();
    const sink = makeDeadbandSink(makeAdapter(), next);
    sink(sample("count", 1)); // first → forward
    vi.advanceTimersByTime(50);
    sink(sample("count", 2)); // inside 100ms window → suppress (sampling-only tag)
    expect(next).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60); // 110ms since last forward
    sink(sample("count", 3)); // window elapsed → forward
    expect(next).toHaveBeenCalledTimes(2);
    expect(getDeadbandStats(1)).toMatchObject({ forwarded: 2, suppressed: 1 });
  });

  it("deadband: |Δ| < deadband suppressed; |Δ| ≥ deadband forwarded (vs last FORWARDED value)", () => {
    const next = vi.fn();
    const sink = makeDeadbandSink(makeAdapter(), next);
    sink(sample("pressure", 100)); // first → forward
    vi.advanceTimersByTime(10);
    sink(sample("pressure", 101)); // Δ=1 < 2 → suppress
    vi.advanceTimersByTime(10);
    sink(sample("pressure", 101.9)); // Δ vs 100 = 1.9 < 2 → suppress
    expect(next).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10);
    sink(sample("pressure", 102)); // Δ vs 100 = 2 ≥ 2 → forward
    expect(next).toHaveBeenCalledTimes(2);
    expect(next.mock.calls[1][0].value).toBe(102);
    expect(getDeadbandStats(1)).toMatchObject({ forwarded: 2, suppressed: 2 });
  });

  it("sampling + deadband combined: BOTH must pass", () => {
    const next = vi.fn();
    const sink = makeDeadbandSink(makeAdapter(), next);
    sink(sample("temp", 20)); // forward
    vi.advanceTimersByTime(50);
    sink(sample("temp", 25)); // big Δ but inside 100ms window → suppress
    expect(next).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60);
    sink(sample("temp", 20.1)); // window elapsed but Δ=0.1 < 0.5 → suppress
    expect(next).toHaveBeenCalledTimes(1);
    sink(sample("temp", 21)); // window elapsed AND Δ=1 ≥ 0.5 → forward
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("quality change is ALWAYS forwarded (inside window, below deadband)", () => {
    const next = vi.fn();
    const sink = makeDeadbandSink(makeAdapter(), next);
    sink(sample("temp", 20, "good"));
    vi.advanceTimersByTime(10);
    sink(sample("temp", 20, "bad")); // same value, inside window — quality flip → forward
    expect(next).toHaveBeenCalledTimes(2);
    expect(next.mock.calls[1][0].quality).toBe("bad");
  });

  it("non-number value is ALWAYS forwarded", () => {
    const next = vi.fn();
    const sink = makeDeadbandSink(makeAdapter(), next);
    sink(sample("temp", 20));
    vi.advanceTimersByTime(10);
    sink(sample("temp", "ERROR")); // type flip → forward (deadband meaningless)
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("heartbeat forces a forward after DEADBAND_HEARTBEAT_MS (liveness kept)", () => {
    process.env.DEADBAND_HEARTBEAT_MS = "200";
    const next = vi.fn();
    const sink = makeDeadbandSink(makeAdapter(), next);
    sink(sample("pressure", 100)); // forward
    vi.advanceTimersByTime(150);
    sink(sample("pressure", 100)); // unchanged, before heartbeat → suppress
    expect(next).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60); // 210ms since last forward ≥ 200ms heartbeat
    sink(sample("pressure", 100)); // unchanged but heartbeat due → forward
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("unconfigured tag keeps the old behaviour (every sample forwarded)", () => {
    const next = vi.fn();
    const sink = makeDeadbandSink(makeAdapter(), next);
    sink(sample("state", "RUN"));
    vi.advanceTimersByTime(1);
    sink(sample("state", "RUN"));
    sink(sample("state", "RUN"));
    expect(next).toHaveBeenCalledTimes(3);
  });

  it("listDeadbandStats exposes per-adapter counters", () => {
    const next = vi.fn();
    const sink = makeDeadbandSink(makeAdapter(), next);
    sink(sample("pressure", 100));
    vi.advanceTimersByTime(10);
    sink(sample("pressure", 100.1)); // suppressed
    const all = listDeadbandStats();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ adapterId: 1, code: "DB-A1", forwarded: 1, suppressed: 1 });
  });
});

describe("G1.4 — shouldForwardSample (pure) edge cases", () => {
  const prev = { lastForwardedAt: 1_000_000, lastValue: 10 as const, lastQuality: "good" as OtQuality };

  it("default heartbeat constant is 60s (env override read at call time)", () => {
    expect(DEADBAND_HEARTBEAT_MS).toBe(60_000);
    expect(deadbandHeartbeatMs()).toBe(60_000);
    process.env.DEADBAND_HEARTBEAT_MS = "1234";
    expect(deadbandHeartbeatMs()).toBe(1234);
  });

  it("clock moving BACKWARDS fails open (forward)", () => {
    const fwd = shouldForwardSample(
      { deadband: 5 }, { ...prev }, { value: 10, quality: "good" }, prev.lastForwardedAt - 1000, 60_000,
    );
    expect(fwd).toBe(true);
  });

  it("previous value not a number (type changed) → deadband cannot compute Δ → forward", () => {
    const fwd = shouldForwardSample(
      { deadband: 5 },
      { lastForwardedAt: 1_000_000, lastValue: "RUN", lastQuality: "good" },
      { value: 10, quality: "good" },
      1_000_010,
      60_000,
    );
    expect(fwd).toBe(true);
  });

  it("invalid config values (0 / negative / NaN) are ignored → forward", () => {
    const now = 1_000_010;
    expect(shouldForwardSample({ deadband: 0 }, { ...prev }, { value: 10, quality: "good" }, now, 60_000)).toBe(true);
    expect(shouldForwardSample({ samplingMs: -5 }, { ...prev }, { value: 10, quality: "good" }, now, 60_000)).toBe(true);
    expect(shouldForwardSample({ deadband: Number.NaN }, { ...prev }, { value: 10, quality: "good" }, now, 60_000)).toBe(true);
  });
});
