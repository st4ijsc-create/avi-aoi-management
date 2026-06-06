/**
 * G2.5a APS solver — PURE unit tests (no Python, no DB).
 * Covers buildApsModel (op chain, durations, precedence, dependency edges,
 * changeover, horizon) and parseApsResult (minute→Date mapping, per-order
 * aggregation). Also runApsSolver timeout/error behaviour via a mocked spawn.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// ── Mock child_process.spawn with a controllable fake child ─────
class FakeChild extends EventEmitter {
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  kill() { this.killed = true; }
}
let lastChild: FakeChild | null = null;
let spawnThrows = false;
const spawnSpy = vi.fn(() => {
  if (spawnThrows) throw new Error("spawn ENOENT");
  lastChild = new FakeChild();
  return lastChild;
});
vi.mock("child_process", () => ({ spawn: (...a: any[]) => spawnSpy(...a) }));

import {
  buildApsModel, parseApsResult, runApsSolver, isApsEnabled,
  resolveApsCommand,
  type ApsModel, type ApsRawResult,
} from "./apsSolver";
import type { SchedulableOrder } from "./productionSchedulingService";

const EPOCH = new Date("2026-06-01T00:00:00.000Z").getTime();

function order(partial: Partial<SchedulableOrder> & { id: number }): SchedulableOrder {
  return {
    id: partial.id,
    orderCode: partial.orderCode ?? `O-${partial.id}`,
    productName: "p",
    lineId: partial.lineId ?? 1,
    lineName: "L1",
    priority: partial.priority ?? 3,
    targetQuantity: partial.targetQuantity ?? 100,
    actualQuantity: 0,
    scheduledStartDate: partial.scheduledStartDate ?? new Date(EPOCH),
    scheduledEndDate: null,
    dueDate: partial.dueDate ?? null,
    status: partial.status ?? "pending",
    dependencies: partial.dependencies ?? [],
    estimatedHours: partial.estimatedHours,
  };
}

describe("buildApsModel", () => {
  it("builds one op per process assignment with cycleTime×qty duration (ceil min)", () => {
    const model = buildApsModel({
      orders: [order({ id: 1, lineId: 10, targetQuantity: 120 })],
      assignmentsByLine: {
        10: [
          { lineId: 10, orderIndex: 0, stationId: 100, cycleTimeTargetSec: 30 }, // 30*120/60=60min
          { lineId: 10, orderIndex: 1, stationId: 101, cycleTimeTargetSec: 15 }, // 15*120/60=30min
        ],
      },
      capacity: [],
    });
    expect(model.orders).toHaveLength(1);
    const ops = model.orders[0].ops;
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ stationId: 100, orderIndex: 0, durationMin: 60 });
    expect(ops[1]).toMatchObject({ stationId: 101, orderIndex: 1, durationMin: 30 });
  });

  it("sorts ops by orderIndex (precedence) regardless of input order", () => {
    const model = buildApsModel({
      orders: [order({ id: 1, lineId: 10 })],
      assignmentsByLine: {
        10: [
          { lineId: 10, orderIndex: 2, stationId: 102, cycleTimeTargetSec: 6 },
          { lineId: 10, orderIndex: 0, stationId: 100, cycleTimeTargetSec: 6 },
          { lineId: 10, orderIndex: 1, stationId: 101, cycleTimeTargetSec: 6 },
        ],
      },
      capacity: [],
    });
    expect(model.orders[0].ops.map((o) => o.orderIndex)).toEqual([0, 1, 2]);
  });

  it("falls back to a single synthetic-station op when no process map", () => {
    const model = buildApsModel({
      orders: [order({ id: 5, lineId: 7, targetQuantity: 200 })],
      assignmentsByLine: {},
      capacity: [],
    });
    expect(model.orders[0].ops).toHaveLength(1);
    expect(model.orders[0].ops[0].stationId).toBe(-7); // synthetic per-line station
  });

  it("carries dependency edges and productModelId for changeover", () => {
    const model = buildApsModel({
      orders: [
        order({ id: 1, lineId: 10, dependencies: [] }),
        order({ id: 2, lineId: 10, dependencies: [1] }),
      ],
      assignmentsByLine: { 10: [{ lineId: 10, orderIndex: 0, stationId: 100, cycleTimeTargetSec: 6 }] },
      capacity: [],
      productModelByOrder: { 1: 50, 2: 51 },
    });
    expect(model.orders.find((o) => o.id === 2)!.dependencies).toEqual([1]);
    expect(model.orders.find((o) => o.id === 1)!.productModelId).toBe(50);
  });

  it("uses capacity changeoverDefaultMin as the changeover when present", () => {
    const model = buildApsModel({
      orders: [order({ id: 1 })],
      assignmentsByLine: { 1: [{ lineId: 1, orderIndex: 0, stationId: 1, cycleTimeTargetSec: 6 }] },
      capacity: [{ lineId: 1, stationId: 1, machineId: null, parallelCapacity: 1, changeoverDefaultMin: 25 }],
    });
    expect(model.changeoverMin).toBe(25);
  });

  it("computes a horizon that bounds a fully serialized schedule", () => {
    const model = buildApsModel({
      orders: [
        order({ id: 1, lineId: 1, targetQuantity: 60 }), // 6*60/60 = 6 min
        order({ id: 2, lineId: 1, targetQuantity: 60 }),
      ],
      assignmentsByLine: { 1: [{ lineId: 1, orderIndex: 0, stationId: 1, cycleTimeTargetSec: 6 }] },
      capacity: [],
      changeoverMin: 10,
    });
    // 2 ops × 6 min + 2 × 10 changeover = 32, plus release 0 → >= sum
    expect(model.horizonMin).toBeGreaterThanOrEqual(32);
  });

  it("excludes completed/cancelled orders from the model", () => {
    const model = buildApsModel({
      orders: [
        order({ id: 1, status: "completed" }),
        order({ id: 2, status: "cancelled" }),
        order({ id: 3, status: "pending" }),
      ],
      assignmentsByLine: {},
      capacity: [],
    });
    expect(model.orders.map((o) => o.id)).toEqual([3]);
  });
});

describe("parseApsResult", () => {
  const model: ApsModel = {
    scheduleEpoch: EPOCH,
    horizonMin: 1000,
    changeoverMin: 10,
    weights: { lateness: 4, makespan: 1, setup: 1 },
    maxTimeSec: 20,
    orders: [],
  };

  it("maps solver minutes back to absolute Date slots", () => {
    const raw: ApsRawResult = {
      status: "OPTIMAL",
      solverMode: "cpsat",
      items: [
        { productionOrderId: 1, lineId: 10, stationId: 100, productModelId: 50,
          suggestedStartMin: 0, suggestedEndMin: 60, setupMinutes: 0, sequenceIndex: 0 },
      ],
      objective: { makespanMin: 60, totalTardinessMin: 0, totalSetupMin: 0 },
    };
    const parsed = parseApsResult(model, raw);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].suggestedStart.getTime()).toBe(EPOCH);
    expect(parsed.items[0].suggestedEnd.getTime()).toBe(EPOCH + 60 * 60_000);
    expect(parsed.objective.makespanMin).toBe(60);
  });

  it("aggregates multi-op orders into one item (earliest start → latest end)", () => {
    const raw: ApsRawResult = {
      status: "FEASIBLE",
      solverMode: "cpsat",
      items: [
        { productionOrderId: 1, lineId: 10, stationId: 100, productModelId: 50,
          suggestedStartMin: 0, suggestedEndMin: 30, setupMinutes: 0, sequenceIndex: 0 },
        { productionOrderId: 1, lineId: 10, stationId: 101, productModelId: 50,
          suggestedStartMin: 30, suggestedEndMin: 90, setupMinutes: 10, sequenceIndex: 1 },
      ],
      objective: {},
    };
    const parsed = parseApsResult(model, raw);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].suggestedStart.getTime()).toBe(EPOCH);
    expect(parsed.items[0].suggestedEnd.getTime()).toBe(EPOCH + 90 * 60_000);
    expect(parsed.items[0].stationId).toBe(101); // last op wins
    expect(parsed.items[0].setupMinutes).toBe(10); // summed
  });
});

describe("runApsSolver (mocked spawn)", () => {
  beforeEach(() => {
    spawnThrows = false;
    spawnSpy.mockClear();
    lastChild = null;
  });

  const tinyModel: ApsModel = {
    scheduleEpoch: EPOCH, horizonMin: 100, changeoverMin: 0,
    weights: { lateness: 1, makespan: 1, setup: 1 }, maxTimeSec: 1, orders: [],
  };

  it("resolves null when spawn throws (python missing)", async () => {
    spawnThrows = true;
    const res = await runApsSolver(tinyModel);
    expect(res).toBeNull();
  });

  it("resolves null on non-zero exit", async () => {
    const p = runApsSolver(tinyModel);
    lastChild!.emit("exit", 1);
    expect(await p).toBeNull();
  });

  it("resolves null on error event", async () => {
    const p = runApsSolver(tinyModel);
    lastChild!.emit("error", new Error("boom"));
    expect(await p).toBeNull();
  });

  it("resolves null on infeasible/error status from script", async () => {
    const p = runApsSolver(tinyModel);
    lastChild!.stdout.emit("data", JSON.stringify({ status: "INFEASIBLE", items: [] }));
    lastChild!.emit("exit", 0);
    expect(await p).toBeNull();
  });

  it("parses a valid FEASIBLE result on exit 0", async () => {
    const p = runApsSolver(tinyModel);
    const payload = {
      status: "FEASIBLE", solverMode: "cpsat",
      items: [{ productionOrderId: 1, lineId: 1, stationId: 1, productModelId: null,
        suggestedStartMin: 0, suggestedEndMin: 5, setupMinutes: 0, sequenceIndex: 0 }],
      objective: { makespanMin: 5 },
    };
    lastChild!.stdout.emit("data", JSON.stringify(payload));
    lastChild!.emit("exit", 0);
    const res = await p;
    expect(res?.status).toBe("FEASIBLE");
    expect(res?.items).toHaveLength(1);
  });

  it("SIGKILLs and resolves null on timeout (no exit emitted)", async () => {
    vi.useFakeTimers();
    process.env.APS_SOLVER_TIMEOUT_MS = "50";
    const p = runApsSolver(tinyModel);
    vi.advanceTimersByTime(60);
    const res = await p;
    expect(res).toBeNull();
    expect(lastChild!.killed).toBe(true);
    delete process.env.APS_SOLVER_TIMEOUT_MS;
    vi.useRealTimers();
  });
});

describe("isApsEnabled / resolveApsCommand", () => {
  it("is OFF by default and ON only for 'true'", () => {
    delete process.env.APS_SOLVER_ENABLED;
    expect(isApsEnabled()).toBe(false);
    process.env.APS_SOLVER_ENABLED = "false";
    expect(isApsEnabled()).toBe(false);
    process.env.APS_SOLVER_ENABLED = "true";
    expect(isApsEnabled()).toBe(true);
    delete process.env.APS_SOLVER_ENABLED;
  });

  it("appends the script path; honours APS_SOLVER_CMD override", () => {
    delete process.env.APS_SOLVER_CMD;
    const def = resolveApsCommand();
    expect(def.args[def.args.length - 1]).toContain("aps_solver.py");

    process.env.APS_SOLVER_CMD = "python3 -X utf8";
    const ov = resolveApsCommand();
    expect(ov.cmd).toBe("python3");
    expect(ov.args[0]).toBe("-X");
    expect(ov.args[ov.args.length - 1]).toContain("aps_solver.py");
    delete process.env.APS_SOLVER_CMD;
  });
});
