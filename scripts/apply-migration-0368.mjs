#!/usr/bin/env node
/**
 * 0368 — doc 81 Đợt 8 task N fix 1 (I1): MAKER-CHECKER cho cấu hình safety-PLC thật (`safety_plc_config_trust`). Áp
 * `drizzle/0368_safety_plc_config_trust.sql` bằng owner `aoi`, rồi NGHIỆM THU bằng vai ứng dụng `avi_app` (khuôn 0363/0367).
 *
 * Phép đo sau DDL (vai avi_app, Đ-28 current_database):
 *   (a) bảng + 11 cột + khoá chính configId + khoá ngoại ON DELETE CASCADE tới safety_plc_configs + CHECK ck_safety_plc_trust_sod
 *       + chú thích bảng;
 *   (b) quyền avi_app SELECT/INSERT/UPDATE = true, DELETE/TRUNCATE = false (catalog), rồi ĐO HÀNH VI trong giao dịch LUÔN HOÀN
 *       TÁC: chèn cấu hình dò + hàng tin cậy; duyệt bởi CHÍNH người sửa cuối ⇒ 23514; duyệt bởi người khác ⇒ vào; DELETE hàng
 *       tin cậy ⇒ 42501; xoá cấu hình dò ⇒ hàng tin cậy đi theo (CASCADE) nếu avi_app có DELETE trên safety_plc_configs (đo, in
 *       ra); 0 hàng dò còn lại;
 *   (c) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0368.mjs --dev-only    # DB dev (chủ dự án quyết — TRƯỚC khi bật SAFETY_PLC_POLLER_ENABLED)
 *   node scripts/apply-migration-0368.mjs --test-only   # DB _test
 *   node scripts/apply-migration-0368.mjs --both        # cả hai — KHÔNG cờ ⇒ từ chối (R-3-g)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0368_safety_plc_config_trust.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const TAG = "[0368]";
const BANG = "safety_plc_config_trust";
const COTS = ["configId", "lastEditedBy", "lastEditedAt", "editDigest", "approvedDigest", "approvedBy", "approvedAt", "rejectedDigest", "rejectedBy", "rejectedAt", "rejectReason"];

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
    const [truoc] = await appSql`SELECT to_regclass(${"public." + BANG}) IS NOT NULL AS co`;
    console.log(`  ${TAG} ${label} TRƯỚC: bảng ${BANG} ${truoc.co ? "ĐÃ có" : "chưa có"}`);

    const content = fs.readFileSync(MIGRATION_PATH, "utf-8");
    // Khuôn 0362 (#6) — CREATE TABLE ... REFERENCES lấy khoá trên safety_plc_configs: chờ tối đa 5 s (+ trần 60 s).
    await sql`SET lock_timeout = '5s'`;
    await sql`SET statement_timeout = '60s'`;
    try {
      await sql.unsafe(content);
    } catch (e) {
      if (e?.code === "55P03") {
        throw new Error(`KHONG lay duoc khoa trong 5 s (lock_timeout, ${e.code}: ${e.message}). Chua doi gi ca. Chay lai khi vang tai.`);
      }
      if (e?.code === "57014") {
        throw new Error(`DDL ${MIGRATION_FILE} vuot qua 60 s (statement_timeout, ${e.code}). Chua doi gi ca.`);
      }
      throw e;
    }
    console.log(`${TAG} ${label}: DDL applied (owner aoi, lock_timeout 5s)`);

    // (a) bảng, cột, khoá, CHECK, chú thích
    const cols = await appSql`
      SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${BANG}`;
    const have = new Set(cols.map((r) => r.c));
    const thieu = COTS.filter((c) => !have.has(c));
    if (thieu.length) throw new Error(`(a) thieu cot: ${thieu.join(", ")}`);
    const cons = await appSql`
      SELECT conname, contype, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = ${"public." + BANG}::regclass`;
    const pk = cons.find((c) => c.contype === "p");
    const fk = cons.find((c) => c.contype === "f");
    const ck = cons.find((c) => c.conname === "ck_safety_plc_trust_sod");
    if (!pk || !/\("configId"\)/.test(pk.def)) throw new Error(`(a) khoa chinh sai: ${pk?.def}`);
    if (!fk || !/REFERENCES safety_plc_configs\(id\) ON DELETE CASCADE/.test(fk.def)) throw new Error(`(a) khoa ngoai sai: ${fk?.def}`);
    if (!ck || !/"approvedBy" <> "lastEditedBy"/.test(ck.def)) throw new Error(`(a) CHECK SoD sai: ${ck?.def}`);
    const [ct] = await appSql`SELECT obj_description(${"public." + BANG}::regclass, 'pg_class') AS c`;
    if (!ct?.c || !/Dot 8 N fix 1/.test(ct.c)) throw new Error(`(a) thieu chu thich bang`);
    console.log(`  ${TAG} ${label} (a) ${COTS.length} cột; PK ${pk.def}; FK ${fk.def}; ${ck.def}`);

    // (b) quyền — catalog (script KHÔNG cấp/thu quyền ngoài tệp SQL: chỉ đo)
    const [q] = await appSql`
      SELECT has_table_privilege(${BANG}, 'SELECT') AS sel,
             has_table_privilege(${BANG}, 'INSERT') AS ins,
             has_table_privilege(${BANG}, 'UPDATE') AS upd,
             has_table_privilege(${BANG}, 'DELETE') AS del,
             has_table_privilege(${BANG}, 'TRUNCATE') AS trunc,
             has_table_privilege('safety_plc_configs', 'DELETE') AS cfg_del`;
    if (q.sel !== true || q.ins !== true || q.upd !== true) throw new Error(`(b) quyen avi_app thieu: ${JSON.stringify(q)}`);
    if (q.del !== false || q.trunc !== false) throw new Error(`(b) avi_app KHONG duoc DELETE/TRUNCATE: ${JSON.stringify(q)}`);
    // (b) hành vi, trong giao dịch LUÔN HOÀN TÁC
    const HOAN_TAC = new Error("probe-0368-rollback");
    const CODE = `__probe_0368_${Date.now()}`;
    let kq = null;
    try {
      await appSql.begin(async (tx) => {
        const [cfg] = await tx`INSERT INTO safety_plc_configs (code, name, backend, endpoint) VALUES (${CODE}, ${CODE}, 'modbus', 'tcp://192.0.2.1:502') RETURNING id`;
        await tx`INSERT INTO ${tx(BANG)} ("configId", "lastEditedBy", "editDigest") VALUES (${cfg.id}, 101, 'd1')`;
        const tuDuyet = await maLoi(tx, (sp) => sp`UPDATE ${sp(BANG)} SET "approvedBy" = 101, "approvedDigest" = 'd1' WHERE "configId" = ${cfg.id}`);
        const nguoiKhac = await maLoi(tx, (sp) => sp`UPDATE ${sp(BANG)} SET "approvedBy" = 102, "approvedDigest" = 'd1', "approvedAt" = now() WHERE "configId" = ${cfg.id}`);
        const xoaHang = await maLoi(tx, (sp) => sp`DELETE FROM ${sp(BANG)} WHERE "configId" = ${cfg.id}`);
        let cascade = "khong do (avi_app khong co DELETE tren safety_plc_configs)";
        if (q.cfg_del) {
          await tx`DELETE FROM safety_plc_configs WHERE id = ${cfg.id}`;
          const [n] = await tx`SELECT count(*)::int AS n FROM ${tx(BANG)} WHERE "configId" = ${cfg.id}`;
          cascade = n.n === 0 ? "CASCADE ok" : `CON ${n.n} hang`;
        }
        kq = { tuDuyet, nguoiKhac, xoaHang, cascade };
        throw HOAN_TAC; // LUÔN hoàn tác
      });
    } catch (e) {
      if (e !== HOAN_TAC) throw e;
    }
    if (!kq || kq.tuDuyet !== "23514" || kq.nguoiKhac !== null || kq.xoaHang !== "42501" || /CON/.test(kq.cascade)) {
      throw new Error(`(b) hanh vi avi_app sai: ${JSON.stringify(kq)}`);
    }
    const [conLai] = await appSql`SELECT count(*)::int AS n FROM safety_plc_configs WHERE code = ${CODE}`;
    if (conLai.n !== 0) throw new Error(`(b) giao dich do KHONG hoan tac: con ${conLai.n} hang probe`);
    console.log(`  ${TAG} ${label} (b) catalog ${JSON.stringify(q)}; hành vi avi_app: ${JSON.stringify(kq)}; HOÀN TÁC`);

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

    console.log(`${TAG} ${label}: applied + verified (bảng · khoá · CHECK SoD · quyền · hành vi · sổ migration)`);
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
