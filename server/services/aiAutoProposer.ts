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

// ═══════════════════════════════════════════════════════════════════════════════
// V21 (doc 27 §9 · Đợt 7.6) — PROACTIVE advisory triggers beyond ng_burst:
//   • yield_drop        → propose run_rca_analysis (RCA Copilot, analysis-only)
//   • false_call_spike  → propose request_threshold_review (advisor → approval queue)
//   • machine_drift     → propose create_maintenance_workorder (inspection check)
// Nothing on the event bus emits these signals, so a bounded periodic SWEEP
// computes them from canonical data (final yield per decision #4: OK+NTF = pass).
// Same HITL invariant: proposeAction ONLY — never confirm/execute. Each trigger is
// deduped per machine by a long cooldown (default 24h) independent of the short
// event throttle above.
// ═══════════════════════════════════════════════════════════════════════════════

export interface AdvancedTriggerConfig {
  /** Min inspections in the recent window to trust the signal. */
  minRecentSamples: number;
  /** Yield drop (percentage points, baseline − recent) that fires yield_drop. */
  yieldDropPct: number;
  /** NTF-rate multiplier vs baseline that (with the abs floor) fires false_call_spike. */
  ntfSpikeFactor: number;
  /** Min absolute NTF-rate jump (percentage points). */
  ntfSpikeMinPts: number;
  /** Cpk decline (baseline − recent) that fires machine_drift… */
  cpkDropDelta: number;
  /** …but only when the recent Cpk is actually below this floor. */
  cpkFloor: number;
}

