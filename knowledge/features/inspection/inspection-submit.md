# Submit Inspection (Nộp kết quả kiểm tra)

## Mục đích
Cho phép operator/máy nộp kết quả đo/kiểm cuối cùng cho 1 sản phẩm: tổng hợp các measurement, gắn defect (nếu có), kết luận Pass/Fail, lưu vào `inspections` để tracking và báo cáo.

## Vị trí truy cập
- UI Web: nút `Submit` ở trang `History.tsx` hoặc giao diện inspection workstation.
- API mobile/máy: `POST /api/machine/submit-inspection`.
- Vai trò: operator, inspector, máy có API key

## Quyền yêu cầu
- Resource: `inspection`
- Actions: `submit`, `view`
- Middleware: `requirePermission('history_view')` cho web; API key auth cho máy.

## Tiền điều kiện
- Có product/model đã định nghĩa measurement points.
- Đã thực hiện các phép đo / chụp ảnh.
- Quality gate (nếu có) chưa bị block.

## Các bước thao tác
1. **Operator chọn product + serial** trên UI hoặc máy quét barcode/QR.
2. **Nhập/import measurements** — tay hoặc auto từ thiết bị đo.
3. **Hệ thống đánh giá** — Mỗi measurement so với spec (USL/LSL) → flag `pass/fail`.
4. **Gắn defects** (nếu có) — Chọn từ catalog, gắn ảnh, vị trí trên layout.
5. **Confirm submit** — Hệ thống tính `result = pass nếu tất cả measurements pass và không có defect critical`.
6. **Lưu** — Insert `inspections` + `measurement_results` + `inspection_defects`.
7. **Trigger downstream** — Quality gate update, MQTT publish, alert nếu fail nhiều.

## Kết quả mong đợi
- Inspection xuất hiện trong History list ngay.
- KPI dashboard refresh trong < 1 phút.
- Nếu fail → tự động generate defect record.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Submit fail "missing required points" | Thiếu measurement bắt buộc | Đo lại đủ các điểm |
| Duplicate serial | Serial đã submit hôm nay | Check History; nếu re-test, tick `Rework` flag |
| Slow submit | Ảnh defect quá lớn | Resize trước upload (< 2MB) |

## API liên quan
- `tRPC: inspection.submit` (web).
- `POST /api/machine/submit-inspection` (máy, header `X-API-Key`).
- Schema: `{ machineId, productCode, serial, measurements: [{ pointId, value }], defects: [{ catalogId, imageUrl, location }], operatorId }`.

## Tính năng liên quan
- [Lịch sử Inspection](../inspection/inspection-history.md).
- [Sản phẩm & Điểm đo](../products/products-measurement-points.md).
- [Catalog Defect](../inspection/defect-catalog.md).
- [Quality Gates](../analytics/quality-gates.md).
- [MQTT Topics](../monitoring/mqtt-topics.md) — publish `inspection/result`.

## Ví dụ thực tế
Tình huống: "Operator hoàn tất đo PCB-A, 12 điểm OK, 1 điểm vượt USL".
Bước: Mở UI submit, scan serial. Hệ thống auto load measurements từ thiết bị. Phát hiện điểm `R5` lệch +0.05mm ngoài USL → flag fail. Operator chọn defect `Solder bridge`, chụp ảnh, gắn vị trí. Submit → result `Fail` → MQTT publish → quality gate increment NG counter.
