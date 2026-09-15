import postgres from "postgres";
import { readFileSync } from "node:fs";
const url = readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url, { max: 3 });
const r = await sql`
  select l.id as "lineId", l.name, f.code as "facCode", f.id as "facId",
    (select count(*) from stations st where st."lineId"=l.id) as "soTram",
    (select count(*) from machines m join stations st on st.id=m."stationId" where st."lineId"=l.id) as "soMay",
    (select count(*) from twin_dat_cho dc join machines m on m.id=dc."thucTheId" join stations st on st.id=m."stationId"
       where dc."loaiThucThe"='machine' and st."lineId"=l.id) as "soMayDatCho"
  from production_lines l join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId"
  where f.code not like 'QATD-%' order by f.id, l.id`;
console.log(JSON.stringify(r.map(x=>({...x,soTram:Number(x.soTram),soMay:Number(x.soMay),soMayDatCho:Number(x.soMayDatCho)})),null,0));
await sql.end();
