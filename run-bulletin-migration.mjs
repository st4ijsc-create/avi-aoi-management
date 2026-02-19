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

console.log('🔌 Connecting to database...');

const sql = postgres(DATABASE_URL, {
  ssl: 'prefer',
  max: 1,
});

async function runMigration() {
  try {
    const migrationPath = join(__dirname, 'drizzle', '0062_mqtt_bulletin.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');
    
    console.log('📄 Running migration: 0062_mqtt_bulletin.sql');
    console.log('─'.repeat(60));

    // Split by semicolon but handle DO $$ blocks
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

    console.log(`\n📝 Found ${blocks.length} statements to execute\n`);

    for (let i = 0; i < blocks.length; i++) {
      const statement = blocks[i];
      const preview = statement.substring(0, 80).replace(/\n/g, ' ');
      console.log(`[${i + 1}/${blocks.length}] ${preview}...`);
      
      try {
        await sql.unsafe(statement);
        console.log(`  ✅ Success`);
      } catch (err) {
        console.error(`  ⚠️  Error: ${err.message}`);
        // Continue on non-critical errors (e.g. "already exists")
        if (err.message.includes('already exists') || err.message.includes('duplicate')) {
          console.log('  ↳ Skipping (already exists)');
        } else {
          throw err;
        }
      }
    }

    // Verify tables
    console.log('\n─'.repeat(60));
    console.log('🔍 Verifying migration...\n');

    const settingsTable = await sql`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'mqtt_bulletin_settings' 
      ORDER BY ordinal_position
    `;
    
    if (settingsTable.length > 0) {
      console.log('✅ mqtt_bulletin_settings table created:');
      settingsTable.forEach(col => {
        console.log(`   - ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`);
      });
    } else {
      console.error('❌ mqtt_bulletin_settings table NOT found!');
    }

    console.log('');

    const historyTable = await sql`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'mqtt_bulletin_history' 
      ORDER BY ordinal_position
    `;
    
    if (historyTable.length > 0) {
      console.log('✅ mqtt_bulletin_history table created:');
      historyTable.forEach(col => {
        console.log(`   - ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`);
      });
    } else {
      console.error('❌ mqtt_bulletin_history table NOT found!');
    }

    // Check indexes
    console.log('');
    const indexes = await sql`
      SELECT indexname FROM pg_indexes 
      WHERE tablename IN ('mqtt_bulletin_settings', 'mqtt_bulletin_history')
      ORDER BY indexname
    `;
    console.log(`✅ Indexes (${indexes.length}):`);
    indexes.forEach(idx => {
      console.log(`   - ${idx.indexname}`);
    });

    // Check enum
    console.log('');
    const enumVals = await sql`
      SELECT unnest(enum_range(NULL::messagetypeenum))::text as val
    `;
    const hasBulletin = enumVals.some(e => e.val === 'PERIODIC_BULLETIN');
    console.log(`${hasBulletin ? '✅' : '❌'} messagetypeenum contains PERIODIC_BULLETIN: ${hasBulletin}`);

    console.log('\n✅ Migration completed successfully!');
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runMigration();
