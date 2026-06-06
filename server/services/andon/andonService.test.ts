/**
 * Sprint F5a — andonService tests (raise/ack/resolve + MTTA/MTTR + idempotency).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: (...a: any[]) => ({ op: "and", a }),
  eq: (col: any, val: any) => ({ op: "eq", col: col?.__c, val }),
  gte: (col: any, val: any) => ({ op: "gte", col: col?.__c, val }),
  isNull: (col: any) => ({ op: "isNull", col: col?.__c }),
  desc: (col: any) => ({ op: "desc", col }),
}));

vi.mock("../../../drizzle/schema", () => ({
  andonEvents: {
    __t: "andon_events",
    id: { __c: "id" },
    reason: { __c: "reason" },
    status: { __c: "status" },
    machineId: { __c: "machineId" },
    stationId: { __c: "stationId" },
    lineId: { __c: "lineId" },
    raisedAt: { __c: "raisedAt" },
    resolvedAt: { __c: "resolvedAt" },
  },
}));

const emitAndonEvent = vi.fn();
vi.mock("../../_core/socket", () => ({ emitAndonEvent: (...a: any[]) => emitAndonEvent(...a) }));

vi.mock("../auditTrailService", () => ({
  AUDIT_ACTIONS: { CREATE: "create", UPDATE: "update" },
  createAuditContext: () => ({}),
  logCrudOperation: vi.fn(async () => ({ id: 1 })),
}));

// In-memory andon_events store with a programmable fake DB.
let store: any[] = [];
let seq = 1;

function matches(pred: any, row: any): boolean {
  if (!pred) return true;
  if (pred.op === "and") return pred.a.every((p: any) => matches(p, row));
  if (pred.op === "eq") return row[pred.col] === pred.val;
  if (pred.op === "gte") return new Date(row[pred.col]).getTime() >= new Date(pred.val).getTime();
  if (pred.op === "isNull") return row[pred.col] == null;
  return true;
}

function fakeDb() {
  return {
    select: () => ({
      from: () => {
        let preds: any[] = [];
        const builder: any = {
          where: (p: any) => { preds.push(p); return builder; },
          orderBy: () => builder,
          limit: async (_n: number) => store.filter((r) => preds.every((p) => matches(p, r))),
          then: (resolve: any, reject?: any) =>
            Promise.resolve(store.filter((r) => preds.every((p) => matches(p, r)))).then(resolve, reject),
        };
        return builder;
      },
    }),
    insert: () => ({
      values: (vals: any) => ({
        returning: async () => {
          const row = { id: seq++, escalationLevel: 0, ...vals, raisedAt: vals.raisedAt ?? new Date() };
          store.push(row);
          return [row];
        },
      }),
    }),
    update: () => ({
      set: (patch: any) => ({
        where: (pred: any) => ({
          returning: async () => {
            const updated: any[] = [];
            for (const r of store) {
              if (matches(pred, r)) { Object.assign(r, patch); updated.push(r); }
            }
            return updated;
          },
        }),
      }),
    }),
  };
}

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => fakeDb()) }));

import { raiseAndon, acknowledgeAndon, resolveAndon } from "./andonService";

beforeEach(() => {
  store = [];
  seq = 1;
  emitAndonEvent.mockClear();
});

describe("andonService", () => {
  it("raise → emits + persists 'raised'", async () => {
    const row = await raiseAndon({ state: "red", reason: "quality", title: "T", machineId: 5 }, { id: 9 });
    expect(row.status).toBe("raised");
    expect(row.raisedBySystem).toBe(false);
    expect(emitAndonEvent).toHaveBeenCalledTimes(1);
  });

  it("acknowledge stamps MTTA (>=0)", async () => {
    const raised = await raiseAndon({ state: "red", reason: "quality", title: "T", machineId: 5 }, { id: 9 });
    // backdate raisedAt 30s so mtta > 0
    store[0].raisedAt = new Date(Date.now() - 30_000);
    const ack = await acknowledgeAndon(raised.id, 7);
    expect(ack?.status).toBe("acknowledged");
    expect(ack?.acknowledgedBy).toBe(7);
    expect(ack?.mttaSeconds).toBeGreaterThanOrEqual(29);
  });

  it("resolve stamps MTTR (>=0)", async () => {
    const raised = await raiseAndon({ state: "yellow", reason: "material", title: "T2", machineId: 6 }, { id: 9 });
    store[0].raisedAt = new Date(Date.now() - 60_000);
    const res = await resolveAndon(raised.id, 8, "fixed");
    expect(res?.status).toBe("resolved");
    expect(res?.resolvedBy).toBe(8);
    expect(res?.mttrSeconds).toBeGreaterThanOrEqual(59);
  });

  it("idempotency: re-raise same machine+reason within window updates, not duplicates", async () => {
    await raiseAndon({ state: "red", reason: "quality", title: "First", machineId: 5, raisedBySystem: true });
    await raiseAndon({ state: "red", reason: "quality", title: "Second", machineId: 5, raisedBySystem: true });
    const open = store.filter((r) => r.status === "raised");
    expect(open).toHaveLength(1);
    expect(open[0].title).toBe("Second"); // refreshed in place
  });

  it("different reason on same machine creates a separate Andon", async () => {
    await raiseAndon({ state: "red", reason: "quality", title: "Q", machineId: 5, raisedBySystem: true });
    await raiseAndon({ state: "red", reason: "safety", title: "S", machineId: 5, raisedBySystem: true });
    expect(store.filter((r) => r.status === "raised")).toHaveLength(2);
  });
});
