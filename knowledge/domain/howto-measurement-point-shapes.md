# Hướng dẫn — Cấu hình hình dạng điểm đo (measurement point shapes)

> **Đối tượng**: kỹ sư AOI, kỹ sư sản phẩm.
> **Module**: Sản phẩm › Measurement Points (`/products/:id/points`).

## 1. Khái niệm

Mỗi **điểm đo** (measurement point) gắn một **vùng quan tâm (ROI)** trên ảnh mẫu sản phẩm. Khi máy AOI chụp sản phẩm thật, hệ thống dùng ROI này để đối chiếu (template matching, AI classify, đo kích thước…) và sinh kết quả OK / NG cho từng điểm.

Bảng schema: `measurement_point_defs` (cột `shape`, `coordinates`, `pointType`, `tolerance`).

## 2. Các hình dạng được hỗ trợ

| Shape | Mã `shape` | Tham số `coordinates` | Khi nào dùng |
|---|---|---|---|
| Hình chữ nhật | `rect` | `{x, y, width, height}` | Linh kiện chữ nhật (IC, connector, tụ tantal) |
| Hình tròn | `circle` | `{cx, cy, r}` | Tụ tròn, lỗ vít, chân hàn BGA đơn |
| Hình vành khăn (ring) | `ring` | `{cx, cy, rOuter, rInner}` | Solder ring quanh chân tụ/IC, kiểm tra void hàn |
| Đa giác (polygon) | `polygon` | `{points: [{x,y}, ...]}` (≥3 điểm) | Linh kiện hình thù bất quy tắc, vùng kiểm hoa văn |
| Đường (line) | `line` | `{x1,y1,x2,y2}` | Đo độ thẳng, kiểm cạnh |
| Fiducial | `fiducial` | `{cx, cy, r, code}` | Mark định vị — KHÔNG tính NG, dùng để align ảnh |

> **Đơn vị toạ độ** phụ thuộc cột `coordinateMode` của Product Model:
> - `pixel` (mặc định) — số nguyên pixel trên ảnh gốc.
> - `mm` — milimét, hệ trục gốc trái-trên là (0,0).

## 3. Cách thêm điểm đo trên UI

1. Mở `Menu › Sản phẩm › chọn model → tab Measurement Points`.
2. Bấm **+ Thêm điểm** → chọn loại shape từ thanh công cụ.
3. Vẽ trực tiếp lên ảnh mẫu:
   - Rect/Circle: kéo thả.
   - Ring: vẽ vòng tròn ngoài → vẽ vòng tròn trong.
   - Polygon: click từng đỉnh, double-click để đóng.
   - Fiducial: bấm vị trí + nhập mã (F1, F2…).
4. Bên phải, điền:
   - **Mã điểm** (vd. `P-IC1-PIN1`).
   - **Loại đo** (`pointType`): `presence` | `polarity` | `dimension` | `solder-quality` | `text-OCR` | …
   - **Tolerance**: ngưỡng % cho phép sai lệch (vd. dimension ±0.1mm).
   - **AI model** (tuỳ chọn): chọn model AI gắn riêng cho điểm này.
5. Bấm **Lưu** → `pointsConfigVersion` của model tự tăng → các máy AOI sẽ pull config mới ở chu kỳ heartbeat tiếp theo.

## 4. Quy tắc fiducial

- Tối thiểu **2 fiducial** trên 1 sản phẩm để align xoay/dịch.
- Khuyến nghị **3 fiducial** không thẳng hàng để align cả scale.
- Fiducial KHÔNG được trùng vị trí với điểm đo thật (giữ khoảng cách ≥ 5mm).
- Khi máy AOI mất alignment (`fiducialMatchScore < 0.7`), toàn bộ điểm đo của khung đó bị bỏ qua và sản phẩm bị flag `NTF` (Need-To-Fix alignment).

## 5. Polygon — quy tắc chuyên biệt

- Tối thiểu 3 đỉnh, tối đa 64 đỉnh.
- Phải là đa giác đơn (không tự cắt). UI tự kiểm tra; nếu vi phạm sẽ chặn lưu.
- Khi convert giữa `pixel` và `mm`, hệ thống dùng `imageWidth` / `imageHeight` của Product Model để scale.

## 6. Ring — quy tắc

- `rInner < rOuter`. UI tự kiểm tra.
- Diện tích vùng đo = π(rOuter² - rInner²). Dùng cho:
  - Tính `valueArea` (mm²) khi điểm đo loại `solder-quality`.
  - Tính `valueVoidPct` khi gắn AI model phân tích void hàn.

## 7. Lưu ý vận hành

- Khi đổi shape của 1 điểm đo, KB không làm mất dữ liệu kiểm tra cũ — chỉ các kiểm tra mới dùng config mới.
- Sửa hàng loạt nhiều điểm: dùng tab **Bulk Edit** (chỉ admin) hoặc API `PATCH /api/products/:id/points/batch`.
- Để debug 1 điểm đo NG bất thường, mở `AOI Live View` → click điểm trên ảnh → panel bên phải hiển thị: ảnh ROI, giá trị đo, threshold, AI confidence.

## 8. API tham khảo

```http
POST /api/products/:productModelId/points
Content-Type: application/json

{
  "code": "P-IC1-PIN1",
  "shape": "ring",
  "coordinates": { "cx": 245, "cy": 312, "rOuter": 28, "rInner": 14 },
  "pointType": "solder-quality",
  "tolerance": { "voidPctMax": 25 },
  "aiModelId": 17
}
```

## 9. Liên kết

- Quy trình NG: `howto-ng-handling-sop.md`.
- SPC: `howto-spc-control.md`.
- Audit chi tiết module Products: `PRODUCTS_MEASUREMENT_POINTS_PHASE4_AUDIT.md`.
