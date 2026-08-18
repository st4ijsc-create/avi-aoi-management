/**
 * Tiered Model Router (Phase A1) — "Cognitive Escalation Ladder" decision engine.
 *
 * Định tuyến mỗi yêu cầu AI tới TẦNG rẻ nhất đủ giải quyết nó (dễ→khó), rồi chọn
 * MODEL phù hợp tầng đó. Đây là lớp quyết định thuần (pure) — không tự suy luận;
 * call-site dùng `route()` để biết nên gọi model nào với tham số nào.
 *
 *   Tier 0 Reflex      — rule/heuristic/SQL, KHÔNG LLM
 *   Tier 1 Fast        — model nhỏ (GGUF_FAST_MODEL, vd Qwen2.5-3B) + GBNF JSON
 *   Tier 2 Deep        — model lớn (GGUF_DEFAULT_MODEL, Qwen2.5-7B) + RAG
 *   Tier 3 Perception  — vision sidecar (Qwen2.5-VL)
 *   Tier 4 Human/HITL  — hành động ghi / độ tin cậy thấp → con người duyệt
 *
 * An toàn quy mô hiện tại (CPU, chưa có 3B): khi GGUF_FAST_MODEL KHÔNG set, Tier 1
 * tự rơi về model mặc định (7B) → KHÔNG đổi hành vi, chỉ ghi nhận quyết định tầng.
 * Khi tải 3B + nâng GPU (A1bis): set GGUF_FAST_MODEL → Tier 1 kích hoạt thật.
 *
 * Tham khảo thiết kế: docs/ECOSYSTEM/03_AI_LOCAL_BRAIN_DESIGN_AND_UPGRADE_2026-06.md (§A4–A5).
 *
 * B6.2 — Thinking/reasoning tier (flag-gated, OFF by default; see doc 04 §A3/§B6). When BOTH
 * AI_THINKING_TIER_ENABLED is on AND GGUF_THINKING_MODEL points to a real GGUF file, the HARDEST
 * reasoning tasks (difficulty "hard" AND task ∈ {rca, report}) are routed to the Thinking model
 * (Qwen3-30B-A3B-Thinking) instead of the default Instruct deep model. Same size as the deep model
 * → cannot be hot simultaneously; the engine loads it on demand and LRU-evicts. When the flag is
 * off, the model is unset, or the file is missing → byte-identical to today (deep = GGUF_DEFAULT_MODEL).
 */

// Lightweight, side-effect-free import: only a fs existence check is used here. The engine's
// module top-level does NOT load any model, so importing it keeps route() pure/synchronous.
import { ggufModelFileExists } from "./aiGgufEngine";
// doc69 G2-5b — env→basename resolution now lives in ONE place (see modelResolver.ts's header
// for the full STEP 0 comparison / reconciliation notes). This import is equally side-effect-free
// (env reads only), so route() stays pure/synchronous.
import { resolveTaskModel } from "./ai/modelResolver";
// G5-B — trần `n_ctx` có MỘT nguồn sự thật (xem ai/ggufCtxCap.ts). Cũng chỉ đọc env ⇒ route() vẫn thuần.
import { ggufMaxCtx } from "./ai/ggufCtxCap";

export type TaskKind =
  | "chat"
  | "intent"
  | "extract"
  | "rca"
  | "report"
  | "vision"
  | "embed"
  // Doc 34 (P0) — Automation Programming Copilot tiers. `code` = deep-tier code chat/edit/gen;
  // `fim` = fast-tier fill-in-middle / inline autocomplete. Both are flag-gated (see route()).
  | "code"
  | "fim";

export type Difficulty = "trivial" | "easy" | "medium" | "hard";

export interface RouteInput {
  task: TaskKind;
  /** Prompt/user text — dùng cho heuristic độ khó. */
  text?: string;
  /** Có ảnh trong ngữ cảnh → ép tầng tri giác. */
  hasImage?: boolean;
  /** Là hành động GHI → ép Tier 4 (HITL). */
  isWrite?: boolean;
  /** Yêu cầu chất lượng tối thiểu — "high" kéo lên tầng sâu hơn. */
  requiredQuality?: "low" | "normal" | "high";
  /** Ngân sách độ trễ (ms) — nhỏ → ưu tiên model nhanh. */
  latencyBudgetMs?: number;
}

