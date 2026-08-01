# Chiến lược model AI Local dài hạn — hệ sinh thái AOI/AVI

**Ngày:** 2026-08-01 · **Nhánh:** `feat/hmi-dep` · **Loại:** chiến lược + kiến trúc, chưa thi công

**Nguồn số liệu:** toàn bộ con số trong tài liệu này đến từ Đợt 0 (`docs/superpowers/reports/2026-08-01-do0-roster-survey.md`, §1-§7, PUSHED `b0f2c350`) hoặc từ phép đo trực tiếp ghi trong §. **Không có số nào ước lượng mà không ghi rõ.**

> ## ⚠ CẬP NHẬT SAU ĐỢT 1 (2026-08-01) — ĐỌC TRƯỚC KHI DÙNG BẤT KỲ SỐ NÀO
>
> Đợt 1 (`docs/superpowers/reports/2026-08-01-dot1-vram-reclaim.md`) đã **sửa mã và đo lại bằng đường sản xuất**. Ba điều làm đổi nội dung tài liệu này:
>
> 1. **Bảng số đo nền của Đợt 0 SAI theo hai hướng, cộng lại thiếu ~3.400 MiB** — vì `scripts/ai-bench/bench.mjs` **không đi qua mã sản xuất**. Xem §2.
> 2. **Đợt 1 giành lại 3.373 MiB**, không phải ~6,4 GB như §5 bước C kỳ vọng — sidecar `-np 1` giành lại **~0** (tiền đề sai, `kv_unified=true`).
> 3. **Bước B (vá race) đã làm, nhưng app VẪN không nạp được 30B ở đường boot mặc định** vì một nguyên nhân **thứ ba** — cơ chế chưa truy được, nhưng đã có **đường vòng đo được (2 lần)**. Bước D **chưa chốt được, nhưng không còn bị chặn cứng như trước** (xem §5).
>
> Các số **Đợt 0** được **giữ nguyên** ở dưới để không ghi đè lịch sử; số **Đợt 1** đứng cạnh và là số **phải dùng**.

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

> **⚠ Đợt 1 đã kiểm chứng — một nửa đúng, một nửa sai:**
> - **Embedding: ĐÚNG, và còn nặng hơn Đợt 0 tưởng.** Nguyên nhân đã truy được: `getEmbeddingContext()` gọi `contextSize:"auto"` (cấp toàn bộ cửa sổ ngữ cảnh model). Chi phí thật **7.694 MiB** (không phải 5.664 — Đợt 0 đo bằng `bench.mjs` nên hụt 2.030 MiB). Đổi sang `EMBED_CTX=2048` ⇒ **4.321 MiB, giành lại 3.373 MiB**.
> - **Sidecar: SAI.** Giả thuyết "`n_parallel=4` ⇒ nhân bốn KV-cache" **bị đo thật phủ định**. Log runtime của `llama-server.exe` đang cài in `kv_unified = true` **ngay ở `n_parallel=4` mặc định** ⇒ KV-cache là **một khối dùng chung** cỡ `-c`, **không nhân theo số khe**. Thêm `-np 1` giành lại **~1 MiB (trong nhiễu đo)**. 7,8 GB của sidecar là chi phí **cố định** của model + mmproj (1.502 MiB) + một khối KV 8192, **không phải buffer lãng phí**.
> - ⇒ Con số "6,4 GB buffer" của Đợt 0 phải đọc lại thành: **~3,4 GB là buffer chỉnh được (đã chỉnh), phần còn lại KHÔNG phải buffer.**

---

## 2. Số đo nền — mọi case dưới đây tính từ bảng này

