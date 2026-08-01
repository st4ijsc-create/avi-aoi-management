// doc 56 Đ3 (PILOT) — provision the two pilot devices used by the LIVE E2E:
//   • SCRW-SIM-01  (SCREWDRIVE)  — screwdriver controller, HTTP process-result
//   • ESP32-ENV-01 (IOT_SENSOR)  — temperature/humidity telemetry
// For each: ensure an approved+active machines row, then mint a REAL mk_ key
// (sha256 hash-at-rest in api_keys, exactly what machineAuthService.issueMachineKey
// writes) and PRINT the plaintext so the sim emitters can authenticate. Idempotent:
// re-running reuses the machine and mints a fresh key (old ones stay valid).
//
//   node scripts/pilot-provision-devices.mjs
//
// Requires DATABASE_URL (owner role, e.g. aoi:aoi@127.0.0.1:5434/aoi_management).
import 'dotenv/config';
import postgres from 'postgres';
import { createHash, randomBytes } from 'node:crypto';

const hashMachineKey = (k) => createHash('sha256').update(String(k), 'utf8').digest('hex');
const genKey = () => {
  const body = randomBytes(24).toString('base64url');
  return `mk_pilot_${body}`;
};

const DEVICES = [
  { code: 'SCRW-SIM-01', name: 'Máy bắt vít pilot 01', machineType: 'SCREWDRIVE', scopes: ['ingest:write', 'equipment:read'] },
  { code: 'ESP32-ENV-01', name: 'Cảm biến nhiệt-ẩm ESP32 pilot 01', machineType: 'IOT_SENSOR', scopes: ['ingest:write'] },
];

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  // Reuse any existing station/line so the NOT NULL FK chain is satisfied.
  const [station] = await sql`SELECT id FROM stations WHERE "isActive" = true ORDER BY id LIMIT 1`;
  if (!station) throw new Error('No active station found — seed a station first.');

  const out = [];
  for (const d of DEVICES) {
    let [m] = await sql`SELECT id, code FROM machines WHERE code = ${d.code} LIMIT 1`;
    if (!m) {
      [m] = await sql`
        INSERT INTO machines (code, name, "machineType", "stationId", "registrationStatus", "isActive", "lifecycleStatus")
        VALUES (${d.code}, ${d.name}, ${d.machineType}, ${station.id}, 'approved', true, 'active')
        RETURNING id, code`;
      console.log(`[pilot] created machine ${d.code} (id=${m.id})`);
    } else {
      await sql`UPDATE machines SET "registrationStatus"='approved', "isActive"=true, "lifecycleStatus"='active' WHERE id=${m.id}`;
      console.log(`[pilot] reuse machine ${d.code} (id=${m.id})`);
    }

    const plaintext = genKey();
    await sql`
      INSERT INTO api_keys (name, description, "keyHash", "keyPrefix", scopes, "isActive", "machineId")
      VALUES (${'machine:' + d.code}, ${'doc56 Đ3 pilot mk_ key'}, ${hashMachineKey(plaintext)},
              ${plaintext.slice(0, 9)}, ${sql.json(d.scopes)}, true, ${m.id})`;
    out.push({ code: d.code, machineId: m.id, machineType: d.machineType, apiKey: plaintext });
  }

  console.log('\n=== PILOT CREDENTIALS (mk_ plaintext — sim emitters use these) ===');
  for (const o of out) {
    console.log(`${o.code}\t(id=${o.machineId}, ${o.machineType})\t${o.apiKey}`);
  }
  console.log('\nExport for the emitters:');
  const scrw = out.find((o) => o.code === 'SCRW-SIM-01');
  const esp = out.find((o) => o.code === 'ESP32-ENV-01');
  if (scrw) console.log(`  SCRW_KEY=${scrw.apiKey}`);
  if (esp) console.log(`  ESP_KEY=${esp.apiKey}  (machineId=${esp.machineId})`);
} finally {
  await sql.end();
}
