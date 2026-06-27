/**
 * AI Metrics Helpers — WS-1 (shared)
 *
 * Pure, dependency-free numeric helpers reused across the AI self-learning
 * pipeline (local training, eval harness, active learning). Extracted so the
 * exact same softmax / argmax / confusion-matrix / P-R-F1 logic is used for
 * training AND offline evaluation — making before/after comparisons fair.
 *
 * All functions are deterministic and side-effect free (unit-testable).
 */

// ─── Softmax / Argmax ──────────────────────────────────────────

/** Numerically-stable softmax over a logits vector. */
export function softmax(logits: ArrayLike<number>): Float32Array {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    const v = logits[i]!;
    if (v > max) max = v;
  }
  const exps = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    const e = Math.exp(logits[i]! - max);
    exps[i] = e;
    sum += e;
  }
  if (sum > 0) {
    for (let i = 0; i < exps.length; i++) exps[i] = exps[i]! / sum;
  }
  return exps;
}

/** Index of the maximum element (first wins on ties). */
export function argmax(arr: ArrayLike<number>): number {
  let maxIdx = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i]! > arr[maxIdx]!) maxIdx = i;
  }
  return maxIdx;
}

// ─── Uncertainty ───────────────────────────────────────────────

/**
 * Normalized Shannon entropy over a probability distribution → [0, 1].
 * Higher = more uncertain. Robust to multi-class near-ties (preferred over
 * margin = 1 - topConfidence for active-learning uncertainty sampling).
 */
export function normalizedEntropy(probs: ArrayLike<number>): number {
  const n = Math.max(probs.length, 2);
  let h = 0;
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i]!;
    if (p > 0) h -= p * Math.log2(p);
  }
  const norm = h / Math.log2(n);
  // Clamp against float drift.
  return norm < 0 ? 0 : norm > 1 ? 1 : norm;
}

// ─── Confusion Matrix ──────────────────────────────────────────

/**
 * Build a confusion matrix from predicted/actual class-index arrays.
 * matrix[actual][predicted] = count. Both arrays must be the same length.
 */
export function buildConfusionMatrix(
  predicted: number[],
  actual: number[],
  numClasses: number,
): number[][] {
  const matrix = Array.from({ length: numClasses }, () =>
    new Array<number>(numClasses).fill(0),
  );
  const n = Math.min(predicted.length, actual.length);
  for (let i = 0; i < n; i++) {
    const a = actual[i]!;
    const p = predicted[i]!;
    if (a >= 0 && a < numClasses && p >= 0 && p < numClasses) {
      matrix[a]![p]++;
    }
  }
  return matrix;
}

/** Overall accuracy = trace / total. */
export function accuracyFromConfusion(matrix: number[][]): number {
  let correct = 0;
  let total = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i]!.length; j++) {
      const v = matrix[i]![j]!;
      total += v;
      if (i === j) correct += v;
    }
  }
  return total > 0 ? correct / total : 0;
}

export interface ClassificationMetrics {
  accuracy: number;
  /** Macro-averaged (mean over classes, equal weight). */
  precision: number;
  recall: number;
  f1Score: number;
  /** Micro-averaged (aggregate TP/FP/FN — equals accuracy for single-label). */
  microPrecision: number;
  microRecall: number;
  microF1: number;
  perClass: Array<{ classIndex: number; precision: number; recall: number; f1: number; support: number }>;
  confusionMatrix: number[][];
}

/**
 * Compute macro + micro precision/recall/F1 + accuracy from a confusion matrix.
 * matrix[actual][predicted].
 */
