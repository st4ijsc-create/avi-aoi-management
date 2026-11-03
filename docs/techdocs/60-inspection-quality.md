# 60 · Kiểm tra, chất lượng, sản phẩm (inspection‑quality)

| | |
|---|---|
| Mục tiêu phục vụ | M4 thu thập dữ liệu & phân tích chất lượng (trực tiếp); M1 (dữ liệu chủ sản phẩm/điểm đo); M5 (NG/SPC làm nguồn interlock và cảnh báo) |
| Phụ thuộc | 10 hierarchy (site/line), 20 asset (asset AOI/AVI/ICT/FCT, api key, lớp máy), 30 telemetry (cùng khuôn mẫu + WAL), 40 alarm (`raiseEvent` NG/yield/SPC/gate), 50 control (interlock đọc NG‑rate/SPC), 90 platform (lưu trữ tệp, báo cáo, 2FA/SoD) |
| Module phụ thuộc vào đây | 70 engineering (recipe/program theo sản phẩm), 80 ai (thị giác, false‑call, RCA đọc cùng kho), 90 (OEE chất lượng, báo cáo, twin hiện kết quả) |
| Mốc đo | `_ai8_wt b305aa350` (2026-11-03), DB `aoi_management@5434` read-only; doc 27 (2026-07-04, 7 quyết định) và doc 31 (2026-07-05, 6 quyết định) đã duyệt; Khối B/C AOI (09/2026) |
| Trạng thái | **v1.1 — ĐÃ DUYỆT 2026-11-03** (8 câu hỏi §7 duyệt theo khuyến nghị; mig 0550–0569) |

## 0. Phạm vi của module

Module này sở hữu **kết quả kiểm tra và đo lường của sản phẩm**: một pipeline ingest cho mọi nguồn máy (tRPC/REST máy, gói ZIP AOI, hot‑folder, adapter thị giác, acquisition), kho kết quả (header + cây kết quả + ảnh), **một bộ công thức KPI chất lượng** (yield, FPY, NG‑rate, false‑call, DPMO, Cpk), SPC/quy tắc, quality gate, danh mục lỗi, mẫu vàng, sửa kết quả/NTF/disposition, NCR, truy xuất (genealogy); và **dữ liệu chủ sản phẩm**: model, biến thể, cây dạy từ máy (surface → position → capture → điểm đo), giới hạn (Khối C là nguồn sự thật), program release, mapping máy–sản phẩm.

Module này **không** sở hữu: cảnh báo và thông báo (40 — 60 chỉ `raiseEvent`), interlock (50), mô hình thị giác/huấn luyện/false‑call learning (80 — đọc `inspection_item`, ghi `ai_decision` qua cửa 60), OEE (90 — đọc CAGG chất lượng), lưu trữ tệp vật lý và lịch xoá (90 — 60 khai chính sách).

Bất biến: (1) **một header một nguồn sự thật về kết quả** (`inspection.overall_result` là kết luận; cây/AI/sửa tay chỉ sửa qua cửa có audit); (2) **mọi KPI chất lượng dùng một thư viện công thức** (`shared/quality/kpi.ts`), server tính trên toàn khoảng; (3) **mọi NG neo mã lỗi trong danh mục** (không có "NG không phân loại" sau 1 chu kỳ); (4) danh tính tenant **suy từ khoá máy**, không nhận từ payload (01 §6; phát hiện 2026‑08‑18); (5) giới hạn điểm đo chỉ đổi qua `threshold_approval` có SoD (doc 31 OP1/OP2).

---

## 1. Hiện trạng đo được

### 1.1 Dữ liệu `[đo]`

| Chỉ số | Đo được |
|---|---|
| Bảng trong miền (khớp mẫu tên) | **126**, trong đó **87 rỗng** (69 %) |
| `product_inspections` | 13 236 hàng, **100 % tạo ngày 15–16/09/2026** (seed), OK 11 560 / NG 1 676; **`productModelId` NULL 13 236/13 236**, `lineCode` NULL 13 236/13 236, `corporateCode` NULL 6 588; 1 657 máy; 0 hàng/24 h; hypertable theo `inspectionTime`; 56 cột (6 mã tenant chép cứng, 10 cột provenance/drift) |
| `measurement_results` | hypertable; FK `pointDefId` NOT NULL (linh kiện chưa dạy không có chỗ ghi — R‑KB‑2) |
| Cây kết quả `inspection_surfaces/positions/captures` | 0 / 0 / 0 |
| `inspection_packages` | **0 hàng nhưng 18 MB** (index phình); `package_images` 0 |
| `measurement_samples` | **24 phân vùng tháng tới 06/2028, tất cả rỗng**; router `measurementSamples` 0 chỗ gọi |
| `process_results` | 5 932 (ICT 2 946, FCT 2 946, SCREWDRIVE/DISPENSING 20), 06–07/2026, 9 máy; hypertable; `machineId` không FK |
| `genealogy_chain` | 27 913 (57,8 MB), chuỗi băm; `stationCode` text |
| `component_installations` | 7 531 |
| `measurement_point_defs` | 114 hàng, **77 cột** (2D + 3D/GD&T + ROI + cây dạy + biến thể); doc 31: 13/119 có giới hạn, 68 % `__UNMAPPED__` |
| `product_models` | 33; `product_machine_mappings` 8 (FK thật); `product_variants` 4; `inspection_program_releases` 0; `golden_sample_references` 0; `threshold_approvals` 180 |
| `defect_catalog` | 101 (IPC, 3 ngôn ngữ, `aliasOfCode`); `unmatched_defect_codes` 0; doc 27: 0/15 590 NG được phân loại |
| SPC/gate | `spc_rule_violations` 0, `spc_configurations` 0, `cpk_history` 0, `quality_gates` 0, `quality_gate_events` 0, `mp_spc_*` 0, `msa_*` 0, `nonconformance_reports` 0 |
| `fact_inspection_hourly` | 5 100 (mart báo cáo) |
| Thời gian | **mọi cột naive** trừ `process_results.server_received_at` và 3 cột spc |
| FK thật | chỉ 8 (mig 0180): inspections→machines, results→inspection/point_def/defect_catalog, pm_mappings, recipes; còn lại tham chiếu mềm hoặc mã text |
| Ảnh | `uploads/` 938 MB, 167 tệp; khoá `inspections/{id}/{point}-{nanoid}.{ext}`, ZIP `aoi/<corp>/<factory>/.../<id>.zip`; thumbnail sharp on‑the‑fly; retention 365 d sau cờ `DATA_RETENTION_ENABLED` (tắt) |

