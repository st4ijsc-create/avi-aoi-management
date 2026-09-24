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

## 10. Vòng 5 — cổng câu lạc đề cùng miền (`bf42ae799`) và một tài liệu sai (`d39e67949`)

### 10.1 Bước 0
- Bộ GIỮ LẠI `scripts/ai-eval/st4i-giu-lai-lac-de.jsonl` (12 trong + 12 ngoài) commit TRƯỚC thiết kế (`d53a4ddd1`).
- Bundle dựng lại từ mã có cổng (`dist/index.js` 15:28, chuỗi `AI_KB_CONG_LAC_DE` có trong bundle); :3000 = một PID;
  `KB_QA_CACHE_TTL_MS=0` cho mọi lượt đo; ablation = restart với `AI_KB_CONG_LAC_DE=0` (log: 0 dòng "CHẶN").
- Lưới rộng lộ một **hồi quy của chính vòng 2**: `e6d06cb1a` thêm `dapAnTraLoi` vào bộ vàng ST4I mà schema Studio `.strict()`
  từ chối ⇒ EvalTab Studio đọc ra **0 câu**. Vá ở `fd2908ae4` (đột biến "bỏ trường khỏi schema" ⇒ đỏ).

### 10.2 Thiết kế (đo trên bộ huấn luyện, xác nhận trên bộ giữ lại)
Chặn ⇔ độ phủ từ nội dung (IDF) của câu hỏi trong các đoạn < 0,6 **VÀ** tự kiểm một từ (tắt nghĩ, 8 token) nói KHONG. Chỉ
xét khi đường cũ SẼ gọi model (confidence ≥ 0,30), không tool, không route vscode; lỗi bất kỳ ⇒ không chặn. Tự kiểm thấy câu
hỏi ĐÃ CHE (`plan.safeText`) — lưới an toàn cũ bắt được bản đầu gửi câu hỏi thô; nay kiểm MỌI lượt engine.

### 10.3 Kết quả (bật vs tắt cổng, cùng bundle, cache tắt)

| Bộ | Tắt cổng | Bật cổng |
|---|---|---|
| 111 câu — trong corpus đạt | 70/79 (vòng 4) | **71/79** |
| 111 câu — ngoài corpus từ chối | 29/32 | **32/32** (thêm N04 N19 N22) |
| Giữ lại — trong đạt* | 8/12 | 8/12 (0 câu mất) |
| Giữ lại — ngoài từ chối | 10/12 | **11/12** (thêm HN02) |
| Đối chứng sống (6) — bịa số | 0 | 0 |

\* chấm máy; HT04 xem 10.4.
- Theo câu (so với `v5tat-st4i-doi` chạy lại 10 câu đổi): **mất T58** ("phế phẩm" ↔ "Scrap Rate" — lệch ngôn ngữ, giá đã dự
  báo cùng lớp); **T17 T46 từ SAI thành từ chối** (trung thực hơn, không tính là đạt); T54/T76 lên là nhiễu sinh chữ (cổng
  chỉ có thể từ chối).
