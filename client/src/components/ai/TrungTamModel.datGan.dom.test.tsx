// @vitest-environment jsdom
//
// Trung tâm Model — form "Đặt gán": (1) cảnh báo chế độ thử/chạy bóng KHÔNG đổi model đang chạy; (2) thông báo thành công CỤ THỂ (vai → đích, chế độ) và "Không đổi" khi máy chủ báo khongDoi.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const h = vi.hoisted(() => ({
  thanhCong: [] as string[],
  thongTin: [] as string[],
  mutate: [] as unknown[],
  tra: { id: 1, daThay: 1 } as { id: number; daThay: number; khongDoi?: boolean },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, def?: unknown, o?: Record<string, unknown>) => {
      const mau = typeof def === "string" ? def : k;
      const p = (typeof def === "object" && def ? def : o) as Record<string, unknown> | undefined;
      return p ? mau.replace(/\{\{(\w+)\}\}/g, (_m, n) => String(p[n] ?? "")) : mau;
    },
  }),
}));
vi.mock("sonner", () => ({ toast: { success: (m: string) => h.thanhCong.push(m), info: (m: string) => h.thongTin.push(m), error: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    aiGguf: {
      soModelDatGan: {
        useMutation: (o: { onSuccess?: (r: unknown, v: unknown) => void }) => ({
          mutate: (v: unknown) => {
            h.mutate.push(v);
            o.onSuccess?.(h.tra, v);
          },
          isPending: false,
          error: null,
        }),
      },
    },
  },
}));
vi.mock("@/lib/trpcErrors", () => ({ mapTrpcError: () => "loi", toastTrpcError: vi.fn() }));

import { TabVaiTro } from "./TrungTamModel";

afterEach(() => {
  cleanup();
  h.thanhCong.length = 0;
  h.thongTin.length = 0;
  h.mutate.length = 0;
  h.tra = { id: 1, daThay: 1 };
});
const D = {
  vaiTro: [{ id: "classify", envKey: "GGUF_CLASSIFY_MODEL", moTa: "phân loại", evalSuite: null, dinhTuyen: { model: null, nguon: "mac-dinh-env", lyDo: { tang: 1, bangChung: "b" } } }],
  gan: [],
  evalRuns: [],
  hoSoCoDo: [],
  profiles: [],
} as never;
const sel = (c: HTMLElement, ten: string) => c.querySelector(`[name="${ten}"]`) as HTMLSelectElement;
function dienForm(c: HTMLElement, mode?: string) {
  fireEvent.change(sel(c, "roleId"), { target: { value: "classify" } });
  fireEvent.change(sel(c, "dich"), { target: { value: "GGUF_CLASSIFY_MODEL" } });
  if (mode) fireEvent.change(sel(c, "mode"), { target: { value: mode } });
}

describe("Đặt gán — cảnh báo chế độ", () => {
  it("★ mặc định 'thu' ⇒ hiện cảnh báo 'KHÔNG đổi model đang chạy'; shadow cũng hiện; active ⇒ ẨN", () => {
    const { container, queryByTestId } = render(<TabVaiTro d={D} lamMoi={vi.fn()} />);
    expect(queryByTestId("canh-bao-che-do")?.textContent).toContain("KHÔNG đổi model đang chạy");
    fireEvent.change(sel(container, "mode"), { target: { value: "shadow" } });
    expect(queryByTestId("canh-bao-che-do")).not.toBeNull();
    fireEvent.change(sel(container, "mode"), { target: { value: "active" } });
    expect(queryByTestId("canh-bao-che-do")).toBeNull();
  });
});

describe("Đặt gán — thông báo thành công", () => {
  it("★ gán thật ⇒ 'Đã gán classify → GGUF_CLASSIFY_MODEL (active) — thay 1 gán cũ.' (nêu vai, đích, chế độ)", () => {
    const lamMoi = vi.fn();
    const { container } = render(<TabVaiTro d={D} lamMoi={lamMoi} />);
    dienForm(container, "active");
    fireEvent.submit(container.querySelector('[data-testid="form-dat-gan"]')!);
    expect(h.mutate).toHaveLength(1);
    // (bản dịch giả trả nhãn mặc định = mã chế độ; bản thật hiện "chạy thật")
    expect(h.thanhCong).toEqual(["Đã gán classify → GGUF_CLASSIFY_MODEL (active) — thay 1 gán cũ."]);
    expect(h.thongTin).toHaveLength(0);
    expect(lamMoi).toHaveBeenCalled();
  });

  it("★ máy chủ báo khongDoi ⇒ thông báo 'Không đổi: classify đã gán đúng GGUF_CLASSIFY_MODEL (thu).' (không nói 'Đã gán')", () => {
    h.tra = { id: 7, daThay: 0, khongDoi: true };
    const { container } = render(<TabVaiTro d={D} lamMoi={vi.fn()} />);
    dienForm(container);
    fireEvent.submit(container.querySelector('[data-testid="form-dat-gan"]')!);
    expect(h.thongTin).toEqual(["Không đổi: classify đã gán đúng GGUF_CLASSIFY_MODEL (thu)."]);
    expect(h.thanhCong).toHaveLength(0);
  });
});