export function computeMetrics(matrix: number[][]): ClassificationMetrics {
  const numClasses = matrix.length;
  const perClass: ClassificationMetrics["perClass"] = [];

  let macroP = 0;
  let macroR = 0;
  let macroF1 = 0;
  let validClasses = 0;

  let sumTP = 0;
  let sumFP = 0;
  let sumFN = 0;

  for (let c = 0; c < numClasses; c++) {
    const tp = matrix[c]?.[c] ?? 0;
    let fp = 0;
    let fn = 0;
    let support = 0;
    for (let i = 0; i < numClasses; i++) {
      if (i !== c) {
        fp += matrix[i]?.[c] ?? 0; // predicted c but actually i
        fn += matrix[c]?.[i] ?? 0; // actually c but predicted i
      }
      support += matrix[c]?.[i] ?? 0;
    }

    const p = tp + fp > 0 ? tp / (tp + fp) : 0;
    const r = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = p + r > 0 ? (2 * p * r) / (p + r) : 0;

    perClass.push({ classIndex: c, precision: round4(p), recall: round4(r), f1: round4(f1), support });

    // Only count classes that actually appear (support > 0) for macro avg.
    if (support > 0) {
      macroP += p;
      macroR += r;
      macroF1 += f1;
      validClasses++;
    }

    sumTP += tp;
    sumFP += fp;
    sumFN += fn;
  }

  const precision = validClasses > 0 ? macroP / validClasses : 0;
  const recall = validClasses > 0 ? macroR / validClasses : 0;
  const f1Score = validClasses > 0 ? macroF1 / validClasses : 0;

  const microPrecision = sumTP + sumFP > 0 ? sumTP / (sumTP + sumFP) : 0;
  const microRecall = sumTP + sumFN > 0 ? sumTP / (sumTP + sumFN) : 0;
  const microF1 =
    microPrecision + microRecall > 0
      ? (2 * microPrecision * microRecall) / (microPrecision + microRecall)
      : 0;

  return {
    accuracy: round4(accuracyFromConfusion(matrix)),
    precision: round4(precision),
    recall: round4(recall),
    f1Score: round4(f1Score),
    microPrecision: round4(microPrecision),
    microRecall: round4(microRecall),
    microF1: round4(microF1),
    perClass,
    confusionMatrix: matrix,
  };
}

