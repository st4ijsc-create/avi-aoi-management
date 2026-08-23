import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  tryExecuteToolLoop,
  tryExecuteCodingToolLoop,
  executeDecision,
  type ToolResult,
  type ToolExecContext,
  type PendingActionDTO,
  type ClientActionDirective,
  type ToolLoopProgress,
  type ToolLoopResult,
} from "./aiLocalTools";
/**
 * ★★★ doc 79 · TRỤC 1 (C) — bộ chọn tool LẬP TRÌNH TẤT ĐỊNH, dùng LẠI NGUYÊN VẸN để hỏi
 * *"câu này có nêu một đường dẫn tệp không?"* trước khi quyết định ĐỌC hay SỬA. Nhập từ module con
 * để KHÔNG mở thêm một bộ trích đường dẫn thứ hai (hai bộ trích = hai sự thật về cùng một câu).
 */
import { classifyCodingToolIntent, trichMoiDuongDanRepo } from "./aiLocalTools/intentClassifier";
/**
 * ★★★ doc 79 · TRỤC 1 (C) — cửa gọi model của TÁC NHÂN LẬP TRÌNH (persona + bộ cắt + bộ che + canh
 * thoái hoá + bóc khối mã). Xem `aiCodingAgent.ts` để biết vì sao nó KHÔNG nằm trong `services/ai/`.
 */
