import postgres from "postgres";
import fs from "fs";

const sql = postgres(process.env.DATABASE_URL);
const migration = fs.readFileSync("drizzle/0059_package_activity_logs.sql", "utf8");

async function run() {
  await sql.unsafe(migration);
  const [check] = await sql`SELECT count(*) as cnt FROM information_schema.tables WHERE table_name = 'package_activity_logs'`;
  console.log("Table exists:", Number(check.cnt) > 0 ? "YES" : "NO");
  const indexes = await sql`SELECT indexname FROM pg_indexes WHERE tablename = 'package_activity_logs'`;
  console.log("Indexes:", indexes.map((r) => r.indexname).join(", "));
  await sql.end();
  console.log("Migration 0059 applied successfully!");
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
