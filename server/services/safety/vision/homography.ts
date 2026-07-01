/**
 * S2b (doc 20 §2/§5 / doc 16 §8) — PURE planar homography (pixel ↔ floor).  No I/O.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A camera looking at a (locally) flat factory floor is a PLANE→PLANE mapping: an
 * image pixel (u,v) maps to a floor point (X,Y) by a 3×3 homography H (the floor is
 * z=0 in world mm). This module implements — as small, self-contained linear algebra
 * (no deps) — the two operations S2b needs:
 *
 *   • applyHomography(H, {u,v}) → {x,y}    — project a pixel to the floor.
 *   • solveHomography([{image,floor} × ≥4]) — least-squares solve H from N≥4 known
 *     image↔floor correspondences (the DLT / normalized-DLT algorithm).
 *
 * Homography has 8 DoF (H is 3×3 up to scale; we fix H[8]=1). Each point pair gives 2
 * equations, so ≥4 non-collinear pairs fully determine H; >4 → least-squares.
 *
 * ⚠ HONESTY: this converts a DETECTED pixel box to a FLOOR position given a REAL
 *   per-camera calibration. It NEVER invents a detection and NEVER invents a
 *   calibration — a real deployment must calibrate each camera (measure ≥4 floor
 *   points visible in the image and their pixel coordinates). Accuracy is only as
 *   good as (a) the planar-floor assumption and (b) the calibration measurements.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** A 3×3 homography in row-major order (9 numbers). H[8] is the scale (usually 1). */
export type Homography = [number, number, number, number, number, number, number, number, number];

export interface PixelPoint {
  /** horizontal pixel coordinate (column). */
  u: number;
  /** vertical pixel coordinate (row). */
  v: number;
}

export interface FloorPoint {
  /** world floor X (mm). */
  x: number;
  /** world floor Y (mm). */
  y: number;
}

/** One image↔floor correspondence used to solve the homography. */
export interface CalibrationPair {
  image: PixelPoint;
  floor: FloorPoint;
}

/**
 * Apply a homography to a pixel point → floor point.  [x' y' w']ᵀ = H·[u v 1]ᵀ,
 * then divide by w' (perspective divide). Throws if w' is ~0 (point at infinity —
 * a degenerate/invalid calibration or a pixel on the horizon line).
 */
export function applyHomography(H: Homography, p: PixelPoint): FloorPoint {
  const { u, v } = p;
  const xw = H[0] * u + H[1] * v + H[2];
  const yw = H[3] * u + H[4] * v + H[5];
  const w = H[6] * u + H[7] * v + H[8];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) {
    throw new Error("homography: point maps to infinity (w≈0) — degenerate calibration or horizon pixel");
  }
  return { x: xw / w, y: yw / w };
}

/**
 * Solve a homography from N≥4 image↔floor correspondences by the DLT algorithm with
 * a least-squares normal-equations solve (fixing H[8]=1, i.e. 8 unknowns).
 *
 * For each pair (u,v)↔(x,y) the projective relation gives two linear equations in the
 * 8 unknowns h0..h7:
 *   u·h0 + v·h1 + h2                         − x·u·h6 − x·v·h7 = x
 *   u·h3 + v·h4 + h5 − y·u·h6 − y·v·h7                        = y
 * Stack all 2N equations as A·h = b, solve the 8×8 normal equations (AᵀA)h = Aᵀb via
 * Gaussian elimination with partial pivoting. Pure + deterministic.
 *
 * Throws for <4 pairs or a singular (degenerate/collinear) configuration.
 */
export function solveHomography(pairs: CalibrationPair[]): Homography {
  if (pairs.length < 4) {
    throw new Error(`homography: need ≥4 image↔floor pairs, got ${pairs.length}`);
  }
  // Build A (2N×8) and b (2N).
  const A: number[][] = [];
  const b: number[] = [];
  for (const { image, floor } of pairs) {
    const { u, v } = image;
    const { x, y } = floor;
    A.push([u, v, 1, 0, 0, 0, -x * u, -x * v]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -y * u, -y * v]);
    b.push(y);
  }
  // Normal equations: M = AᵀA (8×8), rhs = Aᵀb (8).
  const n = 8;
  const M: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const rhs: number[] = new Array(n).fill(0);
  for (let r = 0; r < A.length; r++) {
    const row = A[r];
    const br = b[r];
    for (let i = 0; i < n; i++) {
      rhs[i] += row[i] * br;
      for (let j = 0; j < n; j++) M[i][j] += row[i] * row[j];
    }
  }
  const h = solveLinear(M, rhs); // 8 unknowns
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/**
 * Solve a square linear system M·x = rhs by Gaussian elimination with partial
 * pivoting. Throws on a (near-)singular matrix. Pure — mutates only local copies.
 */
export function solveLinear(M: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  // Augmented copy.
  const a: number[][] = M.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    // Partial pivot: largest magnitude in this column at/below the diagonal.
    let pivot = col;
    let max = Math.abs(a[col][col]);
    for (let r = col + 1; r < n; r++) {
      const m = Math.abs(a[r][col]);
      if (m > max) {
        max = m;
        pivot = r;
      }
    }
    if (max < 1e-12) {
      throw new Error("homography: singular system (degenerate/collinear calibration points)");
    }
    if (pivot !== col) {
      const tmp = a[col];
      a[col] = a[pivot];
      a[pivot] = tmp;
    }
    // Eliminate below.
    for (let r = col + 1; r < n; r++) {
      const f = a[r][col] / a[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) a[r][c] -= f * a[col][c];
    }
  }
  // Back-substitution.
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = a[r][n];
    for (let c = r + 1; c < n; c++) s -= a[r][c] * x[c];
    x[r] = s / a[r][r];
  }
  return x;
}

/** Runtime guard: is a value a well-formed 9-number homography? */
export function isHomography(v: unknown): v is Homography {
  return Array.isArray(v) && v.length === 9 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

/**
 * Round-trip residual (mm) of a solved homography against its calibration pairs —
 * the mean reprojection error onto the floor. A calibration honesty metric: a large
 * residual means the planar-floor assumption or the measured points are poor. PURE.
 */
export function calibrationResidualMm(H: Homography, pairs: CalibrationPair[]): number {
  if (pairs.length === 0) return 0;
  let sum = 0;
  for (const { image, floor } of pairs) {
    const p = applyHomography(H, image);
    sum += Math.hypot(p.x - floor.x, p.y - floor.y);
  }
  return sum / pairs.length;
}