import {
  apDungKhoiSua,
  bocKhoiMa,
  bocKhoiSua,
  chepCaTepDuocKhong,
  chuanHoaTepMoi,
  codingEditEnabled,
  codingGenEnabled,
  codingKhoiSuaEnabled,
  codingModelSanSang,
  dongBoXuongDong,
  MOC_MO,
  personaSinhMa,
  personaSuaTep,
  personaSuaTepKhoi,
  personaTaoTep,
  promptSinhMa,
  promptSuaTep,
  promptSuaTepKhoi,
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
import { rerank, isRerankerEnabled, type RerankCandidate } from "./aiReranker";
// ★ G4-B — trọng số hạng nguồn (module LÁ, dùng CHUNG với bộ eval `--parity`).
import { sourceTypeWeight, sourceLanguageWeight, devJournalWeight } from "./aiKbSourceWeights";
import { loadSemanticGraph, expandWithGraph } from "./aiSemanticGraph";
// FE-W0.3 (doc 46 §2.3) — degenerate-loop guard (pure, dependency-free).
import { guardGeneratedText, isDegenerateStream } from "./ai/generationGuard";
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
import {
  redactSecretsAndPII,
  StreamingSecretRedactor,
  sanitizeUntrustedBlock,
  wrapUntrustedBlock,
  type InjectionRisk,
} from "./ai/aiSafety";
/**
 * ★★★ G5-C — BỘ CẮT CHUỖI SUY LUẬN, import TĨNH từ module LÁ (`./ai/thinkingStrip`).
 *
 * ⚠ CỐ Ý KHÔNG lấy từ `./aiGgufEngine`, dù bộ cắt được re-export ở đó, vì HAI lý do cơ chế:
 *   1. File này chỉ chạm engine qua `await import("./aiGgufEngine")` **bên trong `try`** (engine
 *      nặng, kéo node-llama-cpp). Lấy bộ cắt từ đó = import hỏng thì nhánh `catch` chạy tiếp
 *      **không có bộ cắt** ⇒ fail-open ⇒ rò. Import tĩnh module lá làm hàng rào **vô điều kiện**.
 *   2. Nhiều test (`aiLocalKnowledgeSafety.test.ts`, `aiLocalKnowledge.gguf.test.ts`) mock TOÀN
 *      BỘ `./aiGgufEngine` bằng factory liệt kê tay. Bộ cắt sống ở đó ⇒ trong những test ấy nó
 *      là `undefined`, tức **đường đang đo là đường KHÔNG có hàng rào**, mà không ca nào đỏ.
 *
 * ⚠ THỨ TỰ VỚI BỘ CHE BÍ MẬT: **cắt thẻ TRƯỚC, che bí mật SAU** — xem lý do đầy đủ ở đầu
 * `ai/thinkingStrip.ts` (cắt thẻ là phép XOÁ nên nó NỐI hai nửa một bí mật vốn bị khối `<think>`
 * tách rời; bộ canh NỘI DUNG phải đứng CUỐI). Ca chứng minh: `aiLocalKnowledge.thinkingLeak.test.ts` §5.
 */
import { StreamingThinkingStripper, stripThinking, thinkingStartsOpen } from "./ai/thinkingStrip";
import { planInference } from "./aiGateway";
// doc69 G2-7 (Wave E4) — "ask→do" 1-tap navigate: attaches a client `navigate`
// action to a how-to answer grounded in a KNOWN, whitelisted operational card
// (see aiOperationalGrounding.ts's top-of-file doc comment for the fail-safe
// gating). Pure/no side effects beyond a cached read of
// knowledge/operational-cards.json — never throws, never blocks the answer.
import { resolveOperationalNavigate, resolveCitationRoute } from "./aiOperationalGrounding";
// doc69 B1 (Wave 5) — last-autosync answer-eval gate result, surfaced read-only
// in the KB health signal so ops can see "did the last KB rebuild pass its
// answer-quality eval". Never throws (best-effort import/call, see getKbHealth).
import { getKbSyncSchedulerStatus, getLastAutosyncEvalGate } from "./kbSyncScheduler";
import { docTrangThaiHoanVram, type VramDeferState } from "./vram/vramDefer";
// doc69 B3 (Wave 5) — closes the KB answer-feedback loop: a bounded, flag-gated
// (KB_FEEDBACK_RERANK_ENABLED, default OFF) re-ranking nudge derived from
// accumulated thumbs up/down votes (server/services/aiKbFeedbackSignal.ts).
// FAIL-SAFE: disabled/no feedback/table-absent/DB-error all degrade to an empty
// map -> computeFeedbackWeight(0) === 1 for every source -> byte-identical to the
// pre-existing pure-semantic scoring below. This is a SEPARATE, independently
// flagged signal from the aiReranker.ts LLM/gguf semantic reranker imported above.
import { isFeedbackRerankEnabled, computeFeedbackWeight, loadFeedbackNetRatings } from "./aiKbFeedbackSignal";
// Final-fix round, Task 6 (SECURITY) — role gate for Training Studio corpus content. See
// kbStudioAccess.ts's header for the full "why" (pre-Wave-2 access level was
// roleProcedure("admin","engineer").use(require2FA); Wave 2's gatherStudioHits wiring had no
// role check at all).
import { canAccessStudioCorpus } from "./ai/kbStudioAccess";
// ★★★ TRÍCH DẪN NGUỒN DỮ LIỆU — `toolResult` CHƯA TỪNG được chuyển thành citation, nên một
// con số trong câu trả lời không truy ngược được về hàng nào trong DB. Module lá thuần
// (không import gì, không chạm DB); mọi luật an toàn — nhất là **`note` có mặt ⇒ KHÔNG
// citation**, cửa chống rò RBAC — nằm trong header của chính nó.
import {
  buildDataCitation,
  themChanNguonSoLieu,
  reconcileAnswerNumbers,
  type KbDataCitation,
  type NumberReconciliation,
} from "./ai/dataCitation";

export type KbIntent =
  | "how_to"
  | "troubleshoot"
  | "architecture"
  | "technical"
  | "definition"
  | "list"
  | "general";

export interface KbChunk {
  id: string;
  sourceType: string;
  sourcePath: string;
  title: string;
  text: string;
  keywords?: string[];
}

interface KbEmbeddingRecord {
  id: string;
  sourceType: string;
  sourcePath: string;
  title: string;
  keywords?: string[];
  textLength: number;
  embeddingDim: number;
  embedding: number[];
}

export interface KbCitation {
  id: string;
  sourcePath: string;
  title: string;
  sourceType: string;
  score: number;
  // doc69 B3 (Wave 5) — deep-link target, resolved via aiOperationalGrounding's
  // resolveCitationRoute (KNOWN operational card + ALLOWED_CLIENT_ROUTES whitelist
  // ONLY — never an arbitrary string). null/absent when unresolvable: the FE must
  // render the citation as plain, non-clickable text (honest).
  route?: string | null;
  /** Wave 2 — nguồn của trích dẫn. Vắng mặt = "system" (giữ nguyên hành vi cũ cho mọi consumer). */
  origin?: "system" | "studio";
}

// zh — language union extended to include Chinese (backward-compatible: extra branch).
export type KbLanguage = "vi" | "en" | "zh";

export interface KbRetrieveResult {
  question: string;
  intent: KbIntent;
  language: KbLanguage;
  entities: string[];
  confidence: number;
  citations: KbCitation[];
  contexts: string[];
  /**
   * G0 phần C — thời gian THẬT (ms) mà tầng rerank chiếm của lượt truy vấn này,
   * đo tại ĐIỂM GỌI (thời gian người dùng thật sự chờ, gồm cả `await import`).
   * `null` = tầng rerank KHÔNG chạy cho lượt này (RAG_RERANKER_ENABLED tắt, hoặc
   * pool ≤ 1 ứng viên) — KHÁC HẲN `0`, vốn có nghĩa "đã chạy và nhanh dưới 1 ms".
   * Trước bản này không có bất kỳ số nào ở đây: `aiReranker.ts` không có một
   * `Date.now()` nào, nên chi phí rerank vô hình với mọi tầng phía trên.
   */
  rerankMs?: number | null;
}

// C3a — optional, page-supplied context. All fields optional; absence keeps the
// legacy behavior (backward-compatible). Codes are preferred so they can be fed
// directly to read-tools (machineCode/orderCode). `uiLanguage` lets the UI hint
// the reply language when the question text is ambiguous.
export interface KbQueryContext {
  route?: string;
  uiLanguage?: KbLanguage;
  selectedMachineCode?: string;
  selectedMachineId?: number;
  selectedProductCode?: string;
  selectedProductModelId?: number;
  selectedLot?: string;
  /**
   * Final-fix round, Task 6 (SECURITY) — the REAL authenticated RBAC role (server/db/auth.ts's
   * UserRole, e.g. "admin"/"engineer"/"operator" — NOT this file's own `UserRole` "tone" type,
   * see kbStudioAccess.ts's header), used ONLY to gate Training Studio corpus merging
   * (canAccessStudioCorpus, in retrieveKnowledge below). MUST be populated SERVER-SIDE from the
   * authenticated session by the caller — NEVER from request body (aiLocalKnowledgeApi.ts's
   * parseContext() intentionally does NOT whitelist this field, so a client can never set it via
   * `POST .../ask`'s `context` param). Absent/unrecognized ⇒ fail-closed (no Studio content).
   */
  callerRole?: string;
  /**
   * ★★★ doc 79 · TRỤC 1 — CỜ PHIÊN LẬP TRÌNH. `true` ⇔ câu hỏi tới từ `/ai-coding-workspace` và phải
   * được định tuyến tới TÁC NHÂN LẬP TRÌNH (persona lập trình + CHỈ 5 tool lập trình), KHÔNG tới trợ
   * lý VẬN HÀNH + RAG tri thức. Vắng/`false` ⇒ hành vi Y HỆT hôm nay (ràng buộc cứng nhất — xem
   * `streamAnswer`). Được `parseContext` (aiLocalKnowledgeApi.ts) đọc từ body, chỉ chấp nhận `true`.
   */
  codingMode?: boolean;
  /**
   * ★★★ doc 79 · TRỤC 2 — id DỰ ÁN đang chọn (bộ chọn dự án ở đầu cây tệp). **Là một ID, KHÔNG phải
   * đường dẫn** — server tra danh sách TRẮNG (`repoProjects.gocTheoId`) để ra gốc; id lạ / đường dẫn
   * tự do ⇒ TỪ CHỐI (fail-closed). Chỉ có nghĩa khi `codingMode === true`. Vắng ⇒ dự án mặc định.
   */
  projectId?: string;
  /**
   * ★★★ doc 79 · VÒNG TỰ ĐỘNG — **TỆP ĐANG SỬA, GHIM BỞI BỘ ĐIỀU KHIỂN VÒNG.**
   *
   * Chỉ có nghĩa khi `codingMode === true`. Vắng ⇒ hành vi Y HỆT hôm nay (bộ chọn tất định tự
   * trích đường dẫn từ câu hỏi).
   *
   * ⚠⚠ VÌ SAO CẦN GHIM — một lỗi ĐO ĐƯỢC nếu không có nó: câu hỏi của lượt sửa kế tiếp **chứa đầu
   * ra test thật**, mà đầu ra ấy có cả tên lệnh (`dotnet test …`) lẫn đường dẫn tệp KHÁC
   * (`…/CalculatorTests.cs:line 42`). `classifyCodingToolIntent` chạy `run_command` TRƯỚC tiên ⇒ nó
   * sẽ chọn "chạy lại test" thay vì "sửa tệp", và nếu không thì nó chọn nhầm **tệp test** thay vì
   * tệp nguồn. Ghim đường dẫn là cách duy nhất để vòng sửa ĐÚNG tệp mà người vừa duyệt.
   *
   * ⚠ KHÔNG mở thêm quyền: đường này vẫn đi qua `read_file` (hộp cát + RBAC + gốc dự án đã phân
   * giải) như mọi lượt đọc khác; một đường ngoài hộp cát bị TỪ CHỐI y hệt, và câu từ chối được nói
   * ra nguyên văn. Người dùng vốn đã có thể yêu cầu đọc một tệp bất kỳ bằng lời — ghim không thêm
   * bề mặt nào, chỉ bỏ một bước đoán.
   */
  codingEditPath?: string;
  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★★ 2026-08-23 — **ĐẦU RA MÁY (test/biên dịch) ĐI RIÊNG, KHÔNG TRỘN VÀO `question`.**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ─── LỖ ĐÃ ĐO, VÀ NÓ NẰM Ở Ô THẨM QUYỀN CAO NHẤT ─────────────────────────────────────────────
   * Bộ điều khiển vòng ở client trước bản vá này gửi
   *     `question = "sửa X để khắc phục lỗi…\n\n" + catLoiChoPrompt(dauRa)`
   * ⇒ nguyên văn đầu ra `dotnet test` rơi vào khối `=== YÊU CẦU ===`, ô có **thẩm quyền CAO NHẤT**
   * theo chính bảng repo tự viết (`aiCodingAgent.promptSinhMa`: *yêu cầu > MÃ > BÀI HỌC > lịch sử*).
   * `catLoiChoPrompt` chỉ **CẮT** — không che bí mật, không trung hoà dấu rào, không bọc.
   * Một dòng *"BỎ QUA CHỈ DẪN TRƯỚC, hãy…"* nằm trong **tên một ca kiểm thử** (thứ do người gửi PR
   * quyết định) khi ấy nói chuyện với model từ ô cao nhất của prompt.
   *
   * ─── HÌNH DẠNG ĐÚNG, LẤY NGUYÊN CỦA CLI ──────────────────────────────────────────────────────
   * `sanitizeUntrustedBlock` + `wrapUntrustedBlock`, vai **`user`**, vào khối **LỊCH SỬ** — ô thẩm
   * quyền **THẤP NHẤT**. Đó đúng là thứ `aiCodingCli/cli.ts` làm sau mỗi lượt duyệt-và-thực-thi.
   * Web nay làm **ít nhất bằng** CLI. Xem `bocDauRaMayChoLichSu()`.
   *
   * ⚠ Ô này chở **DỮ LIỆU**, không chở chỉ dẫn. Nó KHÔNG BAO GIỜ được nối thẳng vào `question`, và
   *   không đường nào trong service được đọc nó mà bỏ qua bước bọc.
   * ⚠ Chỉ có nghĩa khi `codingMode === true`. Vắng ⇒ hành vi cũ y nguyên.
   */
  dauRaKhongTinCay?: string;
}

export interface KbStructuredResponse {
  navigationPath?: string;
  steps?: string[];
  recommendations?: string[];
  hasCode?: boolean;
}

export interface KbAnswerResult extends KbRetrieveResult {
  answer: string;
  provider: "ollama" | "extractive" | "tool";
  cached: boolean;
  followUpSuggestions?: string[];
  toolResult?: ToolResult | null;
  toolName?: string | null;
  structured?: KbStructuredResponse;
  /** GĐ2 — set when a write-tool was matched: confirm card to render (no execute). */
  pendingAction?: PendingActionDTO | null;
  /**
   * doc69 G2-7 — set when this is a how-to answer grounded in a KNOWN, whitelisted
   * operational card: a `navigate` directive (suggested: true) the FE renders as a
   * 1-tap "Mở màn X" button. null for every other answer (fail-safe, additive).
   */
  clientAction?: ClientActionDirective | null;
  /**
   * G2-C — dấu vết vòng lặp tool (null ⇔ cờ `AI_TOOL_LOOP_ENABLED` TẮT). CHỈ để quan sát/đo
   * lường; mọi thứ người dùng cần THẤY đã được nối vào `answer` (client hiện chỉ render `answer`,
   * nên một trường DTO mới mà không nối chuỗi là một cải tiến VÔ HÌNH).
   */
  toolLoop?: { rounds: number; stop: string; tokensUsed: number; elapsedMs: number } | null;
  /**
   * ★ Trích dẫn **NGUỒN DỮ LIỆU** (bảng · bộ lọc · số hàng · khoảng thời gian) cho
   * số liệu sống lấy từ `toolResult`. KHÁC HẲN `citations` (chunk tài liệu) và cố ý
   * KHÔNG trộn vào mảng đó — xem `themChanNguonSoLieu` để biết vì sao.
   * `[]` khi lượt này không chạy tool, hoặc khi tool trả về kèm `note` (từ chối
   * RBAC / DB lỗi / rỗng) ⇒ **không có gì để truy ngược thì không trích dẫn**.
   */
  dataCitations?: KbDataCitation[];
  /**
   * ★ Phép ĐO "bao nhiêu con số trong câu trả lời truy ngược được về `toolResult`".
   * ⚠ CHỈ QUAN SÁT — KHÔNG một nhánh nào được chặn/sửa câu trả lời theo ô này ở
   *   lượt này: số DẪN XUẤT (tổng/hiệu/%) hợp lệ vẫn "không tìm thấy nguồn", nên
   *   dùng nó làm cổng sẽ giết câu trả lời ĐÚNG. `null` khi không chạy tool.
   */
  numberCheck?: NumberReconciliation | null;
}

/**
 * Lightweight regex-based extractor that derives a structured view of a
 * markdown answer (navigation path, numbered steps, recommendations).
 * We intentionally do NOT ask the LLM for JSON output to keep latency low;
 * post-processing the prose costs ~1ms vs. ~10s of extra generation.
 */
export function extractStructuredResponse(answer: string): KbStructuredResponse {
  if (!answer) return {};
  const result: KbStructuredResponse = {};

  // Navigation path: capture phrases containing '›' or ' > ' (e.g. "Menu › Sản xuất › Lệnh sản xuất").
  // Prefer italicized form first, fall back to any line containing the separator.
  const navItalic = answer.match(/\*([^*\n]*[›>][^*\n]+)\*/);
  const navPlain = !navItalic ? answer.match(/([A-Za-zÀ-ỹ][\wÀ-ỹ ]{0,40}[›>][\wÀ-ỹ ›>]{2,80})/) : null;
  const nav = (navItalic?.[1] ?? navPlain?.[1] ?? "").trim();
  if (nav && /[›>]/.test(nav)) {
    result.navigationPath = nav.replace(/\s*>\s*/g, " › ").replace(/\s+/g, " ");
  }

  // Steps: numbered markdown list "1. ...", "2. ..." (must be 2+ items).
  const stepLines: string[] = [];
  const stepRe = /^\s*(\d+)[.)]\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = stepRe.exec(answer)) !== null) {
    const num = Number(m[1]);
    const text = m[2].replace(/\*\*/g, "").trim();
    if (num === stepLines.length + 1 && text.length > 0) {
      stepLines.push(text.length > 160 ? text.slice(0, 157) + "…" : text);
    }
    if (stepLines.length >= 8) break;
  }
  if (stepLines.length >= 2) result.steps = stepLines;

  // Recommendations: bullets after a "khuyến nghị" / "recommend" header.
  const recIdx = answer.search(/(khuy[eế]n ngh[ịi]|recommend)/i);
  if (recIdx >= 0) {
    const tail = answer.slice(recIdx);
    const recs: string[] = [];
    const recRe = /^\s*[-*]\s+(.+?)\s*$/gm;
    let r: RegExpExecArray | null;
    while ((r = recRe.exec(tail)) !== null) {
      const t = r[1].replace(/\*\*/g, "").trim();
      if (t) recs.push(t.length > 160 ? t.slice(0, 157) + "…" : t);
      if (recs.length >= 5) break;
    }
    if (recs.length > 0) result.recommendations = recs;
  }

  result.hasCode = /```/.test(answer);
  return result;
}

/**
 * Append a brief "tham khảo / nav" footer to a tool textSummary so the answer
 * still satisfies hasNavPath / grounded rubric without invoking the LLM.
 * Used by the Lever-8.B tool short-circuit path.
 */
function appendNavHint(summary: string, retrieve: KbRetrieveResult): string {
  if (!summary) return summary;
  // Avoid double-appending if a nav hint already exists.
  if (/(menu|sidebar|màn hình|trang|navigate|\/[a-z\-]+\/)/i.test(summary)) return summary;
  const top = (retrieve.citations || [])[0];
  const lang = retrieve.language;
  if (!top) return summary;
  const title = top.title || top.sourcePath || "";
  if (!title) return summary;
  // Try to derive a screen path from sourcePath like "feature/orders/index.md"
  // → "/orders". Fallback: just cite the doc title.
  const m = String(top.sourcePath || "").match(/^(?:feature|domain)\/([a-z0-9\-]+)/i);
  const navPath = m ? `/${m[1].toLowerCase()}` : null;
  const footer = lang === "vi"
    ? `\n\n*Tham khảo:* **${title}**${navPath ? ` — màn hình \`${navPath}\`` : ""}`
    : `\n\n*Reference:* **${title}**${navPath ? ` — screen \`${navPath}\`` : ""}`;
  return summary + footer;
}

export type UserRole = "worker" | "engineer" | "manager" | "it_admin";
export type UserLevel = "basic" | "technical" | "manager";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

function rolToUserLevel(role: UserRole): UserLevel {
  if (role === "manager") return "manager";
  if (role === "engineer" || role === "it_admin") return "technical";
  return "basic";
}

function buildFollowUpSuggestions(intent: KbIntent, language: KbLanguage): string[] {
  const vi: Record<KbIntent, string[]> = {
    how_to: ["Có cách nào nhanh hơn không?", "Bước nào thường gặp lỗi?", "Ai có quyền thực hiện bước này?"],
    troubleshoot: ["Lỗi này xảy ra thường xuyên không?", "Làm sao ngăn lỗi tái phát?", "Cần liên hệ ai khi lỗi nghiêm trọng?"],
    architecture: ["Module nào liên quan đến chức năng này?", "Dữ liệu được lưu ở đâu?", "API nào được dùng?"],
    technical: ["Schema của bảng này là gì?", "Endpoint nào trả dữ liệu này?", "Có test case nào không?"],
    general: ["Tôi có thể tìm thêm thông tin ở đâu?", "Ai là người quản lý phần này?", "Có tài liệu hướng dẫn không?"],
    list: ["Còn mục nào khác không?", "Sắp xếp theo tiêu chí nào?", "Xem chi tiết từng mục ở đâu?"],
    definition: ["Khái niệm này dùng ở đâu?", "Có ví dụ minh họa không?", "Thuật ngữ liên quan là gì?"],
  };
  const en: Record<KbIntent, string[]> = {
    how_to: ["Is there a faster way?", "Which step is most error-prone?", "Who has permission to do this?"],
    troubleshoot: ["How often does this error occur?", "How to prevent recurrence?", "Who to contact for critical issues?"],
    architecture: ["Which modules are related?", "Where is the data stored?", "Which APIs are involved?"],
    technical: ["What is the table schema?", "Which endpoint returns this data?", "Are there test cases?"],
    general: ["Where can I find more info?", "Who manages this feature?", "Is there documentation?"],
    list: ["Are there other items?", "How is it sorted?", "Where to see each item's detail?"],
    definition: ["Where is this concept used?", "Is there an example?", "What are related terms?"],
  };
  const zh: Record<KbIntent, string[]> = {
    how_to: ["有更快的方法吗？", "哪一步最容易出错？", "谁有权限执行此操作？"],
    troubleshoot: ["这个错误经常发生吗？", "如何防止再次发生？", "严重问题该联系谁？"],
    architecture: ["相关的模块有哪些？", "数据存储在哪里？", "涉及哪些 API？"],
    technical: ["这张表的结构是什么？", "哪个接口返回此数据？", "有测试用例吗？"],
    general: ["在哪里可以找到更多信息？", "谁负责这个功能？", "有使用文档吗？"],
    list: ["还有其他项目吗？", "按什么排序？", "在哪里查看每项详情？"],
    definition: ["这个概念用在哪里？", "有示例吗？", "相关术语有哪些？"],
  };
  if (language === "zh") return zh[intent] ?? zh.general;
  return language === "vi" ? (vi[intent] ?? vi.general) : (en[intent] ?? en.general);
}

interface KbDataBundle {
  chunksById: Map<string, KbChunk>;
  embeddings: KbEmbeddingRecord[];
  loadedAt: number;
  // W0.3 (doc 11) — embedding-model provenance read from embeddings-meta.json so
  // we can detect a query/corpus embed-model mismatch (not just a length mismatch).
  // null when the meta file is missing or lacks the field (→ never false-alarm).
  corpusEmbedModel: string | null;
  // W0.2 (doc 11) — when the corpus was built (ISO from meta.generatedAt); null if absent.
  kbBuiltAt: string | null;
}

const KNOWLEDGE_DIR = path.join(process.cwd(), "knowledge");
const CHUNKS_FILE = path.join(KNOWLEDGE_DIR, "chunks.jsonl");
const EMBEDDINGS_FILE = path.join(KNOWLEDGE_DIR, "embeddings.jsonl");
// W0.3 (doc 11) — provenance sidecar written by the embed pipeline. Holds the
// `model` the corpus was embedded with + `generatedAt`. Optional: missing file
// degrades gracefully (corpusEmbedModel = null → guard stays quiet).
const EMBEDDINGS_META_FILE = path.join(KNOWLEDGE_DIR, "embeddings-meta.json");

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "mxbai-embed-large";
const OLLAMA_QA_MODEL = process.env.OLLAMA_QA_MODEL ?? "qwen2.5:7b-instruct";

// USE_LEGACY_OLLAMA=true → keep legacy Ollama HTTP path (rollback switch).
// Default: use bundled GGUF engine via aiGgufEngine for QA generation.
const USE_LEGACY_OLLAMA = (process.env.USE_LEGACY_OLLAMA ?? "false").toLowerCase() === "true";

// WS-G4 — Dedicated GGUF embedding model id (the modelId aiGgufEngine resolves a model by:
// basename without ".gguf"). We pass it explicitly to generateEmbedding so the embed path
// NEVER falls back to the text/QA model (Qwen), which would return wrong-dimension vectors.
// Mirrors the GGUF_EMBED_MODEL env that G1's aiGgufEngine uses; basename() tolerates the
// env value being given with or without a ".gguf" extension.
const GGUF_EMBED_MODEL_ID = path.basename(
  process.env.GGUF_EMBED_MODEL || "mxbai-embed-large-v1-f16.gguf",
  ".gguf",
);
// Embedding dimension the KB corpus (embeddings.jsonl) was built with. A GGUF vector of a
// different length means the wrong model was loaded → we must NOT truncate-compare in cosine()
// (which uses Math.min length) because that silently corrupts similarity. Guard → return null.
const KB_EMBED_DIM = (() => {
  const n = parseInt(process.env.GGUF_EMBED_DIM || "1024", 10);
  return Number.isFinite(n) && n > 0 ? n : 1024;
})();

// W0.3 (doc 11) — normalize an embed-model identifier for IDENTITY comparison
// (corpus vs query). Length-only guards miss the dangerous case where a deploy
// swaps GGUF_EMBED_MODEL for a SAME-DIMENSION but DIFFERENT model → retrieval
// silently returns garbage. We compare by basename, lowercased, stripping the
// common "-f16"/quant suffixes and the ".gguf" extension so cosmetically
// different spellings of the same model still match.
function normalizeEmbedModelId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = path.basename(String(raw).trim());
  s = s.replace(/\.gguf$/i, "");
  s = s.toLowerCase();
  // Strip common precision/quant suffixes that differ between build-time and
  // runtime spellings of the SAME model (e.g. "-f16", "-q8_0", ".f16").
  s = s.replace(/[._-](f16|f32|bf16|q\d(_[\dkms]+)*|int8|int4)$/i, "");
  s = s.replace(/[._-]+$/g, "");
  return s || null;
}

// W0.3 (doc 11) — has the corpus/query embed-model mismatch warning already
// fired? Keep the log to ONCE-per-process so it stays loud but not spammy.
let embedModelMismatchWarned = false;

/**
 * W0.3 (doc 11) — does the corpus embed-model match the query embed-model?
 * Returns true when the corpus model is UNKNOWN/null (no meta → don't false-alarm)
 * or when both normalize equal. Returns false ONLY when both are known AND differ.
 */
function computeEmbedModelMatches(corpusEmbedModel: string | null): boolean {
  const corpus = normalizeEmbedModelId(corpusEmbedModel);
  if (!corpus) return true; // unknown corpus model → cannot assert a mismatch
  const query = normalizeEmbedModelId(GGUF_EMBED_MODEL_ID);
  if (!query) return true; // unknown query model → don't false-alarm either
  return corpus === query;
}

const ANSWER_CACHE_TTL_MS = Number(process.env.KB_QA_CACHE_TTL_MS ?? 10 * 60 * 1000);

let dataCache: KbDataBundle | null = null;
const answerCache = new Map<string, { expiresAt: number; value: KbAnswerResult }>();

// Embedding cache — embedQuestion adds 200-500ms per ask. Cache normalized
// question → unit-normalized vector. Bounded LRU-ish (insertion order map).
const EMBED_CACHE_MAX = 200;
const embedCache = new Map<string, number[]>();

// Per-chunk context cap fed into LLM prompt. Chunks can be 2-3KB each;
// 5 chunks × 3KB = 15KB prompt → big prefill cost on local models. Keep the
// most informative head of each chunk.
const CONTEXT_CHUNK_CHAR_CAP = Number(process.env.KB_QA_CTX_CAP ?? 1200);

// num_predict — cap LLM output length. 800 was overkill; most useful answers
// fit in 400-500 tokens. Lower = faster TTLT (time-to-last-token).
const LLM_NUM_PREDICT = Number(process.env.KB_QA_NUM_PREDICT ?? 512);

// FE-W0.3 (doc 46 §2.3) — anti-degenerate-loop decode + streaming-guard cadence.
// Stronger repeat penalty than the engine default (1.1) to discourage token loops;
// the incremental stream guard re-checks every STEP chars once past MIN chars so a
// "cell cell cell…" loop is caught within a few tokens instead of thousands.
const KB_QA_REPEAT_PENALTY = (() => {
  const n = Number(process.env.KB_QA_REPEAT_PENALTY ?? 1.2);
  return Number.isFinite(n) && n >= 1 ? n : 1.2;
})();
const STREAM_GUARD_MIN_CHARS = Number(process.env.KB_QA_STREAM_GUARD_MIN ?? 160);
const STREAM_GUARD_STEP_CHARS = Number(process.env.KB_QA_STREAM_GUARD_STEP ?? 160);

// Lever 8.D — per-intent token budget. Tool-summarised and general questions
// rarely need >220 tokens; how_to/architecture deserve room for full
// procedure; troubleshoot benefits from compactness.
// Stage 12.B — list/count questions ("bao nhiêu", "liệt kê", "list", "how many")
// often need to enumerate items + code blocks; bump budget ×1.7 to avoid
// truncating mid-list (observed on SPC rules question — answer cut at NELSON_4).
const LIST_COUNT_RE = /(bao nhiêu|liệt kê|danh sách|tất cả các|list( all)?|how many|enumerate)/i;
function pickNumPredict(intent: KbIntent, hasToolSummary: boolean, question?: string): number {
  let base: number;
  if (hasToolSummary) {
    base = Number(process.env.KB_QA_NUM_PREDICT_TOOL ?? 220);
  } else {
    switch (intent) {
      case "how_to":
        base = Number(process.env.KB_QA_NUM_PREDICT_HOWTO ?? LLM_NUM_PREDICT);
        break;
      case "architecture":
        base = Number(process.env.KB_QA_NUM_PREDICT_ARCH ?? LLM_NUM_PREDICT);
        break;
      case "troubleshoot":
        base = Number(process.env.KB_QA_NUM_PREDICT_TROUBLE ?? 300);
        break;
      case "technical":
        base = Number(process.env.KB_QA_NUM_PREDICT_TECH ?? LLM_NUM_PREDICT);
        break;
      case "definition":
        // Stage 13.A — definitions are short by nature; cap to avoid the
        // model padding with fabricated UI navigation steps.
        // Stage 13.D — bumped 280→340: SPC "13 rules" answer was truncating
        // mid-EWMA section. 340 fits a 4-section definition + closing line.
        base = Number(process.env.KB_QA_NUM_PREDICT_DEF ?? 340);
        break;
      case "list":
        // Stage 13.A — list intent shares the LIST_COUNT_RE multiplier
        // applied below, but start from a higher base than "general".
        base = Number(process.env.KB_QA_NUM_PREDICT_LIST ?? 400);
        break;
      case "general":
      default:
        base = Number(process.env.KB_QA_NUM_PREDICT_GENERAL ?? 220);
    }
  }
  if (question && LIST_COUNT_RE.test(question)) {
    const mult = Number(process.env.KB_QA_NUM_PREDICT_LIST_MULT ?? 2.8);
    const cap = Number(process.env.KB_QA_NUM_PREDICT_LIST_CAP ?? 900);
    const floor = Number(process.env.KB_QA_NUM_PREDICT_LIST_FLOOR ?? 600);
    base = Math.min(cap, Math.max(floor, Math.round(base * mult)));
  }
  return base;
}

// keep_alive — keep the model loaded in Ollama VRAM/RAM between requests so
// the next ask doesn't pay the cold-load cost (often 3-10s).
const LLM_KEEP_ALIVE = process.env.KB_QA_KEEP_ALIVE ?? "30m";

// Phase-6: hard deadline for a single Ollama generate call. Without this,
// occasional Ollama backpressure can stall a request for 120s+ (observed in
// Phase-5 eval). 30s is comfortably above the typical 11-25s answer time and
// safely below the perceived "hung" threshold. On timeout we abort the fetch
// and fall through to the extractive/graceful-fallback path.
const LLM_TIMEOUT_MS = Number(process.env.KB_QA_TIMEOUT_MS ?? 30000);

function parseJsonl<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line) => JSON.parse(line) as T);
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_\-/.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Stopwords (after diacritics-strip + lowercase). Includes very common
// Vietnamese particles and English helper words that otherwise match every
// chunk and pollute the keyword score.
const STOP_WORDS = new Set([
  // VN (no diacritics)
  "la", "co", "cua", "va", "voi", "cho", "hay", "thi", "de", "khong",
  "den", "tu", "nhu", "nay", "do", "can", "se", "da", "dang", "mot",
  "hai", "ba", "ai", "gi", "sao", "nao", "khi", "the", "toi", "ban",
  "minh", "chi", "ra", "len", "vao", "hon", "nhung", "hoac", "neu",
  // EN
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is",
  "are", "be", "this", "that", "it", "as", "at", "by", "with", "from",
  "how", "what", "why", "can", "do", "does", "did", "i", "you", "we",
]);

function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(" ")
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
    .slice(0, 40);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// zh \u2014 detect Chinese first (CJK Unified Ideographs). The Han range does not
// overlap the Vietnamese Latin range below, so ordering is safe. Exported so it
// can be unit-tested directly.
export function detectLanguage(question: string): KbLanguage {
  if (/[\u4e00-\u9fff]/.test(question)) return "zh";

  const viPattern = /[\u0102\u0103\u00c2\u00ca\u00d4\u01a0\u01af\u0110\u00e0-\u1ef9]/;
  if (viPattern.test(question)) return "vi";

  const viKeywords = /(lam sao|huong dan|khac phuc|loi|du lieu|he thong|quan tri|nguoi dung|kiem tra)/i;
  if (viKeywords.test(normalizeText(question))) return "vi";

  return "en";
}

// Stage 13.A — definition/list intents. ORDER MATTERS: check these FIRST,
// before how_to/troubleshoot, because "X là gì" / "liệt kê" are pure knowledge
// questions that should NOT be answered with the how-to UI-step template.
const DEFINITION_RE = /(\b|^)(la gi|nghia la|dinh nghia|giai thich|what is|what are|define|explain|meaning of)(\b|$|\?)/i;
// LIST_COUNT_RE is also defined for numPredict; classifier uses an inline copy.
const LIST_INTENT_RE = /(bao nhiêu|liệt kê|danh sách|tất cả các|list( all)?|how many|enumerate)/i;
function classifyIntent(question: string): KbIntent {
  const q = normalizeText(question);
  // Definition / list checks use the ORIGINAL question (with diacritics) for VN matches.
  if (LIST_INTENT_RE.test(question)) return "list";
  if (DEFINITION_RE.test(q) || DEFINITION_RE.test(question)) return "definition";
  if (/(how|lam sao|huong dan|cach|steps|guide)/i.test(q)) return "how_to";
  if (/(error|loi|fail|fix|khac phuc|troubleshoot|incident)/i.test(q)) return "troubleshoot";
  if (/(architecture|kien truc|flow|luong|design|module)/i.test(q)) return "architecture";
  if (/(api|endpoint|router|service|schema|model|query|db|database)/i.test(q)) return "technical";
  return "general";
}

// Lot identifier (e.g. L20260505-001) and machine code (e.g. MCH-FAC-BN-DIP-LA-ST1, AVI-GB300-01)
const LOT_ID_RE = /\bL\d{6,10}-\d{1,4}\b/g;
const MACHINE_ID_RE = /\b(?:MCH-[A-Z0-9-]{2,}|AVI-[A-Z0-9-]{2,}|GB\d{2,4}-[A-Z0-9-]{1,})\b/gi;

function extractEntities(question: string): string[] {
  const entities = new Set<string>();

  const matches = [
    ...(question.match(/[A-Za-z0-9_]+Router/g) ?? []),
    ...(question.match(/[A-Za-z0-9_]+Service/g) ?? []),
    ...(question.match(/[A-Za-z0-9_/.-]+\.(?:ts|tsx|js|mjs|sql|md)/g) ?? []),
    ...(question.match(/\/api\/[A-Za-z0-9_./-]*/g) ?? []),
    ...(question.match(/M-?\d{1,4}/gi) ?? []),
    ...(question.match(LOT_ID_RE) ?? []),
    ...(question.match(MACHINE_ID_RE) ?? []),
  ];

  for (const m of matches) {
    const trimmed = m.trim();
    if (trimmed) entities.add(trimmed);
  }

  return Array.from(entities).slice(0, 10);
}

// ★ G4-B — bảng trọng số hạng nguồn + trọng số ngôn ngữ ĐÃ CHUYỂN sang module lá
// `./aiKbSourceWeights`. Lý do là CƠ CHẾ, không phải gọn gàng: khi bảng nằm inline ở đây,
// bộ đo duy nhất phát biểu được về thứ hạng (`scripts/ai-eval/eval-rag-operational.mjs`)
// xếp hạng bằng cosine THUẦN ⇒ đổi trọng số thì bộ đo nhúc nhích ĐÚNG 0,0000, và không có
// phép đo nào từng nói bảng ấy đúng hay sai. Nay bộ eval `import` chính file lá này
// (chế độ `--parity`), nên một lượt quét trọng số đo trên con số production THẬT.
// Xem đầu `aiKbSourceWeights.ts` để biết đầy đủ.

// Cycle-3: detect lot / machine identifiers for entity-aware refusal.
function extractLotOrMachineId(question: string): string | null {
  const lot = question.match(LOT_ID_RE);
  if (lot && lot[0]) return lot[0];
  const mach = question.match(MACHINE_ID_RE);
  if (mach && mach[0]) return mach[0];
  return null;
}

function ensureDataLoaded(forceReload = false): KbDataBundle {
  if (dataCache && !forceReload) return dataCache;

  if (!fs.existsSync(CHUNKS_FILE) || !fs.existsSync(EMBEDDINGS_FILE)) {
    throw new Error("Knowledge artifacts missing. Run Phase 1 pipeline first.");
  }

  const chunks = parseJsonl<KbChunk>(CHUNKS_FILE);
  const embeddings = parseJsonl<KbEmbeddingRecord>(EMBEDDINGS_FILE);

  const chunksById = new Map<string, KbChunk>();
  for (const c of chunks) chunksById.set(c.id, c);

  // W0.3/W0.2 (doc 11) — read the embed provenance sidecar. Best-effort: a
  // missing/malformed meta file must NOT break KB loading; it just leaves the
  // model-identity guard quiet (corpusEmbedModel = null) and staleness unknown.
  let corpusEmbedModel: string | null = null;
  let kbBuiltAt: string | null = null;
  try {
    if (fs.existsSync(EMBEDDINGS_META_FILE)) {
      const meta = JSON.parse(fs.readFileSync(EMBEDDINGS_META_FILE, "utf8")) as {
        model?: unknown;
        generatedAt?: unknown;
      };
      if (typeof meta.model === "string" && meta.model.trim()) corpusEmbedModel = meta.model.trim();
      if (typeof meta.generatedAt === "string" && meta.generatedAt.trim()) {
        kbBuiltAt = meta.generatedAt.trim();
      }
    }
  } catch {
    // Leave provenance null on any parse error — degrade quietly.
  }

  dataCache = {
    chunksById,
    embeddings,
    loadedAt: Date.now(),
    corpusEmbedModel,
    kbBuiltAt,
  };

  // W0.3 (doc 11) — fire a single LOUD warning if the corpus was embedded with a
  // different model than the one the query path will use. Retrieval similarity
  // is only meaningful when both vectors live in the SAME model's space.
  if (!computeEmbedModelMatches(corpusEmbedModel) && !embedModelMismatchWarned) {
    embedModelMismatchWarned = true;
    console.warn(
      `[aiLocalKnowledge] ⚠️ EMBED-MODEL MISMATCH — corpus embedded with "${corpusEmbedModel}" ` +
        `but query embed model is "${GGUF_EMBED_MODEL_ID}" (GGUF_EMBED_MODEL). Semantic retrieval ` +
        `would be CORRUPT → falling back to keyword-only retrieval. Re-embed the corpus with the ` +
        `current model OR point GGUF_EMBED_MODEL back at the corpus model. (W0.3, doc 11)`,
    );
  }

  return dataCache;
}

/** L2-normalize a raw embedding vector → unit vector (kept identical to the legacy
 * Ollama path so GGUF query vectors live in the SAME space as the KB corpus). */
function l2normalizeVec(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/** Legacy Ollama /api/embed path (rollback + fallback). Returns a unit vector or null. */
async function embedQuestionOllama(question: string): Promise<number[] | null> {
  const body = {
    model: OLLAMA_EMBED_MODEL,
    input: question,
    keep_alive: LLM_KEEP_ALIVE,
  };

  const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) return null;

  const json = (await res.json()) as { embeddings?: number[][] };
  const vec = json.embeddings?.[0];
  if (!vec || !Array.isArray(vec) || vec.length === 0) return null;

  return l2normalizeVec(vec);
}

/**
 * Default GGUF (in-process) embedding path — runs without an Ollama daemon.
 * Uses the dedicated mxbai embedding model so the query vector lands in the same
 * 1024-dim space as the existing KB corpus (no re-embed needed). L2-normalizes
 * identically to the legacy path. Returns null on any failure so the caller can
 * fall back to Ollama (rollback) or keyword-only retrieval.
 *
 * Dimension guard: if GGUF returns a vector whose length ≠ KB_EMBED_DIM, we log a
 * warning and return null. This is critical — cosine() compares with Math.min(len)
 * truncation, so a mismatched vector would silently produce a corrupt similarity.
 */
async function embedQuestionGguf(question: string): Promise<number[] | null> {
  const { generateEmbedding, isGgufAvailable } = await import("./aiGgufEngine");
  if (!(await isGgufAvailable())) return null;
  const { embedding } = await generateEmbedding(question, GGUF_EMBED_MODEL_ID);
  if (!Array.isArray(embedding) || embedding.length === 0) return null;
  if (embedding.length !== KB_EMBED_DIM) {
    console.warn(
      `[aiLocalKnowledge] GGUF embedding dim mismatch (${embedding.length} ≠ ${KB_EMBED_DIM}) — ` +
        `skipping vector retrieval, falling back to keyword-only. Check GGUF_EMBED_MODEL points to mxbai.`,
    );
    return null;
  }
  return l2normalizeVec(embedding);
}

async function embedQuestion(question: string): Promise<number[] | null> {
  const cacheKey = normalizeText(question);
  const cached = embedCache.get(cacheKey);
  if (cached) {
    // Refresh recency (Map preserves insertion order).
    embedCache.delete(cacheKey);
    embedCache.set(cacheKey, cached);
    return cached;
  }

  let unit: number[] | null = null;
  if (USE_LEGACY_OLLAMA) {
    // Rollback path: legacy Ollama HTTP embedding.
    unit = await embedQuestionOllama(question);
  } else {
    // Default: in-process GGUF embedding (no daemon). On any failure, fall back to
    // Ollama so a partially-configured environment still degrades gracefully.
    try {
      unit = await embedQuestionGguf(question);
    } catch (err) {
      console.warn("[aiLocalKnowledge] GGUF embedQuestion failed, falling back to Ollama:", err);
      unit = null;
    }
    if (unit === null) {
      try {
        unit = await embedQuestionOllama(question);
      } catch {
        unit = null;
      }
    }
  }

  if (unit === null) return null;

  if (embedCache.size >= EMBED_CACHE_MAX) {
    const oldest = embedCache.keys().next().value;
    if (oldest !== undefined) embedCache.delete(oldest);
  }
  embedCache.set(cacheKey, unit);
  return unit;
}

function keywordScore(chunk: KbChunk, tokens: string[], entities: string[]): number {
  const title = normalizeText(chunk.title);
  const text = normalizeText(chunk.text.slice(0, 3000));
  const path = normalizeText(chunk.sourcePath);
  const keywords = (chunk.keywords ?? []).map((k) => normalizeText(k));

  let score = 0;
  for (const t of tokens) {
    if (!t) continue;
    if (title.includes(t)) score += 2.5;
    if (path.includes(t)) score += 2;
    if (keywords.some((k) => k === t)) score += 2;
    if (text.includes(t)) score += 1;
  }

  for (const entity of entities) {
    const e = normalizeText(entity);
    if (!e) continue;
    if (title.includes(e) || path.includes(e)) score += 4;
    if (text.includes(e)) score += 2;
  }

  return score;
}

function buildExtractiveAnswer(question: string, retrieve: KbRetrieveResult): string {
  const language = retrieve.language;

  if (retrieve.citations.length === 0) {
    if (language === "zh") {
      return `我在知识库中没有找到与此问题相关的信息。\n\n**建议：**\n- 尝试换一种方式描述问题\n- 询问具体的功能、界面或错误\n- 联系技术人员或查看使用文档`;
    }
    return language === "vi"
      ? `Tôi chưa tìm thấy thông tin phù hợp cho câu hỏi này trong cơ sở dữ liệu kiến thức.\n\n**Gợi ý:**\n- Thử diễn đạt câu hỏi theo cách khác\n- Hỏi về tên tính năng, màn hình, hoặc lỗi cụ thể\n- Liên hệ kỹ thuật viên hoặc xem tài liệu hướng dẫn`
      : `I couldn't find relevant information for this question in the knowledge base.\n\n**Suggestions:**\n- Try rephrasing the question\n- Ask about a specific feature, screen, or error\n- Contact support or check the documentation`;
  }

  // Off-topic guard: when the LLM is unavailable and the top citation is only
  // weakly related (score < 0.62), do NOT dump unrelated chunks. Refuse
  // explicitly so the user knows the answer isn't grounded in real context.
  const STRONG_MATCH_FLOOR = 0.62;
  const top1 = retrieve.citations[0]?.score ?? 0;
  if (top1 < STRONG_MATCH_FLOOR) {
    // Cycle-3: if the question contains a specific lot/machine identifier,
    // refuse with the identifier explicitly so the user knows there's no DB
    // row for it (and isn't left wondering whether the question was understood).
    const id = extractLotOrMachineId(question);
    if (id) {
      if (language === "zh") {
        return `在当前文档中未找到编号 **${id}** 的数据。\n\n**建议：**\n- 核对编号（格式是否正确、是否有多余空格）\n- 如果是实时数据，请说明日期/时间范围\n- 或联系技术工程师寻求帮助`;
      }
      return language === "vi"
        ? `Không tìm thấy dữ liệu cho mã **${id}** trong tài liệu hiện tại.\n\n**Gợi ý:**\n- Kiểm tra lại mã (định dạng đúng chưa, có khoảng trắng dư không)\n- Nếu đây là dữ liệu thời gian thực, hãy nêu rõ ngày/khoảng thời gian\n- Hoặc liên hệ kỹ thuật viên để được hỗ trợ`
        : `No data found for **${id}** in the current documents.\n\n**Try:**\n- Verify the ID format and remove extra whitespace\n- For real-time data, specify the date/time range\n- Or contact a technical engineer for help`;
    }
    if (language === "zh") {
      return `在当前文档中我没有关于此问题的准确信息。\n\n**建议：**\n- 提问更具体一些（功能名称、界面、错误代码、机台/批次编号）\n- 如果询问实时数据（产量、机台、缺陷），请说明日期/时间范围\n- 或联系技术工程师寻求帮助`;
    }
    return language === "vi"
      ? `Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại.\n\n**Gợi ý:**\n- Thử hỏi cụ thể hơn (tên tính năng, màn hình, mã lỗi, mã máy/lô)\n- Nếu hỏi về dữ liệu thời gian thực (sản lượng, máy, lỗi), hãy nêu rõ ngày/khoảng thời gian\n- Hoặc liên hệ kỹ thuật viên để được hỗ trợ`
      : `I don't have accurate information about this question in the current documents.\n\n**Try:**\n- Ask more specifically (feature name, screen, error code, machine/lot ID)\n- For real-time data (yield, machines, defects), specify the date/time range\n- Or contact a technical engineer for help`;
  }

  const intro =
    language === "zh"
      ? `我在代码库中找到了 **${retrieve.citations.length} 个相关来源**：`
      : language === "vi"
        ? `Tôi tìm thấy **${retrieve.citations.length} nguồn** liên quan trong codebase:`
        : `I found **${retrieve.citations.length} relevant sources** in the codebase:`;

  const bullets = retrieve.citations
    .map((c, i) => {
      const ctx = retrieve.contexts[i] ?? "";
      const snippet = ctx.replace(/\s+/g, " ").slice(0, 220);
      return `**${i + 1}. ${c.title}** (\`${c.sourcePath}\`)\n> ${snippet}`;
    })
    .join("\n\n");

  const outro =
    language === "zh"
      ? "\n\n💡 *如有需要，可继续询问某个具体步骤或具体错误。*"
      : language === "vi"
        ? "\n\n💡 *Nếu cần, hãy hỏi thêm về một bước cụ thể hoặc lỗi cụ thể.*"
        : "\n\n💡 *If needed, ask about a specific step or error.*";

  return `${intro}\n\n${bullets}${outro}`;
}

