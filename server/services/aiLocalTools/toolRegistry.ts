/**
 * AI Local Tools — Tool Registry
 *
 * Read-only DB query tools that can be called by the local AI assistant
 * to answer questions that need real-time data (today stats, lot status,
 * machine status, defect trends).
 *
 * Design principles:
 * - Tools are READ-ONLY. No INSERT/UPDATE/DELETE allowed.
 * - All tools use Drizzle ORM (parameterized queries) to avoid SQL injection.
 * - Tools return structured ToolResult that the frontend can render as cards.
 */

import { z } from "zod";
import type { AuditChangeField } from "../auditTrailService";

export type ToolResultType =
  | "today_stats"
  | "lot_status"
  | "machine_status"
  | "defect_trend"
  | "top_defects"
  | "factory_stats"
  | "ng_compare"
  | "oee"
  | "model_metrics"
  | "action_result"
  // ── Sprint F6 — line-monitoring read + insight tools (additive) ──
  | "process_result"
  | "process_metric_trend"
  | "line_balance"
  | "throughput"
  | "palletizer_status"
  | "ot_telemetry"
  | "line_insight"
  | "correlation_insight"
  // ── Phase B4 — Management/Analytics read tools (additive) ──
  | "analytics_oee"
  | "analytics_pareto"
  | "analytics_heatmap"
  | "analytics_yield"
  | "analytics_spc"
  | "analytics_pdm_forecast"
  | "analytics_forecast"
  // ── Phase P2 (group A) — high-priority READ tools (additive) ──
  | "work_order_list"
  | "alert_list"
  | "spec_limits"
  | "recipe_list"
  // ── Phase P2 (groups B & C) — additional READ tools (additive) ──
  | "product_list"
  | "rca_history"
  | "user_list"
  | "api_key_list"
  | "change_history"
  | "machine_health"
  // ── Phase P2 (group D) — anomalies, genealogy, energy, routing (additive) ──
  | "anomaly_list"
  | "genealogy_trace"
  | "energy_metrics"
  | "routing_steps"
  // ── doc 56 Đ6 — device-standardization persona tools (process + drift + SPC + fleet) ──
  | "device_health"
  | "fleet_process_summary"
  // ── Pha 4 Task 4 (VRAM) — ảnh chụp trạng thái bộ điều phối VRAM cho AI Agent ──
  | "vram_state";

export interface ToolResult<T = unknown> {
  type: ToolResultType;
  title: string;
  data: T;
  /** Compact text representation (for LLM context injection). */
  textSummary: string;
  /** Optional human-readable note for empty / error cases. */
  note?: string;
}

// ─── GĐ2: write-action descriptor support ──────────────────────────────────

/** Language union shared with the KB service (vi/en/zh). */
export type ToolLang = "vi" | "en" | "zh";

/** RBAC requirement for a write tool. Maps to checkPermission(module, action). */
export interface ToolPermission {
  module: string;
  action: "canView" | "canCreate" | "canEdit" | "canDelete" | "canExport";
}

/**
 * Execution context threaded from the API layer down to a write tool's
 * preview()/execute(). `user` is the REAL authenticated session user (never
 * trusted from the client body). `req` carries request metadata for audit.
 */
export interface ToolExecContext {
  user: { id: number; role: string; name?: string | null };
  lang: ToolLang;
  req?: { ip?: string; headers?: Record<string, any>; socket?: { remoteAddress?: string } };
  /**
   * Sprint F4a — id of the confirmed ai_pending_actions row, threaded ONLY at
   * execute() time (confirmAction). Lets a write-tool pass it to the
   * commandDispatcher for defense-in-depth (re-verify the HITL action is
   * confirmed + owned). Additive/optional — read tools and propose() ignore it.
   */
  actionId?: string;
}

/** Result of a tool's execute() — reuses ToolResult shape for rendering. */
export type ToolExecuteResult = ToolResult;

