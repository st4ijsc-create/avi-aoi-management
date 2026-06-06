# Báo Cáo Nâng Cấp: /ai-image-search & /ai-data-processing

**Ngày lập:** 2026-05-20  
**Phiên bản hiện tại:** Đang vận hành  
**Phương pháp:** AI Agent audit toàn bộ page, router, service — 247 dòng + 562 dòng + 163 dòng + 349 dòng  
**Mục tiêu nâng cấp:** Tối đa hóa giá trị cho kỹ thuật viên và nhân viên QA (nhóm sử dụng nhiều nhất)

---

## 1. Tóm Tắt Điều Tra

### 1.1 Mức độ hoàn thiện hiện tại

| Chức năng | UI | Router | Service | Kết luận |
|---|---|---|---|---|
| `/ai-image-search` — Search | ✅ Hoạt động | ✅ Hoàn chỉnh | ✅ Đang dùng | Thiếu UX, đủ logic |
| `/ai-image-search` — Embed | ⚠️ Chỉ nhập ID | ✅ Hoàn chỉnh | ✅ Đang dùng | Thiếu upload file |
| `/ai-image-search` — Cluster | ✅ Button có | ✅ Hoàn chỉnh | ✅ Đang dùng | Thiếu feedback |
| `/ai-data-processing` — Pipeline | ✅ UI có | ⛔ Hardcoded | ⛔ Không thực thi | **PLACEHOLDER** |
| `/ai-data-processing` — Preprocessing | ✅ UI có | ⛔ Không có mutation | ⛔ Không thực thi | **DEAD UI** |
| `/ai-data-processing` — Augmentation | ✅ UI có | ⛔ Hardcoded | ⛔ Không thực thi | **PLACEHOLDER** |

### 1.2 Phát hiện nghiêm trọng

> ⛔ **CRITICAL:** Toàn bộ `/ai-data-processing` (Pipeline + Augmentation) đang trả về hardcoded response `{ success: true }` — không xử lý ảnh thực tế. Comment trong code: *"in production, query from actual pipeline tables"*. Người dùng bấm "Run Pipeline" nhưng không có gì chạy.

> ⛔ **CRITICAL:** Tab Preprocessing hoàn toàn không có mutation — các toggle/input chỉ cập nhật state React cục bộ, không lưu và không áp dụng cho ảnh nào.

> ⚠️ **WARNING:** API key của AI Settings dùng base64 làm "mã hóa" — thực chất là reversible encoding, không phải encryption.

---

## 2. Nhóm Người Dùng & Nhu Cầu Thực Tế

Dựa trên phân tích vai trò và luồng công việc nhà máy, nhóm sử dụng nhiều nhất là:

| Thứ tự | Nhóm | Tần suất | Nhu cầu chính |
|---|---|---|---|
| 1 | **Kỹ thuật viên AI/QA** | Hàng ngày | Embed ảnh → tìm tương tự → gom cluster để phân tích lỗi; chuẩn bị dataset training |
| 2 | **Nhân viên vận hành / QA** | Vài lần/tuần | Tra nhanh ảnh lỗi → đối chiếu case cũ → báo cáo |
| 3 | **Quản lý sản xuất** | Hàng tuần | Xem tổng quan cluster lỗi; theo dõi trạng thái pipeline data |
| 4 | **Công nhân** | Hiếm | Chỉ cần kết quả đơn giản, rõ ràng |
| 5 | **CEO** | Không trực tiếp | Nhìn dashboard tổng thể |

---

## 3. Danh Sách Gap Theo Ưu Tiên

### 3.1 /ai-image-search — Gap & Mức Độ

