/**
 * B8 (kế hoạch AI Local 2026-09-22 §2) — LUỒNG TẠO KHUNG DỰ ÁN của nhánh lập trình (`streamCodingTaoKhung`:
 * `dotnet new` cho C# chuẩn Microsoft, hoặc model dựng manifest nhiều tệp → một thẻ duyệt lô
 * `apply_diff_batch`). Tách NGUYÊN VĂN khỏi `aiLocalKnowledgeCoding.ts`.
 */
import path from "node:path";
import { executeDecision, type ToolExecContext } from "./aiLocalTools";
/**
 * ★★★ 2026-08-24 — đường TẠO KHUNG DỰ ÁN dùng LẠI đúng hai lớp phán quyết THUẦN của hộp cát
 * (`phanQuyetDuongDan` + `duoiDuocPhep`) để bắt-sớm đường xấu TRƯỚC khi đốt một lượt `read_file`
 * nào — tool `apply_diff_batch` vẫn kiểm LẠI độc lập từng tệp (hai hàng rào, một nguồn chính sách).
 * `TRAN_TEP_MOI_LO` nhập từ CHÍNH tool lô: trần khung = trần thẻ duyệt, không đẻ hằng thứ hai.
 */
import { duoiDuocPhep, phanQuyetDuongDan } from "./aiLocalTools/repoSandbox";
import { TRAN_TEP_MOI_LO } from "./aiLocalTools/writeHandlers/applyDiffBatch";
/**
 * ★★★ 2026-08-24 — KHUNG DỰ ÁN C# bằng `dotnet new` (khung CHUẨN Microsoft) THAY cho model tự viết
 * csproj/xaml (đo LIVE: model sai chuẩn — csproj tham chiếu `.ico` không tồn tại, lén package). SERVER
 * chạy `dotnet new` vào thư mục TẠM, đọc+lọc, rồi đưa qua ĐÚNG `apply_diff_batch` — GIỮ nguyên lớp
 * duyệt diff. `dotnet new` là lệnh GHI ĐĨA nên KHÔNG vào `DANH_SACH_TRANG` (model không tự chạy được).
 * Xem docblock đầu `ai/dotnetNewScaffold.ts`.
 */
import { anhXaTemplateDotnet, chayDotnetNewVaoTam, slugDuAn } from "./ai/dotnetNewScaffold";
/**
 * ★★★ doc 79 · TRỤC 1 (C) — cửa gọi model của TÁC NHÂN LẬP TRÌNH (persona + bộ cắt + bộ che + canh
 * thoái hoá + bóc khối mã). Xem `aiCodingAgent.ts` để biết vì sao nó KHÔNG nằm trong `services/ai/`.
 */
import { bocManifestKhung, chuanHoaTepMoi, codingEditEnabled, codingModelSanSang, personaTaoKhung, promptTaoKhung, type LuotHoiThoai } from "./aiCodingAgent";
import type { KbLanguage, KbQueryContext, StreamEvent } from "./aiLocalKnowledgeService";
// ★ B8 — các câu thông báo ba ngôn ngữ đã tách sang `./aiLocalKnowledgeCodingThongBao.ts` (xem docblock đầu tệp đó).
import { codingErrorMessage, codingKhungCauTuSua, codingKhungDotnetMessage, codingKhungHongMessage, codingKhungLoaiTepMessage, codingKhungQuaTranMessage, codingKhungTuChoiMessage, codingKhungTuSuaThongBao } from "./aiLocalKnowledgeCodingThongBao";
// ★ B8 — luồng SỬA (một tệp · tự trị · nhiều tệp) đã tách sang `./aiLocalKnowledgeCodingSua.ts` (xem docblock đầu tệp đó).
import { motLuotModel } from "./aiLocalKnowledgeCodingSua";
import { TRAN_TOKEN_TAO_KHUNG, doneSinhMa, nguCanhDuAnChoPrompt } from "./aiLocalKnowledgeCoding";


// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-24 — TẠO KHUNG DỰ ÁN: MỘT lượt model → manifest N tệp → MỘT thẻ duyệt, mọi neo RỖNG
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠⚠ ĐÂY LÀ NGOẠI LỆ **CREATE-ONLY** DUY NHẤT của luật *"model không bao giờ tự chọn danh sách
 * tệp ghi"* (đo live 2026-08-19: bộ chọn LLM bịa đường dẫn). Vì sao nó KHÔNG mở lại lỗ ấy:
 *
 *   1. **Chỉ TẠO, không SỬA.** Mọi mục đề xuất mang `original: ""` — băm neo là băm("") — và tệp
 *      nào ĐÃ tồn tại làm CẢ LÔ bị từ chối ở đây (mã `TEP_DA_TON_TAI`, liệt kê đích danh) TRƯỚC
 *      khi một đề xuất nào được dựng; `apply_diff_batch` còn chặn độc lập lần nữa (`BASE_MISMATCH`
 *      + kiểm lại ở confirm). Một đường model-chọn-tệp chỉ chạm được vào chỗ **không có gì để phá**.
 *   2. **Từng đường vẫn qua chính sách hộp cát** hai lần: bắt-sớm ở đây (`phanQuyetDuongDan` +
 *      `duoiDuocPhep`, thuần, trước mọi I/O) và kiểm THẬT trong tool (confine + realpath + đuôi).
 *   3. **Thẻ duyệt hiện ĐỦ nội dung từng tệp** (preview lô trích từng mục) — người bấm là người
 *      quyết, đúng chỗ HITL sinh ra để đứng.
 *   4. **KHÔNG chạm `locQuyetDinhLLMLapTrinh`**: cửa này là ý-định-NGƯỜI-DÙNG-tất-định
 *      (`laYDinhTaoDuAn`) + hậu xử lý đầu ra model — bộ chọn LLM vẫn KHÔNG khởi xướng được
 *      `apply_diff*` từ bất kỳ đường nào.
 *
 * ⚠ FAIL-SAFE về câu trả lời thường: manifest rỗng/hỏng/quá trần/đường xấu ⇒ chữ model ĐÃ stream
 *   được giữ nguyên như một câu trả lời, cộng đúng MỘT câu nói thật vì sao không có đề xuất —
 *   **không đề xuất một phần**, không đoán.
 * ⚠ Trả `true` ⇔ đã trả lời xong (kể cả bằng lời từ chối). `false` ⇒ nhường đường cũ (sinh mã).
 */
