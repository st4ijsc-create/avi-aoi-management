// PH-39 — ĐO HÌNH DẠNG DỮ LIỆU THẬT (CHỈ ĐỌC). Không ghi, không DDL.
import postgres from "postgres"; import fs from "node:fs";
const url = fs.readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const sql = postgres(url,{max:1});

// Cửa sổ mặc định của computeFailureRisk = 24*14 giờ.
const tuNgay = sql`now() - interval '14 days'`;

const soMay = (await sql`select count(*)::int n from machines where "isActive"=true`)[0].n;

// Điểm sức khoẻ ĐO ĐƯỢC (không phải PREDICTIVE_WS4) trong cửa sổ, theo máy.
const phanBo = await sql`
  select so_diem, count(*)::int so_may from (
    select m.id, count(h.id)::int so_diem
    from machines m
    left join machine_health_history h
      on h."machineId" = m.id
     and h."timestamp" >= ${tuNgay}
     and (h."calculationMethod" is null or h."calculationMethod" <> 'PREDICTIVE_WS4')
    where m."isActive" = true
    group by m.id
  ) t group by so_diem order by so_diem`;

const camBien = (await sql`
  select count(distinct "machineId")::int n from machine_sensor_readings where "timestamp" >= ${tuNgay}`)[0].n;
const nhipTim = (await sql`
  select count(distinct "machineId")::int n from machine_heartbeats where "timestamp" >= ${tuNgay}`)[0].n;
const suCo = (await sql`
  select count(distinct "machineId")::int n from downtime_events where "startTime" >= ${tuNgay}`)[0].n;

// Máy sẽ rơi vào nhánh "insufficient_data": < 5 điểm sức khoẻ, < 8 điểm cảm biến/nhịp tim,
// và không có sự cố (⇒ mtbfHours null ⇒ đặc trưng độ tin cậy cũng không chạy).
console.log(JSON.stringify({
  soMayActive: soMay,
  phanBoDiemSucKhoe: phanBo.map(r => ({ soDiem: Number(r.so_diem), soMay: r.so_may })),
  mayCoCamBien14ngay: camBien,
  mayCoNhipTim14ngay: nhipTim,
  mayCoSuCo14ngay: suCo,
}, null, 1));
await sql.end();
