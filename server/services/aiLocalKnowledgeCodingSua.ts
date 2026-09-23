/**
 * B8 (kế hoạch AI Local 2026-09-22 §2) — LUỒNG SỬA của nhánh lập trình: sửa MỘT tệp (`streamCodingEdit`,
 * `chuanBiBanSuaMotTep` — khối sửa hoặc cả tệp), vòng TỰ TRỊ GHI (`streamCodingTuTriGhi`), sửa NHIỀU tệp
 * (`streamCodingSuaNhieuTep`) và cửa gọi model dùng chung `motLuotModel` (trần theo lớp lượt, cầu chì nghĩ).
 * Tách NGUYÊN VĂN khỏi `aiLocalKnowledgeCoding.ts`; mọi đề xuất ghi vẫn đi qua `apply_diff` + HITL như cũ.
 */
import path from "node:path";
import { executeDecision, type ToolExecContext } from "./aiLocalTools";
/**
 * ★★★ 2026-08-24 · VÒNG TỰ-TRỊ-GHI — điểm gọi PRODUCTION cho đường NGUY HIỂM NHẤT (model tự ghi mã
 * KHÔNG người duyệt). Bộ điều phối + sáu hàng rào ở `aiCodingTuTriGhi.ts`; file này chỉ (a) nối
 * `sinhBanVa` THẬT (tái dùng `chuanBiBanSuaMotTep`, KHÔNG cửa ghi thứ hai) và (b) stream tiến độ.
 */
import {
  chayVongTuTriGhi,
  type SinhBanVa,
  type KetQuaVongTuTri,
  type TienDoTuTri,
} from "./aiCodingTuTriGhi";
import type { CopilotUser } from "./aiCopilotActions";
/**
 * ★★★ 2026-08-24 — đường TẠO KHUNG DỰ ÁN dùng LẠI đúng hai lớp phán quyết THUẦN của hộp cát
 * (`phanQuyetDuongDan` + `duoiDuocPhep`) để bắt-sớm đường xấu TRƯỚC khi đốt một lượt `read_file`
 * nào — tool `apply_diff_batch` vẫn kiểm LẠI độc lập từng tệp (hai hàng rào, một nguồn chính sách).
 * `TRAN_TEP_MOI_LO` nhập từ CHÍNH tool lô: trần khung = trần thẻ duyệt, không đẻ hằng thứ hai.
 */
import { phanQuyetDuongDan } from "./aiLocalTools/repoSandbox";
import { thuMucTuLoi } from "./ai/thuMucTuLoi";
import {
  tranTokenSinhMa,
  nenThuLaiVoiTranRong,
  ghiModelDaNghi,
  modelNenCoiLaBietNghi,
} from "./ai/tranTokenSinhMa";
import { kiemNganSachNguCanh } from "./aiLlamaServerClient";
import { luotDuocNghi, tranTokenTheoLop, type LoaiLuot, type CheDoNghi } from "./ai/loaiLuot";
import { nganSachNghiChoLuot, tranMongMuonChoCheDo } from "./ai/nghiSau";
import { hoSoSamplingCho } from "./ai/hoSoSampling";
/**
 * ★★★ doc 79 · TRỤC 1 (C) — cửa gọi model của TÁC NHÂN LẬP TRÌNH (persona + bộ cắt + bộ che + canh
 * thoái hoá + bóc khối mã). Xem `aiCodingAgent.ts` để biết vì sao nó KHÔNG nằm trong `services/ai/`.
 */
import { apDungKhoiSua, bocKhoiMa, bocKhoiSua, chepCaTepDuocKhong, chuanHoaTepMoi, codingEditEnabled, codingKhoiSuaEnabled, codingModelSanSang, chonDuongTuTri, dongBoXuongDong, MOC_TEP_KHUNG, personaSuaTep, personaSuaTepKhoi, personaTaoTep, promptSuaTep, promptSuaTepKhoi, promptTaoTep, rutChuCoCanh, streamCodingModel, tranTokenChoTep, TRAN_KY_TU_TEP_SUA, TRAN_TOKEN_KHOI_SUA, dungKhoiLichSu, type KetQuaChu, type LuotHoiThoai, type MaKhoiHong, type DungLuotModel, type ManhSuyLuan } from "./aiCodingAgent";
/**
 * ★★★ doc 79 · TRỤC 1 (D) — MỤC LỤC (chunk) → MÃ THẬT (đọc đĩa qua `read_file`). Xem docblock đầu
 * `ai/codingRepoContext.ts`: module ấy KHÔNG nhập `fs`; cửa đọc do CHÍNH file này tiêm vào.
 */
import { thuThapNguCanhMa } from "./ai/codingRepoContext";
import type { KbLanguage, KbQueryContext, StreamEvent } from "./aiLocalKnowledgeService";
// ★ B8 — các câu thông báo ba ngôn ngữ đã tách sang `./aiLocalKnowledgeCodingThongBao.ts` (xem docblock đầu tệp đó).
import { codingErrorMessage, codingGoiYTaoTepMessage, codingKhoiHongMessage, codingKhongCoKhoiMaMessage, codingKhongDoiMessage, codingKhongTuSuaMessage, codingLoDungMessage, codingLoKhongDoiMessage, codingModelErrorMessage, codingQuaNhieuTepMessage, codingTaoRongMessage, codingTepDaTonTaiMessage, codingThoaiHoaMessage, codingTieuDeTepMessage } from "./aiLocalKnowledgeCodingThongBao";
import { TRAN_TEP_MOT_LUOT_SUA, TRAN_TOKEN_TAO_TEP, doneSinhMa, laYDinhSuaTep, nguCanhDuAnChoPrompt } from "./aiLocalKnowledgeCoding";


/**
 * ★★★ VÒNG LẶP TÁC NHÂN — bước SỬA: đọc tệp THẬT → model dựng TOÀN BỘ tệp mới → `apply_diff` qua
 * **HITL** (`proposeAction`) → người bấm duyệt → `confirmAction` mới ghi một byte.
 *
 * ⚠⚠ KHÔNG có đường tắt nào ở đây: lượt ghi đi qua `executeDecision`, và `executeDecision` gửi MỌI
 * `kind:"write"` vào `proposeAction`. Bốn hàng rào của pha C (tệp bẩn · băm chống TOCTOU · hộp cát ·
 * RBAC `ai_repo_read/canEdit`) chạy ở CẢ propose LẪN confirm, không phải ở đây.
 *
 * Trả `true` ⇔ đã trả lời xong (kể cả bằng một câu từ chối trung thực). `false` ⇒ người gọi đi tiếp
 * xuống đường tool tất định (đọc tệp) như trước — KHÔNG im lặng, KHÔNG mất lượt.
 */
