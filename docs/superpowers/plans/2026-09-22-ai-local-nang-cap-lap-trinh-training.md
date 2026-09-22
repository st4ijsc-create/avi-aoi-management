# KẾ HOẠCH — NÂNG CẤP & THIẾT KẾ LẠI AI LOCAL: LẬP TRÌNH và TRAINING (backend + frontend)

Ngày: 2026‑09‑22 · Chủ dự án duyệt tiêu chí **"đúng trước nhanh"** và giao toàn quyền kỹ thuật.
Phạm vi đợt này: **lập trình** (`/ai-coding-workspace`, đường ống sinh/sửa mã, tác nhân) và **training**
(`/ai-training-studio`, KB/corpus/ingest/eval). Các phần khác (`/ai-chat`, Brain, Agent Command…) → **session mới**.

Kế thừa: spec `2026-09-21-ai-local-lap-trinh-design.md` (G1–G10 ✅) · audit Phụ lục 1–7 (G11–G18 ✅) ·
rà soát tương thích `2026-09-22-ra-soat-tuong-thich-qwen3.6-35b-a3b.md` (T1–T5).

---

## 0. Bốn nguyên tắc ràng buộc mọi gói việc

1. **Đúng trước nhanh.** Không hạng mục nào được đổi chất lượng lấy tốc độ; tốc độ là dữ kiện báo cáo. Ngưỡng
   loại duy nhất: không nạp nổi phần cứng.
2. **Cơ chế thay cho cấu hình.** Cờ `.env` bị quên hỏng trong im lặng (đã cắn: `LLAMA_SERVER_MODEL`, trần 3.000).
   Mọi thứ phụ thuộc model phải **đo lúc chạy** hoặc **suy từ hồ sơ model** — không ghim hằng.
3. **Mọi con số kèm bằng chứng máy chạy.** Bộ đo hai trục (M/H) + ba dự án thật + `fake-ok/fake-bad` là cổng ra
   của từng gói; con số không có "cụt = 0" là con số chưa xong.
4. **Bề mặt sản phẩm nói sự thật thiết bị.** Model đang phục vụ, VRAM (thiết bị, có tuổi), tok/s, ngân sách, lý do
   từ chối — không có ô nào hiện "0" khi thật ra là "không biết".

Điểm xuất phát đo được (2026‑09‑22, model mặc định Qwen3.6‑35B‑A3B): trục M **83 %** · trục H **75 %** · ba dự
án **20/21** · 26,9 s/bài · 0 lượt chết vì đường ống.

---

## 1. Chẩn đoán — bốn khoảng trống có số

| # | Khoảng trống | Số đo | Gốc |
|---|---|---|---|
| K1 | Lượt gọi phụ **không tắt được thinking** ⇒ trả rỗng | 512 tok + nghĩ ⇒ `content ""` (đo sống) | `YeuCauSinhChu` không có `disableThinking` |
| K2 | Đường ống **bóp 8 điểm** so với model thuần (75 ↔ 83) | ngữ cảnh repo 4.000 + mục lục 6.000 tok phải nhường chỗ ở ctx 32k | ctx 32k là trần của model dày, MoE chịu 64k |
| K3 | Sampling **không theo tài liệu** và không gửi tường minh | temp 0,25/0,6 · min_p 0,05/0,0 · repeat 1,05/1,0 | không có hồ sơ sampling theo (model, chế độ) |
| K4 | Bộ đo và UI chưa đo/hiện **chuỗi suy luận** — thứ chiếm 5.000 tok và 27 s mỗi lượt | tok/s hiện là tổng; người dùng không thấy model đang nghĩ gì | `reasoning_content` bị cắt, không dùng |
| K5 | Training Studio: eval **chưa có** (EvalTab chỉ preview), ModelBuilder là panel **vô hiệu**, finetune **tắt** và eval của nó gọi in‑process 200 tok | `EvalTab` → chỉ `corpusPreview/listCorpora`; `LLM_FINETUNE_CMD` không đặt | chưa có vòng đo chất lượng RAG |

---

## 2. Gói việc BACKEND (lập trình)

### B1 — Công tắc nghĩ theo LỚP LƯỢT (T1) — ★ điều kiện cần
`YeuCauSinhChu.disableThinking` → `ggufStream`; đặt `true` cho **mọi** lượt phụ (chọn tệp, phân loại, trích xuất,
KB‑QA ngắn); nghĩ BẬT chỉ cho sinh/sửa/tạo khung. Một vị từ thuần `loaiLuot(...) → { nghi: boolean, tran: number }`
thay cho từng nơi tự quyết. **Cổng ra:** lưới hợp đồng — mỗi call site phụ khẳng định body có
`chat_template_kwargs.enable_thinking === false`; đo sống 0/12 lượt chọn tệp trả rỗng trên MoE.

