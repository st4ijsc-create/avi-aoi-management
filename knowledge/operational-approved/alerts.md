---
trang_thai: da_duyet
nguon: AI sinh tu ma nguon — CHU DU AN DA DUYET 2026-08-17
sinh_luc: 2026-08-17
route: /alerts
permission: machine_status
role: []
module: null
license: null
nguoi_duyet: chu du an
ngay_duyet: 2026-08-17
do_day: day_du
nguon_quy_trinh_nha_may: chu du an cung cap 2026-08-18 (phieu _PHIEU_DIEN_7_O_TRONG.md)
o_trong: 0
---

> **THẺ VẬN HÀNH — ĐÃ DUYỆT** (chủ dự án, 2026-08-17). Dùng được làm căn cứ vận hành.
> Dòng nào ghi **CHƯA GHI LẠI** là quy trình nhà máy **chưa có tài liệu** — khi được hỏi đúng chỗ đó
> hãy trả lời thẳng là *chưa được ghi lại*, không suy đoán và không thay bằng tài liệu kỹ thuật nội bộ.

# Danh sách cảnh báo — xử lý sự cố & thao tác

## Thông tin đã xác minh từ mã nguồn
- **Đường dẫn**: `/alerts`
- **Menu**: Thiết bị & Giám sát › Danh sách cảnh báo
- **Quyền yêu cầu**: `machine_status`
- **Vai trò giới hạn**: không giới hạn theo vai trò
- **Module / license**: `null` — OPTIONAL (cần license)
- **Router tRPC**: `alertRouter` (server/routers/alertRouters.ts, ~19 thủ tục)
- **Thao tác có thật ở backend**: `list`, `getById`, `history`, `historyCursor`, `acknowledge`, `test`, `getByType`, `getEnabled`, `getHistory`, `getHistoryByType`, `getHistoryByThreshold`

## Triệu chứng thường gặp

- Cảnh báo dồn dập hàng loạt cùng lúc (bão cảnh báo).
- Máy có vấn đề nhưng không thấy cảnh báo nào.
- Đã bấm xác nhận nhưng cảnh báo vẫn quay lại.

## Nguyên nhân thường gặp

- Cảnh báo có bật/tắt theo từng loại — xem danh sách loại đang bật (`getEnabled`) trước khi kết luận là 'hệ thống không báo'.
- `acknowledge` chỉ đánh dấu ĐÃ ĐỌC; nếu điều kiện gây cảnh báo vẫn còn thì cảnh báo sẽ phát lại.
- Ngưỡng đặt quá nhạy ⇒ mỗi dao động nhỏ thành một cảnh báo. Ngưỡng nằm ở màn hình cấu hình ngưỡng, không ở đây.
- Màn hình dùng quyền `machine_status`.

## Các bước xử lý

- Mở `/alerts`, lọc theo máy và theo loại để xem cảnh báo có tập trung vào một nguồn không.
- Xem lịch sử (`history`) của đúng loại đó để biết nó mới phát sinh hay đã lặp lại lâu nay.
- Nếu là bão từ MỘT máy: xử lý máy đó trước, đừng xác nhận hàng loạt — xác nhận hàng loạt xoá mất dấu vết điều tra.
- Nếu là ngưỡng quá nhạy: chuyển sang màn hình cấu hình ngưỡng để chỉnh, ghi lý do.
- **Quản lý và kỹ sư** là hai vai được chỉnh ngưỡng cảnh báo. Người ngoài hai vai này muốn đổi ngưỡng thì đề nghị qua họ, đừng tự chỉnh.

## Cách xác nhận đã xong

- Sau khi xử lý nguồn, cảnh báo cùng loại không phát lại trong khoảng theo dõi.
- **Khoảng theo dõi: ít nhất 8 tiếng, thường là 24 tiếng.** Chưa đủ 8 tiếng thì chưa kết luận được là ngưỡng mới đã đúng — im lặng trong vài giờ đầu chưa phải bằng chứng.
