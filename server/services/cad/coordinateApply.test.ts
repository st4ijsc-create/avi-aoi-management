/**
 * Doc 54 §11 P0.1 — pure tests for the coordinate-apply MATCHER.
 *
 * matchCandidatesToPoints maps parsed centroid candidates onto EXISTING
 * measurement points (the ones stuck at 0,0) by refDesignator / code, with a
 * unique-only componentCode fallback. No DB — pure function.
 */
import { describe, it, expect } from "vitest";
import { matchCandidatesToPoints, type ExistingPointLite } from "./centroidImportService";
import type { CentroidCandidate } from "./centroidParser";

const cand = (over: Partial<CentroidCandidate>): CentroidCandidate => ({
  candidateIndex: 0,
  code: "R1",
  name: "R1",
  shape: "circle",
  positionX: 100.6,
  positionY: 200.4,
  refDesignator: "R1",
  rawX: 1,
  rawY: 2,
  mmX: 1,
  mmY: 2,
  unit: "mm",
  ...over,
});

const point = (over: Partial<ExistingPointLite>): ExistingPointLite => ({
  id: 1,
  code: "R1",
  refDesignator: "R1",
  componentCode: null,
  positionX: 0,
  positionY: 0,
  geometry: null,
  ...over,
});

describe("matchCandidatesToPoints", () => {
  it("matches by refDesignator (case-insensitive) and rounds new coords", () => {
    const { matched, unmatched } = matchCandidatesToPoints(
      [cand({ candidateIndex: 0, code: "r1", refDesignator: "r1", positionX: 100.6, positionY: 200.4 })],
      [point({ id: 7, code: "R1", refDesignator: "R1", positionX: 0, positionY: 0 })],
    );
    expect(unmatched).toEqual([]);
    expect(matched).toHaveLength(1);
    expect(matched[0].pointId).toBe(7);
    expect(matched[0].matchedBy).toBe("refDesignator");
    expect(matched[0].oldX).toBe(0);
    expect(matched[0].newX).toBe(101); // rounded
    expect(matched[0].newY).toBe(200);
  });

  it("falls back to point.code when refDesignator is absent", () => {
    const { matched } = matchCandidatesToPoints(
      [cand({ code: "U3", refDesignator: "U3" })],
      [point({ id: 5, code: "U3", refDesignator: null })],
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].matchedBy).toBe("code");
    expect(matched[0].pointId).toBe(5);
  });

  it("reports unmatched candidates without inventing a point", () => {
    const { matched, unmatched } = matchCandidatesToPoints(
      [cand({ code: "C99", refDesignator: "C99" })],
      [point({ id: 1, code: "R1", refDesignator: "R1" })],
    );
    expect(matched).toEqual([]);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].refDesignator).toBe("C99");
    expect(unmatched[0].reason).toMatch(/no existing/i);
  });

  it("consumes each point at most once (no double-write)", () => {
    const { matched, unmatched } = matchCandidatesToPoints(
      [
        cand({ candidateIndex: 0, code: "R1", refDesignator: "R1" }),
        cand({ candidateIndex: 1, code: "R1", refDesignator: "R1" }),
      ],
      [point({ id: 1, code: "R1", refDesignator: "R1" })],
    );
    expect(matched).toHaveLength(1);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].candidateIndex).toBe(1);
  });

  it("matches a UNIQUE componentCode but skips an ambiguous one", () => {
    // Unique value 'MCU' → matched; shared value '10K' (two points) → ambiguous, unmatched.
    const res = matchCandidatesToPoints(
      [
        cand({ candidateIndex: 0, code: "X1", refDesignator: "X1", componentCode: "MCU" }),
        cand({ candidateIndex: 1, code: "X2", refDesignator: "X2", componentCode: "10K" }),
      ],
      [
        point({ id: 10, code: "U1", refDesignator: "U1", componentCode: "MCU" }),
        point({ id: 11, code: "RA", refDesignator: "RA", componentCode: "10K" }),
        point({ id: 12, code: "RB", refDesignator: "RB", componentCode: "10K" }),
      ],
    );
    const byCand = Object.fromEntries(res.matched.map((m) => [m.candidateIndex, m]));
    expect(byCand[0]?.pointId).toBe(10);
    expect(byCand[0]?.matchedBy).toBe("componentCode");
    expect(res.unmatched.map((u) => u.candidateIndex)).toContain(1);
  });

  it("carries rotation + normalized coords through to the match row", () => {
    const { matched } = matchCandidatesToPoints(
      [cand({ code: "R1", refDesignator: "R1", rotation: 90, normalizedX: 0.25, normalizedY: 0.5 })],
      [point({ id: 1, code: "R1", refDesignator: "R1" })],
    );
    expect(matched[0].rotation).toBe(90);
    expect(matched[0].normalizedX).toBeCloseTo(0.25, 6);
    expect(matched[0].normalizedY).toBeCloseTo(0.5, 6);
  });
});
