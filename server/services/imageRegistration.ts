/**
 * AOI-B (doc 24 Wave-2) — Sub-pixel REFERENCE ALIGNMENT (registration).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Upgrades the coarse rotate+translate NCC aligner (imageAlignment.ts) to a
 * SUB-PIXEL, intensity-based AFFINE (optionally projective/homography) estimator
 * with an alignment CONFIDENCE/RESIDUAL gate — pure JS + `sharp` only, NO OpenCV,
 * NO FFT dep, matching the platform's pure-JS CV style (aiSegmentation /
 * aiMetrology: marching-squares, Feret, hand-rolled linear algebra).
 *
 * ── ALGORITHM: inverse-compositional Lucas–Kanade / ECC on a Gaussian pyramid ──
 * We minimise the photometric error between a golden `reference` and a warped
 * `candidate` over the affine parameter vector p = (a,b,tx,c,d,ty), where a
 * candidate pixel maps to reference space by
 *       [x']   [1+a   b ] [x]   [tx]
 *       [y'] = [ c  1+d ] [y] + [ty]
 * Each Gauss–Newton step solves the 6×6 normal equations
 *       H·Δp = b,   H = Σ Jᵀ J,   b = Σ Jᵀ (ref − warp(cand))
 * where J is the 2×6 image-gradient Jacobian of the warp. Warping uses BILINEAR
 * interpolation of the candidate, so the solution is CONTINUOUS in (tx,ty) and in
 * the linear part → the estimate is SUB-PIXEL (not the integer-shift search of the
 * old NCC). A coarse-to-fine Gaussian pyramid (downscale via sharp) gives a large
 * capture range and keeps it fast; the estimate from level L+1 seeds level L.
 *
 * Optionally the model can be extended to a full 8-DoF PROJECTIVE homography
 * (perspective) — `model:"homography"` — with the same GN machinery on an 8-vector.
 * Affine is the default (robust, enough for AOI stage skew); homography is opt-in.
 *
 * ── CONFIDENCE GATE (honest degradation) ──
 * After convergence we report:
 *   • rmsResidual   — RMS photometric residual over the overlap (0..255 scale),
 *   • ncc           — normalised cross-correlation of ref vs warped candidate,
 *   • confidence    — max(0, ncc) clamped to [0,1].
 * `aligned` is TRUE only when confidence ≥ minConfidence AND rmsResidual ≤
 * maxResidual AND enough overlap survived. A low-confidence / high-residual result
 * is reported as aligned:false (the caller must NOT diff on it) — never a fake pass.
 *
 * All heavy loops run on LUMINANCE (grayscale raw Uint8). `sharp` is used only for
 * decode/resize/grayscale. Pure functions where possible for unit-testing.
 * ════════════════════════════════════════════════════════════════════════════
 */

import sharp from "sharp";

export interface GrayImage {
  data: Buffer | Uint8Array;
  width: number;
  height: number;
}

/** Affine warp: refCoord = A·candCoord + t, stored row-major as the 2×3 matrix. */
export interface AffineMatrix {
  /** [ [1+a, b, tx], [c, 1+d, ty] ] — maps candidate (x,y) → reference (x',y'). */
  a: number;
  b: number;
  tx: number;
  c: number;
  d: number;
  ty: number;
}

export type RegistrationModel = "affine" | "homography";

export interface RegisterOptions {
  /** "affine" (6-DoF, default) or "homography" (8-DoF projective). */
  model?: RegistrationModel;
  /** Longest edge of the finest working image (perf vs accuracy). Default 512.
   *  Registration is most accurate at native resolution; downscaling trades accuracy
   *  for speed. 512 keeps typical AOI ROIs near-native while bounding cost. */
  workSize?: number;
  /** Number of Gaussian-pyramid levels (incl. finest). Default 4. */
  pyramidLevels?: number;
  /** Max Gauss–Newton iterations per level. Default 30. */
  maxIterations?: number;
  /** Convergence: stop when the parameter update norm falls below this. Default 1e-4. */
  epsilon?: number;
  /** Min NCC (after alignment) to accept as aligned. Default 0.6. */
  minConfidence?: number;
  /** Max RMS residual (0..255) to accept as aligned. Default 40. */
  maxResidual?: number;
  /** Min fraction of pixels that must remain inside the candidate after warp. Default 0.4. */
  minOverlap?: number;
}

