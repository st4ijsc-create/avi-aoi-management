/**
 * AI Agent Command Center — roster read-model (doc69 Giai đoạn 4 / Wave E2, task E2-1).
 *
 * Unifies every AI "agent" already running in this codebase into ONE roster with a
 * normalized status, for a later Agent Command Center page (E2-3) + live channel
 * (E2-4) + savings meter (E2-2, which will ADD an endpoint to the SAME router this
 * service backs — see server/routers/aiAgentCenterRouter.ts).
 *
 * ── HARD RULES (per the task brief) ─────────────────────────────────────────────
 *   - This module is READ-ONLY. It creates NO new agent state, adds NO DB columns,
 *     writes NOTHING. Every field is DERIVED from an existing source.
 *   - HONEST: a source that is simply empty (no active work) yields the persona in
 *     an honest `idle`/`disabled` status — NEVER a fabricated task or token count.
 *     Where a real value is genuinely attributable (specialist-agent tokens; a real
 *     pending-action summary) it is used verbatim; everywhere else `tokensToday`/
 *     `currentTask` stay `null`.
 *   - FAIL-SAFE PER SOURCE: a thrown query for one source degrades ONLY that
 *     persona (to `error`) and logs — it never takes down the rest of the roster.
 *
 * ── Roster spec (doc69 B4.2) — 9 personas + a Scheduled Agents group ────────────
 *   1 Operations Agent (orchestrator)         ← ai_agent_sessions / listSessionsForOps
 *   2-5 Data Insight / Backend Refactor /
 *       Frontend UX / QA Strategist (specialists)
 *                                              ← listSpecialistAgents() + ai_specialist_sessions/_steps
 *   6 RCA Watcher                              ← server/services/orchestration/aiWatcher.ts (AI_ORCHESTRATION_ENABLED)
 *   7 Proactive Agent (auto-proposer)          ← server/services/aiAutoProposer.ts (AI_AUTO_PROPOSE_ENABLED) + ai_pending_actions
 *   8 Orchestration Advisor                    ← server/services/orchestration/aiOrchestrationAdvisor.ts (advisorEnabled())
 *   9 Copilot Chat                             ← GGUF engine availability (isGgufAvailable())
 *   + Scheduled Agents (batch-RCA / self-learning / anomaly-bank / threshold-tune /
 *     agent-housekeeping) ← each scheduler's own getXxxStatus() (flag off ⇒ disabled)
 *
 * ── Token attribution ────────────────────────────────────────────────────────────
 * Only `ai_specialist_session_steps` carries a genuine PER-AGENT token column
 * (`agentId` + `tokensGenerated`) — so ONLY the 4 specialist personas get a real
 * `tokensToday` (sum over the trailing 24h, honest `0` when no steps ran). Every
 * other persona's `tokensToday` stays `null`: `ai_gateway_metrics` tags inference by
 * `task` (chat/intent/extract/rca/report/vision/embed), not by agent/session — and
 * several DIFFERENT personas share the same task tag (e.g. RCA Watcher's advisory
 * call AND the Orchestration Advisor's workflow proposal both route through
 * `task:"rca"`), so attributing those tokens to one specific persona would be a
 * fabricated precision the brief explicitly forbids ("do NOT invent one here").
 */

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiPendingActions, aiSpecialistSessions, aiSpecialistSessionSteps } from "../../drizzle/schema";
import { listSessionsForOps, type OpsSessionSummary } from "./aiAgentOrchestrator";
import { listSpecialistAgents } from "./aiSpecialistAgentService";
import { isGgufAvailable } from "./aiGgufEngine";
import { isAutoProposeEnabled } from "./aiAutoProposer";
import { advisorEnabled as isOrchestrationAdvisorEnabled } from "./orchestration/aiOrchestrationAdvisor";
import { getBatchRcaStatus } from "./aiBatchRcaScheduler";
import { getSelfLearningStatus } from "./aiSelfLearningScheduler";
import { getThresholdTuneSchedulerStatus } from "./aiThresholdTuneScheduler";
import { getAnomalyBankSchedulerStatus } from "./aiAnomalyBankScheduler";
import { getAgentHousekeepingStatus } from "./aiAgentHousekeepingScheduler";

