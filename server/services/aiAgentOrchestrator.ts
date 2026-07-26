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
  AgentBranchCondition,
  AgentPlan,
  AgentStepResult,
  AiAgentSession,
} from "../../drizzle/schema";
import { getTool, isWriteTool, isClientTool, type ToolExecContext, type ToolLang } from "./aiLocalTools/toolRegistry";
import { proposeAction, confirmAction, cancelAction, type CopilotUser } from "./aiCopilotActions";
import { planGoal, replanFromObservations, AGENT_MAX_STEPS, AGENT_MAX_REPLANS, type ReplanExecutedEntry, type ReplanResult } from "./aiAgentPlanner";

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
/**
 * Observe→replan budget (Wave 3 / D1). `0` legitimately disables replanning —
 * unlike maxSteps/maxWritesPerSession this must NOT fall back to the default
 * on `0`, so it does not use the `Number(...) || default` idiom.
 */
function maxReplans(): number {
  const raw = Number(process.env.AGENT_MAX_REPLANS ?? AGENT_MAX_REPLANS);
  return Math.max(0, Number.isFinite(raw) ? raw : AGENT_MAX_REPLANS);
}
/** Safe, clamped parse of a possibly-missing/null counter column (`replanCount` may be absent pre-migration 0302). */
function toCount(n: unknown): number {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

/** Roles permitted to run agentic multi-step automation.
 *  B1 go-live 2026-06-27: added the engineering roles supervisor + maintenance
 *  (technician) per user decision — they run multi-step sessions; every write step
 *  still goes through HITL propose→confirm gated by per-tool RBAC. (manager/it_admin
 *  are legacy labels not in roleEnum; kept harmless.) */
const AGENTIC_ROLES = new Set(["manager", "it_admin", "admin", "supervisor", "maintenance", "engineer"]);

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

// ─── branch evaluation (deterministic, no LLM at eval time) ────────────────

function getByPath(payload: unknown, path: string): unknown {
  if (!path) return payload;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, payload);
}

/** Resolve the observation value a branch condition reads: the payload of the
 *  most recent DONE `read` step (optionally restricted to a specific tool). */
function resolveObservationValue(when: AgentBranchCondition["when"], stepResults: AgentStepResult[]): unknown {
  const reads = stepResults.filter((r) => r.kind === "read" && r.status === "done");
  const source = when.observationTool
    ? [...reads].reverse().find((r) => r.tool === when.observationTool)
    : reads[reads.length - 1];
  if (!source) return undefined;
  return getByPath(source.payload, when.path);
}

/** Pure, deterministic evaluation — no RNG, no LLM. Throws on an unrecognized
 *  op; the caller catches it and fails safe to fall-through. */
function evaluateBranchCondition(when: AgentBranchCondition["when"], stepResults: AgentStepResult[]): boolean {
  const actual = resolveObservationValue(when, stepResults);
  switch (when.op) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "eq":
      return actual === when.value;
    case "neq":
      return actual !== when.value;
    case "gt":
      return typeof actual === "number" && typeof when.value === "number" && actual > when.value;
    case "lt":
      return typeof actual === "number" && typeof when.value === "number" && actual < when.value;
    case "contains":
      if (typeof actual === "string") return actual.includes(String(when.value));
      if (Array.isArray(actual)) return actual.includes(when.value as never);
      return false;
    default:
      throw new Error(`UNKNOWN_BRANCH_OP:${String((when as { op?: unknown })?.op)}`);
  }
}

/**
 * Resolve a branch step's target cursor. Fail-safe: a missing condition, an
 * evaluation error (unknown op, etc.), or an out-of-bounds/backward target all
 * resolve to `undefined` — fall-through, IDENTICAL to today's no-condition
 * skip behavior. The forward-only guard lives HERE (target must be strictly
 * greater than the branch step's own index and within the plan length) so a
 * malformed or hostile planner output can never move the cursor backward —
 * this is what makes the loop provably non-infinite even with a branch.
 */
