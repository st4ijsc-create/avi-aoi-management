#!/usr/bin/env node
/**
 * Kiểm BẤT BIẾN doc55 PV0 trên một CSDL (DEV/production) — CHỈ ĐỌC.
 *
 *   • model SỐNG thiếu biến thể BASE sống         (phải = 0)
 *   • model SỐNG có > 1 biến thể BASE sống         (phải = 0; index duy nhất từng phần lẽ ra chặn)
 *
 * Exit 0 khi cả hai = 0; exit 1 khi > 0 (in tối đa 20 mã mẫu); exit 2 khi không kết nối được / chưa có bảng.
 * Chạy trong giao dịch READ ONLY ⇒ không thể sửa dữ liệu. KHÔNG dùng cho CSDL test dùng chung (nơi test khác để rác) — ở đó ca `doc55 PV0` chạy lại câu backfill trong giao dịch hoàn tác.
 *
 * Dùng:  node scripts/kiem-bat-bien-product-models.mjs            (đọc DATABASE_URL từ môi trường hoặc .env)
 *        DATABASE_URL=postgres://... node scripts/kiem-bat-bien-product-models.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const goc = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function layDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = resolve(goc, ".env");
  if (existsSync(envFile)) {
    const m = /^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m.exec(readFileSync(envFile, "utf8"));
    if (m) return m[1];
  }
  return null;
}

const url = layDatabaseUrl();
if (!url) {
  console.error("Không có DATABASE_URL (môi trường hoặc .env).");
  process.exit(2);
}

const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15, onnotice: () => {} });
let mau = 0;
try {
  const ket = await sql.begin("read only", async (tx) => {
    const [{ db }] = await tx`SELECT current_database() AS db`;
    const [{ co }] = await tx`SELECT to_regclass('public.product_variants') IS NOT NULL AS co`;
    if (!co) return { db, thieuBang: true };
    const [{ tong }] = await tx`SELECT count(*)::int AS tong FROM product_models WHERE "deletedAt" IS NULL`;
    const thieu = await tx`
      SELECT pm.code FROM product_models pm
       WHERE pm."deletedAt" IS NULL
         AND NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv."productModelId" = pm.id AND pv."isBase" = true AND pv."deletedAt" IS NULL)
       ORDER BY pm.id LIMIT 20`;
    const [{ nThieu }] = await tx`
      SELECT count(*)::int AS "nThieu" FROM product_models pm
       WHERE pm."deletedAt" IS NULL
         AND NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv."productModelId" = pm.id AND pv."isBase" = true AND pv."deletedAt" IS NULL)`;
    const nhieu = await tx`
      SELECT pm.code, count(*)::int AS n FROM product_models pm JOIN product_variants pv ON pv."productModelId" = pm.id AND pv."isBase" = true AND pv."deletedAt" IS NULL
       WHERE pm."deletedAt" IS NULL GROUP BY pm.id, pm.code HAVING count(*) > 1 ORDER BY pm.id LIMIT 20`;
    const [{ nNhieu }] = await tx`
      SELECT count(*)::int AS "nNhieu" FROM (
        SELECT 1 FROM product_models pm JOIN product_variants pv ON pv."productModelId" = pm.id AND pv."isBase" = true AND pv."deletedAt" IS NULL
         WHERE pm."deletedAt" IS NULL GROUP BY pm.id HAVING count(*) > 1) x`;
    return { db, tong, nThieu, nNhieu, thieu: thieu.map((r) => r.code), nhieu: nhieu.map((r) => `${r.code} (x${r.n})`) };
  });
  console.log(`CSDL: ${ket.db}`);
  if (ket.thieuBang) {
    console.error("Chưa có bảng product_variants (migration 0286 chưa áp) — không kiểm được.");
    process.exit(2);
  }
  console.log(`model sống: ${ket.tong}`);
  console.log(`model sống thiếu BASE: ${ket.nThieu}${ket.nThieu ? "  mẫu: " + ket.thieu.join(", ") : ""}`);
  console.log(`model sống có >1 BASE: ${ket.nNhieu}${ket.nNhieu ? "  mẫu: " + ket.nhieu.join(", ") : ""}`);
  mau = ket.nThieu + ket.nNhieu;
  console.log(mau === 0 ? "ĐẠT: bất biến doc55 PV0 đúng." : "KHÔNG ĐẠT: bất biến doc55 PV0 bị vi phạm.");
} catch (e) {
  console.error("Lỗi:", e?.message ?? e);
  await sql.end({ timeout: 3 }).catch(() => undefined);
  process.exit(2);
}
await sql.end({ timeout: 3 }).catch(() => undefined);
process.exit(mau > 0 ? 1 : 0);