| Thành phần | Đợt 0 công bố | **TRƯỚC Đợt 1** (thật, đường sản xuất) | **SAU Đợt 1** | Nguồn số mới |
|---|---|---|---|---|
| Nền hệ điều hành | ~1.200 | ~1.200 (đo 1.194-1.211) | ~1.200 | Đợt 1 §4 |
| Qwen3-Coder-30B-A3B | 17.698 | **19.077** | **19.077** (không đụng) | Đợt 1 §4 |
| Qwen3-30B-A3B-Instruct | 17.750 | **19.094** | **19.094** (không đụng) | Đợt 1 §4 |
| Qwen3-4B-Instruct | 3.464 | *chưa đo lại* (≥3.464) | *chưa đo lại* | Đợt 0 §3 |
| Qwen2.5-Coder-1.5B (FIM) | 1.774 | *chưa đo lại* (≥1.774) | *chưa đo lại* | Đợt 0 §3 |
| **Qwen3-Embedding-0.6B** | 5.664 ❌ **sai** | **7.694** | **4.321** | Đợt 1 §2 |
| bge-reranker-v2-m3 | (chạy CPU — `RAG_RERANKER_GPU=false`) | (không đổi) | (không đổi) | Đợt 0 §7.7 |
| **Vision sidecar** (tiến trình riêng) | 7.821 | **7.821** | **7.821 — KHÔNG giảm** | Đợt 1 §3 |
| **Trần thiết bị** | **32.607** | 32.607 | 32.607 | `nvidia-smi` |

⚠ **Cộng thêm khi ĐANG SINH**: +470-940 MiB mỗi model GGUF hoạt động (Đợt 0 §3) và **+117 MiB** cho sidecar thị giác đang suy luận (Đợt 1 §3, đo với 4 lượt ảnh đồng thời). Mọi con số dưới đây là **lúc nghỉ** — dưới tải phải cộng thêm.

### ⚠ Vì sao cột "Đợt 0 công bố" sai — hai điểm mù độc lập của `bench.mjs`

Cả hai đều do công cụ đo **tự chứa, không import mã sản xuất** (`bench.mjs` có comment ở đầu file: *"does NOT import any server/ source"*):

**(a) Model nhúng — hụt 2.030 MiB.** `bench.mjs:321` tự gọi `createEmbeddingContext({contextSize:"auto"})` hard-code, và **không** gọi `model.createContext()`. Đường sản xuất (`loadGgufModel()`) tạo **cả hai** context cho model nhúng.

**(b) MỌI model text GGUF — hụt ~1.350 MiB mỗi model.** `bench.mjs:249` tạo context **không truyền `sequences`** (mặc định **1**) và `contextSize` suy từ độ dài prefill của bài đo. Đường sản xuất (`aiGgufEngine.ts:686-691`) tạo `contextSize = GGUF_DEFAULT_CTX = 4096` với `sequences = GGUF_SEQUENCES = 4`. Đo qua `warmModel()` sản xuất: 30B-Instruct **17.750 → 19.094** (+1.344) · Coder-30B **17.698 → 19.077** (+1.379).

⚠ **Mỗi số model trong bảng ĐÃ GỒM ~430 MiB CUDA context dùng chung** ⇒ cộng nhiều model là **đếm lặp** khối đó. Đo được: nạp model nhúng + 30B trong **cùng tiến trình** cho **24.094 MiB**, trong khi cộng rời `1.063 + 4.321 + 19.094 = 24.478` ⇒ **thừa 384 MiB**. Với ba model GGUF, phần thừa ~**860 MiB**. ⇒ **Mọi tổng ở §3 lệch về phía THẬN TRỌNG** (cao hơn thực tế) — không ô nào đổi kết luận, nhưng phải biết khi đọc các ô sát trần.

⇒ **Mọi số Đợt 0 chưa được đo lại bằng đường sản xuất (4B, FIM) phải coi là SÀN, không phải giá trị.**
⇒ Đây là **lần thứ ba** harness đo có điểm mù đúng chỗ quyết định (Đợt 0: `bench.mjs` không biết "vision" ⇒ sót 7,8 GB · Đợt 1 Task 2: hard-code `"auto"` ⇒ sót 2,0 GB · Đợt 1 Task 4: context 1 sequence ⇒ sót ~1,35 GB **mỗi model text**).

---

## 3. Bốn case, bảng chi tiết

### 3.0 ⚠ BẢNG TỔNG HỢP SAU ĐỢT 1 — dùng bảng này, không dùng số trong các ô "Lúc nghỉ" bên dưới