### 1.2 Backend `[đo]`

| Thành phần | Tệp | LOC | Ghi chú |
|---|---|---|---|
| Ingest máy | `machineApiRouters.ts` | **6 747** | 30 procedure; `processInspectionSubmission` (v1.x điểm đo) và `submitInspectionTreeV2` (cây) là **hai đường khác hành vi**: v2 không ghi `measurement_results` linh kiện, không spec‑gate, không ảnh, không ERP, không NG alert |
| Lưu kết quả | `db/inspection.ts`, `ingestCayKetQua.ts`, `inspectionStoreForward.ts` (WAL đĩa), `deadLetterReader.ts` | 3 487 | WAL riêng (thứ ba bên cạnh 2 WAL của 30); `acquisitionWorker` **không có WAL** (lỗ đã biết chưa vá) |
| Gói AOI ZIP | `aoiPackageRouter.ts` | 2 542 | ghi header thẳng từ `meta.json` trong ZIP máy tải lên (tự khai tenant) |
| Cây dạy | `db/cayDay.ts` | 1 663 | 4 cấp nối **khác kiểu** (tên / mã "P01" / UUID) |
| Sản phẩm | `productRouters.ts` (20 sub‑router) + `db/product.ts` | 4 346 + 4 184 | ~122 procedure; `measurementSamples`, `spcConfig` 0 chỗ gọi |
| SPC/gate | `spcAdvancedRouter.ts`, `spcAnalysisRouter.ts`, `db/spc.ts`, `utils/spc.ts`, `utils/spcRules.ts`, `cpkSnapshotScheduler`, `aiSpcAlertScheduler`, `spcCentralAlertBridge`, `qualityGateEvaluator` (**UPDATE `machines`**) | 4 400 | **Cpk cài 4 lần** (`utils/spc.ts:414`, `spcAdvancedRouter.ts:68`, `spcRules.rollingCapability`, `thresholdSuggestion.cpCpk`); quy tắc Nelson/WE ở 6 tệp |
| KPI | `shared/kpiYield.ts`, `utils/kpi.ts` (canonical) | 450 | **6 chỗ lệch canonical**: `productionDashboardRouter` "FPY" = OK/total (không first‑pass, bỏ NTF) ×3; `stationAnalysisRouter:832`; `dataComparisonService:267`; `federationRouter:266`; `aiSmartAlertRouter.detectYieldDrop`; ingest cảnh báo yield **cứng `< 90`** (`:2636`) không đọc `yield_alert_thresholds` |
| Danh mục lỗi, mẫu vàng, disposition, NCR, genealogy, program release, threshold approval, MSA, panel, component library, onboarding, hot‑folder/commissioning | 14 router/service | ~6 500 | sống; `thresholdApproval` có SoD từ doc 31 wave A `[cần kiểm]` |
| Chết | `inspectionVariantRouter`, `mpVariantSubformRouter`, `thresholdSuggestionRouter`, `measurementSamples`, `spcConfig` | ~520 | 0 client |
| Public API | `publicProductApiRouter.ts` 873, `externalInspectionApi.ts` (đọc) | | chỉ tài liệu API gọi |

Đường vào kết quả (đo): tRPC `machineApi.submitInspection(+Batch)`, REST `/api/machine/submit-inspection`, REST v1 `/api/v1/ingest/inspection` (+ webhook `inspection.committed`), AOI ZIP presign/upload/commit, `visionAdapter.ingest`, hot‑folder, acquisition, `uploadImage`, `submitMachineTemplate/syncMeasurementPoints` (cây dạy), `submitProcessResult(+Batch)` + `/api/v1/ingest/process-result`. **MQTT không ingest kết quả** (chỉ validate/quarantine + phát NG). `/api/external/*` chỉ đọc.

Chuỗi tác dụng phụ trong `processInspectionSubmission` (14 bước): auth → mã tenant **từ input** → model/variant → heartbeat → đơn hàng → commissioning mode → program release → clock‑skew → badge → header → ảnh → điểm đo auto‑provision → mã lỗi → spec‑gate (`POINT_LIMIT_EVAL`/`SPEC_GATE_SNAPSHOT`) → persist → ERP outbox → số lượng đơn → serial trùng → socket NG/dashboard/yield → MQTT NG → NG‑rate → quality gate → WIP → AI gate inline. **SPC không chạy ở ingest** (scheduler).