export async function* streamCodingEdit(
  question: string,
  duong: string,
  language: KbLanguage,
  context: KbQueryContext,
  execCtx?: ToolExecContext,
  history: readonly LuotHoiThoai[] = [],
  /**
   * ★★★ doc 79 (2026-08-20) — người dùng có nói *"tạo tệp mới"* không (`laYDinhTaoTep`). Nó KHÔNG
   * quyết định tạo hay sửa — cái đĩa quyết định (xem ngã ba dưới đây). Nó chỉ trả lời một câu hẹp:
   * *"tệp KHÔNG tồn tại: đó là LỖI của người dùng, hay là Ý của họ?"*
   */
  yDinhTao = false,
  /**
   * ★ doc 82 — khối bài học ĐÃ DỰNG của lượt này (`streamCodingAnswer` dựng một lần). `""` ⇒ không
   * một byte nào vào prompt. Mặc định `""` ⇒ mọi lời gọi 7-tham-số cũ giữ nguyên hành vi.
   * ⚠ Nó là một CHUỖI đã bọc, không phải một danh sách để hàm này diễn giải — đường duy nhất của nó
   *   là đi vào `promptSuaTep*`/`promptTaoTep`, tức vào `prompt`, KHÔNG vào `systemPrompt`.
   */
  khoiBaiHoc = "",
): AsyncGenerator<StreamEvent, boolean> {
  const bs = yield* chuanBiBanSuaMotTep({
    question,
    duong,
    language,
    context,
    execCtx,
    history,
    yDinhTao,
    khoiBaiHoc,
    phatTheTool: true,
  });
  if (bs.kq === "bo_qua") return false;
  if (bs.kq !== "ok") {
    yield doneSinhMa(bs.traLoi, bs.provider, bs.degraded);
    return true;
  }

  const ad = await executeDecision(
    { tool: "apply_diff", args: { path: bs.relPath, original: bs.original, modified: bs.modified } },
    execCtx!,
  );
  if (ad.pendingAction) {
    yield { type: "pending_action", toolName: "apply_diff", pendingAction: ad.pendingAction };
    const m = ad.pendingAction.summary;
    yield { type: "token", token: `\n\n${m}` };
    yield doneSinhMa(`${bs.vanBanModel}\n\n${m}`, "ollama");
    return true;
  }
  if (ad.denied) {
    const m = ad.denied.message;
    yield { type: "token", token: `\n\n${m}` };
    yield doneSinhMa(`${bs.vanBanModel}\n\n${m}`, "tool");
    return true;
  }
  const m = codingErrorMessage(language, "apply_diff", ad.error ?? "PROPOSE_FAILED");
  yield { type: "token", token: `\n\n${m}` };
  yield doneSinhMa(`${bs.vanBanModel}\n\n${m}`, "tool");
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-24 — ĐIỂM GỌI PRODUCTION cho VÒNG TỰ-TRỊ-GHI (model tự ghi mã, KHÔNG người duyệt)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/** Dịch ba ngôn ngữ, cục bộ cho nhánh tự trị (khuôn `w` của aiCodingAgent). */
function wt(lang: KbLanguage, vi: string, en: string, zh: string): string {
  return lang === "en" ? en : lang === "zh" ? zh : vi;
}

/**
 * ★★★ Persona **BƯỚC 1 — CHỌN TỆP**: model CHỈ chọn tệp nguồn (từ cây thật), KHÔNG viết mã ở lượt này.
 *
 * ⚠ Vì sao tách khỏi lượt sửa: nghiệm thu live #2 (2026-08-24) — nếu bắt model vừa chọn tệp vừa xuất
 *   SEARCH/REPLACE trong MỘT lượt (không có nội dung tệp), nó viết neo theo TRÍ NHỚ và lệch byte
 *   (`public static double` vs `public double`) ⇒ neo không khớp ⇒ từ chối valid-fix. Bước 1 chỉ
 *   CHỌN; bước 2 (`chuanBiBanSuaMotTep`) mới ĐỌC nội dung thật rồi để model COPY neo khớp byte.
 */
function personaChonTep(lang: KbLanguage): string {
  return wt(
    lang,
    [
      "Bạn là KỸ SƯ đang CHỌN tệp NGUỒN cần sửa. Ở LƯỢT NÀY bạn KHÔNG viết mã.",
      "Nhận: ĐẦU RA LỖI test/build + CÂY TỆP NGUỒN THẬT.",
      "Chọn ĐÚNG MỘT tệp NGUỒN chứa NGUYÊN NHÂN lỗi. KHÔNG chọn tệp TEST (sửa test để ép pass là gian lận).",
      "Đường phải LẤY NGUYÊN VĂN TỪ CÂY TỆP — KHÔNG bịa, KHÔNG đường tuyệt đối.",
      "ĐẦU RA: ĐÚNG MỘT dòng, không giải thích, không khối mã:",
      `${MOC_TEP_KHUNG} <đường tương đối lấy từ cây tệp>`,
    ].join("\n"),
    [
      "You are an ENGINEER CHOOSING which SOURCE file to fix. In THIS turn you do NOT write code.",
      "You get: the test/build ERROR output + the REAL SOURCE FILE TREE.",
      "Pick EXACTLY ONE SOURCE file that holds the ROOT CAUSE. Do NOT pick a TEST file (editing tests to force a pass is gaming).",
      "The path MUST be copied VERBATIM FROM THE FILE TREE — do not invent, no absolute paths.",
      "OUTPUT: EXACTLY one line, no explanation, no code block:",
      `${MOC_TEP_KHUNG} <relative path taken from the file tree>`,
    ].join("\n"),
    [
      "你是正在选择要修复哪个源文件的工程师。本轮你不写代码。",
      "你会得到：测试/构建错误输出 + 真实源文件树。",
      "选出恰好一个含有根因的源文件。不要选测试文件（改测试来强行通过属于作弊）。",
      "路径必须逐字取自文件树——不要臆造，不要绝对路径。",
      "输出：严格一行，不解释，不加代码块：",
      `${MOC_TEP_KHUNG} <取自文件树的相对路径>`,
    ].join("\n"),
  );
}

/** Prompt bước 1: cây tệp + lỗi ⇒ model trả đúng một dòng `### FILE: <đường>`. */
function promptChonTep(lang: KbLanguage, loi: string, cayTep: string): string {
  const nhanCay = wt(lang, "CÂY TỆP NGUỒN (chọn đường TỪ đây)", "SOURCE FILE TREE (pick a path FROM here)", "源文件树（从此处选择路径）");
  const nhanLoi = wt(lang, "ĐẦU RA LỖI TEST/BUILD", "TEST/BUILD ERROR OUTPUT", "测试/构建错误输出");
  const yeuCau = wt(
    lang,
    "Chọn ĐÚNG tệp NGUỒN cần sửa (KHÔNG tệp test). Trả đúng MỘT dòng: `### FILE: <đường từ cây>`.",
    "Pick the SOURCE file to fix (NOT a test). Return exactly ONE line: `### FILE: <path from the tree>`.",
    "选择要修复的源文件（非测试）。仅返回一行：`### FILE: <取自树的路径>`。",
  );
  return [`=== ${nhanCay} ===`, cayTep, "", `=== ${nhanLoi} ===`, loi, "", yeuCau].join("\n");
}

/** Cây tệp NGUỒN THẬT (qua `list_files`) để model CHỌN đường — không bịa. `""` ⇒ không liệt kê được. */
async function cayTepNguon(execCtx: ToolExecContext, loi?: string): Promise<string> {
  /**
   * ★★★ G6 (audit 2026-09-21) — CÂY PHẢI **CHỨA** TỆP CẦN SỬA, NẾU KHÔNG BƯỚC 1 KHÔNG THỂ ĐÚNG.
   *
   * Lỗi đo được: bộ đo agentic **0/3**, và nhật ký chẩn đoán chỉ đúng chỗ chết —
   * *"bước 1: model không chọn được tệp trong cây · cây 4.246 ký tự"*. Bản cũ liệt kê
   * `{depth: 3}` rồi `.slice(0, 200)` trên một repo ~7.616 tệp; tệp cần sửa
   * (`sandbox-projects/agentic-demo/src/kho.mjs`) nằm ở **TẦNG 4** ⇒ **không hề có mặt trong cây**.
   * Model không chọn được là ĐÚNG — lỗi ở cái cây, không ở model.
   *
   * Bản vá: dùng đầu ra lỗi suy ra **THƯ MỤC** ứng viên (`ai/thuMucTuLoi`) rồi liệt kê TRONG những
   * thư mục ấy TRƯỚC, phần chung lấp nốt trần.
   *
   * ⚠⚠ ĐÂY KHÔNG PHẢI `trichTepTuLoi` đã bị gỡ 2026-08-24. Cái cũ suy ra **TỆP**, và live cho thấy
   *   nó luôn trúng **tệp TEST** ⇒ model sửa test để gaming. Cái này suy ra **THƯ MỤC**; việc chọn
   *   TỆP vẫn do **MODEL** làm, vẫn qua `phanQuyetDuongDan`, vẫn bị cờ audit `laTepTest` soi.
   *   Không suy được thư mục nào ⇒ **lùi về đúng hành vi cũ**, không đổi một byte.
   */
  const rieng: Array<{ path: string; kind: string }> = [];
  for (const tm of thuMucTuLoi(loi)) {
    const r = await executeDecision({ tool: "list_files", args: { path: tm, depth: 3 } }, execCtx);
    const e = (r.result?.data as { entries?: Array<{ path: string; kind: string }> } | undefined)?.entries ?? [];
    rieng.push(...e);
  }
  const lf = await executeDecision({ tool: "list_files", args: { depth: 3 } }, execCtx);
  const chung = (lf.result?.data as { entries?: Array<{ path: string; kind: string }> } | undefined)?.entries ?? [];
  const thay = new Set<string>();
  const gop: Array<{ path: string; kind: string }> = [];
  for (const e of [...rieng, ...chung]) {
    if (thay.has(e.path)) continue;
    thay.add(e.path);
    gop.push(e);
  }
  if (gop.length === 0) return "";
  return gop
    .slice(0, 400)
    .map((e) => (e.kind === "dir" ? `${e.path}/` : e.path))
    .join("\n");
}

/** Trần token cho lượt CHỌN tệp — đầu ra chỉ một dòng đường dẫn nên nhỏ. */
const TRAN_TOKEN_CHON_TEP = 512;

/**
 * BƯỚC 1 — một lượt model NGẮN chọn tệp; server nhận CHỈ đường TRONG CÂY (`chonDuongTuTri`). Model
 * bịa đường (không trong cây) ⇒ `null` ⇒ vòng dừng an toàn.
 */
async function chonTepTuTri(loi: string, cay: string, execCtx: ToolExecContext, language: KbLanguage): Promise<string | null> {
  const gen = motLuotModel({
    heThong: personaChonTep(language),
    ghepPrompt: () => promptChonTep(language, loi, cay),
    tranToken: TRAN_TOKEN_CHON_TEP,
    loai: "chon-tep", // ★ B1 — lớp PHỤ: trả JSON đường tệp, KHÔNG nghĩ (512 tok + nghĩ ⇒ rỗng, đo sống)
    language,
    history: [],
    relPath: "(chọn tệp)",
    userId: execCtx.user?.id,
    signal: execCtx.signal,
  });
  let r = await gen.next();
  while (!r.done) r = await gen.next();
  const lm = r.value;
  if (lm.kq !== "chu") return null;
  return chonDuongTuTri(lm.text, cay);
}

/**
 * ★★★ `sinhBanVa` THẬT — **HAI BƯỚC** (model chọn tệp → server ĐỌC nội dung THẬT → model sửa khớp byte).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ HAI GỐC RỄ TỪ NGHIỆM THU LIVE 30B (2026-08-24) — VÀ ĐÁNH ĐỔI "ĐÚNG-HƠN-NHANH"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * #1 regex-nhặt-tệp-đầu trỏ tệp TEST (đường tuyệt đối) ⇒ **để MODEL chọn tệp** (bước 1).
 * #2 model một-lượt viết SEARCH theo TRÍ NHỚ ⇒ lệch byte ⇒ từ chối valid-fix. Gốc: prompt bước-viết
 *    KHÔNG có nội dung tệp. ⇒ **bước 2 = `chuanBiBanSuaMotTep`** — đường SỬA thường ĐÃ chạy tốt: nó
 *    ĐỌC tệp thật (`read_file`) rồi nhét NGUYÊN VĂN vào prompt ⇒ model COPY neo khớp byte, KHÔNG đoán.
 * ⚠ ĐÁNH ĐỔI: HAI lượt model (~8 phút/vòng-lặp). Chấp nhận vì đường tự-ghi-KHÔNG-người thì
 *   **đúng-hơn-nhanh** — fuzzy-neo trên nội dung thật là đường CẤM (áp nhầm chỗ trong im lặng).
 *
 * ⚠⚠ RANH GIỚI GIỮ NGUYÊN: hàm CHỈ SINH `{path, original, modified}` — **KHÔNG ghi** (byte rời đĩa ở
 *   `chayLuotTuTriGhi`). Bước 2 (`chuanBiBanSuaMotTep`) DỪNG ngay trước lượt đề xuất — không cửa ghi thứ hai.
 * ⚠ CHỐNG "model bịa đường": bước 1 nhận CHỈ đường TRONG CÂY (`chonDuongTuTri`); tệp bịa/không tồn tại
 *   ⇒ `null`. Bước 2 đọc lại tệp — neo model gửi lệch byte ⇒ `apDungKhoiSua` từ chối ⇒ `null` (thà từ
 *   chối còn hơn áp nhầm). Mọi `null` ⇒ vòng DỪNG an toàn (`loi: không sinh được bản vá`).
 * ⚠ TÁI DÙNG: `motLuotModel` (bước 1) · `chuanBiBanSuaMotTep` (bước 2, gồm đọc-tệp + persona sửa +
 *   `thuThapNguCanhMa` + `bocKhoiSua`/`apDungKhoiSua`) — KHÔNG bộ sinh thứ ba.
 */
function taoSinhBanVaTuTri(y: {
  language: KbLanguage;
  context: KbQueryContext;
  execCtx?: ToolExecContext;
  history: readonly LuotHoiThoai[];
  khoiBaiHoc: string;
  projectId?: string;
}): SinhBanVa {
  /**
   * ★★★ G6 (audit 2026-09-21) — **SÁU ĐƯỜNG `return null` NAY ĐỀU NÓI RA LÝ DO.**
   * Trước lượt này cả sáu im lặng, và người dùng chỉ nhận đúng một câu *"không sinh được bản vá"* —
   * không biết vòng tự trị chết ở BƯỚC NÀO. Đo được: bộ đo agentic 0/3, và phải đọc mã mới đoán
   * được vì sao. Repo có bất biến "im lặng là nói dối"; sáu nhánh này đang vi phạm nó.
   * ⚠ Chỉ THÊM nhật ký — KHÔNG đổi một nhánh quyết định nào.
   */
  const chet = (buoc: string, chiTiet = "") => {
    console.warn(`[tuTriGhi] KHÔNG sinh được bản vá — chết ở bước "${buoc}"${chiTiet ? `: ${chiTiet}` : ""}`);
    return null;
  };
  return async (loi, _luot) => {
    const execCtx = y.execCtx;
    if (!execCtx) return chet("execCtx vắng");
    if (!(await codingModelSanSang())) return chet("model chưa sẵn sàng");

    // CÂY TỆP NGUỒN THẬT (chống bịa đường). Không liệt kê được ⇒ dừng an toàn.
    let cay = await cayTepNguon(execCtx, loi);
    if (cay === "") return chet("cây tệp nguồn RỖNG");

    /**
     * ★★★ G6 (audit 2026-09-21) — **MỘT TỆP TRẢ "KHÔNG ĐỔI" THÌ LOẠI NÓ RỒI CHỌN LẠI.**
     *
     * Đo được trên bài agentic HAI LỖI Ở HAI TỆP (`.goc2`): vòng 1 sửa đúng `kho.mjs` (2 test đỏ
     * → 1), vòng 2 model **CHỌN LẠI `kho.mjs`** — tệp nó vừa sửa xong và nay đã đúng — nên bước 2
     * trả `kq=khong_doi` và cả vòng CHẾT. Lỗi thật nằm ở `ca.mjs`, tệp mà `kho.mjs` nhập vào.
     * Kết quả: A1 (1 lỗi) 3/3, **A2 (2 lỗi) 0/3**.
     *
     * ⚠ **TRẦN VÒNG KHÔNG PHẢI NGUYÊN NHÂN** — đã đo: vòng dừng ở lượt 2/3, tức trần 3 CHƯA bó, và
     *   thời gian 8 s < trần 20 s. Nâng trần lên 8 vòng/180 s (đề xuất ban đầu của bản thiết kế)
     *   sẽ KHÔNG cứu được ca này. Đây là lý do phải đo trước khi chỉnh ngưỡng.
     *
     * Bản vá: "không đổi" là một câu trả lời CÓ THÔNG TIN — nó nói *"tệp này không phải chỗ sai"*.
     * Loại nó khỏi CÂY rồi cho model chọn lại: model không thể chọn lại thứ vừa vô ích, vì nó
     * không còn trong danh sách. Giữ nguyên mọi hàng rào (model vẫn chọn, server vẫn xác thực).
     */
    const daThu = new Set<string>();
    for (let lan = 0; lan < 3; lan++) {
      // BƯỚC 1 — model CHỌN tệp. Server nhận CHỈ đường TRONG CÂY ⇒ tồn tại + không bịa.
      const duong = await chonTepTuTri(loi, cay, execCtx, y.language);
      if (duong === null) return chet("bước 1: model không chọn được tệp trong cây", `cây ${cay.length} ký tự · đã thử ${daThu.size}`);
      if (phanQuyetDuongDan(duong) !== null) return chet("bước 1: đường bị hộp cát từ chối", duong);
      if (daThu.has(duong)) return chet("bước 1: model chọn lại tệp đã thử", duong);
      daThu.add(duong);

      // BƯỚC 2 — `chuanBiBanSuaMotTep` ĐỌC nội dung THẬT vào prompt ⇒ model sinh SEARCH/REPLACE khớp BYTE.
      //   Rút cạn generator (không phát token model ra ngoài — tiến độ do điểm gọi tự stream).
      const cauSua = wt(
        y.language,
        `Sửa tệp NGUỒN này để lỗi test/build sau biến mất (sửa đúng nguyên nhân, KHÔNG sửa tệp test):\n${loi}`,
        `Fix this SOURCE file so the following test/build error disappears (fix the real cause, do NOT edit tests):\n${loi}`,
        `修复此源文件以消除以下测试/构建错误（修复根因，不要修改测试）：\n${loi}`,
      );
      const gen = chuanBiBanSuaMotTep({
        question: cauSua,
        duong,
        language: y.language,
        context: y.context,
        execCtx,
        history: y.history,
        yDinhTao: false,
        khoiBaiHoc: y.khoiBaiHoc,
        phatTheTool: false,
      });
      let r = await gen.next();
      while (!r.done) r = await gen.next();
      const bs = r.value;
      if (bs.kq === "ok") return { path: bs.relPath, original: bs.original, modified: bs.modified };

      // CHỈ `khong_doi` mới đáng thử tệp khác. Mọi kết cục khác là hỏng THẬT ⇒ dừng, nói ra.
      if (bs.kq !== "khong_doi") return chet("bước 2: không dựng được bản sửa khớp byte", `${duong} · kq=${bs.kq}`);
      console.warn(`[tuTriGhi] "${duong}" KHÔNG cần đổi — loại khỏi cây, chọn lại (lần ${lan + 1}/3).`);
      const bo = new Set([duong, `${duong}/`]);
      cay = cay.split("\n").filter((d) => !bo.has(d)).join("\n");
      if (cay.trim() === "") return chet("bước 1: cây rỗng sau khi loại các tệp không cần đổi");
    }
    return chet("bước 2: thử 3 tệp đều KHÔNG cần đổi");
  };
}

/** Một dòng tiến độ người-đọc-được cho MỘT móc `TienDoTuTri`. */
function dongTienDoTuTri(lang: KbLanguage, t: TienDoTuTri): string {
  const dau = wt(lang, "vòng tự trị", "autonomous loop", "自主循环");
  const luot = `${wt(lang, "lượt", "turn", "轮")} ${t.luot}/${t.tran}`;
  if (t.pha === "sua") {
    return `[${dau}] ${luot} · ${wt(lang, "đang tự sửa…", "self-fixing…", "正在自动修复…")}`;
  }
  if (t.xanh) {
    return `[${dau}] ${luot} · ${wt(lang, "test ĐÃ XANH", "tests GREEN", "测试已通过")}`;
  }
  const soDo = t.soDo ?? "?";
  return `[${dau}] ${luot} · ${soDo} ${wt(lang, "test đỏ", "failing test(s)", "个失败测试")}`;
}

/** Câu TỔNG khi vòng kết thúc — nói THẲNG xanh / dừng-vì-gì + đã ghi mấy lượt. */
function cauTongTuTri(lang: KbLanguage, kq: KetQuaVongTuTri): string {
  // batDau=false: câu tới được đây đã qua `laYDinhTuTri`, nên lý do DUY NHẤT còn lại là **cờ TẮT**.
  if (!kq.batDau) {
    return wt(
      lang,
      "Vòng tự trị đang TẮT — bật `AI_CODING_TU_TRI_GHI=1` và `AI_CODING_AUTOLOOP=1` rồi khởi động lại.",
      "Autonomous loop is OFF — set `AI_CODING_TU_TRI_GHI=1` and `AI_CODING_AUTOLOOP=1`, then restart.",
      "自主循环已关闭——请设置 `AI_CODING_TU_TRI_GHI=1` 与 `AI_CODING_AUTOLOOP=1` 后重启。",
    );
  }
  const soGhi = kq.luots.filter((l) => l.path !== null).length;
  const daGhi = wt(lang, `đã ghi ${soGhi} lượt vào sổ WORM`, `wrote ${soGhi} turn(s) to the WORM log`, `已向 WORM 日志写入 ${soGhi} 次`);
  if (kq.lyDo === "xanh") {
    return wt(
      lang,
      `Vòng tự trị: test **ĐÃ XANH** sau ${kq.soLuot} lượt (${daGhi}).`,
      `Autonomous loop: tests are **GREEN** after ${kq.soLuot} turn(s) (${daGhi}).`,
      `自主循环：${kq.soLuot} 轮后测试**已通过**（${daGhi}）。`,
    );
  }
  const viDung = ((): string => {
    switch (kq.lyDo) {
      case "tep_ban_nguoi":
        return wt(lang, "tệp đích có thay đổi CHƯA LƯU của bạn — KHÔNG ghi đè", "the target file has UNSAVED changes — refused to overwrite", "目标文件有未保存的改动——已拒绝覆盖");
      case "kill_switch":
        return wt(lang, "kill-switch đã bật giữa vòng", "the kill-switch tripped mid-loop", "循环中途触发了急停开关");
      case "het_tran":
        return wt(lang, `hết trần ${kq.soLuot} lượt, test vẫn chưa xanh`, `hit the ${kq.soLuot}-turn cap, tests still not green`, `已达 ${kq.soLuot} 轮上限，测试仍未通过`);
      case "khong_tien_bo":
        return wt(lang, "không tiến bộ (số test đỏ không giảm / đầu ra lặp)", "no progress (failing count not shrinking / output repeats)", "没有进展（失败数未减少/输出重复）");
      case "co_tat":
        return wt(lang, "thiếu cờ `AI_CODING_AUTOLOOP=1` (vòng tự-ghi cần CẢ HAI cờ)", "missing `AI_CODING_AUTOLOOP=1` (self-write loop needs BOTH flags)", "缺少 `AI_CODING_AUTOLOOP=1`（自写循环需要两个开关）");
      case "khong_quyen":
        return wt(lang, "thiếu quyền chạy lệnh kiểm chứng", "missing permission to run the verify command", "缺少运行校验命令的权限");
      case "khong_co_lenh":
        return wt(lang, "không suy được lệnh kiểm chứng cho dự án này", "could not infer a verify command for this project", "无法为此项目推断校验命令");
      case "nguoi_tu_choi":
        return wt(lang, "người dùng đã hủy", "cancelled by the user", "用户已取消");
      default:
        return kq.message ?? wt(lang, "lỗi", "error", "错误");
    }
  })();
  return wt(
    lang,
    `Vòng tự trị DỪNG sau ${kq.soLuot} lượt: ${viDung}. (${daGhi})`,
    `Autonomous loop STOPPED after ${kq.soLuot} turn(s): ${viDung}. (${daGhi})`,
    `自主循环在 ${kq.soLuot} 轮后停止：${viDung}。（${daGhi}）`,
  );
}

/**
 * ★★★ ĐIỂM GỌI: chạy vòng tự-trị-ghi + STREAM tiến độ từng lượt, rồi câu tổng.
 *
 * ⚠ HÀNG CHỜ + LỜI HỨA ĐÁNH THỨC — cùng khuôn đường tool (`streamAnswer`): một generator KHÔNG
 *   `yield` được từ trong callback `onTien`, nên tiến độ đi qua hàng chờ rồi được rút ở vòng `while`.
 *   Không có nó, người dùng nhìn màn hình đứng im tới nhiều PHÚT (tới 10 lượt × model + test).
 * ⚠ LUÔN kết thúc bằng một câu tổng + `done`; điểm gọi ở `streamCodingAnswer` RETURN ngay sau, nên
 *   một câu `laYDinhTuTri` không bao giờ rơi xuống đường thường (kể cả cờ TẮT ⇒ nói THẲNG "TẮT").
 */
export async function* streamCodingTuTriGhi(
  question: string,
  language: KbLanguage,
  context: KbQueryContext,
  execCtx: ToolExecContext | undefined,
  history: readonly LuotHoiThoai[],
  khoiBaiHoc: string,
  projectId?: string,
): AsyncGenerator<StreamEvent> {
  const sinhBanVa = taoSinhBanVaTuTri({ language, context, execCtx, history, khoiBaiHoc, projectId });
  // Vòng tự-ghi ghi MÃ, nên cần một danh tính THẬT. Vắng phiên ⇒ vẫn đi qua `chayVongTuTriGhi` để
  // NÓI THẲNG lý do (cờ tắt ⇒ "TẮT"; cờ bật nhưng thiếu execCtx ⇒ `chayKiemChung` trả NO_EXEC_CONTEXT).
  const user: CopilotUser = execCtx?.user
    ? { id: execCtx.user.id, role: execCtx.user.role, name: execCtx.user.name ?? null }
    : { id: 0, role: "engineer", name: null };

  const hangCho: TienDoTuTri[] = [];
  let danhThuc: (() => void) | null = null;
  let xong = false;
  const loiHua = chayVongTuTriGhi({ projectId, cauHoi: question }, execCtx, user, language, sinhBanVa, (t) => {
    hangCho.push(t);
    danhThuc?.();
  });
  // Nhánh reject KHÔNG được để trơ (unhandled rejection giết tiến trình Node ≥15); `await loiHua`
  // dưới đây mới là nơi lỗi thật sự được xử lý.
  void loiHua.then(
    () => {},
    () => {},
  ).then(() => {
    xong = true;
    danhThuc?.();
  });
  while (true) {
    while (hangCho.length > 0) {
      const t = hangCho.shift()!;
      yield {
        type: "tool_loop",
        round: t.luot,
        phase: t.pha === "chay" ? "xong" : "dang_goi",
        toolName: t.pha === "chay" ? "run_command" : "apply_diff",
        elapsedMs: 0,
      };
      yield { type: "token", token: `\n${dongTienDoTuTri(language, t)}` };
    }
    if (xong) break;
    await new Promise<void>((r) => {
      danhThuc = () => {
        danhThuc = null;
        r();
      };
    });
  }
  const kq = await loiHua;
  const tong = cauTongTuTri(language, kq);
  yield { type: "token", token: `\n\n${tong}` };
  yield doneSinhMa(tong, kq.batDau ? "ollama" : "tool");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ doc 79 (2026-08-20) — CHUẨN BỊ **MỘT** BẢN SỬA/TẠO: đọc đĩa → gọi model → dựng `modified`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠ VÌ SAO HÀM NÀY TỒN TẠI, VÀ VÌ SAO NÓ **KHÔNG** ĐỀ XUẤT GHI.
 *
 * Đường sửa MỘT tệp và đường sửa NHIỀU tệp cần **cùng một chính sách** cho mỗi tệp: đọc thật →
 * ngã ba tạo/sửa theo ĐĨA → bốn lý do fail-closed → ngân sách ngữ cảnh → gọi model → bóc khối mã →
 * đồng bộ xuống dòng. Chép chính sách ấy thành hai bản là đúng lớp lỗi mà cả repo này đã trả giá
 * nhiều lần (hai bản sao trôi khỏi nhau, bản cũ hơn lặng lẽ bỏ sót một hàng rào).
 *
 * ⇒ Hàm này gánh TOÀN BỘ chính sách một tệp và **dừng ngay trước lượt đề xuất**. Ai gọi nó cũng chỉ
 *   nhận được `{path, original, modified}` — tức nguyên liệu của một băm neo — chứ không nhận được
 *   một đường tắt nào tới đĩa. Việc đề xuất (một `apply_diff` hay một `apply_diff_batch`) là quyết
 *   định của NGƯỜI GỌI, và cả hai đều đi qua `executeDecision` ⇒ `proposeAction` ⇒ người bấm.
 *
 * ⚠ Nó **không phát `done`**: một lượt nhiều tệp có N lần chạy hàm này và chỉ được có MỘT `done`.
 *   Người gọi quyết định lúc nào kết thúc — đó cũng là lý do các câu từ chối được trả về (`traLoi`)
 *   thay vì tự phát ra ngoài.
 */
type BanSuaMotTep =
  /** Không đủ điều kiện chạy (cờ tắt · không có phiên · model chưa sẵn sàng) ⇒ người gọi đi đường khác. */
  | { kq: "bo_qua" }
  /** Đã có `{original, modified}` — nguyên liệu cho MỘT băm neo. */
  | { kq: "ok"; relPath: string; original: string; modified: string; taoMoi: boolean; vanBanModel: string }
  /** Model trả lại đúng nội dung cũ (hoặc rỗng khi TẠO) — không phải sự cố, chỉ là không có gì để áp. */
  | { kq: "khong_doi"; relPath: string; traLoi: string; provider: "ollama" | "tool"; degraded?: { reason: string } }
  /** Dừng có lý do trung thực (hộp cát · fail-closed · ngân sách · model hỏng). */
  | { kq: "dung"; relPath: string; traLoi: string; provider: "ollama" | "tool"; degraded?: { reason: string } };

async function* chuanBiBanSuaMotTep(y: {
  question: string;
  duong: string;
  language: KbLanguage;
  context: KbQueryContext;
  execCtx?: ToolExecContext;
  history: readonly LuotHoiThoai[];
  yDinhTao: boolean;
  /** ★ doc 82 — chuỗi khối bài học ĐÃ BỌC; `""` ⇒ không có. Đi thẳng vào `prompt`, không đi đâu khác. */
  khoiBaiHoc?: string;
  /**
   * Phát thẻ `tool` cho lượt `read_file` này hay không.
   * ⚠ Đường NHIỀU TỆP đặt `false` vì một sự thật ĐO ĐƯỢC về client: `AICodingWorkspace` giữ
   *   `streamTool` là **một ô** và `setStreamTool` **GHI ĐÈ** ⇒ phát N thẻ thì người dùng chỉ thấy
   *   thẻ CUỐI, tức N−1 tệp trở thành nguồn ẩn. Đường ấy tự dựng MỘT thẻ tổng ở cuối.
   */
  phatTheTool: boolean;
}): AsyncGenerator<StreamEvent, BanSuaMotTep> {
  const { question, duong, language, context, execCtx, history, yDinhTao } = y;
  const khoiBaiHoc = y.khoiBaiHoc ?? "";
  if (!codingEditEnabled()) return { kq: "bo_qua" };
  if (!execCtx) return { kq: "bo_qua" };
  if (!(await codingModelSanSang())) return { kq: "bo_qua" };

  const rf = await executeDecision({ tool: "read_file", args: { path: duong } }, execCtx);
  if (!rf.result) return { kq: "bo_qua" }; // lỗi/không chạy được ⇒ để đường tool tất định nói thật
  if (y.phatTheTool) yield { type: "tool", toolName: "read_file", toolResult: rf.result };

  /**
   * ★★★ doc 79 (2026-08-20) — **NGÃ BA TẠO / SỬA / TỪ CHỐI, VÀ ĐĨA LÀ NGƯỜI PHÁN QUYẾT.**
   *
   * `read_file` vừa chạy ở trên đã trả lời câu hỏi *"tệp có tồn tại không?"* bằng `NOT_FOUND` —
   * **không có `existsSync` thứ hai** ở đây, cùng nguyên tắc mà `ai/codingRepoContext.ts` đã dùng.
   * Bốn nhánh, và mỗi nhánh là một hành động khác của người dùng:
   *
   *   • chưa có + XIN TẠO   ⇒ TẠO: `original = ""`, băm neo là băm(""), `apply_diff` tự chứng minh
   *                            tệp thật sự chưa tồn tại (băm đĩa phải bằng băm("")).
   *   • chưa có + KHÔNG xin ⇒ nói thẳng NOT_FOUND **kèm cách xin TẠO** (hành vi cũ + một câu gợi ý).
   *   • ĐÃ CÓ + xin TẠO     ⇒ **TỪ CHỐI TƯỜNG MINH**, không âm thầm biến thành ghi đè. Đây là chỗ
   *                            "ghi đè im lặng" có thể sinh ra, và nó bị đóng ở ĐÂY chứ không phải
   *                            ở tool — tool chỉ đóng được bằng `BASE_MISMATCH`, một câu nói đúng
   *                            nhưng khó hiểu ("băm lệch") cho một người vừa gõ "tạo file".
   *   • ĐÃ CÓ + xin SỬA     ⇒ đường SỬA cũ, không đổi một byte.
   *
   * ⚠ Ngoại lệ có chủ ý ở nhánh ba: câu vừa mang động từ TẠO vừa mang động từ SỬA (*"thêm file
   *   helper vào src/x.ts"* — `them` khớp cả hai) thì tệp ĐÃ CÓ nghĩa là ý người dùng là SỬA. Chỉ
   *   khi câu **chỉ** nói TẠO mới từ chối.
   */
  const chuaCo = rf.result.note === "NOT_FOUND";
  const xinTao = chuaCo && yDinhTao;
  if (rf.result.note && !xinTao) {
    const m =
      chuaCo && !yDinhTao
        ? `${rf.result.textSummary ?? ""}\n\n${codingGoiYTaoTepMessage(language, duong)}`
        : (rf.result.textSummary ?? "");
    yield { type: "token", token: m };
    return { kq: "dung", relPath: duong, traLoi: m, provider: "tool" };
  }

  const d = rf.result.data as
    | { path?: string | null; content?: string | null; truncated?: boolean; redacted?: boolean }
    | undefined;
  const goc = xinTao ? "" : typeof d?.content === "string" ? d.content : null;
  const relPath = xinTao ? duong : typeof d?.path === "string" && d.path ? d.path : duong;

  if (!chuaCo && yDinhTao && !laYDinhSuaTep(question)) {
    const m = codingTepDaTonTaiMessage(language, relPath);
    yield { type: "token", token: m };
    return { kq: "dung", relPath, traLoi: m, provider: "tool" };
  }

  /**
   * ⚠ FAIL-CLOSED, ba lý do RIÊNG BIỆT — mỗi lý do một hành động khác của người dùng:
   *   • `truncated` — ta chỉ thấy MỘT PHẦN tệp ⇒ `original` sẽ không khớp băm đĩa ⇒ `BASE_MISMATCH`.
   *     Đề xuất một diff chắc chắn bị từ chối là làm phiền người duyệt.
   *   • `redacted`  — `read_file` đã CHE một chuỗi trông như bí mật ⇒ nếu model chép lại chỗ che ấy,
   *     ta vừa ghi `[REDACTED_SECRET]` ĐÈ LÊN mã thật. Đây là hỏng CÂM đúng nghĩa.
   *   • quá dài     — prompt không chở nổi cả tệp; sửa một tệp mà chỉ nhìn nửa đầu là đoán mò.
   */
  if (goc === null || d?.truncated === true || d?.redacted === true || goc.length > TRAN_KY_TU_TEP_SUA) {
    const ly =
      goc === null
        ? "NO_CONTENT"
        : d?.truncated === true
          ? "TRUNCATED"
          : d?.redacted === true
            ? "REDACTED"
            : "TOO_LARGE";
    const m = codingKhongTuSuaMessage(language, relPath, ly);
    yield { type: "token", token: m };
    return { kq: "dung", relPath, traLoi: m, provider: "tool" };
  }

  const nguCanh = await nguCanhDuAnChoPrompt(context, execCtx);

  /**
   * ★★★ 2026-08-23 — **MÃ THAM CHIẾU CHO ĐƯỜNG GHI.** Trước lượt này chỉ đường SINH MÃ có khối này;
   * ba đường ghi (sửa cả tệp · sửa theo khối · tạo tệp) mù hoàn toàn ngoài đúng tệp đang mở. Lý lẽ
   * + hai trục thẩm quyền/nhường chỗ nằm ở docblock `promptSinhMa` (`aiCodingAgent.ts`).
   *
   * ⚠ Dùng LẠI nguyên `thuThapNguCanhMa` — cùng cửa đọc `executeDecision({tool:"read_file"})`, cùng
   *   hộp cát/RBAC/gốc dự án/che bí mật. KHÔNG mở cửa đọc thứ hai.
   * ⚠ FAIL-SAFE: hàm ấy **không bao giờ ném** (docblock của chính nó); mọi trục trặc ⇒ khối rỗng ⇒
   *   đường sửa chạy y như trước lượt này.
   */
  const nguCanhMaSua = await thuThapNguCanhMa({
    cauHoi: question,
    projectRoot: execCtx.projectRoot,
    callerRole: execCtx.user?.role,
    docTep: async (duongTep, tranByte) => {
      const r = await executeDecision({ tool: "read_file", args: { path: duongTep, maxBytes: tranByte } }, execCtx);
      return r.result ?? null;
    },
  });
  const khoiMaSua = nguCanhMaSua.khoi;

  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★★ doc 79 (2026-08-21) — **ĐƯỜNG KHỐI ĐI TRƯỚC; CHÉP-CẢ-TỆP TỤT XUỐNG THÀNH ĐƯỜNG LÙI.**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Hai thứ đổi, và chỉ hai:
   *   • **thứ model phải phát ra** — vài khối `SEARCH/REPLACE` thay cho một bản chép lại cả tệp;
   *   • **trần token RA** — một hằng 4.000 thay cho `tranTokenChoTep(n)` bị kẹp ở 12.000.
   * KHÔNG đổi: hợp đồng `apply_diff` (`{path, original, modified}`), điểm neo băm, HITL, hộp cát,
   * hàng rào tệp bẩn, RBAC, danh sách tool. `original` vẫn là **byte đọc từ đĩa trong lượt này** và
   * `modified` là **chính byte ấy sau khi áp khối** — nên thẻ duyệt dựng diff từ vật thật, và diff
   * ấy nay chỉ chứa những dòng THẬT SỰ đổi (bản chép tay của model làm nhiễu cả tệp).
   *
   * ⚠ Lượt TẠO **không** đi đường khối: không có nội dung cũ để neo vào. Nó giữ nguyên đường
   *   chép-cả-tệp, một byte không đổi.
   */
  const duongKhoi = !xinTao && codingKhoiSuaEnabled();
  /** Chữ model đã phát ở một lượt khối HỎNG — người dùng đã đọc rồi, không được đánh rơi khi lùi. */
  let chuTruoc = "";

  if (duongKhoi) {
    const heThongK = personaSuaTepKhoi(language, nguCanh);
    const ghepK = (khoiLichSu: string, khoiBai: string, khoiMa: string): string =>
      promptSuaTepKhoi(relPath, goc, question, language, khoiLichSu, khoiBai, khoiMa);
    const lk = yield* motLuotModel({
      heThong: heThongK,
      ghepPrompt: ghepK,
      khoiBaiHoc,
      khoiNguCanhMa: khoiMaSua,
      tranToken: TRAN_TOKEN_KHOI_SUA,
      ghiDe: y.context.cheDoNghi, // ★ F3 — chế độ nghĩ người dùng chọn cho lượt
      loai: "khoi-sua", // ★ B1 — lớp NGHĨ: sửa mã, trần nới theo model biết nghĩ
      language,
      history,
      relPath,
      userId: execCtx.user?.id,
      signal: execCtx.signal,
    });
    if (lk.kq !== "chu") return { kq: "dung", relPath, traLoi: lk.traLoi, provider: lk.provider, degraded: lk.degraded };

    const boc = bocKhoiSua(lk.text);
    /**
     * ⚠ So khớp trên bản LF: model gần như luôn phát `\n`, còn tệp trên đĩa có thể là CRLF. Neo đúng
     *   từng ký tự mà lệch kiểu xuống dòng thì `indexOf` trả −1 — một lượt "neo không thấy" HOÀN
     *   TOÀN giả. Chuẩn hoá hai bên để SO, rồi `dongBoXuongDong` trả kiểu cũ về khi GHI.
     */
    const gocLF = goc.replace(/\r\n/g, "\n");
    const ap = boc.ok ? apDungKhoiSua(gocLF, boc.khoi) : null;
    if (ap?.ok) {
      const moiK = dongBoXuongDong(goc, ap.ketQua);
      if (moiK === goc) {
        const m = codingKhongDoiMessage(language, relPath);
        yield { type: "token", token: `\n\n${m}` };
        return { kq: "khong_doi", relPath, traLoi: `${lk.text}\n\n${m}`, provider: "ollama" };
      }
      return { kq: "ok", relPath, original: goc, modified: moiK, taoMoi: false, vanBanModel: lk.text };
    }

    /**
     * ⚠ `KHOI_KHONG_DOI` **KHÔNG phải khối hỏng**: các khối đã áp sạch, chỉ là chúng không đổi gì.
     *   Đây đúng nghĩa `moi === goc` của đường chép-cả-tệp. Đẩy nó xuống đường lùi là đốt thêm một
     *   lượt model 30B (~30 s) để hỏi lại đúng câu model vừa trả lời xong.
     */
    if (ap && !ap.ok && ap.ma === "KHOI_KHONG_DOI") {
      const m = codingKhongDoiMessage(language, relPath);
      yield { type: "token", token: `\n\n${m}` };
      return { kq: "khong_doi", relPath, traLoi: `${lk.text}\n\n${m}`, provider: "ollama" };
    }

    /**
     * ★★★ KHỐI HỎNG ⇒ **ĐƯỜNG LÙI, KHÔNG PHẢI IM LẶNG.**
     *
     * Lùi được hay không do `chepCaTepDuocKhong` phán — tức do trần token RA, đúng thứ đã bó đường
     * cũ. Tệp đủ nhỏ ⇒ chạy lại bằng persona chép-cả-tệp (mất thêm một lượt model, và ta NÓI RA
     * điều đó). Tệp quá lớn ⇒ **từ chối có mã**, kèm đích danh đoạn neo hỏng: đó là thứ người dùng
     * hành động được, khác hẳn "chờ 45 giây rồi nhận số không" của hôm qua.
     */
    const ma: MaKhoiHong = ap ? ap.ma : (boc as Extract<typeof boc, { ok: false }>).ma;
    const chiTiet = ap ? ap.chiTiet : (boc as Extract<typeof boc, { ok: false }>).chiTiet;
    const luiDuoc = chepCaTepDuocKhong(goc.length);
    const m = codingKhoiHongMessage(language, relPath, ma, chiTiet, luiDuoc);
    yield { type: "token", token: `\n\n${m}\n\n` };
    if (!luiDuoc) return { kq: "dung", relPath, traLoi: `${lk.text}\n\n${m}`, provider: "ollama" };
    chuTruoc = `${lk.text}\n\n${m}`;
  }

  const heThong = xinTao ? personaTaoTep(language, nguCanh) : personaSuaTep(language, nguCanh);
  /**
   * ⚠ Lượt TẠO KHÔNG suy trần token từ `goc.length` được — `goc` RỖNG, và `tranTokenChoTep(0)` cho
   * đúng cái sàn 1.400 token, tức một tệp mới sẽ bị cắt cụt ở khoảng 3,6 KB. Trần của lượt TẠO là
   * một hằng RIÊNG: nó không đo cái đang có, nó cấp chỗ cho cái sắp có.
   */
  const tranToken = xinTao ? TRAN_TOKEN_TAO_TEP : tranTokenChoTep(goc.length);
  const ghepPromptTep = (khoiLichSu: string, khoiBai: string, khoiMa: string): string =>
    xinTao
      ? promptTaoTep(relPath, question, language, khoiLichSu, khoiBai, khoiMa)
      : promptSuaTep(relPath, goc, question, language, khoiLichSu, khoiBai, khoiMa);

  const lm = yield* motLuotModel({
    heThong,
    ghepPrompt: ghepPromptTep,
    ghiDe: y.context.cheDoNghi, // ★ F3
    loai: "sua-tep", // ★ B1 — lớp NGHĨ: chép lại cả tệp có thay đổi
    khoiBaiHoc,
    khoiNguCanhMa: khoiMaSua,
    tranToken,
    language,
    history,
    relPath,
    userId: execCtx.user?.id,
    signal: execCtx.signal,
  });
  if (lm.kq !== "chu") {
    return { kq: "dung", relPath, traLoi: noiChu(chuTruoc, lm.traLoi), provider: lm.provider, degraded: lm.degraded };
  }

  const boc = bocKhoiMa(lm.text);
  if (boc === null) {
    const m = codingKhongCoKhoiMaMessage(language);
    yield { type: "token", token: `\n\n${m}` };
    return { kq: "dung", relPath, traLoi: noiChu(chuTruoc, `${lm.text}\n\n${m}`), provider: "ollama" };
  }

  /**
   * ⚠ Lượt TẠO KHÔNG dùng `dongBoXuongDong(goc, …)` được: hàm ấy suy kiểu xuống dòng TỪ TỆP GỐC, mà
   * ở đây gốc là chuỗi RỖNG ⇒ nó sẽ CẮT dòng trống cuối của mọi tệp mới. Xem `chuanHoaTepMoi`.
   */
  const moi = xinTao ? chuanHoaTepMoi(boc) : dongBoXuongDong(goc, boc);
  if (moi === goc) {
    const m = xinTao ? codingTaoRongMessage(language, relPath) : codingKhongDoiMessage(language, relPath);
    yield { type: "token", token: `\n\n${m}` };
    return { kq: "khong_doi", relPath, traLoi: noiChu(chuTruoc, `${lm.text}\n\n${m}`), provider: "ollama" };
  }

  return {
    kq: "ok",
    relPath,
    original: goc,
    modified: moi,
    taoMoi: xinTao,
    vanBanModel: noiChu(chuTruoc, lm.text),
  };
}

/** Nối phần chữ của lượt khối hỏng với phần chữ của lượt lùi. `""` ⇒ trả nguyên phần sau. */
function noiChu(truoc: string, sau: string): string {
  return truoc ? `${truoc}\n\n${sau}` : sau;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ doc 79 (2026-08-21) — MỘT LƯỢT GỌI MODEL: ngân sách → luồng → canh thoái hoá
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠ VÌ SAO TÁCH RA: đường KHỐI và đường CHÉP-CẢ-TỆP cần **cùng một** chính sách quanh lượt gọi
 * model (cân ngân sách bằng `dungKhoiLichSu` trên chuỗi THẬT sẽ gửi · bắt lỗi ném · canh vòng lặp
 * thoái hoá · phát token ra ngoài). Chép chính sách ấy thành hai bản là đúng lớp lỗi đã trả giá
 * nhiều lần ở repo này: hai bản trôi khỏi nhau, và bản lỏng hơn bao giờ cũng là bản đang chạy.
 *
 * ⚠ Nó **không phát `done`** và không quyết định gì về việc ghi — nó chỉ trả CHỮ, hoặc một lời từ
 *   chối trung thực đã có mã.
 */
type LuotModel =
  | { kq: "chu"; text: string }
  | { kq: "dung"; traLoi: string; provider: "ollama" | "tool"; degraded?: { reason: string } };

export async function* motLuotModel(y: {
  heThong: string;
  /**
   * ⚠ HAI tham số, không phải một: khối lịch sử **và** khối bài học. Cả hai phải nằm trong CHUỖI
   *   THẬT mà `kiemNganSachNguCanh` cân — nếu bài học được nối vào sau lượt cân thì ta lại đo một
   *   chuỗi khác chuỗi sẽ gửi, đúng lớp lỗi *"cái được đo không phải cái đang hỏng"*.
   */
  ghepPrompt: (khoiLichSu: string, khoiBaiHoc: string, khoiNguCanhMa: string) => string;
  /** ★ doc 82 — `""` ⇒ không có bài học nào cho lượt này. */
  khoiBaiHoc?: string;
  /** ★★★ 2026-08-23 — khối MÃ THAM CHIẾU của repo; `""` ⇒ không có. Xem `promptSinhMa`. */
  khoiNguCanhMa?: string;
  tranToken: number;
  /**
   * ★★★ B1 (2026-09-22) — LỚP của lượt (`ai/loaiLuot.ts`). BẮT BUỘC, không có mặc định: người thêm
   * một đường gọi mới phải xếp nó vào lớp NGHĨ (sinh/sửa/tạo khung) hay lớp PHỤ (chọn tệp, JSON…).
   * Lớp quyết hai thứ cùng lúc — có tắt `<think>` không, và trần token có được nới theo model không.
   * Đo sống: lượt chọn tệp 512 token với model nghĩ mặc định ⇒ `content ""`, `finish=length`.
   */
  loai: LoaiLuot;
  /** ★ F3 — chế độ nghĩ người dùng chọn (từ `context.cheDoNghi`); vắng ⇒ quy tắc lớp. */
  ghiDe?: CheDoNghi;
  language: KbLanguage;
  history: readonly LuotHoiThoai[];
  relPath: string;
  userId?: number;
  /** ★★★ 2026-08-23 — cờ huỷ của lượt; xem `YeuCauSinhChu.signal`. */
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent, LuotModel> {
  /**
   * ★★★ doc 81 · VIỆC 1 — LỊCH SỬ NHƯỜNG CHỖ CHO NỘI DUNG TỆP, theo CẤU TẠO.
   *
   * `ghepPrompt` dựng ĐÚNG chuỗi sẽ gửi lên model, nên phép cân là trên vật thật. Prompt gốc (đã
   * chở cả tệp) vượt trần ⇒ `soLuotGiu = 0` **và** `vuotTruocKhiCoLichSu = true`.
   *
   * ⚠⚠ ĐƯỜNG NHIỀU TỆP KHÔNG NỚI TRẦN NÀY MỘT BYTE: mỗi tệp cân RIÊNG bằng chính hàm này, nên trần
   *    slot 32.768 gặp phải **N lần một tệp**, không bao giờ là "N tệp trong một prompt".
   */
  let bai = y.khoiBaiHoc ?? "";
  let ma = y.khoiNguCanhMa ?? "";
  let lich = dungKhoiLichSu({
    lichSu: y.history,
    systemPrompt: y.heThong,
    maxTokens: y.tranToken,
    lang: y.language,
    ghepPrompt: (k) => y.ghepPrompt(k, bai, ma),
  });
  /**
   * ★★★ 2026-08-23 — **TẦNG NHƯỜNG CHỖ THỨ HAI: MÃ THAM CHIẾU ĐI TRƯỚC BÀI HỌC.**
   *
   * Thứ tự đầy đủ ở đường SỬA/TẠO nay là: `lịch sử → NGỮ CẢNH MÃ → BÀI HỌC → (từ chối NGAN_SACH)`
   * — **đúng thứ tự đường sinh mã đã dùng**, không phải một khuôn thứ hai (lý lẽ 8× kích thước và
   * "mã tái tạo được, bài học thì không" nằm ở docblock `promptSinhMa`).
   *
   * ⚠⚠ Ở đường SỬA tầng này KHÔNG hiếm như ở đường sinh mã: prompt đã chở nguyên văn tệp. Nó là lý
   *   do một khối mã tham chiếu **không bao giờ** biến một tệp đang sửa được thành lượt từ chối.
   */
  if (lich.vuotTruocKhiCoLichSu && ma !== "") {
    console.warn(
      `[aiLocalKnowledge] ngữ cảnh mã (${ma.length} ký tự) đẩy prompt sửa tệp vượt trần slot — ` +
        `BỎ ngữ cảnh mã và cân lại (lượt sửa vẫn chạy). tệp=${y.relPath}`,
    );
    ma = "";
    lich = dungKhoiLichSu({
      lichSu: y.history,
      systemPrompt: y.heThong,
      maxTokens: y.tranToken,
      lang: y.language,
      ghepPrompt: (k) => y.ghepPrompt(k, bai, ""),
    });
  }
  /**
   * ★★★ doc 82 — **BÀI HỌC NHƯỜNG CHỖ, KHÔNG LÀM CẢ LƯỢT NÉM.**
   *
   * `dungKhoiLichSu` đã bỏ hết lịch sử (và tầng trên đã bỏ ngữ cảnh mã) mà vẫn tràn
   * (`vuotTruocKhiCoLichSu`) ⇒ bỏ bài học rồi **cân LẠI bằng chính cái thước ấy**, chứ không ước
   * lượng bằng một phép trừ token thứ hai.
   *
   * ⚠ Đây là điều kiện để một bài học KHÔNG BAO GIỜ biến một tệp đang sửa được thành một lượt từ
   *   chối. Nếu vẫn tràn sau khi bỏ bài học thì nguyên nhân là TỆP QUÁ LỚN — và câu từ chối
   *   `NGAN_SACH` nói đúng nguyên nhân ấy, không đổ cho bài học.
   */
  if (lich.vuotTruocKhiCoLichSu && bai !== "") {
    console.warn(
      `[aiLocalKnowledge] khối bài học (${bai.length} ký tự) đẩy prompt sửa tệp vượt trần slot — ` +
        `BỎ bài học và cân lại (lượt sửa vẫn chạy). tệp=${y.relPath}`,
    );
    bai = "";
    lich = dungKhoiLichSu({
      lichSu: y.history,
      systemPrompt: y.heThong,
      maxTokens: y.tranToken,
      lang: y.language,
      ghepPrompt: (k) => y.ghepPrompt(k, "", ma),
    });
  }
  if (lich.vuotTruocKhiCoLichSu) {
    const m = codingKhongTuSuaMessage(y.language, y.relPath, "NGAN_SACH");
    yield { type: "token", token: m };
    return { kq: "dung", traLoi: m, provider: "tool" };
  }

  /**
   * ★★★ B1 — LỚP lượt quyết cả trần lẫn công tắc nghĩ, ở MỘT chỗ (`ai/loaiLuot.ts`):
   *   • lớp PHỤ (chọn tệp…) ⇒ trần gốc y nguyên + `disableThinking: true` — hết cảnh 512 token bị
   *     chuỗi suy luận nuốt trọn (đo sống: `content ""`, `finish=length`);
   *   • lớp NGHĨ (sửa tệp · khối sửa · tạo khung) ⇒ nghĩ BẬT và trần nới theo model biết nghĩ
   *     (`tranTokenSinhMa`: kẹp ctx/slot − prompt), lấy MAX với trần gốc để tạo khung 8.000 không co lại.
   * Cùng công thức với `streamCodingGenerate` (G18) — không dựng thước thứ hai.
   */
  const nghi = luotDuocNghi(y.loai, y.ghiDe);
  const promptLuot = y.ghepPrompt(lich.khoi, bai, ma);
  const tranNghi = nghi
    ? (() => {
        const ns = kiemNganSachNguCanh({ systemPrompt: y.heThong, prompt: promptLuot, maxTokens: 0 });
        return tranTokenSinhMa({
          ctxSlotTokens: ns.tranMoiSlot,
          tokenPrompt: ns.tokenVao,
          modelDaTungNghi: modelNenCoiLaBietNghi(process.env.GGUF_DEFAULT_MODEL || "default"),
          // ★ F3 "Nghĩ sâu" — trần mong muốn 32k (vẫn kẹp ctx); vắng ⇒ 16k như cũ.
          tranMongMuon: tranMongMuonChoCheDo(y.ghiDe),
        });
      })()
    : null;
  const tranLuot = tranTokenTheoLop(y.loai, y.tranToken, tranNghi, y.ghiDe);
  /** ★ F3 "Nghĩ sâu" — ngân sách nghĩ theo yêu cầu (chỉ "sau" + lớp nghĩ); `undefined` ⇒ không gửi. */
  const nganSachNghi = nganSachNghiChoLuot(y.loai, y.ghiDe);

  const dinhDanhModelLuot = process.env.GGUF_DEFAULT_MODEL || "default";
  /**
   * ★ B1 (2026-09-22) — mở luồng cho lượt này. `tatNghi` là CẦU CHÌ của lớp NGHĨ: lượt đầu đi theo lớp
   * (`!nghi`); nếu model tiêu HẾT trần lớp nghĩ vào `<think>` mà chưa phát ký tự nào (G5-D — đo sống
   * agentic-b1: khoi-sua 16.000 token, 36.104 ký tự suy luận, `content` rỗng ⇒ A2 lượt 2 ĐỎ), thì thử
   * lại ĐÚNG MỘT LẦN với nghĩ TẮT. Khác G18 ở sinh-ma (nới trần 3k→16k): ở đây trần ĐÃ là trần lớp nghĩ,
   * đòn bẩy còn lại duy nhất là tắt nghĩ — thà một bản sửa không-suy-luận còn hơn không có bản sửa.
   */
  let dungLuot: DungLuotModel | undefined;
  const moLuong = (tatNghi: boolean) =>
    rutChuCoCanh(
      streamCodingModel({
        systemPrompt: y.heThong,
        prompt: promptLuot,
        maxTokens: tranLuot,
        // ★ B7/F2 — số đo lượt, phát thành sự kiện `usage` sau khi luồng đóng (xem cuối hàm).
        onUsage: (u) => {
          dungLuot = u;
        },
        disableThinking: !nghi || tatNghi,
        ...(nghi && !tatNghi && nganSachNghi !== undefined ? { thinkingBudgetTokens: nganSachNghi } : {}),
        // Phạt lặp làm hỏng việc chép lại NGUYÊN VĂN (thụt đầu dòng, `}` liên tiếp…) — và một đoạn
        // NEO cũng là một bản chép nguyên văn, nên đường khối cần đúng con số này (repeat 1,0).
        // ★ B2 — hồ sơ sampling qua cần gạt A/B (`AI_SAMPLING_PROFILE`); vắng ⇒ đúng ba số cũ, y nguyên.
        //   "Nghĩ thật" = lớp lượt được nghĩ VÀ model biết nghĩ VÀ cầu chì chưa nổ.
        ...hoSoSamplingCho(
          { temperature: 0.15, topP: 0.9, repeatPenalty: 1.0 },
          nghi && !tatNghi && modelNenCoiLaBietNghi(dinhDanhModelLuot),
        ),
        userId: y.userId,
        // Chữ này SẼ được ghi ra đĩa ⇒ prompt phải tới model nguyên văn (xem `YeuCauSinhChu`).
        nguyenVanPrompt: true,
        // ★★★ 2026-08-23 — huỷ lan xuống model. Xem `YeuCauSinhChu.signal`.
        ...(y.signal ? { signal: y.signal } : {}),
      }),
    );
  let daTatNghi = false;
  let it = moLuong(false);
  // (`dungLuot` được `onUsage` của lượt cuối cùng ghi — lượt thử lại ghi đè lượt đã ném, đúng ý.)

  let kq: KetQuaChu;
  let daPhat = "";
  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★★ 2026-08-23 — **`try/finally` Ở ĐÂY LÀ THỨ LÀM CHO NÚT DỪNG CÓ NGHĨA.**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Vòng `for(;;)` này lái `it.next()` **BẰNG TAY** thay vì `for await…of`. Khác biệt không phải
   * chuyện phong cách: `for await…of` tự gọi `it.return()` khi thân vòng kết thúc đột ngột, còn
   * `for(;;)` thì **KHÔNG có móc dọn dẹp nào**.
   *
   * Chuỗi thật khi người dùng bấm Dừng: tuyến SSE thoát `for await` ⇒ `.return()` chạy ngược lên
   * chuỗi `yield*` ⇒ tới generator này, làm `yield` đang treo ném "return completion" ⇒ hàm thoát
   * ⇒ **và `it` nằm lại, treo vĩnh viễn ở một `yield` bên trong `rutChuCoCanh`**. Cái `for await`
   * bên trong `streamCodingModel` không bao giờ được đóng ⇒ `ggufStream` không bao giờ được đóng ⇒
   * `finally { reader.cancel() }` của `streamChatCompletion` **không bao giờ chạy** ⇒ một khe
   * llama-server bị giữ tới khi idle-timeout 120.000 ms nổ. Hai lần bấm Dừng = cả hai khe bận.
   *
   * `finally` của một async generator CÓ chạy khi `.return()` được gọi. Nên một dòng `it.return?.()`
   * ở đây là toàn bộ khoảng cách giữa "huỷ trên giấy" và "huỷ trên card".
   *
   * ⚠ `.catch(() => {})`: dọn dẹp hỏng KHÔNG được che mất lý do thật của lượt thoát (cùng lập
   *   trường với `finally` của `streamChatCompletion`).
   */
  try {
    for (;;) {
      let n: IteratorResult<string | ManhSuyLuan, KetQuaChu>;
      try {
        n = await it.next();
      } catch (e) {
        // ★ B1 — cầu chì lớp NGHĨ (xem `moLuong`). Chỉ khi: lượt thuộc lớp nghĩ · chưa phát ký tự nào
        //   (người dùng chưa thấy gì để bị nối hai nửa — luật G1) · lỗi đúng là G5-D · chưa từng tắt.
        if (nghi && daPhat === "" && !daTatNghi && nenThuLaiVoiTranRong(e, false)) {
          ghiModelDaNghi(dinhDanhModelLuot);
          await it.return(undefined as unknown as KetQuaChu).catch(() => {});
          daTatNghi = true;
          console.warn(
            `[aiLocalKnowledge] G18-B1: lượt "${y.loai}" trên model "${dinhDanhModelLuot}" tiêu hết trần ${tranLuot} ` +
              `vào SUY LUẬN mà chưa phát ký tự nào — thử lại MỘT lần với nghĩ TẮT.`,
          );
          it = moLuong(true);
          continue;
        }
        const m = codingModelErrorMessage(y.language, e);
        yield { type: "token", token: (daPhat ? "\n\n" : "") + m };
        return { kq: "dung", traLoi: daPhat ? `${daPhat}\n\n${m}` : m, provider: "tool" };
      }
      if (n.done) {
        kq = n.value;
        break;
      }
      // ★ F1 — mảnh suy luận: lên SSE kiểu riêng; KHÔNG vào `daPhat` (luật G1 "chưa phát ký tự" chỉ đếm mã).
      if (typeof n.value !== "string") {
        yield { type: "reasoning", token: n.value.suyLuan };
        continue;
      }
      daPhat += n.value;
      yield { type: "token", token: n.value };
    }
  } finally {
    await it.return(undefined as unknown as KetQuaChu).catch(() => {});
  }

  // ★ B7/F2 — phát số đo của lượt (kể cả khi lượt thoái hoá — số vẫn là số).
  if (dungLuot) yield { type: "usage", luot: y.loai, ...dungLuot };

  if (kq.degraded || !kq.text.trim()) {
    const m = codingThoaiHoaMessage(y.language, kq.reason);
    // Đã phát chữ rác ra rồi ⇒ `degraded:true` để client THAY chữ đã tích luỹ bằng câu sạch này.
    return { kq: "dung", traLoi: m, provider: "tool", degraded: { reason: kq.reason || "empty" } };
  }
  return { kq: "chu", text: kq.text };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ doc 79 (2026-08-20) — SỬA/TẠO **NHIỀU TỆP**: N lượt model, MỘT thẻ duyệt, N băm neo RIÊNG
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠⚠ BA RÀNG BUỘC ĐỊNH HÌNH TOÀN BỘ HÀM NÀY — đọc trước khi sửa một dòng nào.
 *
 * 1. **DANH SÁCH TỆP LÀ TẤT ĐỊNH, DO NGƯỜI DÙNG GÕ.** `trichMoiDuongDanRepo` đọc đúng những đường
 *    dẫn có trong câu hỏi. Không có đường nào cho model tự chọn tệp — phép đo LIVE 2026-08-19 cho
 *    thấy bộ chọn LLM bịa ra `…/toolRegistry.ts` cho một câu KHÔNG nêu tệp nào; nhân chuyện đó lên
 *    6 tệp là điều tệ nhất có thể làm ở một tool ghi.
 * 2. **MODEL ĐƯỢC GỌI MỘT TỆP MỘT LƯỢT.** Nhồi N tệp vào một prompt là cách chắc chắn nhất để vượt
 *    trần slot 32.768 (một tệp 57.000 ký tự đã sát trần — xem `TRAN_KY_TU_TEP_SUA`). Mỗi lượt cân
 *    riêng bằng chính `dungKhoiLichSu`/`kiemNganSachNguCanh`, nên trần token gặp phải **N lần một
 *    tệp**, không bao giờ là "N tệp cùng lúc". Cái đắt là THỜI GIAN (~30 s/tệp), và cái đó được bó
 *    bằng `TRAN_TEP_MOT_LUOT_SUA`, không bằng token.
 * 3. **DỪNG Ở TỆP ĐỎ ĐẦU TIÊN.** Một lô chỉ có nghĩa khi CẢ N tệp cùng đổi (đổi tên một hàm ở 5/8
 *    nơi là một cây mã hỏng). Đọc trượt tệp 2 mà vẫn chạy tiếp là đốt 4 phút model để đẻ ra một đề
 *    xuất chắc chắn sai — nên ta dừng, nói rõ tệp nào và vì sao, và KHÔNG đề xuất gì.
 *
 * Trả `true` ⇔ đã trả lời xong. `false` ⇒ người gọi đi tiếp đường một-tệp (KHÔNG mất lượt).
 */
export async function* streamCodingSuaNhieuTep(
  question: string,
  duongDs: readonly string[],
  language: KbLanguage,
  context: KbQueryContext,
  execCtx?: ToolExecContext,
  history: readonly LuotHoiThoai[] = [],
  yDinhTao = false,
  /** ★ doc 82 — khối bài học của lượt, dựng MỘT lần ở `streamCodingAnswer`; dùng chung cho cả lô. */
  khoiBaiHoc = "",
): AsyncGenerator<StreamEvent, boolean> {
  if (!codingEditEnabled()) return false;
  if (!execCtx) return false;
  if (!(await codingModelSanSang())) return false;

  if (duongDs.length > TRAN_TEP_MOT_LUOT_SUA) {
    const m = codingQuaNhieuTepMessage(language, duongDs.length);
    yield { type: "token", token: m };
    yield doneSinhMa(m, "tool");
    return true;
  }

  const banSua: Array<{ path: string; original: string; modified: string; taoMoi: boolean }> = [];
  const khongDoi: string[] = [];
  const vanBan: string[] = [];

  for (let i = 0; i < duongDs.length; i++) {
    const duong = duongDs[i]!;
    const dau = codingTieuDeTepMessage(language, i + 1, duongDs.length, duong);
    yield { type: "token", token: (i === 0 ? "" : "\n\n") + dau + "\n\n" };
    vanBan.push(dau);

    const bs = yield* chuanBiBanSuaMotTep({
      question,
      duong,
      language,
      context,
      execCtx,
      history,
      yDinhTao,
      khoiBaiHoc,
      // MỘT thẻ tool tổng ở cuối, không N thẻ — `streamTool` của client là một ô GHI ĐÈ.
      phatTheTool: false,
    });

    if (bs.kq === "bo_qua") return false; // cờ/model đổi trạng thái giữa chừng ⇒ nhường đường cũ
    if (bs.kq === "dung") {
      // Ràng buộc 3: dừng ngay, và nói rõ ta dừng ở tệp nào trong lô.
      const m = `${bs.traLoi}\n\n${codingLoDungMessage(language, bs.relPath, banSua.length)}`;
      yield { type: "token", token: `\n\n${codingLoDungMessage(language, bs.relPath, banSua.length)}` };
      yield doneSinhMa([...vanBan, m].join("\n\n"), bs.provider, bs.degraded);
      return true;
    }
    if (bs.kq === "khong_doi") {
      khongDoi.push(bs.relPath);
      vanBan.push(bs.traLoi);
      continue;
    }
    banSua.push({ path: bs.relPath, original: bs.original, modified: bs.modified, taoMoi: bs.taoMoi });
    vanBan.push(bs.vanBanModel);
  }

  if (banSua.length === 0) {
    const m = codingLoKhongDoiMessage(language, khongDoi);
    yield { type: "token", token: `\n\n${m}` };
    yield doneSinhMa([...vanBan, m].join("\n\n"), "ollama");
    return true;
  }

  /**
   * ★ MỘT thẻ tool tổng: mọi tệp đã ĐỌC TỪ ĐĨA trong lượt này, kèm số byte gốc/mới. Nó phát biểu
   * đúng thứ người duyệt cần biết trước khi nhìn thẻ duyệt — và nó là thẻ DUY NHẤT, nên không bị
   * ghi đè mất.
   */
  yield {
    type: "tool",
    toolName: "read_file",
    toolResult: {
      type: "action_result",
      title: "Đọc tệp trong repo",
      data: { files: banSua.map((b) => ({ path: b.path, bytes: b.original.length, created: b.taoMoi })) },
      textSummary:
        `Đã đọc ${duongDs.length} tệp từ đĩa trong lượt này; ${banSua.length} tệp có thay đổi:\n` +
        banSua
          .map((b) => `• ${b.path} — ${b.taoMoi ? "TẠO MỚI" : `${b.original.length} → ${b.modified.length} ký tự`}`)
          .join("\n") +
        (khongDoi.length > 0 ? `\nKHÔNG đổi: ${khongDoi.join(", ")}` : ""),
    },
  };

  /**
   * ★★★ MỘT tệp ⇒ `apply_diff` (client có sẵn `HunkDiffView` — thẻ duyệt giàu hơn hẳn).
   *     ≥2 tệp ⇒ `apply_diff_batch` — MỘT thẻ, N hành động, **N băm neo RIÊNG**.
   *
   * ⚠ Cả hai đều đi qua `executeDecision`, và `executeDecision` gửi MỌI `kind:"write"` vào
   *   `proposeAction` ⇒ HITL nguyên vẹn ở cả hai nhánh. Không có nhánh nào chạm đĩa ở đây.
   */
  const motTep = banSua.length === 1;
  const ten = motTep ? "apply_diff" : "apply_diff_batch";
  const args = motTep
    ? { path: banSua[0]!.path, original: banSua[0]!.original, modified: banSua[0]!.modified }
    : { files: banSua.map((b) => ({ path: b.path, original: b.original, modified: b.modified })) };

  const ad = await executeDecision({ tool: ten, args }, execCtx);
  if (ad.pendingAction) {
    yield { type: "pending_action", toolName: ten, pendingAction: ad.pendingAction };
    const m = ad.pendingAction.summary;
    yield { type: "token", token: `\n\n${m}` };
    yield doneSinhMa([...vanBan, m].join("\n\n"), "ollama");
    return true;
  }
  if (ad.denied) {
    const m = ad.denied.message;
    yield { type: "token", token: `\n\n${m}` };
    yield doneSinhMa([...vanBan, m].join("\n\n"), "tool");
    return true;
  }
  const m = codingErrorMessage(language, ten, ad.error ?? "PROPOSE_FAILED");
  yield { type: "token", token: `\n\n${m}` };
  yield doneSinhMa([...vanBan, m].join("\n\n"), "tool");
  return true;
}
