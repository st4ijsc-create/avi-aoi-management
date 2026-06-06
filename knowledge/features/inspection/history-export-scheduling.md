# Lịch xuất dữ liệu (History Export Scheduling)

## 1. Mục đích
Quản lý lịch trình xuất báo cáo kiểm tra **tự động**: tạo / sửa / xoá schedule, chọn format (CSV / Excel / PDF / HTML), bộ lọc kết quả (OK/NG/NTF), khoảng thời gian dữ liệu, danh sách email nhận. Hỗ trợ gửi test email và xem lịch sử các lần chạy.

## 2. Vị trí truy cập
- URL: `/history-export-scheduling`
- Menu: **Sản xuất › Lịch xuất dữ liệu**
- File trang: `client/src/pages/HistoryExportScheduling.tsx`

## 3. Quyền yêu cầu
- Permission key: `reports_schedule`
- Vai trò thường có: Supervisor, Manager, Admin.

## 4. Tiền điều kiện
- SMTP server đã cấu hình (host, port, user, password, from address).
- Email người nhận hợp lệ.
- Service `report-scheduler` đang chạy trên server.
- (Khuyến nghị) Đã có dữ liệu kiểm tra để báo cáo không bị trống.

## 5. Các bước thao tác
1. Mở **Sản xuất › Lịch xuất dữ liệu** hoặc truy cập `/history-export-scheduling`.
2. Xem bảng các schedules hiện có với cột: Tên, Tần suất (`DAILY`/`WEEKLY`/`MONTHLY`), Giờ chạy, Format, Trạng thái Active, Last run, Next run, Status.
3. Bấm **Create Schedule** để tạo mới. Trong dialog nhập:
   - **Name**, **Description**.
   - **Schedule**: `DAILY` / `WEEKLY` / `MONTHLY`. Với WEEKLY chọn `dayOfWeek`; với MONTHLY chọn `dayOfMonth`.
   - **Schedule Time** (giờ chạy, ví dụ `07:00`).
   - **Report Format**: `HTML` / `PDF` / `EXCEL`.
   - **Report Type**: `NG_VISUAL` / `DAILY_SUMMARY` / `WEEKLY_SUMMARY` / `MONTHLY_SUMMARY` / `CUSTOM`.
   - **Recipients**: danh sách email (cách nhau dấu phẩy hoặc enter).
   - **Phạm vi**: chọn `factoryId` / `workshopId` / `lineId` (tuỳ chọn để giới hạn).
   - **Includes** (checkbox): `includeWorkstationHeatmap`, `includeTopNGPoints`, `includeTrendChart`, `includeComparison`.
   - **Branding** (tuỳ chọn): `logoUrl`, `primaryColor`, `footerText`.
   - Bấm **Save** để tạo. Hệ thống tính `nextScheduledAt`.
4. Bấm **Edit** trên một schedule để cập nhật bất kỳ field nào.
5. Bấm toggle **Active / Inactive** để bật / tắt schedule mà không xoá.
6. Bấm **Send Test** để gửi báo cáo test ngay tới recipients (tốt cho việc kiểm tra format / SMTP).
7. Bấm **View Logs** để xem lịch sử chạy: time, status (`SUCCESS`/`FAILED`/`RUNNING`), record count, recipients delivered, error message.
8. Bấm **Delete** để xoá schedule (kèm logs liên quan); xác nhận trong dialog.

## 6. Kết quả mong đợi
- Schedule mới được lưu, hiển thị trong bảng với `nextScheduledAt` đúng.
- Khi đến giờ, service `report-scheduler` sinh báo cáo theo format cấu hình và gửi tới recipients.
- **Send Test** trả về `success: true, message: "..."`; recipients nhận email test.
- Tab Logs cập nhật mỗi lần chạy (`SUCCESS` hoặc `FAILED` + lý do).
- Toggle Active/Inactive thay đổi `isActive` mà không xoá schedule.

## 7. Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| **Send Test** báo lỗi | SMTP chưa cấu hình; sai host/port/user; firewall chặn 587/465 | Kiểm tra biến môi trường SMTP; test telnet tới SMTP; kiểm tra log server |
| Email nhận được nhưng báo cáo trống | Không có dữ liệu trong khoảng thời gian; filter quá hẹp | Mở rộng `reportType` / phạm vi factory; verify dữ liệu trong DB |
| Schedule không chạy đúng giờ | `isActive = false`; service `report-scheduler` dừng; sai timezone server | Bật Active; restart service; đối chiếu `nextScheduledAt` với giờ server |
| Attachment hỏng / không mở được | Format không hỗ trợ một số ký tự; lỗi sinh PDF | Đổi sang `EXCEL` hoặc `HTML` để test; kiểm tra log lỗi sinh report |
| Email vào spam | Sender domain chưa SPF/DKIM | Cấu hình DNS records cho domain gửi |

## 8. API liên quan
- tRPC `scheduledReport.list` – danh sách schedules.
- tRPC `scheduledReport.getById` – chi tiết một schedule.
- tRPC `scheduledReport.create` – tạo mới.
- tRPC `scheduledReport.update` – cập nhật / toggle Active.
- tRPC `scheduledReport.delete` – xoá.
- tRPC `scheduledReport.sendTest` – gửi test ngay.
- tRPC `scheduledReport.getLogs` – lịch sử chạy.
- Bảng DB: `scheduled_reports`, `scheduled_report_logs`.

## 9. Tính năng liên quan
- **Lịch sử kiểm tra** (`history.md`) – nguồn dữ liệu báo cáo (xuất tay từ trang này).
- **Phân quyền** – cấp `reports_schedule` cho người được lập lịch.

## 10. Ví dụ thực tế
> Manager muốn nhận báo cáo NG hàng ngày 7:00 sáng cho line `LINE-1`:
> 1. Vào **Sản xuất › Lịch xuất dữ liệu** → bấm **Create Schedule**.
> 2. Điền: Name = `Báo cáo NG hàng ngày Line 1`, Schedule = `DAILY`, Time = `07:00`, Format = `EXCEL`, Report Type = `DAILY_SUMMARY`, Line = `LINE-1`.
> 3. Recipients: `manager@company.com, qc.lead@company.com`.
> 4. Tích `includeTopNGPoints`, `includeTrendChart`, `includeWorkstationHeatmap`.
> 5. Bấm **Save** → schedule xuất hiện với `nextScheduledAt = ngày mai 07:00`.
> 6. Bấm **Send Test** ngay để xác nhận email và format. Nếu OK, để Active.
> 7. Sáng hôm sau kiểm tra **View Logs**: status `SUCCESS`, record count > 0, delivered = 2.
