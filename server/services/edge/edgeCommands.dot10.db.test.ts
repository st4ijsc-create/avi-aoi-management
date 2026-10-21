/**
 * doc 81 Đợt 10 task B — the central → edge command queue on the REAL `_test` DB (rulings R-10-k / R-10-o / R-10-p):
 *   • node scoping: A's pull never carries B's requests — signed, overdue STOP, unsigned STOP;
 *   • an OVERDUE STOP (past expiresAt) is still delivered, first; the sweeper never expires a STOP (an overdue lock is expired);
 *   • no signer ⇒ STOPs are delivered as the unsigned envelope `cmd-stop-unsigned` (edgeProtocol's schema) and a lock is not
 *     delivered at all; the pull still answers (no new run offered);
 *   • a STOP that cannot be queued for an edge (the device is central's now) tells the caller to fall back to a central STOP;
 *   • acks (R-10-o): a mismatched target / owner epoch is refused (409, request stays pending), an unsigned ack for a lock is
 *     refused, a matching unsigned STOP ack is accepted.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupKit, type Kit } from "./__edgeCentralKit.dot10";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
let k: Kit;
const epoch = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

/** a request row inserted with a creation time in the PAST (an overdue one when expiresAt < now) */
async function oldRequest(kind: "stop" | "lock", robotKey: "robotA" | "robotB", node: "nodeA" | "nodeB", createdAgoS: number, expiresAgoS: number): Promise<number> {
  const [o] = await k.sql`SELECT "ownerEpoch" FROM robots WHERE id = ${k.ids[robotKey]}`;
  const [r] = await k.sql`INSERT INTO robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, reason, "requestedBy", "createdAt", "expiresAt")
    VALUES (${k.ids[robotKey]}, ${k.ids[node]}, ${o.ownerEpoch}, ${kind}, 'kit', ${k.u.admin}, now() - (${createdAgoS} * interval '1 second'), now() - (${expiresAgoS} * interval '1 second')) RETURNING id`;
  return Number(r.id);
}
const payloads = (envs: Array<{ payload: string }>) => envs.map((e) => JSON.parse(e.payload) as Record<string, any>);