> **Trạng thái 2026-09-22 (cùng ngày): ĐÃ LÀM, cổng ra đạt MỘT NỬA — và phép đo lật một giả định.**
> · `server/services/ai/loaiLuot.ts` (+12 lưới) · `motLuotModel` nhận `loai`, gửi `disableThinking: !nghi`,
>   trần theo lớp · KB‑QA và `warmModel` tắt nghĩ (warm với `maxTokens: 1` trên model nghĩ nổ G5‑D + 2 dòng lỗi
>   MỌI LẦN boot — đo trong `node-b1.err.log`) · hợp đồng: 3 lưới ở `aiCodingMode.stream.test` đo cờ THẬT tới engine.
> · **Đo sống** (`agentic.mjs`, dist B1, node PID 20536 → 35140): lớp PHỤ hết rỗng (A1 3/3, chọn tệp → khối sửa đi
>   được cả 6 lượt). **Nhưng lớp NGHĨ lộ lỗ mới**: `khoi-sua` trên A2 **tiêu hết 16.000 token vào `<think>`** rồi trả
>   rỗng — 1/6 lượt ở lần đo 1, **3/6 ở lần đo 2** (36.104 ký tự suy luận, `content` = ""). Giả định *"trần lớp nghĩ 16k
>   là đủ"* (G18) sai với lượt sửa có prompt lớn (tệp + test).
> · **Cầu chì G18‑B1** (cùng ngày): G5‑D ở lượt lớp NGHĨ, chưa phát ký tự ⇒ thử lại ĐÚNG MỘT lần với nghĩ TẮT (đòn bẩy
>   duy nhất còn lại khi trần đã là trần lớp nghĩ). Lưới: 3 ca (cầu chì · đối chứng lỗi thường · hồ sơ sampling đổi theo).
>   Đo sống sau cầu chì: agentic **4/6** (A1 3/3, A2 1/3; cả 3 lượt A2 đều kích cầu chì) so với 5/6 trước — bản sửa
>   không‑nghĩ ra được nhưng **không đủ đúng** cho A2 (ca qua nửa đêm). ⇒ Cầu chì là *thà có còn hơn rỗng*, không phải
>   lời giải. Lời giải nằm ở **B3 (ctx 64k ⇒ trần nghĩ 32k)** và/hoặc **B4 (`--reasoning-budget`)** — hai gói này lên
>   hạng ưu tiên, đo lại đúng A2 làm cổng ra. Nền so sánh cho A2 trên model này: 2/3 (lần 1), 1/3 (lần 2) — nhiễu lớn,
>   phải đo ≥ 3 lần × 3 lượt.
> · **Trục H sau B1** (dist 16:38, 12 bài × 3): **25/36 = 69 %** so 27/36 = 75 % trước — lệch −2 bài, đổi chiều ở 5 bài
>   (py2 −2, cs3 −1, py3 −1, py1 +1, ts2 +1) = **nhiễu 3 lượt**, không phải hồi quy (đường sinh mã không đổi một byte yêu
>   cầu). Đợt đo lộ **G19**: H‑cs3 trượt 5/6 qua hai đợt vì grep quá hạn 4 s ⇒ cầu chì G2 trả câu từ chối thay cho mã — vá
>   cùng ngày (`GREP_DEADLINE` vô can với đơn sinh mã). Xem audit Phụ lục 8.4b.

### B2 — Hồ sơ sampling theo (model, chế độ) (T2)
Bảng `SAMPLING_PROFILES` trong `aiModelRouter` cạnh hồ sơ hiệu năng: MoE nghĩ‑coding {0,6·0,95·20·0,0·presence 0·
repeat 1,0}, instruct {0,7·0,8·20·0,0·1,5·1,0}; client gửi **tường minh** mọi trường. **Cổng ra:** A/B 12 bài × 3 lượt,
cả M lẫn H; chỉ đổi mặc định khi ≥ cũ; ghi cả hai số vào README bộ đo.

> **Trạng thái 2026-09-22: ĐƯỜNG ỐNG XONG (B2a), A/B trục M XONG — chính hãng KHÔNG ≥ cũ; trục H đang đo.**
> · Đường ống: `GgufGenerateOptions.minP/presencePenalty` · `aiLlamaServerClient.lapCoSampling()` ở cả 5 builder (census:
>   `body.min_p`/`presence_penalty` đúng MỘT điểm ghi; số điểm gọi = số điểm gọi `lapCoTatSuyLuan`) · `ai/hoSoSampling.ts`
>   với cần gạt `AI_SAMPLING_PROFILE` (vắng ⇒ `hien-tai` trả NGUYÊN hồ sơ bên gọi — **không một con số nào đổi**) ·
>   `YeuCauSinhChu` +4 trường · sinh mã và `motLuotModel` đi qua `hoSoSamplingCho(hiệnTại, nghĩThật)` · `run.mjs --sampling`.
>   Đo `/props` :8091: server mặc định `min_p 0,05` ⇒ hồ sơ chính hãng chỉ THẬT khi client gửi số 0 tường minh.
> · **A/B trục M** (12 bài khó × 3 lượt, trần 16k, cùng máy/ngày):
>
>   | Sampling | Chạy được | Cụt | tok/bài | ms/bài |
>   |---|---|---|---|---|
>   | `hien-tai` (0,2 · 0,9 · server 20/0,05/0) | **30/36 = 83 %** | 0 | 5.665 | 30.346 |
>   | `chinh-hang` (0,6 · 0,95 · 20 · 0 · 0 · 1,0) | 28/36 = 78 % (chặn dưới; 1 cụt H‑py3) | 1 | 6.257 | 35.647 |
>
>   Theo bài: chính hãng thắng H‑cs3 (3/3 vs 2/3) và H‑py3 (2/3 vs 1/3), thua H‑cpp3 · H‑cs2 · **H‑ts3 (1/3 vs 3/3)**.
>   Nhiệt độ 0,6 làm chuỗi nghĩ dài hơn +10 % và chạm trần 16k một lần. ⇒ **KHÔNG ≥ cũ trên M** ⇒ theo cổng ra, mặc
>   định giữ `hien-tai`. Trục H (`H-q36moe-ch-*`, cần gạt qua `.env` + restart) vẫn đo cho đủ hai trục — kết luận
>   chỉ đổi nếu H chính hãng vượt rõ (> nhiễu 3 lượt ≈ ±2 bài).
> · **A/B trục H XONG (18:15): chính hãng 24/36 = 67 % so hiện tại 25/36 = 69 %** — cùng chiều M (H‑ts3 3/3 → 0/3).
>   **QUYẾT ĐỊNH B2: giữ `hien-tai`**, `.env` đã trả về mặc định; cần gạt + `--sampling` giữ lại làm dụng cụ A/B cho lần đổi
>   model sau. Cổng ra B2 ĐÓNG (đúng luật "chỉ đổi khi ≥ cũ, cả hai trục").

