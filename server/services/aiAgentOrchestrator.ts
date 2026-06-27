/**
 * AI Agent Orchestrator (GĐ3b) — drives a validated multi-step plan, STANDING
 * ON TOP OF the GĐ2 HITL write flow.
 *
 * ABSOLUTE SAFETY INVARIANTS (proven by tests):
 *  - The orchestrator ONLY ever calls `proposeAction` (for a write step) and the
 *    core `confirmAction` (re-used 100%, user-triggered via tRPC). It NEVER calls
 *    tool.execute() directly, NEVER imports commandDispatcher, and NEVER
 *    self-confirms.
 *  - advance() STOPS at every write step (status = awaiting_confirm). The cursor
 *    only moves past a write via confirmStep() — i.e. AFTER the user confirms and
 *    the core confirmAction has executed it. No auto-chaining across a write.
 *  - The RBAC/agentic gate uses ctx.user.role from the SERVER session, never the
 *    request body.
 *  - When GGUF is offline the planner degrades to an empty plan; the session does
 *    not crash.
 *  - writeCount is capped at MAX_WRITES_PER_SESSION; the (AGENT_MAX_STEPS) plan
 *    length is enforced by the planner.
 */

import { randomUUID } from "node:crypto";
import { eq, and, lt } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiAgentSessions } from "../../drizzle/schema";
import type {
  AgentPlan,
  AgentStepResult,
  AiAgentSession,
} from "../../drizzle/schema";
import { getTool, isWriteTool, isClientTool, type ToolExecContext, type ToolLang } from "./aiLocalTools/toolRegistry";
import { proposeAction, confirmAction, cancelAction, type CopilotUser } from "./aiCopilotActions";
import { planGoal, AGENT_MAX_STEPS } from "./aiAgentPlanner";

// ─── Tunables (read at call time so tests/config toggles take effect) ──────
function agenticEnabled(): boolean {
  return process.env.AI_AGENTIC_ENABLED === "1";
}
function maxSteps(): number {
  return Math.max(1, Number(process.env.AGENT_MAX_STEPS ?? AGENT_MAX_STEPS) || AGENT_MAX_STEPS);
}
function maxWritesPerSession(): number {
  return Math.max(1, Number(process.env.AGENT_MAX_WRITES_PER_SESSION ?? 3) || 3);
}

/** Roles permitted to run agentic multi-step automation.
 *  B1 go-live 2026-06-27: added the engineering roles supervisor + maintenance
 *  (technician) per user decision — they run multi-step sessions; every write step
 *  still goes through HITL propose→confirm gated by per-tool RBAC. (manager/it_admin
 *  are legacy labels not in roleEnum; kept harmless.) */
const AGENTIC_ROLES = new Set(["manager", "it_admin", "admin", "supervisor", "maintenance"]);

/** Session TTL (mirrors the pending-action 5' but generous for a multi-step flow). */
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface AgentUser extends CopilotUser {}

/** True when agentic mode is enabled AND the (server-side) role is allowed. */
export function canUseAgentic(user: { role: string }): boolean {
  return agenticEnabled() && AGENTIC_ROLES.has(String(user.role));
}

function execCtxOf(user: AgentUser, lang: ToolLang, req?: ToolExecContext["req"]): ToolExecContext {
  return { user: { id: user.id, role: user.role, name: user.name ?? null }, lang, req };
}

function nowPlusTtl(): Date {
  return new Date(Date.now() + SESSION_TTL_MS);
}

// ─── Public results ─────────────────────────────────────────────────────────

export interface StartSessionResult {
  ok: boolean;
  enabled: boolean;
  sessionId?: string;
  status?: AiAgentSession["status"];
  plan?: AgentPlan;
  message?: string;
}

export interface AdvanceResult {
  ok: boolean;
  status: AiAgentSession["status"];
  /** The step result produced by the step we just acted on (if any). */
  step?: AgentStepResult;
  /** Pending action to confirm (set when we stopped at a write step). */
  pendingActionId?: string | null;
  cursor: number;
  message?: string;
}

// ─── Session lifecycle ────────────────────────────────────────────────────

/**
 * Create a session, plan the goal, and park it at awaiting_approval. The gate is
 * checked with the SERVER role; a disallowed user gets { enabled: false } and NO
 * row is created.
 */
