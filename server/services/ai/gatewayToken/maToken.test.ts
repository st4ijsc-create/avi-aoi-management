/**
 * ★ Đợt 4A — phần LÁ của token cổng `/v1`: hình dạng token/mã, băm, chuẩn hoá đầu vào, phạm vi theo đường.
 */
import { describe, it, expect } from "vitest";
import {
  bamToken,
  chuanHoaMaNguoiDung,
  chuanHoaPhamVi,
  chuanHoaSoNgay,
  laMaThietBi,
  laTokenNguoiDung,
  phamViCuaDuong,
  sinhMaNguoiDung,
  sinhMaThietBi,
  sinhToken,
} from "./maToken";

describe("maToken", () => {
  it("token: tiền tố avgw_ + 43 ký tự base64url; băm sha256 hex 64; tiền tố hiển thị 12 ký tự; mỗi lần khác nhau", () => {
    const a = sinhToken();
    const b = sinhToken();
    expect(laTokenNguoiDung(a.token)).toBe(true);
    expect(a.bam).toMatch(/^[0-9a-f]{64}$/);
    expect(a.bam).toBe(bamToken(a.token));
    expect(a.tienTo).toBe(a.token.slice(0, 12));
    expect(a.token).not.toBe(b.token);
    expect(a.bam).not.toContain(a.token.slice(5, 20));
  });
  it("mã thiết bị và mã người dùng đúng hình dạng; mã người dùng không nguyên âm", () => {
    const m = sinhMaThietBi();
    expect(laMaThietBi(m.ma)).toBe(true);
    expect(laTokenNguoiDung(m.ma)).toBe(false);
    for (let i = 0; i < 50; i++) expect(sinhMaNguoiDung()).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  });
  it("chuẩn hoá mã người dùng: hoa/thường, khoảng trắng, gạch; sai bảng chữ/độ dài ⇒ null", () => {
    expect(chuanHoaMaNguoiDung("bcdf ghjk")).toBe("BCDF-GHJK");
    expect(chuanHoaMaNguoiDung("BCDFGHJK")).toBe("BCDF-GHJK");
    expect(chuanHoaMaNguoiDung("ABCD-EFGH")).toBeNull();
    expect(chuanHoaMaNguoiDung("BCDF-GHJ")).toBeNull();
    expect(chuanHoaMaNguoiDung(42)).toBeNull();
  });
  it("phạm vi: lọc lạ, khử trùng, thứ tự cố định; rỗng/sai kiểu ⇒ mặc định chat+fim", () => {
    expect(chuanHoaPhamVi(["embed", "chat", "chat", "admin"])).toEqual(["chat", "embed"]);
    expect(chuanHoaPhamVi([])).toEqual(["chat", "fim"]);
    expect(chuanHoaPhamVi("chat")).toEqual(["chat", "fim"]);
  });
  it("số ngày: mặc định 90, kẹp 1..365", () => {
    expect(chuanHoaSoNgay(undefined)).toBe(90);
    expect(chuanHoaSoNgay(0)).toBe(1);
    expect(chuanHoaSoNgay(9999)).toBe(365);
    expect(chuanHoaSoNgay(30.7)).toBe(30);
  });
  it("phạm vi theo đường của cổng", () => {
    expect(phamViCuaDuong("/chat/completions")).toBe("chat");
    expect(phamViCuaDuong("/completions/")).toBe("fim");
    expect(phamViCuaDuong("/embeddings")).toBe("embed");
    expect(phamViCuaDuong("/models")).toBeNull();
    expect(phamViCuaDuong("/admin")).toBe("khong-ro");
  });
});

describe("phamViCuaDuong — không phân biệt hoa/thường như Express (rà bảo mật de591c868 #1)", () => {
  it("biến thể hoa/thường + gạch cuối ⇒ cùng phạm vi", async () => {
    const { phamViCuaDuong: pv } = await import("./maToken");
    expect(pv("/Chat/Completions")).toBe("chat");
    expect(pv("/COMPLETIONS")).toBe("fim");
    expect(pv("/Embeddings//")).toBe("embed");
    expect(pv("/MODELS")).toBeNull();
  });
});
