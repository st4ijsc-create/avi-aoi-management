/**
 * Điểm vào extension "AI Local". ĐỢT A: chỉ đọc — không có bất kỳ đường ghi tệp nào.
 */
import * as vscode from "vscode";
import { dangNhap } from "./mang/dangNhap";
import { KHOA_COOKIE } from "./loi/dangNhap";
import { BangChat } from "./ui/bangChat";
import { KhoDeXuat, SCHEME } from "./ui/diffDeXuat";
import { dungCauHoiSuaChon } from "./loi/cauHoiSuaChon";
import { duongTuongDoiTrongWorkspace } from "./loi/chanGhi";
import { duocPhepRoiMay } from "./loi/nguCanh";

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

  /**
   * ★★★ H1 (review 2026-08-30) — HÀNG RÀO GỬI CHO CMD+K, Ở MỨC TỆP, TUYỆT ĐỐI KHÔNG CHE NỘI DUNG.
   *
   * `chaySuaDoanChon` trước bản vá này chỉ kiểm "có đoạn chọn không" và "tệp có trong workspace
   * không" — CHƯA BAO GIỜ hỏi `duocPhepRoiMay`. Đường ngữ cảnh (`thuThapNguCanh` → `dungNguCanh`)
   * và ba tool đọc (`docCucBo.ts`) đều hỏi đúng vị từ đó; Cmd+K là ĐƯỜNG THỨ TƯ đi song song mà
   * không có hàng rào nào — bôi đen một dòng `DATABASE_URL=...` trong `.env` rồi bấm `ctrl+alt+k`
   * gửi NGUYÊN VĂN dòng đó lên máy chủ.
   *
   * ⚠⚠⚠ CỐ Ý CHẶN CẢ TỆP, KHÔNG `cheBiMat(doanChon)`: kết quả Cmd+K (`thayThe`) được GHI THẲNG LÊN
   * ĐĨA qua `apBanVa`. Nếu chỉ che nội dung gửi đi, model sẽ "sửa" đúng văn bản đã bị che
   * (`«đã che»`) rồi ta ghi RÁC đè lên tệp thật của người dùng — tệ hơn cả việc từ chối. Tệp nhạy
   * cảm thì từ chối CẢ LƯỢT, không dựng câu hỏi, không gửi byte nào — và nói RÕ vì sao, đúng khuôn
   * "không im lặng" của cả tệp này.
   */
  if (!duocPhepRoiMay(ed.document.uri.fsPath)) {
    void vscode.window.showInformationMessage(
      "AI Local: tệp này là tệp nhạy cảm (.env / khoá riêng / .git) — KHÔNG gửi nội dung đi, và " +
        "extension cũng không được phép ghi vào nó. Hãy dùng lệnh này trên một tệp khác.",
    );
    return;
  }

  const yeuCau = await vscode.window.showInputBox({
    prompt: "Muốn sửa đoạn đang chọn như thế nào?",
    ignoreFocusOut: true,
  });
  if (!yeuCau) return; // người dùng bấm Esc hoặc để trống — huỷ lặng lẽ, đây là lượt CHỦ ĐỘNG huỷ

  /**
   * ★★★ F3 (2026-08-30) — ĐƯỜNG ĐƯA CHO MODEL PHẢI NEO **CÙNG GỐC** VỚI ĐƯỜNG LÚC GHI.
   *
   * Bản cũ dùng `vscode.workspace.asRelativePath(uri)`, và hàm đó **tự thêm TÊN THƯ MỤC làm tiền
   * tố khi workspace có ≥2 thư mục** (`lib/x.ts` thay vì `x.ts`). Đường ghi thì quy đường của model
   * về tuyệt đối bằng gốc của DỰ ÁN ĐANG CHỌN. Hai hệ quy chiếu khác nhau ⇒ tốt nhất là một sửa đổi
   * hợp lệ bị từ chối kèm lý do sai; xấu nhất là tiền tố ấy TRÙNG một thư mục con có thật của gốc
   * đang chọn (hai gốc `app` và `lib`, mà `app/lib/` cũng tồn tại) ⇒ đường quy về **một tệp KHÁC,
   * CÓ THẬT**, lọt qua mọi hàng rào, và thẻ duyệt trông hoàn toàn hợp lý.
   *
   * Nên: dùng `duongTuongDoiTrongWorkspace` — CÙNG một hàm mà `bangChat` dùng để khai lên sổ kiểm
   * toán — tức đường KHÔNG tiền tố, neo trên thư mục workspace CHỨA tệp. Phần mập mờ còn lại (đường
   * không tiền tố khớp nhiều gốc) do `giaiDuongDeXuat` xử fail-closed ở phía ghi.
   */
  const dsGocWs = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  const viTri = duongTuongDoiTrongWorkspace(ed.document.uri.fsPath, dsGocWs);
  if (!viTri) {
    // Tệp ngoài mọi thư mục workspace: `apBanVa` sẽ từ chối ở luật 2 dù model có trả lời gì đi nữa.
    // Nói ngay còn hơn để người dùng đợi hết một lượt hỏi rồi mới nhận một câu từ chối.
    void vscode.window.showInformationMessage(
      "AI Local: tệp đang mở KHÔNG nằm trong thư mục workspace nào — extension chỉ sửa được tệp trong workspace đang mở.",
    );
    return;
  }
  // Đường dẫn TƯƠNG ĐỐI theo workspace (không phải đường tuyệt đối máy dev) và số dòng 1-BASED —
  // hai điều kiện `docDeXuatCucBo` cần để khớp đúng đoạn khi đọc lại `de_xuat_sua_doan` từ model.
  const duongTuongDoi = viTri.duongTuongDoi;
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
