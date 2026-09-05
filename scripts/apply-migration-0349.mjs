#!/usr/bin/env node
/**
 * 0349 — Lô 10 Mục 1 (BG-93). `audit_logs` → hypertable (PK ghép id+"createdAt",
 * theo tiền lệ `drizzle/0172_inspection_hypertables.sql`) + retention policy 365
 * ngày (docblock đầy đủ trong `drizzle/0349_audit_logs_hypertable_retention.sql`).
 *
 * ⚠⚠ DDL PHẢI chạy bằng owner `aoi` (`avi_app` bị 42501). Script tự ĐỔI user
 * trong DATABASE_URL sang `aoi` trừ khi có MIGRATION_DB_URL/MIGRATION_DB_USER
 * đè lên — cùng khuôn `scripts/apply-migration-0338.mjs`/`0347.mjs`/`0348.mjs`.
 *
 * ⚠⚠ CẦU CHÌ NGHIỆM THU (tái dùng nguyên văn `apply-migration-0338.mjs:74-84`):
 * đọc `rolsuper`/`rolbypassrls` của vai nghiệm thu và **TỪ CHỐI CHẠY** nếu đó là
 * superuser — `aoi` bỏ qua mọi kiểm tra quyền nên một phép đo bằng nó là XANH GIẢ.
 *
 * ⚠ Migration này **KHÔNG có một câu DELETE/UPDATE nào** trên dữ liệu audit_logs
 * — chỉ ALTER PK + create_hypertable(migrate_data=>true, chuyển hàng NGUYÊN VẸN
 * vào chunk) + add_retention_policy (drop CẢ CHUNK quá hạn qua worker nền, không
 * phải DELETE hàng bằng vai ứng dụng). Tái-chạy-được (BG-95): nhánh rewrite PK +
 * create_hypertable chỉ chạy khi CHƯA là hypertable; add_retention_policy dùng
 * if_not_exists.
 *
 *   node scripts/apply-migration-0349.mjs            # dev + test
 *   node scripts/apply-migration-0349.mjs --dev-only
 *   node scripts/apply-migration-0349.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0349_audit_logs_hypertable_retention.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const RETENTION_DAYS = 365;

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

/** `avi_app` không có quyền DDL (42501) — ép sang owner `aoi`. */
function asOwner(url) {
  if (process.env.MIGRATION_DB_URL) return process.env.MIGRATION_DB_URL;
  const u = new URL(url);
  u.username = process.env.MIGRATION_DB_USER ?? "aoi";
  u.password = process.env.MIGRATION_DB_PASSWORD ?? "aoi";
  return u.toString();
}

async function grantsSnapshot(appSql) {
  const rows = await appSql`
    SELECT grantee, privilege_type FROM information_schema.role_table_grants
     WHERE table_name = 'audit_logs' AND grantee = 'avi_app'
     ORDER BY privilege_type`;
  return rows.map((r) => r.privilege_type).sort().join(",");
}