export interface RegistrationResult {
  model: RegistrationModel;
  /** Estimated affine (always populated; for homography it is the affine sub-block). */
  affine: AffineMatrix;
  /** Full 3×3 homography row-major (identity-bottom-row for affine). */
  homography: number[]; // length 9
  /** RMS photometric residual over the overlap, 0..255 scale (lower = better). */
  rmsResidual: number;
  /** NCC of reference vs warped candidate over the overlap, clamped [0,1]. */
  ncc: number;
  /** Alignment confidence ∈ [0,1] (= max(0, ncc)). */
  confidence: number;
  /** Fraction of reference pixels whose warp landed inside the candidate. */
  overlap: number;
  /** Effective (dx,dy,rotationDeg,scale) decomposed from the affine — for UI/telemetry. */
  dx: number;
  dy: number;
  rotationDeg: number;
  scale: number;
  /** Candidate warped into reference space, grayscale raw, same W×H as reference. */
  alignedBuffer: Buffer;
  alignedWidth: number;
  alignedHeight: number;
  /** GATE: true only when confidence high AND residual low AND overlap sufficient. */
  aligned: boolean;
  /** Human-readable reason when aligned=false (empty when aligned). */
  reason: string;
  /** GN iterations actually run at the finest level (diagnostic). */
  iterations: number;
}

// ─── sharp helpers (decode / resize / grayscale) ──────────────────────────────

/** Resize a 1-channel grayscale raw buffer to w×h (fit:fill). Identity fast-path.
 *  W7-C fix — .toColourspace("b-w") pins the output to ONE channel: sharp raw
 *  pipelines otherwise promote 1-channel input to 3-channel sRGB on raw output,
 *  which silently tripled these buffers (downscale path + pyramid levels read
 *  the first third of an interleaved plane — geometry scrambled). The finest
 *  level went through the identity fast-path in typical use, which is why
 *  registration still converged; coarse capture range was degraded. */
async function resizeGray(img: GrayImage, w: number, h: number): Promise<Uint8Array> {
  if (img.width === w && img.height === h) {
    return img.data instanceof Uint8Array && !Buffer.isBuffer(img.data)
      ? img.data
      : new Uint8Array(img.data);
  }
  const out = await sharp(Buffer.from(img.data), {
    raw: { width: img.width, height: img.height, channels: 1 },
  })
    .resize(w, h, { fit: "fill" })
    .toColourspace("b-w")
    .raw()
    .toBuffer();
  return new Uint8Array(out);
}

/** Gaussian-blur a grayscale plane then decimate to (nw,nh) — one pyramid step. */
async function blurHalve(g: Uint8Array, w: number, h: number, nw: number, nh: number): Promise<Uint8Array> {
  const out = await sharp(Buffer.from(g), { raw: { width: w, height: h, channels: 1 } })
    .blur(1.0) // σ≈1 low-pass before decimation (anti-alias)
    .resize(nw, nh, { fit: "fill" })
    .toColourspace("b-w")
    .raw()
    .toBuffer();
  return new Uint8Array(out);
}

/**
 * Decode any encoded image (jpeg/png/…) into a grayscale raw plane, optionally
 * capping the longest edge for performance. Exposed so callers can normalise both
 * reference and candidate through one path.
 */
export async function decodeGray(image: Buffer, maxEdge?: number): Promise<GrayImage> {
  let pipe = sharp(image).grayscale();
  if (maxEdge && maxEdge > 0) {
    pipe = pipe.resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true });
  }
  const { data, info } = await pipe.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// ─── Pure numeric core ────────────────────────────────────────────────────────

