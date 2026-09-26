/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * G2-B — TOOL-CALLING **GỐC**: KHUÔN DÂY. Module LÁ (0 import, 0 I/O, 0 env).
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * VÌ SAO CÓ FILE NÀY. Cho tới G2-B, ranh giới giữa *"một LLM có gắn công cụ"* và *"một agent"*
 * nằm ở đúng một chỗ: **model chưa bao giờ được quyền quyết định gọi tool**. Việc chọn tool do
 * `intentClassifier.classifyToolIntent()` — một bộ phân loại **regex** BÊN NGOÀI model — làm, còn
 * `_core/llm.ts` trả `tool_calls: []` như một **HẰNG SỐ** và `openaiGateway.ts` **không hề đọc**
 * `body.tools`. Ba mặt của cùng một sự thật: đường native không tồn tại.
 *
 * ─── BẰNG CHỨNG BUILD CÓ HỖ TRỢ (đo sống 2026-08-17, `:8091`, b9814-487a6cc16) ────────────────
 *   1. Gửi `tools` + `tool_choice:"auto"` ⇒ đáp ứng `finish_reason:"tool_calls"` với
 *      `message.tool_calls[0] = {type:"function",function:{name,arguments:"{\"machineId\": \"AOI-01\"}"},id}`.
 *   2. **PHÉP ĐẦU ĐỘC** (kỹ thuật đã dùng để chứng minh `enable_thinking` vào được ngữ cảnh
 *      Jinja): nhét `chat_template_kwargs:{"tools":12345}` ⇒ server trả 400 với
 *      *"While executing For at line 7, column 9 … {%- for tool in tools %} … Expected iterable
 *      or object type in for loop: got Integer"*. ⇒ biến `tools` ĐI THẲNG vào ngữ cảnh Jinja và
 *      chính nhánh `{%- if tools %}` của chat template Qwen3 là thứ đang chạy. Không suy đoán.
 *   3. Streaming: `delta.tool_calls` mảnh đầu mang `{index,id,type,function:{name,arguments}}`,
 *      các mảnh sau CHỈ mang `{index,function:{arguments}}`.
 *   4. Vòng đời: gửi lại `role:"tool"` + `tool_call_id` ⇒ model kết luận đúng ("87.3%").
 *
 * ─── ⚠⚠ VÀ HAI THỨ BUILD NÀY **KHÔNG** LÀM (cũng đo sống, cùng lượt) ──────────────────────────
 *   • `tool_choice:"none"` **KHÔNG được tôn trọng**: tools VẪN vào prompt (`cached_tokens:189`
 *     trùng lượt có tools), server chỉ TẮT bộ phân giải ⇒ chuỗi `<tool_call>{…}</tool_call>`
 *     **NGUYÊN VĂN rơi vào `content`** và đi thẳng ra màn hình người dùng.
 *   • `tool_choice:"required"` **KHÔNG cưỡng chế** (3/3 lượt trả chữ thường, 0 tool_calls).
 *   • `tool_choice:{type:"function",function:{name}}` **KHÔNG cưỡng chế** (trả chữ thường).
 *
 * ⇒ QUYẾT ĐỊNH THIẾT KẾ, ghi ở đây vì nó là thứ dễ bị "sửa cho gọn" nhất về sau:
 *   `none`     — cưỡng chế Ở PHÍA TA: **không gửi `tools` lên server**. Đó vừa là ngữ nghĩa đúng
 *                (model không gọi tool) vừa bịt luôn đường rò `<tool_call>` ở trên.
 *   `required` / theo TÊN — **NÉM `LoiToolChoiceKhongCuongCheDuoc`** ⇒ gateway trả 400 có mã.
 *                Đường còn lại là gửi lên rồi *hy vọng*; khi model trả chữ thường ta sẽ phải
 *                hoặc nói dối (đóng gói chữ thành tool_call bịa) hoặc im lặng bỏ qua ràng buộc
 *                mà client đã nêu ra. Cả hai đều là **hỏng trong im lặng**. Từ chối là câu trả
 *                lời TRUNG THỰC duy nhất, và nó nói rõ vì sao.
 *
 * ⚠ `gomToolCallTuVanBan` là bộ VỚT, KHÔNG phải đường chính: nó chỉ chạy khi server đã được gửi
 * `tools` mà đáp ứng lại không có ô `tool_calls` (build cũ / chat_format khác). Nó không bao giờ
 * được dùng để "chế" tool_call cho một lượt mà caller đã yêu cầu `none`.
 */

// ─── Khuôn dây (OpenAI) ────────────────────────────────────────────────────────────────────────

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface WireTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export type WireToolChoice = "none" | "auto";

