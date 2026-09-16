// V-21 (1) — ĐO CHỈ ĐỌC vòng 3: hàng sức khoẻ MỚI NHẤT là của AI hay của bộ sinh? KHÔNG ghi.
import postgres from "postgres"; import fs from "node:fs";
const url = fs.readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url,{max:1});
const J=(o)=>console.log(JSON.stringify(o,null,1));
const QATD = sql`select m.id from machines m where m.code like 'QATD-%'`;

// (1) hàng mới nhất theo createdAt — phương pháp nào?
const theoCreated = await sql`with l as (select distinct on (h."machineId") h."machineId" mid,
    coalesce(h."calculationMethod",'(null)') pp, h."healthScore" hs
  from machine_health_history h where h."machineId" in (${QATD}) order by h."machineId", h."createdAt" desc)
 select pp, count(*)::int so_may, min(hs) hs_min, round(avg(hs),1) hs_tb, max(hs) hs_max from l group by pp order by 2 desc`;
// (2) hàng mới nhất theo timestamp — phương pháp nào?
const theoTs = await sql`with l as (select distinct on (h."machineId") h."machineId" mid,
    coalesce(h."calculationMethod",'(null)') pp, h."healthScore" hs
  from machine_health_history h where h."machineId" in (${QATD}) order by h."machineId", h."timestamp" desc)
 select pp, count(*)::int so_may, min(hs) hs_min, round(avg(hs),1) hs_tb, max(hs) hs_max from l group by pp order by 2 desc`;
// (3) điểm của bộ sinh (WEIGHTED, notes='QATD sinh') vs điểm AI: có liên hệ gì không?
const soSanh = (await sql`with g as (select "machineId" mid, "healthScore" hs from machine_health_history
     where "machineId" in (${QATD}) and "calculationMethod"='WEIGHTED'),
   a as (select distinct on ("machineId") "machineId" mid, "healthScore" hs from machine_health_history
     where "machineId" in (${QATD}) and "calculationMethod"='PREDICTIVE_WS4' order by "machineId","createdAt" desc)
 select count(*)::int n, round(corr(g.hs, a.hs)::numeric,4) tuong_quan,
        round(avg(g.hs),1) gen_tb, round(avg(a.hs),1) ai_tb, min(a.hs) ai_min, max(a.hs) ai_max,
        count(distinct a.hs)::int ai_so_gia_tri_khac_nhau
   from g join a on a.mid=g.mid`)[0];
// (4) bảng 4 hạng theo ĐIỂM CỦA BỘ SINH (WEIGHTED) × có cảnh báo mở  — đây là thước ĐÚNG cho bộ sinh
const bangGen = await sql`with g as (select "machineId" mid, "healthScore" hs from machine_health_history
     where "machineId" in (${QATD}) and "calculationMethod"='WEIGHTED')
 select case when hs<55 then '1 xau(<55)' when hs<70 then '2 (55-69)' when hs<85 then '3 (70-84)' else '4 tot(>=85)' end hang,
   count(*)::int so_may,
   count(*) filter (where exists(select 1 from predictive_alerts p where p."machineId"=g.mid and p."resolvedAt" is null))::int co_cb,
   round(100.0*count(*) filter (where exists(select 1 from predictive_alerts p where p."machineId"=g.mid and p."resolvedAt" is null))/count(*),1) ti_le
 from g group by 1 order by 1`;
// (5) 51 máy có cảnh báo: chúng khác gì? cùng line? cùng trạm?
const nhom = await sql`select split_part(p."machineCode",'-',2)||'-'||split_part(p."machineCode",'-',3)||'-'||split_part(p."machineCode",'-',4)||'-'||split_part(p."machineCode",'-',5) chuyen,
   count(*)::int n from predictive_alerts p where p."machineId" in (${QATD}) group by 1 order by 2 desc limit 12`;
// (6) tổng số máy QATD trên chuyền đầu tiên đó
const tongChuyen = await sql`select count(*)::int n from machines where code like 'QATD-A-T1-X1-L1-%'`;
J({ hangMoiNhat_theo_createdAt: theoCreated, hangMoiNhat_theo_timestamp: theoTs,
    genVsAi: soSanh, bang4hang_theo_diem_BO_SINH: bangGen, nhom51_theo_chuyen: nhom, mayTrenChuyenA_T1_X1_L1: tongChuyen[0] });
await sql.end();
