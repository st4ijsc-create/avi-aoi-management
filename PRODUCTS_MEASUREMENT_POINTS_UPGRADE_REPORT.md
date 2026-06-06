# BÁO CÁO ĐÁNH GIÁ & ĐỀ XUẤT NÂNG CẤP MODULE `/products` + MEASUREMENT POINTS

> **Vai trò người soạn:** AI Agent — chuyên gia hệ thống AOI / AVI / SPI / 3D inspection (SMT/PCBA, cơ khí chính xác, in 3D, dập, đúc, gia công CNC).
> **Phạm vi:** Page `/products` (ProductModels) + tính năng cài đặt **Measurement Points (MP)** trên ảnh sản phẩm + đường đồng bộ máy ↔ server.
> **Mục đích:** Tổng hợp hiện trạng, chỉ ra khoảng cách (gap) so với thực tế công nghiệp, đề xuất kế hoạch cải tiến theo phase. **Cần phê duyệt trước khi gọi các chuyên-gia AI agents thực thi.**
> **Ngày:** 2026-05-09 · Phiên bản: v1.0 (DRAFT — chờ phê duyệt)

---

## 1. TÓM TẮT ĐIỀU HÀNH (EXECUTIVE SUMMARY)

Hệ thống hiện tại đã **đáp ứng tốt mức cơ bản 2D AOI/AVI**: định nghĩa sản phẩm, vẽ điểm đo dạng **hình tròn** trên ảnh tham chiếu, đồng bộ máy bằng delta-sync, lưu kết quả + ảnh thực tế, có sẵn AI compare + thống kê SPC/Pareto.

Tuy nhiên, đối chiếu với **yêu cầu công nghiệp thực tế** (SMT/PCBA, cơ khí chính xác, 3D profilometry, X-ray, SPI), đang tồn tại **8 nhóm khoảng cách lớn**:

| # | Nhóm gap | Mức độ ảnh hưởng | Ưu tiên |
|---|----------|------------------|---------|
| G1 | Hình dạng vùng đo cố định = hình tròn → không hỗ trợ **rectangle / polygon / line / ring / mask** | **Cao** — chặn việc đo IC body, BGA pad, edge, conformal coating | P0 |
| G2 | Không có **trục Z / 3D** → không đo được warpage, height, coplanarity, void% | **Cao** — chặn khách hàng dùng máy SPI/3D-AOI/CMM/X-ray | P0 |
| G3 | Enum `measurementType` chỉ 7 loại, **thiếu các loại chuyên ngành** (SPI volume, X-ray void %, GD&T, OCR, barcode, presence/absence) | Cao | P1 |
| G4 | Mô hình **tolerance đơn giản** (LSL/USL/nominal); thiếu bilateral/unilateral, GD&T, fit class, multi-criteria | Trung bình | P1 |
| G5 | Thiếu **fiducial / alignment / coordinate-transform**; điểm đo cố định pixel — không tự bù lệch khi đặt phôi | **Cao** — máy AOI thực tế bắt buộc dùng fiducial | P0 |
| G6 | Thiếu **defect taxonomy & severity** (IPC-A-610 / IPC-7095) → không phân loại được khuyết tật | Trung bình | P1 |
| G7 | Thiếu **measurement method / instrument / camera profile / calibration (mm-per-pixel)** → không trace được nguồn số liệu, MSA / Gage R&R không khả thi | Trung bình | P2 |
| G8 | Thiếu **versioning điểm đo** + **soft-delete**; xoá MP làm orphan history; thiếu audit log CRUD | Trung bình | P2 |

**Đề xuất:** triển khai theo **4 phase** (P0 → P3) trong 4–6 sprints. Mỗi phase đều **backward-compatible** (không phá schema cũ; chỉ mở rộng).

---

## 2. HIỆN TRẠNG (AS-IS) — TÓM LƯỢC

### 2.1 Schema cốt lõi (`drizzle/schema/product.ts`)

- **`product_models`**: code, name, category, lifecycle, **referenceImageUrl + dimensions**, `pointsConfigVersion` (delta-sync).
- **`measurement_point_defs`**: 1 điểm = `(positionX, positionY, radius)` + `(normalizedX/Y/Radius)` + `cropWidth/Height` + `measurementType` ∈ {DIMENSION, VISUAL, ELECTRICAL, POSITION, COLOR, SURFACE, OTHER} + `lower/upper/nominal` + `unit` + ảnh crop.
- **`measurement_results`**: per-inspection × per-point — `measuredValue` (numeric) hoặc `measuredValueText`, `result` ∈ {OK, NG, NTF}, ảnh, AI score.
- **`measurement_point_templates`**: lưu set MP dùng lại.
- **`sync_logs`**: nhật ký đồng bộ máy ↔ server.

### 2.2 UI editor ([client/src/pages/ProductModels.tsx](client/src/pages/ProductModels.tsx))

- Canvas hiển thị ảnh sản phẩm, vẽ **vòng tròn** màu cyan / xanh khi chọn.
- Click → tạo điểm; drag → di chuyển; slider radius / zoom; corner markers điều chỉnh crop.
- Form bên: code, name, type, LSL/USL/nominal, unit, crop W×H, ảnh crop.
- Có search/filter, multi-select bulk delete, save/apply template, export Excel.

### 2.3 Đường đồng bộ & inspection

- `machineApi.submitInspection`, `syncMeasurementPoints`, `syncPointImage`, `deltaSyncPoints` (delta theo `pointsConfigVersion`).
- Ảnh: S3 hoặc local (`STORAGE_MODE=local|forge`), key chuẩn theo product/point.
- AI: `aiDecision` ∈ {AUTO_OK, AUTO_NG, NEEDS_REVIEW, MANUAL}, `aiConfidence`, `aiComparisonScore`.

### 2.4 Hạn chế đã ghi nhận trong repo

Trích từ `AI_ANALYTICS_MODULE_AUDIT.md`, `todo.md`:
- Chỉ hình tròn, không có polygon.
- Một reference image / point, không version.
- Không soft-delete MP → mồ côi history.
- AI threshold không calibrate.
- Cpk đơn giản, không xét phân phối non-normal.
- Thiếu correlation analysis nhanh, thiếu uncertainty / tolerance stack-up.

---

## 3. PHÂN TÍCH GAP THEO YÊU CẦU CÔNG NGHIỆP THỰC TẾ

> Kết hợp kinh nghiệm thực tế: SMT line (paste → mount → reflow → AOI/X-ray), CNC cơ khí, đúc/dập, sơn phủ, lắp ráp.

### 3.1 Hình dạng vùng đo (Region-of-Interest geometry) — **G1**

