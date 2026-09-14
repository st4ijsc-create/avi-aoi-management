# Đợt 54 — QA lần 9, XÁC NHẬN nghiệm thu cuối Twin 3D (QA độc lập)

Worktree `D:/SOURCES/_twin_wt` · nhánh `feat/twin-3d-trung-tam` · cổng riêng **3054** · 2026-09-12
Không sửa một dòng mã sản phẩm (5 tệp gỡ vá đã khôi phục, md5 5/5 khớp), không sửa `e2e/`. Mọi thứ ghi trong `.qa-dot54/`.
Nguyên tắc của đợt này: **đo lại từ đầu, không kế thừa lời khai của Đợt 52 hay Đợt 53.** Mỗi món đóng đều có **ablation hai chiều**.

---

## 1. CÂY + HỆ ĐO (Bước 0 PDCA — MSA)

| mục | trước | sau |
|---|---|---|
| HEAD | `360c9218` = **đúng kỳ vọng brief**, 0 commit `docs(...)` thêm | y nguyên `360c9218` |
| nhánh | `feat/twin-3d-trung-tam` | y nguyên |
| build | `.qa-dot54/dist-54a` (outDir **tuyệt đối, ngoài `client/`**) · 914 tệp · bundle `assets/index-hIeKtQvc.js` | build lặp `54b`: **md5 914/914 KHỚP TUYỆT ĐỐI** (G120) |
| thứ đang chạy = thứ vừa build | md5 bundle trên đĩa `3436fb9efe2aafad2abe6827aa37f9d7` | md5 bundle **3054 trả về** `3436fb9e…` — byte y hệt |
| **build ABLATION** `dist-54z` (gỡ 5 tệp vá Đợt 53 về `9f6da8ca`) | — | bundle `assets/index-C9m3IM7B.js` — **trùng KHÍT hash bundle Đợt 52** ⇒ 54z tái dựng đúng nền QA lần 8 |
| `dist/` (3000/3001/3008 phục vụ) | KHÔNG chạm | KHÔNG chạm |
| `auth.me` | `/api/trpc/auth.me` → `application/json` 200 (G100 vẫn đóng) | |
| cache trên đường đo | Redis→memory fallback; F1 mỗi lượt context trình duyệt MỚI, lượt 1 (nguội) KHÔNG loại | |
| DB 11 khoá | `factories 2 · twin_dat_cho 82 · stations 37 · machines_active 42 · users 10 · andon 7 · andon_raised 0 · hb 108 · msl 7814 · permissions 104 · ufa 3` | **LỆCH 0** |
| DB 6 khoá (`.qa-dot34/dem.mjs`) | `hb 108 · msl 7814 · users 10 · andon 7 · factories 2 · datcho 82` | **LỆCH 0** |
| 5 ảnh `test-results/` | md5 `.qa-dot54/md5-testresults-truoc.txt` | **5/5 KHÔNG ĐỔI** |
| `.qa-dot47/` | 616 tệp, **103 tệp 0 byte** | **616/616 md5 KHÔNG ĐỔI**, vẫn 103 tệp 0 byte — không đắp, không xoá |
| 5 tệp mã bị gỡ vá tạm | md5 `.qa-dot54/md5-ma-truoc.txt` | **5/5 md5 KHỚP** · `git status` 5 tệp **rỗng** |
| cổng 3000/3001/3008/8080 | PID 28480 / 37128 / 38472 / 5192 | **PID y nguyên** |
| cổng 3054 | — | PID của tôi, tắt ở cuối |
| `knowledge/` | 179 M + 2 D + 3 ?? (**bẩn sẵn từ trước**, 367 tệp) | **184 dòng y nguyên**; xem §7 (G138) |

**G130/G133 — kiểm TRƯỚC khi chạy harness cũ.** `grep -n "qa-dot[0-9]\+"` từng tệp; harness ghim cứng đường ra ⇒ **chép sang `.qa-dot54/` rồi sửa bản chép** (`build.sh`, `server.sh`, `nhanbadge54`, `hopdong54`, `thigiac54`, `bbox54`, `k8`, `k9`, `nc54`, `explain54`, `tomtat-F1`, `tomtat-D1`, `do-D1/D2/D4`, `f1-fonts`+`mang`); harness nhận ENV thì truyền ENV (`QA_OUT`/`QA_STATE`/`QA_MANG_NGOAI`/`NC_OUT`/`API_VAI_OUT`/`D1_MOI`/`D1_TRUOC`). Không dùng `cmd > "$f"` để khôi phục ở bất kỳ đâu — luôn `> tmp && mv`.

**Ablation được thực hiện bằng cách gỡ vá THẬT** (`git show 9f6da8ca:<tệp>` → `tmp` → `mv`), build `dist-54z`, rồi khôi phục bằng `git show 360c9218:` trong `trap EXIT` (G101: không dùng `git checkout --`, tránh CRLF). Khôi phục đã nghiệm: md5 5/5 khớp, `git status` rỗng.

---

## 2. BẢNG S1–S5 + S-C — ĐÓNG/CHƯA kèm số

| món | QA lần 8 (Đợt 52) | **ĐO LẠI Đợt 54 trên HEAD** | **ABLATION (gỡ vá, 54z)** | phán quyết |
|---|---|---|---|---|
| **S1–S4** badge đè nhãn ở màn Máy của máy CÓ cảnh báo | 4/32 ca chồng, 17–35 %, badge TRÊN | **0/20 ca chồng · 0 px²** (5 màn × 2 vp × vi/en) | **8/20 ca chồng · 11 928 px²** | **ĐÓNG** |
| **G136** badge VẼ vs badge VÀO SỔ | chưa ai đo | **20/20 ca BẰNG NHAU** + **48/48 ca** của lưới thị giác | `may/18` và `may/23`: **vẽ 1 / vào sổ 0** | **ĐÓNG** |
| **S5** một hợp đồng trạng thái (6 bề mặt, dữ liệu SỐNG) | 2/6 bề mặt nói chữ khác | **6/6 nói MỘT chữ** (`idle`) | **2/6 sai** (`machineDetail`=running, `statusMapped`=running, `operationStatus`=null) | **ĐÓNG** |
| **S5b** thiếu dữ kiện ⇒ không suy ra `running` | — | `null`→`idle` · `undefined`→`idle` · `""`→`idle` | cả ba → **`running`** | **ĐÓNG** |
| **S-C** câu chậm `DISTINCT ON machine_health_history` | 2 câu trong cửa sổ F1 · 136,7 ms ấm | **0 câu** `DISTINCT ON` trong cả phiên · EXPLAIN ấm **0,102–0,341 ms** | **2 câu** (259,9 / 202,0 ms) trong 1 cửa sổ · EXPLAIN ấm **114,5–153,3 ms** | **ĐÓNG** |

