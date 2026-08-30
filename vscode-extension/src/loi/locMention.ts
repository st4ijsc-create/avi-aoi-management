/**
 * ★★★ ĐỢT D / TASK 5 — VỊ TỪ THUẦN LỌC DANH SÁCH TỆP CHO `@`-MENTION.
 *
 * Gõ `@` trong ô nhập ⇒ webview hỏi extension "tệp nào khớp chữ tôi đang gõ", extension trả lời
 * bằng ĐÚNG hàm này. THUẦN (không `import "vscode"`, không chạm đĩa) — danh sách TỆP ĐÃ QUA hàng
 * rào gửi (`mang/toolCucBo.danhSachTepGoiY`, tái dùng `duocPhepRoiMay` qua `locUngVien`) TRƯỚC KHI
 * tới đây; hàm này chỉ lo một việc DUY NHẤT: lọc THEO CHỮ đang gõ, không lo an toàn.
 *
 * ⚠ KHÔNG lột hay chạm `@` ở đây — vị từ này không hề thấy ký tự `@` (webview đã cắt nó ra trước khi
 *   gửi `truy`), nên không có rủi ro "lột nhầm đường dẫn `@types/…` hợp lệ" mà bài học @-mention ở
 *   `/ai-coding-workspace` đã cảnh báo (xem `chonGoiY` trong `htmlBang.ts` — nơi chèn đường SẠCH).
 */

/**
 * Lọc `danhSach` (đường tương đối) theo chuỗi con `truy` (không phân biệt hoa/thường), giới hạn tối
 * đa `tran` kết quả để một workspace hàng chục nghìn tệp không đẻ ra một dropdown vô dụng.
 *
 * `truy` RỖNG (vừa gõ `@`, chưa gõ thêm ký tự nào) ⇒ trả `tran` tệp ĐẦU của danh sách — không phải
 * mảng rỗng: người dùng cần THẤY có gợi ý trước khi gõ thêm, không phải gõ mù rồi mới biết có tệp
 * khớp hay không.
 *
 * Khớp ở VỊ TRÍ CÀNG SỚM trong đường dẫn thì càng đứng TRƯỚC (gõ "src/foo" nên đứng trước một tệp
 * tình cờ chứa "src/foo" ở giữa tên, ví dụ "other/xxx-src-foo-old.ts"); cùng vị trí thì đường NGẮN
 * hơn đứng trước (khớp gọn hơn, ít khả năng là một tệp không liên quan tình cờ chứa cùng chuỗi con).
 */
export function locDanhSachMention(danhSach: string[], truy: string, tran = 20): string[] {
  const t = truy.trim().toLowerCase();
  if (t === "") return danhSach.slice(0, tran);

  const khop = danhSach
    .map((d) => ({ d, vi: d.toLowerCase().indexOf(t) }))
    .filter((x) => x.vi >= 0);
  khop.sort((a, b) => (a.vi !== b.vi ? a.vi - b.vi : a.d.length - b.d.length));
  return khop.slice(0, tran).map((x) => x.d);
}
