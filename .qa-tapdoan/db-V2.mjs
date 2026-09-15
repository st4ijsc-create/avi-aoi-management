// VÒNG 2 — truy vấn DB (CHỈ SELECT) dựng kỳ vọng độc lập cho R1..R8, N-*, H-*.
import postgres from "postgres";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
const url = readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url, { max: 3 });
const out = {};
out.factories = await sql`select id, code, name, "corporateCode", "isActive" from factories order by id`;
out.toaNha = await sql`
  select b.id, b."factoryId", f.code as "facCode", b.ma, b.ten, b."rongMm", b."sauMm", b."isActive"
  from twin_toa_nha b join factories f on f.id=b."factoryId"
  where f.code like 'QATD-%' order by f.code, b.ma`;
out.tang = await sql`
  select s.id, s."toaNhaId", b.ma as "toaMa", f.code as "facCode", s."capSo", s.ten, s."isActive",
    (select count(*) from twin_dat_cho dc where dc."tangId"=s.id) as "soDatCho",
    (select count(*) from twin_dat_cho dc where dc."tangId"=s.id and dc."loaiThucThe"='machine') as "soDatChoMay"
  from twin_tang s join twin_toa_nha b on b.id=s."toaNhaId" join factories f on f.id=b."factoryId"
  where f.code like 'QATD-%' order by f.code, b.ma, s."capSo"`;
// Line: workshop.tangId (đường schema) VÀ tầng đa số theo twin_dat_cho (đường bản vá dùng)
out.line = await sql`
  select l.id as "lineId", l.name as "lineName", l.code as "lineCode", l."isActive",
         w.id as "wsId", w.name as "wsName", w."tangId" as "wsTangId",
         s.id as "tangDbId", s."capSo", s."toaNhaId", b.ma as "toaMa",
         f.id as "facId", f.code as "facCode",
         (select count(*) from stations st where st."lineId"=l.id and st."isActive"=true) as "soTram",
         (select count(*) from machines m join stations st on st.id=m."stationId"
            where st."lineId"=l.id and st."isActive"=true and m."isActive"=true) as "soMay",
         (select count(*) from twin_dat_cho dc join machines m on m.id=dc."thucTheId"
            join stations st on st.id=m."stationId"
            where dc."loaiThucThe"='machine' and st."lineId"=l.id) as "soMayDatCho",
         (select string_agg(distinct dc."tangId"::text, ',') from twin_dat_cho dc join machines m on m.id=dc."thucTheId"
            join stations st on st.id=m."stationId"
            where dc."loaiThucThe"='machine' and st."lineId"=l.id) as "tangDatCho"
  from production_lines l
  join workshops w on w.id=l."workshopId"
  left join twin_tang s on s.id=w."tangId"
  left join twin_toa_nha b on b.id=s."toaNhaId"
  join factories f on f.id=w."factoryId"
  where f.code like 'QATD-%'
  order by f.code, b.ma, s."capSo", l.id`;
out.lineRong = out.line.filter(r=>Number(r.soMay)===0).map(r=>({lineId:r.lineId,lineName:r.lineName,facCode:r.facCode,toaMa:r.toaMa,capSo:r.capSo,soTram:Number(r.soTram)}));
out.lineKhongDatCho = out.line.filter(r=>Number(r.soMay)>0 && Number(r.soMayDatCho)===0).map(r=>({lineId:r.lineId,lineName:r.lineName,facCode:r.facCode,soMay:Number(r.soMay)}));
await sql.end();
mkdirSync(".qa-tapdoan/tho/V2",{recursive:true});
const s = JSON.stringify(out, (k,v)=>typeof v==="bigint"?Number(v):v, 1);
writeFileSync(".qa-tapdoan/tho/V2/.tmp-db-V2.json", s);
renameSync(".qa-tapdoan/tho/V2/.tmp-db-V2.json", ".qa-tapdoan/tho/V2/db-V2.json");
console.log("factories", out.factories.filter(f=>String(f.code).startsWith("QATD")).map(f=>`${f.id}:${f.code}`).join(" "));
console.log("toaNha:", out.toaNha.map(b=>`${b.facCode}/${b.ma}=${b.id}`).join(" "));
console.log("lineRong:", JSON.stringify(out.lineRong));
console.log("lineKhongDatCho:", JSON.stringify(out.lineKhongDatCho).slice(0,400));
