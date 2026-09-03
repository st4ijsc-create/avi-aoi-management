/**
 * ★★★ ĐỢT H / TASK H3 / B2 — bảng WEBVIEW xem/xoá bộ nhớ dài hạn.
 *
 * Tệp này CHỈ điều phối: đọc/ghi qua `khoBoNho.ts` (THUẦN) bọc bằng `dungKhoWorkspaceState`
 * (`./khoWorkspaceState.ts`, dùng CHUNG với `bangChat.ts`), vẽ HTML bằng `dungHtmlBoNho`
 * (`./htmlBoNho.ts`, THUẦN). KHÔNG có logic lưu trữ/che bí mật/định dạng nào lặp lại ở đây.
 *
 * ★★★ SINGLETON — cùng khuôn `BangChat`/`BangChatViewProvider`: `moHoacHien` mở panel MỚI lần đầu,
 * đưa panel CŨ lên trước (`reveal`) những lần sau, tránh nhiều bảng bộ nhớ cùng mở trỏ vào CÙNG một
 * `workspaceState` mà vẽ lệch nhau.
 */
import * as vscode from "vscode";
import { randomBytes, randomUUID } from "node:crypto";
import { dungHtmlBoNho } from "./htmlBoNho";
import { dungKhoWorkspaceState } from "./khoWorkspaceState";
import { docDanhSachBoNho, themMucBoNho, xoaMucBoNho, xoaTatCaBoNho } from "../loi/khoBoNho";
import type { KhoLuuTruTho } from "../loi/khoHoiThoai";

function chuoiNgauNhien(): string {
  return randomBytes(24).toString("base64url");
}

export class BoNhoQuanLy {
  private static hienTai: BoNhoQuanLy | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly kho: KhoLuuTruTho;

  private constructor(context: vscode.ExtensionContext) {
    this.kho = dungKhoWorkspaceState(context);
    this.panel = vscode.window.createWebviewPanel(
      "aviAiLocal.boNho",
      "AI Local — Bộ nhớ dài hạn",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.onDidDispose(() => {
      BoNhoQuanLy.hienTai = undefined;
    });
    this.panel.webview.onDidReceiveMessage((m: Record<string, unknown>) => void this.nhanTin(m));
    this.veLai();
  }

  /** ★★★ LỐI VÀO DUY NHẤT — đăng ký ở `extension.ts` dưới lệnh `aviAiLocal.boNho`. */
  static moHoacHien(context: vscode.ExtensionContext): BoNhoQuanLy {
    if (BoNhoQuanLy.hienTai) {
      BoNhoQuanLy.hienTai.panel.reveal();
      BoNhoQuanLy.hienTai.veLai(); // ★ đọc lại kho — có thể vừa đổi từ lệnh "Nhớ điều này" ở nơi khác
      return BoNhoQuanLy.hienTai;
    }
    BoNhoQuanLy.hienTai = new BoNhoQuanLy(context);
    return BoNhoQuanLy.hienTai;
  }

  private veLai(): void {
    this.panel.webview.html = dungHtmlBoNho({ nonce: chuoiNgauNhien(), ds: docDanhSachBoNho(this.kho) });
  }

  private async nhanTin(m: Record<string, unknown>): Promise<void> {
    if (m.loai === "xoa_muc" && typeof m.ma === "string") {
      await xoaMucBoNho(this.kho, m.ma);
      this.veLai();
      return;
    }
    if (m.loai === "xoa_tat_ca") {
      await xoaTatCaBoNho(this.kho);
      this.veLai();
      return;
    }
    // Tin lạ ⇒ bỏ qua im lặng, cùng nguyên tắc "webview chỉ báo Ý ĐỊNH" đã áp cho `bangChat.ts` —
    // KHÔNG đoán ý một tin không nhận diện được.
  }
}

/**
 * ★★★ LỆNH "AI Local: Nhớ điều này" — nhánh B5 THỨ NHẤT (người dùng CHỦ ĐỘNG bảo nhớ). Độc lập với
 * bảng chat (không cần `BangChat` đang mở) — hỏi trực tiếp qua `showInputBox`, ghi qua ĐÚNG
 * `themMucBoNho` (che bí mật + cắt trần TRƯỚC khi ghi, xem `khoBoNho.ts`).
 *
 * ★ NHÁNH KIA: người dùng bấm Esc/để trống ⇒ `showInputBox` trả `undefined`/chuỗi rỗng ⇒ KHÔNG gọi
 *   `themMucBoNho` — hàm ghi không hề được gọi (và `themMucBoNho` còn tự chặn nội dung rỗng lần
 *   nữa, phòng thủ chiều sâu).
 */
export async function chayNhoDieuNay(context: vscode.ExtensionContext): Promise<void> {
  const noiDung = await vscode.window.showInputBox({
    prompt: "AI Local sẽ nhớ điều gì? (quyết định kiến trúc, quy ước dự án, sở thích của bạn…)",
    ignoreFocusOut: true,
  });
  if (!noiDung || noiDung.trim().length === 0) return;

  await themMucBoNho(dungKhoWorkspaceState(context), randomUUID(), noiDung, "nguoi_dung_bao_nho");
  void vscode.window.showInformationMessage("AI Local: đã nhớ.");
}
