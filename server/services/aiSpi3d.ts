/**
 * aiSpi3d.ts — NATIVE 3D / SPI (Solder-Paste Inspection) metrology (pure TypeScript).
 *
 * Today the 3D/SPI values (volume / height / coplanarity / warpage / void / offset)
 * are only TRANSPORTED through a vendor adapter (see vision/adapters/kohYoung.ts —
 * pure pass-through). This module adds REAL native computation: given a calibrated
 * height-map (2-D array of Z heights in µm) or per-pad 3-D point samples + the pad
 * geometry (bbox / mask from segmentation, or provided), it derives per-pad SPI
 * metrics and classifies each pad against configurable IPC-7527-style thresholds.
 *
 * DESIGN — mirrors server/services/aiMetrology.ts:
 *   • Deterministic, dependency-free pure math (no onnxruntime, no sharp — the input
 *     is already a numeric height-map; a decoder can feed it a Float32 grid).
 *   • HONEST about calibration. Z is given in µm. LATERAL scale (µm/pixel) is what
 *     turns pixel footprints into physical area/volume/offset. When lateral
 *     calibration is ABSENT we still return numbers, but in the PIXEL domain and
 *     with unit:"px" + degraded:true — exactly like aiMetrology. We never fabricate a
 *     physical scale we don't have. (Height-derived ratios such as heightPct stay
 *     valid because Z is µm regardless of lateral calibration.)
 *
 * METRICS PER PAD:
 *   • volume        — Σ (height-above-base) · pixel-footprint-area  (µm³ | µm·px²)
 *   • area          — footprint of paste above the base threshold   (µm² | px²)
 *   • meanHeight    — mean Z over paste pixels                        (µm)
 *   • maxHeight     — max Z over the pad region                       (µm)
 *   • offsetX/Y     — height-weighted paste centroid − pad centroid = registration
 *                     error                                            (µm | px)
 *   • volumePct / heightPct / areaPct — % of nominal (IPC-7527 convention)
 *   • coplanarity   — peak-to-peak deviation of the pad mean-heights of a COMPONENT
 *                     from their least-squares best-fit plane          (µm)
 *   • surfaceVoidPct— fraction of the footprint that dips below voidDepthFraction·mean
 *                     (a SURFACE-dimple proxy — SPI top-down cannot see sub-surface
 *                     X-ray voids; documented as such, not fabricated)  (%)
 *   • bridging      — a single connected paste blob spanning ≥2 pad footprints
 *
 * DEFECT CLASSES (one primary per pad, most-severe wins; all triggers in `flags`):
 *   bridged  > excessive > insufficient > misaligned > good
 *
 * BOARD ROLL-UP: per-pad → board (Σ volume, board pass/fail, board warpage = p2p of
 * pad heights vs a global best-fit plane) and enrichCanonicalWithSpi3d() writes the
 * values into the CANONICAL inspection shape (the existing valueVolume / valueHeight /
 * valueCoplanarity … columns) so they flow to storage + SPC unchanged.
 *
 * FLAG: SPI_3D_NATIVE_ENABLED (default OFF). enrichCanonicalWithSpi3d is a pure
 * PASS-THROUGH when the flag is off OR no height-map is supplied — the current vendor
 * pass-through behaviour is byte-for-byte unchanged. When on AND a height-map is
 * present, native values are PREFERRED per pad; pads without a height-map keep the
 * adapter's transported values (honest, additive composition).
 *
 * Backward-compatible: NEW file; touches no existing service.
 */

import type { CanonicalInspection, CanonicalMeasurement, CanonicalDefectSeverity } from "./vision/visionAdapterRegistry";

// ════════════════════════════════════════════════════════════════════════════
// Flag
// ════════════════════════════════════════════════════════════════════════════

/** Master flag — default OFF. When off, enrichCanonicalWithSpi3d is pure pass-through. */
export function spi3dNativeEnabled(): boolean {
  return process.env.SPI_3D_NATIVE_ENABLED === "true";
}

// ════════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════════

/** Row-major height-map. `data[y*width + x]` = raw Z at pixel (x,y). Z is in µm unless zScale given. */
export interface HeightMap {
  data: Float32Array | Float64Array | number[];
  width: number;
  height: number;
}

