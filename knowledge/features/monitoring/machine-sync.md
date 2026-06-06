# Đồng bộ Máy (Machine Sync)

## Mục đích
Đồng bộ cấu hình điểm đo, ngưỡng và metadata giữa server trung tâm và máy AOI tại line, đảm bảo máy luôn dùng đúng phiên bản cấu hình mới nhất.

## Vị trí truy cập
- Menu: `Monitoring` › `Máy` › nút `Sync` trên từng máy
- URL: `/machines` (action button)
- Endpoint trực tiếp: `POST /api/machine/sync-points`
- Vai trò: admin, engineer

## Quyền yêu cầu
- Resource: `machine`
- Actions: `sync`
- Middleware: `requirePermission('machine_status')`

## Tiền điều kiện
- Máy đã đăng ký (`machines.status='active'`).
- Sản phẩm đã gán cho máy (`product_machine_mappings`).
- Điểm đo đã được tạo (`measurement_point_defs`) và published version mới nhất.

## Các bước thao tác
1. **Vào danh sách máy** — `Monitoring › Machines`.
2. **Chọn máy** — click máy cần sync, mở detail panel.
3. **Nhấn `Sync Points`** — confirm dialog hiện tổng số điểm đo sẽ gửi.
4. **Theo dõi tiến độ** — progress bar realtime; status `pending → syncing → done/failed`.
5. **Kiểm tra log** — Tab `Sync Logs` hiển thị lịch sử sync với timestamp và checksum.

## Kết quả mong đợi
- Bản ghi mới trong `sync_logs` với `status='success'`.
- Máy nhận cấu hình mới qua MQTT topic `factory/{id}/machine/{id}/config`.
- `measurement_point_versions.deployed_at` cập nhật.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `status='failed'` | Máy offline | Kiểm tra MQTT connection, ping máy |
| Checksum mismatch | Máy đang chạy version cũ | Restart agent trên máy rồi sync lại |
| Timeout 30s | Mạng kém | Sync vào giờ ít tải, tăng `MACHINE_SYNC_TIMEOUT` |

## API liên quan
- `POST /api/machine/sync-points` — body `{ machineId, productModelId }`, response `{ syncId, count, checksum }`.
- `GET /api/machine/:id/sync-logs` — danh sách lần sync gần nhất.

## Tính năng liên quan
- [Đăng ký Máy](../monitoring/machine-registration.md) — phải xong trước khi sync.
- [Cấu hình Điểm đo](../products/measurement-point-setup.md) — nguồn cấu hình.
- [MQTT Dashboard](../monitoring/mqtt-dashboard.md) — kiểm tra kết nối khi sync fail.

## Ví dụ thực tế
Tình huống: "Engineer vừa cập nhật ngưỡng đo cho sản phẩm PCB-A, cần đẩy xuống 5 máy line A".
Bước: Vào Machines → filter Line A → chọn từng máy → Sync Points. Sau 2 phút thấy tất cả 5 máy `success`, checksum khớp. Verify bằng cách xem inspection mới có ngưỡng đúng.
