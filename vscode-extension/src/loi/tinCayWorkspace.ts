/**
 * ★★★ ĐỢT 11.4 / MỤC 3 — WORKSPACE TRUST (chế độ hạn chế của VSCode).
 *
 * Mở một repo lạ ở chế độ HẠN CHẾ (`vscode.workspace.isTrusted === false`) thì extension chỉ ĐỌC: mọi đường có thể chạy
 * mã hoặc đặt byte lên đĩa theo ý một repo không tin cậy đều đóng, kể cả khi người dùng lỡ bấm duyệt:
 *   · chạy lệnh  → `mang/chayLenhCucBo.ts` (ĐÚNG MỘT chỗ `spawn` lệnh dự án — cả khung chat, agent, `git diff` ngữ cảnh);
 *   · ghi tệp    → `ui/apBanVa.ts` (ĐÚNG MỘT điểm ghi — census canh);
 *   · tool ghi/lệnh của agent → `ui/boThucThiVscode.ts` (ẩn khỏi danh sách tool + từ chối nếu model vẫn gọi, kèm lời giải thích).
 * Đọc/liệt kê/grep/chẩn đoán vẫn chạy (cùng hàng rào bí mật cũ).
 *
 * Vị từ THUẦN + MỘT nguồn trạng thái (đặt MỘT lần ở `activate`). Chưa đặt nguồn ⇒ coi là TIN CẬY (chỉ để lưới đơn vị không
 * cần mock `vscode`); host thật luôn đặt nguồn. `isTrusted` không phải boolean `false` (API thiếu) ⇒ cũng coi là tin cậy,
 * vì từ VSCode 1.57 trường này luôn là boolean và `engines.vscode` ≥ 1.90.
 */

/** Tool của agent bị đóng ở chế độ hạn chế (ghi tệp + chạy lệnh). */
export const TOOL_CAN_TIN_CAY: ReadonlySet<string> = new Set(["edit_file", "write_file", "delete_file", "rename_file", "run_command"]);

export const MA_KHONG_TIN_CAY = "WORKSPACE_KHONG_TIN_CAY";

export function laTinCay(isTrusted: unknown): boolean {
  return isTrusted !== false;
}

let nguon: () => boolean = () => true;

/** Gọi MỘT lần ở `activate` với `() => laTinCay(vscode.workspace.isTrusted)`. */
export function datNguonTinCay(f: () => boolean): void {
  nguon = f;
}

export function workspaceTinCay(): boolean {
  try {
    return nguon();
  } catch {
    return false; // đọc trạng thái hỏng ⇒ đóng (fail-closed)
  }
}

/** Câu nói thẳng cho NGƯỜI (thông báo/kết quả lệnh/ghi). */
export const LOI_KHONG_TIN_CAY_NGUOI =
  "Workspace này chưa được tin cậy (chế độ hạn chế của VSCode) — Thợ Cả chỉ ĐỌC, không chạy lệnh và không ghi tệp. " +
  'Muốn bật: "Workspaces: Manage Workspace Trust" rồi tin cậy thư mục này.';

/** Câu cho MODEL khi nó vẫn gọi tool bị đóng. */
export function loiChoModel(ten: string): string {
  return `Tool ${ten} is disabled: this workspace is not trusted (VSCode Restricted Mode). Only read tools (read_file, list_dir, find_files, grep, find_symbol, get_diagnostics) work. Tell the user to trust the workspace (Workspaces: Manage Workspace Trust) if they want edits or commands.`;
}

/** `null` ⇒ cho chạy; khác ⇒ kết quả từ chối (ma + câu cho model). */
export function chanKhiKhongTinCay(ten: string, tinCay: boolean): { ma: string; choModel: string } | null {
  if (tinCay || !TOOL_CAN_TIN_CAY.has(ten)) return null;
  return { ma: MA_KHONG_TIN_CAY, choModel: loiChoModel(ten) };
}
