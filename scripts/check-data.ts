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
      (SELECT COUNT(*) FROM product_models WHERE "isActive" = true) as product_models,
      (SELECT COUNT(*) FROM measurement_point_defs WHERE "isActive" = true) as measurement_points,
      (SELECT COUNT(*) FROM product_inspections) as inspections,
      (SELECT COUNT(*) FROM measurement_results) as measurement_results
  `);
  console.log('Data counts:', result.rows[0]);
  
  // Get inspection result distribution
  const resultDist = await db.execute(sql`
    SELECT 
      "overallResult",
      COUNT(*) as count,
      ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM product_inspections), 2) as percentage
    FROM product_inspections
    GROUP BY "overallResult"
    ORDER BY "overallResult"
  `);
  console.log('\nInspection Result Distribution:');
  for (const row of resultDist.rows) {
    console.log(`  ${row.overallResult}: ${row.count} (${row.percentage}%)`);
  }
  
  process.exit(0);
}
check();
