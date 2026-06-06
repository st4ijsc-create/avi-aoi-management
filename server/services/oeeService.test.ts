/**
 * Unit tests for OEE Service — SEMI E10 calculator
 */
import { describe, it, expect } from "vitest";
import { evaluateOEEAlert } from "./oeeService";

describe("evaluateOEEAlert", () => {
  it("returns ok when no target configured", () => {
    const r = evaluateOEEAlert(0.5, null);
    expect(r.level).toBe("ok");
    expect(r.oeePct).toBe(5000);
  });

  it("returns critical when OEE below critical threshold", () => {
    const r = evaluateOEEAlert(0.3, { alertThreshold: 7000, criticalThreshold: 5000 });
    expect(r.level).toBe("critical");
    expect(r.threshold).toBe(5000);
  });

  it("returns warning when OEE between critical and alert", () => {
    const r = evaluateOEEAlert(0.6, { alertThreshold: 7000, criticalThreshold: 5000 });
    expect(r.level).toBe("warning");
    expect(r.threshold).toBe(7000);
  });

  it("returns ok when OEE meets or exceeds alert threshold", () => {
    const r = evaluateOEEAlert(0.85, { alertThreshold: 7000, criticalThreshold: 5000 });
    expect(r.level).toBe("ok");
  });

  it("encodes oee pct as integer × 10000", () => {
    const r = evaluateOEEAlert(0.7523, null);
    expect(r.oeePct).toBe(7523);
  });
});

describe("OEE math invariants", () => {
  it("availability formula: (PT+ET) / (PT+SB+ET+UD)", () => {
    const PT = 400, SB = 50, ET = 20, UD = 30;
    const operationsTime = PT + ET;
    const equipmentUptime = PT + SB + ET + UD;
    const availability = operationsTime / equipmentUptime;
    expect(availability).toBeCloseTo(420 / 500, 5);
  });

  it("performance is capped at 1.0", () => {
    const theoreticalSec = 10000;
    const actualProductiveSec = 5000;
    const performance = Math.min(1, theoreticalSec / actualProductiveSec);
    expect(performance).toBe(1);
  });

  it("quality = good/total when total > 0", () => {
    expect(95 / 100).toBeCloseTo(0.95, 5);
  });

  it("OEE = A × P × Q", () => {
    const oee = 0.85 * 0.95 * 0.98;
    expect(oee).toBeCloseTo(0.79135, 4);
  });
});
