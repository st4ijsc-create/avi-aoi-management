# Đợt 10.4b L3c — `search_docs` cho agent máy chủ chạy model NGOÀI: HỢP ĐỒNG (bản nháp do-model 03/11)

Nguồn: hợp đồng L3 `docs/superpowers/plans/2026-10-30-dot10-4b-L3-agent-ngoai-hop-dong.md` (k7: "`search_docs` ⇒ L3c riêng"; Q4 kiem-dinh:
"lọc `laTaiLieuSanPham` như L1"). Nhánh `feat/ai-do-l3c` nối sau H3.3b (`29bd371f2` — cùng tệp `vongAgentNgoai.ts`).

## 1. Hiện trạng
- Lượt agent ngoài quảng bá đúng `read_file` · `list_dir` · `grep` (+ `todo_write` lõi). `search_docs` nằm trong danh sách KHÔNG quảng bá.
- `search_docs` cục bộ (`timTaiLieuAgent.timTaiLieuMacDinh`) = api-ref .NET (tất định, tệp trong repo) ∪ nhánh lập trình của
  `retrieveKnowledge(route:"vscode")` = tài liệu HÃNG (`searchProgrammingKb`) ∪ kho **Training Studio** (tài liệu người dùng tải lên —
  có thể chứa dữ liệu nhà máy; cổng vai `canAccessStudioCorpus`).

## 2. Đề xuất
1. Bộ tìm tài liệu NGOÀI riêng (không đổi `timTaiLieuMacDinh`): CHỈ `corpus ∈ {vendor, api}` — **KHÔNG BAO GIỜ Studio** (kể cả
   `corpus:"all"` ⇒ chỉ vendor + api; `corpus:"studio"` ⇒ kết quả rỗng + "không có kho này khi dùng model ngoài").
   - vendor: gọi THẲNG `searchProgrammingKb` (không qua `retrieveKnowledge` — không có nhánh Studio để lọt) + khoá thứ hai như L1:
     `sourcePath` của chunk phải nằm dưới thư mục corpus tài liệu hãng đã biết (đo đường thật của `knowledge/programming*` trước khi ghim);
     chunk không qua ⇒ bỏ, đếm.
   - api: `timTrongApiRef` (chỉ mục .NET trong repo) như cũ.
2. Tool `search_docs` vào tập quảng bá của bộ chuyển ngoài, định nghĩa hẹp `{ query: string, corpus?: "vendor"|"api"|"all" }` (`additionalProperties:false`).
   Bộ thực thi: chế độ ≠ `hoi` ⇒ `NGOAI_TOOL_KHONG_CAP` như các tool khác; trần số lần gọi mỗi lượt (đề xuất 4) + trần ký tự kết quả như tool đọc.
3. Mức dữ liệu: kết quả tool `search_docs` vào `ghepPhan` là phần `truy-hoi-kb` với `loaiKho` = `vendor` / `api` (⇒ `ky-thuat` theo bảng
   L0a) — KHÔNG gắn `ma-repo`. Bất kỳ đoạn nào không xác định được kho ⇒ không gửi (fail-closed).
4. Kết quả qua cổng như mọi tool (bộ che `cheDuLieu`, khối tool gốc nếu cờ H3.3b bật). Sự kiện `ket-qua-tool` như cục bộ (`soKetQua`).
5. Lưới + đột biến: Studio không bao giờ được gọi (spy `retrieveKnowledge` = 0 lần; `searchProgrammingKb` được gọi); chunk vendor ngoài
   thư mục corpus ⇒ bỏ; `corpus:"studio"` ⇒ rỗng; mức `truy-hoi-kb`/vendor ⇒ ky-thuat (không hạ, không nâng); chế độ khác `hoi` ⇒ từ chối;
   trần lần gọi; census `duongVong` / `phanLoaiNut` ghim lại nếu đổi điểm.

## 3. Cần quyết
- (Q1) Loại Studio hoàn toàn khỏi lượt ngoài (đề xuất) — hay cho Studio khi nhà máy `choDuLieuVanHanh` (mức van-hanh)?
- (Q2) Trần 4 lần `search_docs` mỗi lượt ngoài?
- (Q3) Mở cho bề mặt `agent` vẫn là quyết riêng sau L3b (không đổi ở L3c).
