# Đợt 48 — QA lần 7 (độc lập, thị giác + đường người dùng thật) — KHUNG, điền HEAD/số khi Đợt 47 báo cáo

Bạn là QA ĐỘC LẬP cho Twin 3D (`feat/twin-3d-trung-tam`, worktree `D:/SOURCES/_twin_wt`). Việc đầu tiên: gọi `Skill pdca`. Bạn KHÔNG sửa mã sản phẩm, KHÔNG commit vào `client/`, `server/`, `e2e/`; chỉ ghi vào `.qa-dot48/` (và commit thư mục đó bằng pathspec khi xong). Mọi bước để lại `.qa-dot48/<bước>-XONG.txt` (1 dòng kết quả) để tôi theo dõi.

## 0. Trạng thái cây (đo, không tin brief — G83)
- HEAD kỳ vọng `60cd57fe` **hoặc `60cd57fe` + N commit `docs(...)`** (G121). Khác ⇒ ghi `.qa-dot48/00-head-XONG.txt` rồi DỪNG chờ tôi.
- `git status --porcelain` ngoài `.qa-dot4*/` phải rỗng; `git diff --cached` rỗng.
- Cổng riêng **3048** (cấm 3000/3001/3008/5173/8080/3047). Build `dist` vào outDir riêng `NODE_ENV=production` + md5 bundle so với lần build thứ hai = khớp (G120). Tắt server 3048 khi xong (`trap EXIT`).
- DB dev bất biến: `node .qa-dot34/dem.mjs` trước/sau phải bằng nhau (factories 2 · twin_dat_cho 82 · stations 37 · machines isActive 42 · users 10 · andon 7 · hb 108 · msl 7814 · perm 104 · ufa 3 · api_keys 55). Hàng tạm ⇒ `trap`.
- 5 ảnh đã commit trong `test-results/` giữ md5 (`git ls-files test-results | xargs md5sum` so `git show HEAD:`).

## 1. Kết cục gốc — ĐÚNG ĐƯỜNG NGƯỜI DÙNG (G123) — ca bắt buộc, mỗi ca 2 vp 1280×720 + 1600×900, vai `e2e_tai_loE` (kiểm `auth.me` thật — G100)
- K7a `/twin`: `page.mouse.click` vào TÂM KHỐI MÁY trên canvas (không qua danh sách/dải/cây) ⇒ `/twin/may/:id` đúng id; đo độ trễ trong trang (click→pushState); chụp TRƯỚC và SAU khi màn Máy đã vẽ xong (không chụp spinner).
- K7b `/twin/line/2`: như trên.
- K7c bấm SÀN TRỐNG ⇒ URL không đổi; K7d KÉO 60 px ⇒ camera xoay, URL không đổi; K7e rê lên máy ⇒ `canvas.style.cursor==="pointer"`, rời ⇒ không; K7f bấm NHÃN máy ⇒ cùng đích.
- Cửa sổ đo dev `?do=1` ⇒ `window.__demTuongTac.demObject()` phải `coHandler===soObject===trongScene`, tên nhóm `twin3d-lo-may-su-kien`. Tái dùng `e2e/twin-dot47-bam-canh.spec.ts` (đọc, KHÔNG sửa) và `.qa-dot47/probe/*`.
- Đối chứng dương cùng kit: `/factory-command` tab 3D cũng bấm được.

## 2. Thị giác — badge & nhãn (N1/N5 Đợt 47)
- Lệch lớp-vs-canvas cho CẢ HAI lớp `lop-nhan` và `lop-canh-bao`: (dx,dy)=(0,0) ở 4 màn×vp (`/twin`, `/twin/line/2`, `/twin/may/14`, `/twin-studio`) — G110: đo mọi `<Html fullscreen>` chứ không một lớp.
- 22 trạng thái `.qa-dot46/thigiac46.mjs` (tái dùng/mở rộng): badge bị `[data-che-nhan]` che = 0; nhãn × badge chồng = 0; cặp chồng nhãn = 0; chip "còn N tên bị ẩn" có bbox trong canvas (G122).
- bbox 34/34 mục thiết kế (QĐ-26) tái dùng `.qa-dot46/bbox46*.mjs` + badge.
- **Tự đọc ảnh PNG** (Read) cho ít nhất 6 ảnh then chốt; DOM count không phải bằng chứng thị giác.

## 3. Hồi quy (tái dùng harness, không viết lại)
- D-1 48 ca × 2 vp (`.qa-dot46/tomtat-D1` 7 cột thêm cột QA lần 7).
- K (`.qa-dot33/do.mjs`), E (`.qa-dot35/tomtat.mjs`), I (`.qa-dot36/`), P (`.qa-dot44/do38.mjs`), F fonts 4 mạng (`.qa-dot43/f1-fonts.mjs --mang=thuong|chan|cham|treo`), an ninh `.qa-dot41/{api-vai,http-v1,socket-vai}.mjs` + `do-D4-api.sh` (operator1 0 gán ⇒ rỗng/404/403; API key thiếu scope ⇒ 404).
- `npx vitest run client/src/components/twin3d` ≥ **101 tệp / 2.424 ca**; `server/routers/twinBonManApiVaiPhamVi.db.test.ts` 115 ca; 4 lưới 180/180; `npm run check` 0; `npm run i18n:check` 0; commit R3F/40 s = 0 ở 3 màn (`/twin`, Line, Máy) — G110.
- `scripts/kiem-vo-app-https.mjs` 0 https ngoài.
- **Census có sẵn đỏ (ghi nhận, KHÔNG sửa):** `server/routers/phamViDocCensus.test.ts` + `phamViTuyenCensus.test.ts` 4 test đỏ tại HEAD (dân số C 472→474, D 1101→1119, S 290→324, tổng 2234→2267; 3 mục `maintenanceRouter.{getWorkOrder,listWorkOrders,summary}` đã vá còn trong sổ nợ `phamViDocBaseline.ts`; tuyến `server/_core/index.ts:650→653`). 0 commit Đợt 47 chạm `server/` ⇒ có sẵn trước Đợt 47. Bạn đo lại, ghi số thật vào báo cáo mục 5; việc cập nhật GHIM + trả nợ giao Đợt 49.

## 4. Báo cáo `.qa-dot48/BAO-CAO.md` (9 mục)
1 HEAD+cây · 2 bảng ca ĐẠT/SAI/HỎNG (mã ca, phép đo, số, ảnh) · 3 kết cục gốc K7 với số trễ · 4 thị giác (bảng lệch lớp 4×2, 22 trạng thái) · 5 hồi quy · 6 Pareto SAI theo nguyên nhân · 7 những gì brief này SAI so với cây (đếm) · 8 DB/md5/cổng trước-sau · 9 đề xuất Đợt 49 (KHÔNG tự sửa).
Không xoá tệp dự án, không `git reset/checkout -f/stash`, không merge `main`, không chạm 5 màn cũ. Commit duy nhất: `test(qa/dot48): ...` với pathspec `.qa-dot48/`.
