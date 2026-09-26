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


> ## ⚠⚠ CẬP NHẬT SAU ĐỢT 2 (2026-08-02) — SỐ **PHẢI DÙNG** LÀ CỘT "ĐỢT 2"
>
> Nguồn: `docs/superpowers/reports/2026-08-02-dot2-report.md` §1-§7. **Năm điều đổi nội dung tài liệu này:**
>
> 1. **Model nhúng còn 2.232 MiB** (4.321 → 2.232, **−2.089**) — bỏ context thường mà model chỉ-nhúng không bao giờ dùng, cộng khoá in-flight (§3).
> 2. **4B và FIM lần đầu được đo bằng đường khớp sản xuất — và CẢ HAI đắt hơn Đợt 0 công bố**: 4B **3.464 → 5.534** (+2.070) · FIM **1.774 → 2.188** (+414). Hai số "SÀN" của Đợt 0/1 nay **hết là sàn**.
> 3. **Case 1/3 lần đầu tiên VỪA TRẦN kể cả dưới tải khi vision thức** — **97,3%** (thận trọng) hoặc **94,8%** (theo số đo mới), so với **108,1% ❌** của Đợt 1 quy về cùng định nghĩa. ✅ **Ô này nay là PHÉP ĐO, không còn là phép cộng**: reviewer đo trực tiếp 30B + sidecar **cùng thức** (2026-08-02, N=1) ⇒ **không có chi phí tương tác ẩn**. ⚠ Hai khoản nhỏ (`+117` sidecar đang suy luận, `2.232` model nhúng) **vẫn là phép cộng** — xem §2 và §7.
> 4. ★★ **HỘ TIÊU THỤ GPU THỨ NĂM ĐÃ VÀO BẢNG (review toàn nhánh): ONNX/DirectML `+329 MiB`.** Nó **đang chạy** (`ENABLE_GPU=true`, `getSession()` → EP `dml`) và trước đó **được gọi tên ở §4.1 nhưng chưa bao giờ vào một phép cộng nào** — đúng khuôn đã làm mất sidecar 7,8 GB ở Đợt 0. Ô tiêu đề đi từ `31.387 (96,3%, biên 1.220)` sang **`31.716 (97,3%, biên 891)`** ⇒ **ăn 27% biên an toàn đã công bố**. Kèm theo: **cron 03:00 đo được +1.251 MiB** (tiến trình riêng) ⇒ nếu trùng lúc vision thức + đang sinh thì **101,1% ❌**. Chi tiết: §2, §4.1.
> 5. **Case 2 VẪN KHÔNG KHẢ THI, và Đợt 2 đẩy nó XA HƠN** (đủ bộ thật 56.751 → **57.475**), vì 4B+FIM đắt thêm nhiều hơn phần embedding tiết kiệm được.
>
> ### 🔴 CẤU HÌNH `.env` ĐANG CHẠY HÔM NAY ĐÃ VƯỢT TRẦN — ngay cả LÚC NGHỈ
>
> `.env` hiện có `GGUF_FIM_MODEL=Qwen2.5-Coder-1.5B` (**FIM 1,5B riêng**, không gộp vào Coder-30B). Với dòng ONNX cộng vào, biến thể đó **vượt trần ngay khi sidecar thị giác thức, KHÔNG cần sinh gì cả**:
>
> | Biến thể "giữ FIM 1,5B riêng" | Trước §7 | **Nay** |
> |---|---|---|
> | lúc nghỉ, vision **thức** | 32.518 = 99,7% ✅ | **32.847 = 100,7% ❌** |
> | + một model đang sinh | 33.575 = 103,0% ❌ | **33.904 = 104,0% ❌** |
>
> ⇒ **Đây là ô DUY NHẤT bị dòng ONNX lật dấu**, và nó lật ở **đúng cấu hình đang chạy**. Điều kiện để Case 1/3 vừa trần là **gộp FIM vào Coder-30B** (§2.2/§2.3 spec hồ sơ) — nay không còn là tối ưu nhỏ mà là **điều kiện bắt buộc**.
>
> 🚧 **ĐIỀU KIỆN TIÊN QUYẾT CHƯA GỠ — đọc trước khi chốt bất kỳ roster nào:** **trên đường boot app bình thường, hệ HIỆN KHÔNG NẠP ĐƯỢC MODEL 30B** (`cudaMalloc failed` cho khối **16.698,37 MiB**, tái hiện **3/3 lượt tại HEAD** + reviewer tái hiện độc lập 3 lượt, hỏng cả `npm run dev` lẫn `npm run dev:worker`). Đợt 2 hạ dấu chân boot xuống 3,27 GB mà lỗi **y hệt** ⇒ **không phải bài toán chật chỗ**. **Cơ chế CHƯA BIẾT, chưa vá.** ⇒ Mọi bảng VRAM dưới đây nói *"nếu nạp được thì vừa"*, **không** nói *"nạp được"*.
>
> ⚠⚠ **Số duy nhất còn trích được từ điều tra bí ẩn CUDA là `16.698,37 MiB`.** Mọi ngưỡng trung gian từng nêu (8,2 / 8,9 / 10,9 / 13,6 / 15,6 / 16,3 GB) **ĐÃ BỊ RÚT** vì không tái hiện giữa hai phiên đo cùng ngày. **Không trích lại chúng.**
>
> Các số **Đợt 0** và **Đợt 1** giữ nguyên ở dưới để không ghi đè lịch sử.


> ## ✅ CẬP NHẬT 2026-08-02 — CHỦ DỰ ÁN ĐÃ CHẤM A/B TIẾNG VIỆT
>
> **Kết quả: model CHUYÊN CODE viết tiếng Việt NHỈNH HƠN model general** (mức độ **nhẹ**; chủ dự án nói *"cả hai đều trả lời tiếng Việt ổn, chỉ là văn phong của Model 2 dễ hơn với dẫn kỹ thuật và người mới"*). Ánh xạ: Model 1 = General, Model 2 = Coder. Chi tiết + cách khôi phục ánh xạ: `docs/superpowers/reports/2026-08-01-do0-vi-ab.md`.
>
> ⚠ **Lo ngại nêu trong tài liệu này — "model chuyên code viết văn xuôi tiếng Việt thường khô và hay lẫn thuật ngữ Anh" — KHÔNG được xác nhận bởi một lượt chấm mù.**
>
> ⚠⚠ **PHÁT BIỂU ĐÚNG PHẠM VI (sửa ở review toàn nhánh — bản trước viết "ĐÃ BỊ ĐO THẬT BÁC BỎ", đó là NÓI QUÁ).**
> Nguồn là **A/B mù, MỘT người chấm, N=3 cặp, mức chênh "nhẹ"**. Chính `docs/superpowers/reports/2026-08-01-do0-vi-ab.md` rất nghiêm khắc với giới hạn của nó. Gọi đúng tên: **một lượt chấm mù N=3, chênh nhẹ — đủ làm ĐẦU VÀO, không phải bằng chứng mạnh.** Không phải "đo thật", không phải "bác bỏ": không có phép đo nào ở đây, và N=3 một người chấm không bác bỏ được điều gì.
>
> **Ba hệ quả:**
> 1. Điều kiện *"nếu tiếng Việt của Coder-30B chấp nhận được → roster A"* ⇒ **ĐẠT theo một lượt chấm mù N=3**. Đủ để đi tiếp; **chưa đủ để coi là đã đóng**. Muốn chắc thì tăng N và số người chấm.
> 2. Hồ sơ `balanced` **bị hạ bậc** — nhưng ⚠ **KHÔNG phải vì lượt chấm này**. Lý do đứng vững là **lý do thứ HAI, độc lập và định lượng**: `balanced` + vision thức = **111,0% ❌** vs Case 1/3 = **94,0% ✅** (§3.0). Kể cả nếu lượt chấm A/B bị lật ngược hoàn toàn, `balanced` **vẫn vượt trần** ⇒ kết luận hạ bậc **không phụ thuộc** vào chứng cứ yếu ở trên.
> 3. **Nút thắt còn lại KHÔNG phải chọn model** mà là **ngân sách thị giác** + **bí ẩn CUDA context** (§5 bước A/B/C).

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