/** Mảnh `delta.tool_calls[i]` của một sự kiện SSE. */
export interface WireToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

// ─── Lỗi ───────────────────────────────────────────────────────────────────────────────────────

/** Đầu vào của caller không đúng khuôn ⇒ 400 `invalid_request_error`. */
export class LoiToolCallKhongHopLe extends Error {
  readonly code = "invalid_tools";
  constructor(message: string) {
    super(message);
    this.name = "LoiToolCallKhongHopLe";
  }
}

/**
 * Caller nêu một ràng buộc `tool_choice` mà engine cục bộ **không cưỡng chế được** (đo sống —
 * xem đầu file). Lỗi RIÊNG, không gộp vào `LoiToolCallKhongHopLe`: đầu vào của caller **hợp lệ
 * theo chuẩn OpenAI**, cái thiếu là ở phía ta. Người đọc log phải phân biệt được hai chuyện đó.
 */
export class LoiToolChoiceKhongCuongCheDuoc extends Error {
  readonly code = "tool_choice_unsupported";
  constructor(message: string) {
    super(message);
    this.name = "LoiToolChoiceKhongCuongCheDuoc";
  }
}

/**
 * Bảng khai HÀNH VI THẬT của từng dạng `tool_choice` trên roster đang chạy. Là DỮ LIỆU (test đọc
 * được, log in được), không phải một đoạn văn trong comment mà không ai kiểm được.
 */
export const MO_TA_HANH_VI_TOOL_CHOICE = {
  auto: {
    cuongCheDuoc: true,
    cach: "gửi thẳng `tools` lên llama-server; bộ phân giải của server trả `message.tool_calls`",
  },
  none: {
    cuongCheDuoc: true,
    cach:
      "KHÔNG gửi `tools` lên server. Gửi kèm `tool_choice:\"none\"` thì b9814 vẫn nhét tools vào " +
      "prompt và chỉ tắt bộ phân giải ⇒ `<tool_call>` nguyên văn rò vào `content`.",
  },
  required: {
    cuongCheDuoc: false,
    cach: "đo sống 3/3 lượt: model trả chữ thường, 0 tool_calls. Gateway TỪ CHỐI (400) thay vì im lặng.",
  },
  named: {
    cuongCheDuoc: false,
    cach: "đo sống: model trả chữ thường, 0 tool_calls. Gateway TỪ CHỐI (400) thay vì im lặng.",
  },
} as const;

// ─── Chuẩn hoá đầu vào ─────────────────────────────────────────────────────────────────────────

/** Khuôn tên hàm của OpenAI. Tên lệch khuôn ⇒ template dựng prompt vẫn chạy nhưng client không
 * khớp lại được kết quả với tool của nó. */
const KHUON_TEN_TOOL = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * Chuẩn hoá `body.tools`.
 *   • vắng / null / mảng rỗng ⇒ `undefined` (KHÔNG bật nhánh tool).
 *   • bất kỳ phần tử nào hỏng ⇒ **NÉM**. ⚠ Cố ý KHÔNG "lọc bỏ phần tử hỏng": một tool bị nuốt
 *     trong im lặng làm model không bao giờ gọi được nó, và triệu chứng ở phía client là
 *     "model ngu" chứ không phải "request sai" — đúng lớp lỗi khó truy nhất.
 */
export function chuanHoaTools(raw: unknown): WireTool[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new LoiToolCallKhongHopLe("`tools` phải là một mảng.");
  }
  if (raw.length === 0) return undefined;

  const daThay = new Set<string>();
  const ra: WireTool[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i] as Record<string, unknown> | null;
    if (!t || typeof t !== "object" || Array.isArray(t)) {
      throw new LoiToolCallKhongHopLe(`tools[${i}] phải là một object.`);
    }
    if (t.type !== "function") {
      throw new LoiToolCallKhongHopLe(
        `tools[${i}].type phải là "function" (nhận: ${JSON.stringify(t.type)}). Engine cục bộ chỉ hỗ trợ tool dạng function.`,
      );
    }
    const fn = t.function as Record<string, unknown> | undefined;
    if (!fn || typeof fn !== "object" || Array.isArray(fn)) {
      throw new LoiToolCallKhongHopLe(`tools[${i}].function phải là một object.`);
    }
    const name = fn.name;
    if (typeof name !== "string" || !KHUON_TEN_TOOL.test(name)) {
      throw new LoiToolCallKhongHopLe(
        `tools[${i}].function.name phải khớp ^[A-Za-z0-9_.-]{1,64}$ (nhận: ${JSON.stringify(name)}).`,
      );
    }
    if (daThay.has(name)) {
      throw new LoiToolCallKhongHopLe(
        `tools[${i}].function.name trùng ("${name}") — model không phân biệt được hai tool cùng tên.`,
      );
    }
    daThay.add(name);

    const params = fn.parameters;
    if (params !== undefined && (params === null || typeof params !== "object" || Array.isArray(params))) {
      throw new LoiToolCallKhongHopLe(
        `tools[${i}].function.parameters phải là một JSON-Schema object (chat template gọi \`tool | tojson\` trên nó).`,
      );
    }
    const desc = fn.description;
    if (desc !== undefined && typeof desc !== "string") {
      throw new LoiToolCallKhongHopLe(`tools[${i}].function.description phải là chuỗi.`);
    }

    ra.push({
      type: "function",
      function: {
        name,
        ...(desc !== undefined ? { description: desc } : {}),
        ...(params !== undefined ? { parameters: params as Record<string, unknown> } : {}),
      },
    });
  }
  return ra;
}

