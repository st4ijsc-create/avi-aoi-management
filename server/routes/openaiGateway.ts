/**
 * OpenAI-compatible HTTP gateway — doc 34 §III.3(a) / §IV-P0 keystone.
 * ════════════════════════════════════════════════════════════════════════════
 *   GET  {base}/models              — list logical models (OpenAI models-list shape)
 *   POST {base}/chat/completions    — chat (stream + non-stream), OpenAI schema
 *   POST {base}/completions         — text completion + FIM (prompt/suffix), stream + non-stream
 *   POST {base}/embeddings          — embeddings (string | string[]), OpenAI shape
 *
 * WHY: the app exposes NO OpenAI-compatible API today (doc 34 §II.1 finding #4 —
 * "keystone thiếu"). This single serving layer unlocks BOTH the in-app copilot
 * AND external IDE tooling (VS Code + Continue) against the SAME local engine —
 * the "khớp nối vạn năng" of the Hybrid strategy (D1/D3). It is an in-process
 * SHIM over the existing GGUF engine (`aiGgufEngine`); the persistent llama-server
 * coder branch (prefix-cache / real FIM) is a separate P0 item and NOT required here.
 *
 * AUTH / GATING (fail-closed):
 *   • Mounted only when OPENAI_GATEWAY_ENABLED is truthy (default OFF).
 *   • Requires OPENAI_GATEWAY_API_KEY. Enabled + empty key ⇒ REFUSES to mount and
 *     logs a clear error — we NEVER expose an unauthenticated LLM endpoint.
 *   • Every request must carry `Authorization: Bearer <OPENAI_GATEWAY_API_KEY>`
 *     (constant-time compared). 401 otherwise.
 *   • ★★★ Đợt 4A (2026-10-17) — `Authorization: Bearer avgw_…` = TOKEN THEO NGƯỜI DÙNG (mig 0392, chỉ lưu băm):
 *     gắn userId vào đo lường/hạn mức, phạm vi theo đường (chat · fim · embed), trần/phút theo token, hết hạn/thu
 *     hồi ⇒ 401 có mã. Key chung ở trên GIỮ nhưng DEPRECATE (`OPENAI_GATEWAY_SHARED_KEY_ENABLED`, mặc định bật);
 *     tắt cờ ⇒ chế độ chỉ-token (gắn cổng không cần key). CORS của `/v1`: không bao giờ `*` (`xuLyCorsCongOpenAi`).
 *
 * BINDING NOTE: this is intended for localhost / trusted-LAN engineer use (IDE
 * autocomplete + chat). It inherits the app's listen address — do NOT expose the
 * app publicly with this enabled. Keep the app bound to localhost/LAN.
 * ════════════════════════════════════════════════════════════════════════════
 */
import express, {
  Router,
  type Request,
  type Response,
  type Express,
} from "express";
import { timingSafeEqual } from "node:crypto";
import { requireServiceIdentity } from "../services/security/requireServiceIdentity";
import { huyKhiClientBoDi } from "./_huyKhiClientBoDi"; // final wave item 2 — huỷ khi client bỏ đi (res.on("close"))
import {
  chatCompletion,
  chatCompletionStream,
  generateText,
  generateFim,
  generateEmbedding,
  generateEmbeddings,
  isGgufAvailable,
  type GgufChatMessage,
} from "../services/aiGgufEngine";
// doc69 G2-3 (Wave 1, W1-1b) — this gateway calls the GGUF engine directly, bypassing the
// AI Gateway entirely (zero safety, zero metering on the external IDE / API surface). Wire
// `planInference` in for safety (input/output redaction) + metering, WITHOUT letting the
// gateway's own routing decision override the model the caller explicitly requested via
// `body.model` (resolved by `resolveModelId` below) — this surface's contract is "you get
// the model you asked for", unlike the KB assistant's router-picked model. Reuses the G2-2
// primitives verbatim; no redaction logic is reimplemented here.
import {
  planInference,
  checkNamedRateLimit,
  RateLimitError,
  SafetyBlockedError,
  QuotaExceededError,
  LicenseGateError,
  type TaskKind,
  type GatewayPlan,
} from "../services/aiGateway";
// ★★★ Đợt 4A — TOKEN THEO NGƯỜI DÙNG (`avgw_…`, mig 0392). Tầng dữ liệu chỉ tra BĂM; module lá cho tiền tố/phạm vi.
import { xacThucTokenNguoiDung, ghiDungLanCuoi, type KetQuaXacThucToken } from "../db/aiGatewayTokens";
import { TIEN_TO_TOKEN, phamViCuaDuong } from "../services/ai/gatewayToken/maToken";
import { TU_CHOI_TOKEN, loaiLoiTheoMa } from "../services/ai/gatewayToken/tuChoiToken";
import { redactSecretsAndPII, StreamingSecretRedactor } from "../services/ai/aiSafety";
// ★ G5-E — bộ cắt chuỗi suy luận. Module LÁ (0 import, 0 I/O) nên import TĨNH được từ đây với chi
// phí ~0 ⇒ hàng rào là vô điều kiện theo CẤU TẠO, không phụ thuộc một `await import()` trong try.
// ⚠ THỨ TỰ BẮT BUỘC: cắt thẻ TRƯỚC — che bí mật SAU. Cắt thẻ là phép XOÁ nên nó NỐI LIỀN hai đoạn
// chữ vốn bị khối <think> tách rời; một khoá bị khối ấy chẻ đôi thì mỗi nửa đều DƯỚI ngưỡng
// `sk-[A-Za-z0-9]{16,}` ⇒ che trước = không khớp = nhả nguyên văn, rồi bộ cắt dán lại thành khoá
// hoàn chỉnh ra tới client. Bộ canh NỘI DUNG phải đứng CUỐI. Lưới:
// `openaiGateway.thinkingLeak.test.ts` §5 — đảo thứ tự ⇒ ĐỎ.
import { stripThinking, StreamingThinkingStripper } from "../services/ai/thinkingStrip";
// doc69 G2-5b — env→basename resolution now lives in ONE place (see modelResolver.ts's header
// for the full STEP 0 comparison / reconciliation notes, incl. the one deliberately-fixed "fim"
// fallback-chain drift vs. aiModelRouter.ts/aiGgufEngine.ts).
import { defaultModelBasename, resolveLogicalModel, toBasename } from "../services/ai/modelResolver";
import { kiemModelV1, thongDiepLoiChoKhachV1 } from "../services/ai/kiemModelV1";
import { cheDoKiemBienDichV1, kiemVaSuaST, nhanKiemBienDich, tranMsVongSuaST, type KetQuaKiemBienDichST } from "../services/ai/st/kiemBienDichSt";
import { auditKiemBienDich, headerKiemBienDich } from "../services/ai/st/auditKiemBienDich";
import { trichMaST } from "../services/ai/st/trichMaST";
import { chayVoiTokenKhe, chonModelKhiVuotTran, tokenKheHienTai, vuotTranDoiKhe } from "../services/ai/soModel/tranDoiKheToken";
import { laModelKheNangPhu, modelNhaKheNang } from "../services/ai/soModel/tapKheNang";
import { thongKeKheNang } from "../services/ai/soModel/kheNangMacDinh";
import { VAI_TRO_GOC } from "../../shared/aiRoles";
import { layAnhSoModel } from "../services/ai/soModel/anhSoModel";
import { laVaiTroSinhChu } from "../services/ai/soModel/dinhTuyenVaiTro";
import { laLoiToolCallTrongSuyLuan, laLoiTokenCanKietVaoSuyLuan } from "../services/aiLlamaServerClient";
// ★★★ G2-B — TOOL-CALLING GỐC. Module LÁ (0 import, 0 I/O, 0 env) — xem header của nó để biết
// BẰNG CHỨNG ĐO SỐNG rằng build `llama-server` đang chạy hỗ trợ `tools` gốc, và ba thứ nó KHÔNG làm.
//
// ⚠⚠ BẤT BIẾN AN NINH CỦA BỀ MẶT NÀY — ĐỌC TRƯỚC KHI SỬA:
// `/v1/chat/completions` là bề mặt **BYOT (bring-your-own-tools)**: `tools` do CHÍNH CALLER khai
// trong thân yêu cầu, và CHÍNH CALLER thực thi chúng rồi gửi kết quả lại qua message `role:"tool"`.
// Gateway **không bao giờ** thực thi một tool, và **không bao giờ** import registry 77 tool nội bộ.
// ⇒ Ba hàng rào của đường Agent nội bộ — `argsWithAuthCtx()` (xoá vô điều kiện `__authCtx` do model
//   bịa rồi gán lại từ phiên thật), HITL cho tool `kind:"write"`, và RBAC per-tool — **không nằm
//   trên đường này và cũng không bị đường này đi vòng**: chúng canh `tryExecuteTool()`, thứ mà
//   gateway không gọi. Bất biến ấy được canh THEO CẤU TẠO bằng một ca đọc mã nguồn
//   (`openaiGateway.nativeTools.test.ts` §8): thêm một `import … aiLocalTools/…` vào file này là
//   ĐỎ ngay. Đừng "tiện tay" nối registry vào đây — đó là đường vòng qua cả ba cổng cùng lúc.
import {
  chuanHoaTools,
  chuanHoaToolChoice,
  toolCallHopLe,
  timGioiHanGrammar,
  LoiToolCallKhongHopLe,
  LoiToolChoiceKhongCuongCheDuoc,
  type WireTool as NativeTool,
  type WireToolCall as NativeToolCall,
} from "../services/ai/nativeToolCalls";

// ─── Config helpers (read at call-time so flags flip without a module reload) ──

