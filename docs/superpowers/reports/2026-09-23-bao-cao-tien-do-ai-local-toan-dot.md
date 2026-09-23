# Báo cáo tiến độ AI Local — lập trình + training, so với kế hoạch (2026-09-23, tối)

Kế hoạch: `docs/superpowers/plans/2026-09-22-ai-local-nang-cap-lap-trinh-training.md`.
Số đo chi tiết: `docs/superpowers/audits/2026-09-21-ai-local-lap-trinh-audit.md` §8.4a–8.4m.
Báo cáo riêng phần training (phiên song song): `docs/superpowers/reports/2026-09-23-bao-cao-tien-do-ai-local-training.md`.

## 1. Kết luận

- **19/19 hạng mục kế hoạch đã đóng**: 17 áp dụng (F3 chỉ hai nút — nút "sâu" đo tụt nên không bày), 2 đo rồi không áp dụng (B2, B5). Không còn hạng mục "đang đo".
- **Cấu hình sản xuất hiện tại:** Qwen3.6‑35B‑A3B, 1 slot × 64k, ngân sách nghĩ 12k, ngữ cảnh repo 4k, phủ quyết B6 bật.
- **Nền sản xuất trên HEAD:** trục H 30/36 = 83 %, trong dải nhiễu ±3 so với mốc 31/36. Có 0 lượt cạn ngân sách nghĩ.
- **Các mục còn mở cuối ngày đã xử lý hết.** Chỉ còn backlog và nợ ở §4–§5; mỗi mục có lý do và số đo.

## 2. Trạng thái từng hạng mục

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| B1 công tắc nghĩ theo lớp lượt | Xong | Nửa còn lại đóng bởi B4 (G5‑D 3/6 → 0/12) |
| B2 hồ sơ sampling chính hãng | Không áp dụng | M 78 vs 83 %, H 67 vs 69 % ⇒ giữ `hien-tai` |
| B3 ngữ cảnh 64k | Áp dụng | H 86 %, launcher chốt 1 × 64k |
| B4 ngân sách nghĩ 12k | Áp dụng | 0/36 lượt H bị cắt |
| B5 MTP | Không áp dụng | H 75 vs 86 %, chỉ nhanh hơn 9 % |
| B6 chọn tool lai + phủ quyết | Áp dụng | `c8f57fbe5`; khe HR3/Q14 đóng ở `c95515a5d` |
| B7 sổ đo lượt | Xong, nghiệm thu sống | Sự kiện `usage` đủ trường |
| B8 tách service | Xong (phiên training) | 7.333 → 3.965 dòng; đối chứng A2 xác nhận không hồi quy |
| F1 bảng đang nghĩ | Xong, nghiệm thu sống | |
| F2 thanh trạng thái | Xong | tok/s nghĩ và sinh tách riêng `ebec44f1d` (sống 160,6 / 199) |
| F3 bộ chọn chế độ nghĩ | Hai nút; "sâu" nối server nhưng **không bày** | H sâu 25/36 < cân bằng 30/36 |
| F4 lý do model cạnh thẻ duyệt diff | Xong | `06c35fd09`; trích đầu + đuôi chuỗi nghĩ |
| F5 lệnh và nhật ký | Xong | Lọc, exit code, chạy lại qua cửa duyệt |
| F6 chỉ số phiên + JSON | Xong | `06c35fd09` |
| R1–R5 training | Xong (phiên training) | Xem báo cáo training |

## 3. Việc đóng trong lượt "xử lý nốt" (tối 2026-09-23)

1. **Khe chọn tool HR3/Q14** (`c95515a5d`). Hai quy tắc chung:
   - tệp dấu chấm viết thường là đường tệp;
   - "định nghĩa / khai báo" + đường tệp, khi mẫu tìm chỉ là mảnh của chính đường đó ⇒ đọc tệp.

   Bộ giữ lại thứ ba được viết **trước** khi sửa (`f97064947`); đó là số sạch duy nhất:

   | Bộ ca | Trước | Sau |
   |---|---|---|
   | Giữ lại 3 (sạch) | tool 0,54 · cặp 0/3 | tool 1,00 · cặp 3/3 |
   | Giữ lại 1 | tool 0,92 | tool 1,00 |
   | Giữ lại 2 | tool 0,90 · cặp 1/2 | tool 1,00 · cặp 2/2 |
   | 38 ca gốc | tool 0,93 | tool 0,93 |

   Từ chối vẫn 1,0 và dương tính giả vẫn 0 ở cả bốn bộ.
2. **OCR tiếng Việt** (`c9cdb61f8`). PaddleOCR latin thiếu 99/178 chữ cái Việt; VietOCR ONNX đủ 178. Chế độ tự động chạy cả hai và lấy VietOCR khi dòng mang chữ Việt:

   | Bộ đọc dòng | Tiếng Việt | Anh / mã / số |
   |---|---|---|
   | PaddleOCR | 0,850 | 0,992 |
   | VietOCR | 0,979 | 0,958 |
   | Tự động | 0,979 | 0,992 |

   Chỉ áp cho OCR trang lúc nạp tài liệu. Đọc nhãn trên dây chuyền giữ PaddleOCR. Nạp sống một PDF quét có dấu: giữ đủ dấu.