/**
 * Chuẩn hoá `body.tool_choice` — chỉ trả về những dạng engine **cưỡng chế được**.
 * Xem `MO_TA_HANH_VI_TOOL_CHOICE` cho lý lẽ đo được của từng nhánh.
 */
export function chuanHoaToolChoice(raw: unknown): WireToolChoice | undefined {
  if (raw === undefined || raw === null) return undefined;

  if (typeof raw === "string") {
    if (raw === "auto") return "auto";
    if (raw === "none") return "none";
    if (raw === "required") {
      throw new LoiToolChoiceKhongCuongCheDuoc(
        `tool_choice:"required" KHÔNG cưỡng chế được trên engine cục bộ (${MO_TA_HANH_VI_TOOL_CHOICE.required.cach}). ` +
          `Dùng "auto" và tự kiểm tra ở phía client, hoặc bỏ ràng buộc này.`,
      );
    }
    throw new LoiToolCallKhongHopLe(
      `tool_choice không hợp lệ: ${JSON.stringify(raw)} (chấp nhận "none" | "auto").`,
    );
  }

  if (typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const fn = o.function as Record<string, unknown> | undefined;
    if (o.type === "function" && fn && typeof fn.name === "string") {
      throw new LoiToolChoiceKhongCuongCheDuoc(
        `tool_choice theo TÊN ("${fn.name}") KHÔNG cưỡng chế được trên engine cục bộ ` +
          `(${MO_TA_HANH_VI_TOOL_CHOICE.named.cach}). Dùng "auto" và tự kiểm tra ở phía client.`,
      );
    }
  }

  throw new LoiToolCallKhongHopLe(
    `tool_choice không hợp lệ: ${JSON.stringify(raw)} (chấp nhận "none" | "auto").`,
  );
}

// ═══ GIỚI HẠN CỦA BỘ SINH GRAMMAR (llama.cpp) ═════════════════════════════════════════════════
//
// ★★★ ĐO SỐNG 2026-08-17, `:8091` b9814 — nhị phân trên chính server đang chạy, KHÔNG trích tài liệu.
// llama.cpp biến JSON-Schema của mỗi tool thành GBNF để ép decoder. Hai cấu trúc làm bước ấy CHẾT,
// và nó chết theo kiểu tệ nhất: **HTTP 400 `"Failed to initialize samplers: failed to parse grammar"`
// cho TOÀN BỘ yêu cầu** — một tool lỗi giết cả 77 tool, và câu lỗi không nói tool nào, ô nào.
//
//   1. `maxLength` — đo nhị phân: **1999 CHẠY · 2000 HỎNG**. (Bộ sinh trải `maxLength` thành ngần
//      ấy lượt lặp trong GBNF.)
//   2. `pattern` — chỉ regex ĐƠN GIẢN, CÓ NEO hai đầu mới qua được:
//        "^[A-Za-z0-9]+$"    OK      "^abc$"            OK      "^[A-Za-z0-9_-]+$"  OK
//        "^[A-Za-z0-9_\\-]+$" HỎNG   "^\\d+$"           HỎNG    "[a-z]+"            HỎNG
//      (dấu `\` thoát trong lớp ký tự, và regex KHÔNG neo, đều làm bộ chuyển regex→GBNF bó tay.)
//
// ⚠ VÌ SAO ĐIỀU NÀY QUAN TRỌNG CHO REGISTRY 77 TOOL: **9/77 tool tự nó đã làm hỏng grammar**
// (`resolve_predictive_alert` · `create_measurement_point` · `propose_interlock_rule` ·
// `create_maintenance_workorder` · `syntax_check_program` · `compile_program` · `simulate_program` ·
// `generate_program` · `write_project_file`) — vì `z.string().max(2000+)` và `z.string().regex(...)`
// là những thứ hoàn toàn bình thường để viết trong một schema Zod. Ai nối registry vào tool-calling
// gốc mà không đi qua đây sẽ nhận đúng một HTTP 400 mù cho MỌI câu hỏi.

