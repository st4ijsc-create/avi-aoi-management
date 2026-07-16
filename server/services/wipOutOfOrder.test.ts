/**
 * doc 51 CASE #2 — WIP out-of-order replay guard, REAL-DB integration test.
 *
 * PROBLEM: when a machine loses network then replays buffered inspections, the
 * events arrive out of chronological order. The pre-guard upsertWipUnit was
 * LAST-WRITE-WINS, so the LAST-processed event (not the CHRONOLOGICALLY-newest)
 * won — wip_tracking.currentStationId ended up STALE.
 *
 * This test drives ingestInspectionToWip against the isolated test DB
 * (vitest.setup.ts forces DATABASE_URL to <db>_test) replaying three inspections
 * in the processing order T3 → T1 → T2 (inspection times T1<T2<T3):
 *
 *   - GUARD ON  (default): the LIVE state must reflect T3 (newest time), NOT T2
 *     (last processed). This is the mutation sentinel — deleting/neutering the
 *     guard collapses to last-write-wins and lands on T2 → this test goes RED.
 *   - GUARD OFF (WIP_OUT_OF_ORDER_GUARD=false): legacy last-write-wins is
 *     preserved, so the live state lands on T2 — pinned so the flag's fallback
 *     stays byte-compatible.
 *
 * Honest skip: when the test DB is unreachable or the uq_wip_serial partial
 * unique index is missing, the suite is skipped (not silently green).
 *
 * Known limitations (documented, NOT covered here):
 *   - Equal timestamps still advance (`>=`), i.e. a genuine same-instant retest
 *     is last-write-wins on the tie.
 *   - Dwell out-of-order is guarded by SKIPPING the late leg (see recordDwell);
 *     it does not reconstruct the correct historical dwell, only avoids the
 *     clamped-to-zero corruption.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { sql, and, eq } from "drizzle-orm";
import { getDb } from "../db/connection";
import { ingestInspectionToWip } from "./wipIngestService";
import { wipTracking } from "../../drizzle/schema";

const SERIAL = `OOO-CASE2-${Date.now()}`;
const S1 = 9101; // station of the OLDEST inspection (T1)
const S2 = 9102; // station of the MIDDLE inspection (T2), processed LAST
const S3 = 9103; // station of the NEWEST inspection (T3), processed FIRST
const M1 = 8101;
const M2 = 8102;
const M3 = 8103;

const T1 = new Date("2026-07-16T08:00:00.000Z");
const T2 = new Date("2026-07-16T08:05:00.000Z");
const T3 = new Date("2026-07-16T08:10:00.000Z");

function asRows(res: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(res)) return res as Array<Record<string, unknown>>;
  const rows = (res as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

// Top-level guard: DB reachable + uq_wip_serial present.
const db = await getDb();
let ready = false;
if (db) {
  try {
    const res = await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'wip_tracking' AND indexname = 'uq_wip_serial'
    `);
    ready = asRows(res).length > 0;
  } catch {
    ready = false;
  }
}
if (!ready) {
  // eslint-disable-next-line no-console
  console.warn("[wipOutOfOrder.test] SKIP — test DB unreachable or uq_wip_serial missing.");
}

/** Replay the three inspections in out-of-order processing sequence T3 → T1 → T2. */
async function replayOutOfOrder(): Promise<void> {
  const base = { serialNumber: SERIAL, overallResult: "OK", productModelId: null, productionOrderId: null } as const;
  // Processed FIRST but newest by inspection time.
  await ingestInspectionToWip({ ...base, inspectionId: 1, at: T3, machineId: M3, stationId: S3 });
  // Late replay — OLDEST inspection.
  await ingestInspectionToWip({ ...base, inspectionId: 2, at: T1, machineId: M1, stationId: S1 });
  // Late replay — MIDDLE inspection, processed LAST.
  await ingestInspectionToWip({ ...base, inspectionId: 3, at: T2, machineId: M2, stationId: S2 });
}

async function liveState(): Promise<{ currentStationId: number | null; currentMachineId: number | null; enteredAt: Date } | undefined> {
  const [row] = await db!
    .select({
      currentStationId: wipTracking.currentStationId,
      currentMachineId: wipTracking.currentMachineId,
      enteredAt: wipTracking.enteredAt,
    })
    .from(wipTracking)
    .where(eq(wipTracking.serialNumber, SERIAL))
    .limit(1);
  return row as any;
}

async function purge(): Promise<void> {
  await db!.execute(sql`DELETE FROM wip_tracking WHERE "serialNumber" = ${SERIAL}`);
  await db!.execute(sql`DELETE FROM station_dwell_time WHERE "serialNumber" = ${SERIAL}`);
}

describe.skipIf(!ready)("WIP out-of-order replay guard (doc 51 CASE #2, real DB)", () => {
  const priorFlag = process.env.WIP_OUT_OF_ORDER_GUARD;

  beforeEach(async () => {
    await purge();
  });

  afterAll(async () => {
    await purge();
    if (priorFlag === undefined) delete process.env.WIP_OUT_OF_ORDER_GUARD;
    else process.env.WIP_OUT_OF_ORDER_GUARD = priorFlag;
  });

  it("GUARD ON (default): live station = T3 (newest by time), NOT T2 (last processed)", async () => {
    delete process.env.WIP_OUT_OF_ORDER_GUARD; // default is ON

    await replayOutOfOrder();

    const st = await liveState();
    expect(st).toBeTruthy();
    // MUTATION SENTINEL: last-write-wins would leave S2/M2 here.
    expect(st!.currentStationId).toBe(S3);
    expect(st!.currentMachineId).toBe(M3);
    // Ordering key advanced to the newest inspection time, not a stale one.
    expect(new Date(st!.enteredAt).getTime()).toBe(T3.getTime());
  });

  it("GUARD ON: an in-order forward move still advances the live station", async () => {
    delete process.env.WIP_OUT_OF_ORDER_GUARD;

    const base = { serialNumber: SERIAL, overallResult: "OK", productModelId: null, productionOrderId: null } as const;
    await ingestInspectionToWip({ ...base, inspectionId: 10, at: T1, machineId: M1, stationId: S1 });
    await ingestInspectionToWip({ ...base, inspectionId: 11, at: T2, machineId: M2, stationId: S2 });
    await ingestInspectionToWip({ ...base, inspectionId: 12, at: T3, machineId: M3, stationId: S3 });

    const st = await liveState();
    expect(st!.currentStationId).toBe(S3); // forward flow not blocked by the guard
    expect(new Date(st!.enteredAt).getTime()).toBe(T3.getTime());
  });

  it("GUARD OFF (WIP_OUT_OF_ORDER_GUARD=false): legacy last-write-wins → T2 (last processed)", async () => {
    process.env.WIP_OUT_OF_ORDER_GUARD = "false";

    await replayOutOfOrder();

    const st = await liveState();
    expect(st).toBeTruthy();
    // Legacy path: the LAST-processed event (T2) wins regardless of its time.
    expect(st!.currentStationId).toBe(S2);
    expect(st!.currentMachineId).toBe(M2);
  });
});
