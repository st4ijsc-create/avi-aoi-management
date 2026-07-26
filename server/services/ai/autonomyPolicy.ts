/**
 * doc 69 Giai đoạn 4 / Wave 3 — Task D2: BOUNDED-AUTONOMY policy + kill-switch.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Today every AI-proposed write action is full HITL (server/services/aiCopilotActions.ts:
 * proposeAction → a human clicks confirm → confirmAction executes). This module adds the
 * PREDICATE that decides whether a just-proposed action may skip ONLY the human wait — it
 * NEVER decides whether to execute; execution always goes back through the real
 * confirmAction() (RBAC re-check, guardrail enforcement, idempotency, args-from-DB). See the
 * wiring in aiCopilotActions.ts:proposeAction (search "D2 — bounded-autonomy").
 *
 * `evaluateAutonomy()` returns `allowed:true` ONLY when EVERY one of these AND-conditions
 * holds (short-circuit, cheapest first):
 *   1. isAutonomyEnabled()      — master flag AI_AUTONOMY_ENABLED, default OFF. Opt-in.
 *   2. NOT isKillSwitchTripped() — durable, DB-backed, read FRESH every call (no caching).
 *   3. action.type ∉ AUTONOMY_INELIGIBLE — hard-coded denylist. Wins over EVERYTHING,
 *      including a misconfigured allowlist. Never reachable via env/config.
 *   4. action.type ∈ allowlist   — env AI_AUTONOMY_ALLOWLIST, default EMPTY. Nothing
 *      auto-executes until an operator explicitly opts a type in.
 *   5. action.idempotencyKey is present — guards at-most-one execution (defense-in-depth;
 *      the DB unique index on ai_pending_actions.idempotencyKey is the real guarantee).
 *   6. NOT rate-capped           — optional per-user/hour throttle (fail-safe: cap hit ⇒
 *      HITL fallback, never an error).
 *   7. The proposal carries an AdviceContract AND passes the SAME guardrail/requires[]
 *      enforcement the confirm path runs (reused via aiCopilotActions.evaluateContractForAutonomy
 *      — NOT reimplemented here). No contract ⇒ ineligible (autonomy cannot verify a safety
 *      envelope that was never attached). A `human_approval` requirement makes the action
 *      PERMANENTLY ineligible for autonomy — only a live human can satisfy that requirement,
 *      so autonomy must not pretend to satisfy it on their behalf.
 *
 * KILL-SWITCH STORAGE: reuses the existing `ai_system_config` key/value table (already used
 * by server/routers/aiSettingsRouter.ts for other AI runtime settings) — a durable settings/kv
 * table that already fits, so NO new migration is needed. Row absent (never tripped) ⇒ treated
 * as NOT tripped (steady-state default). A genuine read failure (DB unreachable) fails CLOSED
 * (treated as tripped) — the conservative choice for an unexpected error, distinct from the
 * expected "never configured" empty state.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import type { AdviceContract, CopilotUser } from "../aiCopilotActions";
import type { ToolLang, ToolExecContext } from "../aiLocalTools/toolRegistry";

// ── Master flag + allowlist + rate cap (env, PURE — no I/O) ──────────────────

/** Master gate. Default OFF ⇒ evaluateAutonomy always short-circuits to not-allowed. */
export function isAutonomyEnabled(): boolean {
  return process.env.AI_AUTONOMY_ENABLED === "true";
}