export interface RouteDecision {
  tier: 0 | 1 | 2 | 3 | 4;
  /** GGUF model filename/id để truyền cho engine; undefined = để engine dùng mặc định. */
  modelId?: string;
  /** true nếu cần con người duyệt (HITL) trước khi thực thi. */
  requiresHitl: boolean;
  maxTokens: number;
  temperature: number;
  /** Có nên ép JSON bằng GBNF grammar không (extract/intent có cấu trúc). */
  jsonMode: boolean;
  /**
   * B0.2 — Gợi ý kích thước KV-cache (n_ctx) theo tầng/độ khó. Tác vụ nhỏ (trivial/fast) dùng ctx
   * nhỏ để KHÔNG cấp phát KV-cache khổng lồ; tác vụ sâu/đọc nhiều SOP mới cần ctx lớn. Engine
   * (aiGgufEngine) tôn trọng giá trị này KHI NẠP model lần đầu, fallback GGUF_DEFAULT_CTX nếu undefined.
   * Lưu ý: nếu model đã nóng sẵn, context được dùng chung — hint chỉ có hiệu lực ở lần nạp đầu.
   */
  contextSize?: number;
  /**
   * B6.2 — true when the decision routed to the Thinking model (GGUF_THINKING_MODEL). The caller
   * MUST pass the model output through aiGgufEngine.stripThinking() so raw `<think>…</think>`
   * reasoning never leaks into user-facing text. false/absent → ordinary model, no stripping needed.
   */
  thinking?: boolean;
  reason: string;
}

// ─── Model resolution from env ─────────────────────────────────
// QUAN TRỌNG: aiGgufEngine.getOrLoadModel TỰ nối ".gguf" vào modelId được truyền, và
// `undefined` = để engine dùng GGUF_DEFAULT_MODEL (xử lý đúng cả split-file). Vì vậy
// router CHỈ trả về basename (không .gguf) cho FAST model, hoặc `undefined` cho mặc định.
//
// doc69 G2-5b — the actual env-read + ".gguf" normalization now lives in ONE place
// (`./ai/modelResolver.ts`; this logic used to be duplicated here, in aiGgufEngine.ts, and in
// openaiGateway.ts — see that file's header for the full STEP 0 comparison). These stay as thin
// delegating wrappers so route() below is otherwise unchanged.

/** Basename của fast model (GGUF_FAST_MODEL) nếu được cấu hình; undefined nếu chưa set. */
function fastModelId(): string | undefined {
  return resolveTaskModel("fast");
}

/**
 * Basename của model mặc định (GGUF_DEFAULT_MODEL, 7B). PHẢI trả về tường minh thay vì
 * `undefined`: engine.getOrLoadModel(undefined) tái dùng model nào ĐANG nạp (có thể là 3B),
 * nên muốn ép đúng 7B cho tầng sâu thì phải truyền basename 7B.
 */
function defaultModelId(): string | undefined {
  return resolveTaskModel("default");
}

