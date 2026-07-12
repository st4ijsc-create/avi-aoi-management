/**
 * Vision-inference latency SLO feed — doc 44 Batch W5-B2 (gap G4.16).
 * SYNAPSE Tầng 4 §2.2 "Độ trễ suy luận thị giác (P95) ≤ 200 ms/ảnh — đủ nhanh
 * cho kiểm tra inline".
 *
 * ════════════════════════════════════════════════════════════════════════════
 * BỐI CẢNH (audit T4): SLO vision P95 được ĐO thật (db/aiAdvanced.ts:267 —
 * percentile_cont) nhưng KHÔNG có provider nào feed ngưỡng 200ms vào evaluator,
 * nên không bao giờ cảnh báo. Đường VLM (~1.2s) KHÔNG THỂ đạt 200ms và là
 * async/offline → CHỈ đường ONNX (aiInferenceEngine.runInference) mới tính vào
 * SLO này; VLM bị LOẠI khỏi inline SLO.
 *
 * Mỗi lần runInference (đường ONNX) hoàn tất, gọi recordVisionInferenceLatency()
 * với processingTimeMs → ghi vào ring 1-phút (CÙNG shape policyLatency.ts /
 * state.ts / sloMetricsProvider) và ĐĂNG KÝ provider cho SLO `vision-inference-p95`
 * (last-writer-wins theo id — thay proxy HTTP nếu có). Ngoài ngưỡng → cảnh báo
 * (throttled). CHỈ QUAN SÁT — không bao giờ chặn suy luận.
 *
 * FLAG: VISION_SLO_OBSERVE_ENABLED (mặc định OFF) → record là no-op, không đăng
 * ký provider → bit-compat hoàn toàn. Ngưỡng "good" = VISION_SLO_P95_MS (200).
 *
 * HONEST: không có suy luận nào trong cửa sổ dài → observation null ("no data",
 * không bịa). Ghi nhận không bao giờ ném vào đường suy luận.
 * ════════════════════════════════════════════════════════════════════════════
 */

const SLO_ID = "vision-inference-p95";
const BUCKET_MS = 60_000;
const RING_CAP = 62; // ~1 h + margin (matches sloMetricsProvider / state.ts / policyLatency)
const SAMPLE_CAP = 2048; // p95 estimate buffer (1-minute window, bounded)

interface Bucket {
  startMs: number;
  total: number;
  good: number; // latency ≤ threshold
}

const ring: (Bucket | null)[] = new Array(RING_CAP).fill(null);
let providerRegistered = false;

/** Rolling raw samples of the CURRENT 1-minute window (for currentVisionP95Ms only). */
let sampleWindowStart = 0;
let samples: number[] = [];

/** Warn throttle so a slow model does not flood logs. */
let lastWarnMs = 0;

/** Observe flag — OFF by default (bit-compat: record is a no-op). */
export function isVisionSloObserveEnabled(): boolean {
  return (process.env.VISION_SLO_OBSERVE_ENABLED ?? "false").toLowerCase() === "true";
}

/** The "good" threshold (ms) — spec §2.2 (200ms). Env-overridable. */
export function visionSloThresholdMs(): number {
  const n = Number(process.env.VISION_SLO_P95_MS);
  return Number.isFinite(n) && n > 0 ? n : 200;
}

function shortWindowMs(): number {
  const n = parseInt(process.env.OBS_SLO_SHORT_WINDOW_MS || String(5 * 60_000), 10);
  return Number.isFinite(n) && n >= BUCKET_MS ? n : 5 * 60_000;
}
function longWindowMs(): number {
  const n = parseInt(process.env.OBS_SLO_LONG_WINDOW_MS || String(60 * 60_000), 10);
  return Number.isFinite(n) && n >= BUCKET_MS ? n : 60 * 60_000;
}

function sumWindow(windowMs: number, now: number): { total: number; good: number } {
  const cutoff = now - windowMs;
  const out = { total: 0, good: 0 };
  for (const b of ring) {
    if (!b) continue;
    if (b.startMs <= cutoff || b.startMs > now) continue;
    out.total += b.total;
    out.good += b.good;
  }
  return out;
}

/**
 * Observation provider for `vision-inference-p95`: (good = inferences ≤ threshold,
 * total) over the short/long rolling windows. null until real inferences exist.
 */
export function visionInferenceSloObservation():
  | { short: { good: number; total: number }; long: { good: number; total: number } }
  | null {
  const now = Date.now();
  const long = sumWindow(longWindowMs(), now);
  if (long.total === 0) return null; // honest: no inference → no data
  const short = sumWindow(shortWindowMs(), now);
  return { short, long };
}

function registerProvider(): void {
  // Cheap + idempotent (Map.set, last-writer-wins). Re-called on every record so a
  // later installSloMetricsProviders()/HTTP-proxy registration never sticks over
  // this real feed regardless of startup order.
  void (async () => {
    try {
      const { registerSloObservationProvider } = await import("../observability/sloAlerting");
      registerSloObservationProvider(SLO_ID, visionInferenceSloObservation);
      if (!providerRegistered) {
        providerRegistered = true;
        console.log(
          `[vision] ${SLO_ID} SLO provider registered (threshold ${visionSloThresholdMs()}ms — real ONNX measurement).`,
        );
      }
    } catch {
      /* observability module unavailable — measuring still works locally */
    }
  })();
}

/**
 * Record one VISION-INFERENCE (ONNX path) latency sample, in ms. No-op unless
 * VISION_SLO_OBSERVE_ENABLED. Warns (throttled) when the sample exceeds the SLO
 * threshold. NEVER throws — pure observation, never blocks inference.
 */
export function recordVisionInferenceLatency(durationMs: number): void {
  if (!isVisionSloObserveEnabled()) return;
  try {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    const now = Date.now();
    const startMs = now - (now % BUCKET_MS);
    const idx = Math.floor(startMs / BUCKET_MS) % RING_CAP;
    let b = ring[idx];
    if (!b || b.startMs !== startMs) {
      b = { startMs, total: 0, good: 0 };
      ring[idx] = b;
    }
    const threshold = visionSloThresholdMs();
    b.total += 1;
    if (durationMs <= threshold) b.good += 1;
    else if (now - lastWarnMs > BUCKET_MS) {
      lastWarnMs = now;
      console.warn(
        `[vision] ONNX inference ${Math.round(durationMs)}ms exceeds ${SLO_ID} threshold ${threshold}ms ` +
          `(observe-only; inference not blocked).`,
      );
    }

    // p95 sample buffer — reset when the 1-minute window rolls; bounded.
    if (sampleWindowStart !== startMs) {
      sampleWindowStart = startMs;
      samples = [];
    }
    if (samples.length < SAMPLE_CAP) samples.push(durationMs);

    registerProvider();
  } catch {
    /* metrics must never break an inference */
  }
}

/** Approximate p95 (ms) of the current 1-minute window; null when no samples. */
export function currentVisionP95Ms(): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return Math.round(sorted[Math.max(0, idx)] * 1000) / 1000;
}

/** Test seam: clear the latency ring + sample buffer. */
export function _resetVisionInferenceSloForTests(): void {
  ring.fill(null);
  samples = [];
  sampleWindowStart = 0;
  providerRegistered = false;
  lastWarnMs = 0;
}