export async function startSession(
  goal: string,
  ctx: { user: AgentUser; lang?: ToolLang; req?: ToolExecContext["req"] },
): Promise<StartSessionResult> {
  const lang: ToolLang = ctx.lang ?? "vi";
  if (!canUseAgentic(ctx.user)) {
    return { ok: false, enabled: false, message: "Agentic mode chưa được bật cho vai trò này." };
  }

  const db = await getDb();
  if (!db) return { ok: false, enabled: true, message: "DB_UNAVAILABLE" };

  const sessionId = randomUUID();
  const expiresAt = nowPlusTtl();

  // Insert a planning row first (audit/visibility), then plan.
  await db.insert(aiAgentSessions).values({
    id: sessionId,
    userId: ctx.user.id,
    userRole: ctx.user.role,
    goal,
    planJson: null,
    cursor: 0,
    status: "planning",
    stepResults: [],
    linkedActionIds: [],
    writeCount: 0,
    lang,
    expiresAt,
  });

  const planResult = await planGoal(goal, { lang });
  // Enforce the step cap defensively (planner already cuts).
  const plan: AgentPlan = { ...planResult.plan, steps: planResult.plan.steps.slice(0, maxSteps()) };

  await db
    .update(aiAgentSessions)
    .set({ planJson: plan, status: "awaiting_approval", updatedAt: new Date() })
    .where(eq(aiAgentSessions.id, sessionId));

  return {
    ok: true,
    enabled: true,
    sessionId,
    status: "awaiting_approval",
    plan,
    message: plan.steps.length === 0 ? planResult.message : undefined,
  };
}

/** User approves the plan → running → advance to the first stopping point. */
export async function approvePlan(
  sessionId: string,
  ctx: { user: AgentUser; req?: ToolExecContext["req"] },
): Promise<AdvanceResult> {
  const { db, row } = await loadOwned(sessionId, ctx.user);
  if (!db || !row) return { ok: false, status: "failed", cursor: 0, message: "Session không tồn tại." };
  if (row.status !== "awaiting_approval") {
    return { ok: false, status: row.status, cursor: row.cursor, message: `Không thể duyệt ở trạng thái ${row.status}.` };
  }
  await db.update(aiAgentSessions).set({ status: "running", updatedAt: new Date() }).where(eq(aiAgentSessions.id, sessionId));
  return advance(sessionId, ctx);
}

/**
 * Advance the plan from the current cursor. Runs read/client/guidance steps
 * in-place; STOPS at a write step (after proposing) with status awaiting_confirm.
 * Never auto-confirms, never executes.
 */