export function advancedTriggerConfig(): AdvancedTriggerConfig {
  const n = (k: string, d: number) => {
    const v = Number(process.env[k]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return {
    minRecentSamples: n("AI_AUTO_PROPOSE_MIN_RECENT_SAMPLES", 50),
    yieldDropPct: n("AI_AUTO_PROPOSE_YIELD_DROP_PCT", 5),
    ntfSpikeFactor: n("AI_AUTO_PROPOSE_NTF_SPIKE_FACTOR", 2),
    ntfSpikeMinPts: n("AI_AUTO_PROPOSE_NTF_SPIKE_MIN_PTS", 5),
    cpkDropDelta: n("AI_AUTO_PROPOSE_CPK_DROP_DELTA", 0.3),
    cpkFloor: n("AI_AUTO_PROPOSE_CPK_FLOOR", 1.33),
  };
}

/** Sweep cadence (ms). 0 → sweep disabled. Default 30 min. */
function sweepIntervalMs(): number {
  const v = Number(process.env.AI_AUTO_PROPOSE_SWEEP_MS);
  if (Number.isFinite(v)) return Math.max(0, v);
  return 30 * 60_000;
}

/** Per-(trigger,machine) re-propose cooldown. Default 24h. */
function triggerCooldownMs(): number {
  const v = Number(process.env.AI_AUTO_PROPOSE_TRIGGER_COOLDOWN_MS);
  return Number.isFinite(v) && v > 0 ? v : 24 * 60 * 60 * 1000;
}

function maxSweepMachines(): number {
  const v = Number(process.env.AI_AUTO_PROPOSE_SWEEP_MAX_MACHINES);
  return Number.isFinite(v) && v > 0 ? Math.min(50, v) : 10;
}

const lastAdvancedProposeByScope = new Map<string, number>();

function advCooldownKey(trigger: string, machineId: number): string {
  return `${trigger}:${machineId}`;
}
function isAdvCooledDown(trigger: string, machineId: number, now: number): boolean {
  const last = lastAdvancedProposeByScope.get(advCooldownKey(trigger, machineId)) ?? 0;
  return now - last < triggerCooldownMs();
}
function markAdvProposed(trigger: string, machineId: number, now: number): void {
  lastAdvancedProposeByScope.set(advCooldownKey(trigger, machineId), now);
}

/** Test-only: clear the advanced-trigger cooldown state. */
export function __resetAdvancedTriggerStateForTests(): void {
  lastAdvancedProposeByScope.clear();
}

// ── Pure deciders (exported for tests) ───────────────────────────────────────────

export interface YieldWindowMetrics {
  recentTotal: number;
  baselineTotal: number;
  /** Canonical FINAL yield % (OK+NTF pass — decision #4). */
  recentYieldPct: number;
  baselineYieldPct: number;
}

export function decideYieldDrop(
  machineId: number,
  m: YieldWindowMetrics,
  cfg: AdvancedTriggerConfig,
): DecideResult {
  if (m.recentTotal < cfg.minRecentSamples) return { draft: null, reason: "SUB_MIN_RECENT_SAMPLES" };
  if (m.baselineTotal < cfg.minRecentSamples) return { draft: null, reason: "SUB_MIN_BASELINE_SAMPLES" };
  const drop = m.baselineYieldPct - m.recentYieldPct;
  if (!(drop >= cfg.yieldDropPct)) return { draft: null, reason: "NO_MATERIAL_YIELD_DROP" };
  return {
    draft: {
      tool: "run_rca_analysis",
      args: { machineId, defectType: "yield_drop" },
      rationale:
        `Final yield giảm ${drop.toFixed(1)} điểm % (${m.baselineYieldPct.toFixed(1)}% → ` +
        `${m.recentYieldPct.toFixed(1)}%, ${m.recentTotal} bản ghi gần đây) — đề xuất chạy RCA Copilot ` +
        `để chẩn đoán nguyên nhân (chỉ phân tích, cần bạn duyệt).`,
    },
    reason: "OK",
  };
}

export interface NtfWindowMetrics {
  recentTotal: number;
  baselineTotal: number;
  /** NTF share of inspections (%) — the false-call proxy available today. */
  recentNtfRatePct: number;
  baselineNtfRatePct: number;
  /** Operator-correction rate (%) from measurement_corrections when W7-B's table exists (else null). */
  recentCorrectionsRatePct?: number | null;
}

export function decideFalseCallSpike(
  machineId: number,
  m: NtfWindowMetrics,
  cfg: AdvancedTriggerConfig,
): DecideResult {
  if (m.recentTotal < cfg.minRecentSamples) return { draft: null, reason: "SUB_MIN_RECENT_SAMPLES" };
  if (m.baselineTotal < cfg.minRecentSamples) return { draft: null, reason: "SUB_MIN_BASELINE_SAMPLES" };
  const jumpPts = m.recentNtfRatePct - m.baselineNtfRatePct;
  const factorOk =
    m.baselineNtfRatePct <= 0
      ? m.recentNtfRatePct >= cfg.ntfSpikeMinPts
      : m.recentNtfRatePct >= m.baselineNtfRatePct * cfg.ntfSpikeFactor;
  if (!(factorOk && jumpPts >= cfg.ntfSpikeMinPts)) return { draft: null, reason: "NO_NTF_SPIKE" };
  const corrTxt =
    m.recentCorrectionsRatePct != null && Number.isFinite(m.recentCorrectionsRatePct)
      ? ` Operator sửa verdict ở ${m.recentCorrectionsRatePct.toFixed(1)}% điểm đo gần đây.`
      : "";
  return {
    draft: {
      tool: "request_threshold_review",
      args: { machineId, maxPoints: 3, note: "false-call spike (NTF-rate jump)" },
      rationale:
        `Tỷ lệ NTF (báo giả) tăng vọt: ${m.baselineNtfRatePct.toFixed(1)}% → ${m.recentNtfRatePct.toFixed(1)}% ` +
        `(+${jumpPts.toFixed(1)} điểm, ${m.recentTotal} bản ghi).${corrTxt} Đề xuất chạy Threshold Advisor ` +
        `và tạo yêu cầu duyệt ngưỡng/độ nhạy (ngưỡng chỉ đổi khi quản lý duyệt).`,
    },
    reason: "OK",
  };
}

export interface CpkTrendMetrics {
  recentCpk: number | null;
  baselineCpk: number | null;
}

export function decideMachineDrift(
  machineId: number,
  m: CpkTrendMetrics,
  cfg: AdvancedTriggerConfig,
): DecideResult {
  const recent = m.recentCpk;
  const baseline = m.baselineCpk;
  if (recent == null || baseline == null || !Number.isFinite(recent) || !Number.isFinite(baseline)) {
    return { draft: null, reason: "NO_CPK_DATA" };
  }
  const decline = baseline - recent;
  if (!(decline >= cfg.cpkDropDelta)) return { draft: null, reason: "NO_MATERIAL_CPK_DECLINE" };
  if (!(recent < cfg.cpkFloor)) return { draft: null, reason: "RECENT_CPK_STILL_GOOD" };
  return {
    draft: {
      tool: "create_maintenance_workorder",
      args: {
        machineId,
        title: `Kiểm tra drift máy #${machineId} (Cpk ${baseline.toFixed(2)} → ${recent.toFixed(2)})`,
        description:
          `Đề xuất tự động: chỉ số năng lực quá trình suy giảm ${decline.toFixed(2)} ` +
          `(baseline Cpk ${baseline.toFixed(2)} → gần đây ${recent.toFixed(2)}, dưới mục tiêu ${cfg.cpkFloor}). ` +
          `Kiểm tra hiệu chuẩn/quang học/cơ khí của máy.`,
        type: "INSPECTION",
        priority: 3,
      },
      rationale:
        `Cpk suy giảm ${decline.toFixed(2)} và đang dưới mục tiêu (${recent.toFixed(2)} < ${cfg.cpkFloor}) — ` +
        `dấu hiệu máy trôi (drift); đề xuất lệnh kiểm tra bảo trì (cần bạn duyệt).`,
    },
    reason: "OK",
  };
}

// ── Metric collection (impure, fail-safe) ────────────────────────────────────────

interface MachineSweepMetrics {
  machineId: number;
  machineCode: string;
  yield: YieldWindowMetrics;
  ntf: NtfWindowMetrics;
}

/**
 * One grouped query over product_inspections: recent window (default 24h) vs
 * trailing baseline (default prior 7d), canonical final-yield pass = OK+NTF.
 * Bounded to the busiest `maxSweepMachines()` machines. Fail-safe → [].
 */
async function collectSweepMetrics(now: Date): Promise<MachineSweepMetrics[]> {
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) return [];
    const { sql } = await import("drizzle-orm");

    const recentHours = Number(process.env.AI_AUTO_PROPOSE_RECENT_WINDOW_H) || 24;
    const baselineDays = Number(process.env.AI_AUTO_PROPOSE_BASELINE_WINDOW_D) || 7;
    const recentStart = new Date(now.getTime() - recentHours * 3600_000);
    const baselineStart = new Date(recentStart.getTime() - baselineDays * 24 * 3600_000);
    const cap = maxSweepMachines();

    const result = await (db as any).execute(sql`
      SELECT pi."machineId" AS machine_id,
             MAX(m."code") AS machine_code,
             COUNT(*) FILTER (WHERE pi."inspectionTime" >= ${recentStart}) AS recent_total,
             COUNT(*) FILTER (WHERE pi."inspectionTime" >= ${recentStart} AND pi."overallResult" IN ('OK','NTF')) AS recent_pass,
             COUNT(*) FILTER (WHERE pi."inspectionTime" >= ${recentStart} AND pi."overallResult" = 'NTF') AS recent_ntf,
             COUNT(*) FILTER (WHERE pi."inspectionTime" < ${recentStart}) AS base_total,
             COUNT(*) FILTER (WHERE pi."inspectionTime" < ${recentStart} AND pi."overallResult" IN ('OK','NTF')) AS base_pass,
             COUNT(*) FILTER (WHERE pi."inspectionTime" < ${recentStart} AND pi."overallResult" = 'NTF') AS base_ntf
      FROM product_inspections pi
      JOIN machines m ON m."id" = pi."machineId"
      WHERE pi."inspectionTime" >= ${baselineStart}
      GROUP BY pi."machineId"
      ORDER BY COUNT(*) FILTER (WHERE pi."inspectionTime" >= ${recentStart}) DESC
      LIMIT ${cap}
    `);
    const rows = ((result as { rows?: unknown[] })?.rows ?? result ?? []) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) return [];

    const pct = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0);
    return rows
      .map((r) => {
        const recentTotal = Number(r.recent_total ?? 0);
        const baseTotal = Number(r.base_total ?? 0);
        return {
          machineId: Number(r.machine_id),
          machineCode: String(r.machine_code ?? ""),
          yield: {
            recentTotal,
            baselineTotal: baseTotal,
            recentYieldPct: pct(Number(r.recent_pass ?? 0), recentTotal),
            baselineYieldPct: pct(Number(r.base_pass ?? 0), baseTotal),
          },
          ntf: {
            recentTotal,
            baselineTotal: baseTotal,
            recentNtfRatePct: pct(Number(r.recent_ntf ?? 0), recentTotal),
            baselineNtfRatePct: pct(Number(r.base_ntf ?? 0), baseTotal),
            recentCorrectionsRatePct: null,
          },
        } satisfies MachineSweepMetrics;
      })
      .filter((m) => Number.isFinite(m.machineId));
  } catch (err) {
    console.error("[aiAutoProposer] collectSweepMetrics failed:", (err as Error)?.message ?? err);
    return [];
  }
}

