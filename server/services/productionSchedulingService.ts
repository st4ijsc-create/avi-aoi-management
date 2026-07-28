/**
 * Production Scheduling Service
 * 3 thuật toán: Priority / EDF (Earliest Deadline First) / FIFO
 * WIP tracking, conflict detection
 */

// doc69 W1 "modelfix" — shared env→GGUF-basename resolver, so the AI explanation below pins a real
// text model instead of letting the engine reuse whatever happened to load first (the RAG embedder).
import { resolveLogicalModel } from "./ai/modelResolver";

export interface SchedulableOrder {
  id: number;
  orderCode: string;
  productName: string;
  lineId: number;
  lineName: string;
  priority: number; // 1-5, higher = more important
  targetQuantity: number;
  actualQuantity: number;
  scheduledStartDate: Date | null;
  scheduledEndDate: Date | null;
  dueDate: Date | null;
  status: string;
  dependencies?: number[]; // IDs of orders that must finish first
  estimatedHours?: number;
}

// ── WS-4 additive scheduling context (all optional, backward-compatible) ──

/** Line definition extended with capacity for duration computation. */
export interface SchedulableLine {
  id: number;
  name: string;
  maxConcurrent?: number;
  capacityPerHour?: number | null; // units/hour; drives realistic duration
}

/** A maintenance blackout window — no order slot may overlap it on a line. */
export interface BlackoutWindow {
  lineId?: number | null;     // null = applies to all lines
  machineId?: number | null;  // informational
  start: Date;
  end: Date;
  reason?: string;
}

/** A working shift (from shift_configs) — used to keep slots within shift hours. */
export interface ShiftWindow {
  startHour: number;   // 0-23
  startMinute?: number;
  endHour: number;     // 0-23
  endMinute?: number;
}

export interface ScheduleContext {
  capacityByLine?: Record<number, number | null>; // lineId -> capacityPerHour
  blackouts?: BlackoutWindow[];
  shifts?: ShiftWindow[];
}

export interface ScheduleSuggestion {
  orderId: number;
  orderCode: string;
  lineId: number;
  lineName: string;
  suggestedStartDate: Date;
  suggestedEndDate: Date;
  reason: string;
}

export interface ScheduleConflict {
  type: "overlap" | "dependency" | "capacity" | "deadline";
  severity: "warning" | "error";
  orderId: number;
  orderCode: string;
  conflictWithId?: number;
  conflictWithCode?: string;
  message: string;
  details: Record<string, any>;
}

export interface WIPStatus {
  lineId: number;
  lineName: string;
  inProgressOrders: number;
  totalTargetQuantity: number;
  totalActualQuantity: number;
  completionPercentage: number;
  estimatedCompletionTime: Date | null;
  utilizationRate: number;
}

export interface ScheduleResult {
  algorithm: string;
  suggestions: ScheduleSuggestion[];
  conflicts: ScheduleConflict[];
  wipStatus: WIPStatus[];
  totalOrders: number;
  scheduledOrders: number;
  unschedulableOrders: { id: number; code: string; reason: string }[];
}

/**
 * FIFO Scheduling - First In First Out
 * Sắp xếp theo thứ tự tạo đơn (creation order / existing scheduled start)
 */
export function scheduleFIFO(orders: SchedulableOrder[], lines: { id: number; name: string; maxConcurrent?: number }[], context?: ScheduleContext): ScheduleResult {
  const sortedOrders = [...orders].sort((a, b) => {
    const aDate = a.scheduledStartDate?.getTime() || Date.now();
    const bDate = b.scheduledStartDate?.getTime() || Date.now();
    return aDate - bDate;
  });

  return scheduleOrders(sortedOrders, lines, "FIFO", context);
}

/**
 * Priority Scheduling - Highest priority first
 * Sắp xếp theo mức ưu tiên (priority DESC, then by due date ASC)
 */
export function schedulePriority(orders: SchedulableOrder[], lines: { id: number; name: string; maxConcurrent?: number }[], context?: ScheduleContext): ScheduleResult {
  const sortedOrders = [...orders].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority; // Higher priority first
    const aDue = a.dueDate?.getTime() || Infinity;
    const bDue = b.dueDate?.getTime() || Infinity;
    return aDue - bDue; // Earlier deadline first for same priority
  });

  return scheduleOrders(sortedOrders, lines, "Priority", context);
}