| Nhu cầu thực tế | Hỗ trợ hiện tại | Đề xuất |
|---|---|---|
| **Rectangle** — IC body, BGA, connector window, label | ❌ Không | Thêm `shape='rectangle'` + `(x, y, w, h, rotation)` |
| **Circle** (đang có) | ✅ | Giữ nguyên, đặt `shape='circle'` mặc định |
| **Polygon / freeform** — biên dạng phức tạp, vùng dán keo | ❌ | `shape='polygon'`, lưu mảng `points[{x,y}]` |
| **Line / segment** — đo độ dài, độ thẳng cạnh | ❌ | `shape='line'`, lưu `(x1,y1,x2,y2)` |
| **Ring / donut** — vùng quanh chân pad, vùng quanh lỗ | ❌ | `shape='ring'` + `(x, y, rOuter, rInner)` |
| **Mask** — exclude vùng (silkscreen, mark) khỏi compare AI | ❌ | `shape='mask'` (logic loại trừ) |
| **Group / array** — array pin của QFN/connector (lặp pattern) | ❌ | `shape='array'` + `(rows, cols, pitchX, pitchY, originX, originY, cellShape)` |

### 3.2 Trục Z / 3D / depth — **G2**

| Nhu cầu | Hỗ trợ | Đề xuất |
|---|---|---|
| Đo **height** (SPI paste, bump, IC) | ❌ | Thêm `positionZ`, `heightMin/Max/Nominal`, `heightUnit` |
| Đo **volume** (paste, glue dot) | ❌ | `volumeMin/Max/Nominal` + `volumeUnit` (mm³, %) |
| Đo **area** (coverage paste, conformal) | ❌ | `areaMin/Max/Nominal` |
| **Coplanarity / warpage** (BGA, board, IC lead) | ❌ | `coplanarityMax`, `warpageMax`, datum reference |
| **Tilt / offset XY** (paste offset, mount offset) | ❌ | `offsetXMax`, `offsetYMax`, `tiltMax` |
| **Thickness** (lá kim loại, gasket, copper) | ❌ | `thicknessMin/Max` |
| **Void %** (X-ray BGA, X-ray solder) | ❌ | `voidPctMax` (theo IPC-7095) |
| Lưu **depth map / point cloud** snapshot | ❌ | optional `depthMapUrl`, `pointCloudUrl` (link file) |

### 3.3 Loại điểm đo (`measurementType`) — **G3**

Mở rộng enum thành **3 trục**: `category` × `subType` × `instrumentType` để bảo trì dễ.

**Đề xuất `measurementType` mở rộng (giữ tương thích ngược):**

| Category | SubType ví dụ | Ngữ cảnh |
|---|---|---|
| `DIMENSION` *(đã có)* | LENGTH, WIDTH, DIAMETER, RADIUS, ANGLE, PITCH, GAP | CMM, AOI 2D |
| `GD_T` *(mới)* | FLATNESS, STRAIGHTNESS, CIRCULARITY, CYLINDRICITY, PARALLELISM, PERPENDICULARITY, POSITION_TRUE, RUNOUT | Cơ khí chính xác |
| `VISUAL` *(đã có)* | SCRATCH, DENT, STAIN, BURR, CHIP, FOREIGN_MATTER | AVI |
| `PRESENCE` *(mới)* | COMPONENT_PRESENT, POLARITY, ORIENTATION, OCR_TEXT, BARCODE, DATAMATRIX | AOI cấp linh kiện |
| `SOLDER` *(mới)* | SOLDER_VOLUME, SOLDER_AREA, SOLDER_HEIGHT, SOLDER_OFFSET_X, SOLDER_OFFSET_Y, SOLDER_BRIDGE, INSUFFICIENT, EXCESS | SPI / AOI hậu reflow |
| `XRAY` *(mới)* | VOID_PERCENT, HEAD_IN_PILLOW, HEEL_FILLET, BGA_BALL_DIAMETER, OPEN_JOINT | X-ray |
| `THERMAL` *(mới)* | TEMP_MAX, TEMP_MIN, TEMP_DELTA, HOTSPOT | Thermal camera |
| `ELECTRICAL` *(đã có)* | RESISTANCE, CONTINUITY, VOLTAGE, INSULATION | ICT/FCT |
| `POSITION` *(đã có)* | XY_POSITION, ROTATION_THETA, OFFSET_FROM_FIDUCIAL | AOI |
| `COLOR` *(đã có)* | RGB_DELTA, HSV_DELTA, DELTA_E_LAB | AVI màu |
| `SURFACE` *(đã có)* | ROUGHNESS_RA, ROUGHNESS_RZ, GLOSS, TEXTURE_SCORE | Profilometer |
| `COATING` *(mới)* | COVERAGE_PCT, THICKNESS, BUBBLE_DEFECT | Conformal coating AOI |
| `OTHER` *(đã có)* | — | Custom |

> Cách triển khai: thêm cột mới `measurementCategory` (giữ `measurementType` cũ làm legacy alias) hoặc đổi `measurementType` thành `VARCHAR` + bảng `measurement_type_catalog` (linh hoạt, không cần migrate enum).

### 3.4 Mô hình tolerance — **G4**

| Cần | Hiện | Đề xuất |
|---|---|---|
| Bilateral `nominal ± tol` (vd: 5.00 ± 0.05) | Phải tự tính LSL/USL | Thêm `toleranceMode='bilateral'`, `tolPlus`, `tolMinus` |
| Unilateral (chỉ Min hoặc Max) | OK nhưng chưa rõ ràng | `toleranceMode='min_only' | 'max_only' | 'range' | 'bilateral'` |
| **GD&T datum** | ❌ | `datumRefs[]` (vd: `[A, B, C]`), `materialCondition` ∈ {MMC, LMC, RFS} |
| **Fit class** (H7/g6, …) | ❌ | optional `fitClass` |
| **Multi-criteria** (1 point có cả area AND height) | ❌ | array `criteria[{type, mode, limits…}]` |
| **Conditional** (chỉ áp dụng nếu …) | ❌ | optional expression DSL (giai đoạn sau) |

### 3.5 Fiducial & alignment — **G5** *(quan trọng nhất với AOI thật)*

Máy AOI thực tế **không** dùng pixel cố định: phôi đặt lệch, board lệch, jig lệch → phải dùng **2–3 fiducial** để tính ma trận affine, rồi mới project điểm đo.

**Đề xuất:**
- Thêm bảng `fiducial_marks`:
  ```
  id, productModelId, code, name,
  positionX, positionY, normalizedX, normalizedY,
  searchWindowW, searchWindowH,
  templateImageKey, type ENUM('cross','circle','square','custom')
  orderIndex
  ```
- Thêm cờ `coordinateMode` trên `product_models`: `'pixel' | 'fiducial_aligned'`.
- Khi máy chạy: detect fiducial → tính ma trận `M (3×3)` → transform các MP về toạ độ ảnh thực tế.
- API `deltaSyncPoints` trả về cả fiducials + MP gốc; máy tự transform.

### 3.6 Defect taxonomy & severity — **G6**

Thêm bảng `defect_catalog` (chuẩn hoá theo IPC-A-610 cho SMT, ISO/ASTM cho cơ khí):

```
id, code, name, category, severity ENUM('critical','major','minor','cosmetic'),
ipcReference VARCHAR(50),       -- vd "IPC-A-610 8.3.5.7"
acceptanceClass ENUM('1','2','3'),
description TEXT,
referenceImageKey
```

`measurement_results` thêm `defectCatalogId` + `defectSeverity` (override khi cần).

