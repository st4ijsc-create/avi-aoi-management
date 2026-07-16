# Measurement Geometry & Fiducial Marks — P1 API Reference

> **Scope**: P1 additive extensions cho Machine ↔ Server measurement-points sync. Tất cả field ở đây
> **backward compatible** — client cũ chỉ đọc `circle` bỏ qua được và vẫn chạy.
>
> ⚠️ **Cập nhật doc 51:** tài liệu cũ mô tả SAI gần hết geometry (dùng `rectangle`, `cx/cy/r`, `w/h`,
> `bbox/encoding/data`, `origin/cellSize/rowSpacing`…). Bản này viết lại **đúng theo zod THẬT** trong
> `server/lib/measurementGeometry.ts`. Payload theo tài liệu CŨ sẽ bị zod **REJECT**.

## 1. Coordinate modes

`productModels.coordinateMode` (cột, mặc định `"pixel"`), trả về trong `deltaSyncPoints` là `coordinateMode`:

| Value | Nghĩa |
|-------|-------|
| `pixel` | Mọi `positionX/Y`, `radius`, đỉnh geometry là offset pixel nguyên trong ảnh tham chiếu sản phẩm (mặc định) |
| `mm`    | Mọi tọa độ số là milimét vật lý so với gốc sản phẩm. Server vẫn lưu thêm `normalizedX/Y` cho client đa độ phân giải |

## 2. Measurement-point shapes (`shape` + `geometry`)

Hai cột optional trên `measurement_point_defs`:

| Cột | Kiểu | Mặc định | Ghi chú |
|-----|------|----------|---------|
| `shape` | varchar(20) | `"circle"` | Một trong `circle · rect · polygon · line · ring · mask · array` |
| `geometry` | jsonb | `null` | Discriminated-union tag bằng `shape` |

`POINT_SHAPES = ["circle", "rect", "polygon", "line", "ring", "mask", "array"]` — chú ý là **`rect`**,
KHÔNG phải `rectangle`.

Khi `shape === "circle"` (mặc định), có thể bỏ `geometry` và các cột legacy `positionX/positionY/radius`
là nguồn chuẩn. Với các shape khác, server **suy ra legacy circle anchor** từ geometry lúc ghi để client
cũ vẫn nhận `positionX/positionY/radius` dùng được.

Quy tắc số học chung: mọi tọa độ (`x`, `y`, `x1`, `pitchX`, …) là số hữu hạn (finite). Các bán
kính/kích thước (`radius`, `width`, `height`, `rOuter`, `rInner`, `thickness`) là **không âm** (≥ 0).

### 2.1 `circle`
```json
{ "shape": "circle", "x": 320, "y": 240, "radius": 18 }
```
Tâm `(x, y)`, bán kính `radius`. (KHÔNG dùng `cx/cy/r`.)

### 2.2 `rect`
```json
{ "shape": "rect", "x": 100, "y": 80, "width": 200, "height": 120, "rotation": 0 }
```
`(x, y)` là góc **trên-trái**. `width`/`height` ≥ 0. `rotation` (độ) optional. (KHÔNG dùng `w/h`.)

### 2.3 `polygon`
```json
{ "shape": "polygon", "points": [ {"x":100,"y":80}, {"x":260,"y":80}, {"x":180,"y":260} ] }
```
`points` là mảng **object `{x, y}`** (KHÔNG phải mảng tuple `[x,y]`), tối thiểu **3** đỉnh.

### 2.4 `line`
```json
{ "shape": "line", "x1": 50, "y1": 50, "x2": 400, "y2": 220, "thickness": 4 }
```
`thickness` optional (≥ 0).

### 2.5 `ring`
```json
{ "shape": "ring", "x": 320, "y": 240, "rOuter": 40, "rInner": 25 }
```
Tâm `(x, y)`; `rOuter`, `rInner` ≥ 0. (KHÔNG dùng `cx/cy`.)

### 2.6 `mask`
```json
{
  "shape": "mask",
  "region": { "kind": "rect", "x": 100, "y": 80, "width": 200, "height": 120 },
  "invert": false
}
```
`region` là **discriminated union theo `kind`**, một trong:
- `{ "kind": "rect", "x", "y", "width", "height" }`
- `{ "kind": "polygon", "points": [ {"x","y"}, … ] }` (tối thiểu 3 đỉnh)
- `{ "kind": "circle", "x", "y", "radius" }`

