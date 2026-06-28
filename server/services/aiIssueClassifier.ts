/**
 * AI Issue Classifier — "1-tap issue report" (báo sự cố) brain.
 *
 * Given a short free-text problem description from a shop-floor operator (and an
 * optional machine code / language), pick the Andon REASON + STATE so the
 * operator does NOT have to choose a category/severity themselves. The result is
 * fed straight into the existing Andon service (`raiseAndon`) — this module does
 * NOT write anything itself; it only classifies.
 *
 * Strategy (mirrors aiAgentPlanner / intentClassifier):
 *   1) Route the task through the Model Router (`route({ task: "intent" })`) →
 *      FAST tier (Qwen3-4B when GGUF_FAST_MODEL is set) for low latency.
 *   2) Constrain decoding with a GBNF JSON schema whose `reason`/`state` fields
 *      are ENUMS — the decoder can only emit valid values. We additionally CLAMP
 *      the parsed result against the canonical enum lists (belt-and-suspenders:
 *      a stray value, a wrong-cased value, or the legacy/non-GBNF engine path
 *      could still yield something off-list → coerced to a safe default).
 *
 * Fail-safe contract (NEVER throws): AI unavailable, empty input, inference
 * error, or an off-enum answer → returns a sensible default and marks
 * `degraded: true`. The caller can therefore ALWAYS raise an Andon.
 *   - empty description           → { reason:"other", state:"call" }  (bare call-for-help)
 *   - AI down / error / low-conf  → { reason:"other", state:"yellow" }
 */

export type AndonReason = "quality" | "material" | "maintenance" | "safety" | "setup" | "other";
export type AndonState = "green" | "yellow" | "red" | "call";

// Canonical enum lists — kept in sync with drizzle/schema/enums.ts (andonReasonEnum / andonStateEnum).
export const ANDON_REASONS: readonly AndonReason[] = [
  "quality",
  "material",
  "maintenance",
  "safety",
  "setup",
  "other",
] as const;
export const ANDON_STATES: readonly AndonState[] = ["green", "yellow", "red", "call"] as const;

export type ClassifyLang = "vi" | "en" | "zh";

export interface ClassifyIssueInput {
  description?: string;
  machineCode?: string;
  lang?: ClassifyLang;
}

export interface ClassifyIssueResult {
  reason: AndonReason;
  state: AndonState;
  title: string;
  /** true when the AI could not be used / produced a low-confidence or off-enum answer → safe default applied. */
  degraded: boolean;
}

// GBNF JSON schema — reason/state are enums so the decoder can only emit valid values.
const ISSUE_SCHEMA = {
  type: "object",
  properties: {
    reason: { type: "string", enum: [...ANDON_REASONS] },
    state: { type: "string", enum: [...ANDON_STATES] },
    title: { type: "string" },
  },
  required: ["reason", "state"],
} as const;

/** Clamp an arbitrary value to a valid AndonReason (case-insensitive); fallback when off-list. */
export function clampReason(value: unknown, fallback: AndonReason = "other"): AndonReason {
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    const hit = ANDON_REASONS.find((r) => r === v);
    if (hit) return hit;
  }
  return fallback;
}

/** Clamp an arbitrary value to a valid AndonState (case-insensitive); fallback when off-list. */
export function clampState(value: unknown, fallback: AndonState = "yellow"): AndonState {
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    const hit = ANDON_STATES.find((s) => s === v);
    if (hit) return hit;
  }
  return fallback;
}

/** Default human-readable title when the AI gives none. */
function defaultTitle(lang: ClassifyLang, machineCode?: string): string {
  const m = machineCode ? ` (${machineCode})` : "";
  switch (lang) {
    case "en":
      return `Operator issue report${m}`;
    case "zh":
      return `操作员问题报告${m}`;
    case "vi":
    default:
      return `Báo sự cố từ vận hành${m}`;
  }
}