### 2a. S1–S4 — chi tiết (`.qa-dot54/nb-A/tong.json` vs `.qa-dot54/nb-Z/tong.json`)

5 màn × 2 vp × {vi,en} = **20 ca**. Đo bbox DOM thật: giao nhãn `nhan-may-twin3d` × badge `badge-canh-bao-*`, px², % diện tích nhãn, z hiệu lực.

| màn | HEAD: cặp / `__demBadge.ve` / `__demNhan.soHopBadge` | ABLATION: cặp / ve / sổ |
|---|---|---|
| `/twin` | 0 · 7 / 7 | 0 · 7 / 7 |
| `/twin/line/2` | 0 · 2 / 2 | 0 · 2 / 2 |
| **`/twin/may/18`** (1 cảnh báo mở) | **0** · 1 / **1** | **1 cặp** (1 584 px² = **35 %** @1600 · 744–756 px² = **17 %** @1280, badge TRÊN) · 1 / **0** |
| **`/twin/may/23`** (1 cảnh báo mở) | **0** · 1 / **1** | **1 cặp** (2 057 px² = **52–53 %** @1600 · 1 573 px² = **40 %** @1280, badge TRÊN) · 1 / **0** |
| `/twin/may/14` (0 cảnh báo) | 0 · 0 / 0 | 0 · 0 / 0 |

★★★ **Phát hiện mới, ngoài cả QA lần 8 lẫn Đợt 53: máy 23 (SIM-L2-ROBOT) cũng có `andon_events` chưa `resolved` và cũng bị lỗi — NẶNG HƠN máy 18 (52 % so với 35 %).** Cả hai đợt trước chỉ đo `/twin/may/18`; máy 23 chưa bao giờ nằm trong tập đo. Bản vá `hopManHinh` là **bản vá cơ chế** nên đóng luôn cả ca chưa ai thấy. Danh sách máy có cảnh báo mở đo độc lập từ DB: `andon_events` 7 hàng, `status != 'resolved'` **7/7**, machineId ∈ {18, 23, 1, 2, 3, 4} — trong 12 máy của twin chỉ có **18 và 23**.

**Ảnh tự đọc (7 PNG, không đọc từ DOM):**
`nb-Z/_twin_may_23-1600x900-vi.png` — nhãn "SIM-L2-ROBOT · Không rõ" bị badge đỏ **cắt đôi chữ**, không đọc nổi.
`nb-A/_twin_may_23-1600x900-vi.png` — badge lên mép trên, nhãn dời xuống ~25 px, **cả hai đọc được**, đều trong canvas.
`nb-Z/_twin_may_18-1600x900-en.png` (trước) · `d3-vi/may-co-canh-bao-1600x900.png` + `k8/k8-K8b-1600x900-may2-18-sau.png` (sau) — cùng kết luận cho máy 18.
`d3-vi/twin-nhan-tat-ca-1600x900.png` — 12 nhãn + 7 badge, 0 chồng, chip "còn 25 tên bị ẩn" **nhìn thấy trong canvas**, vòng sức khoẻ đổi màu theo hạng.
`d3-en/line-mac-dinh-1600x900.png` — 12 nhãn + 2 badge so le, 12 ô trạm WIP có số, mũi tên dòng chảy.

★ **Bằng chứng phụ đọc được TRÊN ẢNH cho S5:** ở ảnh ablation ô "PackML / vận hành" là `—`; ở ảnh HEAD là `● stopped` (máy 23) và `● running` (máy 18) — đúng cột `machines."operationStatus"`. Ống dữ liệu được nối lại **nhìn thấy được bằng mắt**.

### 2b. S5 — hợp đồng trạng thái trên DỮ LIỆU SỐNG (G135)

Chèn **một** nhịp tim `now()` cho máy 14 (hàng TẠM, `trap` xoá; hb 108→109→108, đã nghiệm cả hai lần).

| bề mặt | KHÔNG nhịp tim (cả 2 build) | **HEAD + nhịp tim** | **ABLATION + nhịp tim** |
|---|---|---|---|
| 1 `factoryCommand.overview` | offline | **idle** | idle |
| 2 `factoryCommand.machineDetail` | offline | **idle** | **running** ✗ |
| 3 `assetCockpit.liveState.statusMapped` | offline | **idle** | **running** ✗ |
| 3b `assetCockpit.liveState.operationStatus` | `"stopped"` (HEAD) / `null` (abl.) | **`"stopped"`** | **`null`** ✗ |
| 4 socket `twin:trangThai` | offline | **idle** | idle |
| 5 `/twin` hàng máy `data-trang-thai` | khong_ro | **idle** | idle |
| 6 `/twin/may/14` chip | Unknown/khong_ro | **Idle / idle** | Idle / idle |

⇒ **6/6 bề mặt nói một chữ trên HEAD; 2/6 nói sai trên bản trước vá.** Phép đo là phép đo SỐNG: mọi bề mặt đều ĐỔI khi chèn nhịp tim (không phải ảnh chụp chết). Thô: `hd-A-khong-hb/`, `hd-A-co-hb/`, `hd-Z-khong-hb/`, `hd-Z-co-hb/`.

**Ca "thiếu dữ kiện".** Brief yêu cầu đo sống với `operationStatus` null/""/undefined. **Đo được: KHÔNG DỰNG ĐƯỢC từ DB** — `machines."operationStatus"` là cột **ENUM + NOT NULL**: `NULL` bị chặn `23502 not-null constraint`, `''` bị chặn `22P02 invalid input value for enum operationstatusenum`. (Thử thật, `trap` trả lại `'stopped'`, `tongMay` 43 trước/sau — `.qa-dot54/run-thieudukien-A*.log`.) Ca này **chỉ tồn tại khi ống MÃ bị đứt** — đúng ca Đợt 53 vá. Vì vậy đo ở tầng hàm sản phẩm (biên dịch `server/services/trangThaiMayTuoi.ts` bằng esbuild rồi gọi, **không qua tệp test của họ**):

