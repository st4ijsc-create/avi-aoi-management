import 'dotenv/config';
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: 'prefer', max: 1 });

async function runMigrationFile(filename) {
  const migrationPath = join(__dirname, 'drizzle', filename);
  const migrationSQL = readFileSync(migrationPath, 'utf-8');

  console.log(`\n📄 Running migration: ${filename}`);
  console.log('─'.repeat(60));

  // Parse SQL handling DO $$ blocks
  const blocks = [];
  let current = '';
  let inDollarBlock = false;

  for (const line of migrationSQL.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--')) continue;

    if (trimmed.includes('DO $$')) inDollarBlock = true;
    current += line + '\n';

    if (inDollarBlock && trimmed.includes('END $$;')) {
      blocks.push(current.trim());
      current = '';
      inDollarBlock = false;
    } else if (!inDollarBlock && trimmed.endsWith(';')) {
      const stmt = current.trim();
      if (stmt.length > 5) blocks.push(stmt);
      current = '';
    }
  }
  if (current.trim().length > 5) blocks.push(current.trim());

  console.log(`📝 Found ${blocks.length} statements\n`);

  for (let i = 0; i < blocks.length; i++) {
    const statement = blocks[i];
    const preview = statement.substring(0, 80).replace(/\n/g, ' ');
    console.log(`[${i + 1}/${blocks.length}] ${preview}...`);

    try {
      await sql.unsafe(statement);
      console.log('  ✅ Success');
    } catch (err) {
      if (
        err.message?.includes('already exists') ||
        err.message?.includes('duplicate') ||
        err.code === '42P07' ||
        err.code === '42710'
      ) {
        console.log('  ⏭️  Skipped (already exists)');
      } else {
        console.error('  ❌ Error:', err.message);
        throw err;
      }
    }
  }
  console.log(`✅ ${filename} completed!`);
}

try {
  await runMigrationFile('0071_coordinate_normalization.sql');
  await runMigrationFile('0072_sync_improvements.sql');

  // Verify columns exist
  console.log('\n🔍 Verifying columns...\n');

  const pmCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'product_models'
    AND column_name IN ('pointsConfigVersion', 'imageHash')
    ORDER BY column_name`;
  console.log('product_models new columns:', pmCols.map(c => c.column_name).join(', '));

  const mpdCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'measurement_point_defs'
    AND column_name IN ('normalizedX', 'normalizedY', 'normalizedRadius', 'imageHash', 'lastModifiedAt')
    ORDER BY column_name`;
  console.log('measurement_point_defs new columns:', mpdCols.map(c => c.column_name).join(', '));

  console.log('\n✅ All migrations applied successfully!');
} catch (e) {
  console.error('\n❌ Migration failed:', e.message);
  process.exit(1);
} finally {
  await sql.end();
}
