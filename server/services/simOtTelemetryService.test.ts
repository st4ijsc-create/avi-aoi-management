/**
 * simOtTelemetryService — PURE unit tests for the tag-generation / identity shape
 * (doc 54 §11 P1.1). No DB: these assert that a machine identity produces the stable
 * canonical sample set that the unified telemetry bus (→ ot_telemetry → presence
 * sweep) consumes, with `machineId` carried through EXACTLY (the column
 * sweepPresenceFromTelemetry JOINs on).
 */
import { describe, it, expect } from "vitest";
import {
  buildTelemetrySamples,
  simIntervalMs,
  SIM_OT_METRICS,
  SIM_OT_MACHINE_STATES,
  type SimMachineIdentity,
} from "./simOtTelemetryService";

const MACHINE: SimMachineIdentity = { machineId: 42, code: "SIM-L1-AOI" };

describe("buildTelemetrySamples", () => {
  it("emits exactly the stable metric set, in order", () => {
    const now = new Date("2026-07-17T03:00:00.000Z");
    const samples = buildTelemetrySamples(MACHINE, now);
    expect(samples.map((s) => s.metric)).toEqual([...SIM_OT_METRICS]);
  });

  it("carries the machineId identity through EVERY sample (the presence JOIN column)", () => {
    const samples = buildTelemetrySamples(MACHINE);
    for (const s of samples) {
      // machineId is provided DIRECTLY so the bus skips deviceId→code resolution and
      // ot_telemetry.machineId === machines.id (what sweepPresenceFromTelemetry joins).
      expect(s.machineId).toBe(42);
      expect(s.deviceId).toBe("SIM-L1-AOI");
    }
  });

  it("stamps every sample with canonical protocol='other' + quality='good' + the same ts", () => {
    const now = new Date("2026-07-17T03:00:00.000Z");
    const samples = buildTelemetrySamples(MACHINE, now);
    for (const s of samples) {
      expect(s.protocol).toBe("other");
      expect(s.quality).toBe("good");
      expect(s.ts).toBe(now);
      expect(s.meta).toMatchObject({ source: "SIM-OT" });
    }
  });

  it("produces plausible, in-range, correctly-typed values for each tag", () => {
    // Run many draws so the random ranges are exercised without a seeded RNG.
    for (let i = 0; i < 200; i++) {
      const byMetric = new Map(buildTelemetrySamples(MACHINE).map((s) => [s.metric, s]));

      expect(byMetric.get("heartbeat")!.value).toBe(1);

      const state = byMetric.get("machine_state")!.value;
      expect(typeof state).toBe("string");
      expect([...new Set<string>(SIM_OT_MACHINE_STATES)]).toContain(state as string);

      const cycle = byMetric.get("cycle_time")!;
      expect(typeof cycle.value).toBe("number");
      expect(cycle.value as number).toBeGreaterThanOrEqual(18);
      expect(cycle.value as number).toBeLessThanOrEqual(40);
      expect(cycle.unit).toBe("s");

      const temp = byMetric.get("temperature")!;
      expect(typeof temp.value).toBe("number");
      expect(temp.value as number).toBeGreaterThanOrEqual(40);
      expect(temp.value as number).toBeLessThanOrEqual(52);
      expect(temp.unit).toBe("°C");
    }
  });

  it("defaults ts to now() when omitted (a real, recent timestamp)", () => {
    const before = Date.now();
    const samples = buildTelemetrySamples(MACHINE);
    const after = Date.now();
    for (const s of samples) {
      expect(s.ts).toBeInstanceOf(Date);
      const t = (s.ts as Date).getTime();
      expect(t).toBeGreaterThanOrEqual(before);
      expect(t).toBeLessThanOrEqual(after);
    }
  });
});

describe("simIntervalMs", () => {
  const saved = process.env.SIM_OT_TELEMETRY_INTERVAL_MS;
  const restore = () => {
    if (saved === undefined) delete process.env.SIM_OT_TELEMETRY_INTERVAL_MS;
    else process.env.SIM_OT_TELEMETRY_INTERVAL_MS = saved;
  };

  it("defaults to 30s and enforces the 5s floor / NaN-safety", () => {
    delete process.env.SIM_OT_TELEMETRY_INTERVAL_MS;
    expect(simIntervalMs()).toBe(30_000);
    process.env.SIM_OT_TELEMETRY_INTERVAL_MS = "4000"; // below floor
    expect(simIntervalMs()).toBe(30_000);
    process.env.SIM_OT_TELEMETRY_INTERVAL_MS = "not-a-number";
    expect(simIntervalMs()).toBe(30_000);
    process.env.SIM_OT_TELEMETRY_INTERVAL_MS = "10000";
    expect(simIntervalMs()).toBe(10_000);
    restore();
  });
});