function resolveBranchTarget(
  condition: AgentBranchCondition | undefined,
  cursor: number,
  planLength: number,
  stepResults: AgentStepResult[],
): number | undefined {
  if (!condition || !condition.when) return undefined;
  let truthy: boolean;
  try {
    truthy = evaluateBranchCondition(condition.when, stepResults);
  } catch {
    return undefined; // malformed/unevaluable condition → fail-safe fall-through
  }
  const target = truthy ? condition.thenGoto : condition.elseGoto;
  if (target === undefined) return undefined;
  if (!Number.isInteger(target) || target <= cursor || target > planLength) return undefined; // forward-only guard
  return target;
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

  // `plan` is mutable: an observe→replan cycle may replace the not-yet-executed
  // tail (see the `read` branch below). It only ever splices from `cursor`
  // onward — the already-executed prefix `plan.steps.slice(0, cursor)` is
  // never touched, guaranteeing forward-only / no re-execution.
  let plan = (row.planJson ?? { steps: [] }) as AgentPlan;
  const lang = (row.lang as ToolLang) ?? "vi";
  const exec = execCtxOf(ctx.user, lang, ctx.req);

  let cursor = row.cursor;
  let writeCount = row.writeCount;
  let replanCount = toCount(row.replanCount);
  const stepResults: AgentStepResult[] = [...(row.stepResults ?? [])];
  const linkedActionIds: string[] = [...(row.linkedActionIds ?? [])];
  let lastStep: AgentStepResult | undefined;

  // Run non-write steps in a loop; STOP (return) at a write or terminal state.
  while (cursor < plan.steps.length) {
    const step = plan.steps[cursor];

    if (step.kind === "branch") {
      // Deterministic condition eval against observations gathered so far (see
      // resolveBranchTarget). No condition, malformed condition, or an
      // out-of-bounds/backward target → fall-through, IDENTICAL to the prior
      // unconditional-skip behavior (backward compatible with old branches).
      const target = resolveBranchTarget(step.condition, cursor, plan.steps.length, stepResults);
      if (target === undefined) {
        lastStep = { index: cursor, kind: step.kind, tool: null, status: "skipped", message: "branch" };
        stepResults.push(lastStep);
        cursor += 1;
        continue;
      }
      lastStep = { index: cursor, kind: step.kind, tool: null, status: "done", message: `branch→${target}` };
      stepResults.push(lastStep);
      cursor = target; // forward-only, already proven by resolveBranchTarget
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
      await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "paused", replanCount, planJson: plan });
      return { ok: false, status: "paused", step: lastStep, cursor, message: "Tool không khả dụng." };
    }

    // ── navigate / prefill → client directive. NO DB write, NO HITL. ──
    if (step.kind === "navigate" || step.kind === "prefill") {
      if (!isClientTool(tool) || typeof tool.buildClientAction !== "function") {
        lastStep = { index: cursor, kind: step.kind, tool: step.tool ?? null, status: "failed", message: "NOT_A_CLIENT_TOOL" };
        stepResults.push(lastStep);
        await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "paused", replanCount, planJson: plan });
        return { ok: false, status: "paused", step: lastStep, cursor };
      }
      const directive = tool.buildClientAction(step.args ?? {}, exec);
      if (!directive) {
        lastStep = { index: cursor, kind: step.kind, tool: step.tool ?? null, status: "failed", message: "ROUTE_NOT_ALLOWED" };
        stepResults.push(lastStep);
        await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "paused", replanCount, planJson: plan });
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
        await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "paused", replanCount, planJson: plan });
        return { ok: false, status: "paused", step: lastStep, cursor };
      }
      try {
        const result = await tool.handler(step.args ?? {});
        lastStep = { index: cursor, kind: step.kind, tool: step.tool ?? null, status: "done", payload: result };
        stepResults.push(lastStep);
        cursor += 1;

        // ── observe→replan (Wave 3 / D1), bounded by the per-session budget. ──
        // Only a successful read yields an "observation" worth replanning on.
        // Bound #1 (replan budget): never attempt more than maxReplans() times
        // per session — the counter lives on the session row (survives a
        // restart) and is clamped via toCount()/Math.max(0, …).
        if (replanCount < maxReplans()) {
          // Build executed-steps context by INDEX, not position: a `branch`
          // jump can skip several plan indices between its own position and
          // its target, so `stepResults` may be sparser than `cursor` (steps
          // that were jumped over never got recorded). Steps with no
          // recorded result (never actually run) are excluded — nothing to
          // observe for them.
          const resultByIndex = new Map(stepResults.map((r) => [r.index, r] as const));
          const executed: ReplanExecutedEntry[] = plan.steps
            .slice(0, cursor)
            .map((s, i) => ({ step: s, result: resultByIndex.get(i) }))
            .filter((e): e is ReplanExecutedEntry => e.result !== undefined);
          const remaining = plan.steps.slice(cursor); // only steps AT/AFTER cursor are ever touched
          replanCount += 1; // the ATTEMPT consumes budget, whether or not it changes anything

          let outcome: ReplanResult;
          try {
            outcome = await replanFromObservations({ goal: row.goal, executed, remaining, lang });
          } catch {
            // Never let a replan failure crash the session — keep the existing tail.
            outcome = { changed: false, steps: remaining, available: true };
          }

          if (outcome.changed) {
            // Bound #2 (step cap): the replanned tail can never grow the plan
            // past maxSteps() — clamp regardless of what the planner proposed.
            const stepBudget = Math.max(0, maxSteps() - cursor);
            const newTail = outcome.steps.slice(0, stepBudget);
            const before = remaining.length;
            // Splice ONLY the tail from `cursor` onward — the executed prefix
            // is never touched (monotonic forward progress). Bound #3 (write
            // cap) is enforced later, naturally, when/if execution reaches a
            // write step in the new tail (the existing MAX_WRITES_EXCEEDED
            // check below still binds — replanning cannot bypass it).
            plan = { ...plan, steps: [...plan.steps.slice(0, cursor), ...newTail] };
            // Audit note (reuses the stepResults trail — the session's existing
            // audit/message mechanism, visible via getSession/AdvanceResult).
            // index is a NEGATIVE sentinel (never a real plan-step position, so
            // it can never collide with the result the new tail's first step
            // will later record at index `cursor` once it actually executes).
            stepResults.push({
              index: -1 - cursor,
              kind: "guidance",
              tool: null,
              status: "done",
              message: "REPLANNED",
              payload: {
                note: "Kế hoạch được điều chỉnh dựa trên kết quả quan sát.",
                atCursor: cursor,
                replanCount,
                stepsBefore: before,
                stepsAfter: newTail.length,
              },
            });
          }
        }
        continue;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastStep = { index: cursor, kind: step.kind, tool: step.tool ?? null, status: "failed", message: msg };
        stepResults.push(lastStep);
        await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "paused", replanCount, planJson: plan });
        return { ok: false, status: "paused", step: lastStep, cursor };
      }
    }

    // ── write → propose (HITL) and STOP. NEVER execute here. ──
    if (step.kind === "write") {
      if (!isWriteTool(tool)) {
        lastStep = { index: cursor, kind: step.kind, tool: step.tool ?? null, status: "failed", message: "NOT_A_WRITE_TOOL" };
        stepResults.push(lastStep);
        await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "paused", replanCount, planJson: plan });
        return { ok: false, status: "paused", step: lastStep, cursor };
      }
      // Cap writes per session.
      if (writeCount >= maxWritesPerSession()) {
        lastStep = { index: cursor, kind: step.kind, tool: step.tool ?? null, status: "failed", message: "MAX_WRITES_EXCEEDED" };
        stepResults.push(lastStep);
        await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "paused", replanCount, planJson: plan });
        return { ok: false, status: "paused", step: lastStep, cursor, message: "Đã đạt giới hạn số thao tác ghi cho phiên này." };
      }

      let proposal;
      try {
        proposal = await proposeAction(tool, step.args ?? {}, exec);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastStep = { index: cursor, kind: step.kind, tool: step.tool ?? null, status: "failed", message: msg };
        stepResults.push(lastStep);
        await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "paused", replanCount, planJson: plan });
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
        await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "paused", replanCount, planJson: plan });
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
      await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "awaiting_confirm", replanCount, planJson: plan });
      return { ok: true, status: "awaiting_confirm", step: lastStep, pendingActionId: actionId, cursor };
    }

    // Unknown kind (defensive) → skip.
    cursor += 1;
  }

  // Cursor reached the end → done.
  await persist(db, sessionId, { cursor, writeCount, stepResults, linkedActionIds, status: "done", replanCount, planJson: plan });
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
      replanCount: toCount(row.replanCount),
      planJson: (row.planJson ?? { steps: [] }) as AgentPlan, // confirmStep never replans — pass through unchanged
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
    replanCount: toCount(row.replanCount),
    planJson: (row.planJson ?? { steps: [] }) as AgentPlan, // confirmStep never replans — pass through unchanged
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
  const row = await selectSessionRow(db, sessionId);
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

