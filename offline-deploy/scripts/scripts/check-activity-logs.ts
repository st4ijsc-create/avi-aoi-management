import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);

async function run() {
  const logs = await sql`
    SELECT id, "packageId", event, level, message, source, "durationMs", "fileSizeBytes", "createdAt"
    FROM package_activity_logs
    ORDER BY id DESC
    LIMIT 20
  `;
  
  console.log(`\nFound ${logs.length} activity log entries:\n`);
  for (const log of logs) {
    const ts = new Date(log.createdAt).toLocaleTimeString();
    const dur = log.durationMs ? ` (${log.durationMs}ms)` : "";
    const size = log.fileSizeBytes ? ` [${(Number(log.fileSizeBytes) / 1024).toFixed(1)}KB]` : "";
    const level = log.level === "error" ? " ❌" : log.level === "warn" ? " ⚠️" : "";
    console.log(`  [${ts}] ${log.event.padEnd(16)} ${level} ${log.message}${dur}${size}`);
  }
  
  await sql.end();
}

run().catch((err) => { console.error(err); process.exit(1); });
