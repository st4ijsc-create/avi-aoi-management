/**
 * ★ PDCA vòng 15 — đoạn bổ sung cho tài liệu Markdown nạp vào Training Studio (`kbDoanBoSung.ts`).
 * ★★★ PARITY: bản TS phải cho ra ĐÚNG kết quả của bản .mjs mà kho HỆ THỐNG dùng (`scripts/ai-kb/_bang-nhom-dong.mjs`,
 * `_doan-con.mjs`) — trên MỌI tệp `knowledge/domain/*.md`. Hai bản trôi khỏi nhau là lớp lỗi "N+1" của repo này.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tachBangThanhNhom, tachDoanCon, doanBoSung, laMarkdown } from "./kbDoanBoSung";
// @ts-expect-error — module .mjs thuần, không có khai báo kiểu
import { tachBangThanhNhom as bangMjs } from "../../scripts/ai-kb/_bang-nhom-dong.mjs";
// @ts-expect-error — module .mjs thuần, không có khai báo kiểu
import { tachDoanCon as conMjs } from "../../scripts/ai-kb/_doan-con.mjs";

const THU_MUC = path.resolve("knowledge/domain");
const TEP = fs.readdirSync(THU_MUC).filter((f) => f.endsWith(".md"));

describe("kbDoanBoSung — parity với bản .mjs của kho hệ thống", () => {
  it("có tệp để so (không rỗng im lặng)", () => {
    expect(TEP.length).toBeGreaterThan(10);
  });
  it("★★★ nhóm dòng bảng: TS ≡ mjs trên mọi tệp miền", () => {
    for (const f of TEP) {
      const t = fs.readFileSync(path.join(THU_MUC, f), "utf8");
      expect(tachBangThanhNhom(t), f).toEqual(bangMjs(t));
    }
  });
  it("★★★ đoạn con: TS ≡ mjs trên mọi tệp miền (cùng doanGoc)", () => {
    for (const f of TEP) {
      const t = fs.readFileSync(path.join(THU_MUC, f), "utf8");
      const goc = [t.slice(0, 1800)];
      expect(tachDoanCon(t, { doanGoc: goc }), f).toEqual(conMjs(t, { doanGoc: goc }));
    }
  });
});

describe("kbDoanBoSung — hành vi", () => {
  const DOC = [
    "# Máy AOI", "## Mã lỗi", "| Mã | Mô tả | Xử lý |", "|---|---|---|",
    "| E021 | Board jam | Dừng máy |", "| E022 | Board not detected | Kiểm tra sensor |", "| E023 | Conveyor speed | Kiểm tra motor |",
    "| E024 | Width fail | Kiểm tra motor |", "| E031 | Clamp error | Kiểm tra air pressure |", "",
    "## Xử lý NG", "Bảng NG được đưa sang trạm sửa để kỹ thuật viên kiểm tra lại từng điểm lỗi theo danh mục đã định.",
  ].join("\n");
  it("★ bảng ≥ 5 dòng ⇒ nhóm 4 dòng mang tiêu đề mục + dòng tiêu đề bảng; E031 ở nhóm thứ hai", () => {
    const n = tachBangThanhNhom(DOC);
    expect(n).toHaveLength(2);
    expect(n[1]).toContain("## Mã lỗi");
    expect(n[1]).toContain("| Mã | Mô tả | Xử lý |");
    expect(n[1]).toContain("E031");
  });
  it("★ doanBoSung = nhóm dòng + đoạn con (không lặp đoạn gốc)", () => {
    const bs = doanBoSung(DOC, [DOC]);
    expect(bs.some((d) => d.includes("E031") && d.length < 300)).toBe(true);
    expect(bs.some((d) => d.startsWith("## Xử lý NG"))).toBe(true);
    expect(bs).not.toContain(DOC);
  });
  it("★ chỉ Markdown", () => {
    expect(laMarkdown("md", "a.md")).toBe(true);
    expect(laMarkdown("markdown", "x")).toBe(true);
    expect(laMarkdown("pdf", "a.pdf")).toBe(false);
    expect(laMarkdown("text/plain", "a.txt")).toBe(false);
  });
});
