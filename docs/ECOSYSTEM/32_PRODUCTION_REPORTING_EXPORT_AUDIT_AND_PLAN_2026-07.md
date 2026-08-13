# 32 — AVI/AOI Production Reporting & Export: Audit + Ý tưởng + Kế hoạch thực hiện

**Ngày:** 2026-07-05 · **Trạng thái:** ✅ **HOÀN THÀNH TOÀN BỘ R0–R5** (2026-07-05) — nghiệm thu cuối: tsc 0 + vite build OK + **441 file/4.660 test/0 fail** + app jest 158, 1 migration (0202) applied, UNCOMMITTED chờ review. Tổng kết §8.
**Phương pháp:** 3 agent audit read-only (server report engine · web-app reporting/export UX · mobile export + data model) + 1 agent deep-dive **độ đầy đủ export ở /production-dashboard & /station-analysis** (§6). Toàn bộ dẫn chứng `file:line` trong các phần dưới.

---

## 0. Executive summary — không phải "chưa có", mà là "sâu nhưng phân mảnh"

Trái với kỳ vọng ban đầu, nền tảng **đã có một backend báo cáo khá sâu**: sinh file PDF (PDFKit + puppeteer), XLSX (exceljs + SheetJS), PPTX (pptxgenjs), lịch gửi email định kỳ với **retry/backoff + dead-letter + delivery ledger**, các view compliance (CFR21/IATF16949/ISO), và báo cáo AI. **Vấn đề không phải thiếu thư viện — mà là:**

| Trục | Hiện trạng |
|---|---|
| Scheduled email report + delivery | ✅ **Production-grade** (cron theo TZ nhà máy, retry/dead-letter, đa kênh email/webhook/in-app) |
| Sinh file PDF/XLSX/PPTX/CSV/JSON | ⚠️ **Thật nhưng phân mảnh qua 6 thư viện** + đường i18n đẹp nhất (`universalExportService`) **chết (không wire)** |
| Raw-data export + BI feed | ✅ **Production-grade** (`/api/export/*`, `/api/bi/*` — streamed, scoped, audited) |
| **External `POST /api/external/reports/generate`** (mobile gọi) | ❌ **STUB** — chỉ đếm alert/bulletin, bỏ qua `format`, không có dữ liệu sản xuất, lưu in-memory Map TTL 30' |
| **Mobile export** | ❌ **Dead code** — `exportService`/`dashboardService` không màn hình nào gọi; chỉ share text 1 alert qua OS share sheet |
| Data model cho report | 🟡 Sẵn sàng cho yield/NG theo day/hour/machine/station/factory + OEE persisted; **thiếu**: shift thật, Pareto theo loại lỗi, helper per-product/per-week |

**Kết luận:** đây là bài toán **consolidation + wiring + lấp gap dữ liệu + i18n/branding**, KHÔNG phải xây mới. Giá trị lớn nhất: (1) biến endpoint report external/mobile thành **thật**, (2) gom 6 đường sinh file về **một engine i18n duy nhất** có nhúng font tiếng Việt, (3) lấp gap dữ liệu shift/defect-type để "shift report" và "defect analysis" trung thực.

---

## 1. Inventory — cái gì ĐANG CÓ

### 1.1 Server — report engine
**Thật & trưởng thành:**
- `server/services/reportScheduler.ts` — cron 1 job/report, pin TZ nhà máy; dispatch NG_VISUAL / DAILY|WEEKLY|MONTHLY_SUMMARY / OEE_REPORT / MACHINE_HEALTH / CUSTOM.
- `server/services/reportDeliveryService.ts` — đa kênh **email / webhook (HMAC-SHA256) / in_app**; ledger `report_deliveries`; exponential backoff + dead-letter + drain worker.
- `server/services/reportGenerator.ts` — NG Visual: HTML (`:146`), **PDF puppeteer** (`:374`), **XLSX exceljs** (`:416`). ⚠️ `workstationHeatmap` mock rỗng (`:96-102`).
- `server/services/pdfTemplateService.ts` — **PDFKit** inspection PDF (`:126`) + quality PDF (`:369`).
- `server/services/powerpointService.ts` + `powerpointRouter.ts` — **PPTX pptxgenjs**.
- `server/routers/dataRouters.ts:477` `exportRouter` — **XLSX SheetJS** cho 8 entity → S3 (`storagePut`), permission-gated.
- `server/api/export/exportRouter.ts` — `GET /api/export/{inspections,measurements}.{csv,json}` streamed, scope `export:read`, audited. `server/api/export/biRouter.ts` — `/api/bi/datasets` (inspections_daily/defect_pareto/machine_oee).
- tRPC: `pdfReportRouter`, `powerpointRouter`, `reportBuilderRouter`, `scheduledReportRouter` (`systemRouters.ts:228` — CRUD + getLogs + listDeliveries + retryDelivery + sendTest + previewEmail), `aiReportRouter`, `executiveReportRouter`.