/** Full-size (width×height of the height-map) footprint mask; pixel >= 0.5 ⇒ inside the pad aperture. */
export interface PadMask {
  data: Uint8Array | Float32Array | number[];
  width: number;
  height: number;
}

/** Pad geometry — where the aperture / stencil opening is, plus optional nominal targets. */
export interface PadGeometry {
  /** Matches the canonical measurement's pointCode/pointId so results can be merged back. */
  padId: string;
  /** Pixel bbox of the pad aperture on the height-map. */
  bbox: { x: number; y: number; w: number; h: number };
  /** Optional precise footprint (full height-map sized); restricts analysis to the aperture. */
  mask?: PadMask;
  /** Groups pads of one component for coplanarity (e.g. a QFN/BGA). */
  componentId?: string;
  /** Nominal (ideal 100%-transfer) deposit volume — µm³ when lateral-calibrated. */
  nominalVolume?: number;
  /** Nominal paste height = stencil thickness (µm). */
  nominalHeight?: number;
  /** Nominal aperture area — µm² when lateral-calibrated. */
  nominalArea?: number;
}

/** Metrology calibration. Absent lateral scale ⇒ degraded (pixel domain). */
export interface SpiCalibration {
  /** Lateral µm per pixel in X. Absent ⇒ degraded. */
  umPerPxX?: number | null;
  /** Lateral µm per pixel in Y (defaults to umPerPxX). */
  umPerPxY?: number | null;
  /** Raw-Z → µm multiplier (default 1; height-maps are usually already µm in Z). */
  zScale?: number | null;
}

/** IPC-7527-style acceptance thresholds (all user-configurable; these are typical defaults). */
export interface SpiThresholds {
  /** Volume below this % of nominal ⇒ insufficient. */
  volumeLowPct: number;
  /** Volume above this % of nominal ⇒ excessive. */
  volumeHighPct: number;
  /** Height gates (fallback when volume % unavailable). */
  heightLowPct: number;
  heightHighPct: number;
  /** Area gates (informational; do not by themselves fail a pad). */
  areaLowPct: number;
  areaHighPct: number;
  /** Registration offset limit as a fraction (0..1) of pad width. */
  offsetMaxPctOfPad: number;
  /** Absolute offset limit (µm) — used instead of pct when set AND lateral-calibrated. */
  offsetMaxUm: number | null;
  /** Height (µm, above base) at/above which a pixel counts as "paste present". null ⇒ derived. */
  pasteThresholdUm: number | null;
  /** Board reference height (µm) subtracted from every Z (leveling). */
  baseHeightUm: number;
  /** Footprint pixel dipping below this fraction of the pad mean ⇒ surface-void pixel. */
  voidDepthFraction: number;
  /**
   * ROI margin (pixels) added around the aperture bbox for PASTE accumulation, so a
   * deposit that has shifted partly off the aperture is still captured (its centroid
   * vs the aperture centroid = the registration offset). The pad's nominal centre
   * stays the APERTURE centre. Ignored when a mask is supplied (the mask IS the exact
   * region). Keep it < half the pad pitch to avoid pulling in a neighbour's paste.
   * Default 0 (analysis == aperture bbox).
   */
  searchMarginPx: number;
}

export const DEFAULT_SPI_THRESHOLDS: SpiThresholds = {
  volumeLowPct: 50,
  volumeHighPct: 150,
  heightLowPct: 50,
  heightHighPct: 150,
  areaLowPct: 50,
  areaHighPct: 150,
  offsetMaxPctOfPad: 0.5,
  offsetMaxUm: null,
  pasteThresholdUm: null,
  baseHeightUm: 0,
  voidDepthFraction: 0.5,
  searchMarginPx: 0,
};

export type SpiDefectClass = "good" | "insufficient" | "excessive" | "bridged" | "misaligned";

/** Per-pad SPI result. `*Px` fields are always the raw pixel-domain values; the un-suffixed
 * lateral fields (area/volume/offset) equal the *Px values when degraded, else are scaled. */
