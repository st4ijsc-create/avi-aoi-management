import 'dotenv/config';
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:sa123%40@localhost:5432/avi_aoi_db';

const sql = postgres(DATABASE_URL, { ssl: false, max: 1 });

try {
  const migrationPath = join(__dirname, 'drizzle', '0073_ai_model_management.sql');
  const migrationSQL = readFileSync(migrationPath, 'utf-8');

  console.log('🚀 Running migration: 0073_ai_model_management.sql');
  console.log('─'.repeat(60));

  await sql.unsafe(migrationSQL);

  console.log('✅ Migration 0073 completed successfully');
  console.log('   Created: ai_models, model_versions, model_inference_logs');
} catch (e) {
  console.error('❌ Migration error:', e.message);
  process.exit(1);
} finally {
  await sql.end();
}
