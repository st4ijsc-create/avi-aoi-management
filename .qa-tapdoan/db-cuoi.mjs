/** NGHIỆM-THU CUỐI — probe DB, CHỈ SELECT. node .qa-tapdoan/db-cuoi.mjs */
import postgres from "postgres";
import fs from "node:fs";
const url = fs.readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).replace(/^["']|["']$/g,"").trim();
const sql = postgres(url, { max: 2 });
const R = {};
R.factories = await sql`select id, code, name, "corporateCode" from factories where code like 'QATD-%' order by code`;
R.users = await sql`select id, username, role from users where username like 'qatd\_%' order by username`;
R.demMay = await sql`select f.code, count(m.id)::int n from factories f
  left join workshops w on w."factoryId"=f.id join production_lines l on l."workshopId"=w.id
  left join stations s on s."lineId"=l.id
  left join machines m on m."stationId"=s.id
  where f.code like 'QATD-%' group by f.code order by f.code`;
// toà nhà + tầng theo nhà máy
R.toaNha = await sql`select f.code as fcode, b.id as toa_id, b.ma as toa_ma, b.ten as toa_ten,
   (select count(*)::int from twin_tang t where t."toaNhaId"=b.id) as so_tang
  from twin_toa_nha b join factories f on f.id=b."factoryId" where f.code like 'QATD-%' order by f.code, b.ma`;
// tầng kèm số máy đặt chỗ
R.tang = await sql`select f.code as fcode, b.ma as toa_ma, b.id as toa_id, t.id as tang_id, t."capSo" as cap_so, t.ten as tang_ten,
   (select count(*)::int from twin_dat_cho d where d."tangId"=t.id and d."loaiThucThe"='machine') as so_may
  from twin_tang t join twin_toa_nha b on b.id=t."toaNhaId" join factories f on f.id=b."factoryId"
  where f.code like 'QATD-%' order by f.code, b.ma, t."capSo"`;
// máy mẫu mỗi nhà máy
R.mayMau = await sql`select distinct on (f.code) f.code as fcode, m.id as may_id, m.code as may_code, s.id as tram_id, l.id as chuyen_id
  from machines m join stations s on s.id=m."stationId" join production_lines l on l.id=s."lineId" join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId"
  where f.code like 'QATD-%' order by f.code, m.id`;
// andon hiện có theo nhà máy
R.andon = await sql`select f.code as fcode, count(*)::int n, count(*) filter (where a."resolvedAt" is null)::int n_mo
  from andon_events a join machines m on m.id=a."machineId" join stations s on s.id=m."stationId"
  join production_lines l on l.id=s."lineId" join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId"
  where f.code like 'QATD-%' group by f.code order by f.code`;
R.andonMau = await sql`select distinct on (f.code) f.code as fcode, a.id as andon_id, a.status, a."machineId", m.code as may_code, a."resolvedAt", a.message
  from andon_events a join machines m on m.id=a."machineId" join stations s on s.id=m."stationId"
  join production_lines l on l.id=s."lineId" join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId"
  where f.code like 'QATD-%' order by f.code, a.id desc`;
R.demAndonTong = Number((await sql`select count(*)::int n from andon_events`)[0].n);
R.demGhiChuTong = Number((await sql`select count(*)::int n from andon_notes`)[0].n);
// T3 — hai nguồn rủi ro
R.t3 = await sql`select m.id, m.code,
   (select h."healthScore" from machine_health_history h where h."machineId"=m.id order by h."createdAt" desc limit 1) as suc_khoe,
   (select count(*)::int from predictive_alerts p where p."machineId"=m.id and p."resolvedAt" is null) as canh_bao_pdm
  from machines m join stations s on s.id=m."stationId" join production_lines l on l.id=s."lineId" join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId"
  where f.code like 'QATD-%' order by suc_khoe asc nulls last limit 20`;
R.t3dem = (await sql`select
  (select count(*)::int from machine_health_history h join machines m on m.id=h."machineId" join stations s on s.id=m."stationId" join production_lines l on l.id=s."lineId" join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId" where f.code like 'QATD-%') as hist_qatd,
  (select count(*)::int from predictive_alerts p join machines m on m.id=p."machineId" join stations s on s.id=m."stationId" join production_lines l on l.id=s."lineId" join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId" where f.code like 'QATD-%') as pdm_qatd,
  (select count(*)::int from machine_health_history) as hist_tong,
  (select count(*)::int from predictive_alerts) as pdm_tong`)[0];
// T2/T1 — tầng có >=3 máy đặt chỗ để dựng buffer
R.tangNhieuMay = await sql`select f.code as fcode, b.id as toa_id, b.ma as toa_ma, t.id as tang_id, t."capSo",
   count(d.id)::int so_may, count(*) filter (where d."daKhoa")::int da_khoa
  from twin_dat_cho d join twin_tang t on t.id=d."tangId" join twin_toa_nha b on b.id=t."toaNhaId" join factories f on f.id=b."factoryId"
  where f.code like 'QATD-%' and d."loaiThucThe"='machine' group by 1,2,3,4,5 having count(d.id)>=3 order by so_may desc limit 6`;
console.log(JSON.stringify(R, null, 1));
fs.writeFileSync(".qa-tapdoan/tho/CUOI/db-cuoi.json", JSON.stringify(R, null, 1));
await sql.end();
