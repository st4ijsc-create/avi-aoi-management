// @vitest-environment jsdom
//
// ★ Đợt 3a — lưới DOM cho ruột "Dự án của tôi" (`NoiDungDuAnCaNhan`, thuần theo props): danh sách + dung lượng, bốn/năm
// cách tạo, kiểm tên khi gõ, khoá khi thiếu quyền / hết suất, đổi tên, xoá, mở, "Từ mô tả", băng lỗi KHÔNG giả danh rỗng.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

function noiSuy(s: string, o?: Record<string, unknown>): string {
  return o ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(o[k] ?? "")) : s;
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_k: string, a?: unknown, b?: unknown) => (typeof a === "string" ? noiSuy(a, b as Record<string, unknown>) : _k),
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));

import { NoiDungDuAnCaNhan, cauChoMaLoiCaNhan, dinhDangByte, type NoiDungDuAnCaNhanProps } from "./DuAnCaNhan";

afterEach(cleanup);

function dung(p: Partial<NoiDungDuAnCaNhanProps> = {}) {
  const props: NoiDungDuAnCaNhanProps = {
    duAn: [{ id: "u7-aaaa", ten: "Dự án A" }],
    soDuAn: 1,
    tranSoDuAn: 20,
    daDung: 5 * 1024 * 1024,
    tranByte: 2 * 1024 * 1024 * 1024,
    khuon: ["node-ts", "python", "csharp-console", "react-vite"],
    coGit: false,
    coQuyenTao: true,
    dangTai: false,
    loiTai: null,
    dangTao: false,
    loiTao: null,
    onTao: vi.fn(),
    onDoiTen: vi.fn(),
    onXoa: vi.fn(),
    onChon: vi.fn(),
    ...p,
  };
  const r = render(<NoiDungDuAnCaNhan {...props} />);
  return { ...r, props };
}

const q = (c: HTMLElement, sel: string) => c.querySelector(sel) as HTMLElement | null;

describe("Dự án của tôi — danh sách", () => {
  it("★★ hiện dự án + dung lượng (số/trần, MB/GB); bấm tên ⇒ onChon(id)", () => {
    const { container, props } = dung();
    expect(screen.getByText("Dự án A")).toBeInTheDocument();
    expect(q(container, "[data-dung-luong]")!.textContent).toBe("1/20 dự án · 5.0 MB / 2.0 GB");
    fireEvent.click(q(container, '[data-nut-mo-du-an="u7-aaaa"]')!);
    expect(props.onChon).toHaveBeenCalledWith("u7-aaaa");
  });

  it("★★★ lỗi query ⇒ băng lỗi, KHÔNG BAO GIỜ câu 'chưa có dự án'", () => {
    const { container } = dung({ duAn: [], loiTai: "FORBIDDEN" });
    expect(q(container, "[data-loi-tai-ca-nhan]")).not.toBeNull();
    expect(q(container, "[data-rong]")).toBeNull();
  });

  it("★ rỗng thật ⇒ câu mời tạo", () => {
    const { container } = dung({ duAn: [], soDuAn: 0 });
    expect(q(container, "[data-rong]")).not.toBeNull();
  });

  it("★★ đổi tên: bút ⇒ ô nhập ⇒ lưu ⇒ onDoiTen(id, tên mới); xoá ⇒ onXoa(id)", () => {
    const { container, props } = dung();
    fireEvent.click(q(container, '[data-nut-doi-ten="u7-aaaa"]')!);
    const o = q(container, "[data-o-doi-ten]") as HTMLInputElement;
    fireEvent.change(o, { target: { value: "Tên mới" } });
    fireEvent.click(q(container, "[data-nut-luu-ten]")!);
    expect(props.onDoiTen).toHaveBeenCalledWith("u7-aaaa", "Tên mới");
    fireEvent.click(q(container, '[data-nut-xoa-ca-nhan="u7-aaaa"]')!);
    expect(props.onXoa).toHaveBeenCalledWith("u7-aaaa");
  });
});

