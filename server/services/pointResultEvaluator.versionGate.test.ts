/**
 * Doc 51 P2 batch-2 (§12.2 #2) — VERSION-EXACT spec-gate reconstruction.
 *
 * resolveGateLimitsForBoard completes QĐ#2: gate a board by the EXACT product
 * config version the machine declared (measurement_point_versions.
 * productPointsConfigVersion, migration 0282), not by the server-received instant.
 *
 * Every test is a mutation-test: it goes RED if the pick swaps to instant, to live,
 * picks the wrong stamp, or stops falling back safely on unstamped/legacy history.
 */
import { describe, it, expect } from "vitest";
import {
  resolveGateLimitsForBoard,
  type PointLimitSnapshot,
  type PointLimitSource,
} from "./pointResultEvaluator";

const LIVE: PointLimitSource = { upperLimit: "10" };
// Server-received instant for the board (irrelevant to the version path — set so a
// leak to the instant path would pick the WRONG snapshot and fail the assertion).
const T_RECV = new Date("2026-07-15T08:00:00.000Z");

/** Point edited twice. Pre-edit L_a live UNDER product v5 (stamp 5); pre-edit L_b
 *  live under v7 (stamp 7); current live = LIVE (v8+). changedAt is deliberately
 *  the OPPOSITE order to the version order so an instant-leak is detectable. */
function twoEditHistory(): PointLimitSnapshot[] {
  return [
    // L_a: looser, live up to product v5. changedAt LATER in wall-clock on purpose.
    { changedAt: new Date("2026-07-20T00:00:00Z"), limits: { upperLimit: "50" }, productPointsConfigVersion: 5 },
    // L_b: mid, live up to product v7. changedAt EARLIER in wall-clock on purpose.
    { changedAt: new Date("2026-07-10T00:00:00Z"), limits: { upperLimit: "20" }, productPointsConfigVersion: 7 },
  ];
}

describe("resolveGateLimitsForBoard — VERSION-EXACT (0282)", () => {
  it("★ machine declares an OLD version → gates by the snapshot stamped for that era (NOT live, NOT instant)", () => {
    // Board declares v5. It used L_a (upperLimit 50). Live is 10; instant order is
    // scrambled. Only the version pick returns 50.
    const r = resolveGateLimitsForBoard({
      snapshots: twoEditHistory(),
      liveLimits: LIVE,
      declaredVersion: 5,
      atInstant: T_RECV,
    });
    expect(r.basis).toBe("version");
    expect(r.limits).toEqual({ upperLimit: "50" });
    // Distinct from live (10) — a leak to live would make this equal LIVE.
    expect(r.limits).not.toEqual(LIVE);
  });

  it("★ picks the SMALLEST stamp >= declared V (the snapshot that covers V)", () => {
    // Board declares v6. No stamp == 6, but L_b (stamp 7) covers [6,7] → upperLimit 20.
    const r = resolveGateLimitsForBoard({
      snapshots: twoEditHistory(),
      liveLimits: LIVE,
      declaredVersion: 6,
      atInstant: T_RECV,
    });
    expect(r.basis).toBe("version");
    expect(r.limits).toEqual({ upperLimit: "20" });
  });

  it("★ declared V beyond every stamp → point unchanged since V → gates by LIVE", () => {
    // Board declares v8 (both edits are < 8). The point was not edited since v8, so
    // its live limits ARE the v8-era limits.
    const r = resolveGateLimitsForBoard({
      snapshots: twoEditHistory(),
      liveLimits: LIVE,
      declaredVersion: 8,
      atInstant: T_RECV,
    });
    expect(r.basis).toBe("live");
    expect(r.limits).toEqual(LIVE);
  });

  it("★ UNSTAMPED history (legacy, 0282 absent) → falls back to the INSTANT path, does not crash", () => {
    // No productPointsConfigVersion on any snapshot → version path is skipped and we
    // reconstruct by instant. The snapshot whose changedAt >= T_RECV is upperLimit 15.
    const legacy: PointLimitSnapshot[] = [
      { changedAt: new Date("2026-07-15T10:00:00Z"), limits: { upperLimit: "15" } }, // after T_RECV
    ];
    const r = resolveGateLimitsForBoard({
      snapshots: legacy,
      liveLimits: LIVE,
      declaredVersion: 4,
      atInstant: T_RECV,
    });
    expect(r.basis).toBe("instant");
    expect(r.limits).toEqual({ upperLimit: "15" });
  });

  it("no declared version → instant path (parity with P1)", () => {
    const r = resolveGateLimitsForBoard({
      snapshots: twoEditHistory(), // stamped, but ignored without a declared version
      liveLimits: LIVE,
      declaredVersion: null,
      atInstant: T_RECV,
    });
    // twoEditHistory changedAt: 2026-07-10 and 2026-07-20, both AFTER T_RECV (07-15... wait 07-10 < 07-15).
    // Earliest changedAt >= T_RECV(07-15) is 07-20 → upperLimit 50.
    expect(r.basis).toBe("instant");
    expect(r.limits).toEqual({ upperLimit: "50" });
  });

  it("mixed stamped + unstamped rows → version path uses only the stamped ones", () => {
    const mixed: PointLimitSnapshot[] = [
      { changedAt: new Date("2026-07-01T00:00:00Z"), limits: { upperLimit: "99" } }, // unstamped, ignored by version path
      { changedAt: new Date("2026-07-05T00:00:00Z"), limits: { upperLimit: "30" }, productPointsConfigVersion: 6 },
    ];
    const r = resolveGateLimitsForBoard({
      snapshots: mixed,
      liveLimits: LIVE,
      declaredVersion: 6,
      atInstant: T_RECV,
    });
    expect(r.basis).toBe("version");
    expect(r.limits).toEqual({ upperLimit: "30" });
  });

  it("no snapshots at all → missing (caller SKIPS the gate — safe)", () => {
    const r = resolveGateLimitsForBoard({
      snapshots: [],
      liveLimits: LIVE,
      declaredVersion: 4,
      atInstant: T_RECV,
    });
    expect(r.basis).toBe("missing");
    expect(r.limits).toBeNull();
  });
});