### B3 — Ngữ cảnh 64k cho MoE (T3) + tái dùng KV

> **Trạng thái 2026-09-22 18:50: ĐANG ĐO (một biến: ctx 32k → 64k, giữ B4 12k).** `.env GGUF_MAX_CTX=65536`,
> llama-server `-c 65536` (VRAM 25,85 → 26,41 GiB sau nạp; còn 6,2 GiB ≥ cổng 3 GB), node restart `node-b3`. Cổng ra: trục
> H ×3 so `H-q36moe-b4-12k-` (27/36) + agentic; H không tụt và VRAM giữ ⇒ 64k thành mặc định; sau đó mới nới
> `TRAN_TOKEN_NGU_CANH_MA`/`TRAN_TOKEN_MUC_LUC` (K2) và trần nghĩ 32k (nút "sâu" F3) — từng biến một.
>
> **Kết quả 19:08 — ĐẠT, cổng ra VƯỢT: 64k thành mặc định.**
>
> | Phép đo | ctx 32k (B4) | **ctx 64k** (B4 giữ) |
> |---|---|---|
> | Trục H 12 × 3 | 27/36 = 75 % · 26,8 s | **31/36 = 86 % · 28,3 s** (10 · 10 · 11) — **lần đầu H > M (83 %)** |
> | Theo bài | — | +cpp3 (2→3) · +py1 (2→3) · **+ts3 (0→2)** · +cpp 8→9/9; không bài nào tụt |
> | Agentic | 5/6 | 5/6 (A2 2/3) |
> | G5‑D / G18‑B1 | 0 | 0 |
> | VRAM (llama-server + node) | 25,6–25,8 GiB | **26,5 GiB** ⇒ còn 6,1 GiB ≥ cổng 3 GB |
>
> Chỉ MỘT biến đổi (`-c 65536` + `GGUF_MAX_CTX=65536`); trần nghĩ vẫn 16k, sampling `hien-tai`. **Nguyên nhân H tăng CHƯA
> TÁCH** — giả thuyết: ngân sách ngữ cảnh/trần kẹp theo `ggufMaxCtx()` rộng hơn; nhưng cũng có thể là nhiễu 3 lượt cộng
> dồn (4 bài đổi chiều cùng một hướng là hiếm, không phải không thể). Ablation ngữ cảnh repo (K2, 20:00) sẽ tách phần này.
> ⇒ `GGUF_MAX_CTX_DEFAULT` 32768 → **65536** (chủ dự án đã duyệt điều kiện "H tốt hơn + VRAM ≥ 3 GB"). Launcher sản xuất
> (`start-llama-server.ps1`, mặc định `-np 2 -c 65536` = 32k/slot) **chưa đổi** — 64k/slot × 2 slot cần thêm 5 GiB KV; đưa
> vào mục 8 để chủ dự án chọn 1 slot × 64k hay 2 × 32k.
`-c 65536` (KV f16 +2,5 GiB, đo lại VRAM), `GGUF_MAX_CTX` suy từ `/props` lúc khởi động (không ghim); bật
`--cache-reuse`; nâng `TRAN_TOKEN_NGU_CANH_MA`/`TRAN_TOKEN_MUC_LUC` theo ctx thật. **Cổng ra:** H ≥ 78 % (thu hẹp
K2), TTFT lượt 2+ trong vòng tác nhân giảm đo được.

### B4 — Trần suy luận riêng (`--reasoning-budget`) + G18 thu hẹp