export interface PadSpiResult {
  padId: string;
  componentId?: string;
  /** Deposited volume: µm³ when calibrated, µm·px² (degraded) otherwise. */
  volume: number;
  /** Paste footprint area above base: µm² when calibrated, px² otherwise. */
  area: number;
  areaPx: number;
  /** Mean paste height (µm) — always physical (Z is µm). */
  meanHeight: number;
  /** Max height in the pad region (µm). */
  maxHeight: number;
  /** Registration error (paste centroid − pad centroid): µm when calibrated, px otherwise. */
  offsetX: number;
  offsetY: number;
  offsetXPx: number;
  offsetYPx: number;
  /** % of nominal (null when no nominal supplied → not fabricated). */
  volumePct: number | null;
  heightPct: number | null;
  areaPct: number | null;
  /** Component coplanarity (µm, peak-to-peak vs best-fit plane); null until board roll-up. */
  coplanarity: number | null;
  /** Surface-void proxy (%). */
  surfaceVoidPct: number;
  /** Number of paste pixels (h ≥ threshold) — diagnostic. */
  pixelCount: number;
  /** Primary defect class. */
  defectClass: SpiDefectClass;
  /** Every triggered condition (superset; may include several). */
  flags: SpiDefectClass[];
  /** Canonical pad result. */
  result: "OK" | "NG";
  /** Severity for the defect (undefined when good). */
  severity?: CanonicalDefectSeverity;
  /** "um" when lateral-calibrated, else "px". */
  unit: "um" | "px";
  umPerPx: number | null;
  /** true ⇒ no lateral calibration → lateral metrics are pixel-domain, NOT physical. */
  degraded: boolean;
}

export interface BoardSpiResult {
  pads: PadSpiResult[];
  /** Σ pad volumes. */
  boardVolume: number;
  /** Board warpage: peak-to-peak of pad mean-heights vs a global best-fit plane (µm). */
  warpage: number | null;
  /** NG if any pad NG. */
  boardResult: "OK" | "NG";
  unit: "um" | "px";
  degraded: boolean;
  /** Paste-present threshold (µm above base) actually used. */
  pasteThresholdUm: number;
}

export interface Point3D { x: number; y: number; z: number; }

export interface ComputeOptions {
  calibration?: SpiCalibration | null;
  thresholds?: Partial<SpiThresholds>;
}

// ════════════════════════════════════════════════════════════════════════════
// Small helpers
// ════════════════════════════════════════════════════════════════════════════

const r4 = (n: number) => Number(n.toFixed(4));

function resolveThresholds(t?: Partial<SpiThresholds>): SpiThresholds {
  return { ...DEFAULT_SPI_THRESHOLDS, ...(t ?? {}) };
}

function rawAt(hm: HeightMap, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= hm.width || y >= hm.height) return 0;
  return Number(hm.data[y * hm.width + x]) || 0;
}

function maskOn(mask: PadMask | undefined, x: number, y: number): boolean {
  if (!mask) return true;
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  return Number(mask.data[y * mask.width + x]) >= 0.5;
}

/** Least-squares plane z = a·x + b·y + c through ≥3 points; null if singular/insufficient. */
function fitPlane(pts: Point3D[]): { a: number; b: number; c: number } | null {
  const n = pts.length;
  if (n < 3) return null;
  let Sxx = 0, Sxy = 0, Sx = 0, Syy = 0, Sy = 0, Sxz = 0, Syz = 0, Sz = 0;
  for (const p of pts) {
    Sxx += p.x * p.x; Sxy += p.x * p.y; Sx += p.x;
    Syy += p.y * p.y; Sy += p.y;
    Sxz += p.x * p.z; Syz += p.y * p.z; Sz += p.z;
  }
  // Normal equations M·[a b c]^T = r
  const M = [
    [Sxx, Sxy, Sx],
    [Sxy, Syy, Sy],
    [Sx, Sy, n],
  ];
  const r = [Sxz, Syz, Sz];
  const sol = solve3(M, r);
  return sol ? { a: sol[0], b: sol[1], c: sol[2] } : null;
}

/** Solve a 3×3 linear system by Gaussian elimination with partial pivoting. null if singular. */
function solve3(m: number[][], r: number[]): [number, number, number] | null {
  const a = m.map((row, i) => [...row, r[i]]);
  for (let col = 0; col < 3; col++) {
    // pivot
    let piv = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[piv][col])) piv = row;
    }
    if (Math.abs(a[piv][col]) < 1e-12) return null;
    [a[col], a[piv]] = [a[piv], a[col]];
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const f = a[row][col] / a[col][col];
      for (let k = col; k < 4; k++) a[row][k] -= f * a[col][k];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

