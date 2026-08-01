// doc 54 Đợt F — provision a hashed per-machine credential in api_keys FROM each
// machine's EXISTING plaintext machines.apiKey, so the machine keeps its current key
// but now authenticates via the hash-at-rest path (api_keys, migration 0178). This lets
// MACHINE_SHARED_KEY_ALLOWED be flipped to false WITHOUT reconfiguring any machine.
// Idempotent: skips a machine whose key hash already exists in api_keys.
//   node scripts/provision-machine-api-keys.mjs
import 'dotenv/config';
import postgres from 'postgres';
import { createHash } from 'node:crypto';

const hashMachineKey = (k) => createHash('sha256').update(String(k), 'utf8').digest('hex');
const DEFAULT_SCOPES = ['ingest:write', 'equipment:read', 'edge:sync'];

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const machines = await sql`
    SELECT id, code, name, "apiKey" FROM machines
    WHERE "isActive" = true AND "apiKey" IS NOT NULL AND "apiKey" <> ''`;
  let created = 0, skipped = 0;
  for (const m of machines) {
    const keyHash = hashMachineKey(m.apiKey);
    const [ex] = await sql`SELECT id FROM api_keys WHERE "keyHash" = ${keyHash} LIMIT 1`;
    if (ex) { skipped++; continue; }
    await sql`
      INSERT INTO api_keys (name, description, "keyHash", "keyPrefix", scopes, "isActive", "machineId")
      VALUES (${'machine:' + m.code}, ${'doc54 F: hashed from existing machines.apiKey — ' + m.code},
              ${keyHash}, ${String(m.apiKey).slice(0, 9)}, ${sql.json(DEFAULT_SCOPES)}, true, ${m.id})`;
    created++;
  }
  console.log(`[provision-machine-api-keys] created ${created}, skipped(existing) ${skipped}, machines-with-key ${machines.length}`);
} finally {
  await sql.end();
}
