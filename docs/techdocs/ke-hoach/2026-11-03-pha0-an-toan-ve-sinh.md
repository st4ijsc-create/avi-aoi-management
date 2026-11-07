# Pha 0 · An toàn & vệ sinh — gói việc bàn giao dieu‑phoi

| | |
|---|---|
| Nguồn | TechDocs 00‑INDEX "Lộ trình tổng hợp" pha 0; bước 90‑P0 · 50‑C0 · 40‑AL0 · 30‑T0 · 70‑E0 · 80‑F0 · 60‑Q0 |
| Quyết định | Chủ dự án 2026‑11‑03: "(a) pha 0 trước, (b) mockup chạy song song" |
| Điều kiện cứng | Không chạm `services/scada/*`, `services/ot/commandDispatcher.ts`, `otDeviceWrite.ts`, `edge/*` (A2(o) của scada‑master); không cần GPU; không đổi hành vi model (80); `:3000` không còn đóng băng (gỡ 03/11, dieu-phoi); mọi xoá dữ liệu **báo chủ dự án trước, có số đếm trước/sau**, chạy bằng owner `aoi` qua dieu‑phoi; SQL duyệt trước, `--test-only` trước |
| Cổng gộp | census đầy đủ (`npx vitest run census Census --exclude "**/*.db.test.ts"` + `server/testing`) + `check:tests` (heap 12 GB, kiểm exit code) + bench OpenPLC 24/24 nếu lô chạm 50 (chỉ C0‑UI không chạm) |
| Ước lượng | ≈ 1 tuần, 4 phiên song song |

## 0. Việc đầu tiên của dieu‑phoi

1. Commit `docs/techdocs/**` + `docs/superpowers/specs/2026-11-03-he-sinh-thai-tinh-gon-thiet-ke-lai.html` (pathspec tường minh, không commit tràn) lên nhánh tài liệu rồi gộp main.
2. Mở nhánh pha 0 theo phiên: `feat/pha0-platform` (90‑P0 server), `feat/pha0-ui` (luong‑ui: 90‑P0 client + 50‑C0 UI), `feat/pha0-alarm-telemetry` (40‑AL0 + 30‑T0), `feat/pha0-eng-ai` (70‑E0 + 80‑F0 + 60‑Q0).
3. Giao kiem‑dinh: census + đột biến cho mỗi lô; đo trước/sau theo bảng §9.

## 1. 90‑P0 (server) — phiên dieu‑phoi hoặc phiên nền

