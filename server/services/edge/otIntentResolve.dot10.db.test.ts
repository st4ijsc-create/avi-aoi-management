/**
 * doc 81 Đợt 10 task A fix review 10 — ruling R-10-bj: the guarded resolution of a crash-orphaned OT write intent.
 * `public.ot_write_intent_resolve(intentId, actorUserId, reason)` (SECURITY DEFINER, pinned, EXECUTE avi_app only) writes the
 * outcome-unknown ('timeout') RESULT row of an intent EXACTLY once; refused (23514) for: an actor that is 0 / not an active user,
 * an empty reason, an intent that already has a result, an intent younger than the in-flight bound (10 min), a row that is not
 * an intent. avi_app keeps INSERT on command_log (the device-stage writer needs it), but a trigger refuses a direct INSERT of a
 * manual-resolution result (ackValue resolvedByOperator / outcome 'unknown') and any SECOND result row of an intent.
 * avi_app on `_test`, rolled back.
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

describe.skipIf(!onTest)("R-10-bj — ot_write_intent_resolve (guarded, exactly once)", () => {
  it("★ refusals, the one good resolution, exactly once, and no direct manual-resolution INSERT", async () => {
    const r = await asApp(async (tx) => {
      const t = `__r10bj_${Date.now()}`;
      const [ad] = await tx`INSERT INTO public.device_adapters (code, name, protocol, endpoint) VALUES (${t}, ${t}, 'stub', 'stub://t') RETURNING id`;
      const [active] = await tx`INSERT INTO public.users ("openId", role, "isActive") VALUES (${t + "a"}, 'admin', true) RETURNING id`;
      const [inactive] = await tx`INSERT INTO public.users ("openId", role, "isActive") VALUES (${t + "i"}, 'admin', false) RETURNING id`;
      const intent = async (ageMin: number) =>
        (
          await tx`INSERT INTO public.command_log ("adapterId", "requestedBy", "confirmedBy", status, "ackValue", "idempotencyKey", "commandType", "createdAt")
                   VALUES (${ad.id}, 1, 1, 'sent', ${tx.json({ ledger: "intent" })}, ${"intent:" + t + randomUUID()}, 'write', LOCALTIMESTAMP - ${ageMin + " minutes"}::interval) RETURNING id`
        )[0].id as number;
      const resolve = (id: number, actor: number | null, reason: string | null) => code(tx, (sp) => sp`SELECT public.ot_write_intent_resolve(${id}, ${actor}, ${reason})`);
      const old = await intent(30);
      const young = await intent(1);
      const [plain] = await tx`INSERT INTO public.command_log ("adapterId", "requestedBy", "confirmedBy", status, "idempotencyKey", "createdAt") VALUES (${ad.id}, 1, 1, 'rejected', ${t + "x"}, LOCALTIMESTAMP - interval '30 minutes') RETURNING id`;
      const out = {
        actor0: await resolve(old, 0, "crashed mid-write"),
        inactive: await resolve(old, inactive.id, "crashed mid-write"),
        noActor: await resolve(old, null, "crashed mid-write"),
        emptyReason: await resolve(old, active.id, "  "),
        tooYoung: await resolve(young, active.id, "crashed mid-write"),
        notAnIntent: await resolve(plain.id, active.id, "crashed mid-write"),
        directManualInsert: await code(tx, (sp) => sp`INSERT INTO public.command_log ("adapterId", "requestedBy", "confirmedBy", status, "ackValue", "idempotencyKey")
             VALUES (${ad.id}, 1, ${active.id}, 'timeout', ${sp.json({ ledger: "result", intentId: old, outcome: "unknown", resolvedByOperator: active.id, resolution: "x" })}, ${t + "m"})`),
        good: await resolve(old, active.id, "gateway crashed mid-write; device checked on site"),
        again: await resolve(old, active.id, "second time"),
        secondDeviceResult: await code(tx, (sp) => sp`INSERT INTO public.command_log ("adapterId", "requestedBy", "confirmedBy", status, "ackValue", "idempotencyKey")
             VALUES (${ad.id}, 1, 1, 'acked', ${sp.json({ ledger: "result", intentId: old })}, ${t + "d"})`),
      };
      const rows = await tx`SELECT status::text AS s, "confirmedBy" AS by, "ackValue" ->> 'outcome' AS o, ("ackValue" ->> 'resolvedByOperator')::int AS op, "errorText" AS e
                              FROM public.command_log WHERE "ackValue" ->> 'ledger' = 'result' AND "ackValue" ->> 'intentId' = ${String(old)}`;
      return { ...out, rows: rows.map((x) => ({ s: x.s, byActor: x.by === active.id, o: x.o, op: x.op === active.id, e: String(x.e).startsWith("OUTCOME_UNKNOWN_RESOLVED_BY_OPERATOR") })) };
    });
    expect(r).toEqual({
      actor0: "23514", inactive: "23514", noActor: "23514", emptyReason: "23514", tooYoung: "23514", notAnIntent: "23514",
      directManualInsert: "23514", good: null, again: "23514", secondDeviceResult: "23514",
      rows: [{ s: "timeout", byActor: true, o: "unknown", op: true, e: true }],
    });
  }, 60_000);

  it("the device-stage writer still inserts its own result row directly (first result of a fresh intent)", async () => {
    const r = await asApp(async (tx) => {
      const t = `__r10bjd_${Date.now()}`;
      const [ad] = await tx`INSERT INTO public.device_adapters (code, name, protocol, endpoint) VALUES (${t}, ${t}, 'stub', 'stub://t') RETURNING id`;
      const [i] = await tx`INSERT INTO public.command_log ("adapterId", "requestedBy", "confirmedBy", status, "ackValue", "idempotencyKey") VALUES (${ad.id}, 1, 1, 'sent', ${tx.json({ ledger: "intent" })}, ${"intent:" + t}) RETURNING id`;
      return code(tx, (sp) => sp`INSERT INTO public.command_log ("adapterId", "requestedBy", "confirmedBy", status, "ackValue", "idempotencyKey") VALUES (${ad.id}, 1, 1, 'acked', ${sp.json({ ledger: "result", intentId: i.id })}, ${t})`);
    });
    expect(r).toBeNull();
  }, 60_000);
});
