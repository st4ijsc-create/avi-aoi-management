#!/usr/bin/env node
/**
 * doc 64 IA-10 S2-D (Q1 user 2026-07-19) — OPERATOR TOOL: backfill parent cho MÁY THẬT.
 *
 * Trục ISA-95 (AssetScopeBar) + commandCenter.hierarchy CHỈ đúng khi mọi máy có chuỗi
 * cha đầy đủ: machines.stationId → stations.lineId → production_lines.workshopId →
 * workshops.factoryId. Máy thật onboard thiếu parent sẽ THÀNH NODE MỒ CÔI (không xuất
 * hiện trong trục / cây / roll-up) — pattern tool giống `884ca480` (backfill machineType).
 *
 * Cách dùng (chạy bằng OWNER role — DDL/UPDATE):
 *   DATABASE_URL=postgresql://aoi:aoi@127.0.0.1:5434/aoi_management \
 *     node scripts/ops/backfill-machine-parents.mjs               # BÁO CÁO (read-only)
 *     node scripts/ops/backfill-machine-parents.mjs --csv map.csv # xem trước gán từ CSV
 *     node scripts/ops/backfill-machine-parents.mjs --csv map.csv --apply  # GHI THẬT
 *
 * CSV format (header bắt buộc): machineCode,stationCode
 *   MY-VIT-07,ST-L1-SCREW
 *
 * AN TOÀN: mặc định read-only; --apply chỉ SET machines.stationId theo CSV (không tạo
 * station/line mới — cây do người vận hành curate qua UI /layout · /workstation-management).
 */
import fs from "node:fs";
import "dotenv/config";
import postgres from "postgres";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const csvIdx = args.indexOf("--csv");
const CSV = csvIdx >= 0 ? args[csvIdx + 1] : null;

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

function parseCsv(path) {
  const rows = fs.readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim());
  const header = rows.shift()?.trim();
  if (header !== "machineCode,stationCode") {
    throw new Error(`CSV header phải là "machineCode,stationCode" (nhận: "${header}")`);
  }
  return rows.map((l) => {
    const [machineCode, stationCode] = l.split(",").map((s) => s.trim());
    return { machineCode, stationCode };
  });
}

try {
  // ── BÁO CÁO: máy mồ côi (thiếu stationId hoặc chuỗi cha đứt) ──
  const orphans = await sql`
    SELECT m.id, m.code, m.name, m."machineType", m."stationId",
           s."lineId", pl."workshopId", w."factoryId"
    FROM machines m
    LEFT JOIN stations s ON m."stationId" = s.id
    LEFT JOIN production_lines pl ON s."lineId" = pl.id
    LEFT JOIN workshops w ON pl."workshopId" = w.id
    WHERE m."isActive" = true
      AND (m."stationId" IS NULL OR s.id IS NULL OR pl.id IS NULL OR w.id IS NULL OR w."factoryId" IS NULL)
    ORDER BY m.code`;
  console.log(`\n═══ MÁY MỒ CÔI (thiếu chuỗi cha ISA-95): ${orphans.length} ═══`);
  for (const o of orphans) {
    const missing =
      o.stationId == null ? "stationId NULL"
      : o.lineId == null ? `station ${o.stationId} thiếu lineId`
      : o.workshopId == null ? `line ${o.lineId} thiếu workshopId`
      : `workshop ${o.workshopId} thiếu factoryId`;
    console.log(`  ${o.code}  (${o.machineType ?? "?"})  → ${missing}`);
  }
  if (orphans.length === 0) console.log("  (không có — cây tài sản đầy đủ ✓)");

  // ── ÁP CSV (tuỳ chọn) ──
  if (CSV) {
    const mapRows = parseCsv(CSV);
    console.log(`\n═══ CSV: ${mapRows.length} dòng ═══`);
    let ok = 0, miss = 0;
    for (const r of mapRows) {
      const [m] = await sql`SELECT id, code, "stationId" FROM machines WHERE code = ${r.machineCode} LIMIT 1`;
      const [st] = await sql`SELECT id, code FROM stations WHERE code = ${r.stationCode} LIMIT 1`;
      if (!m || !st) {
        console.log(`  ✗ ${r.machineCode} → ${r.stationCode}  (${!m ? "máy không tồn tại" : "station không tồn tại"})`);
        miss++;
        continue;
      }
      if (APPLY) {
        await sql`UPDATE machines SET "stationId" = ${st.id}, "updatedAt" = now() WHERE id = ${m.id}`;
        console.log(`  ✓ ${m.code}: stationId ${m.stationId ?? "NULL"} → ${st.id} (${st.code}) [ĐÃ GHI]`);
      } else {
        console.log(`  → ${m.code}: stationId ${m.stationId ?? "NULL"} → ${st.id} (${st.code}) [preview — thêm --apply để ghi]`);
      }
      ok++;
    }
    console.log(`\nKết quả: ${ok} khớp · ${miss} lỗi · APPLY=${APPLY}`);
  } else {
    console.log(`\nGán parent: tạo CSV "machineCode,stationCode" rồi chạy lại với --csv <file> [--apply].`);
  }
} finally {
  await sql.end();
}
