/**
 * Doc 81 Đợt 2 Task 3 (fix round 1) — HẠ TẦNG TEST (không phải test): `matchMedia` điều khiển được.
 *
 * jsdom không có `matchMedia`. Mock cũ trả `matches` cố định lúc gọi và KHÔNG BAO GIỜ bắn `change`,
 * nên việc "qua lại mốc 1024 px khi trang đang mở" không thể kiểm (review I3). Ở đây `matches` là
 * getter đọc trạng thái hiện tại, và `setNarrow()` bắn `change` cho mọi listener đã đăng ký — đúng
 * đường `useNarrowViewport` dùng trên trình duyệt.
 */
import { act } from "@testing-library/react";

type Listener = (ev: { matches: boolean }) => void;

let narrow = false;
const listeners = new Set<Listener>();

export function installMatchMedia(): void {
  window.matchMedia = ((q: string) => {
    const isNarrowQuery = q.includes("max-width");
    return {
      get matches() {
        return narrow && isNarrowQuery;
      },
      media: q,
      onchange: null,
      addEventListener: (_: string, l: Listener) => listeners.add(l),
      removeEventListener: (_: string, l: Listener) => listeners.delete(l),
      addListener: (l: Listener) => listeners.add(l),
      removeListener: (l: Listener) => listeners.delete(l),
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}

/** Đặt trạng thái TRƯỚC khi render (không bắn sự kiện). */
export function presetNarrow(v: boolean): void {
  narrow = v;
}

/** Đổi bề rộng khi trang đang mở: bắn `change` như trình duyệt. */
export function setNarrow(v: boolean): void {
  narrow = v;
  act(() => {
    for (const l of [...listeners]) l({ matches: v });
  });
}