/**
 * Optional correction-rate signal from W7-B's measurement_corrections table —
 * read with RAW SQL (the table may not exist at runtime here). Fail-open null.
 */
async function collectCorrectionsRate(machineId: number, recentStart: Date): Promise<number | null> {
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) return null;
    const { sql } = await import("drizzle-orm");
    const result = await (db as any).execute(sql`
      SELECT
        (SELECT COUNT(*) FROM measurement_corrections mc
           JOIN measurement_results mr ON mr."id" = mc."measurementResultId"
           JOIN product_inspections pi ON pi."id" = mr."inspectionId"
          WHERE pi."machineId" = ${machineId} AND mc."createdAt" >= ${recentStart}) AS corrections,
        (SELECT COUNT(*) FROM measurement_results mr
           JOIN product_inspections pi ON pi."id" = mr."inspectionId"
          WHERE pi."machineId" = ${machineId} AND pi."inspectionTime" >= ${recentStart}) AS results
    `);
    const rows = ((result as { rows?: unknown[] })?.rows ?? result ?? []) as Array<Record<string, unknown>>;
    const row = rows[0];
    const corrections = Number(row?.corrections ?? 0);
    const results = Number(row?.results ?? 0);
    if (!(results > 0)) return null;
    return (corrections / results) * 100;
  } catch {
    return null; // table absent → honest null (NTF rate stays the signal)
  }
}

