/**
 * A2 test fix round 1 (AMENDMENT 2) — the harness teardown step closeOwnStops (__edgeE2eStopClose.dot10.ts), on the REAL `_test` DB,
 * every case in ONE transaction that is always ROLLED BACK. The product calls (changeDeviceOwner / executePendingCentralStops) are
 * INJECTED fakes: they run on the pool and would commit; the fake that "hands back" does what the product does, inside the
 * transaction (owner → NULL, central STOP execution recorded, edge_stop_ack_central done). The clock is injected (no wall time).
 *
 *   • own marker + sim/loopback ⇒ handed back, acked ⇒ handled;
 *   • a non-loopback endpoint ⇒ refused, owner never returned (fake never called);
 *   • another run's marker ⇒ refused — and the OLD pending STOPs #5150 / #51720 / #51721 (other runs) are never acted on and stay
 *     byte-for-byte unchanged, even with their robot ids leaked into the lists;
 *   • an ack that never comes ⇒ bounded: kept after the deadline, the next device is not even started, the step returns.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { closeOwnStops, mayReturnToCentral, isSimOrLoopbackEndpoint, TEARDOWN_STOP_ACK_DEADLINE_MS, type CloseStopsDeps, type DeviceKind } from "./__edgeE2eStopClose.dot10";

const DB_URL = process.env.DATABASE_URL ?? "";
const TAG = `ZS${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e6).toString(36).toUpperCase()}`;
const DAU = `${TAG}-${Date.now()}`;
const OLD_STOPS = [5150, 51720, 51721];
const ROLLBACK = Symbol("rollback");
let pg: ReturnType<typeof postgres>;

beforeAll(() => {
  expect(new URL(DB_URL).pathname).toBe("/aoi_management_test");
  pg = postgres(DB_URL, { max: 2, onnotice: () => {} });
});
afterAll(async () => {
  await pg.end();
});

type Tx = postgres.TransactionSql;
async function inRolledBackTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out: T | undefined;
  await pg
    .begin(async (tx) => {
      out = await fn(tx);
      throw ROLLBACK;
    })
    .catch((e) => {
      if (e !== ROLLBACK) throw e;
    });
  return out as T;
}

/**
 * A virtual clock: each poll sleep advances it by the poll step, but also yields 10 ms of REAL time so the transaction's queries
 * (the fake hand-back's 4–5 round trips) can complete — a pure microtask sleep would burn the whole virtual deadline before any
 * DB answer arrives. The 30 s deadline = 150 polls ⇒ ≈ 1,5 s real per hang.
 */
function clock() {
  let t = 1_000_000;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
      await new Promise((r) => setTimeout(r, 10));
    },
    elapsed: () => t - 1_000_000,
  };
}

async function seed(tx: Tx) {
  const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
  const [usr] = await tx`SELECT id FROM users WHERE role = 'admin' AND "isActive" = true ORDER BY id LIMIT 1`;
  const actor = Number(usr.id);
  const node = await one(tx`INSERT INTO edge_nodes (code, name, status) VALUES (${`N-${DAU}`}, 'A2 stopclose node', 'offline') RETURNING id`);
  const robot = (code: string, endpoint: string) =>
    one(tx`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "edgeNodeId") VALUES (${code}, 'A2 stopclose', 'sim', ${endpoint}, true, ${node}) RETURNING id`);
  const stop = async (col: "robotId" | "adapterId", id: number) => {
    const [ep] = col === "robotId" ? await tx`SELECT "ownerEpoch" FROM robots WHERE id = ${id}` : await tx`SELECT "ownerEpoch" FROM device_adapters WHERE id = ${id}`;
    return one(
      tx`INSERT INTO robot_motion_lock_requests (${tx(col)}, "edgeNodeId", "ownerEpoch", kind, reason, "requestedBy", "expiresAt") VALUES (${id}, ${node}, ${Number(ep.ownerEpoch)}, 'stop', 'A2 stopclose', ${actor}, now() + interval '1 hour') RETURNING id`,
    );
  };
  const ids = {
    aa: await one(tx`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "edgeNodeId") VALUES (${`AA-${DAU}`}, 'A2 stopclose', 'stub', 'stub://a2', true, ${node}) RETURNING id`),
    rbRemote: await robot(`RB-${DAU}`, "tcp://10.1.2.3:502"),
    rcOther: await robot(`RC-${TAG}X-${Date.now() - 5_000}`, "sim://other-run"),
    raHang: await robot(`RA-${DAU}`, "sim://a2-hang"),
  };
  const req = {
    aa: await stop("adapterId", ids.aa),
    rbRemote: await stop("robotId", ids.rbRemote),
    rcOther: await stop("robotId", ids.rcOther),
    raHang: await stop("robotId", ids.raHang),
  };
  const oldRows = await tx`SELECT * FROM robot_motion_lock_requests WHERE id IN ${tx(OLD_STOPS)} ORDER BY id`;
  return { actor, node, ids, req, oldRows, oldRobots: [...new Set(oldRows.map((r) => Number(r.robotId)).filter(Boolean))] };
}