| đối số `operationStatus` (máy ĐANG kết nối) | HEAD | ABLATION |
|---|---|---|
| `null` | **idle** | **running** ✗ |
| `undefined` | **idle** | **running** ✗ |
| `""` | **idle** | **running** ✗ |
| `"stopped"` | idle | idle |
| `"running"` / `"warming_up"` | running | running |
| `"maintenance"` / `"error"` | maintenance / down | maintenance / down |
| `VAN_HANH_XAP_XI_KET_NOI` (khai tường minh) | **running** | running |
| máy KHÔNG kết nối, mọi đối số | offline | offline |
| `trangThaiLichSuTaiMoc` (replay Đợt 38) | **running** | running — **0 bit đổi** |

`NGUONG_TRANG_THAI_TUOI_MS` = **300 000 ms = 5 phút** (đọc từ hàm đã biên dịch, không từ grep).
`TRAN_NHIP_AN_TOAN_MS` = **20 000 ms** (`useTrangThaiSong.ts:53`), dùng ở `:102` và `:119` làm trần `refetchInterval`; `TRAN_NHIP_SUC_KHOE_MS` = 60 000 ở `:134`. Bằng chứng SỐNG rằng trần có hiệu lực: sau khi chèn nhịp tim, DOM `/twin` đọc "Idle **16s**" rồi "Idle **20s**" trong cùng phiên đo — tức lớp nhãn nhận số mới trong vòng ≤ 20 s mà không cần tải lại trang.

**Quét MỌI chỗ gọi `mapMachineStatus(` trong mã sản phẩm (G110, grep của tôi, không tin lưới):** 4 chỗ — `twinCanh.ts:1232` (`bosung?.operationStatus`), `assetCockpitService.ts:597` (`opStatus` đọc từ `machines`), `factoryCommandService.ts:396` (`m.operationStatus`), `factoryCommandService.ts:597` (`detail.liveState.value?.operationStatus`) + `trangThaiMayTuoi.ts:223` dùng hằng khai tường minh. **0 chỗ còn đánh rơi dữ kiện.**

### 2c. S-C — hiệu năng (G137: log chậm ≠ bệnh)

**`[SLOW QUERY]` đọc từ `stderr`** (`stdout` có **0** dòng ở cả hai build — đúng cảnh báo Đợt 51):

| | HEAD (54a) | ABLATION (54z) |
|---|---|---|
| tổng câu chậm trong phiên đo | 17 | 15 |
| **`DISTINCT ON … machine_health_history`** | **0** | **2** (259,9 ms · 202,0 ms) |
| cửa sổ F1 riêng (2 lượt × 4 màn) | 7 câu, **0** `DISTINCT ON` | 9 câu, **1** `DISTINCT ON` (241,4 ms) |

**EXPLAIN (ANALYZE, BUFFERS) ×6, bảng 216 255 hàng** (`.qa-dot54/explain-A.txt`):

| câu | lần 1 (nguội) | lần 2–6 (ấm) | kế hoạch |
|---|---|---|---|
| cũ `ORDER BY "machineId","timestamp" DESC` | 134,5 ms | **114,5 – 153,3 ms** | Seq Scan → Sort |
| **mới `ORDER BY "machineId","createdAt" DESC`** | 0,341 ms | **0,102 – 0,142 ms** | **Index Scan `idx_health_machine_created_desc` (SkipScan)**, 43 hàng, `shared hit=124 read=53` |

**ĐỐI CHỨNG ĐẦU RA:** hai câu trả **43 hàng, GIỐNG HỆT nhau** (`chuan(A)===chuan(B)` = **true**) ⇒ bản vá đổi ĐƯỜNG ĐI, không đổi CÂU TRẢ LỜI. Không có index mới; `idx_health_machine_created_desc` (QĐ-27) có thật trong `pg_indexes` cạnh 7 index cũ.

**EXPLAIN ấm cho `oeeService.ts:837,855`** (`.qa-dot54/explain-oee-A.txt`) — brief yêu cầu xếp ưu tiên bằng EXPLAIN chứ không bằng log:

| câu | bảng | ấm | phán quyết |
|---|---|---|---|
| `:837` `oee_metrics` DISTINCT ON `idealCycleTime` | 897 hàng (hypertable 2 chunk) | **0,284 – 0,302 ms** | KHÔNG phải bệnh — Seq Scan trên bảng nhỏ, quicksort 53 kB trong RAM |
| `:855` `product_machine_mappings` DISTINCT ON | 8 hàng | **0,011 – 0,013 ms** | KHÔNG phải bệnh |

⇒ **G137 xác nhận bằng số của tôi**: hai câu này từng vào log chậm chỉ vì chạy nguội. Ưu tiên vá = **0**.

---

## 3. NGHIỆM THU LẠI "ĐẸP" + KHÔNG HỒI QUY

### 3a. Thị giác — 12 trạng thái × 2 vp × {vi, en} = **48 ca** (`thigiac54.mjs`, bbox từ DOM thật)

| | vi | en |
|---|---:|---:|
| ca đo | 24 | 24 |
| `soCanvas ≠ 1` | **0** | **0** |
| nhãn / badge / chip đo được | 127 / 56 / 6 | 127 / 56 / 6 |
| NGOÀI canvas (nhãn / badge / chip) | 0 / 0 / 0 | 0 / 0 / 0 |
| BỊ CHE (nhãn / badge / chip) | 0 / 0 / 0 | 0 / 0 / 0 |
| cặp chồng nhãn×nhãn / badge×badge / **nhãn×badge** | 0 / 0 / **0** | 0 / 0 / **0** |
| badge dời chỗ (chính sách đang chạy) | 30 | 30 |
| tràn trang · thiếu mặt chữ Geist | 0 · 0 | 0 · 0 |
| **badge VẼ ≠ badge VÀO SỔ** | **0 ca** | **0 ca** |

Bộ 24 gồm `may/co-canh-bao` (= `/twin/may/18`) — chính lỗ đo đã để SAI #1 sống sót 8 đợt.

