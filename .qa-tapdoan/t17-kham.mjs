// Task 17 — khảo sát dữ liệu QATD (CHỈ SELECT).
import postgres from "postgres";
import { readFileSync } from "node:fs";
const url = readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url, { max: 2 });
const out = {};
out.nhaMay = await sql`select id, code, name, "isActive" from factories where code like 'QATD-%' order by id`;
out.toa = await sql`select b.id, b."factoryId", b.ma, b."viTriXMm", b."viTriYMm", b."viTriZMm", b."rongMm", b."sauMm", b."caoMm", b."isActive"
  from twin_toa_nha b join factories f on f.id=b."factoryId" where f.code like 'QATD-%' order by b."factoryId", b.id`;
out.soTangTheoNhaMay = await sql`select f.code, count(*)::int as n from twin_tang s
  join twin_toa_nha b on b.id=s."toaNhaId" join factories f on f.id=b."factoryId"
  where f.code like 'QATD-%' group by f.code order by f.code`;
out.soMayTheoNhaMay = await sql`select f.code, count(*)::int as n from machines m
  join stations st on st.id=m."stationId" join production_lines l on l.id=st."lineId"
  join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId"
  where f.code like 'QATD-%' group by f.code order by f.code`;
out.datChoTheoNhaMay = await sql`select f.code, count(*)::int as n from twin_dat_cho dc
  join twin_tang s on s.id=dc."tangId" join twin_toa_nha b on b.id=s."toaNhaId"
  join factories f on f.id=b."factoryId" where f.code like 'QATD-%' group by f.code order by f.code`;
out.nguoiDung = await sql`select u.id, u.username, u.role from users u where u.username like 'qatd%' order by u.id`;
out.ganNhaMay = await sql`select ufa.* from user_factory_assignments ufa
  join users u on u.id=ufa."userId" where u.username like 'qatd%' order by ufa."userId"`;
out.factoryCoords = await sql`select id, code, name from factories where code like 'QATD-%' order by id`;
out.cotFactories = await sql`select column_name, data_type from information_schema.columns where table_name='factories' order by ordinal_position`;
out.cotVatThe = await sql`select count(*)::int as n from twin_vat_the vt join twin_tang s on s.id=vt."tangId"
  join twin_toa_nha b on b.id=s."toaNhaId" join factories f on f.id=b."factoryId" where f.code like 'QATD-%'`;
await sql.end();
console.log(JSON.stringify(out, (k,v)=>typeof v==="bigint"?Number(v):v, 1));
