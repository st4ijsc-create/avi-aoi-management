#!/usr/bin/env node
/**
 * 0327 — `app_tenant_allows`: hàng KHÔNG mang mã tenant = dữ liệu dùng chung ⇒ CHO XEM.
 *
 * ⚠⚠ DDL PHẢI chạy bằng owner `aoi` (`avi_app` bị 42501). Script tự ĐỔI user trong
 * DATABASE_URL sang `aoi` trừ khi có MIGRATION_DB_URL/MIGRATION_DB_USER đè lên.
 *
 * ⚠⚠ NGHIỆM THU PHẢI CHẠY BẰNG VAI ỨNG DỤNG `avi_app`, KHÔNG PHẢI `aoi`.
 * Đo được 2026-08-18: `aoi` là superuser + BYPASSRLS + chủ sở hữu bảng ⇒ MỌI phép
 * đo RLS chạy bằng `aoi` cho ra con số Y HỆT NHAU ở cả bốn tình huống (không GUC /
 * đúng tenant / SAI tenant / bypass). Một lưới nghiệm thu chạy bằng `aoi` sẽ XANH
 * kể cả khi chính sách hoàn toàn hỏng. Script này vì thế mở HAI kết nối.
 *
 *   node scripts/apply-migration-0327.mjs            # dev + test
 *   node scripts/apply-migration-0327.mjs --dev-only
 *   node scripts/apply-migration-0327.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0327_tenant_rls_null_la_du_lieu_dung_chung.sql";
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

/** Đọc trong một giao dịch có GUC đặt sẵn. */
async function demTrongPhamVi(sql, guc, bang) {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_rls_active', ${guc.active ?? "on"}, true)`;
    await tx`SELECT set_config('app.tenant_bypass', ${guc.bypass ?? "off"}, true)`;
    await tx`SELECT set_config('app.tenant_factory_codes', ${guc.factories ?? ""}, true)`;
    await tx`SELECT set_config('app.tenant_corporate_codes', ${guc.corporates ?? ""}, true)`;
    const out = {};
    for (const t of bang) out[t] = (await tx.unsafe(`SELECT count(*)::int n FROM public."${t}"`))[0].n;
    return out;
  });
}

