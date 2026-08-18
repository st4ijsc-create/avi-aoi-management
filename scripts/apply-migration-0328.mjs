#!/usr/bin/env node
/**
 * 0328 — năm bảng nóng: bật RLS cho `inspection_packages`, giữ TẮT `wip_tracking`,
 *        và CHỨNG MINH ba hypertable không bật được (chứ không chỉ khai như vậy).
 *
 * ⚠⚠ DDL PHẢI chạy bằng owner `aoi` (`avi_app` bị 42501). Script tự đổi user trong
 * DATABASE_URL sang `aoi` trừ khi MIGRATION_DB_URL/MIGRATION_DB_USER đè lên.
 *
 * ⚠⚠ NGHIỆM THU PHẢI CHẠY BẰNG VAI ỨNG DỤNG `avi_app`. `aoi` là superuser +
 * BYPASSRLS ⇒ đo bằng nó cho ra con số y hệt ở cả bốn tình huống, tức lưới xanh
 * kể cả khi chính sách hỏng hoàn toàn. Script mở HAI kết nối vì lý do đó.
 *
 * ⚠⚠ CHỐNG "LƯỢNG TỪ TỰ THOẢ": `inspection_packages` có 0 hàng (dev) / 158 hàng
 * toàn `factoryCode = NULL` (test). Đếm trên dữ liệu ĐANG CÓ cho ra con số Y HỆT
 * dù chính sách còn hay mất. Nên phần nghiệm thu NẠP dữ liệu chứng ba nhóm
 * (khớp / khác / vô chủ) trong một giao dịch rồi ROLLBACK, và đếm lại sau đó để
 * chứng minh không hàng nào còn sót.
 *
 *   node scripts/apply-migration-0328.mjs            # dev + test
 *   node scripts/apply-migration-0328.mjs --dev-only
 *   node scripts/apply-migration-0328.mjs --test-only
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0328_tenant_rls_bang_nong_cai_lam_duoc.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);

/** Ba hypertable bật columnstore — PHẢI bị từ chối 0A000. */
const HYPERTABLE_KHONG_BAT_DUOC = ["product_inspections", "oee_metrics", "process_results"];
/** Tiền tố CHỈ dùng cho dữ liệu chứng; mọi thứ nạp ra đều bị ROLLBACK. */
const PFX = "MIG0328-";

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

async function datGuc(tx, guc) {
  await tx`SELECT set_config('app.tenant_rls_active', ${guc.active ?? "on"}, true)`;
  await tx`SELECT set_config('app.tenant_bypass', ${guc.bypass ?? "off"}, true)`;
  await tx`SELECT set_config('app.tenant_factory_codes', ${guc.factories ?? ""}, true)`;
  await tx`SELECT set_config('app.tenant_corporate_codes', ${guc.corporates ?? ""}, true)`;
}

