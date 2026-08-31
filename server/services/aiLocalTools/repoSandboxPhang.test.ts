/**
 * ★★★ 2026-08-31 · PDCA vòng 1 (T03/T10) — LƯỚI CHO **CHỈ MỤC PHẲNG** (`duyetTepDocDuoc` làm nguồn
 * Ctrl+P/@-mention qua `listFiles phang:true`).
 *
 * Lỗi đã đo trên UI thật: chỉ mục cũ (depth:3, trần 300) vắng tệp 4+ đoạn ⇒ gõ "dauRaSong" ra 0 gợi
 * ý. Bản vá đổi nguồn sang walker của grep. Lưới này ghim đúng hai bảo đảm mà bản vá mua:
 *   §1 TỆP SÂU (5 đoạn) CÓ MẶT trong danh sách phẳng — đột biến hoàn nguyên về depth-3 ⇒ ĐỎ;
 *   §2 DOTFILE trong `TEN_TEP_CHO_PHEP` đi qua walker (nó lọc bằng `duoiDuocPhep` — cùng bản vá
 *      T02b); `.env` và nhị phân vẫn VẮNG (walker không được nới lỏng luật cấm).
 * Trần kép (tệp + hạn chót) đã có lưới ở census gốc — không đo lại ở đây.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { TRAN_TEP_PHANG, duyetTepDocDuoc } from "./repoSandbox";

const GOC = mkdtempSync(path.join(tmpdir(), "phang-"));
// cây: sau1/sau2/sau3/sau4/rat-sau.ts (5 đoạn) + .prettierrc (dotfile) + .env (cấm) + logo.png (nhị phân)
mkdirSync(path.join(GOC, "sau1", "sau2", "sau3", "sau4"), { recursive: true });
writeFileSync(path.join(GOC, "sau1", "sau2", "sau3", "sau4", "rat-sau.ts"), "export const x = 1;\n");
writeFileSync(path.join(GOC, ".prettierrc"), "{}\n");
writeFileSync(path.join(GOC, ".env"), "SECRET=1\n");
writeFileSync(path.join(GOC, "logo.png"), "\x89PNG\r\n");
writeFileSync(path.join(GOC, "goc.ts"), "export {};\n");

afterAll(() => rmSync(GOC, { recursive: true, force: true }));

describe("§1 tệp SÂU có mặt (kết cục Ctrl+P: gõ tên là thấy)", () => {
  it("★★★ tệp 5 đoạn nằm trong danh sách; trần 12.000 đủ cho cây đo được ~7,6k", () => {
    const kq = duyetTepDocDuoc(GOC, "", TRAN_TEP_PHANG, Date.now() + 3_000);
    expect(kq.tep).toContain("sau1/sau2/sau3/sau4/rat-sau.ts");
    expect(kq.tep).toContain("goc.ts");
    expect(kq.hetTran).toBe(false);
    expect(kq.hetGio).toBe(false);
  });
});

describe("§2 walker giữ NGUYÊN luật cấm/đuôi (không nới lỏng khi đi đường phẳng)", () => {
  it("★★★ dotfile trong danh sách trắng CÓ; `.env` (bí mật) và `logo.png` (nhị phân) VẮNG", () => {
    const kq = duyetTepDocDuoc(GOC, "", TRAN_TEP_PHANG, Date.now() + 3_000);
    expect(kq.tep).toContain(".prettierrc");
    expect(kq.tep).not.toContain(".env");
    expect(kq.tep).not.toContain("logo.png");
  });
});
