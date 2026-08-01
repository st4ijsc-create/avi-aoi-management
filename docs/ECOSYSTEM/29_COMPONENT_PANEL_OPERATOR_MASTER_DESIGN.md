# Doc 29 — Thiết kế master data: Component library · Panel/Board multi-up · Operator/Badge · Capabilities validation

**Ngày:** 2026-07-04 · **Tác giả:** agent W3-C (Đợt 3, doc 27) · **Trạng thái:** THIẾT KẾ — chưa triển khai
**Gap xử lý:** doc 27 §2 **M12** (component library + panel multi-up), **M13** (validate `machines.capabilities`), **M14** (operator identity lệch kiểu)
**Đích triển khai:** Đợt 5 (5.1 heatmap theo board-XY/panelIndex cần panel master; 5.2 Pareto theo package cần component library) và Đợt 7 (7.2 correction harvest cần operator identity thống nhất). KHÔNG code ở Đợt 3 — tài liệu này là hợp đồng schema để đợt sau cắt migration.

---

## 0. Nguyên tắc chung (thừa kế các đợt trước)

1. **Additive-only migration:** CREATE TABLE/INDEX IF NOT EXISTS, status là varchar (không pg enum mới), cột mới trên bảng cũ luôn nullable.
2. **Soft-ref + orphan-scan trước, FK sau** — theo đúng lộ trình M1 (Đợt 3 item 3.1): bảng mới tham chiếu bằng id/code, kèm job orphan-scan; FK enforce sau khi sạch.
3. **Không đụng hypertable ngoài kế hoạch:** `product_inspections`/`measurement_results` đã là hypertable (0172). Cột thêm vào hypertable là **metadata-only** (nhanh, không rewrite) nhưng phải nằm trong migration riêng của agent sở hữu đường ingest (Đợt 7), không trộn vào migration master-data.
4. **Tái dùng cái đã có:** `materials` (masterdata.ts) đã có `packageType/mpn/msl/manufacturer` — component library **mở rộng** quanh nó, không dựng bảng linh kiện song song thứ hai; `fiducialMarks`/`productViews` đã có — panel master tham chiếu, không thay thế.

---

## 1. M12a — Component Library (package / footprint / polarity)

### 1.1 Vấn đề (doc 27 §2 M12)

AOI mức linh kiện cần biết **hình thái linh kiện** (package/footprint), **cực tính** (polarity — tombstone/billboard/reversed đều là lỗi theo package), và cần **Pareto lỗi theo package** (BGA vs 0201 vs SOT-23 có hồ sơ lỗi khác hẳn nhau). Hiện trạng: `materials.packageType` chỉ là varchar tự do ("0402", "QFN-48"), không có master về thân/chân/polarity; `bomLineItems.componentCode` + `refDesignator` là text tự do; defect Pareto hiện chỉ theo `defectCatalog`, không cắt được theo package.

### 1.2 Bảng mới

```
-- Package master (chuẩn hoá theo IPC-7351 land-pattern naming khi có thể)
component_packages (
  id            serial PK,
  code          varchar(64)  NOT NULL,            -- vd "0402", "QFN-48-7x7", "SOT-23-3"
  ipcName       varchar(128),                     -- IPC-7351 (vd "RESC1005X40N")
  family        varchar(40)  NOT NULL,            -- CHIP|QFP|QFN|BGA|SOT|SOIC|DPAK|THT|CONN|OTHER
  mountType     varchar(10)  NOT NULL DEFAULT 'SMT',   -- SMT|THT|PRESSFIT
  bodyLengthMm  numeric(10,4), bodyWidthMm numeric(10,4), bodyHeightMm numeric(10,4),
  pinCount      integer,
  pitchMm       numeric(10,4),
  hasPolarity   boolean NOT NULL DEFAULT false,   -- linh kiện có cực tính (diode/tantalum/IC pin-1)
  polarityMark  varchar(40),                      -- dot|notch|band|chamfer|silk_plus|custom
  leadType      varchar(30),                      -- gullwing|j-lead|no-lead|ball|axial|radial
  inspectionNotes text,                           -- gợi ý góc chụp/ánh sáng theo package
  defaultDefects  jsonb,                          -- [defectCatalog.code] hay gặp cho package này
  isActive boolean NOT NULL DEFAULT true, deletedAt timestamp,
  createdAt/updatedAt timestamp NOT NULL DEFAULT now(),
  UNIQUE (code)
)

-- Footprint/land-pattern variant per package (một package có thể nhiều footprint)
component_footprints (
  id          serial PK,
  packageId   integer NOT NULL,                   -- ref component_packages.id
  code        varchar(64) NOT NULL,               -- vd "RESC1005X40N-M" (M/N/L density)
  density     varchar(10),                        -- most|nominal|least (IPC-7351)
  padCount    integer,
  geometry    jsonb,                              -- pads: [{x,y,w,h,shape,angle}] theo mm, gốc = tâm
  courtyardMm jsonb,                              -- {w,h} vùng courtyard
  UNIQUE (packageId, code)
)
```

