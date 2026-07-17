/**
 * Doc 51 P3 batch-2 (CASE #8, migration 0284) — upsertStationTrace SCOPE.
 *
 * The upsert keyed on serialNumber ALONE collapsed two different boards (different
 * product models) that share a printed serial into ONE station_traces row, mixing
 * their genealogy. This scopes by (serialNumber, productModelId) — null-safe — and
 * refuses a blank serial.
 *
 * getDb is faked with a tiny in-memory table. drizzle's eq/and/isNull are mocked to
 * emit decodable descriptors so the fake evaluates the REAL where-clause the code
 * builds (this is what makes it a genuine scope test, not a canned-row stub).
 *
 * Mutation-test: RED if the scope reverts to serial-only (board B would overwrite
 * board A → 1 row), if blank serials are no longer skipped, or if the null-model
 * match stops being null-safe (duplicate rows for one board).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: any, val: any) => ({ __op: "eq", name: col?.name, val }),
    isNull: (col: any) => ({ __op: "isNull", name: col?.name }),
    and: (...conds: any[]) => ({ __op: "and", conds }),
  };
});

let currentDb: any;
vi.mock("./connection", () => ({ getDb: vi.fn(async () => currentDb) }));

import { upsertStationTrace } from "./product";

function matches(cond: any, row: any): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.name] === cond.val;
  if (cond.__op === "isNull") return row[cond.name] == null;
  if (cond.__op === "and") return cond.conds.every((c: any) => matches(c, row));
  return true;
}

function makeFakeDb() {
  const store: any[] = [];
  let idSeq = 1;
  const db = {
    select: () => ({
      from: () => ({
        where: (cond: any) => ({
          limit: () => Promise.resolve(store.filter((r) => matches(cond, r)).map((r) => ({ id: r.id }))),
        }),
      }),
    }),
    update: () => ({
      set: (patch: any) => ({
        where: (cond: any) => {
          store.forEach((r) => { if (matches(cond, r)) Object.assign(r, patch); });
          return Promise.resolve([]);
        },
      }),
    }),
    insert: () => ({
      values: (row: any) => ({
        returning: () => {
          const r = { ...row, id: idSeq++ };
          store.push(r);
          return Promise.resolve([{ id: r.id }]);
        },
      }),
    }),
  };
  return { db, store };
}

let store: any[];
beforeEach(() => {
  const f = makeFakeDb();
  currentDb = f.db;
  store = f.store;
});

describe("upsertStationTrace — (serialNumber, productModelId) scope", () => {
  it("★ two boards, same serial, DIFFERENT model → TWO separate traces (no overwrite)", async () => {
    const a = await upsertStationTrace({ serialNumber: "SN1", productModelId: 10, totalDefects: 1 } as any);
    const b = await upsertStationTrace({ serialNumber: "SN1", productModelId: 20, totalDefects: 2 } as any);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
    expect(store).toHaveLength(2);
    // Each board kept its OWN counts — neither clobbered the other.
    expect(store.find((r) => r.productModelId === 10)!.totalDefects).toBe(1);
    expect(store.find((r) => r.productModelId === 20)!.totalDefects).toBe(2);
  });

  it("★ same serial + same model → UPDATE in place (one row)", async () => {
    const a = await upsertStationTrace({ serialNumber: "SN1", productModelId: 10, totalDefects: 1 } as any);
    const b = await upsertStationTrace({ serialNumber: "SN1", productModelId: 10, totalDefects: 5 } as any);
    expect(b).toBe(a);
    expect(store).toHaveLength(1);
    expect(store[0].totalDefects).toBe(5);
  });

  it("★ blank / whitespace serial → SKIPPED (null, nothing written)", async () => {
    expect(await upsertStationTrace({ serialNumber: "", productModelId: 10 } as any)).toBeNull();
    expect(await upsertStationTrace({ serialNumber: "   ", productModelId: 10 } as any)).toBeNull();
    expect(store).toHaveLength(0);
  });

  it("trims the serial before keying + storing", async () => {
    await upsertStationTrace({ serialNumber: "  SN1  ", productModelId: 10 } as any);
    expect(store).toHaveLength(1);
    expect(store[0].serialNumber).toBe("SN1");
    // A subsequent untrimmed write for the same board updates the same row.
    const again = await upsertStationTrace({ serialNumber: "SN1", productModelId: 10, totalDefects: 9 } as any);
    expect(store).toHaveLength(1);
    expect(store[0].totalDefects).toBe(9);
    expect(again).toBe(store[0].id);
  });

  it("null-model board is null-safe idempotent (one row across repeats)", async () => {
    const a = await upsertStationTrace({ serialNumber: "SN2", productModelId: null, totalDefects: 1 } as any);
    const b = await upsertStationTrace({ serialNumber: "SN2", totalDefects: 7 } as any); // productModelId omitted → null
    expect(b).toBe(a);
    expect(store).toHaveLength(1);
    expect(store[0].totalDefects).toBe(7);
  });

  it("a known-model board and a null-model board with the same serial do NOT merge", async () => {
    await upsertStationTrace({ serialNumber: "SN3", productModelId: 10 } as any);
    await upsertStationTrace({ serialNumber: "SN3", productModelId: null } as any);
    expect(store).toHaveLength(2);
  });
});
