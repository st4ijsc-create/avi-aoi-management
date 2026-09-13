# ĐỢT 58 — QA ĐỘC LẬP LẦN 10: bốn mục thiết kế 10–13 (QĐ-29) + phân xử 2 SAI của D-1

Worktree `D:/SOURCES/_twin_wt`, nhánh `feat/twin-3d-trung-tam`, HEAD `a3032508`.
Thiết bị đo của đợt này là **của đợt này**: `.qa-dot58/do58.mjs`, `m10-bam.mjs`, `m10-ablation2.mjs`,
`bat-bien-may.mjs` — KHÔNG dùng lại `.qa-dot57/do57.mjs` (BG-127: độc lập phải ở MÔ HÌNH).
`.qa-dot44/do32.mjs` (thước D-1 đóng băng từ Đợt 32) được chạy **nguyên trạng, không sửa một dòng**.

---

## 1. Cây + hệ đo (MSA)

| Mục | Trước | Sau |
|---|---|---|
| HEAD | `a3032508` (kỳ vọng `a3032508`) ⇒ KHỚP | `a3032508` (chưa commit gì ngoài `.qa-dot58/`) |
| Cổng của tôi | 3058 (trống) | 3058 (đóng cuối đợt) |
| Cổng CẤM | 3000 tắt · 3001 PID 23980 · 3008 PID 32584 · 8080 PID 5192 | **y nguyên, 0 lần chạm** |
| DB 11 khoá | `factories 2 · twin_dat_cho 82 · stations 37 · machines 42 · users 10 · andon 7 · raised 0 · hb 108 · msl 7814 · permissions 104 · ufa 3` | (mục 7) |
| 5 ảnh `test-results/` | 5 md5 | (mục 7) |
| `playwright.config.ts` | `outputDir: ".qa-pw-output"` (G140), git sạch | không đụng |

### 1.1 Bản dựng — G141 ("bản dựng có đúng commit đang đo không")

Hai bản dựng, mỗi bản dựng **hai lần** để kiểm lặp lại (G120), outDir TUYỆT ĐỐI ngoài `client/`:

| Bản | Nguồn | Bundle | md5 lặp lại |
|---|---|---|---|
| `dist-head1` / `head2` | worktree tại `a3032508` | `index-CZsT1Xbd.js` | **914 tệp, md5 danh sách KHỚP tuyệt đối** |
| `dist-nen1..3` | `git archive 2f835df1` (+ chuẩn hoá LF) | `index-hIeKtQvc.js` | **914 tệp, KHỚP tuyệt đối** |

★ **Đối chứng chéo với Đợt 57:** `dist-head1` **giống TỪNG BYTE** `.qa-dot57/dist-e`
(`diff` md5 hai danh sách = **0 dòng khác**) ⇒ bản dựng Đợt 57 đo trên là bản dựng của HEAD, và
đường ống dựng của tôi tái lập được của họ. `dist-nen3` so với `.qa-dot57/dist-a`: **909/914 tệp
giống hệt**, 5 tệp lệch là `sw.js · default-machine-2d.svg · aoi-upload-test-client.html ·
index.html · index.cjs` — **chỉ khác KẾT THÚC DÒNG** (worktree giữ CRLF cho 5 tệp này, `git archive`
trả LF; `git diff 2f835df1..HEAD` trên chúng **rỗng**). Đây là G101 tái xuất ở một chỗ mới.

★ **Ký hiệu trong bundle** (chứng minh bằng nội dung, không bằng dấu thời gian):

| Ký hiệu | `dist-head1` | `dist-nen3` |
|---|---|---|
| `vien-tin-cay-may` (Đợt 57 mục 12) | **có** | không |
| `do-tuoi-may` trên cảnh | **có** | không |
| `trang-thai-may` (chip cũ) | không | **có** |
| `flex-[7]` (mục 13 bước 2) | **có** | không |
| `nut-thu-trai` + `data-che-nhan="1"` + `left-56 2xl:left-72` | **có** | không (`nut-thu-trai` không có thuộc tính nào) |
| `hopManHinh` (Đợt 53) | có | có |

⚠ **Brief sai:** brief bảo grep `mauChuTrenNen` để nhận bản dựng — chuỗi ấy là **tên module**, bị
minify xoá: **0 tệp ở CẢ HAI** bản dựng. Ký hiệu dùng được là 5 dòng còn lại của bảng trên.

### 1.2 Lớp đệm / tự thoả

- Mỗi lần đổi bản dựng đều **khởi động lại tiến trình server** (đường đọc là trình duyệt mới,
  context mới, không dùng lại cache trang).
- M11 đọc **pixel đã vẽ** (ảnh chụp), không đọc lại CSS mình vừa đặt ⇒ không tự thoả.
- M10 phần "nút còn bấm được" đo bằng **kết cục** (bề rộng panel đổi 224→0→224 px), không đo
  `elementFromPoint`.

---

(các mục 2–8 ở dưới)

---

## 2. Bốn mục thiết kế 10–13 — ĐO LẠI TỪ ĐẦU, hai bản dựng

Ma trận: **5 màn** (`/twin`, `/twin/line/2`, `/twin/may/14`, `/twin/may/18`, `/twin-studio`)
× **2 vp** (1600×900, 1280×720) × **vi/en**. Tệp thô: `.qa-dot58/do-head-{vi,en}/tong.json` ·
`.qa-dot58/do-nen-{vi,en}/tong.json` (mỗi màn kèm ảnh PNG).

