/**
 * WS-4 — Unit tests for the upgraded production scheduling service.
 *
 * Covers: capacity-based duration, maintenance blackout push, deadline conflict,
 * clean schedule (no conflicts), what-if capacity reduction, payload builder, and
 * regression of the legacy scheduleFIFO/Priority/EDF signatures.
 */
import { describe, it, expect } from "vitest";
import {
  scheduleFIFO,
  schedulePriority,
  scheduleEDF,
  simulateWhatIf,
  buildScheduleRunPayload,
  type SchedulableOrder,
  type SchedulableLine,
  type ScheduleContext,
} from "./productionSchedulingService";

const H = 3600_000;

function order(partial: Partial<SchedulableOrder> & { id: number; lineId: number }): SchedulableOrder {
  return {
    orderCode: `PO-${partial.id}`,
    productName: "P",
    lineName: "L",
    priority: 3,
    targetQuantity: 100,
    actualQuantity: 0,
    scheduledStartDate: null,
    scheduledEndDate: null,
    dueDate: null,
    status: "pending",
    ...partial,
  } as SchedulableOrder;
}

const lines: SchedulableLine[] = [
  { id: 1, name: "Line 1", maxConcurrent: 1, capacityPerHour: 50 },
];

describe("capacity-based duration", () => {
  it("uses ceil(targetQuantity / capacityPerHour) hours", () => {
    const orders = [order({ id: 1, lineId: 1, targetQuantity: 100 })]; // 100/50 = 2h
    const ctx: ScheduleContext = { capacityByLine: { 1: 50 } };
    const res = schedulePriority(orders, lines, ctx);
    const s = res.suggestions[0];
    const hours = (s.suggestedEndDate.getTime() - s.suggestedStartDate.getTime()) / H;
    expect(hours).toBeCloseTo(2, 5);
  });

  it("falls back to legacy formula when capacity unknown", () => {
    const orders = [order({ id: 1, lineId: 1, targetQuantity: 100 })];
    const res = schedulePriority(orders, [{ id: 1, name: "Line 1", maxConcurrent: 1 }]);
    const s = res.suggestions[0];
    const hours = (s.suggestedEndDate.getTime() - s.suggestedStartDate.getTime()) / H;
    // legacy: ceil(100/100)*8 = 8h
    expect(hours).toBeCloseTo(8, 5);
  });
});

describe("blackout windows", () => {
  it("pushes a slot past a maintenance blackout on its line", () => {
    const now = Date.now();
    const orders = [order({ id: 1, lineId: 1, targetQuantity: 50 })]; // 1h job
    const blackoutStart = new Date(now + 0.5 * H);
    const blackoutEnd = new Date(now + 4 * H);
    const ctx: ScheduleContext = {
      capacityByLine: { 1: 50 },
      blackouts: [{ lineId: 1, start: blackoutStart, end: blackoutEnd, reason: "pm" }],
    };
    const res = schedulePriority(orders, lines, ctx);
    const s = res.suggestions[0];
    // Start should be at or after the blackout end (job would otherwise overlap it).
    expect(s.suggestedStartDate.getTime()).toBeGreaterThanOrEqual(blackoutEnd.getTime() - 1000);
    expect(res.conflicts.some((c) => c.details?.reason === "maintenance-blackout")).toBe(true);
  });
});

describe("deadline conflict", () => {
  it("flags a deadline error when the job cannot finish in time", () => {
    const now = Date.now();
    const orders = [order({ id: 1, lineId: 1, targetQuantity: 1000, dueDate: new Date(now + 1 * H) })]; // 20h job, 1h deadline
    const ctx: ScheduleContext = { capacityByLine: { 1: 50 } };
    const res = schedulePriority(orders, lines, ctx);
    expect(res.conflicts.some((c) => c.type === "deadline" && c.severity === "error")).toBe(true);
  });

  it("produces no conflicts for a feasible single order", () => {
    const now = Date.now();
    const orders = [order({ id: 1, lineId: 1, targetQuantity: 50, dueDate: new Date(now + 100 * H) })];
    const ctx: ScheduleContext = { capacityByLine: { 1: 50 } };
    const res = schedulePriority(orders, lines, ctx);
    expect(res.conflicts.length).toBe(0);
    expect(res.scheduledOrders).toBe(1);
  });
});

