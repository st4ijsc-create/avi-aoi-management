/**
 * doc 81 Đợt 10 task A fix review 2 — ruling R-10-i (L-7: a STOP is NEVER dropped). The security scan flagged the round-1 M1
 * change in 0374 ("STOP dropped"). Each path by which a pending STOP request could silently disappear or never execute:
 *   (a) the device moves to CENTRAL: no edge owner to carry to ⇒ the STOP stays PENDING (never auto-acked), is listed by the
 *       view `device_pending_stops` (centralMustExecute), and central acks it ONLY through the guarded
 *       `edge_stop_ack_central(request, outcome done|failed, actor)` — and only while the device is central-owned;
 *   (b) delivery after `expiresAt`: allowed for a STOP (expiry only marks it OVERDUE in the view); lock / clear keep their
 *       expiry; a STOP can never be acked `expired`;
 *   (c) the owner epoch changes WITHOUT a node change (same node, new epoch): the carry fires too — robots and adapters;
 *   (d) the scan's own path: deleting the old edge node CASCADE-deleted its pending STOP rows (the device had moved away, so
 *       the node was deletable) ⇒ an unacknowledged STOP can no longer be deleted by anyone.
 * Real `_test` DB; avi_app through the app pool, the owner (aoi) only where a trigger must be bypassed to reach a path;
 * everything in transactions that are ROLLED BACK.
 */
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
class Rollback extends Error {}
type Tx = postgres.TransactionSql;

