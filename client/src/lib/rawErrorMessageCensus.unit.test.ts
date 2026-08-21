/**
 * F1 — ĐIỀU TRA DÂN SỐ `err.message` THÔ tới mắt người dùng ở `client/src`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO MỤC F1 TRONG BACKLOG NÓI SAI — THEO HƯỚNG BI QUAN
 * ══════════════════════════════════════════════════════════════════════════════════
 * F1 (lập 2026-07-30) khai: *"535 handler `onError`, chỉ 82 (15%) qua `mapTrpcError`;
 * 446 (83%) hiện thẳng `.message` ở 159 file; chỉ 19/748 file import `lib/trpcErrors`;
 * `main.tsx` không có handler lỗi toàn cục"* ⇒ kết luận *"tuyên bố người dùng Việt thôi
 * đọc tiếng Anh thô chỉ đúng cho 15% bề mặt"*.
 *
 * **Đo lại 2026-08-21 — cả bốn con số đều đã lạc hậu:**
 *   • 189 file import `lib/trpcErrors` (không phải 19);
 *   • 163 lời gọi `mapTrpcError` (không phải 82);
 *   • `main.tsx` **CÓ** lưới cuối cho cả query lẫn mutation, và cả hai đều gọi
 *     `mapTrpcError` (dựng ở F11, 2026-08-14);
 *   • nợ thật còn **139 chỗ / 76 file**, không phải 446/159.
 *
 * ⇒ Lại một lần nữa: **con số trong tài liệu là lời khai, không phải phép đo.** Nếu
 *   cứ theo backlog mà làm, đợt này sẽ đi sửa 446 chỗ trong đó ~307 chỗ không tồn tại.
 *
 * ── NỢ CÒN LẠI CÓ HÌNH DẠNG GÌ ───────────────────────────────────────────────────
 * Lưới cuối ở `main.tsx` cố ý KHÔNG bắn khi mutation tự khai `onError` (bắn nữa là
 * toast ĐÔI — một hồi quy). Nên đúng những chỗ tự xử lý lỗi lại là chỗ chuỗi thô lọt.
 * Với query thì tệ hơn một bậc: người dùng thấy toast ĐÃ DỊCH từ lưới cuối, đồng thời
 * thấy panel trong trang hiện nguyên câu tiếng Anh — hai câu khác nhau cho cùng một lỗi.
 *
 * ⚠ KHÔNG BAO GIỜ nâng ngân sách để test xanh. Nâng nó nghĩa là vừa thêm một câu tiếng
 *   Anh mà người dùng Việt/Trung sẽ đọc nguyên văn — đúng thứ 1061 mã lỗi phía máy chủ
 *   được dựng ra để loại bỏ.
 */
import { describe, it, expect } from "vitest";
import { demRawMessage, duyetFile, DAU_MIEN_TRU } from "../../../scripts/rawErrorMessageScan.mjs";

/**
 * Ngân sách CHỈ ĐƯỢC GIẢM. Mốc đầu đo ngày 2026-08-21: **139 chỗ / 76 file**.
 */
const ALLOWED_RAW_MESSAGE = 139;

describe("F1 — `err.message` thô tới mắt người dùng (client)", () => {
  it("cầu chì: phép quét phải THẤY file, không thì nó đang canh tập rỗng", () => {
    // Thiếu ca này, mọi khẳng định dưới đây đúng một cách vô nghĩa (∀ trên tập rỗng).
    // Chính bộ dò này đã im lặng một lần vì `file://${argv[1]}` không khớp trên Windows —
    // và im lặng trông y hệt "không còn nợ nào".
    expect(duyetFile("client/src").length).toBeGreaterThan(500);
  });

  it(`còn tối đa ${ALLOWED_RAW_MESSAGE} chỗ hiện chuỗi lỗi thô`, () => {
    const no = demRawMessage();
    if (no.length > ALLOWED_RAW_MESSAGE) {
      const theoFile = new Map<string, number>();
      for (const r of no) theoFile.set(r.file, (theoFile.get(r.file) ?? 0) + 1);
      console.error("[F1] nợ chuỗi-thô phình ở:", [...theoFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12));
    }
    expect(no.length).toBeLessThanOrEqual(ALLOWED_RAW_MESSAGE);
  });

  it("ngân sách phải bám SÁT số thật — số dư che mất nợ mới", () => {
    // `≤` một mình cho phép trả 20 chỗ rồi lặng lẽ thêm 20 chỗ mới mà cổng vẫn xanh.
    expect(ALLOWED_RAW_MESSAGE).toBe(demRawMessage().length);
  });

  it("★★★ dấu miễn trừ phải KÈM LÝ DO — không cho phép tắt cổng bằng một từ", () => {
    // `i18n-raw-ok` trơ trọi là cách rẻ nhất để làm cổng im mà không ai phải giải thích.
    // Bắt buộc có `:` + nội dung ⇒ người gỡ nợ sau đọc được VÌ SAO chỗ này được giữ.
    expect(DAU_MIEN_TRU.test("// i18n-raw-ok")).toBe(false);
    expect(DAU_MIEN_TRU.test("// i18n-raw-ok:")).toBe(false);
    expect(DAU_MIEN_TRU.test("// i18n-raw-ok: giữ lý do thật từ máy chủ")).toBe(true);
  });

  it("★★★ `main.tsx` phải giữ lưới cuối ĐÃ DỊCH cho cả query lẫn mutation", () => {
    // Bất biến, không phải ngân sách. Đây là thứ khiến 139 chỗ còn lại chỉ là nợ CHẤT
    // LƯỢNG chứ không phải nợ CÂM: gỡ nó đi thì mọi query/mutation không tự xử lý lỗi
    // quay về màn hình rỗng im lặng — đúng trạng thái trước F11.
    const src = require("node:fs").readFileSync("client/src/main.tsx", "utf8") as string;
    expect(src).toMatch(/getQueryCache\(\)\.subscribe/);
    expect(src).toMatch(/getMutationCache\(\)\.subscribe/);
    expect((src.match(/toast\.error\(mapTrpcError\(error\)\)/g) ?? []).length).toBe(2);
  });
});
