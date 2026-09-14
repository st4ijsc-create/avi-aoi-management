# Đợt 52 — QA lần 8, NGHIỆM THU CUỐI Twin 3D (QA độc lập)

Worktree `D:/SOURCES/_twin_wt` · nhánh `feat/twin-3d-trung-tam` · cổng riêng **3052** · 2026-09-12
Không sửa một dòng mã sản phẩm, không sửa `e2e/`. Mọi thứ ghi trong `.qa-dot52/`.

---

## 1. Cây + HỆ ĐO (Bước 0 PDCA — MSA)

| mục | trước | sau |
|---|---|---|
| HEAD | `389fa9b3` lúc 13:52 (= kỳ vọng brief) | `33c68607` lúc 13:54 — phiên khác commit **1 tệp docs** (`…digital-twin-design.md`, +5 dòng). ĐÚNG điều kiện "+N commit `docs(...)`" (G121) ⇒ không dừng |
| nhánh | `feat/twin-3d-trung-tam` | y nguyên |
| build | `.qa-dot52/dist-52a` (outDir **tuyệt đối, ngoài `client/`**) · 914 tệp · bundle `assets/index-C9m3IM7B.js` | build lặp `52b`: **md5 914/914 KHỚP TUYỆT ĐỐI** (G120) |
| thứ đang chạy = thứ vừa build | md5 bundle trên đĩa `cba23e4e…` | md5 bundle **3052 trả về** `cba23e4e…` — byte y hệt |
| `dist/` (3000/3001/3008 phục vụ) | KHÔNG chạm | KHÔNG chạm |
| `auth.me` | `content-type: application/json` (G100 đã đóng — e2e đo được vai thật) | |
| cache trên đường đo | Redis+Memory (`stats:dashboard:overview` TTL 300 s) ⇒ F1 chạy **7 lượt, mỗi lượt context trình duyệt MỚI**; lượt 1 (nguội) KHÔNG loại bỏ | |
| DB 11 khoá | `factories 2 · twin_dat_cho 82 · stations 37 · machines_active 42 · users 10 · andon 7 · andon_raised 0 · hb 108 · msl 7814 · permissions 104 · ufa 3` | **LỆCH 0** |
| DB 6 khoá (`.qa-dot34/dem.mjs`) | `hb 108 · msl 7814 · users 10 · andon 7 · factories 2 · datcho 82` | **LỆCH 0** |
| 5 ảnh `test-results/` | md5 ghi `.qa-dot52/md5-testresults-truoc.txt` | **5/5 KHÔNG ĐỔI** |
| `.qa-dot47/` (sự cố Đợt 50) | 616 tệp, **103 tệp 0 byte** | **616/616 md5 KHÔNG ĐỔI**, vẫn 103 tệp 0 byte — không đắp, không xoá |
| cổng 3000/3001/3008/8080 | PID 28480 / 37128 / 38472 / 5192 | **PID y nguyên** |
| cổng 3052 | — | PID 30192 (của tôi), tắt ở cuối |

**G130/G133 — kiểm TRƯỚC khi chạy harness cũ.** `grep -n "qa-dot[0-9]\+"` từng tệp; harness nào ghim
cứng đường ra thì **chép sang `.qa-dot52/` rồi sửa bản chép** (`hieu-nang52`, `nc52`, `thigiac52`,
`bbox52`, `tomtat-F1`), harness nào đọc ENV thì truyền ENV (`QA_OUT`/`QA_STATE`/`NC_OUT`/`API_VAI_OUT`/`D1_MOI`).
Không dùng `cmd > "$f"` ở bất kỳ đâu. Hai harness cũ vẫn ghi tệp PHIÊN vào thư mục đợt cũ
(`.qa-dot32/state-*.json`, `.qa-dot37/andon-tam.id`) — là tệp trạng thái tạm, không phải bằng chứng; ghi ra để biết.

**★ Phát hiện về DỮ LIỆU ĐO (giới hạn phạm vi nghiệm thu):** `twin_toa_nha` = **1 hàng** (id 24),
`twin_tang` = **1 hàng** (id 28), 82/82 `twin_dat_cho` ở tầng 28. Ba ô của bộ chọn nạp
(`chon-nha-may`/`chon-toa-nha`/`chon-tang`) mỗi ô **đúng 1 mục** ⇒ ca "đổi tầng/toà nhà rồi bấm máy"
**không có dữ liệu để đo** (N-A, không phải SAI). Xem §9 và §10.

---

## 2. Bảng ca — ĐẠT / SAI / HỎNG / CHẶN-ĐÚNG / N-A

| lưới | ca | ĐẠT | SAI | HỎNG | CHẶN-ĐÚNG | N-A | tệp thô |
|---|---:|---:|---:|---:|---:|---:|---|
| K8 kết cục gốc (bấm MÁY) | 48 | 46 | 0 | 0 | 0 | 2 | `.qa-dot52/k8/`, `k8-run.log` |
| K9 kết cục gốc (chọn LINE) | 6 | 6 | 0 | 0 | 0 | 0 | `.qa-dot52/k9/k9.json` |
| F1 "nhanh" (7 lượt × 4 màn) | 28 | 28 | 0 | 0 | 0 | 0 | `.qa-dot52/f1-52-*/`, `F1-tomtat.json` |
| 40 s đứng yên + đối chứng kéo | 6 | 6 | 0 | 0 | 0 | 0 | `nguon-khung/`, `keo-van-ve.json` |
| Thị giác 22 trạng thái × vi/en | 46 | 46 | 0 | 0 | 0 | 0 | `d3-vi/`, `d3-en/`, `thigiac-tomtat.json` |
| bbox 34 mục thiết kế QĐ-26 | 34 | 34 | 0 | 0 | 0 | 0 | `bbox-52/`, `run-bbox.log` |
| nhãn × badge màn MÁY (mới) | 32 | 28 | **4** | 0 | 0 | 0 | `nhanbadge/tong.json` |
| D-1 (48 ca Đợt 32) | 48 | 41 | 0 | 0 | 5 | 2 | `nen-*/`, `tomtat-D1-52.txt` |
| D-2 (K/E/I/P) | 54 | 50 | 0 | 0 | 4 | 0 | `chan/`, `run-D2.log` |
| Hợp đồng trạng thái 6 bề mặt | 6 | 5 | **1** | 0 | 0 | 0 | `hd-truoc/`, `hd-sau-hb/` |
| **TỔNG** | **308** | **290** | **5** | **0** | **9** | **4** | |

