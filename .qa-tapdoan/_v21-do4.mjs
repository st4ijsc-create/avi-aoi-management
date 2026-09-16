// V-21 (1) — ĐO CHỈ ĐỌC vòng 4: NGUỒN thật của 51 cảnh báo + tương quan NG-rate vs health. KHÔNG ghi.
import postgres from "postgres"; import fs from "node:fs";
const url = fs.readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url,{max:1});
const J=(o)=>console.log(JSON.stringify(o,null,1));
const QATD = sql`select m.id from machines m where m.code like 'QATD-%'`;

const loai = await sql`select "alertType"::text lo, severity::text sv, count(*)::int n
  from predictive_alerts where "machineId" in (${QATD}) group by 1,2 order by 3 desc`;
const mot = (await sql`select id,"machineCode",title,description,"aiAnalysis","currentValue","predictedValue",threshold,"confidenceScore","predictedTimeframe"
  from predictive_alerts where "machineId" in (${QATD}) order by id limit 1`)[0];

// NG rate mỗi máy QATD từ product_inspections + healthScore bộ sinh
const tq = (await sql`with ng as (
   select i."machineId" mid, count(*)::int tong, count(*) filter (where i."overallResult"='NG')::int ng
     from product_inspections i where i."machineId" in (${QATD}) group by 1),
  g as (select "machineId" mid, "healthScore" hs from machine_health_history
        where "machineId" in (${QATD}) and "calculationMethod"='WEIGHTED')
 select count(*)::int n, round(corr(g.hs, ng.ng::float8/nullif(ng.tong,0))::numeric,4) corr_health_vs_ngrate,
   round(avg(ng.tong),2) ins_moi_may, sum(ng.ng)::int tong_ng, sum(ng.tong)::int tong_ins
 from g join ng on ng.mid=g.mid`)[0];

// NG rate của 51 máy CÓ cảnh báo vs 1057 máy không
const soSanh = (await sql`with ng as (
   select i."machineId" mid, count(*)::int tong, count(*) filter (where i."overallResult"='NG')::int ng
     from product_inspections i where i."machineId" in (${QATD}) group by 1)
 select round(avg(ng::float8/tong)::numeric,4) ti_le_ng, count(*)::int n, co from (
   select ng.ng, ng.tong, exists(select 1 from predictive_alerts p where p."machineId"=ng.mid) co from ng) t
 group by co order by co`);

// inspectionTime vs createdAt — generatePredictions gom theo createdAt::date
const ngay = (await sql`select count(distinct (i."createdAt")::date)::int ngay_createdAt,
   count(distinct (i."inspectionTime")::date)::int ngay_inspectionTime,
   min(i."createdAt") ca_som, max(i."createdAt") ca_muon
   from product_inspections i where i."machineId" in (${QATD})`)[0];

J({ loai_51: loai, mau_mot_dong: mot, tuong_quan: tq, ngRate_theo_co_canh_bao: soSanh, ngay_kiem_tra: ngay });
await sql.end();
