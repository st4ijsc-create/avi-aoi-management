/**
 * Doc 51 P3 batch-2 (§5.2 P3) — db.revertPointsConfigToVersion reconstruction.
 *
 * getDb is faked so the real db-layer logic runs without a database. Proves:
 *   • VERSION-EXACT pick: to rebuild version V, restore the snapshot with the
 *     SMALLEST 0282 stamp >= V (mirror of resolveGateLimitsForBoard) — NOT the
 *     latest snapshot.
 *   • The version moves FORWARD after a revert (never backwards).
 *   • The pre-revert state is snapshotted (stamped with the current version) so the
 *     revert is auditable + un-revertable.
 *   • Identity/audit columns are NOT restored from the snapshot.
 *   • A point with no 0282-stamped history is SKIPPED (never guessed), reported.
 *   • An out-of-range target throws RevertVersionError; a gone product → null.
 *
 * Mutation-test: RED if the pick direction flips (restores "50" not "9"), if the
 * version is lowered, if identity keys leak into the restore, or if the skip-vs-
 * revert accounting is wrong.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let currentDb: any;
vi.mock("./connection", () => ({ getDb: vi.fn(async () => currentDb) }));

import { revertPointsConfigToVersion, RevertVersionError, _resetMpvConfigVersionColumnProbe } from "./product";

const POINT = {
  id: 42,
  code: "MP-1",
  productModelId: 7,
  name: "Điểm 1",
  upperLimit: "99", // the BAD live value we want to revert away from
  lowerLimit: "1",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-15T00:00:00.000Z"),
};

// Two stamped snapshots: state@v1 (upper "9") and state@v2 (upper "50").
const STAMPED_VERSIONS = [
  { snapshotJson: { id: 42, code: "MP-1", productModelId: 7, upperLimit: "9", lowerLimit: "1" }, productPointsConfigVersion: 1 },
  { snapshotJson: { id: 42, code: "MP-1", productModelId: 7, upperLimit: "50", lowerLimit: "1" }, productPointsConfigVersion: 2 },
];

function makeFakeDb(opts: {
  hasColumn: boolean;
  product: { id: number; code: string; version: number } | null;
  points: any[];
  versions: any[];
  maxVersion?: number;
}) {
  const versionInserts: any[] = [];
  const updateSets: any[] = [];
  const execute = vi.fn(async () => (opts.hasColumn ? [{ exists: 1 }] : []));

  function selectChain(proj?: Record<string, unknown>) {
    let rows: any[];
    if (!proj) rows = opts.points; // full-row select → the product's live points
    else if ("version" in proj) rows = opts.product ? [opts.product] : [];
    else if ("snapshotJson" in proj) rows = opts.versions;
    else if ("maxVersion" in proj) rows = [{ maxVersion: opts.maxVersion ?? 0 }];
    else rows = [];
    const chain: any = {
      from: () => chain,
      where: () => chain,
      for: () => chain,
      limit: () => chain,
      then: (res: (v: any[]) => any, rej?: (e: any) => any) => Promise.resolve(rows).then(res, rej),
    };
    return chain;
  }

  const tx = {
    select: (proj?: Record<string, unknown>) => selectChain(proj),
    insert: () => ({ values: (v: any) => { versionInserts.push(v); return Promise.resolve([{ id: 1 }]); } }),
    update: () => ({
      set: (patch: any) => {
        updateSets.push(patch);
        const w: any = {
          // bumpPointsConfigVersion calls .returning(); the point-restore update awaits .where() directly.
          returning: () => Promise.resolve([{ productModelId: 7, code: "PM-7", version: 4 }]),
          then: (res: (v: any[]) => any, rej?: (e: any) => any) => Promise.resolve([]).then(res, rej),
        };
        return { where: () => w };
      },
    }),
  };
  const db = { execute, transaction: (fn: (t: any) => any) => fn(tx) };
  return { db, versionInserts, updateSets, execute };
}

beforeEach(() => {
  _resetMpvConfigVersionColumnProbe();
});

describe("revertPointsConfigToVersion — VERSION-EXACT reconstruction", () => {
  it("★ revert to v1 restores the v1 snapshot ('9'), not the latest ('50'); version moves FORWARD", async () => {
    const f = makeFakeDb({
      hasColumn: true,
      product: { id: 7, code: "PM-7", version: 3 },
      points: [{ ...POINT }],
      versions: STAMPED_VERSIONS,
      maxVersion: 2,
    });
    currentDb = f.db;

    const res = await revertPointsConfigToVersion(7, 1, { changedBy: 5, changeReason: "bad push" });

    expect(res).toMatchObject({
      productModelId: 7,
      code: "PM-7",
      targetVersion: 1,
      fromVersion: 3,
      newVersion: 4, // atomic forward bump
      pointsReverted: 1,
      pointsUnchanged: 0,
      pointsSkipped: 0,
    });

    // The restore write carried the v1 limit ("9"), NOT the latest snapshot ("50").
    const restore = f.updateSets.find((s) => "upperLimit" in s);
    expect(restore).toBeDefined();
    expect(restore.upperLimit).toBe("9");
    // Identity/audit columns are never restored from the snapshot.
    expect(restore).not.toHaveProperty("id");
    expect(restore).not.toHaveProperty("code");
    expect(restore).not.toHaveProperty("productModelId");

    // The PRE-revert state was snapshotted (stamped with the CURRENT version) so the
    // revert is auditable + un-revertable.
    expect(f.versionInserts).toHaveLength(1);
    expect(f.versionInserts[0].version).toBe(3); // maxVersion(2)+1
    expect(f.versionInserts[0].productPointsConfigVersion).toBe(3); // current version stamp
    expect(f.versionInserts[0].snapshotJson).toMatchObject({ upperLimit: "99" });
    expect(String(f.versionInserts[0].changeReason)).toContain("bad push");
  });

  it("point with NO 0282-stamped history → SKIPPED (never guessed), still bumps forward", async () => {
    const f = makeFakeDb({
      hasColumn: true,
      product: { id: 7, code: "PM-7", version: 3 },
      points: [{ ...POINT }],
      versions: [{ snapshotJson: { upperLimit: "9" }, productPointsConfigVersion: null }], // legacy, unstamped
      maxVersion: 1,
    });
    currentDb = f.db;

    const res = await revertPointsConfigToVersion(7, 1);

    expect(res).toMatchObject({ pointsReverted: 0, pointsUnchanged: 0, pointsSkipped: 1, newVersion: 4 });
    expect(res!.skippedPointIds).toEqual([42]);
    // No restore write happened (only the forward bump).
    expect(f.updateSets.find((s) => "upperLimit" in s)).toBeUndefined();
    expect(f.versionInserts).toHaveLength(0);
  });

  it("point unedited since target (no stamp >= V) → UNCHANGED, not reverted", async () => {
    const f = makeFakeDb({
      hasColumn: true,
      product: { id: 7, code: "PM-7", version: 5 },
      points: [{ ...POINT }],
      // only a snapshot stamped v2 exists; reverting to v4 finds no stamp >= 4.
      versions: [{ snapshotJson: { upperLimit: "9" }, productPointsConfigVersion: 2 }],
      maxVersion: 1,
    });
    currentDb = f.db;

    const res = await revertPointsConfigToVersion(7, 4);
    expect(res).toMatchObject({ pointsReverted: 0, pointsUnchanged: 1, pointsSkipped: 0, newVersion: 4 });
    expect(f.versionInserts).toHaveLength(0);
  });

  it("★ target >= current version → RevertVersionError (version only moves forward)", async () => {
    const f = makeFakeDb({ hasColumn: true, product: { id: 7, code: "PM-7", version: 3 }, points: [], versions: [] });
    currentDb = f.db;
    await expect(revertPointsConfigToVersion(7, 3)).rejects.toBeInstanceOf(RevertVersionError);
    await expect(revertPointsConfigToVersion(7, 9)).rejects.toBeInstanceOf(RevertVersionError);
  });

  it("non-positive target → RevertVersionError (before any DB work)", async () => {
    currentDb = makeFakeDb({ hasColumn: true, product: null, points: [], versions: [] }).db;
    await expect(revertPointsConfigToVersion(7, 0)).rejects.toBeInstanceOf(RevertVersionError);
  });

  it("gone / soft-deleted product → null", async () => {
    const f = makeFakeDb({ hasColumn: true, product: null, points: [], versions: [] });
    currentDb = f.db;
    await expect(revertPointsConfigToVersion(7, 1)).resolves.toBeNull();
  });
});
