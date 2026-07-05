/**
 * validationHarness.ts — labeled-corpus VALIDATION + Gage R&R for the vision
 * metrology stack (doc 27 §9 V17 · Đợt 7.6).
 *
 * WHAT IT PROVES (and what it doesn't):
 *   • Registration accuracy — measured (dx,dy) from imageRegistration.registerToReference
 *     vs GROUND-TRUTH offsets → bias / RMS / max error in px.
 *   • SPI metric accuracy — measured volume/height from aiSpi3d.computeBoardSpi vs
 *     ground truth → bias / RMS (%, µm³).
 *   • Repeatability & reproducibility — a Gage R&R study over a
 *     parts × appraisers × trials measurement matrix.
 *
 * ── GAGE R&R METHOD (documented choice) ───────────────────────────────────────
 * AVERAGE-AND-RANGE method (AIAG MSA manual, X̄&R):
 *     EV  = R̄̄ · K1                      (repeatability / equipment variation)
 *     AV  = √max(0, (X̄diff·K2)² − EV²/(n·r))   (reproducibility / appraiser variation)
 *     GRR = √(EV² + AV²)
 *     PV  = Rp · K3                      (part variation)
 *     TV  = √(GRR² + PV²)
 *     %GRR = 100·GRR/TV,  ndc = ⌊1.41·PV/GRR⌋
 * with the standard K1/K2/K3 = 1/d2* constants tabled below. Chosen over the
 * ANOVA method because it is the shop-floor MSA standard, has closed-form math
 * (no F-distribution deps) and its constants are auditable against the AIAG
 * tables. Limitation (honest): unlike ANOVA it cannot isolate an
 * appraiser×part interaction term.
 *
 * ── "APPRAISER" FOR AN ALGORITHM ─────────────────────────────────────────────
 * The estimators are deterministic — re-running the same bytes yields the same
 * number, so trial-to-trial variation must come from the MEASUREMENT SYSTEM
 * upstream: repeated CAPTURES of the same part (sensor noise, lighting flicker,
 * re-fixturing). A REAL corpus therefore supplies repeated capture files per
 * part. The bundled SYNTHETIC corpus emulates exactly that: per appraiser/trial
 * a different deterministic noise realization is added to the same ground-truth
 * scene — labelled synthetic:true in the report, never passed off as real PCBs.
 * How to feed a REAL PCB corpus: see vision/__validation__/README.md.
 */
import fs from "node:fs";
import path from "node:path";
import {
  registerToReference,
  type GrayImage,
} from "../imageRegistration";
import {
  computeBoardSpi,
  type HeightMap,
  type PadGeometry,
  type SpiCalibration,
} from "../aiSpi3d";
import { parseCsvHeightMap } from "./heightMapSource";

// ════════════════════════════════════════════════════════════════════════════
// Gage R&R — average-and-range method (pure, exported for tests)
// ════════════════════════════════════════════════════════════════════════════

/** K1 = 1/d2 for the trial count r (AIAG). */
const K1_BY_TRIALS: Record<number, number> = {
  2: 0.8862,
  3: 0.5908,
  4: 0.4857,
  5: 0.4299,
};

/** K2 = 1/d2* (g=1) for the appraiser count k (AIAG). */
const K2_BY_APPRAISERS: Record<number, number> = {
  2: 0.7071,
  3: 0.5231,
};

/** K3 = 1/d2* (g=1) for the part count n (AIAG). */
const K3_BY_PARTS: Record<number, number> = {
  2: 0.7071,
  3: 0.5231,
  4: 0.4467,
  5: 0.403,
  6: 0.3742,
  7: 0.3534,
  8: 0.3375,
  9: 0.3249,
  10: 0.3146,
};

export interface GageRRResult {
  parts: number;
  appraisers: number;
  trials: number;
  /** Repeatability (equipment variation), same unit as the measurements. */
  ev: number;
  /** Reproducibility (appraiser variation). */
  av: number;
  /** Combined gage R&R. */
  grr: number;
  /** Part variation. */
  pv: number;
  /** Total variation. */
  tv: number;
  pctEv: number;
  pctAv: number;
  pctGrr: number;
  pctPv: number;
  /** Number of distinct categories (≥5 = adequate resolution). */
  ndc: number;
  /** AIAG verdict on %GRR: <10 good, 10–30 marginal, >30 unacceptable. */
  verdict: "good" | "marginal" | "unacceptable";
  method: "average-and-range";
}