| # | Việc | Tệp/chỗ `[đo]` | Nghiệm thu |
|---|---|---|---|
| P0‑1 | App kết nối DB bằng `avi_app` — kiem‑dinh đo "trước" 04/11: `.env` cây chính ĐÃ dùng `avi_app` (rolsuper/bypassrls = false); việc còn lại = xác minh env của tiến trình :3000 và mọi worktree/`.env` khác, cấp quyền idempotent; kiểm quyền CRUD của `avi_app` đủ cho mọi bảng app dùng (mig 0224 + `scripts/mcp-cuc-bo-vai-tro.mjs` kiểu idempotent cho avi_app); migration vẫn bằng `aoi` | `server/db/connection.ts`, script cấp quyền mới `scripts/cap-quyen-avi-app.mjs --test-only|--dev-only` | 90‑N1: trong app `select rolsuper, rolbypassrls` = false/false; suite DB xanh với `avi_app` |
| P0‑2 | Admin hết bypass `requirePermission`: `RBAC_SCOPED_ADMIN` thành mặc định, gỡ cờ; cấp đủ quyền cho 10 tài khoản admin qua seed/`permissions` (không mất truy cập) | `server/_core/accessControl.ts:207`, seed quyền — **có hiệu lực trên `:3000` từ 15:11 07/11**; chờ chủ dự án đăng nhập admin 1 lần | 90‑N2 ma trận 10 module bằng vai không‑admin; không admin nào bị khoá ngoài (kiểm đăng nhập 10 admin) |
| P0‑3 | CSP + origin‑check `enforce` mặc định (dev cho phép localhost/cổng dev); gỡ `SEC_CSP_MODE`/`SEC_ORIGIN_CHECK_MODE` | `securityHeaders.ts:46`, `originCheck.ts:41` — bước 1 report **có hiệu lực từ 15:11 07/11**; bước 2 enforce sớm nhất 15:11 08/11 và sau đăng nhập admin | Playwright: app chạy, không lỗi CSP console; POST không Origin bị 403 trừ `/api/v1|machine|aoi` |
| P0‑4 | `moduleGate` cache 60 s (RAM) — 0 truy vấn DB/lần gọi; fail‑open giữ (đã duyệt giữ license RAM) | `server/license/moduleGate.ts:104-110,154-163` | đếm truy vấn: 135 chỗ gọi, 0 query sau cache ấm |
| P0‑5 | Gỡ mã OTel/Sentry (không gói) + cờ `OTEL_*`, `SENTRY_*` | `_core/observability.ts:70-120` | grep = 0; `/metrics` Prometheus vẫn chạy |
| P0‑6 | Retention mặc định bật (`DATA_RETENTION_ENABLED` gỡ cờ) + backup pg_dump theo lịch + `DR_VERIFY` bật; lịch chạy ở worker | `dataRetentionService.ts`, `backupService.ts`, `backgroundJobs.ts:113,255,409` | `uploads/backups/` có tệp sau 1 lịch; log job |
| P0‑7 | `.env` khoá trùng → 0 — **XONG 06/11** (chủ dự án xoá 2 dòng 747/756) | script đếm khoá trùng = 0 |
| P0‑8 | `/api-docs` và `/component-showcase` ra khỏi app (docs tĩnh sinh từ `/api/v1/openapi.json`; Storybook/`vite --mode dev` cho showcase); route 404 | `client/src/pages/ApiDocs.tsx` 3 578, `ComponentShowcase.tsx` 1 833, `App.tsx` | 2 route public biến mất; bundle giảm |
| P0‑9 | Gỡ 6 trang chết (`AIHub`, `AIStudioHub`, `AILocalKnowledgeBasePage`, `DashboardTemplates`, `TemplateMarketplace`, `TestAnnotationPage`) + `AIChatBox`, `AILocalKnowledgeBase` | 1 439 + 680 LOC | grep import = 0; redirect giữ |
| P0‑10 | Gỡ `socket.ts:2797` `calculateOEE` chết (SQL sai cột) | `_core/socket.ts` | grep = 0 |
| P0‑11 | Phiên theo vai: TTL 12 h operator/supervisor, 7 d engineer/admin, gia hạn trượt | `_core/hanPhien.ts:57` — trên main a9a8c9405; hiệu lực sau khi `:3000` restart (sau 15:08 07/11) | test TTL theo vai |
| **Chủ dự án** | gỡ `cookies.txt` khỏi git (+ `.gitignore`) và **thu hồi mọi phiên** (`user_sessions` revoke) sau khi P0‑11 lên; đặt `OT_CONTROL_ENABLED=false` (D9) | | |

## 2. 50‑C0 (UI + vệ sinh, không chạm lõi) — luong‑ui / scada‑ui

