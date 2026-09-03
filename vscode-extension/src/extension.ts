/**
 * Điểm vào extension "AI Local". ĐỢT A: chỉ đọc — không có bất kỳ đường ghi tệp nào.
 */
import * as vscode from "vscode";
import { dangNhap } from "./mang/dangNhap";
import { KHOA_COOKIE, KHOA_TEN_TAI_KHOAN } from "./loi/dangNhap";
import { BangChat } from "./ui/bangChat";
import { BangChatViewProvider, MA_VIEW_THANH_BEN, MA_VIEW_THANH_BEN_PHU } from "./ui/bangChatView";
import { KhoDeXuat, SCHEME } from "./ui/diffDeXuat";
import { dungCauHoiSuaChon } from "./loi/cauHoiSuaChon";
import { duongTuongDoiTrongWorkspace } from "./loi/chanGhi";
import { duocPhepRoiMay } from "./loi/nguCanh";
import { hoTroThanhBenPhu, KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU } from "./loi/thanhBenPhu";
// ★★★ ĐỢT H / TASK H2 / B5 — lệnh quản lý MCP server ngoài (liệt kê/bật-tắt/xem tool). Xem docblock
// `ui/mcpQuanLy.ts` cho lý do đi đường QuickPick thay vì webview.
import { chayQuanLyMcpNgoai } from "./ui/mcpQuanLy";
// ★★★ ĐỢT H / TASK H3 — bộ nhớ dài hạn: lệnh "Nhớ điều này" (B5, nhánh người dùng chủ động) + bảng
// xem/xoá (B2). Xem docblock `ui/boNhoQuanLy.ts`.
import { BoNhoQuanLy, chayNhoDieuNay } from "./ui/boNhoQuanLy";

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
    // ★★★ ĐỢT F / TASK 1 — `globalState`, KHÔNG PHẢI SecretStorage: tên tài khoản không phải bí
    // mật, chỉ để khung chat HIỂN THỊ (xem `bangChat.ts#trangThaiDangNhap`). Ghi CÙNG LÚC với cookie
    // ở trên để hai giá trị không bao giờ lệch nhau (một cái có, một cái không).
    await context.globalState.update(KHOA_TEN_TAI_KHOAN, ket.ten || ten);
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
    // ★★★ ĐỢT F / TASK 1 — TRẢ VỀ PROMISE, KHÔNG `void` NÓ. `bangChat.ts` (nút "Đăng nhập" trong
    // khung) gọi lệnh này qua `executeCommand` rồi ĐỢI nó xong để đọc lại trạng thái đăng nhập thật
    // và tự cập nhật giao diện (B3) — `void chayDangNhap(context)` (bản cũ) khiến hàm callback trả
    // `undefined` NGAY LẬP TỨC thay vì trả promise của luồng đăng nhập, nên `executeCommand` sẽ
    // resolve TRƯỚC KHI người dùng kịp gõ xong tài khoản/mật khẩu — bên gọi tưởng đã xong mà chưa.
    vscode.commands.registerCommand("aviAiLocal.dangNhap", () => chayDangNhap(context)),
    vscode.commands.registerCommand("aviAiLocal.dangXuat", async () => {
      await context.secrets.delete(KHOA_COOKIE);
      // Xoá CÙNG LÚC với cookie — cùng lý do đã ghi CÙNG LÚC lúc đăng nhập (xem `chayDangNhap`).
      await context.globalState.update(KHOA_TEN_TAI_KHOAN, undefined);
      void vscode.window.showInformationMessage("AI Local: đã đăng xuất.");
    }),
    vscode.commands.registerCommand("aviAiLocal.suaDoanChon", () => void chaySuaDoanChon(context, khoDeXuat)),
    /**
     * ★★★ ĐỢT F / TASK 3 — nút "Chat mới"/"Lịch sử" ở `view/title` của khung thanh bên (xem
     * `package.json`, `menus.view/title`, `when: "view == aviAiLocal.bangChat"`). Hai lệnh này
     * KHÔNG tự làm gì — chúng chỉ tìm ĐÚNG instance `BangChat` đang sống trong thanh bên
     * (`BangChat.thanhBenDangMo()`, xem `ui/bangChat.ts`) rồi gọi phương thức đã có trên đó. Không
     * viết logic chat/kho thứ hai ở đây.
     *
     * `thanhBenDangMo()` chỉ trả `undefined` khi VSCode CHƯA BAO GIỜ resolve khung thanh bên —
     * nhưng `view/title` chỉ VẼ hai nút này khi view ĐANG HIỂN THỊ (tức đã resolve), nên trên
     * thực tế `undefined` không xảy ra ở đường bấm nút thật; optional chaining vẫn giữ lại để một
     * lời gọi lệnh từ nơi khác (bảng lệnh, ví dụ) không ném lỗi nếu view chưa từng mở.
     */
    vscode.commands.registerCommand("aviAiLocal.chatMoi", () => BangChat.thanhBenDangMo()?.chatMoi()),
    vscode.commands.registerCommand("aviAiLocal.lichSu", () => BangChat.thanhBenDangMo()?.moLichSu()),
    // ★★★ ĐỢT H / TASK H2 / B5 — trả về promise của cả luồng (không `void`), cùng lý do đã ghi ở
    // `aviAiLocal.dangNhap`: một lệnh gọi lại lệnh này qua `executeCommand` (hiện chưa có, nhưng nếu
    // có trong tương lai) phải đợi được ĐÚNG lúc luồng thật xong, không phải "đã gọi lệnh".
    vscode.commands.registerCommand("aviAiLocal.mcpServers", () => chayQuanLyMcpNgoai(context)),
    // ★★★ ĐỢT H / TASK H3 / B5 — nhánh "người dùng CHỦ ĐỘNG bảo nhớ". Cùng lý do trả promise (không
    // `void`) đã ghi ở trên.
    vscode.commands.registerCommand("aviAiLocal.nhoDieuNay", () => chayNhoDieuNay(context)),
    // ★★★ ĐỢT H / TASK H3 / B2 — bảng xem/xoá bộ nhớ dài hạn.
    vscode.commands.registerCommand("aviAiLocal.boNho", () => BoNhoQuanLy.moHoacHien(context)),
  );

  /**
   * ★★★ ĐỢT F / TASK 4 / B2 — context key TA tự đặt, quyết định người dùng thấy AI Local ở THANH
   * BÊN PHỤ (secondarySidebar, chỗ họ để Claude Code — xem `package.json`
   * `viewsContainers.secondarySidebar[0].when: "!${KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU}"`)
   * hay LÙI về thanh hoạt động (activitybar, `when` KHÔNG có "!" — hai biểu thức PHỦ ĐỊNH của
   * nhau, `thanhBen.unit.test.ts` canh cả cặp). Đặt SỚM trong `activate()`, TRƯỚC khi VSCode có
   * dịp resolve bất kỳ view nào của extension — `when` được VSCode đọc lại mỗi khi context đổi,
   * nhưng đặt trễ để lọt qua một khung hình đầu (sai vị trí thoáng qua) là không cần thiết khi ta
   * hoàn toàn có thể đặt xong TRƯỚC.
   *
   * ★★★ B1 — ĐO ĐƯỢC, không đoán: xem docblock `hoTroThanhBenPhu` (`loi/thanhBenPhu.ts`) — ngưỡng
   * 1.106 mirror ĐÚNG logic runtime của Claude Code (bản 2.1.259 đang cài trên máy đo), đọc thẳng
   * từ `extension.js` đã build của nó, KHÔNG phải suy từ `engines.vscode` (chỉ là trần activate).
   */
  void vscode.commands.executeCommand(
    "setContext",
    KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU,
    !hoTroThanhBenPhu(vscode.version),
  );

  /**
   * ★★★ THANH BÊN — lối vào NHÌN THẤY ĐƯỢC: icon ở thanh hoạt động HOẶC thanh bên phụ (tuỳ context
   * key ở trên) mở khung chat này. `retainContextWhenHidden: true` khớp hành vi bảng NỔI cũ
   * (`moHoacHien` cũng bật cờ này) — ẩn/hiện lại view (thu gọn sidebar, đổi tab) không làm mất phiên
   * chat đang gõ dở.
   *
   * ★★★ ĐỢT F / TASK 4 / B3 — HAI view id (`MA_VIEW_THANH_BEN` cho bản LÙI ở activitybar,
   * `MA_VIEW_THANH_BEN_PHU` cho bản CHÍNH ở secondarySidebar) ⇒ phải đăng ký CẢ HAI, nhưng dùng
   * CHUNG một instance `boCungCap` — `BangChatViewProvider.resolveWebviewView` không đọc view id
   * hay tự suy container nào, nên không có lý do gì để tạo hai instance (càng không phải hai lớp).
   * Chỉ MỘT trong hai view thực sự được VSCode resolve tại một thời điểm (container kia bị `when`
   * ẩn đi), nhưng cả hai vẫn cần một provider ĐÃ ĐĂNG KÝ sẵn — nếu không, container hợp lệ mà thiếu
   * provider sẽ báo lỗi "no view registered" ngay khi VSCode thử mở nó.
   */
  const boCungCap = new BangChatViewProvider(context, khoDeXuat);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MA_VIEW_THANH_BEN, boCungCap, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider(MA_VIEW_THANH_BEN_PHU, boCungCap, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
}

export function deactivate(): void {
  // không giữ tài nguyên nền nào ở Đợt A
}
