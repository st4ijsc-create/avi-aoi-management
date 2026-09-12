# Đợt 49 — vá theo QA lần 7 (chốt HEAD sau khi QA commit `.qa-dot48/`)

Bạn là agent XÂY cho Twin 3D — worktree `D:/SOURCES/_twin_wt`, nhánh `feat/twin-3d-trung-tam`. KHÔNG làm trong `D:/SOURCES/avi-aoi-management` (phiên khác; 3001/3008 đang phục vụ `_twin_wt/dist` — KHÔNG rebuild `dist/`). Đọc trước: `.qa-dot48/BAO-CAO.md` (QA lần 7), spec `docs/superpowers/specs/2026-09-06-nha-may-3d-digital-twin-design.md` §14q.26 (Đợt 47, G124/G125), `client/src/components/twin3d/loi/{LoBatchMay,KhungCanh,LopNhan,locNhan,cheDoDo,hopDaVe}.ts(x)`, `van-hanh/{LopCanhBao,locBadge}.ts(x)`, `e2e/twin-dot47-bam-canh.spec.ts`.

## 0. Cây (đo, không tin brief — G83)
- HEAD kỳ vọng `3709be0d` hoặc + N commit `docs(...)`/`test(qa/dot48)` xuất hiện trong lúc chạy (G121); khác ⇒ ghi `.qa-dot49/00-head-XONG.txt`, DỪNG chờ tôi. Porcelain: `knowledge/*` (~180, sinh tự động), `.qa-*`, `uploads/aoi-cache/BG87-*`, `test-results/zz-*` bẩn sẵn — bỏ qua; tệp mã phải sạch.
- Cổng riêng **3049** (cấm 3000/3001/3008/5173/8080/3047/3048). Build vào outDir **tuyệt đối ngoài `client/`** (`vite.config.ts:28 root: client/` làm `--outDir` tương đối rơi vào `client/…`) — ví dụ `D:/SOURCES/_twin_wt/.qa-dot49/dist-kiem`; md5 build lặp = khớp (G120); tắt server khi xong (`trap EXIT`).
- DB dev bất biến: `node .qa-dot37/db.mjs dem` (11 khoá: factories 2 · twin_dat_cho 82 · stations 37 · machines_active 42 · users 10 · andon 7 · andon_raised 0 · hb 108 · msl 7814 · permissions 104 · ufa 3) + `node .qa-dot34/dem.mjs` (6 khoá) trước/sau; hàng tạm `trap`. 5 ảnh `test-results/` giữ md5. 8 tệp tracked `.qa-dot47/e2e/*` giữ md5 (spec Đợt 47 ghi cứng `ANH=".qa-dot47/e2e"` — xem F).
- Commit theo MỤC bằng pathspec (hook chặn commit trần); mỗi bước `.qa-dot49/<bước>-XONG.txt` (không im lặng > 10′). Không xoá tệp dự án, không `reset/checkout -f/stash`, không merge `main`, không chạm 5 màn cũ (`MachineCockpit`, `RobotCockpit`, `DigitalTwinCenter`, `TwinHub`, `/factory-command`).