describe.skipIf(!onTest)("doc 81 Đợt 10 B — command queue: L-7 STOP delivery, node scope, unsigned STOP, acks (real _test DB)", () => {
  beforeAll(async () => {
    k = await setupKit("B10CMD");
  }, 120_000);
  afterAll(async () => {
    await k?.teardown();
  }, 120_000);

  it("★ node scope + L-7: A gets ITS overdue STOP first and its lock; never B's STOP / lock; the sweeper expires the overdue lock, NEVER the STOP", async () => {
    const { commandsForNode, expireEdgeRequests } = await import("./edgeNodeCommands");
    const { enqueueEdgeDeviceRequest } = await import("./edgeNodeCommands");
    const lockA = (await enqueueEdgeDeviceRequest({ kind: "lock", robotId: k.ids.robotA, reason: "op", requestedBy: k.u.admin })).requestId;
    const overdueStopA = await oldRequest("stop", "robotA", "nodeA", 3600, 1800);
    const overdueLockA = await oldRequest("lock", "robotA", "nodeA", 3600, 1800);
    const olderLiveLockA = await oldRequest("lock", "robotA", "nodeA", 7200, -600); // created BEFORE the STOP, still valid
    const stopB = (await enqueueEdgeDeviceRequest({ kind: "stop", robotId: k.ids.robotB, reason: "op", requestedBy: k.u.admin })).requestId;
    const overdueStopB = await oldRequest("stop", "robotB", "nodeB", 3600, 1800);
    const a = await commandsForNode(await k.principal("A"));
    const ids = payloads(a.signed).map((p) => p.requestId);
    expect(ids[0]).toBe(overdueStopA); // STOPs first — even before an OLDER lock
    expect(ids).toContain(olderLiveLockA);
    expect(ids).toContain(lockA);
    expect(ids).not.toContain(overdueLockA); // a lock past its expiry is not delivered
    for (const foreign of [stopB, overdueStopB]) expect(ids).not.toContain(foreign);
    expect(payloads(a.signed).every((p) => p.nodeId === k.ids.nodeA)).toBe(true);
    expect(a.unsignedStops).toEqual([]);
    // the sweeper: the overdue lock is expired, the overdue STOP never
    await expireEdgeRequests();
    const rows = await k.sql`SELECT id, outcome, "ackedAt" FROM robot_motion_lock_requests WHERE id IN ${k.sql([overdueStopA, overdueLockA, overdueStopB])} ORDER BY id`;
    const by = new Map(rows.map((r) => [Number(r.id), r]));
    expect(by.get(overdueLockA)!.outcome).toBe("expired");
    expect(by.get(overdueStopA)!.ackedAt).toBeNull();
    expect(by.get(overdueStopB)!.ackedAt).toBeNull();
    // and it is delivered again on the next pull
    expect(payloads((await commandsForNode(await k.principal("A"))).signed).map((p) => p.requestId)).toContain(overdueStopA);
  });

  it("★ R-10-k / R-10-p: without central's signer the pull still answers — A's STOPs as `cmd-stop-unsigned` (edgeProtocol schema), no lock, nothing of B", async () => {
    const c = await import("./edgeExecutionCentral");
    const common = await import("./edgeCentralCommon");
    const sg = await import("./edgeSigning");
    const proto = await import("./edgeProtocol");
    const mine = await import("./edgeNodeCommands");
    const saved = process.env.EDGE_SIGNING_KEY_FILE;
    process.env.EDGE_SIGNING_KEY_FILE = `${saved}.missing`;
    sg.__resetCentralEdgeSigningKeyForTests();
    common.__resetCentralSignerCacheForTests();
    try {
      expect(common.centralSigner()).toBeNull();
      const pA = await k.principal("A");
      const r = await c.pullForNodeV2(pA, {});
      expect(r.http, JSON.stringify(r)).toBe(200);
      expect(proto.edgePullAnswerSchema.safeParse(r.data).success).toBe(true);
      expect(r.data!.commands).toEqual([]);
      expect(r.data!.runs).toEqual([]);
      const u = r.data!.unsignedStops ?? [];
      expect(u.length).toBeGreaterThan(0);
      for (const s of u) {
        expect(proto.edgeUnsignedStopSchema.safeParse(s).success).toBe(true);
        expect(mine.edgeUnsignedStopSchema.safeParse(s).success).toBe(true);
        expect(s).toMatchObject({ typ: "cmd-stop-unsigned", nodeId: k.ids.nodeA, credentialId: pA.credentialId });
      }
      const kinds = await k.sql`SELECT id, kind, "edgeNodeId" FROM robot_motion_lock_requests WHERE id IN ${k.sql(u.map((s) => s.requestId))}`;
      expect(kinds.every((x) => x.kind === "stop" && Number(x.edgeNodeId) === k.ids.nodeA)).toBe(true);
      // the unsigned schema refuses any other kind / extra key
      expect(mine.edgeUnsignedStopSchema.safeParse({ ...u[0], kind: "clear" }).success).toBe(false);
      // a lock is never sent unsigned
      const lockRow = await k.sql`SELECT id FROM robot_motion_lock_requests WHERE "edgeNodeId" = ${k.ids.nodeA} AND kind = 'lock' AND "ackedAt" IS NULL`;
      expect(lockRow.length).toBeGreaterThan(0);
      expect(u.map((s) => s.requestId)).not.toContain(Number(lockRow[0].id));
      // B, unsigned: never A's
      const b = await c.pullForNodeV2(await k.principal("B"), {});
      expect((b.data!.unsignedStops ?? []).every((s) => s.nodeId === k.ids.nodeB)).toBe(true);
      expect((b.data!.unsignedStops ?? []).map((s) => s.requestId)).not.toContain(u[0].requestId);
    } finally {
      process.env.EDGE_SIGNING_KEY_FILE = saved;
      sg.__resetCentralEdgeSigningKeyForTests();
      common.__resetCentralSignerCacheForTests();
    }
  });

  it("★ R-10-o / I-6: a refused ack (mismatched target / epoch, no target, unsigned for a lock, B acking A's) is an ANOMALY outcome — 200, the stream ADVANCES, the request stays PENDING; a matching unsigned STOP ack is recorded", async () => {
    const { eventsForNode } = await import("./edgeReportsCentral");
    const { enqueueEdgeDeviceRequest } = await import("./edgeNodeCommands");
    const [o] = await k.sql`SELECT "ownerEpoch" FROM robots WHERE id = ${k.ids.robotA}`;
    const ep = Number(o.ownerEpoch);
    const stop = (await enqueueEdgeDeviceRequest({ kind: "stop", robotId: k.ids.robotA, reason: "console", requestedBy: k.u.admin })).requestId;
    const lock = (await enqueueEdgeDeviceRequest({ kind: "lock", robotId: k.ids.robotA, reason: "op", requestedBy: k.u.admin })).requestId;
    await k.sql`UPDATE robot_motion_lock_requests SET "deliveredAt" = now() WHERE id IN ${k.sql([stop, lock])}`;
    const ack = (seq: number, requestId: number, over: Record<string, unknown> = {}) => ({ kind: "command_ack", seq, requestId, outcome: "done", generation: null, at: Date.now(), target: { robotId: k.ids.robotA }, ownerEpoch: ep, ...over });
    const ev = epoch();
    const send = async (records: unknown[]) => eventsForNode(await k.principal("A"), { epoch: ev, stream: "events", records });
    const pending = async (id: number) => (await k.sql`SELECT "ackedAt" FROM robot_motion_lock_requests WHERE id = ${id}`)[0].ackedAt === null;
    const r = await send([ack(1, stop, { target: { robotId: k.ids.robotB } }), ack(2, stop, { ownerEpoch: ep + 1 }), ack(3, stop, { target: undefined }), ack(4, lock, { unsigned: true })]);
    expect(r, JSON.stringify(r)).toMatchObject({ http: 200, data: { ackedSeq: 4, applied: 4 } });
    expect(r.data!.outcomes!.map((x) => [x.seq, x.code])).toEqual([[1, "command_ack_refused"], [2, "command_ack_refused"], [3, "command_ack_refused"], [4, "command_ack_refused"]]);
    expect(await pending(stop)).toBe(true);
    expect(await pending(lock)).toBe(true);
    const n = Number((await k.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'EDGE_ANOMALY' AND "entityId" = ${k.ids.nodeA} AND details LIKE '%command_ack_refused%'`)[0].n);
    expect(n).toBeGreaterThanOrEqual(4);
    // A's refusal evidence of the STOP acks (edge_stop_ack_refusals) persisted
    expect(Number((await k.sql`SELECT count(*)::int AS n FROM edge_stop_ack_refusals WHERE "requestId" = ${stop}`)[0].n)).toBeGreaterThanOrEqual(2);
    const ok = await send([ack(5, stop, { unsigned: true })]);
    expect(ok).toMatchObject({ http: 200, data: { ackedSeq: 5, applied: 1 } });
    expect(ok.data!.outcomes).toBeUndefined();
    expect(await pending(stop)).toBe(false);
    // B can never ack A's request (even with the right target / epoch): anomaly, A's request stays pending
    const lock2 = (await enqueueEdgeDeviceRequest({ kind: "lock", robotId: k.ids.robotA, reason: "op2", requestedBy: k.u.admin })).requestId;
    await k.sql`UPDATE robot_motion_lock_requests SET "deliveredAt" = now() WHERE id = ${lock2}`;
    const b = await eventsForNode(await k.principal("B"), { epoch: epoch(), stream: "events", records: [ack(1, lock2)] });
    expect(b).toMatchObject({ http: 200, data: { outcomes: [{ seq: 1, outcome: "anomaly", code: "command_ack_refused" }] } });
    expect(await pending(lock2)).toBe(true);
  });

  it("★ R-10-as N-3 + N-5: EVERY STOP ack reaches A's guarded function ON THE CALLER'S TRANSACTION — malformed, another node's, mismatched each leave a refusal row (reason), invisible to other sessions until the batch commits; a rolled-back batch leaves nothing and its re-send writes it", async () => {
    const { enqueueEdgeDeviceRequest, ackEdgeCommand } = await import("./edgeNodeCommands");
    const { centralDb } = await import("./edgeCentralCommon");
    const ep = Number((await k.sql`SELECT "ownerEpoch" FROM robots WHERE id = ${k.ids.robotA}`)[0].ownerEpoch);
    const stop = (await enqueueEdgeDeviceRequest({ kind: "stop", robotId: k.ids.robotA, reason: "console", requestedBy: k.u.admin })).requestId;
    const reasons = async () => (await k.sql`SELECT reason, "edgeNodeId" FROM edge_stop_ack_refusals WHERE "requestId" = ${stop} ORDER BY id`).map((r) => `${r.reason}@${r.edgeNodeId}`);
    const d = await centralDb();
    const acks = [
      { node: k.ids.nodeA, rec: { requestId: stop, outcome: "done" as const, generation: null, at: Date.now(), target: null, ownerEpoch: ep } }, // malformed: no target
      { node: k.ids.nodeA, rec: { requestId: stop, outcome: "done" as const, generation: null, at: Date.now(), target: { robotId: k.ids.robotA }, ownerEpoch: null } }, // malformed: no epoch
      { node: k.ids.nodeB, rec: { requestId: stop, outcome: "done" as const, generation: null, at: Date.now(), target: { robotId: k.ids.robotA }, ownerEpoch: ep } }, // another node
      { node: k.ids.nodeA, rec: { requestId: stop, outcome: "done" as const, generation: null, at: Date.now(), target: { robotId: k.ids.robotB }, ownerEpoch: ep } }, // wrong target
    ];
    // (1) rolled back: nothing survives — the evidence lives in the batch's own transaction (no second pool connection)
    class Rollback extends Error {}
    await d
      .transaction(async (tx) => {
        for (const a of acks) expect(await ackEdgeCommand(tx as never, a.node, a.rec)).toBe(false);
        expect(await reasons()).toEqual([]); // another session sees nothing yet: same transaction
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
    expect(await reasons()).toEqual([]);
    // (2) the re-sent batch commits: one refusal row per ack, with A's reason
    await d.transaction(async (tx) => {
      for (const a of acks) expect(await ackEdgeCommand(tx as never, a.node, a.rec)).toBe(false);
    });
    expect(await reasons()).toEqual([`malformed@${k.ids.nodeA}`, `malformed@${k.ids.nodeA}`, `other_node@${k.ids.nodeB}`, `target_mismatch@${k.ids.nodeA}`]);
    // (3) "expired" for a STOP: refused (a STOP never expires) without aborting the caller's transaction
    await d.transaction(async (tx) => {
      expect(await ackEdgeCommand(tx as never, k.ids.nodeA, { requestId: stop, outcome: "expired", generation: null, at: Date.now(), target: { robotId: k.ids.robotA }, ownerEpoch: ep })).toBe(false);
      expect((await tx.execute((await import("drizzle-orm")).sql`SELECT 1 AS ok`)) as unknown).toBeTruthy(); // the transaction is still usable
    });
    expect((await k.sql`SELECT "ackedAt" FROM robot_motion_lock_requests WHERE id = ${stop}`)[0].ackedAt).toBeNull();
    expect((await reasons()).at(-1)).toBe(`bad_outcome@${k.ids.nodeA}`); // A fix review 7: evidence for "expired" too
    // the matching ack closes it
    await d.transaction(async (tx) => {
      expect(await ackEdgeCommand(tx as never, k.ids.nodeA, { requestId: stop, outcome: "done", generation: null, at: Date.now(), target: { robotId: k.ids.robotA }, ownerEpoch: ep })).toBe(true);
    });
    expect((await k.sql`SELECT outcome FROM robot_motion_lock_requests WHERE id = ${stop}`)[0].outcome).toBe("done");
  });

  it("★ doc 81 dot 12 follow-up: a lock / clear ack re-sent with the IDENTICAL outcome, target and epoch is idempotent (true, no anomaly); a different outcome is still refused and audited", async () => {
    const { eventsForNode } = await import("./edgeReportsCentral");
    const { enqueueEdgeDeviceRequest, ackEdgeCommand } = await import("./edgeNodeCommands");
    const { centralDb } = await import("./edgeCentralCommon");
    const ep = Number((await k.sql`SELECT "ownerEpoch" FROM robots WHERE id = ${k.ids.robotA}`)[0].ownerEpoch);
    const lock = (await enqueueEdgeDeviceRequest({ kind: "lock", robotId: k.ids.robotA, reason: "op same", requestedBy: k.u.admin })).requestId;
    await k.sql`UPDATE robot_motion_lock_requests SET "deliveredAt" = now() WHERE id = ${lock}`;
    const rec = (outcome: "done" | "failed", robotId = k.ids.robotA, ownerEpoch = ep) => ({ requestId: lock, outcome, generation: 1, at: Date.now(), target: { robotId }, ownerEpoch });
    const d = await centralDb();
    await d.transaction(async (tx) => {
      expect(await ackEdgeCommand(tx as never, k.ids.nodeA, rec("done"))).toBe(true);
      expect(await ackEdgeCommand(tx as never, k.ids.nodeA, rec("done"))).toBe(true); // the identical re-send
      expect(await ackEdgeCommand(tx as never, k.ids.nodeA, rec("failed"))).toBe(false); // another outcome
      expect(await ackEdgeCommand(tx as never, k.ids.nodeA, rec("done", k.ids.robotB))).toBe(false); // another target
      expect(await ackEdgeCommand(tx as never, k.ids.nodeA, rec("done", k.ids.robotA, ep + 1))).toBe(false); // another epoch
      expect(await ackEdgeCommand(tx as never, k.ids.nodeB, rec("done"))).toBe(false); // another node
    });
    expect((await k.sql`SELECT outcome FROM robot_motion_lock_requests WHERE id = ${lock}`)[0].outcome).toBe("done");
    // through the stream: the identical re-send is applied silently, a different outcome is an anomaly
    const ev = (seq: number, outcome: string) => ({ kind: "command_ack", seq, requestId: lock, outcome, generation: 1, at: Date.now(), target: { robotId: k.ids.robotA }, ownerEpoch: ep });
    const r = await eventsForNode(await k.principal("A"), { epoch: epoch(), stream: "events", records: [ev(1, "done"), ev(2, "failed")] });
    expect(r, JSON.stringify(r)).toMatchObject({ http: 200, data: { outcomes: [{ seq: 2, outcome: "anomaly", code: "command_ack_refused" }] } });
    expect((r.data as { outcomes?: unknown[] }).outcomes).toHaveLength(1);
  });

  it("★ R-10-au: a STOP acked `notOwnedHere` is NEVER terminal — 200 with the anomaly `ack_not_owned_here`, the STOP stays pending and is re-delivered next pull; a lock acked `notOwnedHere` stays pending too", async () => {
    const { eventsForNode } = await import("./edgeReportsCentral");
    const { enqueueEdgeDeviceRequest, commandsForNode } = await import("./edgeNodeCommands");
    const ep = Number((await k.sql`SELECT "ownerEpoch" FROM robots WHERE id = ${k.ids.robotA}`)[0].ownerEpoch);
    const stop = (await enqueueEdgeDeviceRequest({ kind: "stop", robotId: k.ids.robotA, reason: "console au", requestedBy: k.u.admin })).requestId;
    const lock = (await enqueueEdgeDeviceRequest({ kind: "lock", robotId: k.ids.robotA, reason: "op au", requestedBy: k.u.admin })).requestId;
    await k.sql`UPDATE robot_motion_lock_requests SET "deliveredAt" = now() WHERE id IN ${k.sql([stop, lock])}`;
    const ack = (seq: number, requestId: number) => ({ kind: "command_ack", seq, requestId, outcome: "notOwnedHere", generation: null, at: Date.now(), target: { robotId: k.ids.robotA }, ownerEpoch: ep });
    const r = await eventsForNode(await k.principal("A"), { epoch: epoch(), stream: "events", records: [ack(1, stop), ack(2, lock)] });
    expect(r, JSON.stringify(r)).toMatchObject({ http: 200, data: { ackedSeq: 2, outcomes: [{ seq: 1, outcome: "anomaly", code: "ack_not_owned_here" }, { seq: 2, outcome: "anomaly", code: "ack_not_owned_here" }] } });
    const st = async (id: number) => (await k.sql`SELECT "ackedAt", outcome FROM robot_motion_lock_requests WHERE id = ${id}`)[0];
    expect(await st(stop)).toMatchObject({ ackedAt: null, outcome: null });
    expect(await st(lock)).toMatchObject({ ackedAt: null, outcome: null });
    const again = await commandsForNode(await k.principal("A"));
    expect(payloads(again.signed).map((x) => x.requestId)).toContain(stop);
    expect((await k.sql`SELECT reason FROM edge_stop_ack_refusals WHERE "requestId" = ${stop}`).map((x) => x.reason)).toEqual(["not_owned_here"]);
    expect(Number((await k.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'EDGE_ANOMALY' AND "entityId" = ${k.ids.nodeA} AND details LIKE '%ack_not_owned_here%'`)[0].n)).toBeGreaterThanOrEqual(2);
  });

  it("★ F-B2-4: an events batch locks the requests it acks in ASCENDING id order before any ack — with s1 held elsewhere, a batch acking [s2, s1] waits on s1 WITHOUT holding s2 (two opposite-order batches queue, never deadlock)", async () => {
    const { eventsForNode } = await import("./edgeReportsCentral");
    const { enqueueEdgeDeviceRequest } = await import("./edgeNodeCommands");
    const ep = Number((await k.sql`SELECT "ownerEpoch" FROM robots WHERE id = ${k.ids.robotA}`)[0].ownerEpoch);
    const s1 = (await enqueueEdgeDeviceRequest({ kind: "stop", robotId: k.ids.robotA, reason: "order 1", requestedBy: k.u.admin })).requestId;
    const s2 = (await enqueueEdgeDeviceRequest({ kind: "stop", robotId: k.ids.robotA, reason: "order 2", requestedBy: k.u.admin })).requestId;
    const bad = (seq: number, id: number) => ({ kind: "command_ack", seq, requestId: id, outcome: "done", generation: null, at: Date.now(), target: { robotId: k.ids.robotB }, ownerEpoch: ep });
    const postgres = (await import("postgres")).default;
    const holder = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    const probe = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const isLocked = new Promise<void>((r) => (locked = r));
      const h = holder.begin(async (tx) => {
        await tx`SELECT id FROM robot_motion_lock_requests WHERE id = ${s1} FOR UPDATE`;
        locked();
        await held;
      });
      await isLocked;
      const batch = eventsForNode(await k.principal("A"), { epoch: epoch(), stream: "events", records: [bad(1, s2), bad(2, s1)] });
      await new Promise((r) => setTimeout(r, 500));
      // ascending order ⇒ the batch is queued on s1 and has NOT taken s2 (in record order it would hold s2 already)
      const free = await probe.begin(async (tx) => {
        await tx`SELECT set_config('lock_timeout', '200ms', true)`;
        await tx`SELECT id FROM robot_motion_lock_requests WHERE id = ${s2} FOR UPDATE`;
        return true;
      }).catch(() => false);
      release();
      await h;
      expect(free).toBe(true);
      expect(await batch).toMatchObject({ http: 200, data: { ackedSeq: 2 } });
    } finally {
      await holder.end();
      await probe.end();
    }
  });

  it("★ R-10-as N-4 (L-7): a STOP whose delivery stamp FAILS (its row locked elsewhere past the stamp bound) is still delivered — signed, in this pull; stamped on a later pull", async () => {
    const { enqueueEdgeDeviceRequest, commandsForNode } = await import("./edgeNodeCommands");
    const stop = (await enqueueEdgeDeviceRequest({ kind: "stop", robotId: k.ids.robotA, reason: "console N-4", requestedBy: k.u.admin })).requestId;
    const postgres = (await import("postgres")).default;
    const other = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      const locker = other.begin(async (tx) => {
        await tx`SELECT id FROM robot_motion_lock_requests WHERE id = ${stop} FOR UPDATE`;
        await held;
      });
      await new Promise((r) => setTimeout(r, 200));
      const t0 = Date.now();
      const c = await commandsForNode(await k.principal("A"));
      const took = Date.now() - t0;
      release();
      await locker;
      expect(payloads(c.signed).map((x) => x.requestId)).toContain(stop);
      expect(took).toBeLessThan(5_000); // bounded: the stamp waits at most its lock timeout (twice: in the loop and once after)
      expect((await k.sql`SELECT "deliveredAt" FROM robot_motion_lock_requests WHERE id = ${stop}`)[0].deliveredAt).toBeNull();
      // the lock is gone: the next pull delivers it again AND stamps it
      const c2 = await commandsForNode(await k.principal("A"));
      expect(payloads(c2.signed).map((x) => x.requestId)).toContain(stop);
      expect((await k.sql`SELECT "deliveredAt" FROM robot_motion_lock_requests WHERE id = ${stop}`)[0].deliveredAt).not.toBeNull();
    } finally {
      await other.end();
    }
  });

  it("★ I-7: EDGE_RUNTIME_ENABLED off ⇒ a STOP is NOT queued — EdgeRequestError unavailable WITH fallback.centralStop (a lock: unavailable, no fallback); F2: a STOP whose device row is locked fails within the STOP bound WITH the fallback", async () => {
    const { enqueueEdgeDeviceRequest } = await import("./edgeNodeCommands");
    const count = async () => Number((await k.sql`SELECT count(*)::int AS n FROM robot_motion_lock_requests WHERE "robotId" = ${k.ids.robotA}`)[0].n);
    const before = await count();
    process.env.EDGE_RUNTIME_ENABLED = "false";
    try {
      await expect(enqueueEdgeDeviceRequest({ kind: "stop", robotId: k.ids.robotA, reason: "console STOP", requestedBy: k.u.admin })).rejects.toMatchObject({ code: "unavailable", fallback: { centralStop: true } });
      const lockErr = await enqueueEdgeDeviceRequest({ kind: "lock", robotId: k.ids.robotA, reason: "x", requestedBy: k.u.admin }).catch((e) => e);
      expect(lockErr).toMatchObject({ code: "unavailable" });
      expect((lockErr as { fallback?: unknown }).fallback).toBeUndefined();
    } finally {
      process.env.EDGE_RUNTIME_ENABLED = "true";
    }
    expect(await count()).toBe(before);
    // F2 — another session holds the robot row FOR UPDATE (an owner change in flight): the STOP enqueue gives up within the bound
    const postgres = (await import("postgres")).default;
    const other = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      const locker = other.begin(async (tx) => {
        await tx`SELECT id FROM robots WHERE id = ${k.ids.robotA} FOR UPDATE`;
        await held;
      });
      await new Promise((r) => setTimeout(r, 200));
      const t0 = Date.now();
      const err = await enqueueEdgeDeviceRequest({ kind: "stop", robotId: k.ids.robotA, reason: "console STOP", requestedBy: k.u.admin }).catch((e) => e);
      const took = Date.now() - t0;
      release();
      await locker;
      expect(err).toMatchObject({ code: "unavailable", fallback: { centralStop: true } });
      expect(took).toBeLessThan(7_000); // 3 attempts × the 1 s lock_timeout (+ connection), never unbounded
    } finally {
      await other.end();
    }
  });

  it("★ R-10-k: a STOP for a device that is central's now ⇒ EdgeRequestError notEdgeOwned WITH fallback.centralStop (never a silent no-op)", async () => {
    const { enqueueEdgeDeviceRequest, EdgeRequestError } = await import("./edgeNodeCommands");
    // an adapter that is central-owned (a fresh one) — a console STOP must fall back to central
    const [row] = await k.sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`AC-${k.DAU}`}, 'kit central adapter', 'stub', 'stub://c', true, ${k.ids.mOtB}) RETURNING id`;
    const central = Number(row.id);
    try {
      let err: unknown;
      try {
        await enqueueEdgeDeviceRequest({ kind: "stop", adapterId: central, reason: "console STOP", requestedBy: k.u.admin });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(EdgeRequestError);
      expect(err).toMatchObject({ code: "notEdgeOwned", fallback: { centralStop: true, currentOwner: { edgeNodeId: null } } });
      // a lock / clear carries no STOP fallback
      let err2: unknown;
      try {
        await enqueueEdgeDeviceRequest({ kind: "lock", robotId: 2_000_000_000, reason: "x", requestedBy: k.u.admin });
      } catch (e) {
        err2 = e;
      }
      expect(err2).toMatchObject({ code: "notEdgeOwned" });
      expect((err2 as { fallback?: unknown }).fallback).toBeUndefined();
    } finally {
      await k.sql`DELETE FROM device_adapters WHERE id = ${central}`;
    }
  });
});
