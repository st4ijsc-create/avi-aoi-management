/**
 * doc 81 Đợt 11 task H (mig 0377) — ONE lock order for every writer of a STOP request against the owner change (Đợt 10 re-review
 * N3 / F-B2-4): the DEVICE row (robots / device_adapters) FIRST, then the REQUEST row. The owner change cannot follow any other
 * order (its UPDATE locks the device row before its BEFORE / AFTER triggers run; device_owner_stop_carry then locks the pending
 * requests FOR UPDATE), so every other writer takes the device FOR SHARE before it locks a request:
 *   • edge_stop_ack_edge (both branches), edge_stop_ack_central, edge_stop_resolve (0377 re-creates them, same results);
 *   • the edge batch prelock lockAckRequestsInOrder (devices of the batch's acks FOR SHARE, then the requests in id order);
 *   • resolvePendingStop (F2) through lockStopRequestDevices; the central STOP sweep (centralStopSweepLockOrder.dot11).
 * Before 0377 an ack locked request → device while an owner change locked device → request: a 40P01 deadlock.
 *
 * Two (three) real avi_app sessions on `_test` (committed — a lock race cannot be shown inside one transaction). Every wait is
 * bounded (lock_timeout, explicit timers — never the vitest timeout). L-7: a STOP ack waits ONLY on the bounded owner-change
 * transaction (lock_timeout 10 s here; the owner change itself is one UPDATE + its triggers). Cleanup through the legitimate path
 * (move to central, recorded central execution + central ack, resolve, delete); WORM rows (device_owner_changes,
 * edge_stop_ack_refusals, central_stop_executions) stay by design (R-10-aa: accepted on the test DB).
 *
 * DOT11_H_NODECMD / DOT11_H_RESOLVESVC (mutation runs only): the module path of edgeNodeCommands / edgeResolutionService to import
 * (an untracked copy).
 */
import postgres from "postgres";
import { sql as dsql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const TAG = `__lo11_${Date.now()}`;
const conns: Array<ReturnType<typeof postgres>> = [];
const open = () => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {} });
  conns.push(c);
  return c;
};
const made = { robots: [] as number[], adapters: [] as number[], nodes: [] as number[], users: [] as number[] };
let C: ReturnType<typeof postgres>;
let admin = 0;

type Res = Awaited<ReturnType<ReturnType<typeof postgres>["reserve"]>>;
const codeOf = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; message?: string }) => e?.code ?? String(e?.message ?? e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function pidOf(s: Res): Promise<number> {
  return Number((await s`SELECT pg_backend_pid() AS p`)[0].p);
}
/** true once `pid` waits on a lock (bounded); false if it never did within `ms` */
async function waitsOnLock(pid: number, ms = 5_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const [r] = await C`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = ${pid} AND NOT granted) AS w`;
    if (r.w) return true;
    await sleep(25);
  }
  return false;
}
async function settledWithin<T>(p: Promise<T>, ms: number): Promise<boolean> {
  let done = false;
  p.then(
    () => (done = true),
    () => (done = true),
  );
  const t0 = Date.now();
  while (!done && Date.now() - t0 < ms) await sleep(20);
  return done;
}
async function begin(s: Res) {
  await s`BEGIN`;
  await s`SET LOCAL lock_timeout = '10s'`;
}
async function end(...ss: Res[]) {
  for (const s of ss) {
    await s`ROLLBACK`.catch(() => undefined);
    s.release();
  }
}

