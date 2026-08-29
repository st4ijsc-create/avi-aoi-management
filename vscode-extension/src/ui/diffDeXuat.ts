/**
 * Diff native của VSCode cho một đề xuất ghi ở CHẾ ĐỘ SERVER.
 *
 * ⚠ Cả hai phía đều là TÀI LIỆU ẢO trong bộ nhớ: Đợt B tuyệt đối không ghi đĩa, kể cả tệp tạm.
 * ⚠ Tiêu đề diff PHẢI mang nhãn nguồn. Hai chế độ ghi vào HAI NƠI khác nhau; một người tưởng
 *   đang sửa tệp trên máy mình mà thật ra động vào box AI là tai nạn không cứu được (spec §7).
 */
import * as vscode from "vscode";
import type { DeXuatGhi } from "../loi/deXuatGhi";

export const SCHEME = "avi-ai-de-xuat";

export class KhoDeXuat implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private noiDung = new Map<string, string>();
  // Bền theo CẤU TRÚC: giữ danh sách khoá URI đã dùng cho MỖI actionId, để `quen()` xoá theo
  // DANH SÁCH thay vì so khớp chuỗi con `/${actionId}/`. So chuỗi vẫn an toàn TRÊN THỰC TẾ (server
  // cấp actionId dạng UUID, không chứa `/`) nhưng đó là phụ thuộc NGẦM vào định dạng actionId —
  // đổi định dạng ở máy chủ một ngày nào đó sẽ âm thầm xoá nhầm đề xuất KHÁC có actionId là
  // tiền tố/hậu tố của nhau, không có lỗi nào báo.
  private khoaTheoAction = new Map<string, string[]>();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.noiDung.get(uri.toString()) ?? "";
  }

  private uri(actionId: string, ben: "cu" | "moi", path: string): vscode.Uri {
    // ⚠ Dựng theo THÀNH PHẦN, KHÔNG ghép chuỗi rồi `Uri.parse`. `path` đến từ máy chủ: một `%XX`
    // hợp lệ sẽ bị `parse` GIẢI MÃ âm thầm, còn `#`/`?` bị hiểu thành fragment/query — diff mở ra
    // RỖNG mà không có lỗi nào. Tên tệp tiếng Việt (dấu, khoảng trắng) làm chuyện này thành thường.
    return vscode.Uri.from({ scheme: SCHEME, path: `/${ben}/${actionId}/${path}` });
  }

  datDeXuat(d: DeXuatGhi): { cu: vscode.Uri; moi: vscode.Uri } {
    const cu = this.uri(d.actionId, "cu", d.path);
    const moi = this.uri(d.actionId, "moi", d.path);
    this.noiDung.set(cu.toString(), d.original);
    this.noiDung.set(moi.toString(), d.modified);
    this.khoaTheoAction.set(d.actionId, [cu.toString(), moi.toString()]);
    this._onDidChange.fire(cu);
    this._onDidChange.fire(moi);
    return { cu, moi };
  }

  async moDiff(d: DeXuatGhi, nhanNguon: string): Promise<void> {
    const { cu, moi } = this.datDeXuat(d);
    await vscode.commands.executeCommand("vscode.diff", cu, moi, `${nhanNguon} — ${d.path} (đề xuất của AI)`);
  }

  quen(actionId: string): void {
    const khoa = this.khoaTheoAction.get(actionId);
    if (!khoa) return; // không có gì để quên (đã quên rồi, hoặc chưa từng đặt)
    for (const k of khoa) this.noiDung.delete(k);
    this.khoaTheoAction.delete(actionId);
  }

  dispose(): void {
    this._onDidChange.dispose();
    this.noiDung.clear();
    this.khoaTheoAction.clear();
  }
}
