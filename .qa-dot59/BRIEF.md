# Đợt 59 — bốn món cuối sau QA lần 10 (nhỏ, gọn, không đổi kết cục đã nghiệm thu)

Bạn là agent XÂY — worktree `D:/SOURCES/_twin_wt`, nhánh `feat/twin-3d-trung-tam`. KHÔNG làm trong `D:/SOURCES/avi-aoi-management` (phiên khác; cổng 3000 **đã tắt theo QĐ-28** — không bật lại).

Bối cảnh: Twin **nghiệm thu cuối ĐẠT 5/5**, QA lần 10 (§14q.37) xác nhận bốn mục thiết kế ĐẠT 4/4 và tìm thêm bốn món dưới đây. **Không món nào được phép làm xấu các số đã nghiệm thu.**

## 0. Cây
- HEAD kỳ vọng `5e3a6295` hoặc + N commit `docs(...)` (G121); khác ⇒ `.qa-dot59/00-head-XONG.txt` + DỪNG.
- Cổng riêng **3059** (cấm 3000/3001/3008/5173/8080/3047…3058). **3001 (PID 23980) / 3008 (PID 32584) là server của chủ dự án — KHÔNG kill, KHÔNG rebuild `dist/`.** outDir tuyệt đối ngoài `client/`; `trap EXIT`.
- DB dev bất biến (11 + 6 khoá trước/sau; hàng tạm `trap`). 5 ảnh `test-results/` giữ md5; giữ `outputDir: ".qa-pw-output"` (G140). `.qa-dot47/` 103 tệp 0 byte — không đắp, không xoá. Không `cmd > "$f"` (G130). Trước khi chạy harness cũ: `grep -n "qa-dot[0-9]\+"`.
- Commit theo mục bằng pathspec; `.qa-dot59/<bước>-XONG.txt`; không im lặng > 10′; không `reset/checkout -f/stash`; không merge `main`; không sửa UI 5 màn cũ.
- **G147: mọi phép đo e2e phải ghi số worker** và chạy `--workers=1` cho các lưới so sánh.

## A (★★) Nhãn nằm dưới tay nắm sau khi THU rồi MỞ lại panel trái (@1600: 281 px², ở lì ≥ 17 s)
Lớp nhãn không tính lại khi panel đổi trạng thái; chỉ đổi cỡ cửa sổ mới dọn.
1. Tái hiện + đo trước: thu panel → mở lại → chờ 2 s / 5 s / 17 s, đo diện tích nhãn ∩ tay nắm ở 1280 và 1600, vi + en.
2. Vá: cho lớp nhãn tính lại khi trạng thái panel đổi (khuôn có sẵn: `KhungCanh.TheoDoiLopPhu` + `ResizeObserver` trên `[data-che-nhan]` — nếu tay nắm/panel không nằm trong tập quan sát thì đó chính là lỗ; **dùng lại cơ chế, đừng thêm cơ chế mới**).
3. Lưới: thêm trạng thái **"thu rồi mở panel"** vào bộ ca thị giác (24 → 26 ca × vi/en). Ablation: gỡ vá ⇒ ca mới ĐỎ.

## B (★★) Thước D-1 thế hệ mới — fail-closed, đọc theo NGHĨA (G146)
`do32.mjs` là bản **đóng băng** từ Đợt 32: **giữ nguyên**, không sửa. Viết `.qa-dot59/do59.mjs` (hoặc `scripts/` nếu hợp lý hơn — giải thích):
1. Mỗi ca: nếu **không đọc được** dữ kiện ⇒ **HỎNG**, không được XANH (ô #20 hiện `every()` trên tập rỗng ⇒ xanh giả).
2. Đọc theo **chữ hiển thị**/vai trò, không theo testid đã dời; với ô #15/#16/#20 dùng nguồn mà QA lần 10 đã chứng minh là đúng (nhãn 3D, viên tin cậy, ngăn phải, cockpit, hàng `/twin`).
3. Chạy trên **cả hai** bản dựng (HEAD và nền `2f835df1`): thước mới phải cho **48/48 có phán quyết**, 0 ô "xanh vì rỗng", và **chỉ ra đúng 3 ô** mà thước cũ sai (2 SAI oan + 1 xanh giả).
4. Ghi bảng đối chiếu `do32` vs `do59` từng ô vào báo cáo.

## C (★) @1600 `danh-sach-may` mất 1 hàng (9 → 8) sau mục 13
Cân lại chiều cao **chỉ ở 1600** sao cho: tồn đọng vẫn **≥ 3 hàng**, `danh-sach-may` trở lại **≥ 9 hàng**, panel không tràn 900 px, và @1280 **không xấu đi** (tồn đọng ≥ 3, danh sách ≥ 5). Nếu số học chứng minh không thể cùng thoả ⇒ **nói thẳng bằng số**, đề xuất đánh đổi, đừng nới tiêu chí.

## D (★) `--workers=1` thành mặc định có thể tái lập (G147)
Ghi vào docblock các spec so sánh + `playwright.config.ts` (hoặc script npm) sao cho lệnh chạy lưới so sánh **luôn 1 worker**, và các spec độc lập vẫn chạy song song được. Không đổi assertion. Đo: `--list` vẫn 151/30; e2e bấm cảnh 16/16 ở 1 worker; ghi rõ cấu hình trong docblock.

## Hồi quy + cổng đóng
`vitest twin3d` ≥ 106/2 498 (+ ca mới của A) · `check` 0 · `check:tests` 27 (0 twin3d, 0 e2e) · `i18n:check` 0 · `lint:tokens` Δ0 · `kiem-vo` · e2e bấm cảnh **16/16 (`--workers=1`)** · thị giác **26 ca × vi/en** · bbox 34/34 · lệch lớp 0 · 4 lưới phạm vi 180/180 · idle 40 s × 3 màn 0 khung · D-1 bằng **cả `do32` (đối chiếu lịch sử) và `do59`** · DB/md5/cổng.
Báo cáo 8 mục: cây · A/B/C/D trước–sau + ablation + ảnh tự đọc · bảng đối chiếu `do32` vs `do59` · commit · hồi quy · brief SAI ở đâu (đếm) + lỗi của chính bạn · còn mở `file:line` · cổng đóng phiên.