/** Cpk (defectRate control chart) for one machine over [start, end). Fail-safe null. */
async function collectCpk(machineId: number, start: Date, end: Date): Promise<number | null> {
  try {
    const { getControlChart } = await import("./aiInspectionAnalytics");
    const chart = await getControlChart({ startDate: start, endDate: end, machineId }, "defectRate");
    const cpk = chart?.summary?.cpk;
    return cpk != null && Number.isFinite(Number(cpk)) ? Number(cpk) : null;
  } catch {
    return null;
  }
}

// ── Propose plumbing shared with runForTrigger ───────────────────────────────────

async function proposeDraftToResponsibleUsers(
  draft: ProposalDraft,
  machineId: number,
): Promise<number> {
  const { getTool, isWriteTool } = await import("./aiLocalTools/toolRegistry");
  // Ensure the relevant write-tools are registered (idempotent side-effect imports).
  await import("./aiLocalTools/writeHandlers/engineering").catch(() => undefined);
  await import("./aiLocalTools/writeHandlers/maintenance").catch(() => undefined);
  await import("./aiLocalTools/writeHandlers/qualityAdvisory").catch(() => undefined);
  const tool = getTool(draft.tool);
  if (!tool || !isWriteTool(tool) || !tool.requiredPermission) return 0;

  // Defense in depth: args must pass the tool bounds BEFORE proposing.
  try {
    const parsed = (tool.parameters as { safeParse?: (a: unknown) => { success: boolean } }).safeParse?.(draft.args);
    if (parsed && !parsed.success) {
      console.warn(`[aiAutoProposer] draft args for ${draft.tool} out of bounds — skipping`);
      return 0;
    }
  } catch {
    /* tools without zod safeParse → registry-validated at propose time */
  }

  const { factoryCodeForMachine } = await import("../db/aiThresholdTune");
  const factoryCode = await factoryCodeForMachine(machineId);
  const targets = await findResponsibleUsers(factoryCode, tool.requiredPermission, maxProposalsPerRun());
  if (targets.length === 0) return 0;

  const { proposeAction } = await import("./aiCopilotActions");
  let proposed = 0;
  for (const u of targets) {
    try {
      // HITL: PROPOSE ONLY. Never confirm/execute.
      const res = await proposeAction(tool, draft.args, {
        user: { id: u.id, role: u.role, name: u.name ?? null },
        lang: "vi",
      });
      if (res.ok) proposed++;
    } catch (err) {
      console.error("[aiAutoProposer] proposeAction failed:", (err as Error)?.message ?? err);
    }
  }
  return proposed;
}

