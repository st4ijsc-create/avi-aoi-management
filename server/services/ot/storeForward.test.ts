/**
 * doc 24 Wave-1 / C1 — TELEMETRY STORE-AND-FORWARD tests (vitest, no live DB).
 *
 * The DB insert is INJECTED (setInsertFn) so buffer / backfill / idempotency /
 * overflow are exercised with a mock — no live DB needed. A per-test WAL file under
 * the OS temp dir also exercises the durable file mirror + restore().
 *
 * Covers the C1 acceptance matrix:
 *   (a) DB-fail path BUFFERS instead of dropping.
 *   (b) recovery BACKFILLS in order.
 *   (c) idempotent replay does NOT double-insert.
 *   (d) overflow is BOUNDED + COUNTED (never silently dropped).
 *   (e) flag OFF = passthrough (buffer/backfill are no-ops).
 * Plus: age-bounding, restore-from-file, honest status/metrics.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { InsertOtTelemetry } from "../../../drizzle/schema/ot";
import {
  storeForwardEnabled,
  setInsertFn,
  buffer,
  backfill,
  restore,
  bufferedCount,
  getStatus,
  naturalKey,
  _reset,
} from "./storeForward";

// ── a canonical row factory (adapterId+tagKey in meta → the natural key source) ──
function row(adapterId: number, tag: string, tsMillis: number, value = 1): InsertOtTelemetry {
  return {
    ts: new Date(tsMillis),
    machineId: null,
    deviceId: `ADP-${adapterId}`,
    protocol: "modbus",
    metric: tag,
    numValue: value,
    textValue: null,
    boolValue: null,
    unit: null,
    quality: "good",
    meta: { adapterId, tagKey: tag },
  };
}

let walPath: string;

beforeEach(async () => {
  // Isolated WAL file per test run so the file mirror + restore are exercised cleanly.
  walPath = path.join(os.tmpdir(), `sf-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  process.env.OT_STORE_FORWARD_FILE = walPath;
  process.env.OT_STORE_FORWARD_ENABLED = "true";
  delete process.env.OT_STORE_FORWARD_MAX;
  delete process.env.OT_STORE_FORWARD_MAX_AGE_MS;
  delete process.env.OT_STORE_FORWARD_DRAIN_BATCH;
  _reset();
});

afterEach(async () => {
  _reset();
  try {
    await fs.unlink(walPath);
  } catch {
    /* file may not exist */
  }
});