**Liên kết với cái đã có (không bảng linh kiện mới):**
- `materials` thêm cột nullable `packageId integer` (ref `component_packages.id`) + backfill best-effort bằng match `materials.packageType ≈ component_packages.code` (mirror cách 0134 backfill `materialId` theo code). `materials.code` **vẫn là khóa nghiệp vụ** của linh kiện — `bomLineItems.componentCode`/`feederMaterials.componentCode`/`componentInstallations.componentCode` đã relate theo code này, không đổi.
- `measurement_point_defs` thêm cột nullable `refDesignator varchar(64)` + `componentCode varchar(100)` (điểm đo nào đo linh kiện nào) — đây là mắt xích cho Pareto: `measurement_results → pointDef → componentCode → materials → packageId`. Hai cột này là ALTER TABLE bảng thường (không hypertable) → an toàn.

### 1.3 Pareto lỗi theo package (read path — Đợt 5.2)

Không cần bảng mới: view/cagg
`defect_by_package = measurement_results(defectCatalogId, pointDefId) ⋈ measurement_point_defs(componentCode) ⋈ materials(packageId) ⋈ component_packages(family, code)`
→ tile "Top package theo DPMO" + drill theo refDesignator (khớp 5.1 heatmap). Với sản phẩm chưa gán componentCode cho điểm đo, Pareto rơi về nhóm "(chưa gán)" — hiển thị honest, không giả số.

### 1.4 Ước lượng

| Việc | Cỡ |
|---|---|
| Migration 2 bảng + 3 cột nullable + backfill packageId | 0.5 ngày-agent |
| Seed ~60 package phổ biến (chip 01005→2512, SOT, SOIC, QFP, QFN, BGA, điện giải, connector) | 0.5 |
| CRUD router + trang quản trị (mirror defectCatalog UI đã có) | 1 |
| Gán componentCode/refDesignator vào point editor (ProductModels) + import từ BOM/CAD (cadImportJobs đã có refDes trong candidates) | 1 |
| Pareto view + tile | 0.5 (nằm trong Đợt 5.2) |

---

## 2. M12b — PCB Panel / Board multi-up master

### 2.1 Vấn đề