| Thành phần | Đợt 0 công bố | **TRƯỚC Đợt 1** (thật, đường sản xuất) | **SAU Đợt 1** | **SAU ĐỢT 2 — số PHẢI DÙNG** | Nguồn số mới nhất |
|---|---|---|---|---|---|
| Nền hệ điều hành | ~1.200 | ~1.200 (đo 1.194-1.211) | ~1.200 | ~1.200 *(Đợt 2 đo 1.248-1.257)* | Đợt 2 §6 |
| Qwen3-Coder-30B-A3B | 17.698 | **19.077** | **19.077** (không đụng) | **19.077** (Đợt 2 không đụng) | Đợt 1 §4 |
| Qwen3-30B-A3B-Instruct | 17.750 | **19.094** | **19.094** (không đụng) | **19.094** (Đợt 2 không đụng) | Đợt 1 §4 |
| **Qwen3-4B-Instruct** | 3.464 ❌ **SÀN** | *chưa đo lại* (≥3.464) | *chưa đo lại* | **5.534** (+2.070 so Đợt 0) | **Đợt 2 §6(ii)** |
| **Qwen2.5-Coder-1.5B (FIM)** | 1.774 ❌ **SÀN** | *chưa đo lại* (≥1.774) | *chưa đo lại* | **2.188** (+414 so Đợt 0) | **Đợt 2 §6(ii)** |
| **Qwen3-Embedding-0.6B** | 5.664 ❌ **sai** | **7.694** | **4.321** | **2.232** (−2.089 so Đợt 1) | **Đợt 2 §3** |
| bge-reranker-v2-m3 | (chạy CPU — `RAG_RERANKER_GPU=false`) | (không đổi) | (không đổi) | (không đổi) | Đợt 0 §7.7 |
| **Vision sidecar** (tiến trình riêng) | 7.821 | **7.821** | **7.821 — KHÔNG giảm** | **7.821 — KHÔNG giảm** | Đợt 1 §3 |
| **★ ONNX / DirectML** (`aiInferenceEngine`) | *(không có dòng nào)* | *(không có dòng nào)* | *(không có dòng nào)* | **329** *(một session, sau khi đã chạy)* | **Đợt 2 §7 — review toàn nhánh** |
| **Trần thiết bị** | **32.607** | 32.607 | 32.607 | **32.607** | `nvidia-smi` |

> ### ★★ HỘ TIÊU THỤ GPU THỨ NĂM — được GỌI TÊN ở §4.1 nhưng CHƯA BAO GIỜ vào phép cộng
>
> **Đây là ĐÚNG KHUÔN đã làm hỏng bảng Đợt 0** (sidecar 7,8 GB nằm trong văn xuôi, vắng mặt khỏi mọi phép cộng). §4.1 của chính tài liệu này liệt kê ONNX là **hộ tiêu thụ GPU #2**, cột *"Biết tổng VRAM?"* ghi ❌ — rồi **không dòng nào trong §2/§3 cộng nó vào**.
>
> **Đường sống thật, đang bật:** `.env` `ENABLE_GPU=true` ⇒ `server/services/aiInferenceEngine.ts:87` đẩy `"dml"` vào `executionProviders` ⇒ `:129` `ort.InferenceSession.create({ executionProviders })`.
>
> **Ai gọi vào đường đó:** `aiQualityGate` · `aiBatchEngine` · `aiActiveLearning` · `aiABTesting` (đều qua `runInference` → `getSession`) và `ocrService.getOnnxSession()` (`ai/ocrService.ts:296-314`, logic provider nhân bản).
>
> **Bằng chứng hộ tiêu thụ này CÓ THẬT (trạng thái sống, không phải cờ):** `models/dinov2.onnx` **có trên đĩa** (88 MB, file `.onnx` **duy nhất**), và `ai_models` có **`id=3 dinov2-small`, `status=ACTIVE`, trỏ đúng file đó** ⇒ `getSession()` nạp được. Đo được **+339 MiB**.
>
> > ⚠⚠ **ĐÍNH CHÍNH (re-review) — HAI CỜ TỪNG ĐƯỢC TRÍCH LÀM BẰNG CHỨNG LẠI TRỎ VÀO ĐƯỜNG CPU.**
> > Bản trước viện `IMAGE_EMBEDDING_DEFAULT=onnx` + `AOI_EMBEDDING_ENABLED=true` để chứng minh *"ONNX đang chạy trên GPU"*. **Sai mắt xích**: hai cờ đó dẫn tới `server/services/aiImageEmbedding.ts:463-465`, và hàm đó dựng provider từ **`ENABLE_CUDA`** — biến **KHÔNG có trong `.env`** ⇒ `providers = ["cpu"]` ⇒ **0 VRAM**. Nó cũng dùng cache riêng (`:427 embeddingSessionCache`), không phải `sessionCache` của `aiInferenceEngine`.
> > ⇒ **Kết luận C-1 KHÔNG đổi** — hộ tiêu thụ có thật, đo được, qua đường `getSession()` ở trên. **Nhưng chuỗi bằng chứng thì đổi**: chứng cứ đúng là *đường gọi + trạng thái `ai_models`/đĩa*, **không phải** hai cờ đó. Trong một đợt dành để diệt *"văn bản khẳng định thứ chưa kiểm"*, một mắt xích sai là không chấp nhận được — kể cả khi kết luận vẫn đúng.
>
> | Bước | Reviewer đo | Đo lại độc lập (Đợt 2 §7) |
> |---|---|---|
> | `import onnxruntime-node` | −1 (nhiễu) | **+0** |
> | tạo `InferenceSession` (dml) | **+99** | **+109** |
> | một `session.run` N=8 (= `AI_BATCH_MAX`) | **+329** | **+337** |
> | `session.run` N=8 lần hai | *(không đo)* | **+0** — cấp phát đã ổn định |
>
> ⇒ Hai lượt đo độc lập lệch **8 MiB**, nằm trong biên nhiễu **±~25 MiB**. **Bảng dùng 329** (số reviewer, để mọi ô so sánh được); đo lại của tôi (**337**) cao hơn 8 MiB — chọn số nào cũng không đổi ô nào.
>
> ### ⚠ TRẦN CACHE — **ĐÃ ĐO**, và nó KHÔNG phải "×5" như bản trước suy ra
>
> `AI_SESSION_CACHE_MAX` mặc định **5** (`aiInferenceEngine.ts:25`) ⇒ bản trước **ngoại suy tuyến tính** `329 × 5 ≈ 1.645 MiB` và kết luận cache đầy sẽ **vượt trần**. **Đo thật thì sai, và sai về phía BI QUAN:**
>
> | | tạo session (cộng dồn) | sau `run` N=8 (cộng dồn) |
> |---|---|---|
> | 1 session | +111 | **+339** |
> | **5 session (cache ĐẦY)** | **+478** *(không phải 5×111)* | **+984 MiB** |
>
> *(đo lại độc lập; reviewer đo +483 / **+991** — lệch 7 MiB, trong biên ±~25. Bảng dùng **991**, số cao hơn.)*
>
> ⇒ Session #2–#5 chỉ tốn **~91 MiB tạo / ~69 MiB chạy** mỗi cái, vì phần cố định của EP/DML **dùng chung trong cùng tiến trình**. **Ngoại suy tuyến tính sai ~65-72%.**
>
> **Hệ quả 1 — cache đầy KHÔNG lật ô tiêu đề:** `31.716 − 329 + 991` = **32.378 = 99,3% ✅**, biên còn **229 MiB**. (Bản trước ghi `101,3% ❌` ⇒ **bi quan 654 MiB**.)
>
> **Hệ quả 2 — ★ trần đó KHÔNG VỚI TỚI ĐƯỢC hôm nay.** `getSession()` khoá cache theo `${model.id}:${model.currentVersion}` trên bảng `ai_models`. Truy vấn DB thật: **đúng 2 dòng, chỉ MỘT dòng có file ONNX** (`id=3 dinov2-small`, `status=ACTIVE`, `filePath=models/dinov2.onnx`; `id=4` có `filePath=null`) — và `dinov2.onnx` là file `.onnx` **duy nhất trên đĩa**. ⇒ **Cache tối đa 1 mục.** Dòng **329** không chỉ đủ, nó là **toàn bộ** hộ tiêu thụ này ở trạng thái hiện tại.
>
> ⚠ **Bản trước mắc ĐÚNG lớp lỗi mà §7 đang phê phán**: trích một **tham số mặc định** rồi suy ra hậu quả, **không kiểm trạng thái sống**. Chỉ khác chiều: lần này lệch **bi quan**.
>
> ⚠ **Vẫn còn một cache KHÔNG chịu `AI_SESSION_CACHE_MAX`**: `server/services/ai/ocrService.ts:295` giữ `recSessionCache` là `Map` **không giới hạn**. Hiện **trơ** (không có `.onnx` OCR trên đĩa), nhưng mọi phát biểu về "trần" chỉ gọi tên `AI_SESSION_CACHE_MAX` là **chưa đủ**. Tương tự, `aiImageEmbedding.ts:427` có `embeddingSessionCache` riêng — nhưng nó dựng session **CPU-only** (xem chuỗi bằng chứng ở trên).
>
> `models/README.md:62` khuyên *"bật ONNX GPU EP cạnh bốn model GGUF nóng thì hạ `GGUF_MAX_LOADED_MODELS` xuống 3"* — **chưa bảng roster nào của ba đợt nhắc**, và với cache 1 mục thì **chưa cần tới**.

