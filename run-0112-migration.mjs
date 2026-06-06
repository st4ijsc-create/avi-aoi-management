import postgres from "postgres";
import { readFileSync } from "node:fs";
import "dotenv/config";

// Giai đoạn 2 — G2 migration runner (MES/WIP/Traceability/PdM). KHÔNG tự chạy trong build/CI.
// Chạy thủ công: node run-0112-migration.mjs

const sql = postgres(process.env.DATABASE_URL);
const ddl = readFileSync("drizzle/0112_g2_mes_wip_traceability_pdm.sql", "utf8");

try {
  await sql.unsafe(ddl);
  console.log("0112 G2 migration applied OK");

  const tbl = await sql.unsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public'
      AND table_name IN (
        'wip_tracking','station_dwell_time','line_balance_metrics',
        'material_receipts','supplier_lots','lot_disposition',
        'maintenance_schedules','maintenance_work_orders','spare_parts_inventory','pm_effectiveness_metrics'
      )
    ORDER BY table_name
  `);
  console.log("G2 tables:", tbl.map((t) => t.table_name).join(", "));
} catch (e) {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
