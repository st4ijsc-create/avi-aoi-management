# QA LẦN 11 — 3D TWIN TRÊN KỊCH BẢN TẬP ĐOÀN

**Ngày:** 2026-09-15 · **Chủ đợt:** phiên `avi-aoi-management-39` · **Phương pháp:** skill `pdca` (kiểm hệ đo trước, đo kết cục người dùng, chứng minh nhân quả bằng ablation, Pareto trước khi vá)
**HEAD đo:** `a147fc35` (= `fresh/feat/ai-local-L7-hang-rao` = `fresh/feat/twin-3d-trung-tam`) · **Bản dựng đo:** `.qa-tapdoan/dist-a147fc35`, bundle `index-DxxtO34H.js`, md5 903 dòng
**Artefact:** `.qa-tapdoan/` — 36 phát hiện (`PHAT-HIEN.md`), 4 bảng lô, 119 tệp thô, 134 ảnh PNG, 2 tệp đánh giá vai, 6 harness

---

## 0. KẾT LUẬN MỘT TRANG

Trên dữ liệu lớn gấp 26 lần mọi đợt trước (1 tập đoàn → 3 công ty → 12 toà × 7 tầng → 98 chuyền → **1.108 máy**), phần **lõi 3D của sản phẩm rất khoẻ**, nhưng **hai đường dẫn người dùng bị vỡ** và **một thủ tục rò phạm vi tenant**.

| tiêu chí chủ sở hữu | phán quyết trên dữ liệu 26× | bằng chứng |
|---|---|---|
| **TỐI ƯU** | **ĐẠT, biên 25–33×** | 68 máy/tầng = 5 draw calls · 15.026 tam giác · 6 nhãn · 1 canvas; một khung 16,1 ms ≈ cảnh 12 máy |
| **NHANH** | **VỠ Ở CỔNG VÀO, khoẻ ở 3D** | 48/48 lượt > 2.500 ms; nhưng admin 1.182 ms ≈ QA10 1.169 ms ⇒ không hồi quy; toàn bộ +1,45 s do một truy vấn không lọc tenant |
| **ĐẸP** | **ĐẠT, trừ một chỗ** | 0 cặp chồng lấn / 0 px², lệch lớp (0,0,0,0) 10/10, 0 tràn ngang; mã máy bị cắt ở 1280 |
| **TRỰC QUAN** | **ĐẠT ở phần đo được, có lỗ đo** | trạng thái mã hoá 3 lớp; nhưng lớp phủ vòng sức khoẻ **chưa từng đo được** ở 11 đợt vì thiếu bộ đếm |
| **KẾT CỤC GỐC** (chọn Line → Line 3D, chọn máy → Machine 3D) | **KHÔNG ĐẠT** | 77–93 % chuyền không vẽ đủ, do hai dòng lấy cứng phần tử đầu |

**Ba việc phải làm trước khi giao cho người dùng thật**, xếp theo bán kính:
1. Bỏ `factories[0]` và `toaNha[0]` ở màn Chuyền/Máy (4 dòng, 2 tệp) — mở lại 77–93 % điểm đến.
2. Lọc phạm vi tenant cho `commandCenter.hierarchy` — vừa bịt rò 450 KB, vừa trả lại ~1,9 s mỗi lần mở màn.
3. Thêm ô chọn Toà + Tầng cho Studio và gác nút Tạo bằng `canCreate` — mở lại 88 % máy cho đường thiết kế.

---

## 1. BƯỚC 0 — KIỂM HỆ ĐO TRƯỚC KHI ĐO

