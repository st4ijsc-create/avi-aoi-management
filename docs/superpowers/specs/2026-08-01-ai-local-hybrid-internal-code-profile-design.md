# Hồ sơ Hybrid — bắt đầu bằng hồ sơ NỘI BỘ thiên hướng code

**Ngày:** 2026-08-01 · **Nhánh:** `feat/hmi-dep` · **Loại:** đào sâu, tiếp nối spec chiến lược

**Tài liệu mẹ:** `docs/superpowers/specs/2026-08-01-ai-local-model-strategy-design.md` — đọc §2 (số đo nền) và §4 (kiến trúc) trước.
**Nguồn số liệu:** Đợt 0, `docs/superpowers/reports/2026-08-01-do0-roster-survey.md`.

---

## 1. Vì sao NỘI BỘ trước — lý do mạnh hơn "ít rủi ro"

Lý do hiển nhiên là an toàn: hỏng thì hỏng với đội mình, không hỏng với khách. Nhưng có một lý do **mạnh hơn nhiều**, và nó đến từ số đo:

> **Tier code/fim hiện VÔ HÌNH với đo lường.** `aiProgrammingCopilot.ts` gọi thẳng `aiGgufEngine` (6 điểm gọi), **không qua `aiGateway`** ⇒ **0 dòng** trong `ai_gateway_metrics`; `ai_model_metrics` cũng **0 dòng** — không có nguồn thay thế.

⇒ Ưu tiên "nghiêng về model chuyên code" của chủ dự án **hiện không có dữ liệu nào chứng minh hay bác bỏ**. Không phải vì tier đó ít dùng — mà vì **không ai đo được nó**.

⇒ **Chạy nội bộ trước là cách DUY NHẤT lấy được dữ liệu đó**, vì đội phát triển chính là người dùng tier code nhiều nhất. Sau vài tuần, con số sẽ nói: ưu tiên code là đúng, hay chỉ là cảm giác.

**Đây không phải giai đoạn thử nghiệm — đây là giai đoạn ĐO thứ chưa đo được.**

---

## 2. Hồ sơ `internal-code` — cấu hình cụ thể

### 2.1 Ngân sách

**Bảng Đợt 0 (giữ lại để đối chiếu — ⚠ CÁC SỐ NÀY SAI, xem bảng Đợt 1 ngay dưới):**

| Thành phần | VRAM (MiB) | Ghi chú |
|---|---|---|
| Nền hệ điều hành | 1.200 | |
| Qwen3-Coder-30B-A3B (deep **=** code **=** fim) | **17.698** | một file, ba vai |
| Qwen3-Embedding-0.6B | 5.664 | ⚠ 4,5 GB là buffer — xem §5 |
| **Lúc nghỉ** | **24.562** | **75,3%** |
| + vision sidecar khi thức | 7.821 | tự tắt sau 10 phút idle |
| **Đỉnh khi có ảnh** | **32.383** | **99,3%** — sát trần |

### ⚠ Bảng cập nhật sau Đợt 1 (2026-08-01) — số PHẢI DÙNG

Nguồn: `docs/superpowers/reports/2026-08-01-dot1-vram-reclaim.md` §2, §3, §4. Trần thiết bị **32.607 MiB**.

| Thành phần | Đợt 0 công bố | **TRƯỚC Đợt 1** (thật) | **SAU Đợt 1** |
|---|---|---|---|
| Nền hệ điều hành | 1.200 | ~1.200 | ~1.200 |
| Qwen3-Coder-30B-A3B (deep = code = fim) | 17.698 | **19.077** | **19.077** |
| Qwen3-Embedding-0.6B | 5.664 ❌ **sai** | **7.694** | **4.321** |
| **Lúc nghỉ** | 24.562 (75,3%) | **27.971 (85,8%)** | **24.598 (75,4%)** |
| + vision sidecar khi thức | 7.821 | 7.827 (**Đợt 1 không giảm được**) | 7.821-7.830 |
| **Đỉnh khi có ảnh** | 32.383 (99,3%) | **35.792 (109,8% ❌ ĐÃ VƯỢT TRẦN)** | **32.419 (99,4%)** |
| **Đỉnh khi có ảnh + đang sinh** | *(không tính)* | vượt xa | **33.476 (102,7%) ❌ VẪN VƯỢT TRẦN** |

