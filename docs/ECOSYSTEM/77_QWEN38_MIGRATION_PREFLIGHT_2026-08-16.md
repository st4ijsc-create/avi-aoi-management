# 77 — Tiền kiểm G5: di trú sang Qwen3.8-27B (một model sinh chữ chính)

**Ngày đo:** 2026-08-16 · **Trạng thái:** TIỀN KIỂM — CHƯA tải model, CHƯA sửa mã, CHƯA chạy git
**Phần cứng:** RTX 5090 (Blackwell sm_120), 48 GB RAM, VRAM tổng ≈ 32.600 MiB

---

## PHÁN QUYẾT

> **G5 KHÔNG bị chặn ở đường sinh chữ — nhưng CẦN NÂNG CẤP RUNTIME trước khi bỏ được sidecar thị giác.**
> Kiến trúc `qwen35` **ĐÃ CÓ SẴN** trong cả hai runtime đang chạy trên máy này (đo bằng cách đọc chuỗi
> trong binary, không phải suy đoán). Nhưng **projector thị giác `qwen35` thì CHƯA CÓ** —
> `mtmd.dll` hiện tại chỉ biết `qwen3vl`. Vậy: text chạy được, **vision thì không**, và mục tiêu
> "bỏ sidecar VL-8B để còn ít model" **chưa đạt được nếu không nâng cấp llama.cpp**.

**Đính chính một tiền đề của chính brief này:** brief giả định *"dense 27B có KV lớn hơn MoE-A3B nhiều"*.
**SAI.** Đo theo `config.json` thật: Qwen3.8-27B dùng **attention lai** — chỉ **1/4 số lớp** (16/64) là
full-attention, còn lại là linear attention; cộng GQA chỉ 4 KV-head. KV/token = **64 KiB**, trong khi
Qwen3-30B-A3B là **96 KiB/token**. KV của model mới **NHỎ HƠN** model đang dùng, không lớn hơn.

---

## 1. Runtime có nhận được kiến trúc Qwen3.8 không?

### 1.1 Hai đường thực thi — KHÁC NHAU, phải tách bạch

Đây là điểm brief chưa tách, và nó quyết định toàn bộ kế hoạch:

| Đường | Dùng cho | Binary | llama.cpp |
|---|---|---|---|
| **In-process** (`node-llama-cpp`) | **model sinh chữ chính**, embedding, intent, FIM | `llama.cuda.b8390.dll` | **b8390** |
| **Sidecar ngoài** (`LLAMA_SERVER_BIN`) | **CHỈ thị giác** (`llamaVisionSidecar.ts`) | `llama-server.exe` | **build 9814** (`487a6cc16`) |

Bằng chứng đường sidecar chỉ phục vụ thị giác: `LLAMA_SERVER_BIN` chỉ xuất hiện ở
`server/services/llamaVisionSidecar.ts:132`, `server/services/aiGgufEngine.ts:2344/2359`,
`server/services/aiProviderRouter.ts:401` và các hộ VRAM (`vramAdoption.ts:154`) — **không** có call site
sinh chữ nào.

### 1.2 Lệch phiên bản trong chính `node_modules` (phát hiện phụ)

- `package.json` khai `node-llama-cpp: ^3.18.1` → **đã cài 3.19.0**
- `node-llama-cpp/llama/gitRelease.json` → `tag: "b9842"`
- **NHƯNG** binary thật đang nạp là gói `@node-llama-cpp/win-x64-cuda` **ghim cứng 3.18.1**
  (`package.json:197-198`), và `_nlcBuildMetadata.json` khai `"release":"b8390"`.

⇒ **llama.cpp thật sự chạy in-process là `b8390`, KHÔNG phải `b9842`.** Metadata JS nói một đằng,
binary nạp một nẻo. Ai đọc `gitRelease.json` để kết luận năng lực runtime sẽ bị lệch **1.452 build**.

### 1.3 Kiến trúc `qwen35` đã được hỗ trợ chưa? — ĐO, không đoán

Chuỗi tên kiến trúc nằm trong bảng arch đã biên dịch. Đọc trực tiếp:

```
$ grep -oaE "qwen3[a-z0-9]{0,8}" .../bins/win-x64-cuda/llama.cuda.b8390.dll | sort -u
qwen3  qwen35  qwen35moe  qwen3moe  qwen3next  qwen3vl  qwen3vlmoe

$ grep -oaE "qwen3[a-z0-9]{0,8}" D:/SOURCES/16.AI/llama-cuda/llama.dll | sort -u
qwen3  qwen35  qwen35moe  qwen3moe  qwen3next  qwen3vl  qwen3vlmoe
```

**Cả hai runtime ĐỀU đã có `qwen35` và `qwen35moe`.**