async function applyTo(rawUrl, label) {
  const ownerUrl = asOwner(rawUrl);
  const sql = postgres(ownerUrl, { max: 1, onnotice: (n) => console.log(`  [0349] ${label} NOTICE: ${n.message}`) });
  const appSql = postgres(rawUrl, { max: 1, onnotice: () => {} });
  try {
    // ── 0) CẦU CHÌ: vai nghiệm thu phải là vai ỨNG DỤNG, không phải superuser.
    const [vai] = await appSql`
      SELECT current_user AS u, r.rolsuper, r.rolbypassrls
      FROM pg_roles r WHERE r.rolname = current_user`;
    if (vai.rolsuper || vai.rolbypassrls) {
      throw new Error(
        `nghiem thu VO NGHIA: vai "${vai.u}" co rolsuper=${vai.rolsuper} rolbypassrls=${vai.rolbypassrls} ` +
        `=> khong the do quyen bang vai nay. Phai do bang vai ung dung khong dac quyen (avi_app).`,
      );
    }
    const [db0] = await appSql`SELECT current_database() AS d`;
    console.log(`  [0349] ${label} nghiệm thu: current_database()=${db0.d} vai="${vai.u}" (rolsuper=${vai.rolsuper}, rolbypassrls=${vai.rolbypassrls})`);

    // ── 1) ĐO TRƯỚC (Đ-28, vai avi_app) ────────────────────────────────────
    const isHyperTruoc = await appSql`
      SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'audit_logs'`;
    const [soHangTruoc] = await appSql`SELECT count(*)::int AS n FROM audit_logs`;
    const grantsTruoc = await grantsSnapshot(appSql);
    const consTruoc = await appSql`
      SELECT con.conname, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname = 'audit_logs' AND con.contype = 'p'`;
    console.log(`  [0349] ${label} TRƯỚC: da_la_hypertable=${isHyperTruoc.length > 0} tong_hang=${soHangTruoc.n} pk=${JSON.stringify(consTruoc)} grants_avi_app=[${grantsTruoc}]`);

    const content = fs.readFileSync(MIGRATION_PATH, "utf8");
    await sql.unsafe(content);
    console.log(`[0349] ${label}: DDL applied (owner aoi)`);

    // ── 2) ĐO SAU — hypertable + policy + PK ghép (Đ-28, vai avi_app) ──────
    const isHyperSau = await appSql`
      SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name = 'audit_logs'`;
    if (isHyperSau.length !== 1) {
      throw new Error(`verification failed (${label}): audit_logs KHONG xuat hien trong timescaledb_information.hypertables (rows=${isHyperSau.length})`);
    }
    console.log(`  [0349] ${label} (a) timescaledb_information.hypertables: audit_logs OK`);

    const jobs = await appSql`
      SELECT job_id, proc_name, config FROM timescaledb_information.jobs
       WHERE hypertable_name = 'audit_logs' AND proc_name = 'policy_retention'`;
    if (jobs.length !== 1) {
      throw new Error(`verification failed (${label}): so job retention cho audit_logs = ${jobs.length} (phai la 1)`);
    }
    const dropAfter = jobs[0].config?.drop_after;
    if (dropAfter !== `${RETENTION_DAYS} days`) {
      throw new Error(`verification failed (${label}): retention drop_after="${dropAfter}" (phai la "${RETENTION_DAYS} days")`);
    }
    console.log(`  [0349] ${label} (b) timescaledb_information.jobs: policy_retention drop_after="${dropAfter}" OK`);

    const consSau = await appSql`
      SELECT con.conname, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname = 'audit_logs' AND con.contype = 'p'`;
    const pkDefSau = consSau[0]?.def ?? "";
    if (!/PRIMARY KEY \(id, "?createdAt"?\)/.test(pkDefSau)) {
      throw new Error(`verification failed (${label}): PK sau migration = "${pkDefSau}" (phai la PRIMARY KEY (id, "createdAt"))`);
    }
    console.log(`  [0349] ${label} (c) PK ghép: ${pkDefSau} OK`);

    // ── 3) Grants avi_app KHÔNG đổi (Đ-28 so trước/sau) ─────────────────────
    const grantsSau = await grantsSnapshot(appSql);
    if (grantsSau !== grantsTruoc) {
      throw new Error(`verification failed (${label}): grants avi_app doi "${grantsTruoc}" -> "${grantsSau}" (phai Y NGUYEN)`);
    }
    console.log(`  [0349] ${label} (d) grants avi_app KHONG doi: [${grantsSau}] OK`);

    // ── 4) WORM âm tính — vai avi_app: INSERT OK, DELETE 42501 (ca that) ────
    const [probe] = await appSql`
      INSERT INTO audit_logs ("action", "status", "details")
      VALUES ('PROBE-0349', 'success', 'probe Lo 10 Muc 1 - se bi xoa qua DELETE that bai (WORM)')
      RETURNING id`;
    if (!probe?.id) throw new Error(`verification failed (${label}): INSERT probe khong tra id`);
    let deleteDenied = false;
    let deleteErr = null;
    try {
      await appSql`DELETE FROM audit_logs WHERE id = ${probe.id}`;
    } catch (e) {
      deleteDenied = true;
      deleteErr = e;
    }
    if (!deleteDenied) {
      throw new Error(`verification failed (${label}): DELETE FROM audit_logs (vai avi_app) THANH CONG — WORM VO HIEU sau migration nay!`);
    }
    if (deleteErr.code !== "42501") {
      throw new Error(`verification failed (${label}): DELETE bi tu choi nhung code="${deleteErr.code}" (phai la 42501 permission denied), message="${deleteErr.message}"`);
    }
    console.log(`  [0349] ${label} (e) WORM am tinh: avi_app INSERT probe id=${probe.id} OK, DELETE 42501 (${deleteErr.message}) OK — hang probe con lai trong bang (khong xoa duoc bang thiet ke)`);

    // ── 5) KHÔNG mất dữ liệu: tổng hàng SAU = TRƯỚC + 1 (probe INSERT ở bước 4). ─
    const [soHangSau] = await appSql`SELECT count(*)::int AS n FROM audit_logs`;
    if (soHangSau.n !== soHangTruoc.n + 1) {
      throw new Error(`verification failed (${label}): audit_logs ${soHangTruoc.n} -> ${soHangSau.n} (phai la +1 dung 1 hang probe, khong mat/them hang nao khac)`);
    }
    console.log(`  [0349] ${label} (f) tong hang: ${soHangTruoc.n} -> ${soHangSau.n} (+1 probe, khong mat du lieu goc)`);

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
    if (rows.n !== 1) throw new Error(`__applied_migrations co ${rows.n} hang cho ${MIGRATION_FILE} (phai la 1)`);

    console.log(`[0349] ${label}: applied + verified (6 phép đo: hypertable, policy 365d, PK ghép, grants bất biến, WORM âm tính, tổng hàng)`);
  } finally {
    await sql.end();
    await appSql.end();
  }
}

const args = process.argv.slice(2);
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error("[0349] DATABASE_URL not set (checked .env)");
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

let failed = false;
for (const [url, label] of targets) {
  try {
    await applyTo(url, label);
  } catch (e) {
    failed = true;
    console.error(`[0349] ${label} FAILED:`, e?.message ?? e);
  }
}
process.exit(failed ? 1 : 0);
