# Kế Hoạch Nâng Cấp Hệ Thống AI — AVI-AOI Management

> **Ngày lập**: 23/03/2026  
> **Hệ thống**: AVI-AOI Management (Automated Optical Inspection)  
> **Stack hiện tại**: Node.js + ONNX Runtime + OpenAI GPT-4o-mini + Sharp + PostgreSQL + Drizzle ORM

---

## 📊 Đánh Giá Hiện Trạng AI

### Đã có và hoạt động tốt ✅
| Module | Mô tả | File chính |
|--------|--------|------------|
| ONNX Inference Engine | Chạy model classification & YOLO detection trên CPU | `server/services/aiInferenceEngine.ts` |
| Model Versioning | Upload → Validate → Activate, quản lý ONNX/TensorRT/OpenVINO | `server/routers/aiModelRouter.ts` |
| Root Cause Analysis (RCA) | Pareto + Correlation + LLM insights (GPT-4o-mini) | `server/routers/aiRouters.ts` |
| Predictive Alerts | Linear regression phát hiện DEFECT_SPIKE, YIELD_DROP | `server/routers/aiRouters.ts` |
| AI Annotation Assistant | Gợi ý annotation trên ảnh từ model | `client/src/components/AIAnnotationAssistant.tsx` |
| A/B Testing | So sánh 2 model song song, traffic split, thống kê winner | `server/services/aiABTesting.ts` |
| Batch Inference | Xử lý 1-10,000 ảnh hàng loạt, concurrency control | `server/services/aiBatchEngine.ts` |
| User Feedback Loop | Thu thập CORRECT/INCORRECT/PARTIAL, error categorization | `server/routers/aiFeedbackRouter.ts` |
| SPC Control Charts | X-bar/R chart, Nelson rules, CPK/PPK | `server/routers/spcAdvancedRouter.ts` |
| Performance Monitoring | Latency p50/p95/p99, accuracy, drift detection | `server/services/aiMonitoring.ts` |
| Defect Heatmap & Trends | Phân bố lỗi theo vùng, dự đoán xu hướng | `server/routers/annotationRouters.ts` |
| Annotation Comparison | So sánh annotations giữa nhiều inspections | `server/routers/annotationComparisonRouter.ts` |

### Cần cải thiện ⚠️
| Module | Vấn đề | Mức ưu tiên |
|--------|--------|-------------|
| Training Pipeline | Chỉ là stub, phụ thuộc external TRAINING_SERVICE_URL | 🔴 Cao |
| Edge Deployment | Framework có nhưng device sync chưa hoàn thiện | 🟡 Trung bình |
| Inference Engine | Chỉ CPU, chưa GPU/TensorRT acceleration | 🟡 Trung bình |
| Predictive Alerts | Chỉ dùng Linear Regression, chưa có ML models complex | 🟡 Trung bình |
| LLM Integration | Chỉ OpenAI, chưa support local LLM hoặc multi-provider | 🟡 Trung bình |

### Chưa có ❌
| Tính năng | Giá trị mang lại |
|-----------|------------------|
| Auto-labeling & Active Learning | Giảm 80% công sức gán nhãn thủ công |
| Real-time Anomaly Detection (streaming) | Phát hiện bất thường ngay khi ảnh đến |
| Multi-model Ensemble | Kết hợp nhiều model tăng accuracy |
| Image Similarity Search | Tìm ảnh tương tự để so sánh nhanh |
| AI Report Generation | Tự động tạo báo cáo chất lượng smart |
| Automated Quality Gate | AI tự động quyết định OK/NG dựa trên model |
| Vision-Language Model (VLM) | Mô tả lỗi bằng ngôn ngữ tự nhiên |
| Transfer Learning Pipeline | Fine-tune từ model pretrained trên data thực tế |

---

## 🚀 Kế Hoạch Nâng Cấp — 4 Giai Đoạn

---

### GIAI ĐOẠN 1: Tăng Cường Lõi AI (2-3 tuần)
> **Mục tiêu**: Tối ưu infrastructure hiện tại, bổ sung tính năng thiết yếu

#### 1.1 GPU Inference Support
**Vấn đề**: Hiện tại chỉ chạy CPU (`executionProviders: ["cpu"]`), xử lý ảnh chậm (~200-500ms/ảnh).

