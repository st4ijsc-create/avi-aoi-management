// @vitest-environment jsdom
//
// Lô B7-D — tab Thống kê: định dạng số + hiển thị dữ liệu `flow.thongKe` (trpc giả); đổi cửa sổ ngày gửi lại truy vấn; bảng trống nói rõ "chưa có dữ liệu"; đổi khe ghi là ƯỚC LƯỢNG.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const h = vi.hoisted(() => ({ goi: [] as unknown[], du: null as unknown }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k) }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: { flow: { thongKe: { useQuery: (i: unknown) => { h.goi.push(i); return { data: h.du, isLoading: false }; } } } },
}));

import FlowThongKe, { dinhDangGiay, dinhDangPhanTram } from "./FlowThongKe";

afterEach(() => {
  cleanup();
  h.goi.length = 0;
});
const tid = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement;
const DU = {
  ngay: 7,
  luot: { tong: 8, xong: 4, loi: 1, huy: 1, dangChay: 1, choDuyet: 1, tiLeThanhCong: 0.6667 },
  thoiGianLuotXongGiay: { soLuot: 4, p50: 25, p90: 37 },
  theoNut: [{ nodeId: "a", soBuoc: 4, soLoi: 1, p50Giay: 2.5, p90Giay: 3.7 }],
  theoModel: [{ model: "model-A", soLoiGoi: 3, tokenVao: 302, tokenRa: 32, khongBaoToken: 2 }],
  doiKhe: { uocLuong: 2, luotKheBan: 1, ghiChu: "x" },
};

describe("FlowThongKe", () => {
  it("định dạng: giây (null ⇒ —, ≥100 làm tròn) và phần trăm", () => {
    expect(dinhDangGiay(null)).toBe("—");
    expect(dinhDangGiay(2.54)).toBe("2.5 s");
    expect(dinhDangGiay(123.4)).toBe("123 s");
    expect(dinhDangPhanTram(null)).toBe("—");
    expect(dinhDangPhanTram(0.6667)).toBe("66.7%");
  });

  it("hiện tỉ lệ, p50/p90, bảng node + model (kèm số lời gọi không báo token), đổi khe là ước lượng; đổi cửa sổ ⇒ truy vấn lại với ngày mới", () => {
    h.du = DU;
    const { container } = render(<FlowThongKe flowId="f1" />);
    expect(h.goi[0]).toEqual({ flowId: "f1", ngay: 7 });
    expect(tid(container, "tk-ti-le").textContent).toBe("66.7%");
    expect(tid(container, "tk-p50").textContent).toBe("p50 25 s");
    expect(tid(container, "tk-theo-nut").textContent).toContain("a");
    expect(tid(container, "tk-theo-model").textContent).toContain("302");
    expect(tid(container, "tk-theo-model").textContent).toContain("flowStudio.thongKe.khongBaoToken");
    expect(tid(container, "tk-doi-khe").textContent).toContain("flowStudio.thongKe.doiKhe");
    fireEvent.change(tid(container, "tk-ngay"), { target: { value: "30" } });
    expect(h.goi.at(-1)).toEqual({ flowId: "f1", ngay: 30 });
  });

  it("chưa có lượt: tỉ lệ — và hai bảng báo chưa có dữ liệu", () => {
    h.du = { ...DU, luot: { ...DU.luot, tong: 0, tiLeThanhCong: null }, thoiGianLuotXongGiay: { soLuot: 0, p50: null, p90: null }, theoNut: [], theoModel: [] };
    const { container } = render(<FlowThongKe flowId="f1" />);
    expect(tid(container, "tk-ti-le").textContent).toBe("—");
    expect(tid(container, "tk-theo-nut")).toBeNull();
    expect(container.textContent).toContain("flowStudio.thongKe.chuaCoDuLieu");
  });
});
