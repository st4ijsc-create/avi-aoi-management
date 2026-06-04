# Đánh giá lại toàn bộ module "AI Analysis / Phân tích dữ liệu + hình ảnh bằng AI" — 2026

> Ngày: 2026-06-04 · Phạm vi: sau Phase 190–192 + Nhánh A (local GGUF) + Nhánh B (Tier 1+2 code thật, Tier 3 B7/B8 đã làm).
> Nguồn: đọc trực tiếp code (`server/services/ai*.ts`, `server/routers/*`, `drizzle/schema/*`) + đối chiếu `docs/upgrade-2026/{00-OVERVIEW, BRANCH-A, BRANCH-B, RUNBOOK-tier3}.md`.
> Nguyên tắc: **TRUNG THỰC** — phân biệt rõ [THẬT chạy được] / [STUB] / [DEGRADE khi thiếu model] / [DEPRECATED]. Không phóng đại.

---

## 1. Tóm tắt điều hành

Hệ thống đã chuyển AI sang **100% local** một cách thực chất: không còn nhánh cloud nào được gọi ở runtime (`aiProviderRouter.ts:4` — OpenAI branch removed; `aiProviderManager.ts:27` — openai luôn `available:false`; `aiTrainingPipeline.ts:14` — bỏ `TRAINING_SERVICE_URL`). Lõi phân tích dữ liệu (SPC/Cpk/Pareto/forecast/correlation), time-series, predictive maintenance, RAG/report/RCA, quality gate + A/B canary, calibration là **code THẬT chạy offline ngay**.

Nhóm thị giác sâu (anomaly không nhãn, visual embedding ONNX, XAI heatmap, segmentation + metrology) đã có **code thuật toán THẬT** nhưng phần lớn đang ở trạng thái **DEGRADE trung thực** vì **chưa có model ONNX vision/embedding/segmentation thật** trong hệ thống — đây là giới hạn dữ liệu/môi trường, không phải lỗi code. Hệ thống báo cờ degrade rõ ràng (`source`/`degraded`/`method`/`aligned`), không bịa kết quả.

**3 phát hiện cần xử lý nhất:**
1. **A/B Canary (B6) backend THẬT + đang nối vào luồng quality gate live** (`aiQualityGate.ts:362,504`) nhưng **UI đã bị gỡ hoàn toàn** (`ABTestingPage.tsx` chỉ còn thông báo "ngừng hỗ trợ"). → Năng lực live không thể vận hành/giám sát qua UI: hoặc làm UI tối giản, hoặc gỡ hẳn cho nhất quán.
2. **Vision (mô tả/OCR/so sánh ảnh)** phụ thuộc sidecar `llama-server` + Qwen2-VL — **chưa chạy thật** cho tới khi con người cung cấp binary + model. Hiện degrade về text-only. Đây là "trái tim" của AI thị giác mà nhiều module khác (B3 anomaly text-of-image, B4 search, advancedVision compare) đang mượn tạm.
3. **Nợ tài liệu/comment cloud chết:** nhiều header/comment vẫn ghi "GPT-4o-mini", "cloud primary + LLaVA fallback", "LLaVA-1.6-Mistral / GPT-4o cloud" (`aiReportGenerator.ts:10`, `aiVisionLanguage.ts:62,87`, `aiAdvancedVision.ts:6`) trái với hành vi runtime đã local-only → gây hiểu nhầm khi audit/onboarding.

Chấm điểm nhóm (chi tiết §3): Phân tích dữ liệu/SPC **~80%** · Thị giác/defect **~45%** · MLOps/training/monitoring **~60%** · NLP/RAG/report **~70%**.

---

## 2. Bảng hiện trạng từng module

Ký hiệu trạng thái: 🟢 THẬT chạy local · 🟡 THẬT nhưng DEGRADE khi thiếu model · 🔵 STUB/opt-in chờ môi trường · 🔴 DEPRECATED/chết.

