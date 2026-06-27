/**
 * AI Auto-Proposer — drafts SAFE write-actions for the right users (push, 1-tap approve).
 *
 * Design ref: docs/ECOSYSTEM/05_AI_MINIMAL_EFFORT_UX_IDEAS_2026-06.md (§1, §3).
 *
 * Subscribes to the SAME bus signal the advisory watcher sees
 * ('orchestration.triggered': ng_burst / spc_critical / …). For a trigger it:
 *
 *   1. DERIVES a safe recommended action ONLY when a real engineering write-tool
 *      + bounded args clearly apply (today: NG-burst on a machine that already has
 *      an NG-rate threshold → propose adjust_ng_threshold to a conservative,
 *      tool-min/max-clamped value). The causal graph supplies the rationale.
 *   2. IDENTIFIES the responsible users — role maintenance/supervisor in the
 *      affected factory who actually HOLD the tool's RBAC permission
 *      (checkPermission) — and, for each, calls aiCopilotActions.proposeAction so
 *      a pending action lands in THEIR inbox.
 *   3. NEVER confirms or executes. Proposals expire (TTL) like any other.
 *
 * When no safe write-tool applies (e.g. a PdM risk with no work-order tool), it
 * does NOT propose a write — that case is left to the advisory insight the watcher
 * already writes. The auto-proposer ONLY creates write-proposals where safe.
 *
 * SAFETY / HITL INVARIANT (ABSOLUTE): this module calls ONLY proposeAction. It
 * never calls confirmAction, never tool.execute(). RBAC is enforced inside
 * proposeAction (and pre-checked here for user-targeting). Throttle + dedup guard
 * against spam. Flag-gated AI_AUTO_PROPOSE_ENABLED (default OFF → safe no-op).
 */

import { eventBus, type DomainEvent } from "../_core/eventBus";

// ─── Flags / tunables ──────────────────────────────────────────────────────────

export function isAutoProposeEnabled(): boolean {
  return process.env.AI_AUTO_PROPOSE_ENABLED === "true"; // safe default OFF
}

function minIntervalMs(): number {
  const v = Number(process.env.AI_AUTO_PROPOSE_MIN_INTERVAL_MS);
  if (Number.isFinite(v) && v > 0) return v;
  // Fall back to the watcher's throttle, else 60s.
  const w = Number(process.env.AI_WATCHER_MIN_INTERVAL_MS);
  return Number.isFinite(w) && w > 0 ? w : 60_000;
}

function maxProposalsPerRun(): number {
  const v = Number(process.env.AI_AUTO_PROPOSE_MAX_PER_RUN);
  return Number.isFinite(v) && v > 0 ? v : 5;
}

// How aggressively NG-burst lowers the warning threshold (relative %), clamped.
function ngTightenFactor(): number {
  const v = Number(process.env.AI_AUTO_PROPOSE_NG_TIGHTEN);
  return Number.isFinite(v) && v > 0 && v < 1 ? v : 0.2; // tighten warning by 20%
}

// ─── Throttle / dedup state (per scope key) ──────────────────────────────────────

const lastRunByScope = new Map<string, number>();

function scopeKey(rule: string, machine: string): string {
  return `${rule}:${machine}`;
}

/** True when this scope is within its throttle window (skip). */
function isThrottled(rule: string, machine: string, now: number): boolean {
  const last = lastRunByScope.get(scopeKey(rule, machine)) ?? 0;
  return now - last < minIntervalMs();
}

function markRun(rule: string, machine: string, now: number): void {
  lastRunByScope.set(scopeKey(rule, machine), now);
}

// ─── Decision types (pure, testable) ─────────────────────────────────────────────

export interface ProposalDraft {
  tool: string;
  args: Record<string, unknown>;
  /** Short rationale (causal-graph derived when available). */
  rationale: string;
}

export interface DecideResult {
  /** A safe write-action draft, or null when none safely applies (advisory-only). */
  draft: ProposalDraft | null;
  /** Why no draft (for tests / observability). */
  reason: string;
}

export interface ThresholdRow {
  id: number;
  warningThreshold: string | number | null;
  criticalThreshold: string | number | null;
}

/** Clamp to the adjust_ng_threshold tool bound: percentage 0–100, 2-dp. */
function clampPct(v: number): number {
  const c = Math.max(0, Math.min(100, v));
  return Math.round(c * 100) / 100;
}

/**
 * decideNgBurst — PURE decision: given the existing NG threshold for the machine,
 * compute a conservative tighter warning value (within the tool's 0–100 bound).
 *
 * Returns a draft ONLY when there is an existing threshold AND the proposed
 * warning is a real, in-bounds, strictly-tighter change. Otherwise null (→ the
 * advisory insight already covers it; no write is proposed).
 */