**Giải pháp**:
```typescript
// server/services/aiInferenceEngine.ts - Thêm GPU support
const executionProviders = [];
if (process.env.ENABLE_CUDA === 'true') {
  executionProviders.push('cuda');        // NVIDIA GPU
}
if (process.env.ENABLE_TENSORRT === 'true') {
  executionProviders.push('tensorrt');    // NVIDIA TensorRT (2-5x faster)
}
executionProviders.push('cpu');           // Fallback

const session = await ort.InferenceSession.create(modelPath, {
  executionProviders,
  graphOptimizationLevel: 'all',
});
```

**Kết quả kỳ vọng**: Giảm inference time từ ~300ms xuống ~30-50ms/ảnh (GPU), ~15-25ms (TensorRT).

**Packages cần thêm**:
- `onnxruntime-node` (giữ nguyên, đã hỗ trợ CUDA provider)
- Cần cài CUDA Toolkit + cuDNN trên server

#### 1.2 Multi-model Ensemble Inference
**Vấn đề**: Chỉ chạy 1 model/lần, accuracy bị giới hạn bởi single model.

**Giải pháp**: Tạo service kết hợp kết quả từ nhiều model.

```
Tạo: server/services/aiEnsembleEngine.ts

Flow:
  Image → [Model A (classification)]  → predictions A
       → [Model B (detection)]        → predictions B  
       → [Model C (segmentation)]     → predictions C
       → Ensemble Strategy (voting/averaging/stacking) 
       → Final prediction (confidence ↑ 10-15%)
```

**Strategies**:
- **Majority Voting**: Dùng khi có 3+ model cùng loại
- **Weighted Average**: Model có accuracy cao hơn có weight lớn hơn
- **Stacking**: Train meta-model trên outputs của base models

**Schema mới cần thêm**:
```sql
CREATE TABLE ai_ensemble_configs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  strategy VARCHAR(20) NOT NULL, -- 'voting' | 'weighted_avg' | 'stacking'
  model_ids INTEGER[] NOT NULL,
  model_weights JSONB,           -- {modelId: weight}
  is_active BOOLEAN DEFAULT false,
  product_model_id INTEGER REFERENCES product_models(id),
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### 1.3 Auto Quality Gate (AI-driven NG/OK Decision)
**Vấn đề**: Hiện tại inspection chỉ lưu kết quả, chưa có AI tự động quyết định NG/OK.

**Giải pháp**: Tạo automatic quality gate pipeline.

```
Tạo: server/services/aiQualityGate.ts

Flow khi image mới đến:
  1. Nhận ảnh từ inspection → runInference(activeModel)
  2. So sánh confidence với ngưỡng quality gate
  3. confidence >= threshold → AUTO_OK
  4. confidence < threshold nhưng > review_threshold → NEEDS_REVIEW  
  5. confidence < review_threshold → AUTO_NG
  6. Lưu kết quả + trigger alert nếu NG
  7. Hiển thị trên dashboard real-time
```

**Thêm fields vào schema `product_inspections`**:
```sql
ALTER TABLE product_inspections ADD COLUMN ai_decision VARCHAR(20);     -- AUTO_OK, AUTO_NG, NEEDS_REVIEW, MANUAL
ALTER TABLE product_inspections ADD COLUMN ai_confidence DECIMAL(5,4);
ALTER TABLE product_inspections ADD COLUMN ai_model_id INTEGER;
ALTER TABLE product_inspections ADD COLUMN ai_processed_at TIMESTAMP;
```

---

### GIAI ĐOẠN 2: Intelligent Image Processing (3-4 tuần)
> **Mục tiêu**: Biến hệ thống từ "lưu ảnh" thành "hiểu ảnh"

#### 2.1 Vision-Language Model (VLM) Integration
**Vấn đề**: Hệ thống chỉ có classification labels, không có mô tả ngôn ngữ tự nhiên về defect.

**Giải pháp**: Tích hợp GPT-4o Vision hoặc local VLM.

```
Tạo: server/services/aiVisionLanguage.ts

Chức năng:
  1. describeDefect(imageBuffer) → "Vết nứt dài 2mm ở góc trên bên phải PCB, 
     có khả năng do nhiệt độ hàn quá cao"
  2. compareImages(imgA, imgB) → "Ảnh B có thêm 2 vết trầy xước mới ở zone C"  
  3. generateReport(images[]) → Báo cáo QA tự động bằng ngôn ngữ tự nhiên
