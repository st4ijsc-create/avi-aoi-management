/**
 * doc 81 Đợt 10 task A fix review 12 — ruling R-10-bm: every HUMAN-resolution function checks, IN THE DB, that the actor may
 * resolve — the same rule as F2's edgeResolution router (supervisorProcedure = admin | supervisor, + requirePermission
 * ('machine_control', 'canEdit'), + the caller's factory scope, strict). A viewer's (or any active user's) id is not enough.
 *   edge_stop_resolve(request, actor, resolution) · ot_write_intent_resolve(intent, actor, reason) ·
 *   ot_write_late_result_review(lateResult, actor, note)
 * Refused (23514) and NOTHING written when the actor is: 0 / unknown / inactive; not admin or supervisor; a supervisor without
 * an unexpired machine_control canEdit grant; an admin with an unexpired explicit machine_control canEdit = false (the
 * RBAC_SCOPED_ADMIN reading — the DB cannot see that env, so it takes the stricter of both modes); a supervisor whose
 * factory / corporate assignments do not cover the device's factory, or the device has no factory chain.
 * The review table stays WORM with app SELECT only. avi_app on `_test`, rolled back.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
class Rollback extends Error {}
type Tx = postgres.TransactionSql;
async function asApp<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {} });
  let out: T | undefined;
  try {
    const [d] = await c`SELECT current_database() AS d`;
    if (!String(d.d).endsWith("_test")) throw new Error("not _test");
    await c.begin(async (tx) => {
      out = await body(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  } finally {
    await c.end({ timeout: 5 });
  }
  return out as T;
}
async function code(tx: Tx, fn: (sp: Tx) => Promise<unknown>): Promise<string | null> {
  try {
    await tx.savepoint((sp) => fn(sp as Tx));
    return null;
  } catch (e) {
    return String((e as { code?: string }).code ?? (e as Error).message);
  }
}

const ACTORS = ["user0", "inactiveSup", "viewer", "operator", "supNoGrant", "supExpiredGrant", "supCanViewOnly", "supNoScope", "supOtherFactory", "supFactory", "supCorporate", "admin", "adminDenied"] as const;
type ActorName = (typeof ACTORS)[number];
const ALLOWED: ActorName[] = ["supFactory", "supCorporate", "admin"];

async function world(tx: Tx) {
  const t = `__r12bm_${randomUUID().slice(0, 8)}`;
  await tx`INSERT INTO public.corporates (code, name) VALUES (${t + "c1"}, ${t}), (${t + "c2"}, ${t})`;
  const [f1] = await tx`INSERT INTO public.factories (code, name, "corporateCode") VALUES (${t + "f1"}, ${t}, ${t + "c1"}) RETURNING id, code`;
  const [f2] = await tx`INSERT INTO public.factories (code, name, "corporateCode") VALUES (${t + "f2"}, ${t}, ${t + "c2"}) RETURNING id, code`;
  const [w] = await tx`INSERT INTO public.workshops ("factoryId", code, name) VALUES (${f1.id}, ${t}, ${t}) RETURNING id`;
  const [l] = await tx`INSERT INTO public.production_lines ("workshopId", code, name) VALUES (${w.id}, ${t}, ${t}) RETURNING id`;
  const [st] = await tx`INSERT INTO public.stations ("lineId", code, name) VALUES (${l.id}, ${t}, ${t}) RETURNING id`;
  const [m] = await tx`INSERT INTO public.machines ("stationId", code, name, "machineType") VALUES (${st.id}, ${t}, ${t}, (SELECT enumlabel::machinetypeenum FROM pg_enum e JOIN pg_type y ON y.oid = e.enumtypid WHERE y.typname = 'machinetypeenum' ORDER BY e.enumsortorder LIMIT 1)) RETURNING id`;
  const [adIn] = await tx`INSERT INTO public.device_adapters (code, name, protocol, endpoint, "machineId") VALUES (${t + "ai"}, ${t}, 'stub', 'stub://r12', ${m.id}) RETURNING id`;
  const [adOrphan] = await tx`INSERT INTO public.device_adapters (code, name, protocol, endpoint) VALUES (${t + "ao"}, ${t}, 'stub', 'stub://r12') RETURNING id`;
  const [node] = await tx`INSERT INTO public.edge_nodes (code, name, status) VALUES (${t + "n"}, ${t}, 'offline') RETURNING id`;
  const user = async (k: string, role: string, active = true) =>
    (await tx`INSERT INTO public.users ("openId", role, "isActive") VALUES (${t + k}, ${role}, ${active}) RETURNING id`)[0].id as number;
  const grant = (uid: number, canEdit: boolean, expired = false, canView = true) =>
    tx`INSERT INTO public.permissions ("userId", category, "moduleName", "canView", "canEdit", "expiresAt") VALUES (${uid}, 'machine_control', 'machine_control', ${canView}, ${canEdit}, ${expired ? tx`LOCALTIMESTAMP - interval '2 days'` : null})`;
  const a: Record<ActorName, number> = {} as Record<ActorName, number>;
  a.user0 = 0;
  a.inactiveSup = await user("is", "supervisor", false);
  a.viewer = await user("v", "viewer");
  a.operator = await user("o", "operator");
  a.supNoGrant = await user("s0", "supervisor");
  a.supExpiredGrant = await user("se", "supervisor");
  a.supCanViewOnly = await user("sv", "supervisor");
  a.supNoScope = await user("sn", "supervisor");
  a.supOtherFactory = await user("so", "supervisor");
  a.supFactory = await user("sf", "supervisor");
  a.supCorporate = await user("sc", "supervisor");
  a.admin = await user("a", "admin");
  a.adminDenied = await user("ad", "admin");
  for (const k of ["inactiveSup", "viewer", "operator", "supNoScope", "supOtherFactory", "supFactory", "supCorporate"] as const) await grant(a[k], true);
  await grant(a.supExpiredGrant, true, true);
  await grant(a.supCanViewOnly, false);
  await grant(a.adminDenied, false);
  for (const k of ["inactiveSup", "viewer", "operator", "supNoGrant", "supExpiredGrant", "supCanViewOnly", "supFactory"] as const)
    await tx`INSERT INTO public.user_factory_assignments ("userId", "factoryCode") VALUES (${a[k]}, ${f1.code})`;
  await tx`INSERT INTO public.user_factory_assignments ("userId", "factoryCode") VALUES (${a.supOtherFactory}, ${f2.code})`;
  await tx`INSERT INTO public.user_corporate_assignments ("userId", "corporateCode") VALUES (${a.supCorporate}, ${t + "c1"})`;
  let seq = 0;
  const intent = async (adapter: number) =>
    (
      await tx`INSERT INTO public.command_log ("adapterId", "requestedBy", "confirmedBy", status, "ackValue", "idempotencyKey", "createdAt")
               VALUES (${adapter}, 1, 1, 'sent', ${tx.json({ ledger: "intent" })}, ${`intent:${t}:${seq++}`}, LOCALTIMESTAMP - interval '30 minutes') RETURNING id`
    )[0].id as number;
  const lateResult = async (adapter: number) => {
    const i = await intent(adapter);
    await tx`SELECT public.ot_write_intent_resolve(${i}, ${a.admin}, 'gateway crashed mid-write')`;
    const [r] = await tx`INSERT INTO public.command_log ("adapterId", "requestedBy", "confirmedBy", status, "ackValue", "idempotencyKey")
                         VALUES (${adapter}, 1, 1, 'acked', ${tx.json({ ledger: "result", intentId: i })}, ${`${t}:${seq++}`}) RETURNING id, "ackValue" ->> 'ledger' AS l`;
    if (r.l !== "late_result") throw new Error("fixture: not a late result");
    return r.id as number;
  };
  const refusedStop = async (inFactory: boolean) => {
    const [r] = await tx`INSERT INTO public.robots (code, name, vendor, endpoint, "stationId") VALUES (${`${t}r${seq++}`}, ${t}, 'sim', 'sim://r12', ${inFactory ? st.id : null}) RETURNING id`;
    await tx`UPDATE public.robots SET "edgeNodeId" = ${node.id} WHERE id = ${r.id}`; // epoch 2
    const [q] = await tx`INSERT INTO public.robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, "requestedBy", "expiresAt", reason)
                         VALUES (${r.id}, ${node.id}, 2, 'stop', 1, now() + interval '1 minute', 'operator STOP') RETURNING id`;
    await tx`SELECT public.edge_stop_ack_edge(${q.id}, ${node.id}, ${r.id}::integer, NULL::integer, 2::bigint, 'refused', false, NULL)`;
    return q.id as number;
  };
  return { a, adIn: adIn.id as number, adOrphan: adOrphan.id as number, intent, lateResult, refusedStop };
}

type Fn = "edge_stop_resolve" | "ot_write_intent_resolve" | "ot_write_late_result_review";
async function attempt(tx: Tx, w: Awaited<ReturnType<typeof world>>, fn: Fn, actor: number, inFactory: boolean) {
  if (fn === "ot_write_intent_resolve") {
    const id = await w.intent(inFactory ? w.adIn : w.adOrphan);
    const c = await code(tx, (sp) => sp`SELECT public.ot_write_intent_resolve(${id}, ${actor}, 'gateway crashed mid-write')`);
    const [n] = await tx`SELECT count(*)::int AS n FROM public.command_log WHERE "ackValue" ->> 'intentId' = ${String(id)}`;
    return `${c ?? "ok"}${n.n > 0 ? "+written" : ""}`;
  }
  if (fn === "ot_write_late_result_review") {
    const id = await w.lateResult(inFactory ? w.adIn : w.adOrphan);
    const c = await code(tx, (sp) => sp`SELECT public.ot_write_late_result_review(${id}, ${actor}, 'checked on site')`);
    const [n] = await tx`SELECT count(*)::int AS n FROM public.ot_write_late_result_reviews WHERE "lateResultId" = ${id}`;
    return `${c ?? "ok"}${n.n > 0 ? "+written" : ""}`;
  }
  const id = await w.refusedStop(inFactory);
  const c = await code(tx, (sp) => sp`SELECT public.edge_stop_resolve(${id}, ${actor}, 'stopped by hand at the cabinet')`);
  const [r] = await tx`SELECT "resolvedAt" IS NOT NULL AS done FROM public.robot_motion_lock_requests WHERE id = ${id}`;
  return `${c ?? "ok"}${r.done ? "+written" : ""}`;
}

describe.skipIf(!onTest)("R-10-bm — human-resolution functions authorize the actor in the DB (role + machine_control canEdit + factory scope)", () => {
  for (const fn of ["edge_stop_resolve", "ot_write_intent_resolve", "ot_write_late_result_review"] as const) {
    it(`★ ${fn}: only admin / supervisor with machine_control canEdit in the device's factory scope; refusals write nothing`, async () => {
      const got = await asApp(async (tx) => {
        const w = await world(tx);
        const out: Record<string, string> = {};
        for (const k of ACTORS) out[k] = await attempt(tx, w, fn, w.a[k], true);
        out["supFactory@noFactoryDevice"] = await attempt(tx, w, fn, w.a.supFactory, false);
        out["admin@noFactoryDevice"] = await attempt(tx, w, fn, w.a.admin, false);
        return out;
      });
      const want: Record<string, string> = {};
      for (const k of ACTORS) want[k] = ALLOWED.includes(k) ? "ok+written" : "23514";
      want["supFactory@noFactoryDevice"] = "23514";
      want["admin@noFactoryDevice"] = "ok+written";
      expect(got).toEqual(want);
    }, 120_000);
  }

  it("★ the review table is WORM and app-read-only: avi_app cannot INSERT / UPDATE / DELETE a review row", async () => {
    const got = await asApp(async (tx) => {
      const w = await world(tx);
      const late = await w.lateResult(w.adIn);
      await tx`SELECT public.ot_write_late_result_review(${late}, ${w.a.admin}, 'checked on site')`;
      const late2 = await w.lateResult(w.adIn);
      return {
        insert: await code(tx, (sp) => sp`INSERT INTO public.ot_write_late_result_reviews ("lateResultId", "reviewedBy", note) VALUES (${late2}, ${w.a.viewer}, 'forged')`),
        update: await code(tx, (sp) => sp`UPDATE public.ot_write_late_result_reviews SET "reviewedBy" = ${w.a.viewer} WHERE "lateResultId" = ${late}`),
        del: await code(tx, (sp) => sp`DELETE FROM public.ot_write_late_result_reviews WHERE "lateResultId" = ${late}`),
        truncate: await code(tx, (sp) => sp`TRUNCATE public.ot_write_late_result_reviews`),
        grants: (await tx`SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) AS g FROM information_schema.role_table_grants WHERE table_name = 'ot_write_late_result_reviews' AND grantee = 'avi_app'`)[0].g,
        wormTriggers: (await tx`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'public.ot_write_late_result_reviews'::regclass AND NOT tgisinternal AND tgname LIKE 'trg_ot_write_late_result_reviews_worm%'`)[0].n,
      };
    });
    expect(got).toEqual({ insert: "42501", update: "42501", del: "42501", truncate: "42501", grants: "SELECT", wormTriggers: 2 });
  }, 60_000);
});
