// VÒNG 3 — truy vấn DB (CHỈ SELECT) dựng kỳ vọng độc lập cho L1..L12.
import postgres from "postgres";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
const url = readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url, { max: 3 });
const out = {};
out.factories = await sql`select id, code, name, "corporateCode", "isActive" from factories where code like 'QATD-%' order by id`;
out.toaNha = await sql`
  select b.id, b."factoryId", f.code as "facCode", b.ma, b.ten, b."isActive"
  from twin_toa_nha b join factories f on f.id=b."factoryId"
  where f.code like 'QATD-%' order by f.code, b.ma`;
out.tang = await sql`
  select s.id, s."toaNhaId", b.ma as "toaMa", f.code as "facCode", s."capSo", s.ten, s."isActive",
    (select count(*) from twin_dat_cho dc where dc."tangId"=s.id) as "soDatCho",
    (select count(*) from twin_dat_cho dc where dc."tangId"=s.id and dc."loaiThucThe"='machine') as "soDatChoMay"
  from twin_tang s join twin_toa_nha b on b.id=s."toaNhaId" join factories f on f.id=b."factoryId"
  where f.code like 'QATD-%' order by f.code, b.ma, s."capSo"`;
out.cotDatCho = (await sql`
  select column_name, data_type from information_schema.columns
  where table_name='twin_dat_cho' order by ordinal_position`).map(r=>`${r.column_name}:${r.data_type}`);
out.tongHangDatCho = Number((await sql`select count(*) as n from twin_dat_cho`)[0].n);
out.tongHangDatChoQATD = Number((await sql`
  select count(*) as n from twin_dat_cho dc
  join twin_tang s on s.id=dc."tangId" join twin_toa_nha b on b.id=s."toaNhaId"
  join factories f on f.id=b."factoryId" where f.code like 'QATD-%'`)[0].n);
out.daKhoaPhanBo = await sql`
  select dc."daKhoa", count(*) as n from twin_dat_cho dc
  join twin_tang s on s.id=dc."tangId" join twin_toa_nha b on b.id=s."toaNhaId"
  join factories f on f.id=b."factoryId" where f.code like 'QATD-%' group by dc."daKhoa"`;
await sql.end();
mkdirSync(".qa-tapdoan/tho/V3",{recursive:true});
const s = JSON.stringify(out, (k,v)=>typeof v==="bigint"?Number(v):v, 1);
writeFileSync(".qa-tapdoan/tho/V3/.tmp-db-V3.json", s);
renameSync(".qa-tapdoan/tho/V3/.tmp-db-V3.json", ".qa-tapdoan/tho/V3/db-V3.json");
console.log("factories:", out.factories.map(f=>`${f.id}:${f.code}`).join(" "));
console.log("toaNha:", out.toaNha.map(b=>`${b.facCode}/${b.ma}=${b.id}`).join(" "));
console.log("tangQATD-A-T1:", out.tang.filter(t=>t.toaMa==='QATD-A-T1').map(t=>`${t.id}:cap${t.capSo}:may${t.soDatChoMay}`).join(" "));
console.log("cot twin_dat_cho:", out.cotDatCho.join(" | "));
console.log("tong hang twin_dat_cho:", out.tongHangDatCho, "· QATD:", out.tongHangDatChoQATD);
console.log("daKhoa:", JSON.stringify(out.daKhoaPhanBo));
