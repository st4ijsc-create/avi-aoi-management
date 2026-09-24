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