| # | Gap | Ảnh hưởng | Nhóm bị ảnh hưởng | Mức độ ưu tiên |
|---|---|---|---|---|
| IS-1 | Không có file picker để upload ảnh — chỉ nhập ID | Người dùng không biết ID phải tìm ở đâu | Kỹ thuật, QA, Công nhân | 🔴 P0 |
| IS-2 | Không hiển thị bộ lọc (machineId, productModel, label, minSimilarity) dù API đã hỗ trợ | Tìm kiếm không có context, nhiều kết quả rác | Kỹ thuật, QA | 🔴 P0 |
| IS-3 | Clustering không có status/progress — chỉ disable button | Người dùng không biết đang chạy hay lỗi | Kỹ thuật | 🔴 P0 |
| IS-4 | `searchByUpload` mutation đã có nhưng không dùng trong UI | Tính năng quan trọng nhất bị ẩn | Tất cả | 🔴 P0 |
| IS-5 | Không có similarity threshold control trong UI | Kết quả không kiểm soát được độ chính xác | Kỹ thuật, QA | 🟠 P1 |
| IS-6 | Không có export kết quả (CSV/ZIP) | Không lấy được dữ liệu ra ngoài để phân tích | Kỹ thuật, Quản lý | 🟠 P1 |
| IS-7 | Không có pagination — chỉ Top K, không có "tải thêm" | Hạn chế khi cần xem nhiều kết quả | Kỹ thuật | 🟡 P2 |
| IS-8 | Ảnh lỗi tải không hiển thị fallback | UX broken khi ảnh bị xóa hoặc path sai | Tất cả | 🟡 P2 |
| IS-9 | Không có refresh stats — chỉ load lần đầu | Stats stale sau khi embed mới | Kỹ thuật | 🟡 P2 |
| IS-10 | Không có batch embed — chỉ 1 ảnh/lần | Mất thời gian khi cần embed nhiều ảnh | Kỹ thuật | 🟡 P2 |
| IS-11 | Không có help text giải thích Embedding ID là gì | Công nhân / nhân viên mới không dùng được | Công nhân, Nhân viên | 🟢 P3 |
| IS-12 | Kết quả cluster không có nhãn/tên gợi ý | Khó phân biệt cluster nào là loại lỗi gì | Quản lý, Kỹ thuật | 🟢 P3 |

### 3.2 /ai-data-processing — Gap & Mức Độ

| # | Gap | Ảnh hưởng | Nhóm bị ảnh hưởng | Mức độ ưu tiên |
|---|---|---|---|---|
| DP-1 | **Pipeline hoàn toàn giả** — `runDataPipeline` hardcoded `{success: true}` | Không xử lý ảnh nào dù UI hiển thị thành công | Tất cả | 🔴 P0 |
| DP-2 | **Augmentation giả** — `runAugmentation` hardcoded | Gây hiểu nhầm nghiêm trọng; dữ liệu không được tăng cường | Kỹ thuật | 🔴 P0 |
| DP-3 | **Preprocessing không có action** — toggles không lưu, không áp dụng | Dead UI; cài đặt mất khi reload | Kỹ thuật | 🔴 P0 |
| DP-4 | Stats luôn là 0 — không đọc từ DB thật | Người dùng không thấy được tiến độ thực | Kỹ thuật, Quản lý | 🔴 P0 |
| DP-5 | Source/Output directory read-only — không đổi được | Không linh hoạt khi thay đổi môi trường | Kỹ thuật | 🟠 P1 |
| DP-6 | Không có progress indicator trong lúc chạy pipeline | Không biết đã xử lý được bao nhiêu ảnh | Kỹ thuật | 🟠 P1 |
| DP-7 | Không có preview before/after preprocessing | Người dùng không kiểm tra được kết quả cài đặt | Kỹ thuật | 🟠 P1 |
| DP-8 | Augmentation không có preview mẫu | Không biết ảnh sau flip/rotate/blur trông như thế nào | Kỹ thuật | 🟡 P2 |
| DP-9 | Không có retry khi pipeline lỗi | Phải refresh page và chạy lại từ đầu | Kỹ thuật | 🟡 P2 |
| DP-10 | Không có log/history của các lần chạy pipeline | Không audit được ai chạy, khi nào, kết quả gì | Quản lý | 🟡 P2 |
| DP-11 | Không auto-refresh stats khi pipeline đang chạy | Stats luôn cũ dù trạng thái `running` | Tất cả | 🟡 P2 |
| DP-12 | Không có phân tách rõ config vs runtime — tất cả input trộn lẫn | Gây nhầm lẫn: cái nào cần lưu, cái nào kích hoạt ngay | Kỹ thuật | 🟢 P3 |

---

## 4. Kế Hoạch Nâng Cấp Theo Giai Đoạn

### Phase 1 — Sửa Lỗi Nghiêm Trọng (Sprint 1–2, ~3 tuần)

**Mục tiêu:** Làm cho 2 chức năng thực sự hoạt động đúng với những gì UI đã hứa.

#### 4.1 Triển khai thực `/ai-data-processing` Pipeline

```
Backend:
  - Tạo bảng training_pipeline_jobs (id, status, totalImages, processedImages, failedImages, startedAt, completedAt, config)
  - Triển khai runDataPipeline: quét ảnh từ sourceDir → copy/convert → cập nhật DB
  - Triển khai getDataPipelineStats: đọc từ bảng thật
  - Thêm polling endpoint (hoặc WebSocket) để theo dõi tiến độ

Frontend:
  - Stats cards đọc từ DB thật
  - Polling mỗi 3 giây khi status = 'running'
  - Progress bar hiển thị processedImages/totalImages
```

#### 4.2 Triển khai thực Augmentation

