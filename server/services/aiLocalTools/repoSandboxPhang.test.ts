/**
 * ★★★ 2026-08-31 · PDCA vòng 1 (T03/T10) — LƯỚI CHO **CHỈ MỤC PHẲNG** (`duyetTepDocDuoc` làm nguồn
 * Ctrl+P/@-mention qua `listFiles phang:true`).
 *
 * Lỗi đã đo trên UI thật: chỉ mục cũ (depth:3, trần 300) vắng tệp 4+ đoạn ⇒ gõ "dauRaSong" ra 0 gợi
 * ý. Bản vá đổi nguồn sang walker của grep. Lưới này ghim đúng hai bảo đảm mà bản vá mua:
 *   §1 TỆP SÂU (5 đoạn) CÓ MẶT trong danh sách phẳng — đột biến hoàn nguyên về depth-3 ⇒ ĐỎ;
 *   §2 DOTFILE trong `TEN_TEP_CHO_PHEP` đi qua walker (nó lọc bằng `duoiDuocPhep` — cùng bản vá
 *      T02b); `.env` và nhị phân vẫn VẮNG (walker không được nới lỏng luật cấm).
 *   §3 TRẦN KÉP PHẢI KHAI THẬT: vượt trần ⇒ `hetTran:true`, quá hạn ⇒ `hetGio:true`.
 *
 * ⚠ 2026-09-04 — dòng cũ ở đây khai "trần kép đã có lưới ở census gốc — không đo lại". LỜI KHAI ẤY
 *   SAI: `repoCommand.census.test.ts` chỉ assert `hetGio` cho hạn giờ **chạy lệnh** (git status) và
 *   không hề gọi `duyetTepDocDuoc`. Tức bảo đảm được KHAI trong docblock của `TRAN_TEP_PHANG`
 *   ("bản cắt không khai là lời nói dối") đã sống **không lưới nào ghim** — chỉ nhánh SƯỚNG
 *   (`hetTran:false`/`hetGio:false`) được đo. Hậu quả nếu tụt: chỉ mục Ctrl+P cắt IM LẶNG ở 12.000
 *   tệp — đúng lớp lỗi mở màn dòng việc này (chỉ mục depth-3 nuốt tệp, gõ "dauRaSong" ra 0 gợi ý).
 *   Tìm ra bằng sàng mật độ assertion, không phải bằng đọc lướt.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { HAN_CHOT_PHANG_MS, TRAN_TEP_PHANG, duyetTepDocDuoc } from "./repoSandbox";

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
    const kq = duyetTepDocDuoc(GOC, "", TRAN_TEP_PHANG, Date.now() + HAN_CHOT_PHANG_MS);
    expect(kq.tep).toContain("sau1/sau2/sau3/sau4/rat-sau.ts");
    expect(kq.tep).toContain("goc.ts");
    expect(kq.hetTran).toBe(false);
    expect(kq.hetGio).toBe(false);
  });
});

describe("§2 walker giữ NGUYÊN luật cấm/đuôi (không nới lỏng khi đi đường phẳng)", () => {
  it("★★★ dotfile trong danh sách trắng CÓ; `.env` (bí mật) và `logo.png` (nhị phân) VẮNG", () => {
    const kq = duyetTepDocDuoc(GOC, "", TRAN_TEP_PHANG, Date.now() + HAN_CHOT_PHANG_MS);
    expect(kq.tep).toContain(".prettierrc");
    expect(kq.tep).not.toContain(".env");
    expect(kq.tep).not.toContain("logo.png");
  });
});

describe("§3 trần kép KHAI THẬT (nhánh chặt, không chỉ nhánh sướng)", () => {
  it("★★★ vượt trần ⇒ `hetTran:true` và danh sách dừng ĐÚNG ở trần", () => {
    // cây có 3 tệp được phép (goc.ts · .prettierrc · sau1/…/rat-sau.ts) ⇒ trần 2 chắc chắn chạm.
    const kq = duyetTepDocDuoc(GOC, "", 2, Date.now() + HAN_CHOT_PHANG_MS);
    expect(kq.tep.length).toBe(2);
    expect(kq.hetTran, "chạm trần mà khai false = bản cắt im lặng").toBe(true);
  });

  it("★★★ quá hạn ⇒ `hetGio:true` (cầu chì thời gian có khai)", () => {
    const kq = duyetTepDocDuoc(GOC, "", TRAN_TEP_PHANG, Date.now() - 1);
    expect(kq.hetGio, "quá hạn mà khai false = client không có gì để hiện cờ").toBe(true);
  });

  it("hằng hạn chót phải đủ lớn để quét xong cây thật (~7,6k tệp)", () => {
    // Neo SÀN, không neo giá trị: hạ xuống 50ms thì chỉ mục rỗng mà vẫn "ok".
    expect(HAN_CHOT_PHANG_MS).toBeGreaterThanOrEqual(1_000);
  });
});
