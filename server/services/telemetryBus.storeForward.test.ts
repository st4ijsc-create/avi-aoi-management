/**
 * doc 24 Wave-1 / C1 — telemetryBus × store-and-forward WIRING tests (vitest).
 *
 * Proves the ADDITIVE wiring in ingestTelemetry:
 *   • flag OFF  → behaviour EXACTLY as today: a DB-down batch is NOT buffered (dropped
 *                 as before) — passthrough, store-and-forward never engages.
 *   • flag ON, DB down    → the failed batch is BUFFERED (nothing dropped).
 *   • flag ON, DB recovers → the next healthy ingest opportunistically BACKFILLS the
 *                 backlog through the SAME persist path.
 *
 * The main DB (`../db/connection`) and TSDB (`../db/timescale`) are mocked so no live DB
 * is needed. TSDB is disabled (returns null) so the bus takes the main-DB fallback,
 * whose insert we flip between throwing (down) and succeeding (up).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// TSDB disabled everywhere → bus falls back to the main-DB path we control.
vi.mock("../db/timescale", () => ({
  insertOtTelemetryRows: vi.fn(async () => null),
}));

// Controllable main-DB insert: `dbUp` flips it between throwing and succeeding.
// G2.9: the bus now chains .onConflictDoNothing() onto values(...) — mirror the
// drizzle builder shape (values() returns the builder; the await lands on the
// onConflictDoNothing() result).
let dbUp = false;
const insertedBatches: number[] = [];
const doInsert = async (rows: unknown[]) => {
  if (!dbUp) throw new Error("ECONNREFUSED");
  insertedBatches.push(rows.length);
  return undefined;
};
const insertValues = vi.fn((rows: unknown[]) => ({
  onConflictDoNothing: () => doInsert(rows),
}));
const fakeDb = {
  insert: () => ({ values: insertValues }),
  // resolveMachineId path: select().from().where().limit() → [] (unmapped)
  select: () => ({
    from: () => ({ where: () => ({ limit: async () => [] }) }),
  }),
};
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fakeDb) }));

// socket + fanout are no-ops in test; avoid importing real transports.
vi.mock("../_core/socket", () => ({ emitTelemetrySamples: vi.fn() }));

import { ingestTelemetry, type CanonicalSample } from "./telemetryBus";
import { getStatus, bufferedCount, _reset } from "./ot/storeForward";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

function sample(tag: string, tsMillis: number): CanonicalSample {
  return {
    ts: new Date(tsMillis),
    machineId: 5, // pre-resolved → no DB machineId lookup needed
    deviceId: "ADP-1",
    protocol: "modbus",
    metric: tag,
    value: 1,
    meta: { adapterId: 1, tagKey: tag },
  };
}

let walPath: string;

beforeEach(() => {
  walPath = path.join(os.tmpdir(), `sf-bus-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  process.env.OT_STORE_FORWARD_FILE = walPath;
  dbUp = false;
  insertedBatches.length = 0;
  insertValues.mockClear();
  _reset();
});

afterEach(async () => {
  _reset();
  delete process.env.OT_STORE_FORWARD_ENABLED;
  try { await fs.unlink(walPath); } catch { /* ignore */ }
});

describe("telemetryBus store-and-forward wiring", () => {
  it("flag OFF → DB-down batch is NOT buffered (passthrough, as today)", async () => {
    process.env.OT_STORE_FORWARD_ENABLED = "false";
    const persisted = await ingestTelemetry([sample("a", 1000)]);
    expect(persisted).toBe(0); // insert threw → nothing persisted, as before
    expect(bufferedCount()).toBe(0); // NOT buffered → identical to prior behaviour
  });

  it("flag ON + DB down → batch is buffered, nothing dropped", async () => {
    process.env.OT_STORE_FORWARD_ENABLED = "true";
    await ingestTelemetry([sample("a", 1000), sample("b", 2000)]);
    expect(bufferedCount()).toBe(2);
    expect(getStatus().buffered).toBe(2);
  });

  it("flag ON + recovery → next healthy ingest backfills the backlog", async () => {
    process.env.OT_STORE_FORWARD_ENABLED = "true";

    // DB down → two batches buffered.
    await ingestTelemetry([sample("a", 1000)]);
    await ingestTelemetry([sample("b", 2000)]);
    expect(bufferedCount()).toBe(2);

    // DB recovers → a healthy ingest persists itself AND drains the backlog.
    dbUp = true;
    const persisted = await ingestTelemetry([sample("c", 3000)]);
    expect(persisted).toBe(1); // the live batch landed
    expect(bufferedCount()).toBe(0); // backlog drained
    expect(getStatus().backfilled).toBe(2); // a + b backfilled
    // total persisted batches: the live one + the two backfilled (drained together).
    const total = insertedBatches.reduce((s, n) => s + n, 0);
    expect(total).toBe(3);
  });

  it("flag ON: a fully successful ingest with an empty backlog does not spuriously buffer", async () => {
    process.env.OT_STORE_FORWARD_ENABLED = "true";
    dbUp = true;
    const persisted = await ingestTelemetry([sample("a", 1000)]);
    expect(persisted).toBe(1);
    expect(bufferedCount()).toBe(0);
    expect(getStatus().buffered).toBe(0);
  });
});
