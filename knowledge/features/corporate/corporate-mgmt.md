# Quản lý Tập đoàn (Corporate Management)

## Mục đích
Quản lý thông tin entity cấp corporate: tên công ty, logo, branding, contact, settings chung áp dụng toàn tập đoàn (timezone mặc định, fiscal year, ngôn ngữ).

## Vị trí truy cập
- Menu: `Corporate` › `Management`
- URL: `/corporate/management`
- Vai trò: admin, corporate-manager

## Quyền yêu cầu
- Resource: `corporate`
- Actions: `view`, `update`
- Middleware: `requirePermission('dashboard_corporate')`

## Tiền điều kiện
- Đã setup license với plan multi-factory.

## Các bước thao tác
1. **Mở trang** — Form chứa `Company name`, `Logo upload`, `Address HQ`, `Tax code`, `Default language`, `Default timezone`, `Fiscal year start`, `Currency`.
2. **Cập nhật info** — Edit field → Save → push update tới tất cả factory.
3. **Branding** — Upload logo (PNG/SVG ≤ 2MB), chọn primary/secondary color.
4. **Settings chung** — Toggle modules enable/disable, set default permissions.
5. **Multi-tenancy** (nếu hệ thống multi-tenant) — Quản lý thêm tenant ID.
6. **Audit** — Mọi thay đổi ghi `audit_logs`.

## Kết quả mong đợi
- Logo, color áp dụng ngay lên header tất cả page.
- Default timezone applied khi tạo factory mới.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Logo méo | Upload ratio sai | Dùng SVG hoặc resize 200x60 |
| Color không đổi | Cache CSS | Hard reload |

## API liên quan
- `tRPC: corporate.get / update / uploadLogo`.

## Tính năng liên quan
- [Cấu trúc Tổ chức](../corporate/corporate-layout.md).
- [Corporate Dashboard](../corporate/corporate-dashboard.md).
- [License Management](../admin/license-mgmt.md).

## Ví dụ thực tế
Tình huống: "Công ty đổi logo + brand color sang xanh navy".
Bước: Corporate Management → upload logo SVG mới → primary color `#1e3a8a` → Save. Toàn bộ user thấy header mới sau hard refresh. License vẫn hợp lệ với company name không đổi.