function isMissingColumnError(e: unknown): boolean {
  return (e as { code?: string } | null | undefined)?.code === "42703";
}

/**
 * All `ai_agent_sessions` columns EXCEPT `replanCount` — the fallback select
 * used when the full typed select 42703s because migration 0302 (additive,
 * NOT applied by this task) hasn't run yet on this DB. Same guard pattern as
 * `LEGACY_PROFILE_COLUMNS`/`getProfile` in `server/db/aiAnomaly.ts` (D2).
 */
const SESSION_COLUMNS_LEGACY = {
  id: aiAgentSessions.id,
  userId: aiAgentSessions.userId,
  userRole: aiAgentSessions.userRole,
  goal: aiAgentSessions.goal,
  planJson: aiAgentSessions.planJson,
  cursor: aiAgentSessions.cursor,
  status: aiAgentSessions.status,
  stepResults: aiAgentSessions.stepResults,
  linkedActionIds: aiAgentSessions.linkedActionIds,
  writeCount: aiAgentSessions.writeCount,
  playbookId: aiAgentSessions.playbookId,
  lang: aiAgentSessions.lang,
  expiresAt: aiAgentSessions.expiresAt,
  createdAt: aiAgentSessions.createdAt,
  updatedAt: aiAgentSessions.updatedAt,
};

