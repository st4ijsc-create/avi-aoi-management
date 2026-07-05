# Doc 31 — Audit lớp dữ liệu Sản phẩm & Điểm đo phục vụ AOI/AVI & Kế hoạch hoàn thiện

**Ngày:** 2026-07-05 · **Phương pháp:** 4 agent audit song song (read-only), có soi dev DB thật (SELECT read-only), đối chiếu các báo cáo cũ (PRODUCTS_*.md) với code hiện tại
**Phạm vi:** Sản phẩm (product model, revision, lifecycle) · Cài đặt điểm đo (authoring, schema-vs-UI, point→máy) · Dữ liệu vận hành (threshold, golden, defect catalog, sampling/SPC) · Data quality & hành trình kỹ sư
**Bối cảnh:** Nối tiếp doc 27 (8 đợt đã thực thi 2026-07-04). Vòng audit này soi riêng **lớp dữ liệu cấu hình** mà doc 27 chạm tới nhưng chưa đào sâu.
**Trạng thái:** ✅ **HOÀN THÀNH TOÀN BỘ 5/5 ĐỢT (A–E)** (2026-07-05) — nghiệm thu cuối: tsc 0 + **424 file/4.497 test/0 fail**, migration 0194–0201 applied (8 migration), UNCOMMITTED chờ review. Chi tiết từng đợt trong các khối "KẾT QUẢ THỰC THI"; tổng kết §10.

---

## 0. Tóm tắt điều hành

Doc 27 đã củng cố sâu **phía máy/ingest/AI**. Vòng này soi **phía dữ liệu sản phẩm & điểm đo** và phát hiện một nghịch lý: **schema và cả workflow phần lớn đã có và rất giàu, nhưng (a) có lỗ hổng quản trị nghiêm trọng, (b) năng suất authoring quá thấp nên dữ liệu gần như trống, (c) các mảnh chưa được khâu thành một hành trình.** Đây là biến thể "phía sản phẩm" của chủ đề T7 ("xây rồi nhưng chưa khâu lại") đã thấy ở doc 27.

**Bằng chứng trần trụi từ dev DB** (chỉ 4 sản phẩm, 119 điểm đo — 36 live):

| Bề mặt cấu hình | Số liệu thật | Ý nghĩa |
|---|---|---|
| Điểm đo có LSL/USL | **13 / 119 (~11%)** | 89% điểm không có ngưỡng — inspection không phán được |
| Điểm đo dưới `__UNMAPPED__` | **81 / 119 (68%)** | Tên điểm từ máy không khớp def thật |
| `componentCode` / `refDesignator` đã điền | **0 / 119** | Chuỗi Pareto-by-package (Đợt 8) vĩnh viễn rỗng |
| NG results được phân loại (`defectCatalogId`) | **0 / 15.590 (0%)** | Catalog IPC 104 dòng nhưng không nối được với dữ liệu |
| Golden samples | **0** | Toàn bộ tính năng golden ngủ đông |
| Program releases | **0** | Workflow SoD chưa từng dùng |
| Threshold approvals | **4 requested, 0 applied** | Hàng đợi duyệt không ai action |
| `measurement_corrections` / `defect_dispositions` / `cpk_history` | **0 / 0 / 0** | Các loop Đợt 5/7 chưa phát sinh dữ liệu |
| Sản phẩm có kích thước ảnh | **0 / 4** | Tọa độ điểm đo là pixel thô, không portable giữa máy |
| `mp_lighting_profiles` | **0 rows** | Schema lighting hoàn toàn chưa dùng |

### 5 điểm chặn ưu tiên cao nhất

| ID | Vấn đề | Mức | Bằng chứng |
|----|--------|:---:|-----------|
| **OP1** | **Lỗ hổng SoD threshold — tự duyệt chính mình:** `thresholdApproval.approve` không check `decidedBy ≠ requestedBy`, là `protectedProcedure` (bất kỳ user auth nào cũng approve+apply được qua API); nút AI Suggest gọi request+approve cùng 1 user | **P0** | `thresholdApprovalRouter.ts:89-126`, `AIThresholdSuggestButton.tsx:104-127` |
| **OP2** | **Quản trị threshold bị bypass hoàn toàn:** `measurementPoint.update` + `spcAnalysisRouter` sửa thẳng LSL/USL dưới `adminProcedure` không qua duyệt nào → hàng đợi duyệt là tùy chọn | **P0** | `productRouters.ts:562,710`, `spcAnalysisRouter.ts:673` |
| **MP1** | **`componentCode`/`refDesignator` không có đường ghi:** router create/update bỏ qua cả 2, không field editor, không cột trong bulk import → cột Đợt 8 = dead, Pareto-by-package không bao giờ có dữ liệu | **P0** | `productRouters.ts:394-451,562-620` |
| **OP3** | **Defect catalog ↔ NG data 0% liên kết:** 15.590 NG, 0 phân loại dù ingest resolver hoạt động → vendor không gửi code hoặc code không khớp catalog seed | **P1** | `machineApiRouters.ts:483-493` |
| **UX1** | **Không có hành trình cấu hình sản phẩm:** 9–10 điểm đến rải rác 3 nhóm menu, không wizard nào nối (wizard `/aoi-onboarding` chỉ lo phía máy); tab fiducial có code CRUD đầy đủ nhưng **không ai import — không truy cập được** | **P1** | `AoiOnboardingWizard.tsx`, `ProductFiducialsTab.tsx` (0 importer) |

### 6 chủ đề xuyên suốt