/**
 * EDF Scheduling - Earliest Deadline First
 * Sắp xếp theo deadline gần nhất
 */
export function scheduleEDF(orders: SchedulableOrder[], lines: { id: number; name: string; maxConcurrent?: number }[], context?: ScheduleContext): ScheduleResult {
  const sortedOrders = [...orders].sort((a, b) => {
    const aDue = a.dueDate?.getTime() || Infinity;
    const bDue = b.dueDate?.getTime() || Infinity;
    if (aDue !== bDue) return aDue - bDue; // Earlier deadline first
    return b.priority - a.priority; // Higher priority for same deadline
  });

  return scheduleOrders(sortedOrders, lines, "EDF", context);
}

/**
 * Core scheduling engine - assigns orders to lines with conflict detection
 */
function scheduleOrders(
  sortedOrders: SchedulableOrder[],
  lines: { id: number; name: string; maxConcurrent?: number; capacityPerHour?: number | null }[],
  algorithm: string,
  context?: ScheduleContext,
): ScheduleResult {
  const suggestions: ScheduleSuggestion[] = [];
  const conflicts: ScheduleConflict[] = [];
  const unschedulable: { id: number; code: string; reason: string }[] = [];

  const capacityByLine = context?.capacityByLine ?? {};
  const blackouts = context?.blackouts ?? [];
  const shifts = context?.shifts ?? [];

  // Track line availability: lineId -> end times of current scheduled orders
  const lineTimelines: Map<number, { orderId: number; code: string; start: Date; end: Date }[]> = new Map();
  for (const line of lines) {
    lineTimelines.set(line.id, []);
  }

  // Track completed/in-progress orders for dependency resolution
  const orderEndTimes: Map<number, Date> = new Map();

  const now = new Date();

  for (const order of sortedOrders) {
    // Skip completed/cancelled orders
    if (order.status === "completed" || order.status === "cancelled") continue;

    const line = lines.find(l => l.id === order.lineId);
    if (!line) {
      unschedulable.push({ id: order.id, code: order.orderCode, reason: "Line not found" });
      continue;
    }

    // WS-4: realistic duration from line capacity (units/hour). Prefer an
    // explicit estimatedHours; else ceil(targetQuantity / capacityPerHour);
    // fall back to the legacy formula only when capacity is unknown.
    const lineCapacity = (capacityByLine[order.lineId] ?? (line as any).capacityPerHour) as number | null | undefined;
    const estimatedHours = order.estimatedHours
      ?? (lineCapacity && lineCapacity > 0
        ? Math.max(1, Math.ceil(order.targetQuantity / lineCapacity))
        : Math.max(1, Math.ceil(order.targetQuantity / 100)) * 8);
    const durationMs = estimatedHours * 3600 * 1000;

    // Resolve dependencies
    let earliestStart = new Date(Math.max(now.getTime(), order.scheduledStartDate?.getTime() || now.getTime()));

    if (order.dependencies && order.dependencies.length > 0) {
      for (const depId of order.dependencies) {
        const depEnd = orderEndTimes.get(depId);
        if (depEnd && depEnd.getTime() > earliestStart.getTime()) {
          earliestStart = new Date(depEnd.getTime());
          conflicts.push({
            type: "dependency",
            severity: "warning",
            orderId: order.id,
            orderCode: order.orderCode,
            conflictWithId: depId,
            message: `Phải chờ đơn hàng phụ thuộc #${depId} hoàn thành`,
            details: { dependencyEndDate: depEnd },
          });
        }
      }
    }

    // Find available slot on the line
    const timeline = lineTimelines.get(order.lineId) || [];
    const maxConcurrent = line.maxConcurrent || 1;

    let slotStart = earliestStart;
    
    // Check for overlaps and find the earliest available slot
    if (timeline.length >= maxConcurrent) {
      // Sort by end time and find the earliest available slot
      const sortedTimeline = [...timeline].sort((a, b) => a.end.getTime() - b.end.getTime());
      if (sortedTimeline.length >= maxConcurrent) {
        const earliestFree = sortedTimeline[sortedTimeline.length - maxConcurrent];
        if (earliestFree.end.getTime() > slotStart.getTime()) {
          slotStart = new Date(earliestFree.end.getTime());
        }
      }
    }

    // WS-4: push the start past any maintenance blackout window on this line,
    // then snap it into the next working shift (if shifts are configured).
    const lineBlackouts = blackouts.filter(
      (b) => b.lineId == null || b.lineId === order.lineId,
    );
    slotStart = pushPastBlackouts(slotStart, durationMs, lineBlackouts, conflicts, order);
    slotStart = snapToShift(slotStart, shifts);

    const suggestedStart = slotStart;
    const suggestedEnd = new Date(suggestedStart.getTime() + durationMs);

    // Deadline check
    if (order.dueDate && suggestedEnd.getTime() > order.dueDate.getTime()) {
      conflicts.push({
        type: "deadline",
        severity: "error",
        orderId: order.id,
        orderCode: order.orderCode,
        message: `Dự kiến hoàn thành sau hạn chót ${order.dueDate.toLocaleDateString("vi-VN")}`,
        details: {
          dueDate: order.dueDate,
          suggestedEnd,
          daysLate: Math.ceil((suggestedEnd.getTime() - order.dueDate.getTime()) / (24 * 3600 * 1000)),
        },
      });
    }

    // WS-4 capacity conflict: the line is already saturated at the earliest
    // feasible start, forcing this order to wait — surfaces a throughput gap.
    if (slotStart.getTime() > earliestStart.getTime() && timeline.length >= maxConcurrent) {
      const waitHours = (slotStart.getTime() - earliestStart.getTime()) / 3600_000;
      if (waitHours >= 1) {
        conflicts.push({
          type: "capacity",
          severity: "warning",
          orderId: order.id,
          orderCode: order.orderCode,
          message: `Dây chuyền quá tải — đơn phải chờ ~${Math.round(waitHours)}h do hết công suất`,
          details: { waitHours: Math.round(waitHours), maxConcurrent, earliestStart, slotStart },
        });
      }
    }

    // Overlap detection
    for (const existing of timeline) {
      if (suggestedStart.getTime() < existing.end.getTime() && suggestedEnd.getTime() > existing.start.getTime()) {
        // Count concurrent orders at this time
        const concurrentAtStart = timeline.filter(
          t => t.start.getTime() <= suggestedStart.getTime() && t.end.getTime() > suggestedStart.getTime()
        ).length;
        
        if (concurrentAtStart >= maxConcurrent) {
          conflicts.push({
            type: "overlap",
            severity: "warning",
            orderId: order.id,
            orderCode: order.orderCode,
            conflictWithId: existing.orderId,
            conflictWithCode: existing.code,
            message: `Chồng chéo với đơn hàng ${existing.code} trên cùng dây chuyền`,
            details: { existingStart: existing.start, existingEnd: existing.end },
          });
        }
      }
    }

    suggestions.push({
      orderId: order.id,
      orderCode: order.orderCode,
      lineId: order.lineId,
      lineName: order.lineName || line.name,
      suggestedStartDate: suggestedStart,
      suggestedEndDate: suggestedEnd,
      reason: getScheduleReason(algorithm, order),
    });

    // Record in timeline
    timeline.push({ orderId: order.id, code: order.orderCode, start: suggestedStart, end: suggestedEnd });
    lineTimelines.set(order.lineId, timeline);
    orderEndTimes.set(order.id, suggestedEnd);
  }

  // Calculate WIP status
  const wipStatus: WIPStatus[] = lines.map(line => {
    const lineOrders = sortedOrders.filter(o => o.lineId === line.id && o.status === "in_progress");
    const totalTarget = lineOrders.reduce((sum, o) => sum + o.targetQuantity, 0);
    const totalActual = lineOrders.reduce((sum, o) => sum + o.actualQuantity, 0);
    const timeline = lineTimelines.get(line.id) || [];
    const activeNow = timeline.filter(t => t.start.getTime() <= now.getTime() && t.end.getTime() > now.getTime());

    return {
      lineId: line.id,
      lineName: line.name,
      inProgressOrders: lineOrders.length,
      totalTargetQuantity: totalTarget,
      totalActualQuantity: totalActual,
      completionPercentage: totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0,
      estimatedCompletionTime: timeline.length > 0 ? new Date(Math.max(...timeline.map(t => t.end.getTime()))) : null,
      utilizationRate: Math.min(100, (activeNow.length / (line.maxConcurrent || 1)) * 100),
    };
  });

  return {
    algorithm,
    suggestions,
    conflicts,
    wipStatus,
    totalOrders: sortedOrders.length,
    scheduledOrders: suggestions.length,
    unschedulableOrders: unschedulable,
  };
}