/** Peak-to-peak of residuals of pts vs plane (or vs mean-z if plane null). */
function planeP2P(pts: Point3D[]): number {
  if (pts.length === 0) return 0;
  if (pts.length < 3) {
    const zs = pts.map((p) => p.z);
    return Math.max(...zs) - Math.min(...zs);
  }
  const plane = fitPlane(pts);
  let lo = Infinity, hi = -Infinity;
  if (!plane) {
    for (const p of pts) { if (p.z < lo) lo = p.z; if (p.z > hi) hi = p.z; }
    return hi - lo;
  }
  for (const p of pts) {
    const res = p.z - (plane.a * p.x + plane.b * p.y + plane.c);
    if (res < lo) lo = res;
    if (res > hi) hi = res;
  }
  return hi - lo;
}

// ════════════════════════════════════════════════════════════════════════════
// Per-pad raw analysis (pixel domain, calibration-independent)
// ════════════════════════════════════════════════════════════════════════════

interface PadRaw {
  padId: string;
  componentId?: string;
  pixelCount: number;
  sumHeight: number;        // Σ h over paste pixels (µm)
  sumXH: number;            // Σ x·h  (weighted centroid numerator)
  sumYH: number;            // Σ y·h
  maxHeight: number;
  padCx: number;            // pad geometric centroid (px)
  padCy: number;
  footprintPixels: number;  // pixels considered part of the aperture footprint
  voidPixels: number;
  bboxW: number;            // pad width (px)
  bboxH: number;
}