| Mục | Tiêu chí | **NỀN `2f835df1`** (đo lại bằng thước của tôi) | **HEAD `a3032508`** | Phán |
|---|---|---|---|---|
| **10** tay nắm đè nội dung | giao = 0 px² | @1280 **167 px²** (▲166 + ▲2) · @1600 **149 px²** (◆95 + ●54) · **tổng 632 px²/4 ca** | **0 px² / 0 phần tử, cả 4 ca** (cả trong panel lẫn TOÀN TRANG) | **ĐẠT** |
| 10b hệ quả: nhãn 3D bị nút che | 0 | 0 (nút nằm TRÊN panel, không chạm cảnh) | **0** ở trạng thái mặc định và `?thu=nhanTatCa` | ĐẠT (kèm 1 phát hiện mới, §2.1) |
| 10c nút còn bấm được | panel thu/mở thật | 224→0→224 px @1280 · 288→0→288 @1600 | **224→0→224 · 288→0→288** | ĐẠT |
| **11** chữ ≤12 px đạt AA | 0 chuỗi dưới ngưỡng | **106 chuỗi dưới ngưỡng** / 1 324 đo được · thấp nhất **2,15** | **0 chuỗi** / 1 334 đo được · thấp nhất **4,58** | **ĐẠT** |
| **12** lặp mã máy màn Máy | ≤3 (máy 14) / ≤4 (máy 18) | máy 14 **3**, máy 18 **4** (trong khối cảnh 2 / 3) | máy 14 **2**, máy 18 **3** (trong khối cảnh **1** / **2**) | **ĐẠT** |
| 12b vị trí viên tin cậy | lệch ≤ 8 px so với `/twin` | không có `vien-tin-cay-may` | **lệch 0 px** (cả hai màn cách mép phải 8 px, mép trên 8 px), 8/8 ca | ĐẠT |
| 12c không mất dữ kiện | 5 dữ kiện còn tìm thấy | chip đáy cảnh: mã·loại·trạng thái·sức khoẻ (tuổi ở ngăn phải) | **mã** (nhãn 3D + `ngan-ma-may` + cockpit) · **trạng thái** (nhãn 3D "· Không rõ" + `ngan-trang-thai`) · **loại**+**sức khoẻ**+**tuổi** (viên trên cảnh) | ĐẠT |
| **13** tồn đọng @1280 | ≥3 hàng đủ | **1,51 hàng (1 đủ)** · ô cuộn 86 px | **3,12 hàng (3 ĐỦ)** · ô cuộn 153 px | **ĐẠT** |
| 13b @1600 không xấu đi | ≥ nền | 3,68 hàng (3 đủ) · 176 px | **5,67 hàng (5 đủ)** · 258 px | ĐẠT |
| 13c không tràn | đáy ≤ vp | đáy 696/720 · 876/900 · tràn ngang false | **đáy 696/720 · 876/900 · tràn ngang false** | ĐẠT |
| 13d đánh đổi `danh-sach-may` | không mất hàng | @1280 **177 px, 5 hàng đủ** · @1600 **267 px, 9 hàng đủ** | @1280 **174 px, 5 hàng đủ** · @1600 **249 px, 8 hàng đủ** | **MẤT 1 HÀNG @1600** (xem §2.3) |

Bốn số nền của brief đều **tái lập được bằng thước ĐỘC LẬP**: 167 px² · 104→(tôi đo 106) · 4/5 lần
mã máy (theo phạm vi của Đợt 57) · 1,51 hàng. G139 thoả: **mọi "0" của HEAD đều có số khác 0 trên nền**.

### 2.1 M10 — ABLATION (chạy lúc thực thi, KHÔNG sửa mã) + một phát hiện MỚI

`LopNhan` đọc vùng cấm `[data-che-nhan]` **trong `useFrame`**, nên gỡ thuộc tính trên DOM sống là
một phép ablation hợp lệ. Để lớp nhãn TÍNH LẠI, phải ép một chu kỳ đổi kích thước cửa sổ
(1600→1500→1600); đo ở **cùng** cỡ 1600×900, `/twin?thu=nhanTatCa` (`.qa-dot58/m10-ablation2.mjs`):

| | còn `data-che-nhan` | **GỠ** | gắn lại |
|---|---|---|---|
| nhãn 3D bị nút trái che | **0 / 0 px²** | **2 nhãn / 281 px²** (`SIM-L3-CONVEYOR` 152 + `SIM-L3-ICT` 129) | **0 / 0 px²** |

⇒ Bản vá `data-che-nhan` của Đợt 57 **có nhân quả đo được**: gỡ ra thì ĐỎ, gắn lại thì XANH.

★★★ **PHÁT HIỆN MỚI (Đợt 58), chưa ai đo:** ở **1600×900**, sau khi **thu rồi mở lại panel trái**,
hai nhãn ấy **quay lại nằm dưới nút** (`2 nhãn / 281 px²`) và **ở lì**: rê chuột trên cảnh (ép vẽ
khung) không dọn được; chỉ một lần đổi kích thước cửa sổ mới dọn. Ở 1280×720 không tái hiện.
Tệp thô `.qa-dot58/m10ab-head/kq.json` (6 mốc), ảnh `1600x900-3-mo-lai.png` / `-4-da-hich.png`.
Nghĩa: vùng cấm được đọc lại, nhưng **kết quả LỌC nhãn không được tính lại khi panel đổi bề rộng** —
đúng lớp lỗi Đợt 35/G142, ở một trạng thái mà **lưới thị giác 24 trạng thái không đi qua**
(lưới chỉ đo trạng thái panel MỞ). Mức độ: chữ mã máy vẫn đọc được, phần bị che là góc trái hộp nhãn.

