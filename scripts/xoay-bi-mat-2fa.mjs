#!/usr/bin/env node
/**
 * ★★★ Pha 7 Task 8c — XOAY BÍ MẬT 2FA + VÔ HIỆU MÃ DỰ PHÒNG + BUỘC ĐĂNG NHẬP LẠI
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐÂY LÀ THAO TÁC **KHOÁ NGƯỜI RA KHỎI 2FA**. SCRIPT NÀY ĐÃ SOẠN, **CHƯA CHẠY** LẦN NÀO.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Vì sao cần: Task 7 đo được `auth.me` (và `user.list` · `user.getById` · `user.search`) **phát
 * `twoFactorSecret` ra trình duyệt**. Bí mật đã phát ra thì coi như **đã lộ** — ai đọc được nó thì
 * **tự sinh mã OTP hợp lệ mãi mãi**, nên vé một-lần, sổ chống phát lại, step-up mỗi lượt đều thành
 * trang trí. Bản vá đóng đường rò; **xoay** là thứ duy nhất làm bí mật ĐÃ lộ hết giá trị.
 *
 * ⚠ Mặc định **KHÔ** (`--kho`): chỉ ĐẾM và IN, không đụng dữ liệu. Muốn chạy thật phải có **cả
 *   hai** cờ `--that` và `--toi-hieu-rui-ro`, cộng `--db=<url>`.
 * ⚠ Trước khi đổi, script ghi **ảnh chụp** ra `--anh=<file.json>` — đó là **lượt hoàn tác**.
 *
 * Cách chạy (chỉ khi chủ dự án đã duyệt):
 *   node scripts/xoay-bi-mat-2fa.mjs --db="postgresql://aoi:aoi@127.0.0.1:5434/aoi_management"
 *   node scripts/xoay-bi-mat-2fa.mjs --db=… --that --toi-hieu-rui-ro --anh=./xoay-2fa-anh.json
 *   node scripts/xoay-bi-mat-2fa.mjs --db=… --hoan-tac=./xoay-2fa-anh.json --that --toi-hieu-rui-ro
 *
 * ⚠⚠ **KHÔNG DDL.** Script chỉ `UPDATE`/`DELETE` trên bảng đã có. Xem §"CHƯA LÀM ĐƯỢC" cuối file:
 *    *"buộc đổi mật khẩu"* cần **một cột mới** ⇒ thuộc Task 9, không thuộc script này.
 */
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";

const argv = process.argv.slice(2);
const co = (t) => argv.includes(t);
const gt = (t) => {
  const m = argv.find((a) => a.startsWith(`${t}=`));
  return m ? m.slice(t.length + 1) : null;
};

const DB = gt("--db") ?? process.env.DATABASE_URL;
const THAT = co("--that") && co("--toi-hieu-rui-ro");
const ANH = gt("--anh");
const HOAN_TAC = gt("--hoan-tac");

if (!DB) {
  console.error("Thiếu --db=<postgres url> (hoặc DATABASE_URL).");
  process.exit(2);
}
if (co("--that") && !co("--toi-hieu-rui-ro")) {
  console.error("--that phải đi kèm --toi-hieu-rui-ro. Đây là thao tác KHOÁ NGƯỜI RA KHỎI 2FA.");
  process.exit(2);
}

const sql = postgres(DB, { max: 1, connect_timeout: 15 });

/** Ai bị ảnh hưởng: mọi tài khoản CÒN GIỮ một bí mật 2FA, hoặc còn mã dự phòng. */
async function aiBiAnhHuong() {
  return sql`
    SELECT u.id, u.username, u.email, u.role,
           (u.two_factor_secret IS NOT NULL) AS co_secret,
           u.two_factor_enabled AS bat_2fa,
           (SELECT COUNT(*)::int FROM backup_codes b WHERE b."userId" = u.id) AS so_ma,
           (SELECT COUNT(*)::int FROM user_sessions s WHERE s."userId" = u.id AND s."isActive") AS so_phien
    FROM users u
    WHERE u.two_factor_secret IS NOT NULL
       OR u.two_factor_enabled IS TRUE
       OR EXISTS (SELECT 1 FROM backup_codes b WHERE b."userId" = u.id)
    ORDER BY u.id`;
}

