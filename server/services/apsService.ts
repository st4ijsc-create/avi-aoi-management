/**
 * APS Service — G2.5a orchestration (DRAFT-only).
 *
 * Pulls orders / lines / process assignments / machine capacity, builds the
 * CP-SAT model, runs the Python solver IF enabled, and maps the result into a
 * persistable schedule-run payload (compatible with buildScheduleRunPayload but
 * carrying the new stationId / setupMinutes / sequenceIndex columns).
 *
 * SAFETY: produces DRAFT proposals only. Does NOT apply schedules and MUST NOT
 * import commandDispatcher / writeTags. Any solver failure (disabled, ortools
 * missing, timeout, infeasible) falls back to the existing heuristic
 * schedulePriority with solverMode = "fallback_heuristic". Never throws on the
 * solver path.
 */

import * as db from "../db";
import {
  schedulePriority, scheduleFIFO,
  type SchedulableOrder, type ScheduleContext, type ScheduleResult,
} from "./productionSchedulingService";
import {
  buildApsModel, runApsSolver, parseApsResult, isApsEnabled, apsMaxJobs,
  type ApsLineAssignment, type ApsCapacityRow, type ApsParsedObjective,
} from "./apsSolver";

export type SolverMode = "cpsat" | "fallback_heuristic";

export interface ApsScheduleItem {
  productionOrderId: number;
  lineId: number;
  suggestedStart: Date;
  suggestedEnd: Date;
  reason: string;
  stationId: number | null;
  setupMinutes: number | null;
  sequenceIndex: number | null;
}

export interface ApsKpiSummary {
  totalOrders: number;
  scheduledOrders: number;
  unschedulableOrders: number;
  conflictCount: number;
  lateOrders: number;
  makespanHours: number | null;
  avgUtilization: number | null;
  aiExplanation?: string | null;
  solverMode: SolverMode;
  objective: {
    makespanMin: number | null;
    totalTardinessMin: number | null;
    totalSetupMin: number | null;
  } | null;
}

export interface ApsRunPayload {
  kpiSummary: ApsKpiSummary;
  conflictCount: number;
  items: ApsScheduleItem[];
}

export interface GenerateApsResult {
  solverMode: SolverMode;
  payload: ApsRunPayload;
  /** KPI of the FIFO baseline, for compare (G2.5b). */
  baseline: { makespanHours: number | null; lateOrders: number };
  algorithm: string;
}

export interface GenerateApsInput {
  factoryId?: number;
  lineId?: number;
}

// ─── Helpers ───────────────────────────────────────────────────

function toSchedulableOrders(orders: any[], lines: any[]): SchedulableOrder[] {
  return (orders as any[])
    .filter((o) => o.status !== "completed" && o.status !== "cancelled")
    .map((o) => ({
      id: o.id,
      orderCode: o.orderCode,
      productName: `Product ${o.productModelId}`,
      lineId: o.lineId,
      lineName: (lines as any[]).find((l) => l.id === o.lineId)?.name || `Line ${o.lineId}`,
      priority: o.priority ?? 3,
      targetQuantity: o.targetQuantity,
      actualQuantity: o.completedQuantity ?? 0,
      scheduledStartDate: o.plannedStartDate ? new Date(o.plannedStartDate) : null,
      scheduledEndDate: o.plannedEndDate ? new Date(o.plannedEndDate) : null,
      dueDate: o.plannedEndDate ? new Date(o.plannedEndDate) : null,
      status: o.status,
      dependencies: Array.isArray(o.dependencies) ? o.dependencies : [],
    }));
}

/** Build per-line process assignments (orderIndex / stationId / cycleTime sec). */
async function loadAssignmentsByLine(lineIds: number[]): Promise<Record<number, ApsLineAssignment[]>> {
  const out: Record<number, ApsLineAssignment[]> = {};
  for (const lineId of lineIds) {
    try {
      const rows = await db.getLineProcessAssignments(lineId);
      out[lineId] = (rows as any[]).map((r) => {
        const a = r.assignment ?? r;
        const proc = r.process ?? null;
        const cycle = a.cycleTimeTarget ?? proc?.cycleTimeTarget ?? null;
        return {
          lineId,
          orderIndex: a.orderIndex ?? 0,
          stationId: a.stationId ?? null,
          cycleTimeTargetSec: cycle != null ? Number(cycle) : null,
        };
      });
    } catch {
      out[lineId] = [];
    }
  }
  return out;
}

function buildHeuristicFallback(
  orders: SchedulableOrder[],
  schedulableLines: any[],
  context: ScheduleContext,
): { result: ScheduleResult } {
  const result = schedulePriority(orders, schedulableLines, context);
  return { result };
}

function kpiFromHeuristic(result: ScheduleResult): { makespanHours: number | null; lateOrders: number } {
  const ends = result.suggestions.map((s) => s.suggestedEndDate.getTime());
  const starts = result.suggestions.map((s) => s.suggestedStartDate.getTime());
  const makespanHours = ends.length > 0
    ? Math.round(((Math.max(...ends) - Math.min(...starts)) / 3_600_000) * 10) / 10
    : null;
  const lateOrders = result.conflicts.filter((c) => c.type === "deadline").length;
  return { makespanHours, lateOrders };
}

// ─── Orchestration ─────────────────────────────────────────────

/**
 * Generate a DRAFT APS schedule. Returns the payload + solverMode + a FIFO
 * baseline for KPI comparison. Never throws on the solver path — falls back to
 * the heuristic on any failure.
 */
