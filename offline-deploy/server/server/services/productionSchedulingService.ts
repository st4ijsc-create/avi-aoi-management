/**
 * Production Scheduling Service
 * 3 thuật toán: Priority / EDF (Earliest Deadline First) / FIFO
 * WIP tracking, conflict detection
 */

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
export function scheduleFIFO(orders: SchedulableOrder[], lines: { id: number; name: string; maxConcurrent?: number }[]): ScheduleResult {
  const sortedOrders = [...orders].sort((a, b) => {
    const aDate = a.scheduledStartDate?.getTime() || Date.now();
    const bDate = b.scheduledStartDate?.getTime() || Date.now();
    return aDate - bDate;
  });

  return scheduleOrders(sortedOrders, lines, "FIFO");
}

/**
 * Priority Scheduling - Highest priority first
 * Sắp xếp theo mức ưu tiên (priority DESC, then by due date ASC)
 */
export function schedulePriority(orders: SchedulableOrder[], lines: { id: number; name: string; maxConcurrent?: number }[]): ScheduleResult {
  const sortedOrders = [...orders].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority; // Higher priority first
    const aDue = a.dueDate?.getTime() || Infinity;
    const bDue = b.dueDate?.getTime() || Infinity;
    return aDue - bDue; // Earlier deadline first for same priority
  });

  return scheduleOrders(sortedOrders, lines, "Priority");
}

/**
 * EDF Scheduling - Earliest Deadline First
 * Sắp xếp theo deadline gần nhất
 */
export function scheduleEDF(orders: SchedulableOrder[], lines: { id: number; name: string; maxConcurrent?: number }[]): ScheduleResult {
  const sortedOrders = [...orders].sort((a, b) => {
    const aDue = a.dueDate?.getTime() || Infinity;
    const bDue = b.dueDate?.getTime() || Infinity;
    if (aDue !== bDue) return aDue - bDue; // Earlier deadline first
    return b.priority - a.priority; // Higher priority for same deadline
  });

  return scheduleOrders(sortedOrders, lines, "EDF");
}

/**
 * Core scheduling engine - assigns orders to lines with conflict detection
 */
function scheduleOrders(
  sortedOrders: SchedulableOrder[],
  lines: { id: number; name: string; maxConcurrent?: number }[],
  algorithm: string,
): ScheduleResult {
  const suggestions: ScheduleSuggestion[] = [];
  const conflicts: ScheduleConflict[] = [];
  const unschedulable: { id: number; code: string; reason: string }[] = [];

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

    const estimatedHours = order.estimatedHours || Math.max(1, Math.ceil(order.targetQuantity / 100)) * 8;
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
