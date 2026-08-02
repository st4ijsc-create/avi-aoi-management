# Hồ sơ Hybrid — bắt đầu bằng hồ sơ NỘI BỘ thiên hướng code

**Ngày:** 2026-08-01 · **Nhánh:** `feat/hmi-dep` · **Loại:** đào sâu, tiếp nối spec chiến lược

**Tài liệu mẹ:** `docs/superpowers/specs/2026-08-01-ai-local-model-strategy-design.md` — đọc §2 (số đo nền) và §4 (kiến trúc) trước.
**Nguồn số liệu:** Đợt 0, `docs/superpowers/reports/2026-08-01-do0-roster-survey.md`.


> ## ✅ CẬP NHẬT 2026-08-02 — CHỦ DỰ ÁN ĐÃ CHẤM A/B TIẾNG VIỆT
>
> **Kết quả: model CHUYÊN CODE viết tiếng Việt NHỈNH HƠN model general** (mức độ **nhẹ**; chủ dự án nói *"cả hai đều trả lời tiếng Việt ổn, chỉ là văn phong của Model 2 dễ hơn với dẫn kỹ thuật và người mới"*). Ánh xạ: Model 1 = General, Model 2 = Coder. Chi tiết + cách khôi phục ánh xạ: `docs/superpowers/reports/2026-08-01-do0-vi-ab.md`.
>
> ⚠ **Lo ngại nêu trong tài liệu này — "model chuyên code viết văn xuôi tiếng Việt thường khô và hay lẫn thuật ngữ Anh" — ĐÃ BỊ ĐO THẬT BÁC BỎ.**
>
> **Ba hệ quả:**
> 1. Điều kiện *"nếu tiếng Việt của Coder-30B chấp nhận được → roster A"* ⇒ **ĐẠT**. Không còn biến chờ chấm.
> 2. Hồ sơ `balanced` **mất lý do tồn tại chính** — nó là phương án dự phòng phòng khi Coder viết tệ; rủi ro đó không xảy ra.
> 3. **Nút thắt còn lại KHÔNG phải chọn model** mà là **ngân sách thị giác** + **bí ẩn CUDA context** (§5 bước A/B/C).

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

| Thành phần | Đợt 0 công bố | **TRƯỚC Đợt 1** (thật) | **SAU Đợt 1** | **SAU ĐỢT 2 — số PHẢI DÙNG** |
|---|---|---|---|---|
| Nền hệ điều hành | 1.200 | ~1.200 | ~1.200 | ~1.200 *(Đợt 2 đo 1.248-1.257)* |
| Qwen3-Coder-30B-A3B (deep = code = fim) | 17.698 | **19.077** | **19.077** | **19.077** (Đợt 2 không đụng) |
| Qwen3-Embedding-0.6B | 5.664 ❌ **sai** | **7.694** | **4.321** | **2.232** (−2.089) |
| **Lúc nghỉ** | 24.562 (75,3%) | **27.971 (85,8%)** | 24.598 (75,4%) | **22.509 (69,0%)** |
| + vision sidecar khi thức | 7.821 | **7.821** | **7.821 — Đợt 1 KHÔNG giảm được** | **7.821 — Đợt 2 cũng KHÔNG giảm được** |
| **Đỉnh khi có ảnh** | 32.383 (99,3%) | **35.792 (109,8% ❌ ĐÃ VƯỢT TRẦN)** | 32.419 (99,4%) | **30.330 (93,0%)** |
| **Đỉnh khi có ảnh + đang sinh** | *(không tính)* | vượt xa | 33.476 (102,7%) ❌ · cộng đỉnh nhúng đồng thời ~34.195 (~104,9%) ❌ | **31.387 (96,3%) — ★★ VỪA TRẦN, lần đầu tiên** (biên 1.220 MiB) |

> **★★ Ô cuối cùng là thứ Đợt 2 đổi được, và nó đổi kết luận của cả hồ sơ này.** Hai nguồn:
> 1. **−2.089 MiB** từ model nhúng (bỏ context thường mà model chỉ-nhúng không bao giờ dùng — chính là khoản "còn dư địa" ghi ở bản Đợt 1 dưới đây).
> 2. **Số hạng "+1.776 MiB đỉnh nhất thời khi nhúng đồng thời" BIẾN MẤT** — Đợt 2 Task 3 đã vá race `getEmbeddingContext()` bằng khoá in-flight, **đo được**: 4 lượt nhúng đồng thời **2.430 → 652 MiB**.
>
> ⚠ **Nhưng ô đó là PHÉP CỘNG, không phải phép đo.** Chưa từng có lượt đo nào có Coder-30B + sidecar thị giác **cùng thức** trên một máy — ở cả ba đợt. Nếu chỉ được chạy một phép đo tiếp theo, **chạy phép này**.

