/**
 * Doc 31 Đợt D (UX3 — WD-2) — optimistic-lock on measurement-point edits.
 *
 *  • isStaleUpdate: pure compare (Date/string/null, ms granularity).
 *  • updateMeasurementPointDef: compare-and-set — CONFLICT on a stale
 *    expectedUpdatedAt, success on a fresh one, and SKIP (blind update) when it
 *    is absent (backward compatible). updatedAt is bumped on every write.
 *
 * getDb is faked (transaction + select-by-projection + insert + update) so the
 * REAL db-layer logic runs without a database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let currentDb: any;
vi.mock("./connection", () => ({ getDb: vi.fn(async () => currentDb) }));

import { updateMeasurementPointDef, isStaleUpdate, MeasurementPointConflictError } from "./product";

const T0 = new Date("2026-07-05T10:00:00.000Z");
const T1 = new Date("2026-07-05T11:30:00.000Z");

/** Fake db: first (unprojected) select returns [previous]; projected select (MAX
 *  version) returns [{maxVersion:0}]; captures update patches + version inserts. */
function makeFakeDb(previousRow: any | undefined) {
  const updatePatches: any[] = [];
  const versionInserts: any[] = [];
  const tx = {
    select: (proj?: any) => {
      const rows = proj ? [{ maxVersion: 0 }] : previousRow ? [previousRow] : [];
      const chain: any = {
        from: () => chain,
        where: () => chain,
        for: () => chain,
        limit: () => chain,
        then: (res: (v: any[]) => any, rej?: (e: any) => any) => Promise.resolve(rows).then(res, rej),
      };
      return chain;
    },
    insert: () => ({ values: (v: any) => { versionInserts.push(v); return Promise.resolve([{ id: 1 }]); } }),
    update: () => ({
      set: (patch: any) => ({
        where: () => { updatePatches.push(patch); return Promise.resolve([]); },
      }),
    }),
  };
  const db = { transaction: (fn: (t: any) => any) => fn(tx) };
  return { db, updatePatches, versionInserts };
}

describe("isStaleUpdate (pure)", () => {
  it("absent expected → never stale (opt-in)", () => {
    expect(isStaleUpdate(T0, undefined)).toBe(false);
    expect(isStaleUpdate(T0, null)).toBe(false);
  });
  it("equal timestamps (Date, string, cloned) → not stale", () => {
    expect(isStaleUpdate(T0, T0)).toBe(false);
    expect(isStaleUpdate(T0, new Date(T0.getTime()))).toBe(false);
    expect(isStaleUpdate(T0, T0.toISOString())).toBe(false);
  });
  it("different timestamps → stale", () => {
    expect(isStaleUpdate(T0, T1)).toBe(true);
    expect(isStaleUpdate(T0, T1.toISOString())).toBe(true);
  });
  it("missing/invalid current → not stale (safe)", () => {
    expect(isStaleUpdate(null, T0)).toBe(false);
    expect(isStaleUpdate(undefined, T0)).toBe(false);
  });
});

describe("updateMeasurementPointDef — compare-and-set", () => {
  const previous = { id: 42, code: "MP-42", name: "A", updatedAt: T0, lowerLimit: "1", upperLimit: "9" };

  beforeEach(() => { /* per-test db set below */ });

  it("SUCCESS on a fresh expectedUpdatedAt — writes + bumps updatedAt", async () => {
    const f = makeFakeDb({ ...previous });
    currentDb = f.db;
    await updateMeasurementPointDef(42, { name: "A2" }, { expectedUpdatedAt: T0 });
    expect(f.updatePatches).toHaveLength(1);
    expect(f.updatePatches[0].name).toBe("A2");
    expect(f.updatePatches[0].updatedAt).toBeInstanceOf(Date); // bumped
    expect(f.versionInserts).toHaveLength(1); // history snapshot taken
  });

  it("CONFLICT (throws) on a stale expectedUpdatedAt — NO write, NO version row", async () => {
    const f = makeFakeDb({ ...previous });
    currentDb = f.db;
    await expect(
      updateMeasurementPointDef(42, { name: "A2" }, { expectedUpdatedAt: T1 }),
    ).rejects.toBeInstanceOf(MeasurementPointConflictError);
    expect(f.updatePatches).toHaveLength(0);
    expect(f.versionInserts).toHaveLength(0);
  });

  it("the conflict carries the CURRENT row + both timestamps", async () => {
    const f = makeFakeDb({ ...previous });
    currentDb = f.db;
    try {
      await updateMeasurementPointDef(42, { name: "A2" }, { expectedUpdatedAt: T1 });
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as MeasurementPointConflictError;
      expect(e.code).toBe("MP_STALE_WRITE");
      expect(e.current.code).toBe("MP-42");
      expect(e.expectedUpdatedAt).toBe(T1.toISOString());
      expect(e.actualUpdatedAt).toBe(T0.toISOString());
    }
  });

  it("SKIPS the check when expectedUpdatedAt is absent (backward compatible)", async () => {
    const f = makeFakeDb({ ...previous });
    currentDb = f.db;
    await updateMeasurementPointDef(42, { name: "A2" }); // no options → blind update
    expect(f.updatePatches).toHaveLength(1);
    expect(f.updatePatches[0].name).toBe("A2");
  });
});