```

**API chính**:
```typescript
// Sử dụng OpenAI GPT-4o Vision (đã có openai package)
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "Analyze this AOI inspection image..." },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
    ]
  }],
  max_tokens: 500,
});
```

**Fallback**: Nếu không có API key, dùng ONNX model Florence-2 hoặc BLIP-2 local.

#### 2.2 Image Similarity Search (Vector Embeddings)
**Vấn đề**: Khi phát hiện defect, operator không thể nhanh chóng tìm ảnh tương tự để đối chiếu.

**Giải pháp**: Tạo vector embedding pipeline cho ảnh inspection.

```
Tạo: server/services/aiImageEmbedding.ts

Flow:
  1. Khi ảnh mới được upload → Extract embedding vector (512/768-dim)
     - Dùng ONNX model: ResNet50, EfficientNet, hoặc CLIP image encoder
  2. Lưu vector vào PostgreSQL pgvector extension
  3. API tìm ảnh tương tự: Cosine similarity search, top-K results

Endpoints mới:
  - aiImage.findSimilar(imageId, limit) → Similar images ranked by score
  - aiImage.searchByUpload(imageBuffer, limit) → Upload ảnh → tìm tương tự
  - aiImage.clusterDefects(params) → Tự động group ảnh lỗi giống nhau
