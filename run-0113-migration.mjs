import postgres from "postgres";
import { readFileSync } from "node:fs";
import "dotenv/config";

// Giai đoạn 3 — G3 migration runner (Energy/ML/HA-DR). KHÔNG tự chạy trong build/CI.
// Chạy thủ công: node run-0113-migration.mjs

const sql = postgres(process.env.DATABASE_URL);
const ddl = readFileSync("drizzle/0113_g3_energy_ml_dr.sql", "utf8");

try {
  await sql.unsafe(ddl);
  console.log("0113 G3 migration applied OK");

  const tbl = await sql.unsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public'
      AND table_name IN ('energy_readings','enpi_metrics','ml_feature_cache','ml_inference_audit','dr_restore_checks')
    ORDER BY table_name
  `);
  console.log("G3 tables:", tbl.map((t) => t.table_name).join(", "));
} catch (e) {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
