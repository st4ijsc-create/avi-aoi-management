// doc 56 Đ4 — LIVE proof of the config-sync HTTP PROXY layer (complements the
// caller-level pilot-config-sync.mjs): drives the REAL Express endpoints over the
// wire with a Bearer mk_ key, exactly as device firmware would.
//
//   GET  /api/machine/config-sync/check?configKind=recipe   (Authorization: Bearer mk_)
//   GET  /api/machine/config-sync/get?configKind=recipe
//   POST /api/machine/config-sync/ack   {configKind, code, version, checksum}
//
// Prereq: a server running with CONFIG_SYNC_GENERIC_ENABLED=true (default :3007 here)
// + an active recipe already deployed for SCRW-SIM-01 (from pilot-config-sync.mjs).
//
//   BASE=http://127.0.0.1:3007 DATABASE_URL="postgresql://aoi:aoi@127.0.0.1:5434/aoi_management" \
//     node scripts/pilot-config-sync-http.mjs
import 'dotenv/config';
import postgres from 'postgres';
import { createHash, randomBytes } from 'node:crypto';

const BASE = (process.env.BASE || 'http://127.0.0.1:3007').replace(/\/+$/, '');
const CODE = 'SCRW-SIM-01';
const hashKey = (k) => createHash('sha256').update(String(k), 'utf8').digest('hex');
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function http(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

let KEY;
try {
  const [m] = await sql`SELECT id FROM machines WHERE code = ${CODE} LIMIT 1`;
  if (!m) throw new Error(`${CODE} not found — run pilot-config-sync.mjs first`);
  const [rc] = await sql`SELECT code, version, checksum FROM machine_recipes WHERE "machineId"=${m.id} AND status='active' ORDER BY version DESC LIMIT 1`;
  if (!rc) throw new Error(`No active recipe for ${CODE} — run pilot-config-sync.mjs first`);
  KEY = `mk_pilot_${randomBytes(24).toString('base64url')}`;
  await sql`INSERT INTO api_keys (name, description, "keyHash", "keyPrefix", scopes, "isActive", "machineId")
            VALUES (${'machine:' + CODE + ':http'}, ${'doc56 Đ4 http proof'}, ${hashKey(KEY)}, ${KEY.slice(0, 9)},
                    ${sql.json(['ingest:write', 'equipment:read'])}, true, ${m.id})`;
  console.log(`Machine ${CODE} (id=${m.id}) active recipe ${rc.code} v${rc.version} checksum=${rc.checksum?.slice(0, 16)}… · minted fresh mk_ · BASE=${BASE}`);
  console.log('─'.repeat(78));

  const check = await http('GET', `/api/machine/config-sync/check?configKind=recipe`);
  console.log(`CHECK  → HTTP ${check.status} ${JSON.stringify({ code: check.json?.code, version: check.json?.version, checksum: String(check.json?.checksum).slice(0, 16) + '…', resolvedBy: check.json?.resolvedBy })}`);

  const get = await http('GET', `/api/machine/config-sync/get?configKind=recipe`);
  console.log(`GET    → HTTP ${get.status} ${JSON.stringify({ code: get.json?.code, version: get.json?.version, hasPayload: get.json?.payload != null })}`);

  const ackOk = await http('POST', `/api/machine/config-sync/ack`, { configKind: 'recipe', code: get.json?.code, version: get.json?.version, checksum: get.json?.checksum });
  console.log(`ACK ok → HTTP ${ackOk.status} driftState=${ackOk.json?.driftState}`);

  const ackDrift = await http('POST', `/api/machine/config-sync/ack`, { configKind: 'recipe', code: get.json?.code, version: get.json?.version, checksum: 'http_operator_hand_edit' });
  console.log(`ACK ≠  → HTTP ${ackDrift.status} driftState=${ackDrift.json?.driftState}`);
  console.log('─'.repeat(78));

  const pass =
    check.status === 200 && check.json?.checksum === rc.checksum && check.json?.resolvedBy === 'machine' &&
    get.status === 200 && get.json?.payload != null &&
    ackOk.status === 200 && ackOk.json?.driftState === 'in_sync' &&
    ackDrift.status === 200 && ackDrift.json?.driftState === 'drift';
  console.log(pass
    ? '✅ CONFIG-SYNC HTTP PROXY PROVEN: check→get→ack(in_sync)→drift qua Express + Bearer mk_ trên dây.'
    : '❌ FAILED — see values above.');
  process.exitCode = pass ? 0 : 1;
} finally {
  await sql.end();
}
