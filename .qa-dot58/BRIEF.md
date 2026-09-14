# Đợt 58 — QA lần 10: xác nhận bốn mục thiết kế (QĐ-29) + phân xử 2 SAI của thước đo

Bạn là QA ĐỘC LẬP — worktree `D:/SOURCES/_twin_wt`, nhánh `feat/twin-3d-trung-tam`. KHÔNG làm trong `D:/SOURCES/avi-aoi-management` (phiên khác; cổng 3000 của họ **đã tắt theo QĐ-28** — KHÔNG bật lại).

**Việc đầu tiên: gọi `Skill pdca`.** KHÔNG sửa mã sản phẩm, KHÔNG sửa `e2e/`; chỉ ghi + commit `.qa-dot58/` (pathspec). Mỗi bước `.qa-dot58/<bước>-XONG.txt`; đừng im lặng > 10′.

Bối cảnh: Twin đã **nghiệm thu cuối ĐẠT 5/5** (QA lần 9). Đợt 57 làm **bốn mục thiết kế 10–13** mà chủ sở hữu duyệt (QĐ-29) — **chưa ai QA độc lập bốn mục này**. Đợt 57 cũng báo D-1 cột 57 có **2 SAI** và tự kết luận đó là "nợ thiết bị đo"; bạn phải **phân xử độc lập**, đừng kế thừa lời khai.

## 0. Cây + hệ đo (MSA)
- HEAD kỳ vọng `a3032508` hoặc + N commit `docs(...)` (G121); khác ⇒ `.qa-dot58/00-head-XONG.txt` + DỪNG.
- Cổng riêng **3058** (cấm 3000/3001/3008/5173/8080/3047…3057). **3001 (PID 23980) / 3008 (PID 32584) là server của chủ dự án — KHÔNG kill, KHÔNG rebuild `dist/`.** outDir **tuyệt đối ngoài `client/`**; md5 build lặp khớp (G120); `trap EXIT`.
- **G141:** trước mọi phép đo trên một bản dựng, **chứng minh bản dựng là của commit đang đo** — grep ký hiệu mới trong bundle (Đợt 57 thêm `vien-tin-cay-may`, `mauChuTrenNen`; Đợt 53 `hopManHinh`) + md5 build lặp.
- DB dev bất biến (`node .qa-dot37/db.mjs dem` 11 khoá + `.qa-dot34/dem.mjs` 6 khoá trước/sau; hàng tạm `trap`). 5 ảnh `test-results/` giữ md5; **giữ `outputDir: ".qa-pw-output"`** (G140). `.qa-dot47/` 103 tệp 0 byte — không đắp, không xoá. Không `cmd > "$f"` (G130).

## 1. Xác nhận bốn mục thiết kế — mỗi mục đo lại TỪ ĐẦU + ablation trên bản dựng trước vá
Dựng thêm một `dist` từ **`2f835df1`** (trước Đợt 57) làm nền; mọi kết luận "0" phải kèm số khác 0 trên nền ấy (G139).

- **M10 tay nắm**: diện tích giao giữa nút "‹"/"›" và mọi icon+chữ trong panel, 4 màn × 2 vp × vi/en ⇒ kỳ vọng **0 px²** (nền: 167 px² @1280). **Và** kiểm hệ quả bản vá: nút nay nằm trên cảnh ⇒ nhãn máy bị nút che phải = **0** (Đợt 57 vá bằng `data-che-nhan`; gỡ thuộc tính ⇒ phải ĐỎ).
- **M11 tương phản**: tự đo WCAG trên **pixel thật** (đừng đọc lại số của Đợt 57): mọi chuỗi ≤ 12 px, 5 màn × 2 vp × vi/en ⇒ chữ thường ≥ 4,5; chữ ≥ 18,66 px hoặc bold ≥ 14 px ≥ 3,0. Nền kỳ vọng: **104 chuỗi dưới ngưỡng**. Ghi rõ chuỗi nào bị **ô cuộn cắt / dải thời gian che** (Đợt 57 nói 80 chuỗi) — đó là ca đo được hay không đo được?
- **M12 màn Máy**: đếm số lần mã máy xuất hiện trong canvas + khung quanh (nền 4, máy có cảnh báo 5) ⇒ kỳ vọng ≤ 3 / ≤ 4; vị trí `vien-tin-cay-may` so với `/twin` (lệch ≤ 8 px); **và kiểm không mất thông tin**: mọi dữ kiện của chip đáy cảnh cũ (mã, trạng thái, loại, sức khoẻ, tuổi dữ liệu) phải còn tìm thấy ở đâu đó trên màn — liệt kê nơi.
- **M13 tồn đọng @1280**: số hàng nhìn thấy không cuộn (nền 1,51) ⇒ kỳ vọng ≥ 3; panel không tràn 720 px; @1600 không xấu đi; **đánh đổi** `danh-sach-may` 209→174 px có làm mất hàng nào không.
- Tự đọc **≥ 6 ảnh** (Read) cho bốn mục.

