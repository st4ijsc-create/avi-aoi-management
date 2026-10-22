/**
 * ★ Đợt 9 — lời nhắc sửa ST dùng chung: GHIM văn bản của bộ đo M (mot-luot --vong-sua, trước 2026-10-22) TỪNG BYTE — đổi chữ ở
 * đây là đổi phép đo M (số cũ không còn so được) ⇒ phải cố ý và cập nhật lưới này.
 */
import { describe, expect, it } from "vitest";
import { TEN_TRINH_DICH_ST, TRAN_DONG_LOI_ST, cauNhacSuaST, dongLoiST } from "./stNhacSua.mjs";

/** Bản sao CHỮ cũ của mot-luot.mjs (dòng 190 tại 68e69912e) — chuẩn để so. */
const cu = (TEN: string, scl: boolean, loi: string[]) =>
  `Trình biên dịch IEC 61131-3 (${TEN}) báo lỗi${scl ? " (mã SCL của bạn được chuẩn hoá sang ST trước khi biên dịch; số dòng giữ nguyên)" : ""}:\n${loi.map((l) => `- ${l}`).join("\n")}\n\nSửa các lỗi trên và trả lại ĐẦY ĐỦ mọi tệp theo đúng định dạng như trước (mỗi tệp một khối mã có dòng \`// tệp: …\`).`;

describe("cauNhacSuaST", () => {
  const loi = ["src/Bcd.st:16:13 E007 Unexpected token", "src/Bcd.st:17:13 E007 Unexpected token"];
  it("dinhDangTep ⇒ GIỐNG TỪNG BYTE chữ bộ đo M cũ (RuSTy, MATIEC, SCL)", () => {
    for (const [ten, scl] of [[TEN_TRINH_DICH_ST.rusty, false], [TEN_TRINH_DICH_ST.matiec, false], [TEN_TRINH_DICH_ST.rusty, true]] as const) {
      expect(cauNhacSuaST({ trinhDich: ten, laScl: scl, loi, dinhDangTep: true })).toBe(cu(ten, scl, loi));
    }
    expect(TEN_TRINH_DICH_ST).toEqual({ rusty: "RuSTy, phương ngữ CODESYS", matiec: "MATIEC của OpenPLC v3, chuẩn IEC 61131-3" });
  });
  it("không định dạng tệp ⇒ vẫn đòi ĐỦ mã, không nhắc `// tệp:`", () => {
    const s = cauNhacSuaST({ trinhDich: TEN_TRINH_DICH_ST.rusty, laScl: false, loi, dinhDangTep: false });
    expect(s).toContain("ĐẦY ĐỦ mã");
    expect(s).not.toContain("// tệp:");
  });
  it("trần số dòng lỗi + hình dạng dòng lỗi của bộ đo M", () => {
    const nhieu = Array.from({ length: 30 }, (_, i) => `x:${i}`);
    expect(cauNhacSuaST({ trinhDich: "t", laScl: false, loi: nhieu, dinhDangTep: true }).match(/^- /gm)?.length).toBe(TRAN_DONG_LOI_ST);
    expect(dongLoiST({ tep: "src/A.st", dong: 4, cot: 13, ma: "E007", thongDiep: "Unexpected" })).toBe("src/A.st:4:13 E007 Unexpected");
    expect(dongLoiST({ tep: null, dong: null, cot: null, ma: null, thongDiep: "x" })).toBe("?:?:?  x");
  });
});
