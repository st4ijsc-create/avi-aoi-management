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
 * ⚠⚠ **KHÔNG DDL.** Script chỉ `UPDATE`/`DELETE` trên bảng đã có.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ Pha 7 Task 9 / **R2 — SỬA LỚP LỖI "LÀM HỎNG RỒI BÁO CÁO THÀNH CÔNG"**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản trước chạy SQL **thô** `UPDATE users SET two_factor_secret = NULL`. Sau khi Task 9 (9c)
 * chuyển hạt giống TOTP sang **`user_secrets`** mà cột cũ **còn trên `users`** (cửa sổ giữa
 * migration `0314` và `0315`), câu ấy sẽ:
 *   · chạy **THÀNH CÔNG**,
 *   · in *"✔ Đã xoay N tài khoản"*,
 *   · và **KHÔNG XOAY BÍ MẬT ĐANG ĐƯỢC DÙNG** — 2FA của mọi người vẫn hoạt động bằng hạt giống
 *     **đã lộ**, còn ảnh chụp hoàn tác thì chụp **một cột đã chết**.
 * Đúng lớp lỗi Critical của Pha 3 (*"giết nhầm tiến trình rồi báo cáo thành công"*).
 *
 * ⇒ Bản này: (1) đọc/ghi **`user_secrets`**; (2) **KIỂM NGUỒN TRƯỚC KHI LÀM GÌ** — nếu bảng
 *   `user_secrets` không tồn tại, hoặc `users` còn hàng mang bí mật mà `user_secrets` **không**
 *   có, thì **DỪNG với mã thoát 3**. Không có đường nào để nó "im lặng thành công".
 *   Ca cưỡng chế: `server/_core/xoayBiMatNguon.test.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
// ★★★ R2 — LUẬT *"bí mật đang nằm ở bảng nào"* có **MỘT chủ**, và chủ ấy ở một file **KHÔNG
//   shebang** để lưới `server/_core/xoayBiMatNguon.test.ts` nạp được: đo được ở Bước 7, vitest ném
//   `SyntaxError` khi nạp một `.mjs` có shebang — và lượt ĐẦU còn XANH nhờ cache của vite.
import { BANG_NGUON_BI_MAT, loiCuaNguonBiMat } from "./_lib/nguonBiMat.mjs";

const argv = process.argv.slice(2);
const co = (t) => argv.includes(t);
const gt = (t) => {
  const m = argv.find((a) => a.startsWith(`${t}=`));
  return m ? m.slice(t.length + 1) : null;
};

/**
 * ★ Pha 7 Task 9 / R2 — mọi tác dụng phụ (đọc argv, nối DB, `process.exit`) nằm **trong** `main()`,
 * và `main()` chỉ chạy khi file được gọi **TRỰC TIẾP**. Nhờ vậy một lượt `import` (kể cả từ một
 * kịch bản khác) **không** mở kết nối nào và **không** giết tiến trình gọi.
 */
const LA_CHAY_TRUC_TIEP =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

const DB = gt("--db") ?? process.env.DATABASE_URL;
const THAT = co("--that") && co("--toi-hieu-rui-ro");
const ANH = gt("--anh");
const HOAN_TAC = gt("--hoan-tac");

/** Kết nối — chỉ dựng trong `main()`; một lượt `import` KHÔNG được mở kết nối nào. */
let sql = null;

/** Đo hai vế của cổng nguồn trên DB đang nối. Luật ở `./_lib/nguonBiMat.mjs`; đây chỉ là phép ĐO. */
async function doNguonBiMat() {
  const [{ co }] = await sql`SELECT to_regclass('public.${sql.unsafe(BANG_NGUON_BI_MAT)}') IS NOT NULL AS co`;
  if (!co) return { coBangNguon: false, soHangLechNguon: 0 };
  // Cột cũ có thể đã bị 0315 bỏ ⇒ chỉ so khi nó còn tồn tại.
  const [{ conCotCu }] = await sql`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='users'
                      AND column_name='two_factor_secret') AS "conCotCu"`;
  if (!conCotCu) return { coBangNguon: true, soHangLechNguon: 0 };
  const [{ n }] = await sql`
    SELECT COUNT(*)::int AS n
      FROM users u LEFT JOIN user_secrets s ON s."userId" = u.id
     WHERE u.two_factor_secret IS NOT NULL AND s."userId" IS NULL`;
  return { coBangNguon: true, soHangLechNguon: n };
}

/**
 * Ai bị ảnh hưởng: mọi tài khoản CÒN GIỮ một bí mật 2FA, hoặc còn mã dự phòng.
 * ⚠ Pha 7 Task 9 — nguồn của `co_secret` là **`user_secrets`**, KHÔNG phải `users.two_factor_secret`.
 */
async function aiBiAnhHuong() {
  return sql`
    SELECT u.id, u.username, u.email, u.role,
           (s."twoFactorSecret" IS NOT NULL) AS co_secret,
           u.two_factor_enabled AS bat_2fa,
           (SELECT COUNT(*)::int FROM backup_codes b WHERE b."userId" = u.id) AS so_ma,
           (SELECT COUNT(*)::int FROM user_sessions ss WHERE ss."userId" = u.id AND ss."isActive") AS so_phien
    FROM users u
    LEFT JOIN user_secrets s ON s."userId" = u.id
    WHERE s."twoFactorSecret" IS NOT NULL
       OR u.two_factor_enabled IS TRUE
       OR EXISTS (SELECT 1 FROM backup_codes b WHERE b."userId" = u.id)
    ORDER BY u.id`;
}

async function xoay() {
  // ★★★ R2 — CỔNG NGUỒN chạy TRƯỚC MỌI THỨ, kể cả lượt khô. Một lượt khô đọc nhầm bảng sẽ in ra
  //     một bản kế hoạch SAI, và người đọc sẽ duyệt nó.
  const loi = loiCuaNguonBiMat(await doNguonBiMat());
  if (loi) {
    console.error(`\n${loi}\n`);
    process.exitCode = 3;
    return;
  }
  console.log(`Nguồn bí mật đang dùng: \`${BANG_NGUON_BI_MAT}\`  (đã kiểm, không giả định)`);

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
    console.log(`  1. UPDATE ${BANG_NGUON_BI_MAT} SET "twoFactorSecret"=NULL                (${ds.length} hàng)`);
    console.log(`  2. UPDATE users SET two_factor_enabled=false, "passwordInvalidBefore"=now() (${ds.length} hàng)`);
    console.log(`  3. DELETE FROM backup_codes WHERE "userId" IN (…)                     (${ds.reduce((a, r) => a + r.so_ma, 0)} hàng)`);
    console.log(`  4. UPDATE user_sessions SET "isActive"=false WHERE "userId" IN (…)     (${ds.reduce((a, r) => a + r.so_phien, 0)} hàng)`);
    console.log(`\nThêm --that --toi-hieu-rui-ro --anh=<file> để chạy thật.`);
    return;
  }
  if (!ANH) {
    console.error("Chạy thật thì BẮT BUỘC có --anh=<file.json> — đó là lượt hoàn tác.");
    process.exit(2);
  }

  const ids = ds.map((r) => r.id);
  // ⚠ Ảnh chụp lấy từ **NGUỒN ĐANG DÙNG**. Chụp cột cũ trên `users` = chụp một bản CHẾT.
  const anhUser = await sql`
    SELECT u.id, s."twoFactorSecret" AS two_factor_secret, u.two_factor_enabled, u."passwordInvalidBefore"
      FROM users u LEFT JOIN user_secrets s ON s."userId" = u.id
     WHERE u.id = ANY(${ids}::int[])`;
  const anhMa = await sql`SELECT id, "userId", code, "isUsed", "usedAt", "createdAt" FROM backup_codes WHERE "userId" = ANY(${ids}::int[])`;
  const anhPhien = await sql`SELECT id, "isActive" FROM user_sessions WHERE "userId" = ANY(${ids}::int[]) AND "isActive"`;
  writeFileSync(ANH, JSON.stringify({ luc: new Date().toISOString(), nguon: BANG_NGUON_BI_MAT, anhUser, anhMa, anhPhien }, null, 2), "utf8");
  console.log(`\nĐã ghi ảnh chụp hoàn tác: ${ANH}  (nguồn: ${BANG_NGUON_BI_MAT})`);

  await sql.begin(async (tx) => {
    // (1) hạt giống TOTP — ở `user_secrets`, KHÔNG ở `users`.
    await tx`UPDATE user_secrets SET "twoFactorSecret" = NULL, "updatedAt" = now() WHERE "userId" = ANY(${ids}::int[])`;
    // (2) cờ 2FA (công khai) + MỐC thu hồi mật khẩu — cả hai ở `users` (Task 9 / 9b, QĐ-1).
    await tx`UPDATE users SET two_factor_enabled = false, "passwordInvalidBefore" = now() WHERE id = ANY(${ids}::int[])`;
    await tx`DELETE FROM backup_codes WHERE "userId" = ANY(${ids}::int[])`;
    await tx`UPDATE user_sessions SET "isActive" = false WHERE "userId" = ANY(${ids}::int[]) AND "isActive"`;
  });
  console.log(`✔ Đã xoay ${ids.length} tài khoản. MỌI phiên của họ đã bị thu hồi.`);
  console.log(`⚠ Người dùng phải: đăng nhập lại bằng MẬT KHẨU → ĐỔI MẬT KHẨU (bị buộc) → vào`);
  console.log(`  Hồ sơ/Bảo mật → BẬT LẠI 2FA (quét QR mới) → LƯU bộ mã dự phòng mới.`);
  console.log(`  Mã cũ và app authenticator cũ VÔ HIỆU.`);
}

