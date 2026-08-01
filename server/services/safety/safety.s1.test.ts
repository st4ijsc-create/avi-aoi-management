/**
 * S1-b/S1-d (doc 16 Khối 3) — Safety audit + near-miss advisor tests.
 *
 * Layers:
 *   • PURE: nearMissAdvisor.isNearMiss thresholding.
 *   • DB-FLOW (in-memory fake db): safetyAuditService.record (flag-gated) + queryFeed;
 *     near-miss advisor triggers event + YELLOW Andon below margin, no-ops above,
 *     and is a no-op with the flag off. raiseAndon + socket are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __op: "eq", __k: col?.name, __v: val }),
  and: (...ps: any[]) => ({ __op: "and", __ps: ps.filter(Boolean) }),
  gte: (col: any, val: any) => ({ __op: "gte", __k: col?.name, __v: val }),
  desc: (col: any) => ({ __desc: col?.name }),
  sql: () => ({}),
}));

type Row = Record<string, any>;
const store: Record<string, Row[]> = { safety_events: [] };
const seq: Record<string, number> = {};
function nextId(t: string): number { seq[t] = (seq[t] ?? 0) + 1; return seq[t]; }
function reset() { for (const k of Object.keys(store)) store[k] = []; for (const k of Object.keys(seq)) seq[k] = 0; }
function tableName(t: any): string {
  const sym = Object.getOwnPropertySymbols(t).find((s) => String(s).includes("Name"));
  return sym ? (t as any)[sym] : t?._?.name;
}
function matchPred(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__op === "and") return pred.__ps.every((p: any) => matchPred(row, p));
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  if (pred.__op === "gte") return new Date(row[pred.__k]).getTime() >= new Date(pred.__v).getTime();
  return true;
}
function makeFakeDb() {
  return {
    select: () => ({
      from: (t: any) => {
        const name = tableName(t);
        let pred: any = null; let order: any = null;
        const q: any = {
          where: (p: any) => { pred = p; return q; },
          orderBy: (o: any) => { order = o; return q; },
          limit: async (n: number) => run().slice(0, n),
          then: (resolve: any) => resolve(run()),
        };
        function run(): Row[] {
          let rows = (store[name] ?? []).filter((r) => matchPred(r, pred));
          if (order?.__desc) rows = [...rows].sort((a, b) => (b[order.__desc] ?? 0) - (a[order.__desc] ?? 0));
          return rows;
        }
        return q;
      },
    }),
    insert: (t: any) => ({
      values: (vals: Row) => {
        const name = tableName(t);
        const row = { id: nextId(name), createdAt: new Date(), ...vals };
        store[name].push(row);
        return { returning: async () => [row] };
      },
    }),
    update: (t: any) => ({
      set: (vals: Row) => ({
        where: (pred: any) => ({
          returning: async () => {
            const name = tableName(t);
            const updated = (store[name] ?? []).filter((row) => matchPred(row, pred));
            for (const r of updated) Object.assign(r, vals);
            return updated;
          },
        }),
      }),
    }),
  };
}
vi.mock("../../db/connection", () => ({ getDb: async () => makeFakeDb() }));

// Socket emit + Andon are mocked so the advisor test stays in-memory.
const emitSafetyEvent = vi.fn();
vi.mock("../../_core/socket", () => ({ emitSafetyEvent: (...a: any[]) => emitSafetyEvent(...a) }));
const raiseAndon = vi.fn(async (_input: any) => ({ id: 555 }));
vi.mock("../andon/andonService", () => ({ raiseAndon: (...a: any[]) => raiseAndon(...a) }));
vi.mock("../ot/commandDispatcher", () => ({
  isInterlockAutoBlockEnabled: () => process.env.INTERLOCK_AUTO_BLOCK_ENABLED === "true",
  isOtControlEnabled: () => process.env.OT_CONTROL_ENABLED === "true",
}));

import { record, queryFeed, nearMissTrend } from "./safetyAuditService";
import { isNearMiss, processDetection } from "./nearMissAdvisor";

beforeEach(() => {
  reset();
  emitSafetyEvent.mockClear();
  raiseAndon.mockClear();
  delete process.env.SAFETY_AUDIT_ENABLED;
  delete process.env.INTERLOCK_AUTO_BLOCK_ENABLED;
  delete process.env.OT_CONTROL_ENABLED;
  delete process.env.NEAR_MISS_MARGIN_MM;
});

// ════════════════════════════════════════════════════════════════════════════
// PURE
// ════════════════════════════════════════════════════════════════════════════
describe("isNearMiss (PURE)", () => {
  it("true below margin + sufficient confidence", () => {
    expect(isNearMiss(300, 0.9, 500, 0.5)).toBe(true);
  });
  it("false at/above margin", () => {
    expect(isNearMiss(600, 0.9, 500, 0.5)).toBe(false);
  });
  it("false when confidence too low", () => {
    expect(isNearMiss(100, 0.2, 500, 0.5)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DB-FLOW — safetyAuditService
// ════════════════════════════════════════════════════════════════════════════
describe("safetyAuditService.record (flag-gated)", () => {
  it("flag OFF → no-op", async () => {
    const r = await record({ eventType: "estop", robotId: 7 });
    expect(r.enabled).toBe(false);
    expect(store.safety_events).toHaveLength(0);
  });

  it("flag ON → records + defaults outcome=logged_only + emits", async () => {
    process.env.SAFETY_AUDIT_ENABLED = "true";
    const r = await record({ eventType: "estop", robotId: 7, detectedBy: "telemetry" });
    expect(r.ok).toBe(true);
    expect(r.event?.outcome).toBe("logged_only");
    expect(store.safety_events).toHaveLength(1);
    expect(emitSafetyEvent).toHaveBeenCalledTimes(1);
  });

  it("near_miss eventType auto-flags isNearMiss", async () => {
    process.env.SAFETY_AUDIT_ENABLED = "true";
    const r = await record({ eventType: "near_miss", robotId: 7 });
    expect(r.event?.isNearMiss).toBe(true);
  });

  it("queryFeed filters by near-miss", async () => {
    process.env.SAFETY_AUDIT_ENABLED = "true";
    await record({ eventType: "estop", robotId: 7 });
    await record({ eventType: "near_miss", robotId: 7 });
    const nm = await queryFeed({ isNearMiss: true });
    expect(nm).toHaveLength(1);
    expect(nm[0].eventType).toBe("near_miss");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DB-FLOW — near-miss advisor
// ════════════════════════════════════════════════════════════════════════════
describe("nearMissAdvisor.processDetection (advisory)", () => {
  it("flag OFF → no-op (no event, no Andon)", async () => {
    const r = await processDetection({ distance: 100, confidence: 0.9, source: "vision" });
    expect(r.enabled).toBe(false);
    expect(r.triggered).toBe(false);
    expect(store.safety_events).toHaveLength(0);
    expect(raiseAndon).not.toHaveBeenCalled();
  });

  it("above margin → no-op even with flag on", async () => {
    process.env.SAFETY_AUDIT_ENABLED = "true";
    process.env.NEAR_MISS_MARGIN_MM = "500";
    const r = await processDetection({ distance: 800, confidence: 0.9, source: "vision" });
    expect(r.triggered).toBe(false);
    expect(store.safety_events).toHaveLength(0);
    expect(raiseAndon).not.toHaveBeenCalled();
  });

  it("below margin → records near_miss + raises a YELLOW Andon + proposes (gate closed)", async () => {
    process.env.SAFETY_AUDIT_ENABLED = "true";
    process.env.NEAR_MISS_MARGIN_MM = "500";
    const r = await processDetection({ distance: 200, confidence: 0.95, source: "vision", robotId: 7, stationId: 10 });
    expect(r.triggered).toBe(true);
    expect(r.safetyEventId).toBeDefined();
    expect(store.safety_events[0].eventType).toBe("near_miss");
    expect(raiseAndon).toHaveBeenCalledTimes(1);
    // raised a YELLOW advisory Andon
    expect(raiseAndon.mock.calls[0][0].state).toBe("yellow");
    expect(raiseAndon.mock.calls[0][0].reason).toBe("safety");
    // gate closed (flags off) → proposal documents no command path
    expect(r.proposal?.gateOpen).toBe(false);
  });

  it("proposal reports gateOpen=true when both gate flags are on (still does NOT dispatch)", async () => {
    process.env.SAFETY_AUDIT_ENABLED = "true";
    process.env.NEAR_MISS_MARGIN_MM = "500";
    process.env.INTERLOCK_AUTO_BLOCK_ENABLED = "true";
    process.env.OT_CONTROL_ENABLED = "true";
    const r = await processDetection({ distance: 200, confidence: 0.95, source: "vision" });
    expect(r.triggered).toBe(true);
    expect(r.proposal?.gateOpen).toBe(true);
    // it still only logged + raised an Andon — NO dispatcher import/call exists here.
    expect(store.safety_events).toHaveLength(1);
  });
});