export function decideNgBurst(
  threshold: ThresholdRow | null,
  rationale: string,
): DecideResult {
  if (!threshold) {
    return { draft: null, reason: "NO_EXISTING_THRESHOLD" };
  }
  const current = threshold.warningThreshold == null ? NaN : Number(threshold.warningThreshold);
  if (!Number.isFinite(current) || current <= 0) {
    return { draft: null, reason: "INVALID_CURRENT_WARNING" };
  }
  // Tighten the warning threshold (lower NG-rate % = stricter), clamped to bound.
  const proposed = clampPct(current * (1 - ngTightenFactor()));
  if (!(proposed < current) || proposed <= 0) {
    return { draft: null, reason: "NO_TIGHTER_VALUE" };
  }
  return {
    draft: {
      tool: "adjust_ng_threshold",
      args: { thresholdId: threshold.id, warningThreshold: proposed },
      rationale,
    },
    reason: "OK",
  };
}

/**
 * decideForTrigger — maps a trigger to a safe write-action draft (or null).
 * Only ng_burst currently has a safe bounded write-tool. Everything else is
 * advisory-only (no write proposed).
 */
export function decideForTrigger(
  rule: string,
  threshold: ThresholdRow | null,
  rationale: string,
): DecideResult {
  if (rule === "ng_burst") return decideNgBurst(threshold, rationale);
  return { draft: null, reason: "NO_SAFE_WRITE_TOOL_FOR_RULE" };
}

// ─── DB / context helpers (impure; isolated from the pure decide fns) ────────────

/** Resolve the machineCode → { thresholdId, factoryCode } needed to draft + target. */
async function resolveMachineContext(machineCode: string): Promise<{
  threshold: ThresholdRow | null;
  factoryCode: string | null;
}> {
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) return { threshold: null, factoryCode: null };
    const { eq } = await import("drizzle-orm");
    const { machines, stations, productionLines, workshops, factories, mqttNgRateThresholds } = await import(
      "../../drizzle/schema"
    );

    // machine.code → machine row (id) + factory.code via the hierarchy chain.
    const [m] = await db
      .select({ machineId: machines.id, factoryCode: factories.code })
      .from(machines)
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .innerJoin(workshops, eq(productionLines.workshopId, workshops.id))
      .innerJoin(factories, eq(workshops.factoryId, factories.id))
      .where(eq(machines.code, machineCode))
      .limit(1);

    if (!m) return { threshold: null, factoryCode: null };

    // Existing NG-rate threshold bound to this machine (machineId match).
    const [t] = await db
      .select({
        id: mqttNgRateThresholds.id,
        warningThreshold: mqttNgRateThresholds.warningThreshold,
        criticalThreshold: mqttNgRateThresholds.criticalThreshold,
      })
      .from(mqttNgRateThresholds)
      .where(eq(mqttNgRateThresholds.machineId, m.machineId))
      .limit(1);

    return { threshold: t ?? null, factoryCode: m.factoryCode ?? null };
  } catch (err) {
    console.error("[aiAutoProposer] resolveMachineContext failed:", (err as Error)?.message ?? err);
    return { threshold: null, factoryCode: null };
  }
}

/** Build a causal-graph rationale for the trigger (fail-safe → generic string). */
async function buildRationale(rule: string, machine: string): Promise<string> {
  const fallback = `Tự động đề xuất do sự kiện ${rule} tại máy ${machine} (đề xuất an toàn, cần bạn duyệt).`;
  try {
    const { isCausalGraphEnabled, queryByText, formatCausalContext } = await import("./aiCausalGraph");
    if (!isCausalGraphEnabled()) return fallback;
    // NG-burst → look up the dominant defect context for the machine.
    const result = queryByText("NG", machine);
    const text = formatCausalContext(result);
    return text ? `${fallback}\n${text}` : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Find users responsible for the affected factory who HOLD the tool's permission.
 * role ∈ {maintenance, supervisor}, assigned to factoryCode, checkPermission OK.
 * Admin (no factory assignment needed) is also included when permitted.
 */
async function findResponsibleUsers(
  factoryCode: string | null,
  perm: { module: string; action: string },
  cap: number,
): Promise<Array<{ id: number; role: string; name?: string | null }>> {
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) return [];
    const { inArray, eq, and } = await import("drizzle-orm");
    const { users, userFactoryAssignments } = await import("../../drizzle/schema");
    const { checkPermission } = await import("../_core/accessControl");

    const targetRoles = ["maintenance", "supervisor"];

    // Candidate users in the target roles + active.
    const candidates = await db
      .select({ id: users.id, role: users.role, name: users.name })
      .from(users)
      .where(and(inArray(users.role, targetRoles as any), eq(users.isActive, true)));

    // Factory-scope filter: keep users assigned to the affected factory. Admins
    // (role supervisor still needs assignment; only true admin bypasses) — here
    // we restrict to assigned users when a factoryCode is known.
    let scoped = candidates;
    if (factoryCode) {
      const assigns = await db
        .select({ userId: userFactoryAssignments.userId })
        .from(userFactoryAssignments)
        .where(eq(userFactoryAssignments.factoryCode, factoryCode));
      const assignedIds = new Set(assigns.map((a) => a.userId));
      scoped = candidates.filter((u) => assignedIds.has(u.id));
    }

    // RBAC: keep only users who actually hold the tool's permission.
    const permitted: Array<{ id: number; role: string; name?: string | null }> = [];
    for (const u of scoped) {
      if (permitted.length >= cap) break;
      try {
        const ok = await checkPermission(u.id, String(u.role), perm.module, perm.action as any);
        if (ok) permitted.push({ id: u.id, role: String(u.role), name: u.name });
      } catch {
        /* skip user on permission-check error */
      }
    }
    return permitted;
  } catch (err) {
    console.error("[aiAutoProposer] findResponsibleUsers failed:", (err as Error)?.message ?? err);
    return [];
  }
}