type Kind = "robot" | "adapter";
interface Fx {
  kind: Kind;
  device: number;
  n1: number;
  n2: number;
  epoch: number;
  request: number;
}
let seq = 0;
/** a device owned by n1 (epoch 2) with one pending STOP at (n1, 2) — committed */
async function fixture(kind: Kind = "robot"): Promise<Fx> {
  const k = `${TAG}_${++seq}`;
  const [n1] = await C`INSERT INTO public.edge_nodes (code, name, status) VALUES (${k + "a"}, ${TAG}, 'offline') RETURNING id`;
  const [n2] = await C`INSERT INTO public.edge_nodes (code, name, status) VALUES (${k + "b"}, ${TAG}, 'offline') RETURNING id`;
  made.nodes.push(n1.id, n2.id);
  let device: number;
  if (kind === "robot") {
    const [r] = await C`INSERT INTO public.robots (code, name, vendor, endpoint) VALUES (${k}, ${TAG}, 'sim', 'sim://lock-order') RETURNING id`;
    device = r.id;
    made.robots.push(device);
    await C`UPDATE public.robots SET "edgeNodeId" = ${n1.id} WHERE id = ${device}`;
  } else {
    const [a] = await C`INSERT INTO public.device_adapters (code, name, protocol, endpoint, "isEnabled") VALUES (${k}, ${TAG}, 'stub', 'stub://lock-order', false) RETURNING id`;
    device = a.id;
    made.adapters.push(device);
    await C`UPDATE public.device_adapters SET "edgeNodeId" = ${n1.id} WHERE id = ${device}`;
  }
  const [o] = kind === "robot" ? await C`SELECT "ownerEpoch" AS e FROM public.robots WHERE id = ${device}` : await C`SELECT "ownerEpoch" AS e FROM public.device_adapters WHERE id = ${device}`;
  const epoch = Number(o.e);
  const [q] =
    kind === "robot"
      ? await C`INSERT INTO public.robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, "requestedBy", "expiresAt", reason) VALUES (${device}, ${n1.id}, ${epoch}, 'stop', ${admin}, now() + interval '1 minute', 'lock-order STOP') RETURNING id`
      : await C`INSERT INTO public.robot_motion_lock_requests ("adapterId", "edgeNodeId", "ownerEpoch", kind, "requestedBy", "expiresAt", reason) VALUES (${device}, ${n1.id}, ${epoch}, 'stop', ${admin}, now() + interval '1 minute', 'lock-order STOP') RETURNING id`;
  return { kind, device, n1: n1.id, n2: n2.id, epoch, request: q.id };
}
const table = (f: Fx) => (f.kind === "robot" ? C`public.robots` : C`public.device_adapters`);
const ownerChange = (s: Res, f: Fx, to: number | null) => (f.kind === "robot" ? s`UPDATE public.robots SET "edgeNodeId" = ${to} WHERE id = ${f.device}` : s`UPDATE public.device_adapters SET "edgeNodeId" = ${to} WHERE id = ${f.device}`);
const blockDevice = (s: Res, f: Fx) => (f.kind === "robot" ? s`SELECT 1 FROM public.robots WHERE id = ${f.device} FOR NO KEY UPDATE` : s`SELECT 1 FROM public.device_adapters WHERE id = ${f.device} FOR NO KEY UPDATE`);
const ackEdge = (s: Res, f: Fx, outcome: string) =>
  s`SELECT public.edge_stop_ack_edge(${f.request}, ${f.n1}, ${f.kind === "robot" ? f.device : null}::integer, ${f.kind === "adapter" ? f.device : null}::integer, ${f.epoch}::bigint, ${outcome}, false, NULL) AS ok`;
const heads = async (f: Fx) =>
  (await C`SELECT "requestEdgeNodeId" AS n, "requestOwnerEpoch" AS e FROM public.device_pending_stops WHERE ${f.kind === "robot" ? C`"robotId"` : C`"adapterId"`} = ${f.device} AND outcome IS NULL`).map(
    (x) => `${x.n === f.n2 ? "n2" : x.n === f.n1 ? "n1" : x.n}@${x.e}`,
  );
/** a central STOP execution of the device, recorded through the guarded function (the sweep's evidence) */
const execution = async (f: Fx, ok = true) => Number((await C`SELECT public.edge_stop_record_central_execution(${f.kind}, ${f.device}, ${ok}, 'lock-order test') AS id`)[0].id);

beforeAll(async () => {
  if (!onTest) return;
  C = open();
  const [u] = await C`INSERT INTO public.users ("openId", role, "isActive") VALUES (${TAG + "-admin"}, 'admin', true) RETURNING id`;
  admin = u.id;
  made.users.push(admin);
});