| kiểm | kết quả |
|---|---|
| Mã nguồn đã mới nhất? | HEAD local = remote `hang-rao` = remote `twin` = worktree `_twin_wt` = `a147fc35`. Nhánh `L7-sach` local đã ff, remote chờ phiên chủ nhánh push. |
| Bản đang chạy = bản vừa sửa? | dist cổng 3000 dựng từ `e780bcab`; diff runtime tới HEAD = **0 tệp**. Bản dựng đo riêng dựng lại từ HEAD, xác minh bằng 4 ký hiệu (`vien-tin-cay-may`, `hopManHinh`, `max-h-[328px]`, `do-tuoi-may`) và `scope: phamViCua` 5 lần trong server bundle. |
| Cache giữa các lượt? | Mỗi lượt đo hiệu năng dùng **một browser context mới**. |
| Ai đang sửa dở vùng này? | Vùng bẩn chỉ ở `knowledge/`, `uploads/`, `test-results/`, `.qa-*` — không chạm. |
| Cổng dùng chung | Server đo **riêng cổng 3064** với `RATE_LIMIT_REDIS=false AUTH_RATE_LIMIT_PER_15MIN=5000` đặt inline (không sửa `.env`). Không chạm 3000/3001/3008. |
| Cổng nền tại HEAD | `check` **0 lỗi** · `i18n:check` **0/0/0/0** · `vitest phamVi` **17 tệp / 437 ca xanh** · `twin3d` **109 tệp / 2.539 xanh** |

**Hai lỗi hệ đo tự phát hiện trong đợt** (ghi ra vì chúng làm sai số của đợt khác):
- **Playwright mặc định chạy SwiftShader (CPU), không phải GPU.** Cùng cảnh, cùng thao tác: **26,1 FPS → 62,1 FPS** sau khi thêm `--use-angle=default --enable-gpu --ignore-gpu-blocklist`. Ngưỡng "FPS xoay ≥ 30" của §4 **trượt trên CPU, đạt trên GPU** ⇒ mọi số FPS trong 10 đợt trước là số CPU.
- **Thước "40 bước kéo/giây" đo tốc độ harness, không đo bộ dựng hình** (113 khung / 40 sự kiện CDP ≈ 90 ms/bước). Phải đo Δt giữa hai khung.

---

## 2. DỮ LIỆU KỊCH BẢN — DỰNG VÀ NGHIỆM THU

Bộ sinh riêng `.qa-tapdoan/sinh-tap-doan.mjs` (tiền tố `QATD-`, có `--kho` chạy khô, `--ghi` một giao dịch, `--chi-nhip` làm tươi, `--go` gỡ theo đúng thứ tự ngược). Script sinh tải có sẵn của dự án chỉ tạo **một toà mỗi nhà máy** và xưởng ở **mọi tầng** nên không diễn đạt được kịch bản.

| cấp | số lượng | kiểm |
|---|---|---|
| Tập đoàn | 1 (`QATD`) | `factories.corporateCode` điền đủ 3/3 |
| Công ty | 3 — A 371 máy · B 409 · C 328 | tổng 1.108 |
| Toà nhà | 12 (4/công ty) | `twin_toa_nha` |
| Tầng | 84 (7/toà) | `capSo` 1..7, cao độ (N−1)×6000 mm |
| Xưởng | 24 (chỉ tầng 1 và 2) | `workshops.tangId` trỏ đúng tầng |
| Chuyền | 98 (3–5/xưởng) | |
| Máy | 1.108 (8–15/chuyền) | **24/24 loại**, 0 chuyền lặp loại |
| Đặt chỗ 3D | 2.338 hàng | 1 hàng/máy + trạm/chuyền/xưởng |

Cầu chì sau khi ghi: **32/32 đạt**, đếm lại bằng SQL độc lập ngoài script. Nền cũ không đổi (SIM-FAC 42 máy, 10 người dùng). Tài khoản QA riêng `qatd_*` (7 vai, id 26483–26489) để không phụ thuộc mật khẩu đặt tay ngoài repo.

**Một quyết định của bộ sinh khác brief và đúng hơn brief:** brief ghi đặt máy ở `Z=0`; bộ sinh đặt `Z = cao độ tầng` vì `hopNhatCanh.ts:191` đưa thẳng `viTriZMm` vào toạ độ cảnh — `Z=0` cho tầng 2 sẽ vẽ máy chui vào tầng 1.

---

## 3. KẾT QUẢ ĐO

### 3.1 Bảng phán quyết (116 ô, người đọc tự đếm lại từ `.qa-tapdoan/BANG-*.md`)