### 3.7 Method / instrument / calibration — **G7**

Thêm bảng `measurement_instruments`:
```
id, code, name, type ENUM('camera_2d','camera_3d','laser','xray','cmm','micrometer','manual','spi','thermal'),
machineId,                          -- liên kết máy
mmPerPixel DECIMAL,                 -- calibration tỉ lệ
calibrationDate, nextCalibrationDate,
uncertaintyMicron DECIMAL,
spec JSON                           -- field-of-view, resolution, lighting profile
```

`measurement_point_defs` thêm `preferredInstrumentId` (gợi ý) + cột `mmPerPixelOverride`.

`measurement_results` thêm `instrumentId`, `methodNote`, `repeatCount`, `gageRrId` (cho MSA).

### 3.8 Versioning, soft-delete, audit — **G8**

- Thêm `deletedAt TIMESTAMP NULL` cho `measurement_point_defs`, `product_models` → soft-delete.
- Thêm bảng `measurement_point_versions`: snapshot mỗi lần update (history JSON), liên kết `pointId` + `version` + `changedBy` + `changeReason`.
- Wire `createAuditLog()` vào tất cả CRUD product / point / template / mapping.
- Thêm `activeFromVersion`, `activeToVersion` để inspection trỏ đúng phiên bản MP tại thời điểm đo.

### 3.9 Bổ sung khác (priority thấp hơn nhưng nên có)

- **CAD import**: ODB++, IPC-2581, Gerber, STEP → tự sinh điểm đo theo pad list.
- **Sample plan**: `aql`, `sampleSize`, `lotSize`, `inspectionLevel` (theo ANSI/ASQ Z1.4).
- **Multi-camera per machine**: 1 product có nhiều ảnh (top, bottom, side) → bảng `product_views` + MP gắn với view.
- **Color/lighting profile per point**: `lightingProfile` (top, side, dark-field, coaxial), `cameraExposure`.
- **Time-series measurement** cho parametric test dài: bảng phụ `measurement_samples` (thời gian × giá trị).
- **Cpk / Ppk / Cpm correct**, hỗ trợ Box-Cox / Johnson cho non-normal.
- **MSA / Gage R&R wizard** dùng `repeatCount` + `instrumentId`.
- **Tolerance stack-up** ở mức product (gộp nhiều MP).
- **Heatmap defect overlay** trên ảnh sản phẩm trực tiếp ở UI products.

---

## 4. KẾ HOẠCH TRIỂN KHAI THEO PHASE

> Mỗi phase đều **backward-compatible** với máy đang chạy ngoài hiện trường: thêm cột nullable, mặc định giữ behavior cũ, máy mới dùng field mới.

### **PHASE 0 — Nền tảng schema & legacy-safe (1 sprint)** — _bắt buộc trước khi mở P1_

| Task | File ảnh hưởng | Ghi chú |
|---|---|---|
| P0.1 Soft-delete MP & product_models (`deletedAt`) | `drizzle/schema/product.ts`, `server/db/product.ts`, router | Tránh orphan history |
| P0.2 Bảng `measurement_point_versions` | migration mới | Snapshot JSON mỗi lần update |
| P0.3 Wire `createAuditLog` vào CRUD product / MP / template / mapping | `server/db/product.ts`, `server/db/system.ts` | Đáp ứng compliance |
| P0.4 Migration data: backfill `shape='circle'` mặc định | migration `00xx_add_shape_column.sql` | Bước đệm cho G1 |
| P0.5 Validation chặt schema (zod) ở tRPC | `server/routers/productRouters.ts` | Tránh lỗi silent |

### **PHASE 1 — Hình dạng vùng đo & Fiducial (2 sprints)** — _giải G1 + G5_

| Task | Ảnh hưởng |
|---|---|
| P1.1 Thêm `shape` + `geometry JSON` vào `measurement_point_defs` (giữ nguyên `positionX/Y/radius` cho legacy) | schema, all CRUD |
| P1.2 Hỗ trợ rectangle, polygon, line, ring, mask trong tRPC + payload `syncMeasurementPoints` | router |
| P1.3 Cập nhật canvas editor: tool palette (circle/rect/polygon/line/ring/mask) + drag/snap/edit vertices | `ProductModels.tsx` (lớn) |
| P1.4 Hỗ trợ array pattern (array of pin) | UI + schema (`shape='array'`) |
| P1.5 Bảng `fiducial_marks` + UI subtab "Fiducials" trong editor | schema + UI mới |
| P1.6 API trả về fiducial trong `deltaSyncPoints` | `machineApiRouters.ts` |
| P1.7 Tài liệu hoá định dạng `geometry` + ví dụ cho team máy | `apidocs/` |

### **PHASE 2 — 3D, loại điểm chuyên ngành & tolerance nâng cao (2 sprints)** — _giải G2 + G3 + G4_

| Task | Ảnh hưởng |
|---|---|
| P2.1 Thêm `positionZ`, `height/area/volume Min/Max/Nominal`, `coplanarity/warpage/voidPct/offset` | schema |
| P2.2 Bảng catalog `measurement_type_catalog` thay enum cứng (giữ alias) | schema + seed dữ liệu mặc định |
| P2.3 Thêm `toleranceMode` + `tolPlus/tolMinus` + `criteria[]` (multi-criteria) | schema + UI form |
| P2.4 Cập nhật `measurement_results`: `valueZ`, `valueVolume`, `valueArea`, `defectCatalogId` | schema |
| P2.5 UI form điểm đo: dynamic theo category (DIMENSION ↔ SOLDER ↔ XRAY khác nhau) | `ProductModels.tsx` |
| P2.6 Bảng `defect_catalog` + seed IPC-A-610 cơ bản (Class 2/3) | schema + seed |
| P2.7 Cập nhật `submitInspection`: nhận field 3D + defect | `machineApiRouters.ts` |

### **PHASE 3 — Instrument, MSA, sample plan, CAD import (2 sprints)** — _giải G7 + nâng cao_

| Task | Ảnh hưởng |
|---|---|
| P3.1 Bảng `measurement_instruments` + UI quản lý | schema + page mới |
| P3.2 `mmPerPixel` calibration per machine/camera | schema + workflow nhập |
| P3.3 Sample plan (AQL) + bảng `sampling_plans` | schema + UI |
| P3.4 `product_views` (top/bottom/side, multi-camera) | schema + UI tabs |
| P3.5 Cpk/Ppk/Cpm sửa lại + non-normal (Box-Cox) | `server/db/statistics.ts` |
| P3.6 Wizard MSA / Gage R&R | page mới |
| P3.7 CAD import (Gerber / IPC-2581) → auto-generate MP | tooling phụ trợ |
| P3.8 Heatmap defect overlay trên ảnh ở `/products/:id` | UI |

---