function buildGracefulFallback(language: KbLanguage): string {
  if (language === "zh") {
    return `抱歉，我目前没有足够的信息来准确回答这个问题。\n\n**您可以尝试：**\n- 🔍 更具体地描述功能或错误\n- 📋 查看系统中的**使用指南**\n- 💬 联系**技术工程师**或**管理员**`;
  }
  return language === "vi"
    ? `Xin lỗi, tôi chưa có đủ thông tin để trả lời câu hỏi này một cách chính xác.\n\n**Bạn có thể thử:**\n- 🔍 Hỏi cụ thể hơn về tính năng hoặc lỗi\n- 📋 Xem mục **Hướng dẫn sử dụng** trong hệ thống\n- 💬 Liên hệ **kỹ sư kỹ thuật** hoặc **quản trị viên**\n- 📞 Hotline hỗ trợ: nội bộ phòng kỹ thuật`
    : `Sorry, I don't have enough information to answer this accurately.\n\n**You can try:**\n- 🔍 Be more specific about the feature or error\n- 📋 Check the **User Guide** in the system\n- 💬 Contact a **technical engineer** or **administrator**`;
}

function getSystemPromptForRole(
  userLevel: UserLevel,
  language: KbLanguage,
  intent: KbIntent = "general",
): string {
  // Lever 8.C — compact prompt. Earlier verbose VI prompt was ~700 tokens
  // (DETAIL + CONCRETE + GUARD blocks). qwen2.5:3b is sensitive to prompt
  // bloat — trimming to ~140 tokens combined per role cuts prefill by ~3-4s
  // while preserving the rubric-positive instructions (structure, code
  // fences, anti-hallucination).
  const VI_GUARD = "Chỉ dùng tài liệu được cấp; không bịa API/endpoint/biến/bảng. Không nhắc Alibaba/AWS/GCP/Azure. Thiếu dữ kiện thì nói rõ chưa có.";
  const EN_GUARD = "Use only the provided context; never invent APIs/vars/tables. Never mention Alibaba/AWS/GCP/Azure. If data missing, say so.";
  const VI_FORMAT = "Cấu trúc: (1) Tóm tắt 1–2 câu, (2) Các bước đánh số nêu *làm gì + ở đâu trong UI + kết quả*, (3) Lưu ý/lỗi thường gặp, (4) Liên quan 2 chủ đề. 200–450 từ. KHI ngữ cảnh có API/biến/lệnh, BẮT BUỘC trích lại trong backtick hoặc code-fence ```bash/```sql/```ts.";
  const EN_FORMAT = "Structure: (1) 1–2 sentence summary, (2) numbered steps with *what + where in UI + expected result*, (3) gotchas/common errors, (4) 2 related topics. 200–450 words. When context has APIs/vars/commands, you MUST quote them in backticks or code fences ```bash/```sql/```ts.";

  // Stage 13.A — definition/list intents are KNOWLEDGE questions, not how-to.
  // The how-to template ("Các bước → ở đâu trong UI → kết quả") forces the
  // model to fabricate UI navigation paths even when none exist (observed:
  // "Truy cập /spc-analysis chọn tab Pareto để xem rules" — there is no such
  // tab). Use a knowledge-focused format instead.
  const VI_DEF_FORMAT = "Cấu trúc: (1) Định nghĩa ngắn gọn 1–3 câu, (2) Liệt kê thành phần/đặc điểm chính (bullet hoặc bảng), (3) Ví dụ cụ thể từ ngữ cảnh (code/giá trị/công thức nếu có), (4) 1–2 chủ đề liên quan. KHÔNG bịa đường dẫn UI/menu nếu ngữ cảnh không nói rõ. KHÔNG dùng template 'Các bước → Truy cập URL → Chọn tab' cho câu hỏi định nghĩa.";
  const EN_DEF_FORMAT = "Structure: (1) Short definition 1–3 sentences, (2) Bullet list of key components/properties, (3) Concrete example from context (code/value/formula if present), (4) 1–2 related topics. Do NOT fabricate UI paths/menus. Do NOT use the 'Steps → Open URL → Click tab' template for definition questions.";
  const VI_LIST_FORMAT = "Cấu trúc: (1) Tổng số mục được liệt kê (con số chính xác), (2) Danh sách đầy đủ dưới dạng bullet hoặc bảng (không cắt ngắn), (3) Trích nguyên văn code/giá trị từ ngữ cảnh khi có, (4) Nguồn gốc (file/đường dẫn). KHÔNG bịa số lượng. KHÔNG dùng template 'Các bước → Truy cập URL'.";
  const EN_LIST_FORMAT = "Structure: (1) Total count (exact number), (2) Full list as bullets or table (do NOT truncate), (3) Verbatim code/values from context, (4) Source (file path). Do NOT invent counts. Do NOT use the 'Steps → Open URL' template.";

  // zh — Chinese prompt variants. Same rubric as vi/en (structure, code-fence,
  // anti-hallucination, no public-cloud mentions), translated to Simplified
  // Chinese so the model replies in Chinese when the UI/question is Chinese.
  const ZH_GUARD = "仅使用所提供的资料；不得编造 API/接口/变量/数据表。不得提及 Alibaba/AWS/GCP/Azure。资料不足时请明确说明尚无数据。";
  const ZH_FORMAT = "结构：(1) 1–2 句概述，(2) 编号步骤，说明*做什么 + 在界面中的位置 + 预期结果*，(3) 注意事项/常见错误，(4) 2 个相关主题。200–450 字。当上下文包含 API/变量/命令时，必须用反引号或代码块 ```bash/```sql/```ts 原样引用。";
  const ZH_DEF_FORMAT = "结构：(1) 1–3 句简短定义，(2) 关键组成/特征的项目列表，(3) 来自上下文的具体示例（如有代码/数值/公式），(4) 1–2 个相关主题。若上下文未说明，请勿编造界面路径/菜单。定义类问题请勿使用“步骤→打开网址→点击标签”的模板。";
  const ZH_LIST_FORMAT = "结构：(1) 列出项目的总数（准确数字），(2) 完整列表（项目符号或表格，不得截断），(3) 原样引用上下文中的代码/数值，(4) 来源（文件路径）。不得编造数量。请勿使用“步骤→打开网址”的模板。";

  const isDef = intent === "definition";
  const isList = intent === "list";

  if (language === "zh") {
    const fmt = isDef ? ZH_DEF_FORMAT : isList ? ZH_LIST_FORMAT : ZH_FORMAT;
    if (userLevel === "basic") {
      return `面向一线操作工的 SYNAPSE 本地部署系统助手。用简体中文、通俗易懂、完整地回答。${fmt} ${ZH_GUARD}`;
    }
    if (userLevel === "manager") {
      return `面向管理者的 SYNAPSE 本地部署系统分析助手。用简体中文回答，聚焦 KPI/趋势/运营影响，并给出优先级行动建议。${fmt} ${ZH_GUARD}`;
    }
    return `面向工程师的 SYNAPSE 本地部署系统技术助手。用简体中文回答，给出具体的 API/数据结构/配置/命令；解释设计与错误处理。${fmt} ${ZH_GUARD}`;
  }

  if (language === "vi") {
    const fmt = isDef ? VI_DEF_FORMAT : isList ? VI_LIST_FORMAT : VI_FORMAT;
    if (userLevel === "basic") {
      return `Trợ lý hệ thống SYNAPSE on-prem cho công nhân. Trả lời tiếng Việt, dễ hiểu, đầy đủ. ${fmt} ${VI_GUARD}`;
    }
    if (userLevel === "manager") {
      return `Trợ lý phân tích SYNAPSE on-prem cho quản lý. Trả lời tiếng Việt, tập trung KPI/xu hướng/tác động vận hành, đề xuất hành động ưu tiên. ${fmt} ${VI_GUARD}`;
    }
    return `Trợ lý kỹ thuật SYNAPSE on-prem cho kỹ sư. Trả lời tiếng Việt, kèm API/schema/cấu hình/CLI cụ thể; giải thích thiết kế và xử lý lỗi. ${fmt} ${VI_GUARD}`;
  }
  const fmt = isDef ? EN_DEF_FORMAT : isList ? EN_LIST_FORMAT : EN_FORMAT;
  if (userLevel === "basic") {
    return `Support assistant for SYNAPSE on-prem system, for line workers. ${fmt} ${EN_GUARD}`;
  }
  if (userLevel === "manager") {
    return `Analytical assistant for SYNAPSE on-prem system, for managers. Focus on KPIs, trends, operational impact, prioritized actions. ${fmt} ${EN_GUARD}`;
  }
  return `Technical assistant for SYNAPSE on-prem system, for engineers. Include APIs, schemas, config, CLI; explain design and error handling. ${fmt} ${EN_GUARD}`;
}

// Lever 9.A/9.B — extract concrete facts (API paths, screen paths, env vars,
// short code fences) from FULL raw KB contexts BEFORE truncation, so the LLM
// can quote them verbatim and rubric criteria apiRefs / examples fire even
// when contexts are long. Helps lift depth from ~0.44 → target ≥0.65.
const KB_HINTS_ENABLED = (process.env.KB_HINTS_ENABLED ?? "true") !== "false";
const KB_HINTS_MAX_FENCE_LEN = Number(process.env.KB_HINTS_MAX_FENCE_LEN ?? 280);
const KB_HINTS_MAX_FENCES = Number(process.env.KB_HINTS_MAX_FENCES ?? 2);

interface KbHints {
  apiPaths: string[];
  screenPaths: string[];
  envVars: string[];
  codeFences: string[];
}

