/**
 * Bảng trò chuyện AI Local. ĐỢT A: chỉ đọc. ĐỢT B: mở đường DUYỆT & GHI cho chế độ SERVER — máy
 * chủ đề xuất sửa tệp, người dùng bấm Duyệt, MÁY CHỦ ghi byte vào hộp cát của nó. Bảng này KHÔNG
 * BAO GIỜ chạm đĩa: nó chỉ hiện thẻ duyệt và chuyển tiếp quyết định của người dùng qua tRPC
 * (`../mang/duyetGhi.ts` — điểm DUY NHẤT gọi `confirmAction`, có census cưỡng chế).
 */
import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { dungHtmlBang } from "./htmlBang";
import { dungNguCanh } from "../loi/nguCanh";
import { dungYeuCauStream, type CheDoDuAn, type LuotChat } from "../loi/yeuCau";
import { moDongSse } from "../mang/dongSse";
import { KHOA_COOKIE } from "../loi/dangNhap";
import { gopDanhSachDuAn, type MucDuAn } from "../loi/duAn";
import { goiTruyVanTrpc } from "../mang/trpc";
import { laLoi401 } from "../loi/loiHttp";
import { trangThaiBanDau, apDungSuKienChat, ketLuanLuotChat } from "../loi/suKienChat";
import { docDeXuatGhi, laTaoTepMoi, type DeXuatGhi } from "../loi/deXuatGhi";
import { tomTatDiff } from "../loi/tomTatDiff";
import { coDuocHienTheDuyet } from "../loi/kiemTraCheDo";
import { goiDuyet, goiHuy } from "../mang/duyetGhi";
import type { KhoDeXuat } from "./diffDeXuat";

/**
 * Nonce cho CSP của webview. Dùng CSPRNG chứ không `Math.random()`: nonce là thứ CSP dựa vào để
 * quyết định script nào được phép chạy — đoán được nonce là làm yếu chính hàng rào đó.
 */
function chuoiNgauNhien(): string {
  return randomBytes(24).toString("base64url");
}

