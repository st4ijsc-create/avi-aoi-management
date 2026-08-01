/**
 * Doc 44 G5.9 — client RUM (Real User Monitoring), KHÔNG dependency mới.
 *
 * Thu web-vitals bằng PerformanceObserver thuần trình duyệt:
 *  - LCP  (largest-contentful-paint) — lấy entry mới nhất (LCP có thể cập nhật
 *    tới khi user tương tác/tab ẩn).
 *  - CLS  (layout-shift) — cộng dồn theo "session window" đơn giản chuẩn
 *    web-vitals: gap < 1s và window ≤ 5s, lấy max các window.
 *  - INP  XẤP XỈ — max duration của event-timing entries trong phiên (KHÔNG
 *    phải p98 chuẩn có dedup theo interactionId; chỉ là ước lượng trần).
 *  - TTFB (navigation timing responseStart).
 *
 * Mỗi giá trị gắn route hiện tại (pathname, chuẩn hoá bỏ id số → ":id").
 * Batch gửi về tRPC mutation `rum.report` mỗi 30s hoặc khi tab ẩn
 * (visibilitychange→hidden / pagehide). sendBeacon không dùng được với
 * POST JSON của tRPC → dùng fetch keepalive (body nhỏ, dưới hạn 64KB).
 *
 * Sample: 100% ở dev, SAMPLE_RATE=0.3 ở prod (quyết định 1 lần mỗi phiên).
 * Mọi bước đều guard/try-catch — RUM tuyệt đối không được làm hỏng app.
 */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers";

type RumMetric = "lcp" | "cls" | "inp" | "ttfb";

interface RumSample {
  metric: RumMetric;
  value: number;
  route: string;
}

/** Tỉ lệ lấy mẫu ở production (dev luôn 100%). */
const SAMPLE_RATE = 0.3;
const FLUSH_INTERVAL_MS = 30_000;
const MAX_BATCH = 50;
const MAX_ROUTE_LENGTH = 200;

/** Chuẩn hoá route: bỏ query/hash, thay segment toàn số → ":id", cắt 200 ký tự. */
export function normalizeRoute(pathname: string): string {
  let route = (pathname || "/").split("?")[0].split("#")[0];
  route = route.replace(/\/\d+(?=\/|$)/g, "/:id");
  if (route.length > MAX_ROUTE_LENGTH) route = route.slice(0, MAX_ROUTE_LENGTH);
  return route || "/";
}

function currentRoute(): string {
  try {
    return normalizeRoute(window.location.pathname);
  } catch {
    return "/";
  }
}

// Client tRPC "vanilla" riêng cho RUM (không đi qua react-query): fetch với
// keepalive để flush cuối cùng lúc tab ẩn vẫn đi được sau khi page unload.
function makeRumClient() {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        fetch(input, init) {
          return globalThis.fetch(input, {
            ...(init ?? {}),
            credentials: "include",
            keepalive: true,
          });
        },
      }),
    ],
  });
}

let started = false;

export function initRum(): void {
  if (started) return;
  started = true;

  try {
    if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;

    const isDev = !!import.meta.env?.DEV;
    const rate = isDev ? 1 : SAMPLE_RATE;
    if (Math.random() >= rate) return; // phiên này không lấy mẫu

    const client = makeRumClient();

    // Hàng đợi mẫu đã "chốt" chờ gửi.
    const queue: RumSample[] = [];

    // ── Giá trị đang theo dõi (gửi lại chỉ khi tăng/đổi để hạn chế double-count) ──
    let lcpValue: number | null = null;
    let lcpRoute = currentRoute();
    let lcpSent = -1;

    let clsSession = 0;
    let clsSessionMax = 0;
    let clsFirstTs = 0;
    let clsLastTs = 0;
    let clsRoute = currentRoute();
    let clsSent = -1;

    let inpMax = 0;
    let inpRoute = currentRoute();
    let inpSent = -1;

    const supported: string[] = (PerformanceObserver as unknown as { supportedEntryTypes?: string[] })
      .supportedEntryTypes ?? [];

    // ── TTFB: 1 lần từ navigation timing ─────────────────────────────────────
    try {
      const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
      if (nav && Number.isFinite(nav.responseStart) && nav.responseStart > 0) {
        queue.push({ metric: "ttfb", value: Math.round(nav.responseStart), route: currentRoute() });
      }
    } catch {
      /* no-op */
    }

    // ── LCP ──────────────────────────────────────────────────────────────────
    if (supported.includes("largest-contentful-paint")) {
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            lcpValue = Math.round(entry.startTime);
            lcpRoute = currentRoute();
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });
      } catch {
        /* no-op */
      }
    }

    // ── CLS (session windows: gap < 1s, window ≤ 5s, lấy max) ────────────────
    if (supported.includes("layout-shift")) {
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
            if (shift.hadRecentInput || !Number.isFinite(shift.value)) continue;
            const ts = shift.startTime;
            if (clsSession > 0 && ts - clsLastTs < 1000 && ts - clsFirstTs < 5000) {
              clsSession += shift.value;
            } else {
              clsSession = shift.value;
              clsFirstTs = ts;
            }
            clsLastTs = ts;
            if (clsSession > clsSessionMax) {
              clsSessionMax = clsSession;
              clsRoute = currentRoute();
            }
          }
        }).observe({ type: "layout-shift", buffered: true });
      } catch {
        /* no-op */
      }
    }

    // ── INP xấp xỉ (max event duration; KHÔNG dedup interactionId → chỉ ước lượng) ──
    if (supported.includes("event")) {
      try {
        const obs = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const dur = entry.duration;
            if (Number.isFinite(dur) && dur > inpMax) {
              inpMax = dur;
              inpRoute = currentRoute();
            }
          }
        });
        // durationThreshold: bỏ qua event < 40ms (giảm nhiễu, theo web-vitals).
        obs.observe({ type: "event", durationThreshold: 40 } as PerformanceObserverInit);
      } catch {
        /* no-op */
      }
    }

    // ── Chốt giá trị đang theo dõi vào queue (chỉ khi thay đổi từ lần gửi trước) ──
    const harvest = () => {
      if (lcpValue != null && lcpValue !== lcpSent) {
        queue.push({ metric: "lcp", value: lcpValue, route: lcpRoute });
        lcpSent = lcpValue;
      }
      if (clsSessionMax > 0 && clsSessionMax !== clsSent) {
        // CLS không đơn vị — làm tròn 4 chữ số thập phân.
        queue.push({ metric: "cls", value: Math.round(clsSessionMax * 10000) / 10000, route: clsRoute });
        clsSent = clsSessionMax;
      }
      if (inpMax > 0 && inpMax !== inpSent) {
        queue.push({ metric: "inp", value: Math.round(inpMax), route: inpRoute });
        inpSent = inpMax;
      }
    };

    const flush = () => {
      try {
        harvest();
        if (queue.length === 0) return;
        const samples = queue.splice(0, MAX_BATCH).map((s) => ({
          ...s,
          value: Math.min(Math.max(s.value, 0), 120000),
        }));
        // Fire-and-forget — lỗi mạng/server không bao giờ nổi lên UI.
        void client.rum.report.mutate({ samples }).catch(() => {});
      } catch {
        /* no-op */
      }
    };

    window.setInterval(flush, FLUSH_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    // Safari không bắn visibilitychange tin cậy khi unload → thêm pagehide.
    window.addEventListener("pagehide", flush);
  } catch {
    /* RUM không bao giờ được phép làm hỏng app */
  }
}
