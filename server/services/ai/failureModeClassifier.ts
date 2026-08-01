/**
 * G4.8 (doc 44 W5-B3) — FAILURE-MODE CLASSIFIER (scaffold, pure-TS).
 * Flag: FAILURE_MODE_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SYNAPSE Tầng-4 §7.2 "Phân loại chế độ hỏng: gợi ý nguyên nhân (mòn vòng bi,
 * lệch trục, tắc kim keo…) để bảo trì ĐÚNG HƯỚNG." §7.1: "Máy quá trình → Rung,
 * nhiệt, áp suất, chu kỳ → RMS rung, PHỔ TẦN, trôi chu kỳ."
 *
 * Bối cảnh (audit T4): failure-mode classification = 0. Đây là SCAFFOLD nhận đặc
 * trưng phổ tần/rung KHI CÓ (FFT/RMS/kurtosis THUẦN TS trên chuỗi rung) → phân
 * loại theo taxonomy chẩn đoán rung tiêu chuẩn (1×/2×/3× harmonics, năng lượng
 * cao-tần, xung-tính). HẦU HẾT MÁY HIỆN TẠI KHÔNG CÓ CẢM BIẾN RUNG → HONEST
 * mode:'unknown', reason:'no vibration sensor' — KHÔNG đoán bừa. Khi có HW rung
 * cắm vào (spec G4.8 đầy đủ cần cảm biến) phần software này sẵn sàng nhận ngay.
 *
 * PURE-first: spectralFeatures / classifyFailureMode là hàm THUẦN (không I/O,
 * không cờ). classifyFailureModeForMachine là lớp DB + cờ (NO-OP → null khi tắt).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { detectChangePoints, type TimeSeriesPoint } from "../aiTimeSeriesEngine";
import { mean, stdDev } from "../../utils/statistics";

export function isFailureModeEnabled(): boolean {
  return process.env.FAILURE_MODE_ENABLED === "true";
}

// ─── Taxonomy ─────────────────────────────────────────────────────────────────

export const FAILURE_MODES = [
  "bearing_wear",
  "shaft_misalignment",
  "imbalance",
  "looseness",
  "overheating",
  "tool_wear",
  "glue_nozzle_clog",
  "unknown",
] as const;
export type FailureMode = (typeof FAILURE_MODES)[number];

export interface FailureModeSpec {
  mode: FailureMode;
  label: string;
  /** Discriminating signal signature (what the classifier keys on). */
  signature: string;
  /** Maintenance direction this mode points to (§7.2 "bảo trì đúng hướng"). */
  recommendedAction: string;
}

export const FAILURE_MODE_TAXONOMY: FailureModeSpec[] = [
  { mode: "bearing_wear", label: "Bearing wear", signature: "impulsive, high kurtosis/crest-factor, broadband high-frequency energy", recommendedAction: "Relubricate or replace the bearing; schedule inspection." },
  { mode: "shaft_misalignment", label: "Shaft misalignment", signature: "elevated 2× (and 3×) running-speed harmonics vs 1×", recommendedAction: "Re-align the coupling; check for soft foot and pipe strain." },
  { mode: "imbalance", label: "Imbalance", signature: "dominant 1× running-speed peak, low harmonics, low high-frequency content", recommendedAction: "Balance the rotating assembly; check for material buildup or a missing weight." },
  { mode: "looseness", label: "Mechanical looseness", signature: "many running-speed harmonics (1×,2×,3×…) + raised noise floor", recommendedAction: "Tighten mounting/fasteners; check bearing clearances and fits." },
  { mode: "overheating", label: "Overheating", signature: "sustained upward temperature change-point", recommendedAction: "Check cooling/load and lubrication; inspect ventilation." },
  { mode: "tool_wear", label: "Tool wear", signature: "rising torque/force trend or cycle-time drift (process signal)", recommendedAction: "Replace or recondition the tool; verify feeds & speeds." },
  { mode: "glue_nozzle_clog", label: "Glue-nozzle clog", signature: "pressure spike / flow drop on a dispensing head (process signal)", recommendedAction: "Purge/clean the dispensing nozzle; check glue viscosity & temperature." },
  { mode: "unknown", label: "Unknown", signature: "no discriminating signal available", recommendedAction: "Add a vibration sensor for spectral diagnosis; escalate to a technician." },
];

/** Minimum vibration samples for a spectral verdict. */
const MIN_VIBRATION_SAMPLES = 32;

// ─── Signal features (pure) ───────────────────────────────────────────────────

/** Root-mean-square amplitude. */
export function computeRms(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.sqrt(values.reduce((s, v) => s + v * v, 0) / values.length);
}

