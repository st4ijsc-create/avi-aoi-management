// Unit tests for the pure fiducial-registration math lib (doc 55 · Item 2 · P0).
// No DB, no sharp, no service — deterministic geometry only.
//
// Coverage: identity, pure translation, 90° rotation, uniform scale, composite
// similarity + small noise (accepted), gross misalignment / heavy noise (rejected),
// degenerate (coincident src), insufficient (N<2), and a MUTATION-PROOF shear test
// that proves the fit is a SIMILARITY (4-DoF) and NOT an affine (QĐ#6).

import { describe, it, expect } from "vitest";
import {
  fitSimilarity,
  fitTransform,
  applyTransform,
  reprojectionRmsPx,
  DEFAULT_MAX_RESIDUAL_PX,
  type FiducialPair,
  type Matrix2x3,
} from "./fiducialRegistration";

// ── helpers ───────────────────────────────────────────────────────────────────

/** A spread-out, non-collinear set of observed (machine) fiducial points. */
const SRC: Array<{ x: number; y: number; code: string }> = [
  { code: "F1", x: 10, y: 12 },
  { code: "F2", x: 210, y: 8 },
  { code: "F3", x: 205, y: 190 },
  { code: "F4", x: 15, y: 205 },
];

/** Apply a ground-truth similarity (scale s, angle θ deg, translation tx,ty) to a point. */
function warp(x: number, y: number, s: number, thetaDeg: number, tx: number, ty: number): { x: number; y: number } {
  const th = (thetaDeg * Math.PI) / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  return { x: s * (cos * x - sin * y) + tx, y: s * (sin * x + cos * y) + ty };
}

/** Build pairs by pushing each SRC point through a ground-truth similarity (+ optional per-point noise). */
function pairsFrom(
  s: number,
  thetaDeg: number,
  tx: number,
  ty: number,
  noise?: (i: number) => { dx: number; dy: number },
): FiducialPair[] {
  return SRC.map((p, i) => {
    const d = warp(p.x, p.y, s, thetaDeg, tx, ty);
    const nz = noise ? noise(i) : { dx: 0, dy: 0 };
    return { code: p.code, srcX: p.x, srcY: p.y, dstX: d.x + nz.dx, dstY: d.y + nz.dy };
  });
}

/** Deterministic pseudo-noise in [-amp, +amp]. */
function jitter(amp: number) {
  return (i: number) => {
    const hx = Math.sin(i * 12.9898 + 1) * 43758.5453;
    const hy = Math.sin(i * 78.233 + 2) * 12345.6789;
    return { dx: (2 * (hx - Math.floor(hx)) - 1) * amp, dy: (2 * (hy - Math.floor(hy)) - 1) * amp };
  };
}

