# Báo cáo định kỳ

## Mục đích
Lên lịch tự động chạy report template và gửi qua email/Teams/file share theo cron — tránh phải thao tác thủ công mỗi ngày/tuần.

## Vị trí truy cập
- Menu: `Analytics` › `Reports` › `Scheduled`
- URL: `/analytics/scheduled-reports`
- Vai trò: admin, manager

## Quyền yêu cầu
- Resource: `report`
- Actions: `schedule`, `view`
- Middleware: `requirePermission('reports_schedule')`

## Tiền điều kiện
- Đã có report template (xem Report Builder).
- SMTP/Teams webhook đã cấu hình trong System Settings.

## Các bước thao tác
1. **Mở danh sách** — Bảng `name`, `template`, `cron`, `nextRun`, `lastStatus`, `enabled`.
2. **+ New Schedule** — Chọn template, nhập:
   - `Cron expression` (vd `0 7 * * *` = 7h sáng).
   - `Recipients` (email list, Teams channel).
   - `Format` (PDF, Excel, PPT).
   - `Time range relative` (vd: yesterday, last 7 days).
3. **Save & Enable** — Tạo job trong queue.
4. **Test Run** — Nút `Run Now` chạy ngay lập tức để verify.
5. **Xem log** — Tab `History` (`scheduled_report_logs`) — status, duration, recipient delivery.
6. **Pause/Disable** — Toggle `enabled`.

## Kết quả mong đợi
- Job chạy đúng lịch, gửi file đính kèm tới recipients.
- `lastStatus` = `success` với timestamp.
- Email có subject `[Report] {name} - {date}`.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Email không đến | SMTP sai | Check System Settings → SMTP test |
| Cron không chạy | `enabled=false` hoặc server restart | Bật lại, kiểm tra scheduler service |
| File quá lớn | Time range rộng | Giảm range hoặc chia nhỏ template |

## API liên quan
- `tRPC: scheduledReport.list / create / update / runNow / delete`.

## Tính năng liên quan
- [Report Builder](../analytics/report-builder.md) — nguồn template.
- [Báo cáo PDF](../analytics/reports.md) — output engine.

## Ví dụ thực tế
Tình huống: "Gửi Daily NG Report tới giám đốc nhà máy 7h sáng mỗi ngày".
Bước: New schedule, template `Daily NG Report`, cron `0 7 * * *`, format PDF, recipient `gd@factory.vn`, range = yesterday. Test Run → nhận email OK → Enable.
