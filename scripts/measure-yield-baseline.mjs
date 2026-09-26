// scripts/measure-yield-baseline.mjs
// CHỈ ĐỌC. Không có INSERT/UPDATE/DELETE/DDL.
// Chạy: node scripts/measure-yield-baseline.mjs docs/superpowers/plans/baseline-before.json
import 'dotenv/config';
import postgres from 'postgres';
import { writeFileSync } from 'node:fs';

const sql = postgres(process.env.DATABASE_URL, { ssl: 'prefer', max: 1 });
const metrics = {};

// Đếm thô — mẫu số chung cho mọi công thức bên dưới
const [tho] = await sql`
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE "overallResult" = 'OK')::int  AS ok,
         count(*) FILTER (WHERE "overallResult" = 'NG')::int  AS ng,
         count(*) FILTER (WHERE "overallResult" = 'NTF')::int AS ntf
  FROM product_inspections`;

// Công thức CHUẨN — (OK+NTF)/total
metrics.chuan_finalYield = {
  ...tho,
  yieldRate: tho.total ? +(((tho.ok + tho.ntf) / tho.total) * 100).toFixed(4) : 0,
};

// Công thức SAI đang tồn tại ở ~15 nơi — OK/total
metrics.sai_okTrenTotal = {
  ...tho,
  yieldRate: tho.total ? +((tho.ok / tho.total) * 100).toFixed(4) : 0,
};

// Chênh lệch tuyệt đối — đây là con số Pha 0 phải làm biến mất
metrics.chenhLech = {
  diemPhanTram: +(metrics.chuan_finalYield.yieldRate - metrics.sai_okTrenTotal.yieldRate).toFixed(4),
  soBoBiTinhNhamThanhHONG: tho.ntf,
};

// Theo máy — để thấy máy nào lệch nhiều nhất
metrics.theoMay = await sql`
  SELECT "machineId",
         count(*)::int AS total,
         count(*) FILTER (WHERE "overallResult" = 'NTF')::int AS ntf,
         round((count(*) FILTER (WHERE "overallResult" IN ('OK','NTF')) * 100.0)
               / NULLIF(count(*), 0), 4) AS yield_chuan,
         round((count(*) FILTER (WHERE "overallResult" = 'OK') * 100.0)
               / NULLIF(count(*), 0), 4) AS yield_sai
  FROM product_inspections GROUP BY 1 ORDER BY 1`;

// MV: so số của materialized view với truy vấn sống trên cùng cửa sổ
metrics.mvHourlyYieldCache = await sql`
  SELECT count(*)::int AS so_dong,
         round(avg("yieldRate")::numeric, 4) AS yield_tb
  FROM hourly_yield_cache`.catch((e) => ({ ERROR: e.message }));

const ketQua = JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: (process.env.DATABASE_URL || '').replace(/:[^:@]*@/, ':***@'),
  metrics,
}, null, 2);

// Script TỰ ghi file, KHÔNG dựa vào `>` của shell.
// Lý do: PowerShell ghi `>` kèm BOM UTF-8, và BOM làm JSON.parse ném lỗi.
// require() thì nuốt được BOM nên lỗi ẩn mình. writeFileSync cho ra byte
// giống nhau trên mọi shell.
const duongDanRa = process.argv[2];
if (duongDanRa) {
  writeFileSync(duongDanRa, ketQua, { encoding: 'utf8' });
  console.error(`đã ghi ${duongDanRa}`);
} else {
  console.log(ketQua);
}

await sql.end();
