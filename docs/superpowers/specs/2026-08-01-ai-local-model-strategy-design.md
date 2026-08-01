# Chiến lược model AI Local dài hạn — hệ sinh thái AOI/AVI

**Ngày:** 2026-08-01 · **Nhánh:** `feat/hmi-dep` · **Loại:** chiến lược + kiến trúc, chưa thi công

**Nguồn số liệu:** toàn bộ con số trong tài liệu này đến từ Đợt 0 (`docs/superpowers/reports/2026-08-01-do0-roster-survey.md`, §1-§7, PUSHED `b0f2c350`) hoặc từ phép đo trực tiếp ghi trong §. **Không có số nào ước lượng mà không ghi rõ.**

---

## 1. Hai phát hiện đổi hẳn bài toán

Trước khi bàn roster, phải sửa hai giả định sai — cả hai đều do đo mới ra.

### 1.1 Thị giác là ĐỈNH NHẤT THỜI, không phải thường trú

`llamaVisionSidecar.ts:26,60-62` — `LLAMA_VISION_IDLE_TIMEOUT_MS` mặc định **600000 ms = 10 phút**, sau đó **tự tắt tiến trình**.

⇒ 7.821 MiB **không nằm trong ngân sách thường trú**. Nó là một **đỉnh 7,8 GB kéo dài ≥10 phút** mỗi khi có ảnh cần xử lý.
⇒ Câu hỏi đúng **không phải** "vision có vừa không" mà **"chuyện gì xảy ra trong 10 phút nó thức"**.

### 1.2 BUFFER ăn nhiều hơn TRỌNG SỐ — đây mới là đòn bẩy

| Thành phần | File trên đĩa | VRAM thật (delta) | Phần buffer |
|---|---|---|---|
| Qwen3-Embedding-0.6B | **1,2 GB** | **5.664 MiB** | **~4,5 GB** |
| Vision sidecar (VL-8B + mmproj) | 5,9 GB | **7.821 MiB** | ~1,9 GB |
| Qwen3-Coder-30B | 16,5 GB | 17.698 MiB | ~1,2 GB |

Hai nguyên nhân đã truy được:
- **Sidecar**: không truyền `-np` ⇒ `llama-server` tự chọn `n_parallel=4` (4 khe × ctx 8192) + buffer mtmd 1.502 MiB.
- **Embedding**: model 0.6B mà tốn 5,7 GB — cùng lớp vấn đề (context/batch mặc định), **chưa truy nguyên nhân cụ thể**.

⇒ **Khoảng 6,4 GB đang bị buffer mặc định chiếm** ở hai chỗ. Đó là **nhiều hơn cả một model 4B**.
⇒ **Đòn bẩy lớn nhất không phải đổi model — là chỉnh buffer.** Nhưng cả hai đều **cần sửa mã**, nên ngoài phạm vi Đợt 0.

---

## 2. Số đo nền — mọi case dưới đây tính từ bảng này

| Thành phần | VRAM delta (MiB) | Nguồn |
|---|---|---|
| Nền hệ điều hành | ~1.200 | §3 baseline |
| Qwen3-Coder-30B-A3B | **17.698** | §3 roster A |
| Qwen3-30B-A3B-Instruct | 17.750 | §3 hiện trạng |
| Qwen3-4B-Instruct | 3.464 | §3 roster A |
| Qwen2.5-Coder-1.5B (FIM) | 1.774 | §3 roster A |
| Qwen3-Embedding-0.6B | **5.664** | §3 hiện trạng |
| bge-reranker-v2-m3 | (chạy CPU — `RAG_RERANKER_GPU=false`) | §7.7 |
| **Vision sidecar** (tiến trình riêng) | **7.821** | đo trực tiếp, đợt sửa cuối |
| **Trần thiết bị** | **32.607** | `nvidia-smi` |

⚠ **Cộng thêm khi ĐANG SINH**: +470-940 MiB mỗi model hoạt động (§3). Mọi con số dưới đây là **lúc nghỉ** — dưới tải phải cộng thêm.

---

## 3. Bốn case, bảng chi tiết

### Case 1 — MỘT MODEL XUYÊN SUỐT (roster A, vision theo yêu cầu)

| | |
|---|---|
| **Cấu hình** | `GGUF_DEFAULT_MODEL` = `GGUF_CODE_MODEL` = Coder-30B · embedding · **không** model FIM riêng · vision bật khi cần |
| **Lúc nghỉ** | 1.200 + 17.698 + 5.664 = **24.562 MiB (75,3%)** |
| **Khi vision thức** | 24.562 + 7.821 = **32.383 MiB (99,3%)** |
| **Dưới tải** | vượt trần — buffer sinh +470-940 không còn chỗ |
| **Đổi/quay lui** | **một dòng** `.env:120` |
| **Điểm mạnh** | đơn giản nhất · KV cache rộng nhất khi vision ngủ · khớp ưu tiên "nghiêng code" |
| **Điểm yếu** | **không có model general riêng** — chất lượng văn xuôi tiếng Việt phụ thuộc Coder-30B (**chờ chủ dự án chấm**) · 10 phút vision thức là 10 phút sát trần |
| **Hợp với** | khách nặng lập trình/PLC, ít xử lý ảnh |