> **Trạng thái 2026-09-22 18:19: ĐANG ĐO (lên hạng sau phát hiện B1).** llama-server b9814 khởi động lại với
> `--reasoning-budget 12000` (ctx 32k, model/sampling y nguyên; log xác nhận *"reasoning-budget: activated, budget=12000"*
> — `/props` KHÔNG lộ cờ này, phải đọc log). Cổng ra: agentic **A2 ×3** (nền 2/3 → 1/3, cả 3 lượt A2 kích G18‑B1 ở 16k) +
> trục H ×3 so `H-q36moe-b1-` (25/36). Kỳ vọng: 0 G5‑D/G18‑B1 trên `khoi-sua`; nếu H tụt > 2 bài ⇒ ngân sách 12k cắt
> nghĩ quá sớm ⇒ thử 14k hoặc bỏ. Kịch bản: `tmp/audit-ai/do-h-agentic.sh b4-12k node-b4`.
>
> **Kết quả 18:40 — ĐẠT, ÁP DỤNG:**
>
> | Phép đo | Trước (B1 + cầu chì, không ngân sách) | `--reasoning-budget 12000` |
> |---|---|---|
> | G5‑D / G18‑B1 trên `khoi-sua` (agentic 6 lượt) | **3/6** | **0/6** |
> | Agentic (2 lần × 6 lượt) | 4/6 (A2 1/3) | **5/6 và 5/6 (A2 2/3 ×2)**, 0 G5‑D trên 12 lượt |
> | Trục H 12 × 3 | 25/36 = 69 % · 39,9 s/bài | **27/36 = 75 % · 26,8 s/bài** (= mức trước B1) |
> | Lượt bị ép kết thúc ở 12k | — | **2/87** (cả hai là `khoi-sua` A2, vẫn ra bản sửa); **0/36 lượt H** (max nghĩ 8.596) |
>
> Số theo hàng `ai_gateway_metrics.reasoningTokens` (B7) — không phải suy đoán. Ngân sách 12k **không chạm** lượt sinh mã
> nào của bộ khó, chỉ chạm hai lượt sửa chạy trốn ⇒ đúng vai "trần suy luận riêng". Cờ đưa vào `doi-model.ps1` làm mặc
> định (`-NganSachNghi 12000`, `-1` để A/B). Còn mở: H‑ts3 0/3 ở đợt này (không bị cắt: nghĩ 4–4,5k) — cùng bài tụt ở
> chính hãng; nghi ngữ cảnh repo trong prompt (K2) — đo riêng ở B3.
Thay "nới toàn bộ max_tokens" bằng trần riêng cho `<think>` (server hỗ trợ); G18 giữ vai lưới an toàn. **Cổng ra:**
0 G5‑D, token/lượt giảm không kèm giảm % (đo 3 lượt).

### B5 — MTP speculative decoding (T4)

> **Trạng thái 2026-09-22 19:30: ĐANG ĐO.** GGUF MTP chính hãng (`unsloth/Qwen3.6-35B-A3B-MTP-GGUF` UD‑Q4_K_XL, 21,28 GB, có
> `nextn_predict_layers`) nạp lên `:8091` với `--spec-type draft-mtp --spec-draft-n-max 2`, ctx 64k, ngân sách nghĩ 12k — chỉ đổi
> model+cờ, mọi thứ khác giữ. Ba khoá `.env` trỏ tên tệp MTP (bẫy `LLAMA_SERVER_MODEL` lệch ⇒ lùi in‑process ⇒ OOM). Cổng ra:
> H ×3 so `H-q36moe-64k-` (31/36) — **đúng ≥ −1 bài (nhiễu) và ms/bài giảm rõ** ⇒ giữ; đúng tụt ⇒ bỏ (tốc độ không mua được đúng).
>
> **Kết quả 19:50 — KHÔNG ÁP DỤNG.** MTP `draft-mtp n_max=2` (log: *"speculative decoding context initialized"*, +0,7 GiB VRAM):
>
> | | ctx 64k không MTP | **MTP** |
> |---|---|---|
> | Trục H 12 × 3 | **31/36 = 86 %** · 28,3 s/bài | **27/36 = 75 %** · 25,6 s/bài (−9 %) |
> | Theo bài | | **cpp3 3/3 → 0/3**, py1 3→1, py2 3→2; ts1 2→3, cs3 2→3 |
> | Agentic | 5/6 | **4/6** (A2 1/3) |
>
> Nhanh hơn 9 % nhưng **tụt 4 bài** (vượt xa nhiễu ±2) — tốc độ không mua được đúng. Nghi vấn: giải mã suy đoán với sampling
> ngẫu nhiên (temp 0,25) không bảo toàn phân phối hoàn hảo ở n_max=2, hoặc bản GGUF MTP khác biệt lượng tử hoá; chưa tách nguyên nhân
> — không đáng công khi lợi chỉ 9 %. Đã trả `.env` và `:8091` về bản không‑MTP ctx 64k. Cờ `-ThemArgs` giữ để đo lại khi
> b98xx nâng MTP hoặc cần tốc độ cho chế độ "nhanh" (không nghĩ).
Tải `Qwen3.6-35B-A3B-MTP` UD‑Q4_K_XL (21,3 GB), `--spec-type draft-mtp --spec-draft-n-max 2`. **Cổng ra:** H **bằng**
(±nhiễu) và tok/s tăng; nếu H giảm ⇒ không dùng, ghi số.

### B6 — Native tool‑calling của template (`tools`) dưới HITL
Cho model **đề xuất** chuỗi tool bằng định dạng nó được huấn luyện; HITL + 11 khuôn lệnh **không đổi** (thẻ duyệt là
đích của mọi lời gọi). Lợi: bớt bộ phân loại tự dựng, ít định tuyến sai kiểu G11/G13. **Cổng ra:** agentic 6/6 giữ;
tỷ lệ tool đúng trên 12 lệnh khác nhau ≥ hiện tại; 0 lệnh ngoài danh sách trắng chạy được.

### B7 — Sổ đo lượt (`ai_gateway_metrics`) mang `reasoningTokens`, `thinking`, `samplingProfile`, `modelId thật`
Để thanh trạng thái và bộ đo phân biệt "nghĩ 5k rồi trả 300" với "trả 5k". **Cổng ra:** cột mới có trong mọi hàng
lượt sinh mã; UI đọc được.

