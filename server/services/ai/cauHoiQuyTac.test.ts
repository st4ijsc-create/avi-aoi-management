/**
 * ★ PDCA #4 — bộ phân loại câu QUY TẮC vs SỐ LIỆU SỐNG. Tập nhãn viết TRƯỚC khi thiết kế (`1f750d3e5`, giữ lại `3ad88f191`).
 * Yêu cầu an toàn: 0 câu số liệu sống bị xếp quy tắc — đó là thứ cho phép nhánh "tool rỗng ⇒ trả lời theo tài liệu".
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { laCauHoiQuyTac, __dauHieuSongChoTest, laVungMoHo, docPhanLoaiTaiLieu, lenhPhanLoaiTaiLieu } from "./cauHoiQuyTac";

const doc = (f: string) =>
  fs.readFileSync(`scripts/ai-eval/${f}.jsonl`, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l) as { id: string; lop: string; cauHoi: string });

for (const f of ["cau-quy-tac-vs-song", "cau-quy-tac-vs-song-giu-lai"]) {
  describe(`tập ${f}`, () => {
    const bo = doc(f);
    it("★★★ AN TOÀN: 0 câu số liệu sống bị xếp quy tắc", () => {
      expect(bo.filter((c) => c.lop === "song" && laCauHoiQuyTac(c.cauHoi)).map((c) => c.id)).toEqual([]);
    });
    it("nhận ra mọi câu quy tắc", () => {
      expect(bo.filter((c) => c.lop === "quy-tac" && !laCauHoiQuyTac(c.cauHoi)).map((c) => c.id)).toEqual([]);
    });
  });
}

describe("lớp dấu hiệu SỐNG không được chết im lặng (lỗi `\b` + chữ Việt đã gặp)", () => {
  const mau = ["hôm nay", "hiện tại", "7 ngày qua", "máy nào đang lỗi", "máy còn chạy không", "line 2", "AOI-03", "điểm đo #12",
    "cho tôi xem", "của máy AOI1", "có lô nào vượt ngưỡng"];
  it("★ mỗi dấu hiệu sống khớp ít nhất một mẫu", () => {
    const chet = __dauHieuSongChoTest.map((re, i) => ({ i, re })).filter(({ re }) => !mau.some((m) => re.test(m)));
    expect(chet.map((x) => String(x.re))).toEqual([]);
  });
  it("★★ câu SỐNG mang dấu hiệu quy tắc vẫn bị giữ lại nhờ lớp sống", () => {
    for (const q of ["ngưỡng NG hiện tại của line 2 là bao nhiêu?", "hôm nay có phải dừng line không?", "Cpk đang thì sao?"])
      expect(laCauHoiQuyTac(q), q).toBe(false);
  });
});

describe("vòng 6 — vùng mơ hồ + đọc phân loại", () => {
  it("★ câu TÍNH NĂNG không dấu hiệu nào ⇒ trong vùng", () => {
    for (const q of ["Vạch đỏ trên biểu đồ Pareto đánh dấu mức phần trăm tích lũy nào?", "Dữ liệu biểu đồ Pareto lỗi được cache trong bao lâu?", "OEE bao nhiêu?"])
      expect(laVungMoHo(q), q).toBe(true);
  });
  it("★★★ câu có dấu hiệu SỐNG hoặc QUY TẮC ⇒ ngoài vùng (luật cũ quyết)", () => {
    for (const q of ["hôm nay có lỗi NG nào không", "OEE của line 1 hiện tại là bao nhiêu?", "Cỡ nhóm con mặc định khi vẽ biểu đồ SPC là bao nhiêu?", "Công thức tính tỷ lệ NG là gì?", ""])
      expect(laVungMoHo(q), q).toBe(false);
  });
  it("★★★ chỉ TAILIEU rõ ràng mới là true; nghi ngờ ⇒ false", () => {
    expect(docPhanLoaiTaiLieu("TAILIEU")).toBe(true);
    expect(docPhanLoaiTaiLieu(" Tài liệu.")).toBe(true);
    expect(docPhanLoaiTaiLieu("SONG")).toBe(false);
    expect(docPhanLoaiTaiLieu("Có thể là tài liệu")).toBe(false);
    expect(docPhanLoaiTaiLieu("")).toBe(false);
    expect(docPhanLoaiTaiLieu(null)).toBe(false);
  });
  it("lệnh chứa nguyên câu hỏi và hai nhãn", () => {
    const { he, nd } = lenhPhanLoaiTaiLieu("OEE bao nhiêu?");
    expect(he).toMatch(/SONG hoặc TAILIEU/);
    expect(nd).toContain("«OEE bao nhiêu?»");
  });
});
