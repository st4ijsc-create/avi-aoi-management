# Nhánh B — Ngang tầm hệ thống AI phân tích chuyên nghiệp (kế hoạch chi tiết)

> Tạo 2026-05-31. Nguồn: phân tích GAP (3 agent rà soát) + 3 agent kiến trúc sư (đã xác minh file:line).
> Phạm vi đợt này (chốt với chủ dự án): **Tier 1+2 code thật + degrade**, **Tier 3 (B7,B9) plan-only**, **B8 scaffolding Python sidecar**.

## Phát hiện quan trọng khi lập kế hoạch
Audit `knowledge/domain/AI_ANALYTICS_MODULE_AUDIT.md` (2026-05-05) đã được áp dụng phần lớn — số dòng cũ không còn khớp. Trạng thái THẬT (đã verify code):
- N+1 correlation/pareto: **đã fix** (1 query GROUP BY + cache; `Promise.all`).
- Forecast cửa sổ ngắn: **đã phân tầng** HW/EWMA/Linear; còn 2 bug nhỏ thật.
- Report nuốt exception: **đã fix** ở `generateNarrative`; còn `catch {}` trống ở `generateOfflineNarrative`.
- Cpk: **công thức đúng** nhưng **dùng sai nguồn spec-limit** (LOGIC-002 thật).

---

## TIER 1 — Thuần code

### B1 — Sửa nợ kỹ thuật số liệu
**B1.1 Cpk (LOGIC-002 thật):** `aiInspectionAnalytics.ts:1135-1137` công thức đúng nhưng caller `aiInspectionAnalyticsRouter.ts:188` KHÔNG truyền `specLimits` → yield mặc định USL=100/LSL=0 (đo "độ căn giữa", không phải năng lực theo spec). Tồn tại hàm chuẩn `server/utils/spc.ts:calculateCapabilityIndices` (xử lý spec một phía Cpu/Cpl) nhưng KHÔNG được tái dùng. Box-Cox `:1125` biến đổi values nhưng có lúc không biến đổi spec → lệch thang.
→ **Sửa:** lookup USL/LSL/nominal từ `measurementPointDefs` ở router (như `spcAdvancedRouter.ts:503-511`), truyền vào `getControlChart`; tái dùng `calculateCapabilityIndices`; khi không có spec → `cpk=null` + `cpkNote` (i18n, KHÔNG bịa USL=100). Sửa guard Box-Cox.
**B1.2 Forecast:** `forecastWithHoltWinters:673` BỎ QUA tham số `confidence` (ghi đè bằng `1-h*0.03` cứng). → dùng `confidence` làm trần + decay theo `stdError` thật; `seasonLength` chỉ kích hoạt khi `data.length≥2*seasonLength`.
**B1.3:** `aiReportGenerator.ts:177` `catch {}` trống → log cảnh báo.
**Tests:** Cpk khớp Six Sigma (μ=100,σ=2,USL=106,LSL=94→Cpk=1.0; lệch tâm→0.667); one-sided→Cpk=Cpu; no-spec→null; forecast theo cửa sổ; Box-Cox không NaN. **Nghiệm thu:** AI analytics & `spcAdvancedRouter.capability` cho cùng Cpk. **Migration:** không bắt buộc (tùy chọn ghi `cpkHistory` đã có).

### B2 — Confidence calibration (ECE + reliability diagram)
Temperature scaling đã có (`aiInferenceEngine.ts:213`) nhưng `temperatureScale` đọc qua `as any` (không có trong type) → thực tế T=1. → Thêm `temperatureScale?` vào type `postprocessConfig` (additive); service `aiCalibration.ts`: `computeECE` (M bins), reliability diagram, `fitTemperature` (1-D min NLL), `collectCalibrationSamples` (từ `aiQualityGateResults` + reviewDecision). Bảng mới `ai_calibration_reports` (ece/mce/brier/temperature/reliabilityBins JSON). Router `aiCalibrationRouter` + UI `ReliabilityDiagram.tsx` trong AIPerformanceDashboard.
**Tests:** ECE tính tay khớp (perfect→~0; overconfident conf=1/acc=0.5→0.5); fitTemperature giảm ECE; N=0→null. **Migration:** `ai_calibration_reports` (drizzle-kit generate). **Lưu ý:** engine chỉ trả top-K prob (không full logits) → fit T offline hoặc xấp xỉ confidence top-1, ghi rõ giới hạn.