| lô | nội dung | ĐẠT | SAI | HỎNG | CHẶN-ĐÚNG | N/A |
|---|---|---|---|---|---|---|
| A+B | cửa vào · phạm vi · toà/tầng | 20 | 16 | 0 | 1 | 1 |
| C | kết cục gốc Chuyền 3D / Máy 3D | 7 | 6 | 0 | 3 | 1 |
| D+E | ngăn xử lý nghiệp vụ · Studio | 17 | 6 | 0 | 3 | 0 |
| F | tối ưu · nhanh · đẹp · trực quan | 25 | 7 | 1 | 0 | 2 |
| **tổng** | | **69** | **35** | **1** | **7** | **4** |

Ô không có phán quyết: **0** ở cả bốn lô.

**Tái phân loại của chủ đợt:** 15 trong 35 ô SAI là **đo nhầm thước do brief của tôi**, không phải lỗi sản phẩm (xem §6). **SAI sản phẩm thực: 20 ô, gộp về 15 khuyết tật riêng biệt.**

### 3.2 Pareto — khuyết tật theo bán kính

| # | khuyết tật | mức | bán kính đo được |
|---|---|---|---|
| 1 | Màn Chuyền/Máy lấy cứng nhà máy đầu + toà đầu | **CAO** | 77,4–93,1 % chuyền không vẽ đủ (5 vai) |
| 2 | `commandCenter.hierarchy` không lọc phạm vi tenant | **CAO (bảo mật)** | 5/5 vai nhận cùng 450.811 byte, kể cả người 0 gán |
| 3 | 48/48 lượt tải vượt 2.500 ms | **CAO** | mọi vai không-admin, mọi màn |
| 4 | Studio chỉ thiết kế được tầng 1 của toà 1 | **CAO** | 326/371 máy (88 %) ngoài tầm |
| 5 | Mẫu số và danh sách không theo phạm vi đang xem | TRUNG BÌNH | mọi tầng khác tầng 1 toà 1 |
| 6 | Studio gác bằng `canEdit`, bỏ qua `canCreate` | TRUNG BÌNH | mọi vai có sửa mà không có tạo |
| 7 | Mã máy bị cắt ở 1280 làm mất khả năng phân biệt | TRUNG BÌNH | 14 chuỗi mỗi màn |
| 8 | Dòng dải cảnh báo không mang danh tính máy/công ty | TRUNG BÌNH | 15 dòng (quản đốc) / 55 (giám đốc) |
| 9 | Bảng KPI che lời khai trung thực của chính sản phẩm | TRUNG BÌNH | 3/3 ảnh vai giám đốc |
| 10 | Báo bất thường không có mặt trên twin | TRUNG BÌNH | vai công nhân |
| 11 | Ngăn xử lý trên màn nhà máy không có nút nào | TRUNG BÌNH | kỹ thuật và công nhân |
| 12 | Màn Chuyền không phân biệt ngoài-phạm-vi với chưa-xếp-chỗ | THẤP | mọi chuyền ngoài phạm vi |
| 13 | Nút Mở chức năng cấp nhà máy/chuyền không có chỗ gọi | THẤP | mất ngữ cảnh, không mất tính năng |
| 14 | Hành động ghi chú khai trong logic nhưng không có giao diện | THẤP | 5/5 vai |
| 15 | Bảng sức khoẻ 2D chưa giao, và không có bộ đếm để đo vòng màu | THẤP + 1 HỎNG | một lớp phủ chưa từng đo |

### 3.3 Hai khuyết tật nghiêm trọng — bằng chứng đầy đủ

**A. Kết cục gốc vỡ.** `TwinLine.tsx:355` và `TwinMay.tsx:284` viết `const factoryId = factories[0]?.id ?? null;`; `TwinLine.tsx:373-378` và `TwinMay.tsx:297-302` lấy `toaNhaDau = (toaNhaQ.data ?? [])[0]`. Thứ tự do `hierarchy.ts:340 orderBy(factories.name)` và toà sắp theo mã.

Ba đường độc lập cùng kết luận:

