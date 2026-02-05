# Hướng Dẫn Thiết Lập Admin Lần Đầu

## Tổng Quan

Hệ thống AVI/AOI Management có tính năng tự động phát hiện và yêu cầu tạo tài khoản admin trong lần triển khai đầu tiên.

## Luồng Hoạt Động

### 1. Lần Truy Cập Đầu Tiên

Khi chưa có admin trong hệ thống:

1. Người dùng truy cập trang chủ (`/`) hoặc trang đăng nhập (`/login`)
2. Hệ thống tự động kiểm tra xem đã có admin chưa
3. Nếu chưa có admin → tự động chuyển hướng đến `/setup`
4. Hiển thị form tạo tài khoản admin đầu tiên

### 2. Tạo Tài Khoản Admin

**Trang Setup:** `http://localhost:3000/setup`

**Thông tin cần nhập:**
- **Tên đăng nhập:** Tối thiểu 3 ký tự, tối đa 50 ký tự
- **Email:** Địa chỉ email hợp lệ
- **Tên:** Tên đầy đủ của admin
- **Mật khẩu:** Tối thiểu 8 ký tự
- **Xác nhận mật khẩu:** Phải khớp với mật khẩu

**Sau khi tạo thành công:**
- Hệ thống hiển thị thông báo thành công
- Tự động chuyển hướng đến trang đăng nhập sau 1.5 giây
- Admin có thể đăng nhập bằng thông tin vừa tạo

### 3. Đăng Nhập Sau Khi Setup

**Trang Login:** `http://localhost:3000/login`

1. Chọn tab **"Nội bộ"** (Local Login)
2. Nhập tên đăng nhập và mật khẩu đã tạo
3. Nhấn **"Đăng nhập"**
4. Nếu thành công → chuyển đến dashboard

## API Endpoints

### Check Setup Required
Kiểm tra xem có cần setup admin không:

```bash
GET /trpc/auth.checkSetupRequired
```

**Response:**
```json
{
  "result": {
    "data": {
      "required": true,
      "message": "Cần tạo tài khoản admin đầu tiên"
    }
  }
}
```

### Setup Admin
Tạo tài khoản admin đầu tiên:

```bash
POST /trpc/auth.setupAdmin
Content-Type: application/json

{
  "username": "admin",
  "email": "admin@example.com",
  "name": "Administrator",
  "password": "admin123456"
}
```

**Response (Success):**
```json
{
  "result": {
    "data": {
      "success": true,
      "userId": 1
    }
  }
}
```

**Response (Error - Admin Exists):**
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Admin already exists"
  }
}
```

## Bảo Mật

### Chính Sách
1. **Chỉ được tạo 1 admin duy nhất qua /setup**
   - Sau khi có admin, endpoint này sẽ trả về lỗi
   - Các admin khác phải được tạo thông qua trang quản lý user

2. **Validation mật khẩu**
   - Tối thiểu 8 ký tự
   - Nên sử dụng mật khẩu mạnh kết hợp chữ, số và ký tự đặc biệt

3. **Mã hóa mật khẩu**
   - Mật khẩu được mã hóa bằng bcrypt với salt rounds = 10
   - Không bao giờ lưu mật khẩu dạng plain text

### Khuyến Nghị

⚠️ **QUAN TRỌNG:**
- Đổi mật khẩu mặc định ngay sau lần đăng nhập đầu tiên
- Sử dụng mật khẩu mạnh và duy nhất
- Không chia sẻ thông tin đăng nhập admin
- Bật xác thực 2 bước (2FA) sau khi đăng nhập

## Test Setup Functionality

Chạy script test để kiểm tra chức năng:

```bash
node test-setup.mjs
```

Script này sẽ:
1. Kiểm tra xem có cần setup không
2. Thử tạo admin user
3. Xác nhận lại trạng thái setup

## Troubleshooting

### Không thể truy cập /setup
**Nguyên nhân:** Admin đã tồn tại
**Giải pháp:** Đăng nhập bằng tài khoản admin hiện có hoặc reset database

### Lỗi "Admin already exists"
**Nguyên nhân:** Đã có admin trong hệ thống
**Giải pháp:** Sử dụng chức năng quên mật khẩu hoặc liên hệ admin hiện tại

### Redirect loop /setup → /login → /setup
**Nguyên nhân:** Lỗi query hoặc database không phản hồi
**Giải pháp:** Kiểm tra kết nối database và logs

## Database Schema

Thông tin admin được lưu trong bảng `users`:

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  openId VARCHAR(64) NOT NULL UNIQUE,
  username VARCHAR(100) UNIQUE,
  passwordHash VARCHAR(255),
  name TEXT,
  email VARCHAR(320),
  role VARCHAR(20) DEFAULT 'user', -- 'admin' | 'user'
  isActive BOOLEAN DEFAULT true,
  loginMethod VARCHAR(64), -- 'local'
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);
```

## Quy Trình Phục Hồi

Nếu cần reset admin (môi trường dev):

```bash
# Option 1: Xóa tất cả admin
DELETE FROM users WHERE role = 'admin';

# Option 2: Reset specific admin
DELETE FROM users WHERE username = 'admin';

# Sau đó truy cập /setup để tạo admin mới
```

## Liên Hệ

Nếu cần hỗ trợ, vui lòng liên hệ team development.