## 5. RỦI RO & GIẢM THIỂU

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Máy hiện trường (firmware cũ) không gửi field mới | Cao | Field mới đều **nullable**, server fallback về behavior cũ; máy cũ vẫn chạy |
| `pointsConfigVersion` tăng hàng loạt khi migrate `shape` | Trung | Migration không tăng version (set thẳng cột); tài liệu lưu ý |
| UI canvas trở nên phức tạp khi thêm 6 loại shape | Trung | Tách `MeasurementPointCanvas.tsx` riêng; viết unit test cho hit-testing/transform |
| Bảng catalog (defect/type) cần dữ liệu chuẩn IPC | Trung | Seed bộ mặc định + cho phép tenant tự thêm |
| Storage tăng nhanh do depth map / point cloud | Trung | Cho phép TTL/archival tier; thêm `STORAGE_RETENTION_DAYS` |
| Phá vỡ tương thích tRPC client cũ | Cao | Tăng version router (`v2.measurementPoint`) hoặc giữ field cũ làm computed |

---

## 6. ESTIMATE & DELIVERABLES

| Phase | Effort (người-tuần) | Deliverable chính |
|---|---|---|
| P0 | 1.5 | Soft-delete + version snapshot + audit log + schema chuẩn bị |
| P1 | 4.0 | Multi-shape MP + Fiducial + canvas editor v2 |
| P2 | 4.0 | 3D fields + measurementType catalog + tolerance nâng cao + defect catalog |
| P3 | 5.0 | Instrument/MSA/sample plan/multi-view/CAD import/Cpk fix |
| **Tổng** | **~14.5 người-tuần** | |

> Có thể song song hoá P1 (UI) và P2 (schema/loại đo) nếu có 2 dev FE + 1 dev BE.

---

## 7. CÁCH GỌI CHUYÊN-GIA AGENT (sau khi phê duyệt)

Khi báo cáo này được duyệt, đề xuất chia việc cho các sub-agent (mỗi phase 1 lần gọi):

| Phase | Agent gợi ý | Nhiệm vụ |
|---|---|---|
| P0 | Default coding agent | Migration + soft-delete + audit wiring |
| P1 | Default coding agent | Schema `shape/geometry` + `fiducial_marks`, refactor `ProductModels.tsx` ra component editor riêng |
| P2 | Default coding agent | Schema 3D + catalog tables + form dynamic |
| P3 | `Explore` (research CAD format) → default coding agent | Instrument + MSA + CAD parser |

Mỗi lần gọi sub-agent, sẽ được cấp **prompt chi tiết** liệt kê: files cần sửa, ràng buộc tương thích ngược, test acceptance, i18n keys mới (en+vi).

---

## 8. CÂU HỎI XIN PHÊ DUYỆT

Trước khi triển khai, xin xác nhận:

1. **Phạm vi phase nào duyệt thực hiện trước?** (gợi ý: P0 + P1 trong sprint đầu)
2. **Có cần hỗ trợ 3D NGAY (P2) không?** Nếu khách hàng đã có máy SPI/3D-AOI → cần đẩy P2 lên trước P1.
3. **Mức độ tương thích với máy hiện trường** — có máy nào KHÔNG thể cập nhật firmware? (nếu có → tất cả thay đổi phải pure additive)
4. **Chuẩn áp dụng cho defect catalog** — IPC-A-610 Class 2 hay Class 3? Ngành nào (SMT / cơ khí / nhựa)?
5. **CAD import (P3)** — định dạng nào ưu tiên? (Gerber / ODB++ / IPC-2581 / STEP / DXF)
6. **Có cần migration tooling** chuyển toàn bộ MP `circle` cũ thành `shape='circle'` ngay khi deploy P1, hay làm lazy?
7. **Localization** — i18n keys mới cần cả 2 ngôn ngữ (en + vi) ngay từ đầu?

---

> **DỪNG TẠI ĐÂY — chờ phê duyệt báo cáo.**
> Sau khi User chỉnh sửa & ký duyệt, sẽ gọi sub-agents thực thi theo đúng phase được duyệt.

---

## 9. NHẬT KÝ THỰC THI (THEO YÊU CẦU CẬP NHẬT SAU MỖI BƯỚC)

### Bước hoàn thành: P3 Integration Step 1 — Gắn `preferredInstrumentId` vào luồng Measurement Point

- **Mục tiêu bước:** liên kết mỗi Measurement Point với một Instrument ưu tiên để phục vụ workflow đo thực tế (P3).
- **Trạng thái:** ✅ Hoàn thành.
- **Thay đổi chính:**
  - Bổ sung field `preferredInstrumentId` vào input schema của `measurementPoint.create` và `measurementPoint.update` tại router.
  - Bổ sung state/UI selector "Preferred Instrument (P3)" trong trang ProductModels để chọn instrument cho point.
  - Đảm bảo luồng map dữ liệu point -> form -> payload save/update có truyền `preferredInstrumentId`.
- **Files đã chỉnh sửa:**
  - `server/routers/productRouters.ts`
  - `client/src/pages/ProductModels.tsx`
- **Kiểm chứng kỹ thuật:**
  - `get_errors` cho 2 file chỉnh sửa: không có lỗi.
  - `pnpm build`: thành công (chỉ còn warning chunk size đã tồn tại từ trước).
- **Tác động đến roadmap P3:**
  - Từ “P3 foundation list/create/delete instruments” tiến thêm sang “instrument binding at point-level”.
  - Tạo nền cho các bước kế tiếp: instrument-aware sampling/MSA và traceability theo point.
### Bước hoàn thành: P3 Integration Step 2 — Xác thực Instrument compatibility khi lưu Measurement Point

- **Mục tiêu bước:** đảm bảo chỉ instrument hoạt động (isActive=true) mới được gắn vào MP; ngăn chặn việc lưu dữ liệu inconsistent.
- **Trạng thái:** ✅ Hoàn thành.
- **Thay đổi chính:**
  - Thêm kiểm tra `getMeasurementInstrumentById` + `isActive` trong handler `measurementPoint.create` trước khi lưu.
  - Thêm kiểm tra tương tự trong handler `measurementPoint.update`.
  - Nếu instrument không tồn tại hoặc inactive → throw TRPCError (code: NOT_FOUND / BAD_REQUEST).
  - Cập nhật UI: hiển thị "(inactive)" next to instrument name, disable SelectItem nếu inactive, show warning nếu người dùng chọn instrument inactive.
- **Files đã chỉnh sửa:**
  - `server/routers/productRouters.ts` (add validation logic vào create/update)
  - `client/src/pages/ProductModels.tsx` (UI enhancements: disable inactive, show warning)
- **Kiểm chứng kỹ thuật:**
  - `get_errors` cho 2 file: không có lỗi.
  - `pnpm build`: thành công (chỉ còn warning chunk size cũ, không lỗi mới).
- **Tác động đến roadmap P3:**
  - P3.1 (Instrument management + UI) → now có thêm validation layer.
  - Chuẩn bị nền cho bước kế: instrument-aware sampling plan binding + MSA traces.

### Bước hoàn thành: P3 Integration Step 3 — Gắn `preferredSamplingPlanId` vào Measurement Point