D-4 (288 lượt tRPC × 6 vai + 6 socket + 5 HTTP v1) chấm bằng **so sánh với nền Đợt 50**: LỆCH **0/299**
(`.qa-dot52/api-vai/`) — không cộng vào bảng trên để tránh đếm hai lần.

CHẶN-ĐÚNG 9 = 5 ca D-1 (operator1 `/twin-studio` + user 0 quyền × 4 màn bị chặn ĐÚNG)
+ 4 ca D-2 **đối chứng dương của thiết bị đo** (`do33.mjs:226-227` cố ý khai SAI đích ⇒ **phải** TRƯỢT; chúng TRƯỢT ⇒ thiết bị đo biết kêu).
N-A 4 = 2 ca K8i-tang (1 tầng/1 toà trong DB dev) + 2 ca D-1 (`N/A mất lối vào` + `xem #7/K1/K2`).

---

## 3. KẾT CỤC GỐC — *"chọn Line ⇒ Line 3D · chọn máy (Cell) ⇒ Machine 3D"*

### 3a. Chọn MÁY (K8) — `page.mouse.click` vào TÂM KHỐI trên canvas, vai `e2e_tai_loE`, 2 vp
**24/24 cú bấm tới ĐÚNG `/twin/may/<đúng id>`.** 0 lần đi nhầm sang máy của nhãn.

| màn / vp | 5 máy bấm | máy bị NHÃN MÁY KHÁC phủ tâm |
|---|---|---|
| `/twin` @1280×720 | 7, 17, 246, 6, 21 | 7 và 17 (nhãn máy 18 phủ) |
| `/twin/line/2` @1280×720 | 22, 13, 18, 14, 20 | 22 (nhãn máy 21) |
| `/twin` @1600×900 | 246, 13, 247, 18, 21 | 246 và 13 (nhãn máy 3) |
| `/twin/line/2` @1600×900 | 13, 18, 14, 20, 21 | — |
| + K8i sau kéo 60 px | 246 · 23 (×2 vp) | |

- Trễ **TRONG TRANG** (click → `history.pushState`): **0 – 0,5 ms** (ngưỡng 500 ms) — 24/24.
- Màn Máy vẽ xong: **2 209 – 2 320 ms** · `canvas 1/1` · `__soCanvas 1` · `may-dang-tai 0` · `__thongKeVe.calls 3–5`; ảnh chụp **SAU** khi vẽ xong.
- K8c sàn trống ⇒ URL không đổi **4/4** · K8d kéo ⇒ camera đổi & pathname giữ **4/4**
- K8e cursor `pointer` trên máy / `auto` trên sàn **4/4** · K8f bấm NHÃN ⇒ đúng máy của nhãn + Back về màn gốc **4/4**
- K8g `demObject {soObject:1, coHandler:1, trongScene:1, ten:["twin3d-lo-may-su-kien"]}` **4/4**
- K8h đối chứng dương `/factory-command` 3D **2/2** (cursor pointer, dialog 0→1, URL giữ). Ghi nhận **G102**: 41 máy chồng thành một khối, nhãn đè nhau — **không tính SAI** (màn cũ).
- K8i-tang **N-A ×2**: bộ chọn nạp trả 1 nhà máy / 1 toà / 1 tầng ⇒ không có tầng thứ hai để đổi.

### 3b. Chọn LINE (K9) — **brief Đợt 52 KHÔNG kê ca này; yêu cầu gốc có HAI vế nên tôi thêm**
Đường người dùng thật: `/twin` → bật "Cây phân cấp" → bung cây bằng nút mũi tên → **click node line**.
**6/6 ĐẠT** (3 line × 2 vp): `/twin/line/1|2|3`, canvas **1/1**, `__soCanvas 1`, nhãn máy 12–18,
12 ô trạm, dải line 1, draw **6**, trễ trong trang **0,2 – 0,9 ms**.

### 3c. Đường gõ URL (D-2 · K6, bảng redirect)
14 đường cũ + 6 đường mới QĐ-23 + 4 đường "giữ nguyên" ⇒ **ĐẠT hết**; 2 đối chứng cố ý sai ⇒ TRƯỢT đúng.
`e2e/twin-dot47-bam-canh.spec.ts` **16/16 PASS** trên 3052 (`TWIN_E2E_ANH=.qa-dot52/e2e-bamcanh`).

---

## 4. "NHANH"

**F1 `mang=chan` 1600×900, 7 lượt × 4 màn, cổng 3052** (`.qa-dot52/F1-tomtat.json`)