> ### ★ KHOẢN ĐỊNH KỲ 03:00 — tiến trình RIÊNG nạp model nhúng LẦN THỨ HAI
>
> `.env` `KB_AUTOSYNC_ENABLED=true`, cron `0 3 * * *` ⇒ `server/services/kbSyncScheduler.ts:232-297` spawn `npm run kb:sync` ⇒ `scripts/ai-kb/embed-incremental.mjs` ⇒ `scripts/ai-kb/_gguf-embed.mjs:76` `loadModel({ modelPath, gpuLayers: -1 })`.
> ⇒ Một tiến trình Node **RIÊNG** giữ bản sao `Qwen3-Embedding-0.6B` **trong khi bản của server vẫn thường trú**, cộng CUDA context riêng của tiến trình đó (tiến trình khác ⇒ **không** dùng chung khối ~430 MiB).
>
> **✅ ĐÃ ĐO THẬT — không phải ước lượng.** Chạy đúng `embedTextGguf()` của `_gguf-embed.mjs` (hàm mà tiến trình con gọi), GPU sạch, app tắt, sidecar ngủ:
>
> | Lượt | Nền | Sau nạp model + ctx | Sau 20 lượt nhúng (tải cron) | **Delta tiến trình con** |
> |---|---|---|---|---|
> | 1 | 1.202 | 2.230 (+1.028) | 2.445 (+215) | **1.243 MiB** |
> | 2 | 1.187 | 2.216 (+1.029) | 2.438 (+222) | **1.251 MiB** |
>
> ⇒ **N=2, lệch 8 MiB** (trong biên ±~25). Bảng dùng **1.251** (số cao hơn, thận trọng).
> ⚠ **Reviewer ước ~2,2-2,6 GB — số đo thật chỉ bằng ~một nửa.** Đây là lần thứ tư trong bốn đợt mà một con số suy-ra lệch khỏi số đo; lần này lệch về phía **bi quan**.
>
> **Câu hỏi vận hành — nếu cron chạy lúc 30B đang thường trú thì sao?**
>
> | Trạng thái lúc 03:00 | Tổng | % trần |
> |---|---|---|
> | Case 1/3 lúc nghỉ (vision ngủ) + cron | `22.838 + 1.251` = **24.089** | **73,9% ✅** rộng |
> | Case 1/3 vision thức + đang sinh (thận trọng) + cron | `31.716 + 1.251` = **32.967** | **101,1% ❌ VƯỢT TRẦN** |
> | Case 1/3 vision thức + đang sinh (theo số đo) + cron | `30.922 + 1.251` = **32.173** | **98,7%** — biên còn **434 MiB** |
>
> ⇒ **Rủi ro thật nhưng hẹp**: chỉ vỡ khi cron 03:00 trùng đúng lúc sidecar thị giác đang thức VÀ 30B đang sinh. Ở hồ sơ nội bộ (hiếm xử lý ảnh, 03:00 không ai làm việc) xác suất thấp — **nhưng không bằng không**, và hiện **không có gì điều tiết**: `evictLRU()` của server **không nhìn thấy** tiến trình con, tiến trình con **không nhìn thấy** VRAM server đang giữ. Đây là hộ tiêu thụ **thứ sáu** không ai hạch toán.

⚠ **Cộng thêm khi ĐANG SINH**: +470-940 MiB mỗi model GGUF hoạt động (Đợt 0 §3) và **+117 MiB** cho sidecar thị giác đang suy luận (Đợt 1 §3, đo với 4 lượt ảnh đồng thời). Mọi con số dưới đây là **lúc nghỉ** — dưới tải phải cộng thêm.

> **⚠ Đợt 2 — số "+470-940 MiB đang sinh" ĐÃ ĐƯỢC ĐO LẠI, và nó CAO HƠN THỰC TẾ.**
>
> | Model đang sinh | Số Đợt 0 dùng trong mọi bảng | Đo lại Đợt 2 |
> |---|---|---|
> | Qwen3-Coder-30B | +470 … **+940** | ✅ **+146 MiB** *(reviewer, 2026-08-02, N=1)* |
> | Qwen3-4B | +470 … +940 | **+72** *(tôi)* · **+78** *(reviewer)* |
> | Qwen2.5-Coder-1.5B | +470 … +940 | **+73** *(tôi)* · **+78** *(reviewer)* |
>
> ⇒ Các ô "dưới tải" cộng +940 đang **bi quan ~794 MiB**. **Mọi bảng dưới đây VẪN GIỮ +940 làm số chính** (thận trọng, và để so sánh được với ba đợt trước), **kèm cách tính bằng +146 bên cạnh**. ⚠ **Chưa RÚT "+470-940"**: N=1 cho 30B, và chưa đo trong đúng kịch bản Đợt 0 dùng để sinh ra con số đó. Chi tiết: Đợt 2 §6(0), §6(ii).

> **✅ Đợt 2 vòng sửa 1 — PHÉP ĐO ĐÓNG LỖ HỔNG LỚN NHẤT CỦA CẢ BA ĐỢT.** Nguồn: **phép đo của reviewer, 2026-08-02, N=1**. Dựng sidecar bằng đúng tham số sản xuất rồi nạp Coder-30B **trong khi sidecar đang thức**:
>
> | Đo | Kết quả | Đối chiếu |
> |---|---|---|
> | Sidecar một mình | `8.904 − 1.079` = **7.825 MiB** | bảng ghi **7.821** ⇒ ✅ **xác nhận** |
> | Coder-30B **cạnh sidecar đang thức** | **19.071 MiB** | đơn lẻ **19.077** ⇒ lệch **6 MiB** |
> | Đỉnh cả hai thức + đang sinh | **27.982 MiB (85,8%)** | còn trống **4.625 MiB** |
>
> ⇒ **PHÉP CỘNG ĐỨNG VỮNG — không có chi phí tương tác ẩn.** Trước vòng này, mọi ô "vision thức" của cả ba đợt là **suy ra**; nay hai khoản lớn nhất (**88%** tổng) là **đo được**.
>
> ⚠ **Vẫn là phép cộng, đừng viết "đã đo hết":** `+117` (sidecar **đang suy luận** — số Đợt 1, đo riêng, chưa đo cùng lúc 30B đang sinh) · `2.232` (model nhúng trong cùng tiến trình với cả hai) · nền `1.200` (quy ước; hôm nay đo 1.248-1.257). Và **N=1**.
>
> ⚠ **Chi phí vận hành mới phát hiện, KHÔNG phải VRAM:** **Coder-30B nạp mất 43,3 s khi sidecar thường trú**, vs **~19,1-19,3 s** ở tiến trình gọn ⇒ **chậm 2,3×**. Đây là dữ kiện **chống lại** hồ sơ `vision-heavy` — xem Case 3.

> **⚠ Biên nhiễu đo: dùng ±~25 MiB, không phải ±~10 MiB.** Con số "±~10" ở §3 báo cáo Đợt 2 dựa trên **hai** điểm. Ba lượt đo FIM cùng cấu hình: **2.184 / 2.188 / 2.208** ⇒ dải thật **24 MiB**. Không đổi ô nào (**0,07%** trần) nhưng cụm này đang được dùng để biện minh nhiều chỗ. ⚠ **Không dùng cụm "khớp chính xác"** cho bất kỳ cặp số VRAM nào.

> **✅ Đợt 2 đã trả lời hai dòng "chưa đo lại" của bảng này.** `node scripts/ai-bench/bench.mjs --models fast|fim`, harness Task 1 đã sửa (parity kiểm độc lập trên `deep`: bench 19.107 vs sản xuất 19.105, lệch **0,01%**). Hai lượt độc lập mỗi model, lệch **1 MiB** (4B) / **4 MiB** (FIM) — **trong biên nhiễu ~±10 MiB**; ⚠ **không** phát biểu "khớp chính xác" cho bất kỳ cặp số VRAM nào.
>
> **Vì sao 4B đắt thêm (+2.070) NHIỀU HƠN cả 30B (+1.344/+1.379):** KV-cache tỉ lệ với `layers × kv_heads × head_dim`, **không** tỉ lệ với số tham số — Qwen3-4B **dense** có nhiều KV head hơn Qwen3-30B-**A3B** (MoE). Đây là **giải thích**, không phải phép đo tách khối KV.
>
> ⚠ **Hệ quả cho cả tài liệu này: Đợt 2 đổi ba dòng — embedding −2.089, 4B +2.070, FIM +414 ⇒ RÒNG +395 MiB TỆ HƠN nếu đếm cả bộ.** Khoản tiết kiệm của Đợt 2 chỉ hưởng được ở cấu hình **không** dùng 4B/FIM riêng.

### ⚠ Vì sao cột "Đợt 0 công bố" sai — hai điểm mù độc lập của `bench.mjs`

Cả hai đều do công cụ đo **tự chứa, không import mã sản xuất** (`bench.mjs` có comment ở đầu file: *"does NOT import any server/ source"*):

**(a) Model nhúng — hụt 2.030 MiB.** `bench.mjs:321` tự gọi `createEmbeddingContext({contextSize:"auto"})` hard-code, và **không** gọi `model.createContext()`. Đường sản xuất (`loadGgufModel()`) tạo **cả hai** context cho model nhúng.

