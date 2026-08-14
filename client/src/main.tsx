import { trpc } from "@/lib/trpc";
import { isUnauthorizedError } from "@/lib/authRedirect";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import { initRum } from "./lib/rum";
import { donKhoNguoiDungLucKhoiDong } from "./lib/donKhoaNguoiDung";
import "./index.css";
import { i18nReady } from "./i18n"; // Initialize i18n (vi fetch song song — doc64 S5-OPT V4)

// Wave 1 (foundation): sane query defaults for the whole app. Previously the
// client was constructed bare — staleTime 0 + refetchOnWindowFocus on = every
// page re-fetched all of its tRPC queries on mount AND on every tab-focus,
// which was the single biggest source of repo-wide over-fetching (audit T5).
// Pages that need live data keep using refetchInterval / sockets, which still
// win over staleTime; this only stops the redundant background churn.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30s — treat data as fresh; kills mount/focus refetch storms
      gcTime: 5 * 60_000, // keep unused cache 5 min for instant back-nav
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * F11 (nhóm C 2026-08-14) — vị từ nhận diện nằm ở `lib/authRedirect.ts` (thuần, test được).
 * Tóm tắt lý do đổi: trước đây khớp ĐÚNG CHUỖI `UNAUTHED_ERR_MSG`, nên sáu tuyến khác cũng
 * ném `UNAUTHORIZED` + `AUTH_REQUIRED` nhưng message khác thì không điều hướng — và handler
 * bên dưới chỉ `console.error` nên cũng không hiện gì. Người dùng kẹt ở màn hình rỗng câm.
 */
const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;
  if (!isUnauthorizedError(error)) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

// Doc 44 G5.17 — phát x-correlation-id cho mỗi batch tRPC (1 "tick" thao tác người
// dùng). Server đọc header này vào AsyncLocalStorage → mọi log/lệnh/genealogy phía
// server mang cùng correlation_id → trace "nút bấm → lệnh → máy". Fallback an toàn khi
// crypto.randomUUID không có (http LAN, secure-context off).
function newCorrelationId(): string {
  try {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
  } catch {
    /* fall through */
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Doc 44 G5.3 — httpBatchLink thay httpLink: N query cùng tick (dashboard nhiều
// widget) gộp thành 1 HTTP request thay vì N request rời. Server dùng
// createExpressMiddleware mặc định (không tắt batching) nên an toàn; batching
// còn GIẢM số request tính vào rate-limit /api (300 req/phút). Giữ nguyên
// transformer + credentials như httpLink cũ (mutation vẫn là POST).
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      headers() {
        return { "x-correlation-id": newCorrelationId() };
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

// ★★★ Pha 7 Task 8b — DỌN dữ liệu người dùng ĐÃ nằm sẵn trên đĩa trình duyệt.
// Gỡ lượt ghi chỉ chặn lượt ghi TIẾP THEO; bản ghi cũ (nguyên đối tượng `auth.me`) vẫn ở trong
// `localStorage` của mọi người đã từng đăng nhập. Chạy TRƯỚC render, đồng bộ, không bao giờ ném.
donKhoNguoiDungLucKhoiDong();

// doc64 S5-OPT V4: chờ vi.json (fetch song song, bắt đầu từ lúc module ./i18n eval)
// rồi mới render — không bao giờ flash key thô. loadVi tự nuốt lỗi nên .then luôn chạy.
void i18nReady.then(() => {
  createRoot(document.getElementById("root")!).render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  );

  // Doc 44 G5.9 — client RUM (web-vitals qua PerformanceObserver, không dep mới).
  // Gọi SAU render, fire-and-forget — không bao giờ chặn hay làm hỏng app.
  initRum();
});

// Phase 5 WS5.1 — PWA service worker. Đăng ký CHỈ khi VITE_ENABLE_SW='true'
// (production PWA). Mặc định TẮT + tự UNREGISTER mọi SW cũ + xoá cache của nó:
// trong lúc dev/test rebuild liên tục, SW stale-while-revalidate phục vụ main-bundle
// cũ trỏ tới chunk hash đã chết → chunk 404 → server trả index.html → lỗi MIME
// "Failed to load module script". Tắt SW cho luồng test sạch; bật lại khi ship PWA.
if ("serviceWorker" in navigator) {
  const enableSw = import.meta.env.PROD && import.meta.env.VITE_ENABLE_SW === "true";
  if (enableSw) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  } else {
    // Gỡ mọi SW đang kiểm soát + xoá cache của chúng để hết stale-chunk.
    navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const r of regs) r.unregister().catch(() => {});
    }).catch(() => {});
    if ("caches" in window) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
    }
  }
}
