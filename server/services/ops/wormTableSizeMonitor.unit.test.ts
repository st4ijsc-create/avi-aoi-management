/** doc 81 Dot 11 task G - threshold logic + alert-once behaviour of the WORM size monitor (no DB: a fake executor). */
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WORM_THRESHOLDS,
  __resetWormAlertStateForTests,
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

/** A fake executor: the size query returns what `sizes[table]` says; the recipients query returns two admins. */
function fakeDb(sizes: Record<string, { bytes: number; rows: number }>) {
  return {
    execute: async (q: unknown) => {
      const params = ((q as { queryChunks?: unknown[] }).queryChunks ?? []).filter((c) => typeof c === "string") as string[];
      const text = JSON.stringify(q);
      if (text.includes("FROM public.users")) return [{ id: 1 }, { id: 2 }];
      const tbl = (params.find((p) => p.startsWith("public.")) ?? "").slice(7);
      const s = sizes[tbl];
      return s ? [{ bytes: s.bytes, rows: s.rows }] : [];
    },
  };
}

describe("checkWormTableSizes - alert once per crossing level", () => {
  beforeEach(() => __resetWormAlertStateForTests());
  it("alerts warn once, nothing on the repeat, critical once more, missing tables skipped", async () => {
    const got: Array<{ kind: string; dedupKey: string; recipients: number[] }> = [];
    const sink = async (a: { kind: string; dedupKey: string; recipients: number[] }) => void got.push(a);
    const sizes = { device_owner_changes: { bytes: 150, rows: 1 }, edge_stop_ack_refusals: { bytes: 1, rows: 1 } };
    const tables = ["device_owner_changes", "edge_stop_ack_refusals", "no_such_table"];
    await checkWormTableSizes({ db: fakeDb(sizes) as never, thresholds: T, sink, tables });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ kind: "worm_table_size_warn", dedupKey: "worm_table_size:device_owner_changes:warn", recipients: [1, 2] });
    await checkWormTableSizes({ db: fakeDb(sizes) as never, thresholds: T, sink, tables });
    expect(got).toHaveLength(1); // no spam
    sizes.device_owner_changes = { bytes: 5000, rows: 1 };
    await checkWormTableSizes({ db: fakeDb(sizes) as never, thresholds: T, sink, tables });
    expect(got).toHaveLength(2);
    expect(got[1].kind).toBe("worm_table_size_critical");
    await checkWormTableSizes({ db: fakeDb(sizes) as never, thresholds: T, sink, tables });
    expect(got).toHaveLength(2);
  });
  it("a check never throws when the DB fails", async () => {
    const bad = { execute: async () => { throw new Error("db down"); } };
    await expect(checkWormTableSizes({ db: bad as never, thresholds: T, sink: async () => undefined })).resolves.toEqual([]);
  });
});