> **Trạng thái 2026-09-22: ĐÃ LÀM (chờ nghiệm thu sống sau lần restart kế).**
> · Migration **0358** (viết tay, áp dev+test cục bộ bằng `scripts/apply-migration-0358.mjs`, 3 phép đo — cột/kiểu/
>   NULLABLE, quyền `avi_app` + hàng không có ba cột ra **NULL không 0**, sổ migration) + `drizzle/schema/ai.ts`.
> · Nguồn số: `aiLlamaServerClient` đếm **sự kiện SSE mang `reasoning_content`** ⇒ `tokensReasoning` trên chunk `done`
>   (server không trả riêng số token nghĩ; `completion_tokens` GỘP). `undefined` = đường không đếm được (in‑process).
> · `aiGateway.InferenceOutcome/MetricRow/toRow/flush` mang `reasoningTokens · thinking · samplingProfile` — vắng ⇒
>   `NULL`; rác (âm/NaN/quá dài) ⇒ NULL/cắt 24. Lưới `aiGateway.b7.test.ts` (5) đo HÀNG THẬT vào `insert().values()`.
> · `streamCodingModel` ghi ba số vào sổ đo và gọi `onUsage` ⇒ **sự kiện SSE `usage`** (kiểu mới trong `StreamEvent`,
>   phát trước `done`, thuần bổ sung) ở cả `motLuotModel` và lượt sinh mã. `thinking`: tắt tường minh ⇒ `false`; có
>   suy luận đếm được ⇒ `true`; không đếm được ⇒ `null` (không biết ≠ không nghĩ).
> · **Cổng ra ĐẠT sống (17:57, node PID 41716):** hai lượt sinh mã đầu ghi `reasoningTokens` 5.494 / 3.667, `thinking = true`,
>   `samplingProfile = chinh-hang`, `model` = id thật; hàng đầu 4.075 vào → 6.368 ra trong đó **5.494 nghĩ, 874 mã**. 0 lỗi INSERT.

### B8 — Rút gọn `aiLocalKnowledgeService.ts` (7.163 dòng)
Tách: luồng sinh mã · luồng sửa/khối · vòng tool · KB‑QA · tạo khung — thành module có lưới riêng; không đổi hành vi
(lưới hiện có là hợp đồng). Làm **sau** B1–B4 để không trộn refactor với đổi hành vi.

## 3. Gói việc FRONTEND (lập trình — `/ai-coding-workspace`)

### F1 — Bảng "model đang nghĩ" (dùng `reasoning_content`)

> **Trạng thái 2026-09-22 18:55: ĐÃ LÀM, lưới xanh, chờ nghiệm thu sống sau chuỗi đo B3.**
> · Đường đi: `aiLlamaServerClient` phát chunk **`reasoning`** ngay khi có `delta.reasoning_content` (không đợi `done`) →
>   `streamCodingModel` che bí mật bằng bộ che RIÊNG rồi yield **đối tượng `{ suyLuan }`** (không phải chuỗi — `rutChuCoCanh`
>   chỉ gom chuỗi, `daPhat` chỉ đếm chuỗi ⇒ luật G1/cầu chì G18‑B1 vẫn đúng khi model đã nghĩ 10k) → `motLuotModel` và
>   lượt sinh mã yield SSE **`reasoning`** (kiểu mới, thuần bổ sung) → `useKbChatStream.streamingReasoning`/`onReasoning`
>   → `<BangDangNghi>`: hiện ĐUÔI 1.200 ký tự + tổng, mở khi chưa có mã, tự gấp khi mã chảy, người bấm thắng.
> · Lưới: client §9 (2: thứ tự `reasoning`→`token`, chỉ‑suy‑luận vẫn ném G5‑D với `daPhatChu=false`), stream test +3 (qua
>   SERVICE: `reasoning` trước `token`, bí mật `sk_live_…` trong suy luận bị che, không lẫn vào câu trả lời; hợp đồng agent;
>   cầu chì vẫn thử lại sau khi đã có suy luận), `bangDangNghiLogic.unit` 6.
> · Ghi nhận: bộ che bí mật GIỮ ĐỆM xuyên mảnh ⇒ suy luận lên màn trễ vài mảnh so với server (đổi lấy việc bắt bí mật bị chẻ) —
>   đo độ trễ ấy ở nghiệm thu sống. Không lưu suy luận vào phiên (hiện vật của LƯỢT).
> · **Nghiệm thu sống 19:22 (`tmp/audit-ai/f1-live.mjs`, đường ống thật):** thứ tự `meta → tool_loop → tool → reasoning (5,5 s)
>   → token (26,9 s) → usage → done`; **3.774 sự kiện `reasoning` = 13.285 ký tự** tới client TRONG lúc nghĩ; `usage`
>   {sinh‑ma · vào 788 · ra 4.290 · **nghĩ 4.055** · thinking true · hien‑tai · 23,2 s · ctxMax 65.536}. **Lần thăm dò đầu
>   (19:14) là 0 sự kiện** — route `/api/ai/local-kb/stream` có `switch` danh sách trắng nuốt `usage`/`reasoning` (và F2 chưa
>   từng hiện số thật vì thế). Vá + census `aiLocalKnowledgeApi.sseCensus.test.ts` (mọi kiểu `StreamEvent` phải có `case`;
>   lộ thêm 2 kiểu `agent_plan`/`agent_step` khai mà không ai phát/đọc — ứng viên xoá ở B8).
Khung gập hiện chuỗi suy luận đang stream (read‑only, không lưu vào phiên), tách khỏi câu trả lời; nút "dừng nghĩ,
trả lời luôn" (gửi `reasoning-budget` ngắn cho lượt sau). Người lập trình thấy *vì sao* model chọn hướng đó — giá
trị lớn nhất của model biết nghĩ mà UI hiện đang vứt.