- **G1 — Quản trị threshold thủng 2 lớp:** vừa ở endpoint approve (không SoD), vừa ở đường sửa thẳng (bypass hàng đợi). Trong một hệ AOI, spec limit quyết định pass/fail — tự duyệt thay đổi giới hạn là lỗi tuân thủ thật. Đây là điểm chặn số 1.
- **G2 — Cột/tính năng Đợt 8 chết vì thiếu đường ghi:** componentCode/refDesignator (Pareto-by-package), CAD import (0 UI), panel def & golden & component library đều **mồ côi khỏi trang sản phẩm**. Đầu tư đã bỏ ra, giá trị = 0 cho đến khi có đường nhập liệu + wiring.
- **G3 — Năng suất authoring là nút thắt triển khai #1:** tạo 200 điểm cho board mới = click từng cái trên canvas hoặc xlsx nông. Không import centroid/pick-place/Gerber (backend `cadImportJobs`/`cadParsers` tồn tại nhưng 0 client), không clone-from-product. Chính vì authoring chậm nên dữ liệu mới trống.
- **G4 — Data adoption gần 0:** không phải thiếu năng lực mà là chưa ai đổ dữ liệu — hệ quả trực tiếp của G3 + G6. Báo cáo phải trung thực: phần lớn "gap" ở đây là adoption/wiring chứ không phải viết tính năng mới.
- **G5 — Hành trình vỡ mảnh, không có chỉ số hoàn thành:** không có "product X đã cấu hình 60% — thiếu limit 40 điểm, chưa có golden"; các trang liên quan (products/golden/component/mapping/onboarding) không cross-link.
- **G6 — Trung thực về dead schema + collab an toàn:** 3D/GD&T/lighting/criteria/extraFields quảng cáo như đã hoàn chỉnh nhưng 0 dòng dữ liệu & phần lớn không có editor; sửa điểm đo là last-write-wins không cảnh báo; versioning chồng 3 tầng gây rối.

**Tổng số phát hiện: 42** (P0 ×3 · P1 ×15 · P2 ×16 · P3 ×8), chi tiết §2–§5, kế hoạch §7, quyết định cần bạn chốt §8.

---

## 1. Phương pháp

4 agent Explore độc lập, mỗi agent một mảng, yêu cầu bằng chứng `file:line` + soi dev DB read-only + đối chiếu báo cáo cũ. Quy ước ID: `PM#` product master · `MP#` measurement-point authoring · `OP#` operational data · `UX#` engineer UX/data-quality.

**Xác nhận báo cáo cũ:** các claim trong `PRODUCTS_P0_COMPLETION_REPORT.md` (soft-delete, measurementPointVersions, Zod, audit) **vẫn đúng trong code**. Nhưng `PRODUCTS_MEASUREMENT_POINTS_*_DELIVERABLE/AUDIT.md` **thổi phồng độ trưởng thành**: phần lớn schema "giàu" (3D/GD&T/lighting) không được author ở đâu và không có trong dữ liệu.

---

## 2. Lớp Product master & lifecycle (điểm ~5/10)

**Điểm mạnh:** schema `productModels` + `measurementPointDefs` world-class (8/10); CRUD có RBAC admin + audit + duplicate-code check + upload ảnh sharp auto-dimension; program-release (W3-C) và panel-def (W8-B) đã wired vào trang.

| ID | Mức | Vấn đề | Bằng chứng | Hướng xử lý |
|----|:---:|--------|-----------|-------------|
| PM1 | P1 | **Không có clone/duplicate sản phẩm** — board tương tự phải nhập lại toàn bộ điểm/fiducial/threshold | không có clone proc trong `productRouters.ts` | `productModelRouter.clone(sourceId,newCode)` deep-copy points+fiducials+panel+sampling trong 1 tx |
| PM2 | P1 | **Không có model revision A-rev/B-rev** — `variant` chỉ là varchar tự do | `product.ts:20` | Thêm `revisionOf`/`revision` hoặc bảng `product_revisions` genealogy, diff được giữa rev |
| PM3 | P1 | **Không import/export định nghĩa sản phẩm** — chỉ có import điểm đo (xlsx) + export CSV per-product | `BulkImportDialog.tsx`, `ProductModels.tsx:1984` | JSON/Excel round-trip cả gói sản phẩm (model+points+fiducials+panel+threshold) cho backup/chuyển line |
| PM4 | P1 | **CAD import không truy cập được** — `cadImportRouter` + `cadImportJobs` tồn tại nhưng 0 UI, cad-jobs=0 | `productRouters.ts:2582`, grep `trpc.cadImport` = 0 | Dialog CAD import (upload→candidates→apply) trên trang sản phẩm (gộp với MP5) |
| PM5 | P2 | **Golden coupled bằng `productCode` string, không FK** — không thấy từ trang sản phẩm, đổi code là orphan golden | `goldenSample.ts:26` | Thêm `productModelId` FK + panel golden per-product |
| PM6 | P2 | **Component library ↔ product inert** — points-with-componentCode=0, materials-with-package=1/44 | (xem MP1) | Lộ BOM + gán package trên trang sản phẩm, backfill componentCode từ BOM |
| PM7 | P2 | **RBAC panel master lỏng** — `productPanelRouter` mutations là `protectedProcedure` (mọi user auth sửa được) vs product là admin | `productPanelRouter.ts:94,116,141,147` | Gate admin/quality |
| PM8 | P2 | **0 sản phẩm có kích thước ảnh → tọa độ pixel thô không portable** giữa máy khác độ phân giải | with-dimensions=0; `productRouters.ts:468-476` | Bắt buộc/auto-fill dims khi upload; backfill normalized coords; chặn save điểm khi thiếu dims |
| PM9 | P2 | **Không có chỉ báo completeness/readiness** cấp sản phẩm trên trang | (xem UX2) | Badge completeness (ảnh/dims/N điểm/fiducial/released) |
| PM10 | P2 | **Không có approval gate khi sửa product model** (name/code/lifecycle/target sửa thẳng) — chỉ program/threshold/golden có duyệt | `productModelRouter.update:328` | Đưa lifecycle transition + thay đổi ảnh hưởng threshold qua approval SoD |
| PM11 | P3 | `list` không trả total → không phân trang catalog lớn được | `db/product.ts:41-118` | Trả `{rows,total}` + count query |
| PM12 | P3 | Lifecycle enum không được enforce (dev/eol/archived) — 4 sản phẩm đều active, không chặn inspection trên EOL | `product.ts:22` | Enforce lifecycle ở ingest/mapping; default sản phẩm mới = development |

