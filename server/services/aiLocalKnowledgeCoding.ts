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
import { tryExecuteCodingToolLoop, executeDecision, type ToolExecContext, type ToolLoopProgress } from "./aiLocalTools";
/**
 * ★★★ doc 79 · TRỤC 1 (C) — bộ chọn tool LẬP TRÌNH TẤT ĐỊNH, dùng LẠI NGUYÊN VẸN để hỏi
 * *"câu này có nêu một đường dẫn tệp không?"* trước khi quyết định ĐỌC hay SỬA. Nhập từ module con
 * để KHÔNG mở thêm một bộ trích đường dẫn thứ hai (hai bộ trích = hai sự thật về cùng một câu).
 */
import {
  classifyCodingToolIntent,
  laCauCanSuyLuan,
  laYDinhTaoDuAn,
  laYDinhTuTri,
  trichDuongSuaTatDinh,
  trichMoiDuongDanRepo,
} from "./aiLocalTools/intentClassifier";
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
import { cauChiNenNo } from "./ai/toolDuongTat";
import { laCauSinhMa } from "./ai/cauSinhMa";
import { thuMucTuLoi } from "./ai/thuMucTuLoi";
import { vanBanChoModel } from "./ai/vanBanChoModel";
import {
  tranTokenSinhMa,
  nenThuLaiVoiTranRong,
  ghiModelDaNghi,
  modelNenCoiLaBietNghi,
  TRAN_SINH_KHONG_NGHI,
} from "./ai/tranTokenSinhMa";
import { kiemNganSachNguCanh } from "./aiLlamaServerClient";
import { luotDuocNghi, tranTokenTheoLop, type LoaiLuot, type CheDoNghi } from "./ai/loaiLuot";
import { hoSoSamplingCho } from "./ai/hoSoSampling";
/**
 * ★★★ doc 79 · TRỤC 1 (C) — cửa gọi model của TÁC NHÂN LẬP TRÌNH (persona + bộ cắt + bộ che + canh
 * thoái hoá + bóc khối mã). Xem `aiCodingAgent.ts` để biết vì sao nó KHÔNG nằm trong `services/ai/`.
 */
import {
  apDungKhoiSua,
  bocKhoiMa,
  bocKhoiSua,
  bocManifestKhung,
  chepCaTepDuocKhong,
  chuanHoaTepMoi,
  codingEditEnabled,
  codingGenEnabled,
  codingKhoiSuaEnabled,
  codingModelSanSang,
  chonDuongTuTri,
  dongBoXuongDong,
  MOC_MO,
  MOC_TEP_KHUNG,
  personaSinhMa,
  personaSuaTep,
  personaSuaTepKhoi,
  personaTaoKhung,
  personaTaoTep,
  promptSinhMa,
  promptSuaTep,
  promptSuaTepKhoi,
  promptTaoKhung,
  promptTaoTep,
  rutChuCoCanh,
  streamCodingModel,
  tranTokenChoTep,
  TRAN_KY_TU_TEP_SUA,
  TRAN_TOKEN_KHOI_SUA,
  // ★★★ 2026-08-23 — hai hằng của khối lịch sử; `TRAN_KY_TU_DAU_RA_MAY` SUY RA từ chúng, không gõ tay.
  TRAN_KY_TU_MOI_LUOT,
  HAU_TO_CAT_LUOT,
  KY_TU_MOI_TOKEN_RA,
  dungKhoiLichSu,
  type KetQuaChu,
  type LuotHoiThoai,
  type MaKhoiHong,
  type MaManifestKhung,
  // ★ B7/F2 — kiểu số đo một lượt model, gắn vào sự kiện SSE `usage`.
  type DungLuotModel,
} from "./aiCodingAgent";
/**
 * ★★★ doc 79 · TRỤC 1 (D) — MỤC LỤC (chunk) → MÃ THẬT (đọc đĩa qua `read_file`). Xem docblock đầu
 * `ai/codingRepoContext.ts`: module ấy KHÔNG nhập `fs`; cửa đọc do CHÍNH file này tiêm vào.
 */
import {
  thuThapNguCanhMa,
  chanNguonNguCanhMa,
  TRAN_TOKEN_NGU_CANH_MA,
  type KetQuaNguCanhMa,
} from "./ai/codingRepoContext";
/**
 * ★★★ doc 82 · BỘ NHỚ XUYÊN PHIÊN — bài học người dùng tự khai, đọc ngược vào prompt.
 *
 * ⚠ `khoiBaiHocChoPrompt` trả về một chuỗi **ĐÃ BỌC** trong khối dữ liệu không tin cậy của
 *   `ai/aiSafety` (quét tiêm · trung hoà dấu rào · che bí mật · chỉ dẫn KHÔNG THI HÀNH). File này
 *   chỉ **nhét chuỗi ấy vào `prompt`** — không bao giờ vào `systemPrompt`, không vào một quyết
 *   định nào. Xem khối "vì sao bài học không nới được quyền" ở `ai/codingLessonContext.ts`.
 */
import { baiHocEnabled, khoiBaiHocChoPrompt, lamSachBaiHoc } from "./ai/codingLessonContext";
import { bocYDinhBaiHoc, GIOI_HAN_BAI_HOC } from "@shared/aiCodingLesson";
import { boSungUsingTrongVanBan, thongBaoBoSung } from "./ai/boSungUsingCSharp";
// doc69 G2-3 (Wave 1, W1-1b) — this file is the MAIN production RAG assistant (reached via
// aiLocalKnowledgeApi.ts's /ask + /stream) and previously called aiGgufEngine directly,
// bypassing the AI Gateway entirely: zero safety (no redaction), zero metering on the
// surface users actually chat with. `planInference` (aiGateway's "cheapest adoption" path,
// see its own top-of-file doc comment) is wired into `generateWithOllama`/
// `generateWithOllamaStream` below with the SAME `{task:"chat", text: question}` input this
// file already used for `route()`, so `plan.decision.modelId` is byte-identical to before
// (pinned-model behavior preserved) — it only ADDS flag-gated/fail-safe input redaction
// (`plan.safeText`), output redaction (`plan.sanitizeOutput`/`StreamingSecretRedactor`), and
// gateway metering (`plan.record`). Reuses the G2-2 primitives verbatim — no redaction logic
// is reimplemented here.
import { sanitizeUntrustedBlock, wrapUntrustedBlock } from "./ai/aiSafety";
import type { KbLanguage, KbQueryContext, StreamEvent } from "./aiLocalKnowledgeService";
import { extractStructuredResponse, resolveLanguage } from "./aiLocalKnowledgeService";


// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ doc 79 · TRỤC 1 (B + C) — TÁC NHÂN LẬP TRÌNH (nhánh `codingMode`)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Persona + tập tool + cách nói của nhánh này ĐỘC LẬP hoàn toàn với đường vận hành:
 *   • persona = "tác nhân lập trình đọc/sửa/sinh mã" (KHÔNG `getSystemPromptForRole`);
 *   • tập tool = CHỈ 5 tool lập trình (`tryExecuteCodingTool` → `classifyCodingToolIntent`);
 *   • KHÔNG rơi vào RAG tri thức vận hành ở BẤT KỲ đường ra nào.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐÍNH CHÍNH BẢN THÂN KHỐI NÀY (2026-08-19) — TRƯỚC ĐÂY NÓ MÔ TẢ MỘT NGÕ CỤT VÀ GỌI ĐÓ LÀ THIẾT KẾ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản trục 1 (B) viết ở đây: *"KHÔNG tool nào khớp ⇒ nói thẳng 'nêu tệp/lệnh cụ thể'"* và
 * *"diễn giải-qua-LLM … cố ý để ngoài lần này"*. Hệ quả THẬT, chủ dự án báo cùng ngày: câu
 * *"viết code C# cho chương trình chat LAN sử dụng socket"* — không đường dẫn, không lệnh — nhận
 * lại một lời từ chối. Tức **mọi yêu cầu SINH MÃ đều bị từ chối theo cấu tạo**, và người dùng kết
 * luận (đúng) rằng "AI local không hoạt động". Một nhánh TẤT ĐỊNH không phải là một nhánh ĐẦY ĐỦ.
 *
 * TRỤC 1 (C) bổ sung HAI đường ra gọi model, và giữ nguyên mọi đường cũ:
 *   • **SỬA TỆP** (`streamCodingEdit`) — đứng TRƯỚC bộ chọn tool: đường dẫn + động từ sửa ⇒ đọc tệp
 *     THẬT → model dựng TOÀN BỘ tệp mới → `apply_diff` qua **HITL** (người duyệt mới ghi).
 *   • **SINH MÃ** (`streamCodingGenerate`) — thay cho ngõ cụt ở cuối.
 * Cả hai đi qua `aiCodingAgent.ts`: bộ cắt suy luận + bộ che bí mật + canh vòng lặp thoái hoá của
 * 30B (lớp lỗi CÓ THẬT ở repo này), và cả hai TẮT được bằng cờ — khi tắt thì rơi về đúng hành vi
 * trục 1 và **nói ra cờ nào đang tắt**, chứ không im lặng.
 *
 * ⚠ Đường ra của TOOL vẫn HIỆN NỘI DUNG THẬT (`provider: "tool"`), không diễn giải qua LLM: cổng ra
 * của TRỤC 1 là *"read_file hiện NỘI DUNG THẬT (không phải chunk RAG)"*, và nội dung thật nằm ở
 * `toolResult.textSummary`. Trục 1 (C) KHÔNG chạm đường ấy.
 */
/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ doc 82 — MỘT LƯỢT VỀ **BÀI HỌC** (ghi · liệt kê · quên). Trả về câu trả lời cho người dùng.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ⚠⚠ **VÌ SAO ĐƯỜNG SINH BÀI HỌC LÀ "NGƯỜI GÕ THẲNG", VÀ HAI ĐƯỜNG KIA THÌ KHÔNG** — tôi đã ĐO,
 *    không suy đoán:
 *
 *   • **"AI đề xuất → người TỪ CHỐI → hỏi lý do"**: tín hiệu từ chối **CÓ THẬT** và ở phía server —
 *     nút *"Hủy"* của `AICodingWorkspace` gọi `aiCopilot.cancelAction({actionId})`. Nhưng một lượt
 *     huỷ **không mang lý do**, và *"tôi đổi ý"* không phải một bài học. Biến nó thành bài học đòi
 *     một lượt hỏi "vì sao?" — tức một bề mặt client mới + 3 locale — và nếu tự SINH bài học từ
 *     một lượt huỷ trần thì ta chế ra những bài học người dùng chưa bao giờ đồng ý, rồi nhét chúng
 *     vào mọi prompt sau đó. Đó là chiều hỏng tệ nhất của cả tính năng này. ⇒ **Chưa làm.**
 *   • **"người sửa tay lại chính tệp đó trong X phút ⇒ diff là bài học"**: nghe hay nhất, và **ĐO
 *     ĐƯỢC LÀ KHÔNG CÓ CƠ CHẾ**. Không có bộ theo dõi tệp nào trên gốc hộp cát: `fs.watch`/
 *     `chokidar` trong `server/` chỉ xuất hiện ở `vision/hotFolderService.ts` (thư mục ảnh AOI) và
 *     `license/runtime-security.ts` — không cái nào nhìn `AI_REPO_SANDBOX_ROOTS`. Băm chống TOCTOU
 *     của `apply_diff` phát hiện được tệp đổi giữa ĐỀ XUẤT và DUYỆT, nhưng cửa sổ ấy là vài phút
 *     TTL và kết cục của nó là một lời từ chối, không phải một bài học. Dựng được thì phải thêm
 *     một sổ băm-sau-khi-ghi rồi so ở lượt `read_file` kế — làm được, nhưng nó chỉ trả lời *"có ai
 *     đó đã sửa"*, **không** rút ra được NỘI DUNG bài học nếu không gọi model hoặc hỏi lại người
 *     dùng. ⇒ **Không khai là có.**
 *
 *   ⇒ Còn lại một đường **tất định, đo được đầu-cuối, và không bao giờ bịa**: người dùng nói ra.
 *     Hệ **không bao giờ tự phát minh một bài học** — đó là một tính chất, không phải một thiếu sót.
 *
 * ⚠ Mọi chuỗi ở đây là chuỗi **SERVER** (ba ngôn ngữ, `w()`), nên lượt này thêm **0 nhãn client**
 *   ⇒ `viStringCoverage` và `i18n:check` không bị chạm.
 */