**(b) MỌI model text GGUF — hụt ~1.350 MiB mỗi model.** `bench.mjs:249` tạo context **không truyền `sequences`** (mặc định **1**) và `contextSize` suy từ độ dài prefill của bài đo. Đường sản xuất (`aiGgufEngine.ts:686-691`) tạo `contextSize = GGUF_DEFAULT_CTX = 4096` với `sequences = GGUF_SEQUENCES = 4`. Đo qua `warmModel()` sản xuất: 30B-Instruct **17.750 → 19.094** (+1.344) · Coder-30B **17.698 → 19.077** (+1.379).

⚠ **Mỗi số model trong bảng ĐÃ GỒM ~430 MiB CUDA context dùng chung** ⇒ cộng nhiều model là **đếm lặp** khối đó. Đo được: nạp model nhúng + 30B trong **cùng tiến trình** cho **24.094 MiB**, trong khi cộng rời `1.063 + 4.321 + 19.094 = 24.478` ⇒ **thừa 384 MiB**. Với ba model GGUF, phần thừa ~**860 MiB**. ⇒ **Mọi tổng ở §3 lệch về phía THẬN TRỌNG** (cao hơn thực tế) — không ô nào đổi kết luận, nhưng phải biết khi đọc các ô sát trần.

⇒ **Mọi số Đợt 0 chưa được đo lại bằng đường sản xuất (4B, FIM) phải coi là SÀN, không phải giá trị.**
⇒ Đây là **lần thứ ba** harness đo có điểm mù đúng chỗ quyết định (Đợt 0: `bench.mjs` không biết "vision" ⇒ sót 7,8 GB · Đợt 1 Task 2: hard-code `"auto"` ⇒ sót 2,0 GB · Đợt 1 Task 4: context 1 sequence ⇒ sót ~1,35 GB **mỗi model text**).

---

## 3. Bốn case, bảng chi tiết

### 3.0 ⚠ BẢNG TỔNG HỢP — dùng cột **ĐỢT 2**, không dùng số trong các ô "Lúc nghỉ" bên dưới

Trần **32.607 MiB**. Cột "TRƯỚC Đợt 1" là **số thật đo bằng đường sản xuất**, khác với số Đợt 0 công bố (xem §2).

⚠ **Cột "SAU ĐỢT 2" dưới đây ĐÃ GỒM dòng ONNX/DirectML `+329`** (hộ tiêu thụ thứ năm — xem §2). Cột "SAU ĐỢT 2 (trước §7)" giữ lại số **chưa có ONNX** để thấy đúng phần bị ăn mất.

| Case | Đợt 0 công bố | **TRƯỚC Đợt 1** (thật) | **SAU Đợt 1** | SAU ĐỢT 2 *(trước §7 — thiếu ONNX)* | **SAU ĐỢT 2 + ONNX — số PHẢI DÙNG** | Đổi kết luận? |
|---|---|---|---|---|---|---|
| **1** — một model xuyên suốt, lúc nghỉ | 24.562 (75,3%) | 27.971 (85,8%) | 24.598 (75,4%) | 22.509 (69,0%) | **22.838 (70,0%)** | **không đổi** — vẫn rộng |
| **1** — khi vision thức | 32.383 (99,3%) | 35.792 (**109,8% ❌**) | 32.419 (99,4%) · dưới tải **35.252 = 108,1% ❌** | 30.330 (93,0%) · dưới tải 31.387 (96,3%) / 30.593 (93,8%) | **30.659 (94,0%)** · dưới tải **31.716 (97,3%)** thận trọng / **30.922 (94,8%)** theo số đo | ★★ **VẪN VỪA TRẦN** — nhưng biên **1.220 → 891 MiB** (thận trọng), **ăn mất 27%** biên đã công bố |
| **2** — đồng thời đủ bộ | 42.312 (130% ❌) | 47.065 (**144,3% ❌**) | 43.692 (134,0% ❌) · đủ bộ thật 56.751 | 41.603 (127,6% ❌) · đủ bộ thật 57.146 (175,3% ❌) | **41.932 (128,6% ❌)** · đủ bộ thật **57.475 (176,3% ❌)** | **KHÔNG ĐỔI — vẫn KHÔNG KHẢ THI**, và xa thêm |
| **3** — thị giác thường trú | 32.383 (99,3%) | 35.792 (**109,8% ❌**) | 32.419 (99,4%) · dưới tải **108,1% ❌** | 30.330 (93,0%) · dưới tải 96,3% / 93,8% | **30.659 (94,0%)** · dưới tải **97,3% / 94,8%** | ★★ **cùng lý do Case 1.** ⚠ Vẫn kèm **nạp 30B mất 43,3 s** khi sidecar thường trú |
| **4** — hybrid `balanced`, lúc nghỉ | 28.026 (86%) | 31.435 (96,4%) | 28.062 (86,1%, **SÀN**) | 28.043 (86,0%) | **28.372 (87,0%)** | ★ đổi về **bản chất**, không đổi kết luận — xem dưới |
| **4** — `balanced` + vision thức | *(Đợt 0 không tính)* | 39.256 (**120,4% ❌**) | 35.883 (110,0% ❌) | 35.864 (110,0% ❌) | **36.193 (111,0% ❌)** | **KHÔNG ĐỔI — vẫn vượt trần** |
| **4** — `balanced`, 2 model cùng sinh | *(không tính)* | — | 29.942 (91,8%) | 29.923 (91,8%) | **30.252 (92,8%)** | không đổi |

Thành phần cột "SAU ĐỢT 2 + ONNX" (mọi ô cộng thêm **329** cho ONNX/DirectML):
- Case 1 / 3: `1.200 + 19.077 (Coder-30B) + 2.232 (embed) + 329 (ONNX) = 22.838` · `+ 7.821 (vision) = 30.659` · dưới tải `+ 940 (model đang sinh) + 117 (sidecar đang suy luận) = 31.716`
- Case 2 (mức **tối thiểu**, chỉ 2 model 30B + embed): `1.200 + 19.077 + 19.094 + 2.232 + 329 = 41.932`. Đủ bộ thật (thêm 4B + FIM + vision) = **57.475 (176,3%)**
- Case 4: `1.200 + 19.077 + 5.534 (4B — **nay đo thật**) + 2.232 + 329 = 28.372` · `+ 7.821 = 36.193` · 2 model cùng sinh `+ 940 + 940 = 30.252`

> **★★ ĐIỀU PHẢI NÓI THẲNG VỀ Ô TIÊU ĐỀ: `96,3%` → `97,3%`, biên `1.220` → `891 MiB`.**
>
> Ô "Case 1/3 dưới tải, thận trọng" là con số chủ dự án sẽ dựa vào để chốt roster. Thêm một dòng ONNX **không lật ✅ thành ❌** — nhưng nó **ăn mất 27% biên an toàn đã công bố** (`(1.220 − 891) / 1.220 = 27%`). Theo cách tính B (số đo `+146`): `93,8% → 94,8%`, biên `2.014 → 1.685 MiB`.
>
> ⚠ Và **891 MiB là biên trước khi tính hai khoản khác**: cache ONNX đầy 5 session (**đo được +991**, không phải ~1.645 như bản trước ngoại suy) ⇒ **32.378 = 99,3% ✅**, biên còn **229 MiB** — **vẫn vừa**, và hôm nay **cache tối đa 1 mục** nên chưa tới. · tiến trình cron 03:00 (**+1.251 MiB đo được**) ⇒ **101,1% ❌** — **đây mới là khoản lật dấu**. ⇒ Kết luận đúng phạm vi: **"vừa trần khi KHÔNG có cron 03:00 chạy cùng lúc"**.

**Vì sao số hạng "+1.776 đỉnh nhất thời khi nhúng đồng thời" BIẾN MẤT khỏi cột Đợt 2:** đó là race `getEmbeddingContext()` mà review cổng cuối Đợt 1 tìm ra (N lượt nhúng đồng thời tạo N context, N−1 bản mồ côi). **Đợt 2 Task 3 đã vá** bằng khoá in-flight, **đo được**: 4 lượt đồng thời **2.430 → 652 MiB**. Số hạng này không còn tồn tại — và đó là phần lớn lý do ô Case 1/3 dưới tải đổi kết luận.

#### ⚠ Cột Đợt 1 từng TRỘN HAI ĐỊNH NGHĨA "dưới tải" — đã quy về một

Hai con số Đợt 1 hay bị trích cạnh nhau **không cùng công thức**: **102,7%** = `32.419 + 940 + 117` (**không có** +1.776) · **~104,9%** = `32.419 + 1.776` (**không có** +940 và +117). ⇒ **Trường hợp xấu nhất THẬT của Đợt 1** là đủ ba số hạng: `32.419 + 940 + 117 + 1.776` = **35.252 MiB = 108,1%** — bảng trên nay dùng con số này.

