import { describe, it, expect } from "vitest";
import {
  KB_CORPUS_DOMAIN_SUGGESTIONS,
  NHAN_NHOM_CORPUS,
  goiYCorpusTheoNhom,
} from "./sourceTabLogic";

/**
 * ★★★ G15 (audit 2026-09-22) — corpus cho NGÔN NGỮ LẬP TRÌNH phải đủ miền.
 * Trước bản này danh sách chỉ có năm miền công nghiệp; một người lập trình AI local không có
 * chỗ nào để nạp tài liệu tham chiếu C#/SQL/TS/Python.
 */
describe("KB_CORPUS_DOMAIN_SUGGESTIONS — đủ miền lập trình", () => {
  it("★★★ có đủ các ngôn ngữ/nền tảng chủ dự án đã nêu", () => {
    const co = new Set(KB_CORPUS_DOMAIN_SUGGESTIONS.map((s) => s.corpus));
    for (const c of ["csharp-dotnet", "sql-tsql-sqlserver", "sql-postgresql",
                     "typescript-node", "react-frontend", "python", "cpp"]) {
      expect(co.has(c), c).toBe(true);
    }
  });

  it("★ KHÔNG mất miền công nghiệp nào đã có (chống hồi quy khi thêm nhóm mới)", () => {
    const co = new Set(KB_CORPUS_DOMAIN_SUGGESTIONS.map((s) => s.corpus));
    for (const c of ["plc-ladder-mitsubishi", "plc-ladder-omron", "robot-fanuc",
                     "robot-mitsubishi", "cobot-techman"]) {
      expect(co.has(c), c).toBe(true);
    }
  });

  it("★ thêm ST · G-code · ZMotion — ba miền chủ dự án nêu mà danh sách cũ thiếu", () => {
    const co = new Set(KB_CORPUS_DOMAIN_SUGGESTIONS.map((s) => s.corpus));
    for (const c of ["plc-st-iec61131", "gcode-cnc", "zmotion"]) expect(co.has(c), c).toBe(true);
  });

  it("★★★ tên corpus PHẢI an toàn để điền thẳng vào ô: thường, không dấu, không khoảng trắng", () => {
    for (const s of KB_CORPUS_DOMAIN_SUGGESTIONS) {
      expect(s.corpus, s.corpus).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(s.label.trim().length, s.corpus).toBeGreaterThan(0);
    }
  });

  it("★ KHÔNG trùng tên corpus (trùng ⇒ hai nút cùng điền một thứ, và React trùng key)", () => {
    const ds = KB_CORPUS_DOMAIN_SUGGESTIONS.map((s) => s.corpus);
    expect(new Set(ds).size).toBe(ds.length);
  });
});

describe("goiYCorpusTheoNhom", () => {
  it("★★★ KHÔNG bỏ sót mục nào — tổng các nhóm = cả danh sách", () => {
    const tong = goiYCorpusTheoNhom().reduce((n, g) => n + g.muc.length, 0);
    expect(tong).toBe(KB_CORPUS_DOMAIN_SUGGESTIONS.length);
  });

  it("★ mỗi nhóm có nhãn và ít nhất một mục (nhóm rỗng ⇒ một tiêu đề trống trên màn)", () => {
    for (const g of goiYCorpusTheoNhom()) {
      expect(g.nhan).toBe(NHAN_NHOM_CORPUS[g.nhom]);
      expect(g.muc.length, g.nhom).toBeGreaterThan(0);
    }
  });

  it("★ GIỮ NGUYÊN thứ tự khai báo trong mỗi nhóm", () => {
    const nn = goiYCorpusTheoNhom().find((g) => g.nhom === "ngon-ngu")!;
    expect(nn.muc[0].corpus).toBe("csharp-dotnet");
  });
});