### F2 — Thanh trạng thái: thêm `reasoning tok` · tok/s **sinh** vs **nghĩ** · hồ sơ sampling · ctx đã dùng/trần
Từ B7. Giữ nguyên tắc "không biết ≠ 0", tuổi số.

> **Trạng thái 2026-09-22: ĐÃ LÀM phần đo được, NÓI THẲNG phần chưa.**
> · `useKbChatStream`: `onUsage` + `bocUsage()` (gói hỏng ⇒ bỏ, không dựng ô 0; `tokensReasoning` vắng giữ VẮNG) —
>   3 lưới. `AICodingWorkspace` giữ lượt cuối ⇒ `ThanhTrangThaiAiLocal dungLuot=…`.
> · Hai ô mới: **nghĩ/sinh** (`tachNghiSinh`: sinh = ra − nghĩ; không đếm được ⇒ hiện "(gộp)", không giả là sinh) và
>   **ctx %** (`(vào+ra)/trần`, ngưỡng 85/95 rút từ ca G5‑D 16k). Tooltip mang model · lớp lượt · hồ sơ sampling ·
>   nghĩ TẮT/có/không đo được · tok/s.
> · **Chưa làm và nói rõ trong tooltip:** *tok/s **sinh** vs **nghĩ*** — server chỉ có tổng thời gian, không có
>   timings từng pha; hiện tốc độ GỘP. Tách được khi client đo mốc thời gian sự kiện `reasoning_content` cuối cùng
>   (vòng sau, cùng chỗ đếm `soDeltaSuyLuan`). Lưới: +6 ca `ThanhTrangThaiAiLocal.unit`.

### F3 — Bộ chọn chế độ theo lượt: **Nghĩ sâu / Cân bằng / Nhanh (không nghĩ)**

> **Trạng thái 2026-09-22: ĐÃ LÀM HAI NÚT THẬT, cố ý CHƯA bày nút thứ ba.**
> · Đường đi: `<select data-chon-che-do-nghi>` (nhớ `localStorage repoWs.cheDoNghi`) → `context.cheDoNghi` → cửa
>   `aiLocalKnowledgeApi` lọc danh sách TRẮNG `locCheDoNghi` (chỉ 3 literal, không chuẩn hoá) → `KbQueryContext.cheDoNghi`
>   → `motLuotModel.ghiDe` (khoi-sua · sua-tep · tao-khung) và lượt sinh mã (`disableThinking: true` khi `nhanh`).
>   `luotDuocNghi(loai, ghiDe)` là điểm ghi đè DUY NHẤT. Lưới: `loaiLuot.cheDo.test` (5) + 4 ca qua SERVICE trong
>   `aiCodingMode.stream.test` (nhanh ⇒ sinh mã tắt nghĩ; nhanh trên dòng sửa ⇒ MỌI lượt tắt và bản sửa vẫn ra; nhanh +
>   chinh‑hang ⇒ hồ sơ không‑nghĩ; `sau` ≡ mặc định).
> · **"Sâu" chưa có nút**: hôm nay trần lớp nghĩ 16k đã là trần cứng ở ctx 32k ⇒ "sâu" không làm gì khác "cân bằng" — bày
>   một nút vô hiệu là lớp lỗi *"cờ khai mà vô hiệu"*. Kiểu `CheDoNghi` đã có `"sau"`; nút xuất hiện cùng B3 (64k ⇒ trần
>   nghĩ 32k), khi nó có nghĩa đo được.
> · **Nghiệm thu sống ĐẠT** (18:00, headless Chromium, `tmp/audit-ai/ui-f2f3.mjs`): hai bộ chọn hiện, đổi chế độ nhớ
>   `localStorage`, 0 lỗi trang. Kèm: nhãn "model: Coder" đã cũ ⇒ lấy từ `modelDangDung.modelId`. **Nợ i18n en/zh** cho
>   `ttAiLocal.*`/`repoWs.nghiPick.*` (giao diện tiếng Anh đang hiện nhãn tiếng Việt cho cả dải) — gộp vào F4–F6.
Thay cặp "auto | Coder" bằng ba chế độ có nghĩa với model mới; mặc định *Nghĩ sâu* (đúng trước nhanh); hiện ước
lượng thời gian từ số đo (27 s / 5 s). Chế độ → (thinking, sampling profile, trần) qua vị từ B1, không phải chuỗi if.

### F4 — Thẻ diff & thẻ duyệt: hiện **lý do** model (từ `reasoning_content` đã cắt gọn) cạnh diff
Duyệt có ngữ cảnh: "vì sao sửa dòng này". HITL không đổi.

### F5 — Khung "Lệnh & Nhật ký": lịch sử lượt + `exit code` + thời lượng + lọc; nút "chạy lại kiểm chứng"
Hoàn tất hướng đã bắt đầu (G17).

### F6 — Chỉ số phiên: số lượt · token vào/ra/nghĩ · thời gian · số lần từ chối (và lý do mã máy)
Một hàng cuối phiên; xuất JSON cho bộ đo.

## 4. Gói việc TRAINING (`/ai-training-studio`) — backend + frontend