**Vì sao bảng Đợt 0 sai:** cả hai con số đều đo bằng `scripts/ai-bench/bench.mjs`, công cụ **không import mã sản xuất**. Nó hụt **2.030 MiB** ở model nhúng (không gọi `model.createContext()`, và hard-code `contextSize:"auto"`) và hụt **1.379 MiB** ở Coder-30B (tạo context với **1** sequence thay vì `4096 × 4` như đường sản xuất). Chi tiết: spec chiến lược §2.

⚠ **Về con số vision**: Task 3 đo lại được 7.826-7.830 MiB — chênh mốc Đợt 0 (7.821) ~0,1%, **trong nhiễu đo**. Bảng này dùng **7.821** cho mọi phép cộng để nhất quán và so sánh được với Đợt 0; chọn số nào cũng không đổi kết luận.

⚠ **Mỗi số model đã gồm ~430 MiB CUDA context dùng chung** ⇒ cộng ba dòng là **đếm lặp** khối đó (~860 MiB thừa với 3 model GGUF; đo được 384 MiB thừa với 2 model). ⇒ **Các tổng dưới đây lệch về phía THẬN TRỌNG** — không đổi kết luận, nhưng đáng biết ở các ô sát trần.

**Đọc bảng này thế nào:**
- ✅ **Đợt 1 giành lại thật 3.373 MiB** — toàn bộ từ model nhúng (`contextSize:"auto"` → `EMBED_CTX=2048`). ✅ **Đợt 2 giành thêm 2.089 MiB** — cộng hai đợt **5.462 MiB**.
- ⚠ **Nhưng "75,3% → 75,4%" KHÔNG phải là không đổi gì.** Điểm xuất phát thật là **85,8%**, không phải 75,3%. Hồ sơ này trước Đợt 1 **tốn hơn tài liệu công bố 3.409 MiB**.
- ~~❌ **Đỉnh khi có ảnh vẫn KHÔNG dùng được dưới tải**: 102,7% (~104,9%)~~ → ✅ **ĐỢT 2 ĐỔI KẾT LUẬN Ô NÀY: 96,3% — vừa trần, lần đầu tiên.** Trước Đợt 1 nó thậm chí vượt trần **ngay cả lúc nghỉ** (109,8%) — nghĩa là kịch bản "có ảnh" của hồ sơ này **chưa bao giờ thật sự vừa cho tới Đợt 2**.
- ~~⚠ **Còn dư địa chưa khai thác**: số 4.321 MiB đã bao gồm context thường…~~ ✅ **ĐỢT 2 ĐÃ LẤY**: bỏ context thường cho model chỉ-nhúng (cờ `embeddingOnly`) ⇒ **4.322 → 2.232 MiB (−48,4%)**. Còn dư địa nhỏ hơn ở phần trọng số/CUDA context — **chưa đo**.

**Vì sao hồ sơ này hợp với nội bộ:** đội phát triển viết PLC/robot, **hiếm khi xử lý ảnh AOI**. Nên đỉnh (nay **93,0%** lúc nghỉ / **96,3%** dưới tải) là **sự kiện hiếm** ở đúng hồ sơ mà nó nguy hiểm nhất. Ở khách hàng nặng AOI thì ngược lại — đó là lý do hồ sơ này **không** dùng cho họ.