/** Bilinear sample of a grayscale/gradient plane at continuous (x,y). NaN when outside. */
function sampleBilinear(g: Uint8Array | Float32Array, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return NaN;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = x - x0;
  const fy = y - y0;
  const v00 = g[y0 * w + x0];
  const v10 = g[y0 * w + x1];
  const v01 = g[y1 * w + x0];
  const v11 = g[y1 * w + x1];
  const top = v00 + (v10 - v00) * fx;
  const bot = v01 + (v11 - v01) * fx;
  return top + (bot - top) * fy;
}

/** Central-difference gradients (Gx,Gy) of a grayscale plane. */
function gradients(g: Uint8Array, w: number, h: number): { gx: Float32Array; gy: Float32Array } {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const xm = x > 0 ? g[i - 1] : g[i];
      const xp = x < w - 1 ? g[i + 1] : g[i];
      const ym = y > 0 ? g[i - w] : g[i];
      const yp = y < h - 1 ? g[i + w] : g[i];
      gx[i] = (xp - xm) * 0.5;
      gy[i] = (yp - ym) * 0.5;
    }
  }
  return { gx, gy };
}

/** Solve a small symmetric linear system H·x = b via Gauss–Jordan with partial pivot. */
function solveLinear(H: number[][], b: number[]): number[] | null {
  const n = b.length;
  // Augmented matrix.
  const m = H.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    // Partial pivot.
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < 1e-12) return null; // singular
    [m[col], m[piv]] = [m[piv], m[col]];
    const pivVal = m[col][col];
    for (let c = col; c <= n; c++) m[col][c] /= pivVal;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row) => row[n]);
}

/** Homography 3×3 row-major → apply to (x,y) with perspective divide. */
function applyHomography(Hm: number[], x: number, y: number): { x: number; y: number } {
  const den = Hm[6] * x + Hm[7] * y + Hm[8];
  if (Math.abs(den) < 1e-12) return { x: NaN, y: NaN };
  return {
    x: (Hm[0] * x + Hm[1] * y + Hm[2]) / den,
    y: (Hm[3] * x + Hm[4] * y + Hm[5]) / den,
  };
}

/** Affine params → 3×3 homography row-major (bottom row = [0,0,1]). */
function affineToHomography(p: AffineMatrix): number[] {
  return [1 + p.a, p.b, p.tx, p.c, 1 + p.d, p.ty, 0, 0, 1];
}

/** 3×3 homography row-major → its affine sub-block (drops perspective terms). */
function homographyToAffine(Hm: number[]): AffineMatrix {
  return { a: Hm[0] - 1, b: Hm[1], tx: Hm[2], c: Hm[3], d: Hm[4] - 1, ty: Hm[5] };
}

/**
 * ONE forward-additive Gauss–Newton refinement over the working (ref, cand) pair at
 * a fixed resolution, seeded by homography `Hm` (row-major 9). `nParams` is 6 (affine)
 * or 8 (homography). Returns the refined homography + residual/NCC diagnostics.
 *
 * Forward-additive LK (Baker–Matthews): warp candidate by current p, linearise the
 * candidate intensity w.r.t. p through the chain rule ∂I/∂p = ∇I · ∂W/∂p, accumulate
 * the Gauss–Newton normal equations, solve, add Δp. Continuous bilinear warp ⇒ the
 * fixed point is sub-pixel.
 */
/**
 * Accumulate the Gauss–Newton system (H, g), the sum of squared residual and NCC
 * stats for a given homography over the strided grid. `colScale[k]` PRE-CONDITIONS
 * column k of the Jacobian (Jacobi scaling) so the linear params — whose raw
 * Jacobian is multiplied by pixel coords up to ~w — are conditioned like the
 * translation params. Without this the 6×6 normal matrix is wildly ill-conditioned
 * (κ ∼ w²) and the solve blows up.
 */
