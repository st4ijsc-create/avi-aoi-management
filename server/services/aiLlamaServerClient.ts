/**
 * doc 48 R5 — PERSISTENT LLAMA-SERVER CLIENT.
 *
 * The deep generative model (exec-summary, ops-chat, RCA) is normally loaded
 * IN-PROCESS via node-llama-cpp, where it competes with the always-resident
 * embedder for the single GPU's VRAM (32 GB). Under contention the deep model
 * fails to load and generation silently degrades to offline templates.
 *
 * This client lets the deep model run in a SEPARATE, PERSISTENT llama.cpp server
 * process (`llama-server`, OpenAI-compatible /v1/chat/completions) that owns its
 * own VRAM budget and stays warm. The API process keeps only the small embedder
 * in-process and forwards deep-model text generation over HTTP. No extra GPU
 * purchase: llama-server + the embedder are sized to co-reside (see the runbook
 * scripts/ai/llama-server.md).
 *
 * DEFAULT OFF (LLAMA_SERVER_ENABLED !== "true"): every call returns "not routed"
 * and the engine uses its existing in-process path byte-for-byte. When ON, only
 * text generation for the SERVER'S model is routed; embeddings, vision, and any
 * other model stay in-process. On a server error the engine falls back in-process
 * unless LLAMA_SERVER_STRICT=true (then it throws, so honest-degrade/offline
 * templates kick in rather than a silent wrong-path).
 *
 * doc69 G2-6 — ROBUSTNESS: the engine (aiGgufEngine.generateText/generateJSON) runs
 * preflightHealthy() (short timeout, LLAMA_SERVER_HEALTH_TIMEOUT_MS, default 2s) before EVERY
 * server-routed call. Unhealthy/unreachable → skip straight to in-process (no waiting out the
 * long generation timeout). Healthy but the generation call itself still fails/times out
 * (LLAMA_SERVER_TIMEOUT_MS, default 120s) → the existing try/catch below still falls back
 * in-process. Both paths log a clear console.warn (or throw under LLAMA_SERVER_STRICT). The
 * answer is NEVER lost to a down/flaky server as long as in-process inference is available.
 *
 * doc69 Wave 4 C2 — FIM (fill-in-middle) over this SAME persistent server, for sub-second inline
 * code completion under load (prefix-cache + a kept-loaded coder model instead of a per-request
 * in-process load). Mirrors the text path's gate/preflight/timeout/strict/fallback semantics
 * EXACTLY (`shouldUseServerForFim`, `preflightHealthyForFim`, `generateFimViaServer` — see each
 * function's doc below), but talks to llama.cpp server's **`/infill`** endpoint instead of
 * `/v1/chat/completions`. `/infill` was chosen over faking FIM through the OpenAI-compatible chat
 * endpoint because it accepts a raw `input_prefix`/`input_suffix` pair and performs TRUE
 * special-token infill decoding — the server-side equivalent of what `generateFimNative()`
 * (aiGgufEngine.ts) already does in-process via node-llama-cpp's `LlamaCompletion
 * .generateInfillCompletion`. Routing FIM through the chat endpoint instead would force every
 * request through the model's chat template (sentinel-prompt hack), which is exactly the
 * degraded fallback the in-process path already avoids when it can.
 * Two deployment shapes, both configured only via existing/minimal env (no new model-name env):
 *  - Shared server (default): FIM shares the same `LLAMA_SERVER_URL` + `LLAMA_SERVER_MODEL` as
 *    text. The safety check is identical to `shouldUseServerForText` — the requested FIM model's
 *    basename must match what the single server process is actually loaded with, so FIM is never
 *    silently answered by a resident model the operator never repointed at coder weights.
 *  - Dedicated FIM server (optional `LLAMA_FIM_SERVER_URL`): a SEPARATE small coder/FIM-model
 *    process. Since a dedicated URL's entire purpose is "this process IS the FIM server", no
 *    served-model match is required — routed whenever enabled + reachable.
 * `LLAMA_SERVER_ENABLED` off (the default) makes `generateFim` behave EXACTLY as before C2 —
 * see the runbook (docs/ECOSYSTEM/70_AI_PERSISTENT_LLAMA_SERVER_RUNBOOK_2026-07-26.md §10).
 */
import type {
  GgufChatMessage,
  GgufChatOptions,
  GgufFimOptions,
  GgufGenerateOptions,
  GgufGenerateResult,
  GgufStreamChunk,
} from "./aiGgufEngine";
import { fimModelBasename as resolveFimModelBasename } from "./ai/modelResolver";
// ★ G2-B — khuôn dây tool-calling GỐC. Module LÁ (0 import, 0 I/O, 0 env) ⇒ import TĨNH, chi phí ~0.
import {
  docToolCallTuMessage,
  gomToolCallTuVanBan,
  BoGomToolCallLuong,
  type WireToolCall as NativeToolCall,
} from "./ai/nativeToolCalls";

// ═══ G5-D — Ô DỮ LIỆU THỨ HAI: `message.reasoning_content` ════════════════════════════════════
//
// ★★★ VÌ SAO KHỐI NÀY TỒN TẠI — *"hỏng mà KHÔNG có gì đỏ"*, lần thứ N.
//
// `llama-server` chạy với `--jinja` (**mặc định BẬT** ở build b9814 — xác nhận bằng `--help` của
// chính nhị phân đang chạy) và `--reasoning-format auto` sẽ TÁCH khối suy luận của một model lai
// ra khỏi `message.content`, đặt nó vào **`message.reasoning_content`**. Bản trước G5-D đọc DUY
// NHẤT `content`.
//
// Hệ quả ĐO ĐƯỢC (A/B 2026-08-16, `max_tokens=500`): **4/5 prompt trả `content` RỖNG** với model
// suy luận lai (0/5 với roster hiện tại), **không một dòng log lỗi nào** — vì `""` không phải lỗi,
// nó chỉ là "câu trả lời rỗng". `intentClassifier` chạy `maxTokens: 120` nên nó ăn trọn lớp lỗi
// này: 0/21 và 1/21 lượt trả được tool.
//
// HAI CA TRƯỚC ĐÂY BỊ GỘP LÀM MỘT, và cách sửa của chúng NGƯỢC NHAU:
//   (A) `content` rỗng **và** `reasoning_content` rỗng ⇒ *"model không trả lời"* — hỏng thật.
//   (B) `content` rỗng **mà** `reasoning_content` CÓ CHỮ ⇒ *"model tiêu hết hạn mức token vào suy
//       luận trước khi kịp thoát `<think>`"* — model KHÔNG hỏng, **hạn mức sai**. Sửa bằng nâng
//       `maxTokens` hoặc tắt suy luận cho lượt đó.
// Gộp (B) vào (A) là chẩn sai nguyên nhân. Lưới: `aiLlamaServerClient.suyLuan.test.ts`.
//
// ⚠ TRẠNG THÁI SỐNG ĐỌC ĐƯỢC: `GET /props` → `default_generation_settings.params.reasoning_format`
// nói thẳng server đang ở chế độ nào (`"none"` = KHÔNG tách, `<think>` nằm lại trong `content`;
// `"deepseek"` = có tách). Đo 2026-08-17 trên `:8091` với `Qwen3-30B-A3B-Instruct-2507` (bản KHÔNG
// suy luận) cho `"none"` — đúng như mong đợi, vì `auto` dò từ chat template. Đổi sang roster lai
// thì nó tự thành `"deepseek"` và ô thứ hai bắt đầu có chữ. Mã dưới đây đọc ĐÚNG cả hai chế độ.

/** Hai nửa TÁCH BẠCH của một câu trả lời chat. Trộn chúng = rò suy luận ra giao diện. */
export interface HaiNuaCauTraLoi {
  /** `choices[0].message.content` — chữ dành cho NGƯỜI DÙNG. */
  readonly noiDung: string;
  /** `choices[0].message.reasoning_content` — chuỗi suy luận, dành cho CHẨN ĐOÁN. */
  readonly suyLuan: string;
}

