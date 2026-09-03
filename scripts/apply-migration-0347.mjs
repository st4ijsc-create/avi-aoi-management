#!/usr/bin/env node
/**
 * 0347 — Khối B Task 5 (B-6). Chiều **MÁY** + chiều **PHIÊN BẢN** cho cây dạy
 * (docblock đầy đủ trong `drizzle/0347_chieu_may_va_phien_ban_ban_day.sql`).
 *
 * ⚠⚠ DDL PHẢI chạy bằng owner `aoi` (`avi_app` bị 42501). Script tự ĐỔI user
 * trong DATABASE_URL sang `aoi` trừ khi có MIGRATION_DB_URL/MIGRATION_DB_USER
 * đè lên — cùng khuôn `scripts/apply-migration-0338.mjs`.
 *
 * ⚠⚠ CẦU CHÌ NGHIỆM THU (tái dùng nguyên văn `apply-migration-0338.mjs:74-84`):
 * đọc `rolsuper`/`rolbypassrls` của vai nghiệm thu và **TỪ CHỐI CHẠY** nếu đó là
 * superuser — `aoi` bỏ qua mọi kiểm tra quyền nên một phép đo bằng nó là XANH GIẢ.
 *
 * ⚠ Migration này **KHÔNG có một câu DELETE nào**. Nghiệm thu dưới đây có ghi
 * hàng probe và tự xoá hàng probe CỦA CHÍNH NÓ (không phải dữ liệu lịch sử) —
 * cùng khuôn 0338.
 *
 *   node scripts/apply-migration-0347.mjs            # dev + test
 *   node scripts/apply-migration-0347.mjs --dev-only
 *   node scripts/apply-migration-0347.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0347_chieu_may_va_phien_ban_ban_day.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const PROBE = `PROBE-0347-${process.pid}`;

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

async function applyTo(rawUrl, label) {
  const ownerUrl = asOwner(rawUrl);
  const sql = postgres(ownerUrl, { max: 1, onnotice: (n) => console.log(`  [0347] ${label} NOTICE: ${n.message}`) });
  const appSql = postgres(rawUrl, { max: 1, onnotice: () => {} });
  try {
    // ── 0) CẦU CHÌ: vai nghiệm thu phải là vai ỨNG DỤNG, không phải superuser.
    //     Chạy TRƯỚC DDL — một phép đo vô nghĩa thì đừng đổi lược đồ đã.
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
    console.log(`  [0347] ${label} nghiệm thu: current_database()=${db0.d} vai="${vai.u}" (rolsuper=${vai.rolsuper}, rolbypassrls=${vai.rolbypassrls})`);

    // ── 1) ĐO TRƯỚC — con số biện minh cho SET NOT NULL / CHECK trong file SQL.
    const [truoc] = await appSql`
      SELECT (SELECT count(*)::int FROM product_surfaces)  AS s,
             (SELECT count(*)::int FROM product_positions) AS p,
             (SELECT count(*)::int FROM product_captures)  AS c,
             (SELECT count(*)::int FROM measurement_point_defs) AS mpd,
             (SELECT count(*)::int FROM measurement_point_defs WHERE "captureRowId" IS NOT NULL) AS mpd_cay`;
    console.log(`  [0347] ${label} TRƯỚC: surfaces=${truoc.s} positions=${truoc.p} captures=${truoc.c} point_defs=${truoc.mpd} (cây=${truoc.mpd_cay})`);

    const content = fs.readFileSync(MIGRATION_PATH, "utf8");
    await sql.unsafe(content);
    console.log(`[0347] ${label}: DDL applied (owner aoi)`);

    // ── 2) HÀNH VI THẬT, không đọc SQL rồi tin. Bốn phép đo bằng vai `avi_app`.

    // (a) Cột machineId có mặt và NOT NULL ở CẢ BA bảng.
    const cot = await appSql`
      SELECT table_name, is_nullable FROM information_schema.columns
       WHERE column_name = 'machineId'
         AND table_name IN ('product_surfaces','product_positions','product_captures')
       ORDER BY table_name`;
    if (cot.length !== 3) throw new Error(`verification failed (${label}): chỉ ${cot.length}/3 bảng có cột machineId`);
    const conNullable = cot.filter((r) => r.is_nullable !== "NO").map((r) => r.table_name);
    if (conNullable.length > 0) {
      throw new Error(`verification failed (${label}): machineId còn NULLABLE ở ${conNullable.join(", ")} — chiều máy NỬA VỜI`);
    }
    console.log(`  [0347] ${label} (a) machineId NOT NULL trên cả 3 bảng — OK`);

    // (b) Index hội tụ cấp surface ĐÃ mang chiều máy, và index cũ ĐÃ biến mất.
    const ix = await appSql`
      SELECT indexname FROM pg_indexes
       WHERE indexname IN ('uq_product_surfaces_model_name','uq_product_surfaces_model_may_name',
                           'uq_point_defs_cay_may_code','uq_mtv_hien_hanh','uq_mtv_may_model_version')`;
    const ten = new Set(ix.map((r) => r.indexname));
    if (ten.has("uq_product_surfaces_model_name")) {
      throw new Error(`verification failed (${label}): uq_product_surfaces_model_name VẪN CÒN — hai máy vẫn ghi đè nhau`);
    }
    for (const can of ["uq_product_surfaces_model_may_name", "uq_point_defs_cay_may_code", "uq_mtv_hien_hanh", "uq_mtv_may_model_version"]) {
      if (!ten.has(can)) throw new Error(`verification failed (${label}): thiếu index ${can}`);
    }
    console.log(`  [0347] ${label} (b) index: cũ đã gỡ, 4 index mới có mặt — OK`);

    // (c) CHECK "hàng cây phải có máy" THỰC SỰ chặn — ghi thử một hàng VI PHẠM và
    //     đòi Postgres ném 23514. Đây là phép đo HÀNH VI, không phải đọc catalog.
    const [modelThat] = await appSql`SELECT id FROM product_models ORDER BY id LIMIT 1`;
    if (!modelThat) throw new Error(`nghiem thu KHONG CHAY DUOC: product_models rỗng trên "${label}"`);
    let chan = false;
    try {
      await appSql`
        INSERT INTO measurement_point_defs
          ("productModelId", code, name, "measurementType", "positionX", "positionY", "captureRowId", "machineId")
        VALUES (${modelThat.id}, ${PROBE}, 'probe 0347', 'VISUAL', 0, 0, 2147483647, NULL)`;
    } catch (e) {
      // 23514 = check_violation (đúng cái ta muốn). 23503 = FK một-cột bắt trước —
      // cũng là CHẶN, nhưng nói sai lý do, nên phân biệt tường minh.
      if (e?.code === "23514") chan = true;
      else if (e?.code === "23503") {
        throw new Error(
          `verification failed (${label}): hàng vi phạm bị chặn bởi FK captureRowId (23503) TRƯỚC khi CHECK kịp chạy ` +
          `=> phép đo này KHÔNG chứng minh được ck_point_defs_cay_phai_co_may. Sửa probe.`,
        );
      } else throw e;
    }
    if (!chan) {
      await appSql`DELETE FROM measurement_point_defs WHERE code = ${PROBE}`;
      throw new Error(`verification failed (${label}): ghi được hàng CÂY không có máy — CHECK ck_point_defs_cay_phai_co_may KHÔNG chặn`);
    }
    console.log(`  [0347] ${label} (c) CHECK ck_point_defs_cay_phai_co_may chặn hàng cây thiếu máy (23514) — OK`);

    // (d) `avi_app` INSERT/SELECT/DELETE được sổ bản dạy mới (GRANT + sequence).
    const [ins] = await appSql`
      INSERT INTO machine_template_versions
        ("machineId","productModelId",version,checksum,snapshot)
      VALUES (2147483647, ${modelThat.id}, -1, ${"0".repeat(64)}, ${appSql.json({ probe: PROBE })})
      RETURNING id`;
    if (!ins?.id) throw new Error(`verification failed (${label}): avi_app INSERT machine_template_versions không trả id`);
    const del = await appSql`DELETE FROM machine_template_versions WHERE id = ${ins.id}`;
    if (del.count !== 1) throw new Error(`verification failed (${label}): DELETE probe xoá ${del.count} hàng (phải là 1)`);
    console.log(`  [0347] ${label} (d) avi_app INSERT+DELETE machine_template_versions OK (probe id=${ins.id})`);

    // ── 3) KHÔNG mất dữ liệu: số hàng point-def phải Y NGUYÊN như lúc đo TRƯỚC.
    const [sau] = await appSql`SELECT count(*)::int AS mpd FROM measurement_point_defs`;
    if (sau.mpd !== truoc.mpd) {
      throw new Error(`verification failed (${label}): measurement_point_defs ${truoc.mpd} → ${sau.mpd} — migration này KHÔNG được đụng một hàng nào`);
    }
    console.log(`  [0347] ${label} (e) measurement_point_defs vẫn ${sau.mpd} hàng — không mất dữ liệu`);

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

    console.log(`[0347] ${label}: applied + verified (5 phép đo hành vi bằng vai avi_app)`);
  } finally {
    await sql.end();
    await appSql.end();
  }
}

const args = process.argv.slice(2);
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error("[0347] DATABASE_URL not set (checked .env)");
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
    console.error(`[0347] ${label} FAILED:`, e?.message ?? e);
  }
}
process.exit(failed ? 1 : 0);
