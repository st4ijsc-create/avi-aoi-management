/**
 * G0 — Observability: Prometheus metrics (feature-flag).
 *
 * Bật bằng `METRICS_ENABLED=true`. Khi tắt hoặc thiếu package `prom-client`,
 * toàn bộ module no-op để build/runtime không bị ảnh hưởng (single-instance vẫn chạy).
 *
 * Endpoint `/metrics` sẽ trả về định dạng Prometheus khi đã khởi tạo, ngược lại 404.
 */

type PromRegistry = {
  contentType: string;
  metrics: () => Promise<string>;
};

let registry: PromRegistry | null = null;
let httpRequestCounter: { inc: (labels: Record<string, string>) => void } | null = null;
let httpDurationHistogram: {
  observe: (labels: Record<string, string>, value: number) => void;
} | null = null;
let initialized = false;

// Doc 44 G5.9 — RUM web-vitals histograms (route-labelled), feed từ rumRouter.
type HistogramLike = { observe: (labels: Record<string, string>, value: number) => void };
export type RumWebVitalMetric = "lcp" | "cls" | "inp" | "ttfb";
let rumHistograms: Record<RumWebVitalMetric, HistogramLike> | null = null;

function metricsEnabled(): boolean {
  return process.env.METRICS_ENABLED === "true";
}

/**
 * Khởi tạo Prometheus registry + default metrics. An toàn gọi nhiều lần.
 */
export async function initMetrics(): Promise<boolean> {
  if (initialized) return registry !== null;
  initialized = true;

  if (!metricsEnabled()) {
    console.log("[Metrics] METRICS_ENABLED chưa bật — bỏ qua Prometheus metrics.");
    return false;
  }

  try {
    const pkg = "prom-client";
    const promClient = await import(pkg).catch(() => null);
    if (!promClient) {
      console.warn("[Metrics] Thiếu package 'prom-client' — cài để bật /metrics. Đang no-op.");
      return false;
    }

    const client = (promClient as any).default ?? promClient;
    const reg = new client.Registry();
    client.collectDefaultMetrics({ register: reg, prefix: "avi_aoi_" });

    httpRequestCounter = new client.Counter({
      name: "avi_aoi_http_requests_total",
      help: "Tổng số HTTP request theo method/route/status",
      labelNames: ["method", "route", "status"],
      registers: [reg],
    });

    httpDurationHistogram = new client.Histogram({
      name: "avi_aoi_http_request_duration_seconds",
      help: "Thời gian xử lý HTTP request (giây)",
      labelNames: ["method", "route", "status"],
      buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
      registers: [reg],
    });

    // Doc 44 G5.9 — RUM web-vitals từ client (rumRouter.report). Label duy nhất
    // là route (đã chuẩn hoá :id phía client + server) để không nổ cardinality.
    // Đăng ký vào CẢ default registry (client.register): SLO provider screen-load-p95
    // (sloMetricsProvider) tra cứu bằng client.register.getSingleMetric theo tên.
    const rumRegisters = [reg, client.register];
    rumHistograms = {
      lcp: new client.Histogram({
        name: "rum_web_vitals_lcp_ms",
        help: "RUM Largest Contentful Paint (ms) theo route",
        labelNames: ["route"],
        buckets: [500, 1000, 1500, 2000, 3000, 5000, 8000],
        registers: rumRegisters,
      }),
      cls: new client.Histogram({
        name: "rum_web_vitals_cls",
        help: "RUM Cumulative Layout Shift (không đơn vị) theo route",
        labelNames: ["route"],
        buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
        registers: rumRegisters,
      }),
      inp: new client.Histogram({
        name: "rum_web_vitals_inp_ms",
        help: "RUM Interaction to Next Paint xấp xỉ (ms, max event duration) theo route",
        labelNames: ["route"],
        buckets: [100, 200, 300, 500, 800, 1500, 3000],
        registers: rumRegisters,
      }),
      ttfb: new client.Histogram({
        name: "rum_web_vitals_ttfb_ms",
        help: "RUM Time To First Byte (ms) theo route",
        labelNames: ["route"],
        buckets: [100, 200, 400, 800, 1500, 3000, 8000],
        registers: rumRegisters,
      }),
    };

    // B0.3 — AI Brain runtime telemetry (tier throughput, latency, queue,
    // resident models, VRAM). Collected read-only from router/engine getters
    // on each scrape. Fail-safe: never throws into init.
    try {
      const { registerAiBrainMetrics } = await import("../services/aiMetrics");
      await registerAiBrainMetrics(client, reg);
    } catch (err) {
      console.warn("[Metrics] AI brain metrics off:", (err as Error)?.message);
    }

    registry = reg as PromRegistry;
    console.log("[Metrics] Prometheus metrics đã bật tại /metrics");
    return true;
  } catch (err) {
    console.warn("[Metrics] Khởi tạo metrics thất bại — no-op:", (err as Error)?.message);
    return false;
  }
}

// doc 38 Đợt P — the same request `finish` hook also feeds the SLO rolling-window tracker, so the
// burn-rate evaluator gets a REAL (good,total) feed. Imported statically (light module, no cycle:
// sloMetricsProvider imports slo/sloAlerting, never metrics). Both fns self-gate — cost when
// inactive is one boolean read.
import { recordHttpForSlo, sloHttpTrackingActive } from "../services/observability/sloMetricsProvider";

/**
 * Express middleware ghi nhận latency + đếm request (prom-client) và cấp feed cho SLO evaluator.
 * No-op khi CẢ METRICS_ENABLED (prom) LẪN OBSERVABILITY (SLO tracker) đều tắt — không đính listener.
 */
export function metricsMiddleware() {
  return (req: any, res: any, next: () => void) => {
    const promActive = !!(registry && httpRequestCounter && httpDurationHistogram);
    const sloActive = sloHttpTrackingActive();
    if (!promActive && !sloActive) return next();
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      try {
        const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
        const statusCode = Number(res.statusCode);
        if (promActive) {
          // Dùng route pattern nếu có để tránh nổ cardinality từ path động.
          const route = (req.route?.path as string) || req.baseUrl || req.path || "unknown";
          const labels = {
            method: String(req.method),
            route: String(route),
            status: String(statusCode),
          };
          httpRequestCounter!.inc(labels);
          httpDurationHistogram!.observe(labels, durationSec);
        }
        if (sloActive) {
          recordHttpForSlo(durationSec * 1000, statusCode);
        }
      } catch {
        /* no-op: không để metrics làm hỏng request */
      }
    });
    next();
  };
}

/**
 * Doc 44 G5.9 — ghi 1 mẫu RUM web-vital vào histogram tương ứng.
 * No-op an toàn khi METRICS_ENABLED tắt / prom-client thiếu / chưa init.
 */
export function observeRumWebVital(metric: RumWebVitalMetric, route: string, value: number): void {
  try {
    rumHistograms?.[metric]?.observe({ route }, value);
  } catch {
    /* no-op: metrics không được làm hỏng request */
  }
}

/**
 * Handler cho endpoint GET /metrics. Trả 404 khi metrics chưa bật.
 */
export async function metricsHandler(_req: any, res: any): Promise<void> {
  if (!registry) {
    res.status(404).type("text/plain").send("metrics disabled");
    return;
  }
  try {
    res.setHeader("Content-Type", registry.contentType);
    res.send(await registry.metrics());
  } catch (err) {
    res.status(500).type("text/plain").send("metrics error");
  }
}
