# WS-1 — Khép vòng AI tự học (Training Pipeline + Active Learning)

> Quyết định đã chốt: **Tầng 1 thuần Node (offline 100%)**. Tầng 2 sidecar Python là tùy chọn tương lai, mặc định TẮT.

## 1. Mục tiêu
Khép kín vòng tự học AOI chạy hoàn toàn LOCAL: inference → tự phát hiện ảnh khó (uncertainty/committee) → đẩy vào `ai_label_queue` → người gán nhãn → tổng hợp dataset (train/val/test) → train local → eval harness đo accuracy/precision/recall trước-sau → tạo `model_versions` mới → activate có quality-gate. Bỏ stub mô phỏng và phụ thuộc `TRAINING_SERVICE_URL`.

## 2. Hiện trạng (file:line)
- `server/services/aiTrainingPipeline.ts:150-185` — nhánh "Simulated Training" sinh loss/accuracy bằng `Math.random`.
- `aiTrainingPipeline.ts:81-149` — nhánh thật phụ thuộc `process.env.TRAINING_SERVICE_URL` (cloud) → vi phạm offline-first.
- `aiTrainingPipeline.ts:193-198` — `validationMetrics` bịa từ `bestAccuracy * 0.98`. Không có eval harness.
- `aiTrainingPipeline.ts:200-211` — COMPLETED nhưng KHÔNG ghi `model_versions`, không activate → vòng lặp hở.
- `server/db/aiAdvanced.ts:393-403` — `getTrainingDataStats` không lọc theo model (bảng `ai_feedback` không có cột `modelId`).
- `server/services/aiLocalTraining.ts` — có code train thật (transfer/few-shot/incremental, softmax SGD, confusion, PRF1) NHƯNG import sai (`aiInferenceResults`/`aiAnnotations` không tồn tại; đúng phải là `inferenceResults`/`imageAnnotations`), tham chiếu cột không tồn tại (`aiFeedback.modelId`, `productInspections.imagePath`). Router `aiLocalTrainingRouter` bị **DISABLED** ở `routers.ts:83,407`.
- `server/services/aiActiveLearning.ts:31-130` — `autoLabelImages` tính entropy đúng nhưng phải gọi thủ công, không tự quét `inference_results`.
- Eval harness: **không tồn tại**.
- `server/_core/trpc.ts` — không có `licenseProcedure`; gating phải kiểm trong thân procedure.

## 3. Thiết kế (Tầng 1 — thuần Node)
Dùng backbone ONNX/feature-extractor có sẵn (đóng băng) → train lớp classifier softmax/prototype bằng SGD thuần JS (tái dùng `aiLocalTraining.ts`). Output: file JSON classifier (`uploads/models/trained/*.json`) → đăng ký `model_versions`. Chạy mọi máy CPU, offline tuyệt đối.
> Bỏ hẳn nhánh `TRAINING_SERVICE_URL`. Tầng 2 (sidecar Python qua `LOCAL_TRAINER_CMD`) chỉ bật khi env set; mặc định tắt.

### 3.1 Nguồn label THẬT (ánh xạ đúng schema)
1. `ai_label_queue` trạng thái `LABELED`/`AUTO_LABELED`: `imageUrl` + `humanLabel`/`predictedLabel` + `modelId` (nguồn chính).
2. `ai_feedback` ⋈ `ai_suggestions` (qua `suggestionId`) → `inspectionId`, `modelName`, `correctedValue`. Ảnh lấy từ `measurement_results.imageUrl` (KHÔNG dùng `productInspections.imagePath` — không tồn tại).

### 3.2 Vật chất hóa dataset + split
`buildDataset(datasetId)`: tổng hợp `{imageUrl, label, source}`, khử trùng, stratified split theo `splitConfig` với seed cố định. Ghi manifest JSONL `uploads/datasets/<id>/{train,val,test}.jsonl`, cập nhật `trainingDatasets.storageKey/totalSamples/labelDistribution/status`. Val/test KHÓA để eval before/after công bằng.

### 3.3 Eval harness (mới) `server/services/aiEvalHarness.ts`
- `evaluateModelVersion(...)`: confusion matrix + accuracy + macro/micro P/R/F1.
- `compareBeforeAfter(...)`: chạy cùng test split cho baseline + candidate, trả delta, ghi `model_versions.metrics`.
- **Quality gate**: candidate chỉ activate nếu accuracy ≥ baseline − ε (mặc định 0). Fail → giữ `status=READY`, tạo cảnh báo.

### 3.4 Active learning tự động `server/services/aiActiveLearningAuto.ts`
- `scanInferenceForUncertainty`: quét `inference_results`, tính entropy, đẩy ảnh ≥ ngưỡng vào `ai_label_queue` (UNCERTAINTY). Idempotent (unique index).
- `scanCommitteeDisagreement`: với ensemble, tính disagreement, ghi `ensembleDisagreement`/`ensemblePredictions` (cột đã có), COMMITTEE.
- Lập lịch định kỳ theo mẫu scheduler hiện có, tôn trọng license + offline.

