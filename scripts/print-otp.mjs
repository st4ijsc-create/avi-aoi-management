// scripts/print-otp.mjs — in mã OTP (2FA) hiện tại cho tài khoản test.
// Dùng khi đăng nhập engineer1/supervisor1 (đã bật 2FA). OTP đổi mỗi 30s.
//   node scripts/print-otp.mjs engineer1
import 'dotenv/config';
import postgres from 'postgres';
const username = process.argv[2] || 'engineer1';
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const speakeasy = (await import('speakeasy')).default;
const [u] = await sql`SELECT username, two_factor_secret secret, two_factor_enabled en FROM users WHERE username=${username}`;
if (!u) { console.error(`Không tìm thấy user '${username}'.`); process.exit(1); }
if (!u.en || !u.secret) { console.log(`${username}: 2FA CHƯA bật (login chỉ cần mật khẩu).`); process.exit(0); }
const otp = speakeasy.totp({ secret: u.secret, encoding: 'base32' });
const remain = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`${username} → OTP: ${otp}  (còn hiệu lực ~${remain}s)`);
await sql.end();
