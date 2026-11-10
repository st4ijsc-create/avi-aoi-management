/**
 * E1 (UX-C11) hợp đồng trạng thái dùng chung web + extension.
 * ĐỘT BIẾN PHẢI BẮT: xoá một trạng thái · lỗi chỉ còn nút "Đóng" · hai hành động chính · "Đóng" làm hành động chính · trùng mã.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { TRANG_THAI_AI, hanhDongChinh, trangThaiAi, type MaTrangThai } from "./trangThai";

const CHIN: MaTrangThai[] = ["mat-ket-noi", "dang-nap", "het-bo-nho", "ngu-canh-day", "vong-lap", "dau-ra-hong", "chi-thi-nhung", "hoan-tat", "phien-trong"];

describe("TRANG_THAI_AI", () => {
  it("đúng 9 trạng thái theo kế hoạch, mã duy nhất", () => {
    expect(TRANG_THAI_AI.map(t => t.ma).sort()).toEqual([...CHIN].sort());
    expect(new Set(TRANG_THAI_AI.map(t => t.ma)).size).toBe(9);
  });

  it("mỗi trạng thái: tiêu đề + mô tả không rỗng, mã hành động duy nhất", () => {
    for (const t of TRANG_THAI_AI) {
      expect(t.tieuDe.trim(), t.ma).not.toBe("");
      expect(t.moTa.trim(), t.ma).not.toBe("");
      const ma = t.hanhDong.map(h => h.ma);
      expect(new Set(ma).size, t.ma).toBe(ma.length);
      for (const h of t.hanhDong) expect(h.nhan.trim(), `${t.ma}/${h.ma}`).not.toBe("");
    }
  });

  it("★ 0 thông báo lỗi/cảnh báo chỉ có 'Đóng': mỗi loi/canhBao có ≥ 1 hành động khác 'dong'", () => {
    for (const t of TRANG_THAI_AI.filter(x => x.mucDo === "loi" || x.mucDo === "canhBao")) {
      expect(t.hanhDong.filter(h => h.ma !== "dong").length, t.ma).toBeGreaterThanOrEqual(1);
    }
  });

  it("đúng MỘT hành động chính mỗi trạng thái và nó không phải 'dong'", () => {
    for (const t of TRANG_THAI_AI) {
      const chinh = t.hanhDong.filter(h => h.chinh);
      expect(chinh.length, t.ma).toBe(1);
      expect(chinh[0].ma, t.ma).not.toBe("dong");
      expect(hanhDongChinh(t.ma)).toBe(chinh[0]);
    }
  });

  it("trangThaiAi ném với mã lạ; trả đúng bản ghi với mã có", () => {
    expect(() => trangThaiAi("khong-co" as MaTrangThai)).toThrow();
    expect(trangThaiAi("het-bo-nho").mucDo).toBe("loi");
  });

  it("tệp là dữ liệu thuần: không import, không đọc env", () => {
    const nguon = fs.readFileSync(path.join(__dirname, "trangThai.ts"), "utf8");
    expect(nguon).not.toMatch(/^\s*import\s/m);
    expect(nguon).not.toMatch(/process\.env|require\(/);
  });
});