## A (★★★) Nhãn của máy A đè lên khối máy B và "cướp" click — K7a `/twin`@1600 (máy 246 → mở máy 1 vì điểm (687,527) nằm trong nhãn "SIM-L1-SPI"), K7b Line@1280 (máy 23 → 21, nhãn "SCREW")
0. Cơ chế QA đọc ra (xác nhận lại trước khi vá): `LopNhan.tsx:194-207` `khiBam` lấy **hộp nhãn ĐẦU TIÊN trong `hopDaVe` chứa điểm bấm**, `stopPropagation()` ("nhãn thắng máy phía sau") rồi `onChonNhan(trung.machineId)`. Nhãn bấm được (Đợt 47 N5) là đúng thiết kế; cái sai là **nhãn được phép nằm đè lên khối máy khác**.
1. Đo trước (`.qa-dot49/probe/`) — QA đã có census `k7-nhan-che.mjs`: **5/8 khung có máy bị phủ, 13 lượt/212 tâm** (`/twin`@1600 3/42 mặc định → **5/42 sau kéo**; `/twin`@1280 3/42; Line@1280 2/10 sau kéo); `onChonNhan` chỉ nối ở `CanhVanHanh.tsx:594` và **0 test tham chiếu**. Đo lại rồi mỗi màn×vp (`/twin`, `/twin/line/2` × 1280/1600, mặc định + sau kéo 60 px), đếm cặp (nhãn máy A ∩ hộp chiếu khối máy B, A≠B) + diện tích, và số máy có TÂM bị nhãn máy khác đè; ghi số.
2. Vá `locNhan.ts`: hộp chiếu khối máy KHÁC là **vùng tránh mềm** (sau vùng cấm DOM/badge): dời lên/xuống/ngang trong ngân sách; hết chỗ ⇒ giữ (không giấu). Nhãn của CHÍNH máy được đè khối của nó. Lưới unit: nhãn ∩ khối máy khác = 0 khi còn chỗ; `xepTang` tắt ⇒ y hệt bản cũ (+ca).
3. `cheDoDo.ts`: `hitTai` trả thêm `machineId` (batchId → id) và `domTai` (`document.elementFromPoint` tag + `data-machine-id`); `tamMay` trả thêm `diemThay` (raycast camera→tâm, giao đầu tiên là chính máy ⇒ điểm ấy; bị máy khác che ⇒ `biChe: id`).
4. Lưới: `e2e/twin-dot47-bam-canh.spec.ts` + bản chép `.qa-dot49/k7.mjs` (từ `.qa-dot48/k7.mjs`, KHÔNG sửa của QA): chọn điểm bấm với `hitTai.machineId === id && domTai ∈ canvas`; ca riêng "tâm bị nhãn máy khác đè" 4 màn×vp: ghi số trước vá, = 0 sau vá; ca K7a@1600/K7b@1280 nguyên trạng (bấm đúng tâm đã đo) phải ra đúng máy.
5. Gỡ vá 2 chiều trên dist: gỡ 2 ⇒ số cặp đè quay lại + K7a@1600 sai máy; giữ ⇒ 0 + đúng máy.

## B `LoBatchMay.tsx:205` deps `[may]` dựng lại BatchedMesh mỗi khi màu đổi
Tách hình/vị trí (dựng khi tập máy/vị trí đổi) vs màu (`setColorAt` khi trạng thái đổi). Đo `__demTuongTac.soLanDungLo` trong 60 s live trước/sau; e2e bấm cảnh vẫn 12/12 (handler trên `<group>` — G124).

## C `/twin` nhãn bất thường 3/6 @1600, 1/6 @1280 — `locNhan.ts:188` chỉ xếp tầng dọc
Thêm dời ngang trong vùng L1 trước khi bỏ; đo `thigiac47` vi+en 22 trạng thái: ghi số nhãn bất thường hiện được trước/sau (không nới tiêu chí).

## D Badge bị GIẤU không có chỉ báo — `/twin`@1280 `tong 7 · ve 5 · soAn 2 · biChe 2` (QA 4.2), `locBadge.ts:182` `SO_BUOC_DOI_CHO=3`
(1) tăng bước dời có ngân sách (≤ 6) + dời chéo; (2) badge vẫn ẩn ⇒ chip đáy canvas đếm cả **"còn N cảnh báo ẩn"** (không chỉ tên máy), có bbox trong canvas (G122). Đo `__demBadge.biChe/soAn` @1280+1600 trước/sau; ảnh tự đọc.

## E Census có sẵn đỏ — `phamViDocCensus.test.ts`, `phamViTuyenCensus.test.ts` (4 ca)
Số đo: C 474 · D 1119 · S 324 · tổng 2267; tuyến `server/_core/index.ts:653`; sổ nợ 3 mục `maintenanceRouter.{getWorkOrder,listWorkOrders,summary}` "nay là nhóm S". Tìm VÌ SAO dân số đổi khi 0 commit chạm `server/drizzle/shared` từ baseline `d7a6a6c7` (kiểm `git log -p d7a6a6c7 -- server/routers/phamViDocCensus.test.ts`; lưới lúc đó có xanh không). Cập nhật `GHIM` **kèm lý do trong docblock** (đừng sửa cho xanh); xoá 3 mục khỏi `phamViDocBaseline.ts`, hạ `GHIM.A` tương ứng — trả nợ thấy trong diff. Commit riêng `test(census/dot49)`.

