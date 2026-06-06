import postgres from 'postgres';
const sql = postgres('postgresql://postgres:sa123%40@localhost:5432/avi_aoi_db');
try {
  // Check existing tables
  const tables = await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename`;
  console.log('=== Tables ===');
  tables.forEach(t => console.log(' ', t.tablename));

  // Check enum values
  const enums = await sql`
    SELECT t.typname, e.enumlabel
    FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname IN ('machinetypeenum', 'operationstatusenum')
    ORDER BY t.typname, e.enumsortorder`;
  console.log('\n=== Enum values ===');
  enums.forEach(e => console.log(`  ${e.typname}: ${e.enumlabel}`));

  // Check measurement_results columns
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'measurement_results' AND table_schema = 'public'
    ORDER BY ordinal_position`;
  console.log('\n=== measurement_results columns ===');
  cols.forEach(c => console.log(' ', c.column_name));

  // Check factories columns
  const fcols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'factories' AND table_schema = 'public'
    ORDER BY ordinal_position`;
  console.log('\n=== factories columns ===');
  fcols.forEach(c => console.log(' ', c.column_name));

} catch(e) { console.error('Error:', e.message); }
await sql.end();