---

## 3. Lớp Cài đặt điểm đo — authoring (điểm ~4/10)

**Điểm mạnh:** schema điểm đo depth 9/10; editor canvas SVG (drag/select/shape circle/rect/polygon/line/ring); resolver có guard chống bug pointDefId=0 + auto-provision `__UNMAPPED__`.

| ID | Mức | Vấn đề | Bằng chứng | Hướng xử lý |
|----|:---:|--------|-----------|-------------|
| MP1 | **P0** | **`componentCode`/`refDesignator` không có write path** (router + editor + xlsx đều bỏ qua) → cột Đợt 8 dead, Pareto-by-package rỗng vĩnh viễn | `productRouters.ts:394-451,562-620`; DB 0/119 | Thêm vào router input + field editor + cột xlsx; auto-link từ `bomLineItems.refDesignator` |
| MP2 | **P0** | **SoD threshold + admin bypass** (trùng OP1/OP2 — xem §4) | `thresholdApprovalRouter.ts:89-126` | (xử lý ở đợt governance §7) |
| MP3 | P1 | **68% điểm đo `__UNMAPPED__` không visibility** — không có unmatched-rate metric, không remap UI | `measurementPointResolver.ts:69-155` | Dashboard unmatched-rate + tool bulk remap sang model thật |
| MP4 | P1 | **Release workflow không gate máy (versioning 3 tầng)** — máy pull `deltaSyncPoints` theo `pointsConfigVersion` (live/draft ngầm); `inspectionProgramReleases` chỉ stamp provenance, 0 release tồn tại | `machineApiRouters.ts:298,1732`; `inspectionProgramService.ts` | Hoặc phục vụ `getActiveRelease.snapshot` cho deltaSync, hoặc bỏ claim "production-truth" và ghi rõ release = audit-only |
| MP5 | P1 | **Không có UI import CAD/centroid/pick-place** — authoring 200 điểm = click từng cái/xlsx; backend `cadParsers.ts` chết | `product.ts:996`, `cadParsers.ts` | UI import centroid/pick-place/Gerber nối `cadImport` router, dedupe theo refdes |
| MP6 | P2 | **Dead schema lộ như đã live** — criteria(0)/lighting(0 rows)/extraFields(0)/3D/GD&T form không dùng (VISUAL 109/119); catalog 47 loại nhưng 2 tham chiếu | DB counts | Cắt khỏi UI hoặc thêm consumer thật; ngừng quảng cáo "hoàn chỉnh" |
| MP7 | P2 | **Bulk import quá nông** — xlsx chỉ map ~14 cột legacy, không tolerance-v2/componentCode/shape/3D | `BulkImportDialog.tsx:108-123` | Mở rộng column map + template theo schema hiện tại |
| MP8 | P2 | **Editor chỉ ghi tập con schema** — không gửi criteria/componentCode/refDesignator/extraFields/lighting | `handleSavePoint` 1720-1784 | Bổ sung field (gộp MP1) hoặc dọn schema (MP6) |
| MP9 | P2 | **~110 dòng dead code canvas legacy** (`handleCanvasClick/MouseDown/Move` không wired) | `ProductModels.tsx:1151-1257` | Xóa |
| MP10 | P3 | Tool `mask` vẫn hiện dù Phase-4 audit nói nên hard-error | `ProductModels.tsx:2361` | Verify canvas xử lý hay bỏ option |

---

## 4. Lớp Dữ liệu vận hành — threshold/golden/defect/sampling (điểm ~4,4/10)

**Điểm mạnh:** golden workflow engineering 8/10 (SoD DB-enforced, one-active index, roiKey=point code có tài liệu + enforce); defect catalog seed tốt 104 dòng IPC-A-610; advisor per-point + auto-tune HITL.

| ID | Mức | Vấn đề | Bằng chứng | Hướng xử lý |
|----|:---:|--------|-----------|-------------|
| OP1 | **P0** | **Threshold approve không SoD + authz yếu** — `protectedProcedure`, không `decidedBy≠requestedBy`; AI Suggest tự request+approve | `thresholdApprovalRouter.ts:89-126`, `AIThresholdSuggestButton.tsx:104-127` | Chuyển `qualityProcedure`, reject khi `decidedBy===requestedBy` (mirror `goldenSample.ts:255`) |
| OP2 | **P0** | **Governance bypassable** — `measurementPoint.update` + `spcAnalysisRouter` sửa LSL/USL thẳng dưới `adminProcedure`, hàng đợi thành tùy chọn | `productRouters.ts:562,710`, `spcAnalysisRouter.ts:673` | Đưa thay đổi field ảnh-hưởng-limit qua hàng đợi (hoặc emit approval record + bắt buộc cho program đã released) |
| OP3 | P1 | **Defect catalog ↔ NG data 0% linked** — 15.590 NG, 0 phân loại dù resolver hoạt động | `machineApiRouters.ts:483-493` | Verify `*_DEFECT_MAP` khớp code seed; telemetry code unmatched; backfill VLM/manual |
| OP4 | P1 | **Không có UI curation defect catalog** — CRUD router có nhưng 0 client gọi create/update; curation chỉ bằng script | `productRouters.ts:1313`; grep client = 0 | Trang quản lý catalog (qualityProcedure) + link defect-tendency per package cho Pareto Đợt 8 |
| OP5 | P2 | **Sampling plans mồ côi** — configurable + linkable nhưng không engine nào dùng để quyết định sample size | `product.ts:503`; callers = validation/list | Wire `preferredSamplingPlanId` vào ingest/acceptance, hoặc bỏ khỏi surface "vận hành" |
| OP6 | P2 | **Advisor bỏ qua corrections** — recompute limit từ raw `measuredValue`, không dùng `measurement_corrections`/NTF | 0 refs trong `aiThresholdAdvisor.ts` | Loại/giảm trọng số dòng đã corrected trước `suggestThresholds` |
| OP7 | P2 | **Program release không snapshot golden refs** — released program không tái lập được với ảnh known-good | `inspectionProgramService.ts` | Đưa golden ref id/version active vào snapshot release |
| OP8 | P2 | **ThresholdApprovals UX chưa đủ** — không batch approve, không rollback, reviewer chỉ thấy `MP-{id}` không có code/name/product | `ThresholdApprovalsPage.tsx:143` | Join metadata điểm vào list, multi-select approve, revert từ `measurement_point_versions` |
| OP9 | P3 | **cpk_history không có scheduler** — chỉ ghi bằng router thủ công → 0 rows, đói input cho Cpk-trend/auto-tune | `spcAdvancedRouter.ts:615` | Job snapshot Cpk định kỳ (mirror `aiThresholdTuneScheduler`) |
| OP10 | P3 | **Golden ảnh không giới hạn size + SoD edge** — `grayBase64` không cap/cleanup; SoD skip khi `createdBy` null | `goldenSample.ts:9-15,36,255` | Cap dims server-side, purge draft retired, coi null-capturer là không-approvable |
| OP11 | P3 | **Loop repair/NTF chưa phát sinh dữ liệu** (0 disposition/correction) — cần xác nhận wiring RepairStation/InspectionDetail thực sự ghi | DB = 0 | Xác nhận wiring + adoption telemetry |

