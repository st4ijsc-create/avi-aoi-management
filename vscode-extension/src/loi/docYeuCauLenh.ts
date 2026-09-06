/**
 * ★★★ ĐỢT M / TASK M1+M3 — ĐỌC YÊU CẦU CHẠY LỆNH TỪ VĂN BẢN MODEL.
 *
 * CÙNG KHUÔN `loi/yeuCauMcp.ts` (`mcp_goi`) và `loi/yeuCauDoc.ts` (ba tool đọc): dùng CHUNG
 * `tachKhoiAviTool` — MỘT tên tool MỚI (`chay_lenh`) trong CÙNG từ vựng `avi-tool`, không phải một
 * giao thức song song. Module CHỈ ĐỌC: không `import "vscode"`, không chạm tiến trình/đĩa/mạng.
 *
 * ⚠⚠⚠ Hàm này CHỈ được gọi trên `traLoiCuoi` — văn bản MODEL VỪA TỰ SINH RA ở lượt SSE hiện tại
 *   (xem `ui/bangChat.ts#hoi`, đúng ranh giới `docYeuCauDoc`/`docYeuCauMcpNgoai` đã dựng). KHÔNG
 *   BAO GIỜ được gọi trên `doanKetQua`/kết quả lệnh đã chạy — đó là HÀNG RÀO KIẾN TRÚC chống tiêm
 *   lệnh của cả Đợt M (M3): một kết quả `git diff` có thể chứa NGUYÊN VĂN một khối
 *   ```avi-tool``` do ai đó lỡ commit vào tệp — nếu kết quả ấy được quét lại bằng hàm này, model sẽ
 *   "thấy" một yêu cầu chạy lệnh MỚI mà nó chưa từng đề xuất. Xem `loi/dinhDangKetQuaLenh.ts` cho
 *   lớp phòng thủ CHIỀU SÂU (vô hiệu hoá khối avi-tool TRONG output trước khi nối vào ngữ cảnh) —
 *   lớp đó là BỔ SUNG, không thay thế ranh giới ở đây.
 *
 * Chỉ trả về CHUỖI LỆNH do model đề xuất — CHƯA qua M1 (`xetDuyetLenh`). Việc DUYỆT (khớp allowlist,
 * an toàn tham số) là một bước RIÊNG, cố ý tách khỏi việc ĐỌC ý định — đúng nguyên tắc "đọc rồi mới
 * xét duyệt" mà `deXuatCucBo.ts` cũng theo (đọc đề xuất ghi RỒI mới hỏi `duocPhepGhiTheoMucQuyen`).
 */
import { tachKhoiAviTool } from "./khoiAviTool";

/** Tên tool trong từ vựng `avi-tool` dành cho yêu cầu chạy lệnh cục bộ. */
export const TEN_TOOL_LENH = "chay_lenh";

export interface YeuCauLenh {
  command: string;
}

export function docYeuCauLenh(vanBan: string): YeuCauLenh[] {
  const ra: YeuCauLenh[] = [];
  for (const { tool, args } of tachKhoiAviTool(vanBan)) {
    if (tool !== TEN_TOOL_LENH) continue;
    if (typeof args.command !== "string" || args.command.trim() === "") continue;
    ra.push({ command: args.command });
  }
  return ra;
}
