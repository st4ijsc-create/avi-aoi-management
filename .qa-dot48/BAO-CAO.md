# Đợt 48 — QA lần 7 (độc lập) Twin 3D — BÁO CÁO

Worktree `D:/SOURCES/_twin_wt` · nhánh `feat/twin-3d-trung-tam` · cổng 3048 · vai `e2e_tai_loE` (auth.me thật: `supervisor`, gán NM1) · 2026-09-12 05:08 → 06:35.
Skill PDCA: Bước 0 (MSA) trước, đo KẾT CỤC đúng đường người dùng, tệp THÔ từng ca trong `.qa-dot48/` (người đọc tự đếm lại: `node .qa-dot48/tomtat-48.mjs` sinh `tomtat-48.md`).
**Không sửa mã sản phẩm, không sửa `e2e/`, không chạm `dist/` (3001/3008 đang phục vụ nó). Chưa vá gì, chưa ablation gốc rễ — giao Đợt 49.**

## 1. HEAD + cây (Bước 0 — MSA)

| Mục | Đo được | Bằng chứng |
|---|---|---|
| HEAD lúc bắt đầu | `60cd57fe` = kỳ vọng | `00-head-XONG.txt` 05:09 |
| HEAD lúc chạy/kết | **`a64723e1`** = `60cd57fe` + **1** commit `docs(twin3d/dot47): §14q.26…` chỉ đổi `docs/superpowers/specs/2026-09-06-nha-may-3d-digital-twin-design.md` (+27) — hợp G121, **0 tệp client/server/e2e đổi** ⇒ tiếp tục; đã push (`@{u}..HEAD` = 0) | `git diff --name-only 60cd57fe..HEAD`, `cong.log` |
| `git diff --cached` | rỗng (trước và sau) | `cong.log` |
| porcelain ngoài `.qa-dot4*/` | **KHÔNG rỗng** (brief nói phải rỗng): `knowledge/*` ~180 tệp M/D (sinh tự động kb), `.qa-loW/X/Y`, `uploads/aoi-cache/BG87-*` ×18, docs spec stat-dirty CRLF (`i/lf w/crlf`, diff rỗng) — **0 tệp `client/ server/ e2e/`** | `00-head-XONG.txt` |
| Thứ đang chạy = thứ vừa sửa (G120) | Build vào outDir RIÊNG `.qa-dot48/dist-kiem` (vite `--outDir` tuyệt đối + esbuild `--outdir`) — **build #1 = build #3 = `dist/` gốc 914/914 md5**; bundle `assets/index-Bqq-JPgM.js`; server 3048 chạy `node .qa-dot48/dist-kiem/index.js` (`server/_core/vite.ts:51` phục vụ `dist-kiem/public` bundle-relative) | `md5-dist-kiem.txt`, `md5-dist-kiem3.txt`, `md5-dist-goc.txt`, `md5-dist-diff-kiem3.txt` (diff exit 0), `build-XONG.txt` |
| ★ Lỗi hệ đo tự bắt | Build #2 **lệch 478/914** (bundle `index-BnM3xMkE.js`): `vite.config.ts:28 root: client/` ⇒ `--outDir` tương đối rơi vào `client/.qa-dot48/…`, build #2 quét thấy output build #1 nằm trong root (Tailwind content) ⇒ CSS/hash đổi dây chuyền. Đã `mv` về `.qa-dot48/dist-kiem`, **xoá `client/.qa-dot48`** (không commit), build #3 outDir tuyệt đối ⇒ 914/914. **Bài học: outDir đo phải nằm NGOÀI vite root.** | `md5-dist-diff.txt` (kiem vs kiem2) |
| Cache giữa các mẫu | mỗi ca mở context/page mới; dist tĩnh; DB không đổi (mục 8); F1 đo lại ×2 cho kết quả khác nhau (không cache) | |
| Cổng | 3048 rảnh trước khi bật; 3000 = `avi-aoi-management/dist` (bundle `tqmr4OwB`), **3001 + 3008 phục vụ bundle `Bqq-JPgM` = `_twin_wt/dist`** (phiên khác) ⇒ tuyệt đối không rebuild `dist/`; 8080 httpd; 5173/3047 rảnh; sau phiên: 3048 đã tắt (PID 23712 của tôi), 4 cổng kia nguyên | `00-head-XONG.txt`, `cong.log` |
| tsc | `npm run check` exit 0 trong ~7 s vì `tsconfig.json:6 incremental` + tsbuildinfo — đọc là "0 lỗi mới", không phải kiểm full | `check-cuoi.txt` |
| Phép đo tự thoả? | K7 đo bằng ĐƯỜNG NGƯỜI DÙNG (`mouse.click` toạ độ canvas) và đọc kết cục từ URL + DOM màn Máy + ảnh — độc lập với `__demTuongTac` (chỉ dùng để CHỌN điểm); census K7-NC bấm thử 2/2 xác nhận cơ chế | `k7/`, `run-k7.log`, `run-k7-nhan-che.log` |

