import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(
  process.env.DATABASE_URL || 'postgresql://postgres:sa123%40@localhost:5432/avi_aoi_db',
  { ssl: false, max: 1 }
);

const tables = await sql`
  SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename
`;

const enums = await sql`
  SELECT typname FROM pg_type 
  WHERE typcategory='E' AND typnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
  ORDER BY typname
`;

console.log('=== TABLES ===');
tables.forEach(r => console.log(r.tablename));
console.log('\n=== ENUMS ===');
enums.forEach(r => console.log(r.typname));

await sql.end();
