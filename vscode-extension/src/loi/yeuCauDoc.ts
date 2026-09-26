/**
 * Đọc yêu cầu ĐỌC từ văn bản model — ba tool CHỈ ĐỌC mà Đợt D cho AI dùng để tự đọc mã trong
 * workspace TRƯỚC khi đề xuất sửa: `doc_tep` (đọc một tệp), `liet_ke` (liệt kê một thư mục),
 * `grep` (tìm mẫu, có thể giới hạn theo `path`).
 *
 * Dùng CHUNG `tachKhoiAviTool` (xem `khoiAviTool.ts`) với `deXuatCucBo.ts` — KHÔNG chép lại
 * regex hàng rào. Hai parser không giẫm chân nhau: tool GHI (`de_xuat_sua`/`de_xuat_sua_doan`)
 * không lọt vào đây; tool ĐỌC không lọt vào `deXuatCucBo.ts`.
 *
 * Đây là module CHỈ ĐỌC (không import `vscode`, không chạm đĩa) — Đợt D KHÔNG mở đường ghi nào;
 * `khungAiCoding.ts` (ngoài phạm vi task này) mới là nơi THỰC THI ba tool này bằng `bamTep.ts`.
 * Sai một nhịp ở đây khiến AI "đọc nhầm" — nhẹ hơn ghi nhầm, nhưng vẫn phải bỏ qua chứ KHÔNG
 * đoán khi thiếu trường (đúng quy ước của `deXuatCucBo.ts`).
 */

import { tachKhoiAviTool } from "./khoiAviTool";

export type YeuCauDoc =
  | { loai: "doc_tep"; path: string }
  | { loai: "liet_ke"; path: string }
  | { loai: "grep"; mau: string; path?: string };

export function docYeuCauDoc(vanBan: string): YeuCauDoc[] {
  const ketQua: YeuCauDoc[] = [];

  for (const { tool, args } of tachKhoiAviTool(vanBan)) {
    if (tool === "doc_tep" || tool === "liet_ke") {
      if (typeof args.path !== "string") continue;
      ketQua.push({ loai: tool, path: args.path });
      continue;
    }

    if (tool === "grep") {
      // `mau` rỗng khớp mọi thứ — đó không phải một câu hỏi, bỏ qua thay vì đoán ý.
      if (typeof args.mau !== "string" || args.mau === "") continue;

      if (args.path !== undefined && typeof args.path !== "string") continue;

      ketQua.push(
        typeof args.path === "string" ? { loai: "grep", mau: args.mau, path: args.path } : { loai: "grep", mau: args.mau },
      );
      continue;
    }

    // Tool khác (kể cả de_xuat_sua/de_xuat_sua_doan — việc GHI của deXuatCucBo.ts) ⇒ bỏ qua.
  }

  return ketQua;
}