/**
 * Average-and-range Gage R&R over measurements[part][appraiser][trial].
 * Requirements: ≥2 parts (≤10 for the K3 table), 1–3 appraisers, 2–5 trials,
 * rectangular matrix. With a single appraiser AV is 0 by definition (documented:
 * repeatability-only study).
 */
export function computeGageRR(measurements: number[][][]): GageRRResult {
  const n = measurements.length;
  if (n < 2) throw new Error("Gage R&R needs ≥2 parts");
  if (n > 10) throw new Error("Gage R&R (avg-and-range) supports ≤10 parts (K3 table)");
  const k = measurements[0]?.length ?? 0;
  if (k < 1 || k > 3) throw new Error("Gage R&R needs 1–3 appraisers");
  const r = measurements[0]?.[0]?.length ?? 0;
  if (r < 2 || r > 5) throw new Error("Gage R&R needs 2–5 trials");
  for (const part of measurements) {
    if (part.length !== k) throw new Error("ragged matrix: appraiser count differs per part");
    for (const app of part) {
      if (app.length !== r) throw new Error("ragged matrix: trial count differs per appraiser");
      for (const v of app) {
        if (!Number.isFinite(v)) throw new Error("non-finite measurement in matrix");
      }
    }
  }

  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

  // R̄̄ — mean of per-part-per-appraiser ranges.
  const ranges: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) {
      const t = measurements[i][j];
      ranges.push(Math.max(...t) - Math.min(...t));
    }
  }
  const rBarBar = mean(ranges);

  // X̄diff — spread of appraiser means.
  const appraiserMeans: number[] = [];
  for (let j = 0; j < k; j++) {
    const all: number[] = [];
    for (let i = 0; i < n; i++) all.push(...measurements[i][j]);
    appraiserMeans.push(mean(all));
  }
  const xDiff = Math.max(...appraiserMeans) - Math.min(...appraiserMeans);

  // Rp — spread of part means.
  const partMeans = measurements.map((part) => mean(part.flat()));
  const rp = Math.max(...partMeans) - Math.min(...partMeans);

  const k1 = K1_BY_TRIALS[r];
  const k3 = K3_BY_PARTS[n];
  const ev = rBarBar * k1;

  let av = 0;
  if (k >= 2) {
    const k2 = K2_BY_APPRAISERS[k];
    av = Math.sqrt(Math.max(0, (xDiff * k2) ** 2 - ev ** 2 / (n * r)));
  }

  const grr = Math.hypot(ev, av);
  const pv = rp * k3;
  const tv = Math.hypot(grr, pv);
  const pct = (v: number) => (tv > 0 ? (100 * v) / tv : 0);
  const pctGrr = pct(grr);
  const ndc = grr > 0 ? Math.floor(1.41 * (pv / grr)) : Infinity;

  return {
    parts: n,
    appraisers: k,
    trials: r,
    ev,
    av,
    grr,
    pv,
    tv,
    pctEv: pct(ev),
    pctAv: pct(av),
    pctGrr,
    pctPv: pct(pv),
    ndc: Number.isFinite(ndc) ? ndc : 9999,
    verdict: pctGrr < 10 ? "good" : pctGrr <= 30 ? "marginal" : "unacceptable",
    method: "average-and-range",
  };
}

// ── Accuracy stats (measured vs truth) ────────────────────────────────────────

export interface AccuracyStats {
  n: number;
  bias: number;
  rms: number;
  maxAbsError: number;
}