export async function advance(
  sessionId: string,
  ctx: { user: AgentUser; req?: ToolExecContext["req"] },
): Promise<AdvanceResult> {
  const { db, row } = await loadOwned(sessionId, ctx.user);
  if (!db || !row) return { ok: false, status: "failed", cursor: 0, message: "Session không tồn tại." };

  if (row.status !== "running") {
    return { ok: false, status: row.status, cursor: row.cursor, message: `Không thể tiến ở trạng thái ${row.status}.` };
  }

  const plan = (row.planJson ?? { steps: [] }) as AgentPlan;
  const lang = (row.lang as ToolLang) ?? "vi";
  const exec = execCtxOf(ctx.user, lang, ctx.req);

  let cursor = row.cursor;
  let writeCount = row.writeCount;
  const stepResults: AgentStepResult[] = [...(row.stepResults ?? [])];
  const linkedActionIds: string[] = [...(row.linkedActionIds ?? [])];
  let lastStep: AgentStepResult | undefined;

  // Run non-write steps in a loop; STOP (return) at a write or terminal state.
  while (cursor < plan.steps.length) {
    const step = plan.steps[cursor];

    if (step.kind === "branch") {
      // Minimal deterministic branch: advance past it (conditions resolved by the
      // planner upstream). Recorded as skipped so the trail is complete.
      lastStep = { index: cursor, kind: step.kind, tool: null, status: "skipped", message: "branch" };
      stepResults.push(lastStep);
      cursor += 1;
      continue;
    }

    if (step.kind === "guidance") {
      lastStep = {
        index: cursor,
        kind: step.kind,
        tool: null,
        status: "done",
        payload: { message: step.rationale ?? "" },
      };
      stepResults.push(lastStep);
      cursor += 1;
      continue;
    }

    const tool = step.tool ? getTool(step.tool) : undefined;
    if (!tool) {
      lastStep = { index: cursor, kind: step.kind, tool: step.tool ?? null, status: "failed", message: "TOOL_NOT_REGISTERED" };
      stepResults.push(lastStep);
      await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "paused" });
      return { ok: false, status: "paused", step: lastStep, cursor, message: "Tool không khả dụng." };
    }

    // ── navigate / prefill → client directive. NO DB write, NO HITL. ──
    if (step.kind === "navigate" || step.kind === "prefill") {
      if (!isClientTool(tool) || typeof tool.buildClientAction !== "function") {
        lastStep = { index: cursor, kind: step.kind, tool: step.tool ?? null, status: "failed", message: "NOT_A_CLIENT_TOOL" };
        stepResults.push(lastStep);
        await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "paused" });
        return { ok: false, status: "paused", step: lastStep, cursor };
      }
      const directive = tool.buildClientAction(step.args ?? {}, exec);
      if (!directive) {
        lastStep = { index: cursor, kind: step.kind, tool: step.tool ?? null, status: "failed", message: "ROUTE_NOT_ALLOWED" };
        stepResults.push(lastStep);
        await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "paused" });
        return { ok: false, status: "paused", step: lastStep, cursor };
      }
      lastStep = { index: cursor, kind: step.kind, tool: step.tool ?? null, status: "done", payload: directive };
      stepResults.push(lastStep);
      cursor += 1;
      continue;
    }

    // ── read → run the handler immediately. ──
    if (step.kind === "read") {
      if (isWriteTool(tool) || isClientTool(tool) || typeof tool.handler !== "function") {
        lastStep = { index: cursor, kind: step.kind, tool: step.tool ?? null, status: "failed", message: "NOT_A_READ_TOOL" };
        stepResults.push(lastStep);
        await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "paused" });
        return { ok: false, status: "paused", step: lastStep, cursor };
      }
      try {
        const result = await tool.handler(step.args ?? {});
        lastStep = { index: cursor, kind: step.kind, tool: step.tool ?? null, status: "done", payload: result };
        stepResults.push(lastStep);
        cursor += 1;
        continue;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastStep = { index: cursor, kind: step.kind, tool: step.tool ?? null, status: "failed", message: msg };
        stepResults.push(lastStep);
        await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "paused" });
        return { ok: false, status: "paused", step: lastStep, cursor };
      }
    }

    // ── write → propose (HITL) and STOP. NEVER execute here. ──
    if (step.kind === "write") {
      if (!isWriteTool(tool)) {
        lastStep = { index: cursor, kind: step.kind, tool: step.tool ?? null, status: "failed", message: "NOT_A_WRITE_TOOL" };
        stepResults.push(lastStep);
        await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "paused" });
        return { ok: false, status: "paused", step: lastStep, cursor };
      }
      // Cap writes per session.
      if (writeCount >= maxWritesPerSession()) {
        lastStep = { index: cursor, kind: step.kind, tool: step.tool ?? null, status: "failed", message: "MAX_WRITES_EXCEEDED" };
        stepResults.push(lastStep);
        await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "paused" });
        return { ok: false, status: "paused", step: lastStep, cursor, message: "Đã đạt giới hạn số thao tác ghi cho phiên này." };
      }

      let proposal;
      try {
        proposal = await proposeAction(tool, step.args ?? {}, exec);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastStep = { index: cursor, kind: step.kind, tool: step.tool ?? null, status: "failed", message: msg };
        stepResults.push(lastStep);
        await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "paused" });
        return { ok: false, status: "paused", step: lastStep, cursor };
      }

      if (!proposal.ok || !proposal.pendingAction) {
        // Denied by RBAC (or propose failed) → pause cleanly. Cursor does NOT move.
        lastStep = {
          index: cursor,
          kind: step.kind,
          tool: step.tool ?? null,
          status: "failed",
          message: proposal.message ?? proposal.reason ?? "PROPOSE_FAILED",
        };
        stepResults.push(lastStep);
        await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "paused" });
        return { ok: false, status: "paused", step: lastStep, cursor, message: proposal.message };
      }

      // Proposed OK → record awaiting_confirm and STOP. Cursor stays on this step
      // until confirmStep executes it. No auto-chain.
      const actionId = proposal.pendingAction.actionId;
      linkedActionIds.push(actionId);
      writeCount += 1;
      lastStep = {
        index: cursor,
        kind: step.kind,
        tool: step.tool ?? null,
        status: "awaiting_confirm",
        actionId,
        payload: proposal.pendingAction,
      };
      stepResults.push(lastStep);
      await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "awaiting_confirm" });
      return { ok: true, status: "awaiting_confirm", step: lastStep, pendingActionId: actionId, cursor };
    }

    // Unknown kind (defensive) → skip.
    cursor += 1;
  }

  // Cursor reached the end → done.
  await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "done" });
  return { ok: true, status: "done", step: lastStep, cursor };
}

/**
 * Confirm the pending write at the current step. This is USER-TRIGGERED (tRPC).
 * It calls the CORE confirmAction (re-used 100%) — the orchestrator does not
 * execute the tool itself. Only after the core reports `executed` does the
 * cursor advance and the plan resume.
 */
