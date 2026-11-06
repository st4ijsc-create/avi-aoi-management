/**
 * Observability bootstrap (QW4 / GAP G11).
 *
 * ★ Pha 0 P0-5 (2026-11-04): gỡ khung theo dõi lỗi / vết ngoài (không gói nào được cài, cờ chưa từng bật — mã chết + cờ chết).
 * Còn lại: bộ đánh giá SLO burn-rate + nguồn số đo HTTP (`/metrics` Prometheus ở `server/_core/metrics*` không đổi).
 */

let initialized = false;

export async function initObservability(): Promise<void> {
  if (initialized) return;
  initialized = true;
  // doc 37 C1 — start the SLO burn-rate evaluator + alert bridge (flag-gated inside; no-op when
  // OBSERVABILITY is off or no observation provider is registered). Never throws into startup.
  try {
    const { startSloEvaluator } = await import("../services/observability/sloAlerting");
    startSloEvaluator();
    // doc 38 Đợt P (P0-A) — register the HTTP-derived observation feed for every catalogue SLO so
    // the evaluator has REAL (good,total) short/long windows to burn against. No-op when
    // OBSERVABILITY is off (evaluator is off too). Must run AFTER startSloEvaluator so the loop is
    // already scheduled to pick up the freshly-registered providers on its next tick.
    const { installSloMetricsProviders } = await import("../services/observability/sloMetricsProvider");
    installSloMetricsProviders();
  } catch (err: any) {
    console.error("[Observability] SLO evaluator start failed:", err?.message ?? err);
  }
}
