/**
 * G4.8 (doc 44 W5-B3) — unit tests for the failure-mode classifier scaffold.
 *
 * PURE signal math (RMS / kurtosis / FFT dominant frequency) on synthetic signals;
 * spectral classification of imbalance / misalignment / bearing signatures; and —
 * the load-bearing honesty guarantee — NO vibration sensor ⇒ mode 'unknown',
 * reason 'no vibration sensor' (never a fabricated verdict).
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  computeRms,
  computeKurtosis,
  spectralFeatures,
  classifyFailureMode,
  classifyFailureModeFromSensorReadings,
  classifyForMachine,
  type SensorReadingRow,
} from "./failureModeClassifier";
import type { TimeSeriesPoint } from "../aiTimeSeriesEngine";

const FS = 256; // Hz — sample rate
const N = 256; // power-of-two window
const DT_MS = 1000 / FS;
const START = 1_700_000_000_000;

/** Build a vibration series from a per-index value function. */
function buildVib(valueAt: (i: number, tSec: number) => number, n = N): TimeSeriesPoint[] {
  const pts: TimeSeriesPoint[] = [];
  for (let i = 0; i < n; i++) pts.push({ timestamp: START + i * DT_MS, value: valueAt(i, i / FS) });
  return pts;
}

describe("signal features", () => {
  it("computeRms matches the closed form", () => {
    expect(computeRms([3, 4])).toBeCloseTo(Math.sqrt(12.5), 6);
    expect(computeRms([0, 0, 0])).toBe(0);
  });

  it("computeKurtosis is 0 for a constant series and high for an impulsive one", () => {
    expect(computeKurtosis([5, 5, 5, 5])).toBe(0);
    const impulsive = Array.from({ length: 128 }, (_, i) => (i % 16 === 0 ? 10 : 0.05));
    expect(computeKurtosis(impulsive)).toBeGreaterThan(5); // heavy tails
  });

  it("FFT dominant frequency recovers a bin-aligned sinusoid (20 Hz)", () => {
    const f0 = 20; // exact bin (df = FS/N = 1 Hz)
    const series = buildVib((_i, t) => 5 + Math.sin(2 * Math.PI * f0 * t)); // + DC to test removal
    const f = spectralFeatures(series);
    expect(f.sampleRateHz).toBeCloseTo(FS, 3);
    expect(f.freqResolutionHz).toBeCloseTo(1, 6);
    expect(f.peakFreqHz).toBeCloseTo(f0, 6);
  });
});

describe("classifyFailureMode — HONEST unknown without vibration", () => {
  it("empty vibration → unknown / 'no vibration sensor'", () => {
    const r = classifyFailureMode({ vibration: [] });
    expect(r.mode).toBe("unknown");
    expect(r.reason).toBe("no vibration sensor");
    expect(r.confidence).toBe(0);
  });

  it("too-few vibration samples → unknown (no guessing on thin data)", () => {
    const short = buildVib((_i, t) => Math.sin(2 * Math.PI * 20 * t), 16);
    const r = classifyFailureMode({ vibration: short });
    expect(r.mode).toBe("unknown");
  });

  it("sensor readings with NO vibration tag → unknown / 'no vibration sensor'", () => {
    const rows: SensorReadingRow[] = Array.from({ length: 64 }, (_, i) => ({
      sensorType: "motor_current",
      value: 10 + Math.sin(i),
      timestamp: START + i * DT_MS,
    }));
    const r = classifyFailureModeFromSensorReadings(rows);
    expect(r.mode).toBe("unknown");
    expect(r.reason).toBe("no vibration sensor");
  });
});

describe("classifyFailureMode — spectral verdicts (vibration present)", () => {
  it("dominant 1× peak, weak harmonics → imbalance", () => {
    const series = buildVib((_i, t) => Math.sin(2 * Math.PI * 20 * t));
    const r = classifyFailureMode({ vibration: series, rotationHz: 20 });
    expect(r.mode).toBe("imbalance");
    expect(r.confidence).toBeGreaterThan(0.35);
  });

  it("strong 2× harmonic vs 1× → shaft_misalignment", () => {
    const series = buildVib((_i, t) => 0.3 * Math.sin(2 * Math.PI * 20 * t) + 1.0 * Math.sin(2 * Math.PI * 40 * t));
    const r = classifyFailureMode({ vibration: series, rotationHz: 20 });
    expect(r.mode).toBe("shaft_misalignment");
    expect(r.confidence).toBeGreaterThan(0.35);
  });

  it("impulsive broadband (high kurtosis) with no running speed → bearing_wear", () => {
    // periodic sharp impulses (bearing defect) on a low background sinusoid
    const series = buildVib((i, t) => 0.1 * Math.sin(2 * Math.PI * 10 * t) + (i % 16 === 0 ? 10 : 0));
    const r = classifyFailureMode({ vibration: series }); // no rotationHz
    expect(r.mode).toBe("bearing_wear");
    expect(r.features).not.toBeNull();
    expect(r.features!.kurtosis).toBeGreaterThan(2);
  });

  it("no vibration but an upward temperature change-point → overheating", () => {
    const temperature: TimeSeriesPoint[] = Array.from({ length: 24 }, (_, i) => ({
      timestamp: START + i * 60_000,
      value: (i < 12 ? 45 : 70) + (i % 2) * 0.5,
    }));
    const r = classifyFailureMode({ vibration: [], temperature });
    expect(r.mode).toBe("overheating");
    expect(r.confidence).toBeGreaterThan(0);
  });
});

describe("classifyForMachine — flag gating", () => {
  const prev = process.env.FAILURE_MODE_ENABLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.FAILURE_MODE_ENABLED;
    else process.env.FAILURE_MODE_ENABLED = prev;
  });

  it("returns null when FAILURE_MODE_ENABLED is off", () => {
    delete process.env.FAILURE_MODE_ENABLED;
    const rows: SensorReadingRow[] = [{ sensorType: "vibration", value: 1, timestamp: START }];
    expect(classifyForMachine(rows)).toBeNull();
  });

  it("classifies when the flag is on (honest unknown here — thin data)", () => {
    process.env.FAILURE_MODE_ENABLED = "true";
    const rows: SensorReadingRow[] = [{ sensorType: "current", value: 1, timestamp: START }];
    const r = classifyForMachine(rows);
    expect(r).not.toBeNull();
    expect(r!.mode).toBe("unknown");
    expect(r!.reason).toBe("no vibration sensor");
  });
});