Trần **32.607 MiB**. Cột "TRƯỚC Đợt 1" là **số thật đo bằng đường sản xuất**, khác với số Đợt 0 công bố (xem §2).

| Case | Đợt 0 công bố | **TRƯỚC Đợt 1** (thật) | **SAU Đợt 1** | Đổi kết luận? |
|---|---|---|---|---|
| **1** — một model xuyên suốt, lúc nghỉ | 24.562 (75,3%) | 27.971 (85,8%) | **24.598 (75,4%)** | không đổi — vốn đã vừa, nay rộng hơn |
| **1** — khi vision thức | 32.383 (99,3%) | 35.792 (**109,8% ❌**) | **32.419 (99,4%)** | ★ **ĐỔI MỘT NỬA** — hết "không thể tồn tại", nhưng **dưới tải VẪN VƯỢT TRẦN**: model+vision đang sinh = 33.476 (102,7%); **cộng đỉnh nhất thời khi nhúng đồng thời (review cổng cuối, xem callout dưới §3) = ~34.195 (~104,9%)** |
| **2** — đồng thời đủ bộ | 42.312 (130% ❌) | 47.065 (**144,3% ❌**) | **43.692 (134,0% ❌)** | **KHÔNG ĐỔI — vẫn KHÔNG KHẢ THI** |
| **3** — thị giác thường trú | 32.383 (99,3%) | 35.792 (**109,8% ❌**) | **32.419 (99,4%)** | ★ **ĐỔI MỘT NỬA** — như Case 1 vision thức, **dưới tải ~104,9%** (xem callout dưới §3) |
| **4** — hybrid `balanced`, lúc nghỉ | 28.026 (86%) | 31.435 (96,4%) | **28.062 (86,1%)** | ★ **ĐỔI** — từ "sát trần, không còn chỗ sinh" thành "có biên thật" (2 model cùng sinh = 29.942, **91,8%**) |
| **4** — `balanced` + vision thức | *(Đợt 0 không tính)* | 39.256 (**120,4% ❌**) | **35.883 (110,0% ❌)** | **KHÔNG ĐỔI — vẫn vượt trần** |

Thành phần cột "SAU Đợt 1":
- Case 1 / 3: `1.200 + 19.077 (Coder-30B) + 4.321 (embed) = 24.598` · `+ 7.821 (vision) = 32.419`
- Case 2 (mức **tối thiểu**, chỉ 2 model 30B + embed): `1.200 + 19.077 + 19.094 + 4.321 = 43.692`. Đủ bộ thật (thêm 4B + FIM + vision) = **56.751 (174,0%)**
- Case 4: `1.200 + 19.077 + 3.464 (4B — số Đợt 0 chưa đo lại ⇒ SÀN) + 4.321 = 28.062` · `+ 7.821 = 35.883`

⚠ **Case 4 là số SÀN.** Nếu model 4B cũng đắt thêm ~1.350 MiB như hai model 30B thì lúc nghỉ ≈ **29.412 (90,2%)** — **ước lượng, CHƯA ĐO**. Kết luận "có biên thật" vẫn đứng ở cả hai mức, nhưng biên hẹp hơn 86,1% nhiều.

**Ba điều phải nói thẳng:**
1. **Case 2 không phải "gần khả thi".** Riêng nền + hai model 30B đã là `1.200 + 19.077 + 19.094 = 39.371 MiB`, **vượt trần 6.764 MiB khi embedding bằng KHÔNG**. Khoản giành lại 3.373 MiB **không tới một nửa** chỗ thiếu.
2. **99,4% của Case 1/3 không có nghĩa là "đã giải quyết".** Đó là lúc nghỉ. Có người dùng thật là **102,7%** (model+vision đang sinh); **cộng cả đỉnh nhất thời khi nhúng đồng thời (mới phát hiện ở review cổng cuối) thì ~104,9%** — vài giây, không phải rò vĩnh viễn (xem callout dưới §3).
3. **Đợt 0 đã công bố một cấu hình VƯỢT TRẦN là "sát trần"**: Case 1 + vision công bố 32.383 (99,3%), số thật lúc đó là **35.792 (109,8%)**.

