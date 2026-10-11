#!/usr/bin/env node
/**
 * 0367 — doc 81 Đợt 7 task I fix 1: ref quy trình theo KHÔNG GIAN PHẠM VI (`orchestration_workflows.scopeKey`, duy nhất theo
 * (ref, scopeKey)). Áp `drizzle/0367_orchestration_workflow_ref_scope.sql` bằng owner `aoi`, rồi NGHIỆM THU bằng vai ứng dụng
 * `avi_app` (khuôn `apply-migration-0365.mjs`).
 *
 * Phép đo sau DDL (vai avi_app, Đ-28 current_database):
 *   (a) cột `scopeKey` varchar(160) NOT NULL DEFAULT 'global' + chú thích; chỉ mục DUY NHẤT `uq_orch_workflows_ref_scope` trên
 *       (ref, "scopeKey"); ràng buộc cũ `orchestration_workflows_ref_unique` KHÔNG còn; mọi hàng cũ = 'global' (backfill);
 *   (b) quyền avi_app SELECT/INSERT/UPDATE (catalog — script KHÔNG cấp/thu quyền) rồi ĐO HÀNH VI trong một giao dịch LUÔN HOÀN
 *       TÁC: cùng ref ở hai scopeKey ⇒ cả hai vào; cùng (ref, scopeKey) lần hai ⇒ 23505; hàng không nêu scopeKey ⇒ 'global'
 *       (0 hàng dò còn lại);
 *   (c) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0367.mjs --dev-only    # DB dev (chủ dự án quyết — TRƯỚC khi khởi động lại với mã mới)
 *   node scripts/apply-migration-0367.mjs --test-only   # DB _test
 *   node scripts/apply-migration-0367.mjs --both        # cả hai — KHÔNG cờ ⇒ từ chối (R-3-g)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0367_orchestration_workflow_ref_scope.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const TAG = "[0367]";
const BANG = "orchestration_workflows";
const COT = "scopeKey";
const CHI_MUC = "uq_orch_workflows_ref_scope";
const RANG_BUOC_CU = "orchestration_workflows_ref_unique";

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
    // Khuôn 0362 (#6) — ALTER TABLE lấy ACCESS EXCLUSIVE trên `orchestration_workflows`. Chờ
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

    // (a) cột + chỉ mục + ràng buộc cũ + backfill
    const [c] = await appSql`
      SELECT data_type, character_maximum_length AS len, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${BANG} AND column_name = ${COT}`;
    if (!c) throw new Error(`(a) thieu cot ${BANG}.${COT}`);
    if (c.data_type !== "character varying" || Number(c.len) !== 160) throw new Error(`(a) cot ${COT} kieu ${c.data_type}(${c.len})`);
    if (c.is_nullable !== "NO") throw new Error(`(a) cot ${COT} is_nullable=${c.is_nullable}`);
    if (!String(c.column_default).startsWith("'global'")) throw new Error(`(a) cot ${COT} default=${c.column_default}`);
    const [chuThich] = await appSql`
      SELECT col_description(${"public." + BANG}::regclass, a.attnum) AS c
        FROM pg_attribute a WHERE a.attrelid = ${"public." + BANG}::regclass AND a.attname = ${COT}`;
    if (!chuThich?.c || !/Dot 7 I fix 1/.test(chuThich.c)) throw new Error(`(a) thieu chu thich cot ${COT}`);
    const [cm] = await appSql`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ${BANG} AND indexname = ${CHI_MUC}`;
    if (!cm || !/UNIQUE INDEX/.test(cm.indexdef) || !/\(ref, "scopeKey"\)/.test(cm.indexdef)) throw new Error(`(a) chi muc ${CHI_MUC} sai/thieu: ${cm?.indexdef}`);
    const cu = await appSql`SELECT conname FROM pg_constraint WHERE conrelid = ${"public." + BANG}::regclass AND conname = ${RANG_BUOC_CU}`;
    if (cu.length) throw new Error(`(a) rang buoc cu ${RANG_BUOC_CU} van con`);
    const [khac] = await appSql`SELECT count(*)::int AS n FROM ${appSql(BANG)} WHERE ${appSql(COT)} IS NULL OR ${appSql(COT)} = ''`;
    if (khac.n !== 0) throw new Error(`(a) ${khac.n} hang khong co scopeKey`);
    console.log(`  ${TAG} ${label} (a) cột ${COT} varchar(160) NOT NULL DEFAULT 'global'; ${cm.indexdef}; ràng buộc cũ đã bỏ`);

    // (b) quyền — catalog (script KHÔNG cấp/thu quyền: chỉ đo)
    const [q] = await appSql`
      SELECT has_table_privilege(${BANG}, 'SELECT') AS sel,
             has_table_privilege(${BANG}, 'INSERT') AS ins,
             has_table_privilege(${BANG}, 'UPDATE') AS upd,
             has_column_privilege(${BANG}, ${COT}, 'INSERT') AS ins_cot`;
    for (const [k, v] of Object.entries(q)) {
      if (v !== true) throw new Error(`(b) quyen avi_app ${k}=${v} (phai la true)`);
    }
    // (b) hành vi, trong giao dịch LUÔN HOÀN TÁC
    const HOAN_TAC = new Error("probe-0367-rollback");
    const REF = `__probe_0367_${Date.now()}`;
    const DEF = { ref: REF, name: REF, steps: [] };
    let kq = null;
    try {
      await appSql.begin(async (tx) => {
        await tx`INSERT INTO ${tx(BANG)} (ref, name, "definitionJson", ${tx(COT)}) VALUES (${REF}, ${REF}, ${tx.json(DEF)}, 'f:1')`;
        await tx`INSERT INTO ${tx(BANG)} (ref, name, "definitionJson", ${tx(COT)}) VALUES (${REF}, ${REF}, ${tx.json(DEF)}, 'f:2')`;
        const trung = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(BANG)} (ref, name, "definitionJson", ${sp(COT)}) VALUES (${REF}, ${REF}, ${sp.json(DEF)}, 'f:1')`);
        const [md] = await tx`INSERT INTO ${tx(BANG)} (ref, name, "definitionJson") VALUES (${REF}, ${REF}, ${tx.json(DEF)}) RETURNING ${tx(COT)} AS k`;
        kq = { trung, macDinh: md.k };
        throw HOAN_TAC; // LUÔN hoàn tác
      });
    } catch (e) {
      if (e !== HOAN_TAC) throw e;
    }
    if (!kq || kq.trung !== "23505" || kq.macDinh !== "global") throw new Error(`(b) hanh vi avi_app sai: ${JSON.stringify(kq)}`);
    const [conLai] = await appSql`SELECT count(*)::int AS n FROM ${appSql(BANG)} WHERE ref = ${REF}`;
    if (conLai.n !== 0) throw new Error(`(b) giao dich do KHONG hoan tac: con ${conLai.n} hang probe`);
    console.log(`  ${TAG} ${label} (b) catalog ${JSON.stringify(q)}; hành vi avi_app: ${JSON.stringify(kq)} — hai không gian cùng ref vào được, trùng cặp ⇒ 23505; HOÀN TÁC`);

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

    console.log(`${TAG} ${label}: applied + verified (cột · chỉ mục · ràng buộc cũ · backfill · quyền · sổ migration)`);
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