> **⚠ ĐỢT 2 — MỘT ĐIỀU KIỆN MỚI, BẮT BUỘC, mà bản Đợt 1 không có:** bảng trên **chỉ đúng khi FIM được gộp vào Coder-30B** (§2.2/§2.3). Đợt 2 đo lại FIM bằng đường khớp sản xuất: **1.774 → 2.188 MiB**. Nếu **giữ FIM 1,5B riêng**: lúc nghỉ **24.697 (75,7%)** · đỉnh khi có ảnh **32.518 (99,7%)** · **đỉnh khi có ảnh + đang sinh 33.575 (103,0% ❌ VƯỢT TRẦN)** · ghost-text và sinh code **đồng thời** **34.045-34.515 (104,4-105,9% ❌)**.
>
> ⇒ **Khoản 2.188 MiB của FIM riêng chính là thứ đẩy hồ sơ này từ "vừa" sang "vượt trần".** Ba dòng `.env` ở §2.2 không còn là tối ưu nhỏ — **dòng `GGUF_FIM_MODEL` là điều kiện để hồ sơ vừa trần**. Với số FIM mới, lập luận §2.3 **mạnh hơn trước**, không yếu đi.

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
| VRAM thêm | ~~+1.774 MiB~~ *(Đợt 0, SÀN)* → **Đợt 2: +2.188 MiB** (đo bằng đường khớp sản xuất) | **0** (dùng lại model đã nạp) |

⚠ **Đợt 2 làm lập luận này MẠNH HƠN, không yếu đi.** Khoản VRAM tiết kiệm được khi gộp là **2.188 MiB** (không phải 1.774) — và như §2.1 chỉ ra, đúng khoản đó là thứ đẩy hồ sơ từ **96,3% (vừa)** sang **103,0% (vượt trần)** khi có ảnh + đang sinh. ⇒ Gộp FIM **không còn là lựa chọn tối ưu, nó là điều kiện**.

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

> **⚠ Trạng thái sau Đợt 1 — ĐIỀU KIỆN 1 CHƯA ĐẠT, nhưng KHÔNG còn bị chặn cứng. VẪN CHƯA ĐƯỢC BẬT HỒ SƠ NÀY.**
>
> | # | Điều kiện | Trạng thái |
> |---|---|---|
> | 1 | Vá race double-warm | ⚠ **Race ĐÃ VÁ** (Đợt 1 Task 1 — khoá in-flight; nghiệm thu app thật: chỉ còn **1** lượt nạp thay vì 2). App ở **đường boot mặc định** vẫn không nạp được 30B (`cudaMalloc failed` 3/3 lượt) vì nguyên nhân **THỨ BA** — **nhưng đã có ĐƯỜNG VÒNG đo được** |
> | 2 | Nối `aiProgrammingCopilot` qua `aiGateway` | ❌ chưa làm |
> | 3 | Canh 4 dòng cảnh báo | ✅ đã canh — xem §4 (và một trong bốn dòng là **mã chết**) |
> | 4 | Chấm 3 cặp A/B tiếng Việt | ❌ chưa chấm |
>
> **Phát biểu đúng phạm vi về nguyên nhân thứ ba:**
>
> > **Không cấp phát nổi khối 16,7 GB nếu CUDA context được tạo SAU khi app boot xong.**
> > Nếu CUDA context đã tồn tại **TRƯỚC** khi app boot, chính đường warm của app nạp 30B **thành công**.
>
> Sáu phép thử phân biệt:
>
> | # | Phép thử | Thứ tự CUDA context | Kết quả |
> |---|---|---|---|
> | 1 | `bench.mjs --models deep`, tiến trình gọn | trước (không có app) | **nạp được** 19,3 s |
> | 2 | Gọi thẳng `warmModel()` sản xuất, tiến trình gọn | trước (không có app) | **nạp được** 18,1 s · 19.094 MiB |
> | 3 | App thật, hoãn warm 120 s (`GGUF_WARM_DELAY_MS`) | **sau** boot | **lỗi** |
> | 4 | Nạp 30B **trước** `import(server/_core/index.ts)`, boot app lên trên | **trước** boot | **nạp được** 11 s · `generateText` trả "Hello" · 23.994 MiB |
> | 5 | Nạp model nhúng 0,6B trước (tạo CUDA context sớm), boot app, **để chính warm của app nạp 30B** | **trước** boot | **nạp được** — `Model loaded in 16291ms` + `deep model warm OK` · **0 `cudaMalloc failed`** · 24.094 MiB |
> | 6 | **Chứng ngược**: app boot trước, gọi tay ở T+30 s lúc model nhúng **đã** thường trú | **sau** boot | **lỗi** ⇒ loại trừ "cứ có embed trước là xong" |
>
> Đã loại trừ thêm: **dung lượng VRAM thiết bị** (lúc lỗi thiết bị mới dùng ~1,6 GB / 32,6 GB — con số 5.496 MiB nêu ở nơi khác là **tổng thiết bị**, không phải phần app giữ) và **trần commit của Windows** (+19,2 GB trên 88,78 GB, còn dư > 27 GB).
>
> ⚠ **CƠ CHẾ VẪN CHƯA BIẾT.** Biết **điều kiện**, không biết **vì sao**. Không đoán cơ chế — đó đúng là cái bẫy đã làm hỏng tiền đề Task 3 của Đợt 1.
>
> ⇒ **Có đường vòng (tạo CUDA context sớm), nhưng đó CHƯA phải bản sửa** — chưa có mã, chưa hiểu cơ chế, chưa nghiệm thu qua nhiều lượt boot. **Điều kiện 1 vì thế vẫn CHƯA ĐẠT**, nhưng lý do nay là *"chưa làm cho tin cậy"*, **không phải** *"không có cách"*. Cần một đợt riêng.
>
> ⚠ Liên quan: comment `aiGgufEngine.ts:1108-1109` nói hoãn warm để *"the warm never competes with the rest of boot"* — **mô tả ngược với thực tế đo được**. Chưa sửa (ngoài phạm vi Đợt 1) ⇒ nợ. ✅ **Đợt 2 Task 6 ĐÃ SỬA** (dòng thật: `aiGgufEngine.ts:1241-1242`) — **chỉ comment, không đổi hành vi**.