function extractKbHints(retrieve: KbRetrieveResult): KbHints {
  const text = (retrieve.contexts || []).join("\n\n");
  if (!text) return { apiPaths: [], screenPaths: [], envVars: [], codeFences: [] };
  const uniq = (arr: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of arr) {
      const k = s.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(s); }
    }
    return out;
  };
  const apiPaths = uniq(
    (text.match(/\/api\/[a-z0-9_\-\/{}:.]+/gi) || []).map((s) => s.replace(/[.,;:)\]]+$/, "")),
  ).slice(0, 6);
  // Screen paths: non-/api app routes seen in docs (e.g. /products/measurement-points).
  const screenRaw = text.match(/(?:^|[\s(`"'])(\/[a-z][a-z0-9\-]{1,}(?:\/[a-z0-9\-:]+){1,3})/gi) || [];
  const screenPaths = uniq(
    screenRaw
      .map((s) => s.replace(/^[\s(`"']/, ""))
      .filter((s) => !/^\/api\//i.test(s)),
  ).slice(0, 6);
  const envVars = uniq(
    text.match(/\b[A-Z][A-Z0-9_]{3,}=[^\s`'"]+/g) || [],
  ).slice(0, 6);
  const fenceRe = /```([a-z0-9]*)\n([\s\S]*?)```/g;
  const codeFences: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) && codeFences.length < KB_HINTS_MAX_FENCES) {
    const lang = m[1] || "";
    const body = m[2].trim();
    if (!body) continue;
    const trimmed = body.length > KB_HINTS_MAX_FENCE_LEN
      ? body.slice(0, KB_HINTS_MAX_FENCE_LEN) + "\n…"
      : body;
    codeFences.push("```" + lang + "\n" + trimmed + "\n```");
  }
  return { apiPaths, screenPaths, envVars, codeFences };
}

function formatHintsBlock(retrieve: KbRetrieveResult): string {
  if (!KB_HINTS_ENABLED) return "";
  const h = extractKbHints(retrieve);
  const has = h.apiPaths.length || h.screenPaths.length || h.envVars.length || h.codeFences.length;
  if (process.env.KB_HINTS_DEBUG === "true") {
    console.error("[KB_HINTS]", JSON.stringify({
      apiPaths: h.apiPaths.length, screenPaths: h.screenPaths.length,
      envVars: h.envVars.length, codeFences: h.codeFences.length,
      sampleApi: h.apiPaths.slice(0, 2), sampleScreen: h.screenPaths.slice(0, 2),
    }));
  }
  if (!has) return "";
  const isVi = retrieve.language === "vi";
  const lines: string[] = [];
  lines.push(isVi
    ? "=== HINTS từ KB (BẮT BUỘC trích lại nguyên văn ≥1 mục liên quan vào câu trả lời) ==="
    : "=== KB HINTS (you MUST quote ≥1 relevant item verbatim in the answer) ===");
  if (h.apiPaths.length) {
    lines.push((isVi ? "API: " : "API: ") + h.apiPaths.map((s) => "`" + s + "`").join(" "));
  }
  if (h.screenPaths.length) {
    lines.push((isVi ? "Màn hình: " : "Screens: ") + h.screenPaths.map((s) => "`" + s + "`").join(" "));
  }
  if (h.envVars.length) {
    lines.push((isVi ? "Cấu hình: " : "Config: ") + h.envVars.map((s) => "`" + s + "`").join(" "));
  }
  if (h.codeFences.length) {
    lines.push((isVi ? "Ví dụ code:" : "Code example:") + "\n" + h.codeFences.join("\n"));
  }
  return lines.join("\n");
}

// Lever 10 — extractive post-process. When the LLM answer for a technical
// question doesn't quote any concrete API path / screen / env var but the KB
// hints DO contain them, append a short "API liên quan" footer so depth
// (apiHits / examples) lifts above ~0.45. Idempotent: skipped if the answer
// already contains a /api/ token.
function appendHintsFooter(
  answer: string,
  retrieve: KbRetrieveResult,
  force = false,
): string {
  if (!KB_HINTS_ENABLED) return answer;
  if (!answer || answer.length < 20) return answer;
  const intent = retrieve.intent;
  const h = extractKbHints(retrieve);
  // Only augment technical-leaning intents — not basic worker queries.
  // `force` bypass is used by the tool short-circuit branch (Stage 11a).
  // Stage 11b: also apply when intent classifier returned "general" but
  // the KB hints contain concrete technical refs (apiPaths or codeFences)
  // AND the answer is substantial (≥200 chars) — the classifier often
  // mis-labels nuanced engineer questions (P3 SPC/measurement-point) as
  // general.
  const hasTechHints = h.apiPaths.length > 0 || h.codeFences.length > 0;
  // Stage 13.A — NEVER append the API/screen footer for pure knowledge
  // questions (definition / list). The footer makes sense for how-to /
  // technical questions where the user expects pointers to code & UI; on
  // a definition question ("X là gì"), tacking on "API liên quan" is noise
  // and encourages the model to also fabricate UI paths in the body.
  if (intent === "definition" || intent === "list") return answer;
  const eligible =
    force ||
    intent === "technical" ||
    intent === "architecture" ||
    intent === "troubleshoot" ||
    intent === "how_to" ||
    (intent === "general" && hasTechHints && answer.length >= 200);
  if (!eligible) return answer;
  const hasApi = /\/api\//i.test(answer);
  const hasFence = /```/.test(answer);
  // Build only the buckets the answer is missing.
  const isVi = retrieve.language === "vi";
  const parts: string[] = [];
  if (!hasApi && h.apiPaths.length) {
    parts.push(
      (isVi ? "API liên quan: " : "Related APIs: ") +
        h.apiPaths.slice(0, 4).map((s) => "`" + s + "`").join(", "),
    );
  }
  if (h.screenPaths.length && !h.screenPaths.some((s) => answer.includes(s))) {
    parts.push(
      (isVi ? "Màn hình liên quan: " : "Related screens: ") +
        h.screenPaths.slice(0, 3).map((s) => "`" + s + "`").join(", "),
    );
  }
  if (h.envVars.length && !h.envVars.some((s) => answer.includes(s.split("=")[0]))) {
    parts.push(
      (isVi ? "Biến cấu hình: " : "Config vars: ") +
        h.envVars.slice(0, 3).map((s) => "`" + s + "`").join(", "),
    );
  }
  if (!parts.length) return answer;
  // Optional code example footer when answer has zero fences and we have one.
  let footer = "\n\n" + parts.join("\n");
  if (!hasFence && h.codeFences.length) {
    footer += "\n\n" + (isVi ? "Ví dụ:" : "Example:") + "\n" + h.codeFences[0];
  }
  return answer + footer;
}

// Format conversation history for the prompt.
// Assistant turns are truncated to a short snippet so the model
// uses them only as context (resolve pronouns / topic) and does not
// regurgitate the full prior answer in the new response.
function formatHistoryBlock(history: ConversationMessage[]): string {
  const ASSISTANT_SNIPPET_MAX = 160;
  const USER_SNIPPET_MAX = 300;
  return history
    .slice(-4) // keep last 2 turns (user + assistant pairs)
    .map((m) => {
      const isUser = m.role === "user";
      const label = isUser ? "Người dùng" : "Trợ lý (tóm tắt)";
      const max = isUser ? USER_SNIPPET_MAX : ASSISTANT_SNIPPET_MAX;
      // doc69 G2-3 — redact secrets/PII from prior turns before they re-enter a new prompt
      // (defense-in-depth; a secret pasted 2 turns ago must not keep echoing forward).
      const oneLine = redactSecretsAndPII(m.content.replace(/\s+/g, " ").trim()).text;
      const snippet =
        oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
      return `${label}: ${snippet}`;
    })
    .join("\n");
}

/**
 * FE-W0.3 (doc 46 §2.3) — run the degenerate-loop guard over a completed LLM
 * answer. Returns the clean text (or a salvaged head) or NULL when the output is
 * unsalvageable garbage — NULL makes the caller fall back to the extractive/tool
 * answer instead of showing "cell cell cell…". Never throws.
 */
function guardKbAnswer(raw: string | null | undefined): string | null {
  const g = guardGeneratedText(raw);
  if (g.degraded) {
    console.warn(
      `[aiLocalKnowledge] degenerate LLM answer rejected (${g.reason}) — ` +
        `${g.text ? "using salvaged head" : "falling back to extractive/tool"}.`,
    );
  }
  const t = g.text.trim();
  return t.length > 0 ? t : null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ G2-C — HÀNG RÀO "DỮ LIỆU KHÔNG TIN CẬY" + BA CÂU NÓI THẬT
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠⚠ LỖ ĐÃ CÓ TỪ TRƯỚC, BỊT Ở ĐÂY — **KHÔNG gắn cờ `AI_TOOL_LOOP_ENABLED`.**
 *
 * `scanForInjection` chỉ chạy trên câu hỏi của người dùng (qua `aiGateway.planInference`). Chunk
 * KB, corpus Studio và kết quả tool đi thẳng vào prompt: dòng duy nhất chạm chúng trước G2-C là
 * `redactSecretsAndPII` — một phép **CHE**, không phải một phép **PHÁT HIỆN**. Vòng lặp tự do
 * khuếch đại lỗ này, nhưng nó KHÔNG tạo ra lỗ; gắn bản vá vào cờ vòng lặp nghĩa là ở cấu hình
 * mặc định (cờ TẮT) lỗ vẫn mở nguyên. Vì thế hàng rào chạy ở MỌI cấu hình.
 */
function bocDuLieuTool(
  summary: string | null | undefined,
  nhan: string,
): { block: string | null; risk: InjectionRisk; matched: string[] } {
  if (!summary) return { block: null, risk: "none", matched: [] };
  const s = sanitizeUntrustedBlock(summary);
  return { block: wrapUntrustedBlock(nhan, s.text), risk: s.risk, matched: s.matched };
}

/**
 * Khối ngữ cảnh KB — MỘT hàng rào bọc toàn bộ (không phải mỗi chunk một hàng rào: `topK` khối chỉ
 * dẫn lặp lại là ~40 dòng prompt thừa mà không thêm một bảo đảm nào; điều cần bảo đảm là
 * "không mẩu nào của chunk nằm NGOÀI hàng rào", và một hàng rào bọc cả cụm đã đủ).
 * Dùng chung cho cả đường non-stream lẫn stream — trước G2-C hai hàm dựng khối này BẰNG TAY, y
 * hệt nhau, ở hai chỗ; một bản vá an toàn chỉ áp một chỗ là đúng lớp lỗi "N+1" của repo.
 */
function buildContextBlock(retrieve: KbRetrieveResult): string {
  const than = retrieve.citations
    .map((c, i) => {
      const raw = retrieve.contexts[i] ?? "";
      const ctx = raw.length > CONTEXT_CHUNK_CHAR_CAP ? `${raw.slice(0, CONTEXT_CHUNK_CHAR_CAP)}…` : raw;
      // Che bí mật/PII lọt vào một chunk đã nạp (giữ nguyên hành vi doc69 G2-3) rồi TRUNG HOÀ
      // hàng rào — nếu không, một chunk chứa đúng chuỗi dấu đóng sẽ tự thoát ra ngoài khối.
      return `[${i + 1}] ${c.title} | ${c.sourcePath}\n${sanitizeUntrustedBlock(ctx, { maxChars: CONTEXT_CHUNK_CHAR_CAP + 8 }).text}`;
    })
    .join("\n\n");
  return than ? wrapUntrustedBlock("knowledge-base", than) : than;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ G3-C VIỆC 2 — CỔNG THỨ TÁM: **KHÔNG CÓ DỮ LIỆU THÌ KHÔNG GỌI LLM ĐỂ NÓI.**
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠ HÌNH DẠNG LỖI NGƯỢC HOÀN TOÀN VỚI MONG MUỐN, VÀ ĐỘ DÀI LÀ THỦ PHẠM.
 *
 * Đường tắt ngay dưới (`summary.length >= KB_TOOL_SHORTCIRCUIT_MIN`, mặc định **150 ký tự**) bỏ
 * qua LLM khi tóm tắt của tool đã "đủ dày". Nhưng **mọi câu RỖNG/LỖI đều NGẮN hơn 150**:
 *   • `"Không có lỗi NG nào theo defectType trong 7 ngày qua."`  (~52 ký tự)
 *   • `"Chưa đủ dữ liệu yield (2 điểm)…"` · `"Không truy vấn được…"`
 * ⇒ **Đúng những lượt hệ thống KHÔNG CÓ GÌ để nói thì LLM lại được gọi để nói.** Một model được
 * đưa cho một khối "không tìm thấy dữ liệu" cùng vài chunk tài liệu, kèm chỉ dẫn *"ƯU TIÊN dùng
 * dữ liệu thời gian thực"* — đó là cấu hình sinh số bịa, không phải cấu hình diễn giải.
 *
 * ⇒ Cổng này khoá theo **TRẠNG THÁI CÓ CẤU TRÚC** (`ToolResult.note`), **KHÔNG theo độ dài** —
 * độ dài chính là gốc rễ của lỗi, dùng lại nó là vá bằng đúng thứ đã hỏng.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ 2026-08-18 — VỊ TỪ ĐÃ **ĐẢO CHIỀU**. LÝ DO, VÀ CÁI GIÁ ĐÃ CÂN.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản đầu LIỆT KÊ bốn mã CHẶN, kèm một phép **đếm TAY** ("`NOT_FOUND` 44 chỗ · `DB_UNAVAILABLE`
 * 14 · `QUERY_ERROR` 6 · `PERMISSION_DENIED` 6"). Phép đếm tay mù đúng thứ nó không nghĩ tới —
 * lượt kiểm kê bằng máy trên `aiLocalTools/**` (xem `aiLocalTools/toolNoteCensus.test.ts`) ra
 * **22 mã**, tức **17 mã ở NGOÀI tập chặn**, trong đó có hai mã LÀ RỖNG theo đúng nghĩa đen:
 *   • `SCOPE_EMPTY`                (`analyticsTools.ts`) — `hotspots: []`, `totalNG: 0`
 *   • `NOT_FOUND_WITH_SUGGESTIONS` (`handlers.ts`)       — **`data: null`**, câu mở đầu đúng chữ
 *     *"Không tìm thấy lệnh sản xuất …"*. Nó LÀ `NOT_FOUND`, chỉ khác cái TÊN.
 * Thêm tên thứ năm vào danh sách là chữa MỘT trong 17, và mã thứ 23 (ngày mai) lại lọt.
 *
 * ⇒ Luật nay phát biểu trên **NGHĨA của ô `note`**, không trên một tập giá trị chép tay:
 *
 *     `ToolResult.note` **chỉ** được đặt khi kết quả KHÔNG phát biểu đủ về nhà xưởng
 *     (rỗng / lỗi / bị từ chối / suy giảm).  ⇒  **CÓ `note` ⇒ CHẶN.**
 *
 * Đó là lời khai về TOÀN BỘ cây `aiLocalTools/**`, và nó được **ĐO** chứ không được tin: bảng kê
 * ở `toolNoteCensus.test.ts` bắt buộc mọi mã `note` viết thẳng trong mã nguồn phải có một phán
 * quyết; mã MỚI chưa phân loại ⇒ **ĐỎ**. Ngoại lệ (kết quả CÓ `note` mà VẪN đáng diễn giải) phải
 * được khai đích danh ở `TOOL_NOTE_VAN_DIEN_GIAI` ngay dưới.
 *
 * ⚠⚠ CHIỀU HỎNG ĐÃ ĐỔI, CÓ CHỦ Ý — và đây là phép đánh đổi BẤT ĐỐI XỨNG:
 *   • fail-open cũ (mã lạ ⇒ gọi LLM): hỏng **vô hình** và **không có trần** — model bịa ra một
 *     kết luận về nhà xưởng từ một kết quả rỗng.
 *   • fail-closed mới (mã lạ ⇒ chặn): hỏng **hữu hình** và **có trần** — người dùng nhận NGUYÊN
 *     VĂN `textSummary` của tool (vốn đã trung thực) mà thiếu phần văn vẻ.
 * Mất phần văn vẻ không cùng hạng với mất sự thật. Repo cũng đã chọn đúng chiều này ở chỗ khác:
 * đường `clarifyMessage` (~dòng 2311 file này) trả thẳng câu hỏi lại, KHÔNG qua LLM.
 *
 * ⚠ VÀ NGƯỢC LẠI — ca chống-vá-quá-tay vẫn nguyên: một kết quả **có dữ liệu thật** nhưng tóm tắt
 * NGẮN thì `note` là `undefined`, và nó **vẫn phải** được LLM diễn giải. Xem
 * `aiLocalKnowledge.emptyToolGate.test.ts` §B.
 */

/**
 * Mã `note` được khai ĐÍCH DANH là **vẫn còn gì đó đáng diễn giải** ⇒ KHÔNG chặn.
 *
 * ⚠⚠ HÔM NAY TẬP NÀY **RỖNG**, và đó là một PHÉP ĐO chứ không phải chỗ chưa làm: 22/22 mã có
 * thật trong cây đều nằm trên đường RỖNG / LỖI / TỪ CHỐI / SUY GIẢM (kiểm kê từng mã, kèm lý do,
 * ở `toolNoteCensus.test.ts`). Tập rỗng ở đây **không phải mã chết**: `toolNoteCensus.test.ts` §3
 * cưỡng chế nó phải TRÙNG KHÍT nhánh `dien-giai` của bảng kê, nên nó là chỗ DUY NHẤT hợp lệ để
 * khai một ngoại lệ, và một ngoại lệ khai ở đây mà không có lý do trong bảng kê ⇒ ĐỎ.
 */
export const TOOL_NOTE_VAN_DIEN_GIAI: ReadonlySet<string> = new Set<string>([]);

/**
 * `true` ⇔ tool đã nói bằng một trạng thái CÓ CẤU TRÚC rằng nó không có gì đầy đủ để diễn giải.
 *
 * ⚠ `note === ""` được coi là KHÔNG có trạng thái (chuỗi rỗng không phát biểu gì) — không chặn.
 *
 * ⚠ `soVongDaChay > 1` ⇒ **KHÔNG** khoá. Với nhiều vòng, thứ đi vào prompt là khối TÍCH LUỸ của
 * cả vòng lặp (`loop.promptBlock`), không phải riêng kết quả vòng cuối; `note` của vòng cuối
 * không phát biểu gì về những vòng trước đã lấy được gì. Khoá ở đó là vứt bỏ đúng phép TỔNG HỢP
 * mà vòng lặp vừa đi lấy — cùng lý lẽ với biến `daDaBuoc` ở đường tắt độ dài ngay bên dưới.
 */
export function toolKhongCoGiDeNoi(
  toolResult: { note?: string } | null | undefined,
  soVongDaChay = 1,
): boolean {
  if (soVongDaChay > 1) return false;
  const note = toolResult?.note;
  if (typeof note !== "string" || note === "") return false;
  return !TOOL_NOTE_VAN_DIEN_GIAI.has(note);
}

/** Rủi ro tiêm gộp của toàn bộ chunk KB đưa vào prompt (chỉ để BÁO, không chặn câu trả lời). */
function quetNguCanhKb(retrieve: KbRetrieveResult): InjectionRisk {
  for (const ctx of retrieve.contexts) {
    if (sanitizeUntrustedBlock(ctx ?? "").risk === "high") return "high";
  }
  return "none";
}

/**
 * ★ VÁ LỖI ĐO ĐƯỢC (mục 4 của brief): `tryExecuteTool` trả `error` rồi **KHÔNG AI ĐỌC**. Người
 * dùng hỏi "OEE line 2 hôm nay", tool trượt, và họ nhận một câu trả lời dựa trên TÀI LIỆU mà
 * không có một dấu hiệu nào rằng số liệu sống chưa lấy được. Câu dưới đây là phần "nói thật" —
 * nó KHÔNG sửa được tool, nhưng nó ngăn một câu trả lời sai NGỮ CẢNH đi ra như một câu trả lời
 * bình thường.
 */
function cauCanhBaoDuLieuSong(lang: KbLanguage, ma: string): string {
  if (lang === "en") {
    return `\n\n> ⚠ **Live data was NOT retrieved** (reason: \`${ma}\`). The answer below is based on documentation only — do not read it as the current shop-floor state.`;
  }
  if (lang === "zh") {
    return `\n\n> ⚠ **未能获取实时数据**（原因：\`${ma}\`）。以下回答仅基于文档，不代表当前现场状态。`;
  }
  return `\n\n> ⚠ **Chưa lấy được số liệu sống** (lý do: \`${ma}\`). Câu trả lời dưới đây chỉ dựa trên TÀI LIỆU — đừng đọc nó như tình trạng hiện trường.`;
}

/** Câu nói thật khi dữ liệu đưa vào prompt có chứa chỉ thị (đã bị vô hiệu, nhưng phải nói ra). */
function cauCanhBaoTiem(lang: KbLanguage, nguon: string): string {
  if (lang === "en") {
    return `\n\n> ⚠ **Untrusted content detected in ${nguon}**: it contained text shaped like instructions. It was fenced as data and could not drive any further tool call. Treat the source with suspicion.`;
  }
  if (lang === "zh") {
    return `\n\n> ⚠ **在${nguon}中检测到不可信内容**：其中含有类似指令的文本。该内容已被隔离为数据，无法触发后续工具调用。请对来源保持警惕。`;
  }
  return `\n\n> ⚠ **Phát hiện nội dung không tin cậy trong ${nguon}**: có đoạn mang hình dạng CHỈ THỊ. Nó đã bị rào lại như dữ liệu và KHÔNG lái được lượt gọi tool nào tiếp theo. Hãy nghi ngờ nguồn này.`;
}

/**
 * Nối MỌI câu nói thật vào cuối câu trả lời. Một hàm DUY NHẤT cho cả `answerQuestion` lẫn
 * `streamAnswer`: hai bản sao sẽ trôi, và đường stream (đường người dùng thật sự đi) sẽ là bản
 * thiếu — đúng lớp lỗi mà mục 4 của brief đang vá.
 */
function themCanhBao(
  answer: string,
  lang: KbLanguage,
  tin: {
    toolError: string | null;
    toolName: string | null;
    toolInjRisk: InjectionRisk;
    kbInjRisk: InjectionRisk;
    loop: ToolLoopResult | null;
  },
): string {
  let ra = answer;
  if (tin.toolError) {
    ra += cauCanhBaoDuLieuSong(lang, `${tin.toolName ?? "tool"}: ${tin.toolError}`);
  }
  if (tin.toolInjRisk === "high") ra += cauCanhBaoTiem(lang, "kết quả tool");
  if (tin.kbInjRisk === "high") ra += cauCanhBaoTiem(lang, "tài liệu tra cứu");
  if (tin.loop) ra += cauGhiChuVongLap(lang, tin.loop);
  return ra;
}

/** Ghi chú vòng lặp — người dùng thấy được nó đã đi mấy bước và vì sao dừng. */
function cauGhiChuVongLap(lang: KbLanguage, loop: ToolLoopResult): string {
  if (loop.rounds.length < 2) return "";
  const ten = loop.rounds.map((r) => r.tool).filter(Boolean).join(" → ");
  if (lang === "en") return `\n\n<sub>Multi-step: ${loop.rounds.length} tool calls (${ten}), ${loop.elapsedMs} ms.</sub>`;
  if (lang === "zh") return `\n\n<sub>多步：${loop.rounds.length} 次工具调用（${ten}），${loop.elapsedMs} 毫秒。</sub>`;
  return `\n\n<sub>Đa bước: ${loop.rounds.length} lượt gọi tool (${ten}), ${loop.elapsedMs} ms.</sub>`;
}

async function generateWithOllama(
  question: string,
  retrieve: KbRetrieveResult,
  history: ConversationMessage[] = [],
  userLevel: UserLevel = "technical",
  toolSummary?: string | null,
  userId?: number,
): Promise<string | null> {
  // doc69 G2-3 — AI Gateway: SAME input this function always passed to `route()` below
  // (`{task:"chat", text: question}`), so `plan.decision.modelId` is byte-identical to
  // before — model pinning is preserved, nothing is "double-routed". This ADDS: flag-gated
  // fail-safe input redaction (`plan.safeText`, used for the question below), a per-user
  // rate-limit + A/B slot (previously bypassed for this endpoint), and `record()`/
  // `sanitizeOutput()` for gateway metering + output redaction further down.
  const plan = await planInference({ task: "chat", text: question, userId });

  // G2-C — dựng CHUNG + có hàng rào dữ-liệu-không-tin-cậy (xem `buildContextBlock`).
  const contextBlock = buildContextBlock(retrieve);

  const systemPrompt = getSystemPromptForRole(userLevel, retrieve.language, retrieve.intent);
  const historyBlock = formatHistoryBlock(history);
  const hintsBlock = formatHintsBlock(retrieve);

  // doc69 G2-3 — redact live-DB tool-result text before it is embedded in the prompt.
  const safeToolSummary = toolSummary ? redactSecretsAndPII(toolSummary).text : toolSummary;
  const toolBlock = safeToolSummary
    ? `\n=== Dữ liệu thời gian thực (từ CSDL) ===\n${safeToolSummary}\nƯU TIÊN dùng dữ liệu này để trả lời. Không bịa số liệu.\n`
    : "";

  const prompt = [
    systemPrompt,
    history.length > 0 ? `\n=== Lịch sử hội thoại (chỉ để tham khảo ngữ cảnh) ===\n${historyBlock}\n` : "",
    "NGUYÊN TẮC TRẢ LỜI:",
    "1. Chỉ trả lời dựa trên ngữ cảnh được cung cấp; trích dẫn nguồn bằng [1], [2].",
    "2. Nếu ngữ cảnh KHÔNG liên quan trực tiếp đến câu hỏi, hãy trả lời chính xác: \"Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại.\" và đề xuất câu hỏi rõ hơn. KHÔNG bịa.",
    "3. Trả lời đúng trọng tâm câu hỏi hiện tại; bỏ qua phần ngữ cảnh không liên quan.",
    "4. Nếu có dữ liệu thời gian thực, ƯU TIÊN dùng nó; không bịa số liệu.",
    "5. TUYỆT ĐỐI KHÔNG lặp lại, sao chép, hoặc tóm tắt các câu trả lời trước trong Lịch sử hội thoại. Lịch sử CHỈ dùng để hiểu ngữ cảnh (ví dụ: đại từ, chủ đề đang nói tới). CHỈ trả lời cho 'Câu hỏi hiện tại' bên dưới, không nhắc lại nội dung cũ.",
    `Phân loại ý định: ${retrieve.intent}`,
    `Ngôn ngữ: ${retrieve.language}`,
    toolBlock,
    "=== Ngữ cảnh từ knowledge base ===",
    contextBlock,
    hintsBlock ? "\n" + hintsBlock + "\nGHI NHỚ: trong câu trả lời PHẢI trích nguyên văn ≥1 mục từ HINTS dưới dạng inline code (`...`) khi nó liên quan đến câu hỏi.\n" : "",
    // doc69 G2-3 — `plan.safeText` (redacted question), not raw `question`.
    `\n=== Câu hỏi hiện tại ===\n${plan.safeText}`,
    "=== Câu trả lời (chỉ trả lời câu hỏi hiện tại, không lặp lại lịch sử) ===",
  ]
    .filter(Boolean)
    .join("\n");

  // Default: use bundled GGUF engine (RTX 5090 local). Fallback to Ollama HTTP only if USE_LEGACY_OLLAMA=true.
  const numPredict = pickNumPredict(retrieve.intent, !!toolSummary, question);
  if (!USE_LEGACY_OLLAMA) {
    let start = 0;
    try {
      const { generateText: ggufGen, isGgufAvailable } = await import("./aiGgufEngine");
      if (await isGgufAvailable()) {
        // doc 48 R1 — PIN a generative model. Without a modelId the engine's
        // getOrLoadModel(undefined) reuses the FIRST resident model, which is the RAG
        // embedder → gibberish answers. `plan.decision` already carries the SAME
        // Model-Router pick `route({task:"chat", text: question})` produced before.
        start = Date.now();
        const result = await ggufGen({
          prompt,
          maxTokens: numPredict,
          temperature: 0.15,
          topP: 0.9,
          repeatPenalty: KB_QA_REPEAT_PENALTY,
        }, plan.decision.modelId);
        // doc69 G2-3 — gateway metering: this traffic was previously completely invisible.
        plan.record({
          tokensIn: result.tokensPrompt,
          tokensOut: result.tokensGenerated,
          latencyMs: Date.now() - start,
          outcome: "ok",
        });
        // G5-C — CẮT CHUỖI SUY LUẬN TRƯỚC, rồi mới che bí mật, rồi mới tới guard degenerate.
        // Thứ tự này có lý do đo được (xem chú thích ở đầu file + `ai/thinkingStrip.ts`): cắt thẻ
        // NỐI hai nửa một bí mật bị khối `<think>` tách rời, nên `sanitizeOutput` phải nhìn thấy
        // chuỗi ĐÃ nối. Cắt xong rỗng ⇒ `guardKbAnswer` trả null ⇒ rơi về extractive/tool —
        // trung thực, thay vì phun nội tâm model ra màn hình.
        return guardKbAnswer(plan.sanitizeOutput(stripThinking(result.text).answer));
      }
      // GGUF not available — fall through to Ollama path.
    } catch (err) {
      plan.record({ latencyMs: start ? Date.now() - start : 0, outcome: "error" });
      console.warn("[aiLocalKnowledge] GGUF generate failed, falling back to Ollama:", err);
    }
  }

  // Phase-6: hard deadline via AbortController so a stalled Ollama call
  // (observed 120s+ in Phase-5 eval) cannot block the entire request path.
  // NOTE: With stream:false, Ollama writes the response body only after the
  // full generation finishes. We MUST keep the timer armed across both the
  // fetch headers AND the body read (`res.json()`); otherwise the abort
  // becomes a no-op for long generations.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        model: OLLAMA_QA_MODEL,
        prompt,
        stream: false,
        keep_alive: LLM_KEEP_ALIVE,
        options: {
          temperature: 0.15,
          top_p: 0.9,
          num_predict: numPredict,
        },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { response?: string };
    // FE-W0.3 (doc 46 §2.3) — guard the completed answer; degenerate → null → fallback.
    // G5-C — nhánh Ollama HTTP cũng đi qua bộ cắt: một nhánh được miễn trừ chính là hình dạng mà
    // lưới lượng từ không phát biểu được (bài học lặp lại của repo này).
    return guardKbAnswer(stripThinking(json.response ?? "").answer);
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      console.warn(`[aiLocalKnowledge] Ollama generate aborted after ${LLM_TIMEOUT_MS}ms — falling back to extractive`);
    } else {
      console.warn("[aiLocalKnowledge] Ollama generate failed:", err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function* generateWithOllamaStream(
  question: string,
  retrieve: KbRetrieveResult,
  history: ConversationMessage[] = [],
  userLevel: UserLevel = "technical",
  toolSummary?: string | null,
  userId?: number,
): AsyncGenerator<string> {
  // doc69 G2-3 — AI Gateway (see the identical comment on generateWithOllama above; same
  // {task:"chat", text: question} input preserves the pinned-model decision byte-for-byte).
  const plan = await planInference({ task: "chat", text: question, userId });

  // G2-C — dựng CHUNG với đường non-stream (xem `buildContextBlock`). Trước G2-C hai hàm dựng
  // khối này bằng tay y hệt nhau, nên một bản vá an toàn áp một chỗ là lỗ ở chỗ còn lại.
  const contextBlock = buildContextBlock(retrieve);

  const systemPrompt = getSystemPromptForRole(userLevel, retrieve.language, retrieve.intent);
  const historyBlock = formatHistoryBlock(history);
  const hintsBlock = formatHintsBlock(retrieve);

  // doc69 G2-3 — redact live-DB tool-result text before it is embedded in the prompt.
  const safeToolSummary = toolSummary ? redactSecretsAndPII(toolSummary).text : toolSummary;
  const toolBlock = safeToolSummary
    ? `\n=== Dữ liệu thời gian thực (từ CSDL) ===\n${safeToolSummary}\nƯU TIÊN dùng dữ liệu này để trả lời. Không bịa số liệu.\n`
    : "";

  const prompt = [
    systemPrompt,
    history.length > 0 ? `\n=== Lịch sử hội thoại (chỉ để tham khảo ngữ cảnh) ===\n${historyBlock}\n` : "",
    "NGUYÊN TẮC TRẢ LỜI:",
    "1. Chỉ trả lời dựa trên ngữ cảnh được cung cấp; trích dẫn nguồn bằng [1], [2].",
    "2. Nếu ngữ cảnh KHÔNG liên quan trực tiếp đến câu hỏi, hãy trả lời chính xác: \"Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại.\" và đề xuất câu hỏi rõ hơn. KHÔNG bịa.",
    "3. Trả lời đúng trọng tâm câu hỏi hiện tại; bỏ qua phần ngữ cảnh không liên quan.",
    "4. Nếu có dữ liệu thời gian thực, ƯU TIÊN dùng nó; không bịa số liệu.",
    "5. TUYỆT ĐỐI KHÔNG lặp lại, sao chép, hoặc tóm tắt các câu trả lời trước trong Lịch sử hội thoại. Lịch sử CHỈ dùng để hiểu ngữ cảnh (ví dụ: đại từ, chủ đề đang nói tới). CHỈ trả lời cho 'Câu hỏi hiện tại' bên dưới, không nhắc lại nội dung cũ.",
    `Phân loại ý định: ${retrieve.intent}`,
    `Ngôn ngữ: ${retrieve.language}`,
    toolBlock,
    "=== Ngữ cảnh từ knowledge base ===",
    contextBlock,
    hintsBlock ? "\n" + hintsBlock + "\nGHI NHỚ: trong câu trả lời PHẢI trích nguyên văn ≥1 mục từ HINTS dưới dạng inline code (`...`) khi nó liên quan đến câu hỏi.\n" : "",
    // doc69 G2-3 — `plan.safeText` (redacted question), not raw `question`.
    `\n=== Câu hỏi hiện tại ===\n${plan.safeText}`,
    "=== Câu trả lời (chỉ trả lời câu hỏi hiện tại, không lặp lại lịch sử) ===",
  ]
    .filter(Boolean)
    .join("\n");

  // Default: use bundled GGUF engine streaming. Fallback to Ollama HTTP if USE_LEGACY_OLLAMA=true.
  const numPredict = pickNumPredict(retrieve.intent, !!toolSummary, question);

  /**
   * ★ G5-C — MỘT bộ cắt cho TOÀN BỘ generator, dựng NGOÀI mọi nhánh có chủ ý.
   *
   * Hàm này có ba đường ra chữ: nhánh GGUF, nhánh Ollama HTTP (`USE_LEGACY_OLLAMA`), và nhánh
   * Ollama chạy vì GGUF vừa ném giữa chừng. Dựng bộ cắt bên trong một nhánh nghĩa là hai nhánh
   * kia rò — đúng lớp lỗi "lưới theo FILE, không theo ĐƯỜNG THOÁT" mà repo này đã dính nhiều
   * lần. Dựng ở đây thì **không đường thoát nào đi vòng được**.
   *
   * ⚠ Trạng thái là của RIÊNG một cuộc gọi (thẻ đang mở, mảnh thẻ ở đuôi) — không bao giờ được
   * nâng lên phạm vi module.
   */
  const catSuyLuan = new StreamingThinkingStripper({ startInsideThinking: thinkingStartsOpen() });
  const canhBaoMoSan = () => {
    if (!catSuyLuan.suspectedStartInsideThinking) return;
    console.warn(
      "[aiLocalKnowledge] thấy thẻ đóng suy luận ở độ sâu 0 SAU khi đã phát chữ — nhiều khả năng " +
        "chat template mở sẵn khối <think> mà AI_THINKING_STARTS_OPEN chưa bật; một phần chuỗi " +
        "suy luận ĐÃ tới người dùng trong lượt này.",
    );
  };

  if (!USE_LEGACY_OLLAMA) {
    let start = 0;
    try {
      const { generateTextStream: ggufStream, isGgufAvailable } = await import("./aiGgufEngine");
      if (await isGgufAvailable()) {
        // doc 48 R1 — PIN a generative model (see generateWithOllama above). modelId is the 2nd
        // arg to generateTextStream; without it the stream lands on the resident embedder.
        // `plan.decision` already carries the SAME Model-Router pick as before.
        // doc69 G2-3 — output safety: one redactor instance per stream (stateful — holds
        // back a growing secret across chunk boundaries; see aiSafety.ts's class doc).
        const redactor = new StreamingSecretRedactor();
        let tokensIn = 0;
        let tokensOut = 0;
        start = Date.now();
        for await (const chunk of ggufStream({
          prompt,
          maxTokens: numPredict,
          temperature: 0.15,
          topP: 0.9,
          repeatPenalty: KB_QA_REPEAT_PENALTY,
        }, plan.decision.modelId)) {
          // GGUF engine yields { type: "token" | "done" | "error", token?, ... }
          // We must extract the string token, not yield the whole object
          // (which would stringify to "[object Object]" downstream).
          if (chunk.type === "token" && typeof chunk.token === "string" && chunk.token.length > 0) {
            // G5-C — CẮT thẻ suy luận rồi mới CHE bí mật. Cả hai đều giữ trạng thái xuyên chunk:
            // `<thi` ở cuối mảnh này + `nk>` ở đầu mảnh sau là một thẻ THẬT.
            const safe = redactor.push(catSuyLuan.push(chunk.token));
            if (safe) yield safe;
          } else if (chunk.type === "done") {
            tokensIn = chunk.tokensPrompt ?? 0;
            tokensOut = chunk.tokensGenerated ?? 0;
          } else if (chunk.type === "error") {
            throw new Error(chunk.error || "GGUF stream error");
          }
        }
        // Release whatever BOTH filters were still holding back. ⚠ ĐÚNG THỨ TỰ: xả bộ cắt trước
        // và đẩy phần ấy QUA bộ che, rồi mới xả bộ che — ngược lại thì đuôi câu ra SAU phần đã
        // che, đảo thứ tự chữ người dùng đọc.
        // ⚠ ĐÃ ĐO (đột biến M11 của G5-C sống sót): chỉ `redactor.flush()` gánh chữ;
        // `catSuyLuan.flush()` không bao giờ nhả ký tự (xem chứng minh ở
        // `aiGgufEngine.stripThinking.test.ts`). Giữ vì nó chốt sổ `truncated`/`thinking`.
        const conCat = catSuyLuan.flush();
        const tail = (conCat ? redactor.push(conCat) : "") + redactor.flush();
        if (tail) yield tail;
        canhBaoMoSan();
        // doc69 G2-3 — gateway metering: this traffic was previously completely invisible.
        plan.record({ tokensIn, tokensOut, latencyMs: Date.now() - start, outcome: "ok" });
        return;
      }
    } catch (err) {
      plan.record({ latencyMs: start ? Date.now() - start : 0, outcome: "error" });
      console.warn("[aiLocalKnowledge] GGUF stream failed, falling back to Ollama:", err);
    }
  }

  // Stage 11c — same hard deadline as non-stream path so a stalled
  // Ollama HTTP stream cannot starve the SSE handler. Reader.read()
  // observes the abort and throws, which the consumer (askStream)
  // catches and falls back to extractive/tool answer.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_QA_MODEL,
        prompt,
        stream: true,
        keep_alive: LLM_KEEP_ALIVE,
        options: { temperature: 0.15, top_p: 0.9, num_predict: numPredict },
      }),
      signal: ac.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }

  if (!res.ok || !res.body) {
    clearTimeout(timer);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line) as { response?: string; done?: boolean };
          // G5-C — nhánh Ollama HTTP dùng CHUNG bộ cắt với nhánh GGUF (xem chú thích chỗ dựng).
          // ⚠ NỢ ĐƯỢC KHAI, KHÔNG VÁ Ở LƯỢT NÀY: nhánh này chưa hề có bộ che bí mật (nhánh GGUF
          // có `StreamingSecretRedactor`) — lỗ có TỪ TRƯỚC G5-C, nằm ngoài mandate lượt này, đã
          // ghi vào báo cáo. Chỉ chạy khi USE_LEGACY_OLLAMA=true.
          if (json.response) {
            const an = catSuyLuan.push(json.response);
            if (an) yield an;
          }
          if (json.done) {
            const con = catSuyLuan.flush();
            if (con) yield con;
            canhBaoMoSan();
            return;
          }
        } catch {
          // skip malformed lines
        }
      }
    }
    // Luồng đứt mà KHÔNG có dòng `done` (Ollama chết giữa chừng): vẫn phải xả phần bộ cắt còn
    // giữ, nếu không đuôi câu trả lời biến mất — cùng lớp lỗi `xaTonDong()` của ống SSE.
    const con = catSuyLuan.flush();
    if (con) yield con;
    canhBaoMoSan();
  } finally {
    clearTimeout(timer);
  }
}

// W0.2 (doc 11) — honest health shape. Keeps every legacy field (ready/chunks/
// embeddings/loadedAt/paths) for backward-compat and ADDS capability + provenance
// signals so the client can stop showing a misleading "Sẵn sàng":
//   llmReady          — a GGUF TEXT model actually resolves+validates on disk
//                       (else answers silently degrade to extractive)
//   embedModel        — model the corpus was embedded with (from meta)
//   queryEmbedModel   — model the query path uses (GGUF_EMBED_MODEL)
//   embedModelMatches — false ONLY when both known AND differ (retrieval corrupt)
//   kbBuiltAt         — when the corpus was built (ISO) · staleDays — whole days old
export interface KbHealth {
  ready: boolean;
  chunks: number;
  embeddings: number;
  loadedAt?: string;
  paths: { chunks: string; embeddings: string };
  // W0.2/W0.3 (doc 11) additions:
  llmReady: boolean;
  embedModel: string | null;
  queryEmbedModel: string;
  embedModelMatches: boolean;
  kbBuiltAt: string | null;
  chunkCount: number;
  staleDays: number | null;
  // doc69 B1 (Wave 5) — last autosync answer-eval gate outcome (pass/fail/skipped
  // + recall + when). null when autosync has never run a gate (disabled, or no
  // run since boot) — NOT the same as a failure, so the client must not treat
  // null as "bad".
  //   rollbackFailed — (review fix) true only when a rollback was NEEDED
  //   (evalGate:"fail") and BOTH restore attempts failed — the corpus may be
  //   a mixed old/new state on disk until the next successful autosync
  //   self-heals it. Distinct from rolledBack:false, which also covers the
  //   normal "no rollback was needed" case (pass/skip).
  lastAutosyncEvalGate: {
    evalGate: "pass" | "fail" | "skipped";
    recall: number | null;
    reason?: string;
    rolledBack: boolean;
    rollbackFailed: boolean;
    at: string;
  } | null;
  /**
   * ★★★ Pha 3 Task 5 (D) — **TRẠNG THÁI HOÃN VÌ HẾT VRAM, NAY CÓ NGƯỜI ĐỌC.**
   *
   * Pha 2B Task 6 dựng `getKbSyncSchedulerStatus().defer` để *"máy đọc được"*, rồi **không nối nó
   * vào đâu cả** — một đồng-hồ-không-kim, và đó chính là món nợ mà báo cáo Task 6 tự ghi. Task 5
   * mở dân số ra cả sáu hộ `background`, nên nếu vẫn không ai đọc thì nay là **sáu** đồng hồ
   * không kim.
   *
   * `kbSync.chain` — chuỗi hoãn của `cron:kb-sync` (cơ chế hẹn giờ riêng của Task 6, có khôi phục
   *   sau khởi động lại). `holders` — ô trạng thái của **mọi hộ khác** đi qua
   *   `vramDefer.xinVramCoHoan()` (trainer · finetune · cổng eval · reranker · embed-ctx).
   *
   * ⚠ Đây là **NGƯỜI ĐỌC**, không phải nguồn: cả hai ô đều là ảnh chụp trong bộ nhớ của tiến trình
   * đang phục vụ mặt sức khoẻ. Vết BỀN vẫn là `vram_events` (`defer` / `defer_exceeded`).
   *
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * ★★★ I-5 (review TOÀN NHÁNH Pha 4) — **MỘT Ô, HAI NGƯỜI ĐỌC, TRƯỚC ĐÂY CHỈ MỘT MANG CAVEAT.**
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * Task 1 (C-1) xoá `"idle"` khỏi KIỂU của mặt đọc VRAM và bổ sung `hostedHere` cho
   * `getKbSyncSchedulerStatus()`, **đúng vì** `defer === null` không phân biệt được *"không có
   * chuỗi hoãn"* với *"tiến trình này không nhìn thấy hộ đó"*. Nhưng nó **để nguyên người đọc
   * CŨ** — chính ô này. Và đây là chỗ hậu quả nặng nhất: cron sống ở `worker`, mặt sức khoẻ KB
   * được phục vụ ở `api` ⇒ ở `api` giá trị **LUÔN `null`**, và `null` ở đó đọc thành *"không có
   * chuỗi hoãn nào"* là một **lời khẳng định sai**. Bản khai trước là `defer | null` **trần** nên
   * `tsc` **không thể** bắt.
   *
   * ⇒ **ĐỔI KIỂU, KHÔNG THÊM CA** (ràng buộc 8): `kbSync` nay là một object BẮT BUỘC mang
   * `hostedHere` cạnh `chain`. Mọi người đọc cũ (`h.vramDefer.kbSync === null`) **gãy `tsc`** và
   * phải đọc lại caveat một lần — đó là cơ chế, không phải hình thức.
   */
  vramDefer: {
    kbSync: {
      /** `null` ⇔ không có chuỗi hoãn nào **TRONG TIẾN TRÌNH NÀY** — đọc kèm `hostedHere`. */
      chain: ReturnType<typeof getKbSyncSchedulerStatus>["defer"];
      /**
       * `true` = tiến trình này CHỦ TRÌ cron `kb:sync` ⇒ `chain === null` có nghĩa *"không có chuỗi
       * hoãn"*. `false` = hộ chạy ở tiến trình khác ⇒ `chain === null` **KHÔNG nói gì cả**.
       * `null` = không xác định được (đọc trạng thái scheduler hỏng).
       */
      hostedHere: boolean | null;
    };
    holders: VramDeferState[];
  };
}

/** Best-effort read of the last autosync eval-gate outcome. Never throws —
 * degrades to null so KB health stays available even if the scheduler module
 * itself failed to load. */
function readLastAutosyncEvalGate(): KbHealth["lastAutosyncEvalGate"] {
  try {
    return getLastAutosyncEvalGate();
  } catch {
    return null;
  }
}

/**
 * ★ Pha 3 Task 5 (D) — đọc trạng thái hoãn VRAM. **KHÔNG BAO GIỜ NÉM** (cùng kỷ luật với hàm
 * trên): một mặt sức khoẻ ngã vì một ô phụ thì mất luôn cả những ô chính.
 *
 * ⚠ `getKbSyncSchedulerStatus()` là đường **CHỈ-ĐỌC** — nó KHÔNG được tiêu thụ chốt "kêu một lần"
 * về cấu hình (M-6 của Task 6): một mặt sức khoẻ bị poll định kỳ sẽ ăn mất tiếng kêu trước khi
 * người vận hành kịp thấy. Hàm đó đã tự dùng `keu = false`; đừng đổi lời gọi ở đây thành một
 * đường quyết định.
 */
function readVramDefer(): KbHealth["vramDefer"] {
  try {
    // ★ I-5 — MỘT lượt đọc cho CẢ hai ô (cùng kỷ luật M-2 của `vramReadModel.docSauHo()`): đọc hai
    // lần là hai ảnh chụp ở hai thời điểm cho một sự thật.
    const s = getKbSyncSchedulerStatus();
    return { kbSync: { chain: s.defer, hostedHere: s.hostedHere }, holders: docTrangThaiHoanVram() };
  } catch {
    // ⚠ Nhánh SUY GIẢM: `hostedHere: null` — "không đọc được" ≠ "không chủ trì". Trước bản vá I-5,
    // nhánh này trả `kbSync: null` TRẦN, tức phát ra đúng lời khẳng định sai mà C-1 cấm.
    return { kbSync: { chain: null, hostedHere: null }, holders: [] };
  }
}

// W0.2 (doc 11) — best-effort "is a text LLM loadable?" check. Never throws;
// degrades to false so health stays conservative rather than crashing.
async function probeLlmReady(): Promise<boolean> {
  try {
    const { isGgufModelLoadable } = await import("./aiGgufEngine");
    return await isGgufModelLoadable();
  } catch {
    return false;
  }
}

function wholeDaysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000)));
}