## 2. Bảng ca ĐẠT / SAI / HỎNG / CHẶN-ĐÚNG (N = 269)

Phán quyết suy từ tín hiệu ghi trong tệp thô (cột cuối). "N/A" = không kết luận được.

| Mã | Phép đo (kết cục người dùng) | Số | PQ | Tệp thô / ảnh |
|---|---|---|---|---|
| K7a /twin @1600 | `mouse.click` tâm khối máy 246 (SN-SIMVERIFY-01) sau KÉO 60 px ⇒ URL | ⇒ **`/twin/may/1`** (SIM-L1-SPI); trễ trong trang 0,2 ms; màn Máy SPI vẽ xong 3 009 ms | **SAI** (sai máy) | `k7/k7-K7a-man-twin-van-hanh-1600x900.json`, `…-truoc.png` (nhãn "SIM-L1-SPI · Không rõ" hộp (628,526,139×24) đè tâm 246 tại (687,527)), `…-sau.png` |
| K7a /twin @1280 | như trên | ⇒ `/twin/may/246`, trễ 0,4 ms (PW 24 ms), vẽ xong 3 111 ms, canvas 1/kit 1, dangTai 0 | ĐẠT | `k7/k7-K7a-man-twin-van-hanh-1280x720.json` + 2 png |
| K7b /twin/line/2 @1600 | bấm tâm khối máy 23 (SIM-L2-ROBOT) sau kéo | ⇒ `/twin/may/23`, trễ 0,4 ms (PW 34 ms), vẽ xong 3 335 ms | ĐẠT | `k7/k7-K7b-man-twin-line-1600x900.json` + png |
| K7b /twin/line/2 @1280 | bấm tâm khối máy 23 sau kéo | ⇒ **`/twin/may/21`** (SIM-L2-SCREW), trễ 0,2 ms | **SAI** (sai máy) | `k7/k7-K7b-man-twin-line-1280x720.json`, `…-truoc.png` (nhãn "SCREW · Không rõ" tại (950,323)) |
| K7c ×4 | bấm sàn trống ⇒ URL không đổi | 4/4 không đổi | ĐẠT ×4 | `k7/k7-K7*-*.json` `urlSauSan` |
| K7d ×4 | kéo 60 px từ máy ⇒ camera đổi, pathname giữ | 4/4 (`/twin` ghi `?cam=` replaceState — hành vi §9.4) | ĐẠT ×4 | `camTruoc/camSau` |
| K7e ×4 | rê lên máy ⇒ `cursor=pointer`; rời ⇒ `auto` | 4/4 | ĐẠT ×4 | `cursorTrenMay/cursorTrenSan` |
| K7f ×4 | bấm NHÃN ⇒ `/twin/may/<data-machine-id>`; Back 1 lần về màn gốc; bấm KHỐI cùng máy ⇒ cùng đích | 4/4 (twin: nhãn ROBOT 23 ⇒ 23, khối 23 ⇒ 23; line: CONVEYOR 18 ⇒ 18 ⇒ 18) | ĐẠT ×4 | `k7/k7-K7f-*.json` |
| K7g ×4 | `?do=1` `demObject`: coHandler = soObject = trongScene, tên nhóm | 1/1/1 `["twin3d-lo-may-su-kien"]` ×4 | ĐẠT ×4 | `coChe` |
| K7h /factory-command 3D ×2 | đối chứng dương cùng kit: bấm tâm máy 246 ⇒ Sheet | cursor pointer, dialog 0→1, URL giữ — **nhưng Sheet mở "SIM-L3 PWR"** (246 = SN-SIMVERIFY-01): census FC 41 máy có 41 tâm khác nhau nhưng **chỉ 2/41 tâm raycast trúng instance riêng**; tâm 246 trúng batch #19 chung với 247/245/10/23/33/15/20 (5 máy trong 20 px) ⇒ khối chồng nhau dày, Sheet của máy đứng trước; 0 nhãn phủ | **N/A** (handler sống; id không đo được vì bố cục FC chồng) | `k7/k7-K7h-factory-command-*.json`, `…-sau.png`, `k7/nc-factory-command-*.json` |
| K7-NC census 8 khung | tâm KHỐI (bấm được) bị NHÃN máy KHÁC phủ — 2 màn × 2 vp × (mặc định, sau kéo 60 px) | /twin@1600: **3/42** mặc định (PACK 10 & SCREW 9 ← nhãn ROBOT 23; FCT 17 ← CONVEYOR 18) · **5/42** sau kéo (246, SPI-L2 13, AOI-L2 14, AVI-L2 15 ← nhãn SIM-L1-SPI 1; FCT 17 ← CONVEYOR 18) · /twin@1280: **3/42** mặc định (ASSY 8, PWR 7, SCREW 9 ← ROBOT 23), 0 sau kéo · Line@1600: 0/12, 0/10 · Line@1280: 0/12 mặc định, **2/10** sau kéo (ROBOT 23 ← SCREW 21; CONVEYOR 18 ← FCT 17) ⇒ **5/8 khung có máy bị phủ, 13 lượt máy/212** | **SAI 5 khung** · ĐẠT 3 | `k7/nc-*.json`, `nc-*-macdinh.png`, `nc-*-saukeo.png`, `run-k7-nhan-che.log` |
| K7-NC bấm thử ×2 | bấm THẬT tâm máy bị phủ ⇒ đích | /twin@1600: 246 ⇒ `/twin/may/1` · Line@1280: 23 ⇒ `/twin/may/21` — **2/2 = MÁY CỦA NHÃN thắng khối** (xác nhận K7a/K7b, không đếm thêm) | (xác nhận) | `bamBiPhu` trong `nc-*.json` |
| e2e spec Đợt 47 (12 ca) trên 3048 | `e2e/twin-dot47-bam-canh.spec.ts` (đọc, không sửa; sao lưu/khôi phục `.qa-dot47/e2e` md5 KHỚP) | **12 passed** (1,4′): T1a 246@(775,489)/(657,413) ⇒ 246; 13 ⇒ 13; trễ 0,3–0,5 ms; lớp badge = canvas 4/4 | ĐẠT 12 | `run-e2e-spec47.log`, `e2e-spec47/` |
| Lệch lớp 4 màn × 2 vp | `lop-nhan-twin3d` & `lop-canh-bao` vs canvas (+ mọi div absolute = canvas) | **(0,0,0,0) ở mọi nơi có lớp** (nhãn 6/6 màn có lớp; badge 4/4 ở twin+line; Máy/Studio không có lớp badge, Studio không có lớp nhãn); div absolute = canvas: 3/2/1/0 đều (0,0) | ĐẠT 8/8 | `lop/lop.json`, `run-lop48.log` (2 "TRƯỢT" trong log = luật đầu của tôi bắt nhầm thanh `lop-phu-dong-thoi-gian` đáy canvas, đã sửa luật) |
| Thị giác 22 trạng thái (vi) | nhãn/badge ngoàiCanvas·bịChe·cặpChồng·nhãn×badge = 0; chip trong canvas | **22/22** | ĐẠT 22 | `d3-vi/*.json|png`, `tomtat-48.md` |
| bbox 34 mục QĐ-26 | `bbox46.mjs` (bản 3048) | **34/34** | ĐẠT 34 | `run-bbox-qa7.log`, `bbox-qa7.json` |
| 40 s đứng yên ×3 màn (nguon-khung) | khung / rAF / commit theo renderer | twin **0 khung, rAF 0, commit R3F 0** (react-dom 50, ws 84, trpc 7) · line 0/0/0 (react-dom 55) · may 0/0/0 (react-dom 63) | ĐẠT 3 | `run-nguon-khung-*.log`, `nguon-khung/*.json` |
| p1 40 s ×3 màn (do38) | khung/40 s, cửa sổ 4 s ×10, kéo vẫn vẽ | 0 khung [0×10] cả 3; kéo 33/34/59 khung/1,5 s; canvas 1/kit 1 | ĐẠT 3 | `p1/p1-*-1600x900.json` |
| D-1 48 ca × 2 vp | `.qa-dot44/do32.mjs` nguyên trạng (35 lượt ✓ 35 / ✗ 0 / LOI 0), cột 8 "QA7 Đợt 48" | **ĐẠT 41 · xem #7/K1/K2 1 · N/A (mất lối vào) 1 · CHẶN-ĐÚNG 5** = y hệt Đợt 47; **0 đổi phán quyết** | ĐẠT 41 · CHẶN-ĐÚNG 5 · N/A 2 | `nen-1600x900/`, `nen-1280x720/`, `raised-1600x900/`, `tomtat-D1.txt`, `run-D1.log` |
| D-2 chan K/E/I/P (64) | do33/do35/do36/do38, mạng CDN chặn | ✓ 38 · ✗ 0 · ĐẠT 60 · TRƯỢT 4 · LOI 0 — 4 TRƯỢT = **đối chứng dương cố ý khai sai đích** (do33 K6, G92; Đợt 46/47 cùng 4) · P3 Status offline/error · P4 canvas 1/1 ở 3 trạng thái tab · P5 4 màn không cuộn (900/900, 720/720) · P6 "Trực tiếp" 1 010/787 ms (1600), 1 055/1 046 ms (1280) · P7 12 ô, mã cắt 0, nhãn 12/12 | ĐẠT 60 · CHẶN-ĐÚNG 4 | `run-D2-chan.log`, `chan/` |
| F1 fonts 5 lượt × 4 màn (28) | chan@1600, chan@1280, thuong@1600, cham@1600, treo@1600, + chan@1280 đo lại ×2 | **28/28 fonts loaded + Geist true + 0 request ngoài**; ≤ 2 500 ms tới màn **23/28** — 5 đột biến: chan@1280 `/twin/line/2` 3 362 ms + `/twin/may/14` 2 651 ms (goto 1 734); cham@1600 `/twin/line/2` 6 028 ms; lại@1280 lần 1 `/twin` 5 598 ms, lần 2 `/twin-studio` 3 171 ms — **điểm trượt đổi màn mỗi lượt**, trùng lúc server ghi `[SLOW QUERY]` 690 lần trong phiên (robot_telemetry `DISTINCT ON robotId` 321× max 4 041 ms; robot state select 74× max **13 957 ms**; sức khoẻ máy 77× max 3 538 ms; lastTs 73× max 2 823 ms — `server-HEAD.err.log`; DB dùng chung với 3000/3001/3008) | ĐẠT 23 · **SAI 5** (thời gian, gốc DB — không phải CDN) | `run-F1.log`, `run-F1-thuong.log`, `run-F1-cham-treo.log`, `run-F1-lai.log`, `f1*/` |
| D-4 API × 6 vai (48 gọi/vai) | tRPC + socket + HTTP v1 | A 42×200/5×404/1×403 SIM 15 T12 0 · **B operator1 0 gán: 30×200 (26 rỗng, 0 dấu vết SIM), 13×404, 5×403** · C 0 quyền: 7×200 (4 rỗng, còn lại số 0), 36×403, 5×404 · D oee-only 25/21/2 SIM 7 · M 37/6/5 SIM 13 · ADM 48×200 SIM 16 **T12 10** (admin bypass — nợ Đợt 41, không đổi) · socket B/C 0 gói, A/D/M twin:1 2 gói, ADM cả 1 và 18 · HTTP v1: 401 không khoá; khoá SIM-FAC ⇒ 14 200, **257 (NM18) 404**, 999999 404 | ĐẠT 3 (A/D/M) · CHẶN-ĐÚNG 2 (B, C) · SAI có sẵn 1 (ADM) | `api-vai/*.json`, `run-D4-api.log` |
| Cổng nguồn (7 lưới) | vitest twin3d / twin / server / kiem-vo / i18n / tsc / 4 lưới phạm vi | twin3d **101 tệp / 2 424 ca** · twin 125/2 806 · server 22/24 tệp, 536/540 ca (**4 đỏ census có sẵn**: C 472→474, D 1101→1119, S 290→324, tổng 2234→2267; tuyến `index.ts:653→650`, D 71→72, tổng 223→224; sổ nợ 3 mục `maintenanceRouter.{getWorkOrder,listWorkOrders,summary}` "nay là nhóm S") · `twinBonManApiVaiPhamVi` 115 · 4 lưới phạm vi 115+22+15+28 = **180/180** · kiem-vo ĐẠT · `i18n:check` exit 0 · `check` exit 0 | ĐẠT 6 · SAI có sẵn 1 (census) | `cong-nguon.log`, `vitest-*-cuoi.txt` |

