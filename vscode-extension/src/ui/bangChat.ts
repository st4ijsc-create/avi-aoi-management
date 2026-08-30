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
import { existsSync } from "node:fs";
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
import { coDuocHienTheDuyet, suyCheDo } from "../loi/kiemTraCheDo";
import { goiDuyet, goiHuy, daBiTuChoiGhi, maTuChoiGhi } from "../mang/duyetGhi";
import type { KhoDeXuat } from "./diffDeXuat";
import { docDeXuatCucBo, type DeXuatCucBo } from "../loi/deXuatCucBo";
import { ghepBanVa } from "../loi/ghepBanVa";
import { bamNoiDung } from "../loi/bamTep";
import { duocPhepGhi, duongTuongDoiTrongWorkspace, giaiDuongDeXuat } from "../loi/chanGhi";
import { giaiDuongThat } from "../loi/duongThat";
import { nhanNguonTheDuyet, nhanNutGhi } from "../loi/nhanTheDuyet";
import { apBanVa } from "./apBanVa";
// ★★★ ĐỢT D / TASK 3 — vòng lặp tác nhân: model tự đọc mã (ba tool CHỈ ĐỌC của Task 2) TRƯỚC khi
// đề xuất sửa. `buocKeTiep` (THUẦN, có lưới riêng) là nơi quyết định DUY NHẤT dừng/tiếp; tệp này
// chỉ THỰC THI quyết định đó (gọi model, chạy tool, hiện tiến độ) — xem docblock `vongTacNhan.ts`.
import { docYeuCauDoc, type YeuCauDoc } from "../loi/yeuCauDoc";
import { chayToolCucBo, danhSachTepGoiY } from "../mang/toolCucBo";
import { buocKeTiep } from "../loi/vongTacNhan";
import { TRAN_VONG_MAC_DINH } from "../../../shared/aiCodingLoop";
// ★★★ PDCA vòng 2 — thay JSON thô bằng câu tiếng Việt khi vòng lặp dừng vì het_tran giữa lúc còn
// khối `avi-tool` dở dang (T09, `pdca1-report.md`). Xem docblock `khoiDoDang.ts`.
import { vanBanHetTranConDoDang } from "../loi/khoiDoDang";
// ★★★ PDCA vòng 2 (round 2, `pdca3-report.md`) — MỞ RỘNG bản vá trên: không chỉ khối DỞ DANG ở
// vòng CUỐI, mà khối ĐÃ THỰC THI ở BẤT KỲ vòng nào trước đó cũng phải bị lọc khỏi văn bản người
// dùng THẤY (webview tích luỹ token của MỌI vòng, không riêng vòng cuối). Xem docblock
// `xoaRacGiaoThuc.ts`.
import { vanBanKhongRacGiaoThuc } from "../loi/xoaRacGiaoThuc";
// ★★★ ĐỢT D / TASK 5 — @-mention: gõ "@" trong ô nhập, chọn một tệp, tệp đó được đọc qua ĐÚNG
// đường tool `doc_tep` (Task 2/3) — không dựng một đường đọc riêng. `locDanhSachMention` (THUẦN)
// lọc danh sách theo chữ đang gõ; xem docblock của nó cho vì sao KHÔNG chạm ký tự `@`.
import { locDanhSachMention } from "../loi/locMention";

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

/** Nhãn NGƯỜI ĐỌC ĐƯỢC cho một yêu cầu đọc — dùng để báo tiến độ "đang làm gì" (Task 3). */
function nhanYeuCauDoc(y: YeuCauDoc): string {
  if (y.loai === "doc_tep") return `đọc tệp "${y.path}"`;
  if (y.loai === "liet_ke") return `liệt kê thư mục "${y.path}"`;
  return y.path ? `tìm "${y.mau}" trong "${y.path}"` : `tìm "${y.mau}"`;
}

/**
 * Câu báo khi vòng lặp tác nhân DỪNG vì một lý do KHÔNG PHẢI "xong việc bình thường". `khong_con_tool`
 * (model trả lời suông, hết yêu cầu đọc) KHÔNG có câu — đó là đường hạnh phúc, báo thêm là làm ồn
 * cho một việc đúng như mong đợi.
 *
 * ★★★ TASK 4 — hàm này giờ được gọi từ HAI nơi cho `lyDo === "nguoi_dung_dung"`: (1) huỷ GIỮA HAI
 * vòng — `biHuy` được `buocKeTiep` đọc SAU khi một lượt SSE đã đóng bình thường (chỉ ở LOCAL); (2)
 * huỷ GIỮA MỘT vòng đang bay — `AbortError` bắt ở `catch` ngoài của `hoi()` (có thể ở CẢ LOCAL lẫn
 * SERVER, xem đó). Cả hai đường đều phải NÓI RÕ dừng ở vòng mấy — bản cũ chỉ nói "Đã dừng vòng đọc
 * tự động theo yêu cầu." không kèm số vòng, đủ cho ca (1) (chỉ có một cách hiểu) nhưng KHÔNG đủ cho
 * ca (2) (người dùng không biết model đã kịp đọc xong bao nhiêu lượt trước khi bị cắt).
 */
function nhanLyDoDungVong(lyDo: "het_tran" | "nguoi_dung_dung" | "loi", vong: number): string {
  if (lyDo === "het_tran") {
    return (
      `Vòng đọc tự động dừng ở lượt ${vong}/${TRAN_VONG_MAC_DINH} vì đã chạm trần — model có thể ` +
      "vẫn còn muốn đọc thêm. Hỏi lại nếu cần tiếp tục."
    );
  }
  if (lyDo === "nguoi_dung_dung") return `Đã dừng theo yêu cầu — ở vòng ${vong}.`;
  return `Vòng đọc tự động dừng ở lượt ${vong}/${TRAN_VONG_MAC_DINH} vì máy chủ báo lỗi giữa chừng.`;
}

/**
 * ★★★ TASK 4 — lý do huỷ khi CHÍNH người dùng bấm nút Dừng, gắn vào `AbortController.abort(reason)`.
 * Khác với huỷ NGẦM ở đầu `hoi()` (một câu hỏi MỚI đè lên câu cũ, `this.huy?.abort()` KHÔNG kèm lý
 * do) — `catch` của `hoi()` đọc `reason` này để quyết định có báo "đã dừng" cho người dùng hay
 * không: huỷ ngầm vì câu hỏi mới không phải một lượt DỪNG, báo ở đó là bong bóng lạc giữa một câu
 * hỏi hoàn toàn khác (đúng lớp lỗi Đợt A đã trả giá — xem docblock ở `catch` bên dưới).
 * Trùng chữ CÓ CHỦ Ý với `lyDo: "nguoi_dung_dung"` của `BuocVong` (`vongTacNhan.ts`) — một từ vựng
 * DUY NHẤT cho "người dùng chủ động dừng", dùng ở cả quyết định vòng lặp lẫn quyết định thực thi.
 */
