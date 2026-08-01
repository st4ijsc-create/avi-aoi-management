/**
 * W7-1 (doc 44 gap G1.14) — EDGE UNS store-and-forward tests (vitest, no broker).
 *
 * The UNS publisher is INJECTED (setUnsPublishFn) so buffer / backfill / idempotency
 * / overflow / age-bound are exercised with a mock — no live broker needed. Mirrors
 * the C1 telemetry-buffer acceptance matrix, applied to the UNS-publish path:
 *   (a) central-down BUFFERS instead of dropping (the ingest.ts:190-192 gap).
 *   (b) reconnect BACKFILLS in order.
 *   (c) idempotent replay does NOT double-publish.
 *   (d) no loss / no dup across a down→up cycle.
 *   (e) overflow + age bounds are counted (never silent).
 *   (f) flag OFF = passthrough (buffer/backfill are no-ops).
 *   (g) restore-from-file mirror.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  unsStoreForwardEnabled,
  setUnsPublishFn,
  bufferUnsSamples,
  backfillUns,
  unsBufferedCount,
  getUnsStatus,
  restoreUns,
  unsNaturalKey,
  _resetUnsStoreForward,
  type PendingUnsSample,
} from "./storeForward";

function s(deviceId: string, tag: string, tsMs: number, value = 1): PendingUnsSample {
  return {
    deviceId,
    adapterId: 1,
    machineId: null,
    tagKey: tag,
    value,
    quality: "good",
    tsMs,
    sparkplugType: "Double",
    topic: `avi/0/workshop/ot/station/${deviceId}/${tag}`,
  };
}

let walPath: string;

beforeEach(() => {
  walPath = path.join(os.tmpdir(), `sf-uns-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  process.env.EDGE_UNS_STORE_FORWARD_FILE = walPath;
  process.env.EDGE_UNS_STORE_FORWARD_ENABLED = "true";
  delete process.env.EDGE_GATEWAY_MODE;
  delete process.env.EDGE_UNS_STORE_FORWARD_MAX;
  delete process.env.EDGE_UNS_STORE_FORWARD_MAX_AGE_MS;
  delete process.env.EDGE_UNS_STORE_FORWARD_DRAIN_BATCH;
  _resetUnsStoreForward();
});

afterEach(async () => {
  _resetUnsStoreForward();
  try {
    await fs.unlink(walPath);
  } catch {
    /* ignore */
  }
});