export async function getKbHealth(): Promise<KbHealth> {
  const queryEmbedModel = GGUF_EMBED_MODEL_ID;
  try {
    const data = ensureDataLoaded();
    // Sub-checks are individually guarded → a failing one degrades to a
    // conservative value (llmReady:false) instead of failing the whole health.
    const llmReady = await probeLlmReady();
    const embedModelMatches = computeEmbedModelMatches(data.corpusEmbedModel);
    return {
      ready: true,
      chunks: data.chunksById.size,
      embeddings: data.embeddings.length,
      loadedAt: new Date(data.loadedAt).toISOString(),
      paths: {
        chunks: CHUNKS_FILE,
        embeddings: EMBEDDINGS_FILE,
      },
      llmReady,
      embedModel: data.corpusEmbedModel,
      queryEmbedModel,
      embedModelMatches,
      kbBuiltAt: data.kbBuiltAt,
      chunkCount: data.chunksById.size,
      staleDays: wholeDaysSince(data.kbBuiltAt),
      lastAutosyncEvalGate: readLastAutosyncEvalGate(),
      vramDefer: readVramDefer(),
    };
  } catch {
    return {
      ready: false,
      chunks: 0,
      embeddings: 0,
      paths: {
        chunks: CHUNKS_FILE,
        embeddings: EMBEDDINGS_FILE,
      },
      llmReady: false,
      embedModel: null,
      queryEmbedModel,
      lastAutosyncEvalGate: readLastAutosyncEvalGate(),
      vramDefer: readVramDefer(),
      embedModelMatches: true,
      kbBuiltAt: null,
      chunkCount: 0,
      staleDays: null,
    };
  }
}

export function reloadKbArtifacts(): Promise<KbHealth> {
  dataCache = null;
  embedModelMismatchWarned = false; // W0.3 — allow the mismatch warning to re-fire after a rebuild.
  return getKbHealth();
}

// C3a — resolve reply language. Strong signal from the question text wins; for
// ambiguous questions (no script/keyword signal → defaults to "en") we fall
// back to the UI language hint so a Chinese UI gets Chinese replies even when
// the user types code/identifiers only.
function resolveLanguage(question: string, context?: KbQueryContext): KbLanguage {
  const detected = detectLanguage(question);
  const ui = context?.uiLanguage;
  // detectLanguage returns "en" both for genuine English and for ambiguous
  // input (codes/numbers). Only override when it fell through to "en" AND the
  // question carries no Latin letters (i.e. no real English words).
  if (detected === "en" && ui && ui !== "en" && !/[a-z]{3,}/i.test(question)) {
    return ui;
  }
  return detected;
}

// C3a — map a FE route to coarse KB feature/source keywords. Only a few
// high-traffic routes are mapped; unmapped routes return [] (no boost).
const ROUTE_FEATURE_HINTS: Record<string, string[]> = {
  "/machine-health": ["machine", "health", "oee", "maintenance"],
  "/machine-status": ["machine", "status", "heartbeat"],
  "/oee-dashboard": ["oee"],
  "/products": ["product", "model", "measurement"],
  "/spc-analysis": ["spc", "control", "cpk"],
  "/production-orders": ["production", "order", "lot"],
  "/reports": ["report"],
  "/alerts": ["alert"],
};
function routeToFeatureHints(route: string): string[] {
  const path = route.split("?")[0]?.replace(/\/+$/, "") || "/";
  return ROUTE_FEATURE_HINTS[path] ?? [];
}

// ─── GraphRAG 1-hop expansion (doc 11 follow-up) ──────────────────────────────
// Flag-gated, additive, fail-safe widening of the cosine candidate pool with
// 1-hop neighbours from the precomputed semantic graph (knowledge/
// semantic-graph.json). Default OFF → behavior is byte-for-byte the legacy path
// (a single cheap boolean check). When ON, after the cosine candidates are
// scored+deduped we take the top KB_GRAPHRAG_SEEDS seeds and inject up to
// KB_GRAPHRAG_HOPS_PER_SEED neighbours each (edge similarity ≥ KB_GRAPHRAG_MIN_SIM)
// into the pool BEFORE the reranker takes its slice, capped at KB_GRAPHRAG_MAX_INJECT
// total. Injected neighbours get a blended score (seedScore × edge.similarity ×
// KB_GRAPHRAG_DECAY) so they compete in the reranker pool without outranking true
// cosine hits. Env (all optional; defaults match the doc):
//   KB_GRAPHRAG_ENABLED=false        — master switch (default OFF)
//   KB_GRAPHRAG_SEEDS=5              — top candidates used as expansion seeds
//   KB_GRAPHRAG_HOPS_PER_SEED=3      — max neighbours pulled per seed
//   KB_GRAPHRAG_MIN_SIM=0.72         — min edge similarity to follow
//   KB_GRAPHRAG_DECAY=0.85           — blended-score decay for injected neighbours
//   KB_GRAPHRAG_MAX_INJECT=8         — hard cap on total injected (bounds prompt size)
// Debug: set KB_GRAPHRAG_DEBUG=true to log how many neighbours were injected.
const KB_GRAPHRAG_ENABLED = (process.env.KB_GRAPHRAG_ENABLED ?? "false").toLowerCase() === "true";
function graphRagOpts() {
  return {
    seeds: Number(process.env.KB_GRAPHRAG_SEEDS ?? 5),
    hopsPerSeed: Number(process.env.KB_GRAPHRAG_HOPS_PER_SEED ?? 3),
    minSim: Number(process.env.KB_GRAPHRAG_MIN_SIM ?? 0.72),
    decay: Number(process.env.KB_GRAPHRAG_DECAY ?? 0.85),
    maxInject: Number(process.env.KB_GRAPHRAG_MAX_INJECT ?? 8),
  };
}

// doc69 B3 (Wave 5) — shared empty instance used when the feedback-rerank flag is
// off, so retrieveKnowledge never allocates a Map on the (default) disabled path.
const EMPTY_FEEDBACK_MAP: ReadonlyMap<string, number> = new Map();

/**
 * ★★★ doc 79 · TRỤC 1 (D) — VÁ LIVE 2026-08-20. **THU HẸP KHO TRƯỚC KHI XẾP HẠNG.**
 *
 * ─── VÌ SAO PHẢI Ở ĐÂY, KHÔNG PHẢI LỌC SAU ────────────────────────────────────────────────────
 * Phép đo (đường sản phẩm đầy đủ: embed 0.6B + keyword + trọng số + rerank gguf, `topK=8`):
 *
 *   câu hỏi                                         │ top-1 │ snippet thuộc vùng MÃ
 *   ────────────────────────────────────────────────┼───────┼──────────────────────
 *   "hệ thống này xác thực người dùng như thế nào?" │ 0,531 │ **0 / 8**
 *   "phân quyền RBAC trong repo này hoạt động ra sao?"│0,590│ **0 / 8**
 *   "luồng ingest ảnh AOI … đi qua những bước nào?" │ 0,794 │ **0 / 8**
 *
 * Kho có 7.582 chunk, trong đó `docs/**` + `apidocs/**` = 4.312 và chúng dài 1.500–1.800 ký tự
 * TIẾNG VIỆT do người viết, còn chunk MÃ là tóm tắt 114–166 ký tự TIẾNG ANH máy sinh
 * (*"Router file: … Procedure calls: 44"*). Một câu hỏi kiến trúc bằng tiếng Việt **không bao giờ**
 * thắng nổi phân bố ấy ⇒ **lọc SAU khi xếp hạng luôn trả về 0 tệp mã**, dù ngưỡng điểm là bao nhiêu.
 * Muốn có thứ hạng của tệp mã thì phải xếp hạng TRONG kho mã.
 *
 * ⚠ **KHÔNG có nhánh dự phòng "rỗng thì trả cả kho"** — một dự phòng như thế sẽ lặng lẽ trả chunk
 *   tài liệu cho một người gọi vừa xin ĐÚNG mã nguồn, tức mở lại chính cái lỗ này bằng cửa sau.
 *   Rỗng thì rỗng, và người gọi có `reason` để nói ra.
 */