// Extract scale & rotation from a fitted 2×3 similarity matrix.
function decompose(m: Matrix2x3): { s: number; thetaDeg: number } {
  const [[a, b], [c]] = m; // a=s·cosθ, b=−s·sinθ, c=s·sinθ
  const s = Math.hypot(a, c);
  const thetaDeg = (Math.atan2(c, a) * 180) / Math.PI;
  return { s, thetaDeg };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("fitSimilarity — exact recoveries", () => {
  it("identity: src == dst → matrix ≈ identity, residual ≈ 0, ok", () => {
    const pairs = pairsFrom(1, 0, 0, 0);
    const r = fitSimilarity(pairs);
    expect(r.ok).toBe(true);
    expect(r.model).toBe("similarity");
    expect(r.fiducialCount).toBe(4);
    expect(r.residualPx).toBeCloseTo(0, 9);
    expect(r.matrix2x3[0][0]).toBeCloseTo(1, 9); // a
    expect(r.matrix2x3[0][1]).toBeCloseTo(0, 9); // b
    expect(r.matrix2x3[0][2]).toBeCloseTo(0, 9); // tx
    expect(r.matrix2x3[1][0]).toBeCloseTo(0, 9); // c
    expect(r.matrix2x3[1][1]).toBeCloseTo(1, 9); // d
    expect(r.matrix2x3[1][2]).toBeCloseTo(0, 9); // ty
  });

  it("pure translation: dst = src + [10,20] → tx≈10, ty≈20, s≈1, θ≈0, residual≈0", () => {
    const pairs = pairsFrom(1, 0, 10, 20);
    const r = fitSimilarity(pairs);
    expect(r.ok).toBe(true);
    expect(r.residualPx).toBeCloseTo(0, 9);
    expect(r.matrix2x3[0][2]).toBeCloseTo(10, 9); // tx
    expect(r.matrix2x3[1][2]).toBeCloseTo(20, 9); // ty
    const { s, thetaDeg } = decompose(r.matrix2x3);
    expect(s).toBeCloseTo(1, 9);
    expect(thetaDeg).toBeCloseTo(0, 9);
  });

  it("rotation 90°: matrix ≈ [[0,-1],[1,0]], residual ≈ 0", () => {
    const pairs = pairsFrom(1, 90, 0, 0);
    const r = fitSimilarity(pairs);
    expect(r.ok).toBe(true);
    expect(r.residualPx).toBeCloseTo(0, 8);
    expect(r.matrix2x3[0][0]).toBeCloseTo(0, 9);  // a = cos90
    expect(r.matrix2x3[0][1]).toBeCloseTo(-1, 9); // b = −sin90
    expect(r.matrix2x3[1][0]).toBeCloseTo(1, 9);  // c = sin90
    expect(r.matrix2x3[1][1]).toBeCloseTo(0, 9);  // d = cos90
    const { s, thetaDeg } = decompose(r.matrix2x3);
    expect(s).toBeCloseTo(1, 9);
    expect(thetaDeg).toBeCloseTo(90, 8);
    // Sanity: transform maps (x,y) → (−y, x).
    const p = applyTransform(r.matrix2x3, 3, 5);
    expect(p.x).toBeCloseTo(-5, 8);
    expect(p.y).toBeCloseTo(3, 8);
  });

  it("uniform scale: dst = 2·src → s ≈ 2, θ ≈ 0", () => {
    const pairs = pairsFrom(2, 0, 0, 0);
    const r = fitSimilarity(pairs);
    expect(r.ok).toBe(true);
    expect(r.residualPx).toBeCloseTo(0, 8);
    const { s, thetaDeg } = decompose(r.matrix2x3);
    expect(s).toBeCloseTo(2, 9);
    expect(thetaDeg).toBeCloseTo(0, 9);
  });

  it("composite similarity (scale + rotation + translation) recovered exactly", () => {
    const pairs = pairsFrom(1.5, 20, 30, -12);
    const r = fitSimilarity(pairs);
    expect(r.ok).toBe(true);
    expect(r.residualPx).toBeCloseTo(0, 7);
    const { s, thetaDeg } = decompose(r.matrix2x3);
    expect(s).toBeCloseTo(1.5, 8);
    expect(thetaDeg).toBeCloseTo(20, 7);
    expect(r.matrix2x3[0][2]).toBeCloseTo(30, 6);  // tx
    expect(r.matrix2x3[1][2]).toBeCloseTo(-12, 6); // ty
  });
});

describe("fitTransform — residual gate (QĐ#7 / QĐ#8)", () => {
  it("composite similarity + small noise → residual < threshold, ok", () => {
    const pairs = pairsFrom(1.25, 15, 8, 5, jitter(0.5)); // ≤0.5px jitter
    const r = fitTransform(pairs);
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.residualPx).toBeLessThan(DEFAULT_MAX_RESIDUAL_PX);
    expect(r.residualPx).toBeGreaterThan(0); // noise → not a perfect fit
    const { s, thetaDeg } = decompose(r.matrix2x3);
    expect(s).toBeCloseTo(1.25, 1);
    expect(thetaDeg).toBeCloseTo(15, 0);
  });

  it("gross misalignment / heavy noise → residual > 5px → ok:false residual_exceeded (matrix still present)", () => {
    const pairs = pairsFrom(1.0, 5, 0, 0, jitter(40)); // ±40px chaos, far beyond 5px
    const r = fitTransform(pairs);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("residual_exceeded");
    expect(r.residualPx).toBeGreaterThan(DEFAULT_MAX_RESIDUAL_PX);
    // Matrix is STILL returned for telemetry (not the identity fallback).
    expect(r.matrix2x3).toBeDefined();
    // residualPx must be self-consistent with the returned matrix.
    expect(reprojectionRmsPx(r.matrix2x3, pairs)).toBeCloseTo(r.residualPx, 9);
  });

  it("custom maxResidualPx tightens the gate", () => {
    const pairs = pairsFrom(1.0, 0, 0, 0, jitter(2)); // ~1-2px noise
    const loose = fitTransform(pairs, { maxResidualPx: 5.0 });
    const tight = fitTransform(pairs, { maxResidualPx: 0.1 });
    expect(loose.ok).toBe(true);
    expect(tight.ok).toBe(false);
    expect(tight.reason).toBe("residual_exceeded");
    // Same underlying fit — only the verdict differs.
    expect(tight.residualPx).toBeCloseTo(loose.residualPx, 9);
  });
});