function analyzePadRaw(
  hm: HeightMap,
  geom: PadGeometry,
  zScale: number,
  base: number,
  pasteThreshold: number,
  voidDepthFraction: number,
  searchMarginPx: number,
): PadRaw {
  const { x: bx, y: by, w: bw, h: bh } = geom.bbox;
  const hasMask = !!geom.mask;

  // Aperture bbox (clamped) — defines the pad nominal centre + the void footprint.
  const ax0 = Math.max(0, Math.floor(bx));
  const ay0 = Math.max(0, Math.floor(by));
  const ax1 = Math.min(hm.width - 1, Math.floor(bx + bw - 1));
  const ay1 = Math.min(hm.height - 1, Math.floor(by + bh - 1));

  // Pass A0: aperture centroid + footprint (bbox ∩ mask).
  let footprintPixels = 0, apSumX = 0, apSumY = 0;
  for (let y = ay0; y <= ay1; y++) {
    for (let x = ax0; x <= ax1; x++) {
      if (!maskOn(geom.mask, x, y)) continue;
      footprintPixels++;
      apSumX += x;
      apSumY += y;
    }
  }
  const padCx = footprintPixels > 0 ? apSumX / footprintPixels : bx + (bw - 1) / 2;
  const padCy = footprintPixels > 0 ? apSumY / footprintPixels : by + (bh - 1) / 2;

  // Paste analysis WINDOW: masked ⇒ exact aperture (margin ignored); unmasked ⇒ bbox±margin.
  const margin = hasMask ? 0 : Math.max(0, Math.floor(searchMarginPx));
  const wx0 = Math.max(0, ax0 - margin);
  const wy0 = Math.max(0, ay0 - margin);
  const wx1 = Math.min(hm.width - 1, ax1 + margin);
  const wy1 = Math.min(hm.height - 1, ay1 + margin);

  // Pass A: paste accumulation over the window.
  let pixelCount = 0, sumHeight = 0, sumXH = 0, sumYH = 0, maxHeight = -Infinity;
  for (let y = wy0; y <= wy1; y++) {
    for (let x = wx0; x <= wx1; x++) {
      if (hasMask && !maskOn(geom.mask, x, y)) continue;
      const h = rawAt(hm, x, y) * zScale - base;
      if (h > maxHeight) maxHeight = h;
      if (h >= pasteThreshold) {
        pixelCount++;
        sumHeight += h;
        sumXH += x * h;
        sumYH += y * h;
      }
    }
  }
  if (!isFinite(maxHeight)) maxHeight = 0;

  // Pass B: surface-void pixels (aperture footprint pixels dipping below fraction of the mean).
  const meanH = pixelCount > 0 ? sumHeight / pixelCount : 0;
  const voidCut = voidDepthFraction * meanH;
  let voidPixels = 0;
  if (meanH > 0) {
    for (let y = ay0; y <= ay1; y++) {
      for (let x = ax0; x <= ax1; x++) {
        if (!maskOn(geom.mask, x, y)) continue;
        const h = rawAt(hm, x, y) * zScale - base;
        if (h < voidCut) voidPixels++;
      }
    }
  }

  return {
    padId: geom.padId,
    componentId: geom.componentId,
    pixelCount,
    sumHeight,
    sumXH,
    sumYH,
    maxHeight,
    padCx,
    padCy,
    footprintPixels,
    voidPixels,
    bboxW: bw,
    bboxH: bh,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Bridging — a single connected paste blob spanning ≥2 pad footprints
// ════════════════════════════════════════════════════════════════════════════

/**
 * Returns a Set of pad indices that are bridged. Builds a global paste mask
 * (h ≥ threshold), 8-connectivity connected components, and flags every pad whose
 * footprint is touched by a component that also touches ≥1 OTHER pad. Gap pixels
 * (owner = −1) act as connectors, so a solder ridge across the gap merges two
 * deposits into one component ⇒ both pads flagged.
 */
function detectBridges(
  hm: HeightMap,
  pads: PadGeometry[],
  zScale: number,
  base: number,
  pasteThreshold: number,
): Set<number> {
  const W = hm.width, H = hm.height, N = W * H;
  const bridged = new Set<number>();
  if (pads.length < 2) return bridged;

  // owner[p] = index of the pad whose footprint contains pixel p (first pad wins), else -1.
  const owner = new Int32Array(N).fill(-1);
  for (let pi = 0; pi < pads.length; pi++) {
    const g = pads[pi];
    const x0 = Math.max(0, Math.floor(g.bbox.x));
    const y0 = Math.max(0, Math.floor(g.bbox.y));
    const x1 = Math.min(W - 1, Math.floor(g.bbox.x + g.bbox.w - 1));
    const y1 = Math.min(H - 1, Math.floor(g.bbox.y + g.bbox.h - 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!maskOn(g.mask, x, y)) continue;
        const idx = y * W + x;
        if (owner[idx] === -1) owner[idx] = pi;
      }
    }
  }

  // paste mask
  const paste = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const h = rawAt(hm, x, y) * zScale - base;
      if (h >= pasteThreshold) paste[y * W + x] = 1;
    }
  }

  // connected components (8-conn) via iterative stack flood-fill
  const visited = new Uint8Array(N);
  const stack: number[] = [];
  for (let start = 0; start < N; start++) {
    if (paste[start] === 0 || visited[start] === 1) continue;
    const owners = new Set<number>();
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    while (stack.length > 0) {
      const idx = stack.pop() as number;
      if (owner[idx] >= 0) owners.add(owner[idx]);
      const cx = idx % W;
      const cy = (idx - cx) / W;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const nidx = ny * W + nx;
          if (paste[nidx] === 1 && visited[nidx] === 0) {
            visited[nidx] = 1;
            stack.push(nidx);
          }
        }
      }
    }
    if (owners.size >= 2) for (const o of owners) bridged.add(o);
  }
  return bridged;
}

// ════════════════════════════════════════════════════════════════════════════
// Classification
// ════════════════════════════════════════════════════════════════════════════

const SEVERITY: Record<SpiDefectClass, CanonicalDefectSeverity | undefined> = {
  bridged: "critical",
  insufficient: "major",
  excessive: "major",
  misaligned: "minor",
  good: undefined,
};

function classify(
  volumePct: number | null,
  heightPct: number | null,
  offsetMag: number,
  offsetLimit: number,
  isBridged: boolean,
  t: SpiThresholds,
): { defectClass: SpiDefectClass; flags: SpiDefectClass[] } {
  const flags: SpiDefectClass[] = [];
  if (isBridged) flags.push("bridged");

  const volHigh = volumePct !== null && volumePct > t.volumeHighPct;
  const volLow = volumePct !== null && volumePct < t.volumeLowPct;
  const hHigh = heightPct !== null && heightPct > t.heightHighPct;
  const hLow = heightPct !== null && heightPct < t.heightLowPct;
  if (volHigh || hHigh) flags.push("excessive");
  if (volLow || hLow) flags.push("insufficient");
  if (offsetLimit > 0 && offsetMag > offsetLimit) flags.push("misaligned");

  // Most-severe wins.
  const order: SpiDefectClass[] = ["bridged", "excessive", "insufficient", "misaligned"];
  const defectClass = order.find((c) => flags.includes(c)) ?? "good";
  return { defectClass, flags };
}