### 2.2 M11 — 80 chuỗi Đợt 57 bỏ qua: đo được hay không đo được?

Mô hình của tôi khác Đợt 57 ở chỗ **đo trên vùng CÒN THẤY** (sau khi trừ phần bị ô cuộn cắt và phần
bị lớp phủ che), nên nhiều chuỗi Đợt 57 loại vẫn đo được. Phân loại 1 408 chuỗi trên HEAD:

| Nhóm | Số | Đây là ca gì |
|---|---|---|
| **khuất hẳn** (0 pixel được vẽ — cuộn ra ngoài ô) | **48** | **KHÔNG đo được, và đúng là không phải ca tương phản**: người dùng không nhìn thấy chúng |
| **bị `lop-phu-dong-thoi-gian` che kín** | **24** | KHÔNG phải ca tương phản, mà là **ca CHE** — món nợ riêng (Đợt 57 cũng ghi) |
| bị cắt một phần nhưng còn thấy | **8** | **ĐO ĐƯỢC** — Đợt 57 vứt, tôi đo: **8/8 ĐẠT** |
| bình thường | 1 328 | = đúng cỡ mẫu Đợt 57 công bố (1 328) |

⇒ 80 chuỗi Đợt 57 bỏ = **72 ca thật sự không nhìn thấy được** (48 khuất + 24 bị che kín) **+ 8 ca
đo được mà họ thận trọng loại** — và 8 ca ấy **đều ĐẠT**. Kết luận "0 chuỗi dưới ngưỡng" **không
sống nhờ việc loại mẫu**.

Hai mô hình cho mỗi chuỗi (pixel lõi nét · màu quy định hợp nhất alpha trên nền đo được):
**0 chuỗi dưới ngưỡng theo luật rộng lượng** (max hai mô hình, = luật Đợt 57), **8 chuỗi** chỉ dưới
ngưỡng theo luật NGẶT (min hai mô hình), tất cả đều giải thích được:

- **4 ca** glyph `—` 10 px (`tuoi-244`): pixel 2,57 · màu 5,57 — **khử răng cưa** kéo lõi nét xuống,
  đúng hiện tượng Đợt 57 tự ghi (G-lỗi (c) của họ). Không phải lỗi sản phẩm.
- **4 ca** `"offline"` 11 px trong **`cockpit-live-status` (cockpit 2D nhúng = màn CŨ)**: pixel
  **4,31** · màu **4,58** — **ĐÚNG BIÊN 4,5**. Đây là chuỗi duy nhất mà kết luận "0" phụ thuộc vào
  việc chọn mô hình. Ghi vào sổ nợ, KHÔNG phải do Đợt 57 (màn cũ, brief cấm sửa).

### 2.3 M13 — đánh đổi có thật, nhưng KHÔNG như con số trong spec

Spec Đợt 57 ghi `danh-sach-may` **209 → 174 px**. Đo trên hai bản dựng THẬT: **@1280 177 → 174 px**
(−3 px, **5 → 5 hàng đủ**); **@1600 267 → 249 px** (−18 px, **9 → 8 hàng đủ**). Nghĩa là:
① con số 209 của spec là trạng thái **trung gian** (sau bước 1 của chính họ), không phải nền;
② chỗ MẤT một hàng là **@1600**, không phải @1280 — và spec không nói. Danh sách 42 máy luôn phải
cuộn nên mất 1 hàng ở 1600 là đổi được, nhưng phải ghi ĐÚNG.

---

## 3. PHÂN XỬ 2 SAI của D-1 cột 57 — kết luận **(a) NỢ THIẾT BỊ ĐO**, và nợ ấy **rộng hơn 2 ô**

### 3.1 Chạy D-1 trên CẢ HAI bản dựng, thước ĐÓNG BĂNG, đối chiếu từng ca

`.qa-dot44/do32.mjs` **không sửa một dòng**; chỉ bản sao bảng (`.qa-dot58/tomtat58.mjs`) đổi **nguồn
đọc** của hai cột cuối — 44/44 luật `add(...)` giống hệt `.qa-dot44/tomtat-D1.mjs` (`diff` chỉ khác
3 dòng hằng đường dẫn + 2 dòng chú thích).

| Lượt | ĐẠT | SAI | CHẶN-ĐÚNG | N/A | "xem #7" |
|---|---|---|---|---|---|
| `.qa-dot57` cột 57 (lời khai Đợt 57) | 39 | **2** | 5 | 1 | 1 |
| **Đợt 58 trên `dist-head1`** | **39** | **2** | 5 | 1 | 1 |
| **Đợt 58 trên `dist-nen3` (`2f835df1`)** | **41** | **0** | 5 | 1 | 1 |

- So với lượt chạy của Đợt 57: **0/48 ô khác** ⇒ lời khai cột 57 **tái lập được**.
- So giữa hai bản dựng: **đúng 2/48 ô khác — #15 và #16**, 46 ô còn lại y hệt ⇒ nguyên nhân nằm gọn
  trong thay đổi Đợt 57, không có hồi quy nào khác lẻn vào.
- Tệp thô: `.qa-dot58/D1-bang-head.txt` · `D1-bang-nen.txt` · `d1head-*/` · `d1nen-*/`.

### 3.2 Đo BẤT BIẾN GỐC bằng đường ĐỘC LẬP VỚI testid (chỉ đọc chữ người dùng thấy)

