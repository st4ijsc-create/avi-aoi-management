#!/usr/bin/env node
/**
 * 0329 — backfill mã tenant (tập đoàn + ô trống của `product_inspections` /
 * `inspection_packages`) từ chuỗi `machine → station → line → workshop → factory`.
 *
 * ⚠⚠ DML PHẢI chạy bằng owner `aoi` (`avi_app` bị 42501 / WORM). Script tự ĐỔI user
 * trong DATABASE_URL sang `aoi` trừ khi có MIGRATION_DB_URL/MIGRATION_DB_USER đè lên.
 *
 * ⚠⚠ NGHIỆM THU ĐO **TRẠNG THÁI THẬT SAU KHI CHẠY**, không tin lệnh đã chạy: nó đếm
 * lại đúng ba con số mà bản vá dựa vào (hàng không suy được / ô trống còn lại / nhà
 * máy còn thiếu mã tập đoàn dù dữ liệu đã chỉ ra một mã duy nhất) và VỠ nếu khác 0.
 *
 *   node scripts/apply-migration-0329.mjs            # dev + test
 *   node scripts/apply-migration-0329.mjs --dev-only
 *   node scripts/apply-migration-0329.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0329_ma_tenant_suy_tu_may_backfill.sql";
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

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/** `avi_app` không có quyền ghi WORM/DDL — ép sang owner `aoi`. */
function asOwner(url) {
  if (process.env.MIGRATION_DB_URL) return process.env.MIGRATION_DB_URL;
  const u = new URL(url);
  u.username = process.env.MIGRATION_DB_USER ?? "aoi";
  u.password = process.env.MIGRATION_DB_PASSWORD ?? "aoi";
  return u.toString();
}

/** Chuỗi phân cấp dùng LẠI ở mọi phép đo dưới đây — một câu, không ba bản chép tay. */
const CHUOI = `
  FROM product_inspections pi
  JOIN machines m           ON m.id  = pi."machineId"
  LEFT JOIN stations st     ON st.id = m."stationId"
  LEFT JOIN production_lines pl ON pl.id = st."lineId"
  LEFT JOIN workshops w     ON w.id  = pl."workshopId"
  LEFT JOIN factories f     ON f.id  = w."factoryId"
`;

