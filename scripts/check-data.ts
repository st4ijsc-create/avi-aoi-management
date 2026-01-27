import { sql } from 'drizzle-orm';
import { getDb } from '../server/db';

async function check() {
  const db = await getDb();
  if (!db) {
    console.log('Database not available');
    return;
  }
  
  const result = await db.execute(sql`
    SELECT 
      (SELECT COUNT(*) FROM factories WHERE "isActive" = true) as factories,
      (SELECT COUNT(*) FROM workshops WHERE "isActive" = true) as workshops,
      (SELECT COUNT(*) FROM production_lines WHERE "isActive" = true) as lines,
      (SELECT COUNT(*) FROM stations WHERE "isActive" = true) as stations,
      (SELECT COUNT(*) FROM machines WHERE "isActive" = true) as machines,
      (SELECT COUNT(*) FROM product_inspections) as inspections
  `);
  console.log('Data counts:', result.rows[0]);
  process.exit(0);
}
check();
