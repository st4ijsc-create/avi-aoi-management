---
trang_thai: da_duyet
nguon: AI sinh tu ma nguon — CHU DU AN DA DUYET 2026-08-17
sinh_luc: 2026-08-17
route: /andon
permission: dashboard_view
role: []
module: CORE_DASHBOARD
license: CORE
nguoi_duyet: chu du an
ngay_duyet: 2026-08-17
do_day: day_du
nguon_quy_trinh_nha_may: chu du an cung cap 2026-08-18 (phieu _PHIEU_DIEN_7_O_TRONG.md)
o_trong: 0
---

> **THẺ VẬN HÀNH — ĐÃ DUYỆT** (chủ dự án, 2026-08-17). Dùng được làm căn cứ vận hành.
> Dòng nào ghi **CHƯA GHI LẠI** là quy trình nhà máy **chưa có tài liệu** — khi được hỏi đúng chỗ đó
> hãy trả lời thẳng là *chưa được ghi lại*, không suy đoán và không thay bằng tài liệu kỹ thuật nội bộ.

# Bảng Andon (TV) — xử lý sự cố & thao tác

## Thông tin đã xác minh từ mã nguồn
- **Đường dẫn**: `/andon`
- **Menu**: Tổng quan › Bảng Andon (TV)
- **Quyền yêu cầu**: `dashboard_view`
- **Vai trò giới hạn**: không giới hạn theo vai trò
- **Module / license**: `CORE_DASHBOARD` — CORE (luôn bật)
- **Router tRPC**: `andonRouter` (server/routers/andonRouter.ts, ~8 thủ tục)
- **Thao tác có thật ở backend**: `raise`, `quickReport`, `acknowledge`, `resolve`, `list`, `active`, `get`, `metrics`

## Triệu chứng thường gặp

- Gọi Andon xong không ai tới, bảng TV không đổi.
- Cảnh báo Andon đã xử lý xong nhưng vẫn còn trên bảng.
- Bảng Andon trên TV đứng hình / không tự cập nhật.

## Nguyên nhân thường gặp

- Andon có vòng đời ba nhịp — `raise` (gọi) → `acknowledge` (đã nhận) → `resolve` (đã xong). Dừng ở nhịp giữa thì cảnh báo vẫn còn hiện.
- Bảng TV lọc theo `active`; một mục đã `resolve` sẽ rời danh sách, còn mục mới `acknowledge` thì KHÔNG.
- Màn hình dùng quyền `dashboard_view` — tài khoản chỉ xem được, không bấm nhận được.
- **Kênh báo động thực tế CÓ nối vào hệ thống** — đèn/còi đi qua thiết bị IoT hoặc mạch điện tử, gửi tín hiệu thật về. Nghĩa là một lượt gọi Andon trên phần mềm CÓ ra tới hiện trường; nếu gọi rồi mà không ai tới, phải nghi cả đường tín hiệu (thiết bị IoT / mạch điện tử) chứ không chỉ nghi phần mềm.

## Các bước xử lý

- Mở `/andon`. Kiểm tra mục cần xử lý còn nằm ở danh sách đang hoạt động không.
- Người tiếp nhận bấm **Đã nhận** (`acknowledge`) — bước này chỉ ghi nhận, KHÔNG đóng cảnh báo.
- Sau khi xử lý xong tại line, bấm **Đã xử lý** (`resolve`) để cảnh báo rời bảng.
- Nếu bảng TV không đổi sau khi resolve: tải lại trang TV; nếu vẫn còn thì kiểm tra máy chạy TV có mất mạng không.
- **Thời gian phản hồi cam kết: 1 phút là mức thông thường, nhanh nhất 30 giây** — và ngưỡng này chỉnh được trong cài đặt. Đây là mức chung, nhà máy không đặt mức riêng theo loại Andon. Quá mốc mà chưa ai bấm `acknowledge` thì coi là bất thường, báo lên quản lý ca thay vì đứng chờ tiếp.

## Cách xác nhận đã xong

- Mục đã xử lý không còn trong danh sách `active`.
- Chỉ số ở mục **metrics** ghi nhận lần xử lý vừa rồi.
- **Người BÁO CÁO sự cố là người xác nhận cuối cùng** rằng đã khắc phục thật. Lượt bấm `resolve` chỉ là ghi nhận trên phần mềm; nếu người bấm `resolve` không phải người đã gọi Andon thì vẫn phải để người gọi xác nhận trước khi coi là xong.
