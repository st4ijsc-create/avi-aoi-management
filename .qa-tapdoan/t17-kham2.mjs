import postgres from "postgres";
import { readFileSync } from "node:fs";
const url = readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url, { max: 2 });
const out = {};
out.corpAssign = await sql`select * from user_corporate_assignments where "userId" in (26916,26917,26918,26919,26920,26921,26922)`;
out.qatdFactoriesFull = await sql`select id, code, name, region, country, "mapPositionX", "mapPositionY", "corporateCode", "floorWidthM", "floorDepthM" from factories where code like 'QATD-%' order by id`;
out.moiNhaMay = await sql`select id, code, name, "mapPositionX", "mapPositionY", "corporateCode", "isActive" from factories order by id`;
out.toaMoiNhaMay = await sql`select b."factoryId", f.code, count(*)::int as soToa,
   min(b."viTriXMm")::text as minX, max(b."viTriXMm")::text as maxX, min(b."viTriYMm")::text as minY, max(b."viTriYMm")::text as maxY
   from twin_toa_nha b join factories f on f.id=b."factoryId" where b."isActive" group by b."factoryId", f.code order by b."factoryId"`;
out.datChoBienDo = await sql`select f.code, min(dc."viTriXMm")::text as minX, max(dc."viTriXMm")::text as maxX, min(dc."viTriYMm")::text as minY, max(dc."viTriYMm")::text as maxY
   from twin_dat_cho dc join twin_tang s on s.id=dc."tangId" join twin_toa_nha b on b.id=s."toaNhaId" join factories f on f.id=b."factoryId"
   where f.code like 'QATD-%' group by f.code order by f.code`;
out.soTangSong = await sql`select f.code, count(*)::int as n from twin_tang s join twin_toa_nha b on b.id=s."toaNhaId" join factories f on f.id=b."factoryId"
   where f.code like 'QATD-%' and s."isActive" and b."isActive" group by f.code order by f.code`;
await sql.end();
console.log(JSON.stringify(out, (k,v)=>typeof v==="bigint"?Number(v):v, 1));