function getScheduleReason(algorithm: string, order: SchedulableOrder): string {
  switch (algorithm) {
    case "Priority":
      return `Ưu tiên ${order.priority}/5${order.dueDate ? `, hạn chót ${order.dueDate.toLocaleDateString("vi-VN")}` : ""}`;
    case "EDF":
      return order.dueDate
        ? `Hạn chót: ${order.dueDate.toLocaleDateString("vi-VN")}`
        : "Không có hạn chót - xếp cuối";
    case "FIFO":
      return `Theo thứ tự tạo đơn`;
    default:
      return "";
  }
}

// ─── WS-4 helpers: blackout windows + shift calendar ────────────────────────

/**
 * Move `start` so that [start, start+durationMs] does not overlap any blackout
 * window. If it overlaps, the order is pushed to the end of that window. Repeats
 * until no overlap (windows may chain). Records a dependency-style conflict note.
 */
function pushPastBlackouts(
  start: Date,
  durationMs: number,
  blackouts: BlackoutWindow[],
  conflicts: ScheduleConflict[],
  order: SchedulableOrder,
): Date {
  if (blackouts.length === 0) return start;
  // Sort windows chronologically; iterate until stable (bounded by window count).
  const sorted = [...blackouts].sort((a, b) => a.start.getTime() - b.start.getTime());
  let cur = start;
  let pushed = false;
  for (let guard = 0; guard < sorted.length + 1; guard++) {
    const s = cur.getTime();
    const e = s + durationMs;
    const hit = sorted.find((w) => s < w.end.getTime() && e > w.start.getTime());
    if (!hit) break;
    cur = new Date(hit.end.getTime());
    pushed = true;
  }
  if (pushed) {
    conflicts.push({
      type: "dependency",
      severity: "warning",
      orderId: order.id,
      orderCode: order.orderCode,
      message: `Dời lịch qua cửa sổ bảo trì dự kiến`,
      details: { newStart: cur, reason: "maintenance-blackout" },
    });
  }
  return cur;
}