/** Convenience: metrics directly from predicted/actual index arrays. */
export function computeMetricsFromPredictions(
  predicted: number[],
  actual: number[],
  numClasses: number,
): ClassificationMetrics {
  return computeMetrics(buildConfusionMatrix(predicted, actual, numClasses));
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

// ─── Prometheus: AI Brain runtime telemetry (Phase B0.3) ───────
//
// Exposes the local-AI "brain" runtime state as Prometheus metrics, populated
// from read-only getters in aiModelRouter / aiGgufEngine on each /metrics
// scrape (async collect callbacks). Fully fail-safe: any error degrades to
// no-op and NEVER throws into the scrape path. Gated by METRICS_ENABLED via
// the parent registry (this module is only invoked when metrics are enabled).
//
// Metric names (all prefixed avi_aoi_ai_*):
//   avi_aoi_ai_router_requests_total{tier}        Gauge  cumulative req count per tier (mirrors router in-memory counter, resets on restart)
//   avi_aoi_ai_router_fast_model_configured       Gauge  1 if a fast (3B/4B) tier model is configured, else 0
//   avi_aoi_ai_inference_duration_seconds{tier,model}  Histogram  inference latency (observed via observeInference())
//   avi_aoi_ai_gguf_queue{state}                  Gauge  inference queue depth, state=running|queued|max
//   avi_aoi_ai_models_loaded                      Gauge  number of GGUF models resident in memory
//   avi_aoi_ai_models_max                         Gauge  max resident model cap (GGUF_MAX_LOADED_MODELS)
//   avi_aoi_ai_vram_bytes{state}                  Gauge  GPU VRAM bytes, state=used|total|free (best-effort; absent on CPU)
//
// Fallback rate is derived in Grafana as Tier 4 (HITL) share of total throughput.

/** Latency histogram handle — set during registration; null when metrics off. */
let inferenceHistogram: {
  observe: (labels: Record<string, string>, value: number) => void;
} | null = null;

/**
 * Record one inference's wall-clock latency. Safe to call from anywhere even
 * when metrics are disabled (no-op). Never throws.
 *
 * @param tier   Cognitive-ladder tier (0–4) that served the request.
 * @param model  Model id / family (kept low-cardinality by the caller).
 * @param seconds Latency in seconds.
 */
export function observeInference(tier: number | string, model: string, seconds: number): void {
  if (!inferenceHistogram) return;
  try {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    inferenceHistogram.observe({ tier: String(tier), model: model || "unknown" }, seconds);
  } catch {
    /* fail-safe: telemetry must never break inference */
  }
}

/**
 * Register AI-Brain metrics on the given prom-client instance + registry.
 * Called once from server/_core/metrics.ts during initMetrics(). The gauges
 * use async collect() callbacks that pull live state from read-only getters on
 * each scrape — so we never need to mutate the router/engine to populate them.
 *
 * @param client prom-client module (default export already resolved).
 * @param reg    the shared Registry created in metrics.ts.
 */
export async function registerAiBrainMetrics(client: any, reg: any): Promise<void> {
  try {
    // Lazy, read-only imports of the owning services' getters (ESM dynamic
    // import — resolved once here; the sync collect callbacks close over them).
    const { getRouterStats } = await import("./aiModelRouter");
    const { getEngineHealth } = await import("./aiGgufEngine");
    const { getGgufQueueStats } = await import("./ggufConcurrency");

    // — Router throughput by tier + fast-model flag (collected on scrape) —
    new client.Gauge({
      name: "avi_aoi_ai_router_requests_total",
      help: "Cumulative AI requests routed per cognitive tier (in-memory; resets on restart)",
      labelNames: ["tier"],
      registers: [reg],
      collect() {
        try {
          const s = getRouterStats();
          for (const [tier, count] of Object.entries(s.byTier ?? {})) {
            (this as any).set({ tier: String(tier) }, Number(count) || 0);
          }
        } catch {
          /* fail-safe */
        }
      },
    });

    new client.Gauge({
      name: "avi_aoi_ai_router_fast_model_configured",
      help: "1 if a fast-tier (3B/4B) model is configured, else 0",
      registers: [reg],
      collect() {
        try {
          (this as any).set(getRouterStats().fastModelConfigured ? 1 : 0);
        } catch {
          /* fail-safe */
        }
      },
    });

    // — Inference latency histogram (populated via observeInference()) —
    inferenceHistogram = new client.Histogram({
      name: "avi_aoi_ai_inference_duration_seconds",
      help: "AI inference wall-clock latency in seconds by tier/model",
      labelNames: ["tier", "model"],
      // Local LLM latencies range from sub-second (fast tier) to tens of seconds (30B/vision).
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60],
      registers: [reg],
    });

    // — GGUF inference queue depth (running/queued/max) —
    new client.Gauge({
      name: "avi_aoi_ai_gguf_queue",
      help: "GGUF inference queue depth by state (running|queued|max)",
      labelNames: ["state"],
      registers: [reg],
      collect() {
        try {
          const q = getGgufQueueStats();
          (this as any).set({ state: "running" }, q.running || 0);
          (this as any).set({ state: "queued" }, q.queued || 0);
          (this as any).set({ state: "max" }, q.max || 0);
        } catch {
          /* fail-safe */
        }
      },
    });

    // — Resident model count + cap, and VRAM (best-effort, async getter) —
    new client.Gauge({
      name: "avi_aoi_ai_models_loaded",
      help: "Number of GGUF models currently resident in memory",
      registers: [reg],
      async collect() {
        try {
          const h = await getEngineHealth();
          (this as any).set(h.modelsLoaded || 0);
        } catch {
          /* fail-safe */
        }
      },
    });

    new client.Gauge({
      name: "avi_aoi_ai_models_max",
      help: "Maximum number of resident GGUF models (GGUF_MAX_LOADED_MODELS)",
      registers: [reg],
      async collect() {
        try {
          const h = await getEngineHealth();
          (this as any).set(h.maxLoadedModels || 0);
        } catch {
          /* fail-safe */
        }
      },
    });

    new client.Gauge({
      name: "avi_aoi_ai_vram_bytes",
      help: "GPU VRAM in bytes by state (used|total|free); absent on CPU / unified memory",
      labelNames: ["state"],
      registers: [reg],
      async collect() {
        try {
          const h = await getEngineHealth();
          const v = h.vram;
          if (v && typeof v.total === "number") {
            (this as any).set({ state: "used" }, v.used || 0);
            (this as any).set({ state: "total" }, v.total || 0);
            (this as any).set({ state: "free" }, v.free || 0);
          }
        } catch {
          /* fail-safe */
        }
      },
    });
  } catch (err) {
    // Never let telemetry registration break metrics init / the server.
    // eslint-disable-next-line no-console
    console.warn("[Metrics] registerAiBrainMetrics failed — AI brain metrics off:", (err as Error)?.message);
  }
}

// ─── Label normalization (multilingual) ────────────────────────

/**
 * Normalize a free-text label so "xước" and " Xước " collapse to one class.
 * - trim
 * - Unicode NFC normalize (compose diacritics)
 * - collapse internal whitespace
 * - lowercase (locale-independent)
 *
 * NOTE: returns lowercase canonical key. Use {@link displayLabel} for UI.
 */
export function normalizeLabel(raw: string | null | undefined): string {
  if (raw == null) return "";
  return raw
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

/** Trim + collapse whitespace but preserve original casing for display. */
export function displayLabel(raw: string | null | undefined): string {
  if (raw == null) return "";
  return raw.normalize("NFC").trim().replace(/\s+/g, " ");
}

// ─── Deterministic RNG (reproducible splits/shuffles) ──────────

/**
 * Mulberry32 — tiny deterministic PRNG. Given the same seed, produces the same
 * sequence on every machine/run → reproducible dataset splits.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher–Yates shuffle (returns a new array). */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const arr = items.slice();
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Stable 32-bit hash of a string (for deriving per-key seeds). */
export function hashString(str: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