| điều kiện | n | p50 | p90 | max | đột biến > 2 500 ms |
|---|---:|---:|---:|---:|---|
| Đợt 50 nền | 28 | 1 231 | 2 443 | 6 217 | 2/28 |
| Đợt 51 có index | 28 | 1 183 | 1 545 | 1 889 | 0/28 |
| **★ Đợt 52** | **28** | **1 169** | **1 284** | **1 300** | **0/28** |

- ĐẠT 4/4 màn ở **cả 7 lượt** · request ra ngoài (CDN) **0** ở cả 7 lượt · fonts loaded, `check Geist/Mono true` (G117 đóng).
- Điều kiện tải ghi ở đầu mỗi lượt: `chrome=10 node=27` **không đổi** suốt 7 lượt.

**`[SLOW QUERY]` — đọc từ `stderr`** (`server-52a.err.log`; `stdout` có **0** dòng, đúng cảnh báo Đợt 51):
- trong cửa sổ F1 (dòng 1522→3483): **2 câu**
- cả phiên (khởi động + 24 lần mở màn Máy của K8 + 28 lần F1): **13 câu**
  - 4 × `DISTINCT ON … machine_health_history … "timestamp"` — 208,8 / 219,2 / 250,3 / 242,8 ms
  - 5 × `SELECT ts FROM ot_telemetry … ORDER BY ts DESC LIMIT 1` — 307,8–309,2 ms
  - 1 × `machine_health_history … "healthScore"` 248,4 · 1 × `product_inspections` 250,4 · 1 × `wip_tracking` 258,0 · 1 × `insert vram_leases` 255,9
- **`traSucKhoeMay` (ORDER BY `createdAt`): 0 câu chậm** ⇒ index QĐ-27 giữ được kết quả.

**40 s ĐỨNG YÊN × 3 màn** (`nguon-khung/`): **0 khung · rAF 0 lời gọi · commit R3F 0** (50/55/64 commit đều là `react-dom`).
**Đối chứng dương** (`keo-van-ve.json`): đứng yên 8 s → **0 khung**; **kéo 4 s → 93 / 170 / 82 khung**.
⚠ Bản đầu của đối chứng này **TRƯỢT** vì tôi đếm khung bằng `__thongKeVe.calls` (= draw call của MỘT khung, hằng số khi cảnh tĩnh).
`BomThongKe` (`KhungCanh.tsx:257`) **gán object MỚI mỗi khung** ⇒ đếm khung = đếm lần đổi ĐỊNH DANH. Sửa xong mới có số trên.

---

## 5. "ĐẸP · TRỰC QUAN"

**22 trạng thái × 2 vp × {vi, en}** (`thigiac52.mjs`, bbox thật từ DOM):

| | vi | en |
|---|---:|---:|
| nhãn / badge / chip đo được | 126 / 54 / 6 | 124 / 54 / 6 |
| NGOÀI canvas (nhãn / badge / chip) | 0 / 0 / 0 | 0 / 0 / 0 |
| BỊ CHE (nhãn / badge / chip) | 0 / 0 / 0 | 0 / 0 / 0 |
| cặp chồng nhãn×nhãn / badge×badge / nhãn×badge | 0 / 0 / 0 | 0 / 0 / 0 |
| badge `soAn` / `biChe` (gồm `/twin`@1280) | 0 / 0 | 0 / 0 |
| tràn trang · thiếu mặt chữ Geist | 0 · 0 | 0 · 0 |

- **Lệch lớp-vs-canvas `lop-nhan` + `lop-canh-bao`, 4 màn × 2 vp: (0, 0, 0, 0).**
- **bbox 34 mục thiết kế QĐ-26: ĐẠT 34 · TRƯỢT 0 / 34.**
- **Cặp nhãn ∩ hình chiếu khối máy KHÁC** (`nc52.mjs`, mô hình rời): `10 / 13 / 0 / 0 / 9 / 7 / 2 / 0` = **41** —
  **y hệt nền Đợt 49/50**. Không hồi quy, cũng không cải thiện. Không chặn kết cục (24/24 cú bấm vẫn đúng máy).

### ★ SAI MỚI (mắt thấy trước, phép đo xác nhận sau)
**Màn Máy của máy ĐANG CÓ CẢNH BÁO MỞ: badge cảnh báo ĐÈ LÊN nhãn tên máy.**
Đo bbox 8 máy × 2 vp × vi/en = 32 ca (`nhanbadge/tong.json`): **4 ca chồng, cả 4 đều là `/twin/may/18`**
(SIM-L2-CONVEYOR, 1 cảnh báo mở):

| vp | ngôn ngữ | diện tích chồng | % diện tích nhãn | ai ở trên |
|---|---|---:|---:|---|
| 1600×900 | vi | 1 595 px² | 35 % | badge |
| 1600×900 | en | 1 584 px² | 35 % | badge |
| 1280×720 | vi | 744 px² | 17 % | badge |
| 1280×720 | en | 756 px² | 17 % | badge |

28 ca còn lại (máy 0 cảnh báo): 0 chồng.
**Vì sao lưới 22 trạng thái không bắt:** các trạng thái `may/*` đều dùng `/twin/may/14`, mà máy 14 có **0 cảnh báo mở**
⇒ trạng thái "màn Máy của máy ĐANG có cảnh báo" **chưa bao giờ nằm trong lưới**. Ảnh: `nhanbadge/chong-may18-*.png`.