## 4. Các bước triển khai
1. Sửa schema-mismatch nền tảng trong `aiLocalTraining.ts` (import + nguồn dữ liệu); sửa `getTrainingDataStats` lọc theo model.
2. Tách `server/services/aiMetrics.ts` (softmax/argmax/PRF1/confusion) dùng chung.
3. Viết `aiEvalHarness.ts`.
4. Viết `aiDatasetBuilder.ts` (split JSONL).
5. Viết `aiActiveLearningAuto.ts`.
6. Viết lại `runTrainingPipeline` (bỏ cloud + simulated; dispatch Tầng 1; gọi eval; tạo+activate theo gate).
7. (Hoãn) `localSidecarTrainer.ts` — Tầng 2 tùy chọn.
8. Bật lại `aiLocalTrainingRouter` sau khi sửa schema; mount router eval/auto.
9. Scheduler auto active-learning + auto-retrain (cờ env bật/tắt).
10. License gating helper cho procedure train/auto.
11. UI (xem mục 5).
12. Tests Vitest + i18n Vi/En/Zh.

## 5. Files
**Tạo:** `server/services/aiMetrics.ts`, `aiEvalHarness.ts`, `aiDatasetBuilder.ts`, `aiActiveLearningAuto.ts`, `server/routers/aiEvalRouter.ts` (hoặc gộp `aiAdvancedRouter`).
**Sửa (server):** `aiTrainingPipeline.ts`, `aiLocalTraining.ts`, `db/aiAdvanced.ts`, `db/ai.ts`, `aiActiveLearning.ts`, `routers.ts`, `routers/aiActiveLearningRouter.ts`, `routers/aiAdvancedRouter.ts`, `routers/aiModelRouter.ts`.
**Sửa (client):** `AIActiveLearningPage.tsx` (nút tự quét ảnh khó), `AIPerformanceDashboard.tsx` (before/after + confusion), `ModelVersionsPage.tsx` (metrics + activate gate), `AIModelManagementPage.tsx` (khởi tạo job), `AIDataProcessingPage.tsx` (dataset). i18n vi/en/zh.

## 6. Migration Drizzle (additive, nullable)
- `model_versions`: + `datasetId`, `baselineVersionId`, `evalReport json`.
- `training_jobs`: + `datasetId`, `trainingMode varchar` ("local-embedding"|"local-sidecar").
- `ai_label_queue`: partial unique index `(modelId, inspectionId, measurementResultId)` chống trùng auto-scan (dọn trùng trước khi tạo).
- Kiểm tra `samplingStrategyEnum` có `UNCERTAINTY/COMMITTEE/DIVERSITY`.

## 7. Tests Vitest
`aiMetrics.test.ts`, `aiEvalHarness.test.ts` (gate chặn khi accuracy giảm), `aiDatasetBuilder.test.ts` (split tái lập), `aiActiveLearningAuto.test.ts` (idempotent), `aiTrainingPipeline.test.ts` (e2e Tầng 1), router tests, regression `aiLocalTraining` build sạch.

## 8. Nghiệm thu
1. Bỏ hoàn toàn `TRAINING_SERVICE_URL`/simulated; pipeline chạy offline tạo version thật.
2. Chu trình đầy đủ: inference → auto-scan đẩy ảnh khó → gán nhãn → build dataset → train → eval val+test → version có metrics thật → activate khi pass gate.
3. Eval báo accuracy/P/R/F1 + confusion; before/after dùng chung test split; gate chặn khi giảm.
4. `aiLocalTrainingRouter` bật lại, build sạch.
5. UI hoạt động; i18n đủ Vi/En/Zh; không hồi quy API máy.

## 9. Rủi ro
- Schema-mismatch (rủi ro cao nhất): phải sửa Bước 1 trước khi wiring router.
- Tầng 1 không cải thiện backbone → defect khác phân bố mạnh có thể không tăng accuracy (gate sẽ chặn — đúng kỳ vọng; cần Tầng 2 sau).
- Tránh contention VRAM khi eval hàng loạt: tái dùng LRU session cache, concurrency=1.
- Chuẩn hóa label đa ngôn ngữ (trim/normalize) tránh "xước"≠"Xước".
- Index unique mới phải partial; dọn dữ liệu trùng trước.

## Critical files
`server/services/aiTrainingPipeline.ts` · `aiLocalTraining.ts` · `aiActiveLearning.ts` · `server/db/aiAdvanced.ts` · `drizzle/schema/ai.ts`

---

## ✅ KẾT QUẢ TRIỂN KHAI (2026-05-30) — CỐT LÕI HOÀN TẤT (UI 2/5, chờ môi trường nghiệm thu E2E)

