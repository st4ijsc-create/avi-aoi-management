# ĐỢT 59 — bốn món cuối sau QA lần 10 (A · B · C · D)

Worktree `D:/SOURCES/_twin_wt`, nhánh `feat/twin-3d-trung-tam`. Cổng riêng **3059**.
Thiết bị đo của đợt này là **của đợt này**: `.qa-dot59/{A-do,A-ablation,C-do,do59}.mjs` +
bản sao có sửa đường ra của `thigiac59` / `bbox59` / `lech-lop-va-idle59` / `tomtat-d1-32`.
`.qa-dot44/do32.mjs` chạy **nguyên trạng, không sửa một dòng**.

---

## 1. Cây · bản dựng · hệ đo

| Mục | Trước | Sau |
|---|---|---|
| HEAD | `5e3a6295` = kỳ vọng ⇒ **KHỚP** (`.qa-dot59/00-head-XONG.txt`) | `70cd30dc` (+3 commit của Đợt 59, +1 docs) |
| Cổng của tôi | 3059 trống | 3059 **ĐÓNG** cuối đợt |
| Cổng CẤM | 3001 PID 23980 · 3008 PID 32584 · 8080 PID 5192 · 3000 tắt | **y nguyên, 0 lần chạm**; `dist/` **không dựng lại** |
| DB 11 khoá | `factories 2 · twin_dat_cho 82 · stations 37 · machines 42 · users 10 · andon 7 · raised 0 · hb 108 · msl 7814 · permissions 104 · ufa 3` | **11/11 KHỚP** |
| DB 6 khoá | `hb 108 · msl 7814 · users 10 · andon 7 · factories 2 · datcho 82` | **6/6 KHỚP** |
| 5 ảnh `test-results/` | 5 md5 | **5/5 KHỚP TUYỆT ĐỐI**, `git status test-results/` RỖNG |
| `.qa-dot47/` | 103 tệp 0 byte (đệ quy) / 636 tệp | **103 / 636 — không đắp, không xoá** |
| `playwright.config.ts` `outputDir` | `.qa-pw-output` | giữ nguyên (G140) |

### 1.1 Bản dựng (G141 — bản đang đo có đúng commit không)

| Bản | Nguồn | Bundle | Đối chứng chéo |
|---|---|---|---|
| `dist-head0` | worktree tại HEAD `5e3a6295` (0 đổi nguồn so với `a3032508`) | `index-CZsT1Xbd.js` | **914 dòng md5 GIỐNG HỆT `.qa-dot58/dist-head1`** (0 dòng khác) |
| `dist-A` | + vá mục A | `index-x-z2ele3.js` | — |
| `dist-AC` | + vá mục A và C (bản cuối) | `index-knE81yYW.js` | — |
| `dist-nen` | `git archive 2f835df1` + chuẩn hoá LF | `index-CVKD-dS2.js` | `index`/`TwinVanHanh`/`TwinLine`/`TwinMay`/`EmptyState` **giống TỪNG BYTE** `.qa-dot58/dist-nen3` sau khi trung hoà token băm tên tệp |

Ký hiệu nhận bản dựng: `dist-nen` **có** `trang-thai-may`, **không có** `vien-tin-cay-may`/`flex-[7]`;
`dist-head0` ngược lại. (Đúng bảng ký hiệu của Đợt 58.)

---

## 2. MỤC A — nhãn 3D nằm dưới tay nắm sau khi THU rồi MỞ LẠI panel trái

### 2.1 Gốc rễ — **brief đoán SAI, và chỗ sai đáng ghi**

Brief: *"nếu tay nắm/panel không nằm trong tập quan sát thì đó chính là lỗ"*.
Grep lại (G83): `nut-thu-trai` **CÓ** `data-che-nhan="1"` (`TwinVanHanh.tsx:3556`) nên `TheoDoiLopPhu.quet()`
**đã** `ro.observe` nó từ khung đầu tiên. Lỗ ở chỗ khác:

> tay nắm đổi **`left`** (`left-0` ↔ `left-56 2xl:left-72`) qua `transition-[left] duration-200` —
> **kích thước không đổi một pixel nào**, mà `ResizeObserver` theo đặc tả chỉ báo khi hộp **CỠ** đổi.

