# AI Model API — Quản lý mô hình AI & Inference

**Router**: `aiModel`  
**Base URL**: `http://<server>:<port>/api/trpc/aiModel.<endpoint>`  
**Xác thực**: Session-based (Cookie) — Yêu cầu đăng nhập qua giao diện web

> **Quan trọng**: API này sử dụng xác thực session-based, KHÁC với Machine API và Product API (dùng apiKey/machineCode). Xem [AUTHENTICATION.md](AUTHENTICATION.md#ai-model-api-session-based) để biết cách đăng nhập.

---

## Mục lục

### Model CRUD
1. [list](#1-list) — Danh sách mô hình AI
2. [getById](#2-getbyid) — Chi tiết mô hình theo ID
3. [getByCode](#3-getbycode) — Chi tiết mô hình theo code
4. [create](#4-create) — Tạo mô hình mới (**Admin**)
5. [update](#5-update) — Cập nhật mô hình (**Admin**)
6. [delete](#6-delete) — Xóa mô hình (**Admin**)

### File & Version Management
7. [uploadFile](#7-uploadfile) — Upload file mô hình (**Admin**)
8. [listVersions](#8-listversions) — Danh sách phiên bản
9. [createVersion](#9-createversion) — Tạo phiên bản mới (**Admin**)
10. [activateVersion](#10-activateversion) — Kích hoạt phiên bản (**Admin**)
11. [getFileUrl](#11-getfileurl) — URL file mô hình

### Inference
12. [runInference](#12-runinference) — Chạy suy luận AI
13. [getInferenceResults](#13-getinferenceresults) — Lịch sử kết quả suy luận
14. [getInferenceStats](#14-getinferencestats) — Thống kê suy luận

### Utilities
15. [getActiveForProduct](#15-getactiveforproduct) — Mô hình đang active cho sản phẩm
16. [loadedModels](#16-loadedmodels) — Mô hình đang tải trong bộ nhớ

---

## Phân quyền

| Nhóm | Quyền yêu cầu |
|------|---------------|
| `protectedProcedure` | Đăng nhập (bất kỳ user nào) |
| `adminProcedure` | Đăng nhập + quyền Admin |

---

## Model Status Lifecycle

```
UPLOADING → VALIDATING → READY → ACTIVE
                                    ↓
                                INACTIVE
                                    ↓
                                ARCHIVED

       (bất kỳ bước nào) → FAILED
```

| Status | Mô tả |
|--------|-------|
| `UPLOADING` | Đang upload file mô hình |
| `VALIDATING` | Đang kiểm tra tính hợp lệ |
| `READY` | Sẵn sàng sử dụng |
| `ACTIVE` | Đang được dùng cho suy luận |
| `INACTIVE` | Tạm ngưng |
| `FAILED` | Upload/validation thất bại |
| `ARCHIVED` | Đã lưu trữ |

---

## 1. list

Lấy danh sách mô hình AI với bộ lọc.

- **Loại**: Query (GET)
- **Quyền**: `protectedProcedure`

### Input (tùy chọn)

```typescript
{
  modelType?: string,                // Lọc theo loại mô hình
  format?: "ONNX" | "TENSORRT" | "OPENVINO" | "CUSTOM",
  status?: "UPLOADING" | "VALIDATING" | "READY" | "ACTIVE" | "INACTIVE" | "FAILED" | "ARCHIVED",
  productModelId?: number,           // Lọc theo sản phẩm liên kết
  limit?: number,                    // 1-200
  offset?: number,                   // >= 0
}
```

### Output

```json
{
  "result": {
    "data": {
      "json": [
        {
          "id": 1,
          "code": "defect-detect-v2",
          "name": "Defect Detection Model V2",
          "description": "...",
          "modelType": "classification",
          "format": "ONNX",
          "status": "ACTIVE",
          "currentVersion": "2.1.0",
          "inputShape": [1, 3, 224, 224],
          "outputShape": [1, 5],
          "labels": ["OK", "scratch", "dent", "crack", "stain"],
          "preprocessConfig": {
            "resize": { "width": 224, "height": 224 },
            "normalize": { "mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225] },
            "colorSpace": "RGB",
            "channelFirst": true
          },
          "postprocessConfig": {
            "type": "softmax",
            "confidenceThreshold": 0.7,
            "topK": 3
          },
          "productModelId": 5,
          "filePath": "/uploads/ai-models/...",
          "createdAt": "2024-01-15T08:00:00.000Z",
          "updatedAt": "2024-01-20T10:30:00.000Z"
        }
      ]
    }
  }
}
```

---

## 2. getById

Lấy chi tiết mô hình theo ID.

- **Loại**: Query (GET)
- **Quyền**: `protectedProcedure`

### Input

```typescript
{ id: number }
```

### Output

Trả về object mô hình đầy đủ (xem cấu trúc ở [list](#1-list)).

### Errors

| Code | Khi nào |
|------|---------|
| `NOT_FOUND` | ID không tồn tại |

---

## 3. getByCode

Lấy chi tiết mô hình theo code.

- **Loại**: Query (GET)
- **Quyền**: `protectedProcedure`

### Input

```typescript
{ code: string }
```

### Output

Trả về object mô hình đầy đủ.

---

## 4. create

Tạo mô hình AI mới. Mô hình sẽ được khởi tạo với status `UPLOADING`.

- **Loại**: Mutation (POST)
- **Quyền**: `adminProcedure` (chỉ Admin)

### Input

```typescript
{
  code: string,                      // 1-100 ký tự, unique
  name: string,                      // 1-255 ký tự
  description?: string,
  modelType: string,                 // Ví dụ: "classification", "detection", "segmentation"
  format?: "ONNX" | "TENSORRT" | "OPENVINO" | "CUSTOM",

  // Shape configuration
  inputShape?: number[],             // Ví dụ: [1, 3, 224, 224] (batch, channels, height, width)
  outputShape?: number[],            // Ví dụ: [1, 5] (batch, num_classes)
  labels?: string[],                 // Ví dụ: ["OK", "scratch", "dent"]

  // Preprocessing pipeline
  preprocessConfig?: {
    resize?: { width: number, height: number },
    normalize?: {
      mean: number[],                // Ví dụ: [0.485, 0.456, 0.406]
      std: number[],                 // Ví dụ: [0.229, 0.224, 0.225]
    },
    colorSpace?: "RGB" | "BGR" | "GRAY",
    channelFirst?: boolean,          // NCHW (true) vs NHWC (false)
  },

  // Postprocessing
  postprocessConfig?: {
    type: string,                    // "softmax", "sigmoid", "argmax", etc.
    confidenceThreshold?: number,    // Ngưỡng tin cậy (0-1)
    nmsThreshold?: number,           // Non-max suppression (cho detection)
    topK?: number,                   // Số kết quả tối đa
  },

  productModelId?: number,           // Liên kết với sản phẩm
  metadata?: Record<string, unknown>,// Custom metadata
}
```

### Output

```json
{
  "result": {
    "data": {
      "json": {
        "id": 10,
        "code": "defect-detect-v2",
        "status": "UPLOADING",
        "createdBy": 1,
        "..."
      }
    }
  }
}
```

---

## 5. update

Cập nhật thông tin mô hình.

- **Loại**: Mutation (POST)
- **Quyền**: `adminProcedure`

### Input

```typescript
{
  id: number,                        // BẮT BUỘC
  name?: string,
  description?: string,
  modelType?: string,
  inputShape?: number[],
  outputShape?: number[],
  labels?: string[],
  preprocessConfig?: { /* giống create */ },
  postprocessConfig?: { /* giống create */ },
  productModelId?: number,
  metadata?: Record<string, unknown>,
}
```

> **Lưu ý**: Không thể thay đổi `code` và `format` sau khi tạo.

---

## 6. delete

Xóa mô hình AI. **Session cache sẽ tự động bị evict.**

- **Loại**: Mutation (POST)
- **Quyền**: `adminProcedure`

### Input

```typescript
{ id: number }
```

### Output

```json
{ "result": { "data": { "json": { "success": true } } } }
```

---

## 7. uploadFile

Upload file mô hình (ONNX, etc.) dạng base64.

- **Loại**: Mutation (POST)
- **Quyền**: `adminProcedure`

### Input

```typescript
{
  modelId: number,                   // ID mô hình
  fileBase64: string,                // Nội dung file encode base64
  filename: string,                  // Tên file, ví dụ: "model.onnx"
  contentType?: string,              // MIME type
}
```

### Ví dụ (Python)

```python
import base64, requests

with open("model.onnx", "rb") as f:
    file_b64 = base64.b64encode(f.read()).decode()

session.post(f"{BASE_URL}/api/trpc/aiModel.uploadFile", json={
    "json": {
        "modelId": 10,
        "fileBase64": file_b64,
        "filename": "model.onnx",
        "contentType": "application/octet-stream"
    }
})
```

> **Giới hạn body**: 50MB. Nếu file mô hình lớn hơn, hãy tách thành nhiều version upload.

---

## 8. listVersions

Danh sách phiên bản của mô hình.

- **Loại**: Query (GET)
- **Quyền**: `protectedProcedure`

### Input

```typescript
{ modelId: number }
```

### Output

```json
{
  "result": {
    "data": {
      "json": [
        {
          "id": 1,
          "modelId": 10,
          "version": "1.0.0",
          "filePath": "/uploads/ai-models/...",
          "changeLog": "Initial version",
          "isActive": true,
          "metrics": { "accuracy": 0.95, "f1": 0.93 },
          "createdAt": "2024-01-15T08:00:00.000Z",
          "createdBy": 1
        }
      ]
    }
  }
}
```

---

## 9. createVersion

Tạo phiên bản mới cho mô hình với file mới.

- **Loại**: Mutation (POST)
- **Quyền**: `adminProcedure`

### Input

```typescript
{
  modelId: number,
  version: string,                   // Ví dụ: "2.0.0"
  fileBase64: string,                // File mô hình encode base64
  filename: string,
  changeLog?: string,                // Mô tả thay đổi
}
```

---

## 10. activateVersion

Kích hoạt phiên bản cụ thể. **Session cache ONNX sẽ tự động bị evict** để load phiên bản mới.

- **Loại**: Mutation (POST)
- **Quyền**: `adminProcedure`

### Input

```typescript
{
  modelId: number,
  versionId: number,
}
```

---

## 11. getFileUrl

Lấy URL file mô hình hiện tại.

- **Loại**: Query (GET)
- **Quyền**: `protectedProcedure`

### Input

```typescript
{ modelId: number }
```

---

## 12. runInference

Chạy suy luận AI trên một ảnh.

- **Loại**: Mutation (POST)
- **Quyền**: `protectedProcedure`

### Input

```typescript
{
  modelId: number,                   // ID mô hình sẽ dùng
  imageBase64: string,               // Ảnh encode base64 (JPEG/PNG)
  inspectionId?: number,             // Liên kết kết quả với inspection
  measurementResultId?: number,      // Liên kết với measurement result
  inputReference?: string,           // Mô tả tham chiếu input
}
```

### Output

```json
{
  "result": {
    "data": {
      "json": {
        "predictions": [
          { "label": "OK", "confidence": 0.92 },
          { "label": "scratch", "confidence": 0.05 },
          { "label": "dent", "confidence": 0.03 }
        ],
        "inferenceTimeMs": 45,
        "modelVersion": "2.1.0"
      }
    }
  }
}
```

### Quy trình inference nội bộ

1. Load ONNX session (cached nếu đã load)
2. **Preprocessing**: resize → normalize → channel ordering → tensor
3. **Run session**: `session.run("input", tensor)`
4. **Postprocess**: softmax → lọc theo `confidenceThreshold` → topK
5. **Lưu kết quả** vào DB (fire-and-forget)

### Ví dụ (Python)

```python
import base64

with open("test_image.jpg", "rb") as f:
    image_b64 = base64.b64encode(f.read()).decode()

response = session.post(f"{BASE_URL}/api/trpc/aiModel.runInference", json={
    "json": {
        "modelId": 10,
        "imageBase64": image_b64,
        "inspectionId": 12345
    }
})
result = response.json()
predictions = result["result"]["data"]["json"]["predictions"]

for p in predictions:
    print(f"  {p['label']}: {p['confidence']:.2%}")
```

---

## 13. getInferenceResults

Lấy lịch sử kết quả suy luận.

- **Loại**: Query (GET)
- **Quyền**: `protectedProcedure`

### Input (tùy chọn)

```typescript
{
  modelId?: number,
  inspectionId?: number,
  measurementResultId?: number,
  status?: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "TIMEOUT",
  limit?: number,                    // 1-200
  offset?: number,
}
```

---

## 14. getInferenceStats

Thống kê suy luận của mô hình.

- **Loại**: Query (GET)
- **Quyền**: `protectedProcedure`

### Input

```typescript
{ modelId: number }
```

### Output (ví dụ)

```json
{
  "result": {
    "data": {
      "json": {
        "totalInferences": 15420,
        "completedCount": 15380,
        "failedCount": 40,
        "averageInferenceTimeMs": 52.3,
        "labelDistribution": {
          "OK": 14200,
          "scratch": 800,
          "dent": 380
        }
      }
    }
  }
}
```

---

## 15. getActiveForProduct

Lấy mô hình đang ACTIVE cho sản phẩm cụ thể.

- **Loại**: Query (GET)
- **Quyền**: `protectedProcedure`

### Input

```typescript
{
  productModelId: number,            // ID sản phẩm
  modelType?: string,                // Lọc theo loại mô hình
}
```

---

## 16. loadedModels

Xem danh sách mô hình ONNX đang được cache trong bộ nhớ.

- **Loại**: Query (GET)
- **Quyền**: `protectedProcedure`
- **Input**: Không có

### Output

```json
{
  "result": {
    "data": {
      "json": [
        {
          "key": "10:2.1.0",
          "modelId": 10,
          "version": "2.1.0"
        }
      ]
    }
  }
}
```

---

## Preprocessing Config Reference

Pipeline preprocessing được áp dụng trước khi đưa ảnh vào mô hình:

```
Input Image → Resize → Color Convert → Normalize → Channel Reorder → Tensor
```

| Bước | Config | Mô tả |
|------|--------|-------|
| Resize | `resize.width`, `resize.height` | Scale ảnh về kích thước input mô hình |
| Color | `colorSpace` | Chuyển đổi: `RGB`, `BGR`, hoặc `GRAY` |
| Normalize | `normalize.mean`, `normalize.std` | `(pixel - mean) / std` cho từng channel |
| Channel | `channelFirst` | `true` = NCHW (PyTorch), `false` = NHWC (TensorFlow) |

### Ví dụ cấu hình phổ biến

**ResNet (ImageNet pretrained)**:
```json
{
  "resize": { "width": 224, "height": 224 },
  "normalize": { "mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225] },
  "colorSpace": "RGB",
  "channelFirst": true
}
```

**YOLO (Detection)**:
```json
{
  "resize": { "width": 640, "height": 640 },
  "normalize": { "mean": [0, 0, 0], "std": [255, 255, 255] },
  "colorSpace": "RGB",
  "channelFirst": true
}
```