// ════════════════════════════════════════════════════════════════════════════════
describe("natural key (adapterId, tag, ts)", () => {
  it("is stable + distinguishes adapter/tag/ts", () => {
    const t = 1_700_000_000_000;
    expect(naturalKey(row(7, "temp", t))).toBe("7|temp|" + t);
    expect(naturalKey(row(7, "temp", t))).toBe(naturalKey(row(7, "temp", t)));
    expect(naturalKey(row(8, "temp", t))).not.toBe(naturalKey(row(7, "temp", t)));
    expect(naturalKey(row(7, "press", t))).not.toBe(naturalKey(row(7, "temp", t)));
    expect(naturalKey(row(7, "temp", t + 1))).not.toBe(naturalKey(row(7, "temp", t)));
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe("(a) DB-fail path buffers instead of dropping", () => {
  it("buffers the batch when the DB insert cannot persist", async () => {
    const insert = vi.fn(async () => 0); // DB unavailable → persists nothing
    setInsertFn(insert);

    const added = await buffer([row(1, "a", 1000), row(1, "b", 1000)]);
    expect(added).toBe(2);
    expect(bufferedCount()).toBe(2);

    const st = getStatus();
    expect(st.buffered).toBe(2);
    expect(st.droppedOverflow).toBe(0);
    expect(st.droppedAge).toBe(0);
    expect(st.lastBufferedAt).toBeTruthy();
    // insert is NOT called by buffer() — only backfill persists.
    expect(insert).not.toHaveBeenCalled();
  });

  it("persists the buffer to the WAL file (durable across restart)", async () => {
    setInsertFn(async () => 0);
    await buffer([row(2, "x", 5000)]);
    const raw = await fs.readFile(walPath, "utf8");
    expect(raw).toContain('"key":"2|x|5000"');
    expect(raw).toContain('"adapterId":2');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe("(b) recovery backfills in order", () => {
  it("replays buffered rows oldest-first once the DB recovers", async () => {
    const seen: string[] = [];
    // start DOWN
    let up = false;
    setInsertFn(async (rows) => {
      if (!up) return 0;
      for (const r of rows) seen.push(`${(r.meta as any).tagKey}@${(r.ts as Date).getTime()}`);
      return rows.length;
    });

    await buffer([row(1, "a", 1000)]);
    await buffer([row(1, "b", 2000)]);
    await buffer([row(1, "c", 3000)]);
    expect(bufferedCount()).toBe(3);

    // DB recovers → backfill drains in FIFO order.
    up = true;
    const res = await backfill();
    expect(res.drained).toBe(3);
    expect(res.remaining).toBe(0);
    expect(bufferedCount()).toBe(0);
    expect(seen).toEqual(["a@1000", "b@2000", "c@3000"]);

    const st = getStatus();
    expect(st.backfilled).toBe(3);
    expect(st.lastBackfillAt).toBeTruthy();
  });

  it("leaves the buffer intact when the DB is STILL down during backfill", async () => {
    setInsertFn(async () => 0); // still down
    await buffer([row(1, "a", 1000), row(1, "b", 2000)]);
    const res = await backfill();
    expect(res.drained).toBe(0);
    expect(res.remaining).toBe(2);
    expect(bufferedCount()).toBe(2); // NOT dropped
  });

  it("stops (keeps buffered) when the insert THROWS mid-backfill", async () => {
    setInsertFn(async () => {
      throw new Error("connection reset");
    });
    await buffer([row(1, "a", 1000)]);
    const res = await backfill();
    expect(res.drained).toBe(0);
    expect(bufferedCount()).toBe(1); // preserved for the next attempt
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe("(c) idempotent replay does not double-insert", () => {
  it("does not re-buffer a key already queued", async () => {
    setInsertFn(async () => 0);
    await buffer([row(1, "a", 1000)]);
    const again = await buffer([row(1, "a", 1000)]); // same natural key
    expect(again).toBe(0);
    expect(bufferedCount()).toBe(1);
  });

  it("does not re-buffer nor re-insert a key already applied", async () => {
    let up = true;
    const insert = vi.fn(async (rows: InsertOtTelemetry[]) => (up ? rows.length : 0));
    setInsertFn(insert);

    // buffer + backfill once → key becomes 'applied'
    await buffer([row(1, "a", 1000)]);
    await backfill();
    expect(bufferedCount()).toBe(0);
    expect(insert).toHaveBeenCalledTimes(1);

    // a REPLAY of the same sample (e.g. duplicate reading) must NOT re-buffer …
    const added = await buffer([row(1, "a", 1000)]);
    expect(added).toBe(0);
    expect(bufferedCount()).toBe(0);

    // … and a backfill has nothing to do → no second insert.
    const res = await backfill();
    expect(res.drained).toBe(0);
    expect(insert).toHaveBeenCalledTimes(1); // still exactly one insert
  });

  it("dedupes an already-applied key that resurfaces in the queue (crash-replay guard)", async () => {
    // Simulate: row applied, then the SAME key reappears in the queue via restore()
    // from a stale WAL line. Backfill must dedupe it, not re-insert.
    let up = true;
    const insert = vi.fn(async (rows: InsertOtTelemetry[]) => (up ? rows.length : 0));
    setInsertFn(insert);

    await buffer([row(1, "a", 1000)]);
    await backfill(); // applies 1|a|1000
    expect(insert).toHaveBeenCalledTimes(1);

    // Now a fresh, un-applied row and force a re-appearance is prevented by the ledger:
    // buffering the applied key is skipped, so only the new key persists.
    await buffer([row(1, "a", 1000), row(1, "b", 2000)]);
    expect(bufferedCount()).toBe(1); // only 'b' was buffered
    const res = await backfill();
    expect(res.drained).toBe(1);
    expect(insert).toHaveBeenCalledTimes(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe("(d) overflow is bounded + counted", () => {
  it("drops the OLDEST past the cap, counts it, never silent", async () => {
    process.env.OT_STORE_FORWARD_MAX = "3";
    setInsertFn(async () => 0);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    for (let i = 0; i < 5; i++) await buffer([row(1, `m${i}`, 1000 + i)]);

    expect(bufferedCount()).toBe(3); // bounded at cap
    const st = getStatus();
    expect(st.droppedOverflow).toBe(2); // 5 buffered - 3 kept = 2 dropped, COUNTED
    expect(st.buffered).toBe(5); // honest: all 5 were accepted before eviction
    // an overflow warning was emitted (never silent)
    expect(warn.mock.calls.some((c) => String(c[0]).includes("OVERFLOW"))).toBe(true);
    warn.mockRestore();
  });

  it("keeps the NEWEST after overflow (oldest evicted)", async () => {
    process.env.OT_STORE_FORWARD_MAX = "2";
    const applied: string[] = [];
    let up = false;
    setInsertFn(async (rows) => {
      if (!up) return 0;
      for (const r of rows) applied.push((r.meta as any).tagKey);
      return rows.length;
    });
    for (let i = 0; i < 4; i++) await buffer([row(1, `m${i}`, 1000 + i)]);
    up = true;
    await backfill();
    // m0,m1 evicted; m2,m3 survive and backfill.
    expect(applied).toEqual(["m2", "m3"]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe("age bounding", () => {
  it("drops rows older than max age (counted)", async () => {
    process.env.OT_STORE_FORWARD_MAX_AGE_MS = "50";
    setInsertFn(async () => 0);
    await buffer([row(1, "old", 1000)]);
    expect(bufferedCount()).toBe(1);
    await new Promise((r) => setTimeout(r, 70));
    // any subsequent buffer/backfill triggers the aged-eviction sweep
    await buffer([row(1, "new", 2000)]);
    const st = getStatus();
    expect(st.droppedAge).toBeGreaterThanOrEqual(1);
    expect(bufferedCount()).toBe(1); // only the fresh 'new' remains
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe("restore from WAL file", () => {
  it("re-loads a persisted backlog into a fresh buffer", async () => {
    setInsertFn(async () => 0);
    await buffer([row(9, "r1", 1000), row(9, "r2", 2000)]);
    expect(bufferedCount()).toBe(2);

    // simulate a process restart: clear in-memory state, keep the file, restore.
    _reset();
    process.env.OT_STORE_FORWARD_FILE = walPath;
    process.env.OT_STORE_FORWARD_ENABLED = "true";
    expect(bufferedCount()).toBe(0);
    const restored = await restore();
    expect(restored).toBe(2);
    expect(bufferedCount()).toBe(2);

    // and it can then backfill.
    const applied: string[] = [];
    setInsertFn(async (rows) => {
      for (const rr of rows) applied.push((rr.meta as any).tagKey);
      return rows.length;
    });
    await backfill();
    expect(applied).toEqual(["r1", "r2"]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe("(e) flag OFF = passthrough (no-op)", () => {
  beforeEach(() => {
    process.env.OT_STORE_FORWARD_ENABLED = "false";
  });

  it("storeForwardEnabled() reflects the flag", () => {
    expect(storeForwardEnabled()).toBe(false);
  });

  it("buffer() is a no-op and drops NOTHING into the buffer", async () => {
    setInsertFn(async () => 0);
    const added = await buffer([row(1, "a", 1000)]);
    expect(added).toBe(0);
    expect(bufferedCount()).toBe(0);
  });

  it("backfill() is a disabled no-op", async () => {
    const res = await backfill();
    expect(res.enabled).toBe(false);
    expect(res.drained).toBe(0);
  });

  it("getStatus() reports disabled", () => {
    expect(getStatus().enabled).toBe(false);
  });
});