export class BangChat {
  private static hienTai: BangChat | undefined;
  private lichSu: LuotChat[] = [];
  private huy: AbortController | undefined;
  private dsDuAn: MucDuAn[] = [];
  private duAnChon: string | undefined;
  // CHẾ ĐỘ của lượt hỏi đang chạy — chốt lại khi `hoi()` bắt đầu để `nhan` (callback SSE của CÙNG
  // lượt đó) biết mình đang ở LOCAL hay SERVER lúc quyết định có hiện thẻ duyệt hay không. Đọc lại
  // `this.duAnChon`/`this.dsDuAn` lúc SSE tới có thể đã lệch nếu người dùng đổi ô chọn giữa chừng.
  private cheDoHoiHienTai: CheDoDuAn | undefined;
  // Đề xuất ghi đang chờ duyệt (nếu có) + nhãn nguồn của nó, dùng chung cho ba tin nhắn webview
  // gửi lại: "xem_diff" / "duyet" / "huy". Đợt B chỉ giữ TỐI ĐA một đề xuất tại một thời điểm.
  private deXuatHienTai: DeXuatGhi | undefined;
  private nhanNguonHienTai: string | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    // Nay ĐÃ được đọc (xemDiff/duyet/huyDeXuat bên dưới) ⇒ `private` biên dịch sạch qua
    // `noUnusedLocals` (Task 3 phải để public vì lúc đó chưa ai đọc field này).
    private readonly khoDeXuat: KhoDeXuat,
  ) {
    this.panel.webview.html = dungHtmlBang({ nonce: chuoiNgauNhien() });
    this.panel.onDidDispose(() => {
      this.huy?.abort();
      BangChat.hienTai = undefined;
    });
    // KHÔNG nạp danh sách dự án ở đây. `postMessage` có thể chạy TRƯỚC khi script trong webview
    // kịp đăng ký `addEventListener("message", …)` ⇒ danh sách rơi mất mà không có lỗi nào — ô
    // chọn trống một cách im lặng. Đợi webview tự báo "san_sang" (xem htmlBang.ts) rồi mới nạp.
    this.panel.webview.onDidReceiveMessage((m: { loai: string; cauHoi?: string; duAnId?: string }) => {
      if (m.loai === "san_sang") { void this.napDuAn(); return; }
      if (m.duAnId) this.duAnChon = m.duAnId;
      if (m.loai === "hoi" && m.cauHoi) { void this.hoi(m.cauHoi); return; }
      if (m.loai === "xem_diff") { void this.xemDiff(); return; }
      if (m.loai === "duyet") { void this.duyetDeXuat(); return; }
      if (m.loai === "huy") { void this.huyDeXuat(); return; }
    });
  }

  static moHoacHien(context: vscode.ExtensionContext, khoDeXuat: KhoDeXuat): void {
    if (BangChat.hienTai) {
      BangChat.hienTai.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "aviAiLocalChat",
      "AI Local",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    BangChat.hienTai = new BangChat(panel, context, khoDeXuat);
  }

  private thuThapNguCanh(): string {
    const cfg = vscode.workspace.getConfiguration("aviAiLocal");
    const nganSach = cfg.get<number>("nganSachNguCanh", 24000);
    const ed = vscode.window.activeTextEditor;
    if (!ed) return dungNguCanh({ nganSach });

    const duong = vscode.workspace.asRelativePath(ed.document.uri);
    const chon = ed.selection.isEmpty
      ? undefined
      : {
          duong,
          dongDau: ed.selection.start.line + 1,
          dongCuoi: ed.selection.end.line + 1,
          noiDung: ed.document.getText(ed.selection),
        };
    return dungNguCanh({
      nganSach,
      doanChon: chon,
      tepDangMo: { duong, noiDung: ed.document.getText() },
    });
  }

  private async napDuAn(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("aviAiLocal");
    const serverUrl = cfg.get<string>("serverUrl", "http://localhost:3000");
    const cookie = await this.context.secrets.get(KHOA_COOKIE);
    const local = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    let server: Array<{ id: string; name: string }> = [];
    if (cookie) {
      try {
        const du = (await goiTruyVanTrpc(serverUrl, cookie, "repoWorkspace.listProjects")) as
          | { projects?: Array<{ id: string; name: string }> }
          | null;
        server = du?.projects ?? [];
      } catch {
        server = []; // không nối được server thì vẫn dùng được chế độ LOCAL
      }
    }
    this.dsDuAn = gopDanhSachDuAn(local, server);
    this.duAnChon = this.duAnChon ?? this.dsDuAn[0]?.id;
    void this.panel.webview.postMessage({ loai: "duAn", ds: this.dsDuAn });
  }

  private async hoi(cauHoi: string): Promise<void> {
    const cookie = await this.context.secrets.get(KHOA_COOKIE);
    if (!cookie) {
      void this.panel.webview.postMessage({
        loai: "loi",
        thongDiep: "Chưa đăng nhập — chạy lệnh 'AI Local: Đăng nhập'.",
      });
      return;
    }
    const cfg = vscode.workspace.getConfiguration("aviAiLocal");
    const muc = this.dsDuAn.find((d) => d.id === this.duAnChon) ?? this.dsDuAn[0];
    const cheDo: CheDoDuAn =
      muc && muc.loai === "server"
        ? { loai: "server", projectId: muc.id.slice("server:".length), nhan: muc.nhan }
        : { loai: "local", nhan: muc?.nhan ?? "workspace" };
    // Chốt CHẾ ĐỘ của lượt này NGAY BÂY GIỜ — `nhan` bên dưới (chạy trong cùng lượt) đọc lại field
    // này, không đọc `this.duAnChon` trực tiếp, để không lệch nếu người dùng đổi ô chọn giữa chừng.
    this.cheDoHoiHienTai = cheDo;
    const than = dungYeuCauStream({
      cauHoi,
      nguCanh: this.thuThapNguCanh(),
      lichSu: this.lichSu,
      ngonNgu: cfg.get<string>("uiLanguage", "vi"),
      vaiTro: "engineer",
      cheDo,
    });

    this.huy?.abort();
    this.huy = new AbortController();
    let tt = trangThaiBanDau();
    try {
      const { hong } = await moDongSse({
        serverUrl: cfg.get<string>("serverUrl", "http://localhost:3000"),
        cookie,
        than,
        tinHieu: this.huy.signal,
        nhan: (sk) => {
          // Vòng trạng thái THUẦN (suKienChat.ts) gom token + đóng lượt khi có `done` + phát hiện
          // cắt ngang. Việc GỬI TỚI WEBVIEW theo từng khung vẫn ở đây vì đó là I/O.
          tt = apDungSuKienChat(tt, sk);
          // Tên trường ĐÃ ĐO trên mã máy chủ: `send({ type:"token", token: evt.token })`
          // (server/routes/aiLocalKnowledgeApi.ts:595) — KHÔNG phải `text`.
          if (sk.type === "token" && typeof sk.token === "string") {
            void this.panel.webview.postMessage({ loai: "token", chu: sk.token });
          } else if (sk.type === "error") {
            // Máy chủ gửi chi tiết ở `error` (aiLocalKnowledgeApi.ts:628), KHÔNG phải `message`.
            // Nhận cả hai để phòng đường khác, nhưng `error` phải đứng TRƯỚC.
            const chiTiet =
              typeof sk.error === "string" ? sk.error : typeof sk.message === "string" ? sk.message : null;
            void this.panel.webview.postMessage({
              loai: "loi",
              thongDiep: chiTiet ?? "Máy chủ báo lỗi.",
            });
          } else {
            // Payload LỒNG dưới `pendingAction` (deXuatGhi.ts) — `docDeXuatGhi` tự trả `null` cho
            // mọi khung không phải đề xuất ghi apply_diff, nên gọi vô điều kiện ở đây là an toàn.
            const d = docDeXuatGhi(sk);
            if (d) this.xuLyDeXuat(d);
          }
        },
      });
      const { traLoi, canhBao } = ketLuanLuotChat(tt, hong);
      // `degraded` ⇒ webview đang hiện chữ ĐÃ STREAM mà server vừa bảo là rác (vòng công cụ suy
      // biến) — phải THAY bằng `answer` thật, không chỉ lặng lẽ lưu đúng mà hiện sai.
      void this.panel.webview.postMessage({
        loai: "hoan_tat",
        vanBanCuoi: tt.degraded ? traLoi : null,
        canhBao,
      });
      this.lichSu.push({ role: "user", content: cauHoi }, { role: "assistant", content: traLoi });
    } catch (e) {
      // Huỷ lượt cũ là hành vi BÌNH THƯỜNG (người dùng hỏi câu mới) — không phải lỗi, không được
      // khai thành lỗi. Chỉ lỗi THẬT mới hiện lên.
      if ((e as Error).name === "AbortError") return;
      if (laLoi401(e)) {
        // Spec §5.1: "401 giữa chừng ⇒ xoá cookie, mời đăng nhập lại" — cookie chết mà để lại thì
        // mọi lượt sau lại 401 y hệt, không ai biết vì sao. CHỈ 401 mới xoá — 403/500 không xoá.
        await this.context.secrets.delete(KHOA_COOKIE);
        void this.panel.webview.postMessage({
          loai: "loi",
          thongDiep: "Phiên đăng nhập hết hạn — đã xoá phiên cũ. Chạy lệnh 'AI Local: Đăng nhập' để vào lại.",
        });
        return;
      }
      void this.panel.webview.postMessage({ loai: "loi", thongDiep: (e as Error).message });
    }
  }

  /**
   * Nhận một đề xuất ghi vừa đọc được từ khung SSE. Bước 4 (Task 4/5): hàng rào cuối — chỉ hiện
   * thẻ duyệt khi lượt hỏi đang chạy THẬT SỰ ở chế độ SERVER. Việc này không nên xảy ra (LOCAL gửi
   * `codingMode:false`) nhưng nếu máy chủ vẫn gửi, im lặng bỏ qua còn nguy hiểm hơn báo cảnh báo.
   */
  private xuLyDeXuat(d: DeXuatGhi): void {
    const cheDo = this.cheDoHoiHienTai;
    if (!coDuocHienTheDuyet(cheDo?.loai ?? "local")) {
      void this.panel.webview.postMessage({
        loai: "thong_bao",
        thongDiep:
          "Cảnh báo: máy chủ gửi một đề xuất ghi trong khi lượt hỏi đang ở chế độ LOCAL — đã bỏ qua, KHÔNG hiện thẻ duyệt.",
      });
      return;
    }
    // Đề xuất TRƯỚC (nếu có) chưa từng được Duyệt/Huỷ đang bị GHI ĐÈ ở đây — không `quen()` nó thì
    // nội dung diff ẢO của nó mồ côi trong `KhoDeXuat` tới khi TTL máy chủ hết (Finding 2, không
    // phải lỗ an toàn vì không có gì tự duyệt, nhưng là rò bộ nhớ không cần thiết).
    if (this.deXuatHienTai) this.khoDeXuat.quen(this.deXuatHienTai.actionId);
    this.deXuatHienTai = d;
    // Nhãn nguồn = nhãn dự án SERVER đang chọn (đã có tiền tố "SERVER · ", xem duAn.ts) — dùng
    // NGUYÊN VĂN cho cả thẻ duyệt lẫn tiêu đề diff (Task 3) để hai nơi luôn khớp nhau.
    this.nhanNguonHienTai = cheDo!.nhan;
    const { them, bot } = tomTatDiff(d.original, d.modified);
    const tomTat = laTaoTepMoi(d) ? "Tạo tệp mới" : `+${them} / −${bot}`;
    void this.panel.webview.postMessage({
      loai: "the_duyet",
      nhanNguon: this.nhanNguonHienTai,
      duong: d.path,
      tomTat,
      han: d.hetHan,
    });
  }

  private async xemDiff(): Promise<void> {
    if (!this.deXuatHienTai || !this.nhanNguonHienTai) return;
    await this.khoDeXuat.moDiff(this.deXuatHienTai, this.nhanNguonHienTai);
  }

  private async duyetDeXuat(): Promise<void> {
    const d = this.deXuatHienTai;
    if (!d) return;
    const cookie = await this.context.secrets.get(KHOA_COOKIE);
    if (!cookie) {
      // KHÔNG quên đề xuất ở đây: token còn hạn (TTL 5 phút), người dùng có thể đăng nhập rồi bấm
      // Duyệt lại mà không phải hỏi lại câu cũ.
      void this.panel.webview.postMessage({
        loai: "thong_bao",
        thongDiep: "Chưa đăng nhập — chạy lệnh 'AI Local: Đăng nhập' rồi bấm Duyệt lại.",
      });
      return;
    }
    const cfg = vscode.workspace.getConfiguration("aviAiLocal");
    const serverUrl = cfg.get<string>("serverUrl", "http://localhost:3000");
    let thongDiep: string;
    try {
      // Điểm DUY NHẤT trong extension gọi confirmAction — xem ../mang/duyetGhi.ts.
      const kq = await goiDuyet(serverUrl, cookie, d.actionId, d.token);
      // ⚠ Máy chủ TỪ CHỐI qua HTTP 200 (hết hạn TTL, token lệch, trạng thái sai...) — `goiDuyet`
      // không ném cho các ca đó. Chỉ `ok === true` mới được khai "đã ghi"; ngược lại hiện NGUYÊN
      // VĂN lý do của máy chủ, không bịa ra một câu thành công giả.
      // ⚠ `status === "executed"` cũng có `ok:true` (đã ghi TRƯỚC ĐÓ, không phải LẦN NÀY) — hiện
      // nguyên văn message của máy chủ ("Đã thực thi trước đó."), đừng khai như vừa ghi mới.
      thongDiep = kq.ok
        ? kq.status === "executed"
          ? (kq.message ?? "Đã thực thi trước đó.")
          : `Đã duyệt — máy chủ đã ghi "${d.path}".`
        : (kq.message ?? "Máy chủ từ chối lượt duyệt.");
    } catch (e) {
      thongDiep = `Duyệt thất bại: ${(e as Error).message}`;
    }
    this.khoDeXuat.quen(d.actionId);
    this.deXuatHienTai = undefined;
    this.nhanNguonHienTai = undefined;
    void this.panel.webview.postMessage({ loai: "an_the_duyet" });
    void this.panel.webview.postMessage({ loai: "thong_bao", thongDiep });
  }

  private async huyDeXuat(): Promise<void> {
    const d = this.deXuatHienTai;
    if (!d) return;
    const cookie = await this.context.secrets.get(KHOA_COOKIE);
    if (!cookie) {
      void this.panel.webview.postMessage({
        loai: "thong_bao",
        thongDiep: "Chưa đăng nhập — chạy lệnh 'AI Local: Đăng nhập' rồi bấm Huỷ lại.",
      });
      return;
    }
    const cfg = vscode.workspace.getConfiguration("aviAiLocal");
    const serverUrl = cfg.get<string>("serverUrl", "http://localhost:3000");
    let thongDiep: string;
    try {
      const kq = await goiHuy(serverUrl, cookie, d.actionId);
      // `cancelAction` cũng TỪ CHỐI qua HTTP 200 (đã thực thi trước đó, trạng thái sai...) —
      // `aiCopilotActions.ts:944-969` cùng hình dạng {ok,status,message} như confirmAction.
      thongDiep = kq.ok
        ? `Đã huỷ đề xuất sửa "${d.path}" — không có gì được ghi.`
        : (kq.message ?? "Máy chủ từ chối lượt huỷ.");
    } catch (e) {
      thongDiep = `Huỷ thất bại: ${(e as Error).message}`;
    }
    this.khoDeXuat.quen(d.actionId);
    this.deXuatHienTai = undefined;
    this.nhanNguonHienTai = undefined;
    void this.panel.webview.postMessage({ loai: "an_the_duyet" });
    void this.panel.webview.postMessage({ loai: "thong_bao", thongDiep });
  }
}