### Case 2 — ĐỒNG THỜI ĐỦ BỘ

| | |
|---|---|
| **Cấu hình** | Coder-30B + General-30B + 4B + FIM + embedding + vision |
| **Lúc nghỉ** | ≥ 1.200 + 17.698 + 17.750 + 5.664 = **42.312 MiB (130%)** |
| **Kết luận** | ❌ **KHÔNG KHẢ THI** — đã xác nhận **đo trực tiếp**: nạp model 30B thứ hai bị từ chối nguyên văn `Not enough VRAM to fit the model with the specified settings` |
| **Hợp với** | — |

⚠ **Đây là điều quan trọng nhất phải nói thẳng: trên 32,6 GB, KHÔNG cấu hình nào cho phép đủ bộ cùng lúc.** Mọi lựa chọn đều là đánh đổi.

### Case 3 — THỊ GIÁC ƯU TIÊN (vision thường trú, tắt idle-timeout)

| | |
|---|---|
| **Cấu hình** | vision **giữ thường trú** (`LLAMA_VISION_IDLE_TIMEOUT_MS` rất lớn) + Coder-30B + embedding |
| **Lúc nghỉ** | 1.200 + 7.821 + 17.698 + 5.664 = **32.383 MiB (99,3%)** |
| **Dưới tải** | vượt trần |
| **Điểm mạnh** | ảnh xử lý **không phải chờ 40 giây khởi sidecar** mỗi lần nguội |
| **Điểm yếu** | **không còn chỗ cho bất kỳ model nào khác** · sát trần liên tục · `evictLRU()` **không đuổi được** sidecar (khác tiến trình) ⇒ khi vượt, nhánh `catch` **lặng lẽ nạp lại `gpuLayers:"auto"`** — tier âm thầm tụt tốc độ, dấu vết duy nhất là một dòng `console.warn` |
| **Hợp với** | khách nặng kiểm tra ảnh, gần như không dùng lập trình |

### Case 4 — HYBRID THEO HỒ SƠ KHÁCH HÀNG ⭐ **khuyến nghị**

| | |
|---|---|
| **Cấu hình** | Bó cấu hình **đặt tên**, chọn lúc triển khai. Không ép một roster cho mọi khách |
| **Hồ sơ** | `code-heavy` (Case 1) · `vision-heavy` (Case 3) · `balanced` (Coder-30B + 4B general + embedding, vision theo yêu cầu = 1.200+17.698+3.464+5.664 = **28.026 MiB, 86%**) |
| **Điểm mạnh** | mỗi nhà máy có nhu cầu khác nhau — đây là **điểm bán hàng**, không phải chi phí · mỗi hồ sơ quay lui được độc lập |
| **Điểm yếu** | phải **dựng cơ chế hồ sơ** (chưa có) · phải tài liệu hoá đánh đổi từng hồ sơ cho đội triển khai |
| **Hợp với** | **sản phẩm bán cho nhiều khách** — đúng mô hình của dự án này |

---

## 4. Kiến trúc AI Local — vì sao mọi roster đều bấp bênh cho tới khi sửa

### 4.1 Bốn hộ tiêu thụ GPU, không ai nắm tổng

| Hộ tiêu thụ | Cơ chế điều tiết | Biết tổng VRAM? |
|---|---|---|
| GGUF trong tiến trình (`aiGgufEngine`) | `GGUF_MAX_CONCURRENCY=4` | ✅ **chỉ cho mình** (`readVramState()` dòng 303, dùng ở 350) |
| ONNX (`aiInferenceEngine`) | `AI_GPU_CONCURRENCY=2`, **semaphore riêng** | ❌ |
| Vision sidecar (`llama-server`) | **không có** — tiến trình riêng | ❌ |
| Reranker (`aiReranker`) | **bypass semaphore GGUF** | ❌ (an toàn **chỉ nhờ** `RAG_RERANKER_GPU=false`) |

**Không thành phần nào hạch toán cả thiết bị.**

⇒ Đây là **nguyên nhân gốc rễ** của mọi thứ Đợt 0 tìm ra. Sidecar 7,8 GB lọt qua **7 task + 7 review + 7 re-review** không phải vì ai cẩu thả — nó **vô hình về mặt cấu trúc**.
⇒ Race double-warm cùng gốc: **không ai sở hữu "trạng thái đang nạp model"**.

### 4.2 Cổng không phải cổng

| Đường | Số lời gọi sinh chữ |
|---|---|
| Qua `aiGateway` (`planInference`/`routeInference`) | **36** |
| **Thẳng** `aiGgufEngine` (`chatCompletion`/`generateText`/`generateJSON`/`generateFim`) | **26** |

**42% đi vòng.** Hệ quả đã đo: toàn bộ tier code/fim **vô hình với `ai_gateway_metrics`** (0 dòng), và `ai_model_metrics` cũng 0 dòng — **không có nguồn thay thế**.
⇒ Mọi quyết định về model cho lập trình viên **đang bay mù**, kể cả quyết định trong chính tài liệu này.