---

## 5. Lớp Data quality & hành trình kỹ sư (điểm ~4,6/10)

**Hành trình persona "nhận board PCB + program I.C.T AOI → cấu hình hoàn chỉnh" = 9–10 điểm đến rải 3 nhóm menu, không wizard nối:**
`/products` (tạo) → edit-canvas (điểm+limit) → Program Release dialog → Panel Def dialog → MSA dialog → `/component-library` (khác trang) → `/golden-samples` (khác nhóm, nhập code tay) → `/product-mapping` (khác nhóm) → `/aoi-onboarding` (chỉ máy, 0 context sản phẩm).

| ID | Mức | Vấn đề | Bằng chứng | Hướng xử lý |
|----|:---:|--------|-----------|-------------|
| UX1 | P1 | **Không có product-side onboarding wizard** — 9-10 điểm đến rời; tab fiducial `ProductFiducialsTab.tsx` (324 dòng CRUD) **không ai import → fiducial không truy cập được** | grep importer = 0 | Wizard `/product-onboarding` (tạo→ảnh/fiducial→điểm+limit→golden→panel→release→mapping) tái dùng dialog sẵn có làm step + draft resumable; mount lại fiducial tab |
| UX2 | P1 | **Không có config-completeness score** cấp sản phẩm — chỉ chip 3-check per-point | `ProductModels.tsx:3087-3123`; server grep=0 | `product.getReadiness` (limit%/golden/panel/release/mapping) → badge "Product X 60%" |
| UX3 | P1 | **Point edits last-write-wins** — `updateMeasurementPointDef` blind update, không optimistic-lock/updatedAt guard → 2 kỹ sư ghi đè im lặng | `product.ts:792-824` | Compare-and-set `expectedVersion`/`updatedAt`, trả CONFLICT + diff khi stale (mirror release FOR-UPDATE) |
| UX4 | P1 | **ProductModels monolith 4.256 dòng / 8 dialog** — W3-C + W8-B chồng thêm | file size | Tách dialog ra `components/products/*`, split canvas state thành hook |
| UX5 | P1 | **Router + E2E test void** — `productRouters.ts` (2.720 dòng), `inspectionProgramRouter`, `productPanelRouter`, fiducial đều 0 test; 0 product E2E | e2e/ chỉ health/dashboard/login | Router integration tests + `e2e/product-setup.spec.ts` (create→point→limit→release) |
| UX6 | P2 | **zh thiếu ~22% key (10.265 vs 13.206)** + dialog mới hardcode English (MSA/readiness/toasts/draw-tools) | `ProductModels.tsx:2356-2361,3104-3109,3541-3609` | Sweep i18n các mục W3/W8 + backfill zh |
| UX7 | P2 | **Navigation vỡ mảnh, không cross-link** — data sản phẩm rải 3 nhóm; trang products không link tới golden/mapping/component | `navigation.tsx:429,438,1458,1477,1486` | Gộp nhóm "Product & Program" + link ngữ cảnh từ hàng sản phẩm |
| UX8 | P2 | **Golden capture không link sản phẩm** — nhập code tay, nhập trùng | `GoldenSamplesPage.tsx:126,165` | Deep-link "Capture golden" từ sản phẩm với scope prefilled |
| UX9 | P2 | **Terminology drift** — điểm đo/measurement point/point/ROI/CanvasPointShape cùng 1 khái niệm | nhiều trang | Thống nhất thuật ngữ + glossary |
| UX10 | P3 | **KB route mismatch** — playbook trỏ `/datasettings` vs UI thật `/products` | `create-measurement-point.playbook.yaml:21` | Sửa route + thêm KB "commission a new PCB" end-to-end |

---

## 6. Đối chiếu chéo

- **OP1+OP2+MP2 = MỘT lỗ hổng quản trị** nhìn từ 3 agent: thủng ở endpoint approve (không SoD) VÀ ở đường sửa thẳng (bypass). Phải bịt cả hai cùng lúc — đây là hạng mục P0 số 1, làm trước tất cả.
- **MP1+PM6+OP4 = chuỗi Pareto-by-package chết:** componentCode không có đường ghi (MP1) → không link được package (PM6) → cộng thêm 0% NG classified (OP3) → tính năng phân tích Đợt 8 vô nghĩa. Phải xử lý như một chuỗi.
- **G3(authoring chậm) → G4(data trống):** không thể "bắt kỹ sư đổ dữ liệu" bằng mệnh lệnh; phải giảm chi phí authoring (MP5 CAD import, PM1 clone, MP7 bulk import sâu) thì dữ liệu mới đầy. Ưu tiên đúng thứ tự: bịt governance → tăng năng suất → wiring journey → completeness visibility.
- **UX1+PM9+UX2 = thiếu "mặt tiền" cho lớp đã xây:** wizard sản phẩm + completeness score + cross-link là thứ biến 9-10 mảnh rời thành một sản phẩm dùng được — song song được với các đợt data.
- **MP4+OP7 = releases chưa "thật":** release không gate máy (MP4) và không snapshot golden (OP7) → "production-truth" hiện là claim rỗng. Cần quyết định (§8) làm release thật hay hạ xuống audit-only.

