# PDCA — trợ lý vận hành, đo KẾT CỤC đầu–cuối trên 111 câu ST4I (2026-09-24)

Đầu vào: §8 "vòng sau" của `2026-09-24-xu-ly-viec-con-mo-ai-local.md` — (1) câu trong corpus không ra nguồn đúng,
(2) câu lạc đề cùng miền lọt ngưỡng 0,44. Cả hai trước đây đo bằng chỉ số **truy hồi**; vòng này đo thứ người dùng
**nhận**: câu trả lời cuối của `/api/ai/local-kb/stream` (route `/ai-chat`).
Tệp thô và chấm tay: `docs/superpowers/reports/pdca-kb-dau-cuoi-2026-09-24/`. Công cụ: `scripts/ai-eval/kb-dau-cuoi.mjs`.
Commit bản vá: `965dcc5f4`.

## 1. Bước 0 — kiểm hệ đo

| Kiểm | Kết quả |
|---|---|
| Bản đang chạy khớp mã? | Dist `c95515a5d`. Khác HEAD phía server: chú thích + `featureStore.ts` (`4027217bd`, ngoài đường trợ lý) |
| Kho đang phục vụ | 6.310 đoạn (health), đúng ảnh chụp `73b56fd1c` |
| Cache ở giữa | `answerCache` 10 phút ⇒ **tắt bằng `KB_QA_CACHE_TTL_MS=0`** suốt lượt đo; bật lại khi xong |
| Phép đo tự thoả? | Chấm bằng regex đáp án + câu từ chối chuẩn, độc lập với đường sinh |
| Vùng bẩn của phiên khác | `docs/superpowers/audits/2026-09-21-…audit.md` có sửa dở không phải của tôi — không đụng |

⚠ Regex đáp án khớp **định dạng bảng nguồn**, nên chấm tự động là **cận dưới**. Đã chấm tay (tệp `cham-tay.json`) và
thêm một lượt chấm "lỏng" cùng mẫu cho cả trước lẫn sau. Mẫu lỏng viết sau khi đọc câu trả lời — áp đều hai phía, nhưng
không phải tập giữ lại.

## 2. Hiện trạng — chỉ số có sẵn là chỉ số THAY THẾ

