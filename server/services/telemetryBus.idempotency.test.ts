/**
 * doc 44 W0-D / G2.9 — ot_telemetry replay idempotency (telemetryBus side).
 *
 * Proves the main-DB fallback insert path:
 *   - the insert chain uses .onConflictDoNothing() (replay-safe once migration
 *     0247's unique index uq_ot_telemetry_device_metric_ts is in force)
 *   - replaying the SAME batch does NOT throw and reports success (rows are
 *     "persisted or already present") — so store-and-forward never re-buffers a
 *     replayed batch into an infinite loop
 *   - only ONE physical row lands per (deviceId, metric, ts)
 *
 * The fake DB emulates PG's ON CONFLICT DO NOTHING: duplicate natural keys are
 * silently skipped, never thrown. TSDB is mocked off → the bus takes this path.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// TSDB disabled → main-DB fallback (the path under test).
vi.mock("../db/timescale", () => ({
  insertOtTelemetryRows: vi.fn(async () => null),
}));

// Fake main DB emulating ON CONFLICT DO NOTHING on (deviceId, metric, ts).
const physicalRows: any[] = [];
const seenKeys = new Set<string>();
const insertValues = vi.fn((rows: any[]) => ({
  onConflictDoNothing: async () => {
    for (const r of rows) {
      const ts = r.ts instanceof Date ? r.ts.getTime() : new Date(r.ts).getTime();
      const key = `${r.deviceId}|${r.metric}|${ts}`;
      if (r.deviceId != null && seenKeys.has(key)) continue; // conflict → skipped, NO throw
      seenKeys.add(key);
      physicalRows.push(r);
    }
    return undefined;
  },
}));
const fakeDb = {
  insert: () => ({ values: insertValues }),
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
};
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fakeDb) }));
vi.mock("../_core/socket", () => ({ emitTelemetrySamples: vi.fn() }));

import { ingestTelemetry, type CanonicalSample } from "./telemetryBus";

function sample(tsMillis: number): CanonicalSample {
  return {
    ts: new Date(tsMillis),
    machineId: 5, // pre-resolved → no machineId lookup
    deviceId: "ADP-1",
    protocol: "modbus",
    metric: "temperature",
    value: 42,
    meta: { adapterId: 1, tagKey: "temperature" },
  };
}

beforeEach(() => {
  physicalRows.length = 0;
  seenKeys.clear();
  insertValues.mockClear();
  delete process.env.TELEMETRY_BATCH_ENABLED;
  delete process.env.OT_STORE_FORWARD_ENABLED;
});

describe("telemetryBus — G2.9 idempotent fallback insert", () => {
  it("insert chain calls .onConflictDoNothing() (replay-safe SQL shape)", async () => {
    const persisted = await ingestTelemetry([sample(1000)]);
    expect(persisted).toBe(1);
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(physicalRows).toHaveLength(1);
  });

  it("replaying the SAME batch does NOT throw and reports success (no re-buffer signal)", async () => {
    const p1 = await ingestTelemetry([sample(1000)]);
    const p2 = await ingestTelemetry([sample(1000)]); // exact replay (same deviceId/metric/ts)
    expect(p1).toBe(1);
    // "persisted or already present" — an all-duplicate batch counts as success so
    // store-and-forward does NOT treat the replay as a DB failure and re-buffer it.
    expect(p2).toBe(1);
    expect(physicalRows).toHaveLength(1); // only ONE physical row
  });

  it("mixed batch: fresh rows land, duplicate rows are skipped silently", async () => {
    await ingestTelemetry([sample(1000)]);
    const persisted = await ingestTelemetry([sample(1000), sample(2000)]);
    expect(persisted).toBe(2); // batch accepted
    expect(physicalRows).toHaveLength(2); // 1000 deduped, 2000 fresh
  });
});