- **Mục tiêu bước:** liên kết mỗi Measurement Point với một Sampling Plan ưu tiên để điều hướng luồng kiểm tra (AQL, fixed-n, risk-based, v.v.).
- **Trạng thái:** ✅ Hoàn thành.
- **Thay đổi chính:**
  - Thêm cột `preferredSamplingPlanId` (nullable INT) vào bảng `measurement_point_defs` trong schema (drizzle).
  - Thêm zod validation `preferredSamplingPlanId` ở router create/update.
  - Thêm kiểm tra logic trong handler: sampling plan tồn tại, thuộc product model này, isActive=true.
  - Cập nhật UI ProductModels: selector "Preferred Sampling Plan" với danh sách sampling plans của product.
  - Hiển thị "(inactive)" next to plan name, disable SelectItem nếu inactive, warning nếu chọn inactive plan.
  - Integrate state management: pointPreferredSamplingPlanId + reset/populate/payload logic.
- **Files đã chỉnh sửa:**
  - `drizzle/schema/product.ts` (add column definition)
  - `server/routers/productRouters.ts` (zod schema + validation logic trong create/update)
  - `client/src/pages/ProductModels.tsx` (state + UI selector + form data flow)
- **Kiểm chứng kỹ thuật:**
  - `get_errors` cho 3 file: không có lỗi.
  - `pnpm build`: ✅ thành công (chunk size warnings cũ, không error mới).
- **Tác động đến roadmap P3:**
  - Hoàn thành P3.1 foundation: instrument + sampling plan binding at point-level.
  - Tiếp theo có thể triển khai P3.2 (mmPerPixel calibration) hoặc P3.5+ (MSA wizard, Cpk fix).

### Bước hoàn thành: P3 Integration Step 4 — Thêm `mmPerPixel` Calibration cho Instrument

- **Mục tiêu bước:** tích hợp calibration factor (mm/pixel) cho từng instrument để máy AOI có thể chuyển đổi pixel → mm.
- **Trạng thái:** ✅ Hoàn thành.
- **Thay đổi chính:**
  - Thêm cột `mmPerPixel` (DECIMAL 15,8, nullable) vào bảng `measurement_instruments` (P3.2 calibration support).
  - Cập nhật router measurement instrument: thêm zod validation `mmPerPixel` (string optional) vào create/update handlers.
  - Cập nhật UI selector "Preferred Instrument": hiển thị calibration info `(cal: 0.05 mm/px)` nếu có, `[uncalibrated]` nếu NULL.
  - Thêm warning text nếu user chọn instrument uncalibrated → "will use pixel coordinates only".
  - Đảm bảo inactive check vẫn hoạt động (both checks).
- **Files đã chỉnh sửa:**
  - `drizzle/schema/product.ts` (add mmPerPixel column)
  - `server/routers/productRouters.ts` (zod schema for create/update)
  - `client/src/pages/ProductModels.tsx` (UI display + calibration warnings)
- **Kiểm chứng kỹ thuật:**
  - `get_errors`: không có lỗi.
  - `pnpm build`: ✅ thành công (warnings chunk size cũ).
- **Tác động đến roadmap P3:**
  - P3.2 mmPerPixel calibration → enabled.
  - Máy AOI hiện trường sẽ có truy cập vào mmPerPixel qua API → có thể chuyển `pixel_distance → mm_distance = pixel_distance × mmPerPixel`.
  - Tiếp theo: P3.3 (sample plan advanced rules), P3.5+ (MSA/Cpk).

### Bước hoàn thành: P3 Integration Step 5 — Gắn Product View (Multi-Camera) cho Measurement Point

- **Mục tiêu bước:** liên kết mỗi Measurement Point với một Product View/Camera ưu tiên (top/bottom/side/custom) để máy AOI biết chụp ảnh từ góc nào.
- **Trạng thái:** ✅ Hoàn thành.
- **Thay đổi chính:**
  - Thêm cột `productViewId` (nullable INT) vào bảng `measurement_point_defs` trong schema (drizzle).
  - Thêm zod validation `productViewId` ở router create/update handlers.
  - Thêm kiểm tra logic trong handler: product view tồn tại, thuộc product model này, isActive=true.
  - Cập nhật UI ProductModels: selector "Product View / Camera (P3.4)" với danh sách views của product.
  - Hiển thị view type (TOP/BOTTOM/SIDE) kèm code, thêm `[inactive]` tag nếu inactive.
  - Integrate state: `pointProductViewId` + reset/populate/payload logic.
  - Hiển thị warning nếu chọn inactive view.
- **Files đã chỉnh sửa:**
  - `drizzle/schema/product.ts` (add productViewId column)
  - `server/routers/productRouters.ts` (zod schema + validation logic cho create/update)
  - `client/src/pages/ProductModels.tsx` (state + UI selector + form data flow)
- **Kiểm chứng kỹ thuật:**
  - `get_errors`: 3 file không có lỗi liên quan (pre-existing z.record errors ở unrelated routes).
  - `pnpm build`: ✅ thành công (10,694.61 KB final, +2.5 KB do UI selector mới, chunk warnings cũ).
- **Tác động đến roadmap P3:**
  - Hoàn thành P3.4 multi-camera support: mỗi point giờ có thể chỉ định view/camera nào chụp ảnh.
  - Chuẩn bị nền cho P3.6 (MSA wizard) và P3.8 (defect heatmap overlay per-view).
  - Tiếp theo: P3.5 (Cpk fixes), P3.6 (MSA wizard), P3.7 (CAD import).

### Bước hoàn thành: P3 Integration Step 6 — Quality Readiness Indicator (P3.3)

- **Mục tiêu bước:** hiển thị trạng thái sẵn sàng chất lượng (QA readiness) của mỗi measurement point, giúp kiểm tra nhanh instrument có calibrated, sampling plan có AQL rules, view có được chỉ định.
- **Trạng thái:** ✅ Hoàn thành.
- **Thay đổi chính:**
  - Thêm **Quality Readiness Card** vào ProductModels UI, hiển thị ngay dưới position/radius summary.
  - Card tính toán 3 thành phần: calibration status (mmPerPixel), AQL level (từ sampling plan), view coverage.
  - Hiển thị status badge: **✓ Ready** (tất cả 3), **⚠️ Partial** (2 của 3), **❌ Incomplete** (≤1).
  - Màu nền tự động: xanh (ready), amber (partial), đỏ (incomplete).
  - Liệt kê chi tiết:
    - `• Instrument: CODE (cal: X.XX mm/px)` hoặc `Uncalibrated` hoặc `None`
    - `• Sampling Plan: CODE (AQL: C=X, M=Y, m=Z, n=SAMPLE_SIZE)` hoặc `None`
    - `• View: TOP/BOTTOM/SIDE (CODE)` hoặc `All views`
  - Dùng text color (green/gray) để highlight components có hay không.
- **Files đã chỉnh sửa:**
  - `client/src/pages/ProductModels.tsx` (add readiness card JSX + computed status logic)
- **Kiểm chứng kỹ thuật:**
  - `get_errors`: không có lỗi.
  - `pnpm build`: ✅ thành công (10,697.18 KB final, +2.57 KB từ readiness card).
