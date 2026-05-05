import 'dotenv/config';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:sa123%40@localhost:5432/avi_aoi_db';

const sql = postgres(DATABASE_URL, { ssl: false, max: 1 });

try {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "factory_alert_versions" (
      "id" serial PRIMARY KEY,
      "version" varchar(50) NOT NULL,
      "versionCode" integer NOT NULL,
      "releaseDate" timestamp DEFAULT now() NOT NULL,
      "changelog" text,
      "apkFileName" varchar(255),
      "apkFilePath" varchar(500),
      "fileSize" integer,
      "mandatory" boolean DEFAULT false NOT NULL,
      "minVersionCode" integer,
      "isActive" boolean DEFAULT false NOT NULL,
      "uploadedBy" integer,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    )
  `);
  console.log('Created factory_alert_versions table');

  await sql.unsafe(`CREATE INDEX IF NOT EXISTS "idx_fa_version_code" ON "factory_alert_versions" ("versionCode")`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS "idx_fa_version_active" ON "factory_alert_versions" ("isActive")`);
  console.log('Created indexes');

  // Migrate existing APK files from uploads/factory-alert-releases/ into the DB
  const fs = await import('fs');
  const path = await import('path');
  const releasesDir = path.join(process.cwd(), 'uploads', 'factory-alert-releases');

  if (fs.existsSync(path.join(releasesDir, 'version.json'))) {
    const versionData = JSON.parse(fs.readFileSync(path.join(releasesDir, 'version.json'), 'utf-8'));
    
    // Find all APK files
    const apkFiles = fs.readdirSync(releasesDir).filter(f => f.endsWith('.apk'));
    
    for (const apkFile of apkFiles) {
      const match = apkFile.match(/v(\d+\.\d+\.\d+)/);
      if (!match) continue;
      
      const ver = match[1];
      const filePath = path.join(releasesDir, apkFile);
      const stat = fs.statSync(filePath);
      
      // Check if already exists
      const existing = await sql.unsafe(`SELECT id FROM "factory_alert_versions" WHERE "version" = $1`, [ver]);
      if (existing.length > 0) {
        console.log(`Version ${ver} already exists, skipping`);
        continue;
      }
      
      // Move APK to version folder
      const versionDir = path.join(releasesDir, `v${ver}`);
      if (!fs.existsSync(versionDir)) fs.mkdirSync(versionDir, { recursive: true });
      const newPath = path.join(versionDir, apkFile);
      if (!fs.existsSync(newPath)) {
        fs.copyFileSync(filePath, newPath);
      }
      
      const isActive = versionData.version === ver;
      const versionCode = isActive ? versionData.versionCode : (ver === '1.0.0' ? 1 : 0);
      const changelog = isActive && versionData.changelog ? (Array.isArray(versionData.changelog) ? versionData.changelog.join('\n') : versionData.changelog) : '';
      const mandatory = isActive ? (versionData.mandatory || false) : false;

      await sql.unsafe(`
        INSERT INTO "factory_alert_versions" ("version", "versionCode", "changelog", "apkFileName", "apkFilePath", "fileSize", "mandatory", "isActive")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [ver, versionCode, changelog, apkFile, `factory-alert-releases/v${ver}/${apkFile}`, stat.size, mandatory, isActive]);
      console.log(`Migrated ${apkFile} (active: ${isActive})`);
    }
  }

  console.log('Factory alert versions migration completed successfully');
} catch (e) {
  console.error('Migration error:', e.message);
} finally {
  await sql.end();
}