**Tổng theo rổ (N = 269): ĐẠT 240 · SAI 14 (12 mới đo + 2 có sẵn) · CHẶN-ĐÚNG 11 · N/A 4 · HỎNG 0.**
(K7 26 + K7-NC 8 + e2e 12 + lớp 8 + thị giác 22 + bbox 34 + 40 s 3 + p1 3 + D-1 48 + D-2 64 + F1 28 + D-4 6 + cổng nguồn 7.)

## 3. Kết cục gốc K7 — số trễ và "màn Máy đã vẽ xong"

| Màn/vp | máy bấm | đích | trễ trong trang click→pushState | Playwright waitForURL | màn Máy vẽ xong (canvas + `may-dang-tai`=0 + `__thongKeVe.calls`>0, +3 s) |
|---|---|---|---|---|---|
| /twin 1600 | 246 @(687,527) sau kéo | **/twin/may/1** | 0,2 ms | 3 036 ms (hết hạn chờ 246) | 3 009 ms, canvas 1/kit 1, dangTai 0, spin 0, calls 5, "Nhà máy›Dây chuyền ảo 1›SIM-L1 SPI" |
| /twin 1280 | 246 @(577,455) | /twin/may/246 | 0,4 ms | 24 ms | 3 111 ms, calls 3, "…›SIM Verify Screwdriver" |
| /twin/line/2 1600 | 23 @(1228,437) | /twin/may/23 | 0,4 ms | 34 ms | 3 335 ms, calls 5, "…›Dây chuyền ảo 2›SIM-L2 ROBOT" |
| /twin/line/2 1280 | 23 @(950,323) | **/twin/may/21** | 0,2 ms | 3 024 ms | 3 006 ms, calls 3, "…›SIM-L2 SCREW" |

