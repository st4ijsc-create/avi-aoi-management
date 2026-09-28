#!/usr/bin/env node
/**
 * 0362 — doc 81 Đợt 1D Task 1: cột GHIM DỪNG của `device_tags` (stop_value / stop_pinned_by /
 * stop_pinned_at). Áp `drizzle/0362_device_tag_stop_pin.sql` bằng owner `aoi`, rồi NGHIỆM THU bằng vai
 * ứng dụng `avi_app` (khuôn `apply-migration-0361.mjs`).
 *
 * Phép đo sau DDL (vai avi_app, Đ-28 current_database):
 *   (a) ba cột tồn tại, ĐÚNG kiểu (jsonb · varchar(64) · timestamptz), đều NULLABLE; chú thích cột
 *       stop_value có mặt — IN RA danh sách cột;
 *   (b) avi_app SELECT được ba cột, và UPDATE được chúng trên một hàng dò — TOÀN BỘ trong một giao dịch
 *       LUÔN HOÀN TÁC (không một ghim thật nào bị đổi, kể cả khi chạy lại);
 *   (c) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0362.mjs --dev-only    # DB dev (chủ dự án/Kỹ thuật tự chạy)
 *   node scripts/apply-migration-0362.mjs --test-only   # DB _test
 *   node scripts/apply-migration-0362.mjs               # cả hai
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0362_device_tag_stop_pin.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const TAG = "[0362]";
const BANG = "device_tags";

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

/** Cột kỳ vọng: tên → data_type của information_schema (+ độ dài varchar). */
const COT = [
  { ten: "stop_value", kieu: "jsonb", dai: null },
  { ten: "stop_pinned_by", kieu: "character varying", dai: 64 },
  { ten: "stop_pinned_at", kieu: "timestamp with time zone", dai: null },
];

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
    const truoc = await appSql`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${BANG} AND column_name = ANY(${COT.map((c) => c.ten)})`;
    console.log(`  ${TAG} ${label} TRƯỚC: ${truoc.length}/${COT.length} cột ghim đã có`);

    const content = fs.readFileSync(MIGRATION_PATH, "utf-8");
    // Fix round 1 (#6) — ALTER TABLE lấy ACCESS EXCLUSIVE trên device_tags. Với :3000 đang đọc tag, câu
    // ALTER xếp hàng sau giao dịch đang mở VÀ chặn mọi lượt đọc tag xếp sau nó (DB dev từng treo
    // 2026-09-28). Giới hạn chờ khoá 5 s (+ trần 60 s cho cả câu) trên CHÍNH kết nối chạy DDL (max: 1):
    // không lấy được khoá ⇒ DỪNG, báo rõ, không đổi gì — chạy lại lúc vắng tải.
    await sql`SET lock_timeout = '5s'`;
    await sql`SET statement_timeout = '60s'`;
    try {
      await sql.unsafe(content);
    } catch (e) {
      if (e?.code === "55P03") {
        throw new Error(
          `KHONG lay duoc khoa ${BANG} trong 5 s (lock_timeout, ${e.code}: ${e.message}) — co giao dich khac dang giu bang. ` +
            `Chua doi gi ca. Chay lai khi vang tai (vd dung :3000 hoac ngoai gio chay may).`,
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

    // (a)
    const cot = await appSql`
      SELECT column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${BANG} AND column_name = ANY(${COT.map((c) => c.ten)})
       ORDER BY ordinal_position`;
    for (const k of COT) {
      const c = cot.find((r) => r.column_name === k.ten);
      if (!c) throw new Error(`(a) thieu cot ${k.ten}`);
      if (c.data_type !== k.kieu) throw new Error(`(a) cot ${k.ten} kieu ${c.data_type} (phai la ${k.kieu})`);
      if (k.dai != null && Number(c.character_maximum_length) !== k.dai) throw new Error(`(a) cot ${k.ten} dai ${c.character_maximum_length} (phai la ${k.dai})`);
      if (c.is_nullable !== "YES") throw new Error(`(a) cot ${k.ten} phai NULLABLE`);
    }
    const [chuThich] = await appSql`
      SELECT col_description(${"public." + BANG}::regclass, a.attnum) AS c
        FROM pg_attribute a WHERE a.attrelid = ${"public." + BANG}::regclass AND a.attname = 'stop_value'`;
    if (!chuThich?.c || !/DUNG ghim/.test(chuThich.c)) throw new Error(`(a) thieu chu thich cot stop_value`);
    for (const c of cot) {
      console.log(`  ${TAG} ${label} (a) cột ${c.column_name}: ${c.data_type}${c.character_maximum_length ? `(${c.character_maximum_length})` : ""} NULL=${c.is_nullable}`);
    }

    // (b) — quyền của avi_app trên cột mới, trong giao dịch LUÔN HOÀN TÁC.
    await appSql`SELECT stop_value, stop_pinned_by, stop_pinned_at FROM ${appSql(BANG)} LIMIT 1`;
    const [mau] = await appSql`SELECT id FROM ${appSql(BANG)} ORDER BY id LIMIT 1`;
    if (!mau) {
      console.log(`  ${TAG} ${label} (b) SELECT OK; UPDATE BỎ QUA: bảng ${BANG} chưa có hàng nào để dò`);
    } else {
      const HOAN_TAC = new Error("probe-0362-rollback");
      let kq = null;
      try {
        await appSql.begin(async (tx) => {
          const [goc] = await tx`SELECT stop_value, stop_pinned_by, stop_pinned_at FROM ${tx(BANG)} WHERE id = ${mau.id} FOR UPDATE`;
          const upd = await tx`
            UPDATE ${tx(BANG)} SET stop_value = ${tx.json(false)}, stop_pinned_by = 'probe-0362', stop_pinned_at = now()
             WHERE id = ${mau.id} RETURNING stop_value, stop_pinned_by`;
          kq = { goc, upd: upd[0] };
          throw HOAN_TAC; // LUÔN hoàn tác — ghim thật (nếu có) không bao giờ bị đổi
        });
      } catch (e) {
        if (e !== HOAN_TAC) throw e;
      }
      if (!kq || kq.upd?.stop_value !== false || kq.upd?.stop_pinned_by !== "probe-0362") {
        throw new Error(`(b) avi_app UPDATE cot ghim that bai: ${JSON.stringify(kq)}`);
      }
      const [sau] = await appSql`SELECT stop_value, stop_pinned_by, stop_pinned_at FROM ${appSql(BANG)} WHERE id = ${mau.id}`;
      if (JSON.stringify(sau) !== JSON.stringify(kq.goc)) throw new Error(`(b) giao dich do KHONG hoan tac: ${JSON.stringify(sau)}`);
      console.log(`  ${TAG} ${label} (b) avi_app SELECT + UPDATE ba cột ghim OK — trong giao dịch HOÀN TÁC (hàng dò id=${mau.id} còn nguyên)`);
    }

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

    console.log(`${TAG} ${label}: applied + verified (cột · kiểu · quyền · sổ migration)`);
  } finally {
    await sql.end();
    await appSql.end();
  }
}

const args = process.argv.slice(2);
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