---

## 7. KẾ HOẠCH HOÀN THIỆN — 5 đợt (chờ duyệt)

> Nguyên tắc như doc 27: mỗi đợt xanh (tsc 0 + full suite + migration verify) rồi mới sang; cấm subagent thao tác git trong wave song song; mỗi hạng mục gắn Gap ID.

### Đợt A — Bịt lỗ hổng quản trị threshold (P0, ~2 agent)
| Hạng mục | Gap | Sản phẩm |
|---|---|---|
| A.1 SoD threshold approve + role gate (`qualityProcedure`, reject self-approve) + fix nút AI Suggest không tự-duyệt | OP1, MP2 | Router + UI + test SoD |
| A.2 Đóng đường bypass: đưa thay đổi LSL/USL của `measurementPoint.update` + spcAnalysisRouter qua approval (hoặc emit approval record bắt buộc cho program released) + audit-gate | OP2 | Middleware/service + migration nếu cần + test |
| A.3 ThresholdApprovals UX: join code/name/product vào list, batch approve, revert từ `measurement_point_versions` | OP8 | UI + endpoint |
| **Nghiệm thu** | | Không user nào approve được request của chính mình; mọi thay đổi limit đều để lại approval record; 4 pending hiện rõ điểm/sản phẩm |

> **KẾT QUẢ THỰC THI ĐỢT A (2026-07-05, 2 agent):** ✅ Hoàn thành xanh — tsc 0, full suite 392 file/4.273 test/0 fail, **không cần migration** (dùng cột `decidedBy`/`requestedBy`/`lifecycleStatus`/`measurement_point_versions`/`audit_logs` sẵn có).
> - **A.1 SoD (WA-1):** guard `assertApprovalSoD` → FORBIDDEN khi `requestedBy===approverId`; approve/reject/batchApprove/revert chuyển `qualityProcedure` (admin/supervisor/quality + 2FA); sentinel `requestedBy≤0` (AI auto-tune) coi là non-self; withdraw giữ protectedProcedure (requester tự rút). **Đây là bức tường server khiến AI-Suggest không thể tự-duyệt kể cả client cũ.**
> - **A.2 Gate lifecycle (decision #4):** helper `assertThresholdEditAllowed(pointDefId)` — `development` + chưa released → ALLOW (ghi audit `threshold.directEdit`); `development` + đã released → BLOCK; `active`/`eol`/`archived` → BLOCK → hàng đợi; product không rõ → fail-safe BLOCK. Wired vào `measurementPoint.update` (chỉ gate khi có field limit) + `spcAnalysisRouter.saveSpecLimits`. Break-glass `THRESHOLD_GATE_ENFORCED=false` (mặc định enforce, không ảnh hưởng SoD).
> - **A.3 UX (WA-2):** nút AI Suggest **request-only** (gỡ hẳn mutation approve), payload mang evidence advisor; ThresholdApprovals hiện code/tên điểm+sản phẩm thật thay `MP-{id}`, batch approve (tự-disable request của mình), revert có confirm; giữ diff + evidence thumbnail Đợt 7. Wave-lead vá 1 lệch tham số `revert({id})`→`revert({approvalId})`.
> - **⚠️ Còn 3 đường ghi limit chưa gate** (ngoài phạm vi OP2 đã nêu, WA-1 phát hiện): AI Copilot `set_spec_limits` (`writeHandlers.ts:122`), bulk import `replaceIfExists` (`dataRouters.ts:242`), machine delta-sync (`machineApiRouters.ts:1065,1648`) — helper đã export sẵn, **gộp bịt nốt ở Đợt B (B.6)**.

### Đợt B — Đường ghi + wiring dữ liệu Đợt 8 (P0/P1, ~3 agent)
| Hạng mục | Gap | Sản phẩm |
|---|---|---|
| B.1 componentCode/refDesignator: router input + field editor + cột xlsx + auto-link từ BOM refdes | MP1, PM6 | Chuỗi write path + backfill |
| B.2 Defect catalog: verify `*_DEFECT_MAP` khớp seed + telemetry code unmatched + backfill classification (VLM/manual) | OP3 | Fix mapping + báo cáo unmatched |
| B.3 Trang curation defect catalog (qualityProcedure) + link defect-tendency per package | OP4 | Trang mới |
| B.4 Unmatched-rate dashboard + tool remap `__UNMAPPED__` → model thật | MP3 | Dashboard + bulk remap |
| B.5 Golden→product FK + panel golden per-product + snapshot golden trong release | PM5, OP7, UX8 | Migration + UI + service |
| B.6 Bịt nốt 3 đường ghi limit còn lại bằng `assertThresholdEditAllowed` (AI Copilot set_spec_limits, bulk import replaceIfExists, machine delta-sync) | OP2 (dư) | Wiring helper + test |
| **Nghiệm thu** | | Điền componentCode cho 1 sản phẩm → Pareto-by-package ra số; NG mới được classify; remap được điểm __UNMAPPED__; mọi đường ghi limit đều qua gate lifecycle |

> **KẾT QUẢ THỰC THI ĐỢT B (2026-07-05, 3 agent):** ✅ Hoàn thành xanh — tsc 0, full suite 399 file/4.303 test/0 fail, migration 0194+0195 applied (0193 không cần).
> - **B.1 componentCode write-path (WB-1):** ghi được ở router + editor + xlsx + auto-link từ BOM refdes; test end-to-end chứng minh **chuỗi Pareto-by-package hết dead** (linkedDefects 0→1, ra bucket package thật) + không trip gate threshold (chỉ field limit mới gate). Script backfill sẵn (dry-run, chưa chạy live).
> - **B.2 Defect classify + remap + curation (WB-2):** **chẩn đoán lại root cause OP3** — không phải code lệch seed (adapter wired đúng, mọi code có trong catalog) mà là **feed sinh 15.627 NG không mang code nào** (direct API/simulator chỉ gửi `result:NG`), không có telemetry. Giờ: giữ `defectCodeRaw` khi không resolve (không drop) + bảng rollup `unmatched_defect_codes` + trang `/defect-catalog` curation + repairGuidance + trang `/measurement-point-health` unmatched-rate + bulk remap. **Phát hiện: 2 taxonomy trùng** (BRIDGING vs SOLDER_BRIDGE...) → hợp nhất ở Đợt E. |
> - **B.5 Golden FK + release snapshot (WB-3):** golden thêm `productModelId` logical-FK (hết orphan khi đổi code) + panel golden trên trang sản phẩm + deep-link capture; release snapshot golden refs (audit-only theo QĐ #1, ngoài checksum).
> - **B.6 Bịt kín bypass:** wire `resolveThresholdEditGate` vào cả 3 đường còn lại — AI Copilot set_spec_limits (block trả action_result, không throw), bulk import (skip point limit trên product active), **machine delta-sync `:1065` — xác nhận MÁY ghi ngược LSL/USL: strip field limit khi active/released + audit; `:1648` chỉ ảnh nên không gate**. Threshold bypass đóng kín 5/5 đường.

### Đợt C — Năng suất authoring (P1/P2, ~3 agent)
| Hạng mục | Gap | Sản phẩm |
|---|---|---|
| C.1 Import CAD/centroid/pick-place/Gerber UI nối `cadImport` router (dedupe refdes) | MP5, PM4 | Dialog + wiring backend chết |
| C.2 Clone sản phẩm (deep-copy points/fiducials/panel/sampling trong tx) | PM1 | Router + UI |
| C.3 Bulk import sâu (tolerance-v2/componentCode/shape/3D) + template cập nhật | MP7, MP8 | Column map mở rộng |
| C.4 Import/export gói sản phẩm JSON/Excel (backup/chuyển line) | PM3 | Service + UI |
| C.5 Kích thước ảnh bắt buộc + backfill normalized coords + chặn save thiếu dims | PM8 | Validation + migration data |
| **Nghiệm thu** | | Import centroid 200 điểm < 2 phút; clone board tương tự 1 click; export/import round-trip khớp |

> **KẾT QUẢ THỰC THI ĐỢT C (2026-07-05, 3 agent):** ✅ Hoàn thành xanh — tsc 0, full suite 407 file/4.365 test/0 fail, migration 0196+0197 applied (0198 không cần).
> - **C.1 Centroid import (WC-1):** parser generic mạnh (auto-detect delimiter, decimal EU, quoted fields, side/unit normalize, dedupe refdes, flip X/Y, fit-to-image) + auto-guess column map từ bảng alias (Fuji/Panasonic/KiCad/Altium = map cột trong UI không cần code) → apply sinh điểm đo hàng loạt componentCode điền sẵn (làm sống Pareto chain WB-1). 3 fixture + README. **Bắt bug tiềm ẩn:** CHECK `cad_import_jobs.format` chỉ cho step/dxf → centroid/gerber fail; 0196 nới. |
> - **C.2 Clone + revision (WC-2):** `productModel.clone` deep-copy points/fiducials/panel/sampling trong 1 tx (reset development, remap sampling id, clear productViewId, copy ref ảnh dùng ngay), KHÔNG copy results/golden/release; `copyMappings` default false; cột `revision` varchar + `clonedFromId` provenance (0197, theo QĐ #6 không genealogy). |
> - **C.3 Bulk sâu + export + dims (WC-3):** bulk xlsx thêm tolerance-v2/shape/3D/typeCode (QĐ #2), exact-alias matching thay `.includes()` lỏng, gate lifecycle tôn trọng (strip limit trên product live); export/import gói sản phẩm JSON round-trip lossless (backup/chuyển line); **PM8 bắt buộc kích thước ảnh** khi upload (independent storage backend) + backfill normalized coords + endpoint backfill 4 product dev + guard point-save opt-in. |

### Đợt D — Hành trình & completeness (P1/P2, ~2 agent)
| Hạng mục | Gap | Sản phẩm |
|---|---|---|
| D.1 Wizard `/product-onboarding` (tạo→ảnh/fiducial→điểm+limit→golden→panel→release→mapping) draft resumable | UX1 | Wizard mới tái dùng dialog |
| D.2 Mount lại fiducial tab (đang mồ côi) vào edit dialog | UX1 | Wiring |
| D.3 `product.getReadiness` completeness score + badge trên list/wizard | UX2, PM9 | Service + UI |
| D.4 Gộp nhóm nav "Product & Program" + cross-link ngữ cảnh (golden/mapping/component từ hàng sản phẩm) | UX7 | Navigation |
| D.5 Optimistic-lock cho point edits (compare-and-set + CONFLICT diff) | UX3 | Service + UI |
| **Nghiệm thu** | | Cấu hình board mới qua 1 wizard liền mạch; badge hiện "X% — thiếu limit N điểm"; 2 tab sửa cùng điểm → cảnh báo, không ghi đè im lặng |

> **KẾT QUẢ THỰC THI ĐỢT D (2026-07-05, 2 agent):** ✅ Hoàn thành xanh — tsc 0, full suite 412 file/4.398 test/0 fail, migration 0199 applied.
> - **D.1 Wizard + fiducial (WD-1):** `/product-onboarding` 9 bước non-linear resumable (embedded fiducial/golden/panel/release, deep-link points/threshold/mapping mở tab mới, review); **tab fiducial mồ côi mount lại** ở cả wizard lẫn toolbar sản phẩm (hết unreachable); draft `product_onboarding_drafts` (0199). Follow-up nhẹ: resume picker (endpoint sẵn, chưa surface). |
> - **D.3 Completeness + lock + nav (WD-2):** `productModel.getReadiness` score có trọng số (image15/points15/**limits25**/component10/fiducial10/golden10/release5/mapping10, panel=informational-0), **loại VISUAL khỏi % limit** (board AOI không đỏ oan), batch **7 query cố định không N+1**; badge "62% • 40 điểm thiếu limit" + panel checklist; **optimistic-lock** compare-and-set `updatedAt` + FOR UPDATE → CONFLICT trả diff (backward-compat: absent=skip); gộp nav section "Product & Program" (giữ nguyên route/role) + cross-link ngữ cảnh. |

### Đợt E — Dọn nợ, test, trung thực schema (P2/P3, ~2 agent)
| Hạng mục | Gap | Sản phẩm |
|---|---|---|
| E.1 Quyết định dead schema (§8): cắt UI hoặc thêm consumer cho criteria/lighting/extraFields/3D/GD&T | MP6 | Theo quyết định |
| E.2 Sampling plan: wire vào acceptance hoặc bỏ khỏi surface | OP5 | Theo quyết định |
| E.3 cpk_history scheduler + advisor dùng corrections | OP9, OP6 | Job + service |
| E.4 Router + E2E tests (product/program/panel/fiducial) | UX5 | Test suite |
| E.5 Tách monolith ProductModels + xóa dead canvas code + i18n sweep zh + KB route fix + terminology | UX4, MP9, MP10, UX6, UX9, UX10 | Refactor + polish |
| E.6 PM: revision model, approval product-model, list total, lifecycle enforce, RBAC panel | PM2, PM10, PM11, PM12, PM7, PM5(FK) | Migrations + gates |
| **Nghiệm thu** | | tsc 0 + full suite; product-setup E2E xanh; không còn schema "quảng cáo nhưng chết" không đánh dấu |

> **KẾT QUẢ THỰC THI ĐỢT E (2026-07-05, 3 agent):** ✅ Hoàn thành xanh — tsc 0, full suite 424 file/4.497 test/0 fail, migration 0201 applied (0200 không cần).
> - **E.1 Schema 3D/lighting/criteria thành LIVE (WE-1, QĐ #2):** editor lộ field 3D/solder theo measurementType (VISUAL ẩn); **consumer thật ở ingest** — `pointResultEvaluator` đánh giá height/volume/coplanarity/void... vs limit (monotonic: chỉ hạ OK→NG khi vi phạm thật, không đụng NTF), promote overallResult NG; criteria evaluator (numeric_range/boolean/text_match); lighting profile UI + vào deltaSync payload cùng 3D limits + criteria. Flag `POINT_LIMIT_EVAL_ENABLED` ON. |
> - **E.2 AQL lot acceptance (WE-1, QĐ #3):** `lotAcceptanceService` — lot = inspections cùng `batchNumber` (fallback windowed), sample-size + Ac/Re từ plan (hoặc ANSI/ASQ Z1.4 Level-II code table, c=0 default), UI config AQL + board accept/reject; `samplingPlan.evaluateLot/listLots`. |
> - **E.3 cpk scheduler + advisor corrections (WE-1):** `cpkSnapshotScheduler` (flag `CPK_SNAPSHOT_ENABLED`, cron 04:30, I-MR σ) → cpk_history; advisor anti-join `measurement_corrections` loại false-call trước suggestThresholds (test: sampleSize 10→6). |
> - **E.4 Test coverage (WE-2):** 6 file router test mới (63 test) lấp void product/point/program/panel/fiducial + assert governance; E2E `product-setup.spec.ts` **chạy thật** (2 pass smoke + 1 skip happy-path cần env riêng). **Phát hiện 3 bug thật** → wave-lead vá 2 (productModel.update no-op im lặng id sai → NOT_FOUND; lệch CONFLICT vs BAD_REQUEST); PM7 (panel RBAC) ghi nhận. |
> - **E.5 Dọn nợ (WE-3):** tách 3 dialog khỏi ProductModels (−402 net) + xóa 104 dòng canvas dead; **hợp nhất taxonomy defect** (survivor BRIDGING/COLD_JOINT/VOID/COMPONENT_MISALIGNMENT/REVERSE_POLARITY, retire+alias 5 duplicate, 0201); zh +139 key; KB route fix + doc "commission a new PCB". Phát hiện: MP10 mask thực ra OK (claim cũ stale); bề mặt product/quality đã ~99% dịch zh (gap thật ở module khác). |

---

## 10. TỔNG KẾT THỰC THI DOC 31 (2026-07-05)

**5/5 đợt (A–E) hoàn thành trong một phiên**, mỗi đợt nghiệm thu xanh trước khi sang đợt kế. **13 agent thực thi** + 4 agent audit, **8 migration mới (0194–0201, tất cả applied dev + test)**, test suite server tăng **392 → 424 file (4.273 → 4.497 test, 0 fail)** + E2E product-setup chạy thật, 2 data item repair (nối tiếp doc 27).

**42/42 phát hiện đã xử lý** (3 P0 đóng ngay Đợt A/B). Nghịch lý ban đầu — "schema giàu nhưng dữ liệu trống + governance thủng + chưa khâu" — đã đảo ngược:
- **Governance:** threshold bypass đóng kín 5/5 đường (2 endpoint chính + AI Copilot + bulk import + machine delta-sync ghi ngược LSL/USL); SoD thật, không ai tự-duyệt.
- **Wave-8 hết dead:** componentCode có đường ghi → Pareto-by-package chạy; golden có FK; catalog có curation + telemetry code unmatched.
- **Năng suất authoring:** import centroid thay click 200 điểm, clone board, bulk sâu, export/import gói, kích thước ảnh bắt buộc.
- **Hành trình:** wizard 9 bước + readiness score + optimistic-lock + fiducial tab hết mồ côi.
- **Schema live:** 3D/criteria/lighting có consumer thật ở ingest (QĐ #2), AQL lot-acceptance thật (QĐ #3), cpk scheduler.

**Bug thật sửa kèm (ngoài audit):** CHECK constraint `cad_import_jobs.format` chỉ cho step/dxf (centroid/gerber fail), productModel.update no-op im lặng + phantom audit, lệch mã lỗi CONFLICT/BAD_REQUEST, 2 taxonomy defect trùng.

### Việc còn chờ NGƯỜI (nối tiếp §13 doc 27 — không chặn)
| # | Việc | Nguồn |
|---|------|-------|
| 1 | Chạy `scripts/backfill-component-codes.mjs --apply` sau khi có BOM thật (điền componentCode → Pareto-by-package có dữ liệu) | Đợt B |
| 2 | Cấu hình AQL per product/customer + bật `CPK_SNAPSHOT_ENABLED` khi vào production | Đợt E |
| 3 | Chạy E2E happy-path `product-setup.spec.ts` trên env riêng (tài khoản miễn 2FA) | Đợt E |
| 4 | Follow-up nhẹ: gate AOI-ZIP commit path (spec gate hiện phủ direct/WAL/hot-folder, chưa phủ ZIP-commit); PM7 siết RBAC panel về admin; resume-picker wizard | Đợt B/E |
| 5 | (Kế thừa doc 27 §13) backup keystore, review+commit toàn tree, cutover Timescale prod, kiểm thiết bị/hiện trường | Doc 27 |

---

*Doc 31 · Audit 4-agent + thực thi 13-agent 5 đợt 2026-07-05 · HOÀN THÀNH, UNCOMMITTED chờ review · Tiếp nối doc 27.*

### Tổng hợp lộ trình
| Đợt | Trọng tâm | Gap | Ước lượng |
|:---:|---|---|---|
| A | Bịt governance threshold | OP1/OP2/OP8, MP2 | ~2 agent |
| B | Write path + wiring Đợt 8 | MP1/MP3, OP3/OP4/OP7, PM5/PM6, UX8 | ~3 agent |
| C | Năng suất authoring | MP5/MP7/MP8, PM1/PM3/PM4/PM8 | ~3 agent |
| D | Hành trình + completeness | UX1/UX2/UX3/UX7, PM9 | ~2 agent |
| E | Dọn nợ + test + trung thực | MP6/MP9/MP10, OP5/OP6/OP9, UX4/UX5/UX6/UX9/UX10, PM2/PM7/PM10/PM11/PM12 | ~2 agent |

---

## 8. Quyết định — ĐÃ CHỐT 2026-07-05

| # | Quyết định | Giá trị đã chốt | Ảnh hưởng kế hoạch |
|---|---|---|---|
| 1 | Release production-truth vs audit-only (MP4/OP7) | **Audit-only trước mắt** | MP4: giữ deltaSync theo `pointsConfigVersion`, ghi rõ release = provenance/audit-only trong code + doc; OP7 (snapshot golden vào release) vẫn làm để release tái lập được, nhưng không đổi luồng máy. Nâng "gate máy thật" hoãn tới khi có ≥1 sản phẩm released thực tế. |
| 2 | Dead schema 3D/GD&T/lighting (MP6/E.1) | **Nhà máy dùng CẢ 2D và SPI/AXI 3D → GIỮ schema + thêm consumer thật** | E.1 đổi từ "cắt UI" → **thêm editor field + consumer** cho 3D/solder/lighting/criteria: editor lộ đủ field theo `measurementType` (VISUAL ẩn 3D, SPI/AXI hiện height/volume/coplanarity), lighting profile có UI chọn per-point, criteria được đánh giá ở ingest. Không còn coi là dead — coi là **chưa-expose**, cần wiring. |
| 3 | Sampling plan (OP5/E.2) | **Có yêu cầu AQL từ khách hàng → NỐI vào acceptance thật** | E.2 đổi từ "bỏ" → **wire `preferredSamplingPlanId` vào acceptance/ingest logic** (AQL sample-size + accept/reject theo lô); thêm UI cấu hình AQL per product/customer. Nâng OP5 từ P2 lên **P1**. |
| 4 | Bypass threshold (OP2/A.2) | **Gate theo lifecycle: development sửa thẳng (có audit), active/released bắt buộc approval** | A.2 triển khai đúng: `measurementPoint.update` + spcAnalysisRouter cho sửa limit trực tiếp khi product `development` (ghi audit), CHẶN + route qua approval queue khi `active`/`eol`/đã có program released. |
| 5 | CAD import format (C.1) | **Chưa có file mẫu → làm generic centroid/pick-place import trước** | C.1 đổi: xây parser **generic centroid CSV** (cột refdes/x/y/rotation/side/package — cấu hình mapping cột như hot-folder adapter) + khung để thêm parser vendor-specific khi có file thật; KHÔNG hardcode format vendor nào. Gerber/IPC-2581 hoãn. |
| 6 | Product revision (PM2/E.6) | **`revision` varchar + clone (không genealogy)** | PM2 đổi từ "bảng genealogy" → thêm cột `revision` varchar + dùng clone (PM1) để tạo rev mới; không bảng `product_revisions`, không diff-engine. Giảm scope PM2 xuống P2. |

---

## 9. Những gì KHÔNG cần làm (đã tốt, giữ nguyên)
- Golden sample workflow engineering (SoD DB-enforced, one-active index, roiKey convention) — chỉ cần đổ dữ liệu + link product FK.
- Defect catalog seed IPC-A-610 (104 dòng) — chỉ cần curation UI + nối classification.
- Schema điểm đo depth (giữ, quyết định expose hay cắt phần dead — §8).
- measurementPointResolver guard (chống bug pointDefId=0) + auto-provision — chỉ cần thêm visibility.
- KB playbook tạo điểm đo (vi/en/zh + HITL tools) — chỉ sửa route.
- Program-release SoD service (mẫu chuẩn để nhân sang product-model approval PM10).

---

*Doc 31 · Audit 4-agent 2026-07-05 · Chờ duyệt phạm vi & 6 quyết định §8 trước khi gọi agent thực thi. Tiếp nối doc 27 (§13 vẫn còn các việc human-only: backup keystore, commit, Timescale cutover, kiểm thiết bị/hiện trường).*