3. **Ngưỡng trích dẫn 0,44 và reranker** (`6919087c6`). Thêm 8 câu ngoài corpus **cùng miền**.
   - Với cosine, 3/12 câu nhiễu lọt qua (0,46–0,57), trong khi 4 câu đúng nằm dưới ngưỡng (0,34–0,43). Không ngưỡng nào tách được.
   - Điểm reranker thô cũng không tách tốt hơn: bge‑v2‑m3 giữ đúng 21/29, lọt 1/12; Qwen3‑Reranker giữ đúng 24/29, lọt 2/12. Cosine 0,44 giữ đúng 25/29, lọt 3/12.
   - Không đổi sản xuất.
4. **Nhãn vàng quá hẹp**: T29 trả lời được từ `spc-rules.md`. Tỉ lệ "kho nào cũng ra nguồn đúng" 77 → 80 %.
5. **Hai lưới đỏ do B6** và **ca test phụ thuộc thứ tự quét** (`70d86ba82`). **Census CLI đỏ từ tháng 8** (`2d9ec26ed`).

## 4. Backlog (có số, chưa làm, kèm lý do)

| # | Việc | Vì sao chưa | Điều kiện để làm |
|---|---|---|---|
| 1 | 6 câu ST4I không kho nào ra nguồn đúng (T05 T06 T12 T17 T18 T19) | Kho hệ thống thắng. Nhiễu gồm tài liệu kỹ thuật `docs/superpowers/*` và phiếu làm việc `_PHIEU_DIEN_7_O_TRONG.md` được nhúng vào kho vận hành | Loại tệp tiền tố `_` khi dựng chunk, nhúng lại, rồi chạy lại 151 câu vàng hệ thống (nền 151/151) |
| 2 | Chọn reranker | Qwen3‑Reranker nhỉnh hơn bge (top‑1 23 vs 22/30) nhưng chênh nằm trong nhiễu của 41 câu | Bộ vàng ≥ 100 câu trước khi đổi; model đã tải sẵn `D:\SOURCES\16.AI\Qwen3-Reranker-0.6B-Q8_0.gguf` |
| 3 | Nút "Nghĩ sâu" | Đo tụt 5 bài | Bày lại khi có bài mà cân bằng hỏng vì cạn ngân sách (hiện 0) |
| 4 | Agentic A2 làm cổng | Tỉ lệ thật ≈ 44 %; 6 lượt không phân biệt được thay đổi dưới ~40 điểm | ≥ 12 lượt mỗi phép đo |
| 5 | E01/E02 (câu sửa ⇒ read_file) | Chấp nhận: dòng sửa đi đường riêng | — |

## 5. Nợ

| Nợ | Ảnh hưởng | Đề nghị |
|---|---|---|
| Nhiễu trục H ±3 ở 12 bài × 3 | Chênh ≤ 3 bài không kết luận được | Dùng ×6 khi quyết định sát nút |
| `knowledge/*.json` và `chunks.jsonl` có ~30.000 dòng sinh lại chưa commit, không rõ phiên nào | Không biết kho đang phục vụ ứng với bản nào | Chủ dự án chọn: commit như ảnh chụp hiện tại, hoặc `kb:sync` lại rồi commit |
| Chạy rộng `server/services/ai*` có 19 ca đỏ, mỗi tệp chạy riêng thì xanh (ví dụ `aiGateway.b7` 20/20) | Lưới gộp báo đỏ giả, che lỗi thật | Tách trạng thái dùng chung giữa các tệp test (mock `drizzle/schema`, DB) |
| `npx tsc` không kèm heap chết OOM mà trông như sạch | Đã ẩn 8 lỗi, trong đó 1 lỗi hành vi | Luôn chạy `npm run check` hoặc kiểm exit code |
| Tiến trình `python t.py` không rõ chủ giữ 48 GB RAM lúc 21:18 ⇒ máy cạn bộ nhớ ảo, llama-server chết | Mất model ~35 phút; không phiên Claude nào nhận | Chủ dự án kiểm tiến trình nền ngoài các phiên. llama-server đã khởi lại 21:54 |
| Tải GitHub từ máy này ~7 KB/s (Hugging Face ~40 MB/s) | Nâng llama.cpp qua GitHub mất ~6 giờ | Không cần lúc này: b9814 đã có ngân sách nghĩ theo yêu cầu |

## 6. Cần chủ dự án quyết

1. Xử lý `knowledge/` chưa commit (nợ 2), vì mục backlog 1 cần nhúng lại kho.
2. Cho phép loại tệp tiền tố `_` khỏi kho vận hành, rồi đo lại 151 câu vàng (backlog 1).
