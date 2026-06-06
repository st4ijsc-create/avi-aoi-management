# Hướng dẫn đổi mật khẩu

> **Đối tượng**: tất cả user.

## 1. Đường dẫn

`Avatar góc phải trên › Hồ sơ cá nhân › tab "Bảo mật"` → bấm **"Đổi mật khẩu"**.

## 2. Các bước

1. Nhập **mật khẩu hiện tại**.
2. Nhập **mật khẩu mới** (yêu cầu ≥ 8 ký tự, có chữ hoa, chữ thường, số). Hệ thống hiển thị strength meter.
3. Nhập lại để xác nhận.
4. Bấm **"Cập nhật"**. Hệ thống đăng xuất mọi phiên cũ và yêu cầu đăng nhập lại bằng mật khẩu mới.

## 3. Quên mật khẩu

`Trang đăng nhập › "Quên mật khẩu?"` → nhập email/username → hệ thống gửi liên kết reset (hết hạn sau 30 phút). Nếu SMTP chưa cấu hình, liên hệ admin để reset thủ công tại `Menu › Quản trị › Người dùng › chọn user › Reset password`.

## 4. Bảo mật

- KHÔNG dùng lại mật khẩu cũ trong 5 lần gần nhất.
- Bật **2FA** (nếu được hỗ trợ): tab Bảo mật → "Bật xác thực hai yếu tố" → quét QR bằng Google Authenticator / Microsoft Authenticator.
- Báo cáo nghi ngờ rò rỉ tài khoản: `Menu › Quản trị › Audit log` xem các lần đăng nhập gần đây.
