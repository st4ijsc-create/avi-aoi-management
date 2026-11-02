/**
 * E2-4 (doc69 Giai đoạn 4 / Wave E2, last E2 task) — realtime `ai:agents` refresh
 * channel for the Agent Command Center (E2-3).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The Command Center polls `trpc.aiAgentCenter.getReadModel` every 5s
 * (AIAgentCommandCenter.tsx). This module adds a PUSH nudge so it can refresh
 * sooner without waiting out the poll: agent state-change choke points
 * (aiAgentOrchestrator.ts's startSession/advance/confirmStep/cancelSession,
 * aiCopilotActions.ts's proposeAction/confirmAction) call publishAiAgentEvent()
 * AFTER their state change is persisted. That publishes a MINIMAL,
 * NON-SENSITIVE `ai:agent` event on the eventBus (server/_core/eventBus.ts).
 * installAiAgentSocketBridge() — mirroring installEcosystemSocketBridge's
 * subscribe-and-re-emit shape (server/_core/socket.ts) — forwards it to the
 * socket room `ai:agents` as the client event `ai:agents`.
 *
 * GATING — mirrors TWIN_LIVE_ENABLED (server/services/twin/twinStream.ts): the
 * bridge is a NO-OP unless AI_AGENTS_LIVE_ENABLED. Following the SAME "cheap
 * in-process registration, gated outbound side-effect" convention as
 * installEcosystemEventBridge (server/services/ecosystem/ecosystemEvents.ts) —
 * the eventBus subscription itself is always registered (idempotent, harmless),
 * but the handler checks the flag on EVERY event and simply returns when it's
 * off, so the socket emit never happens and the Command Center's existing 5s
 * poll remains the only source of truth. This also makes the flag toggle-able
 * without a process restart, and keeps the bridge trivially testable.
 *
 * publishAiAgentEvent() itself is UNCONDITIONAL (always safe/cheap to call — a
 * local EventEmitter emit) regardless of the flag; the flag only gates the
 * bridge's OUTBOUND re-emit to the socket. This mirrors how choke points don't
 * need to know or care whether the live channel is enabled.
 *
 * PAYLOAD SAFETY — the nudge ON THE WIRE carries ONLY { kind?, event, at }. NO
 * plan content, NO tool args, NO secrets, NO preview/result, and (since the
 * factory-scope fix) NO sessionId. The FE reacts to the nudge by refetching the
 * RBAC-gated getReadModel query — that is the ONLY place real agent/session data
 * is authorized to flow.
 *
 * ★ PHẠM VI (sửa lỗ an ninh): phòng `ai:agents` nay CÓ cổng (admin|engineer + MOD_AI, `duocVaoPhongAiAgents`) và bridge phát THEO TỪNG
 *   NGƯỜI NHẬN: chỉ socket mà nhà máy của họ GIAO với nhà máy của CHỦ sự kiện (`ownerUserId`, KHÔNG lên dây) mới nhận
 *   (aiAgentPhamVi.nguoiNhanThayChu — cùng bộ phân giải với getReadModel). Sự kiện không rõ chủ ⇒ chỉ admin nhận.
 *
 * SAFETY: signal-only. No DB write, no control path — this module never calls
 * a tool and never touches aiAgentSessions/aiPendingActions itself.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { eventBus, EventTypes, type DomainEvent } from "../_core/eventBus";
import { nguoiNhanThayChu } from "./aiAgentPhamVi";

/** The choke point that produced this nudge. Informational only — the FE does
 *  not branch on it; it just refetches on ANY nudge. */
export type AiAgentEventKind =
  | "session_started"
  | "advanced"
  | "confirmed"
  | "cancelled"
  | "action_proposed"
  | "action_confirmed";

/** Wire shape — MUST stay minimal/non-sensitive (see module doc above). */
export interface AiAgentNudgePayload {
  /** Reserved for a future per-agent-kind room split; not populated yet. */
  kind?: string;
  event: AiAgentEventKind;
  at: number;
}

/** Hình dạng NỘI BỘ trên eventBus (có chủ sự kiện để bridge định tuyến theo phạm vi; chủ và sessionId KHÔNG BAO GIỜ lên dây). */
export interface AiAgentBusPayload extends AiAgentNudgePayload {
  sessionId?: string;
  ownerUserId?: number;
}

