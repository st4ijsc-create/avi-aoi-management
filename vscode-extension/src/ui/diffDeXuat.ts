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
    this._onDidChange.fire(cu);
    this._onDidChange.fire(moi);
    return { cu, moi };
  }

  async moDiff(d: DeXuatGhi, nhanNguon: string): Promise<void> {
    const { cu, moi } = this.datDeXuat(d);
    await vscode.commands.executeCommand("vscode.diff", cu, moi, `${nhanNguon} — ${d.path} (đề xuất của AI)`);
  }

  quen(actionId: string): void {
    // Giả định: `actionId` do máy chủ cấp dạng token/UUID, KHÔNG BAO GIỜ chứa `/` — nên khớp theo
    // `/${actionId}/` an toàn (không lẫn sang đề xuất khác có actionId là tiền tố/hậu tố của nhau).
    for (const k of [...this.noiDung.keys()]) if (k.includes(`/${actionId}/`)) this.noiDung.delete(k);
  }

  dispose(): void {
    this._onDidChange.dispose();
    this.noiDung.clear();
  }
}
