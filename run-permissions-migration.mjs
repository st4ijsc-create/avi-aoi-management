import postgres from 'postgres';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sql = postgres(process.env.DATABASE_URL);

async function runMigration() {
  try {
    console.log('🚀 Starting permissions migration...');
    
    // Read migration SQL file
    const sqlPath = path.join(__dirname, 'drizzle', '0001_nice_sinister_six.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');
    
    // Split by statement breakpoint and execute
    const statements = sqlContent
      .split('--> statement-breakpoint')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    console.log(`📄 Found ${statements.length} SQL statements`);
    
    await sql.begin(async sql => {
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        try {
          console.log(`  ⏳ Executing statement ${i + 1}/${statements.length}...`);
          await sql.unsafe(stmt);
          console.log(`  ✓ Statement ${i + 1} completed`);
        } catch (err) {
          // Ignore errors for already existing objects
          if (err.code === '42P07' || err.code === '42710' || err.code === '42P06') {
            console.log(`  ⏭️  Statement ${i + 1} skipped (already exists)`);
          } else {
            console.error(`  ❌ Statement ${i + 1} failed:`, err.message);
            throw err;
          }
        }
      }
    });
    
    console.log('✅ Permissions migration completed successfully!');
    
  } catch (err) {
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    await sql.end();
  }
}

runMigration().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
