// @vitest-environment jsdom
//
// Lô nguoi.bieu-mau — form CÓ KIỂU: (a) soạn định nghĩa trường (thêm/bỏ, đổi kiểu, lựa chọn); (b) ô điền của người duyệt + giaTriGui (số chỉ khi hữu hạn, boolean mặc định false).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { FormBieuMau, FormDienBieuMau, giaTriGui, TRAN_TRUONG_FORM, type TruongForm } from "./FormBieuMau";

afterEach(cleanup);
const tid = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement;

describe("FormBieuMau (soạn)", () => {
  it("thêm trường ⇒ tên không trùng, kiểu chuoi; đủ 20 ⇒ nút thêm vô hiệu; bỏ ⇒ ngắn lại", () => {
    const doi = vi.fn();
    const { container, rerender } = render(<FormBieuMau p={{ truong: [{ ten: "truong2", nhan: "x", kieu: "chuoi" }] }} doi={doi} />);
    fireEvent.click(tid(container, "bm-them"));
    const moi = doi.mock.lastCall![1] as TruongForm[];
    expect(moi).toHaveLength(2);
    expect(new Set(moi.map((x) => x.ten)).size).toBe(2);
    expect(moi[1]).toMatchObject({ kieu: "chuoi", nhan: "" });
    const day = Array.from({ length: TRAN_TRUONG_FORM }, (_, i) => ({ ten: `t${i}`, nhan: `n${i}`, kieu: "chuoi" }));
    rerender(<FormBieuMau p={{ truong: day }} doi={doi} />);
    expect((tid(container, "bm-them") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(tid(container, "bm-bo-3"));
    expect(doi).toHaveBeenLastCalledWith("truong", day.filter((_, i) => i !== 3));
  });

  it("đổi kiểu sang 'chon' ⇒ luaChon [] và ô lựa chọn hiện; gõ 'a, b' ⇒ [a,b]; đổi lại kiểu khác ⇒ bỏ luaChon; bắt buộc bật/tắt", () => {
    const doi = vi.fn();
    const { container, rerender } = render(<FormBieuMau p={{ truong: [{ ten: "a", nhan: "A", kieu: "chuoi" }] }} doi={doi} />);
    expect(tid(container, "bm-lua-chon-0")).toBeNull();
    fireEvent.change(tid(container, "bm-kieu-0"), { target: { value: "chon" } });
    expect(doi).toHaveBeenLastCalledWith("truong", [{ ten: "a", nhan: "A", kieu: "chon", luaChon: [] }]);
    rerender(<FormBieuMau p={{ truong: [{ ten: "a", nhan: "A", kieu: "chon", luaChon: [] }] }} doi={doi} />);
    fireEvent.change(tid(container, "bm-lua-chon-0"), { target: { value: "a, b ,," } });
    expect(doi).toHaveBeenLastCalledWith("truong", [{ ten: "a", nhan: "A", kieu: "chon", luaChon: ["a", "b"] }]);
    fireEvent.change(tid(container, "bm-kieu-0"), { target: { value: "so" } });
    expect(doi).toHaveBeenLastCalledWith("truong", [{ ten: "a", nhan: "A", kieu: "so" }]);
    fireEvent.click(tid(container, "bm-bat-buoc-0"));
    expect((doi.mock.lastCall![1] as TruongForm[])[0].batBuoc).toBe(true);
  });

  it("tên khoá ra ghi qua doi('truongRa')", () => {
    const doi = vi.fn();
    const { container } = render(<FormBieuMau p={{}} doi={doi} />);
    fireEvent.change(tid(container, "bm-truong-ra"), { target: { value: "kq" } });
    expect(doi).toHaveBeenLastCalledWith("truongRa", "kq");
  });
});

describe("FormDienBieuMau + giaTriGui (người điền)", () => {
  const TRUONG: TruongForm[] = [
    { ten: "loai", nhan: "Loại", kieu: "chon", luaChon: ["a", "b"], batBuoc: true },
    { ten: "n", nhan: "Số", kieu: "so" },
    { ten: "ok", nhan: "Xong", kieu: "boolean" },
    { ten: "tx", nhan: "Chữ", kieu: "chuoi" },
  ];
  it("vẽ ô theo kiểu: chon = select (có mục trống), so = number, boolean = checkbox, chuoi = text; nhãn bắt buộc có dấu *; sửa ⇒ doi(ten, giá trị)", () => {
    const doi = vi.fn();
    const { container, getByText } = render(<FormDienBieuMau truong={TRUONG} giaTri={{}} doi={doi} />);
    expect(getByText("Loại *")).toBeTruthy();
    expect((tid(container, "dien-loai") as HTMLSelectElement).options).toHaveLength(3);
    expect((tid(container, "dien-n") as HTMLInputElement).type).toBe("number");
    expect((tid(container, "dien-ok") as HTMLInputElement).type).toBe("checkbox");
    expect((tid(container, "dien-tx") as HTMLInputElement).type).toBe("text");
    fireEvent.change(tid(container, "dien-loai"), { target: { value: "b" } });
    expect(doi).toHaveBeenLastCalledWith("loai", "b");
    fireEvent.click(tid(container, "dien-ok"));
    expect(doi).toHaveBeenLastCalledWith("ok", true);
  });

  it("★ giaTriGui: chuỗi/chọn trống ⇒ vắng; số chỉ khi hữu hạn (chuỗi số được đổi thành số, 'abc' ⇒ vắng); boolean mặc định false", () => {
    expect(giaTriGui(TRUONG, {})).toEqual({ ok: false });
    expect(giaTriGui(TRUONG, { loai: "a", n: "3.5", ok: true, tx: "xin chào" })).toEqual({ loai: "a", n: 3.5, ok: true, tx: "xin chào" });
    expect(giaTriGui(TRUONG, { loai: "", n: "abc", tx: "" })).toEqual({ ok: false });
    expect(giaTriGui(TRUONG, { n: "" })).toEqual({ ok: false });
  });
});
