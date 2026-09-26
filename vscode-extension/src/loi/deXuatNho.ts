/**
 * ĐỢT H / TASK H3 / B5 — đọc đề xuất NHỚ từ văn bản model — nhánh "AI đề xuất, người dùng duyệt"
 * của ghi-nhớ-có-chủ-đích.
 *
 * Dùng CHUNG `tachKhoiAviTool` (`./khoiAviTool.ts`) với `deXuatCucBo.ts`/`yeuCauDoc.ts`/
 * `yeuCauMcp.ts` — KHÔNG chép lại regex hàng rào. Bốn parser không giẫm chân nhau: mỗi cái chỉ nhận
 * ĐÚNG tên tool của mình (`de_xuat_nho` ở đây), bỏ qua mọi khối tool khác.
 *
 * ★★★ ĐÂY LÀ MỘT ĐỀ XUẤT, KHÔNG PHẢI MỘT LỆNH GHI. `docDeXuatNho` chỉ ĐỌC văn bản model tìm khối
 * này — nó KHÔNG ghi bất cứ đâu (module THUẦN, không import `vscode`, không chạm `workspaceState`).
 * Việc GHI THẬT (qua `khoBoNho.ts#themMucBoNho`) chỉ xảy ra ở `ui/bangChat.ts` SAU KHI người dùng đã
 * DUYỆT — đúng B5 "chỉ nhớ khi ... AI đề xuất VÀ người dùng duyệt", không phải "AI đề xuất là nhớ
 * ngay". Từ chối ⇒ hàm ghi không hề được gọi, không có nhánh "ghi rồi xoá lại" nào ở đây.
 */
import { tachKhoiAviTool } from "./khoiAviTool";

/** Tên tool trong từ vựng `avi-tool` dành cho đề xuất nhớ — cùng khuôn `TEN_TOOL_MCP`
 *  (`yeuCauMcp.ts`): MỘT hằng số xuất khẩu, dùng lại ở cả nơi DẠY (`dayBoNhoDoc.ts`) lẫn nơi nhắc
 *  lại cuối câu hỏi (`dayGiaoThucDoc.ts`), không còn chép tay chuỗi "de_xuat_nho" ở nhiều nơi. */
export const TEN_TOOL_DE_XUAT_NHO = "de_xuat_nho";

export interface DeXuatNho {
  noiDung: string;
}

export function docDeXuatNho(vanBan: string): DeXuatNho[] {
  const ketQua: DeXuatNho[] = [];

  for (const { tool, args } of tachKhoiAviTool(vanBan)) {
    if (tool !== TEN_TOOL_DE_XUAT_NHO) continue;
    // Thiếu trường / sai kiểu / rỗng ⇒ bỏ qua khối này — một đề xuất nhớ SAI/RỖNG còn tệ hơn không
    // đề xuất (cùng nguyên tắc "không đoán" của `yeuCauDoc.ts`).
    if (typeof args.noiDung !== "string") continue;
    if (args.noiDung.trim().length === 0) continue;
    ketQua.push({ noiDung: args.noiDung });
  }

  return ketQua;
}
