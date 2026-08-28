/**
 * Điểm vào extension "AI Local". ĐỢT A: chỉ đọc — không có bất kỳ đường ghi tệp nào.
 */
import * as vscode from "vscode";
import { dangNhap } from "./mang/dangNhap";
import { KHOA_COOKIE } from "./loi/dangNhap";
import { BangChat } from "./ui/bangChat";

async function chayDangNhap(context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("aviAiLocal");
  const serverUrl = cfg.get<string>("serverUrl", "http://localhost:3000");
  const ten = await vscode.window.showInputBox({ prompt: `Tài khoản trên ${serverUrl}`, ignoreFocusOut: true });
  if (!ten) return;
  const matKhau = await vscode.window.showInputBox({ prompt: "Mật khẩu", password: true, ignoreFocusOut: true });
  if (!matKhau) return;

  try {
    const { ket, cookie } = await dangNhap(serverUrl, ten, matKhau);
    if (ket.loai === "can2fa") {
      void vscode.window.showErrorMessage(
        "Tài khoản này bật 2FA — extension chưa hỗ trợ. Hãy dùng tài khoản không bật 2FA.",
      );
      return;
    }
    if (ket.loai === "loi") {
      void vscode.window.showErrorMessage(`AI Local: ${ket.thongDiep}`);
      return;
    }
    if (!cookie) {
      void vscode.window.showErrorMessage("Đăng nhập được nhưng máy chủ không cấp cookie phiên.");
      return;
    }
    await context.secrets.store(KHOA_COOKIE, cookie);
    void vscode.window.showInformationMessage(`AI Local: đã đăng nhập (${ket.ten || ten}).`);
  } catch (e) {
    void vscode.window.showErrorMessage(`Không nối được máy chủ: ${(e as Error).message}`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("aviAiLocal.moBangChat", () => BangChat.moHoacHien(context)),
    vscode.commands.registerCommand("aviAiLocal.dangNhap", () => void chayDangNhap(context)),
    vscode.commands.registerCommand("aviAiLocal.dangXuat", async () => {
      await context.secrets.delete(KHOA_COOKIE);
      void vscode.window.showInformationMessage("AI Local: đã đăng xuất.");
    }),
  );
}

export function deactivate(): void {
  // không giữ tài nguyên nền nào ở Đợt A
}
