/**
 * Doc 51 P1 (QĐ#2) — SPEC-GATE BY SNAPSHOT, not by LIVE limits.
 *
 * These are the PURE-core proofs that the snapshot re-grade eliminates the
 * split-brain (a board graded under an OLDER limit being retro-failed by the
 * NEWER live limit). Each test is a mutation-test: it goes RED if the
 * reconstruction is swapped for the live def, picks the wrong snapshot, or stops
 * returning the safe "missing" skip.
 *
 * The router wiring (flag gate, stale-only engagement, gateConfigVersion trace,
 * telemetry) is covered in server/routers/machineApiSnapshotGate.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  evaluatePointResult,
  resolveLimitsAtInstant,
  type PointLimitSnapshot,
  type PointLimitSource,
} from "./pointResultEvaluator";

const T0 = new Date("2026-07-15T08:00:00.000Z"); // board measured here
const T_EDIT = new Date("2026-07-15T10:00:00.000Z"); // limit tightened AFTER the board

describe("resolveLimitsAtInstant — reconstruct the config live at an instant", () => {
  it("★ SPLIT-BRAIN: a limit tightened AFTER the board → gate by the OLD (snapshot) limit, NOT live", () => {
    // Live now: upperLimit 10. The board measured 12 and the MACHINE passed it —
    // because when it was measured the limit was still 15 (looser). Gating by the
    // LIVE 10 would retro-fail a good board; gating by the snapshot 15 does not.
    const liveDef: PointLimitSource = { upperLimit: "10" };
    const measurement = { measuredValue: 12 };

    // What LIVE gating does (the bug): OK → NG.
    const live = evaluatePointResult(liveDef, measurement, "OK");
    expect(live.result).toBe("NG");
    expect(live.overridden).toBe(true);

    // The snapshot carries changedAt = T_EDIT (the tightening) and holds the
    // PREVIOUS state (upperLimit 15 — what was live up to the edit).
    const snapshots: PointLimitSnapshot[] = [
      { changedAt: T_EDIT, limits: { upperLimit: "15" } },
    ];
    const resolved = resolveLimitsAtInstant(snapshots, T0);
    expect(resolved.basis).toBe("snapshot");
    expect(resolved.limits).toEqual({ upperLimit: "15" });

    // Gating the SAME board by the reconstructed limit keeps it OK.
    const snap = evaluatePointResult(resolved.limits as PointLimitSource, measurement, "OK");
    expect(snap.result).toBe("OK");
    expect(snap.overridden).toBe(false);

    // The whole point: the two verdicts DIFFER. If reconstruction leaked the live
    // def, both would be NG and this equality would fail.
    expect(snap.result).not.toBe(live.result);
  });

  it("picks the EARLIEST snapshot whose changedAt ≥ the instant (state live during that window)", () => {
    const A: PointLimitSource = { upperLimit: "100" };
    const B: PointLimitSource = { upperLimit: "50" };
    const C: PointLimitSource = { upperLimit: "20" };
    const t1 = new Date("2026-01-01T00:00:00Z");
    const t2 = new Date("2026-02-01T00:00:00Z");
    const t3 = new Date("2026-03-01T00:00:00Z");
    // snapshotJson[t2] = the state that was live UP TO the edit at t2 (i.e. during [t1, t2)).
    const snaps: PointLimitSnapshot[] = [
      { changedAt: t1, limits: A },
      { changedAt: t3, limits: C },
      { changedAt: t2, limits: B }, // deliberately out of order
    ];

    // Instant inside [t1, t2) → earliest changedAt ≥ instant is t2 → B.
    expect(resolveLimitsAtInstant(snaps, new Date("2026-01-15T00:00:00Z")).limits).toEqual(B);
    // Instant before t1 → earliest is t1 → A.
    expect(resolveLimitsAtInstant(snaps, new Date("2025-12-01T00:00:00Z")).limits).toEqual(A);
    // Instant inside [t2, t3) → t3 → C.
    expect(resolveLimitsAtInstant(snaps, new Date("2026-02-15T00:00:00Z")).limits).toEqual(C);
  });

  it("no snapshots at all → basis 'missing' (caller SKIPS the gate — safe)", () => {
    const r = resolveLimitsAtInstant([], T0);
    expect(r.basis).toBe("missing");
    expect(r.limits).toBeNull();
  });

  it("every edit predates the board → 'missing' (won't gate a stale board by post-era limits)", () => {
    const snaps: PointLimitSnapshot[] = [
      { changedAt: new Date("2026-07-15T06:00:00Z"), limits: { upperLimit: "9" } },
      { changedAt: new Date("2026-07-15T07:00:00Z"), limits: { upperLimit: "9" } },
    ];
    const r = resolveLimitsAtInstant(snaps, T0); // T0 = 08:00, after both edits
    expect(r.basis).toBe("missing");
    expect(r.limits).toBeNull();
  });

  it("exact tie (changedAt === instant) counts as at/after → the snapshot is used", () => {
    const snaps: PointLimitSnapshot[] = [{ changedAt: T0, limits: { upperLimit: "15" } }];
    const r = resolveLimitsAtInstant(snaps, T0);
    expect(r.basis).toBe("snapshot");
    expect(r.limits).toEqual({ upperLimit: "15" });
  });

  it("garbage rows (missing/NaN changedAt) are ignored, not crashed on", () => {
    const snaps = [
      { changedAt: new Date("invalid"), limits: { upperLimit: "1" } },
      { changedAt: T_EDIT, limits: { upperLimit: "15" } },
    ] as PointLimitSnapshot[];
    const r = resolveLimitsAtInstant(snaps, T0);
    expect(r.basis).toBe("snapshot");
    expect(r.limits).toEqual({ upperLimit: "15" });
  });

  it("criteria arrays survive the round-trip into the evaluator", () => {
    const snaps: PointLimitSnapshot[] = [
      {
        changedAt: T_EDIT,
        limits: { criteria: [{ kind: "numeric_range", metric: "height", max: 5 }] },
      },
    ];
    const resolved = resolveLimitsAtInstant(snaps, T0);
    const good = evaluatePointResult(resolved.limits as PointLimitSource, { valueHeight: 4 }, "OK");
    const bad = evaluatePointResult(resolved.limits as PointLimitSource, { valueHeight: 6 }, "OK");
    expect(good.result).toBe("OK");
    expect(bad.result).toBe("NG");
  });
});