Chuỗi thật khi MỞ LẠI panel: `t=0` panel `w-0→w-72` ⇒ RO kêu ⇒ khung được vẽ **trong khi tay nắm còn
ở `left≈0`** ⇒ `locNhan` chỉ tránh dải x∈[0,21] rồi thả nhãn vào đúng chỗ tay nắm SẮP tới; `t=200`
tay nắm tới `left=288` — **không ai kêu** ⇒ `frameloop="demand"` không vẽ khung nào nữa ⇒ nhãn ở lì.

### 2.2 Trước — sau (`.qa-dot59/A-{truoc,sau}/kq.json`, ảnh kèm)

Diện tích giao nhãn ∩ tay nắm (px²), đọc từ DOM sống; **fail-closed**: 0 nhãn hoặc không thấy tay nắm ⇒ HỎNG.

| Ca | t0 (mặc định) | sau THU | mở +2 s | +5 s | +17 s | sau HÍCH cỡ cửa sổ |
|---|---|---|---|---|---|---|
| 1600×900 vi **TRƯỚC** | 0 | 0 | **2 nhãn / 210** | **210** | **210** | 0 |
| 1600×900 vi **SAU** | 0 | 0 | **0** | **0** | **0** | 0 |
| 1600×900 en **TRƯỚC** | 0 | 0 | **2 / 355** | **355** | **355** | 0 |
| 1600×900 en **SAU** | 0 | 0 | **0** | **0** | **0** | 0 |
| 1280×720 en **TRƯỚC** | 0 | 0 | **1 / 5** | **5** | **5** | 0 |
| 1280×720 en **SAU** | 0 | 0 | **0** | **0** | **0** | 0 |
| 1280×720 vi | 0 | 0 | 0 | 0 | 0 | 0 |

★ **Phát hiện thêm so với QA lần 10:** bệnh CÓ tái hiện ở **1280×720 tiếng Anh** (5 px²) — Đợt 58 chỉ đo
tiếng Việt ở 1280 nên kết luận "1280 không tái hiện" là **đúng một nửa**.
Số mốc HỎNG = 0 ở mọi lượt (thước đọc được dữ kiện ở mọi ca).

**Ảnh tự đọc:** `A-truoc/1600x900-vi-3-mo-17s.png` — tay nắm `‹` (x 578–593) chồng mép trái
`SIM-L3-SPI` và `SIM-L3-CONVEYOR`. `A-sau/1600x900-vi-3-mo-17s.png` — cùng camera, cùng 21 nhãn,
nhãn đã dạt sang phải (`SIM-L3-FCT` bắt đầu ở x≈612), tay nắm trống.

### 2.3 Ablation **hai chiều**

1. **Theo bản dựng** — `dist-head0` (chưa vá) 210/355/5 px² · `dist-A` (đã vá) **0 px²**. Một thay đổi, hai kết cục.
2. **Chạy thật trên CHÍNH bản đã vá** (`.qa-dot59/Aab-A/kq.json`, không sửa mã): sau thu→mở
   `0 px²` → **gỡ `data-che-nhan` của tay nắm ⇒ 2 nhãn / 281 px²** (`SIM-L3-CONVEYOR` 152 +
   `SIM-L3-ICT` 129 — đúng cặp Đợt 58 ghi) → gắn lại ⇒ `0 px²`.
   Chiều này chứng minh **lớp nhãn ĐÃ TÍNH LẠI** sau thu→mở (nếu không, gỡ thuộc tính cũng không đổi gì).

### 2.4 Lưới

- **Cơ chế** (`theoDoiDoiCho.dom.test.tsx`, jsdom, bắn `transitionend` như trình duyệt): 13 ca —
  ①4 ca "dời chỗ ⇒ invalidate", ②2 ca "ngoài lớp phủ / sự kiện trần ⇒ không", ③**7 ca đối chứng dương**
  (`color`/`background-color`/`opacity`/`box-shadow`/`border-color`/`fill`/thuộc tính lạ ⇒ **không** mua
  được khung — hàng rào của bất biến *idle 0 khung/40 s*).
- **Chỗ nối** (`cheNhan.unit.test.ts` ⑥⑦): 10 ca — gắn/gỡ đúng hai loại sự kiện, dùng CHÍNH `invalidate`
  và CHÍNH hằng `THUOC_TINH_CHE_NHAN`, RO vẫn còn, và hai tay nắm thật dùng `transition-[left]`/`[right]`.