**Vì sao bảng Đợt 0 sai:** cả hai con số đều đo bằng `scripts/ai-bench/bench.mjs`, công cụ **không import mã sản xuất**. Nó hụt **2.030 MiB** ở model nhúng (không gọi `model.createContext()`, và hard-code `contextSize:"auto"`) và hụt **1.379 MiB** ở Coder-30B (tạo context với **1** sequence thay vì `4096 × 4` như đường sản xuất). Chi tiết: spec chiến lược §2.

**Đọc bảng này thế nào:**
- ✅ **Đợt 1 giành lại thật 3.373 MiB** — toàn bộ từ model nhúng (`contextSize:"auto"` → `EMBED_CTX=2048`).
- ⚠ **Nhưng "75,3% → 75,4%" KHÔNG phải là không đổi gì.** Điểm xuất phát thật là **85,8%**, không phải 75,3%. Hồ sơ này trước Đợt 1 **tốn hơn tài liệu công bố 3.409 MiB**.
- ❌ **Đỉnh khi có ảnh vẫn KHÔNG dùng được dưới tải**: 102,7%. Trước Đợt 1 nó thậm chí vượt trần **ngay cả lúc nghỉ** (109,8%) — nghĩa là kịch bản "có ảnh" của hồ sơ này **chưa bao giờ thật sự vừa**.
- ⚠ **Còn dư địa chưa khai thác**: số 4.321 MiB **đã bao gồm** context thường (4096 × 4 sequences) mà `loadGgufModel()` vẫn tạo cho model nhúng dù nó không bao giờ sinh chữ. Đây là **một nửa** khoản "trả tiền hai lần" chưa được xử lý.

**Vì sao hồ sơ này hợp với nội bộ:** đội phát triển viết PLC/robot, **hiếm khi xử lý ảnh AOI**. Nên đỉnh 99,4% là **sự kiện hiếm** ở đúng hồ sơ mà nó nguy hiểm nhất. Ở khách hàng nặng AOI thì ngược lại — đó là lý do hồ sơ này **không** dùng cho họ.

### 2.2 Ba dòng `.env`

```bash
GGUF_DEFAULT_MODEL=Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf   # đổi từ Qwen3-30B-A3B-Instruct
GGUF_CODE_MODEL=Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf      # giữ nguyên
GGUF_FIM_MODEL=Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf       # đổi từ Qwen2.5-Coder-1.5B
```

**Quay lui:** khôi phục ba dòng + restart. ⚠ `.env` **không git-track** ⇒ `git checkout -- .env` **vô tác dụng**. Phải `cp .env .env.backup` **trước khi sửa**.

### 2.3 Vì sao gộp FIM vào Coder-30B

| | Qwen2.5-Coder-1.5B (hiện tại) | Qwen3-Coder-30B |
|---|---|---|
| TTFT, ngữ cảnh 153 token | **13,2 ms** | 39,5 ms |
| TTFT, ngữ cảnh 533 token | 26,8 ms | **76,6 ms** |
| Tổng tới gợi ý 32 token | 84-89 ms | 149-188 ms |
| VRAM thêm | +1.774 MiB | **0** (dùng lại model đã nạp) |

Đối chiếu chuẩn có nguồn (Miller 1968 / Nielsen: **0,1 s = tức thì**): trường hợp xấu nhất **76,6 ms = 77% ngân sách 0,1 s** ⇒ **không có lý do bằng số để từ chối**.