/** Excess-kurtosis (0 = Gaussian; high = impulsive → bearing defects). */
export function computeKurtosis(values: number[]): number {
  const n = values.length;
  if (n < 4) return 0;
  const m = mean(values);
  const s = stdDev(values, m, false); // population std for the moment
  if (s === 0) return 0;
  const m4 = values.reduce((acc, v) => acc + ((v - m) / s) ** 4, 0) / n;
  return m4 - 3;
}

/** Crest factor = peak / rms (impulsiveness indicator). */
export function computeCrestFactor(values: number[]): number {
  const rms = computeRms(values);
  if (rms === 0) return 0;
  const peak = Math.max(...values.map((v) => Math.abs(v)));
  return peak / rms;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** In-place iterative radix-2 Cooley–Tukey FFT. re/im length must be a power of 2. */
function fftInPlace(re: number[], im: number[]): void {
  const n = re.length;
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(ang), wlenIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wRe = 1, wIm = 0;
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k], aIm = im[i + k];
        const bRe = re[i + k + half] * wRe - im[i + k + half] * wIm;
        const bIm = re[i + k + half] * wIm + im[i + k + half] * wRe;
        re[i + k] = aRe + bRe; im[i + k] = aIm + bIm;
        re[i + k + half] = aRe - bRe; im[i + k + half] = aIm - bIm;
        const nWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nWRe;
      }
    }
  }
}

/**
 * One-sided magnitude spectrum of a real signal. DC is removed first (vibration
 * analysis cares about the AC content). Returns magnitudes for bins 0..N/2, where
 * bin i corresponds to frequency i·(sampleRate/N).
 */
export function magnitudeSpectrum(values: number[]): number[] {
  const m = mean(values);
  const N = nextPow2(values.length);
  const re = new Array<number>(N).fill(0);
  const im = new Array<number>(N).fill(0);
  for (let i = 0; i < values.length; i++) re[i] = values[i] - m; // DC removal + zero pad
  fftInPlace(re, im);
  const half = N >> 1;
  const mag = new Array<number>(half + 1);
  for (let i = 0; i <= half; i++) mag[i] = Math.hypot(re[i], im[i]) / N;
  return mag;
}

export interface SpectralFeatures {
  n: number;
  sampleRateHz: number;
  freqResolutionHz: number;
  rms: number;
  kurtosis: number;
  crestFactor: number;
  /** Dominant (non-DC) spectral peak frequency, Hz. */
  peakFreqHz: number;
  peakMagnitude: number;
  /** Amplitude at 1×/2×/3× running speed (only when rotationHz provided). */
  amp1x: number | null;
  amp2x: number | null;
  amp3x: number | null;
  /** Fraction of spectral energy above 5× running speed (or above Nyquist/4). */
  highFreqEnergyRatio: number;
  /** Median magnitude — the spectral noise floor. */
  noiseFloor: number;
}

/**
 * Compute spectral + statistical features from a vibration series. `rotationHz`
 * (running speed) unlocks harmonic (1×/2×/3×) features; when absent, only
 * impulsiveness (kurtosis/crest) + broadband energy features are populated.
 */
export function spectralFeatures(
  series: TimeSeriesPoint[],
  rotationHz?: number | null,
): SpectralFeatures {
  const values = series.map((p) => p.value);
  const n = values.length;

  // Sample rate from median inter-sample interval.
  let sampleRateHz = 0;
  if (n >= 2) {
    const dts: number[] = [];
    for (let i = 1; i < n; i++) dts.push((series[i].timestamp - series[i - 1].timestamp) / 1000);
    dts.sort((a, b) => a - b);
    const medianDt = dts[Math.floor(dts.length / 2)] || 0;
    sampleRateHz = medianDt > 0 ? 1 / medianDt : 0;
  }

  const mag = magnitudeSpectrum(values);
  const N = (mag.length - 1) * 2;
  const freqResolutionHz = sampleRateHz > 0 ? sampleRateHz / N : 0;

  // Dominant non-DC peak.
  let peakIdx = 1, peakMag = 0;
  for (let i = 1; i < mag.length; i++) {
    if (mag[i] > peakMag) { peakMag = mag[i]; peakIdx = i; }
  }
  const peakFreqHz = peakIdx * freqResolutionHz;

  const ampAt = (harmonic: number): number | null => {
    if (!rotationHz || !(rotationHz > 0) || freqResolutionHz <= 0) return null;
    const bin = Math.round((harmonic * rotationHz) / freqResolutionHz);
    if (bin < 1 || bin >= mag.length) return null;
    // Take the max over ±1 bin to tolerate small speed drift / leakage.
    return Math.max(mag[bin - 1] ?? 0, mag[bin], mag[bin + 1] ?? 0);
  };

  // Broadband high-frequency energy ratio.
  const totalEnergy = mag.reduce((s, v, i) => (i === 0 ? s : s + v * v), 0);
  let hfCutoffBin: number;
  if (rotationHz && rotationHz > 0 && freqResolutionHz > 0) {
    hfCutoffBin = Math.round((5 * rotationHz) / freqResolutionHz);
  } else {
    hfCutoffBin = Math.floor(mag.length / 2); // above Nyquist/2 of the one-sided spectrum
  }
  let hfEnergy = 0;
  for (let i = Math.max(1, hfCutoffBin); i < mag.length; i++) hfEnergy += mag[i] * mag[i];
  const highFreqEnergyRatio = totalEnergy > 0 ? hfEnergy / totalEnergy : 0;

  const sortedMag = [...mag.slice(1)].sort((a, b) => a - b);
  const noiseFloor = sortedMag.length > 0 ? sortedMag[Math.floor(sortedMag.length / 2)] : 0;

  return {
    n,
    sampleRateHz,
    freqResolutionHz,
    rms: computeRms(values),
    kurtosis: computeKurtosis(values),
    crestFactor: computeCrestFactor(values),
    peakFreqHz,
    peakMagnitude: peakMag,
    amp1x: ampAt(1),
    amp2x: ampAt(2),
    amp3x: ampAt(3),
    highFreqEnergyRatio,
    noiseFloor,
  };
}

