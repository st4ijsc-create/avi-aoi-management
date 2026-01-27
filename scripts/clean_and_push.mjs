import { Pool } from 'pg';

const connectionString = process.env.SUPABASE_DATABASE_URL;
if (!connectionString) {
  console.error('SUPABASE_DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function cleanDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('Cleaning database...');
    
    // Drop all tables in public schema
    const tablesResult = await client.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    
    if (tablesResult.rows.length > 0) {
      console.log(`Found ${tablesResult.rows.length} tables to drop`);
      
      // Disable foreign key checks and drop all tables
      await client.query('SET session_replication_role = replica;');
      
      for (const row of tablesResult.rows) {
        console.log(`  Dropping table: ${row.tablename}`);
        await client.query(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE`);
      }
      
      await client.query('SET session_replication_role = DEFAULT;');
    }
    
    // Drop all custom types (enums)
    const typesResult = await client.query(`
      SELECT typname FROM pg_type 
      WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND typtype = 'e'
    `);
    
    if (typesResult.rows.length > 0) {
      console.log(`Found ${typesResult.rows.length} enums to drop`);
      
      for (const row of typesResult.rows) {
        console.log(`  Dropping enum: ${row.typname}`);
        await client.query(`DROP TYPE IF EXISTS "${row.typname}" CASCADE`);
      }
    }
    
    console.log('Database cleaned successfully!');
    
  } catch (error) {
    console.error('Error cleaning database:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

cleanDatabase().catch(console.error);
