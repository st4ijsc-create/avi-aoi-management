# Cấu hình Ca làm việc (Shift Configuration)

## Mục đích
Định nghĩa các ca làm việc (shift) trong nhà máy: tên, giờ bắt đầu/kết thúc, ngày trong tuần — dùng để aggregate dữ liệu theo ca, tính OEE, lương, productivity.

## Vị trí truy cập
- Menu: `Settings` › `Shift Config`
- URL: `/settings/shifts`
- Vai trò: admin, hr-manager

## Quyền yêu cầu
- Resource: `shift_config`
- Actions: `view`, `create`, `update`, `delete`
- Middleware: `requirePermission('settings_view')`

## Tiền điều kiện
- Hệ thống đã cài timezone đúng (`SYSTEM_TZ=Asia/Ho_Chi_Minh`).

## Các bước thao tác
1. **Mở danh sách** — Bảng `name`, `startTime`, `endTime`, `daysOfWeek`, `enabled`.
2. **+ New Shift** — Nhập:
   - `Name`: vd `Ca Sáng`, `Ca Chiều`, `Ca Đêm`.
   - `Start time`: `06:00`.
   - `End time`: `14:00`.
   - `Days of week`: Mon-Sat hoặc Mon-Sun.
   - `Color` (cho biểu đồ).
3. **Save** — Lưu `shift_configs`.
4. **Test mapping** — Nút `Preview`: nhập timestamp → trả về shift tương ứng.
5. **Disable** — Toggle `enabled` thay vì xóa để giữ data lịch sử.

## Kết quả mong đợi
- Inspection mới được auto-tag `shiftId`.
- Reports group-by-shift hoạt động đúng.
- Overlap shift → cảnh báo và không cho save.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Shift overlap | 2 shift cùng giờ | Chỉnh start/end |
| Inspection sai shift | Server timezone khác | Set `SYSTEM_TZ` đúng |
| Ca đêm cross-midnight không tính | Logic không hỗ trợ | Tách thành 2 segment hoặc bật flag `crossMidnight=true` |

## API liên quan
- `tRPC: shiftConfig.list / create / update / delete / preview`.

## Tính năng liên quan
- [OEE Dashboard](../monitoring/oee-dashboard.md) — group by shift.
- [Quản lý Người dùng](../admin/user-management.md) — gán shift cho operator.

## Ví dụ thực tế
Tình huống: "Nhà máy 3 ca: 6h-14h, 14h-22h, 22h-6h, T2-T7".
Bước: Tạo 3 shift với giờ tương ứng. Ca đêm bật `crossMidnight=true`. Preview với `2026-01-15 23:30` → trả về `Ca Đêm`. Verify reports group đúng.
