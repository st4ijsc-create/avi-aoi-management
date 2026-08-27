#!/usr/bin/env node
/**
 * 0340 — Pha 1B. Ba việc, cùng một gốc rễ: cây KẾT QUẢ thiếu ràng buộc (BG-8 ⛔, BG-11, BG-13).
 *   (1) BG-8 (Critical): `measurement_results."captureRowId"` (int4, KHÔNG FK, trỏ
 *       inspection_captures) đổi tên thành "inspectionCaptureRowId" + FK thật, để không còn
 *       lẫn với `measurement_point_defs."captureRowId"` (trỏ product_captures — dãy id KHÁC,
 *       CHỒNG khoảng, chỉ cột đó có FK).
 *   (2) BG-11: khử trùng cây KẾT QUẢ — 2 unique index (inspection_surfaces theo (inspectionId,
 *       surfaceName) QĐ-BG6; inspection_positions theo (surfaceRowId, positionId)).
 *   (3) BG-13: đích ON CONFLICT cho cấp component — unique partial trên measurement_point_defs
 *       (captureRowId, componentExtId) WHERE còn sống & đã chuyển sang cây.
 *
 * ⚠⚠ AN TOÀN ĐỔI TÊN: `measurement_results.captureRowId` phải có 0 giá trị khác NULL trên CẢ
 * HAI DB trước khi RENAME (đo lại bằng vai avi_app ngay đầu applyTo — không tin số đã đo cũ).
 * Nếu > 0: BLOCKED, dừng ngay, không rename — đổi tên khi đã có dữ liệu là việc khác hẳn.
 *
 * ⚠⚠ HAI HYPERTABLE (`product_inspections`, `measurement_results`) ĐÃ BẬT NÉN. Cột mới (không
 * có ở đây — migration 0340 KHÔNG thêm cột mới, chỉ đổi tên + FK + index) và mọi ALTER TABLE
 * phải nullable-safe. Nếu ALTER TABLE báo lỗi liên quan nén/compression/chunk, script này
 * KHÔNG bắt và vòng qua — nó literally throw và dừng, để người vận hành đọc nguyên văn lỗi
 * (cùng cầu chì với 0339).
 *
 * ⚠⚠ DDL PHẢI chạy bằng owner `aoi` (`avi_app` bị 42501). Script tự ĐỔI user trong
 * DATABASE_URL sang `aoi` trừ khi có MIGRATION_DB_URL/MIGRATION_DB_USER đè lên.
 *
 * ⚠⚠ NGHIỆM THU PHẢI CHẠY BẰNG VAI ỨNG DỤNG `avi_app`, KHÔNG PHẢI `aoi`.
 * `aoi` là superuser + BYPASSRLS + chủ sở hữu bảng ⇒ mọi phép đo QUYỀN (GRANT) chạy bằng
 * `aoi` sẽ XANH kể cả khi GRANT hoàn toàn hỏng (42501 không bao giờ xảy ra với `aoi`).
 * Một lưới nghiệm thu chạy bằng `aoi` không chứng minh được gì về `avi_app`. Script này vì
 * thế mở HAI kết nối: `sql` (owner `aoi`, chạy DDL) và `appSql` (vai `avi_app`, nghiệm thu).
 *
 * ⚠⚠ NGHIỆM THU HÀNH VI, KHÔNG ĐỌC SQL: phần khử trùng được xác nhận bằng cách CHÈN THẬT hai
 * hàng `inspection_surfaces` cùng (inspectionId, surfaceName) — lượt hai PHẢI thất bại đúng
 * mã lỗi Postgres `23505` (unique_violation), không chỉ đọc `CREATE UNIQUE INDEX` trong file
 * SQL rồi tin. Dọn sạch hàng probe sau khi thử (kể cả khi thử thất bại giữa chừng).
 *
 *   node scripts/apply-migration-0340.mjs            # dev + test
 *   node scripts/apply-migration-0340.mjs --dev-only
 *   node scripts/apply-migration-0340.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0340_capture_rowid_ro_nghia.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const PROBE_SURFACE_NAME = "_probe_0340";
// Soft ref (inspection_surfaces.inspectionId không FK) — chọn giá trị KHÔNG THỂ trùng id thật
// (âm) để không lẫn với dữ liệu sản xuất.
const PROBE_INSPECTION_ID = -999000340;
const UNIQUE_INDEXES = [
  { name: "uq_insp_surfaces_inspection_name", table: "inspection_surfaces" },
  { name: "uq_insp_positions_surface_posid", table: "inspection_positions" },
  { name: "uq_point_defs_capture_component", table: "measurement_point_defs" },
];

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
  const sql = postgres(ownerUrl, { max: 1, onnotice: (n) => console.log(`  [0340] ${label} NOTICE: ${n.message}`) });
  // Kết nối NGHIỆM THU bằng ĐÚNG vai ứng dụng — `aoi` bỏ qua mọi kiểm tra quyền nên đo bằng nó vô nghĩa.
  const appSql = postgres(rawUrl, { max: 1, onnotice: () => {} });
  try {
    // ── 0) Vai nghiệm thu PHẢI thực sự là vai ứng dụng, không phải superuser/owner. In TRƯỚC
    // khi làm gì khác để nhật ký luôn có bằng chứng phép đo chạy bằng ai.
    const [vai] = await appSql`
      SELECT current_user AS u, r.rolsuper, r.rolbypassrls
      FROM pg_roles r WHERE r.rolname = current_user`;
    if (vai.rolsuper || vai.rolbypassrls) {
      throw new Error(
        `nghiem thu VO NGHIA: vai "${vai.u}" co rolsuper=${vai.rolsuper} rolbypassrls=${vai.rolbypassrls} ` +
        `=> khong the do rang buoc UNIQUE/FK bang vai nay. Phai do bang vai ung dung khong dac quyen (avi_app).`,
      );
    }
    console.log(`  [0340] ${label} nghiệm thu chạy bằng vai "${vai.u}" (rolsuper=${vai.rolsuper}, rolbypassrls=${vai.rolbypassrls})`);

    // ── 1) Bước 1 của brief: đo LẠI điều kiện an toàn TRƯỚC khi đổi tên — không tin con số cũ.
    // Chỉ có Ý NGHĨA khi cột CŨ còn tồn tại (lượt chạy đầu); lượt chạy lại (idempotent, cột đã
    // đổi tên) thì phép đo này KHÔNG áp dụng nữa — kiểm tra pg_attribute trước để tránh
    // "column captureRowId does not exist" phá vỡ tính idempotent của toàn script.
    const [cotCu] = await appSql`
      SELECT 1 AS ok FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'measurement_results' AND a.attname = 'captureRowId' AND NOT a.attisdropped`;
    if (cotCu) {
      const [truocDoi] = await appSql`
        SELECT count(*) FILTER (WHERE "captureRowId" IS NOT NULL) AS dung, count(*) AS tong
        FROM measurement_results`;
      if (Number(truocDoi.dung) > 0) {
        throw new Error(
          `BLOCKED (${label}): measurement_results."captureRowId" co ${truocDoi.dung}/${truocDoi.tong} hang KHAC NULL ` +
          `— doi ten khi da co du lieu la viec khac han, can di tru. DUNG NGAY, khong ALTER.`,
        );
      }
      console.log(`  [0340] ${label} an toàn xác nhận LẠI: captureRowId dung=${truocDoi.dung} tong=${truocDoi.tong} (0 khác NULL)`);
    } else {
      console.log(`  [0340] ${label} cột "captureRowId" cũ không còn (đã đổi tên ở lượt trước) — bỏ qua phép đo an toàn, chạy idempotent`);
    }

    const content = fs.readFileSync(MIGRATION_PATH, "utf8");
    try {
      await sql.unsafe(content);
    } catch (ddlErr) {
      const msg = String(ddlErr?.message ?? ddlErr);
      if (/compress|chunk/i.test(msg)) {
        throw new Error(
          `BLOCKED (${label}): ALTER TABLE bao loi lien quan NEN/CHUNK, DUNG NGAY, KHONG thu giai nen. ` +
          `Nguyen van loi: ${msg}`,
        );
      }
      throw ddlErr;
    }
    console.log(`[0340] ${label}: DDL applied (owner aoi)`);

    // ── 2) Cột đổi tên: "inspectionCaptureRowId" tồn tại, "captureRowId" KHÔNG còn — trên
    // measurement_results. Đọc thẳng pg_attribute (nguồn sự thật), không suy diễn từ SQL.
    const cotMr = await appSql`
      SELECT a.attname AS name
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'measurement_results' AND a.attnum > 0 AND NOT a.attisdropped`;
    const tenCotMr = new Set(cotMr.map((r) => r.name));
    if (!tenCotMr.has("inspectionCaptureRowId")) {
      throw new Error(`verification failed (${label}): measurement_results THIEU cot "inspectionCaptureRowId" sau khi doi ten`);
    }
    if (tenCotMr.has("captureRowId")) {
      throw new Error(`verification failed (${label}): measurement_results VAN CON cot "captureRowId" cu — doi ten khong thanh`);
    }
    console.log(`  [0340] ${label} cột: "inspectionCaptureRowId" có mặt, "captureRowId" cũ đã biến mất — OK`);

    // ── 3) FK thật có trong pg_constraint (không chỉ đọc file SQL rồi tin).
    const [fk] = await appSql`
      SELECT contype FROM pg_constraint WHERE conname = 'fk_measurement_results_inspection_capture'`;
    if (!fk || fk.contype !== "f") {
      throw new Error(`verification failed (${label}): khong tim thay FK fk_measurement_results_inspection_capture trong pg_constraint`);
    }
    console.log(`  [0340] ${label} FK fk_measurement_results_inspection_capture có trong pg_constraint (contype=f) — OK`);

    // ── 4) Ba chỉ mục THẬT SỰ là UNIQUE (pg_index.indisunique = true), không chỉ tồn tại.
    const idxRows = await appSql`
      SELECT c.relname AS name, i.indisunique AS is_unique
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = ANY(${UNIQUE_INDEXES.map((x) => x.name)})`;
    const idxByName = new Map(idxRows.map((r) => [r.name, r.is_unique]));
    for (const { name, table } of UNIQUE_INDEXES) {
      if (!idxByName.has(name)) {
        throw new Error(`verification failed (${label}): chi muc "${name}" (${table}) KHONG ton tai trong pg_index`);
      }
      if (idxByName.get(name) !== true) {
        throw new Error(`verification failed (${label}): chi muc "${name}" (${table}) TON TAI nhung indisunique != true`);
      }
    }
    console.log(`  [0340] ${label} cả 3 chỉ mục UNIQUE (${UNIQUE_INDEXES.map((x) => x.name).join(", ")}) xác nhận indisunique=true — OK`);

    // ── 5) HÀNH VI THẬT — không đọc SQL: chèn hai inspection_surfaces cùng (inspectionId,
    // surfaceName) → lượt hai PHẢI thất bại với 23505. Dọn sạch trước/sau (kể cả khi lỗi).
    await appSql`DELETE FROM inspection_surfaces WHERE "surfaceName" = ${PROBE_SURFACE_NAME}`;
    let probeId1;
    try {
      const [row1] = await appSql`
        INSERT INTO inspection_surfaces ("inspectionId", "inspectionTime", "surfaceName", "result", "rolledResult")
        VALUES (${PROBE_INSPECTION_ID}, now(), ${PROBE_SURFACE_NAME}, 'OK', 'OK')
        RETURNING id`;
      probeId1 = row1?.id;
      if (!probeId1) throw new Error(`verification failed (${label}): avi_app INSERT lan 1 vao inspection_surfaces khong tra ve id`);

      let ma23505 = null;
      try {
        await appSql`
          INSERT INTO inspection_surfaces ("inspectionId", "inspectionTime", "surfaceName", "result", "rolledResult")
          VALUES (${PROBE_INSPECTION_ID}, now(), ${PROBE_SURFACE_NAME}, 'OK', 'OK')`;
      } catch (dupErr) {
        ma23505 = dupErr?.code ?? null;
      }
      if (ma23505 !== "23505") {
        throw new Error(
          `verification failed (${label}): chen trung (inspectionId=${PROBE_INSPECTION_ID}, surfaceName="${PROBE_SURFACE_NAME}") ` +
          `LAN HAI khong bi tu choi dung ma 23505 (nhan duoc: ${ma23505 ?? "KHONG LOI, INSERT THANH CONG — BUG"}). ` +
          `Unique index uq_insp_surfaces_inspection_name khong hoat dong nhu ky vong.`,
        );
      }
      console.log(`  [0340] ${label} HÀNH VI THẬT xác nhận: chèn trùng (inspectionId, surfaceName) lần 2 → 23505 đúng như kỳ vọng`);
    } finally {
      // Dọn sạch — kể cả khi thử thất bại giữa chừng.
      await appSql`DELETE FROM inspection_surfaces WHERE "surfaceName" = ${PROBE_SURFACE_NAME}`;
    }
    const [conLaiProbe] = await appSql`SELECT count(*)::int n FROM inspection_surfaces WHERE "surfaceName" = ${PROBE_SURFACE_NAME}`;
    if (conLaiProbe.n !== 0) {
      throw new Error(`verification failed (${label}): con sot ${conLaiProbe.n} hang probe "${PROBE_SURFACE_NAME}" sau khi don`);
    }
    console.log(`  [0340] ${label} dọn sạch hàng probe OK — 0 hàng "${PROBE_SURFACE_NAME}" còn lại`);

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

    console.log(`[0340] ${label}: applied + verified (cot doi ten OK, FK that OK, 3 unique index OK, 23505 that OK)`);
  } finally {
    await sql.end();
    await appSql.end();
  }
}

const args = process.argv.slice(2);
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error("[0340] DATABASE_URL not set (checked .env)");
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
    console.error(`[0340] ${label} FAILED:`, e?.message ?? e);
  }
}
process.exit(failed ? 1 : 0);