- Trễ trong trang ≤ 0,4 ms ở cả 4 (ngưỡng 500 ms) — điều hướng tức thời; cái sai là **đi tới máy nào**. Spec Đợt 47 (12/12 trên 3048) không kéo trước khi bấm ⇒ xanh nhờ hình học mặc định.
- Ảnh SAU của tôi (`k7-K7a-…-1600x900-sau.png`, `k7-K7b-…-1600x900-sau.png`) là màn Máy đã vẽ: khối 3D + vòng trạng thái + cockpit "Tổng quan" — không phải spinner.
- ★ **Ảnh "sau-bam" Đợt 47 đã commit (`c3fc0e1b`, `.qa-dot47/e2e/t1a-*-sau-bam.png`) là SPINNER** (tôi đọc `t1a-man-twin-van-hanh-1600-sau-bam.png`: nền tối + vòng xoay, lang en); chạy lại spec trên 3048 cho cùng ảnh (`e2e-spec47/t1a-man-twin-van-hanh-1600-sau-bam.png`). Spec chụp ngay sau `waitForURL`, không chờ màn Máy ⇒ "màn Máy hiển thị" chưa từng là bằng chứng của spec; K7 bổ sung phép đo này (4/4 vẽ xong ≤ 3,4 s).

### Gốc rễ K7a@1600 / K7b@1280 (đọc mã + ảnh + census + bấm thử; CHƯA vá, CHƯA ablation)
`client/src/components/twin3d/loi/LopNhan.tsx:194-207` — `khiBam` tìm **hộp nhãn đầu tiên** trong `hopDaVe` chứa điểm bấm, `ev.stopPropagation()` ("Nhãn thắng máy phía sau") rồi `onChonNhan(trung.machineId)`. `locNhan.ts` chỉ tránh `vungCam` = lớp phủ DOM + hộp badge, **không tránh KHỐI 3D (hình chiếu) của máy khác**. Sau khi xoay camera, nhãn máy A trôi lên thân máy B; người dùng bấm thân B (raycast trúng B) nhưng nhãn A thắng ⇒ `/twin/may/A`. Census: **13 lượt máy / 212 tâm bấm được** bị nhãn máy khác phủ (5/8 khung; nhiều nhất /twin@1600 sau kéo 5/42, trong đó 4 máy dây chuyền 2 cùng bị nhãn "SIM-L1-SPI" hộp 139×24 phủ). Bấm thử 2/2 đi tới máy của nhãn. `onChonNhan` chỉ nối ở `CanhVanHanh.tsx:594` (twin + line); **0 tệp test tham chiếu `onChonNhan`** (chỉ e2e T1c). FC không nối `onChonNhan` ⇒ 0 nhãn phủ ở FC (sai id ở FC là bố cục chồng khối — khác gốc rễ).

