/**
 * doc 81 Đợt 10 task F2 — R-10-af (resolve a refused / failed STOP) and R-10-ax (resolve a crash-orphaned OT write intent) on the
 * REAL `_test` DB as avi_app, every case in a ROLLED-BACK transaction (getDb is proxied onto the test's transaction; the
 * service's own transactions become savepoints of it). Measured: what is listed (flags, factory scope), what each guard
 * refuses, that the audit row and the change land together (audit failure ⇒ no change), and what the WORM evidence looks like
 * afterwards (STOP resolvedByHuman; intent RESULT row 'timeout' outcome unknown, linked by intentId and by the per-write key).
 */
import { describe, it, expect, vi } from "vitest";
import { sql } from "drizzle-orm";

const H = vi.hoisted(() => ({ tx: null as any, auditFails: false }));
vi.mock("../../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/connection")>();
  return {
    ...actual,
    getDb: vi.fn(async () => {
      if (!H.tx) return actual.getDb();
      const wrap = (t: any): any =>
        new Proxy(t, {
          get(target, k) {
            if (k === "transaction") return (fn: any) => target.transaction((sp: any) => fn(wrap(sp)));
            const v = Reflect.get(target, k);
            return typeof v === "function" ? v.bind(target) : v;
          },
        });
      return wrap(H.tx);
    }),
  };
});
vi.mock("../../db/system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/system")>();
  return {
    ...actual,
    createAuditLog: vi.fn(async (data: any, executor?: any) => {
      if (H.auditFails) throw new Error("audit insert failed (simulated)");
      return actual.createAuditLog(data, executor);
    }),
  };
});

import { getDb } from "../../db/connection";
import { listEdgeResolutionItems, resolveOrphanedIntent, resolvePendingStop, INTENT_RESOLVE_MIN_AGE_MINUTES, mapIntentResolveRefusal, mapLateReviewRefusal, reviewLateResult } from "./edgeResolutionService";

