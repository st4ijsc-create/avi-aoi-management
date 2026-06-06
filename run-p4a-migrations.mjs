import "dotenv/config";
import postgres from "postgres";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:sa123%40@localhost:5432/avi_aoi_db";

const sql = postgres(DATABASE_URL, { ssl: false, max: 1 });

const migrations = [
  "0089_p4a_ipc_a610_seed.sql",
  "0090_p4a_instrument_calibration_msa.sql",
  "0091_p4a_mp_lighting_profile.sql",
];

try {
  for (const fileName of migrations) {
    const migrationPath = join(__dirname, "drizzle", fileName);
    const migrationSQL = readFileSync(migrationPath, "utf-8");
    console.log(`\n== Running ${fileName} ==`);
    await sql.unsafe(migrationSQL);
    console.log(`   ✓ ${fileName} ok`);
  }
  console.log("\nP4.A migrations completed successfully.");
} catch (e) {
  console.error("Migration error:", e.message);
  console.error(e);
  process.exit(1);
} finally {
  await sql.end();
}