`invert` optional: `true` ⇒ vùng mask bị **loại trừ**. (KHÔNG dùng `bbox/encoding/data/rle`.)

### 2.7 `array`
```json
{
  "shape": "array",
  "rows": 4, "cols": 6,
  "pitchX": 28, "pitchY": 28,
  "originX": 100, "originY": 80,
  "cellShape": "circle",
  "cellGeometry": { "radius": 8 }
}
```
- `rows`, `cols`: số nguyên dương.
- `pitchX`, `pitchY`: khoảng cách tâm giữa cột/hàng.
- `originX`, `originY`: tọa độ của cell `(0, 0)`.
- `cellShape`: `"circle"` hoặc `"rect"`.
- `cellGeometry`: `{ "radius": n }` khi `cellShape="circle"`, hoặc `{ "width": w, "height": h }` khi `cellShape="rect"`.

Server **expand** array thành mảng phẳng `cells` khi đọc (xem §4.2) để máy không hiểu `array` vẫn duyệt được từng cell.

## 3. Fiducial marks

Landmark căn chỉnh per-sản phẩm, lưu bảng riêng `fiducial_marks`, được đưa xuống máy dưới dạng mảng
top-level `fiducials` trong response `deltaSyncPoints`. Các field trong `fiducials[]` (đã xác minh khớp
projection trong `machineApiRouters.ts`):

| Field | Kiểu | Ghi chú |
|-------|------|---------|
| `id` | int | |
| `code` | string | duy nhất per sản phẩm |
| `name` | string | |
| `type` | string | `cross · circle · square · custom` |
| `positionX` / `positionY` | int | |
| `normalizedX` / `normalizedY` | number \| null | |
| `searchWindowW` / `searchWindowH` | int | |
| `templateImageUrl` | string \| null | |
| `orderIndex` | int | thứ tự ổn định |

> Quản lý fiducial (CRUD + upload template) thực hiện trên UI admin (`fiducialMark.*`, audit-logged);
> máy chỉ **đọc** qua `deltaSyncPoints`.

## 4. Machine sync API additions

### 4.1 `syncMeasurementPoints` (push)
Mỗi `points[i]` có thể kèm optional `shape` + `geometry`:
```json
{
  "code": "P01", "name": "...", "positionX": 100, "positionY": 80,
  "shape": "rect",
  "geometry": { "shape": "rect", "x": 100, "y": 80, "width": 50, "height": 30 }
}
```
Có `shape`/`geometry` → server lưu kèm `positionX/Y/radius`. Không có → hành vi y hệt hợp đồng cũ.

### 4.2 `deltaSyncPoints` (pull)
Response mở rộng additive với `coordinateMode`, `fiducials` (top-level), `shape`/`geometry`/`cells` (per-point).
Xem đầy đủ ~30 field/điểm trong [MACHINE_API.md §11](MACHINE_API.md#11-deltasyncpoints).

Với `shape === "array"`, response kèm `cells` — mỗi phần tử là **`{ rowIndex, colIndex, shape, geometry }`**
(KHÔNG phải `{ row, col, x, y }`):
```jsonc
{
  "id": 42, "code": "P03", "name": "Solder array",
  "positionX": 320, "positionY": 240, "radius": 18,
  "shape": "array",
  "geometry": {
    "shape": "array", "rows": 2, "cols": 3,
    "pitchX": 24, "pitchY": 24, "originX": 308, "originY": 228,
    "cellShape": "circle", "cellGeometry": { "radius": 8 }
  },
  "cells": [
    { "rowIndex": 0, "colIndex": 0, "shape": "circle",
      "geometry": { "shape": "circle", "x": 308, "y": 228, "radius": 8 } },
    { "rowIndex": 0, "colIndex": 1, "shape": "circle",
      "geometry": { "shape": "circle", "x": 332, "y": 228, "radius": 8 } },
    { "rowIndex": 1, "colIndex": 2, "shape": "circle",
      "geometry": { "shape": "circle", "x": 356, "y": 252, "radius": 8 } }
  ]
}
```

**Backward-compatibility guarantees**
- Client chỉ biết `circle` có thể bỏ `shape`, `geometry`, `cells`, `fiducials`, `coordinateMode` và
  tiếp tục dùng `positionX/Y/radius`.
- Server luôn điền legacy anchor kể cả với shape phi-circle.
- `fiducials` là mảng rỗng (không bị bỏ) khi chưa cấu hình fiducial nào.
</content>
