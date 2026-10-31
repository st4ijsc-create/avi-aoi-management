/**
 * Đợt 11.4 / mục 6 — terminal CHỈ ĐỌC "Thợ Cả" (Pseudoterminal không nhận đầu vào). Tạo lười ở lần ghi đầu tiên; đóng terminal ⇒ lần ghi sau tạo lại.
 * Nguồn toàn cục (như `thanhAgent.ts`): `BoThucThiVscode` gọi `ghiLanChayAgent`; chưa đăng ký ⇒ no-op.
 */
import * as vscode from "vscode";
import { dinhDangLanChay } from "../loi/terminalDoc";

let bat = false;
let pty: { ghi: vscode.EventEmitter<string>; terminal: vscode.Terminal } | undefined;

export function ghiLanChayAgent(lenh: string, exitCode: number | null, output: string): void {
  if (!bat) return;
  try {
    if (!pty) {
      const ghi = new vscode.EventEmitter<string>();
      const dong = new vscode.EventEmitter<number | void>();
      const terminal = vscode.window.createTerminal({
        name: "Thợ Cả (chỉ đọc)",
        pty: { onDidWrite: ghi.event, onDidClose: dong.event, open: () => ghi.fire("Thợ Cả — các lệnh agent đã chạy (chỉ đọc, không nhận phím).\r\n\r\n"), close: () => { pty = undefined; }, handleInput: () => undefined },
      });
      pty = { ghi, terminal };
    }
    pty.ghi.fire(dinhDangLanChay(lenh, exitCode, output));
  } catch {
    /* terminal chỉ để xem — hỏng không được làm hỏng lượt agent */
  }
}

export function dangKyTerminalDoc(context: vscode.ExtensionContext): void {
  bat = true;
  context.subscriptions.push(
    vscode.commands.registerCommand("aviAiLocal.moTerminalDoc", () => pty?.terminal.show(true) ?? vscode.window.showInformationMessage("Thợ Cả: chưa có lệnh nào được agent chạy trong phiên này.")),
    { dispose: () => { bat = false; pty?.terminal.dispose(); pty = undefined; } },
  );
}