// ─── Run (impure orchestration around the pure decide) ───────────────────────────

export interface AutoProposeRunResult {
  proposed: number;
  skippedReason?: string;
  targets: number[];
}

/**
 * runForTrigger — the full (impure) pipeline for one trigger payload. Resolves
 * context, decides a safe draft, finds permitted users, and calls proposeAction
 * for each. NEVER confirms/executes. Returns a compact result for logging/tests.
 */
export async function runForTrigger(
  payload: { rule?: string; machine?: string },
  now: number = Date.now(),
): Promise<AutoProposeRunResult> {
  if (!isAutoProposeEnabled()) return { proposed: 0, skippedReason: "DISABLED", targets: [] };

  const rule = String(payload.rule ?? "event");
  const machine = String(payload.machine ?? "unknown");

  if (machine === "unknown") return { proposed: 0, skippedReason: "NO_MACHINE", targets: [] };
  if (isThrottled(rule, machine, now)) return { proposed: 0, skippedReason: "THROTTLED", targets: [] };

  const { threshold, factoryCode } = await resolveMachineContext(machine);
  const rationale = await buildRationale(rule, machine);
  const decision = decideForTrigger(rule, threshold, rationale);
  if (!decision.draft) {
    // Mark the scope so we don't re-resolve the same no-op trigger in a tight loop.
    markRun(rule, machine, now);
    return { proposed: 0, skippedReason: decision.reason, targets: [] };
  }

  // Resolve the tool + its required permission (for user-targeting + propose).
  const { getTool, isWriteTool } = await import("./aiLocalTools/toolRegistry");
  // Ensure write-tools are registered (side-effect import; safe + idempotent).
  await import("./aiLocalTools/writeHandlers/engineering").catch(() => undefined);
  const tool = getTool(decision.draft.tool);
  if (!tool || !isWriteTool(tool) || !tool.requiredPermission) {
    markRun(rule, machine, now);
    return { proposed: 0, skippedReason: "TOOL_UNAVAILABLE", targets: [] };
  }

  const targets = await findResponsibleUsers(factoryCode, tool.requiredPermission, maxProposalsPerRun());
  if (targets.length === 0) {
    markRun(rule, machine, now);
    return { proposed: 0, skippedReason: "NO_PERMITTED_USERS", targets: [] };
  }

  // Throttle is consumed once we commit to proposing for this scope.
  markRun(rule, machine, now);

  const { proposeAction } = await import("./aiCopilotActions");
  const cap = maxProposalsPerRun();
  const proposedTo: number[] = [];
  for (const u of targets) {
    if (proposedTo.length >= cap) break;
    try {
      // HITL: PROPOSE ONLY. Never confirm/execute.
      const res = await proposeAction(tool, decision.draft.args, {
        user: { id: u.id, role: u.role, name: u.name ?? null },
        lang: "vi",
      });
      if (res.ok) proposedTo.push(u.id);
    } catch (err) {
      console.error("[aiAutoProposer] proposeAction failed:", (err as Error)?.message ?? err);
    }
  }

  console.log(
    `[aiAutoProposer] ${rule}@${machine}: proposed ${tool.name} to ${proposedTo.length} user(s) [${proposedTo.join(",")}]`,
  );
  return { proposed: proposedTo.length, targets: proposedTo };
}

// ─── Bus subscription lifecycle (mirrors aiWatcher start/stop) ───────────────────

let enabled = false;
const unsubscribers: Array<() => void> = [];

async function onTriggered(e: DomainEvent): Promise<void> {
  const p = (e.payload ?? {}) as { rule?: string; machine?: string };
  await runForTrigger(p, e.ts);
}

export function startAutoProposer(): void {
  if (!isAutoProposeEnabled()) return; // safe default off
  if (enabled) return;
  enabled = true;
  unsubscribers.push(eventBus.subscribe("orchestration.triggered", onTriggered));
  console.log("[aiAutoProposer] started (event bus → safe HITL write-proposals, propose-only)");
}

export function stopAutoProposer(): void {
  for (const u of unsubscribers) {
    try {
      u();
    } catch {
      /* ignore */
    }
  }
  unsubscribers.length = 0;
  lastRunByScope.clear();
  enabled = false;
}