| Module | File (dẫn chứng) | Backend | Chạy local? | Trạng thái | % | Ghi chú |
|---|---|---|---|---|---|---|
| **Inspection Analytics** (SPC/Cpk/Pareto/correlation/forecast/risk) | `aiInspectionAnalytics.ts` (import `calculateCapabilityIndices` :26; control chart) | JS thuần + SQL | ✅ | 🟢 | 85% | Cpk đã tái dùng `utils/spc.ts`; no-spec→`cpk=null` không bịa. N+1 đã fix. |
| **Time-Series Engine** (EWMA/Holt-Winters/IsolationForest/decompose/changepoint) | `aiTimeSeriesEngine.ts:31` | JS thuần | ✅ | 🟢 | 80% | 5 thuật toán tự cài. Holt-Winters tôn trọng `confidence` (B1.2). Không có ARIMA/Prophet. |
| **Predictive Maintenance** (MTBF/MTTR/RUL/risk) | `predictiveMaintenanceService.ts:8-19` | Heuristic + time-series engine | ✅ | 🟢 | 75% | Blend 4 yếu tố (reliability/trend/anomaly/temp). Cold-start→low confidence, không alert. Không train ML. |
| **A/B Testing / Canary (B6)** | `aiABTesting.ts:19`; nối live `aiQualityGate.ts:362,504` | JS + ONNX inference | ✅ | 🟢 backend / 🔴 UI | 70%/0% | Routing hash idempotent, guardrail/promote THẬT. **UI gỡ** (`ABTestingPage.tsx`). |
| **Calibration (B2)** ECE/MCE/Brier/reliability/temperature | `aiCalibration.ts:1-27` | JS thuần | ✅ | 🟢 | 70% | ⚠️ Temperature là **xấp xỉ top-1 Bernoulli** vì engine không xuất full logits (ghi rõ :11-26). Cần đủ mẫu reviewed. |
| **Anomaly Detection không nhãn (B3)** PatchCore kNN | `aiAnomalyDetection.ts:9-13` | ONNX→GGUF-text→heuristic sharp | ✅ (degrade) | 🟡 | 55% | Thuật toán THẬT. Mặc định `ANOMALY_DETECTION_ENABLED` off. Chưa có model ONNX embedding → rơi text-of-image/heuristic. |
| **Visual Embedding / Image Search (B4)** | `aiImageEmbedding.ts:12-20,51` | ONNX (nếu có) / text-of-image / metadata | ✅ (degrade) | 🟡 | 50% | Mặc định `IMAGE_EMBEDDING_DEFAULT=text` → vẫn text-of-image. ONNX cần model + re-embed. HNSW chỉ cho D=1024. |
| **Golden-sample Alignment (B4.2)** | `aiAdvancedVision.ts:21-24`; `imageAlignment.ts` | JS/sharp (NCC/phase-corr) | ✅ | 🟡 | 60% | Opt-in `ALIGN_BEFORE_DIFF` off. Chỉ bù rotate+translate(+scale đều), **KHÔNG skew/perspective** (sharp). |
| **XAI Heatmap (B5)** Score-CAM/occlusion/pixel-diff | `aiExplainability.ts:1-23` | ONNX forward (không gradient) | ✅ (degrade) | 🟡 | 55% | Grad-CAM thật bất khả thi (onnxruntime-node không gradient). Phần lớn chạy nhánh **occlusion** (chậm). Tên method đúng sự thật. |
| **Advanced Vision** (compare/heatmap/OCR/ROI/visualQA/triage) | `aiAdvancedVision.ts:6-17` | sharp + vision sidecar | ⚠️ một phần | 🟡 | 50% | Phần pixel/sharp (quality/ROI/augment) THẬT. Phần "semantic/OCR/QA" cần vision sidecar → degrade text khi chưa cài. |
| **Vision-Language** (describe/compare/QAReport) | `aiVisionLanguage.ts:6-12` | llama-server mtmd sidecar (Qwen2-VL) | ⚠️ chờ binary | 🔵 | 40% | Code + sidecar sẵn; **chạy thật khi có `LLAMA_SERVER_BIN`+model**. Comment :62,87 còn ghi "cloud primary" (lỗi thời). |
| **Inference Engine (ONNX)** | `aiInferenceEngine.ts:49-67` | onnxruntime-node + DirectML | ✅ | 🟢 | 75% | EP dml→cpu (Windows). LRU session cache. ⚠️ npm ORT **không có CUDA/TensorRT EP** → cần build native. Batch B9 plan. |
| **Local Training Tier-1** (transfer softmax / few-shot prototype) | `aiLocalTraining.ts:100,215,367` | ONNX backbone đông cứng + gradient softmax head (JS) | ✅ | 🟢 | 65% | THẬT: cross-entropy + gradient trên head (:215). `Math.random` chỉ init weight (:172) — KHÔNG phải mô phỏng. Không full backprop. |
| **Training Pipeline** (PREP→TRAIN→EVAL→GATE→ACTIVATE) | `aiTrainingPipeline.ts:14,32` | orchestration | ✅ | 🟢 | 70% | Bỏ stub cloud + Math.random. Gate là nguồn sự thật. |
| **Sidecar Trainer Tier-2 (B8)** | `localSidecarTrainer.ts`; `tools/trainer/train.py` | Python/PyTorch/ultralytics (spawn) | ⚠️ opt-in | 🔵 | 50% | Scaffolding + decode YOLO-seg đã làm. Chạy khi `LOCAL_TRAINER_CMD` set + cài Python. |
| **Eval Harness** | `aiEvalHarness.ts:1-16` | JS + ONNX | ✅ | 🟢 | 70% | Confusion/P-R-F1 dùng chung `aiMetrics`. compareBeforeAfter trên cùng test split. |
| **Active Learning (Auto)** | `aiActiveLearningAuto.ts:1-15,24` | JS thuần (entropy/committee) | ✅ | 🟢 | 70% | Quét uncertainty→enqueue label queue, idempotent. |
| **Monitoring / Drift (PSI)** | `aiMonitoring.ts:6-45` | JS thuần | ✅ | 🟢 | 60% | Snapshot latency/accuracy + detectDrift. Chưa có PSI/KS per-feature đầy đủ kiểu Evidently. |
| **Segmentation decode (B7)** | `aiSegmentation.ts:1-13,249` | JS thuần (decode tensor) | ⚠️ chờ model | 🔵 | 45% | Semantic/binary/YOLO-seg decode THẬT. ⚠️ **YOLO-seg mới smoke-test tensor giả, chưa validate .onnx thật** (RUNBOOK §6). |
| **Metrology sub-pixel (B7)** | `aiMetrology.ts:1-21` | JS thuần (marching-squares/Feret) | ✅ (cần mask+calib) | 🔵 | 50% | Iso-0.5, Feret, area. Thiếu µm/pixel→unit "px"+degraded (không bịa). |
| **Local Knowledge / RAG** | `aiLocalKnowledgeService.ts:1-50` | GGUF embed + KB chunks + tools | ✅ | 🟢 | 70% | Retrieve + cite + answer local. Corpus đã re-embed GGUF mxbai (commit 5abc3c7). |
| **Report Generator** | `aiReportGenerator.ts:13-14` | GGUF narrative + JSON fallback | ✅ | 🟢 | 70% | Local. ⚠️ Comment :10 còn ghi "GPT-4o-mini" (chết). `catch{}` đã log (B1.3). |
| **Insights / RCA** | `aiInsightsService.ts:36-42` | GGUF JSON + rule-based fallback | ✅ | 🟢 | 70% | Local-only, fallback rule khi model thiếu. |
| **Smart Alert Router** | `aiSmartAlertRouter.ts:1-39` | JS thuần (rule + escalation) | ✅ | 🟢 | 70% | Định tuyến theo role/severity + email/notify. |
| **GGUF Engine** | `aiGgufEngine.ts` | node-llama-cpp 3.18.1 | ✅ | 🟢 | 75% | Text/JSON/embed in-process. Vision **không** hỗ trợ in-process (issue #88 open) → phải sidecar. |
| **AI Edge Enhanced (Phase 4.1)** | `aiEdgeEnhanced.ts:98`; router DISABLED `routers.ts:89,424` | có nhánh Forge proxy URL | ❌ | 🔴 | — | Router **đã disable**. Còn nhắc "Forge proxy" (cloud). Thay bằng `edgeDeploymentRouter` (HTTP pull + sha256). |

---

## 3. So chuẩn hệ thống AI phân tích chuyên nghiệp

| Nhóm | Đối chuẩn chuyên nghiệp | % hệ thống | GAP chính còn lại |
|---|---|---|---|
| **(a) Phân tích dữ liệu / SPC / time-series / predictive** | Minitab/JMP (SPC), Seeq/TrendMiner (industrial analytics) | **~80%** | Thiếu: SPC rule Western Electric/Nelson đầy đủ + multi-chart (Xbar-R, EWMA, CUSUM chart UI); ARIMA/Prophet/STL seasonal mạnh; gauge R&R (MSA); survival/Weibull cho RUL. Hiện forecast là HW/EWMA/Linear thủ công. |
| **(b) Thị giác / defect** | Cognex VisionPro/ViDi, MVTec HALCON/MERLIC, Landing AI, AWS Lookout for Vision, Vertex AI Vision | **~45%** | GAP lớn nhất. Chưa có **model defect ONNX thật** đang chạy; anomaly/embedding/XAI/seg đều degrade. Thiếu: defect detection/seg model production, sub-pixel metrology đã verify với model thật, alignment affine/perspective (sharp không warp), labeling tool mask (có trang nhưng chưa nối train end-to-end). |
| **(c) MLOps / training / monitoring** | MLflow, Weights & Biases, Evidently AI | **~60%** | Có: training pipeline + gate + eval + active learning + drift cơ bản + A/B canary. Thiếu so chuẩn: model registry/lineage đầy đủ, experiment tracking UI, drift per-feature (PSI/KS) + data-quality monitor kiểu Evidently, batch/GPU verify (B9 plan-only), full backprop (Tier-1 chỉ train head). |
| **(d) NLP / RAG / report** | (LLM cục bộ + KB) | **~70%** | Có: RAG cite, RCA, report narrative, chat — tất cả local. Thiếu: vision-language **chạy thật** (chờ Qwen2-VL sidecar), reranker/eval RAG (faithfulness), structured report export chuẩn (PDF template phong phú). |

**Điểm mạnh so chuẩn:** offline-first thực chất (dữ liệu không rời nhà máy), degrade trung thực có cờ (nhiều SP thương mại "ẩn" độ tin cậy), tích hợp sâu vào quality gate + OEE + MQTT/edge của chính nhà máy.

**Điểm yếu cốt lõi:** đa số năng lực thị giác sâu **chưa có model thật để chạy** — kiến trúc đã sẵn nhưng giá trị thực tế phụ thuộc bước "con người cung cấp model + nhãn + (vision) binary".

---

## 4. Khuyến nghị

### 4.1 CẢI THIỆN (đã có, cần nâng)

| # | Hạng mục | Lý do / việc cụ thể | Ưu tiên |
|---|---|---|---|
| C1 | **Calibration (B2)** | Bổ sung đường xuất full logits từ `aiInferenceEngine` để temperature scaling **đúng multi-class** thay vì xấp xỉ top-1. Hiện đã có `fitTemperatureFromLogits` chờ dữ liệu. | Cao |
| C2 | **SPC chuyên nghiệp** | Thêm bộ rule Nelson/Western Electric đầy đủ + nhiều loại control chart (EWMA/CUSUM chart, Xbar-R/S) + MSA/Gauge R&R. Đây là khoảng cách rõ nhất so Minitab. | Cao |
| C3 | **Monitoring drift** | Nâng `aiMonitoring` lên PSI/KS **per-feature** + data-quality checks (kiểu Evidently) thay vì chỉ accuracy/latency tổng. | Trung |
| C4 | **YOLO-seg validate** | Chạy 1 lần kiểm chứng decode `aiSegmentation.decodeYoloSeg` với `.onnx` YOLOv8-seg + ảnh thật so Ultralytics gốc trước khi tin số đo metrology (RUNBOOK §6). | Cao (trước khi dùng B7 thật) |
| C5 | **Forecast** | Thêm STL/Holt-Winters nhân tính + (tùy chọn) ARIMA nhẹ; hiện 3 tầng HW/EWMA/Linear còn đơn giản. | Trung |
| C6 | **Dọn comment/cloud chết** | Sửa header lỗi thời: `aiReportGenerator.ts:10` ("GPT-4o-mini"), `aiVisionLanguage.ts:62,87` ("cloud primary"), `aiAdvancedVision.ts:6`. Cân nhắc bỏ dần type union `"openai"` (giữ field UI nếu cần). | Thấp (nhưng dễ, giảm hiểu nhầm) |

### 4.2 LÀM THÊM (còn thiếu so chuyên nghiệp)

| # | Hạng mục | Lý do / ưu tiên |
|---|---|---|
| L1 | **Hoàn tất vision sidecar Qwen2-VL chạy thật** | "Trái tim" thị giác; mở khoá OCR/compare/QA + nâng B3/B4 từ degrade lên thật. **Ưu tiên #1** — nhiều module phụ thuộc. |
| L2 | **Một defect-detection/segmentation model ONNX production** + nối trang `/mask-annotation` → `aiDatasetBuilder` (seg) → B8 train → đăng ký model | Biến B3/B4/B5/B7 từ "khung degrade" thành giá trị thật. **Ưu tiên #2.** |
| L3 | **UI cho A/B Canary live (B6)** | Backend đã chạy live trong quality gate nhưng **không có UI** giám sát/promote/rollback. Hiện là "năng lực ẩn". (xem cả mục 4.3 nếu chọn bỏ). |
| L4 | **Model registry / lineage + experiment tracking UI** | So MLflow/W&B; hiện có `model_versions` + gate nhưng thiếu lineage/so sánh experiment trực quan. |
| L5 | **GPU/TensorRT verify + batch inference (B9)** | Plan-only; cần host GPU + ORT GPU. Nâng throughput inference & cho phép vision+train luân phiên hiệu quả. |
| L6 | **RAG eval (faithfulness/citation) + reranker** | Đảm bảo chất lượng câu trả lời KB local; chuẩn RAG hiện đại. |

### 4.3 ⚠️ CÓ THỂ LOẠI BỎ / GỘP

| # | Đối tượng | Lý do bỏ | Rủi ro khi bỏ | Thay thế |
|---|---|---|---|---|
| X1 | **`aiEdgeEnhanced.ts` + `aiEdgeEnhancedRouter` (Phase 4.1)** | Router **đã disable** (`routers.ts:89,424`); còn nhánh **Forge proxy (cloud)** không còn dùng. Trùng vai trò với `edgeDeploymentRouter` (HTTP pull + sha256, đã thay). | Rất thấp — đã disable, không endpoint live. | `edgeDeploymentRouter` (Phase 191 WS-2). → Xoá file + import để giảm bề mặt bảo trì. |
| X2 | **Type union `"openai"` + field provider cloud rải rác** | OpenAI runtime đã gỡ; `"openai"` chỉ còn để type-compat (`aiProviderRouter.ts:22`, `aiProviderManager.ts:11`). Gây hiểu nhầm "có cloud". | Thấp — cần sửa nơi UI đọc `generatedBy`/status. | Đổi union còn `"gguf" | "offline"`; ẩn ô "OpenAI API" trong UI status. |
| X3 | **Quyết định cho A/B Testing**: hoặc **bỏ hẳn backend**, hoặc **làm lại UI** | Tình trạng hiện **mâu thuẫn**: UI nói "ngừng hỗ trợ" (`ABTestingPage.tsx`) nhưng backend canary **đang chạy live** trong quality gate. Một là "tính năng ẩn" khó vận hành, hai là code chết nếu không ai gán `activeExperimentId`. | Trung — nếu bỏ backend phải gỡ nhánh canary trong `aiQualityGate.ts:362-367,504`; nếu giữ phải làm UI (L3). | **Khuyến nghị:** GIỮ backend (giá trị cao cho rollout an toàn) + làm UI tối giản (L3). KHÔNG để trạng thái nửa vời. |
| X4 | **Nhánh "heuristic sharp" trong B3 anomaly** (tầng 3) | Histogram+Laplacian heuristic cho anomaly công nghiệp gần như **vô dụng về độ chính xác** (không phân biệt defect tinh vi); chỉ tránh crash. | Thấp — vẫn còn tầng text-of-image. | Giữ tầng ONNX + text-of-image; bỏ tầng heuristic HOẶC đổi thành "no-result + degraded" để không tạo cảm giác có kết quả. |
| X5 | **Decode metrology trên nhánh YOLO-seg (nếu không kịp validate C4)** | Chưa validate với model thật → số đo có thể sai mà UI hiển thị như thật. | Trung — mất tính năng metrology YOLO. | Để sau cờ "experimental"/khoá cho tới khi C4 xong; semantic/binary mask vẫn dùng được. |
| X6 | **Tài liệu/test nhắc cloud (Forge/Gemini/GPT) trong path đã chết** | Không phản ánh hệ thống; tăng nhiễu audit. | Rất thấp. | Dọn cùng C6. |

> KHÔNG khuyến nghị bỏ: Inspection Analytics, Time-Series, Predictive, Calibration, Training Pipeline, Eval, Active Learning, RAG, Report, Insights, Smart Alert — đều THẬT, chạy local, giá trị cao.

---

## 5. Lộ trình đề xuất

**Đợt 1 — Dọn & nhất quán (1–2 ngày, thuần code, rủi ro thấp):**
- C6 + X1 + X2 + X6 (dọn cloud chết, gỡ aiEdgeEnhanced, sửa comment/union).
- Quyết X3 (chọn hướng A/B) — nếu giữ thì lên backlog L3.
- X4/X5: hạ tầng heuristic anomaly + khoá metrology YOLO-seg sau cờ experimental.

**Đợt 2 — Mở khoá giá trị thị giác (cần con người + model):**
- L1 vision sidecar Qwen2-VL chạy thật → C nâng B3/B4/advancedVision.
- L2 model defect/seg ONNX + nối mask-annotation → B8 train → đăng ký → C4 validate YOLO-seg.

**Đợt 3 — Ngang tầm chuyên nghiệp (nâng chiều sâu):**
- C2 SPC rule/charts + MSA · C3 drift per-feature · C1 full-logit calibration.
- L4 model registry/experiment UI · L3 A/B UI · L6 RAG eval.

**Đợt 4 — Hiệu năng (cần GPU):**
- L5 / B9 GPU EP verify + batch inference + TensorRT cache.

---

## 6. Phụ lục — nhận định trung thực then chốt

- **"100% local" là THẬT ở runtime** (không gọi cloud), nhưng **tài liệu/comment chưa theo kịp** (còn chữ GPT/Forge/cloud) → dễ đánh giá sai.
- **Phân tích DỮ LIỆU (số) đã chững chạc; phân tích HÌNH ẢNH bằng AI sâu thì kiến trúc đầy đủ nhưng "rỗng model"** — degrade trung thực, chưa tạo ra giá trị defect-vision thật cho tới Đợt 2.
- **A/B Canary là ví dụ điển hình "backend chạy / UI chết"** — cần quyết dứt khoát.
- **onnxruntime-node trên Windows = DirectML, KHÔNG CUDA/TensorRT EP** (npm) → mọi kỳ vọng TensorRT cần build native (B9).
- **Tier-1 training là gradient THẬT trên head (không phải Math.random mô phỏng)** — nhưng chỉ train lớp cuối trên backbone đông cứng; "deep training" thật cần B8 sidecar Python + GPU.