### Đọc ẢNH bằng mắt — 13 PNG (DOM count không phải bằng chứng thị giác)
`k8/k8-K8a-1600x900-may1-246` · `k8/k8-K8b-1600x900-may2-18` · `k8/k8-K8b-1280x720-may1-22` ·
`k8/k8-K8a-1280x720-may1-7` · `k8/k8-K8b-1600x900-may5-21` · `k8/k8-K8a-1600x900-may3-247` ·
`k8/k8-K8h-factory-command-1600x900` · `k8/k8-K8h-factory-command-1280x720` ·
`d3-vi/twin-nhan-tat-ca-1600x900` · `d3-vi/line-mac-dinh-1600x900` · `d3-en/twin-chua-chon-1280x720` ·
`nhanbadge/chong-may18-1600x900-vi` · `k9/k9-1600x900-node-cay-line:1`

Đọc được từ ảnh (không từ DOM):
- **Vòng sức khoẻ** quanh máy đổi màu theo hạng, và **biến mất khi máy "khoẻ"** (93 %, 100 % ⇒ không vòng; 60/70/73 % ⇒ vòng cam). Một tín hiệu trực quan THẬT, nhất quán qua 6 ảnh.
- Màn Line: 12/12 nhãn trạm, mũi tên dòng chảy giữa trạm, dải WIP đáy có số từng trạm ⇒ đọc được ngay.
- Chip **"còn 24 tên bị ẩn"** hiện rõ trong canvas ở `/twin` (G122 — thứ suốt 22 đợt không ai nhìn thấy).
- Băng trung thực dữ liệu hiện ở cả 3 màn: `SHADOW · Cập nhật 21 ngày trước ⚠`, `Dữ liệu quá cũ — trạng thái không đáng tin`.
- **Đối chứng `/factory-command` 3D (màn CŨ): 41 máy chồng thành MỘT khối, nhãn đè nhau** — chính là "chưa trực quan" mà ba màn Twin mới đã bỏ được. Nhìn cạnh nhau là thấy giá trị của QĐ-19/21.
- Nit "đẹp" (không chấm SAI): màn Line @1600 để trống ~40 % nửa trên khung nhìn, máy dồn xuống dải y≈560–640.
- Nit dữ liệu (không phải mã): tên seed không dấu — "Xuong lap rap ao (SIM)", "Tang tret".

---

## 6. BẢO MẬT + HỢP ĐỒNG

**D-4 — 6 vai × 48 lượt tRPC (288) + 6 socket + 5 HTTP v1.** So với nền Đợt 50: **LỆCH 0/288 · 0/6 · HTTP v1 giống hệt**.
- `operator1` (0 gán nhà máy): 200×30 · 403 `PERMISSION_DENIED`×5 · 404 `ENTITY_NOT_FOUND`×13 · **dấu vết nhà máy 1: 0 · nhà máy 18: 0**.
  Các lượt 200 đều là **vỏ rỗng có khai**: `sucKhoeMay {khai:[],tong:0,tongMayTrongPhamVi:0}` · `anToanRobot {robot:[],tong:0}` ·
  `getMachineStats {total:0,…,scopeApplied:true}` · `chiTietToaNha(24) → null`.
- user tạm **0 quyền**: 403×36 · 404×5 · 200×7 (vỏ rỗng) · dấu vết 0/0.
- **API key thiếu scope ⇒ 404** (`/machines/257/detail`, nhà máy 18) — fail-closed, QĐ-25; cùng hình dạng với id không tồn tại (G82). Không khoá ⇒ 401.
- Nghi ngờ của chính tôi đã kiểm và BÁC BỎ: `digitalTwin.whatIf` trả 200 + số cho vai 0 gán — nhưng `digitalTwinRouter.ts:218` là **hàm thuần**, trạm + cycle time do chính người gọi gửi lên, không đọc CSDL; đã có lưới `digitalTwinPhamVi.db.test.ts:303`.

**4 lưới phạm vi 180/180** · **census `phamViDocCensus` + `phamViTuyenCensus` 37/37 xanh**.

**Hợp đồng trạng thái 6 bề mặt + ABLATION SỐNG (G105)** — chèn **một** nhịp tim `now()` cho máy 14 (hàng tạm, `trap`, hb 108→109→108):

| bề mặt | TRƯỚC | SAU nhịp tim |
|---|---|---|
| `factoryCommand.overview.status` | offline | **idle** ← đổi |
| `factoryCommand.machineDetail.status` | offline | **running** ← đổi |
| `/twin` hàng máy `data-trang-thai` | khong_ro | idle ← đổi |
| `/twin/line/2` ô trạm | khong_ro | idle ← đổi |
| `/twin/may/14` chip trạng thái | khong_ro | idle ("Idle") ← đổi |
| cockpit 2D liveState | OFFLINE / Disconnected / 57d | ONLINE / Connected / 19s ← đổi |

**6/6 bề mặt phản ứng** ⇒ phép đo là phép đo SỐNG, không phải ảnh chụp chết.

### ★★★ SAI — hai bề mặt nói hai chữ khi máy *ĐANG KẾT NỐI*
`factoryCommand.overview` = **"idle"** ≠ `factoryCommand.machineDetail` = **"running"** (cùng máy 14, cùng thời điểm, cùng router).
Gốc rễ đọc tại nguồn:
- `factoryCommandService.ts:369-373` (overview) truyền `m.operationStatus` = cột `machines."operationStatus"` = **"stopped"** ⇒ `mapMachineStatus` ⇒ **idle**. ĐÚNG.
- `factoryCommandService.ts:570-578` (machineDetail) truyền `detail.liveState.value?.operationStatus ?? undefined`, mà `assetCockpit.machineDetail` trả `liveState.value.operationStatus = **null**` (đo trực tiếp qua API: khoá CÓ, giá trị `null`) ⇒ `null ?? undefined` = `undefined` ⇒ `trangThaiMayTuoi.ts:131-146` rơi vào `default:` ⇒ **running**.
- Bề mặt thứ ba cùng lỗi hình: `assetCockpitService.ts:580` gọi `mapMachineStatus(bangChung, **null**, now)` ⇒ `statusMapped` sẽ là "running" cho MỌI máy đang kết nối.

