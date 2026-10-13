/**
 * doc 81 Đợt 10 task E — the two SOURCE SEAMS the edge gateway sets (and central never does):
 *   • ot/deviceAdapter.setAdapterSource — on the edge the OT manager's adapters come from the verified config, never the DB;
 *     an edge process with no source gets [] without ever calling getDb; CENTRAL skips adapters owned by an edge node (0374)
 *     — one owner connects / polls / controls a device — and is unchanged when the 0374 columns are missing;
 *   • telemetryBus.setTelemetryPersistFn — rows go to the injected function (HTTP to central on the edge), no DB / TSDB is
 *     touched (machine-id resolution included); a transport failure buffers the rows in the storeForward WAL, and the backfill
 *     replays them through the SAME function.
 * The DB is a recording fake (no Postgres).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

const h = vi.hoisted(() => ({
  getDbCalls: 0,
  adapters: [] as Array<Record<string, unknown>>,
  owned: [] as Array<{ id: number }>,
  ownershipError: null as null | { code: string },
  tables: [] as string[],
}));
vi.mock("../../db/connection", () => ({
  getDb: async () => {
    h.getDbCalls++;
    return {
      select: () => ({
        from: (t: unknown) => {
          const name = String((t as Record<symbol, unknown>)[Symbol.for("drizzle:Name")] ?? "");
          h.tables.push(name);
          const rows = async () => {
            if (name === "device_adapters" && h.tables.filter((x) => x === "device_adapters").length >= 2) {
              if (h.ownershipError) throw h.ownershipError;
              return h.owned;
            }
            if (name === "device_adapters") return h.adapters;
            return [];
          };
          return { where: () => rows() };
        },
      }),
    };
  },
}));
vi.mock("../../db/timescale", () => ({
  insertOtTelemetryRows: async () => {
    throw new Error("TSDB touched");
  },
}));

import { loadEnabledAdapters, setAdapterSource, type RuntimeAdapter } from "../ot/deviceAdapter";
import { ingestTelemetry, setTelemetryPersistFn } from "../telemetryBus";
import * as sf from "../ot/storeForward";
import "../ot"; // registers the drivers (stub)

const adapterRow = (id: number) => ({ id, code: `a${id}`, machineId: null, protocol: "stub", endpoint: "stub://x", connectionOptions: null, pollIntervalMs: 1000, isEnabled: true });

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ["AVI_PROCESS_ROLE", "OT_STORE_FORWARD_ENABLED", "OT_STORE_FORWARD_FILE"]) saved[k] = process.env[k];
  delete process.env.AVI_PROCESS_ROLE;
  h.getDbCalls = 0;
  h.tables.length = 0;
  h.adapters = [adapterRow(1), adapterRow(2), adapterRow(3)];
  h.owned = [];
  h.ownershipError = null;
  setAdapterSource(null);
  setTelemetryPersistFn(null);
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setAdapterSource(null);
  setTelemetryPersistFn(null);
  sf._reset();
});

describe("doc 81 Đợt 10 E — adapter source seam + central filtering", () => {
  it("★ central skips adapters owned by an edge node; nothing owned ⇒ unchanged", async () => {
    expect((await loadEnabledAdapters()).map((a) => a.adapterId)).toEqual([1, 2, 3]);
    h.tables.length = 0;
    h.owned = [{ id: 2 }];
    expect((await loadEnabledAdapters()).map((a) => a.adapterId)).toEqual([1, 3]);
  });

  it("before 0374 (column missing) central is unchanged; any OTHER ownership read error is not swallowed", async () => {
    h.ownershipError = { code: "42703" };
    expect((await loadEnabledAdapters()).map((a) => a.adapterId)).toEqual([1, 2, 3]);
    h.tables.length = 0;
    h.ownershipError = { code: "57P01" };
    await expect(loadEnabledAdapters()).rejects.toMatchObject({ code: "57P01" });
  });

  it("★ the edge: a source answers alone (no DB); an edge process WITHOUT a source gets [] and never calls getDb", async () => {
    const fake = [{ adapterId: 21 } as RuntimeAdapter];
    setAdapterSource(async () => fake);
    expect(await loadEnabledAdapters()).toBe(fake);
    // D fix review 4 (R-10-ay) — central's `includeEdgeOwned` never widens the edge: the source (its own verified config) answers
    expect(await loadEnabledAdapters({ includeEdgeOwned: true })).toBe(fake);
    setAdapterSource(null);
    process.env.AVI_PROCESS_ROLE = "edge";
    expect(await loadEnabledAdapters()).toEqual([]);
    expect(await loadEnabledAdapters({ includeEdgeOwned: true })).toEqual([]);
    expect(h.getDbCalls).toBe(0);
  });
});

describe("doc 81 Đợt 10 E — telemetryBus insert-function seam", () => {
  const sample = (v: number, ts = Date.now()) => ({ ts: new Date(ts), deviceId: "plc-21", protocol: "other" as const, metric: "temp", value: v, meta: { adapterId: 21, tagKey: "temp" } });

  it("★ rows go to the injected function; no DB / TSDB, not even for the machine id", async () => {
    const got: unknown[][] = [];
    setTelemetryPersistFn(async (rows) => (got.push(rows), rows.length));
    expect(await ingestTelemetry([sample(1.5)])).toBe(1);
    expect(got).toHaveLength(1);
    expect(got[0][0]).toMatchObject({ metric: "temp", numValue: 1.5, meta: { adapterId: 21, tagKey: "temp" } });
    expect(h.getDbCalls).toBe(0);
  });

  it("★ central unreachable ⇒ the rows are BUFFERED (storeForward) and the backfill replays them through the same function", async () => {
    process.env.OT_STORE_FORWARD_ENABLED = "true";
    process.env.OT_STORE_FORWARD_FILE = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "edge-sf-")), "wal.jsonl");
    let up = false;
    const sent: unknown[] = [];
    setTelemetryPersistFn(async (rows) => {
      if (!up) throw new Error("central unreachable");
      sent.push(...rows);
      return rows.length;
    });
    expect(await ingestTelemetry([sample(1), sample(2, Date.now() + 1)])).toBe(0);
    expect(sf.bufferedCount()).toBe(2);
    up = true;
    const r = await sf.backfill();
    expect(r).toMatchObject({ drained: 2 });
    expect(sent).toHaveLength(2);
    expect(sf.bufferedCount()).toBe(0);
    expect(h.getDbCalls).toBe(0);
  });
});