`.qa-dot58/bat-bien-may.mjs` gom chữ theo **vùng hình học** (thanh trên · khối cảnh · ngăn phải ·
cockpit), không đọc `data-gia-tri`/`data-trang-thai`. Máy 14, HEAD, 1600×900:

| Nguồn | vi | en |
|---|---|---|
| nhãn 3D trên cảnh | `SIM-L2-AOI · Không rõ` | `SIM-L2-AOI · Unknown` |
| viên tin cậy trên cảnh | `AOI · Sức khoẻ 61 % · cảnh báo · Cập nhật 58 ngày trước` | `… Updated 58 days ago` |
| ngăn phải | `Không rõ` + `Dữ liệu quá cũ — trạng thái không đáng tin` | `Unknown` + `Data too old — status not trustworthy` |
| cockpit 2D | `NGOẠI TUYẾN` / `Mất kết nối` | `OFFLINE` / `Disconnected` |
| hàng máy trên `/twin` | `SIM-L2-AOI Không rõ 58 ngày` | `SIM-L2-AOI Unknown 58 days` |
| **DB (SQL thô)** | `operationStatus=stopped`, `hb mới nhất 2026-07-17T01:26:09Z` = **58 ngày** | |

⇒ **Bất biến #15 ("twin và cockpit nói MỘT điều") và #16 ("tuổi ↔ Disconnected") VẪN ĐÚNG** trên
HEAD, đo bằng chữ hiển thị và đối chiếu DB. Cái hỏng là **chỗ đọc của thước**, không phải sản phẩm.

### 3.3 ★★★ Nợ thiết bị đo KHÔNG phải 2 ô mà là **3 ô — và ô thứ ba ĐANG XANH GIẢ**

Ô **#20** ("chuỗi thời gian tuổi ở 4 s — không 'Never reported' giả") đọc **cùng** `ngan-do-tuoi`.
Tệp thô `a4b-may-14-thoi-gian.json`, 5 mốc:

| | mốc 1–5 `doTuoi` | phán quyết |
|---|---|---|
| nền `2f835df1` | `"Updated 58 days ago"` ×5 | ĐẠT (đo thật) |
| HEAD | **`null` ×5** | **ĐẠT — nhưng VÔ HIỆU**: luật là `every(m => !/Never/.test(m.doTuoi ?? ""))`, chuỗi rỗng không chứa "Never" ⇒ **xanh vì KHÔNG CÓ GÌ ĐỂ ĐO** |

Hai ô kêu ĐỎ thì người ta nhìn thấy; ô này **im lặng** — và nó là ô nguy hiểm hơn.

### 3.4 Phán quyết và cách vá thước (KHÔNG tự sửa `do32.mjs`)

**(a) NỢ THIẾT BỊ ĐO.** Đề nghị cho người dựng cột 58+: **giữ nguyên `do32.mjs`** (nó là mốc so của
5 cột trước) và thêm một thước MỚI đọc **theo NGHĨA, không theo testid**:

1. `trang thái máy` = chuỗi hiển thị lấy từ **nhãn 3D** (phần sau dấu `·`) **hoặc** `ngan-trang-thai`
   — bất biến: hai chỗ ấy và `ONLINE/OFFLINE` của cockpit phải cùng nghĩa.
2. `tuổi dữ liệu` = chuỗi "Cập nhật … trước"/"Updated … ago" ở **bất kỳ đâu trên màn** (viên tin cậy
   HOẶC ngăn) — bất biến: có mặt, và khớp `Connected/Disconnected`.
3. Luật #20 phải **thất bại khi không đọc được gì** (`doTuoi == null ⇒ HỎNG`), chứ không im lặng.

---

## 4. Hồi quy + BẢNG MỌI CỔNG TRONG `package.json` (G108)

### 4.1 Kết quả (server 3058 = `dist-head1`; 3001/3008 không bị đụng)

| Lưới | Đợt 58 | nền Đợt 57 khai | phán |
|---|---|---|---|
| `vitest client/src/components/twin3d` | **106 tệp / 2 498 XANH** | 106 / 2 498 | = |
| `vitest phamVi` (4 lưới phạm vi + census) | **17 tệp / 437 XANH** | 17 / 437 | = |
| `npm run check` | **exit 0 · 0 lỗi** (đo lại có mã thoát THẬT) | 0 | ĐẠT |
| `npm run check:tests` | **exit 1 · 27 lỗi · 0 trong `twin3d` · 0 trong `e2e/`** | 27 · 0 · 0 | = (nợ nền) |
| `npm run i18n:check` | **0 / 0 / 0** (339+20 nợ đóng băng) | 0 | ĐẠT |
| `npm run lint:tokens` | **tổng 1 111** (65 tệp · 847 · 264), report-only exit 0 | 1 111 | **Δ = 0** |
| `scripts/kiem-vo-app-https.mjs` | **ĐẠT 2/2 tệp** | ĐẠT | ĐẠT |
| e2e `twin-dot47-bam-canh` | **16/16 PASS** (`--workers=1`) | 16/16 | = |
| e2e `twin-dot31-may` | **4 PASS · A5 ĐỎ · 2 KHÔNG CHẠY** (describe `serial` ⇒ A5 đỏ chặn B1/B2) | khai "6/7" | xem §4.3 |
| e2e `twin-dot31-may` B1+B2 chạy RIÊNG | **2/2 PASS** | **chưa ai chạy** | mới |
| 24 trạng thái thị giác × vi | **0 vi phạm** (12 trạng thái × 2 vp = 24 tệp + `tong.json`; nhãn 127 · badge 56) | 0 | = |
| 24 trạng thái thị giác × en | **0 vi phạm** (nhãn 126 · badge 56) | 0 | = |
| bbox 34 mục | **ĐẠT 34 · TRƯỢT 0** | 34/34 | = |
| lệch lớp-vs-canvas | **10 lớp đo · 0 lớp lệch (0,0,0,0))** | 8/8 | = |
| 40 s đứng yên × 3 màn | **twin 0 · line 0 · may 0 khung** | ≤2 | ĐẠT |
| F1 fonts (deep-link 4 màn, mạng thường) | **ĐẠT 4/4 · 0 request ngoài · Geist+Mono true · màn ≤ 1 243 ms** | — | ĐẠT |
| D-1 48 ca | **ĐẠT 39 · SAI 2 · CHẶN-ĐÚNG 5 · N/A 1 · "xem #7" 1** (= cột 57) | như cột 57 | §3 |
| D-2 (K/E/I/P, mạng chặn) | §4.4 | Đợt 57 KHÔNG chạy | — |

