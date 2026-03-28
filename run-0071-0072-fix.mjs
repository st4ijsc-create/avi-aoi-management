import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { ssl: 'prefer', max: 1 });

try {
  // Backfill normalized coords - exclude invalid dimensions (imageWidth/Height <= 1)
  const result = await sql.unsafe(`
    UPDATE "measurement_point_defs" mpd
    SET
      "normalizedX" = ROUND(mpd."positionX"::numeric / pm."imageWidth"::numeric, 8),
      "normalizedY" = ROUND(mpd."positionY"::numeric / pm."imageHeight"::numeric, 8),
      "normalizedRadius" = ROUND(mpd."radius"::numeric / pm."imageWidth"::numeric, 8)
    FROM "product_models" pm
    WHERE mpd."productModelId" = pm."id"
      AND mpd."normalizedX" IS NULL
      AND pm."imageWidth" IS NOT NULL AND pm."imageWidth" > 1
      AND pm."imageHeight" IS NOT NULL AND pm."imageHeight" > 1
  `);
  console.log('✅ Backfill completed:', result.count, 'rows updated');

  // Now run 0072 statements
  console.log('\n📄 Running 0072_sync_improvements.sql...');

  // Enums
  await sql.unsafe(`DO $$ BEGIN CREATE TYPE "syncoperationenum" AS ENUM ('POINTS_PUSH', 'POINTS_PULL', 'IMAGE_PUSH', 'IMAGE_PULL', 'FULL_SYNC', 'DELTA_SYNC'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  console.log('  ✅ syncoperationenum');

  await sql.unsafe(`DO $$ BEGIN CREATE TYPE "syncstatusenum" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  console.log('  ✅ syncstatusenum');

  // Columns
  await sql.unsafe(`ALTER TABLE "measurement_point_defs" ADD COLUMN IF NOT EXISTS "imageHash" varchar(64)`);
  console.log('  ✅ measurement_point_defs.imageHash');

  await sql.unsafe(`ALTER TABLE "measurement_point_defs" ADD COLUMN IF NOT EXISTS "lastModifiedAt" timestamp DEFAULT now()`);
  console.log('  ✅ measurement_point_defs.lastModifiedAt');

  await sql.unsafe(`ALTER TABLE "product_models" ADD COLUMN IF NOT EXISTS "imageHash" varchar(64)`);
  console.log('  ✅ product_models.imageHash');

  // sync_logs table
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS "sync_logs" (
    "id" serial PRIMARY KEY,
    "machineId" integer NOT NULL,
    "machineCode" varchar(50) NOT NULL,
    "productModelId" integer,
    "productModelCode" varchar(100),
    "syncOperation" syncoperationenum NOT NULL,
    "syncStatus" syncstatusenum NOT NULL DEFAULT 'SUCCESS',
    "pointsSynced" integer DEFAULT 0,
    "pointsCreated" integer DEFAULT 0,
    "pointsUpdated" integer DEFAULT 0,
    "pointsFailed" integer DEFAULT 0,
    "errorDetails" json,
    "sourceImageWidth" integer,
    "sourceImageHeight" integer,
    "serverImageWidth" integer,
    "serverImageHeight" integer,
    "coordTransformations" integer DEFAULT 0,
    "fromVersion" integer,
    "toVersion" integer,
    "imageHashBefore" varchar(64),
    "imageHashAfter" varchar(64),
    "imageSizeBytes" integer,
    "imageSkipped" boolean DEFAULT false,
    "durationMs" integer,
    "requestSizeBytes" integer,
    "clientVersion" varchar(50),
    "ipAddress" varchar(45),
    "createdAt" timestamp DEFAULT now() NOT NULL
  )`);
  console.log('  ✅ sync_logs table');

  // Indexes
  const indexes = [
    ['idx_sync_logs_machine', '"sync_logs" ("machineId")'],
    ['idx_sync_logs_machine_code', '"sync_logs" ("machineCode")'],
    ['idx_sync_logs_product', '"sync_logs" ("productModelId")'],
    ['idx_sync_logs_operation', '"sync_logs" ("syncOperation")'],
    ['idx_sync_logs_status', '"sync_logs" ("syncStatus")'],
    ['idx_sync_logs_created', '"sync_logs" ("createdAt")'],
    ['idx_sync_logs_machine_product', '"sync_logs" ("machineId", "productModelId")'],
    ['idx_point_defs_last_modified', '"measurement_point_defs" ("lastModifiedAt")'],
    ['idx_point_defs_product_modified', '"measurement_point_defs" ("productModelId", "lastModifiedAt")'],
    ['idx_point_defs_image_hash', '"measurement_point_defs" ("imageHash")'],
    ['idx_product_models_image_hash', '"product_models" ("imageHash")'],
  ];
  for (const [name, def] of indexes) {
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS "${name}" ON ${def}`);
  }
  console.log('  ✅ All indexes created');

  // Backfill lastModifiedAt
  await sql.unsafe(`UPDATE "measurement_point_defs" SET "lastModifiedAt" = "updatedAt" WHERE "lastModifiedAt" IS NULL`);
  console.log('  ✅ lastModifiedAt backfilled');

  // Verify
  console.log('\n🔍 Verification:');
  const pmCols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'product_models' AND column_name IN ('pointsConfigVersion', 'imageHash') ORDER BY column_name`;
  console.log('product_models:', pmCols.map(c => c.column_name).join(', '));
  const mpdCols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'measurement_point_defs' AND column_name IN ('normalizedX', 'normalizedY', 'normalizedRadius', 'imageHash', 'lastModifiedAt') ORDER BY column_name`;
  console.log('measurement_point_defs:', mpdCols.map(c => c.column_name).join(', '));

  console.log('\n✅ All migrations applied successfully!');
} catch (e) {
  console.error('❌ Error:', e.message);
  process.exit(1);
} finally {
  await sql.end();
}