> ## ⚠⚠ TRẠNG THÁI SAU ĐỢT 2 (2026-08-02) — HAI ĐIỀU KIỆN ĐÃ ĐẠT, ĐIỀU KIỆN 1 VẪN CHƯA. VẪN CHƯA ĐƯỢC BẬT HỒ SƠ NÀY.
>
> | # | Điều kiện | Trạng thái sau Đợt 2 |
> |---|---|---|
> | 1 | Vá race double-warm | 🚧 **CHƯA ĐẠT — và Đợt 2 KHÔNG cải thiện.** Race đã vá (Đợt 1). **Nguyên nhân thứ ba VẪN TÁI HIỆN tại HEAD: 3/3 lượt** (reviewer tái hiện độc lập thêm 3 lượt), `cudaMalloc failed` cho khối **16.698,37 MiB**, hỏng **cả** `npm run dev` **lẫn** `npm run dev:worker`. Đợt 2 hạ dấu chân boot xuống **3,27 GB** mà lỗi **y hệt** ⇒ **không phải bài toán chật chỗ**. Đợt 2 Task 5 **chỉ điều tra, cấm vá** |
> | 2 | Nối `aiProgrammingCopilot` qua `aiGateway` | ✅ **ĐÃ LÀM** (Đợt 2 Task 2). `ai_gateway_metrics` **0 → 4 dòng**, tên GGUF thật cho cả `code` và `fim`, `tier` đúng. ⚠ **Nhưng 4 dòng đó là lưu lượng DỰNG** — mục đích thật (lấy dữ liệu tier code) **chưa đạt**, chỉ mới thông đường ống |
> | 3 | Canh 4 dòng cảnh báo | ✅ đã canh — §4 (một trong bốn là **mã chết**, nay biết có **HAI lớp** im lặng: `isOom` không khớp **và** `warmModel()` có `catch {}` trống) |
> | 4 | Chấm 3 cặp A/B tiếng Việt | ✅ **ĐÃ CHẤM 2026-08-02** — Coder viết tiếng Việt **nhỉnh hơn** general (mức nhẹ). ⇒ **Hồ sơ này ĐÚNG từ gốc**; không phải chuyển sang `balanced` |
>
> **Đợt 2 thu hẹp bí ẩn CUDA nhưng KHÔNG giải được.** Loại thêm được, mỗi mục kèm phép thử đã chạy: nửa HTTP/Vite (`dev:worker` hỏng y hệt) · *"cần một model thường trú"* (chỉ **chạm** `getLlama()` là đủ — giá **~420-430 MiB / ~1,2-2,3 s** — 3/3 nhánh nạp được 30B) · *"CUDA khởi tạo muộn một mình"* (tiến trình trống + chờ 35 s **vẫn nạp được** 16,7 GB) · hai backend · hết VRAM thiết bị · `tsx watch` · không gian địa chỉ ảo · commit host · module native.
>
> ⚠⚠ **Ratchet ("cấp phát nhỏ đi trước mới mở được cấp phát lớn") CHƯA bị bác bỏ** — vẫn là ứng viên hạng nhất. Và **mọi ngưỡng trung gian từng nêu đã bị RÚT** vì không tái hiện giữa hai phiên đo cùng ngày: **số duy nhất còn trích được là `16.698,37 MiB`**. ⇒ **Không viết một dòng mã vá nào** trước khi chạy phép thử "trần có tất định không" (lặp cùng một lượt thử 5 lần).