async function applyTo(rawUrl, label) {
  const sql = postgres(asOwner(rawUrl), { max: 1, onnotice: (n) => console.log(`  [0329] ${label} NOTICE: ${n.message}`) });
  try {
    // ── 0) TRƯỚC: đo để báo cáo có số, không phải cảm giác.
    const [truoc] = await sql.unsafe(`
      SELECT count(*)::int AS tong,
             count(*) FILTER (WHERE f.id IS NULL)::int AS khong_suy_duoc,
             count(*) FILTER (WHERE pi."factoryCode"   IS NULL)::int AS fac_null,
             count(*) FILTER (WHERE pi."workshopCode"  IS NULL)::int AS ws_null,
             count(*) FILTER (WHERE pi."lineCode"      IS NULL)::int AS line_null,
             count(*) FILTER (WHERE pi."corporateCode" IS NULL)::int AS corp_null
      ${CHUOI}`);
    const [pkTruoc] = await sql`
      SELECT count(*)::int AS tong, count(*) FILTER (WHERE "factoryCode" IS NULL)::int AS fac_null
      FROM inspection_packages`;
    console.log(
      `  [0329] ${label} TRƯỚC: product_inspections=${truoc.tong} · không-suy-được=${truoc.khong_suy_duoc} · ` +
        `NULL fac/ws/line/corp=${truoc.fac_null}/${truoc.ws_null}/${truoc.line_null}/${truoc.corp_null} | ` +
        `inspection_packages=${pkTruoc.tong} · factoryCode NULL=${pkTruoc.fac_null}`,
    );

    const content = fs.readFileSync(MIGRATION_PATH, "utf8");
    await sql.unsafe(content);

    // ── 1) SAU: đo lại TRẠNG THÁI THẬT.
    const [sau] = await sql.unsafe(`
      SELECT count(*)::int AS tong,
             count(*) FILTER (WHERE f.id IS NULL)::int AS khong_suy_duoc,
             count(*) FILTER (WHERE f.id IS NOT NULL AND pi."factoryCode"  IS NULL)::int AS fac_null,
             count(*) FILTER (WHERE f.id IS NOT NULL AND pi."workshopCode" IS NULL)::int AS ws_null,
             count(*) FILTER (WHERE f.id IS NOT NULL AND pi."lineCode"     IS NULL)::int AS line_null,
             count(*) FILTER (WHERE f."corporateCode" IS NOT NULL AND pi."corporateCode" IS NULL)::int AS corp_null
      ${CHUOI}`);
    const [pkSau] = await sql`
      SELECT count(*)::int AS tong, count(*) FILTER (WHERE "factoryCode" IS NULL)::int AS fac_null
      FROM inspection_packages ip
      WHERE EXISTS (
        SELECT 1 FROM machines m
        JOIN stations st ON st.id = m."stationId"
        JOIN production_lines pl ON pl.id = st."lineId"
        JOIN workshops w ON w.id = pl."workshopId"
        JOIN factories f ON f.id = w."factoryId"
        WHERE m.id = ip."machineId")`;
    // Nhà máy còn thiếu mã tập đoàn DÙ dữ liệu đã chỉ ra đúng một mã ⇒ mục 1 chưa ăn.
    const [conThieu] = await sql`
      SELECT count(*)::int AS n FROM (
        SELECT f.id
        FROM factories f
        JOIN workshops w ON w."factoryId" = f.id
        JOIN production_lines pl ON pl."workshopId" = w.id
        JOIN stations st ON st."lineId" = pl.id
        JOIN machines m ON m."stationId" = st.id
        JOIN product_inspections pi ON pi."machineId" = m.id
        WHERE f."corporateCode" IS NULL AND pi."corporateCode" IS NOT NULL
          AND btrim(pi."corporateCode") <> ''
        GROUP BY f.id HAVING count(DISTINCT pi."corporateCode") = 1) x`;

    console.log(
      `  [0329] ${label} SAU  : ô trống CÒN LẠI (máy suy được) fac/ws/line/corp=` +
        `${sau.fac_null}/${sau.ws_null}/${sau.line_null}/${sau.corp_null} | ` +
        `inspection_packages factoryCode NULL=${pkSau.fac_null}/${pkSau.tong} | ` +
        `nhà máy còn thiếu corporateCode dù suy được=${conThieu.n}`,
    );

    const loi = [];
    if (sau.fac_null !== 0) loi.push(`product_inspections."factoryCode" còn ${sau.fac_null} ô trống`);
    if (sau.ws_null !== 0) loi.push(`product_inspections."workshopCode" còn ${sau.ws_null} ô trống`);
    if (sau.line_null !== 0) loi.push(`product_inspections."lineCode" còn ${sau.line_null} ô trống`);
    if (sau.corp_null !== 0) loi.push(`product_inspections."corporateCode" còn ${sau.corp_null} ô trống dù nhà máy CÓ mã`);
    if (pkSau.fac_null !== 0) loi.push(`inspection_packages."factoryCode" còn ${pkSau.fac_null} ô trống`);
    if (conThieu.n !== 0) loi.push(`${conThieu.n} nhà máy vẫn thiếu "corporateCode" dù dữ liệu chỉ ra đúng một mã`);
    if (loi.length > 0) throw new Error(`verification failed (${label}): ${loi.join(" · ")}`);

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
    console.log(`  [0329] ${label} ✔ đã áp + nghiệm thu`);
  } finally {
    await sql.end();
  }
}

const base = process.env.DATABASE_URL;
if (!base) {
  console.error("[0329] thiếu DATABASE_URL");
  process.exit(1);
}
const devOnly = process.argv.includes("--dev-only");
const testOnly = process.argv.includes("--test-only");
const muc = [];
if (!testOnly) muc.push([base, "dev"]);
if (!devOnly) muc.push([base.replace(/\/aoi_management(\?|$)/, "/aoi_management_test$1"), "test"]);

for (const [url, label] of muc) {
  await applyTo(url, label);
}
console.log("[0329] XONG");
