/**
 * Diff native của VSCode cho một đề xuất ghi.
 *
 * ⚠ Ở CHẾ ĐỘ SERVER, cả hai phía đều là TÀI LIỆU ẢO trong bộ nhớ: extension tuyệt đối không ghi
 *   đĩa ở đường đó, kể cả tệp tạm — byte do máy chủ ghi trong hộp cát của nó.
 * ⚠ Ở CHẾ ĐỘ LOCAL (Đợt C), phía TRÁI là **TỆP THẬT trên đĩa** (spec §6.2 và bảng §7: "trái = tệp
 *   thật") — người duyệt nhìn đúng cái sắp bị ghi đè, không nhìn một bản chụp. Phía PHẢI vẫn là tài
 *   liệu ảo mang nội dung đề xuất.
 * ⚠ Tiêu đề diff PHẢI mang nhãn nguồn. Hai chế độ ghi vào HAI NƠI khác nhau; một người tưởng
 *   đang sửa tệp trên máy mình mà thật ra động vào box AI là tai nạn không cứu được (spec §7).
 */
import * as vscode from "vscode";
import type { DeXuatGhi } from "../loi/deXuatGhi";

export const SCHEME = "avi-ai-de-xuat";

/**
 * Hình dạng TỐI THIỂU mà kho này cần để phục vụ một diff. `DeXuatGhi` (chế độ SERVER) thoả nó theo
 * CẤU TRÚC, nên chế độ LOCAL dùng lại được kho mà không phải giả vờ mình có `token`/`tool`/`hetHan`
 * — những trường chỉ có nghĩa với vòng đời HITL của máy chủ.
 */
export interface NoiDungDiff {
  actionId: string;
  path: string;
  original: string;
  modified: string;
}

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

  datDeXuat(d: NoiDungDiff): { cu: vscode.Uri; moi: vscode.Uri } {
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

  /**
   * CHẾ ĐỘ LOCAL: trái = TỆP THẬT trên đĩa (spec §6.2/§7), phải = tài liệu ảo mang đề xuất.
   *
   * ⚠ Chỉ đặt phía "moi" vào kho — phía "cu" là `Uri.file`, không đi qua provider này. `quen()` vẫn
   *   xoá đúng vì nó xoá theo DANH SÁCH khoá đã đăng ký cho `actionId`, không đoán theo quy ước tên.
   */
  async moDiffCucBo(
    d: { actionId: string; path: string; duongTuyetDoi: string; modified: string },
    nhanNguon: string,
  ): Promise<void> {
    const moi = this.uri(d.actionId, "moi", d.path);
    this.noiDung.set(moi.toString(), d.modified);
    this.khoaTheoAction.set(d.actionId, [moi.toString()]);
    this._onDidChange.fire(moi);
    await vscode.commands.executeCommand(
      "vscode.diff",
      vscode.Uri.file(d.duongTuyetDoi),
      moi,
      `${nhanNguon} — ${d.path} (đề xuất của AI)`,
    );
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