---

## 4. Bốn dòng log phải canh — ⚠ **Đợt 1: thực chất chỉ còn BA** (dòng thứ tư là mã chết)

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
> **Dòng thứ tư vắng mặt là phát hiện quan trọng, và nó lật ngược cảnh báo ở trên.** Nhánh phục hồi có tồn tại trong mã (`aiGgufEngine.ts:658-682`) nhưng **không chạy lần nào** dù cả 3 lượt boot đều OOM thật.
>
> ✅ **ĐÃ XÁC NHẬN BẰNG BẰNG CHỨNG — đây là MÃ CHẾT.** Chạy `loadGgufModel()` trong chính tiến trình app đang lỗi, bắt được nguyên văn:
>
> ```
> err.message = "Failed to load model"     ⇒  ISOOM_MATCH = false
> ```
>
> `isOom` tìm `"out of memory"`/`"cudamalloc"`/`"failed to allocate"`/`"unable to allocate"` trong `err.message`; thông điệp thật không chứa chuỗi nào trong số đó (những chữ OOM chỉ nằm ở **stderr của lớp C++ node-llama-cpp**). ⇒ `if (!isOom || ...) throw err` **luôn ném** ⇒ khối 672-682 (`console.warn` + `evictLRU()` + nạp lại `gpuLayers:"auto"`) **không bao giờ chạy**.
>
> ⇒ **Một trong bốn lưới an toàn của hệ KHÔNG TỒN TẠI** — nó chỉ tồn tại trên giấy và trong chính tài liệu này.
>
> **Hệ quả đã chắc:** app **không** tụt xuống tier 2,9 tok/s — nó **không có model sinh chữ sâu nào cả**, và báo `deep model warm FAILED`. Về vận hành đây **tệ hơn** kịch bản "âm thầm chậm" mà mục này lo; bù lại nó **hỏng ồn ào**, phát hiện được — nhưng chỉ khi có người đọc log.
>
> ⇒ **Nhánh `catch` ĐÃ được xác nhận là mã chết** (bằng chứng nguyên văn ở trên: `err.message = "Failed to load model"` ⇒ `ISOOM_MATCH = false`) ⇒ **danh sách này chỉ còn BA dòng phải canh**, và mục "nguy hiểm nhất" đã được viết lại ở trên — không còn câu hỏi mở về việc mã chết hay không.

---

## 5. Đo gì trong giai đoạn nội bộ

Đây là **mục đích thật** của giai đoạn này. Bốn thứ, mỗi thứ trả lời một câu hỏi chưa có đáp án:

| Đo | Trả lời câu hỏi | Cách |
|---|---|---|
| **Lưu lượng tier code/fim thật** | Ưu tiên "nghiêng code" **đúng hay chỉ là cảm giác**? | `ai_gateway_metrics` — ✅ điều kiện 2 **đã nối** (Đợt 2), ⚠ **đếm theo lượt NGƯỜI DÙNG, không theo `count(*)`** (1 `generateProgram` = 3 dòng metric) |
| **Số lần vision thức / ngày** | Đỉnh **93,0% lúc nghỉ / 96,3% dưới tải** (SAU Đợt 2; 99,4%/102,7-104,9% sau Đợt 1; **109,8%** trước Đợt 1) là hiếm hay thường? | đếm lượt khởi sidecar trong log |
| **Ba dòng cảnh báo còn sống của §4 có xuất hiện không** | Hồ sơ có thật sự vừa không, hay chỉ vừa trên giấy (dòng thứ tư là **mã chết** — không tính) | grep log |
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
>
> **⚠ CẬP NHẬT SAU REVIEW TOÀN NHÁNH — cổng cuối (2026-08-02), CHƯA VÁ (không do Đợt 1 gây ra):**
>
> - **"Còn dư địa" ở trên nay CÓ SỐ, và lớn hơn tưởng.** Đo được: model nhúng + context thường (4096×4) = **3.649 MiB**; embedding context riêng chỉ **654 MiB**. Dư địa ước **~2,0 GB** (trọng số f16 ~1,14 GiB + CUDA ctx ~430 MiB) — **lớn hơn cả nửa toàn bộ khoản Đợt 1 vừa giành**. Đây không còn là "minor" — đã nâng bậc trong sổ nợ (`.superpowers/sdd/2026-08-01-dot1-gianh-lai-vram/progress.md`, mục "NỢ SAU CỔNG CUỐI"). Cần một phép đo xác nhận (nạp mà bỏ `createContext()`), đợt sau.
> - **`getEmbeddingContext()` (dòng ngay sau đoạn code trích ở trên) còn nguyên MỘT race y hệt cái Task 1 vừa vá** — kiểm-rồi-mới-gán, có `await` ở giữa. N lượt nhúng đồng thời (`.env:125 GGUF_MAX_CONCURRENCY=4`, 6 nơi gọi HTTP) tạo N context, N−1 bản mồ côi. Đo được: tuần tự 4.303 MiB vs đồng thời 6.091 MiB ⇒ **+1.776 MiB đỉnh nhất thời** (vài giây, không phải rò vĩnh viễn — thu hồi ở T+8s). Đây chính là số đã cộng vào các ô "~104,9%" ở §7. Chi tiết đầy đủ: spec chiến lược, callout cuối §3.
> - **`getLlama()` khởi tạo HAI backend khi hai model KHÁC NHAU nạp đồng thời** (`INIT_COUNT=2` đo được) — khoá Task 1 (theo `modelId`) không phủ ca này. Đây là **ứng viên đầu tiên kiểm được** cho "nguyên nhân thứ ba" ở §3 — phép thử rẻ nhất: `grep -c "llama.cpp engine initialized" <log boot>` (2 dòng ⇒ sống, 1 ⇒ loại). Chi tiết: spec chiến lược, callout cuối §3.

---

## 6. Tiêu chí tốt nghiệp — khi nào đem ra khách hàng

Không đem ra khách khi chưa có đủ bốn thứ:

1. **Ba dòng cảnh báo còn sống của §4 không xuất hiện** trong một chu kỳ vận hành đại diện. ⚠ Dòng thứ tư là **mã chết** ⇒ **sự vắng mặt của nó KHÔNG chứng minh gì cả** — đừng tính nó vào tiêu chí.
2. ✅ **ĐẠT (2026-08-02): chất lượng tiếng Việt được chấp nhận** — chủ dự án đã chấm (không phải agent tự đánh giá): Coder-30B viết tiếng Việt **nhỉnh hơn** general, mức nhẹ; cả hai đều ổn.
3. **Ghost-text không bị xếp hàng** ở tải nội bộ — và **đo lại ở tải khách hàng** vì đội vài người ≠ nhà máy nhiều ca.
4. **Lưu lượng tier code thật** xác nhận (hoặc bác bỏ) ưu tiên nghiêng code. **Nếu bác bỏ — đổi hồ sơ, đừng giữ vì đã lỡ chọn.**

## 7. Ba hồ sơ khách hàng — phác thảo, chưa thiết kế

Tài liệu này **chỉ đào sâu hồ sơ nội bộ**. Ba hồ sơ khách hàng ghi ở đây để thấy hướng, **chưa phải thiết kế**:

| Hồ sơ | Cấu hình | Lúc nghỉ — Đợt 0 | Lúc nghỉ — SAU Đợt 1 | **SAU ĐỢT 2 — số PHẢI DÙNG** | Hợp với |
|---|---|---|---|---|---|
| `code-heavy` | = `internal-code` | 24.562 (75,3%) | 24.598 (75,4%) | **22.509 (69,0%)** · vision thức **93,0%** · **dưới tải 96,3% ✅** | nhà máy nặng tự động hoá, ít ảnh |
| `vision-heavy` | vision thường trú + Coder-30B + embedding | 32.383 (99,3%) | 32.419 (99,4%) ⚠ dưới tải 102,7-104,9% ❌ | **30.330 (93,0%)** · **dưới tải 31.387 (96,3%) ✅** | nhà máy nặng AOI — ★★ **Đợt 2 đổi kết luận: từ "vượt trần dưới tải" thành "vừa trần"** |
| `balanced` | Coder-30B + Qwen3-4B general + embedding, vision theo yêu cầu | 28.026 (86%) | 28.062 (86,1%) ⚠ SÀN | **28.043 (86,0%)** — hết SÀN, đã đo · **vision thức 35.864 = 110,0% ❌** | ⚠ **mất lý do tồn tại chính** — xem dưới |

