import postgres from "postgres"; import fs from "node:fs";
const url = fs.readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url,{max:1});
for (const t of ["twin_toa_nha","twin_tang","twin_dat_cho","andon_notes"]) {
  const c = await sql`select column_name from information_schema.columns where table_name=${t} order by ordinal_position`;
  console.log(t+": "+c.map(x=>x.column_name).join(", "));
}
await sql.end();