async function xuLyLuotBaiHoc(
  yDinh: NonNullable<ReturnType<typeof bocYDinhBaiHoc>>,
  language: KbLanguage,
  projectId: string,
  userId?: number,
): Promise<string> {
  const lang: "vi" | "en" | "zh" = language === "en" ? "en" : language === "zh" ? "zh" : "vi";
  const w3 = (vi: string, en: string, zh: string): string => (lang === "en" ? en : lang === "zh" ? zh : vi);

  /**
   * ⚠ KHÔNG có phiên đăng nhập ⇒ KHÔNG ghi, KHÔNG đọc. Bài học là dữ liệu thuộc một CHỦ SỞ HỮU;
   *   một hàng không có chủ là một hàng ai cũng đọc được — đúng thứ trục chủ sở hữu tồn tại để chặn.
   */
  if (!Number.isInteger(userId) || (userId as number) <= 0) {
    return w3(
      "⚠ Không xác định được tài khoản của bạn trong lượt này, nên tôi **không** ghi/đọc bài học. Bài học là dữ liệu riêng của từng người.",
      "⚠ I could not identify your account this turn, so I did **not** read or write any lesson. Lessons are per-user private data.",
      "⚠ 本轮无法确定你的账号，因此我**没有**读写任何经验。经验是每个用户的私有数据。",
    );
  }
  const uid = userId as number;
  const { danhSachBaiHoc, luuBaiHoc, xoaBaiHocTheoThuTu } = await import("../db/aiCodingLessons");

  if (yDinh.kieu === "liet_ke") {
    const ds = await danhSachBaiHoc(uid, projectId);
    if (ds.length === 0) {
      return w3(
        `📗 Chưa có bài học nào cho dự án **${projectId}**.\n\nGhi một bài học bằng cách gõ: \`nhớ giùm: <điều cần nhớ>\``,
        `📗 No lessons saved for project **${projectId}** yet.\n\nSave one by typing: \`remember: <what to remember>\``,
        `📗 项目 **${projectId}** 尚无已保存的经验。\n\n输入 \`记住：<需要记住的内容>\` 即可保存。`,
      );
    }
    const dong = ds.map((b, i) => `${i + 1}. ${b.noiDung}`).join("\n");
    return w3(
      `📗 **${ds.length} bài học** đã nhớ cho dự án **${projectId}** (chỉ mình bạn đọc được):\n\n${dong}\n\nXoá một mục: \`quên bài học <số>\``,
      `📗 **${ds.length} lesson(s)** remembered for project **${projectId}** (visible only to you):\n\n${dong}\n\nRemove one: \`forget lesson <number>\``,
      `📗 项目 **${projectId}** 已记住 **${ds.length} 条经验**（仅你可见）：\n\n${dong}\n\n删除某条：\`忘记经验 <编号>\``,
    );
  }

  if (yDinh.kieu === "quen") {
    const r = await xoaBaiHocTheoThuTu(uid, projectId, yDinh.thuTu);
    if (!r.ok) {
      return w3(
        `⚠ Không có bài học số **${yDinh.thuTu}** cho dự án **${projectId}**. Gõ \`liệt kê bài học\` để xem danh sách hiện tại.`,
        `⚠ There is no lesson **#${yDinh.thuTu}** for project **${projectId}**. Type \`list lessons\` to see the current list.`,
        `⚠ 项目 **${projectId}** 没有第 **${yDinh.thuTu}** 条经验。输入 \`list lessons\` 查看当前列表。`,
      );
    }
    return w3(
      `🗑 Đã quên bài học **#${yDinh.thuTu}**: "${r.noiDung}"`,
      `🗑 Forgot lesson **#${yDinh.thuTu}**: "${r.noiDung}"`,
      `🗑 已忘记第 **#${yDinh.thuTu}** 条经验："${r.noiDung}"`,
    );
  }

  /**
   * ★★★ CỬA GHI — LÀM SẠCH TRƯỚC, LƯU SAU. Bộ làm sạch là `ai/codingLessonContext.lamSachBaiHoc`,
   * tức chính `ai/aiSafety` (khuôn đã có của repo), **không** một bộ quét thứ hai viết ở đây.
   */
  const sach = lamSachBaiHoc(yDinh.noiDung);
  if (!sach.ok) {
    if (sach.ma === "rui_ro_cao") {
      /**
       * ⚠ Nêu ĐÍCH DANH nhãn mẫu đã khớp. Một lời từ chối không nói được nó từ chối CÁI GÌ là lời
       *   từ chối mà người dùng chỉ có thể thử lại một cách mù — và đó chính là chế độ hỏng mà
       *   `bocKhoiMa()` trả `null` đã bị ghi sổ (doc 79, 2026-08-21).
       */
      return w3(
        `🛑 **Không lưu bài học này.** Nó chứa hình dạng của một mưu toan **ghi đè chỉ dẫn hệ thống** (mẫu khớp: \`${sach.nhan.join("`, `") || "?"}\`).\n\n` +
          "Bài học được nhét vào **mọi** prompt sau đó, nên một câu ra lệnh nằm trong đó sẽ chạy mãi mà không ai duyệt lại. " +
          "Bài học là **sự kiện về dự án** (thư viện nào, quy ước nào, bảng nào) — không phải chỉ dẫn cho trợ lý.\n\n" +
          "⚠ Và kể cả nếu nó được lưu: bài học **không nới được quyền** — mọi lượt ghi tệp/chạy lệnh vẫn phải qua thẻ duyệt của bạn.",
        `🛑 **This lesson was not saved.** It matches the shape of an attempt to **override system instructions** (matched: \`${sach.nhan.join("`, `") || "?"}\`).\n\n` +
          "A lesson is injected into **every** later prompt, so a command hidden inside one would run forever without review. " +
          "A lesson is a **fact about the project** (which library, which convention, which table) — not an instruction to the assistant.\n\n" +
          "⚠ And even if it were saved: lessons **cannot widen permissions** — every file write / command run still needs your approval card.",
        `🛑 **未保存该经验。** 它符合**覆盖系统指令**的攻击形状（匹配：\`${sach.nhan.join("`, `") || "?"}\`）。\n\n` +
          "经验会被注入**此后每一个** prompt，因此其中隐藏的命令会一直生效且无人复核。经验应是**关于项目的事实**（用哪个库、哪条约定、哪张表），而不是对助手的指令。\n\n" +
          "⚠ 即使保存了：经验**也无法放宽权限**——每次写文件/执行命令仍需你点击批准卡。",
      );
    }
    return w3(
      "⚠ Bài học rỗng — không có gì để nhớ. Gõ `nhớ giùm: <điều cần nhớ>`.",
      "⚠ Empty lesson — nothing to remember. Type `remember: <what to remember>`.",
      "⚠ 经验内容为空——没有可记住的内容。请输入 `记住：<需要记住的内容>`。",
    );
  }

  const r = await luuBaiHoc(uid, { projectId, noiDung: sach.noiDung, mucRuiRo: sach.mucRuiRo });
  if (r.ma === "hong") {
    return w3(
      "⚠ Không lưu được bài học (kho bài học chưa sẵn sàng). Phiên lập trình vẫn chạy bình thường.",
      "⚠ Could not save the lesson (lesson store unavailable). The coding session still works normally.",
      "⚠ 无法保存经验（经验库不可用）。编程会话仍可正常使用。",
    );
  }
  if (r.ma === "day") {
    return w3(
      `⚠ Đã đạt trần **${GIOI_HAN_BAI_HOC.SO_BAI_TOI_DA}** bài học cho dự án **${projectId}**. Hãy \`quên bài học <số>\` một mục cũ rồi ghi lại.`,
      `⚠ Reached the cap of **${GIOI_HAN_BAI_HOC.SO_BAI_TOI_DA}** lessons for project **${projectId}**. Use \`forget lesson <number>\` on an old one first.`,
      `⚠ 项目 **${projectId}** 已达 **${GIOI_HAN_BAI_HOC.SO_BAI_TOI_DA}** 条经验上限。请先用 \`forget lesson <编号>\` 删除旧的一条。`,
    );
  }
  // ⚠ Nói rõ khi TRÙNG: người dùng phải biết họ **không** vừa tạo ra bản thứ hai.
  const dauCau = r.ma === "trung" ? w3("♻ Bài học này **đã có sẵn**", "♻ This lesson **already existed**", "♻ 该经验**已存在**") : w3("✅ Đã nhớ", "✅ Remembered", "✅ 已记住");
  const themCheBiMat =
    sach.soCheBiMat > 0
      ? w3(
          `\n⚠ ${sach.soCheBiMat} chuỗi trông như bí mật/PII đã bị **che** trước khi lưu.`,
          `\n⚠ ${sach.soCheBiMat} secret/PII-looking string(s) were **redacted** before saving.`,
          `\n⚠ 保存前已**遮蔽** ${sach.soCheBiMat} 处疑似密钥/个人信息。`,
        )
      : "";
  return w3(
    `${dauCau}: "${sach.noiDung}"\n\nBài học này chỉ **của riêng bạn**, gắn với dự án **${projectId}**, và sẽ tự đi vào các lượt sau khi liên quan. Xem tất cả: \`liệt kê bài học\`.${themCheBiMat}`,
    `${dauCau}: "${sach.noiDung}"\n\nThis lesson is **yours alone**, bound to project **${projectId}**, and will reach later turns on its own when relevant. See all: \`list lessons\`.${themCheBiMat}`,
    `${dauCau}："${sach.noiDung}"\n\n该经验**仅属于你**，绑定到项目 **${projectId}**，并会在相关时自动进入后续轮次。查看全部：\`list lessons\`。${themCheBiMat}`,
  );
}

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ doc 82 — **CỬA ĐỌC**: dựng khối bài học cho MỘT lượt. Đây là chỗ vòng được ĐÓNG.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Kế hoạch LACP để việc *"đọc bảng lessons"* cho một nhịp THỦ CÔNG hằng tháng — một nhịp sẽ trôi.
 * Ở đây phép chọn chạy **mỗi lượt lập trình**, tất định, **không gọi model, không gọi embedding**:
 * kho của một (người × dự án) là vài chục hàng, còn đường truy hồi vector đo được là NGUỘI ~14 s
 * (doc 79) — nó đắt hơn giá trị nó mang lại ở quy mô này.
 *
 * ⚠ **GỌI MỘT LẦN MỖI LƯỢT**, ở đây, rồi truyền chuỗi xuống. KHÔNG gọi lại trong vòng lặp lô: câu
 *   hỏi giống hệt nhau cho cả N tệp, nên N lượt đọc CSDL cho ra N kết quả y hệt — và một dòng log
 *   lặp N lần làm dòng log hết nói lên điều gì.
 *
 * ⚠ **FAIL-SAFE**: bảng chưa có / DB vắng / không có userId ⇒ `""` ⇒ đúng hành vi trước lượt này.
 * ⚠ **LUÔN ghi một dòng log kết cục** khi có bài học hoặc có bài bị chặn — bài học của VÁ LIVE
 *   2026-08-20: triệu chứng tệ nhất không phải "sai" mà là **CÂM**.
 */