describe("Dự án của tôi — tạo mới", () => {
  it("★★★ thiếu quyền ⇒ không có form, không nút đổi tên/xoá, có câu giải thích", () => {
    const { container } = dung({ coQuyenTao: false });
    expect(q(container, "[data-form-tao]")).toBeNull();
    expect(q(container, "[data-nut-xoa-ca-nhan]")).toBeNull();
    expect(q(container, "[data-khong-quyen-tao]")).not.toBeNull();
  });

  it("★★ cách tạo: rỗng/khuôn/zip/mô tả; git CHỈ khi máy chủ bật", () => {
    const a = dung({ coGit: false });
    expect([...a.container.querySelectorAll("[data-cach-tao]")].map((e) => e.getAttribute("data-cach-tao"))).toEqual(["rong", "khuon", "zip", "mo-ta"]);
    cleanup();
    const b = dung({ coGit: true });
    expect([...b.container.querySelectorAll("[data-cach-tao]")].map((e) => e.getAttribute("data-cach-tao"))).toContain("git");
  });

  it("★★★ tên có `|` ⇒ câu đỏ NGAY + nút Tạo khoá", () => {
    const { container } = dung({ giaTriDau: { ten: "a|b" } });
    expect(q(container, "[data-loi-ten]")).not.toBeNull();
    expect(q(container, "[data-nut-tao]")).toBeDisabled();
  });

  it("★★★ tạo từ khuôn ⇒ onTao({ten, cachTao:'khuon', khuon})", () => {
    const { container, props } = dung({ giaTriDau: { ten: "Mới", cachTao: "khuon" } });
    fireEvent.change(q(container, "[data-chon-khuon]")!, { target: { value: "python" } });
    fireEvent.submit(q(container, "[data-form-tao]")!);
    expect(props.onTao).toHaveBeenCalledWith({ ten: "Mới", cachTao: "khuon", khuon: "python" });
  });

  it("★★★ 'Từ mô tả' ⇒ onTao mang mô tả; mô tả trống ⇒ nút khoá", () => {
    const { container, props } = dung({ giaTriDau: { ten: "Đọc log", cachTao: "mo-ta" } });
    expect(q(container, "[data-nut-tao]")).toBeDisabled();
    fireEvent.change(q(container, "[data-o-mo-ta]")!, { target: { value: "Ứng dụng đọc CSV" } });
    fireEvent.submit(q(container, "[data-form-tao]")!);
    expect(props.onTao).toHaveBeenCalledWith({ ten: "Đọc log", cachTao: "mo-ta", moTa: "Ứng dụng đọc CSV" });
  });

  it("★★ zip: chưa chọn tệp ⇒ khoá; chọn tệp > 50 MB ⇒ câu đỏ + khoá; tệp hợp lệ ⇒ onTao mang File", () => {
    const { container, props } = dung({ giaTriDau: { ten: "Zip", cachTao: "zip" } });
    expect(q(container, "[data-nut-tao]")).toBeDisabled();
    const lon = new File(["x"], "lon.zip", { type: "application/zip" });
    Object.defineProperty(lon, "size", { value: 60 * 1024 * 1024 });
    fireEvent.change(q(container, "[data-o-zip]")!, { target: { files: [lon] } });
    expect(q(container, "[data-loi-zip]")).not.toBeNull();
    expect(q(container, "[data-nut-tao]")).toBeDisabled();
    const nho = new File(["PK"], "nho.zip", { type: "application/zip" });
    fireEvent.change(q(container, "[data-o-zip]")!, { target: { files: [nho] } });
    fireEvent.submit(q(container, "[data-form-tao]")!);
    expect(props.onTao).toHaveBeenCalledWith({ ten: "Zip", cachTao: "zip", zip: nho });
  });

  it("★★ hết suất (20/20) ⇒ câu cảnh báo + nút khoá", () => {
    const { container } = dung({ soDuAn: 20, giaTriDau: { ten: "x" } });
    expect(q(container, "[data-het-suat]")).not.toBeNull();
    expect(q(container, "[data-nut-tao]")).toBeDisabled();
  });

  it("★ lỗi tạo (đã dịch) hiện trong form", () => {
    const t = (_k: string, d: string) => d;
    const { container } = dung({ loiTao: cauChoMaLoiCaNhan("ZIP_DUONG_DAN_XAU", t) });
    expect(q(container, "[data-loi-tao]")!.textContent).toContain("../");
  });
});

describe("hàm thuần", () => {
  it("dinhDangByte", () => {
    expect(dinhDangByte(512 * 1024)).toBe("0.5 MB");
    expect(dinhDangByte(300 * 1024 * 1024)).toBe("300 MB");
    expect(dinhDangByte(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });
  it("cauChoMaLoiCaNhan: mã lạ ⇒ câu chung mang mã", () => {
    const t = (_k: string, d: string, o?: Record<string, unknown>) => noiSuy(d, o);
    expect(cauChoMaLoiCaNhan("MA_MOI_XYZ", t)).toContain("MA_MOI_XYZ");
  });
});
