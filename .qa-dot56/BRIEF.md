# Đợt 56 — 8 chỗ `DISTINCT ON` trên đường người dùng + dọn kiểu `e2e/` + dựng lại `dist/` (chủ sở hữu đã duyệt)

Bạn là agent XÂY — worktree `D:/SOURCES/_twin_wt`, nhánh `feat/twin-3d-trung-tam`. KHÔNG làm trong `D:/SOURCES/avi-aoi-management` (phiên khác).

Bối cảnh: Twin đã **nghiệm thu cuối ĐẠT 5/5** (QA lần 9). Đợt 55 phát hiện `factoryCommandService.ts` còn **8 chỗ `DISTINCT ON`** nằm **trên đường người dùng cả 3 màn Twin** (`useTrangThaiSong.ts:87`) — cùng lớp lỗi đã vá ở Đợt 53 (`:290`) và QĐ-27.

## 0. Cây
- HEAD kỳ vọng `f4e74493` hoặc + N commit `docs(...)` (G121); khác ⇒ `.qa-dot56/00-head-XONG.txt` + DỪNG.
- Cổng riêng **3056** (cấm 3000/3001/3008/5173/8080/3047…3055). `trap EXIT`.
- DB dev bất biến (11 + 6 khoá trước/sau; hàng tạm `trap`). 5 ảnh `test-results/` giữ md5 — **lưu ý `playwright.config.ts` nay có `outputDir: ".qa-pw-output"`, đừng bỏ nó** (không có nó Playwright dọn sạch `test-results/`). `.qa-dot47/` 103 tệp 0 byte — không đắp, không xoá. Không `cmd > "$f"`.
- Commit theo mục bằng pathspec; `.qa-dot56/<bước>-XONG.txt`; không im lặng > 10′; không `reset/checkout -f/stash`; không merge `main`; không sửa 5 màn cũ (UI).

## A (★★★) 8 chỗ `DISTINCT ON` trong `server/services/factoryCommandService.ts` trên đường người dùng
1. **Liệt kê trước khi vá** (G131): mỗi chỗ — số dòng, bảng, cột sắp, ai gọi (grep chuỗi gọi tới `useTrangThaiSong.ts:87` / router), tần suất, **EXPLAIN (ANALYZE, BUFFERS) ấm**, số hàng quét, có external merge không.
2. **Chỉ vá chỗ là bệnh thật** (G137: log chậm ≠ bệnh; tiêu chí: quét > 50 000 hàng **hoặc** external merge **hoặc** ấm > 20 ms). Chỗ bảng nhỏ, sort trong RAM ⇒ **để nguyên**, ghi rõ lý do.
3. Cách vá theo thứ tự ưu tiên: dùng đúng cột đã có index (khuôn Đợt 53: đổi `ORDER BY` cho khớp index) → per-máy `LIMIT 1` (khuôn `server/db/telemetryMoiNhat.ts`) → thu hẹp WHERE theo cửa sổ thời gian. **KHÔNG tạo index mới, KHÔNG migration** (QĐ-27 là ngoại lệ duy nhất, đã áp). Cần index ⇒ dừng, đề xuất kèm số, hỏi tôi.
4. **Đối chứng đầu ra bằng byte**: md5 JSON của thủ tục trước/sau ≥ 2 vai (admin + operator1), và nếu dữ liệu trôi thì đo hai kế hoạch trong **cùng snapshot `REPEATABLE READ`** (khuôn Đợt 51).
5. Ablation 2 chiều: gỡ vá ⇒ câu chậm quay lại trong `[SLOW QUERY]` (**stderr**) + EXPLAIN ấm xấu lại.