/** Bias / RMS / max |error| of paired (measured, truth) values. Pure. */
export function computeAccuracy(pairs: Array<{ measured: number; truth: number }>): AccuracyStats {
  if (pairs.length === 0) return { n: 0, bias: 0, rms: 0, maxAbsError: 0 };
  let sum = 0;
  let sumSq = 0;
  let maxAbs = 0;
  for (const p of pairs) {
    const e = p.measured - p.truth;
    sum += e;
    sumSq += e * e;
    if (Math.abs(e) > maxAbs) maxAbs = Math.abs(e);
  }
  return {
    n: pairs.length,
    bias: sum / pairs.length,
    rms: Math.sqrt(sumSq / pairs.length),
    maxAbsError: maxAbs,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Synthetic dataset generators (deterministic; labelled synthetic in the report)
// ════════════════════════════════════════════════════════════════════════════

/** Deterministic integer hash noise in [0,255] (mirrors imageRegistration.test). */
function noiseAt(x: number, y: number, seed: number): number {
  let h = (Math.floor(x) * 374761393 + Math.floor(y) * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return ((h % 256) + 256) % 256;
}

function textureAt(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const v00 = noiseAt(x0, y0, seed), v10 = noiseAt(x0 + 1, y0, seed);
  const v01 = noiseAt(x0, y0 + 1, seed), v11 = noiseAt(x0 + 1, y0 + 1, seed);
  const top = v00 + (v10 - v00) * fx;
  const bot = v01 + (v11 - v01) * fx;
  return top + (bot - top) * fy;
}

/** Rich non-periodic reference scene (single sharp registration minimum). */
export function makeSyntheticReference(size = 128, seed = 0): GrayImage {
  const data = Buffer.alloc(size * size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - c, y - c);
      const ramp = 128 + 90 * Math.cos(r * 0.08);
      const tex = (textureAt(x / 3, y / 3, seed) - 128) * 0.35;
      data[y * size + x] = Math.max(0, Math.min(255, Math.round(ramp * 0.6 + 40 + tex)));
    }
  }
  return { data, width: size, height: size };
}

/** Translate the reference by (tx,ty) with bilinear sampling + additive capture noise. */
export function makeShiftedCapture(
  ref: GrayImage,
  tx: number,
  ty: number,
  noiseSigma: number,
  noiseSeed: number,
): GrayImage {
  const W = ref.width, H = ref.height;
  const out = Buffer.alloc(W * H);
  const src = ref.data;
  const sample = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x > W - 1 || y > H - 1) return 0;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, W - 1), y1 = Math.min(y0 + 1, H - 1);
    const fx = x - x0, fy = y - y0;
    const v00 = src[y0 * W + x0], v10 = src[y0 * W + x1];
    const v01 = src[y1 * W + x0], v11 = src[y1 * W + x1];
    const top = v00 + (v10 - v00) * fx, bot = v01 + (v11 - v01) * fx;
    return top + (bot - top) * fy;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Zero-mean deterministic "capture noise" (uniform ≈ ±1.73σ).
      const noise = noiseSigma > 0 ? ((noiseAt(x, y, noiseSeed) / 255 - 0.5) * 2 * 1.73 * noiseSigma) : 0;
      const v = sample(x - tx, y - ty) + noise;
      out[y * W + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return { data: out, width: W, height: H };
}

/** Synthetic SPI scene: one pad rect of a known height (µm) + Z capture noise. */
export function makeSyntheticHeightMap(
  size: number,
  pad: { x: number; y: number; w: number; h: number },
  heightUm: number,
  noiseSigmaUm: number,
  noiseSeed: number,
): HeightMap {
  const data = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = x >= pad.x && x < pad.x + pad.w && y >= pad.y && y < pad.y + pad.h;
      const noise = noiseSigmaUm > 0 ? (noiseAt(x, y, noiseSeed) / 255 - 0.5) * 2 * 1.73 * noiseSigmaUm : 0;
      data[y * size + x] = Math.max(0, (inside ? heightUm : 0) + noise);
    }
  }
  return { data, width: size, height: size };
}

// ════════════════════════════════════════════════════════════════════════════
// Corpus model (real corpora load into the same shapes — see README)
// ════════════════════════════════════════════════════════════════════════════

export interface RegistrationStudyCase {
  id: string;
  reference: GrayImage;
  /** captures[appraiser][trial] — repeated captures of the SAME shifted part. */
  captures: GrayImage[][];
  truth: { dx: number; dy: number };
}

