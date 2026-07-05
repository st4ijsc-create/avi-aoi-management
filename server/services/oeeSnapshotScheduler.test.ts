/**
 * OEE Snapshot Scheduler tests (doc 32 Wave R5).
 *
 * Verifies the periodic OEE snapshot job: it computes + persists via the
 * canonical oeeService path per active machine per period, is IDEMPOTENT (never
 * double-inserts the same machine+period+end), skips machines with no production
 * or no resolvable ideal cycle time, and the cron registration is flag-gated.
 *
 * The three DB reads (active machines / production counts / existing rows) go
 * through db.execute(sql`…`) so they are scripted via a single execute mock (the
 * biRouter.test.ts discipline); oeeService compute/persist/resolve are mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  execMock: vi.fn(),
  computeOEE: vi.fn(),
  persist: vi.fn(),
  resolveIdeal: vi.fn(),
}));

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => ({ execute: h.execMock })),
}));

vi.mock("./oeeService", () => ({
  computeOEE: h.computeOEE,
  persistOEEMetric: h.persist,
  resolveIdealCycleTimeSec: h.resolveIdeal,
}));

import {
  runOeeSnapshotNow,
  periodWindow,
  startOeeSnapshotScheduler,
  getOeeSnapshotSchedulerStatus,
} from "./oeeSnapshotScheduler";

const FROM = new Date("2026-06-02T00:00:00.000Z");
const TO = new Date("2026-06-02T01:00:00.000Z");

/** Script the 3 execute reads in order: machines, counts, existing. */
function scriptReads(machines: unknown[], counts: unknown[], existing: unknown[]) {
  h.execMock
    .mockResolvedValueOnce(machines)
    .mockResolvedValueOnce(counts)
    .mockResolvedValueOnce(existing);
}

beforeEach(() => {
  h.execMock.mockReset();
  h.computeOEE.mockReset();
  h.persist.mockReset();
  h.resolveIdeal.mockReset();
  h.computeOEE.mockResolvedValue({
    machineId: 1,
    windowStart: FROM,
    windowEnd: TO,
    states: { PT: 60, SB: 0, ET: 0, SD: 0, UD: 0, NS: 0, totalWindow: 60, equipmentUptime: 60, operationsTime: 60 },
    availability: 1,
    performance: 0.9,
    quality: 0.95,
    oee: 0.855,
    totalCount: 100,
    goodCount: 95,
    rejectCount: 5,
    idealCycleTimeSec: 12,
  });
  h.persist.mockResolvedValue(1);
});

describe("runOeeSnapshotNow — compute + persist per machine/period", () => {
  it("snapshots machines with production; skips machines with none", async () => {
    scriptReads(
      [{ id: 1, code: "M1" }, { id: 2, code: "M2" }],
      [
        { machine_id: 1, total: 100, good: 95, avg_cycle: 10 },
        { machine_id: 2, total: 0, good: 0, avg_cycle: null },
      ],
      [],
    );
    h.resolveIdeal.mockResolvedValue(12);

    const stats = await runOeeSnapshotNow({ periodType: "HOUR", from: FROM, to: TO });

    expect(stats.machines).toBe(2);
    expect(stats.snapshotted).toBe(1);
    expect(stats.skippedNoProduction).toBe(1);
    expect(stats.errors).toBe(0);

    expect(h.computeOEE).toHaveBeenCalledTimes(1);
    expect(h.computeOEE.mock.calls[0][0]).toMatchObject({
      machineId: 1,
      totalCount: 100,
      goodCount: 95,
      idealCycleTimeSec: 12,
      from: FROM,
      to: TO,
    });
    expect(h.persist).toHaveBeenCalledTimes(1);
    expect(h.persist.mock.calls[0][0]).toMatchObject({ machineCode: "M1", periodType: "HOUR" });
  });

  it("is idempotent — never double-inserts an existing machine+period+end", async () => {
    scriptReads(
      [{ id: 1, code: "M1" }],
      [{ machine_id: 1, total: 100, good: 95, avg_cycle: 10 }],
      [{ machine_id: 1 }], // already snapshotted for this exact period end
    );
    h.resolveIdeal.mockResolvedValue(12);

    const stats = await runOeeSnapshotNow({ periodType: "HOUR", from: FROM, to: TO });

    expect(stats.snapshotted).toBe(0);
    expect(stats.skippedDuplicate).toBe(1);
    expect(h.computeOEE).not.toHaveBeenCalled();
    expect(h.persist).not.toHaveBeenCalled();
  });

  it("falls back to the observed average cycle time when no ideal is configured", async () => {
    scriptReads(
      [{ id: 1, code: "M1" }],
      [{ machine_id: 1, total: 40, good: 39, avg_cycle: 8.5 }],
      [],
    );
    h.resolveIdeal.mockResolvedValue(null);

    const stats = await runOeeSnapshotNow({ periodType: "HOUR", from: FROM, to: TO });

    expect(stats.snapshotted).toBe(1);
    expect(h.computeOEE.mock.calls[0][0].idealCycleTimeSec).toBe(8.5);
  });

  it("skips a machine with production but no resolvable ideal (no fabricated Performance)", async () => {
    scriptReads(
      [{ id: 1, code: "M1" }],
      [{ machine_id: 1, total: 40, good: 39, avg_cycle: null }],
      [],
    );
    h.resolveIdeal.mockResolvedValue(null);

    const stats = await runOeeSnapshotNow({ periodType: "HOUR", from: FROM, to: TO });

    expect(stats.snapshotted).toBe(0);
    expect(stats.skippedNoIdeal).toBe(1);
    expect(h.persist).not.toHaveBeenCalled();
  });

  it("counts a per-machine failure without aborting the run", async () => {
    scriptReads(
      [{ id: 1, code: "M1" }, { id: 2, code: "M2" }],
      [
        { machine_id: 1, total: 10, good: 10, avg_cycle: 5 },
        { machine_id: 2, total: 20, good: 18, avg_cycle: 6 },
      ],
      [],
    );
    h.resolveIdeal.mockResolvedValue(5);
    h.computeOEE.mockRejectedValueOnce(new Error("boom")); // machine 1 fails

    const stats = await runOeeSnapshotNow({ periodType: "HOUR", from: FROM, to: TO });

    expect(stats.errors).toBe(1);
    expect(stats.snapshotted).toBe(1); // machine 2 still snapshotted
  });
});

describe("periodWindow", () => {
  it("HOUR window is the last completed UTC hour", () => {
    const w = periodWindow("HOUR", new Date("2026-06-02T03:37:12.000Z"));
    expect(w.from.toISOString()).toBe("2026-06-02T02:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-06-02T03:00:00.000Z");
  });

  it("DAY window is the last completed UTC day", () => {
    const w = periodWindow("DAY", new Date("2026-06-02T03:37:12.000Z"));
    expect(w.from.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-06-02T00:00:00.000Z");
  });
});

describe("flag gating", () => {
  it("scheduler is disabled by default (OEE_SNAPSHOT_ENABLED unset) — start is a no-op", () => {
    startOeeSnapshotScheduler();
    const st = getOeeSnapshotSchedulerStatus();
    expect(st.enabled).toBe(false);
    expect(st.running).toBe(false);
  });
});