**Stub / dead / smell:**
- `server/_core/index.ts:2302` `POST /api/external/reports/generate` — **STUB**: đếm `alertHistory`+`mqttAlertHistory`+`mqttBulletinHistory` (`:2327-2343`), bỏ qua `format` (pdf/excel vẫn trả JSON, comment `:2403`), lưu **in-memory Map TTL 30'** (`:2287`). Download `:2372` trả CSV 1 dòng hoặc JSON.
- `server/services/universalExportService.ts` — **engine đẹp nhất, i18n vi/en/zh** (exceljs `:64`, jsPDF+autotable `:175`) nhưng `generateExcelReport/generatePdfReport` **wire vào KHÔNG GÌ** (chỉ test gọi). CSV/JSON primitives (`:283-309`) thì có dùng.
- `server/services/scheduledReportService.ts` — scheduler `.start()` (`:172`) **không bao giờ chạy** (chỉ `reportScheduler` cron chạy); tồn tại như content library.
- `server/routers/annotationComparisonRouter.ts:328` `generatePdfReport` — tên "PDF" nhưng **trả JSON**, không import lib PDF.
- `server/services/mqttSummaryScheduler.ts:6` — `import { drizzle } from "drizzle-orm/mysql2"` trong dự án Postgres (smell, cần verify daily/weekly summary có chạy).

### 1.2 Web-app (Vite + React SPA, `client/src/**`, wouter, recharts, i18n vi/en/zh)
| Route | Trang | Export hiện có | Client/Server |
|---|---|---|---|
| `/reports` | `Reports.tsx` | PDF (jsPDF `:312`), XLSX (`:244`), CSV (`:212`), Print (`:498`) | Client |
| `/report-builder` | `ReportBuilder.tsx` | **Không có nút export** | Server |
| `/scheduled-reports` | `ScheduledReports.tsx` | Email/webhook/in-app + retry | Server |
| `/pdf-reports` | `PdfReports.tsx` | PDF (pdfkit base64) + template mgr | Server |
| `/powerpoint-export` | `PowerPointExport.tsx` | PPTX | Server |
| `/realtime-report` | `RealtimeReportView.tsx` | **CSV only** | Client |
| `/history-export-scheduling` | `HistoryExportScheduling.tsx` | CSV/JSON/EXCEL/PDF (khai báo) | Server |
| `/ai-reports` | `AIReportsPage.tsx` | **KHÔNG export gì** | Server |
| `/history` | `History.tsx` | XLSX/CSV/PDF + workstation report | Client |
- Component mạnh nhất: `components/ReportExportButton.tsx` — PDF (html2canvas→jsPDF, **render Unicode VN/CJK đúng**), XLSX multi-sheet, HTML, localized — nhưng chỉ wire ~4 trang (ProductionDashboard/StationAnalysis/Dashboard/AIInspectionAnalytics).
- CSV-only: OEEDashboard, ParetoAnalysis, CategoryAnalytics, AnnotationStatistics, SPCAnalysis. **Không export:** DefectHeatmap, CorrelationAnalysis, DataComparison, ProductComparison, CorporateDashboard, MESControlTower, QualityCockpit, EnergyAnalytics, CarbonDashboard…
- **Dead:** `pages/ReportScheduling.tsx` + `components/ReportScheduler.tsx` (861 dòng) **không route** — song song với `ScheduledReports.tsx` live.

### 1.3 Mobile (`FactoryAlertSystem`)
- `src/services/exportService.ts` — export **ALERTS only**, format JSON/CSV/TXT, **share TEXT qua `Share.share`** (không ghi file; filename bị bỏ). **Không màn hình nào gọi → dead code.**
- `src/services/dashboardService.ts:125` `generateReport` → gọi stub server; cũng **dead code**.
- `src/screens/stationDetail/components/FullReportModal.tsx` — báo cáo xem-tại-chỗ theo 1 điểm đo, **không có nút export/share/print**.
- Không có PDF/XLSX/print/file-save trên mobile (không `react-native-print`/`react-native-share` file).

### 1.4 Data model — độ sẵn sàng
**Fact:** `product_inspections` (overallResult OK/NG/NTF, inspectionTime, cycleTime, machine/product/hierarchy codes — `inspection.ts:16`), `measurement_results` (result + `defectCatalogId`/`defectSeverity` — `:128`). **Dimension:** `defect_catalog` (category/severity/ipcSection — `product.ts:329`), `measurement_point_defs` (spec limits), hierarchy (machine.`machineType` AVI/AOI — `hierarchy.ts:249`). **Rollup:** `daily_statistics` (machine×day), `mqtt_bulletin_history` (station×period), `mqtt_error_summary`, `oee_metrics` (**persisted, có periodType SHIFT** — `oee.ts:5`), `production_sessions` (shift thật + kpiSnapshot), `shift_configs`. **Report-infra tables đã có:** `scheduled_reports`, `scheduled_report_logs`, `report_deliveries`, `report_templates`.
- **Aggregator tái dùng được:** `server/db/statistics.ts` (getDashboardStats/getShiftStats/getTopBottomMachines/getTopNGMeasurementPoints/getYieldTrendData/getNGByWorkstation…), `server/functions/cachedStatistics.ts` (MV-backed).

