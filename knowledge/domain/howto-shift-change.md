# Hướng dẫn đổi ca làm việc (Shift change)

> **Đối tượng**: công nhân, trưởng ca, IT admin (cấu hình ca).

## 1. Bối cảnh

Hệ thống AVI-AOI ghi nhận sản lượng / NG / KPI theo **ca làm việc** (shift). Mỗi sản phẩm được scan đều gắn `shiftId`. Việc đổi ca đúng quy trình bảo đảm:

- Báo cáo theo ca chính xác (Sản lượng A vs B vs C).
- Bàn giao trạng thái máy / lô đang chạy giữa hai ca.
- Phân quyền truy cập đúng người đang trực.

## 2. Cấu hình ca

`Menu › Cài đặt › Quản lý ca làm việc`

| Trường | Mô tả |
|--------|-------|
| `name` | Tên ca (vd. "Ca A", "Ca đêm"). |
| `startTime` | Giờ bắt đầu (HH:mm, theo timezone Asia/Ho_Chi_Minh). |
| `endTime` | Giờ kết thúc. Có thể qua nửa đêm (vd. 22:00 → 06:00). |
| `isActive` | Bật/tắt ca. |

> Chỉ user có role `admin` hoặc `production_manager` được sửa cấu hình ca.

## 3. Quy trình đổi ca tại line

| Bước | Thao tác |
|------|----------|
| 1 | Trưởng ca đến trước giờ giao 10 phút, mở `Menu › Sản xuất › Bàn giao ca`. |
| 2 | Hệ thống tự liệt kê: lô đang chạy, sản lượng tích lũy, NG count, máy offline, alert chưa xử lý. |
| 3 | Trưởng ca cũ điền **ghi chú bàn giao** (vd. "Máy AOI-02 bị nhiễu sáng, đã giảm threshold"). Bấm **"Hoàn tất bàn giao"**. |
| 4 | Hệ thống chốt ca: gán `shiftEndedAt`, tạo bản ghi `ShiftHandover`. |
| 5 | Trưởng ca mới đăng nhập, bấm **"Nhận ca"** → hệ thống mở ca mới, áp dụng `shiftId` cho mọi quét tiếp theo. |
| 6 | Công nhân tiếp tục vận hành; khi quét sản phẩm, `shiftId` mới đã được gắn tự động. |

## 4. Lưu ý

- **Không reboot máy AOI** trong khoảng 5 phút trước/sau giờ chuyển ca để tránh mất event.
- Nếu có lô chưa kết thúc, lô đó **không bị split** giữa hai ca; sản lượng tích lũy được phân bổ theo `scannedAt`.
- Báo cáo ca xem tại `Menu › Báo cáo › Sản lượng theo ca`.

## 5. FAQ

- **Quên bấm "Nhận ca" thì sao?** Hệ thống vẫn ghi nhận sản phẩm vào ca theo giờ chấm; nhưng sẽ không có `ShiftHandover` record → báo cáo bàn giao sẽ trống. Bù lại bằng nút **"Bổ sung bàn giao"**.
- **Sai timezone?** Kiểm tra `TZ` trên server (mặc định `Asia/Ho_Chi_Minh`). Nếu sai, mọi cột giờ đều lệch 7h.
