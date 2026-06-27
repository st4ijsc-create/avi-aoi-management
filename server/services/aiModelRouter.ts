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

export type TaskKind =
  | "chat"
  | "intent"
  | "extract"
  | "rca"
  | "report"
  | "vision"
  | "embed";

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
function stripGguf(s: string): string {
  return s.replace(/\.gguf$/i, "");
}

/** Basename của fast model (GGUF_FAST_MODEL) nếu được cấu hình; undefined nếu chưa set. */
function fastModelId(): string | undefined {
  const v = (process.env.GGUF_FAST_MODEL || "").trim();
  return v.length ? stripGguf(v) : undefined;
}

/**
 * Basename của model mặc định (GGUF_DEFAULT_MODEL, 7B). PHẢI trả về tường minh thay vì
 * `undefined`: engine.getOrLoadModel(undefined) tái dùng model nào ĐANG nạp (có thể là 3B),
 * nên muốn ép đúng 7B cho tầng sâu thì phải truyền basename 7B.
 */
function defaultModelId(): string | undefined {
  const v = (process.env.GGUF_DEFAULT_MODEL || "").trim();
  return v.length ? stripGguf(v) : undefined;
}

// ─── B6.2 — Thinking / reasoning tier resolution ───────────────
/** Master switch (opt-in). Default OFF so even with a model set, the tier stays inert. */
function thinkingTierEnabled(): boolean {
  const v = (process.env.AI_THINKING_TIER_ENABLED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Basename of the Thinking model (GGUF_THINKING_MODEL) if configured; undefined if unset. */
function thinkingModelId(): string | undefined {
  const v = (process.env.GGUF_THINKING_MODEL || "").trim();
  return v.length ? stripGguf(v) : undefined;
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
 * Otherwise returns the default deep model (byte-identical to legacy behaviour). Fail-safe:
 * a missing model file logs once and falls back — it NEVER throws and NEVER routes to a model
 * that cannot be loaded.
 */
function deepModelFor(task: TaskKind, difficulty: Difficulty): { id: string | undefined; thinking: boolean } {
  const fallback = { id: defaultModelId(), thinking: false };
  if (difficulty !== "hard") return fallback;
  if (!THINKING_TASKS.has(task)) return fallback;
  if (!thinkingTierEnabled()) return fallback;
  const tid = thinkingModelId();
  if (!tid) return fallback;
  if (!ggufModelFileExists(tid)) {
    warnThinkingFileMissing(tid);
    return fallback;
  }
  return { id: tid, thinking: true };
}

// Log a missing thinking-model file at most once per filename to avoid log spam.
const warnedMissingThinking = new Set<string>();
function warnThinkingFileMissing(tid: string): void {
  if (warnedMissingThinking.has(tid)) return;
  warnedMissingThinking.add(tid);
  console.warn(
    `[aiModelRouter] AI_THINKING_TIER_ENABLED is on but GGUF_THINKING_MODEL "${tid}.gguf" was not ` +
      `found in GGUF_MODELS_DIR — falling back to the default deep model (GGUF_DEFAULT_MODEL). ` +
      `Download the Thinking GGUF or unset the flag. See docs/ECOSYSTEM/PHASE_B_AI_BRAIN_RUNBOOK.md.`,
  );
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
  // Không truyền contextSize: embedding context tự dùng "auto" trong engine.
  if (input.task === "embed") {
    return decide(1, undefined, false, 0, 0, false, "embed → embedding model (engine default)");
  }

  // Tri giác: có ảnh → Tier 3 vision sidecar (engine định tuyến qua GGUF_VISION_MODEL).
  // Vision dùng tiến trình sidecar riêng (LLAMA_VISION_CTX) — KHÔNG đặt contextSize ở đây.
  if (input.task === "vision" || input.hasImage) {
    return decide(3, undefined, false, 512, 0.2, false, "has image → Tier 3 vision sidecar");
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
