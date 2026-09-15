import postgres from "postgres";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
const url = readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url, { max: 3 });
const q = async (ids) => sql`
  select m.id, m.name, m.code, m."machineType", m."operationStatus", m."isActive", m."lastHeartbeat",
    st.id as "stationId", st.name as "stationName", st."lineId", l.name as "lineName", l.code as "lineCode",
    f.id as "facId", f.code as "facCode", b.id as "toaId", b.ma as "toaMa", s.id as "tangId", s."capSo",
    (select count(*) from twin_dat_cho dc where dc."loaiThucThe"='machine' and dc."thucTheId"=m.id) as "soDatCho",
    (select dc."tangId" from twin_dat_cho dc where dc."loaiThucThe"='machine' and dc."thucTheId"=m.id limit 1) as "datChoTangId"
  from machines m join stations st on st.id=m."stationId" join production_lines l on l.id=st."lineId"
  join workshops w on w.id=l."workshopId" left join twin_tang s on s.id=w."tangId"
  left join twin_toa_nha b on b.id=s."toaNhaId" join factories f on f.id=w."factoryId"
  where m.id = any(${ids})`;
const out = {};
out.may5676 = await q([5676]);
// máy của line 397 (QATD-C toà T3) và line 347 (QATD-B)
out.mayLine397 = await sql`select m.id, m.name, m.code, m."machineType", m."isActive" from machines m join stations st on st.id=m."stationId" where st."lineId"=397 order by m.id`;
out.mayLine347 = await sql`select m.id, m.name, m.code, m."machineType", m."isActive" from machines m join stations st on st.id=m."stationId" where st."lineId"=347 order by m.id`;
const ids = out.mayLine397.map(m=>m.id);
out.chiTietMayC3 = await q(ids.slice(0,3));
out.line11 = await sql`select l.id, l.name, f.id as "facId", f.code from production_lines l join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId" where l.id=11`;
const s = JSON.stringify(out,(k,v)=>typeof v==="bigint"?Number(v):v,1);
writeFileSync(".qa-tapdoan/tho/V2/.tmp-db-V2c.json", s); renameSync(".qa-tapdoan/tho/V2/.tmp-db-V2c.json",".qa-tapdoan/tho/V2/db-V2c.json");
console.log(s);
await sql.end();