afterAll(async () => {
  if (!onTest) return;
  try {
    for (const [kind, ids] of [["robot", made.robots], ["adapter", made.adapters]] as const) {
      for (const id of ids) {
        const f = { kind, device: id } as Fx;
        await C`UPDATE ${table(f)} SET "edgeNodeId" = NULL WHERE id = ${id} AND "edgeNodeId" IS NOT NULL`.catch(() => undefined);
        const pend = await C`SELECT "requestId" AS r, outcome FROM public.device_pending_stops WHERE ${kind === "robot" ? C`"robotId"` : C`"adapterId"`} = ${id}`;
        if (pend.some((p) => p.outcome == null)) {
          const ex = await execution(f).catch(() => null);
          for (const p of pend.filter((x) => x.outcome == null)) if (ex) await C`SELECT public.edge_stop_ack_central(${p.r}, 'done', ${ex}::bigint)`.catch(() => undefined);
        }
        for (const p of await C`SELECT "requestId" AS r FROM public.device_pending_stops WHERE ${kind === "robot" ? C`"robotId"` : C`"adapterId"`} = ${id} AND "needsResolution"`)
          await C`SELECT public.edge_stop_resolve(${p.r}, ${admin}, 'lock-order test cleanup')`.catch(() => undefined);
        await C`DELETE FROM ${table(f)} WHERE id = ${id}`.catch(() => undefined);
      }
    }
    if (made.nodes.length) await C`DELETE FROM public.edge_nodes WHERE id = ANY(${made.nodes})`.catch(() => undefined);
  } finally {
    for (const x of conns) await x.end({ timeout: 5 }).catch(() => undefined);
  }
}, 120_000);

/**
 * The order probe (deterministic): a third session holds the DEVICE row (FOR NO KEY UPDATE — what an owner change holds). The
 * writer under test starts; once it waits, is its REQUEST row still free? (device-first ⇒ yes: it waits on the device holding
 * nothing; request-first ⇒ the request is already locked — the half of a deadlock.)
 */
async function orderProbe(f: Fx, start: (s: Res) => Promise<unknown>) {
  const c = await open().reserve();
  const a = await open().reserve();
  const d = await open().reserve();
  try {
    await begin(c);
    await blockDevice(c, f);
    const aPid = await pidOf(a);
    await begin(a);
    const run = codeOf(start(a));
    const waited = await waitsOnLock(aPid, 3_000);
    await begin(d);
    const requestFree = (await codeOf(d`SELECT id FROM public.robot_motion_lock_requests WHERE id = ${f.request} FOR UPDATE NOWAIT`)) === null;
    await d`ROLLBACK`;
    await c`ROLLBACK`;
    const runCode = await run;
    return { waited, requestFree, runCode };
  } finally {
    await end(c, a, d);
  }
}

/**
 * The deadlock scenario (deterministic): C holds the device; B's owner change queues FIRST on it; then the writer A starts. C lets
 * go ⇒ B owns the device and its carry wants the pending request. Request-first A holds that request and waits for the device:
 * 40P01. Device-first A waits on the device behind B — no cycle.
 */
async function staged(f: Fx, to: number | null, start: (s: Res) => Promise<unknown>) {
  const c = await open().reserve();
  const b = await open().reserve();
  const a = await open().reserve();
  try {
    await begin(c);
    await blockDevice(c, f);
    const bPid = await pidOf(b);
    const aPid = await pidOf(a);
    await begin(b);
    const change = codeOf(ownerChange(b, f, to));
    const bWaits = await waitsOnLock(bPid, 3_000);
    await begin(a);
    const run = codeOf(start(a));
    await waitsOnLock(aPid, 1_500); // request-first: on the device after taking the request; device-first: on the device
    await c`COMMIT`;
    const changeCode = await change;
    const changeSettled = changeCode === null ? (await codeOf(b`COMMIT`)) : changeCode;
    const runCode = await run;
    const runCommit = runCode === null ? await codeOf(a`COMMIT`) : runCode;
    return { bWaits, changeCode: changeSettled, runCode: runCommit };
  } finally {
    await end(c, b, a);
  }
}

