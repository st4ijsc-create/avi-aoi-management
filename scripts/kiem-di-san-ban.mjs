#!/usr/bin/env node
/**
 * scripts/kiem-di-san-ban.mjs — BG-127 (Khối C, "nợ còn mở", 2026-09-05).
 *
 * ⚠ CỔNG TIÊN QUYẾT: chạy trước khi bật `SPEC_GATE_SNAPSHOT_ENABLED` ở một DB
 * MỚI (chưa từng bật cờ này) — PHẢI = 0 rồi mới bật.
 *
 * Bản vá NEW-3 (`02676ea2`, xem `server/db/product.ts`) đánh dấu MỌI hàng
 * `measurement_point_versions` sinh từ variant-override bằng tiền tố CẤU TRÚC
 * `[VARIANT:<id>]` ở đầu `changeReason` (`tienToVersionBienThe`/
 * `RE_TIEN_TO_VERSION_BIEN_THE`) — `napLichSuGioiHanTheoDiem` (v2, `cayDay.ts`)
 * và `loadPointLimitSnapshots` (v1.x, `machineApiRouters.ts`) LỌC BỎ hàng mang
 * tiền tố đó khi tái dựng giới hạn cho một điểm.
 *
 * Bản vá đó KHÔNG hồi tố — 0 migration/backfill (quyết định có chủ ý, xem
 * BG-127 trong `docs/superpowers/specs/2026-08-31-aoi-backlog-toan-canh.md`).
 * Hàng ghi TRƯỚC `02676ea2` không mang tiền tố ⇒ vẫn là "di sản bẩn" — lẫn vào
 * chuỗi mà bộ lọc theo tiền tố không bắt được.
 *
 * Câu đếm dưới đây dịch nguyên ý từ brief BG-127 (`lo-1-brief.md`): đếm hàng
 * `measurement_point_versions` mà điểm sở hữu nó (`measurement_point_defs.id =
 * measurement_point_versions."pointDefId"`) thuộc về một biến thể
 * (`d."variantId" IS NOT NULL`) NHƯNG `changeReason` KHÔNG mang tiền tố cấu
 * trúc (`NULL` hoặc không khớp `[VARIANT:%`) — đây chính là "di sản bẩn".
 *
 * Luật Đ-28: mọi số đo DB phải kèm `current_database()` — MỌI dòng output dưới
 * đây đều in nó.
 *
 * Dùng:
 *   node scripts/kiem-di-san-ban.mjs                  # đọc DATABASE_URL từ .env
 *   node scripts/kiem-di-san-ban.mjs --db <url>        # trỏ DB khác
 *
 * Exit 0 khi đếm = 0 (an toàn bật cờ). Exit 1 khi > 0 (DỪNG — xử lý trước khi bật).
 */
import "dotenv/config";
import postgres from "postgres";

function layDbUrlTuArgv() {
  const i = process.argv.indexOf("--db");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env.DATABASE_URL;
}

const url = layDbUrlTuArgv();
if (!url) {
  console.error("DỪNG: thiếu DATABASE_URL (env hoặc --db <url>).");
  process.exit(1);
}

const che = (u) => u.replace(/:[^:@]*@/, ":***@");
const sql = postgres(url, { max: 1, connect_timeout: 30, onnotice: () => {} });

try {
  const [{ db: tenDb }] = await sql`SELECT current_database() AS db`;
  console.log(`[current_database=${tenDb}] kiem-di-san-ban (BG-127): ${che(url)}`);

  // CHỈ đếm count(*)::int — KHÔNG đọc bất kỳ cột timestamp nào. postgres-js RAW
  // parse cột `timestamp` (changedAt) theo TZ của TIẾN TRÌNH, không phải TZ của
  // DB (GOTCHA cùng họ BG-96/99, xem memory/khối C) — đếm-thuần né hẳn bẫy đó.
  const [{ n }] = await sql`
    SELECT count(*)::int AS n
    FROM measurement_point_versions v
    JOIN measurement_point_defs d ON d.id = v."pointDefId"
    WHERE d."variantId" IS NOT NULL
      AND (v."changeReason" IS NULL OR v."changeReason" NOT LIKE '[VARIANT:%')
  `;

  console.log(`[current_database=${tenDb}] di_san_ban = ${n}`);

  if (n === 0) {
    console.log(`[current_database=${tenDb}] OK — 0 hàng bẩn. An toàn bật SPEC_GATE_SNAPSHOT_ENABLED ở DB này.`);
    await sql.end();
    process.exit(0);
  }
  console.error(
    `[current_database=${tenDb}] DỪNG — ${n} hàng bẩn (di sản NEW-3 chưa hồi tố). ` +
      `KHÔNG bật SPEC_GATE_SNAPSHOT_ENABLED trước khi xử lý các hàng này.`,
  );
  await sql.end();
  process.exit(1);
} catch (err) {
  console.error("LỖI khi đếm di sản bẩn:", err?.message ?? err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