| # | Việc | Tệp `[đo]` | Nghiệm thu |
|---|---|---|---|
| C0‑1 | Gỡ cửa chết: Sparkplug DCMD (`uns/sparkplugCommand.ts` + cờ), REST v1 `/equipment/:id/commands` (cả nhánh robot), `adapterFacade.executeCommand` | `api/v1/router.ts:351-417`, `ot/adapterFacade.ts:247` | 50‑N1 census `duongVong` = 0 cửa mới; test 404/410 cho route |
| C0‑2 | `AiChatFrame` ẩn trên mọi route có nút DỪNG (`/scada/*`, `/command-console`, `/line-view`, sau này `/giam-sat/*`, `/ky-thuat/an-toan`) | `components/AiChatFrame.tsx`, `ShellAiButton` | 50‑N5 Playwright: FAB không phủ `NutDungMay` |
| C0‑3 | `NutDungMay` render qua portal tầng trên cùng (z trên mọi Dialog/Sheet/Sonner); hộp xác nhận lồng trong Faceplate không che | `components/scada/DungMay.tsx`, `Faceplate.tsx`, `HopThoaiLenh.tsx` | 50‑N5: mở hộp xác nhận + 3 toast ⇒ bấm DỪNG được ≤ 1 s |
| C0‑4 | `MachineCockpit` bỏ nút "Đề xuất" ngõ cụt (`/control-plane?machineId=` không đọc tham số) | `pages/MachineCockpit.tsx` | grep = 0 |
| C0‑5 | `CommandConsole`, `RobotControl`, `FleetOrchestration`, `SafetyWorkforce` (phần cộng tác người‑robot) → trang "Mô‑đun robot/AGV sẽ phát triển sau; chỉ xem" sau cờ `ROBOT_CONTROL_ENABLED=false` (không gỡ mã) | 4 trang | Playwright: vào route thấy dải tạm dừng, không mutation |
| C0‑6 | `mqttClient.sendCommand` (`CHECK_UPDATE/RESTART_APP`) đóng băng cùng FactoryAlert (ẩn nút; server trả `MODULE_PAUSED`) | `MqttClientManagement.tsx` | |
| C0‑7 | Sửa bug MELSEC `machineId: adapterId` (`mitsubishiEngineeringAdapter.ts:174`) — một dòng, có test | | test đột biến |
| C0‑8 | Zmotion FFI: `zmotionBasicAdapter.deploy` trả `MODULE_PAUSED` (không gọi `ZmcLink`) tới khi 70 nối qua 50 | `zmotionBasicAdapter.ts:371-436` | test: deploy không chạm `zauxFfi` |

## 3. 40‑AL0 + 30‑T0 — phiên nền (không chạm scada)

| # | Việc | Nghiệm thu |
|---|---|---|
| AL0‑1 | Tắt đường `detectDefectSpike/detectYieldDrop` phát 5 user; THROUGHPUT_LOW chỉ bắn khi luồng MQTT từng sống trong 24 h trước cửa sổ — **XONG 04/11** (do-model 7072d4eda, nhánh alarm-telemetry) | **theo nguồn**: `notifications` 24 h có nguồn `detectDefectSpike`/`detectYieldDrop` = 0 và `mqtt_alert_history` THROUGHPUT_LOW khi không có luồng = 0 (không đếm tổng — ~15 nguồn hợp lệ khác vẫn ghi) |
| AL0‑2 | Sửa import `sendBulletinPushNotification` không tồn tại (`mqttService.ts:3250`) hoặc tắt bulletin | lỗi import = 0 |
| AL0‑3 | **Xoá dữ liệu lũ** (sau duyệt chủ dự án, số đếm trước/sau): `notifications` 56 433, `alert_escalations` 7 779, `predictive_alerts` + `_occurrences` 992 + 1 635, `mqtt_alert_history` 3 183; `machine_status_logs` 95 971 **chỉ sau khi 90 xác nhận OEE không đọc** `[cần kiểm]` | SQL đếm |
| T0‑1 | **HUỶ** (06/11): EMQX docker đang chạy (1884→1883), `:3000` có kết nối ⇒ giữ `UNS_BRIDGE_ENABLED=true`; tiền đề "không có broker" sai | — |
| T0‑2 | `topology.mjs` đã 36 máy; nguồn 1 699 máy × 30 s là `simOtTelemetryService` (gỡ ở E0‑2) ⇒ **đóng sau khi eng‑ai lên main + `:3000` bản mới + đo 24 h** — **07/11: 24 h sau 15:07:50 06/11 = 0 hàng** (nguồn 1 699 máy đã gỡ) nhưng **chưa đóng**: chưa có luồng 36 máy chạy để chứng minh tiêu chí | 24 h `ot_telemetry` giảm về mức 36 máy topology (hiện 18,97 M hàng/24 h) |
| T0‑3 | Một nguồn DDL Timescale: **không bỏ 0118/0172** (0172 tạo hypertable `measurement_results`); mig **0490** hoà giải làm lời cuối (no‑op trên DEV/_test); gỡ `timescale/0003` + `TSDB_URL` **chuyển sang 30‑T1** (pha 1) — **XONG 06/11**: mig 0490 áp DEV (reconciled 0, retention mismatch 0, 14 `job_id` không đổi), main a9a8c9405 | migration `--test-only` xanh; `timescaledb_information.jobs` một bộ chính sách/bảng |
| T0‑4 | `machine_health_history` + `rul_estimates` (1,8 GB): thêm retention 90 d **sau duyệt** (xoá cũ hơn) | kích thước < 200 MB |

