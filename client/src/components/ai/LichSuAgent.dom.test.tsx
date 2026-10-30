// @vitest-environment jsdom
//
// Đợt 11.8 — Lịch sử agent: xoá có BƯỚC XÁC NHẬN trong trang + ghi chú "không xoá nhật ký lượt chạy"; đổi tên mang version; chữ thuần; huy hiệu AI ngoài.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, a?: unknown, b?: Record<string, unknown>) => (typeof a === "string" ? a.replace(/\{\{(\w+)\}\}/g, (_m, x) => String(b?.[x] ?? "")) : k),
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));

import { NoiDungLichSuAgent, cauNoteLichSuAgent, type PhienAgentUI } from "./LichSuAgent";

afterEach(cleanup);

const P = (o: Partial<PhienAgentUI> = {}): PhienAgentUI => ({ id: "p1", title: "Sửa <b>Divide</b>", source: "web", turnCount: 4, coLuotNgoai: false, version: 7, updatedAt: "2026-10-30T00:00:00Z", ...o });
const vẽ = (phien: PhienAgentUI[], o: Partial<Parameters<typeof NoiDungLichSuAgent>[0]> = {}) => {
  const h = { onMo: vi.fn(), onDongXem: vi.fn(), onDoiTen: vi.fn(), onXoa: vi.fn() };
  const r = render(<NoiDungLichSuAgent phien={phien} dangTai={false} biTuChoi={false} xem={null} dangGui={null} {...h} {...o} />);
  return { ...r, ...h };
};

describe("NoiDungLichSuAgent", () => {
  it("★ xoá: bấm biểu tượng KHÔNG xoá ngay — hiện bước xác nhận kèm ghi chú nhật ký; chỉ 'Xoá phiên' mới gọi onXoa; Huỷ thì không", () => {
    const { onXoa } = vẽ([P()]);
    fireEvent.click(screen.getByTestId("lsa-xoa"));
    expect(onXoa).not.toHaveBeenCalled();
    expect(screen.getByTestId("lsa-xac-nhan-xoa")).toBeInTheDocument();
    expect(screen.getByTestId("lsa-ghi-chu-nhat-ky").textContent).toContain("KHÔNG xoá nhật ký");
    fireEvent.click(screen.getByTestId("lsa-huy-xoa"));
    expect(screen.queryByTestId("lsa-xac-nhan-xoa")).toBeNull();
    expect(onXoa).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("lsa-xoa"));
    fireEvent.click(screen.getByTestId("lsa-xac-nhan"));
    expect(onXoa).toHaveBeenCalledTimes(1);
    expect(onXoa).toHaveBeenCalledWith("p1");
  });

  it("★ không dùng window.confirm", () => {
    const c = vi.spyOn(window, "confirm");
    vẽ([P()]);
    fireEvent.click(screen.getByTestId("lsa-xoa"));
    fireEvent.click(screen.getByTestId("lsa-xac-nhan"));
    expect(c).not.toHaveBeenCalled();
  });

  it("đổi tên: Enter / Lưu tên gửi (id, tên đã cắt, ĐÚNG version); tên rỗng ⇒ không gửi; Esc huỷ", () => {
    const { onDoiTen } = vẽ([P()]);
    fireEvent.click(screen.getByTestId("lsa-sua"));
    const o = screen.getByTestId("lsa-o-ten") as HTMLInputElement;
    fireEvent.change(o, { target: { value: "  Tên mới  " } });
    fireEvent.keyDown(o, { key: "Enter" });
    expect(onDoiTen).toHaveBeenCalledWith("p1", "Tên mới", 7);
    fireEvent.click(screen.getByTestId("lsa-sua"));
    fireEvent.change(screen.getByTestId("lsa-o-ten"), { target: { value: "   " } });
    expect(screen.getByTestId("lsa-luu-ten")).toBeDisabled();
    fireEvent.keyDown(screen.getByTestId("lsa-o-ten"), { key: "Escape" });
    expect(screen.queryByTestId("lsa-o-ten")).toBeNull();
    expect(onDoiTen).toHaveBeenCalledTimes(1);
  });

  it("tiêu đề là CHỮ THUẦN; nhãn nguồn; huy hiệu 'đã dùng AI ngoài' chỉ khi coLuotNgoai", () => {
    const { container } = vẽ([P(), P({ id: "p2", source: "cli", coLuotNgoai: true, title: "B" })]);
    expect(screen.getAllByTestId("lsa-ten")[0]!.textContent).toBe("Sửa <b>Divide</b>");
    expect(container.querySelectorAll("b").length).toBe(0);
    expect(screen.getAllByTestId("lsa-co-ngoai")).toHaveLength(1);
    expect(screen.getAllByTestId("lsa-nguon").map((e) => e.textContent)).toEqual(["repoWs.lichSuAgent.nguon.web", "repoWs.lichSuAgent.nguon.cli"]);
  });

  it("xem phiên: lượt vẽ CHỮ THUẦN (không HTML/ảnh/liên kết); quay lại gọi onDongXem", () => {
    const { container, onDongXem } = vẽ([P()], {
      xem: { id: "p1", title: "T", soLuotChay: 2, turns: [{ role: "assistant", content: "<img src=x onerror=alert(1)> [a](javascript:alert(1)) ![i](http://evil.example/p.png)" }] },
    });
    expect(screen.getByTestId("lsa-luot").textContent).toContain("<img src=x onerror=alert(1)>");
    expect(container.querySelectorAll("img, a").length).toBe(0);
    fireEvent.click(screen.getByTestId("lsa-quay-lai"));
    expect(onDongXem).toHaveBeenCalled();
  });

  it("đang gửi ⇒ nút khoá; không quyền ⇒ thông báo; rỗng ⇒ câu rỗng", () => {
    vẽ([P()], { dangGui: "p1" });
    expect(screen.getByTestId("lsa-xoa")).toBeDisabled();
    expect(screen.getByTestId("lsa-mo")).toBeDisabled();
    cleanup();
    vẽ([], { biTuChoi: true });
    expect(screen.getByTestId("lsa-bi-tu-choi")).toBeInTheDocument();
    cleanup();
    vẽ([]);
    expect(screen.getByTestId("lsa-rong")).toBeInTheDocument();
  });

  it("cauNoteLichSuAgent: mã biết ⇒ khoá riêng; lạ ⇒ 'khac' kèm mã", () => {
    const t = (k: string, o?: Record<string, unknown>) => `${k}|${o ? JSON.stringify(o) : ""}`;
    expect(cauNoteLichSuAgent("CONFLICT", t)).toBe("repoWs.lichSuAgent.note.CONFLICT|");
    expect(cauNoteLichSuAgent("ZZ", t)).toBe('repoWs.lichSuAgent.note.khac|{"ma":"ZZ"}');
  });
});
