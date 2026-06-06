# Hướng dẫn — Cấu hình SSO / OAuth cho AVI/AOI Management

> **Đối tượng**: quản trị hệ thống, IT corporate.
> **Phạm vi**: tích hợp đăng nhập với Azure Entra ID (Azure AD), Google Workspace, hoặc OIDC nội bộ (Keycloak).
> **Module**: `Cài đặt › Bảo mật › Đăng nhập một lần (SSO)`.

## 1. Tổng quan

Hệ thống hỗ trợ 3 chế độ đăng nhập song song:

1. **Local** — username/password (mặc định).
2. **OIDC / OAuth 2.0** — Azure Entra ID, Google, Keycloak, Okta…
3. **LDAP** (chỉ enterprise) — tích hợp Active Directory nội bộ.

Khi bật SSO, người dùng vẫn có thể đăng nhập local (admin fallback). Tài khoản SSO mới sẽ được tạo tự động khi đăng nhập lần đầu (just-in-time provisioning) với role mặc định `viewer`.

## 2. Cấu hình Azure Entra ID

### 2.1. Trong Azure Portal

1. **Microsoft Entra ID › App registrations › New registration**.
2. Tên: `AVI AOI Management`.
3. Redirect URI: `https://<your-domain>/api/auth/oidc/callback` (Web).
4. Sau khi tạo, ghi lại:
   - **Application (client) ID** → `AZURE_CLIENT_ID`.
   - **Directory (tenant) ID** → `AZURE_TENANT_ID`.
5. Vào **Certificates & secrets › New client secret**, ghi lại **Value** → `AZURE_CLIENT_SECRET`.
6. **API permissions › Add → Microsoft Graph → Delegated**: `openid`, `profile`, `email`, `User.Read`.

### 2.2. Trong file `.env`

```ini
SSO_PROVIDER=azure
AZURE_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_CLIENT_SECRET=<secret value>
SSO_REDIRECT_URI=https://aoi.company.local/api/auth/oidc/callback
SSO_DEFAULT_ROLE=viewer
```

Restart server. Trang đăng nhập sẽ hiển thị nút **"Đăng nhập với Microsoft"**.

## 3. Cấu hình Google Workspace

```ini
SSO_PROVIDER=google
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxx
SSO_REDIRECT_URI=https://aoi.company.local/api/auth/oidc/callback
SSO_ALLOWED_DOMAINS=company.com,company.vn
SSO_DEFAULT_ROLE=viewer
```

`SSO_ALLOWED_DOMAINS` chặn email ngoài tổ chức.

## 4. Cấu hình OIDC chung (Keycloak / Okta / Authentik)

```ini
SSO_PROVIDER=oidc
OIDC_ISSUER_URL=https://sso.company.local/realms/avi
OIDC_CLIENT_ID=avi-aoi
OIDC_CLIENT_SECRET=<secret>
SSO_REDIRECT_URI=https://aoi.company.local/api/auth/oidc/callback
OIDC_SCOPES=openid profile email
SSO_DEFAULT_ROLE=viewer
```

Hệ thống tự discovery `${OIDC_ISSUER_URL}/.well-known/openid-configuration`.

## 5. Map role từ provider → role hệ thống

Mặc định mọi tài khoản SSO mới có role `viewer`. Để map theo group:

```ini
SSO_ROLE_MAP_GROUP_CLAIM=groups
SSO_ROLE_MAP={"AVI-Admins":"admin","AVI-QA-Lead":"manager","AVI-Engineers":"technician"}
```

Khi token có `groups: ["AVI-QA-Lead"]`, user sẽ được set role `manager`. Cập nhật role mỗi lần đăng nhập.

## 6. Quy trình đăng nhập SSO trên UI

1. Mở trang login → bấm **"Đăng nhập với Microsoft / Google / SSO"**.
2. Trình duyệt redirect sang IdP, xác thực, redirect lại `/api/auth/oidc/callback`.
3. Server validate token, tìm/tạo user theo `email`, sinh session cookie.
4. Redirect về Dashboard.

## 7. Đăng nhập admin fallback

Ngay cả khi SSO bật, vẫn có thể đăng nhập local bằng admin:
- URL: `/login?local=1`.
- User: `admin` / mật khẩu hiện tại.

Dùng khi IdP down hoặc cần khôi phục cấu hình.

## 8. Troubleshooting

| Lỗi | Nguyên nhân | Cách xử lý |
|---|---|---|
| `redirect_uri_mismatch` | URI trong `.env` khác URI đăng ký ở IdP | Sửa cho khớp 100 % (kể cả http/https, port) |
| Đăng nhập xong vẫn quay về login | Cookie chặn (Secure cookie nhưng đang chạy http) | Bật HTTPS hoặc tạm `COOKIE_SECURE=false` cho dev |
| User mới không được tạo | `SSO_ALLOWED_DOMAINS` chặn email | Thêm domain hoặc xoá biến này |
| Role không đúng | Group claim sai tên | Kiểm tra token bằng jwt.io, sửa `SSO_ROLE_MAP_GROUP_CLAIM` |

## 9. Bảo mật

- Luôn bật HTTPS ở production. Cookie session set `HttpOnly`, `Secure`, `SameSite=Lax`.
- Lưu `*_CLIENT_SECRET` trong secret manager (KeyVault, Vault), KHÔNG commit `.env`.
- Bật MFA ở phía IdP — hệ thống không bypass MFA.
- Audit log mọi lần đăng nhập SSO (xem `Cài đặt › Audit Log`).

## 10. Liên kết

- Backup: `howto-backup-restore.md`.
- License & dev bypass: `howto-license-bypass-dev.md`.
