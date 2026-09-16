// V-21 (1) — ĐO CHỈ ĐỌC vòng 5: điều kiện KÍCH HOẠT của bộ bơm = "có >=1 NG trong cửa sổ".
import postgres from "postgres"; import fs from "node:fs";
const url = fs.readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url,{max:1});
const J=(o)=>console.log(JSON.stringify(o,null,1));
const QATD = sql`select m.id from machines m where m.code like 'QATD-%'`;

// (1) bao nhiêu máy QATD có >=1 NG ? (tập ĐỦ ĐIỀU KIỆN của bộ bơm)
const coNG = (await sql`select count(*)::int tong,
   count(*) filter (where ng>0)::int co_ng, round(100.0*count(*) filter (where ng>0)/count(*),1) ti_le
   from (select i."machineId" mid, count(*) filter (where i."overallResult"='NG')::int ng
         from product_inspections i where i."machineId" in (${QATD}) group by 1) t`)[0];
// (2) bảng 4 hạng theo điểm bộ sinh × "có >=1 NG"  ⇒ thước KHÔNG phụ thuộc bộ bơm đã chạy hay chưa
const bang = await sql`with g as (select "machineId" mid, "healthScore" hs from machine_health_history
     where "machineId" in (${QATD}) and "calculationMethod"='WEIGHTED'),
   n as (select i."machineId" mid, count(*) filter (where i."overallResult"='NG')::int ng, count(*)::int tong
         from product_inspections i where i."machineId" in (${QATD}) group by 1)
 select case when hs<55 then '1 xau(<55)' when hs<70 then '2 (55-69)' when hs<85 then '3 (70-84)' else '4 tot(>=85)' end hang,
   count(*)::int so_may, count(*) filter (where n.ng>0)::int co_ng,
   round(100.0*count(*) filter (where n.ng>0)/count(*),1) ti_le_co_ng,
   round(avg(n.ng::float8/n.tong)::numeric,4) ti_le_ng_tb
 from g join n on n.mid=g.mid group by 1 order by 1`;
// (3) 51 máy có cảnh báo: tất cả đều có >=1 NG?
const kiem = (await sql`select count(*)::int n_canh_bao,
   count(*) filter (where ng>0)::int co_ng from (
   select p."machineId" mid, (select count(*) filter (where i."overallResult"='NG') from product_inspections i where i."machineId"=p."machineId")::int ng
   from (select distinct "machineId" from predictive_alerts where "machineId" in (${QATD})) p) t`)[0];
// (4) andon QATD (bối cảnh con số 55)
const andon = (await sql`select count(*)::int n from andon_events a where a."machineId" in (${QATD})`)[0];
J({ may_co_it_nhat_1_NG: coNG, bang4hang_theo_co_NG: bang, kiem_51_may: kiem, andon_QATD: andon });
await sql.end();