export async function* streamCodingTaoKhung(
  question: string,
  language: KbLanguage,
  context: KbQueryContext,
  execCtx?: ToolExecContext,
  history: readonly LuotHoiThoai[] = [],
  /** ★ doc 82 — khối bài học ĐÃ BỌC của lượt; `""` ⇒ không có. Chỉ đi vào `prompt`. */
  khoiBaiHoc = "",
): AsyncGenerator<StreamEvent, boolean> {
  if (!codingEditEnabled()) return false;
  if (!execCtx) return false;

  const nguCanh = await nguCanhDuAnChoPrompt(context, execCtx);

  /**
   * ★★★ KIỂM MANIFEST TỆP — nhận danh sách tệp ĐÃ BÓC, dùng CHUNG cho HAI nguồn: manifest MODEL và
   * khung `dotnet new`. Chạy TỐI ĐA hai lần cho đường model (lượt gốc + đúng MỘT lượt tự sửa). Nội
   * dung là NGUYÊN khối kiểm cũ (chính sách đường · loại-an-toàn · kiểm CHƯA-tồn-tại), chỉ đổi đầu
   * vào từ `boc.tep` sang `tepVao` — chép ra một bản mutable cục bộ để phần thân giữ nguyên `boc.tep`.
   */
  const kiemManifestTep = async (
    tepVao: { duong: string; noiDung: string }[],
  ): Promise<{ ok: true; tep: { duong: string; noiDung: string }[]; cauLoai: string | null } | { ok: false; cau: string }> => {
    if (tepVao.length > TRAN_TEP_MOI_LO) return { ok: false, cau: codingKhungQuaTranMessage(language, tepVao.length) };
    const boc = { tep: tepVao.slice() };
    // ── (1) CHÍNH SÁCH ĐƯỜNG — thuần, TRƯỚC mọi I/O: hộp cát + đuôi trắng, liệt kê ĐỦ tệp phạm.
    // ⚠ HAI loại phạm, HAI số phận: HÌNH DẠNG đường xấu (tuyệt đối/`..`/ổ đĩa/thư mục cấm) là dấu
    //   hiệu model cố thoát hộp cát ⇒ LUÔN từ chối, la to — không bao giờ "loại êm" một mưu toan.
    //   Phạm ĐUÔI đơn thuần (.ico, .png — tài nguyên nhị phân) chỉ là thói quen xấu ⇒ mới được xét
    //   loại-an-toàn dưới. (★ 2026-08-24: dotfile `.gitignore`/`.editorconfig` KHÔNG còn là phạm —
    //   `TEN_TEP_CHO_PHEP` ở `repoSandbox` cho chúng qua như tệp dự án bình thường.)
    const phamDuongXau: string[] = [];
    const phamChinhSach: string[] = [];
    for (const t of boc.tep) {
      const ten = t.duong.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
      if (phanQuyetDuongDan(t.duong) !== null) phamDuongXau.push(t.duong);
      else if (!duoiDuocPhep(ten)) phamChinhSach.push(t.duong);
    }
    if (phamDuongXau.length > 0) {
      return { ok: false, cau: codingKhungTuChoiMessage(language, "DUONG_KHONG_HOP_LE", phamDuongXau) };
    }
    /**
     * ★★★ LOẠI-AN-TOÀN thay vì từ chối mù — luật TẤT ĐỊNH, đo được, sinh từ BỐN lượt live liên
     * tiếp chơi đập chuột với model (resx → ico+editorconfig → ico → editorconfig: lượt tự sửa bỏ
     * đúng tệp bị mắng rồi thêm tệp phạm KHÁC).
     *
     * Tệp phạm chia hai loại theo MỘT vị từ: có tệp NÀO KHÁC trong manifest nhắc tới TÊN nó không?
     *  • KHÔNG ai tham chiếu (`logo.png`, `sample.pdf`… — 2026-08-24: dotfile đã HỢP LỆ, mồi phạm
     *    nay là tài nguyên nhị phân) ⇒ LOẠI khỏi lô + NÓI RÕ trong thẻ và
     *    câu trả lời — khung còn lại vẫn nguyên vẹn, build không mất gì. Im lặng loại là nói dối;
     *    loại CÓ nói là đúng chuẩn "không cắt bớt âm thầm" của repo.
     *  • CÓ tham chiếu (`appicon.ico` trong `<ApplicationIcon>` của csproj) ⇒ loại là build GÃY
     *    ngay lượt sau ⇒ giữ nguyên đường TỪ CHỐI/tự sửa, kèm tên tệp tham chiếu để model biết phải
     *    gỡ cả hai đầu.
     */
    if (phamChinhSach.length > 0) {
      const thamChieu = new Map<string, string[]>();
      for (const pham of phamChinhSach) {
        const ten = pham.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? pham;
        // ⚠ Tệp .md là VĂN XUÔI (README nhắc tên ≠ phụ thuộc build) — không tính là tham chiếu.
        const nhac = boc.tep
          .filter((t) => !phamChinhSach.includes(t.duong) && !/.md$/i.test(t.duong) && t.noiDung.includes(ten))
          .map((t) => t.duong);
        if (nhac.length > 0) thamChieu.set(pham, nhac);
      }
      if (thamChieu.size > 0) {
        const chiTiet = phamChinhSach.map((p) => {
          const n = thamChieu.get(p);
          return n ? `${p} (được tham chiếu bởi: ${n.join(", ")})` : p;
        });
        return { ok: false, cau: codingKhungTuChoiMessage(language, "DUONG_KHONG_HOP_LE", chiTiet) };
      }
      // Mọi tệp phạm đều KHÔNG ai tham chiếu ⇒ loại + nói, đi tiếp với phần còn lại.
      const conLai = boc.tep.filter((t) => !phamChinhSach.includes(t.duong));
      if (conLai.length === 0) {
        return { ok: false, cau: codingKhungTuChoiMessage(language, "DUONG_KHONG_HOP_LE", phamChinhSach) };
      }
      boc.tep.length = 0;
      boc.tep.push(...conLai);
      var cauLoaiTam: string | null = codingKhungLoaiTepMessage(language, phamChinhSach, conLai.length);
    } else {
      var cauLoaiTam: string | null = null;
    }
    // ── (2) CHƯA TỒN TẠI — hỏi qua ĐÚNG cửa đọc (`read_file` qua executeDecision: hộp cát +
    //   RBAC + gốc dự án server-authoritative). KHÔNG mở `fs` thứ hai — `programmingFileIo.census`
    //   cưỡng chế. Tệp ĐÃ tồn tại ⇒ từ chối CẢ LÔ: khung dự án nửa vời tệ hơn không có.
    const daTonTai: string[] = [];
    const khongKiemDuoc: string[] = [];
    for (const t of boc.tep) {
      const rf = await executeDecision({ tool: "read_file", args: { path: t.duong } }, execCtx);
      const note = rf.result?.note;
      if (note === "NOT_FOUND") continue; // đúng điều kiện TẠO
      else if (rf.result && note == null) daTonTai.push(t.duong); // đọc được ⇒ tệp ĐÃ có
      else khongKiemDuoc.push(note ? `${t.duong} (${note})` : t.duong); // lỗi/từ chối khác ⇒ fail-closed
    }
    if (daTonTai.length > 0) return { ok: false, cau: codingKhungTuChoiMessage(language, "TEP_DA_TON_TAI", daTonTai) };
    if (khongKiemDuoc.length > 0) return { ok: false, cau: codingKhungTuChoiMessage(language, "KHONG_KIEM_DUOC", khongKiemDuoc) };
    return { ok: true, tep: boc.tep, cauLoai: cauLoaiTam };
  };

  /**
   * ★ Bọc TEXT→TỆP cho đường MODEL: bóc manifest bằng `bocManifestKhung` rồi vào `kiemManifestTep`.
   *   (Đường `dotnet new` không cần bọc này — nó đã có sẵn danh sách tệp.)
   */
  const kiemManifest = async (
    vanBan: string,
  ): Promise<{ ok: true; tep: { duong: string; noiDung: string }[]; cauLoai: string | null } | { ok: false; cau: string }> => {
    const boc = bocManifestKhung(vanBan);
    if (!boc.ok) return { ok: false, cau: codingKhungHongMessage(language, boc.ma, boc.chiTiet) };
    return kiemManifestTep(boc.tep);
  };

  /**
   * ★★★ ĐUÔI CHUNG — dựng MỘT `apply_diff_batch` (mọi `original: ""`) rồi stream qua HITL. Dùng cho
   * CẢ hai nguồn (khung `dotnet new` và manifest model), nên lớp xem-trước-diff GIỐNG HỆT nhau —
   * `executeDecision` gửi mọi `kind:"write"` vào `proposeAction`, ở đây không nhánh nào chạm đĩa.
   *
   * ⚠ `vanBanTruoc` là chữ ĐÃ đi vào token stream (model: đầu ra model đã stream; dotnet: câu note đã
   *   yield) — ở đây CHỈ dùng lại nó cho `answer` của `done` (client thay bong bóng bằng answer, nên
   *   token rời sẽ biến mất khỏi bản ghi — bài học §7B), KHÔNG stream lần nữa.
   */
  const deXuatKhung = async function* (
    tepKhung: { duong: string; noiDung: string }[],
    vanBanTruoc: string,
    cauLoai: string | null,
  ): AsyncGenerator<StreamEvent, boolean> {
    // ★ Tệp bị LOẠI-an-toàn: nói NGAY trong dòng chữ — trước cả thẻ duyệt, để người đọc thẻ biết vì sao thiếu.
    if (cauLoai) yield { type: "token", token: `\n\n${cauLoai}` };
    const ad = await executeDecision(
      { tool: "apply_diff_batch", args: { files: tepKhung.map((t) => ({ path: t.duong, original: "", modified: t.noiDung })) } },
      execCtx!,
    );
    const duoiDone = cauLoai ? `${cauLoai}\n\n` : "";
    if (ad.pendingAction) {
      yield { type: "pending_action", toolName: "apply_diff_batch", pendingAction: ad.pendingAction };
      const m = ad.pendingAction.summary;
      yield { type: "token", token: `\n\n${m}` };
      yield doneSinhMa(`${vanBanTruoc}\n\n${duoiDone}${m}`, "ollama");
      return true;
    }
    if (ad.denied) {
      const m = ad.denied.message;
      yield { type: "token", token: `\n\n${m}` };
      yield doneSinhMa(`${vanBanTruoc}\n\n${duoiDone}${m}`, "tool");
      return true;
    }
    const m = codingErrorMessage(language, "apply_diff_batch", ad.error ?? "PROPOSE_FAILED");
    yield { type: "token", token: `\n\n${m}` };
    yield doneSinhMa(`${vanBanTruoc}\n\n${duoiDone}${m}`, "tool");
    return true;
  };

  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★★ ĐƯỜNG 1 — `dotnet new` (khung CHUẨN Microsoft), THỬ TRƯỚC KHI HỎI MODEL.
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Ánh xạ ý định → template `dotnet new` (THUẦN). Khớp + `dotnet new` chạy được ⇒ khung chuẩn 100%,
   * KHÔNG cần model (chạy được cả khi model 30B đang giữ VRAM — đó là lý do gate `codingModelSanSang`
   * dời xuống nhánh 2). Không khớp / dotnet lỗi / không có SDK ⇒ fail-safe RƠI VỀ đường model tự viết
   * (dự phòng cho TS/React/Python…). `dotnet new` là lệnh GHI ĐĨA nên SERVER chạy nó vào thư mục TẠM
   * do server kiểm soát — model KHÔNG bao giờ tự chạy được (nó KHÔNG có trong `DANH_SACH_TRANG`).
   */
  const template = anhXaTemplateDotnet(question);
  if (template !== null) {
    const dn = await chayDotnetNewVaoTam({ template, slug: slugDuAn(context.projectId) });
    if (dn.ok) {
      // Chuẩn hoá kết dòng đúng như manifest model (LF + một dòng trống cuối) trước khi neo băm("").
      const tepChuanHoa = dn.tep.map((t) => ({ duong: t.duong, noiDung: chuanHoaTepMoi(t.noiDung) }));
      const note = codingKhungDotnetMessage(language, dn.template, dn.slug, dn.coNuGet);
      yield { type: "token", token: note };
      const kq = await kiemManifestTep(tepChuanHoa);
      if (!kq.ok) {
        // Hậu kiểm create-only từ chối CẢ LÔ (tệp đã tồn tại / quá trần). KHÔNG rơi về model: khung
        // chuẩn đã sinh ĐÚNG; lỗi ở gốc dự án (không trống) — người dùng cần biết, không cần một lượt model.
        yield { type: "token", token: `\n\n${kq.cau}` };
        yield doneSinhMa(`${note}\n\n${kq.cau}`, "tool");
        return true;
      }
      return yield* deXuatKhung(kq.tep, note, kq.cauLoai);
    }
    console.warn(
      `[aiLocalKnowledge] dotnet new (${template}) không dùng được: ${dn.lyDo} ⇒ rơi về đường model tự viết khung`,
    );
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★★ ĐƯỜNG 2 — MODEL TỰ VIẾT KHUNG (fail-safe / ngôn ngữ ngoài .NET). NGUYÊN VẸN đường cũ.
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Kết một lượt FAIL-SAFE: chữ model ĐÃ stream giữ nguyên như câu trả lời thường + đúng MỘT câu nói
   * thật vì sao không có đề xuất. Generator con không `yield` hộ được nên trả câu về cho vòng ngoài.
   */
  if (!(await codingModelSanSang())) return false;
  const lm = yield* motLuotModel({
    heThong: personaTaoKhung(language, nguCanh),
    // ⚠ KHÔNG có khối ngữ cảnh mã: thư mục đích TRỐNG — mục lục repo nền tảng không nói gì về nó.
    ghepPrompt: (khoiLichSu, khoiBai) => promptTaoKhung(question, language, khoiLichSu, khoiBai),
    khoiBaiHoc,
    tranToken: TRAN_TOKEN_TAO_KHUNG,
    // ★ B1 (vá 2026-09-23) — lượt ĐẦU của dựng khung từng THIẾU `loai` (chỉ lượt tự sửa có) ⇒ `luotDuocNghi(undefined)`
    //   = false ⇒ lượt khung chính chạy KHÔNG nghĩ, trần gốc. tsc bắt được (TS2345) nhưng không ai đọc lỗi.
    ghiDe: context.cheDoNghi, // ★ F3
    loai: "tao-khung",
    language,
    history,
    relPath: "(khung dự án)",
    userId: execCtx.user?.id,
    signal: execCtx.signal,
  });
  if (lm.kq !== "chu") {
    yield doneSinhMa(lm.traLoi, lm.provider, lm.degraded);
    return true;
  }

  let vanBanCuoi = lm.text;
  let ketQuaKiem = await kiemManifest(vanBanCuoi);
  if (!ketQuaKiem.ok) {
    /**
     * ★★★ ĐÚNG MỘT LƯỢT TỰ SỬA — vì sao có, và vì sao chỉ MỘT.
     *
     * Nghiệm thu live 2026-08-24: BA lượt liên tiếp model 30B nhét tệp ngoài danh sách trắng vào
     * khung WPF (`Strings.resx` → `appicon.ico` + `.editorconfig` → lại `appicon.ico` — lượt CUỐI
     * persona ĐÃ liệt kê nguyên danh sách trắng mà thói quen "WPF thì có icon" vẫn thắng lời dặn).
     * Mỗi lượt đoán sai đốt ~4 phút của người dùng chỉ để nhận một câu từ chối rồi tự gõ lại.
     * ⇒ Vòng đọc-lỗi-rồi-sửa là đúng triết lý repo (doc 78 nhịp 5), áp cho chính manifest: đưa
     *   NGUYÊN VĂN câu từ chối lại cho model, bắt xuất lại toàn bộ khung sạch.
     * ⚠ Trần là MỘT, không phải N: lỗi manifest là lỗi HÌNH THỨC — model đọc được câu từ chối là
     *   sửa được ngay; hỏng cả lượt thứ hai nghĩa là model không theo nổi hợp đồng, lặp thêm chỉ
     *   đốt thời gian để che một vấn đề cần con người nhìn thấy. Fail-safe cũ giữ nguyên sau trần.
     */
    const thongBaoTuSua = codingKhungTuSuaThongBao(language, ketQuaKiem.cau);
    yield { type: "token", token: `\n\n${thongBaoTuSua}` };
    const lm2 = yield* motLuotModel({
      heThong: personaTaoKhung(language, nguCanh),
      ghepPrompt: (khoiLichSu, khoiBai) =>
        promptTaoKhung(codingKhungCauTuSua(language, question, ketQuaKiem.ok ? "" : ketQuaKiem.cau), language, khoiLichSu, khoiBai),
      khoiBaiHoc,
      tranToken: TRAN_TOKEN_TAO_KHUNG,
      ghiDe: context.cheDoNghi, // ★ F3
      loai: "tao-khung", // ★ B1 — lớp NGHĨ: dựng khung dự án, trần 8.000 giữ (max với trần nghĩ)
      language,
      history,
      relPath: "(khung dự án — tự sửa)",
      userId: execCtx.user?.id,
      signal: execCtx.signal,
    });
    if (lm2.kq !== "chu") {
      yield doneSinhMa(lm2.traLoi, lm2.provider, lm2.degraded);
      return true;
    }
    // ★ Nối thông báo vào văn bản CUỐI: client thay cả bong bóng bằng answer của done — thông báo
    //   chỉ nằm trong token stream sẽ BIẾN MẤT khỏi bản ghi (đo live 2026-08-24, lượt 5).
    //   Kiểm trên lm2.text THUẦN (không kèm thông báo) — parser không cần, và văn-bản-kiểm ≠
    //   văn-bản-hiển-thị là hai vai khác nhau, đừng trộn.
    vanBanCuoi = `${thongBaoTuSua}\n\n${lm2.text}`;
    ketQuaKiem = await kiemManifest(lm2.text);
    if (!ketQuaKiem.ok) {
      const cau = ketQuaKiem.cau;
      yield { type: "token", token: `\n\n${cau}` };
      yield doneSinhMa(`${vanBanCuoi}\n\n${cau}`, "ollama");
      return true;
    }
  }
  // ★ Đường model hội tụ vào ĐUÔI CHUNG: `vanBanCuoi` (đầu ra model, có thể kèm thông báo tự-sửa) đã
  //   đi vào token stream; `deXuatKhung` chỉ dùng lại nó cho `answer` của done + stream câu LOẠI-an-toàn.
  return yield* deXuatKhung(ketQuaKiem.tep, vanBanCuoi, ketQuaKiem.cauLoai);
}