**Vì sao 8 đợt trước không thấy:** trên DB dev mọi máy nhịp tim cũ ⇒ cả hai bề mặt đều trả "offline" và **bằng nhau**.
Bất đồng **chỉ lộ khi máy thật sự kết nối** — tức là ở production.
**Phạm vi ảnh hưởng:** consumer duy nhất của `factoryCommand.machineDetail` là `FactoryCommandView.tsx:242`
(màn CŨ `/factory-command`, ngăn chi tiết). **Ba màn Twin đọc `factoryCommand.overview` ⇒ UI Twin KHÔNG sai.**
Nhưng bất biến "MỘT hợp đồng trạng thái" của Đợt 34 (đúng 4 nguồn API) **đang vỡ ở nguồn thứ hai**.

---

## 7. HỒI QUY + BẢNG CỔNG `package.json` (G108 — lần thứ 5)

### 7a. Lưới hồi quy
| lưới | kết quả | nền |
|---|---|---|
| `vitest client/src/components/twin3d` | **103 tệp / 2 452 XANH** | = Đợt 51 |
| 4 lưới phạm vi | **180/180** | = Đợt 51 |
| census `phamViDoc*`+`phamViTuyen*` | **2 tệp / 37 XANH** | = Đợt 51 |
| `kiem-vo-app-https.test.ts` | 30 XANH | = |
| `machinePresence` | 11 XANH | = |
| `server/db/twinCanh` | 7 XANH | = |
| fleet + robot | 21 tệp / 187 XANH (+ `fleetRollout` 1/13 chạy riêng = 22/200) | = Đợt 51 lượt 2 |
| e2e `twin-dot47-bam-canh` | **16/16 PASS** (2,1 phút) | = |
| `playwright test --list` | **151 test / 30 tệp** | = Đợt 51 |
| md5 8 tệp tracked `.qa-dot47/e2e` | **0 tệp bị đổi** (`git diff` rỗng) | hàng rào `duongRaBangChung` hoạt động |

### 7b. **MỌI** script trong `package.json` có tính chất KIỂM — chạy hết
| script | exit | kết quả | phán quyết |
|---|---:|---|---|
| `check` | 0 | `tsc --noEmit` sạch | ĐẠT |
| `check:tests` | **1** | **32 lỗi TS** | **ĐỎ SẴN** (Đợt 51 đã xác nhận bằng `git archive`) |
| `lint:tokens` | 0 | in "REPORT-ONLY baseline (exit 0)" | ĐẠT (nhưng **là báo cáo, không phải cổng**) |
| `i18n:check` | 0 | 0 placeholder mismatch · 0 key mới thiếu · nợ **339 + 20 đã đóng băng** | ĐẠT |
| `i18n:audit` | 0 | "GAPS FOUND (parity=108, missing-no-fallback=8)" | ĐẠT về exit, **báo cáo có gaps** |
| `kb:stale-check` | 0 | embeddings phủ đủ chunk | ĐẠT |
| **`kb:operational-cards:test`** | **1** | 5 pass / **1 fail**: *"expected exactly one operational chunk per card — 194 !== 164"* | **★ ĐỎ SẴN, CHƯA AI CHẠY** |
| `vision:validate` | 0 | %GRR(dx) 0,7 % · SPI volume %GRR 0,2 % | ĐẠT |
| `lake:verify` | 0 | PASS, ghi 2 tệp / 10 hàng | ĐẠT |
| **`ext:check`** | **2** | `TS2688: Cannot find type definition file for 'vscode'` | **★ ĐỎ — MÔI TRƯỜNG** (`vscode-extension` chưa cài phụ thuộc) |
| `test` (vitest toàn bộ) | — | **96 tệp đỏ / 1 408 · 196 test đỏ / 20 279 · 1 311 tệp xanh** | **ĐỎ SẴN** |
| `test:e2e` | — | `--list` 151/30 OK; spec trong phạm vi 16/16 PASS. **KHÔNG chạy toàn bộ** | xem ghi chú |
| `kiem-vo-app-https.mjs` (trong `build`) | 0 | ĐẠT `client/index.html` và `dist/public/index.html` | ĐẠT |

Không chạy (có lý do, ghi thẳng): `build` (cấm rebuild `dist/`) · `db:push`/`db:generate`/`test:db:setup` (đổi lược đồ) ·
`sim:*` (ghi DB dev) · `bench:ingest` (ghi DB dev) · `ai:eval:*`/`kb:eval`/`kb:test`/`eval:specialist`/`ai:bench` (cần model/GPU, không phải cổng đúng-sai) ·
`format`/`storybook`/`ext:build`/`ext:package`/`ext:test-that`/`monitor:*`/`kb:*` sinh dữ liệu · `ai:backfill`.
**`test:e2e` toàn bộ KHÔNG chạy**: một số spec tự tạo user/hàng trong **DB dev** ngoài các harness có `trap` của tôi,
mà bất biến "DB dev bất biến" là ràng buộc cứng của đợt này. Ghi thẳng là CHƯA ĐO, không suy ra là xong.

**★ Kiểm chứng "đỏ sẵn" của `test` toàn bộ, không tin lời khai:** 96 tệp đỏ — **0 tệp nào trong `twin3d`**.
Nhóm trội: 58 + 23 + 5 + 4 lỗi cùng một câu `[vitest] No "phaiDoiMatKhau" export is defined on the "../db" mock`
(đúng lớp lỗi đã ghi trong bộ nhớ dự án). Phân bố: `server/routers` 28 · `server/services` 11 · `server` 9 · còn lại rải.