export interface SpiStudyCase {
  id: string;
  /** heightMaps[appraiser][trial] — repeated Z captures of the SAME deposit. */
  heightMaps: HeightMap[][];
  pads: PadGeometry[];
  calibration?: SpiCalibration | null;
  /** Ground truth for the FIRST pad (the studied metric). */
  truth: { volume?: number; meanHeight?: number };
}

export interface ValidationStudy {
  name: string;
  synthetic: boolean;
  registration: RegistrationStudyCase[];
  spi: SpiStudyCase[];
}

export interface SyntheticStudyOptions {
  /** Parts per study (default 5). */
  parts?: number;
  /** Appraisers (noise-family seeds; default 2). */
  appraisers?: number;
  /** Trials per appraiser (default 3). */
  trials?: number;
  /** Registration capture noise σ (DN, default 2). */
  regNoiseSigma?: number;
  /** SPI Z capture noise σ (µm, default 1). */
  spiNoiseSigmaUm?: number;
  imageSize?: number;
}

/** Build the bundled deterministic synthetic study (honest: synthetic=true). */
export function buildSyntheticStudy(opts: SyntheticStudyOptions = {}): ValidationStudy {
  const parts = Math.min(10, Math.max(2, opts.parts ?? 5));
  const appraisers = Math.min(3, Math.max(1, opts.appraisers ?? 2));
  const trials = Math.min(5, Math.max(2, opts.trials ?? 3));
  const regSigma = opts.regNoiseSigma ?? 2;
  const spiSigma = opts.spiNoiseSigmaUm ?? 1;
  const size = opts.imageSize ?? 128;

  const ref = makeSyntheticReference(size, 7);

  const registration: RegistrationStudyCase[] = [];
  for (let p = 0; p < parts; p++) {
    // Distinct, sub-pixel ground-truth shifts per part.
    const truth = { dx: 1.2 + p * 0.9, dy: -0.8 - p * 0.6 };
    const captures: GrayImage[][] = [];
    for (let a = 0; a < appraisers; a++) {
      const row: GrayImage[] = [];
      for (let t = 0; t < trials; t++) {
        row.push(makeShiftedCapture(ref, truth.dx, truth.dy, regSigma, 1000 * p + 100 * a + t + 1));
      }
      captures.push(row);
    }
    registration.push({ id: `synthetic-reg-${p + 1}`, reference: ref, captures, truth });
  }

  const spi: SpiStudyCase[] = [];
  const padBox = { x: 20, y: 20, w: 20, h: 20 };
  for (let p = 0; p < parts; p++) {
    const heightUm = 80 + p * 20; // distinct deposits → real part variation
    const truthVolume = heightUm * padBox.w * padBox.h; // µm·px² (degraded domain, exact)
    const heightMaps: HeightMap[][] = [];
    for (let a = 0; a < appraisers; a++) {
      const row: HeightMap[] = [];
      for (let t = 0; t < trials; t++) {
        row.push(makeSyntheticHeightMap(64, padBox, heightUm, spiSigma, 5000 * p + 500 * a + t + 1));
      }
      heightMaps.push(row);
    }
    spi.push({
      id: `synthetic-spi-${p + 1}`,
      heightMaps,
      pads: [{ padId: "P1", bbox: padBox, nominalHeight: heightUm }],
      calibration: null,
      truth: { volume: truthVolume, meanHeight: heightUm },
    });
  }

  return { name: "synthetic-vision-validation", synthetic: true, registration, spi };
}

// ════════════════════════════════════════════════════════════════════════════
// Study runner
// ════════════════════════════════════════════════════════════════════════════

export interface RegistrationCaseResult {
  id: string;
  truth: { dx: number; dy: number };
  meanMeasured: { dx: number; dy: number };
  errorPx: { dx: number; dy: number };
  alignedRate: number;
}

export interface SpiCaseResult {
  id: string;
  truthVolume: number | null;
  meanMeasuredVolume: number;
  volumeErrorPct: number | null;
  truthMeanHeight: number | null;
  meanMeasuredHeight: number;
}