/** Trần `maxLength` mà bộ sinh grammar còn dựng được (đo nhị phân: 1999 chạy, 2000 hỏng). */
export const TRAN_MAXLENGTH_GRAMMAR = 1999;

/** Regex mà bộ chuyển regex→GBNF của llama.cpp nuốt được: có neo `^…$`, không dấu `\` thoát. */
function patternAnToan(p: string): boolean {
  return p.startsWith("^") && p.endsWith("$") && !p.includes("\\");
}

function duyetSchema(node: unknown, tham: (o: Record<string, unknown>, duong: string) => void, duong = ""): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((n, i) => duyetSchema(n, tham, `${duong}[${i}]`));
    return;
  }
  const o = node as Record<string, unknown>;
  tham(o, duong || "(gốc)");
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === "object") duyetSchema(v, tham, duong ? `${duong}.${k}` : k);
  }
}

/**
 * Liệt kê những chỗ trong `tools` sẽ làm llama.cpp **từ chối cả yêu cầu**. Mảng RỖNG = đi được.
 * Trả về câu người đọc được (tool nào, đường nào, giá trị nào) thay vì một `boolean`: câu lỗi gốc
 * của server không nói tool nào, và đó chính là thứ làm lớp lỗi này khó truy.
 */
export function timGioiHanGrammar(tools: WireTool[] | undefined): string[] {
  if (!tools?.length) return [];
  const loi: string[] = [];
  for (const t of tools) {
    duyetSchema(t.function.parameters, (o, duong) => {
      const ml = o.maxLength;
      if (typeof ml === "number" && ml > TRAN_MAXLENGTH_GRAMMAR) {
        loi.push(
          `${t.function.name}: ${duong}.maxLength=${ml} > ${TRAN_MAXLENGTH_GRAMMAR} — bộ sinh grammar của llama.cpp không dựng nổi`,
        );
      }
      const pt = o.pattern;
      if (typeof pt === "string" && !patternAnToan(pt)) {
        loi.push(
          `${t.function.name}: ${duong}.pattern=${JSON.stringify(pt)} — regex→GBNF chỉ nhận dạng có neo ^…$ và KHÔNG có dấu \\ thoát`,
        );
      }
    });
  }
  return loi;
}

/**
 * Bản SAO đã cắt gọt của một JSON-Schema để nó đi lọt bộ sinh grammar: kẹp `maxLength` về trần và
 * BỎ mọi `pattern` không an toàn.
 *
 * ⚠ CHỈ dùng cho schema do CHÍNH HỆ THỐNG dựng (harness đo lường / cầu nối registry), **KHÔNG** áp
 * âm thầm lên `tools` mà caller `/v1` gửi tới: sửa lặng lẽ ràng buộc của người khác rồi vẫn trả
 * 200 là một dạng nói dối khác. Trên đường `/v1`, `timGioiHanGrammar()` NÓI RA và trả 400.
 */
export function veSchemaAnToanChoGrammar<T>(schema: T): T {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map((s) => veSchemaAnToanChoGrammar(s)) as unknown as T;
  const ra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === "maxLength" && typeof v === "number" && v > TRAN_MAXLENGTH_GRAMMAR) {
      ra[k] = TRAN_MAXLENGTH_GRAMMAR;
    } else if (k === "pattern" && typeof v === "string" && !patternAnToan(v)) {
      continue; // bỏ hẳn ô
    } else if (v && typeof v === "object") {
      ra[k] = veSchemaAnToanChoGrammar(v);
    } else {
      ra[k] = v;
    }
  }
  return ra as T;
}

// ─── Đọc kết quả ───────────────────────────────────────────────────────────────────────────────

/** Một `tool_call` chỉ HỢP LỆ khi nó khớp trọn hợp đồng OpenAI: có id, có tên, args là CHUỖI. */
export function toolCallHopLe(t: unknown): boolean {
  if (!t || typeof t !== "object") return false;
  const o = t as Record<string, any>;
  return (
    typeof o.id === "string" &&
    o.id.length > 0 &&
    o.type === "function" &&
    !!o.function &&
    typeof o.function.name === "string" &&
    o.function.name.length > 0 &&
    typeof o.function.arguments === "string"
  );
}