- **Tác động đến roadmap P3:**
  - P3.3 quality rules display → enabled. User có visual feedback nhanh về readiness state.
  - Chuẩn bị nền cho P3.6 (MSA analysis có thể check readiness trước).
  - Tiếp theo: P3.5 (Cpk/Ppk statistical fixes), P3.6 (MSA wizard), P3.7 (CAD import).

### Bước hoàn thành: P3 Integration Step 7 — Nâng cấp Cpk/Ppk cho phân phối non-normal (Box-Cox)

- **Mục tiêu bước:** cải thiện độ chính xác chỉ số năng lực quy trình (Cp/Cpk/Pp/Ppk) khi dữ liệu lệch phân phối chuẩn.
- **Trạng thái:** ✅ Hoàn thành.
- **Thay đổi chính:**
  - Nâng cấp `calculateCapabilityIndices` trong utility SPC để tự động nhận diện non-normal bằng skewness.
  - Khi dữ liệu lệch mạnh (`|skewness| > 0.5`, `n >= 10`), tự động áp dụng Box-Cox (quét lambda từ -2 đến 2, bước 0.1) và chọn lambda có skewness nhỏ nhất.
  - Chuyển đổi giới hạn spec (`USL/LSL`) và sigma tương ứng trên miền Box-Cox trước khi tính Cp/Cpk/Pp/Ppk.
  - Giữ backward-compatible: sample nhỏ hoặc dữ liệu gần chuẩn vẫn dùng công thức cũ.
  - Đồng bộ logic non-normal vào `spcAdvancedRouter` và `aiInspectionAnalytics` (control chart summary), tránh sai lệch kết quả giữa các API.
- **Files đã chỉnh sửa:**
  - `server/utils/spc.ts`
  - `server/routers/spcAdvancedRouter.ts`
  - `server/services/aiInspectionAnalytics.ts`
- **Kiểm chứng kỹ thuật:**
  - `get_errors`: không có lỗi ở các file đã sửa.
  - `pnpm build`: ✅ thành công (warnings chunk size cũ, không có error mới).
- **Tác động đến roadmap P3:**
  - Hoàn thành P3.5 core backend (Cpk/Ppk non-normal with Box-Cox).
  - Giảm rủi ro đánh giá sai capability ở các process có phân phối lệch (đuôi dài, lệch phải/trái).
  - Tiếp theo: P3.6 (MSA wizard) và P3.7 (CAD import).

### Bước hoàn thành: P3 Integration Step 8 — P3.6 MSA Wizard (Backend Scaffold + UI Wizard)

- **Mục tiêu bước:** triển khai luồng MSA/Gage R&R nền tảng theo thứ tự backend trước, UI wizard sau, để có thể chạy end-to-end trong module ProductModels.
- **Trạng thái:** ✅ Hoàn thành.
- **Thay đổi chính:**
  - Thêm schema MSA mới:
    - `msa_studies`: thông tin study (code, type, status, operator/part/trial counts, summary JSON, started/completed timestamps).
    - `msa_observations`: dữ liệu đo theo operator/part/trial.
  - Thêm DB helper cho MSA:
    - CRUD scaffold cho study (`list/get/create/update/softDelete`).
    - Insert/list observation.
    - Hàm `calculateMsaSummary()` tính các chỉ số nền tảng: EV, AV, GRR, GRR%, NDC, verdict (good/acceptable/poor).
  - Thêm router `msaWizardRouter` trong product domain:
    - `listByProduct`, `getStudy`, `startStudy`, `addObservation`, `completeStudy`, `cancelStudy`.
    - Có validation quan hệ product/point/instrument và audit log cho các action chính.
  - Wire router vào app root (`msaWizard`) để frontend gọi qua tRPC.
  - Bổ sung UI wizard trên ProductModels:
    - Nút mở wizard ở toolbar + panel MSA trong khu vực P3 Foundation.
    - Dialog 3 bước: cấu hình study → nhập observations → xem summary.
    - Kết nối đầy đủ tới API mới (`start/add/complete`) và hiển thị kết quả summary.
- **Files đã chỉnh sửa:**
  - `drizzle/schema/product.ts`
  - `server/db/product.ts`
  - `server/routers/productRouters.ts`
  - `server/routers.ts`
  - `client/src/pages/ProductModels.tsx`
- **Kiểm chứng kỹ thuật:**
  - `get_errors`: không có lỗi mới ở các file chỉnh sửa.
  - `pnpm build`: ✅ thành công (chỉ còn warning chunk size cũ).
- **Tác động đến roadmap P3:**
  - Hoàn thành core P3.6 theo đúng thứ tự “backend scaffold trước, UI wizard sau”.
  - Hệ thống đã có luồng MSA chạy được để mở rộng sâu hơn (ANOVA đầy đủ, bias/linearity/stability nâng cao, export report).
  - Tiếp theo hợp lý: P3.7 CAD import hoặc nâng cấp MSA phase 2 (template study + matrix auto-generate + biểu đồ EV/AV/GRR).

### Bước hoàn thành: P3 Integration Step 8.5 — MSA Wizard Phase 2 (Matrix + Duplicate Guard + EV/AV/GRR Visual)

- **Mục tiêu bước:** nâng MSA wizard từ scaffold lên mức thực dụng: tạo matrix tự động, chống trùng cell, và trực quan hóa nhanh EV/AV/GRR.
- **Trạng thái:** ✅ Hoàn thành.
- **Thay đổi chính:**
  - **Duplicate guard (DB + API):**
    - Thêm unique index composite cho `msa_observations` trên `(studyId, operatorName, partLabel, trialNo)`.
    - Thêm check duplicate ở API `addObservation` và trả về `CONFLICT` nếu cell đã có dữ liệu.
  - **Auto-generate matrix:**
    - Bổ sung DB helper `generateMsaObservationMatrix()` để sinh dữ liệu theo ma trận `operator × part × trial`.
    - Bổ sung API `msaWizard.generateMatrix` để gọi từ UI.
    - Hỗ trợ tham số `baseValue`, `noisePct`, `overwriteExisting`.
  - **UI MSA wizard (step 2 + step 3):**
    - Step 2 thêm panel “Auto-generate matrix” với base value/noise và nút Generate.
    - Step 3 thêm biểu đồ thanh EV/AV/GRR (inline bar visualization) để đánh giá nhanh đóng góp biến thiên.
- **Files đã chỉnh sửa:**
  - `drizzle/schema/product.ts`
  - `server/db/product.ts`
  - `server/routers/productRouters.ts`
  - `client/src/pages/ProductModels.tsx`
- **Kiểm chứng kỹ thuật:**
  - `get_errors`: không có lỗi mới ở các file chỉnh sửa (ngoại trừ warning cũ liên quan `z.record` ở khu vực khác).
  - `pnpm build`: ✅ thành công (warnings chunk size cũ).
- **Tác động đến roadmap P3:**
  - P3.6 MSA wizard đã đạt mức có thể dùng thực tế cho vòng thử nghiệm nội bộ.
  - Chuẩn bị nền cho MSA phase 3: ANOVA đầy đủ, bias/linearity/stability dashboards, và export PDF report.

### Bước hoàn thành: P3 Integration Step 8.6 — MSA Wizard UX Hardening (Overwrite Toggle + Friendly Conflict Message)