---

### Case 1 — MỘT MODEL XUYÊN SUỐT (roster A, vision theo yêu cầu)

| | |
|---|---|
| **Cấu hình** | `GGUF_DEFAULT_MODEL` = `GGUF_CODE_MODEL` = Coder-30B · embedding · **không** model FIM riêng · vision bật khi cần |
| **Lúc nghỉ** | ~~1.200 + 17.698 + 5.664 = 24.562 MiB (75,3%)~~ *(Đợt 0)* → **Đợt 1: 1.200 + 19.077 + 4.321 = 24.598 MiB (75,4%)** |
| **Khi vision thức** | ~~32.383 MiB (99,3%)~~ *(Đợt 0 — số thật lúc đó là 35.792, **109,8%**)* → **Đợt 1: 32.419 MiB (99,4%)** |
| **Dưới tải** | vision ngủ: **25.538 (78,3%) — vừa**. Vision thức: 32.419 + 940 + 117 = **33.476 (102,7%) — VẪN VƯỢT TRẦN**. ⚠ Chưa tính đỉnh nhất thời khi nhúng đồng thời (review cổng cuối) — cộng riêng vào 32.419 cho **~34.195 (~104,9%)**, vài giây, không phải rò vĩnh viễn (xem callout dưới §3) |
| **Đổi/quay lui** | **một dòng** `.env:120` |
| **Điểm mạnh** | đơn giản nhất · KV cache rộng nhất khi vision ngủ · khớp ưu tiên "nghiêng code" |
| **Điểm yếu** | **không có model general riêng** — chất lượng văn xuôi tiếng Việt phụ thuộc Coder-30B (**chờ chủ dự án chấm**) · 10 phút vision thức là 10 phút sát trần |
| **Hợp với** | khách nặng lập trình/PLC, ít xử lý ảnh |

### Case 2 — ĐỒNG THỜI ĐỦ BỘ

| | |
|---|---|
| **Cấu hình** | Coder-30B + General-30B + 4B + FIM + embedding + vision |
| **Lúc nghỉ** | ~~≥ 1.200 + 17.698 + 17.750 + 5.664 = 42.312 MiB (130%)~~ *(Đợt 0)* → **Đợt 1: 1.200 + 19.077 + 19.094 + 4.321 = 43.692 MiB (134,0%)**; đủ bộ thật (thêm 4B + FIM + vision) = **56.751 (174,0%)** |
| **Kết luận** | ❌ **KHÔNG KHẢ THI — Đợt 1 KHÔNG ĐỔI kết luận này.** Đã xác nhận **đo trực tiếp**: nạp model 30B thứ hai bị từ chối nguyên văn `Not enough VRAM to fit the model with the specified settings` |
| **Hợp với** | — |

⚠ **Đây là điều quan trọng nhất phải nói thẳng: trên 32,6 GB, KHÔNG cấu hình nào cho phép đủ bộ cùng lúc.** Mọi lựa chọn đều là đánh đổi.

⚠ **Và không phải "gần khả thi".** Riêng nền + hai model 30B (đường sản xuất) = `1.200 + 19.077 + 19.094 = 39.371 MiB`, **vượt trần 6.764 MiB ngay cả khi embedding bằng KHÔNG**. Khoản Đợt 1 giành lại (3.373 MiB) **không tới một nửa** chỗ còn thiếu. Muốn Case 2 khả thi thì phải đổi phần cứng hoặc đổi hẳn hạng model, không phải chỉnh buffer.

### Case 3 — THỊ GIÁC ƯU TIÊN (vision thường trú, tắt idle-timeout)

