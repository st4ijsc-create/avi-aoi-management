# AOI/AVI — Backlog toàn cảnh sau năm pha vá

**Ngày:** 2026-08-31 · **Nhánh:** `feat/hmi-dep` · **Spec gốc:** `2026-08-24-aoi-5-cap-xuong-song-design.md`

Tài liệu này gom **toàn bộ** món nợ đang mở vào một chỗ đọc được. Trước nó, 77 mục BG nằm rải trong spec §13, năm sổ SDD (**thư mục git-ignored**), và hàng chục báo cáo task.

⚠ **Bài học đã trả giá:** ngày 2026-08-30 phát hiện **14 mục bàn giao chỉ tồn tại trong sổ git-ignored** — một lượt `git clean -fdx` là mất sạch, gồm hai mục ⛔. Sổ SDD là **bản nháp phục hồi**; spec và tài liệu này mới là **bản bàn giao**.

---

## 1. Đã làm gì — năm pha, sáu lượt review

| Pha | Kết quả | Review toàn nhánh tìm ra |
|---|---|---|
| **1A** nền cây 4 cấp | 5 task · 68 ca · migration 0338/0339 | **2 Critical** |
| **1B** ingest cây | 8 task · 151 ca · migration 0340 | **4 Critical** — một cái **bác bỏ lời khai trung tâm** của người điều phối |
| **1C** vá 4 lỗ dữ liệu | 5 task · 166 ca | — |
| **WAL** cho cây v2.0 | 3 task · 72 ca | census **tự tìm** 1 Critical ở cửa BOOT |
| **1C+WAL** (gộp) | — | **2 Critical** — **cửa ingest thứ SÁU** đang chạy thật, hai census đều mù |
| **1D** trước Khối B | 6 task · 395 ca · migration 0344 | **3 Critical** — **hai là bản vá của chính pha đó tự gây hại** |
| **Đ-24** | 1 task | — |
| **lượt 5** (Đ-24 + BG-52) | — | **5 Critical** — **bác bỏ mốc son "ba đường ingest cùng luật"** |
| **1E** sáu mục ⛔ | 3 task · 426 ca | *(lượt 6 đang chạy)* |

**Tổng: 31 task, ~1.200 ca lưới, 6 migration. Review toàn nhánh tìm Critical 5/5 lượt đã xong.**

### Điều đáng nói nhất
**21 review-theo-task bỏ qua những thứ review toàn nhánh bắt được** — vì chúng nằm ở **chỗ các task ghép vào nhau**, không nằm trong task nào.

Và **ba lần liên tiếp một bản vá ĐÚNG đã mở một chiều khác**:
- Trần `attempts` (chống chặn-đầu-hàng) ⇒ **vứt bo** khi DB gián đoạn từng phần.
- Gỡ chặn-đầu-hàng ⇒ **gỡ luôn trần chi phí** ⇒ một tick = 40.000 lời gọi DB.
- Thêm `.max()` (đúng) ⇒ **chuyển lỗi** từ `Postgres 22001` (vĩnh viễn) sang `ZodError` (tạm thời) ⇒ chốt chặn retry **không còn bắn** cho đúng lớp payload nó nhắm tới.

⇒ Từ Pha 1E, mọi brief mang một câu hỏi bắt buộc: ***"bản vá này chuyển thứ gì từ lớp nào sang lớp nào, và ai đang phụ thuộc vào phân lớp cũ?"*** Hai trong ba task của Pha 1E **tự bắt được một lỗ** nhờ nó — lần đầu lớp lỗi đó chết tại bàn thay vì phải chờ review.

---

## 2. Bốn lớp lỗi lặp lại — nhận diện để không tái phạm

### L-1. Lưới cưỡng chế **DANH SÁCH** thay vì cưỡng chế **BẤT BIẾN** (4 lần)
| Lần | Lưới | Cơ chế hỏng |
|---|---|---|
| 1 | BG-14 canh `serialNumber` ở ingest | **regex trên văn bản** ⇒ soi đúng dòng của nhánh **không liên quan** ⇒ xanh giả |
| 2 | Census cửa ingest | tìm cửa bằng **quy ước đặt tên** ⇒ bỏ lọt **cửa thứ sáu** đang chạy với 10 bo |
| 3 | Census `.max()` | ghim `bảng.length === 30`, lặp trên **chính bảng đó** ⇒ xanh giả khi ai đó **thêm** trường |
| 4 | Walker zod | `return []` **im lặng** với 6 loại nút chưa hỗ trợ |

