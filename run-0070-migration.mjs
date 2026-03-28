import 'dotenv/config';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:sa123%40@localhost:5432/avi_aoi_db';

const sql = postgres(DATABASE_URL, { ssl: false, max: 1 });

try {
  await sql.unsafe('ALTER TABLE "mqtt_ng_alert_settings" ADD COLUMN IF NOT EXISTS "includePointImages" boolean DEFAULT true NOT NULL');
  console.log('Added includePointImages column');
  await sql.unsafe('ALTER TABLE "mqtt_ng_alert_settings" ADD COLUMN IF NOT EXISTS "includeOverallResult" boolean DEFAULT true NOT NULL');
  console.log('Added includeOverallResult column');
  console.log('Migration 0070 completed successfully');
} catch (e) {
  console.error('Migration error:', e.message);
} finally {
  await sql.end();
}