async function xoay() {
  const ds = await aiBiAnhHuong();
  const tongUser = (await sql`SELECT COUNT(*)::int AS n FROM users`)[0].n;

  console.log(`\n=== AI BỊ ẢNH HƯỞNG ===`);
  console.log(`Tổng tài khoản trong hệ: ${tongUser}`);
  console.log(`Tài khoản bị chạm      : ${ds.length}`);
  for (const r of ds) {
    console.log(
      `  #${r.id} ${r.username ?? "(no username)"} [${r.role}] secret=${r.co_secret} bật2FA=${r.bat_2fa} mã_dự_phòng=${r.so_ma} phiên_sống=${r.so_phien}`,
    );
  }
  if (ds.length === 0) {
    console.log("\n⇒ KHÔNG tài khoản nào cần xoay. Không có gì để làm.");
    return;
  }

  if (!THAT) {
    console.log(`\n=== LƯỢT KHÔ — KHÔNG ĐỘNG VÀO DỮ LIỆU ===`);
    console.log(`Nếu chạy thật, script sẽ:`);
    console.log(`  1. UPDATE users SET two_factor_secret=NULL, two_factor_enabled=false  (${ds.length} hàng)`);
    console.log(`  2. DELETE FROM backup_codes WHERE "userId" IN (…)                     (${ds.reduce((a, r) => a + r.so_ma, 0)} hàng)`);
    console.log(`  3. UPDATE user_sessions SET "isActive"=false WHERE "userId" IN (…)     (${ds.reduce((a, r) => a + r.so_phien, 0)} hàng)`);
    console.log(`\nThêm --that --toi-hieu-rui-ro --anh=<file> để chạy thật.`);
    return;
  }
  if (!ANH) {
    console.error("Chạy thật thì BẮT BUỘC có --anh=<file.json> — đó là lượt hoàn tác.");
    process.exit(2);
  }

  const ids = ds.map((r) => r.id);
  const anhUser = await sql`SELECT id, two_factor_secret, two_factor_enabled FROM users WHERE id = ANY(${ids}::int[])`;
  const anhMa = await sql`SELECT id, "userId", code, "isUsed", "usedAt", "createdAt" FROM backup_codes WHERE "userId" = ANY(${ids}::int[])`;
  const anhPhien = await sql`SELECT id, "isActive" FROM user_sessions WHERE "userId" = ANY(${ids}::int[]) AND "isActive"`;
  writeFileSync(ANH, JSON.stringify({ luc: new Date().toISOString(), anhUser, anhMa, anhPhien }, null, 2), "utf8");
  console.log(`\nĐã ghi ảnh chụp hoàn tác: ${ANH}`);

  await sql.begin(async (tx) => {
    await tx`UPDATE users SET two_factor_secret = NULL, two_factor_enabled = false WHERE id = ANY(${ids}::int[])`;
    await tx`DELETE FROM backup_codes WHERE "userId" = ANY(${ids}::int[])`;
    await tx`UPDATE user_sessions SET "isActive" = false WHERE "userId" = ANY(${ids}::int[]) AND "isActive"`;
  });
  console.log(`✔ Đã xoay ${ids.length} tài khoản. MỌI phiên của họ đã bị thu hồi.`);
  console.log(`⚠ Người dùng phải: đăng nhập lại bằng MẬT KHẨU → vào Hồ sơ/Bảo mật → BẬT LẠI 2FA`);
  console.log(`  (quét QR mới) → LƯU bộ mã dự phòng mới. Mã cũ và app authenticator cũ VÔ HIỆU.`);
}

async function hoanTac() {
  const anh = JSON.parse(readFileSync(HOAN_TAC, "utf8"));
  if (!THAT) {
    console.log(`LƯỢT KHÔ hoàn tác: sẽ khôi phục ${anh.anhUser.length} tài khoản · ${anh.anhMa.length} mã · ${anh.anhPhien.length} phiên.`);
    return;
  }
  await sql.begin(async (tx) => {
    for (const u of anh.anhUser) {
      await tx`UPDATE users SET two_factor_secret = ${u.two_factor_secret}, two_factor_enabled = ${u.two_factor_enabled} WHERE id = ${u.id}`;
    }
    for (const m of anh.anhMa) {
      await tx`INSERT INTO backup_codes (id, "userId", code, "isUsed", "usedAt", "createdAt")
               VALUES (${m.id}, ${m.userId}, ${m.code}, ${m.isUsed}, ${m.usedAt}, ${m.createdAt})
               ON CONFLICT (id) DO NOTHING`;
    }
    for (const p of anh.anhPhien) {
      await tx`UPDATE user_sessions SET "isActive" = true WHERE id = ${p.id}`;
    }
  });
  console.log(`✔ Đã hoàn tác. ⚠ Hoàn tác khôi phục BÍ MẬT ĐÃ LỘ — chỉ dùng khi lượt xoay là nhầm.`);
}

try {
  if (HOAN_TAC) await hoanTac();
  else await xoay();
} finally {
  await sql.end({ timeout: 5 });
}

/*
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * CHƯA LÀM ĐƯỢC Ở TASK 8 — **"BUỘC ĐỔI MẬT KHẨU" CẦN DDL**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bảng `users` hôm nay có: id · openId · username · passwordHash · name · email · phone ·
 * department · position · loginMethod · role · isActive · two_factor_secret · two_factor_enabled ·
 * createdAt · updatedAt · lastSignedIn · loginAttempts · lockedUntil.
 * **KHÔNG có cột nào mang nghĩa "phải đổi mật khẩu ở lượt đăng nhập tới"**, và Task 8 bị cấm DDL.
 *
 * Ba đường, để chủ dự án chọn:
 *  (a) Thêm cột `must_change_password boolean NOT NULL DEFAULT false` → gộp vào **Task 9** (đang
 *      soạn migration tách `user_secrets`). Đây là đường ĐÚNG.
 *  (b) Dùng cột đã có `isActive=false` để chặn rồi mở tay từng người — **thô**, và nó khoá hẳn tài
 *      khoản chứ không buộc đổi mật khẩu.
 *  (c) Đặt `passwordHash` thành một giá trị không khớp gì — **KHÔNG hoàn tác được**, tuyệt đối
 *      không nên.
 * ⇒ Script này làm **ba việc không cần DDL** (xoay secret · huỷ mã dự phòng · thu hồi phiên) và
 *   **dừng** ở việc thứ tư.
 */