// ════════════════════════════════════════════════════════════════════════════
// Board computation
// ════════════════════════════════════════════════════════════════════════════

/**
 * Compute SPI metrics for every pad of a board from ONE height-map. Includes
 * bridging (needs the whole map), coplanarity (per componentId) and board warpage.
 */
export function computeBoardSpi(
  hm: HeightMap,
  pads: PadGeometry[],
  opts: ComputeOptions = {},
): BoardSpiResult {
  const t = resolveThresholds(opts.thresholds);
  const cal = opts.calibration ?? {};
  const zScale = typeof cal.zScale === "number" && isFinite(cal.zScale) && cal.zScale > 0 ? cal.zScale : 1;
  const kx = typeof cal.umPerPxX === "number" && isFinite(cal.umPerPxX) && cal.umPerPxX > 0 ? cal.umPerPxX : null;
  const ky = typeof cal.umPerPxY === "number" && isFinite(cal.umPerPxY) && cal.umPerPxY > 0
    ? cal.umPerPxY
    : kx; // default square pixels
  const calibrated = kx !== null;
  const scaleX = calibrated ? (kx as number) : 1;
  const scaleY = calibrated ? (ky as number) : 1;
  const pixelArea = calibrated ? scaleX * scaleY : 1; // µm² per pixel, else 1 (px²)
  const base = t.baseHeightUm;

  // ── derive the paste-present threshold if not provided ──
  let pasteThreshold = t.pasteThresholdUm ?? NaN;
  if (!(pasteThreshold > 0)) {
    // global max height over all pad regions → 25% of it, floored at 1µm.
    let gmax = 0;
    for (const g of pads) {
      const x0 = Math.max(0, Math.floor(g.bbox.x));
      const y0 = Math.max(0, Math.floor(g.bbox.y));
      const x1 = Math.min(hm.width - 1, Math.floor(g.bbox.x + g.bbox.w - 1));
      const y1 = Math.min(hm.height - 1, Math.floor(g.bbox.y + g.bbox.h - 1));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (!maskOn(g.mask, x, y)) continue;
          const h = rawAt(hm, x, y) * zScale - base;
          if (h > gmax) gmax = h;
        }
      }
    }
    pasteThreshold = Math.max(1, 0.25 * gmax);
  }

  const bridged = detectBridges(hm, pads, zScale, base, pasteThreshold);

  // ── raw analysis per pad ──
  const raws = pads.map((g) =>
    analyzePadRaw(hm, g, zScale, base, pasteThreshold, t.voidDepthFraction, t.searchMarginPx),
  );

  // ── coplanarity per componentId (best-fit plane through pad centroids + mean heights) ──
  const compP2P = new Map<string, number>();
  const byComp = new Map<string, PadRaw[]>();
  for (const rw of raws) {
    if (!rw.componentId) continue;
    const arr = byComp.get(rw.componentId) ?? [];
    arr.push(rw);
    byComp.set(rw.componentId, arr);
  }
  for (const [comp, arr] of byComp) {
    const pts: Point3D[] = arr.map((rw) => ({
      x: rw.padCx * scaleX,
      y: rw.padCy * scaleY,
      z: rw.pixelCount > 0 ? rw.sumHeight / rw.pixelCount : 0,
    }));
    compP2P.set(comp, r4(planeP2P(pts)));
  }

  // ── board warpage: p2p of all pad mean-heights vs a global best-fit plane ──
  const boardPts: Point3D[] = raws
    .filter((rw) => rw.pixelCount > 0)
    .map((rw) => ({ x: rw.padCx * scaleX, y: rw.padCy * scaleY, z: rw.sumHeight / rw.pixelCount }));
  const warpage = boardPts.length >= 1 ? r4(planeP2P(boardPts)) : null;

  // ── assemble per-pad results ──
  const results: PadSpiResult[] = raws.map((rw, i) => {
    const geom = pads[i];
    const meanHeight = rw.pixelCount > 0 ? rw.sumHeight / rw.pixelCount : 0;

    // volume (pixel domain: Σh; physical: ×pixelArea)
    const volumePx = rw.sumHeight;               // µm·px
    const volume = volumePx * pixelArea;         // µm³ (calibrated) | µm·px² (degraded)
    const areaPx = rw.pixelCount;                // px²
    const area = areaPx * pixelArea;             // µm² | px²

    // offset (height-weighted paste centroid − pad centroid)
    const pasteCx = rw.sumHeight > 0 ? rw.sumXH / rw.sumHeight : rw.padCx;
    const pasteCy = rw.sumHeight > 0 ? rw.sumYH / rw.sumHeight : rw.padCy;
    const offsetXPx = pasteCx - rw.padCx;
    const offsetYPx = pasteCy - rw.padCy;
    const offsetX = offsetXPx * scaleX;
    const offsetY = offsetYPx * scaleY;

    // nominal (derive from area×height if volume not given)
    const nominalVolume =
      geom.nominalVolume ??
      (geom.nominalArea != null && geom.nominalHeight != null ? geom.nominalArea * geom.nominalHeight : null);
    const volumePct = nominalVolume != null && nominalVolume > 0 ? (volume / nominalVolume) * 100 : null;
    const heightPct = geom.nominalHeight != null && geom.nominalHeight > 0 ? (meanHeight / geom.nominalHeight) * 100 : null;
    const areaPct = geom.nominalArea != null && geom.nominalArea > 0 ? (area / geom.nominalArea) * 100 : null;

    // offset limit (absolute µm when calibrated + configured, else % of pad width)
    const padWidthU = rw.bboxW * scaleX;
    const offsetLimit = calibrated && t.offsetMaxUm != null ? t.offsetMaxUm : t.offsetMaxPctOfPad * padWidthU;
    const offsetMag = Math.hypot(offsetX, offsetY);

    const isBridged = bridged.has(i);
    const { defectClass, flags } = classify(volumePct, heightPct, offsetMag, offsetLimit, isBridged, t);

    const surfaceVoidPct = rw.footprintPixels > 0 ? (rw.voidPixels / rw.footprintPixels) * 100 : 0;
    const coplanarity = geom.componentId ? compP2P.get(geom.componentId) ?? null : null;

    return {
      padId: rw.padId,
      componentId: rw.componentId,
      volume: r4(volume),
      area: r4(area),
      areaPx: r4(areaPx),
      meanHeight: r4(meanHeight),
      maxHeight: r4(rw.maxHeight),
      offsetX: r4(offsetX),
      offsetY: r4(offsetY),
      offsetXPx: r4(offsetXPx),
      offsetYPx: r4(offsetYPx),
      volumePct: volumePct != null ? r4(volumePct) : null,
      heightPct: heightPct != null ? r4(heightPct) : null,
      areaPct: areaPct != null ? r4(areaPct) : null,
      coplanarity,
      surfaceVoidPct: r4(surfaceVoidPct),
      pixelCount: rw.pixelCount,
      defectClass,
      flags,
      result: defectClass === "good" ? "OK" : "NG",
      severity: SEVERITY[defectClass],
      unit: calibrated ? "um" : "px",
      umPerPx: calibrated ? scaleX : null,
      degraded: !calibrated,
    };
  });

  const boardVolume = r4(results.reduce((s, p) => s + p.volume, 0));
  const boardResult = results.some((p) => p.result === "NG") ? "NG" : "OK";

  return {
    pads: results,
    boardVolume,
    warpage,
    boardResult,
    unit: calibrated ? "um" : "px",
    degraded: !calibrated,
    pasteThresholdUm: r4(pasteThreshold),
  };
}

