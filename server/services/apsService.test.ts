/**
 * G2.5a APS service orchestration tests.
 * Mocks the DB (orders/lines/assignments/capacity) and the Python solver
 * (runApsSolver) so no real DB or Python is touched.
 *
 * Asserts:
 *  - APS disabled → heuristic fallback, solverMode=fallback_heuristic, valid items.
 *  - runApsSolver → null (ortools missing/timeout) → heuristic fallback.
 *  - runApsSolver → valid result → mapped to cpsat payload with stationId.
 *  - FIFO baseline KPI returned for compare.
 *  - SAFETY: apsService source does NOT import commandDispatcher / writeTags;
 *    payload is DRAFT-shaped only (no machine-write fields).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// ── DB mock ─────────────────────────────────────────────────────
const dbState = {
  orders: [] as any[],
  lines: [] as any[],
  assignments: {} as Record<number, any[]>,
  capacity: [] as any[],
};
vi.mock("../db", () => ({
  getProductionOrders: vi.fn(async () => dbState.orders),
  getProductionLines: vi.fn(async () => dbState.lines),
  getLineProcessAssignments: vi.fn(async (lineId: number) => dbState.assignments[lineId] ?? []),
  getMachineCapacity: vi.fn(async () => dbState.capacity),
}));

// ── apsSolver mock: only runApsSolver is stubbed; keep pure builders real ──
const runApsSolverMock = vi.fn();
vi.mock("./apsSolver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apsSolver")>();
  return { ...actual, runApsSolver: (...a: any[]) => runApsSolverMock(...a) };
});

import { generateApsSchedule } from "./apsService";

const EPOCH = new Date("2026-06-01T00:00:00.000Z");

function seed() {
  dbState.orders = [
    { id: 1, orderCode: "O-1", lineId: 10, productModelId: 50, priority: 5, targetQuantity: 120,
      completedQuantity: 0, status: "pending", plannedStartDate: EPOCH, plannedEndDate: null, dependencies: [] },
    { id: 2, orderCode: "O-2", lineId: 10, productModelId: 51, priority: 2, targetQuantity: 60,
      completedQuantity: 0, status: "pending", plannedStartDate: EPOCH, plannedEndDate: null, dependencies: [] },
  ];
  dbState.lines = [{ id: 10, name: "L10", maxConcurrentOrders: 1, capacityPerHour: 60 }];
  dbState.assignments = {
    10: [
      { assignment: { lineId: 10, orderIndex: 0, stationId: 100, cycleTimeTarget: "30" }, process: null },
      { assignment: { lineId: 10, orderIndex: 1, stationId: 101, cycleTimeTarget: "15" }, process: null },
    ],
  };
  dbState.capacity = [
    { lineId: 10, stationId: 100, machineId: null, parallelCapacity: 1, changeoverDefaultMin: 20 },
  ];
}

beforeEach(() => {
  seed();
  runApsSolverMock.mockReset();
  delete process.env.APS_SOLVER_ENABLED;
});

describe("generateApsSchedule — fallback paths", () => {
  it("APS disabled → heuristic fallback, valid DRAFT items", async () => {
    const out = await generateApsSchedule({ lineId: 10 });
    expect(out.solverMode).toBe("fallback_heuristic");
    expect(out.payload.kpiSummary.solverMode).toBe("fallback_heuristic");
    expect(out.payload.items.length).toBeGreaterThan(0);
    // heuristic items carry null APS columns
    expect(out.payload.items[0].stationId).toBeNull();
    expect(runApsSolverMock).not.toHaveBeenCalled();
  });

  it("APS enabled but solver returns null (ortools missing/timeout) → fallback", async () => {
    process.env.APS_SOLVER_ENABLED = "true";
    runApsSolverMock.mockResolvedValue(null);
    const out = await generateApsSchedule({ lineId: 10 });
    expect(runApsSolverMock).toHaveBeenCalledOnce();
    expect(out.solverMode).toBe("fallback_heuristic");
    expect(out.payload.items.length).toBeGreaterThan(0);
  });
});

describe("generateApsSchedule — cpsat path", () => {
  it("maps a valid solver result into a cpsat payload with stationId/setup", async () => {
    process.env.APS_SOLVER_ENABLED = "true";
    runApsSolverMock.mockImplementation(async (model: any) => ({
      status: "OPTIMAL",
      solverMode: "cpsat",
      items: [
        { productionOrderId: 1, lineId: 10, stationId: 100, productModelId: 50,
          suggestedStartMin: 0, suggestedEndMin: 60, setupMinutes: 0, sequenceIndex: 0 },
        { productionOrderId: 1, lineId: 10, stationId: 101, productModelId: 50,
          suggestedStartMin: 60, suggestedEndMin: 90, setupMinutes: 20, sequenceIndex: 0 },
        { productionOrderId: 2, lineId: 10, stationId: 100, productModelId: 51,
          suggestedStartMin: 90, suggestedEndMin: 120, setupMinutes: 20, sequenceIndex: 1 },
      ],
      objective: { makespanMin: 120, totalTardinessMin: 0, totalSetupMin: 40 },
    }));

    const out = await generateApsSchedule({ lineId: 10 });
    expect(out.solverMode).toBe("cpsat");
    expect(out.payload.kpiSummary.solverMode).toBe("cpsat");
    expect(out.payload.kpiSummary.objective?.makespanMin).toBe(120);
    // 2 distinct orders → 2 aggregated items
    expect(out.payload.items).toHaveLength(2);
    const o1 = out.payload.items.find((i) => i.productionOrderId === 1)!;
    expect(o1.stationId).toBe(101); // last op wins
    expect(o1.setupMinutes).toBe(20);
    expect(o1.suggestedStart.getTime()).toBeLessThan(o1.suggestedEnd.getTime());
  });

  it("returns a FIFO baseline KPI for compare regardless of solver mode", async () => {
    const out = await generateApsSchedule({ lineId: 10 });
    expect(out.baseline).toHaveProperty("makespanHours");
    expect(out.baseline).toHaveProperty("lateOrders");
    expect(typeof out.baseline.lateOrders).toBe("number");
  });
});

describe("HITL / DRAFT safety", () => {
  // Match only `import ... from "...commandDispatcher..."` / writeTags — doc
  // comments mentioning them (the safety note) are allowed.
  const importsModule = (src: string, name: string) =>
    new RegExp(`(import|require)[^\\n]*${name}`, "i").test(
      // strip block + line comments first
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
    );

  it("apsService source does NOT import commandDispatcher or writeTags", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "server", "services", "apsService.ts"), "utf-8");
    expect(importsModule(src, "commandDispatcher")).toBe(false);
    expect(importsModule(src, "writeTags")).toBe(false);
  });

  it("apsSolver source does NOT import commandDispatcher or writeTags", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "server", "services", "apsSolver.ts"), "utf-8");
    expect(importsModule(src, "commandDispatcher")).toBe(false);
    expect(importsModule(src, "writeTags")).toBe(false);
  });
});