**Điểm chung:** *im lặng ở chỗ không biết* đọc **giống hệt** *xanh vì không có vấn đề*.
**Cách chống đã dùng:** quét **AST** không quét văn bản · duyệt **schema** không duyệt bảng · **báo động** khi gặp nhánh lạ · và ca **chống-tự-thoả** (lưới phải khẳng định nó tìm thấy ≥N đối tượng).

### L-2. Cơ chế **tồn tại nhưng chưa nối** (5 lần)
`loiMayChuaNangCap` (0 điểm gọi) · `verdictLuuTru` (chưa nối tới Pha 1B T5) · luật `integrityScan` (tính nhưng giao diện không vẽ) · `ntfSource` (cột có, không ai ghi) · `submitInspectionCoreObject` **được export "để census soi"** mà 0 file import.
**Chống:** đòi bằng chứng **hành vi đầu-cuối**, không nhận "hàm tồn tại". Chú thích phải nói rõ **chưa nối**.

### L-3. Chú thích **khai quá** so với hành vi (5 lần)
Ví dụ nặng nhất: bảng miễn trừ census WAL ký lý do *"mutation do NGƯỜI kích hoạt"* cho cửa ZIP — trong khi docblock của **chính file đó** ghi *"Agent gọi"*. **Một lý do sai trong bảng dựng ra để trung thực nguy hiểm hơn không có lý do**: nó khiến mọi review sau tin câu hỏi đã được cân nhắc đúng. Đó là cách cửa thứ sáu sống sót qua hai lượt census.

### L-4. **Phạm vi đo sai** — đo một tập rồi phát biểu cho tập khác (8 lần)
Đo `dev` rồi khai cho mọi DB · đo 238 gói (đều đã là NG) rồi suýt khai "chống hồi quy mạnh" · khai "không có nguy cơ cắt cụt" từ **một** tệp mẫu.
**Chống:** mọi lời khai kèm **tập đã đo**; và hỏi *"tập này có chứa hình dạng cần đo không?"*

---

## 3. Backlog đang mở — phân theo mức

### ⛔ CHẶN — phải xong trước hoặc cùng Khối B

| Mã | Việc | Số đo |
|---|---|---|
| **BG-39 gđ2** | **Gác cửa ZIP** bằng cổng chặn máy cũ. Đã hoãn có chủ đích sang Khối B (cờ đang TẮT nên chưa ai bị) | `meta.json` nhận `measurements` phẳng ⇒ **100% payload ZIP** đúng hình dạng cờ nhắm tới |
| **Đ-19** | **Cấp component chưa ghi được** — `pointDefId` `NOT NULL`. Cần teach data từ Khối B | `measurement_results` nối cây = **0** |

### ★★ NÊN LÀM SỚM — sai ngữ nghĩa, hộ tiêu thụ tương lai sẽ sai âm thầm

