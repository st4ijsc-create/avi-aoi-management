import postgres from 'postgres';
const sql = postgres('postgresql://postgres:sa123%40@localhost:5432/avi_aoi_db');
try {
  const rows = await sql`SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at`;
  console.log('Applied migrations:');
  rows.forEach(r => console.log(`  hash=${r.hash.substring(0,20)}... at=${r.created_at}`));
  console.log(`Total: ${rows.length}`);
} catch(e) { console.error('Error:', e.message); }
await sql.end();
