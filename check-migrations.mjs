import 'dotenv/config';
import postgres from 'postgres';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.join(__dirname, 'drizzle');

const sql = postgres(
  process.env.DATABASE_URL || 'postgresql://postgres:sa123%40@localhost:5432/avi_aoi_db',
  { ssl: false, max: 1 }
);

// Get all existing tables
const rows = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
const existingTables = new Set(rows.map(r => r.tablename));

// Get all SQL files
const files = fs.readdirSync(drizzleDir)
  .filter(f => f.endsWith('.sql'))
  .sort();

console.log(`Found ${files.length} SQL migration files\n`);

const missingTables = [];

for (const file of files) {
  const content = fs.readFileSync(path.join(drizzleDir, file), 'utf8');
  // Find all CREATE TABLE statements
  const matches = content.matchAll(/CREATE TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+"?(\w+)"?/gi);
  const tables = [];
  for (const m of matches) {
    tables.push(m[1].toLowerCase());
  }
  if (tables.length > 0) {
    const missing = tables.filter(t => !existingTables.has(t));
    if (missing.length > 0) {
      console.log(`❌ ${file}: MISSING TABLES: ${missing.join(', ')}`);
      missingTables.push({ file, tables: missing });
    } else {
      console.log(`✅ ${file}: all tables present`);
    }
  }
}

console.log(`\n=== SUMMARY ===`);
if (missingTables.length === 0) {
  console.log('All tables from all migration files already exist in DB!');
} else {
  console.log(`Missing tables found in ${missingTables.length} file(s):`);
  missingTables.forEach(m => console.log(`  - ${m.file}: ${m.tables.join(', ')}`));
}

// Also check for CREATE TYPE (enums)
const enumRows = await sql`
  SELECT typname FROM pg_type 
  WHERE typcategory='E' AND typnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
`;
const existingEnums = new Set(enumRows.map(r => r.typname.toLowerCase()));

const missingEnums = [];
for (const file of files) {
  const content = fs.readFileSync(path.join(drizzleDir, file), 'utf8');
  const matches = content.matchAll(/CREATE TYPE\s+"?(\w+)"?\s+AS\s+ENUM/gi);
  for (const m of matches) {
    const enumName = m[1].toLowerCase();
    if (!existingEnums.has(enumName)) {
      missingEnums.push({ file, enum: enumName });
    }
  }
}

if (missingEnums.length > 0) {
  console.log(`\nMissing enums:`);
  missingEnums.forEach(m => console.log(`  - ${m.file}: ${m.enum}`));
} else {
  console.log('\nAll enums are present!');
}

await sql.end();