/**
 * GĐ3a Mục 5 — Client-side directive (navigate / prefill_form). Produced by a
 * 'client' tool's buildClientAction(); forwarded to the FE via the
 * `client_action` StreamEvent. NEVER touches the DB and does NOT go through the
 * HITL write flow (only the viewer's permission applies, implicitly).
 */
export interface ClientActionDirective {
  /** 'navigate' → setLocation(route); 'prefill_form' → publish values for route. */
  action: "navigate" | "prefill_form";
  /** Whitelisted route (validated server-side against ALLOWED_CLIENT_ROUTES). */
  route: string;
  /** Field values to prefill (prefill_form only). */
  values?: Record<string, unknown>;
  /** Localized human-readable confirmation message. */
  message: string;
  /**
   * doc69 G2-7 — true when this directive was ATTACHED by the assistant to ground
   * a how-to answer (server/services/aiOperationalGrounding.ts), as opposed to an
   * explicit user command ("mở trang X" → the navigate/prefill_form tools above).
   * Undefined/false for every existing explicit-command directive (byte-identical
   * behavior preserved). The FE must NOT auto-navigate when this is true — render
   * a tappable "Mở màn X" button instead, since the user didn't ask to leave the
   * answer they're reading.
   */
  suggested?: boolean;
}

/**
 * Dry-run preview of a write action. Computed BEFORE any DB mutation so the
 * user can confirm. `changes` reuses the audit AuditChangeField (before/after).
 */
export interface ActionPreview {
  entityType: string;
  entityId?: number;
  entityName?: string;
  changes: AuditChangeField[];
  warnings: string[];
  humanSummary: string;
}

export interface Tool<TParams = unknown, TData = unknown> {
  name: string;
  description: string;
  /** Zod schema for params (used to validate args from intent classifier). */
  parameters: z.ZodType<TParams>;
  /**
   * Read tool handler — executes a read-only query and returns a ToolResult.
   * OPTIONAL for write tools (they use preview/execute instead). GĐ1 read
   * tools always provide this and are unchanged.
   */
  handler?: (params: TParams) => Promise<ToolResult<TData>>;
  /** Vietnamese trigger keywords for fast heuristic intent matching. */
  triggers: string[];

  // ── GĐ2 OPTIONAL fields (read tools omit them → default kind 'read') ──
  /**
   * 'read' (default) runs immediately; 'write' goes through HITL confirm;
   * 'client' (GĐ3a Mục 5) emits a client_action directive (navigate/prefill) —
   * no DB mutation, no HITL.
   */
  kind?: "read" | "write" | "client";
  /** RBAC gate checked before propose AND before execute (write tools). */
  requiredPermission?: ToolPermission;
  /** Human-readable confirm summary (vi/en/zh). */
  summarize?: (params: TParams, lang: ToolLang) => string;
  /** Dry-run: read current state, compute before/after changes. NO DB write. */
  preview?: (params: TParams, ctx: ToolExecContext) => Promise<ActionPreview>;
  /** Apply the mutation. Only called after confirm. Uses ctx.user.id for audit. */
  execute?: (params: TParams, ctx: ToolExecContext) => Promise<ToolExecuteResult>;
  /**
   * GĐ3a Mục 5 — 'client' tools: build the FE directive (navigate/prefill).
   * Validates route whitelist; returns null when the route is not allowed.
   */
  buildClientAction?: (params: TParams, ctx: ToolExecContext) => ClientActionDirective | null;
}

/** True when the tool is a client-side directive tool (navigate/prefill). */
export function isClientTool(tool: Tool<any, any> | undefined | null): boolean {
  return !!tool && tool.kind === "client";
}

/** True when the tool is a write-action requiring HITL confirm. */
export function isWriteTool(tool: Tool<any, any> | undefined | null): boolean {
  return !!tool && tool.kind === "write";
}

/**
 * Assert a write tool is fully wired (preview + execute + permission). Throws
 * a descriptive error otherwise so a half-defined write tool fails loudly
 * rather than silently mutating without a preview/RBAC gate.
 */
