---
trang_thai: da_duyet
nguon: AI sinh tu ma nguon — CHU DU AN DA DUYET 2026-08-17
sinh_luc: 2026-08-17
route: /defect-catalog
permission: history_view
role: []
module: null
license: null
nguoi_duyet: chu du an
ngay_duyet: 2026-08-17
do_day: day_du
o_trong: 2
---

> **THẺ VẬN HÀNH — ĐÃ DUYỆT** (chủ dự án, 2026-08-17). Dùng được làm căn cứ vận hành.
> Dòng nào ghi **CHƯA GHI LẠI** là quy trình nhà máy **chưa có tài liệu** — khi được hỏi đúng chỗ đó
> hãy trả lời thẳng là *chưa được ghi lại*, không suy đoán và không thay bằng tài liệu kỹ thuật nội bộ.

# Danh mục lỗi — xử lý sự cố & thao tác

## Thông tin đã xác minh từ mã nguồn
- **Đường dẫn**: `/defect-catalog`
- **Menu**: Chất lượng › Danh mục lỗi
- **Quyền yêu cầu**: `history_view`
- **Vai trò giới hạn**: không giới hạn theo vai trò
- **Module / license**: `null` — OPTIONAL (cần license)
- **Router tRPC**: `defectCatalogRouter` (server/routers/productRouters.ts, ~121 thủ tục)
- **Thao tác có thật ở backend**: `list`, `getById`, `getByCode`, `getReadiness`, `getReadinessBatch`, `create`, `update`, `delete`, `clone`, `exportList`, `importList`, `listByProductModel`, `listByMachine`, `unmappedRate` … (+29)

## Triệu chứng thường gặp

- Loại lỗi cần dùng không có trong danh sách khi phân loại NG.
- Cùng một lỗi bị ghi bằng hai tên khác nhau, báo cáo Pareto bị chia đôi.

## Nguyên nhân thường gặp

- Danh mục lỗi là dữ liệu chủ dùng chung — thêm/sửa ở đây ảnh hưởng mọi báo cáo về sau.
- Trùng tên do nhập tay ở hai thời điểm; báo cáo nhóm theo mã lỗi nên hai mã khác nhau không gộp được.
- Màn hình đọc theo quyền `history_view`.

## Các bước xử lý

- Mở `/defect-catalog`, tìm theo cả tên tiếng Việt lẫn mã trước khi tạo mới — tránh đẻ thêm bản trùng.
- Nếu đã trùng: thống nhất một mã chuẩn, ghi lại mã bị loại, rồi xử lý dữ liệu cũ.
- ⬜ **CHƯA GHI LẠI** — cách xử lý dữ liệu lịch sử đã gắn mã lỗi bị loại — gộp hay giữ nguyên (cần chốt với QA)
- ⬜ **CHƯA GHI LẠI** — ai được thêm/sửa danh mục lỗi và quy trình duyệt

## Cách xác nhận đã xong

- Phân loại NG tại line chọn được đúng loại lỗi cần dùng.
- Báo cáo Pareto không còn hai dòng cho cùng một hiện tượng.
