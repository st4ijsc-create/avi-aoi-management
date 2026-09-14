// ĐỢT 51 — 11 khoá bất biến DB (đường ra ENV QA_OUT, mặc định .qa-dot51). G130: ghi tệp tạm rồi mv.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import postgres from "postgres";
const OUT = process.env.QA_OUT ?? ".qa-dot51";
const TAG = process.argv[2] ?? "x";
mkdirSync(OUT, { recursive: true });
const url = (readFileSync(".env","utf8").match(/^DATABASE_URL=(.*)$/m)||[])[1].trim();
const sql = postgres(url,{max:1});
const n = async (q) => Number((await sql.unsafe(`SELECT count(*)::bigint n FROM ${q}`))[0].n);
const kq = {
  db: (await sql`SELECT current_database() d, now() n, current_setting('TimeZone') tz`)[0],
  factories: await n("factories"),
  twin_dat_cho: await n("twin_dat_cho"),
  stations: await n("stations"),
  machines_active: await n(`machines WHERE "isActive"`),
  users: await n("users"),
  andon: await n("andon_events"),
  andon_raised: await n("andon_events WHERE status='raised'"),
  hb: await n("machine_heartbeats"),
  msl: await n("machine_status_logs"),
  permissions: await n("permissions"),
  ufa: await n("user_factory_assignments"),
  mhh: await n("machine_health_history"),
};
const p = `${OUT}/db-${TAG}.txt`;
writeFileSync(p + ".tmp", JSON.stringify(kq));
renameSync(p + ".tmp", p);
console.log(JSON.stringify(kq));
await sql.end();
