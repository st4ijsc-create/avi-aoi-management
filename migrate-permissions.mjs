import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Pool } = pkg;
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { config } from 'dotenv';

config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const db = drizzle(pool);

async function main() {
  console.log('Starting permissions migration...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('✅ Permissions migration completed!');
  await pool.end();
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
