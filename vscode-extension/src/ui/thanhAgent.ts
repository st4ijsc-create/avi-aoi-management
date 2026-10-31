/**
 * Đợt 11.4 / mục 1 — nút thanh trạng thái "Thợ Cả · model · %ngữ cảnh · tok/s" (logic thuần ở `loi/thanhAgent.ts`).
 * Nguồn trạng thái toàn cục MỘT lần (như `loi/tinCayWorkspace.ts`): `PhienAgent` gọi `baoThanhAgent`, chưa đăng ký ⇒ no-op.
 */
import * as vscode from "vscode";
import { THANH_RONG, capNhatThanh, dinhDangThanh, huyHieuDuyet, tongChoDuyet, type TrangThaiThanh } from "../loi/thanhAgent";

let trangThai: TrangThaiThanh = THANH_RONG;
let ve: (() => void) | undefined;
const choDuyetTheoKhung = new Map<object, number>();
const viewCoHuyHieu = new Set<vscode.WebviewView>();

/** Mỗi khung (PhienAgent) báo số thẻ duyệt đang chờ CỦA NÓ; tổng được hiện ở thanh trạng thái + huy hiệu view. */
export function baoChoDuyet(nguon: object, n: number): void {
  if (n > 0) choDuyetTheoKhung.set(nguon, n);
  else choDuyetTheoKhung.delete(nguon);
  baoThanhAgent({ soChoDuyet: tongChoDuyet(choDuyetTheoKhung) });
}

/** View thanh bên đăng ký để nhận huy hiệu số thẻ chờ duyệt. */
export function ganViewHuyHieu(view: vscode.WebviewView): void {
  viewCoHuyHieu.add(view);
  view.onDidDispose(() => viewCoHuyHieu.delete(view));
  capHuyHieu();
}

function capHuyHieu(): void {
  const hh = huyHieuDuyet(trangThai.soChoDuyet ?? 0);
  for (const v of viewCoHuyHieu) v.badge = hh;
}

export function baoThanhAgent(c: Partial<TrangThaiThanh>): void {
  trangThai = capNhatThanh(trangThai, c);
  try {
    capHuyHieu();
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
  context.subscriptions.push(thanh, { dispose: () => { ve = undefined; trangThai = THANH_RONG; choDuyetTheoKhung.clear(); viewCoHuyHieu.clear(); } });
}