### 4.2 ★★★ Lỗi ĐO CỦA TÔI, bắt được bằng đối chứng: 7/16 ĐỎ OAN vì **12 worker**

Lượt đầu tôi chạy `npx playwright test … --reporter=line` **không đặt `--workers`** ⇒ Playwright lấy
**12 worker**; 12 trình duyệt WebGL cùng lúc ⇒ `waitForSelector` 90 s hết giờ, `soNhan=0`,
`soKhoi=0` ⇒ **7/16 ĐỎ**. Log Đợt 57 ghi rõ *"Running 16 tests using 1 worker"*; đặt `--workers=1`
⇒ **16/16 XANH** (2,4 phút). Tệp thô: `.qa-dot58/HQ-bamcanh.log` (12 worker, 7 đỏ) vs
`.qa-dot58/HQ-e2e-w1.log` (1 worker, 20/23 pass). **Đây đúng lớp lỗi "cửa sổ cố định dưới tải song
song" đã ghi ở Đợt 30 — và nó cắn tôi.**

### 4.3 `twin-dot31-may` — lời khai "6/7" của Đợt 57 KHÔNG khớp tệp thô của chính họ

Spec có `test.describe.configure({ mode: "serial" })` ⇒ A5 đỏ **chặn** B1/B2. Log thô của Đợt 57
(`.qa-dot57/HQ-e2e-may.log`) ghi **"1 failed · 2 did not run · 4 passed"** — tức **6/7 là sai**, và
**hai ca quyền B1/B2 chưa từng được đo ở Đợt 57**. Tôi chạy riêng `-g "B1|B2"` ⇒ **2/2 XANH**
(user tạm tạo→xoá, users 10→10).

**A5 đúng là NỢ CÓ SẴN, chứng minh bằng bản dựng nền:** ô D-1 #18 (cùng phép đo "tab 3D cockpit ⇒
số canvas DOM") cho `dom 1 / kit 1` trên **cả `dist-nen3` lẫn `dist-head1`**, trong khi spec ghim
`toBe(2)`; bảng D-1 cho thấy con số đổi 2→1 từ **Đợt 39**, tức trước Đợt 57 **18 đợt**.

### 4.5 BẢNG MỌI CỔNG TRONG `package.json` (57 script; 6 chạy, 51 không — nói rõ lý do)

Ngoài `package.json` còn các thước QA rời đã chạy: `scripts/kiem-vo-app-https.mjs` · `.qa-dot44/do32.mjs` (D-1)
· `.qa-dot44/do33/35/36/38.mjs` (D-2) · `.qa-dot44/f1-fonts.mjs` · `.qa-dot57/thigiac57.mjs` · `.qa-dot57/bbox57.mjs`
· `.qa-dot58/{do58,m10-bam,m10-ablation2,bat-bien-may,lech-lop-va-idle}.mjs`.