Cờ (tên): `INSPECTION_STORE_FORWARD_ENABLED`, `INSPECTION_SINGLE_TX_ENABLED`, `POINT_LIMIT_EVAL_ENABLED`, `SPEC_GATE_SNAPSHOT_ENABLED` (bật 2026‑09‑04), `PRODUCT_VARIANT_ENABLED`, `PROCESS_RESULT_INGEST_ENABLED`, `PROCESS_SPEC_GATE_ENABLED`, `AI_INLINE_GATE_ENABLED`, `ERP_OUTBOX_ENABLED`, `INGEST_CLOCK_SKEW_ALERT`, `INGEST_REJECT_LEGACY_MACHINE`, `HOT_FOLDER_INGEST_ENABLED`, `LIVE_ACQUISITION_ENABLED`, `VISION_ADAPTERS_ENABLED`, `AOI_EMBEDDING_ENABLED`, `CPK_SNAPSHOT_ENABLED`, `AI_SPC_ALERT_SWEEP_ENABLED`, `SPC_CENTRAL_ALERT_ENABLED`, `DATA_RETENTION_ENABLED`, `RETENTION_INSPECTION_IMAGES_DAYS`.

### 1.3 Frontend `[đo]`

| Tệp | LOC | Route | Ghi chú |
|---|---|---|---|
| `History.tsx` | 3 314 | `/history` | 10 procedure; **yield tính trong trình duyệt trên mẫu ≤ 100–1 000 hàng**; 4 CSV viết tay + XLSX + jsPDF; nút "Excel" tải **.csv** |
| `InspectionDetail.tsx` | 1 374 | `/inspection/:id` | lightbox riêng; "Yield Rate" = tỷ lệ điểm đo của một bo (khác nghĩa) |
| `AOIPackages.tsx`, `HistoryExportScheduling.tsx`, `RepairStation.tsx` | 3 078 | | |
| `QualityCockpit.tsx` + tab | 411 + ~6 000 | `/quality-cockpit` | **10 tab cấp 1, 27 tab thực render** (spc, pareto, heatmap, gates, annotation, alerts, calibration, msa, ipc, diagnose); 2 "false‑call rate" khác nhau cạnh nhau |
| `SPCAnalysis` 705, `ParetoAnalysis` 551, `QualityGates` 1 086, `RootCauseAnalysis` 653 (gắn 3 nơi) | | redirect → cockpit | |
| **Chết**: `SPCAdvanced` 1 186, `AnnotationStatistics` 600, `AnalyticsSettings` (không route), `TestAnnotationPage`; mồ côi `ImageAnnotation` 756, `ImageComparison` 590, `BatchImageExport` 461, `ProductMachineMappingContent` 667, annotation helpers, `HistoryBatchOperations` | **≈ 5 700** | | |
| `ProductModels.tsx` | 3 128 | `/products` | 41 procedure; cây dạy `TeachTreeTab` + `ComponentLimitsDialog` |
| `ComponentLibrary`, `ProductMachineMapping`, `ProductComparison`, `MeasurementPointHealth`, `ProductWorkspaceHub` (trùng `DataManagementHub`), `ProductChangeoverWizard`, `ProductOnboarding` | ~3 100 | | |
| `GoldenSamplesPage` 580, `DefectCatalogPage` 480, `NonconformanceReports` 529, `QualityGateTemplates` 521, `DefectHeatmapPage` 108 (trùng `ProductDefectHeatmap`) | | | |
| AI thị giác: `AIQualityGatePage` 501, `AdvancedVisionLab` 790, `MaskAnnotation` 329, `AIInspectionAnalytics` 1 015 | | `MOD_AI` | → 80 (đọc kho 60) |

Phát hiện: **11 con số yield/NG khác công thức** trên UI; SPC/Cpk từ 4 nguồn; MSA ở 3 bề mặt; **9 bộ xem ảnh không dùng chung mã** (chỉ `MeasurementPointCanvas` dùng chung); export viết tay từng trang; socket duy nhất `spc:violation`; i18n không namespace.

### 1.4 Kết luận hiện trạng

1. **Khuôn dữ liệu đã dựng tốt nhưng gần như rỗng và không nối**: 87/126 bảng rỗng; 13 236 kết quả seed không có model/line; cây kết quả 0; program release 0; mẫu vàng 0; 0 NG phân loại. "Orphaned maturity" của doc 27 vẫn đúng sau 4 tháng.
2. **Hai hợp đồng ingest (v1.x điểm đo, v2 cây) khác hành vi** ⇒ cùng một bo đi hai đường ra hai kết quả khác nhau (v2 không spec‑gate, không ảnh).
3. **KPI không nhất quán**: 1 thư viện canonical + 6 chỗ lệch server + 11 chỗ client; History tính yield trên mẫu.
4. **Tenant tự khai** vẫn còn ở ingest và AOI ZIP (`meta.json`).
5. **Dư thừa lớn**: 4 Cpk, 6 bộ quy tắc SPC, 9 viewer ảnh, 5 router chết, ≈ 5 700 LOC client chết, 24 phân vùng rỗng, WAL thứ ba.

---

## 2. Mục tiêu: mô hình dữ liệu

### 2.1 Quyết định thiết kế `[QĐ 2026-11-03]`