/**
 * Publish a refresh nudge. Fire-and-forget + non-throwing: eventBus.publish()
 * already never throws to its caller, but payload assembly is wrapped here too
 * so a future change to this function can never let a failure escape into the
 * agent/action choke point that called it (startSession/advance/confirmStep/
 * cancelSession/proposeAction/confirmAction all call this as their LAST step,
 * after their own state change already persisted).
 */
export function publishAiAgentEvent(event: AiAgentEventKind, sessionId?: string, ownerUserId?: number): void {
  try {
    const payload: AiAgentBusPayload = { event, sessionId, ownerUserId, at: Date.now() };
    eventBus.publish(EventTypes.AI_AGENT, payload, "aiAgentRealtime");
  } catch (err) {
    console.error("[AiAgentRealtime] publish failed:", (err as Error)?.message ?? err);
  }
}

/** Flag — default OFF (mirrors TWIN_LIVE_ENABLED / FLEET_ORCH_ENABLED). */
function enabled(): boolean {
  return process.env.AI_AGENTS_LIVE_ENABLED === "true" || process.env.AI_AGENTS_LIVE_ENABLED === "1";
}

let installed = false;
let unsubscribe: (() => void) | null = null;

/**
 * Install the eventBus→socket bridge for the `ai:agents` room. Idempotent +
 * safe at startup, same shape as installEcosystemSocketBridge. When
 * AI_AGENTS_LIVE_ENABLED is off, the handler still runs (cheap) but returns
 * immediately — no socket emit, no control path — so the Command Center's 5s
 * poll is unaffected either way.
 */
export function installAiAgentSocketBridge(): void {
  if (installed) return;
  installed = true;
  unsubscribe = eventBus.subscribe<AiAgentBusPayload>(EventTypes.AI_AGENT, async (e: DomainEvent<AiAgentBusPayload>) => {
    if (!enabled()) return; // NO-OP unless AI_AGENTS_LIVE_ENABLED — FE 5s poll stays the fallback
    try {
      // Lazy import: this module is imported by the choke points (aiAgentOrchestrator.ts
      // / aiCopilotActions.ts) which must stay free of socket.ts's heavier dependency
      // graph (db, socketRedisAdapter, machinePresenceStore, …) at module-load time.
      const { getIO } = await import("../_core/socket");
      const io = getIO();
      if (!io) return;
      await phatTheoPhamVi(io, e.payload);
    } catch (err) {
      console.error("[AiAgentRealtime] bridge re-emit failed:", (err as Error)?.message ?? err);
    }
  });
  console.log(`[AiAgentRealtime] bridge installed (AI_AGENTS_LIVE_ENABLED=${enabled()}) → room ai:agents`);
}

/** Phát cho TỪNG socket trong `ai:agents` mà phạm vi nhà máy cho nhận; payload trên dây KHÔNG có sessionId/ownerUserId. */
async function phatTheoPhamVi(io: NonNullable<ReturnType<typeof import("../_core/socket").getIO>>, p: AiAgentBusPayload): Promise<void> {
  const tren: AiAgentNudgePayload = { event: p.event, at: p.at, ...(p.kind ? { kind: p.kind } : {}) };
  const sockets = await io.in("ai:agents").fetchSockets();
  const quyet = new Map<number, Promise<boolean>>(); // một phép quyết định cho mỗi NGƯỜI (nhiều tab) trong một sự kiện
  for (const s of sockets) {
    const u = (s.data as { user?: { id?: unknown; role?: unknown } } | undefined)?.user;
    if (typeof u?.id !== "number" || !Number.isFinite(u.id)) continue; // không danh tính ⇒ không nhận
    let q = quyet.get(u.id);
    if (!q) {
      q = nguoiNhanThayChu({ id: u.id, role: String(u.role ?? "") }, p.ownerUserId).catch(() => false);
      quyet.set(u.id, q);
    }
    if (await q) s.emit("ai:agents", tren);
  }
}

/** Tear down the bridge (tests / shutdown). */
export function uninstallAiAgentSocketBridge(): void {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  installed = false;
}
