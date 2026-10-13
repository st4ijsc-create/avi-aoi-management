/** doc 81 Dot 11 task G - the monitor reads the REAL sizes on the _test DB (read-only). */
import { describe, expect, it } from "vitest";

const onTest = /_test\b/.test(process.env.DATABASE_URL ?? "");

describe.skipIf(!onTest)("WORM size monitor on the real _test DB", () => {
  it("reads pg_total_relation_size / reltuples of the existing WORM tables; a zero threshold flags every table; the table list is not empty", async () => {
    const { getDb } = await import("../../db/connection");
    const { readWormTableSizes, WORM_TABLES } = await import("./wormTableSizeMonitor");
    const db = (await getDb()) as never;
    const sizes = await readWormTableSizes(db, { warnBytes: 1, criticalBytes: 1e15, warnRows: 1e15, criticalRows: 1e15 });
    expect(sizes.length).toBeGreaterThanOrEqual(5);
    for (const s of sizes) {
      expect(WORM_TABLES as readonly string[]).toContain(s.table);
      expect(s.bytes).toBeGreaterThan(0); // an existing table always has a catalog footprint
      expect(s.rowsEstimate).toBeGreaterThanOrEqual(0);
      expect(s.level).toBe(1); // warnBytes=1 => every existing table is at warn
    }
    expect(sizes.map((s) => s.table)).toContain("device_owner_changes");
  }, 60_000);
});
