/**
 * doc 81 Đợt 10 task A fix review 11 — ruling R-10-bk: EXACTLY ONE result per OT write intent, enforced in the DB, and a REAL
 * device-stage result that lands after a manual "outcome unknown" resolution is never lost.
 *   • a partial UNIQUE index (one ackValue.ledger 'result' row per ackValue.intentId) + a per-intent advisory xact lock taken by
 *     BOTH writer paths (trg_command_log_result_guard for every INSERT, ot_write_intent_resolve) ⇒ two concurrent writers are
 *     serialized; the second sees the first and is refused (23514) — the index is the backstop;
 *   • a device-stage result whose intent already has a MANUAL resolution is kept as evidence: the trigger rewrites it to
 *     ackValue.ledger 'late_result' (+ lateAfterResolutionId, idempotencyKey 'late:<id>:<key>'), the INSERT succeeds (the
 *     dispatcher's `.returning({ id })` is unchanged), and the adapter's owner change stays refused until a person reviews it
 *     via ot_write_late_result_review(lateResultId, actor, note) (SECURITY DEFINER, avi_app EXECUTE only) — on top of the
 *     10-minute window every 'timeout' result (the manual one included) holds; the refusal names the late result until reviewed.
 * Two real avi_app sessions on `_test` (committed — a race cannot be shown inside one transaction; command_log is WORM so the
 * tagged rows stay, as R-10-aa accepted). Every wait is bounded (lock_timeout + timers). The single-session test rolls back.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { taoNguoiDungTest } from "../../testing/nguoiDungTest";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const TAG = `__r11bk_${Date.now()}`;
type Sql = ReturnType<typeof postgres>;
type Tx = postgres.TransactionSql;
const conns: Sql[] = [];
const open = () => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {} });
  conns.push(c);
  return c;
};
afterAll(async () => {
  for (const x of conns) await x.end({ timeout: 5 }).catch(() => undefined);
});
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
/** null = accepted; else "<code> late" when the refusal names the unreviewed late result, "<code> other" otherwise */
const refusalOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; message?: string }) => `${e?.code ?? "error"} ${/landed after a manual resolution/.test(String(e?.message)) ? "late" : "other"}`,
  );
async function code(tx: Tx, fn: (sp: Tx) => Promise<unknown>): Promise<string | null> {
  try {
    await tx.savepoint((sp) => fn(sp as Tx));
    return null;
  } catch (e) {
    return String((e as { code?: string }).code ?? (e as Error).message);
  }
}
class Rollback extends Error {}

/** committed fixture: two edge nodes, an adapter owned by the first, an active user, an intent 30 min old */
async function fixture(c: Sql, k: string, intentPrefix = "intent:") {
  const [d] = await c`SELECT current_database() AS d`;
  if (!String(d.d).endsWith("_test")) throw new Error("not _test");
  const [n1] = await c`INSERT INTO public.edge_nodes (code, name, status) VALUES (${TAG + k + "a"}, ${TAG}, 'offline') RETURNING id`;
  const [n2] = await c`INSERT INTO public.edge_nodes (code, name, status) VALUES (${TAG + k + "b"}, ${TAG}, 'offline') RETURNING id`;
  const [ad] = await c`INSERT INTO public.device_adapters (code, name, protocol, endpoint) VALUES (${TAG + k}, ${TAG}, 'stub', 'stub://r11') RETURNING id`;
  await c`UPDATE public.device_adapters SET "edgeNodeId" = ${n1.id} WHERE id = ${ad.id}`;
  // người dùng của fixture ĐÃ COMMIT: qua helper để afterAll dọn (hàng ở nhánh giao dịch hoàn tác bên dưới vẫn tự biến mất)
  const u = await taoNguoiDungTest(k + "u", "admin", { tienTo: TAG, ts: "f" });
  const key = `${TAG}${k}:${randomUUID()}`;
  const [i] = await c`INSERT INTO public.command_log ("adapterId", "requestedBy", "confirmedBy", status, "ackValue", "idempotencyKey", "commandType", "createdAt")
                      VALUES (${ad.id}, 1, 1, 'sent', ${c.json({ ledger: "intent" })}, ${intentPrefix + key}, 'write', LOCALTIMESTAMP - interval '30 minutes') RETURNING id`;
  return { n2: n2.id as number, adapter: ad.id as number, actor: u.id as number, intent: i.id as number, resultKey: key };
}
const deviceResult = (s: Sql | Tx, f: { adapter: number; intent: number }, key: string, status = "acked") =>
  s`INSERT INTO public.command_log ("adapterId", "requestedBy", "confirmedBy", status, "ackValue", "idempotencyKey", "commandType")
    VALUES (${f.adapter}, 1, 1, ${status}, ${s.json({ ledger: "result", intentId: f.intent })}, ${key}, 'write')
    RETURNING id, "ackValue" ->> 'ledger' AS ledger, ("ackValue" ->> 'lateAfterResolutionId')::int AS "lateAfter", "idempotencyKey" AS k`;