| | |
|---|---|
| **Cấu hình** | vision **giữ thường trú** (`LLAMA_VISION_IDLE_TIMEOUT_MS` rất lớn) + Coder-30B + embedding |
| **Lúc nghỉ** | ~~1.200 + 7.821 + 17.698 + 5.664 = 32.383 MiB (99,3%)~~ *(Đợt 0 — số thật lúc đó là **35.792, 109,8% ❌ đã vượt trần**)* → **Đợt 1: 1.200 + 7.821 + 19.077 + 4.321 = 32.419 MiB (99,4%)** |
| **Dưới tải** | **33.476 (102,7%) — VẪN VƯỢT TRẦN**, và cộng đỉnh nhất thời khi nhúng đồng thời (review cổng cuối, xem callout dưới §3) ⇒ **~104,9%**. Đợt 1 đưa case này từ "không thể tồn tại" về "tồn tại được lúc nghỉ", **không** đưa nó thành dùng được dưới tải |
| **Điểm mạnh** | ảnh xử lý **không phải chờ 40 giây khởi sidecar** mỗi lần nguội |
| **Điểm yếu** | **không còn chỗ cho bất kỳ model nào khác** · sát trần liên tục · `evictLRU()` **không đuổi được** sidecar (khác tiến trình) ⇒ khi vượt, ~~nhánh `catch` **lặng lẽ nạp lại `gpuLayers:"auto"`** — tier âm thầm tụt tốc độ, dấu vết duy nhất là một dòng `console.warn`~~ ⚠ **SAI — Đợt 1 đã xác nhận nhánh `catch` đó là MÃ CHẾT** (xem dưới). Khi vượt, model **không nạp được** và **không có phương án dự phòng nào cả** |
| **Hợp với** | khách nặng kiểm tra ảnh, gần như không dùng lập trình |

⚠ **ĐÍNH CHÍNH ĐỢT 1 — lưới an toàn mô tả ở dòng "Điểm yếu" KHÔNG TỒN TẠI.** Nhánh phục hồi `aiGgufEngine.ts:658-682` (gặp OOM → đuổi model rảnh → nạp lại `gpuLayers:"auto"`) **không bao giờ chạy**. Bắt được nguyên văn khi chạy `loadGgufModel()` trong chính tiến trình app đang lỗi:

```
err.message = "Failed to load model"        ⇒ ISOOM_MATCH = false
```

`isOom` tìm `"out of memory"`/`"cudamalloc"`/`"failed to allocate"`/`"unable to allocate"` trong `err.message`, nhưng những chữ đó chỉ nằm ở **stderr của lớp C++ node-llama-cpp**. ⇒ `if (!isOom || ...) throw err` **luôn ném** ⇒ khối 672-682 chết.

⇒ Hệ **không** "âm thầm tụt xuống 2,9 tok/s" như tài liệu này từng mô tả — nó **hỏng hẳn và hỏng ồn ào**. Về vận hành **tệ hơn**, nhưng ít nhất **phát hiện được**. Chưa sửa mã (ngoài phạm vi Đợt 1) ⇒ nợ.

### Case 4 — HYBRID THEO HỒ SƠ KHÁCH HÀNG ⭐ **khuyến nghị**

| | |
|---|---|
| **Cấu hình** | Bó cấu hình **đặt tên**, chọn lúc triển khai. Không ép một roster cho mọi khách |
| **Hồ sơ** | `code-heavy` (Case 1) · `vision-heavy` (Case 3) · `balanced` (Coder-30B + 4B general + embedding, vision theo yêu cầu): ~~1.200+17.698+3.464+5.664 = 28.026 MiB, 86%~~ *(Đợt 0)* → **Đợt 1: 1.200+19.077+3.464+4.321 = 28.062 MiB, 86,1%** |
| **⚠ `balanced` — điều Đợt 0 không tính** | **Khi vision thức: 35.883 MiB = 110,0% ❌ VƯỢT TRẦN.** Hồ sơ `balanced` **không được** để sidecar thị giác thường trú. Đợt 1 **không** đổi điều này (trước Đợt 1: 120,4%) |
| **⚠ `balanced` là số SÀN** | Số 4B (3.464) là của Đợt 0, đo bằng `bench.mjs` ⇒ **chưa đo lại bằng đường sản xuất**. Nếu 4B cũng đắt thêm ~1.350 MiB như hai model 30B thì lúc nghỉ ≈ **29.412 (90,2%)** — ước lượng, **CHƯA ĐO** |
| **Điểm mạnh** | mỗi nhà máy có nhu cầu khác nhau — đây là **điểm bán hàng**, không phải chi phí · mỗi hồ sơ quay lui được độc lập |
| **Điểm yếu** | phải **dựng cơ chế hồ sơ** (chưa có) · phải tài liệu hoá đánh đổi từng hồ sơ cho đội triển khai |
| **Hợp với** | **sản phẩm bán cho nhiều khách** — đúng mô hình của dự án này |