```
Backend:
  - Triển khai runAugmentation: dùng sharp hoặc jimp để:
    • flip, rotate, brightness, contrast, noise, crop, blur
    • Tạo N bản sao mỗi ảnh theo multiplier
    • Lưu kết quả vào outputDir
  - Lưu kết quả vào training_datasets

Frontend:
  - Thêm progress indicator riêng cho augmentation
  - Hiển thị output count = input × multiplier × n_augments
```

#### 4.3 Lưu và áp dụng Preprocessing settings

```
Backend:
  - Thêm procedure savePreprocessingConfig (lưu vào aiSystemConfig)
  - Tích hợp preprocessing vào pipeline: khi chạy, áp resize/normalize/grayscale/bgRemoval

Frontend:
  - Thêm nút "Save Config" trong tab Preprocessing
  - Hiển thị thông báo "Cấu hình đã lưu" và "Cấu hình sẽ được áp dụng ở lần chạy tiếp theo"
```

#### 4.4 Upload ảnh trực tiếp trong /ai-image-search

```
Frontend:
  - Thêm file picker (<input type="file">) trong tab Embed
  - Convert file → base64 → gọi embed mutation
  - Cho phép drag & drop ảnh
  - Hiển thị thumbnail preview trước khi submit

Backend:
  - Đảm bảo searchByUpload nhận base64 hoặc multipart
```

---

### Phase 2 — Cải Thiện UX Cho Kỹ Thuật & QA (Sprint 3–4, ~2 tuần)

**Mục tiêu:** Tăng hiệu quả cho nhóm sử dụng nhiều nhất.

#### 4.5 Bộ lọc tìm kiếm trong Image Search

```
Frontend:
  - Thêm filter panel (collapsible) trong tab Search:
    • Machine ID (dropdown từ danh sách máy)
    • Product Model (dropdown)
    • Label / Defect Type (dropdown)
    • Min Similarity (slider 0.5–1.0, default 0.7)
  - Tất cả filter đã có sẵn trong API — chỉ cần đưa lên UI
```

#### 4.6 Trực tiếp tìm bằng ảnh upload (searchByUpload)

```
Frontend:
  - Thêm tab thứ 3 "Upload & Search" (hoặc gộp vào tab Search):
    • Upload ảnh → tự động tạo embedding → hiển thị kết quả tương tự ngay
    • Không cần biết Embedding ID
  - Gọi trpc.aiImageSearch.searchByUpload (đã có trong router, chưa dùng trong UI)
```

#### 4.7 Cluster results có nhãn và actions

```
Frontend:
  - Sau khi Cluster chạy xong, hiển thị danh sách cluster:
    • Mỗi cluster: số lượng ảnh, ảnh đại diện (thumbnail), confidence
    • Nút "Xem ảnh trong cluster"
    • Nút "Gán nhãn cluster" (defect type)
  - Progress toast khi clustering đang chạy
```

#### 4.8 Export kết quả

```
Frontend:
  - Nút "Export CSV" cho kết quả tìm kiếm (imageId, similarity, label, inspectionDate)
  - Nút "Download ZIP" cho top results (ảnh gốc)
```

---

### Phase 3 — Hỗ Trợ Quản Lý & Giám Sát (Sprint 5, ~1 tuần)

**Mục tiêu:** Đưa thông tin lên cấp ra quyết định.

#### 4.9 Pipeline History & Audit Log

```
Backend:
  - Thêm bảng pipeline_run_history (id, runBy, startedAt, completedAt, processedCount, failedCount, config)
  - Endpoint getRunHistory (top 20 lần chạy gần nhất)

Frontend:
  - Thêm tab "History" trong Data Processing:
    • Bảng lịch sử: thời gian, người chạy, số ảnh xử lý, trạng thái
    • Nút "Xem chi tiết" cho từng lần chạy
```

#### 4.10 Summary Dashboard cho Image Search

```
Frontend:
  - Thêm card "Phân bố lỗi theo cluster" (pie chart nhỏ)
  - Thêm card "Top 5 defect type phổ biến nhất"
  - Thêm card "Embedding mới trong 7 ngày"
  - Mục tiêu: quản lý nhìn vào biết ngay tình trạng dữ liệu
```

---

### Phase 4 — Hỗ Trợ Công Nhân & Nhân Viên (Sprint 6, ~1 tuần)

**Mục tiêu:** Giảm ngưỡng kỹ thuật để nhóm ít kinh nghiệm AI cũng dùng được.

#### 4.11 Help Text & Onboarding

```
Frontend (/ai-image-search):
  - Tooltip cho "Embedding ID": "ID của ảnh đã được mã hóa vector, tìm trong danh sách Embed hoặc lịch sử inspection"
  - Info card đầu trang: "Cách dùng nhanh: 1. Upload ảnh lỗi → 2. Hệ thống tìm ảnh giống nhất → 3. Xem lịch sử xử lý"
  - Empty state gợi ý hành động: "Chưa có kết quả. Thử upload một ảnh để bắt đầu."

Frontend (/ai-data-processing):
  - Info card đầu tab: giải thích ngắn gọn mỗi tab làm gì
  - Tooltip cho các cài đặt kỹ thuật (letterbox, CLAHE, augmentation types)
```

