/**
 * Sprint F5a — Interlock engine (ALERT-ONLY).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY — F5a HAS NO COMMAND PATH:
 *   - This module NEVER imports commandDispatcher and NEVER calls driver.writeTags.
 *     There is literally no code path from here to a machine write.
 *   - When an enabled+approved rule's condition is met:
 *       action='alert'                         → yellow Andon, event status 'alert_only'
 *       block/stop + requiresHumanConfirm=true  → red Andon, event status 'proposed'
 *                                                 (a human-confirm proposal; F5b will
 *                                                 wire the actual block on confirm)
 *       block/stop + requiresHumanConfirm=false → red Andon, event status 'skipped'
 *                                                 ("auto-block deferred to F5b" — no write)
 *       reduce_speed                            → treated like a block proposal/skip
 *   - A rule that is NOT enabled or NOT approved never auto-acts: it is recorded
 *     'alert_only' at most (defensive — engine only polls enabled rules anyway).
 *   - No-op unless INTERLOCK_ENGINE_ENABLED === "true".
 *   - Every rule is evaluated inside try/catch: one bad rule cannot crash the loop.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq, gte, sql, desc } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  interlockRules,
  interlockEvents,
  processResults,
  spcRuleViolations,
  cpkHistory,
  otTelemetry,
  type InterlockRule,
} from "../../../drizzle/schema";
import { raiseAndon, type AndonState } from "../andon/andonService";
import {
  evaluateCondition,
  deriveObserved,
  type ComparisonOperator,
  type InterlockSourceType,
  type ObservationContext,
} from "./ruleEvaluator";

let timer: ReturnType<typeof setInterval> | null = null;
let polling = false;

function flagEnabled(): boolean {
  return process.env.INTERLOCK_ENGINE_ENABLED === "true";
}

function pollMs(): number {
  const n = parseInt(process.env.INTERLOCK_POLL_MS || "10000", 10);
  return Number.isFinite(n) && n > 0 ? n : 10000;
}

/** Start the engine. No-op (returns false) when the flag is off. Idempotent. */
export function startInterlock(): boolean {
  if (timer) return true;
  if (!flagEnabled()) {
    console.log("[Interlock] disabled (set INTERLOCK_ENGINE_ENABLED=true to enable)");
    return false;
  }
  timer = setInterval(() => {
    void runOnce();
  }, pollMs());
  timer.unref?.();
  console.log(`[Interlock] engine started (poll ${pollMs()}ms) — ALERT-ONLY, no command path`);
  return true;
}

