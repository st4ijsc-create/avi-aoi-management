/**
 * Quality Gate Evaluator (P0-D) — realtime, auto-firing quality-gate engine.
 *
 * BUG FIXED: previously quality gates were query-only (`qualityGateRouter.evaluate`
 * computed a value but persisted nothing) and gate events were only ever created
 * by the manual `triggerEvent` mutation. There was NO hook evaluating gates after
 * an inspection result landed, so pause/stop actions were dead metadata and gates
 * never auto-fired.
 *
 * This service is called fire-and-forget AFTER an inspection (and its measurement
 * results) are persisted, from BOTH ingest paths:
 *   - aoiPackageRouter.commit       (AOI-ZIP ingest)
 *   - machineApiRouter.submitInspection (HTTP ingest)
 *
 * GUARANTEES
 *  - Non-blocking: the public entry point never throws; all DB/socket work is
 *    wrapped in try/catch with honest logging. A failure here MUST NOT fail the
 *    inspection insert.
 *  - Idempotent: while a gate already has an `active` event it will not create a
 *    second one (de-dupe), and a configurable re-arm cooldown prevents event
 *    storms on every subsequent inspection.
 *  - Honest: it logs what it evaluated, what breached, and what action it took.
 *
 * The breach metric computation mirrors `qualityGateRouter.evaluate` exactly so
 * the manual evaluate endpoint and this realtime engine agree.
 */

import { getDb } from "../db/connection";
import { and, eq, desc } from "drizzle-orm";
import {
  qualityGates,
  qualityGateEvents,
  productInspections,
  cpkHistory,
  machines,
  type QualityGate,
} from "../../drizzle/schema";

// ─── Tunables ─────────────────────────────────────────────────────────────────
// Re-arm window: once a gate fires, ignore further breaches for this many minutes
// (unless its event is resolved). Prevents one bad batch from spamming events.
const GATE_REARM_COOLDOWN_MINUTES = Number(
  process.env.QUALITY_GATE_REARM_COOLDOWN_MINUTES ?? "15",
);

export interface GateEvaluationContext {
  machineId: number;
  inspectionId: number;
  productModelId?: number | null;
  lineId?: number | null;
  /** station owning the machine — used only for hierarchy/alert context */
  stationId?: number | null;
}

/**
 * Public, fire-and-forget entry point. Safe to `void` — never throws.
 * Evaluates every active gate whose scope matches this inspection and fires
 * breaching ones (event + action + emit).
 */
export async function evaluateGatesAfterInspection(
  ctx: GateEvaluationContext,
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    // Gather candidate active gates whose scope is satisfied by this inspection.
    // A gate with a null scope field matches anything; a non-null field must equal
    // the inspection's corresponding value.
    const gates = await db
      .select()
      .from(qualityGates)
      .where(eq(qualityGates.isActive, true));

    const applicable = gates.filter((g) => gateMatchesScope(g, ctx));
    if (applicable.length === 0) return;

    for (const gate of applicable) {
      try {
        await evaluateSingleGate(db, gate, ctx);
      } catch (err) {
        // One gate failing must not stop the others.
        console.error(
          `[QualityGate] Evaluation failed for gate #${gate.id} (${gate.name}):`,
          (err as Error)?.message ?? err,
        );
      }
    }
  } catch (err) {
    // Top-level guard — this path must never bubble into the ingest mutation.
    console.error(
      "[QualityGate] evaluateGatesAfterInspection failed:",
      (err as Error)?.message ?? err,
    );
  }
}

/** A gate applies when each of its non-null scope fields matches the inspection. */
function gateMatchesScope(gate: QualityGate, ctx: GateEvaluationContext): boolean {
  if (gate.machineId != null && gate.machineId !== ctx.machineId) return false;
  if (
    gate.productModelId != null &&
    gate.productModelId !== (ctx.productModelId ?? -1)
  )
    return false;
  if (gate.lineId != null && gate.lineId !== (ctx.lineId ?? -1)) return false;
  // workstationId on the gate isn't carried on productInspections, so we do not
  // filter on it here (a workstation-scoped gate still evaluates by machine/product).
  return true;
}