export function assertExecutable(tool: Tool<any, any>): void {
  if (!isWriteTool(tool)) return;
  const missing: string[] = [];
  if (typeof tool.preview !== "function") missing.push("preview");
  if (typeof tool.execute !== "function") missing.push("execute");
  if (!tool.requiredPermission) missing.push("requiredPermission");
  if (typeof tool.summarize !== "function") missing.push("summarize");
  if (missing.length) {
    throw new Error(`Write tool "${tool.name}" is missing: ${missing.join(", ")}`);
  }
}

/**
 * ★★★ Pha 4 Task 4 (review vòng 1, C-1) — **TIÊM `__authCtx` VÀO ARGS CỦA READ TOOL.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐÂY LÀ NỢ CÓ SẴN CỦA REPO, VÀ NÓ LÀM CHẾT **CẢ HỌ** READ TOOL CÓ RBAC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `readToolsP2.ts` / `readToolsP2bc.ts` / `readToolsP2d.ts` / `analyticsTools.ts` đều khai
 * `__authCtx: authCtxSchema.optional()` trong schema và **TỪ CHỐI fail-safe khi nó vắng** — nhưng
 * người gọi `tool.handler(...)` **không bao giờ** đưa `execCtx` vào `args`.
 * ⇒ Mọi tool ấy **LUÔN** trả `PERMISSION_DENIED` trên đường Agent. Chúng có test, có đăng ký, có
 * schema — và **không ai đọc được dữ liệu của chúng**: đúng định nghĩa "đồng hồ không kim", chỉ ở
 * tầng khác. Người review Task 4 tìm ra bằng cách chạy probe từ **đầu đường**, không phải bằng suy
 * luận; bộ ca cũ (gọi thẳng `handler()` kèm `__authCtx` tiêm tay) **mù đúng chỗ này**.
 *
 * ⚠ VÌ SAO SỬA Ở ĐÂY, KHÔNG VÁ TỪNG TOOL: một tool tự đọc danh tính từ đâu đó khác là **đường thứ
 * hai** cho một sự thật đã có chủ (`ToolExecContext.user` — người dùng phiên THẬT, không tin từ
 * client). Vá 20 tool là 20 bản sao.
 *
 * ⚠⚠ CHỈ TIÊM KHI SCHEMA CỦA TOOL **CÓ KHAI** `__authCtx` (các schema đều `.strict()`): một tool
 * không khai mà bị nhét thêm khoá lạ sẽ **vỡ** ở bất kỳ lượt `safeParse` nào về sau. Phép tiêm này
 * do đó **cộng thêm, không đổi gì** với tool cũ không dùng RBAC.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 N-1 (re-review Task 4) — **`__authCtx` ĐẾN TỪ ARGS BỊ XOÁ, LUÔN LUÔN, TRƯỚC MỌI NHÁNH.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản trước mở bằng `if (!execCtx) return args` — **trả lại NGUYÊN VĂN** một `__authCtx` do đầu vào
 * bịa. Người review đo được thật: `checkPermission` nhận `[999, "superadmin", …]` và **tool CHẠY**.
 * Đường vào là **người sản xuất args không tin được**: `classifyToolIntentLLM()` (và
 * `aiAgentPlanner`) cho `tool.parameters.safeParse(args)`, và vì `__authCtx` là ô **ĐÃ KHAI** trong
 * schema nên `safeParse` **GIỮ NGUYÊN** nó.
 *
 * ⇒ Thứ tự **KHÔNG ĐẢO ĐƯỢC**: (1) **XOÁ** `__authCtx` khỏi args — nó **KHÔNG BAO GIỜ** là nguồn
 * danh tính, dù có `execCtx` hay không; (2) chỉ khi CÓ `execCtx` **và** schema có khai thì mới gán
 * lại từ `ToolExecContext.user` (người dùng phiên THẬT, máy chủ tự đọc).
 * ⚠ Một `return args` nào chen vào **trước** bước (1) là mở lại đúng lỗ này.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 TASK 5 (review) — **VÌ SAO HÀM NÀY NẰM Ở `toolRegistry.ts`, KHÔNG PHẢI `index.ts`.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản trước để nó **private trong `index.ts`**, nên nó chỉ che được **MỘT** đường thoát
 * (`tryExecuteTool`). Repo có **HAI** người gọi `Tool.handler` trong mã sản xuất; người thứ hai —
 * `aiAgentOrchestrator` (Agent TỰ TRỊ) — gọi thẳng `tool.handler(step.args)` và do đó **FAIL-OPEN**:
 * bỏ qua hàm này là **bỏ luôn bước XOÁ**, nên một `__authCtx` bịa (mục tiêu người dùng → prompt của
 * `aiAgentPlanner` → `safeParse` GIỮ ô đã khai → `step.args`) đi thẳng vào `checkPermission`, nơi
 * `role === "admin"` được `accessControl.ts` cho qua **không đọc DB** ⇒ god-mode trên cả 29 read tool.
 * ⚠⚠ Đây là *"lưới theo FILE, không theo ĐƯỜNG THOÁT"* — lần thứ **MƯỜI MỘT** trong chuỗi pha.
 * ⇒ Hàm sống cạnh **kiểu `Tool`** mà nó bảo vệ, ở module LÁ (không import gì ngoài `zod`), để **mọi**
 * người gọi `Tool.handler` đều với tới được mà không tạo vòng nhập.
 * ⚠ Lưới canh: `aiAgentOrchestrator.authCtx.test.ts` (đi từ đầu đường tự trị) +
 * `authCtxInjection.test.ts` (đường `tryExecuteTool` + **bản kiểm đếm MỌI điểm gọi `.handler(`**).
 */
