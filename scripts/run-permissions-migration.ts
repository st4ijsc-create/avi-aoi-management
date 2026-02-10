import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
  ssl: {
    rejectUnauthorized: false
  }
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting permissions migration...');
    
    // Read migration SQL file
    const sqlPath = path.join(__dirname, '..', 'drizzle', '0001_nice_sinister_six.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');
    
    // Split by statement breakpoint and execute
    const statements = sqlContent
      .split('--> statement-breakpoint')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    console.log(`📄 Found ${statements.length} SQL statements`);
    
    await client.query('BEGIN');
    
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        console.log(`  ⏳ Executing statement ${i + 1}/${statements.length}...`);
        await client.query(stmt);
      } catch (err: any) {
        // Ignore errors for already existing objects
        if (err.code === '42P07' || err.code === '42710') {
          console.log(`  ⏭️  Statement ${i + 1} skipped (already exists)`);
        } else {
          throw err;
        }
      }
    }
    
    await client.query('COMMIT');
    console.log('✅ Permissions migration completed successfully!');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