1. **Một hợp đồng ingest `InspectionV3`** = cây v2 (surface → position → capture → item) **bắt buộc**, v1.x điểm đo chuyển thành cây một cấp (surface `_`, position `_`, capture `_`) ở adapter vào; mọi tác dụng phụ của v1.x (ảnh, spec‑gate, ERP, cảnh báo) áp cho cả hai. v1.x giữ 2 chu kỳ rồi 410.
2. **Hai bảng kết quả**: `inspection` (= `product_inspections` + FK `site_id/line_id/asset_id/product_id/variant_id/program_release_id`, **bỏ 6 mã tenant text**, timestamptz, hypertable giữ) và `inspection_item` (= `measurement_results` + cột đường dẫn `surface_ext/position_ext/capture_ext` + FK `capture_id`), **gộp** `inspection_surfaces/positions/captures` thành `inspection_capture` (một bảng, `kind ∈ {surface, position, capture}` với `parent_id`) để giữ khai báo‑vs‑tổng hợp của Khối B nhưng bớt 2 bảng.
3. **Cây dạy giữ 4 cấp** (`product_surface/position/capture/measurement_point`), nối **bằng id** sau khi resolve ở ingest (ext id giữ làm cột phụ) — đóng lớp lỗi "nối khác kiểu". `measurement_point` 77 cột → cột lõi + `spec_2d jsonb` + `spec_3d jsonb` + `roi jsonb` (schema Zod theo `measurement_type_catalog`), giới hạn vẫn là cột để index/gate (Khối C).
4. **Tenant suy từ khoá máy** ở mọi đường vào; `meta.json` của ZIP chỉ còn giá trị đối chiếu (lệch ⇒ từ chối + `raiseEvent(P3, INGEST_TENANT_MISMATCH)`).
5. **Một WAL** dùng `DurableBuffer` của 30 (cấu hình `inspection`); acquisition/hot‑folder/vision đi qua cùng buffer; `inspection_idempotency_keys` + khoá tự nhiên giữ.
6. **Một thư viện KPI `shared/quality/kpi.ts`** (từ `kpiYield.ts` + `utils/kpi.ts`): `finalYield=(OK+NTF)/total`, `fpy=first‑pass OK/first‑pass total` theo serial, `ngRate=NG/total`, `falseCallRate=NTF/(NG máy gọi)` **một định nghĩa**, `escapeRate`, `dpmo`, `sigma`. Server tính trên toàn khoảng qua CAGG `inspection_1h` (site/line/asset/product; thay `fact_inspection_hourly`); client **không tính KPI**. 6 chỗ lệch sửa; ngưỡng yield đọc `alarm_definition` (40), bỏ `< 90` cứng.
7. **Một thư viện SPC** `shared/quality/spc.ts` (Cpk/Cp/Ppk từ `utils/spc.ts:414`, 8 quy tắc Nelson/WE từ `spcRules.ts`); SPC chạy ở **worker** trên luồng `inspection_item` theo `measurement_point` (cửa sổ cấu hình `spc_configuration`), ghi `spc_violation`; tới ngưỡng ⇒ `raiseEvent(kind=alarm, code=SPC_*)`. `mp_spc_alerts/_rolling`, `measurement_samples` (24 phân vùng) **gỡ**.
8. **Quality gate một bảng** `quality_gate` (+ template) đánh giá ở worker sau ingest; **không UPDATE `machines`**; sự kiện gate = `raiseEvent`. AI gate (80) ghi `inspection.ai_decision/ai_confidence` qua `inspection.setAiDecision` (cửa 60), không bảng riêng `ai_quality_gate_results`.
9. **NG phải có mã lỗi**: `inspection_item.defect_code` FK `defect_catalog`; mã lạ → `unmatched_defect_code` + tự ánh xạ theo `alias_of_code`; KPI "NG chưa phân loại" hiện ở `/chat-luong` tới khi = 0.
10. **Giới hạn chỉ đổi qua `threshold_approval`** (SoD: `decided_by ≠ requested_by`; AI đề xuất không tự duyệt) — gom 4 đường ghi tay (`productRouters`, `measurementPointImport`, `dataRouters`, AI `writeHandlers/measurementPoint`) về `measurementPointLimitGate` (Khối C).
11. **`process_result` giữ riêng** (bước ICT/FCT/torque không phải kiểm tra ảnh) + FK `asset_id`, idempotency giữ, cùng WAL; `genealogy_chain` giữ (băm), thêm `asset_id`.
12. **Ảnh**: khoá `inspection/{site}/{yyyy}/{mm}/{inspection_id}/{item_id}.{ext}`; ZIP gốc giữ 30 d rồi xoá (ảnh đã bóc); retention 12 tháng (doc 27 QĐ2) **mặc định bật** cho `origin=real`, 7 d cho `sim/qa`; thumbnail on‑the‑fly giữ; `/uploads` phải qua uỷ quyền theo `site_id` (hiện chỉ xác thực).
13. **Dữ liệu seed 13 236 kết quả xoá** (không model, không line, một ngày) thay vì backfill; demo dùng simulator sinh `origin=sim` qua chính pipeline V3. `[QĐ 2026-11-03]`

### 2.2 Đặc tả bảng (tóm tắt — chi tiết cột lõi)

#### `inspection` (hypertable theo `inspected_at`, chunk 7 d, nén 30 d, giữ 12 tháng real / 7 d sim)

