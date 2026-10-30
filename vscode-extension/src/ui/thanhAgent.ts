/**
 * Đợt 11.4 / mục 1 — nút thanh trạng thái "Thợ Cả · model · %ngữ cảnh · tok/s" (logic thuần ở `loi/thanhAgent.ts`).
 * Nguồn trạng thái toàn cục MỘT lần (như `loi/tinCayWorkspace.ts`): `PhienAgent` gọi `baoThanhAgent`, chưa đăng ký ⇒ no-op.
 */
import * as vscode from "vscode";
import { THANH_RONG, capNhatThanh, dinhDangThanh, type TrangThaiThanh } from "../loi/thanhAgent";

let trangThai: TrangThaiThanh = THANH_RONG;
let ve: (() => void) | undefined;

export function baoThanhAgent(c: Partial<TrangThaiThanh>): void {
  trangThai = capNhatThanh(trangThai, c);
  try {
    ve?.();
  } catch {
    /* thanh trạng thái hỏng không được làm hỏng lượt agent */
  }
}

export function dangKyThanhAgent(context: vscode.ExtensionContext): void {
  const thanh = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  thanh.name = "Thợ Cả";
  thanh.command = "aviAiLocal.moBangChat";
  ve = () => {
    const d = dinhDangThanh(trangThai);
    thanh.text = d.text;
    thanh.tooltip = d.tooltip;
    thanh.backgroundColor = d.canhBao ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
  };
  ve();
  thanh.show();
  context.subscriptions.push(thanh, { dispose: () => { ve = undefined; trangThai = THANH_RONG; } });
}