```

**Schema pg_vector**:
```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE image_embeddings (
  id SERIAL PRIMARY KEY,
  inspection_id INTEGER REFERENCES product_inspections(id),
  measurement_result_id INTEGER REFERENCES measurement_results(id),
  image_url TEXT NOT NULL,
  embedding VECTOR(512) NOT NULL,
  model_code VARCHAR(50) NOT NULL,  -- embedding model used
  metadata JSONB,                    -- {label, confidence, defectType}
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_image_embeddings_vector ON image_embeddings 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

**Package cần thêm**: `pgvector` (npm) hoặc `drizzle-orm/pg-core` vector type

#### 2.3 Auto-Labeling & Active Learning
**Vấn đề**: Gán nhãn thủ công tốn thời gian, training pipeline cần dữ liệu labeled.

**Giải pháp**: AI tự gán nhãn và chọn mẫu cần review.

```
Tạo: server/services/aiActiveLearning.ts

Flow:
  1. Model gán nhãn tự động cho unlabeled images
  2. High confidence (>0.95) → Auto-accept label
  3. Low confidence (0.5-0.95) → Queue for human review (Active Learning)
  4. Very low confidence (<0.5) → Flag for expert review
  5. Human corrections → Feed back into training pipeline
  6. Khi đủ dữ liệu mới → Auto-trigger retrain

Strategies:
  - Uncertainty Sampling: Chọn mẫu model ít chắc chắn nhất
  - Diversity Sampling: Chọn mẫu đa dạng nhất từ cluster khác nhau
  - Query-by-Committee: Khi ensemble models bất đồng
```

**UI Component mới**:
```
client/src/pages/ActiveLearningPage.tsx
  - Queue ảnh cần review (sorted by uncertainty)
  - Quick label interface (swipe OK/NG hoặc multi-class)
  - Progress tracker: labeled vs unlabeled
  - Auto-retrain trigger khi đạt threshold
```

---

### GIAI ĐOẠN 3: Smart Analytics & Automation (3-4 tuần)
> **Mục tiêu**: AI không chỉ phân tích mà còn dự đoán và hành động

#### 3.1 Advanced Predictive Analytics
**Vấn đề**: Chỉ có Linear Regression cho predictive alerts, chưa đủ chính xác.

**Giải pháp**: Thêm multiple forecasting algorithms.

```
Nâng cấp: server/routers/aiRouters.ts → predictiveAlertRouter

Algorithms mới:
  1. EWMA (Exponential Weighted Moving Average) — Nhạy với thay đổi gần
  2. Holt-Winters (Triple Exponential Smoothing) — Bắt pattern theo mùa/ca  
  3. Isolation Forest — Anomaly detection trên multivariate data
  4. ARIMA-like decomposition — Trend + Seasonality + Residual

Tạo: server/services/aiTimeSeriesEngine.ts
  - analyzeTimeSeries(data, algorithm) → forecast + confidence interval
  - detectChangePoint(data) → Phát hiện thời điểm thay đổi bất thường
  - seasonalDecompose(data) → Tách trend, seasonal, residual components
```

**Ứng dụng cụ thể cho AOI**:
- Dự đoán defect rate theo ca/shift (seasonal pattern)
- Phát hiện machine degradation trước khi xảy ra spike
- Alert khi pattern sản xuất thay đổi đột ngột (change point detection)

#### 3.2 AI-Powered Report Generation
**Vấn đề**: Báo cáo chất lượng hiện tại là data thô, cần người phân tích.

**Giải pháp**: AI tự tạo báo cáo thông minh.

```
Tạo: server/services/aiReportGenerator.ts

report types:
  1. Daily Quality Summary
     - Tổng hợp defect rate, top defect types, machine performance
     - So sánh với baseline, highlight anomalies
     - Recommendations tự động
     
  2. Root Cause Investigation Report  
     - Khi phát hiện spike → Auto-analyze → Generate report
     - Include: timeline, contributing factors, correlation data
     - AI-generated action items
     
  3. Model Performance Report
     - Accuracy trends, drift alerts
     - A/B test results summary
     - Retrain recommendations
     
  4. Weekly/Monthly Executive Summary
     - KPI tracking (yield, defect rate, OEE)
     - AI-highlighted trends & concerns
     - Forecast cho tuần/tháng tiếp theo

Output formats: PDF, HTML email, Markdown
```

**Tích hợp LLM**:
```typescript
// Dùng GPT-4o-mini (đã có) để viết narrative analysis
const reportData = await collectReportData(params);
const narrative = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{
    role: "system",
    content: "You are a quality engineering report writer for AOI manufacturing..."
  }, {
    role: "user", 
    content: `Generate a quality report analysis from this data: ${JSON.stringify(reportData)}`
  }],
});
```

#### 3.3 Intelligent Alert Routing & Escalation
**Vấn đề**: Predictive alerts go to everyone, không smart routing.

**Giải pháp**: AI quyết định ai nhận alert nào, khi nào escalate.

```
Tạo: server/services/aiAlertRouter.ts

Logic:
  1. DEFECT_SPIKE on Machine X → Route to Machine X operator + supervisor
  2. YIELD_DROP on Product Y → Route to Product Y quality engineer
  3. MACHINE_FAILURE prediction → Route to maintenance team
  4. Multiple alerts same root cause → Consolidate into 1 alert  
  5. Alert unacknowledged > 30min → Auto-escalate to next level
  6. Pattern recognition: "Same alert every Monday morning" → Suggest permanent fix
```

---

### GIAI ĐOẠN 4: Advanced AI & Edge Intelligence (4-6 tuần)
> **Mục tiêu**: AI tự động hóa toàn bộ, edge deployment hoàn chỉnh

#### 4.1 On-device Training & Inference (Edge AI Complete)
**Vấn đề**: Edge deployment chưa hoàn thiện, chưa có on-device training.

**Giải pháp**: Hoàn thiện edge pipeline.

```
Nâng cấp: server/services/aiEdgeDeployment.ts

Tính năng mới:
  1. Model Quantization Pipeline
     - FP32 → FP16 → INT8 → INT4 (giảm size 4-8x)
     - Calibration dataset selection
     - Post-quantization accuracy validation
     
  2. OTA (Over-The-Air) Model Update
     - Phát hiện model mới → Auto-push to devices
     - Delta update (chỉ gửi thay đổi, không toàn bộ)
     - Rollback mechanism nếu accuracy drop
     
  3. Edge-Cloud Sync
     - Device chạy inference offline
     - Sync results khi có network
     - Conflict resolution strategy
     
  4. Device Fleet Management
     - Dashboard hiển thị trạng thái tất cả devices
     - Batch deploy model to device group
     - Performance comparison across devices
```

#### 4.2 Built-in Lightweight Training  
**Vấn đề**: Training pipeline phụ thuộc external service (TRAINING_SERVICE_URL).

**Giải pháp**: Thêm built-in training cho simple models.

```
Tạo: server/services/aiLocalTraining.ts

Capabilities:
  1. Transfer Learning (Fine-tuning)
     - Load pretrained ONNX model (ResNet, EfficientNet)
     - Thay final layer cho custom classes
     - Train trên production data (đã label qua feedback)
     - Export trained model → ONNX → Deploy
     
  2. Few-shot Learning
     - Chỉ cần 5-10 mẫu/class để train
     - Dùng Siamese Network + contrastive learning
     - Rất phù hợp khi có sản phẩm mới
     
  3. Incremental Learning
     - Train thêm data mới KHÔNG cần retrain toàn bộ
     - Giải quyết catastrophic forgetting
     - Auto-trigger khi có đủ feedback mới

Phụ thuộc: onnxruntime-training (npm) hoặc Python subprocess + PyTorch
```

#### 4.3 AI Chatbot Assistant (Manufacturing Copilot)
**Vấn đề**: Users phải tự navigate và phân tích data, tốn thời gian.

**Giải pháp**: Chatbot hỏi đáp bằng ngôn ngữ tự nhiên về quality data.

```
Tạo: 
  - server/services/aiChatAssistant.ts
  - client/src/components/AIChatWidget.tsx

Khả năng:
  1. "Tỷ lệ lỗi máy M-001 hôm nay bao nhiêu?" → Query DB → Trả lời
  2. "So sánh yield tuần này vs tuần trước" → Analytics query → Chart + text
  3. "Tại sao máy M-003 bị spike lỗi lúc 14:00?" → RCA analysis → Giải thích
  4. "Ảnh nào giống defect #12345?" → Image similarity search → Show results
  5. "Tạo báo cáo chất lượng tuần" → Generate report → Download link

Architecture:
  User query → LLM (function calling) → Execute tool → Format response
  
Tools available to LLM:
  - query_inspection_stats(filters)
  - get_defect_trends(params)  
  - run_root_cause_analysis(params)
  - find_similar_images(imageId)
  - generate_report(type, params)
  - get_machine_status(machineId)
```

---

## 📋 Tổng Kết Ưu Tiên

| # | Feature | Giai đoạn | Ưu tiên | Giá trị | Độ phức tạp | Trạng thái |
|---|---------|-----------|---------|---------|-------------|------------|
| 1 | GPU Inference Support | GĐ1 | 🔴 Cao | Tốc độ ↑ 10x | Thấp | ✅ Hoàn thành |
| 2 | Auto Quality Gate | GĐ1 | 🔴 Cao | Tự động hóa QA | Trung bình | ✅ Hoàn thành |
| 3 | Multi-model Ensemble | GĐ1 | 🟡 TB | Accuracy ↑ 10-15% | Trung bình | ✅ Hoàn thành |
| 4 | VLM (Vision-Language) | GĐ2 | 🔴 Cao | Mô tả defect NL | Thấp (dùng GPT-4o) | ✅ Hoàn thành |
| 5 | Image Similarity Search | GĐ2 | 🔴 Cao | Tra cứu nhanh | Trung bình | ✅ Hoàn thành |
| 6 | Auto-Labeling/Active Learning | GĐ2 | 🔴 Cao | Giảm 80% labeling | Cao | ✅ Hoàn thành |
| 7 | Advanced Predictive Analytics | GĐ3 | 🟡 TB | Dự đoán chính xác hơn | Trung bình | ✅ Hoàn thành |
| 8 | AI Report Generation | GĐ3 | 🟡 TB | Tiết kiệm 2-3h/ngày | Trung bình | ✅ Hoàn thành |
| 9 | Intelligent Alert Routing | GĐ3 | 🟢 Thấp | UX tốt hơn | Thấp | ✅ Hoàn thành |
| 10 | Edge AI Complete | GĐ4 | 🟡 TB | Offline capability | Cao | ✅ Hoàn thành |
| 11 | Built-in Training | GĐ4 | 🟡 TB | Không cần external service | Cao | ✅ Hoàn thành |
| 12 | AI Chatbot Assistant | GĐ4 | 🟢 Thấp | Cool factor, UX tốt | Trung bình | ✅ Hoàn thành |

> **🎉 Tất cả 12 features (4 giai đoạn) đã được triển khai hoàn tất.**

---

## ✅ Chi Tiết Triển Khai

### Phase 1 — Tăng Cường Lõi AI
| Feature | Service File | Router File | Endpoints |
|---------|-------------|-------------|-----------|
| GPU Inference | `server/services/aiInferenceEngine.ts` | (integrated) | — |
| Auto Quality Gate + Ensemble | `server/services/aiQualityGate.ts` | `server/routers/aiQualityGateRouter.ts` | 13 endpoints |

### Phase 2 — AI Thông Minh
| Feature | Service File | Router File | Endpoints |
|---------|-------------|-------------|-----------|
| VLM Vision-Language | `server/services/aiVisionLanguage.ts` | `server/routers/aiVisionLanguageRouter.ts` | 3 endpoints |
| Image Similarity Search | `server/services/aiImageEmbedding.ts` | `server/routers/aiImageSearchRouter.ts` | 5 endpoints |
| Active Learning | `server/services/aiActiveLearning.ts` | `server/routers/aiActiveLearningRouter.ts` | 10 endpoints |

### Phase 3 — Analytics & Automation
| Feature | Service File | Router File | Endpoints |
|---------|-------------|-------------|-----------|
| Time Series Analytics | `server/services/aiTimeSeriesEngine.ts` | `server/routers/aiTimeSeriesRouter.ts` | 5 endpoints |
| AI Report Generator | `server/services/aiReportGenerator.ts` | `server/routers/aiReportRouter.ts` | 5 endpoints |
| Smart Alert Routing | `server/services/aiSmartAlertRouter.ts` | `server/routers/aiSmartAlertRoutingRouter.ts` | 7 endpoints |

### Phase 4 — Advanced AI & Edge Intelligence
| Feature | Service File | Router File | Endpoints |
|---------|-------------|-------------|-----------|
| Edge AI Complete | `server/services/aiEdgeEnhanced.ts` | `server/routers/aiEdgeEnhancedRouter.ts` | 11 endpoints |
| Built-in Training | `server/services/aiLocalTraining.ts` | `server/routers/aiLocalTrainingRouter.ts` | 3 endpoints |
| AI Chatbot Assistant | `server/services/aiChatAssistant.ts` | `server/routers/aiChatRouter.ts` | 2 endpoints |

### Database Migrations
| Migration | Content |
|-----------|---------|
| `drizzle/0076_ai_quality_gate_active_learning.sql` | AI enums, Quality Gate, Ensemble, Image Embeddings (pgvector), Label Queue tables |
| `drizzle/0077_ai_phase4_chat_edge_training.sql` | Chat role enum, Chat Conversations, Chat Messages tables |

---

## 🛠️ Packages & Dependencies Mới

```json
{
  "dependencies": {
    "onnxruntime-node": "^1.24.3",      // ✅ Đã có
    "openai": "^6.32.0",                 // ✅ Đã có  
    "sharp": "^0.34.5",                  // ✅ Đã có
    "pgvector": "^0.2.0",               // 🆕 Vector similarity search
    "pdfkit": "^0.15.0",                // 🆕 PDF report generation
    "nodemailer": "^6.9.0"              // 🆕 Email report delivery (nếu chưa có)
  }
}
```

**Hệ thống cần có (cho GPU)**:
- NVIDIA CUDA Toolkit 12.x
- cuDNN 8.x
- NVIDIA GPU (GTX 1660+ hoặc RTX series hoặc Tesla/A100)

---

## 📐 Architecture Tổng Thể Sau Nâng Cấp

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENT (React + Vite)                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ │
│  │ AI Chat  │ │ Quality  │ │ Active   │ │ Smart      │ │
│  │ Widget   │ │ Gate UI  │ │ Learning │ │ Reports    │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬──────┘ │
└───────┼─────────────┼───────────┼──────────────┼────────┘
        │             │           │              │
        ▼             ▼           ▼              ▼
┌─────────────────────────────────────────────────────────┐
│                 SERVER (tRPC + Express)                   │
│                                                          │
│  ┌─────────────── AI Layer ────────────────────────┐    │
│  │                                                  │    │
│  │  ┌──────────┐  ┌───────────┐  ┌──────────────┐ │    │
│  │  │ Inference │  │ Ensemble  │  │ Quality Gate │ │    │
│  │  │ Engine   │  │ Engine    │  │ Pipeline     │ │    │
│  │  │ (ONNX)   │  │           │  │              │ │    │
│  │  │ CPU+GPU  │  │ Voting/   │  │ Auto OK/NG   │ │    │
│  │  └─────┬────┘  │ Weighted  │  │ + Review     │ │    │
│  │        │       └─────┬─────┘  └──────┬───────┘ │    │
│  │        │             │               │          │    │
│  │  ┌─────┴─────────────┴───────────────┴───────┐  │    │
│  │  │           Model Registry                   │  │    │
│  │  │  (Versioning + A/B Testing + Monitoring)   │  │    │
│  │  └──────────────────┬────────────────────────┘  │    │
│  │                     │                            │    │
│  │  ┌─────────────┐  ┌┴──────────┐  ┌───────────┐ │    │
│  │  │ VLM Service │  │ Embedding │  │ Active    │ │    │
│  │  │ (GPT-4o /   │  │ + pgvector│  │ Learning  │ │    │
│  │  │  local VLM) │  │ Similarity│  │ Pipeline  │ │    │
│  │  └─────────────┘  └───────────┘  └───────────┘ │    │
│  │                                                  │    │
│  │  ┌─────────────┐  ┌───────────┐  ┌───────────┐ │    │
│  │  │ Time Series │  │ Report    │  │ Chat      │ │    │
│  │  │ Engine      │  │ Generator │  │ Assistant │ │    │
│  │  │ (EWMA,HW)  │  │ (PDF/HTML)│  │ (LLM+RAG)│ │    │
│  │  └─────────────┘  └───────────┘  └───────────┘ │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ┌─────────── Data Layer ──────────────────────────┐    │
│  │  PostgreSQL + pgvector + Drizzle ORM            │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐│    │
│  │  │ai_models │ │inference │ │image_embeddings  ││    │
│  │  │versions  │ │results   │ │(vector 512-dim)  ││    │
│  │  │snapshots │ │feedbacks │ │ensemble_configs  ││    │
│  │  └──────────┘ └──────────┘ └──────────────────┘│    │
│  └──────────────────────────────────────────────────┘    │
└─────────────────────────────┬────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   Edge Devices     │
                    │  ┌──────┐ ┌──────┐ │
                    │  │ AOI  │ │ AOI  │ │
                    │  │ Cam1 │ │ Cam2 │ │
                    │  │ ONNX │ │ ONNX │ │
                    │  └──────┘ └──────┘ │
                    └────────────────────┘
```

---

## ⚡ Quick Wins — Có Thể Triển Khai Ngay

Những thay đổi nhỏ, tác động lớn, có thể làm trong 1-2 ngày:

### QW1. Thêm GPU auto-detection vào Inference Engine
- Sửa 1 file: `server/services/aiInferenceEngine.ts`
- Thêm logic detect CUDA availability, auto-fallback CPU

### QW2. Tích hợp GPT-4o Vision vào Annotation Assistant
- Sửa 1 file: `server/routers/aiModelRouter.ts` (thêm endpoint `analyzeWithVLM`)
- Client đã có `AIAnnotationAssistant.tsx`, chỉ cần thêm button "AI Describe"

### QW3. Thêm AI Summary vào RCA Module
- Sửa RCA output format: thêm `executiveSummary` bằng LLM
- Đã có OpenAI integration, chỉ cần thêm 1 prompt

### QW4. Auto Quality Gate cơ bản
- Thêm trigger sau mỗi inference: nếu confidence > threshold → auto-mark result
- Sửa 2 file: inference engine + inspection router

---

## 📝 Ghi Chú Triển Khai

1. **Backward Compatibility**: Tất cả tính năng AI mới phải là opt-in (feature flags), không ảnh hưởng flow hiện tại
2. **Graceful Degradation**: Nếu GPU không available → fallback CPU. Nếu API key hết → fallback rule-based
3. **Data Privacy**: Ảnh inspection KHÔNG gửi ra external API trừ khi user bật tính năng VLM
4. **Performance Budget**: Inference time budget: <100ms (GPU), <500ms (CPU). Report generation: <30s
5. **Testing**: Mỗi module AI phải có unit test với mock data + integration test với ONNX test model

---

> **Bước tiếp theo**: Chọn Quick Wins hoặc Feature cụ thể từ kế hoạch để bắt đầu triển khai.
