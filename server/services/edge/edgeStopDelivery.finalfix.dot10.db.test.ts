/**
 * doc 81 Đợt 10 final fix wave — I-3 (ruling R-10-br), central's side on the REAL `_test` DB (central kit):
 *   • edgeNodeReachability — a node that pulled THIS process within 3 × pullMs is reachable; an older pull is not; with no pull
 *     seen here its DB heartbeat decides (fresh ⇒ reachable, stale / never ⇒ not);
 *   • alertUndeliveredStops (the sweep) — a STOP head not acknowledged within the ack deadline (3 × pullMs + slack) raises a
 *     DURABLE critical alert ("stop_undelivered", deduplicated per request), once per request in this process; an acked STOP
 *     or one still inside its deadline raises nothing. The alert sink is replaced by a recorder (criticalStopAlert).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupKit, type Kit } from "./__edgeCentralKit.dot10";

const alerts = vi.hoisted(() => ({ list: [] as Array<{ kind: string; dedupKey: string; message: string; recipients: number[] }> }));
vi.mock("../robot/criticalStopAlert", () => ({
  raiseCriticalStopAlert: async (a: { kind: string; dedupKey: string; message: string; recipients: number[] }) => {
    alerts.list.push(a);
  },
}));

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
let k: Kit;

describe.skipIf(!onTest)("doc 81 Đợt 10 final fix wave I-3 — reachability + the undelivered-STOP alert (real _test DB)", () => {
  beforeAll(async () => {
    k = await setupKit("FFI3");
  }, 120_000);
  afterAll(async () => {
    await k?.teardown();
  }, 120_000);
  beforeEach(() => {
    alerts.list.length = 0;
  });

  it("★ reachability: a recent pull ⇒ reachable; an old pull ⇒ not; no pull here ⇒ the heartbeat decides", async () => {
    const m = await import("./edgeNodeCommands");
    m.__resetEdgeNodePullsForTests();
    const now = Date.now();
    m.noteEdgeNodePull(k.ids.nodeA, now - 1_000);
    expect(await m.edgeNodeReachability(k.ids.nodeA, now)).toMatchObject({ reachable: true, basis: "pull" });
    m.noteEdgeNodePull(k.ids.nodeA, now - 3 * m.edgeNodePullMs() - 1_000);
    expect(await m.edgeNodeReachability(k.ids.nodeA, now)).toMatchObject({ reachable: false, basis: "pull" });
    // node B: no pull seen here ⇒ its DB heartbeat (a naive timestamp the app writes in UTC — drizzle convention)
    await k.sql`UPDATE edge_nodes SET "lastHeartbeatAt" = (now() AT TIME ZONE 'UTC') WHERE id = ${k.ids.nodeB}`;
    expect(await m.edgeNodeReachability(k.ids.nodeB)).toMatchObject({ reachable: true, basis: "heartbeat" });
    await k.sql`UPDATE edge_nodes SET "lastHeartbeatAt" = (now() AT TIME ZONE 'UTC') - interval '10 minutes' WHERE id = ${k.ids.nodeB}`;
    expect(await m.edgeNodeReachability(k.ids.nodeB)).toMatchObject({ reachable: false, basis: "heartbeat" });
    await k.sql`UPDATE edge_nodes SET "lastHeartbeatAt" = NULL WHERE id = ${k.ids.nodeB}`;
    expect(await m.edgeNodeReachability(k.ids.nodeB)).toMatchObject({ reachable: false, basis: "none" });
  });

  it("★ a STOP not acknowledged within the deadline ⇒ ONE durable critical alert per request; inside the deadline / acked ⇒ none", async () => {
    const m = await import("./edgeNodeCommands");
    // a STOP created past the deadline (inserted with an old createdAt, as edgeCommands.dot10 does — avi_app cannot UPDATE it)
    const [ro] = await k.sql`SELECT "ownerEpoch" FROM robots WHERE id = ${k.ids.robotA}`;
    const [lr] = await k.sql`INSERT INTO robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, reason, "requestedBy", "createdAt", "expiresAt")
      VALUES (${k.ids.robotA}, ${k.ids.nodeA}, ${ro.ownerEpoch}, 'stop', 'console stop (I-3 late)', ${k.u.admin}, now() - (${Math.ceil(m.edgeStopAckDeadlineMs() / 1000) + 5} * interval '1 second'), now() + interval '10 minutes') RETURNING id`;
    const late = Number(lr.id);
    const fresh = (await m.enqueueEdgeDeviceRequest({ kind: "stop", adapterId: k.ids.adapterA, reason: "console stop (I-3 fresh)", requestedBy: k.u.admin2 })).requestId;
    const n = await m.alertUndeliveredStops();
    expect(n).toBeGreaterThanOrEqual(1);
    const mine = alerts.list.filter((a) => a.dedupKey === `stop_undelivered:request:${late}`);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: "stop_undelivered", recipients: [k.u.admin] });
    expect(mine[0].message).toMatch(new RegExp(`#${late}`));
    expect(alerts.list.some((a) => a.dedupKey === `stop_undelivered:request:${fresh}`)).toBe(false);
    // once per request
    await m.alertUndeliveredStops();
    expect(alerts.list.filter((a) => a.dedupKey === `stop_undelivered:request:${late}`)).toHaveLength(1);
    // the fresh one goes overdue later ⇒ its own alert; an acked one never
    const acked = (await m.enqueueEdgeDeviceRequest({ kind: "stop", robotId: k.ids.robotA, reason: "console stop (I-3 acked)", requestedBy: k.u.admin })).requestId;
    const [o] = await k.sql`SELECT "ownerEpoch" FROM robots WHERE id = ${k.ids.robotA}`;
    await k.sql`SELECT public.edge_stop_ack_edge(${acked}, ${k.ids.nodeA}, ${k.ids.robotA}, NULL, ${o.ownerEpoch}, 'done', false, NULL)`;
    await m.alertUndeliveredStops(Date.now() + 3_600_000); // an hour later: the fresh one is overdue now
    expect(alerts.list.filter((a) => a.dedupKey === `stop_undelivered:request:${fresh}`)).toHaveLength(1);
    expect(alerts.list.some((a) => a.dedupKey === `stop_undelivered:request:${acked}`)).toBe(false);
  });

  // (the sweep TIMER is measured in edgeStopSweepTimer.finalfix.dot10.test.ts — behaviour, not source text)
});
