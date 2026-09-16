// V-21 (1) — ĐO CHỈ ĐỌC vòng 2: dòng thời gian + nguồn bơm. KHÔNG ghi.
import postgres from "postgres"; import fs from "node:fs";
const url = fs.readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url,{max:1});
const J=(o)=>console.log(JSON.stringify(o,null,1));
const QATD = sql`select m.id from machines m where m.code like 'QATD-%'`;

const moc = await sql`select min("createdAt") som, max("createdAt") muon, count(*)::int n,
  count(distinct "machineId")::int may from predictive_alerts where "machineId" in (${QATD})`;
const tungDong = await sql`select p.id, p."machineCode", p."alertType"::text lo, p.severity::text sv, p.status::text st,
  p."createdAt", p."resolvedAt", (p."aiAnalysis" is not null) co_ai, p."occurrenceCount"
  from predictive_alerts p where p."machineId" in (${QATD}) order by p."createdAt" limit 60`;
// sức khoẻ: loại hàng
const loaiHang = await sql`select coalesce("calculationMethod",'(null)') pp, count(*)::int n,
   count(distinct "machineId")::int may, min("timestamp") som, max("timestamp") muon
   from machine_health_history where "machineId" in (${QATD}) group by 1 order by 2 desc`;
// mốc sinh lại: máy QATD tạo lúc nào
const mayMoc = (await sql`select min("createdAt") som, max("createdAt") muon, count(*)::int n from machines where code like 'QATD-%'`)[0];
// T3 verbatim, chạy LẠI hôm nay
const t3 = await sql`with l as (
   select distinct on (h."machineId") h."machineId" mid, h."healthScore" hs
   from machine_health_history h where h."machineId" in (${QATD}) order by h."machineId", h."createdAt" desc)
 select case when l.hs < 60 then 'nguy_kich(<60)' when l.hs < 80 then 'canh(<80)' when l.hs < 90 then 'theo_doi(<90)' else 'khoe(>=90)' end hang,
   count(*)::int so_may,
   count(*) filter (where (select count(*) from predictive_alerts p where p."machineId"=l.mid and p."resolvedAt" is null) > 0)::int co_pdm_mo,
   round(100.0*count(*) filter (where (select count(*) from predictive_alerts p where p."machineId"=l.mid and p."resolvedAt" is null) > 0)/count(*),1) ti_le_pdm
 from l group by 1 order by 1`;
J({ moc: moc[0], mayMoc, loaiHang, t3_chay_lai_hom_nay: t3, tungDong });
await sql.end();