/** The fake product hand-back, done inside the transaction the way the product does it (owner → central, executed, acked done). */
/** The product's central path inside the transaction: owner → NULL, the central STOP execution recorded, each unacked STOP acked. */
async function centralAck(tx: Tx, kind: DeviceKind, id: number, outcome: "done" | "failed") {
  await tx`SELECT set_config('avi.actor', 'A2 stopclose test', true)`;
  if (kind === "robot") await tx`UPDATE robots SET "edgeNodeId" = NULL WHERE id = ${id}`;
  else await tx`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${id}`;
  const [ex] = await tx`SELECT public.edge_stop_record_central_execution(${kind}, ${id}, ${outcome === "done"}, 'A2 stopclose test') AS id`;
  const col = kind === "robot" ? "robotId" : "adapterId";
  for (const q of await tx`SELECT id FROM robot_motion_lock_requests WHERE ${tx(col)} = ${id} AND kind = 'stop' AND "ackedAt" IS NULL AND "carriedToId" IS NULL`) {
    await tx`SELECT public.edge_stop_ack_central(${Number(q.id)}, ${outcome}, ${ex.id}::bigint)`;
  }
}

function fakeOwn(tx: Tx, calls: string[], hang: Set<string>, fail: Set<string> = new Set()): CloseStopsDeps["own"] {
  const handBack = async (kind: DeviceKind, id: number) => {
    calls.push(`${kind}:${id}`);
    if (hang.has(`${kind}:${id}`)) return new Promise<never>(() => {});
    if (fail.has(`${kind}:${id}`)) return { ok: false, reason: "refused", detail: "A2 polish: owner change refused (a job in flight)" };
    await centralAck(tx, kind, id, "done");
    return { ok: true };
  };
  return {
    changeDeviceOwner: async (a) => handBack(a.kind, a.deviceId),
    executePendingCentralStops: async (kind, id) => handBack(kind, id),
  };
}