## 4. 70‑E0 + 80‑F0 + 60‑Q0 — tho‑ca‑agent / phiên nền

| # | Việc | Nghiệm thu |
|---|---|---|
| E0‑1 | Dừng job `twinFidelity` + **xoá `simulation_runs`: XONG 06/11 — 84 127 → 0** (chủ dự án duyệt đúng số; job đã dừng) | bảng 0 hàng, job không chạy |
| E0‑2 | Gỡ `scripts/sim-factory/sim-live-daemon.mjs` INSERT thẳng DB + `simOtTelemetryService` (cờ `SIM_OT_TELEMETRY_*`); **giữ** 2 seeder dev chạy tay `seed.mjs`/`seed-production.mjs` (miễn trừ có tên, 70‑N1 sửa 04/11) | 70‑N1: grep INSERT trong `scripts/sim*` ∖ {2 seeder} = 0; không lịch/boot nào gọi seeder — **XONG 04/11** (tho-ca-agent) |
| E0‑2b | `simOtTelemetryService`: **chủ dự án chọn B (06/11) — GỠ**, chấp nhận ~1 660 máy DEV offline trên twin/dashboard tới 70‑E5 | gộp eng‑ai tiếp tục |
| E0‑3 | Gỡ router/procedure 0 caller — **đã gỡ 21** (04/11). **Giữ có lý do**: `orchestrationGov`/`twinGov` (có caller /synapse-platform — **chủ dự án chọn (a) 04/11: GỠ cả trang `/synapse-platform` + route + 2 router + `slaPolicy`/`dag`/`driftDetector`; redirect route cũ → 404/`/quan-tri/he-thong`**), `programming.deleteProject` (máy thử test phân quyền VRAM), `twin.status/twin.replay` (nợ Đợt 62 được ghim) | census 0 client‑caller trừ danh sách giữ |
| E0‑4 | **HOÃN sang pha 1 (70‑E1, cùng việc edge)**: `orchestration_run_edge_assignments` vào drizzle nằm trong `services/edge` (vùng cấm A2(o)); `runApiKeyIdentity.ts` là phép chiếu hẹp CÓ Ý, không phải khai trùng | — (dieu‑phoi 04/11) |
| E0‑5 | `RfTestCellSim` → một `sim_scenario` sau (giữ trang tới E2; xoá bình luận sai "0 lời gọi tRPC") | |
| F0‑1 | `vram_events`: xoá một lần > 30 d **đã làm 04/11** (55 887, còn 10 556); mục retention có trong `dataRetentionService` nhưng **mặc định TẮT** — chủ dự án chọn để tắt 06/11 (khoá `RETENTION_VRAM_EVENTS_DAYS` chú thích) | 80‑N8 (theo cấu hình) |
| F0‑2 | Gỡ router 0 client: `kbVector`, `aiVisionLanguage`, `aiSmartAlertRouting` (tRPC — **service giữ tới 40‑AL6**), `parameterGuardrail` (→ 50 đọc), `ntfClassifier`; sub‑router comment `aiAdvanced.{training,abTest,edge}` + `aiEdgeDeployment.ts`; **bảng `ab_test_*`, `batch_inference_*`, `training_batch_*` GIỮ** (còn mã sống — mig 0590 bỏ khỏi pha 0, quyết ở 80‑F4) | 80‑N9 |
| F0‑3 | `.env` 13 khoá trùng (phối hợp P0‑7); `.env.example` 5 nhóm cờ AI | |
| Q0‑1 | Gỡ router chết `inspectionVariant`, `mpVariantSubform`, `thresholdSuggestion`, `measurementSamples`, `spcConfig`; trang chết `SPCAdvanced`, `AnnotationStatistics`, `AnalyticsSettings`, mồ côi `ImageAnnotation`, `ImageComparison`, `BatchImageExport`, `ProductMachineMappingContent`, annotation helpers, `HistoryBatchOperations` (≈ 5 700 LOC) | 60‑N9 census |
| Q0‑2 | 6 công thức lệch về `shared/kpiYield.ts`; **"FPY" ở `productionDashboard` + `stationAnalysis` đổi từ proxy ok/total sang FPY THẬT theo serial ⇒ số hiển thị ĐỔI (thường thấp hơn)** — dieu‑phoi báo chủ dự án; ngưỡng yield ingest đọc cấu hình — **lô C xong 06/11** (tho-ca-agent 5ec7eefab, chờ kiem‑dinh) | 60‑N3 so khớp 3 bề mặt |
| Q0‑3 | `History` KPI tính server (tạm qua procedure hiện có trên toàn khoảng) — không tính trong trình duyệt | 60‑N4 |
| Q0‑4 | `qualityGateEvaluator`: pause/stop nay **chỉ là khuyến cáo** (event + alert), không tự đổi `machines.operationStatus` — xong 06/11. **Q0‑4b `acquisitionWorker` qua WAL: HOÃN sang pha 1 (60‑Q2)** — WAL phát lại không mang danh tính máy ⇒ lỗi vĩnh viễn; cần thiết kế riêng (danh tính trong bản ghi WAL) | test gate không UPDATE `machines` |
| Q0‑5 | `VACUUM FULL inspection_packages` (18 MB/0 hàng); **seed 13 236 KHÔNG xoá** — `product_inspections` là WORM (0279 REVOKE DELETE), chủ dự án chọn giữ 04/11 (60 §2.1‑13 sửa) | kích thước `inspection_packages` |