- **Thị giác**: bộ ca **12 → 13 trạng thái × 2 vp = 24 → 26 ca**, mỗi ngôn ngữ.

★★★ **Lỗi của chính tôi, bắt được bằng ablation:** bản đầu của trạng thái mới mở `/twin` ở chính sách
nhãn **mặc định** (`chỉ tên máy bất thường`, 3–4 nhãn) ⇒ ca mới **XANH cả trên bản dựng CHƯA VÁ**.
Một ca không biết KÊU trên ca dương đã biết thì không phải lưới. Sửa sang `?thu=nhanTatCa` (21 nhãn)
+ thêm hai bất biến của chính ca ấy (`panel 288→0→288` thật, và `soNhanSauMo > 0` — chống "0 giả"):

| | `dist-head0` (chưa vá) | `dist-AC` (đã vá) |
|---|---|---|
| 26 ca × vi | **1 VI PHẠM** — `1600x900 twin-thu-mo-panel: nhãn bị che=2` (`nut-thu-trai:152` + `:129`) | **0 vi phạm** (161 nhãn · 70 badge) |
| 26 ca × en | (không chạy) | **0 vi phạm** (159 nhãn · 70 badge) |

---

## 3. MỤC B — thước D-1 thế hệ mới `do59.mjs`

### 3.1 Đặt ở đâu và vì sao

`.qa-dot59/do59.mjs` (**không** `scripts/`): `scripts/` là cổng chạy được trên MỌI cây (`npm run`,
người ngoài đợt cũng gọi), còn thước D-1 ghim vai `e2e_tai_loE`/`operator1`/user tạm, máy 14, line 2,
factory 1 của **DB dev này** và **GHI hàng tạm** (`andon_events`, `users`). Đặt nó vào `scripts/` là
mời người khác chạy một thứ ghi vào DB. `do32.mjs` ở `.qa-dotNN/` vì đúng lẽ ấy.

### 3.2 Hai luật

- **L1 FAIL-CLOSED** — mỗi ca khai TÊN dữ kiện nó cần; thiếu một cái ⇒ **HỎNG** kèm tên. `??` không
  được dùng để vá một lỗ ĐỌC.
- **L2 ĐỌC THEO NGHĨA** — #15/#16/#20 đọc **chữ người dùng thấy** (nhãn 3D trên cảnh · viên tin cậy ·
  ngăn phải · cockpit 2D · hàng máy trên `/twin`), hai ngôn ngữ, 0 `data-*`.

### 3.3 Kết quả trên **cả hai** bản dựng

| | ĐẠT | SAI | CHẶN-ĐÚNG | N/A | HỎNG | Ô **không** có phán quyết |
|---|---|---|---|---|---|---|
| `do59` trên HEAD (`dist-AC`) | **42** | 0 | 5 | 1 | **0** | **0** |
| `do59` trên NỀN (`dist-nen` = `2f835df1`) | **42** | 0 | 5 | 1 | **0** | **0** |
| `do32` (đóng băng) trên HEAD (`dist-AC`) | 39 | **2** | 5 | 1 | 0 | **1** ("xem #7") |

- **0/48 ô khác nhau giữa hai bản dựng** với `do59` ⇒ thước mới **không nhạy với việc dời testid**
  của Đợt 57, và ba vá của Đợt 59 **không đổi một ô D-1 nào**.
- `do32` trên bản dựng của tôi **tái lập tuyệt đối** cột Đợt 57/58 (`Đổi phán quyết Đợt 41 → HEAD: 0`).

★ Bằng chứng "đọc theo nghĩa" đắt giá nhất: **cùng một sự thật, hai CHỖ khác nhau** —
trên NỀN câu tuổi nằm ở **ngăn phải** (`tuoiTuNgan="58 days"`, `tuoiTuCanh=null`); trên HEAD nó nằm ở
**viên tin cậy trên cảnh** (`tuoiTuCanh="58 days"`, `tuoiTuNgan=null`). `do59` cho **cùng một phán quyết**.

### 3.4 Bảng đối chiếu từng ô — xem `.qa-dot59/BANG-DOI-CHIEU.md` (48 dòng)

