#!/usr/bin/env node
/**
 * 0420 — chỉ mục biểu thức `idx_command_log_intent_id` (truy vấn "intent mở" của commandLog.stats).
 * Áp `drizzle/0420_command_log_intent_index.sql` (MỘT câu lệnh, CREATE INDEX CONCURRENTLY — ngoài giao dịch) bằng owner `aoi`, rồi NGHIỆM THU bằng vai `avi_app`:
 *   (a) chỉ mục tồn tại, indisvalid + indisready, là chỉ mục một phần theo biểu thức;
 *   (b) EXPLAIN truy vấn "intent mở" DÙNG chỉ mục này;
 *   (c) quyền `command_log` của avi_app KHÔNG đổi (WORM: không UPDATE/DELETE/TRUNCATE) — đo TRƯỚC (guard.before) và SAU;
 *   (d) thời gian truy vấn TRƯỚC / SAU in ra (trước: trần 20 s — quá ⇒ ghi ">20 s").
 *   node scripts/apply-migration-0420.mjs --test-only | --dev-only | --both   (KHÔNG cờ ⇒ từ chối)
 */
import { expectExact, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

const TRUY_VAN = `select count(*)::int as total,
  (count(*) filter (where not exists (select 1 from command_log r where r."ackValue" ->> 'intentId' = "command_log"."id"::text)))::int as open
  from command_log where coalesce("ackValue" ->> 'ledger', '') = 'intent'`;

const truoc = new Map();
async function dongHo(appSql, tran) {
  const t0 = Date.now();
  try {
    await appSql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL statement_timeout = ${tran}`);
      await tx.unsafe(TRUY_VAN);
    });
    return `${Date.now() - t0} ms`;
  } catch (e) {
    if (e?.code === "57014") return `>${tran / 1000} s (quá trần)`;
    throw e;
  }
}

await runMigration({
  file: "0420_command_log_intent_index.sql",
  tag: "[0420]",
  guard: {
    async before({ sql, label }) {
      // đọc bằng owner (cùng DB) — không đổi gì
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM command_log`;
      const [ten] = await sql`SELECT to_regclass('public.idx_command_log_intent_id') AS i`;
      const [dsn] = await sql`SELECT current_database() AS d`;
      truoc.set(label, { hang: n, coChiMuc: ten.i !== null, db: dsn.d });
      console.log(`  [0420] ${label} TRƯỚC: db=${dsn.d} command_log=${n} hàng, chỉ mục ${ten.i ? "ĐÃ có" : "chưa có"}`);
      if (ten.i === null) {
        const t0 = Date.now();
        try {
          await sql.begin(async (tx) => {
            await tx.unsafe(`SET LOCAL statement_timeout = 20000`);
            await tx.unsafe(TRUY_VAN);
          });
          truoc.get(label).tg = `${Date.now() - t0} ms`;
        } catch (e) {
          if (e?.code !== "57014") throw e;
          truoc.get(label).tg = ">20 s (quá trần 20 s)";
        }
        console.log(`  [0420] ${label} thời gian truy vấn TRƯỚC: ${truoc.get(label).tg}`);
      }
      return false;
    },
  },
  async verify({ appSql, label, log }) {
    const [ix] = await appSql`
      SELECT i.indisvalid AS valid, i.indisready AS ready, i.indpred IS NOT NULL AS partial, i.indexprs IS NOT NULL AS expr, pg_get_indexdef(i.indexrelid) AS def
        FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'idx_command_log_intent_id'`;
    if (!ix) throw new Error("(a) chỉ mục không có");
    if (!ix.valid || !ix.ready) {
      throw new Error("(a) chỉ mục INVALID (lần dựng bị ngắt) — chạy: DROP INDEX CONCURRENTLY public.idx_command_log_intent_id; rồi áp lại");
    }
    expectExact("(a) index", ix, { valid: true, ready: true, partial: true, expr: true });
    log(`(a) ${ix.def}`);

    const plan = (await appSql.unsafe(`EXPLAIN ${TRUY_VAN}`)).map((r) => r["QUERY PLAN"]).join("\n");
    if (!/idx_command_log_intent_id/.test(plan)) throw new Error(`(b) EXPLAIN KHÔNG dùng chỉ mục:\n${plan}`);
    log("(b) EXPLAIN dùng idx_command_log_intent_id");

    const priv = await tablePriv(appSql, "public.command_log");
    expectExact("(c) quyền WORM", priv, { upd: false, del: false, trunc: false });
    log(`(c) quyền avi_app trên command_log: ${JSON.stringify(priv)}`);

    const sau = await dongHo(appSql, 60000);
    const t = truoc.get(label);
    log(`(d) thời gian truy vấn "intent mở": TRƯỚC ${t?.tg ?? "(chỉ mục đã có sẵn trước đó)"} → SAU ${sau} (${t?.hang} hàng)`);
  },
});