/** Comma-separated action `type`s (tool names) eligible for auto-confirm. Default EMPTY. */
export function getAutonomyAllowlist(): ReadonlySet<string> {
  const raw = process.env.AI_AUTONOMY_ALLOWLIST;
  if (!raw || !raw.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

/** Generous default (fail-safe: a cap hit falls back to HITL, never throws). */
export function autonomyMaxPerHour(): number {
  const n = Number(process.env.AI_AUTONOMY_MAX_PER_HOUR);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

/**
 * Hard-coded, config-proof denylist (Mục "ineligible" — brief D2). These action `type`s
 * (== Tool.name, see aiLocalTools/toolRegistry.ts) mutate machine actuation, program/recipe
 * selection, or safety-critical setpoints/specs/limits/interlocks. They can NEVER be
 * auto-confirmed — not even if an operator mistakenly lists them in AI_AUTONOMY_ALLOWLIST.
 * Checked BEFORE the allowlist in evaluateAutonomy so it always wins.
 */
export const AUTONOMY_INELIGIBLE: ReadonlySet<string> = new Set<string>([
  // Direct machine actuation (physical motion/state change) — server/services/aiLocalTools/writeHandlers/machineControl.ts
  "machine_start",
  "machine_stop",
  "machine_pause",
  "machine_reset",
  "select_recipe",
  "download_job",
  "set_machine_param",
  "acknowledge_machine_alarm", // alarm-clear is safety-subsystem-adjacent, not a plain status ack
  // Vision/SPI actuation — server/services/aiLocalTools/writeHandlers/visionControl.ts
  "reject_divert",
  "spi_printer_offset",
  // PLC/robot program files — control logic, not data — server/services/aiLocalTools/writeHandlers/programmingFile.ts
  "write_project_file",
  // Safety interlock rules — server/services/aiLocalTools/writeHandlers/interlock.ts
  "propose_interlock_rule",
  // Quality setpoints / spec limits / thresholds: "safety-critical setpoints" per the D2
  // brief — a bad auto-tightened/loosened limit silently changes what counts as NG/OK.
  "adjust_ng_threshold", // server/services/aiLocalTools/writeHandlers/engineering.ts
  "create_ng_threshold",
  "configure_inspection_param",
  "update_product_quality_target",
  "set_yield_threshold", // server/services/aiLocalTools/writeHandlers/yield.ts
  "create_measurement_point", // server/services/aiLocalTools/writeHandlers/measurementPoint.ts
  "update_measurement_point",
  "set_spec_limits", // server/services/aiLocalTools/writeHandlers.ts (sample/tutorial tool)
]);

// ── Stable decision-reason codes (audited + asserted in tests) ───────────────

export const AUTONOMY_REASONS = {
  OK: "OK",
  MASTER_DISABLED: "MASTER_DISABLED",
  KILL_SWITCH_TRIPPED: "KILL_SWITCH_TRIPPED",
  TYPE_INELIGIBLE: "TYPE_INELIGIBLE_DENYLISTED",
  TYPE_NOT_ALLOWLISTED: "TYPE_NOT_ALLOWLISTED",
  NO_IDEMPOTENCY_KEY: "NO_IDEMPOTENCY_KEY",
  RATE_CAP_EXCEEDED: "RATE_CAP_EXCEEDED",
  NO_ADVICE_CONTRACT: "NO_ADVICE_CONTRACT",
  HUMAN_APPROVAL_REQUIRED: "HUMAN_APPROVAL_REQUIRED",
} as const;

// ── Kill-switch (durable — DB row, read fresh every call) ────────────────────

/** ai_system_config.key for the autonomy kill-switch row. */
export const AUTONOMY_KILL_SWITCH_KEY = "ai_autonomy_kill_switch";

/**
 * Fresh (uncached) read at decision time. Row absent (never tripped) ⇒ NOT tripped
 * (brief-mandated default — an unconfigured system behaves exactly as before this task).
 * A read failure (DB unreachable) ⇒ fails CLOSED (tripped=true): an unexpected error is
 * NOT the same as "nobody ever configured this," so the conservative read is to block
 * autonomy rather than silently allow it.
 */
export async function isKillSwitchTripped(): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return true;
    const { aiSystemConfig } = await import("../../../drizzle/schema");
    const [row] = await db
      .select()
      .from(aiSystemConfig)
      .where(eq(aiSystemConfig.key, AUTONOMY_KILL_SWITCH_KEY))
      .limit(1);
    if (!row) return false;
    return row.value === "true";
  } catch {
    return true;
  }
}

/** Trip the kill-switch. Durable (survives restart) + instant for every process (no cache). */
export async function tripKillSwitch(reason: string, byUserId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB_UNAVAILABLE");
  const { aiSystemConfig } = await import("../../../drizzle/schema");
  await db
    .insert(aiSystemConfig)
    .values({ key: AUTONOMY_KILL_SWITCH_KEY, value: "true", description: reason, updatedBy: byUserId })
    .onConflictDoUpdate({
      target: aiSystemConfig.key,
      set: { value: "true", description: reason, updatedBy: byUserId, updatedAt: new Date() },
    });
}

/** Reset (untrip) the kill-switch. */
export async function untripKillSwitch(byUserId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB_UNAVAILABLE");
  const { aiSystemConfig } = await import("../../../drizzle/schema");
  await db
    .insert(aiSystemConfig)
    .values({ key: AUTONOMY_KILL_SWITCH_KEY, value: "false", description: `untripped by user ${byUserId}`, updatedBy: byUserId })
    .onConflictDoUpdate({
      target: aiSystemConfig.key,
      set: { value: "false", description: `untripped by user ${byUserId}`, updatedBy: byUserId, updatedAt: new Date() },
    });
}

// ── Optional per-user/hour auto-execution rate cap (in-memory, fail-safe) ────
//
// Deliberately NOT durable/DB-backed: this is a throttle, not a safety gate (the
// kill-switch is the safety gate). A process restart resetting the counter is
// harmless — worst case a few extra autonomous executions right after a restart,
// still bounded by every OTHER condition above.

const _autonomyExecutionsByUser = new Map<number, number[]>();

function isRateCapped(userId: number): boolean {
  const windowMs = 60 * 60 * 1000;
  const now = Date.now();
  const recent = (_autonomyExecutionsByUser.get(userId) ?? []).filter((t) => now - t < windowMs);
  _autonomyExecutionsByUser.set(userId, recent);
  return recent.length >= autonomyMaxPerHour();
}

/** Called by the wiring in aiCopilotActions.ts ONLY after a real autonomous execution. */
export function recordAutonomousExecution(userId: number): void {
  const recent = _autonomyExecutionsByUser.get(userId) ?? [];
  recent.push(Date.now());
  _autonomyExecutionsByUser.set(userId, recent);
}

/** Test-only: clear the in-memory rate-cap window between test cases. */
export function __resetAutonomyRateCapForTests(): void {
  _autonomyExecutionsByUser.clear();
}

// ── evaluateAutonomy — the single decision predicate ──────────────────────────

export interface AutonomyAction {
  /** The tool/action type (== Tool.name / ai_pending_actions.tool). */
  type: string;
  /** The row's idempotencyKey (must be present — proposeAction always generates one). */
  idempotencyKey?: string | null;
  /** The advice contract attached to the proposal, if any (guardrail + requires[]). */
  contract?: AdviceContract | null;
  /** Server-owned args (read-only; passed through to the guardrail/requires check). */
  args: Record<string, unknown>;
}

export interface AutonomyContext {
  user: CopilotUser;
  tool: string;
  actionId: string;
  lang: ToolLang;
  req?: ToolExecContext["req"];
}

export interface AutonomyDecision {
  allowed: boolean;
  reason: string;
}

/**
 * The bounded-autonomy predicate. See the module doc comment for the full AND-chain.
 * NEVER throws — every sub-check is fail-safe (falls back to `allowed:false`).
 */
export async function evaluateAutonomy(action: AutonomyAction, ctx: AutonomyContext): Promise<AutonomyDecision> {
  // 1. Master flag — cheapest, no I/O. OFF ⇒ zero behavior change vs. pre-D2.
  if (!isAutonomyEnabled()) {
    return { allowed: false, reason: AUTONOMY_REASONS.MASTER_DISABLED };
  }

  // 2. Kill-switch — durable, read FRESH (a trip between propose and this check blocks it).
  if (await isKillSwitchTripped()) {
    return { allowed: false, reason: AUTONOMY_REASONS.KILL_SWITCH_TRIPPED };
  }

  // 3. Hard-coded denylist ALWAYS wins — checked before the allowlist so a
  //    misconfigured allowlist can never override it.
  if (AUTONOMY_INELIGIBLE.has(action.type)) {
    return { allowed: false, reason: AUTONOMY_REASONS.TYPE_INELIGIBLE };
  }

  // 4. Allowlist — empty by default ⇒ nothing qualifies until explicitly configured.
  if (!getAutonomyAllowlist().has(action.type)) {
    return { allowed: false, reason: AUTONOMY_REASONS.TYPE_NOT_ALLOWLISTED };
  }

  // 5. idempotencyKey must be present (defense-in-depth against double-execution).
  if (!action.idempotencyKey) {
    return { allowed: false, reason: AUTONOMY_REASONS.NO_IDEMPOTENCY_KEY };
  }

  // 6. Rate cap — fail-safe: cap hit falls back to HITL, never an error.
  if (isRateCapped(ctx.user.id)) {
    return { allowed: false, reason: AUTONOMY_REASONS.RATE_CAP_EXCEEDED };
  }

  // 7. Guardrail contract — MUST be present + in-band + requires[] satisfied. Reuses the
  //    SAME enforcement the confirm path runs (server/services/aiCopilotActions.ts
  //    evaluateContractForAutonomy → enforceAdviceContract) — never reimplemented here.
  //    Dynamic import avoids a top-level circular import (aiCopilotActions.ts imports THIS
  //    module at the top level to call evaluateAutonomy).
  const { evaluateContractForAutonomy } = await import("../aiCopilotActions");
  const contractCheck = await evaluateContractForAutonomy(action.contract ?? null, {
    user: ctx.user,
    tool: action.type,
    actionId: ctx.actionId,
    args: action.args,
    lang: ctx.lang,
  });
  if (!contractCheck.ok) {
    return { allowed: false, reason: contractCheck.reason ?? AUTONOMY_REASONS.NO_ADVICE_CONTRACT };
  }

  return { allowed: true, reason: AUTONOMY_REASONS.OK };
}
