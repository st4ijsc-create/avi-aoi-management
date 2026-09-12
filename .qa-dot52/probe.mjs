// ĐỢT 52 — probe CHỈ ĐỌC (SQL thô, đường độc lập với tRPC). node .qa-dot52/probe.mjs
import { readFileSync } from "node:fs";
import postgres from "postgres";
const url = (readFileSync(".env", "utf8").match(/^DATABASE_URL=(.*)$/m) || [])[1].trim();
const sql = postgres(url, { max: 1 });
const out = {};
try {
  out.factories = await sql`select id, name, "isActive" from factories order by id`;
  out.buildings = await sql`select id, "factoryId", name, "isActive" from buildings order by id`;
  out.floors = await sql`select id, "buildingId", name, "isActive" from floors order by id`;
  out.datcho_theo_tang = await sql`select f.id "tangId", f.name, count(t.*)::int n from floors f left join twin_dat_cho t on t."tangId"=f.id group by f.id, f.name order by f.id`;
  out.user_e2e = await sql`select u.id, u.username, u.role from users u where u.username in ('e2e_tai_loE','operator1','admin')`;
  out.ufa = await sql`select a."userId", u.username, a."factoryId" from user_factory_assignments a join users u on u.id=a."userId" order by a."userId"`;
  out.index_0356 = await sql`select indexname, pg_size_pretty(pg_relation_size(indexname::regclass)) sz from pg_indexes where tablename='machine_health_history' order by indexname`;
} catch (e) { out.loi = String(e).slice(0, 300); }
console.log(JSON.stringify(out, null, 1));
await sql.end();