⚠ **Nhưng đây là MỘT đánh đổi có hai mặt, không phải hai lựa chọn.** Engine **cache theo tên file** (`aiGgufEngine.ts:593-599`) ⇒ trỏ FIM vào cùng file với code là **một hành động duy nhất** vừa cho lợi (0 ms nạp, tiết kiệm 1.774 MiB) vừa tạo rủi ro (**chia sẻ instance**). Ghost-text bắn liên tục khi gõ; sinh code là lượt dài hàng chục giây.

**Vì sao chấp nhận được ở nội bộ:** semaphore FIFO toàn cục cho **4 lượt đồng thời** (`GGUF_MAX_CONCURRENCY=4`) và mỗi context có 4 sequence. Với đội vài người, xếp hàng khó xảy ra. **Với khách hàng đông người dùng thì phải đo lại** — §6.

⚠ **Mức chậm thêm khi ghost-text và sinh code chạy đồng thời: CHƯA ĐO.** `bench.mjs` đo cô lập, không mô phỏng tải đồng thời.

---

## 3. Điều kiện BẮT BUỘC trước khi bật hồ sơ này

| # | Điều kiện | Vì sao |
|---|---|---|
| 1 | **Vá race double-warm** | Chưa vá thì app **không nạp nổi 30B** — 45/45 lượt lỗi, tái hiện 100% mọi lần boot. Bật hồ sơ mà chưa vá là đo lỗi hạ tầng, không đo hồ sơ |
| 2 | **Nối `aiProgrammingCopilot` qua `aiGateway`** | Không nối thì **mục đích chính của giai đoạn nội bộ — lấy dữ liệu tier code — không đạt được** |
| 3 | **Canh 4 dòng cảnh báo trong log** | Xem §4 |
| 4 | **Chấm 3 cặp A/B tiếng Việt** | Nếu Coder-30B viết tiếng Việt quá tệ thì hồ sơ này **sai từ gốc** — phải chuyển sang `balanced` |

Điều kiện 1 và 2 **cần sửa mã** — không thuộc phạm vi tài liệu này, mỗi cái một đợt riêng.

> **⚠ Trạng thái sau Đợt 1 — ĐIỀU KIỆN 1 VẪN CHƯA ĐẠT. CHƯA ĐƯỢC BẬT HỒ SƠ NÀY.**
>
> | # | Điều kiện | Trạng thái |
> |---|---|---|
> | 1 | Vá race double-warm | ⚠ **Race ĐÃ VÁ** (Đợt 1 Task 1 — khoá in-flight; nghiệm thu trên app thật: chỉ còn **1** lượt nạp thay vì 2). **NHƯNG app VẪN không nạp được 30B** — `cudaMalloc failed` ở cả **3/3** lượt boot, vì một nguyên nhân **THỨ BA** |
> | 2 | Nối `aiProgrammingCopilot` qua `aiGateway` | ❌ chưa làm |
> | 3 | Canh 4 dòng cảnh báo | ✅ đã canh — xem §4 |
> | 4 | Chấm 3 cặp A/B tiếng Việt | ❌ chưa chấm |
>
> **Về nguyên nhân thứ ba** — Đợt 1 đã loại trừ được ba khả năng bằng phép đo:
> - **Không phải mã nạp sản xuất**: gọi thẳng `warmModel()` của `aiGgufEngine.ts` trong một tiến trình gọn ⇒ **nạp được**, 18,1 s, delta 19.094 MiB.
> - **Không phải tranh chấp lúc boot**: hoãn warm tới 120 giây (`GGUF_WARM_DELAY_MS=120000`) ⇒ **vẫn lỗi y hệt**.
> - **Không phải hết VRAM thiết bị**: lúc lỗi, app chỉ giữ 5.496 MiB, còn **~27 GB trống**, mà một lệnh `cudaMalloc` 16.698 MiB vẫn bị từ chối.
>
> ⇒ Giới hạn nằm ở **trạng thái của chính tiến trình app**. **Chưa truy được gốc rễ — cần một đợt riêng, và nó đang chặn hồ sơ này.**