async function applyTo(rawUrl, label) {
  const sql = postgres(asOwner(rawUrl), { max: 1, onnotice: (n) => console.log(`  [0328] ${label} NOTICE: ${n.message}`) });
  const appSql = postgres(rawUrl, { max: 1, onnotice: () => {} });
  try {
    const content = fs.readFileSync(MIGRATION_PATH, "utf8");
    await sql.unsafe(content);

    // ── 0) CẦU CHÌ: vai nghiệm thu phải THỰC SỰ chịu RLS.
    const [vai] = await appSql`
      SELECT current_user AS u, r.rolsuper, r.rolbypassrls
      FROM pg_roles r WHERE r.rolname = current_user`;
    if (vai.rolsuper || vai.rolbypassrls) {
      throw new Error(
        `nghiem thu VO NGHIA: vai "${vai.u}" co rolsuper=${vai.rolsuper} rolbypassrls=${vai.rolbypassrls} ` +
          `=> RLS khong bao gio ap dung. Phai do bang vai ung dung khong dac quyen.`,
      );
    }

    // ── 1) TRẠNG THÁI THẬT — đọc `relrowsecurity`, không tin lệnh đã chạy.
    const trangThai = Object.fromEntries(
      (
        await appSql`
        SELECT c.relname, c.relrowsecurity FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        WHERE c.relname = ANY(${["inspection_packages", "wip_tracking", ...HYPERTABLE_KHONG_BAT_DUOC]})`
      ).map((r) => [r.relname, r.relrowsecurity]),
    );
    if (trangThai.inspection_packages !== true) {
      throw new Error(`verification failed: inspection_packages.relrowsecurity=${trangThai.inspection_packages} (phai true)`);
    }
    if (trangThai.wip_tracking !== false) {
      throw new Error(`verification failed: wip_tracking.relrowsecurity=${trangThai.wip_tracking} (phai false — xem 0328 muc 2)`);
    }

    // ── 2) CHỨNG MINH lý do ba hypertable vắng mặt: thử bật, PHẢI vỡ 0A000.
    //     Không có bước này, "khong bat duoc" chỉ là lời khai trong bình luận.
    for (const t of HYPERTABLE_KHONG_BAT_DUOC) {
      if (trangThai[t] !== false) throw new Error(`verification failed: ${t}.relrowsecurity=${trangThai[t]} (phai false)`);
      let ma = null;
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(`ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY`);
          throw new Error("__KHONG_NEN_TOI_DAY__");
        });
      } catch (e) {
        ma = e?.code ?? null;
        if (e?.message === "__KHONG_NEN_TOI_DAY__") {
          throw new Error(`verification failed: ${t} BAT DUOC RLS => tien de cua 0328 SAI, doc lai migration`);
        }
      }
      if (ma !== "0A000") {
        throw new Error(`verification failed: ${t} vo voi ma "${ma}" chu khong phai 0A000 => ly do ghi trong 0328 SAI`);
      }
      console.log(`  [0328] ${label} ${t}: xac nhan bi tu choi 0A000 (hypertable co columnstore)`);
    }

    // ── 3) ÂM ĐỐI XỨNG trên `inspection_packages`, bằng DỮ LIỆU CHỨNG BA NHÓM.
    //     Nạp trong giao dịch rồi ROLLBACK — không hàng nào được commit.
    const truoc = (await appSql`SELECT count(*)::int n FROM inspection_packages`)[0].n;
    let ket = null;
    await appSql
      .begin(async (tx) => {
        await tx`
          INSERT INTO inspection_packages ("inspectionId","machineId","packageId","storageKey","serialNumber","factoryCode","inspectionTime")
          SELECT 1, 1, ${PFX} || g, 'k/' || g, 'S' || g,
                 CASE WHEN g % 5 = 0 THEN NULL WHEN g % 5 = 1 THEN ${PFX + "FAC-B"} ELSE ${PFX + "FAC-A"} END,
                 now()
          FROM generate_series(1, 100) g`;
        const dem = async (guc) =>
          tx.savepoint(async (sp) => {
            await datGuc(sp, guc);
            const [r] = await sp`SELECT count(*)::int n FROM inspection_packages WHERE "packageId" LIKE ${PFX + "%"}`;
            return r.n;
          });
        ket = {
          khongGuc: await dem({ active: "off" }),
          A: await dem({ factories: PFX + "FAC-A" }),
          B: await dem({ factories: PFX + "FAC-B" }),
          sai: await dem({ factories: PFX + "KHONG-TON-TAI" }),
          bypass: await dem({ bypass: "on" }),
        };
        throw new Error("__ROLLBACK_CO_Y__");
      })
      .catch((e) => {
        if (e?.message !== "__ROLLBACK_CO_Y__") throw e;
      });

    // 100 hàng: 20 NULL (g%5=0) · 20 FAC-B (g%5=1) · 60 FAC-A
    const mong = { khongGuc: 100, A: 80, B: 40, sai: 20, bypass: 100 };
    console.log(
      `  [0328] ${label} inspection_packages (vai ${vai.u}): ` +
        `khôngGUC=${ket.khongGuc} | A=${ket.A} | B=${ket.B} | SAI=${ket.sai} | bypass=${ket.bypass}`,
    );
    for (const [k, v] of Object.entries(mong)) {
      if (ket[k] !== v) {
        throw new Error(
          `verification failed: inspection_packages o "${k}" = ${ket[k]}, phai ${v}. ` +
            `(A=60 khop + 20 vo chu; B=20 khop + 20 vo chu; SAI=chi 20 vo chu; hai chieu bac bo lan nhau)`,
        );
      }
    }

    // ── 4) DỌN: chứng minh ROLLBACK đã ăn, không sót hàng nào.
    const sau = (await appSql`SELECT count(*)::int n FROM inspection_packages`)[0].n;
    const sot = (await appSql`SELECT count(*)::int n FROM inspection_packages WHERE "packageId" LIKE ${PFX + "%"}`)[0].n;
    if (sot !== 0 || sau !== truoc) {
      throw new Error(`verification failed: du lieu chung con sot ${sot} hang (tong ${truoc} -> ${sau})`);
    }

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

    console.log(
      `[0328] ${label}: applied + verified (inspection_packages BAT & bit hai chieu; ` +
        `wip_tracking giu TAT; 3 hypertable xac nhan 0A000; du lieu chung da sach)`,
    );
  } finally {
    await sql.end();
    await appSql.end();
  }
}

const args = process.argv.slice(2);
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error("[0328] DATABASE_URL not set (checked .env)");
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
    console.error(`[0328] ${label} FAILED:`, e?.message ?? e);
  }
}
process.exit(failed ? 1 : 0);