- **Giá chưa trả hết:** đối chứng C01 "lô của tôi sao rồi?" và C03 "tình trạng thiết bị hiện tại ra sao?" trước đó được
  hướng dẫn theo tài liệu (menu/API tra lô), nay nhận câu từ chối chuẩn. Cả hai vẫn đúng nhãn ("hỏi lại/từ chối/tool, KHÔNG
  bịa số") nhưng kém hữu ích hơn.
- Đột biến: tuKiemCo luôn CO · bỏ công tắc · gỡ cổng stream · gỡ cổng non-stream · ngưỡng 0,1 · tự kiểm dùng câu chưa che ⇒
  ĐỎ. Vế `route !== "vscode"` SỐNG SÓT — route vscode truy hồi kho riêng (0 đoạn), vế đó là phòng thủ thừa.
- Chưa đo: độ trễ thêm của lượt tự kiểm trên câu KHÔNG bị chặn (câu bị chặn trả lời ~0,6 s thay vì 2–40 s).

### 10.4 Tài liệu sai, không phải model sai (HT04)
Trợ lý trả lời Pareto mặc định **30 ngày**; tài liệu miền ghi 7; bộ chấm tính ĐÚNG chỉ vì chuỗi "7 ngày" nằm ở dòng dữ liệu
sống. Đọc mã: `ParetoAnalysis.tsx getDefaultDateRange` và `QualityCockpit` đều −30 ngày; 7 ngày là mặc định của TOOL
`get_top_defects`. Sửa bảng trong `howto-pareto-defects.md` và đáp án HT04 (`d39e67949`, có ghi chú đính chính); KB dựng lại
(2 đoạn đổi) và kiểm lại trên server thường: HT04 đạt với câu "30 ngày".

### 10.5 Phát hiện mới trên bộ giữ lại — tool rỗng cướp câu hỏi TÍNH NĂNG
HT05 HT07 HT12 (vạch đỏ Pareto, cache bao lâu, bộ lọc severity) nhận nguyên dòng tool "Không có lỗi NG nào theo defectType
trong 7 ngày qua." ở CẢ HAI lượt bật/tắt cổng. Điều kiện chính xác: tool top‑defects chạy, trả rỗng, `laCauHoiQuyTac` =
false (không có dấu hiệu quy tắc: "đánh dấu … nào", "cache trong bao lâu", "có những giá trị nào") ⇒ nhánh 4488df827 không
bật ⇒ câu trả lời là dòng tool. Cùng lớp nguyên nhân #4, lỗ ở bộ nhận dạng câu quy tắc.

### 10.6 Còn mở
1. Tool rỗng cướp câu hỏi tính năng (10.5) — 3/12 câu giữ lại.
2. C01/C03: khi cổng chặn một câu hỏi SỐNG mơ hồ, nên hỏi lại (mã lô/máy) thay vì từ chối chuẩn.
3. T58 và lớp lệch ngôn ngữ Việt ↔ Anh (T17 T79 cũng thế: "sửa lại/loại bỏ" ↔ "rework/scrap", "danh mục lỗi" ↔ "defect
   catalog") — một bảng thuật ngữ mở rộng truy vấn sẽ chạm cả truy hồi lẫn độ phủ của cổng.
4. Kho Studio chưa có đoạn bảng/đoạn con; bản Studio của tài liệu Pareto (nếu đã nạp) còn ghi 7 ngày — cần nạp lại.

## 11. Vòng 6 — tool rỗng cướp câu hỏi TÍNH NĂNG (`7be30e23d`)

### 11.1 Bước 0
- Tập GIỮ LẠI mới `scripts/ai-eval/cau-tinh-nang-vs-song-giu-lai.jsonl` commit TRƯỚC thiết kế (`107f555d8`): 12 câu tính năng
  KHÔNG mang dấu hiệu quy tắc + 12 câu SỐNG KHÔNG mang dấu hiệu sống ("OEE bao nhiêu?", "lỗi nào nhiều nhất?") — lớp khó mà
  hai tập cũ không có (mọi câu sống cũ đều có mốc thời gian/mã máy/"đang").
- Nền trên tập mới (server thường): tính năng 10/12 — TQ01 TQ02 nhận nguyên dòng tool SPC rỗng; sống 0 bịa số.

### 11.2 Thiết kế
Chỉ trong VÙNG MƠ HỒ (không dấu hiệu sống, không dấu hiệu quy tắc), tool RỖNG, tài liệu tin cậy: hỏi model một từ
SONG/TAILIEU (tắt nghĩ, 8 token). Chỉ TAILIEU rõ ràng mới rẽ sang nhánh tài liệu của `4488df827` (LLM không thấy khối tool,
dòng tool giữ làm ghi chú); mọi lỗi/chữ lạ ⇒ đường tool như cũ. Thí nghiệm ngoại tuyến (model mặc định, 95 câu nhãn): câu
tài liệu → TAILIEU 49/49; câu sống TRONG vùng → TAILIEU 3/13 (TL03 TL10 TL11) — chúng chỉ đi nhánh tài liệu nếu tool của
chúng cũng rỗng.

### 11.3 Phát hiện: câu ngắn của trợ lý vận hành chạy trên model NHANH (Qwen3-4B), không phải model mặc định
Bản đầu đo đầu–cuối KHÔNG sửa được câu nào (HT05/07/12 vẫn là dòng tool). Log gỡ lỗi: lượt phân loại chạy trên
`Qwen3-4B-Instruct` — `planInference({task:"chat"})` xếp câu ngắn vào độ khó trivial/easy ⇒ Tier 1 ⇒ `GGUF_FAST_MODEL`
(`aiModelRouter.ts` nhánh `trivial`/`easy`). Model 4B nói SONG cho 3/3 câu tính năng mà model mặc định nói TAILIEU. Sửa:
lượt phân loại xin model MẶC ĐỊNH mà llama-server đang giữ (`modelId` undefined); server không giữ ⇒ không nạp gì in-process.
- ⚠ **Hệ quả rộng hơn vòng này:** cùng quyết định planner ấy chọn model cho CÂU TRẢ LỜI (`generateWithOllama` dùng
  `plan.decision.modelId`) ⇒ phần lớn câu của trợ lý vận hành — mọi con số 70/79 ở các vòng trước — được SINH bởi Qwen3-4B.
  Và lượt tự kiểm của cổng lạc đề vòng 5 cũng chạy trên 4B, trong khi thiết kế của nó đo ngoại tuyến trên model mặc định
  (số đầu–cuối vòng 5 vẫn đúng — chúng đo đường thật). Tiêu chí chủ dự án là ĐÚNG hơn NHANH ⇒ một phép A/B 4B vs model mặc
  định cho câu trả lời trên 111 câu là việc đầu của vòng sau.

### 11.4 Kết quả (cache tắt; ablation = `AI_KB_PHAN_LOAI_TAI_LIEU=0`)

| Bộ | Trước (vòng 5 / nền) | Vòng 6 |
|---|---|---|
| Giữ lại vòng 6 — tính năng đạt | 10/12 | **11/12** (TQ01 lên; TQ02 nay đi nhánh tài liệu nhưng model trả lời sai "không định nghĩa") |
| Giữ lại vòng 5 — HT05 HT07 HT12 | 0/3 | **3/3** (tổng trong corpus 8 → 11/12) |
| Câu SỐNG đi nhánh tài liệu (22 + 12 + 12 + 6) | 0/52 | **0/52** |
| 111 câu | 71/79 · 32/32 | 70/79 · 32/32 |
| Ablation (tắt công tắc) trên 5 câu vừa lên | — | 0/5 |

- 111 câu: T54 T76 xuống, T22 lên — cả ba KHÔNG đi nhánh này (log: 5 lượt TAILIEU trong toàn bộ đợt đo, đều là câu tính
  năng; 8 câu st4i đi nhánh tài liệu + ghi chú tool đều đạt). T54 T76 là hai câu "lên" vì nhiễu ở vòng 5 (v5tat: T54 sai).
- Đột biến 7/7 ĐỎ: đọc phân loại luôn TAILIEU · bỏ công tắc · vùng bỏ qua dấu hiệu sống · gỡ phân loại non-stream · gỡ phân
  loại stream · bỏ cổng "server giữ model mặc định" · dùng model của planner.
- `dist/BUILD-INFO.txt` ghi lại SAU commit (`7be30e23d`), `npm run kiem:lai-lich` ĐẠT.

### 11.5 Còn mở
1. **A/B model sinh câu trả lời** (4B hiện tại vs model mặc định) trên 111 câu + bộ giữ lại — 11.3.
2. TQ02: nhánh tài liệu đúng nhưng câu trả lời sai (truy hồi đứng đầu là playbook, "Refresh: 1 phút" ở đoạn khác).
3. Các mục 10.6 còn nguyên: C01/C03 hỏi lại thay vì từ chối; lệch thuật ngữ Việt ↔ Anh; kho Studio.

## 12. Vòng 7 — A/B model SINH câu trả lời (`6ac570ba1`)

### 12.1 Bước 0 — ba nhánh, cùng bundle, chỉ đổi thứ ghi dưới đây (BUILD-INFO KHÔNG lưu ENV — ghi ở đây)

| Nhánh | Mã | ENV khởi động (ngoài `.env`) | Model câu trả lời | Model tự kiểm cổng lạc đề |
|---|---|---|---|---|
| A (hiện trạng) | `7be30e23d` | `KB_QA_CACHE_TTL_MS=0` | Qwen3-4B in-process (planner Tier 1) | Qwen3-4B |
| B | `7be30e23d` | `KB_QA_CACHE_TTL_MS=0` · `GGUF_FAST_MODEL=" "` (MỌI lượt Tier 1 → mặc định) | 35B-A3B qua llama-server | 35B-A3B |
| C | `6ac570ba1` | `KB_QA_CACHE_TTL_MS=0` | 35B-A3B qua llama-server | Qwen3-4B |

Xác minh đường thật: bộ đếm `llamacpp:tokens_predicted_total` của :8091 tăng ~220 token sau MỘT câu ở nhánh B/C.
Nhánh A: `v6b`, `v7a2`, `v7a3`; B: `v7b`, `v7b2`, `v7b3`; C: `v7c`, `v7c2` (tệp thô trong `pdca-kb-dau-cuoi-2026-09-24/`).

### 12.2 Kết quả

| | A (3 lượt) | B (3 lượt) | C (2 lượt) |
|---|---|---|---|
| 111 câu — trong corpus đạt | 70 · 70 · 69 | 70 · 71 · 71 | **71 · 71** |
| 111 câu — ngoài corpus từ chối | 32 · 32 · 32 | 30 · 31 · 30 | 31 · 31 |
| 34 câu QUY TẮC (có tài liệu) bị từ chối | 3 · 3 · 3 | 7 · 7 · 7 | 4 · 4 |
| Giữ lại v5 / v6 — trong corpus | 11/12 · 11/12 | 11/12 · 11/12 | 11/12 · 11/12 |
| Câu SỐNG đi nhánh tài liệu | 0/52 | 0/52 | 0/52 |
| Trung vị / p90 (ms, 111 câu) | 3185/4663 · 1453/2355 · 1455/1943 | ~1760/~2430 | ~1780/~2400 |

- "Rò" ngoài corpus của B/C là **N31** (và N21 ở B): câu trả lời MỞ ĐẦU bằng "Tài liệu hiện tại không cung cấp…" — từ chối
  về nội dung, bộ chấm (khớp câu từ chối chuẩn) đếm là trả lời. Không bịa. Vẫn ghi là số đo thấp hơn A.
- B thua vì TỰ KIỂM trên 35B chặn nhầm câu quy tắc có tài liệu (Q11 "Cpk bao nhiêu thì đạt", Q22, GQ03, T35 — ~0,7 s,
  đúng chữ ký cổng). C giữ tự kiểm trên model planner ⇒ còn Q19 (câu trả lời: tài liệu ghi "CHƯA GHI LẠI" — từ chối có lý).
- Câu sống: C từ chối kèm lý do rõ hơn (S11 "Chưa đủ dữ liệu yield … không thể cung cấp Cpk") nơi A trả dòng tool; 0 bịa số.
- **Tốc độ:** lượt đầu của A (3,2 s) là nhiễu — hai lượt lặp của A ra 1,45 s. C chậm hơn A ~0,3 s trung vị. Lợi về ĐÚNG
  nhỏ (+1–2/79, nhất quán qua lượt lặp; 35B gần tất định, 4B dao động ±1).
- **Quyết định:** áp dụng C theo tiêu chí ĐÚNG hơn NHANH — không bộ nào tụt về đúng, giá là ~0,3 s và câu trả lời vận hành
  nay chia 2 slot của llama-server với màn lập trình. Quay lại: `AI_KB_MODEL_TRA_LOI=planner`.
- Đột biến 5/5 ĐỎ (luôn model planner · bỏ cổng "server giữ model" · bỏ công tắc · gỡ ở stream · gỡ ở non-stream).

### 12.3 Còn mở
1. Tranh chấp slot llama-server giữa trợ lý vận hành và màn lập trình — chưa đo dưới tải đồng thời.
2. Bộ chấm từ chối chỉ nhận câu từ chối chuẩn — câu "tài liệu không nêu…" của 35B bị đếm là trả lời (N21/N31).
3. TQ02, C01/C03, lệch thuật ngữ Việt ↔ Anh, kho Studio — như 10.6/11.5.