---

## 4. Bốn dòng log phải canh

Hệ **không báo lỗi** khi thiếu VRAM — nó **suy giảm âm thầm**. Bốn dấu vết duy nhất:

| Dòng log | Nghĩa |
|---|---|
| `evicted LRU model "<id>" before loading` | Đã đuổi model — lần dùng sau tốn 8,8-41 giây nạp lại |
| `no idle model to evict — deferring/allowing load with OOM risk` | **Nguy nhất** — hết chỗ mà không đuổi được gì |
| `At capacity (4/4)` | Đã chạm trần `GGUF_MAX_LOADED_MODELS` |
| cảnh báo ở nhánh `catch` khi nạp lỗi | **Nguy hiểm nhất**: engine **lặng lẽ nạp lại với `gpuLayers:"auto"`** ⇒ tier tụt xuống tốc độ kiểu roster C (**2,9 tok/s — 500 token ≈ 172 giây**) mà **không báo lỗi gì** |

⚠ Dòng thứ tư là kiểu hỏng tệ nhất: người dùng thấy AI "chậm bất thường", không ai biết vì sao, và không có gì đỏ.

> **⚠ Đã canh thật ở Đợt 1 (3 lượt boot app, có OOM ở cả 3): KHÔNG dòng nào xuất hiện.**
>
> | Dòng log | Xuất hiện? |
> |---|---|
> | `evicted LRU model "<id>" before loading` | **không** |
> | `no idle model to evict — deferring/allowing load with OOM risk` | **không** |
> | `At capacity (4/4)` | **không** |
> | cảnh báo nhánh `catch` nạp lại `gpuLayers:"auto"` | **không** |
>
> **Dòng thứ tư vắng mặt là phát hiện quan trọng, và nó lật ngược cảnh báo ở trên.** Nhánh phục hồi có tồn tại trong mã (`aiGgufEngine.ts:648-681`) nhưng **không chạy lần nào** dù cả 3 lượt boot đều OOM thật. Lý do khả dĩ (đọc mã): `isOom` tìm chữ `"out of memory"`/`"cudamalloc"`/`"failed to allocate"`/`"unable to allocate"` trong `err.message` của JS, nhưng những chữ đó nằm ở **stderr của lớp C++ node-llama-cpp**, không nằm trong `err.message`. ⚠ **Đây là suy luận từ mã + sự vắng mặt của dòng log, CHƯA bắt được nguyên văn `err.message` để xác nhận.**
>
> **Hệ quả đã chắc:** app **không** tụt xuống tier 2,9 tok/s — nó **không có model sinh chữ sâu nào cả**, và báo `deep model warm FAILED`. Về vận hành đây **tệ hơn** kịch bản "âm thầm chậm" mà mục này lo; bù lại nó **hỏng ồn ào**, phát hiện được — nhưng chỉ khi có người đọc log.
>
> ⇒ **Nếu nhánh `catch` đúng là mã chết thì danh sách này chỉ còn BA dòng phải canh**, và mục "nguy hiểm nhất" phải viết lại. Cần một phép đo riêng để chốt.

---

## 5. Đo gì trong giai đoạn nội bộ

Đây là **mục đích thật** của giai đoạn này. Bốn thứ, mỗi thứ trả lời một câu hỏi chưa có đáp án:

| Đo | Trả lời câu hỏi | Cách |
|---|---|---|
| **Lưu lượng tier code/fim thật** | Ưu tiên "nghiêng code" **đúng hay chỉ là cảm giác**? | `ai_gateway_metrics` sau khi nối điều kiện 2 |
| **Số lần vision thức / ngày** | Đỉnh 99,3% là hiếm hay thường? | đếm lượt khởi sidecar trong log |
| **Bốn dòng cảnh báo §4 có xuất hiện không** | Hồ sơ có thật sự vừa không, hay chỉ vừa trên giấy | grep log |
| **Ghost-text có bị xếp hàng sau sinh code không** | Đánh đổi §2.3 có chấp nhận được không | đo TTFT thật lúc có người đang sinh code |