/**
 * Select one session row by id. Tries the full typed select first (includes
 * `replanCount`); on a 42703 (undefined_column — migration 0302 pending) it
 * retries with the explicit legacy column list and defaults `replanCount` to
 * 0 on the returned row. Any OTHER error is rethrown. This is the single
 * choke point both `loadOwned` and `getSession` use, so session loading is
 * NEVER at risk of breaking before the migration runs.
 */
async function selectSessionRow(db: DbHandle, sessionId: string): Promise<AiAgentSession | null> {
  try {
    const [row] = await db.select().from(aiAgentSessions).where(eq(aiAgentSessions.id, sessionId)).limit(1);
    return (row as AiAgentSession | undefined) ?? null;
  } catch (e) {
    if (!isMissingColumnError(e)) throw e;
    const [row] = await db
      .select(SESSION_COLUMNS_LEGACY)
      .from(aiAgentSessions)
      .where(eq(aiAgentSessions.id, sessionId))
      .limit(1);
    if (!row) return null;
    return { ...(row as object), replanCount: 0 } as AiAgentSession;
  }
}

async function loadOwned(
  sessionId: string,
  user: AgentUser,
): Promise<{ db: DbHandle | null; row: AiAgentSession | null }> {
  const db = await getDb();
  if (!db) return { db: null, row: null };
  const row = await selectSessionRow(db, sessionId);
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
    /** Observe→replan budget counter (Wave 3 / D1). Always passed through
     *  unchanged when this advance() call didn't replan. */
    replanCount: number;
    /**
     * The plan AS OF this persist call. Wave 3 / D1: a replan mutates the
     * in-memory `plan` local in `advance()` — if this weren't persisted, the
     * replanned tail would be silently lost the moment the loop stops (e.g.
     * at a write step, parked for HITL confirm) and a LATER call (confirmStep
     * → advance()) re-loads `planJson` fresh from the DB. Callers that didn't
     * replan simply pass their unchanged plan through.
     */
    planJson: AgentPlan;
  },
): Promise<void> {
  const setObj = {
    cursor: patch.cursor,
    writeCount: patch.writeCount,
    stepResults: patch.stepResults,
    linkedActionIds: patch.linkedActionIds,
    status: patch.status,
    replanCount: patch.replanCount,
    planJson: patch.planJson,
    updatedAt: new Date(),
  };
  try {
    await db.update(aiAgentSessions).set(setObj).where(eq(aiAgentSessions.id, sessionId));
  } catch (e) {
    if (!isMissingColumnError(e)) throw e;
    // Migration 0302 pending — retry the SAME patch without replanCount so
    // cursor/status/stepResults/etc. still persist normally (best-effort;
    // the counter itself is simply not durable until the column exists).
    console.warn(
      `[aiAgentOrchestrator] replanCount column unavailable (migration 0302 pending?) — session ${sessionId} persisted without it:`,
      (e as Error)?.message ?? e,
    );
    const { replanCount: _drop, ...rest } = setObj;
    await db.update(aiAgentSessions).set(rest).where(eq(aiAgentSessions.id, sessionId));
  }
}
