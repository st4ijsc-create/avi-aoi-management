/**
 * ★ F1 — lưới cho logic thuần của bảng "model đang nghĩ": đuôi hiện đúng, tổng ký tự là tổng THẬT (không phải phần hiện),
 * và luật mở/gấp: người bấm thắng, chưa bấm thì mở khi chưa có chữ.
 */
import { describe, it, expect } from "vitest";
import { MAX_KY_TU_HIEN, nenMoBang, tomTatNghi } from "./bangDangNghiLogic";

describe("tomTatNghi", () => {
  it("rỗng ⇒ 0 ký tự, đuôi rỗng, không cắt", () => {
    expect(tomTatNghi("")).toEqual({ soKyTu: 0, duoi: "", biCat: false });
    expect(tomTatNghi(undefined as unknown as string)).toEqual({ soKyTu: 0, duoi: "", biCat: false });
  });
  it("ngắn hơn trần ⇒ giữ nguyên", () => {
    expect(tomTatNghi("để xem nào", 100)).toEqual({ soKyTu: 10, duoi: "để xem nào", biCat: false });
  });
  it("★★ dài hơn trần ⇒ hiện ĐUÔI (phần mới nhất) với '…' đầu; soKyTu là tổng THẬT", () => {
    const s = "A".repeat(50) + "B".repeat(30);
    const r = tomTatNghi(s, 30);
    expect(r.soKyTu).toBe(80);
    expect(r.biCat).toBe(true);
    expect(r.duoi).toBe("…" + "B".repeat(30));
  });
  it("trần mặc định 1.200; trần rác ⇒ về mặc định", () => {
    const s = "x".repeat(5000);
    expect(tomTatNghi(s).duoi.length).toBe(MAX_KY_TU_HIEN + 1);
    expect(tomTatNghi(s, Number.NaN).duoi.length).toBe(MAX_KY_TU_HIEN + 1);
    expect(tomTatNghi(s, -5).duoi.length).toBe(MAX_KY_TU_HIEN + 1);
  });
});

describe("nenMoBang", () => {
  it("★ chưa bấm: mở khi CHƯA có chữ (lúc cần nhìn), gấp khi mã đã chảy", () => {
    expect(nenMoBang({ daCoChu: false, nguoiChon: null })).toBe(true);
    expect(nenMoBang({ daCoChu: true, nguoiChon: null })).toBe(false);
  });
  it("người bấm thắng mọi mặc định", () => {
    expect(nenMoBang({ daCoChu: true, nguoiChon: true })).toBe(true);
    expect(nenMoBang({ daCoChu: false, nguoiChon: false })).toBe(false);
  });
});