/**
 * Snap `start` forward to the next working-shift boundary. If `start` already
 * falls within a configured shift, it is unchanged. With no shifts configured,
 * returns `start` (24/7 operation). Overnight shifts (end <= start) supported.
 */
function snapToShift(start: Date, shifts: ShiftWindow[]): Date {
  if (!shifts || shifts.length === 0) return start;

  const minutesOf = (h: number, m = 0) => h * 60 + m;
  const windows = shifts.map((s) => ({
    from: minutesOf(s.startHour, s.startMinute ?? 0),
    to: minutesOf(s.endHour, s.endMinute ?? 0),
    overnight: minutesOf(s.endHour, s.endMinute ?? 0) <= minutesOf(s.startHour, s.startMinute ?? 0),
  }));

  // Search up to 8 days ahead for the next shift entry.
  let cursor = new Date(start);
  for (let i = 0; i < 8 * 24 * 60; i++) {
    const mins = cursor.getHours() * 60 + cursor.getMinutes();
    const inShift = windows.some((w) =>
      w.overnight ? (mins >= w.from || mins < w.to) : (mins >= w.from && mins < w.to),
    );
    if (inShift) return cursor;
    // advance to next minute boundary (coarse: jump by 15 min for speed)
    cursor = new Date(cursor.getTime() + 15 * 60 * 1000);
  }
  return start; // give up — no shift matched within horizon
}

// ─── WS-4: What-if simulation (read-only) ────────────────────────────────────

export interface WhatIfInput {
  lineId: number;
  defectRatePct?: number;        // extra rejects -> effective capacity drop
  extraDowntimeHours?: number;   // injected downtime -> capacity loss for the day
  capacityReductionPct?: number; // direct capacity reduction
}

export interface WhatIfResult {
  lineId: number;
  algorithm: string;
  baselineCapacityPerHour: number | null;
  effectiveCapacityPerHour: number | null;
  capacityReductionPct: number;
  lateOrders: Array<{
    orderId: number;
    orderCode: string;
    dueDate: Date | null;
    suggestedEnd: Date;
    hoursLate: number;
  }>;
  baselineLateCount: number;
  simulatedLateCount: number;
  aiExplanation: string | null;
}

