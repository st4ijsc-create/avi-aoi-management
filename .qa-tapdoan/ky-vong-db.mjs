// Kỳ vọng ĐỘC LẬP từ DB (mô hình rời: liệt kê phân bố rồi đối chiếu tổng — BG-127), không nhìn API.
import postgres from "postgres"; import fs from "node:fs";
const url = fs.readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL="))?.slice(13).replace(/^["']|["']$/g,"");
const sql = postgres(url,{max:1});
const out = {};
out.mayTheoNhaMay = await sql`
  select f.id, f.code, f."corporateCode", count(m.id)::int tong,
         count(m.id) filter (where m."isActive")::int active
  from factories f
  left join workshops w on w."factoryId"=f.id
  left join production_lines l on l."workshopId"=w.id
  left join stations s on s."lineId"=l.id
  left join machines m on m."stationId"=s.id
  group by 1,2,3 order by 1`;
out.tongMay = (await sql`select count(*)::int n, count(*) filter (where "isActive")::int a from machines`)[0];
out.mayTheoTang = await sql`
  select t.id tang_id, t."capSo", tn.ma toa, f.code nm, count(m.id)::int may
  from twin_tang t join twin_toa_nha tn on tn.id=t."toaNhaId" join factories f on f.id=tn."factoryId"
  left join workshops w on w."tangId"=t.id
  left join production_lines l on l."workshopId"=w.id
  left join stations s on s."lineId"=l.id
  left join machines m on m."stationId"=s.id
  where f.code like 'QATD-%'
  group by 1,2,3,4 order by 4,3,2`;
out.datChoTheoTang = await sql`
  select d."tangId", count(*)::int n from twin_dat_cho d
  where d."loaiThucThe"='machine' and d."tangId" in (select t.id from twin_tang t join twin_toa_nha tn on tn.id=t."toaNhaId" join factories f on f.id=tn."factoryId" where f.code like 'QATD-%')
  group by 1 order by 1`;
out.lineDau = await sql`
  select l.id, l.code, l.name, w."factoryId", f.code nm, w."tangId",
    (select count(*)::int from stations s2 where s2."lineId"=l.id) tram,
    (select count(*)::int from machines m2 join stations s3 on s3.id=m2."stationId" where s3."lineId"=l.id) may
  from production_lines l join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId"
  where l.id in (217,249,284)`;
out.mayMau = await sql`
  select m.id, m.code, m.name, m."machineType", m."operationStatus", m."lastHeartbeat" is null as hb_null,
         s."lineId", w."tangId", f.code nm
  from machines m join stations s on s.id=m."stationId" join production_lines l on l.id=s."lineId"
  join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId"
  where m.id in (4197,4568,4977)`;
out.tuoiHeartbeat = (await sql`
  select count(*) filter (where m."lastHeartbeat" >= now() - interval '5 minutes')::int tuoi,
         count(*) filter (where m."lastHeartbeat" < now() - interval '5 minutes')::int cu,
         count(*) filter (where m."lastHeartbeat" is null)::int khong_hb
  from machines m join stations s on s.id=m."stationId" join production_lines l on l.id=s."lineId"
  join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId" where f.code like 'QATD-%'`)[0];
out.ganNguoiDung = await sql`
  select u.username, u.role,
    coalesce((select string_agg(a."factoryCode", ',' order by a."factoryCode") from user_factory_assignments a where a."userId"=u.id), '-') nha_may,
    coalesce((select string_agg(c."corporateCode", ',') from user_corporate_assignments c where c."userId"=u.id), '-') tap_doan
  from users u where u.username like 'qatd\_%' order by u.username`;
console.log(JSON.stringify(out, null, 1));
await sql.end();
