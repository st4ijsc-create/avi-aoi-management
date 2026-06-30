/**
 * R0-2 (doc 16 §9 Khối 4) — Predictive risk → auto maintenance work-order.
 *
 * Closes the loop "PdM risk → maintenanceWorkOrder". When the predictive
 * maintenance cycle scores a machine ABOVE the alert threshold, this creates a
 * PREDICTIVE / OPEN work order populated with risk / confidence / predicted
 * timeframe — so a high-risk machine produces an actionable WO automatically.
 *
 * ── DESIGN ───────────────────────────────────────────────────────────────────
 *   • Gated behind PDM_AUTO_WORKORDER_ENABLED (default false). No-op when off.
 *   • IDEMPOTENT: skips creation when an OPEN / SCHEDULED (also IN_PROGRESS /
 *     ON_HOLD) PREDICTIVE work order already exists for that machine — so a
 *     machine that stays at-risk across many cycles yields ONE work order, not one
 *     per cycle.
 *   • Hooked into runPredictiveMaintenanceCycle (the async analytics path) — never
 *     on a control/critical path. Fail-safe: errors are isolated per machine.
 *
 * Distinct from the older orphaned pdmWorkOrderService.ts (which polls
 * machine_health_history on its own timer and is not started anywhere). This one
 * runs inline on actual risk computation behind its own flag — no extra timer.
 */
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "../logger";
import { maintenanceWorkOrders } from "../../drizzle/schema";
import type { FailureRiskResult } from "./predictiveMaintenanceService";

export const AUTO_WORKORDER_ENABLED_FLAG = "PDM_AUTO_WORKORDER_ENABLED";

/** Open-ish statuses that should suppress a duplicate predictive work order. */
const OPEN_WO_STATUSES = ["OPEN", "SCHEDULED", "IN_PROGRESS", "ON_HOLD"] as const;

/** True when the auto-work-order feature flag is on. */
export function isAutoWorkOrderEnabled(): boolean {
  return process.env[AUTO_WORKORDER_ENABLED_FLAG] === "true";
}

function mapUrgencyToPriority(urgency: FailureRiskResult["maintenanceUrgency"]): number {
  switch (urgency) {
    case "CRITICAL": return 1;
    case "HIGH": return 2;
    case "MEDIUM": return 3;
    case "LOW": return 4;
    default: return 3;
  }
}

/**
 * Create a PREDICTIVE / OPEN work order for a machine from its risk result, IF
 * the auto flag is on AND no open predictive work order already exists for it.
 *
 * @returns true when a new work order was inserted, false otherwise (flag off /
 *          DB absent / duplicate suppressed / error). Never throws.
 */
export async function maybeCreatePredictiveWorkOrder(
  machine: { id: number; code?: string | null },
  risk: FailureRiskResult,
  opts: { healthScore?: number | null } = {},
): Promise<boolean> {
  if (!isAutoWorkOrderEnabled()) return false;

  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) return false;

    // Idempotency: an existing open PREDICTIVE WO for this machine suppresses a new one.
    const existing = await db
      .select({ id: maintenanceWorkOrders.id })
      .from(maintenanceWorkOrders)
      .where(
        and(
          eq(maintenanceWorkOrders.machineId, machine.id),
          eq(maintenanceWorkOrders.type, "PREDICTIVE"),
          inArray(maintenanceWorkOrders.status, OPEN_WO_STATUSES as unknown as any),
        ),
      )
      .limit(1);

    if (existing.length > 0) return false;

    const woNumber = `WO-PDM-${machine.id}-${Date.now()}`;
    const code = machine.code ?? String(machine.id);
    const timeframe = risk.predictedTimeframe ?? "soon";

    await db.insert(maintenanceWorkOrders).values({
      workOrderNumber: woNumber,
      machineId: machine.id,
      machineCode: machine.code ?? undefined,
      type: "PREDICTIVE",
      status: "OPEN",
      trigger: "PREDICTED_FAILURE",
      predictedFailureRisk: risk.failureRisk,
      healthScore: opts.healthScore ?? undefined,
      priority: mapUrgencyToPriority(risk.maintenanceUrgency),
      title: `Predictive maintenance — machine ${code}`,
      description:
        `Auto-generated from PdM risk evaluation. ` +
        `Failure risk ${risk.failureRisk}% (confidence ${risk.confidenceScore}%), ` +
        `predicted ${timeframe}, urgency ${risk.maintenanceUrgency}. ` +
        `Factors: ${risk.factors.map((f) => `${f.name}=${f.contribution}`).join(", ") || "n/a"}.`,
      scheduledFor: risk.recommendedMaintenanceDate ?? undefined,
    } as any);

    logger.info(
      { machineId: machine.id, machineCode: code, woNumber, risk: risk.failureRisk },
      "[PdmAutoWorkOrder] created predictive work order",
    );
    return true;
  } catch (err) {
    logger.error(
      { machineId: machine.id, err: (err as Error)?.message },
      "[PdmAutoWorkOrder] create failed",
    );
    return false;
  }
}