Máy AOI thực tế chạy **panel** (mảng N-up các board giống nhau); kết quả trả về theo board index trong panel. Hệ hiện chỉ có `productModels` phẳng — không mô tả được panel Nup, offset/rotation từng board → heatmap A5 không quy đổi được tọa độ panel→board, yield theo board-position (lỗi hệ thống ở board #3 do đầu hút #3) không phân tích được.

### 2.2 Bảng mới

```
product_panel_defs (
  id             serial PK,
  productModelId integer NOT NULL,                -- board đơn (đơn vị đang có của hệ)
  code           varchar(60) NOT NULL,            -- vd "PNL-2x4-V1"
  name           varchar(255),
  rows           integer NOT NULL DEFAULT 1,
  cols           integer NOT NULL DEFAULT 1,
  nUp            integer NOT NULL,                -- thường = rows*cols, cho phép lệch (panel khuyết)
  panelWidthMm   numeric(10,3), panelHeightMm numeric(10,3),
  originCorner   varchar(20) DEFAULT 'top_left',  -- gốc tọa độ panel
  serialScheme   varchar(30) DEFAULT 'suffix',    -- suffix|range|barcode_per_board — cách suy serial board từ serial panel
  fiducials      jsonb,                           -- panel-level fiducials [{x,y,type}] (board-level đã có fiducialMarks)
  version        integer NOT NULL DEFAULT 1,
  isActive boolean NOT NULL DEFAULT true, deletedAt timestamp, createdAt/updatedAt,
  UNIQUE (productModelId, code, version)
)

product_panel_boards (
  id           serial PK,
  panelDefId   integer NOT NULL,                  -- ref product_panel_defs.id
  boardIndex   integer NOT NULL,                  -- 1..nUp (khớp index máy trả về)
  offsetXMm    numeric(10,3) NOT NULL,            -- gốc board trong hệ tọa độ panel
  offsetYMm    numeric(10,3) NOT NULL,
  rotationDeg  numeric(6,2) NOT NULL DEFAULT 0,   -- 0|90|180|270 (cho phép lẻ)
  mirrored     boolean NOT NULL DEFAULT false,    -- panel mặt dưới
  skipped      boolean NOT NULL DEFAULT false,    -- X-out board (panel khuyết được đánh dấu bỏ)
  refDesPrefix varchar(20),                       -- vd "B3-" nếu CAD đánh số theo board
  UNIQUE (panelDefId, boardIndex)
)
```

**Quy đổi tọa độ (thuật toán, thuần — service):** `board_xy = R(-rotationDeg) · (panel_xy − offset)`, mirror flip X khi `mirrored` — cùng dạng transform đã dùng ở `productViews.transform`. Heatmap A5 gộp lỗi mọi board về hệ tọa độ board đơn; phân tích theo vị trí panel group-by `boardIndex`.

### 2.3 Gắn vào kết quả inspection — lưu ý hypertable

- Cần `product_inspections.panelDefId integer NULL` + `boardIndex integer NULL` (và `panelSerial varchar NULL` nếu máy chỉ báo serial panel). **`product_inspections` là hypertable (0172)** → `ALTER TABLE ... ADD COLUMN` nullable **không default** là metadata-only trên TimescaleDB (không rewrite chunk) — an toàn, nhưng:
  - phải chạy trong migration của **Đợt 7** (agent sở hữu ingest), sau khi adapter/hot-folder parse được boardIndex từ file máy (ST4I feed spec doc 28 đã có chỗ cho `boardIndex` — kiểm tra lại khi làm);
  - **không** thêm default/backfill trên hypertable (rewrite toàn bộ chunk);
  - ingest cũ không có boardIndex → NULL, mọi query phân tích phải null-safe (`COALESCE(boardIndex, 1)` khi sản phẩm không panel).
- `measurement_results` KHÔNG cần cột — point đã thuộc board đơn; kết quả theo board xác định qua inspection cha.

### 2.4 Ước lượng

| Việc | Cỡ |
|---|---|
| Migration 2 bảng + CRUD router + editor panel (grid preview kéo-thả offset — có thể tái dùng canvas điểm đo) | 1.5 ngày-agent |
| Cột hypertable + ingest parse boardIndex (Đợt 7, agent ingest) | 0.5 |
| Heatmap/board-position analytics (Đợt 5.1, agent analytics) | trong scope 5.1 |

---

## 3. M14 — Operator / Badge master (thống nhất operator identity)

### 3.1 Vấn đề (bằng chứng audit)

Ba kiểu operator identity đang tồn tại song song:
- `product_inspections.operatorId` **varchar(50)** (`inspection.ts:15`) — "mã công nhân" máy gửi lên, tự do, không tra cứu được;
- `operator_assignments.operatorId` **integer → users.id** (`safetyWorkforce.ts:69`);
- `measurement_samples.operatorId` **integer** (`product.ts`) — ngầm hiểu users.id.

Hệ quả: correction/verify của operator (Đợt 7.2 — agreement-rate, training label) không nối được về một con người duy nhất; báo cáo theo ca/người vênh nhau.

### 3.2 Thiết kế: badge master + resolution, KHÔNG rewrite hypertable

```
operator_badges (
  id          serial PK,
  badgeCode   varchar(50) NOT NULL,     -- đúng chuỗi máy gửi trong operatorId varchar
  userId      integer,                  -- ref users.id — NULL khi người chưa có tài khoản
  displayName varchar(255),             -- tên hiển thị khi chưa map user
  source      varchar(20) NOT NULL DEFAULT 'manual',  -- manual|hr_sync|auto_seen
  validFrom   timestamp, validTo timestamp,           -- badge tái cấp cho người khác theo thời gian
  isActive    boolean NOT NULL DEFAULT true,
  createdAt/updatedAt,
  UNIQUE (badgeCode, validFrom)         -- 1 badge có thể đổi chủ theo thời gian; active window check ở service
)
```

**Nguyên tắc hợp nhất:**
1. **`users.id` là identity chuẩn** toàn hệ. Bảng nào đang integer → giữ nguyên.
2. **`product_inspections.operatorId` varchar GIỮ NGUYÊN** (hypertable, ~500k dòng/ngày — đổi kiểu = rewrite, cấm). Nó được tái định nghĩa tường minh thành **badgeCode** — đổi comment cột trong schema + doc.
3. **Resolution tại đọc**: service `resolveOperator(badgeCode, at?)` → `operator_badges` (đúng time-window) → `users.id`; JOIN view `v_inspections_operator` cho analytics. Badge chưa biết → auto-insert `source='auto_seen'`, `userId NULL` → hàng đợi "badge chưa gán người" trên trang quản trị.
4. **Resolution tại ghi (mới)**: đường ingest Đợt 7 stamp thêm `operatorUserId integer NULL` (cột hypertable mới, metadata-only — cùng migration với boardIndex §2.3) khi resolve được; dữ liệu cũ resolve on-read.
5. HR/AD sync (nếu có) đổ vào `operator_badges.source='hr_sync'` — không tự tạo users.

### 3.3 Migration strategy (3 bước, không phá gì)

| Bước | Nội dung | Đợt |
|---|---|---|
| 1 | CREATE `operator_badges` + backfill `SELECT DISTINCT operatorId FROM product_inspections` (auto_seen, userId NULL) + trang gán badge↔user (admin) | Đợt 5 |
| 2 | `resolveOperator` service + analytics đọc qua resolution; đổi các chỗ đang hiển thị operatorId trần sang tên người | Đợt 5 |
| 3 | Cột `operatorUserId` trên hypertable + stamp khi ingest (chung migration Đợt 7 với boardIndex/programReleaseId) | Đợt 7 |

Ước lượng: 1–1.5 ngày-agent (bước 1+2), bước 3 gộp vào migration ingest Đợt 7.

---

## 4. M13 — Validate `machines.capabilities` theo `deviceTypes` descriptor

### 4.1 Vấn đề

`machines.capabilities` là jsonb tự do (`hierarchy.ts:180`) — gõ sai key/kiểu không ai bắt; trong khi `device_types` (equipmentStandards.ts:73) đã có **descriptor đầy đủ**: `attributesSchema` (contract thuộc tính theo cấp, merge ancestors), `supportedCommands`, `supportedStates`, `mappedMachineTypes` (map machineType → typeKey).

### 4.2 Thiết kế (không bảng mới — service + gate mềm)

1. **Resolver:** `machineType → deviceTypes` qua `mappedMachineTypes` (đã có API resolve inheritance trong equipmentStandardsService — tái dùng, không viết lại).
2. **Validator thuần** `validateCapabilities(machineType, capabilities)`: build zod schema động từ `attributesSchema` (name/kind/required/enum values) → trả `{ ok, errors: [{path, expected, got}], unknownKeys }`. Key ngoài contract **không chặn** (vendor extension — đúng triết lý `extensionFields` PRESERVED) nhưng liệt kê ở `unknownKeys`.
3. **Gate MỀM 2 nấc** (giống commissioning-gate Đợt 2.4):
   - Nấc 1 (mặc định): mutation create/update machine chạy validator, lưu kết quả vào cột mới nullable `machines.capabilitiesValidation jsonb` ({checkedAt, deviceTypeKey, ok, errors}) + badge cảnh báo trên UI máy. KHÔNG reject.
   - Nấc 2 (flag `CAPABILITIES_VALIDATION_ENFORCED`, default OFF): reject khi `required` attribute sai kiểu/thiếu.
4. **Orphan-scan bổ sung:** machineType không có deviceType map → báo trong integrity report (ecosystemAdminRouter đã có khung).

### 4.3 Ước lượng

0.5–1 ngày-agent (validator + cột jsonb + badge UI); enforce flag bật sau khi seed deviceTypes phủ đủ 17 machineType. Đích: Đợt 5 (đi cùng sweep polish 5.6) hoặc gộp Đợt 7.6.

---

## 5. Tổng hợp & thứ tự cắt migration đề xuất

| # | Nhóm | Bảng/cột | Đợt | Phụ thuộc |
|---|---|---|---|---|
| 1 | Component library | `component_packages`, `component_footprints`, `materials.packageId`, `measurement_point_defs.componentCode/refDesignator` | 5 | seed package; BOM/CAD import có sẵn |
| 2 | Panel multi-up | `product_panel_defs`, `product_panel_boards` | 5 | — |
| 3 | Operator/badge | `operator_badges` + resolution service | 5 | — |
| 4 | Hypertable add-column gộp MỘT migration | `product_inspections.panelDefId/boardIndex/operatorUserId/programReleaseId` | **7** | ingest adapters parse được; agent ingest sở hữu |
| 5 | Capabilities validation | `machines.capabilitiesValidation` + validator | 5.6/7.6 | deviceTypes seed đủ |

> Ghi chú khớp nối: `programReleaseId` ở mục 4 là seam đã ghi trong header `server/services/inspectionProgramService.ts` (M9, Đợt 3 — đã xây workflow, chờ wiring); gộp cùng một lần ALTER hypertable để chỉ đụng metadata một lần.

**Tổng ước lượng M12+M13+M14:** ~5–6 ngày-agent rải vào Đợt 5 + 1 migration hypertable ở Đợt 7.
