/**
 * Sprint G2.4 — bom DB layer tests (consume clamp + status transitions).
 *
 * Focused on the stock-decrement helpers' arithmetic/clamp + status flips,
 * which carry the safety-relevant logic. A minimal fake-db backs select/update.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;
const feeders: Row[] = [];
const lots: Row[] = [];

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __k: col.__name, __v: val, __op: "eq" }),
  and: (...ps: any[]) => ({ __and: ps.filter(Boolean) }),
  asc: (col: any) => ({ __asc: col.__name }),
  desc: (col: any) => ({ __desc: col.__name }),
  isNull: (col: any) => ({ __k: col.__name, __op: "isNull" }),
  lte: (a: any, b: any) => ({ __op: "lte", __a: a.__name, __b: b.__name }),
  sql: () => ({}),
}));

function matches(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__and) return pred.__and.every((p: any) => matches(row, p));
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  if (pred.__op === "isNull") return row[pred.__k] == null;
  if (pred.__op === "lte") return Number(row[pred.__a]) <= Number(row[pred.__b]);
  return true;
}

function arrFor(t: any): Row[] {
  return t.__table === "feeder_materials" ? feeders : lots;
}

function makeFakeDb() {
  const builder = (t: any) => {
    let pred: any = null;
    const q: any = {
      where: (p: any) => { pred = p; return q; },
      orderBy: () => q,
      limit: async (_n: number) => arrFor(t).filter((r) => matches(r, pred)).slice(0, _n),
      then: (resolve: any) => resolve(arrFor(t).filter((r) => matches(r, pred))),
    };
    return q;
  };
  return {
    select: () => ({ from: (t: any) => builder(t) }),
    update: (t: any) => ({
      set: (vals: Row) => ({
        where: (pred: any) => {
          for (const r of arrFor(t).filter((row) => matches(row, pred))) Object.assign(r, vals);
          return Promise.resolve();
        },
      }),
    }),
  };
}

vi.mock("./connection", () => ({ getDb: async () => makeFakeDb() }));

// schema tables only need __name on columns + __table marker for the fake db.
vi.mock("../../drizzle/schema", () => {
  const col = (n: string) => ({ __name: n });
  const tbl = (name: string, cols: string[]) => {
    const t: any = { __table: name };
    for (const c of cols) t[c] = col(c);
    return t;
  };
  return {
    bomDefinitions: tbl("bom_definitions", ["id", "productModelId", "code", "version", "status", "deletedAt"]),
    bomLineItems: tbl("bom_line_items", ["id", "bomId", "componentCode"]),
    feederMaterials: tbl("feeder_materials", ["id", "machineId", "qtyOnFeeder", "reorderLevel", "status", "componentCode", "supplierLotId"]),
    componentInstallations: tbl("component_installations", ["id", "serialNumber", "componentCode", "supplierLotId"]),
    supplierLots: tbl("supplier_lots", ["id", "quantity", "remainingQuantity", "status"]),
  };
});

import { consumeFeederMaterial, consumeSupplierLot } from "./bom";

beforeEach(() => {
  feeders.length = 0;
  lots.length = 0;
});

describe("G2.4 — consumeFeederMaterial", () => {
  it("decrements and flags reorder when remaining ≤ reorderLevel", async () => {
    feeders.push({ id: 1, qtyOnFeeder: "10", reorderLevel: "3", status: "active" });
    const r = await consumeFeederMaterial(1, 8);
    expect(r).toMatchObject({ found: true, remaining: 2, reorderFlag: true });
    expect(feeders[0].qtyOnFeeder).toBe("2");
  });

  it("clamps at 0 and marks depleted on over-consume", async () => {
    feeders.push({ id: 2, qtyOnFeeder: "1", reorderLevel: "0", status: "active" });
    const r = await consumeFeederMaterial(2, 5);
    expect(r).toMatchObject({ found: true, remaining: 0, status: "depleted" });
    expect(feeders[0].qtyOnFeeder).toBe("0");
  });

  it("returns found:false for a missing feeder", async () => {
    expect(await consumeFeederMaterial(999, 1)).toMatchObject({ found: false });
  });
});

describe("G2.4 — consumeSupplierLot", () => {
  it("seeds remaining from quantity when null, then decrements", async () => {
    lots.push({ id: 1, quantity: "5", remainingQuantity: null, status: "received" });
    const r = await consumeSupplierLot(1, 2);
    expect(r).toMatchObject({ found: true, remaining: 3, status: "received" });
  });

  it("clamps at 0 and flips status to 'consumed'", async () => {
    lots.push({ id: 2, quantity: "5", remainingQuantity: "1", status: "received" });
    const r = await consumeSupplierLot(2, 10);
    expect(r).toMatchObject({ found: true, remaining: 0, status: "consumed" });
    expect(lots[0].status).toBe("consumed");
  });
});