describe("edge UNS store-and-forward", () => {
  it("the flag reflects EDGE_GATEWAY_MODE / EDGE_UNS_STORE_FORWARD_ENABLED", () => {
    expect(unsStoreForwardEnabled()).toBe(true);
    process.env.EDGE_UNS_STORE_FORWARD_ENABLED = "false";
    expect(unsStoreForwardEnabled()).toBe(false);
    process.env.EDGE_GATEWAY_MODE = "true";
    expect(unsStoreForwardEnabled()).toBe(true);
  });

  it("(a) buffers when central is down; (b) backfills IN ORDER on reconnect; (d) no loss / no dup", async () => {
    let up = false;
    const sent: string[] = [];
    setUnsPublishFn(async (items) => {
      if (!up) return 0; // central still down → all-or-nothing, keep buffered
      for (const i of items) sent.push(unsNaturalKey(i));
      return items.length;
    });

    // 5 samples arrive while central is down.
    const batch = [s("edge1", "torque", 1000), s("edge1", "torque", 2000), s("edge1", "torque", 3000), s("edge1", "angle", 3000), s("edge1", "ok", 4000)];
    for (const smp of batch) await bufferUnsSamples([smp]);
    expect(unsBufferedCount()).toBe(5);

    // A backfill while STILL down drains nothing (returns 0, leaves the queue).
    const down = await backfillUns();
    expect(down.drained).toBe(0);
    expect(unsBufferedCount()).toBe(5);

    // Reconnect → backfill replays all 5 IN ORDER, exactly once.
    up = true;
    const r = await backfillUns();
    expect(r.drained).toBe(5);
    expect(unsBufferedCount()).toBe(0);
    expect(sent).toEqual(batch.map(unsNaturalKey));
    // no duplicates
    expect(new Set(sent).size).toBe(5);
  });

  it("(c) idempotent replay does NOT double-publish", async () => {
    let up = true;
    const sent: string[] = [];
    setUnsPublishFn(async (items) => {
      if (!up) return 0;
      for (const i of items) sent.push(unsNaturalKey(i));
      return items.length;
    });

    const smp = s("edge1", "torque", 1000);
    await bufferUnsSamples([smp]);
    await backfillUns();
    expect(sent.length).toBe(1);

    // Re-buffer the SAME sample (key already applied) → deduped, nothing re-queued.
    const added = await bufferUnsSamples([smp]);
    expect(added).toBe(0);
    expect(unsBufferedCount()).toBe(0);

    // A second backfill sends nothing more.
    const r = await backfillUns();
    expect(r.drained).toBe(0);
    expect(sent.length).toBe(1);
  });

  it("dedupes duplicate keys on enqueue (same device|tag|ts)", async () => {
    setUnsPublishFn(async () => 0);
    await bufferUnsSamples([s("edge1", "torque", 1000, 1)]);
    await bufferUnsSamples([s("edge1", "torque", 1000, 999)]); // same natural key
    expect(unsBufferedCount()).toBe(1);
  });

  it("(e) overflow drops the OLDEST and COUNTS it (never silent)", async () => {
    process.env.EDGE_UNS_STORE_FORWARD_MAX = "3";
    setUnsPublishFn(async () => 0);
    for (let i = 0; i < 5; i++) await bufferUnsSamples([s("edge1", "torque", 1000 + i)]);
    expect(unsBufferedCount()).toBe(3);
    expect(getUnsStatus().droppedOverflow).toBe(2);
  });

  it("(e) age-bound drops entries past max age and COUNTS them", async () => {
    setUnsPublishFn(async () => 0);
    await bufferUnsSamples([s("edge1", "torque", 1000)]);
    expect(unsBufferedCount()).toBe(1);
    process.env.EDGE_UNS_STORE_FORWARD_MAX_AGE_MS = "2";
    await new Promise((r) => setTimeout(r, 8));
    // A subsequent enqueue triggers evictAged, dropping the aged first entry.
    await bufferUnsSamples([s("edge1", "torque", 5000)]);
    expect(getUnsStatus().droppedAge).toBeGreaterThanOrEqual(1);
    expect(unsBufferedCount()).toBe(1);
  });

  it("(f) flag OFF → buffer + backfill are no-ops (passthrough)", async () => {
    process.env.EDGE_UNS_STORE_FORWARD_ENABLED = "false";
    setUnsPublishFn(async () => 999);
    const added = await bufferUnsSamples([s("edge1", "torque", 1000)]);
    expect(added).toBe(0);
    expect(unsBufferedCount()).toBe(0);
    const r = await backfillUns();
    expect(r.enabled).toBe(false);
    expect(r.drained).toBe(0);
  });

  it("(g) restores the buffer from the WAL file mirror", async () => {
    setUnsPublishFn(async () => 0);
    await bufferUnsSamples([s("edge1", "torque", 1000), s("edge1", "angle", 2000)]);
    expect(unsBufferedCount()).toBe(2);

    // Simulate a restart: clear in-memory state, then restore from the file mirror.
    _resetUnsStoreForward();
    expect(unsBufferedCount()).toBe(0);
    const restored = await restoreUns();
    expect(restored).toBe(2);
    expect(unsBufferedCount()).toBe(2);
  });

  it("keeps the tail buffered when the transport reports the batch not sent (partial safety)", async () => {
    // A publish fn that only 'sends' when a global switch is on; otherwise 0. This
    // asserts the all-or-nothing contract: a 0 return never removes rows.
    let ok = false;
    setUnsPublishFn(async (items) => (ok ? items.length : 0));
    for (let i = 0; i < 4; i++) await bufferUnsSamples([s("edge1", "torque", 1000 + i)]);
    const a = await backfillUns();
    expect(a.drained).toBe(0);
    expect(unsBufferedCount()).toBe(4);
    ok = true;
    const b = await backfillUns();
    expect(b.drained).toBe(4);
    expect(unsBufferedCount()).toBe(0);
  });
});
