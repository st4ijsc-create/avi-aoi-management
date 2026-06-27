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

/**
 * Express middleware ghi nhận latency + đếm request. No-op khi metrics chưa bật.
 */
export function metricsMiddleware() {
  return (req: any, res: any, next: () => void) => {
    if (!registry || !httpRequestCounter || !httpDurationHistogram) return next();
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      try {
        const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
        // Dùng route pattern nếu có để tránh nổ cardinality từ path động.
        const route = (req.route?.path as string) || req.baseUrl || req.path || "unknown";
        const labels = {
          method: String(req.method),
          route: String(route),
          status: String(res.statusCode),
        };
        httpRequestCounter!.inc(labels);
        httpDurationHistogram!.observe(labels, durationSec);
      } catch {
        /* no-op: không để metrics làm hỏng request */
      }
    });
    next();
  };
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
