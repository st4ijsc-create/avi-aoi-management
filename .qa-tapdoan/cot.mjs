import postgres from "postgres";
import { readFileSync } from "node:fs";
const url = readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url,{max:2});
const r = await sql`
  select m.id, m.name, m.code, m."machineType", m."operationStatus", st."lineId",
   (select count(*) from twin_dat_cho dc where dc."loaiThucThe"='machine' and dc."thucTheId"=m.id) as dc
  from machines m join stations st on st.id=m."stationId"
  where st."lineId" = 299 and m."isActive"=true order by m.id limit 4`;
for (const x of r) console.log(x.id, x.name, x.code, x.machineType, x.operationStatus, 'line', x.lineId, 'datCho', x.dc);
await sql.end();