| Quy về **cùng định nghĩa** (đủ ba số hạng; Đợt 2 không còn +1.776 vì đã vá) | Đợt 1 | Đợt 2 thận trọng (+940) | Đợt 2 theo số đo (+146) |
|---|---|---|---|
| Case 1/3 dưới tải — *trước §7, thiếu ONNX* | **35.252 (108,1% ❌)** | 31.387 (96,3% ✅) | 30.593 (93,8% ✅) |
| **Case 1/3 dưới tải — GỒM ONNX (+329)** | **35.252 (108,1% ❌)** | **31.716 (97,3% ✅)** | **30.922 (94,8% ✅)** |

⇒ Cải thiện thật là **108,1% → 97,3%** (hoặc **→ 94,8%**), **không** phải "104,9% → 96,3%" như bản trước viết. Bản trước so hai ô khác định nghĩa — lệch **theo hướng làm Đợt 1 đẹp hơn**, nên tuyên bố cải thiện khi đó là **thận trọng**, không thổi phồng.
⚠ Dòng Đợt 1 **không cộng ONNX** vì cột đó tái dựng trạng thái Đợt 1 để so sánh; nếu cộng cả hai vế thì khoảng cách giữ nguyên (ONNX là hằng số ở mọi cột).

#### ⚠ `2.089` hay `2.090` cho khoản tiết kiệm model nhúng? — **cả hai đúng, khác gốc trừ**

**2.089** = `4.321 − 2.232`, với `4.321` là số **Đợt 1 CÔNG BỐ** — dùng ở mọi bảng so-sánh-ba-đợt để hai cột trừ được cho nhau. **2.090** = `4.322 − 2.232`, với `4.322` là số **Task 3 ĐO ĐƯỢC** cho nhánh TRƯỚC — dùng khi báo cáo chính phép đo đó. Chênh **1 MiB** nằm sâu trong biên nhiễu **±~25 MiB**. **Không phải lỗi.**

#### ★ Case 4 `balanced` — con số gần như không đổi, nhưng LÝ DO đổi hẳn

Đợt 1 ghi 28.062 (86,1%) **SÀN** và ước *"nếu 4B đắt thêm ~1.350 MiB thì ≈ 29.412 (90,2%) — CHƯA ĐO"*. Đợt 2 đo thật: **28.043 (86,0%)** → **cộng ONNX: 28.372 (87,0%)**. **Không phải "dự đoán thận trọng, thực tế tốt hơn"** — hai sai số lớn triệt tiêu nhau: embedding **−2.089**, 4B **+2.070**, ròng **−19 MiB**. ⇒ Con số 86,1% của Đợt 1 **đúng vì may**; và dự đoán "+1.350 cho 4B" **hụt 720 MiB** so với thực tế (+2.070). Khác biệt thật: Đợt 1 là **sàn không có trần trên**, Đợt 2 là **số đo có lặp lại**.

**Bốn điều phải nói thẳng (cập nhật Đợt 2):**
1. **Case 2 không phải "gần khả thi", và Đợt 2 đẩy nó XA HƠN.** Riêng nền + hai model 30B = `1.200 + 19.077 + 19.094 = 39.371 MiB`, **vượt trần 6.764 MiB ngay cả khi embedding bằng KHÔNG**. Cộng cả hai đợt giành lại (3.373 + 2.089 = 5.462 MiB) **vẫn không đủ**, và không còn gì để giành ở hai model 30B. Ô "đủ bộ thật" **tệ đi**: 56.751 → **57.475** (gồm ONNX).
2. ~~**97,3% của Case 1/3 dưới tải là một PHÉP CỘNG, không phải phép đo.**~~ ✅ **ĐÃ ĐÓNG (2026-08-02, reviewer, N=1)**: 30B + sidecar **cùng thức** đã được đo trực tiếp — 30B cạnh sidecar tốn **19.071** vs **19.077** khi đứng một mình ⇒ **phép cộng đứng vững**. ⚠ **Phát biểu đúng phạm vi từ nay:** *"hai khoản lớn nhất (sidecar 7.825 + 30B 19.071 = **88%** tổng) là PHÉP ĐO, N=1; `+117` (sidecar đang suy luận) và `2.232` (model nhúng) VẪN là phép cộng."* **Không viết "đã đo hết".**
3. **Đợt 0 đã công bố một cấu hình VƯỢT TRẦN là "sát trần"**: Case 1 + vision công bố 32.383 (99,3%), số thật lúc đó là **35.792 (109,8%)**. Giữ vết này.
4. 🚧 **Không ô nào trong bảng này có nghĩa "chạy được".** App hiện **không nạp được model 30B** trên đường boot bình thường (xem callout đầu tài liệu). Bảng nói *"nếu nạp được thì vừa"*.

#### ⚠ Biến thể phải biết: cấu hình `.env` ĐANG chạy KHÔNG phải Case 1

Case 1 giả định **không có model FIM riêng** (spec hồ sơ §2.3: trỏ `GGUF_FIM_MODEL` vào chính Coder-30B). `.env` hiện tại: `GGUF_DEFAULT_MODEL=Qwen3-30B-A3B-Instruct` · `GGUF_CODE_MODEL=Qwen3-Coder-30B` · `GGUF_FIM_MODEL=Qwen2.5-Coder-1.5B` — **hai model 30B khác nhau + một FIM riêng** ⇒ đó là **một biến thể của Case 2**, **không khả thi** nếu cả hai tier cùng được dùng.

Ngay cả biến thể lành nhất (deep = code = Coder-30B, **giữ FIM 1,5B riêng**), **gồm ONNX +329**: lúc nghỉ **25.026 (76,8%)** · + vision **32.847 (100,7% ❌)** · + một model đang sinh + sidecar suy luận **33.904 (104,0% ❌)** · + ghost-text và sinh code đồng thời **34.374-34.844 (105,4-106,9% ❌)**.

> **★ MỘT Ô ĐỔI DẤU KHI CỘNG ONNX: biến thể "giữ FIM riêng" + vision thức, LÚC NGHỈ.**
> Trước §7: `32.518 = 99,7% ✅` (sát trần nhưng vừa). Cộng ONNX: `32.847 = **100,7% ❌ VƯỢT TRẦN**`.
> ⇒ Với FIM riêng, cấu hình này **không còn tồn tại được ngay cả khi KHÔNG sinh gì cả** — chỉ cần sidecar thị giác thức. Đây là ô **duy nhất** trong cả hai tài liệu bị ONNX lật dấu, và nó lật ở **chính cấu hình `.env` đang chạy** (`GGUF_FIM_MODEL=Qwen2.5-Coder-1.5B`).

⇒ **Khoản 2.188 MiB của FIM riêng chính là thứ đẩy Case 1 từ "vừa dưới tải" (97,3%) sang "vượt trần" (104,0%)** — và nay còn đẩy cả ô **lúc nghỉ + vision** qua trần. Gộp FIM vào Coder-30B không còn là tối ưu nhỏ — nó là **điều kiện để Case 1/3 vừa trần**.

---

### Case 1 — MỘT MODEL XUYÊN SUỐT (roster A, vision theo yêu cầu)

| | |
|---|---|
| **Cấu hình** | `GGUF_DEFAULT_MODEL` = `GGUF_CODE_MODEL` = Coder-30B · embedding · **không** model FIM riêng · vision bật khi cần |
| **Lúc nghỉ** | ~~1.200 + 17.698 + 5.664 = 24.562 MiB (75,3%)~~ *(Đợt 0)* → ~~Đợt 1: 24.598 MiB (75,4%)~~ → ~~Đợt 2 trước §7: 22.509 (69,0%)~~ → **Đợt 2 + ONNX: 1.200 + 19.077 + 2.232 + 329 = 22.838 MiB (70,0%)** |
| **Khi vision thức** | ~~32.383 MiB (99,3%)~~ *(Đợt 0 — số thật lúc đó là 35.792, **109,8%**)* → ~~Đợt 1: 32.419 (99,4%)~~ → ~~Đợt 2 trước §7: 30.330 (93,0%)~~ → **Đợt 2 + ONNX: 30.659 MiB (94,0%)** |
| **Dưới tải** | vision ngủ: **23.778 (72,9%) — vừa rộng**. Vision thức, **hai cách tính**: thận trọng `30.659 + 940 + 117` = **31.716 (97,3%)** · theo số đo `30.659 + 146 + 117` = **30.922 (94,8%)**. **★★ VỪA TRẦN, lần đầu tiên** (Đợt 1 quy cùng định nghĩa: **108,1% ❌**). Số hạng "+1.776 nhúng đồng thời" **không còn** (Task 3 vá race, 2.430 → 652 MiB). ✅ **Nay là PHÉP ĐO** cho hai khoản lớn nhất — reviewer đo 30B + sidecar cùng thức, N=1. ⚠ Biên chỉ còn **891 MiB** sau khi cộng ONNX (trước là 1.220) |
| **Đổi/quay lui** | **một dòng** `.env:120` — ⚠ nhưng phải **kèm** `GGUF_FIM_MODEL` (xem biến thể ở §3.0): giữ FIM 1,5B riêng đẩy ô "dưới tải + vision" lên **104,0% ❌**, và nay đẩy cả ô **lúc nghỉ + vision** lên **100,7% ❌** |
| **Điểm mạnh** | đơn giản nhất · KV cache rộng nhất khi vision ngủ · khớp ưu tiên "nghiêng code" · **roster DUY NHẤT vừa trần ở mọi trạng thái đã tính** |
| **Điểm yếu** | **không có model general riêng** — ~~chất lượng văn xuôi tiếng Việt phụ thuộc Coder-30B (chờ chủ dự án chấm)~~ ✅ **đã chấm 2026-08-02: Coder viết tiếng Việt NHỈNH HƠN general (mức nhẹ)** ⇒ điểm yếu này **không còn** · 10 phút vision thức là 10 phút ở 93-96% |
| **Hợp với** | khách nặng lập trình/PLC, ít xử lý ảnh |