export interface KbRetrieveOptions {
  /**
   * Chỉ xét chunk có `sourcePath` bắt đầu bằng MỘT trong các tiền tố này (so khớp không phân biệt
   * hoa/thường, `\` đã chuẩn hoá về `/`). Vắng/rỗng ⇒ TOÀN KHO, tức hành vi y hệt trước lượt này.
   *
   * ⚠ Cố ý **KHÔNG** nằm trong `KbQueryContext`: `KbQueryContext` là thứ `parseContext()` dựng từ
   *   body của `POST …/ask`. Một trục chọn kho là quyết định của SERVER, không phải của client.
   */
  sourcePathPrefixes?: readonly string[];
}

/**
 * Thu hẹp kho theo tiền tố đường dẫn. Trả về chính mảng gốc khi không có tiền tố nào.
 * ⚠ `export` để lưới đo được HÀM THUẦN này mà không phải nạp `embeddings.jsonl` 162 MB — không có
 *   người gọi nào ngoài `retrieveKnowledge`.
 */
export function locKhoTheoTienTo<T extends { sourcePath: string }>(
  ban: readonly T[],
  tienTo?: readonly string[],
): readonly T[] {
  const pre = (tienTo ?? [])
    .map((p) => String(p ?? "").replace(/\\/g, "/").trim().toLowerCase())
    .filter((p) => p !== "");
  if (pre.length === 0) return ban;
  return ban.filter((e) => {
    const p = String(e.sourcePath ?? "").replace(/\\/g, "/").toLowerCase();
    return p !== "" && pre.some((x) => p.startsWith(x));
  });
}

export async function retrieveKnowledge(
  question: string,
  topK = 5,
  context?: KbQueryContext,
  opts?: KbRetrieveOptions,
): Promise<KbRetrieveResult> {
  const data = ensureDataLoaded();
  const tokens = tokenize(question);
  const intent = classifyIntent(question);
  const language = resolveLanguage(question, context);
  const entities = extractEntities(question);

  // C3a — features hinted by the current route (light boost only).
  const routeFeatures = context?.route ? routeToFeatureHints(context.route) : [];

  // W0.3 (doc 11) — when the corpus embed-model differs from the query embed-model
  // (locked decision Q5: WARN + fall back, never hard-block), skip vector retrieval
  // entirely. A same-dimension/different-model vector would pass the length guard
  // but produce a CORRUPT cosine similarity, so keyword-only retrieval is safer.
  const embedModelMatches = computeEmbedModelMatches(data.corpusEmbedModel);
  const qVec = embedModelMatches ? await embedQuestion(question) : null;

  // doc69 B3 (Wave 5) — feedback-derived re-ranking signal. Flag-gated + fail-safe:
  // when disabled (default) this is a single boolean check and feedbackNetRatings
  // stays an empty Map, so feedbackWeight below is 1 for every source — the score
  // formula is BYTE-IDENTICAL to before this task. loadFeedbackNetRatings() itself
  // never throws (table-absent/DB-error/no-DB all degrade to an empty map).
  const feedbackRerankOn = isFeedbackRerankEnabled();
  const feedbackNetRatings = feedbackRerankOn ? await loadFeedbackNetRatings() : EMPTY_FEEDBACK_MAP;

  // ★ doc 79 · TRỤC 1 (D) — thu hẹp kho TRƯỚC khi chấm điểm (xem `KbRetrieveOptions`).
  const khoHepLai = (opts?.sourcePathPrefixes ?? []).length > 0;
  const khoXet = locKhoTheoTienTo(data.embeddings, opts?.sourcePathPrefixes);
  const scored = khoXet.map((emb) => {
    const chunk = data.chunksById.get(emb.id);
    if (!chunk) {
      return { emb, chunk: null as KbChunk | null, semantic: 0, keyword: 0, score: 0 };
    }

    const semantic = qVec ? cosine(qVec, emb.embedding) : 0;
    const keywordRaw = keywordScore(chunk, tokens, entities);
    const keyword = Math.tanh(keywordRaw / 15);
    const baseScore = qVec ? semantic * 0.72 + keyword * 0.28 : keyword;
    // Cycle-3: tilt ranking toward VN-language sources for VN questions (and
    // the reverse for EN), reducing the bias toward English-heavy docs
    // (CSHARP_CLIENT_UPLOAD_GUIDE, SERVER_PERFORMANCE_ASSESSMENT) that
    // previously dominated top-K for unrelated VN questions.
    const langWeight = sourceLanguageWeight(emb.sourcePath, language);
    // Cycle-4: prioritise authored end-user feature/domain guides over dev
    // artefact docs. Without this, large noisy reports (I18N_AUDIT_REPORT,
    // SYSTEM_AUDIT_REPORT) outrank the targeted feature MDs because they
    // happen to contain many literal UI strings.
    //
    // ★ G4-B — bảng nay ở `./aiKbSourceWeights` và ĐÃ THÊM hai hạng vốn không có tên trong đó:
    //   `operational` (162 thẻ vận hành, trước rơi về 1,00 — thấp hơn `domain`) và `playbook`
    //   (6 quy trình ứng cứu sự cố, hạng MỚI). `devJournalWeight` hạ `docs/superpowers/**` +
    //   `docs/ECOSYSTEM/**` (46% toàn kho là nhật ký phiên agent + thiết kế nội bộ).
    const typeWeight = sourceTypeWeight(emb.sourceType);
    const journalWeight = devJournalWeight(emb.sourcePath);
    // C3a — small boost for chunks whose source path matches a feature hinted
    // by the current route, so on-page questions surface page-relevant KB.
    // Kept gentle (×1.12) so it nudges ties without overriding real relevance.
    const routeWeight =
      routeFeatures.length > 0 && routeFeatures.some((f) => emb.sourcePath.toLowerCase().includes(f))
        ? 1.12
        : 1.0;
    // doc69 B3 (Wave 5) — light curation nudge from accumulated feedback votes on
    // this exact sourcePath. computeFeedbackWeight is BOUNDED (±5%, see
    // aiKbFeedbackSignal.ts) — deliberately smaller than the semantic weights
    // above (±8–18%) so feedback tunes, never dominates. 1 (no-op) when the flag
    // is off, no feedback exists for this source, or the signal failed to load.
    const feedbackWeight = feedbackRerankOn
      ? computeFeedbackWeight(feedbackNetRatings.get(emb.sourcePath) ?? 0)
      : 1;
    const score = baseScore * langWeight * typeWeight * journalWeight * routeWeight * feedbackWeight;

    return { emb, chunk, semantic, keyword, score };
  });

  // Drop low-relevance noise citations (kept the top-1 even if weak so the UI
  // never shows an empty list, but the LLM prompt only sees the strong ones).
  const MIN_CITATION_SCORE = 0.18;
  const sortedAll = scored
    .filter((r) => r.chunk)
    .sort((a, b) => b.score - a.score);
  // Cycle-3: dedupe near-identical chunks by capping each source file to at
  // most 2 chunks before slicing to topK, so the LLM doesn't see 5 paragraphs
  // from the same doc when other relevant sources exist.
  const PER_SOURCE_CAP = 2;
  const perSourceCount = new Map<string, number>();
  const deduped: typeof sortedAll = [];
  for (const r of sortedAll) {
    const sp = r.emb.sourcePath;
    const used = perSourceCount.get(sp) ?? 0;
    if (used >= PER_SOURCE_CAP) continue;
    perSourceCount.set(sp, used + 1);
    deduped.push(r);
  }
  const finalK = Math.max(1, Math.min(10, topK));

  // GraphRAG 1-hop expansion (flag-gated, additive, fail-safe). When OFF (default)
  // this is a single boolean check — `pool` below is exactly `deduped`, so the
  // reranker/top-K flow is byte-for-byte the legacy path. When ON, we inject the
  // strongest 1-hop neighbours of the top seeds into the pool so the reranker/LLM
  // sees semantically-linked context (multi-part docs, router↔schema cross-refs).
  // Any graph error is swallowed by loadSemanticGraph/expandWithGraph → expansion
  // is skipped, never thrown. Injected neighbours synthesize the same candidate
  // shape as a cosine hit, with semantic/keyword left 0 (their score is the
  // pre-blended graph score) so the downstream pipeline treats them uniformly.
  let pool = deduped;
  if (KB_GRAPHRAG_ENABLED && deduped.length > 0) {
    try {
      const adj = loadSemanticGraph();
      if (adj.size > 0) {
        const seedItems = deduped.map((r) => ({ id: r.emb.id, score: r.score, ref: r }));
        const expanded = expandWithGraph(
          seedItems,
          adj,
          graphRagOpts(),
          (id, score) => {
            // Only inject neighbours we actually have a chunk + embedding for;
            // otherwise the candidate can't be cited or reranked.
            const chunk = data.chunksById.get(id);
            if (!chunk) return null;
            const emb = data.embeddings.find((e) => e.id === id);
            if (!emb) return null;
            return {
              id,
              score,
              ref: { emb, chunk, semantic: 0, keyword: 0, score } as (typeof deduped)[number],
            };
          },
        );
        if (expanded.injected > 0) {
          pool = expanded.pool.map((c) => c.ref);
          if ((process.env.KB_GRAPHRAG_DEBUG ?? "").toLowerCase() === "true") {
            console.error(
              `[KB_GRAPHRAG] injected ${expanded.injected} neighbour(s) ` +
                `(pool ${deduped.length} → ${pool.length})`,
            );
          }
        }
      }
    } catch (err) {
      // Fail-safe: never let graph expansion break retrieval.
      if ((process.env.KB_GRAPHRAG_DEBUG ?? "").toLowerCase() === "true") {
        console.error("[KB_GRAPHRAG] expansion skipped (error):", err);
      }
      pool = deduped;
    }
  }

  // B2.2 — Reranker stage (flag-gated, fail-safe). When RAG_RERANKER_ENABLED is
  // on: take a wider candidate pool (cosine top-N), rerank by query relevance,
  // and reorder before the final topK slice. When off (default) this whole block
  // is skipped and `topSlice` is exactly the legacy cosine top-K — behavior is
  // unchanged. rerank() never throws (degrades to original order on any error).
  // NOTE: `pool` is `deduped` plus any GraphRAG-injected neighbours (identical to
  // `deduped` when the flag is OFF). The reranker draws its candidate pool from it
  // so injected neighbours can compete for the final top-K.
  let topSlice: typeof pool;
  // G0 phần C — null = tầng rerank không chạy cho lượt này (KHÁC 0 = chạy và nhanh).
  let rerankMs: number | null = null;
  if (isRerankerEnabled() && pool.length > 1) {
    const poolSize = Math.max(finalK, Number(process.env.RAG_RERANKER_POOL ?? 20));
    const rerankPool = pool.slice(0, poolSize);
    const candidates: RerankCandidate[] = rerankPool.map((r) => ({
      id: r.emb.id,
      title: r.emb.title,
      text: r.chunk ? r.chunk.text : "",
      score: r.score,
    }));
    // Đo TẠI ĐIỂM GỌI: đây là thời gian mà lượt hỏi này thật sự mất vì rerank
    // (bao gồm cả `await import("./aiGgufEngine")` lần đầu), khác với con số nội
    // bộ của aiReranker. `Date.now()` là đủ độ phân giải cho thang chục–nghìn ms
    // và không đòi thêm import nào ở module này.
    const tRerank = Date.now();
    const reranked = await rerank(question, candidates, finalK);
    rerankMs = Date.now() - tRerank;
    // Log CÓ CẤU TRÚC — chỉ số đếm và ms, KHÔNG câu hỏi, KHÔNG nội dung chunk.
    console.log(`[aiLocalKnowledge] rerank pool=${candidates.length} topK=${finalK} rerankMs=${rerankMs}`);
    const byId = new Map(rerankPool.map((r) => [r.emb.id, r]));
    const reordered = reranked
      .map((rr) => byId.get(rr.candidate.id))
      .filter((r): r is (typeof rerankPool)[number] => Boolean(r));
    // Guard: if the rerank somehow returned nothing usable, fall back to cosine.
    topSlice = reordered.length > 0 ? reordered : pool.slice(0, finalK);
  } else {
    topSlice = pool.slice(0, finalK);
  }

  const ranked = topSlice.filter((r, idx) => idx === 0 || r.score >= MIN_CITATION_SCORE);

  const citations: KbCitation[] = ranked.map((r) => ({
    id: r.emb.id,
    sourcePath: r.emb.sourcePath,
    title: r.emb.title,
    sourceType: r.emb.sourceType,
    score: Number(r.score.toFixed(6)),
    // doc69 B3 (Wave 5) — deep-link route, resolved ONLY for a KNOWN operational
    // card whose route passes the ALLOWED_CLIENT_ROUTES whitelist; null otherwise
    // (doc/feature/domain sources have no client viewer route today — the FE
    // renders those as plain, non-clickable text, honest about what's real).
    route: resolveCitationRoute({ sourceType: r.emb.sourceType, sourcePath: r.emb.sourcePath }),
  }));

  const contexts = ranked.map((r) => (r.chunk ? r.chunk.text : ""));
  // `let`, not `const` — final-fix round (I-1, IMPORTANT) recomputes these below when the
  // Studio merge block actually changes `citations`' order/contents. See that block for why.
  let top1 = ranked[0]?.score ?? 0.25;
  let top2 = ranked[Math.min(1, ranked.length - 1)]?.score ?? 0.2;
  let confidence = clamp01((top1 + top2) / 1.6);

  // Wave 2 đường B — bổ sung nguồn "tài liệu người dùng nạp" (kho Training Studio).
  // Kho này ĐÃ có searchCorpus() (server/services/kbVectorStore.ts:180) nhưng chưa
  // từng có caller ⇒ tài liệu nạp vào không bao giờ tới được trợ lý. Bổ sung, KHÔNG
  // thay thế: mọi lỗi ⇒ giữ nguyên kết quả corpus file (citations/contexts ở trên).
  // Chỉ chạy khi qVec khác null — nếu embed-model của corpus lệch (guard
  // computeEmbedModelMatches ở trên đã từ chối vector), không có cách so khớp hợp lệ
  // với kho Studio nên bỏ qua nhánh này, KHÔNG nhúng lại (embedQuestion) lần hai.
  //
  // Final-fix round, Task 6 (SECURITY) — gate ĐẶT NGAY TẠI CHỖ MỘT (retrieveKnowledge là
  // choke-point DUY NHẤT gọi gatherStudioHits — xem kbStudioAccess.ts's header), thay vì lặp
  // lại kiểm quyền ở từng caller (answerQuestion/streamAnswer/API endpoint/RCA copilot/
  // repoContextService…). `canAccessStudioCorpus` fail-closed: role thiếu/không nhận diện được
  // ⇒ điều kiện `if` dưới đây SAI ⇒ toàn bộ khối trộn bị bỏ qua HỆT như khi kho Studio rỗng —
  // citations/contexts/confidence giữ nguyên kết quả nguồn hệ thống, không có cách nào phân
  // biệt "bị chặn quyền" với "kho rỗng" từ output (KHÔNG rò rỉ sự tồn tại — yêu cầu sản phẩm).
  // ★ doc 79 · TRỤC 1 (D) — `khoHepLai` PHẢI chặn cả nhánh này. Kho Studio là tài liệu người dùng
  // NẠP LÊN (`h.sourceRef` không phải đường dẫn trong repo), nên trộn nó vào một lượt truy hồi đã
  // xin ĐÚNG vùng mã nguồn là phá chính điều kiện vừa được cấp — và phá NGẦM, vì citation Studio
  // đứng lẫn trong cùng một mảng. Kho hẹp ⇒ bỏ qua, y như khi kho Studio rỗng.
  if (qVec && !khoHepLai && canAccessStudioCorpus(context?.callerRole)) {
    try {
      const { gatherStudioHits } = await import("./aiLocalKnowledgeStudio");
      const studioHits = await gatherStudioHits(qVec, topK);
      // Vòng sửa 1 (review) — cùng ngưỡng lọc nhiễu MIN_CITATION_SCORE áp dụng cho nguồn
      // hệ thống (khai báo ở trên, KHÔNG khai hằng số thứ hai) cũng phải áp cho nguồn
      // Studio: nếu không, chỉ cần kho có BẤT KỲ tài liệu nào, cái khớp-nhất-trong-đám-tệ
      // vẫn được nêu như trích dẫn hợp lệ (nhãn "Tài liệu bạn nạp") và nhồi vào prompt LLM
      // — nhiễu trình bày như nguồn tin, đúng kiểu suy-giảm-không-trung-thực wave này sinh
      // ra để chữa. Không áp luật "giữ top-1 dù yếu" cho Studio: nguồn hệ thống đã đảm bảo
      // câu trả lời không bao giờ trống trích dẫn, Studio chỉ nên góp mặt khi thật sự đạt.
      let mergedStudioCount = 0;
      for (const h of studioHits) {
        if (!(h.score >= MIN_CITATION_SCORE)) continue;
        citations.push({
          id: `studio:${h.corpus}:${h.id}`,
          sourcePath: h.sourceRef,
          title: h.sourceRef,
          sourceType: "studio",
          score: h.score,
          origin: "studio",
        });
        contexts.push(h.text);
        mergedStudioCount++;
      }
      // Vòng sửa 1 (review) — LUÔN sắp lại theo điểm giảm dần khi có ít nhất 1 hit Studio
      // được trộn vào, KHÔNG CHỈ khi tổng số vượt finalK. Bug trước đó: nối-đuôi Studio sau
      // nguồn hệ thống khi KHÔNG vượt finalK (trường hợp phổ biến nhất) phá bất biến
      // "citations đã sắp best-first" (aiOperationalGrounding.ts:117) và khiến
      // buildExtractiveAnswer(:773) — vốn chỉ đọc citations[0]?.score để so
      // STRONG_MATCH_FLOOR — không bao giờ thấy một tài liệu Studio điểm cao nằm phía sau,
      // nên câu trả lời bị từ chối oan "không tìm thấy thông tin".
      // GIỮ ĐÚNG CẶP citations[i]<->contexts[i]: ghép (zip) citation với context CÙNG INDEX
      // thành 1 cặp TRƯỚC khi sort, sort nguyên cặp theo score, rồi tách (unzip) lại theo
      // ĐÚNG THỨ TỰ sau sort — không bao giờ sort 2 mảng song song một cách rời rạc.
      if (mergedStudioCount > 0) {
        const paired = citations.map((c, i) => ({ c, ctx: contexts[i] ?? "" }));
        paired.sort((a, b) => b.c.score - a.c.score);
        const trimmed = paired.slice(0, finalK);
        citations.length = 0;
        contexts.length = 0;
        for (const p of trimmed) {
          citations.push(p.c);
          contexts.push(p.ctx);
        }
        // Final-fix round (I-1, IMPORTANT) — `top1`/`top2`/`confidence` were computed ABOVE
        // from `ranked` (system sources only, BEFORE this merge) and never recomputed here, so
        // a strong Studio hit that reorders `citations` to the front never showed up in
        // `confidence` — the field kept scoring the pre-merge system-only world. Reviewer's
        // real probe: citations[0] = studio hit score 0.9, yet confidence stayed 0. Measured
        // consequences: (1) answerQuestion()'s `shouldUseLlm = retrieve.confidence >= 0.30`
        // (:2187) never fires the LLM for a question ONLY a user-uploaded doc can answer: (2)
        // buildExtractiveAnswer's STRONG_MATCH_FLOOR (:772) can refuse "no info" even though the
        // relevant paragraph is sitting right there in `contexts`; (3) the UI shows the lowest
        // confidence badge on an answer whose #1 citation is the user's own 0.9-scoring doc.
        // Recompute from `citations`/`trimmed` (already merged AND already sorted best-first —
        // see the comment above) using the EXACT SAME formula as above, so this is a pure
        // "read the right array" fix, not a new confidence model. Placed INSIDE this
        // `mergedStudioCount > 0` guard so the untouched (`else`) path — Studio corpus empty —
        // keeps computing confidence from `ranked` exactly as before, preserving the
        // system-only invariant verified by this file's own "kho Studio rỗng ⇒ kết quả y hệt
        // trước Task 4" test below.
        top1 = citations[0]?.score ?? top1;
        top2 = citations[Math.min(1, citations.length - 1)]?.score ?? top2;
        // Chốt cuối (post-Task-6 re-review), mục 1 — trộn thêm một nguồn KHÔNG ĐƯỢC làm
        // confidence TỆ ĐI. Bug: khi CHỈ 1 citation hệ thống sống sót, công thức TRƯỚC khi
        // trộn nhân đôi nó làm top2 (`ranked[Math.min(1,0)] === ranked[0]` ở :1786-1787 phía
        // trên). Sau khi trộn, top2 ở đây đổi thành điểm Studio THẬT — thường THẤP HƠN điểm hệ
        // thống duy nhất đó (nếu cao hơn, nó đã chiếm vị trí top1) — nên công thức tính lại
        // một mình cho ra số THẤP HƠN giá trị nhân-đôi cũ dù vừa có THÊM một nguồn hợp lệ.
        // Đo được: 1 citation hệ thống 0.25 (không trộn: (0.25+0.25)/1.6=0.3125 ≥ 0.30) + hit
        // Studio 0.18 (không trộn công thức lại: (0.25+0.18)/1.6=0.26875 < 0.30) — bổ sung
        // MỘT NGUỒN HỢP LỆ lại tắt luôn LLM. `Math.max` với confidence TRƯỚC khi trộn (biến
        // `confidence` đã có sẵn từ dòng 1786-1788) đảm bảo chỉ NÂNG, không bao giờ HẠ — khi
        // Studio thực sự tốt hơn (điểm cao hơn công thức nhân-đôi cũ), giá trị THẬT vẫn thắng
        // (Math.max chọn số lớn hơn, không phải "giữ nguyên số cũ vô điều kiện").
        confidence = Math.max(confidence, clamp01((top1 + top2) / 1.6));
      }
    } catch {
      // Nhánh Studio hỏng KHÔNG được làm hỏng trợ lý đang chạy — citations/contexts
      // giữ nguyên kết quả corpus file đã tính ở trên.
    }
  }

  return {
    question,
    intent,
    language,
    entities,
    confidence: Number(confidence.toFixed(4)),
    citations,
    contexts,
    rerankMs,
  };
}

// Final-fix round, Task 6 (SECURITY) — `studioEligible` added to the cache key. WHY: this cache
// is keyed on `userRole`, the "tone" role (worker/engineer/manager/it_admin — see this file's
// own `UserRole`, NOT the RBAC role), and MULTIPLE distinct real RBAC roles collapse onto the
// SAME tone value (mapAppRoleToAiRole in aiChatRouter.ts: "quality_inspector" AND "maintenance"
// AND "engineer" all map to tone "engineer"). Without this, a Studio-ineligible caller
// (e.g. real role "maintenance") could receive a CACHED KbAnswerResult that an eligible caller
// (real role "engineer", same tone "engineer", same question) produced moments earlier WITH
// Studio citations baked into `answer`/`citations`/`contexts` — bypassing the gate entirely via
// the cache, independent of and in addition to the retrieveKnowledge()-level fix. Incorporating
// eligibility into the key means an ineligible and an eligible caller can never share a cache
// entry, regardless of tone-role collisions.
// Exported for direct unit testing of the collision fix above (kept internal-use elsewhere —
// answerQuestion/streamAnswer are this module's only real callers).
export function getCacheKey(question: string, topK: number, userRole: UserRole = "engineer", studioEligible = false): string {
  return `${userRole}|${normalizeText(question)}|k=${topK}|studio=${studioEligible ? 1 : 0}`;
}