## 5. Thứ tự và song song

1. Ngày 1: dieu‑phoi commit tài liệu; mở 4 nhánh; kiem‑dinh đo "trước" (§9).
2. Ngày 1–3: P0‑1…P0‑6, C0‑1…C0‑8, AL0‑1/AL0‑2, T0‑1…T0‑3, E0‑3, F0‑2, Q0‑1…Q0‑4 song song (không chạm nhau; chạm `App.tsx`/`.env.example` thì dieu‑phoi giải xung đột).
3. Ngày 3–4: chủ dự án duyệt **danh sách xoá** (AL0‑3, T0‑4, E0‑1, F0‑1, Q0‑5) với số đếm trước; dieu‑phoi chạy bằng `aoi`, ghi số sau.
4. Ngày 4–5: P0‑7/F0‑3 (`.env` chủ dự án), P0‑8…P0‑11, E0‑1/E0‑2.
5. Ngày 5–7: gộp từng nhánh qua cổng đầy đủ; kiem‑dinh đo "sau"; ghi Nhật ký 10 module; cập nhật 00‑INDEX.

## 6. Việc chủ dự án trong pha 0

- Đổi `DATABASE_URL` sang `avi_app` khi P0‑1 sẵn sàng (dieu‑phoi báo); đặt `OT_CONTROL_ENABLED=false`; gỡ `cookies.txt`; áp diff `.env` 13 khoá trùng; duyệt 5 lần xoá dữ liệu.

