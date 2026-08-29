/**
 * ★★★ CENSUS — ĐỢT A LÀ CHỈ-ĐỌC (KHÔNG GHI ĐĨA); ĐỢT B MỞ ĐÚNG MỘT CỬA DUYỆT (`confirmAction`).
 * ĐÂY LÀ THỨ GIỮ CẢ HAI LỜI KHAI ĐÓ CÓ RĂNG.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO FILE NÀY TỒN TẠI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cho tới nay "cổng" giữ Đợt A chỉ-đọc là một lệnh `grep` chạy TAY, một lần, bởi người review —
 * không lặp lại được, không chặn được ai quên chạy nó. File này thay lệnh tay đó bằng một lưới
 * TỰ ĐỘNG: quét MỌI tệp `.ts` dưới `vscode-extension/src/` và khẳng định:
 *   (1) KHÔNG đâu chứa các API ghi đĩa/áp dụng chỉnh sửa mà spec liệt kê ở §4.1/§6.4 (`fs.writeFile`,
 *       `writeFileSync`, `appendFile`, `applyEdit`, `WorkspaceEdit`) — Đợt B/C CHƯA tới lượt các
 *       API này, vẫn phải bằng 0.
 *   (2) ĐÚNG MỘT nơi gọi `aiCopilot.confirmAction` — cửa duyệt của chế độ SERVER, mở ra ở Đợt B
 *       tại `mang/duyetGhi.ts`. Đây LÀ đường ghi hợp lệ DUY NHẤT (byte do MÁY CHỦ ghi, không phải
 *       extension), nên khẳng định không còn là "= 0" mà là "đúng MỘT nơi, đúng tệp".
 *
 * ⚠⚠ TỰ LOẠI TRỪ CHÍNH NÓ: mảng `CAM_TU` bên dưới TẤT YẾU chứa nguyên văn các chuỗi nó tìm kiếm
 *    — quét luôn cả tệp này sẽ dương tính giả VĨNH VIỄN (khớp vào chính mảng khai báo). `moiTepTs`
 *    loại `__filename` khỏi danh sách quét, KHÔNG loại theo tên file (đổi tên vẫn đúng).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ NÓI VỚI ĐỢT SAU (C): KHI THÊM ĐIỂM GHI ĐĨA, SỬA LƯỚI NÀY — ĐỪNG XOÁ NÓ.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Spec (§7, hai bất biến) đòi ĐÚNG MỘT nơi gọi `applyEdit` (chế độ LOCAL, đường ghi cục bộ) — không
 * phải ZERO mãi mãi. Khi Đợt C thêm điểm ghi đĩa đầu tiên (`applyEdit`/`WorkspaceEdit`/
 * `writeFileSync`/...):
 *   1. Đổi khẳng định của TỪ KHOÁ đó từ "mảng rỗng" sang "đúng MỘT lần, tại `<đường dẫn>` cụ thể"
 *      (theo đúng khuôn ca `confirmAction` bên dưới — `toEqual([...])`, KHÔNG `≤1`).
 *   2. GIỮ NGUYÊN khẳng định "= 0" cho các từ khoá còn CHƯA tới lượt, và GIỮ NGUYÊN ca "đúng MỘT
 *      nơi" của `confirmAction` (Đợt B đã chốt, Đợt C không đụng vào).
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

/** Còn CHƯA tới lượt: KHÔNG đâu được có các API ghi đĩa này (Đợt C sẽ mở đúng MỘT nơi cho một
 *  trong số này — sửa từng dòng khi tới lượt, xem docblock trên). */
const CAM_TU = ["fs.writeFile", "writeFileSync", "appendFile", "applyEdit", "WorkspaceEdit"];

describe("census — Đợt A chỉ-đọc, không đường ghi ĐĨA nào", () => {
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

  it("★★★ ĐÚNG MỘT nơi gọi confirmAction trong toàn extension (Đợt B: cửa duyệt SERVER)", () => {
    // Cửa duyệt là bất biến an toàn của cả hệ: mỗi đường gọi mới là một đường ghi mới không ai rà.
    // Con số này phải là ĐÚNG MỘT — KHÔNG phải "≤1", vì 0 nghĩa là cửa duyệt đã bị gỡ mất, và >1
    // nghĩa là có một đường ghi thứ hai chưa ai kiểm.
    const noiGoi = tep.filter((p) => readFileSync(p, "utf8").includes("aiCopilot.confirmAction"));
    expect(noiGoi.map((p) => relative(GOC, p).replace(/\\/g, "/"))).toEqual(["mang/duyetGhi.ts"]);
  });
});
