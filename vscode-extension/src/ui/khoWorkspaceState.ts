/**
 * ★★★ ĐỢT H / TASK H3 — bọc `context.workspaceState` thành đúng hình dạng `KhoLuuTruTho`
 * (`loi/khoHoiThoai.ts`, THUẦN). Đây là RANH GIỚI DUY NHẤT nơi `vscode` chạm vào lớp lưu trữ
 * `workspaceState` — tách ra từ `ui/bangChat.ts#khoHoiThoaiTho` (Đợt F / Task 2) để MỌI nơi cần một
 * kho `workspaceState` (bảng chat, lệnh "Nhớ điều này" ở `extension.ts`, khung xem/xoá bộ nhớ ở
 * `boNhoQuanLy.ts`) dùng LẠI ĐÚNG một hàm — `doc`/`ghi` nhận khoá làm THAM SỐ nên MỘT bản bọc phục
 * vụ mọi khoá (`KHOA_HOI_THOAI`, `KHOA_MUC_QUYEN`, `KHOA_BO_NHO`, …) trên CÙNG một `context`; dựng
 * một bản bọc thứ hai cho cùng `context` là chép lại đúng bốn dòng này (xem docblock cũ của
 * `khoHoiThoaiTho`, đã dặn trước điều này khi thêm khoá thứ hai `KHOA_MUC_QUYEN`).
 */
import type * as vscode from "vscode";
import type { KhoLuuTruTho } from "../loi/khoHoiThoai";

export function dungKhoWorkspaceState(context: vscode.ExtensionContext): KhoLuuTruTho {
  return {
    doc: <T>(khoa: string) => context.workspaceState.get<T>(khoa),
    ghi: (khoa, giaTri) => context.workspaceState.update(khoa, giaTri),
  };
}
