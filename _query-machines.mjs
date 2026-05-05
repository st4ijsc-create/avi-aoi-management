import 'dotenv/config';
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { ssl: 'prefer', max: 1 });

// Clean up old test data
await sql.unsafe(`DELETE FROM measurement_results WHERE "inspectionId" = 6290`);
await sql.unsafe(`DELETE FROM package_images WHERE "packageId" IN (SELECT id FROM inspection_packages WHERE "packageId" = 'AOI-MAP-1775538642427')`);
await sql.unsafe(`DELETE FROM package_activity_logs WHERE "packageId" = 'AOI-MAP-1775538642427'`);
await sql.unsafe(`DELETE FROM inspection_packages WHERE "packageId" = 'AOI-MAP-1775538642427'`);
await sql.unsafe(`DELETE FROM product_inspections WHERE id = 6290`);
console.log("Old test data cleaned up");
await sql.end();
console.log(JSON.stringify(rows, null, 2));
await sql.end();
