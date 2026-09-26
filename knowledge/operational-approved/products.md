---
trang_thai: da_duyet
nguon: AI sinh tu ma nguon — CHU DU AN DA DUYET 2026-08-17
sinh_luc: 2026-08-17
route: /products
permission: settings_products
role: []
module: MOD_DATA_MANAGEMENT
license: OPTIONAL
nguoi_duyet: chu du an
ngay_duyet: 2026-08-17
do_day: nhieu_o_trong
o_trong: 4
---

> **THẺ VẬN HÀNH — ĐÃ DUYỆT** (chủ dự án, 2026-08-17). Dùng được làm căn cứ vận hành.
> Dòng nào ghi **CHƯA GHI LẠI** là quy trình nhà máy **chưa có tài liệu** — khi được hỏi đúng chỗ đó
> hãy trả lời thẳng là *chưa được ghi lại*, không suy đoán và không thay bằng tài liệu kỹ thuật nội bộ.

# Sản phẩm — xử lý sự cố & thao tác

## Thông tin đã xác minh từ mã nguồn
- **Đường dẫn**: `/products`
- **Menu**: Quản lý dữ liệu › Sản phẩm
- **Quyền yêu cầu**: `settings_products`
- **Vai trò giới hạn**: không giới hạn theo vai trò
- **Module / license**: `MOD_DATA_MANAGEMENT` — OPTIONAL (cần license)
- **Router tRPC**: `productModelRouter` (server/routers/productRouters.ts, ~121 thủ tục)
- **Thao tác có thật ở backend**: `list`, `getById`, `getByCode`, `getReadiness`, `getReadinessBatch`, `create`, `update`, `delete`, `clone`, `exportList`, `importList`, `listByProductModel`, `listByMachine`, `unmappedRate` … (+29)

## Triệu chứng thường gặp

- ⬜ **CHƯA GHI LẠI** — liệt kê 3–5 sự cố người dùng thực sự gặp ở màn hình này

## Nguyên nhân thường gặp

- Thiếu quyền `settings_products` ⇒ màn hình có thể hiện rỗng thay vì báo lỗi rõ ràng.
- Module `MOD_DATA_MANAGEMENT` không có trong license đang cài ⇒ route bị chặn.
- ⬜ **CHƯA GHI LẠI** — nguyên nhân nghiệp vụ đặc thù của màn hình này

## Các bước xử lý

1. Mở `/products` (menu: Quản lý dữ liệu › Sản phẩm).
2. ⬜ **CHƯA GHI LẠI** — các bước thao tác cụ thể — cần người vận hành mô tả

## Cách xác nhận đã xong

- ⬜ **CHƯA GHI LẠI** — dấu hiệu quan sát được chứng tỏ sự cố đã được xử lý