// ─── Classifier ───────────────────────────────────────────────────────────────

export interface ClassifyInput {
  /** Vibration series (the discriminating signal). Absent ⇒ honest unknown. */
  vibration?: TimeSeriesPoint[];
  /** Optional temperature series (enables an overheating verdict w/o vibration). */
  temperature?: TimeSeriesPoint[];
  /** Running speed (Hz) — unlocks harmonic-based modes (misalignment/imbalance/looseness). */
  rotationHz?: number | null;
}

export interface FailureModeResult {
  mode: FailureMode;
  /** Honest explanation for the verdict (incl. why 'unknown'). */
  reason: string;
  /** 0..1 — how strongly the signature matched (0 for 'unknown'). */
  confidence: number;
  /** Per-mode scores (for transparency/debugging). */
  scores?: Partial<Record<FailureMode, number>>;
  features?: SpectralFeatures | null;
  recommendedAction: string;
}

function actionFor(mode: FailureMode): string {
  return FAILURE_MODE_TAXONOMY.find((t) => t.mode === mode)?.recommendedAction ?? "";
}

/**
 * Classify the likely failure mode. VIBRATION-GATED (§7.2): without a vibration
 * series we do NOT guess a mechanical mode. A clear upward temperature shift is a
 * legitimately-available signal, so overheating may be reported from temperature
 * alone (honest reason). Everything else with no vibration ⇒ unknown.
 */