// ─── B6.2 — Thinking / reasoning tier resolution ───────────────
/** Master switch (opt-in). Default OFF so even with a model set, the tier stays inert. */
function thinkingTierEnabled(): boolean {
  const v = (process.env.AI_THINKING_TIER_ENABLED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Basename of the Thinking model (GGUF_THINKING_MODEL) if configured; undefined if unset. */
function thinkingModelId(): string | undefined {
  return resolveTaskModel("thinking");
}

/**
 * doc69 G2-6 — Thinking-tier HONESTY. Before this, `AI_THINKING_TIER_ENABLED=true` with
 * `GGUF_THINKING_MODEL` unset fell back to the deep model SILENTLY (deepModelFor's old
 * `if (!tid) return fallback;` early-return never warned) — an operator could believe the
 * tier was live when it was inert. This is the single, pure ("no I/O beyond an fs.existsSync
 * via ggufModelFileExists, no logging") status snapshot both the router's own one-time warning
 * AND external health surfaces (aiGgufEngine.getEngineHealth, startup reporting) read from —
 * one source of truth instead of duplicated flag-checking logic.
 */
export interface ThinkingTierStatus {
  /** Master switch (AI_THINKING_TIER_ENABLED). */
  enabled: boolean;
  /** GGUF_THINKING_MODEL resolves to a non-empty basename. */
  modelConfigured: boolean;
  /** The configured model's .gguf file exists under GGUF_MODELS_DIR/uploads. */
  fileExists: boolean;
  /** True only when enabled + configured + file present — i.e. hard rca/report CAN escalate. */
  active: boolean;
  /** Human-readable one-line summary safe to log or surface in a health payload. */
  reason: string;
}

/** Pure status snapshot — reads env + fs.existsSync only; never logs, never throws. */
export function getThinkingTierStatus(): ThinkingTierStatus {
  const enabled = thinkingTierEnabled();
  if (!enabled) {
    return {
      enabled,
      modelConfigured: false,
      fileExists: false,
      active: false,
      reason: "disabled (AI_THINKING_TIER_ENABLED is off) — hard rca/report use the default deep model",
    };
  }
  const tid = thinkingModelId();
  if (!tid) {
    return {
      enabled,
      modelConfigured: false,
      fileExists: false,
      active: false,
      reason: "AI_THINKING_TIER_ENABLED is on but GGUF_THINKING_MODEL is unset — inactive, falling back to the default deep model",
    };
  }
  const fileExists = ggufModelFileExists(tid);
  if (!fileExists) {
    return {
      enabled,
      modelConfigured: true,
      fileExists: false,
      active: false,
      reason: `AI_THINKING_TIER_ENABLED is on and GGUF_THINKING_MODEL="${tid}" is set but its .gguf file was not found under GGUF_MODELS_DIR — inactive, falling back to the default deep model`,
    };
  }
  return {
    enabled,
    modelConfigured: true,
    fileExists: true,
    active: true,
    reason: `active — hard rca/report route to GGUF_THINKING_MODEL="${tid}"`,
  };
}

// Log a distinct "inactive" reason at most once per process (route()-time warning — fires only
// when a hard rca/report request actually hits deepModelFor(), see below).
const warnedThinkingReasons = new Set<string>();
function warnThinkingInactive(reason: string): void {
  if (warnedThinkingReasons.has(reason)) return;
  warnedThinkingReasons.add(reason);
  console.warn(
    `[aiModelRouter] Thinking tier misconfigured: ${reason}. Download the Thinking GGUF or unset ` +
      `AI_THINKING_TIER_ENABLED. See docs/ECOSYSTEM/PHASE_B_AI_BRAIN_RUNBOOK.md.`,
  );
}

// Startup-time warning (see reportThinkingTierStatus): independent of any route() call, so an
// operator sees the drift immediately at boot rather than only after the first hard rca/report
// request. Fires at most once per process.
let thinkingStartupWarned = false;

/**
 * Call once at server startup (see `_core/index.ts`, alongside `reportAiModelAvailability`).
 * Logs ONE clear warning if the flag is on but the tier is inactive; silent when the tier is
 * either off (default) or genuinely active. Returns the status so callers can also feed it into
 * a health payload / db_feature_status row without a second computation. Never throws.
 */
export function reportThinkingTierStatus(): ThinkingTierStatus {
  const status = getThinkingTierStatus();
  if (status.enabled && !status.active && !thinkingStartupWarned) {
    thinkingStartupWarned = true;
    console.warn(`[aiModelRouter] Thinking tier INACTIVE at startup: ${status.reason}.`);
  }
  return status;
}

/**
 * Which tasks may escalate to the Thinking model. Conservative: ONLY deep RCA/report — these
 * are the long-chain reasoning jobs the Thinking variant helps most, and they tolerate the extra
 * latency + cold-load + token budget. "planning"-style requests surface as rca/report here
 * (the router has no separate "planning" TaskKind; isWrite drafts go through Tier 4 with the deep
 * model and stay there, NOT the thinking model, to keep HITL latency predictable).
 */
const THINKING_TASKS: ReadonlySet<TaskKind> = new Set<TaskKind>(["rca", "report"]);

/**
 * Resolve the deep-tier model for a HARD task. Returns the Thinking model basename ONLY when
 * ALL of: master flag on · GGUF_THINKING_MODEL set · the file exists on disk · task qualifies.
 * Otherwise returns the default deep model (byte-identical to legacy behaviour). Fail-safe: any
 * inactive reason (flag off, model unset, file missing) logs ONCE (via getThinkingTierStatus +
 * warnThinkingInactive — doc69 G2-6 honesty fix, see above) and falls back — it NEVER throws and
 * NEVER routes to a model that cannot be loaded.
 */
function deepModelFor(task: TaskKind, difficulty: Difficulty): { id: string | undefined; thinking: boolean } {
  const fallback = { id: defaultModelId(), thinking: false };
  if (difficulty !== "hard") return fallback;
  if (!THINKING_TASKS.has(task)) return fallback;
  const status = getThinkingTierStatus();
  if (!status.enabled) return fallback;
  if (!status.active) {
    warnThinkingInactive(status.reason);
    return fallback;
  }
  return { id: thinkingModelId(), thinking: true };
}

// ─── Doc 34 (P0) — Code / FIM tier resolution ──────────────────
/**
 * Master switch for the Automation Programming Copilot's code/FIM tiers. Default OFF: `code`/`fim`
 * route BYTE-IDENTICALLY to the existing deep/fast tiers (same tier + same model) and the new
 * GGUF_CODE_MODEL/GGUF_FIM_MODEL envs are IGNORED — so turning this off is a guaranteed no-op.
 * ON: `code` → the code model (deep-tier semantics, large RAG-friendly ctx) and `fim` → the fim
 * model (fast-tier semantics, small ctx / low latency for inline completion).
 *
 * Exported (final-fix round, C-1) — `server/services/programming/aiProgrammingCopilot.ts`'s
 * `completeInline()` needs to know the flag state BEFORE trusting `route()`'s modelId for the
 * "fim" task: route()'s OFF branch deliberately ignores GGUF_FIM_MODEL (ONE tier below, `fim →
 * Tier 1 fast`), so a caller that needs the DEDICATED fim model regardless of this flag must
 * check it directly rather than assume route()'s result is authoritative for that purpose. Kept
 * as the SAME predicate (just exported) so there is still exactly one place that parses the env
 * var — no duplicated true/false/yes/on parsing anywhere else.
 */
export function codeRouterEnabled(): boolean {
  const v = (process.env.AI_CODE_ROUTER_ENABLED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Basename of the CODE model. Reads GGUF_CODE_MODEL; when unset, falls back to GGUF_DEFAULT_MODEL
 * (decision D2 §VI-bis: reuse the resident 30B-A3B-Instruct rather than downloading a separate
 * coder model). Like defaultModelId() it returns an EXPLICIT basename (never undefined for a
 * configured system) so the engine pins the intended model instead of reusing whatever is hot.
 */
function codeModelId(): string | undefined {
  return resolveTaskModel("code");
}

/**
 * Basename of the FIM (fill-in-middle / inline-completion) model. Reads GGUF_FIM_MODEL; when unset,
 * falls back to the fast model, then the default — mirroring the Tier-1 `fastModelId() ??
 * defaultModelId()` chain so autocomplete degrades gracefully and NEVER routes undefined.
 */
function fimModelId(): string | undefined {
  return resolveTaskModel("fim");
}

/**
 * Requested context size for the ON `code` tier: the operator's configured ceiling.
 *
 * ★ G5-B (2026-08-16) — TRẦN TỪNG BỊ CHẶN HAI LẦN. Bản cũ đọc lại `GGUF_MAX_CTX` rồi kẹp thêm
 * `Math.min(max, 32768)` bằng một hằng viết cứng. Vì `aiGgufEngine` ĐÃ có trần riêng cùng tên,
 * hằng ở đây chỉ làm đúng một việc: **vô hiệu hoá mọi lượt nâng trần trong `.env`** — nâng lên
 * 65536/131072/262144 đều bị cắt về 32768 mà không log gì. Với model ctx native 262k sắp lên
 * sản xuất, đó là "cờ khai mà vô hiệu" ở đúng chỗ tốn kém nhất.
 *
 * Nay: MỘT nguồn — `ggufMaxCtx()` (mặc định vẫn 32768, không tự nâng). Engine kẹp lần cuối vào
 * `[GGUF_MIN_CTX, ggufMaxCtx()]` khi nạp, cùng nguồn, nên xin đúng trần của người vận hành là an
 * toàn và **có tác dụng thật**.
 */
function codeContextSize(): number {
  return ggufMaxCtx();
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★ G5-B (2026-08-16) — HỒ SƠ ĐẶC TÍNH MODEL: NGƯỠNG ĐỊNH TUYẾN RÚT TỪ ĐÂU, ĐO NGÀY NÀO
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Ba ngưỡng của bộ định tuyến — `easyMaxChars`, `hardMinChars`, `latencyPinMs` — KHÔNG phải hằng
 * số phổ quát. Chúng được rút ra từ MỘT phép đo trên MỘT roster: Qwen3-30B-A3B (MoE, 3B active,
 * cold-load 6,04 s, 192,5 tok/s) + Qwen3-4B (cold-load 1,22 s, 234,9 tok/s), đo 2026-08-02 trên
 * RTX 5090. Trước bản vá này chúng nằm trần trong biểu thức, kèm một câu chú thích — đổi roster
 * sang model **dense 27B** (đặc tính khác hẳn: decode ~78 tok/s, KV 64 KiB/token thay vì 96) thì
 * các số ấy **vẫn chạy, vẫn xanh, và không còn đúng**. Không có gì đỏ, không có gì kêu.
 *
 * Bản vá KHÔNG đổi thuật toán định tuyến. Nó làm ba việc, đúng ba việc:
 *   1. đưa mọi số phụ thuộc đặc tính model vào MỘT bảng khai báo, kèm **nguồn + ngày đo**;
 *   2. cho phép khai đè bằng env (`AI_ROUTER_*`) để người đo lại ngưỡng không phải sửa mã;
 *   3. **KÊU** khi đang chạy một model mà ta CHƯA đo — thay vì im lặng dùng số của model khác.
 *
 * ⚠ Cố ý KHÔNG bịa ngưỡng mới cho model dense. Chưa ai đo cold-load của nó trên máy này; một con
 * số phát minh ở đây sẽ có **hình dạng đúng bằng một kết luận thật** mà không phải kết luận nào.
 * Hồ sơ dense thừa kế ngưỡng MoE **và khai rõ là thừa kế** cho tới khi có phép đo tại chỗ.
 */
export type ProfileProvenance = "measured-here" | "third-party" | "none";

export interface RouterModelProfile {
  label: string;
  /** Vị từ nhận diện: khớp basename của GGUF_DEFAULT_MODEL. */
  matches: RegExp;
  /** Basename mẫu — dùng cho lưới kiểm chồng lấn giữa các hồ sơ. */
  sampleBasename: string;
  /** Nguồn + NGÀY của phép đo mà các số dưới đây rút ra. */
  measuredOn: string;
  provenance: ProfileProvenance;
  /** `null` = CHƯA ĐO (không được điền số bịa vào đây). */
  deepColdLoadMs: number | null;
  deepDecodeTokPerSec: number | null;
  fastColdLoadMs: number | null;
  fastDecodeTokPerSec: number | null;
  /** ─ Ngưỡng RÚT RA ─ */
  latencyPinMs: number;
  easyMaxChars: number;
  hardMinChars: number;
  /** Khai rõ khi ngưỡng KHÔNG rút từ phép đo của chính model này. */
  thresholdsInheritedFrom: string | null;
  note: string;
}

/** Ngưỡng gốc — đo tại chỗ 2026-08-02 (B0/TASK B, RTX 5090). Mọi hồ sơ thừa kế đều trỏ về đây. */
const MOE_THRESHOLDS = { latencyPinMs: 700, easyMaxChars: 160, hardMinChars: 700 } as const;

export const ROUTER_MODEL_PROFILES: readonly RouterModelProfile[] = [
  {
    label: "Qwen3-30B-A3B (MoE, 3B active) + Qwen3-4B",
    matches: /30b[-_. ]?a3b/i,
    sampleBasename: "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL",
    measuredOn: "2026-08-02 · B0/TASK B · RTX 5090 · đo TẠI CHỖ",
    provenance: "measured-here",
    deepColdLoadMs: 6040,
    deepDecodeTokPerSec: 192.5,
    fastColdLoadMs: 1220,
    fastDecodeTokPerSec: 234.9,
    ...MOE_THRESHOLDS,
    thresholdsInheritedFrom: null,
    note:
      "easyMaxChars/hardMinChars ưu tiên 4B cho câu ngắn; latencyPinMs 700 chọn BẢO THỦ (nhỏ hơn " +
      "nhiều so với cold-load 6,04 s) để chỉ ghim Tier 1 khi ngân sách thực sự chật.",
  },
  {
    label: "Qwen3.x-27B dense (qwen35)",
    matches: /qwen3[.\-_0-9]*27b/i,
    sampleBasename: "Qwen3.8-27B-Instruct-Q4_K_M",
    measuredOn:
      "2026-08-16 · witcheer @ RTX 5090, llama-bench Q4_K_M (doc 77 §4.2) — ĐO CỦA NGƯỜI KHÁC, " +
      "KHÔNG phải phép đo trên máy này",
    provenance: "third-party",
    deepColdLoadMs: null, // CHƯA ĐO trên máy này — không điền số bịa.
    deepDecodeTokPerSec: 78,
    fastColdLoadMs: null,
    fastDecodeTokPerSec: null, // roster gộp: fast = default = cùng model dense.
    ...MOE_THRESHOLDS,
    thresholdsInheritedFrom: "Qwen3-30B-A3B (MoE)",
    note:
      "Ngưỡng đang THỪA KẾ từ hồ sơ MoE vì chưa đo cold-load/decode tại chỗ. Đo xong thì khai bằng " +
      "AI_ROUTER_LATENCY_PIN_MS / AI_ROUTER_EASY_MAX_CHARS / AI_ROUTER_HARD_MIN_CHARS, hoặc thêm " +
      "số đo vào chính hồ sơ này.",
  },
];

/** Hồ sơ cho model KHÔNG khớp mục nào — mặc định phải là "chưa đo", không phải "coi như MoE". */
const UNKNOWN_PROFILE: RouterModelProfile = {
  label: "model chưa có hồ sơ",
  matches: /$^/,
  sampleBasename: "",
  measuredOn: "chưa đo",
  provenance: "none",
  deepColdLoadMs: null,
  deepDecodeTokPerSec: null,
  fastColdLoadMs: null,
  fastDecodeTokPerSec: null,
  ...MOE_THRESHOLDS,
  thresholdsInheritedFrom: "Qwen3-30B-A3B (MoE)",
  note: "Không khớp hồ sơ nào trong ROUTER_MODEL_PROFILES — đang chạy bằng ngưỡng của roster cũ.",
};

const routerProfileWarned = new Set<string>();
function warnRouterProfile(msg: string): void {
  if (routerProfileWarned.has(msg)) return;
  routerProfileWarned.add(msg);
  console.warn(`[aiModelRouter] ${msg}`);
}

/** Đọc một số dương từ env; rác ⇒ undefined + kêu MỘT lần (không lặng lẽ thành 0/NaN). */
function envPositiveInt(name: string): number | undefined {
  const raw = (process.env[name] || "").trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    warnRouterProfile(`${name}="${raw}" không phải số dương — BỎ QUA, dùng giá trị của hồ sơ model.`);
    return undefined;
  }
  return Math.floor(n);
}

export interface ActiveRouterProfile extends RouterModelProfile {
  /** Basename model sâu đang cấu hình (GGUF_DEFAULT_MODEL). */
  deepModel: string;
  /** Tên các biến env đã khai đè ngưỡng. */
  overriddenBy: string[];
  /**
   * true khi ngưỡng đang dùng KHÔNG rút từ phép đo của chính model đang chạy **và** người vận hành
   * cũng chưa khai đè bằng env. Đây là điều kiện phải KÊU.
   */
  needsLocalMeasurement: boolean;
}

/**
 * Hồ sơ đang hiệu lực = (hồ sơ khớp GGUF_DEFAULT_MODEL, hoặc UNKNOWN) ⊕ khai đè từ env.
 * Thuần: chỉ đọc env, không I/O, không log (trừ cảnh báo env rác — một lần/đời tiến trình).
 */
export function activeRouterProfile(): ActiveRouterProfile {
  const deepModel = defaultModelId() || "";
  const base = ROUTER_MODEL_PROFILES.find((p) => p.matches.test(deepModel)) ?? UNKNOWN_PROFILE;

  const latencyPinMs = envPositiveInt("AI_ROUTER_LATENCY_PIN_MS");
  const easyMaxChars = envPositiveInt("AI_ROUTER_EASY_MAX_CHARS");
  const hardMinChars = envPositiveInt("AI_ROUTER_HARD_MIN_CHARS");
  const overriddenBy = [
    latencyPinMs !== undefined ? "AI_ROUTER_LATENCY_PIN_MS" : "",
    easyMaxChars !== undefined ? "AI_ROUTER_EASY_MAX_CHARS" : "",
    hardMinChars !== undefined ? "AI_ROUTER_HARD_MIN_CHARS" : "",
  ].filter(Boolean);

  return {
    ...base,
    deepModel,
    overriddenBy,
    latencyPinMs: latencyPinMs ?? base.latencyPinMs,
    easyMaxChars: easyMaxChars ?? base.easyMaxChars,
    hardMinChars: hardMinChars ?? base.hardMinChars,
    // Khai đè ĐỦ CẢ BA ⇒ coi như đã đo và khai; thiếu một cái thì vẫn còn số thừa kế đang lái.
    needsLocalMeasurement: base.provenance !== "measured-here" && overriddenBy.length < 3,
  };
}

/**
 * Hồ sơ dùng cho MỘT quyết định định tuyến, kèm lượt kêu (một lần/đời tiến trình) khi đang chạy
 * model chưa có phép đo tại chỗ. Kêu từ chính đường `route()` nên không cần ai nhớ gắn vào boot.
 */
function profileForDecision(): ActiveRouterProfile {
  const p = activeRouterProfile();
  if (p.needsLocalMeasurement) {
    warnRouterProfile(
      `ngưỡng định tuyến đang dùng KHÔNG rút từ phép đo của model đang chạy. ` +
        `Model: "${p.deepModel || "(chưa gán)"}" → hồ sơ "${p.label}" (${p.measuredOn}). ` +
        `Ngưỡng easy≤${p.easyMaxChars} / hard>${p.hardMinChars} / ghim<${p.latencyPinMs}ms thừa kế từ ` +
        `"${p.thresholdsInheritedFrom ?? "?"}". Đo lại rồi khai bằng AI_ROUTER_LATENCY_PIN_MS / ` +
        `AI_ROUTER_EASY_MAX_CHARS / AI_ROUTER_HARD_MIN_CHARS (cả ba), hoặc bổ sung số đo vào ` +
        `ROUTER_MODEL_PROFILES.`,
    );
  }
  return p;
}

// ─── Difficulty classifier (Tier-0, heuristic, no LLM) ─────────
// ★ 2026-08-16 — ĐO trên cả 18 nhánh: ĐÚNG MỘT nhánh chết với `\b` là `sau đó`, vì nó KẾT THÚC
// bằng `ó` (JS coi ký tự từ là [A-Za-z0-9_], nên `ó` cạnh khoảng trắng không tạo biên phải).
// 17 nhánh còn lại đều bắt đầu VÀ kết thúc bằng ký tự ASCII nên vẫn khớp bình thường —
// kể cả `phân tích`, `nguyên nhân`, `dự báo`, `tối ưu` (dấu nằm GIỮA, không ở mép).
// Hậu quả đo được: "chạy A sau đó chạy B" → false, "and then" → true ⇒ câu NHIỀU BƯỚC tiếng Việt
// bị chấm nhẹ độ khó và định tuyến sang model yếu hơn mức cần.
// Dùng biên Unicode cho cả hai mép (cờ `u`). Cùng lớp lỗi đã vá ở intentClassifier.ts (25 nhánh).
const MULTISTEP_HINTS = /(?<![\p{L}\p{N}_])(and then|sau đó|từng bước|step by step|compare|so sánh|analy[sz]e|phân tích|root cause|nguyên nhân|why|tại sao|forecast|dự báo|optimi|tối ưu|plan|kế hoạch)(?![\p{L}\p{N}_])/iu;

/**
 * Ước lượng độ khó thuần heuristic (nhanh, không gọi model). Có thể nâng cấp sau
 * bằng một lần phân loại LLM-3B khi mơ hồ (chưa cần ở quy mô hiện tại).
 */
export function classifyDifficulty(input: RouteInput): Difficulty {
  if (input.isWrite) return "hard"; // hành động ghi luôn cần cẩn trọng + HITL
  if (input.hasImage) return "medium"; // tri giác tối thiểu là medium

  // Task có bản chất suy luận sâu.
  if (input.task === "rca" || input.task === "report") {
    return input.requiredQuality === "low" ? "medium" : "hard";
  }
  if (input.task === "embed") return "trivial";

  const text = (input.text || "").trim();
  const len = text.length;
  const multistep = MULTISTEP_HINTS.test(text);

  if (input.requiredQuality === "high") return multistep ? "hard" : "medium";

  if (input.task === "intent" || input.task === "extract") {
    // Phân loại / trích xuất: thường dễ; chỉ "khó hơn" (medium) khi văn bản dài & nhiều bước.
    // Không bao giờ lên "hard" — đây là tác vụ phân loại, không suy luận sâu.
    return len > 800 || multistep ? "medium" : "easy";
  }

  // chat & mặc định — ngưỡng PHỤ THUỘC ĐẶC TÍNH MODEL, nay lấy từ hồ sơ đang hiệu lực thay vì
  // số trần (xem ROUTER_MODEL_PROFILES ở trên: nguồn + ngày đo + đường khai đè bằng env).
  //   easy   : len < easyMaxChars & không đa bước
  //   medium : easyMaxChars ≤ len ≤ hardMinChars
  //   hard   : len > hardMinChars HOẶC đa bước  [rca/report/write đã là hard ở nhánh trên]
  const { easyMaxChars, hardMinChars } = profileForDecision();
  if (len < easyMaxChars && !multistep) return "easy";
  if (len > hardMinChars || multistep) return "hard";
  return "medium";
}

// ─── Routing decision ──────────────────────────────────────────
/**
 * Quyết định tầng + model cho một yêu cầu. Pure — không I/O, không gọi model.
 * Call-site dùng kết quả để gọi đúng đường (engine GGUF / vision sidecar / HITL).
 */
export function route(input: RouteInput): RouteDecision {
  // Embedding luôn là Tier 0/1 với model embed riêng (engine tự chọn GGUF_EMBED_MODEL).
  // Không truyền contextSize: engine tự chốt bằng EMBED_CTX (aiGgufEngine.ts:288 → :2831,
  // = clamp(GGUF_EMBED_CTX, GGUF_MAX_CTX), mặc định 2048).
  // ⚠ Câu cũ ở đây ghi 'embedding context tự dùng "auto"' — SAI, và sai theo hướng nguy hiểm:
  // `contextSize:"auto"` của node-llama-cpp co giãn theo VRAM CÒN TRỐNG (đo Pha 2A Task 5: cùng
  // model 0,6B, "auto" chiếm 3.916 MiB so với 526 MiB khi chốt bằng EMBED_CTX — gấp 7,4 lần).
  // Ai đọc chú thích cũ rồi đi thiết kế hạn mức VRAM sẽ tính nhầm đúng bảy lần.
  if (input.task === "embed") {
    return decide(1, undefined, false, 0, 0, false, "embed → embedding model (engine default)");
  }

  // Tri giác: có ảnh → Tier 3 vision sidecar (engine định tuyến qua GGUF_VISION_MODEL).
  // Vision dùng tiến trình sidecar riêng (LLAMA_VISION_CTX) — KHÔNG đặt contextSize ở đây.
  if (input.task === "vision" || input.hasImage) {
    return decide(3, undefined, false, 512, 0.2, false, "has image → Tier 3 vision sidecar");
  }

  // Doc 34 (P0) — first-class `code` and `fim` tiers for the Automation Programming Copilot.
  // Flag-gated by AI_CODE_ROUTER_ENABLED (default OFF). When OFF, both route BYTE-IDENTICALLY to
  // the existing deep/fast tiers (same tier + same model) and GGUF_CODE_MODEL/GGUF_FIM_MODEL are
  // ignored — a guaranteed no-op. When ON, `code` → the code model (Tier 2, deep-tier semantics,
  // large RAG-friendly ctx) and `fim` → the fim model (Tier 1, fast-tier semantics, small ctx /
  // low latency for inline completion). The resolvers NEVER return undefined for a configured
  // system (code→GGUF_DEFAULT_MODEL, fim→GGUF_FAST_MODEL→GGUF_DEFAULT_MODEL), so we never reuse
  // whatever model happens to be hot — mirroring the deep/thinking-tier explicit-basename bugfix.
  // (Placed after the image check so a code/fim request carrying an image still hits vision.)
  if (input.task === "code") {
    return codeRouterEnabled()
      ? decide(2, codeModelId(), false, 1536, 0.3, false,
          "code → Tier 2 code model (AI_CODE_ROUTER_ENABLED on; RAG-friendly large ctx)", codeContextSize())
      : decide(2, defaultModelId(), false, 1536, 0.3, false,
          "code → Tier 2 deep (code router off → byte-identical to deep tier, GGUF_DEFAULT_MODEL)", 8192);
  }
  if (input.task === "fim") {
    return codeRouterEnabled()
      ? decide(1, fimModelId(), false, 256, 0.15, false,
          "fim → Tier 1 fim model (AI_CODE_ROUTER_ENABLED on; inline completion, small ctx/low latency)", 4096)
      : decide(1, fastModelId() ?? defaultModelId(), false, 512, 0.4, false,
          "fim → Tier 1 fast (code router off → byte-identical to fast tier)", 2048);
  }

  const difficulty = classifyDifficulty(input);
  const wantJson = input.task === "extract" || input.task === "intent";

  // Hành động ghi → Tier 4: cần HITL. Model dùng tầng sâu (7B tường minh) để soạn đề xuất.
  if (input.isWrite) {
    return decide(4, defaultModelId(), true, 768, 0.2, wantJson, "write action → Tier 4 HITL (deep model drafts proposal)", 4096);
  }

  // Tier 1 dùng fast model nếu có, không thì ép 7B tường minh (KHÔNG undefined — tránh
  // tái dùng nhầm model đang nạp). Tier 2 luôn ép 7B.
  // B0.2 — contextSize (n_ctx) theo tầng: nhỏ cho trivial/easy (KV-cache gọn), lớn dần cho
  // medium/hard (cần ngữ cảnh RAG/SOP). Hint chỉ áp dụng ở lần nạp model đầu (xem RouteDecision).
  const tier1Model = fastModelId() ?? defaultModelId();

  // TASK B — Latency-budget rule: cold-load của model sâu phá vỡ ngân sách chật. Ngân sách <
  // `latencyPinMs` VÀ độ khó ≤ medium → ghim Tier 1. "hard" (và no-budget) vẫn dùng deep tier.
  // ★ G5-B: `latencyPinMs` KHÔNG còn là số trần — nó đến từ hồ sơ đặc tính model (nguồn + ngày đo
  // ở ROUTER_MODEL_PROFILES), khai đè được bằng AI_ROUTER_LATENCY_PIN_MS. Đổi roster mà chưa đo
  // lại ⇒ hồ sơ tự KÊU một lần thay vì im lặng dùng số của model cũ.
  const profile = profileForDecision();
  if (
    typeof input.latencyBudgetMs === "number" &&
    input.latencyBudgetMs < profile.latencyPinMs &&
    (difficulty === "trivial" || difficulty === "easy" || difficulty === "medium")
  ) {
    const ctx = difficulty === "medium" ? 4096 : difficulty === "easy" ? 2048 : 1024;
    return decide(1, tier1Model, false, difficulty === "medium" ? 1024 : 512, 0.3, wantJson,
      `latency budget ${input.latencyBudgetMs}ms < ${profile.latencyPinMs}ms (hồ sơ "${profile.label}") & difficulty ${difficulty} → pin Tier 1 fast (tránh cold-load model sâu)`, ctx);
  }

  switch (difficulty) {
    case "trivial":
      return decide(1, tier1Model, false, 256, 0.2, wantJson, "trivial → Tier 1 fast", 1024);
    case "easy":
      return decide(1, tier1Model, false, 512, 0.4, wantJson, "easy → Tier 1 fast model", 2048);
    case "medium":
      return decide(2, defaultModelId(), false, 1024, 0.5, wantJson, "medium → Tier 2 reasoning (7B)", 4096);
    case "hard":
    default: {
      // B6.2 — hardest reasoning may escalate to the Thinking model (rca/report only, flag-gated,
      // file-checked). When it does, give it a larger token budget (reasoning + answer) since the
      // `<think>` block consumes tokens before the final answer; the caller strips it afterwards.
      const deep = deepModelFor(input.task, difficulty);
      if (deep.thinking) {
        return decide(2, deep.id, false, 4096, 0.6, wantJson,
          `hard ${input.task} → Tier 2 Thinking model (GGUF_THINKING_MODEL); strip <think> before display`,
          8192, true);
      }
      return decide(2, deep.id, false, 1536, 0.3, wantJson, "hard → Tier 2 reasoning (7B) + RAG/retry", 8192);
    }
  }
}

function decide(
  tier: RouteDecision["tier"],
  modelId: string | undefined,
  requiresHitl: boolean,
  maxTokens: number,
  temperature: number,
  jsonMode: boolean,
  reason: string,
  contextSize?: number,
  thinking?: boolean,
): RouteDecision {
  const d: RouteDecision = { tier, modelId, requiresHitl, maxTokens, temperature, jsonMode, contextSize, thinking, reason };
  recordDecision(d);
  return d;
}

// ─── Telemetry (in-memory, lightweight) ────────────────────────
interface RouterStats {
  total: number;
  byTier: Record<number, number>;
  fastModelConfigured: boolean;
}
const stats: RouterStats = { total: 0, byTier: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }, fastModelConfigured: false };

function recordDecision(d: RouteDecision): void {
  stats.total++;
  stats.byTier[d.tier] = (stats.byTier[d.tier] ?? 0) + 1;
  stats.fastModelConfigured = !!fastModelId();
}

/** Thống kê phân bố tầng (cho dashboard "AI Brain" / metrics). */
export function getRouterStats(): RouterStats {
  return { total: stats.total, byTier: { ...stats.byTier }, fastModelConfigured: !!fastModelId() };
}