**★ Kiểm chứng `kb:operational-cards:test` là nợ CÓ TRƯỚC:** ở worktree hiện tại 164 card vs 194 chunk (lệch 30);
đọc **từ blob đã commit tại HEAD**: 163 card vs 193 chunk (**cùng lệch 30**) ⇒ nợ có sẵn ở HEAD, không do cây bẩn.

**★ Sửa một chỗ Đợt 51 nói CHƯA ĐỦ:** Đợt 51 ghi "32 lỗi TS, **0 lỗi nằm trong `e2e/`**" — đúng, nhưng
**5/32 lỗi NẰM TRONG `client/src/components/twin3d/van-hanh/`**, tức trong chính module đang nghiệm thu:
`cayVanHanh.unit.test.ts` ×2 (`TS2741: Property 'tangId' is missing … XuongDauVao`) và
`hopNhatCanh.unit.test.ts` ×3 (`TS2322: … not assignable to type 'KhoiKey'`). Hai tệp sửa lần cuối ở Đợt 29/35;
kiểu sản phẩm siết lại sau đó mà test không theo. `vitest` xanh (esbuild bỏ kiểu), `tsc -p tsconfig.tests.json` đỏ.

---

## 8. PARETO SAI (5 ca)

| # | nguyên nhân gốc | số ca | nơi vá chính xác |
|---|---|---:|---|
| 1 | **Màn Máy không có chính sách tránh nhau giữa `lop-nhan` và `lop-canh-bao`.** Ở `/twin`/Line, `chinhSachNhan.ts` + `locBadge.ts` xếp tầng và dời chỗ (đo được: badge `doiCho` 30 lần, cặp chồng 0). Màn Máy chỉ có 1 nhãn + badge của chính máy ấy nên chưa ai gắn luật ⇒ hai lớp đặt độc lập, badge (z lớn hơn) đè 17–35 % nhãn | 4 | `client/src/components/twin3d/van-hanh/LopCanhBao.tsx` + `LopNhan.tsx` khi dựng trên `man-twin-may`; lưới phải thêm **trạng thái "màn Máy của máy ĐANG có cảnh báo"** vào bộ 22 |
| 2 | **`operationStatus` không được truyền qua hợp đồng `assetCockpit.machineDetail.liveState`** (`= null`), nên `factoryCommand.machineDetail` mất dữ kiện và `mapMachineStatus` rơi vào `default: → running` | 1 | `server/services/ecosystem/assetCockpitService.ts` (điền `liveState.value.operationStatus`) + `:580` `mapMachineStatus(bangChung, null, now)`; hoặc `factoryCommandService.ts:576` đọc thẳng `machines.operationStatus` như overview |

**Pareto HIỆU NĂNG (không phải SAI, nhưng là món rẻ nhất còn lại):**
`server/services/factoryCommandService.ts:289-294` — `SELECT DISTINCT ON ("machineId") … FROM machine_health_history
ORDER BY "machineId","timestamp" DESC`, **không có WHERE**, sắp theo `timestamp` (không phải `createdAt`).
`EXPLAIN (ANALYZE, BUFFERS)` hôm nay: **Seq Scan 214 197 hàng → Sort external merge Disk 8 824 kB → Unique 43 hàng, 136,7 ms ấm**
(`explain-factorycommand.txt`) — **y hệt bệnh lý mà QĐ-27 vừa chữa cho `traSucKhoeMay`** (Seq Scan 212 194 → Disk 7 848 kB → 288 ms).
Index sẵn có `("machineId","timestamp")` là **ASC**, câu cần `machineId ASC + timestamp DESC` ⇒ planner không dùng được.
**Nó nằm trên đường người dùng của cả ba màn Twin**: `client/src/components/twin3d/van-hanh/useTrangThaiSong.ts:87`
gọi `trpc.factoryCommand.overview.useQuery` (refetch nền) ⇒ **2/2 câu chậm trong cửa sổ F1 đến từ đây**.
Vá một lớp lỗi ở MỘT nơi mà không quét nơi thứ hai — đúng lớp G110/G106.

---

## 9. BRIEF SAI Ở ĐÂU (đếm) + LỖI CỦA CHÍNH TÔI

### Brief Đợt 52 — **4 chỗ**
1. **Mục 1 (K8) bỏ NỬA YÊU CẦU GỐC.** Yêu cầu nguyên văn của chủ sở hữu có hai vế —
   *"chọn Line thì hiển thị Line 3D"* và *"chọn vào máy (Cell) thì hiển thị Machine 3D"*.
   K8a…K8i chỉ kê **bấm MÁY**. Vế Line không có ca nào đi **đường người dùng thật**. Tôi thêm K9 (6/6 ĐẠT).
2. **"K8i … sau đổi tầng/toà nhà"** — DB dev có **1 toà / 1 tầng**, ba ô chọn mỗi ô 1 mục ⇒ ca này
   **không đo được**, không phải vì sản phẩm hỏng. Brief kê một ca mà dữ liệu không cho phép dựng.
3. **"`check:tests` đang ĐỎ 32 lỗi — nợ có sẵn"** — đúng con số, nhưng thiếu điều quan trọng nhất
   cho một buổi nghiệm thu: **5/32 lỗi nằm TRONG `client/src/components/twin3d/van-hanh/`**.
