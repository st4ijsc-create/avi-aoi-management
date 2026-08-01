// ─────────────────────────────────────────────────────────────────────────────
// Fiducial registration — closed-form 2D SIMILARITY fit (Umeyama, 4-DoF).
//
// doc 55 · Item 2 (Fiducial Registration) · Phase P0 — PURE MATH LIB ONLY.
//
// This module is DEPENDENCY-FREE (no DB, no sharp, no service imports). It fits a
// rigid+scale ("similarity") transform from a set of matched fiducial points and
// exposes an honest residual gate so callers can reject a bad board alignment.
//
// ── QUYẾT ĐỊNH USER (doc 55 §6) ────────────────────────────────────────────────
//  • QĐ#6 — We fit a SIMILARITY transform (4 degrees of freedom: translation
//    tx,ty + uniform scale s + rotation θ) EVEN when ≥3 fiducials are available.
//    We deliberately do NOT fit a 6-DoF affine: shear/anisotropic-scale are
//    excluded on purpose. A rigid board on a machine bed should only translate,
//    rotate and (mildly) scale; letting shear absorb the residual would hide real
//    misalignment and produce unstable, over-fit warps. Extra fiducials therefore
//    only make the least-squares estimate MORE robust, never add DoF.
//  • QĐ#7 — A poor fit is rejected (ok:false) so the caller can fall back.
//  • QĐ#8 — Default reject threshold is 5.0 px RMS reprojection error.
//
// ── TRANSFORM DIRECTION ────────────────────────────────────────────────────────
//  We fit  src (OBSERVED, machine frame)  →  dst (CANONICAL, server frame).
//  In a FiducialPair, (srcX,srcY) is where the machine OBSERVED the fiducial and
//  (dstX,dstY) is the CANONICAL server-side location of that fiducial.
//
//  The returned 2×3 matrix M maps observed → canonical. The Phase-P1 caller (the
//  syncMeasurementPoints path) applies M to each measurement point.positionX/Y
//  that the machine pushes, re-projecting the machine's observed coordinates into
//  the canonical coordinate frame so downstream geometry lines up regardless of how
//  the physical board sat under the camera.
//
//  Matrix layout:  M = [[a, b, tx], [c, d, ty]]  with
//                  a =  s·cosθ,  b = −s·sinθ,  tx
//                  c =  s·sinθ,  d =  s·cosθ,  ty
//  Applying to a point:  x' = a·x + b·y + tx ,  y' = c·x + d·y + ty.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

// ── Types + zod schemas ───────────────────────────────────────────────────────

const finiteNumber = z.number().finite();

/** A fiducial as seen by the machine (observed coordinates only). */
export const observedFiducialSchema = z.object({
  code: z.string(),
  observedX: finiteNumber,
  observedY: finiteNumber,
});
export type ObservedFiducial = z.infer<typeof observedFiducialSchema>;

/**
 * A matched fiducial pair: (srcX,srcY) = observed machine location,
 * (dstX,dstY) = canonical server location. Fit direction is src → dst.
 */
export const fiducialPairSchema = z.object({
  code: z.string(),
  srcX: finiteNumber,
  srcY: finiteNumber,
  dstX: finiteNumber,
  dstY: finiteNumber,
});
export type FiducialPair = z.infer<typeof fiducialPairSchema>;

/** 2×3 affine matrix [[a, b, tx], [c, d, ty]] (row-major, bottom row implied [0,0,1]). */
export type Matrix2x3 = [[number, number, number], [number, number, number]];

/** Why a fit was rejected (undefined ⇒ accepted). */
export type RegistrationReason = "insufficient" | "degenerate" | "residual_exceeded";

export interface RegistrationResult {
  /** [[s·cosθ, −s·sinθ, tx], [s·sinθ, s·cosθ, ty]] — maps observed → canonical. */
  matrix2x3: Matrix2x3;
  /** Always "similarity" (4-DoF) per QĐ#6 — never affine. */
  model: "similarity";
  /** RMS reprojection error in pixels over the input pairs. */
  residualPx: number;
  /** Number of matched pairs used. */
  fiducialCount: number;
  /** True ⇔ a similarity was fit AND (for fitTransform) residual is within threshold. */
  ok: boolean;
  /** Present only when ok=false. */
  reason?: RegistrationReason;
}

/** Default RMS reject threshold in pixels (QĐ#8). */
export const DEFAULT_MAX_RESIDUAL_PX = 5.0;

/** Below this the source-point variance is treated as zero (all fiducials coincide). */
const DEGENERATE_VARIANCE_EPS = 1e-9;

const IDENTITY_2X3: Matrix2x3 = [
  [1, 0, 0],
  [0, 1, 0],
];

function identity(): Matrix2x3 {
  return [
    [1, 0, 0],
    [0, 1, 0],
  ];
}

// ── Core geometry ─────────────────────────────────────────────────────────────

/** Apply a 2×3 affine matrix to a point. */
export function applyTransform(m: Matrix2x3, x: number, y: number): { x: number; y: number } {
  const [[a, b, tx], [c, d, ty]] = m;
  return { x: a * x + b * y + tx, y: c * x + d * y + ty };
}

/**
 * RMS reprojection error (px): sqrt( mean_i |applyTransform(m, src_i) − dst_i|² ).
 * Returns 0 for an empty set (no evidence of error).
 */
