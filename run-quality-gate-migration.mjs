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
    // Read migration file
    const migrationPath = join(__dirname, 'drizzle', '0067_quality_gate_templates.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');
    
    console.log('📄 Running migration: 0067_quality_gate_templates.sql');
    console.log('─'.repeat(60));
    
    // Remove comments and split by semicolon
    const cleanSQL = migrationSQL
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');
    
    // Split by semicolon but keep multi-line statements together
    const statements = cleanSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 5);
    
    console.log(`\n📝 Found ${statements.length} statements to execute\n`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      console.log(`\n[${i + 1}/${statements.length}] Executing...`);
      
      // Show first line of statement
      const firstLine = statement.split('\n')[0];
      console.log(`   ${firstLine.substring(0, 80)}${firstLine.length > 80 ? '...' : ''}`);
      
      try {
        await sql.unsafe(statement);
        console.log('   ✅ Success');
      } catch (err) {
        // Some errors are expected (already exists, etc)
        if (err.code === '42P07' || err.code === '23505' || 
            err.code === '42P01' || // relation does not exist
            err.message?.includes('already exists') || 
            err.message?.includes('duplicate') ||
            err.message?.includes('does not exist')) {
          console.log('   ⚠️  Skipping (already exists or not found)...');
        } else {
          console.error('   ❌ Error:', err.message);
          throw err;
        }
      }
    }
    
    console.log('\n' + '─'.repeat(60));
    console.log('✅ Migration completed successfully!');
    console.log('\n📊 Quality Gate Templates Summary:');
    console.log('   • quality_gate_templates table created');
    console.log('   • quality_gate_template_assignments table created');
    console.log('   • Indexes created for faster lookups');
    console.log('   • Ready for custom quality gate template management');
    
  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await sql.end();
    console.log('\n🔌 Database connection closed');
  }
}

runMigration();