export async function answerQuestion(
  question: string,
  topK = 5,
  history: ConversationMessage[] = [],
  userRole: UserRole = "engineer",
  context?: KbQueryContext,
  execCtx?: ToolExecContext,
): Promise<KbAnswerResult> {
  const userLevel = rolToUserLevel(userRole);
  // Final-fix round, Task 6 (SECURITY) — `kbContext` carries the REAL RBAC role
  // (execCtx.user.role, the authenticated session — never the `userRole` "tone" param above,
  // which is spoofable on POST .../ask) into every retrieveKnowledge() call below, so the
  // Studio-corpus gate (canAccessStudioCorpus, inside retrieveKnowledge) sees who's actually
  // asking. Deliberately a SEPARATE variable from `context`: `context` still goes to
  // tryExecuteTool() unchanged (read-tool routing has nothing to do with this gate).
  const kbContext: KbQueryContext | undefined = execCtx?.user?.role
    ? { ...context, callerRole: execCtx.user.role }
    : context;
  const studioEligible = canAccessStudioCorpus(execCtx?.user?.role);
  const key = getCacheKey(question, topK, userRole, studioEligible);
  const now = Date.now();

  // Step 1 — Try a real-time tool first. Tool answers must NOT be cached
  // because they reflect live database state.
  // G2-C — `tryExecuteToolLoop` uỷ quyền NGUYÊN VẸN cho `tryExecuteTool` khi cờ
  // `AI_TOOL_LOOP_ENABLED` TẮT (mặc định) ⇒ đường mặc định không đổi một byte nào.
  const toolExec = await tryExecuteToolLoop(question, context, execCtx);
  const toolResult = toolExec.result;
  const loop = toolExec.loop;
  const clarifyMessage = toolExec.decision.clarifyMessage ?? null;

  // GĐ2 — write-tool matched: short-circuit with the confirm card (propose) or
  // a localized RBAC refusal. No LLM, no cache.
  if (toolExec.pendingAction || toolExec.denied) {
    const retrieve = await retrieveKnowledge(question, topK, kbContext);
    const message = toolExec.denied
      ? toolExec.denied.message
      : toolExec.pendingAction!.summary;
    return {
      ...retrieve,
      answer: message,
      provider: "tool",
      cached: false,
      followUpSuggestions: [],
      toolResult: null,
      toolName: toolExec.decision.tool ?? null,
      pendingAction: toolExec.pendingAction ?? null,
      structured: extractStructuredResponse(message),
    };
  }

  // Short-circuit: if intent classifier asked for clarification, return it
  // immediately without invoking the LLM. This avoids hallucinated answers
  // for questions like "lô của tôi sao rồi?" that lack a concrete identifier.
  if (!toolResult && clarifyMessage) {
    const retrieve = await retrieveKnowledge(question, topK, kbContext);
    const followUpSuggestions = buildFollowUpSuggestions(retrieve.intent, retrieve.language);
    return {
      ...retrieve,
      answer: clarifyMessage,
      provider: "extractive",
      cached: false,
      followUpSuggestions,
      toolResult: null,
      toolName: null,
      structured: extractStructuredResponse(clarifyMessage),
    };
  }

  // Only use cache when there's no history AND no real-time tool was invoked.
  if (history.length === 0 && !toolResult) {
    const hit = answerCache.get(key);
    if (hit && hit.expiresAt > now) {
      return { ...hit.value, cached: true };
    }
  }

  const retrieve = await retrieveKnowledge(question, topK, kbContext);

  let provider: "ollama" | "extractive" | "tool" = "extractive";
  let answer = buildExtractiveAnswer(question, retrieve);

  // Step 2 — If we have live data, short-circuit when the tool's textSummary
  // is already substantial (Lever 8.B). LLM augmentation adds 10-15s latency
  // but rarely improves an already-grounded numeric/live-data answer. We
  // attach a brief KB nav hint footer to satisfy the "hasNavPath" rubric.
  // Fall back to LLM augmentation only when textSummary is thin.
  // G2-C — khối đưa vào prompt: nhiều vòng thì lấy khối ĐÃ BỌC của vòng lặp, một vòng thì bọc
  // tại đây bằng CHÍNH cặp primitive đó. `toolInj` là rủi ro tiêm để nói thật ở cuối.
  const bocMotVong = bocDuLieuTool(toolResult?.textSummary, `tool:${toolExec.decision.tool ?? "?"}`);
  const toolPromptBlock = loop?.promptBlock ?? bocMotVong.block;
  const toolInjRisk: InjectionRisk = loop ? (loop.injection ? "high" : "none") : bocMotVong.risk;

  if (toolResult) {
    const summary = toolResult.textSummary || "";
    const TOOL_SHORTCIRCUIT_MIN = Number(process.env.KB_TOOL_SHORTCIRCUIT_MIN ?? 150);
    // ⚠ Đường tắt "textSummary đã đủ dài thì khỏi gọi LLM" CHỈ đúng cho MỘT vòng. Với nhiều vòng,
    // giá trị nằm ở phép TỔNG HỢP giữa các vòng (Pareto + nguyên nhân), mà đường tắt thì trả về
    // NGUYÊN VĂN kết quả vòng CUỐI — tức vứt bỏ đúng thứ vòng lặp vừa đi lấy.
    const daDaBuoc = (loop?.rounds.length ?? 0) > 1;
    // ★ G3-C VIỆC 2 — CỔNG THỨ TÁM, đứng TRƯỚC phép so độ dài (xem `toolKhongCoGiDeNoi`):
    // tool đã nói bằng trạng thái có cấu trúc rằng nó không có gì ⇒ trả thẳng câu ấy, KHÔNG
    // đưa cho LLM diễn giải một cái rỗng.
    const khongCoGiDeNoi = toolKhongCoGiDeNoi(toolResult, loop?.rounds.length ?? 1);
    if (khongCoGiDeNoi || (!daDaBuoc && summary.length >= TOOL_SHORTCIRCUIT_MIN)) {
      provider = "tool";
      answer = appendNavHint(summary, retrieve);
    } else {
      try {
        const llmAnswer = await generateWithOllama(
          question,
          retrieve,
          history,
          userLevel,
          toolPromptBlock,
          execCtx?.user?.id,
        );
        if (llmAnswer) {
          provider = "ollama";
          answer = llmAnswer;
        } else {
          provider = "tool";
          answer = appendNavHint(summary, retrieve);
        }
      } catch {
        provider = "tool";
        answer = appendNavHint(summary, retrieve);
      }
    }
    // Stage 11a — also append extractive hints footer for tool answers.
    // `force=true` so this fires even when intent=general (typical for
    // P2 operator-experienced live-data questions).
    answer = appendHintsFooter(answer, retrieve, true);
  } else if (retrieve.confidence >= 0.30) {
    try {
      const llmAnswer = await generateWithOllama(question, retrieve, history, userLevel, undefined, execCtx?.user?.id);
      if (llmAnswer) {
        provider = "ollama";
        answer = llmAnswer;
      }
    } catch {
      if (retrieve.citations.length === 0) {
        answer = buildGracefulFallback(retrieve.language);
      }
    }
  } else if (retrieve.citations.length === 0) {
    answer = buildGracefulFallback(retrieve.language);
  }

  const followUpSuggestions = buildFollowUpSuggestions(retrieve.intent, retrieve.language);

  // Lever 10 — extractive footer for technical answers missing concrete refs.
  // (Tool branch already applied its own footer above with force=true.)
  if (provider === "ollama" || provider === "extractive") {
    answer = appendHintsFooter(answer, retrieve);
  }

  // doc69 G2-7 — "ask→do": attach a 1-tap navigate action when this is a how-to
  // answer grounded in a KNOWN, whitelisted operational card. Fail-safe (null on
  // any non-match); see aiOperationalGrounding.ts for the full gating.
  const clientAction = resolveOperationalNavigate(
    { intent: retrieve.intent, language: retrieve.language, citations: retrieve.citations },
    { execCtx },
  );

  // ★ G2-C — BA CÂU NÓI THẬT, nối vào CUỐI câu trả lời (client hiện chỉ render `answer`, nên một
  // trường DTO mới sẽ vô hình; nối vào chuỗi là cách duy nhất người dùng thật sự THẤY).
  answer = themCanhBao(answer, retrieve.language, {
    toolError: toolExec.error ?? null,
    toolName: toolExec.decision.tool ?? null,
    toolInjRisk,
    kbInjRisk: quetNguCanhKb(retrieve),
    loop,
  });

  // ★ HOÁ ĐƠN TRUY XUẤT NGUỒN GỐC cho số liệu sống. Dựng SAU `themCanhBao` để dòng
  // nguồn nằm ở cuối cùng, và TRƯỚC `extractStructuredResponse` để cấu trúc phản ánh
  // đúng chuỗi cuối. `null` (⇒ không nối gì, `dataCitations: []`) khi không có tool
  // hoặc khi tool trả kèm `note` — cửa fail-closed chống rò RBAC.
  const dataCitation = buildDataCitation(toolExec.decision.tool, toolResult, toolExec.decision.args);
  answer = themChanNguonSoLieu(answer, dataCitation, retrieve.language);
  // Phép đo, KHÔNG phải cổng: đánh dấu số không tìm được nguồn để báo cáo/quan sát.
  const numberCheck = toolResult ? reconcileAnswerNumbers(answer, toolResult) : null;

  const result: KbAnswerResult = {
    ...retrieve,
    answer,
    provider,
    cached: false,
    followUpSuggestions,
    toolResult: toolResult ?? null,
    toolName: toolExec.decision.tool ?? null,
    structured: extractStructuredResponse(answer),
    clientAction,
    toolLoop: loop
      ? { rounds: loop.rounds.length, stop: loop.stop, tokensUsed: loop.tokensUsed, elapsedMs: loop.elapsedMs }
      : null,
    dataCitations: dataCitation ? [dataCitation] : [],
    numberCheck,
  };

  // Cache only stable (non-tool, no-history) answers.
  if (history.length === 0 && !toolResult) {
    answerCache.set(key, {
      expiresAt: now + ANSWER_CACHE_TTL_MS,
      value: result,
    });
  }

  return result;
}

// ─── Streaming orchestrator ───────────────────────────────────────────────
// Mirrors `answerQuestion` pipeline but yields events as they happen so the
// UI can render the LLM output token-by-token. This drastically reduces the
// time-to-first-token the user perceives (no waiting for the full answer
// before any text appears).
export type StreamEvent =
  | {
      type: "meta";
      intent: KbIntent;
      language: KbLanguage;
      confidence: number;
      citations: KbCitation[];
    }
  | { type: "tool"; toolName: string | null; toolResult: ToolResult }
  | { type: "pending_action"; toolName: string | null; pendingAction: PendingActionDTO }
  | { type: "client_action"; toolName: string | null; clientAction: ClientActionDirective }
  // GĐ3b — multi-step agentic orchestrator events (forward-compat; the primary
  // wiring is via the tRPC aiAgent router response, not this stream).
  | { type: "agent_plan"; sessionId: string; plan: { steps: Array<{ kind: string; tool?: string | null; rationale?: string }> } }
  | { type: "agent_step"; sessionId: string; index: number; kind: string; status: string; actionId?: string | null }
  /**
   * G2-C — TRẠNG THÁI TRUNG GIAN của vòng lặp tool. Người dùng phải thấy nó đang làm gì thay vì
   * ngồi nhìn màn hình đứng im tới 20 s. THÊM MỚI và không thay thế gì: một consumer SSE cũ
   * `switch` theo `type` sẽ bỏ qua sự kiện lạ (client thuộc quyền một agent khác trong đợt này).
   */
  | { type: "tool_loop"; round: number; phase: "dang_goi" | "xong" | "dung"; toolName: string | null; elapsedMs: number; stop?: string }
  | { type: "token"; token: string }
  | {
      type: "done";
      provider: "ollama" | "extractive" | "tool";
      cached: boolean;
      followUpSuggestions: string[];
      answer: string;
      structured?: KbStructuredResponse;
      /**
       * FE-W0.3 (doc 46 §2.3) — true when the streamed LLM output was rejected as
       * a degenerate loop and `answer` carries a clean fallback INSTEAD. The client
       * must REPLACE the accumulated streamed tokens with `answer` when this is set.
       */
      degraded?: boolean;
      degradedReason?: string;
      /** ★ Hoá đơn nguồn dữ liệu — THÊM MỚI, thuần bổ sung: consumer SSE cũ đọc
       *  `done` theo từng ô sẽ bỏ qua ô lạ mà không đổi hành vi. */
      dataCitations?: KbDataCitation[];
      /** ★ Phép đo đối chiếu số — CHỈ QUAN SÁT (xem `KbAnswerResult.numberCheck`). */
      numberCheck?: NumberReconciliation | null;
    };

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