## B (★) `e2e/` chưa từng được `tsc` nhìn
`e2e/` **không nằm trong `tsconfig.json` lẫn `tsconfig.tests.json`** ⇒ 30 spec chưa bao giờ được kiểm kiểu; type-check riêng ra **5 lỗi có sẵn** (`twin-lo-u.spec.ts:2`, `twin-lo-v.spec.ts:3` thiếu `@types/pngjs`; `twin-studio-thiet-ke.spec.ts:129,132,134`).
1. Đưa `e2e/` vào cổng kiểu (thêm vào `tsconfig.tests.json` hoặc tsconfig riêng cho e2e — chọn cách ít xáo trộn nhất, giải thích).
2. Sửa 5 lỗi: `@types/pngjs` thêm vào `devDependencies` **nếu gói đã có trong `node_modules`** (đừng cài mạng nếu môi trường chặn — báo lại); 3 lỗi còn lại sửa kiểu trong spec, **không đổi assertion**.
3. Sau đó: `check:tests` (hoặc cổng kiểu mới) phải **0 lỗi trong `e2e/`**; `--list` vẫn 151 test / 30 tệp.

## C (chủ sở hữu ĐÃ DUYỆT) Dựng lại `dist/` từ HEAD
`dist/` hiện dựng 2026-09-12 03:52 từ cây **trước Đợt 49** (bundle không chứa `hopManHinh`/`hopKhoiMay`); 3001 (PID 37128) và 3008 (PID 38472) của **phiên khác** đang phục vụ nó. Tôi đã báo phiên đó.
1. Ghi md5 toàn bộ `dist/` **trước** (danh sách tệp + md5) vào `.qa-dot56/md5-dist-truoc.txt`.
2. `NODE_ENV=production npm run build` (đúng lệnh repo dùng; **không** đổi cấu hình). Build **hai lần**, md5 khớp (G120).
3. Sau build: kiểm bundle **có** `hopManHinh`, `hopKhoiMay`, `hopNhanDaVe`; `scripts/kiem-vo-app-https.mjs` ĐẠT; `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/` và `:3008/` vẫn **200** (KHÔNG tắt/khởi động lại tiến trình của phiên khác).
4. Chạy lại **e2e bấm cảnh 16/16** trên `dist` mới (Đợt 55 có 4 ca T1g đỏ **chỉ vì nhị phân cũ**) và **24 ca thị giác + bbox 34/34 + 4 lưới phạm vi** — những phép đo Đợt 55 không chạy được.
5. `dist/` bị `.gitignore` ⇒ không commit; ghi rõ trong báo cáo: md5 trước/sau, thời điểm, ai đang phục vụ.

## D (ghi) Cập nhật `.qa-dot56/NO.md` từ `.qa-dot55/NO.md`
Đóng những món đợt này đóng; giữ nguyên phần còn lại (production index QĐ-27; `kb:operational-cards:test` 194≠164; `ext:check` thiếu `@types/vscode`; `npm test` 97 tệp/205 ca; 41 cặp G128; bộ chọn tầng 1 toà/1 tầng; 31 chỗ `DISTINCT ON` ngoài Twin).

## Hồi quy + cổng đóng
`vitest twin3d` ≥ 105/2 483 · `check` 0 · `check:tests` ≤ 27 và **0 trong twin3d**, 0 trong `e2e/` (sau B) · `i18n:check` 0 · `lint:tokens` 0 · `kiem-vo` · e2e bấm cảnh **16/16** · 24 ca thị giác × vi/en · bbox 34/34 · 4 lưới phạm vi 180/180 · D-1 (cột 56) · F1 ≥ 7 lượt + `[SLOW QUERY]` từ stderr · DB/md5/cổng.
Báo cáo 8 mục: cây · A (bảng 8 chỗ: dòng, bảng, ai gọi, EXPLAIN ấm trước/sau, vá hay không + lý do; md5 đối chứng; ablation) · B · C (md5 dist trước/sau, 2 cổng vẫn 200, 4 phép đo chạy lại) · D · commit · hồi quy · brief SAI ở đâu (đếm) + lỗi của chính bạn · cổng đóng phiên.