describe.skipIf(!onTest)("0377 — one lock order: device row FIRST, then the STOP request (order probe)", () => {
  it("★ edge_stop_ack_edge (done): waits on the device holding NOTHING (the request row stays free)", async () => {
    const f = await fixture();
    expect(await orderProbe(f, (s) => ackEdge(s, f, "done"))).toEqual({ waited: true, requestFree: true, runCode: null });
  }, 60_000);

  it("★ edge_stop_ack_edge (notOwnedHere branch): the same order", async () => {
    const f = await fixture();
    expect(await orderProbe(f, (s) => ackEdge(s, f, "notOwnedHere"))).toEqual({ waited: true, requestFree: true, runCode: null });
  }, 60_000);

  it("★ edge_stop_ack_central: the same order (device central-owned, a recorded central execution)", async () => {
    const f = await fixture();
    await ownerChange(C as never, f, null);
    const ex = await execution(f);
    expect(await orderProbe(f, (s) => s`SELECT public.edge_stop_ack_central(${f.request}, 'done', ${ex}::bigint)`)).toEqual({ waited: true, requestFree: true, runCode: null });
  }, 60_000);

  it("★ edge_stop_resolve: the same order (a refused STOP resolved by an admin)", async () => {
    const f = await fixture();
    expect((await ackEdge(C as never, f, "refused"))[0].ok).toBe(true);
    expect(await orderProbe(f, (s) => s`SELECT public.edge_stop_resolve(${f.request}, ${admin}, 'lock-order probe')`)).toEqual({ waited: true, requestFree: true, runCode: null });
  }, 60_000);

  it("★ adapter target: edge_stop_ack_edge locks device_adapters first too", async () => {
    const f = await fixture("adapter");
    expect(await orderProbe(f, (s) => ackEdge(s, f, "done"))).toEqual({ waited: true, requestFree: true, runCode: null });
  }, 60_000);

  it("★ resolvePendingStop (F2's service): the device row first — its own request lock no longer precedes the device", async () => {
    const f = await fixture();
    expect((await ackEdge(C as never, f, "refused"))[0].ok).toBe(true);
    const svc = (await import(process.env.DOT11_H_RESOLVESVC || "./edgeResolutionService")) as typeof import("./edgeResolutionService");
    const c = await open().reserve();
    try {
      const cPid = await pidOf(c);
      await begin(c);
      await blockDevice(c, f);
      const res = svc.resolvePendingStop({ requestId: f.request, resolution: "lock-order probe (service)", actor: { id: admin, name: "lock-order" }, scope: null });
      // the service's own connection is blocked by C (on the device row) — only then is the request row probed
      let blocked = false;
      for (let i = 0; i < 200 && !blocked; i++) {
        blocked = (await C`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${cPid}::int = ANY (pg_blocking_pids(pid))) AS b`)[0].b;
        if (!blocked) await sleep(25);
      }
      expect(blocked).toBe(true);
      const d = await open().reserve();
      const requestFree = (await codeOf(d`SELECT id FROM public.robot_motion_lock_requests WHERE id = ${f.request} FOR UPDATE NOWAIT`)) === null;
      await end(d);
      await c`ROLLBACK`;
      const out = await res;
      expect({ requestFree, ok: out.ok }).toEqual({ requestFree: true, ok: true });
    } finally {
      await end(c);
    }
  }, 60_000);

  it("★ the edge batch prelock (lockAckRequestsInOrder): the batch's devices FOR SHARE first, then its requests", async () => {
    const f = await fixture();
    const g = await fixture("adapter");
    const mod = (await import(process.env.DOT11_H_NODECMD || "./edgeNodeCommands")) as typeof import("./edgeNodeCommands");
    const c = await open().reserve();
    const client = open();
    const db = drizzle(client);
    try {
      const cPid = await pidOf(c);
      await begin(c);
      await blockDevice(c, f);
      let gate!: () => void;
      const gateP = new Promise<void>((r) => (gate = r));
      const batch = codeOf(
        db.transaction(async (tx) => {
          await tx.execute(dsql.raw("SET LOCAL lock_timeout = '10s'"));
          await mod.lockAckRequestsInOrder(tx as never, [g.request, f.request]);
          await gateP; // the batch stays open (its acks would follow here)
        }),
      );
      // the batch's connection is blocked by C (on the robot row) — only then are its request rows probed
      let blocked = false;
      for (let i = 0; i < 200 && !blocked; i++) {
        blocked = (await C`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${cPid}::int = ANY (pg_blocking_pids(pid))) AS b`)[0].b;
        if (!blocked) await sleep(25);
      }
      const d = await open().reserve();
      const requestFree = (await codeOf(d`SELECT id FROM public.robot_motion_lock_requests WHERE id = ${f.request} FOR UPDATE NOWAIT`)) === null;
      const otherFree = (await codeOf(d`SELECT id FROM public.robot_motion_lock_requests WHERE id = ${g.request} FOR UPDATE NOWAIT`)) === null;
      await end(d);
      await c`ROLLBACK`;
      gate();
      expect({ blocked, requestFree, otherFree, batch: await batch }).toEqual({ blocked: true, requestFree: true, otherFree: true, batch: null });
    } finally {
      await end(c);
    }
  }, 60_000);
});

