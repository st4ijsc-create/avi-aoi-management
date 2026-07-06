/**
 * D2 space-time occupancy tests — SYNAPSE §5.4.3 (doc 33 D2).
 * The DB reserveZone path is covered by the fleet DB-integration suite; here we test the pure
 * time-overlap counting the flag switches the capacity check to.
 */
import { describe, it, expect } from "vitest";

import { overlappingReservationCount } from "./trafficManager";

const row = (deviceId: number, fromMs: number, untilMs: number | null) => ({
  deviceId,
  reservedFrom: new Date(fromMs),
  reservedUntil: untilMs === null ? null : new Date(untilMs),
});

describe("overlappingReservationCount (space-time occupancy)", () => {
  it("counts only reservations whose window overlaps the request (± buffer)", () => {
    const rows = [
      row(1, 0, 10_000), // 0..10s
      row(2, 20_000, 30_000), // 20..30s — disjoint from a 0..10s request
    ];
    // request 0..9s → overlaps only device 1
    expect(overlappingReservationCount(0, 9_000, rows, 0)).toBe(1);
    // request 20..25s → overlaps only device 2
    expect(overlappingReservationCount(20_000, 25_000, rows, 0)).toBe(1);
    // request spanning both → 2
    expect(overlappingReservationCount(0, 30_000, rows, 0)).toBe(2);
  });

  it("an open-ended reservation (null end) conflicts with any window", () => {
    const rows = [row(1, 0, null)]; // open-ended
    expect(overlappingReservationCount(1_000_000, 1_000_100, rows, 0)).toBe(1);
  });

  it("an open-ended REQUEST (null end) conflicts with everything", () => {
    const rows = [row(1, 0, 10_000)];
    expect(overlappingReservationCount(0, null, rows, 0)).toBe(1);
  });

  it("the safety buffer widens the overlap", () => {
    const rows = [row(1, 0, 10_000)];
    expect(overlappingReservationCount(11_000, 12_000, rows, 0)).toBe(0); // 1s gap, no buffer
    expect(overlappingReservationCount(11_000, 12_000, rows, 1500)).toBe(1); // 1.5s buffer bridges it
  });
});