function accumulate(
  ref: Uint8Array,
  cand: Uint8Array,
  candGx: Float32Array,
  candGy: Float32Array,
  w: number,
  h: number,
  Hm: number[],
  nParams: number,
  stride: number,
  colScale: number[],
): { H: number[][]; g: number[]; sumSq: number; n: number; ncc: number } {
  const H = Array.from({ length: nParams }, () => new Array(nParams).fill(0));
  const g = new Array(nParams).fill(0);
  let sumSq = 0, n = 0;
  let sR = 0, sW = 0, sRR = 0, sWW = 0, sRW = 0;

  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const p = applyHomography(Hm, x, y);
      const iv = sampleBilinear(cand, w, h, p.x, p.y);
      if (Number.isNaN(iv)) continue;
      const gxv = sampleBilinear(candGx, w, h, p.x, p.y);
      const gyv = sampleBilinear(candGy, w, h, p.x, p.y);
      if (Number.isNaN(gxv) || Number.isNaN(gyv)) continue;
      const rv = ref[y * w + x];
      const err = iv - rv; // minimise |I(W(x;p)) − T(x)|

      // ∇I · ∂W/∂p, then Jacobi-scale each column.
      let jac: number[];
      if (nParams === 2) {
        // Translation-only warm-up: ∂err/∂(tx,ty) = (Gx, Gy).
        jac = [gxv, gyv];
      } else if (nParams === 6) {
        jac = [gxv * x, gxv * y, gxv, gyv * x, gyv * y, gyv];
      } else {
        const den = Hm[6] * x + Hm[7] * y + Hm[8];
        const invDen = den !== 0 ? 1 / den : 0;
        const nx = Hm[0] * x + Hm[1] * y + Hm[2];
        const ny = Hm[3] * x + Hm[4] * y + Hm[5];
        const dxdp = [x * invDen, y * invDen, invDen, 0, 0, 0, -x * nx * invDen * invDen, -y * nx * invDen * invDen];
        const dydp = [0, 0, 0, x * invDen, y * invDen, invDen, -x * ny * invDen * invDen, -y * ny * invDen * invDen];
        jac = new Array(8);
        for (let k = 0; k < 8; k++) jac[k] = gxv * dxdp[k] + gyv * dydp[k];
      }
      for (let k = 0; k < nParams; k++) jac[k] *= colScale[k];

      for (let i = 0; i < nParams; i++) {
        g[i] += jac[i] * err;
        for (let j = i; j < nParams; j++) H[i][j] += jac[i] * jac[j];
      }
      sumSq += err * err;
      n++;
      sR += rv; sW += iv; sRR += rv * rv; sWW += iv * iv; sRW += rv * iv;
    }
  }
  for (let i = 0; i < nParams; i++) for (let j = 0; j < i; j++) H[i][j] = H[j][i];
  let ncc = 0;
  if (n > 0) {
    const meanR = sR / n, meanW = sW / n;
    const cov = sRW / n - meanR * meanW;
    const vR = sRR / n - meanR * meanR;
    const vW = sWW / n - meanW * meanW;
    const den = Math.sqrt(vR * vW);
    ncc = den > 1e-6 ? cov / den : 0;
  }
  return { H, g, sumSq, n, ncc };
}

/** Apply a Jacobi-scaled parameter increment `dp` (already un-scaled here) to Hm. */
function applyIncrement(Hm: number[], dp: number[], nParams: number): number[] {
  const out = Hm.slice();
  if (nParams === 2) {
    out[2] += dp[0]; // tx
    out[5] += dp[1]; // ty
  } else if (nParams === 6) {
    out[0] += dp[0]; out[1] += dp[1]; out[2] += dp[2];
    out[3] += dp[3]; out[4] += dp[4]; out[5] += dp[5];
  } else {
    for (let k = 0; k < 8; k++) out[k] += dp[k];
  }
  return out;
}