/**
 * ★★★ 🔴 C-1 (review Task 4) — **"CÓ TÊN `lang`" KHÔNG CÓ NGHĨA LÀ "LÀ NGÔN NGỮ HIỂN THỊ".**
 *
 * Bản vá vòng trước tiêm `execCtx.lang` vào **mọi** ô tên `lang`. Đo lúc chạy: **30/77** tool có ô
 * ấy — nhưng **hai** trong số đó (`retrieve_programming_kb`, `lookup_error_code`,
 * `readToolsProgramming.ts:455/:504`) khai `z.string().min(1).max(16)` và dùng nó làm **BỘ LỌC
 * NGÔN NGỮ CỦA KHO TÀI LIỆU** (`aiProgrammingKnowledgeService.chunkMatchesFilters`). Người review
 * đo trên kho thật (91.678 chunk: en 91.392 · vi 237 · zh 49): một câu hỏi **tiếng Việt** về mã
 * lỗi servo bị ép `lang="vi"` ⇒ RAG chỉ quét **237/91.678 chunk (0,26%)** và trả **sai tài liệu**,
 * im lặng. `programmingTools.test.ts` **28/28 vẫn xanh**.
 *
 * ⇒ Đây là lớp lỗi **"neo theo TÊN, không theo NGHĨA"**. Và **chính KIỂU đã nói ra sự khác biệt
 * trước khi có phép đo nào**: `z.string().max(16)` **không phải** `z.enum(["vi","en","zh"])` — hai
 * ô trùng tên mà khác kiểu là **hai khái niệm khác nhau**.
 *
 * ⇒ Vị từ dưới đây phát biểu **cái ô ấy PHẢI LÀ**: *một enum nhận **đúng** tập ba ngôn ngữ hiển
 * thị*. Không liệt kê tool nào được/không được tiêm, không dò tên tool, không thử "ô này có từ
 * chối `ja` không" (một `z.string().length(2)` cũng từ chối `ja`, và vẫn không phải ngôn ngữ hiển
 * thị). Ô nào **không** chứng minh được mình là enum ba giá trị thì **không được đụng tới** —
 * hỏng theo chiều **AN TOÀN**.
 *
 * ⚠ Bóc vỏ qua `_def.innerType` để đi xuyên `.optional()`/`.default()`/`.nullable()` (zod v4 để
 * `_def.type = "optional"`, v3 để `_def.typeName = "ZodOptional"` — đọc `innerType` đúng ở cả hai).
 * `.options` là bề mặt công khai của `ZodEnum` ở cả hai đời (nên `z.nativeEnum({vi,en,zh})` — cùng
 * **khái niệm**, khác cách viết — cũng được nhận đúng).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ QUY ƯỚC CÓ TÊN — **"Ô NGÔN NGỮ HIỂN THỊ PHẢI VIẾT BẰNG `z.enum` (hoặc `z.nativeEnum`)."**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * N-2 (re-review): vị từ này có **hai âm tính giả** đã biết — `z.union([z.literal("vi"), …])` và
 * `z.preprocess(…, z.enum([…]))` đều trả **`false`** dù về nghĩa là cùng một ô. Hậu quả rơi theo
 * chiều **AN TOÀN** (tool ấy **không được tiêm** ⇒ rơi về `vi`, không phải lọc nhầm kho như C-1),
 * và **hôm nay 0 tool nào viết như vậy**.
 * ⇒ Không nới vị từ để đuổi theo mọi cách viết tương đương — **đó là liệt kê, và luôn có cách viết
 * thứ N+1**. Thay vào đó quy ước trên được **cưỡng chế bằng hành vi**: `vramPhrases.exhaustive
 * .test.ts` §E có ca *"KHÔNG có ÂM TÍNH GIẢ trong registry"* — nó thử **hành vi `safeParse`** của
 * từng ô `lang` đã đăng ký, và **đỏ** nếu một ô **xử sự đúng như** enum ba ngôn ngữ mà vị từ lại
 * nói `false`. Viết bằng `z.union` thì ca ấy đỏ và chỉ thẳng về quy ước này.
 */
