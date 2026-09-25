/**
 * B8 (kế hoạch AI Local 2026-09-22 §2) — NHÁNH LẬP TRÌNH của trợ lý AI Local (`context.codingMode === true`),
 * tách NGUYÊN VĂN khỏi `aiLocalKnowledgeService.ts` (7.333 dòng) để tệp gốc còn lại là KB‑QA + truy hồi +
 * định tuyến `streamAnswer`. Không đổi hành vi: thân mã giữ từng byte; `aiLocalKnowledgeService.ts`
 * re-export mọi tên từng export ở đây, nên người gọi và lưới cũ không đổi một dòng.
 *
 * Tệp này giữ: bài học lượt (doc 82) · khối đầu ra máy vào lịch sử · điểm vào `streamCodingAnswer` (bộ
 * định tuyến giữa các luồng) · vị từ ý định sửa/tạo tệp · hằng trần + `doneSinhMa`/`nguCanhDuAnChoPrompt`
 * dùng chung. Các luồng ở tệp anh em (B8 bước 2):
 *   · `aiLocalKnowledgeCodingSua.ts`      — sửa một tệp · tự trị ghi · sửa nhiều tệp · `motLuotModel`;
 *   · `aiLocalKnowledgeCodingTaoKhung.ts` — tạo khung dự án;
 *   · `aiLocalKnowledgeCodingSinhMa.ts`   — sinh mã (+ bổ sung `using` C# R2B);
 *   · `aiLocalKnowledgeCodingThongBao.ts` — câu thông báo ba ngôn ngữ.
 *
 * ⚠ Phụ thuộc NGƯỢC về service chỉ gồm kiểu (`KbLanguage`, `KbQueryContext`, `StreamEvent`) và hai hàm
 *   thuần (`resolveLanguage`, `extractStructuredResponse`) — chỉ gọi lúc CHẠY, không lúc nạp module, nên
 *   vòng import hai chiều này an toàn trong ESM.
 */

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
import { cauChiNenNo } from "./ai/toolDuongTat";
import { laCauSinhMa } from "./ai/cauSinhMa";
import { vanBanChoModel } from "./ai/vanBanChoModel";
/**
 * ★★★ doc 79 · TRỤC 1 (C) — cửa gọi model của TÁC NHÂN LẬP TRÌNH (persona + bộ cắt + bộ che + canh
 * thoái hoá + bóc khối mã). Xem `aiCodingAgent.ts` để biết vì sao nó KHÔNG nằm trong `services/ai/`.
 */
import {
  // ★★★ 2026-08-23 — hai hằng của khối lịch sử; `TRAN_KY_TU_DAU_RA_MAY` SUY RA từ chúng, không gõ tay.
  TRAN_KY_TU_MOI_LUOT,
  HAU_TO_CAT_LUOT,
  KY_TU_MOI_TOKEN_RA,
  type LuotHoiThoai,
} from "./aiCodingAgent";
/**
 * ★★★ doc 79 · TRỤC 1 (D) — MỤC LỤC (chunk) → MÃ THẬT (đọc đĩa qua `read_file`). Xem docblock đầu
 * `ai/codingRepoContext.ts`: module ấy KHÔNG nhập `fs`; cửa đọc do CHÍNH file này tiêm vào.
 */