**3 ô đổi phán quyết** (`do32` → `do59`), đúng như QA lần 10 dự báo cộng một ô nữa:

| # | `do32` | `do59` | Vì sao |
|---|---|---|---|
| **15** | **SAI** (`chip null · header OFFLINE`) | **ĐẠT** | do32 đọc `trang-thai-may@data-trang-thai` — Đợt 57 **DỜI** ⇒ `null`. do59 đọc 4 nguồn CHỮ: nhãn 3D `"Unknown"` · ngăn `Không rõ` · cockpit `OFFLINE` · hàng `/twin` `"SIM-L2-AOI Unknown 58 days"` ⇒ đồng thuận |
| **16** | **SAI** (`"null" · Disconnected`) | **ĐẠT** | do32 đọc `ngan-do-tuoi` — Đợt 57 dời sang viên tin cậy ⇒ `null`. do59 đọc CÂU tuổi ở bất kỳ đâu: `"58 days"` |
| **20** | **ĐẠT — XANH GIẢ** (`doTuoi` **null ×5**, hiển thị `" · · · · "`) | **ĐẠT — thật** (`58 days` ×5) | do32: `every(m => !/Never/.test(m.doTuoi ?? ""))` ⇒ xanh trên **TẬP RỖNG** (G146) |
| **3** | **KHÔNG CÓ PHÁN QUYẾT** (`href line 0 · máy 0` ⇒ "xem #7") | **ĐẠT** | do32 đếm `<a href>` — cơ chế đã CHẾT sau QĐ-23. do59 đo theo VAI TRÒ: bấm được + URL đổi đúng |
| **12** | ĐẠT (`camĐổi true`) | **ĐẠT — khác CƠ SỞ** | do32 suy từ "vị trí nhãn có đổi không", mà `?cam=10,5,10,0,0` cho **0 nhãn** ⇒ đang so 12 với 0 ⇒ ĐẠT kể cả khi trang chết. do59 đọc **tư thế camera thật**: `(19.2,21.4,27.8) → (10.0,5.0,10.0)` |

### 3.5 Chứng minh fail-closed (không phải lời khai)

Nạp cho `do59` **đúng** dữ kiện mà `do32` đọc được trên HEAD (`null`) — `.qa-dot59/fmu/` —
rồi chạy phán quyết:

| ô | `do32` trên dữ kiện ấy | `do59` trên **cùng** dữ kiện ấy |
|---|---|---|
| 15 | **SAI** (vu oan sản phẩm) | **HỎNG** — `KHÔNG ĐỌC ĐƯỢC: nghia.trangThaiTuNhan3D, nghia.nganPhaiKhongRo` |
| 16 | **SAI** | **HỎNG** — `nghia.tuoiToanMan` |
| 20 | **ĐẠT** (xanh giả) | **HỎNG** — `mayMoc[*].tuoiToanMan` |
| 12 | **ĐẠT** | **HỎNG** — `camKhong, camCo` |

Tổng: `N=48 · ĐẠT 38 · HỎNG 4 · CHẶN-ĐÚNG 5 · N/A 1 · 0 ô không có phán quyết`.
**Không ô nào XANH trên tập rỗng, không ô nào vu oan sản phẩm vì thiết bị đo mù.**

---

## 4. MỤC C — cân lại chiều cao panel trái (chỉ ở 1600)

### 4.1 Số học trước khi vá (`.qa-dot59/C-truoc/kq.json`) — khớp từng số của QA lần 10

Hằng của **BỐ CỤC** (giống nhau ở cả hai cỡ ⇒ không phải hằng của viewport):
khung cố định dải cảnh báo **91 px** · hàng tồn đọng **41 px** · tiêu đề nhóm **24 px** ·
khung cố định danh sách **44 px** · hàng máy **24 px** · `D = vpH − 231 − 41 − 30`.

| | D | dải (7/12) | ô cuộn tồn đọng | hàng tồn đọng ĐỦ | danh sách (5/12) | hàng máy ĐỦ |
|---|---|---|---|---|---|---|
| @1600×900 | 598 | 349 | 258 px | **5** (5,67) | 249 | **8** (8,56) |
| @1280×720 | 418 | 244 | 153 px | **3** (3,12) | 174 | **5** (5,43) |