async function hoanTac() {
  const anh = JSON.parse(readFileSync(HOAN_TAC, "utf8"));
  // ★★★ R2 — cổng nguồn cũng canh chiều HOÀN TÁC: ghi bí mật trở lại một cột đã chết là một lượt
  //     hoàn tác **báo thành công mà không khôi phục gì**.
  const loi = loiCuaNguonBiMat(await doNguonBiMat());
  if (loi) {
    console.error(`\n${loi}\n`);
    process.exitCode = 3;
    return;
  }
  if (anh.nguon && anh.nguon !== BANG_NGUON_BI_MAT) {
    console.error(`\nDỪNG: ảnh chụp lấy từ nguồn \`${anh.nguon}\`, script này ghi vào \`${BANG_NGUON_BI_MAT}\`.\n`);
    process.exitCode = 3;
    return;
  }
  if (!THAT) {
    console.log(`LƯỢT KHÔ hoàn tác: sẽ khôi phục ${anh.anhUser.length} tài khoản · ${anh.anhMa.length} mã · ${anh.anhPhien.length} phiên.`);
    return;
  }
  await sql.begin(async (tx) => {
    for (const u of anh.anhUser) {
      await tx`INSERT INTO user_secrets ("userId", "twoFactorSecret", "updatedAt")
               VALUES (${u.id}, ${u.two_factor_secret}, now())
               ON CONFLICT ("userId") DO UPDATE SET "twoFactorSecret" = ${u.two_factor_secret}, "updatedAt" = now()`;
      await tx`UPDATE users SET two_factor_enabled = ${u.two_factor_enabled},
                                "passwordInvalidBefore" = ${u.passwordInvalidBefore ?? null}
                WHERE id = ${u.id}`;
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

async function main() {
  if (!DB) {
    console.error("Thiếu --db=<postgres url> (hoặc DATABASE_URL).");
    process.exit(2);
  }
  if (co("--that") && !co("--toi-hieu-rui-ro")) {
    console.error("--that phải đi kèm --toi-hieu-rui-ro. Đây là thao tác KHOÁ NGƯỜI RA KHỎI 2FA.");
    process.exit(2);
  }
  sql = postgres(DB, { max: 1, connect_timeout: 15 });
  try {
    if (HOAN_TAC) await hoanTac();
    else await xoay();
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (LA_CHAY_TRUC_TIEP) await main();

/*
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ✅ VIỆC THỨ TƯ ĐÃ LÀM ĐƯỢC — **"BUỘC ĐỔI MẬT KHẨU" CÓ CỘT TỪ MIGRATION `0314`**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Khối cũ ở đây khai *"`users` KHÔNG có cột nào mang nghĩa buộc đổi mật khẩu"*. Sau Task 9 điều đó
 * **KHÔNG CÒN ĐÚNG**: migration `0314` thêm `users."passwordChangedAt"` và
 * `users."passwordInvalidBefore"` (QĐ-1 của chủ dự án — hai MỐC, không phải một cờ), và lượt xoay
 * ở trên đặt `passwordInvalidBefore = now()`.
 *
 * ⚠ Vì sao **không** dùng ba đường (b)/(c) đã nêu trong bản cũ: `isActive=false` **khoá hẳn** tài
 *   khoản chứ không buộc đổi mật khẩu; đặt `passwordHash` thành rác thì **không hoàn tác được**.
 *
 * ⚠⚠ ĐIỀU KIỆN VÀO CỦA TASK 10 (chạy script này thật) — **BA điều, không phải một**:
 *   (1) migration `0314` đã áp trên DB đích (cổng nguồn ở trên tự kiểm — không tin, nó ĐO);
 *   (2) build mới đã deploy (mã đọc bí mật từ `user_secrets`);
 *   (3) **NGHIỆM THU SỐNG ĐẠT**: một tài khoản đăng ký lại 2FA và **NHẬN ĐƯỢC mã dự phòng**.
 *   Thiếu (3) ⇒ xoay là **khoá 8 người ra khỏi hệ, KHÔNG CÓ ĐƯỜNG VÀO LẠI**.
 */
