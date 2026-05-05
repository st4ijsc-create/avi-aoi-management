import postgres from 'postgres';
const sql = postgres('postgresql://postgres:sa123%40@localhost:5432/avi_aoi_db');
const r1 = await sql`DELETE FROM measurement_results WHERE "inspectionId"=6291`;
console.log('Deleted measurement_results:', r1.count);
const r2 = await sql`DELETE FROM inspection_packages WHERE "inspectionId"=6291`;
console.log('Deleted inspection_packages:', r2.count);
const r3 = await sql`DELETE FROM product_inspections WHERE id=6291`;
console.log('Deleted inspection:', r3.count);
await sql.end();
