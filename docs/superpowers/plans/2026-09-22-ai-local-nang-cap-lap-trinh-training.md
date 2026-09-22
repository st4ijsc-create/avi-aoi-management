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

### B2 — Hồ sơ sampling theo (model, chế độ) (T2)
Bảng `SAMPLING_PROFILES` trong `aiModelRouter` cạnh hồ sơ hiệu năng: MoE nghĩ‑coding {0,6·0,95·20·0,0·presence 0·
repeat 1,0}, instruct {0,7·0,8·20·0,0·1,5·1,0}; client gửi **tường minh** mọi trường. **Cổng ra:** A/B 12 bài × 3 lượt,
cả M lẫn H; chỉ đổi mặc định khi ≥ cũ; ghi cả hai số vào README bộ đo.

### B3 — Ngữ cảnh 64k cho MoE (T3) + tái dùng KV
`-c 65536` (KV f16 +2,5 GiB, đo lại VRAM), `GGUF_MAX_CTX` suy từ `/props` lúc khởi động (không ghim); bật
`--cache-reuse`; nâng `TRAN_TOKEN_NGU_CANH_MA`/`TRAN_TOKEN_MUC_LUC` theo ctx thật. **Cổng ra:** H ≥ 78 % (thu hẹp
K2), TTFT lượt 2+ trong vòng tác nhân giảm đo được.

### B4 — Trần suy luận riêng (`--reasoning-budget`) + G18 thu hẹp
Thay "nới toàn bộ max_tokens" bằng trần riêng cho `<think>` (server hỗ trợ); G18 giữ vai lưới an toàn. **Cổng ra:**
0 G5‑D, token/lượt giảm không kèm giảm % (đo 3 lượt).

### B5 — MTP speculative decoding (T4)
Tải `Qwen3.6-35B-A3B-MTP` UD‑Q4_K_XL (21,3 GB), `--spec-type draft-mtp --spec-draft-n-max 2`. **Cổng ra:** H **bằng**
(±nhiễu) và tok/s tăng; nếu H giảm ⇒ không dùng, ghi số.

### B6 — Native tool‑calling của template (`tools`) dưới HITL
Cho model **đề xuất** chuỗi tool bằng định dạng nó được huấn luyện; HITL + 11 khuôn lệnh **không đổi** (thẻ duyệt là
đích của mọi lời gọi). Lợi: bớt bộ phân loại tự dựng, ít định tuyến sai kiểu G11/G13. **Cổng ra:** agentic 6/6 giữ;
tỷ lệ tool đúng trên 12 lệnh khác nhau ≥ hiện tại; 0 lệnh ngoài danh sách trắng chạy được.

### B7 — Sổ đo lượt (`ai_gateway_metrics`) mang `reasoningTokens`, `thinking`, `samplingProfile`, `modelId thật`
Để thanh trạng thái và bộ đo phân biệt "nghĩ 5k rồi trả 300" với "trả 5k". **Cổng ra:** cột mới có trong mọi hàng
lượt sinh mã; UI đọc được.

### B8 — Rút gọn `aiLocalKnowledgeService.ts` (7.163 dòng)
Tách: luồng sinh mã · luồng sửa/khối · vòng tool · KB‑QA · tạo khung — thành module có lưới riêng; không đổi hành vi
(lưới hiện có là hợp đồng). Làm **sau** B1–B4 để không trộn refactor với đổi hành vi.

## 3. Gói việc FRONTEND (lập trình — `/ai-coding-workspace`)

### F1 — Bảng "model đang nghĩ" (dùng `reasoning_content`)
Khung gập hiện chuỗi suy luận đang stream (read‑only, không lưu vào phiên), tách khỏi câu trả lời; nút "dừng nghĩ,
trả lời luôn" (gửi `reasoning-budget` ngắn cho lượt sau). Người lập trình thấy *vì sao* model chọn hướng đó — giá
trị lớn nhất của model biết nghĩ mà UI hiện đang vứt.

### F2 — Thanh trạng thái: thêm `reasoning tok` · tok/s **sinh** vs **nghĩ** · hồ sơ sampling · ctx đã dùng/trần
Từ B7. Giữ nguyên tắc "không biết ≠ 0", tuổi số.

### F3 — Bộ chọn chế độ theo lượt: **Nghĩ sâu / Cân bằng / Nhanh (không nghĩ)**
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

1. Tải GGUF‑MTP 21,3 GB (B5) — đồng ý tải để đo?
2. Chấp nhận ctx 64k làm mặc định nếu H tăng và VRAM còn ≥ 3 GB (B3)?
3. Bộ câu hỏi vàng cho R1: bắt đầu từ corpus nào (đề nghị `csharp-dotnet` + tài liệu máy ST4I)?