**Gap dữ liệu:**
- ❌ **Shift thật:** `product_inspections` **không có FK shift/session**; `getShiftStats` (`statistics.ts:342`) hardcode 3 bucket giờ 6-14/14-22/22-6, bỏ qua `shift_configs`. `production_sessions` là entity shift thật nhưng **không link** với inspection.
- ❌ **Pareto theo LOẠI lỗi:** không có helper/table rollup theo `defect_catalog.category/severity/ipcSection` (rollup hiện có theo *điểm đo*, không theo phân loại lỗi).
- ❌ **Per-product / per-week** aggregation helper.
- 🟡 OEE table có nhưng cần verify được populate liên tục; `workstationHeatmap` stub.

### 1.5 Format matrix — sản xuất được HÔM NAY
| Format | Lib | Nơi | Live? |
|---|---|---|---|
| CSV | hand-rolled RFC-4180 | `/api/export/*.csv` | ✅ |
| JSON | native | `/api/export`, `/api/bi` | ✅ |
| XLSX | SheetJS | `dataRouters exportRouter`→S3 | ✅ |
| XLSX | exceljs | `reportGenerator` (email attach) | ✅ |
| XLSX | exceljs (i18n) | `universalExportService:64` | ❌ dead |
| PDF | PDFKit | `pdfTemplateService` | ✅ (⚠️ font VN) |
| PDF | puppeteer | `reportGenerator:374` | ✅ (nặng, VN OK) |
| PDF | jsPDF+autotable (i18n) | `universalExportService:175` | ❌ dead |
| PDF | html2canvas→jsPDF | web `ReportExportButton` | ✅ (VN/CJK OK) |
| PPTX | pptxgenjs | `powerpointService` | ✅ |
| HTML | string-interp | email bodies | ✅ |
| MQTT push | JSON | bulletin/summary scheduler | ✅ |

---

## 2. Gap analysis (ưu tiên)

**P0 — trung thực/độ tin cậy (quản lý sẽ thấy ngay)**
1. External `reports/generate` là stub: không dữ liệu sản xuất, bỏ qua format, không render file, lưu volatile. Đây là endpoint mobile gọi. (`_core/index.ts:2302-2419`)
2. `Reports.tsx` (flagship web) **ship dữ liệu máy/nhà máy rỗng** — `machineComparisonData`/`factoryComparisonData` hardcode `[]` (`:192,:207`) → tab máy/factory trống, sheet Excel/PDF tương ứng trống.
3. `AIReportsPage.tsx` — **không export gì** (nội dung quản lý giàu nhất bị kẹt trên màn hình).
4. **Rủi ro font tiếng Việt** trong PDFKit (`pdfTemplateService`) + jsPDF (`universalExportService`, `lib/pdfExport.ts` dùng chữ ASCII bỏ dấu) → PDF ra tiếng Việt lỗi dấu. Chỉ puppeteer + html2canvas an toàn.
5. Mobile export dead + chỉ share text; `FullReportModal` không export.

**P1 — hợp nhất / dead code**
6. Gom 6 đường sinh file → chọn **`universalExportService` (i18n vi/en/zh) làm engine PDF/XLSX/CSV duy nhất**, nhúng font Unicode, wire branding; retire trùng lặp.
7. **2–3 scheduler trùng**: `reportScheduler` (live) vs `scheduledReportService.start()` (chết) vs `pages/ReportScheduling.tsx` (web orphan) → gom 1, xoá orphan.
8. `report_templates.sections`/`emailBodyTemplate` **không được engine tiêu thụ** (template chỉ trang trí) → dùng thật hoặc template engine.
9. Export coverage lệch: chuẩn hoá `ReportExportButton` cho mọi dashboard (nhiều trang CSV-only/không có).
10. `workstationHeatmap` stub rỗng dù `getNGByWorkstation`/`getDefectsByWorkstation` có sẵn.

**P2 — hoàn thiện tính năng / dữ liệu**
11. **Thêm chiều SHIFT thật** (stamp `shiftConfigId`/`sessionId` lên `product_inspections` lúc ingest, hoặc link `production_sessions`) — để "shift_report" trung thực.
12. **Helper rollup Pareto theo loại lỗi** (`defect_catalog.category/severity/ipcSection`) — cho "defect_analysis".
13. Helper **per-product / per-week**.
14. **Report artifact history/store** thật (persist file đã render + re-download) thay in-memory Map / base64 / S3 ad-hoc.
15. Report Builder nông: thêm filter station/product/shift/line/date-range + nút export + drag-drop thật.
16. On-demand export **không email được / không lưu lịch sử** (chỉ scheduled mới có ledger).

**P3 — polish / i18n / branding / risk**
17. Logo/letterhead không được vẽ trong PDFKit (chỉ in tên công ty text).
18. EN/ZH chưa phủ report live (chỉ VI hardcode + engine i18n đang chết).
19. REST `/api/export` hẹp (chỉ inspections/measurements CSV/JSON) — bổ sung XLSX/PDF + dataset yield/OEE/defect.
20. Sửa endpoint đặt tên nhầm (`annotationComparisonRouter.generatePdfReport`), import `mysql2` ở `mqttSummaryScheduler`.
21. Thêm "download chart PNG/SVG" + print layout A4 cho nhiều trang (hiện chỉ `Reports.tsx` có print).

---

## 3. Ý tưởng — tầm nhìn "Unified Production Report Engine"

Một pipeline duy nhất **định nghĩa → dữ liệu → render → lưu trữ → phân phối**, dùng chung cho on-demand (web + mobile) và scheduled:

