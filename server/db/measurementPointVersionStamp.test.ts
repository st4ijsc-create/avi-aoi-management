/**
 * Doc 51 P2 batch-2 (§12.2 #2, migration 0282) — updateMeasurementPointDef STAMPS
 * the snapshot with the product's current pointsConfigVersion, so the spec-gate can
 * later reconstruct limits by the machine-declared version (VERSION-EXACT).
 *
 * getDb is faked so the real db-layer logic runs without a database. Two paths:
 *   • 0282 column PRESENT (probe → true, product version readable) → the version
 *     snapshot row carries productPointsConfigVersion = the product version.
 *   • 0282 column ABSENT (probe → false) → the field is OMITTED (drizzle would
 *     otherwise emit it and break the INSERT on an unmigrated DB) — back-compat.
 *
 * Mutation-test: RED if the stamp is dropped, if it leaks the column when absent,
 * or if it reads the wrong version.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let currentDb: any;
vi.mock("./connection", () => ({ getDb: vi.fn(async () => currentDb) }));

import { updateMeasurementPointDef, _resetMpvConfigVersionColumnProbe } from "./product";

const T0 = new Date("2026-07-15T10:00:00.000Z");
const PREVIOUS = { id: 42, code: "MP-42", name: "A", updatedAt: T0, productModelId: 70, lowerLimit: "1", upperLimit: "9" };

function makeFakeDb(opts: { hasColumn: boolean; productVersion: number | null }) {
  const versionInserts: any[] = [];
  const updatePatches: any[] = [];
  const execute = vi.fn(async () => (opts.hasColumn ? [{ exists: 1 }] : []));
  const tx = {
    select: (proj?: Record<string, unknown>) => {
      let rows: any[];
      if (!proj) rows = [PREVIOUS];
      else if ("maxVersion" in proj) rows = [{ maxVersion: 0 }];
      else if ("v" in proj) rows = [{ v: opts.productVersion }];
      else rows = [];
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
    update: () => ({ set: (patch: any) => ({ where: () => { updatePatches.push(patch); return Promise.resolve([]); } }) }),
  };
  const db = { execute, transaction: (fn: (t: any) => any) => fn(tx) };
  return { db, versionInserts, updatePatches, execute };
}

beforeEach(() => {
  _resetMpvConfigVersionColumnProbe();
});

describe("updateMeasurementPointDef — 0282 version stamp", () => {
  it("★ column PRESENT → snapshot row stamped productPointsConfigVersion = product version", async () => {
    const f = makeFakeDb({ hasColumn: true, productVersion: 6 });
    currentDb = f.db;
    await updateMeasurementPointDef(42, { name: "A2" });
    expect(f.versionInserts).toHaveLength(1);
    expect(f.versionInserts[0].productPointsConfigVersion).toBe(6);
    // the snapshot still captures the PREVIOUS state + version number.
    expect(f.versionInserts[0].version).toBe(1);
    expect(f.versionInserts[0].snapshotJson).toMatchObject({ id: 42, code: "MP-42" });
  });

  it("★ column ABSENT → productPointsConfigVersion OMITTED (no unmigrated-DB break)", async () => {
    const f = makeFakeDb({ hasColumn: false, productVersion: 6 });
    currentDb = f.db;
    await updateMeasurementPointDef(42, { name: "A2" });
    expect(f.versionInserts).toHaveLength(1);
    expect(f.versionInserts[0]).not.toHaveProperty("productPointsConfigVersion");
  });

  it("column present but product version unreadable → stamp null (best-effort, never fails)", async () => {
    const f = makeFakeDb({ hasColumn: true, productVersion: null });
    currentDb = f.db;
    await updateMeasurementPointDef(42, { name: "A2" });
    expect(f.versionInserts).toHaveLength(1);
    expect(f.versionInserts[0].productPointsConfigVersion).toBeNull();
  });
});