## F Nhỏ
- `e2e/twin-dot47-bam-canh.spec.ts`: thư mục ảnh `ANH` lấy từ env `TWIN_E2E_ANH` (mặc định như cũ) để QA chạy lại không ghi đè 8 tệp tracked; ảnh "sau bấm" chụp SAU khi màn Máy vẽ xong (`may-dang-tai=0`, `__thongKeVe.calls>0`) — bằng chứng Đợt 47 là spinner (QA lần 7 mục 3); cập nhật 4 PNG `.qa-dot47/e2e/*-sau-bam.png` bằng ảnh thật (commit riêng, 4 PNG nhị phân được phép).
- `KhungCanh.tsx:211` sửa chú thích thứ tự `useFrame`; cursor thống nhất `CanhNhaMay.tsx:317` "grab" vs `CanhVanHanh.tsx:533`.
- Ghi nhận, KHÔNG vá màn cũ: `/factory-command` tab 3D 42 máy chồng MỘT điểm (0 hàng `machine_positions`, G102) ⇒ bấm 246 mở Sheet SIM-L3-PWR — ghi vào còn mở.
- (mục F1 cũ của tôi đã chuyển thành **H** — xem dưới; kết luận "nhiễu tải" của tôi SAI)

## G Đo sống (E Đợt 47) nếu QA lần 7 chưa đo
Vai tạm không `taoPhieu` (user TẠM, `trap` xoá) ⇒ `/twin/may/14` không có `<section nhom-tao-viec>`; vai có ⇒ có. Ghi số.

## H (★★ mới — thay cho "F1 nhiễu tải") Thời gian tới màn > 2,5 s vì DB chậm, KHÔNG phải fonts/CDN
QA lần 7 tách đúng hai kết cục: **fonts/CDN 28/28 ĐẠT (đóng, kể cả mạng `treo` 60 s: 4/4 ≤ 1,4 s)**; "thời gian tới màn" 23/28 ≤ 2,5 s, **5 đột biến 2,6–6 s đổi màn mỗi lượt**, trùng **690 `[SLOW QUERY]`/85′** trên DB dùng chung: `robot_telemetry DISTINCT ON ("robotId") … AT TIME ZONE` **321× max 4,0 s**; robot state select **74× max 14,0 s**; sức khoẻ máy 77×.
1. Đo lại trên **DB riêng** (clone `_test` hoặc cửa sổ máy rảnh) để cô lập — QA nói thẳng là chưa cô lập được.
2. Đọc mã 3 truy vấn; nếu thiếu index thì đề xuất `(robotId, timestamp DESC)` + migration; nếu do broadcaster gọi mỗi nhịp thì cache/giảm nhịp. **Migration phải là bước riêng, có số hiệu, không chạy trên DB dev khi phiên khác đang dùng** — hỏi tôi trước khi áp.
3. `AT TIME ZONE` trong câu này: kiểm luôn G104 (`db.execute` thô lệch −7 h) — 7 câu còn lại trong sổ.

## Hồi quy + cổng đóng
`vitest twin3d` ≥ 101/2.424 · e2e bấm cảnh 12/12 (+ca mới) · `thigiac47` vi+en 22×2 · `bbox46` 34/34 · lệch lớp 8/8 (`.qa-dot48/probe-lop48.mjs`) · D-1 (`.qa-dot44/do32.mjs` + `tomtat-D1` thêm cột 49) · D-2 chặn K/E/I/P · F1 · D-4 API 6 vai (`.qa-dot48/`) · 4 lưới phạm vi 180/180 (`twinBonManApiVaiPhamVi` 115 + `factoryCommandAssetCockpitPhamVi` 22 + `digitalTwinPhamVi` 15 + `maintenanceAndonPhamVi` 28) · `check` 0 · `i18n:check` 0 · `kiem-vo` · R3F 40 s 3 màn = 0 (`.qa-dot48/nguon-khung48.mjs`) · DB/md5/cổng. Báo cáo 9 mục: cây · từng mục A–G trước/sau/gỡ-vá với số + ảnh tự đọc · commit · hồi quy · test đỏ (của bạn / có sẵn) · brief SAI ở đâu (đếm) · còn mở `file:line` · cổng đóng phiên.