`id bigint identity, site_id FK, line_id FK, asset_id FK, product_id FK product, variant_id FK, program_release_id FK, serial varchar(120) NOT NULL, panel_serial, board_index, lot_code, production_order_id FK, inspected_at timestamptz, server_received_at timestamptz, ts_source, clock_skew_s, overall_result varchar(3) OK|NG|NTF, original_result OK|NG, ntf_by/ntf_at/ntf_reason/ntf_source, ai_decision/ai_confidence/ai_model_id/ai_at, cycle_time_s, operator_user_id, ingest_mode real|commissioning|sim, contract_version, config_version, config_drift jsonb, summary jsonb {items, ok, ng, ntf}, idempotency_key, origin, created_at`. Unique `(asset_id, serial, inspected_at) where serial<>''`; index `(site_id, inspected_at desc)`, `(product_id, inspected_at desc)`, `(asset_id, inspected_at desc)`, `(serial)`.

#### `inspection_capture`

`id, inspection_id FK, parent_id FK self, kind surface|position|capture, ext_id varchar(64), product_capture_id FK (null nếu chưa dạy), declared_result, rolled_result, ntf_count, image_key, meta jsonb`. Index `(inspection_id, kind)`.

#### `inspection_item` (hypertable theo `inspected_at` chép từ header)

`id, inspection_id FK, inspected_at, capture_id FK, measurement_point_id FK (null nếu chưa dạy — bỏ NOT NULL), component_ext, ref_designator, value numeric, unit, lower_limit, upper_limit, nominal, result OK|NG|NTF, original_result, defect_code FK defect_catalog, defect_bbox jsonb, image_key, spec_eval jsonb {dat|truot|chuaDay|khongGioiHan|tatCong}, corrected_by/at/reason, origin`. Index `(inspection_id)`, `(measurement_point_id, inspected_at desc)`, `(defect_code, inspected_at desc)`.

#### Sản phẩm (đổi tên, thêm FK, timestamptz)

`product` (= product_models; `site_id` null = toàn tập đoàn), `product_variant`, `variant_point_override`, `product_surface/position/capture` (FK theo `asset_id` + `product_id`, composite như mig 0347), `measurement_point` (= measurement_point_defs; FK `product_id`, `asset_id`, `product_capture_id`; cột lõi + `spec_2d/spec_3d/roi jsonb`), `measurement_point_version`, `measurement_type`, `fiducial_mark`, `lighting_profile`, `product_view`, `product_panel/_board`, `asset_product` (= product_machine_mappings), `program_release` (= inspection_program_releases), `machine_template_version`, `component_package/footprint`, `threshold_approval`, `golden_sample` (FK `product_id`, `asset_id` thay productCode/stationCode text), `defect_catalog`, `unmatched_defect_code`, `sampling_plan`, `measurement_instrument`, `instrument_calibration`, `msa_study/_observation`, `product_onboarding_draft`, `cad_import_job/_candidate`.

#### Chất lượng

`spc_configuration`, `spc_violation` (FK `measurement_point_id`, `inspection_item_id`; timestamptz), `cpk_snapshot` (= cpk_history), `quality_gate`, `quality_gate_event` (FK `alarm_event_id`), `quality_gate_template/_assignment`, `defect_disposition`, `measurement_correction`, `nonconformance_report` (FK `inspection_id`, `site_id`), `golden_revalidation_flag`, `lot_disposition`, `process_result` (+ `process_spec_limit`, `process_step_type`, idempotency), `genealogy_chain`, `station_trace`.

CAGG: `inspection_1h` (site, line, asset, product: total, ok, ng, ntf, first_pass_total, first_pass_ok, ng_by_code jsonb top‑20) và `inspection_1d`; `item_point_1h` (measurement_point: n, mean, sd, min, max, ng) nuôi SPC/Cpk.

### 2.3 Bảng gỡ

`inspection_surfaces/positions/captures` (→ `inspection_capture`), `measurement_samples` + 24 phân vùng, `mp_spc_alerts`, `mp_spc_rolling`, `ai_quality_gate_configs/results` (→ `quality_gate` kind=ai + cột trên `inspection`), `fact_inspection_hourly`/`dim_product` (→ CAGG), `defect_heatmap_data` (tính từ `inspection_item.defect_bbox`, không cache bảng), `inspection_idempotency_keys` giữ, `upload_queue_metrics`/`package_activity_logs` (→ `command_attempt`‑style log trong 90 observability), `yield_alert_thresholds/_history` + `mqtt_ng_rate_*` (→ 40 `alarm_definition`), `annotation_*`/`image_annotations`/`defect_segmentations` (→ 80, chỉ nếu 80 dùng), `measurement_point_templates` (0, gỡ), `variant_point_overrides` giữ, `sync_logs` (→ 90).

---

## 3. Mục tiêu: backend

### 3.1 Cấu trúc `server/modules/inspection/`

| Tệp | Vai trò |
|---|---|
| `contract/v3.ts` | Zod `InspectionV3` (header + cây + item + ảnh tham chiếu); `adapters/v1x.ts` (điểm đo → cây một cấp), `adapters/aoiZip.ts` (meta.json + images/), `adapters/vendor/*` (hot‑folder CSV/XML theo vendor), `adapters/vision.ts` |
| `ingest.ts` | `ingestInspection(v3, ctx)` — **đường duy nhất**: auth máy → **tenant từ khoá** → resolve product/variant/release/cây dạy (auto‑provision điểm đo có cờ `chuaDay`) → mã lỗi (alias) → spec‑gate snapshot → một giao dịch (header + capture + item + idempotency) → ảnh (storage 90) → bus `inspection.committed` |
| `sideEffects.ts` | consumer của bus (worker): số lượng đơn hàng (90 MES), WIP, ERP outbox, `raiseEvent` NG/yield/serial trùng/clock‑skew (40), quality gate, SPC, AI gate inline (80 hook), webhook `inspection.committed` |
| `kpi.ts` | đọc CAGG; `shared/quality/kpi.ts` thuần |
| `spc/` | `engine.ts` (worker, cửa sổ theo point), `shared/quality/spc.ts`, `cpkSnapshot.ts` |
| `gate.ts` | quality gate + template |
| `review.ts` | confirmNTF, correctResult, classifyDefect, bulkAck, disposition, NCR — mọi sửa ghi `audit_trail` + `measurement_correction` |
| `product/` | model/variant/cây dạy/điểm đo/limit gate/threshold approval/program release/golden/mapping/onboarding/CAD/package import‑export |
| `images.ts` | khoá ảnh, uỷ quyền theo site, thumbnail, chính sách retention (90 thực thi) |
| `router.ts` | `inspection.*`, `quality.*`, `product.*` |