const onTest = /_test\b/.test(process.env.DATABASE_URL ?? "");
const TAG = `F2RES-${Date.now()}`;
class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: any) => Promise<void>): Promise<void> {
  const d = (await getDb())!;
  try {
    await d.transaction(async (tx) => {
      H.tx = tx;
      try {
        await fn(tx);
      } finally {
        H.tx = null;
        H.auditFails = false;
      }
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}
const rows = async (tx: any, q: ReturnType<typeof sql>) => (await tx.execute(q)) as Array<Record<string, any>>;
const one = async (tx: any, q: ReturnType<typeof sql>) => (await rows(tx, q))[0];
let seq = 0;

async function fixture(tx: any) {
  const chain = async (s: string) => {
    const f = Number((await one(tx, sql`INSERT INTO factories (code, name) VALUES (${`${TAG}-F${s}-${seq++}`}, 'f') RETURNING id`)).id);
    const w = Number((await one(tx, sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f}, ${`${TAG}-W${seq++}`}, 'w') RETURNING id`)).id);
    const line = Number((await one(tx, sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w}, ${`${TAG}-L${seq++}`}, 'l') RETURNING id`)).id);
    const station = Number((await one(tx, sql`INSERT INTO stations ("lineId", code, name) VALUES (${line}, ${`${TAG}-S${seq++}`}, 's') RETURNING id`)).id);
    return { f, line, station };
  };
  const A = await chain("a");
  const B = await chain("b");
  const user = Number((await one(tx, sql`INSERT INTO users ("openId", role, "isActive", name) VALUES (${`${TAG}-u${seq++}`}, 'admin', true, 'F2 supervisor') RETURNING id`)).id);
  const node = Number((await one(tx, sql`INSERT INTO edge_nodes (code, name, status) VALUES (${`${TAG}-N${seq++}`}, 'n', 'offline') RETURNING id`)).id);
  const robotIn = async (line: number) => Number((await one(tx, sql`INSERT INTO robots (code, name, vendor, endpoint, "lineId") VALUES (${`${TAG}-R${seq++}`}, 'r', 'sim', 'sim://t', ${line}) RETURNING id`)).id);
  const rA = await robotIn(A.line);
  const rB = await robotIn(B.line);
  const epA = Number((await one(tx, sql`UPDATE robots SET "edgeNodeId" = ${node} WHERE id = ${rA} RETURNING "ownerEpoch"`)).ownerEpoch);
  const epB = Number((await one(tx, sql`UPDATE robots SET "edgeNodeId" = ${node} WHERE id = ${rB} RETURNING "ownerEpoch"`)).ownerEpoch);
  const stop = async (robot: number, epoch: number) =>
    Number((await one(tx, sql`INSERT INTO robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, reason, "requestedBy", "expiresAt") VALUES (${robot}, ${node}, ${epoch}, 'stop', 'operator STOP', ${user}, now() + interval '1 minute') RETURNING id`)).id);
  const ack = (req: number, robot: number, epoch: number, outcome: string) => tx.execute(sql`SELECT public.edge_stop_ack_edge(${req}, ${node}, ${robot}::integer, NULL::integer, ${epoch}::bigint, ${outcome}, false, NULL)`);
  const sFailed = await stop(rA, epA);
  await ack(sFailed, rA, epA, "failed");
  const sPending = await stop(rA, epA);
  const sOtherFactory = await stop(rB, epB);
  await ack(sOtherFactory, rB, epB, "refused");
  // OT adapter in factory A (machine → station), with an OLD orphaned intent, a NEW one, and one already resolved
  const [{ t }] = await rows(tx, sql`SELECT udt_name AS t FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'machines' AND column_name = 'machineType'`);
  const [{ v }] = await rows(tx, sql`SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid WHERE ty.typname = ${t} ORDER BY e.enumsortorder LIMIT 1`);
  const machine = Number((await one(tx, sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${A.station}, ${`${TAG}-M${seq++}`}, 'm', ${v}::${sql.raw(`"${t}"`)}) RETURNING id`)).id);
  const adapter = Number((await one(tx, sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "machineId") VALUES (${`${TAG}-A${seq++}`}, 'a', 'stub', 'stub://t', ${machine}) RETURNING id`)).id);
  const intent = async (ageMin: number, key: string) =>
    Number(
      (
        await one(
          tx,
          sql`INSERT INTO command_log ("adapterId", "machineId", "tagKey", "commandType", "requestedValue", "requestedBy", "confirmedBy", status, "ackValue", "idempotencyKey", "createdAt")
              VALUES (${adapter}, ${machine}, 'speed', 'setpoint', '42'::jsonb, ${user}, ${user}, 'sent', '{"ledger":"intent"}'::jsonb, ${`intent:${key}`}, LOCALTIMESTAMP - make_interval(mins => ${ageMin})) RETURNING id`,
        )
      ).id,
    );
  const iOld = await intent(INTENT_RESOLVE_MIN_AGE_MINUTES + 15, `${TAG}-k1:speed:0`);
  const iNew = await intent(1, `${TAG}-k2:speed:0`);
  const iDone = await intent(60, `${TAG}-k3:speed:0`);
  await tx.execute(sql`INSERT INTO command_log ("adapterId", "requestedBy", "confirmedBy", status, "ackValue", "idempotencyKey") VALUES (${adapter}, ${user}, ${user}, 'acked', ${JSON.stringify({ ledger: "result", intentId: iDone })}::jsonb, ${`${TAG}-k3:speed:0`})`);
  return { A, B, user, node, rA, rB, sFailed, sPending, sOtherFactory, adapter, iOld, iNew, iDone };
}
const actor = (id: number) => ({ id, name: "F2 supervisor", ip: "127.0.0.1", userAgent: "vitest" });