function buildPrompt(description: string, lang: ClassifyLang, machineCode?: string): string {
  const ctx = machineCode ? `Máy/thiết bị liên quan: ${machineCode}.` : "";
  return [
    "Bạn là bộ phân loại sự cố cho hệ thống sản xuất AVI/AOI. Một công nhân vừa báo một vấn đề.",
    "Hãy chọn DUY NHẤT một loại (reason) và một mức cảnh báo (state) phù hợp nhất.",
    "",
    "reason (loại sự cố):",
    "  - quality: lỗi chất lượng sản phẩm / NG / sai kích thước / lỗi ngoại quan.",
    "  - material: thiếu/hết vật tư, linh kiện, nguyên liệu, sai vật tư.",
    "  - maintenance: máy hỏng/kẹt/báo lỗi/cần bảo trì, sửa chữa thiết bị.",
    "  - safety: nguy cơ an toàn, tai nạn, cháy, rò rỉ, người bị thương.",
    "  - setup: cài đặt/đổi mẫu/căn chỉnh/thay khuôn/dừng chuyển đổi.",
    "  - other: không rõ hoặc không thuộc các loại trên.",
    "",
    "state (mức cảnh báo, tăng dần độ nghiêm trọng): green < yellow < red < call.",
    "  - yellow: vấn đề cần chú ý nhưng dây chuyền vẫn chạy.",
    "  - red: nghiêm trọng, phải dừng máy/dây chuyền ngay.",
    "  - call: cần người tới hỗ trợ (gọi quản lý/kỹ thuật) — dùng khi mô tả mơ hồ.",
    "  - safety LUÔN ở mức red.",
    "",
    ctx,
    `Mô tả của công nhân (ngôn ngữ ${lang}): ${description}`,
    "",
    "Chỉ trả về JSON một dòng đúng schema (KHÔNG markdown, KHÔNG giải thích):",
    '{"reason":"<reason>","state":"<state>","title":"<tiêu đề ngắn gọn>"}',
  ].join("\n");
}

/**
 * Classify an operator-reported issue into an Andon { reason, state, title }.
 * NEVER throws — always returns a usable result so the caller can raise an Andon.
 */
export async function classifyIssue(input: ClassifyIssueInput): Promise<ClassifyIssueResult> {
  const lang: ClassifyLang = input.lang ?? "vi";
  const machineCode = input.machineCode?.trim() || undefined;
  const description = (input.description ?? "").trim();

  // Empty description → bare "call for help" (operator just tapped the button).
  if (description.length < 2) {
    return {
      reason: "other",
      state: "call",
      title: defaultTitle(lang, machineCode),
      degraded: true,
    };
  }

  // Safe default applied whenever the AI path cannot produce a confident answer.
  const safeDefault: ClassifyIssueResult = {
    reason: "other",
    state: "yellow",
    title: defaultTitle(lang, machineCode),
    degraded: true,
  };

  try {
    const { generateJSON, isGgufAvailable } = await import("./aiGgufEngine");
    const { route } = await import("./aiModelRouter");

    if (!(await isGgufAvailable())) return safeDefault;

    // Model Router: intent classification is Tier 1 (fast model when GGUF_FAST_MODEL is set).
    const decision = route({ task: "intent", text: description });

    const { data } = await generateJSON<{ reason?: unknown; state?: unknown; title?: unknown }>(
      ISSUE_SCHEMA,
      {
        prompt: buildPrompt(description, lang, machineCode),
        maxTokens: 120,
        temperature: 0,
        topP: 0.8,
      },
      decision.modelId,
    );

    if (!data || (typeof data.reason !== "string" && typeof data.state !== "string")) {
      return safeDefault;
    }

    // Enum-clamp every field. An off-enum AI answer → coerced to a valid value (not a throw).
    const reason = clampReason(data.reason, "other");
    const state = clampState(data.state, "yellow");
    const titleRaw = typeof data.title === "string" ? data.title.trim() : "";
    const title = titleRaw.length > 0 ? titleRaw.slice(0, 255) : defaultTitle(lang, machineCode);

    return { reason, state, title, degraded: false };
  } catch {
    // Any inference / import failure → safe default, never throw.
    return safeDefault;
  }
}
