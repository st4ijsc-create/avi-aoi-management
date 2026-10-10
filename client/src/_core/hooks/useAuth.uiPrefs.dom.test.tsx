// @vitest-environment jsdom
//
// doc 81 Đợt 4 Task D1 fix 1 #3 — đăng xuất đẩy NỐT sở thích giao diện đang chờ debounce TRƯỚC khi phiên mất (sau đăng xuất
// lượt đẩy bị từ chối và lần đăng nhập sau server sẽ ghi đè thay đổi cuối). Flush hỏng/treo không chặn đăng xuất.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({ order: [] as string[], flush: vi.fn(), mutateAsync: vi.fn() }));
vi.mock("@/lib/uiPrefsSync", () => ({ flushUiPrefs: h.flush }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ auth: { me: { setData: vi.fn(), invalidate: vi.fn(async () => {}) } } }),
    auth: {
      me: { useQuery: () => ({ data: { id: 3 }, isLoading: false, error: null }) },
      logout: { useMutation: () => ({ mutateAsync: h.mutateAsync, isPending: false, error: null }) },
    },
  },
}));

import { useAuth } from "./useAuth";

afterEach(() => {
  cleanup();
  h.order.length = 0;
  h.flush.mockReset();
  h.mutateAsync.mockReset();
});

describe("useAuth.logout — đẩy nốt sở thích giao diện trước (D1 fix 1 #3)", () => {
  it("★ flushUiPrefs chạy XONG trước lượt gọi auth.logout", async () => {
    h.flush.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      h.order.push("flush");
    });
    h.mutateAsync.mockImplementation(async () => void h.order.push("logout"));
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.logout();
    });
    expect(h.order).toEqual(["flush", "logout"]);
  });
});