## 4. Thị giác

### 4.1 Lệch lớp-vs-canvas (G110: mọi `<Html fullscreen>`)
| Màn | vp | canvas (x,y,w,h) | lop-nhan (dx,dy,dw,dh) | lop-canh-bao | div absolute = canvas |
|---|---|---|---|---|---|
| /twin | 1600 | 288,207,1288,669 | (0,0,0,0) | (0,0,0,0) | 3, đều (0,0) |
| /twin/line/2 | 1600 | 288,125,1288,659 | (0,0,0,0) | (0,0,0,0) | 2 (0,0) |
| /twin/may/14 | 1600 | 288,125,1000,324 | (0,0,0,0) | không có lớp | 1 (0,0) |
| /twin-studio | 1600 | 556,312,726,457 | không có (studio 0 nhãn) | không có | 0 |
| /twin | 1280 | 288,207,968,489 | (0,0,0,0) | (0,0,0,0) | 3 (0,0) |
| /twin/line/2 | 1280 | 288,125,968,479 | (0,0,0,0) | (0,0,0,0) | 2 (0,0) |
| /twin/may/14 | 1280 | 288,125,680,280 | (0,0,0,0) | không có | 1 (0,0) |
| /twin-studio | 1280 | 492,312,541,277 | không có | không có | 0 |
N1 gốc rễ Đợt 47 (lớp badge lệch (−57,−96)/(−443,−142)) **đã hết** ở mọi màn × vp có lớp.

### 4.2 22 trạng thái (`.qa-dot48/d3-vi`, `--lang=vi`)
22/22: nhãn ngoàiCanvas 0 · bịChe 0 · cặpChồng 0 · badge bịChe 0 · cặpChồng 0 · nhãn×badge 0 · chip trong canvas & không bị che (`"chỉ tên máy bất thường · 42 tên khác ẩn"`, `"còn 32 tên bị ẩn"`, `"còn 39 tên bị ẩn"`). Bảng đầy đủ: `tomtat-48.md`.
Quan sát (KHÔNG hồi quy — Đợt 46/47 cùng số): (a) `/twin@1280` badge `tong 7, ve 5, soAn 2, biChe 2` — 2 cảnh báo bị GIẤU vì chạm lớp phủ, chỉ có thuộc tính `data-so-an`, **0 chỉ báo UI** (chip chỉ đếm tên máy ẩn; panel trái vẫn liệt kê 7); (b) `cắt 6 (0 title 4)` ở /twin = 3 span breadcrumb + `tom-tat-canh`, `select cắt chon-toa-nha` (1600) + `chon-nha-may` (1280), `nut-thu-trai` đè 2 ký hiệu — y hệt Đợt 46/47.
**Ảnh tôi tự đọc (14)**: `k7/k7-K7a-man-twin-van-hanh-1600x900-{truoc,sau}.png`, `k7/k7-K7b-man-twin-line-1600x900-sau.png`, `k7/k7-K7b-man-twin-line-1280x720-truoc.png`, `k7/k7-K7h-factory-command-1600x900-sau.png`, `k7/nc-man-twin-van-hanh-1600x900-saukeo.png` (nhãn SPI/ROBOT/CONVEYOR nằm trên thân máy hàng dưới), `k7/nc-man-twin-line-1280x720-saukeo.png` (nhãn SCREW đè khối ROBOT, FCT đè CONVEYOR), `d3-vi/twin-nhan-tat-ca-1600x900.png`, `d3-vi/twin-chua-chon-1280x720.png`, `d3-vi/line-mac-dinh-1600x900.png`, `d3-vi/may-mac-dinh-1280x720.png`, `bbox-qa7/studio-1600x900.png`, `bbox-qa7/may-1600x900.png`, `.qa-dot47/e2e/t1a-man-twin-van-hanh-1600-sau-bam.png` (+ bản chạy lại `e2e-spec47/…`) = spinner.

