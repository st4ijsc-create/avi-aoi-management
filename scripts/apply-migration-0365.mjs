#!/usr/bin/env node
/**
 * 0365 — doc 81 Đợt 4 Task D1: cột `user_settings.uiPrefs` (sở thích giao diện theo tài khoản). Áp
 * `drizzle/0365_user_settings_ui_prefs.sql` bằng owner `aoi`, rồi NGHIỆM THU bằng vai ứng dụng `avi_app`
 * (khuôn `apply-migration-0363.mjs`).
 *
 * Phép đo sau DDL (vai avi_app, Đ-28 current_database):
 *   (a) cột `uiPrefs` jsonb NOT NULL DEFAULT '{}'::jsonb; chú thích cột có mặt; CHECK `chk_user_settings_ui_prefs`
 *       (object + trần 16384 byte) có mặt và đã VALIDATED;
 *   (b) quyền avi_app: SELECT/INSERT/UPDATE bảng + UPDATE cột `uiPrefs` (đọc catalog — script KHÔNG cấp/thu quyền nào) —
 *       rồi ĐO HÀNH VI trong một giao dịch LUÔN HOÀN TÁC: chèn hàng dò (userId âm) ⇒ uiPrefs = {}; gộp `||` ⇒ giữ khoá cũ +
 *       thêm khoá mới; ghi mảng ⇒ 23514; ghi object > 16384 byte ⇒ 23514 (0 hàng dò còn lại, kể cả khi chạy lại);
 *   (c) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0365.mjs --dev-only    # DB dev (chủ dự án/Kỹ thuật tự chạy)
 *   node scripts/apply-migration-0365.mjs --test-only   # DB _test
 *   node scripts/apply-migration-0365.mjs --both        # cả hai — KHÔNG cờ ⇒ từ chối (R-3-g)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0365_user_settings_ui_prefs.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const TAG = "[0365]";
const BANG = "user_settings";
const COT = "uiPrefs";
const RANG_BUOC = "chk_user_settings_ui_prefs";
const TRAN = 16384;

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

/** Bắt mã lỗi SQLSTATE của một câu chạy trong SAVEPOINT (lỗi không làm hỏng giao dịch dò). */
async function maLoi(tx, fn) {
  try {
    await tx.savepoint(async (sp) => fn(sp));
    return null;
  } catch (e) {
    return e?.code ?? String(e?.message ?? e);
  }
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
    const [db0] = await appSql`SELECT current_database() AS d`;
    console.log(`  ${TAG} ${label} nghiệm thu: current_database()=${db0.d} vai="${vai.u}"`);
    const [truoc] = await appSql`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${BANG} AND column_name = ${COT}`;
    console.log(`  ${TAG} ${label} TRƯỚC: cột ${BANG}.${COT} ${truoc.n ? "ĐÃ có" : "chưa có"}`);

    const content = fs.readFileSync(MIGRATION_PATH, "utf-8");
    // Khuôn 0362 (#6) — ALTER TABLE lấy ACCESS EXCLUSIVE trên `user_settings` (bảng nóng: mọi lần mở trang cài đặt). Chờ
    // khoá tối đa 5 s (+ trần 60 s cho cả câu) trên CHÍNH kết nối chạy DDL (max: 1): không lấy được ⇒ DỪNG, không đổi gì.
    await sql`SET lock_timeout = '5s'`;
    await sql`SET statement_timeout = '60s'`;
    try {
      await sql.unsafe(content);
    } catch (e) {
      if (e?.code === "55P03") {
        throw new Error(
          `KHONG lay duoc khoa ${BANG} trong 5 s (lock_timeout, ${e.code}: ${e.message}) — co giao dich khac dang giu bang. ` +
            `Chua doi gi ca. Chay lai khi vang tai.`,
        );
      }
      if (e?.code === "57014") {
        throw new Error(
          `DDL ${MIGRATION_FILE} vuot qua 60 s (statement_timeout, ${e.code}: ${e.message}) — bi huy, giao dich hoan tac. ` +
            `Chua doi gi ca. Kiem tra tai DB roi chay lai.`,
        );
      }
      throw e;
    }
    console.log(`${TAG} ${label}: DDL applied (owner aoi, lock_timeout 5s)`);

    // (a) cột
    const [c] = await appSql`
      SELECT data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${BANG} AND column_name = ${COT}`;
    if (!c) throw new Error(`(a) thieu cot ${BANG}.${COT}`);
    if (c.data_type !== "jsonb") throw new Error(`(a) cot ${COT} kieu ${c.data_type} (phai la jsonb)`);
    if (c.is_nullable !== "NO") throw new Error(`(a) cot ${COT} is_nullable=${c.is_nullable} (phai la NO)`);
    if (c.column_default !== "'{}'::jsonb") throw new Error(`(a) cot ${COT} default=${c.column_default} (phai la '{}'::jsonb)`);
    console.log(`  ${TAG} ${label} (a) cột ${COT}: ${c.data_type} NULL=${c.is_nullable} DEFAULT ${c.column_default}`);
    const [chuThich] = await appSql`
      SELECT col_description(${"public." + BANG}::regclass, a.attnum) AS c
        FROM pg_attribute a WHERE a.attrelid = ${"public." + BANG}::regclass AND a.attname = ${COT}`;
    if (!chuThich?.c || !/Dot 4 Task D1/.test(chuThich.c)) throw new Error(`(a) thieu chu thich cot ${COT}`);
    const [rb] = await appSql`
      SELECT convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = ${"public." + BANG}::regclass AND conname = ${RANG_BUOC}`;
    if (!rb) throw new Error(`(a) thieu rang buoc ${RANG_BUOC}`);
    if (!rb.convalidated) throw new Error(`(a) rang buoc ${RANG_BUOC} chua VALIDATED`);
    for (const manh of ["jsonb_typeof", "'object'", "octet_length", String(TRAN)]) {
      if (!rb.def.includes(manh)) throw new Error(`(a) rang buoc ${RANG_BUOC} thieu "${manh}": ${rb.def}`);
    }
    console.log(`  ${TAG} ${label} (a) ràng buộc ${RANG_BUOC}: ${rb.def}`);

    // (b) quyền — catalog (script KHÔNG cấp/thu quyền: chỉ đo)
    const [q] = await appSql`
      SELECT has_table_privilege(${BANG}, 'SELECT') AS sel,
             has_table_privilege(${BANG}, 'INSERT') AS ins,
             has_table_privilege(${BANG}, 'UPDATE') AS upd,
             has_column_privilege(${BANG}, ${COT}, 'UPDATE') AS upd_cot,
             has_column_privilege(${BANG}, ${COT}, 'INSERT') AS ins_cot`;
    for (const [k, v] of Object.entries(q)) {
      if (v !== true) throw new Error(`(b) quyen avi_app ${k}=${v} (phai la true)`);
    }
    console.log(`  ${TAG} ${label} (b) catalog avi_app: ${JSON.stringify(q)}`);

    // (b) hành vi, trong giao dịch LUÔN HOÀN TÁC
    const HOAN_TAC = new Error("probe-0365-rollback");
    const DO = -365;
    let kq = null;
    try {
      await appSql.begin(async (tx) => {
        const [mot] = await tx`INSERT INTO ${tx(BANG)} ("userId") VALUES (${DO}) RETURNING "uiPrefs" AS p`;
        await tx`UPDATE ${tx(BANG)} SET "uiPrefs" = "uiPrefs" || '{"showLabs": true}'::jsonb WHERE "userId" = ${DO}`;
        const [gop] = await tx`
          UPDATE ${tx(BANG)} SET "uiPrefs" = "uiPrefs" || '{"layoutKit:probe:u1:bottomCollapsed": false}'::jsonb
           WHERE "userId" = ${DO} RETURNING "uiPrefs" AS p`;
        const mang = await maLoi(tx, (sp) => sp`UPDATE ${sp(BANG)} SET "uiPrefs" = '[]'::jsonb WHERE "userId" = ${DO}`);
        const lon = await maLoi(tx, (sp) => sp`
          UPDATE ${sp(BANG)} SET "uiPrefs" = jsonb_build_object('x', repeat('a', ${TRAN})) WHERE "userId" = ${DO}`);
        kq = { macDinh: mot.p, gop: gop.p, mang, lon };
        throw HOAN_TAC; // LUÔN hoàn tác
      });
    } catch (e) {
      if (e !== HOAN_TAC) throw e;
    }
    const dung =
      kq &&
      JSON.stringify(kq.macDinh) === "{}" &&
      kq.gop?.showLabs === true &&
      kq.gop?.["layoutKit:probe:u1:bottomCollapsed"] === false &&
      kq.mang === "23514" &&
      kq.lon === "23514";
    if (!dung) throw new Error(`(b) hanh vi avi_app sai: ${JSON.stringify(kq)}`);
    const [conLai] = await appSql`SELECT count(*)::int AS n FROM ${appSql(BANG)} WHERE "userId" = ${DO}`;
    if (conLai.n !== 0) throw new Error(`(b) giao dich do KHONG hoan tac: con ${conLai.n} hang probe`);
    console.log(`  ${TAG} ${label} (b) hành vi avi_app: ${JSON.stringify(kq)} — trong giao dịch HOÀN TÁC (0 hàng dò còn lại)`);

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

    console.log(`${TAG} ${label}: applied + verified (cột · ràng buộc · quyền · sổ migration)`);
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
    console.error(`${TAG} ${label} FAILED:`, e?.message ?? e);
  }
}
process.exit(failed ? 1 : 0);
