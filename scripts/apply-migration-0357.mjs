#!/usr/bin/env node
/**
 * 0357 — Đợt 25 Việc 2: bảng `andon_notes` (ghi chú xử lý cho một cảnh báo Andon).
 * Docblock đầy đủ — gồm lý do CHỌN BẢNG RIÊNG thay vì một cột — nằm trong
 * `drizzle/0357_andon_ghi_chu.sql`.
 *
 * ⚠⚠ DDL PHẢI chạy bằng owner `aoi` (`avi_app` bị 42501). Script tự ĐỔI user trong
 * DATABASE_URL sang `aoi` trừ khi có MIGRATION_DB_URL/MIGRATION_DB_USER đè lên —
 * cùng khuôn `scripts/apply-migration-0349.mjs`.
 *
 * ⚠⚠ CẦU CHÌ NGHIỆM THU (tái dùng nguyên văn `apply-migration-0349.mjs`): đọc
 * `rolsuper`/`rolbypassrls` của vai nghiệm thu và **TỪ CHỐI CHẠY** nếu đó là
 * superuser — `aoi` bỏ qua mọi kiểm tra quyền nên một phép đo bằng nó là XANH GIẢ.
 * Cả sáu phép đo dưới đây chạy bằng vai ỨNG DỤNG `avi_app`, tức đúng vai mà router
 * dùng lúc chạy thật.
 *
 * ⚠ Migration này **không có một câu UPDATE/DELETE nào** trên dữ liệu đang có — chỉ
 * CREATE TABLE/INDEX + GRANT, tất cả `IF NOT EXISTS`. Tái-chạy-được (BG-95).
 *
 * Sáu phép đo (đều bằng `avi_app`, KHÔNG bằng owner):
 *   (a) bảng có mặt trong `information_schema.tables`
 *   (b) đúng 5 cột, đúng kiểu, đúng NOT NULL
 *   (c) khoá ngoại `andonId` → `andon_events(id)` ON DELETE CASCADE
 *   (d) chỉ mục ghép `("andonId","createdAt" DESC)` có mặt
 *   (e) vai ứng dụng INSERT + SELECT + DELETE được (0 hàng để lại)
 *   (f) CASCADE là THẬT: xoá cảnh báo probe ⇒ ghi chú của nó biến mất theo
 *   (g) `andon_events` KHÔNG đổi: số cột TRƯỚC = SAU (migration không chạm bảng cũ)
 *
 *   node scripts/apply-migration-0357.mjs            # dev + test
 *   node scripts/apply-migration-0357.mjs --dev-only
 *   node scripts/apply-migration-0357.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0357_andon_ghi_chu.sql";
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
  const sql = postgres(ownerUrl, { max: 1, onnotice: (n) => console.log(`  [0357] ${label} NOTICE: ${n.message}`) });
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
    console.log(`  [0357] ${label} nghiệm thu: current_database()=${db0.d} vai="${vai.u}" (rolsuper=${vai.rolsuper}, rolbypassrls=${vai.rolbypassrls})`);

    // ── 1) ĐO TRƯỚC (Đ-28, vai avi_app) ────────────────────────────────────
    const truoc = await appSql`
      SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'andon_notes'`;
    const [cotAndonTruoc] = await appSql`
      SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'andon_events'`;
    console.log(`  [0357] ${label} TRƯỚC: andon_notes_ton_tai=${truoc[0].n > 0} so_cot_andon_events=${cotAndonTruoc.n}`);

    const content = fs.readFileSync(MIGRATION_PATH, "utf8");
    await sql.unsafe(content);
    console.log(`[0357] ${label}: DDL applied (owner aoi)`);

    // ── 2) (a) bảng có mặt ─────────────────────────────────────────────────
    const co = await appSql`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'andon_notes'`;
    if (co.length !== 1) throw new Error(`verification failed (${label}): andon_notes KHONG co trong information_schema.tables`);
    console.log(`  [0357] ${label} (a) bảng andon_notes: OK`);

    // ── 3) (b) đúng cột / kiểu / NOT NULL ──────────────────────────────────
    const cot = await appSql`
      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'andon_notes' ORDER BY ordinal_position`;
    const thay = cot.map((c) => `${c.column_name}:${c.data_type}:${c.is_nullable}`).join(" | ");
    const mong = [
      "id:integer:NO",
      "andonId:integer:NO",
      "note:text:NO",
      "createdBy:integer:YES",
      "createdAt:timestamp without time zone:NO",
    ].join(" | ");
    if (thay !== mong) throw new Error(`verification failed (${label}): cot andon_notes\n  thay = ${thay}\n  mong = ${mong}`);
    console.log(`  [0357] ${label} (b) 5 cột đúng kiểu + NOT NULL: OK`);

    // ── 4) (c) khoá ngoại CASCADE ──────────────────────────────────────────
    const fk = await appSql`
      SELECT con.conname, pg_get_constraintdef(con.oid) AS def
        FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
       WHERE rel.relname = 'andon_notes' AND con.contype = 'f'`;
    const fkDef = fk[0]?.def ?? "";
    if (!/FOREIGN KEY \("?andonId"?\) REFERENCES andon_events\(id\) ON DELETE CASCADE/.test(fkDef)) {
      throw new Error(`verification failed (${label}): khoa ngoai = "${fkDef}" (phai la andonId -> andon_events(id) ON DELETE CASCADE)`);
    }
    console.log(`  [0357] ${label} (c) khoá ngoại: ${fkDef} OK`);

    // ── 5) (d) chỉ mục ghép ────────────────────────────────────────────────
    const idx = await appSql`
      SELECT indexdef FROM pg_indexes
       WHERE tablename = 'andon_notes' AND indexname = 'idx_andon_notes_andon_created'`;
    if (idx.length !== 1) throw new Error(`verification failed (${label}): thieu chi muc idx_andon_notes_andon_created`);
    if (!/"andonId".*"createdAt" DESC/.test(idx[0].indexdef)) {
      throw new Error(`verification failed (${label}): chi muc sai thu tu: ${idx[0].indexdef}`);
    }
    console.log(`  [0357] ${label} (d) chỉ mục: ${idx[0].indexdef} OK`);

    // ── 6) (e)+(f) vai ỨNG DỤNG ghi/đọc/xoá được, và CASCADE là THẬT ───────
    // ⚠ Probe dựng CẢ cảnh báo lẫn ghi chú rồi xoá cảnh báo — nếu CASCADE chỉ có
    //   trên giấy, ghi chú sẽ còn lại và phép đo (f) bắt được. Dọn sạch ở cuối:
    //   bảng này KHÔNG phải WORM nên probe không được để lại hàng nào.
    const [probeAndon] = await appSql`
      INSERT INTO andon_events (state, reason, status, title, "raisedBySystem")
      VALUES ('green', 'other', 'raised', 'PROBE-0357 (se bi xoa ngay)', true)
      RETURNING id`;
    let soGhiChu = 0;
    try {
      await appSql`
        INSERT INTO andon_notes ("andonId", note, "createdBy")
        VALUES (${probeAndon.id}, 'probe 0357 - ghi chu thu', NULL)`;
      const doc = await appSql`SELECT note FROM andon_notes WHERE "andonId" = ${probeAndon.id}`;
      soGhiChu = doc.length;
      if (soGhiChu !== 1) throw new Error(`verification failed (${label}): avi_app INSERT/SELECT andon_notes cho ${soGhiChu} hang (phai la 1)`);
      console.log(`  [0357] ${label} (e) vai avi_app INSERT+SELECT andon_notes: OK`);
    } finally {
      await appSql`DELETE FROM andon_events WHERE id = ${probeAndon.id}`;
    }
    const conLai = await appSql`SELECT count(*)::int AS n FROM andon_notes WHERE "andonId" = ${probeAndon.id}`;
    if (conLai[0].n !== 0) {
      throw new Error(`verification failed (${label}): xoa andon_events van con ${conLai[0].n} ghi chu — ON DELETE CASCADE KHONG hieu luc`);
    }
    console.log(`  [0357] ${label} (f) ON DELETE CASCADE: xoá cảnh báo ⇒ ghi chú biến mất theo OK (0 hàng probe còn lại)`);

    // ── 7) (g) `andon_events` KHÔNG đổi ────────────────────────────────────
    const [cotAndonSau] = await appSql`
      SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'andon_events'`;
    if (cotAndonSau.n !== cotAndonTruoc.n) {
      throw new Error(`verification failed (${label}): so cot andon_events ${cotAndonTruoc.n} -> ${cotAndonSau.n} (migration nay KHONG duoc cham bang cu)`);
    }
    console.log(`  [0357] ${label} (g) andon_events giữ nguyên ${cotAndonSau.n} cột: OK`);

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

    console.log(`[0357] ${label}: applied + verified (7 phép đo: bảng, cột, khoá ngoại, chỉ mục, quyền ứng dụng, CASCADE, bảng cũ bất biến)`);
  } finally {
    await sql.end();
    await appSql.end();
  }
}

const args = process.argv.slice(2);
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error("[0357] DATABASE_URL not set (checked .env)");
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
    console.error(`[0357] ${label} FAILED:`, e?.message ?? e);
  }
}
process.exit(failed ? 1 : 0);