### 3.2 Procedure (tóm tắt)

| Namespace | Procedure chính | Loại |
|---|---|---|
| `inspection.ingest.*` | `submit`, `submitBatch` (tRPC máy + REST v1 `/ingest/inspection` cùng handler), `package.presign/commit`, `processResult.submit(+Batch)`, `template.submit` (cây dạy), `image.upload` | machine (api key, scope `ingest:write`, ràng buộc máy theo khoá) |
| `inspection.*` | `search` (con trỏ, lọc phạm vi ISA‑95/product/result/defect), `get` (header + cây + item + ảnh + journal), `confirmNtf`, `correctItem`, `classifyDefect`, `bulkAck`, `export` (server CSV/XLSX, một thư viện) | permission(`inspection_view` / `inspection_review`) |
| `quality.kpi.*` | `summary`, `trend`, `byAsset`, `byProduct`, `pareto`, `heatmap` (từ bbox), `falseCall`, `unclassifiedNg` | permission(`quality_view`) — tất cả từ CAGG, không tính client |
| `quality.spc.*` | `config.*`, `chart`, `violations`, `ack`, `cpk.trend` | `quality_view` / `quality_manage` |
| `quality.gate.*` | `list/create/update/approve`, `template.*`, `events` | `quality_manage` |
| `quality.review.*` | `disposition.*`, `ncr.*`, `golden.*`, `msa.*`, `calibration.*` | `quality_review` / `quality_manage` |
| `product.*` | `list/get/create/update/clone/archive`, `variant.*`, `point.*` (**không có `update` giới hạn** — chỉ qua `threshold.request/approve/reject/revert`), `teach.*` (cây dạy đọc + đối chiếu), `release.*` (draft→submit→approve→release, SoD), `mapping.*` (= asset_product), `golden.*`, `catalog.defect.*`, `package.export/import`, `onboarding.*`, `cad.*` | `product_view` / `product_manage` / `threshold_approve` |

Gỡ: `inspectionVariant`, `mpVariantSubform`, `thresholdSuggestion` (→ 80 `aiThresholdAdvisor` nếu còn dùng), `measurementSamples`, `spcConfig` (gộp `quality.spc.config`), `publicProductApi` (→ REST v1 đọc có scope), `defectHeatmap.generate` (tính động), `workstationSpc` (gộp), `qualityGate` trong `spcAdvancedRouter` (gộp).

### 3.3 Luồng sự kiện

`inspection.committed` (bus nội bộ, cùng `DurableBuffer`) → worker: gate → SPC → `raiseEvent` (NG bo P3; NG‑rate vượt định nghĩa `alarm_definition(source=kpi, tag_role=ng_rate)` → 40; yield drop → 40; SPC rule → 40; gate fail → 40 + interlock 50 đọc). Socket: bỏ `inspection:alert`/`spc:violation` riêng — người dùng nhận qua `alerts:stream` (40); màn `/kiem-tra` cập nhật bằng `inspection.committed` qua kênh 1a‑style topic `inspection:{siteId}` **chỉ sau 1a** (trước đó poll 15 s).

### 3.4 Cờ

Giữ: `INSPECTION_STORE_FORWARD_ENABLED` (→ mặc định bật), `SPEC_GATE_SNAPSHOT_ENABLED` (bật), `PROCESS_RESULT_INGEST_ENABLED`, `HOT_FOLDER_INGEST_ENABLED`, `VISION_ADAPTERS_ENABLED`, `DATA_RETENTION_ENABLED` (→ mặc định bật), `AI_INLINE_GATE_ENABLED` (80). Gỡ: `INSPECTION_SINGLE_TX_ENABLED` (luôn một giao dịch), `POINT_LIMIT_EVAL_ENABLED` (luôn), `PRODUCT_VARIANT_ENABLED` (luôn), `CPK_SNAPSHOT_ENABLED`/`AI_SPC_ALERT_SWEEP_ENABLED`/`SPC_CENTRAL_ALERT_ENABLED` (worker luôn chạy), `INGEST_REJECT_LEGACY_MACHINE` (sau 2 chu kỳ v1.x), `AOI_EMBEDDING_ENABLED` (→ 80).

---

## 4. Mục tiêu: frontend

### 4.1 Màn (vùng 3 Sản xuất & Chất lượng + vùng 4 Dữ liệu chủ)

