// LÔ C — truy vấn DB (CHỈ SELECT) để dựng kỳ vọng độc lập cho các ca C1..C7.
// node .qa-tapdoan/db-C.mjs [--lines=217,249,284] [--mays=4197,4568,4977] > tệp
import postgres from "postgres";
import { readFileSync } from "node:fs";
const arg=(k,d)=>{const m=process.argv.find(a=>a.startsWith(`--${k}=`));return m?m.slice(k.length+3):d;};
const url = readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url, { max: 3 });
const out = {};
out.factoriesTheoTen = await sql`select id, code, name, "corporateCode", "isActive" from factories where "isActive"=true order by name`;
out.toaNha = await sql`
  select t.id, t."factoryId", f.code as "facCode", t.ma, t.ten, t."isActive"
  from twin_toa_nha t join factories f on f.id=t."factoryId"
  where t."isActive"=true order by t."factoryId", t.ma`;
// Line → workshop → floor → building → factory, kèm số trạm/máy đếm rời
out.line = await sql`
  select l.id as "lineId", l.name as "lineName", l.code as "lineCode", l."isActive" as "lineActive",
         w.id as "wsId", w.name as "wsName", w."tangId",
         s.id as "tangDbId", s."capSo", s."toaNhaId",
         b.ma as "toaMa", b.ten as "toaTen",
         f.id as "facId", f.code as "facCode", f.name as "facName",
         (select count(*) from stations st where st."lineId"=l.id and st."isActive"=true) as "soTram",
         (select count(*) from machines m join stations st on st.id=m."stationId"
            where st."lineId"=l.id and st."isActive"=true and m."isActive"=true) as "soMay"
  from production_lines l
  join workshops w on w.id=l."workshopId"
  left join twin_tang s on s.id=w."tangId"
  left join twin_toa_nha b on b.id=s."toaNhaId"
  join factories f on f.id=w."factoryId"
  where f.code like 'QATD-%'
  order by f.code, b.ma, s."capSo", l.id`;
// line RỖNG (0 máy)
out.lineRong = out.line.filter(r=>Number(r.soMay)===0).map(r=>({lineId:r.lineId,lineName:r.lineName,facCode:r.facCode,soTram:Number(r.soTram)}));
// máy mẫu
const mays = (arg("mays","4197,4568,4977")).split(",").map(Number);
out.may = await sql`
  select m.id, m.name, m.code, m."machineType", m."operationStatus", m."lastHeartbeat", m."isActive",
         st.id as "stationId", st.name as "stationName", st."lineId",
         l.name as "lineName", f.code as "facCode", f.id as "facId",
         b.ma as "toaMa", s."capSo", s.id as "tangId",
         (select count(*) from twin_dat_cho dc where dc."loaiThucThe"='machine' and dc."thucTheId"=m.id) as "soDatCho"
  from machines m
  join stations st on st.id=m."stationId"
  join production_lines l on l.id=st."lineId"
  join workshops w on w.id=l."workshopId"
  left join twin_tang s on s.id=w."tangId"
  left join twin_toa_nha b on b.id=s."toaNhaId"
  join factories f on f.id=w."factoryId"
  where m.id = any(${mays})`;
await sql.end();
console.log(JSON.stringify(out, (k,v)=>typeof v==="bigint"?Number(v):v, 1));
