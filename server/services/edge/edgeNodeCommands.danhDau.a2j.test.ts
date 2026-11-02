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
}));

vi.mock("../robot/criticalStopAlert", () => ({
  raiseCriticalStopAlert: vi.fn(async (a: { dedupKey: string; khuTrungBenVung?: unknown }) => {
    H.alerts.push(a);
  }),
}));

const dialect = new PgDialect();
vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: () => {
        let where: SQL | undefined;
        const b: any = {
          where: (w: SQL) => ((where = w), b),
          orderBy: () => b,
          limit: () => b,
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
            Promise.resolve()
              .then(() => {
                const text = where ? dialect.sqlToQuery(where).sql : "";
                H.queries.push(text);
                if (text.includes("NOT EXISTS") && H.markerFails) throw new Error('relation "notifications" is unreadable (test)');
                return H.rows;
              })
              .then(res, rej),
        };
        return b;
      },
    }),
  })),
}));

import { alertUndeliveredStops, khoaCanhBaoStopChuaGiao, __resetUndeliveredStopAlertsForTests } from "./edgeNodeCommands";

const old = new Date(Date.now() - 3_600_000);
beforeEach(() => {
  H.markerFails = false;
  H.queries = [];
  H.alerts = [];
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