| đường đo | kết quả |
|---|---|
| API `factoryCommand.machineDetail(4977)` | admin và giám đốc: **CÓ DỮ LIỆU** |
| Giao diện cùng máy đó | admin và giám đốc: **"không thuộc phạm vi đang xem"** |
| Công nhân (quyền hẹp nhất, 1 nhà máy) | **mở được** cùng máy |
| API `maintenance.createWorkOrder(4568)` bằng cookie bị giao diện chặn | **HTTP 200**, phiếu được tạo thật |

Quyền, phạm vi tenant và dữ liệu đều bị loại trừ. Hai triệu chứng: sai nhà máy cho ra "Máy 0 · Trạm 0"; sai toà cho ra header đúng số mà **cảnh 3D trống** (chuyền 299: "Máy 10 · Trạm 10" nhưng 0 khối) và "máy chưa có chỗ trên bố cục" dù cơ sở dữ liệu **có** hàng đặt chỗ.

Vì sao 10 đợt trước không thấy: chú thích ngay trên dòng đó viện lý do "đo 2026-09-09: 2 nhà máy, toàn bộ 82 hàng đặt chỗ ở một tầng". Dữ liệu đợt này làm hết hạn tiền đề ấy.

**B. Rò phạm vi tenant.** `commandCenterRouter.ts:51-58` lấy phạm vi từ `input` (lời tự khai của client), không từ `ctx.user`; `phamViCua` xuất hiện 0 lần trong tệp. Ngay bên dưới, `kpiSummary` **có** thu hẹp theo người xem, với chú thích "input là lời tự khai" — tức luật đã biết, bỏ sót đúng thủ tục nặng nhất.

| vai | `commandCenter.hierarchy` | `factory.list` | `factoryCommand.overview` |
|---|---|---|---|
| admin | 200 · 450.811 B | 5 | 1150 |
| giám đốc | 200 · **cùng md5** | 3 | 1108 |
| kỹ thuật | 200 · **cùng md5** | 2 | 780 |
| công nhân | 200 · **cùng md5** | 1 | 328 |
| **không gán nhà máy nào** | 200 · **cùng md5** | **0** | **0** |
| không quyền | **403** | 1 | FORBIDDEN |

Năm vai, **một md5 duy nhất**. Cây lộ 1 site · 5 nhà máy · 102 chuyền · 1.145 trạm · 1.151 máy kèm tên và số cảnh báo, gồm cả nhà máy của hệ cũ. Cùng lớp lỗi đã vá cho `factoryCommand.overview` ngày 2026-09-10 — sót một thủ tục. Đây cũng là nguyên nhân chính của việc chậm: chi phí bằng chi phí quét cả cơ sở dữ liệu nên lớn lên cùng dữ liệu.

### 3.4 Điểm mạnh có bằng chứng

- **Phạm vi tenant đúng 7/7 vai** so với kỳ vọng tính độc lập từ cơ sở dữ liệu. Đường gán cấp tập đoàn hoạt động thật (giám đốc thấy đủ 1.108 máy của 3 công ty) — mục 26 của §15 lần đầu đo được ở phần này.
- **Hợp đồng trạng thái khớp 5/5 rổ** trên 409 máy, kể cả luật suy ra mất kết nối từ nhịp tim cũ.
- **Cảnh 3D vẽ đúng tầng ở 13/13 tầng đo được**; bộ chọn 4 toà × 7 tầng đúng ở cả 3 công ty — đóng một nợ tồn từ nhiều đợt (trước đây cơ sở dữ liệu chỉ có một toà, một tầng).
- Bấm thẳng tâm khối máy trên cảnh: **5/5 đúng máy**. Xác nhận cảnh báo chạy thật với ablation ba mốc. Vẽ, lưu rồi xoá vùng an toàn qua giao diện, số hàng 341 → 342 → 341.
- **7 lời gọi API ngoài phạm vi đều trả về rỗng hoặc không tìm thấy** — không rò dữ liệu máy. Sinh bố cục tự động chặn đúng vai kỹ thuật bằng 403.

---

## 4. ĐÁNH GIÁ THEO BỐN VAI

