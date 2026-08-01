# Doc 55 — Audit + Kế hoạch hoàn thiện 3 mục còn lại của doc 51

**Ngày:** 2026-07-17
**Nhánh:** `automation-orchestration-r0`
**Phạm vi:** Audit sâu **chức năng + dữ liệu** + thiết kế hoàn thiện cho **3 mục còn lại** của [doc 51 §12.3](51_AVI_AOI_MACHINE_API_AUDIT_AND_UPGRADE_PLAN_2026-07-13.md):
1. **Product-variant** (biến thể sản phẩm — schema + sync contract)
2. **Fiducial registration** (căn toạ độ server-side bằng affine)
3. **Image single-tx thật** (gộp header + measurement vào 1 physical transaction)

**Trạng thái:** ✅ **THỰC THI XONG BACKEND (2026-07-17)** — 6 commit, tsc 0, test xanh, mọi cờ default-OFF byte-identical.

**§0-bis — Đã thực thi (verify độc lập: tsc heap-8GB + test cả 2 trạng thái cờ + đọc diff):**
| Item | Commit | Verify |
|---|---|---|
| **1. Image single-tx** (PA-A reserve-id, cờ `INSPECTION_SINGLE_TX_ENABLED`) | `52566261` | persistInspectionAtomic; ★measurement-fail → 0 header rỗng; OFF regression 28 unmodified |
| **2. Fiducial P0 lib** (similarity Umeyama, QĐ#6) | `760461db` | 15 test, mutation-proof ép-similarity |
| **2. Fiducial P1 wiring** (`MACHINE_FIDUCIAL_REGISTRATION`) | `1a03d7f4` | Case-0 căn toạ độ; residual-gate 5px fallback; 51 test |
| **3. Variant PV0** (schema+resolver, mig 0286) | `cc2d9c1f` | backfill base-variant; đổi unique index guarded; fan-out bump; 55 test |
| **3. Variant PV1/PV2** (sync+ingest, cờ `PRODUCT_VARIANT_ENABLED`) | `a92e52e4` | variantCode plumbing; 107 test cùng xanh (không regression chéo) |

**§0-ter — Backend deferrals + PV3-UI ĐÃ XONG (2026-07-17, +3 commit):**
| Phần | Commit | Verify |
|---|---|---|
| **spec-gate variant-override + deltaSync tombstone per-variant + MQTT ACL variantCode** | `3202693b` | override patch thắng base khi gate (load 1 lần/board); tombstone theo effective set; topic variant; 152 test |
| **variant CRUD tRPC router** (`variant:` — list/create/update/delete/getEffectivePoints/setOverride/removeOverride) | `ab196d78` | 28 test, RBAC settings_products + settings_measurement_points |
| **PV3-UI** tab Biến thể dưới ProductModels (DataTable + create/edit + effective-points viewer + exclude/override/restore) | `2c611f26` | tsc 0, i18n 55key×3 (0 mismatch), RBAC, 0286-degrade Alert |

**CÒN HOÃN (nhỏ, ghi rõ):** Item 2 Phase P3 runtime defect-bbox (tuỳ chọn, thấp) · UI "thêm điểm riêng cho variant" (cần variant-scoped `measurementPoint.create` — điểm variant-only vẫn render read-only khi có) · snapshot-gate × variant-override dùng patch HIỆN TẠI (measurement_point_versions không track override history — edge case, đã document). Tất cả sau cờ OFF, chưa ảnh hưởng production.

---

### ✅ DOC 55 HOÀN TẤT — 3 mục còn lại của doc 51 §12.3 đã thực thi TRỌN VẸN (backend + UI), 10 commit, mọi cờ default-OFF, tsc 0 + test xanh, verify độc lập.

**§6 — Chốt quyết định (user duyệt):**
- **Chung:** lộ trình cờ 2-bước (default-OFF → ON ở doc sau) ✔ · làm tuần tự ✔.
- **Single-tx:** ① **PA-A** reserve-id ✔ · ② `persistInspectionAtomic` **song song** `createProductInspection` cũ ✔ · ③ ảnh orphan **dựa reaper P3-b2 có sẵn** (KHÔNG reaper riêng) · ④ chấp nhận sequence gap ✔.
- **Fiducial:** ⑤ **Phase A** write-path làm Phase 1 ✔ · ⑥ ⚠️ **ÉP SIMILARITY kể cả ≥3** (bỏ shear/affine — khác đề xuất `auto`) · ⑦ reject+fallback+tag ✔ · ⑧ ngưỡng **5.0px** ✔ · ⑨ similarity ok → thay sạch nhánh resolution-scale ✔.
- **Variant:** ⑩ **fan-out bump** ✔ · ⑪ override = exclude+patch, điểm THÊM = hàng variantId ✔ · ⑫ absent variantCode → **gán base + tag ingestMode** ✔ · ⑬ **deprecate** nhãn cũ (không drop) ✔ · ⑭ variantCode vào MQTT ACL + deltaSync tombstone **Có** (PV2, tách commit).

---

## 0. Phương pháp & mức độ tin cậy

- **Cách làm:** workflow 4 agent (3 audit+thiết-kế/mục + 1 tổng hợp), chỉ **ĐỌC + phân tích + thiết kế** — không sửa code, không migration.
- **Tự kiểm chứng (✔):** tôi đã đọc code xác minh 3 claim load-bearing của các phương án đề xuất:
  - ✔ `product_inspections_id_seq` **tồn tại** (từ mig 0172) → phương án reserve-id cho single-tx khả thi, **0 migration**.
  - ✔ Image key nhúng `inspectionId`: `inspections/${inspectionId}/${pointCode}-${nanoid}.${ext}` ([machineApiRouters.ts:1251](../../server/routers/machineApiRouters.ts#L1251)) → đúng lý do cần reserve-id trước khi upload.
  - ✔ `imageRegistration.solveLinear` ([imageRegistration.ts:205](../../server/services/imageRegistration.ts#L205)) + affine model + confidence-gate **tái dùng được** cho lib fiducial.
- **Ràng buộc thiết kế (tôn trọng quyết định doc 51 §8):** QĐ#1 mọi thay đổi **có kiểm soát** (cờ default-OFF, khi OFF **byte-identical hôm nay**) · QĐ#3 serial trùng nhận-và-gắn-cờ · QĐ#4 multi-site = federation DB-tách-rời.
- **Dữ liệu dev thật (seed nhỏ → migration gần zero-cost):** 4 product_models (0 variant thật), 34 measurement_point_defs, **1** fiducial_mark, 16 measurement_point_versions (**0** stamped `productPointsConfigVersion`), 22.995 product_inspections (0 null-model).

---

## 1. Tóm tắt điều hành

> Cả 3 mục **độc lập về mục tiêu** nhưng **giao thoa ở đúng 2 file**: `machineApiRouters.ts` (sync/ingest) và `inspection.ts` (persist). Cả 3 đều **gate sau cờ default-OFF** → khi OFF là byte-identical hôm nay → **làm tuần tự được, không khoá lẫn nhau.**

| Mục | Độ khó | Migration | Giá trị | Urgency |
|---|:--:|:--:|---|:--:|
| **Image single-tx** (PA-A reserve-id) | **M** | **0** (sequence sẵn có) | ★★★ đóng khe crash header-rỗng — lỗ toàn-vẹn nặng nhất còn lại | Cao |
| **Fiducial registration** (Phase A) | **M** | **0** (Phase A) | ★★ vá CASE #11 (normalizedX/Y ghi sai vị trí) | Trung |
| **Product-variant** (PA2 first-class) | **L** | 2 bảng + 2 cột + **đổi 1 unique index** | ★★ hết bùng nổ productModel; nhưng dev 0 variant thật | Thấp |

**Thứ tự đề xuất: (1) Image single-tx → (2) Fiducial → (3) Product-variant.** Lý do: single-tx dựng **`persistInspectionAtomic`** làm nền → variantId-stamp và fiducial-transform-persist của 2 mục sau **ride** trên hàm atomic đó thay vì retrofit.

---

## 2. Mục 1 — IMAGE SINGLE-TX (đề xuất làm TRƯỚC)

### 2.1 Hiện trạng (audit)
- `createProductInspection` **COMMIT header RỜI** ([inspection.ts](../../server/db/inspection.ts)), rồi measurement rows ghi trong **tx RIÊNG** (machineApiRouters.ts ~654/1203).
- P2 đã thêm **compensation** (`deleteInspectionForCompensation` xoá header rỗng + ledger khi measurement-tx fail) — giảm phần lớn residual.
- **Khe còn lại:** process **CRASH** đúng lúc header-commit..compensation → header rỗng tồn tại → retry short-circuit (P0) vào nó → **board vĩnh viễn 0 measurement**. Benchmark doc 53 §7.2 đã mô tả cơ chế này.
- Chặn single-tx: (a) image key nhúng `inspectionId` nên header phải insert TRƯỚC để lấy id; (b) test P0/P1 mock `createProductInspection` + `getDb().transaction()` là **2 bề mặt riêng**, durability test dựa `createProductInspection` reject-được để mô phỏng DB-down.

### 2.2 Phương án
| PA | Cách làm | Effort | Rủi ro |
|---|---|:--:|---|
| **A — reserve-id (✅ ĐỀ XUẤT)** | `reserveInspectionId()=SELECT nextval('product_inspections_id_seq')` TRƯỚC → dùng id sinh key **y nguyên format** → upload NGOÀI tx → `persistInspectionAtomic(header, measurements)` 1 tx bao trùm claim-ledger + header ON CONFLICT + measurement + promote-NG | **M** | duplicate-trong-tx burn id (sequence gap vô hại) + ảnh orphan phải dọn |
| B — decouple image key (uuid) | Đổi key sang uuid → không cần id trước | M | **soft-break** mọi tooling/log/dashboard parse `inspectionId` từ key |
| C — status flag pending→complete + reaper | Thêm cột status, không phải single-tx thật | M/L | migration + **backfill 22.995 row** + sửa mọi read hot-path lọc status |

### 2.3 Đề xuất: **PA-A** — duy nhất vừa đạt "single physical tx thật" (xoá khe crash) vừa **giữ nguyên** layout `inspections/<id>/...` (0 xáo trộn tooling), semantics dedup KHÔNG đổi. Cờ `INSPECTION_SINGLE_TX_ENABLED` default **OFF**. Giữ `createProductInspection` cũ cho ~20 seed caller (thêm hàm mới, không churn chữ ký).

### 2.4 Kế hoạch (phase) · **0 migration bắt buộc**
- **P1** — `persistInspectionAtomic` + `reserveInspectionId` + cờ (đường ON tách biệt, OFF nguyên trạng). *Exit: unit-test hàm mới (commit nguyên tử; duplicate không ghi measurement; ledger atomic); cờ OFF → `createProductInspection` không đổi.*
- **P2** — rẽ nhánh router theo cờ (reserve-id → key → upload → atomic; bỏ tx measurement rời + compensation khi ON; giữ dọn ảnh orphan). *Exit: test cũ (idempotency+durability, cờ OFF) PASS **không sửa**; test ON-path: kill-process giữa header/measurement → **không còn header rỗng**; exactly-once replay.*
- **P3** — sweep ảnh orphan do crash + metrics + rollout dev→staging→prod (tắt-nhanh). *Exit: chạy ON dưới tải QĐ#7 không hồi quy; sẵn sàng đặt ON làm default ở doc sau.*

> **Trade-off có chủ đích:** đổi "header-rỗng-ĐẮT (mất measurement, đếm sai)" lấy "ảnh-orphan-RẺ (sweepable)". Cả thiết kế cũ lẫn mới đều leak ảnh khi crash — nhưng mới thì **không còn mất measurement**.

---

## 3. Mục 2 — FIDUCIAL REGISTRATION (đề xuất làm THỨ HAI)

### 3.1 Hiện trạng (audit)
- `fiducial_marks` có bảng đầy đủ (positionX/Y, normalizedX/Y, searchWindowW/H, type, templateImage) + `fiducialMarkRouter` CRUD.
- Nhưng fiducial chỉ được **ĐỌC-RA read-only** trong getPoints/deltaSync (P2b đã thêm); `coordinateMode` chỉ echo. **Server KHÔNG dùng fiducial để căn toạ độ.**
- `resolveCoordinates` ([machineApiRouters.ts:2576](../../server/routers/machineApiRouters.ts#L2576)) chỉ **scale theo độ phân giải**, KHÔNG affine. → Nếu app máy dùng gốc toạ độ khác / board đặt lệch mà chưa căn fiducial → `normalizedX/Y` **lưu sai vị trí** (CASE #11 GAP).
- **Tái dùng được:** `imageRegistration.solveLinear` + affine + confidence-gate (đã ✔).

### 3.2 Phương án
| PA | Áp ở đâu | Effort | Rủi ro |
|---|---|:--:|---|
| **A — write-path `syncMeasurementPoints` (✅ ĐỀ XUẤT Phase 1)** | Máy gửi `observedFiducials` khi push điểm → server tính affine → áp cho `positionX/Y` → lưu canonical | M · **0 migration** | hướng transform đặt ngược (gate residual bắt được) |
| B — query getPoints/deltaSync | Ship điểm đã-biến-đổi vào frame máy | M | **Cao** — 1 transform cũ cho mọi board → lệch tích luỹ. **LOẠI** |
| C — runtime `submitInspection` per-board (Phase 2 tuỳ chọn) | Căn defect bbox per-board, persist transform | L | +migration additive; kéo dài đường ingest nóng (chỉ tính khi có observed) |

### 3.3 Đề xuất: **Phase A trước** (đúng chỗ CASE #11 mô tả), **Phase C sau tuỳ chọn**, **loại B**.
- **Toán:** module thuần `server/lib/fiducialRegistration.ts` — **N=2 → similarity 4-DoF** (Umeyama đóng), **N≥3 → affine 6-DoF LSQ** (tái dùng `solveLinear`), `'auto'` mặc định. **GATE:** RMS reprojection > `MAX_RESIDUAL_PX` → **reject + fallback hành-vi-cũ + tag telemetry** (honest degradation).
- Field additive `observedFiducials [{code, observedX, observedY}]` vào `measurementPointSyncSchema`. Khi ≥3 fiducial + affine ok → **thay thế sạch** nhánh resolution-scale (affine bao trùm). Cờ `MACHINE_FIDUCIAL_REGISTRATION` default **OFF**.

### 3.4 Kế hoạch (phase)
- **P0** — lib toán + unit-test (identity/tịnh-tiến/xoay/scale/collinear-reject) **TRƯỚC wiring**. *Exit: test lib xanh; degenerate/insufficient reject sạch.*
- **P1** — wire `syncMeasurementPoints` (cờ OFF mặc định); ghi transform+residual vào `sync_logs.coordTransformations` (**0 migration**). *Exit: cờ OFF byte-identical; cờ ON + observed → điểm căn đúng canonical; gate fail → fallback+tag.*
- **P2** — `.env` + doc hợp đồng (`observedFiducials`) + runbook (chạy telemetry residual TRƯỚC khi tin). *Exit: có số liệu residual để hiệu chỉnh ngưỡng.*
- **P3 (tuỳ chọn = Option C)** — runtime per-board + defect bbox (migration additive `product_inspections` +3 cột nullable + WAL payload). *Exit: defect bbox nhiều board xếp chồng đúng trên ảnh canonical.*

---

## 4. Mục 3 — PRODUCT-VARIANT (đề xuất làm CUỐI)

### 4.1 Hiện trạng (audit)
- Variant hiện **CHỈ LÀ NHÃN**: `product_models.variant varchar(100)` ([product.ts:20](../../drizzle/schema/product.ts#L20)). **Không có bảng** `product_variants`. Mỗi biến thể = 1 product_model **RIÊNG** → nhân bản điểm đo + version tách rời.
- ⚠️ `inspectionVariantRouter` + `mpVariantSubformRouter` **KHÔNG PHẢI** product-variant — chúng là polymorphic subform theo *inspectionType*/*measurementTypeCode* (extraFields). (Đã xác nhận phân biệt.)
- Điểm đo scope **duy nhất** theo `productModelId`; unique `uq_point_defs_product_code = (productModelId, code)`. Sync 6 procedure khoá 100% theo `productModelCode`. `product_inspections` **không có** cột variant.
- **Precedent sẵn có** cho "con của model có version riêng": `product_panel_defs` + `bom_def` (uq `(productModelId, code, version)`).

### 4.2 Phương án
| PA | Cách làm | Effort | Rủi ro |
|---|---|:--:|---|
| PA1 — attribute + point-tagging | `measurement_point_defs.appliesToVariants text[]` | S | **version cross-talk** (CASE #12) + trần năng lực thấp → phải làm lại |
| **PA2 — first-class `product_variants` + inheritance/override (✅ ĐỀ XUẤT)** | Bảng variant (con của model, mỗi model tự-động 1 `isBase`); `measurement_point_defs.variantId` nullable (NULL=chung); `variant_point_overrides` (exclude/override) | **L** | resolver merge là điểm nóng; **đổi unique index** |
| PA3 — copy-on-write per variant | Clone toàn bộ point cho mỗi variant | M | dời chỗ nhân bản, **phản mục tiêu dedup** |

### 4.3 Đề xuất: **PA2** — variant là entity đầy đủ (version/ảnh/fiducial/lifecycle riêng), điểm CHUNG lưu 1 lần (hết nhân bản), theo precedent panel/bom. `Effective(V) = base − excluded + override ∪ variant-added`. 6 sync procedure + submitInspection thêm `variantCode` **OPTIONAL** → absent = isBase = **hành vi hôm nay**. Cờ `PRODUCT_VARIANT_ENABLED` default OFF.

### 4.4 Kế hoạch (phase)
- **PV0** — schema + backfill (chưa đổi hành vi): tạo `product_variants` + `variant_point_overrides`; ADD `measurement_point_defs.variantId` + `product_inspections.variantId` (nullable, **không rewrite** 34 point + 22.995 inspection = base); backfill 1 isBase/model; **đổi unique index → `(productModelId, COALESCE(variantId,0), code)` guarded** (khuôn 0274, ghi `db_feature_status`). *Exit: db:push sạch; reader cũ trả y hệt vì variantId NULL.*
- **PV1** — `resolveEffectivePoints(model, variant)` + đọc sync variant-aware (cờ OFF). *Exit: cờ OFF byte-identical; ON+base trùng kết quả; ON+variant+override trả đúng effective set.*
- **PV2** — ingest variant-aware + version per-variant + spec-gate (0282) bám `(model, variant)`. *Exit: board gửi variantCode chấm theo limit variant, tag STALE đúng variant, không cross-talk.*
- **PV3** — UI CRUD variant + BOM/panel/mapping linkage + cập nhật apidocs; deprecate (không drop) nhãn cũ. *Exit: kỹ sư tạo biến thể chung-bo-khác-stuffing không cần model mới.*

### 4.5 Rủi ro migration DUY NHẤT của cả 3 mục
Đổi `uq_point_defs_product_code` là ràng buộc **THẬT** → phải **guarded** (ghi `db_feature_status='partial'` nếu có trùng, writer dùng ON CONFLICT DO NOTHING → hành vi bất biến). Dev hiện **0 xung đột** → build sạch.

---

## 5. Vấn đề xuyên suốt (cross-cutting)

| Chủ đề | Nội dung |
|---|---|
| **Migration** | single-tx = **0** · fiducial Phase A = **0** (dùng `sync_logs.coordTransformations`) · variant = 2 bảng + 2 cột + **1 đổi unique index** (điểm rủi ro DUY NHẤT, guarded 0274). Dev seed nhỏ → 0 xung đột. |
| **Backward-compat (QĐ#1)** | Cả 3 cờ OFF → **byte-identical hôm nay** (có test đối chiếu). Cột mới **nullable không backfill**. API chỉ **thêm field optional** (`variantCode`, `observedFiducials`) → non-breaking client/vendor cũ. |
| **Test** | Giữ **nguyên** 2 test-suite OFF-path (`machineApiIdempotency` mock `createProductInspection`+tx, `machineApiDurability` mock reject) — **BẮT BUỘC** hàm atomic MỚI tách biệt (không gộp vào `createProductInspection` kẻo hỏng giả định đếm của 2 test cũ). Fiducial: unit-test lib toán thuần TRƯỚC wiring. Variant: test đối chiếu cờ-OFF byte-identical. |
| **Giao thoa code (điều phối thứ tự)** | `measurementPointSyncSchema` bị **CẢ** variant (+`variantCode`) **VÀ** fiducial (+`observedFiducials`) thêm field → làm **tuần tự** tránh conflict. `processInspectionSubmission`/persist bị **cả 3** chạm → **single-tx làm TRƯỚC** dựng `persistInspectionAtomic`, 2 mục sau bổ sung cột vào **cùng tx** thay vì tạo tx mới. |
| **QĐ#3/#4** | Cả 3 tôn trọng nguyên: idempotency `(machineId, serialNumber, inspectionTime)` + ledger 0275 KHÔNG đổi; variant/fiducial per-site DB local → 0 concern cross-site. |

---

## 6. 🔑 Quyết định cần bạn duyệt (trước khi thực thi)

### 6.0 — Chung
- **[Lộ trình cờ]** Cả 3 mục dùng cờ **default-OFF**, bật ON làm default ở doc SAU **sau khi PROVEN** — đồng ý mô hình 2 bước cho `INSPECTION_SINGLE_TX_ENABLED`, `MACHINE_FIDUCIAL_REGISTRATION`, `PRODUCT_VARIANT_ENABLED`?
- **[Thứ tự]** Đồng ý làm **TUẦN TỰ** single-tx → fiducial → variant (không song song), để variantId-stamp + fiducial-transform ride trên `persistInspectionAtomic`?

### 6.1 — Image single-tx
1. Chốt **PA-A** (reserve-id, giữ format key — ĐỀ XUẤT) vs B (uuid) vs C (status flag)? -> 
2. Giữ `createProductInspection` cũ + thêm `persistInspectionAtomic` **SONG SONG** (đề xuất) hay mở rộng thẳng chữ ký (churn ~20 caller)?
3. Ảnh orphan do crash: reaper sweep chuyên biệt hay dựa retention/orphan-scan hiện có (đã có từ P3-b2)?
4. Chấp nhận **sequence gap** (burn reservedId khi duplicate-trong-tx — id không liên tục, vô hại)?

### 6.2 — Fiducial
5. Chốt **Phase A** (write-path, đúng CASE #11) làm Phase 1, C (runtime defect-bbox) tuỳ chọn Phase 2?
6. Mô hình: **2→similarity, ≥3→affine, 'auto'** (đề xuất) hay ép similarity kể cả ≥3 (bỏ shear, ổn định hơn)?
7. Khi fit tệ: **reject+fallback+tag** (đề xuất, thuận QĐ#1) hay reject+trả-lỗi cho máy?
8. Ngưỡng `MACHINE_FIDUCIAL_MAX_RESIDUAL_PX` khởi điểm: đề xuất **5.0px** (tinh chỉnh sau telemetry) — chốt con số?
9. Khi ≥3 fiducial + affine ok: **được thay thế sạch** nhánh resolution-scale không (đề xuất: có)?

### 6.3 — Product-variant
10. Quy ước VERSION base↔variant: **(a) fan-out bump** base + tất-cả-variant trong 1 tx (đề xuất, khớp checkPointsVersion + spec-gate 0282) hay (b) effective = max(base, variant)?
11. Phạm vi override đợt đầu: **exclude + override(limit/geometry)**; điểm THÊM = hàng `variantId` set (đề xuất, không qua override) — chốt để cố định resolver?
12. `product_inspections.variantId` khi máy KHÔNG gửi variantCode nhưng model có nhiều variant: **gán base + tag ingestMode** (đề xuất, đo tỷ lệ chưa-khai-báo) hay để NULL?
13. **Deprecate** (không drop) nhãn cũ `product_models.variant` (đề xuất) — đồng ý?
14. `variantCode` có vào MQTT recipe/topic ACL + deltaSync tombstone (0274) không (đề xuất có ở PV2, tách commit)?

---

## 7. Ước lượng & bước tiếp theo

| Mục | Effort thô | Migration |
|---|---|:--:|
| Image single-tx (PA-A) | ~M (1 tuần-người) | 0 |
| Fiducial (Phase A+P2) | ~M (1-1.5 tuần) | 0 |
| Product-variant (PV0-PV3) | ~L (2.5-3.5 tuần) | 2 bảng + 2 cột + 1 unique index |

Sau khi bạn **review báo cáo này + chốt §6**, tôi sẽ gọi các AI Agent chuyên môn thực thi **tuần tự** (single-tx → fiducial → variant), mỗi mục: build sau cờ default-OFF + test đối chiếu byte-identical + verify LIVE + commit theo convention. **Chưa động code cho tới khi bạn duyệt.**
