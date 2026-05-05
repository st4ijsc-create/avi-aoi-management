import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

async function main() {
  const dbUrl = process.env.DATABASE_URL || "postgres://postgres:sa123%40@localhost:5432/avi_aoi_db";
  const client = postgres(dbUrl, { max: 1 });
  const db = drizzle(client);
  const result = await db.execute(sql`
    SELECT id, "imageUrl" 
    FROM measurement_results 
    WHERE "imageUrl" IS NOT NULL AND "imageUrl" != '' 
    ORDER BY id DESC LIMIT 10
  `);
  const rows = (result as any).rows || result;
  for (const r of rows as any[]) {
    console.log(`id=${r.id}  imageUrl=${r.imageUrl}`);
  }
  await client.end();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
