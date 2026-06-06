import postgres from "postgres";
import { readFileSync } from "node:fs";
import "dotenv/config";

const sql = postgres(process.env.DATABASE_URL);
const ddl = readFileSync("drizzle/0111_qw3_materialized_views.sql", "utf8");

try {
  await sql.unsafe(ddl);
  console.log("0111 materialized views applied OK");

  const views = await sql.unsafe(`
    SELECT matviewname FROM pg_matviews
    WHERE matviewname IN ('machine_status_latest','hourly_yield_cache')
    ORDER BY matviewname
  `);
  console.log("Matviews:", views.map((v) => v.matviewname).join(", ") || "MISSING");

  const fn = await sql.unsafe(`
    SELECT proname FROM pg_proc WHERE proname = 'refresh_qw_caches'
  `);
  console.log("refresh_qw_caches:", fn.length ? "OK" : "MISSING");

  // Initial populate
  await sql.unsafe(`SELECT refresh_qw_caches()`);
  console.log("Initial refresh done");
} catch (e) {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
