# RÀ SOÁT TƯƠNG THÍCH — Qwen3.6‑35B‑A3B là model mặc định của AI Local (2026‑09‑22)

Mục đích: đối chiếu **tài liệu chính hãng** (model card Qwen, hướng dẫn Unsloth cho llama.cpp) với **cấu hình
đang chạy thật** — không phải với trí nhớ — để hệ thống *tương thích* và *phát huy tối đa* model. Mỗi mục có ba
cột: tài liệu nói gì · hệ đang làm gì (đo/đọc ở đâu) · kết luận + việc phải làm. Xếp theo **tác động lên tính
đúng đắn** trước, hiệu năng sau — đúng tiêu chí chủ dự án.

Nguồn: [Qwen/Qwen3.6-35B-A3B model card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B) ·
[Unsloth — Qwen3.6 run locally](https://unsloth.ai/docs/models/qwen3.6) · `llama-server --help` (b9814) ·
`/props` sống trên `:8091` · mã nguồn repo (dòng ghi kèm).

---

## 0. Tóm tắt điều hành — 5 việc, xếp theo tác động

| # | Việc | Tác động | Bằng chứng |
|---|---|---|---|
| **T1** | Các lượt gọi PHỤ (chọn tệp 512 tok · KB‑QA 220/900 tok · tạo khung · khối sửa) **không tắt được thinking** — `YeuCauSinhChu` không có `disableThinking` | 🔴 **đúng đắn**: lượt chọn tệp/KB‑QA trả **rỗng** trên model mới | live: 512 tok + thinking ⇒ `content ""`, `finish=length`, 2.061 ký tự suy luận |
| **T2** | Sampling sinh mã lệch tài liệu: temp **0,25** (khuyến nghị **0,6**), top_p **0,9** (0,95), repeat **1,05** (1,0), không gửi top_k/min_p, min_p mặc định server **0,05** (khuyến nghị 0,0) | 🟠 chất lượng/độ lặp | `aiCodingAgent.ts:274-276`, `aiLocalKnowledgeService.ts` (0,25), `/props` |
| **T3** | Trần ngữ cảnh 32.768 dùng **KV f16 = 2,5 GiB**; MoE chỉ có **2 KV head** ⇒ 65.536 chỉ tốn +2,5 GiB (còn 6,5 GiB) — kết luận "65k không nạp nổi" là của bản dày 27B, **không đúng cho MoE** | 🟠 hiệu năng/ngữ cảnh repo | header GGUF: 40 lớp × 2 KV × (256+256) × 2 B = 80 KiB/token |
| **T4** | MTP (speculative decoding) có sẵn: `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` UD‑Q4_K_XL **21,3 GB**, b9814 hỗ trợ `--spec-type draft-mtp` | 🟢 tốc độ (Unsloth: `--spec-draft-n-max 2`) | HF API + `--help` |
| **T5** | `--reasoning-budget`, `--cache-reuse`, `preserve_thinking`, native `tools` trong template — chưa dùng | 🟢 hiệu năng/agent | `/props.chat_template`: `enable_thinking` ✓ `preserve_thinking` ✓ `tools` ✓ `reasoning_effort` ✗ |

Đã đúng, không cần đổi: kiến trúc `qwen35moe` nạp trên b9814 · `enable_thinking` qua `chat_template_kwargs`
(đường chính thống, đã dùng ở `lapCoTatSuyLuan`) · G18 trần token theo lớp model + gợi ý tên · bộ phân loại ý định
đã `disableThinking:true` + trần 1.536 · `reasoning_content` **được tách** trên server này (đo sống) ⇒ G5‑D bắt được
· đầu dò VRAM nay smi‑first · embedder/reranker riêng, không đổi.

---

## 1. Thinking — công tắc có, nhưng phần lớn lượt gọi không với tới được

**Tài liệu:** Qwen3.6 **mặc định nghĩ**; tắt bằng `"enable_thinking": false` trong `chat_template_kwargs`; **không**
hỗ trợ soft‑switch `/think` `/no_think`. Khuyến nghị đầu ra **32.768 token** cho đa số câu hỏi; 81.920 cho bài
thi khó.

**Hệ đang làm:**
- Sinh mã (`streamCodingGenerate`): nghĩ BẬT, trần theo lớp (G18) — **đúng**.
- Bộ phân loại ý định: `disableThinking: true`, trần 1.536 (`intentClassifier.ts:1657-1661`) — **đúng**.
- **Mọi lượt qua `motLuotModel`** (`aiLocalKnowledgeService.ts:5021`): chọn tệp (`TRAN_TOKEN_CHON_TEP = 512`,
  `:4450`), tạo khung (8.000), khối sửa (4.000); **KB‑QA** (`numPredict` 220/900, temp 0,15): gọi `streamCodingModel`
  với `YeuCauSinhChu` — kiểu này **không có trường `disableThinking`** (`aiCodingAgent.ts:202-239`), nên cờ không
  bao giờ tới `ggufStream`.

**Đo sống (server MoE, prompt kiểu chọn tool, `max_tokens 512`):** `content: ""` · `reasoning_content` 2.061 ký tự ·
`finish_reason: length`. Tức **lượt chọn tệp trên model mới trả rỗng gần như chắc chắn**; KB‑QA 220 token còn tệ hơn.
Đây là lỗ đúng‑đắn lớn nhất còn lại sau khi đổi model.

**Việc phải làm (P1):** thêm `disableThinking?: boolean` vào `YeuCauSinhChu`, chuyển xuống `ggufStream`; đặt `true`
ở **mọi** lượt phụ (chọn tệp · KB‑QA · phân loại · trích xuất có cấu trúc); giữ nghĩ BẬT **chỉ** cho sinh mã / sửa mã /
tạo khung. Lưới: mỗi call site phụ phải có ca khẳng định `chat_template_kwargs.enable_thinking === false` trong body
(đo hợp đồng, không đo lời khai). Cùng lúc: `preserve_thinking` — tài liệu nói có thể giữ suy luận lịch sử; hệ đang cắt
`<think>` trước khi lưu phiên (`{role, content}`), tức **không** cần và không nên bật (tiết kiệm ngữ cảnh).

## 2. Sampling — đúng tài liệu cho từng chế độ, gửi tường minh, không dựa mặc định server

**Tài liệu (bảng chính hãng):**

| Chế độ | temp | top_p | top_k | min_p | presence | repeat |
|---|---|---|---|---|---|---|
| Nghĩ · **coding** | **0,6** | 0,95 | 20 | 0,0 | **0,0** | 1,0 |
| Nghĩ · tổng quát | 1,0 | 0,95 | 20 | 0,0 | 1,5 | 1,0 |
| Không nghĩ (instruct) | 0,7 | 0,80 | 20 | 0,0 | 1,5 | 1,0 |

Cảnh báo chính hãng: presence cao "có thể trộn ngôn ngữ và giảm nhẹ chất lượng"; chỉnh 0–2 để chống lặp vô hạn.

**Hệ đang làm:** gửi `temperature` + `top_p` + `repeat_penalty`; **không** gửi `top_k`/`min_p`/`presence_penalty`
(`aiLlamaServerClient.ts:615-616, 740-741, 1285`). Server điền mặc định: top_k 20 ✓, **min_p 0,05** (tài liệu 0,0),
presence 0, repeat 1. Sinh mã: temp **0,25**, top_p **0,9**, repeat **1,05** (`aiCodingAgent.ts:274-276`;
`streamCodingGenerate` 0,25). KB‑QA: temp 0,15, repeat `KB_QA_REPEAT_PENALTY`.

**Kết luận:** ba lệch so với "nghĩ · coding": temp thấp hơn 2,4× (0,25 vs 0,6 — model nghĩ ở temp thấp có xu hướng
lặp/kẹt chuỗi suy luận), top_p 0,9 vs 0,95, repeat 1,05 vs 1,0 (tài liệu tắt repeat, dùng presence để chống lặp),
min_p 0,05 vs 0,0. **Không đổi mù**: 83 % hôm nay đo ở bộ tham số cũ. **Việc phải làm (P2):** một hồ sơ sampling
theo *(model, chế độ)* — MoE nghĩ‑coding = {0,6 · 0,95 · 20 · 0,0 · presence 0 · repeat 1,0}; instruct =
{0,7 · 0,8 · 20 · 0,0 · 1,5 · 1,0} — gửi **tường minh** mọi trường (`top_k`, `min_p`, `presence_penalty`), rồi **đo A/B
trên bộ 12 bài × 3 lượt** trước khi đặt mặc định. Nếu A/B không hơn 83 % ± nhiễu, giữ cũ và ghi số.

## 3. Ngữ cảnh & KV — trần 32k là của model dày, không phải của MoE

**Tài liệu:** native **262.144** token; YaRN factor 4 tới ~1,01 M. Unsloth: UD‑Q4_K_XL 35B‑A3B ≈ 23 GB, "vừa 32 GB".

**Header GGUF (đọc thật):** 40 lớp · 16 Q‑head / **2 KV‑head** · key/value_length 256 ⇒ **KV f16 = 80 KiB/token**:

| ctx | KV f16 | KV q8_0 |
|---|---|---|
| 32.768 | 2,50 GiB | 1,25 GiB |
| 65.536 | 5,00 GiB | 2,50 GiB |
| 131.072 | 10,0 GiB | 5,00 GiB |

VRAM lúc này: 25,6 GB dùng / **6,55 GB trống** (MoE + CUDA context node ≈ 6,5 GB gồm embedder 0.6B + reranker).
⇒ **65.536 f16 vừa** (còn ~4 GB); 131.072 cần q8_0 KV (Unsloth chỉ gợi ý bf16 KV khi "gibberish", không cấm q8_0 —
phải đo chất lượng trước khi dùng). Kết luận cũ "65k không nạp nổi" đúng cho **Qwen3.6‑27B dày** (8 KV head), **sai**
cho MoE. `GGUF_MAX_CTX=32768` đang giới hạn `serverSlotContextTokens()`, `kiemNganSachNguCanh`, G18.

**Việc phải làm (P3):** nạp thử `-c 65536` (giữ f16), đo VRAM còn + H 3 lượt; nếu đạt ⇒ `GGUF_MAX_CTX=65536`,
`doi-model.ps1 -Ctx 65536` cho MoE. Lợi ích trực tiếp: ngữ cảnh repo (`TRAN_TOKEN_NGU_CANH_MA 4.000`,
`TRAN_TOKEN_MUC_LUC 6.000`) không còn phải nhường chỗ — đúng chỗ đang tạo khoảng cách H 75 % ↔ M 83 %.

## 4. Cờ llama‑server — có sẵn trong b9814, chưa dùng

| Cờ | Tài liệu / công dụng | Trạng thái | Việc |
|---|---|---|---|
| `--spec-type draft-mtp --spec-draft-n-max 2` | Unsloth: MTP tăng tốc, +~1 GB; cần GGUF‑MTP (**21,3 GB** có trên HF) | chưa | P4: tải, đo tok/s + H (đúng‑đắn phải **bằng**; MTP không đổi phân phối) |
| `--reasoning-budget N` | trần riêng cho khối `<think>` — thay vì G18 phải nới toàn bộ `max_tokens` | chưa | P5: đo có kết thúc nghĩ sạch không (`--reasoning-budget-message`) |
| `--cache-reuse N` | tái dùng KV cho prefix dịch — ngữ cảnh repo lặp lại giữa các lượt | chưa (prompt cache 8 GiB đã bật) | P5: đo TTFT trên vòng tác nhân |
| `--jinja` | b9814 đã mặc định jinja (template Qwen3.6 áp dụng đúng: `<|im_start|>`, thinking=1) | ok | — |
| `-ctk/-ctv q8_0` | giảm KV nửa | chưa cần ở 32k/64k | chỉ khi lên 131k |
| `-np 1` | 1 slot; `-c` là tổng | ok cho 1 người dùng | P6 nếu nhiều phiên đồng thời |
| `--presence-penalty` | tài liệu dùng thay repeat | gửi theo request (P2), không đặt toàn cục | — |

## 5. Tool‑calling & tác nhân

**Tài liệu:** "Qwen3.6 excels in tool calling"; parser `qwen3_coder` (vLLM/SGLang); template có `tools`.
**Hệ:** tool‑calling hiện là **tự dựng** (bộ phân loại ý định + JSON + thẻ HITL), không dùng native `tools` của template.
**Kết luận:** giữ HITL và danh sách trắng (hàng rào đã đo) — nhưng native tool‑calling là cách để model **tự đề xuất
chuỗi tool** với định dạng nó được huấn luyện; đây là hạng mục của kế hoạch nâng cấp (xem plan), không phải việc
tương thích khẩn.

## 6. Training/KB — model đổi có chạm gì không?

Đo bằng grep import + gọi: KB Studio/ingest chạm **embedder** (`Qwen3-Embedding-0.6B`), **reranker** (`bge-reranker-v2-m3`),
**thị giác** (`Qwen3-VL-8B` + mmproj, `describeImage`) — **không** chạm model sinh chữ ⇒ đổi model **không ảnh hưởng**
ingest/RAG. Ngoại lệ: `aiLlmFinetuneSidecar` (`startFinetune`) — **đang TẮT** (`LLM_FINETUNE_CMD` không đặt); bước
eval của nó gọi `generateText` **in‑process** với `maxTokens 200` lên GGUF ứng viên (`:563-565`) — với model biết nghĩ
sẽ trả rỗng (đúng hình dạng T1). Ghi vào plan: eval phải đi qua llama‑server + `disableThinking`.

## 7. Đầu dò VRAM & trạng thái (đã sửa hôm nay, nhắc để đủ bức tranh)

Native `getVramState()` là **của riêng tiến trình** dưới WDDM (6.489 vs 25.601 MiB); `vramProbe` nay smi‑first;
`trangThaiAiLocal` đọc tick thiết bị + tuổi (`vramTuoiMs`, nhịp 60 s). Với MoE dùng ~19–20 GB, headroom thật ~6,5 GB —
mọi quyết định ở §3/§4 phải đo lại VRAM sau khi nạp, không suy từ bảng.

## 8. Điều bản rà soát này KHÔNG kết luận

- Không khẳng định sampling chính hãng **cho điểm cao hơn** trên bộ bài của ta — phải A/B (P2).
- Không khẳng định 65k/131k **giữ chất lượng** — Unsloth cảnh báo "gibberish khi ctx đặt sai"; đo H sau khi nạp (P3).
- Không khẳng định MTP **không đổi đầu ra** trên llama.cpp b9814 — lý thuyết là không; phải đo H bằng nhau (P4).

Thứ tự thực hiện: **T1 → P2 (A/B) → P3 → P4 → P5**; T1 là điều kiện cần cho mọi thứ sau vì nó chặn lỗi *đúng đắn*.
