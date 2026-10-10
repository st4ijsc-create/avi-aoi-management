#!/usr/bin/env node
/**
 * 0364 — doc 81 Đợt 4 Task B4 (QĐ-4c): bảng `robot_motion_locks` (khoá chuyển động robot sống qua khởi động lại). Áp
 * `drizzle/0364_robot_motion_locks.sql` bằng owner `aoi`, rồi NGHIỆM THU bằng vai ứng dụng `avi_app`
 * (khuôn `apply-migration-0363.mjs` / `apply-migration-0365.mjs`).
 *
 * Phép đo sau DDL (vai avi_app, Đ-28 current_database):
 *   (a) bảng có đúng 5 cột (robotId integer PK, reasonCode varchar NOT NULL, detail text, generation integer NOT NULL,
 *       lockedAt timestamp NOT NULL DEFAULT now()); CHECK generation >= 1 VALIDATED; chú thích bảng có mặt;
 *   (b) quyền avi_app: SELECT/INSERT/UPDATE/DELETE có, TRUNCATE KHÔNG (đọc catalog — script KHÔNG cấp/thu quyền nào) —
 *       rồi ĐO HÀNH VI trong một giao dịch LUÔN HOÀN TÁC: chèn hàng dò (robotId âm) ⇒ lockedAt có; UPSERT cùng robotId ⇒
 *       vẫn 1 hàng, generation mới; generation 0 ⇒ 23514; chèn trùng không ON CONFLICT ⇒ 23505; DELETE ⇒ 1 hàng
 *       (0 hàng dò còn lại, kể cả khi chạy lại);
 *   (c) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0364.mjs --dev-only    # DB dev (chủ dự án/Kỹ thuật tự chạy)
 *   node scripts/apply-migration-0364.mjs --test-only   # DB _test
 *   node scripts/apply-migration-0364.mjs --both        # cả hai — KHÔNG cờ ⇒ từ chối (R-3-g)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0364_robot_motion_locks.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const TAG = "[0364]";
const BANG = "robot_motion_locks";

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
    // Khuôn 0362 (#6) — DDL chờ khoá tối đa 5 s (+ trần 60 s cho cả câu) trên CHÍNH kết nối chạy DDL (max: 1): không lấy
    // được ⇒ DỪNG, không đổi gì. (Bảng mới — GRANT/REVOKE chỉ lấy khoá trên chính nó.)
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

    // (a) cột + khoá chính + CHECK + chú thích
    const cols = await appSql`
      SELECT column_name AS n, data_type AS t, is_nullable AS nl, column_default AS d FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${BANG} ORDER BY ordinal_position`;
    const got = cols.map((c) => `${c.n}:${c.t}:${c.nl}`).join(",");
    const want =
      "robotId:integer:NO,reasonCode:character varying:NO,detail:text:YES,generation:integer:NO,lockedAt:timestamp without time zone:NO";
    if (got !== want) throw new Error(`(a) cot ${BANG} sai: ${got} (phai la ${want})`);
    if (cols.find((c) => c.n === "lockedAt")?.d !== "now()") throw new Error(`(a) lockedAt default phai la now()`);
    const [pk] = await appSql`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = ${"public." + BANG}::regclass AND contype = 'p'`;
    if (!pk || !pk.def.includes('("robotId")')) throw new Error(`(a) khoa chinh phai la ("robotId"): ${pk?.def}`);
    const [ck] = await appSql`
      SELECT convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = ${"public." + BANG}::regclass AND contype = 'c'`;
    if (!ck || !ck.convalidated || !ck.def.includes("generation") || !ck.def.includes(">= 1")) {
      throw new Error(`(a) CHECK generation >= 1 sai: ${JSON.stringify(ck)}`);
    }
    const [ct] = await appSql`SELECT obj_description(${"public." + BANG}::regclass, 'pg_class') AS c`;
    if (!ct?.c || !ct.c.includes("Dot 4 Task B4")) throw new Error(`(a) thieu chu thich bang ${BANG}`);
    console.log(`  ${TAG} ${label} (a) cột ${got}; PK ${pk.def}; ${ck.def}`);

    // (b) quyền — catalog (script KHÔNG cấp/thu quyền: chỉ đo)
    const [q] = await appSql`
      SELECT has_table_privilege(${BANG}, 'SELECT') AS sel,
             has_table_privilege(${BANG}, 'INSERT') AS ins,
             has_table_privilege(${BANG}, 'UPDATE') AS upd,
             has_table_privilege(${BANG}, 'DELETE') AS del,
             has_table_privilege(${BANG}, 'TRUNCATE') AS trunc`;
    if (!(q.sel && q.ins && q.upd && q.del) || q.trunc) throw new Error(`(b) quyen avi_app sai: ${JSON.stringify(q)}`);
    console.log(`  ${TAG} ${label} (b) catalog avi_app: ${JSON.stringify(q)}`);

    // (b) hành vi, trong giao dịch LUÔN HOÀN TÁC
    const HOAN_TAC = new Error("probe-0364-rollback");
    const DO = -364;
    let kq = null;
    try {
      await appSql.begin(async (tx) => {
        const [mot] = await tx`
          INSERT INTO ${tx(BANG)} ("robotId", "reasonCode", "detail", "generation") VALUES (${DO}, 'probe', 'd', 1)
          RETURNING "lockedAt" IS NOT NULL AS co`;
        const [up] = await tx`
          INSERT INTO ${tx(BANG)} ("robotId", "reasonCode", "generation") VALUES (${DO}, 'probe2', 2)
          ON CONFLICT ("robotId") DO UPDATE SET "reasonCode" = EXCLUDED."reasonCode", "generation" = EXCLUDED."generation"
          RETURNING "generation" AS g`;
        const [dem] = await tx`SELECT count(*)::int AS n FROM ${tx(BANG)} WHERE "robotId" = ${DO}`;
        const gen0 = await maLoi(tx, (sp) => sp`UPDATE ${sp(BANG)} SET "generation" = 0 WHERE "robotId" = ${DO}`);
        const trung = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(BANG)} ("robotId", "reasonCode", "generation") VALUES (${DO}, 'x', 3)`);
        const xoa = await tx`DELETE FROM ${tx(BANG)} WHERE "robotId" = ${DO}`;
        kq = { lockedAt: mot.co, upsertGen: up.g, rows: dem.n, gen0, trung, deleted: xoa.count };
        throw HOAN_TAC; // LUÔN hoàn tác
      });
    } catch (e) {
      if (e !== HOAN_TAC) throw e;
    }
    const dung =
      kq && kq.lockedAt === true && kq.upsertGen === 2 && kq.rows === 1 && kq.gen0 === "23514" && kq.trung === "23505" && kq.deleted === 1;
    if (!dung) throw new Error(`(b) hanh vi avi_app sai: ${JSON.stringify(kq)}`);
    const [conLai] = await appSql`SELECT count(*)::int AS n FROM ${appSql(BANG)} WHERE "robotId" = ${DO}`;
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

    console.log(`${TAG} ${label}: applied + verified (bảng · khoá chính · CHECK · quyền · sổ migration)`);
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
