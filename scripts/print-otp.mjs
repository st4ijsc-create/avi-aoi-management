// scripts/print-otp.mjs — in mã OTP (2FA) hiện tại cho tài khoản test.
// Dùng khi đăng nhập engineer1/supervisor1 (đã bật 2FA). OTP đổi mỗi 30s.
//   node scripts/print-otp.mjs engineer1
import 'dotenv/config';
import postgres from 'postgres';
const username = process.argv[2] || 'engineer1';
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const speakeasy = (await import('speakeasy')).default;
// ★ Pha 7 Task 9 (9c) — hạt giống TOTP nay ở `user_secrets`; cờ 2FA vẫn ở `users`.
//   Cột cũ `users.two_factor_secret` đã bị migration 0315 BỎ (2026-08-09); trước lượt ấy, đọc nó
//   vẫn CHẠY nhưng trả một giá trị ĐÃ CHẾT ⇒ in ra một OTP không bao giờ khớp ("báo thành công mà
//   sai"). Nay đọc nhầm cột ném 42703 — hỏng ỒN ÀO, đúng chiều an toàn.
const [u] = await sql`SELECT u.username, s."twoFactorSecret" AS secret, u.two_factor_enabled AS en
                        FROM users u LEFT JOIN user_secrets s ON s."userId" = u.id
                       WHERE u.username=${username}`;
if (!u) { console.error(`Không tìm thấy user '${username}'.`); process.exit(1); }
if (!u.en || !u.secret) { console.log(`${username}: 2FA CHƯA bật (login chỉ cần mật khẩu).`); process.exit(0); }
const otp = speakeasy.totp({ secret: u.secret, encoding: 'base32' });
const remain = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`${username} → OTP: ${otp}  (còn hiệu lực ~${remain}s)`);
await sql.end();
