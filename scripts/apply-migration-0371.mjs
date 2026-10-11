#!/usr/bin/env node
/**
 * 0371 — doc 81 Đợt 9 Group U: `safety_event_trust` (U3 — trusted safety events bound to durable rows, consumed exactly
 * once) + `safety_plc_poll_state."readMode"` (U1/U2). Áp `drizzle/0371_safety_event_trust_and_read_mode.sql` bằng owner
 * `aoi`, rồi NGHIỆM THU bằng vai ứng dụng `avi_app` (khuôn 0363/0368).
 *
 * Phép đo sau DDL (vai avi_app, Đ-28 current_database):
 *   (a) bảng + 7 cột + PK eventId + FK ON DELETE CASCADE tới safety_events + 3 CHECK + trigger guard + chú thích;
 *   (b) quyền avi_app SELECT/INSERT/UPDATE = true, DELETE/TRUNCATE = false (catalog), rồi ĐO HÀNH VI trong giao dịch LUÔN HOÀN
 *       TÁC: chèn sự kiện dò + hàng tin cậy; tiêu thụ lần 1 ⇒ 1 hàng; lần 2 ⇒ 0 hàng; đưa consumedAt về NULL ⇒ 23514; sửa digest
 *       ⇒ 23514; digest không phải hex-64 ⇒ 23514; origin lạ ⇒ 23514; DELETE ⇒ 42501; 0 hàng dò còn lại;
 *   (d) safety_plc_poll_state."readMode" varchar + CHECK (giá trị lạ ⇒ 23514);
 *   (c) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0371.mjs --dev-only    # DB dev (chủ dự án quyết — TRƯỚC khi bật SAFETY_PLC_POLLER_ENABLED)
 *   node scripts/apply-migration-0371.mjs --test-only   # DB _test
 *   node scripts/apply-migration-0371.mjs --both        # cả hai — KHÔNG cờ ⇒ từ chối (R-3-g)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0371_safety_event_trust_and_read_mode.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const TAG = "[0371]";
const BANG = "safety_event_trust";
const COTS = { eventId: "integer", origin: "character varying", eventType: "character varying", digest: "character varying", createdAt: "timestamp with time zone", consumedAt: "timestamp with time zone", consumedBy: "character varying" };

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

const D1 = "a".repeat(64);
const D2 = "b".repeat(64);

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
    // Khuôn 0362 (#6) — REFERENCES safety_events / ALTER safety_plc_poll_state lấy khoá: chờ tối đa 5 s (+ trần 60 s).
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

    // (a) bảng, cột, khoá, CHECK, trigger, chú thích
    const cols = await appSql`
      SELECT column_name AS c, data_type AS t FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${BANG}`;
    for (const [c, t] of Object.entries(COTS)) {
      const got = cols.find((r) => r.c === c);
      if (!got || got.t !== t) throw new Error(`(a) ${BANG}.${c} thieu/sai kieu: ${got?.t}`);
    }
    const cons = await appSql`
      SELECT conname, contype, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = ${"public." + BANG}::regclass`;
    const pk = cons.find((c) => c.contype === "p");
    const fk = cons.find((c) => c.contype === "f");
    if (!pk || !/\("eventId"\)/.test(pk.def)) throw new Error(`(a) khoa chinh sai: ${pk?.def}`);
    if (!fk || !/REFERENCES safety_events\(id\) ON DELETE CASCADE/.test(fk.def)) throw new Error(`(a) khoa ngoai sai: ${fk?.def}`);
    for (const ten of ["ck_safety_event_trust_origin", "ck_safety_event_trust_digest", "ck_safety_event_trust_consumed"]) {
      if (!cons.find((c) => c.conname === ten)) throw new Error(`(a) thieu CHECK ${ten}`);
    }
    const [trg] = await appSql`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = ${"public." + BANG}::regclass AND tgname = 'trg_safety_event_trust_guard' AND NOT tgisinternal`;
    if (trg.n !== 1) throw new Error(`(a) thieu trigger trg_safety_event_trust_guard`);
    const [ct] = await appSql`SELECT obj_description(${"public." + BANG}::regclass, 'pg_class') AS c`;
    if (!ct?.c || !/Dot 9 U3/.test(ct.c)) throw new Error(`(a) thieu chu thich bang`);
    console.log(`  ${TAG} ${label} (a) ${Object.keys(COTS).length} cột; PK ${pk.def}; FK ${fk.def}; 3 CHECK; trigger guard`);

    // (b) quyền — catalog (script KHÔNG cấp/thu quyền ngoài tệp SQL: chỉ đo)
    const [q] = await appSql`
      SELECT has_table_privilege(${BANG}, 'SELECT') AS sel,
             has_table_privilege(${BANG}, 'INSERT') AS ins,
             has_table_privilege(${BANG}, 'UPDATE') AS upd,
             has_table_privilege(${BANG}, 'DELETE') AS del,
             has_table_privilege(${BANG}, 'TRUNCATE') AS trunc`;
    if (q.sel !== true || q.ins !== true || q.upd !== true) throw new Error(`(b) quyen avi_app thieu: ${JSON.stringify(q)}`);
    if (q.del !== false || q.trunc !== false) throw new Error(`(b) avi_app KHONG duoc DELETE/TRUNCATE: ${JSON.stringify(q)}`);
    // (b) hành vi, trong giao dịch LUÔN HOÀN TÁC
    const HOAN_TAC = new Error("probe-0371-rollback");
    const NOTE = `__probe_0371_${Date.now()}`;
    let kq = null;
    try {
      await appSql.begin(async (tx) => {
        const [ev] = await tx`INSERT INTO safety_events ("eventType", "detectedBy", "handledBy", notes) VALUES ('estop', 'plc', 'advisory', ${NOTE}) RETURNING id`;
        await tx`INSERT INTO ${tx(BANG)} ("eventId", origin, "eventType", digest) VALUES (${ev.id}, 'safety_plc', 'estop', ${D1})`;
        const consume = (d) => tx`UPDATE ${tx(BANG)} SET "consumedAt" = now(), "consumedBy" = 'probe' WHERE "eventId" = ${ev.id} AND "consumedAt" IS NULL AND digest = ${d} RETURNING origin`;
        const sai = (await consume(D2)).length; // wrong digest ⇒ 0
        const lan1 = (await consume(D1)).length; // ⇒ 1
        const lan2 = (await consume(D1)).length; // ⇒ 0 (exactly once)
        const veNull = await maLoi(tx, (sp) => sp`UPDATE ${sp(BANG)} SET "consumedAt" = NULL, "consumedBy" = NULL WHERE "eventId" = ${ev.id}`);
        const doiDigest = await maLoi(tx, (sp) => sp`UPDATE ${sp(BANG)} SET digest = ${D2} WHERE "eventId" = ${ev.id}`);
        const [ev2] = await tx`INSERT INTO safety_events ("eventType", "detectedBy", "handledBy", notes) VALUES ('estop', 'plc', 'advisory', ${NOTE}) RETURNING id`;
        const digestXau = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(BANG)} ("eventId", origin, "eventType", digest) VALUES (${ev2.id}, 'safety_plc', 'estop', 'nothex')`);
        const originLa = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(BANG)} ("eventId", origin, "eventType", digest) VALUES (${ev2.id}, 'api', 'estop', ${D1})`);
        await tx`INSERT INTO ${tx(BANG)} ("eventId", origin, "eventType", digest) VALUES (${ev2.id}, 'robot_telemetry', 'estop', ${D1})`;
        const doiNoiDungChuaTieuThu = await maLoi(tx, (sp) => sp`UPDATE ${sp(BANG)} SET "eventType" = 'collision' WHERE "eventId" = ${ev2.id}`);
        const xoa = await maLoi(tx, (sp) => sp`DELETE FROM ${sp(BANG)} WHERE "eventId" = ${ev2.id}`);
        // (d) readMode
        const [cfg] = await tx`INSERT INTO safety_plc_configs (code, name, backend) VALUES (${NOTE}, 'p', 'sim') RETURNING id`;
        await tx`INSERT INTO safety_plc_poll_state ("configId", "readMode") VALUES (${cfg.id}, 'subscription')`;
        const modeLa = await maLoi(tx, (sp) => sp`UPDATE safety_plc_poll_state SET "readMode" = 'magic' WHERE "configId" = ${cfg.id}`);
        kq = { sai, lan1, lan2, veNull, doiDigest, digestXau, originLa, doiNoiDungChuaTieuThu, xoa, modeLa };
        throw HOAN_TAC; // LUÔN hoàn tác
      });
    } catch (e) {
      if (e !== HOAN_TAC) throw e;
    }
    if (
      !kq || kq.sai !== 0 || kq.lan1 !== 1 || kq.lan2 !== 0 || kq.veNull !== "23514" || kq.doiDigest !== "23514" ||
      kq.digestXau !== "23514" || kq.originLa !== "23514" || kq.doiNoiDungChuaTieuThu !== "23514" || kq.xoa !== "42501" || kq.modeLa !== "23514"
    ) {
      throw new Error(`(b) hanh vi avi_app sai: ${JSON.stringify(kq)}`);
    }
    const [conLai] = await appSql`SELECT count(*)::int AS n FROM safety_events WHERE notes = ${NOTE}`;
    if (conLai.n !== 0) throw new Error(`(b) giao dich do KHONG hoan tac: con ${conLai.n} hang probe`);
    console.log(`  ${TAG} ${label} (b)(d) catalog ${JSON.stringify(q)}; hành vi avi_app: ${JSON.stringify(kq)}; HOÀN TÁC`);

    // (d) readMode column (catalog)
    const [rm] = await appSql`SELECT data_type AS t FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'safety_plc_poll_state' AND column_name = 'readMode'`;
    if (rm?.t !== "character varying") throw new Error(`(d) safety_plc_poll_state.readMode thieu/sai kieu: ${rm?.t}`);

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

    console.log(`${TAG} ${label}: applied + verified (bảng · khoá · CHECK · trigger một chiều · quyền · hành vi · readMode · sổ migration)`);
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
