// @vitest-environment jsdom
//
// Đợt 11.8 (UX-D09) — chỉ báo hàng chờ: chỉ hỏi khi `bat` VÀ tài liệu đang hiện; chu kỳ 10 s; lỗi/không quyền/0 ⇒ ẩn, không toast.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const H = vi.hoisted(() => ({ opts: [] as Array<Record<string, unknown>>, ket: { data: undefined as unknown, isError: false }, toast: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k: string, a?: unknown, b?: Record<string, unknown>) => (typeof a === "string" ? a.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(b?.[k] ?? "")) : _k) }),
}));
vi.mock("sonner", () => ({ toast: { error: H.toast, success: H.toast, info: H.toast } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    aiAgent: {
      trangThaiHangCho: {
        useQuery: (_i: unknown, o: Record<string, unknown>) => {
          H.opts.push(o);
          return { data: o.enabled ? H.ket.data : undefined, isError: H.ket.isError };
        },
      },
    },
  },
}));

import { ChiBaoHangCho, CHU_KY_HANG_CHO_MS } from "./ChiBaoHangCho";

const datHien = (v: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};
const cuoi = () => H.opts[H.opts.length - 1]!;

beforeEach(() => {
  H.opts = [];
  H.ket = { data: { ok: true, note: null, phiaTruoc: 3 }, isError: false };
  H.toast.mockReset();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(cleanup);

describe("ChiBaoHangCho", () => {
  it("bật + hiện ⇒ hỏi mỗi 10 s và vẽ 'N lượt đứng trước'", () => {
    render(<ChiBaoHangCho bat />);
    expect(cuoi()).toMatchObject({ enabled: true, refetchInterval: CHU_KY_HANG_CHO_MS, retry: false, refetchOnWindowFocus: false });
    expect(CHU_KY_HANG_CHO_MS).toBe(10_000);
    expect(screen.getByTestId("agent-hang-cho").textContent).toContain("3");
  });

  it("★ tab ẩn ⇒ DỪNG hỏi (enabled=false, không refetchInterval) và ẩn; hiện lại ⇒ hỏi lại", () => {
    render(<ChiBaoHangCho bat />);
    datHien("hidden");
    expect(cuoi()).toMatchObject({ enabled: false, refetchInterval: false });
    expect(screen.queryByTestId("agent-hang-cho")).toBeNull();
    datHien("visible");
    expect(cuoi()).toMatchObject({ enabled: true, refetchInterval: CHU_KY_HANG_CHO_MS });
    expect(screen.getByTestId("agent-hang-cho")).toBeInTheDocument();
  });

  it("★ rời tab agent / đã có lượt chạy (bat=false) ⇒ không hỏi, không vẽ", () => {
    render(<ChiBaoHangCho bat={false} />);
    expect(cuoi()).toMatchObject({ enabled: false, refetchInterval: false });
    expect(screen.queryByTestId("agent-hang-cho")).toBeNull();
  });

  it("lỗi / không quyền / null / 0 ⇒ ẨN, không toast", () => {
    for (const k of [
      { data: { ok: false, note: "PERMISSION_DENIED", phiaTruoc: 5 }, isError: false },
      { data: { ok: true, note: null, phiaTruoc: 4 }, isError: true },
      { data: { ok: true, note: null, phiaTruoc: null }, isError: false },
      { data: { ok: true, note: null, phiaTruoc: 0 }, isError: false },
    ]) {
      H.ket = k;
      const { unmount } = render(<ChiBaoHangCho bat />);
      expect(screen.queryByTestId("agent-hang-cho")).toBeNull();
      unmount();
    }
    expect(H.toast).not.toHaveBeenCalled();
  });
});