| Màn | Route | Nội dung | Thay |
|---|---|---|---|
| **Kiểm tra** | `/kiem-tra` | bảng ảo hoá (server cursor), bộ lọc phạm vi ISA‑95 / sản phẩm / kết quả / mã lỗi / ca; KPI dải trên từ `quality.kpi.summary` (**không tính client**); gói AOI (tab); export server | `History` (3 314), `AOIPackages`, `HistoryExportScheduling` (→ 90 báo cáo) |
| **Chi tiết kiểm tra** | `/kiem-tra/:id` | `ImageViewer` dùng chung (zoom/pan/overlay bbox/so mẫu vàng), cây capture → item, sửa kết quả/NTF/phân loại (có lý do, audit), disposition/sửa chữa, truy xuất genealogy, liên kết L3 máy | `InspectionDetail`, `RepairStation`, lightbox riêng |
| **Chất lượng** | `/chat-luong` (tab: **KPI · SPC · Pareto & Heatmap · Gate · Mẫu vàng · NCR/RCA · MSA & hiệu chuẩn**) | 7 tab thay 27; mọi số từ `quality.kpi.*`; "NG chưa phân loại" và "điểm chưa dạy" là ô KPI thường trực; RCA/dự đoán (80) nhúng trong NCR/RCA | `QualityCockpit` 27 tab, `SPCAnalysis`, `ParetoAnalysis`, `QualityGates`, `QualityGateTemplates`, `GoldenSamples`, `Nonconformance`, `RootCauseAnalysis`, `DefectHeatmapPage`, `DefectPrediction`, `MeasurementPointHealth`, `FalseCall*` ×2 → 1 |
| **Sản phẩm & điểm đo** | `/san-pham`, `/san-pham/:id` (tab: Tổng quan · Biến thể · Cây dạy & điểm đo · Giới hạn (yêu cầu/duyệt) · Program release · Máy gán · Mẫu vàng · Tài liệu) | `MeasurementPointCanvas` dùng chung; wizard onboarding; import CAD/package | `ProductModels` (3 128), `ProductWorkspaceHub`, `ProductMachineMapping` (+ bản mồ côi), `ProductComparison` (→ tab so sánh), `ComponentLibrary` (→ `/danh-muc`), `ProductOnboarding`, `ProductChangeover` (→ 70) |
| **Danh mục** | `/danh-muc?tab=loi` | defect catalog IPC, alias, ảnh tham chiếu; `unmatched` hàng chờ ánh xạ | `DefectCatalogPage` |

Route cũ → redirect; **gỡ**: `SPCAdvanced`, `AnnotationStatistics`, `AnalyticsSettings`, `TestAnnotationPage`, `ImageAnnotation`, `ImageComparison`, `BatchImageExport`, `AnnotationExportImport/Templates/VersionHistory`, `HistoryBatchOperations`, `ProductMachineMappingContent`. AI thị giác (`AIQualityGate`, `AdvancedVisionLab`, `MaskAnnotation`, `AIInspectionAnalytics`) → 80 quyết (đọc `quality.kpi`, không công thức riêng).

### 4.2 Component dùng chung

`components/inspection/`: `ImageViewer` (một bộ zoom/pan/wheel; lớp `BboxOverlay`, `GoldenDiffOverlay`, `AnnotationLayer` cho 80), `ResultBadge` (OK/NG/NTF — token, không palette thô), `InspectionTree`, `ItemTable`, `CorrectResultDialog` (lý do bắt buộc), `KpiStrip` (từ `quality.kpi.summary`, nhãn FPY/yield đúng định nghĩa), `ExportMenu` (server export, một lib `lib/export.ts` thay 4 CSV tay + jsPDF tay). i18n namespace `kiemTra.*`, `chatLuong.*`, `sanPham.*`.

---

## 5. Di trú từ hiện trạng

Dải migration: **0550–0569** `[QĐ 2026-11-03: duyệt]`. Phụ thuộc: 10‑H2, 20‑A3 (asset/api key), 30‑T3 (DurableBuffer), 40‑AL3 (`raiseEvent`). Mỗi bước: census đầy đủ + `check:tests` + bộ test DB tuần tự; Đ‑28 (mọi số đo kèm `current_database()`).

| Bước | Việc | Nghiệm thu |
|---|---|---|
| **Q0** | Gỡ chết: 5 router, ≈ 5 700 LOC client, `AnalyticsSettings`; sửa 6 công thức lệch server về canonical + nhãn "FPY" client; `History` KPI → server; ngưỡng yield đọc cấu hình; `qualityGateEvaluator` bỏ UPDATE `machines`; `acquisitionWorker` qua WAL | N3, N4; census 0 import chết |
| **Q1** | `shared/quality/{kpi,spc}.ts`; CAGG `inspection_1h/_1d`, `item_point_1h`; `quality.kpi.*` | N3 (so khớp 3 công thức cũ‑mới trên cùng tập; chênh phải giải thích bằng định nghĩa) |
| **Q2** | Hợp đồng V3 + adapter v1.x/ZIP/hot‑folder/vision; `ingestInspection` một đường; tenant từ khoá; `DurableBuffer`; chạy **song song** 1 chu kỳ (v1.x cũ vẫn ghi, V3 ghi bóng, so khớp header/item) | N1, N2, N5 |
| **Q3** | Bảng mới `inspection`/`inspection_capture`/`inspection_item` + đổi tên sản phẩm/chất lượng (view tương thích); **xoá seed 13 236** (Q1 §7); di trú `process_results`, `genealogy`, 33 product, 114 điểm đo, 101 mã lỗi, 180 threshold | đếm khớp; 0 hàng không FK |
| **Q4** | Worker: side‑effects, SPC engine, gate, `raiseEvent`; gỡ scheduler cũ + 8 cờ | N6–N8 |
| **Q5** | UI 4 màn + component dùng chung; redirect; `ImageViewer` một bộ | N9–N11 |
| **Q6** | Gỡ bảng §2.3 + 24 phân vùng; retention bật; `/uploads` uỷ quyền theo site | N12 |

