// @vitest-environment jsdom
/**
 * useKhungHep.dom.test.tsx — "khung có hẹp không" phải THEO DÕI, không đọc một lần rồi đóng băng.
 *
 * Kết cục được canh: bảng KPI thu sẵn ở khung hẹp (HM-2a) — đo được nó đưa lớp phủ từ **70,8 %**
 * xuống **58,2 %** canvas @1280×720 và số nhãn vẽ từ **1 → 7**. Nếu hook này đọc một lần rồi
 * đóng băng, người dùng kéo cửa sổ rộng ra vẫn kẹt ở bản thu — và ngược lại.
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useKhungHep } from "./useKhungHep";

type Nghe = (e: { matches: boolean }) => void;
function gaMatchMedia(khopBanDau: boolean) {
  const nghe: Nghe[] = [];
  const mq = {
    matches: khopBanDau,
    addEventListener: (_: string, f: Nghe) => nghe.push(f),
    removeEventListener: (_: string, f: Nghe) => {
      const i = nghe.indexOf(f);
      if (i >= 0) nghe.splice(i, 1);
    },
  };
  (window as unknown as { matchMedia: unknown }).matchMedia = vi.fn(() => mq);
  return {
    doi(khop: boolean) {
      mq.matches = khop;
      for (const f of [...nghe]) f({ matches: khop });
    },
    soNghe: () => nghe.length,
  };
}

afterEach(() => {
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  vi.restoreAllMocks();
});

describe("useKhungHep", () => {
  it("★★★ trả đúng trạng thái BAN ĐẦU, cả hai chiều", () => {
    gaMatchMedia(true);
    expect(renderHook(() => useKhungHep(1366)).result.current).toBe(true);
    gaMatchMedia(false);
    expect(renderHook(() => useKhungHep(1366)).result.current).toBe(false);
  });

  it("★★★ THEO DÕI thay đổi — kéo rộng ra phải thôi hẹp, và kéo hẹp lại phải hẹp", () => {
    const ga = gaMatchMedia(true);
    const { result } = renderHook(() => useKhungHep(1366));
    expect(result.current).toBe(true);
    act(() => ga.doi(false));
    expect(result.current).toBe(false);
    act(() => ga.doi(true));      // ← ca nghịch: một bản cài chỉ nghe một chiều sẽ đỏ ở đây
    expect(result.current).toBe(true);
  });

  it("★★★ KHÔNG có `matchMedia` ⇒ `false` = khung RỘNG = đường CŨ", () => {
    // Một tính năng mới không được tự bật vì thiếu API để hỏi.
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    expect(renderHook(() => useKhungHep(1366)).result.current).toBe(false);
  });

  it("gỡ người nghe khi unmount — nếu không mỗi lần mở màn là một người nghe rác", () => {
    const ga = gaMatchMedia(false);
    const { unmount } = renderHook(() => useKhungHep(1366));
    expect(ga.soNghe()).toBe(1);
    unmount();
    expect(ga.soNghe()).toBe(0);
  });
});