function refineLevel(
  ref: Uint8Array,
  cand: Uint8Array,
  candGx: Float32Array,
  candGy: Float32Array,
  w: number,
  h: number,
  seed: number[],
  nParams: number,
  maxIterations: number,
  epsilon: number,
): { H: number[]; rms: number; ncc: number; overlap: number; iterations: number } {
  let Hm = seed.slice();
  const stride = Math.max(1, Math.floor(Math.sqrt((w * h) / 20000)));

  // Jacobi column preconditioner: linear params (cols multiplied by x,y ∼ dim) are
  // scaled by 1/dim so an increment of O(1) in the SCALED space is O(1/dim) in the
  // raw param — equalising conditioning. Translation cols keep scale 1; perspective
  // cols (h6,h7) are tiny in raw terms so scale ∼ 1/dim² would be right, but 1/dim
  // is a safe, robust choice with LM damping.
  const dim = Math.max(w, h);
  const colScale = nParams === 2
    ? [1, 1]
    : nParams === 6
      ? [1 / dim, 1 / dim, 1, 1 / dim, 1 / dim, 1]
      : [1 / dim, 1 / dim, 1, 1 / dim, 1 / dim, 1, 1 / (dim * dim), 1 / (dim * dim)];

  // Levenberg–Marquardt damping (adaptive): grow on a rejected step, shrink on an
  // accepted one → automatic trust region, so a bad linearisation never diverges.
  let lambda = 1e-2;
  let cur = accumulate(ref, cand, candGx, candGy, w, h, Hm, nParams, stride, colScale);
  let lastRms = cur.n > 0 ? Math.sqrt(cur.sumSq / cur.n) : Number.POSITIVE_INFINITY;
  let lastNcc = cur.ncc;
  let lastOverlap = cur.n;
  let iter = 0;

  for (iter = 0; iter < maxIterations; iter++) {
    if (cur.n < nParams * 4) break; // not enough overlap to solve
    // Damped normal equations (H + λ·diag(H))·Δp' = −g in the SCALED space.
    const Hd = cur.H.map((row) => row.slice());
    for (let i = 0; i < nParams; i++) Hd[i][i] += lambda * (Hd[i][i] + 1e-9);
    const neg = cur.g.map((v) => -v);
    const dpScaled = solveLinear(Hd, neg);
    if (!dpScaled) break;

    // Un-scale the increment back to raw homography units.
    const dp = dpScaled.map((v, k) => v * colScale[k]);
    const candHm = applyIncrement(Hm, dp, nParams);
    const trial = accumulate(ref, cand, candGx, candGy, w, h, candHm, nParams, stride, colScale);
    const trialRms = trial.n > 0 ? Math.sqrt(trial.sumSq / trial.n) : Number.POSITIVE_INFINITY;

    if (trial.n >= nParams * 4 && trialRms < lastRms) {
      // Accept: move, shrink damping, check convergence.
      Hm = candHm;
      cur = trial;
      const improved = lastRms - trialRms;
      lastRms = trialRms;
      lastNcc = trial.ncc;
      lastOverlap = trial.n;
      lambda = Math.max(lambda * 0.5, 1e-6);
      let norm = 0;
      for (const v of dpScaled) norm += v * v;
      if (Math.sqrt(norm) < epsilon || improved < 1e-4) { iter++; break; }
    } else {
      // Reject: increase damping and retry (more gradient-descent-like, smaller step).
      lambda *= 4;
      if (lambda > 1e8) { iter++; break; }
    }
  }

  return { H: Hm, rms: lastRms, ncc: lastNcc, overlap: lastOverlap, iterations: iter };
}

/**
 * Warp candidate into the reference frame → grayscale raw W×H. `Hm` maps a REFERENCE
 * coordinate (0..W, 0..H) to a CANDIDATE coordinate (in its own cw×ch space), so each
 * output pixel is filled by sampling the candidate at Hm(x,y). No extra scaling.
 */