### R1 — EvalTab thật: bộ câu hỏi vàng theo corpus, chạy RAG qua đường ống thật, chấm bằng máy
Backend `kbStudio.evalCorpus`: cho mỗi corpus một `golden.jsonl` (câu hỏi · đáp án kỳ vọng · tệp nguồn kỳ vọng);
chạy retrieve → rerank → (tuỳ chọn) sinh; chấm: **trúng nguồn** (tệp kỳ vọng nằm trong top‑K) và **đúng đáp án**
(so khớp có cấu trúc / số / regex — không chấm bằng LLM ở bước đầu). Kết quả lưu theo lượt, so **trước/sau ingest**.
Frontend: bảng câu hỏi × đúng/sai × nguồn, biểu đồ trước/sau. **Cổng ra:** corpus mẫu (ST4I) ≥ 20 câu; chạy 3 lượt
ổn định; `fake-bad` (corpus rỗng) phải 0 %.

### R2 — Nguồn dữ liệu lập trình: ingest **tham chiếu API** có cấu trúc
Từ phát hiện D1 (`GetInt32(string)` — sai tầng API): corpus `csharp-dotnet` nên nhận **tài liệu API** (XML doc /
docs.microsoft dạng markdown) với chunk theo *ký hiệu* (class.method) chứ không theo 512 token trơn; chân nguồn
trích đúng ký hiệu. **Cổng ra:** R1 với 10 câu hỏi API C# → trúng nguồn ≥ 8/10; bài D1 C# 2/3 → 3/3.

### R3 — ModelBuilderTab: thành **"Hồ sơ model"** thật thay panel vô hiệu
Hiện model đang phục vụ, hồ sơ router (đo tại chỗ / thừa kế), sampling profile, ctx, các trục đo mới nhất (M/H/dự
án) — đọc từ B7 + reports. Finetune (LoRA) **để sau**: G9 đã kết luận bằng số LoRA không chữa lỗi suy luận; khi bật
lại, eval của sidecar phải đi qua llama‑server + `disableThinking` (K5).

### R4 — Jobs: tiến độ ingest thật (chunk/đoạn/ảnh) + cảnh báo "PDF quét ảnh ra 0 đoạn" thành cảnh báo **máy**
Chuyển lời dặn trong hướng dẫn thành kiểm tự động sau ingest (0 chunk ⇒ badge đỏ + lý do).

### R5 — Gọn bề mặt: hướng dẫn gấp (đã làm G16) → **checklist 4 bước có trạng thái** đọc từ dữ liệu thật
(đã có corpus? đã ingest? đã eval? điểm?).

## 5. Đo lường & cổng ra chung

- Bộ đo `codegen-chay-duoc`: thêm cột `reasoningTok`, `nghi`, `samplingProfile`; `so-sanh.mjs` in kèm.
- Mọi gói đổi hành vi model (B1–B5) phải có **M và H 3 lượt** trước/sau, `cụt = 0`, và ba dự án thật.
- UI: mỗi ô mới có lưới `renderToStaticMarkup` + một phép đo sống (Playwright) so với nguồn thật (nvidia‑smi, /props).
- Không gói nào được commit khi lưới census (`vramAllocationSites`, i18n `viStringCoverage` phần mình) tăng nợ.

## 5b. Tổng kết đợt 1 (2026-09-22 chiều–tối) — số cuối và những gì để lại

| Gói | Kết cục | Số đo cuối (12 bài khó × 3, đường ống thật) |
|---|---|---|
| B1 công tắc nghĩ theo lớp | XONG + cầu chì G18‑B1 | lớp PHỤ hết rỗng; lộ `khoi-sua` nghĩ hết 16k ⇒ B4 |
| B2 sampling chính hãng | **KHÔNG áp dụng** (đo cả M lẫn H) | M 78 % vs 83 % · H 67 % vs 69 % ⇒ giữ `hien-tai`; cần gạt giữ lại |
| B4 `--reasoning-budget 12000` | **ÁP DỤNG** | G5‑D 3/6 → 0/12 · agentic 5/6 ×2 · H 75 % · 0/36 lượt H bị cắt |
| B3 ctx 64k | **ÁP DỤNG** (`GGUF_MAX_CTX_DEFAULT` 65536) | **H 86 %** (31/36), không bài nào tụt, VRAM còn 6,1 GiB |
| B7 sổ đo nghĩ/trả | XONG + sống | mig 0358; hàng thật "5.494 nghĩ / 874 mã" |
| F2 thanh trạng thái | XONG + sống | "2061 nghĩ · 309 sinh · ctx 10 %" |
| F3 bộ chọn chế độ nghĩ | XONG (2 nút) + sống | "sâu" chờ trần nghĩ 32k |
| F1 bảng đang nghĩ | XONG + sống | reasoning tới client sau 5,5 s; bảng hiện sau 3,9 s |
| G19 grep quá hạn nuốt đơn sinh mã | VÁ | H‑cs3 0/3 → 2/3 |
| B5 MTP | **KHÔNG áp dụng** | H 75 % vs 86 % (cpp3 3→0), agentic 4/6, chỉ nhanh hơn 9 % |

Đường ống đi từ **75 % (sáng) → 86 % (tối)** trên cùng bộ bài, cùng model, không đổi trần nghĩ hay sampling — bằng ba việc
đo được: tắt nghĩ lớp phụ, ngân sách nghĩ, và ngữ cảnh 64k. Hai commit: `b3906cee1`, `be8046a5c`.