export interface AdvancedSweepStats {
  machinesConsidered: number;
  decided: number;
  proposed: number;
  byTrigger: Record<string, number>;
}

/**
 * One full advanced-trigger sweep. Flag-gated + fail-safe (never throws).
 * Deduped per (trigger, machine) by triggerCooldownMs(). PROPOSE-ONLY.
 */
export async function runAdvancedTriggerSweep(nowMs: number = Date.now()): Promise<AdvancedSweepStats> {
  const stats: AdvancedSweepStats = { machinesConsidered: 0, decided: 0, proposed: 0, byTrigger: {} };
  if (!isAutoProposeEnabled()) return stats;

  const cfg = advancedTriggerConfig();
  const now = new Date(nowMs);
  const recentHours = Number(process.env.AI_AUTO_PROPOSE_RECENT_WINDOW_H) || 24;
  const recentStart = new Date(nowMs - recentHours * 3600_000);

  const metrics = await collectSweepMetrics(now);
  stats.machinesConsidered = metrics.length;

  for (const m of metrics) {
    try {
      // 1) yield_drop → run_rca_analysis
      if (!isAdvCooledDown("yield_drop", m.machineId, nowMs)) {
        const d = decideYieldDrop(m.machineId, m.yield, cfg);
        if (d.draft) {
          stats.decided++;
          markAdvProposed("yield_drop", m.machineId, nowMs);
          const n = await proposeDraftToResponsibleUsers(d.draft, m.machineId);
          if (n > 0) {
            stats.proposed += n;
            stats.byTrigger.yield_drop = (stats.byTrigger.yield_drop ?? 0) + n;
            console.log(`[aiAutoProposer] yield_drop@${m.machineCode}: proposed run_rca_analysis to ${n} user(s)`);
          }
        }
      }

      // 2) false_call_spike → request_threshold_review
      if (!isAdvCooledDown("false_call_spike", m.machineId, nowMs)) {
        const ntf: NtfWindowMetrics = {
          ...m.ntf,
          recentCorrectionsRatePct: await collectCorrectionsRate(m.machineId, recentStart),
        };
        const d = decideFalseCallSpike(m.machineId, ntf, cfg);
        if (d.draft) {
          stats.decided++;
          markAdvProposed("false_call_spike", m.machineId, nowMs);
          const n = await proposeDraftToResponsibleUsers(d.draft, m.machineId);
          if (n > 0) {
            stats.proposed += n;
            stats.byTrigger.false_call_spike = (stats.byTrigger.false_call_spike ?? 0) + n;
            console.log(`[aiAutoProposer] false_call_spike@${m.machineCode}: proposed request_threshold_review to ${n} user(s)`);
          }
        }
      }

      // 3) machine_drift → create_maintenance_workorder (Cpk trend; PSI drift monitor
      //    is model-scoped, not machine-scoped — honest fallback per doc 27 V21).
      if (!isAdvCooledDown("machine_drift", m.machineId, nowMs)) {
        const baselineDays = Number(process.env.AI_AUTO_PROPOSE_BASELINE_WINDOW_D) || 7;
        const baselineStart = new Date(recentStart.getTime() - baselineDays * 24 * 3600_000);
        // Sequential on purpose: bounded work (≤ maxSweepMachines), and concurrent
        // dynamic imports of the same module can race module-registry interception.
        const recentCpk = await collectCpk(m.machineId, recentStart, now);
        const baselineCpk = await collectCpk(m.machineId, baselineStart, recentStart);
        const d = decideMachineDrift(m.machineId, { recentCpk, baselineCpk }, cfg);
        if (d.draft) {
          stats.decided++;
          markAdvProposed("machine_drift", m.machineId, nowMs);
          const n = await proposeDraftToResponsibleUsers(d.draft, m.machineId);
          if (n > 0) {
            stats.proposed += n;
            stats.byTrigger.machine_drift = (stats.byTrigger.machine_drift ?? 0) + n;
            console.log(`[aiAutoProposer] machine_drift@${m.machineCode}: proposed create_maintenance_workorder to ${n} user(s)`);
          }
        }
      }
    } catch (err) {
      console.error(`[aiAutoProposer] sweep machine#${m.machineId} failed:`, (err as Error)?.message ?? err);
    }
  }
  return stats;
}