## 2. Phân xử 2 SAI ở D-1 cột 57 (đây là việc chính thứ hai)
Đợt 57 nói: `do32.mjs` (thước **đóng băng** từ Đợt 32) đọc `trang-thai-may` / `ngan-do-tuoi` mà mục 12 đã dời ⇒ 2 SAI là **nợ thiết bị đo**, không phải hồi quy sản phẩm. **Bạn phân xử:**
1. Chạy D-1 trên **cả hai** bản dựng (trước/sau Đợt 57) và đối chiếu từng ca.
2. Đo **bất biến gốc** của 2 ca đó bằng đường độc lập với testid (đọc nội dung hiển thị, không đọc thuộc tính): trạng thái máy trên màn Máy có khớp cockpit không? tuổi dữ liệu có khớp không?
3. Kết luận một trong ba: (a) nợ thiết bị đo — thước cần cập nhật (nói rõ cách, **không tự sửa** `do32.mjs`); (b) hồi quy sản phẩm thật; (c) không kết luận được.

## 3. Hồi quy + MỌI cổng trong `package.json` (G108 đã cắn 5 lần)
`vitest twin3d` ≥ 106/2 498 · e2e bấm cảnh 16/16 · 24 ca thị giác × vi/en · bbox 34/34 · lệch lớp 8/8 · 4 lưới phạm vi 180/180 · census xanh · D-2 chặn K/E/I/P · D-4 6 vai · F1 ≥ 7 lượt + `[SLOW QUERY]` từ **stderr** · 40 s đứng yên × 3 màn · `check` · `check:tests` (nền 27, 0 trong twin3d và e2e) · `i18n:check` · `lint:tokens` (report-only, tiêu chí **Δ = 0** so nền 1 111) · `kiem-vo` · và liệt kê + chạy mọi script kiểm còn lại, ghi cái nào đỏ sẵn, cái nào **có tác dụng phụ ghi vào cây** (G138 — `kb:operational-cards:test` ghi đè 169 tệp `knowledge/`; khai rõ nếu bạn chạy, KHÔNG khôi phục).
Ghi rõ: `e2e/twin-dot31-may.spec.ts:351` A5 được Đợt 57 báo là **nợ có sẵn** (spec ghim "2 canvas", nay 1) — xác nhận bằng `git archive` một mốc trước.

## 4. Báo cáo `.qa-dot58/BAO-CAO.md` (8 mục)
1 cây + MSA (gồm bằng chứng bản dựng đúng commit) · 2 bốn mục M10–M13: ĐÓNG/CHƯA kèm số **và số trên nền trước vá** · 3 phân xử 2 SAI · 4 hồi quy + bảng cổng · 5 Pareto nếu còn SAI · 6 brief này SAI ở đâu (đếm) + lỗi của chính bạn · 7 DB/md5/cổng trước–sau · 8 **PHÁN QUYẾT: bốn mục thiết kế ĐẠT/CHƯA, và nghiệm thu 5/5 của QA lần 9 có còn đứng vững sau Đợt 55–57 không** (nếu không, thiếu chính xác cái gì).
Không xoá tệp dự án, không `reset/checkout -f/stash`, không merge `main`, không chạm 5 màn cũ. Commit duy nhất: `test(qa/dot58): ...` pathspec `.qa-dot58/`.