const LY_DO_NGUOI_DUNG_DUNG = "nguoi_dung_dung";

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
  // ★★★ CMD+K (Task 7) — cờ + hàng đợi cho `guiCauHoiTuLenh`. `daSanSang` bật NGAY khi webview báo
  // "san_sang" (tức đã đăng ký `addEventListener("message", …)" — xem cảnh báo đua ở constructor
  // dưới đây), KHÔNG đợi `napDuAn()` xong: đó là hai việc khác nhau (webview nhận được postMessage
  // vs. danh sách dự án đã nạp). Một câu hỏi bắn tới TRƯỚC khi báo "san_sang" (bảng vừa được tạo,
  // Cmd+K bấm ngay sau khi mở) sẽ rơi mất nếu gửi thẳng — xếp hàng ở đây rồi bắn lại lúc "san_sang".
  private daSanSang = false;
  private cauHoiChoGui: string | undefined;
  // ★★★ TASK 5 — bộ nhớ đệm danh sách tệp gợi ý @-mention CỦA DỰ ÁN ĐANG CHỌN. `undefined` nghĩa là
  // "chưa nạp" (nạp LƯỜI ở lượt gõ "@" ĐẦU TIÊN, không quét cả workspace ngay lúc mở bảng — quét là
  // một lượt `findFiles` đệ quy, không đáng trả giá cho một tính năng có thể không ai dùng tới).
  // Đổi dự án PHẢI xoá bộ nhớ đệm này (xem nhánh `doi_du_an` trong constructor) — danh sách tệp của
  // dự án CŨ mà hiện ra dropdown của dự án MỚI là gợi ý sai workspace.
  private dsTepMention: string[] | undefined;

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
    this.panel.webview.onDidReceiveMessage(
      (m: {
        loai: string;
        cauHoi?: string;
        duAnId?: string;
        truy?: string;
        tepMention?: unknown;
        // ★★★ H3(b) — webview đặt cờ này TRUE khi câu hỏi vừa gửi đến từ `dat_cau_hoi_tu_lenh`
        // (Cmd+K), xem `htmlBang.ts`. Đây là cách DUY NHẤT `hoi()` biết một lượt hỏi có mang giao
        // thức Cmd+K hay không — nội dung `cauHoi` tới đây trông giống hệt một câu gõ tay.
        tuLenh?: unknown;
      }) => {
      if (m.loai === "san_sang") {
        this.daSanSang = true;
        void this.napDuAn();
        this.guiCauHoiDangCho();
        return;
      }
      // ★★★ ĐỔI DỰ ÁN ⇒ VỨT ĐỀ XUẤT ĐANG CHỜ. Thẻ duyệt mang nhãn nguồn của dự án nó SINH RA; để
      // nó sống qua một lần đổi ô chọn là chìa nút "Duyệt & ghi trên SERVER" cho một người đang
      // nhìn tên dự án KHÁC — đúng loại tai nạn không cứu được mà spec §7 nói tới. Đề xuất cũ vẫn
      // còn trên máy chủ tới hết TTL và có thể hỏi lại; cái ta bỏ chỉ là CÚ BẤM.
      if (m.duAnId && m.duAnId !== this.duAnChon) {
        this.duAnChon = m.duAnId;
        this.quenDeXuat("Đã đổi dự án — đề xuất ghi đang chờ đã được bỏ. Hãy hỏi lại nếu vẫn cần.");
        // ★★★ TASK 5 — danh sách gợi ý @-mention thuộc về DỰ ÁN CŨ; đổi dự án mà giữ nguyên bộ nhớ
        // đệm sẽ gợi ý tệp của workspace KHÁC. Nạp lại LƯỜI ở lượt gõ "@" kế tiếp (`guiGoiYMention`).
        this.dsTepMention = undefined;
      } else if (m.duAnId) {
        this.duAnChon = m.duAnId;
      }
      if (m.loai === "doi_du_an") return; // chỉ để đồng bộ ô chọn, không kèm hành động nào khác
      if (m.loai === "hoi" && m.cauHoi) {
        const tepMention = Array.isArray(m.tepMention)
          ? m.tepMention.filter((x): x is string => typeof x === "string")
          : [];
        void this.hoi(m.cauHoi, tepMention, m.tuLenh === true);
        return;
      }
      if (m.loai === "xin_goi_y_mention") { void this.guiGoiYMention(typeof m.truy === "string" ? m.truy : ""); return; }
      if (m.loai === "xem_diff") { void this.xemDiff(); return; }
      if (m.loai === "duyet") { void this.duyetDeXuat(); return; }
      if (m.loai === "huy") { void this.huyDeXuat(); return; }
      // ★★★ TASK 4 — nút Dừng. Tên loại tin CỐ Ý khác "huy" (huỷ ĐỀ XUẤT GHI, một khái niệm hoàn
      // toàn khác) — hai nút không được lẫn vào nhau.
      if (m.loai === "dung_hoi") { this.dungVongHienTai(); return; }
    });
  }

  /**
   * Vứt đề xuất đang chờ (nếu có): quên nội dung diff ảo, xoá field, ẩn thẻ. Gom vào MỘT chỗ vì ba
   * nơi gọi (đổi dự án · lượt hỏi mới · sau khi Duyệt/Huỷ xong) từng làm ba việc lệch nhau — và
   * chỗ quên ẩn thẻ để lại một cú bấm SỐNG cho một đề xuất đã chết.
   */
  private quenDeXuat(thongBao?: string): void {
    const actionId = this.deXuatHienTai?.actionId ?? this.deXuatCucBoHienTai?.actionId;
    // ⚠ XOÁ TRẠNG THÁI **VÔ ĐIỀU KIỆN**, TRƯỚC nhánh thoát sớm. Bản cũ `return` ngay khi không có
    // `actionId` và vì thế bỏ lại `nhanNguonHienTai` của lượt TRƯỚC. Nhãn ấy không phải trang trí:
    // `xemDiff()` lấy chính nó làm điều kiện đi tiếp, và nó mang chữ "LOCAL ·"/"SERVER ·" — tức
    // mang CHẾ ĐỘ. Để một mảnh trạng thái chế độ sống sót qua một lượt "quên" là để lại đúng loại
    // mảnh vụn mà cả tệp này đi vá (thẻ/nhãn của lượt cũ dùng cho lượt mới). Giá của việc xoá là 0.
    this.deXuatHienTai = undefined;
    this.deXuatCucBoHienTai = undefined;
    this.nhanNguonHienTai = undefined;
    // Không có đề xuất nào ⇒ không có thẻ để ẩn và không có gì để báo (thoát SAU khi đã xoá sạch).
    if (!actionId) return;
    this.khoDeXuat.quen(actionId);
    void this.panel.webview.postMessage({ loai: "an_the_duyet" });
    if (thongBao) void this.panel.webview.postMessage({ loai: "thong_bao", thongDiep: thongBao });
  }

  /** Thư mục LOCAL đang chọn ở ô dự án (`local:<fsPath>`), rơi về thư mục workspace đầu tiên. */
  private thuMucLocalDangChon(): string | undefined {
    if (this.duAnChon?.startsWith("local:")) return this.duAnChon.slice("local:".length);
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /**
   * ★★★ TASK 3 — gốc cho BA TOOL ĐỌC (`chayToolCucBo`). Thư mục ĐANG CHỌN đứng ĐẦU: `chayToolCucBo`
   * coi phần tử đầu của mảng là gốc ƯU TIÊN khi một đường model khai khớp nhiều gốc (workspace đa
   * thư mục) — cùng quy ước với `giaiDuongDeXuat` ở đường GHI (`xuLyDeXuatCucBo` bên dưới). Các thư
   * mục workspace CÒN LẠI theo sau làm gốc dự phòng, không phải bị bỏ qua.
   */
  private dsGocDoc(): string[] {
    const goc = this.thuMucHoiHienTai;
    const tatCa = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    return goc ? [goc, ...tatCa.filter((p) => p !== goc)] : tatCa;
  }

  /**
   * ★★★ TASK 5 — gốc cho danh sách gợi ý @-mention. CÙNG HÌNH DẠNG với `dsGocDoc()` (gốc ĐANG CHỌN
   * đứng đầu, các gốc workspace còn lại theo sau) nhưng KHÔNG THỂ dùng `dsGocDoc()` trực tiếp: gõ
   * "@" xảy ra TRONG LÚC GÕ, TRƯỚC khi có lượt hỏi nào chạy, nên `this.thuMucHoiHienTai` (chỉ được
   * chốt bên trong `hoi()`) còn `undefined`. Dùng `thuMucLocalDangChon()` — đọc thẳng `duAnChon`,
   * có giá trị BẤT KỲ LÚC NÀO, không cần một lượt hỏi đang chạy.
   *
   * ⚠⚠ PHẢI GIẢI ĐƯỜNG THẬT Ở ĐÂY — khác `dsGocDoc()` (nơi giữ nguyên đường CHƯA giải, vì
   * `chayToolCucBo` tự giải lại bên trong `chayThat`/`gocDaGiai` cho MỌI lời gọi ba tool đọc).
   * `danhSachTepGoiY` (dùng trực tiếp `locUngVien`, không đi qua `chayThat`) mang đúng tên tham số
   * `gocThat` như các hàm nội bộ khác của `mang/toolCucBo.ts` — tức nó GIẢ ĐỊNH gốc ĐÃ giải, giống
   * hệt quy ước nội bộ của tệp đó. Gốc CHƯA giải ở đây không mở lỗ rò (một đích RA NGOÀI vẫn bị
   * `namTrongThuMuc` từ chối vì so lệch hệ quy chiếu), nhưng làm MỌI tệp trong một workspace là
   * junction/symlink bị loại NHẦM khỏi gợi ý — mất chức năng ÂM THẦM, đúng lớp lỗi mà
   * `duongTuongDoiTrongWorkspace`/`gocDaGiai` được dựng ra để tránh.
   */
  private dsGocMention(): string[] {
    const goc = this.thuMucLocalDangChon();
    const tatCa = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const raw = goc ? [goc, ...tatCa.filter((p) => p !== goc)] : tatCa;
    const ra: string[] = [];
    for (const p of raw) {
      const r = giaiDuongThat(p);
      if (r.ok) ra.push(r.duong);
    }
    return ra;
  }

  /**
   * ★★★ TASK 5 — trả lời webview cho một lượt gõ "@..." — nạp (LƯỜI, chỉ MỘT lần cho tới khi đổi
   * dự án) danh sách tệp GỢI Ý đã qua hàng rào gửi (`danhSachTepGoiY`, tái dùng `locUngVien`), rồi
   * lọc THEO CHỮ đang gõ bằng vị từ THUẦN `locDanhSachMention`. Extension quyết định NỘI DUNG dropdown
   * — webview chỉ hiển thị, đúng nguyên tắc đã áp cho thẻ duyệt.
   */
  private async guiGoiYMention(truy: string): Promise<void> {
    if (!this.dsTepMention) {
      this.dsTepMention = await danhSachTepGoiY(this.dsGocMention());
    }
    void this.panel.webview.postMessage({
      loai: "goi_y_mention",
      ds: locDanhSachMention(this.dsTepMention, truy),
    });
  }

  /**
   * CHẾ ĐỘ suy từ ô chọn dự án ĐANG hiển thị. Một chỗ duy nhất — `hoi()`, `apDungCucBo()` và
   * `duyetDeXuat()` đều hỏi cùng câu này, nên hàng rào lúc HIỆN thẻ và hàng rào lúc BẤM không thể
   * lệch nhau.
   *
   * ⚠⚠⚠ TRẢ `undefined` KHI KHÔNG XÁC ĐỊNH ĐƯỢC — quyết định THUẦN nằm ở `loi/kiemTraCheDo.suyCheDo`
   * (có lưới riêng). Bản cũ rơi về `{loai:"local", nhan:"workspace"}` khi danh sách dự án rỗng hoặc
   * chưa nạp xong, tức đoán đúng cái nhánh có hậu quả nặng nhất: LOCAL là chế độ **extension tự
   * cưỡng chế** và là chế độ mở cửa ghi vào đĩa máy dev. Mọi nơi gọi dưới đây PHẢI xử lý `undefined`
   * bằng cách TỪ CHỐI, không bằng một giá trị mặc định.
   */
  private cheDoHienTai(): CheDoDuAn | undefined {
    return suyCheDo(this.dsDuAn, this.duAnChon);
  }

  static moHoacHien(context: vscode.ExtensionContext, khoDeXuat: KhoDeXuat): BangChat {
    if (BangChat.hienTai) {
      BangChat.hienTai.panel.reveal();
      return BangChat.hienTai;
    }
    const panel = vscode.window.createWebviewPanel(
      "aviAiLocalChat",
      "AI Local",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    BangChat.hienTai = new BangChat(panel, context, khoDeXuat);
    return BangChat.hienTai;
  }

  /**
   * Bắn câu hỏi CMD+K đang xếp hàng (nếu có) — CHỈ được gọi sau khi webview đã báo "san_sang", tức
   * ĐÃ đăng ký xong `addEventListener("message", …)`. Gọi sớm hơn thì `postMessage` có thể tới
   * TRƯỚC khi script kịp lắng nghe và rơi mất trong im lặng — đúng lỗi đua mà `napDuAn` ở trên đã
   * né bằng cùng một cách (đợi "san_sang").
   */
  private guiCauHoiDangCho(): void {
    const c = this.cauHoiChoGui;
    if (!c) return;
    this.cauHoiChoGui = undefined;
    void this.panel.webview.postMessage({ loai: "dat_cau_hoi_tu_lenh", cauHoi: c });
  }

  /**
   * ★★★ CMD+K (Task 7) — LỐI VÀO DUY NHẤT được `extension.ts` gọi khi người dùng bấm `ctrl+alt+k`.
   *
   * ⚠⚠⚠ KHÔNG ĐƯỜNG GHI MỚI Ở ĐÂY. Hàm này KHÔNG gọi `hoi()` trực tiếp — nó `postMessage` cho
   * WEBVIEW tự đổ câu hỏi vào ô nhập rồi tự bấm nút "Gửi" (hàm `gui()` trong `htmlBang.ts`), và
   * chính `gui()` mới `postMessage({loai:"hoi"})` NGƯỢC lại cho `onDidReceiveMessage` ở constructor
   * — CÙNG một handler xử lý một cú gõ tay bình thường. Lý do bắt buộc phải vòng qua webview thay
   * vì gọi thẳng `this.hoi(cauHoi)`: `gui()` phía webview là nơi DUY NHẤT tạo bong bóng "Bạn: …" VÀ
   * gán `khoiTraLoi` (khối DOM nhận token stream) — gọi thẳng `hoi()` từ đây thì `khoiTraLoi` vẫn
   * `null`, token stream tới nơi nhưng KHÔNG CÓ CHỖ ĐỂ GHI, và câu trả lời rơi mất trên giao diện
   * một cách im lặng dù mọi thứ phía sau (SSE, `docDeXuatCucBo`, thẻ duyệt, `apBanVa`) vẫn chạy
   * đúng. Từ `gui()` trở đi, đường đi giống hệt một câu người dùng tự gõ — không có nhánh tắt nào.
   */
  public guiCauHoiTuLenh(cauHoi: string): void {
    if (this.daSanSang) {
      void this.panel.webview.postMessage({ loai: "dat_cau_hoi_tu_lenh", cauHoi });
      return;
    }
    // Bảng vừa mới tạo, webview chưa kịp báo "san_sang" — xếp hàng, `guiCauHoiDangCho` sẽ bắn khi
    // tín hiệu đó tới (xem nhánh `san_sang` trong constructor).
    this.cauHoiChoGui = cauHoi;
  }

  private thuThapNguCanh(): string {
    const cfg = vscode.workspace.getConfiguration("aviAiLocal");
    const nganSach = cfg.get<number>("nganSachNguCanh", 24000);
    const ed = vscode.window.activeTextEditor;
    if (!ed) return dungNguCanh({ nganSach });

    // ★★★ F3 — CÙNG cách neo với Cmd+K và với đường ghi. `asRelativePath` thêm TÊN THƯ MỤC làm tiền
    // tố khi workspace có ≥2 thư mục; model đọc ngữ cảnh rồi chép lại chính đường ấy vào `path` của
    // đề xuất, nên một tiền tố ở ĐÂY cũng đi thẳng vào đường ghi. Rơi về `asRelativePath` khi tệp
    // nằm ngoài mọi workspace: ngữ cảnh chỉ để ĐỌC, và một đề xuất ghi vào đó sẽ bị luật 2 chặn.
    const viTri = duongTuongDoiTrongWorkspace(
      ed.document.uri.fsPath,
      (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    );
    const duong = viTri?.duongTuongDoi ?? vscode.workspace.asRelativePath(ed.document.uri);
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

  /**
   * ★★★ TASK 4 — NÚT DỪNG phải cắt CẢ HAI: luồng SSE đang bay VÀ vòng lặp tác nhân (Task 3).
   *
   * MỘT lời gọi `abort()` đã làm cả hai, không cần một cờ RIÊNG cho vòng lặp: `moDongSse` nhận
   * chính `AbortSignal` này làm `tinHieu` (cắt SSE — fetch/đọc luồng ném `AbortError`), VÀ vòng lặp
   * đọc `biHuy: dieuKhien.signal.aborted` ở cuối MỖI vòng (`hoi()`, xem lời gọi `buocKeTiep`) — hai
   * chỗ đọc CÙNG một `signal.aborted`, không phải hai cờ có thể trôi khỏi nhau.
   *
   * `this.huy` LUÔN là bộ điều khiển của lượt hỏi ĐANG CHẠY (một câu hỏi mới thay `this.huy` bằng
   * bộ điều khiển KHÁC và tự huỷ bộ cũ — xem đầu `hoi()`), nên `abort()` ở đây luôn nhắm ĐÚNG lượt
   * người dùng đang nhìn thấy trên giao diện, không bao giờ nhắm nhầm một lượt đã chết từ trước.
   *
   * `reason = LY_DO_NGUOI_DUNG_DUNG` — PHẢI kèm lý do (khác `abort()` trần dùng cho huỷ NGẦM ở đầu
   * `hoi()`): `catch` của `hoi()` đọc `dieuKhien.signal.reason` để phân biệt "người dùng bấm Dừng"
   * (phải báo "đã dừng") với "câu hỏi mới đè lên câu cũ" (im lặng, đúng hành vi đã có từ Đợt A).
   */
  private dungVongHienTai(): void {
    this.huy?.abort(LY_DO_NGUOI_DUNG_DUNG);
  }

  /**
   * `tepMention` — ĐỢT D / TASK 5: đường dẫn (tương đối, SẠCH — không kèm `@`) người dùng đã chọn
   * qua dropdown @-mention trong CHÍNH lượt hỏi này. Nội dung của chúng đi qua ĐÚNG tool `doc_tep`
   * (Task 2/3) trước khi vào ngữ cảnh — xem đoạn xử lý ngay dưới `nguCanhVong` bên dưới.
   *
   * `laCmdK` — ★★★ H3(b) (review toàn nhánh 2026-08-30): `true` khi lượt hỏi này bắt nguồn từ
   * Cmd+K (webview đặt cờ `tuLenh` khi đáp lại `dat_cau_hoi_tu_lenh`, xem `htmlBang.ts` +
   * `onDidReceiveMessage` ở constructor). Thread THẲNG xuống MỌI lượt gọi `dungYeuCauStream` bên
   * dưới (kể cả các vòng đọc ≥2 của CHÍNH lượt hỏi này) để giao thức dạy-đọc không bao giờ chèn vào
   * một câu hỏi mang giao thức Cmd+K — hai giao thức cạnh tranh trong cùng một `question` khiến
   * model chọn đọc trước và nuốt mất chỉ dẫn `de_xuat_sua_doan`, Cmd+K im lặng không đẻ thẻ duyệt.
   */
  private async hoi(cauHoi: string, tepMention: string[] = [], laCmdK = false): Promise<void> {
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
    if (!cheDo) {
      // FAIL-CLOSED: không biết lượt này ghi ở đâu thì KHÔNG hỏi. Bỏ qua đây là để một lượt trả lời
      // đẻ ra thẻ duyệt mang chế độ ĐOÁN — và thẻ ấy là thứ chìa cho người dùng một cú bấm ghi đĩa.
      void this.panel.webview.postMessage({
        loai: "loi",
        thongDiep:
          "Chưa xác định được dự án đang chọn (danh sách dự án rỗng hoặc chưa nạp xong) — KHÔNG hỏi, " +
          "vì chế độ quyết định byte sẽ rơi ở SERVER hay trên máy bạn. Hãy chọn lại dự án rồi hỏi lại.",
      });
      return;
    }
    // Chốt CHẾ ĐỘ của lượt này NGAY BÂY GIỜ — `nhan` bên dưới (chạy trong cùng lượt) đọc lại field
    // này, không đọc `this.duAnChon` trực tiếp, để không lệch nếu người dùng đổi ô chọn giữa chừng.
    this.cheDoHoiHienTai = cheDo;
    this.thuMucHoiHienTai = cheDo.loai === "local" ? this.thuMucLocalDangChon() : undefined;

    this.huy?.abort();
    // ★★★ TASK 3 — bộ điều khiển huỷ CỦA RIÊNG lượt hỏi này, giữ trong một biến CỤC BỘ chứ không
    // đọc lại `this.huy` bên trong vòng lặp bên dưới: một lượt hỏi MỚI khởi động giữa chừng (người
    // dùng gõ câu khác) thay `this.huy` bằng một `AbortController` KHÁC — đọc `this.huy.signal`
    // lúc đó sẽ đọc NHẦM sang bộ điều khiển mới (`aborted` luôn `false`) thay vì bộ điều khiển của
    // CHÍNH lượt vòng lặp đang chạy, và người dùng bấm-huỷ-mà-vòng-vẫn-chạy đúng lỗi Task 3 phải vá.
    const dieuKhien = new AbortController();
    this.huy = dieuKhien;

    // ★★★ TASK 3 — VÒNG LẶP TÁC NHÂN: model trả lời → có yêu cầu đọc (`doc_tep`/`liet_ke`/`grep`,
    // Task 1/2) ⇒ chạy `chayToolCucBo` → nối kết quả thành lượt hỏi KẾ TIẾP ("KẾT QUẢ TOOL") → hỏi
    // lại, tới khi hết yêu cầu đọc hoặc chạm trần `TRAN_VONG_MAC_DINH`. `buocKeTiep`
    // (`loi/vongTacNhan.ts`, THUẦN, có lưới riêng) là nơi quyết định DUY NHẤT dừng/tiếp — KHÔNG rải
    // thêm điều kiện dừng ở đây, đúng ranh giới "quyết định THUẦN vs thực thi" mà tệp đó dựng ra.
    // CHỈ chạy ở chế độ LOCAL: SERVER đã có vòng tool CỦA NÓ chạy trên hộp cát máy chủ (xem
    // docblock `dungYeuCauStream`) — vòng NÀY sẽ hỏi ĐÈ lên đó nếu bật nhầm chế độ.
    let lichSuVong: LuotChat[] = [...this.lichSu];
    let cauHoiVong = cauHoi;
    let nguCanhVong: string | undefined = this.thuThapNguCanh();
    /**
     * ★★★ TASK 5 — nội dung tệp @-mention. Đọc qua ĐÚNG `chayToolCucBo({loai:"doc_tep"})` — cùng
     * hàm, cùng hàng rào (`duocPhepDoc`/`duocPhepRoiMay`), cùng phép che (`cheBiMat` trong
     * `dinhDangDocTep`) mà ba tool đọc của Task 2/3 dùng. KHÔNG dựng một đường đọc RIÊNG cho
     * @-mention — đây là một đường dữ liệu RỜI MÁY (nội dung tệp đi kèm câu hỏi gửi lên máy chủ),
     * và một đường đọc thứ hai là đúng "cửa sau" mà Task 5 bị cấm mở.
     * ⚠ Chạy TRƯỚC vòng lặp, chỉ MỘT LẦN, bất kể chế độ LOCAL/SERVER: đây là ngữ cảnh của CÂU HỎI
     *   GỐC, không phải một yêu cầu đọc phát sinh giữa vòng lặp tác nhân.
     */
    if (tepMention.length > 0) {
      const dsGocMention = this.dsGocDoc();
      const doanMention: string[] = [];
      for (const duong of tepMention) {
        const kq = await chayToolCucBo({ loai: "doc_tep", path: duong }, dsGocMention);
        doanMention.push(kq.ok ? kq.ketQua : `--- @${duong}: KHÔNG đọc được — ${kq.lyDo} ---`);
      }
      nguCanhVong = `${nguCanhVong ?? ""}\n${doanMention.join("\n\n")}`;
    }
    let traLoiCuoi = "";
    // ★★★ PDCA vòng 2 (round 2, `pdca3-report.md`) — nối NGUYÊN VĂN `traLoiCuoi` của MỌI vòng, KHÔNG
    // dấu phân cách — đúng những gì webview ĐÃ hiển thị SỐNG qua các `postMessage({loai:"token"})`
    // ở trên (khớp `khoiTraLoi.textContent += m.chu` của `htmlBang.ts`). Dùng để lọc rác giao thức
    // khỏi TOÀN BỘ văn bản đã stream khi lượt hỏi kết thúc, không chỉ vòng CUỐI — xem
    // `loi/xoaRacGiaoThuc.ts` cho lý do (5/6 tác vụ ĐẠT của PDCA vòng 1 lộ khối ĐÃ THỰC THI của
    // những vòng KHÔNG PHẢI vòng cuối, vì webview không hề xoá gì giữa các vòng).
    let vanBanTichLuy = "";
    let canhBaoCuoi: string | null = null;
    let degradedCuoi = false;
    let vong = 0;
    // ★★★ PDCA vòng 2 — thay JSON thô bằng câu tiếng Việt khi vòng lặp dừng vì HẾT TRẦN đúng lúc
    // câu trả lời cuối còn khối `avi-tool` dở dang (xem `loi/khoiDoDang.ts`). CHỈ nhánh `het_tran`
    // set biến này; `khong_con_tool`/`nguoi_dung_dung`/`loi` KHÔNG đụng tới ⇒ hành vi hai nhánh đó
    // giữ NGUYÊN. `null` nghĩa là "không thay gì" — fallback cũ (`degradedCuoi ? traLoiCuoi : null`)
    // ở dưới vẫn áp dụng, kể cả cho ca het_tran KHÔNG có khối dở dang.
    let vanBanCuoiThayThe: string | null = null;

    try {
      for (;;) {
        vong++;
        // Tiến độ cho NGƯỜI DÙNG: chỉ vòng ≥ 2 mới báo — vòng 1 là câu hỏi bình thường, token đã tự
        // stream ra rồi, báo thêm ở đó là làm ồn cho đường hạnh phúc phổ biến nhất (không cần đọc gì).
        if (cheDo.loai === "local" && vong > 1) {
          void this.panel.webview.postMessage({
            loai: "thong_bao",
            thongDiep: `— vòng ${vong}/${TRAN_VONG_MAC_DINH}: đang hỏi lại model với kết quả tool —`,
          });
        }
        const than = dungYeuCauStream({
          cauHoi: cauHoiVong,
          nguCanh: nguCanhVong ?? "",
          lichSu: lichSuVong,
          ngonNgu: cfg.get<string>("uiLanguage", "vi"),
          vaiTro: "engineer",
          cheDo,
          laCmdK,
        });
        let tt = trangThaiBanDau();
        const { hong } = await moDongSse({
          serverUrl: cfg.get<string>("serverUrl", "http://localhost:3000"),
          cookie,
          than,
          tinHieu: dieuKhien.signal,
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
        const ket = ketLuanLuotChat(tt, hong);
        traLoiCuoi = ket.traLoi;
        /**
         * ★★★ PDCA vòng 2 (round 2) — nối, KHÔNG THAY. Chạy cho CẢ hai chế độ (vô hại với SERVER —
         * vòng đó chỉ chạy đúng MỘT lần, và SERVER không dùng giao thức `avi-tool` dạng văn bản nên
         * thường không có gì để lọc).
         *
         * ★★★ ĐÃ SỬA (đo LIVE trên server thật bắt được — T10, `pdca3-report.md`): webview thật nối
         * `textContent += m.chu` KHÔNG dấu phân cách, và văn bản MỘT vòng không phải lúc nào cũng
         * kết thúc bằng `\n` (vd hậu tố `"_Nguồn số liệu: ... hàng_"` không xuống dòng). Nếu vòng KẾ
         * TIẾP bắt đầu NGAY bằng một hàng rào `\`\`\`avi-tool`, hàng rào đó rơi GIỮA DÒNG trong văn
         * bản NỐI THẲNG — quy ước "chỉ hàng rào ĐẦU DÒNG mới thật" (`khoiAviTool.ts`, có chủ đích,
         * tránh dương tính giả) khiến `xoaKhoiAviTool` BỎ QUA đúng khối đó, để lộ JSON thô (đo được
         * ở T10: hai lượt `doc_tep keys/id_rsa` liền nhau, lượt 2 KHÔNG bị xoá). `vanBanTichLuy` chỉ
         * dùng làm ĐẦU VÀO cho `vanBanKhongRacGiaoThuc` (không dùng cho gì khác cần khớp byte-đúng
         * với luồng SỐNG) nên được phép chèn thêm đúng MỘT `\n` ở ranh giới vòng khi vòng TRƯỚC chưa
         * kết thúc bằng dòng trống — bảo đảm hàng rào mở đầu của vòng SAU luôn được nhận diện ĐÚNG.
         */
        vanBanTichLuy += (vanBanTichLuy.length > 0 && !/\r?\n$/.test(vanBanTichLuy) ? "\n" : "") + traLoiCuoi;
        canhBaoCuoi = ket.canhBao;
        degradedCuoi = tt.degraded;

        // SERVER: một vòng duy nhất, giữ NGUYÊN hành vi trước Task 3 — không đọc `traLoiCuoi` tìm
        // yêu cầu đọc, không gọi `buocKeTiep`.
        if (cheDo.loai !== "local") break;

        const yeuCau = docYeuCauDoc(traLoiCuoi);
        const buoc = buocKeTiep({
          vong,
          tran: TRAN_VONG_MAC_DINH,
          coYeuCauDoc: yeuCau.length > 0,
          biHuy: dieuKhien.signal.aborted,
          coLoi: tt.daBaoLoi,
        });
        if (buoc.loai === "dung") {
          if (buoc.lyDo !== "khong_con_tool") {
            void this.panel.webview.postMessage({
              loai: "thong_bao",
              thongDiep: nhanLyDoDungVong(buoc.lyDo, vong),
            });
          }
          // ★★★ CHỈ nhánh het_tran — nguoi_dung_dung/loi/khong_con_tool KHÔNG được đổi hành vi
          // (xem docblock biến `vanBanCuoiThayThe` ở trên). Trả `null` khi không có khối dở dang.
          if (buoc.lyDo === "het_tran") {
            vanBanCuoiThayThe = vanBanHetTranConDoDang(traLoiCuoi, vong, TRAN_VONG_MAC_DINH);
          }
          break;
        }

        // buoc.loai === "chay_tool" — chạy TỪNG yêu cầu đọc (Task 2), nối kết quả thành lượt hỏi
        // KẾ TIẾP. Lượt VỪA XONG (câu hỏi + trả lời) vào lịch sử của VÒNG này để model lượt sau còn
        // nhớ nó vừa xin đọc gì — lịch sử này KHÔNG đụng `this.lichSu` (bộ nhớ NGOÀI của bảng chat),
        // xem ghi chú ở cuối hàm.
        lichSuVong = [...lichSuVong, { role: "user", content: cauHoiVong }, { role: "assistant", content: traLoiCuoi }];
        const dsGoc = this.dsGocDoc();
        const doanKetQua: string[] = [];
        for (const y of yeuCau) {
          void this.panel.webview.postMessage({
            loai: "thong_bao",
            thongDiep: `vòng ${vong}/${TRAN_VONG_MAC_DINH} — đang ${nhanYeuCauDoc(y)}`,
          });
          const kq = await chayToolCucBo(y, dsGoc);
          doanKetQua.push(kq.ok ? kq.ketQua : `LỖI: ${kq.lyDo}`);
        }
        /**
         * ★★★ H3(a) (review toàn nhánh 2026-08-30) — GIỮ câu hỏi GỐC, đừng THAY hẳn bằng kết quả
         * tool. Bản cũ gán `cauHoiVong = "KẾT QUẢ TOOL: ..."` — câu hỏi gốc (`cauHoi`, tham số của
         * `hoi()`, còn nguyên trong closure) biến mất khỏi `question` của vòng kế tiếp. Hai hậu quả
         * đo được:
         *  · đường hỏi thường: máy chủ truy hồi RAG theo `question` — vòng quyết định (vòng cuối)
         *    truy hồi trên NỘI DUNG TOOL thay vì trên câu người dùng hỏi, tức ngữ cảnh KB sai đề;
         *  · Cmd+K: câu hỏi gốc mang CẢ chỉ dẫn `de_xuat_sua_doan` LẪN `dongDau`/`dongCuoi` cố định
         *    — mất nó ở vòng ≥2 là mất luôn hình dạng đề xuất, thẻ duyệt không bao giờ hiện.
         * Vá: NỐI kết quả tool với câu hỏi gốc, không THAY — một dòng vá cả hai kịch bản.
         */
        cauHoiVong =
          `KẾT QUẢ TOOL:\n${doanKetQua.join("\n\n")}\n\n` +
          `--- CÂU HỎI GỐC (hãy trả lời ĐÚNG câu này, theo đúng hình dạng đã yêu cầu ở trên) ---\n${cauHoi}`;
        // Ngữ cảnh soạn thảo (tệp đang mở/đoạn đang chọn) CHỈ đính kèm lượt hỏi GỐC — lặp lại nó ở
        // mỗi vòng vừa tốn ngân sách ngữ cảnh vừa không mang tin gì mới cho những lượt sau.
        nguCanhVong = undefined;
      }

      // `degraded` ⇒ webview đang hiện chữ ĐÃ STREAM mà server vừa bảo là rác (vòng công cụ suy
      // biến) — phải THAY bằng `answer` thật, không chỉ lặng lẽ lưu đúng mà hiện sai. Một lượt DUY
      // NHẤT `hoan_tat` cho TOÀN BỘ vòng lặp (không phải một lượt cho mỗi vòng con) — người dùng chỉ
      // hỏi MỘT câu, hoàn tất phải khớp với đúng MỘT câu trả lời cuối cùng.
      // ★★★ PDCA vòng 2 — `vanBanCuoiThayThe` (het_tran + khối dở dang) ĐỨNG TRƯỚC `degradedCuoi`:
      // cả hai đều là "đừng để lộ chữ đã stream thô", override của het_tran ưu tiên hơn vì nó biết
      // CHÍNH XÁC vì sao câu trả lời dở (degraded chỉ biết "server bảo suy biến", không biết lý do).
      //
      // ★★★ PDCA vòng 2 (round 2, `pdca3-report.md`) — MỞ RỘNG: `vanBanDaLocSach` đứng ngay SAU
      // `vanBanCuoiThayThe`, TRƯỚC fallback `degradedCuoi`. Áp `vanBanKhongRacGiaoThuc` lên đúng văn
      // bản NỀN mà webview lẽ ra sẽ hiển thị nếu KHÔNG có ghi đè nào (degraded ⇒ `traLoiCuoi` của
      // vòng CUỐI, như fallback cũ; bình thường ⇒ toàn bộ `vanBanTichLuy` đã stream qua MỌI vòng) —
      // trả `null` khi nền đó vốn đã sạch (không có khối `avi-tool` nào), nên khi không có gì để
      // xoá, biểu thức dưới đây rơi ĐÚNG về fallback cũ, không đổi hành vi (đúng khuôn "vá xong phải
      // kiểm NHÁNH KIA").
      const vanBanNen = degradedCuoi ? traLoiCuoi : vanBanTichLuy;
      const vanBanDaLocSach = vanBanKhongRacGiaoThuc(vanBanNen);
      void this.panel.webview.postMessage({
        loai: "hoan_tat",
        vanBanCuoi: vanBanCuoiThayThe ?? vanBanDaLocSach ?? (degradedCuoi ? traLoiCuoi : null),
        canhBao: canhBaoCuoi,
      });
      // Lịch sử NGOÀI (`this.lichSu`, dùng cho MỌI câu hỏi sau này) chỉ giữ câu hỏi GỐC + câu trả
      // lời CUỐI — các lượt "KẾT QUẢ TOOL" ở giữa là chi tiết THI CÔNG của một câu hỏi, không phải
      // một lượt hỏi mới của người dùng; nhét chúng vào đây sẽ phình lịch sử mọi câu hỏi SAU này
      // bằng nguyên văn kết quả `liet_ke`/`grep` của một câu hỏi đã xong từ lâu.
      this.lichSu.push({ role: "user", content: cauHoi }, { role: "assistant", content: traLoiCuoi });
      // ★★★ ĐỢT C — đường ghi CỤC BỘ, dựa trên câu trả lời CUỐI của vòng lặp (sau khi đã đọc xong
      // mọi yêu cầu ĐỌC của model, nếu có). Đề xuất GHI KHÔNG được xử lý bên trong vòng lặp Task 3
      // ở trên — chỉ ở đây, ĐÚNG MỘT LẦN, y hệt đường Đợt C trước Task 3 (chỉ khác nguồn `traLoiCuoi`
      // là câu trả lời của LƯỢT CUỐI thay vì lượt duy nhất).
      if (cheDo.loai === "local") void this.xuLyDeXuatCucBo(traLoiCuoi);
    } catch (e) {
      // Huỷ lượt cũ là hành vi BÌNH THƯỜNG (người dùng hỏi câu mới) — không phải lỗi, không được
      // khai thành lỗi. Chỉ lỗi THẬT mới hiện lên.
      /**
       * ★★★ TASK 6/D.1 — NGUỒN SỰ THẬT LÀ `dieuKhien.signal.aborted`, KHÔNG PHẢI HÌNH DẠNG CỦA `e`.
       *
       * Bản cũ nhận diện huỷ bằng `(e as Error).name === "AbortError"`. Đo LIVE (Task 6): huỷ GIỮA
       * LÚC ĐANG ĐỌC THÂN SSE (chứ không phải trước khi có response — đó là kịch bản Task 4 đã đo)
       * khiến `fetch` gốc của Node (undici) reject bằng CHÍNH `signal.reason` — khi
       * `dungVongHienTai()` gọi `abort(LY_DO_NGUOI_DUNG_DUNG)`, `reason` đó là một CHUỖI TRẦN, không
       * phải `Error`/`AbortError`. `(e as Error).name` trên một chuỗi luôn là `undefined` ⇒ lượt huỷ
       * CÓ CHỦ Ý của người dùng rơi xuống nhánh lỗi chung với `(e as Error).message === undefined`
       * ⇒ bong bóng "Lỗi" HIỆN RỖNG. Tái hiện 4/4 lần ở Task 6 (`t6-chan-doan-dung.json`).
       *
       * Vá bằng cách đọc TÍN HIỆU chứ không đọc HÌNH DẠNG của vật bị ném: `dieuKhien` là
       * `AbortController` CỦA RIÊNG lượt `hoi()` này (biến cục bộ closure, không phải `this.huy` —
       * cùng lý do Task 3 đã nêu), nên `dieuKhien.signal.aborted === true` CHỈ CÓ THỂ do MỘT trong
       * hai lời gọi `abort()` nhắm đúng lượt này: (1) `dungVongHienTai()` của CHÍNH lượt này, hoặc
       * (2) huỷ NGẦM ở đầu MỘT lượt `hoi()` MỚI đè lên lượt này. Bất kể `e` là `Error`, chuỗi, hay
       * bất kỳ thứ gì khác — nếu tín hiệu đã báo huỷ thì đây LÀ một lượt huỷ, không phải lỗi thật.
       */
      if (dieuKhien.signal.aborted) {
        /**
         * PHẢI phân biệt HAI nguồn gốc bằng `reason`, KHÔNG bằng việc "có phải huỷ hay không" — Đợt
         * A đã trả giá đúng chỗ này (huỷ lượt hiện thành bong bóng "Lỗi" tiếng Anh thô); vá sai
         * hướng ở đây là hiện "đã dừng" cho MỌI lượt huỷ, kể cả lượt bị huỷ NGẦM vì người dùng gõ
         * câu hỏi khác — một bong bóng "đã dừng" lạc giữa một câu hỏi hoàn toàn mới còn tệ hơn im lặng.
         *   · `reason === LY_DO_NGUOI_DUNG_DUNG` ⇒ CHÍNH `dungVongHienTai` của LƯỢT NÀY vừa gọi.
         *     Báo "đã dừng — ở vòng N" (không phải "lỗi"), rồi gửi `hoan_tat` để webview coi lượt
         *     này ĐÃ XONG (ẩn nút Dừng — xem `htmlBang.ts`; không tín hiệu nào khác làm việc đó).
         *   · Ngược lại (huỷ NGẦM, `reason` mặc định của `abort()` không tham số) ⇒ giữ NGUYÊN hành
         *     vi cũ: im lặng, không báo gì — lượt hỏi MỚI đã tự lo trạng thái của chính nó.
         */
        if (dieuKhien.signal.reason === LY_DO_NGUOI_DUNG_DUNG) {
          void this.panel.webview.postMessage({
            loai: "thong_bao",
            thongDiep: nhanLyDoDungVong("nguoi_dung_dung", vong),
          });
          // ★★★ PDCA vòng 2 (round 2) — huỷ GIỮA LÚC đang đọc thân SSE của một vòng ≥2 (lượt fetch
          // hiện tại không kịp hoàn tất, `vanBanTichLuy`/`traLoiCuoi` KHÔNG được cập nhật cho vòng
          // này) VẪN có thể để lại khối `avi-tool` ĐÃ THỰC THI của (các) vòng TRƯỚC đó trong
          // `vanBanTichLuy` — cùng lỗ hổng đã vá ở nhánh kết thúc bình thường phía trên, KHÔNG được
          // bỏ sót nhánh huỷ-giữa-chừng này. `null` khi chưa có gì để xoá (ca phổ biến nhất — huỷ
          // ngay ở vòng 1) giữ NGUYÊN hành vi cũ.
          void this.panel.webview.postMessage({
            loai: "hoan_tat",
            vanBanCuoi: vanBanKhongRacGiaoThuc(vanBanTichLuy),
            canhBao: null,
          });
        }
        return;
      }
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
      // ★ CÙNG LÝ LẼ với nhánh huỷ ở trên: lỗi THẬT cũng không đảm bảo là `Error` (một chuỗi trần
      // ném ra sẽ làm `.message` là `undefined`, tái tạo đúng "bong bóng lỗi RỖNG" cho một lượt
      // KHÔNG PHẢI do huỷ) — dùng `e instanceof Error` để đọc `.message`, ngược lại hiện chính giá
      // trị bị ném (ép chuỗi) thay vì `undefined`.
      void this.panel.webview.postMessage({
        loai: "loi",
        thongDiep: e instanceof Error ? e.message : String(e),
      });
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
    // ★★★ F3 — `resolve(goc, d.path)` NEO CỨNG vào gốc đang chọn, trong khi đường model nhìn thấy
    // được tính trên thư mục CHỨA tệp (workspace nhiều thư mục ⇒ hai gốc khác nhau). `giaiDuongDeXuat`
    // thử mọi gốc và TỪ CHỐI khi có ≥2 tệp cùng khớp — xem docblock của nó về ca `app/x.ts` vs
    // `lib/x.ts`, nơi neo sai không đẻ ra lỗi mà đẻ ra một lượt ghi vào TỆP KHÁC trông hợp lý.
    const giai = giaiDuongDeXuat(d.path, goc, dsWs, existsSync);
    if (!giai.ok) {
      void this.panel.webview.postMessage({ loai: "thong_bao", thongDiep: `Bỏ qua đề xuất sửa "${d.path}": ${giai.lyDo}` });
      return;
    }
    const duongTuyetDoi = giai.duong;
    const that = giaiDuongThat(duongTuyetDoi);
    if (!that.ok) {
      void this.panel.webview.postMessage({ loai: "thong_bao", thongDiep: `Bỏ qua đề xuất sửa "${d.path}": ${that.lyDo}` });
      return;
    }
    // ★★★ GỐC cũng phải GIẢI ĐƯỜNG THẬT — cùng hệ quy chiếu với `that.duong`. Đây không chỉ là để
    // so ranh giới (đã có `wsThat` lo), mà còn để tính ĐƯỜNG TƯƠNG ĐỐI khai lên sổ kiểm toán: trộn
    // một gốc CHƯA giải với một đích ĐÃ giải cho ra `..\..\…` khi chính gốc là junction, và trên
    // Windows khác ổ đĩa thì cho ra NGUYÊN đường tuyệt đối máy dev. Xem `duongTuongDoiTrongWorkspace`.
    const gocThat = giaiDuongThat(goc);
    if (!gocThat.ok) {
      void this.panel.webview.postMessage({
        loai: "thong_bao",
        thongDiep: `Bỏ qua đề xuất sửa "${d.path}": không giải được thư mục đang chọn "${goc}" (${gocThat.lyDo}).`,
      });
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

    // ★★★ I-1 — CẶP {gốc, đường tương đối} PHẢI NÓI VỀ CÙNG MỘT GỐC, và gốc ấy phải THẬT SỰ CHỨA
    // tệp. Thử gốc của ô chọn TRƯỚC (đó là thứ người dùng đang nhìn), rồi tới các thư mục workspace
    // khác. `undefined` ⇒ không gốc nào chứa nó: KHÔNG bịa ra một chuỗi trông-như-đường-dẫn để khai
    // lên sổ. (Về lý thuyết `duocPhepGhi` ở trên đã loại ca này; giữ nhánh vì "về lý thuyết" không
    // phải một hàng rào, và giá của nó là bốn dòng.)
    const viTri = duongTuongDoiTrongWorkspace(that.duong, [gocThat.duong, ...wsThat]);
    if (!viTri) {
      void this.panel.webview.postMessage({
        loai: "thong_bao",
        thongDiep: `Bỏ qua đề xuất sửa "${d.path}": không quy được về đường tương đối trong thư mục workspace nào.`,
      });
      return;
    }
    const duongTuongDoi = viTri.duongTuongDoi;
    const { them, bot, doiDong } = tomTatDiff(noiDungGoc, ghep.moi);
    this.deXuatCucBoHienTai = {
      actionId: randomUUID(),
      deXuat: d,
      duongTuyetDoi: that.duong,
      duongTuongDoi,
      bamGoc: bamNoiDung(noiDungGoc),
      moi: ghep.moi,
      // Gốc mà `duongTuongDoi` được tính TRÊN — không phải `goc` chưa giải. Hai ô này đi cùng nhau
      // lên sổ kiểm toán (`nhanWorkspace` + `path`), lệch nhau là sổ tự mâu thuẫn.
      thuMucWorkspace: viTri.goc,
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
   *   RÕ KẾT CỤC" đáng thử lại). Lý lẽ: bấm lại KHÔNG chữa được gì — lượt sau sẽ gặp băm đã đổi (nếu
   *   byte đã rơi) và bị từ chối đúng như thiết kế; giữ một cái nút sống chỉ mời người dùng ghi đè
   *   lần hai.
   *
   * ⚠⚠⚠ SỬA MỘT CÂU SAI TỪNG NẰM ĐÚNG CHỖ NÀY (2026-08-29). Ghi chú cũ khẳng định *"`apBanVa` hoặc
   *   ĐÃ ghi (`ok:true`) hoặc CHƯA ghi gì (`ok:false`)"*. **Sai** — và sai theo hướng nguy hiểm. Có
   *   một ca thứ BA: lượt áp chỉnh sửa thành công nhưng `save()` hỏng, khi ấy nội dung của AI nằm
   *   trong BỘ ĐỆM editor ở dạng chưa lưu. `apBanVa` nay tự hoàn nguyên và ĐO LẠI; nếu hoàn nguyên
   *   cũng hỏng thì nó trả `ok:false` với một `thongDiep` nói rõ **CHƯA RÕ** và bỏ ngỏ sổ kiểm toán
   *   ở `dang_ap_client`. Vì thế `ok` KHÔNG đủ để kể lại câu chuyện: chỗ này chỉ được **hiện nguyên
   *   văn `thongDiep`**, tuyệt đối không rút gọn nó thành "đã ghi"/"không ghi".
   */
  private async apDungCucBo(): Promise<void> {
    const cb = this.deXuatCucBoHienTai;
    if (!cb) return;
    // `undefined` (không xác định được chế độ) đi CÙNG nhánh từ chối với "không phải LOCAL": ở một
    // cửa ghi đĩa, "không biết" phải được xử như "không được", không như "chắc là LOCAL".
    const cheDoLucBam = this.cheDoHienTai();
    if (cheDoLucBam?.loai !== "local") {
      this.quenDeXuat(
        cheDoLucBam
          ? "Dự án đang chọn KHÔNG phải chế độ LOCAL — đã bỏ đề xuất ghi thay vì ghi vào máy bạn. Chọn lại dự án LOCAL rồi hỏi lại."
          : "KHÔNG xác định được dự án đang chọn — đã bỏ đề xuất ghi thay vì đoán chế độ rồi ghi vào máy bạn. Chọn lại dự án rồi hỏi lại.",
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
    const cheDoLucBam = this.cheDoHienTai();
    if (!cheDoLucBam || !coDuocHienTheDuyet(cheDoLucBam.loai)) {
      this.quenDeXuat(
        cheDoLucBam
          ? "Dự án đang chọn KHÔNG phải chế độ SERVER — đã bỏ đề xuất ghi thay vì duyệt nó. Chọn lại dự án SERVER rồi hỏi lại."
          : "KHÔNG xác định được dự án đang chọn — đã bỏ đề xuất ghi thay vì đoán chế độ. Chọn lại dự án rồi bấm lại.",
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