### B6 — A/B canary live
A/B engine đầy đủ (`aiABTesting.ts`) nhưng chạy batch, KHÔNG trong luồng live. **2 bug field-name thật:** `runABInference:111-113` ghi `modelAInferenceCount` nhưng cột là `modelAInferences` → counter không tăng (ép `as any` ở `db/aiAdvanced.ts:118`); `concludeExperiment:233-235` `modelAAvgLatencyMs` vs cột `modelAAvgLatency`. → Sửa field-name; routing **deterministic theo hash(inspectionId)** thay `Math.random` (idempotent cho offline sync); thêm `activeExperimentId` (nullable) vào `aiQualityGateConfigs`; `processQualityGate` nhánh canary (chọn variant, ghi `abTestResults` + `aiQualityGateResults`); `evaluateCanaryGuardrail` (auto-rollback khi accuracy_B < accuracy_A−δ) + `promoteWinner`.
**Tests:** chia traffic ~%; cùng inspectionId→cùng variant; counter=total; winner chi-squared p<0.05; guardrail rollback. **Migration:** `ALTER ... ADD activeExperimentId` (additive). **Nghiệm thu:** config không gắn experiment → hành vi y hệt cũ.

---

## TIER 2 — Code chạy được + DEGRADE trung thực (kết quả thật cần model ONNX)

> Môi trường: có `onnxruntime-node@1.24.3` (inference-only, KHÔNG gradient), `sharp@0.34.5`, GGUF; KHÔNG có OpenCV/jimp/autograd. Mọi degrade trả cờ rõ (`source`/`degraded`/`method`/`aligned`/`embeddingSource`) để UI nói đúng sự thật.

### B3 — Anomaly detection không nhãn (PatchCore-style)
Memory bank embedding ảnh OK + kNN distance; threshold = percentile phân bố khoảng cách OK (p99). Nguồn embedding 3 tầng degrade: **ONNX** (thật) → **GGUF text-of-image** (degraded, đánh dấu) → **heuristic sharp** (histogram+Laplacian+edge grid, `degraded:true`). Scope theo `(productModelId, machineId, modelCode)`. Coreset subsample thuần JS.
**Files:** `aiAnomalyDetection.ts`, `db/aiAnomaly.ts`, `aiAnomalyRouter.ts` (mới); hook best-effort trong `aiQualityGate.ts` sau cờ `ANOMALY_DETECTION_ENABLED` (default off). **Migration** `0092_*`: `ai_anomaly_memory_bank` + `ai_anomaly_profiles` (idempotent, `embedding_vec` + HNSW bọc EXCEPTION). **Tests:** thuật toán (gần→score thấp, xa→anomaly); degrade (DB null/GGUF off→heuristic/không crash).

### B4 — Visual embedding ONNX mặc định + golden-sample alignment
**B4.1:** image search mặc định hiện là text-of-image. → `resolveDefaultImageEmbeddingModel()`: nếu có model ONNX `embedding` active → dùng; không → text-of-image. Env `IMAGE_EMBEDDING_DEFAULT=onnx|text`. **Ràng buộc không gian vector:** ONNX khác chiều (512/2048) ≠ 1024 → lọc theo `modelCode`+`embeddingDim`; ONNX-dim rơi xuống exact-cast/brute-force (HNSW chỉ cho 1024) — degrade hiệu năng trung thực. Trả `embeddingSource`. Cần re-embed lịch sử để search ONNX có ý nghĩa.
**B4.2 alignment:** trước pixel-diff (`aiAdvancedVision.ts:248-307`) căn chỉnh test↔golden. Thuần JS/sharp: **phase correlation (FFT)** cho translation + **coarse rotation search** ±5°; hoặc **template matching NCC** (không thêm dep). Opt-in cờ `ALIGN_BEFORE_DIFF` (default off); confidence thấp → `aligned:false` dùng diff cũ. **Giới hạn cứng:** sharp không warp affine tổng quát → chỉ bù rotate+translate(+scale đều), KHÔNG skew/perspective.
**Files:** `aiImageEmbedding.ts`, `aiImageSearchRouter.ts`, `imageAlignment.ts`(mới), `aiAdvancedVision.ts`, UI. **Migration:** tùy chọn index `(modelCode,embeddingDim)`.