---

> ## ⚠ CẬP NHẬT SAU REVIEW TOÀN NHÁNH — cổng cuối (2026-08-02), CHƯA VÁ
>
> Review độc lập trước khi push (`.superpowers/sdd/2026-08-01-dot1-gianh-lai-vram/final-review.md`) tìm thêm **hai race tiền tồn tại** — cùng lớp lỗi mà Task 1 (khoá in-flight `loadGgufModel()`) đã vá, còn sống ở hai chỗ khác **trong đúng file đó**. **Không do Đợt 1 gây ra**, **không chặn push** (không sửa mã đợt này), nhưng đổi số "dưới tải" ở §3 — xem sửa ở Case 1/3 phía trên.
>
> **IMPORTANT-1 — `getEmbeddingContext()` còn nguyên race Task 1 vừa vá, ăn ~52,7% khoản Đợt 1 giành lại.**
> `aiGgufEngine.ts:2282-2287`, cách dòng Task 2 sửa đúng 3 dòng: kiểm `if (loaded.embeddingContext) return ...` rồi mới `await ... createEmbeddingContext()` — giữa hai bước có `await`. N lượt nhúng đồng thời tạo N context, gán đè, N−1 bản mồ côi. Tới được trong sản xuất: `.env:125 GGUF_MAX_CONCURRENCY=4`, 6 nơi gọi `generateEmbedding` do HTTP điều khiển.
>
> Đo được (4 lượt nhúng, `GGUF_MAX_CONCURRENCY=4`): tuần tự = **4.303 MiB** · đồng thời = **6.091 MiB** · chênh **+1.776 MiB**. Đó là **52,7% của toàn bộ 3.373 MiB Đợt 1 giành lại** — bốc hơi trong một cụm 4 truy vấn RAG cùng lúc.
>
> ⚠ **Phạm vi đúng — đừng thổi quá tay:** đây là **đỉnh nhất thời vài giây**, KHÔNG phải rò vĩnh viễn. Đo tiếp T+8s: VRAM về mức tuần tự (bản mồ côi được thu hồi), ổn định sau đó. Không do Đợt 1 gây ra — race đã có từ trước khi Task 2 sửa (Task 2 làm **NHẸ** nó, không tạo ra nó): trước Task 2 (`contextSize:"auto"`) mỗi bản mồ côi còn đắt hơn.
>
> ⇒ Bảng bốn case cột "dưới tải" thiếu hẳn số hạng này (chỉ cộng model đang sinh +470-940 và vision đang suy luận +117). Case 1/3: 32.419 + 1.776 = **~34.195 MiB (~104,9%)** — tệ hơn cả 102,7% mà tài liệu này gọi là "vượt trần". Đã cập nhật ở Case 1/3 phía trên.
>
> Test hiện có tạo cảm giác an toàn sai: `aiGgufEngine.test.ts:134` ("caches the embedding context — called once across multiple embeds") chỉ gọi **tuần tự**, không phủ đồng thời.
>
> Vá đề xuất (đợt sau, KHÔNG vá ở đợt này): nhớ `Promise` in-flight thay vì object, đúng khuôn `inFlightLoads` Task 1 đã dựng.
>
> **IMPORTANT-2 — `getLlama()` khởi tạo HAI backend llama.cpp — ứng viên cơ chế đầu tiên KIỂM ĐƯỢC cho "nguyên nhân thứ ba" (§5, §7).**
> `getLlama()` (`aiGgufEngine.ts:296`): cùng khuôn kiểm-rồi-mới-gán (`if (llamaInstance) return llamaInstance` … `await initLlama(...)`). Khoá Task 1 khoá theo `modelId` ⇒ **KHÔNG phủ** — hai model KHÁC NHAU nạp đồng thời vẫn cùng vào `getLlama()`. Đo được: 2 model khác nhau nạp đồng thời ⇒ `INIT_COUNT=2` (`MODE=sequential ⇒ 1`, `MODE=concurrent ⇒ 2`, đếm dòng `llama.cpp engine initialized`). VRAM ở quy mô đo: 5.339 vs 5.346 — không tốn thêm đo được ở quy mô này.
>
> ⚠ **KHÔNG phát biểu đây là cơ chế của "nguyên nhân thứ ba"** — đó đúng là cái bẫy đã giết tiền đề Task 3. Ba điều ĐÃ đo: (a) race có thật, (b) chưa được vá, (c) nó nằm đúng chỗ hiện tượng xảy ra (boot app: RAG nạp model nhúng mốc 2s và warm 30B mốc 3s là hai `modelId` KHÁC NHAU ⇒ khoá Task 1 không áp dụng ⇒ hai `getLlama()`).
>
> **Phép thử rẻ nhất trong mọi giả thuyết đang có — đợt "nguyên nhân thứ ba" PHẢI chạy TRƯỚC khi thử bất kỳ đường vòng nào:**
>
> > `grep -c "llama.cpp engine initialized" <log boot>` — **2 dòng ⇒ ứng viên sống; 1 dòng ⇒ loại.**
>
> Chi tiết đầy đủ và nợ liên quan đã nâng bậc: `.superpowers/sdd/2026-08-01-dot1-gianh-lai-vram/progress.md` (mục "NỢ SAU CỔNG CUỐI").

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