async function rolledBack<T>(url: string, body: (tx: Tx) => Promise<T>): Promise<T> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  let out: T | undefined;
  try {
    const [db] = await client`SELECT current_database() AS d`;
    if (!String(db.d).endsWith("_test")) throw new Error(`refused: ${db.d} is not a _test DB`);
    await client.begin(async (tx) => {
      out = await body(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  } finally {
    await client.end({ timeout: 5 });
  }
  return out as T;
}
const asApp = <T>(body: (tx: Tx) => Promise<T>) => rolledBack(DB_URL, body);
function ownerUrl(): string {
  const u = new URL(DB_URL);
  u.username = process.env.MIGRATION_DB_USER ?? "aoi";
  u.password = process.env.MIGRATION_DB_PASSWORD ?? "aoi";
  return u.toString();
}
async function code(tx: Tx, fn: (sp: Tx) => Promise<unknown>): Promise<string | null> {
  try {
    await tx.savepoint((sp) => fn(sp as Tx));
    return null;
  } catch (e) {
    return String((e as { code?: string }).code ?? (e as Error).message);
  }
}
let n = 0;
const tag = () => `__stop10_${Date.now()}_${n++}`;
async function fixture(tx: Tx) {
  const t = tag();
  const [a] = await tx`INSERT INTO public.edge_nodes (code, name, status) VALUES (${t}, ${t}, 'offline') RETURNING id`;
  const [b] = await tx`INSERT INTO public.edge_nodes (code, name, status) VALUES (${t + "b"}, ${t}, 'offline') RETURNING id`;
  const [robot] = await tx`INSERT INTO public.robots (code, name, vendor, endpoint) VALUES (${t}, ${t}, 'sim', 'sim://t') RETURNING id`;
  const [ad] = await tx`INSERT INTO public.device_adapters (code, name, protocol, endpoint) VALUES (${t}, ${t}, 'stub', 'stub://t') RETURNING id`;
  await tx`UPDATE public.robots SET "edgeNodeId" = ${a.id} WHERE id = ${robot.id}`; // epoch 2
  await tx`UPDATE public.device_adapters SET "edgeNodeId" = ${a.id} WHERE id = ${ad.id}`; // epoch 2
  return { a: a.id as number, b: b.id as number, robot: robot.id as number, ad: ad.id as number };
}
const req = async (tx: Tx, o: { robotId?: number; adapterId?: number; node: number; epoch: number; kind: "stop" | "lock"; expires?: string }) =>
  (
    await tx`INSERT INTO public.robot_motion_lock_requests ("robotId", "adapterId", "edgeNodeId", "ownerEpoch", kind, reason, "requestedBy", "expiresAt")
             VALUES (${o.robotId ?? null}, ${o.adapterId ?? null}, ${o.node}, ${o.epoch}, ${o.kind}, 'operator', 7, now() + ${o.expires ?? "1 minute"}::interval) RETURNING id`
  )[0].id as number;

describe.skipIf(!onTest)("R-10-i — a pending STOP is never dropped (0374)", () => {
  it("★ (a) owner moves to CENTRAL: the STOP stays pending, is listed for central, and only the guarded central ack (done / failed) closes it", async () => {
    const r = await asApp(async (tx) => {
      const f = await fixture(tx);
      const stop = await req(tx, { robotId: f.robot, node: f.a, epoch: 2, kind: "stop" });
      const lock = await req(tx, { robotId: f.robot, node: f.a, epoch: 2, kind: "lock" });
      const ackWhileEdgeOwned = await code(tx, (sp) => sp`SELECT public.edge_stop_ack_central(${stop}, 'done', 41)`);
      await tx`UPDATE public.robots SET "edgeNodeId" = NULL WHERE id = ${f.robot}`; // → central, epoch 3
      const [pending] = await tx`SELECT "requestId" AS id, "currentEdgeNodeId" AS cur, "centralMustExecute" AS c, overdue FROM public.device_pending_stops WHERE "robotId" = ${f.robot}`;
      const ackLock = await code(tx, (sp) => sp`SELECT public.edge_stop_ack_central(${lock}, 'done', 41)`);
      const ackBadOutcome = await code(tx, (sp) => sp`SELECT public.edge_stop_ack_central(${stop}, 'expired', 41)`);
      const ackNoActor = await code(tx, (sp) => sp`SELECT public.edge_stop_ack_central(${stop}, 'done', 0)`);
      const ack = await code(tx, (sp) => sp`SELECT public.edge_stop_ack_central(${stop}, 'done', 41)`);
      const [row] = await tx`SELECT outcome, "ackedBy" AS by, "deliveredAt" IS NOT NULL AS delivered FROM public.robot_motion_lock_requests WHERE id = ${stop}`;
      const again = await code(tx, (sp) => sp`SELECT public.edge_stop_ack_central(${stop}, 'failed', 41)`);
      const [left] = await tx`SELECT count(*)::int AS n FROM public.device_pending_stops WHERE "robotId" = ${f.robot}`;
      return { ackWhileEdgeOwned, pending: pending ? { id: pending.id, cur: pending.cur, c: pending.c, overdue: pending.overdue } : null, stop, ackLock, ackBadOutcome, ackNoActor, ack, row, again, left: left.n };
    });
    expect(r).toEqual({
      ackWhileEdgeOwned: "23514",
      pending: { id: r.stop, cur: null, c: true, overdue: false },
      stop: r.stop,
      ackLock: "23514",
      ackBadOutcome: "23514",
      ackNoActor: "23514",
      ack: null,
      row: { outcome: "done", by: 41, delivered: true },
      again: "23514",
      left: 0,
    });
  }, 60_000);

  it("★ (b) a STOP is deliverable AFTER its expiry (the view marks it overdue); lock keeps its expiry; a STOP is never acked 'expired'", async () => {
    const r = await asApp(async (tx) => {
      const f = await fixture(tx);
      const stop = await req(tx, { robotId: f.robot, node: f.a, epoch: 2, kind: "stop", expires: "1 millisecond" });
      const lock = await req(tx, { robotId: f.robot, node: f.a, epoch: 2, kind: "lock", expires: "1 millisecond" });
      const [ov] = await tx`SELECT overdue FROM public.device_pending_stops WHERE "requestId" = ${stop}`; // now() + 2 s > expiresAt below
      const expireStop = await code(tx, (sp) => sp`UPDATE public.robot_motion_lock_requests SET "ackedAt" = now() + interval '2 seconds', outcome = 'expired' WHERE id = ${stop}`);
      const deliverStopLate = await code(tx, (sp) => sp`UPDATE public.robot_motion_lock_requests SET "deliveredAt" = now() + interval '2 seconds' WHERE id = ${stop}`);
      const deliverLockLate = await code(tx, (sp) => sp`UPDATE public.robot_motion_lock_requests SET "deliveredAt" = now() + interval '2 seconds' WHERE id = ${lock}`);
      const expireLock = await code(tx, (sp) => sp`UPDATE public.robot_motion_lock_requests SET "ackedAt" = now() + interval '2 seconds', outcome = 'expired' WHERE id = ${lock}`);
      return { overdueListed: ov ? "listed" : "missing", expireStop, deliverStopLate, deliverLockLate, expireLock };
    });
    expect(r).toEqual({ overdueListed: "listed", expireStop: "23514", deliverStopLate: null, deliverLockLate: "23514", expireLock: null });
    // overdue as a VALUE: a STOP whose expiry already passed (created in the past by the owner — rolled back)
    const o = await rolledBack(ownerUrl(), async (tx) => {
      const f = await fixture(tx);
      const [q] = await tx`INSERT INTO public.robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, "requestedBy", "createdAt", "expiresAt")
                            VALUES (${f.robot}, ${f.a}, 2, 'stop', 7, now() - interval '2 minutes', now() - interval '1 minute') RETURNING id`;
      return (await tx`SELECT overdue FROM public.device_pending_stops WHERE "requestId" = ${q.id}`)[0]?.overdue;
    });
    expect(o).toBe(true);
  }, 60_000);

  it("★ (c) the owner epoch changing WITHOUT a node change still carries the pending STOP — robots and adapters", async () => {
    // the owner-change guard refuses an epoch-only change from every writer, so the path is reached as the owner with that
    // guard disabled inside a transaction that is ROLLED BACK (the carry must not depend on the guard)
    const r = await rolledBack(ownerUrl(), async (tx) => {
      await tx`SET LOCAL lock_timeout = '5s'`;
      const f = await fixture(tx);
      await req(tx, { robotId: f.robot, node: f.a, epoch: 2, kind: "stop" });
      await req(tx, { adapterId: f.ad, node: f.a, epoch: 2, kind: "stop" });
      await tx`ALTER TABLE public.robots DISABLE TRIGGER trg_robots_owner_change`;
      await tx`ALTER TABLE public.device_adapters DISABLE TRIGGER trg_adapters_owner_change`;
      await tx`UPDATE public.robots SET "ownerEpoch" = 3 WHERE id = ${f.robot}`;
      await tx`UPDATE public.device_adapters SET "ownerEpoch" = 3 WHERE id = ${f.ad}`;
      const robot = (await tx`SELECT "ownerEpoch" AS e FROM public.robot_motion_lock_requests WHERE "robotId" = ${f.robot} AND kind = 'stop' AND "edgeNodeId" = ${f.a} ORDER BY id`).map((x) => Number(x.e));
      const adapter = (await tx`SELECT "ownerEpoch" AS e FROM public.robot_motion_lock_requests WHERE "adapterId" = ${f.ad} AND kind = 'stop' AND "edgeNodeId" = ${f.a} ORDER BY id`).map((x) => Number(x.e));
      return { robot, adapter };
    });
    expect(r).toEqual({ robot: [2, 3], adapter: [2, 3] });
  }, 60_000);

  it("★ (d) the scan's path: deleting the OLD node (device already moved away) can no longer cascade-delete its pending STOP", async () => {
    const r = await asApp(async (tx) => {
      const f = await fixture(tx);
      const stop = await req(tx, { robotId: f.robot, node: f.a, epoch: 2, kind: "stop" });
      await tx`UPDATE public.robots SET "edgeNodeId" = NULL WHERE id = ${f.robot}`;
      await tx`UPDATE public.device_adapters SET "edgeNodeId" = NULL WHERE id = ${f.ad}`;
      const nodeDelete = await code(tx, (sp) => sp`DELETE FROM public.edge_nodes WHERE id = ${f.a}`);
      const [still] = await tx`SELECT count(*)::int AS n FROM public.robot_motion_lock_requests WHERE id = ${stop}`;
      // once acknowledged, the node (and the history row with it) may go
      await tx`SELECT public.edge_stop_ack_central(${stop}, 'done', 41)`;
      const afterAck = await code(tx, (sp) => sp`DELETE FROM public.edge_nodes WHERE id = ${f.a}`);
      return { nodeDelete, still: still.n, afterAck };
    });
    expect(r).toEqual({ nodeDelete: "23514", still: 1, afterAck: null });
  }, 60_000);
  // ── second scan ("STOP orphaned", after d030dcb8e) ─────────────────────────────────────────────────────────────────
  it("★ (e) a device with an unacknowledged STOP cannot be DELETED (the FK cascade would take the STOP with it)", async () => {
    const r = await asApp(async (tx) => {
      const f = await fixture(tx);
      await req(tx, { robotId: f.robot, node: f.a, epoch: 2, kind: "stop" });
      await req(tx, { adapterId: f.ad, node: f.a, epoch: 2, kind: "stop" });
      const delRobot = await code(tx, (sp) => sp`DELETE FROM public.robots WHERE id = ${f.robot}`);
      const delAdapter = await code(tx, (sp) => sp`DELETE FROM public.device_adapters WHERE id = ${f.ad}`);
      const [n] = await tx`SELECT count(*)::int AS n FROM public.device_pending_stops WHERE "robotId" = ${f.robot} OR "adapterId" = ${f.ad}`;
      return { delRobot, delAdapter, listed: n.n };
    });
    expect(r).toEqual({ delRobot: "23514", delAdapter: "23514", listed: 2 });
  }, 60_000);

  it("★ (f) edge → CENTRAL → edge before central acked: the pending STOP reaches the NEW edge owner (never stranded at the first node)", async () => {
    const r = await asApp(async (tx) => {
      const f = await fixture(tx);
      const stop = await req(tx, { robotId: f.robot, node: f.a, epoch: 2, kind: "stop" });
      await tx`UPDATE public.robots SET "edgeNodeId" = NULL WHERE id = ${f.robot}`; // epoch 3, central
      await tx`UPDATE public.robots SET "edgeNodeId" = ${f.b} WHERE id = ${f.robot}`; // epoch 4, B
      const atB = (await tx`SELECT "ownerEpoch" AS e FROM public.robot_motion_lock_requests WHERE "robotId" = ${f.robot} AND kind = 'stop' AND "edgeNodeId" = ${f.b} AND "ackedAt" IS NULL`).map((x) => Number(x.e));
      const view = (await tx`SELECT "requestEdgeNodeId" AS n, "requestOwnerEpoch" AS e, stale FROM public.device_pending_stops WHERE "robotId" = ${f.robot}`).map((x) => `${x.n === f.b ? "B" : x.n === f.a ? "A" : x.n}@${x.e}:${x.stale}`);
      return { stop: typeof stop, atB, view };
    });
    expect(r).toEqual({ stop: "number", atB: [4], view: ["B@4:false"] });
  }, 60_000);

  it("★ (g) several hops (A → B → C, plus an epoch-only change): exactly ONE pending STOP, at the latest owner and epoch — no duplicates", async () => {
    const r = await rolledBack(ownerUrl(), async (tx) => {
      const f = await fixture(tx);
      const [c] = await tx`INSERT INTO public.edge_nodes (code, name, status) VALUES (${tag()}, 'c', 'offline') RETURNING id`;
      await req(tx, { robotId: f.robot, node: f.a, epoch: 2, kind: "stop" });
      await tx`UPDATE public.robots SET "edgeNodeId" = ${f.b} WHERE id = ${f.robot}`; // epoch 3
      await tx`UPDATE public.robots SET "edgeNodeId" = ${c.id} WHERE id = ${f.robot}`; // epoch 4
      await tx`ALTER TABLE public.robots DISABLE TRIGGER trg_robots_owner_change`;
      await tx`UPDATE public.robots SET "ownerEpoch" = 5 WHERE id = ${f.robot}`; // epoch-only
      const view = (await tx`SELECT "requestEdgeNodeId" AS n, "requestOwnerEpoch" AS e FROM public.device_pending_stops WHERE "robotId" = ${f.robot}`).map((x) => `${x.n === c.id ? "C" : x.n}@${x.e}`);
      const [all] = await tx`SELECT count(*)::int AS n FROM public.robot_motion_lock_requests WHERE "robotId" = ${f.robot} AND kind = 'stop'`;
      return { view, rows: all.n };
    });
    expect(r).toEqual({ view: ["C@5"], rows: 4 }); // original + one carry per hop (B, C, C@5) — one pending HEAD
  }, 60_000);

  it("★ (h) the owner's node is dead (no active credential — it never pulls): the STOP shows as UNDELIVERABLE for central", async () => {
    const r = await asApp(async (tx) => {
      const f = await fixture(tx);
      const [cred] = await tx`INSERT INTO public.edge_node_credentials ("edgeNodeId", "keyPrefix", "secretHash") VALUES (${f.a}, ${"edn_" + Math.random().toString(16).slice(2, 14).padEnd(12, "0")}, ${"ab".repeat(32)}) RETURNING id`;
      const stop = await req(tx, { robotId: f.robot, node: f.a, epoch: 2, kind: "stop" });
      const live = (await tx`SELECT undeliverable FROM public.device_pending_stops WHERE "requestId" = ${stop}`)[0]?.undeliverable;
      await tx`UPDATE public.edge_node_credentials SET status = 'revoked', "revokedAt" = now(), "revokedBy" = 1, "revokeReason" = 'dead' WHERE id = ${cred.id}`;
      const dead = (await tx`SELECT undeliverable FROM public.device_pending_stops WHERE "requestId" = ${stop}`)[0]?.undeliverable;
      return { live, dead };
    });
    expect(r).toEqual({ live: false, dead: true });
  }, 60_000);

  it("★ R-10-k: no writer (the owner included) can ack a STOP 'expired'", async () => {
    const r = await rolledBack(ownerUrl(), async (tx) => {
      const f = await fixture(tx);
      const stop = await req(tx, { robotId: f.robot, node: f.a, epoch: 2, kind: "stop", expires: "1 millisecond" });
      return code(tx, (sp) => sp`UPDATE public.robot_motion_lock_requests SET "ackedAt" = now() + interval '1 second', outcome = 'expired' WHERE id = ${stop}`);
    });
    expect(r).toBe("23514");
  }, 60_000);
});