⚠ **Cả ba hồ sơ đều dựa vào Coder-30B ⇒ cả ba đều có ĐIỀU KIỆN TIÊN QUYẾT CHƯA GỠ** (app không nạp được 30B trên đường boot bình thường — xem §3). Bảng này nói *"nếu nạp được thì vừa"*, **không** nói *"nạp được"*.

> **⚠ Đợt 2 — bốn đính chính cho bảng này:**
> 1. **`vision-heavy` là hồ sơ được lợi nhiều nhất từ Đợt 2** — lần đầu tiên nó **vừa trần dưới tải** (96,3%, biên 1.220 MiB). Hai nguồn: model nhúng −2.089 MiB, và số hạng "+1.776 đỉnh nhúng đồng thời" **biến mất** (Task 3 vá race `getEmbeddingContext()`, đo được 2.430 → 652 MiB cho 4 lượt đồng thời).
> 2. ⚠ **Nhưng ô đó là PHÉP CỘNG.** Chưa từng đo Coder-30B + sidecar thị giác **cùng thức**. Lỗ hổng bằng chứng lớn nhất còn lại **nằm đúng ở hồ sơ vừa được "cứu"**. Đừng chốt `vision-heavy` trước khi chạy phép đo đó.
> 3. **`balanced` MẤT LÝ DO TỒN TẠI CHÍNH.** Nó sinh ra để dự phòng phòng khi Coder-30B viết tiếng Việt tệ — chủ dự án đã chấm (2026-08-02): **Coder viết nhỉnh hơn general**. Và Đợt 2 đo được 4B **đắt hơn Đợt 0 công bố 2.070 MiB** (3.464 → **5.534**), nên nó **vẫn** vượt trần khi vision thức (110,0%) trong khi `code-heavy` thì không (93,0%). ⇒ **Thua ở cả hai mặt.** Đề nghị hạ xuống *"chỉ dùng khi có lý do KHÁC lý do tiếng Việt"* (ví dụ cần model general cho tác vụ ngoài code). Ghi trung thực kể cả khi điều đó làm phần lớn mục này thành thừa.
> 4. **Con số 86,1% của Đợt 1 đúng vì MAY**, không vì nó được đo: embedding **−2.089** và 4B **+2.070** triệt tiêu nhau (ròng **−19 MiB**). Dự đoán "+1.350 cho 4B" của Đợt 1 **hụt 720 MiB**.

> **⚠ Đợt 1 — ba đính chính cho bảng này:**
> 1. **Cột "Đợt 0" đánh giá thấp cả ba hồ sơ ~3.400 MiB** (`bench.mjs` không qua mã sản xuất). Trước Đợt 1, số thật là: `code-heavy` **27.971 (85,8%)** · `vision-heavy` **35.792 (109,8% ❌ đã vượt trần)** · `balanced` **31.435 (96,4%)**.
> 2. **`vision-heavy` chưa bao giờ thật sự vừa.** Đợt 0 công bố 99,3%; số thật lúc đó là **109,8%**. Sau Đợt 1 nó về 99,4% **lúc nghỉ**, nhưng **dưới tải là 102,7% — vẫn vượt trần** (cộng đỉnh nhất thời khi nhúng đồng thời, review cổng cuối, thì ~104,9% — xem cuối §5). Đây là hồ sơ được lợi nhiều nhất từ Đợt 1 mà **vẫn chưa dùng được**.
> 3. **`balanced` là hồ sơ được lợi thật sự**: từ 96,4% (không còn chỗ cho buffer sinh) xuống **86,1%** — chịu được hai model cùng sinh (**91,8%**). ⚠ Nhưng số 4B vẫn là số `bench.mjs`; nếu 4B cũng đắt thêm ~1.350 MiB thì `balanced` ≈ **90,2%** (ước lượng, **chưa đo**). Và **`balanced` KHÔNG được để vision thức**: 35.883 = **110,0% ❌**.

---

## 8. Điều tài liệu này KHÔNG trả lời