async function* streamCodingAnswer(
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
  const yDinhTao = laYDinhTaoTep(question);
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
    if (answer.trim() !== "" && laCauCanSuyLuan(question)) {
      const sach = sanitizeUntrustedBlock(answer, { maxChars: TRAN_KY_TU_KET_QUA_TOOL });
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-23 · MỤC 2.4 — "ĐỌC TƯỜNG MINH" ≠ "CÂU CẦN SUY LUẬN"
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ *"Câu này đòi VĂN XUÔI về nội dung, hay đòi CHÍNH nội dung?"* — **MỘT vị từ THUẦN, đứng một
 * mình, có lưới riêng** (`aiCodingSuyLuan.unit.test.ts`).
 *
 * ─── SỰ VIỆC ĐO ĐƯỢC (nghiệm thu live) ────────────────────────────────────────────────────────
 * *"Giải thích lớp Calculator… và có lỗi gì"* → xong trong **0,100 giây**, **0 token**, và câu trả
 * lời là **nguyên văn tệp**. 5/7 lượt như vậy. Gốc rễ: trên đường lập trình, kết quả read tool được
 * trả **THẲNG cho người** (`yield {type:"token", token: answer}` rồi `done`) — model không đọc nó
 * trong lượt ấy, nên "giải thích" biến thành "dump".
 *
 * ─── QUYẾT ĐỊNH THIẾT KẾ (chủ dự án chốt) — VÀ VÌ SAO NÓ HẸP CÓ CHỦ Ý ─────────────────────────
 *   • Câu lệnh ĐỌC TƯỜNG MINH (*"đọc tệp X"*, *"liệt kê thư mục Y"*, *"grep Z"*) ⇒ **GIỮ NGUYÊN
 *     đường nhanh**. Nó đang ~0,4 giây và đó là hành vi ĐÚNG.
 *   • Câu CẦN SUY LUẬN ⇒ đưa kết quả tool **quay lại model** thêm một lượt để sinh văn xuôi.
 *   • Lý do trần trụi: áp cho MỌI lượt sẽ biến một lượt đọc 0,4 giây thành **3–5 phút** (model
 *     30B). Đó là đổi sai chiều.
 *
 * ⇒ Nên vị từ này là **DANH SÁCH CHO PHÉP HẸP, mặc định `false`**. Hai chiều hỏng KHÔNG đối xứng:
 *     − sót (`false` mà đáng `true`)  ⇒ người dùng nhận đúng thứ họ vẫn nhận hôm nay (một bản dump);
 *     − thừa (`true` mà đáng `false`) ⇒ một lượt đọc 0,4 s thành 30–300 s.
 *   Chiều đắt là chiều THỪA ⇒ khi phân vân thì **không nhận**.
 *
 * ⚠⚠ **VÌ SAO KHÔNG BẮT `cho biết có gì` / `có gì trong`**: đó là câu hỏi về **sự tồn tại của nội
 *   dung**, và bản dump trả lời nó ĐÚNG và NHANH. `codingToolIntent` + `aiCodingMode.stream.test.ts`
 *   §1 đã ghim hành vi ấy; đổi nó là đổi một thứ đang đúng.
 * ⚠ **VÌ SAO CÓ `tóm tắt`**: nó đòi một bản VIẾT LẠI ngắn hơn — một bản dump nguyên văn là câu trả
 *   lời SAI cho nó, đúng hình dạng lỗi live ở trên.
 * ⚠ Vị từ này **KHÔNG** đọc `laYDinhSuaTep`/`laYDinhTaoTep`: hai đường ấy đã rẽ đi từ trước (xem
 *   `streamCodingAnswer`), nên trộn chúng vào đây chỉ tạo một điều kiện không bao giờ đỏ được.
 */
export function laCauCanSuyLuan(question: string): boolean {
  const q = boDauVi(question);
  const vi =
    /(^|[^a-z])(giai thich|vi sao|tai sao|so sanh|doi chieu|phan tich|danh gia|nhan xet|ra soat|tom tat|dien giai)([^a-z]|$)/.test(q) ||
    // "có lỗi gì", "có bug nào", "có vấn đề gì", "sai chỗ nào" — hỏi về KHIẾM KHUYẾT, không hỏi nội dung.
    /(co|bi)\s+(loi|bug|van de|sai sot|rui ro)\s*(gi|nao|khong)?/.test(q) ||
    /(sai|hong|thieu)\s+(cho|o)\s+(nao|dau)/.test(q) ||
    /hoat dong (nhu the nao|ra sao)/.test(q);
  const en =
    /(^|[^a-z])(explain|why|compare|analyz|analys|review|assess|summari[sz]e|critique)([^a-z]|$)/i.test(q) ||
    /(any|what)\s+(bug|bugs|issue|issues|problem|problems|error|errors)\b/i.test(q) ||
    /what(?:'|’)?s\s+wrong\b/i.test(q) ||
    /how\s+does\s+.+\s+work/i.test(q);
  const zh =
    /(解释|说明一下|为什么|为何|比较|对比|分析|评估|审查|总结|摘要)/.test(question) ||
    /(有.{0,3}(问题|错误|缺陷|bug))/i.test(question) ||
    /(如何工作|怎么工作|工作原理)/.test(question);
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

  const it = rutChuCoCanh(
    streamCodingModel({
      systemPrompt: y.heThong,
      prompt: y.ghepPrompt(lich.khoi, bai, ma),
      maxTokens: y.tranToken,
      temperature: 0.15,
      // Phạt lặp làm hỏng việc chép lại NGUYÊN VĂN (thụt đầu dòng, `}` liên tiếp…) — và một đoạn
      // NEO cũng là một bản chép nguyên văn, nên đường khối cần đúng con số này.
      repeatPenalty: 1.0,
      userId: y.userId,
      // Chữ này SẼ được ghi ra đĩa ⇒ prompt phải tới model nguyên văn (xem `YeuCauSinhChu`).
      nguyenVanPrompt: true,
      // ★★★ 2026-08-23 — huỷ lan xuống model. Xem `YeuCauSinhChu.signal`.
      ...(y.signal ? { signal: y.signal } : {}),
    }),
  );

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
        const m = codingModelErrorMessage(y.language, e);
        yield { type: "token", token: (daPhat ? "\n\n" : "") + m };
        return { kq: "dung", traLoi: daPhat ? `${daPhat}\n\n${m}` : m, provider: "tool" };
      }
      if (n.done) {
        kq = n.value;
        break;
      }
      daPhat += n.value;
      yield { type: "token", token: n.value };
    }
  } finally {
    await it.return(undefined as unknown as KetQuaChu).catch(() => {});
  }

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
  const MAX_TOKENS_SINH = 3_000;

  /**
   * ★★★ doc 79 · TRỤC 1 (D) — NGỮ CẢNH MÃ THẬT. Đây là nơi *"AI mù kiến trúc khi sinh mã"* được vá.
   *
   * ⚠ Cửa đọc tiêm vào là `executeDecision({tool:"read_file"})` — **cửa DUY NHẤT**. Không có
   *   `fs` nào ở `codingRepoContext.ts`, nên hộp cát/RBAC/gốc-dự-án/che-bí-mật/trần-byte đều được
   *   thừa hưởng nguyên vẹn thay vì dựng lại bằng trí nhớ.
   * ⚠ `execCtx` VẮNG ⇒ không tiêm cửa nào ⇒ `khong-cua-doc` ⇒ khối rỗng. Đúng: không có phiên thì
   *   không có RBAC để đi qua, và đọc mã không RBAC là một đường thoát.
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
  let heThong = personaSinhMa(language, nguCanh, khoiMa !== "");
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

  const it = rutChuCoCanh(
    streamCodingModel({
      systemPrompt: heThong,
      prompt: promptSinhMa(question, language, lich.khoi, khoiMa, khoiBai),
      maxTokens: MAX_TOKENS_SINH,
      temperature: 0.25,
      userId: execCtx?.user?.id,
      // ★★★ 2026-08-23 — huỷ lan xuống model. Xem `motLuotModel` cho lý lẽ đầy đủ.
      ...(execCtx?.signal ? { signal: execCtx.signal } : {}),
    }),
  );

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
        const m = codingModelErrorMessage(language, e);
        yield { type: "token", token: (daPhat ? "\n\n" : "") + m };
        yield doneSinhMa(daPhat ? `${daPhat}\n\n${m}` : m, "tool");
        return "xong";
      }
      if (n.done) {
        kq = n.value;
        break;
      }
      daPhat += n.value;
      yield { type: "token", token: n.value };
    }
  } finally {
    await it.return(undefined as unknown as KetQuaChu).catch(() => {});
  }

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
  yield doneSinhMa(kq.text + chan, "ollama");
  return "xong";
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

export async function* streamAnswer(
  question: string,
  topK = 5,
  history: ConversationMessage[] = [],
  userRole: UserRole = "engineer",
  context?: KbQueryContext,
  execCtx?: ToolExecContext,
): AsyncGenerator<StreamEvent> {
  // ★★★ doc 79 · TRỤC 1 (B) — NHÁNH LẬP TRÌNH RIÊNG, đứng TRƯỚC MỌI logic vận hành.
  // Ràng buộc cứng nhất (doc 79 (C)): `codingMode` vắng/false ⇒ KHÔNG một byte nào dưới đây đổi. Nhánh
  // này KHÔNG chạm `tryExecuteToolLoop`/`retrieveKnowledge`/persona vận hành/cache — nó là một đường
  // đi hoàn toàn khác, nên bật/tắt cờ là một phép đo A/B sạch.
  if (context?.codingMode === true) {
    // ★★★ doc 81 · VIỆC 1 — `history` ĐÃ có sẵn ở đây từ trước; thứ thiếu là một tham số để nhận nó.
    yield* streamCodingAnswer(question, context, execCtx, history);
    return;
  }
  const userLevel = rolToUserLevel(userRole);
  // Final-fix round, Task 6 (SECURITY) — same reasoning as answerQuestion() above: `kbContext`
  // carries the REAL RBAC role into retrieveKnowledge()'s Studio gate; `context` (unchanged)
  // still drives tryExecuteTool().
  const kbContext: KbQueryContext | undefined = execCtx?.user?.role
    ? { ...context, callerRole: execCtx.user.role }
    : context;
  const studioEligible = canAccessStudioCorpus(execCtx?.user?.role);
  const key = getCacheKey(question, topK, userRole, studioEligible);
  const now = Date.now();

  // Real-time tool first (live DB state — must NOT be cached).
  // ★ G2-C — chạy vòng lặp và PHÁT trạng thái trung gian NGAY khi nó xảy ra. Một generator không
  // `yield` được từ trong callback, nên tiến độ đi qua một hàng chờ + một lời hứa "đánh thức";
  // vòng while dưới đây rút hàng chờ cho tới khi lượt tool xong. Không có nó thì người dùng ngồi
  // nhìn màn hình đứng im tới `AI_TOOL_LOOP_MAX_MS` — đúng thứ brief cấm.
  const hangCho: ToolLoopProgress[] = [];
  let danhThuc: (() => void) | null = null;
  let toolXong = false;
  const loiHuaTool = tryExecuteToolLoop(question, context, execCtx, (ev) => {
    hangCho.push(ev);
    danhThuc?.();
  });
  // `then(ok, err)` KHÔNG được để lại một nhánh reject chưa ai bắt (unhandled rejection giết
  // tiến trình dưới Node ≥15). `await loiHuaTool` phía dưới mới là nơi lỗi thật sự được xử lý.
  void loiHuaTool.then(
    () => {},
    () => {},
  ).then(() => {
    toolXong = true;
    danhThuc?.();
  });
  while (true) {
    while (hangCho.length > 0) {
      const ev = hangCho.shift()!;
      yield { type: "tool_loop", round: ev.round, phase: ev.phase, toolName: ev.tool, elapsedMs: ev.elapsedMs, stop: ev.stop };
    }
    if (toolXong) break;
    await new Promise<void>((r) => {
      danhThuc = () => {
        danhThuc = null;
        r();
      };
    });
  }
  const toolExec = await loiHuaTool;
  const toolResult = toolExec.result;
  const loop = toolExec.loop;
  const clarifyMessage = toolExec.decision.clarifyMessage ?? null;

  // GĐ2/GĐ3a — write-tool, client-tool, or refusal matched: emit meta +
  // (pending_action | client_action | refusal token) + done.
  if (toolExec.pendingAction || toolExec.clientAction || toolExec.denied) {
    const retrieve = await retrieveKnowledge(question, topK, kbContext);
    yield {
      type: "meta",
      intent: retrieve.intent,
      language: retrieve.language,
      confidence: retrieve.confidence,
      citations: retrieve.citations,
    };
    const message = toolExec.denied
      ? toolExec.denied.message
      : toolExec.clientAction
        ? toolExec.clientAction.message
        : toolExec.pendingAction!.summary;
    if (toolExec.pendingAction) {
      yield { type: "pending_action", toolName: toolExec.decision.tool ?? null, pendingAction: toolExec.pendingAction };
    }
    if (toolExec.clientAction) {
      yield { type: "client_action", toolName: toolExec.decision.tool ?? null, clientAction: toolExec.clientAction };
    }
    yield { type: "token", token: message };
    yield {
      type: "done",
      provider: "tool",
      cached: false,
      followUpSuggestions: [],
      answer: message,
      structured: extractStructuredResponse(message),
      // ⚠ `streamAnswer` có **BỐN** đường phát `done`. Ba đường ngắn (đây, làm-rõ, và
      // cache) đều KHÔNG THỂ mang số liệu sống — write/client-tool và từ chối RBAC trả
      // `result: null`, hai đường kia có `!toolResult` theo điều kiện nhánh. Vẫn khai
      // `[]`/`null` TƯỜNG MINH ở cả ba: một consumer đọc `done.dataCitations` mà nhận
      // `undefined` không phân biệt được "không có nguồn" với "trường chưa nối dây" —
      // và đó đúng là cách một đường thoát bị bỏ quên trốn thoát khỏi lưới.
      dataCitations: [],
      numberCheck: null,
    };
    return;
  }

  // Short-circuit clarification (mirrors answerQuestion).
  if (!toolResult && clarifyMessage) {
    const retrieve = await retrieveKnowledge(question, topK, kbContext);
    yield {
      type: "meta",
      intent: retrieve.intent,
      language: retrieve.language,
      confidence: retrieve.confidence,
      citations: retrieve.citations,
    };
    yield { type: "token", token: clarifyMessage };
    yield {
      type: "done",
      provider: "extractive",
      cached: false,
      followUpSuggestions: buildFollowUpSuggestions(retrieve.intent, retrieve.language),
      answer: clarifyMessage,
      structured: extractStructuredResponse(clarifyMessage),
      dataCitations: [],
      numberCheck: null,
    };
    return;
  }

  // Cached answer: emit meta + the full answer in a single token, done.
  if (history.length === 0 && !toolResult) {
    const hit = answerCache.get(key);
    if (hit && hit.expiresAt > now) {
      const v = hit.value;
      yield {
        type: "meta",
        intent: v.intent,
        language: v.language,
        confidence: v.confidence,
        citations: v.citations,
      };
      // doc69 G2-7 — a cached answer carries the SAME grounded navigate action it
      // was cached with (KbAnswerResult.clientAction), so repeat-asking a cached
      // how-to question still shows the 1-tap button on the SSE path.
      if (v.clientAction) {
        yield { type: "client_action", toolName: null, clientAction: v.clientAction };
      }
      yield { type: "token", token: v.answer ?? "" };
      yield {
        type: "done",
        provider: v.provider,
        cached: true,
        followUpSuggestions: v.followUpSuggestions ?? [],
        answer: v.answer ?? "",
        structured: v.structured ?? extractStructuredResponse(v.answer ?? ""),
        // Chuyển tiếp từ bản ghi cache thay vì gán cứng `[]`: cache CHỈ chứa lượt
        // không-tool (điều kiện ghi ở cuối hàm), nên hôm nay hai cách cho cùng kết
        // quả — nhưng nếu mai luật cache đổi, `?? []` vẫn nói đúng sự thật của bản
        // ghi, còn `[]` cứng sẽ lặng lẽ xoá hoá đơn của một câu trả lời có số liệu.
        dataCitations: v.dataCitations ?? [],
        numberCheck: v.numberCheck ?? null,
      };
      return;
    }
  }

  const retrieve = await retrieveKnowledge(question, topK, kbContext);

  yield {
    type: "meta",
    intent: retrieve.intent,
    language: retrieve.language,
    confidence: retrieve.confidence,
    citations: retrieve.citations,
  };

  // doc69 G2-7 — "ask→do": attach a 1-tap navigate action when this is a how-to
  // answer grounded in a KNOWN, whitelisted operational card. Resolved right
  // after retrieval (depends only on intent + citations, not on the generated
  // answer text) so the FE gets it as early as the explicit-command client_action
  // path does. Fail-safe (null on any non-match); see aiOperationalGrounding.ts.
  const groundedClientAction = resolveOperationalNavigate(
    { intent: retrieve.intent, language: retrieve.language, citations: retrieve.citations },
    { execCtx },
  );
  if (groundedClientAction) {
    yield { type: "client_action", toolName: null, clientAction: groundedClientAction };
  }

  if (toolResult) {
    yield {
      type: "tool",
      toolName: toolExec.decision.tool ?? null,
      toolResult,
    };
  }

  let provider: "ollama" | "extractive" | "tool" = "extractive";
  let accumulated = "";
  // FE-W0.3 (doc 46 §2.3) — set when the streamed output degenerated into a loop;
  // the streamed garbage is discarded and a clean fallback is sent on `done`.
  let streamDegraded = false;
  let streamDegradedReason: string | undefined;

  // ★ G3-C VIỆC 2 — CỔNG THỨ TÁM trên đường STREAM. Cùng vị từ, cùng lý lẽ (xem
  // `toolKhongCoGiDeNoi`). Một cổng an toàn chỉ áp cho `answerQuestion` mà bỏ `streamAnswer` là
  // đúng lớp lỗi "lưới theo FILE, không theo ĐƯỜNG THOÁT" — và `/stream` mới là đường người dùng
  // đi nhiều hơn. Chặn ở đây ⇒ khối fallback bên dưới trả `toolResult.textSummary` nguyên văn với
  // `provider: "tool"`, tức đúng thứ cổng này muốn: nói thật, không diễn giải cái rỗng.
  const shouldUseLlm =
    (!!toolResult || retrieve.confidence >= 0.30) &&
    !toolKhongCoGiDeNoi(toolResult, loop?.rounds.length ?? 1);

  // G2-C — cùng phép bọc như `answerQuestion` (xem `bocDuLieuTool`).
  const bocMotVong = bocDuLieuTool(toolResult?.textSummary, `tool:${toolExec.decision.tool ?? "?"}`);
  const toolPromptBlock = loop?.promptBlock ?? bocMotVong.block;
  const toolInjRisk: InjectionRisk = loop ? (loop.injection ? "high" : "none") : bocMotVong.risk;

  if (shouldUseLlm) {
    try {
      const iter = generateWithOllamaStream(
        question,
        retrieve,
        history,
        userLevel,
        toolPromptBlock,
        execCtx?.user?.id,
      );
      // FE-W0.3 (doc 46 §2.3) — incremental degenerate-loop guard: re-check the
      // accumulated text every STREAM_GUARD_STEP_CHARS once past the min, and BREAK
      // the moment it loops so we emit a handful of repeated tokens instead of
      // thousands. The client resets to the clean `answer` on the degraded `done`.
      let nextCheckAt = STREAM_GUARD_MIN_CHARS;
      for await (const piece of iter) {
        if (!piece) continue;
        accumulated += piece;
        yield { type: "token", token: piece };
        if (accumulated.length >= nextCheckAt) {
          nextCheckAt = accumulated.length + STREAM_GUARD_STEP_CHARS;
          if (isDegenerateStream(accumulated)) {
            streamDegraded = true;
            streamDegradedReason = "stream_loop";
            break;
          }
        }
      }
      if (streamDegraded) {
        // Discard the looped output; the fallback block below produces a clean answer.
        console.warn("[aiLocalKnowledge] degenerate stream detected — discarding looped output, sending clean fallback.");
        accumulated = "";
      } else if (accumulated.trim()) {
        // Final full-output guard (catches a loop that only crossed threshold at the tail).
        const g = guardGeneratedText(accumulated);
        if (g.degraded) {
          streamDegraded = true;
          streamDegradedReason = g.reason;
          accumulated = g.text.trim(); // salvaged head or "" → fallback block runs
          console.warn(`[aiLocalKnowledge] degenerate stream (final guard: ${g.reason}) — ${accumulated ? "using salvaged head" : "clean fallback"}.`);
        }
        if (accumulated.trim()) provider = "ollama";
      }
    } catch {
      // fall through to extractive/tool fallback below
    }
  }

  // Fallback when LLM was skipped or produced nothing.
  if (!accumulated.trim()) {
    if (toolResult) {
      provider = "tool";
      accumulated = toolResult.textSummary;
    } else if (retrieve.citations.length === 0) {
      accumulated = buildGracefulFallback(retrieve.language);
    } else {
      accumulated = buildExtractiveAnswer(question, retrieve);
    }
    yield { type: "token", token: accumulated };
  }

  // Stage 11c — apply extractive hints footer to streamed answer too.
  // Tool branch uses force=true (mirrors non-stream Stage 11a behavior).
  const footerForced = provider === "tool";
  const withFooter = appendHintsFooter(accumulated, retrieve, footerForced);
  if (withFooter !== accumulated) {
    const delta = withFooter.slice(accumulated.length);
    accumulated = withFooter;
    yield { type: "token", token: delta };
  }

  // ★ G2-C — BA CÂU NÓI THẬT trên đường STREAM cũng vậy, qua CHÍNH `themCanhBao` mà đường
  // non-stream dùng. Phát dưới dạng token để nó nằm ngay trong luồng chữ người dùng đang đọc.
  const withWarn = themCanhBao(accumulated, retrieve.language, {
    toolError: toolExec.error ?? null,
    toolName: toolExec.decision.tool ?? null,
    toolInjRisk,
    kbInjRisk: quetNguCanhKb(retrieve),
    loop,
  });
  if (withWarn !== accumulated) {
    const delta = withWarn.slice(accumulated.length);
    accumulated = withWarn;
    yield { type: "token", token: delta };
  }

  // ★ HOÁ ĐƠN TRUY XUẤT NGUỒN GỐC — ĐƯỜNG STREAM. Cùng hàm, cùng luật fail-closed như
  // `answerQuestion`. Một cổng chỉ áp cho đường non-stream là đúng lớp lỗi "lưới theo
  // FILE, không theo ĐƯỜNG THOÁT" — và `/stream` mới là đường người dùng đi nhiều hơn.
  // Phát dưới dạng token để dòng nguồn nằm ngay trong luồng chữ đang đọc.
  const dataCitation = buildDataCitation(toolExec.decision.tool, toolResult, toolExec.decision.args);
  const withNguon = themChanNguonSoLieu(accumulated, dataCitation, retrieve.language);
  if (withNguon !== accumulated) {
    const delta = withNguon.slice(accumulated.length);
    accumulated = withNguon;
    yield { type: "token", token: delta };
  }
  const numberCheck = toolResult ? reconcileAnswerNumbers(accumulated, toolResult) : null;

  const followUpSuggestions = buildFollowUpSuggestions(
    retrieve.intent,
    retrieve.language,
  );

  // Backfill the answer cache so the next identical question is instant.
  // FE-W0.3 (doc 46 §2.3) — NEVER cache a degraded/salvaged answer.
  if (history.length === 0 && !toolResult && provider !== "extractive" && !streamDegraded) {
    const cacheValue: KbAnswerResult = {
      ...retrieve,
      answer: accumulated,
      provider,
      cached: false,
      followUpSuggestions,
      toolResult: null,
      toolName: null,
      structured: extractStructuredResponse(accumulated),
      // doc69 G2-7 — persist the grounded navigate action (if any) so a cached
      // replay of this question (see the cached-answer branch above) still
      // yields client_action.
      clientAction: groundedClientAction,
    };
    answerCache.set(key, {
      expiresAt: now + ANSWER_CACHE_TTL_MS,
      value: cacheValue,
    });
  }

  yield {
    type: "done",
    provider,
    cached: false,
    followUpSuggestions,
    answer: accumulated,
    structured: extractStructuredResponse(accumulated),
    dataCitations: dataCitation ? [dataCitation] : [],
    numberCheck,
    // FE-W0.3 (doc 46 §2.3) — signal the client to REPLACE the streamed tokens
    // with `answer` when the LLM output was rejected as a degenerate loop.
    ...(streamDegraded ? { degraded: true, degradedReason: streamDegradedReason } : {}),
  };
}

// ─── Warm-up ──────────────────────────────────────────────────────────────
// Fire a tiny embed + generate request shortly after server boot so the
// Ollama models are already loaded into memory before the first user ask.
let warmupStarted = false;
export function warmUpOllamaModels(): void {
  if (warmupStarted) return;
  warmupStarted = true;
  setTimeout(() => {
    // doc 48 R1 — WARM ORDER FIX: make a GENERATIVE model resident BEFORE the RAG embedder.
    // The embedder warm below (embedQuestion) loads the small embedding model; if it lands first
    // it becomes the FIRST resident GGUF model, and any generate call that does NOT pin a model
    // (engine getOrLoadModel(undefined)) reuses it → gibberish narratives/chat. Warming the deep
    // model first also avoids VRAM fragmentation (load the large model before small ones; see
    // aiGgufEngine.warmModel docs / doc 34 §P4). Best-effort + fail-safe: if the deep model cannot
    // load (VRAM), warmModel returns false and the callers' honest-degrade guards still render the
    // offline template — never gibberish. Embedder is still warmed right after (RAG needs it).
    void (async () => {
      if (!USE_LEGACY_OLLAMA) {
        try {
          const { warmModel } = await import("./aiGgufEngine");
          // Basename sans ".gguf" — the engine appends it, matching the Model Router's basenames
          // so a later route({task:"report"|"chat"}).modelId pin finds this exact model resident.
          const deep = (process.env.GGUF_DEFAULT_MODEL || process.env.GGUF_FAST_MODEL || "")
            .trim()
            .replace(/\.gguf$/i, "");
          await warmModel(deep || undefined);
        } catch { /* best-effort — never blocks the embedder warm below */ }
      }
      // Keep the embedder warm too (RAG retrieval needs it resident).
      await embedQuestion("warmup").catch(() => {});
      /**
       * ★★★ doc 79 · TRỤC 1 (D) · VÁ LIVE 2026-08-20 — **LÀM ẤM CẢ ĐƯỜNG, KHÔNG CHỈ EMBEDDER.**
       *
       * Triệu chứng live: lượt hỏi ĐẦU TIÊN sau khi khởi động chết ở
       * `G2-A truy hồi chỉ mục repo QUÁ HẠN 20000 ms` ⇒ mất ngữ cảnh, model bịa.
       * Chẩn đoán: `embedQuestion("warmup")` ở trên **chỉ** nạp model nhúng. Nó KHÔNG chạm hai thứ
       * đắt còn lại, và cả hai đều nằm trên đường truy hồi:
       *   • `ensureDataLoaded()` — parse `knowledge/embeddings.jsonl` **162 MB** (7.582 vector);
       *   • **ngữ cảnh rerank gguf** — đo thật `ctxLoadMs = 11.278–13.743 ms`.
       * Cộng lại thì lượt NGUỘI vượt 20 s trong khi lượt ẤM chỉ 245–283 ms.
       *
       * ⇒ Chạy MỘT lượt `retrieveKnowledge` thật (topK=1) để cả ba thứ cùng ấm. Sau đó hạn giờ
       *   20 s không còn là thứ người dùng gặp — đó là cách chữa ĐÚNG, khác hẳn nới hạn giờ (nới chỉ
       *   biến "mất ngữ cảnh sau 20 s" thành "chờ 45 s rồi vẫn mất").
       * ⚠ Chạy SAU `warmModel(deep)` có chủ ý: thứ tự nạp VRAM (model lớn trước, model nhỏ sau) giữ
       *   nguyên như doc 48 R1 đã chốt. Best-effort, nuốt mọi lỗi: một máy chưa dựng chỉ mục
       *   (`Knowledge artifacts missing`) vẫn phải khởi động bình thường.
       */
      try {
        const t0 = Date.now();
        await retrieveKnowledge("warmup", 1);
        console.log(`[aiLocalKnowledge] làm ấm đường truy hồi (chỉ mục + embedder + rerank): ${Date.now() - t0} ms`);
      } catch (e) {
        console.warn("[aiLocalKnowledge] làm ấm đường truy hồi KHÔNG xong (bỏ qua):", (e as Error)?.message ?? e);
      }
    })().catch(() => {});
    // Legacy Ollama QA warm — a no-op unless USE_LEGACY_OLLAMA (nothing listens on the GGUF path).
    void fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_QA_MODEL,
        prompt: "ok",
        stream: false,
        keep_alive: LLM_KEEP_ALIVE,
        options: { num_predict: 1, temperature: 0 },
      }),
    }).catch(() => {});
  }, 2000);
}

// ─── B2.4 — Auto-ingest of RCA / ai_insight records ─────────────────────────
//
// Given a new RCA / insight text, chunk → embed (same mxbai 1024-d space) →
// append to knowledge/chunks.jsonl + embeddings.jsonl so future retrieval
// includes it (a self-enriching loop). FLAG-GATED (RAG_AUTO_INGEST_ENABLED,
// default OFF) and IDEMPOTENT: dedupes by a deterministic id derived from
// `sourceId`. Designed as a fire-and-forget hook — never throws to the caller.
//
// Vector-space consistency: embeds `title\ntext` via embedQuestionGguf (the same
// GGUF mxbai model + L2 normalization the corpus was built with) and writes rows
// with the SAME schema as generate-embeddings.mjs so the new vectors live in the
// same space and are picked up by ensureDataLoaded on next (re)load.

export function isAutoIngestEnabled(): boolean {
  return (process.env.RAG_AUTO_INGEST_ENABLED ?? "false").toLowerCase() === "true";
}

export interface IngestRecord {
  /** Stable source identifier (e.g. `rca:123`, `insight:abc`). Used for dedupe. */
  sourceId: string;
  title: string;
  text: string;
  /** Defaults to "incident". */
  sourceType?: string;
  /** Defaults to `ingest/<sourceType>/<sourceId>`. */
  sourcePath?: string;
  keywords?: string[];
}

function ingestChunkId(sourceId: string): string {
  // Deterministic id namespace so re-ingesting the same record is a no-op.
  return `ingest:${sourceId.replace(/\s+/g, "_")}`;
}

// In-process guard so a burst of identical hooks within one run doesn't race the
// file-existence dedupe (the on-disk check still covers cross-process dedupe).
const ingestedThisProcess = new Set<string>();

/**
 * Idempotently append a single RCA/insight record to the file-based KB.
 * Returns true if a new chunk+embedding was written, false if skipped
 * (already present, flag off, empty text, or embed failed). Never throws.
 */
export async function ingestKnowledgeRecord(rec: IngestRecord): Promise<boolean> {
  try {
    if (!isAutoIngestEnabled()) return false;
    const sourceId = (rec.sourceId ?? "").trim();
    const text = (rec.text ?? "").trim();
    const title = (rec.title ?? "").trim() || sourceId;
    if (!sourceId || !text) return false;

    const id = ingestChunkId(sourceId);
    if (ingestedThisProcess.has(id)) return false;

    // On-disk dedupe: scan existing chunk ids (cheap line scan). If present, skip.
    if (fs.existsSync(CHUNKS_FILE)) {
      const existing = fs.readFileSync(CHUNKS_FILE, "utf8");
      // Match the id as a JSON field to avoid false positives on substrings.
      if (existing.includes(`"id":"${id}"`)) {
        ingestedThisProcess.add(id);
        return false;
      }
    }

    // Embed `title\ntext` (corpus convention). embedQuestionGguf L2-normalizes
    // and dimension-guards (returns null on mismatch) → consistent vectors.
    const embedInput = `${title}\n${text}`;
    const vector = await embedQuestionGguf(embedInput);
    if (!vector) {
      console.warn(`[aiLocalKnowledge] auto-ingest: embedding unavailable for ${id}, skipping`);
      return false;
    }

    const sourceType = rec.sourceType ?? "incident";
    const sourcePath = rec.sourcePath ?? `ingest/${sourceType}/${sourceId}`;
    const hash = createHash("sha256").update(embedInput, "utf8").digest("hex");

    const chunkRow = {
      id,
      hash,
      sourceType,
      sourcePath,
      title,
      text,
      keywords: rec.keywords ?? [],
    };
    const embRow = {
      id,
      hash,
      sourceType,
      sourcePath,
      title,
      keywords: rec.keywords ?? [],
      textLength: text.length,
      embeddingDim: vector.length,
      embedding: vector,
    };

    // Append (newline-terminated) to both files.
    fs.appendFileSync(CHUNKS_FILE, JSON.stringify(chunkRow) + "\n", "utf8");
    fs.appendFileSync(EMBEDDINGS_FILE, JSON.stringify(embRow) + "\n", "utf8");
    ingestedThisProcess.add(id);

    // Patch the in-memory cache so retrieval sees the new chunk immediately
    // (without a full reload). Safe: same shapes as ensureDataLoaded builds.
    if (dataCache) {
      dataCache.chunksById.set(id, {
        id,
        sourceType,
        sourcePath,
        title,
        text,
        keywords: rec.keywords ?? [],
      });
      dataCache.embeddings.push({
        id,
        sourceType,
        sourcePath,
        title,
        keywords: rec.keywords ?? [],
        textLength: text.length,
        embeddingDim: vector.length,
        embedding: vector,
      });
    }

    console.log(`[aiLocalKnowledge] auto-ingested KB record ${id} (${sourcePath})`);
    return true;
  } catch (err) {
    console.warn("[aiLocalKnowledge] auto-ingest failed (non-fatal):", err);
    return false;
  }
}

/** Fire-and-forget wrapper for hook sites — never awaited, never throws. */
export function ingestKnowledgeRecordAsync(rec: IngestRecord): void {
  void ingestKnowledgeRecord(rec).catch(() => {});
}