- **Mục tiêu bước:** hoàn thiện UX cho luồng matrix generation và nhập observation thủ công, giảm lỗi thao tác lặp cell.
- **Trạng thái:** ✅ Hoàn thành.
- **Thay đổi chính:**
  - **Step 2 matrix generation:**
    - Thêm tùy chọn `Overwrite existing matrix cells` trên UI để điều khiển hành vi ghi đè khi generate matrix.
    - Nối state UI vào payload `generateMatrix` (`overwriteExisting` không còn hard-code `false`).
    - Reset về `false` khi mở wizard mới để tránh ghi đè ngoài ý muốn.
  - **Friendly conflict UX khi add observation:**
    - Bắt lỗi `CONFLICT` từ API `addObservation` và hiển thị toast nghiệp vụ rõ nghĩa thay vì thông báo chung.
- **Files đã chỉnh sửa:**
  - `client/src/pages/ProductModels.tsx`
- **Kiểm chứng kỹ thuật:**
  - `get_errors` trên file chỉnh sửa: không có lỗi mới.
  - `pnpm build`: ✅ thành công (chỉ còn warnings chunk size cũ).
- **Tác động đến roadmap P3:**
  - Giảm đáng kể thao tác tay và nhầm lẫn khi chạy MSA study nhiều vòng.
  - Tăng mức sẵn sàng để chuyển sang các hạng mục MSA phase 3 (ANOVA đầy đủ, biểu đồ nâng cao, export report).

### Bước hoàn thành: P3 Integration Step 8.7 — MSA Wizard Productivity Boost (Preset + Next Empty Cell)

- **Mục tiêu bước:** tăng tốc nhập liệu Step 2 khi chạy study lớn (nhiều operator/part/trial).
- **Trạng thái:** ✅ Hoàn thành.
- **Thay đổi chính:**
  - **Preset matrix parameters:**
    - Thêm preset nhanh `Fine`, `Normal`, `Coarse` để set nhanh `baseValue/noisePct` trước khi generate matrix.
  - **Quick-fill cell kế tiếp:**
    - Tính tiến độ matrix theo số ô đã có dữ liệu (`filled/total`).
    - Bổ sung nút `Fill Next ...` tự động điền `operator/part/trial` của ô trống kế tiếp theo thứ tự chuẩn.
    - Khi matrix đã đầy, hiển thị trạng thái `Matrix Complete`.
  - **Ổn định runtime:**
    - Điều chỉnh vị trí tính toán memo stats sau phần khai báo query để tránh lỗi thứ tự khởi tạo biến.
- **Files đã chỉnh sửa:**
  - `client/src/pages/ProductModels.tsx`
- **Kiểm chứng kỹ thuật:**
  - `get_errors`: không có lỗi mới.
  - `pnpm build`: ✅ thành công (chỉ còn warnings chunk size cũ).
- **Tác động đến roadmap P3:**
  - Rút ngắn thời gian thao tác tay cho MSA operator.
  - Giảm xác suất nhập sai hoặc bỏ sót ô matrix trong quá trình thu thập dữ liệu.

### Bước hoàn thành: P3 Integration Step 8.8 — MSA Add & Next Flow + Base Value Suggestion

- **Mục tiêu bước:** tối ưu vòng lặp nhập observation thủ công theo chuỗi, giảm thao tác nhập lặp và sai sót.
- **Trạng thái:** ✅ Hoàn thành.
- **Thay đổi chính:**
  - **Add & Next mode:**
    - Thêm toggle `Add & Next mode` tại Step 2.
    - Sau khi add observation thành công, hệ thống tự xác định ô trống kế tiếp và tự điền `operator/part/trial`.
    - Nút thao tác đổi nhãn động giữa `Add & Next` và `Add Observation` theo trạng thái toggle.
  - **Base value suggestion:**
    - Thêm toggle `Suggest base measured value`.
    - Khi di chuyển sang ô kế tiếp (manual hoặc auto), measured value được gợi ý từ `baseValue` nếu bật tùy chọn.
  - **Refactor logic thống nhất:**
    - Tách hàm tính toán progress + next cell dùng chung cho hiển thị progress và luồng auto-next sau mutation.
- **Files đã chỉnh sửa:**
  - `client/src/pages/ProductModels.tsx`
- **Kiểm chứng kỹ thuật:**
  - `get_errors`: không có lỗi mới trên file chỉnh sửa.
  - `pnpm build`: ✅ thành công (chỉ còn warnings chunk size cũ).
- **Tác động đến roadmap P3:**
  - Bước nhập liệu MSA thủ công đã đạt mức vận hành nhanh cho study kích thước lớn.
  - Tạo nền tốt để bổ sung các tính năng quality-of-life tiếp theo (hotkeys, paste grid, batch validator).

### Bước hoàn thành: P3 Integration Step 8.9 — MSA Keyboard Shortcuts (Enter / Ctrl+Enter / F2)

- **Mục tiêu bước:** giảm thời gian thao tác chuột khi nhập observation liên tục ở Step 2.
- **Trạng thái:** ✅ Hoàn thành.
- **Thay đổi chính:**
  - **Hotkeys thực thi trực tiếp trong Step 2:**
    - `Enter` = Add Observation (force non-next).
    - `Ctrl+Enter` = Add & Next (force auto-next).
    - `F2` = Fill Next Cell.
  - **Force-mode cho mutation:**
    - Bổ sung cơ chế force mode theo từng lần submit để hotkeys không phụ thuộc vào trạng thái toggle mặc định.
    - Đảm bảo nút UI và hotkeys dùng cùng một pipeline validate/mutate.
  - **UX clarity:**
    - Thêm dòng hint shortcut ngay dưới progress panel ở Step 2.
- **Files đã chỉnh sửa:**
  - `client/src/pages/ProductModels.tsx`
- **Kiểm chứng kỹ thuật:**
  - `get_errors`: không có lỗi mới ở file chỉnh sửa.
  - `pnpm build`: ✅ thành công (chỉ còn warnings chunk size cũ).
- **Tác động đến roadmap P3:**
  - Tăng tốc thao tác operator trong pha thu thập dữ liệu MSA.
  - Tạo nền cho các nâng cấp nhập liệu nâng cao tiếp theo (paste grid, batch validator, hotkey profile).

### Bước hoàn thành: P3 Integration Step 9 — Paste Grid Batch Import for MSA Observations

- **Mục tiêu bước:** cho phép nhập nhanh nhiều observations bằng thao tác dán bảng dữ liệu, có validate trước khi ghi DB.
- **Trạng thái:** ✅ Hoàn thành.
- **Thay đổi chính:**
  - **Backend batch API (`msaWizard.addObservationsBatch`):**
    - Nhận danh sách rows với cấu trúc `operatorName, partLabel, trialNo, measuredValue, notes?`.
    - Validate numeric cho `measuredValue` và trạng thái study còn mở.
    - Hỗ trợ `skipDuplicates` để bỏ qua cell trùng hoặc trả lỗi duplicate theo cấu hình.
    - Trả thống kê `created/skipped/errorCount/errors` cho UI hiển thị kết quả import.
  - **UI Step 2 — Paste Grid Import panel:**
    - Thêm `Textarea` để paste dữ liệu nhiều dòng.
    - Parser hỗ trợ dấu phân tách `comma`, `tab`, `semicolon`.
    - Preview realtime số dòng `Parsed/Valid/Invalid` + danh sách lỗi theo line.
    - Nút `Import Valid Rows` gọi batch API với option `Skip duplicates`.
  - **Audit & tracking:**
    - Ghi audit log cho batch import với tổng row, created, skipped, errorCount.