| script | chạy? | kết quả / lý do |
|---|---|---|
| `dev` | không | server dev — chiếm cổng |
| `dev:worker` | không | tiến trình nền |
| `dev:edge` | không | tiến trình nền |
| `build` | không | GHI dist/ — dist/ là của phiên khác (3001/3008) |
| `build:secure` | không | GHI dist/ |
| `start` | không | chạy dist/ của phiên khác |
| `start:worker` | không | nt |
| `start:edge` | không | nt |
| `check` | **CÓ** | exit 0 · 0 lỗi |
| `check:tests` | **CÓ** | exit 1 · 27 lỗi NỀN (0 twin3d, 0 e2e) |
| `format` | không | prettier --write . — GHI ĐÈ TOÀN CÂY |
| `lint:tokens` | **CÓ** | tổng 1 111 · Δ=0 (report-only) |
| `test` | **CÓ** | CHẠY THEO PHẠM VI: twin3d 106/2498 + phamVi 17/437 |
| `test:db:setup` | không | GHI DB test |
| `vision:validate` | không | cần model thị giác |
| `i18n:audit` | không | báo cáo trùng i18n:check (đã chạy bản check) |
| `i18n:check` | **CÓ** | 0/0/0 ĐẠT |
| `test:e2e` | **CÓ** | CHẠY THEO SPEC: dot47 16/16 · dot31 4+A5 đỏ+2 không chạy · B1/B2 2/2 |
| `test:e2e:install` | không | tải trình duyệt |
| `db:push` | không | MIGRATION — tuyệt đối không |
| `db:generate` | không | sinh tệp drizzle vào cây |
| `monitor:ai-analytics` | không | cần dịch vụ đang chạy |
| `monitor:ai-analytics:summary` | không | nt |
| `kb:extract` | không | GHI knowledge/ (tracked) |
| `kb:operational-cards` | không | GHI knowledge/ |
| `kb:operational-cards:test` | không | ★ G138 — GHI ĐÈ 169 tệp tracked dưới knowledge/ ⇒ KHÔNG CHẠY |
| `kb:chunk` | không | GHI knowledge/ |
| `kb:embed` | không | GHI + cần GPU |
| `kb:embed:inc` | không | nt |
| `kb:sync` | không | GHI knowledge/ |
| `kb:graph` | không | GHI knowledge/ |
| `kb:phase1` | không | GHI knowledge/ |
| `kb:test` | không | cần API AI đang chạy |
| `kb:eval` | không | cần model |
| `ai:eval:toolcall` | không | cần model |
| `ai:eval:rag` | không | cần model |
| `ai:eval:rag:rerank` | không | cần model |
| `kb:stale-check` | không | đọc — bỏ vì không thuộc phạm vi twin (khai rõ) |
| `eval:specialist` | không | cần model |
| `hooks:install` | không | GHI .git/hooks |
| `ai:backfill` | không | GHI DB |
| `sim:factory` | không | GHI DB |
| `sim:production` | không | GHI DB |
| `sim:scenario` | không | GHI DB |
| `sim:esop` | không | GHI DB |
| `sim:live` | không | GHI DB liên tục |
| `bench:ingest` | không | GHI DB |
| `lake:verify` | không | cần lake |
| `storybook` | không | máy chủ UI |
| `build-storybook` | không | GHI build |
| `ai:bench` | không | cần model |
| `ai:cli` | không | tương tác |
| `ai:mcp` | không | tiến trình nền |
| `ext:check` | không | tsc cho vscode-extension — ngoài phạm vi twin (khai rõ) |
| `ext:build` | không | GHI build |
| `ext:package` | không | GHI .vsix |
| `ext:test-that` | không | bộ test extension — ngoài phạm vi |

**Tác dụng phụ ghi vào cây mà TÔI đã gây (khai đủ):** ① `.qa-pw-output/` (outputDir cấu hình sẵn,
G140 — đúng chỗ, không phải `test-results/`); ② `.qa-dot44/mang-ngoai/25888.json` — `f1-fonts.mjs`
ghim đường ra `.qa-dot44`, tôi thêm **1 tệp** vào thư mục KHÔNG tracked của đợt cũ (không xoá gì);
③ `.qa-dot58/**` của chính tôi. **KHÔNG chạy `kb:operational-cards:test`** ⇒ 169 tệp `knowledge/`
trong `git status` là **của phiên trước, tôi không đụng và không khôi phục** (đúng lệnh G138).

---

## 5. Pareto — cái còn SAI sau đợt này

| # | Vấn đề | Số ca đo được | Do Đợt 57? | Bằng chứng |
|---|---|---|---|---|
| 1 | **Chữ ≤12 px bị `lop-phu-dong-thoi-gian` che kín** trong `danh-sach-may` | **24 chuỗi** (12 mỗi ngôn ngữ) @1280+@1600 | KHÔNG (có trước; Đợt 57 cũng ghi) | `.qa-dot58/do-head-*/tong.json` — `phanChe = 1`, `cheBoi = lop-phu-dong-thoi-gian` |
| 2 | **48 chuỗi ≤12 px bị cuộn khuất** trong các ô cuộn | 48 | KHÔNG | như trên (`phanThay ≈ 0`) |
| 3 | ★ **Nhãn 3D chui xuống dưới tay nắm sau khi THU→MỞ panel** @1600 | 2 nhãn / 281 px², kéo dài ≥ 17 s, chỉ hết khi đổi cỡ cửa sổ | **CÓ** (hệ quả của mục 10, không ai đo trạng thái này) | `.qa-dot58/m10ab-head/kq.json` + ảnh |
| 4 | `"offline"` 11 px trong cockpit 2D ở **biên** 4,5 (pixel 4,31 / màu 4,58) | 4 ca | KHÔNG (màn cũ) | `do-head-*/tong.json` |
| 5 | `hienDoTuoi` mặc định `true` **không còn chỗ gọi sống** (chỗ render duy nhất truyền `false`) | 1 | CÓ (mục 12) | `grep -rn "<NganXuLy"` ⇒ chỉ `TwinMay.tsx:892` |
| 6 | `twin-dot31-may` A5 ĐỎ (spec ghim 2 canvas, thực 1) chặn luôn B1/B2 vì `serial` | 1 đỏ + 2 không chạy | KHÔNG (từ Đợt 39) | §4.3 |

Mục 3 và 5 là **phát sinh từ Đợt 57** nhưng **không phải hồi quy kết cục**: mục 3 chỉ che góc hộp
nhãn (chữ vẫn đọc được) ở một trạng thái sau tương tác; mục 5 là mã chết, không ảnh hưởng người dùng.

---

## 6. Brief của tôi SAI ở đâu (đếm) + lỗi của chính tôi

### 6.1 Brief Đợt 58 — **5 chỗ sai/thiếu**

1. **"grep ký hiệu mới: `vien-tin-cay-may`, `mauChuTrenNen`, `hopManHinh`"** — `mauChuTrenNen` là
   **tên module**, minify xoá sạch: **0 tệp ở CẢ HAI bản dựng**. Dùng nó làm dấu nhận bản dựng thì
   **luôn sai**. Ký hiệu dùng được: `vien-tin-cay-may` · `do-tuoi-may` · `trang-thai-may` (dấu ÂM) ·
   `flex-[7]` · cụm `nut-thu-trai…data-che-nhan`.
