// scripts/sim-factory/lib/db.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Kết nối DB cho các tiến trình sim + CỔNG AN TOÀN D10 (DB _sim riêng).
//
// GUARD (chống bơm dữ liệu giả vào DB thật): seed/ghi CHỈ được phép khi
//   • DATABASE_URL chứa chuỗi 'sim' (khuyến nghị: DB tên *_sim), HOẶC
//   • SIM_SEED_CONFIRM=1 (chủ động xác nhận — dùng khi tên DB không chứa 'sim').
// scenario.mjs chỉ ĐỌC nên không bắt buộc guard, nhưng vẫn cảnh báo nếu DB có vẻ thật.
// ─────────────────────────────────────────────────────────────────────────────
import postgres from "postgres";

/** DATABASE_URL có "vẻ" là DB _sim không? */
export function looksLikeSimDb(url = process.env.DATABASE_URL || "") {
  return /sim/i.test(url);
}

/**
 * Bảo đảm đây là DB an toàn để GHI. Ném lỗi (dừng tiến trình) nếu không.
 * In cảnh báo rõ ràng, che credential.
 */
export function assertSimWritable() {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    console.error("[sim/db] REFUSING: DATABASE_URL chưa set. Nạp .env.sim trước (xem README).");
    process.exit(1);
  }
  const confirmed = process.env.SIM_SEED_CONFIRM === "1";
  if (!looksLikeSimDb(url) && !confirmed) {
    console.error(
      "\n══════════════════════════════════════════════════════════════════\n" +
        "[sim/db] TỪ CHỐI GHI: DATABASE_URL KHÔNG chứa 'sim'.\n" +
        `         DB đang trỏ: ${maskUrl(url)}\n` +
        "         Đây có thể là DB THẬT. Để tránh bơm dữ liệu ảo vào production:\n" +
        "           • Trỏ DATABASE_URL sang một DB tên *_sim (khuyến nghị), HOẶC\n" +
        "           • Đặt SIM_SEED_CONFIRM=1 nếu bạn CHẮC CHẮN muốn ghi vào DB này.\n" +
        "══════════════════════════════════════════════════════════════════\n",
    );
    process.exit(1);
  }
  console.log(
    `[sim/db] target OK → ${maskUrl(url)} ${looksLikeSimDb(url) ? "(khớp 'sim')" : "(SIM_SEED_CONFIRM=1)"}`,
  );
}

/** Che user:pass trong URL để log an toàn. */
export function maskUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    if (u.username) u.username = u.username;
    return u.toString();
  } catch {
    return url.replace(/\/\/[^@]*@/, "//***@");
  }
}

/** Tạo client postgres (max 4 kết nối là đủ cho seed/scenario). */
export function makeSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL chưa set");
  return postgres(url, { max: 4, onnotice: () => {} });
}
