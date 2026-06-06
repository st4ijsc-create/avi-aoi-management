import postgres from 'postgres';
const sql = postgres('postgresql://postgres:sa123%40@localhost:5432/avi_aoi_db');
try {
  // Check __applied_migrations table structure
  const cols = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = '__applied_migrations' AND table_schema = 'public'
    ORDER BY ordinal_position`;
  console.log('=== __applied_migrations columns ===');
  cols.forEach(c => console.log(`  ${c.column_name} (${c.data_type})`));

  // Get last 10 applied migrations
  const rows = await sql`SELECT * FROM __applied_migrations ORDER BY applied_at DESC LIMIT 20`;
  console.log('\n=== Last 20 applied migrations ===');
  rows.forEach(r => console.log(JSON.stringify(r)));
} catch(e) { console.error('Error:', e.message); }
await sql.end();
