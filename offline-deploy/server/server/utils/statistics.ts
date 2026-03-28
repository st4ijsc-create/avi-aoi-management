/**
 * Shared statistical utility functions used across AI and SPC routers.
 * Extracted to avoid duplication between aiRouters.ts and spcAdvancedRouter.ts.
 */

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdDev(values: number[], m: number, sample = true): number {
  if (values.length < 2) return 0;
  const divisor = sample ? values.length - 1 : values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / divisor);
}

/**
 * Pearson correlation coefficient between two equal-length series.
 * Returns 0 when there are fewer than 3 paired observations.
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  const mx = mean(x);
  const my = mean(y);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i] - mx;
    const yi = y[i] - my;
    num += xi * yi;
    dx += xi * xi;
    dy += yi * yi;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : num / denom;
}

/**
 * Two-tailed p-value approximation for a Pearson correlation coefficient.
 * Uses the t-distribution approximation: t = r * sqrt((n-2)/(1-r^2))
 * Returns 1.0 when the sample is too small to compute.
 */
export function correlationPValue(r: number, n: number): number {
  if (n <= 2 || Math.abs(r) >= 1) return n <= 2 ? 1.0 : 0.0;
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  // Abramowitz & Stegun approximation for the t-distribution CDF tail
  const df = n - 2;
  const x = df / (df + t * t);
  const a = 0.5 * incompleteBeta(x, df / 2, 0.5);
  return Math.min(1, Math.max(0, a));
}

/** Regularised incomplete Beta function via continued-fraction (Lentz method) */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  return front * betaCF(x, a, b);
}

function betaCF(x: number, a: number, b: number): number {
  const MAX_ITER = 200;
  const EPS = 3e-7;
  let c = 1, d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    // Even step
    let num = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + num * d;
    c = 1 + num / c;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    // Odd step
    num = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d;
    c = 1 + num / c;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return h;
}

function lgamma(z: number): number {
  // Lanczos approximation
  const g = 7;
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = p[0];
  for (let i = 1; i < g + 2; i++) x += p[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