### B5 — XAI heatmap thật (thay pixel-diff)
**onnxruntime-node KHÔNG có gradient → Grad-CAM "thật" bất khả thi.** 3 tầng degrade (đặt tên method ĐÚNG sự thật):
1. Model expose `feature_map` output → **CAM / Score-CAM** (Score-CAM không cần gradient, chỉ forward lại — KHUYẾN NGHỊ), `degraded:false`.
2. Model classifier không feature map → **occlusion sensitivity** (che ô lưới đo sụt confidence), `method:"occlusion"`, `approximate:true` (vẫn XAI thật của model).
3. Không model → **pixel-diff cũ**, `method:"pixel-diff"`, `degraded:true`.
**Files:** `aiExplainability.ts`(mới), `aiInferenceEngine.ts` (thêm `runInferenceWithFeatureMap`, không đổi `runInference`), `aiAdvancedVisionRouter.ts` (procedure `explainHeatmap`), UI. **Lưu ý:** phần lớn model hiện không export feature map → thực tế chạy nhánh occlusion (chậm hơn, giới hạn top-K/downscale).

---

## TIER 3 — Cần môi trường (plan-only) + B8 scaffolding

### B7 — Segmentation + đo sub-pixel metrology (PLAN-ONLY)
Cần model segmentation ONNX (U-Net/DeepLab/YOLO-seg) + nhãn mask pixel (chưa có trong DB) + GPU (B9) + train qua sidecar (B8). Thêm `outputType:"segmentation"` vào `aiInferenceEngine`, service `aiMetrology.ts` (contour sub-pixel iso-0.5, Feret, area, calibration µm/pixel), bảng `defect_segmentations`, UI overlay mask. **Chỉ chạy thật khi có model+nhãn+GPU.**

### B8 — Deep training Tier-2 Python sidecar (PLAN + SCAFFOLDING)
`dispatchTier2():never` (`aiTrainingPipeline.ts:247`) hiện ném lỗi; `runTrainingPipeline` Stage 2 (`:133-156`) luôn đi Tier 1, chưa đọc `trainingMode`. Schema job đã đủ cột (không cần migration).
**Giao thức file-based:** server `buildDataset` → ghi `uploads/training/jobs/<jobId>/job.json` → spawn `LOCAL_TRAINER_CMD <jobDir>` (KHÔNG shell) → poll `progress.json` → đọc `result.json`+`output/model.onnx` → Stage 3-6 (eval/gate/activate) **tái dùng nguyên** (gate là nguồn sự thật, không tin metrics sidecar).
**Scaffolding tạo:** `tools/trainer/train.py` (đặc tả: load manifest JSONL, train, ghi progress atomic, export ONNX) + `requirements.txt` + `README.md`; `server/services/localSidecarTrainer.ts` (`isSidecarEnabled`, `runSidecarTraining`→`LocalTrainingResult`); sửa `dispatchTier2` async + rẽ nhánh `trainingMode==="local-sidecar"` trong Stage 2. Opt-in: chỉ chạy khi `LOCAL_TRAINER_CMD` set. Mặc định KHÔNG đổi hành vi.
**Tests (mock spawn/fs):** opt-out mặc định→Tier 1; happy path→progress tăng+eval/gate với outputModelPath; job.json shape; failure→FAILED; progress đọc dở→bỏ qua. **Hợp đồng job.json/progress.json/result.json** chi tiết trong kế hoạch agent (result.metrics khớp `LocalTrainingResult.finalMetrics`).

### B9 — GPU/TensorRT verification + batch (PLAN-ONLY)
`aiInferenceEngine.ts:42-54` đã có EP TensorRT→CUDA→CPU qua `ENABLE_TENSORRT`/`ENABLE_CUDA`. Cần host GPU NVIDIA + ORT biến thể GPU + CUDA/cuDNN/TensorRT khớp version để verify (npm ORT mặc định thường chỉ CPU). Việc khi có GPU: health endpoint verify EP active (không chỉ configured), `runInferenceBatch` + `AI_INFER_MAX_BATCH` (default 1), benchmark p50/p95+throughput CPU vs CUDA vs TRT, TensorRT engine cache. **Cần môi trường GPU.**

