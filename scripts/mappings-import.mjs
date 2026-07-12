#!/usr/bin/env node
/**
 * doc 44 W2-B3 (G1.13) — Mapping-as-code IMPORT CLI (SYNAPSE Tầng-1 Chương 10).
 *
 * Import một file contracts/mappings/*.mapping.yaml vào DB (device_tags +
 * uns_tag_mappings) theo KHÓA TỰ NHIÊN (adapter code + tag name).
 *
 * Cách dùng (đọc DATABASE_URL từ .env, pattern migrate-standalone.mjs):
 *   node scripts/mappings-import.mjs contracts/mappings/plc-1.mapping.yaml           (DRY-RUN: chỉ in diff)
 *   node scripts/mappings-import.mjs contracts/mappings/plc-1.mapping.yaml --apply   (ghi DB)
 *   node scripts/mappings-import.mjs <file> --apply --prune                          (+ xoá row DB vắng mặt trong file)
 *
 * AN TOÀN:
 *   - Mặc định DRY-RUN. --apply mới ghi; --prune mới xoá (tường minh).
 *   - Version gate: file.version phải >= version đã import (config_snapshots
 *     entity_type='mapping_file'); file cũ không đè bản mới.
 *   - Import KHÔNG tạo adapter, KHÔNG đổi machineId/endpoint, KHÔNG restart
 *     adapter — nếu tag đổi, tự restart adapter/app theo quy trình vận hành.
 *   - Apply chạy trong MỘT transaction (sql.begin) — nửa vời thì rollback.
 *
 * Exit code: 0 = OK (kể cả dry-run có diff); 1 = lỗi (validate/version/DB).
 * LƯU Ý: validate/diff phải khớp server/services/ot/mappingAsCode.ts.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

// ─── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PRUNE = args.includes('--prune');
const fileArg = args.find((a) => !a.startsWith('--'));
if (!fileArg) {
  console.error('Usage: node scripts/mappings-import.mjs <file.mapping.yaml> [--apply] [--prune]');
  process.exit(1);
}
const FILE = path.resolve(fileArg);
if (!fs.existsSync(FILE)) {
  console.error(`ERROR: file not found: ${FILE}`);
  process.exit(1);
}

// ─── .env loader (same as migrate-standalone.mjs) ────────────────────────────
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.substring(0, idx).trim();
    let value = trimmed.substring(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(path.join(process.cwd(), '.env'));
loadEnvFile(path.join(ROOT, '.env'));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set (set in .env or environment).');
  process.exit(1);
}

let postgres, YAML;
try {
  postgres = (await import('postgres')).default;
  YAML = await import('yaml');
} catch (e) {
  console.error('ERROR: cannot import "postgres"/"yaml" (npm install?):', e.message);
  process.exit(1);
}

// ─── parse + validate (mirror mappingAsCode.parseMappingYaml — no zod in .mjs) ─
const DATATYPES = new Set(['bool', 'int', 'float', 'string', 'json']);
const CASTS = new Set(['number', 'bool', 'string']);

function fail(errors) {
  console.error('Mapping file KHÔNG hợp lệ:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

function validateFile(raw) {
  const errors = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail(['file phải là một YAML object']);
  if (!Number.isInteger(raw.version) || raw.version < 1) errors.push('version: phải là số nguyên >= 1');
  if (typeof raw.adapter !== 'string' || !raw.adapter || raw.adapter.length > 64) errors.push('adapter: string 1..64 bắt buộc');
  if (raw.machine !== undefined && raw.machine !== null && typeof raw.machine !== 'string') errors.push('machine: string|null');
  if (raw.vendor !== undefined && raw.vendor !== null && typeof raw.vendor !== 'string') errors.push('vendor: string|null');

  const tags = raw.tags ?? [];
  const mappings = raw.uns_mappings ?? [];
  if (!Array.isArray(tags)) errors.push('tags: phải là mảng');
  if (!Array.isArray(mappings)) errors.push('uns_mappings: phải là mảng');
  if (errors.length) fail(errors);

  const seen = new Set();
  tags.forEach((t, i) => {
    const p = `tags[${i}]`;
    if (typeof t?.name !== 'string' || !t.name || t.name.length > 128) errors.push(`${p}.name: string 1..128`);
    else if (seen.has(t.name)) errors.push(`${p}: tag trùng lặp "${t.name}"`);
    else seen.add(t.name);
    if (typeof t?.address !== 'string' || !t.address || t.address.length > 255) errors.push(`${p}.address: string 1..255`);
    if (!DATATYPES.has(t?.datatype)) errors.push(`${p}.datatype: phải thuộc {bool,int,float,string,json}`);
    if (t?.unit != null && (typeof t.unit !== 'string' || t.unit.length > 50)) errors.push(`${p}.unit: string<=50|null`);
    if (t?.scale != null && !Number.isFinite(t.scale)) errors.push(`${p}.scale: number|null`);
    if (t?.offset != null && !Number.isFinite(t.offset)) errors.push(`${p}.offset: number|null`);
    if (t?.writable != null && typeof t.writable !== 'boolean') errors.push(`${p}.writable: boolean`);
    if (t?.enabled != null && typeof t.enabled !== 'boolean') errors.push(`${p}.enabled: boolean`);
    if (t?.deadband != null && !(Number.isFinite(t.deadband) && t.deadband > 0)) errors.push(`${p}.deadband: number > 0|null`);
    if (t?.sampling_ms != null && !(Number.isInteger(t.sampling_ms) && t.sampling_ms >= 1 && t.sampling_ms <= 86_400_000)) {
      errors.push(`${p}.sampling_ms: int 1..86400000|null`);
    }
  });

  const seenMap = new Set();
  mappings.forEach((m, i) => {
    const p = `uns_mappings[${i}]`;
    if (typeof m?.tag !== 'string' || !m.tag || m.tag.length > 128) errors.push(`${p}.tag: string 1..128`);
    else if (seenMap.has(m.tag)) errors.push(`${p}: uns_mapping trùng lặp cho tag "${m.tag}"`);
    else seenMap.add(m.tag);
    if (typeof m?.uns_topic !== 'string' || !m.uns_topic || m.uns_topic.length > 500) errors.push(`${p}.uns_topic: string 1..500`);
    if (m?.sparkplug_metric != null && (typeof m.sparkplug_metric !== 'string' || m.sparkplug_metric.length > 255)) {
      errors.push(`${p}.sparkplug_metric: string<=255|null`);
    }
    if (m?.enabled != null && typeof m.enabled !== 'boolean') errors.push(`${p}.enabled: boolean`);
    if (m?.transform != null) {
      if (typeof m.transform !== 'object' || Array.isArray(m.transform)) errors.push(`${p}.transform: object|null`);
      else {
        const allowed = new Set(['rename', 'scale', 'offset', 'unit', 'cast', 'deadband']);
        for (const k of Object.keys(m.transform)) if (!allowed.has(k)) errors.push(`${p}.transform.${k}: field lạ`);
        if (m.transform.cast != null && !CASTS.has(m.transform.cast)) errors.push(`${p}.transform.cast: {number,bool,string}`);
        if (m.transform.deadband != null && !(Number.isFinite(m.transform.deadband) && m.transform.deadband >= 0)) {
          errors.push(`${p}.transform.deadband: number >= 0`);
        }
        if (m.transform.scale != null && !Number.isFinite(m.transform.scale)) errors.push(`${p}.transform.scale: number`);
        if (m.transform.offset != null && !Number.isFinite(m.transform.offset)) errors.push(`${p}.transform.offset: number`);
      }
    }
  });

  if (errors.length) fail(errors);
  return {
    version: raw.version,
    adapter: raw.adapter,
    machine: raw.machine ?? null,
    vendor: raw.vendor ?? null,
    tags: tags.map((t) => ({ ...t, writable: t.writable ?? false, enabled: t.enabled ?? true })),
    uns_mappings: mappings.map((m) => ({ ...m, enabled: m.enabled ?? true })),
  };
}

// ─── normalize + diff (mirror mappingAsCode.diffMapping) ─────────────────────
function toNum(v, fallback) {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function normalizeTransform(t) {
  if (!t) return null;
  const out = {};
  for (const k of ['rename', 'scale', 'offset', 'unit', 'cast', 'deadband']) {
    if (t[k] !== undefined && t[k] !== null) out[k] = t[k];
  }
  return Object.keys(out).length ? out : null;
}
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  const s = JSON.stringify(value);
  return s === undefined ? 'null' : s;
}
const normFileTag = (t) => ({
  address: t.address, datatype: t.datatype, unit: t.unit ?? null,
  scale: t.scale ?? 1, offset: t.offset ?? 0, writable: t.writable, enabled: t.enabled,
  deadband: t.deadband ?? null, samplingMs: t.sampling_ms ?? null,
});
const normDbTag = (t) => ({
  address: t.address, datatype: t.dataType, unit: t.unit ?? null,
  scale: toNum(t.scale, 1), offset: toNum(t.offset, 0), writable: t.writable, enabled: t.isEnabled,
  deadband: t.deadband ?? null, samplingMs: t.samplingMs ?? null,
});
const normFileUns = (m) => ({
  unsTopic: m.uns_topic, sparkplugMetric: m.sparkplug_metric ?? null, enabled: m.enabled,
  transform: normalizeTransform(m.transform ?? null), notes: m.notes ? m.notes : null,
});
const normDbUns = (m) => ({
  unsTopic: m.unsTopic, sparkplugMetric: m.sparkplugMetric ?? null, enabled: m.enabled,
  transform: normalizeTransform(m.transform), notes: m.notes ? m.notes : null,
});
function changedFields(from, to) {
  return Object.keys(to).filter((k) => stableStringify(from[k]) !== stableStringify(to[k]));
}

// ─── main ─────────────────────────────────────────────────────────────────────
const raw = YAML.parse(fs.readFileSync(FILE, 'utf-8'));
const file = validateFile(raw);

const needsSsl = DATABASE_URL.includes('sslmode=require') || DATABASE_URL.includes('ssl=true');
const sql = postgres(DATABASE_URL, {
  ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  connect_timeout: 30,
  max: 1,
});

try {
  const [adapter] = await sql`SELECT id, code, protocol, "machineId" FROM device_adapters WHERE code = ${file.adapter} LIMIT 1`;
  if (!adapter) {
    console.error(`ERROR: adapter "${file.adapter}" không tồn tại — import không tạo adapter (tạo trước qua UI/router).`);
    await sql.end();
    process.exit(1);
  }

  // version gate
  const [snap] = await sql`
    SELECT payload_summary FROM config_snapshots
    WHERE entity_type = 'mapping_file' AND entity_id = ${adapter.id} LIMIT 1`;
  const storedVersion = Number(snap?.payload_summary?.version);
  if (Number.isFinite(storedVersion) && file.version < storedVersion) {
    console.error(`ERROR: version trong file (${file.version}) < version đã import (${storedVersion}) — bump version rồi import lại.`);
    await sql.end();
    process.exit(1);
  }

  const dbTags = await sql`
    SELECT "tagKey", address, "dataType", unit, scale, "offset", writable, "isEnabled", deadband, "samplingMs"
    FROM device_tags WHERE "adapterId" = ${adapter.id}`;
  const dbMaps = await sql`
    SELECT tag, "unsTopic", "sparkplugMetric", transform, enabled, notes
    FROM uns_tag_mappings WHERE "adapterId" = ${adapter.id}`;

  // diff
  const dbTagByKey = new Map(dbTags.map((t) => [t.tagKey, t]));
  const fileTagNames = new Set(file.tags.map((t) => t.name));
  const tagCreates = file.tags.filter((t) => !dbTagByKey.has(t.name));
  const tagUpdates = file.tags
    .filter((t) => dbTagByKey.has(t.name))
    .map((t) => ({ t, fields: changedFields(normDbTag(dbTagByKey.get(t.name)), normFileTag(t)) }))
    .filter((u) => u.fields.length > 0);
  const tagDeletes = dbTags.map((t) => t.tagKey).filter((k) => !fileTagNames.has(k)).sort();

  const dbMapByTag = new Map(dbMaps.map((m) => [m.tag, m]));
  const fileMapTags = new Set(file.uns_mappings.map((m) => m.tag));
  const unsCreates = file.uns_mappings.filter((m) => !dbMapByTag.has(m.tag));
  const unsUpdates = file.uns_mappings
    .filter((m) => dbMapByTag.has(m.tag))
    .map((m) => ({ m, fields: changedFields(normDbUns(dbMapByTag.get(m.tag)), normFileUns(m)) }))
    .filter((u) => u.fields.length > 0);
  const unsDeletes = dbMaps.map((m) => m.tag).filter((t) => !fileMapTags.has(t)).sort();

  // warnings
  if (file.vendor && file.vendor !== adapter.protocol) {
    console.warn(`  [WARN] vendor trong file ("${file.vendor}") khác protocol DB ("${adapter.protocol}").`);
  }
  for (const m of file.uns_mappings) {
    if (!fileTagNames.has(m.tag)) console.warn(`  [WARN] uns_mapping "${m.tag}" không có tag tương ứng trong file.`);
  }

  // print diff
  console.log(`\nAdapter "${adapter.code}" (id ${adapter.id}) — file version ${file.version}${Number.isFinite(storedVersion) ? ` (đã import: ${storedVersion})` : ' (chưa từng import)'}\n`);
  console.log('device_tags:');
  for (const t of tagCreates) console.log(`  + create  ${t.name}`);
  for (const u of tagUpdates) console.log(`  ~ update  ${u.t.name}  (${u.fields.join(', ')})`);
  for (const k of tagDeletes) console.log(`  - delete  ${k}  ${PRUNE ? '(--prune: SẼ XOÁ)' : '(giữ lại — cần --prune để xoá)'}`);
  if (!tagCreates.length && !tagUpdates.length && !tagDeletes.length) console.log('  (không đổi)');
  console.log('uns_tag_mappings:');
  for (const m of unsCreates) console.log(`  + create  ${m.tag}`);
  for (const u of unsUpdates) console.log(`  ~ update  ${u.m.tag}  (${u.fields.join(', ')})`);
  for (const t of unsDeletes) console.log(`  - delete  ${t}  ${PRUNE ? '(--prune: SẼ XOÁ)' : '(giữ lại — cần --prune để xoá)'}`);
  if (!unsCreates.length && !unsUpdates.length && !unsDeletes.length) console.log('  (không đổi)');

  const tagWrites = tagCreates.length + tagUpdates.length + (PRUNE ? tagDeletes.length : 0);

  if (!APPLY) {
    console.log('\n[DRY-RUN] Không ghi gì. Thêm --apply để thực thi.');
    await sql.end();
    process.exit(0);
  }

  // ── apply: MỘT transaction ────────────────────────────────────────────────
  await sql.begin(async (tx) => {
    for (const t of [...tagCreates, ...tagUpdates.map((u) => u.t)]) {
      await tx`
        INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", unit, scale, "offset", writable, "isEnabled", deadband, "samplingMs", "updatedAt")
        VALUES (${adapter.id}, ${t.name}, ${t.address}, ${t.datatype}, ${t.unit ?? null}, ${String(t.scale ?? 1)}, ${String(t.offset ?? 0)},
                ${t.writable}, ${t.enabled}, ${t.deadband ?? null}, ${t.sampling_ms ?? null}, NOW())
        ON CONFLICT ("adapterId", "tagKey") DO UPDATE SET
          address = EXCLUDED.address, "dataType" = EXCLUDED."dataType", unit = EXCLUDED.unit,
          scale = EXCLUDED.scale, "offset" = EXCLUDED."offset", writable = EXCLUDED.writable,
          "isEnabled" = EXCLUDED."isEnabled", deadband = EXCLUDED.deadband, "samplingMs" = EXCLUDED."samplingMs",
          "updatedAt" = NOW()`;
    }
    if (PRUNE) {
      for (const k of tagDeletes) {
        await tx`DELETE FROM device_tags WHERE "adapterId" = ${adapter.id} AND "tagKey" = ${k}`;
      }
    }

    for (const m of [...unsCreates, ...unsUpdates.map((u) => u.m)]) {
      const transform = normalizeTransform(m.transform ?? null);
      await tx`
        INSERT INTO uns_tag_mappings ("adapterId", tag, "unsTopic", "sparkplugMetric", transform, enabled, notes, "updatedAt")
        VALUES (${adapter.id}, ${m.tag}, ${m.uns_topic}, ${m.sparkplug_metric ?? null},
                ${transform === null ? null : tx.json(transform)}, ${m.enabled}, ${m.notes ?? null}, NOW())
        ON CONFLICT ("adapterId", tag) DO UPDATE SET
          "unsTopic" = EXCLUDED."unsTopic", "sparkplugMetric" = EXCLUDED."sparkplugMetric",
          transform = EXCLUDED.transform, enabled = EXCLUDED.enabled, notes = EXCLUDED.notes, "updatedAt" = NOW()`;
    }
    if (PRUNE) {
      for (const t of unsDeletes) {
        await tx`DELETE FROM uns_tag_mappings WHERE "adapterId" = ${adapter.id} AND tag = ${t}`;
      }
    }

    // metadata version (config_snapshots 'mapping_file') — cùng transaction
    const fileHash = crypto.createHash('sha256').update(stableStringify(file), 'utf8').digest('hex');
    const summary = {
      version: file.version,
      adapterCode: adapter.code,
      importedAt: new Date().toISOString(),
      importedBy: 'cli:mappings-import',
      tagCount: file.tags.length,
      mappingCount: file.uns_mappings.length,
      prune: PRUNE,
      fileHash,
    };
    await tx`
      INSERT INTO config_snapshots (entity_type, entity_id, config_hash, status, payload_summary, updated_at)
      VALUES ('mapping_file', ${adapter.id}, ${fileHash}, 'in_sync', ${tx.json(summary)}, NOW())
      ON CONFLICT (entity_type, entity_id) DO UPDATE SET
        config_hash = EXCLUDED.config_hash, status = 'in_sync',
        payload_summary = EXCLUDED.payload_summary, updated_at = NOW()`;
  });

  console.log(`\n[APPLIED] tags: +${tagCreates.length} ~${tagUpdates.length} -${PRUNE ? tagDeletes.length : 0} | uns: +${unsCreates.length} ~${unsUpdates.length} -${PRUNE ? unsDeletes.length : 0}`);
  if (tagWrites > 0) {
    console.log('[NOTE] device_tags đã đổi — adapter chỉ nhận tag-set mới ở lần (re)connect kế; restart adapter/app theo quy trình vận hành.');
  }
  console.log('[NOTE] Nếu app đang chạy: UNS mapping cache tự hết hạn khi restart; import qua UI (mappingAsCode.apply) thì cache được clear ngay.');
  await sql.end();
  process.exit(0);
} catch (e) {
  console.error('ERROR:', e.message);
  await sql.end();
  process.exit(1);
}
