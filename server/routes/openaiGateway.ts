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
  RateLimitError,
  SafetyBlockedError,
  QuotaExceededError,
  LicenseGateError,
  type TaskKind,
  type GatewayPlan,
} from "../services/aiGateway";
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
import { resolveLogicalModel } from "../services/ai/modelResolver";
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
  if (key === "code" || key === "coder") return "code";
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
async function planGatewayFailOpen(task: TaskKind, text: string | undefined): Promise<PlannedCall> {
  try {
    const plan = await planInference({ task, text });
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

// ─── Router factory ─────────────────────────────────────────────────────────────

export interface OpenAiGatewayConfig {
  /** Bearer token every request must present (constant-time compared). Required. */
  apiKey: string;
}

/**
 * Build the OpenAI-compatible router. Exported so tests can mount it directly.
 * Callers MUST pass a non-empty apiKey (the register function enforces this and
 * refuses to mount otherwise).
 */
export function createOpenAiGatewayRouter(config: OpenAiGatewayConfig): Router {
  const router = Router();
  const apiKey = config.apiKey;

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
  router.use((req: Request, res: Response, next) => {
    const token = extractBearer(req);
    if (!apiKey || !token || !timingSafeEqualStr(token, apiKey)) {
      jsonError(
        res,
        401,
        "Invalid API key. Provide 'Authorization: Bearer <OPENAI_GATEWAY_API_KEY>'.",
        "invalid_request_error",
        "invalid_api_key",
      );
      return;
    }
    next();
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
    res.json({
      object: "list",
      data: LOGICAL_MODELS.map((id) => ({
        id,
        object: "model",
        created,
        owned_by: "st4i-local",
        root: backingFor(id),
      })),
    });
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

      const modelLabel = typeof body.model === "string" && body.model ? body.model : "chat";
      const modelId = resolveModelId(body.model);
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
      const ggufMessagesRaw = toGgufMessages(messages);
      const lastIdx = ggufMessagesRaw.length - 1;
      const representativeText = lastIdx >= 0 ? ggufMessagesRaw[lastIdx].content : "";
      const planned = await planGatewayFailOpen(inferTaskFromLabel(modelLabel), representativeText);
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

        const abort = new AbortController();
        req.on("close", () => abort.abort());

        // First chunk announces the assistant role.
        const roleChunk = {
          id,
          object: "chat.completion.chunk",
          created,
          model: modelLabel,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(roleChunk)}\n\n`);

        const stream = chatCompletionStream(
          {
            messages: ggufMessages,
            maxTokens,
            temperature,
            topP,
            // ★ G2-B — `...(x ? {k:v} : {})` chứ không `tools: yeuCauTool.tools`: một ô `tools:
            // undefined` vẫn là một ô CÓ MẶT khi ai đó `JSON.stringify` xuống dây, và engine phân
            // biệt "không có tools" bằng `options.tools?.length`. Giữ hình dạng cũ bit-đối-bit cho
            // mọi lượt chat không dùng tool.
            ...(yeuCauTool.tools ? { tools: yeuCauTool.tools, toolChoice: "auto" as const } : {}),
          },
          modelId,
          abort.signal,
        );
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
        let outcome: "ok" | "error" = "ok";
        // ★★★ G2-B — `finish_reason` của luồng này. Chỉ đổi sang "tool_calls" khi ĐÃ THẬT SỰ phát
        // ít nhất một mảnh tool-call ra dây; mặc định giữ nguyên "stop" như trước.
        let daPhatToolCall = false;
        for await (const chunk of stream) {
          if (res.destroyed) break;
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
        // Release whatever the two stateful filters were still holding back (e.g. a short tail).
        // ⚠ Xả theo ĐÚNG thứ tự chuỗi: phần bộ cắt còn giữ phải chảy QUA bộ che trước khi ra dây.
        const duoiHienThi = thinker.flush();
        const tail = redactor ? `${redactor.push(duoiHienThi)}${redactor.flush()}` : duoiHienThi;
        if (tail && !res.destroyed) {
          const delta = {
            id,
            object: "chat.completion.chunk",
            created,
            model: modelLabel,
            choices: [{ index: 0, delta: { content: tail }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(delta)}\n\n`);
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
        plan?.record({ tokensIn, tokensOut, latencyMs: Date.now() - engineStart, outcome });

        const doneChunk = {
          id,
          object: "chat.completion.chunk",
          created,
          model: modelLabel,
          // ★ G2-B — client chuẩn (OpenAI SDK, Continue, Cline) dùng ĐÚNG ô này để biết phải đi
          // thực thi tool rồi quay lại, thay vì in câu trả lời ra cho người dùng.
          choices: [{ index: 0, delta: {}, finish_reason: daPhatToolCall ? "tool_calls" : "stop" }],
        };
        res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      // ── Non-streaming ──
      const result = await chatCompletion(
        {
          messages: ggufMessages,
          maxTokens,
          temperature,
          topP,
          ...(yeuCauTool.tools ? { tools: yeuCauTool.tools, toolChoice: "auto" as const } : {}),
        },
        modelId,
      );
      // doc69 G2-3 — gateway metering: this traffic was previously completely invisible.
      plan?.record({
        tokensIn: result.tokensPrompt,
        tokensOut: result.tokensGenerated,
        latencyMs: Date.now() - engineStart,
        outcome: "ok",
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
              content: chatHienThi,
              // Ô chỉ MỌC RA khi thật sự có nội tâm ⇒ đầu ra roster hiện tại giữ nguyên hình dạng.
              ...(reasoningFieldEnabled() && chatNoiTam ? { reasoning_content: chatNoiTam } : {}),
              // ⚠⚠ Ô này MỌC RA hay KHÔNG — **không bao giờ là `[]`**. Đó chính là lời nói dối mà
              // G2-B xoá bỏ (`_core/llm.ts` trả `tool_calls: []` như hằng số): một mảng rỗng không
              // phân biệt được "model không muốn gọi tool" với "chẳng ai từng hỏi model cả".
              ...(toolCallsRa.length ? { tool_calls: toolCallsRa } : {}),
            },
            finish_reason: toolCallsRa.length ? "tool_calls" : "stop",
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
      if (!res.headersSent) {
        jsonError(res, 500, err?.message || "chat completion failed", "server_error");
      } else {
        res.write(`data: ${JSON.stringify({ error: { message: err?.message || "error" } })}\n\n`);
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
      const modelLabel = typeof body.model === "string" && body.model ? body.model : isFim ? "fim" : "code";
      const modelId = resolveModelId(body.model || (isFim ? "fim" : "code"));
      const maxTokens = Number.isFinite(body.max_tokens) ? Number(body.max_tokens) : isFim ? 256 : 1024;
      const temperature = Number.isFinite(body.temperature) ? Number(body.temperature) : isFim ? 0.2 : 0.7;
      const topP = Number.isFinite(body.top_p) ? Number(body.top_p) : undefined;

      // doc69 G2-3 / review fix — AI Gateway (see /chat/completions above for the "never
      // override the caller's explicit model" rationale — `modelId` above stays the single
      // source of truth for generation, and the fail-open rate-limit rationale). `suffix`
      // (FIM's surrounding code context) is redacted directly/ungated, mirroring
      // aiChatAssistant's treatment of supplementary content.
      const planned = await planGatewayFailOpen(isFim ? "fim" : "code", prompt);
      plan = planned.plan;
      const safeSuffix = suffix ? redactSecretsAndPII(suffix).text : suffix;

      // Native fill-in-middle via the engine's generateFim (LlamaCompletion.generateInfillCompletion
      // when the coder model supports infill; raw completion otherwise) — no chat template, so the
      // model returns clean inline code for Continue autocomplete. `suffix` present → real infill.
      const fimOpts = { prefix: planned.safeText, suffix: safeSuffix, maxTokens, temperature, topP };

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
        try {
          const result = await generateFim(fimOpts, modelId);
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
          res.write(
            `data: ${JSON.stringify({ id, object: "text_completion", created, model: modelLabel, choices: [{ index: 0, text: "", finish_reason: "error" }], error: { message: e?.message || "generation error" } })}\n\n`,
          );
        }
        res.write(
          `data: ${JSON.stringify({ id, object: "text_completion", created, model: modelLabel, choices: [{ index: 0, text: "", finish_reason: "stop" }] })}\n\n`,
        );
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
        jsonError(res, 500, err?.message || "completion failed", "server_error");
      } else {
        res.write(`data: ${JSON.stringify({ error: { message: err?.message || "error" } })}\n\n`);
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
      jsonError(res, 500, err?.message || "embeddings failed", "server_error");
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
  if (!apiKey) {
    console.error(
      "[openaiGateway] REFUSING to mount: OPENAI_GATEWAY_ENABLED is on but " +
        "OPENAI_GATEWAY_API_KEY is empty. An unauthenticated LLM endpoint will " +
        "NOT be exposed. Set OPENAI_GATEWAY_API_KEY to enable the gateway.",
    );
    return false;
  }

  const basePath = envStr("OPENAI_GATEWAY_PATH") || "/v1";
  app.use(basePath, createOpenAiGatewayRouter({ apiKey }));
  console.log(
    `[openaiGateway] OpenAI-compatible gateway mounted at ${basePath} ` +
      `(chat/completions · completions[FIM] · embeddings · models). ` +
      `Bearer-auth required; intended for localhost/LAN engineer use only.`,
  );
  return true;
}