Chi tiết ở `.qa-tapdoan/REVIEW-QUANLY-GIAMDOC.md` và `REVIEW-KYTHUAT-CONGNHAN.md`.

| vai | phạm vi | xếp hạng | lý do một dòng |
|---|---|---|---|
| **QUẢN LÝ** (quản đốc) | 1 công ty, 371 máy | **HẠN CHẾ NẶNG** | Đọc đúng và trung thực ở cấp nhà máy, nhưng ba việc hằng ngày đều vỡ ngoài tầng 1 toà 1, tức trên 78–88 % phạm vi được giao |
| **GIÁM ĐỐC** (tập đoàn) | 3 công ty, 1.108 máy | **CHƯA DÙNG ĐƯỢC** | Hai việc định nghĩa ra vai đều không làm được: nhìn cả tập đoàn một màn, và đi sâu vào bất kỳ công ty nào (hỏng 92,9 % điểm đến) |
| **KỸ THUẬT** | 2 công ty, 780 máy | **HẠN CHẾ NẶNG** | Vòng "tìm máy lỗi → mở máy → ra phiếu" chạy trọn vẹn nhưng chỉ trên 85/780 máy; 52 % máy của nhà máy thứ hai bị màn nói sai về quyền của chính người dùng |
| **CÔNG NHÂN** | 1 công ty, 328 máy | **HẠN CHẾ NẶNG** | Mặt xử lý cảnh báo dùng được thật; nhưng bản đồ 3D — thứ biện minh cho màn 3D — chỉ đúng ở toà 1, tức 71/328 máy |

Ba câu hỏi nghiệp vụ không trả lời được hôm nay: "công ty nào tệ nhất hôm nay" (dải cảnh báo không mang danh tính công ty), "tầng 2 toà 3 có bao nhiêu máy dừng lỗi" (mẫu số theo nhà máy, không theo tầng), "máy nào sắp hỏng trong xưởng tôi phụ trách" (bảng xếp hạng sức khoẻ chưa giao).

Bằng chứng thị giác đáng chú ý nhất, từ ảnh tự đọc: người dùng tên "Kỹ sư thiết bị A+B" bị màn nói máy của B "không thuộc phạm vi đang xem"; và chuyền ở toà 3 hiện header "Máy 10 · Trạm 10" mà giữa màn chỉ có một cây cột đèn đứng trên hư không — tệ hơn màn trống vì trông như đã tải xong.

---

## 5. ABLATION — CHỨNG MINH NHÂN QUẢ

| phép | kết quả |
|---|---|
| Đổi vai để lật phần tử đầu của danh sách nhà máy | Công nhân mở được máy 4977; giám đốc và admin (quyền rộng hơn) bị chặn ⇒ loại trừ quyền, phạm vi, dữ liệu |
| So API với giao diện trên cùng phiên | API trả dữ liệu và ghi được phiếu trong khi giao diện từ chối ⇒ lỗi nằm ở client |
| Cảnh báo dựng tay, ba mốc | Trước: không badge → dựng: badge nổi → xoá: badge mất |
| md5 của `hierarchy` theo 5 vai | Một md5 duy nhất, trong khi hai thủ tục khác **có** lọc ⇒ rò tenant |
| `hierarchy` với 0 máy so với 1.150 máy | 1.646 ms so với 1.664 ms (không tỉ lệ), đối chứng `overview` 8 → 55 ms (có tỉ lệ) ⇒ bác bỏ giả thuyết "chậm vì nhiều máy" |
| SwiftShader so với GPU | 26,1 → 62,1 FPS cùng cảnh ⇒ ngưỡng FPS phụ thuộc cấu hình đo |

---

## 6. LỖI CỦA CHÍNH ĐỢT NÀY

Ghi ra vì chúng quyết định cách đọc các con số ở trên.

