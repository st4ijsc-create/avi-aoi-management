# Thiết kế — Xương sống 5 cấp cho máy AOI/AVI nội bộ (Khối A)

**Ngày:** 2026-08-24
**Nhánh:** `feat/hmi-dep`
**Phạm vi:** Khối A trong bốn khối đã phân rã. Ba khối còn lại có spec riêng.
**Nguồn định dạng máy:** `D:\SOURCES\AOIData` — `sync-json-samples-reference.md`, `dashboard-sample.json`, `aoipackage-meta-sample.json`, `template-sync-sample.json`
**Phần mềm máy:** `InspectProAOI` (C#/.NET), nội bộ tự phát triển

---

## 0. Phân rã và lý do khối A đi trước

Yêu cầu ban đầu gồm bốn khối độc lập, mỗi khối đủ nặng để có spec riêng:

| Khối | Nội dung | Phụ thuộc |
|---|---|---|
| **A** | Xương sống 5 cấp: schema, hợp đồng máy v2.0, ingest, cuộn NG>NTF>OK, join ảnh theo capture, hai luật nâng version | — |
| B | Trục máy cho cấu hình: `machine_points_configs` + override + bật `machine_config_state` | A |
| C | UI quản lý sản phẩm: bảng + dialog cấu hình điểm đo + tab nâng cao | A |
| D | Gộp 10 màn layout/twin thành màn review nhà máy cho văn phòng | — |

Khối A chặn B và C vì cả hai đều cần cây bốn cấp tồn tại trước. Khối D độc lập.

**Ghi chú phạm vi:** hai luật nâng version (§6) thuộc mặt tiếp xúc và hợp đồng máy nên nằm ở khối A; phần *lưu trữ* cấu hình theo máy (`machine_points_configs`, `machine_point_overrides`) là khối B. Khối A định nghĩa **giao thức**, khối B dựng **kho**. Giao thức ở §6 được thiết kế để chạy được ở dạng thoái hoá (chỉ có bản chuẩn, chưa có trục máy) rồi mở rộng khi B xong — xem §6.5.

---

## 1. Quyết định đã chốt với chủ dự án

| # | Quyết định | Chọn |
|---|---|---|
| QĐ-1 | Thứ tự tiểu dự án | **A trước** |
| QĐ-2 | Mô hình dữ liệu | **Chuẩn hoá đầy đủ cả hai phía** (không JSONB, không lai) |
| QĐ-3 | Hai loại NTF | **Giữ cả hai, phân biệt bằng `ntfSource`**; `ntf` máy gửi có thẩm quyền quyết định kết quả |
| QĐ-4 | Tương thích ngược | **Chỉ nhận v2.0, cắt máy cũ**. Dữ liệu lịch sử đã có trong DB **vẫn phải xem được** |
| QĐ-5 | Máy gửi lệch cấu hình chuẩn | **Nhận nhưng gắn thẻ, không từ chối** |
| QĐ-6 | "Theo mỗi máy riêng" nghĩa gì | Bản chuẩn dùng chung là **tham chiếu**; mỗi máy có **bản và chuỗi version riêng**, lệch nhau ở **giá trị cài đặt (dung sai/giới hạn)**, không lệch cấu trúc cây |
| QĐ-7 | Nâng version | Hai trường hợp: người dùng sửa trên hệ sinh thái; máy sửa rồi đồng bộ lên có kiểm tra base |

**Hệ quả của QĐ-4 phải nói rõ với vận hành:** máy nào chưa nâng phần mềm sẽ **mất dữ liệu kể từ lúc server lên**. Cần chốt lịch nâng toàn fleet **trước** khi deploy. Đây là rủi ro vận hành, không phải rủi ro kỹ thuật, và không có cách kỹ thuật nào che được nó.

---

## 2. Hiện trạng — cái đã có, đo được

Khảo sát này thay thế mọi phỏng đoán trước đó. Mỗi dòng có bằng chứng.

### 2.1 Đã có sẵn, dùng lại nguyên vẹn

| Hạng mục | Bằng chứng |
|---|---|
| Enum kết quả **đã có NTF** ở cả cấp bo và cấp điểm đo | `drizzle/schema/enums.ts:58` — `["OK","NG","NTF"]` |
| Tách "máy báo" vs "sau xác nhận" | `enums.ts:59` — `originalResultEnum = ["OK","NG"]`; `inspection.ts:37-41` |
| Idempotency ingest **hai lớp** | unique index `inspection.ts:203`; ledger `inspection.ts:238` |
| Máy khai version đang dùng + server phán lệch | `inspection.ts:141` (`pointsConfigVersion`), `:146` (`configVersionStatus` = current/stale/ahead/unknown) |
| **Lấy lại version cũ, version chỉ đi tiến** | `server/db/product.ts:2105` `revertPointsConfigToVersion`; chặn `targetVersion >= current` ở `:2131-2135`; `FOR UPDATE` ở `:2126`; tRPC `server/routers/productRouters.ts:1774` + permission + audit |
| Snapshot từng lần sửa điểm đo | `drizzle/schema/product.ts:274-296` `measurement_point_versions` + `productPointsConfigVersion` |
| Đăng ký / phê duyệt máy | `machines.registrationStatus` (pending/approved/rejected/unmapped), `apiKey` nullable; `machine_claim_tokens` `hierarchy.ts:814`; `machine_enrollment_tokens` `hierarchy.ts:1106` |
| Gói ảnh presign→upload→commit, 5 trạng thái | `inspection.ts:346-403` |
| Nhật ký gói ảnh, 11 loại sự kiện | `inspection.ts:470-517` |
| Hợp đồng máy **đã có versioning** | `server/contracts/machineDataContract.ts:118-125` |
| **Kênh cấu hình + ảnh điểm đo 2 chiều đã tồn tại** | `syncMeasurementPoints` `machineApiRouters.ts:3553`; `deltaSyncPoints` `:4885`; `checkPointsVersion` `:4184`; `getPoints` `:4419`; `syncPointImage` `:4715`; `getPointImage` `:4821`; `syncProductImage` `:4587`; `getProductImage` `:4535`; `getSyncHistory` `:5019` |
| Khoá lạc quan per-point trên đường máy push | `machineApiRouters.ts:3895-3935`, `:3985-3989`, `:4085-4088`; 9 ca test `server/db/measurementPointOptimisticLock.test.ts` |
| Shadow desired-vs-reported | `drizzle/schema/machineConfigState.ts:23` |
| Quy ước **NTF = pass** trong yield, đã chốt | `server/db/statistics.ts:341-342`, `:398-399` — `finalYield({ ok, ntf, total })`, comment *"decision #4"* |
| NTF tách nhóm riêng ở live stats | `server/services/liveStatsRollupService.ts:76` |
| Panel-level yield | `statistics.ts:471-488` |
| Bốn tầng cache/aggregate | `hourly_yield_cagg` + `hourly_yield_cache` (`drizzle/0235_hourly_yield_continuous_aggregate.sql`); MV `drizzle/0111_qw3_materialized_views.sql`, `drizzle/0174_mv_canonical_yield_tz.sql` |
| Mapping máy↔sản phẩm | `drizzle/schema/product.ts:814` `product_machine_mappings` |

### 2.2 Cờ có mà tắt — bảng có mà không ai ghi

| Cờ | Trạng thái đo được | Hệ quả |
|---|---|---|
| `CONFIG_SYNC_GENERIC_ENABLED` | **Không có trong `.env`** (1004 dòng, 0 khớp); chỉ xuất hiện dưới dạng comment ở `.env.example:1361` | `machine_config_state` **không được ghi bởi bất cứ gì** — chính comment của schema nói *"this table is written by NOTHING → inert"* |
| `CONFIG_DRIFT_REPORT_ENABLED` | Không có trong `.env`; `.env.example:1363` | như trên |
| `MACHINE_SYNC_OPTIMISTIC_LOCK` | **Không có trong `.env` lẫn `.env.example`**; `envTrue(...)` ⇒ mặc định OFF (`machineApiRouters.ts:303-305`) | Máy push cấu hình là **last-writer-wins**. Chỉ còn audit `blind-overwrite` (`:4085`) làm chứng **sau khi** đã mất |

Lý do duy nhất giữ `MACHINE_SYNC_OPTIMISTIC_LOCK` OFF được ghi trong doc-comment: *"today's machines push blind and a flip-to-enforce before they cache/send updatedAt would start rejecting legit syncs"*. **QĐ-4 (cắt máy cũ) làm lý do này biến mất** ⇒ bật cờ trở nên an toàn.

### 2.3 Lỗ hổng thật do định dạng mới

**L-1. `surface` và `capture` không tồn tại ở tầng schema.**
Quét toàn bộ `drizzle/schema/` (84 file): **0 bảng**, **0 cột** nào tên `surfaceId`/`surfaceName`/`captureId`/`captureName`. Cây mới 5 cấp; DB hiện **2 cấp** (`product_inspections` `inspection.ts:16` → `measurement_results` `:264`).
Mầm gần nhất: `measurementPointDefs.productViewId` ("top|bottom|side", `product.ts:208`) ≈ surface; `componentCode` + `refDesignator` (`:215-216`) ≈ component. **Không có gì tương ứng capture.**

**L-2. Đường commit gói ảnh sẽ hỏng IM LẶNG với manifest mới.**
`aoiPackageRouter.ts:679-689` map từng ảnh bằng `point.pointId || point.pointCode || point.code || 'UNKNOWN'`. Manifest mới (`aoipackage-meta-sample.json`) mỗi ảnh chỉ có `captureId`, `surface`, `positionId`, `captureName`, `localImagePath`, `fileName` — tài liệu nói rõ *"Không lặp lại kết quả đo (result/value/limit...) — dữ liệu đó đã có ở file 1"*. **Không field nào trong ba field kia tồn tại.** Hệ quả:
- `pointCode = 'UNKNOWN'` cho mọi ảnh ⇒ toàn bộ `package_images` thành rác
- `pointName` = null, `result` = undefined, `measurementValue` = null
- `aoiPackageRouter.ts:869`: `ntf: filter(p => !p.result || p.result === 'NTF')` — `result` luôn undefined ⇒ `!p.result` luôn đúng ⇒ **ok=0, ng=0, ntf = 100% số ảnh**
- `:866` `totalPoints = normalizedMeasurements.length` — với manifest mới con số này là **số ảnh (capture)**, không phải số điểm đo

Không exception nào ném ra. Gói vẫn `committed`. Dashboard vẫn vẽ. Mọi con số đều sai.

**L-3. `inspection_packages` thiếu `ntfCount`.** Chỉ có `okCount`/`ngCount` (`inspection.ts:376-378`), trong khi `summary{}` mới đếm ntf ở cả bốn cấp.

**L-4. `package_images` không join được cấp capture.** Chỉ có `pointCode`/`pointName`/`fileName` (`inspection.ts:417-419`). Một position có nhiều capture (nhiều đèn/camera) ⇒ `pointCode` không phân biệt được ảnh nào của đèn nào. Đây là chức năng chính của định dạng mới.

**L-5. Hợp đồng máy vẫn phẳng.** `measurements: z.array(...)` (`machineDataContract.ts:46`, `:112`) — không có surfaces/positions/captures lồng nhau.

**L-6. Không có kênh khai "bản base" khi máy push cấu hình.** Input `syncMeasurementPoints` chỉ có `clientVersion` (phiên bản **ứng dụng**, không phải phiên bản **cấu hình**) — `machineApiRouters.ts:3562`. Máy không có cách nào khai "tôi nhánh ra từ bản chuẩn số mấy". Đây là gốc rễ của tình huống 2-3 máy cùng nâng version.

**L-7. Khoá lạc quan là OPT-IN, mù với sự vắng mặt.** `expectedUpdatedAt` optional (`machineApiRouters.ts:214`); test khẳng định *"absent expected → never stale (opt-in)"* (`measurementPointOptimisticLock.test.ts:51`) và *"SKIPS the check when expectedUpdatedAt is absent"* (`:110`). Cộng với cờ OFF ở §2.2 ⇒ hôm nay không có bảo vệ nào.

**L-8. Chưa có logic cuộn cây.** `evaluatePointResult` doc-comment ghi rõ *"the returned result is that verdict unless it was OK and a configured spec was violated (→ NG)"* (`pointResultEvaluator.ts:357-360`) — nó **chỉ** nâng OK→NG ở **cấp lá**, không biết gì về cây.

### 2.4 Điều tôi đã đoán sai, đã kiểm chứng lại

**`syncMeasurementPoints` KHÔNG xoá điểm vắng mặt.** Quét cả thân hàm (dòng 3553-4100): không có `delete`/`tombstone`/`prune`/`notInArray` nào. Nó chỉ upsert. Nên điểm máy A thêm **không** bị máy B làm bốc hơi. Mất mát thật xảy ra ở dạng **ghi đè giá trị của những điểm cả hai đều gửi** — hẹp hơn nhưng vẫn nghiêm trọng, và §6 vá đúng dạng đó.

---

## 3. Mô hình dữ liệu

### 3.1 Tính chất Timescale khai thác được

Comment trong repo ghi: *"the DB CANNOT hold an FK **to** a hypertable"* (`inspection.ts:3-9`, nhấn mạnh của tác giả gốc). Nhấn mạnh là **tới**. FK **từ** hypertable **tới** bảng thường thì hợp lệ.

Khai thác điều đó, cả cây kết quả chỉ còn **đúng một** liên kết mềm.

### 3.2 Phía kết quả

```
product_inspections            (hypertable, MỞ RỘNG)
      ▲
      │  LIÊN KẾT MỀM DUY NHẤT — đích là hypertable ⇒ không FK được
      │  integrityScanService quét mồ côi hằng tuần (khuôn đã có, inspection.ts:3-9)
      │
inspection_surfaces            (bảng thường — MỚI)
      ▲ FK thật
inspection_positions           (bảng thường — MỚI)
      ▲ FK thật
inspection_captures            (bảng thường — MỚI)
      ▲ FK thật  ← từ hypertable tới bảng thường: HỢP LỆ
measurement_results            (hypertable, MỞ RỘNG)
```

**`inspection_surfaces`** (mới, bảng thường)
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | serial PK | |
| `inspectionId` | integer NOT NULL | soft ref → `product_inspections.id` (không FK được) |
| `inspectionTime` | timestamp NOT NULL | bản sao để dọn theo tuổi mà không join vào hypertable |
| `surfaceName` | varchar(100) NOT NULL | từ `HookPosition.SurfaceName` |
| `surfaceExtId` | varchar(64) | GUID nếu máy gửi; NULL nếu không |
| `result` | `overallResultEnum` NOT NULL | **cái máy KHAI** |
| `ntf` | boolean NOT NULL | cờ thô máy gửi |
| `ntfSource` | varchar(10) | `machine` \| `human` \| `both` \| NULL |
| `rolledResult` | `overallResultEnum` NOT NULL | **cái CUỘN RA từ con** — xem §4.3 |
| `rolledNtf` | boolean NOT NULL | |
| `declaredMismatch` | boolean NOT NULL default false | `result != rolledResult` hoặc `ntf != rolledNtf` |
| `startedAt`, `completedAt` | timestamp | |
| `createdAt` | timestamp | |

Index: `(inspectionId)`, `(inspectionTime)`, `(declaredMismatch) WHERE declaredMismatch`.

**`inspection_positions`** (mới, bảng thường) — như trên, thay `surfaceName` bằng:
`surfaceRowId` integer NOT NULL FK → `inspection_surfaces.id` ON DELETE CASCADE; `positionId` varchar(64) NOT NULL; `positionNumber` integer (1-based, khớp `TriggerCommand.PositionNumber`).

**`inspection_captures`** (mới, bảng thường) — như trên, thay bằng:
`positionRowId` integer NOT NULL FK → `inspection_positions.id` ON DELETE CASCADE; `captureExtId` varchar(64) NOT NULL (= `Capture.Id`, khoá join sang manifest ảnh và teach data); `captureName` varchar(255); `captureIndex` integer (đếm từ 0).

Với capture, `result`/`ntf` là **field trực tiếp từ pipeline** — tài liệu mẫu nói rõ *"field trực tiếp từ pipeline, không phải tự OR ngược từ components"*. Nên `declaredMismatch` ở cấp capture có ý nghĩa chẩn đoán mạnh nhất trong cả cây.

Unique: `(positionRowId, captureExtId)`.

**`measurement_results`** (mở rộng — hypertable, mọi cột mới đều nullable, không backfill)
| Cột mới | Kiểu | Ghi chú |
|---|---|---|
| `captureRowId` | integer | FK → `inspection_captures.id` — **hợp lệ** (hypertable → bảng thường). NULL = hàng lịch sử trước đợt này |
| `componentExtId` | varchar(64) | = `ComponentProject.Id`. **Khoá join sang teach data** |
| `ntf` | boolean | cờ thô máy gửi |
| `ntfSource` | varchar(10) | |
| `errorCode` | varchar(50) | có trong payload mới, chưa có chỗ lưu |
| `errorDesc` | text | |
| `startedAt`, `completedAt` | timestamp | mốc từng component |

`result` giữ nguyên `overallResultEnum` (đã có NTF). `measuredValue`/`measuredValueText`/`lowerLimit`/`upperLimit` đã có sẵn.

**`product_inspections`** (mở rộng)
| Cột mới | Kiểu | Ghi chú |
|---|---|---|
| `ntfSource` | varchar(10) | |
| `machineProductIndex` | integer | có trong payload, chưa có chỗ lưu |
| `configDriftFlags` | jsonb | §4.4 |
| `summaryCounts` | jsonb | `summary{}` máy gửi, lưu **nguyên văn** để đối chiếu với cái ta đếm được |

`serialNumber`, `productModel`, `overallResult`, `originalResult`, `pointsConfigVersion`, `configVersionStatus` đã có.

### 3.3 Phía cấu hình

**Lệch có chủ đích so với bản phác ban đầu, và lý do:** không tạo bảng `product_components` mới. `measurement_point_defs` đã mang toàn bộ limits / tolerance v2 / criteria / GD&T / variant linkage / delta-sync / spec-gate / revert history. Dựng một bảng component thứ hai cũng chứa limits sẽ tạo **hai nguồn sự thật cho ngưỡng phán NG** — đúng lớp lỗi mà phương án JSONB bị loại vì nó. Thay vào đó `measurement_point_defs` **trở thành chính cấp component**, được neo lên trên.

```
product_surfaces    (MỚI)  productModelId, surfaceName, surfaceExtId,
                           templateImageUrl/Key, orderIndex
      ▲ FK
product_positions   (MỚI)  surfaceRowId, positionId, positionIndex, name,
                           shape, markerWidth, markerHeight, markerRadius,
                           relX, relY, templateImageUrl/Key
      ▲ FK
product_captures    (MỚI)  positionRowId, captureExtId, captureName,
                           captureIndex, templateImageUrl/Key
      ▲ FK
measurement_point_defs  (ĐÃ CÓ — thêm 6 cột)
                           captureRowId (nullable), componentExtId,
                           roiX, roiY, roiWidth, roiHeight
```

`captureRowId` **nullable** là điều kiện sống còn: NULL = điểm đo phẳng cũ, chạy y như trước, không phá `resolveEffectivePoints`, `variant_point_overrides`, spec-gate, `deltaSyncPoints`, hay `revertPointsConfigToVersion`. Đây là phép cộng thuần.

**Hệ quả: một bảng chứa hai loại hàng.** Cần nói rõ luật phân giải để không ai phải đoán:

- `captureRowId IS NULL` — **điểm phẳng cũ**. Phân giải y như hôm nay: theo `(productModelId, variantId, code)`. Không thuộc cây nào.
- `captureRowId IS NOT NULL` — **component thuộc cây**. Phân giải theo chuỗi `product_surfaces → product_positions → product_captures → def`, và `componentExtId` là định danh máy dùng để khớp.

Hai loại **không được trộn trong cùng một sản phẩm**: một `productModelId` hoặc là đã chuyển sang cây (mọi điểm live có `captureRowId`), hoặc còn phẳng (mọi điểm live có NULL). Trạng thái nửa vời là nguồn của lỗi phân giải không thể chẩn đoán. Ràng buộc này là **bất biến ở tầng ứng dụng, có cổng đo canh** (§7.3), không phải CHECK constraint — vì lúc *đang* chuyển đổi trong một transaction thì trạng thái nửa vời là hợp lệ.

Sản phẩm nào chưa chuyển thì máy v2.0 gửi cây lên sẽ **lệch chuẩn** (§4.4) — được nhận, được gắn thẻ, và thẻ đó chính là danh sách việc cần làm cho người cấu hình.

`relX`/`relY` là toạ độ tương đối 0..1 trên ảnh template surface. Tài liệu mẫu ghi rõ máy gửi **luôn resolve sẵn, không gửi null** — nên schema đặt `NOT NULL`, và payload thiếu là lỗi hợp đồng, không phải trường hợp cần suy đoán. Đặt tên `relX`/`relY` (không phải `x`/`y`) để không lẫn với `roiX`/`roiY` là **pixel tuyệt đối** trong cùng file.

### 3.4 Ba điều cố ý, và lý do

**(1) Giữ cả `result` (enum) và `ntf` (bool thô) ở mọi cấp.** Payload có thể gửi `result="NG"` **và** `ntf=true` cùng lúc. QĐ-3 cho NG thắng nên `result` sẽ là `"NG"` — nhưng không lưu `ntf` thô thì mất dữ kiện "máy cũng nghi đây là báo giả". Lưu cả hai để không bao giờ phải suy đoán lại.

**(2) `inspection_surfaces` có `result`/`ntf` KHÁC `rolledResult`/`rolledNtf`.** Tài liệu mẫu nói surface là do generator tự gộp, `HookProductContext` chỉ có `Positions` phẳng. Nếu chỉ cuộn thì ta mất phép so. Lưu **cái máy khai** cạnh **cái ta cuộn ra**, lệch nhau ⇒ có bug ở máy hoặc ở ta, và **phát hiện được**. Cột `declaredMismatch` làm điều đó truy vấn được, không phải đi tính lại.

**(3) `componentExtId` / `captureExtId` lưu nguyên văn.** `componentId` = `ComponentProject.Id` là **khoá join thật** giữa kết quả và teach data (tài liệu chỉ rõ, và `InspectionRuntimeService.cs:2561-2566` phía máy). Đánh mất nó là đánh mất khả năng đối chiếu kết quả ↔ ROI đã teach.

### 3.5 Chi phí đã biết và chấp nhận

> **⚠ Con số này đã được ĐO LẠI và nó khác hẳn ước tính ban đầu. Xem §3.7.**
> Ước tính "1,9×" là tỉ lệ **bên trong định dạng mới** (90 dòng cây so với 48 dòng component). So với **hiện trạng thật** (12 điểm đo mỗi bo), mức tăng là **~7,5×**. Phần dưới giữ nguyên để thấy sai ở đâu.

- **~1,9× số dòng mỗi bo.** Mẫu: 6 surface + 12 position + 24 capture = 42 dòng mới, cộng 48 dòng component hiện có → 90. Cần đo throughput thật trước khi chốt chính sách retention (nợ N-5).
- **Một liên kết mềm** (`inspection_surfaces.inspectionId`). Xem §3.6.
- **Ba bảng thường trên đường ingest nóng** — không phải hypertable, nên cần cron dọn theo `inspectionTime` (đã có index). Quyết định *không* làm hypertable: để giữ được ba FK thật. Đổi retention tự động lấy tính toàn vẹn.

### 3.6 Mồ côi: DỌN, không chỉ báo cáo

Chỉ có **một** liên kết mềm trong cả cây: `inspection_surfaces.inspectionId → product_inspections.id`, không FK được vì đích là hypertable. Ba liên kết còn lại là FK thật có `ON DELETE CASCADE`, nên chúng tự sạch.

Hệ quả: mồ côi chỉ phát sinh ở **đúng một chỗ** — hàng `inspection_surfaces` mà bo cha đã bị xoá (retention hypertable, `drop_chunks`, hoặc xoá thủ công). Khi hàng đó chết, cascade kéo theo toàn bộ position/capture bên dưới.

**Chính sách: dọn thật, không chỉ ghi báo cáo.**

`integrityScanService` hiện chỉ *phát hiện và ghi vào* `integrity_scan_results`. Với cây mới, thêm một tác vụ dọn:

```sql
-- chạy SAU khi retention/drop_chunks của product_inspections đã chạy
DELETE FROM inspection_surfaces s
WHERE NOT EXISTS (
  SELECT 1 FROM product_inspections p
  WHERE p.id = s."inspectionId" AND p."inspectionTime" = s."inspectionTime"
);
-- position/capture/measurement_results tự chết theo FK CASCADE
```

Cột `inspectionTime` được sao xuống mỗi cấp (§3.2) chính là để mệnh đề này **không phải join vào hypertable** và chạy được theo cửa sổ thời gian.

**Ba ràng buộc bắt buộc, vì đây là lệnh xoá:**

1. **Chạy SAU retention, không chạy trước.** Chạy trước là xoá con của bo vẫn còn sống.
2. **Có ngưỡng chặn (circuit breaker).** Nếu một lượt dọn định xoá quá `ORPHAN_SWEEP_MAX_ROWS` (mặc định 10.000) thì **dừng và báo động**, không xoá. Một lượt dọn xoá hàng triệu dòng nghĩa là có gì đó khác đã hỏng — lúc đó xoá là làm hỏng thêm.
3. **Ghi số đã xoá vào `integrity_scan_results`** trước khi xoá, để còn truy được.

**Phạm vi có chủ đích — điều này KHÔNG áp cho dữ liệu lịch sử.** Hàng `measurement_results` cũ có `captureRowId IS NULL` **không phải mồ côi**: chúng có bo cha hợp lệ, chỉ là không thuộc cây. QĐ-4 nói rõ dữ liệu lịch sử **vẫn phải xem được**. Chính sách ở mục này chỉ chạm hàng **không có cha**, không chạm hàng **không đúng mẫu**.

### 3.7 Số đo THẬT (N-5) — và nó bác bỏ ước tính ở §3.5

Đo trực tiếp trên DB dev `aoi_management`, truy vấn **chỉ đọc**, ngày 2026-08-24.

**Hiện trạng:**

| Chỉ số | Giá trị đo được |
|---|---|
| `product_inspections` | **22.996** bo |
| `measurement_results` | **157.369** dòng |
| `inspection_packages` | **0** dòng |
| `package_images` | **0** dòng |
| `measurement_point_defs` còn sống | **39** |
| Cửa sổ dữ liệu | 2026-06-28 → 2026-07-19 (341 giờ có dữ liệu) |
| Throughput trung bình | **67 bo/giờ** |
| Throughput p95 | **45 bo/giờ** |
| Throughput đỉnh | **840 bo/giờ** |
| Điểm đo mỗi bo — trung bình | **12** |
| Điểm đo mỗi bo — p95 / cao nhất | **20 / 20** |
| Bo **có** điểm đo | 13.208 / 22.996 |
| Phân bố kết quả | OK 22.292 · NG 460 · NTF 244 |
| Retention hiện hành | `drop_after: 365 days` (cả `product_inspections` và `measurement_results`) |

**Năm điều số đo này nói ra, mà đọc code không thấy được:**

**Đ-1. Mức tăng số dòng là ~7,5×, không phải 1,9×.**
Hiện tại **12** dòng mỗi bo. Định dạng mới theo mẫu là **90** dòng mỗi bo (48 component + 42 dòng cây). Ở 67 bo/giờ: từ ~800 dòng/giờ lên **~6.000 dòng/giờ**, tức **~145 nghìn dòng/ngày**, và với retention 365 ngày là **~53 triệu dòng** thường trú. Ở đỉnh 840 bo/giờ là **~75.600 dòng/giờ**.
Ước tính 1,9× ở §3.5 so cây mới với *số component của mẫu*, không so với *hiện trạng*. Đó là lỗi chọn mẫu số của tôi, và nó làm nhẹ đi 4 lần.
**Hệ quả thiết kế:** ba bảng mới ở §3.2 là **bảng thường**, không hypertable — nên chúng **không** hưởng `drop_after` tự động, mà phải có cron dọn riêng theo `inspectionTime`. Ở quy mô 53 triệu dòng, quyết định "đổi retention tự động lấy ba FK thật" (§3.5) cần được xác nhận lại chứ không mặc nhiên đúng — xem câu hỏi mở CH-1 ở §11.

**Đ-2. 42,6% số bo KHÔNG có dòng `measurement_results` nào** (9.788 / 22.996). Đây là dữ kiện chưa giải thích được, và nó ảnh hưởng trực tiếp tới phép đếm "số lượng điểm đo tiêu chuẩn" ở §4.4: nếu nhiều bo vốn không gửi chi tiết thì `configDriftFlags` sẽ báo lệch hàng loạt và trở thành nhiễu. **Phải làm rõ trước khi bật cảnh báo lệch chuẩn lên UI.**

**Đ-3. Đường gói ảnh CHƯA TỪNG CHẠY THẬT: `inspection_packages` = 0 dòng, `package_images` = 0 dòng.**
Nghĩa là lỗi L-2 (`|| 'UNKNOWN'`) chưa từng gây hại — nhưng đồng thời **không có một dòng dữ liệu nào chứng minh đường đó chạy được**. Toàn bộ mã presign→upload→commit là mã **chưa được thực chứng**. Không được giả định nó hoạt động. Khi vá L-2 phải nghiệm thu bằng một gói **chạy thật từ đầu đến cuối**, không chỉ bằng unit test.
(Ghi chú vận hành: bảng `inspection_packages` chiếm **18 MB** dù có 0 dòng — bloat từ dữ liệu đã xoá. Cần `VACUUM FULL`; không thuộc phạm vi đợt này.)

**Đ-4. Luồng "người xác nhận NTF" CHƯA TỪNG được dùng: 244 bo NTF, `ntfConfirmedAt IS NOT NULL` = 0.**
Toàn bộ NTF trong hệ thống đến từ **máy khai**, không cái nào từ người. Điều này **chứng minh** (không phải giả định) rằng backfill `ntfSource='machine'` cho toàn bộ lịch sử là đúng.
Nó cũng chỉnh lại nhận định ở L-7/§2.3: cột `ntfConfirmedBy/At/Reason` tồn tại trong schema nhưng **rỗng 100%** trong thực tế. Thiết kế QĐ-3 vẫn giữ nguyên — phân biệt nguồn là đúng — nhưng phải biết rằng nhánh 'human' hôm nay là **mã chưa có người dùng**.

**Đ-5. Retention 365 ngày là con số phải khớp**, không phải chọn tuỳ ý. Ba bảng mới dùng cùng `drop_after: 365 days` để cây không bao giờ sống lâu hơn hoặc chết sớm hơn bo cha.

**Cảnh báo về chính số này:** đây là DB **dev** (`product_inspections` chỉ 184 kB, `measurement_results` 88 kB), cửa sổ 3 tuần. Throughput nhà máy thật có thể khác hẳn. Trước khi chốt retention phải xin số từ môi trường sản xuất. Con số ở đây đủ để **bác bỏ** ước tính 1,9×, chưa đủ để **chốt** hạ tầng.

---

## 4. Hợp đồng máy v2.0, ingest, cuộn kết quả

### 4.1 Hợp đồng

Thêm `machineDataContractV2` vào `server/contracts/machineDataContract.ts`. Khuôn versioning đã có (`MACHINE_CONTRACT_VERSIONS`, `LATEST_MACHINE_CONTRACT_VERSION`, `:118-125`) — chỉ thêm entry `"2.0"` và trỏ `LATEST` sang nó.

Hình dạng lồng đúng `dashboard-sample.json`: `identity{station,machine,line,plant,country,solutionName,appVersion}`, `productId`, `serialNumber`, `productModel`, `overallResult`, `ntf`, `machineProductIndex`, `startedAt`, `completedAt`, `summary{}`, `surfaces[] → positions[] → captures[] → components[]`.

**Giữ `V1`/`V11` trong map, không để nhận, mà để từ chối có lý do.** QĐ-4 cắt máy cũ, nhưng cắt phải nói được vì sao: server trả mã lỗi *"máy chưa nâng cấp, cần phiên bản ≥ 2.0"* thay vì một đống lỗi zod thô mà kỹ sư hiện trường không đọc nổi. Đây là yêu cầu chức năng, có cổng đo riêng (§7).

### 4.2 Đường ghi

`submitInspection` (`machineApiRouters.ts:2948`) và `submitInspectionBatch` (`:3042`) đều đi qua `createProductInspection` (`server/db/inspection.ts:143`) — nơi đã có giao thức *claim idempotency key → insert header → back-fill, tất cả trong MỘT transaction*.

Cây bốn cấp ghi **bên trong cùng transaction đó**, không mở tx thứ hai. Một cú crash giữa đường không được để lại surface không có capture.

Thứ tự trong tx:
1. claim idempotency key (đã có)
2. insert `product_inspections` header
3. insert `inspection_surfaces` → `inspection_positions` → `inspection_captures` → `measurement_results`
4. stamp `configDriftFlags`, `declaredMismatch`

### 4.2b ⚠ CÓ ĐƯỜNG INGEST THỨ HAI — phát hiện khi trả nợ N-4

Giả định "mọi kết quả đi qua `createProductInspection`" ở §4.2 **SAI**. Kiểm kê đầy đủ (§12.1) tìm ra **224 tuyến Express**, và trong đó:

**`POST /api/aoi/commit` → `aoiPackageRouter.ts:724` TỰ `tx.insert(productInspections)` THẲNG.**

Nó **không** gọi `createProductInspection` (`server/db/inspection.ts:143`), **không** gọi `persistInspectionAtomic` (`:299`), **không** gọi `processInspectionSubmission` (`machineApiRouters.ts:1166`). Chính file thừa nhận ở `aoiPackageRouter.ts:43`. Đo bằng `grep -rn "insert(productInspections" server` → 4 nơi: `db/inspection.ts:111` (đường chuẩn), `statistics.ts:1749`+`:2179` (sinh dữ liệu mẫu), và `aoiPackageRouter.ts:724`.

Bốn thứ đường này bỏ qua:

| Bỏ qua | Bằng chứng |
|---|---|
| **Sổ idempotency** | `grep -n idempotencyKey server/routers/aoiPackageRouter.ts` → **0**. Nó chỉ `SELECT … WHERE machineId AND serialNumber ORDER BY createdAt DESC LIMIT 1` (`:697-707`) rồi insert |
| **Khoá tự nhiên 0272** | `insertInspectionHeader` (`inspection.ts:111`) có `ON CONFLICT DO NOTHING`; nhánh ZIP không |
| **Dò downtime** | `grep -n recordMachineActivity server/routers/aoiPackageRouter.ts` → **0** (đường chuẩn bắn ở `inspection.ts:388-392`) |
| **Chính sách xác thực yếu** | `authenticateMachine` TỪ CHỐI machineCode-trần theo mặc định (`machineAuthService.ts:167`, `MACHINE_CODE_ONLY_ALLOWED` → `deny`, lý do ở `:154-158`: *"biết mã máy là xác thực được… Nó là ĐỊNH DANH, chưa bao giờ là bí mật"*). Nhưng `aoiPackage.presign/commit` **không hề gọi `authenticateMachine`** — gọi thẳng `db.getMachineByCode()` (`aoiPackageRouter.ts:374, 491, 1479`), y hệt `PUT /api/aoi/upload/:packageId` (`_core/index.ts:4683`) |

**Hệ quả bảo mật đo được: cờ `MACHINE_CODE_ONLY_ALLOWED=deny` mua được 0 trên toàn bộ đường ZIP.** Chỉ cần biết mã máy — thứ in trên nhãn dán, có trong URL và trong báo cáo — là ghi được kết quả inspection vào hệ thống.

Đường ZIP còn **tự tạo định nghĩa điểm đo** ngoài transaction (`aoiPackageRouter.ts:655-661`) — tức là nó cũng là đường ghi **cấu hình** thứ hai, và nó chính là hiện thân của phương án "tự tạo cấu hình theo cái máy gửi" mà QĐ-5 đã **bác bỏ**.

**Quyết định thiết kế bắt buộc thêm vào khối A:** đường ZIP phải được **hợp nhất vào `createProductInspection`**, không được giữ hai đường ghi. Nếu không, mọi hàng rào dựng ở §4.2 (idempotency, transaction, thẻ lệch chuẩn, cuộn NG>NTF>OK) đều có một cửa sau đi vòng qua. Việc này **không phải phạm vi mở rộng tuỳ chọn** — nó là điều kiện để phần còn lại của khối A có nghĩa.

Ghi nhận thuận lợi: §3.7 Đ-3 đo được `inspection_packages` = **0 dòng** ⇒ đường này **chưa từng chạy thật**, nên hợp nhất bây giờ không phá dữ liệu nào.

**Các đường ingest KHÁC đều đã đi qua đường chuẩn** (kiểm chứng ở §12.1): hot folder SMB/UNC, acquisition worker, WAL replay, REST proxy `/api/machine/*`, `/api/v1/ingest/inspection`. MQTT **không** ghi inspection (`mqttService.ts:347-349` + đọc handler `:1592-1690`).

### 4.3 Thứ tự cuộn — chỗ dễ sai nhất của cả khối A

`evaluatePointResult` **chỉ** nâng OK→NG ở cấp lá và **không biết gì về cây** (L-8). Nên thứ tự buộc phải là:

```
1. Mỗi component:  evaluatePointResult(def, values, machineResult)   ← spec-gate, có thể OK→NG
2. Cuộn capture    ← từ kết quả SAU spec-gate của components
3. Cuộn position   ← từ captures
4. Cuộn surface    ← từ positions
5. Cuộn product    ← từ surfaces
```

Nếu cuộn trước rồi mới spec-gate: một component vượt ngưỡng bị nâng thành NG ở cấp lá nhưng **các cấp trên đã chốt OK** — bo NG mà surface báo OK, và không cổng nào hiện tại phát biểu được điều đó.

`rollupVerdict(children) → { result, ntf }` là **hàm thuần**, **một chỗ duy nhất**, dùng lại ở cả bốn cấp, đặt cạnh `ResultVerdict` đã có (`pointResultEvaluator.ts:27`).

Luật: **có bất kỳ NG → NG; không NG mà có NTF → NTF; không cả hai → OK.**

`ntfSource` cuộn theo: con nào có `ntfSource='human'` thì cha là `'both'` nếu cũng có `'machine'`, ngược lại là `'human'`.

### 4.4 Thẻ lệch chuẩn (QĐ-5)

`product_inspections.configDriftFlags jsonb`:

```jsonc
{
  "expectedCounts": { "surfaces": 6, "positions": 12, "captures": 24, "components": 48 },
  "actualCounts":   { "surfaces": 6, "positions": 12, "captures": 24, "components": 47 },
  "unknownComponentIds": ["a1b2..."],
  "missingComponentIds": ["c3d4..."],
  "resolvedAtVersion": 6
}
```

"Số lượng điểm đo tiêu chuẩn" đọc từ cây cấu hình **tại đúng `pointsConfigVersion` máy khai** — không phải cấu hình live, vì cấu hình live dịch chuyển dưới chân. Cơ chế "dựng lại theo version máy khai" đã có ở `resolveGateLimitsForBoard` (`pointResultEvaluator.ts:567`); dùng lại **đúng cách chọn snapshot của nó**, không tự bịa cách thứ hai.

Không từ chối bo. Không ném exception. Chỉ gắn thẻ + cảnh báo lên UI.

### 4.5 Từ chối vì SAI HỢP ĐỒNG ≠ gắn thẻ vì LỆCH CHUẨN

QĐ-5 ("nhận nhưng gắn thẻ, không từ chối") áp cho **lệch chuẩn nghiệp vụ**, không áp cho **payload sai hợp đồng**. Hai loại này phải xử lý ngược nhau, và spec phân định rõ để không ai phải đoán:

| Loại | Ví dụ | Xử lý |
|---|---|---|
| **Lệch chuẩn nghiệp vụ** — payload đúng hình dạng, nội dung khác cấu hình chuẩn | Máy gửi 47 component trong khi chuẩn có 48; máy gửi một `componentExtId` không có trong cấu hình; số capture khác chuẩn | **NHẬN**, stamp `configDriftFlags`, cảnh báo UI. Dữ liệu sản xuất không bao giờ bị mất vì lệch cấu hình. |
| **Sai hợp đồng** — payload không đúng hình dạng v2.0 | Thiếu `captureId` trong manifest ảnh; thiếu `relX`/`relY`; `schemaVersion` là `"1.1"`; thiếu `expectedUpdatedAt` khi push cấu hình | **TỪ CHỐI**, mã lỗi nói rõ field nào thiếu và cần phiên bản nào. Ghi rác im lặng là lỗi nặng hơn từ chối ồn ào. |

Ranh giới: **hình dạng thì cứng, nội dung thì mềm.** Máy có thể đo lệch chuẩn — đó là dữ liệu thật cần giữ. Máy không được gửi sai hình dạng — đó là lỗi tích hợp cần sửa ở máy, và che nó đi chỉ làm nó tồn tại lâu hơn.

Lý do bắt buộc phải phân định: L-2 (§2.3) là ví dụ sống của việc *xử lý sai hợp đồng như thể nó là lệch nội dung* — `|| 'UNKNOWN'` biến một lỗi tích hợp thành một bảng đầy rác mà không ai biết.

---

## 5. Gói ảnh và KPI

### 5.1 Vá L-2 (hỏng im lặng)

`package_images` thêm: `captureExtId` varchar(64), `surfaceName` varchar(100), `positionId` varchar(64), `captureName` varchar(255). `pointCode` **xuống hàng phụ, giữ nullable** cho dữ liệu cũ (hiện `NOT NULL` — migration phải nới trước).

Khoá join thật: **`(packageId, captureExtId)`** — đúng khoá tài liệu mẫu chỉ định.

Bỏ hoàn toàn nhánh `|| 'UNKNOWN'`. Manifest v2.0 thiếu `captureId` là **lỗi hợp đồng**, phải từ chối gói với lý do rõ, không được lặng lẽ ghi rác.

Sửa `aoiPackageRouter.ts:869`: bỏ `!p.result` khỏi mệnh đề đếm NTF. Nguồn sự thật cho ok/ng/ntf của gói là **payload kết quả (file 1)**, không phải manifest ảnh (file 2) — file 2 cố ý không mang result.

`inspection_packages` thêm `ntfCount` (L-3). `totalPoints` giữ tên nhưng **phải ghi rõ trong comment nó đếm capture hay component**; thêm `captureCount` để không phải suy diễn.

### 5.2 KPI — không phát minh lại quy ước đã chốt

**`NTF = pass` trong final yield giữ nguyên** (`statistics.ts:341-342`, `:398-399`, *"decision #4"*). Panel-level yield giữ nguyên (`:471-488`). `liveStatsRollupService` giữ nguyên (`:76`).

**Cái mở rộng:** hiện tổng hợp chỉ tới cấp bo. Phân rã theo surface/capture **không** nhồi vào bốn tầng CAGG/MV hiện có — chúng là đường nóng của dashboard, thêm chiều vào là làm chậm cái đang chạy tốt. Làm đường riêng, đọc từ `inspection_surfaces`/`inspection_captures`, **chỉ chạy khi người dùng drill-down**.

Bốn tầng phải theo dõi không được đổi số: `hourly_yield_cagg`, `hourly_yield_cache` (`0235`), MV ở `0111` và `0174`.

---

## 6. Hai luật nâng version (QĐ-7)

### 6.1 Luật 1 — người dùng sửa trên hệ sinh thái

Đã có: `pointsConfigVersion + 1` nguyên tử (`server/db/product.ts:308`), qua `bumpAndNotifyPointsConfig`. Việc phải làm: mở rộng để sửa **cây bốn cấp** (thêm/xoá/sửa surface, position, capture) cũng kích hoạt bump — hiện chỉ sửa điểm đo mới bump.

### 6.2 Luật 2 — máy sửa rồi đồng bộ lên

Ba field mới, **bắt buộc** trong v2.0 của `syncMeasurementPoints`:

| Field | Nghĩa |
|---|---|
| `baseProductVersion` | bản chuẩn máy nhánh ra |
| `currentMachineVersion` | version cấu hình máy đang chạy |
| `requestVersionBump` | xin ghi + nâng (`true`), hay chỉ báo cáo trạng thái (`false`) |

Cộng với `points[].expectedUpdatedAt` chuyển từ optional → **bắt buộc**.

### 6.3 Giao thức kiểm tra

Trong **một transaction**, có **`FOR UPDATE`** trên hàng config — dùng lại đúng khuôn `revertPointsConfigToVersion` (`product.ts:2126`):

| # | Kiểm tra | Lệch thì |
|---|---|---|
| 1 | `baseProductVersion` == `product_models.pointsConfigVersion` hiện tại? | `CONFLICT BASE_DRIFT` — *"bản chuẩn đã lên vN, máy nhánh từ vM; đồng bộ xuống trước rồi push lại"* |
| 2 | `currentMachineVersion` == version máy trên server? | `CONFLICT MACHINE_VERSION_STALE` — *"máy khai vM, server đang vN; máy khác đã nâng"* |
| 3 | từng `expectedUpdatedAt` khớp? | `CONFLICT` per-point — cơ chế **đã có**, chỉ cần bật cờ |
| 4 | ba bước trên xanh | ghi, rồi `version + 1` |

**Bước 1 và 2 là mới** (vá L-6). **Bước 3 đã tồn tại đầy đủ, đang tắt** (vá L-7).

**Ba máy cùng nâng từ base v6:** máy đầu thắng (v3→v4). Hai máy sau **đỏ ở bước 2**, bị từ chối, **không ghi một byte nào**. Không ai mất điểm đo, và mỗi máy được nói cho biết chính xác vì sao bị chặn và phải làm gì.

Bước 1 và 2 là compare-and-swap ở **cấp TẬP**; bước 3 là CAS ở **cấp ĐIỂM**. Cả hai đều cần: CAS tập chặn "2-3 máy cùng nâng"; CAS điểm chặn "hai người sửa cùng một điểm".

### 6.4 `requestVersionBump: false` — một field, hai việc

Khi `false`: **không ghi gì vào cấu hình**, chỉ cập nhật `machine_config_state.reported*` + `driftState`. Đó chính là nửa còn thiếu của bảng shadow đang bị cờ tắt làm bất động (§2.2). Không dựng cơ chế thứ hai.

Đợt này **bật** ba cờ trong `.env`: `MACHINE_SYNC_OPTIMISTIC_LOCK`, `CONFIG_SYNC_GENERIC_ENABLED`, `CONFIG_DRIFT_REPORT_ENABLED`. Việc bật cờ **phải có cổng đo canh** — xem §7.

### 6.5 Dạng thoái hoá khi khối B chưa xong

Trục máy (`machine_points_configs`, `machine_point_overrides`) là khối B. Trong khối A, giao thức §6.3 chạy ở dạng thoái hoá:
- Bước 1 (`BASE_DRIFT`) hoạt động **đầy đủ** — chỉ cần `product_models.pointsConfigVersion`, đã có.
- Bước 2 (`MACHINE_VERSION_STALE`) — khi chưa có `machine_points_configs`, server lấy version máy từ `machine_config_state.reportedVersion` (`configKind='points'`). Kém chính xác hơn nhưng **không sai**, và không phải viết lại khi B xong.
- Bước 3, 4 hoạt động đầy đủ.

`currentMachineVersion` và `requestVersionBump` vẫn **bắt buộc** trong hợp đồng ngay từ khối A, để không phải phá hợp đồng lần thứ hai khi B lên.

---

## 7. Cổng đo — mỗi phép phải chứng minh nó ĐỎ được

Dự án này có tiền sử lưới xanh giả. Quy tắc của đợt này: **mỗi cổng đo phải kèm một đột biến đã CHẠY THẬT làm nó đỏ**, và báo lại con số. Không được khai "đã có test".

### 7.1 Cuộn kết quả và ingest

| Phép đo | Đột biến làm nó đỏ |
|---|---|
| Cuộn đúng ưu tiên NG > NTF > OK ở cả 4 cấp | Đảo thành NTF > NG |
| Spec-gate chạy TRƯỚC cuộn | Đổi thứ tự hai bước ở §4.3 |
| Máy khai surface OK mà component NG ⇒ `declaredMismatch` | Bỏ phép so khai-vs-cuộn |
| Payload v1.1 phẳng bị từ chối **có mã lỗi rõ** | Trả lỗi zod thô |
| Toàn cây trong MỘT transaction | Tách insert capture ra tx riêng |
| `ntfSource` cuộn đúng (machine/human/both) | Luôn ghi `machine` |

### 7.2 Gói ảnh và KPI

| Phép đo | Đột biến |
|---|---|
| Manifest v2.0 → `pointCode` **không** được là `'UNKNOWN'` | Trả lại map cũ `aoiPackageRouter.ts:679` |
| Manifest thiếu `result` → **không** được đếm thành NTF | Trả lại `!p.result` ở `:869` |
| Join ảnh↔capture đúng khi 1 position có **nhiều** capture | Join bằng `positionId` thay vì `captureExtId` |
| `NTF = pass` trong yield giữ nguyên sau đợt này | Đổi thành NTF = fail |
| Bốn tầng CAGG/MV **không đổi số** sau khi thêm cây | So số trước/sau trên cùng tập dữ liệu |

### 7.3 Version và chống ghi đè

| Phép đo | Đột biến |
|---|---|
| 3 máy cùng nâng từ cùng base ⇒ **đúng 1** máy thắng | Bỏ bước 2 ở §6.3 |
| Base lệch ⇒ từ chối, **không ghi một phần nào** | Cho ghi trước rồi mới check |
| `MACHINE_SYNC_OPTIMISTIC_LOCK` thật sự ON trong `.env` | Xoá cờ khỏi `.env` |
| `requestVersionBump:false` ⇒ **0 byte** ghi vào config | Cho nó ghi |
| `expectedUpdatedAt` là **bắt buộc** ở v2.0 | Cho nó optional |
| Override chỉ vá được ngưỡng, không vá được cây (khối B) | Cho patch chứa `captureRowId` |
| Revert máy: nội dung lùi, version đi **tiến** | Cho version lùi theo |
| Một `productModelId` **không trộn** điểm phẳng và điểm cây (§3.3) | Tạo một sản phẩm nửa phẳng nửa cây ⇒ cổng phải đỏ |
| Điểm phẳng cũ (`captureRowId IS NULL`) phân giải y như trước | Đổi luật phân giải sang bắt buộc qua cây ⇒ đỏ |

### 7.4 Dọn mồ côi — cổng đo cho một lệnh XOÁ

Đây là chỗ duy nhất trong khối A có `DELETE`. Cổng phải nghiêm hơn phần còn lại.

| Phép đo | Đột biến |
|---|---|
| Dọn xoá **đúng** hàng không có cha | Bo cha còn sống mà con bị xoá ⇒ đỏ |
| Dọn **không** chạm hàng lịch sử `captureRowId IS NULL` có cha hợp lệ | Mở rộng mệnh đề sang "không đúng mẫu" ⇒ đỏ |
| Cascade kéo đủ position/capture/result khi surface chết | Bỏ `ON DELETE CASCADE` ⇒ đỏ (còn sót) |
| Ngưỡng chặn `ORPHAN_SWEEP_MAX_ROWS` thật sự dừng được | Dựng tập vượt ngưỡng ⇒ phải DỪNG, không xoá; nếu vẫn xoá là đỏ |
| Dọn chạy SAU retention | Đảo thứ tự ⇒ đỏ |
| Số đã xoá được ghi vào `integrity_scan_results` trước khi xoá | Bỏ ghi ⇒ đỏ |

Đột biến "ngưỡng chặn" phải chạy trên **DB tạm dùng một lần**, không chạy trên DB dev dùng chung.

### 7.4 Cạm bẫy đã biết của repo này — phải tránh

1. **Đột biến bằng sai vai DB trả 42501, lưới vẫn xanh, đọc nhầm thành "bắt được".** DDL phải dùng owner `aoi`, không phải `avi_app`.
2. **Glob rỗng ⇒ vitest im lặng, cổng khai xanh.** Mỗi file test mới phải kiểm chứng nó **thật sự chạy** (đếm số ca trước/sau).
3. **`tsconfig` loại trừ `*.test.ts`** từng là cơ chế đẻ lưới giả — kiểm tra file mới có nằm trong glob của `vitest.config.ts`.
4. **Lượng từ tự thoả.** Mệnh đề kiểu "mọi X đều Y" trên tập rỗng luôn đúng. Mỗi phép đo phải chứng minh **tập không rỗng** trước khi tin kết luận.
5. **Cờ bật trong `.env.example` không phải cờ bật trong `.env`.** Phải đo `.env` đang chạy.

---

## 8. Nợ khảo sát — chưa đo, không được coi là đã xong

> **TOÀN BỘ NỢ N-1…N-5 ĐÃ TRẢ ngày 2026-08-24 — kết quả ở §12 (và §3.7 cho N-5).**
> Bảng dưới giữ nguyên phần mô tả nợ để thấy vì sao từng mục được đặt ra.
> **Bốn trong năm mục lật lại nội dung spec**, không chỉ bổ sung: N-4 tìm ra đường ingest thứ hai (→ §4.2b), N-1 tìm ra mâu thuẫn NTF ở ~15 nơi (→ §12.2), N-5 bác bỏ ước tính số dòng (→ §3.7), N-3 tìm ra bẫy import chạm thẳng schema điểm đo (→ §12.4).

Chín agent khảo sát chết vì lỗi API 529 ở lượt đầu (mỗi con retry một lần, vẫn chết); lượt hai chạy được. Các mục sau là nợ ban đầu:

| # | Nợ | Vì sao quan trọng |
|---|---|---|
| N-1 | Đọc sâu tầng KPI/aggregation ngoài bốn tầng đã tìm được | Có thể còn MV/CAGG/query khác đọc `measurement_results` mà đợt này làm lệch số |
| N-2 | Kiểm kê màn UI nào đang hiển thị **dữ liệu giả** (mock/placeholder) trông như thật | Sửa backend rồi vẫn thấy số cũ ⇒ tưởng hỏng; hoặc ngược lại, tưởng chạy |
| N-3 | Tình trạng i18n của các màn liên quan | Tiền lệ: bọc `t()` vào header cột từng **phá chức năng nhập Excel** vì header là khoá khớp file |
| N-4 | **Kiểm kê đầy đủ tuyến Express** máy gọi được (không chỉ 27 tRPC procedure) | Tiền lệ: cổng điều tra chỉ thấy tRPC, bỏ sót 101 `app.get`. Có thể còn đường ingest thứ hai không ai biết |
| ~~N-5~~ | ~~Throughput thật~~ | **ĐÃ TRẢ — xem §3.7. Kết quả bác bỏ ước tính ở §3.5 (7,5× chứ không phải 1,9×) và phát hiện thêm bốn điều Đ-2…Đ-5.** |

## 9. Hạ tầng nghiệm thu — hiện KHÔNG đủ cho yêu cầu "verify bằng Playwright"

Đo được từ `playwright.config.ts` và `e2e/`:

- **Chỉ 5 spec**: `api-health`, `dashboard`, `login`, `overview-responsive`, `product-setup`
- `testDir: "./e2e"` + `testMatch: "**/*.spec.ts"` — khớp đúng vị trí file thật, glob **không** rỗng
- `screenshot: "only-on-failure"` ⇒ **không chụp ảnh khi PASS**
- **Không có visual regression** (không `toHaveScreenshot`, không baseline)
- **Không có `webServer`** ⇒ Playwright không tự khởi động app; phải bật tay, `PLAYWRIGHT_BASE_URL` mặc định `http://localhost:3000`

Yêu cầu của chủ dự án là *"verify bằng Playwright để đảm bảo trực quan thay vì chỉ hình dung trên code"*. Với cấu hình hiện tại điều đó **không làm được**. Trước khi vào khối C và D, phải bổ sung: chụp ảnh khi PASS, baseline visual, `webServer` hoặc quy trình khởi động có văn bản, và fixture đăng nhập.

Ghi nhận thêm một bài học của dự án này: **subagent tự nghiệm thu thị giác không đáng tin** — phải tự chụp, tự đọc ảnh, và phải đo.

---

## 10. Thứ tự thực thi

**QĐ-9 (2026-08-24): vá nợ cũ TRƯỚC, rồi mới thêm cây.** Lý do: thêm ba bảng con trước thì mọi lệch số sẽ bị quy oan cho đợt nâng cấp, và không ai tách được đâu là nợ có sẵn. Đây đúng là lớp lỗi *"đỏ vì đếm theo dòng, không vì có nợ"* mà dự án đã trả giá.

### Pha 0 — vá nợ CÓ SẴN, đo trước/sau trên cùng dữ liệu

0.1 **Dọn DB dev** theo §12.5 (đếm trước, xoá, đếm lại, báo số).
0.2 **Hợp nhất đường ZIP vào `createProductInspection`** (§4.2b). Đây là **chặn** — nó là cửa sau của mọi hàng rào khối A. Kèm: bắt `aoiPackage.presign/commit` đi qua `authenticateMachine` để cờ `MACHINE_CODE_ONLY_ALLOWED` thôi vô nghĩa.
0.3 **Vá ~15 chỗ mâu thuẫn NTF** (§12.2), bắt đầu từ `cachedStatistics.ts:214` (có cache, 0 test) và `scheduledReportService.ts:397` (dòng không cộng bằng tổng). Mọi chỗ dùng chung helper `server/utils/kpi.ts`, không viết công thức tay.
0.4 **Dựng lưới cho thân SQL của MV** `0174:57-60` và `hourly_yield_cagg` — hôm nay không phép đo nào chạy qua chúng.
0.5 **Gỡ/gắn nhãn hai màn bịa dữ liệu** (§12.3) — `PcbThumbnail` và heatmap-theo-giờ. Làm TRƯỚC khi đổi backend, nếu không sẽ không phân biệt được "chưa nối" với "đang chạy".
0.6 **Hợp nhất spec cột sản phẩm** `productRouters.ts:361-377` ↔ `ProductModels.tsx:221-231` (§12.4), thêm cổng canh lệch.

**Cổng ra pha 0:** báo cáo số yield trước/sau trên cùng tập dữ liệu, và nói rõ chỗ nào đổi số vì đã sửa đúng.

### Pha 1 — dựng cây

1. **Thử `ADD COLUMN` trên bản sao có nén** trước khi viết migration thật (§12.2).
2. **Migration schema** — 6 bảng mới + mở rộng 4 bảng cũ. Mọi cột mới nullable, không backfill.
3. **`rollupVerdict` + cổng đo cuộn** — hàm thuần, test trước khi có đường ống. Chạy 6 đột biến §7.1.
4. **Hợp đồng v2.0** + từ chối v1.1 có mã lỗi rõ.
5. **Ingest cây 4 cấp** trong transaction hiện có + `configDriftFlags` + `declaredMismatch`.
6. **Cập nhật bí danh `findCol`** trong `BulkImportDialog.tsx:148-176` **cùng lúc** với đổi schema điểm đo (§12.4) — lệch là import gãy im lặng.
7. **Vá gói ảnh** (L-2, L-3, L-4) + 5 đột biến §7.2. Nghiệm thu bằng **một gói chạy thật đầu-cuối**, vì §3.7 Đ-3 chứng minh đường này chưa từng chạy.
8. **Giao thức version §6** dạng thoái hoá + bật 3 cờ + 7 đột biến §7.3.
9. **Dọn mồ côi §3.6** + 6 đột biến §7.4.
10. **Đo lại 4 tầng CAGG/MV** trước/sau trên cùng tập dữ liệu.

Mỗi bước báo lại: cổng nào chạy, bao nhiêu ca, đột biến nào đã chạy thật và nó có đỏ không.

Mỗi bước báo lại: cổng nào chạy, bao nhiêu ca, đột biến nào đã chạy thật và nó có đỏ không.

---

## 11. Câu hỏi mở — phải chốt trước khi viết kế hoạch

**CH-1. Ba bảng mới: bảng thường (giữ 3 FK thật, tự viết cron dọn) hay hypertable (mất FK, được `drop_after` tự động)?**
§3.2 chọn bảng thường để giữ ba FK thật, đổi lại phải tự dọn. Lúc chọn tôi tưởng số dòng tăng 1,9×. §3.7 đo ra **7,5×** — khoảng **53 triệu dòng** thường trú ở retention 365 ngày, đỉnh 75.600 dòng/giờ. Ở quy mô đó, "tự viết cron dọn" đắt hơn nhiều so với lúc quyết định, và nén (compression) của Timescale — đang bật cho cả 7 hypertable hiện có — sẽ không áp dụng được.
Đánh đổi: **hypertable** ⇒ mất cả ba FK, cả cây thành liên kết mềm, phụ thuộc hoàn toàn vào quét mồ côi; **bảng thường** ⇒ giữ toàn vẹn, nhưng gánh 53 triệu dòng không nén và cron dọn tự viết.
Cần số throughput **sản xuất thật** để chốt. Nếu nhà máy thật ở mức 67 bo/giờ như dev thì bảng thường vẫn chịu được; nếu cao hơn một bậc thì phải đổi.

**CH-2. Vì sao 42,6% bo không có `measurement_results`?** (Đ-2) Ảnh hưởng trực tiếp phép đếm lệch chuẩn ở §4.4. Cần người hiểu nghiệp vụ trả lời, không suy ra được từ code.

**CH-3. Throughput sản xuất thật.** Số ở §3.7 là DB dev, cửa sổ 3 tuần. Chốt CH-1 cần số thật.

---

## 13. Dữ kiện MỚI sau Pha 0 — spec phải cập nhật trước khi làm Pha 1

Pha 0 đo được bốn điều mà spec này viết khi chưa biết. Ba trong bốn **chạm thẳng** thiết kế Pha 1.

**Đ-6. `ADD COLUMN` trên hypertable đã nén: AN TOÀN — §12.2 hết là câu hỏi mở.**
Thử thật trên DB dev (Timescale **2.28.2**, nén bật cả hai bảng, `product_inspections` có **1/3 chunk đã nén thật**): `ALTER TABLE ... ADD COLUMN <nullable>` **thành công trên cả hai bảng**, rollback sạch, 0 cột sót.
⇒ Migration Pha 1 mở rộng `product_inspections` và `measurement_results` bằng cột **nullable** là đường an toàn. **Chưa chứng minh** cho cột `NOT NULL DEFAULT` — spec vẫn giữ nguyên tắc mọi cột mới đều nullable (§3.2).
**CẬP NHẬT 2026-08-25 (Pha 1A Task 3) — bằng chứng MẠNH HƠN:** migration 0339 đã `ADD COLUMN` nullable thành công trên DB **test** có **42.147 bo / 31.240 điểm đo** và **5/72 chunk đã nén** của `product_inspections`, 0 lỗi nén/chunk. Đây là bằng chứng thực nghiệm ở quy mô thật, không còn là suy từ 1 chunk rỗng.
⚠ Vẫn giữ nguyên tắc: chỉ cột NULLABLE. `NOT NULL DEFAULT` **chưa** được chứng minh ở bất kỳ quy mô nào.

**Đ-7. `product_inspections` KHÔNG WORM tuyệt đối — và điều này lung lay §3.6.**
Vai `avi_app` bị từ chối `DELETE` (42501), nhưng vai owner `aoi` **xoá được**, và Pha 0 đã xoá thật 22.996 hàng.
§3.6 thiết kế chính sách dọn mồ côi dựa trên giả định *"bo cha chỉ biến mất qua retention/`drop_chunks`"*. Giả định đó **sai**: bo cha còn biến mất được qua bất kỳ ai có vai owner.
⇒ Chính sách dọn ở §3.6 vẫn đúng về **cơ chế** (xoá hàng không có cha), nhưng **lý lẽ về tần suất và nguyên nhân** phải sửa: mồ côi không chỉ sinh ra sau retention theo lịch, mà sinh ra bất cứ lúc nào có thao tác owner. Ngưỡng chặn `ORPHAN_SWEEP_MAX_ROWS` càng cần thiết, không phải càng thừa.

**Đ-8. 68 dòng MV trỏ tới dữ liệu đã biến mất — ĐÃ truy nguyên đủ để KHÔNG chặn Pha 1.**
Đo ở Task 8. Giả thuyết retention bị **bác bỏ** (0/135 dòng ngoài hạn 365 ngày).
Đo tiếp trên đúng DB test: các máy bị ảnh hưởng mang **id thường** (1, 2, 3, 4, 5, 13, 15, 25, 27, 28, 29, 59), không phải id khuôn test (`>= 999000` = **0 máy**). Nhưng hình dạng rất đặc trưng: **hàng loạt máy có ĐÚNG 9 dòng, cùng một cửa sổ hẹp `2026-07-12 08:00 → 07-13 04:00`**.

Đó là dấu vân tay của **một mẻ dữ liệu sinh HÀNG LOẠT rồi bị xoá** — chính xác thứ `seedInspectionData`/`seedWorkstationAnalyticsData` tạo ra (đều đặn, nhiều máy, cùng cửa sổ), và chính xác thứ một lượt dọn sẽ xoá đi. Cộng với Đ-7 (vai owner xoá được), lời giải thích thường tình là **đủ**: MV cũ + dữ liệu seed đã bị xoá.

⇒ **KHÔNG có bằng chứng về một tiến trình xoá bí ẩn nào.** Đ-8 **không chặn** Pha 1.
Nói cho đúng mức: đây là **giả thuyết được dữ liệu ủng hộ mạnh**, không phải điều đã chứng minh — tôi không truy được tiến trình nào đã xoá. Nhưng hai hàm seed đó **đã bị gỡ ở cuối Pha 0**, nên nguồn nghi vấn lớn nhất không còn tái tạo được nữa.
Việc cần làm ở Pha 1: sau khi dựng cây, **refresh MV rồi đo lại** — nếu số mồ côi vẫn sinh ra trên dữ liệu mới thì giả thuyết này sai và phải điều tra tiếp.

**Đ-9. DB dev nay RỖNG (6/6 bảng = 0).**
Mọi phép đo Pha 1 phải **tự dựng dữ liệu**, không dựa vào corpus cũ. Hai lưới Pha 0 có ca chống-tự-thoả đòi bảng không rỗng (`ntfCotKhongLech`, `mvYieldParity`) — chúng chạy trên DB **test** (`aoi_management_test`, 41.716 hàng) nên không ảnh hưởng; nhưng lưới **mới** của Pha 1 phải tự lo dữ liệu.
⚠ Và **không được dựng lại hàm seed** — Pha 0 vừa gỡ chúng vì chúng bơm `Math.random()` vào bảng WORM. Lưới Pha 1 tự chèn dữ liệu **trong phạm vi test của mình** và tự dọn, hoặc dùng DB test.

**CH-4 (ĐÃ GIẢI QUYẾT) — xoá dữ liệu lịch sử.** Chủ dự án đã chọn "xoá cả dữ liệu lịch sử không theo định dạng mới", ban đầu **trái với QĐ-4** ("dữ liệu lịch sử vẫn phải xem được"). Mâu thuẫn được gỡ khi chủ dự án làm rõ: **22.996 bo đó là dữ liệu TEST**, không phải lịch sử sản xuất — nên QĐ-4 không bị vi phạm. Đã thực thi trên **DB dev** qua `scripts/don-db-dev.mjs` (ba lớp chặn: chỉ localhost · mặc định chỉ đếm · trần số hàng), kết quả **6/6 bảng = 0**. **DB test `aoi_management_test` KHÔNG bị chạm** — vẫn còn 42.147 bo, và chính nó cung cấp bằng chứng quy mô thật cho Đ-6.

**Đ-10. Đổi `LATEST_MACHINE_CONTRACT_VERSION` sang "2.0" đổi HÀNH VI của một endpoint máy gọi thật — không chỉ đổi tài liệu.**
Đo ở Pha 1A Task 4 (commit `73509566`). Hằng này có **hai** hộ tiêu thụ ngoài chính nó:
- `server/api/v1/openapi.ts:178` — JSON-Schema công bố. Đây là **tài liệu**.
- `server/routers/machineContractRouter.ts` (4 điểm: dòng 28, 32, 52, 66) — đây **KHÔNG** phải tài liệu. Thủ tục `validate` là endpoint **firmware gọi để tự kiểm payload TRƯỚC khi gửi thật**. Máy gọi `validate({payload})` mà không khai `version` nay bị đo bằng cây v2.0.

⇒ Hướng đi đúng theo QĐ "chỉ nhận v2.0, cắt máy cũ", nhưng phải ghi nhận đây là **thay đổi hành vi**, và nó đi **TRƯỚC** đường ingest thật (`/api/v1/ingest/inspection` vẫn nhận hình dạng cũ cho tới Pha 1B). Trong cửa sổ giữa hai pha, một máy cũ sẽ nghe `validate` nói "payload của anh SAI" trong khi đường ingest vẫn nhận nó. Pha 1B phải đóng cửa sổ này.

**Đ-11. Hàm từ chối máy cũ ĐÃ VIẾT nhưng CHƯA NỐI — chú thích và tên test đang khai quá.**
`loiMayChuaNangCap()` (`server/contracts/machineDataContract.ts:138`) sinh thông điệp nêu rõ phiên bản cần. Nhưng `grep` toàn `server/` + `client/src` cho thấy nó **chỉ xuất hiện ở định nghĩa và ở file test** — **0 điểm gọi trong mã sản xuất**.
Đo thật: `validateMachinePayload("1.1", <payload v1.1 hợp lệ>)` trả **`{ok: true}`** — v1.1 vẫn được **NHẬN**, đúng ngược với điều chú thích dòng 121-122 khai (*"KHÔNG phải để nhận — mà để nhận DIỆN và từ chối"*).
Việc **chưa nối là ĐÚNG phạm vi** — Task 4 bị cấm chạm đường ingest, chỗ nối thuộc Pha 1B. Cái sai là **chữ nghĩa**: một ca test tên *"lỗi từ chối máy cũ NÊU RÕ phiên bản cần"* chỉ chứng minh **chuỗi lỗi được viết hay**, không chứng minh việc từ chối xảy ra. Đây đúng khuôn sinh "xanh giả" mà spec này chống ở §7.
⇒ **Pha 1B bắt buộc**: nối `loiMayChuaNangCap` vào đường ingest thật, và **chỉ khi đó** mới được phát biểu "v1.x bị từ chối".

**Đ-12. Lưới bất biến "không trộn phẳng/cây" hiện đo một quần thể CHƯA TỒN TẠI.**
Đo ở Pha 1A Task 5 (commit `59edeffd`), vai `avi_app`, DB `aoi_management_test`:
`measurement_point_defs` LIVE = **2.340 tổng / 2.340 phẳng / 0 cây**.
Lưới đã **chứng minh đỏ được** (dựng thủ công một `productModelId` trộn hai loại → đỏ đúng tên → dọn → xanh lại, đếm về đúng 2.340). Nhưng ca "chống tự thoả" chỉ canh `count(*) > 0`, **không** canh có tồn tại điểm cây nào.
⇒ Khi Pha 1B bắt đầu ghi `captureRowId`, nếu một lỗi khiến **mọi** lượt ghi để NULL thì **cả hai ca vẫn xanh** — lưới mù đúng thứ Pha 1B sinh ra. **Pha 1B phải siết ca hai thành "phải có ≥1 điểm cây"** ngay khi đường ghi cây chạy thật.

### Bàn giao Pha 1B — bốn mục có SỐ ĐO, không được để im lặng

| Mã | Việc | Số đo hiện tại |
|---|---|---|
| **BG-1** | Nối `loiMayChuaNangCap` vào ingest; chỉ khi đó mới được nói "v1.x bị từ chối" | 0 điểm gọi sản xuất (Đ-11) |
| **BG-2** | Đóng khoảng lệch OpenAPI ↔ endpoint thật | Doc đã **xoá hẳn** `machineCode` và `measurements` — đúng hai trường endpoint thật đang đòi. Đối tác đọc doc làm theo sẽ **400 chắc chắn**. 0 cổng nào đỏ vì việc này (`apiV1.test.ts` 16/16 xanh) |
| **BG-3** | `machineContractRouter.validate` trả lời **ngược** với ingest ở CẢ HAI CHIỀU trong cửa sổ 1A→1B; hiện **không có file test nào** cho router này | 4 điểm dùng `LATEST` (dòng 28, 32, 52, 66) (Đ-10) |
| **BG-4** | Siết ca chống-tự-thoả thành "phải có ≥1 điểm cây" | cây = **0** (Đ-12) |
| **BG-5** | §3.6 mở rộng sang mồ côi phía **CẤU HÌNH**, không chỉ phía kết quả | **94** điểm đo LIVE mồ côi (Đ-13) |
| **BG-6** | Chốt cách định danh surface: `surfaceExtId` **không điền được** từ đường ingest kết quả | 3 mẫu thật, 3 cách định danh khác nhau (Đ-14) |
| **BG-7** ⛔ | **Chốt cầu nối NTF.** `rollupVerdict` KHÔNG làm được việc này | **2.760/42.147 = 6,55%** bo đang mang `overallResult='NTF'`; quét vét cạn 16 tổ hợp v2.0 → **0 lần** cuộn ra NTF (Đ-15) |
| **BG-8** ⛔ | Đổi tên hoặc ràng buộc một trong hai `captureRowId`; nêu tên bảng đích trong `0339:86-89` | 1 FK có / 1 FK không, hai dãy id **chồng khoảng** (Đ-16) |
| **BG-9** | `.max(64)` cho 3 khoá join + `.max(100)` cho `surface.name` | hợp đồng nhận 80 ký tự → DB `[22001]` (Đ-14 đã sửa) |
| **BG-10** | Chốt hình dạng `summaryCounts` | `TS2322` — `Record<string,number>` không chứa nổi `summary` 4×4 |
| **BG-11** | Khoá duy nhất / khử trùng cho cây KẾT QUẢ, gắn với `idempotencyKey` của header | 1 bo × 2 lượt gửi = **2/2/2 hàng**, không gì chặn |
| **BG-12** | Dời chỉ mục `declaredMismatch` xuống position/capture | 1/3 cấp có chỉ mục, và đặt đúng cấp **duy nhất là phái sinh** |
| **BG-13** | Khoá duy nhất `(captureRowId, componentExtId)` cho cấp component | 3/4 cấp có unique ⇒ cấp 4 **không có đích `ON CONFLICT`** |
| **BG-14** ⛔ | **Serial rỗng: phán quyết của TÔI chưa đủ.** Nới hợp đồng là đúng theo tài liệu máy, nhưng ingest nới theo sẽ **mở lại lỗ đếm trùng** | `uq_inspections_machine_serial_time ... WHERE serialNumber <> ''` — serial rỗng **thoát khoá duy nhất**; hiện **0/42.147** bo rỗng (Đ-17) |
| **BG-4** (bổ sung) | Lưới khớp schema phải canh **kiểu + độ dài**, không chỉ TÊN cột | đột biến thu `captureExtId` xuống `varchar(8)` ⇒ **27/27 vẫn xanh** |

**Đ-13. Mồ côi phía CẤU HÌNH cũng tồn tại — §3.6 hiện chỉ thiết kế cho phía KẾT QUẢ.**
Người review Task 5 phát hiện, tôi tự đo lại bằng vai `avi_app` trên `aoi_management_test`:
`measurement_point_defs` có **94 hàng LIVE** mang `productModelId = 99942017` — **không tồn tại** trong `product_models` (thiếu hẳn hàng cha, không phải xoá mềm).
Nguyên nhân cấu trúc: `measurement_point_defs` có **4 FK** (`preferredInstrumentId`, `productViewId`, `preferredSamplingPlanId`, `captureRowId`) nhưng **KHÔNG có FK nào trỏ `product_models`**. Không có gì ngăn điểm đo sống sót khi sản phẩm cha biến mất.
Id `99942017` vượt ngưỡng id-khuôn-test (`≥ 999000`, xem Đ-8) ⇒ **nhiều khả năng là rác fixture**, không phải lỗi vận hành. Nhưng điểm cấu trúc vẫn đứng độc lập với nguyên nhân: **§3.6 chỉ nói về mồ côi phía kết quả** (dòng đo không có bo cha). Mồ côi phía **cấu hình** là lớp thứ hai, chưa có chính sách nào.
⇒ Không chặn Pha 1A (lưới Task 5 không JOIN `product_models` nên vẫn bắt được trộn bất kể cha còn hay mất — đã xác minh). Pha 1C phải mở rộng §3.6 cho lớp này, hoặc nói rõ vì sao cố ý bỏ qua.

**Đ-14. Ba mẫu máy THẬT định danh `surface` theo BA cách khác nhau — và cột `surfaceExtId` không điền được từ đường ingest kết quả.**
Đo trực tiếp trên ba tệp trong `D:\SOURCES\AOIData`:

| Mẫu | Vai trò | Khoá cấp surface |
|---|---|---|
| `dashboard-sample.json` | payload **kết quả** máy gửi | chỉ `name` — `["TOP","BOTTOM","LEFT","RIGHT","FRONT","BACK"]`, **KHÔNG có id** |
| `template-sync-sample.json` | **teach data** | `surfaceId` (GUID) **+** `surfaceName` |
| `aoipackage-meta-sample.json` | **manifest ảnh** | `surface` — chuỗi TÊN, không phải id |

Nguyên nhân gốc nằm trong tài liệu nguồn: `HookProductContext` chỉ có `Positions` **phẳng**, **không có node Surface riêng** — generator **tự gộp** theo `HookPosition.SurfaceName`. Nghĩa là ở đường kết quả, surface **không tồn tại như một thực thể có id**; nó là một phép gộp theo tên.

Hệ quả cho Pha 1A: `product_surfaces.surfaceExtId(64)` và `inspection_surfaces.surfaceExtId(64)` (T2/T3 dựng) **sẽ luôn NULL trên đường ingest kết quả**. Cột chỉ điền được từ đồng bộ teach data (Khối B). Từng task đứng riêng đều đúng; ghép lại thì có một cột **nguồn dữ liệu chính không bao giờ điền nổi**.

⇒ **Pha 1B buộc phải join surface theo `surfaceName`** — một chuỗi tự do, người dùng đổi được. Đổi tên surface trong teach data ⇒ **lịch sử kết quả đứt khỏi cấu hình**. Phải chốt tường minh: hoặc coi `surfaceName` là khoá tự nhiên và **cấm đổi tên** (hoặc đổi tên phải kèm di trú), hoặc ánh xạ tên→`surfaceExtId` một lần lúc nhận teach data rồi ingest tra ngược.

**⚠ SỬA LẠI (review toàn nhánh bác bỏ).** Tôi đã viết ở đây: *"Tin tốt, đã đo: không có nguy cơ cắt cụt chuỗi"*. **Câu đó SAI về phạm vi.** Đúng là mẫu hiện có vừa khoang (`captureId` **37**, `componentId` **37**, `positionId` **3**, `surfaceName` **6** trong `varchar(64)`/`varchar(100)`). Nhưng hợp đồng v2.0 **không đặt `.max()` nào** cho ba khoá join, nên nó nhận chuỗi dài 80 và DB mới từ chối bằng `[22001] value too long for type character varying(64)` — lỗi rơi **SAU** cửa hợp đồng.
Câu đúng là **"mẫu hiện có vừa khoang"**, không phải "không có nguy cơ". Đây là **lỗi đo thứ TÁM** của tôi trong phiên và vẫn cùng một họ: đo một mẫu rồi phát biểu cho mọi đầu vào. Xem BG-9.

### Ba dữ kiện Critical do review TOÀN NHÁNH bắt — không review-theo-task nào thấy

**Đ-15 (CRITICAL). Đường NTF bị CẮT giữa hợp đồng v2.0 và công thức yield — 6,55% bo rơi qua khe.**
Hợp đồng v2.0 khai `result` là `["OK","NG"]` ở **cả bốn cấp**; NTF thành cờ `ntf` bool riêng. Nhưng `shared/kpiYield.ts:22` có `FINAL_YIELD_PASS_RESULTS = ["OK","NTF"]` — nó đọc **cột kết quả**, không đọc cờ `ntf`.
Tôi tự đo trên `aoi_management_test`: `OK` **30.385 (72,09%)** · `NG` **9.002 (21,36%)** · `NTF` **2.760 (6,55%)** trên 42.147 bo.
Người review quét **vét cạn 16 tổ hợp** con hợp-lệ-theo-v2.0 qua `rollupVerdict`: tập kết quả cuộn ra chỉ `OK|NG`, **`NTF` không xuất hiện lần nào**. Nghĩa là `coNtf` không bao giờ true trên đường v2.0 ⇒ **nhánh NTF của T1 là mã chết** ở đường này.
Ai cũng tưởng `rollupVerdict` là cây cầu nối `ntf` bool về `overallResult`. **Nó không phải.**
**Hậu quả cụ thể:** ngày Pha 1B cắt sang v2.0, nếu không ai viết ánh xạ `ntf=true ⇒ overallResult='NTF'`, thì 6,55% bo chuyển từ PASS sang NG. Quản lý chất lượng thấy final yield **tụt 6,55 điểm phần trăm qua một đêm**, không lưới nào đỏ, không cảnh báo nào bắn. Enum DB vẫn nhận `NTF` nên DB không phàn nàn — chỉ là **chẳng ai ghi vào nữa**.

**Đ-16 (CRITICAL). `captureRowId`: MỘT tên cột, HAI bảng đích, chỉ MỘT có ràng buộc.**

| Cột | Trỏ tới | Ràng buộc |
|---|---|---|
| `measurement_point_defs.captureRowId` | `product_captures(id)` — cây **CẤU HÌNH** | FK thật `ON DELETE SET NULL` ✔ |
| `measurement_results.captureRowId` | `inspection_captures(id)` — cây **KẾT QUẢ** | **KHÔNG có gì** — chỉ chú thích |

Hai dãy id độc lập và **chồng khoảng**. `measurement_results` nối `measurement_point_defs` qua `pointDefId` — quan hệ có thật, dùng hằng ngày — và **cả hai bảng đều mang một cột tên `captureRowId` kiểu `int4`**. Câu `JOIN … ON r."captureRowId" = d."captureRowId"` trông hoàn toàn tự nhiên và **trả về rác**. Một lỗi ingest ghi nhầm `product_captures.id` vào `measurement_results.captureRowId` **không thể phát hiện**: không FK, cùng kiểu, id chồng khoảng, không lưới nào phát biểu.
Chú thích `0339:86-89` càng làm mờ — nó bàn "FK từ hypertable tới bảng thường… để Pha 1B quyết" mà **không nêu tên bảng đích**, trong khi cả hai ứng viên đều là bảng thường.

**Đ-17 (CRITICAL cho Pha 1B). Phán quyết nới `serialNumber` của TÔI đúng một nửa — nửa còn lại mở lại một lỗ đã đóng.**
Tôi phán ở vòng sửa Task 4: `serialNumber` không phải khoá join ⇒ không được từ chối, nới cho phép rỗng theo tài liệu máy. Tài liệu máy đúng (*"rỗng nếu máy chưa gửi"*). **Nhưng tôi phán mà KHÔNG đọc mã tiêu thụ.**
`machineApiRouters.ts:689-694` giữ `.min(1)` **có chủ đích, có ghi lý do** (doc 51 P0): serial rỗng **không truy vết được**, VÀ được **miễn trừ khỏi khoá idempotency** — tôi tự đo xác nhận: `uq_inspections_machine_serial_time … WHERE (("serialNumber")::text <> ''::text)`. Serial rỗng **thoát hoàn toàn** khoá duy nhất ⇒ nhận nó là **mở lại lỗ đếm trùng**.
Hiện **0/42.147** bo có serial rỗng — vì ingest đang chặn.
⇒ Câu trả lời đúng **không phải** "nhận" hay "từ chối". Nếu Pha 1B muốn nhận bo chưa quét serial thì **phải đồng thời** dựng đường khử trùng khác cho đúng nhóm bo đó. Chưa làm việc ấy thì **không được nới ingest** — dù hợp đồng đã nới.
Đây là lỗi kiểu MỚI của tôi, không cùng họ với bảy lần trước: không phải sai phạm vi phép đo, mà là **phán một thay đổi hợp đồng bằng cách đọc tài liệu NGUỒN mà không đọc mã TIÊU THỤ**.

Thêm: `positionNumber = 0` lọt qua trong khi tài liệu nguồn nói **1-based** — không hỏng join nên **cố ý không từ chối** (§4.5), nhưng là ứng viên **gắn thẻ lệch chuẩn** ở Pha 1B.

---

## 12. Kết quả trả nợ khảo sát (N-1…N-5)

Bốn khảo sát chạy ngày 2026-08-24. N-5 đã ghi ở §3.7. Ba mục còn lại dưới đây, và chúng lật lại nhiều hơn dự kiến.

### 12.1 N-4 — mặt tiếp xúc thật: 224 tuyến Express, không phải 27 tRPC

Đếm thô theo `app.<verb>(` / `router.<verb>(` cho ra con số **sai thiếu** — nó mù bốn hình dạng: lời gọi xuống dòng (toàn bộ `server/api/v1/**`), regex làm đường dẫn (`exportRouter.ts:1245, 1381, 1522`), hằng có tên (`securityHeaders.ts:170`), và biến router đặt tên `r`. Quét đúng cho **224 tuyến** (file không-test). File dày nhất: `server/_core/index.ts` — **89 tuyến**.

Đây đúng là lớp lỗi mà chính repo đã ghi lại ở `server/routers/phamViDocScan.ts:948-955`. Kết luận cũ "27 procedure" của tôi là **đếm nhầm phạm vi**, không phải đếm nhầm số.

**Phát hiện quan trọng nhất: đường ingest thứ hai** — đã đưa vào §4.2b.

**Tuyến GHI/XOÁ hoàn toàn không xác thực** (ngoài phạm vi khối A, nhưng phải báo — có tuyến gọi `fs.rmSync` đệ quy):
- `POST /api/factory-alert/push-update` — `_core/index.ts:1435` — phát lệnh OTA tới **toàn bộ** app Android
- `POST /api/factory-alert/versions/:id/activate` — `:1532` · `/deactivate` — `:1555`
- `DELETE /api/factory-alert/versions/:id` — `:1572` → **`fs.rmSync(versionDir, {recursive:true, force:true})`** `:1594` + `db.delete` `:1597`
- `POST /api/factory-alert/upload` — `:1466` — ai cũng nạp được APK 200 MB (`uploadGuard` chỉ kiểm MIME/kích thước, `uploadValidation.ts:131-144`)
- `POST /api/machine/register` — `:1078` (`publicProcedure`) · `GET /api/machine/config` — `:1091` (chỉ cần `serialNumber`)

### 12.2 N-1 — mâu thuẫn NTF đã tồn tại ở ~15 nơi

**117 file** đọc `product_inspections`/`measurement_results` (đếm theo ký hiệu drizzle chỉ ra 72 — **thiếu 45 file dùng raw SQL**).

Quy ước chuẩn ở `server/utils/kpi.ts:224` (`FINAL_YIELD_PASS_RESULTS = ["OK","NTF"]`), `:316`. Nhưng **~15 nơi tính `ok/total`, tức NTF = FAIL**, mà vẫn gọi kết quả là `yieldRate`:

| Nơi | Vì sao nghiêm trọng |
|---|---|
| `server/functions/cachedStatistics.ts:214`, `:235` | Nằm trong **tầng cache** (TTL 5 phút), phục vụ thẳng dashboard máy, **0 test**. Cùng file dòng `:511` lại tính ĐÚNG — một file, hai công thức |
| `server/services/scheduledReportService.ts:387` vs `:397-399` | Mâu thuẫn **trong một hàm**: dòng corporate đúng `(ok+ntf)/total`, dòng TỔNG sai `ok/total` ⇒ **các dòng không cộng lại bằng dòng tổng**. Đây là báo cáo gửi định kỳ |
| `server/routers/stationAnalysisRouter.ts:583` | Chuỗi số này là đầu vào tính **mean/UCL/LCL/Cpk/Ppk** (`:588-600`) ⇒ NTF làm lệch cả biểu đồ kiểm soát. Truy vấn còn **không SELECT cột ntf** (`:566-569`) nên không sửa tại chỗ được |
| `server/routers/alertRouters.ts:75` | Ngưỡng cảnh báo yield được đánh giá trên công thức sai rồi **bắn cảnh báo** |
| Còn lại | `annotationRouters.ts:197, 244` · `productionSessionRouter.ts:75` · `dataComparisonService.ts:241, 266` · `aiReportGenerator.ts:558` · `pdfTemplateService.ts:452` · `federationRouter.ts:241` · `unsSubscriber.ts:134` · `mqttBulletinService.ts:270` · `stationAnalysisRouter.ts:227` |

**Định nghĩa NTF thứ hai:** `liveStatsRollupService.ts:170` dùng `overallResult='NTF' HOẶC ntfConfirmedAt IS NOT NULL`; mọi nơi khác chỉ dùng `overallResult`. Hôm nay hai định nghĩa cho **cùng kết quả** — nhưng chỉ vì §3.7 Đ-4 đo được `ntfConfirmedAt` = **0/244**. Đó là **may mắn, không phải thiết kế**. Ngay khi có người dùng nút xác nhận NTF, `daily_statistics` sẽ lệch với mọi nơi khác — và `daily_statistics` là nguồn của `alertRouters`, `productionSessionRouter`, `oeeService`, `aiSmartAlertRouter`.

**Chỉ ~7 khẳng định trên toàn repo** sẽ đỏ nếu đổi công thức yield (`kpi.test.ts:48, 56, 172, 177-179, 191` · `statistics.kpi.test.ts` · `andonBoard.test.ts:77, 96` · `reportAggregators.db.test.ts:233`). Trên **991 file test**. Thân SQL của MV `0174:57-60` và của `hourly_yield_cagg` **không có phép đo nào chạy qua**.

**Hệ quả cho khối A — phải xử lý TRƯỚC, không phải sau:** thêm 3 bảng con rồi mới sửa mâu thuẫn thì mọi lệch số sẽ bị quy oan cho đợt nâng cấp, và không ai phân biệt được cái nào là nợ cũ.

**Hai ràng buộc hạ tầng mới biết:**
- **Cả hai bảng đã BẬT nén columnstore**, policy 30 ngày (`drizzle/0271_timescale_hardening.sql:159-165` cho `measurement_results` segmentby `pointDefId`; `:174-186` cho `product_inspections` segmentby `machineId`). `ADD COLUMN` nullable-không-default thường được, nhưng `NOT NULL DEFAULT` có thể đòi giải nén chunk. **Phải thử trên bản sao trước.** Thuận lợi: đã có **11 lần** `ADD COLUMN` trên hai bảng này (gần nhất `0281`), nên thao tác không lạ.
- **Mồ côi không phải lo xa — nó đã xảy ra:** `server/db/statistics.ts:242-245` ghi **383/588 kết quả NG/NTF mồ côi** trên `aoi_management` (đo 2026-08-17), và mồ côi từng làm **rò 383 NG** cho tài khoản không gán nhà máy. Đây là bằng chứng ủng hộ §3.6 (dọn thật) và là đối số mạnh cho CH-1 chọn bảng thường có FK.
- `hourly_yield_cagg` có **0 nơi đọc** trong `server/` — dựng sẵn cho cutover, chưa nối. Nên nó **không** nằm trong rủi ro đổi số của đợt này.
- Rất nhiều cờ job đang TẮT: `MATVIEW_REFRESH_ENABLED`, `REPORTING_MART_ENABLED`, `OEE_SNAPSHOT_ENABLED`, `CPK_SNAPSHOT_ENABLED`, `LIVE_STATS_ROLLUP_ENABLED`. Cần biết trạng thái thật trước khi đo "trước/sau".

### 12.3 N-2 — hai màn hiển thị dữ liệu BỊA trông như thật

Không có fallback kiểu `data ?? MOCK` nào trong 15 file đã soi. Nhưng có hai ca nguy hiểm hơn:

**① `ProductionDashboard.tsx:178-233` → render tại `:1268`.** `PcbThumbnail` vẽ một tấm PCB giả bằng PRNG tất định. Nhánh chọn ở `:1258-1268`:
```
{row.latestProductImage ? <img src={…}/> : <PcbThumbnail seed={row.station.id * 31 + 17} />}
```
**Ảnh thật không về ⇒ vẽ bo mạch bịa vào đúng ô đó**, cùng kích thước, cùng bo góc, cùng khung viền. `seed` từ `station.id` nên mỗi trạm luôn ra cùng một hình ⇒ càng ổn định càng giống thật.
**Đây chính xác là kịch bản nguy hiểm của đợt này:** nếu đường `captureExtId` chưa nối xong, màn hình vẫn đầy thumbnail PCB đẹp và không ai biết nó hỏng.

**② `History.tsx:2536-2560` — thẻ "Heatmap NG theo giờ".** Backend chỉ trả NG **theo NGÀY**; UI bịa phân bố **theo GIỜ** bằng `Math.random()` (`:2551`) nhân thêm hệ số "ca làm việc" 8-17h ×1.5 (`:2547-2548`) cho có dáng công nghiệp. Bọc trong IIFE **không `useMemo`** ⇒ **số đổi mỗi lần re-render** — bằng chứng khỏi bàn cãi. Tiêu đề đi qua `t()` đủ 3 locale nên trông y hệt báo cáo chính thức.

**Phải gỡ hoặc gắn nhãn CẢ HAI trước khi đổi backend.** Repo đã có khuôn tốt để bắt chước: `DigitalTwinDashboard.tsx` (`:218, :285, :364, :448, :494`) dùng `isLoading ? Skeleton : rỗng ? "Không có dữ liệu" : dữ liệu thật` — **không có nhánh thứ tư để bịa**; và `TwinHub.tsx:33-79` gắn huy hiệu xuất xứ LIVE/SIM/SƠ ĐỒ cho từng màn.

### 12.4 N-3 — ba lớp bẫy i18n, một lớp chạm thẳng vào đợt này

Chuỗi Việt trần trong 15 file = **0** (đo bằng cổng có sẵn `scripts/viStringScan.mjs`, quét 605 file). Nợ thật là **58 chuỗi tiếng ANH** — trục mà cổng dự án mù theo cấu tạo (regex chỉ nhận chữ CÓ DẤU).

**Lớp 2 là lớp phải đọc trước khi đụng schema điểm đo:** `client/src/components/BulkImportDialog.tsx:139-176`. Hàm `findCol()` khớp header file Excel người dùng với ~28 cột, mỗi cột 2-6 bí danh **trộn Anh và Việt**:
```
positionX: findCol("positionx", "posx", "x", "tọađộx", "toadox")
radius:    findCol("radius", "bánkính", "bankinh")
cropWidth: findCol("cropwidth", "width", "rộng", "rong")
```
Đây đúng là miền `positionX/positionY/radius/cropWidth/cropHeight/shape/measurementType` mà cây `surface→position→capture→component` sẽ đụng vào. **Đổi schema điểm đo mà không cập nhật danh sách bí danh ⇒ import gãy IM LẶNG** — cột không khớp trả `-1`, không ném lỗi. Hàng rào duy nhất hiện có là miễn trừ trong bộ đếm (`viStringScan.mjs:81`), nó ngăn bộ di trú tự động chứ **không ngăn người sửa tay**.

**Lớp 1 — nợ mới tìm ra:** `server/routers/productRouters.ts:361-377` là **bản sao thứ hai** của spec cột sản phẩm, và `grep -c headerKey` = **0** (bản client `ProductModels.tsx:221-231` thì có). Diff 10 giá trị `header` client-vs-server: **khớp 10/10 hiện tại**, nhưng đây là **hai nguồn sự thật cho một hợp đồng dữ liệu, không cổng nào canh**. Sửa một bên là import gãy âm thầm.

**Lớp 3:** `ProductionDashboard.tsx:162-176` phân loại defect bằng `.includes("thiếu"/"lắp"/"lệch"/"lỏng")` trên **dữ liệu từ DB**. Nếu backend mới địa phương hoá tên defect thì phép phân loại gãy im lặng.

**Đừng nhầm — `DataTable` column `header` thì AN TOÀN để dịch:** `DataTable.tsx:59-63` dùng `col.id` làm khoá cho sort/ẩn-hiện/React key, `header` chỉ là nhãn. Phân biệt bằng kiểu: `MasterDataColumn` (có `field`) = **KHOÁ, cấm dịch**; `DataTableColumn` (có `id`) = nhãn, dịch thoải mái.

### 12.5 Xoá dữ liệu lịch sử — ĐÃ GIẢI QUYẾT (QĐ-8)

**QĐ-8 (2026-08-24):** 22.996 bo và 157.369 dòng điểm đo hiện có trên DB dev là **dữ liệu TEST cũ**, không phải lịch sử sản xuất. Xoá chúng **không** vi phạm QĐ-4 — QĐ-4 nói về dữ liệu khi **chạy thật**.

Mâu thuẫn tan, nhưng phải giữ đúng ranh giới sau, vì spec này sẽ có ngày chạy trên production:

| | Được phép | Cấm |
|---|---|---|
| **Dọn DB dev** — thao tác một lần, ngoài migration, chạy tay | ✅ Xoá sạch dữ liệu test để bắt đầu từ nền sạch | |
| **Migration của khối A** | Chỉ thêm bảng/cột. Dọn mồ côi theo §3.6 (hàng **không có cha**) | ❌ **Không có một lệnh nào xoá dữ liệu lịch sử sản xuất.** Migration không được biết khái niệm "dòng không đúng mẫu thì xoá" |

Lý do phải viết ranh giới này ra: một lệnh `DELETE ... WHERE captureRowId IS NULL` nằm trong migration sẽ chạy **đúng như ý** trên DB dev hôm nay, và **xoá sạch lịch sử sản xuất** vào ngày nó chạy ở nhà máy. Cùng một câu lệnh, hai hậu quả ngược nhau — chỉ khác nhau ở nơi nó chạy.

Ba điều kiện còn lại cho thao tác dọn DB dev:
1. Xác nhận đúng là DB dev (`aoi_management` trên 127.0.0.1), không phải DB nào khác.
2. Chạy **đếm-không-xoá** trước, báo con số, rồi mới xoá.
3. Sau khi xoá phải đếm lại và báo cáo, không khai "đã xong".

Ghi chú: cửa sổ dữ liệu 2026-06-28 → 2026-07-19 (§3.7) và `inspection_packages` = 0 dòng đều nhất quán với kết luận "dữ liệu test".
