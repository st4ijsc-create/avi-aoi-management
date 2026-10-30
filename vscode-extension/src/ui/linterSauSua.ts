/**
 * Đợt 11.4 / mục 7 — lớp chạm `vscode` của "sửa trực tiếp có linter": đọc Problems TRƯỚC khi áp, đợi server ngôn ngữ chẩn đoán lại SAU khi áp.
 * Chỉ ĐỌC (`languages.getDiagnostics`, `onDidChangeDiagnostics`) — không ghi gì (census).
 */
import * as vscode from "vscode";
import type { ChanDoanNhe } from "../loi/linterSauSua";

const MUC: Record<number, ChanDoanNhe["muc"]> = { 0: "error", 1: "warning", 2: "info", 3: "hint" };
/** Chờ tối đa chừng này cho server ngôn ngữ chẩn đoán lại; hết hạn ⇒ dùng số hiện có (có thể chưa kịp — chỉ BÁO, không khẳng định "sạch"). */
export const CHO_CHAN_DOAN_MS = 2_500;
/** Sau lần thay đổi chẩn đoán cuối, đợi thêm chừng này để các đợt tới tiếp được gộp. */
const YEN_LANG_MS = 400;

export function docChanDoan(uri: vscode.Uri): ChanDoanNhe[] {
  // Linter chỉ để BÁO: mọi lỗi ở đây (API vắng, server ngôn ngữ hỏng) ⇒ danh sách rỗng, TUYỆT ĐỐI không cản việc ghi.
  try {
    return docChanDoanTho(uri);
  } catch {
    return [];
  }
}

function docChanDoanTho(uri: vscode.Uri): ChanDoanNhe[] {
  return vscode.languages.getDiagnostics(uri).map((d) => ({
    muc: MUC[d.severity] ?? "hint",
    thongDiep: d.message,
    dong: d.range.start.line + 1,
    ...(d.code !== undefined ? { ma: String(typeof d.code === "object" ? d.code.value : d.code) } : {}),
  }));
}

export function dopChanDoanSauSua(uri: vscode.Uri, tranMs = CHO_CHAN_DOAN_MS): Promise<ChanDoanNhe[]> {
  return new Promise((xong) => {
    if (typeof vscode.languages?.onDidChangeDiagnostics !== "function") return xong(docChanDoan(uri));
    let yen: ReturnType<typeof setTimeout> | undefined;
    const ketThuc = () => {
      if (yen) clearTimeout(yen);
      clearTimeout(tran);
      sub.dispose();
      xong(docChanDoan(uri));
    };
    const tran = setTimeout(ketThuc, tranMs);
    const sub = vscode.languages.onDidChangeDiagnostics((e) => {
      if (!e.uris.some((u) => u.toString() === uri.toString())) return;
      if (yen) clearTimeout(yen);
      yen = setTimeout(ketThuc, YEN_LANG_MS);
    });
  });
}
