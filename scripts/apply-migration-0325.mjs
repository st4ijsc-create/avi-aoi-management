#!/usr/bin/env node
/**
 * Áp `drizzle/0325_api_keys_tenant_scope.sql` lên CSDL dev (DATABASE_URL trong .env) VÀ CSDL
 * test đã nhân bản (`<db>_test`), ghi tên file vào `__applied_migrations` y hệt migrate-standalone
 * để `npm run db:push` sau này không chạy lại.
 *
 * ⚠ DDL PHẢI chạy bằng OWNER `aoi`. `.env` trỏ `DATABASE_URL` vào `avi_app` (doc48 R1 WORM) —
 *   vai đó chỉ có DML nên `ALTER TABLE` sẽ 42501 permission denied. Script THAY vai trong chuỗi
 *   kết nối bằng `MIGRATION_DB_USER`/`MIGRATION_DB_PASSWORD` (mặc định `aoi`/`aoi`), giữ nguyên
 *   host/port/tên CSDL lấy từ `.env` — không URL nào bị viết cứng.
 *
 *   node scripts/apply-migration-0325.mjs            # dev + test
 *   node scripts/apply-migration-0325.mjs --dev-only
 *   node scripts/apply-migration-0325.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0325_api_keys_tenant_scope.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);

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

/** checksum giống hệt simpleHash của migrate-standalone. */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/** Đổi vai sang owner DDL, giữ nguyên host/port/db. */
function asOwner(url) {
  const u = new URL(url);
  u.username = process.env.MIGRATION_DB_USER || "aoi";
  u.password = process.env.MIGRATION_DB_PASSWORD || "aoi";
  return u.toString();
}

async function applyTo(url, label) {
  const sql = postgres(asOwner(url), { max: 1, onnotice: () => {} });
  try {
    const content = fs.readFileSync(MIGRATION_PATH, "utf8");
    await sql.unsafe(content);

    // ── Nghiệm thu artefact ──────────────────────────────────────────────────
    // 1) Ba cột tồn tại và PHẢI còn NULLable — trạng thái "CHƯA KHAI" chính là NULL,
    //    một cột NOT NULL/DEFAULT sẽ xoá mất trạng thái thứ ba.
    const cols = await sql`
      SELECT column_name, is_nullable, column_default, character_maximum_length AS len
        FROM information_schema.columns
       WHERE table_name = 'api_keys'
         AND column_name IN ('dataScopeMode', 'corporateCode', 'factoryCode')`;
    if (cols.length !== 3) throw new Error(`verification failed: expected 3 scope columns, got ${cols.length}`);
    for (const c of cols) {
      if (c.is_nullable !== "YES") throw new Error(`verification failed: ${c.column_name} must stay NULLable`);
      if (c.column_default !== null) throw new Error(`verification failed: ${c.column_name} must have NO default`);
    }

    // 2) Ràng buộc CHECK có mặt VÀ thực sự chặn — thử ghi một hàng lệch trong
    //    transaction rồi cuộn lại. "Có tên trong pg_constraint" chưa chứng minh nó cưỡng chế.
    const [chk] = await sql`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'api_keys_data_scope_mode_chk'`;
    if (chk.n !== 1) throw new Error("verification failed: api_keys_data_scope_mode_chk missing");
    //    ⚠ Thử BỐN hình dạng lệch, không phải một. Bản đầu của ràng buộc này chỉ chặn được
    //    hình dạng ①: ba hình còn lại LỌT vì logic ba giá trị của SQL (xem chú thích trong
    //    file .sql). Một phép nghiệm thu chỉ thử một hình dạng sẽ khai XANH cho một ràng buộc
    //    thủng ba lỗ.
    const badRows = [
      ["① ('factory', NULL, NULL)", `'factory', NULL, NULL`],
      ["② (NULL, mã, NULL)", `NULL, 'PROBE_CORP', NULL`],
      ["③ ('global', NULL, mã)", `'global', NULL, 'PROBE_FAC'`],
      ["④ ('GLOBAL', NULL, NULL) — mode lạ", `'GLOBAL', NULL, NULL`],
    ];
    for (const [label, values] of badRows) {
      let rejected = false;
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(
            `INSERT INTO api_keys (name, "keyHash", scopes, "isActive", "dataScopeMode", "corporateCode", "factoryCode")
             VALUES ('__0325_probe__', '__0325_probe__', '["bi:read"]'::json, false, ${values})`,
          );
          throw new Error("__rollback__");
        });
      } catch (err) {
        if (/api_keys_data_scope_mode_chk/.test(String(err?.message))) rejected = true;
        else if (!/__rollback__/.test(String(err?.message))) throw err;
      }
      if (!rejected) throw new Error(`verification failed: CHECK did not reject ${label}`);
    }
    const [probe] = await sql`SELECT count(*)::int AS n FROM api_keys WHERE name = '__0325_probe__'`;
    if (probe.n !== 0) throw new Error("verification failed: probe row leaked (rollback did not happen)");

    // 3) Phân bố trạng thái sau khi áp (mọi hàng cũ phải là CHƯA KHAI).
    const [dist] = await sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE "dataScopeMode" IS NULL)::int      AS undeclared,
             count(*) FILTER (WHERE "dataScopeMode" = 'factory')::int  AS factory,
             count(*) FILTER (WHERE "dataScopeMode" = 'global')::int   AS global
        FROM api_keys`;

    await sql`
      CREATE TABLE IF NOT EXISTS "__applied_migrations" (
        "id" SERIAL PRIMARY KEY,
        "filename" VARCHAR(500) NOT NULL UNIQUE,
        "applied_at" TIMESTAMP DEFAULT NOW(),
        "checksum" VARCHAR(64),
        "success" BOOLEAN DEFAULT true
      )`;
    const checksum = simpleHash(content);
    await sql`
      INSERT INTO "__applied_migrations" (filename, checksum, success)
      VALUES (${MIGRATION_FILE}, ${checksum}, true)
      ON CONFLICT (filename) DO UPDATE SET applied_at = NOW(), checksum = ${checksum}, success = true`;
    const [tracked] = await sql`SELECT count(*)::int AS n FROM "__applied_migrations" WHERE filename = ${MIGRATION_FILE}`;

    console.log(
      `[0325] ${label}: applied + verified — 3 cột NULLable/no-default; CHECK cưỡng chế thật; ` +
      `api_keys total=${dist.total} (chưa khai=${dist.undeclared}, factory=${dist.factory}, global=${dist.global}); ` +
      `__applied_migrations rows for this file=${tracked.n}`,
    );
  } finally {
    await sql.end();
  }
}

const args = process.argv.slice(2);
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error("[0325] DATABASE_URL not set (checked .env)");
  process.exit(1);
}

const targets = [];
if (!args.includes("--test-only")) targets.push([devUrl, "dev"]);
if (!args.includes("--dev-only")) {
  let testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    const u = new URL(devUrl);
    const devName = u.pathname.replace(/^\//, "");
    u.pathname = "/" + devName + "_test";
    testUrl = u.toString();
  }
  targets.push([testUrl, "test"]);
}

for (const [url, label] of targets) {
  try {
    await applyTo(url, label);
  } catch (err) {
    if (label === "test" && /does not exist/i.test(String(err?.message))) {
      console.warn(`[0325] ${label}: database not found — run \`node scripts/setup-test-db.mjs\` first.`);
    } else {
      console.error(`[0325] ${label}: FAILED —`, err?.message ?? err);
      process.exitCode = 1;
    }
  }
}