### 4.2 Vì sao **không** dùng `2xl:` — số học bác bỏ, không phải khẩu vị

`2xl` là breakpoint theo **BỀ NGANG**. Cửa sổ **1600×720** vẫn khớp `2xl` nhưng `D` chỉ 418 px;
tỉ lệ 7:6 ở đó cho ô cuộn 134 px = **2,7 hàng** ⇒ **phá chính tiêu chí ≥3 hàng** mà mục 13 vừa mua được.
Ràng buộc là CHIỀU CAO ⇒ phải đọc theo chiều cao: **trần** cho dải, phần dôi ra chảy sang danh sách
(flexbox đóng băng item chạm `max-height` rồi chia lại chỗ trống cho anh em còn co giãn).

**Trần = 328 px** = 91 (khung cố định) + 24 (tiêu đề nhóm) + 5×41 (năm hàng tồn đọng) + 8 dự phòng.

### 4.3 Sau vá (`.qa-dot59/C-sau/kq.json`) — dự đoán và đo khớp nhau

| | dải | ô cuộn | hàng tồn đọng | danh sách | **hàng máy** | đáy panel | tràn |
|---|---|---|---|---|---|---|---|
| @1600 TRƯỚC | 349 | 258 | 5 | 249 | **8** | 876/900 | không |
| @1600 **SAU** | **328** | **237** | **5** (không mất hàng nào) | **271** | **9** ✔ | 876/900 | không |
| @1280 TRƯỚC | 244 | 153 | 3 | 174 | 5 | 696/720 | không |
| @1280 **SAU** | 244 | **153** | **3** | **174** | **5** | 696/720 | không |

**@1280 đổi 0 px** — trần chỉ bắt đầu chạm khi `7D/12 > 328`, tức viewport cao > 864 px.
**Ablation 2 chiều**: `dist-A` (chưa có trần) 8 hàng ↔ `dist-AC` (có trần) 9 hàng; @1280 y hệt ở cả hai.
**Ảnh tự đọc**: `C-sau/1600x900.png` — danh sách hiện `ESP32-ENV-01 … SIM-L1-CONVEYOR` = 9 hàng,
dải cảnh báo vẫn 5 mục tồn đọng. `C-truoc/1600x900.png` — dừng ở `SIM-L1-AVI`.

Lưới: `boCucPanelTrai.unit.test.ts` 9 ca — chỗ nối (class trên đúng thẻ `flex-[7]`, `basis-0` còn
nguyên, **cấm** `2xl:flex-[` / `2xl:max-h-`) + số học (1600/1280/864/880) + ca đối chứng **1600×720**.

---

## 5. MỤC D — `--workers=1` thành mặc định tái lập được (G147)

Bất biến, **không danh sách**: *"spec nào lái một canvas WebGL"* — đọc thẳng nội dung spec lúc nạp
config. Spec 3D MỚI vào `e2e/` tự động rơi đúng ngăn.

| project | tập | ca / tệp | `workers` |
|---|---|---|---|
| `chromium` | `testIgnore` tập ấy | 30 / 13 | mặc định (song song) |
| `chromium-canh-3d` | `testMatch` tập ấy | 121 / 17 | **1** |
| | | **151 / 30** = y hệt trước | |

**Đo, ba chiều, cùng bản dựng `dist-AC` + server 3059:**

| lệnh | worker | kết quả |
|---|---|---|
| `npx playwright test e2e/twin-dot47-bam-canh.spec.ts` (**0 cờ**) | `Running 16 tests using 1 worker` | **16/16 XANH**, exit 0 |
| cùng lệnh `--workers=12` | `…using 1 worker` — **trần project KHÔNG dỡ được** | **16/16 XANH** |
| cấu hình NỀN (1 project, 0 trần — `.qa-dot59/pw-nen.config.ts`) | `…using 12 workers` | **4 ĐỎ OAN / 16**, exit 1 |

