import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false } });

async function run() {
  // Check existing columns
  const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'machines' AND column_name IN ('serialNumber','firmwareVersion','registrationStatus','syncMode','lastSyncAt','pendingConfig')`;
  console.log('Existing columns:', cols.map(c => c.column_name));

  // Add serialNumber if missing
  try { await sql.unsafe('ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "serialNumber" varchar(100)'); console.log('OK: serialNumber column'); } catch(e) { console.log('ERR serialNumber:', e.message); }
  
  // Drop NOT NULL on apiKey
  try { await sql.unsafe('ALTER TABLE "machines" ALTER COLUMN "apiKey" DROP NOT NULL'); console.log('OK: apiKey nullable'); } catch(e) { console.log('ERR apiKey:', e.message); }
  
  // Index on registrationStatus
  try { await sql.unsafe('CREATE INDEX IF NOT EXISTS "idx_machines_registration_status" ON "machines" ("registrationStatus")'); console.log('OK: idx registrationStatus'); } catch(e) { console.log('ERR idx registrationStatus:', e.message); }
  
  // Index on serialNumber
  try { await sql.unsafe('CREATE INDEX IF NOT EXISTS "idx_machines_serial_number" ON "machines" ("serialNumber")'); console.log('OK: idx serialNumber'); } catch(e) { console.log('ERR idx serialNumber:', e.message); }
  
  // Update existing machines to approved
  try { 
    const result = await sql.unsafe(`UPDATE "machines" SET "registrationStatus" = 'approved' WHERE "registrationStatus" = 'pending'`); 
    console.log('OK: updated existing machines to approved'); 
  } catch(e) { console.log('ERR update:', e.message); }
  
  // Verify final state
  const final = await sql`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'machines' AND column_name IN ('serialNumber','firmwareVersion','registrationStatus','syncMode','lastSyncAt','pendingConfig','apiKey') ORDER BY column_name`;
  console.log('\nFinal machine columns:');
  final.forEach(c => console.log(`  ${c.column_name}: ${c.data_type} (nullable: ${c.is_nullable})`));
  
  await sql.end();
  console.log('\nMigration complete!');
}
run().catch(e => { console.error(e); process.exit(1); });
