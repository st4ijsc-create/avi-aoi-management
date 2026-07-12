// doc 44 W5-A2 (G4.21) — material time-to-empty PURE math + honest-null tests.
import { describe, it, expect } from "vitest";
import { computeTimeToEmpty } from "./materialForecastService";

const now = new Date("2026-07-12T00:00:00.000Z");

describe("computeTimeToEmpty", () => {
  it("current 1000, rate 100/h → empties in 10h at the right instant", () => {
    const r = computeTimeToEmpty(1000, 100, now);
    expect(r.status).toBe("ok");
    expect(r.hoursToEmpty).toBe(10);
    expect(r.emptyAt).toBe(new Date("2026-07-12T10:00:00.000Z").toISOString());
  });

  it("fractional rate math", () => {
    const r = computeTimeToEmpty(50, 20, now);
    expect(r.hoursToEmpty).toBeCloseTo(2.5, 6);
  });

  it("honest-null when current_qty unknown → no_current_qty", () => {
    const r = computeTimeToEmpty(null, 100, now);
    expect(r.status).toBe("no_current_qty");
    expect(r.hoursToEmpty).toBeNull();
    expect(r.emptyAt).toBeNull();
  });

  it("no recent consumption (rate 0) → no_consumption, no projection", () => {
    const r = computeTimeToEmpty(1000, 0, now);
    expect(r.status).toBe("no_consumption");
    expect(r.emptyAt).toBeNull();
  });

  it("non-finite inputs → honest-null (no NaN leak)", () => {
    expect(computeTimeToEmpty(Number.NaN, 100, now).status).toBe("no_current_qty");
    expect(computeTimeToEmpty(1000, Number.NaN, now).status).toBe("no_consumption");
    expect(computeTimeToEmpty(1000, -5, now).status).toBe("no_consumption");
  });
});