- **Files đã chỉnh sửa:**
  - `server/routers/productRouters.ts`
  - `client/src/pages/ProductModels.tsx`
- **Kiểm chứng kỹ thuật:**
  - `get_errors`: không có lỗi mới ở file frontend; warning cũ `z.record(...)` ở khu vực router khác vẫn giữ nguyên như trước.
  - `pnpm build`: ✅ thành công (chỉ còn warnings chunk size cũ).
- **Tác động đến roadmap P3:**
  - Hoàn thành hạng mục batch validator/paste grid đã định hướng từ Step 8.x.
  - Giảm mạnh thời gian nhập dữ liệu MSA cho study kích thước lớn và giảm sai sót thao tác tay.

### Bước hoàn thành: P3 Integration Step 10 — CSV Upload + Column Mapping for Batch Import

- **Mục tiêu bước:** cho phép import trực tiếp từ file CSV/TXT thay vì chỉ paste thủ công, đồng thời hỗ trợ map cột linh hoạt.
- **Trạng thái:** ✅ Hoàn thành.
- **Thay đổi chính:**
  - **CSV upload trực tiếp trong Step 2:**
    - Thêm nút `Upload CSV` (accept `.csv,.txt`) để nạp file vào luồng batch import.
    - Hỗ trợ tùy chọn `File has header row`.
  - **Column mapping linh hoạt:**
    - Tự dò cột theo header aliases (operator/part/trial/value/notes).
    - Cho phép chỉnh tay mapping qua dropdown cho từng cột.
    - Nút `Apply Mapping` để đổ dữ liệu đã map vào vùng batch input hiện có.
  - **Chuẩn hóa về pipeline Step 9:**
    - Dữ liệu CSV sau map được chuyển thành format line-based hiện tại, giữ nguyên parser/preview/import batch đã có.
    - Không cần thay đổi API backend, đảm bảo tương thích ngược.
- **Files đã chỉnh sửa:**
  - `client/src/pages/ProductModels.tsx`
- **Kiểm chứng kỹ thuật:**
  - `get_errors`: không có lỗi mới ở file frontend; warning cũ `z.record(...)` tại router khác vẫn giữ nguyên.
  - `pnpm build`: ✅ thành công (chỉ còn warnings chunk size cũ).
- **Tác động đến roadmap P3:**
  - Nâng độ hoàn thiện của luồng nhập liệu MSA lên mức production-friendly cho nhiều nguồn dữ liệu.
  - Giảm thời gian chuẩn bị dữ liệu khi operator xuất số đo từ công cụ ngoài (Excel/CSV).

### Bước hoàn thành: P3 Integration Step 11 — CSV Mapping Presets by Source Machine

- **Mục tiêu bước:** lưu/tải cấu hình mapping CSV theo nguồn máy để không cần map lại mỗi lần import.
- **Trạng thái:** ✅ Hoàn thành.
- **Thay đổi chính:**
  - **Preset management trong Step 10 panel:**
    - Thêm `Source machine` và `Preset name`.
    - Thêm thao tác `Save Preset`, `Load Preset`, `Delete Preset`.
  - **Scoped filtering theo nguồn:**
    - Danh sách preset được lọc theo `Source machine` hiện tại để chọn nhanh đúng profile.
    - Tự gợi ý source từ instrument đang chọn trong MSA wizard (khi source đang trống).
  - **Persistence:**
    - Lưu preset vào `localStorage` (key: `avi_aoi_msa_csv_presets_v1`).
    - Preset lưu đầy đủ: hasHeader + columnMap + source + preset name + instrumentId.
  - **Tích hợp flow hiện có:**
    - Khi load preset, hệ thống áp mapping lên CSV rows hiện tại và cập nhật batch input ngay.
- **Files đã chỉnh sửa:**
  - `client/src/pages/ProductModels.tsx`
- **Kiểm chứng kỹ thuật:**
  - `get_errors`: không có lỗi mới ở file frontend.
  - `pnpm build`: ✅ thành công (chỉ còn warnings chunk size cũ).
  - Các warning cũ `z.record(...)` ở router khác không đổi.
- **Tác động đến roadmap P3:**
  - Rút ngắn thời gian thao tác chuẩn bị import cho nhiều line/máy AOI khác nhau.
  - Tăng tính nhất quán dữ liệu nhập từ CSV giữa các ca vận hành.

### Bước hoàn thành: P3 Integration Step 12 — Team-Shared CSV Presets (DB + tRPC)

- **Mục tiêu bước:** chuyển preset mapping CSV từ local-only sang shared cấp project/team để nhiều máy trạm dùng chung.
- **Trạng thái:** ✅ Hoàn thành.
- **Thay đổi chính:**
  - **Schema + migration:**
    - Thêm bảng `msa_csv_mapping_presets` (scope theo `productModelId + sourceMachine + presetName`).
    - Lưu `hasHeader`, `columnMap`, `instrumentId`, metadata người tạo/cập nhật, soft-delete.
    - Bổ sung migration: `drizzle/0088_msa_csv_mapping_presets.sql`.
  - **DB layer:**
    - Thêm hàm list/upsert/soft-delete preset mapping trong `server/db/product.ts`.
  - **tRPC API (msaWizardRouter):**
    - `listCsvMappingPresets`
    - `saveCsvMappingPreset`
    - `deleteCsvMappingPreset`
    - Có audit log cho save/delete.
  - **Frontend Step 10/11 integration:**
    - UI Save/Load/Delete preset chuyển sang gọi API server.
    - Danh sách preset được lấy từ DB, lọc theo `source machine` hiện tại.
    - Giữ nguyên trải nghiệm mapping CSV và apply vào batch import pipeline.
- **Files đã chỉnh sửa:**
  - `drizzle/schema/product.ts`
  - `drizzle/0088_msa_csv_mapping_presets.sql`
  - `server/db/product.ts`
  - `server/routers/productRouters.ts`
  - `client/src/pages/ProductModels.tsx`
- **Kiểm chứng kỹ thuật:**
  - `get_errors`: không có lỗi mới ở các file Step 12; warning cũ `z.record(...)` ở khu vực router khác giữ nguyên.
  - `pnpm build`: ✅ thành công (chỉ còn warnings chunk size cũ).
- **Tác động đến roadmap P3:**
  - Preset mapping CSV đã sẵn sàng chia sẻ giữa các thành viên/team trong cùng project.
  - Giảm lệ thuộc cấu hình cục bộ trình duyệt và tăng tính nhất quán vận hành đa máy trạm.