### Case 2 — ĐỒNG THỜI ĐỦ BỘ

| | |
|---|---|
| **Cấu hình** | Coder-30B + General-30B + 4B + FIM + embedding + vision |
| **Lúc nghỉ** | ~~≥ 1.200 + 17.698 + 17.750 + 5.664 = 42.312 MiB (130%)~~ *(Đợt 0)* → ~~Đợt 1: 43.692 MiB (134,0%); đủ bộ thật 56.751 (174,0%)~~ → **Đợt 2 + ONNX: 1.200 + 19.077 + 19.094 + 2.232 + 329 = 41.932 MiB (128,6%)**; đủ bộ thật (thêm 4B **5.534** + FIM **2.188** + vision 7.821) = **57.475 (176,3%)** |
| **Kết luận** | ❌ **KHÔNG KHẢ THI — Đợt 1 và Đợt 2 đều KHÔNG ĐỔI kết luận này.** Đã xác nhận **đo trực tiếp**: nạp model 30B thứ hai bị từ chối nguyên văn `Not enough VRAM to fit the model with the specified settings` |
| **⚠ Đợt 2 làm ô "đủ bộ" TỆ ĐI** | 56.751 → **57.475 (+724 MiB)**. Đợt 2 giành lại 2.089 MiB ở model nhúng nhưng **phát hiện thêm 2.484 MiB** ở 4B (+2.070) và FIM (+414) — hai số Đợt 0 công bố là **SÀN**. **Càng đo càng xa, không phải càng gần** |
| **Hợp với** | — |

⚠ **Đây là điều quan trọng nhất phải nói thẳng: trên 32,6 GB, KHÔNG cấu hình nào cho phép đủ bộ cùng lúc.** Mọi lựa chọn đều là đánh đổi.

⚠ **Và không phải "gần khả thi".** Riêng nền + hai model 30B (đường sản xuất) = `1.200 + 19.077 + 19.094 = 39.371 MiB`, **vượt trần 6.764 MiB ngay cả khi embedding bằng KHÔNG**. Khoản Đợt 1 giành lại (3.373 MiB) **không tới một nửa** chỗ còn thiếu; cộng cả Đợt 2 (2.089 MiB) thành 5.462 MiB — **vẫn không đủ**, và **hai model 30B không còn gì để giành** (Đợt 2 không đụng được dòng nào của chúng). Muốn Case 2 khả thi thì phải đổi phần cứng hoặc đổi hẳn hạng model, không phải chỉnh buffer.

### Case 3 — THỊ GIÁC ƯU TIÊN (vision thường trú, tắt idle-timeout)

| | |
|---|---|
| **Cấu hình** | vision **giữ thường trú** (`LLAMA_VISION_IDLE_TIMEOUT_MS` rất lớn) + Coder-30B + embedding |
| **Lúc nghỉ** | ~~1.200 + 7.821 + 17.698 + 5.664 = 32.383 MiB (99,3%)~~ *(Đợt 0 — số thật lúc đó là **35.792, 109,8% ❌ đã vượt trần**)* → ~~Đợt 1: 32.419 (99,4%)~~ → ~~Đợt 2 trước §7: 30.330 (93,0%)~~ → **Đợt 2 + ONNX: 1.200 + 7.821 + 19.077 + 2.232 + 329 = 30.659 MiB (94,0%)** |
| **Dưới tải** | ~~33.476 (102,7%) / ~104,9%~~ *(Đợt 1, quy đủ ba số hạng = **108,1% ❌**)* → **Đợt 2 + ONNX: 31.716 (97,3%)** thận trọng / **30.922 (94,8%)** theo số đo — **★★ VỪA TRẦN, lần đầu tiên.** Đợt 1 đưa case này từ "không thể tồn tại" về "tồn tại được lúc nghỉ"; **Đợt 2 đưa nó thành dùng được dưới tải** (biên **891** hoặc **1.685 MiB** — trước khi cộng ONNX là 1.220 / 2.014). ✅ **Nay là PHÉP ĐO** cho hai khoản lớn nhất (N=1). ⚠ **Cron 03:00 (+1.251) đẩy ô thận trọng lên 101,1% ❌** |
| **⚠ Chi phí vận hành MỚI phát hiện — dữ kiện CHỐNG LẠI case này** | **Nạp Coder-30B mất 43,3 s khi sidecar thị giác thường trú**, vs **~19,1-19,3 s** ở tiến trình gọn ⇒ **chậm 2,3×** (reviewer đo, 2026-08-02, N=1). Điều này đánh đúng vào **lý lẽ tồn tại duy nhất** của case: giữ sidecar thường trú để ảnh **không phải chờ ~40 s khởi sidecar**. ⇒ Case 3 **đổi thứ chờ**, không **xoá** cái chờ: mỗi lượt nạp/đuổi model 30B nay đắt thêm **~24 giây**. ⚠ Cơ chế **chưa biết**, N=1, chưa đo trên đường boot app thật |
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
| **Hồ sơ** | `code-heavy` (Case 1) · `vision-heavy` (Case 3) · `balanced` (Coder-30B + 4B general + embedding, vision theo yêu cầu): ~~1.200+17.698+3.464+5.664 = 28.026 MiB, 86%~~ *(Đợt 0)* → ~~Đợt 1: 28.062 MiB, 86,1%~~ → **Đợt 2 + ONNX: 1.200+19.077+5.534+2.232+329 = 28.372 MiB, 87,0%** |
| **⚠ `balanced` — điều Đợt 0 không tính** | **Khi vision thức: Đợt 2 + ONNX = 36.193 MiB = 111,0% ❌ VƯỢT TRẦN.** Hồ sơ `balanced` **không được** để sidecar thị giác thường trú. Cả Đợt 1 lẫn Đợt 2 **không** đổi điều này (trước Đợt 1: 120,4%) |
| **✅ `balanced` HẾT là số SÀN — nhưng vì hai sai số triệt tiêu nhau** | Đợt 2 đo 4B bằng đường khớp sản xuất: **5.534** (không phải 3.464). Cộng lại: embedding **−2.089**, 4B **+2.070** ⇒ **ròng −19 MiB**, nên tổng gần như đứng yên (86,1% → 86,0%; **87,0%** sau khi cộng ONNX). ⚠ **Đừng đọc thành "dự đoán thận trọng"** — dự đoán "+1.350 cho 4B" của Đợt 1 **hụt 720 MiB**; con số 86,1% đúng **vì may** |
| **⚠ `balanced` mất lý do tồn tại chính** | Nó sinh ra để **dự phòng phòng khi Coder-30B viết tiếng Việt tệ**. Chủ dự án đã chấm A/B (2026-08-02): **Coder viết nhỉnh hơn general**. ⇒ Rủi ro đó **không xảy ra**. Và về VRAM nó **thua** `code-heavy` ở cột nguy hiểm nhất (vision thức: 111,0% ❌ so với 94,0% ✅). **Đề nghị hạ xuống "chỉ dùng khi có lý do KHÁC lý do tiếng Việt"** (ví dụ cần model general cho tác vụ ngoài code) |
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

### 4.1 BẢY hộ tiêu thụ GPU, không ai nắm tổng

| Hộ tiêu thụ | Cơ chế điều tiết | Biết tổng VRAM? | **Đã vào bảng ngân sách?** |
|---|---|---|---|
| GGUF trong tiến trình (`aiGgufEngine`) | `GGUF_MAX_CONCURRENCY=4` | ✅ **chỉ cho mình** (`readVramState()` dòng 303, dùng ở 350) | ✅ từ Đợt 0 |
| ONNX (`aiInferenceEngine`) | `AI_GPU_CONCURRENCY=2`, **semaphore riêng**; cache `AI_SESSION_CACHE_MAX=5` | ✅ **nay ĐÃ BIẾT** — **329-339 MiB/session** và **991 MiB khi cache đầy 5** (§2, đo cả hai). Trạng thái sống: **cache tối đa 1 mục** (chỉ 1 model ONNX có file) | ✅ **từ Đợt 2 §7** *(trước đó: gọi tên ở đây, vắng mặt khỏi mọi phép cộng)* |
| Vision sidecar (`llama-server`) | **không có** — tiến trình riêng | ❌ | ✅ từ Đợt 0 (sau khi bị bỏ sót) |
| Reranker (`aiReranker`) | **bypass semaphore GGUF** | ❌ (an toàn **chỉ nhờ** `RAG_RERANKER_GPU=false`) | n/a — chạy CPU |
| **★ Cron 03:00 `kb:sync`** (tiến trình Node riêng) | **không có** — `evictLRU()` không thấy nó, nó không thấy server | ❌ | ✅ **từ Đợt 2 §7** — đo được **1.251 MiB** |
| **★ Chromium (puppeteer)** — `reportGenerator.ts:382-409` | **không có**; ⚠ **không** truyền `--disable-gpu` | ❌ | ⚠ **nhiễu** — vài chục MB, chưa đo riêng |
| **★ PyTorch trainer** — `LOCAL_TRAINER_CMD` (đang bật) | **không có** — tiến trình Python riêng | ❌ | ⚠ **nhiễu** — rời rạc, **theo yêu cầu**, chưa đo |