```
Report Definition          Data Layer            Render Layer           Archive            Delivery
(type + dimensions/        (aggregators tái      (1 engine i18n:        (report_artifacts   (email/webhook/
 filters + format +   →     dùng, lấp gap    →    PDF/XLSX/CSV/HTML/  →   persist file +  →   in-app/MQTT/FCM
 branding + delivery)       shift/defect/product) PPTX + font VN/CJK      history+redownload) + mobile save/share)
                                                  + logo/letterhead)
```

- **1 report definition** (reportType chuẩn hoá: DAILY/WEEKLY/MONTHLY/SHIFT/PRODUCT/DEFECT_PARETO/OEE/MACHINE_HEALTH/CUSTOM + filters đầy đủ station/line/product/shift/machineType AVI-AOI + format + branding + kênh gửi).
- **1 render engine** (`universalExportService` nâng cấp) — mọi format qua đây, font Unicode nhúng sẵn, branding từ company profile.
- **Report artifact store** — bảng `report_artifacts` (loại/tham số/format/URL file/hash/createdBy/expiresAt) → mọi report (on-demand + scheduled + mobile) đều lưu & re-download được.
- **Mobile thật** — gọi endpoint thật, tải file server-render (thêm `react-native-share`/blob save), export "full report" trạm.
- **On-demand = scheduled** dùng chung engine + có "email cho tôi báo cáo này".

---

## 4. Kế hoạch thực hiện (theo wave) — ✅ **ĐÃ DUYỆT (§5) & ĐÃ THỰC THI 6/6 WAVE (§8)**

> ⚠️ Nhãn *"chờ duyệt"* cũ ở tiêu đề này đã gỡ: nó mâu thuẫn với **§5 "Quyết định — ĐÃ CHỐT
> 2026-07-05"** và **§8 "TỔNG KẾT THỰC THI"** ngay bên dưới, và là lý do mục này bị chép vào
> backlog. Nội dung giữ nguyên làm bản ghi phạm vi từng wave. *(nhóm C việc 2, 2026-08-13)*

> Nguyên tắc thực thi (như các đợt trước): agent chuyên môn theo từng wave, **không tự git**, gate `tsc`/test giữa các wave; server có DB/broker nên ưu tiên unit + targeted test.

**Wave R0 — Baseline & chốt quyết định.** Xác nhận `npm run check` (tsc) xanh; liệt kê endpoint/trang report hiện trạng làm mốc; chốt 6 quyết định ở §5.