| Mã | Việc | Số đo |
|---|---|---|
| **BG-36** | Dead-letter **chưa có giao diện**; `integrityScan` cũng vậy | **101 mục, 7,4 MB, nằm 6 tuần** không ai đọc |
| **BG-70** | `demSoLoiVinhVienTuLichSu` đếm **cộng dồn**, chú thích khai **"LIÊN TIẾP"** ở 5 chỗ | gói lỗi 4 lần rồi sửa vẫn **cách `'dead'` đúng 1 lỗi** |
| **BG-71** | Phân loại vĩnh viễn **đảo ngược** ở cửa ZIP: "ZIP not found" (ổ mạng rớt) tính vĩnh viễn; `TOO_MANY_REQUESTS` trong `PERMANENT_TRPC_CODES` | |
| **BG-72** | `.max(40)` từ chối `DateTime.ToString()` mà `new Date()` **vẫn nhận** | 50 và 57 ký tự bị từ chối |
| **BG-73** | ✅ **ĐÃ QUYẾT (chủ dự án, 2026-09-01): BỎ hướng sửa schema.** Hướng (b) ở `8150ab6d` là lời giải CUỐI — lệch hình dạng **không đếm** vào ngưỡng `'dead'`, gói nằm `'failed'` và retry vô hạn | mẫu chuẩn `safeParse` = **false**; hệ quả đã duyệt |
| **BG-74** | `'dead'` gần vô hình: `listPackages` không lọc được · `getStats` cộng không khớp · badge **xám nhạt** hơn `failed` (đỏ) · thiếu i18n · tài liệu Agent vẫn 5 giá trị | |
| **BG-75** | `migrate-standalone.mjs` chạy 0344 bằng `avi_app` ⇒ `42501`; `MIGRATE_STRICT` **tắt** ⇒ deploy **xanh giả** | trên máy này đã đóng (đủ 6 giá trị enum) |
| **BG-76** | `calculatedSummary` (`ngCount`) vẫn lấy từ `summary` khai, trong khi `overallResult` nay từ dữ liệu ⇒ **hai cột cùng hàng bất đồng** | hiện **0 hàng** biểu hiện — tiềm ẩn |
| **BG-77** | Bản vá BG-68 **phụ thuộc một lỗi có sẵn**: `measurements[] \|\| points[]` (mảng rỗng là truthy) | |
| **BG-53** | Hai nơi gọi `inferAoiOverallResult` nuôi **hai đầu vào khác nhau** | |
| **BG-54** | `presign` thiếu kiểm `pkg.machineId` ⇒ **rò chuỗi tenant** + chiếm chỗ `packageId` | nguy hiểm **ngay hôm nay**, cờ TẮT |
| **BG-55** | ✅ **ĐÃ VÁ 2026-08-31** (C-1, review lượt 8, commit `2d340335`): bỏ cổng `if (metaData.serialNumber)` ở `aoiPackageRouter.commit` — điều kiện ghi nay là "có cây hợp lệ", hội tụ theo `packageId`. Hook WIP cũng thôi gác bằng serial | lưới `aoiPackageSerialRongVanGhi.test.ts` (4 ca) + hình dạng `serialRongVanPhaiGhiDuoc_C1` trong `BANG_HINH_DANG` chạy qua cổng tích hợp SỐNG |
| **BG-92** | **Spec-gate `evaluatePointResult` KHÔNG có điểm gọi trên đường v2** (cửa ZIP mất nó ở `df20b31c`; `submitInspectionTreeV2` chưa bao giờ có) ⇒ linh kiện ngoài giới hạn mà máy khai OK sẽ được ghi OK. Chưa nối được vì cây v2 chỉ mang `componentExtId`, còn cổng cần `pointDefId` — ánh xạ đó là dữ liệu **Khối B**. Phải đóng **CÙNG Đ-19** | `evaluatePointResult` còn **1** điểm gọi sản xuất (đường v1.x phẳng); `isPointLimitEvalEnabled()` mặc định **ON**; 294/296 gói `committed` mang hình dạng phẳng ⇒ cổng vẫn đang sống trên hình dạng sinh ra dữ liệu hôm nay |
| **BG-93** | **`audit_logs` KHÔNG có retention/partition, và vai ứng dụng KHÔNG dọn được nó.** Đo bằng `information_schema.role_table_grants` với `current_user='avi_app'`: quyền trên `audit_logs` = **`INSERT`, `SELECT`** (WORM, mig `0224`) ⇒ **không tác vụ dọn nào chạy bằng vai ứng dụng được**; không tìm thấy job retention nào. I-4 (review lượt 8) đã đóng phần "người CHƯA XÁC THỰC ghi được vào đó" và đặt trần tăng trưởng bằng trần ingest per-máy, **nhưng không đóng phần tăng trưởng dài hạn**. Lời giải phải là **partition theo thời gian + một vai riêng có `DELETE`/`DROP PARTITION`** — ⚠ **KHÔNG** cấp `DELETE` cho `avi_app` (mất tính WORM) và **KHÔNG** viết `DELETE` nào từ mã ứng dụng | `current_database()='aoi_management'`: **4 061** hàng / **2 968 kB**, tín hiệu hình dạng ingest **0** hàng. `current_database()='aoi_management_test'`: **20 853** hàng / **11 MB** (~566 byte/hàng), trong đó `ingest_shape_legacy`=**272**, `ingest_shape_v2`=**56**. Ở nhịp 1 hàng/lượt ingest THẬT và 10 000 bo/ngày ⇒ **≈5,7 MB/ngày ≈ 2 GB/năm** chỉ riêng tín hiệu đếm |
| **BG-57** | Cổng chặn máy cũ **không phát tín hiệu đếm được** ⇒ câu hỏi *"còn bao nhiêu máy gửi hình dạng phẳng?"* **không trả lời được từ mã** — mà đó là điều kiện tiên quyết để dám bật cờ | |