**Không thành phần nào hạch toán cả thiết bị.**

> ⚠ **Hai dòng cuối là NHIỄU, ghi ra cho ĐỦ DANH SÁCH — không cộng vào ô nào.** Chromium chỉ thức lúc xuất báo cáo và **không** bị ép `--disable-gpu` nên có thể chạm GPU; PyTorch trainer chạy rời rạc theo yêu cầu và có thể tốn **hàng GB** khi chạy. Cả hai **chưa đo**. Ghi ở đây để lần sau không ai "phát hiện lại" chúng như một cú sốc — đúng cái đã xảy ra với sidecar (Đợt 0) và ONNX (đợt này).

⇒ Đây là **nguyên nhân gốc rễ** của mọi thứ Đợt 0 tìm ra. Sidecar 7,8 GB lọt qua **7 task + 7 review + 7 re-review** không phải vì ai cẩu thả — nó **vô hình về mặt cấu trúc**.
⇒ ★★ **Và nó đã LẶP LẠI ở Đợt 2**: ONNX được **gọi tên ngay trong bảng này** với dấu ❌ ở cột "Biết tổng VRAM?", rồi **sáu lượt review theo-task không lượt nào cộng nó vào**. Bị gọi tên **không** đồng nghĩa với được hạch toán. Cột "Đã vào bảng ngân sách?" thêm vào chính để cắt vòng lặp đó.
⇒ Race double-warm cùng gốc: **không ai sở hữu "trạng thái đang nạp model"**.

### 4.2 Cổng không phải cổng

| Đường | Số lời gọi sinh chữ |
|---|---|
| Qua `aiGateway` (`planInference`/`routeInference`) | **36** |
| **Thẳng** `aiGgufEngine` (`chatCompletion`/`generateText`/`generateJSON`/`generateFim`) | **26** |

**42% đi vòng.** Hệ quả đã đo: toàn bộ tier code/fim **vô hình với `ai_gateway_metrics`** (0 dòng), và `ai_model_metrics` cũng 0 dòng — **không có nguồn thay thế**.
⇒ Mọi quyết định về model cho lập trình viên **đang bay mù**, kể cả quyết định trong chính tài liệu này.

> **✅ Đợt 2 Task 2 ĐÃ NỐI — nhưng "đo được" ≠ "đã có dữ liệu".**
>
> Ba điểm gọi của `aiProgrammingCopilot` nay đi qua `aiGateway` **chỉ để đo** (không đổi model được chọn). Kết quả SQL sống: `ai_gateway_metrics` **0 → 4 dòng**, `code` = `Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL` ×3 · `fim` = `Qwen2.5-Coder-1.5B-Instruct-Q4_K_M` ×1, **tên GGUF thật**, `tier` đúng (2 cho code, 1 cho fim). `ai_model_metrics` vẫn **0 dòng**.
>
> ⚠⚠ **BẪY ĐẾM — phải nói trước khi ai dùng `count(*)`:** một dòng metric = **một lượt SUY LUẬN GPU**, **không phải** một lượt người dùng. Đo được: **MỘT** lệnh `generateProgram()` sinh **BA** dòng `code` (1 lần sinh + 2 vòng self-repair); fallback GBNF→free-text cũng sinh dòng riêng. Đọc "3 lượt code" thành "3 lần bấm nút" là **đánh giá quá cao ~3 lần**.
>
> ⚠ **Toàn bộ 77 dòng hiện có là lưu lượng DỰNG, không phải lưu lượng thật** (4 dòng `code`/`fim` là của chính phiên nghiệm thu Task 2; 55/77 dòng dồn vào một ngày nghiệm thu 31/7; 6 dòng `rca` có `tokensIn=tokensOut=0`; và app **không boot được với 30B** nên không thể có lưu lượng người dùng thật qua tier deep/code). ⇒ **Câu hỏi "ưu tiên nghiêng code đúng hay chỉ là cảm giác" VẪN CHƯA CÓ ĐÁP ÁN.** Đường ống thông, **chưa có hàng**.
>
> ⚠ **Lỗ đo MỚI lộ ra:** tier `vision` ghi `model = 'default'` cho cả 16 dòng — **không phải tên model thật**. Tier vision vẫn **mù về model**. Chưa vá. Chi tiết: Đợt 2 §6(i).

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

> **⚠⚠ Trạng thái các bước SAU ĐỢT 2 (2026-08-02) — đọc bản này, không đọc bản Đợt 1 ở trên:**
>
> | Bước | Trạng thái sau Đợt 2 |
> |---|---|
> | **A** — thành phần nắm ngân sách VRAM | ❌ **chưa làm**, vẫn là nợ lớn nhất. Cố ý ngoài phạm vi Đợt 2 (cần spec riêng — lớn hơn hẳn một task) |
> | **B** — vá race + nguyên nhân thứ ba | ⚠ Race đã vá (Đợt 1). **Nguyên nhân thứ ba VẪN CHƯA SỬA và VẪN TÁI HIỆN tại HEAD (3/3 lượt)**. Đợt 2 Task 5 **chỉ điều tra, không vá** (đúng ràng buộc). Đợt 2 hạ dấu chân boot xuống 3,27 GB mà lỗi **y hệt** ⇒ **không phải bài toán chật chỗ**. Loại thêm được: nửa HTTP/Vite (`dev:worker` hỏng y hệt) · "cần model thường trú" (chỉ **chạm** `getLlama()` là đủ, giá ~420-430 MiB / ~1,2-2,3 s) · "CUDA khởi tạo muộn một mình" (tiến trình trống + chờ 35 s vẫn nạp được 16,7 GB). **Ratchet chưa bị bác bỏ.** ⚠ Mọi ngưỡng trung gian **đã bị RÚT**; số duy nhất trích được: **16.698,37 MiB** |
> | **C** — chỉnh buffer | ✅ **ĐÃ LÀM XONG PHẦN LỚN.** Đợt 2 giành thêm **2.089 MiB** ở model nhúng (bỏ context thường cho model chỉ-nhúng + khoá in-flight): **4.321 → 2.232**. Cộng hai đợt: **5.462 MiB**. Sidecar **không giành được gì** (`kv_unified=true`). ⇒ **Dư địa lớn đã hết** — muốn thêm phải đổi hạng model hoặc phần cứng |
> | **D** — chốt roster | ⚠ **Biến "tiếng Việt" ĐÃ ĐÓNG** (chủ dự án chấm 2026-08-02: Coder nhỉnh hơn) và **ngân sách VRAM đã rõ** (chỉ `code-heavy`/`vision-heavy` vừa trần). **Chỉ còn chặn bởi bước B.** ⇒ Roster **chọn được trên giấy**, **chưa chạy được trên máy** |
> | **E** — cơ chế hồ sơ | ❌ chưa làm, đúng thứ tự (sau D) |
>
> ⚠ **Bước C KHÔNG làm đổi kết luận bước D như §5 dự đoán.** Dự đoán: "giải phóng 6,4 GB ⇒ Case 3 xuống ~79%". Thực tế hai đợt: giải phóng **5.462 MiB**, Case 3 xuống **94,0%** (dưới tải 97,3%). Vẫn là **đổi kết luận thật** cho Case 1/3 (từ vượt trần thành vừa trần dưới tải), nhưng **không** ở mức mà §5 tưởng.

---

## 6. Khi nào cần đổi model — tiêu chí, không phải danh sách

Kiến thức của tôi về model dừng khoảng **5/2026**, nên tài liệu này **không khuyến nghị model cụ thể ngoài kho hiện có**. Thay vào đó là tiêu chí để chủ dự án tự quyết khi có model mới:

| Tín hiệu | Nghĩa là gì |
|---|---|
| Bước C xong mà vẫn không đủ chỗ cho hồ sơ cần thiết | Trần 32,6 GB là ràng buộc cứng ⇒ xét lượng tử hoá sâu hơn, model nhỏ hơn, **hoặc GPU thứ hai**. ⚠ **Đợt 2: bước C đã hết dư địa lớn** — tín hiệu này nay **đang bật** cho Case 2 |
| ~~A/B tiếng Việt cho thấy Coder-30B viết kém~~ | ✅ **ĐÃ CHẤM 2026-08-02 — không xảy ra.** Coder viết tiếng Việt **nhỉnh hơn** general (mức nhẹ). ⇒ Tín hiệu này **tắt vĩnh viễn**; `balanced` mất lý do tồn tại chính |
| Tier code/fim đo được (sau khi vá 4.2) cho thấy lưu lượng thấp | Ưu tiên "nghiêng code" mất cơ sở ⇒ xét lại toàn bộ. ⚠ **Đợt 2 đã vá 4.2 (0 → 4 dòng), nhưng 4 dòng đó là lưu lượng DỰNG** ⇒ tín hiệu này **chưa đọc được**; và khi đọc phải đếm theo **lượt người dùng**, không theo `count(*)` (tỉ lệ đo được 3:1) |
| Có model MoE mới với số tham số hoạt động thấp hơn | MoE cho phép đẩy sang RAM 64 GB rẻ hơn model dense — đường roster C khả thi hơn |

**Ba đường thoát khi chạm trần**, chưa đường nào được đo: lượng tử hoá sâu hơn · model nhỏ hơn · GPU thứ hai.

---

## 7. Điều tài liệu này KHÔNG trả lời được

Trung thực về chỗ yếu, để chủ dự án không quyết dựa trên khoảng trống:

- ~~**Chất lượng tiếng Việt của Coder-30B** — 3 cặp A/B đang chờ chấm.~~ ✅ **ĐÃ CHẤM 2026-08-02**: Coder **nhỉnh hơn** general, mức **nhẹ**; cả hai đều ổn. ⇒ Biến quyết định giữa Case 1 và `balanced` **đã đóng, nghiêng về Case 1**.
- ~~**§4 không đo model 4B** ⇒ hồ sơ `balanced` thiếu bằng chứng cho chính model general nó sẽ dùng.~~ ✅ **Đợt 2 ĐÃ ĐO**: 4B = **5.534 MiB** (không phải 3.464 — Đợt 0 hụt **2.070**). FIM = **2.188** (hụt 414). Hồ sơ `balanced` nay có bằng chứng — và bằng chứng đó **không cứu nó** (vision thức vẫn **111,0% ❌**).
- **Lưu lượng thật của tier code/fim** — ⚠ **Đợt 2 đã vá 4.2** (`ai_gateway_metrics` 0 → 4 dòng, tên model thật), **nhưng 4 dòng đó là lưu lượng DỰNG do chính phiên nghiệm thu sinh ra**. **Vẫn chưa có lưu lượng thật.** Và `count(*)` là số lượt **suy luận GPU**, không phải số lượt người dùng (tỉ lệ đo được **3:1**).
- ~~**Buffer embedding 4,5 GB** — biết có, **chưa truy nguyên nhân**.~~ ✅ **Đợt 1 ĐÃ TRẢ LỜI**: nguyên nhân là `contextSize:"auto"` trong `getEmbeddingContext()`; chi phí thật 7.694 MiB (không phải 5.664); sau khi đổi sang `EMBED_CTX=2048` còn **4.321 MiB**.
- ~~**Hiệu quả của `-np 1`** — chưa đo, **cần sửa mã**.~~ ✅ **Đợt 1 ĐÃ TRẢ LỜI**: **~0 MiB** (trong nhiễu đo). Tiền đề "n_parallel=4 nhân bốn KV-cache" **sai** — build `llama-server` đang cài dùng `kv_unified=true`.
- **Roster C chưa chạy qua boot app thật.** ⚠ **Đợt 1 làm rõ thêm: KHÔNG roster nào chạy được qua boot app thật** — app không nạp nổi model 30B (xem §5).
- ~~**KV cache cho 30B chưa bao giờ đo được**.~~ ✅ **Đợt 1 đo được gián tiếp**: context sản xuất (4096 token × 4 sequences) tốn **+1.344 MiB** cho 30B-Instruct và **+1.379 MiB** cho Coder-30B (hiệu số giữa `warmModel()` sản xuất và `bench.mjs`). Đây chính là khoản Đợt 0 bỏ sót.
- **Tất cả số là lúc nghỉ** — dưới tải phải cộng +470-940 MiB mỗi model GGUF, +117 MiB cho sidecar đang suy luận.

**Đợt 1 để lại những câu hỏi MỚI chưa trả lời được:**

- **CƠ CHẾ vì sao khối 16,7 GB không cấp phát được khi CUDA context tạo SAU boot app.** Biết **điều kiện**, **không** biết **vì sao**. ⚠ **Đợt 2 điều tra tiếp và làm hẹp hơn, KHÔNG vá**: loại thêm nửa HTTP/Vite, "cần model thường trú", "muộn một mình"; **ratchet chưa bị bác bỏ**; **mọi ngưỡng trung gian đã bị RÚT vì không tái hiện** (số duy nhất còn trích được: **16.698,37 MiB**). ⇒ **Đường vòng vẫn chưa nên thành mã** — nó xoá đúng tín hiệu ồn ào duy nhất đang có, trong khi trần có thể **không tất định**. Phép thử phải chạy trước mọi bản vá: lặp cùng một lượt thử **5 lần**.
- ~~**Model 4B và FIM chưa được đo lại bằng đường sản xuất**~~ ✅ **Đợt 2 ĐÃ ĐO** — xem §2. Cả hai đều **đắt hơn** số Đợt 0: 4B **+2.070**, FIM **+414**.
- ~~**Chưa từng đo 30B + sidecar thị giác CÙNG THỨC trên một máy**~~ ✅ **ĐÃ ĐO (2026-08-02, reviewer, N=1)**: sidecar **7.825** · 30B cạnh sidecar **19.071** (đơn lẻ 19.077) · đỉnh cả hai + đang sinh **27.982 (85,8%)**, còn trống **4.625**. **Phép cộng đứng vững.** ⚠ **Còn là phép cộng**: `+117` (sidecar đang suy luận, chưa đo cùng lúc 30B đang sinh) và `2.232` (model nhúng trong cùng tiến trình). ⚠ **N=1, chưa lặp lại.**
- ~~**`+470-940 MiB mỗi model đang sinh` là số Đợt 0, chưa đo lại.**~~ ✅ **ĐÃ ĐO**: 30B **+146 MiB** (reviewer) · 4B **+72/+78** · FIM **+73/+78**. Giữ +940 làm số chính vì thận trọng ⇒ ô "dưới tải" **bi quan ~794 MiB**. ⚠ **Chưa RÚT** con số Đợt 0 (N=1, chưa đo trong đúng kịch bản gốc).
- **Chi phí NẠP khi sidecar thường trú — cơ chế chưa biết.** 30B nạp **43,3 s** khi sidecar thường trú vs **~19,1-19,3 s** tiến trình gọn (**2,3×**). N=1. Không phải VRAM, nhưng đổi cán cân của hồ sơ `vision-heavy`.
- ~~**Nhánh `catch` nạp lại `gpuLayers:"auto"` có phải mã chết không?**~~ ✅ **ĐÃ TRẢ LỜI: ĐÚNG LÀ MÃ CHẾT** (`err.message = "Failed to load model"` ⇒ `isOom = false`). Cơ chế phục hồi mà §3 Case 3 mô tả **chưa từng hoạt động**. Câu hỏi còn lại: **sửa thế nào** — bắt theo stderr, hay đổi cách node-llama-cpp báo lỗi? Đợt riêng.
- ~~**Comment `aiGgufEngine.ts:1108-1109` mô tả SAI sự thật**~~ ✅ **Đợt 2 Task 6 ĐÃ SỬA** (dòng thật là `aiGgufEngine.ts:1241-1242`). Sửa **chỉ comment**, không đổi một dòng hành vi. Cùng lúc sửa **hai chỗ khác** cùng lớp lỗi: `aiGgufEngine.embedCtx.test.ts:19-20` và `aiGgufEngine.ts:263` đều viết *"throw bị `kbVectorStore.ts` (ingestKbChunks) nuốt thành `skipped++`"* — **Task 4 chứng minh SAI**: `catch` đó **đã** log `docId` + `err.message` từ commit `e4e24aa6` (2026-06-24).
- ~~**Còn giành lại được bao nhiêu từ context thường của model nhúng?**~~ ✅ **Đợt 2 ĐÃ ĐO VÀ ĐÃ LẤY**: bỏ context thường cho model chỉ-nhúng + khoá in-flight ⇒ **4.322 → 2.232 MiB (−2.090, −48,4%)**; 4 lượt nhúng đồng thời **2.430 → 652 MiB (−1.778)**. ⚠ Còn dư địa nhỏ hơn ở phần trọng số/CUDA context — **chưa đo**.

---

## 8. Ngoài phạm vi (YAGNI có chủ ý)

- **Không** khuyến nghị model cụ thể ngoài kho 9 model hiện có.
- **Không** thiết kế cơ chế hồ sơ khách hàng ở tài liệu này — nó là spec riêng, sau bước D.
- **Không** vá bốn bug Đợt 0 tìm ra — chúng đã ghi sổ, mỗi cái là một đợt riêng.