/** Chuỗi hay không? (`null`/thiếu/kiểu lạ ⇒ `""`, KHÔNG bao giờ ra chuỗi `"null"`.) */
function chuHoacRong(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * ĐIỂM ĐỌC DUY NHẤT của ô `reasoning_content` trên đường KHÔNG-streaming (đường streaming có
 * `suyLuanTrongChunk()`, đọc `delta`). Hai điểm đọc, không hơn — §5 của lưới đếm đúng con số này.
 */
export function docHaiNua(message: unknown): HaiNuaCauTraLoi {
  const m = message as Record<string, unknown> | undefined | null;
  return { noiDung: chuHoacRong(m?.content), suyLuan: chuHoacRong(m?.reasoning_content) };
}

/**
 * ★★★ Lỗi ca (B) — **model KHÔNG hỏng, hạn mức token hỏng.** Có TÊN RIÊNG (chứ không phải một
 * `Error` chung) vì hai người đọc cần phân biệt được nó:
 *   • người vận hành đọc log — để không đi sửa model khi thứ hỏng là một con số;
 *   • `aiProgrammingCopilot` / `aiGgufEngine` — để nói ra ĐÚNG chuyện gì hỏng thay vì "không có
 *     gợi ý", tức để lượt hỏng này không tiếp tục đi tiếp dưới lốt một câu trả lời rỗng hợp lệ.
 */
export class LoiTokenCanKietVaoSuyLuan extends Error {
  readonly soKyTuSuyLuan: number;
  readonly maxTokens?: number;
  readonly finishReason?: string;
  /** Vài trăm ký tự đầu của chuỗi suy luận — đủ để người đọc log thấy model đang nghĩ về cái gì. */
  readonly trichSuyLuan: string;
  constructor(args: { suyLuan: string; maxTokens?: number; finishReason?: string; ten?: string }) {
    const n = args.suyLuan.length;
    super(
      `[llamaServer] TỪ CHỐI TRUNG THỰC (G5-D${args.ten ? `, ${args.ten}` : ""}): model đã tiêu HẾT hạn mức ` +
        `${args.maxTokens ?? "(không khai)"} token vào chuỗi SUY LUẬN (${n} ký tự trong ` +
        `\`reasoning_content\`) mà chưa kịp phát một ký tự nào ra \`content\`` +
        (args.finishReason ? ` (finish_reason="${args.finishReason}")` : "") +
        `. Đây KHÔNG phải "model không trả lời" — model chạy đúng, HẠN MỨC TOKEN SAI. ` +
        `CÁCH SỬA, theo thứ tự rẻ→đắt: (1) lượt này không cần suy luận ⇒ đặt \`disableThinking: true\` ` +
        `(gửi \`chat_template_kwargs.enable_thinking=false\`); (2) nâng \`maxTokens\` lên trên độ dài ` +
        `khối suy luận (đo 2026-08-17 trên chính :8091: một lượt suy luận cho tác vụ chọn tool tốn ` +
        `396–1082 token); (3) rút ngắn câu hỏi. ` +
        `TRÍCH SUY LUẬN: ${args.suyLuan.slice(0, 300)}`,
    );
    this.name = "LoiTokenCanKietVaoSuyLuan";
    this.soKyTuSuyLuan = n;
    this.maxTokens = args.maxTokens;
    this.finishReason = args.finishReason;
    this.trichSuyLuan = args.suyLuan.slice(0, 300);
  }
}

/**
 * ★★★ **MỘT phép phân định, BỐN người đọc** (text · JSON · chat không-stream · stream).
 *
 * ⚠ Cố ý KHÔNG để mỗi đường tự viết `if (!text) throw new Error("empty completion")` như trước
 * G5-D: bốn bản sao là bốn cơ hội để chúng trôi khỏi nhau, và đó đúng hình dạng lớp lỗi "N+1" đã
 * dính **17 lần** trong repo này. Lưới §5 quét mã nguồn và khẳng định chuỗi `"empty completion"`
 * chỉ tồn tại ĐÚNG MỘT lần — ngay trong thân hàm này.
 *
 * Trả về bình thường = "có chữ, đi tiếp". Ném = một trong hai ca hỏng, và **hai ca ném hai lỗi
 * KHÁC LOẠI** để bên gọi phân biệt được bằng `instanceof`, không phải bằng cách so chuỗi.
 */
export function phanDinhCauTraLoiRong(
  nua: HaiNuaCauTraLoi,
  ctx: { maxTokens?: number; finishReason?: string; ten?: string },
): void {
  if (nua.noiDung.length > 0) return;
  // ⚠ `.trim()`: một `reasoning_content` toàn khoảng trắng KHÔNG phải bằng chứng model đã suy
  // luận — báo "cạn token" cho ca ấy là chẩn sai theo chiều ngược lại.
  if (nua.suyLuan.trim().length > 0) {
    throw new LoiTokenCanKietVaoSuyLuan({
      suyLuan: nua.suyLuan,
      maxTokens: ctx.maxTokens,
      finishReason: ctx.finishReason,
      ten: ctx.ten,
    });
  }
  throw new Error(`[llamaServer] empty completion${ctx.ten ? ` (${ctx.ten})` : ""}`);
}

/**
 * ★★ TẮT SUY LUẬN cho một lượt — **cách truyền đã XÁC MINH TRÊN SERVER THẬT**, không đoán tên
 * trường (một cờ truyền sai tên bị bỏ qua IM LẶNG, và ta lại có thêm một cờ vô hiệu).
 *
 * BẰNG CHỨNG (build `b9814-487a6cc16` đang phục vụ `:8091`, đo 2026-08-17):
 *   • `llama-server --help` → `--jinja, --no-jinja  … (default: **enabled**)` và
 *     `--chat-template-kwargs STRING  sets additional params for the json template parser`.
 *     Tiến trình đang chạy KHÔNG truyền `--no-jinja` ⇒ máy Jinja đang sống.
 *   • `POST /apply-template` với `{"messages":[…],"tools":[…]}` render ra khối `# Tools … <tools>`
 *     của CHÍNH template trong model ⇒ đúng là template của model, không phải `chatml` dựng sẵn.
 *   • **Phép thử ĐẦU ĐỘC** (đây mới là bằng chứng, hai phép trên chỉ là điều kiện cần):
 *       `{"chat_template_kwargs":{"messages":123}}` → HTTP 400
 *         *"While executing MemberExpression at line 13 … Cannot access property with non-string:
 *          got Integer"*
 *       `{"chat_template_kwargs":{"tools":123}}` → HTTP 400
 *         *"While executing For at line 7 … Expected iterable or object type in for loop"*
 *       cùng thân KHÔNG có `chat_template_kwargs` → HTTP 200, prompt bình thường.
 *     Hai lỗi bật ra ở ĐÚNG dòng template đọc `messages`/`tools` ⇒ giá trị trong
 *     `chat_template_kwargs` **thật sự được nạp vào ngữ cảnh Jinja**.
 *   • Ngược lại, trường TOP-LEVEL `enable_thinking` KHÔNG có tác dụng nào đo được ⇒ gửi ở đó là
 *     dựng một cờ vô hiệu. Vì thế hàm này chỉ ghi vào chỗ LỒNG.
 *
 * ⚠ GIỚI HẠN NÓI THẲNG — cờ này chỉ có tác dụng khi **chat template của model CÓ ĐỌC**
 * `enable_thinking`. Template đang nạp (`Qwen3-30B-A3B-Instruct-2507`, bản KHÔNG suy luận) KHÔNG
 * đọc nó (đã kiểm: chuỗi `enable_thinking` không xuất hiện trong `/props.chat_template`), nên trên
 * cấu hình HIỆN TẠI cờ này là một no-op vô hại. Nó chỉ có việc để làm khi roster đổi sang model
 * lai. **Vì thế nó KHÔNG được đứng một mình**: `maxTokens` phải đủ lớn để lượt gọi vẫn sống khi
 * cờ bị template bỏ qua — xem `intentClassifier`. Cờ tắt suy luận là phép TỐI ƯU; hạn mức token
 * là lưới AN TOÀN. Nhầm vai hai thứ đó là cách lỗ này quay lại.
 */
function lapCoTatSuyLuan(body: Record<string, unknown>, tat: boolean | undefined): void {
  if (!tat) return;
  body.chat_template_kwargs = { enable_thinking: false };
}

// ⚠ `nganSachTuHoiThoai()` (quy một HỘI THOẠI về hình dạng mà `kiemNganSachNguCanh()` cân được)
// KHÔNG sống ở đây — nó nằm trong `aiGgufEngine.ts`, và có lý do đo được:
// mọi test `vi.mock("./aiLlamaServerClient", …)` bằng factory LIỆT KÊ TAY (đã có ít nhất một
// trong repo: `aiGgufEngine.nonGenerativeGuardOrder.test.ts`) sẽ làm mọi symbol không được liệt kê
// biến mất. Một hàm THUẦN nằm trên đường ngân sách mà có thể bị một mock xoá đi là đúng lớp lỗi
// đã ghi ở `ai/thinkingStrip.ts` §1 ("mock có thể vô hiệu hoá hàng rào mà lưới vẫn xanh").
// Cổng ngân sách THẬT (`kiemNganSachNguCanh` + hằng 2,8 ký tự/token + trần mỗi slot) vẫn ở đây và
// vẫn là nguồn duy nhất — cái chuyển sang engine chỉ là phép ĐỔI HÌNH DẠNG đầu vào.

// ═══ G2-B — TOOL-CALLING GỐC: BA HÀM DÙNG CHUNG ══════════════════════════════════════════════
//
// Cả ba đều nhỏ, và cả ba đều được TÁCH TÊN thay vì viết inline ở hai điểm gọi (không-stream +
// stream). Lý do đã ghi 17 lần trong repo này dưới nhãn "N+1": một bản sao thứ hai của cùng chuỗi
// quyết định là một bản sao sẽ trôi.

/**
 * Đưa một `GgufChatMessage` lên khuôn dây OpenAI, GIỮ NGUYÊN vai `tool` và hai ô đi kèm.
 * ⚠ Bản cũ là `({ role: m.role, content: m.content })` — nó IM LẶNG đánh rơi `tool_call_id` và
 * `tool_calls`, tức làm đứt đúng mắt xích giữa của vòng đời tool-call.
 */
function chuyenMessageLenDay(m: GgufChatMessage): Record<string, unknown> {
  const ra: Record<string, unknown> = { role: m.role, content: m.content };
  if (m.tool_call_id) ra.tool_call_id = m.tool_call_id;
  if (m.tool_calls?.length) ra.tool_calls = m.tool_calls;
  return ra;
}

/**
 * Lắp `tools` (+ `tool_choice`) vào thân yêu cầu.
 * ⚠ CHỈ khi thật sự có tool: gửi `tools: []` làm chat template Qwen3 rẽ vào nhánh `{%- if tools %}`
 * với một danh sách rỗng ⇒ prompt đổi (và prefix-cache trượt) mà chẳng được gì.
 * ⚠ `tool_choice` chỉ nhận `"auto"` tới đây — `"none"` được cưỡng chế ở tầng trên bằng cách KHÔNG
 * truyền `tools` xuống. Xem `ai/nativeToolCalls.ts` (b9814 KHÔNG tôn trọng `tool_choice:"none"`).
 */
function lapToolsLenThan(body: Record<string, unknown>, options: GgufChatOptions): void {
  if (!options.tools?.length) return;
  body.tools = options.tools;
  body.tool_choice = options.toolChoice ?? "auto";
}

/**
 * Gom tool-call của một đáp ứng KHÔNG-stream: đọc ô `message.tool_calls` trước, và chỉ khi ô ấy
 * TRỐNG mới VỚT `<tool_call>` từ `content`.
 *
 * ⚠ Bộ vớt là đường PHỤ có điều kiện chặt: chỉ chạy khi lượt này thật sự CÓ gửi `tools` lên. Nếu
 * không, một câu trả lời bình thường nhắc tới chuỗi `<tool_call>` (ví dụ khi người dùng hỏi CHÍNH
 * về tính năng này) sẽ bị hiểu thành một lượt gọi tool — biến một câu chữ thành một hành động.
 */
function gomToolCallCuaDapUng(
  message: unknown,
  options: GgufChatOptions,
  noiDung: string,
): NativeToolCall[] {
  if (!options.tools?.length) return [];
  const tuO = docToolCallTuMessage(message);
  if (tuO.length) return tuO;
  return gomToolCallTuVanBan(noiDung).toolCalls;
}

/** Chữ hiển thị sau khi đã bóc các khối `<tool_call>` nguyên văn ra. */
function vanBanSauKhiVot(noiDung: string): string {
  return gomToolCallTuVanBan(noiDung).vanBan;
}

function basename(file: string): string {
  return file.replace(/\.gguf$/i, "").replace(/^.*[\\/]/, "").trim();
}

/** Basename of the model this server serves. Defaults to the deep model. */
function serverModelBasename(): string {
  const explicit = (process.env.LLAMA_SERVER_MODEL || "").trim();
  if (explicit) return basename(explicit);
  return basename(process.env.GGUF_DEFAULT_MODEL || "");
}

export function llamaServerEnabled(): boolean {
  return process.env.LLAMA_SERVER_ENABLED === "true" && !!(process.env.LLAMA_SERVER_URL || "").trim();
}

export function llamaServerStrict(): boolean {
  return process.env.LLAMA_SERVER_STRICT === "true";
}

/**
 * ★★★ G1-D — **VỊ TỪ HẠT NHÂN**: *"model này có phải CHÍNH cái mà `llama-server` đang giữ trên
 * card không?"*
 *
 * Một câu trả lời `true` mang HAI hệ quả ngược chiều nhau, và đó là lý do vị từ này được tách
 * tên riêng thay vì để mỗi nơi tự viết lại phép so sánh:
 *   • ĐƯỜNG ĐI  — lượt sinh chữ NÊN đi qua server (`shouldUseServerForText`, giữ nguyên ngữ nghĩa).
 *   • ĐƯỜNG CẤM — tiến trình này TUYỆT ĐỐI không được nạp model đó vào bộ nhớ của chính nó
 *     (`aiGgufEngine.chanNapTrungModelServer`), vì như thế là **BẢN THỨ HAI**: đo sống 2026-08-16
 *     `llama-server` giữ ~20.275 MiB trọng số + 6.144 MiB KV, `nvidia-smi` còn **5.673 MiB trống**,
 *     trong khi trọng số 30B in-process cần ~19.000 MiB.
 *
 * ⚠ MỘT ĐỊNH NGHĨA, HAI NGƯỜI ĐỌC — cố ý. Nếu hai vế trên có hai phép so sánh riêng thì chúng sẽ
 * TRÔI khỏi nhau (đúng lớp lỗi "N+1" đã dính 17 lần trong repo này): một model được coi là "server
 * phục vụ" ở chỗ định tuyến nhưng "không phải của server" ở chỗ cấm ⇒ lỗ mở lại mà lưới vẫn xanh.
 * Lưới canh chính điều đó: `aiLlamaServerClient.napTrung.test.ts`.
 */
export function laModelServerDangGiu(modelId?: string): boolean {
  if (!llamaServerEnabled()) return false;
  const wanted = modelId ? basename(modelId) : basename(process.env.GGUF_DEFAULT_MODEL || "");
  const served = serverModelBasename();
  return !!served && wanted === served;
}

/**
 * Route a text-generation call to the server only when it's enabled AND the
 * requested model IS the model the server serves (a single llama-server hosts one
 * model — routing a code/fast/vision model there would silently use the wrong
 * weights). `undefined` modelId means "the deep default", which the server serves.
 *
 * G1-D: thân hàm nay là MỘT lời uỷ quyền cho `laModelServerDangGiu()` — cùng tập hợp, cùng phép
 * so sánh, không thể trôi. Hành vi KHÔNG đổi (xem `aiLlamaServerClient.test.ts`).
 */
export function shouldUseServerForText(modelId?: string): boolean {
  return laModelServerDangGiu(modelId);
}

// ─── G1-D — NGÂN SÁCH NGỮ CẢNH MỖI SLOT ────────────────────────────────────────────────────────

/**
 * Số token tối đa MỘT request dùng được trên server — **tính theo SLOT**, không theo tổng.
 *
 * ⚠ Đây là chỗ dễ nhầm nhất của llama.cpp: `-c` là TỔNG ngữ cảnh, server chia đều cho `-np`.
 * Cấu hình đang chạy: `-c 65536 -np 2` ⇒ **32.768 token/slot** — xác nhận SỐNG qua
 * `GET /props` (`total_slots: 2`, `default_generation_settings.n_ctx: 32768`, đo 2026-08-16).
 * (Ngược hẳn với node-llama-cpp, nơi `contextSize` là PER-SEQUENCE rồi bị nhân lên.)
 *
 * Thứ tự nguồn, từ CỤ THỂ nhất tới SUY RA:
 *   1. `LLAMA_SERVER_CTX_PER_SLOT` — người vận hành khai thẳng (không suy diễn gì).
 *   2. `LLAMA_SERVER_CTX` / `LLAMA_SERVER_PARALLEL` — đúng hai cờ `-c` / `-np` của lệnh khởi động.
 *   3. `GGUF_MAX_CTX` — trần cứng một request đã có sẵn trong `.env` (32768). Đây là mặc định
 *      ĐÚNG cho cấu hình hiện tại và cũng là con số mà `.env` yêu cầu ctx/slot phải ≥.
 * ⚠ KHÔNG hỏi `/props` ở đây: hàm này nằm trên đường sinh chữ, phải THUẦN + đồng bộ; một lượt
 * `fetch` thêm là một điểm hỏng mới ngay trước lượt suy luận.
 */
export function serverSlotContextTokens(): number {
  const perSlot = Number(process.env.LLAMA_SERVER_CTX_PER_SLOT);
  if (Number.isFinite(perSlot) && perSlot > 0) return Math.floor(perSlot);

  const total = Number(process.env.LLAMA_SERVER_CTX);
  if (Number.isFinite(total) && total > 0) {
    const np = Number(process.env.LLAMA_SERVER_PARALLEL);
    const slots = Number.isFinite(np) && np >= 1 ? Math.floor(np) : 1;
    return Math.max(256, Math.floor(total / slots));
  }

  const maxCtx = Number(process.env.GGUF_MAX_CTX);
  if (Number.isFinite(maxCtx) && maxCtx > 0) return Math.floor(maxCtx);
  return 32768;
}

/**
 * ★ SỐ KÝ TỰ MỖI TOKEN — **ĐO THẬT, KHÔNG PHẢI HẰNG SỐ "ĐỒN THỔI ~4"**.
 *
 * Phép đo (2026-08-16): 8 khối văn bản THẬT lấy từ `knowledge/chunks.jsonl` (tiếng Việt kỹ thuật,
 * đúng thứ đi vào prompt RAG) đưa qua `POST /tokenize` của CHÍNH `llama-server` đang phục vụ
 * (tokenizer của Qwen3-30B, không phải một bộ đếm thay thế):
 *     4,08 · 2,85 · 3,18 · 3,14 · 3,04 · 3,40 · 3,54 · 3,07  → **trung bình 3,26 ký tự/token**
 * Mẫu DÀY TOKEN NHẤT là 2,85. Chia cho **2,8** ⇒ ước lượng luôn **CAO HƠN** số token thật trên
 * mọi mẫu đã đo ⇒ sai số nghiêng về phía TỪ CHỐI SỚM, không nghiêng về phía để lọt.
 *
 * ⚠ Đây là ƯỚC LƯỢNG, không phải PHÉP ĐO của lượt hiện tại — và tài liệu này nói thẳng ra thế.
 * Nó KHÔNG đứng một mình: cổng thứ hai (`aiGgufEngine.chanNapTrungModelServer`) bắt đúng ca ước
 * lượng hụt, vì lúc đó server đã trả lời "vượt ctx" bằng chính tokenizer của nó.
 * ⚠ Hằng số ~4 ký tự/token quen dùng cho tiếng Anh (`openaiGateway.estimateTokens`) SAI 43% theo
 * hướng LẠC QUAN trên tiếng Việt — đúng hướng nguy hiểm. Không mượn nó sang đây.
 */
export const KY_TU_MOI_TOKEN_UOC_LUONG = 2.8;

/**
 * Ước lượng số token của một đoạn văn bản. Xem `KY_TU_MOI_TOKEN_UOC_LUONG` về nguồn của 2,8.
 *
 * ⚠ Phép chia làm bằng SỐ NGUYÊN (`len*10 / 28`) chứ không `len / 2.8`: `2520 / 2.8` cho
 * `900.0000000000001` trong dấu phẩy động IEEE-754 ⇒ `Math.ceil` nhảy lên 901. Sai một token thì
 * vô hại, nhưng một ngưỡng "vừa khít" mà lệch tuỳ theo độ dài chuỗi là một cái thước KHÔNG TẤT
 * ĐỊNH — và repo này đã trả giá đúng một lần cho thước không tất định (Pha 1, Ư7).
 */
export function uocLuongSoToken(text: string | undefined | null): number {
  const s = String(text ?? "");
  if (s.length === 0) return 0;
  const mau = Math.round(KY_TU_MOI_TOKEN_UOC_LUONG * 10); // 28 — nguyên, không nhiễu dấu phẩy động
  return Math.ceil((s.length * 10) / mau);
}

export interface NganSachNguCanh {
  /** `true` ⇔ ước lượng vào lọt ctx của một slot (đã trừ chỗ cho câu trả lời). */
  readonly vua: boolean;
  /** Token ước lượng của phần ĐƯA VÀO (system + prompt). */
  readonly tokenVao: number;
  /** Token DÀNH RIÊNG cho câu trả lời (`maxTokens`, mặc định 1024 — cùng mặc định với engine). */
  readonly tokenDanhChoTraLoi: number;
  /** Trần ctx của MỘT slot (xem `serverSlotContextTokens`). */
  readonly tranMoiSlot: number;
}

/**
 * G1-D CỔNG (a) — cân ngân sách TRƯỚC khi POST.
 *
 * ⚠ Vì sao phải cộng `maxTokens`: llama.cpp từ chối khi **prompt + n_predict** vượt ctx của slot,
 * không phải khi riêng prompt vượt. Một prompt 32.000 token với `maxTokens=1024` vẫn hỏng.
 */
export function kiemNganSachNguCanh(options: {
  systemPrompt?: string;
  prompt: string;
  maxTokens?: number;
}): NganSachNguCanh {
  const tokenVao = uocLuongSoToken(options.systemPrompt) + uocLuongSoToken(options.prompt);
  const tokenDanhChoTraLoi = Math.max(0, Math.floor(options.maxTokens ?? 1024));
  const tranMoiSlot = serverSlotContextTokens();
  return {
    vua: tokenVao + tokenDanhChoTraLoi <= tranMoiSlot,
    tokenVao,
    tokenDanhChoTraLoi,
    tranMoiSlot,
  };
}

/**
 * Lỗi từ server CÓ PHẢI là "vượt ngữ cảnh" không? Dùng cho câu chẩn đoán (nói đúng nguyên nhân
 * cho người dùng), **KHÔNG** dùng để quyết định có nạp bản thứ hai hay không — quyết định đó chỉ
 * phụ thuộc "server còn sống và đang giữ model X hay không", không phụ thuộc lý do hỏng.
 * ⚠ Bắt cả câu llama.cpp (`exceed_context_size_error`, *"exceeds the available context size"*) lẫn
 * câu OpenAI-compatible (*"maximum context length"*, *"prompt is too long"*).
 */
export function laLoiTranNguCanh(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "");
  return /exceed_context_size|exceeds the available context|maximum context length|context (size|window|length)|prompt is too long|n_ctx/i.test(
    msg,
  );
}