describe("what-if simulation", () => {
  it("reducing capacity 30% increases (or holds) the number of late orders", async () => {
    const now = Date.now();
    // Tight deadlines so reduced throughput pushes orders late.
    // Baseline: 500/100 = 5h each, serialized (maxConcurrent 1) -> ends 5/10/15h.
    // Reduced 30%: 500/70 = ceil 8h each -> ends 8/16/24h. Deadlines sit between.
    const orders: SchedulableOrder[] = [
      order({ id: 1, lineId: 1, targetQuantity: 500, dueDate: new Date(now + 6 * H) }),
      order({ id: 2, lineId: 1, targetQuantity: 500, dueDate: new Date(now + 12 * H) }),
      order({ id: 3, lineId: 1, targetQuantity: 500, dueDate: new Date(now + 18 * H) }),
    ];
    const ctx: ScheduleContext = { capacityByLine: { 1: 100 } }; // 5h each at baseline

    const result = await simulateWhatIf(
      { lineId: 1, capacityReductionPct: 30 },
      orders,
      lines.map((l) => ({ ...l, capacityPerHour: 100 })),
      "Priority",
      ctx,
    );

    expect(result.capacityReductionPct).toBe(30);
    expect(result.effectiveCapacityPerHour).toBeLessThan(result.baselineCapacityPerHour!);
    expect(result.simulatedLateCount).toBeGreaterThanOrEqual(result.baselineLateCount);
    expect(result.simulatedLateCount).toBeGreaterThan(0);
  });
});

describe("buildScheduleRunPayload", () => {
  it("summarizes KPI + items from a result", () => {
    const orders = [
      order({ id: 1, lineId: 1, targetQuantity: 50 }),
      order({ id: 2, lineId: 1, targetQuantity: 50 }),
    ];
    const ctx: ScheduleContext = { capacityByLine: { 1: 50 } };
    const res = schedulePriority(orders, lines, ctx);
    const payload = buildScheduleRunPayload(res, "explained");
    expect(payload.items.length).toBe(res.suggestions.length);
    expect(payload.kpiSummary.totalOrders).toBe(res.totalOrders);
    expect(payload.kpiSummary.aiExplanation).toBe("explained");
    expect(payload.conflictCount).toBe(res.conflicts.length);
  });
});

describe("regression — legacy signatures unchanged", () => {
  const legacyOrders = [
    order({ id: 1, lineId: 1, priority: 5, dueDate: new Date(Date.now() + 50 * H) }),
    order({ id: 2, lineId: 1, priority: 1, dueDate: new Date(Date.now() + 10 * H) }),
  ];
  const legacyLines = [{ id: 1, name: "Line 1", maxConcurrent: 2 }];

  it("scheduleFIFO works with the original 2-arg signature", () => {
    const res = scheduleFIFO(legacyOrders, legacyLines);
    expect(res.algorithm).toBe("FIFO");
    expect(res.suggestions.length).toBe(2);
  });

  it("schedulePriority orders by priority desc", () => {
    const res = schedulePriority(legacyOrders, legacyLines);
    expect(res.algorithm).toBe("Priority");
    expect(res.suggestions[0].orderId).toBe(1); // priority 5 first
  });

  it("scheduleEDF orders by earliest deadline", () => {
    const res = scheduleEDF(legacyOrders, legacyLines);
    expect(res.algorithm).toBe("EDF");
    expect(res.suggestions[0].orderId).toBe(2); // earlier deadline first
  });
});