## 5. Hồi quy
- **D-1 48 ca × 2 vp** (`tomtat-D1.txt`, 8 cột 32→37→39→41→44→46→47→**QA7 48**): {ĐẠT 41, "xem #7/K1/K2" 1 (#3 href — QĐ-23 đi bằng setLocation), "N/A (mất lối vào)" 1 (#7 ngăn nhúng), CHẶN-ĐÚNG 5 (#41 operator1 studio, #42–45 user 0 quyền)} — **y hệt Đợt 47, 0 đổi phán quyết**; vai A/B/C + andon raised TẠM máy 14 (#46–48 ĐẠT); hàng tạm đã xoá (trap), DB 11 khoá trước = sau trong `hoi-quy.log`.
- **D-2 chan K/E/I/P** (`run-D2-chan.log`): K1–K11 + E1–E9 (E6 andon raised tạm, E9 msl now() tạm) + I vi/en/zh + I6 user tạm oee-only ⇒ ✓ 38 / ✗ 0 / LOI 0; ĐẠT 60 / TRƯỢT 4 (đối chứng dương); P3–P7 ×2 vp ĐẠT.
- **F1 fonts** (`run-F1*.log`): 28/28 fonts loaded + Geist + 0 request ngoài (kết cục F1 gốc — CDN không còn là điểm nghẽn, kể cả `treo` 60 s: 4/4 ≤ 1,4 s); 23/28 ≤ 2,5 s — 5 đột biến 2,6–6 s rải ngẫu nhiên theo màn (Đợt 47 8/8 nhưng `/twin/may/14`@1280 đã 2 406 ms; Đợt 46 2 ✗). Gốc: mục 6 #2.
- **An ninh D-4**: operator1 0 gán ⇒ rỗng/404/403, 0 dấu vết SIM; user 0 quyền 36×403; API key thiếu scope ⇒ 404 máy NM18; admin bypass T12 10 = nợ Đợt 41 chưa đổi. So Đợt 41: B 200 35→30, SIM 1→0, T12 1→0; A/M T12 1→0 (chặt hơn).
- **Lưới**: twin3d 101/2 424 · twin 125/2 806 · server 536/540 (4 đỏ census có sẵn) · 4 lưới phạm vi 180/180 · `kiem-vo-app-https` ĐẠT (client 0 ngoài; dist 31 chuỗi trong script nội tuyến — như Đợt 47) · i18n 0 · tsc 0 · `scripts/kiem-vo-app-https.test.ts` 30/30.
- **R3F 40 s 3 màn**: commit R3F 0 (chỉ react-dom 50/55/63 — nhịp ws 84–90 gói + tRPC 7–12 trong 40 s), 0 khung, rAF 0; p1 0 khung, kéo vẫn vẽ 33/34/59 khung/1,5 s.
- **Census có sẵn đỏ** (ghi nhận, không sửa): đúng như brief (mục 2).

## 6. Pareto SAI theo nguyên nhân (14 SAI)
| # | Nguyên nhân (điều kiện mã) | Ca | Bằng chứng |
|---|---|---|---|
| 1 | **Nhãn máy A đè thân máy B, hit-test nhãn thắng raycast khối** — `LopNhan.tsx:199-207` (`hopDaVe` chứa điểm ⇒ `stopPropagation` + `onChonNhan`), `locNhan.ts` không đưa hình chiếu khối máy khác vào `vungCam` | **7** (K7a@1600, K7b@1280, 5/8 khung census) — 13 lượt máy/212 | `k7/*.json`, `k7/nc-*.json`, bấm thử 2/2 ⇒ máy của nhãn, ảnh `nc-*-saukeo.png` |
| 2 | **Đột biến thời gian tới màn > 2,5 s do DB chậm** — `[SLOW QUERY]` 690 lần/85′ trên DB dùng chung: robot_telemetry `DISTINCT ON ("robotId") … AT TIME ZONE` 321× max 4,0 s; robot state select 74× max 14,0 s; sức khoẻ máy 77× max 3,5 s; lastTs 73× max 2,8 s (các thủ tục `twinCanh.anToanRobot / sucKhoeMay / trangThaiHangLoat` mà 4 màn gọi) | **5** (F1) | `run-F1*.log`, `server-HEAD.err.log` |
| 3 | Nợ có sẵn, không đổi trong đợt: census GHIM 4 test đỏ; admin bypass `requirePermission` (ADM thấy T12) | 2 | `vitest-server-cuoi.txt`, `api-vai/ADM.json` |
| — | N/A: FC bố cục chồng khối (39/41 tâm trúng chung 5 instance; `machine_positions` 0 hàng — G102) ⇒ "bấm được" nhưng không đo được đúng id | 2 (K7h) | `k7/nc-factory-command-*.json` |

## 7. Brief SAI/khác so với cây (đếm: 12 mục, trong đó brief ĐÚNG 3, cần sửa/ghi rõ 9)
1. §0 "`node .qa-dot34/dem.mjs`" chỉ in **6 khoá** (hb/msl/users/andon/factories/datcho); 11 khoá brief liệt kê là của `.qa-dot37/db.mjs dem` (Đợt 47 dùng). Tôi đo cả hai, cả hai trước = sau.
2. §0 "porcelain ngoài `.qa-dot4*/` phải rỗng" — thực tế ~180 `knowledge/*` + 3 `.qa-loW/X/Y` + 18 `uploads/aoi-cache/BG87-*` + 1 docs spec stat-dirty; 0 tệp mã ⇒ tiếp tục.
3. §0 HEAD `60cd57fe` — cây đổi thành `a64723e1` (+1 docs, 05:06) trong lúc đo; hợp G121.
4. §0 "outDir riêng" — vite `root: client/` khiến `--outDir` tương đối rơi vào `client/` và làm build sau lệch 478 tệp; cần đường tuyệt đối ngoài root (brief không cảnh báo).
5. §1 "Tái dùng `e2e/twin-dot47-bam-canh.spec.ts` (đọc, KHÔNG sửa)" — spec ghi cứng `ANH=".qa-dot47/e2e"` (8 tệp **đã commit**) ⇒ chạy là ghi đè tệp tracked; phải sao lưu/khôi phục (md5 KHỚP).
6. §1 "Đối chứng dương `/factory-command` tab 3D cũng bấm được" — handler sống nhưng bố cục FC chồng khối (39/41 tâm trúng chung instance) nên bấm máy X mở Sheet máy khác; đối chứng chỉ chứng minh cơ chế, không chứng minh đúng id.
7. §1 "`.qa-dot47/probe/*`" là **đầu ra** (json/png); harness là `.qa-dot47/probe-*.mjs` (đã chép thành `.qa-dot48/probe-*48.mjs`, cổng 3048).
8. §3 "F fonts `.qa-dot43/f1-fonts.mjs`" — Đợt 47 dùng `.qa-dot44/f1-fonts.mjs` (giống nhau trừ cổng/OUT); dùng bản dot44.
9. §3 "4 lưới 180/180" không nêu tên; suy ra `twinBonManApiVaiPhamVi` 115 + `factoryCommandAssetCockpitPhamVi` 22 + `digitalTwinPhamVi` 15 + `maintenanceAndonPhamVi` 28 = 180 (đúng 180 đợt này).
10. §3 census: brief **ĐÚNG** (5 con số + tuyến 650/653 + 3 mục sổ nợ).
11. §2 "22 trạng thái" = 11 `doTrangThai` × 2 vp — **ĐÚNG**.
12. §1 K7 "chụp SAU khi màn Máy đã vẽ xong" — **ĐÚNG và cần**: bằng chứng Đợt 47 là spinner (mục 3).

## 8. DB / md5 / cổng trước–sau
| | Trước (05:08–05:12) | Sau (06:35, `cong.log`) | Khớp |
|---|---|---|---|
| `.qa-dot37/db.mjs dem` (11 khoá) | factories 2 · twin_dat_cho 82 · stations 37 · machines_active 42 · users 10 · andon 7 · andon_raised 0 · hb 108 · msl 7814 · permissions 104 · ufa 3 | y hệt (11/11) | ✓ "DB 11 bang truoc = sau (KHOP)" |
| `.qa-dot34/dem.mjs` (6 khoá) | hb 108 · msl 7814 · users 10 · andon 7 · factories 2 · datcho 82 | y hệt | ✓ "dem34 KHỚP" |
| api_keys | 55 (tạm 0) | 55 (tạm 0) | ✓ |
| Hàng tạm (user ack/oee/0-quyền/mon/adm, andon tạm, msl tạm, DB test D47-*) | — | 0 / 0 / 0 / 0 / 0 / 0 / 0 (`{"f":"0","u":"0","r":"0","t":"0"}`) | ✓ trap chạy đủ |
| md5 5 ảnh `test-results/` | `6d2bc011… C1-C4`, `e589cb7b… C1-fit`, `279b8d09… C2`, `698c5fae… C3`, `7207a5f9… C5` (= HEAD) | "md5 5/5 KHỚP" | ✓ |
| md5 8 tệp `.qa-dot47/e2e` (tracked) | `md5-dot47-e2e-truoc.txt` | `md5-dot47-e2e-sau.txt` KHỚP sau khôi phục; `git status .qa-dot47/e2e` sạch | ✓ |
| md5 dist | `dist/` gốc 914 = dist-kiem 914 = kiem3 914 | không chạm `dist/` (mtime 03:52 giữ) | ✓ |
| Cổng | 3048 rảnh; 3000/3001/3008/8080 phiên khác | 3048 tắt (PID 23712 taskkill 06:35:14); 3000 28480 · 3001 37128 · 3008 38472 · 8080 5192 nguyên | ✓ |
| `client/.qa-dot48` (outDir lạc) | tạo nhầm 05:13 | đã xoá, không commit; `git status client/` sạch | ✓ |
| Cây | cached rỗng, 0 tệp mã bẩn | cached rỗng, numstat 0 dòng nhị phân, chưa push 0 | ✓ |

## 9. Đề xuất Đợt 49 (KHÔNG tự sửa)
1. **Nhãn không được "thắng" khối máy KHÁC** (Pareto #1, ★★★): trong `LopNhan.khiBam`, khi điểm bấm nằm trong hộp nhãn A, raycast khối tại điểm đó (hoặc nhận batchId từ `LoBatchMay`) — nếu trúng máy B ≠ A ⇒ ưu tiên B (khối người dùng nhìn thấy), nhãn chỉ thắng khi không trúng máy nào hoặc trúng chính A; HOẶC `locNhan` đưa hình chiếu 2D của khối máy khác vào `vungCam` (nhãn không đè thân máy khác). Lưới bắt buộc: (a) unit test `onChonNhan` (hiện 0), (b) census `k7-nhan-che.mjs` = 0 máy bị phủ ở 2 màn × 2 vp × (mặc định + sau kéo), (c) e2e T1a thêm biến thể "kéo 60 px rồi bấm" và chọn điểm bấm KHÔNG nằm trong hộp nhãn máy khác. Ablation: gỡ vá ⇒ census trở lại 5/8 khung, bấm thử ⇒ máy của nhãn.
2. **e2e T1a chụp SAU khi màn Máy vẽ xong** (chờ `man-twin-may canvas` + `may-dang-tai=0` + `__thongKeVe.calls>0`), thay 4 PNG spinner đã commit; ghi lang vi.
3. **F1 tách hai kết cục**: "fonts/CDN" (28/28 ĐẠT — đóng) và "thời gian tới màn" (5/28 trượt vì DB); điều tra `robot_telemetry DISTINCT ON ("robotId")` 321 lần/85′ (max 4 s) và robot state select (max 14 s) — index `(robotId, timestamp DESC)` / cache broadcaster / giảm tần suất; đo lại F1 trên DB không dùng chung.
4. **Census GHIM**: gỡ 3 mục `maintenanceRouter.*` khỏi `phamViDocBaseline.ts`, cập nhật GHIM {C 474, D 1119, S 324, tổng 2267}, tuyến `index.ts:650`, {D 72, tổng 224} — kèm lý do.
5. **FC bố cục chồng khối** (G102): 39/41 tâm raycast trúng chung 5 instance vì `machine_positions` 0 hàng — nếu `/factory-command` 3D là màn vận hành thì cần nguồn vị trí; nếu không, ghi rõ là màn phụ.
6. **Badge bị giấu không có chỉ báo** (`/twin@1280` soAn 2/7): chip "N cảnh báo bị giấu" hoặc gom vào chip hiện có.
7. **Gotcha hệ đo (skill/pdca)**: outDir đo phải ngoài vite root; spec e2e ghi vào thư mục tracked phải sao lưu; ĐỐI CHỨNG dương chỉ chứng minh cơ chế nếu bố cục đích không mơ hồ.

## CÒN MỞ (nói thẳng)
- **Chưa ablation** gốc rễ #1 bằng cách gỡ `stopPropagation`/`onChonNhan` (QA không sửa mã); bằng chứng nhân quả hiện có: mã + ảnh + census + bấm thử 2/2 đúng máy của nhãn.
- Gốc rễ F1 (#2) suy từ tương quan SLOW QUERY, **chưa cô lập** (DB dùng chung với 3 server khác đang chạy); cần đo lại trên DB riêng.
- FC: nguồn vị trí máy chưa đọc mã (chỉ đo census tâm/raycast).
- Thị giác chỉ đo `lang=vi` (en/zh chưa); tsc incremental; census K7-NC chỉ 1 hướng kéo (+60 px ngang).
- ADM thấy dữ liệu NM18 (T12 10) — nợ Đợt 41, chưa ai quyết.