**Wave R1 — Data readiness (P2 dữ liệu).** ✅ **XONG XANH** (427 file/4.516 test/0 fail, tsc 0, không cần migration).
- Chiều shift (QĐ #3b): `shiftResolution.ts` resolver 3 tầng (production_sessions phủ → shift_configs window qua-nửa-đêm factory-local → fallback hour-bucket); `getShiftStats` dùng shift window thật (+ sửa bug factoryId bị bỏ qua) + `getShiftReport` cho R3/R4.
- `reportAggregators.ts`: `getDefectParetoByCategory` (category/severity/ipcSection + UNCLASSIFIED), `getYieldByProduct`, `getYieldTrendByWeek` (ISO-week factory-TZ), `getWorkstationHeatmap` thay stub rỗng; tRPC `reportAggregators` router.
- ⚠️ **Readiness gap phát hiện (trung thực):** `oee_metrics` chỉ ghi on-demand (nút Calculate OEE thủ công), KHÔNG có scheduler tính+lưu liên tục → báo cáo OEE thưa/gappy. Cần OEE snapshot scheduler (đưa vào R5). Follow-up R4: `Dashboard.tsx` chọn shift icon theo code cũ, cần map theo window.
- *Verify:* unit + DB-integration test mỗi aggregator; factory-TZ + shift qua-nửa-đêm chứng minh.

**Wave R2 — Unified render engine + artifact store (P1).** ✅ **XONG XANH** (431 file pass + 1 flake doc-27 fetch-models, tsc 0, 0202 applied).
- Engine (R2-A): fetch **Be Vietnam Pro** (OFL, full-glyph VN verify) → `server/assets/fonts/` + `scripts/fetch-fonts.mjs` + loader fail-loud; API `renderReport({type,format,locale,branding,data})` phủ PDF(jsPDF font VN nhúng)/XLSX/CSV/HTML; branding từ `email_template_config`; puppeteer làm renderer 'premium'. **Bắt bug:** đường PDF jsPDF vốn đã chết (ESM default namespace) — engine "đẹp nhất" trước chưa từng render PDF được; PDFKit cũng cắm font VN (hết mojibake WinAnsi). ⚠️ Deploy: `server/assets/fonts` phải ship kèm (esbuild external không copy) hoặc set `FONT_ASSETS_DIR`.
- Artifact store (R2-B): bảng `report_artifacts` (0202) + `persistArtifact` = **đường lưu trữ duy nhất** (storagePut hash-namespaced + sha256 dedupe + `expiresAt=now+365d`); route re-download tRPC + REST `/api/reports/artifacts/:id/download` (access-control + expiry 410 GONE); cleanup job daily (flag ON).
- Wave-lead vá test andonRobotDispatch (thêm `sql` passthrough vào mock drizzle-orm — schema report_artifacts kéo `sql` qua barrel).
- Tồn đọng chuyển R4: retire `scheduledReportService.start()` + đường ASCII `lib/pdfExport.ts` (còn dùng bởi HistoryComparison — R4).

**Wave R3 — External + Mobile report path THẬT (P0).** ✅ **XONG XANH** (server 433 file/4.597 test/0 fail, app tsc 0 + jest 158, không migration).
- External (R3-A): `POST /api/external/reports/generate` viết lại thành pipeline thật (aggregator R1 → renderReport R2 → persistArtifact R2), 7 reportType (daily/weekly/shift/defect/product/station/oee) **tôn trọng format** (pdf/xlsx/csv — hết bug bỏ qua format), trả `{reportId=artifact id, downloadUrl, artifactUrl, expiresAt}` thật; retire Map in-memory; giữ tương thích tên legacy để mobile hiện tại chạy tiếp; OEE thưa → file hợp lệ + `emptyState` trung thực; `externalReportService` dùng lại cho R4. Download stream file thật (410 khi hết hạn).
- Mobile (R3-B, QĐ #5 nhẹ): `FullReportModal` + nút "Mở báo cáo web" (deep-link `/station-analysis/:id`) + "Chia sẻ liên kết"; **xoá dead code** `exportService.ts` + `dashboardService.generateReport` (0 caller, không wrap giả); giữ view-tại-chỗ. **KHÔNG** thêm lib render file mobile.
- Wave-lead: 32 file DB-integration fail 1 lần do cạn kết nối Postgres (phiên song song) — re-run xác nhận 0 fail, không phải regression.

**Wave R4 — Web consolidation & UX (P0/P1).**
- Lấp dữ liệu máy/nhà máy rỗng ở `Reports.tsx`; thêm export cho `AIReportsPage`.
- Chuẩn hoá `ReportExportButton` (PDF/XLSX/HTML localized) cho các dashboard đang CSV-only/không có; thêm "download chart PNG".
- **Làm export /production-dashboard & /station-analysis "đầy đủ nhất" (đủ mọi chart + data, PDF & HTML) — xem đặc tả chi tiết §6:** thêm print-view ẩn mount toàn bộ chart, chuyển ProductionDashboard sang async-prefetch + thêm chart id/section, phân trang PDF theo block, màu in an toàn, chụp cả ảnh bo mạch/gallery NG của Station-Detail.
- Gom scheduler (xoá orphan `ReportScheduling.tsx`), hợp nhất `/scheduled-reports` + `/history-export-scheduling` (format list trung thực).
- Report Builder: filter station/product/shift/line/date-range + nút export + link sang schedule; "email cho tôi báo cáo này" cho on-demand.
- *Verify:* build web; đi từng trang xuất PDF/XLSX/CSV; print layout.

> **KẾT QUẢ THỰC THI ĐỢT R4 (2026-07-05, 3 agent):** ✅ Hoàn thành xanh — tsc 0, full suite 436 file/4.622 test/0 fail, vite build OK.
> - **R4-A engine §6:** phân trang PDF theo block (không cắt đôi chart/hàng, table lặp header khi tràn); header+scope-band+footer mọi trang; resolver màu in (oklch + hsl-var + var()); helper `capturePrintCharts` mount mọi chart off-screen; section type `gallery` (ảnh NG) + `imageDataUrl` (ảnh bo mạch). API `chartRender` thunk cho R4-B.
> - **R4-B 2 trang:** ProductionDashboard async prefetch + 7 chart id + print-view (0→đủ chart export); StationAnalysis chụp cả 10 chart thay 1/10 + measurement-mode SPC + ảnh bo mạch + gallery NG; cap fail-history 50→200; mọi chart kèm bảng số; scope metadata.
> - **R4-C nội dung + gom:** Reports.tsx lấp dữ liệu máy/nhà máy thật (getTopBottomMachines + yieldRateByFactory); AIReportsPage thêm export; xoá orphan ReportScheduling.tsx + ReportScheduler.tsx (861 dòng); retire vòng lặp chết `scheduledReportService.start()` (giữ content library); HistoryExportScheduling format list trung thực; thêm ReportExportButton cho CategoryAnalytics/ProductComparison/CorporateDashboard (hoãn 9 trang chart-heavy); ReportBuilder filter + export + "email báo cáo này" (`reportArtifact.generate` source=on_demand → artifact history).
> - Trung thực: rasterize recharts + fidelity PDF cần verify browser thật (§6.5 acceptance); delay chụp 1.9s cần tune kiosk yếu; ảnh cross-origin cần CORS.

**Wave R5 — Polish / i18n / compliance / API.** ✅ **XONG XANH** (441 file/4.660 test/0 fail, tsc 0, vite build OK, không migration).
- R5-A: **OEE snapshot scheduler** (lấp gap R1 — dùng path compute của nút Calculate OEE, cron hourly+daily, flag `OEE_SNAPSHOT_ENABLED` default OFF, idempotent, skip trung thực); REST `/api/export` mở rộng XLSX/PDF + dataset yield/oee/defect-pareto + `/api/bi` +3 dataset; `generatePdfReport` render PDF VN thật (không chỉ đổi tên); import mysql2 hóa ra **dead import** đã gỡ.
- R5-B: report surface đã ~95% localize sẵn (chỉ 2 chuỗi hardcode thật) — backfill zh đóng gap 28 key + namespace `rtReport`; UI branding đã có (`EmailTemplateEditor`) + note vai trò report; **vẽ logo/letterhead PDFKit** (best-effort PNG/JPEG, fallback tên, không crash) + wire branding từ admin config.

---

## 8. TỔNG KẾT THỰC THI DOC 32 (2026-07-05)

**6/6 wave (R0–R5) hoàn thành trong một phiên**, mỗi wave nghiệm thu xanh trước khi sang wave kế. **13 agent thực thi** (2+2+2+2+3+2) + 4 agent audit, **1 migration mới (0202 report_artifacts, applied)**, test suite server tăng **~424 → 441 file (4.660 test, 0 fail)** + app jest 158.

Bài toán đúng như audit chẩn đoán — **consolidation + wiring + lấp gap, không phải xây mới**. Kết quả đảo ngược "sâu nhưng phân mảnh":
- **External/mobile report thật:** endpoint stub (đếm alert, bỏ format, Map TTL 30') → pipeline thật (7 reportType, tôn trọng format PDF/XLSX/CSV, artifact bền 1 năm); mobile nhẹ (deep-link web + xoá dead code).
- **1 engine i18n có font VN:** `universalExportService` (trước **chưa từng render PDF được** do bug ESM) → engine chuẩn với Be Vietnam Pro nhúng thật; puppeteer thành premium tùy chọn; PDFKit hết mojibake + có logo.
- **Artifact store:** Map volatile → bảng `report_artifacts` S3 + dedupe + retention 365 ngày + re-download + cleanup.
- **Data gap lấp:** shift thật (join production_sessions), Pareto theo loại lỗi, per-product, per-week, workstationHeatmap thật, OEE scheduler.
- **Export "đầy đủ nhất" (§6):** ProductionDashboard 0 chart → đủ; StationAnalysis 1/10 → cả 10 + ảnh bo mạch/gallery NG; PDF phân trang theo block; màu in an toàn; scope-band mọi trang.
- **Dọn nợ:** xoá orphan scheduler 861 dòng, retire scheduler chết, Reports.tsx hết rỗng, AIReports có export, sửa 2 smell (naming + mysql2 dead import).

**Bug thật phát hiện ngoài audit:** universalExportService PDF vốn đã chết (ESM default namespace) — engine "đẹp nhất" chưa từng render PDF; `annotationComparisonRouter.generatePdfReport` tên PDF trả JSON; import mysql2 dead trong dự án Postgres; `getShiftStats` bỏ qua factoryId.

### Việc còn chờ NGƯỜI (không chặn)
| # | Việc | Nguồn |
|---|------|-------|
| 1 | **Verify visual PDF/HTML trên browser thật** (§6.5): rasterize recharts, dấu tiếng Việt, logo, phân trang — mở thử 1 PDF/HTML mỗi trang ProductionDashboard/StationAnalysis; tune delay chụp 1.9s nếu kiosk yếu | R4 §6.5 |
| 2 | Bật `OEE_SNAPSHOT_ENABLED=true` ở production để OEE report có dữ liệu liên tục; cân nhắc single-worker | R5/R1 |
| 3 | ✅ **XONG 2026-08-13 (nhóm C việc 1)** — build nay chép `server/assets/fonts` → `dist/assets/fonts` (`scripts/copy-font-assets.mjs`, nối vào `"build"` + `build-secure.mjs`), `fontAssets.ts` thêm ứng viên bundle-relative; **không cần đặt `FONT_ASSETS_DIR`**. Đo trước khi vá: `find dist -iname "*BeVietnam*"` → **0 file**, và `Dockerfile:43-46` không chép `server/` ⇒ ảnh Docker đang ship một bản **xuất PDF tiếng Việt CHẾT** (fail-loud). Lưới: `server/services/fontAssetsDist.test.ts` (5 ca, có đối chứng âm). <br>⏳ **Còn lại:** CORS cho ảnh NG/bo mạch cross-origin (html2canvas). | R2/R4 |
| 4 | Đặt company logo/name/màu qua Admin Settings → EmailTemplate/Branding để PDF/XLSX có letterhead thật | R5 |
| 5 | (Kế thừa) doc 27 §13 + doc 31 §10 human items (backup keystore, commit toàn tree, cutover Timescale, ...) | doc 27/31 |

---

*Doc 32 · Audit 4-agent + thực thi 13-agent 6 wave 2026-07-05 · HOÀN THÀNH, UNCOMMITTED chờ review.*

---

## 5. Quyết định — ĐÃ CHỐT 2026-07-05

| # | Quyết định | Giá trị đã chốt | Ảnh hưởng thực thi |
|---|---|---|---|
| 1 | Phạm vi | **Làm đủ R0–R5** | Thực thi tuần tự 6 wave, nghiệm thu xanh từng wave |
| 2 | Engine render | **`universalExportService` mặc định** (jsPDF+exceljs, i18n, nhúng font VN) + **puppeteer tùy chọn** cho report layout phức tạp | R2: nâng universalExportService làm engine chuẩn; puppeteer giữ như "premium renderer" chọn được per-report |
| 3 | Chiều shift | **(b) join `production_sessions`** (không đổi ingest) | R1: helper join inspection→production_sessions theo thời gian + `shift_configs`; KHÔNG migration stamp lên product_inspections |
| 4 | Lưu trữ artifact | **S3/storage (`storagePut`) + retention tối thiểu 1 năm** | R2: bảng `report_artifacts` trỏ file S3, `expiresAt` mặc định +365 ngày, job cleanup theo retention |
| 5 | Mobile | **Giữ xem-tại-chỗ + link mở web report** (không tải file server-render trên mobile) | R3: mobile nhẹ — `FullReportModal` thêm nút "Mở báo cáo web" (deep-link) thay vì tải PDF; xoá/wire dead export services |
| 6 | Format bắt buộc | **PDF + XLSX chắc chắn** · **CSV** (data/BI) trong đường on-demand · **PPTX không bắt buộc** (giữ trang PPTX hiện có, không gom vào on-demand) | R2/R3/R4: engine + on-demand phủ PDF/XLSX/CSV; PPTX để nguyên đường riêng |

---

## 6. Audit chuyên sâu — độ đầy đủ EXPORT ở `/production-dashboard` & `/station-analysis/:id` (PDF & HTML)

> Bổ sung theo yêu cầu: báo cáo xuất ra phải **đủ mọi biểu đồ + dữ liệu**, đặc biệt **PDF & HTML** phải đầy đủ nhất. Audit chuyên sâu `client/src/components/ReportExportButton.tsx` + 2 trang.

### 6.1 Cơ chế `ReportExportButton` hiện tại
- **Data-driven, KHÔNG screenshot cả trang.** Trang truyền `getConfig()` → `sections[]` gồm 4 loại: `stats` / `table` / `chart` / `text` (`:70-95`).
- `stats/table/text` serialize từ JS data (độc lập DOM). Chỉ `chart` chạm DOM: `captureVisibleCharts` (`:130-144`) làm `document.getElementById(chartElementId)` → `html2canvas` → PNG base64; **không thấy element thì bỏ qua âm thầm** (không ref, không render ẩn, không mở tab).
- html2canvas (`:114-127`): `scale:2`, `onclone` chạy `resolveOklchColors`; **thiếu** `foreignObjectRendering`/`windowWidth`.
- **PDF** (`exportPDF :215-286`): dựng HTML body → container ẩn width cố định (1120 landscape / 794 portrait) → html2canvas thành 1 canvas dài → **cắt trang theo pixel mù** (`:258-280`, cắt ngang chart/hàng bảng); header/branding **chỉ trang 1**; footer chỉ số trang → toàn ảnh, chữ không chọn được.
- **HTML** (`buildFullHTML :186-203`): file **standalone** — style inline + ảnh base64 + **bảng `<table>` chữ chọn được** (mạnh nhất về dữ liệu). Vẫn phụ thuộc `captureVisibleCharts` cho biểu đồ.
- **Excel:** bỏ hẳn section `chart`/`text`.

### 6.2 `/production-dashboard` — IN/OUT
- `getExportConfig` (`ProductionDashboard.tsx:399-457`) **đồng bộ, emit ZERO chart section**; các chart container **không có `id`** → **không biểu đồ nào export được (cả PDF lẫn HTML).**
- **IN:** 5 KPI (`stats`); bảng trạm (dùng full `stationData`, **bỏ qua search + low-yield filter** `:428/949-963`); bảng Top-Defect **chỉ khi đang ở tab Defect** (`enabled: activeTab==="defect"` `:285`).
- **OUT (toàn bộ):** Factory-Compare chart (`:758`), Defect Pareto (`:1288`), NG-by-Station (`:1366`), Yield Trend (`:1477`), Output&NG Trend (`:1501`), SPC cards + mini control charts (`:1594-1738`), Machine-AI RUL (`:861`). Dataset Trend/SPC/Compare không hề dựng section.

### 6.3 `/station-analysis/:id` — IN/OUT
- `getExportConfig` (`StationAnalysis.tsx:183-548`) **async prefetch 13 query** → **dữ liệu/bảng/stat gần đầy đủ bất kể tab** (điểm mạnh). Điểm yếu: biểu đồ chỉ chụp được của **tab đang mở** (mỗi lúc chỉ 1 tab/sub-tab mount).
- Mặc định tab `overview` → **chỉ 1/10 biểu đồ (`chart-hourly-yield`) được chụp**; 9 chart còn lại (pareto/spc/histogram/scatter/stratification×3/forecast) ra **section có tiêu đề nhưng rỗng** trong PDF/HTML.
- **Measurement-mode SPC** (`chart-spc-xbar-mp`/`-r-mp`/`chart-xbar-histogram`/`chart-r-histogram` `:1479-1621` + `mpSpc`) **không export/prefetch** — cả khi đang ở view đó.
- OUT thêm: Station-Detail **ảnh bo mạch + marker/heatmap** (`:2529-2634`) và **gallery ảnh lỗi NG** (`:2808-2891`) — visual đáng giá nhất — chỉ export bảng points. Rule-summary SPC yield không export; fail-history **cap 50 dòng** (`:192`); histogram bỏ `mode`.

### 6.4 Gap PDF & HTML (nặng → nhẹ)
1. **[ProdDash] 0 biểu đồ export được** (không chart section + không `id`).
2. **[StationAnalysis] 9/10 biểu đồ rỗng** khi export mặc định (chỉ tab đang mở được chụp).
3. **[StationAnalysis] Measurement-mode SPC** hoàn toàn ngoài tầm export.
4. [ProdDash] Bảng Top-Defect phụ thuộc tab đang mở.
5. [ProdDash] Dataset Trend/SPC/Compare vắng hoàn toàn.
6. [StationAnalysis] Ảnh bo mạch + ảnh NG bị bỏ.
7. **[PDF] Phân trang pixel mù** cắt đôi chart/hàng bảng (`:258-280`).
8. **[PDF] Header/branding chỉ trang 1; không in filter/scope** (factory/line/product/shift).
9. [ProdDash] Export bỏ qua search/low-yield filter đang áp.
10. **[raster] Chart là PNG chữ không chọn được**; dark-mode → card tối trên nền trắng; `hsl(var(--muted-foreground))` (`StationAnalysis.tsx:850`) không được resolver hoà giải → nhãn trục sai màu/tương phản thấp.
11. [HTML] Đúng chuẩn standalone (bảng chữ chọn được) nhưng vẫn dính section chart rỗng + thiếu metadata filter.
12. Lặt vặt: fail-history cap 50, histogram thiếu `mode`, rule-summary SPC yield.

### 6.5 Target "đầy đủ nhất" + cách làm
- **Tách capture chart khỏi tab đang mở:** dựng **"print view" ẩn width cố định (~1100px)** mount **mọi** biểu đồ bằng data đã prefetch, chờ 1 frame recharts layout, `html2canvas` từng chart, rồi unmount. (StationAnalysis đã prefetch sẵn; ProductionDashboard phải chuyển `getExportConfig` sang **async prefetch**.)
- **ProductionDashboard:** thêm `id="chart-…"` cho 6 container (hoặc dùng print view) + prefetch defect/trend/spc/compare + push section `chart` + `table` tương ứng.
- **Luôn serialize dữ liệu thành bảng thật** (không dựa ảnh chart cho số); giữ chart là ảnh **kèm thêm** bảng → PDF/HTML có cả hình lẫn số chọn được.
- **Phân trang PDF theo block** (đo từng section, ngắt trang giữa block — không cắt đôi chart/hàng); lặp header + filter band + footer số trang **mọi trang**.
- **Chuẩn hoá màu in:** ép light/print palette lên clone, `backgroundColor:"#ffffff"` cho cả chart, resolve cả `oklch(...)` lẫn `hsl(var(--token))`.
- **Chụp visual Station-Detail:** render ảnh bo mạch + marker/heatmap vào print view; nhúng gallery ảnh NG (đã có URL) thành `<img>`.
- **Phản ánh filter + full dataset:** metadata block factory/line/product/shift/date + search/low-yield; bỏ cap 50 fail-history; ghi rõ bảng trạm theo filter hay all-rows.

→ Thực thi trong **Wave R4** (mục export web), phụ thuộc **Wave R2** (phân trang element-aware + màu in an toàn). StationAnalysis chỉ cách "đủ" ~1 fix cấu trúc (print view cho chart); ProductionDashboard cần thêm id + async prefetch + chart sections.

**File trọng yếu §6:** `client/src/components/ReportExportButton.tsx`, `client/src/lib/resolveOklchColors.ts`, `client/src/pages/ProductionDashboard.tsx`, `client/src/pages/StationAnalysis.tsx`, `client/src/components/patterns/chartTokens.ts`.

---

## 7. Phụ lục — file trọng yếu
- Server: `_core/index.ts` (external reports stub `:2302`), `services/{reportScheduler,scheduledReportService,reportDeliveryService,reportGenerator,pdfTemplateService,powerpointService,universalExportService,mqttSummaryScheduler,mqttBulletinService}.ts`, `routers/{pdfReportRouter,powerpointRouter,reportBuilderRouter,scheduledReportRouter,aiReportRouter}.ts`, `api/export/{exportRouter,biRouter}.ts`, `db/statistics.ts`, `functions/cachedStatistics.ts`.
- Web: `client/src/pages/{Reports,ReportBuilder,ScheduledReports,PdfReports,PowerPointExport,RealtimeReportView,HistoryExportScheduling,AIReportsPage,History}.tsx`, `components/ReportExportButton.tsx`, `lib/{pdfExport,exportUtils}.ts`; **xoá** `pages/ReportScheduling.tsx` + `components/ReportScheduler.tsx`.
- Mobile: `FactoryAlertSystem/src/services/{exportService,dashboardService}.ts`, `screens/stationDetail/components/FullReportModal.tsx`.
- Data: `drizzle/schema/{inspection,product,hierarchy,production,oee,mqtt,system}.ts`.
- Liên quan: [30_BI_EXPORT_API.md](30_BI_EXPORT_API.md), [27_AOI_AVI_END_TO_END_AUDIT_UPGRADE_PLAN_2026-07.md](27_AOI_AVI_END_TO_END_AUDIT_UPGRADE_PLAN_2026-07.md).
