import { readFileSync } from "node:fs";
import postgres from "postgres";
const url = (readFileSync(".env","utf8").match(/^DATABASE_URL=(.*)$/m)||[])[1].trim();
const sql = postgres(url, { max: 1 });
const t = await sql`select table_name from information_schema.tables where table_schema='public' and (table_name ilike '%alert%' or table_name ilike '%andon%' or table_name ilike '%alarm%') order by 1`;
console.log("BANG:", t.map(r=>r.table_name).join(", "));
for (const r of t) {
  try {
    const cols = await sql.unsafe(`select column_name from information_schema.columns where table_schema='public' and table_name='${r.table_name}' order by ordinal_position`);
    const c = cols.map(x=>x.column_name);
    const n = (await sql.unsafe(`select count(*)::int c from "${r.table_name}"`))[0].c;
    console.log(`- ${r.table_name} (${n} hang) cols: ${c.join(",")}`);
  } catch(e) { console.log("- loi", r.table_name, String(e).slice(0,80)); }
}
await sql.end();