let demId = 0;
/** Id thay thế khi server không khai — vòng đời tool-call cần `tool_call_id` để khớp lại. */
function sinhId(): string {
  demId = (demId + 1) % 1_000_000;
  return `call_${Date.now().toString(36)}${demId.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** `arguments` về CHUỖI JSON theo hợp đồng OpenAI (vài build trả object). */
function argsVeChuoi(a: unknown): string {
  if (typeof a === "string") return a;
  if (a === undefined || a === null) return "{}";
  try {
    return JSON.stringify(a);
  } catch {
    return "{}";
  }
}

/** Đọc `message.tool_calls` của một đáp ứng KHÔNG-stream. Luôn trả MẢNG (rỗng ⇒ không có). */
export function docToolCallTuMessage(message: unknown): WireToolCall[] {
  const m = message as Record<string, any> | null | undefined;
  const raw = m?.tool_calls;
  if (!Array.isArray(raw)) return [];
  const ra: WireToolCall[] = [];
  for (const t of raw) {
    const fn = t?.function;
    const name = fn?.name;
    if (typeof name !== "string" || !name) continue; // lượt gọi vô danh là rác
    ra.push({
      id: typeof t?.id === "string" && t.id ? t.id : sinhId(),
      type: "function",
      function: { name, arguments: argsVeChuoi(fn?.arguments) },
    });
  }
  return ra;
}

/**
 * Gom mảnh `delta.tool_calls` của luồng SSE thành các lượt gọi hoàn chỉnh.
 * Khoá theo `index` (khuôn đo sống), giữ thứ tự theo `index` tăng dần.
 */
export class BoGomToolCallLuong {
  private readonly theo = new Map<number, { id?: string; name?: string; args: string }>();

  /** true ngay khi nhận mảnh HỢP LỆ đầu tiên — dùng để phân biệt "lượt tool_calls" với "lượt chữ". */
  get coToolCall(): boolean {
    return this.theo.size > 0;
  }

  nap(deltas: unknown): void {
    if (!Array.isArray(deltas)) return;
    for (const d of deltas as WireToolCallDelta[]) {
      if (!d || typeof d !== "object") continue;
      const idx = typeof d.index === "number" ? d.index : undefined;
      if (idx === undefined) continue; // mảnh méo — bỏ, không giết cả lượt
      const cu = this.theo.get(idx) ?? { args: "" };
      if (typeof d.id === "string" && d.id) cu.id = d.id;
      const fn = d.function;
      if (fn) {
        if (typeof fn.name === "string" && fn.name) cu.name = fn.name;
        if (typeof fn.arguments === "string") cu.args += fn.arguments;
      }
      this.theo.set(idx, cu);
    }
  }

  ketThuc(): WireToolCall[] {
    return [...this.theo.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v)
      .filter((v) => !!v.name)
      .map((v) => ({
        id: v.id || sinhId(),
        type: "function" as const,
        function: { name: v.name!, arguments: v.args || "{}" },
      }));
  }
}

/**
 * Bộ VỚT — xem lý lẽ ở đầu file. Tách các khối `<tool_call>{json}</tool_call>` NGUYÊN VĂN ra
 * khỏi chữ hiển thị và dựng lại thành `tool_calls`.
 *
 * ⚠ Trả về CẢ HAI: chữ đã DỌN (`vanBan`) và các lượt gọi vớt được. Kể cả khi khối JSON hỏng và
 * không vớt được gì, chữ vẫn phải được dọn — đẩy `<tool_call>{rác}</tool_call>` ra người dùng là
 * đúng cái triệu chứng đã đo được ở nhánh `tool_choice:"none"`.
 */
export function gomToolCallTuVanBan(raw: string): { vanBan: string; toolCalls: WireToolCall[] } {
  if (!raw || raw.indexOf("<tool_call>") === -1) return { vanBan: raw ?? "", toolCalls: [] };
  const toolCalls: WireToolCall[] = [];
  const vanBan = raw
    .replace(/<tool_call>([\s\S]*?)<\/tool_call>/g, (_all, than: string) => {
      try {
        const o = JSON.parse(than.trim());
        const name = o?.name;
        if (typeof name === "string" && name) {
          toolCalls.push({
            id: typeof o?.id === "string" && o.id ? o.id : sinhId(),
            type: "function",
            function: { name, arguments: argsVeChuoi(o?.arguments) },
          });
        }
      } catch {
        /* khối hỏng: không vớt được, nhưng vẫn phải DỌN khỏi chữ */
      }
      return "";
    })
    .trim();
  return { vanBan, toolCalls };
}