### Files đã tạo/sửa
**Tạo (server):** `aiMetrics.ts` (softmax/entropy/confusion/P-R-F1, chuẩn hóa nhãn NFC+trim+lowercase, seed PRNG) · `aiDatasetBuilder.ts` (gộp 2 nguồn, khử trùng, stratified split + seed, manifest JSONL) · `aiEvalHarness.ts` (evaluate/compareBeforeAfter/qualityGate ε=0) · `aiActiveLearningAuto.ts` (scan uncertainty + committee, idempotent) · `aiSelfLearningScheduler.ts` (cron, cờ env, tắt mặc định) · `routers/aiEvalRouter.ts` · 4 test Vitest · `drizzle/0104_ws1_ai_self_learning.sql`.
**Sửa (server):** `aiLocalTraining.ts` (**sửa schema-mismatch** import + `collectLabeledData` 2 nguồn thật) · `db/aiAdvanced.ts` (`getTrainingDataStats` lọc theo model) · `aiTrainingPipeline.ts` (**bỏ hẳn `TRAINING_SERVICE_URL`+simulated**; luồng buildDataset→train Tầng 1→eval→gate→version→activate; Tầng 2 = stub `dispatchTier2()`) · `routers.ts` (bật lại `aiLocalTrainingRouter` + mount `aiEvalRouter`) · `_core/index.ts` (scheduler) · `drizzle/schema/ai.ts` (cột nullable mới).
**Sửa (client):** `AIActiveLearningPage.tsx` (nút "Tự quét ảnh khó" uncertainty/committee + cột samplingStrategy/ensembleDisagreement) · `ModelVersionsPage.tsx` (metrics thật + Quality Gate + cảnh báo activate version trượt gate). i18n `al.*`/`mv.*` đủ vi/en/zh.

### Xác minh
- **Test:** 4 file, **33/33 PASS** — gồm: gate chặn khi accuracy giảm, split tái lập + stratified + "xước"="Xước", scan idempotent (chạy 2 lần không nhân đôi).
- **Typecheck:** 0 lỗi mới ở file WS-1; còn **giảm 12 lỗi tiền tồn** (306→294) nhờ sửa `aiLocalTraining`.

### Cần con người làm tiếp
1. Chạy migration thật `node scripts/migrate-standalone.mjs` (đã dedup trước khi tạo partial unique index).
2. Training/eval thật cần ONNX backbone + ảnh trong `uploads/`.
3. **License per-procedure:** repo không có `licenseProcedure` trong tRPC → dùng `adminProcedure` cho action đặc quyền + ghi TODO trong `aiEvalRouter.ts`.
4. **UI hoãn 3/5 (backend đã sẵn endpoint):** `AIPerformanceDashboard.tsx` (biểu đồ before/after + confusion), `AIDataProcessingPage.tsx` (tạo/xem dataset split), `AIModelManagementPage.tsx` (khởi tạo job qua `aiEval.startPipeline`). Cần thêm model selector (nút scan đang hard-code modelId=1 như code cũ).

### Sai khác so với plan (theo sự thật schema)
- `getTrainingDataStats` lọc qua `ai_suggestions.modelName` (vì `ai_feedback`/`ai_suggestions` không có `modelId`).
- Dataset status dùng `PROCESSING` (theo `batchJobStatusEnum`).
- `samplingStrategyEnum` đã có UNCERTAINTY/DIVERSITY/COMMITTEE → không cần thêm enum.
- Tầng 2 chỉ stub (đúng quyết định đã chốt).

### Nghiệm thu
| Tiêu chí | Trạng thái |
|---|---|
| Bỏ TRAINING_SERVICE_URL/simulated, pipeline offline tạo version thật | ✅ Code đạt; ⏳ E2E cần ONNX+DB |
| Chu trình inference→scan→nhãn→dataset→train→eval→version→activate-gate | ✅ Code đạt; ⏳ E2E cần môi trường |
| Eval accuracy/P/R/F1+confusion, before/after cùng test split, gate chặn khi giảm | ✅ Đạt (có test chứng minh) |
| `aiLocalTrainingRouter` bật lại, build sạch | ✅ Đạt |
| UI + i18n vi/en/zh, không hồi quy API máy | ✅ 5/5 trang + i18n đủ (xem cập nhật bên dưới) |

### 🔄 Cập nhật UI (2026-05-30, đợt 2) — hoàn thiện 3 trang còn lại
- `AIDataProcessingPage.tsx`: tab "Dataset Split" → `aiEval.buildDataset` (totalSamples + labelDistribution + tỉ lệ train/val/test).
- `AIPerformanceDashboard.tsx`: tab "Eval (Before/After)" → `aiEval.compareBeforeAfter` (Recharts bar accuracy/P/R/F1 baseline vs candidate + quality gate badge + confusion matrix).
- `AIModelManagementPage.tsx`: `TrainingPipelineDialog` (model selector qua `aiModel.list`, KHÔNG hard-code) + `TrainingJobsList` (`aiLocalTraining.listJobs`, auto-refresh) → `aiEval.startPipeline`.
- Tạo `client/src/components/ai/ModelSelect.tsx` (ModelSelect + DatasetSelect dùng chung). i18n `aiEval.*`/`aiDataProcessing.dataset.*` đủ vi/en/zh.
- **Caveat:** endpoint list dataset chưa được mount (`trainingRouter` đang comment) → DatasetSelect dùng ô nhập Dataset ID; khi mount `trainingRouter` chỉ cần đổi sang dropdown `aiAdvanced.listDatasets`.
- Typecheck: 0 lỗi mới (4 lỗi `TFunction` ở `AIModelManagementPage` là tiền tồn, xác minh bằng `git stash`).
