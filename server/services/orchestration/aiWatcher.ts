/**
 * AI orchestration watcher (Phase 4 WS4.2) — the local-AI "brain" on the bus.
 *
 * Subscribes to the unified event bus and, when the orchestration rules engine
 * flags a significant pattern (`orchestration.triggered`), asks the LOCAL LLM for
 * a concise root-cause hypothesis + recommended next step, and persists it as an
 * advisory `ai_insights` row. It also re-publishes `ai.insight` on the bus.
 *
 * ⚠️ SAFETY: advisory-only. The watcher NEVER executes an action or issues a
 * device command. Any actionable step a human accepts is created/executed
 * through the existing ai_pending_actions HITL flow + the OT/robot dispatchers.
 *
 * Throttled per machine (AI_WATCHER_MIN_INTERVAL_MS) to protect the single GGUF
 * inference slot. Flag-gated AI_ORCHESTRATION_ENABLED (default off → no cost).
 */
import { eventBus, type DomainEvent } from "../../_core/eventBus";
// ★ G5-E — bộ cắt chuỗi suy luận. Module LÁ (0 import, 0 I/O) nên import TĨNH được ở đây dù engine
// vẫn nạp động trong `try` — hàng rào không treo vào một `await import()` có thể hỏng.
import { stripThinking } from "../ai/thinkingStrip";

let enabled = false;
const unsubscribers: Array<() => void> = [];
const lastRunByMachine = new Map<string, number>();

function minIntervalMs(): number {
  const v = Number(process.env.AI_WATCHER_MIN_INTERVAL_MS);
  return Number.isFinite(v) && v > 0 ? v : 60_000;
}

async function generateAdvisory(rule: string, machine: string, ctx: Record<string, unknown>): Promise<string | null> {
  try {
    // Route the advisory through the Model Router (Cognitive Escalation Ladder).
    // An orchestration advisory is a root-cause hypothesis → task "rca", which the
    // router classifies as "hard" → Tier 2 deep/reasoning model (explicit 30B/7B).
    // Same pattern as aiChatAssistant.ts: route() picks the model, then we hand the
    // resolved modelId + tuned decoding params to the GGUF engine's chatCompletion.
    // doc69 G2-3 (Wave 1, W1-1b) — migrated from a raw route() call to routeInference so
    // this previously-unmetered background inference is now visible in ai_gateway_metrics.
    // SAME {task,text} input `route()` always used → decision.modelId/maxTokens/temperature/
    // contextSize are byte-identical to before (model selection UNCHANGED); this only adds
    // metering + a rate-limit slot. Already fail-safe: any throw here (including
    // RateLimitError) is caught by this function's own outer try/catch below, degrading to
    // null exactly like every other advisory failure mode already did.
    const { chatCompletion } = await import("../../services/aiGgufEngine");
    const { routeInference } = await import("../../services/aiGateway");
    const userPrompt =
      `Sự kiện điều phối: rule="${rule}", máy="${machine}". ` +
      `Bối cảnh: ${JSON.stringify(ctx)}. ` +
      `Hãy đưa giả thuyết nguyên nhân + bước tiếp theo.`;
    const { result } = await routeInference<string>(
      { task: "rca", text: userPrompt },
      async (advRoute) => {
        const res = await chatCompletion(
          {
            messages: [
              {
                role: "system",
                content:
                  "Bạn là kỹ sư chất lượng nhà máy. Trả lời NGẮN GỌN bằng tiếng Việt: " +
                  "(1) một giả thuyết nguyên nhân gốc khả dĩ, (2) một bước hành động đề xuất tiếp theo. " +
                  "Không bịa số liệu; nếu thiếu dữ liệu, nói rõ cần kiểm tra gì.",
              },
              { role: "user", content: userPrompt },
            ],
            maxTokens: Math.min(advRoute.maxTokens, 300), // advisory stays concise
            temperature: advRoute.temperature,
            contextSize: advRoute.contextSize,
          },
          advRoute.modelId,
        );
        // ★ G5-E — lời khuyên này được LƯU VĨNH VIỄN vào `ai_insights.body` rồi hiện trong luồng
        // điều phối. Nội tâm model không được nằm trong bản ghi vĩnh viễn: xoá sau khi đã lưu là
        // việc không ai làm, và mỗi bản sao (báo cáo, xuất tệp) sẽ mang nó đi tiếp. Cắt TẠI ĐÂY,
        // trước khi chữ rời hàm. Các ô đo lường (tokensIn/tokensOut) giữ nguyên — chúng nói về
        // LƯỢT SINH chứ không về chữ hiển thị.
        return { result: stripThinking(res.text).answer, tokensIn: res.tokensPrompt, tokensOut: res.tokensGenerated };
      },
    );
    return result.trim() || null;
  } catch (err) {
    console.error("[AIWatcher] LLM advisory failed:", (err as Error)?.message ?? err);
    return null; // GGUF unavailable → skip (don't store junk)
  }
}

async function storeInsight(source: string, machine: string, body: string, ctx: Record<string, unknown>): Promise<number | undefined> {
  try {
    const { getDb } = await import("../../db/connection");
    const { aiInsights } = await import("../../../drizzle/schema");
    const db = await getDb();
    if (!db) return undefined;
    const [row] = await db.insert(aiInsights).values({
      source,
      machineCode: machine,
      severity: "warning",
      title: `AI advisory: ${source} @ ${machine}`,
      body,
      contextJson: ctx,
      status: "new",
    }).returning({ id: aiInsights.id });
    return row?.id;
  } catch (err) {
    console.error("[AIWatcher] store insight failed:", (err as Error)?.message ?? err);
    return undefined;
  }
}

async function onTriggered(e: DomainEvent): Promise<void> {
  const p = (e.payload ?? {}) as { rule?: string; machine?: string; count?: number };
  const machine = String(p.machine ?? "unknown");
  const rule = String(p.rule ?? "event");

  const now = e.ts;
  const last = lastRunByMachine.get(machine) ?? 0;
  if (now - last < minIntervalMs()) return; // throttle per machine
  lastRunByMachine.set(machine, now);

  const ctx: Record<string, unknown> = { rule, count: p.count };
  const body = await generateAdvisory(rule, machine, ctx);
  if (!body) return;

  const id = await storeInsight(rule, machine, body, ctx);
  eventBus.publish("ai.insight", { id, rule, machine }, "aiWatcher");
  console.log(`[AIWatcher] insight #${id ?? "?"} for ${machine} (${rule})`);
}

export function startAiWatcher(): void {
  if (process.env.AI_ORCHESTRATION_ENABLED !== "true") return; // safe default off
  if (enabled) return;
  enabled = true;
  unsubscribers.push(eventBus.subscribe("orchestration.triggered", onTriggered));
  console.log("[AIWatcher] started (event bus → local LLM advisory)");
}

export function stopAiWatcher(): void {
  for (const u of unsubscribers) {
    try {
      u();
    } catch {
      /* ignore */
    }
  }
  unsubscribers.length = 0;
  lastRunByMachine.clear();
  enabled = false;
}