**Để lại cho phiên sau (theo thứ tự đề nghị):**
1. ~~**K2 — cổng liên quan cho ngữ cảnh repo**~~ — **ĐÃ ĐO 20:38 và BỊ BÁC.** Giả thuyết: đơn sinh mã không neo vào repo ⇒ bỏ
   truy hồi. Ablation tắt hẳn ngữ cảnh (cùng ctx 64k + budget 12k): **27/36 = 75 % so 31/36 = 86 % có ngữ cảnh** — py2 3→1,
   py3 2→0, ts3 2→0 (cs3/ts1 +1); agentic 6/6 (n=1). Ngữ cảnh repo **giúp đúng ngay cả khi lạc chủ đề** — giả thuyết còn lại:
   khối mã thật làm mồi phong cách + persona "mã thật đứng trên trí nhớ" chỉ bật khi có ngữ cảnh. Vị từ `cauCoNeoRepo` đã viết
   (9 lưới, hai phiên bản bị lưới bác: camelCase làm neo · "giống" trần) và **đã xoá** — ghi ở docblock điểm gọi
   `thuThapNguCanhMa`. Việc kế đúng: ablation "persona giữ, khối mã rỗng" để tách hai hiệu ứng; và giải thích cho B3 (64k)
   nay có thêm nghi vấn: 64k ⇒ khối ngữ cảnh đầy hơn ⇒ đúng hơn — cùng chiều với ablation này.
2. **Trần nghĩ 32k + nút "sâu" (F3)** ở ctx 64k — cổng ra: A2 ×3, H không tụt, ms/bài báo thật.
3. **`TRAN_TOKEN_NGU_CANH_MA` 4.000 / `TRAN_TOKEN_MUC_LUC` 6.000** ở 64k — từng biến một.
4. ~~**i18n en/zh** cho `ttAiLocal.*`, `repoWs.nghiPick.*`, `repoWs.nghi.*`~~ — **XONG 20:30**: +47 khoá × 3 locale (chèn văn bản
   giữ CRLF, `tmp/audit-ai/i18n-chen.mjs`, JSON parse lại OK, 6 lưới i18n xanh); `repoWs.modelPick.code` nay "model: tầng mã" /
   "code tier" / "代码层" thay "Coder".
5. **F4** pill "đã nghĩ N token · xem" sau lượt + lý do model cạnh diff; **F5/F6**; **B6** native tools dưới HITL; **B8** rút gọn
   service (xoá `agent_plan`/`agent_step` chết).
6. **Training (R1–R5)** ở phiên riêng như chủ dự án đã định: corpus vàng csharp‑dotnet + ST4I, EvalTab thật.
7. Quyết định launcher sản xuất 1 × 64k hay 2 × 32k (mục 8).

## 6. Thứ tự & lý do

1. **B1** (đúng đắn — chặn trả rỗng) → 2. **B7 + F2** (đo được mới quyết được) → 3. **B2** (A/B sampling) →
4. **B3** (64k, thu hẹp K2) → 5. **F1 + F3** (giá trị của model biết nghĩ ra tay người dùng) → 6. **B4, B5** (hiệu năng
có đo) → 7. **R1, R2** (training có vòng đo thật) → 8. **B6** (native tools) → 9. **F4–F6, R3–R5** → 10. **B8** (refactor).

Ước lượng: mỗi gói B/F/R là 0,5–1,5 ngày đo‑và‑vá theo nhịp hôm nay; B1+B7+F2 là đợt đầu.

## 7. Điều kế hoạch này KHÔNG hứa

- Không hứa H = M: một phần chi phí đường ống (persona + ngữ cảnh) là **giá trị** (không bịa, có nguồn), không phải
  lãng phí.
- Không hứa MTP tăng tốc trên mọi lượt — phụ thuộc phần cứng, đo rồi mới giữ.
- Không hứa LoRA — G9 đã đóng bằng số; chỉ mở lại khi có lớp lỗi *quy ước repo* đo được, không phải lỗi suy luận.
- Không đụng `/ai-chat`, Brain, Agent Command trong đợt này — session mới.

## 8. Việc cần chủ dự án quyết

> **Bổ sung 2026-09-22 tối (sau B3):** launcher sản xuất `scripts/ai/start-llama-server.ps1` mặc định `-np 2 -c 65536` = **2 slot × 32k**.
> Phép đo B3 (H 75 % → 86 %) chạy trên **1 slot × 64k**. Muốn 64k/slot mà giữ 2 slot cần `-c 131072` = thêm ~5 GiB KV (còn ~1 GiB
> trên card 32,6 GiB — quá mép). Chọn: **(a) 1 × 64k** (đúng cấu hình đã đo; một người dùng tại một thời điểm — hai yêu cầu song song
> sẽ xếp hàng) hay **(b) 2 × 32k** (song song, nhưng mất +11 điểm H). Đề nghị (a) cho máy trạm một người; đặt qua `.env`
> `LLAMA_SERVER_SLOTS=1` + `LLAMA_SERVER_CTX_TOTAL=65536`, không đổi mặc định launcher cho tới khi chủ dự án chốt.

1. Tải GGUF‑MTP 21,3 GB (B5) — đồng ý tải để đo?
2. Chấp nhận ctx 64k làm mặc định nếu H tăng và VRAM còn ≥ 3 GB (B3)?
3. Bộ câu hỏi vàng cho R1: bắt đầu từ corpus nào (đề nghị `csharp-dotnet` + tài liệu máy ST4I)?