#### 4.12 Simplified Mode (tùy chọn)

```
Ý tưởng: Nếu role = worker/staff → ẩn các cài đặt nâng cao, chỉ hiển thị:
  - Image Search: Upload ảnh → Xem kết quả tương tự
  - Data Processing: Nút "Chuẩn bị dữ liệu" đơn giản với cài đặt mặc định
Có thể implement qua permission hoặc toggle "Chế độ đơn giản / Nâng cao"
```

---

## 5. Bảng Ưu Tiên Tổng Hợp

| Hạng | Việc cần làm | Phase | Effort | Impact | Nhóm hưởng lợi |
|---|---|---|---|---|---|
| 1 | Triển khai Pipeline thật (DP-1, DP-4) | P1 | High | 🔴 Critical | Kỹ thuật |
| 2 | Triển khai Augmentation thật (DP-2) | P1 | High | 🔴 Critical | Kỹ thuật |
| 3 | Upload file picker cho Embed (IS-1, IS-4) | P1 | Medium | 🔴 Critical | Kỹ thuật, QA, Công nhân |
| 4 | Lưu & áp dụng Preprocessing config (DP-3) | P1 | Medium | 🔴 Critical | Kỹ thuật |
| 5 | Bộ lọc tìm kiếm (IS-2) | P2 | Low | 🟠 High | Kỹ thuật, QA |
| 6 | searchByUpload trong UI (IS-4) | P2 | Low | 🟠 High | Tất cả |
| 7 | Progress indicator pipeline (DP-6) | P2 | Low | 🟠 High | Kỹ thuật |
| 8 | Cluster results với actions (IS-3) | P2 | Medium | 🟠 High | Kỹ thuật |
| 9 | Export CSV/ZIP (IS-6) | P2 | Medium | 🟠 High | Kỹ thuật, Quản lý |
| 10 | Pipeline run history (DP-10) | P3 | Medium | 🟡 Medium | Quản lý |
| 11 | Summary dashboard image search (new) | P3 | Medium | 🟡 Medium | Quản lý, CEO |
| 12 | Help text & tooltip (IS-11) | P4 | Low | 🟡 Medium | Công nhân, Nhân viên |
| 13 | Similarity threshold slider (IS-5) | P2 | Low | 🟡 Medium | Kỹ thuật |
| 14 | Image fallback (IS-8) | P2 | Low | 🟢 Low | Tất cả |
| 15 | Simplified mode (new) | P4 | High | 🟢 Low | Công nhân |

---

## 6. Rủi Ro & Lưu Ý

| Rủi ro | Mô tả | Đề xuất |
|---|---|---|
| API key bảo mật | Base64 không phải encryption — key AI provider có thể bị lộ | Dùng `crypto.createCipheriv` (AES-256-GCM) hoặc tích hợp với secrets manager |
| pgvector dependency | Similarity search yêu cầu pgvector extension — nếu thiếu, tab Search crash | Hiển thị warning rõ ràng trên UI nếu extension chưa cài; fallback sang cosine JS |
| Pipeline thật vs placeholder | Khi triển khai pipeline thật, cần kiểm soát concurrent runs — nhiều người bấm cùng lúc | Thêm job queue (BullMQ hoặc DB-based), chỉ cho chạy 1 job/thời điểm |
| Augmentation disk space | Augmentation 20x có thể tạo ra lượng ảnh rất lớn | Thêm cảnh báo "Ước tính dung lượng: X GB" trước khi chạy |
| Performance embedding | `findSimilar` không có index — với > 10k embeddings có thể chậm | Thêm IVFFlat index trong pgvector sau khi dữ liệu đủ lớn |

---

## 7. Metric Đo Lường Sau Nâng Cấp

| Metric | Hiện tại | Mục tiêu sau Phase 2 |
|---|---|---|
| Thời gian tìm ảnh tương tự | ~30 giây (nhập ID thủ công) | < 10 giây (upload trực tiếp) |
| Tỷ lệ pipeline thực thi thành công | 0% (placeholder) | > 95% |
| Số bước để embed 1 ảnh mới | 4 bước (tìm ID → nhập → submit → đợi) | 2 bước (upload → submit) |
| Tỷ lệ người dùng mới hiểu cách dùng | Thấp (không có help text) | > 70% sau 5 phút |

---

*Báo cáo được tạo bởi AI Agent audit — dựa trên phân tích static code, không phải production monitoring.*