★ **Đối chứng dương cho chính THIẾT BỊ ĐO này** (bắt buộc, vì "tất cả xanh lần đầu" là cờ đỏ): chạy y hệt `thigiac54.mjs` trên build ABLATION ⇒ `capChongNhanBadge` = **1** và `ve=1 / soHopBadge=0` ở `may/co-canh-bao`. **Thiết bị đo biết kêu.**

- **Lệch lớp `lop-nhan` + `lop-canh-bao` vs canvas, 4 màn × 2 vp:** `lopTrungCanvas` **true** ở mọi ca D-1 (#2, #9, #31…), nhãn `biChe` **0** ⇒ **(0, 0, 0, 0)**.
- **bbox 34 mục thiết kế QĐ-26: ĐẠT 34 · TRƯỢT 0 / 34** (`.qa-dot54/bbox-54/`, `run-bbox.log`).
- **Cặp nhãn ∩ hình chiếu khối máy KHÁC** (`nc54.mjs`, mô hình rời): `10 / 13 / 0 / 0 / 9 / 7 / 2 / 0` = **41** — **byte y hệt nền Đợt 52**. Không hồi quy, cũng không cải thiện. Không chặn kết cục (mọi cú bấm vẫn đúng máy).

### 3b. Kết cục gốc — bấm MÁY (K8) và chọn LINE (K9)

**K8** (`.qa-dot54/k8/`, `k8-run.log`): **46 ĐẠT · 0 SAI · 2 N-A** / 48 ca.
- **24/24 cú `page.mouse.click` vào TÂM KHỐI ⇒ đúng `/twin/may/<đúng id>`**, 2 màn × 2 vp × 5 máy + 4 sau kéo. Trễ trong trang (click → `pushState`) **0 – 0,5 ms** (ngưỡng 500).
- Màn Máy vẽ xong **2 212 – 2 316 ms** · `canvas 1/kit 1` · `dangTai 0` · `calls 3–5`.
- K8c sàn trống ⇒ URL không đổi 4/4 · K8d kéo ⇒ camera đổi, pathname giữ 4/4 · K8e cursor `pointer`/`auto` 4/4 · K8f bấm NHÃN ⇒ đúng máy của nhãn + Back về màn gốc 4/4 · K8g `demObject {soObject:1, coHandler:1, trongScene:1}` 4/4 · K8h đối chứng dương `/factory-command` 3D 2/2.
- **Máy có tâm bị NHÃN MÁY KHÁC phủ vẫn bấm đúng** — `nc54` bấm tâm máy 23 bị nhãn máy 18 phủ ⇒ `/twin/may/23` ĐÚNG MÁY.
- **2 N-A** = K8i-tang: DB dev có **1 nhà máy / 1 toà / 1 tầng** (bộ chọn nạp trả đúng 1 mục mỗi ô) ⇒ không có tầng thứ hai để đổi. Giới hạn DỮ LIỆU, không phải lỗi sản phẩm (y hệt Đợt 52).

**K9** (`.qa-dot54/k9/`): **6/6 ĐẠT** — 3 line × 2 vp, bấm node line trong cây ⇒ `/twin/line/{1,2,3}`, `canvas 1/kit 1`, 12 ô trạm, dải line 1, draw 6, trễ trong trang 0,2 – 0,5 ms.

**e2e `twin-dot47-bam-canh.spec.ts`: 16/16 PASS** (2,1 phút) trên 3054, `TWIN_E2E_ANH=.qa-dot54/e2e-bamcanh` — và `.qa-dot47` **616/616 md5 không đổi** ⇒ hàng rào `duongRaBangChung` hoạt động thật.

### 3c. "Nhanh" — F1

**F1 `mang=chan` 1600×900, 7 lượt × 4 màn** (`.qa-dot54/f1-54-*`, `F1-tomtat.json`), số tiến trình `chrome=10 node=27` **không đổi suốt 7 lượt**:

| điều kiện | n | p50 | p90 | max | đột biến > 2 500 ms |
|---|---:|---:|---:|---:|---|
| Đợt 51 có index | 28 | 1 183 | 1 545 | 1 889 | 0/28 |
| Đợt 52 (nền QA lần 8) | 28 | 1 169 | 1 284 | 1 300 | 0/28 |
| Đợt 53 | 28 | 1 465 | 2 375 | 3 704 | 2/28 |
| **★ Đợt 54 (tuần tự)** | **28** | **1 239** | **1 955** | **2 528** | **1/28** (`/twin` lượt 1, nguội) |

Lệch nền Đợt 52 ⇒ theo ràng buộc brief, **KHÔNG được kết luận hồi quy nếu chưa chạy xen kẽ hai build**. Đã chạy **4 lô xen kẽ 54z ↔ 54a, 2 lượt × 4 màn mỗi lô** (`.qa-dot54/fx-*`, `run-F1-xen.log`):

| build | n | p50 | p90 | max | đột biến > 2 500 ms |
|---|---|---:|---:|---:|---|
| **54a = HEAD (có vá Đợt 53)** | 32 | **1 181** | **1 579** | **2 107** | **0/32** |
| 54z = trước vá Đợt 53 | 32 | 1 161 | 1 754 | **4 495** | **2/32** |

⇒ **Bản có vá KHÔNG chậm hơn — nó nhỉnh hơn ở p90/max và là bản duy nhất 0 đột biến.** Đột biến 2 528 ms ở lượt tuần tự đầu tiên là **nhiễu tải/nguội**, không phải hồi quy mã. Tổng trên HEAD: **60 mẫu, 1 đột biến** (lượt nguội đầu tiên).
Request ra ngoài (CDN) **0** ở mọi lượt · `fonts.status = loaded`, `checkGeist true` (G117 vẫn đóng).

### 3d. Tối ưu — 40 s đứng yên

`.qa-dot54/nguon-khung/`: **`/twin` · `/twin/line/2` · `/twin/may/14` — tổng khung 0 · rAF 0 lời gọi · commit `@react-three/fiber` 0** (50/55/63 commit đều là `react-dom`).
**Đối chứng dương** (`keo-van-ve.mjs`): đứng yên 8 s → **0 khung**; **kéo 4 s → 87 / 76 / 83 khung** ⇒ canvas KHÔNG chết, `frameloop="demand"` đúng.

---

## 4. HỒI QUY + BẢNG CỔNG

### 4a. Lưới hồi quy
| lưới | Đợt 54 | nền (Đợt 52/53) | phán quyết |
|---|---|---|---|
| `vitest client/src/components/twin3d` | **104 tệp / 2 461 XANH** | 104 / 2 461 (53) | = |
| 4 lưới phạm vi | **180/180** | 180/180 | = |
| census `phamViDoc*`+`phamViTuyen*` | **2 tệp / 37 XANH** | 37 | = |
| `kiem-vo-app-https` | 30 XANH | 30 | = |
| `machinePresence` | 11 XANH | 11 | = |
| `server/db/twinCanh` | 7 XANH | 7 | = |
| fleet + robot | 21 tệp / 187 XANH | 21 / 187 | = |
| 4 lưới mới Đợt 53 (`badgeKepRiaDeNhan` + `hopDongTrangThaiMotChu` + `sucKhoeTheoIndexQd27` + `trangThaiMayTuoi`) | **4 tệp / 45 XANH** | 4 / 45 | = |
| e2e `twin-dot47-bam-canh` | **16/16 PASS** | 16/16 | = |
| **D-1 (48 ca Đợt 32), cột 54** | **ĐẠT 41 · CHẶN-ĐÚNG 5 · N/A 1 · "xem #7" 1** | y HỆT cột 53/46 | **LỆCH 0** |
| **D-2 (K/E/I/P)** | **ĐẠT 60 · 4 TRƯỢT = ĐÚNG 4 ca ĐỐI CHỨNG cố ý sai** · `✓ 40 / ✗ 0` | = | thiết bị đo biết kêu |
| **D-4 tRPC 6 vai × 48 lượt** | **LỆCH 0/288** so nền Đợt 52 | — | = |
| D-4 socket 6 vai | **5/6 giống hệt**; vai ADM khác **số nhịp broadcast nhận trong 12 s** (3 vs 2/nhà máy), nội dung `tong`/`may` y hệt | — | = về hành vi |
| D-4 HTTP v1 (khoá tạm SIM-FAC) | **5/5 y hệt**: không khoá 401 · `/machines/14` 200 · `/machines/257` (NM18) **404** · `/robots/1` 200 · `/machines/999999` **404** | — | = (QĐ-25 fail-closed) |
| md5 8 tệp tracked `.qa-dot47/e2e` | **0 tệp bị đổi** | — | hàng rào hoạt động |

**D-4 — 6/6 vai đăng nhập được** (A `e2e_tai_loE` id 21075 · B `operator1` id 48 · C/D/M/ADM là user TẠM do chính script tạo rồi xoá, có `trap`). Dấu vết nhà máy 18 (T12): vai A/B/C/D/M = **0**; chỉ ADM (admin, bypass) = 10. `users` 10 trước, 10 sau.

### 4b. **MỌI** script `package.json` có tính chất KIỂM (G108 — lần thứ 6)
| script | exit | kết quả | phán quyết |
|---|---:|---|---|
| `check` | **0** | `tsc --noEmit` sạch | ĐẠT |
| `check:tests` | **1** | **32 lỗi TS** — **5/32 nằm TRONG `client/src/components/twin3d/van-hanh/`** (`cayVanHanh.unit.test.ts` ×2 TS2741, `hopNhatCanh.unit.test.ts` ×3 TS2322) | **ĐỎ SẴN** (đúng 32 = con số nền Đợt 51/53) |
| `lint:tokens` | 0 | "REPORT-ONLY baseline (exit 0)", tổng 1 111 mục | ĐẠT (là **báo cáo**, không phải cổng) |
| `i18n:check` | 0 | 0 placeholder mismatch · 0 key mới thiếu · nợ **339 + 20 đã đóng băng** | ĐẠT |
| `i18n:audit` | 0 | "GAPS FOUND (parity=108, missing-no-fallback=8)" | ĐẠT về exit, **báo cáo có gaps** |
| `kb:stale-check` | 0 | embeddings phủ đủ chunk | ĐẠT |
| **`kb:operational-cards:test`** | **1** | 5 pass / 1 fail — *"expected exactly one operational chunk per card: **194 !== 164**"* | **ĐỎ SẴN** (đúng con số Đợt 52) |
| `vision:validate` | 0 | %GRR(dx) 0,7 % · SPI volume %GRR 0,2 % | ĐẠT |
| `lake:verify` | 0 | PASS | ĐẠT |
| **`ext:check`** | **2** | `TS2688: Cannot find type definition file for 'vscode'` | **ĐỎ — MÔI TRƯỜNG** (`vscode-extension` chưa cài phụ thuộc) |
| `test` (vitest toàn bộ) | — | **97 tệp đỏ / 1 411 · 205 test đỏ / 20 273 · 1 313 tệp xanh** | **ĐỎ SẴN** — **0 tệp đỏ trong `twin3d`** |
| `test:e2e` | — | spec trong phạm vi 16/16 PASS; **KHÔNG chạy toàn bộ** (một số spec ghi DB dev ngoài trap) | CHƯA ĐO — ghi thẳng |
| `kiem-vo-app-https.mjs` | 0 | 30 ca XANH | ĐẠT |

Không chạy (có lý do, ghi thẳng): `build` (cấm rebuild `dist/`) · `db:push`/`db:generate`/`test:db:setup` (đổi lược đồ) · `sim:*`, `bench:ingest`, `ai:backfill` (ghi DB dev) · `ai:eval:*`/`kb:eval`/`kb:test`/`eval:specialist`/`ai:bench` (cần model/GPU) · `format`/`storybook`/`ext:build`/`ext:package`/`ext:test-that`/`monitor:*`/`kb:*` sinh dữ liệu.

★ **Kiểm chứng "đỏ sẵn" của `test` toàn bộ, không tin lời khai** (`.qa-dot54/test-full-failfiles.txt`): 97 tệp đỏ — **0 tệp nào trong `twin3d`**. So danh sách với nền Đợt 52 (96 tệp): **9 vào / 8 ra**, tất cả là `*.db.test.ts` hoặc lưới phụ thuộc thời gian (`engineeringStream` trượt vì timeout 5 023 ms) ⇒ **trôi do tranh chấp DB/CPU giữa hai lượt chạy**, không phải hồi quy. Nguyên nhân trội không đổi: **178 + 94 + 27 + 21 + 14** lỗi cùng một họ `No "<tên>" export is defined on the "../db" mock` — đúng lớp nợ đã ghi trong bộ nhớ dự án. Phân bố: `server/routers` 37 · `server/services` 33 · `server/_core` 6 · `server/db` 4 · `client/src` 3 · còn lại rải.
⚠ **Lỗi đo của chính tôi ở đây (đã sửa):** lần trích đầu tôi lấy MỌI chuỗi `*.test.ts` xuất hiện trong đầu ra ⇒ ra **225 "tệp đỏ", trong đó 7 tệp `twin3d`** — nhưng 7 tệp ấy chỉ là **tên do một lưới quét in ra**, không phải tệp trượt. Trích đúng theo dòng `❯ <đường dẫn> (N tests | M failed)` ⇒ **97 tệp, 0 tệp `twin3d`**.

★★★ **G138 — KHAI RÕ TÁC DỤNG PHỤ.** Tôi **CÓ chạy** `kb:operational-cards:test`. Đo tác dụng phụ bằng md5 toàn bộ `knowledge/` (367 tệp) trước/sau: **365/367 tệp BYTE-Y-HỆT**, đúng **2 tệp đổi nội dung** (`knowledge/chunks-stats.json`, `knowledge/chunks.jsonl`); `git status -- knowledge` **184 dòng trước = 184 dòng sau**. **KHÔNG khôi phục** (cây `knowledge/` đã bẩn sẵn trước phiên tôi — 179 M + 2 D + 3 ?? — khôi phục là xoá việc đang dở của phiên khác). Tệp thô: `md5-knowledge-truoc.txt` / `md5-knowledge-sau.txt`.

---

## 5. PARETO — KHÔNG CÒN SAI

0 ca SAI, 0 ca HỎNG trong phạm vi nghiệm thu ⇒ không có Pareto cho đợt này. Món còn mở đều **ngoài Twin** hoặc **là giới hạn dữ liệu dev** (xem §8 CÒN MỞ).

---

## 6. BRIEF SAI Ở ĐÂU + LỖI CỦA CHÍNH TÔI

### Brief Đợt 54 — **4 chỗ** (3 thực chất + 1 chữ nghĩa)
1. ★★ **"4 ca badge đè nhãn" là ĐẾM THIẾU — thật ra 8 ca.** Brief (kế thừa QA lần 8 và Đợt 53) khung lỗi quanh riêng `/twin/may/18`. Đo lại danh sách máy có cảnh báo mở **từ DB** ⇒ máy **23** cũng có, và trên bản trước vá nó chồng **52 %/40 %** — **nặng hơn máy 18**. Cả hai đợt trước chưa từng mở `/twin/may/23`. (Không đổi phán quyết: bản vá cơ chế đóng cả hai. Nhưng con số nền "4/16" trong spec §14q.32 là **thiếu**.)
2. ★★ **"Thêm ca thiếu dữ kiện (`operationStatus` null/''/undefined)" — KHÔNG dựng được trên dữ liệu sống.** `machines."operationStatus"` là ENUM **NOT NULL**: Postgres chặn cả `NULL` (23502) lẫn `''` (22P02). Ca ấy chỉ tồn tại khi **ống mã** đứt, nên phải đo ở tầng hàm. Brief kê một ca mà lược đồ CSDL không cho phép dựng.
3. ★★ **"⚠ Đợt 53 báo 4/6 vai nền đã bị xoá ⇒ 401" — SAI trên cây hiện tại.** `users` = 10, cả 5 vai nền còn sống và active; C/D/M/ADM vốn là user **TẠM do chính script D-4 tạo**. Đo lại: **6/6 vai đăng nhập 200**, `me.username` khớp, 288/288 lượt tRPC thực hiện. Không cần tạo vai tạm nào ngoài những cái script đã tạo-và-xoá.
4. (chữ nghĩa) **"24 trạng thái × 2 vp × vi/en"** — harness có **12 trạng thái**, nhân 2 vp thành **24 ca mỗi ngôn ngữ** (48 ca tổng). Không phải 24 trạng thái riêng biệt.

**Brief ĐÚNG ở hai chỗ quan trọng:** (a) yêu cầu **xen kẽ hai build** nếu F1 lệch nền 52 — F1 của tôi lệch thật, và phép xen kẽ đã lật ngược nghi ngờ hồi quy; (b) yêu cầu đo **cặp số vẽ vs vào sổ** (G136) — chính cặp số ấy là thứ duy nhất chỉ thẳng gốc rễ ở cả hai máy 18 và 23.

### Lỗi của chính tôi — **6 chỗ, cả 6 đều ở THIẾT BỊ ĐO; 3 chỗ tạo SỐ 0 GIẢ, 1 chỗ tạo BÁO ĐỘNG GIẢ**
1. **Dò `/api/auth/me`** (route không tồn tại ⇒ SPA catch-all trả `text/html` 200) và suýt ghi "G100 mở lại". Route thật là `/api/trpc/auth.me` → `application/json`. Bắt được nhờ đọc harness Đợt 52 thay vì tin phản hồi.
2. ★ **SỐ 0 GIẢ #1:** `--man=/twin,...` qua Git Bash bị **MSYS đổi đường dẫn** thành `C:/Program Files/Git/twin` ⇒ 4 ca `/twin` **điều hướng lỗi** mà bảng tổng vẫn in "0/20 cặp". Chỉ lộ vì dòng log in `C:/Program Files/...`. Vá bằng `MSYS_NO_PATHCONV=1`, chạy lại đủ 20 ca.
3. ★ **SỐ 0 GIẢ #2:** gom số thị giác bằng **khoá tôi tự nghĩ ra** (`capNhanBadge`, `chip` coi là object) ⇒ in "chip 24 · capNB 0" — toàn 0 GIẢ. Đúng lớp lỗi Đợt 52 đã ghi, **tôi lặp lại**. Viết lại theo lược đồ THẬT (`capChongNhanBadge`, `chip` là mảng).
4. ★ **SỐ 0 GIẢ #3:** gom `nc` bằng khoá `capNhanKhoiKhac` (không tồn tại) ⇒ "TONG 0" cho **cả** Đợt 54 lẫn Đợt 52 — một "khớp nhau" hoàn toàn giả. Khoá thật là `macDinh.soCapNhanKhoi` / `sauKeo.soCapNhanKhoi` ⇒ 41 vs 41.
5. ★ **BÁO ĐỘNG GIẢ:** trích danh sách tệp đỏ của `npm test` bằng regex "mọi chuỗi `*.test.ts`" ⇒ **225 tệp, 7 trong `twin3d`** — suýt báo hồi quy nặng. Thật ra 7 tên ấy do **một lưới quét in ra**, không phải tệp trượt. Trích theo dòng `❯ … (N tests | M failed)` ⇒ **97 tệp, 0 tệp `twin3d`**. (Đối xứng với ba "số 0 giả": cùng một bệnh — đọc chuỗi thay vì đọc cấu trúc.)
6. **Bản chép `tomtat-F1.mjs` bị `sed` đổi luôn dòng của Đợt 53** (`.qa-dot53`→`.qa-dot54`, `f1-53-`→`f1-54-`) ⇒ bảng in hai hàng trùng nhau và **nền Đợt 53 biến mất**. Dựng lại từ bản gốc, chỉ CHÈN thêm một hàng.

> Bài học tôi rút cho chính mình: **bốn trong sáu lỗi đến từ ĐỌC CHUỖI thay vì ĐỌC CẤU TRÚC** — ba lần ra "toàn 0" (hình dạng nguy hiểm nhất của một phép đo hỏng, vì nó trông y hệt kết quả tốt) và một lần ra báo động giả 7 tệp `twin3d` đỏ. Thứ cứu cả bốn lần là **đối chứng**: một dòng log lạ, một con số mâu thuẫn, một phép so "khớp quá đẹp", và một con số "225 tệp đỏ" lớn vô lý. Vì vậy **mọi kết luận "0" trong báo cáo này đều đi kèm một phép đo ABLATION chứng minh thiết bị đo biết ra khác 0.**

---

## 7. DB / md5 / CỔNG TRƯỚC – SAU

| bất biến | trước | sau | phán quyết |
|---|---|---|---|
| DB 11 khoá | `2·82·37·42·10·7·0·108·7814·104·3` | y hệt | **LỆCH 0** |
| DB 6 khoá | `108·7814·10·7·2·82` | y hệt | **LỆCH 0** |
| hàng tạm | nhịp tim ×4 (hb 108→109→108 mỗi lần) · andon raised tạm ×2 · 4 user tạm · 1 API key tạm · 1 lần `operationStatus` đổi rồi trả | **tất cả dọn bằng `trap`**, đã nghiệm bằng đếm lại | sạch |
| 5 ảnh `test-results/` | 5 md5 | **5/5 KHÔNG ĐỔI** | giữ |
| `.qa-dot47/` | 616 tệp, 103 tệp 0 byte | **616/616 md5 KHÔNG ĐỔI**, vẫn 103 tệp 0 byte | không đắp, không xoá |
| 5 tệp mã gỡ vá | md5 đầu phiên | **5/5 KHỚP**, `git status` rỗng | mã sản phẩm nguyên vẹn |
| `e2e/` | — | `git status -- e2e/` **rỗng** | không sửa |
| `knowledge/` | 367 tệp, 184 dòng status | **365/367 byte y hệt** (2 tệp do `kb:operational-cards:test`), 184 dòng | KHAI RÕ, không khôi phục |
| cổng 3000/3001/3008/8080 | PID 28480/37128/38472/5192 | **y nguyên** | không đụng |
| cổng 3054 | — | tắt ở cuối phiên | — |
| HEAD | `360c9218` | `360c9218` (+ 1 commit `test(qa/dot54)` của chính tôi, pathspec `.qa-dot54/`) | — |

---

## 8. ★★★ PHÁN QUYẾT NGHIỆM THU CUỐI

### 5 tiêu chí gốc

| # | tiêu chí | phán quyết | số |
|---|---|---|---|
| 1 | **Yêu cầu gốc** — *nhà máy → chọn Line → Line 3D; chọn máy (Cell) → Machine 3D* | **ĐẠT** | Máy: **24/24** cú `mouse.click` tâm khối ⇒ đúng `/twin/may/:id` (2 màn × 2 vp × 5 máy + 4 sau kéo), **kể cả máy có tâm bị nhãn máy khác phủ**. Line: **6/6** cú click node line ⇒ đúng `/twin/line/:id`, cảnh vẽ xong. Bấm nhãn 4/4. e2e 16/16. Redirect 20/20 + 2 đối chứng TRƯỢT đúng |
| 2 | **Tối ưu** | **ĐẠT** | `__soCanvas = 1` ở **48/48** ca thị giác + 24/24 lần vào màn Máy + 6/6 màn Line (RB-4) · `demObject {1,1,1}` tên `twin3d-lo-may-su-kien` · draw 3–6 (ngân sách ≤ 150) · **0 khung / 40 s** đứng yên × 3 màn, **rAF 0**, **commit R3F 0**; đối chứng kéo ⇒ 87/76/83 khung |
| 3 | **Nhanh** | **ĐẠT** | F1 xen kẽ n=32 trên HEAD: **p50 1 181 · p90 1 579 · max 2 107 · 0/32 > 2 500 ms**, trong khi bản TRƯỚC vá cùng điều kiện có **2/32** đột biến và max 4 495 · câu chậm `DISTINCT ON machine_health_history` **0** (trước vá: 2) · EXPLAIN ấm **0,10 ms** (trước vá 114–153 ms), 43 hàng giống hệt · trễ click→pushState 0–0,5 ms · 0 request CDN |
| 4 | **Đẹp** | **ĐẠT** ★ (khoảng cách của QA lần 8 đã đóng) | Cặp nhãn×badge **0/48 ca** (vi + en, 2 vp, gồm trạng thái *màn Máy của máy ĐANG có cảnh báo*) · badge **VẼ = VÀO SỔ** ở 20/20 + 48/48 · 0 nhãn/badge/chip ra ngoài canvas · 0 bị che · 0 cặp chồng cùng loại · bbox thiết kế **34/34** · tràn 0 · font tự phục vụ, 0 CDN · **ablation cho 8/20 ca chồng, 11 928 px²** ⇒ nhân quả đã chứng minh |
| 5 | **Trực quan** | **ĐẠT** | 0 nhãn bị che / 0 ra ngoài canvas ở 48/48 · chip "còn N tên bị ẩn" **nhìn thấy được** trong canvas (G122) · vòng sức khoẻ đổi màu theo hạng (đọc trực tiếp trên 7 ảnh) · cursor `pointer` trên máy / `auto` trên sàn 4/4 · nhãn bấm được và tới đúng máy 4/4 · băng trung thực dữ liệu ở cả 3 màn · **ô "PackML / vận hành" nay hiện đúng `running`/`stopped`** thay vì `—` · đối chứng màn cũ `/factory-command`: 41 máy chồng một khối |

### 7 quyết định thiết kế

| QĐ | nội dung | phán quyết | số |
|---|---|---|---|
| **QĐ-18** | `/twin-studio` là **trang riêng**, không gộp | **ĐẠT** | Màn thứ 4 độc lập trong F1 (ĐẠT ở mọi lượt) · D-1 #41 `operator1 /twin-studio` **bị chặn** (CHẶN-ĐÚNG) trong khi `/twin` mở được ⇒ hai cổng quyền tách thật · redirect `/factory-floor-editor`→`/twin-studio`, `/layout`→`/twin-studio` ĐẠT |
| **QĐ-19** | **ba màn riêng, mỗi màn MỘT canvas** | **ĐẠT** | `man-twin-van-hanh` · `man-twin-line` · `man-twin-may` riêng biệt; `soCanvas = 1` ở **48/48** ca thị giác, 24/24 lần vào màn Máy, 6/6 lần vào màn Line |
| **QĐ-21** | URL **phân cấp** cho hai màn mới | **ĐẠT** | `/twin/line/{1,2,3}` và `/twin/may/{6,7,13,14,17,18,20,21,22,23,246,247}` đều là pathname thật · **30/30** lần điều hướng · deep-link `/twin/may/14`, `/twin/line/2` vào thẳng màn đúng (F1 + D-1 #37 vỏ app đúng) |
| **QĐ-23** | `/twin` là **cửa vào**; `?pv=`/`?chon=`/`?xem=` redirect | **ĐẠT** | D-2 K6: 6 đường MỚI ⇒ đúng đích, `tid=true`, 101–638 ms · 14 đường cũ ⇒ `/twin`/`/twin-studio` · 4 đường "giữ nguyên" giữ đúng `pv` · **2 đối chứng cố ý sai ⇒ TRƯỢT đúng ở cả 2 vp** |
| **QĐ-24** | what-if (`NganMoPhong`) chuyển sang **TwinLine** | **ĐẠT** | Bộ chọn "Mô phỏng"/"Simulation" có mặt trên `/twin/line/*` (đọc được trên ảnh `d3-en/line-mac-dinh-1600x900.png`) · trạng thái `line/mo-phong-mo` nằm trong bộ 24 và ĐẠT ở cả vi lẫn en, 2 vp · `digitalTwin.whatIf` 200 qua D-4 |
| **QĐ-25** | khoá API **chưa khai** phạm vi tenant ⇒ **404 fail-closed** | **ĐẠT** | HTTP v1 khoá SIM-FAC: `/machines/14/detail` (NM1) **200** · `/machines/257/detail` (NM18) **404** · `/machines/999999/detail` **404** (cùng hình dạng, G82) · không khoá **401** · 5/5 y hệt nền Đợt 52 |
| **QĐ-27** | index `machine_health_history ("machineId","createdAt" DESC)` **chỉ trên DB dev** | **ĐẠT (dev)** · production **CHƯA** | `idx_health_machine_created_desc` có thật trong `pg_indexes` · câu `DISTINCT ON` nay dùng **Index Scan (SkipScan)** 0,10 ms thay vì Seq Scan 114–153 ms · 0 câu chậm loại này trong cả phiên. **Production vẫn CHƯA áp** — thủ tục 3 bước ở cuối `drizzle/0356`, ghi thẳng là CHƯA LÀM |

### ⇒ **NGHIỆM THU CUỐI: ĐẠT 5/5 TIÊU CHÍ · 7/7 QUYẾT ĐỊNH ĐẠT** (QĐ-27 đạt trên dev, production khai rõ là chưa áp).

Tổng ca đo trong đợt này: **S1–S4 20 + S5 14 + S-C 22 + thị giác 48 + bbox 34 + K8 48 + K9 6 + e2e 16 + khung 6 + D-1 48 + D-2 64 + D-4 299 = 625 ca · 0 SAI · 0 HỎNG · 13 CHẶN-ĐÚNG · 2 N-A.**

### CÒN MỞ (nói thẳng, đừng suy ra là đã xong)
1. **Production chưa có index QĐ-27** — thủ tục 3 bước `ACCESS EXCLUSIVE` trong cửa sổ bảo trì, chưa ai chạy.
2. **`check:tests` 32 lỗi TS, trong đó 5 lỗi ở `client/src/components/twin3d/van-hanh/`** — nợ có sẵn, nhưng nằm TRONG module vừa nghiệm thu.
3. **`kb:operational-cards:test` ĐỎ** (194 chunk vs 164 card) — nợ có sẵn tại HEAD, ngoài phạm vi Twin; **và bản thân nó ghi vào cây** (G138).
4. **`ext:check` ĐỎ** — `vscode-extension` thiếu `@types/vscode`; lỗi môi trường.
5. **`npm test` toàn bộ đỏ sẵn** — 0 tệp đỏ trong `twin3d` (`.qa-dot54/g-test-full.txt`).
6. **`npm run test:e2e` toàn bộ CHƯA CHẠY** — một số spec ghi DB dev ngoài trap; chỉ spec trong phạm vi chạy (16/16).
7. **Bộ chọn nạp chưa từng chứng minh đầu-cuối**: DB dev có **1 nhà máy / 1 toà / 1 tầng** ⇒ đường "đổi tầng rồi bấm máy" chưa bao giờ chạy được (2 ca N-A của K8).
8. **41 cặp nhãn ∩ hình chiếu khối máy KHÁC** giữ nguyên từ Đợt 49 — không chặn kết cục (bấm vẫn đúng máy) nhưng chưa ai đóng.
9. **26 chỗ `DISTINCT ON` ngoài đường Twin chưa đo EXPLAIN** (Đợt 53 tự khai; tôi xác nhận là vẫn chưa đo).
10. **Nit "đẹp" (không chấm SAI)**: màn Line @1600 để trống ~40 % nửa trên khung nhìn, máy dồn xuống dải y ≈ 470–620. Tên seed không dấu ("Xuong lap rap ao (SIM)", "Tang tret").