> **⚠ Đợt 1 đã làm bước B và C. Kết quả thật, và dự đoán trên SAI:**
>
> | | Kỳ vọng của §5 | Thực tế Đợt 1 |
> |---|---|---|
> | Giải phóng được | ~6,4 GB | **3.373 MiB (~3,3 GiB)** — bằng khoảng **một nửa** |
> | Case 3 sau khi chỉnh | ~79% | **99,4%** |
>
> **Vì sao lệch xa đến thế** — hai sai số gần như triệt tiêu nhau, che mất cả hai: con số "99,3%" của Đợt 0 vốn đã sai (số thật là **109,8%**, vì `bench.mjs` hụt cả embedding lẫn context sản xuất). Giành lại 3,37 GB từ 109,8% ⇒ 99,4%. Nhìn bề ngoài "không đổi gì", thực chất là **giành lại thật 3,37 GB từ một điểm xuất phát tệ hơn tưởng 3,4 GB**.
>
> **Trạng thái các bước sau Đợt 1:**
> - **A** (thành phần nắm ngân sách VRAM) — **chưa làm**, vẫn là nợ lớn nhất.
> - **B** (vá race) — **ĐÃ LÀM** (Đợt 1 Task 1, khoá in-flight, đã nghiệm thu trên app thật: chỉ còn **1** lượt nạp thay vì 2). ⚠ **NHƯNG app ở đường boot mặc định VẪN không nạp được 30B** vì một nguyên nhân **thứ ba** khác hẳn race. **Phát biểu đúng phạm vi: không cấp phát nổi khối 16,7 GB nếu CUDA context được tạo SAU khi app boot xong.** Nếu CUDA context đã tồn tại **trước** khi app boot thì chính đường warm của app nạp 30B **thành công** (đo hai lần độc lập: `Model loaded in 16291ms` + `deep model warm OK`, VRAM 24.094 MiB). **Cơ chế CHƯA BIẾT** — đã loại trừ dung lượng VRAM thiết bị, trần commit Windows (+19,2/88,78 GB, dư >27 GB), mã nạp sản xuất, race. ⇒ **Có đường vòng đo được, chưa phải bản sửa.** Cần **một đợt riêng**.
> - **C** (chỉnh buffer) — **ĐÃ LÀM một nửa**: embedding xong (3.373 MiB); sidecar `-np 1` giành lại **~0** vì tiền đề sai. Còn dư địa: context thường 4096×4 vẫn được tạo cho model nhúng.
> - **D** (chốt roster) — **chưa chốt được**, giờ bởi nguyên nhân thứ ba ở bước B chứ không phải bởi race — nhưng **không còn bị chặn cứng**: đã có đường vòng đo được (2 lần), cơ chế vẫn chưa biết.

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
- ~~**Buffer embedding 4,5 GB** — biết có, **chưa truy nguyên nhân**.~~ ✅ **Đợt 1 ĐÃ TRẢ LỜI**: nguyên nhân là `contextSize:"auto"` trong `getEmbeddingContext()`; chi phí thật 7.694 MiB (không phải 5.664); sau khi đổi sang `EMBED_CTX=2048` còn **4.321 MiB**.
- ~~**Hiệu quả của `-np 1`** — chưa đo, **cần sửa mã**.~~ ✅ **Đợt 1 ĐÃ TRẢ LỜI**: **~0 MiB** (trong nhiễu đo). Tiền đề "n_parallel=4 nhân bốn KV-cache" **sai** — build `llama-server` đang cài dùng `kv_unified=true`.
- **Roster C chưa chạy qua boot app thật.** ⚠ **Đợt 1 làm rõ thêm: KHÔNG roster nào chạy được qua boot app thật** — app không nạp nổi model 30B (xem §5).
- ~~**KV cache cho 30B chưa bao giờ đo được**.~~ ✅ **Đợt 1 đo được gián tiếp**: context sản xuất (4096 token × 4 sequences) tốn **+1.344 MiB** cho 30B-Instruct và **+1.379 MiB** cho Coder-30B (hiệu số giữa `warmModel()` sản xuất và `bench.mjs`). Đây chính là khoản Đợt 0 bỏ sót.
- **Tất cả số là lúc nghỉ** — dưới tải phải cộng +470-940 MiB mỗi model GGUF, +117 MiB cho sidecar đang suy luận.

