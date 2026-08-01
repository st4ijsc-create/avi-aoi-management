/**
 * usePollingInterval — quy ước chung cho các trang POLL nhanh (≤5s)
 * (doc 27 gap B12/R10): KHÔNG poll khi tab bị ẩn, quay lại tab thì refetch NGAY.
 *
 * Đây là wrapper mỏng quanh cơ chế sẵn có của react-query (không tự chế timer):
 *  - `refetchInterval` bị tắt (false) khi `document.visibilityState === "hidden"`
 *    — theo dõi qua Page Visibility API bằng useSyncExternalStore;
 *  - `refetchIntervalInBackground: false` — belt-and-braces, v5 vốn đã dừng
 *    interval khi mất focus, nhưng ta khai báo tường minh để không phụ thuộc
 *    default của phiên bản;
 *  - `refetchOnWindowFocus: "always"` — người dùng quay lại tab là dữ liệu được
 *    làm mới ngay lập tức (kể cả khi chưa stale), rồi interval tự chạy tiếp.
 *
 * Cách dùng:
 *   const polling = usePollingInterval(5000);
 *   trpc.foo.bar.useQuery(input, { ...polling });
 *   // có điều kiện: usePollingInterval(canView ? 5000 : false)
 *
 * Ghi chú trung thực: poll vẫn là poll — dữ liệu KHÔNG "live". Trang nào cần
 * nhãn độ tươi thì kèm <PollFreshness updatedAt={q.dataUpdatedAt} …/>.
 */
import { useSyncExternalStore } from "react";

/** Phần document mà store cần — tách interface để unit-test không cần jsdom. */
export interface VisibilityDocLike {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  readonly visibilityState: DocumentVisibilityState;
}

/**
 * External store cho Page Visibility. `doc` inject được để test trong môi
 * trường node (không có DOM) — mặc định là `document` thật.
 */
export function createVisibilityStore(doc: VisibilityDocLike | undefined) {
  return {
    subscribe(onChange: () => void): () => void {
      if (!doc) return () => {};
      doc.addEventListener("visibilitychange", onChange);
      return () => doc.removeEventListener("visibilitychange", onChange);
    },
    /** true = tab đang hiển thị (hoặc không có DOM — SSR/test → coi như hiển thị). */
    getSnapshot(): boolean {
      return doc ? doc.visibilityState !== "hidden" : true;
    },
  };
}

/**
 * Ánh xạ (visible, baseMs) → options react-query. Pure — unit-test trực tiếp.
 * `baseMs = false` (hoặc 0) tắt poll hoàn toàn (giữ nguyên pattern
 * `enabled ? 5000 : false` của các trang hiện có).
 */
export function pollingQueryOptions(visible: boolean, baseMs: number | false) {
  return {
    refetchInterval: visible && baseMs ? baseMs : (false as const),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
  } as const;
}

const defaultStore = createVisibilityStore(
  typeof document === "undefined" ? undefined : document,
);

/**
 * Hook chính: trả về object spread thẳng vào options của useQuery.
 * Khi tab ẩn → refetchInterval=false (poll dừng); tab hiện lại →
 * visibilitychange re-render với interval bật + focus event của react-query
 * ("always") refetch ngay.
 */
export function usePollingInterval(baseMs: number | false) {
  const visible = useSyncExternalStore(
    defaultStore.subscribe,
    defaultStore.getSnapshot,
    () => true,
  );
  return pollingQueryOptions(visible, baseMs);
}

export default usePollingInterval;