export async function confirmStep(
  sessionId: string,
  actionId: string,
  token: string,
  ctx: { user: AgentUser; req?: ToolExecContext["req"] },
): Promise<AdvanceResult> {
  const { db, row } = await loadOwned(sessionId, ctx.user);
  if (!db || !row) return { ok: false, status: "failed", cursor: 0, message: "Session không tồn tại." };

  if (row.status !== "awaiting_confirm") {
    return { ok: false, status: row.status, cursor: row.cursor, message: `Không có thao tác chờ xác nhận (trạng thái ${row.status}).` };
  }

  const stepResults: AgentStepResult[] = [...(row.stepResults ?? [])];
  const current = stepResults[stepResults.length - 1];
  if (!current || current.status !== "awaiting_confirm" || current.actionId !== actionId) {
    return { ok: false, status: row.status, cursor: row.cursor, message: "actionId không khớp thao tác đang chờ." };
  }

  const lang = (row.lang as ToolLang) ?? "vi";

  // Re-use the CORE confirmAction. The orchestrator NEVER executes the tool.
  const confirm = await confirmAction(actionId, token, ctx.user, lang, ctx.req);

  if (!confirm.ok || confirm.status !== "executed") {
    // Execution did NOT happen (denied/expired/invalid). Stay parked — cursor does
    // NOT advance. Surface the outcome and pause so the user can react.
    current.status = "failed";
    current.message = confirm.message ?? confirm.status;
    await persist(db, sessionId, {
      cursor: row.cursor,
      writeCount: row.writeCount,
      stepResults,
      linkedActionIds: row.linkedActionIds ?? [],
      status: "paused",
    });
    return { ok: false, status: "paused", step: current, cursor: row.cursor, message: confirm.message };
  }

  // Executed → mark the step done, advance the cursor past the write, resume.
  current.status = "done";
  current.payload = confirm.result;
  const newCursor = row.cursor + 1;
  await persist(db, sessionId, {
    cursor: newCursor,
    writeCount: row.writeCount,
    stepResults,
    linkedActionIds: row.linkedActionIds ?? [],
    status: "running",
  });
  return advance(sessionId, ctx);
}

/** Abort a session and cancel any still-pending proposed action(s). Owner only. */
export async function cancelSession(
  sessionId: string,
  ctx: { user: AgentUser; req?: ToolExecContext["req"] },
): Promise<{ ok: boolean; status: AiAgentSession["status"]; message?: string }> {
  const { db, row } = await loadOwned(sessionId, ctx.user);
  if (!db || !row) return { ok: false, status: "failed", message: "Session không tồn tại." };
  if (row.status === "done" || row.status === "aborted" || row.status === "failed") {
    return { ok: false, status: row.status, message: `Đã kết thúc (${row.status}).` };
  }

  // Cancel any proposed (not-yet-executed) linked actions. Best-effort.
  for (const actionId of row.linkedActionIds ?? []) {
    try {
      await cancelAction(actionId, ctx.user, ctx.req);
    } catch {
      /* ignore — confirmAction idempotency / status checks guard double-handling */
    }
  }

  await db.update(aiAgentSessions).set({ status: "aborted", updatedAt: new Date() }).where(eq(aiAgentSessions.id, sessionId));
  return { ok: true, status: "aborted", message: "Đã huỷ phiên." };
}

/** Fetch a session (owner only) for the UI to render its state. */
export async function getSession(sessionId: string, user: AgentUser): Promise<AiAgentSession | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(aiAgentSessions).where(eq(aiAgentSessions.id, sessionId)).limit(1);
  if (!row || row.userId !== user.id) return null;
  return row;
}

/** Lazy housekeeping: mark stale non-terminal sessions as aborted. Best-effort. */
export async function expireStaleSessions(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const res = await db
    .update(aiAgentSessions)
    .set({ status: "aborted", updatedAt: new Date() })
    .where(and(eq(aiAgentSessions.status, "awaiting_confirm"), lt(aiAgentSessions.expiresAt, new Date())));
  return (res as any)?.rowCount ?? 0;
}

// ─── helpers ────────────────────────────────────────────────────────────────

type DbHandle = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function loadOwned(
  sessionId: string,
  user: AgentUser,
): Promise<{ db: DbHandle | null; row: AiAgentSession | null }> {
  const db = await getDb();
  if (!db) return { db: null, row: null };
  const [row] = await db.select().from(aiAgentSessions).where(eq(aiAgentSessions.id, sessionId)).limit(1);
  if (!row || row.userId !== user.id) return { db, row: null };
  return { db, row };
}

async function persist(
  db: DbHandle,
  sessionId: string,
  patch: {
    cursor: number;
    writeCount: number;
    stepResults: AgentStepResult[];
    linkedActionIds: string[];
    status: AiAgentSession["status"];
  },
): Promise<void> {
  await db
    .update(aiAgentSessions)
    .set({
      cursor: patch.cursor,
      writeCount: patch.writeCount,
      stepResults: patch.stepResults,
      linkedActionIds: patch.linkedActionIds,
      status: patch.status,
      updatedAt: new Date(),
    })
    .where(eq(aiAgentSessions.id, sessionId));
}