function baseUrl(): string {
  return (process.env.LLAMA_SERVER_URL || "").trim().replace(/\/+$/, "");
}

/** `LLAMA_FIM_SERVER_URL`, trimmed/normalized — empty string when unset (see `fimBaseUrl()`). */
function dedicatedFimUrl(): string {
  return (process.env.LLAMA_FIM_SERVER_URL || "").trim().replace(/\/+$/, "");
}

/**
 * doc69 C2 — Base URL FIM requests go to: the optional DEDICATED `LLAMA_FIM_SERVER_URL` (a
 * separate small coder/FIM-model process) when set, else the SAME server the text path uses
 * (`LLAMA_SERVER_URL`). Kept minimal by design — no separate FIM API key/timeout env; a
 * dedicated FIM server is expected to share the rest of the deployment (auth, timeouts).
 */
function fimBaseUrl(): string {
  return dedicatedFimUrl() || baseUrl();
}

function authHeaders(): Record<string, string> {
  const key = (process.env.LLAMA_SERVER_API_KEY || "").trim();
  return key ? { authorization: `Bearer ${key}` } : {};
}

/**
 * doc69 C2 — Route a FIM (fill-in-middle) call to the persistent server. Mirrors
 * `shouldUseServerForText`'s gate (`LLAMA_SERVER_ENABLED=true` + a resolvable URL) but the
 * served-model safety check only applies to the SHARED-server shape:
 *  - Dedicated FIM server (`LLAMA_FIM_SERVER_URL` set): routed whenever enabled + the URL
 *    resolves — no served-model match needed, since a dedicated URL's entire purpose is "this
 *    process IS the FIM server" (no risk of silently hitting the deep text model instead).
 *  - Shared server (`LLAMA_FIM_SERVER_URL` unset, falls back to `LLAMA_SERVER_URL`): identical
 *    safety check to `shouldUseServerForText` — the requested FIM model's basename must match
 *    `LLAMA_SERVER_MODEL` (what that single server process is actually loaded with).
 * `undefined` modelId resolves via the SAME chain `aiGgufEngine.generateFim` itself uses
 * (modelResolver's `fimModelBasename()`: GGUF_FIM_MODEL → GGUF_FAST_MODEL → GGUF_DEFAULT_MODEL),
 * so this check reflects exactly which model a bare `generateFim()` call would actually request.
 */