**Đợt 1 để lại những câu hỏi MỚI chưa trả lời được:**

- **CƠ CHẾ vì sao khối 16,7 GB không cấp phát được khi CUDA context tạo SAU boot app.** Biết **điều kiện** (đo hai lần, có cả chứng ngược), **không** biết **vì sao**. Đã có **đường vòng** (tạo CUDA context sớm) nhưng chưa thành mã, chưa nghiệm thu nhiều lượt boot ⇒ **bước D chưa chốt được, nhưng không còn bị chặn cứng như trước.**
- **Model 4B và FIM chưa được đo lại bằng đường sản xuất** — số Đợt 0 cho hai model này là **sàn**, và hồ sơ `balanced` phụ thuộc trực tiếp vào số 4B.
- ~~**Nhánh `catch` nạp lại `gpuLayers:"auto"` có phải mã chết không?**~~ ✅ **ĐÃ TRẢ LỜI: ĐÚNG LÀ MÃ CHẾT** (`err.message = "Failed to load model"` ⇒ `isOom = false`). Cơ chế phục hồi mà §3 Case 3 mô tả **chưa từng hoạt động**. Câu hỏi còn lại: **sửa thế nào** — bắt theo stderr, hay đổi cách node-llama-cpp báo lỗi? Đợt riêng.
- **Comment `aiGgufEngine.ts:1108-1109` mô tả SAI sự thật** (nói hoãn warm để "không cạnh tranh với boot", thực tế hoãn ra sau boot mới là điều kiện gây lỗi). Chưa sửa — nợ.
- **Còn giành lại được bao nhiêu từ context thường của model nhúng?** Biết là còn, **chưa đo**.

---

## 8. Ngoài phạm vi (YAGNI có chủ ý)

- **Không** khuyến nghị model cụ thể ngoài kho 9 model hiện có.
- **Không** thiết kế cơ chế hồ sơ khách hàng ở tài liệu này — nó là spec riêng, sau bước D.
- **Không** vá bốn bug Đợt 0 tìm ra — chúng đã ghi sổ, mỗi cái là một đợt riêng.