export async function generateApsSchedule(input: GenerateApsInput): Promise<GenerateApsResult> {
  const orders = await db.getProductionOrders(
    input.factoryId || input.lineId
      ? { factoryId: input.factoryId, lineId: input.lineId }
      : undefined,
  );
  const lines = await db.getProductionLines();

  const schedulableLines = (lines as any[]).map((l) => ({
    id: l.id,
    name: l.name,
    maxConcurrent: l.maxConcurrentOrders ?? 1,
    capacityPerHour: l.capacityPerHour ?? null,
  }));

  const capacityByLine: Record<number, number | null> = {};
  for (const l of schedulableLines) capacityByLine[l.id] = l.capacityPerHour;
  const context: ScheduleContext = { capacityByLine };

  let schedulable = toSchedulableOrders(orders as any[], lines as any[]);
  // Cap problem size for the solver (heuristic handles the rest implicitly).
  const cap = apsMaxJobs();
  if (schedulable.length > cap) schedulable = schedulable.slice(0, cap);

  // FIFO baseline (always computed in-memory for KPI compare).
  const baselineResult = scheduleFIFO(schedulable, schedulableLines, context);
  const baseline = kpiFromHeuristic(baselineResult);

  // Try CP-SAT only when enabled.
  let solverMode: SolverMode = "fallback_heuristic";
  let apsItems: ApsScheduleItem[] | null = null;
  let objective: ApsParsedObjective | null = null;

  if (isApsEnabled() && schedulable.length > 0) {
    try {
      const lineIds = Array.from(new Set(schedulable.map((o) => o.lineId)));
      const assignmentsByLine = await loadAssignmentsByLine(lineIds);

      const capRows = await db.getMachineCapacity(input.lineId);
      const capacity: ApsCapacityRow[] = (capRows as any[]).map((c) => ({
        lineId: c.lineId,
        stationId: c.stationId ?? null,
        machineId: c.machineId ?? null,
        parallelCapacity: c.parallelCapacity ?? 1,
        changeoverDefaultMin: c.changeoverDefaultMin ?? 0,
      }));

      const productModelByOrder: Record<number, number | null> = {};
      for (const o of orders as any[]) productModelByOrder[o.id] = o.productModelId ?? null;

      const model = buildApsModel({
        orders: schedulable,
        assignmentsByLine,
        capacity,
        productModelByOrder,
      });

      const raw = await runApsSolver(model);
      if (raw) {
        const parsed = parseApsResult(model, raw);
        if (parsed.items.length > 0) {
          solverMode = "cpsat";
          objective = parsed.objective;
          apsItems = parsed.items.map((it) => ({
            productionOrderId: it.productionOrderId,
            lineId: it.lineId,
            suggestedStart: it.suggestedStart,
            suggestedEnd: it.suggestedEnd,
            reason: it.reason,
            stationId: it.stationId,
            setupMinutes: it.setupMinutes,
            sequenceIndex: it.sequenceIndex,
          }));
        }
      }
    } catch {
      // Any failure → fall through to heuristic. Never throw.
      apsItems = null;
      solverMode = "fallback_heuristic";
    }
  }

  // Build payload from whichever path produced items.
  if (apsItems && solverMode === "cpsat") {
    const ends = apsItems.map((i) => i.suggestedEnd.getTime());
    const starts = apsItems.map((i) => i.suggestedStart.getTime());
    const makespanHours = ends.length > 0
      ? Math.round(((Math.max(...ends) - Math.min(...starts)) / 3_600_000) * 10) / 10
      : null;
    const lateOrders = apsItems.filter((i) => {
      const order = schedulable.find((o) => o.id === i.productionOrderId);
      return order?.dueDate && i.suggestedEnd.getTime() > order.dueDate.getTime();
    }).length;

    const payload: ApsRunPayload = {
      kpiSummary: {
        totalOrders: schedulable.length,
        scheduledOrders: apsItems.length,
        unschedulableOrders: schedulable.length - apsItems.length,
        conflictCount: 0,
        lateOrders,
        makespanHours,
        avgUtilization: null,
        solverMode: "cpsat",
        objective: objective ?? null,
      },
      conflictCount: 0,
      items: apsItems,
    };
    return { solverMode, payload, baseline, algorithm: "APS-CPSAT" };
  }

  // Heuristic fallback.
  const { result } = buildHeuristicFallback(schedulable, schedulableLines, context);
  const heurKpi = kpiFromHeuristic(result);
  const items: ApsScheduleItem[] = result.suggestions.map((s) => ({
    productionOrderId: s.orderId,
    lineId: s.lineId,
    suggestedStart: s.suggestedStartDate,
    suggestedEnd: s.suggestedEndDate,
    reason: s.reason,
    stationId: null,
    setupMinutes: null,
    sequenceIndex: null,
  }));

  const payload: ApsRunPayload = {
    kpiSummary: {
      totalOrders: result.totalOrders,
      scheduledOrders: result.scheduledOrders,
      unschedulableOrders: result.unschedulableOrders.length,
      conflictCount: result.conflicts.length,
      lateOrders: heurKpi.lateOrders,
      makespanHours: heurKpi.makespanHours,
      avgUtilization: result.wipStatus.length > 0
        ? Math.round((result.wipStatus.reduce((a, w) => a + w.utilizationRate, 0) / result.wipStatus.length) * 10) / 10
        : null,
      solverMode: "fallback_heuristic",
      objective: null,
    },
    conflictCount: result.conflicts.length,
    items,
  };

  return { solverMode: "fallback_heuristic", payload, baseline, algorithm: result.algorithm };
}
