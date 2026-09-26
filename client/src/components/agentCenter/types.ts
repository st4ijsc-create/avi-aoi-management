/**
 * AI Agent Command Center — shared FE types (doc69 Giai đoạn 4 / Wave E2, task E2-3).
 *
 * Derived STRUCTURALLY from the existing `aiAgentCenter` / `aiAgent` router outputs
 * via `inferRouterOutputs<AppRouter>` (the SAME pattern CommandCenter.tsx already
 * uses — see `type RouterOutputs = inferRouterOutputs<AppRouter>` there). No new
 * backend types are declared here — this file only NAMES slices of what the
 * existing routers already return, so every component gets full type-safety
 * without hand-duplicating server interfaces (which would drift).
 */
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import type { Tone } from "@/components/patterns/tokens";

type RouterOutputs = inferRouterOutputs<AppRouter>;

// ─── Read-model (E2-1) + savings (E2-2) — server/services/aiAgentCenterService.ts ─

export type CommandCenterReadModel = RouterOutputs["aiAgentCenter"]["getReadModel"];
export type AgentRosterEntry = CommandCenterReadModel["roster"][number];
export type AgentStatus = AgentRosterEntry["status"];
export type AgentKind = AgentRosterEntry["kind"];
export type OpsSessionSummary = CommandCenterReadModel["sessions"][number];
export type TaskFeedItem = CommandCenterReadModel["taskFeed"][number];

export type SavingsSummary = RouterOutputs["aiAgentCenter"]["getSavingsSummary"];
export type ModelSavingsBreakdown = SavingsSummary["byModel"][number];

// ─── Per-session detail (D4/GĐ3b) — server/services/aiAgentOrchestrator.ts ───────
// Owner-scoped (getSession returns null for a session the viewer does not own —
// see server/routers/aiAgentRouter.ts's own "Fetch session state (owner only)"
// comment). The Command Center's drill-in honestly falls back to the read-model's
// OpsSessionSummary fields when this is null (see AgentDrillInDrawer.tsx).
export type AgentSessionDetail = NonNullable<RouterOutputs["aiAgent"]["getSession"]>;

export type KillSwitchStatus = RouterOutputs["aiAgent"]["getKillSwitchStatus"];

// ─── Status → semantic tone (CRITICAL: idle/no-data is NOT an error color) ──────
//
// This is a DELIBERATE, explicit table — NOT a pass-through to
// `canonicalStatusColor.ts`'s generic `canonicalizeStatus()` alias/substring
// cascade. That cascade is tuned for PackML/machine-lifecycle labels and
// mis-resolves this router's OWN 6-value agent vocabulary for two values:
//   - "awaiting_approval" contains the substring "wait" (a-WAIT-ing) → the
//     cascade's WAIT→IDLE alias fires → wrongly resolves to neutral, not amber.
//   - "blocked" matches no canonical/alias entry → falls through to UNKNOWN →
//     neutral, not red.
// Rather than special-case those two inside the shared canonical file (risking a
// change in behavior for every OTHER caller of canonicalizeStatus/statusTone),
// this module owns an explicit, total, unit-testable-by-inspection mapping for
// its OWN fixed vocabulary — still expressed purely in terms of the shared
// <StatusBadge tone=…> tint system (border/bg/text tokens, no hardcoded hex).
export const AGENT_STATUS_TONE: Record<AgentStatus, Exclude<Tone, "accent">> = {
  working: "success", // active, doing real work right now
  idle: "default", // neutral/standby — NOT an error; simply nothing to do
  blocked: "error", // needs human attention — a dependency/limit is blocking it
  awaiting_approval: "warning", // needs a human decision — attention, not danger
  disabled: "default", // muted — the capability switch/flag is off
  error: "error", // a source query genuinely threw
};

/** Task-feed `state` vocabulary → tone. Orchestrator session states reuse the
 *  SAME 8 values as `aiBrain.agentOps.status.*` (see AIBrainDashboard.tsx) — this
 *  table only adds tones for the specialist-session (`completed`) and
 *  pending-action (`proposed`/`confirmed`/`executed`/`denied`/`expired`/
 *  `cancelled`) states that table doesn't cover. Unknown/future states fall back
 *  to neutral (never guessed into red). */
export const TASK_FEED_STATE_TONE: Record<string, Exclude<Tone, "accent">> = {
  planning: "default",
  running: "info",
  awaiting_approval: "warning",
  awaiting_confirm: "warning",
  paused: "warning",
  done: "success",
  aborted: "default",
  failed: "error",
  completed: "success",
  proposed: "warning",
  confirmed: "info",
  executed: "success",
  denied: "error",
  expired: "default",
  cancelled: "default",
};

export function taskFeedStateTone(state: string): Exclude<Tone, "accent"> {
  return TASK_FEED_STATE_TONE[state] ?? "default";
}