function envStr(name: string): string {
  return (process.env[name] || "").trim();
}
function envBool(name: string): boolean {
  const v = envStr(name).toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/**
 * Review fix (doc69 W1-1b follow-up) — mirrors `aiGateway.ts`'s PRIVATE (not exported)
 * `safetyEnabled()`/`envFlagDefaultOn("AI_SAFETY_ENABLED")`: same env var, same default-ON
 * semantics (unset/empty ⇒ true; only an explicit "0"/"false"/"no"/"off" disables it). Needed
 * locally because this gateway's `StreamingSecretRedactor` usage (below) was previously
 * ungated — the documented `AI_SAFETY_ENABLED=false` escape hatch disabled the non-stream
 * `plan.sanitizeOutput` path (gated inside `planInference`/`aiGateway.ts`) but NOT streaming
 * redaction on this surface. Duplicated rather than exported from aiGateway.ts to keep this
 * fix scoped to openaiGateway.ts only.
 */
function aiSafetyEnabled(): boolean {
  const raw = envStr("AI_SAFETY_ENABLED").toLowerCase();
  if (raw === "") return true;
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

/**
 * ★★★ G5-E — CHUỖI SUY LUẬN TRÊN MỘT API TƯƠNG THÍCH OPENAI: TÁCH Ô, KHÔNG DÁN INLINE.
 *
 * Bảy bề mặt nội bộ khác (thông báo, diễn giải SPC, lịch sản xuất…) chỉ có MỘT người tiêu thụ nên
 * cắt-và-bỏ là xong. `/v1` thì không: client bên thứ ba (Continue, Cline, IDE plugin) đọc theo hợp
 * đồng OpenAI, và các máy chủ suy luận (DeepSeek, vLLM, llama.cpp `--reasoning-format`) đã hội tụ
 * về một ô RIÊNG cho nội tâm model — `message.reasoning_content` / `delta.reasoning_content`.
 *
 * QUYẾT ĐỊNH:
 *   • `content` (chat) và `text` (completions) **LUÔN sạch thẻ** — không cờ nào bật lại inline.
 *   • Nội tâm chat đi vào `reasoning_content`; cờ này chỉ quyết định CÓ ô ấy hay KHÔNG.
 *   • `/completions` (FIM): nội tâm **BỎ HẲN** — `text_completion` không có ô hợp lệ nào để mang
 *     nó, và chữ tuyến này được chèn THẲNG vào tệp mã nguồn; đẻ thêm một ô ngoài chuẩn ở đó là
 *     rủi ro cho client validate schema chặt mà chẳng ai đọc.
 *
 * ĐÁNH ĐỔI: dán inline là hành vi DUY NHẤT hỏng trên MỌI client (client hiểu `reasoning_content`
 * cũng hỏng, client không hiểu cũng hỏng). Tách ô chỉ "mất chữ" với client cố ý muốn đọc nội tâm —
 * mà chính những client ấy đọc đúng ô này. Mặc định BẬT; tắt bằng `OPENAI_GATEWAY_REASONING_FIELD`
 * =0/false/no/off cho client từ chối trường lạ. Tắt cờ KHÔNG mở lại đường inline.
 */
function reasoningFieldEnabled(): boolean {
  const raw = envStr("OPENAI_GATEWAY_REASONING_FIELD").toLowerCase();
  if (raw === "") return true;
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

/**
 * Cắt thẻ suy luận **giữ nguyên khoảng trắng biên khi không có gì bị cắt**.
 *
 * `stripThinking().answer` đã `.trim()`. Với roster đang chạy (Qwen3-30B-A3B-Instruct — KHÔNG phát
 * `<think>`) bản vá này phải là **no-op từng ký tự**, và ở `/completions` thì thụt đầu dòng LÀ dữ
 * liệu: trim một completion FIM là làm hỏng mã người dùng. `answer === raw.trim()` xảy ra khi và
 * chỉ khi phép quét không xoá một ký tự phi-khoảng-trắng nào (mọi lượt cắt thật đều xoá ít nhất
 * một cặp thẻ) ⇒ lúc ấy trả lại NGUYÊN VĂN là an toàn và chính xác.
 */
function catGiuNguyenBien(raw: string): { hienThi: string; noiTam: string } {
  const cut = stripThinking(raw);
  return { hienThi: cut.answer === raw.trim() ? raw : cut.answer, noiTam: cut.thinking };
}

/**
 * ★★★ G2-B — CỜ CHO TOOL-CALLING GỐC. Mặc định **TẮT** (đường lùi là hành vi CŨ, y nguyên).
 *
 * VÌ SAO MẶC ĐỊNH TẮT dù phép đo cho thấy đường native tốt hơn hẳn ở việc CHỌN tool: bật nó lên
 * là đổi **hợp đồng** của một bề mặt mà client bên thứ ba (Continue/Cline/IDE plugin) đang dùng —
 * `finish_reason` có thêm giá trị mới, `message.tool_calls` mọc thêm ô, và một client cũ đọc
 * `content` rỗng sẽ thấy "model trả lời trống". Đó là quyết định của chủ hệ thống, không phải hệ
 * quả phụ của một bản vá. Bật bằng `AI_NATIVE_TOOLCALLS_ENABLED=1|true|yes|on`.
 *
 * ⚠ Cờ TẮT **KHÔNG** có nghĩa là "bỏ qua `tools`": bỏ qua trong im lặng chính là hành vi mà G2-B
 * xoá bỏ. Cờ tắt + caller gửi `tools` ⇒ **400 `native_tools_disabled`** (nói ra tại sao).
 */
function nativeToolsEnabled(): boolean {
  const raw = envStr("AI_NATIVE_TOOLCALLS_ENABLED").toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** Kết quả đọc `tools`/`tool_choice` khỏi thân yêu cầu. */
interface YeuCauTool {
  /** Đã lọc qua `tool_choice` — `undefined` nghĩa là KHÔNG gửi tools xuống engine. */
  tools?: NativeTool[];
  /** Caller có nêu `tools` hay không (khác với "có gửi xuống engine hay không" ở nhánh `none`). */
  callerCoNeuTools: boolean;
}

/**
 * Đọc + cưỡng chế `tools`/`tool_choice`. NÉM (lỗi có mã) thay vì trả về một giá trị "an toàn".
 *
 * Cưỡng chế `tool_choice:"none"` ở ĐÂY bằng cách **không truyền tools xuống** — xem
 * `MO_TA_HANH_VI_TOOL_CHOICE` trong module lá: gửi `tool_choice:"none"` lên b9814 thì tools VẪN
 * vào prompt, server chỉ tắt bộ phân giải, và `<tool_call>{…}</tool_call>` NGUYÊN VĂN rò vào
 * `content` — tức đúng cái ta phải chặn lại chảy ra IDE của kỹ sư.
 */
function docYeuCauTool(body: any): YeuCauTool {
  const toolsRaw = body?.tools;
  const choiceRaw = body?.tool_choice;

  /**
   * ⚠ "CÓ Ô `tools`", chứ KHÔNG phải "ô `tools` HỢP LỆ". Lượt viết đầu của hàm này dùng
   * `Array.isArray(toolsRaw) && length > 0`, và ca §4 bắt ngay: `tools: {}` (object, không phải
   * mảng) trượt qua vị từ ấy ⇒ **200 OK, tools bị nuốt không một lời** — tức chính lớp lỗi G2-B
   * tồn tại để xoá, tái sinh ngay bên trong bản vá xoá nó. Một đầu vào HỎNG phải kêu, không được
   * rơi vào cùng nhánh với một đầu vào VẮNG.
   *
   * `tools: []` là ngoại lệ CÓ CHỦ ĐÍCH: mảng rỗng có nghĩa rõ ràng ("không có tool nào"), nên nó
   * đi cùng nhánh với "vắng" — kể cả khi cờ đang TẮT, để một client luôn gửi `tools: []` không bị
   * chặn vô cớ.
   */
  const coO = toolsRaw !== undefined && toolsRaw !== null && !(Array.isArray(toolsRaw) && toolsRaw.length === 0);

  // `tool_choice` MÀ KHÔNG có `tools` là vô nghĩa và OpenAI cũng bỏ qua. Không dựng lỗi ở đây:
  // vài SDK gắn `tool_choice:"auto"` vào MỌI yêu cầu theo mặc định, và 400 hoá cả nhóm đó là
  // biến một cờ mặc-định-TẮT thành một sự cố toàn tuyến.
  if (!coO) return { callerCoNeuTools: false };
  if (!nativeToolsEnabled()) {
    throw new LoiNativeToolsTat();
  }

  const tools = chuanHoaTools(toolsRaw);
  const choice = chuanHoaToolChoice(choiceRaw);
  if (!tools) return { callerCoNeuTools: false };
  if (choice === "none") return { callerCoNeuTools: true };

  /**
   * ★★★ Chặn TRƯỚC một lỗi upstream MÙ. Đo sống: `maxLength ≥ 2000` hoặc một `pattern` có dấu `\`
   * thoát / không neo làm llama.cpp trả **400 "Failed to initialize samplers: failed to parse
   * grammar"** cho TOÀN BỘ yêu cầu — không nói tool nào, ô nào. Với một client gửi vài chục tool
   * (đúng ca dùng của agent framework) đó là một câu lỗi không truy được.
   * ⚠ CỐ Ý **không** tự cắt gọt schema của caller rồi vẫn trả 200: sửa lặng lẽ ràng buộc người
   * khác nêu ra là đúng lớp hỏng-trong-im-lặng mà G2-B xoá bỏ. Ta NÓI RA, họ sửa.
   */
  const gioiHan = timGioiHanGrammar(tools);
  if (gioiHan.length) {
    throw new LoiToolCallKhongHopLe(
      `Bộ sinh grammar của engine cục bộ (llama.cpp) không dựng nổi ${gioiHan.length} ràng buộc trong \`tools\`; ` +
        `gửi nguyên trạng thì CẢ yêu cầu bị từ chối với một câu lỗi không nêu tool nào. Cụ thể: ${gioiHan
          .slice(0, 5)
          .join(" · ")}${gioiHan.length > 5 ? ` · (+${gioiHan.length - 5} chỗ nữa)` : ""}`,
    );
  }
  return { tools, callerCoNeuTools: true };
}

/**
 * ★★★ Đợt 4B-server — `chat_template_kwargs` theo DANH SÁCH TRẮNG.
 *
 * Extension (và client OpenAI-compat kiểu vLLM/llama.cpp) gửi `chat_template_kwargs.enable_thinking=false` để hỏi lại MỘT
 * lượt với suy luận tắt (vd model phát tool call bên trong phần suy luận). Trước bản này cổng BỎ cả ô ⇒ lần hỏi lại vẫn
 * nghĩ theo mặc định server.
 * ⚠⚠ KHÔNG chuyển tiếp nguyên ô: mỗi khoá của chat template là một cần gạt hành vi model (thêm/bớt prompt sinh, chèn
 *   tool vào lượt user, …) — để caller của một bề mặt dùng chung điều khiển chúng là mở một đường vòng quanh mọi giả định
 *   prompt phía máy chủ. CHỈ `enable_thinking` kiểu BOOLEAN được đọc, và đi qua đường ĐÃ CÓ (`disableThinking` ⇒
 *   `aiLlamaServerClient.lapCoTatSuyLuan`), không qua một ô mới xuống engine:
 *     `false` ⇒ `{ disableThinking: true }` · `true`/vắng/kiểu sai/khoá khác ⇒ `{}` (mặc định server; hình dạng cũ bit-đối-bit).
 */
export function docTatNghi(body: unknown): { disableThinking?: true } {
  const kw = (body as { chat_template_kwargs?: unknown } | null)?.chat_template_kwargs;
  if (!kw || typeof kw !== "object" || Array.isArray(kw)) return {};
  return Object.prototype.hasOwnProperty.call(kw, "enable_thinking") && (kw as { enable_thinking?: unknown }).enable_thinking === false
    ? { disableThinking: true }
    : {};
}

/** Trần `stop` của `/completions` (chuẩn OpenAI: tối đa 4 chuỗi) + trần độ dài MỖI chuỗi (cắt ở ranh giới dòng/khối). */
export const TRAN_STOP_FIM = 4;
export const TRAN_KY_TU_STOP_FIM = 64;

/**
 * ★★ Đợt 4C-server — `stop` của `/v1/completions` ⇒ `GgufFimOptions.stopSequences` (engine NỐI THÊM vào sentinel FIM).
 * Nhận CHUỖI hoặc MẢNG ≤ `TRAN_STOP_FIM` phần tử, mỗi phần là chuỗi KHÔNG RỖNG ≤ `TRAN_KY_TU_STOP_FIM` ký tự. Mọi hình
 * dạng khác ⇒ `undefined` (BỎ CẢ Ô — không cắt xén, không đoán ý caller) ⇒ opts engine giữ hình dạng cũ bit-đối-bit.
 */
export function docStopFim(stop: unknown): string[] | undefined {
  const ds = typeof stop === "string" ? [stop] : Array.isArray(stop) ? stop : null;
  if (!ds || ds.length === 0 || ds.length > TRAN_STOP_FIM) return undefined;
  if (!ds.every((x) => typeof x === "string" && x.length > 0 && x.length <= TRAN_KY_TU_STOP_FIM)) return undefined;
  return [...(ds as string[])];
}

/**
 * ★★★ Đợt 4B-server — usage trong LUỒNG theo chuẩn OpenAI: chỉ khi caller xin `stream_options.include_usage: true` (mặc
 * định OpenAI = KHÔNG phát; client không xin nhận luồng y như cũ). Chunk usage là chunk CUỐI trước `[DONE]`, `choices: []`.
 * `completion_tokens_details.reasoning_tokens` chỉ có khi engine ĐẾM được (`tokensReasoning` là số — "không biết ≠ 0").
 */
function xinUsageLuong(body: unknown): boolean {
  return (body as { stream_options?: { include_usage?: unknown } } | null)?.stream_options?.include_usage === true;
}
function usageOpenAi(vao: number, ra: number, nghi?: number): Record<string, unknown> {
  return {
    prompt_tokens: vao,
    completion_tokens: ra,
    total_tokens: vao + ra,
    ...(typeof nghi === "number" && Number.isFinite(nghi) ? { completion_tokens_details: { reasoning_tokens: nghi } } : {}),
  };
}

/** Cờ TẮT nhưng caller vẫn nêu `tools` ⇒ phải NÓI RA, không nuốt. */
class LoiNativeToolsTat extends Error {
  readonly code = "native_tools_disabled";
  constructor() {
    super(
      "Tool-calling gốc đang TẮT trên gateway này. Bật bằng AI_NATIVE_TOOLCALLS_ENABLED=true. " +
        "(Yêu cầu KHÔNG được phục vụ trong im lặng vì bỏ qua `tools` sẽ khiến model không bao giờ gọi tool " +
        "mà client không biết vì sao.)",
    );
    this.name = "LoiNativeToolsTat";
  }
}

/** Ánh xạ ba lỗi tool-calling → HTTP 400 có mã. `false` ⇒ không phải lỗi của nhóm này. */
function xuLyLoiTool(res: Response, err: unknown): boolean {
  if (
    err instanceof LoiNativeToolsTat ||
    err instanceof LoiToolCallKhongHopLe ||
    err instanceof LoiToolChoiceKhongCuongCheDuoc
  ) {
    if (!res.headersSent) {
      jsonError(res, 400, (err as Error).message, "invalid_request_error", (err as any).code);
    } else {
      res.end();
    }
    return true;
  }
  return false;
}

/** Logical model names advertised on GET /models (doc 34 §III.2 router tiers). */
const LOGICAL_MODELS = ["chat", "code", "fast", "fim", "embed"] as const;
type LogicalModel = (typeof LOGICAL_MODELS)[number];

/**
 * Resolve a client-requested `model` to a concrete GGUF basename for the engine.
 * Returns `undefined` when the engine should pick its configured default
 * (GGUF_DEFAULT_MODEL) — passing a non-existent basename would make the engine
 * throw on load, so unknown-but-empty resolutions fall back to the default.
 *
 * Per decision D2 (§VI-bis): `code`/`chat` reuse GGUF_DEFAULT_MODEL (the 30B-A3B
 * instruct) unless GGUF_CODE_MODEL is set; `fim` uses GGUF_FIM_MODEL, else the
 * small fast model, else GGUF_DEFAULT_MODEL.
 *
 * doc69 G2-5b — delegates to the shared modelResolver (previously an inline copy here that had
 * drifted from aiModelRouter.ts/aiGgufEngine.ts: the "fim" fallback stopped at GGUF_FAST_MODEL
 * instead of continuing to GGUF_DEFAULT_MODEL. Reconciled to the 3-level chain both other call
 * sites already used — see modelResolver.ts's header for why this doesn't change what model
 * actually loads for any request the existing tests exercise).
 */
function resolveModelId(requested?: string): string | undefined {
  return resolveLogicalModel(requested);
}

/**
 * ★ Đợt 9 (audit kiem-dinh M4 — tranh khe) — token của ngữ cảnh đã gây ≥ 3 lần đổi khe THỰC trong 10 phút trượt ⇒ model
 * NẶNG khác khe đang giữ được thay bằng model khe đang giữ (mọi vai trò), header `x-st4i-khe: tran-doi-khe-token`.
 */
function apTranDoiKhe(res: Response, modelId: string | undefined): string | undefined {
  if (!vuotTranDoiKhe(tokenKheHienTai())) return modelId;
  const env = process.env;
  const nha = modelNhaKheNang(env);
  const kq = chonModelKhiVuotTran(modelId, {
    giu: thongKeKheNang()?.dangGiu ?? (toBasename(env.LLAMA_SERVER_MODEL) || null),
    laKheNang: (m) => m === nha || laModelKheNangPhu(m, layAnhSoModel(), env),
    modelMacDinh: defaultModelBasename(),
  });
  if (kq.doi && !res.headersSent) res.setHeader("x-st4i-khe", "tran-doi-khe-token");
  return kq.model;
}

/**
 * ★★ Đợt 9 — VÒNG KIỂM BIÊN DỊCH ST (`services/ai/st/kiemBienDichSt.ts`) cho /v1: chỉ khi cờ `AI_KIEM_BIEN_DICH_ST` có `v1`,
 * vai trò SAU định tuyến là `code.plc`, không phải lượt tool, và client không tắt (`st4i_kiem_bien_dich: false`).
 */
function nenKiemBienDichV1(modelLabel: string, body: Record<string, unknown>, coTool: boolean, stream: boolean): boolean {
  if (modelLabel.trim().toLowerCase() !== "code.plc" || coTool) return false;
  // ★ (2026-10-22, dieu-phoi) mặc định env không đặt = `chi-stream`: non-stream chỉ khi khách opt-in (`st4i_kiem_bien_dich:true`)
  //   — A/B #2: vòng bật đẩy 10 % lượt quá 300 s ⇒ khách non-stream có trần header 300 s bị cắt (xem `cheDoKiemBienDichV1`).
  const cheDo = cheDoKiemBienDichV1();
  if (cheDo === "bat") return body.st4i_kiem_bien_dich !== false;
  if (cheDo === "chi-stream") return stream ? body.st4i_kiem_bien_dich !== false : body.st4i_kiem_bien_dich === true;
  return false;
}

// ★ Đợt 9 — `headerKiemBienDich` / `auditKiemBienDich` nay ở `ai/st/auditKiemBienDich.ts` (dùng chung với đường KB coding); re-export giữ nguyên API cũ.
export { auditKiemBienDich };

/**
 * ★ Đợt 9 (dieu-phoi) — mỗi lượt model SINH LẠI của vòng kiểm biên dịch là MỘT hàng `ai_gateway_metrics` (`luotPhu =
 * 'sua-bien-dich-st'`, CÙNG `requestId` với hàng chính) — chúng chiếm khe + token thật; thiếu thì sổ đo báo thấp giả.
 */
function ghiLuotSuaST(
  plan: GatewayPlan | null,
  requestId: string,
  t0: number,
  r: { tokensPrompt: number; tokensGenerated: number } | null,
): void {
  plan?.recordPhu?.({
    luotPhu: "sua-bien-dich-st",
    requestId,
    latencyMs: Date.now() - t0,
    outcome: r ? "ok" : "error",
    ...(r ? { tokensIn: r.tokensPrompt, tokensOut: r.tokensGenerated } : {}),
  });
}

/** Phần BỔ SUNG phát ở cuối luồng (TRƯỚC chunk finish_reason): nhãn + (đã sửa ⇒) các khối ST đã sửa. Rỗng = không phát. */
function phanBoSungLuong(k: KetQuaKiemBienDichST): string {
  const nhan = nhanKiemBienDich(k);
  if (!nhan) return "";
  if (k.trangThai !== "da-sua") return `\n\n---\n${nhan}\n`;
  const rao = "```";
  const khoi = trichMaST(k.cauTraLoiCuoi).map((x) => `${rao}${x.nhan ?? (x.laScl ? "scl" : "st")}\n${x.ma.replace(/\n$/, "")}\n${rao}`);
  return `\n\n---\n${nhan}\n\n${khoi.join("\n\n")}\n`;
}

/** Backing basename for a logical model (for the models-list `root`/transparency). */
function backingFor(logical: LogicalModel): string {
  return resolveModelId(logical) || envStr("GGUF_DEFAULT_MODEL") || logical;
}

/**
 * doc69 G2-3 — best-effort TaskKind classification for gateway metering/rate-limit
 * bucketing ONLY. Never used to pick the actual generation model (see the import comment
 * above) — `resolveModelId` remains the single source of truth for that.
 */
function inferTaskFromLabel(label: string, fallback: TaskKind = "chat"): TaskKind {
  const key = (label || "").trim().toLowerCase();
  if (key === "code" || key === "coder" || key.startsWith("code.")) return "code";
  if (key === "fim" || key === "infill") return "fim";
  return fallback;
}

// ─── AI Gateway — fail-open rate limit (review fix) ────────────────────────────
//
// `/v1` has NO per-user identity (a single shared static Bearer token, see the module doc
// comment above) — so every engineer's IDE FIM-autocomplete + coding-chat traffic pools into
// ONE "anon" gateway rate-limit bucket. Before this fix, a `RateLimitError` from `planInference`
// propagated to the outer catch and returned a hard HTTP 429 — breaking autocomplete/coding
// tools for EVERY engineer once anyone's combined traffic tripped the shared budget. A
// code-completion API has no graceful client-side degrade for a 429 (unlike the KB assistant,
// which falls back to an extractive answer).
//
// `server/services/aiProviderRouter.ts`'s `planGateway()` already solved this EXACT "unrelated
// callers colliding in the single anon bucket" problem with a deliberate fail-open: catch
// `RateLimitError` (whose rejection `planInference` has ALREADY recorded as `outcome:"rate_limited"`
// telemetry before throwing — see aiGateway.ts) and proceed WITHOUT a `plan`, so the underlying
// engine call always still happens. Mirrored verbatim here. Any OTHER throw (e.g.
// `SafetyBlockedError`, the opt-in hard-block) is NOT swallowed — same posture as `planGateway()`.
interface PlannedCall {
  plan: GatewayPlan | null;
  /** Sanitized (secrets/PII-redacted) text — callers MUST use this, not the raw request text,
   * when building the engine prompt (falls back to the raw text only if a RateLimitError is
   * thrown without redacted text attached, which should never happen). */
  safeText: string;
}
async function planGatewayFailOpen(
  task: TaskKind,
  text: string | undefined,
  nguoi?: NguoiGoiCong,
): Promise<PlannedCall> {
  try {
    // ★ Đợt 4A — token người dùng ⇒ `userId`/`role` THẬT vào đo lường (`ai_gateway_metrics.userId`), hạn mức và
    //   rate-limit theo người của `planInference`. Key chung ⇒ vẫn không có người (KHÔNG bịa một userId).
    const plan = await planInference({
      task,
      text,
      ...(nguoi?.kieu === "token" ? { userId: nguoi.userId, role: nguoi.role } : {}),
    });
    return { plan, safeText: plan.safeText };
  } catch (err) {
    if (err instanceof RateLimitError) return { plan: null, safeText: err.safeText ?? text ?? "" };
    throw err;
  }
}

// ─── OpenAI shape helpers ──────────────────────────────────────────────────────

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** Rough token estimate (chars/4) for usage on paths where we lack an exact count. */
function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil((text || "").length / 4));
}

/** Flatten an OpenAI message `content` (string | array of parts) to plain text. */
function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && (part as any).type === "text") {
          return String((part as any).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

/**
 * Map OpenAI messages → engine chat messages.
 *
 * ★★★ G2-B — VAI `tool` KHÔNG CÒN BỊ BÓP VỀ `user`.
 * Bản cũ có một nhánh `: "user"` bắt TẤT CẢ vai không phải system/assistant, nên message
 * `role:"tool"` — **mắt xích GIỮA của vòng đời tool-call** — bị nuốt: chat template Qwen3 không
 * dựng được khối `<tool_response>`, và model không bao giờ kết luận được từ kết quả tool. Đường
 * `/v1` vì thế **không thể** đi trọn một vòng, dù model có phát `tool_calls` hay không.
 *
 * ⚠ CHỈ THÊM `tool` — mọi vai lạ khác (vd `"developer"`) VẪN về `user`. Đây là nới lỏng có kiểm
 * soát cho đúng một vai có ngữ nghĩa trong chat template, không phải mở cửa cho vai tuỳ ý: một
 * vai lạ đi thẳng xuống llama-server sẽ làm template ném 500 thay vì degrade.
 */
function toGgufMessages(messages: any[]): GgufChatMessage[] {
  return messages
    .filter((m) => m && typeof m.role === "string")
    .map((m) => {
      const role: GgufChatMessage["role"] =
        m.role === "system"
          ? "system"
          : m.role === "assistant"
            ? "assistant"
            : m.role === "tool"
              ? "tool"
              : "user";
      const ra: GgufChatMessage = { role, content: contentToString(m.content) };
      // `tool_call_id` chỉ có nghĩa trên vai `tool`; `tool_calls` chỉ có nghĩa trên `assistant`.
      // Ràng buộc theo VAI (chứ không "có gì chép nấy") để một client gửi bừa không đẩy được ô lạ
      // xuống thân yêu cầu của llama-server.
      if (role === "tool" && typeof m.tool_call_id === "string" && m.tool_call_id) {
        ra.tool_call_id = m.tool_call_id;
      }
      if (role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const sach = m.tool_calls.filter(toolCallHopLe) as NativeToolCall[];
        if (sach.length) ra.tool_calls = sach;
      }
      return ra;
    });
}

// FIM prompt assembly + stop sequences now live in aiGgufEngine.generateFim (native infill);
// the gateway just forwards prefix/suffix to it.

/**
 * ★★★ Đợt 4 (bộ đo `vscode-e2e` V-dot4-1/2) — lớp lỗi "model trả lời vào KÊNH SUY LUẬN, content rỗng" mà HỎI LẠI với
 * nghĩ TẮT chữa được. Trả `code` của khung lỗi `/v1` (để client hành động được thay vì một 500 trơn), `null` = lớp khác.
 *   • `tool_call_in_reasoning` — `<tool_call>` trong suy luận chưa đóng (`LoiToolCallTrongSuyLuan`);
 *   • `reasoning_without_content` — G5-D ca (B): suy luận có, content rỗng, không tool call (đo được: NGUYÊN câu trả
 *     lời cuối nằm trong suy luận — 5/6 lượt `loi-model` của V-dot4-1/2).
 * ⚠ Chữ suy luận KHÔNG BAO GIỜ được vớt thành hành động hay chữ hiển thị (rà bảo mật ×3) — chỉ được HỎI LẠI.
 */
export type MaLoiSuyLuanV1 = "tool_call_in_reasoning" | "reasoning_without_content";
export function maLoiSuyLuanV1(e: unknown): MaLoiSuyLuanV1 | null {
  if (!e) return null;
  if (laLoiToolCallTrongSuyLuan(e)) return "tool_call_in_reasoning";
  if (laLoiTokenCanKietVaoSuyLuan(e)) return "reasoning_without_content";
  return null;
}

/**
 * Được hỏi lại lượt này ĐÚNG MỘT lần với nghĩ TẮT? Chỉ khi: lỗi thuộc lớp trên · yêu cầu có `tools` (lượt agent — lượt
 * chat thường giữ hành vi cũ) · yêu cầu CHƯA tắt nghĩ (tắt rồi thì lần hai y hệt lần một) · chưa hỏi lại lần nào.
 */
function nenHoiLaiNghiTat(err: unknown, coTools: boolean, daTatNghi: boolean, daHoiLai: boolean): boolean {
  return !daHoiLai && coTools && !daTatNghi && maLoiSuyLuanV1(err) !== null;
}

function jsonError(
  res: Response,
  status: number,
  message: string,
  type = "invalid_request_error",
  code?: string,
): void {
  res.status(status).json({ error: { message, type, ...(code ? { code } : {}) } });
}

// Review fix (doc69 G2-4 W1-4) — `QuotaExceededError`/`LicenseGateError` (both opt-in,
// default OFF) used to fall into the generic catch-all → HTTP 500 "server_error", identical to
// a real engine crash and giving the caller nothing to act on. Both are mapped to a proper,
// client-actionable OpenAI-compat status/body here, mirroring the existing `SafetyBlockedError`
// → 400 branch. `false` is returned when the error wasn't one of these two, so callers can fall
// through to their own generic-error handling unchanged.
function handleEnforcementError(res: Response, err: unknown): boolean {
  if (err instanceof QuotaExceededError) {
    // planInference already recorded 'quota_exceeded' telemetry internally before throwing
    // (see aiGateway.ts) — nothing more to record here.
    if (!res.headersSent) {
      res.status(429).json({
        error: {
          message: err.message,
          type: "insufficient_quota",
          code: "quota_exceeded",
          used_tokens: err.usedTokens,
          budget_tokens: err.budgetTokens,
        },
      });
    } else {
      res.end();
    }
    return true;
  }
  if (err instanceof LicenseGateError) {
    // planInference already recorded 'license_denied' telemetry internally before throwing
    // (see aiGateway.ts) — nothing more to record here.
    if (!res.headersSent) jsonError(res, 403, err.message, "permission_error", "ai_module_not_licensed");
    else res.end();
    return true;
  }
  return false;
}

// ─── Auth ──────────────────────────────────────────────────────────────────────

function extractBearer(req: Request): string | null {
  const header = req.header("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

// ─── ★★★ Đợt 4A — danh tính người gọi: TOKEN NGƯỜI DÙNG hoặc KEY CHUNG (deprecate) ──────────────

/**
 * Người gọi của MỘT yêu cầu `/v1`, do middleware xác thực đặt vào `res.locals.nguoiGoiCong`.
 * ⚠ Chỉ middleware xác thực được ghi ô này; handler chỉ ĐỌC (qua `nguoiGoi`). Không có đường nào để thân yêu cầu
 *   hay header khai một userId.
 */
export type NguoiGoiCong =
  | { kieu: "token"; userId: number; role: string; tokenId: number; phamVi: readonly string[] }
  | { kieu: "key-chung" };

function nguoiGoi(res: Response): NguoiGoiCong | undefined {
  return (res.locals as { nguoiGoiCong?: NguoiGoiCong }).nguoiGoiCong;
}

/**
 * Key dùng chung `OPENAI_GATEWAY_API_KEY` — GIỮ để không gãy Continue/IDE đang cấu hình, nhưng đã DEPRECATE: nó không
 * gắn người (đo lường/hạn mức về xô "anon"), và thu hồi nó là cắt mọi kỹ sư cùng lúc. Mặc định BẬT (hành vi cũ);
 * `OPENAI_GATEWAY_SHARED_KEY_ENABLED=0|false|no|off` ⇒ chỉ token người dùng. Đọc tại thời điểm gọi.
 */
export function keyChungBat(): boolean {
  const raw = envStr("OPENAI_GATEWAY_SHARED_KEY_ENABLED").toLowerCase();
  if (raw === "") return true;
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

/** Trần yêu cầu/phút MỖI TOKEN (FIM gõ phím bắn dày — mặc định rộng tay). `OPENAI_GATEWAY_TOKEN_RPM`. */
function tranMoiPhutToken(): number {
  const n = Number(envStr("OPENAI_GATEWAY_TOKEN_RPM"));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 240;
}

let canhBaoKeyChungLuc = 0;
function canhBaoKeyChung(): void {
  const now = Date.now();
  if (now - canhBaoKeyChungLuc < 10 * 60_000) return; // một dòng mỗi 10 phút, không lụt nhật ký
  canhBaoKeyChungLuc = now;
  console.warn(
    "[openaiGateway] DEPRECATED: một yêu cầu /v1 dùng KEY CHUNG OPENAI_GATEWAY_API_KEY (không gắn người dùng). " +
      "Chuyển sang token cá nhân (trang AI › Token cổng, hoặc đăng nhập thiết bị từ extension), rồi đặt " +
      "OPENAI_GATEWAY_SHARED_KEY_ENABLED=0.",
  );
}

// Bảng mã từ chối token (401/403/503 + `error.code`) — một chủ dùng chung với tuyến REST Bearer: `gatewayToken/tuChoiToken.ts`.

/** Quyền AI mặc định: cùng bit `ai_repo_read/canView` cấp token (mất quyền sau khi cấp ⇒ token thôi mở cổng). */
async function coQuyenAiMacDinh(userId: number, role: string): Promise<boolean> {
  try {
    const { checkPermission } = await import("../_core/accessControl");
    return await checkPermission(userId, role, "ai_repo_read", "canView");
  } catch {
    return false;
  }
}

/**
 * ★★★ CORS RIÊNG cho đường `/v1` — gọi từ bộ CORS chung ở `_core/index.ts` TRƯỚC khi nó đặt bất kỳ header nào.
 *
 * Vì sao: bộ chung trả `Access-Control-Allow-Origin: *` cho yêu cầu không Origin và (ở dev) phản chiếu MỌI origin kèm
 * credentials. Cổng giờ mang token CÁ NHÂN ⇒ một trang lạ không được phép đọc phản hồi `/v1` từ trình duyệt.
 * Extension gọi từ extension host (Node, không Origin) nên KHÔNG cần CORS. Trình duyệt cần thì khai tường minh
 * `OPENAI_GATEWAY_CORS_ORIGINS` (phẩy). Không bao giờ `*`, không bao giờ Allow-Credentials (cổng dùng Bearer).
 *
 * @returns `"khong-phai"` — không phải đường cổng (hoặc cổng TẮT) ⇒ bộ chung làm như cũ từng bit;
 *          `"da-xu-ly"`   — preflight đã trả lời xong;
 *          `"tiep"`       — header đã đặt, đi tiếp (BỎ QUA bộ chung).
 */
export function xuLyCorsCongOpenAi(req: Request, res: Response): "khong-phai" | "da-xu-ly" | "tiep" {
  if (!envBool("OPENAI_GATEWAY_ENABLED")) return "khong-phai";
  // ⚠ Rà bảo mật de591c868 #1 — so KHÔNG phân biệt hoa/thường: gắn cổng bằng Express khớp cả `/V1/…`, nên
  //   bản so chính xác để `/V1/models` lọt về bộ CORS chung (`*` / phản chiếu kèm credentials).
  const base = (envStr("OPENAI_GATEWAY_PATH") || "/v1").replace(/\/+$/, "").toLowerCase();
  const duong = (req.path || "").toLowerCase();
  if (duong !== base && !duong.startsWith(`${base}/`)) return "khong-phai";
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const choPhep = envStr("OPENAI_GATEWAY_CORS_ORIGINS")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const hopLe = origin !== "" && choPhep.includes(origin);
  if (hopLe) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") {
    res.status(hopLe ? 204 : 403).end();
    return "da-xu-ly";
  }
  return "tiep";
}

// ─── Router factory ─────────────────────────────────────────────────────────────

export interface OpenAiGatewayConfig {
  /**
   * KEY CHUNG (deprecate) — so khớp hằng-thời-gian. Rỗng ⇒ không key chung nào khớp (chế độ chỉ-token).
   * `OPENAI_GATEWAY_SHARED_KEY_ENABLED=0` ⇒ bị từ chối dù khớp.
   */
  apiKey: string;
  /** Đợt 4A — seam cho lưới; mặc định tra CSDL (`xacThucTokenNguoiDung`). */
  xacThucToken?: (token: string) => Promise<KetQuaXacThucToken>;
  /** Đợt 4A — seam cho lưới; mặc định `checkPermission(…, "ai_repo_read", "canView")`. */
  coQuyenAi?: (userId: number, role: string) => Promise<boolean>;
  /** Đợt 4A — seam cho lưới; mặc định ghi `dungLanCuoiLuc` (thưa 60 s). */
  ghiDung?: (tokenId: number) => void;
}

/**
 * Build the OpenAI-compatible router. Exported so tests can mount it directly.
 * Callers MUST pass a non-empty apiKey (the register function enforces this and
 * refuses to mount otherwise).
 */
export function createOpenAiGatewayRouter(config: OpenAiGatewayConfig): Router {
  const router = Router();
  const apiKey = config.apiKey;
  const xacThucToken = config.xacThucToken ?? xacThucTokenNguoiDung;
  const coQuyenAi = config.coQuyenAi ?? coQuyenAiMacDinh;
  const ghiDung = config.ghiDung ?? ghiDungLanCuoi;

  // Own body parser so the gateway works regardless of global config / in tests.
  // express.json is idempotent (skips when a body was already parsed upstream).
  router.use(express.json({ limit: process.env.OPENAI_GATEWAY_BODY_LIMIT || "20mb" }));

  // doc 44 G5.22 (SERVICE_MTLS) — sample service-to-service identity seam. This is a
  // genuine internal-consumer surface (in-app copilot + engineer tooling call it).
  // Pass-through when SERVICE_MTLS_ENABLED is OFF (default → bit-compat); when ON,
  // callers must present a valid SPIFFE-lite JWT-SVID (Authorization: SVID <token>
  // or x-svid) verified against the internal CA. Additive + non-breaking.
  router.use(requireServiceIdentity({ audience: "openai-gateway" }));

  // Bearer auth on every endpoint. Fail-closed: no key configured ⇒ reject all.
  // ★★★ Đợt 4A — HAI loại Bearer, rẽ theo TIỀN TỐ (key chung không bao giờ phải tra CSDL):
  //   • `avgw_…` ⇒ token NGƯỜI DÙNG: tra băm ⇒ (thu hồi · hết hạn · tài khoản tắt) ⇒ quyền AI còn không ⇒ phạm vi của
  //     đường ⇒ trần/phút của token ⇒ gắn `res.locals.nguoiGoiCong`. Mọi nhánh hỏng ⇒ dừng (fail-closed; CSDL sập ⇒ 503).
  //   • còn lại ⇒ KEY CHUNG (deprecate): chỉ khi cờ bật; khớp hằng-thời-gian; cảnh báo + header `Deprecation`.
  router.use((req: Request, res: Response, next) => {
    void (async () => {
      const token = extractBearer(req);
      if (!token) {
        jsonError(res, 401, "Missing API token. Provide 'Authorization: Bearer <token>'.", "invalid_request_error", "invalid_api_key");
        return;
      }

      if (token.startsWith(TIEN_TO_TOKEN)) {
        const kq = await xacThucToken(token);
        if (!kq.ok) {
          const [ma, code, msg] = TU_CHOI_TOKEN[kq.ma] ?? TU_CHOI_TOKEN["khong-hop-le"];
          jsonError(res, ma, msg, loaiLoiTheoMa(ma), code);
          return;
        }
        if (!(await coQuyenAi(kq.userId, kq.role))) {
          jsonError(res, 403, "The token owner no longer has AI access.", "permission_error", "permission_denied");
          return;
        }
        // ⚠ Rà bảo mật de591c868 #1 — `phamViCuaDuong` so không phân biệt hoa/thường (như Express); đường KHÔNG khai
        //   phạm vi ⇒ 404 ngay tại đây (fail-closed), KHÔNG `next()` cho token người dùng.
        const can = phamViCuaDuong(req.path);
        if (can === "khong-ro") {
          jsonError(res, 404, "Unknown gateway endpoint.", "invalid_request_error", "not_found");
          return;
        }
        if (can !== null && !kq.phamVi.includes(can)) {
          jsonError(res, 403, `This token lacks the '${can}' scope.`, "permission_error", "insufficient_scope");
          return;
        }
        // Trần THEO TOKEN (không theo người): một extension chạy loạn không ăn hết trần của token khác cùng người.
        const choMs = checkNamedRateLimit(kq.userId, `gw-token:${kq.tokenId}`, tranMoiPhutToken());
        if (choMs !== null) {
          res.setHeader("Retry-After", String(Math.max(1, Math.ceil(choMs / 1000))));
          jsonError(res, 429, "Rate limit exceeded for this token.", "rate_limit_error", "rate_limit_exceeded");
          return;
        }
        (res.locals as { nguoiGoiCong?: NguoiGoiCong }).nguoiGoiCong = {
          kieu: "token",
          userId: kq.userId,
          role: kq.role,
          tokenId: kq.tokenId,
          phamVi: kq.phamVi,
        };
        ghiDung(kq.tokenId);
        // ★ Đợt 9 — ngữ cảnh token cho trần đổi khe (tranDoiKheToken.ts): đổi khe THỰC do lượt này gây ra được đếm cho token.
        chayVoiTokenKhe(`token:${kq.tokenId}`, () => next());
        return;
      }

      if (!keyChungBat()) {
        jsonError(
          res,
          401,
          "The shared gateway key is disabled. Use a personal API token.",
          "invalid_request_error",
          "shared_key_disabled",
        );
        return;
      }
      if (!apiKey || !timingSafeEqualStr(token, apiKey)) {
        jsonError(
          res,
          401,
          "Invalid API key. Provide 'Authorization: Bearer <OPENAI_GATEWAY_API_KEY>'.",
          "invalid_request_error",
          "invalid_api_key",
        );
        return;
      }
      canhBaoKeyChung();
      res.setHeader("Deprecation", "true");
      (res.locals as { nguoiGoiCong?: NguoiGoiCong }).nguoiGoiCong = { kieu: "key-chung" };
      chayVoiTokenKhe("key-chung", () => next()); // key chung = MỘT xô (không gắn người)
    })().catch((err) => {
      // Lỗi không lường trước trong lượt xác thực ⇒ fail-closed, KHÔNG next().
      console.error("[openaiGateway] auth middleware error:", (err as Error)?.message ?? err);
      if (!res.headersSent) jsonError(res, 503, "Authentication failed unexpectedly.", "server_error", "auth_backend_unavailable");
    });
  });

  async function ensureEngine(res: Response): Promise<boolean> {
    if (!(await isGgufAvailable())) {
      jsonError(res, 503, "Local GGUF engine not available.", "server_error");
      return false;
    }
    return true;
  }

  // ─── GET /models ─────────────────────────────────────────────
  router.get("/models", (_req: Request, res: Response) => {
    const created = nowUnix();
    const data = [
      ...LOGICAL_MODELS.map((id) => ({
        id,
        object: "model",
        created,
        owned_by: "st4i-local",
        root: backingFor(id),
      })),
      // ★★ Đợt 7.0 — VAI TRÒ SINH CHỮ (sổ ∪ bộ gốc) sau 5 tên logic cũ (thứ tự cũ giữ nguyên cho client đang lấy data[0]).
      ...[...new Set([...VAI_TRO_GOC.map((v) => v.id), ...layAnhSoModel().vaiTro.keys()])]
        .filter((id) => !(LOGICAL_MODELS as readonly string[]).includes(id) && laVaiTroSinhChu(id, layAnhSoModel()))
        .map((id) => ({
          id,
          object: "model",
          created,
          owned_by: "st4i-local",
          root: resolveModelId(id) || envStr("GGUF_DEFAULT_MODEL") || id,
          kind: "role",
        })),
      // ★★ Đợt 7.3 — chọn vai trò TỰ ĐỘNG từ câu hỏi (tầng 3 tín hiệu chữ → tầng 4 nhúng; không chắc ⇒ chat).
      { id: "auto", object: "model", created, owned_by: "st4i-local", root: "theo-cau-hoi", kind: "auto" },
    ];
    res.json({ object: "list", data });
  });

  // ─── POST /chat/completions ──────────────────────────────────
  router.post("/chat/completions", async (req: Request, res: Response) => {
    // Review fix — hoisted so the outer catch can record metering on EVERY failure path
    // (see planGatewayFailOpen above): `plan` stays null on the fail-open rate-limit path
    // (record() becomes a safe no-op) and on any early return before the plan is created.
    let plan: GatewayPlan | null = null;
    let engineStart = 0;
    try {
      if (!(await ensureEngine(res))) return;
      const body = req.body ?? {};
      const messages = body.messages;
      if (!Array.isArray(messages) || messages.length === 0) {
        jsonError(res, 400, "`messages` must be a non-empty array.");
        return;
      }

      let modelLabel = typeof body.model === "string" && body.model ? body.model : "chat";
      // ★ M4 (audit kiem-dinh) — `model` chỉ là tên logic / vai trò / hồ sơ trong sổ / tên tệp TRONG GGUF_MODELS_DIR.
      const kiem = kiemModelV1(modelLabel);
      if (!kiem.ok) {
        jsonError(res, 400, "Unknown model.", "invalid_request_error", "model_not_found");
        return;
      }
      modelLabel = kiem.ten;
      // ★★ Đợt 7.3 — `model: "auto"`: chọn VAI TRÒ từ câu hỏi cuối của người dùng (tầng 3 tín hiệu chữ → tầng 4 nhúng);
      // không chắc ⇒ "chat". Vai trò được chọn ghi vào `model` của phản hồi + header để người gọi thấy lý do.
      if (modelLabel.trim().toLowerCase() === "auto") {
        const cuoi = [...messages].reverse().find((m: { role?: string }) => m?.role === "user");
        const chu = typeof cuoi?.content === "string" ? cuoi.content : Array.isArray(cuoi?.content) ? cuoi.content.map((p: { text?: string }) => p?.text ?? "").join(" ") : "";
        const { chonVaiTroTuDong } = await import("../services/ai/soModel/phanLoaiNguNghia");
        const chon = await chonVaiTroTuDong(chu);
        modelLabel = chon.vaiTro ?? "chat";
        if (!res.headersSent) res.setHeader("x-st4i-vai-tro", `${modelLabel}; tang=${chon.tang}`);
      }
      const modelId = apTranDoiKhe(res, resolveModelId(modelLabel));
      const maxTokens = Number.isFinite(body.max_tokens) ? Number(body.max_tokens) : 1024;
      const temperature = Number.isFinite(body.temperature) ? Number(body.temperature) : 0.7;
      const topP = Number.isFinite(body.top_p) ? Number(body.top_p) : undefined;

      // doc69 G2-3 / review fix — AI Gateway: `modelId` above (resolved from the caller's
      // EXPLICIT `body.model`) is what actually generates the response; the gateway plan below
      // is used ONLY for the flag-gated/fail-safe redaction of the most-recent message + the
      // metrics row. Rate-limit is FAIL-OPEN (planGatewayFailOpen above) — this surface has no
      // graceful-degrade UX for a hard 429, unlike the KB assistant's extractive fallback.
      // `SafetyBlockedError` (opt-in hard-block) still propagates — mapped to 400 in the catch
      // block below. No numeric per-user principal exists on this surface (shared static
      // Bearer API key + optional SPIFFE service identity, not a user session).
      // ★★★ G2-B — đọc `tools`/`tool_choice` TRƯỚC mọi thứ khác trên đường sinh chữ: một yêu cầu
      // sai khuôn hoặc một ràng buộc không cưỡng chế được phải hỏng ở đây, TRƯỚC khi tiêu một
      // token nào của model. Ba lỗi của nó → 400 có mã (xem `xuLyLoiTool` ở khối catch).
      const yeuCauTool = docYeuCauTool(body);
      // ★ Đợt 4B-server — danh sách trắng `chat_template_kwargs` (chỉ `enable_thinking` boolean) ⇒ `disableThinking`.
      const tatNghi = docTatNghi(body);
      const ggufMessagesRaw = toGgufMessages(messages);
      const lastIdx = ggufMessagesRaw.length - 1;
      const representativeText = lastIdx >= 0 ? ggufMessagesRaw[lastIdx].content : "";
      const planned = await planGatewayFailOpen(inferTaskFromLabel(modelLabel), representativeText, nguoiGoi(res));
      plan = planned.plan;
      // Redact every OTHER message directly/ungated (defense-in-depth, mirrors
      // aiChatAssistant's treatment of prior-turn/tool-result text); the last (most recent)
      // message uses the plan's sanitized text so the AI_SAFETY_ENABLED flag governs it uniformly.
      // ⚠ G2-B — `...m` giữ NGUYÊN `role`/`tool_call_id`/`tool_calls`; chỉ ô `content` bị thay.
      // Kết quả tool (message `role:"tool"`) đi qua đúng bộ che bí mật như mọi nội dung khác —
      // nó là chữ do MỘT HỆ THỐNG NGOÀI trả về, tức đúng chỗ một khoá API dễ lọt vào nhất.
      const ggufMessages: GgufChatMessage[] = ggufMessagesRaw.map((m, i) => ({
        ...m,
        content: i === lastIdx ? planned.safeText : redactSecretsAndPII(m.content).text,
      }));
      const id = genId("chatcmpl");
      const created = nowUnix();
      engineStart = Date.now();

      // ── Streaming (SSE, OpenAI chunk shape) ──
      if (body.stream === true) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });

        // Final wave item 2 — `res.on("close")` + socket đã chết ⇒ huỷ ngay. Bản `req.on("close")` cũ
        // đứng sau `await ensureEngine`/`planGatewayFailOpen` nên trên Node 24 không bao giờ chạy.
        const abort = new AbortController();
        huyKhiClientBoDi(req, res, abort);

        // First chunk announces the assistant role.
        const roleChunk = {
          id,
          object: "chat.completion.chunk",
          created,
          model: modelLabel,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(roleChunk)}\n\n`);

        // Chỉ dựng TUỲ CHỌN; lời gọi `chatCompletionStream` đứng NGAY trong handler (sổ `thinkingSurfaces` khoá theo hàm bao).
        const tuyChonLuong = (nghi: { disableThinking?: true }) => ({
          messages: ggufMessages,
          maxTokens,
          temperature,
          topP,
          // ★ G2-B — `...(x ? {k:v} : {})` chứ không `tools: yeuCauTool.tools`: một ô `tools:
          // undefined` vẫn là một ô CÓ MẶT khi ai đó `JSON.stringify` xuống dây, và engine phân
          // biệt "không có tools" bằng `options.tools?.length`. Giữ hình dạng cũ bit-đối-bit cho
          // mọi lượt chat không dùng tool.
          ...(yeuCauTool.tools ? { tools: yeuCauTool.tools, toolChoice: "auto" as const } : {}),
          ...nghi,
        });
        // doc69 G2-3 — stateful per-request redactor: holds back a growing secret across
        // chunk boundaries so it never reaches the SSE client unredacted (reuses the exact
        // G2-2 class — see its doc comment in ai/aiSafety.ts). Review fix — gated behind
        // AI_SAFETY_ENABLED (mirrors the non-stream path's plan.sanitizeOutput, which is
        // already gated inside planInference/aiGateway.ts) so the documented escape hatch
        // actually disables streaming redaction on this surface too.
        const redactor = aiSafetyEnabled() ? new StreamingSecretRedactor() : null;
        // ★ G5-E — bộ cắt suy luận cho luồng: một thực thể cho MỘT cuộc. Đặt TRƯỚC `redactor`
        // trong chuỗi xử lý (xem khối import ở đầu tệp). KHÔNG gán cờ cho nó: `AI_SAFETY_ENABLED`
        // tắt phép che bí mật (best-effort) chứ không được phép mở lại đường phun nội tâm model
        // ra IDE — gắn cờ ở đây là dựng lại đúng lỗ fail-open mà G5-C vừa vá.
        const thinker = new StreamingThinkingStripper();
        let tokensIn = 0;
        let tokensOut = 0;
        // ★ Đợt 4B-server — cho chunk usage: chỉ phát khi engine ĐÃ trả chunk `done` (có số thật để nói).
        let tokensNghi: number | undefined;
        let daCoDone = false;
        let outcome: "ok" | "error" = "ok";
        // ★★★ G2-B — `finish_reason` của luồng này. Chỉ đổi sang "tool_calls" khi ĐÃ THẬT SỰ phát
        // ít nhất một mảnh tool-call ra dây; mặc định giữ nguyên "stop" như trước.
        let daPhatToolCall = false;
        // ★★★ Engine báo lượt bị CẮT ở trần token (`finishReason:"length"`, chunk `done`) ⇒ ô cuối là "length" — giá trị
        // CHUẨN OpenAI — kể cả khi đã phát tool call: tham số của lượt cụt có thể DỞ dù JSON trông hợp lệ, và "tool_calls"
        // ở đây là bảo client đi thực thi nó.
        let biCat = false;
        // ★★★ Đợt 4 — HỎI LẠI ĐÚNG MỘT LẦN với nghĩ TẮT trong CÙNG luồng SSE (cùng `id`, không gửi lại role chunk)
        // khi lượt sinh hỏng vì model trả lời vào kênh suy luận (`maLoiSuyLuanV1`). AN TOÀN vì hai lớp lỗi đó chỉ
        // ném khi content RỖNG và CHƯA có tool call ⇒ trên dây mới có role chunk; mảnh `reasoning` không bao giờ ra dây
        // (nội tâm chỉ phát ở cuối, từ `thinker`). Lưới thứ hai: `daNhanNoiDung` — đã nhận BẤT KỲ mảnh nào ngoài
        // `reasoning` (chữ, kể cả chữ bộ cắt/bộ che còn GIỮ chưa ghi; tool call; lỗi) ⇒ KHÔNG hỏi lại: nối hai lượt
        // suy luận khác nhau vào một câu trả lời là bịa (cùng lý lẽ G1 `daPhatChu`). Chữ suy luận của lượt hỏng bị BỎ.
        let nghiLuot = tatNghi;
        let daNhanNoiDung = false;
        // ★★ Đợt 9 — chữ HIỂN THỊ đã ra dây (cho vòng kiểm biên dịch ST sau bản đầu).
        let chuDaPhat = "";
        for (let daHoiLai = false; ; ) {
          try {
            for await (const chunk of chatCompletionStream(tuyChonLuong(nghiLuot), modelId, abort.signal)) {
              if (res.destroyed) break;
              if (chunk.type !== "reasoning") daNhanNoiDung = true;
              // ★★★ G2-B — mảnh `delta.tool_calls`, phát NGUYÊN VĂN đúng khuôn OpenAI.
              // ⚠ KHÔNG đi qua `thinker`/`redactor`: cả hai là bộ lọc CHỮ hiển thị, stateful theo ô
              // `content`. Đẩy JSON `arguments` qua chúng là (a) làm hỏng JSON khi bộ cắt giữ lại một
              // đoạn giữa, và (b) trộn hai dòng dữ liệu vào một máy trạng thái. Args là dữ liệu có cấu
              // trúc do CLIENT tự thực thi, không phải chữ in ra màn hình.
              if (chunk.type === "tool_call_delta" && chunk.toolCallDelta?.length) {
                daPhatToolCall = true;
                res.write(
                  `data: ${JSON.stringify({
                    id,
                    object: "chat.completion.chunk",
                    created,
                    model: modelLabel,
                    choices: [{ index: 0, delta: { tool_calls: chunk.toolCallDelta }, finish_reason: null }],
                  })}\n\n`,
                );
                continue;
              }
              if (chunk.type === "token" && chunk.token) {
                const visible = thinker.push(chunk.token);
                const safe = redactor ? redactor.push(visible) : visible;
                if (safe) {
                  chuDaPhat += safe;
                  const delta = {
                    id,
                    object: "chat.completion.chunk",
                    created,
                    model: modelLabel,
                    choices: [{ index: 0, delta: { content: safe }, finish_reason: null }],
                  };
                  res.write(`data: ${JSON.stringify(delta)}\n\n`);
                }
              } else if (chunk.type === "done") {
                tokensIn = chunk.tokensPrompt ?? 0;
                tokensOut = chunk.tokensGenerated ?? 0;
                tokensNghi = chunk.tokensReasoning;
                daCoDone = true;
                if (chunk.finishReason === "length") biCat = true;
                // ⚠ Bộ VỚT (build không phân giải `<tool_call>`) chỉ hiện ra ở chunk `done` — không có
                // mảnh delta nào cả. Phát nguyên khối ở đây, nếu không lượt ấy im lặng mất tool-call.
                if (chunk.toolCalls?.length && !daPhatToolCall) {
                  daPhatToolCall = true;
                  res.write(
                    `data: ${JSON.stringify({
                      id,
                      object: "chat.completion.chunk",
                      created,
                      model: modelLabel,
                      choices: [
                        {
                          index: 0,
                          delta: { tool_calls: chunk.toolCalls.map((t, i) => ({ index: i, ...t })) },
                          finish_reason: null,
                        },
                      ],
                    })}\n\n`,
                  );
                }
              } else if (chunk.type === "error") {
                outcome = "error";
                const errChunk = {
                  id,
                  object: "chat.completion.chunk",
                  created,
                  model: modelLabel,
                  choices: [{ index: 0, delta: {}, finish_reason: "error" }],
                  error: { message: chunk.error || "generation error", type: "server_error" },
                };
                res.write(`data: ${JSON.stringify(errChunk)}\n\n`);
              }
            }
            break;
          } catch (err) {
            if (
              daNhanNoiDung ||
              res.destroyed ||
              abort.signal.aborted ||
              !nenHoiLaiNghiTat(err, !!yeuCauTool.tools, !!nghiLuot.disableThinking, daHoiLai)
            ) {
              throw err;
            }
            console.warn(
              `[openaiGateway] /v1 stream: model trả lời vào kênh suy luận (${maLoiSuyLuanV1(err)}) — hỏi lại lượt này MỘT lần với nghĩ TẮT (chữ suy luận bị bỏ, không thực thi).`,
            );
            daHoiLai = true;
            nghiLuot = { disableThinking: true };
          }
        }
        // Release whatever the two stateful filters were still holding back (e.g. a short tail).
        // ⚠ Xả theo ĐÚNG thứ tự chuỗi: phần bộ cắt còn giữ phải chảy QUA bộ che trước khi ra dây.
        const duoiHienThi = thinker.flush();
        const tail = redactor ? `${redactor.push(duoiHienThi)}${redactor.flush()}` : duoiHienThi;
        if (tail && !res.destroyed) {
          chuDaPhat += tail;
          const delta = {
            id,
            object: "chat.completion.chunk",
            created,
            model: modelLabel,
            choices: [{ index: 0, delta: { content: tail }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(delta)}\n\n`);
        }
        // ★★ Đợt 9 — VÒNG KIỂM BIÊN DỊCH ST: bản đầu ĐÃ ra dây nguyên vẹn; GIỮ chunk finish_reason lại, biên dịch (+ sửa
        // tối đa 2 vòng), phát phần BỔ SUNG rồi mới finish_reason + [DONE] (client OpenAI dừng đọc ở finish_reason —
        // dieu-phoi 2026-10-21). Trong lúc chờ phát keep-alive (chú thích SSE) để proxy không cắt. Không có mã ST ⇒ không phát gì.
        let auditKiem: string | undefined;
        if (nenKiemBienDichV1(modelLabel, body, !!yeuCauTool.tools, true) && outcome === "ok" && !daPhatToolCall && !biCat && !res.destroyed) {
          const giuSong = setInterval(() => {
            if (!res.destroyed) res.write(": kiem-bien-dich-st\n\n");
          }, 5_000);
          try {
            const kq = await kiemVaSuaST({
              cauTraLoi: chuDaPhat,
              signal: abort.signal,
              tranMs: tranMsVongSuaST(modelId),
              goiLai: async (tin, lanTruoc) => {
                const t0Sua = Date.now();
                let r2: Awaited<ReturnType<typeof chatCompletion>>;
                try {
                  r2 = await chatCompletion(
                    { ...tuyChonLuong(nghiLuot), messages: [...ggufMessages, { role: "assistant", content: lanTruoc }, { role: "user", content: tin }] },
                    modelId,
                  );
                } catch (e) {
                  ghiLuotSuaST(plan, id, t0Sua, null);
                  throw e;
                }
                ghiLuotSuaST(plan, id, t0Sua, r2);
                const hien = catGiuNguyenBien(r2.text).hienThi;
                return plan?.sanitizeOutput(hien) ?? hien;
              },
            });
            const boSung = phanBoSungLuong(kq);
            if (boSung && !res.destroyed) {
              res.write(
                `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelLabel, choices: [{ index: 0, delta: { content: boSung }, finish_reason: null }] })}\n\n`,
              );
            }
            auditKiem = auditKiemBienDich(kq);
            if (kq.trangThai !== "bo-qua") console.log(`[openaiGateway] /v1 kiểm biên dịch ST (stream): ${headerKiemBienDich(kq)} · +${kq.msThem} ms`);
          } catch (e) {
            console.warn("[openaiGateway] /v1 kiểm biên dịch ST hỏng (bỏ qua, không chặn):", (e as Error)?.message ?? e);
          } finally {
            clearInterval(giuSong);
          }
        }
        // ★ G5-E — nội tâm model ra ô RIÊNG `delta.reasoning_content` (xem quyết định ở
        // `reasoningFieldEnabled`). Gộp thành MỘT chunk sau phần chữ: client chuẩn nối các
        // `reasoning_content` lại nên kết quả giống hệt, còn ta không phải đoán ranh giới nội tâm
        // giữa chừng. Bí mật trong nội tâm VẪN rời máy chủ ⇒ phải che (bộ che luồng là stateful
        // theo ô `content`, nên khối gộp này dùng bản một-lượt).
        if (reasoningFieldEnabled() && thinker.thinking && !res.destroyed) {
          const noiTam = aiSafetyEnabled() ? redactSecretsAndPII(thinker.thinking).text : thinker.thinking;
          res.write(
            `data: ${JSON.stringify({
              id,
              object: "chat.completion.chunk",
              created,
              model: modelLabel,
              choices: [{ index: 0, delta: { reasoning_content: noiTam }, finish_reason: null }],
            })}\n\n`,
          );
        }
        // doc69 G2-3 — gateway metering: this traffic was previously completely invisible.
        // `plan?.` — no-op when the fail-open rate-limit path left `plan` null.
        plan?.record({ tokensIn, tokensOut, latencyMs: Date.now() - engineStart, outcome, requestId: id, ...(auditKiem ? { auditSnippet: auditKiem } : {}) });

        const doneChunk = {
          id,
          object: "chat.completion.chunk",
          created,
          model: modelLabel,
          // ★ G2-B — client chuẩn (OpenAI SDK, Continue, Cline) dùng ĐÚNG ô này để biết phải đi
          // thực thi tool rồi quay lại, thay vì in câu trả lời ra cho người dùng.
          choices: [{ index: 0, delta: {}, finish_reason: biCat ? "length" : daPhatToolCall ? "tool_calls" : "stop" }],
        };
        res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
        if (xinUsageLuong(body) && daCoDone && !res.destroyed) {
          res.write(
            `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelLabel, choices: [], usage: usageOpenAi(tokensIn, tokensOut, tokensNghi) })}\n\n`,
          );
        }
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      // ── Non-streaming ──
      // Chỉ dựng TUỲ CHỌN; lời gọi `chatCompletion` đứng NGAY trong handler (sổ `thinkingSurfaces` khoá theo hàm bao).
      const tuyChonMotLan = (nghi: { disableThinking?: true }) => ({
        messages: ggufMessages,
        maxTokens,
        temperature,
        topP,
        ...(yeuCauTool.tools ? { tools: yeuCauTool.tools, toolChoice: "auto" as const } : {}),
        ...nghi,
      });
      let result: Awaited<ReturnType<typeof chatCompletion>>;
      try {
        result = await chatCompletion(tuyChonMotLan(tatNghi), modelId);
      } catch (err) {
        // ★★★ Đợt 4 — cùng chính sách với nhánh stream: hỏi lại ĐÚNG MỘT lần với nghĩ TẮT (chưa có byte nào ra dây).
        if (!nenHoiLaiNghiTat(err, !!yeuCauTool.tools, !!tatNghi.disableThinking, false)) throw err;
        console.warn(
          `[openaiGateway] /v1: model trả lời vào kênh suy luận (${maLoiSuyLuanV1(err)}) — hỏi lại lượt này MỘT lần với nghĩ TẮT (chữ suy luận bị bỏ, không thực thi).`,
        );
        result = await chatCompletion(tuyChonMotLan({ disableThinking: true }), modelId);
      }
      // doc69 G2-3 — gateway metering: this traffic was previously completely invisible.
      // ★ Đợt 9 — ghi SAU vòng kiểm biên dịch ST (bên dưới) để mang mẩu audit của nó; độ trễ chốt NGAY sau lượt model (như cũ).
      const msMotLan = Date.now() - engineStart;
      const ghiDoDem = (auditSnippet?: string) =>
        plan?.record({
          tokensIn: result.tokensPrompt,
          tokensOut: result.tokensGenerated,
          latencyMs: msMotLan,
          outcome: "ok",
          requestId: id,
          ...(auditSnippet ? { auditSnippet } : {}),
        });
      // ★ G5-E — cắt thẻ TRƯỚC `sanitizeOutput` (bộ canh NỘI DUNG đứng CUỐI — xem khối import).
      const catChat = catGiuNguyenBien(result.text);
      const chatHienThi = plan?.sanitizeOutput(catChat.hienThi) ?? catChat.hienThi;
      const chatNoiTam = catChat.noiTam ? (plan?.sanitizeOutput(catChat.noiTam) ?? catChat.noiTam) : "";
      // ★★★ G2-B — các lượt gọi tool model TỰ QUYẾT ĐỊNH phát ra.
      // ⚠ `arguments` KHÔNG đi qua `sanitizeOutput`/`stripThinking`: xem lý lẽ ở nhánh streaming
      // (bộ lọc chữ làm hỏng JSON có cấu trúc). Đây là ĐÁNH ĐỔI CÓ CHỦ ĐÍCH và phải nói ra: một
      // bí mật mà chính người dùng dán vào câu hỏi có thể quay lại trong `arguments`. Chấp nhận
      // được vì (a) args do CLIENT tự thực thi, không hiện lên màn hình ai khác, và (b) che một
      // phần JSON sẽ tạo ra args KHÔNG PARSE ĐƯỢC — hỏng nặng hơn hẳn, và hỏng trong im lặng.
      const toolCallsRa = (result.toolCalls ?? []).filter(toolCallHopLe) as NativeToolCall[];
      // ★★ Đợt 9 — VÒNG KIỂM BIÊN DỊCH ST (không stream): chạy TRƯỚC khi trả; bản cuối + một dòng ghi chú (không thay lặng lẽ),
      // header `x-st4i-bien-dich`. Không có mã ST ⇒ nội dung nguyên vẹn, header `ok=skip`.
      let noiDungRa = chatHienThi;
      let auditKiemMotLan: string | undefined;
      if (nenKiemBienDichV1(modelLabel, body, !!yeuCauTool.tools, false) && !toolCallsRa.length && result.finishReason !== "length") {
        try {
          const kq = await kiemVaSuaST({
            cauTraLoi: chatHienThi,
            tranMs: tranMsVongSuaST(modelId),
            goiLai: async (tin, lanTruoc) => {
              const t0Sua = Date.now();
              let r2: Awaited<ReturnType<typeof chatCompletion>>;
              try {
                r2 = await chatCompletion(
                  { ...tuyChonMotLan(tatNghi), messages: [...ggufMessages, { role: "assistant", content: lanTruoc }, { role: "user", content: tin }] },
                  modelId,
                );
              } catch (e) {
                ghiLuotSuaST(plan, id, t0Sua, null);
                throw e;
              }
              ghiLuotSuaST(plan, id, t0Sua, r2);
              const hien = catGiuNguyenBien(r2.text).hienThi;
              return plan?.sanitizeOutput(hien) ?? hien;
            },
          });
          const nhan = nhanKiemBienDich(kq);
          noiDungRa = nhan ? `${kq.cauTraLoiCuoi}\n\n---\n${nhan}` : kq.cauTraLoiCuoi;
          if (!res.headersSent) res.setHeader("x-st4i-bien-dich", headerKiemBienDich(kq));
          auditKiemMotLan = auditKiemBienDich(kq);
        } catch (e) {
          console.warn("[openaiGateway] /v1 kiểm biên dịch ST hỏng (bỏ qua, không chặn):", (e as Error)?.message ?? e);
        }
      }
      ghiDoDem(auditKiemMotLan);
      res.json({
        id,
        object: "chat.completion",
        created,
        model: modelLabel,
        choices: [
          {
            index: 0,
            // doc69 G2-3 — output safety: redact any secret the model echoed back.
            message: {
              role: "assistant",
              content: noiDungRa,
              // Ô chỉ MỌC RA khi thật sự có nội tâm ⇒ đầu ra roster hiện tại giữ nguyên hình dạng.
              ...(reasoningFieldEnabled() && chatNoiTam ? { reasoning_content: chatNoiTam } : {}),
              // ⚠⚠ Ô này MỌC RA hay KHÔNG — **không bao giờ là `[]`**. Đó chính là lời nói dối mà
              // G2-B xoá bỏ (`_core/llm.ts` trả `tool_calls: []` như hằng số): một mảng rỗng không
              // phân biệt được "model không muốn gọi tool" với "chẳng ai từng hỏi model cả".
              ...(toolCallsRa.length ? { tool_calls: toolCallsRa } : {}),
            },
            // ★★★ "length" (lượt bị cắt ở trần token) thắng "tool_calls" — xem `biCat` ở nhánh stream.
            finish_reason: result.finishReason === "length" ? "length" : toolCallsRa.length ? "tool_calls" : "stop",
          },
        ],
        usage: {
          prompt_tokens: result.tokensPrompt,
          completion_tokens: result.tokensGenerated,
          total_tokens: result.tokensPrompt + result.tokensGenerated,
        },
      });
    } catch (err: any) {
      // ★ G2-B — ba lỗi tool-calling (cờ tắt · `tools` sai khuôn · `tool_choice` không cưỡng chế
      // được) → 400 CÓ MÃ. Đặt TRƯỚC mọi nhánh khác: chúng bật ra trước khi `plan` tồn tại, và
      // rơi vào catch-all sẽ thành HTTP 500 "server_error" — giống hệt một lượt engine chết, tức
      // client không có gì để hành động. Đúng lớp lỗi mà `handleEnforcementError` đã phải vá một lần.
      if (xuLyLoiTool(res, err)) return;
      if (err instanceof SafetyBlockedError) {
        // planInference already recorded 'blocked' telemetry internally before throwing
        // (see aiGateway.ts) — nothing more to record here.
        if (!res.headersSent) jsonError(res, 400, err.message, "invalid_request_error", "safety_blocked");
        else res.end();
        return;
      }
      // Review fix (W1-4) — QuotaExceededError → 429, LicenseGateError → 403 (both already
      // metered internally by planInference before throwing — see aiGateway.ts).
      if (handleEnforcementError(res, err)) return;
      // Review fix — record an 'error' metric on EVERY other failure path (previously only
      // FIM-streaming did this; chat non-stream + chat stream generator-throw were invisible
      // to ai_gateway_metrics). Idempotent (aiGateway.ts's record() only counts the first
      // call) and a safe no-op when `plan` is null (fail-open path, or failure before the
      // plan was created).
      plan?.record({ latencyMs: engineStart ? Date.now() - engineStart : 0, outcome: "error" });
      // ★★★ Đợt 4 — lớp "trả lời vào kênh suy luận" mang `code` để client hành động được (vd hỏi lại nghĩ TẮT).
      const maSuyLuan = maLoiSuyLuanV1(err);
      if (!res.headersSent) {
        jsonError(res, 500, thongDiepLoiChoKhachV1(err, "chat completion failed"), "server_error", maSuyLuan ?? undefined);
      } else {
        res.write(
          // data-raw-ok: khung lỗi SSE theo ĐÚNG chuẩn OpenAI — khách là API client (SDK
          // openai, LangChain…) parse trường `error.message` này theo hợp đồng của họ.
          // Dịch nó sang tiếng Việt là phá tương thích, không phải cải thiện.
          // (Dấu phải nằm NGAY TRÊN dòng chứa `message:` — bộ quét F14 chỉ đọc khối chú thích liền kề.)
          `data: ${JSON.stringify({ error: { message: thongDiepLoiChoKhachV1(err, "error"), ...(maSuyLuan ? { type: "server_error", code: maSuyLuan } : {}) } })}\n\n`,
        );
        res.end();
      }
    }
  });

  // ─── POST /completions (text + FIM) ──────────────────────────
  router.post("/completions", async (req: Request, res: Response) => {
    // Review fix — see /chat/completions above for the rationale (fail-open rate limit +
    // complete error metering).
    let plan: GatewayPlan | null = null;
    let engineStart = 0;
    try {
      if (!(await ensureEngine(res))) return;
      const body = req.body ?? {};
      const rawPrompt = body.prompt;
      const prompt = typeof rawPrompt === "string" ? rawPrompt : Array.isArray(rawPrompt) ? String(rawPrompt[0] ?? "") : "";
      const suffix = typeof body.suffix === "string" ? body.suffix : "";
      if (!prompt && !suffix) {
        jsonError(res, 400, "`prompt` (string) is required.");
        return;
      }

      const isFim = suffix.length > 0;
      const kiem = kiemModelV1(typeof body.model === "string" && body.model ? body.model : isFim ? "fim" : "code");
      // ★ M4 (audit kiem-dinh) — như /chat/completions.
      if (!kiem.ok) {
        jsonError(res, 400, "Unknown model.", "invalid_request_error", "model_not_found");
        return;
      }
      const modelLabel = kiem.ten;
      const modelId = apTranDoiKhe(res, resolveModelId(modelLabel));
      const maxTokens = Number.isFinite(body.max_tokens) ? Number(body.max_tokens) : isFim ? 256 : 1024;
      const temperature = Number.isFinite(body.temperature) ? Number(body.temperature) : isFim ? 0.2 : 0.7;
      const topP = Number.isFinite(body.top_p) ? Number(body.top_p) : undefined;

      // doc69 G2-3 / review fix — AI Gateway (see /chat/completions above for the "never
      // override the caller's explicit model" rationale — `modelId` above stays the single
      // source of truth for generation, and the fail-open rate-limit rationale). `suffix`
      // (FIM's surrounding code context) is redacted directly/ungated, mirroring
      // aiChatAssistant's treatment of supplementary content.
      const planned = await planGatewayFailOpen(isFim ? "fim" : "code", prompt, nguoiGoi(res));
      plan = planned.plan;
      const safeSuffix = suffix ? redactSecretsAndPII(suffix).text : suffix;

      // Native fill-in-middle via the engine's generateFim (LlamaCompletion.generateInfillCompletion
      // when the coder model supports infill; raw completion otherwise) — no chat template, so the
      // model returns clean inline code for Continue autocomplete. `suffix` present → real infill.
      // ★ Đợt 4C-server — `stop` của caller (ghost-text cắt ở ranh giới dòng/khối); lạ ⇒ bỏ, khoá vắng như cũ.
      const stopSequences = docStopFim(body.stop);
      const fimOpts = { prefix: planned.safeText, suffix: safeSuffix, maxTokens, temperature, topP, ...(stopSequences ? { stopSequences } : {}) };

      const id = genId("cmpl");
      const created = nowUnix();
      engineStart = Date.now();

      // ── Streaming (SSE, OpenAI text_completion shape). generateFim is non-streaming, so emit the
      //    whole completion as ONE chunk then [DONE] — fine for short inline autocomplete. ──
      if (body.stream === true) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        // ★ Đợt 4B-server — usage của luồng FIM (opt-in, chỉ khi `stream_options.include_usage: true`).
        let usageFim: Record<string, unknown> | null = null;
        try {
          const result = await generateFim(fimOpts, modelId);
          usageFim = usageOpenAi(result.tokensPrompt, result.tokensGenerated);
          // doc69 G2-3 — gateway metering: this traffic was previously completely invisible.
          plan?.record({
            tokensIn: result.tokensPrompt,
            tokensOut: result.tokensGenerated,
            latencyMs: Date.now() - engineStart,
            outcome: "ok",
          });
          // ★ G5-E — nội tâm BỎ HẲN ở tuyến FIM (không ô nào hợp lệ để mang nó, và chữ này chèn
          // thẳng vào tệp mã nguồn). Cắt TRƯỚC `sanitizeOutput`; giữ nguyên khoảng trắng biên.
          const fimStream = catGiuNguyenBien(result.text).hienThi;
          if (!res.destroyed && fimStream) {
            res.write(
              // doc69 G2-3 — output safety: redact any secret the model echoed back.
              `data: ${JSON.stringify({ id, object: "text_completion", created, model: modelLabel, choices: [{ index: 0, text: plan?.sanitizeOutput(fimStream) ?? fimStream, finish_reason: null }] })}\n\n`,
            );
          }
        } catch (e: any) {
          plan?.record({ latencyMs: Date.now() - engineStart, outcome: "error" });
          // data-raw-ok: khung lỗi SSE chuẩn OpenAI — xem ghi chú ở nhánh chat phía trên.
          res.write(
            // data-raw-ok: khung lỗi SSE chuẩn OpenAI — xem ghi chú ở nhánh chat phía trên.
            `data: ${JSON.stringify({ id, object: "text_completion", created, model: modelLabel, choices: [{ index: 0, text: "", finish_reason: "error" }], error: { message: e?.message || "generation error" } })}\n\n`,
          );
        }
        res.write(
          `data: ${JSON.stringify({ id, object: "text_completion", created, model: modelLabel, choices: [{ index: 0, text: "", finish_reason: "stop" }] })}\n\n`,
        );
        if (usageFim && xinUsageLuong(body) && !res.destroyed) {
          res.write(`data: ${JSON.stringify({ id, object: "text_completion", created, model: modelLabel, choices: [], usage: usageFim })}\n\n`);
        }
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      // ── Non-streaming ──
      const result = await generateFim(fimOpts, modelId);
      // doc69 G2-3 — gateway metering: this traffic was previously completely invisible.
      plan?.record({
        tokensIn: result.tokensPrompt,
        tokensOut: result.tokensGenerated,
        latencyMs: Date.now() - engineStart,
        outcome: "ok",
      });
      // ★ G5-E — như nhánh stream ở trên: cắt thẻ TRƯỚC, nội tâm BỎ HẲN, khoảng trắng biên giữ nguyên.
      const fimText = catGiuNguyenBien(result.text).hienThi;
      res.json({
        id,
        object: "text_completion",
        created,
        model: modelLabel,
        // doc69 G2-3 — output safety: redact any secret the model echoed back.
        choices: [{ index: 0, text: plan?.sanitizeOutput(fimText) ?? fimText, finish_reason: "stop", logprobs: null }],
        usage: {
          prompt_tokens: result.tokensPrompt,
          completion_tokens: result.tokensGenerated,
          total_tokens: result.tokensPrompt + result.tokensGenerated,
        },
      });
    } catch (err: any) {
      if (err instanceof SafetyBlockedError) {
        // planInference already recorded 'blocked' telemetry internally before throwing
        // (see aiGateway.ts) — nothing more to record here.
        if (!res.headersSent) jsonError(res, 400, err.message, "invalid_request_error", "safety_blocked");
        else res.end();
        return;
      }
      // Review fix (W1-4) — QuotaExceededError → 429, LicenseGateError → 403 (both already
      // metered internally by planInference before throwing — see aiGateway.ts).
      if (handleEnforcementError(res, err)) return;
      // Review fix — record an 'error' metric on the non-stream failure path too (previously
      // only FIM-streaming's inner try/catch did this). Idempotent + safe no-op when `plan`
      // is null (fail-open path, or failure before the plan was created).
      plan?.record({ latencyMs: engineStart ? Date.now() - engineStart : 0, outcome: "error" });
      if (!res.headersSent) {
        jsonError(res, 500, thongDiepLoiChoKhachV1(err, "completion failed"), "server_error");
      } else {
        // data-raw-ok: khung lỗi SSE chuẩn OpenAI — xem ghi chú ở nhánh chat phía trên.
        res.write(`data: ${JSON.stringify({ error: { message: thongDiepLoiChoKhachV1(err, "error") } })}\n\n`);
        res.end();
      }
    }
  });

  // ─── POST /embeddings ────────────────────────────────────────
  router.post("/embeddings", async (req: Request, res: Response) => {
    try {
      if (!(await ensureEngine(res))) return;
      const body = req.body ?? {};
      const input = body.input;
      const modelLabel = typeof body.model === "string" && body.model ? body.model : "embed";

      const inputs: string[] =
        typeof input === "string"
          ? [input]
          : Array.isArray(input)
            ? input.map((x) => String(x))
            : [];
      if (inputs.length === 0 || inputs.every((s) => s.length === 0)) {
        jsonError(res, 400, "`input` must be a non-empty string or array of strings.");
        return;
      }

      // Embeddings always use the dedicated embed model. Pass the RESOLVED (extension-
      // stripped) basename explicitly — the engine appends ".gguf", and GGUF_EMBED_MODEL
      // already carries it, so relying on the undefined-default would double it ("...gguf.gguf").
      const embedId = resolveModelId("embed");
      let vectors: number[][];
      if (inputs.length === 1) {
        const r = await generateEmbedding(inputs[0], embedId);
        vectors = [r.embedding];
      } else {
        const r = await generateEmbeddings(inputs, embedId);
        vectors = r.embeddings;
      }

      const promptTokens = inputs.reduce((s, t) => s + estimateTokens(t), 0);
      res.json({
        object: "list",
        data: vectors.map((embedding, index) => ({ object: "embedding", index, embedding })),
        model: modelLabel,
        usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
      });
    } catch (err: any) {
      jsonError(res, 500, thongDiepLoiChoKhachV1(err, "embeddings failed"), "server_error");
    }
  });

  // OpenAI-shaped 404 for any other path under the gateway base.
  router.use((_req: Request, res: Response) => {
    jsonError(res, 404, "Unknown gateway endpoint.", "invalid_request_error", "not_found");
  });

  return router;
}

// ─── Registration (mirrors registerAiStreamingRoutes in _core/index.ts) ─────────

/**
 * Mount the OpenAI-compatible gateway on the Express app when enabled.
 * Fail-closed: enabled + empty OPENAI_GATEWAY_API_KEY ⇒ do NOT mount + log error.
 * Returns true when mounted, false otherwise (disabled or refused).
 */
export function registerOpenAiGateway(app: Express): boolean {
  if (!envBool("OPENAI_GATEWAY_ENABLED")) {
    return false; // default OFF — not mounted, /v1/* → 404
  }

  const apiKey = envStr("OPENAI_GATEWAY_API_KEY");
  // ★ Đợt 4A — cờ key chung TẮT tường minh ⇒ chế độ CHỈ-TOKEN: gắn cổng mà không cần key (mọi yêu cầu vẫn phải mang
  //   token cá nhân hợp lệ — không có đường nào vào cổng mà không xác thực). Cờ BẬT (mặc định) + key rỗng ⇒ từ chối
  //   gắn NHƯ CŨ: một người cấu hình cũ quên key không được lặng lẽ thấy cổng mọc lên.
  if (!keyChungBat()) {
    const basePath = envStr("OPENAI_GATEWAY_PATH") || "/v1";
    app.use(basePath, createOpenAiGatewayRouter({ apiKey: "" }));
    console.log(`[openaiGateway] OpenAI-compatible gateway mounted at ${basePath} — CHỈ token người dùng (key chung TẮT).`);
    return true;
  }
  if (!apiKey) {
    console.error(
      "[openaiGateway] REFUSING to mount: OPENAI_GATEWAY_ENABLED is on but " +
        "OPENAI_GATEWAY_API_KEY is empty. An unauthenticated LLM endpoint will " +
        "NOT be exposed. Set OPENAI_GATEWAY_API_KEY to enable the gateway.",
    );
    return false;
  }

  const basePath = envStr("OPENAI_GATEWAY_PATH") || "/v1";
  // ⚠⚠⚠ 2026-08-19 — **CỐ Ý KHÔNG gắn `chanTuyenAiTheoGiayPhep()` ở đây**, và lý do là một PHÉP
  //     ĐO, không phải khẩu vị. Lượt nối cổng `MOD_AI` đã thử gắn nó vào đúng dòng này và làm ĐỎ
  //     **5 ca** ở `openaiGatewayEnforcement.test.ts` + 2 file lưới khác của cổng này. Đọc kỹ vì
  //     sao trước khi ai đó "sửa lại cho đủ":
  //       1. Bề mặt này **ĐÃ CÓ** đường cưỡng chế giấy phép RIÊNG, và nó **cố ý opt-in**:
  //          `aiGateway.planInference` gọi `isModuleLicensed("MOD_AI")` khi
  //          `AI_GATEWAY_LICENSE_GATE_ENABLED=true` (doc69 G2-4, mặc định TẮT để KHÔNG làm hỏng
  //          các deployment có license ra đời TRƯỚC khi `MOD_AI` được khai tường minh). Gắn thêm
  //          một middleware chặn ở tầng tuyến là **ghi đè một quyết định đã cân nhắc** bằng một
  //          dòng `.use()`.
  //       2. **Hình dạng thân lỗi khác nhau.** Client của `/v1` là công cụ tương thích OpenAI
  //          (VS Code + Continue); chúng đọc `{ error: { type: "permission_error", … } }`.
  //          Middleware chung trả `{ success, error, code }` — đúng cho `/api/ai/**`, **sai** cho
  //          đây, và các lưới trên khẳng định đúng điều đó.
  //       3. Bề mặt này mặc định **KHÔNG được gắn** (`OPENAI_GATEWAY_ENABLED` mặc định TẮT) và
  //          fail-closed khi thiếu `OPENAI_GATEWAY_API_KEY`.
  //     ⇒ Muốn khoá `/v1` theo giấy phép: bật `AI_GATEWAY_LICENSE_GATE_ENABLED=true` — đó là công
  //       tắc đã có chủ, có lưới, và trả đúng hình dạng lỗi.
  app.use(basePath, createOpenAiGatewayRouter({ apiKey }));
  console.log(
    `[openaiGateway] OpenAI-compatible gateway mounted at ${basePath} ` +
      `(chat/completions · completions[FIM] · embeddings · models). ` +
      `Bearer-auth required; intended for localhost/LAN engineer use only.`,
  );
  console.warn(
    "[openaiGateway] KEY CHUNG OPENAI_GATEWAY_API_KEY đang BẬT (deprecate — không gắn người dùng). Token cá nhân `avgw_…` " +
      "cũng được nhận; khi mọi client đã chuyển, đặt OPENAI_GATEWAY_SHARED_KEY_ENABLED=0.",
  );
  return true;
}
