/**
 * Bảng trò chuyện AI Local.
 *
 * ĐỢT A: chỉ đọc. ĐỢT B: mở đường DUYỆT & GHI cho chế độ SERVER — máy chủ đề xuất sửa tệp, người
 * dùng bấm Duyệt, MÁY CHỦ ghi byte vào hộp cát của nó. ĐỢT C: mở đường ghi CỤC BỘ cho chế độ LOCAL
 * — đề xuất đến từ VĂN BẢN model (`loi/deXuatCucBo.ts`), người dùng bấm "Ghi vào workspace", và
 * EXTENSION ghi byte vào máy lập trình viên qua `ui/apBanVa.ts`.
 *
 * ⚠⚠⚠ KHÔNG ĐƯỜNG CHÉO (spec §7). Tệp này giữ HAI đường tách bạch, và mỗi đường có hàng rào ở CẢ
 * lúc hiện thẻ LẪN lúc bấm nút:
 *   · chế độ SERVER ⇒ `deXuatHienTai` (`DeXuatGhi` từ SSE) ⇒ `goiDuyet`/`goiHuy` ⇒ máy chủ ghi.
 *     **KHÔNG BAO GIỜ** đi qua `apBanVa` — bảng này không chạm đĩa ở đường SERVER.
 *   · chế độ LOCAL  ⇒ `deXuatCucBoHienTai` (`DeXuatCucBo` từ văn bản) ⇒ `apBanVa` ⇒ extension ghi.
 *     **KHÔNG BAO GIỜ** gọi cửa duyệt của máy chủ — không có hàng HITL nào trên đó để duyệt.
 * Hai bất biến đó có census đếm (`loi/census.unit.test.ts`: đúng MỘT điểm ghi đĩa cục bộ, đúng MỘT
 * nơi gọi cửa duyệt SERVER).
 */
import * as vscode from "vscode";
import { randomBytes, randomUUID } from "node:crypto";
import { relative, resolve } from "node:path";
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
import { goiDuyet, goiHuy, daBiTuChoiGhi, maTuChoiGhi } from "../mang/duyetGhi";
import type { KhoDeXuat } from "./diffDeXuat";
import { docDeXuatCucBo, type DeXuatCucBo } from "../loi/deXuatCucBo";
import { ghepBanVa } from "../loi/ghepBanVa";
import { bamNoiDung } from "../loi/bamTep";
import { duocPhepGhi } from "../loi/chanGhi";
import { giaiDuongThat } from "../loi/duongThat";
import { nhanNguonTheDuyet, nhanNutGhi } from "../loi/nhanTheDuyet";
import { apBanVa } from "./apBanVa";

/** Đề xuất ghi CỤC BỘ đang chờ duyệt + mọi thứ đã ĐO tại thời điểm dựng thẻ (không đo lại lúc bấm,
 *  trừ băm đĩa — băm PHẢI đo lại trong `apBanVa` vì đó chính là phép chống xung đột). */