---

## Ràng buộc chung
Offline-first · backward-compatible (cột nullable/additive, cờ env default-off, hàm mới không đụng `runInference`/`generateDefectHeatmap`/`searchByImage`/Tier-1 cũ) · degrade trung thực (cờ rõ, không bịa) · đa ngôn ngữ vi/en/zh · migration idempotent (`DO $$ EXCEPTION`, pgvector optional).

---

## ✅ KẾT QUẢ TRIỂN KHAI NHÁNH B (2026-05-31)
Phạm vi đã chốt: Tier 1+2 code thật + degrade; Tier 3 (B7,B9) plan-only; B8 scaffolding Python sidecar.

| WS | Nội dung | Test | Typecheck |
|---|---|---|---|
| **B1** | Cpk dùng đúng spec-limit (tái dùng `spc.ts`), forecast tôn trọng `confidence`, report log lỗi | 10/10 (+49 regression) | 0 lỗi mới |
| **B8** | Scaffolding sidecar Python (`localSidecarTrainer.ts` + `tools/trainer/`), `dispatchTier2` async, opt-in | 14/14 | 0 lỗi mới |
| **B6** | A/B canary live: sửa 2 bug field-name, routing hash idempotent, canary trong quality gate, guardrail/promote | 19/19 | 0 lỗi mới |
| **B2** | ECE + reliability diagram + fitTemperature (xấp xỉ confidence top-1), bảng `ai_calibration_reports` | 12/12 | 0 lỗi mới |
| **B3** | Anomaly không nhãn (PatchCore-style kNN, 3 tầng embedding degrade), bank + profile | 18/18 | 0 lỗi mới |
| **B4+B5** | Visual embedding ONNX mặc định (degrade text-of-image) + golden-sample alignment (NCC) + XAI heatmap 3 tầng (Score-CAM→occlusion→pixel-diff) | 33/33 (+28 regression) | 0 lỗi mới |
| **Tổng** | | **80/80 PASS** | **0 lỗi type mới** |

### Migration mới (additive, idempotent)
`0107` (canary `activeExperimentId`) · `0108` (calibration reports) · `0109` (anomaly bank+profile) · `0110` (index modelCode,embeddingDim).

### Tier 3 plan-only (chưa code, chờ môi trường)
- **B7 Segmentation + sub-pixel metrology:** cần model segmentation ONNX + nhãn mask + GPU + train qua B8.
- **B9 GPU/TensorRT:** cần host GPU NVIDIA + ORT biến thể GPU + CUDA/cuDNN/TensorRT.

### ⚠️ Cần con người để có "kết quả thật" (Tier 2 degrade-safe)
- **B2:** đủ mẫu Quality Gate đã review (reviewDecision) để ECE ổn định; temperature scaling chính xác cần engine xuất full logits (hiện xấp xỉ top-1).
- **B3:** model ONNX embedding + build memory bank từ ảnh OK (hiện degrade về text-of-image/heuristic, cờ `ANOMALY_DETECTION_ENABLED` default off).
- **B4.1:** model ONNX embedding active + re-embed ảnh lịch sử + `IMAGE_EMBEDDING_DEFAULT=onnx` (mặc định text → y hệt cũ).
- **B4.2:** bật `ALIGN_BEFORE_DIFF=true`; giới hạn: chỉ bù rotate+translate, KHÔNG skew/perspective (sharp).
- **B5:** model expose feature-map output để Score-CAM (`degraded:false`); phần lớn model hiện chạy nhánh occlusion (chậm hơn).
- **B8:** cài Python/PyTorch + hoàn thiện `build_dataset/train_loop/export_onnx` trong `tools/trainer/train.py`; set `LOCAL_TRAINER_CMD`.
- Chạy migration `0107–0110` + (B2/B3) khi dùng các tab mới.

### Degrade trung thực
Mọi tính năng Tier 2 trả cờ rõ (`embeddingSource`/`source`/`degraded`/`method`/`aligned`/`approximate`) — UI nói đúng sự thật, KHÔNG quảng cáo "Grad-CAM" khi là occlusion/pixel-diff, không bịa kết quả khi chưa có model.