describe("A2 test fix round 1 — closeOwnStops (real _test DB, ROLLBACK, injected product calls + clock)", () => {
  it("★ own marker + sim/loopback ⇒ handed back and acked; non-loopback ⇒ refused; other run's marker ⇒ refused; OLD STOPs #5150/#51720/#51721 untouched; a hanging ack ⇒ bounded, device kept", async () => {
    const out = await inRolledBackTx(async (tx) => {
      const s = await seed(tx);
      const calls: string[] = [];
      const detached: string[] = [];
      const logs: string[] = [];
      const ck = clock();
      const rep = await closeOwnStops({
        sql: tx,
        actorUserId: s.actor,
        // the OLD robots' ids are LEAKED into the run's list on purpose: only the run-marker check stands between them and a hand-back
        robots: [s.ids.rbRemote, s.ids.rcOther, s.ids.raHang, ...s.oldRobots],
        adapters: [s.ids.aa],
        runCodes: new Set([`AA-${DAU}`, `RB-${DAU}`, `RA-${DAU}`]),
        own: fakeOwn(tx, calls, new Set([`robot:${s.ids.raHang}`])),
        detach: async (k, id) => void detached.push(`${k}:${id}`),
        now: ck.now,
        sleep: ck.sleep,
        log: (l) => logs.push(l),
      });
      const oldAfter = await tx`SELECT * FROM robot_motion_lock_requests WHERE id IN ${tx(OLD_STOPS)} ORDER BY id`;
      const [aaReq] = await tx`SELECT outcome FROM robot_motion_lock_requests WHERE id = ${s.req.aa}`;
      return { s, rep, calls, detached, logs, oldAfter, aaOutcome: aaReq.outcome, elapsed: ck.elapsed() };
    });
    const { s, rep, calls } = out;
    // handled: the run's own stub adapter
    expect(rep.handled, out.logs.join(" | ")).toEqual([`adapter:${s.ids.aa}`]);
    expect(out.aaOutcome).toBe("done");
    // refused, never handed back
    const refused = Object.fromEntries(rep.refused.map((r) => [r.device, r.reason]));
    expect(refused[`robot:${s.ids.rbRemote}`]).toMatch(/not a simulator \/ loopback endpoint/);
    expect(refused[`robot:${s.ids.rcOther}`]).toMatch(/not one of this run's devices/);
    for (const r of s.oldRobots) expect(refused[`robot:${r}`]).toMatch(/not one of this run's devices/);
    expect(calls).toEqual([`adapter:${s.ids.aa}`, `robot:${s.ids.raHang}`]);
    // the old STOPs of other runs: never acted on, unchanged
    expect(out.oldAfter).toEqual(s.oldRows);
    for (const id of OLD_STOPS.filter((x) => s.oldRows.some((r) => Number(r.id) === x))) expect(rep.stillPending).toContain(id);
    // bounded: the hanging ack is given up at the deadline (virtual clock), device kept, logged
    expect(rep.timedOut).toEqual([`robot:${s.ids.raHang}`]);
    expect(out.elapsed).toBeGreaterThanOrEqual(TEARDOWN_STOP_ACK_DEADLINE_MS);
    expect(out.elapsed).toBeLessThan(TEARDOWN_STOP_ACK_DEADLINE_MS + 1_000);
    expect(out.logs.filter((l) => l.includes(`robot:${s.ids.raHang} kept`) && l.includes("deadline"))).toHaveLength(1);
    expect(rep.stillPending).toEqual(expect.arrayContaining([s.req.rbRemote, s.req.rcOther, s.req.raHang]));
    expect(rep.stillPending).not.toContain(s.req.aa);
    expect(out.detached).toEqual([`adapter:${s.ids.aa}`, `robot:${s.ids.raHang}`]);
    if (s.oldRows.length === 0) console.warn("[A2 stopclose] #5150/#51720/#51721 no longer on _test — the leak case ran without them");
  }, 20_000);

  it("★ the deadline is ONE budget for the whole step: after a hang, the next device is not even started (owner not returned)", async () => {
    const out = await inRolledBackTx(async (tx) => {
      const s = await seed(tx);
      const calls: string[] = [];
      const ck = clock();
      const rep = await closeOwnStops({
        sql: tx,
        actorUserId: s.actor,
        robots: [s.ids.raHang],
        adapters: [s.ids.aa],
        runCodes: new Set([`AA-${DAU}`, `RA-${DAU}`]),
        own: fakeOwn(tx, calls, new Set([`adapter:${s.ids.aa}`])),
        detach: async () => undefined,
        now: ck.now,
        sleep: ck.sleep,
        log: () => undefined,
      });
      return { s, rep, calls, elapsed: ck.elapsed() };
    });
    expect(out.calls).toEqual([`adapter:${out.s.ids.aa}`]);
    expect(out.rep.timedOut).toEqual([`adapter:${out.s.ids.aa}`, `robot:${out.s.ids.raHang}`]);
    expect(out.elapsed).toBeLessThan(TEARDOWN_STOP_ACK_DEADLINE_MS + 1_000);
  }, 20_000);
});

describe("A2 test polish — step 2 own-run check, definite failure frees the budget (real _test DB, ROLLBACK)", () => {
  it("★ step 2: an acked FAILED STOP on a device WITHOUT this run's code is NOT resolved (logged); the run's own failed STOP is resolved", async () => {
    const out = await inRolledBackTx(async (tx) => {
      const s = await seed(tx);
      // both acked 'failed' through the product's central path BEFORE the teardown step: other-run robot + own adapter
      await centralAck(tx, "robot", s.ids.rcOther, "failed");
      await centralAck(tx, "adapter", s.ids.aa, "failed");
      const calls: string[] = [];
      const logs: string[] = [];
      const ck = clock();
      const rep = await closeOwnStops({
        sql: tx,
        actorUserId: s.actor,
        robots: [s.ids.rcOther, s.ids.raHang],
        adapters: [s.ids.aa],
        runCodes: new Set([`AA-${DAU}`, `RA-${DAU}`]),
        own: fakeOwn(tx, calls, new Set()),
        detach: async () => undefined,
        now: ck.now,
        sleep: ck.sleep,
        log: (l) => logs.push(l),
      });
      const rows = await tx`SELECT id, outcome, "resolvedAt" FROM robot_motion_lock_requests WHERE id IN ${tx([s.req.rcOther, s.req.aa])}`;
      return { s, rep, logs, calls, res: Object.fromEntries(rows.map((r) => [Number(r.id), r.resolvedAt !== null])) };
    });
    const { s, rep } = out;
    expect(out.res[s.req.rcOther]).toBe(false);
    expect(rep.notOwnNotResolved).toEqual([s.req.rcOther]);
    expect(out.logs.filter((l) => l.includes(`STOP #${s.req.rcOther} NOT resolved`) && l.includes("not one of this run's devices"))).toHaveLength(1);
    expect(rep.stillPending).toContain(s.req.rcOther);
    expect(out.res[s.req.aa]).toBe(true);
    expect(rep.resolved).toEqual([s.req.aa]);
    expect(rep.handled).toEqual([`robot:${s.ids.raHang}`]);
    expect(out.calls).toEqual([`robot:${s.ids.raHang}`]);
  }, 20_000);

  it("★ a DEFINITE failure (owner change refused) ends that device's wait at once; a later device still gets its turn", async () => {
    const out = await inRolledBackTx(async (tx) => {
      const s = await seed(tx);
      const calls: string[] = [];
      const logs: string[] = [];
      const ck = clock();
      const rep = await closeOwnStops({
        sql: tx,
        actorUserId: s.actor,
        robots: [s.ids.raHang],
        adapters: [s.ids.aa],
        runCodes: new Set([`AA-${DAU}`, `RA-${DAU}`]),
        own: fakeOwn(tx, calls, new Set(), new Set([`adapter:${s.ids.aa}`])),
        detach: async () => undefined,
        now: ck.now,
        sleep: ck.sleep,
        log: (l) => logs.push(l),
      });
      return { s, rep, logs, calls, elapsed: ck.elapsed() };
    });
    const { s, rep } = out;
    expect(out.calls).toEqual([`adapter:${s.ids.aa}`, `robot:${s.ids.raHang}`]);
    expect(rep.failed.map((x) => x.device)).toEqual([`adapter:${s.ids.aa}`]);
    expect(rep.failed[0].reason).toMatch(/not handed to central/);
    expect(rep.handled).toEqual([`robot:${s.ids.raHang}`]);
    expect(rep.timedOut).toEqual([]);
    expect(out.elapsed).toBeLessThan(TEARDOWN_STOP_ACK_DEADLINE_MS / 10);
    expect(out.logs.filter((l) => l.includes(`adapter:${s.ids.aa} kept`) && l.includes("not handed to central"))).toHaveLength(1);
    expect(rep.stillPending).toContain(s.req.aa);
  }, 20_000);
});

describe("A2 test fix round 1 — the hand-back guard (pure)", () => {
  const run = new Set(["RA-F1X-1793541269940", "AA-F1X-1793541269940"]);
  it("★ (a) own marker AND (b) sim / stub / loopback endpoint — both required", () => {
    expect(mayReturnToCentral({ code: "RA-F1X-1793541269940", endpoint: "sim://f1-x#1" }, run)).toEqual({ ok: true });
    expect(mayReturnToCentral({ code: "AA-F1X-1793541269940", endpoint: "tcp://127.0.0.1:50504" }, run)).toEqual({ ok: true });
    expect(mayReturnToCentral({ code: "RA-F1X-1793541269940", endpoint: "tcp://10.0.0.7:502" }, run).ok).toBe(false);
    expect(mayReturnToCentral({ code: "RB-F1X-1791873286479", endpoint: "sim://f1-x#9035" }, run).ok).toBe(false); // #5150's robot
    expect(mayReturnToCentral({ code: "RA-F1E-1793404974216", endpoint: "sim://f1-x#47628" }, run).ok).toBe(false); // #51720/#51721's robot
  });
  it("isSimOrLoopbackEndpoint", () => {
    for (const e of ["sim://x", "stub://b", "tcp://127.0.0.1:502", "tcp://localhost:1502"]) expect(isSimOrLoopbackEndpoint(e), e).toBe(true);
    for (const e of ["tcp://127.0.0.2:502", "tcp://192.0.2.1:502", "tcp://localhost.evil:502", "opc.tcp://127.0.0.1:4840", "", null]) expect(isSimOrLoopbackEndpoint(e), String(e)).toBe(false);
  });
});
