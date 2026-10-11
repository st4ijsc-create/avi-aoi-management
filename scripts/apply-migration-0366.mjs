#!/usr/bin/env node
/**
 * 0366 — doc 81 Đợt 7 task K4: quyền MAINTAIN của `avi_app` trên hai materialized view QW3
 * (`machine_status_latest`, `hourly_yield_cache`) để `refresh_qw_caches()` chạy được bằng vai ứng dụng. Áp
 * `drizzle/0366_qw_matview_maintain_grant.sql` bằng owner `aoi`, rồi NGHIỆM THU bằng vai ứng dụng `avi_app`
 * (khuôn `apply-migration-0363.mjs` / `0365`).
 *
 * Phép đo (vai avi_app, Đ-28 current_database):
 *   TRƯỚC: MAINTAIN của avi_app trên hai view (dev 2026-10-11: false/false ⇒ 42501 mỗi chu kỳ);
 *   (a) sau GRANT: has_table_privilege(…, 'MAINTAIN') = true trên CẢ HAI view; avi_app KHÔNG là thành viên owner,
 *       KHÔNG thuộc `pg_maintain`, không superuser (quyền HẸP — không phủ bảng khác);
 *   (b) HÀNH VI: `SELECT refresh_qw_caches()` bằng avi_app chạy xong (statement_timeout 120 s) — đây chính là việc
 *       server làm mỗi 5 phút (REFRESH … CONCURRENTLY, đọc vẫn chạy trong lúc làm mới); và avi_app vẫn KHÔNG ALTER được
 *       view (42501, trong SAVEPOINT của giao dịch LUÔN hoàn tác);
 *   (c) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0366.mjs --dev-only    # DB dev (chủ dự án/Kỹ thuật tự chạy)
 *   node scripts/apply-migration-0366.mjs --test-only   # DB _test
 *   node scripts/apply-migration-0366.mjs --both        # cả hai — KHÔNG cờ ⇒ từ chối (R-3-g)
 *
 * Không in URL, mật khẩu hay giá trị .env nào.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0366_qw_matview_maintain_grant.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const TAG = "[0366]";
const VIEWS = ["hourly_yield_cache", "machine_status_latest"];

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

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/** `avi_app` không có quyền GRANT trên view của `aoi` — ép sang owner `aoi`. */
function asOwner(url) {
  if (process.env.MIGRATION_DB_URL) return process.env.MIGRATION_DB_URL;
  const u = new URL(url);
  u.username = process.env.MIGRATION_DB_USER ?? "aoi";
  u.password = process.env.MIGRATION_DB_PASSWORD ?? "aoi";
  return u.toString();
}

/** Lỗi không bao giờ mang URL kết nối ra log. */
function sach(msg) {
  return String(msg).replace(/postgres(ql)?:\/\/\S+/g, "<url>");
}

async function quyenMaintain(appSql) {
  const r = await appSql`
    SELECT c.relname, has_table_privilege(c.oid, 'MAINTAIN') AS m
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'm' AND c.relname IN ${appSql(VIEWS)}
     ORDER BY 1`;
  return Object.fromEntries(r.map((x) => [x.relname, x.m]));
}