async function evaluateSingleGate(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  gate: QualityGate,
  ctx: GateEvaluationContext,
): Promise<void> {
  // ── Idempotency / de-dupe ────────────────────────────────────────────────
  // If this gate already has an active event, do nothing (one open breach at a
  // time). Also honor a re-arm cooldown measured from the most recent event so a
  // single bad run doesn't emit on every inspection.
  const [lastEvent] = await db
    .select()
    .from(qualityGateEvents)
    .where(eq(qualityGateEvents.qualityGateId, gate.id))
    .orderBy(desc(qualityGateEvents.triggeredAt))
    .limit(1);

  if (lastEvent) {
    if (lastEvent.status === "active") return; // already firing
    const cooldownMs = GATE_REARM_COOLDOWN_MINUTES * 60 * 1000;
    const elapsed = Date.now() - new Date(lastEvent.triggeredAt).getTime();
    if (elapsed < cooldownMs) return; // still cooling down after a recent fire
  }

  const evalResult = await computeGateValue(db, gate, ctx);
  if (evalResult == null) return; // not enough data / unsupported
  if (!evalResult.triggered) return;

  // ── BREACH: persist a gate event (this is the part that was missing) ──────
  const action = gate.action; // 'alert' | 'pause' | 'stop'
  const [event] = await db
    .insert(qualityGateEvents)
    .values({
      qualityGateId: gate.id,
      triggerValue: String(round4(evalResult.currentValue)),
      threshold: gate.threshold,
      action,
      status: "active",
      machineId: ctx.machineId,
      affectedCount: evalResult.windowSize ?? 0,
      notes:
        `Auto-fired by realtime evaluator: ${gate.gateType} = ` +
        `${round4(evalResult.currentValue)} ${gate.comparisonOperator} ${gate.threshold}` +
        ` (window=${evalResult.windowSize ?? 0}, inspection #${ctx.inspectionId})`,
    })
    .returning();

  console.warn(
    `[QualityGate] 🚧 BREACH gate #${gate.id} "${gate.name}" — ` +
      `${gate.gateType}=${round4(evalResult.currentValue)} ${gate.comparisonOperator} ${gate.threshold}; ` +
      `action=${action}; eventId=${event?.id}`,
  );

  // ── Enforce the configured action ─────────────────────────────────────────
  // pause/stop persist the machine operational state so the consequence is real,
  // not just metadata. Each step is independently guarded so a socket/DB hiccup
  // can't prevent the others.
  if (action === "pause" || action === "stop") {
    try {
      // operationStatusEnum has no dedicated "paused"; map pause→maintenance
      // (operator-attended hold) and stop→stopped.
      const newStatus = action === "stop" ? "stopped" : "maintenance";
      await db
        .update(machines)
        .set({ operationStatus: newStatus as any, updatedAt: new Date() })
        .where(eq(machines.id, ctx.machineId));
    } catch (err) {
      console.error(
        `[QualityGate] Failed to persist ${action} state for machine #${ctx.machineId}:`,
        (err as Error)?.message ?? err,
      );
    }
  }

  // ── Realtime + alert path ─────────────────────────────────────────────────
  emitGateEvent(gate, evalResult, ctx, event?.id);
}

/**
 * Compute the gate's current value + triggered flag. Mirrors the logic in
 * qualityGateRouter.evaluate so manual + realtime evaluation are consistent.
 */
async function computeGateValue(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  gate: QualityGate,
  ctx: GateEvaluationContext,
): Promise<
  | {
      triggered: boolean;
      currentValue: number;
      windowSize: number;
    }
  | null