// ─── Bus subscription lifecycle (mirrors aiWatcher start/stop) ───────────────────

let enabled = false;
const unsubscribers: Array<() => void> = [];
let sweepTimer: NodeJS.Timeout | null = null;

async function onTriggered(e: DomainEvent): Promise<void> {
  const p = (e.payload ?? {}) as { rule?: string; machine?: string };
  await runForTrigger(p, e.ts);
}

export function startAutoProposer(): void {
  if (!isAutoProposeEnabled()) return; // safe default off
  if (enabled) return;
  enabled = true;
  unsubscribers.push(eventBus.subscribe("orchestration.triggered", onTriggered));

  // V21 — periodic advanced-trigger sweep (yield_drop / false_call_spike /
  // machine_drift). Bounded + cooldown-deduped; AI_AUTO_PROPOSE_SWEEP_MS=0 disables.
  const interval = sweepIntervalMs();
  if (interval > 0) {
    sweepTimer = setInterval(() => {
      runAdvancedTriggerSweep().catch((err) =>
        console.error("[aiAutoProposer] advanced sweep failed:", (err as Error)?.message ?? err),
      );
    }, interval);
    if (typeof sweepTimer.unref === "function") sweepTimer.unref();
  }

  console.log(
    `[aiAutoProposer] started (event bus → safe HITL write-proposals, propose-only` +
      `${interval > 0 ? `; advanced sweep every ${Math.round(interval / 60000)}m` : "; advanced sweep off"})`,
  );
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
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  lastRunByScope.clear();
  lastAdvancedProposeByScope.clear();
  enabled = false;
}
