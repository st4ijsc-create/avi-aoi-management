// @vitest-environment jsdom
//
// doc 81 Đợt 4 Task D1 — <UiPrefsSync/>: biết người dùng ⇒ hỏi server MỘT lần qua client tRPC TRẦN (không useQuery/
// useMutation — lỗi không vào cache react-query nên lưới toast toàn cục của main.tsx không bắn); chưa đăng nhập ⇒ không gọi;
// đổi người dùng ⇒ dừng bản cũ, bắt đầu bản mới; server lỗi ⇒ không ném, không toast.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  user: null as null | { id: number },
  query: vi.fn(),
  mutate: vi.fn(),
  hookUsed: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: { userSettingsRouter: { getUiPrefs: { query: h.query }, setUiPrefs: { mutate: h.mutate } } },
    }),
    // Mọi hook react-query của router này bị cấm ở đây (đường lỗi của chúng đi qua lưới toast toàn cục).
    userSettingsRouter: new Proxy({}, { get: (_t, p) => (h.hookUsed(String(p)), undefined) }),
  },
}));

import { UiPrefsSync } from "./UiPrefsSync";
import { __resetUiPrefsSyncForTests, markUiPrefDirty } from "@/lib/uiPrefsSync";

beforeEach(() => {
  localStorage.clear();
  h.user = null;
  h.query.mockReset();
  h.mutate.mockReset();
  h.hookUsed.mockReset();
  h.toastError.mockReset();
});
afterEach(() => {
  cleanup();
  __resetUiPrefsSyncForTests(); // fix 1 #6
});

describe("<UiPrefsSync/>", () => {
  it("chưa đăng nhập ⇒ không gọi server", () => {
    render(<UiPrefsSync />);
    expect(h.query).not.toHaveBeenCalled();
  });

  it("★ đăng nhập ⇒ hỏi MỘT lần qua client trần; áp giá trị server vào localStorage", async () => {
    h.user = { id: 4 };
    h.query.mockResolvedValue({ prefs: { showLabs: true }, available: true });
    render(<UiPrefsSync />);
    await waitFor(() => expect(localStorage.getItem("layoutKit:nav-labs:u4:show")).toBe("1"));
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(h.hookUsed).not.toHaveBeenCalled();
  });

  it("★ server không tới được ⇒ không ném, không toast, localStorage giữ nguyên", async () => {
    h.user = { id: 4 };
    localStorage.setItem("layoutKit:nav-labs:u4:show", "1");
    let rejected = false;
    h.query.mockImplementation(() => {
      rejected = true;
      return Promise.reject(Object.assign(new TypeError("Failed to fetch"), { data: undefined }));
    });
    render(<UiPrefsSync />);
    await waitFor(() => expect(rejected).toBe(true));
    await new Promise((r) => setTimeout(r, 10));
    expect(h.toastError).not.toHaveBeenCalled();
    expect(localStorage.getItem("layoutKit:nav-labs:u4:show")).toBe("1");
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("đổi người dùng ⇒ hỏi lại cho người mới; khoá của người cũ không bị đẩy dưới tên người mới", async () => {
    h.user = { id: 4 };
    h.query.mockResolvedValue({ prefs: {}, available: true });
    h.mutate.mockResolvedValue({ prefs: {} });
    const r = render(<UiPrefsSync />);
    await waitFor(() => expect(h.query).toHaveBeenCalledTimes(1));
    localStorage.setItem("layoutKit:nav-labs:u4:show", "1");
    h.user = { id: 6 };
    r.rerender(<UiPrefsSync />);
    await waitFor(() => expect(h.query).toHaveBeenCalledTimes(2));
    await new Promise((r2) => setTimeout(r2, 10));
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("★ fix 1 #1/#3 — đổi người dùng khi còn lượt ghi chờ debounce ⇒ bản CŨ đẩy nốt dưới expectedUserId CŨ (server từ chối nếu phiên đã đổi)", async () => {
    h.user = { id: 4 };
    h.query.mockResolvedValue({ prefs: {}, available: true, userId: 4 });
    h.mutate.mockResolvedValue({ prefs: {}, userId: 4 });
    const r = render(<UiPrefsSync />);
    await waitFor(() => expect(h.query).toHaveBeenCalledTimes(1));
    await new Promise((r2) => setTimeout(r2, 10));
    localStorage.setItem("layoutKit:nav-labs:u4:show", "1");
    markUiPrefDirty("layoutKit:nav-labs:u4:show");
    h.user = { id: 6 };
    r.rerender(<UiPrefsSync />);
    await waitFor(() => expect(h.mutate).toHaveBeenCalledTimes(1));
    expect(h.mutate).toHaveBeenCalledWith({ patch: { showLabs: true }, expectedUserId: 4 });
  });
});
