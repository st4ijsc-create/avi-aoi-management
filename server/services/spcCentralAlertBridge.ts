/**
 * W5-A — Bridge SPC out-of-control (OOC) violations into the CENTRAL alert / Andon path.
 *
 * Background: SPC OOC detection (utils/spcRules.detectSpcViolations + utils/spc batch
 * rules) already persists `mp_spc_alerts` and fans out to SPC-ONLY sinks
 * (utils/spcAlertSink: console/webhook/mqtt/socket). It never reached the unified
 * alerting surface — aiSmartAlertRouter (predictive_alerts + in-app/email notify) and
 * andonService had ZERO SPC references, so an OOC condition never created a central
 * Alert or an Andon.
 *
 * This bridge closes that gap. When the analyze path detects + persists an OOC, it also
 * routes the violation through aiSmartAlertRouter.routeAlert (→ predictive_alerts + notify)
 * and, for CRITICAL violations, can raise an advisory Andon.
 *
 * SAFETY / BEHAVIOUR:
 *   - FLAG-GATED, default OFF: set SPC_CENTRAL_ALERT_ENABLED=true to activate routing.
 *     Andon raising is additionally gated by SPC_CENTRAL_ALERT_ANDON (default OFF).
 *   - Best-effort / fire-and-forget: never throws to the caller, never blocks the
 *     analyze mutation response.
 *   - De-dup: an in-memory (pointDefId, ruleCode) cooldown suppresses sample storms so a
 *     flood of samples does not spam the central surface. routeAlert's own Redis
 *     consolidation window is a second safety net.
 */

import type { SpcViolation } from "../utils/spcRules";

export interface SpcCentralAlertContext {
  pointDefId: number;
  /** Optional human label for the measurement point (used in the alert message). */
  pointName?: string;
  productModelId?: number | null;
  machineId?: number | null;
  factoryId?: number | null;
}

// ─── Flags ───────────────────────────────────────────────────────────────────

function envTrue(v: string | undefined): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "on";
}

/** Master flag — must be ON for any central routing to happen (default OFF). */
export function isSpcCentralAlertEnabled(): boolean {
  return envTrue(process.env.SPC_CENTRAL_ALERT_ENABLED);
}

/** Secondary flag — raise an advisory Andon for CRITICAL OOC (default OFF). */
function isSpcCentralAndonEnabled(): boolean {
  return envTrue(process.env.SPC_CENTRAL_ALERT_ANDON);
}

// ─── Rule → severity mapping ───────────────────────────────────────────────────
//
// SPC violations carry severity "warn" | "critical" (spcRules). WE_1 (single point
// beyond ±3σ — the "Nelson 1" condition) and EWMA_OOC are "critical"; all pattern
// rules (runs, trends, 2-of-3, stratification, …) are "warn".
//
// Central scale is LOW | MEDIUM | HIGH | CRITICAL. Per spec, WE1/Nelson1-class
// (critical) OOC maps to HIGH; pattern warns map to MEDIUM. We deliberately do NOT
// emit central CRITICAL from SPC alone — a control-chart signal is advisory, not a
// hard line-stop.
function spcSeverityToCentral(sev: SpcViolation["severity"]): "MEDIUM" | "HIGH" {
  return sev === "critical" ? "HIGH" : "MEDIUM";
}

// ─── De-dup cooldown ───────────────────────────────────────────────────────────

const COOLDOWN_MS = (() => {
  const n = Number(process.env.SPC_CENTRAL_ALERT_COOLDOWN_MS);
  return Number.isFinite(n) && n > 0 ? n : 5 * 60 * 1000; // default 5 min
})();

// key = `${pointDefId}:${ruleCode}` → last routed epoch ms. Process-local; a
// best-effort storm suppressor (routeAlert's Redis consolidation is the durable net).
const lastRoutedAt = new Map<string, number>();

function withinCooldown(key: string, now: number): boolean {
  const prev = lastRoutedAt.get(key);
  if (prev != null && now - prev < COOLDOWN_MS) return true;
  lastRoutedAt.set(key, now);
  // Opportunistic prune so the map cannot grow unbounded.
  if (lastRoutedAt.size > 5000) {
    for (const [k, t] of lastRoutedAt) {
      if (now - t > COOLDOWN_MS) lastRoutedAt.delete(k);
    }
  }
  return false;
}

// ─── Bridge ────────────────────────────────────────────────────────────────────

/**
 * Route a single SPC violation to the central alert engine (+ optional advisory Andon).
 * Best-effort: swallows all errors. No-op unless SPC_CENTRAL_ALERT_ENABLED is set.
 */
export async function routeSpcViolationToCentral(
  violation: SpcViolation,
  ctx: SpcCentralAlertContext,
): Promise<void> {
  if (!isSpcCentralAlertEnabled()) return;

  const now = Date.now();
  const key = `${ctx.pointDefId}:${violation.ruleCode}`;
  if (withinCooldown(key, now)) return;

  const severity = spcSeverityToCentral(violation.severity);
  const label = ctx.pointName
    ? `${ctx.pointName} (point #${ctx.pointDefId})`
    : `measurement point #${ctx.pointDefId}`;
  const windowFrom = new Date(violation.windowFrom).toISOString();
  const windowTo = new Date(violation.windowTo).toISOString();
  const message =
    `SPC out-of-control: ${violation.ruleName} on ${label} ` +
    `[${violation.sampleIds.length} sample(s), ${windowFrom} → ${windowTo}]`;

  // Central alert (predictive_alerts + in-app/email notify). We reuse the existing
  // QUALITY_DEGRADATION alert type (routes to admins + supervisors, which is the
  // right audience for an OOC) — the SPC specifics live in `data`.
  try {
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({
      type: "QUALITY_DEGRADATION",
      machineId: ctx.machineId ?? undefined,
      factoryId: ctx.factoryId ?? undefined,
      productModelId: ctx.productModelId ?? undefined,
      severity,
      message,
      data: {
        source: "spc_violation",
        pointDefId: ctx.pointDefId,
        ruleCode: violation.ruleCode,
        ruleName: violation.ruleName,
        spcSeverity: violation.severity,
        sampleIds: violation.sampleIds,
        windowFrom,
        windowTo,
        summary: violation.summary ?? null,
      },
    });
  } catch (err) {
    console.error("[spcCentralBridge] routeAlert failed:", (err as Error)?.message ?? err);
  }

  // Advisory Andon for CRITICAL OOC only, and only when explicitly opted in.
  if (violation.severity === "critical" && isSpcCentralAndonEnabled()) {
    try {
      const { raiseAndon } = await import("./andon/andonService");
      await raiseAndon({
        state: "red",
        reason: "quality",
        title: `SPC OOC: ${violation.ruleName}`,
        message,
        machineId: ctx.machineId ?? null,
        raisedBySystem: true,
      });
    } catch (err) {
      console.error("[spcCentralBridge] raiseAndon failed:", (err as Error)?.message ?? err);
    }
  }
}

/**
 * Batch entry point for the analyze path. Synchronous / fire-and-forget: schedules the
 * per-violation routing without blocking the caller and returns immediately. No-op
 * unless the master flag is enabled.
 */
export function routeSpcViolationsToCentral(
  violations: SpcViolation[],
  ctx: SpcCentralAlertContext,
): void {
  if (!isSpcCentralAlertEnabled()) return;
  if (!violations || violations.length === 0) return;
  for (const v of violations) {
    void routeSpcViolationToCentral(v, ctx).catch(() => undefined);
  }
}