2. **"đánh đổi `danh-sach-may` 209→174 px"** — trên bản dựng NỀN THẬT là **177 px @1280** (209 là
   trạng thái TRUNG GIAN của chính Đợt 57). Và chỗ **mất một hàng là @1600** (267→249 px, 9→8 hàng),
   không phải @1280 (5→5). Brief hỏi sai chỗ.
3. **"2 SAI trong D-1 cột 57"** — đúng là 2 ô ĐỎ, nhưng **ba ô** bị cùng một thay đổi làm mù; ô thứ
   ba (**#20**) **vẫn XANH mà không đo gì** (§3.3). Nếu chỉ đi theo brief thì bỏ sót ô nguy hiểm nhất.
4. **"e2e bấm cảnh 16/16"** — tiêu chí này **không tái lập được nếu không ghi `--workers=1`**: cùng
   bản dựng, 12 worker cho **9/16** (7 đỏ oan). Cổng phải nói ra số worker.
5. **"xác nhận A5 là nợ có sẵn bằng `git archive` một mốc trước"** — `git archive` chỉ cho thấy
   **văn bản spec**, không cho thấy **số canvas**. Bằng chứng đúng là chạy phép đo ấy trên **bản
   dựng nền** (tôi làm: D-1 #18 `dom 1 / kit 1` trên cả hai bản dựng; bảng D-1 cho thấy 2→1 từ **Đợt 39**).

*(Ngoài ra: brief nói "24 ca thị giác" — đúng, 12 trạng thái × 2 vp; và "nền 167 px² @1280", "nền
1,51 hàng", "nền 104 chuỗi" đều **tái lập được** — tôi đo 167 px², 1,51 hàng, 106 chuỗi.)*

### 6.2 Lỗi CỦA TÔI — **4**

1. **Chạy 16 ca e2e với 12 worker** ⇒ 7 ĐỎ OAN, suýt báo hồi quy nặng. Đã đo lại `--workers=1`
   (16/16) và giữ **cả hai** log để người sau đối chiếu. (Chính lớp lỗi mà Đợt 30 đã đặt tên.)
2. **`git archive` trả CRLF** nên bản dựng nền đầu tiên lệch 956/914 dòng md5 so với Đợt 57; phải
   chuẩn hoá LF rồi dựng lại (`dist-nen3`) mới còn 10 dòng (5 tệp, thuần EOL). Nếu tôi kết luận sớm
   "Đợt 57 dựng nền sai" thì đã vu oan. (G101 tái xuất.)
3. **Đọc mã thoát của `tsc` qua đường ống `| tee | tail`** ⇒ `$?` là của `tail`, luôn 0. Đã chạy lại
   `npm run check` / `check:tests` **không qua ống** để lấy mã thoát thật (0 và 1).
4. **Ablation M10 lần đầu vô hiệu**: gỡ `data-che-nhan` rồi chỉ rê chuột — lớp nhãn không tính lại,
   ra 0→0 (âm tính giả). Phải ép một **chu kỳ đổi cỡ cửa sổ** mới thấy 0→281→0. Suýt kết luận
   "thuộc tính ấy không mua được gì".

---

## 7. DB / md5 / cổng — trước và sau

| | TRƯỚC (12:45:27 +07) | SAU (14:59:51 +07) | |
|---|---|---|---|
| 11 khoá (`.qa-dot37/db.mjs dem`) | `factories 2 · twin_dat_cho 82 · stations 37 · machines 42 · users 10 · andon 7 · raised 0 · hb 108 · msl 7814 · permissions 104 · ufa 3` | y hệt | **11/11 KHỚP** |
| 6 khoá (`.qa-dot34/dem.mjs`) | `hb 108 · msl 7814 · users 10 · andon 7 · factories 2 · datcho 82` | y hệt | **6/6 KHỚP** |
| hàng TẠM | — | D-1 ×2 lượt: andon `raised` id 197 (7→8→7) + user tạm (10→11→10); D-2: user tạm; e2e B2: user tạm — **mọi lượt đều `trap EXIT` dọn, đếm lại 0 sót** | sạch |
| DDL | — | **0 câu** (chỉ SELECT/INSERT-DELETE hàng tạm của harness có sẵn) | |
| 5 ảnh `test-results/` | 5 md5 | **5/5 md5 KHỚP TUYỆT ĐỐI**, `git status test-results/` RỖNG | |
| `playwright.config.ts` | `outputDir: ".qa-pw-output"` | không đổi (git sạch); ảnh e2e của tôi nằm ở `.qa-pw-output/` và `.qa-dot58/` | G140 giữ |
| `.qa-dot47/` (103 tệp 0 byte) | 199 mục | **không đắp, không xoá, không dùng** | |
| cổng 3058 (của tôi) | trống | **ĐÃ ĐÓNG** 14:59:57 | |
| cổng cấm | 3001=23980 · 3008=32584 · 8080=5192 · 3000 tắt | **3001=23980 · 3008=32584 · 8080=5192 · 3000 vẫn tắt** | **0 lần chạm** |
| `dist/` (của phiên khác) | — | **không dựng lại, không ghi**; bản dựng của tôi ở `.qa-dot58/dist-*` | |


---

## 8. PHÁN QUYẾT

### 8.1 Bốn mục thiết kế 10–13 (QĐ-29): **ĐẠT 4/4**

| Mục | Phán | Vì sao tin được |
|---|---|---|
| 10 | **ĐẠT** | 632 px² → **0 px²** trên 4 ca, đo bằng thước độc lập; nút vẫn thu/mở thật; ablation runtime chứng minh `data-che-nhan` là nguyên nhân (0 → 281 → 0) |
| 11 | **ĐẠT** | 106 → **0** chuỗi dưới ngưỡng, hai mô hình đo (pixel + màu) trên **cùng** ma trận 1 408 chuỗi; 8 chuỗi Đợt 57 loại vì "bị cắt" tôi đo được và **đều ĐẠT** |
| 12 | **ĐẠT** | lặp mã giảm đúng 1 ở cả hai máy; viên tin cậy **lệch 0 px** so với `/twin` ở 8/8 ca; **0 dữ kiện mất** (kiểm bằng chữ hiển thị, ảnh, và `data-giay`) |
| 13 | **ĐẠT** | 1,51 → **3,12 hàng** @1280 (tiêu chí ≥3), @1600 3,68 → 5,67; không tràn; đánh đổi **có thật nhưng nhỏ** (mất 1 hàng danh sách máy @1600 — cần ghi vào spec cho đúng) |

### 8.2 Hai SAI của D-1 cột 57: **(a) NỢ THIẾT BỊ ĐO** — không phải hồi quy sản phẩm

Ba chứng cứ độc lập nhau: ① D-1 hai bản dựng lệch **đúng 2/48 ô**, và 2 ô ấy đọc **testid đã bị dời**;
② bất biến gốc đo bằng **chữ hiển thị** (5 nguồn, vi + en) **vẫn đồng thuận**; ③ **DB** xác nhận máy 14
`stopped`, nhịp tim cuối 2026-07-17 (58 ngày) ⇒ "Không rõ + NGOẠI TUYẾN + 58 ngày" là **đúng**.
**Bổ sung của Đợt 58:** nợ ấy còn một ô thứ ba (**#20**) đang **XANH GIẢ** — phải vá thước, và phải
vá theo hướng *"không đọc được ⇒ HỎNG"*.

### 8.3 Nghiệm thu 5/5 của QA lần 9 (§14q.33) sau Đợt 55–57: **CÒN ĐỨNG VỮNG** (4 tiêu chí mạnh lên, 1 tiêu chí có vết mới nhỏ)

| Tiêu chí | Đo lại hôm nay | Kết luận |
|---|---|---|
| **Yêu cầu gốc** | e2e bấm cảnh **16/16** (1 worker) · 24/24 redirect + 2 đối chứng TRƯỢT đúng · D-1 #6/#10/#28 ĐẠT | **còn ĐẠT** |
| **Tối ưu** | 1 canvas mọi màn (D-1 #1 #23, P4 1/1) · **0 khung/40 s × 3 màn** | **còn ĐẠT** |
| **Nhanh** | F1 4/4 ≤ 1 243 ms · "Live" sau 761–1 040 ms · redirect 99–723 ms | **còn ĐẠT** |
| **Đẹp** | 24 trạng thái thị giác **0 vi phạm** vi+en · bbox **34/34** · lệch lớp **0** · WCAG ≤12 px **0 dưới ngưỡng** (nền 106) | **mạnh hơn trước**, còn 1 ca **biên** `"offline"` 4,31/4,58 ở cockpit 2D (màn cũ) |
| **Trực quan** | nhãn không bị nút che ở trạng thái mặc định & `nhanTatCa`; mã máy bớt lặp; 3 hàng tồn đọng thấy được @1280 | **còn ĐẠT**, trừ **vết mới**: sau **thu→mở panel** @1600, 2 nhãn (281 px²) nằm dưới tay nắm cho tới khi đổi cỡ cửa sổ |

**Thiếu chính xác cần sửa trong hồ sơ Đợt 57:** ① "`twin-dot31-may` 6/7" → tệp thô của chính họ là
**4 pass · 1 fail · 2 không chạy** (B1/B2 **chưa từng chạy**; tôi chạy riêng: 2/2 XANH);
② "`danh-sach-may` 209 → 174" là **trung gian → cuối**, nền thật 177 @1280, và chỗ mất hàng là @1600.

### 8.4 CÒN MỞ (không chặn, nói thẳng)

- **Vết mới** nhãn-dưới-tay-nắm sau thu/mở panel @1600 (§2.1) — chưa có lưới nào đi qua trạng thái này.
- 24 chuỗi ≤12 px bị `lop-phu-dong-thoi-gian` che kín + 48 chuỗi cuộn khuất (nợ có trước).
- `"offline"` 11 px ở `cockpit-live-status` (màn cũ) ở **biên** 4,5.
- `hienDoTuoi` mặc định `true` **0 chỗ gọi sống**.
- `twin-dot31-may` A5 ĐỎ (nợ từ Đợt 39) **chặn** B1/B2 vì `serial` — nên tách A5 ra khỏi khối serial.
- **KHÔNG chạy trong đợt này** (khai rõ, không suy đoán kết quả): `D-4` (6 vai, cần chèn hàng tạm
  `machine_heartbeats`/`machine_status_logs`) · `npm test` toàn bộ · `test:e2e` toàn bộ 30 spec ·
  `kb:*` (G138) · `ext:check` · `i18n:audit` · `kb:stale-check` · production QĐ-30.
- **7 176 dòng `[SLOW QUERY]`** trong stderr của server 3058 trong ~2 h đo (nhiều nhất:
  `users.passwordChangedAt` 863–1 492 ms, `factories.code in (…)` 226–874 ms, `ot_telemetry` 300 ms).
  Đây là **dev dưới tải QA**, nhưng đúng nhóm câu mà Đợt 49/54 đã ghi nợ.