**Vì sao?** `qwen35` là tên kiến trúc **DÙNG CHUNG cho cả họ Qwen3.5 / 3.6 / 3.8** — GGUF không cho phép
dấu chấm trong tên arch (parser C++ không phân biệt được tên arch với tên tham số), nên Qwen3.6-27B
*cũng* mang arch `qwen35`
([nguồn](https://huggingface.co/unsloth/Qwen3.5-27B-GGUF/discussions/12)).
Kiến trúc này vào llama.cpp từ thời Qwen3.5, **trước** Qwen3.8 nhiều tháng.

### 1.4 Vậy con số "cần b10419" là gì?

Đó là **câu template tự sinh của người lượng tử hoá** ("quantized using release bXXXX"), **KHÔNG phải
ngưỡng tối thiểu**:
- bartowski: dựng bằng **b10419** ([nguồn](https://huggingface.co/bartowski/Qwen3.8-27B-GGUF))
- lmstudio-community: dựng bằng **b10430** ([nguồn](https://huggingface.co/lmstudio-community/Qwen3.8-27B-GGUF))

Một người chạy Qwen3.8-27B trên RTX 5090 ghi rõ: *"No rebuild required; the model used existing
architecture support"* ([nguồn](https://note.com/unco3/n/n50897cea0ae5?hl=en)).

### 1.5 sm_120 (Blackwell)

```
$ grep -oaE "sm_[0-9]{2,3}" ggml-cuda.dll | sort -u
sm_86  sm_89  sm_120  sm_121
```
**Cả hai build đều có sm_120 native.** Không phải JIT qua PTX. **Không có rào cản Blackwell.**

### 1.6 Kết luận mục 1

| Hạng mục | Trạng thái |
|---|---|
| Text `qwen35` in-process (b8390) | ✅ arch có mặt — **rất nhiều khả năng nạp được** |
| Text `qwen35` sidecar (9814) | ✅ arch có mặt |
| sm_120 | ✅ native cả hai |
| **Vision `qwen35` (mmproj)** | ❌ **KHÔNG có** — xem mục 3 |
| **MTP / speculative decode** | ❌ không có cờ `draft-mtp`/`spec-type` trong build 9814 |

> ⚠ **Giới hạn của phép đo này:** sự hiện diện của chuỗi `qwen35` chứng minh llama.cpp **biết tên kiến
> trúc**. Nó **KHÔNG** chứng minh b8390 parse đúng **hparam của riêng bản 27B/Qwen3.8**. Chỉ có nạp
> thật mới chứng minh được — mà nạp thật thì phải tải 17 GB. **Đây là ranh giới giữa cái đã đo và cái
> còn phải đo.**

---

## 2. Chọn bản lượng tử nào?

### 2.1 Dung lượng thật (bartowski, [file listing](https://huggingface.co/bartowski/Qwen3.8-27B-GGUF/tree/main))

| Quant | GB (thập phân) | MiB |
|---|---|---|
| Q4_K_M | 17,77 | **16.947** |
| Q5_K_M | 20,75 | **19.789** |
| Q6_K | 23,46 | **22.373** |
| Q8_0 | 29,12 | 27.772 |
| mmproj-f16 | 0,928 | **885** |

### 2.2 KV cache — tính theo số lớp/head THẬT

Từ `config.json` (`Qwen/Qwen3.8-27B`): 64 lớp · hidden 5120 · 24 head · **`num_key_value_heads = 4`** ·
**`head_dim = 256`** · vocab 248.320 · max_position 262.144 · **full-attention chỉ ở mỗi lớp thứ 4**
(vị trí 3, 7, 11… ⇒ **16 lớp**), 48 lớp còn lại là linear attention (state hằng số, không tăng theo ctx).

```
KV/token/lớp-full = 2 (K,V) × 4 kv_head × 256 head_dim × 2 B (f16) = 4.096 B = 4 KiB
KV/token          = 4 KiB × 16 lớp full = 64 KiB
```

| ctx | KV (f16) |
|---|---|
| 16k | **1.024 MiB** |
| 32k | **2.048 MiB** |

So sánh Qwen3-30B-A3B đang dùng (48 lớp, 4 kv_head, head_dim 128, full-attn toàn bộ): 96 KiB/token →
**3.072 MiB @32k**. ⇒ Model mới **tiết kiệm KV hơn** model cũ.

> ⚠ **MỘT BẤT ĐỒNG CHƯA GIẢI ĐƯỢC.** Bài đo thực địa nói ctx **131k chỉ tốn ~637 MB**
> ([note.com](https://note.com/unco3/n/n50897cea0ae5?hl=en)), trong khi công thức trên cho 8.192 MiB ở
> 131k — lệch **~12,8×**. Giải thích khả dĩ: sliding-window trên các lớp full-attn, hoặc KV đã lượng tử.
> **KHÔNG TÌM ĐƯỢC NGUỒN** xác nhận. Ghi nhận là **cận trên** của tôi và **cận dưới** của họ; kết luận
> "vừa ngân sách" đúng ở **cả hai** đầu, nên quyết định không đổi. Vẫn phải đo khi nạp thật.
> State của 48 lớp linear attention: **CHƯA ĐO**, chưa cộng vào bảng dưới.

### 2.3 Ngân sách (còn ~25.000 MiB)

| Phương án | Model | KV@32k | mmproj | Đệm CUDA (ước) | Tổng | Dư |
|---|---|---|---|---|---|---|
| **Q4_K_M @32k** | 16.947 | 2.048 | 885 | ~800 | **20.680** | **+4.320** ✅ |
| Q5_K_M @32k | 19.789 | 2.048 | 885 | ~800 | 23.522 | +1.478 ⚠ |
| Q5_K_M @16k | 19.789 | 1.024 | 885 | ~800 | 22.498 | +2.502 ✅ |
| Q6_K @32k | 22.373 | 2.048 | 885 | ~800 | 26.106 | **−1.106** ❌ |

**Đối chứng thực địa:** người dùng 5090 đo **17,5 GB VRAM khi phục vụ ở 8k** với Q4_K_M
([nguồn](https://x.com/witcheer/status/2088316316205907970)) — khớp với 16.947 MiB + KV/đệm.

### 2.4 Khuyến nghị

- **CHÍNH: `Q4_K_M` (hoặc Unsloth `UD-Q4_K_XL`) ở ctx 32k.** Dư ~4.300 MiB — đủ biên cho phân mảnh
  VRAM (bài học đã ghi ở `aiGgufEngine.ts:1591`).
- **DỰ PHÒNG: `Q5_K_M` ở ctx 16k**, chỉ khi Q4 hụt chất lượng.
- **Q6_K: LOẠI** — không vừa ở 32k.

> ⚠ **KHÔNG thể đồng trú với sidecar VL-8B (7.825 MiB):** 20.680 + 7.825 = **28.505 > 25.000**. Kể cả
> Q4_K_M@16k cũng vượt. ⇒ Nếu vẫn giữ VL-8B, **bộ điều phối VRAM BẮT BUỘC phải evict** — không bao giờ
> được để hai hộ này cùng thường trú.

---

## 3. Vision native có dùng được qua llama.cpp không?

**KHÔNG — chưa, trên binary hiện tại.**

```
$ grep -oaE "(qwen3[a-z0-9]{0,8}|proj_type)" D:/SOURCES/16.AI/llama-cuda/mtmd.dll | sort -u
qwen3a  qwen3vl
```

`mtmd.dll` (build 9814, 26/06/2026) biết projector **`qwen3vl`** — đúng loại mà sidecar `Qwen3-VL-8B`
đang dùng — nhưng **không có `qwen35`**. File `mmproj-Qwen3.8-27B-f16.gguf` (928 MB) **tồn tại thật**
trên HuggingFace, nhưng runtime này chưa đọc được nó.

### 3.1 Thị giác bị chặn ba lớp, không phải một

Nâng llama.cpp **là điều kiện cần, KHÔNG đủ**. Kiểm kê mã cho thấy ba lớp chặn độc lập:

| # | Lớp chặn | Bằng chứng | Gỡ bằng |
|---|---|---|---|
| 1 | `mtmd.dll` không có projector `qwen35` | đo binary (trên) | nâng llama.cpp ≥ b10430 |
| 2 | **`node-llama-cpp` KHÔNG bind mtmd sang JS** — truyền `mmproj` vào `loadModel` bị **bỏ qua IM LẶNG**; `loadLlavaModel()` **ném lỗi vô điều kiện** | `aiGgufEngine.ts:2322-2338`, `:2332` | chờ nlc hỗ trợ, hoặc giữ kiến trúc sidecar |
| 3 | **KHÔNG có đường mã nào gửi ảnh tới model sinh chữ chính** — `describeImage` hard-route sang sidecar | `aiGgufEngine.ts:2350-2372`; router đặt `modelId = undefined` cho vision (`aiModelRouter.ts:361-364`) | **viết mã mới** |

Trích nguyên văn `aiGgufEngine.ts:2322-2338`:

> `@deprecated WS-G2: node-llama-cpp 3.18.1 does NOT bind llama.cpp's multimodal (mtmd) projector to JS — passing `mmproj` to loadModel is silently ignored, so in-process vision is impossible on this version.`

**Hệ quả:** **GIỮ `Qwen3-VL-8B` (7.825 MiB)**. Mục tiêu "ít model" **chỉ đạt 3/4** ở lần di trú này
(bỏ được 3 model sinh chữ, chưa bỏ được sidecar thị giác). Đây **không phải** việc đổi `.env` — là một
hạng mục kỹ thuật riêng, nên tách thành pha sau.

### 3.2 Nếu vẫn muốn dùng Qwen3.8 làm model thị giác

Sidecar cần **cặp `-m` + `--mmproj` riêng** (`llamaVisionSidecar.ts:353-363`, argv bị khoá bởi test
`llamaVisionSidecar.args.test.ts:15`). Chạy Qwen3.8-27B **vừa** làm model chữ in-process (~16.947 MiB)
**vừa** làm sidecar thị giác (thêm ~16.947 MiB nữa, tiến trình riêng) = **33.894 MiB > cả card**.
⇒ **Không khả thi.** Nếu nâng cấp, phải chọn: hoặc in-process (cần lớp chặn #2 được gỡ), hoặc sidecar
(và bỏ đường in-process).

**Phần thưởng nếu gỡ được cả ba lớp:** đổi sidecar 7.825 MiB lấy mmproj 885 MiB ⇒ **giành lại ~6.940 MiB**.

---

## 4. Tốc độ dự kiến — dense 27B vs MoE 30B-A3B

### 4.1 Ước tính theo băng thông (ƯỚC TÍNH, KHÔNG PHẢI ĐO)

Dense ⇒ mỗi token phải đọc **toàn bộ** trọng số. RTX 5090 ≈ **1,792 TB/s**.

```
Trần lý thuyết = 1.792 GB/s ÷ 17,77 GB ≈ 100,8 tok/s
Hiệu suất băng thông thực tế 70–80% ⇒ ≈ 71–81 tok/s
```

### 4.2 Đo thật của người khác trên RTX 5090

| Nguồn | Cấu hình | Decode |
|---|---|---|
| [witcheer (X)](https://x.com/witcheer/status/2088316316205907970) | Q4_K_M, llama.cpp, llama-bench | **78 tok/s** rỗng · **76** @8k · **71** @32k (pp512 = 3.900 tok/s; 17,5 GB @8k) |
| [note.com](https://note.com/unco3/n/n50897cea0ae5?hl=en) | UD-Q5_K_XL + **MTP speculative** (n_max=3) | **148,3** tok/s (code) · **128,6** (tiếng Nhật) |

Ước tính của tôi (71–81) **khớp** phép đo độc lập (78). Đây là hiếm — ghi nhận.

### 4.3 Đối chiếu ngưỡng

| | tok/s | > 52? |
|---|---|---|
| Qwen3-30B-A3B hiện tại (MoE, ~3B kích hoạt) | 277 | ✅ |
| Qwen3.8-27B Q4_K_M, ctx rỗng | 78 | ✅ **+50%** |
| Qwen3.8-27B Q4_K_M, **@32k** | **71** | ✅ **+37%** |

**ĐẠT ngưỡng, nhưng phải nói thẳng: chậm hơn hiện tại ~3,5×** (277 → 78). Đây là cái giá của dense.
Đường **ghost-text** vẫn giữ `Qwen2.5-Coder-1.5B` nên độ trễ gõ phím **không bị ảnh hưởng**.

> ⚠ **MTP không dùng được ngay:** build 9814 không có `draft-mtp`/`spec-type`. Con số 148 tok/s **chỉ
> đạt được sau khi nâng cấp llama.cpp**. Người đo cũng cảnh báo: chọn quant phải nhìn **độ rộng bit của
> lớp MTP**, không nhìn bit trung bình — Q4 làm hỏng độ chính xác look-ahead.

---

## 5. Tương thích trong repo

### 5.1 `modelResolver.ts` — TIN TỐT: 0 tên model hard-code

`server/services/ai/modelResolver.ts` (249 dòng) là **single source of truth**, **thuần env**, không I/O.
Toàn bộ 7 resolver chỉ đọc biến môi trường:

| Hàm | dòng | env |
|---|---|---|
| `fastModelBasename()` | :119 | `GGUF_FAST_MODEL` |
| `defaultModelBasename()` | :129 | `GGUF_DEFAULT_MODEL` |
| `thinkingModelBasename()` | :135 | `GGUF_THINKING_MODEL` |
| `codeModelBasename()` | :141 | `GGUF_CODE_MODEL` → default |
| `fimModelBasename()` | :148 | `GGUF_FIM_MODEL` → fast → default |
| `fimModelForLogicalName()` | :165 | `GGUF_FIM_MODEL` → fast → **undefined** |
| `embedModelBasename()` | :172 | `GGUF_EMBED_MODEL` |

⇒ **Gộp 3 model về 1 = sửa `.env`, KHÔNG sửa mã ở tầng resolver.** Ba biến `GGUF_DEFAULT_MODEL`,
`GGUF_CODE_MODEL`, `GGUF_FAST_MODEL` cùng trỏ vào một basename là xong.

### 5.2 `.env` — các dòng phải đổi (KHÔNG đổi trong lượt tiền kiểm này)

| dòng | hiện tại | ghi chú |
|---|---|---|
| `.env:120` | `GGUF_DEFAULT_MODEL=Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf` | → Qwen3.8-27B |
| `.env:699` | `GGUF_CODE_MODEL=Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf` | → Qwen3.8-27B |
| `.env:122` | `GGUF_FAST_MODEL=Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf` | → Qwen3.8-27B (hoặc bỏ) |
| `.env:700` | `GGUF_FIM_MODEL=Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf` | **GIỮ NGUYÊN** |
| `.env:192` | `GGUF_EMBED_MODEL=Qwen3-Embedding-0.6B-f16.gguf` | **GIỮ NGUYÊN** |
| `.env:458` | `GGUF_RERANKER_MODEL=bge-reranker-v2-m3-Q8_0.gguf` | **GIỮ NGUYÊN** |
| `.env:187/188` | `GGUF_VISION_MODEL/MMPROJ` = Qwen3-VL-8B | **GIỮ** (mục 3) |
| **`.env:180`** | **`GGUF_DEFAULT_CTX=4096`** | ⚠ xem 5.3 |
| `.env:181` | `GGUF_MAX_CTX=32768` | trần cứng — khớp khuyến nghị 32k |
| `.env:153` | `GGUF_MAX_LOADED_MODELS=4` | ⚠ xem 5.4 |

### 5.3 Giả định ctx 4096 — RỦI RO THẬT

`GGUF_DEFAULT_CTX=4096` trên model ctx native 262k là lãng phí lớn, và `aiGgufEngine.ts:306` đã ghi nhận
**node-llama-cpp KHÔNG cắt âm thầm khi input vượt `contextSize`** — nó ném lỗi. Đổi model mà quên nâng
ctx mặc định ⇒ vẫn 4096. Cần nâng cùng lượt (đề xuất 16384, trần 32768).

### 5.4 Kế toán VRAM & số model thường trú

`GGUF_MAX_LOADED_MODELS=4` (`.env:153`) sinh ra từ thời **ba model MoE + fast nhỏ**. Với **một** model
dense 16.947 MiB, cho phép 4 model thường trú là **cửa mở dẫn tới OOM** — 2 bản Qwen3.8 đồng trú đã là
33.894 MiB > VRAM cả card. Sau khi gộp roster, giá trị này **phải hạ**, và phải đo lại bằng bộ điều phối
VRAM (`server/services/vram/*`), nơi các hộ được nhận nuôi theo `LLAMA_SERVER_BIN` (`vramAdoption.ts:154`).

### 5.5 Còn phải xác minh (CHƯA ĐO trong lượt này)

- `server/_core/llm.ts` `toGgufMessages` (~:201) — chat template / special token. Qwen3.8 có
  **hybrid thinking** với `reasoning_effort` (xhigh/medium/low/none) và "Preserve Thinking"
  ([Unsloth](https://unsloth.ai/docs/models/qwen3.8)); nếu `toGgufMessages` không lọc khối `<think>`,
  chuỗi suy luận sẽ **rò ra câu trả lời người dùng**. Tham số khuyến nghị đổi theo chế độ:
  thinking `temp=1.0/top_p=0.95`, instruct `temp=0.7/top_p=0.80` — repo hiện có thể đang ghim một bộ.
- **GBNF** (intent + agent planner): GBNF là cơ chế của llama.cpp, **không phụ thuộc kiến trúc model**,
  nên về nguyên tắc vẫn chạy. Nhưng vocab đổi (**248.320** token, so với ~151.936 của Qwen3 cũ) ⇒
  **mọi chỗ hard-code token-id, hoặc grammar sinh theo vocab cũ, phải kiểm lại.**
- (kiểm kê đã khép — xem 5.6 trở đi)

### 5.6 ĐÍNH CHÍNH brief: `toGgufMessages` KHÔNG nằm ở `server/_core/llm.ts:~201`

Nó ở **`server/routes/openaiGateway.ts:201-213`** (gọi tại `:378`). Brief chỉ sai file.

**Tin tốt:** hàm này **không hard-code chat template nào** — chỉ phát `{role, content}` thuần, rồi giao
cho `LlamaChatSession` của node-llama-cpp tự dò ChatWrapper từ **metadata trong GGUF**
(`aiGgufEngine.ts:1702`, `:2361`). **Không có chuỗi `<|im_start|>` nào được phát ra ở đây.** ⇒ Đổi
model **không cần sửa `toGgufMessages`**.

Ba điểm cần biết:
- `role: "tool"` bị **gộp âm thầm thành `"user"`** (`openaiGateway.ts:210`) — chưa có tool-calling native.
- `contentToString` (`:184-198`) **vứt bỏ hoàn toàn phần `image_url`**.
- Bộ chuyển đổi *khác* ở `server/_core/llm.ts:254-283` (`splitMessages`) **làm phẳng có mất mát**: mọi
  lượt không phải system bị nối bằng `\n\n` thành MỘT prompt ⇒ **cấu trúc đa lượt bị phá**.

### 5.7 RỦI RO LỚN NHẤT VỀ MÃ: `stripThinking()` hard-code thẻ `<think>`

`server/services/aiGgufEngine.ts:3094-3155` cắt suy luận bằng regex **cứng** `/<think>/i`,
`/<\/think>/i`, `/<think>([\s\S]*?)<\/think>/gi`.

Qwen3.8 có **hybrid thinking** với `reasoning_effort` (xhigh/medium/low/none) và "Preserve Thinking"
([Unsloth](https://unsloth.ai/docs/models/qwen3.8)). **Nếu model mới phát thẻ khác** (`<reasoning>`,
`<|thinking|>`…), `stripThinking()` **fail-open** ⇒ **chuỗi suy luận thô rò thẳng ra giao diện người
dùng**. Router bật `thinking: true` tại `aiModelRouter.ts:431-433`.

⇒ **Phải xác minh thẻ suy luận thật TRƯỚC khi bật cho người dùng.** Đây là hạng mục chặn.

Tham số khuyến nghị cũng đổi theo chế độ (thinking `temp=1.0/top_p=0.95`, instruct `temp=0.7/top_p=0.80`)
trong khi `openaiGateway.ts:367` đang mặc định `temperature 0.7` và `:366` `max_tokens` **1024**.

### 5.8 GBNF — chạy được, nhưng có TIỀN LỆ THOÁI HOÁ phải kiểm lại

Cơ chế: `generateJSON()` tại `aiGgufEngine.ts:1930-2050`, dựng grammar bằng
`llama.createGrammarForJsonSchema()` (`:1996`) hoặc `LlamaJsonSchemaGrammar` (`:1998`). GBNF là cơ chế
của **llama.cpp**, sinh từ JSON-schema lúc chạy, **không phụ thuộc kiến trúc model và không ghim
token-id** ⇒ **về nguyên tắc vẫn chạy** với vocab 248.320.

**9 điểm gọi phải nghiệm thu lại:**

| Tính năng | Schema | Gọi |
|---|---|---|
| Intent classification | `intentClassifier.ts:1100` | `:1199` |
| Issue classifier | `aiIssueClassifier.ts:57` | `:172` |
| **Agent planner** | `aiAgentPlanner.ts:55` | `:210`, `:349` |
| RCA copilot | `aiRcaCopilot.ts:405` | `:528` |
| Orchestration advisor | `aiOrchestrationAdvisor.ts:169`, `:245` | `:405` |
| Programming codegen | `codegenSchemas.ts:76`, `:121` | `aiProgrammingCopilot.ts:720`, `:753` |
| Insights | `aiInsightsService.ts:104` | `:89` |
| Provider router | `aiProviderRouter.ts:88` | `:326` |
| tRPC | `annotationRouters.ts:689`, `inspectionRouters.ts:516` | qua `_core/llm.ts:386` |

> ⚠ **TIỀN LỆ ĐÃ TỪNG XẢY RA** — `aiSpecialistAgentService.ts:451`: *"generateJSON+grammar — thoái hoá
> GIỐNG HỆT — summary 20953 ký tự toàn 'result result result…', KHÔNG một ký tự JSON nào"*, và `:471`:
> ***"grammar không hề ngăn"***. Nhánh đó **đã bị revert** (`:683-693`), khoá bởi
> `aiSpecialistAgent.repoContext.test.ts:3-4`. **Grammar KHÔNG phải bảo chứng.** Model mới phải được
> nghiệm thu lại trên chính lớp lỗi này.

### 5.9 Trần ctx bị chặn HAI lần — nâng `.env` thôi KHÔNG đủ

| Vị trí | Giá trị |
|---|---|
| `aiGgufEngine.ts:279-282` | `GGUF_DEFAULT_CTX` mặc định **4096** |
| `aiGgufEngine.ts:284-287` | `GGUF_MAX_CTX` mặc định **32768** |
| `aiGgufEngine.ts:289-295` | `resolveContextSize()` = `min(max(⌊req⌋,256), GGUF_MAX_CTX)` — **cắt IM LẶNG** |
| **`aiModelRouter.ts:297-301`** | `codeContextSize()` = **`Math.min(GGUF_MAX_CTX, 32768)`** — **chặn lần hai, ngay cả khi đã nâng env** |
| `aiGgufEngine.ts:270-273` | `GGUF_SEQUENCES` mặc định **4** ⇒ **KV × 4** |

⇒ Muốn vượt 32k phải sửa **cả `.env:181` VÀ `aiModelRouter.ts:300`**, rồi tính lại KV **nhân 4 khe**.
Với khuyến nghị 32k của tôi (§2.4) thì **không cần đụng mã** — nhưng phải biết trần này tồn tại.

> ⚠ **`contextSize: "auto"` là bẫy VRAM đã đo:** `aiReranker.ts:486` là chỗ duy nhất còn `"auto"` trong
> mã sản phẩm; `aiModelRouter.ts:352-355` đo `"auto"` = **3.916 MiB so với 526 MiB** cho cùng model 0.6B
> (**7,4×**). Trên model ctx native **262k**, `"auto"` sẽ **nuốt sạch card**. Cũng còn ở
> `scripts/ai-kb/embed-programming.mjs:103`.

### 5.10 Kế toán VRAM — tin tốt

`server/services/vram/vramEstimator.ts:27-40` xếp hạng `learned` → **`file-size`** → `config-default` →
`unknown`. Model GGUF sinh chữ **cố ý KHÔNG truyền `configDefaultBytes`** (`aiGgufEngine.ts:1128`,
`:3010` — *"một hằng số bịa ra ở đây chính là thứ đã trôi"*). ⇒ **KHÔNG có bảng MiB theo model.**
**Đổi file GGUF thì kích thước tự cập nhật.**

Nhưng: giá trị `learned` khoá theo `gguf:<modelId>` (basename) ⇒ **basename mới reset về ước lượng theo
file-size ở lần nạp đầu** (`vramEstimator.ts:31-33`).

Hằng số MiB cứng còn tồn tại (đều là sidecar/phụ trợ, không phải model chính):
`llamaVisionSidecar.ts:201` & `vramAdoption.ts:158` = **7825**; `localSidecarTrainer.ts:408` = 6144;
`kbSyncScheduler.ts:321`/`:555` = 1251.

⚠ `vramCaps.ts:126-138`: **`GGUF_MAX_LOADED_MODELS=N` thực tế chỉ là N−1 model sinh chữ** khi reranker
đang giữ lease `gguf-model`.

### 5.11 Kiểm kê tên model hard-code ngoài resolver — phải sửa

**Mã sản phẩm:**
- `aiModelCard.ts:70-141` — **4 thẻ portfolio** khai cứng tên/quant/`contextSize`/`evalMetrics`
  (`:74` `"UD-Q4_K_XL (MoE, ~3B active of 30B)"` — **khai báo MoE literal DUY NHẤT trong mã**;
  `:84` `{throughputTokPerSec: 166, vramGB: 17.7}`). ⚠ `:75`/`:94` khai `contextSize: 262144` **đã mâu
  thuẫn** với trần 32768 đang cưỡng chế.
- `aiModelRouter.ts:332-341`, `:404-415` — **toàn bộ luật định tuyến dựa trên số đo MoE**:
  `:333` `4B=234,9 tok/s (load 1,22s) vs 30B-A3B=192,5 tok/s (load 6,04s)`; `:404` *"30B-A3B cold-load
  ~6,04s sẽ phá vỡ ngân sách dưới 700ms"*; `:414` lý do `"pin Tier 1 fast (4B, avoid 30B cold-load)"`.
  **Dense 27B có ~9× tham số kích hoạt ⇒ mọi ngưỡng này SAI sau khi đổi.** Phải đo lại rồi chỉnh.
- `aiGgufEngine.ts:1435`, `:1512` (thông báo lỗi), `:2068`, `:2144`, `:2194` (chú thích)
- `aiReranker.ts:23/42/197/351/363/381/531/686/688`; `aiIssueClassifier.ts:12`; `aiCostModel.ts:17`
- `llamaVisionSidecar.ts:21-22/82/361/603`; `aiVisionLanguage.ts:8`; `aiAnomalyDetection.ts:866/921`
- `openaiGateway.ts:104`; `_core/index.ts:276`; `drizzle/schema/ai.ts:717`

**Chuỗi NGƯỜI DÙNG THẤY (i18n 3 ngôn ngữ) — dễ quên nhất:**
- `server/routes/aiLocalKnowledgeApi.ts:205, 207, 208` — `"[附加图片内容 — 由视觉模型 Qwen3-VL 读取]"` /
  `"[Nội dung ảnh đính kèm — do thị giác máy Qwen3-VL đọc]"` / `"[Attached image content — read by the
  Qwen3-VL vision model]"`
- `client/src/pages/AIBrainDashboard.tsx:92` — `"Vision (Qwen2.5-VL)…"` **đã sai sẵn** (thật là Qwen3-VL-8B)
- `client/src/pages/AIReportsPage.tsx:52` — `"AI (GGUF Qwen3 cục bộ)"`

**Cấu hình/manifest:** `models/manifest.json:43/52/61/74/83`; `models/README.md:22-26, 53-56`;
`.continue/config.json:14, 21`; `.env.example:348/351/393/412/422-423/2254-2255`

**Script có DEFAULT CỨNG (chạy sai âm thầm khi env đổi):**
- `scripts/ai-survey/vi-quality-ab.mjs:71-72` — `|| "Qwen3-30B-A3B-…"`, `|| "Qwen3-Coder-30B-A3B-…"`
- `scripts/ai-kb/eval-rag.mjs:215` — `|| "Qwen3-4B-Instruct-…"`
- `scripts/ai-kb/ingest-manuals.mjs:50` — `const EMBED_MODEL = "Qwen3-Embedding-0.6B-f16";` **không đọc
  env chút nào**
- `scripts/ai-eval/eval-codegen.mjs:370-371`; `scripts/ai-bench/baselines/*.json`

**FIM — bẫy im lặng:** `aiGgufEngine.ts:2109-2114` ghim sentinel `<|fim_prefix|>`/`<|fim_suffix|>`/
`<|fim_middle|>` (họ Qwen2.5/3-Coder). `modelSupportsFim()` (`:2124-2134`) dò `model.tokens.infill.*`,
**fallback heuristic là `!!process.env.GGUF_FIM_MODEL`**. ⇒ Nếu **bỏ trống** `GGUF_FIM_MODEL` trong thế
giới một-model, `resolveLogicalModel("fim")` trả `undefined` (`modelResolver.ts:165-169`) **và** FIM
**thoái hoá âm thầm thành completion thường**. ⇒ **PHẢI GIỮ `GGUF_FIM_MODEL` trỏ Qwen2.5-Coder-1.5B.**

**Chuỗi đặc biệt theo họ ChatML** (kiểm lại nếu model mới đổi token):
`aiSafety.ts:478` `/<\|(system|im_start|im_end)\|>/i` (bộ dò prompt-injection);
`shared/textSafety.ts:28, 63-65`.

**Test sẽ vỡ (≥ 22 file):** `modelResolver.test.ts`, 3 file `*.equivalence.test.ts`,
`aiTextModelPinning.test.ts`, `aiModelRouter.code.test.ts`, `aiCostModel.test.ts`,
`kbImageDescriber.test.ts`, và ~10 file `server/services/vram/*.test.ts`.

**Dữ liệu:** `knowledge/embeddings-meta.json` ghi `model: "Qwen3-Embedding-0.6B-f16"`, được **cổng kiểm**
tại `kbSyncScheduler.evalGate.test.ts:203, :214`. ⇒ **Giữ nguyên model nhúng thì không phải re-embed
91k chunk.** (Lý do mạnh để **KHÔNG đụng** `GGUF_EMBED_MODEL`.)

---

## 6. Rủi ro & phương án lùi

### 6.1 Rủi ro

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| R1 | **Bảng điểm tự khai, chưa ai replicate** (model 3 ngày tuổi) | Cao | Không tin bảng điểm; tự chấm A/B tiếng Việt trên chính nghiệp vụ AOI trước khi cắt |
| R2 | b8390 biết tên `qwen35` nhưng **có thể sai hparam của bản 27B** | Trung–cao | Test nạp **trước** khi gỡ roster cũ; giữ model cũ trên đĩa |
| R3 | **Vision `qwen35` chưa hỗ trợ** ⇒ không bỏ được VL-8B | **Chắc chắn** (đã đo) | Giữ VL-8B; hoặc nâng llama.cpp lên ≥ b10430 |
| R4 | **Chậm hơn 3,5×** (277 → 78 tok/s) | Chắc chắn | Vẫn > ngưỡng 52; ghost-text giữ model 1.5B riêng |
| R5 | Q4 làm hỏng lớp MTP ⇒ mất speculative | Trung | Nếu bật MTP sau này, dùng Q5_K_XL |
| R6 | Vocab 248k ⇒ vỡ GBNF / token-id hard-code | Trung | Kiểm 5.5 trước khi cắt |
| R7 | `GGUF_MAX_LOADED_MODELS=4` + model 17 GB ⇒ OOM | Cao | Hạ trước khi đổi model |
| R8 | Một model gánh cả chat + code ⇒ hỏng là **hỏng toàn bộ** | Trung | Roster cũ giữ trên đĩa để lùi bằng `.env` |
| R9 | **`stripThinking()` fail-open ⇒ rò chuỗi suy luận ra UI** nếu thẻ khác `<think>` (§5.7) | **Cao** | Xác minh thẻ thật trước khi bật cho người dùng |
| R10 | **Bỏ trống `GGUF_FIM_MODEL` ⇒ FIM thoái hoá ÂM THẦM** thành completion thường (§5.11) | Cao | **Giữ** `GGUF_FIM_MODEL` = Qwen2.5-Coder-1.5B |
| R11 | Ngưỡng định tuyến `aiModelRouter.ts:332-341/404-415` suy từ số đo **MoE** ⇒ sai toàn bộ với dense | Cao | Đo lại tok/s + cold-load rồi chỉnh ngưỡng |
| R12 | Chuỗi **người dùng thấy** vẫn ghi "Qwen3-VL"/"Qwen2.5-VL" ở 3 ngôn ngữ (§5.11) | Thấp | Sửa cùng lượt |

### 6.2 Phương án lùi

Vì resolver **thuần env** (5.1), **rollback = sửa lại 3 dòng `.env` + restart**. Không revert mã, không
migration. **Điều kiện: KHÔNG xoá 3 file GGUF cũ cho tới khi Qwen3.8 chạy ổn định ≥ 1 tuần.**
Chi phí giữ: ~50 GB đĩa. Rẻ hơn nhiều so với tải lại 17 GB.

### 6.3 So sánh ứng viên an toàn hơn: Qwen3.6-27B

| | **Qwen3.8-27B** | **Qwen3.6-27B** |
|---|---|---|
| Ngày ra | 03/08/2026 (HF 13–14/08) | 22/04/2026 |
| Thời gian kiểm chứng | **3 ngày** | **~4 tháng** |
| Arch GGUF | `qwen35` | `qwen35` (**giống hệt**) |
| Runtime hiện tại nhận arch? | ✅ | ✅ |
| Vision qua llama.cpp | ❌ chưa (mục 3) | ❌ chưa |
| MTP trong llama.cpp | đang thêm | **đã merge** ([Unsloth](https://unsloth.ai/docs/models/qwen3.6)) |
| Điểm code | KHÔNG TÌM ĐƯỢC NGUỒN độc lập | SWE-bench Verified **77,2%** |
| Tốc độ 5090 | 78 tok/s (đo) | ~79 tok/s dense MTP (đo) |

**Đánh đổi:** Qwen3.6 **không rẻ hơn về VRAM cũng không chậm hơn**, lại có **MTP đã merge** và **4 tháng
kiểm chứng**. Cái mất là năng lực mới của 3.8 — mà **chưa ai độc lập xác nhận**.

> **Khuyến nghị cho chủ dự án:** nếu ưu tiên **chắc chắn**, chọn **Qwen3.6-27B** — cùng arch, cùng hạng
> VRAM, cùng tốc độ, hơn hẳn về mức đã kiểm chứng. Nếu ưu tiên **năng lực mới**, chọn Qwen3.8 nhưng
> **giữ roster cũ trên đĩa**. Vì hai model **cùng arch `qwen35`**, hạ tầng dựng cho model này **dùng lại
> nguyên vẹn** cho model kia — nên **quyết định này có thể đảo sau, chi phí gần bằng 0**.

---

## 7. Việc phải làm trước khi tải 17 GB

1. **Chủ dự án chọn** Qwen3.8-27B hay Qwen3.6-27B (§6.3).
2. **Quyết định nâng llama.cpp hay không** — chỉ cần nếu muốn bỏ sidecar VL-8B (giành ~6.940 MiB) hoặc
   muốn MTP. Đường nâng: `npx node-llama-cpp source download --release <tag> --gpu cuda`
   (cờ `--release` đã xác nhận có tại `dist/cli/commands/source/commands/DownloadCommand.js:37-40`)
   + thay `llama-server.exe` ngoài bằng build ≥ b10430.
3. **Hạ `GGUF_MAX_LOADED_MODELS`** (`.env:153`, nhớ luật N−1 ở §5.10) và nâng `GGUF_DEFAULT_CTX`
   (`.env:180`) **cùng lượt** đổi model — không tách.
4. **GIỮ nguyên** `GGUF_FIM_MODEL`, `GGUF_EMBED_MODEL`, `GGUF_RERANKER_MODEL`, `GGUF_VISION_*`.
5. Chỉ khi 1–4 xong: tải **Q4_K_M** (~17,8 GB). **Chưa cần** mmproj — vì thị giác còn bị chặn ba lớp (§3.1).

**Thứ tự thay đổi tối thiểu khi đã duyệt** (chi tiết `file:line` ở §5.11):
`.env:120/122/699` → `aiModelCard.ts:70-141` → `aiModelRouter.ts:332-341, 404-415` (đo lại ngưỡng) →
`aiGgufEngine.ts:3094-3155` (xác minh thẻ suy luận) → `models/manifest.json` + `models/README.md` +
`.continue/config.json` → i18n `aiLocalKnowledgeApi.ts:205-208` + 2 file client → nghiệm thu lại 9 điểm
GBNF (§5.8) → sửa fixture ≥ 22 file test.

**KHÔNG cần đụng:** `modelResolver.ts` (thuần env), `toGgufMessages` (không ghim template),
`vramEstimator` (đo theo file-size), `knowledge/*` (không đổi model nhúng).

---

## Nguồn

- [bartowski/Qwen3.8-27B-GGUF](https://huggingface.co/bartowski/Qwen3.8-27B-GGUF) · [file listing](https://huggingface.co/bartowski/Qwen3.8-27B-GGUF/tree/main)
- [lmstudio-community/Qwen3.8-27B-GGUF](https://huggingface.co/lmstudio-community/Qwen3.8-27B-GGUF)
- [ggml-org/Qwen3.8-27B-GGUF](https://huggingface.co/ggml-org/Qwen3.8-27B-GGUF)
- [Unsloth — Qwen3.8](https://unsloth.ai/docs/models/qwen3.8) · [Qwen3.6](https://unsloth.ai/docs/models/qwen3.6)
- [Vì sao tên arch là `qwen35`](https://huggingface.co/unsloth/Qwen3.5-27B-GGUF/discussions/12)
- [Đo 5090 — witcheer](https://x.com/witcheer/status/2088316316205907970) · [Đo 5090 — note.com](https://note.com/unco3/n/n50897cea0ae5?hl=en)
- [llama.cpp b10419](https://github.com/ggml-org/llama.cpp/releases/tag/b10419) · [docs/multimodal.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md)
- Đo cục bộ: `llama.cuda.b8390.dll`, `D:/SOURCES/16.AI/llama-cuda/{llama.dll,mtmd.dll,ggml-cuda.dll}`, `llama-server.exe --version` → `9814 (487a6cc16)`
