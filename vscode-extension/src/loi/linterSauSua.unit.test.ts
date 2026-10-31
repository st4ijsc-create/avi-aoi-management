/** Đợt 11.4 / mục 7 — linter sau khi sửa: so đa tập, báo chữ thuần đã che, cắt, nối dây. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRAN_LOI_MOI_HIEN, canhBaoLoiMoi, loiMoiSauSua, type ChanDoanNhe } from "./linterSauSua";

const e = (thongDiep: string, dong = 1, ma?: string, muc: ChanDoanNhe["muc"] = "error"): ChanDoanNhe => ({ muc, thongDiep, dong, ...(ma ? { ma } : {}) });

describe("loiMoiSauSua", () => {
  it("lỗi cũ còn nguyên (dù lệch dòng) KHÔNG bị báo; lỗi mới bị báo", () => {
    expect(loiMoiSauSua([e("A", 3)], [e("A", 9), e("B", 2)]).map((d) => d.thongDiep)).toEqual(["B"]);
  });
  it("so theo ĐA TẬP: cùng thông điệp tăng từ 1 lên 2 ⇒ báo đúng 1", () => {
    expect(loiMoiSauSua([e("A")], [e("A"), e("A", 5)])).toHaveLength(1);
    expect(loiMoiSauSua([e("A"), e("A")], [e("A")])).toHaveLength(0);
  });
  it("chỉ tính mức error; mã khác nhau là lỗi khác nhau", () => {
    expect(loiMoiSauSua([], [e("W", 1, undefined, "warning"), e("H", 1, undefined, "hint")])).toHaveLength(0);
    expect(loiMoiSauSua([e("A", 1, "TS1")], [e("A", 1, "TS2")])).toHaveLength(1);
    expect(loiMoiSauSua([e("A", 1, undefined, "warning")], [e("A")])).toHaveLength(1);
  });
});

describe("canhBaoLoiMoi", () => {
  it("không có lỗi mới ⇒ null", () => expect(canhBaoLoiMoi("a.ts", [])).toBeNull());
  it("liệt kê dòng + thông điệp + mã; chữ thuần; nhắc Ctrl+Z", () => {
    const t = canhBaoLoiMoi("src/a.ts", [e("Cannot find name 'x'.", 12, "2304")])!;
    expect(t).toContain('"src/a.ts" có thêm 1 lỗi');
    expect(t).toContain("dòng 12: Cannot find name 'x'. (2304)");
    expect(t).toContain("Ctrl+Z");
  });
  it("★ cắt ở trần hiển thị và nói còn bao nhiêu lỗi nữa", () => {
    const nhieu = Array.from({ length: TRAN_LOI_MOI_HIEN + 3 }, (_, i) => e(`l${i}`, i + 1));
    const t = canhBaoLoiMoi("a", nhieu)!;
    expect(t.match(/dòng \d+:/g)).toHaveLength(TRAN_LOI_MOI_HIEN);
    expect(t).toContain("và 3 lỗi nữa");
    expect(canhBaoLoiMoi("a", nhieu.slice(0, TRAN_LOI_MOI_HIEN))).not.toContain("lỗi nữa");
  });
  it("★ che bí mật trong thông điệp, gộp khoảng trắng, cắt thông điệp dài (200)", () => {
    const t = canhBaoLoiMoi("a", [e(`gặp khoá ghp_${"a".repeat(36)} \n\n  rồi`), e("z".repeat(300), 2)])!;
    expect(t).not.toContain("ghp_aaaa");
    expect(t).not.toMatch(/dòng 1: .*\n\s*rồi/);
    expect(t).toContain(`${"z".repeat(199)}…`);
    expect(t).not.toContain("z".repeat(200));
  });
  it("★ ghim trần hiển thị = 5 và dòng «và N lỗi nữa» với 8 lỗi", () => {
    expect(TRAN_LOI_MOI_HIEN).toBe(5);
    const t = canhBaoLoiMoi("a", Array.from({ length: 8 }, (_, i) => e(`l${i}`, i + 1)))!;
    expect(t.match(/dòng [0-9]+:/g)).toHaveLength(5);
    expect(t).toContain("và 3 lỗi nữa");
  });
  it("★ mã lỗi cũng được che bí mật", () => {
    const t = canhBaoLoiMoi("a", [e("x", 1, `ghp_${"b".repeat(36)}`)])!;
    expect(t).not.toContain("ghp_bbbb");
  });
  it("nối dây: bangChat báo SAU kết quả ghi (tin riêng), chỉ khi ghi ok; chụp Problems trước khi áp", () => {
    const s = readFileSync(join(__dirname, "..", "ui", "bangChat.ts"), "utf8");
    expect(s).toContain("if (kq.ok) canhBaoLinter = dopChanDoanSauSua(uriSua)");
    const viTriChup = s.indexOf("const chanDoanTruoc = docChanDoan(uriSua);");
    expect(viTriChup).toBeGreaterThan(0);
    expect(viTriChup).toBeLessThan(s.indexOf("const kq = await apBanVa({"));
    expect(s).toContain("loiMoiSauSua(chanDoanTruoc, sau)");
  });
});