## 7. Không làm trong pha 0

Đổi tên bảng, FK, timestamptz (pha 1–2); `site_id`/RLS (pha 1); vỏ/`ia.ts`/token (pha 2); mọi thứ trong `services/scada|ot/commandDispatcher|edge`; kênh socket (sau 1a); model/harness AI (sau GPU B).

## 8. Rủi ro

| Rủi ro | Giảm |
|---|---|
| `avi_app` thiếu quyền trên bảng mới ⇒ 500 im lặng | chạy suite DB đầy đủ bằng `avi_app` trên `_test` trước; script cấp quyền idempotent chạy sau mỗi migration |
| Admin mất truy cập khi hết bypass | seed quyền đủ cho admin trước khi bật; test đăng nhập 10 admin |
| CSP chặn tài nguyên hợp lệ (fonts, worker, blob 3D) | chế độ `report-only` 1 ngày trên nhánh, đọc báo cáo, rồi enforce |
| Xoá nhầm dữ liệu thật | mọi lệnh xoá có `WHERE` theo bảng rác, đếm trước/sau, chỉ trên `aoi_management` dev (Đ‑28: kèm `current_database()`) |

## 9. Số đo trước/sau (kiem‑dinh)

route sống · trang không import · router 0 client · `notifications` 24 h **theo nguồn** (2 bộ dò = 0) + `mqtt_alert_history` THROUGHPUT_LOW không luồng = 0 · kích thước 6 bảng rác · `ot_telemetry` hàng/24 h · cửa lệnh ngoài dispatcher (census) · `rolsuper/rolbypassrls` của app · lỗi CSP console · cỡ bundle client · số khoá `.env` trùng.

## 10. Kết quả lô xoá dữ liệu (dieu‑phoi 2026‑11‑04, DEV `aoi_management`, avi_app, --test-only trước)

| Mục | Trước | Xoá | Còn | Ghi chú |
|---|---|---|---|---|
| AL0‑3a `notifications` | 56 460 | 56 460 | 0 | |
| AL0‑3b `alert_escalations` | 7 779 | 7 779 | 0 | |
| AL0‑3c `predictive_alerts` EXPIRED (+ occurrences cascade) | 992 + 1 635 | 992 + 1 635 | 0 | |
| AL0‑3d `mqtt_alert_history` | 3 219 duyệt | 3 221 | 0 | lệch +2: rule bắn mù tới lúc xoá; **luật mới: khoá bằng số đã duyệt**, lệch ⇒ dừng và hỏi |
| F0‑1 `vram_events` > 30 d | 66 443 | 55 887 | 10 556 | chủ dự án đặt `RETENTION_VRAM_EVENTS_DAYS=30` sau gộp eng‑ai |
| T0‑4a `machine_health_history` > 90 d | 2,88 M | 77 798 | 2 801 600 | vẫn ≈ 1 GB — < 200 MB chỉ ở 30‑T8 |
| T0‑4b `rul_estimates` > 90 d | 2,86 M | 55 207 | 2 799 905 | như trên |
| E0‑1 `simulation_runs` | 84 127 (duyệt 06/11) | 84 127 | 0 | xoá sau khi job fidelity dừng (`:3000` bản main 45ee3b777), đếm 2 lần cách 6 phút không đổi, khoá bằng số đã duyệt |
| Q0‑5 seed `product_inspections` | 13 236 | 0 (giữ) | 13 236 | WORM; chủ dự án chọn giữ |
| `machine_status_logs` | 95 971 | — | — | không đưa vào: OEE đang đọc |