export function shouldUseServerForFim(modelId?: string): boolean {
  if (process.env.LLAMA_SERVER_ENABLED !== "true") return false;
  if (!fimBaseUrl()) return false;
  if (dedicatedFimUrl()) return true;
  const wanted = modelId ? basename(modelId) : basename(resolveFimModelBasename() || "");
  const served = serverModelBasename();
  return !!served && wanted === served;
}

/**
 * Shared liveness probe against an ARBITRARY server base URL (text server or FIM server — both
 * are plain llama.cpp `llama-server` processes, same health surface). Extracted so
 * `llamaServerHealthy()` (text, unchanged signature/behavior below) and
 * `preflightHealthyForFim()` (doc69 C2, probes `fimBaseUrl()` instead) share one implementation
 * instead of drifting.
 *
 * doc69 G2-6 fix: the /v1/models fallback USED TO fire without an abort signal at all — a
 * server that accepts the TCP connection but never responds (hung, overloaded, mid-restart)
 * could make this "short timeout" health check hang indefinitely, defeating its entire purpose.
 * Both requests now share the SAME AbortController, so the whole probe is bounded by `timeoutMs`
 * regardless of which branch it takes.
 */
async function probeHealthy(url: string, timeoutMs: number): Promise<boolean> {
  if (!url) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // llama.cpp exposes /health; fall back to /v1/models.
    const res = await fetch(`${url}/health`, { headers: authHeaders(), signal: ctrl.signal });
    return res.ok;
  } catch {
    try {
      const res = await fetch(`${url}/v1/models`, { headers: authHeaders(), signal: ctrl.signal });
      return res.ok;
    } catch {
      return false;
    }
  } finally {
    clearTimeout(t);
  }
}

/** Liveness probe for the TEXT server (used by the runbook/health surface + preflightHealthy() below). */
export async function llamaServerHealthy(timeoutMs = 3000): Promise<boolean> {
  return probeHealthy(baseUrl(), timeoutMs);
}

/** Short timeout (default 2s) for the PRE-generation preflight probe below — deliberately much
 *  shorter than LLAMA_SERVER_TIMEOUT_MS (generation timeout, default 120s) so a down/unresponsive
 *  server is detected in ~2s instead of only after a long hung POST. Configurable in case the
 *  server's /health itself is slow (e.g. under heavy load) — raise if false negatives occur. */
function healthCheckTimeoutMs(): number {
  const n = Number(process.env.LLAMA_SERVER_HEALTH_TIMEOUT_MS ?? 2000);
  return Number.isFinite(n) && n > 0 ? n : 2000;
}

/**
 * doc69 G2-6 — Fast pre-flight liveness check the engine (aiGgufEngine) runs immediately before
 * EVERY server-routed generation call. This is what makes the server→in-process fallback FAST
 * (~2s) rather than merely eventually-correct (waiting out the full generation timeout on a
 * hung connection). Wraps llamaServerHealthy() with the short healthCheckTimeoutMs(); never
 * throws (llamaServerHealthy already swallows all transport errors and resolves false).
 */
export async function preflightHealthy(): Promise<boolean> {
  return llamaServerHealthy(healthCheckTimeoutMs());
}

/**
 * doc69 C2 — Same short-timeout preflight as `preflightHealthy()`, but probes `fimBaseUrl()`
 * (the dedicated FIM server when configured, else the shared text server) instead of always
 * probing the text server's `baseUrl()`. The engine (`aiGgufEngine.generateFim`) calls this
 * immediately before every FIM server-routed call, exactly mirroring how `generateText` uses
 * `preflightHealthy()` for text.
 */
export async function preflightHealthyForFim(): Promise<boolean> {
  return probeHealthy(fimBaseUrl(), healthCheckTimeoutMs());
}