★ Tôi viết docblock đầu tiên rằng *"`--workers=N` trên dòng lệnh vẫn ghi đè được"* — **đo lại thì SAI**:
`workers` toàn cục là kích thước DÀN, `workers` của project là TRẦN cho project ấy. Đã sửa docblock
theo số đo (3 tệp).
`npm run test:e2e:canh-3d` = `--project=chromium-canh-3d`. **0 assertion nào bị đổi.**
`twin-dot31-may` sau khi đổi: **4 pass · A5 đỏ (nợ từ Đợt 39) · 2 không chạy (serial)** — y nguyên
Đợt 58; `B1|B2` chạy riêng **2/2 XANH**; users 10→10.

---

## 6. Hồi quy

| Lưới | Đợt 59 | Đợt 58 | Phán |
|---|---|---|---|
| `vitest client/src/components/twin3d` | **108 tệp / 2 530 XANH** (exit 0) | 106 / 2 498 | **+2 tệp / +32 ca**, 0 đỏ |
| `vitest phamVi` | **17 tệp / 437 XANH** (exit 0) | 17 / 437 | = |
| `npm run check` | **exit 0 · 0 lỗi** | 0 | ĐẠT |
| `npm run check:tests` | **27 lỗi · 0 trong `twin3d` · 0 trong `e2e/`** (exit 2) | 27 · 0 · 0 | = (nợ nền, 8 tệp `server/` + 1 `client/ai`) |
| `npm run i18n:check` | **0 / 0 / 0** (exit 0) | 0 | ĐẠT |
| `npm run lint:tokens` | **1 111** (225 quét · 65 tệp · 847 · 264) | 1 111 | **Δ = 0** |
| `scripts/kiem-vo-app-https.mjs` | **ĐẠT 2/2** (exit 0) | ĐẠT | ĐẠT |
| e2e `twin-dot47-bam-canh` | **16/16** (`1 worker`, tự động) | 16/16 (`--workers=1` thủ công) | = |
| e2e `twin-dot31-may` | 4 pass · A5 đỏ · 2 không chạy (`1 worker`) · B1+B2 riêng **2/2** | như vậy | = |
| `--list` toàn bộ | **151 ca / 30 tệp** | 151 / 30 | = |
| Thị giác **26 ca × vi** | **0 vi phạm** (161 nhãn · 70 badge) | 24 ca, 0 vi phạm | **+2 ca**, 0 đỏ |
| Thị giác **26 ca × en** | **0 vi phạm** (159 nhãn · 70 badge) | 24 ca, 0 vi phạm | **+2 ca**, 0 đỏ |
| bbox 34 mục | **ĐẠT 34 · TRƯỢT 0** | 34/34 | = |
| Lệch lớp-vs-canvas | **10 lớp đo · 0 lớp lệch** | 10 · 0 | = |
| 40 s đứng yên × 3 màn | **twin 0 · line 0 · may 0 khung** | 0/0/0 | = (vá A **không** mua thêm khung idle) |
| D-1 `do32` (đóng băng) | ĐẠT 39 · SAI 2 · CHẶN-ĐÚNG 5 · N/A 1 · "xem #7" 1 — **0/48 ô đổi so với Đợt 57** | như cột 57 | = |
| D-1 `do59` (mới) | **48/48 có phán quyết · HỎNG 0 · 0 ô khác giữa hai bản dựng** | — | mới |

---

## 7. Brief SAI ở đâu (đếm) + lỗi của chính tôi

### 7.1 Brief Đợt 59 — **3 chỗ sai/thiếu**

1. **Mục A, gốc rễ đoán sai.** *"khuôn có sẵn: `TheoDoiLopPhu` + `ResizeObserver` trên `[data-che-nhan]`
   — nếu tay nắm/panel không nằm trong tập quan sát thì đó chính là lỗ"*. Tay nắm **ĐÃ** trong tập quan
   sát (nó có `data-che-nhan`, `quet()` observe nó từ khung đầu). Lỗ là **`ResizeObserver` mù với DỜI
   CHỖ** — một lớp lỗi khác hẳn. Nếu đi theo brief thì sẽ "thêm tay nắm vào tập quan sát" và đo lại
   vẫn 210 px².
2. **Mục A, phạm vi tái hiện.** Brief (theo QA lần 10) ghi *"@1600: 281 px²"* và ngầm hiểu 1280 không
   dính. Đo lại: @1600 **210 px² (vi) / 355 px² (en)**; và bệnh **CÓ** tái hiện ở **1280×720 tiếng Anh**
   (5 px²) — Đợt 58 chỉ đo tiếng Việt ở 1280. (281 px² là con số của phép **ablation** gỡ
   `data-che-nhan`, tôi tái lập đúng 281 px² ở đúng phép ấy.)
