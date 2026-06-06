# Quản lý lô sản xuất (Production Lot)

> **Đối tượng**: kế hoạch sản xuất, trưởng line, QA, manager.

## 1. Khái niệm

Một **lô (lot)** là tập sản phẩm cùng một lệnh sản xuất (Production Order — `PO`/`MO`), cùng SKU, được scan trong khoảng thời gian liên tục. Mỗi lô có:

- `orderCode` — mã lệnh sản xuất (vd. `L20260505-001`).
- `productCode` — mã SKU.
- `plannedQty`, `actualQty`, `okQty`, `ngQty`.
- `status` — `planned`, `running`, `paused`, `completed`, `cancelled`.
- `startedAt`, `endedAt`, `lineId`, `shiftId`.

## 2. Vòng đời lô

```
planned → running → (paused ⇄ running) → completed
                                       ↘ cancelled
```

## 3. Tạo lô mới

`Menu › Sản xuất › Lệnh sản xuất › "Tạo lệnh"`.

| Trường bắt buộc | Mô tả |
|-----------------|-------|
| `orderCode` | Mã duy nhất, không trùng. Hệ thống auto-suggest theo format `L{YYYYMMDD}-NNN`. |
| `productCode` | Chọn SKU đã định nghĩa trong `Menu › Sản phẩm`. |
| `plannedQty` | Số lượng dự kiến. |
| `lineId` | Line/chuyền sẽ chạy. |
| `plannedStart` | Thời gian dự kiến bắt đầu. |

## 4. Chạy lô

1. Tại line, mở `Menu › Sản xuất › AOI Inspection › chọn line`.
2. Nếu line đang `idle`, hệ thống hiển thị danh sách lô `planned` cho line đó. Bấm **"Bắt đầu"** → trạng thái → `running`, `startedAt = now()`.
3. Mỗi sản phẩm scan đều gắn `lotId` của lô đang chạy.
4. Khi đủ `plannedQty` (hoặc bấm **"Kết thúc lô"**) → trạng thái → `completed`, `endedAt = now()`.

## 5. Tra cứu trạng thái lô

3 cách:

- **UI**: `Menu › Sản xuất › Lệnh sản xuất › nhập mã lô vào ô tìm`.
- **AI Assistant**: hỏi *"trạng thái lô L20260505-001"* (tool `get_lot_status`, cần mã chính xác).
- **API**: `GET /api/lots/:orderCode`.

Trả về: tiến độ %, OK/NG count, NG rate, máy đang chạy, ETA dự kiến.

## 6. Tạm dừng / Hủy lô

- **Tạm dừng** (`paused`): khi đổi ca, sự cố máy. Bấm **"Tạm dừng"** → ghi lý do bắt buộc.
- **Hủy** (`cancelled`): chỉ `production_manager` trở lên. Hệ thống yêu cầu xác nhận hai bước.

## 7. KPI lô

- **FPY** (First Pass Yield) = `okQty / actualQty × 100 %`.
- **NG rate** = `ngQty / actualQty × 100 %`.
- **Cycle time** = `(endedAt − startedAt) / actualQty`.

## 8. Lưu ý

- Một line **chỉ chạy 1 lô tại một thời điểm**. Muốn chuyển lô khác phải tạm dừng/kết thúc lô hiện tại.
- Lô `completed` KHÔNG thể chỉnh sửa số lượng; muốn sửa cần `production_manager` mở lại trạng thái.
- Nếu hệ thống mất kết nối DB (`DB_UNAVAILABLE`), scan vẫn vào hàng đợi local và đồng bộ khi DB phục hồi.

## 9. Liên kết

- Báo cáo theo lô: `Menu › Báo cáo › Sản lượng theo lô`.
- Truy xuất NG của lô: từ trang chi tiết lô → tab "Sản phẩm NG".
