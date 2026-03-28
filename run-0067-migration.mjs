import 'dotenv/config';
import postgres from 'postgres';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sql = postgres(
  process.env.DATABASE_URL || 'postgresql://postgres:sa123%40@localhost:5432/avi_aoi_db',
  { ssl: false, max: 1 }
);

const sqlContent = fs.readFileSync(
  path.join(__dirname, 'drizzle', '0067_quality_gate_templates.sql'),
  'utf8'
);

// Run entire file as one transaction
console.log('Executing migration 0067...');
try {
  await sql.unsafe(sqlContent);
  console.log('  ✅ Migration executed successfully');
} catch (e) {
  if (e.code === '42P07' || e.code === '42710') {
    console.log('  ⚠️  Some objects already exist, continuing...');
  } else {
    console.error(`  ❌ Error: ${e.message}`);
    console.error(`  Code: ${e.code}`);
  }
}

// Verify
const tables = await sql`
  SELECT tablename FROM pg_tables 
  WHERE schemaname='public' AND tablename IN ('quality_gate_templates','quality_gate_template_assignments')
`;
console.log('\n=== VERIFICATION ===');
if (tables.length === 2) {
  console.log('✅ Both tables created successfully:');
  tables.forEach(r => console.log(`   - ${r.tablename}`));
} else {
  console.log(`❌ Only ${tables.length}/2 tables found`);
}

await sql.end();
