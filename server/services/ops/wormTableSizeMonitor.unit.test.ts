/** doc 81 Dot 11 task G - threshold logic + alert-once behaviour of the WORM size monitor (no DB: a fake executor). */
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WORM_THRESHOLDS,
  defaultWormSink,
  type WormAlert,
  checkWormTableSizes,
  wormCheckIntervalMs,
  wormLevel,
  wormThresholdsFromEnv,
  type WormThresholds,
} from "./wormTableSizeMonitor";

const T: WormThresholds = { warnBytes: 100, criticalBytes: 1000, warnRows: 10, criticalRows: 100 };

describe("wormLevel - the threshold compare", () => {
  it("below both warn thresholds => 0", () => {
    expect(wormLevel(99, 9, T)).toBe(0);
  });
  it("AT the warn threshold counts as crossed (>=), by bytes or by rows", () => {
    expect(wormLevel(100, 0, T)).toBe(1);
    expect(wormLevel(0, 10, T)).toBe(1);
  });
  it("AT the critical threshold counts as critical, by bytes or by rows; critical wins over warn", () => {
    expect(wormLevel(1000, 0, T)).toBe(2);
    expect(wormLevel(0, 100, T)).toBe(2);
    expect(wormLevel(1000, 10, T)).toBe(2);
    expect(wormLevel(999, 99, T)).toBe(1);
  });
});

describe("env configuration", () => {
  it("defaults, overrides, junk falls back, critical never below warn", () => {
    expect(wormThresholdsFromEnv({})).toEqual(DEFAULT_WORM_THRESHOLDS);
    expect(wormThresholdsFromEnv({ WORM_SIZE_WARN_BYTES: "5", WORM_ROWS_WARN: "7" } as never)).toMatchObject({ warnBytes: 5, warnRows: 7 });
    expect(wormThresholdsFromEnv({ WORM_SIZE_WARN_BYTES: "abc", WORM_ROWS_CRITICAL: "-3" } as never)).toEqual(DEFAULT_WORM_THRESHOLDS);
    expect(wormThresholdsFromEnv({ WORM_SIZE_WARN_BYTES: "50", WORM_SIZE_CRITICAL_BYTES: "10" } as never).criticalBytes).toBe(50);
  });
  it("interval: hourly by default, configurable, floored at 60 s", () => {
    expect(wormCheckIntervalMs({})).toBe(3_600_000);
    expect(wormCheckIntervalMs({ WORM_SIZE_CHECK_INTERVAL_MS: "120000" } as never)).toBe(120_000);
    expect(wormCheckIntervalMs({ WORM_SIZE_CHECK_INTERVAL_MS: "5" } as never)).toBe(60_000);
  });
});

const sent = vi.hoisted(() => ({ calls: [] as Array<{ userId: number; payload: Record<string, any>; opts: unknown[] }> }));
vi.mock("../notificationService", () => ({
  sendNotification: async (userId: number, payload: Record<string, any>, ...opts: unknown[]) => {
    sent.calls.push({ userId, payload, opts });
    return { id: sent.calls.length };
  },
}));
vi.mock("../ecosystem/ecosystemEvents", () => ({ publishAnomalyDetected: () => undefined }));

/**
 * A fake executor with PERSISTENT state (the notifications rows): sizes per table, two admins, and the delivered rows that the
 * sink writes - so "a restart" is simply another call with the same store and no in-process memory.
 */
function fakeDb(sizes: Record<string, { bytes: number; rows: number }>, store: Array<{ uid: number; tbl: string; lvl: number }>) {
  return {
    execute: async (q: unknown) => {
      const params = ((q as { queryChunks?: unknown[] }).queryChunks ?? []).filter((c) => typeof c === "string") as string[];
      const text = JSON.stringify(q);
      if (text.includes("FROM public.users")) return [{ id: 1 }, { id: 2 }];
      if (text.includes("public.notifications")) {
        const best = new Map<string, { uid: number; tbl: string; lvl: number }>();
        for (const r of store) {
          const k = `${r.uid}:${r.tbl}`;
          if (!best.has(k) || best.get(k)!.lvl < r.lvl) best.set(k, r);
        }
        return [...best.values()];
      }
      const tbl = (params.find((p) => p.startsWith("public.")) ?? "").slice(7);
      const s = sizes[tbl];
      return s ? [{ bytes: s.bytes, rows: s.rows }] : [];
    },
  };
}
const storingSink = (store: Array<{ uid: number; tbl: string; lvl: number }>, got: WormAlert[]) => async (a: WormAlert) => {
  got.push(a);
  for (const u of a.recipients) store.push({ uid: u, tbl: a.table, lvl: a.level });
};