/**
 * Simulate the impact of a disruption on one line WITHOUT writing to the DB.
 * Reduces the line's effective capacity, reschedules in-memory with the chosen
 * algorithm, and reports orders projected to miss their deadline.
 */
export async function simulateWhatIf(
  input: WhatIfInput,
  orders: SchedulableOrder[],
  lines: SchedulableLine[],
  algorithm: "FIFO" | "Priority" | "EDF" = "Priority",
  context?: ScheduleContext,
): Promise<WhatIfResult> {
  const line = lines.find((l) => l.id === input.lineId);
  const baselineCapacity = (context?.capacityByLine?.[input.lineId] ?? line?.capacityPerHour ?? null);

  // Combine the disruption levers into a single effective-capacity multiplier.
  let multiplier = 1;
  if (input.capacityReductionPct && input.capacityReductionPct > 0) {
    multiplier *= Math.max(0, 1 - input.capacityReductionPct / 100);
  }
  if (input.defectRatePct && input.defectRatePct > 0) {
    // Defects consume capacity producing scrap: good-unit throughput drops.
    multiplier *= Math.max(0, 1 - input.defectRatePct / 100);
  }
  if (input.extraDowntimeHours && input.extraDowntimeHours > 0) {
    // Treat downtime as lost fraction of a 24h day.
    multiplier *= Math.max(0, 1 - Math.min(1, input.extraDowntimeHours / 24));
  }

  const effectiveCapacity = baselineCapacity != null ? Math.max(1, Math.floor(baselineCapacity * multiplier)) : null;

  const runWith = (cap: number | null): ScheduleResult => {
    const capByLine: Record<number, number | null> = { ...(context?.capacityByLine ?? {}) };
    for (const l of lines) capByLine[l.id] = capByLine[l.id] ?? l.capacityPerHour ?? null;
    if (cap != null) capByLine[input.lineId] = cap;
    const ctx: ScheduleContext = { ...context, capacityByLine: capByLine };
    const fn = algorithm === "FIFO" ? scheduleFIFO : algorithm === "EDF" ? scheduleEDF : schedulePriority;
    return fn(orders, lines, ctx);
  };

  const baseline = runWith(baselineCapacity);
  const simulated = runWith(effectiveCapacity);

  const countLate = (r: ScheduleResult) =>
    r.conflicts.filter((c) => c.type === "deadline").length;

  const lateOrders = simulated.suggestions
    .map((s) => {
      const order = orders.find((o) => o.id === s.orderId);
      const due = order?.dueDate ?? null;
      const hoursLate = due ? (s.suggestedEndDate.getTime() - due.getTime()) / 3600_000 : 0;
      return { orderId: s.orderId, orderCode: s.orderCode, dueDate: due, suggestedEnd: s.suggestedEndDate, hoursLate };
    })
    .filter((o) => o.hoursLate > 0)
    .map((o) => ({ ...o, hoursLate: Math.round(o.hoursLate * 10) / 10 }));

  const aiExplanation = await explainScheduleWithAI(simulated).catch(() => null);

  return {
    lineId: input.lineId,
    algorithm,
    baselineCapacityPerHour: baselineCapacity,
    effectiveCapacityPerHour: effectiveCapacity,
    capacityReductionPct: Math.round((1 - multiplier) * 100),
    lateOrders,
    baselineLateCount: countLate(baseline),
    simulatedLateCount: countLate(simulated),
    aiExplanation,
  };
}

// ─── WS-4: build a persistable schedule-run payload from a result ───────────

export interface ScheduleRunPayload {
  kpiSummary: {
    totalOrders: number;
    scheduledOrders: number;
    unschedulableOrders: number;
    conflictCount: number;
    lateOrders: number;
    makespanHours: number | null;
    avgUtilization: number | null;
    aiExplanation?: string | null;
  };
  conflictCount: number;
  items: Array<{
    productionOrderId: number;
    lineId: number;
    suggestedStart: Date;
    suggestedEnd: Date;
    reason: string;
  }>;
}