const ledgerRows = (c: Sql, intent: number) =>
  c`SELECT id, "ackValue" ->> 'ledger' AS ledger, ("ackValue" ? 'resolvedByOperator') AS manual FROM public.command_log
    WHERE "ackValue" ->> 'intentId' = ${String(intent)} ORDER BY id`;

describe.skipIf(!onTest)("R-10-bk — exactly one result per intent under concurrency; late real result kept (two sessions)", () => {
  it("★ two device-stage results for one intent at once: the second WAITS for the first, then is refused — one result", async () => {
    const f = await fixture(open(), "dd");
    const a = await open().reserve();
    const b = await open().reserve();
    await a`BEGIN`;
    await a`SET LOCAL lock_timeout = '10s'`;
    await deviceResult(a as unknown as Sql, f, f.resultKey);
    await b`BEGIN`;
    await b`SET LOCAL lock_timeout = '10s'`;
    const second = codeOf(deviceResult(b as unknown as Sql, f, f.resultKey + ":2"));
    const whileFirstOpen = await stateAfter(second, 600);
    await a`COMMIT`;
    const secondCode = await second;
    await b`ROLLBACK`;
    a.release();
    b.release();
    const rows = await ledgerRows(open(), f.intent);
    expect({ whileFirstOpen, secondCode, results: rows.filter((r) => r.ledger === "result").length }).toEqual({
      whileFirstOpen: "pending",
      secondCode: "23514",
      results: 1,
    });
  }, 30_000);

  it("★ device result first (uncommitted), then a manual resolve (no shared key): the resolve WAITS, then is refused", async () => {
    const f = await fixture(open(), "dm", "legacy:"); // manual key = 'resolve:<id>' ⇒ no idempotencyKey collision to hide behind
    const a = await open().reserve();
    const b = await open().reserve();
    await a`BEGIN`;
    await a`SET LOCAL lock_timeout = '10s'`;
    await deviceResult(a as unknown as Sql, f, f.resultKey);
    await b`BEGIN`;
    await b`SET LOCAL lock_timeout = '10s'`;
    const resolve = codeOf(b`SELECT public.ot_write_intent_resolve(${f.intent}, ${f.actor}, 'gateway crashed mid-write')`);
    const whileDeviceOpen = await stateAfter(resolve, 600);
    await a`COMMIT`;
    const resolveCode = await resolve;
    await b`ROLLBACK`;
    a.release();
    b.release();
    const rows = await ledgerRows(open(), f.intent);
    expect({ whileDeviceOpen, resolveCode, ledgers: rows.map((r) => [r.ledger, r.manual]) }).toEqual({
      whileDeviceOpen: "pending",
      resolveCode: "23514",
      ledgers: [["result", false]],
    });
  }, 30_000);

  it("★ manual resolve first (uncommitted), then the REAL device result: it WAITS, then is KEPT as late_result evidence; the owner change names it until reviewed", async () => {
    const C = open();
    const f = await fixture(C, "md");
    const a = await open().reserve();
    const b = await open().reserve();
    await a`BEGIN`;
    await a`SET LOCAL lock_timeout = '10s'`;
    const [m] = await a`SELECT public.ot_write_intent_resolve(${f.intent}, ${f.actor}, 'gateway crashed mid-write') AS id`;
    await b`BEGIN`;
    await b`SET LOCAL lock_timeout = '10s'`;
    let late: { id: number; ledger: string; lateAfter: number; k: string } | null = null;
    const dev = codeOf(
      deviceResult(b as unknown as Sql, f, f.resultKey, "acked_verified").then((r) => {
        late = r[0] as unknown as typeof late;
      }),
    );
    const whileManualOpen = await stateAfter(dev, 600);
    await a`COMMIT`;
    const devCode = await dev;
    await b`COMMIT`;
    a.release();
    b.release();
    const lateRow = late as { id: number; ledger: string; lateAfter: number; k: string } | null;
    const ownerChangeBeforeReview = await refusalOf(C`UPDATE public.device_adapters SET "edgeNodeId" = ${f.n2} WHERE id = ${f.adapter}`);
    const review = await codeOf(C`SELECT public.ot_write_late_result_review(${lateRow?.id ?? 0}, ${f.actor}, 'device did write; value checked on site')`);
    const reviewAgain = await codeOf(C`SELECT public.ot_write_late_result_review(${lateRow?.id ?? 0}, ${f.actor}, 'twice')`);
    // after the review only the 10-minute timeout window of the manual result is left (refused, but no longer for the late result)
    const ownerChangeAfterReview = await refusalOf(C`UPDATE public.device_adapters SET "edgeNodeId" = ${f.n2} WHERE id = ${f.adapter}`);
    const rows = await ledgerRows(C, f.intent);
    expect({
      whileManualOpen,
      devCode,
      late: lateRow && { ledger: lateRow.ledger, afterManual: lateRow.lateAfter === m.id, key: lateRow.k.startsWith(`late:${lateRow.id}:`) },
      ledgers: rows.map((r) => [r.ledger, r.manual]),
      ownerChangeBeforeReview,
      review,
      reviewAgain,
      ownerChangeAfterReview,
    }).toEqual({
      whileManualOpen: "pending",
      devCode: null,
      late: { ledger: "late_result", afterManual: true, key: true },
      ledgers: [
        ["result", true],
        ["late_result", false],
      ],
      ownerChangeBeforeReview: "23514 late",
      review: null,
      reviewAgain: "23514",
      ownerChangeAfterReview: "23514 other",
    });
  }, 30_000);

  it("★ (one session, rolled back) a forged late_result and a bad review are refused; the index is the backstop", async () => {
    const c = open();
    let out: Record<string, unknown> = {};
    await c
      .begin(async (tx) => {
        const t = `${TAG}s${randomUUID()}`;
        const [ad] = await tx`INSERT INTO public.device_adapters (code, name, protocol, endpoint) VALUES (${t}, ${t}, 'stub', 'stub://r11') RETURNING id`;
        const [u] = await tx`INSERT INTO public.users ("openId", role, "isActive") VALUES (${t + "u"}, 'admin', true) RETURNING id`;
        const [off] = await tx`INSERT INTO public.users ("openId", role, "isActive") VALUES (${t + "o"}, 'admin', false) RETURNING id`;
        const [i] = await tx`INSERT INTO public.command_log ("adapterId", "requestedBy", "confirmedBy", status, "ackValue", "idempotencyKey", "createdAt")
                             VALUES (${ad.id}, 1, 1, 'sent', ${tx.json({ ledger: "intent" })}, ${"intent:" + t}, LOCALTIMESTAMP - interval '30 minutes') RETURNING id`;
        const [plain] = await tx`INSERT INTO public.command_log ("adapterId", "requestedBy", "confirmedBy", status, "idempotencyKey") VALUES (${ad.id}, 1, 1, 'rejected', ${t + "p"}) RETURNING id`;
        const forged = await code(tx, (sp) => sp`INSERT INTO public.command_log ("adapterId", "requestedBy", "confirmedBy", status, "ackValue", "idempotencyKey")
                                                 VALUES (${ad.id}, 1, 1, 'acked', ${sp.json({ ledger: "late_result", intentId: i.id })}, ${t + "f"})`);
        await tx`SELECT public.ot_write_intent_resolve(${i.id}, ${u.id}, 'gateway crashed mid-write')`;
        const [late] = await deviceResult(tx, { adapter: ad.id, intent: i.id }, t);
        out = {
          forged,
          lateLedger: late.ledger,
          reviewInactive: await code(tx, (sp) => sp`SELECT public.ot_write_late_result_review(${late.id}, ${off.id}, 'checked on site')`),
          reviewActor0: await code(tx, (sp) => sp`SELECT public.ot_write_late_result_review(${late.id}, 0, 'checked on site')`),
          reviewNoNote: await code(tx, (sp) => sp`SELECT public.ot_write_late_result_review(${late.id}, ${u.id}, '  ')`),
          reviewNotLate: await code(tx, (sp) => sp`SELECT public.ot_write_late_result_review(${plain.id}, ${u.id}, 'checked on site')`),
          reviewDirectInsert: await code(tx, (sp) => sp`INSERT INTO public.ot_write_late_result_reviews ("lateResultId", "reviewedBy", note) VALUES (${late.id}, ${u.id}, 'x')`),
          reviewGood: await code(tx, (sp) => sp`SELECT public.ot_write_late_result_review(${late.id}, ${u.id}, 'checked on site')`),
          uniqueIndex: (await tx`SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = 'command_log' AND indexname = 'ux_command_log_one_result_per_intent' AND indexdef LIKE '%UNIQUE%'`)[0].n,
        };
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
    expect(out).toEqual({
      forged: "23514",
      lateLedger: "late_result",
      reviewInactive: "23514",
      reviewActor0: "23514",
      reviewNoNote: "23514",
      reviewNotLate: "23514",
      reviewDirectInsert: "42501",
      reviewGood: null,
      uniqueIndex: 1,
    });
  }, 30_000);
});
