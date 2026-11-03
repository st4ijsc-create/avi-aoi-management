# Đợt 10.4b L3c — `search_docs` cho agent máy chủ chạy model NGOÀI: HỢP ĐỒNG (do-model 03/11, theo điều kiện dieu-phoi)

Nguồn: hợp đồng L3 `docs/superpowers/plans/2026-10-30-dot10-4b-L3-agent-ngoai-hop-dong.md` (k7: "`search_docs` ⇒ L3c riêng"; Q4 kiem-dinh:
"lọc `laTaiLieuSanPham` như L1"). Nhánh `feat/ai-do-l3c` nối sau H3.3b (`29bd371f2` — cùng tệp `vongAgentNgoai.ts`).
Bản nháp đầu (aa6d8e865) đề xuất tài liệu HÃNG; dieu-phoi 03/11 chốt khác ⇒ bản này thay thế.

## Điều kiện dieu-phoi 03/11 ⇒ cách làm
- (a) CHỈ tài liệu SẢN PHẨM, dùng lại bộ lọc `laTaiLieuSanPham` của L1, KHÔNG bản sao thứ hai ⇒ bộ lọc CHUYỂN sang
  `server/services/ai/ngoai/taiLieuSanPham.ts`; `routes/kbNgoai.ts` re-export (lưới ghim cùng một hàm). Thêm khoá NỘI BỘ áp cho CẢ L1:
  đoạn đường `superpowers` / `.superpowers` / `.claude` / `memory` / `plans` / `specs` / `audits` ở mọi cấp, tên `.env*`, tài liệu kế
  hoạch / lộ trình dưới `docs/` (`*_PLAN*`, `*ROADMAP*`). Tệp ngoài gốc: tiền tố + `..` + bước (b).
- (b) lưới k1: mỗi chunk truy hồi (cùng `retrieveKnowledge` như L1) ⇒ bộ lọc sản phẩm TRƯỚC khi chạm đĩa ⇒ `sourcePath` GIẢI trong gốc
  sản phẩm (`process.cwd()` của máy chủ) bằng `giaiTepNgoai` (deny-list + realpath, như read_file) ⇒ lọc LẠI theo đường THẬT ⇒ nhị phân
  bỏ ⇒ trần byte / số tệp CỘNG DỒN vào `TrongThaiDoc` của run; số đoạn bị ẩn được KHAI. Kết quả qua cổng ⇒ bộ che như mọi tool.
  Mức: tin tool `search_docs` vào `ghepPhan` là `truy-hoi-kb` kho `api` (ky-thuat).
- (c) census `ghepPhan` / `goiAiNgoai` / import: không thêm điểm gọi; bộ đọc ngoài vẫn một (`congCuDocNgoai.ts`).
- (d) CHƯA quảng bá mặc định: chỉ khi `searchDocs` của cấu hình / env `AI_NGOAI_SEARCH_DOCS === "1"`; lọc ở CẢ `congCu()` lẫn bộ chuyển
  (lõi đưa đủ CONG_CU vẫn không lộ); chế độ ≠ `hoi` ⇒ `NGOAI_TOOL_KHONG_CAP`; trần `TRAN_TIM_TAI_LIEU_LUOT` = 4 lần mỗi lượt.
- Bề mặt `agent` trong `BE_MAT_NGOAI_DUOC_DUNG`: CHƯA mở (cùng lúc đo H3.3b nếu chủ dự án duyệt).
- L2 (màn lập trình) KHÔNG quảng bá `search_docs` (giữ `TOOL_DOC_NGOAI`); bộ thực thi chung chỉ chạy tool mà cổng đã cho qua.

## Lưới + đột biến (searchDocsNgoai.test.ts)
Một bộ lọc (L1 re-export đúng hàm) · khoá nội bộ · chunk sản phẩm thật ⇒ trả + cộng dồn · 8 dạng đường xấu bị ẩn + khai · không chạm đĩa với
chunk không phải sản phẩm · junction trong gốc tới thư mục không phải sản phẩm ⇒ bỏ · trần tệp / byte · cờ tắt: không trong congCu / không
quảng bá / từ chối · cờ tắt + lõi đưa đủ CONG_CU ⇒ vẫn không quảng bá · cờ bật: schema hẹp, chạy qua bộ đọc, chế độ sửa từ chối, trần lần.
Đột biến 11/11 ĐỎ: bỏ bộ lọc sản phẩm · bỏ giải đường (thoát gốc) · bỏ lọc lại theo đường thật · bỏ nhị phân · bỏ trần tệp · bỏ khoá nội bộ ·
bỏ khoá kế hoạch docs · cờ mặc định bật · bỏ chặn quảng bá ở bộ chuyển · bỏ trần lần · bỏ chế độ hoi.

## Sau gộp
Bật mặc định (đổi cờ) = quyết riêng sau khi gộp + ghim (dieu-phoi). Cập nhật hướng dẫn hệ thống của agent ngoài khi bật (nhắc công cụ mới).