export function buildScheduleRunPayload(
  result: ScheduleResult,
  aiExplanation: string | null = null,
): ScheduleRunPayload {
  const lateOrders = result.conflicts.filter((c) => c.type === "deadline").length;
  const ends = result.suggestions.map((s) => s.suggestedEndDate.getTime());
  const starts = result.suggestions.map((s) => s.suggestedStartDate.getTime());
  const makespanHours = ends.length > 0
    ? (Math.max(...ends) - Math.min(...starts)) / 3600_000
    : null;
  const utils = result.wipStatus.map((w) => w.utilizationRate);
  const avgUtilization = utils.length > 0 ? utils.reduce((a, b) => a + b, 0) / utils.length : null;

  return {
    kpiSummary: {
      totalOrders: result.totalOrders,
      scheduledOrders: result.scheduledOrders,
      unschedulableOrders: result.unschedulableOrders.length,
      conflictCount: result.conflicts.length,
      lateOrders,
      makespanHours: makespanHours != null ? Math.round(makespanHours * 10) / 10 : null,
      avgUtilization: avgUtilization != null ? Math.round(avgUtilization * 10) / 10 : null,
      aiExplanation,
    },
    conflictCount: result.conflicts.length,
    items: result.suggestions.map((s) => ({
      productionOrderId: s.orderId,
      lineId: s.lineId,
      suggestedStart: s.suggestedStartDate,
      suggestedEnd: s.suggestedEndDate,
      reason: s.reason,
    })),
  };
}

// ─── AI Schedule Explanation ────────────────────────────────────────────────

/**
 * Generate AI-powered explanation for scheduling results.
 * Explains conflicts, risk assessment, and recovery recommendations.
 * Non-blocking — returns null on any failure, and hard-bounded by
 * SCHEDULE_AI_EXPLAIN_TIMEOUT_MS (default 3000) so a slow/hung LLM can
 * never stall the scheduling/what-if path it decorates.
 */
export async function explainScheduleWithAI(
  result: ScheduleResult,
): Promise<string | null> {
  if (result.suggestions.length === 0) return null;
  const timeoutMs = Number(process.env.SCHEDULE_AI_EXPLAIN_TIMEOUT_MS || 3000);
  return Promise.race([
    explainScheduleWithAIUnbounded(result),
    new Promise<null>((resolve) => {
      const t = setTimeout(() => resolve(null), timeoutMs);
      t.unref?.();
    }),
  ]);
}

async function explainScheduleWithAIUnbounded(
  result: ScheduleResult,
): Promise<string | null> {
  try {
    const { generateText } = await import('./aiGgufEngine');

    const summary = {
      algorithm: result.algorithm,
      totalOrders: result.totalOrders,
      scheduledOrders: result.scheduledOrders,
      unschedulable: result.unschedulableOrders.length,
      conflicts: result.conflicts.slice(0, 10).map(c => ({
        type: c.type,
        severity: c.severity,
        message: c.message,
      })),
      wipStatus: result.wipStatus.map(w => ({
        line: w.lineName,
        utilization: `${w.utilizationRate.toFixed(0)}%`,
        completion: `${w.completionPercentage.toFixed(0)}%`,
        inProgress: w.inProgressOrders,
      })),
    };

    const response = await generateText({
      systemPrompt: `You are a production planning expert. Analyze scheduling results and provide a clear explanation (3-5 sentences) covering: key conflicts and their impact, line utilization balance, risk areas, and one actionable recommendation.`,
      prompt: `Schedule result: ${JSON.stringify(summary)}`,
      maxTokens: 300,
      temperature: 0.5,
    }, resolveLogicalModel("chat"));

    return response.text?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Run scheduling with AI explanation
 */
export async function scheduleFIFOWithExplanation(
  orders: SchedulableOrder[],
  lines: Array<{ id: number; name: string; maxConcurrent?: number }>,
): Promise<ScheduleResult & { aiExplanation: string | null }> {
  const result = scheduleFIFO(orders, lines);
  const aiExplanation = await explainScheduleWithAI(result);
  return { ...result, aiExplanation };
}

export async function schedulePriorityWithExplanation(
  orders: SchedulableOrder[],
  lines: Array<{ id: number; name: string; maxConcurrent?: number }>,
): Promise<ScheduleResult & { aiExplanation: string | null }> {
  const result = schedulePriority(orders, lines);
  const aiExplanation = await explainScheduleWithAI(result);
  return { ...result, aiExplanation };
}

export async function scheduleEDFWithExplanation(
  orders: SchedulableOrder[],
  lines: Array<{ id: number; name: string; maxConcurrent?: number }>,
): Promise<ScheduleResult & { aiExplanation: string | null }> {
  const result = scheduleEDF(orders, lines);
  const aiExplanation = await explainScheduleWithAI(result);
  return { ...result, aiExplanation };
}
