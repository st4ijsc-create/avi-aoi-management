/**
 * B8 (kế hoạch AI Local 2026-09-22 §2) — LUỒNG SINH MÃ của nhánh lập trình (`streamCodingGenerate`: ngữ cảnh
 * mã thật · trần token theo lớp model · thử lại khi cạn vào suy luận · chân nguồn · bổ sung `using` C# R2B),
 * tách NGUYÊN VĂN khỏi `aiLocalKnowledgeCoding.ts`. Điểm vào vẫn là `streamCodingAnswer` ở tệp đó.
 */
/**
 * B8 (kế hoạch AI Local 2026-09-22 §2) — NHÁNH LẬP TRÌNH của trợ lý AI Local (`context.codingMode === true`),
 * tách NGUYÊN VĂN khỏi `aiLocalKnowledgeService.ts` (7.333 dòng) để tệp gốc còn lại là KB‑QA + truy hồi +
 * định tuyến `streamAnswer`. Không đổi hành vi: thân mã giữ từng byte; `aiLocalKnowledgeService.ts`
 * re-export mọi tên từng export ở đây, nên người gọi và lưới cũ không đổi một dòng.
 *
 * Nội dung (theo thứ tự cũ): bài học lượt (doc 82) · khối đầu ra máy vào lịch sử · điểm vào
 * `streamCodingAnswer` · sửa một tệp / tự trị ghi / sửa nhiều tệp · tạo khung dự án · sinh mã
 * (`streamCodingGenerate` + bổ sung `using` C# R2B) · các câu thông báo ba ngôn ngữ.
 *
 * ⚠ Phụ thuộc NGƯỢC về service chỉ gồm kiểu (`KbLanguage`, `KbQueryContext`, `StreamEvent`) và hai hàm
 *   thuần (`resolveLanguage`, `extractStructuredResponse`) — chỉ gọi lúc CHẠY, không lúc nạp module, nên
 *   vòng import hai chiều này an toàn trong ESM.
 */
import fs from "node:fs";
import path from "node:path";
import { executeDecision, type ToolExecContext } from "./aiLocalTools";
import {
  tranTokenSinhMa,
  nenThuLaiVoiTranRong,
  ghiModelDaNghi,
  modelNenCoiLaBietNghi,
  TRAN_SINH_KHONG_NGHI,
} from "./ai/tranTokenSinhMa";
import { kiemNganSachNguCanh } from "./aiLlamaServerClient";
import { luotDuocNghi } from "./ai/loaiLuot";
import { nganSachNghiChoLuot, tranMongMuonChoCheDo } from "./ai/nghiSau";
import { hoSoSamplingCho } from "./ai/hoSoSampling";
/**
 * ★★★ doc 79 · TRỤC 1 (C) — cửa gọi model của TÁC NHÂN LẬP TRÌNH (persona + bộ cắt + bộ che + canh
 * thoái hoá + bóc khối mã). Xem `aiCodingAgent.ts` để biết vì sao nó KHÔNG nằm trong `services/ai/`.
 */
import { codingGenEnabled, codingModelSanSang, personaSinhMa, promptSinhMa, rutChuCoCanh, streamCodingModel, dungKhoiLichSu, type KetQuaChu, type LuotHoiThoai, type DungLuotModel, type ManhSuyLuan } from "./aiCodingAgent";
/**
 * ★★★ doc 79 · TRỤC 1 (D) — MỤC LỤC (chunk) → MÃ THẬT (đọc đĩa qua `read_file`). Xem docblock đầu
 * `ai/codingRepoContext.ts`: module ấy KHÔNG nhập `fs`; cửa đọc do CHÍNH file này tiêm vào.
 */
import { thuThapNguCanhMa, chanNguonNguCanhMa, type KetQuaNguCanhMa } from "./ai/codingRepoContext";
import { boSungUsingTrongVanBan, thongBaoBoSung } from "./ai/boSungUsingCSharp";
import type { KbLanguage, KbQueryContext, StreamEvent } from "./aiLocalKnowledgeService";
// ★ B8 — các câu thông báo ba ngôn ngữ đã tách sang `./aiLocalKnowledgeCodingThongBao.ts` (xem docblock đầu tệp đó).
import { codingModelErrorMessage, codingThoaiHoaMessage } from "./aiLocalKnowledgeCodingThongBao";
import { doneSinhMa, nguCanhDuAnChoPrompt } from "./aiLocalKnowledgeCoding";


