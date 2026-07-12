// doc 44 W5-A1 (G4.1) — twin fidelity loop: pure decision logic tests.
import { describe, it, expect } from "vitest";
import { evaluateFidelity, decideTrust } from "./twinFidelityService";

describe("evaluateFidelity", () => {
  it("perfect match → fidelity 100%, not breached", () => {
    const e = evaluateFidelity(
      { predictedThroughputPerHour: 100, predictedCycleSec: 40, actualThroughputPerHour: 100, actualCycleSec: 40 },
      0.1,
    );
    expect(e.breached).toBe(false);
    expect(e.fidelityPct).toBe(100);
    expect(e.throughputErrPct).toBe(0);
    expect(e.cycleErrPct).toBe(0);
    expect(e.drifted).toEqual([]);
  });

  it("5% error on both → within 10% threshold, still ok", () => {
    const e = evaluateFidelity(
      { predictedThroughputPerHour: 105, predictedCycleSec: 42, actualThroughputPerHour: 100, actualCycleSec: 40 },
      0.1,
    );
    expect(e.breached).toBe(false);
    expect(e.throughputErrPct).toBeCloseTo(0.05, 5);
    expect(e.cycleErrPct).toBeCloseTo(0.05, 5);
    expect(e.fidelityPct).toBeCloseTo(95, 5);
  });

  it("throughput off 25% → breached, drifted lists throughput", () => {
    const e = evaluateFidelity(
      { predictedThroughputPerHour: 125, predictedCycleSec: 40, actualThroughputPerHour: 100, actualCycleSec: 40 },
      0.1,
    );
    expect(e.breached).toBe(true);
    expect(e.drifted).toContain("throughput_per_hour");
    expect(e.drifted).not.toContain("cycle_time_sec");
    expect(e.fidelityPct).toBeCloseTo(75, 5);
  });

  it("real=0, sim>0 → Infinity error → fidelity 0, breached", () => {
    const e = evaluateFidelity(
      { predictedThroughputPerHour: 100, predictedCycleSec: 40, actualThroughputPerHour: 0, actualCycleSec: 40 },
      0.1,
    );
    expect(e.breached).toBe(true);
    expect(e.fidelityPct).toBe(0);
  });
});

describe("decideTrust", () => {
  const good = evaluateFidelity(
    { predictedThroughputPerHour: 100, predictedCycleSec: 40, actualThroughputPerHour: 100, actualCycleSec: 40 },
    0.1,
  );
  const bad = evaluateFidelity(
    { predictedThroughputPerHour: 130, predictedCycleSec: 40, actualThroughputPerHour: 100, actualCycleSec: 40 },
    0.1,
  );

  it("good check → trusted, breaches reset to 0", () => {
    const d = decideTrust(good, { trusted: false, consecutiveBreaches: 5 }, 2);
    expect(d.trusted).toBe(true);
    expect(d.consecutiveBreaches).toBe(0);
    expect(d.newlyUntrusted).toBe(false);
  });

  it("first breach with limit 2 → still trusted, no alert", () => {
    const d = decideTrust(bad, { trusted: true, consecutiveBreaches: 0 }, 2);
    expect(d.trusted).toBe(true);
    expect(d.consecutiveBreaches).toBe(1);
    expect(d.newlyUntrusted).toBe(false);
  });

  it("second consecutive breach → UNTRUSTED, newlyUntrusted fires ONCE", () => {
    const d = decideTrust(bad, { trusted: true, consecutiveBreaches: 1 }, 2);
    expect(d.trusted).toBe(false);
    expect(d.consecutiveBreaches).toBe(2);
    expect(d.newlyUntrusted).toBe(true);
  });

  it("already untrusted + another breach → still untrusted, newlyUntrusted false (no re-alert)", () => {
    const d = decideTrust(bad, { trusted: false, consecutiveBreaches: 2 }, 2);
    expect(d.trusted).toBe(false);
    expect(d.newlyUntrusted).toBe(false);
    expect(d.consecutiveBreaches).toBe(3);
  });

  it("breachLimit 1 → a single breach untrusts immediately", () => {
    const d = decideTrust(bad, { trusted: true, consecutiveBreaches: 0 }, 1);
    expect(d.trusted).toBe(false);
    expect(d.newlyUntrusted).toBe(true);
  });
});