async function layKhoiBaiHocChoLuot(
  question: string,
  language: KbLanguage,
  projectId: string,
  userId?: number,
): Promise<string> {
  if (!baiHocEnabled()) return "";
  if (!Number.isInteger(userId) || (userId as number) <= 0) return "";
  const lang: "vi" | "en" | "zh" = language === "en" ? "en" : language === "zh" ? "zh" : "vi";
  try {
    const { danhSachBaiHoc } = await import("../db/aiCodingLessons");
    const ds = await danhSachBaiHoc(userId as number, projectId);
    if (ds.length === 0) return "";
    const kq = khoiBaiHocChoPrompt(question, ds, lang);
    if (kq.khoi === "" && kq.soBiChan === 0) return "";
    console.log(
      `[aiLocalKnowledge] bài học: kho=${ds.length} · vào prompt=${kq.dung.length} · bị chặn ở cửa đọc=${kq.soBiChan} · ` +
        `${kq.khoi.length} ký tự · dự án=${projectId}`,
    );
    return kq.khoi;
  } catch (e) {
    console.warn("[aiLocalKnowledge] không dựng được khối bài học (degrade về rỗng):", (e as Error)?.message);
    return "";
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-23 — ĐẦU RA MÁY → MỘT LƯỢT `user` ĐÃ BỌC, ĐẶT Ở KHỐI THẨM QUYỀN THẤP NHẤT
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Nhãn nguồn của khối bọc. Hằng EXPORT vì lưới phải khẳng định được **đúng chuỗi** xuất hiện trong
 * prompt — một nhãn gõ lại ở lưới là một lưới tự thoả với chính nó.
 */
export const NHAN_NGUON_DAU_RA_MAY = "dau-ra-lenh-kiem-chung";

/** ★★★ 2026-08-23 · MỤC 2.4 — nhãn nguồn của khối KẾT QUẢ TOOL ĐỌC khi nó quay lại model. */
export const NHAN_NGUON_KET_QUA_TOOL = "ket-qua-tool-doc-ma";

/**
 * Trần ký tự cho khối kết quả tool khi nó quay lại model (mục 2.4).
 *
 * ⚠ Suy ra từ `TRAN_TOKEN_NGU_CANH_MA` — CÙNG ngân sách mà khối ngữ cảnh mã của đường sinh mã đã
 *   được cấp, vì nó vào ĐÚNG ô ấy trong `promptSinhMa`. Gõ một hằng thứ hai ở đây là dựng một ngân
 *   sách thứ hai cho cùng một chỗ, và hai ngân sách thì sẽ trôi khỏi nhau.
 * ⚠ `KY_TU_MOI_TOKEN_RA` (2,6) là tỉ lệ ký-tự/token cho MÃ NGUỒN — đúng loại chữ ở đây.
 */
export const TRAN_KY_TU_KET_QUA_TOOL = Math.floor(TRAN_TOKEN_NGU_CANH_MA * KY_TU_MOI_TOKEN_RA);

/**
 * Trần ký tự cho phần THÂN của khối đầu ra máy — **SUY RA, KHÔNG GÕ VÀO.**
 *
 * ⚠⚠ Vì sao không dùng thẳng 4.000 như CLI: khối bọc đi vào prompt qua **đường lịch sử**, và
 * `chuanHoaLichSu` cắt MỖI lượt ở `TRAN_KY_TU_MOI_LUOT`. Một khối bọc dài hơn trần ấy sẽ bị cắt
 * **mất dòng đóng hàng rào** ⇒ mọi thứ đứng sau nó (kể cả `=== YÊU CẦU ===`) nằm bên trong một
 * vùng "dữ liệu không được thi hành" chưa đóng ⇒ model bị dặn đừng làm chính việc người dùng vừa
 * xin. Hỏng CHỨC NĂNG chứ không phải hỏng an toàn — nhưng vẫn là hỏng, và nó hỏng CÂM.
 * ⇒ Trần thân = trần một lượt − độ dài vỏ bọc − hậu tố cắt. Ba số ấy đều là hằng đã export ở nơi
 *   định nghĩa chúng, nên phép trừ này **không thể** trôi khỏi cái nó phải khớp.
 */
export const TRAN_KY_TU_DAU_RA_MAY = Math.max(
  200,
  TRAN_KY_TU_MOI_LUOT - wrapUntrustedBlock(NHAN_NGUON_DAU_RA_MAY, "").length - HAU_TO_CAT_LUOT.length,
);

/**
 * Bọc đầu ra máy (test/biên dịch) thành MỘT lượt hội thoại vai `user` để nhét vào cuối lịch sử.
 *
 * ⚠ `user` chứ KHÔNG phải `assistant`: model chưa từng "nói" câu này; gán vai `assistant` là dạy nó
 *   rằng chính nó đã khẳng định một điều nó chưa khẳng định (cùng lý lẽ đã ghi ở `aiCodingCli`).
 * ⚠ Trả `null` khi rỗng ⇒ người gọi không đẻ ra một lượt trống.
 */
export function bocDauRaMayChoLichSu(dauRa: string | null | undefined): LuotHoiThoai | null {
  const tho = String(dauRa ?? "");
  if (tho.trim() === "") return null;
  const sach = sanitizeUntrustedBlock(tho, { maxChars: TRAN_KY_TU_DAU_RA_MAY });
  if (sach.risk !== "none" || sach.fenceEscapes > 0) {
    // Nói ra, không im: một mưu toan thoát khối là dữ kiện vận hành, không phải chuyện nội bộ.
    console.warn(
      `[aiLocalKnowledge] đầu ra máy có dấu hiệu tiêm lời nhắc (risk=${sach.risk}, ` +
        `mẫu=${sach.matched.join("|") || "-"}, thoát-rào=${sach.fenceEscapes}) — đã trung hoà và BỌC.`,
    );
  }
  return { role: "user", content: wrapUntrustedBlock(NHAN_NGUON_DAU_RA_MAY, sach.text) };
}

export async function* streamCodingAnswer(
  question: string,
  context: KbQueryContext,
  execCtx?: ToolExecContext,
  /**
   * ★★★ doc 81 · VIỆC 1 — LỊCH SỬ HỘI THOẠI. Trước lượt này tham số **không tồn tại**: `streamAnswer`
   * nhận `history` rồi gọi hàm này mà không truyền, nên ở chế độ lập trình lịch sử bị vứt 100%.
   * Chính sách cắt theo ngân sách nằm ở `aiCodingAgent.dungKhoiLichSu` (lịch sử nhường chỗ cho nội
   * dung tệp, không bao giờ được đẩy prompt vượt trần slot).
   */
  history: readonly LuotHoiThoai[] = [],
): AsyncGenerator<StreamEvent> {
  const language = resolveLanguage(question, context);

  // meta — KHÔNG citations (không RAG vận hành). intent "general" là mặc định trung tính.
  yield { type: "meta", intent: "general", language, confidence: 1, citations: [] };

  const done = (answer: string, provider: "ollama" | "tool" = "tool"): StreamEvent => ({
    type: "done",
    provider,
    cached: false,
    followUpSuggestions: [],
    answer,
    structured: extractStructuredResponse(answer),
    dataCitations: [],
    numberCheck: null,
  });

  // ★★★ doc 79 · TRỤC 2 — phân giải projectId → gốc SERVER-SIDE (danh sách trắng). id lạ / client gửi
  //   ĐƯỜNG DẪN thay vì id ⇒ TỪ CHỐI, KHÔNG âm thầm chạy trên gốc mặc định. Gốc đã phân giải đi vào
  //   `execCtx.projectRoot` → `argsWithAuthCtx` tiêm cho read tool, và write tool đọc thẳng ở HITL.
  const { phanGiaiGoc, ID_DU_AN_MAC_DINH } = await import("./aiLocalTools/repoProjects");
  const goc = phanGiaiGoc(context.projectId);
  if (!goc.ok) {
    const msg = codingProjectDeniedMessage(language, context.projectId);
    yield { type: "token", token: msg };
    yield done(msg);
    return;
  }
  const execCtx2: ToolExecContext | undefined =
    execCtx && goc.goc ? { ...execCtx, projectRoot: goc.goc } : execCtx;

  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★★ 2026-08-23 — **ĐẦU RA MÁY VÀO LỊCH SỬ (ĐÃ BỌC), KHÔNG VÀO `question`.**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * MỘT chỗ nối duy nhất, đứng TRƯỚC mọi nhánh (sinh mã · sửa một tệp · sửa lô · tạo tệp) nên
   * không nhánh nào có thể "quên bọc": từ đây trở xuống, cái tên `history` **đã** trỏ tới danh sách
   * có khối bọc ở cuối. Lý lẽ đầy đủ ở `KbQueryContext.dauRaKhongTinCay`.
   *
   * ⚠ Đặt ở CUỐI danh sách (lượt mới nhất) có tải trọng kép: (a) `chuanHoaLichSu` chỉ giữ 8 lượt
   *   gần nhất ⇒ khối này không bao giờ bị cắt vì "lịch sử quá dài"; (b) `dungKhoiLichSu` cắt từ
   *   lượt CŨ ra ⇒ nó là thứ **cuối cùng** bị nhường chỗ, đúng thứ tự quan trọng: đầu ra test là
   *   bằng chứng của chính lượt sửa này.
   */
  const luotDauRaMay = context.codingMode === true ? bocDauRaMayChoLichSu(context.dauRaKhongTinCay) : null;
  if (luotDauRaMay) history = [...history, luotDauRaMay];

  /**
   * ★★★ doc 82 · BỘ NHỚ XUYÊN PHIÊN — **ID DỰ ÁN CHO BÀI HỌC.**
   *
   * `phanGiaiGoc` trả `id === null` cho dự án MẶC ĐỊNH (client không gửi `projectId`). Bài học thì
   * **bắt buộc** phải có một khoá dự án hợp lệ (`CHECK` ở mig 0336), nên ta quy về hằng
   * `ID_DU_AN_MAC_DINH` — CÙNG chuỗi mà `danhSachDuAn()` gán cho gốc mặc định, chứ không phải một
   * chuỗi thứ hai. Hai tên cho một dự án là cách bài học của "Repo chính" chia làm hai kho.
   */
  const idDuAnBaiHoc = goc.id ?? ID_DU_AN_MAC_DINH;

  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★★ doc 82 — **CỬA GHI BÀI HỌC**, đứng TRƯỚC mọi nhánh lập trình.
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ⚠ Vì sao ĐỨNG TRƯỚC: *"nhớ giùm: dự án này dùng bcryptjs, đừng dùng crypto"* có chứa tên thư
   *   viện và động từ — đủ để bộ chọn tất định đi lạc. Và vì sao AN TOÀN khi đứng trước: cửa này
   *   **fail-through** — `bocYDinhBaiHoc` trả `null` cho mọi câu không mở đầu bằng cụm khởi phát
   *   KÈM dấu ngăn, và khi ấy không một byte nào của lượt này đổi.
   *
   * ⚠ Cờ TẮT (`AI_CODING_LESSONS=0`) ⇒ **không gọi cả bộ nhận ý định**: câu *"nhớ giùm: …"* rơi
   *   xuống đường lập trình bình thường y như trước lượt này. Một cờ chỉ tắt cửa ĐỌC mà vẫn âm
   *   thầm GHI là thu thập dữ liệu người dùng cho một tính năng họ tưởng đã tắt.
   */
  if (baiHocEnabled()) {
    const yDinh = bocYDinhBaiHoc(question);
    if (yDinh) {
      const m = await xuLyLuotBaiHoc(yDinh, language, idDuAnBaiHoc, execCtx2?.user?.id);
      yield { type: "token", token: m };
      yield done(m);
      return;
    }
  }

  /**
   * ★★★ doc 82 — khối bài học của LƯỢT NÀY, dựng **một lần**, dùng cho MỌI nhánh phía dưới (sinh
   * mã · sửa một tệp · sửa lô · tạo tệp). `""` khi: cờ tắt · không có phiên đăng nhập · kho rỗng ·
   * không bài nào qua được cửa đọc. Xem `layKhoiBaiHocChoLuot`.
   */
  const khoiBaiHocLuot = await layKhoiBaiHocChoLuot(question, language, idDuAnBaiHoc, execCtx2?.user?.id);

  /**
   * ★★★ doc 79 · VÒNG TỰ ĐỘNG — LƯỢT SỬA KẾ TIẾP, TỆP ĐƯỢC **GHIM** BỞI BỘ ĐIỀU KHIỂN VÒNG.
   *
   * Đứng TRƯỚC cả bộ chọn tất định vì lý do đo được ở `KbQueryContext.codingEditPath`: câu hỏi của
   * lượt này chở theo ĐẦU RA TEST THẬT, và trong đầu ra ấy có tên lệnh + đường dẫn tệp test — bộ
   * chọn sẽ đi lạc sang `run_command` hoặc sang đúng tệp test.
   *
   * ⚠⚠ **BẤT BIẾN TOCTOU**: `streamCodingEdit` đọc lại tệp bằng `read_file` NGAY TRONG lượt này —
   * `original` gửi cho `apply_diff` là byte TRÊN ĐĨA lúc này, KHÔNG phải thứ model hay client nhớ
   * từ lượt trước. Sau lượt ghi thứ nhất tệp đã đổi, nên lượt hai **bắt buộc** phải đọc lại; đó là
   * lý do bộ điều khiển vòng chỉ gửi ĐƯỜNG DẪN, không bao giờ gửi nội dung.
   *
   * ⚠ Cờ `AI_CODING_EDIT=0` ⇒ `streamCodingEdit` trả `false` ngay ⇒ rơi xuống đường cũ, không im lặng.
   */
  if (typeof context?.codingEditPath === "string" && context.codingEditPath.trim() !== "") {
    const daXuLyGhim = yield* streamCodingEdit(
      question,
      context.codingEditPath.trim(),
      language,
      context,
      execCtx2,
      history,
      false,
      khoiBaiHocLuot,
    );
    if (daXuLyGhim) return;
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★★ 2026-08-23 · UX LÔ 1 (C3) — CỬA SỬA **TẤT ĐỊNH** cho hình dạng *"sửa <đường>: <việc>"*.
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Đo live: cùng câu ấy, lượt ra thẻ duyệt, lượt ra dump grep — số phận do bộ chọn LLM vòng 1.
   * Cửa này đứng TRƯỚC bộ chọn + vòng tool: khớp vị từ thuần `trichDuongSuaTatDinh` (dùng lại
   * `REPO_PATH_REGEX`, xem docblock ở `intentClassifier.ts`) ⇒ đi THẲNG `streamCodingEdit` với
   * đúng đường người dùng gõ — 10/10 lượt, không một model nào được hỏi ở bước định tuyến.
   * ⚠ Nó làm cửa `yDinhGhi` bên dưới HẾT phụ thuộc `quyetDinh.tool === "read_file"` cho hình dạng
   *   tường minh nhất; các hình dạng mơ hồ hơn ("sửa hàm Divide trong X") vẫn đi cửa cũ.
   * ⚠ Fail-through: `streamCodingEdit` trả `false` (cờ tắt/model vắng) ⇒ rơi xuống đường cũ y hệt
   *   mọi cửa khác — không im lặng, không mất lượt.
   */
  const yDinhTao = laYDinhTaoTep(question);
  const duongSuaTatDinh = trichDuongSuaTatDinh(question);
  if (duongSuaTatDinh !== null) {
    const daXuLyTatDinh = yield* streamCodingEdit(
      question,
      duongSuaTatDinh,
      language,
      context,
      execCtx2,
      history,
      yDinhTao,
      khoiBaiHocLuot,
    );
    if (daXuLyTatDinh) return;
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★★ 2026-08-24 — CỬA **TẠO KHUNG DỰ ÁN** TẤT ĐỊNH (`laYDinhTaoDuAn`), đứng SAU cửa "sửa X:"
   * và TRƯỚC bộ chọn + vòng tool.
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Đo live (chủ dự án, 2026-08-24): *"tạo dự án C# WPF đọc file pdf"* — câu KHÔNG THỂ nêu đường
   * dẫn nào (tệp chưa tồn tại) ⇒ đường nhiều-tệp (`≥2` đường NGƯỜI GÕ) là bất khả, câu rơi xuống
   * nhánh SINH MÃ: mã in ra màn hình mà **không một tệp nào rơi xuống đĩa**. Cửa này là ngoại lệ
   * CREATE-ONLY duy nhất của luật "model không tự chọn tệp ghi" — lý lẽ + bốn hàng rào hậu kiểm ở
   * docblock `streamCodingTaoKhung`.
   * ⚠ Fail-through y hệt mọi cửa: cờ tắt / model vắng ⇒ trả `false` ⇒ rơi xuống đường cũ (sinh mã).
   */
  if (laYDinhTaoDuAn(question)) {
    const daXuLyKhung = yield* streamCodingTaoKhung(question, language, context, execCtx2, history, khoiBaiHocLuot);
    if (daXuLyKhung) return;
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★★ 2026-08-24 — CỬA **VÒNG TỰ-TRỊ-GHI** (model tự ghi mã KHÔNG người duyệt), đứng SAU cửa
   * "sửa X:" + "tạo dự án" và TRƯỚC bộ chọn tool + vòng tool ĐỌC.
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * VÌ SAO THỨ TỰ NÀY:
   *   • `laYDinhTuTri` (*"tự sửa cho test xanh"*) là loại trừ lẫn nhau với hai cửa trên: câu tự-trị
   *     KHÔNG nêu đường dẫn nên `trichDuongSuaTatDinh` = null (không khớp "sửa X:"), và không có danh
   *     từ dự án nên `laYDinhTaoDuAn` = false. Đặt SAU chúng: một câu có "sửa X:" tường minh vẫn là
   *     một lượt sửa MỘT tệp (người dùng nêu đích danh tệp), KHÔNG bị vòng tự-ghi cướp.
   *   • Đặt TRƯỚC vòng tool ĐỌC: nếu để rơi xuống đó, câu tự-trị chỉ được ĐỌC vài tệp rồi dừng —
   *     đúng thứ vòng tự-ghi sinh ra để thay thế (đọc → tự sửa → chạy test → lặp).
   *
   * ⚠⚠ LUÔN RETURN sau cửa này — một câu `laYDinhTuTri` KHÔNG BAO GIỜ rơi xuống đường thường:
   *   • cờ BẬT ⇒ chạy vòng, stream tiến độ, câu tổng (xanh / dừng-vì-gì);
   *   • cờ TẮT ⇒ `chayVongTuTriGhi` trả `batDau:false` ⇒ `streamCodingTuTriGhi` NÓI THẲNG "đang TẮT
   *     — bật `AI_CODING_TU_TRI_GHI=1` + `AI_CODING_AUTOLOOP=1`", KHÔNG im lặng trả về câu thường
   *     (một người gõ "tự sửa cho test xanh" mà nhận về câu trả lời thường là bối rối).
   */
  if (laYDinhTuTri(question)) {
    yield* streamCodingTuTriGhi(question, language, context, execCtx2, history, khoiBaiHocLuot, context.projectId);
    return;
  }

  /**
   * ★★★ doc 79 · TRỤC 1 (C) — NHÁNH **SỬA TỆP**, đứng TRƯỚC bộ chọn tool tất định.
   *
   * Vì sao trước: một câu *"sửa src/Calculator.cs để Divide ném ArgumentException khi chia 0"* CÓ
   * đường dẫn, nên `classifyCodingToolIntent` chọn `read_file` và ta dừng ở việc ĐỌC — đúng thứ chủ
   * dự án gọi là "không nhận được hành động chính xác". Ta dùng LẠI NGUYÊN quyết định của bộ chọn ấy
   * (không viết bộ trích đường dẫn thứ hai) rồi hỏi thêm một câu: *"câu này là ĐỌC hay SỬA?"*
   * ⚠ Bộ chọn tất định KHÔNG bị sửa một byte ⇒ lưới A/B (`codingToolIntent.test.ts` §5) không đổi.
   */
  const quyetDinh = classifyCodingToolIntent(question);
  /**
   * ★★★ doc 79 (2026-08-20) — GHI: **MỘT tệp hay NHIỀU tệp**, và ý định TẠO.
   *
   * `yDinhGhi` gộp SỬA và TẠO vì cả hai đều dẫn tới cùng một nhánh; nhánh ấy tự phân xử bằng ĐĨA
   * (xem ngã ba trong `streamCodingEdit`). Trước lượt này chỉ có `laYDinhSuaTep`, và danh sách động
   * từ của nó **không có `tao`** — đó là toàn bộ lý do câu *"tạo file mới src/utils/date.ts"* rơi
   * xuống đường ĐỌC rồi trả *"không tìm thấy tệp"* cho một tệp mà người dùng biết thừa là chưa có.
   *
   * ⚠⚠ Đường NHIỀU TỆP đứng TRƯỚC và điều kiện của nó là **≥2 đường dẫn NGƯỜI DÙNG TỰ GÕ**
   * (`trichMoiDuongDanRepo`, tất định). KHÔNG có đường nào để model tự chọn danh sách tệp: phép đo
   * live 2026-08-19 cho thấy bộ chọn LLM bịa ra một đường dẫn tệp lõi cho một câu không nêu tệp
   * nào — nhân chuyện đó lên 6 tệp là điều tệ nhất có thể làm ở một tool ghi.
   */
  const yDinhGhi = laYDinhSuaTep(question) || yDinhTao;
  if (quyetDinh.tool === "read_file" && typeof quyetDinh.args.path === "string" && yDinhGhi) {
    const nhieuDuong = trichMoiDuongDanRepo(question);
    if (nhieuDuong.length >= 2) {
      const daXuLyLo = yield* streamCodingSuaNhieuTep(
        question,
        nhieuDuong,
        language,
        context,
        execCtx2,
        history,
        yDinhTao,
        khoiBaiHocLuot,
      );
      if (daXuLyLo) return;
    }
    const daXuLy = yield* streamCodingEdit(
      question,
      quyetDinh.args.path,
      language,
      context,
      execCtx2,
      history,
      yDinhTao,
      khoiBaiHocLuot,
    );
    if (daXuLy) return;
  }

  /**
   * ★★★ doc 81 · VIỆC 2 — VÒNG LẶP TOOL ĐA BƯỚC (dùng lại `runToolLoop`, xem `aiLocalTools/index.ts`).
   *
   * ⚠ Cùng khuôn "hàng chờ + lời hứa đánh thức" mà đường vận hành đã dùng (:3209): một generator
   * KHÔNG `yield` được từ trong callback, nên tiến độ phải đi qua hàng chờ rồi được rút ở vòng
   * `while` dưới đây. Không có nó, người dùng ngồi nhìn màn hình đứng im tới `CODING_LOOP_DEFAULT_MS`
   * — mà ở đây trần là **180 s**, tức đúng thứ phải tránh nhất.
   */
  const hangChoVong: ToolLoopProgress[] = [];
  let danhThucVong: (() => void) | null = null;
  let vongXong = false;
  const loiHuaVong = tryExecuteCodingToolLoop(question, context, execCtx2, (ev) => {
    hangChoVong.push(ev);
    danhThucVong?.();
  });
  // `then(ok, err)` KHÔNG được để lại nhánh reject chưa ai bắt (unhandled rejection giết tiến trình
  // dưới Node ≥15). `await loiHuaVong` phía dưới mới là nơi lỗi thật sự được xử lý.
  void loiHuaVong.then(() => {}, () => {}).then(() => {
    vongXong = true;
    danhThucVong?.();
  });
  while (true) {
    while (hangChoVong.length > 0) {
      const ev = hangChoVong.shift()!;
      yield { type: "tool_loop", round: ev.round, phase: ev.phase, toolName: ev.tool, elapsedMs: ev.elapsedMs, stop: ev.stop };
    }
    if (vongXong) break;
    await new Promise<void>((r) => {
      danhThucVong = () => {
        danhThucVong = null;
        r();
      };
    });
  }
  const outcome = await loiHuaVong;
  const toolName = outcome.decision.tool ?? null;

  // Write tool (run_command / apply_diff) → HITL: thẻ xác nhận + tóm tắt (chưa chạm đĩa/tiến trình).
  if (outcome.pendingAction) {
    const msg = outcome.pendingAction.summary;
    yield { type: "pending_action", toolName, pendingAction: outcome.pendingAction };
    yield { type: "token", token: msg };
    yield done(msg);
    return;
  }

  // Từ chối RBAC / route không cho phép → nói thẳng lý do (có mã bên trong message).
  if (outcome.denied) {
    const msg = outcome.denied.message;
    yield { type: "token", token: msg };
    yield done(msg);
    return;
  }

  /**
   * ★★★ CỨU MỘT LƯỢT ĐOÁN TRƯỢT CỦA BỘ CHỌN LLM — hẹp có chủ ý.
   *
   * `tryExecuteCodingTool` chạy heuristic TRƯỚC, rồi mới tới bộ chọn LLM giới hạn 5 tool. Với đúng
   * câu chủ dự án hỏi (*"viết code C# cho chương trình chat LAN sử dụng socket"*) heuristic trả
   * `null` — và nếu bộ chọn LLM khi ấy ĐOÁN một `read_file`/`grep_repo` với một đường/mẫu nó tự bịa,
   * người dùng sẽ nhận *"Không có tệp X trong hộp cát"* thay vì mã. Tức lỗi cũ quay lại dưới một cái
   * tên khác.
   *
   * Điều kiện hẹp: heuristic TẤT ĐỊNH nói "không tool nào" **VÀ** tool (do LLM đoán) trả về "không
   * tìm thấy gì". Khi ấy đi tiếp xuống nhánh SINH MÃ. Mọi lượt heuristic có khớp (`CODING_*_SHORTCUT`)
   * KHÔNG đi qua đây ⇒ cổng ra tất định của trục 1 không đổi một byte.
   */
  const doanTruot =
    quyetDinh.tool === null &&
    !!outcome.result &&
    (outcome.result.note === "NOT_FOUND" || outcome.result.note === "NO_MATCH");

  /**
   * Read tool chạy (read_file / list_files / grep_repo) → HIỆN NỘI DUNG THẬT. Kể cả lượt từ chối hộp
   * cát cũng trả về `result` kèm `note` giải thích — nên nhánh này bao luôn cả câu từ chối có mã.
   *
   * ★ doc 81 · VIỆC 2 — nay có thể có NHIỀU vòng. Phát MỘT sự kiện `tool` cho MỖI vòng có dữ liệu và
   * nối các `textSummary` lại: nếu chỉ lấy vòng cuối thì kết quả `grep` của vòng 1 biến mất và người
   * dùng không thấy vì sao tác nhân lại đọc đúng tệp ấy — tức mất chính thứ vòng lặp làm ra.
   */
  if (outcome.result && !doanTruot) {
    const cacVong = outcome.ketQuaTungVong.length > 0
      ? outcome.ketQuaTungVong
      : [{ round: 1, toolName: toolName ?? "", result: outcome.result }];
    for (const v of cacVong) {
      yield { type: "tool", toolName: v.toolName || null, toolResult: v.result };
    }
    const answer = cacVong
      .map((v) => v.result.textSummary ?? "")
      .filter((s) => s.trim() !== "")
      .join("\n\n");
    /**
     * ★★★ G2 (audit 2026-09-21 · P2) — HAI CHUỖI, HAI NGƯỜI ĐỌC.
     * `answer` (trên) đi ra MÀN HÌNH: người dùng đọc câu đã dịch, có cả câu trấn an khi bị từ chối.
     * `chuChoModel` (dưới) đi vào PROMPT: với một lượt TỪ CHỐI đó là câu MỆNH LỆNH ("bạn KHÔNG có
     * nội dung này, KHÔNG ĐƯỢC mô tả hay suy đoán"). Dùng chung một chuỗi là nguyên nhân đo được
     * của việc model bịa nguyên nội dung `server/routers.ts`. Xem `ai/vanBanChoModel.ts`.
     */
    const chuChoModel = cacVong
      .map((v) => vanBanChoModel(v.result))
      .filter((s) => s.trim() !== "")
      .join("\n\n");

    /**
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * ★★★ 2026-08-23 · MỤC 2.4 — **CÂU CẦN SUY LUẬN THÌ KẾT QUẢ TOOL PHẢI QUAY LẠI MODEL.**
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * Nghiệm thu live: *"Giải thích lớp Calculator… và có lỗi gì"* → **0,100 giây**, `token` rỗng,
     * đáp án = **nguyên văn tệp**. 5/7 lượt như vậy. Vì đúng ở đây, `answer` (bản dump của tool)
     * được `yield` thẳng cho người và model **không đọc nó trong lượt đó**.
     *
     * ⚠⚠ **RANH GIỚI LÀ MỘT VỊ TỪ THUẦN, KHÔNG PHẢI MỘT CHUỖI `if` RẢI RÁC** — `laCauCanSuyLuan()`
     *   đứng một mình, có lưới riêng, và mặc định **`false`** (đọc tường minh giữ đường nhanh
     *   ~0,4 giây). Xem docblock của nó cho lý lẽ bất đối xứng sót/thừa.
     * ⚠⚠ **BỌC LÀ BẮT BUỘC**: `answer` là NỘI DUNG TỆP + tên thư mục + dòng khớp `grep` — tất cả do
     *   người viết repo (hoặc người gửi PR) quyết định. Nó đi vào ô `khoiNguCanhMa` của
     *   `promptSinhMa`, tức một ô có thẩm quyền cao; không bọc là mở đúng cửa mà mục 2.2 vừa đóng.
     * ⚠ FAIL-SAFE: cờ tắt / model chưa sẵn sàng ⇒ `streamCodingGenerate` trả về ≠ `"xong"` ⇒ rơi
     *   xuống đúng bản dump cũ. Một tính năng làm câu trả lời ĐẸP hơn không được phép làm nó BIẾN MẤT.
     * ⚠ Thẻ `tool` đã phát ở trên rồi ⇒ người dùng vẫn THẤY nội dung thật, kể cả khi phần chữ là
     *   văn xuôi của model. Không có nguồn nào bị giấu đi.
     */
    /**
     * ★★★ G2 (audit 2026-09-21 · P2) — **CẦU CHÌ CỨNG, ĐỨNG TRƯỚC MỌI CỔNG GỌI MODEL.**
     *
     * Mệnh lệnh trong prompt (`textModel`) là hàng rào MỀM, và đo sống cho thấy nó KHÔNG đủ:
     * 10 lượt cùng một câu hỏi khi ngân sách cạn ⇒ **3/10 sạch, 7/10 vẫn BỊA** (có lượt viết nguyên
     * một Express router không tồn tại, kèm câu *"dựa trên nội dung đã được cung cấp từ hệ thống"*).
     *
     * Khi **MỌI** vòng đọc đều bị từ chối thì không có gì để tổng hợp — gọi model lúc này là MỜI nó
     * bịa. Trả thẳng lời từ chối của tool (vốn đã trung thực và đã dịch 3 thứ tiếng).
     * ⚠ CHỈ khi TẤT CẢ bị từ chối; một vòng đọc được ⇒ model vẫn chạy như cũ.
     */
    if (cauChiNenNo(cacVong.map((v) => v.result.note), laCauSinhMa(question))) {
      console.warn(
        `[aiLocalKnowledge] G2 cầu chì: ${cacVong.length} vòng đọc ĐỀU bị từ chối ` +
          `(${cacVong.map((v) => v.result.note).join(",")}) — KHÔNG gọi model, trả lời từ chối trung thực.`,
      );
      yield { type: "token", token: answer };
      yield done(answer);
      return;
    }

    /**
     * ★★★ G2b (audit 2026-09-21 · P11) — THÊM VẾ `laCauSinhMa`.
     * `laCauCanSuyLuan` trả lời câu hỏi *"có cần suy luận không"*; nó KHÔNG phủ câu **SINH MÃ**.
     * Đo được: *"Viết TypeScript: export class BoNhoLRU…"* (không dấu hỏi, không động từ giải
     * thích) ⇒ vị từ cũ = false ⇒ **nguyên văn `toolRegistry.ts` (26.004 byte) thành câu trả lời**.
     * 6/9 tác vụ lập trình khó trả về 0 khối mã; đường ống 0 % trong khi model thuần 44–56 %.
     * Xem `ai/cauSinhMa.ts` cho đánh đổi sót/thừa (cố ý lệch về phía gọi model).
     */
    if (answer.trim() !== "" && (laCauCanSuyLuan(question) || laCauSinhMa(question))) {
      const sach = sanitizeUntrustedBlock(chuChoModel, { maxChars: TRAN_KY_TU_KET_QUA_TOOL });
      const khoiBoc = wrapUntrustedBlock(NHAN_NGUON_KET_QUA_TOOL, sach.text);
      const ketCucSuyLuan = yield* streamCodingGenerate(
        question, language, context, execCtx2, history, khoiBaiHocLuot, khoiBoc,
      );
      if (ketCucSuyLuan === "xong") return;
      console.warn(
        `[aiLocalKnowledge] câu cần suy luận nhưng nhánh sinh chữ không chạy (${ketCucSuyLuan}) — ` +
          "rơi về bản dump kết quả tool (hành vi cũ).",
      );
    }

    yield { type: "token", token: answer };
    yield done(answer);
    return;
  }

  // Handler ném lỗi thật (hiếm) → khai lỗi, KHÔNG giả vờ "không rõ yêu cầu".
  if (outcome.error) {
    const msg = codingErrorMessage(language, toolName, outcome.error);
    yield { type: "token", token: msg };
    yield done(msg);
    return;
  }

  /**
   * ★★★ doc 79 · TRỤC 1 (C) — NHÁNH **SINH MÃ**, thay cho NGÕ CỤT.
   *
   * Đây chính là lỗi chủ dự án báo: *"viết code C# cho chương trình chat LAN sử dụng socket"* không
   * có đường dẫn, không có lệnh, không có mẫu grep ⇒ 5 tool đều không khớp ⇒ trước bản vá này hàm
   * trả thẳng `codingNoToolMessage()` mà **KHÔNG BAO GIỜ gọi model**. Nay nó gọi model với persona
   * KỸ SƯ LẬP TRÌNH (không RAG vận hành, không [1][2]) và stream mã thật ra.
   */
  const ketCuc = yield* streamCodingGenerate(question, language, context, execCtx2, history, khoiBaiHocLuot);
  if (ketCuc === "xong") return;

  // KHÔNG tool nào khớp VÀ nhánh sinh mã không chạy (cờ tắt / model chưa sẵn sàng) → nói thẳng.
  const msg = codingNoToolMessage(language, ketCuc);
  yield { type: "token", token: msg };
  yield done(msg);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ doc 79 · TRỤC 1 (C) — Ý ĐỊNH SỬA · NGỮ CẢNH DỰ ÁN · HAI NHÁNH GỌI MODEL
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★ Trần token ĐẦU RA cho một lượt **TẠO** tệp. Không suy được từ `goc.length` (gốc rỗng), nên nó
 * là một hằng riêng: ~4.000 token ≈ 10 KB mã — đủ cho gần hết tệp nguồn viết mới, và vẫn để lại
 * ~28.700 token dư địa trên slot 32.768 cho persona + lịch sử.
 */
const TRAN_TOKEN_TAO_TEP = 4_000;

/**
 * ★ Trần token ĐẦU RA cho một lượt **TẠO KHUNG DỰ ÁN** — MỘT lượt model phát tới 8 tệp.
 * 8.000 token ≈ 20 KB mã: dư cho một khung tối thiểu (csproj + App.xaml(.cs) + MainWindow.xaml(.cs)
 * + service + README ≈ 6–8 KB), và prompt của lượt này KHÔNG chở nội dung tệp nào (các tệp chưa
 * tồn tại) nên slot 32.768 còn ~24.700 token dư địa — trần này không bao giờ ép prompt nhường chỗ.
 */
const TRAN_TOKEN_TAO_KHUNG = 8_000;

/**
 * ★★ Trần số tệp mà đường **SỬA NHIỀU TỆP** chịu xử lý trong một lượt.
 *
 * ⚠ Đây là trần của LƯỢT NGƯỜI DÙNG, và nó **thấp hơn** trần của thẻ duyệt
 * (`applyDiffBatch.TRAN_TEP_MOI_LO = 8`) một cách có chủ ý: mỗi tệp tốn MỘT lượt gọi model 30B
 * (~30 s). Sáu tệp đã là ~3 phút người dùng ngồi nhìn màn hình. Trần thấp hơn ⇒ hai trần KHÔNG BAO
 * GIỜ mâu thuẫn, và cái chặn trước luôn là cái nói được lý do dễ hiểu hơn.
 */
const TRAN_TEP_MOT_LUOT_SUA = 6;

/** Bỏ dấu tiếng Việt (kể cả `đ`) — bản cục bộ, thuần, để phân biệt ĐỌC với SỬA. */
function boDauVi(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/**
 * ★★★ *"Câu này là ĐỌC tệp hay SỬA tệp?"*
 *
 * ⚠ CỐ Ý HẸP (ưu tiên độ CHÍNH XÁC hơn độ phủ). Một lượt nhận nhầm ĐỌC thành SỬA đốt ~30 s của model
 * 30B rồi đẻ ra một thẻ duyệt mà người dùng không hề xin. Vì thế:
 *   • KHÔNG nhận `thay` (đụng `thấy` → `thay`), KHÔNG nhận `doi` trần (đụng `đợi`/`đối`);
 *   • động từ ĐỌC (`doc`/`xem`/`mo`/`read`/`show`) KHÔNG nằm ở đây, nên
 *     *"đọc server/routers.ts và cho biết export gì"* vẫn đi đúng đường ĐỌC tất định của trục 1.
 * Điều kiện này chỉ được HỎI khi bộ chọn tất định đã cho ra `read_file` (tức câu CÓ đường dẫn tệp).
 */
export function laYDinhSuaTep(question: string): boolean {
  const q = boDauVi(question);
  const vi = /(^|[^a-z])(sua|va loi|khac phuc|chinh lai|chinh sua|them|bo sung|cai dat|viet lai|cap nhat|doi ten|xoa bo|nem loi|toi uu)([^a-z]|$)/;
  const en = /(^|[^a-z])(fix|edit|modify|change|update|refactor|implement|rewrite|patch|remove|throw)([^a-z]|$)/;
  const zh = /(修改|修复|修正|实现|重构|更新|添加|删除|优化)/;
  return vi.test(q) || en.test(q) || zh.test(question);
}

/**
 * ★★★ doc 79 (2026-08-20) — *"Câu này là TẠO tệp MỚI?"*
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖ ĐÃ ĐO — VÀ NÓ **KHÔNG** NẰM Ở TOOL
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `apply_diff` đã hỗ trợ TẠO từ ngày đầu: `{path, original:"", modified}` là một hợp đồng hợp lệ,
 * có băm neo (`writeHandlers/applyDiff.ts` — nhánh `daCo === false`, và câu *"tệp chưa tồn tại nên
 * original phải RỖNG cho một lượt TẠO"*). Cái chặn là **ĐỊNH TUYẾN**: câu *"tạo file mới
 * src/utils/date.ts"* cho `classifyCodingToolIntent` ⇒ `read_file` (có đường dẫn), rồi
 * `laYDinhSuaTep` trả `false` (danh sách động từ của nó KHÔNG có `tao`) ⇒ đi thẳng xuống đường đọc
 * ⇒ tệp chưa tồn tại ⇒ người dùng nhận *"Không có tệp … trong hộp cát"*. Tool đúng, đường sai.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÀ ĐÂY LÀ ĐIỂM MẤU CHỐT: **HÀM NÀY KHÔNG QUYẾT ĐỊNH TẠO HAY SỬA — CÁI ĐĨA QUYẾT ĐỊNH.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * *"thêm hàm formatNgay vào src/utils/date.ts"* khớp CẢ `laYDinhSuaTep` (`them`) lẫn hàm này
 * (`them … file`? không — xem dưới). Mọi phép tách bằng ĐỘNG TỪ đều có vùng chồng lấn, và đoán sai
 * ở đây có một chiều RẤT đắt: coi một lượt SỬA thành TẠO nghĩa là gửi `original:""` cho một tệp
 * đang có nội dung — tức **đề xuất xoá sạch tệp rồi ghi đè**.
 *
 * ⇒ Nên hàm này chỉ dùng cho MỘT câu hỏi hẹp: *"tệp KHÔNG tồn tại — đó là lỗi, hay là ý người
 *   dùng?"*. Sự tồn tại do `read_file` trả lời (`NOT_FOUND`), và tệp **đã tồn tại** thì đường đi là
 *   SỬA bất kể hàm này nói gì (xem `streamCodingEdit`). Chiều hỏng còn lại — người xin TẠO mà tệp
 *   đã có — bị chặn tường minh, KHÔNG âm thầm chuyển thành ghi đè; và `apply_diff` còn chặn độc lập
 *   một lần nữa bằng `BASE_MISMATCH` (băm("") ≠ băm(nội dung thật)).
 *
 * ⚠ CỐ Ý HẸP: `tao` trần đụng `tao nhã`, `tao lao`… nên vi đòi **động từ + danh từ tệp** hoặc dạng
 *   `tao moi`. `viet` trần đụng `viet lai` (đã thuộc `laYDinhSuaTep`) nên cũng đòi danh từ tệp.
 */
export function laYDinhTaoTep(question: string): boolean {
  const q = boDauVi(question);
  const vi =
    /(^|[^a-z])(tao|khoi tao|sinh|them|bo sung|viet|lam)\s+(mot\s+|1\s+)?(file|tep|tap tin)([^a-z]|$)/.test(q) ||
    /(^|[^a-z])(tao|khoi tao|sinh)\s+(moi|ra)([^a-z]|$)/.test(q) ||
    /(^|[^a-z])(file|tep|tap tin)\s+moi([^a-z]|$)/.test(q);
  const en =
    /(^|[^a-z])(create|add|make|generate|scaffold|write)\s+(a\s+|an\s+|the\s+)?(new\s+)?(file|module|component)([^a-z]|$)/i.test(q) ||
    /(^|[^a-z])new\s+file([^a-z]|$)/i.test(q);
  const zh = /(创建|新建|新增|生成)\s*(一个)?\s*(文件|文件夹|模块|组件)/.test(question) || /新文件/.test(question);
  return vi || en || zh;
}

/**
 * Ngữ cảnh DỰ ÁN ĐANG CHỌN đưa vào persona: tên dự án + vài mục ở gốc. Không có nó, model trả lời
 * "chung chung ngoài không khí" dù người dùng vừa chọn một dự án cụ thể ở bộ chọn.
 *
 * ⚠ Lấy danh sách mục qua ĐÚNG `executeDecision` + `list_files` (hộp cát + RBAC + gốc dự án đã phân
 * giải), KHÔNG đọc thư mục bằng `fs` — mở một cửa đọc thứ hai là đúng lớp lỗi mà
 * `programmingFileIo.census.test.ts` được dựng ra để chặn.
 * ⚠ Fail-safe: mọi lỗi ⇒ chuỗi RỖNG (persona vẫn chạy, chỉ mất phần ngữ cảnh).
 */
async function nguCanhDuAnChoPrompt(
  context: KbQueryContext,
  execCtx?: ToolExecContext,
): Promise<string> {
  try {
    const { danhSachDuAn, duAnMacDinh } = await import("./aiLocalTools/repoProjects");
    const ds = danhSachDuAn();
    const duAn = (context.projectId ? ds.find((d) => d.id === context.projectId) : undefined) ?? duAnMacDinh();
    const dong: string[] = [`=== Dự án đang mở ===`, `Tên: ${duAn.ten}`];
    if (execCtx) {
      const lf = await executeDecision({ tool: "list_files", args: { depth: 1 } }, execCtx);
      const entries =
        (lf.result?.data as { entries?: Array<{ path: string; kind: string }> } | undefined)?.entries ?? [];
      const ten = entries.slice(0, 24).map((e) => (e.kind === "dir" ? `${e.path}/` : e.path));
      if (ten.length > 0) dong.push(`Mục ở thư mục gốc: ${ten.join(", ")}`);
    }
    dong.push("Bám dự án này khi trả lời; nếu yêu cầu không liên quan tới nó thì cứ trả lời độc lập.");
    return dong.join("\n");
  } catch (e) {
    console.warn("[aiLocalKnowledge] không dựng được ngữ cảnh dự án cho persona lập trình:", (e as Error)?.message);
    return "";
  }
}

/** Sự kiện `done` dùng chung cho hai nhánh gọi model (tách ra để không chép ba bản). */
function doneSinhMa(answer: string, provider: "ollama" | "tool", degraded?: { reason: string }): StreamEvent {
  return {
    type: "done",
    provider,
    cached: false,
    followUpSuggestions: [],
    answer,
    structured: extractStructuredResponse(answer),
    dataCitations: [],
    numberCheck: null,
    ...(degraded ? { degraded: true, degradedReason: degraded.reason } : {}),
  };
}

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
async function* streamCodingEdit(
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
async function* streamCodingTuTriGhi(
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

async function* motLuotModel(y: {
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
        });
      })()
    : null;
  const tranLuot = tranTokenTheoLop(y.loai, y.tranToken, tranNghi, y.ghiDe);

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
      let n: IteratorResult<string, KetQuaChu>;
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
async function* streamCodingSuaNhieuTep(
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
async function* streamCodingTaoKhung(
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

/** Vì sao nhánh sinh mã KHÔNG chạy — mỗi lý do là một câu khác nhau với người dùng. */
type LyDoKhongSinhMa = "xong" | "tat_co" | "model_offline";

/**
 * ★★★ NHÁNH SINH MÃ ĐA MỤC ĐÍCH — C#, TypeScript, React, PostgreSQL… KHÔNG dùng `ProgrammingKind`
 * của `aiProgrammingCopilot` (tập ấy CHỈ có PLC/robot/CNC: `iec61131-st`, `gcode`, `robot-tm`… —
 * nhét C# vào đó là khai sai loại rồi nhận lại prompt của một miền khác).
 */
async function* streamCodingGenerate(
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
      let n: IteratorResult<string, KetQuaChu>;
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

/**
 * ★ ĐƯỜNG NÓI THẬT KHI KHÔNG CÓ MODEL — cố ý GIỮ LẠI (doc 79 (A)).
 *
 * `lyDo` mở rộng câu chứ không thay nó: *"chưa rõ yêu cầu"* là SAI SỰ THẬT khi nguyên nhân là engine
 * chưa nạp được model. Người dùng cần biết mình phải làm gì khác nhau trong hai ca ấy.
 */
function codingNoToolMessage(language: KbLanguage, lyDo?: LyDoKhongSinhMa): string {
  const them =
    lyDo === "model_offline"
      ? {
          vi: "\n\n⚠ Ngoài ra: **model sinh mã cục bộ chưa sẵn sàng** (engine GGUF chưa nạp được). Đây là lý do tôi không tự viết mã cho bạn lượt này — không phải vì câu hỏi sai.",
          en: "\n\n⚠ Also: the **local code model is not ready** (GGUF engine unavailable). That is why I did not write code for you this turn — not because your question was wrong.",
          zh: "\n\n⚠ 另外：**本地代码模型尚未就绪**（GGUF 引擎不可用）。这才是本轮我没有为你写代码的原因，而不是你的问题有误。",
        }
      : lyDo === "tat_co"
        ? {
            vi: "\n\n⚠ Ngoài ra: nhánh **sinh mã** đang TẮT bằng cờ `AI_CODING_GEN=0`.",
            en: "\n\n⚠ Also: the **code-generation** branch is disabled via `AI_CODING_GEN=0`.",
            zh: "\n\n⚠ 另外：**代码生成**分支已通过 `AI_CODING_GEN=0` 关闭。",
          }
        : { vi: "", en: "", zh: "" };
  if (language === "zh") {
    return "我不清楚你的编程请求。请指明**具体文件路径**（如 `server/routers.ts`）、**要搜索的符号**，或**要运行的命令**（如 `npm run check`、`dotnet test <路径>`、`node --test <路径>`）。" + them.zh;
  }
  if (language === "en") {
    return "I'm not sure what you want me to do in the repo. Name a **specific file path** (e.g. `server/routers.ts`), a **symbol to search for**, or a **command to run** (e.g. `npm run check`, `dotnet test <path>`, `node --test <path>`)." + them.en;
  }
  return "Chưa rõ yêu cầu lập trình. Hãy nêu một **đường dẫn tệp cụ thể** (vd `server/routers.ts`), một **ký hiệu cần tìm**, hoặc một **lệnh cần chạy** (vd `npm run check`, `dotnet test <đường>`, `node --test <đường>`)." + them.vi;
}

/** Model chạy nhưng đầu ra thoái hoá (vòng lặp) — với MÃ thì không cứu phần đầu, xem `rutChuCoCanh`. */
function codingThoaiHoaMessage(language: KbLanguage, reason: string): string {
  const r = reason || "empty";
  if (language === "zh") return `本地模型的输出退化（${r}），已丢弃。这是真实故障，不是“没有想法”。请换一种说法或缩小请求范围后重试。`;
  if (language === "en") return `The local model's output degenerated (${r}) and was discarded. This is a real failure, not "no ideas". Rephrase or narrow the request and try again.`;
  return `Đầu ra của model cục bộ bị **thoái hoá** (${r}) nên đã bị BỎ. Đây là hỏng THẬT, không phải "AI không nghĩ ra gì" — với mã nguồn thì một phần đầu cứu được vẫn là mã hỏng, nên tôi không đưa nó cho bạn. Hãy diễn đạt lại hoặc thu hẹp yêu cầu.`;
}

/** Lượt gọi model NÉM — nói thẳng, không nuốt (bài học `runCodeModel` của G5-D). */
function codingModelErrorMessage(language: KbLanguage, e: unknown): string {
  const chiTiet = e instanceof Error ? e.message : String(e);
  if (chiTiet.includes("CODING_PROMPT_REDACTED")) {
    if (language === "zh") return "拒绝提出修改：输入安全过滤器改写了文件内容，若继续，模型会把被遮蔽的字符串写回文件（静默损坏）。请检查 `AI_SAFETY_ENABLED`。";
    if (language === "en") return "Refusing to propose an edit: the input safety filter rewrote the file content. Continuing would write the redacted placeholder back into the file (silent corruption). Check `AI_SAFETY_ENABLED`.";
    return "TỪ CHỐI đề xuất sửa: bộ che an toàn đầu vào đã thay đổi nội dung tệp trước khi model nhìn thấy. Đi tiếp nghĩa là ghi chính chỗ CHE ấy đè lên mã thật — hỏng CÂM. Hãy xem cờ `AI_SAFETY_ENABLED`.";
  }
  if (language === "zh") return `本地模型调用失败：${chiTiet}。这是真实故障，不是“不清楚需求”。请查看服务器日志（以及 llama-server）。`;
  if (language === "en") return `The local model call FAILED: ${chiTiet}. This is a real failure, not "unclear request". Check the server log (and llama-server).`;
  return `Lượt gọi model cục bộ **HỎNG**: ${chiTiet}. Đây là hỏng THẬT, không phải "chưa rõ yêu cầu" — thử lại y nguyên sẽ hỏng y nguyên. Xem nhật ký máy chủ (và llama-server nếu đang bật).`;
}

/** Model trả lời nhưng KHÔNG có khối mã ⇒ không dựng được `modified` ⇒ không đề xuất ghi. */
function codingKhongCoKhoiMaMessage(language: KbLanguage): string {
  if (language === "zh") return "⚠ 未提出写入：模型的回答中没有代码块，因此无法构造完整的新文件内容。宁可不改，也不猜。";
  if (language === "en") return "⚠ No write proposed: the model's answer contains no code block, so the full new file content could not be built. Refusing to guess.";
  return "⚠ KHÔNG đề xuất ghi: câu trả lời của model không có khối mã nào nên tôi không dựng được nội dung tệp mới đầy đủ. Thà không sửa còn hơn đoán.";
}

/**
 * ★★★ doc 79 (2026-08-21) — **KHỐI SỬA HỎNG.** Hai kết cục, và câu chữ phải phân biệt được chúng:
 * còn ĐƯỜNG LÙI (tệp đủ nhỏ để chép lại cả tệp) hay ĐÃ HẾT ĐƯỜNG.
 *
 * ⚠ Câu này luôn nêu **mã** + **đích danh đoạn neo**. Lỗi mà lượt trước để lại là một lời từ chối
 *   KHÔNG nói được nó từ chối cái gì; người dùng chỉ thấy mình chờ 45 giây rồi không có gì. Ba mã
 *   nhập nhằng (`NEO_KHONG_THAY` · `NEO_NHIEU_CHO` · `NEO_RONG`) dẫn tới **ba việc khác nhau** người
 *   dùng phải làm, nên chúng không được gộp thành một câu chung.
 */
function codingKhoiHongMessage(
  language: KbLanguage,
  relPath: string,
  ma: MaKhoiHong,
  chiTiet: string,
  luiDuoc: boolean,
): string {
  const vi: Record<MaKhoiHong, string> = {
    KHONG_CO_KHOI: `model không phát ra khối sửa nào (không có dòng mốc \`${MOC_MO}\`)`,
    KHOI_CUT: `khối sửa bị CẮT giữa chừng — ${chiTiet}. Đây là dấu hiệu đầu ra chạm trần token`,
    KHOI_MO_HO: `khối sửa không rõ ranh giới — ${chiTiet}`,
    NEO_RONG: `đoạn neo RỖNG (${chiTiet}) — một đoạn neo rỗng "khớp" ở mọi vị trí nên không xác định được chỗ nào`,
    NEO_KHONG_THAY: `KHÔNG tìm thấy đoạn neo trong tệp — ${chiTiet}. Model đang chép lại một đoạn không có ở đó`,
    NEO_NHIEU_CHO: `đoạn neo trùng ở NHIỀU CHỖ — ${chiTiet}. Tôi TỪ CHỐI thay vì đoán "chắc là chỗ đầu tiên": đoán ở đây là ghi đè nhầm chỗ trong im lặng`,
    KHOI_KHONG_DOI: `các khối áp xong mà tệp không đổi (${chiTiet})`,
  };
  const en: Record<MaKhoiHong, string> = {
    KHONG_CO_KHOI: `the model produced no edit block (no \`${MOC_MO}\` marker line)`,
    KHOI_CUT: `an edit block was CUT OFF — ${chiTiet}. That is the signature of hitting the output token cap`,
    KHOI_MO_HO: `an edit block has ambiguous boundaries — ${chiTiet}`,
    NEO_RONG: `the anchor is EMPTY (${chiTiet}) — an empty anchor "matches" everywhere, so no position can be determined`,
    NEO_KHONG_THAY: `the anchor was NOT found in the file — ${chiTiet}. The model copied text that is not there`,
    NEO_NHIEU_CHO: `the anchor matches MULTIPLE places — ${chiTiet}. Refusing rather than assuming "probably the first one": guessing here means overwriting the wrong place silently`,
    KHOI_KHONG_DOI: `the blocks applied cleanly but changed nothing (${chiTiet})`,
  };
  const zh: Record<MaKhoiHong, string> = {
    KHONG_CO_KHOI: `模型未产生任何修改块（没有 \`${MOC_MO}\` 标记行）`,
    KHOI_CUT: `修改块被截断——${chiTiet}。这是输出触达 token 上限的特征`,
    KHOI_MO_HO: `修改块边界不明确——${chiTiet}`,
    NEO_RONG: `锚点为空（${chiTiet}）——空锚点在任何位置都“匹配”，无法确定位置`,
    NEO_KHONG_THAY: `文件中找不到锚点——${chiTiet}。模型抄录了并不存在的片段`,
    NEO_NHIEU_CHO: `锚点匹配到多处——${chiTiet}。我拒绝而不是假定“大概是第一处”：在这里猜测等于静默改错地方`,
    KHOI_KHONG_DOI: `所有块都应用了，但文件没有变化（${chiTiet}）`,
  };
  if (language === "zh") {
    return luiDuoc
      ? `⚠ 基于块的修改未成功（"${relPath}"）：${zh[ma]}。该文件足够小，可以整文件重写——正在重试一次（会再花一次模型调用）。`
      : `⛔ 未提出写入（"${relPath}"）：${zh[ma]}。该文件太大，无法退回整文件重写（会超出输出 token 上限），所以这里没有可用的退路。请指明要改的函数或片段，或把文件拆小。`;
  }
  if (language === "en") {
    return luiDuoc
      ? `⚠ The block edit did not succeed on "${relPath}": ${en[ma]}. The file is small enough for a whole-file rewrite — retrying that once (costs one more model call).`
      : `⛔ No write proposed for "${relPath}": ${en[ma]}. The file is too large to fall back to a whole-file rewrite (it would exceed the output token cap), so there is no fallback here. Name the function or snippet to change, or split the file.`;
  }
  return luiDuoc
    ? `⚠ Lượt sửa THEO KHỐI không thành trên "${relPath}": ${vi[ma]}. Tệp này đủ nhỏ để chép lại cả tệp — tôi đang thử lại theo đường đó (tốn thêm một lượt gọi model).`
    : `⛔ KHÔNG đề xuất ghi cho "${relPath}": ${vi[ma]}. Tệp quá lớn để lùi về đường chép-cả-tệp (sẽ vượt trần token ĐẦU RA nên bản chép sẽ bị cắt cụt), nên ở đây KHÔNG có đường lùi nào. Hãy nêu rõ hàm/đoạn cần sửa, hoặc tách nhỏ tệp.`;
}

/** Model trả lại đúng tệp cũ — không phải sự cố, chỉ là không có gì để áp. */
function codingKhongDoiMessage(language: KbLanguage, relPath: string): string {
  if (language === "zh") return `⚠ 未提出写入：模型返回的内容与 "${relPath}" 当前内容完全一致。`;
  if (language === "en") return `⚠ No write proposed: the model returned content identical to the current "${relPath}".`;
  return `⚠ KHÔNG đề xuất ghi: nội dung model trả về GIỐNG HỆT tệp "${relPath}" hiện tại.`;
}

/**
 * ★ doc 79 (2026-08-20) — tệp KHÔNG tồn tại và người dùng KHÔNG xin tạo. Hành vi cũ (nói NOT_FOUND)
 * giữ nguyên; thêm đúng một câu chỉ ra rằng TẠO là một việc làm được — vì trước lượt này nó KHÔNG
 * làm được, nên người dùng không có lý do gì để đoán rằng nay nó làm được.
 */
function codingGoiYTaoTepMessage(language: KbLanguage, duong: string): string {
  if (language === "zh") return `如果你本来就想**新建**该文件，请直接说：「创建新文件 ${duong} …（需求）」。我会先确认它确实不存在，再提出一份完整内容供你审批。`;
  if (language === "en") return `If you meant to **create** it, say: "create a new file ${duong} … (what it should do)". I will verify it really does not exist, then propose the full content for your approval.`;
  return `Nếu bạn muốn **TẠO** tệp này, hãy nói thẳng: *"tạo file mới ${duong} … (làm gì)"*. Tôi sẽ kiểm chắc chắn tệp chưa tồn tại rồi đề xuất toàn bộ nội dung để bạn duyệt.`;
}

/**
 * ★★ doc 79 (2026-08-20) — xin TẠO nhưng tệp **ĐÃ CÓ**. Từ chối TƯỜNG MINH, không âm thầm biến
 * thành ghi đè: một lượt "tạo" trên tệp có sẵn mà cứ thế chạy tiếp nghĩa là gửi `original:""` cho
 * một tệp có nội dung, tức đề xuất **xoá sạch rồi ghi lại**. `apply_diff` sẽ chặn bằng
 * `BASE_MISMATCH`, nhưng đó là một câu đúng mà khó hiểu — người dùng cần biết chuyện gì đã xảy ra.
 */
function codingTepDaTonTaiMessage(language: KbLanguage, relPath: string): string {
  if (language === "zh") return `⚠ 未提出写入：文件 "${relPath}" **已存在**，因此这不是一次“新建”。我不会把新建悄悄变成覆盖（那等于先清空再重写）。如果你确实要改它，请说「修改 ${relPath} …」；如果要另建一个文件，请换一个路径。`;
  if (language === "en") return `⚠ No write proposed: "${relPath}" **already exists**, so this is not a CREATE. I will not silently turn a create into an overwrite (that would mean wiping the file and rewriting it). To change it, say "edit ${relPath} …"; to create a different file, pick another path.`;
  return `⚠ KHÔNG đề xuất ghi: tệp "${relPath}" **ĐÃ TỒN TẠI**, nên đây không phải một lượt TẠO. Tôi KHÔNG âm thầm biến một lượt tạo thành ghi đè — làm vậy nghĩa là xoá sạch tệp rồi viết lại. Muốn đổi nội dung thì nói *"sửa ${relPath} …"*; muốn tạo tệp khác thì chọn đường dẫn khác.`;
}

/** ★ Lô vượt trần số tệp một lượt — nói THẲNG con số, không âm thầm cắt bớt danh sách người dùng gõ. */
function codingQuaNhieuTepMessage(language: KbLanguage, soTep: number): string {
  if (language === "zh") return `⚠ 一次最多处理 ${TRAN_TEP_MOT_LUOT_SUA} 个文件，你列出了 ${soTep} 个。每个文件都要单独调用一次本地模型（约 30 秒），因此这是**时间**上限而非 token 上限。请分批提出。我不会悄悄截断你的列表。`;
  if (language === "en") return `⚠ At most ${TRAN_TEP_MOT_LUOT_SUA} files per turn; you listed ${soTep}. Each file costs one local-model call (~30 s), so this is a TIME cap, not a token cap. Split the request. I will not silently truncate your list.`;
  return `⚠ Một lượt chỉ xử lý tối đa **${TRAN_TEP_MOT_LUOT_SUA} tệp**, bạn nêu ${soTep}. Mỗi tệp tốn MỘT lượt gọi model cục bộ (~30 giây) nên đây là trần **THỜI GIAN**, không phải trần token. Hãy chia thành nhiều lượt — tôi KHÔNG âm thầm cắt bớt danh sách bạn đã gõ.`;
}

/** ★ Tiêu đề mỗi tệp trong một lô — đi vào `content` của phiên, nên nó sống sót khi mở lại phiên. */
function codingTieuDeTepMessage(language: KbLanguage, i: number, n: number, duong: string): string {
  if (language === "zh") return `### 文件 ${i}/${n} — \`${duong}\``;
  if (language === "en") return `### File ${i}/${n} — \`${duong}\``;
  return `### Tệp ${i}/${n} — \`${duong}\``;
}

/** ★ Lô dừng giữa chừng: nói rõ tệp nào chặn và **không có đề xuất nào được đưa ra**. */
function codingLoDungMessage(language: KbLanguage, relPath: string, daXong: number): string {
  if (language === "zh") return `⛔ 整批已停止在 "${relPath}"，**未提出任何写入**（此前已准备好 ${daXong} 个文件的改动，一并丢弃）。只改一部分会留下无法编译的代码树，所以要么全改，要么不改。`;
  if (language === "en") return `⛔ The whole batch stopped at "${relPath}" and **no write was proposed** (${daXong} already-prepared edits were discarded with it). A partial rename leaves a tree that does not compile — all or nothing.`;
  return `⛔ CẢ LÔ dừng ở "${relPath}" và **KHÔNG có đề xuất ghi nào** (${daXong} bản sửa đã chuẩn bị trước đó cũng bị bỏ theo). Sửa một phần sẽ để lại cây mã không biên dịch được — nên hoặc đổi hết, hoặc không đổi gì.`;
}

/** ★ Lô chạy hết nhưng không tệp nào đổi — không phải sự cố. */
function codingLoKhongDoiMessage(language: KbLanguage, khongDoi: readonly string[]): string {
  const ds = khongDoi.join(", ");
  if (language === "zh") return `⚠ 未提出写入：模型对所有文件返回的内容都与当前一致（${ds}）。`;
  if (language === "en") return `⚠ No write proposed: the model returned content identical to the current one for every file (${ds}).`;
  return `⚠ KHÔNG đề xuất ghi: model trả về nội dung GIỐNG HỆT bản hiện tại cho mọi tệp (${ds}).`;
}

/**
 * ★★★ 2026-08-24 — MANIFEST KHUNG HỎNG ⇒ **FAIL-SAFE VỀ CÂU TRẢ LỜI THƯỜNG**, không đề xuất gì.
 * Chữ model đã stream cho người đọc rồi; câu này chỉ nói thật vì sao không có thẻ duyệt, kèm mã +
 * chi tiết máy-đọc-được để lượt sau (người hoặc lưới) hành động được.
 */
/**
 * ★ Thông báo NGƯỜI DÙNG thấy khi lượt tự-sửa khởi động — nói thật đang làm gì và vì sao, kèm
 * nguyên văn lỗi để người chờ không mù (một lượt 30B ~vài phút).
 */
/**
 * ★ Tệp phạm chính sách nhưng KHÔNG ai tham chiếu ⇒ bị LOẠI khỏi lô, và câu này là lời khai —
 * loại ÂM THẦM là một kiểu cắt bớt nói dối, đúng lớp "không silent-truncation" của repo.
 */
/**
 * ★★★ 2026-08-24 — Câu NOTE khi khung tới từ `dotnet new` (khung CHUẨN Microsoft), KHÔNG từ model.
 * Nói THẬT: dùng template gì, tên dự án gì, đã bỏ sản phẩm dựng (obj/bin) + tài nguyên nhị phân.
 * Khi khung có `<PackageReference>` (đo bằng `coPackageReference`) ⇒ KHAI hai chế độ NuGet: máy
 * OFFLINE tự tải + chép local feed TRƯỚC khi build · máy CÓ INTERNET `dotnet restore` kéo bình thường
 * — khớp công tắc `DOTNET_CHO_PHEP_RESTORE` ở `repoCommandSandbox`, và cùng lời khai persona model.
 */
function codingKhungDotnetMessage(language: KbLanguage, template: string, slug: string, coNuGet: boolean): string {
  if (language === "zh") {
    const nuGet = coNuGet
      ? `\n\n⚠ 骨架含 \`PackageReference\`（NuGet）。离线机器：构建前自行下载包并复制到本地 NuGet 源；联网机器：\`dotnet restore\` 可正常拉取。`
      : "";
    return `✓ 已用标准模板 \`dotnet new ${template}\`（微软官方骨架）生成项目「${slug}」，并剔除构建产物（obj/ bin/）与白名单之外的文件（二进制/资源）。请逐个文件审批下面的写入。${nuGet}`;
  }
  if (language === "en") {
    const nuGet = coNuGet
      ? `\n\n⚠ The skeleton has \`PackageReference\` (NuGet). OFFLINE machine: download the packages and copy them into a local NuGet feed BEFORE building; machine WITH internet: \`dotnet restore\` fetches them normally.`
      : "";
    return `✓ Used \`dotnet new ${template}\` (Microsoft's standard skeleton) to scaffold project "${slug}", with build artifacts (obj/ bin/) and non-whitelisted files (binary/assets) removed. Review each file write below.${nuGet}`;
  }
  const nuGet = coNuGet
    ? `\n\n⚠ Khung có \`PackageReference\` (NuGet). Máy OFFLINE: tự tải package và chép vào local NuGet feed TRƯỚC khi build; máy CÓ INTERNET: \`dotnet restore\` kéo về bình thường.`
    : "";
  return `✓ Đã dùng khung CHUẨN \`dotnet new ${template}\` (Microsoft) để dựng dự án "${slug}", đã bỏ sản phẩm dựng (obj/ bin/) và tệp ngoài danh sách nguồn (nhị phân/tài nguyên). Duyệt từng tệp bên dưới.${nuGet}`;
}

function codingKhungLoaiTepMessage(language: KbLanguage, tepLoai: string[], conLai: number): string {
  const ds = tepLoai.join(", ");
  if (language === "zh")
    return `⚠ 已从骨架中剔除 ${tepLoai.length} 个白名单外的文件（清单中无其他文件引用它）：${ds}。其余 ${conLai} 个文件照常提交审批。`;
  if (language === "en")
    return `⚠ Dropped ${tepLoai.length} file(s) outside the whitelist (nothing else in the manifest references them): ${ds}. The remaining ${conLai} file(s) proceed to approval as usual.`;
  return `⚠ Đã LOẠI ${tepLoai.length} tệp ngoài danh sách trắng (không tệp nào khác trong manifest tham chiếu tới): ${ds}. ${conLai} tệp còn lại vẫn được đề xuất duyệt như thường.`;
}

function codingKhungTuSuaThongBao(language: KbLanguage, cauLoi: string): string {
  if (language === "zh") return `⚠ 首版清单被拒绝：${cauLoi}\n→ 正在自动让模型重出一版干净的骨架（仅重试一次）…`;
  if (language === "en") return `⚠ First manifest refused: ${cauLoi}\n→ Automatically asking the model for a clean skeleton (single retry)…`;
  return `⚠ Manifest lượt đầu bị từ chối: ${cauLoi}\n→ Đang tự yêu cầu model xuất lại khung sạch (đúng MỘT lượt tự sửa)…`;
}

/**
 * ★ Câu hỏi của LƯỢT TỰ SỬA — câu gốc + nguyên văn lỗi + mệnh lệnh sửa. Lỗi là chữ do CHÍNH server
 * sinh (không phải dữ liệu ngoài) nên đứng thẳng trong ô yêu cầu được.
 */
function codingKhungCauTuSua(language: KbLanguage, question: string, cauLoi: string): string {
  if (language === "zh")
    return `${question}\n\n[上一轮错误 — 必须修复] ${cauLoi}\n重新输出完整骨架（所有文件，同样的 ${MOC_TEP_KHUNG} 格式）；彻底去掉违规文件，并删除其他文件（csproj、XAML…）中对它的一切引用。`;
  if (language === "en")
    return `${question}\n\n[PREVIOUS-TURN ERROR — MUST FIX] ${cauLoi}\nRe-emit the FULL skeleton (every file, same ${MOC_TEP_KHUNG} format); drop the offending file entirely and remove every reference to it in the other files (csproj, XAML…).`;
  return `${question}\n\n[LỖI LƯỢT TRƯỚC — BẮT BUỘC SỬA] ${cauLoi}\nXuất lại TOÀN BỘ khung (mọi tệp, đúng khuôn ${MOC_TEP_KHUNG}); BỎ HẲN tệp phạm quy và xoá MỌI tham chiếu tới nó trong các tệp khác (csproj, XAML…).`;
}

function codingKhungHongMessage(language: KbLanguage, ma: MaManifestKhung, chiTiet: string): string {
  const viMa: Record<MaManifestKhung, string> = {
    KHONG_CO_TEP: `không có dòng "${MOC_TEP_KHUNG}" nào — model trả lời văn xuôi thay vì manifest`,
    TEP_KHONG_DUONG: `một dòng tiêu đề tệp không có đường dẫn (${chiTiet})`,
    TEP_THIEU_KHOI: `tệp "${chiTiet}" khai tên mà không có khối mã nội dung`,
    TEP_RONG: `tệp "${chiTiet}" có khối mã RỖNG — tạo tệp rỗng là vô nghĩa`,
    TEP_TRUNG: `cùng một đường khai HAI LẦN: ${chiTiet}`,
  };
  const enMa: Record<MaManifestKhung, string> = {
    KHONG_CO_TEP: `no "${MOC_TEP_KHUNG}" line at all — the model answered in prose instead of a manifest`,
    TEP_KHONG_DUONG: `a file header line carries no path (${chiTiet})`,
    TEP_THIEU_KHOI: `file "${chiTiet}" is named but has no content code block`,
    TEP_RONG: `file "${chiTiet}" has an EMPTY code block — creating an empty file is pointless`,
    TEP_TRUNG: `the same path is declared TWICE: ${chiTiet}`,
  };
  const zhMa: Record<MaManifestKhung, string> = {
    KHONG_CO_TEP: `完全没有 "${MOC_TEP_KHUNG}" 行——模型用散文作答而不是清单`,
    TEP_KHONG_DUONG: `某个文件标题行没有路径（${chiTiet}）`,
    TEP_THIEU_KHOI: `文件 "${chiTiet}" 只有名字，没有内容代码块`,
    TEP_RONG: `文件 "${chiTiet}" 的代码块为空——创建空文件没有意义`,
    TEP_TRUNG: `同一路径声明了两次：${chiTiet}`,
  };
  if (language === "zh") return `⚠ 未提出写入 [${ma}]：${zhMa[ma]}。上面的回答保留为普通回答；请再说一次「创建项目 …」重试。`;
  if (language === "en") return `⚠ No write proposed [${ma}]: ${enMa[ma]}. The answer above stands as a plain answer; say "create a project …" again to retry.`;
  return `⚠ KHÔNG đề xuất ghi [${ma}]: ${viMa[ma]}. Câu trả lời phía trên giữ nguyên như một câu trả lời thường; gõ lại *"tạo dự án …"* để thử lượt khác.`;
}

/** ★ Khung vượt trần số tệp của MỘT thẻ duyệt — nói thẳng con số, không âm thầm cắt bớt. */
function codingKhungQuaTranMessage(language: KbLanguage, soTep: number): string {
  if (language === "zh") return `⚠ 未提出写入：骨架有 ${soTep} 个文件，超过一张审批卡的上限 ${TRAN_TEP_MOI_LO}。请要求“最小骨架”（入口 + 项目文件 + 1–2 个核心文件），其余留到下一轮。我不会悄悄截断清单。`;
  if (language === "en") return `⚠ No write proposed: the skeleton has ${soTep} files, above the ${TRAN_TEP_MOI_LO}-file cap of ONE approval card. Ask for a "minimal skeleton" (entry point + project file + 1–2 core files) and add the rest next turn. I will not silently truncate the list.`;
  return `⚠ KHÔNG đề xuất ghi: khung có ${soTep} tệp, vượt trần **${TRAN_TEP_MOI_LO} tệp** của MỘT thẻ duyệt. Hãy yêu cầu *"khung tối thiểu"* (điểm vào + tệp dự án + 1–2 tệp lõi), phần còn lại để lượt sau — tôi KHÔNG âm thầm cắt bớt danh sách.`;
}

/**
 * ★★★ Khung bị TỪ CHỐI CẢ LÔ ở tầng hậu kiểm — ba lý do, mỗi lý do một hành động khác của người
 * dùng, và luôn LIỆT KÊ ĐÍCH DANH tệp phạm (một lời từ chối không nêu được nó từ chối cái gì là
 * lớp lỗi đã trả giá ở đường sửa-theo-khối).
 */
function codingKhungTuChoiMessage(
  language: KbLanguage,
  ma: "TEP_DA_TON_TAI" | "DUONG_KHONG_HOP_LE" | "KHONG_KIEM_DUOC",
  danhSach: readonly string[],
): string {
  const ds = danhSach.join(", ");
  if (ma === "TEP_DA_TON_TAI") {
    if (language === "zh") return `⛔ 整个骨架被拒绝 [TEP_DA_TON_TAI]：以下文件**已存在**：${ds}。半套骨架比没有更糟，所以一个文件已存在就拒绝整批——没有任何字节被写入。要修改现有文件请说「修改 <文件>: …」；要新建骨架请选一个空目录。`;
    if (language === "en") return `⛔ The whole skeleton was refused [TEP_DA_TON_TAI]: these files ALREADY EXIST: ${ds}. A half-scaffold is worse than none, so one existing file refuses the whole batch — nothing was written. To edit an existing file say "edit <file>: …"; to scaffold, pick an empty folder.`;
    return `⛔ TỪ CHỐI CẢ KHUNG [TEP_DA_TON_TAI]: các tệp sau **ĐÃ TỒN TẠI**: ${ds}. Một khung dự án nửa vời tệ hơn không có, nên chỉ cần MỘT tệp đã tồn tại là cả lô bị từ chối — chưa một byte nào được ghi. Muốn sửa tệp đang có, nói *"sửa <tệp>: …"*; muốn dựng khung, chọn một thư mục trống.`;
  }
  if (ma === "DUONG_KHONG_HOP_LE") {
    if (language === "zh") return `⛔ 整个骨架被拒绝 [DUONG_KHONG_HOP_LE]：以下路径未通过沙箱策略（绝对路径 / ".." / 盘符 / 受禁目录 / 扩展名不在白名单）：${ds}。未写入任何字节。`;
    if (language === "en") return `⛔ The whole skeleton was refused [DUONG_KHONG_HOP_LE]: these paths failed the sandbox policy (absolute / ".." / drive letter / denied dir / extension outside the whitelist): ${ds}. Nothing was written.`;
    return `⛔ TỪ CHỐI CẢ KHUNG [DUONG_KHONG_HOP_LE]: các đường sau không qua được chính sách hộp cát (tuyệt đối / \`..\` / ổ đĩa / thư mục cấm / đuôi ngoài danh sách trắng): ${ds}. Chưa một byte nào được ghi.`;
  }
  if (language === "zh") return `⛔ 整个骨架被拒绝 [KHONG_KIEM_DUOC]：无法证明以下文件不存在：${ds}。无法证明就不写（fail-closed）。`;
  if (language === "en") return `⛔ The whole skeleton was refused [KHONG_KIEM_DUOC]: could not prove these files do not exist: ${ds}. Cannot prove ⇒ do not write (fail-closed).`;
  return `⛔ TỪ CHỐI CẢ KHUNG [KHONG_KIEM_DUOC]: không chứng minh được các tệp sau CHƯA tồn tại: ${ds}. Không chứng minh được thì không ghi (fail-closed).`;
}

/** ★ Lượt TẠO mà model không cho ra nội dung nào — khác hẳn "giống hệt tệp cũ" (không có tệp cũ). */
function codingTaoRongMessage(language: KbLanguage, relPath: string): string {
  if (language === "zh") return `⚠ 未提出写入：模型为新文件 "${relPath}" 返回的内容为空。创建一个空文件没有意义，故拒绝。`;
  if (language === "en") return `⚠ No write proposed: the model returned EMPTY content for the new file "${relPath}". Creating an empty file is not useful — refusing.`;
  return `⚠ KHÔNG đề xuất ghi: model trả về nội dung RỖNG cho tệp mới "${relPath}". Tạo một tệp rỗng thì vô nghĩa nên tôi từ chối.`;
}

/** Ba lý do fail-closed của nhánh sửa — mỗi lý do một việc khác nhau người dùng phải làm. */
function codingKhongTuSuaMessage(
  language: KbLanguage,
  relPath: string,
  ly: "NO_CONTENT" | "TRUNCATED" | "REDACTED" | "TOO_LARGE" | "NGAN_SACH",
): string {
  const vi: Record<typeof ly, string> = {
    NO_CONTENT: `Đọc được "${relPath}" nhưng không có nội dung để sửa.`,
    TRUNCATED: `Tôi chỉ đọc được MỘT PHẦN "${relPath}" (chạm trần byte). Sửa một tệp mà chỉ nhìn nửa đầu là đoán mò, và diff dựng từ đó chắc chắn bị từ chối vì lệch băm. Hãy thu hẹp phạm vi hoặc tăng trần byte.`,
    REDACTED: `Nội dung "${relPath}" có chuỗi trông như BÍ MẬT nên đã bị che khi đọc. Nếu tôi sửa từ bản đã che thì chỗ che sẽ được ghi ĐÈ lên mã thật — hỏng CÂM. TỪ CHỐI sửa tệp này; hãy sửa tay.`,
    TOO_LARGE: `Tệp "${relPath}" quá lớn (> ${TRAN_KY_TU_TEP_SUA} ký tự) để đưa trọn vào một lượt sửa. Hãy tách tệp hoặc nêu rõ hàm cần sửa để tôi đọc/giải thích thay vì ghi đè cả tệp.`,
    NGAN_SACH: `Tệp "${relPath}" lọt trần ký tự nhưng KHÔNG lọt **ngân sách ngữ cảnh** của model: nội dung tệp cộng phần dành cho câu trả lời đã vượt trần token mỗi slot. Đây KHÔNG phải do lịch sử hội thoại — lịch sử đã bị bỏ hết mà vẫn không đủ chỗ. Hãy tách tệp, hoặc nêu rõ hàm cần sửa để tôi đọc/giải thích thay vì ghi đè cả tệp.`,
  };
  const en: Record<typeof ly, string> = {
    NO_CONTENT: `Read "${relPath}" but there is no content to edit.`,
    TRUNCATED: `I could only read PART of "${relPath}" (byte cap). Editing from a partial view is guessing, and the resulting diff would be rejected on a hash mismatch.`,
    REDACTED: `"${relPath}" contains a secret-looking string that was redacted on read. Editing from the redacted copy would write the placeholder over real code (silent corruption). Refusing.`,
    TOO_LARGE: `"${relPath}" is too large (> ${TRAN_KY_TU_TEP_SUA} chars) for a whole-file edit. Split it, or name the function so I can read/explain instead of overwriting.`,
    NGAN_SACH: `"${relPath}" is under the character cap but does NOT fit the model's CONTEXT BUDGET: the file plus the reserved answer tokens exceed the per-slot limit. This is not caused by conversation history — history was dropped entirely and it still does not fit. Split the file, or name the function so I can read/explain instead of overwriting.`,
  };
  const zh: Record<typeof ly, string> = {
    NO_CONTENT: `已读取 "${relPath}"，但没有可编辑的内容。`,
    TRUNCATED: `只读到 "${relPath}" 的一部分（字节上限）。基于片段修改等于猜测，生成的 diff 也会因哈希不匹配被拒绝。`,
    REDACTED: `"${relPath}" 含有疑似密钥的字符串，读取时已被遮蔽。基于遮蔽副本修改会把占位符写回真实代码（静默损坏），故拒绝。`,
    TOO_LARGE: `"${relPath}" 太大（> ${TRAN_KY_TU_TEP_SUA} 字符），无法整文件修改。请拆分文件，或指明要改的函数。`,
    NGAN_SACH: `"${relPath}" 未超字符上限，但超出模型的**上下文预算**：文件内容加上预留的回答 token 已超过每个 slot 的上限。这与对话历史无关——历史已被全部丢弃仍不够。请拆分文件，或指明要改的函数。`,
  };
  return language === "en" ? en[ly] : language === "zh" ? zh[ly] : vi[ly];
}

/** ★ doc 79 TRỤC 2 — id dự án không nằm trong danh sách trắng (id lạ / client gửi đường dẫn). */
function codingProjectDeniedMessage(language: KbLanguage, projectId: unknown): string {
  const id = typeof projectId === "string" ? projectId : String(projectId ?? "");
  if (language === "zh") {
    return `所选项目（\`${id}\`）不在允许列表中。请从项目选择器中选择一个有效项目——客户端只发送项目 **ID**，服务器在 \`AI_REPO_SANDBOX_ROOTS\` 白名单中解析路径；不接受任意路径。`;
  }
  if (language === "en") {
    return `The selected project (\`${id}\`) is not in the allowlist. Pick a valid project from the selector — the client sends only a project **ID**, and the server resolves the path from the \`AI_REPO_SANDBOX_ROOTS\` whitelist; arbitrary paths are never accepted.`;
  }
  return `Dự án đang chọn (\`${id}\`) KHÔNG nằm trong danh sách cho phép. Hãy chọn một dự án hợp lệ ở bộ chọn — client chỉ gửi **id** dự án, server tra đường dẫn trong danh sách TRẮNG \`AI_REPO_SANDBOX_ROOTS\`; đường dẫn tự do KHÔNG bao giờ được chấp nhận.`;
}

function codingErrorMessage(language: KbLanguage, toolName: string | null, error: string): string {
  const t = toolName ?? "?";
  if (language === "zh") return `工具 \`${t}\` 执行出错：${error}。这是真实的执行错误，不是政策拒绝。`;
  if (language === "en") return `Tool \`${t}\` failed: ${error}. This is a real execution error, not a policy refusal.`;
  return `Tool \`${t}\` gặp lỗi khi chạy: ${error}. Đây là lỗi thực thi THẬT, không phải một lượt từ chối vì chính sách.`;
}
