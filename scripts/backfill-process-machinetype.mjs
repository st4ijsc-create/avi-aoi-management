// doc 56 Đ7 (operator) — Backfill process_results.machineType từ bảng machines.
//
// machineType trên process_results là snapshot phi-chuẩn-hoá (nullable) — nếu firmware
// không gửi nó trong envelope, cột để NULL và fleet rollup (Đ5) gom máy đó vào nhóm "—".
// Script này set machineType = machines.machineType cho các dòng NULL có máy hợp lệ.
// Idempotent (chỉ đụng dòng NULL) + an toàn (chỉ đọc từ bảng machines authoritative).
//
//   DATABASE_URL="postgresql://aoi:aoi@127.0.0.1:5434/aoi_management" node scripts/backfill-process-machinetype.mjs
import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const before = await sql`SELECT count(*)::int AS n FROM process_results WHERE "machineType" IS NULL`;
  const res = await sql`
    UPDATE process_results pr
    SET "machineType" = m."machineType"
    FROM machines m
    WHERE m.id = pr."machineId"
      AND pr."machineType" IS NULL
      AND m."machineType" IS NOT NULL`;
  const after = await sql`SELECT count(*)::int AS n FROM process_results WHERE "machineType" IS NULL`;
  const remaining = after[0].n;
  console.log(`Backfill machineType: NULL trước=${before[0].n} · đã set=${res.count} · NULL còn lại=${remaining}` +
    (remaining ? ` (máy chưa gán machineType — hãy set machineType cho máy trước)` : ` ✓`));
} finally {
  await sql.end();
}