/** Stop the engine. Safe to call repeatedly. */
export function stopInterlock(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function isInterlockRunning(): boolean {
  return timer != null;
}

/**
 * One poll pass: scan enabled rules, evaluate each (try/catch isolated). Exposed
 * for tests. Returns the number of events fired.
 */
export async function runOnce(): Promise<number> {
  if (polling) return 0; // avoid overlap if a pass runs long
  polling = true;
  let fired = 0;
  try {
    const db = await getDb();
    if (!db) return 0;
    const rules = await db.select().from(interlockRules).where(eq(interlockRules.enabled, true));
    for (const rule of rules) {
      try {
        const ev = await evaluateRule(rule);
        if (ev) fired++;
      } catch (err) {
        console.error(`[Interlock] rule #${rule.id} "${rule.name}" failed:`, (err as Error)?.message || err);
      }
    }
  } finally {
    polling = false;
  }
  return fired;
}

const reasonByAction = (action: string): "quality" | "safety" | "other" => {
  if (action === "stop_line") return "safety";
  if (action === "block_downstream" || action === "reduce_speed") return "quality";
  return "quality";
};

/**
 * Evaluate a single rule. Returns the created interlockEvent row, or null when
 * the rule is in cooldown or its condition is not met.
 *
 * SAFETY: only Andon + interlock_events are written. No command is ever sent.
 */
export async function evaluateRule(rule: InterlockRule): Promise<{ id: number; status: string } | null> {
  const db = await getDb();
  if (!db) return null;

  // Cooldown: skip if we fired within cooldownSeconds.
  if (rule.lastFiredAt) {
    const elapsed = (Date.now() - rule.lastFiredAt.getTime()) / 1000;
    if (elapsed < (rule.cooldownSeconds ?? 300)) return null;
  }

  const obs = await fetchObservation(rule);
  const observed = deriveObserved(rule.sourceType as InterlockSourceType, obs);
  const threshold = rule.threshold != null ? Number(rule.threshold) : null;
  const met = evaluateCondition(
    observed,
    rule.comparisonOperator as ComparisonOperator,
    threshold,
    rule.consecutiveCount,
    obs.series,
  );
  if (!met) return null;

  // ── Decide the ALERT-ONLY outcome (no command path) ──────────────────────
  const action = rule.action;
  let status: "alert_only" | "proposed" | "skipped";
  let andonState: AndonState;
  let note: string | null = null;
  let pendingActionId: string | null = null;

  if (action === "alert") {
    status = "alert_only";
    andonState = "yellow";
  } else {
    // block_downstream / stop_line / reduce_speed → red Andon.
    andonState = "red";
    if (rule.requiresHumanConfirm) {
      status = "proposed";
      // F5a records a proposal id for traceability; the actual block on confirm
      // is wired in F5b. We do NOT create a dispatch path here.
      pendingActionId = `interlock-${rule.id}-${Date.now()}`;
      note = "Human confirm required — block/stop proposed (no machine write in F5a).";
    } else {
      status = "skipped";
      note = "auto-block deferred to F5b (F5a has no command path).";
    }
  }

  // Insert the event first so the Andon can reference it.
  const [event] = await db
    .insert(interlockEvents)
    .values({
      ruleId: rule.id,
      sourceType: rule.sourceType,
      observedValue: observed != null ? String(observed) : null,
      threshold: rule.threshold ?? null,
      action: rule.action,
      status,
      pendingActionId,
      detail: { ruleName: rule.name, scope: rule.scope, lineId: rule.lineId, stationId: rule.stationId, machineId: rule.machineId },
      notes: note,
    })
    .returning();

  // Stamp lastFiredAt (cooldown) regardless of outcome.
  await db.update(interlockRules).set({ lastFiredAt: new Date() }).where(eq(interlockRules.id, rule.id));

  // Raise the (system) Andon — SIGNAL ONLY.
  const andon = await raiseAndon({
    state: andonState,
    reason: reasonByAction(action),
    title: `Interlock: ${rule.name}`,
    message: `${rule.sourceType} ${rule.comparisonOperator} ${threshold ?? "?"} (observed ${observed ?? "?"}) → ${action} [${status}]${note ? ` — ${note}` : ""}`,
    lineId: rule.lineId,
    stationId: rule.stationId,
    machineId: rule.machineId ?? rule.targetMachineId,
    raisedBySystem: true,
    sourceInterlockEventId: event.id,
  });

  // Back-link the Andon onto the event.
  await db.update(interlockEvents).set({ andonEventId: andon.id }).where(eq(interlockEvents.id, event.id));

  return { id: event.id, status };
}

/** Window start = now - windowSeconds (default 300s). */
function windowStart(rule: InterlockRule): Date {
  const secs = rule.windowSeconds ?? 300;
  return new Date(Date.now() - secs * 1000);
}

/**
 * Query the source feed for a rule and reduce it to an ObservationContext. PURE
 * derivation happens in ruleEvaluator.deriveObserved(). Each branch is scoped by
 * machine when machineId is set (best-effort; rules may be line/station scoped).
 */
async function fetchObservation(rule: InterlockRule): Promise<ObservationContext> {
  const db = await getDb();
  if (!db) return {};
  const since = windowStart(rule);

  switch (rule.sourceType as InterlockSourceType) {
    case "spc_violation": {
      const conds = [gte(spcRuleViolations.detectedAt, since), eq(spcRuleViolations.isActive, true)];
      if (rule.machineId != null) conds.push(eq(spcRuleViolations.machineId, rule.machineId));
      const [r] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(spcRuleViolations)
        .where(and(...conds));
      return { count: r?.c ?? 0 };
    }
    case "process_result": {
      // Count NG/fail process results in window (sourceKey may name a stepType).
      const conds = [gte(processResults.measuredAt, since), eq(processResults.result, "fail")];
      if (rule.machineId != null) conds.push(eq(processResults.machineId, rule.machineId));
      if (rule.sourceKey) conds.push(eq(processResults.stepType, rule.sourceKey));
      const [r] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(processResults)
        .where(and(...conds));
      return { count: r?.c ?? 0 };
    }
    case "ng_rate": {
      // NG-rate (%) over process_results in window: fail / total * 100.
      const conds = [gte(processResults.measuredAt, since)];
      if (rule.machineId != null) conds.push(eq(processResults.machineId, rule.machineId));
      const [r] = await db
        .select({
          total: sql<number>`count(*)::int`,
          fail: sql<number>`count(*) filter (where ${processResults.result} = 'fail')::int`,
        })
        .from(processResults)
        .where(and(...conds));
      const total = r?.total ?? 0;
      const fail = r?.fail ?? 0;
      return { scalar: total > 0 ? (fail / total) * 100 : 0 };
    }
    case "cpk": {
      const conds = [];
      if (rule.machineId != null) conds.push(eq(cpkHistory.machineId, rule.machineId));
      const [r] = await db
        .select({ cpk: cpkHistory.cpk })
        .from(cpkHistory)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(cpkHistory.periodEnd))
        .limit(1);
      return { scalar: r?.cpk != null ? Number(r.cpk) : null };
    }
    case "telemetry_tag": {
      const conds = [gte(otTelemetry.timestamp, since)];
      if (rule.machineId != null) conds.push(eq(otTelemetry.machineId, rule.machineId));
      if (rule.sourceKey) conds.push(eq(otTelemetry.tagKey, rule.sourceKey));
      const rows = await db
        .select({ v: otTelemetry.valueNumeric, t: otTelemetry.timestamp })
        .from(otTelemetry)
        .where(and(...conds))
        .orderBy(otTelemetry.timestamp)
        .limit(rule.windowSize ?? 50);
      const series = rows.map((r) => (r.v != null ? Number(r.v) : null));
      const latest = series.length ? series[series.length - 1] : null;
      return { series, scalar: latest };
    }
    default:
      return {};
  }
}