**Và một điều tra riêng, giá trị cao nhất:** **4,5 GB buffer của embedding**. Model 0.6B (file 1,2 GB) mà chiếm 5.664 MiB — biết có, **chưa truy nguyên nhân**. Nếu chỉnh được như sidecar `-np 1`, hồ sơ này từ 75,3% xuống ~61%, và **đỉnh khi vision thức từ 99,3% xuống ~85%** — đổi hẳn bảng đánh đổi của cả ba hồ sơ.

> **✅ Đợt 1 ĐÃ LÀM điều tra này. Nguyên nhân truy được — nhưng dự đoán trên SAI.**
>
> **Nguyên nhân**: `getEmbeddingContext()` gọi `createEmbeddingContext({contextSize:"auto"})` — cấp **toàn bộ** cửa sổ ngữ cảnh mà model nhúng hỗ trợ, bất kể chunk RAG thực tế dài bao nhiêu. Đổi sang `EMBED_CTX` (mặc định **2048**, đủ chứa chunk thật dài nhất **1.879 token**).
>
> **Kết quả**: **7.694 → 4.321 MiB, giành lại 3.373 MiB (~43,8%)**.
>
> | | Dự đoán ở trên | Thực tế |
> |---|---|---|
> | Hồ sơ `internal-code` lúc nghỉ | 75,3% → **~61%** | 85,8% → **75,4%** |
> | Đỉnh khi vision thức | 99,3% → **~85%** | 109,8% → **99,4%** |
>
> **Vì sao lệch:** dự đoán dựa trên con số 5.664 MiB của Đợt 0 — con số đó **sai** (đo bằng `bench.mjs`, không qua mã sản xuất; số thật là 7.694). Điểm xuất phát tệ hơn tưởng, nên điểm đến cũng cao hơn tưởng. Khoản giành lại (3.373 MiB) thì **thật và đo được**.
>
> ⚠ **`-np 1` cho sidecar: giành lại ~0 MiB** — tiền đề "n_parallel=4 nhân bốn KV-cache" bị đo thật phủ định (`kv_unified=true`). Đừng trông vào khoản này.
> ⚠ **Còn dư địa**: 4.321 MiB **vẫn bao gồm** context thường 4096 × 4 sequences mà `loadGgufModel()` tạo cho model nhúng dù nó không bao giờ sinh chữ — **một nửa khoản "trả tiền hai lần" chưa xử lý**.

---

## 6. Tiêu chí tốt nghiệp — khi nào đem ra khách hàng

Không đem ra khách khi chưa có đủ bốn thứ:

1. **Bốn dòng cảnh báo §4 không xuất hiện** trong một chu kỳ vận hành đại diện.
2. **Chất lượng tiếng Việt được chấp nhận** — chủ dự án đã chấm, không phải agent tự đánh giá.
3. **Ghost-text không bị xếp hàng** ở tải nội bộ — và **đo lại ở tải khách hàng** vì đội vài người ≠ nhà máy nhiều ca.
4. **Lưu lượng tier code thật** xác nhận (hoặc bác bỏ) ưu tiên nghiêng code. **Nếu bác bỏ — đổi hồ sơ, đừng giữ vì đã lỡ chọn.**

## 7. Ba hồ sơ khách hàng — phác thảo, chưa thiết kế

Tài liệu này **chỉ đào sâu hồ sơ nội bộ**. Ba hồ sơ khách hàng ghi ở đây để thấy hướng, **chưa phải thiết kế**:

| Hồ sơ | Cấu hình | Lúc nghỉ — Đợt 0 | **Lúc nghỉ — SAU Đợt 1** | Hợp với |
|---|---|---|---|---|
| `code-heavy` | = `internal-code` | 24.562 (75,3%) | **24.598 (75,4%)** | nhà máy nặng tự động hoá, ít ảnh |
| `vision-heavy` | vision thường trú + Coder-30B + embedding | 32.383 (99,3%) | **32.419 (99,4%)** | nhà máy nặng AOI ⚠ **dưới tải 102,7% — VẪN VƯỢT TRẦN** |
| `balanced` | Coder-30B + Qwen3-4B general + embedding, vision theo yêu cầu | 28.026 (86%) | **28.062 (86,1%)** ⚠ số SÀN | nhà máy nặng báo cáo/vận hành ⚠ **vẫn chưa đo model 4B bằng đường sản xuất** |

⚠ Cả `vision-heavy` lẫn `balanced` đều có lỗ hổng bằng chứng. **Đừng chốt chúng dựa trên bảng này** — chúng cần spec riêng sau khi giai đoạn nội bộ xong.

> **⚠ Đợt 1 — ba đính chính cho bảng này:**
> 1. **Cột "Đợt 0" đánh giá thấp cả ba hồ sơ ~3.400 MiB** (`bench.mjs` không qua mã sản xuất). Trước Đợt 1, số thật là: `code-heavy` **27.971 (85,8%)** · `vision-heavy` **35.792 (109,8% ❌ đã vượt trần)** · `balanced` **31.435 (96,4%)**.
> 2. **`vision-heavy` chưa bao giờ thật sự vừa.** Đợt 0 công bố 99,3%; số thật lúc đó là **109,8%**. Sau Đợt 1 nó về 99,4% **lúc nghỉ**, nhưng **dưới tải là 102,7% — vẫn vượt trần**. Đây là hồ sơ được lợi nhiều nhất từ Đợt 1 mà **vẫn chưa dùng được**.
> 3. **`balanced` là hồ sơ được lợi thật sự**: từ 96,4% (không còn chỗ cho buffer sinh) xuống **86,1%** — chịu được hai model cùng sinh (**91,8%**). ⚠ Nhưng số 4B vẫn là số `bench.mjs`; nếu 4B cũng đắt thêm ~1.350 MiB thì `balanced` ≈ **90,2%** (ước lượng, **chưa đo**). Và **`balanced` KHÔNG được để vision thức**: 35.883 = **110,0% ❌**.

---

## 8. Điều tài liệu này KHÔNG trả lời

- **Chất lượng tiếng Việt của Coder-30B** — chờ chấm; là biến quyết định hồ sơ này đúng hay sai từ gốc.
- **Mức chậm khi ghost-text + sinh code đồng thời** — chưa đo.
- ~~**Nguyên nhân 4,5 GB buffer embedding** — chưa truy.~~ ✅ **Đợt 1 đã truy**: `contextSize:"auto"` trong `getEmbeddingContext()`; đã sửa, giành lại **3.373 MiB**. Xem §5.
- ~~**Hiệu quả `-np 1` cho sidecar** — chưa đo, cần sửa mã.~~ ✅ **Đợt 1 đã đo**: **~0 MiB**, tiền đề sai (`kv_unified=true`). Xem §5.
- **Cơ chế hồ sơ** (chọn/chuyển/kiểm tra hồ sơ lúc triển khai) — chưa thiết kế, là spec riêng.

**Đợt 1 để lại những câu hỏi MỚI — và một trong số đó đang CHẶN hồ sơ này:**

- 🚧 **Vì sao app không nạp được model 30B** trong khi tiến trình gọn chạy đúng mã đó lại nạp được? Chưa truy được. **Đây là thứ chặn điều kiện 1 của §3.**
- **Model 4B chưa đo bằng đường sản xuất** — hồ sơ `balanced` (phương án dự phòng nếu Coder-30B viết tiếng Việt kém) đang đứng trên một con số **sàn**.
- **Nhánh `catch` `gpuLayers:"auto"` có phải mã chết không** — nếu đúng, §4 phải viết lại. Xem §4.
- **Còn giành lại được bao nhiêu từ context thường của model nhúng** — biết là còn, chưa đo.