---

## 6. Tiêu chí nghiệm thu module

| # | Tiêu chí | Đo bằng |
|---|---|---|
| N1 | Một đường ghi: grep `persistInspectionAtomic\|createProductInspection\|submitInspectionTreeV2` ngoài `modules/inspection/ingest.ts` = 0; `ghiInspectionWalScan` 0 lỗ | census |
| N2 | Tenant: payload khai `site/line` khác máy của khoá ⇒ từ chối + sự kiện; đột biến "tin input" ⇒ đỏ | vitest |
| N3 | KPI: `grep -E "OK.*/.*total|okCount/" server client` ngoài `shared/quality/kpi.ts` = 0; cùng tập 1 000 bo, yield/FPY/NG từ 3 bề mặt bằng nhau tới 0,01 % | grep + test so khớp |
| N4 | Client không tính KPI: `finalYield(`/`fpyFrom` trong `client/src` = 0 | grep |
| N5 | Cùng một bo qua v1.x adapter và V3 cho header + item + spec_eval **giống nhau** | test hợp đồng |
| N6 | 100 % NG có `defect_code` hoặc nằm trong `unmatched_defect_code` (không NG "trống") | SQL |
| N7 | Giới hạn đổi ngoài `threshold_approval` = 0 đường (đột biến 4 đường cũ) | census + đột biến |
| N8 | SPC/gate chạy ở worker; API tiến trình không import `spc/engine` | grep |
| N9 | Bộ xem ảnh 9 → 1; export tay 0; màu thô trong `components/inspection/` = 0 | grep |
| N10 | Trang: 23 route → 5 (+ redirect) | Playwright |
| N11 | `/kiem-tra` 10 000 hàng cuộn mượt (p95 frame < 16 ms), tìm kiếm server < 300 ms | Playwright + đo |
| N12 | Bảng miền 126 → ≤ 55; phân vùng rỗng 0; retention 12 tháng chạy (job log) | SQL |

---

## 7. Câu hỏi mở — đã trả lời `[QĐ 2026-11-03]`

| # | Câu hỏi | Quyết định | Hệ quả |
|---|---|---|---|
| 1 | Seed 13 236 kết quả + `inspection_packages` phình | **Xoá**; VACUUM FULL; demo sinh lại bằng simulator `origin=sim` qua V3 | Q3; báo trước khi xoá (01 §9‑19); dieu-phoi duyệt SQL |
| 2 | Cây kết quả 3 bảng | **Gộp thành `inspection_capture(kind, parent_id)`** | §2.2 |
| 3 | `measurement_point` 77 cột | **Cột lõi + `spec_2d/spec_3d/roi jsonb`**; giới hạn 2D vẫn là cột | Q3; giữ 3D/GD&T (doc 31 QĐ2) |
| 4 | v1.x điểm đo | **Giữ 2 chu kỳ rồi 410**; `[cần kiểm]` máy thật đang gửi hợp đồng nào — nếu chưa có máy thật, cắt ngay sau Q2 | Q2; ghi Nhật ký khi kiểm xong |
| 5 | Retention 12 tháng | **Mặc định bật** cho `origin=real`; ZIP gốc 30 d; sim/qa 7 d | Q6 |
| 6 | MQTT ingest kết quả | **Không bao giờ**; MQTT chỉ cảnh báo/UNS | §3.3 |
| 7 | Ranh giới 60/80 | **60 sở hữu dữ liệu + KPI; 80 sở hữu màn AI thị giác, không tự tính yield** | §4.1; 80 |
| 8 | Dải migration 0550–0569 | **Đồng ý** | §5 |

---

## 8. Nhật ký

| Ngày | Phiên | Việc | Số đo |
|---|---|---|---|
| 2026-11-03 | chủ dự án + chu-du-an-HST | **Duyệt v1.1**: 8 câu hỏi §7 theo khuyến nghị (xoá seed; gộp cây kết quả; điểm đo jsonb; v1.x 2 chu kỳ; retention 12 tháng bật; MQTT không ingest; ranh giới 60/80; mig 0550–0569) | — |
| 2026-11-03 | chu-du-an-HST | Viết v1 từ kiểm kê read-only `_ai8_wt b305aa350` + DB live; kế thừa doc 27/31 và Khối B/C | 126 bảng (87 rỗng); 13 236 kết quả seed 100 % thiếu model/line; 2 hợp đồng ingest khác hành vi; 1 KPI canonical + 6 lệch server + 11 lệch client; Cpk ×4; 9 viewer ảnh; ≈ 5 700 LOC client chết; 24 phân vùng rỗng |
| 2026-11-04 | tho-ca-agent | **Pha 0 lô A (Q0-1 phần router)**: gỡ `inspectionVariant`, `mpVariantSubform` (+ `utils/mpVariantSubform.ts`), `thresholdSuggestion` khỏi `appRouter` (0 client-caller AST; `utils/thresholdSuggestion` giữ vì `aiThresholdAdvisor`/`aiSetupAdvisor` dùng). Chưa làm: `measurementSamples`, `spcConfig` (router khai trong tệp khác, `spcAlertSink` còn dùng), trang chết, Q0-2…Q0-4 | phamViGhi tổng 1224→1210, nợ 152→151 |
