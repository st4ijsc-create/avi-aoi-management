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
 * Requested context size for the ON `code` tier: up to GGUF_MAX_CTX but capped at a sane 32K
 * default (doc 34 §5.1: default 32K, open 128K only for large repo/manual reads). The engine
 * clamps this into [256, GGUF_MAX_CTX] on first load, so requesting the operator's max is safe.
 */
function codeContextSize(): number {
  const n = parseInt(process.env.GGUF_MAX_CTX || "32768", 10);
  const max = Number.isFinite(n) && n > 0 ? n : 32768;
  return Math.min(max, 32768);
}

// ─── Difficulty classifier (Tier-0, heuristic, no LLM) ─────────
const MULTISTEP_HINTS = /\b(and then|sau đó|từng bước|step by step|compare|so sánh|analy[sz]e|phân tích|root cause|nguyên nhân|why|tại sao|forecast|dự báo|optimi|tối ưu|plan|kế hoạch)\b/i;

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

  // chat & mặc định — ngưỡng đã tinh chỉnh theo benchmark RTX 5090 (B0/TASK B):
  // 4B=234.9 tok/s (load 1.22s) vs 30B-A3B=192.5 tok/s (load 6.04s) → ưu tiên 4B cho tác vụ ngắn,
  // chỉ trả về "hard" (→30B) khi thực sự dài/đa bước để bù chi phí cold-load ~6s.
  //   easy   : len < 160 (nâng từ 120) & không đa bước
  //   medium : 160 ≤ len ≤ 700
  //   hard   : len > 700 HOẶC đa bước (multistep)  [rca/report/write đã là hard ở nhánh trên]
  if (len < 160 && !multistep) return "easy";
  if (len > 700 || multistep) return "hard";
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

  // TASK B — Latency-budget rule (benchmark RTX 5090): 30B-A3B cold-load ~6.04s sẽ phá vỡ ngân sách
  // dưới 700ms. Nếu ngân sách < 700ms VÀ độ khó ≤ medium → ghim Tier 1 (4B, load 1.22s, 234.9 tok/s).
  // "hard" (và no-budget) vẫn dùng deep tier (30B). 4B+30B+embed đồng trú (GGUF_MAX_LOADED_MODELS=4).
  if (
    typeof input.latencyBudgetMs === "number" &&
    input.latencyBudgetMs < 700 &&
    (difficulty === "trivial" || difficulty === "easy" || difficulty === "medium")
  ) {
    const ctx = difficulty === "medium" ? 4096 : difficulty === "easy" ? 2048 : 1024;
    return decide(1, tier1Model, false, difficulty === "medium" ? 1024 : 512, 0.3, wantJson,
      `latency budget ${input.latencyBudgetMs}ms < 700ms & difficulty ${difficulty} → pin Tier 1 fast (4B, avoid 30B cold-load)`, ctx);
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