4. **"`tomtat-D1` cột 52"** — script không có "cột 52"; nó lấy cột MỚI từ ENV `D1_MOI` (mặc định `.qa-dot51`).
   Chạy được nhưng phải biết đặt `D1_MOI=.qa-dot52 D1_TRUOC=.qa-dot51`.

**Brief ĐÚNG ở chỗ tôi đã nghi oan:** "Đếm cặp nhãn ∩ khối máy khác (nền 41, từng trạng thái 10/13/0/0/9/7/2/0)".
Bộ đếm của `thigiac52` cho 20/21 nên tôi đã định báo brief sai — nhưng đó là **chỉ số khác** (`demNhan.deKhoiKhac`).
Chạy đúng harness (`nc52.mjs`) ra **đúng 10/13/0/0/9/7/2/0 = 41**. Ghi lại để không ai lặp cái nghi ngờ ấy.

### Lỗi của chính tôi — **4 chỗ**, cả 4 đều là THIẾT BỊ ĐO
1. **Đối chứng "kéo vẫn vẽ" TRƯỢT ở bản đầu** vì tôi đếm khung bằng `__thongKeVe.calls` (draw call của MỘT khung,
   hằng số khi cảnh tĩnh). Đúng là đếm **lần đổi ĐỊNH DANH** của object mà `BomThongKe` gán mỗi khung.
   ★ Chính **đối chứng dương** cứu kết luận: nếu không có nó, "0 khung khi đứng yên" có thể chỉ là canvas chết.
2. **Gom số thị giác nhầm khoá** (`nhan.ngoaiCanvas`, `badgeDoiCho` coi là mảng) ⇒ ra "toàn 0" **GIẢ**.
   Bắt được vì con số `badge dời chỗ 0` mâu thuẫn với dòng in `dờiChỗ 6` của chính harness. Viết lại theo lược đồ THẬT.
3. **K9 bản đầu chấm 0/6 SAI** vì dùng `__demTuongTac.dsMay()`: điều hướng **trong trang** từ `/twin?do=1`
   sang `/twin/line/:id` **làm mất `?do=1`** ⇒ cảnh mới không gắn cửa sổ đo, `dsMay()` còn lại là closure của cảnh đã unmount.
   Mâu thuẫn với K8 (cùng màn, mở thẳng `?do=1`, 12 máy) lộ ra phép đo sai. Chấm lại bằng tín hiệu DOM ⇒ 6/6 ĐẠT.
4. **Diff D-4 lần đầu chỉ so 12 lượt** (tôi đoán hình dạng JSON) thay vì 288 — sửa sau khi ĐỌC lược đồ (`ds[]` 48 phần tử/vai).
5. (nhỏ) `grep "QĐ-19"` không ra gì vì tài liệu viết **"QD-19"** không dấu ở các mục 14p/14q — phải grep cả hai lối viết.

---

## 10. ★★★ PHÁN QUYẾT NGHIỆM THU CUỐI — từng mục

