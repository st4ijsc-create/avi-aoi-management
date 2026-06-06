/**
 * G2.5a APS solver — REAL Python integration (opt-in).
 *
 * Spawns the actual scripts/aps_solver.py via the real child_process. Skipped
 * automatically when OR-Tools is not importable in the project .venv so CI / dev
 * machines without the dependency still pass (the heuristic fallback is the
 * guaranteed path; CP-SAT is a bonus).
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import path from "path";
import { resolveApsCommand, runApsSolver, parseApsResult, type ApsModel } from "./apsSolver";

function ortoolsAvailable(): boolean {
  try {
    const { cmd } = resolveApsCommand();
    const r = spawnSync(cmd, ["-c", "import ortools"], { timeout: 15_000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

const HAS_ORTOOLS = ortoolsAvailable();
const EPOCH = new Date("2026-06-01T00:00:00.000Z").getTime();

describe.skipIf(!HAS_ORTOOLS)("APS CP-SAT real integration", () => {
  it("solves a 2-order job-shop with precedence, dependency and changeover", async () => {
    const model: ApsModel = {
      scheduleEpoch: EPOCH,
      horizonMin: 1000,
      changeoverMin: 20,
      weights: { lateness: 4, makespan: 1, setup: 1 },
      maxTimeSec: 5,
      orders: [
        { id: 1, lineId: 10, productModelId: 50, releaseMin: 0, dueMin: 120, dependencies: [],
          ops: [
            { stationId: 100, orderIndex: 0, durationMin: 60 },
            { stationId: 101, orderIndex: 1, durationMin: 30 },
          ] },
        { id: 2, lineId: 10, productModelId: 51, releaseMin: 0, dueMin: 200, dependencies: [1],
          ops: [{ stationId: 100, orderIndex: 0, durationMin: 30 }] },
      ],
    };

    const raw = await runApsSolver(model);
    expect(raw).not.toBeNull();
    expect(["OPTIMAL", "FEASIBLE"]).toContain(raw!.status);

    const parsed = parseApsResult(model, raw!);
    // 2 distinct orders aggregated.
    expect(parsed.items).toHaveLength(2);
    const o1 = parsed.items.find((i) => i.productionOrderId === 1)!;
    const o2 = parsed.items.find((i) => i.productionOrderId === 2)!;
    // Dependency: order 2 starts no earlier than order 1's end.
    expect(o2.suggestedStart.getTime()).toBeGreaterThanOrEqual(o1.suggestedEnd.getTime());
    expect(raw!.objective.makespanMin).toBeGreaterThan(0);
  }, 30_000);
});
