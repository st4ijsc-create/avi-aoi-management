/**
 * ★★★ CENSUS — ĐỢT A LÀ CHỈ-ĐỌC, VÀ ĐÂY LÀ THỨ GIỮ LỜI KHAI ĐÓ CÓ RĂNG.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO FILE NÀY TỒN TẠI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cho tới nay "cổng" giữ Đợt A chỉ-đọc là một lệnh `grep` chạy TAY, một lần, bởi người review —
 * không lặp lại được, không chặn được ai quên chạy nó. File này thay lệnh tay đó bằng một lưới
 * TỰ ĐỘNG: quét MỌI tệp `.ts` dưới `vscode-extension/src/` và khẳng định KHÔNG đâu chứa các API
 * ghi đĩa/áp dụng chỉnh sửa mà spec liệt kê ở §4.1 và §6.4 (`fs.writeFile`, `writeFileSync`,
 * `appendFile`, `applyEdit`, `WorkspaceEdit`, `confirmAction`).
 *
 * ⚠⚠ TỰ LOẠI TRỪ CHÍNH NÓ: mảng `CAM_TU` bên dưới TẤT YẾU chứa nguyên văn các chuỗi nó tìm kiếm
 *    — quét luôn cả tệp này sẽ dương tính giả VĨNH VIỄN (khớp vào chính mảng khai báo). `moiTepTs`
 *    loại `__filename` khỏi danh sách quét, KHÔNG loại theo tên file (đổi tên vẫn đúng).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ NÓI VỚI ĐỢT SAU (B/C): KHI THÊM ĐIỂM GHI, SỬA LƯỚI NÀY — ĐỪNG XOÁ NÓ.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Spec (§7, hai bất biến) đòi ĐÚNG MỘT nơi gọi `applyEdit` (chế độ LOCAL) và ĐÚNG MỘT nơi gọi
 * `confirmAction` (chế độ SERVER) — không phải ZERO mãi mãi. Khi Đợt B/C thêm điểm ghi đầu tiên:
 *   1. Đổi khẳng định của TỪ KHOÁ đó từ "mảng rỗng" sang "đúng MỘT lần, tại `<đường dẫn:dòng>` cụ
 *      thể" (xem cách `applyDiff.census.test.ts` ở app chính làm việc này cho `.handler(`).
 *   2. GIỮ NGUYÊN khẳng định "= 0" cho các từ khoá còn CHƯA tới lượt (ví dụ thêm `applyEdit` ở
 *      Đợt C thì `confirmAction` — thuộc Đợt B — vẫn phải giữ đúng SỐ đã chốt ở đợt đó).
 * Lưới đi ĐỎ ở đây khi đợt sau thêm điểm ghi là ĐÚNG Ý ĐỒ — nó buộc người viết code đọc lại đúng
 * MỘT nơi mình vừa thêm, không phải lỗi cần né bằng cách xoá `it()`.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const GOC = join(__dirname, "..");

/** Mọi `.ts` dưới `src/`, loại CHÍNH TỆP CENSUS này (xem lý do ở docblock trên). */
function moiTepTs(dir: string): string[] {
  const ra: string[] = [];
  for (const ten of readdirSync(dir)) {
    const p = join(dir, ten);
    if (statSync(p).isDirectory()) {
      ra.push(...moiTepTs(p));
      continue;
    }
    if (ten.endsWith(".ts") && p !== __filename) ra.push(p);
  }
  return ra;
}

/** Đợt A: KHÔNG đâu được có các API này. Đợt B/C sửa từng dòng khi thêm ĐÚNG MỘT điểm ghi. */
const CAM_TU = ["fs.writeFile", "writeFileSync", "appendFile", "applyEdit", "WorkspaceEdit", "confirmAction"];

describe("census — Đợt A chỉ-đọc, không đường ghi nào", () => {
  const tep = moiTepTs(GOC);

  it("★★★ lưới quét được tệp thật (không tự làm rỗng danh sách nguồn)", () => {
    expect(tep.length).toBeGreaterThan(5);
  });

  for (const tu of CAM_TU) {
    it(`★★★ KHÔNG chỗ nào trong vscode-extension/src chứa "${tu}"`, () => {
      const cham: string[] = [];
      for (const p of tep) {
        const noiDung = readFileSync(p, "utf8");
        if (noiDung.includes(tu)) cham.push(relative(GOC, p));
      }
      expect(cham).toEqual([]);
    });
  }
});
