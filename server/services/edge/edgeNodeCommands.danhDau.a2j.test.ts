/**
 * SCADA R1b-2b-2a A2(j) AMENDMENT 1 — alertUndeliveredStops: the durable-marker read and its FALLBACK (pure, fake DB; the SQL behaviour itself is
 * measured on `_test` in edgeListDocHet.a2j.db.test.ts).
 *   • marker read OK ⇒ the query carries the marker (`NOT EXISTS … notifications … dedupKey = 'stop_undelivered:request:' || id`), every row read is
 *     alerted with the durable dedup flag;
 *   • the marker read THROWS (e.g. the inbox table is unreadable) ⇒ the sweep never goes silent: it logs and reads again WITHOUT the marker, and
 *     every overdue STOP is still alerted.
 * The fake DB renders each WHERE with drizzle's own PgDialect to tell the two reads apart.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const H = vi.hoisted(() => ({
  markerFails: false,
  queries: [] as string[],
  rows: [] as Array<Record<string, unknown>>,
  alerts: [] as Array<{ dedupKey: string; khuTrungBenVung?: unknown }>,
  /** request ids whose inbox row (the durable marker) "landed" — the fake applies the NOT EXISTS to them */
  marked: new Set<number>(),
  /** when true, an alert's inbox row lands at once (the marker exists from then on) */
  rowsLand: false,
}));

vi.mock("../robot/criticalStopAlert", () => ({
  raiseCriticalStopAlert: vi.fn(async (a: { dedupKey: string; khuTrungBenVung?: unknown }) => {
    H.alerts.push(a);
    if (H.rowsLand) H.marked.add(Number(a.dedupKey.split(":").pop()));
  }),
}));

const dialect = new PgDialect();
vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: () => {
        let where: SQL | undefined;
        let limit = Infinity;
        const b: any = {
          where: (w: SQL) => ((where = w), b),
          orderBy: () => b,
          limit: (n: number) => ((limit = n), b),
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
            Promise.resolve()
              .then(() => {
                const q = where ? dialect.sqlToQuery(where) : { sql: "", params: [] as unknown[] };
                H.queries.push(q.sql);
                const marker = q.sql.includes("NOT EXISTS");
                if (marker && H.markerFails) throw new Error('relation "notifications" is unreadable (test)');
                // honour the keyset cursor (id > $n), the marker (NOT EXISTS) and the LIMIT, in id order — as Postgres would
                const m = /"robot_motion_lock_requests"\."id" > \$(\d+)/.exec(q.sql);
                const sau = m ? Number(q.params[Number(m[1]) - 1]) : -Infinity;
                return H.rows
                  .filter((r) => (r.id as number) > sau && !(marker && H.marked.has(r.id as number)))
                  .sort((x, y) => (x.id as number) - (y.id as number))
                  .slice(0, limit);
              })
              .then(res, rej),
        };
        return b;
      },
    }),
  })),
}));

import { alertUndeliveredStops, khoaCanhBaoStopChuaGiao, __resetUndeliveredStopAlertsForTests, TRAN_CANH_BAO_STOP_MOI_LUOT } from "./edgeNodeCommands";

const old = new Date(Date.now() - 3_600_000);
beforeEach(() => {
  H.markerFails = false;
  H.queries = [];
  H.alerts = [];
  H.marked = new Set();
  H.rowsLand = false;
  H.rows = [
    { id: 7001, edgeNodeId: 3, robotId: null, adapterId: 41, requestedBy: 9, createdAt: old, deliveredAt: null },
    { id: 7002, edgeNodeId: 3, robotId: 12, adapterId: null, requestedBy: 9, createdAt: old, deliveredAt: old },
  ];
  __resetUndeliveredStopAlertsForTests();
});

describe("A2(j) alertUndeliveredStops — durable marker + fallback", () => {
  it("marker read OK ⇒ the query carries the marker; both overdue STOPs alerted with the durable dedup flag", async () => {
    expect(await alertUndeliveredStops()).toBe(2);
    expect(H.queries).toHaveLength(1);
    expect(H.queries[0]).toMatch(/NOT EXISTS \(SELECT 1 FROM notifications n WHERE n\."userId" = "robot_motion_lock_requests"\."requestedBy" AND n\.metadata->>'dedupKey' = \$\d+ \|\| "robot_motion_lock_requests"\."id"::text\)/);
    expect(H.alerts.map((a) => a.dedupKey)).toEqual([khoaCanhBaoStopChuaGiao(7001), khoaCanhBaoStopChuaGiao(7002)]);
    expect(H.alerts.every((a) => a.khuTrungBenVung !== undefined)).toBe(true);
  });

  it("★ the marker read THROWS ⇒ logged, read again WITHOUT the marker, every overdue STOP still alerted (never silent)", async () => {
    H.markerFails = true;
    const logs: string[] = [];
    const err = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    try {
      expect(await alertUndeliveredStops()).toBe(2);
    } finally {
      err.mockRestore();
    }
    expect(H.queries).toHaveLength(2);
    expect(H.queries[0]).toContain("NOT EXISTS");
    expect(H.queries[1]).not.toContain("NOT EXISTS");
    expect(logs.some((l) => l.includes("durable-marker read failed"))).toBe(true);
    expect(H.alerts.map((a) => a.dedupKey)).toEqual([khoaCanhBaoStopChuaGiao(7001), khoaCanhBaoStopChuaGiao(7002)]);
  });
});

describe("A2(j) polish — per-pass alert budget (no burst after an outage; none lost, none twice)", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 9000 + i, edgeNodeId: 3, robotId: null, adapterId: 41, requestedBy: 9, createdAt: old, deliveredAt: null }));

  it("the budget is 200 per pass", () => {
    expect(TRAN_CANH_BAO_STOP_MOI_LUOT).toBe(200);
  });

  it("★ 300 overdue STOPs ⇒ 200 alerted on pass 1 (the oldest), the other 100 on pass 2, none twice; pass 3 ⇒ nothing", async () => {
    H.rows = many(300);
    H.rowsLand = true; // each alert's inbox row lands (the marker)
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await alertUndeliveredStops()).toBe(200);
      const p1 = H.alerts.map((a) => a.dedupKey);
      expect(p1).toEqual(many(200).map((r) => khoaCanhBaoStopChuaGiao(r.id)));
      expect(await alertUndeliveredStops()).toBe(100);
      expect(await alertUndeliveredStops()).toBe(0);
    } finally {
      err.mockRestore();
    }
    const keys = H.alerts.map((a) => a.dedupKey);
    expect(keys).toHaveLength(300);
    expect(new Set(keys).size).toBe(300);
  });

  it("★ the same with a RESTART between the passes (in-process memory gone; only the marker remains) ⇒ still 200 + 100, none twice", async () => {
    H.rows = many(300);
    H.rowsLand = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await alertUndeliveredStops()).toBe(200);
      __resetUndeliveredStopAlertsForTests();
      expect(await alertUndeliveredStops()).toBe(100);
    } finally {
      err.mockRestore();
    }
    expect(new Set(H.alerts.map((a) => a.dedupKey)).size).toBe(300);
    expect(H.alerts).toHaveLength(300);
  });
});