### 4.3 Bề mặt cấu hình

**188 service `ai*` · 57 router · 64/250 biến môi trường là AI** (`GGUF_*` 19 · `AI_*` 26 · `LLAMA_*` 10 · `RAG_*` 9).
Không có tài liệu nào nói **biến nào phối hợp với biến nào**. Đợt 0 đã gặp hai ca thật: `GGUF_EMBED_MODEL` ↔ `GGUF_EMBEDDING_MODEL` trùng giá trị **do may mắn**; `RAG_RERANKER_GPU=false` là thứ **duy nhất** chặn hộ tiêu thụ GPU thứ tư.

---

## 5. Lộ trình — thứ tự BẮT BUỘC

Làm sai thứ tự là chọn trên nền cát.

| Bước | Việc | Vì sao phải trước |
|---|---|---|
| **A** | **Một thành phần nắm ngân sách VRAM** cho cả bốn hộ | Không có nó, roster nào cũng gặp lại triệu chứng cũ khi hộ thứ tư thức dậy |
| **B** | **Vá race double-warm** (`loadGgufModel()` cần in-flight lock) | Chưa vá thì app **không nạp nổi 30B**, mọi nghiệm thu roster đo lỗi hạ tầng chứ không đo roster. Kèm rò bản sao: **model càng nhỏ càng rò** |
| **C** | **Chỉnh buffer** — sidecar `-np 1`, điều tra 4,5 GB buffer của embedding | Giải phóng ~6,4 GB — **nhiều hơn cả một model 4B**. Đòn bẩy lớn hơn mọi lựa chọn roster |
| **D** | **Chốt roster** (cần: chủ dự án chấm 3 cặp A/B tiếng Việt) | Chỉ có nghĩa sau A+B+C |
| **E** | **Dựng cơ chế hồ sơ khách hàng** | Chỉ có nghĩa sau D |

⚠ **Bước C có thể làm đổi kết luận của bước D.** Nếu giải phóng được 6,4 GB thì Case 3 (thị giác thường trú) từ 99,3% xuống ~79% — và bảng đánh đổi viết lại hoàn toàn.

---

## 6. Khi nào cần đổi model — tiêu chí, không phải danh sách

Kiến thức của tôi về model dừng khoảng **5/2026**, nên tài liệu này **không khuyến nghị model cụ thể ngoài kho hiện có**. Thay vào đó là tiêu chí để chủ dự án tự quyết khi có model mới:

| Tín hiệu | Nghĩa là gì |
|---|---|
| Bước C xong mà vẫn không đủ chỗ cho hồ sơ cần thiết | Trần 32,6 GB là ràng buộc cứng ⇒ xét lượng tử hoá sâu hơn, model nhỏ hơn, **hoặc GPU thứ hai** |
| A/B tiếng Việt cho thấy Coder-30B viết kém | Cần model general riêng ⇒ Case 4 hồ sơ `balanced`, hoặc model general nhỏ hơn 30B |
| Tier code/fim đo được (sau khi vá 4.2) cho thấy lưu lượng thấp | Ưu tiên "nghiêng code" mất cơ sở ⇒ xét lại toàn bộ |
| Có model MoE mới với số tham số hoạt động thấp hơn | MoE cho phép đẩy sang RAM 64 GB rẻ hơn model dense — đường roster C khả thi hơn |

**Ba đường thoát khi chạm trần**, chưa đường nào được đo: lượng tử hoá sâu hơn · model nhỏ hơn · GPU thứ hai.

---

## 7. Điều tài liệu này KHÔNG trả lời được

Trung thực về chỗ yếu, để chủ dự án không quyết dựa trên khoảng trống:

- **Chất lượng tiếng Việt của Coder-30B** — 3 cặp A/B đang chờ chấm. Đây là **biến quyết định** giữa Case 1 và Case 4/`balanced`.
- **§4 không đo model 4B** ⇒ hồ sơ `balanced` thiếu bằng chứng cho **chính model general nó sẽ dùng**.
- **Lưu lượng thật của tier code/fim** — không đo được cho tới khi vá 4.2.
- **Buffer embedding 4,5 GB** — biết có, **chưa truy nguyên nhân**.
- **Hiệu quả của `-np 1`** — chưa đo, **cần sửa mã**.
- **Roster C chưa chạy qua boot app thật**; **KV cache cho 30B chưa bao giờ đo được**.
- **Tất cả số là lúc nghỉ** — dưới tải phải cộng +470-940 MiB mỗi model hoạt động.

---

## 8. Ngoài phạm vi (YAGNI có chủ ý)

- **Không** khuyến nghị model cụ thể ngoài kho 9 model hiện có.
- **Không** thiết kế cơ chế hồ sơ khách hàng ở tài liệu này — nó là spec riêng, sau bước D.
- **Không** vá bốn bug Đợt 0 tìm ra — chúng đã ghi sổ, mỗi cái là một đợt riêng.