interface DeXuatCucBoDangCho {
  actionId: string;
  deXuat: DeXuatCucBo;
  duongTuyetDoi: string;
  duongTuongDoi: string;
  /** Băm nội dung ĐĨA lúc dựng thẻ — đúng bản người dùng nhìn thấy ở phía trái diff. */
  bamGoc: string;
  /** Nội dung sau khi ghép, dùng cho phía phải của diff và để người dùng xem trước. */
  moi: string;
  thuMucWorkspace: string;
  them: number;
  bot: number;
}

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
  // Thư mục workspace của lượt hỏi LOCAL đang chạy — chốt cùng lúc với `cheDoHoiHienTai` và vì cùng
  // một lý do: đề xuất đọc được lúc lượt hỏi KẾT THÚC phải neo vào thư mục lúc nó BẮT ĐẦU, chứ
  // không phải ô chọn hiện tại (người dùng có thể đã đổi giữa chừng).
  private thuMucHoiHienTai: string | undefined;
  // Đề xuất ghi đang chờ duyệt (nếu có) + nhãn nguồn của nó, dùng chung cho ba tin nhắn webview
  // gửi lại: "xem_diff" / "duyet" / "huy". Giữ TỐI ĐA một đề xuất tại một thời điểm — và tối đa
  // MỘT TRONG HAI loại: hai trường dưới đây KHÔNG BAO GIỜ cùng khác `undefined` (mỗi lượt hỏi chỉ
  // ở một chế độ, và `quenDeXuat` xoá cả hai).
  private deXuatHienTai: DeXuatGhi | undefined;
  private deXuatCucBoHienTai: DeXuatCucBoDangCho | undefined;
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
      // ★★★ ĐỔI DỰ ÁN ⇒ VỨT ĐỀ XUẤT ĐANG CHỜ. Thẻ duyệt mang nhãn nguồn của dự án nó SINH RA; để
      // nó sống qua một lần đổi ô chọn là chìa nút "Duyệt & ghi trên SERVER" cho một người đang
      // nhìn tên dự án KHÁC — đúng loại tai nạn không cứu được mà spec §7 nói tới. Đề xuất cũ vẫn
      // còn trên máy chủ tới hết TTL và có thể hỏi lại; cái ta bỏ chỉ là CÚ BẤM.
      if (m.duAnId && m.duAnId !== this.duAnChon) {
        this.duAnChon = m.duAnId;
        this.quenDeXuat("Đã đổi dự án — đề xuất ghi đang chờ đã được bỏ. Hãy hỏi lại nếu vẫn cần.");
      } else if (m.duAnId) {
        this.duAnChon = m.duAnId;
      }
      if (m.loai === "doi_du_an") return; // chỉ để đồng bộ ô chọn, không kèm hành động nào khác
      if (m.loai === "hoi" && m.cauHoi) { void this.hoi(m.cauHoi); return; }
      if (m.loai === "xem_diff") { void this.xemDiff(); return; }
      if (m.loai === "duyet") { void this.duyetDeXuat(); return; }
      if (m.loai === "huy") { void this.huyDeXuat(); return; }
    });
  }

  /**
   * Vứt đề xuất đang chờ (nếu có): quên nội dung diff ảo, xoá field, ẩn thẻ. Gom vào MỘT chỗ vì ba
   * nơi gọi (đổi dự án · lượt hỏi mới · sau khi Duyệt/Huỷ xong) từng làm ba việc lệch nhau — và
   * chỗ quên ẩn thẻ để lại một cú bấm SỐNG cho một đề xuất đã chết.
   */
  private quenDeXuat(thongBao?: string): void {
    const actionId = this.deXuatHienTai?.actionId ?? this.deXuatCucBoHienTai?.actionId;
    if (!actionId) return;
    this.khoDeXuat.quen(actionId);
    this.deXuatHienTai = undefined;
    this.deXuatCucBoHienTai = undefined;
    this.nhanNguonHienTai = undefined;
    void this.panel.webview.postMessage({ loai: "an_the_duyet" });
    if (thongBao) void this.panel.webview.postMessage({ loai: "thong_bao", thongDiep: thongBao });
  }

  /** Thư mục LOCAL đang chọn ở ô dự án (`local:<fsPath>`), rơi về thư mục workspace đầu tiên. */
  private thuMucLocalDangChon(): string | undefined {
    if (this.duAnChon?.startsWith("local:")) return this.duAnChon.slice("local:".length);
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /** CHẾ ĐỘ suy từ ô chọn dự án ĐANG hiển thị. Một chỗ duy nhất — `hoi()` và `duyetDeXuat()` đều
   *  hỏi cùng câu này, nên hàng rào lúc HIỆN thẻ và hàng rào lúc BẤM duyệt không thể lệch nhau. */
  private cheDoHienTai(): CheDoDuAn {
    const muc = this.dsDuAn.find((d) => d.id === this.duAnChon) ?? this.dsDuAn[0];
    return muc && muc.loai === "server"
      ? { loai: "server", projectId: muc.id.slice("server:".length), nhan: muc.nhan }
      : { loai: "local", nhan: muc?.nhan ?? "workspace" };
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
    // ★★★ LƯỢT HỎI MỚI ⇒ ĐỀ XUẤT CŨ HẾT HIỆU LỰC TRÊN GIAO DIỆN. Trước đây thẻ duyệt của lượt
    // trước ở lại NGUYÊN trên bảng trong khi câu trả lời mới đang stream — người dùng đọc câu mới
    // rồi bấm cái nút của câu CŨ. `xuLyDeXuat` có quên đề xuất cũ, nhưng chỉ khi một đề xuất MỚI
    // tới; lượt hỏi không đẻ đề xuất nào thì thẻ cũ sống mãi.
    this.quenDeXuat();
    const cookie = await this.context.secrets.get(KHOA_COOKIE);
    if (!cookie) {
      void this.panel.webview.postMessage({
        loai: "loi",
        thongDiep: "Chưa đăng nhập — chạy lệnh 'AI Local: Đăng nhập'.",
      });
      return;
    }
    const cfg = vscode.workspace.getConfiguration("aviAiLocal");
    const cheDo = this.cheDoHienTai();
    // Chốt CHẾ ĐỘ của lượt này NGAY BÂY GIỜ — `nhan` bên dưới (chạy trong cùng lượt) đọc lại field
    // này, không đọc `this.duAnChon` trực tiếp, để không lệch nếu người dùng đổi ô chọn giữa chừng.
    this.cheDoHoiHienTai = cheDo;
    this.thuMucHoiHienTai = cheDo.loai === "local" ? this.thuMucLocalDangChon() : undefined;
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
      // ★★★ ĐỢT C — đường ghi CỤC BỘ. Ở chế độ LOCAL máy chủ gửi `codingMode:false` nên KHÔNG có
      // `pending_action` nào; đề xuất sửa nằm trong VĂN BẢN model, đọc được sau khi lượt trả lời
      // đóng. Hàng rào chế độ đặt ở đây (không phải bên trong `xuLyDeXuatCucBo`) để một lượt SERVER
      // tình cờ chứa khối ```avi-tool``` không đẻ ra thẻ ghi-vào-máy-dev.
      if (cheDo.loai === "local") void this.xuLyDeXuatCucBo(traLoi);
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
    this.quenDeXuat();
    this.deXuatHienTai = d;
    // Nhãn nguồn = nhãn dự án SERVER đang chọn — `nhanNguonTheDuyet` đảm bảo ĐÚNG MỘT tiền tố
    // "SERVER · " kể cả khi nhãn tới đây đã/chưa có sẵn. Dùng chung cho cả thẻ duyệt lẫn tiêu đề
    // diff (Task 3) để hai nơi luôn khớp nhau.
    this.nhanNguonHienTai = nhanNguonTheDuyet({ loai: "server", nhan: cheDo!.nhan });
    // ⚠ `tomTatDiff` là phép đếm ĐA TẬP HỢP, không phải thuật toán diff: một lượt **SẮP XẾP LẠI**
    // dòng (cùng tập dòng, khác thứ tự) cho them=0/bot=0 — và thẻ khi ấy khai "+0 / −0", tức nói
    // KHÔNG CÓ THAY ĐỔI cho một thay đổi CÓ THẬT sắp được ghi vào tệp. `doiDong` là ô mà chính hàm
    // đó trả về để phân biệt hai ca, trước đây bị vứt đi. Không đoán thêm gì: nói rõ có thay đổi
    // nhưng phép đếm dòng không thấy, và mời mở diff — nơi VSCode vẽ diff THẬT.
    const { them, bot, doiDong } = tomTatDiff(d.original, d.modified);
    const tomTat = laTaoTepMoi(d)
      ? "Tạo tệp mới"
      : doiDong
        ? `+${them} / −${bot}`
        : "Có thay đổi (sắp xếp lại dòng) — mở diff để xem";
    void this.panel.webview.postMessage({
      loai: "the_duyet",
      nhanNguon: this.nhanNguonHienTai,
      // ★★★ CHỮ TRÊN NÚT LÀ HÀNG RÀO: nó nói byte sẽ rơi Ở ĐÂU. Webview KHÔNG có chữ mặc định nào
      // cho nút này (xem `htmlBang.ts`) — thiếu `nhanNut` thì thẻ không hiện, thay vì hiện với chữ
      // của lượt TRƯỚC (có thể là chữ của chế độ KIA).
      nhanNut: nhanNutGhi("server"),
      duong: d.path,
      tomTat,
      han: d.hetHan,
    });
  }

  /**
   * ★★★ ĐỢT C — ĐỀ XUẤT GHI CỤC BỘ (chế độ LOCAL). Đọc khối ```avi-tool``` từ văn bản model rồi
   * dựng thẻ duyệt + diff native. **Không ghi gì ở đây** — mọi byte chỉ rơi trong `apBanVa`.
   *
   * Thứ tự kiểm ở đây cố ý NGHIÊNG VỀ TỪ CHỐI SỚM: giải đường thật → vị từ chặn → đọc đĩa → ghép.
   * Đặc biệt, vị từ chặn chạy **TRƯỚC** khi đọc nội dung: nếu không, một đề xuất trỏ vào `.env` sẽ
   * khiến nội dung tệp bí mật hiện nguyên văn trong tab diff trước khi có ai kịp từ chối nó.
   * ⚠ Đây KHÔNG phải nơi cưỡng chế — `apBanVa` kiểm lại toàn bộ lúc bấm (giữa lúc hiện thẻ và lúc
   *   bấm, mọi thứ đều có thể đổi). Đây chỉ là "đừng vẽ ra một cái nút không bao giờ bấm được".
   */
  private async xuLyDeXuatCucBo(vanBan: string): Promise<void> {
    const ds = docDeXuatCucBo(vanBan);
    if (ds.length === 0) return;
    this.quenDeXuat();
    if (ds.length > 1) {
      void this.panel.webview.postMessage({
        loai: "thong_bao",
        thongDiep: `Model đề xuất ${ds.length} thay đổi nhưng bảng này chỉ duyệt MỘT lần một tệp — chỉ hiện đề xuất đầu tiên, hãy hỏi lại cho các tệp còn lại.`,
      });
    }
    const d = ds[0];

    const goc = this.thuMucHoiHienTai;
    if (!goc) {
      void this.panel.webview.postMessage({
        loai: "thong_bao",
        thongDiep: "Model đề xuất sửa tệp nhưng KHÔNG có thư mục workspace nào đang mở — đã bỏ qua.",
      });
      return;
    }
    const dsWs = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    // `resolve` xử được cả `path` tương đối lẫn tuyệt đối do model sinh; `giaiDuongThat` + vị từ
    // chặn ngay sau đó quyết định nó có hợp lệ không.
    const duongTuyetDoi = resolve(goc, d.path);
    const that = giaiDuongThat(duongTuyetDoi);
    if (!that.ok) {
      void this.panel.webview.postMessage({ loai: "thong_bao", thongDiep: `Bỏ qua đề xuất sửa "${d.path}": ${that.lyDo}` });
      return;
    }
    const wsThat: string[] = [];
    for (const ws of dsWs) {
      const r = giaiDuongThat(ws);
      if (!r.ok) {
        void this.panel.webview.postMessage({
          loai: "thong_bao",
          thongDiep: `Bỏ qua đề xuất sửa "${d.path}": không giải được thư mục workspace "${ws}" (${r.lyDo}).`,
        });
        return;
      }
      wsThat.push(r.duong);
    }
    const phep = duocPhepGhi(that.duong, wsThat);
    if (!phep.ok) {
      void this.panel.webview.postMessage({ loai: "thong_bao", thongDiep: `Bỏ qua đề xuất sửa "${d.path}": ${phep.lyDo}` });
      return;
    }

    let noiDungGoc: string;
    try {
      // ĐỌC TỪ ĐĨA, không từ bộ đệm editor — cùng lý lẽ với `apBanVa` bước 3: băm phải nói về BYTE.
      noiDungGoc = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(that.duong))).toString("utf8");
    } catch (e) {
      void this.panel.webview.postMessage({
        loai: "thong_bao",
        thongDiep: `Bỏ qua đề xuất sửa "${d.path}": không đọc được tệp từ đĩa (${(e as Error).message}). Đợt này chỉ sửa tệp ĐÃ CÓ, không tạo tệp mới.`,
      });
      return;
    }
    const ghep = ghepBanVa(noiDungGoc, d);
    if (!ghep.ok) {
      void this.panel.webview.postMessage({ loai: "thong_bao", thongDiep: `Bỏ qua đề xuất sửa "${d.path}": ${ghep.lyDo}` });
      return;
    }

    const duongTuongDoi = (relative(goc, that.duong) || d.path).replace(/\\/g, "/");
    const { them, bot, doiDong } = tomTatDiff(noiDungGoc, ghep.moi);
    this.deXuatCucBoHienTai = {
      actionId: randomUUID(),
      deXuat: d,
      duongTuyetDoi: that.duong,
      duongTuongDoi,
      bamGoc: bamNoiDung(noiDungGoc),
      moi: ghep.moi,
      thuMucWorkspace: goc,
      them,
      bot,
    };
    this.nhanNguonHienTai = nhanNguonTheDuyet({ loai: "local", nhan: goc });
    void this.panel.webview.postMessage({
      loai: "the_duyet",
      nhanNguon: this.nhanNguonHienTai,
      nhanNut: nhanNutGhi("local"),
      duong: duongTuongDoi,
      tomTat: doiDong ? `+${them} / −${bot}` : "Có thay đổi (sắp xếp lại dòng) — mở diff để xem",
      // Đề xuất CỤC BỘ không có TTL của máy chủ (chưa có hàng nào trên máy chủ cho tới lúc bấm
      // ghi). Gửi chuỗi rỗng và để webview nói đúng điều đó, thay vì bịa ra một cái hạn.
      han: "",
    });
  }

  private async xemDiff(): Promise<void> {
    if (!this.nhanNguonHienTai) return;
    const cb = this.deXuatCucBoHienTai;
    if (cb) {
      // Chế độ LOCAL: TRÁI là TỆP THẬT trên đĩa (spec §6.2/§7).
      await this.khoDeXuat.moDiffCucBo(
        { actionId: cb.actionId, path: cb.duongTuongDoi, duongTuyetDoi: cb.duongTuyetDoi, modified: cb.moi },
        this.nhanNguonHienTai,
      );
      return;
    }
    if (!this.deXuatHienTai) return;
    await this.khoDeXuat.moDiff(this.deXuatHienTai, this.nhanNguonHienTai);
  }

  /**
   * ★★★ ĐỢT C — BẤM "Ghi vào workspace" (chế độ LOCAL). Đây là lối đi DUY NHẤT tới `apBanVa`.
   *
   * ⚠ Hàng rào chế độ ở LÚC BẤM (không chỉ lúc hiện thẻ) — cùng lý lẽ với `duyetDeXuat`: cái gây
   *   hậu quả là CÚ BẤM. Ở đây hậu quả nặng hơn hẳn: byte rơi trên máy của chính người dùng.
   * ⚠ Luôn `quenDeXuat()` sau một lượt bấm, khác với đường SERVER (nơi lỗi mạng để lại ca "KHÔNG
   *   RÕ KẾT CỤC" đáng thử lại). Ở đây không có ca đó: `apBanVa` hoặc ĐÃ ghi (`ok:true`) hoặc CHƯA
   *   ghi gì (`ok:false`) — nó tự quan sát được cả lượt áp chỉnh sửa lẫn `save`. Điều duy nhất "chưa rõ"
   *   là sổ kiểm toán đã chốt chưa, mà bấm lại KHÔNG chữa được điều đó (lượt sau sẽ gặp băm đã đổi
   *   và bị từ chối đúng như thiết kế). Giữ một cái nút sống trong ca đó chỉ mời người dùng ghi đè
   *   lần hai.
   */
  private async apDungCucBo(): Promise<void> {
    const cb = this.deXuatCucBoHienTai;
    if (!cb) return;
    if (this.cheDoHienTai().loai !== "local") {
      this.quenDeXuat(
        "Dự án đang chọn KHÔNG phải chế độ LOCAL — đã bỏ đề xuất ghi thay vì ghi vào máy bạn. Chọn lại dự án LOCAL rồi hỏi lại.",
      );
      return;
    }
    const cookie = await this.context.secrets.get(KHOA_COOKIE);
    if (!cookie) {
      // KHÔNG quên đề xuất: đăng nhập xong bấm lại là được (băm đĩa chưa đổi thì vẫn hợp lệ).
      void this.panel.webview.postMessage({
        loai: "thong_bao",
        thongDiep:
          "Chưa đăng nhập — sổ kiểm toán nằm trên máy chủ nên KHÔNG ghi khi chưa đăng nhập. Chạy lệnh 'AI Local: Đăng nhập' rồi bấm lại.",
      });
      return;
    }
    const cfg = vscode.workspace.getConfiguration("aviAiLocal");
    let thongDiep: string;
    try {
      const kq = await apBanVa({
        deXuat: cb.deXuat,
        duongTuyetDoi: cb.duongTuyetDoi,
        duongTuongDoi: cb.duongTuongDoi,
        bamGoc: cb.bamGoc,
        thuMucWorkspace: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
        nhanWorkspace: cb.thuMucWorkspace,
        serverUrl: cfg.get<string>("serverUrl", "http://localhost:3000"),
        cookie,
      });
      thongDiep = kq.thongDiep;
    } catch (e) {
      // `apBanVa` đã bọc mọi bước có thể ném; tới đây là lỗi ngoài dự tính. Không đoán kết cục.
      thongDiep = `Lỗi ngoài dự tính khi ghi "${cb.duongTuongDoi}": ${(e as Error).message}. Hãy KIỂM TRA LẠI tệp trước khi hỏi tiếp.`;
    }
    this.quenDeXuat();
    void this.panel.webview.postMessage({ loai: "thong_bao", thongDiep });
  }

  private async duyetDeXuat(): Promise<void> {
    // Đường LOCAL rẽ ở đây và KHÔNG BAO GIỜ chạm phần còn lại của hàm này (`confirmAction` bên
    // dưới là cửa duyệt của chế độ SERVER — spec §7: không đường chéo).
    if (this.deXuatCucBoHienTai) {
      await this.apDungCucBo();
      return;
    }
    const d = this.deXuatHienTai;
    if (!d) return;
    /**
     * ★★★ HÀNG RÀO CHẾ ĐỘ Ở LÚC BẤM, KHÔNG CHỈ Ở LÚC HIỆN. `xuLyDeXuat` kiểm `coDuocHienTheDuyet`
     * khi VẼ thẻ; hàm này trước đây kiểm lại KHÔNG GÌ CẢ. Một cổng chỉ canh lúc hiển thị là một
     * cổng canh sai thời điểm: cái gây hậu quả là CÚ BẤM, và giữa lúc vẽ với lúc bấm có thể có một
     * lần đổi ô chọn dự án. Nay ô chọn đổi thì thẻ bị vứt (xem `quenDeXuat`), nên nhánh này gần như
     * không tới được — giữ nó vì "gần như" không phải một hàng rào, và giá của nó là bốn dòng.
     */
    if (!coDuocHienTheDuyet(this.cheDoHienTai().loai)) {
      this.quenDeXuat(
        "Dự án đang chọn KHÔNG phải chế độ SERVER — đã bỏ đề xuất ghi thay vì duyệt nó. Chọn lại dự án SERVER rồi hỏi lại.",
      );
      return;
    }
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
    /** Giữ đề xuất lại để người dùng thử lại — chỉ bật ở ca KHÔNG BIẾT KẾT CỤC (xem `catch`). */
    let giuDeXuat = false;
    try {
      // Điểm DUY NHẤT trong extension gọi confirmAction — xem ../mang/duyetGhi.ts.
      const kq = await goiDuyet(serverUrl, cookie, d.actionId, d.token);
      if (!kq.ok) {
        // (1) Máy chủ TỪ CHỐI lượt duyệt qua HTTP 200 (hết hạn TTL, token lệch, trạng thái sai...)
        // — `goiDuyet` không ném cho các ca đó. Hiện NGUYÊN VĂN lý do của máy chủ, không bịa.
        thongDiep = kq.message ?? "Máy chủ từ chối lượt duyệt.";
      } else if (daBiTuChoiGhi(kq.result)) {
        // (2) ★★★ `ok:true` CHỈ nói "vòng đời HITL đã chạy xong" — KHÔNG nói "byte đã được ghi".
        // Băm neo lệch (BASE_MISMATCH) hay tệp bẩn (FILE_DIRTY) khiến `execute()` TỪ CHỐI ghi ĐÚNG
        // NHƯ THIẾT KẾ, nhưng `confirmAction` vẫn trả `status:"executed"` — sự thật nằm ở `note`
        // của `ToolResult` (`kq.result`), đọc bằng ĐÚNG vị từ dùng chung
        // `shared/aiCodingLoop.daBiTuChoiGhi` (đã cắn CLI 2026-08-23 và WEB trước khi tới đây —
        // extension là nơi gọi THỨ TƯ, KHÔNG viết lại phép kiểm `note`).
        const ma = maTuChoiGhi(kq.result);
        thongDiep = `CHƯA GHI [${ma}] — tệp đã đổi kể từ lúc đề xuất. Hãy yêu cầu lại.`;
      } else if (kq.status === "executed" && kq.message) {
        // Máy chủ LUÔN trả `status:"executed"` cho một lượt confirm `ok:true` thành công (kể cả
        // lần đầu, `aiCopilotActions.ts:940`) — dùng NGUYÊN VĂN message của máy chủ ("Đã thực thi."
        // / "Đã thực thi trước đó.") thay vì tự bịa câu khác, vì hai câu đó phân biệt lần-đầu với
        // lặp-lại mà một câu tự soạn không phân biệt được.
        thongDiep = kq.message;
      } else {
        // (3) `ok:true`, KHÔNG bị từ chối ghi, và máy chủ không kèm message riêng — mới được nói
        // đã ghi.
        thongDiep = `Đã duyệt — máy chủ đã ghi "${d.path}".`;
      }
    } catch (e) {
      /**
       * ★★★ HỎNG ĐƯỜNG TRUYỀN **KHÔNG PHẢI** "THẤT BẠI" — NÓ LÀ **KHÔNG BIẾT**.
       *
       * `fetch` ném khi không dựng nổi/không đọc hết được đáp ứng: mất mạng, máy chủ chết, **hoặc
       * quá hạn chờ SAU KHI máy chủ đã nhận, đã chạy `execute()` và đã ghi byte xuống đĩa**. Ba ca
       * đó không phân biệt được từ phía này. Khai "Duyệt thất bại" là chọn MỘT trong ba rồi trình
       * bày nó như sự thật — đúng cái tật mà cả Đợt B đi vá: KHAI KẾT CỤC MÀ KHÔNG ĐỌC KẾT CỤC.
       *
       * ⚠⚠ Và nặng hơn lời khai sai: bản cũ `quen()` đề xuất ngay sau đó, xoá `deXuatHienTai` và ẩn
       *   thẻ — **phá mất đường duy nhất để BIẾT**. `confirmAction` là idempotent theo thiết kế (một
       *   hàng đã có kết cục chung cục trả kết quả ĐÃ LƯU, KHÔNG chạy `execute()` lần hai), nên bấm
       *   Duyệt lại vừa an toàn vừa là cách hỏi máy chủ "rốt cuộc lượt kia ra sao?". Giữ đề xuất.
       */
      giuDeXuat = true;
      thongDiep =
        `KHÔNG RÕ KẾT CỤC — không nhận được trả lời của máy chủ (${(e as Error).message}). ` +
        `Lượt ghi CÓ THỂ đã xong trên máy chủ, cũng có thể chưa: từ đây không phân biệt được. ` +
        `Bấm "Duyệt & ghi trên SERVER" lần nữa là AN TOÀN — máy chủ xử lý idempotent, nếu lượt trước đã ` +
        `xong nó trả lại kết quả đã lưu chứ KHÔNG ghi lần hai. Thẻ duyệt được giữ nguyên để bạn thử lại.`;
    }
    if (!giuDeXuat) this.quenDeXuat();
    void this.panel.webview.postMessage({ loai: "thong_bao", thongDiep });
  }

  private async huyDeXuat(): Promise<void> {
    // Đề xuất CỤC BỘ chỉ sống trong bộ nhớ extension — chưa có hàng nào trên máy chủ để huỷ (hàng
    // kiểm toán chỉ sinh ra ở bước 6 của `apBanVa`, tức khi người dùng bấm GHI). Vứt tại chỗ.
    if (this.deXuatCucBoHienTai) {
      this.quenDeXuat(`Đã bỏ đề xuất sửa "${this.deXuatCucBoHienTai.duongTuongDoi}" — không có gì được ghi.`);
      return;
    }
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
    /** Giữ đề xuất lại để người dùng thử lại — chỉ bật ở ca KHÔNG BIẾT KẾT CỤC (xem `catch`). */
    let giuDeXuat = false;
    try {
      const kq = await goiHuy(serverUrl, cookie, d.actionId);
      // `cancelAction` cũng TỪ CHỐI qua HTTP 200 (đã thực thi trước đó, trạng thái sai...) —
      // `aiCopilotActions.ts:944-969` cùng hình dạng {ok,status,message} như confirmAction.
      thongDiep = kq.ok
        ? `Đã huỷ đề xuất sửa "${d.path}" — không có gì được ghi.`
        : (kq.message ?? "Máy chủ từ chối lượt huỷ.");
    } catch (e) {
      /**
       * ★ Cùng lý lẽ với `duyetDeXuat`: `fetch` ném ⇒ KHÔNG BIẾT lượt huỷ có tới máy chủ hay không.
       * Ở đây hậu quả nhẹ hơn (huỷ không ghi byte nào) nhưng lời khai vẫn phải đúng: nếu huỷ CHƯA
       * tới nơi thì đề xuất vẫn SỐNG trên máy chủ tới hết TTL, và người dùng cần biết điều đó cùng
       * cách xử lý. Giữ thẻ để bấm Huỷ lại được — vứt thẻ ở đây là bỏ mặc một đề xuất còn hiệu lực.
       */
      giuDeXuat = true;
      thongDiep =
        `KHÔNG RÕ KẾT CỤC — không nhận được trả lời của máy chủ (${(e as Error).message}). ` +
        `Lượt huỷ có thể đã tới nơi, cũng có thể chưa; nếu chưa thì đề xuất vẫn còn hiệu lực trên máy chủ ` +
        `cho tới khi hết hạn. Bấm "Huỷ" lần nữa là an toàn. Thẻ duyệt được giữ nguyên để bạn thử lại.`;
    }
    if (!giuDeXuat) this.quenDeXuat();
    void this.panel.webview.postMessage({ loai: "thong_bao", thongDiep });
  }
}