- ~~**Chất lượng tiếng Việt của Coder-30B** — chờ chấm~~ ✅ **ĐÃ CHẤM 2026-08-02**: Coder **nhỉnh hơn** general, mức nhẹ. ⇒ **Hồ sơ này ĐÚNG từ gốc.**
- **Mức chậm khi ghost-text + sinh code đồng thời** — chưa đo. ⚠ Đợt 2 thêm một mặt VRAM cho câu hỏi này: nếu **giữ FIM riêng**, kịch bản đó tốn **34.045-34.515 MiB (104,4-105,9% ❌)** khi vision thức — xem §2.1.
- ~~**Nguyên nhân 4,5 GB buffer embedding** — chưa truy.~~ ✅ **Đợt 1 đã truy**: `contextSize:"auto"` trong `getEmbeddingContext()`; đã sửa, giành lại **3.373 MiB**. Xem §5.
- ~~**Hiệu quả `-np 1` cho sidecar** — chưa đo, cần sửa mã.~~ ✅ **Đợt 1 đã đo**: **~0 MiB**, tiền đề sai (`kv_unified=true`). Xem §5.
- **Cơ chế hồ sơ** (chọn/chuyển/kiểm tra hồ sơ lúc triển khai) — chưa thiết kế, là spec riêng.

**Đợt 1 để lại những câu hỏi MỚI — và một trong số đó đang CHẶN hồ sơ này:**

- 🚧 **CƠ CHẾ vì sao khối 16,7 GB không cấp phát được khi CUDA context tạo SAU boot app.** Biết **điều kiện** (đo 6 phép thử, có chứng ngược), **không** biết **vì sao**. Đã có **đường vòng** (tạo CUDA context sớm) nhưng chưa thành mã, chưa nghiệm thu nhiều lượt boot ⇒ **điều kiện 1 của §3 vẫn chưa đạt, nhưng không còn bị chặn cứng.**
- ~~**Model 4B chưa đo bằng đường sản xuất**~~ ✅ **Đợt 2 ĐÃ ĐO**: 4B = **5.534 MiB** (Đợt 0 công bố 3.464 ⇒ **hụt 2.070**), FIM = **2.188 MiB** (Đợt 0 công bố 1.774 ⇒ **hụt 414**). Hai lượt độc lập mỗi model, lệch 1 / 4 MiB — trong biên nhiễu **~±10 MiB** (⚠ **không** phát biểu "khớp chính xác"). ⇒ `balanced` hết đứng trên số sàn — **và bằng chứng mới không cứu nó**.
- ~~**Nhánh `catch` `gpuLayers:"auto"` có phải mã chết không**~~ ✅ **ĐÃ TRẢ LỜI: ĐÚNG** (`err.message = "Failed to load model"` ⇒ `isOom = false`). §4 đã viết lại. Câu hỏi còn lại: **sửa thế nào** — đợt riêng.
- ~~**Comment `aiGgufEngine.ts:1108-1109` mô tả sai sự thật**~~ ✅ **Đợt 2 Task 6 ĐÃ SỬA** (dòng thật `aiGgufEngine.ts:1241-1242`), **chỉ comment**. Cùng lớp lỗi, sửa thêm hai chỗ: `aiGgufEngine.embedCtx.test.ts:19-20` và `aiGgufEngine.ts:263` viết *"throw bị `kbVectorStore.ts` (ingestKbChunks) nuốt thành `skipped++`"* — **Task 4 chứng minh SAI** (`catch` đã log `docId` + `err.message` từ commit `e4e24aa6`, 2026-06-24).
- ~~**Còn giành lại được bao nhiêu từ context thường của model nhúng**~~ ✅ **Đợt 2 ĐÃ ĐO VÀ ĐÃ LẤY**: **4.322 → 2.232 MiB (−2.090, −48,4%)**; 4 lượt nhúng đồng thời **2.430 → 652 MiB (−1.778)**.
- **Chưa từng đo Coder-30B + sidecar thị giác CÙNG THỨC trên một máy** — mọi ô "có ảnh" của cả ba đợt là **phép cộng**. Ô vừa đổi kết luận (96,3%) nằm đúng chỗ này. **Đây là phép đo tiếp theo đáng chạy nhất.**
- **Lưu lượng thật của tier code** — đường ống đã thông (điều kiện 2), **chưa có hàng**. 4 dòng hiện có là lưu lượng dựng. Và khi đọc, **`count(*)` là số lượt suy luận GPU, không phải số lượt người dùng** (tỉ lệ đo được **3:1** cho `generateProgram`).
- **Tier `vision` ghi `model='default'`** cho cả 16 dòng metric — vẫn mù về model. Chưa vá.