/** Vì sao nhánh sinh mã KHÔNG chạy — mỗi lý do là một câu khác nhau với người dùng. */
export type LyDoKhongSinhMa = "xong" | "tat_co" | "model_offline";

/**
 * ★★★ NHÁNH SINH MÃ ĐA MỤC ĐÍCH — C#, TypeScript, React, PostgreSQL… KHÔNG dùng `ProgrammingKind`
 * của `aiProgrammingCopilot` (tập ấy CHỈ có PLC/robot/CNC: `iec61131-st`, `gcode`, `robot-tm`… —
 * nhét C# vào đó là khai sai loại rồi nhận lại prompt của một miền khác).
 */
export async function* streamCodingGenerate(
  question: string,
  language: KbLanguage,
  context: KbQueryContext,
  execCtx?: ToolExecContext,
  history: readonly LuotHoiThoai[] = [],
  /** ★ doc 82 — khối bài học ĐÃ BỌC của lượt; `""` ⇒ không có. Chỉ đi vào `prompt`. */
  khoiBaiHocVao = "",
  /**
   * ★★★ 2026-08-23 · MỤC 2.4 — **KHỐI MÃ CÓ SẴN, THAY CHO MỘT LƯỢT TRUY HỒI THỨ HAI.**
   *
   * Vắng (`undefined`) ⇒ hành vi cũ y nguyên: tự đi `thuThapNguCanhMa` (mục lục → đọc đĩa).
   * Có ⇒ dùng CHÍNH chuỗi này làm khối mã, **không** chạy truy hồi lần nữa.
   *
   * Người gọi duy nhất hôm nay là nhánh *"read tool vừa chạy + câu cần suy luận"*: kết quả tool ĐÃ
   * là mã đọc từ đĩa trong chính lượt này, nên đi tìm lại nó bằng embedding là trả tiền hai lần cho
   * cùng một thứ — và tệ hơn, lượt thứ hai có thể trả về **tệp khác** với thứ người dùng vừa hỏi.
   *
   * ⚠⚠ Người gọi **PHẢI** truyền một chuỗi ĐÃ BỌC (`sanitizeUntrustedBlock` + `wrapUntrustedBlock`).
   *   Nội dung tệp là dữ liệu KHÔNG TIN ĐƯỢC — nó do người viết repo (hoặc người gửi PR) quyết định.
   */
  khoiMaThayThe?: string,
): AsyncGenerator<StreamEvent, LyDoKhongSinhMa> {
  if (!codingGenEnabled()) return "tat_co";
  if (!(await codingModelSanSang())) return "model_offline";

  const nguCanh = await nguCanhDuAnChoPrompt(context, execCtx);
  /**
   * ★★★ G18 (audit 2026-09-22) — TRẦN TOKEN SINH MÃ THEO LỚP MODEL, không còn là hằng `3_000`.
   *
   * Đo được: model BIẾT NGHĨ (Qwen3.6-27B / 35B-A3B, nghĩ BẬT) tiêu **5.220 token/bài trung bình,
   * tối đa 8.015** trên bộ bài khó — trần 3.000 cắt cụt hoặc từ chối đúng những model chính xác
   * nhất (83 % chạy được ở trần đủ rộng). Dưới tiêu chí *"đúng trước nhanh"* của chủ dự án, đó là
   * kiểu sai nguy hiểm nhất: loại oan model tốt nhất trong im lặng.
   *
   * Cơ chế (lý lẽ đầy đủ ở `ai/tranTokenSinhMa.ts`, không lặp ở đây):
   *   • model chưa từng nghĩ ⇒ trần CŨ (3.000) — hành vi cũ không đổi một byte cho model không nghĩ;
   *   • model đã từng nghĩ (ô nhớ trong tiến trình) ⇒ trần rộng, kẹp theo ctx/slot − prompt;
   *   • lượt đầu với model lạ mà nổ `LoiTokenCanKietVaoSuyLuan` ⇒ ghi ô nhớ + THỬ LẠI MỘT LẦN
   *     (xem nhánh `nenThuLaiVoiTranRong` trong `catch` bên dưới).
   *
   * ⚠ Định danh model = `GGUF_DEFAULT_MODEL` (thứ người vận hành khai là model đang phục vụ). Ô nhớ
   *   khoá theo nó để một lượt đổi model không kế thừa kết luận của model trước.
   * ⚠ `tokenVao`/`tranMoiSlot` lấy từ `kiemNganSachNguCanh` — MỘT thước ước lượng token, dùng chung
   *   với cổng ngân sách ngữ cảnh của llama-server; không dựng thước thứ hai ở đây.
   */
  const dinhDanhModel = process.env.GGUF_DEFAULT_MODEL || "default";
  // ★ `modelNenCoiLaBietNghi` = ô nhớ lúc chạy HOẶC gợi ý theo tên đã đo (Qwen3.6/3.8) — bỏ thuế
  //   một lượt thử lại sau mỗi lần khởi động cho model mặc định mới (Qwen3.6-35B-A3B, 2026-09-22).
  //   Gợi ý sai chiều nào cũng rẻ; cơ chế thử-lại vẫn là sàn. Xem docblock trong `tranTokenSinhMa.ts`.
  const tinhTran = (systemPrompt: string, prompt: string, epRong: boolean): number => {
    const ns = kiemNganSachNguCanh({ systemPrompt, prompt, maxTokens: 0 });
    return tranTokenSinhMa({
      ctxSlotTokens: ns.tranMoiSlot,
      tokenPrompt: ns.tokenVao,
      modelDaTungNghi: epRong || modelNenCoiLaBietNghi(dinhDanhModel),
      // ★ F3 "Nghĩ sâu" — trần mong muốn 32k (vẫn kẹp ctx); vắng ⇒ 16k như cũ.
      tranMongMuon: tranMongMuonChoCheDo(context.cheDoNghi),
    });
  };
  // Trần dùng để CÂN lịch sử/ngữ cảnh mã (chưa có prompt cuối ⇒ lấy theo lớp model, không kẹp ctx).
  const MAX_TOKENS_SINH = modelNenCoiLaBietNghi(dinhDanhModel) ? tinhTran("", "", true) : TRAN_SINH_KHONG_NGHI;

  /**
   * ★★★ doc 79 · TRỤC 1 (D) — NGỮ CẢNH MÃ THẬT. Đây là nơi *"AI mù kiến trúc khi sinh mã"* được vá.
   *
   * ⚠ Cửa đọc tiêm vào là `executeDecision({tool:"read_file"})` — **cửa DUY NHẤT**. Không có
   *   `fs` nào ở `codingRepoContext.ts`, nên hộp cát/RBAC/gốc-dự-án/che-bí-mật/trần-byte đều được
   *   thừa hưởng nguyên vẹn thay vì dựng lại bằng trí nhớ.
   * ⚠ `execCtx` VẮNG ⇒ không tiêm cửa nào ⇒ `khong-cua-doc` ⇒ khối rỗng. Đúng: không có phiên thì
   *   không có RBAC để đi qua, và đọc mã không RBAC là một đường thoát.
   */
  /**
   * ★ K2 (2026-09-22) — ĐÃ THỬ và PHÉP ĐO BÁC: bỏ pha truy hồi cho đơn sinh mã "không neo vào repo" (không đường tệp,
   * không @tệp, không từ chỉ repo). Lý lẽ: câu "kiểm tra số nguyên tố" kéo `kiemTraCayDay.ts` vào prompt vì khớp chữ.
   * Ablation tắt hẳn ngữ cảnh (ctx 64k, budget 12k, 12 bài × 3): **27/36 = 75 % so 31/36 = 86 % CÓ ngữ cảnh** — py2 3→1,
   * py3 2→0, ts3 2→0 (cs3/ts1 ngược chiều +1). Tức ngữ cảnh repo giúp đúng NGAY CẢ khi "không liên quan" về chủ đề —
   * giả thuyết: khối mã thật làm mồi phong cách + persona "mã thật đứng trên trí nhớ" (§8.4) chỉ bật khi có ngữ cảnh.
   * ⇒ KHÔNG đặt cổng ở đây; muốn tiết kiệm token phải tách được hai hiệu ứng ấy trước (ablation "persona giữ, khối
   * mã rỗng"). Ghi để người sau không cắn lại: một ý tưởng hợp lý về "liên quan" đã bị 4 bài bác bỏ.
   */
  const nguCanhMa: KetQuaNguCanhMa =
    khoiMaThayThe != null
      ? { khoi: khoiMaThayThe, tokens: 0, tep: [], lyDo: "ok", soDuongDanMucLuc: 0 }
      : await thuThapNguCanhMa({
          cauHoi: question,
          projectRoot: execCtx?.projectRoot,
          callerRole: execCtx?.user?.role,
          docTep: execCtx
            ? async (duong, tranByte) => {
                const r = await executeDecision({ tool: "read_file", args: { path: duong, maxBytes: tranByte } }, execCtx);
                return r.result ?? null;
              }
            : (undefined as unknown as (d: string, b: number) => Promise<null>),
        });

  /**
   * ★★★ CHÍNH SÁCH NGÂN SÁCH — NHƯỜNG CHỖ THEO THỨ TỰ, CƯỠNG CHẾ BẰNG **CHÍNH** `kiemNganSachNguCanh`.
   *
   *     prompt gốc (persona + câu hỏi)  >  NGỮ CẢNH MÃ  >  LỊCH SỬ
   *
   * Cách cưỡng chế, và vì sao KHÔNG có thước thứ hai (bài học doc 81): khối mã được **nhét vào
   * `ghepPrompt`**, tức nó nằm trong cái mà `dungKhoiLichSu` đã đo bằng `kiemNganSachNguCanh` trên
   * CHUỖI THẬT sẽ gửi lên model. Nhờ thế:
   *   • lịch sử tự động nhường chỗ TRƯỚC (vòng `k` giảm dần bên trong `dungKhoiLichSu`) —
   *     bất biến của doc 81 còn nguyên, không phải viết lại;
   *   • chỉ khi prompt + ngữ cảnh mã + **0 lượt lịch sử** vẫn vượt trần (`vuotTruocKhiCoLichSu`)
   *     thì ngữ cảnh mã mới bị BỎ HẲN và ta cân LẠI — chứ không từ chối cả lượt sinh mã. Từ chối
   *     một câu hỏi vì ta vừa TỰ THÊM ngữ cảnh vào là biến một cải tiến thành một hồi quy.
   * ⚠ Đo thật: prompt sinh mã đầy đủ = 385 token vào + 3.000 ra ⇒ còn 29.383 token dư địa trên slot
   *   32.768, mà trần khối mã là 4.000 ⇒ nhánh nhường chỗ này gần như không bao giờ chạy. Nó vẫn
   *   phải tồn tại: "gần như không bao giờ" không phải "không bao giờ", và lịch sử có thể rất dài.
   */
  let khoiMa = nguCanhMa.khoi;
  /**
   * ★★★ doc 82 — BÀI HỌC chen vào **giữa** hai tầng đã có. Thứ tự nhường chỗ đầy đủ của đường sinh mã:
   *
   *      lịch sử  →  NGỮ CẢNH MÃ  →  BÀI HỌC  →  (không bao giờ) prompt gốc
   *
   * Lý lẽ đầy đủ (chênh lệch kích thước 8× · mã tái tạo được còn bài học thì không · thẩm quyền và
   * nhường chỗ là HAI TRỤC khác nhau) nằm ở docblock `promptSinhMa` trong `aiCodingAgent.ts` — một
   * chỗ, không hai bản.
   */
  let khoiBai = khoiBaiHocVao;
  /**
   * ★★★ VÁ LIVE 2026-08-20 — persona ĐƯỢC DỰNG SAU khi biết có mã hay không, và **dựng LẠI** khi
   * ngữ cảnh mã bị nhường chỗ. Đây không phải chuyện sắp xếp cho gọn: nếu persona nói *"mã thật đã
   * được đọc, hãy dựa vào nó"* trong một lượt mà khối mã vừa bị bỏ vì hết ngân sách, ta vừa dạy
   * model tin vào một khối KHÔNG TỒN TẠI — đúng lớp lỗi mà cả mục này sinh ra để chống.
   */
  /**
   * ★ ABLATION (2026-09-22, DỤNG CỤ ĐO — mặc định TẮT, không phải tính năng): tách hai hiệu ứng của "có ngữ cảnh mã".
   * Đường cong đo được: 0 ⇒ 75 % · 4k ⇒ 86 % · 8k ⇒ 75 %. Câu hỏi còn lại: 11 điểm của 4k đến từ BYTE MÃ THẬT hay từ PERSONA
   * "mã thật đứng trên trí nhớ" (chỉ bật khi có khối)? `AI_CODING_ABLATION_NGU_CANH`:
   *   · `persona-khong-khoi` — giữ persona "có ngữ cảnh", KHÔNG đưa khối mã vào prompt;
   *   · `khoi-khong-persona` — đưa khối mã, persona như "không có ngữ cảnh";
   *   · mọi giá trị khác / vắng ⇒ hành vi thật. Đọc env TẠI THỜI ĐIỂM GỌI, in log khi bật để không chạy nhầm cấu hình.
   * ⚠ Không bao giờ bật trong sản xuất.
   */
  const ablation = (process.env.AI_CODING_ABLATION_NGU_CANH ?? "").trim();
  let personaCoNguCanh = khoiMa !== "";
  if (ablation === "persona-khong-khoi" && khoiMa !== "") {
    console.warn(`[aiLocalKnowledge] ABLATION persona-khong-khoi: giữ persona có ngữ cảnh, BỎ khối mã (${nguCanhMa.tokens} token).`);
    khoiMa = "";
    personaCoNguCanh = true;
  } else if (ablation === "khoi-khong-persona" && khoiMa !== "") {
    console.warn(`[aiLocalKnowledge] ABLATION khoi-khong-persona: giữ khối mã (${nguCanhMa.tokens} token), persona như KHÔNG có ngữ cảnh.`);
    personaCoNguCanh = false;
  }
  let heThong = personaSinhMa(language, nguCanh, personaCoNguCanh);
  let lich = dungKhoiLichSu({
    lichSu: history,
    systemPrompt: heThong,
    maxTokens: MAX_TOKENS_SINH,
    lang: language,
    ghepPrompt: (khoi) => promptSinhMa(question, language, khoi, khoiMa, khoiBai),
  });
  if (lich.vuotTruocKhiCoLichSu && khoiMa !== "") {
    console.warn(
      `[aiLocalKnowledge] ngữ cảnh mã (${nguCanhMa.tokens} token, ${nguCanhMa.tep.length} tệp) đẩy prompt vượt ` +
        `trần slot — BỎ ngữ cảnh mã và cân lại (lượt sinh mã vẫn chạy).`,
    );
    khoiMa = "";
    heThong = personaSinhMa(language, nguCanh, false);
    lich = dungKhoiLichSu({
      lichSu: history,
      systemPrompt: heThong,
      maxTokens: MAX_TOKENS_SINH,
      lang: language,
      ghepPrompt: (khoi) => promptSinhMa(question, language, khoi, "", khoiBai),
    });
  }
  /**
   * ★★★ doc 82 — TẦNG NHƯỜNG CHỖ THỨ BA. Chỉ chạy khi đã bỏ HẾT lịch sử **và** đã bỏ ngữ cảnh mã mà
   * vẫn tràn. Bỏ bài học rồi cân lại bằng CHÍNH `dungKhoiLichSu` — không có thước thứ hai ở đây.
   *
   * ⚠ Persona KHÔNG phải dựng lại ở nhánh này (khác nhánh ngữ cảnh mã ngay trên): persona chưa bao
   *   giờ khai gì về bài học — khối bài học TỰ mô tả mình và nằm trọn trong `prompt`. Đó chính là
   *   tính chất làm cho *"bài học không nới được quyền"* đúng theo cấu tạo chứ không theo lời hứa.
   */
  if (lich.vuotTruocKhiCoLichSu && khoiBai !== "") {
    console.warn(
      `[aiLocalKnowledge] khối bài học (${khoiBai.length} ký tự) đẩy prompt sinh mã vượt trần slot — ` +
        "BỎ bài học và cân lại (lượt sinh mã vẫn chạy).",
    );
    khoiBai = "";
    lich = dungKhoiLichSu({
      lichSu: history,
      systemPrompt: heThong,
      maxTokens: MAX_TOKENS_SINH,
      lang: language,
      ghepPrompt: (khoi) => promptSinhMa(question, language, khoi, khoiMa, ""),
    });
  }
  /** Tệp THỰC SỰ vào prompt. Rỗng khi ngữ cảnh mã bị nhường chỗ ⇒ KHÔNG khoe thẻ/chân nguồn dối. */
  const tepDaDung = khoiMa === "" ? [] : nguCanhMa.tep;

  /**
   * ★★★ NGƯỜI DÙNG PHẢI THẤY — MỘT thẻ tool liệt kê MỌI tệp đã vào prompt, phát **trước** khi model
   * nói một chữ. Dùng lại đúng khuôn `action_result` mà `AIToolResultCard` đã render (nó không nằm
   * trong `KNOWN_CARD_TYPES` nên hiện thẳng `textSummary`) ⇒ **không có nhãn client mới**, không
   * đụng `viStringCoverage`/`t()`.
   *
   * ⚠⚠ **MỘT thẻ, không phải N thẻ** — và đây là một sự thật ĐO ĐƯỢC về client, không phải sở
   *    thích: `AICodingWorkspace` giữ `const [streamTool, setStreamTool]` là **một ô duy nhất** và
   *    `onToolResult: (tr) => setStreamTool(tr)` **GHI ĐÈ**. Phát ba thẻ ⇒ người dùng chỉ thấy thẻ
   *    CUỐI ⇒ hai tệp kia trở thành nguồn ẩn — đúng thứ mục này sinh ra để chống.
   * ⚠ Con số là **số ký tự ĐÃ VÀO PROMPT**, không phải kích thước tệp: thẻ phải nói sự thật về cái
   *   model NHÌN THẤY, nếu không nó chỉ dời lời khai lệch sang một chỗ khác.
   */
  if (tepDaDung.length > 0) {
    const dongTep = tepDaDung.map(
      (t) =>
        `• ${t.duong} — ${t.byteTrenDia} byte trên đĩa; ${t.kyTuVaoPrompt} ký tự vào ngữ cảnh` +
        `${t.daCat ? " (ĐÃ CẮT theo ngân sách token)" : ""}`,
    );
    yield {
      type: "tool",
      toolName: "read_file",
      toolResult: {
        type: "action_result",
        title: "Đọc tệp trong repo",
        data: { files: tepDaDung.map((t) => ({ path: t.duong, bytes: t.byteTrenDia, truncated: t.daCat })) },
        textSummary: `Đã đọc ${tepDaDung.length} tệp từ đĩa để trả lời:\n${dongTep.join("\n")}`,
      },
    };
  }

  const promptCuoi = promptSinhMa(question, language, lich.khoi, khoiMa, khoiBai);
  let dungSinhMa: DungLuotModel | undefined;
  // ★ F3 — chế độ nghĩ người dùng chọn; "nhanh" tắt nghĩ cả lượt sinh mã (ý người dùng thắng quy tắc lớp).
  const cheDoNghi = context.cheDoNghi;
  const sinhMaDuocNghi = luotDuocNghi("sinh-ma", cheDoNghi);
  const moLuong = (tran: number) =>
    rutChuCoCanh(
      streamCodingModel({
        // ★ G4 — tầng model người dùng chọn cho lượt này (bộ chọn ở màn lập trình). Vắng ⇒ mặc định hệ.
        tacVu: (context as { modelTask?: unknown })?.modelTask,
        systemPrompt: heThong,
        prompt: promptCuoi,
        maxTokens: tran,
        // ★ B7/F2 — số đo lượt sinh mã (lượt G18 thử lại ghi đè lượt đã ném — đúng ý).
        onUsage: (u) => {
          dungSinhMa = u;
        },
        // ★ B2 — hồ sơ sampling qua cần gạt A/B; vắng ⇒ đúng bộ cũ (0,25 · 0,9 · repeat 1,05), y nguyên.
        // ★ F3 — "nhanh" ⇒ gửi `enable_thinking=false`; còn lại để template quyết (undefined ⇒ hành vi cũ).
        ...(sinhMaDuocNghi ? {} : { disableThinking: true }),
        // ★ F3 "Nghĩ sâu" — `thinking_budget_tokens` 24k; cân bằng/nhanh ⇒ không gửi (mặc định server 12k).
        ...(sinhMaDuocNghi && nganSachNghiChoLuot("sinh-ma", cheDoNghi) !== undefined
          ? { thinkingBudgetTokens: nganSachNghiChoLuot("sinh-ma", cheDoNghi) }
          : {}),
        ...hoSoSamplingCho(
          { temperature: 0.25, topP: 0.9, repeatPenalty: 1.05 },
          sinhMaDuocNghi && modelNenCoiLaBietNghi(dinhDanhModel),
        ),
        userId: execCtx?.user?.id,
        // ★★★ 2026-08-23 — huỷ lan xuống model. Xem `motLuotModel` cho lý lẽ đầy đủ.
        ...(execCtx?.signal ? { signal: execCtx.signal } : {}),
      }),
    );
  // ★ G18 — trần THẬT cho lượt này: kẹp theo ctx/slot − prompt cuối (xem `tinhTran`).
  let epRong = false;
  let tran = tinhTran(heThong, promptCuoi, epRong);
  let it = moLuong(tran);

  let kq: KetQuaChu;
  let daPhat = "";
  // ★★★ 2026-08-23 — xem khối `try/finally` cùng lý lẽ ở `motLuotModel`: vòng lái tay không có móc
  //   dọn dẹp, nên thiếu `finally` thì `.return()` của tuyến SSE dừng lại đúng ở đây và khe
  //   llama-server bị giữ tới idle-timeout 120.000 ms.
  try {
    for (;;) {
      let n: IteratorResult<string | ManhSuyLuan, KetQuaChu>;
      try {
        n = await it.next();
      } catch (e) {
        /**
         * ★★★ G18 — THỬ LẠI ĐÚNG MỘT LẦN khi model tiêu hết trần vào chuỗi suy luận mà chưa phát ký
         * tự mã nào. Đây là cách duy nhất để tín hiệu "model này biết nghĩ" được ĐO lúc chạy thay vì
         * được KHAI trong `.env` (một cờ bị quên hỏng trong im lặng: trần tụt về 3.000, chất lượng
         * rơi, không lỗi nào nổ).
         *
         * An toàn để thử lại vì lớp lỗi này, theo định nghĩa (`phanDinhCauTraLoiRong`), là *"chưa
         * phát ký tự nào ra content"* ⇒ `daPhat === ""` ⇒ người dùng chưa thấy gì để bị nối hai nửa.
         * Có chữ rồi thì KHÔNG thử lại — đúng luật G1 của `quyetDinhSauLoiServer`. `epRong` chặn
         * lặp: lượt đã rộng mà vẫn nổ thì đi thẳng xuống thông báo lỗi trung thực bên dưới.
         */
        if (daPhat === "" && nenThuLaiVoiTranRong(e, epRong)) {
          ghiModelDaNghi(dinhDanhModel);
          await it.return(undefined as unknown as KetQuaChu).catch(() => {});
          epRong = true;
          tran = tinhTran(heThong, promptCuoi, epRong);
          console.warn(
            `[aiLocalKnowledge] G18: model "${dinhDanhModel}" tiêu hết hạn mức vào SUY LUẬN — ` +
              `ghi nhận model biết nghĩ, thử lại MỘT lần ở trần ${tran}.`,
          );
          it = moLuong(tran);
          continue;
        }
        const m = codingModelErrorMessage(language, e);
        yield { type: "token", token: (daPhat ? "\n\n" : "") + m };
        yield doneSinhMa(daPhat ? `${daPhat}\n\n${m}` : m, "tool");
        return "xong";
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

  // ★ B7/F2 — số đo lượt sinh mã, phát trước `done`.
  if (dungSinhMa) yield { type: "usage", luot: "sinh-ma", ...dungSinhMa };

  if (kq.degraded || !kq.text.trim()) {
    const m = codingThoaiHoaMessage(language, kq.reason);
    yield doneSinhMa(m, "tool", { reason: kq.reason || "empty" });
    return "xong";
  }

  /**
   * ★★★ CHÂN NGUỒN — nối vào CHUỖI, không chỉ vào một sự kiện SSE. Một phiên đã lưu chỉ giữ
   * `{role, content}` (bất biến `locLuot()`), nên thẻ tool ở trên BIẾN MẤT khi mở lại phiên cũ;
   * chân nguồn sống trong `content` nên nó ở lại. Im lặng ở đây là để người dùng không phân biệt
   * được "AI đọc mã thật" với "AI bịa" — đúng thứ lượt này sinh ra để chữa.
   */
  const chan = chanNguonNguCanhMa(tepDaDung, language === "en" ? "en" : language === "zh" ? "zh" : "vi");
  if (chan) yield { type: "token", token: chan };

  /**
   * ★★★ R2 phần B (chủ dự án chọn "sau sinh, tất định", 2026-09-23) — BỔ SUNG `using` C# còn thiếu theo
   * chỉ mục tham chiếu API (`ai/boSungUsingCSharp.ts`). Mã đã STREAM xong nên không thể sửa lại token
   * đã gửi ⇒ `done.answer` mang văn bản ĐÃ SỬA + `answerRevised: true` (client THAY văn bản đã tích luỹ,
   * cùng khuôn `degraded`), kèm một câu NÓI RÕ đã thêm gì và vì sao. Đo ngoại tuyến trên 35 khối C# thật
   * của các lượt duan trước: biên dịch được 21 → 34, 0 khối đang đúng bị làm hỏng; 228 lời giải C# trục
   * H/M: 0 lần đụng. Tắt để ablation: `AI_CODING_BO_SUNG_USING=0`.
   */
  const boSung = boSungUsingChoCauTraLoi(kq.text, language);
  if (boSung) {
    yield { type: "token", token: boSung.thongBao };
    const doneDaSua = doneSinhMa(boSung.text + chan + boSung.thongBao, "ollama") as Extract<StreamEvent, { type: "done" }>;
    yield { ...doneDaSua, answerRevised: true };
    return "xong";
  }
  yield doneSinhMa(kq.text + chan, "ollama");
  return "xong";
}

let chiMucUsingCache: import("./ai/boSungUsingCSharp").ChiMucUsing | null | undefined;
/** `null` khi tắt / không có chỉ mục / không có gì để bổ sung. Không bao giờ ném. */
function boSungUsingChoCauTraLoi(text: string, language: KbLanguage): { text: string; thongBao: string } | null {
  if (String(process.env.AI_CODING_BO_SUNG_USING ?? "").trim() === "0") return null;
  try {
    if (chiMucUsingCache === undefined) {
      const p = path.join(process.cwd(), "knowledge", "api-ref", "dotnet-using.json");
      chiMucUsingCache = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
    }
    if (!chiMucUsingCache) return null;
    const r = boSungUsingTrongVanBan(text, chiMucUsingCache);
    if (r.them.length === 0) return null;
    const lang: "vi" | "en" | "zh" = language === "en" ? "en" : language === "zh" ? "zh" : "vi";
    console.log(`[aiLocalKnowledge] bổ sung using C#: ${r.them.map((t) => `${t.ns}←${t.vi.join(",")}`).join("; ")}`);
    return { text: r.text, thongBao: thongBaoBoSung(r.them, lang) };
  } catch (e) {
    console.warn("[aiLocalKnowledge] bổ sung using C# lỗi (bỏ qua, giữ nguyên mã):", (e as Error)?.message);
    return null;
  }
}