async function applyTo(rawUrl, label) {
  const ownerUrl = asOwner(rawUrl);
  const sql = postgres(ownerUrl, { max: 1, onnotice: (n) => console.log(`  [0327] ${label} NOTICE: ${n.message}`) });
  // Kết nối NGHIỆM THU bằng ĐÚNG vai ứng dụng — `aoi` bỏ qua RLS nên đo bằng nó là vô nghĩa.
  const appSql = postgres(rawUrl, { max: 1, onnotice: () => {} });
  try {
    const content = fs.readFileSync(MIGRATION_PATH, "utf8");
    await sql.unsafe(content);

    // ── 0) Vai nghiệm thu PHẢI thực sự chịu RLS. Nếu không, mọi ô dưới đây vô nghĩa.
    const [vai] = await appSql`
      SELECT current_user AS u, r.rolsuper, r.rolbypassrls
      FROM pg_roles r WHERE r.rolname = current_user`;
    if (vai.rolsuper || vai.rolbypassrls) {
      throw new Error(
        `nghiem thu VO NGHIA: vai "${vai.u}" co rolsuper=${vai.rolsuper} rolbypassrls=${vai.rolbypassrls} ` +
        `=> RLS khong bao gio ap dung. Phai do bang vai ung dung khong dac quyen.`,
      );
    }

    // ── 1) Bảng chứng: hàng NULL/NULL PHẢI hiện lại; hàng có mã KHÔNG khớp PHẢI vẫn bị ẩn.
    //     Chọn bảng bằng ĐO, không hard-code: một bảng NULL/NULL nhiều nhất, một bảng có factoryCode.
    const [bangNull] = await appSql`
      SELECT p.tablename FROM pg_policies p
      JOIN pg_class c ON c.relname = p.tablename
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE p.schemaname = 'public' AND c.relrowsecurity
        AND p.qual LIKE 'app_tenant_allows(NULL%'
        AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema='public' AND col.table_name=p.tablename AND col.column_name='corporateCode')
      GROUP BY p.tablename
      ORDER BY p.tablename LIMIT 1`;
    const bangCoMa = "suppliers"; // 0122: mang CẢ factoryCode LẪN corporateCode

    const bang = [bangNull?.tablename, bangCoMa].filter(Boolean);
    const khongGuc = await demTrongPhamVi(appSql, { active: "off" }, bang);

    // mã nhà máy CÓ THẬT trong bảng chứng (để nhánh "khớp" là thật, không tự thoả)
    const [maThat] = await appSql.unsafe(
      `SELECT "factoryCode" fc FROM public."${bangCoMa}" WHERE "factoryCode" IS NOT NULL LIMIT 1`,
    );
    const khop = await demTrongPhamVi(appSql, { factories: maThat?.fc ?? "KHONG-CO" }, bang);
    const saiTenant = await demTrongPhamVi(appSql, { factories: "TENANT-KHONG-TON-TAI-0327" }, bang);
    const bypass = await demTrongPhamVi(appSql, { bypass: "on" }, bang);

    console.log(`  [0327] ${label} bảng chứng (vai ${vai.u}): NULL/NULL="${bangNull?.tablename}", có mã="${bangCoMa}"`);
    for (const t of bang) {
      console.log(
        `    ${t}: khôngGUC=${khongGuc[t]} | khớp=${khop[t]} | SAI tenant=${saiTenant[t]} | bypass=${bypass[t]}`,
      );
    }

    // (a) GỠ MÌN: bảng toàn NULL/NULL phải hiện ĐỦ với người dùng scoped.
    if (bangNull?.tablename) {
      const t = bangNull.tablename;
      const [nullNull] = await appSql.unsafe(
        `SELECT count(*)::int n FROM public."${t}" WHERE "corporateCode" IS NULL`,
      );
      if (nullNull.n > 0 && khop[t] < nullNull.n) {
        throw new Error(
          `verification failed: ${t} co ${nullNull.n} hang corporateCode NULL nhung nguoi dung scoped chi thay ${khop[t]} ` +
          `=> nhanh "NULL = du lieu dung chung" CHUA co hieu luc`,
        );
      }
    }

    // (b) HÀNG RÀO CÒN THẬT: hàng CÓ mã, tenant SAI ⇒ phải bằng 0 (không được vá quá tay).
    if (khongGuc[bangCoMa] > 0 && saiTenant[bangCoMa] !== 0) {
      throw new Error(
        `verification failed: ${bangCoMa} co ${khongGuc[bangCoMa]} hang mang factoryCode, ` +
        `dat tenant SAI van thay ${saiTenant[bangCoMa]} hang => 0327 da PHA hang rao (va qua tay)`,
      );
    }
    // (c) khớp đúng tenant ⇒ phải thấy đủ; bypass ⇒ phải thấy đủ.
    if (khop[bangCoMa] !== khongGuc[bangCoMa]) {
      throw new Error(`verification failed: ${bangCoMa} dung tenant thay ${khop[bangCoMa]}/${khongGuc[bangCoMa]}`);
    }
    if (bypass[bangCoMa] !== khongGuc[bangCoMa]) {
      throw new Error(`verification failed: ${bangCoMa} bypass thay ${bypass[bangCoMa]}/${khongGuc[bangCoMa]}`);
    }

    // (d) TRƠ khi cờ tắt: không GUC ⇒ y hệt số liệu gốc (đã dùng làm mốc ở trên).

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

    console.log(`[0327] ${label}: applied + verified (min da go, hang rao van bit, bypass van mo)`);
  } finally {
    await sql.end();
    await appSql.end();
  }
}

const args = process.argv.slice(2);
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error("[0327] DATABASE_URL not set (checked .env)");
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
    console.error(`[0327] ${label} FAILED:`, e?.message ?? e);
  }
}
process.exit(failed ? 1 : 0);
