import postgres from "postgres";
import { readFileSync } from "node:fs";
import "dotenv/config";

const sql = postgres(process.env.DATABASE_URL);
const ddl = readFileSync("drizzle/0101_hotfix_mp_msa_align.sql", "utf8");

try {
  await sql.unsafe(ddl);
  console.log("0101 hotfix applied OK");

  // Verify
  const cols = await sql.unsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='measurement_point_defs' AND column_name IN ('preferredSamplingPlanId','productViewId')
  `);
  console.log("MPD new cols:", cols.map(c=>c.column_name).join(', '));

  const mi = await sql.unsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='measurement_instruments' AND column_name='mmPerPixel'
  `);
  console.log("MI mmPerPixel:", mi.length ? "OK" : "MISSING");

  const tbl = await sql.unsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('msa_studies','msa_observations','msa_csv_mapping_presets')
    ORDER BY table_name
  `);
  console.log("MSA tables:", tbl.map(t=>t.table_name).join(', '));
} catch (e) {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