| # | mục | phán quyết | số |
|---|---|---|---|
| 1 | **Yêu cầu gốc** — *nhà máy → chọn Line → Line 3D; chọn máy (Cell) → Machine 3D* | **ĐẠT** | Máy: **24/24** cú `mouse.click` tâm khối ⇒ đúng `/twin/may/:id` (2 màn × 2 vp × 5 máy + 4 sau kéo), gồm **5 máy có tâm bị nhãn máy khác phủ**. Line: **6/6** cú click node line trong cây ⇒ đúng `/twin/line/:id`, cảnh vẽ xong. Nhãn: 4/4. e2e 16/16. Redirect 20/20. |
| 2 | **Tối ưu** | **ĐẠT** | `__soCanvas = 1` ở **cả 3 màn** (RB-4) · `demObject 1/1/1` tên `twin3d-lo-may-su-kien` (0 object mồ côi trong `internal.interaction`) · draw call **3–6** (ngân sách §4 ≤ 150) · **0 khung/40 s** đứng yên × 3 màn, **rAF 0 lời gọi**, **commit R3F 0** · `frameloop="demand"` chứng minh bằng đối chứng: kéo ⇒ 93/170/82 khung |
| 3 | **Nhanh** | **ĐẠT** | F1 n=28: **p50 1 169 · p90 1 284 · max 1 300 ms · 0/28 > 2 500 ms** (Đợt 51: 1 183/1 545/1 889; Đợt 50: 1 231/2 443/6 217, 2/28) · trễ trong trang click→pushState **0–0,9 ms** · màn Máy vẽ xong 2,2 s · `traSucKhoeMay` **0 câu chậm** · 0 request CDN |
| 4 | **Đẹp** | **CHƯA** (thiếu chính xác 1 thứ) | bbox thiết kế **34/34**, tràn 0, font tự phục vụ 0 CDN, 0 nhãn/badge/chip ra ngoài canvas, 0 cặp chồng ở **46/46** trạng thái×vp×2 ngôn ngữ. **Thiếu:** trên `/twin/may/:id` của máy **đang có cảnh báo mở**, badge cảnh báo đè **17–35 %** nhãn tên máy (**4/4 ca** vp×ngôn ngữ, chỉ máy 18 có cảnh báo trong tập đo). Đó là **toàn bộ** khoảng cách tới ĐẠT ở mục này |
| 5 | **Trực quan** | **ĐẠT** | 0 nhãn bị che / 0 ra ngoài canvas ở 46/46 ca · chip "còn N tên bị ẩn" **nhìn thấy được** trong canvas (G122) · vòng sức khoẻ đổi màu theo hạng và biến mất khi "khoẻ" (đọc trực tiếp trên 6 ảnh) · cursor `pointer` trên máy / `auto` trên sàn 4/4 · nhãn bấm được và tới đúng máy 4/4 · băng trung thực dữ liệu hiện ở cả 3 màn · đối chứng: màn cũ `/factory-command` 41 máy chồng một khối |
| 6 | **QĐ-18** — `/twin-studio` là **trang riêng**, không gộp | **ĐẠT** | `/twin-studio` là màn thứ 4 độc lập trong F1 (4/4 ĐẠT ở 7 lượt) · D-1 #41 `operator1 /twin-studio` **bị chặn** (CHẶN-ĐÚNG) trong khi `/twin` mở được ⇒ hai cổng quyền tách thật · redirect `/factory-floor-editor`→`/twin-studio`, `/layout`→`/twin-studio` ĐẠT |
| 7 | **QĐ-19** — **ba màn riêng, mỗi màn MỘT canvas** | **ĐẠT** | `man-twin-van-hanh` · `man-twin-line` · `man-twin-may` tồn tại riêng; `__soCanvas = 1` và `canvasTrongMan = 1` ở **24/24** lần vào màn Máy, 6/6 lần vào màn Line, và mọi trạng thái của bộ 22 |
| 8 | **QĐ-21** — URL **phân cấp** cho hai màn mới | **ĐẠT** | `/twin/line/{1,2,3}` và `/twin/may/{6,7,13,14,17,18,20,21,22,23,246,247}` đều là pathname thật (không query) — **30/30** lần điều hướng · deep-link `/twin/may/14`, `/twin/line/2` trong F1 vào thẳng màn đúng · D-1 #37 vỏ app đúng khi deep-link |
| 9 | **QĐ-23** — `/twin` là **cửa vào**, `?pv=`/`?chon=`/`?xem=` redirect | **ĐẠT** | D-2 K6: 6 đường MỚI (`?pv=line:2`, `?chon=line:2`, `?chon=machine:14`, `?xem=machine:14`, `?pv=machine:14`, `?pv=line:2&chon=machine:14`) ⇒ đúng đích, tid có, 598–612 ms · 14 đường cũ ⇒ `/twin`/`/twin-studio` · 4 đường "giữ nguyên" giữ đúng `pv` · **2 đối chứng cố ý sai ⇒ TRƯỢT đúng** |
| 10 | **QĐ-24** — what-if (`NganMoPhong`) chuyển sang **TwinLine** | **ĐẠT** | Bộ chọn "Mô phỏng" có mặt trên `/twin/line/*` (đọc được trên ảnh `line-mac-dinh-1600x900` và `k9-…-line:1`) · trạng thái `line/mo-phong-mo` nằm trong bộ 22 và ĐẠT ở cả vi lẫn en, 2 vp · `digitalTwin.whatIf` trả 200 + số đúng qua D-4 |
| 11 | **QĐ-25** — khoá API **chưa khai** phạm vi tenant ⇒ **404 fail-closed** | **ĐẠT** | HTTP v1 với khoá SIM-FAC: `/machines/14/detail` (NM1) **200** · `/machines/257/detail` (NM18) **404** · `/machines/999999/detail` **404** (cùng hình dạng, G82) · không khoá **401** · 5/5 lượt giống hệt nền Đợt 50 |
| 12 | **QĐ-27** — index `machine_health_history ("machineId","createdAt" DESC)` **chỉ trên DB dev** | **ĐẠT (dev)** | `idx_health_machine_created_desc` **có thật** trong `pg_indexes` cạnh 7 index cũ · `traSucKhoeMay` **0 câu chậm** trong 13 câu chậm của cả phiên (nền Đợt 50: 24/32 câu chậm là câu này) · F1 max 1 300 ms, 0 đột biến. **Production vẫn CHƯA áp** — thủ tục 3 bước ở cuối `drizzle/0356`, ghi thẳng là CHƯA LÀM |

### CÒN MỞ (nói thẳng, đừng suy ra là đã xong)
1. **SAI #1** badge cảnh báo đè nhãn trên màn Máy — 4/4 ca của máy có cảnh báo. Lưới 22 trạng thái **không có** trạng thái ấy.
2. **SAI #2** `factoryCommand.machineDetail` = "running" trong khi `overview` = "idle" cho máy đang kết nối. Chỉ lộ ở production.
3. **Bản sao thứ hai của câu chậm** `factoryCommandService.ts:289` — Seq Scan 214 197 hàng, 136,7 ms ấm, **trên đường của 3 màn Twin**.
4. **Bộ chọn nạp chưa từng được chứng minh đầu-cuối**: DB dev có 1 toà / 1 tầng ⇒ đường "đổi tầng rồi bấm máy" **chưa bao giờ chạy**.
5. **`check:tests` 32 lỗi TS, trong đó 5 lỗi ở `twin3d/van-hanh`**.
6. **`kb:operational-cards:test` ĐỎ** (194 chunk vs 164 card) — nợ có sẵn tại HEAD, ngoài phạm vi Twin.
7. **`ext:check` ĐỎ** — `vscode-extension` thiếu phụ thuộc (`@types/vscode`).
8. **`npm test` toàn bộ: 96 tệp đỏ / 196 test** — nợ có sẵn, 0 tệp trong `twin3d`.
9. **`npm run test:e2e` toàn bộ CHƯA CHẠY** (một số spec ghi DB dev ngoài trap) — 151 test/30 tệp mới chỉ `--list`.
10. **Production chưa có index QĐ-27.**
11. **41 cặp nhãn ∩ khối máy khác** giữ nguyên từ Đợt 49 — không chặn kết cục nhưng chưa ai đóng.
