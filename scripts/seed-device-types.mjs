#!/usr/bin/env node
// scripts/seed-device-types.mjs — Doc 56 Đ0 việc 8: seed device_types đủ 24 leaf +
// cây cha, rồi backfill machines.device_type_key cho máy cũ.
//
// NGUỒN SỰ THẬT DUY NHẤT: buildSeedTypes() (server/services/standards/
// deviceTypeRegistry.ts — sinh từ capabilityModel DEFAULT_PROFILES). Script này
// KHÔNG fork dữ liệu: nó nạp tsx loader (pattern scripts/backfill-component-codes.mjs)
// và import thẳng module TypeScript đó, nên thêm/đổi profile chỉ cần sửa MỘT nơi.
//
// HÀNH VI:
//   1. UPSERT từng node seed vào device_types theo unique (typeKey, version)
//      [uq_devtype_key_version], origin='seed'. Idempotent: chạy lại bao nhiêu lần
//      cũng hội tụ về đúng nội dung seed. Row trùng key do CON NGƯỜI publish
//      (origin='manual') KHÔNG BAO GIỜ bị ghi đè (guard WHERE origin='seed') —
//      đồng thời chữa các row demo sai vocabulary (vd adapterKind 'aoi'→'vision')
//      vì chúng mang origin='seed'.
//   2. Backfill machines."device_type_key" IS NULL: resolve machineType → typeKey
//      leaf published mới nhất (resolveDeviceTypeKeyForMachineType — ưu tiên row
//      DB đã publish, fallback seed; KHÔNG fallback 'Equipment').
//
// CHẠY:  node scripts/seed-device-types.mjs        (yêu cầu DATABASE_URL trong .env)
// Migration 0287 phải được áp TRƯỚC (cột machines.device_type_key). Không có cờ —
// dữ liệu seed là additive; máy đã có device_type_key không bị đổi.
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { register } from "tsx/esm/api";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = (...a) => console.log("[seed-devtypes]", ...a);

// ── .env loader (same minimal parser as the migration runners) ───────────────
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.substring(0, idx).trim();
    let value = trimmed.substring(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(path.join(__dirname, "..", ".env"));

if (!process.env.DATABASE_URL) {
  console.error("[seed-devtypes] DATABASE_URL not set (checked .env)");
  process.exit(1);
}

// ── import the REAL TS registry via the tsx loader (no duplicated tree) ──────
register();
const registryUrl = pathToFileURL(
  path.join(__dirname, "..", "server", "services", "standards", "deviceTypeRegistry.ts"),
).href;
const { buildSeedTypes, resolveDeviceTypeKeyForMachineType } = await import(registryUrl);

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const jb = (v) => sql.json(v);

try {
  const nodes = buildSeedTypes();
  const leaves = nodes.filter((n) => (n.mappedMachineTypes ?? []).length > 0);
  log(`seed tree: ${nodes.length} node (${leaves.length} leaf + ${nodes.length - leaves.length} cha), version 1.0.0, origin='seed'`);

  // ── 1. UPSERT device_types (idempotent theo uq_devtype_key_version) ────────
  let inserted = 0, updated = 0, kept = 0;
  for (const n of nodes) {
    const publishedAt = n.status === "published" ? new Date() : null;
    const rows = await sql`
      INSERT INTO device_types
        ("typeKey","parentTypeKey",version,status,label,description,
         "attributesSchema","supportedCommands","supportedStates","extensionFields",
         "mappedMachineTypes","adapterKind",origin,"publishedAt")
      VALUES
        (${n.typeKey},${n.parentTypeKey},${n.version},${n.status},${n.label ?? null},${n.description ?? null},
         ${jb(n.attributesSchema ?? [])},${jb(n.supportedCommands ?? [])},${jb(n.supportedStates ?? [])},${jb(n.extensionFields ?? {})},
         ${jb(n.mappedMachineTypes ?? [])},${n.adapterKind ?? null},'seed',${publishedAt})
      ON CONFLICT ("typeKey", version) DO UPDATE SET
        "parentTypeKey" = EXCLUDED."parentTypeKey",
        status = EXCLUDED.status,
        label = EXCLUDED.label,
        description = EXCLUDED.description,
        "attributesSchema" = EXCLUDED."attributesSchema",
        "supportedCommands" = EXCLUDED."supportedCommands",
        "supportedStates" = EXCLUDED."supportedStates",
        "extensionFields" = EXCLUDED."extensionFields",
        "mappedMachineTypes" = EXCLUDED."mappedMachineTypes",
        "adapterKind" = EXCLUDED."adapterKind",
        "publishedAt" = COALESCE(device_types."publishedAt", EXCLUDED."publishedAt"),
        "updatedAt" = now()
      WHERE device_types.origin = 'seed'
      RETURNING (xmax = 0) AS is_insert`;
    if (rows.length === 0) kept++; // manual row holds the key — never clobbered
    else if (rows[0].is_insert) inserted++;
    else updated++;
  }
  log(`device_types: +${inserted} insert, ~${updated} update (hội tụ về seed), ${kept} giữ nguyên (origin manual)`);

  // ── 2. Backfill machines.device_type_key (chỉ row NULL — không đổi máy đã stamp) ──
  // Resolve trên [seed ∪ DB rows] như loadDeviceTypeNodes: type do người publish
  // (origin manual, newest published) thắng leaf seed nếu map cùng machineType.
  const dbRows = await sql`
    SELECT "typeKey", "parentTypeKey", version, status, "mappedMachineTypes"
    FROM device_types`;
  const resolveNodes = [
    ...nodes,
    ...dbRows.map((r) => ({
      typeKey: r.typeKey,
      parentTypeKey: r.parentTypeKey ?? null,
      version: r.version ?? "1.0.0",
      status: r.status ?? "draft",
      attributesSchema: [],
      supportedCommands: [],
      supportedStates: [],
      extensionFields: {},
      mappedMachineTypes: r.mappedMachineTypes ?? [],
    })),
  ];

  const missing = await sql`
    SELECT DISTINCT "machineType" FROM machines WHERE "device_type_key" IS NULL`;
  let backfilled = 0, unresolved = [];
  for (const { machineType } of missing) {
    const key = resolveDeviceTypeKeyForMachineType(machineType, resolveNodes);
    if (!key) { unresolved.push(machineType); continue; }
    const res = await sql`
      UPDATE machines SET "device_type_key" = ${key}
      WHERE "machineType" = ${machineType} AND "device_type_key" IS NULL`;
    backfilled += res.count;
    log(`backfill ${machineType} → '${key}': ${res.count} máy`);
  }
  if (unresolved.length) log(`⚠️ không resolve được typeKey cho: ${unresolved.join(", ")} (giữ NULL)`);
  log(`✅ HOÀN TẤT: device_types ${inserted + updated}/${nodes.length} row seed, machines backfill ${backfilled} row.`);
} catch (e) {
  console.error("[seed-devtypes] LỖI:", e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
