import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";
import "./i18n"; // Initialize i18n

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

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

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

const trpcClient = trpc.createClient({
  links: [
    httpLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);

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