async function applyTo(rawUrl, label) {
  const sql = postgres(asOwner(rawUrl), { max: 1, onnotice: (n) => console.log(`  ${TAG} ${label} NOTICE: ${n.message}`) });
  const appSql = postgres(rawUrl, { max: 1, onnotice: () => {} });
  try {
    const [vai] = await appSql`
      SELECT current_user AS u, r.rolsuper, r.rolbypassrls
      FROM pg_roles r WHERE r.rolname = current_user`;
    if (vai.rolsuper || vai.rolbypassrls) {
      throw new Error(`nghiem thu VO NGHIA: vai "${vai.u}" co dac quyen => phai do bang avi_app.`);
    }
    const [db0] = await appSql`SELECT current_database() AS d, current_setting('server_version_num')::int AS v`;
    console.log(`  ${TAG} ${label} nghiệm thu: current_database()=${db0.d} vai="${vai.u}" server_version_num=${db0.v}`);
    // Fix round 1 (review #2): check the version FIRST — on PG < 17 `has_table_privilege(…, 'MAINTAIN')` below would throw
    // a generic "unrecognized privilege type" before the migration's own message is reached.
    if (!(Number(db0.v) >= 170000)) {
      throw new Error(`needs PostgreSQL 17+ (MAINTAIN privilege); server_version_num=${db0.v} - nothing changed`);
    }
    const truoc = await quyenMaintain(appSql);
    console.log(`  ${TAG} ${label} TRƯỚC: MAINTAIN ${JSON.stringify(truoc)}`);
    if (Object.keys(truoc).length !== VIEWS.length) {
      throw new Error(`thieu materialized view: thay ${JSON.stringify(Object.keys(truoc))} (can ${VIEWS.join(", ")}; ap 0111/0174 truoc)`);
    }

    const content = fs.readFileSync(MIGRATION_PATH, "utf-8");
    await sql`SET lock_timeout = '5s'`;
    await sql`SET statement_timeout = '60s'`;
    try {
      await sql.unsafe(content);
    } catch (e) {
      if (e?.code === "55P03") {
        throw new Error(`KHONG lay duoc khoa trong 5 s (lock_timeout, ${e.code}). Chua doi gi ca. Chay lai khi vang tai.`);
      }
      throw e;
    }
    console.log(`${TAG} ${label}: GRANT applied (owner aoi, lock_timeout 5s)`);

    // (a) quyền — catalog, đo bằng avi_app
    const sau = await quyenMaintain(appSql);
    for (const v of VIEWS) {
      if (sau[v] !== true) throw new Error(`(a) avi_app thieu MAINTAIN tren ${v}: ${JSON.stringify(sau)}`);
    }
    const [hep] = await appSql`
      SELECT pg_has_role(current_user, 'pg_maintain', 'MEMBER') AS pg_maintain,
             (SELECT bool_or(pg_has_role(current_user, c.relowner, 'MEMBER')) FROM pg_class c
               WHERE c.relname IN ${appSql(VIEWS)}) AS owner_member`;
    if (hep.pg_maintain || hep.owner_member) throw new Error(`(a) quyen KHONG hep: ${JSON.stringify(hep)}`);
    console.log(`  ${TAG} ${label} (a) MAINTAIN ${JSON.stringify(sau)}; pg_maintain=${hep.pg_maintain} owner_member=${hep.owner_member}`);

    // (b) hành vi: refresh bằng avi_app; ALTER vẫn bị từ chối (giao dịch LUÔN hoàn tác)
    const t0 = Date.now();
    await appSql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '120s'`;
      await tx`SELECT refresh_qw_caches()`;
    });
    console.log(`  ${TAG} ${label} (b) refresh_qw_caches() bằng avi_app: OK trong ${Date.now() - t0} ms`);
    const HOAN_TAC = new Error("probe-0366-rollback");
    let alterCode = null;
    try {
      await appSql.begin(async (tx) => {
        await tx`SET LOCAL lock_timeout = '5s'`;
        try {
          await tx.savepoint((sp) => sp`ALTER MATERIALIZED VIEW machine_status_latest SET (fillfactor = 100)`);
          alterCode = "ALLOWED";
        } catch (e) {
          alterCode = e?.code ?? sach(e?.message ?? e);
        }
        throw HOAN_TAC; // LUÔN hoàn tác
      });
    } catch (e) {
      if (e !== HOAN_TAC) throw e;
    }
    if (alterCode !== "42501") throw new Error(`(b) avi_app ALTER view phai bi tu choi 42501, nhan ${alterCode}`);
    console.log(`  ${TAG} ${label} (b) ALTER MATERIALIZED VIEW bằng avi_app ⇒ ${alterCode} (vẫn chỉ owner)`);

    // (c)
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
    const [rows] = await sql`SELECT count(*)::int AS n FROM "__applied_migrations" WHERE filename = ${MIGRATION_FILE}`;
    if (rows.n !== 1) throw new Error(`__applied_migrations co ${rows.n} hang (phai la 1)`);

    console.log(`${TAG} ${label}: applied + verified (MAINTAIN hẹp · refresh bằng avi_app · ALTER vẫn bị từ chối · sổ migration)`);
  } finally {
    await sql.end();
    await appSql.end();
  }
}

const args = process.argv.slice(2);
// R-3-g — PHẢI chỉ rõ ĐÚNG MỘT đích. Không cờ ⇒ TỪ CHỐI, không mở kết nối nào.
const CO_DICH = ["--dev-only", "--test-only", "--both"].filter((f) => args.includes(f));
if (CO_DICH.length !== 1) {
  console.error(`${TAG} phai chi ro DUNG MOT dich: --dev-only | --test-only | --both (nhan: ${CO_DICH.join(" ") || "khong co"}). Khong chay gi.`);
  process.exit(2);
}
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error(`${TAG} DATABASE_URL not set`);
  process.exit(1);
}
const targets = [];
if (!args.includes("--test-only")) targets.push([devUrl, "dev"]);
if (!args.includes("--dev-only")) {
  let testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    const u = new URL(devUrl);
    u.pathname = "/" + u.pathname.replace(/^\//, "") + "_test";
    testUrl = u.toString();
  }
  targets.push([testUrl, "test"]);
}
let failed = false;
for (const [url, label] of targets) {
  try {
    await applyTo(url, label);
  } catch (e) {
    failed = true;
    console.error(`${TAG} ${label} FAILED:`, sach(e?.message ?? e));
  }
}
process.exit(failed ? 1 : 0);