"Trúng nguồn top‑5 95 %", "qua ngưỡng 84 %", "lọt 13/32" (eval #40) đều đo **truy hồi**. Không ai đo câu trả lời.

## 3. Đường cơ sở (111 câu, `kb-dau-cuoi-nen-0924.json`)

| | Đạt | Sai | Từ chối |
|---|---|---|---|
| 79 câu trong corpus (tự động · tự động + chấm lỏng) | 24 · **35** | 47 · 36 | 8 |
| 32 câu ngoài corpus cùng miền | — | 11 trả lời (9 là câu hỏi lại, 2 kiến thức chung) | **21** |

## 4. Pareto 44 câu trong corpus không đạt (nền)

| # | Nguyên nhân | Số câu | Cơ chế |
|---|---|---|---|
| 1 | **Câu hỏi lại cứng nuốt câu có tài liệu** | 18 | `buildClarifyMessage("NO_TRIGGER_MATCH")` bắn khi câu có chữ máy/line/lô mà không khớp tool; đường ấy vứt câu trả lời dù truy hồi tin cậy 0,69–0,98 |
| 2 | Model trả lời sai / bịa | 8 | T17 T36 T52 T54 T57 T76 T78 T79 (T78 bịa "session trình duyệt") |
| 3 | Từ chối dù tài liệu có | 8 | Truy hồi trượt nguồn |
| 4 | **Tool dữ liệu sống cướp câu hỏi quy tắc** | 8 | Chữ "SPC/Pareto/cycle time" kích tool; tool rỗng ⇒ trả "Chưa đủ dữ liệu…" cho câu hỏi "được tính thế nào" |
| 5 | Không rõ (bản lưu cắt) | 1 | T44 |

## 5. Đã vá — nguyên nhân #1 — và ABLATION

**Vá (`ai/hoiLaiSauTaiLieu.ts`, hai đường `answerQuestion` + `streamAnswer`):** câu hỏi lại chỉ còn là đường LUI khi độ tin
cậy truy hồi < 0,30 — **cùng** ngưỡng quyết định gọi LLM, không đặt số mới. Còn lại đi đường trả lời; nếu model từ chối
thì nối câu hỏi lại vào sau.

| (79 trong · 32 ngoài) | Nền | Sau vá | Gỡ đúng vị từ (12 câu mẫu) |
|---|---|---|---|
| Trong corpus đạt (tự động + lỏng) | 35 | **50** | 0/8 trả lời — 12/12 quay lại câu hỏi lại |
| Trong corpus từ chối | 8 | 12 | — |
| Ngoài corpus từ chối đúng | 21 | **30** | — |
| Đối chứng dữ liệu sống (6 câu mơ hồ) — số liệu bịa | 0 | **0** | — |

- 18 câu từng bị chặn: 13 đạt, 4 từ chối + câu hỏi lại, 1 từ chối trung thực (T46, truy hồi trượt). 0 bịa.
- Đối chứng C01/C06 ("lô của tôi sao rồi?") chuyển từ câu hỏi lại sang hướng dẫn tra cứu **có nguồn**
  (`howto-lot-management.md` có cả API lẫn "ETA dự kiến") — không bịa.
- Lưới service `aiLocalKnowledge.hoiLaiNhuongTaiLieu.test.ts` (6 ca, hai đường): đột biến vị từ ⇒ 4 đỏ; bỏ phần nối ⇒ 1 đỏ.
  1.414/1.414 ca `aiLocalKnowledge*` + `ai/` + routes xanh; `tsc` exit 0.

## 6. CÒN MỞ

- **Nguyên nhân #4 (8 câu) — KHÔNG vá, có lý do đo được.** Cách duy nhất là cho LLM trả lời từ tài liệu khi tool rỗng. Cổng
  "tool rỗng thì không gọi LLM" (`emptyToolGate`) tồn tại vì model đã đo được **bịa kết luận nhà xưởng** từ kết quả rỗng.
  Bộ phân biệt có sẵn `looksLikeLiveFactoryDataQuestion` **không tách được**: chặn 5/8 câu quy tắc nhưng thả qua
  "hôm nay có lỗi NG nào không", "top lỗi tuần này?", "cycle time hôm nay bao nhiêu?". Vá bây giờ = mở lại lỗi bịa.
- **Nguyên nhân #2 và #3 (16 câu)** — chất lượng truy hồi/trả lời; trọng số toàn cục đã bị bác (báo cáo 09‑24 §3).
- Chấm lỏng không phải tập giữ lại (§1).

## 7. Vòng sau — điều kiện chính xác

1. **#4:** cần một bộ phân loại "câu hỏi QUY TẮC/ĐỊNH NGHĨA" vs "câu hỏi SỐ LIỆU SỐNG", đo trên tập có nhãn cả hai lớp
   (≥ 20 mỗi lớp, viết trước khi đo). Chỉ khi nó thả 0 câu số liệu sống mới được nối nhánh "tool rỗng ⇒ trả lời theo tài
   liệu, giữ câu tool đứng đầu"; `emptyToolGate` §A phải giữ xanh.
2. **#2/#3:** tín hiệu theo câu hỏi (máy hay màn hình phần mềm) hoặc đa dạng nguồn top‑5 — đo bằng `kb-dau-cuoi.mjs`, không
   bằng hit@5.
3. **Bộ chấm:** thêm trường `dapAnTraLoi` (mẫu theo cách NGƯỜI trả lời, không theo bảng nguồn) cho 79 câu, viết trước lượt
   đo kế — để khỏi chấm tay.

---

## 8. Vòng 2–3 (cùng ngày) — bộ chấm, câu quy tắc, bảng

### 8.1 Bước 0 — sửa BỘ CHẤM trước (`e6d06cb1a`)
- `dapAnTraLoi` cho 79 câu: mẫu theo cách NGƯỜI trả lời, viết từ ĐOẠN VÀNG của tài liệu (không từ câu trả lời của model).
- MSA: 0 lệch so với chấm tay (30 câu). Ba mẫu từng tự khớp CHÍNH câu hỏi (T57 T69 T73) — đã sửa, lưới chặn loại lỗi này.
- Bỏ `**` và backtick trước khi so (T67 "**không** được tính"); GIỮ `_` (bản đầu bỏ cả `_` làm hỏng `production_manager`).
- `kb-dau-cuoi.mjs` lưu TOÀN VĂN câu trả lời (nền và vòng 1 chỉ lưu 400 ký tự ⇒ số của hai lượt ấy là cận dưới).

### 8.2 Nguyên nhân #4 — câu QUY TẮC bị tool rỗng cướp (`4488df827`)
- Bộ phân loại `ai/cauHoiQuyTac.ts` (thận trọng một chiều). Tập nhãn viết TRƯỚC (`1f750d3e5`, giữ lại `3ad88f191`):
  quy tắc 22/22 · 12/12, **câu sống bị xếp quy tắc 0/22 · 0/12**. Lỗi đo được giữa chừng: `\b` của JS chết im lặng với chữ
  Việt ("thì", "đang") ⇒ đổi sang biên Unicode; lưới kiểm từng dấu hiệu sống còn sống.
- Nhánh mới: tool rỗng + câu quy tắc + tài liệu tin cậy ⇒ LLM trả lời KHÔNG thấy khối tool; dòng tool giữ làm ghi chú.
- Đầu–cuối: 7/8 câu từng bị cướp đạt; 0/34 câu số liệu sống có nhãn đi nhánh tài liệu. Ablation: 8/8 quay lại dòng tool.

### 8.3 Truy hồi — bảng lớn bị pha loãng (`26fa747ca`)
- 16/22 câu còn trượt là trượt truy hồi; ca điển hình: một dòng E082 trong đoạn 1.708 ký tự chứa cả bảng.
- Thêm (không thay) đoạn theo nhóm 4 dòng cho bảng ≥ 5 dòng ở tài liệu miền: +111 đoạn, 0 đoạn cũ đổi.
- Ablation: trả kho cũ ⇒ 8 câu vừa lên còn 1/8.
- **Giá phải trả, đo được:** T42 (đầu–cuối) — nguồn đúng tụt hạng 5 → 6 vì một nhóm dòng của tài liệu khác chen vào.
- **Bộ giữ lại — ĐÍNH CHÍNH lớp đo:** bản đầu của mục này đọc khối `baseline` (cosine thuần) của `eval-rag-operational` và báo
  "PB07 hit@5 7/8 → 6/8". Khối `parity` (bản sao ngoại tuyến của xếp hạng sản phẩm) lại báo thẻ duyệt 0,85 → 0,80 — và ngay ở nền
  nó đã lệch sản phẩm (17/20 vs 16/20). Đo lại bằng CHÍNH endpoint sản phẩm `/api/ai/local-kb/retrieve`, kho cũ vs kho mới:
  vận hành 54/54 → 54/54 · thẻ duyệt 16/20 → 16/20 · playbook 8/8 → 8/8 · kiến trúc 10/10 → 10/10; chỉ đổi HẠNG: OP51 5 → 2
  (tốt lên), PB07 2 → 3 (vẫn trúng). ⇒ **không bộ giữ lại nào tụt trên đường sản phẩm.** Tệp thô: `guard-bang/san-xuat-*.json`.
  151 câu vàng (`eval-rag --ci`) PASS.

### 8.4 Tổng (bộ chấm thống nhất `dapAn ∪ dapAnTraLoi`, bỏ `**`)

| Lượt | Trong corpus đạt | Ngoài corpus từ chối đúng |
|---|---|---|
| Nền | 38/79* | 21/32 |
| + câu hỏi lại nhường tài liệu | 50/79* | 30/32 |
| + câu quy tắc khi tool rỗng | 57/79 | 30/32 |
| + đoạn nhóm dòng bảng | **63/79** | **30/32** |

\* bản lưu 400 ký tự ⇒ cận dưới. Câu số liệu sống bịa số: 0 ở các lượt CÓ đo đối chứng (vòng 1: 6 câu mơ hồ; vòng 2: 34 câu
sống có nhãn; vòng 3: chạy lại cả 40 câu trên bản có đoạn bảng — 0/40 đi nhánh tài liệu, số liệu máy/line đến từ tool
thật, câu lô ra hướng dẫn tra cứu có nguồn).

### 8.5 Còn mở — vòng sau
1. **Giá biên hạng 5** (T42, PB07): nhiều đoạn cùng một tài liệu chiếm chỗ ⇒ thử giới hạn số đoạn mỗi tài liệu trong top‑5
   (đo trên cả năm bộ, không chỉ ST4I).
2. **9 câu nguồn đúng vẫn ngoài top‑20** (T43 T56 T66 T17 T79 …): không phải bảng; cần xem cách chunk văn xuôi/danh sách.
3. **Kho Studio** (`st4i-may-aoi`) có bộ chunk RIÊNG — bản vá bảng chỉ áp cho kho hệ thống.
4. T65 trả lời sai vai trò dù đi đúng nhánh tài liệu — lỗi sinh chữ, chưa phân tích.

---

## 9. Vòng 4 — đoạn con văn xuôi (`a7d830405`) và một đính chính

### 9.1 Đính chính: `126908389` KHÔNG gỡ tệp KB nào khỏi git
`git commit -- <paths>` lấy nội dung cây làm việc; tệp còn trên đĩa nên 181 lệnh xoá trong index bị bỏ — commit chỉ ghi
`.gitignore`, `Dockerfile` và lưới. Lưới xanh giả vì `git check-ignore` chỉ hỏi QUY TẮC. Gỡ thật ở `f1ca5a079` (181 D, kiểm
bằng `git show --name-status`); lưới thêm ca `git ls-files` — đỏ trước, xanh sau.

### 9.2 Đoạn con
- 5 câu nguồn đúng vẫn ngoài top‑20 sau vòng 3; hai câu là "cây kim" trong đoạn lớn.
- Bổ sung đoạn con ≤ 600 ký tự theo mục (bỏ bảng lớn — đã có nhóm dòng): +328 đoạn, 0 đoạn cũ đổi.
- Hạng: T43 T66 T06 T52 T65 T42 lên hạng 1; T56 T55 T54 hạng 4. Bộ giữ lại trên endpoint sản phẩm: hit@5 không đổi ở cả bốn
  bộ; OP52 hạng 4 → 1.
- Đầu–cuối: **70/79** (lên 7, xuống 0). Ablation (kho vòng 3): 0/7 câu vừa lên.
- **Giá, đo lặp 3×/kho:** N19 ("nozzle máy gắp đặt hút không lên" — tài liệu không có) bị TRẢ LỜI 3/3 thay vì từ chối 3/3. Mã
  lỗi trích có thật trong tài liệu AOI, nhưng lời khuyên về nozzle là suy diễn sang máy khác. Ngoài corpus 30 → 29/32.
- Đối chứng số liệu sống: 0/28 đi nhánh tài liệu.

### 9.3 Tổng

| Lượt | Trong corpus đạt | Ngoài corpus từ chối đúng |
|---|---|---|
| Nền | 38/79* | 21/32 |
| + câu hỏi lại nhường tài liệu | 50/79* | 30/32 |
| + câu quy tắc khi tool rỗng | 57/79 | 30/32 |
| + đoạn nhóm dòng bảng | 63/79 | 30/32 |
| + đoạn con văn xuôi | **70/79** | **29/32** |

### 9.4 Cần chủ dự án quyết
Giữ đoạn con (7 câu đúng thêm) với giá 1 câu lạc đề cùng miền bị trả lời suy diễn (N19), hay tắt (`KB_CHUNK_DOAN_CON=0`)?
Đề nghị GIỮ: lợi đo được lớn hơn giá, và lỗi còn lại cùng lớp với mục mở "chặn câu lạc đề bằng tín hiệu khác điểm số".

### 9.5 Còn mở
1. **Câu lạc đề cùng miền** (N19 và 2 câu còn lọt): cần tín hiệu tự kiểm "câu trả lời có dựa vào đoạn trích không" — điểm
   truy hồi không tách được (vòng 1–2).
2. T17 và T79 vẫn ngoài top‑20 (T79 chỉ có ở tài liệu schema/audit, không ở tài liệu miền).
3. Kho Studio chưa có đoạn bảng/đoạn con.