function warpToReference(cand: Uint8Array, cw: number, ch: number, Hm: number[], W: number, H: number): Buffer {
  const out = Buffer.alloc(W * H, 0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = applyHomography(Hm, x, y);
      const v = sampleBilinear(cand, cw, ch, p.x, p.y);
      out[y * W + x] = Number.isNaN(v) ? 0 : Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return out;
}

/** Decompose the affine linear part into an effective rotation (deg) and mean scale. */
function decomposeAffine(p: AffineMatrix): { rotationDeg: number; scale: number } {
  const a = 1 + p.a, b = p.b, c = p.c, d = 1 + p.d;
  const sx = Math.hypot(a, c);
  const sy = Math.hypot(b, d);
  const rot = Math.atan2(c, a) * (180 / Math.PI);
  return { rotationDeg: rot, scale: (sx + sy) / 2 };
}

/**
 * Estimate the sub-pixel registration of `candidate` onto `reference`.
 *
 * Both inputs are grayscale raw (GrayImage). The candidate is warped INTO the
 * reference coordinate frame; `alignedBuffer` is that warped candidate at the
 * reference's native W×H (so the caller can diff aligned-vs-reference directly).
 */
export async function registerToReference(
  reference: GrayImage,
  candidate: GrayImage,
  opts: RegisterOptions = {},
): Promise<RegistrationResult> {
  const model: RegistrationModel = opts.model ?? "affine";
  const nParams = model === "homography" ? 8 : 6;
  const workSize = opts.workSize ?? 512;
  const levels = Math.max(1, opts.pyramidLevels ?? 4);
  const maxIterations = opts.maxIterations ?? 30;
  const epsilon = opts.epsilon ?? 1e-4;
  const minConfidence = opts.minConfidence ?? 0.6;
  const maxResidual = opts.maxResidual ?? 40;
  const minOverlap = opts.minOverlap ?? 0.4;

  const W = reference.width;
  const H = reference.height;

  // Working resolution: cap the longest edge at workSize (keep aspect).
  const longest = Math.max(W, H);
  const wscale = longest > workSize ? workSize / longest : 1;
  const workW = Math.max(8, Math.round(W * wscale));
  const workH = Math.max(8, Math.round(H * wscale));

  const refWork = await resizeGray(reference, workW, workH);
  const candWork = await resizeGray(candidate, workW, workH);

  // Build Gaussian pyramid (finest → coarsest) by blurring then halving via sharp.
  // Blur-before-decimate is the Gaussian-pyramid recipe: it band-limits so the coarse
  // level is anti-aliased (a large-capture-range guide for coarse-to-fine). The
  // coarsest level is kept ≥ MIN_LEVEL_DIM px — below that gradients are too coarse to
  // give a usable seed and a degenerate level would poison the finer refinements.
  const MIN_LEVEL_DIM = 40;
  interface Level { ref: Uint8Array; cand: Uint8Array; gx: Float32Array; gy: Float32Array; w: number; h: number; }
  const pyr: Level[] = [];
  let curRef = refWork, curCand = candWork, cw = workW, ch = workH;
  for (let l = 0; l < levels; l++) {
    const { gx, gy } = gradients(curCand, cw, ch);
    pyr.push({ ref: curRef, cand: curCand, gx, gy, w: cw, h: ch });
    const nw = Math.floor(cw / 2);
    const nh = Math.floor(ch / 2);
    if (l === levels - 1 || nw < MIN_LEVEL_DIM || nh < MIN_LEVEL_DIM) break;
    curRef = await blurHalve(curRef, cw, ch, nw, nh);
    curCand = await blurHalve(curCand, cw, ch, nw, nh);
    cw = nw; ch = nh;
  }

  // Coarse→fine: refine at each level, propagating the (scaled) estimate downward.
  //
  // ROBUSTNESS — two complementary safeguards against the classic LK failure of a
  // spurious high-DoF solution on weak-gradient / smooth content:
  //   1. MODEL warm-up: refine TRANSLATION-ONLY (2-DoF) first, then unlock the full
  //      affine/homography. Translation is well-conditioned everywhere, so it pulls
  //      the estimate into the correct basin before the ill-conditioned linear part
  //      is allowed to move — this prevents the solver from "explaining" a shift with
  //      a bogus scale/rotation.
  //   2. IDENTITY restart: also refine from identity and keep whichever candidate
  //      yields the lower residual, so a diverged coarse seed can never trap a finer
  //      level. `seed` is a homography row-major 9-vector.
  const identity = affineToHomography({ a: 0, b: 0, tx: 0, c: 0, d: 0, ty: 0 });
  let seed = identity.slice();
  let last = { H: seed, rms: Number.POSITIVE_INFINITY, ncc: 0, overlap: 0, iterations: 0 };

  const refineWithWarmup = (lv: Level, start: number[]) => {
    // Stage 1: translation-only (cheap, robust) to lock the shift.
    const t = refineLevel(lv.ref, lv.cand, lv.gx, lv.gy, lv.w, lv.h, start, 2, maxIterations, epsilon);
    // Stage 2: full model from the translation-locked estimate.
    return refineLevel(lv.ref, lv.cand, lv.gx, lv.gy, lv.w, lv.h, t.H, nParams, maxIterations, epsilon);
  };

  for (let l = pyr.length - 1; l >= 0; l--) {
    const lv = pyr[l];
    let res = refineWithWarmup(lv, seed);
    // Only bother with the identity restart when the seed differs from identity.
    const seedIsIdentity = seed.every((v, i) => Math.abs(v - identity[i]) < 1e-9);
    if (!seedIsIdentity) {
      const fromId = refineWithWarmup(lv, identity.slice());
      if (fromId.rms < res.rms) res = fromId;
    }
    last = res;
    if (l > 0) {
      // Going one level finer, coords double → translation (and perspective) scale.
      const finer = pyr[l - 1];
      const s = finer.w / lv.w; // ≈ 2
      const up = res.H.slice();
      up[2] *= s; // tx
      up[5] *= s; // ty
      if (nParams === 8) { up[6] /= s; up[7] /= s; } // perspective terms scale inversely
      seed = up;
    }
  }

  const finestHm = last.H;

  // Express the estimate in NATIVE reference coordinates so every reported quantity
  // (affine, dx/dy, rotation, scale) is self-consistent with `alignedBuffer` (native)
  // and reflects the resolution the caller actually diffs at. H_native maps native ref
  // coords → native candidate coords: H_native = S · H_work · S⁻¹, S = diag(1/wscale).
  const Hnative = scaleHomography(finestHm, 1 / wscale);
  const affine = homographyToAffine(Hnative);

  // FINAL diagnostics at NATIVE resolution (honest — this is the true diff quality).
  const refNative = await resizeGray(reference, W, H);
  const candNative = await resizeGray(candidate, candidate.width, candidate.height);
  const finalStats = evalRegistration(refNative, candNative, Hnative, W, H, candidate.width, candidate.height);
  // Baseline: how well does doing NOTHING (identity) fit at native res? If the warp
  // does not clearly beat this, the estimate is not trustworthy (e.g. a coarse level
  // diverged, or the images simply don't relate by an affine) → reject honestly.
  const identityNative = affineToHomography({ a: 0, b: 0, tx: 0, c: 0, d: 0, ty: 0 });
  const baseline = evalRegistration(refNative, candNative, identityNative, W, H, candidate.width, candidate.height);

  const alignedBuffer = warpToReference(candNative, candidate.width, candidate.height, Hnative, W, H);

  const { rotationDeg, scale } = decomposeAffine(affine);
  const overlapFrac = finalStats.overlap / (W * H);
  const ncc = Math.max(-1, Math.min(1, finalStats.ncc));
  const confidence = Math.max(0, Math.min(1, ncc));
  const rmsResidual = finalStats.rms;

  // ── GATE (honest degradation) ──
  const okConfidence = confidence >= minConfidence;
  const okResidual = rmsResidual <= maxResidual;
  const okOverlap = overlapFrac >= minOverlap;
  // The warp must not be WORSE than identity (allow a tiny tolerance for resample
  // noise). A diverged estimate that increases the residual is rejected outright.
  const okImproves = rmsResidual <= baseline.rms + 1.0;
  const aligned = okConfidence && okResidual && okOverlap && okImproves;
  const reasons: string[] = [];
  if (!okConfidence) reasons.push(`low confidence ${confidence.toFixed(3)} < ${minConfidence}`);
  if (!okResidual) reasons.push(`high residual ${rmsResidual.toFixed(1)} > ${maxResidual}`);
  if (!okOverlap) reasons.push(`insufficient overlap ${(overlapFrac * 100).toFixed(0)}% < ${(minOverlap * 100).toFixed(0)}%`);
  if (!okImproves) reasons.push(`warp did not improve fit (residual ${rmsResidual.toFixed(1)} vs identity ${baseline.rms.toFixed(1)})`);

  return {
    model,
    affine,
    homography: Hnative,
    rmsResidual: Number(rmsResidual.toFixed(4)),
    ncc: Number(ncc.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    overlap: Number(overlapFrac.toFixed(4)),
    dx: Number(affine.tx.toFixed(4)),
    dy: Number(affine.ty.toFixed(4)),
    rotationDeg: Number(rotationDeg.toFixed(4)),
    scale: Number(scale.toFixed(4)),
    alignedBuffer,
    alignedWidth: W,
    alignedHeight: H,
    aligned,
    reason: aligned ? "" : reasons.join("; "),
    iterations: last.iterations,
  };
}

/** Scale a homography for a change of coordinate units by factor s (S = diag(s,s,1)). */
function scaleHomography(Hm: number[], s: number): number[] {
  // H' = S · H · S⁻¹ where S = diag(s, s, 1). Expanded for the 3×3.
  const S = [s, 0, 0, 0, s, 0, 0, 0, 1];
  const Sinv = [1 / s, 0, 0, 0, 1 / s, 0, 0, 0, 1];
  return mat3mul(mat3mul(S, Hm), Sinv);
}

function mat3mul(A: number[], B: number[]): number[] {
  const C = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
  return C;
}

/**
 * Evaluate residual/NCC/overlap of a homography over the full reference grid (no
 * stride). The reference grid is `w×h`; the candidate is sampled through `Hm` in its
 * OWN `cw×ch` space (may differ from the reference dims).
 */
function evalRegistration(
  ref: Uint8Array,
  cand: Uint8Array,
  Hm: number[],
  w: number,
  h: number,
  cw: number = w,
  ch: number = h,
): { rms: number; ncc: number; overlap: number } {
  let sumSq = 0, n = 0;
  let sR = 0, sW = 0, sRR = 0, sWW = 0, sRW = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = applyHomography(Hm, x, y);
      const iv = sampleBilinear(cand, cw, ch, p.x, p.y);
      if (Number.isNaN(iv)) continue;
      const rv = ref[y * w + x];
      const err = iv - rv;
      sumSq += err * err;
      sR += rv; sW += iv; sRR += rv * rv; sWW += iv * iv; sRW += rv * iv;
      n++;
    }
  }
  if (n === 0) return { rms: 255, ncc: 0, overlap: 0 };
  const meanR = sR / n, meanW = sW / n;
  const cov = sRW / n - meanR * meanW;
  const vR = sRR / n - meanR * meanR;
  const vW = sWW / n - meanW * meanW;
  const den = Math.sqrt(vR * vW);
  return { rms: Math.sqrt(sumSq / n), ncc: den > 1e-6 ? cov / den : 0, overlap: n };
}

/**
 * Per-pixel diff ratio between two grayscale planes (threshold). Small helper for
 * callers/tests to verify a diff shrinks after registration.
 */
export function diffRatioGray(
  a: Uint8Array | Buffer,
  b: Uint8Array | Buffer,
  threshold = 25,
): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let diff = 0;
  for (let i = 0; i < n; i++) if (Math.abs(a[i] - b[i]) > threshold) diff++;
  return diff / n;
}