// ─── Status vocabulary (fixed — doc69 B4.2) ─────────────────────────────────────

export const AGENT_STATUSES = ["working", "idle", "blocked", "awaiting_approval", "disabled", "error"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export type AgentKind =
  | "orchestrator"
  | "specialist"
  | "watcher"
  | "proactive"
  | "advisor"
  | "copilot"
  | "scheduled";

export interface AgentRosterEntry {
  id: string;
  /** Display name (persona key), e.g. "Operations Agent", "Data Insight Agent". */
  persona: string;
  kind: AgentKind;
  status: AgentStatus;
  currentTask: string | null;
  progress: { done: number; total: number } | null;
  /** Sum of real per-agent tokens over the trailing 24h — null when not attributable. */
  tokensToday: number | null;
  /** ISO timestamp of the most recent signal for this persona, else null. */
  updatedAt: string | null;
}

export interface TaskFeedItem {
  id: string;
  agentId: string;
  label: string;
  /** Free-form source-native state string (e.g. session/action status). */
  state: string;
  tokens?: number | null;
  timestamp: string; // ISO
}

export interface CommandCenterReadModel {
  roster: AgentRosterEntry[];
  sessions: OpsSessionSummary[];
  taskFeed: TaskFeedItem[];
  generatedAt: string; // ISO
}

// ─── Pure status normalizer ──────────────────────────────────────────────────────

/**
 * Generic raw-state shape every source is reduced to before normalization. Keeping
 * this shape SOURCE-AGNOSTIC (rather than one bespoke union per source) is what
 * makes `normalizeAgentStatus` a single, deterministic, table-testable function.
 */
export interface RawAgentState {
  /** The persona's global capability switch (feature flag / engine availability). false ⇒ always "disabled". */
  enabled: boolean;
  /** An active, in-progress unit of work exists right now. */
  hasActiveWork?: boolean;
  /** Work is parked pending a human HITL decision. */
  awaitingApproval?: boolean;
  /** Blocked for a non-approval reason (dependency unavailable, throttled, kill-switch, ...). */
  blocked?: boolean;
  /** The source query that would have produced this state THREW. */
  hasError?: boolean;
}

/**
 * normalizeAgentStatus — PURE, deterministic mapping from a source's raw state to
 * the fixed 6-value vocabulary. Priority order (highest first): error > disabled >
 * awaiting_approval > blocked > working > idle (the safe default).
 *
 * Unknown/garbage input (null/undefined `raw`) normalizes to "idle" — documented
 * choice: idle is the least alarming, least presumptive default (never claims
 * "working"/"error" about a persona we have no real signal for).
 */
export function normalizeAgentStatus(raw: RawAgentState | null | undefined): AgentStatus {
  if (!raw) return "idle";
  if (raw.hasError) return "error";
  if (!raw.enabled) return "disabled";
  if (raw.awaitingApproval) return "awaiting_approval";
  if (raw.blocked) return "blocked";
  if (raw.hasActiveWork) return "working";
  return "idle";
}

// ─── Attention priority (multi-row aggregation) ──────────────────────────────────

/**
 * ATTENTION_PRIORITY — when ONE persona is derived from MULTIPLE source rows that
 * could each imply a DIFFERENT status (e.g. several concurrent orchestrator
 * sessions from different users), the persona's headline status must be the one
 * that needs the MOST human attention, never merely the "most active" one — a
 * `working` row must never mask a DIFFERENT row that is `awaiting_approval` or
 * `blocked`. Order (highest attention first): error > awaiting_approval >
 * blocked > working > idle > disabled.
 *
 * This is intentionally NOT the same ordering as `normalizeAgentStatus`'s own
 * internal priority (which puts `disabled` right after `error`, since a
 * globally-off persona should never claim to be doing anything regardless of any
 * row). This table instead ranks candidate ROWS of an already-known-enabled
 * persona — `disabled` is included only for a total order over `AgentStatus` and
 * never actually wins here (no single row is "disabled").
 */
const ATTENTION_PRIORITY: Record<AgentStatus, number> = {
  error: 0,
  awaiting_approval: 1,
  blocked: 2,
  working: 3,
  idle: 4,
  disabled: 5,
};

/**
 * pickByAttention — PURE helper: given candidate rows each tagged (via
 * `statusOf`) with the AgentStatus they would imply on their own, returns the
 * one with the highest attention priority (lowest rank). On a tie, the first
 * candidate in iteration order wins (callers pass rows in their natural/recency
 * order). Returns null for an empty list — callers then fall back to an honest
 * idle/no-task entry.
 */
function pickByAttention<T>(candidates: readonly T[], statusOf: (item: T) => AgentStatus): T | null {
  let best: T | null = null;
  let bestRank = Infinity;
  for (const item of candidates) {
    const rank = ATTENTION_PRIORITY[statusOf(item)];
    if (rank < bestRank) {
      best = item;
      bestRank = rank;
    }
  }
  return best;
}

// ─── Small shared helpers ────────────────────────────────────────────────────────

/** Rolling 24h window — mirrors aiGatewayQuota.ts's own "daily = rolling 24h" convention. */
function trailing24h(): Date {
  return new Date(Date.now() - 24 * 3_600_000);
}

/**
 * Runs `build()` and wraps the result into a full roster entry; on ANY throw, logs
 * and degrades ONLY this persona to "error" (fail-safe per source — the brief's
 * central invariant). This is the single choke point every 1-source-1-persona
 * builder below goes through.
 */
async function safeEntry(
  id: string,
  persona: string,
  kind: AgentKind,
  build: () => Promise<Omit<AgentRosterEntry, "id" | "persona" | "kind">>,
): Promise<AgentRosterEntry> {
  try {
    const rest = await build();
    return { id, persona, kind, ...rest };
  } catch (err) {
    console.error(`[aiAgentCenterService] source failed for persona "${id}":`, (err as Error)?.message ?? err);
    return { id, persona, kind, status: "error", currentTask: null, progress: null, tokensToday: null, updatedAt: null };
  }
}

// ─── 1. Operations Agent (orchestrator) ─────────────────────────────────────────

/**
 * Maps an `ai_agent_sessions.status` (drizzle/schema/enums.ts ~:181
 * `agentSessionStatusEnum`) to the attention it implies for the Operations Agent
 * persona. `paused` is the enum's OWN documented meaning of "blocked" (schema
 * comment ~:180: "paused when a write is blocked (limit/denied/error)") — it is
 * the ONLY source status this persona treats as `blocked`. Terminal states
 * (done/aborted/failed) map to nothing: a FINISHED session is not "current work"
 * needing surfacing here (the task feed still lists it).
 */
const SESSION_ATTENTION_STATUS: Partial<Record<OpsSessionSummary["status"], AgentStatus>> = {
  planning: "working",
  running: "working",
  awaiting_approval: "awaiting_approval",
  awaiting_confirm: "awaiting_approval",
  paused: "blocked",
};

/**
 * Mirrors aiAgentOrchestrator.ts's own (unexported) `agenticEnabled()` predicate —
 * the single global master switch for the entire agentic orchestrator feature.
 */
function agenticOrchestratorEnabled(): boolean {
  return process.env.AI_AGENTIC_ENABLED === "1";
}

async function buildOperationsAgentEntry(): Promise<AgentRosterEntry> {
  return safeEntry("operations-agent", "Operations Agent", "orchestrator", async () => {
    const enabled = agenticOrchestratorEnabled();
    // listSessionsForOps is itself fail-safe (never throws — degrades to []); we
    // still call it inside this try/catch so a TEST that mocks it to throw
    // exercises this persona's degrade path without affecting the rest of getRoster().
    const sessions = await listSessionsForOps({ limit: 20 });

    // This persona is derived from MULTIPLE ops-wide sessions (different users'
    // sessions all land in the same `sessions` list) — rank every session that
    // implies live attention (working/awaiting_approval/blocked) and take the one
    // needing the MOST attention. A merely-`working` session must never mask a
    // DIFFERENT session that is `awaiting_approval` or `blocked`. currentTask/
    // progress/updatedAt below all come from THIS SAME chosen session, so the
    // surfaced task always matches the surfaced status.
    const attentionCandidates = sessions.filter((s) => SESSION_ATTENTION_STATUS[s.status] != null);
    const chosen = pickByAttention(attentionCandidates, (s) => SESSION_ATTENTION_STATUS[s.status]!);
    const chosenStatus = chosen ? SESSION_ATTENTION_STATUS[chosen.status]! : null;

    return {
      status: normalizeAgentStatus({
        enabled,
        hasActiveWork: chosenStatus === "working",
        awaitingApproval: chosenStatus === "awaiting_approval",
        blocked: chosenStatus === "blocked",
      }),
      currentTask: chosen ? chosen.goal : null,
      progress: chosen ? { done: chosen.stepIndex, total: chosen.stepTotal } : null,
      // ai_agent_sessions carries NO per-session token column — honestly not attributable.
      tokensToday: null,
      updatedAt: (chosen ?? sessions[0])?.updatedAt?.toISOString() ?? null,
    };
  });
}

// ─── 2-5. Specialist agents (Data Insight / Backend Refactor / Frontend UX / QA) ─

function specialistRosterId(agentId: string): string {
  return `specialist-${agentId}`;
}

/**
 * All 4 specialist personas share ONE underlying data source (ai_specialist_sessions
 * + ai_specialist_session_steps), so they are built together — a single query failure
 * degrades all 4 at once (still each present in the roster, per the brief).
 */
async function buildSpecialistAgentEntries(): Promise<AgentRosterEntry[]> {
  const agents = listSpecialistAgents(); // pure, sync, static registry — never throws
  const entries: AgentRosterEntry[] = agents.map((a) => ({
    id: specialistRosterId(a.id),
    persona: a.name,
    kind: "specialist" as const,
    status: "idle" as AgentStatus,
    currentTask: null,
    progress: null,
    tokensToday: null,
    updatedAt: null,
  }));

  try {
    const ggufOk = await isGgufAvailable();
    const db = await getDb();
    if (!db) {
      // No DB ⇒ honest idle/disabled (never fabricate work); still reflect engine gate.
      for (const e of entries) e.status = normalizeAgentStatus({ enabled: ggufOk });
      return entries;
    }

    // Cross-user (ops-scoped) "currently running" specialist sessions — deliberately
    // no userId filter, mirrors listSessionsForOps's own documented convention.
    const runningSessions = await db
      .select({
        id: aiSpecialistSessions.id,
        objective: aiSpecialistSessions.objective,
        requestedAgents: aiSpecialistSessions.requestedAgents,
        updatedAt: aiSpecialistSessions.updatedAt,
      })
      .from(aiSpecialistSessions)
      .where(eq(aiSpecialistSessions.status, "running"))
      .orderBy(desc(aiSpecialistSessions.updatedAt))
      .limit(20);

    const stepCountBySession = new Map<number, number>();
    if (runningSessions.length > 0) {
      const stepRows = await db
        .select({ sessionId: aiSpecialistSessionSteps.sessionId })
        .from(aiSpecialistSessionSteps)
        .where(
          inArray(
            aiSpecialistSessionSteps.sessionId,
            runningSessions.map((s) => s.id),
          ),
        );
      for (const r of stepRows) stepCountBySession.set(r.sessionId, (stepCountBySession.get(r.sessionId) ?? 0) + 1);
    }

    // Real per-agent tokens (trailing 24h) — the ONE table with a genuine agentId column.
    const tokenRows = await db
      .select({ agentId: aiSpecialistSessionSteps.agentId, tokensGenerated: aiSpecialistSessionSteps.tokensGenerated })
      .from(aiSpecialistSessionSteps)
      .where(gte(aiSpecialistSessionSteps.createdAt, trailing24h()));
    const tokensByAgent = new Map<string, number>();
    for (const r of tokenRows) {
      tokensByAgent.set(r.agentId, (tokensByAgent.get(r.agentId) ?? 0) + (r.tokensGenerated ?? 0));
    }

    for (const entry of entries) {
      const agentId = entry.id.slice("specialist-".length);
      const session = runningSessions.find(
        (s) => Array.isArray(s.requestedAgents) && s.requestedAgents.includes(agentId),
      );
      entry.status = normalizeAgentStatus({ enabled: ggufOk, hasActiveWork: !!session });
      // Attributable (real per-agent column) ⇒ honest 0 when nothing ran, not null.
      entry.tokensToday = tokensByAgent.get(agentId) ?? 0;
      if (session) {
        entry.currentTask = session.objective;
        const total = Array.isArray(session.requestedAgents) ? session.requestedAgents.length : 1;
        entry.progress = { done: stepCountBySession.get(session.id) ?? 0, total };
        entry.updatedAt = session.updatedAt.toISOString();
      }
    }
    return entries;
  } catch (err) {
    console.error("[aiAgentCenterService] specialist-agents source failed:", (err as Error)?.message ?? err);
    return entries.map((e) => ({ ...e, status: "error" as AgentStatus }));
  }
}

// ─── 6. RCA Watcher ──────────────────────────────────────────────────────────────

/**
 * Mirrors server/services/orchestration/aiWatcher.ts's own inline predicate
 * (`startAiWatcher`) — no exported getter exists there, so this is intentionally
 * the SAME single-flag check, read directly (never re-implemented differently).
 */
function rcaWatcherEnabled(): boolean {
  return process.env.AI_ORCHESTRATION_ENABLED === "true";
}

async function buildRcaWatcherEntry(): Promise<AgentRosterEntry> {
  return safeEntry("rca-watcher", "RCA Watcher", "watcher", async () => ({
    status: normalizeAgentStatus({ enabled: rcaWatcherEnabled() }),
    // Event-driven, no persisted "current activity" row this module can trust as
    // EXCLUSIVELY this watcher's (ai_insights has other writers too) — honest null.
    currentTask: null,
    progress: null,
    tokensToday: null,
    updatedAt: null,
  }));
}

// ─── 7. Proactive Agent (auto-proposer) ─────────────────────────────────────────

async function buildProactiveAgentEntry(): Promise<AgentRosterEntry> {
  return safeEntry("proactive-agent", "Proactive Agent", "proactive", async () => {
    const enabled = isAutoProposeEnabled();
    if (!enabled) {
      return { status: normalizeAgentStatus({ enabled }), currentTask: null, progress: null, tokensToday: null, updatedAt: null };
    }

    // ai_pending_actions carries NO agent/persona column, so this is a best-effort
    // AGGREGATE signal, not a guaranteed per-row attribution: "at least one
    // unexpired proposal is outstanding" is real and honestly reported (the actual
    // `summary` text shown is the real row content — never fabricated), even though
    // WHICH exact flow authored it (auto-proposer vs. an interactive chat propose)
    // cannot be told apart from this table alone.
    const db = await getDb();
    if (!db) {
      return { status: normalizeAgentStatus({ enabled }), currentTask: null, progress: null, tokensToday: null, updatedAt: null };
    }

    const rows = await db
      .select({ summary: aiPendingActions.summary, createdAt: aiPendingActions.createdAt })
      .from(aiPendingActions)
      .where(and(eq(aiPendingActions.status, "proposed"), gte(aiPendingActions.expiresAt, new Date())))
      .orderBy(desc(aiPendingActions.createdAt))
      .limit(1);

    const latest = rows[0] ?? null;
    return {
      status: normalizeAgentStatus({ enabled, awaitingApproval: !!latest }),
      currentTask: latest?.summary ?? null,
      progress: null,
      tokensToday: null,
      updatedAt: latest?.createdAt ? latest.createdAt.toISOString() : null,
    };
  });
}

// ─── 8. Orchestration Advisor ────────────────────────────────────────────────────

async function buildOrchestrationAdvisorEntry(): Promise<AgentRosterEntry> {
  return safeEntry("orchestration-advisor", "Orchestration Advisor", "advisor", async () => ({
    status: normalizeAgentStatus({ enabled: isOrchestrationAdvisorEnabled() }),
    currentTask: null,
    progress: null,
    tokensToday: null,
    updatedAt: null,
  }));
}

// ─── 9. Copilot Chat ─────────────────────────────────────────────────────────────

async function buildCopilotChatEntry(): Promise<AgentRosterEntry> {
  return safeEntry("copilot-chat", "Copilot Chat", "copilot", async () => {
    // No admin on/off flag guards chat — the local GGUF engine's real availability
    // IS the capability gate (mirrors how aiChatAssistant/aiLocalKnowledgeService
    // themselves degrade when the engine is unavailable).
    const ggufOk = await isGgufAvailable();
    return {
      status: normalizeAgentStatus({ enabled: ggufOk }),
      currentTask: null,
      progress: null,
      tokensToday: null,
      updatedAt: null,
    };
  });
}

// ─── Scheduled Agents (batch-RCA / self-learning / anomaly-bank / threshold-tune / housekeeping) ─

interface SchedulerStatusLike {
  enabled: boolean;
  lastRunAt?: Date | null;
}

function buildScheduledEntry(id: string, persona: string, getStatus: () => SchedulerStatusLike): AgentRosterEntry {
  try {
    const s = getStatus();
    return {
      id,
      persona,
      kind: "scheduled",
      // Cron-armed schedulers spend almost all their life between runs — "working"
      // would be misleading for a job that fires once/day; "idle" (standing by) is
      // the honest steady state whenever the flag is on. Flag off ⇒ disabled.
      status: normalizeAgentStatus({ enabled: s.enabled }),
      currentTask: null,
      progress: null,
      tokensToday: null,
      updatedAt: s.lastRunAt ? new Date(s.lastRunAt).toISOString() : null,
    };
  } catch (err) {
    console.error(`[aiAgentCenterService] scheduled source failed for "${id}":`, (err as Error)?.message ?? err);
    return { id, persona, kind: "scheduled", status: "error", currentTask: null, progress: null, tokensToday: null, updatedAt: null };
  }
}

function buildScheduledAgentEntries(): AgentRosterEntry[] {
  return [
    buildScheduledEntry("scheduled-batch-rca", "Batch RCA Scheduler", getBatchRcaStatus),
    buildScheduledEntry("scheduled-self-learning", "Self-Learning Scheduler", getSelfLearningStatus),
    buildScheduledEntry("scheduled-anomaly-bank", "Anomaly Bank Scheduler", getAnomalyBankSchedulerStatus),
    buildScheduledEntry("scheduled-threshold-tune", "Threshold Auto-Tune Scheduler", getThresholdTuneSchedulerStatus),
    buildScheduledEntry("scheduled-agent-housekeeping", "Agent Housekeeping Scheduler", getAgentHousekeepingStatus),
  ];
}

// ─── Roster assembly ─────────────────────────────────────────────────────────────

/**
 * getRoster — the full 9-persona + Scheduled-Agents roster. Every builder above is
 * individually fail-safe (never rejects), so this never throws either; a broken
 * source degrades only its own persona to "error".
 */
export async function getRoster(): Promise<AgentRosterEntry[]> {
  const [operationsAgent, specialists, rcaWatcher, proactiveAgent, orchestrationAdvisor, copilotChat] = await Promise.all([
    buildOperationsAgentEntry(),
    buildSpecialistAgentEntries(),
    buildRcaWatcherEntry(),
    buildProactiveAgentEntry(),
    buildOrchestrationAdvisorEntry(),
    buildCopilotChatEntry(),
  ]);

  return [operationsAgent, ...specialists, rcaWatcher, proactiveAgent, orchestrationAdvisor, copilotChat, ...buildScheduledAgentEntries()];
}

// ─── Task feed ───────────────────────────────────────────────────────────────────

/**
 * Unified, newest-first, capped feed across sources. Each sub-source is fetched in
 * its OWN try/catch so one failing never empties the whole feed.
 */
async function buildTaskFeed(cap: number, sessions: OpsSessionSummary[]): Promise<TaskFeedItem[]> {
  const items: TaskFeedItem[] = [];

  // (a) Orchestrator sessions — reuse the ALREADY-fetched ops-scoped session list.
  for (const s of sessions) {
    items.push({
      id: `orchestrator:${s.id}`,
      agentId: "operations-agent",
      label: s.goal,
      state: s.status,
      tokens: null,
      timestamp: s.updatedAt.toISOString(),
    });
  }

  // (b) Specialist sessions (ops-wide recent — running + completed + failed).
  try {
    const db = await getDb();
    if (db) {
      const rows = await db
        .select({
          id: aiSpecialistSessions.id,
          objective: aiSpecialistSessions.objective,
          summary: aiSpecialistSessions.summary,
          requestedAgents: aiSpecialistSessions.requestedAgents,
          status: aiSpecialistSessions.status,
          updatedAt: aiSpecialistSessions.updatedAt,
        })
        .from(aiSpecialistSessions)
        .orderBy(desc(aiSpecialistSessions.updatedAt))
        .limit(cap);

      const ids = rows.map((r) => r.id);
      const tokensBySession = new Map<number, number>();
      if (ids.length > 0) {
        const stepRows = await db
          .select({ sessionId: aiSpecialistSessionSteps.sessionId, tokensGenerated: aiSpecialistSessionSteps.tokensGenerated })
          .from(aiSpecialistSessionSteps)
          .where(inArray(aiSpecialistSessionSteps.sessionId, ids));
        for (const r of stepRows) {
          tokensBySession.set(r.sessionId, (tokensBySession.get(r.sessionId) ?? 0) + (r.tokensGenerated ?? 0));
        }
      }

      for (const r of rows) {
        const firstAgent = Array.isArray(r.requestedAgents) && r.requestedAgents.length > 0 ? r.requestedAgents[0] : null;
        items.push({
          id: `specialist:${r.id}`,
          agentId: firstAgent ? specialistRosterId(firstAgent) : "specialist",
          label: r.summary ?? r.objective,
          state: r.status,
          tokens: tokensBySession.get(r.id) ?? null,
          timestamp: r.updatedAt.toISOString(),
        });
      }
    }
  } catch (err) {
    console.error("[aiAgentCenterService] taskFeed specialist-agents source failed:", (err as Error)?.message ?? err);
  }

  // (c) Pending HITL actions (ops-wide recent — proposed/confirmed/executed/denied/...).
  try {
    const db = await getDb();
    if (db) {
      const rows = await db
        .select({
          id: aiPendingActions.id,
          summary: aiPendingActions.summary,
          status: aiPendingActions.status,
          createdAt: aiPendingActions.createdAt,
        })
        .from(aiPendingActions)
        .orderBy(desc(aiPendingActions.createdAt))
        .limit(cap);

      for (const r of rows) {
        items.push({
          id: `action:${r.id}`,
          // Best-effort (see buildProactiveAgentEntry) — ai_pending_actions has no
          // agent/persona column to attribute exactly.
          agentId: "proactive-agent",
          label: r.summary,
          state: r.status,
          tokens: null,
          timestamp: r.createdAt.toISOString(),
        });
      }
    }
  } catch (err) {
    console.error("[aiAgentCenterService] taskFeed pending-actions source failed:", (err as Error)?.message ?? err);
  }

  items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return items.slice(0, cap);
}

// ─── Full read-model ──────────────────────────────────────────────────────────────

export interface GetReadModelOptions {
  /** Cap on taskFeed length (also used as the per-sub-source fetch limit). Default 50. */
  limit?: number;
}

/**
 * getCommandCenterReadModel — { roster, sessions, taskFeed, generatedAt }. Honest-
 * empty shape when nothing is running (every array simply empty, never fabricated
 * placeholder rows). All aggregation is fail-safe: a broken sub-source degrades
 * that piece only, never throws the whole read-model.
 */
export async function getCommandCenterReadModel(opts?: GetReadModelOptions): Promise<CommandCenterReadModel> {
  const cap = Math.min(Math.max(1, opts?.limit ?? 50), 200);

  const [roster, sessions] = await Promise.all([
    getRoster(),
    (async () => {
      try {
        return await listSessionsForOps({ limit: 30 });
      } catch (err) {
        console.error("[aiAgentCenterService] read-model sessions source failed:", (err as Error)?.message ?? err);
        return [] as OpsSessionSummary[];
      }
    })(),
  ]);

  let taskFeed: TaskFeedItem[] = [];
  try {
    taskFeed = await buildTaskFeed(cap, sessions);
  } catch (err) {
    console.error("[aiAgentCenterService] read-model taskFeed assembly failed:", (err as Error)?.message ?? err);
  }

  return { roster, sessions, taskFeed, generatedAt: new Date().toISOString() };
}
