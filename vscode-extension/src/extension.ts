/**
 * Điểm vào extension "AI Local". ĐỢT A: chỉ đọc — không có bất kỳ đường ghi tệp nào.
 */
import * as vscode from "vscode";
import { dangNhap } from "./mang/dangNhap";
import { KHOA_COOKIE } from "./loi/dangNhap";
import { BangChat } from "./ui/bangChat";
import { KhoDeXuat, SCHEME } from "./ui/diffDeXuat";
import { dungCauHoiSuaChon } from "./loi/cauHoiSuaChon";

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

/**
 * ★★★ TASK 7 — CMD+K (`ctrl+alt+k`, `when: editorTextFocus`) — "SỬA ĐOẠN ĐANG CHỌN".
 *
 * ⚠⚠⚠ RÀNG BUỘC QUAN TRỌNG NHẤT (không được nới): lệnh này CHỈ DỰNG CÂU HỎI. Nó đọc đoạn đang chọn
 * + đường dẫn, hỏi người dùng muốn sửa gì, ghép thành một câu hỏi bằng hàm THUẦN
 * `dungCauHoiSuaChon` (`loi/cauHoiSuaChon.ts`), rồi bơm câu hỏi đó vào bảng chat qua
 * `BangChat.guiCauHoiTuLenh` — đúng đường gửi sẵn có (webview tự đổ vào ô nhập rồi tự bấm "Gửi",
 * xem docblock của `guiCauHoiTuLenh`). Từ đó về sau, kết quả đi qua ĐÚNG chuỗi đã có và đã review:
 * `hoi()` → SSE → (chế độ LOCAL) `docDeXuatCucBo` → thẻ duyệt + diff native → người bấm duyệt →
 * `apBanVa`. Hàm này TUYỆT ĐỐI KHÔNG được gọi API áp chỉnh sửa của VSCode (thứ `apBanVa.ts` dùng
 * ở bước ghi) hay bất kỳ API ghi tệp `node:fs` nào — nếu bạn thấy mình sắp thêm một API như vậy
 * vào đây thì DỪNG LẠI: đó là một đường ghi THỨ HAI ngoài `apBanVa`, và census
 * (`loi/census.unit.test.ts`) phải bắt được nó (khẳng định ĐÚNG MỘT lần cho mỗi API đó, đúng tại
 * `ui/apBanVa.ts`).
 */
async function chaySuaDoanChon(context: vscode.ExtensionContext, khoDeXuat: KhoDeXuat): Promise<void> {
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.selection.isEmpty) {
    // KHÔNG im lặng: không có editor hoặc không có đoạn chọn phải báo RÀNH MẠCH, không phải một
    // lệnh bấm-mà-không-thấy-gì-xảy-ra.
    void vscode.window.showInformationMessage(
      "AI Local: hãy chọn (bôi đen) một đoạn mã trong trình soạn thảo trước khi dùng lệnh 'Sửa đoạn đang chọn'.",
    );
    return;
  }

  const yeuCau = await vscode.window.showInputBox({
    prompt: "Muốn sửa đoạn đang chọn như thế nào?",
    ignoreFocusOut: true,
  });
  if (!yeuCau) return; // người dùng bấm Esc hoặc để trống — huỷ lặng lẽ, đây là lượt CHỦ ĐỘNG huỷ

  // Đường dẫn TƯƠNG ĐỐI theo workspace (không phải đường tuyệt đối máy dev) và số dòng 1-BASED —
  // hai điều kiện `docDeXuatCucBo` cần để khớp đúng đoạn khi đọc lại `de_xuat_sua_doan` từ model.
  const duongTuongDoi = vscode.workspace.asRelativePath(ed.document.uri);
  const dongDau = ed.selection.start.line + 1;
  const dongCuoi = ed.selection.end.line + 1;
  const doanChon = ed.document.getText(ed.selection);

  let cauHoi: string;
  try {
    cauHoi = dungCauHoiSuaChon({ duongTuongDoi, dongDau, dongCuoi, doanChon, yeuCau });
  } catch (e) {
    void vscode.window.showInformationMessage(`AI Local: ${(e as Error).message}`);
    return;
  }

  const bang = BangChat.moHoacHien(context, khoDeXuat);
  bang.guiCauHoiTuLenh(cauHoi);
}

export function activate(context: vscode.ExtensionContext): void {
  // Kho đề xuất ghi (chế độ SERVER): giữ nội dung diff ẢO trong bộ nhớ, KHÔNG ghi đĩa. Đợt B chưa
  // nối nút "Xem diff" — chỉ dựng đường dây để Task 4 dùng.
  const khoDeXuat = new KhoDeXuat();
  context.subscriptions.push(khoDeXuat, vscode.workspace.registerTextDocumentContentProvider(SCHEME, khoDeXuat));

  context.subscriptions.push(
    vscode.commands.registerCommand("aviAiLocal.moBangChat", () => BangChat.moHoacHien(context, khoDeXuat)),
    vscode.commands.registerCommand("aviAiLocal.dangNhap", () => void chayDangNhap(context)),
    vscode.commands.registerCommand("aviAiLocal.dangXuat", async () => {
      await context.secrets.delete(KHOA_COOKIE);
      void vscode.window.showInformationMessage("AI Local: đã đăng xuất.");
    }),
    vscode.commands.registerCommand("aviAiLocal.suaDoanChon", () => void chaySuaDoanChon(context, khoDeXuat)),
  );
}

export function deactivate(): void {
  // không giữ tài nguyên nền nào ở Đợt A
}