export function reprojectionRmsPx(m: Matrix2x3, pairs: FiducialPair[]): number {
  if (pairs.length === 0) return 0;
  let sumSq = 0;
  for (const p of pairs) {
    const proj = applyTransform(m, p.srcX, p.srcY);
    const ex = proj.x - p.dstX;
    const ey = proj.y - p.dstY;
    sumSq += ex * ex + ey * ey;
  }
  return Math.sqrt(sumSq / pairs.length);
}

/**
 * Closed-form least-squares 2D SIMILARITY fit (Umeyama 1991, specialised to 2D via
 * the complex-number method — no SVD needed).
 *
 * Model:  q ≈ s·R(θ)·p + t   (uniform scale s ≥ 0, rotation θ, translation t).
 * Writing points as complex numbers p = pₓ + i·p_y, q = qₓ + i·q_y and the
 * similarity as multiplication by a single complex coefficient c = s·e^{iθ}:
 *
 *     minimise  Σ |q_i − c·p_i − d|²   over c ∈ ℂ, d ∈ ℂ.
 *
 * Centering by the centroids removes d, and the optimal c has the closed form
 *
 *     c = ( Σ conj(p'_i)·q'_i ) / ( Σ |p'_i|² )
 *       = ( a + i·b ) / Sp
 *
 * where, over the centered points,
 *     a  = Σ ( p'ₓ·q'ₓ + p'_y·q'_y )   (Σ of dot products)
 *     b  = Σ ( p'ₓ·q'_y − p'_y·q'ₓ )   (Σ of cross products)
 *     Sp = Σ ( p'ₓ² + p'_y² )          (source variance · n)
 *
 * Then  s·cosθ = a/Sp,  s·sinθ = b/Sp,  s = |c| = √(a²+b²)/Sp,  θ = atan2(b,a),
 * and   t = μ_q − c·μ_p. Because s = |c| ≥ 0 and θ is a genuine rotation, this
 * automatically yields a PROPER rotation (no reflection) — the 2D equivalent of
 * Umeyama's det-correction, obtained for free.
 *
 * Rejections (ok:false, matrix set to identity):
 *   • N < 2 pairs           → reason "insufficient" (a similarity has 4 DoF; two
 *                             distinct points give the 4 equations needed).
 *   • Source variance ≈ 0   → reason "degenerate" (all observed fiducials coincide;
 *                             rotation/scale are unrecoverable).
 *
 * NOTE: this does NOT apply the residual gate — use fitTransform for that.
 */
export function fitSimilarity(pairs: FiducialPair[]): RegistrationResult {
  const n = pairs.length;
  if (n < 2) {
    return { matrix2x3: identity(), model: "similarity", residualPx: 0, fiducialCount: n, ok: false, reason: "insufficient" };
  }

  // Centroids.
  let muPx = 0, muPy = 0, muQx = 0, muQy = 0;
  for (const p of pairs) {
    muPx += p.srcX; muPy += p.srcY;
    muQx += p.dstX; muQy += p.dstY;
  }
  muPx /= n; muPy /= n; muQx /= n; muQy /= n;

  // Accumulate a, b, Sp over centered points.
  let a = 0, b = 0, sp = 0;
  for (const p of pairs) {
    const px = p.srcX - muPx, py = p.srcY - muPy;
    const qx = p.dstX - muQx, qy = p.dstY - muQy;
    a += px * qx + py * qy;   // dot
    b += px * qy - py * qx;   // cross
    sp += px * px + py * py;  // source variance · n
  }

  if (sp < DEGENERATE_VARIANCE_EPS) {
    return { matrix2x3: identity(), model: "similarity", residualPx: 0, fiducialCount: n, ok: false, reason: "degenerate" };
  }

  // Complex similarity coefficient c = (a + i·b)/Sp = (s·cosθ) + i·(s·sinθ).
  const sCos = a / sp; // s·cosθ
  const sSin = b / sp; // s·sinθ

  // Translation t = μ_q − c·μ_p.
  const tx = muQx - (sCos * muPx - sSin * muPy);
  const ty = muQy - (sSin * muPx + sCos * muPy);

  const matrix2x3: Matrix2x3 = [
    [sCos, -sSin, tx],
    [sSin, sCos, ty],
  ];

  const residualPx = reprojectionRmsPx(matrix2x3, pairs);
  return { matrix2x3, model: "similarity", residualPx, fiducialCount: n, ok: true };
}

/**
 * PRIMARY ENTRY POINT. Fit a similarity transform and apply the honest residual
 * gate (QĐ#7 / QĐ#8).
 *
 *   1. fitSimilarity(pairs) → similarity matrix (or reject insufficient/degenerate).
 *   2. Compute RMS reprojection residual.
 *   3. If residual > maxResidualPx (default 5.0), reject with reason
 *      "residual_exceeded" — BUT still return the fitted matrix so the caller can
 *      log/telemetry the attempted warp and decide on a fallback.
 *
 * The returned matrix maps OBSERVED (machine) → CANONICAL (server); see file header.
 */
export function fitTransform(
  pairs: FiducialPair[],
  opts?: { maxResidualPx?: number },
): RegistrationResult {
  const maxResidualPx = opts?.maxResidualPx ?? DEFAULT_MAX_RESIDUAL_PX;

  const fit = fitSimilarity(pairs);
  if (!fit.ok) {
    // insufficient / degenerate — nothing was fit; pass the reason through.
    return fit;
  }

  if (fit.residualPx > maxResidualPx) {
    // Keep the fitted matrix (telemetry) but mark the alignment as not trustworthy.
    return { ...fit, ok: false, reason: "residual_exceeded" };
  }

  return fit;
}

export { IDENTITY_2X3 };