/**
 * Convenience single-pad computation (no neighbours ⇒ no bridging). Coplanarity is
 * null unless a componentId groups it with peers (use computeBoardSpi for that).
 */
export function computePadSpi(hm: HeightMap, geom: PadGeometry, opts: ComputeOptions = {}): PadSpiResult {
  return computeBoardSpi(hm, [geom], opts).pads[0];
}

// ════════════════════════════════════════════════════════════════════════════
// Per-pad 3-D point samples → height-map (rasterize, top surface = max Z)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Rasterize scattered 3-D samples (x,y in PIXEL coordinates, z in µm) onto a dense
 * height-map by taking the MAX z per cell (top surface). Returns the map + the pixel
 * origin so the caller can offset the pad geometry. Cells with no sample stay 0.
 */
export function pointsToHeightMap(
  points: Point3D[],
  opts: { width?: number; height?: number; originX?: number; originY?: number } = {},
): { heightMap: HeightMap; originX: number; originY: number; width: number; height: number } {
  if (points.length === 0) {
    return { heightMap: { data: new Float32Array(1), width: 1, height: 1 }, originX: 0, originY: 0, width: 1, height: 1 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const originX = opts.originX ?? Math.floor(minX);
  const originY = opts.originY ?? Math.floor(minY);
  const width = opts.width ?? Math.floor(maxX) - originX + 1;
  const height = opts.height ?? Math.floor(maxY) - originY + 1;
  const data = new Float32Array(Math.max(1, width * height));
  for (const p of points) {
    const gx = Math.round(p.x) - originX;
    const gy = Math.round(p.y) - originY;
    if (gx < 0 || gy < 0 || gx >= width || gy >= height) continue;
    const idx = gy * width + gx;
    if (p.z > data[idx]) data[idx] = p.z;
  }
  return { heightMap: { data, width, height }, originX, originY, width, height };
}

// ════════════════════════════════════════════════════════════════════════════
// Canonical enrichment (flagged pass-through composition)
// ════════════════════════════════════════════════════════════════════════════

export interface Spi3dEnrichInput {
  /** Full-board height-map (Z µm). */
  heightMap: HeightMap;
  /** Pad geometry; each padId should equal a measurement's pointCode/pointId. */
  pads: PadGeometry[];
  calibration?: SpiCalibration | null;
  thresholds?: Partial<SpiThresholds>;
}

/**
 * Compose native SPI onto a canonical inspection.
 *
 * • Flag OFF, or no input/height-map ⇒ PURE PASS-THROUGH: returns the canonical
 *   inspection byte-for-byte (native:false). The vendor adapter's transported values
 *   are preserved exactly — current behaviour is unchanged.
 * • Flag ON + height-map present ⇒ per pad, native values are PREFERRED and written
 *   into the existing canonical columns (valueVolume/valueHeight/valueArea/
 *   valueCoplanarity/valueOffsetX/valueOffsetY/valueVoidPct/valueWarpage), plus the
 *   pad result + defect code. Measurements with NO matching pad (no height-map for
 *   that point) keep the adapter's pass-through values — honest, additive.
 *
 * The returned `report` carries the honest unit/degraded metadata for the UI.
 */
export function enrichCanonicalWithSpi3d(
  canonical: CanonicalInspection,
  input: Spi3dEnrichInput | null,
): { canonical: CanonicalInspection; report: BoardSpiResult | null; native: boolean } {
  if (!spi3dNativeEnabled() || !input || !input.heightMap || !Array.isArray(input.pads) || input.pads.length === 0) {
    return { canonical, report: null, native: false };
  }

  const report = computeBoardSpi(input.heightMap, input.pads, {
    calibration: input.calibration,
    thresholds: input.thresholds,
  });
  const byPad = new Map(report.pads.map((p) => [p.padId, p]));

  const measurements: CanonicalMeasurement[] = canonical.measurements.map((m) => {
    const key = m.pointCode ?? m.pointId;
    const pr = key ? byPad.get(key) : undefined;
    if (!pr) return m; // no height-map for this pad → pass-through
    const merged: CanonicalMeasurement = {
      ...m,
      result: pr.result,
      // Headline metric mirrors the SPI convention (volume % of nominal) when available.
      measuredValue: pr.volumePct != null ? pr.volumePct : m.measuredValue,
      valueVolume: pr.volume,
      valueArea: pr.area,
      valueHeight: pr.meanHeight,
      valueOffsetX: pr.offsetX,
      valueOffsetY: pr.offsetY,
      valueVoidPct: pr.surfaceVoidPct,
    };
    if (pr.coplanarity != null) merged.valueCoplanarity = pr.coplanarity;
    if (report.warpage != null) merged.valueWarpage = report.warpage;
    if (pr.defectClass !== "good") merged.defectCatalogCode = pr.defectClass.toUpperCase();
    if (pr.severity) merged.defectSeverity = pr.severity;
    return merged;
  });

  const overallResult = measurements.some((m) => m.result === "NG") ? "NG" : canonical.overallResult;

  return { canonical: { ...canonical, measurements, overallResult }, report, native: true };
}