describe.skipIf(!onTest)("R-10-af / R-10-ax — edge resolution service (_test, rolled back)", () => {
  it("list: STOP flags + unresolved intents, limited to the factory scope (unrestricted / [A] / [])", async () => {
    await inRolledBackTx(async (tx) => {
      const f = await fixture(tx);
      const all = await listEdgeResolutionItems(null);
      expect(all.available).toBe(true);
      const byDev = async (scope: number[] | null) => {
        const r = await listEdgeResolutionItems(scope, { robotId: f.rA });
        const b = await listEdgeResolutionItems(scope, { robotId: f.rB });
        const ad = await listEdgeResolutionItems(scope, { adapterId: f.adapter });
        return { ...r, stops: [...r.stops, ...b.stops], intents: ad.intents } as typeof all;
      };
      const mine = (l: typeof all) => ({
        stops: l.stops.filter((s) => [f.sFailed, f.sPending, f.sOtherFactory].includes(s.requestId)).map((s) => [s.requestId, s.deviceKind, s.deviceId, s.outcome, s.needsResolution, s.factoryId]).sort(),
        intents: l.intents.filter((i) => i.adapterId === f.adapter).map((i) => [i.intentId, i.resolvable, i.factoryId]).sort(),
      });
      expect(mine(await byDev(null))).toEqual({
        stops: [[f.sFailed, "robot", f.rA, "failed", true, f.A.f], [f.sPending, "robot", f.rA, null, false, f.A.f], [f.sOtherFactory, "robot", f.rB, "refused", true, f.B.f]].sort(),
        intents: [[f.iOld, true, f.A.f], [f.iNew, false, f.A.f]].sort(), // iDone has a result ⇒ not listed
      });
      expect(mine(await byDev([f.A.f]))).toEqual({
        stops: [[f.sFailed, "robot", f.rA, "failed", true, f.A.f], [f.sPending, "robot", f.rA, null, false, f.A.f]].sort(),
        intents: [[f.iOld, true, f.A.f], [f.iNew, false, f.A.f]].sort(),
      });
      expect(mine(await byDev([]))).toEqual({ stops: [], intents: [] });
      const ad = await listEdgeResolutionItems(null, { adapterId: f.adapter });
      expect([ad.available && ad.intentTotal, ad.available && ad.stopTotal]).toEqual([2, 0]);
      expect((await listEdgeResolutionItems(null, { robotId: f.rA })).intents).toEqual([]); // a robot has no OT write intents
    });
  });

  it("resolveStop: pending ⇒ notResolvable; other factory ⇒ notFound (same as missing); failed ⇒ resolved by a person (audited, stays visible as resolvedByHuman); twice ⇒ alreadyResolved", async () => {
    await inRolledBackTx(async (tx) => {
      const f = await fixture(tx);
      expect(await resolvePendingStop({ requestId: f.sPending, resolution: "checked", actor: actor(f.user), scope: null })).toMatchObject({ ok: false, reason: "notResolvable" });
      expect(await resolvePendingStop({ requestId: f.sOtherFactory, resolution: "checked", actor: actor(f.user), scope: [f.A.f] })).toMatchObject({ ok: false, reason: "notFound" });
      expect(await resolvePendingStop({ requestId: 2_000_000_000, resolution: "checked", actor: actor(f.user), scope: null })).toMatchObject({ ok: false, reason: "notFound" });
      expect(await resolvePendingStop({ requestId: f.sFailed, resolution: "  ", actor: actor(f.user), scope: null })).toMatchObject({ ok: false, reason: "notResolvable" });
      const ok = await resolvePendingStop({ requestId: f.sFailed, resolution: "robot stopped by hand, verified on site", actor: actor(f.user), scope: [f.A.f] });
      expect(ok).toEqual({ ok: true, id: f.sFailed, deviceKind: "robot", deviceId: f.rA });
      const q = await one(tx, sql`SELECT "resolvedBy", resolution FROM robot_motion_lock_requests WHERE id = ${f.sFailed}`);
      expect(q).toEqual({ resolvedBy: f.user, resolution: "robot stopped by hand, verified on site" });
      const v = await one(tx, sql`SELECT "resolvedByHuman", "needsResolution" FROM device_pending_stops WHERE "requestId" = ${f.sFailed}`);
      expect(v).toEqual({ resolvedByHuman: true, needsResolution: false });
      const aud = await rows(tx, sql`SELECT action, "userId", "entityType", "entityId" FROM audit_logs WHERE "entityName" = ${`stop-request:${f.sFailed}`}`);
      expect(aud).toEqual([{ action: "edge.resolveStop", userId: f.user, entityType: "robot", entityId: f.rA }]);
      expect((await listEdgeResolutionItems(null, { robotId: f.rA })).stops.some((s) => s.requestId === f.sFailed)).toBe(false);
      expect(await resolvePendingStop({ requestId: f.sFailed, resolution: "again", actor: actor(f.user), scope: null })).toMatchObject({ ok: false, reason: "alreadyResolved" });
    });
  });

  it("resolveStop: the audit row cannot be written ⇒ nothing is resolved", async () => {
    await inRolledBackTx(async (tx) => {
      const f = await fixture(tx);
      H.auditFails = true;
      await expect(resolvePendingStop({ requestId: f.sFailed, resolution: "checked on site", actor: actor(f.user), scope: null })).rejects.toThrow(/audit insert failed/);
      H.auditFails = false;
      expect(await one(tx, sql`SELECT "resolvedAt" FROM robot_motion_lock_requests WHERE id = ${f.sFailed}`)).toEqual({ resolvedAt: null });
    });
  });

  it("resolveIntent: too recent ⇒ refused; other factory ⇒ notFound; old orphan ⇒ RESULT row 'timeout' (outcome unknown), linked + audited; twice ⇒ alreadyResolved; a resolved one ⇒ alreadyResolved", async () => {
    await inRolledBackTx(async (tx) => {
      const f = await fixture(tx);
      expect(await resolveOrphanedIntent({ intentId: f.iNew, reason: "gateway crashed", actor: actor(f.user), scope: null })).toMatchObject({ ok: false, reason: "tooRecent" });
      expect(await resolveOrphanedIntent({ intentId: f.iOld, reason: "gateway crashed", actor: actor(f.user), scope: [f.B.f] })).toMatchObject({ ok: false, reason: "notFound" });
      expect(await resolveOrphanedIntent({ intentId: f.iDone, reason: "gateway crashed", actor: actor(f.user), scope: null })).toMatchObject({ ok: false, reason: "alreadyResolved" });
      const ok = await resolveOrphanedIntent({ intentId: f.iOld, reason: "gateway crashed mid-write; valve checked by hand", actor: actor(f.user), scope: [f.A.f] });
      expect(ok).toMatchObject({ ok: true, id: f.iOld, deviceKind: "adapter", deviceId: f.adapter });
      const r = await one(tx, sql`SELECT status, "ackValue", "idempotencyKey", "confirmedBy", "errorText", "tagKey", "requestedValue" FROM command_log WHERE id = ${(ok as { resultId: number }).resultId}`);
      expect(r.status).toBe("timeout");
      expect(r.ackValue).toEqual({ ledger: "result", intentId: f.iOld, outcome: "unknown", resolvedByOperator: f.user, resolution: "gateway crashed mid-write; valve checked by hand" });
      expect(r.idempotencyKey).toBe(`${TAG}-k1:speed:0`);
      expect([r.confirmedBy, r.tagKey, r.requestedValue]).toEqual([f.user, "speed", 42]);
      expect(r.errorText).toMatch(/^OUTCOME_UNKNOWN_RESOLVED_BY_OPERATOR: /);
      const aud = await rows(tx, sql`SELECT action, "userId", "entityId" FROM audit_logs WHERE "entityName" = ${`write-intent:${f.iOld}`}`);
      expect(aud).toEqual([{ action: "ot.resolveOrphanedWriteIntent", userId: f.user, entityId: f.adapter }]);
      expect((await listEdgeResolutionItems(null, { adapterId: f.adapter })).intents.some((i) => i.intentId === f.iOld)).toBe(false);
      expect(await resolveOrphanedIntent({ intentId: f.iOld, reason: "again", actor: actor(f.user), scope: null })).toMatchObject({ ok: false, reason: "alreadyResolved" });
      // the intent row itself is untouched (WORM): still 'sent'
      expect(await one(tx, sql`SELECT status FROM command_log WHERE id = ${f.iOld}`)).toEqual({ status: "sent" });
    });
  });

  it("resolveIntent + owner change: still refused right after (the operator result is 'timeout' = outcome unknown, inside 0374's 10-min stale-write window)", async () => {
    await inRolledBackTx(async (tx) => {
      const f = await fixture(tx);
      const tryOwner = async () => {
        try {
          await tx.transaction(async (sp: any) => sp.execute(sql`UPDATE device_adapters SET "edgeNodeId" = ${f.node} WHERE id = ${f.adapter}`));
          return "ok";
        } catch (e) {
          return String((e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code);
        }
      };
      expect(await tryOwner()).toBe("23514"); // two intents without a result
      await resolveOrphanedIntent({ intentId: f.iOld, reason: "gateway crashed", actor: actor(f.user), scope: null });
      await tx.execute(sql`INSERT INTO command_log ("adapterId", "requestedBy", "confirmedBy", status, "ackValue", "idempotencyKey") VALUES (${f.adapter}, ${f.user}, ${f.user}, 'acked', ${JSON.stringify({ ledger: "result", intentId: f.iNew })}::jsonb, ${`${TAG}-k2:speed:0`})`);
      expect(await tryOwner()).toBe("23514"); // the operator's 'timeout' result is inside the 10-minute stale-write window (documented cost)
      // (WORM: avi_app cannot age a command_log row to show the window passing; the 0374 guard's window itself is A's G3/G4 mutants)
    });
  });

  it("resolveIntent: the audit row cannot be written ⇒ no result row", async () => {
    await inRolledBackTx(async (tx) => {
      const f = await fixture(tx);
      H.auditFails = true;
      await expect(resolveOrphanedIntent({ intentId: f.iOld, reason: "gateway crashed", actor: actor(f.user), scope: null })).rejects.toThrow(/audit insert failed/);
      H.auditFails = false;
      expect(await rows(tx, sql`SELECT id FROM command_log WHERE "ackValue" ->> 'intentId' = ${String(f.iOld)}`)).toEqual([]);
    });
  });

  it("R-10-bj: the result row comes from A's guarded ot_write_intent_resolve — it re-checks what the pre-checks passed (inactive actor ⇒ refused, nothing written), and a direct manual-resolution INSERT is refused", async () => {
    await inRolledBackTx(async (tx) => {
      const f = await fixture(tx);
      const off = Number((await one(tx, sql`INSERT INTO users ("openId", role, "isActive") VALUES (${`${TAG}-off${seq++}`}, 'supervisor', false) RETURNING id`)).id);
      const r = await resolveOrphanedIntent({ intentId: f.iOld, reason: "gateway crashed", actor: { id: off, name: "off" }, scope: null });
      expect(r).toMatchObject({ ok: false, reason: "notResolvable", detail: expect.stringMatching(/not an active user/) });
      expect(await rows(tx, sql`SELECT id FROM command_log WHERE "ackValue" ->> 'intentId' = ${String(f.iOld)}`)).toEqual([]);
      const direct = await tx.transaction(async (sp: any) => sp.execute(sql`INSERT INTO command_log ("adapterId", "requestedBy", "confirmedBy", status, "ackValue") VALUES (${f.adapter}, ${f.user}, ${f.user}, 'timeout', ${JSON.stringify({ ledger: "result", intentId: f.iOld, outcome: "unknown", resolvedByOperator: f.user })}::jsonb)`)).then(() => "ok", (e: any) => String(e?.cause?.code ?? e?.code));
      expect(direct).toBe("23514");
    });
  });

  it("mapIntentResolveRefusal: the guarded function's messages ⇒ the service's reasons", () => {
    expect(mapIntentResolveRefusal("ot_write_intent_resolve: write intent 5 is younger than 10 minutes — it may still be in flight", 5).reason).toBe("tooRecent");
    expect(mapIntentResolveRefusal("ot_write_intent_resolve: write intent 5 already has a result", 5).reason).toBe("alreadyResolved");
    expect(mapIntentResolveRefusal("command_log: write intent 5 already has a result", 5).reason).toBe("alreadyResolved");
    expect(mapIntentResolveRefusal("ot_write_intent_resolve: 5 is not a write intent", 5).reason).toBe("notFound");
    expect(mapIntentResolveRefusal("ot_write_intent_resolve: actor 9 is not an active user", 5)).toEqual({ reason: "notResolvable", detail: "ot_write_intent_resolve: actor 9 is not an active user" });
  });
  it("round 3 (R-10-bl): a REAL device result after a manual resolution is kept as late_result, listed, holds the owner change until reviewed (scoped, audited, once)", async () => {
    await inRolledBackTx(async (tx) => {
      const f = await fixture(tx);
      const res = await resolveOrphanedIntent({ intentId: f.iOld, reason: "gateway crashed", actor: actor(f.user), scope: null });
      expect(res).toMatchObject({ ok: true });
      // the device stage writes its real result late (the normal writer: a plain avi_app INSERT; the DB keeps it as late_result)
      const late = Number((await one(tx, sql`INSERT INTO command_log ("adapterId", "requestedBy", "confirmedBy", status, "ackValue", "idempotencyKey")
        VALUES (${f.adapter}, ${f.user}, ${f.user}, 'acked', ${JSON.stringify({ ledger: "result", intentId: f.iOld })}::jsonb, ${`${TAG}-k1:speed:0`}) RETURNING id`)).id);
      const listed = await listEdgeResolutionItems(null, { adapterId: f.adapter });
      expect(listed.available && listed.lateResults.map((l) => [l.lateResultId, l.intentId, l.status, l.lateAfterResolutionId])).toEqual([[late, f.iOld, "acked", (res as { resultId: number }).resultId]]);
      expect((await listEdgeResolutionItems([f.B.f], { adapterId: f.adapter })).lateResults).toEqual([]);
      const tryOwner = () => tx.transaction(async (sp: any) => sp.execute(sql`UPDATE device_adapters SET "edgeNodeId" = ${f.node} WHERE id = ${f.adapter}`)).then(() => "ok", (e: any) => String(e?.cause?.message ?? e?.message));
      expect(await tryOwner()).toMatch(/landed after a manual resolution — a person must review it/);
      expect(await reviewLateResult({ lateResultId: late, note: "checked the valve: value applied", actor: actor(f.user), scope: [f.B.f] })).toMatchObject({ ok: false, reason: "notFound" });
      expect(await reviewLateResult({ lateResultId: f.iNew, note: "not a late result", actor: actor(f.user), scope: null })).toMatchObject({ ok: false, reason: "notFound" });
      expect(await reviewLateResult({ lateResultId: late, note: "  ", actor: actor(f.user), scope: null })).toMatchObject({ ok: false, reason: "notResolvable" });
      // the guarded function re-checks the actor itself (A round 12 also checks role / scope): an inactive actor ⇒ 23514 ⇒ mapped, nothing written
      const off = Number((await one(tx, sql`INSERT INTO users ("openId", role, "isActive") VALUES (${`${TAG}-loff${seq++}`}, 'admin', false) RETURNING id`)).id);
      expect(await reviewLateResult({ lateResultId: late, note: "checked", actor: actor(off), scope: null })).toMatchObject({ ok: false, reason: "notResolvable", detail: expect.stringMatching(/not an active user/) });
      expect(await rows(tx, sql`SELECT 1 FROM ot_write_late_result_reviews WHERE "lateResultId" = ${late}`)).toEqual([]);
      expect(await reviewLateResult({ lateResultId: late, note: "checked the valve: value applied", actor: actor(f.user), scope: [f.A.f] })).toEqual({ ok: true, id: late, deviceKind: "adapter", deviceId: f.adapter });
      expect(await rows(tx, sql`SELECT "reviewedBy", note FROM ot_write_late_result_reviews WHERE "lateResultId" = ${late}`)).toEqual([{ reviewedBy: f.user, note: "checked the valve: value applied" }]);
      expect(await rows(tx, sql`SELECT action, "userId", "entityId" FROM audit_logs WHERE "entityName" = ${`late-result:${late}`}`)).toEqual([{ action: "ot.reviewLateWriteResult", userId: f.user, entityId: f.adapter }]);
      expect((await listEdgeResolutionItems(null, { adapterId: f.adapter })).lateResults).toEqual([]);
      expect(await reviewLateResult({ lateResultId: late, note: "again", actor: actor(f.user), scope: null })).toMatchObject({ ok: false, reason: "alreadyResolved" });
      // the late hold is gone; the manual 'timeout' result is still inside the DB's 10-minute stale-write window (A round 11: unchanged)
      expect(await tryOwner()).toMatch(/in-flight command/);
    });
  });

  it("round 3: reviewing a late result — the audit row cannot be written ⇒ no review row", async () => {
    await inRolledBackTx(async (tx) => {
      const f = await fixture(tx);
      await resolveOrphanedIntent({ intentId: f.iOld, reason: "gateway crashed", actor: actor(f.user), scope: null });
      const late = Number((await one(tx, sql`INSERT INTO command_log ("adapterId", "requestedBy", "confirmedBy", status, "ackValue") VALUES (${f.adapter}, ${f.user}, ${f.user}, 'failed', ${JSON.stringify({ ledger: "result", intentId: f.iOld })}::jsonb) RETURNING id`)).id);
      H.auditFails = true;
      await expect(reviewLateResult({ lateResultId: late, note: "checked on site", actor: actor(f.user), scope: null })).rejects.toThrow(/audit insert failed/);
      H.auditFails = false;
      expect(await rows(tx, sql`SELECT 1 FROM ot_write_late_result_reviews WHERE "lateResultId" = ${late}`)).toEqual([]);
    });
  });

  it("mapLateReviewRefusal: the guarded function's messages ⇒ the service's reasons", () => {
    expect(mapLateReviewRefusal("ot_write_late_result_review: 5 was already reviewed", 5).reason).toBe("alreadyResolved");
    expect(mapLateReviewRefusal("ot_write_late_result_review: 5 is not a late device write result", 5).reason).toBe("notFound");
    expect(mapLateReviewRefusal("ot_write_late_result_review: actor 9 is not an active user", 5)).toEqual({ reason: "notResolvable", detail: "ot_write_late_result_review: actor 9 is not an active user" });
  });
});