- **Brief tự mâu thuẫn về một con số.** Ô đếm máy ở panel trái cố ý đếm theo nhà máy (có chú thích trong mã, gọi là "cùng chữ máy, hai mẫu số"), nhưng brief của tôi vừa cho phép điều đó ở một ca vừa đòi nó khớp tầng ở ca khác ⇒ 14 ô SAI oan. Thước đúng cho "máy của tầng" là **số khối trong cảnh 3D**, và theo thước đó sản phẩm **đạt 13/13 tầng**.
- **Nhịp làm tươi nhịp tim đặt 120 giây, vượt ngưỡng tươi 60 giây** của sản phẩm ⇒ nửa chu kỳ mọi máy bị tính là dữ liệu cũ. Đã hạ xuống 45 giây.
- **Bảng quyền trong brief ghi quản đốc có quyền ẩn tạm cảnh báo**, nhưng bộ sinh tài khoản của tôi không cấp quyền tạo cho mục đó ⇒ giao diện ẩn nút là đúng, không phải lỗi.
- **Không nói trước rằng giao diện của các tài khoản QA là tiếng Anh**, khiến thước lọc chữ tiếng Việt cho kết quả sai ở lượt đầu.

Cả bốn đều do agent đo phát hiện và bác lại. Đó là lý do mọi ca phải lưu dữ kiện thô kèm một câu vì sao.

---

## 7. HỒI QUY SUITE CÓ SẴN

| project | worker | đạt | đỏ | thời gian |
|---|---|---|---|---|
| cảnh 3D (`chromium-canh-3d`) | 1 (cứng trong cấu hình) | **79** | **6** | 19,4 phút |
| còn lại (`chromium`, chỉ spec twin) | 4 | **5** | **2** | 1,5 phút |

Tám ca đỏ. Một là **nợ đã biết từ trước** (`twin-dot31` ca A5 ghim "2 canvas" trong khi thực tế 1). Bảy ca còn lại chạm các spec viết cho bộ dữ liệu cũ (42 máy, một toà, một tầng) nên **chưa phân xử được** là hồi quy thật hay lệch tiền đề dữ liệu: các spec đó khẳng định số đếm và hình dạng cụ thể của bộ dữ liệu cũ, mà đợt này thêm 1.108 máy và 12 toà vào cùng cơ sở dữ liệu. Cần chạy lại từng ca riêng sau khi gỡ dữ liệu kịch bản mới kết luận được. Số worker ghi kèm vì nó là một phần của phép đo: cùng mã nguồn, 12 worker từng cho 7 ca đỏ oan mà 1 worker cho toàn xanh.

---

## 8. VIỆC TIẾP THEO

**Vá ngay, bán kính lớn nhất trên công sức nhỏ nhất:**
1. Suy nhà máy và toà từ chính chuyền/máy đang mở thay vì lấy phần tử đầu — 4 dòng ở 2 tệp; id đúng **đã có sẵn** trong đường dẫn về của chính trang. Nghiệm thu: mọi vai về 0 % chuyền hỏng, và ca đối chứng âm (máy của nhà máy không được gán) **vẫn phải bị chặn**.
2. Lọc tenant cho `commandCenter.hierarchy`, dùng đúng khuôn của thủ tục ngay bên dưới. Nghiệm thu: md5 khác nhau theo vai, người 0 gán nhận cây rỗng, và thời gian mở màn của vai thường về ~1,2 giây.
3. Thêm ô chọn Toà và Tầng cho Studio, gác nút Tạo bằng quyền tạo. Nghiệm thu: xếp được chỗ cho máy ở tầng 2 và toà 4; vai chỉ có quyền sửa không thấy nút Tạo.

**Vòng sau:** một con số cho đúng phạm vi đang xem; rút tiền tố mã máy trong danh sách (màn Chuyền đã có lời giải sẵn); danh tính máy và công ty trên dòng cảnh báo; bảng xếp hạng sức khoẻ 2D và bộ đếm để đo được lớp phủ vòng màu; hành động báo bất thường cho công nhân; hai con số rủi ro ngược nhau trên màn Máy.

**Việc cần quyết định của chủ dự án:** gỡ dữ liệu kịch bản (`--go`) hay giữ lại để vá và đo lại; khoá API mặc định trong tệp test client đang được phục vụ công khai trên cổng 3000 (trên môi trường phát triển là khoá chết, production chưa đo).