### ★ GHI NỢ — có ghi chép, không chặn

**Nợ hạ tầng test:** BG-15 (**32 file** dọn dẹp WORM **no-op câm**) · BG-63 (`aoiPackageInlineGate` rò **~90 hàng**, làm trôi baseline "N gói committed") · BG-61 (chưa đo tick ở quy mô 20.000) · BG-47 (trần gắn với interval, chưa có lưới canh chéo).

**Nợ nhất quán:** BG-44 (bất đồng chỉ mục 0272 ↔ `idempotencyKey`) · BG-45 (`dungKhoaKhuTrungV2` khi `startedAt` vắng ⇒ **trùng khoá**) · BG-46 (`processStoreForward` **cùng lỗ** phân loại, bán kính nhỏ hơn) · BG-58 · BG-59 · ~~BG-60~~ ✅ **ĐÃ VÁ**: nửa `commit` ở `cc322bca` (BG-87), nửa `presign` ở I-7/review lượt 8 (mig 0346 — lời khai presign được LƯU rồi đối chiếu trên byte thật ở tuyến upload + backstop `commit`; hai tài liệu hướng máy sửa theo).

**Nợ khảo sát/chữ nghĩa:** BG-5 · BG-6 · BG-12 · BG-16 · BG-19 · BG-29 · BG-30 · BG-32 · BG-33 · BG-34 · BG-38 · BG-48 · BG-49 · BG-56 · BG-62.

**Việc lớn chưa bắt đầu:** §6 giao thức version (hai luật nâng version) · §3.6 dọn mồ côi (+ BG-5 mồ côi **cấu hình**, 94 hàng) · **join gói ảnh theo `captureId`** · **Khối C** (UI sản phẩm) · **Khối D** (gộp màn hình + hạ tầng Playwright).

---

## 4. Hai thứ cần chủ dự án quyết

**Tài khoản test cho Playwright (Khối D).** Hiện `e2e/login.spec.ts` **không thật sự đăng nhập**; không có `storageState`, không fixture, không biến `E2E_*`. Không có tài khoản thì **không nghiệm thu bằng mắt được** — mà đó là yêu cầu ban đầu.

**Duyệt thiết kế UI trước khi code (Khối C).** `ProductModels.tsx` là **3.557 dòng**. Làm lại thành bảng + dialog là thay đổi người dùng nhìn thấy; nên chốt thiết kế trước.

---

## 5. Trạng thái an toàn hôm nay — nói thẳng

**Đã đóng:** bo lỗi không còn ghi thành bo đạt trên **cả ba** đường ingest · khử trùng giữ cả khi serial rỗng · WAL không mất bo khi DB chớp nháy · một bo hỏng không chặn hàng đợi · cửa ZIP không retry vô hạn · `'dead'` là trạng thái cuối thật.

**Chưa đóng, và phải nói ra:**
- **Cấp component chưa lưu được** (Đ-19) ⇒ bản đồ bo **toàn xanh**, cảnh báo NG-rate **không bao giờ bắn**, giám sát toàn vẹn **mù** với lớp lỗi này.
- **Dead-letter là hố không ai đọc** (BG-36) ⇒ "ghi nhận" trên thực tế vận hành vẫn là **mất bo trong im lặng**.
- **Cửa ZIP chưa gác** (BG-39 gđ2) ⇒ ngày bật cờ cắt máy cũ, máy cũ vẫn ingest trọn vẹn qua ZIP.
- **Cổng chặn máy cũ không đếm được** (BG-57) ⇒ **không có cách nào biết khi nào an toàn để bật**.

⇒ Thứ đang giữ hệ thống an toàn ở ba mục cuối là **một giá trị mặc định cờ** và **việc chưa ai bật nó**.
