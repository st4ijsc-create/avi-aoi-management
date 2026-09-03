/**
 * ★★★ THANH BÊN — cầu nối MỎNG giữa `WebviewViewProvider` (API VSCode đòi cho một view trong
 * `viewsContainers.activitybar`) và `BangChat` (toàn bộ logic chat CÓ SẴN, xem `bangChat.ts`).
 *
 * ⚠⚠⚠ TỆP NÀY CỐ Ý CHỈ VÀI DÒNG — không dựng lại HTML, không dựng lại xử lý tin nhắn webview. Mọi
 * hành vi (hỏi/đáp, thẻ duyệt, @-mention, Cmd+K...) đi qua `BangChat.choView`, dùng LẠI đúng lớp mà
 * đường lệnh cũ (`aviAiLocal.moBangChat`, bảng NỔI) đang dùng. Nếu một ngày tệp này phình ra và bắt
 * đầu chứa logic của RIÊNG NÓ, đó là dấu hiệu logic đang bị chép sang bản thứ hai — dừng lại, đưa
 * phần đó vào `BangChat` thay vì viết thêm ở đây.
 *
 * `id` DƯỚI ĐÂY PHẢI KHỚP NGUYÊN VĂN với `contributes.views["aviAiLocalThanhBen"][0].id` trong
 * `package.json` — VSCode nối hai đầu bằng chuỗi này, không có kiểm tra biên dịch nào bắt được lệch.
 */
import * as vscode from "vscode";
import { BangChat } from "./bangChat";
import type { KhoDeXuat } from "./diffDeXuat";

export const MA_VIEW_THANH_BEN = "aviAiLocal.bangChat";

export class BangChatViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly khoDeXuat: KhoDeXuat,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    // PHẢI đặt TRƯỚC khi `BangChat.choView` gán `webview.html` — nội dung có script (`enableScripts`)
    // phải được bật trước khi trình duyệt nhúng đọc HTML, không thì script trong khung chat không
    // chạy (webview trống, không lỗi nào báo ra ngoài).
    webviewView.webview.options = { enableScripts: true };
    BangChat.choView(webviewView, this.context, this.khoDeXuat);
  }
}
