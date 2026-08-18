---
trang_thai: da_duyet
nguon: AI sinh tu ma nguon — CHU DU AN DA DUYET 2026-08-17
sinh_luc: 2026-08-17
route: /production-orders
permission: production_orders
role: []
module: MOD_PRODUCTION
license: OPTIONAL
nguoi_duyet: chu du an
ngay_duyet: 2026-08-17
do_day: day_du
nguon_quy_trinh_nha_may: chu du an cung cap 2026-08-18 (phieu _PHIEU_DIEN_7_O_TRONG.md)
o_trong: 0
---

> **THẺ VẬN HÀNH — ĐÃ DUYỆT** (chủ dự án, 2026-08-17). Dùng được làm căn cứ vận hành.
> Dòng nào ghi **CHƯA GHI LẠI** là quy trình nhà máy **chưa có tài liệu** — khi được hỏi đúng chỗ đó
> hãy trả lời thẳng là *chưa được ghi lại*, không suy đoán và không thay bằng tài liệu kỹ thuật nội bộ.

# Đơn hàng sản xuất — xử lý sự cố & thao tác

## Thông tin đã xác minh từ mã nguồn
- **Đường dẫn**: `/production-orders`
- **Menu**: Sản xuất › Đơn hàng sản xuất
- **Quyền yêu cầu**: `production_orders`
- **Vai trò giới hạn**: không giới hạn theo vai trò
- **Module / license**: `MOD_PRODUCTION` — OPTIONAL (cần license)
- **Router tRPC**: `productionOrderRouter` (server/routers/productionRouters.ts, ~36 thủ tục)
- **Thao tác có thật ở backend**: `list`, `getById`, `getByCode`, `checkScheduleOverlap`, `listTemplates`, `getTemplate`, `getWIPStatus`, `getWIPByLine`, `optimizeSchedule`, `compareScheduleKpi`, `listScheduleRuns`, `getScheduleRun`, `whatIf`

## Triệu chứng thường gặp

- Đơn hàng vừa tạo không xuất hiện trong danh sách.
- Không bấm được **Bắt đầu** cho lô ở line đang rảnh.
- Số WIP trên màn hình không khớp với đếm tay tại line.
- Tạo đơn báo trùng lịch với một đơn khác trên cùng line.

## Nguyên nhân thường gặp

- Thiếu quyền `production_orders` ⇒ danh sách trả về rỗng thay vì báo lỗi.
- Module `MOD_PRODUCTION` không nằm trong license đang cài ⇒ toàn bộ route bị chặn.
- Đơn đang ở trạng thái `planned` nhưng gán sai `lineId`, nên line hiện tại không thấy nó.
- Lịch chồng nhau — hệ thống có kiểm tra riêng cho việc này (thủ tục `checkScheduleOverlap`).
- WIP lệch: `getWIPStatus`/`getWIPByLine` tính theo sản phẩm đã scan; hàng chưa scan không được đếm.

## Các bước xử lý

- Mở `Menu › Sản xuất › Đơn hàng sản xuất` (`/production-orders`).
- Kiểm tra bộ lọc line/trạng thái trên thanh công cụ — danh sách mặc định có thể đang lọc.
- Nếu danh sách rỗng hoàn toàn: nhờ quản trị đối chiếu quyền `production_orders` cho tài khoản.
- Nếu trùng lịch: xem đơn đang chiếm khung giờ trên cùng line, dời `plannedStart` hoặc đổi line.
- Nếu WIP lệch: đối chiếu bằng `Menu › Sản xuất › Lịch sử` cho cùng khoảng thời gian trước khi kết luận là lỗi hệ thống.
- **Quản lý và người lập lịch** là hai vai được phép dời lịch / huỷ đơn. Người khác phát hiện trùng lịch thì báo cho họ, đừng tự dời — thao tác này kéo theo kế hoạch và vật tư.

## Cách xác nhận đã xong

- Đơn hiện đúng trạng thái mong muốn trong danh sách sau khi F5.
- Vòng đời lô đi đúng `planned → running → completed` (xem `knowledge/domain/howto-lot-management.md`).
- **Sai lệch WIP từ 10% trở lên là bất thường** — tới mức đó thì phải đi tìm nguyên nhân, dưới mức đó coi như dao động bình thường.