/** POST an OpenAI chat-completion to the server and return the raw JSON + timing. */
async function postChatCompletion(body: Record<string, unknown>): Promise<{ json: any; totalTimeMs: number }> {
  const url = baseUrl();
  if (!url) throw new Error("[llamaServer] LLAMA_SERVER_URL not set");
  const startTime = Date.now();
  const timeoutMs = Number(process.env.LLAMA_SERVER_TIMEOUT_MS ?? 120_000);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`[llamaServer] HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }
    return { json: await res.json(), totalTimeMs: Date.now() - startTime };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Generate via the persistent server's OpenAI-compatible endpoint. Uses proper
 * system/user chat roles (the server applies the model's chat template) and maps
 * the response back to the engine's GgufGenerateResult. Throws on any transport
 * or protocol error so the caller can decide (fall back in-process, or honest
 * offline template under STRICT).
 */
export async function serverGenerateText(
  options: GgufGenerateOptions,
  modelId?: string,
): Promise<GgufGenerateResult> {
  const messages: Array<{ role: string; content: string }> = [];
  if (options.systemPrompt) messages.push({ role: "system", content: options.systemPrompt });
  let user = options.prompt;
  if (options.jsonMode) user += "\n\nRespond with valid JSON only. No markdown, no explanations.";
  messages.push({ role: "user", content: user });

  const body: Record<string, unknown> = {
    model: modelId ? basename(modelId) : serverModelBasename(),
    messages,
    max_tokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.7,
    top_p: options.topP ?? 0.9,
    stream: false,
  };
  if (options.stopSequences?.length) body.stop = options.stopSequences;
  if (options.jsonMode) body.response_format = { type: "json_object" };
  lapCoTatSuyLuan(body, options.disableThinking);

  const { json, totalTimeMs } = await postChatCompletion(body);
  const nua = docHaiNua(json?.choices?.[0]?.message);
  phanDinhCauTraLoiRong(nua, {
    maxTokens: body.max_tokens as number,
    finishReason: json?.choices?.[0]?.finish_reason,
    ten: "generation",
  });

  const tokensPrompt = Number(json?.usage?.prompt_tokens ?? 0);
  const tokensGenerated = Number(json?.usage?.completion_tokens ?? 0);
  const tokensPerSecond = totalTimeMs > 0 && tokensGenerated > 0 ? (tokensGenerated / totalTimeMs) * 1000 : 0;

  return {
    // ⚠ `text` là NỬA DÀNH CHO NGƯỜI DÙNG và chỉ nửa đó. Nối thêm `nua.suyLuan` vào đây là rò nội
    // tâm model ra giao diện (xem `ai/thinkingStrip.ts` — cùng lớp lỗi, đường khác).
    text: nua.noiDung,
    reasoning: nua.suyLuan || undefined,
    tokensGenerated,
    tokensPrompt,
    totalTimeMs,
    tokensPerSecond: Number(tokensPerSecond.toFixed(1)),
    modelId: String(body.model),
  };
}

/**
 * P1 (G5-D) — CHAT KHÔNG-STREAMING qua server. Bản song sinh không-stream của
 * `serverChatCompletionStream`, và là mảnh còn thiếu khiến `aiGgufEngine.chatCompletion()` — đường
 * mà `aiProgrammingCopilot` dùng để SINH MÃ — chưa bao giờ hỏi `llama-server`.
 *
 * ★ VÌ SAO ĐÓ LÀ LỖI CHẶN, không chỉ là "thiếu tối ưu": khi `GGUF_CODE_MODEL == LLAMA_SERVER_MODEL`
 * (chính là cấu hình "MỘT model duy nhất" mà phép A/B cần), đường in-process đòi nạp đúng model mà
 * server đang giữ ⇒ cổng G1-D `chanNapTrungModelServer()` NÉM (đúng chức trách của nó) ⇒ copilot
 * nuốt lỗi ⇒ **mọi yêu cầu sinh mã trả "không có gợi ý" trong im lặng**. Thiếu hàm này thì phép
 * A/B là bất công theo cấu tạo: model được chọn làm "một model duy nhất" tự động thua ở mọi lượt
 * sinh mã.
 *
 * Gửi NGUYÊN `messages` (server áp đúng chat template của model) thay vì bẹp thành
 * `"User: …\nAssistant: …"` như đường in-process ⇒ cùng tiền tố token với đường streaming ⇒
 * prefix-cache dùng chung được.
 */
export async function serverChatCompletion(
  options: GgufChatOptions,
  modelId?: string,
): Promise<GgufGenerateResult> {
  const body: Record<string, unknown> = {
    model: modelId ? basename(modelId) : serverModelBasename(),
    messages: options.messages.map(chuyenMessageLenDay),
    max_tokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.7,
    top_p: options.topP ?? 0.9,
    stream: false,
  };
  if (options.jsonMode) body.response_format = { type: "json_object" };
  lapCoTatSuyLuan(body, options.disableThinking);
  lapToolsLenThan(body, options);

  const { json, totalTimeMs } = await postChatCompletion(body);
  const message = json?.choices?.[0]?.message;
  const finishReason = json?.choices?.[0]?.finish_reason;
  const nua = docHaiNua(message);

  // ★★★ G2-B — GOM TOOL-CALL TRƯỚC `phanDinhCauTraLoiRong`, và đó là THỨ TỰ BẮT BUỘC.
  // ⚠ Đo sống: một lượt tool-call thành công trả `content: ""` (`finish_reason:"tool_calls"`).
  // `phanDinhCauTraLoiRong` được dựng ra để bắt "câu trả lời RỖNG" — nó KHÔNG biết gì về tool và
  // sẽ NÉM trên đúng những lượt tool-call THÀNH CÔNG NHẤT. Tức: nối dây tool mà không sửa chỗ này
  // ⇒ mọi lượt native đều hỏng, và hỏng bằng một câu lỗi nói về "token cạn kiệt vào suy luận" —
  // một chẩn đoán hoàn toàn sai. Bỏ qua cổng ấy CHỈ khi thật sự có tool_call (chứ không phải khi
  // `tools` được gửi): lượt có tools mà model trả chữ rỗng thật vẫn phải kêu như cũ.
  const toolCalls = gomToolCallCuaDapUng(message, options, nua.noiDung);
  if (!toolCalls.length) {
    phanDinhCauTraLoiRong(nua, {
      maxTokens: body.max_tokens as number,
      finishReason,
      ten: "chat",
    });
  }

  const tokensPrompt = Number(json?.usage?.prompt_tokens ?? 0);
  const tokensGenerated = Number(json?.usage?.completion_tokens ?? 0);
  const tokensPerSecond = totalTimeMs > 0 && tokensGenerated > 0 ? (tokensGenerated / totalTimeMs) * 1000 : 0;

  return {
    // ⚠ `vanBanSauKhiVot` — khi bộ phân giải của server KHÔNG chạy, `<tool_call>…</tool_call>`
    // nằm NGUYÊN VĂN trong `content`; trả nó ra là đẩy khuôn nội bộ của model tới người dùng.
    text: toolCalls.length ? vanBanSauKhiVot(nua.noiDung) : nua.noiDung,
    reasoning: nua.suyLuan || undefined,
    ...(toolCalls.length ? { toolCalls } : {}),
    finishReason: toolCalls.length ? "tool_calls" : finishReason,
    tokensGenerated,
    tokensPrompt,
    totalTimeMs,
    tokensPerSecond: Number(tokensPerSecond.toFixed(1)),
    modelId: String(body.model),
  };
}

/**
 * Schema-constrained JSON generation via the server. Passes the JSON schema both
 * as llama.cpp's native `json_schema` field AND OpenAI `response_format`, so a
 * schema-aware server constrains the decoder (parity with the in-process GBNF
 * grammar) and a plain OpenAI server still returns valid JSON. Returns the parsed
 * object + raw text + token/timing metadata (shape matches engine.generateJSON).
 */
export async function serverGenerateJSON<T = unknown>(
  jsonSchema: object,
  options: GgufGenerateOptions,
  modelId?: string,
): Promise<{ data: T; raw: string; tokensGenerated: number; tokensPrompt: number; totalTimeMs: number; tokensPerSecond: number; modelId: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (options.systemPrompt) messages.push({ role: "system", content: options.systemPrompt });
  messages.push({ role: "user", content: options.prompt });

  const body: Record<string, unknown> = {
    model: modelId ? basename(modelId) : serverModelBasename(),
    messages,
    max_tokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.2,
    top_p: options.topP ?? 0.9,
    stream: false,
    json_schema: jsonSchema, // llama.cpp server extension → constrains decode
    response_format: { type: "json_object" }, // OpenAI fallback → at least valid JSON
  };
  // ⚠ Grammar KHÔNG cứu được lượt này khỏi ca (B). Đo 2026-08-17 trên `:8091`: với một model
  // KHÔNG suy luận, `json_schema` ép decode thành JSON ngay từ token đầu ⇒ đầu ra 14–34 token và
  // `<think>` không thể xuất hiện. Nhưng với model LAI, llama.cpp hoãn grammar cho tới khi khối
  // suy luận đóng (`grammar_lazy`), nên model vẫn tiêu token vào suy luận TRƯỚC — đúng ca (B).
  lapCoTatSuyLuan(body, options.disableThinking);

  const { json, totalTimeMs } = await postChatCompletion(body);
  const nua = docHaiNua(json?.choices?.[0]?.message);
  phanDinhCauTraLoiRong(nua, {
    maxTokens: body.max_tokens as number,
    finishReason: json?.choices?.[0]?.finish_reason,
    ten: "JSON generation",
  });
  const raw = nua.noiDung;

  let data: T;
  try {
    data = JSON.parse(raw) as T;
  } catch (err: any) {
    throw new Error(`[llamaServer] server produced invalid JSON: ${err?.message || err}; raw=${raw.slice(0, 200)}`);
  }

  const tokensPrompt = Number(json?.usage?.prompt_tokens ?? 0);
  const tokensGenerated = Number(json?.usage?.completion_tokens ?? 0);
  return {
    data,
    raw,
    tokensGenerated,
    tokensPrompt,
    totalTimeMs,
    tokensPerSecond: totalTimeMs > 0 && tokensGenerated > 0 ? Number(((tokensGenerated / totalTimeMs) * 1000).toFixed(1)) : 0,
    modelId: String(body.model),
  };
}

// ═══ G1 — ĐƯỜNG STREAMING (SSE) QUA `llama-server` ════════════════════════════════════════════
//
// VÌ SAO: prefix-cache dựng ở G1-A (2.534→40 ms @4k · 5.304→71 ms @30k) chỉ phục vụ
// `serverGenerateText` — đường KHÔNG-streaming. Đường người dùng thật đi (ops-chat
// `aiLocalKnowledgeService` → `generateTextStream`, và `/v1/chat/completions` của gateway →
// `chatCompletionStream`) là đường STREAMING và trước bản vá này **chưa bao giờ hỏi llama-server**.
//
// KHUÔN DÂY — ĐO BẰNG `od -c` TRÊN SERVER ĐANG CHẠY (b9814, `:8091`, 2026-08-16), không phải trích
// từ tài liệu:  `data: {json}\n\n` … `data: [DONE]\n\n`.
//   • Sự kiện ĐẦU mang `delta:{role:"assistant",content:null}` ⇒ phải bỏ qua (nếu không, chuỗi
//     `"null"` sẽ được nối vào câu trả lời).
//   • `stream_options:{include_usage:true}` ĐƯỢC hỗ trợ; sự kiện áp chót mang `usage` +
//     `usage.prompt_tokens_details.cached_tokens` và `timings.cache_n/prompt_n` — tức **bằng chứng
//     prefix-cache đọc được ngay trong luồng** (đo sống: `cache_n:14, prompt_n:1`).

/**
 * Lỗi của một lượt stream, mang thêm MỘT bit không suy ra được từ chỗ khác: **đã có chữ ra ngoài
 * chưa?**
 *
 * ⚠ Bit này quyết định một việc mà `LLAMA_SERVER_STRICT` KHÔNG quyết định thay được: nếu luồng đứt
 * SAU khi người dùng đã đọc nửa câu, thì "lùi in-process cho an toàn" **không** an toàn — nó nối
 * nửa câu của lượt suy luận thứ nhất với cả câu của lượt thứ hai. Người dùng thấy một câu trả lời
 * lai, không ai báo gì. (Với model 30B thì lượt lùi đó còn là BẢN THỨ HAI ~19.000 MiB — xem G1-D.)
 */
export class LoiStreamServer extends Error {
  readonly daPhatChu: boolean;
  constructor(message: string, daPhatChu: boolean, options?: { cause?: unknown }) {
    super(message, options as any);
    this.name = "LoiStreamServer";
    this.daPhatChu = daPhatChu;
  }
}

/** `true` ⇔ lỗi này xảy ra SAU khi ít nhất một mảnh chữ đã rời khỏi generator. */
export function daPhatChuTruocKhiHong(err: unknown): boolean {
  return (err as any)?.daPhatChu === true;
}

/**
 * Hết giờ **NHÀN RỖI** giữa hai mảnh, KHÔNG phải hết giờ cả lượt.
 *
 * ⚠ Vì sao không mượn `LLAMA_SERVER_TIMEOUT_MS` (120 s, tổng) làm trần cả lượt như đường không
 * streaming: một câu trả lời dài đúng nghĩa có thể chạy quá 120 s mà vẫn đang nhả chữ đều đặn —
 * cắt nó đi là giết một lượt LÀNH. Cái cần bắt là *"đã 120 s không có byte nào"*. Đồng hồ được
 * ĐẶT LẠI ở mỗi mảnh nhận được, nên nó đo đúng sự im lặng chứ không đo độ dài câu trả lời.
 * Mặc định lấy theo `LLAMA_SERVER_TIMEOUT_MS` để người vận hành chỉ phải chỉnh MỘT số.
 */
function streamIdleTimeoutMs(): number {
  const rieng = Number(process.env.LLAMA_SERVER_STREAM_IDLE_TIMEOUT_MS);
  if (Number.isFinite(rieng) && rieng > 0) return Math.floor(rieng);
  const chung = Number(process.env.LLAMA_SERVER_TIMEOUT_MS);
  return Number.isFinite(chung) && chung > 0 ? Math.floor(chung) : 120_000;
}

/**
 * ★★★ BỘ PHÂN GIẢI SSE CÓ TRẠNG THÁI — **chỗ dễ sai nhất của cả task**.
 *
 * Một sự kiện SSE KHÔNG tương ứng một lần `read()`. TCP chẻ ở đâu là việc của mạng: `data: {"cho`
 * có thể tới ở mảnh này và `ices":[…]}\n\n` ở mảnh sau. Bộ phân giải nào `JSON.parse` thẳng cái
 * vừa nhận được sẽ hỏng theo cách **không tất định** — xanh trên máy dev (một mảnh), đỏ ngẫu nhiên
 * khi qua mạng thật. Repo này đã trả giá cho thước không tất định đúng một lần (Pha 1, Ư7).
 *
 * Bất biến: `push()` CHỈ trả về những sự kiện đã thấy ranh giới kết thúc (dòng trống). Phần dở
 * dang nằm lại trong `du`/`dong` cho tới mảnh sau. `ketThuc()` nhả nốt sự kiện treo khi luồng đóng
 * mà không có dòng trống cuối.
 *
 * ⚠ Gom theo ĐÚNG spec SSE (nhiều dòng `data:` trong một sự kiện thì nối bằng `\n`) chứ không
 * "mỗi dòng data: là một sự kiện": llama.cpp hiện chỉ phát một dòng, nhưng viết theo spec thì một
 * ngày server đổi hành vi cũng không đẻ ra lỗi im lặng.
 */
export class BoDocSSE {
  private du = "";
  private dong: string[] = [];

  /** Nạp một mảnh văn bản đã giải mã; trả về các payload `data:` HOÀN CHỈNH, đúng thứ tự. */
  push(mieng: string): string[] {
    this.du += mieng;
    const ra: string[] = [];
    let i: number;
    // Chỉ xử lý tới `\n` CUỐI CÙNG đã thấy; phần sau nó là dòng dở dang, để lại.
    while ((i = this.du.indexOf("\n")) >= 0) {
      const dongThô = this.du.slice(0, i).replace(/\r$/, ""); // CRLF cũng đúng
      this.du = this.du.slice(i + 1);
      if (dongThô === "") {
        const sk = this.ketThucSuKien();
        if (sk != null) ra.push(sk);
        continue;
      }
      if (dongThô.startsWith(":")) continue; // dòng chú thích / keep-alive
      const j = dongThô.indexOf(":");
      const truong = j < 0 ? dongThô : dongThô.slice(0, j);
      if (truong !== "data") continue; // `event:` / `id:` / `retry:` — không mang chữ
      let giaTri = j < 0 ? "" : dongThô.slice(j + 1);
      if (giaTri.startsWith(" ")) giaTri = giaTri.slice(1); // đúng spec: bỏ MỘT dấu cách
      this.dong.push(giaTri);
    }
    return ra;
  }

  /** Nhả nốt sự kiện còn treo (luồng đóng mà không có dòng trống kết). */
  ketThuc(): string[] {
    if (this.du.length > 0) {
      const con = this.du;
      this.du = "";
      // Dòng cuối cùng không có `\n`: vẫn phải đọc nó, nếu không mảnh chữ cuối bị NUỐT.
      this.push(con + "\n");
    }
    const sk = this.ketThucSuKien();
    return sk == null ? [] : [sk];
  }

  private ketThucSuKien(): string | null {
    if (this.dong.length === 0) return null;
    const payload = this.dong.join("\n");
    this.dong = [];
    return payload;
  }
}

/** Lấy mảnh chữ của một sự kiện chunk OpenAI. `null`/thiếu ⇒ `""` (sự kiện `role`, `finish_reason`…). */
function chuTrongChunk(json: any): string {
  const d = json?.choices?.[0]?.delta;
  const c = d?.content;
  return typeof c === "string" ? c : "";
}

/**
 * G5-D — mảnh SUY LUẬN của một sự kiện chunk. Trên đường streaming, `llama-server` phát chuỗi suy
 * luận qua `delta.reasoning_content` (ô RIÊNG, song song với `delta.content`).
 *
 * ⚠ Mảnh này **KHÔNG BAO GIỜ được `yield` như `{type:"token"}`**: mọi consumer (SSE của
 * `aiStreamingApi`, ops-chat) coi `token` là chữ để in ra màn hình. Phát suy luận ở đó là rò nội
 * tâm model ra giao diện người vận hành — đúng lớp lỗi mà `ai/thinkingStrip.ts` được dựng ra để
 * chặn, chỉ khác đường vào. Nó được gom riêng và trả về ở chunk `done` (`reasoningText`), nơi chỉ
 * bên gọi đọc, không phải người dùng.
 */
function suyLuanTrongChunk(json: any): string {
  const d = json?.choices?.[0]?.delta;
  const c = d?.reasoning_content;
  return typeof c === "string" ? c : "";
}

/**
 * Thân dùng chung cho `serverGenerateTextStream` và `serverChatCompletionStream`: POST
 * `/v1/chat/completions` với `stream:true` rồi phân giải SSE thành `GgufStreamChunk`.
 *
 * HỢP ĐỒNG — cố ý GIỐNG `serverGenerateText`: hàm này **không bao giờ tự lùi**, nó chỉ thành công
 * hoặc **ném**. Quyết định lùi/từ chối nằm ở đúng MỘT chỗ (`aiGgufEngine.thuDuongServerStream`).
 * Khác một điểm duy nhất: lỗi ném ra là `LoiStreamServer` mang cờ `daPhatChu`.
 *
 * KHÔNG ĐỂ PROMISE TREO — ba đường ra đều đi qua `finally`:
 *   • xong bình thường / `[DONE]`   • ném (server chết, hết giờ, HTTP lỗi)   • consumer `break`
 *     hoặc `return()` giữa chừng (async generator gọi `finally` khi bị đóng sớm).
 * `finally` gỡ đồng hồ, gỡ listener `abort` của signal ngoài (nếu không, một signal sống lâu sẽ
 * tích listener theo từng lượt gọi), và `reader.cancel()` để socket không nằm lại.
 */
async function* streamChatCompletion(
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  modelHienThi: string,
): AsyncGenerator<GgufStreamChunk> {
  const url = baseUrl();
  if (!url) throw new LoiStreamServer("[llamaServer] LLAMA_SERVER_URL not set", false);

  const batDau = Date.now();
  const idleMs = streamIdleTimeoutMs();
  const ctrl = new AbortController();
  let hetGioNhanRoi = false;
  let dongHo: ReturnType<typeof setTimeout> | undefined;
  const datLaiDongHo = () => {
    if (dongHo) clearTimeout(dongHo);
    dongHo = setTimeout(() => {
      hetGioNhanRoi = true;
      ctrl.abort();
    }, idleMs);
  };
  const huyTheoNgoai = () => ctrl.abort();

  let daPhatChu = false;
  let reader: { read(): Promise<{ done: boolean; value?: unknown }>; cancel(): Promise<unknown> } | undefined;

  /** Bọc mọi lỗi thành `LoiStreamServer` mang đúng bit `daPhatChu` TẠI THỜI ĐIỂM hỏng. */
  const boc = (e: unknown): LoiStreamServer => {
    if (hetGioNhanRoi) {
      return new LoiStreamServer(
        `[llamaServer] luồng stream im lặng quá ${idleMs} ms (LLAMA_SERVER_STREAM_IDLE_TIMEOUT_MS) — đã huỷ`,
        daPhatChu,
        { cause: e },
      );
    }
    const msg = (e as Error)?.message ?? String(e);
    return new LoiStreamServer(`[llamaServer] stream lỗi: ${msg}`, daPhatChu, { cause: e });
  };

  try {
    if (signal?.aborted) throw new LoiStreamServer("[llamaServer] stream bị huỷ trước khi gửi", false);
    if (signal) signal.addEventListener("abort", huyTheoNgoai, { once: true });
    datLaiDongHo();

    let res: Response;
    try {
      res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream", ...authHeaders() },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw boc(e);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // ⚠ Giữ NGUYÊN VĂN thông điệp của server trong câu lỗi: `laLoiTranNguCanh()` đọc chính chuỗi
      // này để nói đúng nguyên nhân ("vượt ngữ cảnh") cho người dùng thay vì một mã HTTP trần trụi.
      throw new LoiStreamServer(`[llamaServer] stream HTTP ${res.status}: ${detail.slice(0, 300)}`, false);
    }
    const than: any = (res as any).body;
    if (!than || typeof than.getReader !== "function") {
      throw new LoiStreamServer("[llamaServer] stream: phản hồi không có thân đọc được (body.getReader)", false);
    }
    // Biến cục bộ (không `| undefined`) cho vòng đọc; `reader` là bản sao để `finally` huỷ được
    // ở MỌI đường ra, kể cả khi consumer đóng generator giữa chừng.
    const boDocByte = than.getReader() as { read(): Promise<{ done: boolean; value?: unknown }>; cancel(): Promise<unknown> };
    reader = boDocByte;

    const bo = new BoDocSSE();
    // ⚠ `{ stream: true }` là BẮT BUỘC: một ký tự tiếng Việt có dấu chiếm 2–3 byte và TCP chẻ giữa
    // nó là chuyện thường. Thiếu cờ này thì mỗi lần chẻ đẻ ra một `U+FFFD` GIỮA CÂU TRẢ LỜI —
    // hỏng im lặng, không log, không test nào đỏ trừ khi cố tình chẻ.
    const giaiMa = new TextDecoder("utf-8");
    let fullText = "";
    let fullReasoning = "";
    let ttftMs: number | undefined;
    let tokensPrompt = 0;
    let tokensGenerated = 0;
    let soManh = 0;
    let xong = false;
    // ★★★ G2-B — bộ gom mảnh `delta.tool_calls`. MỘT thực thể cho MỘT lượt stream.
    const boGomTool = new BoGomToolCallLuong();
    let finishReason: string | undefined;

    const xuLy = function* (payloads: string[]): Generator<GgufStreamChunk> {
      for (const p of payloads) {
        if (p === "[DONE]") {
          xong = true;
          return;
        }
        let json: any;
        try {
          json = JSON.parse(p);
        } catch {
          // Một sự kiện méo KHÔNG được giết cả lượt: bỏ qua nó, phần còn lại vẫn có giá trị.
          continue;
        }
        // llama.cpp có thể trả lỗi GIỮA luồng dưới dạng một sự kiện `{"error":{…}}` (HTTP đã 200).
        if (json?.error) {
          throw new LoiStreamServer(
            `[llamaServer] stream lỗi giữa chừng: ${JSON.stringify(json.error).slice(0, 300)}`,
            daPhatChu,
          );
        }
        const u = json?.usage;
        if (u) {
          tokensPrompt = Number(u.prompt_tokens ?? tokensPrompt) || tokensPrompt;
          tokensGenerated = Number(u.completion_tokens ?? tokensGenerated) || tokensGenerated;
        }
        const t = json?.timings;
        if (t) {
          // `cache_n` = số token prompt LẤY TỪ PREFIX-CACHE, `prompt_n` = số token phải nạp lại.
          const tong = Number(t.cache_n ?? 0) + Number(t.prompt_n ?? 0);
          if (tong > 0) tokensPrompt = tong;
          if (Number(t.predicted_n ?? 0) > 0) tokensGenerated = Number(t.predicted_n);
        }
        // Gom suy luận TRƯỚC `continue` — nếu để sau, một sự kiện chỉ mang `reasoning_content`
        // (rất phổ biến ở model lai: hàng trăm sự kiện suy luận rồi mới tới chữ) sẽ rơi khỏi phép
        // gom và ta lại mất đúng cái bằng chứng cần cho ca (B).
        fullReasoning += suyLuanTrongChunk(json);
        // ★★★ G2-B — mảnh `delta.tool_calls`. Phải gom TRƯỚC `continue` vì một lượt tool-call
        // thuần KHÔNG có `delta.content` nào cả (đo sống: sự kiện đầu `content:null`, rồi chỉ
        // toàn `tool_calls`) ⇒ để sau `continue` là gom được ĐÚNG 0 mảnh — cùng cái bẫy đã
        // dính với `reasoning_content` ngay ở dòng trên.
        const manhTool = json?.choices?.[0]?.delta?.tool_calls;
        if (Array.isArray(manhTool) && manhTool.length) {
          boGomTool.nap(manhTool);
          // Phát NGUYÊN VĂN mảnh ra ngoài — gateway `/v1` cần nó để dựng `delta.tool_calls` mà
          // không phải đợi hết luồng. ⚠ Loại chunk RIÊNG, không bao giờ là `token` (consumer coi
          // `token` là chữ để in ra màn hình).
          yield { type: "tool_call_delta", toolCallDelta: manhTool };
        }
        const fr = json?.choices?.[0]?.finish_reason;
        if (typeof fr === "string" && fr) finishReason = fr;
        const chu = chuTrongChunk(json);
        if (!chu) continue;
        soManh++;
        if (ttftMs === undefined) ttftMs = Date.now() - batDau;
        fullText += chu;
        daPhatChu = true;
        yield { type: "token", token: chu };
      }
    };

    while (!xong) {
      let doc: { done: boolean; value?: unknown };
      try {
        doc = await boDocByte.read();
      } catch (e) {
        throw boc(e);
      }
      if (doc.done) break;
      datLaiDongHo(); // có byte ⇒ server còn sống ⇒ đồng hồ nhàn rỗi về 0
      const v = doc.value;
      const van = typeof v === "string" ? v : giaiMa.decode(v as any, { stream: true });
      yield* xuLy(bo.push(van));
    }
    if (!xong) yield* xuLy(bo.ketThuc());

    // ★★★ G5-D — ca (B) TRÊN ĐƯỜNG STREAMING. Trước bản vá này, một lượt mà model tiêu hết token
    // vào suy luận kết thúc bằng một chunk `done` với `fullText: ""` — tức **luồng thành công, câu
    // trả lời rỗng, không một dòng đỏ**. Người dùng thấy một ô trống; log thấy một lượt OK.
    // ⚠ Chỉ ném khi CHƯA phát chữ nào (`daPhatChu === false` theo cấu tạo: `fullText` rỗng ⇒ chưa
    // `yield` mảnh `token` nào), nên `LoiStreamServer.daPhatChu` là `false` và
    // `quyetDinhSauLoiServer()` vẫn được quyền chọn giữa "lùi in-process" và "từ chối trung thực"
    // đúng như mọi lỗi trước-khi-phát-chữ khác. Không có bất biến nào bị đổi.
    // ⚠ Ca (A) trên đường stream (rỗng CẢ HAI) cố ý GIỮ NGUYÊN hành vi cũ: nó là một lớp lỗi khác,
    // có lịch sử riêng, và sửa kèm ở đây là đổi hành vi ngoài phạm vi bản vá.
    // ★★★ G2-B — CÙNG CÁI BẪY như ở `serverChatCompletion`, đường stream. Một lượt tool-call
    // THÀNH CÔNG kết thúc với `fullText === ""` theo cấu tạo (model không phát chữ nào, chỉ phát
    // `tool_calls`). Không có điều kiện `!boGomTool.coToolCall` dưới đây thì **mọi lượt native
    // streaming đều ném** — và ném bằng câu lỗi "token cạn kiệt vào suy luận", một chẩn đoán sai.
    if (fullText.length === 0 && !boGomTool.coToolCall) {
      try {
        // ⚠ ĐÚNG vị từ dùng chung với ba đường kia — KHÔNG dựng lại phép phân định ở đây. Lượt
        // viết đầu tiên của bản vá này đã inline nó, và lưới §5 (đếm điểm gọi
        // `phanDinhCauTraLoiRong(`) bắt ngay: 4 thay vì ≥5. Bản sao thứ tư đúng hình dạng "N+1".
        phanDinhCauTraLoiRong(
          { noiDung: fullText, suyLuan: fullReasoning },
          { maxTokens: body.max_tokens as number, ten: "stream" },
        );
      } catch (e) {
        // Chỉ ca (B) mới đổi hành vi ở đường stream. Ca (A) (rỗng CẢ HAI) cố ý GIỮ NGUYÊN hành vi
        // cũ — nó là một lớp lỗi khác, có lịch sử riêng, và sửa kèm ở đây là đổi hành vi ngoài
        // phạm vi bản vá (đường không-streaming vẫn ném cho ca (A) như trước, không đổi).
        if (e instanceof LoiTokenCanKietVaoSuyLuan) throw new LoiStreamServer(e.message, false, { cause: e });
      }
    }

    const totalTimeMs = Date.now() - batDau;
    if (tokensGenerated <= 0) tokensGenerated = soManh; // server không khai `usage` ⇒ đếm mảnh
    // ★ G2-B — ô `tool_calls` đã gom đủ, kèm bộ VỚT cho build không phân giải (khối `<tool_call>`
    // nguyên văn rơi vào `content`). Bộ vớt chỉ được chạy khi lượt này CÓ gửi `tools` — mà ở
    // đường stream ta biết điều đó qua chính `body.tools`, không đoán theo nội dung chữ.
    const toolCalls = boGomTool.coToolCall
      ? boGomTool.ketThuc()
      : Array.isArray((body as { tools?: unknown[] }).tools) && (body as { tools?: unknown[] }).tools!.length
        ? gomToolCallTuVanBan(fullText).toolCalls
        : [];
    yield {
      type: "done",
      fullText: toolCalls.length ? gomToolCallTuVanBan(fullText).vanBan : fullText,
      reasoningText: fullReasoning || undefined,
      ...(toolCalls.length ? { toolCalls } : {}),
      finishReason: toolCalls.length ? "tool_calls" : finishReason,
      tokensGenerated,
      tokensPrompt,
      totalTimeMs,
      ttftMs,
      tokensPerSecond:
        totalTimeMs > 0 && tokensGenerated > 0 ? Number(((tokensGenerated / totalTimeMs) * 1000).toFixed(1)) : 0,
      modelId: modelHienThi,
    };
  } finally {
    if (dongHo) clearTimeout(dongHo);
    if (signal) signal.removeEventListener("abort", huyTheoNgoai);
    // Huỷ reader ở MỌI đường ra — kể cả khi consumer `break` giữa chừng, nếu không socket + slot
    // của llama-server nằm lại cho tới khi nó tự hết giờ.
    try {
      await reader?.cancel();
    } catch {
      /* huỷ hỏng không được che mất lỗi thật */
    }
  }
}

/**
 * Streaming text generation qua server — bản song sinh của `serverGenerateText`, cùng cách dựng
 * `messages` (vai system/user thật, server tự áp chat template) nên **cùng một chuỗi token tiền
 * tố** ⇒ prefix-cache của llama.cpp dùng chung được giữa lượt streaming và không-streaming.
 */
export async function* serverGenerateTextStream(
  options: GgufGenerateOptions,
  modelId?: string,
  signal?: AbortSignal,
): AsyncGenerator<GgufStreamChunk> {
  const messages: Array<{ role: string; content: string }> = [];
  if (options.systemPrompt) messages.push({ role: "system", content: options.systemPrompt });
  let user = options.prompt;
  if (options.jsonMode) user += "\n\nRespond with valid JSON only. No markdown, no explanations.";
  messages.push({ role: "user", content: user });

  const model = modelId ? basename(modelId) : serverModelBasename();
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.7,
    top_p: options.topP ?? 0.9,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (options.stopSequences?.length) body.stop = options.stopSequences;
  if (options.jsonMode) body.response_format = { type: "json_object" };
  lapCoTatSuyLuan(body, options.disableThinking);

  yield* streamChatCompletion(body, signal, model);
}

/**
 * Streaming chat completion qua server. Gửi NGUYÊN lịch sử hội thoại dưới dạng `messages` thay vì
 * bẹp nó thành một chuỗi `"User: …\nAssistant: …"` như đường in-process — server áp đúng chat
 * template của model. Đây cũng là điều kiện để prefix-cache ăn: các lượt sau của cùng hội thoại
 * chia sẻ đúng tiền tố token với lượt trước.
 */
export async function* serverChatCompletionStream(
  options: GgufChatOptions,
  modelId?: string,
  signal?: AbortSignal,
): AsyncGenerator<GgufStreamChunk> {
  const model = modelId ? basename(modelId) : serverModelBasename();
  const body: Record<string, unknown> = {
    model,
    messages: options.messages.map(chuyenMessageLenDay),
    max_tokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.7,
    top_p: options.topP ?? 0.9,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (options.jsonMode) body.response_format = { type: "json_object" };
  lapCoTatSuyLuan(body, options.disableThinking);
  lapToolsLenThan(body, options);

  yield* streamChatCompletion(body, signal, model);
}

// ─── doc69 Wave 4 C2 — FIM (fill-in-middle) over the persistent server ─────────────────────────

/**
 * POST to the server's `/infill` endpoint (llama.cpp server's NATIVE fill-in-middle route — NOT
 * OpenAI-compatible: `input_prefix`/`input_suffix` in, `{ content, tokens_predicted, … }` out).
 * Chosen over `/v1/chat/completions` because `/infill` performs true special-token infill
 * decoding without going through the model's chat template — see the module header for why.
 * Shares `LLAMA_SERVER_TIMEOUT_MS`/auth with the text path; targets `fimBaseUrl()` (the dedicated
 * FIM server when `LLAMA_FIM_SERVER_URL` is set, else the same server text uses).
 */
async function postInfill(body: Record<string, unknown>): Promise<{ json: any; totalTimeMs: number }> {
  const url = fimBaseUrl();
  if (!url) throw new Error("[llamaServer] no FIM server URL configured (LLAMA_FIM_SERVER_URL/LLAMA_SERVER_URL)");
  const startTime = Date.now();
  const timeoutMs = Number(process.env.LLAMA_SERVER_TIMEOUT_MS ?? 120_000);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/infill`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`[llamaServer] FIM HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }
    return { json: await res.json(), totalTimeMs: Date.now() - startTime };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Generate a fill-in-middle completion via the persistent server's `/infill` endpoint. Mirrors
 * `serverGenerateText`'s shape: throws on any transport/protocol error (empty completion
 * included) so the caller (`aiGgufEngine.generateFim`) decides fallback-in-process vs.
 * LLAMA_SERVER_STRICT throw — this function itself never falls back, it only ever succeeds or
 * throws, exactly like `serverGenerateText`/`serverGenerateJSON` above.
 *
 * No `modelId`/`model` field is sent — `/infill`, like `/completion`, is not multi-model; it
 * always answers with whatever single model the target server process has loaded (that's the
 * entire reason `shouldUseServerForFim` gates on a served-model match for the shared-server
 * shape before this is ever called).
 */
export async function generateFimViaServer(
  prefix: string,
  suffix: string,
  options: GgufFimOptions,
): Promise<GgufGenerateResult> {
  const body: Record<string, unknown> = {
    input_prefix: prefix,
    input_suffix: suffix,
    n_predict: options.maxTokens ?? 128,
    temperature: options.temperature ?? 0.1,
    top_p: options.topP ?? 0.9,
    stream: false,
  };
  if (options.topK != null) body.top_k = options.topK;
  if (options.stopSequences?.length) body.stop = options.stopSequences;

  const { json, totalTimeMs } = await postInfill(body);
  const text: string = json?.content ?? "";
  if (typeof text !== "string" || text.length === 0) throw new Error("[llamaServer] empty FIM completion");

  const tokensPrompt = Number(json?.tokens_evaluated ?? 0);
  const tokensGenerated = Number(json?.tokens_predicted ?? 0);
  const tokensPerSecond = totalTimeMs > 0 && tokensGenerated > 0 ? (tokensGenerated / totalTimeMs) * 1000 : 0;

  return {
    text,
    tokensGenerated,
    tokensPrompt,
    totalTimeMs,
    tokensPerSecond: Number(tokensPerSecond.toFixed(1)),
    modelId: String(json?.model || serverModelBasename() || "fim-server"),
  };
}
