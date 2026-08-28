/**
 * Điểm vào extension "AI Local". ĐỢT A: chỉ đọc — không có bất kỳ đường ghi tệp nào.
 */
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("aviAiLocal.moBangChat", () => {
      void vscode.window.showInformationMessage("AI Local: bảng trò chuyện sẽ mở ở Task 7.");
    }),
    vscode.commands.registerCommand("aviAiLocal.dangNhap", () => {
      void vscode.window.showInformationMessage("AI Local: đăng nhập sẽ có ở Task 3.");
    }),
    vscode.commands.registerCommand("aviAiLocal.dangXuat", () => {
      void vscode.window.showInformationMessage("AI Local: đăng xuất sẽ có ở Task 3.");
    }),
  );
}

export function deactivate(): void {
  // không giữ tài nguyên nền nào ở Đợt A
}
