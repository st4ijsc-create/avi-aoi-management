/** T3 — hai nguồn rủi ro. CHỈ SELECT. */
import postgres from "postgres"; import fs from "node:fs";
const url = fs.readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url,{max:2}); const R={};
const QATD = sql`select m.id from machines m join stations s on s.id=m."stationId" join production_lines l on l.id=s."lineId" join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId" where f.code like 'QATD-%'`;
R.hist_method = await sql`select h."calculationMethod", count(*)::int n, min(h.timestamp) as tu, max(h.timestamp) as den
  from machine_health_history h where h."machineId" in (${QATD}) group by 1 order by n desc`;
R.hist_14d = await sql`select count(*)::int n, count(distinct h."machineId")::int so_may
  from machine_health_history h where h."machineId" in (${QATD})
  and h.timestamp >= now() - interval '14 days' and h."calculationMethod" <> 'PREDICTIVE_WS4'`;
R.risk_cot = await sql`select count(*)::int n, count(*) filter (where h."predictedFailureRisk" is null)::int risk_null,
  count(*) filter (where h."predictedFailureRisk"=0)::int risk_0, max(h."predictedFailureRisk") as risk_max
  from machine_health_history h where h."machineId" in (${QATD})`;
R.pdm_status = await sql`select p.status, count(*)::int n, count(*) filter (where p."resolvedAt" is null)::int mo
  from predictive_alerts p where p."machineId" in (${QATD}) group by 1 order by n desc`;
// bảng chéo: hạng sức khoẻ (theo latest healthScore) × có/không cảnh báo PdM mở
R.cheo = await sql`with l as (
   select distinct on (h."machineId") h."machineId" as mid, h."healthScore" as hs, h.timestamp as ts, h."calculationMethod" as pp, h."predictedFailureRisk" as pfr
   from machine_health_history h where h."machineId" in (${QATD}) order by h."machineId", h."createdAt" desc)
 select case when l.hs < 50 then 'nguy_kich(<50)' when l.hs < 70 then 'canh(<70)' when l.hs < 85 then 'theo_doi(<85)' else 'khoe(>=85)' end as hang,
   count(*)::int so_may,
   count(*) filter (where (select count(*) from predictive_alerts p where p."machineId"=l.mid and p."resolvedAt" is null) > 0)::int co_pdm_mo,
   count(*) filter (where (select count(*) from predictive_alerts p where p."machineId"=l.mid and p."resolvedAt" is null) = 0)::int khong_pdm
 from l group by 1 order by 1`;
// mẫu cụ thể: máy nguy kịch nhất + dữ liệu vào computeFailureRisk của nó
R.mau = await sql`with l as (
   select distinct on (h."machineId") h."machineId" as mid, h."healthScore" as hs, h.timestamp as ts, h."createdAt" as ca, h."calculationMethod" as pp, h."predictedFailureRisk" as pfr
   from machine_health_history h where h."machineId" in (${QATD}) order by h."machineId", h."createdAt" desc)
 select m.id, m.code, l.hs, l.ts, l.ca, l.pp, l.pfr,
   (select count(*)::int from machine_health_history h2 where h2."machineId"=m.id and h2.timestamp >= now() - interval '14 days' and h2."calculationMethod" <> 'PREDICTIVE_WS4') as diem_14d,
   (select count(*)::int from predictive_alerts p where p."machineId"=m.id and p."resolvedAt" is null) as pdm_mo
 from l join machines m on m.id=l.mid where l.hs < 50 order by l.hs asc, m.id limit 10`;
R.bay_gio = (await sql`select now() as now`)[0].now;
console.log(JSON.stringify(R,null,1));
fs.writeFileSync(".qa-tapdoan/tho/CUOI/db-t3.json", JSON.stringify(R,null,1));
await sql.end();