export interface ValidationReport {
  name: string;
  synthetic: boolean;
  generatedAt: string;
  registration: {
    cases: RegistrationCaseResult[];
    accuracyDx: AccuracyStats;
    accuracyDy: AccuracyStats;
    gageRRDx: GageRRResult | null;
    notes: string[];
  } | null;
  spi: {
    cases: SpiCaseResult[];
    volumeAccuracy: AccuracyStats;
    heightAccuracyUm: AccuracyStats;
    gageRRVolume: GageRRResult | null;
    notes: string[];
  } | null;
}

/** Run every case of a study through the REAL estimators and aggregate. */
export async function runValidationStudy(study: ValidationStudy): Promise<ValidationReport> {
  const report: ValidationReport = {
    name: study.name,
    synthetic: study.synthetic,
    generatedAt: new Date().toISOString(),
    registration: null,
    spi: null,
  };

  // ── Registration ──
  if (study.registration.length > 0) {
    const notes: string[] = [];
    const cases: RegistrationCaseResult[] = [];
    const dxMatrix: number[][][] = [];
    const dxPairs: Array<{ measured: number; truth: number }> = [];
    const dyPairs: Array<{ measured: number; truth: number }> = [];

    for (const c of study.registration) {
      const partMatrix: number[][] = [];
      let alignedCount = 0;
      let total = 0;
      let sumDx = 0;
      let sumDy = 0;
      for (const appraiserRow of c.captures) {
        const trialRow: number[] = [];
        for (const capture of appraiserRow) {
          const res = await registerToReference(c.reference, capture, {
            workSize: Math.max(c.reference.width, c.reference.height),
            pyramidLevels: 4,
            minConfidence: 0.5,
            maxResidual: 60,
          });
          total++;
          if (res.aligned) alignedCount++;
          trialRow.push(res.dx);
          sumDx += res.dx;
          sumDy += res.dy;
          dxPairs.push({ measured: res.dx, truth: c.truth.dx });
          dyPairs.push({ measured: res.dy, truth: c.truth.dy });
        }
        partMatrix.push(trialRow);
      }
      dxMatrix.push(partMatrix);
      const meanDx = sumDx / total;
      const meanDy = sumDy / total;
      cases.push({
        id: c.id,
        truth: c.truth,
        meanMeasured: { dx: meanDx, dy: meanDy },
        errorPx: { dx: meanDx - c.truth.dx, dy: meanDy - c.truth.dy },
        alignedRate: alignedCount / total,
      });
    }

    let gage: GageRRResult | null = null;
    try {
      gage = computeGageRR(dxMatrix);
    } catch (err) {
      notes.push(`gageRR skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
    report.registration = {
      cases,
      accuracyDx: computeAccuracy(dxPairs),
      accuracyDy: computeAccuracy(dyPairs),
      gageRRDx: gage,
      notes,
    };
  }

  // ── SPI ──
  if (study.spi.length > 0) {
    const notes: string[] = [];
    const cases: SpiCaseResult[] = [];
    const volMatrix: number[][][] = [];
    const volPairs: Array<{ measured: number; truth: number }> = [];
    const heightPairs: Array<{ measured: number; truth: number }> = [];

    for (const c of study.spi) {
      const partMatrix: number[][] = [];
      let sumVol = 0;
      let sumHeight = 0;
      let total = 0;
      for (const appraiserRow of c.heightMaps) {
        const trialRow: number[] = [];
        for (const hm of appraiserRow) {
          const board = computeBoardSpi(hm, c.pads, {
            calibration: c.calibration ?? null,
            // Half the nominal keeps the paste threshold below the deposit but
            // above capture noise for the studied pad.
            thresholds: { pasteThresholdUm: Math.max(1, (c.pads[0]?.nominalHeight ?? 20) / 2) },
          });
          const pad = board.pads[0];
          total++;
          trialRow.push(pad.volume);
          sumVol += pad.volume;
          sumHeight += pad.meanHeight;
          if (c.truth.volume != null) volPairs.push({ measured: pad.volume, truth: c.truth.volume });
          if (c.truth.meanHeight != null) heightPairs.push({ measured: pad.meanHeight, truth: c.truth.meanHeight });
        }
        partMatrix.push(trialRow);
      }
      volMatrix.push(partMatrix);
      const meanVol = sumVol / total;
      cases.push({
        id: c.id,
        truthVolume: c.truth.volume ?? null,
        meanMeasuredVolume: meanVol,
        volumeErrorPct: c.truth.volume ? (100 * (meanVol - c.truth.volume)) / c.truth.volume : null,
        truthMeanHeight: c.truth.meanHeight ?? null,
        meanMeasuredHeight: sumHeight / total,
      });
    }

    let gage: GageRRResult | null = null;
    try {
      gage = computeGageRR(volMatrix);
    } catch (err) {
      notes.push(`gageRR skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
    report.spi = {
      cases,
      volumeAccuracy: computeAccuracy(volPairs),
      heightAccuracyUm: computeAccuracy(heightPairs),
      gageRRVolume: gage,
      notes,
    };
  }

  return report;
}

// ════════════════════════════════════════════════════════════════════════════
// Real-corpus manifest loader (drop-in path for REAL PCB data — see README)
// ════════════════════════════════════════════════════════════════════════════

export interface CorpusManifest {
  name: string;
  registration?: Array<{
    id: string;
    /** Reference image file (any sharp-decodable format), relative to the manifest. */
    reference: string;
    /** captures[appraiser][trial] — repeated capture image files of the same part. */
    captures: string[][];
    truth: { dx: number; dy: number };
  }>;
  spi?: Array<{
    id: string;
    /** heightMaps[appraiser][trial] — CSV height-map grids (µm), relative paths. */
    heightMapsCsv: string[][];
    pads: Array<{
      padId: string;
      bbox: { x: number; y: number; w: number; h: number };
      nominalHeight?: number;
      nominalVolume?: number;
      nominalArea?: number;
      componentId?: string;
    }>;
    calibration?: { umPerPxX?: number; umPerPxY?: number; zScale?: number };
    truth: { volume?: number; meanHeight?: number };
  }>;
}

/** Load a real corpus manifest + all referenced files into a ValidationStudy. */
export async function loadCorpusStudy(manifestPath: string): Promise<ValidationStudy> {
  const dir = path.dirname(path.resolve(manifestPath));
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8")) as CorpusManifest;
  const { decodeGray } = await import("../imageRegistration");

  const registration: RegistrationStudyCase[] = [];
  for (const c of manifest.registration ?? []) {
    const reference = await decodeGray(await fs.promises.readFile(path.resolve(dir, c.reference)));
    const captures: GrayImage[][] = [];
    for (const row of c.captures) {
      const decoded: GrayImage[] = [];
      for (const f of row) decoded.push(await decodeGray(await fs.promises.readFile(path.resolve(dir, f))));
      captures.push(decoded);
    }
    registration.push({ id: c.id, reference, captures, truth: c.truth });
  }

  const spi: SpiStudyCase[] = [];
  for (const c of manifest.spi ?? []) {
    const heightMaps: HeightMap[][] = [];
    for (const row of c.heightMapsCsv) {
      const grids: HeightMap[] = [];
      for (const f of row) grids.push(parseCsvHeightMap(await fs.promises.readFile(path.resolve(dir, f), "utf8")));
      heightMaps.push(grids);
    }
    spi.push({
      id: c.id,
      heightMaps,
      pads: c.pads,
      calibration: c.calibration ?? null,
      truth: c.truth,
    });
  }

  return { name: manifest.name, synthetic: false, registration, spi };
}

// ════════════════════════════════════════════════════════════════════════════
// Report rendering
// ════════════════════════════════════════════════════════════════════════════

const f = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : String(v));

function renderGage(g: GageRRResult | null, unit: string): string {
  if (!g) return "_Gage R&R not computed (see notes)._";
  return [
    `| Metric | Value |`,
    `|---|---|`,
    `| Method | ${g.method} (${g.parts} parts × ${g.appraisers} appraisers × ${g.trials} trials) |`,
    `| EV (repeatability) | ${f(g.ev)} ${unit} |`,
    `| AV (reproducibility) | ${f(g.av)} ${unit} |`,
    `| GRR | ${f(g.grr)} ${unit} |`,
    `| PV (part variation) | ${f(g.pv)} ${unit} |`,
    `| TV | ${f(g.tv)} ${unit} |`,
    `| **%GRR** | **${f(g.pctGrr, 1)}%** (${g.verdict}) |`,
    `| ndc | ${g.ndc} |`,
  ].join("\n");
}

/** Markdown report (the JSON report is the ValidationReport object itself). */
export function renderReportMarkdown(r: ValidationReport): string {
  const lines: string[] = [
    `# Vision validation report — ${r.name}`,
    ``,
    `Generated: ${r.generatedAt}`,
    ``,
    r.synthetic
      ? `> ⚠️ **SYNTHETIC corpus** — deterministic generated scenes + capture-noise emulation, NOT real PCB images. Drop a real corpus per \`vision/__validation__/README.md\` for production-grade numbers.`
      : `> Real corpus.`,
    ``,
  ];

  if (r.registration) {
    lines.push(`## Registration (sub-pixel offset recovery)`, ``);
    lines.push(
      `- dx accuracy: bias ${f(r.registration.accuracyDx.bias)} px, RMS ${f(r.registration.accuracyDx.rms)} px, max |e| ${f(r.registration.accuracyDx.maxAbsError)} px (n=${r.registration.accuracyDx.n})`,
      `- dy accuracy: bias ${f(r.registration.accuracyDy.bias)} px, RMS ${f(r.registration.accuracyDy.rms)} px, max |e| ${f(r.registration.accuracyDy.maxAbsError)} px`,
      ``,
      `### Gage R&R (dx, px)`,
      renderGage(r.registration.gageRRDx, "px"),
      ``,
      `| Case | truth (dx,dy) | measured (dx,dy) | error px | aligned |`,
      `|---|---|---|---|---|`,
    );
    for (const c of r.registration.cases) {
      lines.push(
        `| ${c.id} | (${f(c.truth.dx, 2)}, ${f(c.truth.dy, 2)}) | (${f(c.meanMeasured.dx, 3)}, ${f(c.meanMeasured.dy, 3)}) | (${f(c.errorPx.dx, 3)}, ${f(c.errorPx.dy, 3)}) | ${f(c.alignedRate * 100, 0)}% |`,
      );
    }
    for (const n of r.registration.notes) lines.push(``, `> note: ${n}`);
    lines.push(``);
  }

  if (r.spi) {
    lines.push(`## SPI metrology (volume / height)`, ``);
    lines.push(
      `- volume accuracy: bias ${f(r.spi.volumeAccuracy.bias, 1)}, RMS ${f(r.spi.volumeAccuracy.rms, 1)}, max |e| ${f(r.spi.volumeAccuracy.maxAbsError, 1)} (n=${r.spi.volumeAccuracy.n})`,
      `- mean-height accuracy (µm): bias ${f(r.spi.heightAccuracyUm.bias)}, RMS ${f(r.spi.heightAccuracyUm.rms)}, max |e| ${f(r.spi.heightAccuracyUm.maxAbsError)}`,
      ``,
      `### Gage R&R (volume)`,
      renderGage(r.spi.gageRRVolume, "vol-unit"),
      ``,
      `| Case | truth volume | measured volume | error % | truth h̄ (µm) | measured h̄ (µm) |`,
      `|---|---|---|---|---|---|`,
    );
    for (const c of r.spi.cases) {
      lines.push(
        `| ${c.id} | ${c.truthVolume != null ? f(c.truthVolume, 0) : "—"} | ${f(c.meanMeasuredVolume, 0)} | ${c.volumeErrorPct != null ? f(c.volumeErrorPct, 2) + "%" : "—"} | ${c.truthMeanHeight != null ? f(c.truthMeanHeight, 1) : "—"} | ${f(c.meanMeasuredHeight, 1)} |`,
      );
    }
    for (const n of r.spi.notes) lines.push(``, `> note: ${n}`);
    lines.push(``);
  }

  return lines.join("\n");
}