export function classifyFailureMode(input: ClassifyInput): FailureModeResult {
  const vib = input.vibration ?? [];

  if (vib.length < MIN_VIBRATION_SAMPLES) {
    // No usable vibration → try temperature-only overheating, else honest unknown.
    if (input.temperature && input.temperature.length >= 10) {
      const cps = detectChangePoints(input.temperature, 4.0).filter((c) => c.direction === "increase");
      if (cps.length > 0) {
        const cusum = Math.abs(cps[cps.length - 1].cumulativeSum);
        return {
          mode: "overheating",
          reason: "Upward temperature change-point (no vibration sensor available).",
          confidence: Math.min(0.6, cusum / (cusum + 6)),
          features: null,
          recommendedAction: actionFor("overheating"),
        };
      }
    }
    return {
      mode: "unknown",
      reason: "no vibration sensor",
      confidence: 0,
      features: null,
      recommendedAction: actionFor("unknown"),
    };
  }

  const f = spectralFeatures(vib, input.rotationHz);
  const scores: Partial<Record<FailureMode, number>> = {};

  // Impulsiveness (bearing) — independent of running speed.
  // Excess kurtosis ≳ 1.5 and crest ≳ 3.5 with broadband HF energy = classic bearing defect.
  const kurtScore = clamp01((f.kurtosis - 1) / 5);          // 0 at ~1, 1 at ~6
  const crestScore = clamp01((f.crestFactor - 3) / 4);      // 0 at 3, 1 at 7
  const hfScore = clamp01((f.highFreqEnergyRatio - 0.2) / 0.5);
  scores.bearing_wear = 0.45 * kurtScore + 0.25 * crestScore + 0.30 * hfScore;

  // Harmonic modes need a running speed.
  if (f.amp1x != null && f.amp1x > 0) {
    const r2 = (f.amp2x ?? 0) / f.amp1x;
    const r3 = (f.amp3x ?? 0) / f.amp1x;
    // Misalignment: strong 2× (and 3×) relative to 1×.
    scores.shaft_misalignment = clamp01((r2 - 0.5) / 1.0) * 0.7 + clamp01((r3 - 0.3) / 0.7) * 0.3;
    // Imbalance: dominant 1×, weak harmonics, low HF.
    scores.imbalance = clamp01(1 - r2 / 0.4) * 0.5 + clamp01(1 - r3 / 0.4) * 0.2 + clamp01(1 - f.highFreqEnergyRatio / 0.25) * 0.3;
    // Looseness: many harmonics present + raised noise floor relative to 1×.
    const harmonicsPresent = (r2 > 0.3 ? 1 : 0) + (r3 > 0.3 ? 1 : 0);
    const floorRatio = f.amp1x > 0 ? f.noiseFloor / f.amp1x : 0;
    scores.looseness = clamp01(harmonicsPresent / 2) * 0.6 + clamp01(floorRatio / 0.15) * 0.4;
  }

  // Overheating as a corroborating signal, if temperature is present.
  if (input.temperature && input.temperature.length >= 10) {
    const cps = detectChangePoints(input.temperature, 4.0).filter((c) => c.direction === "increase");
    if (cps.length > 0) {
      const cusum = Math.abs(cps[cps.length - 1].cumulativeSum);
      scores.overheating = Math.min(0.7, cusum / (cusum + 6));
    }
  }

  // Pick the argmax.
  let best: FailureMode = "unknown";
  let bestScore = 0;
  for (const [mode, score] of Object.entries(scores) as [FailureMode, number][]) {
    if (score > bestScore) { bestScore = score; best = mode; }
  }

  const MIN_SCORE = 0.35;
  if (bestScore < MIN_SCORE) {
    return {
      mode: "unknown",
      reason: input.rotationHz
        ? "Vibration present but spectral signature inconclusive (no mode above threshold)."
        : "Vibration present but no running speed supplied — only impulsiveness assessed, inconclusive.",
      confidence: 0,
      scores,
      features: f,
      recommendedAction: actionFor("unknown"),
    };
  }

  return {
    mode: best,
    reason: `${FAILURE_MODE_TAXONOMY.find((t) => t.mode === best)?.label ?? best}: ` +
      `${FAILURE_MODE_TAXONOMY.find((t) => t.mode === best)?.signature ?? ""}.`,
    confidence: Number(clamp01(bestScore).toFixed(3)),
    scores,
    features: f,
    recommendedAction: actionFor(best),
  };
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

// ─── DB layer (flag-gated) ────────────────────────────────────────────────────

export interface SensorReadingRow {
  sensorType: string;
  value: number;
  timestamp: number; // epoch ms
}

/** Is this sensorType a vibration channel? (tolerant of synonyms). */
function isVibration(sensorType: string): boolean {
  return (sensorType ?? "").toLowerCase().includes("vib");
}
function isTemperature(sensorType: string): boolean {
  return (sensorType ?? "").toLowerCase().includes("temp");
}

/**
 * Classify from raw machine_sensor_readings. Builds a vibration series from any
 * 'vibration' tag; when none exists (most machines today) returns the honest
 * unknown/'no vibration sensor' verdict. NO fabrication of a vibration reading.
 * Returns null only when the feature flag is OFF.
 */
export function classifyFailureModeFromSensorReadings(
  rows: SensorReadingRow[],
  opts: { rotationHz?: number | null } = {},
): FailureModeResult {
  const sorted = [...rows].sort((a, b) => a.timestamp - b.timestamp);
  const vibration: TimeSeriesPoint[] = sorted
    .filter((r) => isVibration(r.sensorType))
    .map((r) => ({ timestamp: r.timestamp, value: r.value }));
  const temperature: TimeSeriesPoint[] = sorted
    .filter((r) => isTemperature(r.sensorType))
    .map((r) => ({ timestamp: r.timestamp, value: r.value }));
  return classifyFailureMode({ vibration, temperature, rotationHz: opts.rotationHz ?? null });
}

/**
 * Runtime wrapper used by the PdM path. NO-OP (returns null) when the flag is OFF,
 * so callers behave exactly as before unless FAILURE_MODE_ENABLED=true.
 */
export function classifyForMachine(
  rows: SensorReadingRow[],
  opts: { rotationHz?: number | null } = {},
): FailureModeResult | null {
  if (!isFailureModeEnabled()) return null;
  return classifyFailureModeFromSensorReadings(rows, opts);
}