describe("checkWormTableSizes - alert once per crossing level, persistently", () => {
  const tables = ["device_owner_changes", "edge_stop_ack_refusals", "no_such_table"];
  it("alerts warn once, nothing on the repeat or after a restart, critical once more, missing tables skipped", async () => {
    const store: Array<{ uid: number; tbl: string; lvl: number }> = [];
    const got: WormAlert[] = [];
    const sink = storingSink(store, got);
    const sizes = { device_owner_changes: { bytes: 150, rows: 1 }, edge_stop_ack_refusals: { bytes: 1, rows: 1 } };
    await checkWormTableSizes({ db: fakeDb(sizes, store) as never, thresholds: T, sink, tables });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ kind: "worm_table_size", table: "device_owner_changes", level: 1, recipients: [1, 2] });
    await checkWormTableSizes({ db: fakeDb(sizes, store) as never, thresholds: T, sink, tables });
    expect(got).toHaveLength(1); // no spam
    // "restart": vi.resetModules gives a fresh module instance (no in-process memory); the persisted rows are all that remain
    vi.resetModules();
    const fresh = await import("./wormTableSizeMonitor");
    await fresh.checkWormTableSizes({ db: fakeDb(sizes, store) as never, thresholds: T, sink, tables });
    expect(got).toHaveLength(1);
    sizes.device_owner_changes = { bytes: 5000, rows: 1 };
    await fresh.checkWormTableSizes({ db: fakeDb(sizes, store) as never, thresholds: T, sink, tables });
    expect(got).toHaveLength(2);
    expect(got[1]).toMatchObject({ level: 2 });
    await fresh.checkWormTableSizes({ db: fakeDb(sizes, store) as never, thresholds: T, sink, tables });
    expect(got).toHaveLength(2);
  });
  it("a recipient whose row did not land is tried again; the others are not", async () => {
    const store = [{ uid: 1, tbl: "device_owner_changes", lvl: 1 }];
    const got: WormAlert[] = [];
    await checkWormTableSizes({ db: fakeDb({ device_owner_changes: { bytes: 150, rows: 1 } }, store) as never, thresholds: T, sink: storingSink(store, got), tables });
    expect(got).toHaveLength(1);
    expect(got[0].recipients).toEqual([2]);
  });
  it("a check never throws when the DB fails", async () => {
    const bad = { execute: async () => { throw new Error("db down"); } };
    await expect(checkWormTableSizes({ db: bad as never, thresholds: T, sink: async () => undefined })).resolves.toEqual([]);
  });
});

describe("defaultWormSink - R-11-b: no safety-critical bypass, no cap exemption", () => {
  const base = { kind: "worm_table_size" as const, table: "t", title: "x", message: "y", recipients: [7] };
  it("warn: NORMAL priority, own kind, no options at all (no capExempt, no safetyCritical)", async () => {
    sent.calls.length = 0;
    await defaultWormSink({ ...base, level: 1 });
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0].payload).toMatchObject({ priority: "NORMAL", metadata: { kind: "worm_table_size", table: "t", level: 1 } });
    expect(sent.calls[0].opts).toEqual([]);
  });
  it("critical: HIGH priority, still no capExempt / safetyCritical", async () => {
    sent.calls.length = 0;
    await defaultWormSink({ ...base, level: 2 });
    expect(sent.calls[0].payload).toMatchObject({ priority: "HIGH", metadata: { level: 2 } });
    expect(sent.calls[0].opts).toEqual([]);
  });
});