describe.skipIf(!onTest)("0377 — an ack racing an owner change never deadlocks (40P01); the STOP is never dropped (L-7)", () => {
  it("★ edge_stop_ack_edge vs owner change n1 → n2 (staged): no 40P01; the ack is refused not_current_owner; the STOP is carried to n2", async () => {
    const f = await fixture();
    const r = await staged(f, f.n2, (s) => ackEdge(s, f, "done"));
    const [ev] = await C`SELECT reason FROM public.edge_stop_ack_refusals WHERE "requestId" = ${f.request} ORDER BY id DESC LIMIT 1`;
    expect({ ...r, refusal: ev?.reason ?? null, heads: await heads(f) }).toEqual({ bWaits: true, changeCode: null, runCode: null, refusal: "not_current_owner", heads: [`n2@${f.epoch + 1}`] });
  }, 60_000);

  it("★ edge_stop_ack_edge notOwnedHere vs owner change (staged): no 40P01; no sticky flag for a device that moved", async () => {
    const f = await fixture();
    const r = await staged(f, f.n2, (s) => ackEdge(s, f, "notOwnedHere"));
    const [q] = await C`SELECT "ownerCannotListAt" IS NOT NULL AS flagged FROM public.robot_motion_lock_requests WHERE id = ${f.request}`;
    expect({ ...r, flagged: q.flagged, heads: await heads(f) }).toEqual({ bWaits: true, changeCode: null, runCode: null, flagged: false, heads: [`n2@${f.epoch + 1}`] });
  }, 60_000);

  it("★ edge_stop_ack_central vs owner change central → n2 (staged): no 40P01; the ack is refused (23514), the STOP carried to n2", async () => {
    const f = await fixture();
    await ownerChange(C as never, f, null); // epoch + 1, central-owned: centralMustExecute
    const ex = await execution(f);
    const r = await staged(f, f.n2, (s) => s`SELECT public.edge_stop_ack_central(${f.request}, 'done', ${ex}::bigint)`);
    expect({ ...r, heads: await heads(f) }).toEqual({ bWaits: true, changeCode: null, runCode: "23514", heads: [`n2@${f.epoch + 2}`] });
  }, 60_000);

  it("★ edge_stop_resolve vs owner change (staged): no 40P01; resolved", async () => {
    const f = await fixture();
    expect((await ackEdge(C as never, f, "refused"))[0].ok).toBe(true);
    const r = await staged(f, f.n2, (s) => s`SELECT public.edge_stop_resolve(${f.request}, ${admin}, 'lock-order staged')`);
    const [q] = await C`SELECT "resolvedBy" FROM public.robot_motion_lock_requests WHERE id = ${f.request}`;
    expect({ ...r, resolvedBy: q.resolvedBy }).toEqual({ bWaits: true, changeCode: null, runCode: null, resolvedBy: admin });
  }, 60_000);

  it("★ the edge batch (lockAckRequestsInOrder → ackStopRequest) vs owner change (staged): no 40P01; the ack lands, nothing to carry", async () => {
    const f = await fixture();
    const mod = (await import(process.env.DOT11_H_NODECMD || "./edgeNodeCommands")) as typeof import("./edgeNodeCommands");
    const client = open();
    const db = drizzle(client);
    const b = await open().reserve();
    let gate!: () => void;
    const gateP = new Promise<void>((r) => (gate = r));
    let prelocked = false;
    try {
      const batch = codeOf(
        db.transaction(async (tx) => {
          await tx.execute(dsql.raw("SET LOCAL lock_timeout = '10s'"));
          await mod.lockAckRequestsInOrder(tx as never, [f.request]);
          prelocked = true;
          await gateP;
          const ok = await mod.ackStopRequest(tx as never, { nodeId: f.n1, requestId: f.request, robotId: f.device, adapterId: null, ownerEpoch: f.epoch, outcome: "done", generation: null, unsigned: false });
          if (!ok) throw Object.assign(new Error("ack refused"), { code: "ACK_FALSE" });
        }),
      );
      while (!prelocked) await sleep(10);
      const bPid = await pidOf(b);
      await begin(b);
      const change = codeOf(ownerChange(b, f, f.n2));
      const bWaits = await waitsOnLock(bPid, 3_000);
      gate();
      const batchCode = await batch;
      const changeCode = await change;
      const commitB = changeCode === null ? await codeOf(b`COMMIT`) : changeCode;
      const [q] = await C`SELECT outcome FROM public.robot_motion_lock_requests WHERE id = ${f.request}`;
      expect({ bWaits, batchCode, changeCode: commitB, outcome: q.outcome, heads: await heads(f) }).toEqual({ bWaits: true, batchCode: null, changeCode: null, outcome: "done", heads: [] });
    } finally {
      gate();
      await end(b);
    }
  }, 60_000);

  it("★ many iterations, free-running: a batch-shaped ack (prelock, then ack) and an owner change fired together — zero 40P01", async () => {
    const mod = (await import(process.env.DOT11_H_NODECMD || "./edgeNodeCommands")) as typeof import("./edgeNodeCommands");
    const client = open();
    const db = drizzle(client);
    const b = await open().reserve();
    const codes: Array<string | null> = [];
    try {
      for (let i = 0; i < 40; i++) {
        const f = await fixture(i % 3 === 2 ? "adapter" : "robot");
        const batch = codeOf(
          db.transaction(async (tx) => {
            await tx.execute(dsql.raw("SET LOCAL lock_timeout = '10s'"));
            await mod.lockAckRequestsInOrder(tx as never, [f.request]);
            await tx.execute(dsql.raw("SELECT pg_sleep(0.03)"));
            await mod.ackStopRequest(tx as never, { nodeId: f.n1, requestId: f.request, robotId: f.kind === "robot" ? f.device : null, adapterId: f.kind === "adapter" ? f.device : null, ownerEpoch: f.epoch, outcome: "done", generation: null, unsigned: false });
          }),
        );
        await sleep(i % 2 === 0 ? 5 : 15);
        await begin(b);
        const change = await codeOf(ownerChange(b, f, f.n2));
        codes.push(change === null ? await codeOf(b`COMMIT`) : change);
        await b`ROLLBACK`.catch(() => undefined);
        codes.push(await batch);
        // L-7: the STOP is acked done OR carried to n2 — never neither
        const [q] = await C`SELECT outcome, "carriedToId" IS NOT NULL AS carried FROM public.robot_motion_lock_requests WHERE id = ${f.request}`;
        if (!(q.outcome === "done" || q.carried)) codes.push(`dropped:${f.request}`);
      }
      expect(codes.filter((x) => x !== null)).toEqual([]);
    } finally {
      b.release();
    }
  }, 240_000);

  it("★ many iterations, free-running: the bare function edge_stop_ack_edge and an owner change fired together — zero 40P01", async () => {
    const a = await open().reserve();
    const b = await open().reserve();
    const codes: Array<string | null> = [];
    try {
      for (let i = 0; i < 40; i++) {
        const f = await fixture(i % 3 === 2 ? "adapter" : "robot");
        await begin(a);
        await begin(b);
        // each session commits as soon as ITS statement is done (a finished ack holds its device FOR SHARE until it commits)
        const run = async (s: Res, stmt: Promise<unknown>) => {
          const c = await codeOf(stmt);
          if (c === null) return codeOf(s`COMMIT`);
          await s`ROLLBACK`.catch(() => undefined);
          return c;
        };
        const [ca, cb] = await Promise.all([run(a, ackEdge(a, f, i % 4 === 3 ? "notOwnedHere" : "done")), run(b, ownerChange(b, f, f.n2))]);
        codes.push(ca, cb);
        const [q] = await C`SELECT outcome, "carriedToId" IS NOT NULL AS carried FROM public.robot_motion_lock_requests WHERE id = ${f.request}`;
        if (!(q.outcome === "done" || q.carried)) codes.push(`dropped:${f.request}`);
      }
      expect(codes.filter((x) => x !== null)).toEqual([]);
    } finally {
      a.release();
      b.release();
    }
  }, 240_000);
});
