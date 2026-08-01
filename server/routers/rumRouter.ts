/**
 * Doc 44 G5.9 — RUM ingest (client web-vitals → Prometheus histograms).
 *
 * publicProcedure CÓ CHỦ ĐÍCH: đo cả trang trước-login (Login/Setup). Bù lại:
 *  - zod chặt: metric enum [lcp,cls,inp,ttfb], value 0..120000 hữu hạn,
 *    route ≤ 200 ký tự, batch 1..50 mẫu.
 *  - throttle in-memory per-IP (fixed window 1 phút) — rate-limit express
 *    sẵn có (createApiLimiter) là tầng ngoài, đây là chốt riêng cho endpoint
 *    ghi-không-auth này; fail-open khi thiếu IP.
 *  - route label được chuẩn hoá LẠI phía server (bỏ id số, whitelist ký tự,
 *    cắt 120) để client hostile không nổ cardinality Prometheus.
 *
 * KHÔNG ghi DB — chỉ đổ vào prom histogram (no-op khi METRICS_ENABLED tắt).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../_core/trpc";
import { observeRumWebVital, type RumWebVitalMetric } from "../_core/metrics";

const RUM_METRICS = ["lcp", "cls", "inp", "ttfb"] as const;

const rumSampleSchema = z.object({
  metric: z.enum(RUM_METRICS),
  value: z.number().finite().min(0).max(120000),
  route: z.string().min(1).max(200),
});

export const rumReportInputSchema = z.object({
  samples: z.array(rumSampleSchema).min(1).max(50),
});

/** Chuẩn hoá route label phía server — không tin route từ client. */
export function normalizeRumRouteLabel(route: string): string {
  let r = route.split("?")[0].split("#")[0];
  r = r.replace(/\/\d+(?=\/|$)/g, "/:id");
  // Whitelist ký tự an toàn cho label; phần còn lại → "_".
  r = r.replace(/[^a-zA-Z0-9/_\-:.]/g, "_");
  if (r.length > 120) r = r.slice(0, 120);
  return r || "/";
}

// ── Throttle in-memory per-IP (fixed window) ─────────────────────────────────
const RUM_WINDOW_MS = 60_000;
const RUM_MAX_REPORTS_PER_WINDOW = 60; // 60 report/phút/IP (mỗi report ≤ 50 mẫu)
const reportCounts = new Map<string, { count: number; resetAt: number }>();

function checkRumThrottle(ip: string | undefined, now = Date.now()): boolean {
  if (!ip) return true; // fail-open khi không xác định được IP (proxy lạ)
  const entry = reportCounts.get(ip);
  if (!entry || entry.resetAt <= now) {
    reportCounts.set(ip, { count: 1, resetAt: now + RUM_WINDOW_MS });
    // Dọn map bounded — xoá cửa sổ đã hết hạn khi phình to.
    if (reportCounts.size > 10_000) {
      for (const [k, v] of reportCounts) if (v.resetAt <= now) reportCounts.delete(k);
    }
    return true;
  }
  entry.count += 1;
  return entry.count <= RUM_MAX_REPORTS_PER_WINDOW;
}

/** Reset throttle — CHỈ dùng cho test. */
export function __resetRumThrottleForTest(): void {
  reportCounts.clear();
}

export const rumRouter = router({
  report: publicProcedure.input(rumReportInputSchema).mutation(({ input, ctx }) => {
    const ip = (ctx as { req?: { ip?: string } }).req?.ip;
    if (!checkRumThrottle(ip)) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "RUM report rate limit exceeded" });
    }
    for (const sample of input.samples) {
      observeRumWebVital(
        sample.metric as RumWebVitalMetric,
        normalizeRumRouteLabel(sample.route),
        sample.value,
      );
    }
    return { accepted: input.samples.length } as const;
  }),
});
