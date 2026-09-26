# Báo cáo tiến độ — AI Local: Training Studio (R1–R5) + B8 · 2026-09-23

> **Cập nhật 2026-09-24:** các mục §4 còn mở được xử lý tiếp ở `2026-09-24-xu-ly-viec-con-mo-ai-local.md`.

Kế hoạch gốc: `docs/superpowers/plans/2026-09-22-ai-local-nang-cap-lap-trinh-training.md` (§4 R1–R5, §2 B8).
Nhánh `feat/ai-local-L7-hang-rao`, chưa push. Mọi số dưới đây có bằng chứng máy: lượt eval lưu ở `kb_eval_runs` (#id), báo cáo
đo ở `scripts/ai-eval/codegen-chay-duoc/reports`, hoặc lưới test nêu tên.

## 1. Tóm tắt

| Gói | Trạng thái | Kết quả chính | Commit |
|---|---|---|---|
| R1 — EvalTab thật | **XONG** | ST4I: nguồn đúng trong top‑5 97 % · qua ngưỡng 50 → **83 %** · tới trợ lý 20 → **40 %** · `fake-bad` 0 % | `23f96fa70` `cc4478982` `fdac39438` `a2799ef03` |
| R2A — tham chiếu API .NET | **XONG** | corpus `csharp-dotnet` 9/10 (cổng ≥ 8/10) | `c993baec1` `5ec834c6d` |
| R2B — bổ sung `using` C# | **XONG** | khối C# biên dịch được 21 → **34/35**; báo oan **0/228** | `ff0b87824` |
| R3 — Hồ sơ model | **XONG** | tab đọc model THẬT (`/props`), 0 lệch cấu hình | `1ca7f3288` |
| R4 — kiểm máy sau nạp + OCR | **XONG** | huy hiệu có lý do; OCR PDF quét chạy thật: 8/8 dòng, điểm 0,99 | `71d4b2fe3` `7456cc85b` `466d7a3d0` |
| R5 — checklist 4 bước | **XONG** | trạng thái lấy từ dữ liệu thật | `bb7f619b9` |
| B8 — tách `aiLocalKnowledgeService.ts` | **XONG** | 7.333 → 3.965 dòng; hành vi không đổi | `3e4931515` `ad4c36cee` `12ec4c2de` `c2cb4851f` |

## 2. Từng gói

### R1 — Đánh giá corpus bằng máy
Cơ chế: bộ câu hỏi vàng (`knowledge/studio-golden/*.jsonl`) → truy hồi thật → chấm bằng regex, không dùng LLM. Mỗi lượt lưu
một hàng ở `kb_eval_runs` (mig 0359). Bảng này chỉ ghi thêm: `avi_app` không có quyền UPDATE/DELETE.
Bộ ST4I có 30 câu trong corpus và 4 câu ngoài corpus.

| Bước (bộ ST4I, 29 đoạn) | Qua ngưỡng | Đáp án có trong ngữ cảnh | Tới trợ lý | Lượt |
|---|---|---|---|---|
| Nền | 50 % | 93 % | 20 % | #3–#7 |
| Xếp hạng chung với kho hệ thống | 50 % | 93 % | **40 %** | #8–#10 |
| Tiền tố `Instruct:` cho câu hỏi | **67 %** | 90 % | 40 % | #12–#14, #20, #22 |
| Ngưỡng 0,5 → 0,44 | **83 %** | 90 % | 40 % | #25 |

- **Không hồi quy:**
  - `fake-bad` (corpus rỗng) ra 0 % ở mọi lượt (#6, #11, #15, #19, #27).
  - Câu ngoài corpus bị từ chối 4/4 ở mọi lượt.
  - 151 câu vàng của kho hệ thống đúng 151/151 trước và sau mỗi thay đổi.
- **Chọn ngưỡng 0,44 (thay cho số cũ đặt từ N=1 câu):**
  - Mẫu đo gồm 38 câu có nguồn đúng trong top‑5, và 51 câu ngoài corpus. Trong 51 câu này có 45 câu chéo: bộ câu của corpus này đem hỏi corpus kia.
  - Nguồn đúng thấp nhất 0,340; nhiễu cao nhất 0,415. Hai cụm chồng nhau ở khoảng 0,34–0,415, nên không ngưỡng nào tách sạch được.

  | Ngưỡng | Nguồn đúng qua ngưỡng | Nhiễu qua ngưỡng |
  |---|---|---|
  | 0,5 | 29/38 | 0/51 |
  | 0,44 | 34/38 | 0/51 |

  Ngưỡng này chỉ áp cho route vscode.

  > **Đính chính 2026-09-24 (phiên song song, `6919087c6`):** dòng "0,44: 0/51 nhiễu" chỉ đúng với nhiễu CHÉO corpus (câu C#
  > hỏi vào tài liệu máy AOI, và ngược lại). Nhiễu CÙNG MIỀN khó hơn nhiều: thêm 8 câu vận hành không tài liệu nào trả lời
  > (reflow SAC305, stencil 0201, ESD, MSL…) ⇒ eval #30 **3/12 câu ngoài corpus lọt qua 0,44** (N06 0,533 · N09 0,460 · N12 0,572),
  > trong khi 4 nguồn đúng vẫn nằm 0,340–0,429. Không ngưỡng cosine nào tách được hai nhóm; 0,5 cũng để lọt 2/12. Reranker cũng
  > không tách tốt hơn rõ ràng (điểm thô, `scripts/ai-eval/rerank-tach.ts`): bge‑v2‑m3 giữ đúng 21/29 · nhiễu 1/12; Qwen3‑Reranker‑0.6B
  > 24/29 · 2/12; cosine 0,44 25/29 · 3/12. Sản xuất KHÔNG đổi; cần bộ vàng lớn hơn trước khi chọn. Bài học: mẫu nhiễu dễ (chéo miền)
  > cho một ngưỡng trông "sạch" mà thật ra chưa được thử.

### R2 — Dữ liệu lập trình
- **A.**
  - Tham chiếu API sinh từ XML doc có sẵn trên máy, không cần mạng, cắt mỗi ký hiệu thành một đoạn.
  - Corpus `csharp-dotnet` có 964 đoạn và đạt 9/10 (#16–#18, #21, #26).
  - Đính chính chẩn đoán D1 cũ: lỗi thật là **thiếu `using System.Data;`**, không phải dùng sai overload. Đã đo bằng `dotnet build`.
- **B.** Cơ chế do chủ dự án chọn là "sau sinh, tất định".
  - Quét mã C# vừa sinh, tra chỉ mục namespace, thêm `using` còn thiếu và nói rõ việc đã sửa trong câu trả lời.
  - Sự kiện `done` mang `answerRevised: true`.
  - Đo ngoại tuyến: 21 → 34/35 khối biên dịch được; 0/228 lời giải H/M bị đụng sai.
  - H×3 trước/sau: 75 % / 69 %. Bộ sửa **không kích hoạt lần nào**, nên chênh lệch này là nhiễu.

### R3 — Hồ sơ model
Tab này thay panel tinh chỉnh bị vô hiệu. Mỗi ô ghi nguồn của nó.
- Model đang phục vụ, đọc từ `/props`: Qwen3.6‑35B‑A3B · 65.536 × 1 slot · b9814.
- Cấu hình `.env` đang hiệu lực, cùng chỗ lệch giữa khai và chạy: hiện 0 lệch.
- Hồ sơ router: đo tại chỗ, hoặc thừa kế từ model khác.
- Sổ đo 24 giờ: 1.265 lượt.
- Báo cáo đo M/H/dự án.

LoRA còn lại là ghi chú có lý do (G9), không phải nút vô hiệu.

### R4 — Kiểm máy sau nạp và OCR
- **Kiểm máy.**
  - Lưu ở `kb_ingest_jobs."ketQuaMay"` (mig 0360). NULL nghĩa là chưa kiểm, khác với "ổn".
  - Cảnh báo đỏ: `pdf-quet-khong-ocr`, `khong-trich-duoc-chu`, `khong-doan`.
  - Cảnh báo vàng: `ocr`, `ocr-mat-dau`, `bi-cat`.
  - Tooltip nêu đúng khoá cần sửa.
- **OCR chạy thật.**
  - **Vận hành:** đã cài poppler 25.07, khai `PDFTOPPM_BIN` và tải model ONNX. Sau đó phát hiện `runOcr` chỉ đọc **một dòng** trên cả ảnh, nên một trang A4 cho ra "".
  - **Lời giải:** thêm `runOcrTrang`: DET DBNet tìm từng dòng → cắt → REC từng dòng. `runOcr` giữ nguyên cho kiểm tem AOI.
  - **Đo:**
    - Trang quét thật: 8/8 dòng, điểm 0,99, sai 1 ký tự, 3,4 s trên CPU.
    - Trang trắng: 0 dòng.
    - Chạy sống qua Studio: PDF ảnh chụp chữ ra 1 đoạn với huy hiệu vàng. PDF chỉ có hình ra huy hiệu đỏ "OCR không ra chữ" — nhãn cũ "chưa OCR" nói sai khi OCR đã chạy.
  - **Giới hạn đã đo:** model latin không có ư/ơ/ạ/ế/ộ. Chữ có dấu bị rơi, trong khi điểm tin cậy vẫn **0,97**. Điểm tin cậy không báo được lỗi này; chỉ bộ chữ báo được, nên có cảnh báo `ocr-mat-dau`.
  - **Đã giải quyết 2026-09-24 (phiên song song, `c9cdb61f8`):** thêm bộ đọc dòng VietOCR (ONNX, đủ 178 chữ cái tiếng Việt), chế
    độ tự động chạy cả hai và lấy VietOCR khi dòng có chữ Việt. Chấm bằng so chuỗi với bản gốc: tiếng Việt 0,850 → **0,979**,
    Anh/mã/số giữ 0,992. Chỉ áp cho OCR trang (nạp tài liệu); đọc nhãn AOI (`runOcr`) vẫn dùng PaddleOCR. Cảnh báo `ocr-mat-dau`
    tự tắt khi VietOCR là bộ đọc dòng.

### R5 — Checklist 4 bước
Bốn bước: corpus → đã nạp (kèm cảnh báo đỏ của lần nạp mới nhất) → bộ vàng và số lượt eval → điểm lượt mới nhất.
Điểm bị gắn "CŨ" khi có lần nạp mới sau lượt đo. Lúc đang tải thì không vẽ ✗.

### B8 — Tách service
Công cụ AST `scripts/refactor/tach-khai-bao.cjs` chuyển mã sang tệp mới mà giữ nguyên từng byte, và re-export tên ở tệp gốc để người gọi không phải đổi gì.

Nhánh lập trình tách thành 5 tệp theo luồng: điều phối · sửa · tạo khung · sinh mã · thông báo. Vòng tool tách ra một tệp riêng. Tầng truy hồi **không tách** vì có 18 phụ thuộc chéo.

Hợp đồng kiểm là tập ca đỏ **y hệt** trước/sau trên 62 tệp test (1.218 ca). Kiểm sống sau tách:
- dự án thật 7/7 (chạy 2 lần);
- agentic 5/6, 3/6, 4/6 — nằm trong dải nhiễu;
- `answerRevised` hoạt động;
- tool_loop trên web hoạt động;
- eval #22 không đổi.

## 3. Phát hiện đáng nhớ
1. **Hai thang điểm bị sort chung.**
   - Trước khi vá: điểm cosine thuần của Studio bị so trực tiếp với điểm hybrid của kho hệ thống, nên tài liệu nạp hiếm khi tới được trợ lý.
   - Sau khi vá: tới trợ lý 20 → 40 %.
2. **OCR "bật" mà không làm gì**, hai lần liên tiếp.
   - Lần 1: `PDFTOPPM_BIN` trống.
   - Lần 2: OCR một dòng chạy trên cả trang.
   - Cả hai lần đều không có lỗi và không có log. Nay kiểm máy sau nạp báo cả hai lớp lỗi này.
3. **Điểm tin cậy không phải thước đo đúng sai**: OCR mất dấu tiếng Việt mà vẫn được 0,97.
4. **`npx tsc --noEmit` không kèm heap bị OOM** (exit 134, 0 dòng lỗi), nên trông như "sạch" dù có lỗi.
   - Phiên song song phát hiện và vá 8 lỗi đã lọt qua theo cách này (`34e4dc1e6`). Một trong số đó là lỗi hành vi thật.
   - Từ giờ luôn chạy với `NODE_OPTIONS=--max-old-space-size=8192` và kiểm exit code. Lần chạy lại với heap đủ lớn: exit 0, 0 lỗi.

## 4. Còn mở, đề nghị theo thứ tự
> Cập nhật 2026-09-24: phiên song song đã làm bốn mục đầu (`c9cdb61f8`, `6919087c6`); trạng thái ghi ngay trong từng mục.

1. ~~**OCR tiếng Việt**~~ — **XONG** (`c9cdb61f8`): VietOCR, tiếng Việt 0,850 → 0,979 (§2 R4).
2. **Truy hồi phía kho hệ thống** — một phần do NHÃN: T29 trả lời được từ `spc-rules.md` mà bộ vàng không ghi ⇒ đã sửa nhãn,
   "kho nào cũng ra nguồn đúng" 0,767 → 0,800. Còn **6 câu trượt thật** (T05 · T06 · T12 · T17 · T18 · T19) — việc tiếp theo.
3. **Bốn câu ST4I trong cụm nhiễu** — đã thử reranker (bge‑v2‑m3, Qwen3‑Reranker‑0.6B): không tách tốt hơn cosine rõ ràng. Còn mở.
4. ~~**Bộ câu ngoài corpus cùng miền**~~ — **đã thêm 8 câu** (N05–N12) và chính chúng lộ ra ngưỡng 0,44 để lọt 3/12 (đính chính ở
   §2 R1). Việc còn lại: bộ vàng lớn hơn rồi mới chọn lại ngưỡng/reranker.
5. ~~**B6** và **trần nghĩ 32k** vẫn hoãn: b9814 không nhận ngân sách nghĩ theo từng request.~~ **Đính chính (phiên lập trình
   song song, cùng ngày):** câu này SAI. B6 đã làm (`c8f57fbe5`, hybrid phủ quyết cho bộ chọn tool; lưới vá `70d86ba82`). b9814
   CÓ đọc ngân sách nghĩ theo yêu cầu qua `thinking_budget_tokens` (đo: 200 ⇒ nghĩ bị cắt ở 550 ký tự) — trường thử trước đây
   (`reasoning_budget`) mới là trường bị bỏ qua. Không cần nâng llama.cpp. "Nghĩ sâu" (24k nghĩ, trần sinh 32k) nối phía server ở
   `a6a747a7d`, **đo rồi KHÔNG bày**: H×3 chế độ sâu **25/36** (7·11·7) < cân bằng 30/36, chậm hơn 25 % ⇒ nút đã gỡ khỏi UI
   (`4d0291406`; server giữ khả năng). Số ở audit 2026-09-21 §8.4m. Nghĩ nhiều hơn KHÔNG đồng nghĩa đúng hơn trên bộ bài này.

## 5. Thay đổi vận hành trên máy này (không vào git)
- `.env`: đã thêm `PDFTOPPM_BIN`, trỏ tới poppler cài bằng winget (`oschwartz10612.Poppler`).
- `models/ocr/`: `det.onnx` (PP‑OCRv3) · `rec.onnx` (latin PP‑OCRv5) · `ppocr_keys.txt`. Nguồn: `huggingface.co/monkt/paddleocr-onnx`, Apache‑2.0. Nguồn này đã ghi ở `.env.example`.
- Đã xoá hai corpus thử `r4-ocr-that` và `r4-ocr-thu`. Các lượt eval vẫn còn trong `kb_eval_runs` vì bảng chỉ ghi thêm.

## 6. Phối hợp đa phiên
Phiên `avi-aoi-management-01` làm F4/F6 trên cùng nhánh.
- Luật đã thống nhất: báo cho nhau qua tin nhắn **trước** mỗi lần build hoặc restart :3000.
- Sự cố lúc 16:26: lần restart của phiên này đã giết server của phiên kia giữa lúc đang đo; đã xin lỗi.
- Commit chỉ bằng pathspec tường minh. Không phiên nào sửa tệp của phiên kia.
