#!/usr/bin/env node
/**
 * kiem-dinh R1b-1 fix round 2 (điều phối 2026-10-25, phương án B — TOFU) — đóng dấu `interlock_rules."approvedDefHash"` cho luật đã duyệt TRƯỚC
 * mig 0434, bằng ĐÚNG hàm bám của ứng dụng (import `server/services/interlock/dinhNghiaDuyet.ts` qua `backfillDinhNghiaDuyet.ts` — không chép).
 *
 * Chạy bằng tsx (để import mã TS của máy chủ):
 *   npx tsx scripts/backfill-approved-def-hash.mjs --test-only                         (CHẠY KHÔ: in bảng + số đếm, không ghi gì)
 *   npx tsx scripts/backfill-approved-def-hash.mjs --test-only --ghi --actor <id|email>  (ghi: MỘT giao dịch, MỘT dòng audit mỗi luật)
 *   npx tsx scripts/backfill-approved-def-hash.mjs --dev-only  [--ghi --actor …]
 *
 * AN TOÀN:
 *   - PHẢI chỉ rõ ĐÚNG MỘT đích `--test-only` | `--dev-only` (khuôn apply-migration-*); không có ⇒ thoát 2, không mở kết nối nào.
 *     `--test-only`: TEST_DATABASE_URL, không có thì DATABASE_URL + "_test" (tên DB phải chứa "test"); `--dev-only`: DATABASE_URL.
 *   - Mặc định CHẠY KHÔ; `--ghi` mới ghi và BẮT BUỘC `--actor <userId|email>` (người chạy, phải đang hoạt động) — ghi vào audit.
 *   - CHỈ luật `approvedBy` khác NULL VÀ `approvedDefHash` NULL; luật thiếu tag nguồn / đích hoặc không đọc được định nghĩa ⇒ KHÔNG đóng dấu,
 *     liệt kê riêng (giữ "Cần duyệt lại"). Idempotent: chạy lại ⇒ 0 hàng.
 *   - Thứ tự triển khai (báo cáo nghiệm thu R1b-1 §4): 0434 → script này (chạy khô, rà bảng, rồi --ghi) → build / khởi động lại.
 *   - GIỚI HẠN TOFU: thay đổi định nghĩa giữa lần duyệt gốc và lúc chạy script KHÔNG phát hiện được (status quo trước R1b-1) — admin rà lại luật
 *     bảo vệ trong tuần đầu.
 * Exit: 0 = xong (kể cả chạy khô); 1 = lỗi; 2 = thiếu / sai đích.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dich = ["--dev-only", "--test-only"].filter((f) => args.includes(f));
if (dich.length !== 1) {
  console.error(`[backfill 0434] phai chi ro DUNG MOT dich: --dev-only | --test-only (nhan: ${dich.join(" ") || "khong co"}). Khong chay gi.`);
  process.exit(2);
}
const GHI = args.includes("--ghi");
let ACTOR = null;
const iA = args.findIndex((a) => a === "--actor" || a.startsWith("--actor="));
if (iA !== -1) ACTOR = (args[iA] === "--actor" ? args[iA + 1] ?? "" : args[iA].slice("--actor=".length)).trim();
if (GHI && !ACTOR) {
  console.error("[backfill 0434] --ghi can --actor <userId|email> (nguoi chay ghi vao audit). Khong ghi gi.");
  process.exit(2);
}

function napEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const dong of fs.readFileSync(p, "utf-8").split("\n")) {
    const t = dong.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
napEnv(path.join(__dirname, "..", ".env"));
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error("[backfill 0434] DATABASE_URL chua dat.");
  process.exit(1);
}
let url = devUrl;
if (dich[0] === "--test-only") {
  url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const u = new URL(devUrl);
    // vitest.setup đã ép DATABASE_URL = _test ⇒ không nhân đôi hậu tố
    if (!/_test$/.test(u.pathname)) u.pathname = "/" + u.pathname.replace(/^\//, "") + "_test";
    url = u.toString();
  }
  if (!/test/i.test(new URL(url).pathname)) {
    console.error(`[backfill 0434] dich test ${new URL(url).pathname} khong giong DB test — tu choi.`);
    process.exit(2);
  }
}
// Mã máy chủ đọc DATABASE_URL lúc kết nối lần đầu ⇒ đặt TRƯỚC import động.
process.env.DATABASE_URL = url;

try {
  const { getDb } = await import("../server/db/connection.ts");
  const { chayBackfillDinhNghiaDuyet, bangBackfill } = await import("../server/services/interlock/backfillDinhNghiaDuyet.ts");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("khong ket noi duoc DB");
  const [cdb] = await db.execute(sql`SELECT current_database() AS d`);
  console.log(`[backfill 0434] dich: ${dich[0]} · current_database()=${cdb.d}`);
  let actorId = null;
  if (GHI) {
    const rows = /^[1-9][0-9]{0,9}$/.test(ACTOR)
      ? await db.execute(sql`SELECT id, "isActive" FROM users WHERE id = ${Number(ACTOR)}`)
      : await db.execute(sql`SELECT id, "isActive" FROM users WHERE lower(email) = lower(${ACTOR}) ORDER BY id`);
    if (rows.length !== 1 || rows[0].isActive !== true) throw new Error(`--actor "${ACTOR}": khong co / trung / da tat — khong ghi gi.`);
    actorId = Number(rows[0].id);
  }
  const kq = await chayBackfillDinhNghiaDuyet(db, { ghi: GHI, actorId });
  console.log(bangBackfill(kq));
  console.log(JSON.stringify({ ungVien: kq.ungVien, dongDau: kq.dongDau.length, khongDongDau: kq.khongDongDau.length, daGhi: kq.daGhi }));
  process.exit(0);
} catch (e) {
  console.error("[backfill 0434] LOI:", e?.message ?? e);
  process.exit(1);
}