describe("fitTransform — rejects", () => {
  it("degenerate: all src coincide → reason 'degenerate'", () => {
    const pairs: FiducialPair[] = [
      { code: "A", srcX: 50, srcY: 50, dstX: 10, dstY: 10 },
      { code: "B", srcX: 50, srcY: 50, dstX: 20, dstY: 90 },
      { code: "C", srcX: 50, srcY: 50, dstX: 90, dstY: 30 },
    ];
    const r = fitTransform(pairs);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("degenerate");
    expect(r.fiducialCount).toBe(3);
    // Reject → identity fallback matrix.
    expect(r.matrix2x3).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });

  it("insufficient: N = 1 → reason 'insufficient'", () => {
    const pairs: FiducialPair[] = [{ code: "A", srcX: 1, srcY: 2, dstX: 3, dstY: 4 }];
    const r = fitTransform(pairs);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("insufficient");
    expect(r.fiducialCount).toBe(1);
  });

  it("insufficient: N = 0 → reason 'insufficient'", () => {
    const r = fitTransform([]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("insufficient");
    expect(r.fiducialCount).toBe(0);
  });

  it("N = 2 distinct src points is sufficient (4-DoF exactly determined)", () => {
    const pairs: FiducialPair[] = [
      { code: "A", srcX: 0, srcY: 0, dstX: 10, dstY: 20 },
      { code: "B", srcX: 100, srcY: 0, dstX: 110, dstY: 20 },
    ];
    const r = fitTransform(pairs);
    expect(r.ok).toBe(true);
    expect(r.residualPx).toBeCloseTo(0, 9);
  });
});

describe("MUTATION-PROOF — similarity has NO shear (QĐ#6)", () => {
  it("pure-shear target cannot be fit by similarity: residual stays large (an affine would nail it)", () => {
    // Ground-truth = pure horizontal shear x' = x + k·y (k=0.4). This lives in the
    // affine (6-DoF) family but is OUTSIDE the similarity (4-DoF) family, so the
    // best similarity fit must leave a large residual. If the lib ever regressed to
    // an affine solve, this shear would be absorbed and residualPx would collapse
    // toward 0 — this test would then fail, flagging the DoF violation.
    const k = 0.4;
    const pairs: FiducialPair[] = SRC.map((p) => ({
      code: p.code,
      srcX: p.x,
      srcY: p.y,
      dstX: p.x + k * p.y,
      dstY: p.y,
    }));

    const r = fitTransform(pairs);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("residual_exceeded");
    // The shear spans ~200px of board height → an unmodeled shear of k=0.4 leaves
    // many px of residual, comfortably past the 5px gate.
    expect(r.residualPx).toBeGreaterThan(DEFAULT_MAX_RESIDUAL_PX);

    // Explicit proof that NO similarity fits this well: the residual reported is the
    // genuine least-squares optimum for the returned matrix.
    expect(reprojectionRmsPx(r.matrix2x3, pairs)).toBeCloseTo(r.residualPx, 9);

    // And prove an AFFINE COULD fit it exactly (residual 0) — i.e. the residual is
    // due to the DoF restriction, not to bad data. Build the exact shear affine and
    // show it reprojects with ~0 error, unlike our similarity result.
    const shearAffine: Matrix2x3 = [
      [1, k, 0],
      [0, 1, 0],
    ];
    expect(reprojectionRmsPx(shearAffine, pairs)).toBeCloseTo(0, 9);
    expect(r.residualPx).toBeGreaterThan(1); // similarity is decisively worse
  });
});

describe("applyTransform / reprojectionRmsPx", () => {
  it("applyTransform composes a,b,tx / c,d,ty correctly", () => {
    const m: Matrix2x3 = [
      [2, 0, 5],
      [0, 3, 7],
    ];
    expect(applyTransform(m, 4, 6)).toEqual({ x: 2 * 4 + 5, y: 3 * 6 + 7 });
  });

  it("reprojectionRmsPx is 0 for a perfect map and matches hand calc otherwise", () => {
    const m: Matrix2x3 = [
      [1, 0, 0],
      [0, 1, 0],
    ];
    const perfect: FiducialPair[] = [{ code: "A", srcX: 3, srcY: 4, dstX: 3, dstY: 4 }];
    expect(reprojectionRmsPx(m, perfect)).toBe(0);

    // One point off by (3,4) → distance 5 → RMS 5.
    const off: FiducialPair[] = [{ code: "A", srcX: 0, srcY: 0, dstX: 3, dstY: 4 }];
    expect(reprojectionRmsPx(m, off)).toBeCloseTo(5, 12);

    // Empty → 0.
    expect(reprojectionRmsPx(m, [])).toBe(0);
  });
});