> {
  const threshold = Number(gate.threshold);

  // cpk_threshold is sourced from the latest cpk_history row in scope, not the
  // inspection window (CPK is computed periodically by the SPC pipeline).
  if (gate.gateType === "cpk_threshold") {
    const conds = [];
    if (gate.machineId) conds.push(eq(cpkHistory.machineId, gate.machineId));
    if (gate.productModelId)
      conds.push(eq(cpkHistory.productModelId, gate.productModelId));
    const [latest] = await db
      .select({ cpk: cpkHistory.cpk })
      .from(cpkHistory)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(cpkHistory.periodEnd))
      .limit(1);
    if (!latest?.cpk) return null;
    const currentValue = Number(latest.cpk);
    return {
      triggered: compare(currentValue, gate.comparisonOperator, threshold),
      currentValue,
      windowSize: 1,
    };
  }

  // Window-based gate types operate over the most recent N inspections in scope.
  const conds = [];
  if (gate.machineId) conds.push(eq(productInspections.machineId, gate.machineId));
  if (gate.productModelId)
    conds.push(eq(productInspections.productModelId, gate.productModelId));

  const windowSize = gate.windowSize ?? 100;
  const recent = await db
    .select({ overallResult: productInspections.overallResult })
    .from(productInspections)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(productInspections.inspectionTime))
    .limit(windowSize);

  const total = recent.length;
  if (total === 0) return null;

  const ngCount = recent.filter((r) => r.overallResult === "NG").length;
  const yieldRate = ((total - ngCount) / total) * 100;
  const ngRate = (ngCount / total) * 100;

  let consecutiveNG = 0;
  for (const r of recent) {
    if (r.overallResult === "NG") consecutiveNG++;
    else break;
  }

  let currentValue: number;
  switch (gate.gateType) {
    case "yield_rate":
      currentValue = yieldRate;
      break;
    case "ng_count":
      currentValue = ngCount;
      break;
    case "ng_rate":
      currentValue = ngRate;
      break;
    case "consecutive_ng":
      currentValue = consecutiveNG;
      break;
    default:
      return null;
  }

  return {
    triggered: compare(currentValue, gate.comparisonOperator, threshold),
    currentValue,
    windowSize: total,
  };
}

function compare(value: number, op: string, threshold: number): boolean {
  switch (op) {
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "eq":
      return value === threshold;
    default:
      return false;
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Emit the breach to realtime + alert consumers. SIGNAL ONLY — never writes to a
 * machine. Reuses the existing SPC-violation socket channel + internal event bus
 * so dashboards and the alert pipeline already subscribed to those see it without
 * a new transport.
 *
 * TODO(P0-E alert bus): when the unified Alert Bus / dispatcher lands, also push a
 * first-class alert here (e.g. alertDispatch.raise({ source: 'quality_gate', ... }))
 * with notifyRoles routing. For now we emit via the SPC violation channel + event
 * bus, which the current notification/escalation services already consume.
 */
function emitGateEvent(
  gate: QualityGate,
  result: { currentValue: number; windowSize: number },
  ctx: GateEvaluationContext,
  eventId?: number,
): void {
  try {
    // Lazy import avoids a socket↔db import cycle at module load.
    void import("../_core/socket")
      .then(({ emitSpcViolationAlert }) => {
        emitSpcViolationAlert({
          ruleId: `quality_gate:${gate.id}`,
          ruleName: `Quality Gate: ${gate.name}`,
          severity: gate.action === "stop" ? "critical" : "warning",
          metric: gate.gateType,
          machineId: ctx.machineId,
          pointIndices: [],
          violationCount: 1,
          detectedAt: new Date(),
          message:
            `Quality gate "${gate.name}" breached: ${gate.gateType}=` +
            `${round4(result.currentValue)} ${gate.comparisonOperator} ${gate.threshold} ` +
            `→ action=${gate.action} (event #${eventId ?? "?"})`,
        });
      })
      .catch((err) =>
        console.error(
          "[QualityGate] socket emit import failed:",
          (err as Error)?.message ?? err,
        ),
      );

    // Also publish a dedicated domain event so future alert-bus consumers can
    // subscribe by type without parsing the SPC channel.
    void import("../_core/eventBus")
      .then(({ eventBus }) => {
        eventBus.publish(
          "quality_gate.breach",
          {
            gateId: gate.id,
            gateName: gate.name,
            gateType: gate.gateType,
            action: gate.action,
            currentValue: round4(result.currentValue),
            threshold: Number(gate.threshold),
            machineId: ctx.machineId,
            lineId: ctx.lineId ?? null,
            inspectionId: ctx.inspectionId,
            eventId: eventId ?? null,
            triggeredAt: new Date(),
          },
          "qualityGateEvaluator",
        );
      })
      .catch(() => {
        /* event bus is best-effort */
      });
  } catch (err) {
    console.error(
      "[QualityGate] emitGateEvent failed:",
      (err as Error)?.message ?? err,
    );
  }
}