const NGON_NGU_HIEN_THI = ["en", "vi", "zh"] as const;

export function laOEnumNgonNguHienThi(o: unknown): boolean {
  let n: unknown = o;
  // Trần 8 lớp: đủ cho mọi chồng vỏ thực tế, và chặn vòng lặp vô hạn nếu schema tự tham chiếu.
  for (let i = 0; i < 8 && n !== null && n !== undefined; i++) {
    const opts = (n as { options?: unknown }).options;
    if (Array.isArray(opts)) {
      const co = [...new Set(opts.map((v) => String(v)))].sort();
      return co.length === NGON_NGU_HIEN_THI.length && co.every((v, k) => v === NGON_NGU_HIEN_THI[k]);
    }
    n = (n as { _def?: { innerType?: unknown } })._def?.innerType;
  }
  return false;
}

export function argsWithAuthCtx(tool: Tool<any, any>, args: unknown, execCtx?: ToolExecContext): unknown {
  /**
   * 🔴 N-4 (re-review Task 4) — **DÒNG NÀY TỪNG LÀ `return args`, VÀ ĐÓ LÀ MỘT LỖ DANH TÍNH.**
   *
   * Trong JS một **MẢNG** là `typeof "object"` nhưng bị `Array.isArray()` loại ⇒ nhánh cũ trả nó
   * **NGUYÊN VĂN**, kèm mọi thuộc tính gắn trên nó. Người review đo được: một mảng mang
   * `__authCtx` ⇒ `checkPermission(999, "superadmin", …)` và **tool CHẠY**.
   * ⚠⚠ Và chính docstring trên đã viết *"một `return args` chen vào TRƯỚC bước (1) là mở lại đúng
   * lỗ này"* — rồi **dòng đầu hàm đúng là như thế**. Một lời cảnh báo không tự thi hành.
   *
   * ⇒ `return {}`: đầu vào **không phải một túi tham số hợp lệ** thì **không mang được gì qua đây**.
   * Chiều CHẶT — mọi schema của tool đều là `z.object().strict()`, nên args hợp lệ **không bao giờ**
   * là mảng/chuỗi/`null`; đánh rơi một đầu vào méo an toàn hơn hẳn chở theo một danh tính bịa.
   */
  if (args === null || typeof args !== "object" || Array.isArray(args)) return {};
  // (1) XOÁ TRƯỚC — vô điều kiện. Đầu vào KHÔNG BAO GIỜ được là nguồn của danh tính.
  const { __authCtx: _tuDauVao, ...sach } = args as Record<string, unknown>;
  if (!execCtx) return sach;
  const shape = (tool.parameters as unknown as { shape?: Record<string, unknown> })?.shape;
  if (!shape) return sach;
  let ra: Record<string, unknown> = sach;
  /**
   * ★★★ Pha 5 Task 4 (N10) — **NGÔN NGỮ PHIÊN CŨNG PHẢI ĐI QUA ĐÂY, NẾU KHÔNG BẢN DỊCH LÀ MÃ CHẾT.**
   *
   * `ToolExecContext.lang` được `aiChatRouter.ts:243-247` tính từ **chữ viết của chính câu hỏi**
   * (`zh` nếu có Hán tự · `vi` nếu có dấu · ngược lại lấy `input.language`), và **write tool** đọc
   * nó qua `ctx.lang`. Nhưng **read tool** chỉ nhận `decision.args` — mà **không bộ phân loại ý định
   * nào đặt `lang`** (`git grep "lang" server/services/aiLocalTools/intentClassifier.ts` ⇒ rỗng).
   * ⇒ Trước dòng này, **29 read tool khai `lang: z.enum(["vi","en","zh"]).optional()` đều rơi về
   * `vi` VĨNH VIỄN** trên đường Agent: một người dùng hỏi bằng tiếng Trung nhận lại câu tiếng Việt,
   * và mọi bản dịch của các tool ấy là **mã chết**.
   *
   * ⚠ Cùng lớp lỗi với `__authCtx` (một sự thật của **phiên** không tới được tool), nên vá ở **cùng
   * một chỗ** — vá từng tool là 29 bản sao (xem lý lẽ "VÌ SAO SỬA Ở ĐÂY" phía trên).
   * ⚠ Khác `__authCtx` ở **một** điểm có chủ đích: ngôn ngữ **không phải một biên an ninh**, nên
   * một `lang` HỢP LỆ do người sản xuất args nêu ra (model có thể suy ra "trả lời tôi bằng tiếng
   * Anh") được **GIỮ**; `execCtx.lang` chỉ điền vào chỗ TRỐNG hoặc chỗ **không hợp lệ**. Với
   * `__authCtx` thì ngược lại — nó bị **XOÁ vô điều kiện** rồi gán lại, vì nó **là** biên an ninh.
   *
   * ⚠⚠ 🔴 C-1: điều kiện là `laOEnumNgonNguHienThi(shape.lang)` — **KHÔNG** phải `hasOwn(shape,
   * "lang")`. Xem khối lý lẽ ở vị từ ấy: một ô trùng tên có thể là **bộ lọc kho tài liệu**.
   */
  if (Object.hasOwn(shape, "lang") && laOEnumNgonNguHienThi(shape.lang)) {
    if (ra.lang !== "vi" && ra.lang !== "en" && ra.lang !== "zh") ra = { ...ra, lang: execCtx.lang };
  }
  if (!Object.hasOwn(shape, "__authCtx")) return ra;
  // (2) GÁN LẠI từ phiên THẬT — nguồn duy nhất.
  return { ...ra, __authCtx: { userId: execCtx.user.id, role: execCtx.user.role } };
}

const _registry = new Map<string, Tool<any, any>>();

export function registerTool<TParams, TData>(tool: Tool<TParams, TData>): void {
  _registry.set(tool.name, tool as Tool<any, any>);
}

export function getTool(name: string): Tool<any, any> | undefined {
  return _registry.get(name);
}

export function listTools(): Tool<any, any>[] {
  return Array.from(_registry.values());
}

export function clearRegistry(): void {
  _registry.clear();
}
