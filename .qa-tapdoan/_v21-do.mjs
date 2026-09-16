// V-21 (1) — ĐO CHỈ ĐỌC: predictive_alerts vs machine_health_history.healthScore.
// KHÔNG ghi, KHÔNG DDL. Chạy: node .qa-tapdoan/_v21-do.mjs
import postgres from "postgres"; import fs from "node:fs";
const url = fs.readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url,{max:1});
const J = (o)=>console.log(JSON.stringify(o,null,1));

// 1. Tổng quan bảng
const tong = (await sql`select count(*)::int n, count(distinct "machineId")::int may,
   min("createdAt") as som, max("createdAt") as muon from predictive_alerts`)[0];
const theoTrangThai = await sql`select status::text, count(*)::int n, count(distinct "machineId")::int may from predictive_alerts group by 1 order by 2 desc`;
const theoLoai = await sql`select "alertType"::text lo, count(*)::int n from predictive_alerts group by 1 order by 2 desc limit 15`;
const theoNgay = await sql`select date_trunc('day',"createdAt") ngay, count(*)::int n from predictive_alerts group by 1 order by 1 desc limit 10`;
// nguồn: có aiAnalysis không? tiêu đề mẫu
const mau = await sql`select id, "machineCode", "alertType"::text lo, severity::text sv, title, "createdAt", status::text st from predictive_alerts order by "createdAt" desc limit 6`;

// 2. Máy QATD vs khác
const mayQ = await sql`select
   (select count(*)::int from machines where code like 'QATD-%') qatd,
   (select count(*)::int from machines) tong_may,
   (select count(distinct "machineId")::int from predictive_alerts a join machines m on m.id=a."machineId" where m.code like 'QATD-%') may_qatd_co_cb,
   (select count(*)::int from predictive_alerts a join machines m on m.id=a."machineId" where m.code like 'QATD-%') dong_qatd`;

// 3. Bảng bốn hạng — CHỈ máy QATD (là bộ dữ liệu bộ sinh tạo), điểm sức khoẻ MỚI NHẤT mỗi máy
const bang = await sql`
 with sk as (
   select distinct on (h."machineId") h."machineId" mid, h."healthScore" hs
     from machine_health_history h
     join machines m on m.id = h."machineId"
    where m.code like 'QATD-%'
    order by h."machineId", h."timestamp" desc
 ), hang as (
   select mid, hs, case when hs < 55 then '1 xau nhat (<55)'
                        when hs < 70 then '2 (55-69)'
                        when hs < 85 then '3 (70-84)'
                        else '4 tot nhat (>=85)' end h
     from sk
 )
 select h, count(*)::int so_may,
        count(*) filter (where exists (select 1 from predictive_alerts a where a."machineId"=hang.mid and a.status='ACTIVE'))::int co_cb_mo,
        count(*) filter (where exists (select 1 from predictive_alerts a where a."machineId"=hang.mid))::int co_cb_bat_ky,
        round(avg(hs),1) hs_tb
   from hang group by h order by h`;

// 4. Bảng bốn hạng — TOÀN BỘ máy có điểm sức khoẻ (để so với con số 53,5/49,6/49,7/55,8)
const bangAll = await sql`
 with sk as (
   select distinct on (h."machineId") h."machineId" mid, h."healthScore" hs
     from machine_health_history h order by h."machineId", h."timestamp" desc
 ), hang as (
   select mid, hs, case when hs < 55 then '1 xau nhat (<55)'
                        when hs < 70 then '2 (55-69)'
                        when hs < 85 then '3 (70-84)'
                        else '4 tot nhat (>=85)' end h from sk
 )
 select h, count(*)::int so_may,
        count(*) filter (where exists (select 1 from predictive_alerts a where a."machineId"=hang.mid and a.status='ACTIVE'))::int co_cb_mo,
        count(*) filter (where exists (select 1 from predictive_alerts a where a."machineId"=hang.mid))::int co_cb_bat_ky
   from hang group by h order by h`;

// 5. Tương quan số: healthScore trung bình của máy CÓ cảnh báo mở vs KHÔNG (máy QATD)
const tq = (await sql`
 with sk as (
   select distinct on (h."machineId") h."machineId" mid, h."healthScore" hs
     from machine_health_history h join machines m on m.id=h."machineId"
    where m.code like 'QATD-%' order by h."machineId", h."timestamp" desc)
 select
  round(avg(hs) filter (where co),1) hs_co, count(*) filter (where co)::int n_co,
  round(avg(hs) filter (where not co),1) hs_khong, count(*) filter (where not co)::int n_khong
 from (select hs, exists(select 1 from predictive_alerts a where a."machineId"=sk.mid and a.status='ACTIVE') co from sk) t`)[0];

J({ tong, theoTrangThai, theoLoai, theoNgay, mau, mayQ, bang_QATD: bang, bang_TOAN_BO: bangAll, tuong_quan_QATD: tq });
await sql.end();