3. **Mục B, "đúng 3 ô thước cũ sai".** Đúng 3 ô theo nghĩa brief nói (#15/#16 SAI oan + #20 xanh giả),
   nhưng còn **ô #12 xanh trên một tập có thể RỖNG** (so 12 nhãn với **0** nhãn) và **ô #3 chưa bao giờ
   có phán quyết** (đếm `<a href>` — cơ chế chết sau QĐ-23). Nếu chỉ đi theo brief thì bỏ sót cả hai.

*(Các số khác của brief đều tái lập được: `danh-sach-may` 9→8 hàng @1600 · tồn đọng ≥3 @1280 ·
`.qa-dot47` 103 tệp 0 byte · `outputDir: ".qa-pw-output"` · 3001/3008/8080 đúng PID.)*

### 7.2 Lỗi của chính tôi — **5**

1. ★★★ **Ca thị giác mới KHÔNG BIẾT KÊU.** Bản đầu mở `/twin` ở chính sách nhãn mặc định (3–4 nhãn)
   ⇒ ca mới **XANH cả trên bản dựng chưa vá**. Bắt được vì tôi chạy ablation **trước** khi tin nó.
   Sửa sang `?thu=nhanTatCa` ⇒ ablation ra **1 vi phạm**. (Suýt giao một lưới rỗng nghĩa.)
2. ★★★ **Chạy `do-D1-59.sh` HAI LẦN song song** (hai orchestrator, hai trình duyệt WebGL, cùng thư mục
   ra, cùng hàng tạm DB). Bắt được bằng `Get-CimInstance … CommandLine`, giết cả hai, **đối chiếu DB
   về baseline rồi mới chạy lại một lần**. Đúng lớp lỗi G147 mà đợt này đang đi vá.
3. **Docblock mục D khai sai.** Tôi viết *"`--workers=N` trên dòng lệnh vẫn ghi đè được"* rồi mới đo:
   `--workers=12` **không** dỡ được trần của project. Đã sửa theo số đo, và thay bằng đối chứng thật
   (`pw-nen.config.ts` → 12 worker → 4 đỏ).
4. **Ô #12 của `do59` bản đầu quá ngặt sai chỗ**: tôi đòi "danh sách nhãn sau `?cam=` phải không rỗng"
   ⇒ HỎNG. Đúng ra phải hỏi *đại lượng cần đo là gì* — tư thế camera (`__tuTheCamera`), đọc được cả
   khi 0 nhãn. Sửa xong ô ấy ĐẠT trên cả hai bản dựng và **vẫn** fail-closed (nạp `null` ⇒ HỎNG).
5. **`git archive` trả CRLF** (G101 tái xuất): phải chuẩn hoá LF 6 592 tệp rồi mới dựng `dist-nen`;
   chuẩn hoá của tôi rộng hơn Đợt 58 (chạm cả `.webmanifest`) nên md5 danh sách lệch — chứng minh
   tương đương bằng cách trung hoà token băm tên tệp rồi so nội dung (5 chunk Twin giống từng byte).

---

## 8. Commit · tác dụng phụ · còn mở · cổng

### 8.1 Commit (pathspec theo mục)

| SHA | Mục | Tệp |
|---|---|---|
| `52b855a0` | **A** | `twin3d/loi/theoDoiDoiCho.ts` (mới) · `theoDoiDoiCho.dom.test.tsx` (mới) · `loi/KhungCanh.tsx` · `van-hanh/cheNhan.unit.test.ts` |
| `17a4448a` | **C** | `pages/TwinVanHanh.tsx` · `van-hanh/boCucPanelTrai.unit.test.ts` (mới) |
| `70cd30dc` | **D** | `playwright.config.ts` · `package.json` · `e2e/twin-dot47-bam-canh.spec.ts` · `e2e/twin-dot31-may.spec.ts` |
| (kế tiếp) | **B + bằng chứng** | `.qa-dot59/**` (`.gitignore` loại `src-nen/`, `dist-*/`, `state-*.json`, `*.pid`) |

### 8.2 Tác dụng phụ ghi vào cây mà TÔI gây (khai đủ)

1. `.qa-dot59/**` của chính tôi (57 MB sau `.gitignore`; `src-nen/` 1,3 GB + 4 `dist-*/` 288 MB **không** commit).
2. `.qa-pw-output/` — `outputDir` cấu hình sẵn (G140), đúng chỗ, **không** phải `test-results/`.
3. `.qa-dot37/andon-tam.id` — `db.mjs` ghim cứng đường ra; tôi thêm/ghi đè **1 tệp** trong thư mục
   không tracked của đợt cũ (Đợt 58 cũng vậy).
4. **KHÔNG** chạy `kb:*` (G138) ⇒ 169 tệp `knowledge/` trong `git status` là **của phiên trước**
   (mtime 13/09 03:00, trước khi tôi bắt đầu 15:10) — không đụng, không khôi phục.
5. `.qa-dot32/state-*.json` — do32 **dùng lại** cache có sẵn (mtime 10/09), không ghi mới; state của
   user tạm đã bị `trap` xoá.

### 8.3 CÒN MỞ (không chặn, nói thẳng)

- `client/src/components/twin3d/loi/theoDoiDoiCho.ts:41-71` — `THUOC_TINH_HINH_HOC` là **allowlist**;
  nếu ai đó cho tay nắm chạy `transition-[inset-inline-start]` trên một trình duyệt viết tắt
  `propertyName` khác, ca mới sẽ im lặng. Lưới ⑦ của `cheNhan.unit.test.ts` cưỡng chế hai trị đang
  dùng (`left`/`right`), **không** cưỡng chế được tương lai.
- `client/src/pages/TwinVanHanh.tsx:3026` — trần `328 px` là số suy từ hằng đo được; nếu cỡ chữ/mật độ
  đổi thì 91/41/24/44/24 đổi theo. Lưới `boCucPanelTrai.unit.test.ts` giữ **số học**, `.qa-dot59/C-do.mjs`
  giữ **kết cục**; chưa có cái nào tự phát hiện hằng trôi.
- `e2e/twin-dot31-may.spec.ts:~A5` — **ĐỎ từ Đợt 39** (spec ghim `toBe(2)` canvas, thực 1) và vì
  `describe.configure({ mode: "serial" })` nó **chặn** B1/B2. Nên tách A5 ra khỏi khối serial.
- `client/src/components/twin3d/van-hanh/NganXuLy.tsx` — `hienDoTuoi` mặc định `true` **0 chỗ gọi sống**
  (chỗ render duy nhất `TwinMay.tsx:892` truyền `false`) — mã chết, Đợt 58 đã ghi.
- 24 chuỗi ≤12 px bị `lop-phu-dong-thoi-gian` che kín + 48 chuỗi cuộn khuất (nợ có trước Đợt 57).
- `"offline"` 11 px trong `cockpit-live-status` (màn CŨ) ở **biên** 4,5 (pixel 4,31 / màu 4,58).
- **KHÔNG chạy trong đợt này** (khai rõ, không suy đoán kết quả): `D-2`/`D-4` · `npm test` toàn bộ ·
  `test:e2e` toàn bộ 30 spec · `kb:*` (G138) · `ext:*` · `i18n:audit` · `kb:stale-check` · production QĐ-30.

### 8.4 Cổng đóng phiên

`3059` **ĐÃ ĐÓNG** (17:56:36). `3001 = 23980` · `3008 = 32584` · `8080 = 5192` — **0 lần chạm**;
`dist/` **không dựng lại, không ghi**.

⚠ **Cổng 3000 BẬT LẠI trong lúc tôi đo — KHÔNG phải tôi.** Đầu đợt 3000 tắt; cuối đợt
`3000 = PID 39904`, tiến trình `node dist/index.js`, **CreationDate 16:10:08** (lúc ấy tôi đang chờ
`do59` chạy trên 3059). Mọi tiến trình server của tôi đều là `PORT=3059 node .qa-dot59/dist-*/index.js`
(PID 8964 · 41452 · 25904 · 39552 · 12056 · 27232 — đã đóng hết), và tôi chưa từng gọi `npm run build`,
`npm start`, hay chạm `dist/`. Ghi lại để chủ dự án biết trạng thái cổng đã đổi so với QĐ-28.