import {
  TRAN_TOKEN_NGU_CANH_MA,
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
// ★ B8 — các câu thông báo ba ngôn ngữ đã tách sang `./aiLocalKnowledgeCodingThongBao.ts` (xem docblock đầu tệp đó).
import { codingErrorMessage, codingNoToolMessage, codingProjectDeniedMessage, } from "./aiLocalKnowledgeCodingThongBao";
// ★ B8 — luồng SINH MÃ đã tách sang `./aiLocalKnowledgeCodingSinhMa.ts` (xem docblock đầu tệp đó).
import { streamCodingGenerate } from "./aiLocalKnowledgeCodingSinhMa";
// ★ B8 — luồng SỬA (một tệp · tự trị · nhiều tệp) đã tách sang `./aiLocalKnowledgeCodingSua.ts` (xem docblock đầu tệp đó).
import { streamCodingEdit, streamCodingSuaNhieuTep, streamCodingTuTriGhi } from "./aiLocalKnowledgeCodingSua";
// ★ B8 — luồng TẠO KHUNG dự án đã tách sang `./aiLocalKnowledgeCodingTaoKhung.ts` (xem docblock đầu tệp đó).
import { streamCodingTaoKhung } from "./aiLocalKnowledgeCodingTaoKhung";


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
    /**
     * ★★★ 2026-09-25 (chủ dự án báo: *"Thêm chức năng chuyển đổi đơn vị"* ⇒ nhận về NGUYÊN VĂN cây thư mục + tệp
     * `Calculator.cs`, 0 dòng mã) — THÊM VẾ CẤU TRÚC `quyetDinh.tool === null`.
     * Hai vị từ chữ ở trên là DANH SÁCH TỪ và sẽ luôn sót ("thêm chức năng…", "bổ sung tính năng…", "cho phép đổi…").
     * Dấu hiệu CẤU TRÚC thì không sót: đường DUMP chỉ đúng cho câu ĐỌC TƯỜNG MINH, và câu đọc tường minh là câu mà
     * heuristic tất định (`classifyCodingToolIntent`, các `CODING_*_SHORTCUT`) đã khớp. Heuristic nói "không tool nào"
     * mà vòng tool vẫn chạy ⇒ các tool do bộ chọn LLM gọi để GOM NGỮ CẢNH cho một yêu cầu KHÁC ⇒ kết quả phải quay lại
     * model. Đường nhanh "đọc file X / liệt kê thư mục Y" (heuristic khớp) giữ nguyên.
     */
    if (answer.trim() !== "" && (laCauCanSuyLuan(question) || laCauSinhMa(question) || quyetDinh.tool === null)) {
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
export const TRAN_TOKEN_TAO_TEP = 4_000;

/**
 * ★ Trần token ĐẦU RA cho một lượt **TẠO KHUNG DỰ ÁN** — MỘT lượt model phát tới 8 tệp.
 * 8.000 token ≈ 20 KB mã: dư cho một khung tối thiểu (csproj + App.xaml(.cs) + MainWindow.xaml(.cs)
 * + service + README ≈ 6–8 KB), và prompt của lượt này KHÔNG chở nội dung tệp nào (các tệp chưa
 * tồn tại) nên slot 32.768 còn ~24.700 token dư địa — trần này không bao giờ ép prompt nhường chỗ.
 */
export const TRAN_TOKEN_TAO_KHUNG = 8_000;

/**
 * ★★ Trần số tệp mà đường **SỬA NHIỀU TỆP** chịu xử lý trong một lượt.
 *
 * ⚠ Đây là trần của LƯỢT NGƯỜI DÙNG, và nó **thấp hơn** trần của thẻ duyệt
 * (`applyDiffBatch.TRAN_TEP_MOI_LO = 8`) một cách có chủ ý: mỗi tệp tốn MỘT lượt gọi model 30B
 * (~30 s). Sáu tệp đã là ~3 phút người dùng ngồi nhìn màn hình. Trần thấp hơn ⇒ hai trần KHÔNG BAO
 * GIỜ mâu thuẫn, và cái chặn trước luôn là cái nói được lý do dễ hiểu hơn.
 */
export const TRAN_TEP_MOT_LUOT_SUA = 6;

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
export async function nguCanhDuAnChoPrompt(
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
export function doneSinhMa(answer: string, provider: "ollama" | "tool", degraded?: { reason: string }): StreamEvent {
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

// ★ B8 — 4 khai báo đã chuyển sang `./aiLocalKnowledgeCodingSinhMa.ts`; re-export để mọi người gọi/lưới cũ không đổi một dòng.
export type { LyDoKhongSinhMa } from "./aiLocalKnowledgeCodingSinhMa";
