# Hướng Dẫn Sử Dụng Các Chức Năng AI — AVI AOI Management

> Tài liệu hướng dẫn toàn diện cho tất cả các tính năng AI trong hệ thống quản lý AOI.

---

## Mục Lục

1. [Tổng Quan](#1-tổng-quan)
2. [AI Analysis Hub — Trung Tâm Phân Tích AI](#2-ai-analysis-hub)
3. [Phân Tích Ảnh (Image Analysis)](#3-phân-tích-ảnh)
4. [Phân Tích Dữ Liệu (Data Analysis)](#4-phân-tích-dữ-liệu)
5. [Quản Lý Mô Hình AI (AI Models)](#5-quản-lý-mô-hình-ai)
6. [Quality Gate AI](#6-quality-gate-ai)
7. [Huấn Luyện Mô Hình (Training)](#7-huấn-luyện-mô-hình)
8. [A/B Testing](#8-ab-testing)
9. [AI Chat Assistant](#9-ai-chat-assistant)
10. [AI Report Generation](#10-ai-report-generation)
11. [Smart Alert Routing](#11-smart-alert-routing)
12. [Edge Deployment](#12-edge-deployment)
13. [Active Learning](#13-active-learning)
14. [AI Feedback System](#14-ai-feedback-system)
15. [Tham Khảo API](#15-tham-khảo-api)

---

## 1. Tổng Quan

Hệ thống AVI AOI Management tích hợp **14 module AI** với hơn **100 endpoints** phục vụ:

| Module | Mô tả | Số Endpoints |
|--------|--------|:------------:|
| AI Analysis Hub | Trung tâm phân tích AI thống nhất | 13 |
| AI Model | Quản lý mô hình ONNX | 12+ |
| AI Quality Gate | Cổng chất lượng AI | 13 |
| AI Vision Language | Phân tích ảnh VLM | 3 |
| AI Image Search | Tìm kiếm ảnh tương tự | 5 |
| AI Time Series | Phân tích chuỗi thời gian | 5 |
| AI Advanced (Batch/Training/AB/Edge) | Tính năng nâng cao | 40+ |
| AI Report | Báo cáo AI | 5 |
| AI Smart Alert Routing | Lộ trình cảnh báo thông minh | 7 |
| AI Edge Enhanced | Triển khai biên nâng cao | 11 |
| AI Local Training | Huấn luyện cục bộ | 6 |
| AI Chat | Trợ lý AI chat | 11 |
| AI Feedback | Phản hồi & đề xuất AI | 5 |
| Root Cause / Predictive Alert | Phân tích nguyên nhân gốc | 2+ |

---

## 2. AI Analysis Hub

**AI Analysis Hub** là trung tâm thống nhất để người dùng khám phá và lựa chọn các chức năng phân tích AI.

### 2.1 Khám Phá Chức Năng

```
GET aiAnalysisHub.getCapabilities
```

**Tham số:**
| Tham số | Kiểu | Mặc định | Mô tả |
|---------|------|----------|-------|
| category | "all" \| "image" \| "data" \| "report" | "all" | Lọc theo danh mục |

**Ví dụ response:**
```json
{
  "imageAnalysis": [
    {
      "id": "defect_description",
      "name": "Defect Description (VLM)",
      "description": "Use Vision-Language Model to describe defects",
      "requiredInputs": ["imageKey"],
      "optionalInputs": ["productModel", "machineCode"]
    }
  ],
  "dataAnalysis": [...],
  "reportGeneration": [...]
}
```

### 2.2 Phân Tích Ảnh Nhanh (Quick Quality Check)

Kết hợp VLM mô tả lỗi + tìm kiếm ảnh tương tự trong một bước.

```
POST aiAnalysisHub.quickQualityCheck
```

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---------|------|:--------:|-------|
| imageKey | string | ✅ | Đường dẫn ảnh trong hệ thống |
| modelId | number | ✅ | ID mô hình AI |
| productModel | string | | Mã sản phẩm |
| machineCode | string | | Mã máy |
| topK | number | | Số lượng ảnh tương tự (mặc định: 5) |

**Response:**
```json
{
  "analysisType": "quick_quality_check",
  "defectDescription": {
    "description": "Vết xước dài 2mm trên bề mặt PCB...",
    "severity": "medium",
    "confidence": 0.85
  },
  "similarDefects": {
    "totalFound": 3,
    "results": [
      { "imageKey": "...", "similarity": 0.92, "label": "scratch" }
    ]
  }
}
```

---

## 3. Phân Tích Ảnh

### 3.1 Mô Tả Lỗi Bằng VLM

```
POST aiAnalysisHub.imageDefectDescription
POST aiVisionLanguage.describeDefect
```

Sử dụng mô hình Vision-Language để phân tích và mô tả chi tiết lỗi trong ảnh kiểm tra.

| Tham số | Kiểu | Mô tả |
|---------|------|-------|
| imageKey | string | Đường dẫn ảnh |
| productModel | string? | Mã sản phẩm (context) |
| machineCode | string? | Mã máy (context) |
| inspectionPoint | string? | Điểm kiểm tra |

### 3.2 So Sánh Ảnh

```
POST aiAnalysisHub.imageComparison
POST aiVisionLanguage.compareImages
```

So sánh ảnh tham chiếu với ảnh kiểm tra để phát hiện sự khác biệt.

| Tham số | Kiểu | Mô tả |
|---------|------|-------|
| referenceImageKey | string | Ảnh tham chiếu (mẫu tốt) |
| testImageKey | string | Ảnh cần kiểm tra |
| productModel | string? | Mã sản phẩm |

### 3.3 Tìm Kiếm Ảnh Tương Tự

```
POST aiAnalysisHub.similarDefectSearch
POST aiImageSearch.searchByUpload
```

Tìm các ảnh lỗi tương tự dựa trên AI embeddings.

| Tham số | Kiểu | Mô tả |
|---------|------|-------|
| imageKey | string | Ảnh cần tìm tương tự |
| modelId | number | ID mô hình |
| topK | number | Số kết quả (mặc định: 10) |
| minSimilarity | number | Ngưỡng tương tự (0-1, mặc định: 0.7) |

### 3.4 Embedding và Cluster

```
POST aiImageSearch.embed       — Trích xuất và lưu embedding
POST aiImageSearch.clusterDefects — Phân cụm lỗi tương tự
GET  aiImageSearch.stats       — Thống kê embedding
```

---

## 4. Phân Tích Dữ Liệu

### 4.1 Phân Tích Chuỗi Thời Gian

```
POST aiAnalysisHub.timeSeriesAnalysis
POST aiTimeSeries.analyze
```

| Tham số | Kiểu | Mô tả |
|---------|------|-------|
| dataPoints | Array<{timestamp, value}> | Dữ liệu chuỗi thời gian (≥10 điểm) |
| algorithm | string | "ewma" \| "holt_winters" \| "isolation_forest" \| "seasonal_decompose" \| "change_point" |
| sensitivity | number | Độ nhạy (0-1, mặc định: 0.5) |
| seasonalPeriod | number? | Chu kỳ mùa vụ |

**Các thuật toán:**
- **EWMA**: Exponentially Weighted Moving Average — phát hiện anomaly dựa trên độ lệch
- **Holt-Winters**: Dự báo có tính đến xu hướng và mùa vụ
- **Isolation Forest**: Phát hiện ngoại lệ đa chiều
- **Seasonal Decompose**: Phân tách thành trend/seasonal/residual
- **Change Point**: Phát hiện điểm thay đổi đáng kể

### 4.2 Dự Báo Sản Xuất

```
POST aiAnalysisHub.productionForecast
POST aiTimeSeries.forecast
```

| Tham số | Kiểu | Mô tả |
|---------|------|-------|
| dataPoints | Array<{timestamp, value}> | Dữ liệu lịch sử |
| horizonSteps | number | Số bước dự báo (1-365) |
| confidenceLevel | number | Mức tin cậy (0.5-0.99, mặc định: 0.95) |

### 4.3 Phát Hiện Điểm Thay Đổi

```
POST aiAnalysisHub.changePointDetection
POST aiTimeSeries.changePoints
```

Phát hiện khi nào dữ liệu sản xuất thay đổi đáng kể (thay ca, hỏng máy, v.v.)

### 4.4 Phân Tách Mùa Vụ

```
POST aiAnalysisHub.seasonalDecomposition
POST aiTimeSeries.decompose
```

Phân tách chuỗi thời gian thành 3 thành phần: xu hướng (trend), mùa vụ (seasonal), phần dư (residual).

---

## 5. Quản Lý Mô Hình AI

### 5.1 CRUD Mô Hình

| Endpoint | Mô tả |
|----------|-------|
| `aiModel.list` | Danh sách mô hình |
| `aiModel.getById` | Chi tiết mô hình theo ID |
| `aiModel.getByCode` | Tìm mô hình theo mã |
| `aiModel.create` | Tạo mô hình mới |
| `aiModel.update` | Cập nhật mô hình |
| `aiModel.delete` | Xóa mô hình |

### 5.2 Quản Lý Phiên Bản

| Endpoint | Mô tả |
|----------|-------|
| `aiModel.versions` | Danh sách phiên bản |
| `aiModel.createVersion` | Tạo phiên bản mới |
| `aiModel.activate` | Kích hoạt mô hình |
| `aiModel.inference` | Chạy suy diễn |

### 5.3 Ví Dụ Tạo Mô Hình

```json
// POST aiModel.create
{
  "name": "PCB Defect Classifier v2",
  "code": "pcb-defect-v2",
  "type": "classification",
  "framework": "onnx",
  "inputFormat": {
    "width": 224,
    "height": 224,
    "channels": 3
  }
}
```

---

## 6. Quality Gate AI

### 6.1 Quản Lý Cấu Hình

| Endpoint | Mô tả |
|----------|-------|
| `aiQualityGate.listConfigs` | Danh sách cấu hình |
| `aiQualityGate.getConfig` | Chi tiết cấu hình |
| `aiQualityGate.createConfig` | Tạo cấu hình mới |
| `aiQualityGate.updateConfig` | Cập nhật cấu hình |
| `aiQualityGate.deleteConfig` | Xóa cấu hình |

### 6.2 Quản Lý Ensemble

| Endpoint | Mô tả |
|----------|-------|
| `aiQualityGate.listEnsembles` | Danh sách ensemble |
| `aiQualityGate.createEnsemble` | Tạo ensemble (kết hợp nhiều mô hình) |
| `aiQualityGate.updateEnsemble` | Cập nhật ensemble |
| `aiQualityGate.deleteEnsemble` | Xóa ensemble |

### 6.3 Đánh Giá Chất Lượng

```
POST aiQualityGate.evaluate      — Đánh giá 1 ảnh
POST aiQualityGate.batchEvaluate — Đánh giá hàng loạt
GET  aiQualityGate.getResults    — Lấy kết quả
```

---

## 7. Huấn Luyện Mô Hình

### 7.1 Huấn Luyện Nâng Cao (aiAdvanced.training)

| Endpoint | Mô tả |
|----------|-------|
| `aiAdvanced.training.createJob` | Tạo job huấn luyện |
| `aiAdvanced.training.getJob` | Xem chi tiết job |
| `aiAdvanced.training.listJobs` | Danh sách jobs |
| `aiAdvanced.training.cancelJob` | Hủy job |
| `aiAdvanced.training.deleteJob` | Xóa job |
| `aiAdvanced.training.createDataset` | Tạo dataset |
| `aiAdvanced.training.getDataset` | Chi tiết dataset |
| `aiAdvanced.training.listDatasets` | Danh sách datasets |
| `aiAdvanced.training.deleteDataset` | Xóa dataset |
| `aiAdvanced.training.getDataStats` | Thống kê dữ liệu |
| `aiAdvanced.training.checkAutoRetrain` | Kiểm tra auto-retrain |

### 7.2 Huấn Luyện Cục Bộ (aiLocalTraining)

Hỗ trợ 3 chiến lược huấn luyện:

| Chiến lược | Mô tả | Yêu cầu dữ liệu |
|-----------|-------|------------------|
| **transfer** | Transfer Learning | Trung bình (~100 ảnh/class) |
| **fewshot** | Few-Shot Learning | Ít (~5-20 ảnh/class) |
| **incremental** | Incremental Learning | Dữ liệu mới bổ sung |

| Endpoint | Mô tả |
|----------|-------|
| `aiLocalTraining.startTraining` | Bắt đầu huấn luyện |
| `aiLocalTraining.capabilities` | Kiểm tra khả năng mô hình |
| `aiLocalTraining.predict` | Dự đoán với classifier |
| `aiLocalTraining.listJobs` | Danh sách jobs huấn luyện |
| `aiLocalTraining.getJob` | Chi tiết job |
| `aiLocalTraining.deleteJob` | Xóa job |

**Ví dụ bắt đầu huấn luyện:**
```json
// POST aiLocalTraining.startTraining
{
  "modelId": 1,
  "strategy": "fewshot",
  "targetVersion": "v2.1",
  "classLabels": ["OK", "scratch", "dent", "crack"],
  "config": {
    "epochs": 50,
    "learningRate": 0.001,
    "earlyStopping": true,
    "samplesPerClass": 10
  }
}
```

---

## 8. A/B Testing

So sánh hiệu suất giữa các phiên bản mô hình.

| Endpoint | Mô tả |
|----------|-------|
| `aiAdvanced.abTest.create` | Tạo thí nghiệm A/B |
| `aiAdvanced.abTest.getById` | Chi tiết thí nghiệm |
| `aiAdvanced.abTest.list` | Danh sách thí nghiệm |
| `aiAdvanced.abTest.start` | Bắt đầu thí nghiệm |
| `aiAdvanced.abTest.runInference` | Chạy suy diễn A/B |
| `aiAdvanced.abTest.submitFeedback` | Gửi feedback |
| `aiAdvanced.abTest.stats` | Thống kê kết quả |
| `aiAdvanced.abTest.conclude` | Kết thúc thí nghiệm |
| `aiAdvanced.abTest.update` | Cập nhật thí nghiệm |
| `aiAdvanced.abTest.delete` | Xóa thí nghiệm |

**Quy trình A/B Testing:**
1. Tạo thí nghiệm với 2+ phiên bản mô hình
2. Bắt đầu thí nghiệm → phân chia traffic
3. Chạy suy diễn → mỗi request được route tới phiên bản theo tỷ lệ
4. Thu thập feedback từ người dùng
5. Xem thống kê → so sánh hiệu suất
6. Kết thúc và chọn phiên bản tốt nhất

---

## 9. AI Chat Assistant

Trợ lý AI hỗ trợ phân tích chất lượng, trả lời câu hỏi về dữ liệu sản xuất.

### 9.1 Quản Lý Cuộc Hội Thoại

| Endpoint | Mô tả |
|----------|-------|
| `aiChat.listConversations` | Danh sách hội thoại |
| `aiChat.getConversation` | Chi tiết + tin nhắn |
| `aiChat.createConversation` | Tạo hội thoại mới |
| `aiChat.updateConversation` | Đổi tiêu đề |
| `aiChat.deleteConversation` | Xóa hội thoại |

### 9.2 Tin Nhắn

| Endpoint | Mô tả |
|----------|-------|
| `aiChat.chat` | Gửi tin nhắn và nhận phản hồi AI |
| `aiChat.getMessages` | Lấy tin nhắn của hội thoại |
| `aiChat.deleteMessage` | Xóa tin nhắn |
| `aiChat.tools` | Danh sách công cụ AI có sẵn |

**Ví dụ chat:**
```json
// POST aiChat.chat
{
  "conversationId": 1,
  "message": "Phân tích tỷ lệ lỗi trên máy PCB-001 trong 7 ngày qua",
  "context": {
    "machineId": 5,
    "factoryId": 1
  }
}
```

---

## 10. AI Report Generation

### 10.1 Các Loại Báo Cáo

| Endpoint | Loại báo cáo | Mô tả |
|----------|-------------|-------|
| `aiReport.dailySummary` | Daily | Tóm tắt chất lượng hàng ngày |
| `aiReport.rcaReport` | RCA | Phân tích nguyên nhân gốc |
| `aiReport.modelPerformance` | Performance | Hiệu suất mô hình AI |
| `aiReport.executiveSummary` | Executive | Báo cáo tổng hợp cho quản lý |
| `aiReport.generate` | Tùy chọn | Tạo báo cáo theo loại |

Cũng truy cập qua AI Analysis Hub:
| Endpoint | Mô tả |
|----------|-------|
| `aiAnalysisHub.dailyQualitySummary` | Tóm tắt chất lượng hàng ngày |
| `aiAnalysisHub.rootCauseAnalysis` | Phân tích nguyên nhân gốc |
| `aiAnalysisHub.modelPerformanceReport` | Hiệu suất mô hình |
| `aiAnalysisHub.executiveSummary` | Báo cáo tổng hợp |

### 10.2 Tham Số Chung

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---------|------|:--------:|-------|
| startDate | string (ISO) | ✅ | Ngày bắt đầu |
| endDate | string (ISO) | ✅ | Ngày kết thúc |
| machineId | number | | Lọc theo máy |
| factoryId | number | | Lọc theo nhà máy |
| language | "en" \| "vi" | | Ngôn ngữ (mặc định: "en") |

---

## 11. Smart Alert Routing

Hệ thống cảnh báo thông minh tự động phân loại và điều hướng.

| Endpoint | Mô tả |
|----------|-------|
| `aiSmartAlertRouting.route` | Tạo và điều hướng cảnh báo |
| `aiSmartAlertRouting.acknowledge` | Xác nhận cảnh báo |
| `aiSmartAlertRouting.detectSpike` | Phát hiện đỉnh lỗi |
| `aiSmartAlertRouting.detectYieldDrop` | Phát hiện giảm năng suất |
| `aiSmartAlertRouting.processEscalation` | Xử lý leo thang tự động |
| `aiSmartAlertRouting.stats` | Thống kê cảnh báo |
| `aiSmartAlertRouting.cleanup` | Dọn dẹp cảnh báo cũ |

**Các loại cảnh báo:**
- `DEFECT_SPIKE` — Đỉnh lỗi bất thường
- `YIELD_DROP` — Giảm năng suất
- `MACHINE_FAILURE` — Hỏng máy
- `QUALITY_DEGRADATION` — Giảm chất lượng
- `PATTERN_ANOMALY` — Bất thường mẫu

**Mức độ nghiêm trọng:** `LOW` | `MEDIUM` | `HIGH` | `CRITICAL`

---

## 12. Edge Deployment

### 12.1 Triển Khai Biên (aiAdvanced.edge)

| Endpoint | Mô tả |
|----------|-------|
| `aiAdvanced.edge.create` | Tạo triển khai |
| `aiAdvanced.edge.getById` | Chi tiết triển khai |
| `aiAdvanced.edge.list` | Danh sách triển khai |
| `aiAdvanced.edge.delete` | Xóa triển khai |
| `aiAdvanced.edge.packageModel` | Đóng gói mô hình |
| `aiAdvanced.edge.updateStatus` | Cập nhật trạng thái |
| `aiAdvanced.edge.heartbeat` | Heartbeat thiết bị |
| `aiAdvanced.edge.syncResults` | Đồng bộ kết quả |

### 12.2 Edge Nâng Cao (aiEdgeEnhanced)

| Endpoint | Mô tả |
|----------|-------|
| `aiEdgeEnhanced.quantize` | Nén mô hình (INT8/FP16) |
| `aiEdgeEnhanced.otaUpdate` | Cập nhật OTA |
| `aiEdgeEnhanced.otaStatus` | Trạng thái OTA |
| `aiEdgeEnhanced.rollback` | Khôi phục phiên bản cũ |
| `aiEdgeEnhanced.fleetOverview` | Tổng quan thiết bị |
| `aiEdgeEnhanced.batchDeploy` | Triển khai hàng loạt |
| `aiEdgeEnhanced.comparePerformance` | So sánh hiệu suất |
| `aiEdgeEnhanced.deviceHealth` | Sức khỏe thiết bị |
| `aiEdgeEnhanced.syncWithConflictResolution` | Đồng bộ có xử lý xung đột |
| `aiEdgeEnhanced.syncStatus` | Trạng thái đồng bộ |

---

## 13. Active Learning

Tự động chọn mẫu cần gán nhãn để cải thiện mô hình.

| Endpoint | Mô tả |
|----------|-------|
| `aiActiveLearning.autoLabel` | Gán nhãn tự động |
| `aiActiveLearning.getQueue` | Hàng chờ gán nhãn |
| `aiActiveLearning.submitLabel` | Gửi nhãn |
| `aiActiveLearning.skipItem` | Bỏ qua mẫu |
| `aiActiveLearning.assignReviewer` | Phân công reviewer |
| `aiActiveLearning.uncertaintySampling` | Chọn mẫu không chắc chắn |
| `aiActiveLearning.diversitySampling` | Chọn mẫu đa dạng |
| `aiActiveLearning.checkRetrain` | Kiểm tra điều kiện retrain |
| `aiActiveLearning.stats` | Thống kê |
| `aiActiveLearning.labelAccuracy` | Chính xác nhãn |

---

## 14. AI Feedback System

Thu thập phản hồi từ người dùng để cải thiện mô hình.

| Endpoint | Mô tả |
|----------|-------|
| `aiFeedback.createSuggestion` | Tạo đề xuất cải thiện |
| `aiFeedback.getSuggestionsByInspection` | Xem đề xuất theo inspection |
| `aiFeedback.getPendingSuggestions` | Đề xuất chờ xử lý |
| `aiFeedback.submitFeedback` | Gửi phản hồi |
| `aiFeedback.listFeedback` | Danh sách phản hồi |

---

## 15. Tham Khảo API

### 15.1 Xác Thực

Tất cả endpoints AI yêu cầu đăng nhập (`protectedProcedure`). Một số endpoint quản trị yêu cầu quyền admin (`adminProcedure`).

### 15.2 Phân Quyền

| Tính năng | Quyền cần |
|-----------|----------|
| Xem/Truy vấn | `protectedProcedure` (user bất kỳ) |
| Tạo/Cập nhật/Xóa mô hình | `adminProcedure` |
| Tạo/Xóa training job | `adminProcedure` |
| Tạo A/B test | `adminProcedure` |
| Triển khai Edge | `adminProcedure` |
| Chat / Phân tích | `protectedProcedure` |

### 15.3 Cách Sử Dụng Từ Client (tRPC)

```typescript
// Khám phá chức năng AI
const capabilities = await trpc.aiAnalysisHub.getCapabilities.query({
  category: "image"
});

// Phân tích ảnh nhanh
const result = await trpc.aiAnalysisHub.quickQualityCheck.mutate({
  imageKey: "inspections/2024/01/15/img001.jpg",
  modelId: 1,
  productModel: "PCB-A100",
});

// Phân tích chuỗi thời gian
const analysis = await trpc.aiAnalysisHub.timeSeriesAnalysis.mutate({
  dataPoints: [...],
  algorithm: "holt_winters",
  sensitivity: 0.7,
});

// Chat AI
const chatResponse = await trpc.aiChat.chat.mutate({
  conversationId: 1,
  message: "Tỷ lệ lỗi hôm nay bao nhiêu?",
});

// Tạo báo cáo
const report = await trpc.aiAnalysisHub.dailyQualitySummary.mutate({
  startDate: "2024-01-15",
  endDate: "2024-01-15",
  language: "vi",
});
```

### 15.4 Error Codes

| Mã lỗi | Ý nghĩa |
|---------|---------|
| `NOT_FOUND` | Không tìm thấy tài nguyên |
| `INTERNAL_SERVER_ERROR` | Lỗi máy chủ / DB không khả dụng |
| `UNAUTHORIZED` | Chưa đăng nhập |
| `FORBIDDEN` | Không đủ quyền |
| `BAD_REQUEST` | Dữ liệu đầu vào không hợp lệ |

---

> **Ghi chú:** Tài liệu này được tạo tự động dựa trên source code. Vui lòng cập nhật khi thêm endpoint mới.
