/**
 * doc 81 Đợt 10 task A fix review 3 — ruling R-10-aa N1: a STOP request inserted CONCURRENTLY with an owner change must never be
 * stranded at the old (node, epoch). The request guard locks the device row FOR SHARE before it reads the owner, so:
 *   • STOP inserted first (uncommitted) ⇒ the owner change WAITS for it, then its carry sees the committed STOP and carries it;
 *   • owner change first (uncommitted) ⇒ the insert at the old (node, epoch) WAITS, then is refused (23514) — the caller
 *     re-queues for the new owner (B's enqueue retry).
 * Two real avi_app sessions on `_test` (committed — the race cannot be shown inside one transaction). Every wait is bounded
 * (lock_timeout / explicit timers, never the vitest timeout). Cleanup through the legitimate path (move to central, central ack,
 * delete); the WORM device_owner_changes rows stay by design (R-10-aa: accepted on the test DB).
 */
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const TAG = `__race10_${Date.now()}`;
const conns: Array<ReturnType<typeof postgres>> = [];
const open = () => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {} });
  conns.push(c);
  return c;
};
const robots: number[] = [];
const nodes: number[] = [];
afterAll(async () => {
  const c = open();
  try {
    for (const robot of robots) {
      await c`UPDATE public.robots SET "edgeNodeId" = NULL WHERE id = ${robot} AND "edgeNodeId" IS NOT NULL`;
      for (const r of await c`SELECT "requestId" FROM public.device_pending_stops WHERE "robotId" = ${robot}`) {
        await c`SELECT public.edge_stop_ack_central(${r.requestId}, 'done', 1)`.catch(() => undefined);
      }
      await c`DELETE FROM public.robots WHERE id = ${robot}`.catch(() => undefined);
    }
    if (nodes.length) await c`DELETE FROM public.edge_nodes WHERE id = ANY(${nodes})`.catch(() => undefined);
  } finally {
    for (const x of conns) await x.end({ timeout: 5 }).catch(() => undefined);
  }
});

/** settled-or-still-pending after `ms` (bounded; never hangs) */
async function stateAfter<T>(p: Promise<T>, ms: number): Promise<"pending" | "settled"> {
  let done = false;
  p.then(
    () => (done = true),
    () => (done = true),
  );
  await new Promise((r) => setTimeout(r, ms));
  return done ? "settled" : "pending";
}
const codeOf = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e?.code ?? "error");

async function fixture(c: ReturnType<typeof postgres>, k: string) {
  const [n1] = await c`INSERT INTO public.edge_nodes (code, name, status) VALUES (${TAG + k + "a"}, ${TAG}, 'offline') RETURNING id`;
  const [n2] = await c`INSERT INTO public.edge_nodes (code, name, status) VALUES (${TAG + k + "b"}, ${TAG}, 'offline') RETURNING id`;
  const [r] = await c`INSERT INTO public.robots (code, name, vendor, endpoint) VALUES (${TAG + k}, ${TAG}, 'sim', 'sim://race') RETURNING id`;
  nodes.push(n1.id, n2.id);
  robots.push(r.id);
  await c`UPDATE public.robots SET "edgeNodeId" = ${n1.id} WHERE id = ${r.id}`; // epoch 2
  return { n1: n1.id as number, n2: n2.id as number, robot: r.id as number };
}

describe.skipIf(!onTest)("R-10-aa N1 — STOP insert vs owner change (two sessions)", () => {
  it("★ STOP inserted first (uncommitted): the owner change WAITS, then carries it — one head, at the NEW owner and epoch", async () => {
    const C = open();
    const f = await fixture(C, "x");
    const b = await open().reserve();
    const a = await open().reserve();
    try {
      await b`BEGIN`;
      await b`SET LOCAL lock_timeout = '10s'`;
      await b`INSERT INTO public.robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, "requestedBy", "expiresAt", reason) VALUES (${f.robot}, ${f.n1}, 2, 'stop', 1, now() + interval '1 minute', 'operator STOP')`;
      await a`BEGIN`;
      await a`SET LOCAL lock_timeout = '10s'`;
      const change = codeOf(a`UPDATE public.robots SET "edgeNodeId" = ${f.n2} WHERE id = ${f.robot}`);
      const whileStopOpen = await stateAfter(change, 600);
      await b`COMMIT`;
      const changeCode = await change;
      await a`COMMIT`;
      const heads = (await C`SELECT "requestEdgeNodeId" AS n, "requestOwnerEpoch" AS e FROM public.device_pending_stops WHERE "robotId" = ${f.robot}`).map((x) => `${x.n === f.n2 ? "n2" : x.n === f.n1 ? "n1" : x.n}@${x.e}`);
      expect({ whileStopOpen, changeCode, heads }).toEqual({ whileStopOpen: "pending", changeCode: null, heads: ["n2@3"] });
    } finally {
      await b`ROLLBACK`.catch(() => undefined);
      await a`ROLLBACK`.catch(() => undefined);
      b.release();
      a.release();
    }
  }, 60_000);

  it("★ owner change first (uncommitted): a STOP insert at the OLD (node, epoch) WAITS, then is refused (23514) — never stranded", async () => {
    const C = open();
    const f = await fixture(C, "y");
    const a = await open().reserve();
    const b = await open().reserve();
    try {
      await a`BEGIN`;
      await a`SET LOCAL lock_timeout = '10s'`;
      await a`UPDATE public.robots SET "edgeNodeId" = ${f.n2} WHERE id = ${f.robot}`; // epoch 3, uncommitted
      await b`BEGIN`;
      await b`SET LOCAL lock_timeout = '10s'`;
      const insert = codeOf(b`INSERT INTO public.robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, "requestedBy", "expiresAt") VALUES (${f.robot}, ${f.n1}, 2, 'stop', 1, now() + interval '1 minute')`);
      const whileChangeOpen = await stateAfter(insert, 600);
      await a`COMMIT`;
      const insertCode = await insert;
      await b`ROLLBACK`;
      const heads = await C`SELECT count(*)::int AS n FROM public.device_pending_stops WHERE "robotId" = ${f.robot}`;
      expect({ whileChangeOpen, insertCode, heads: heads[0].n }).toEqual({ whileChangeOpen: "pending", insertCode: "23514", heads: 0 });
    } finally {
      await a`ROLLBACK`.catch(() => undefined);
      await b`ROLLBACK`.catch(() => undefined);
      a.release();
      b.release();
    }
  }, 60_000);
});
