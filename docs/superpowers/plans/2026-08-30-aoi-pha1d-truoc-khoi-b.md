# Pha 1D — Bốn việc phải xong TRƯỚC Khối B

> **Cho người thực thi:** dùng skill `superpowers:subagent-driven-development`. Các bước dùng checkbox `- [ ]`.

**Mục tiêu:** Đóng 2 Critical + 2 Important mà review toàn nhánh Pha 1C+WAL tìm ra. Cả bốn đều **bị Khối B khuếch đại**, nên phải xong trước.

**Kiến trúc:** Pha 1D không thêm tính năng. Nó vá bốn chỗ mà các pha trước để lại, và mỗi bản vá phải kèm lưới chứng minh bằng **hành vi đo được**.

**Spec:** `docs/superpowers/specs/2026-08-24-aoi-5-cap-xuong-song-design.md` §13 — BG-27, BG-39…BG-45.

---

## Global Constraints

- **Mã, chú thích, tên test, thông điệp lỗi: TIẾNG VIỆT.**
- **KHÔNG đổi mặc định** hai cờ: `INSPECTION_STORE_FORWARD_ENABLED`, `INGEST_REJECT_LEGACY_MACHINE_ENABLED`.
- **Nghiệm thu DB bằng vai `avi_app`**, KHÔNG phải `aoi`. ⚠ `avi_app` **KHÔNG có DELETE** trên `product_inspections` (WORM) ⇒ không dọn được bo test. **Đừng** viết `DELETE … .catch(() => {})` — 32 file test đang làm thế và tất cả là **no-op câm**. Ưu tiên transaction + rollback.
- **Mọi lưới phải chứng minh ĐỎ ĐƯỢC** bằng đột biến đã chạy thật. ⚠ **Hoàn tác và chứng minh** (`git status --short` sạch) — trong dự án này một agent chết giữa chừng và để lại đột biến trong cây; mã hỏng trông y hệt mã thật.
- ⚠ **NHỚ COMMIT.** Đã **ba lần** công việc suýt mất vì báo "XONG" mà không commit.
- Hai cổng Pha 0 xanh sau mỗi task: `server/utils/kpiCongThucCensus.test.ts` (3), `server/db/khongBomInspectionBia.test.ts` (4).
- Cây làm việc **dùng chung** với tiến trình song song sửa `client/src/**`, `knowledge/**`, `server/services/aiLocalTools/**`, `server/routers/repoWorkspaceRouter.ts`, `server/routers/phamViDocCensus.test.ts` — **đừng đụng**.

---

## Thứ tự và lý do

**T1 (BG-40) trước hết** — nó là thứ đang gây thiệt hại rộng nhất, và T3 phụ thuộc nó: T3 siết `.max()` sẽ **chuyển** lớp lỗi `22001` từ "DB từ chối" sang "hợp đồng từ chối", nhưng chỉ T1 mới bảo đảm những lỗi `22001` **còn sót** không chặn hàng đợi.
**T2 (BG-39)** độc lập, chạy sau T1.
**T3 (BG-27)** sau T1.
**T4 (BG-41+42)** cuối, độc lập.

---

### Task 1 (BG-40 ⛔): phân loại lỗi đúng + TRẦN số lần thử + dead-letter

**Files:** Modify `server/services/inspection/inspectionStoreForward.ts`; Test: file lưới mới

**Số đo hiện trạng — tự chạy lại để xác nhận trước khi sửa:**
```
isPermanentSubmitError(PostgresError code=22001) -> false   ← xếp TẠM THỜI (SAI)
isPermanentSubmitError(PostgresError code=23505) -> false   ← xếp TẠM THỜI (SAI)
isPermanentSubmitError(Error ECONNREFUSED)       -> false   ← đúng
`attempts` KHÔNG được so với bất kỳ ngưỡng nào
```
Hàm chỉ nhận diện `TRPCError`. Mọi lỗi Postgres thành "tạm thời" ⇒ thử lại vô hạn.
Và `inspectionStoreForward.ts:562` `break` thoát **cả vòng** khi gặp lỗi tạm thời ⇒ **một bo hỏng chặn mọi bo lành xếp sau**. Người review đo: 1 bo độc + 4 bo lành, **20 lượt rút** ⇒ `drained=0`, 4 bo lành **không được thử lấy một lần**.

**Ba việc:**
1. `isPermanentSubmitError` nhận diện lỗi DB **không-retry-được**: lớp `22xxx` (dữ liệu sai — chuỗi quá dài, sai kiểu…) và `23xxx` (vi phạm ràng buộc). ⚠ **KHÔNG** xếp lỗi kết nối/timeout vào đây — chúng thật sự tạm thời.
2. **Trần `attempts`**: quá ngưỡng ⇒ chuyển dead-letter, **không** vứt im lặng. Ngưỡng **cấu hình được**, theo khuôn env-var sẵn có trong file.
3. **Bỏ chặn-đầu-hàng**: một mục lỗi tạm thời **không được** ngăn các mục sau được thử. (Cân nhắc: tiếp tục vòng thay vì `break`, hoặc đổi lịch mục lỗi ra sau. Chọn cách nào cũng được, **nêu lý do**.)

**Bốn mệnh đề:**
1. `22001` và `23505` ⇒ `isPermanentSubmitError = true`.
2. Lỗi kết nối/timeout ⇒ vẫn `false` (**chống siết quá** — nếu xếp nhầm chúng thành vĩnh viễn thì mất bo khi DB chỉ chớp nháy).
3. **1 bo độc + 4 bo lành, rút hàng ⇒ 4 bo lành ĐƯỢC ghi**, bo độc vào dead-letter. Hiện `drained=0`.
4. Quá trần `attempts` ⇒ dead-letter, **có ghi nhận**, không biến mất im lặng.

**Đột biến bắt buộc:** hoàn nguyên `isPermanentSubmitError` về bản cũ ⇒ mệnh đề 1 và 3 phải **ĐỎ**.

---

### Task 2 (BG-39 ⛔): cửa ingest thứ SÁU

**Files:** Modify `server/routers/cuaIngestScan.ts`, `server/routers/ghiInspectionWalScan.ts` + hai file lưới census; có thể chạm `server/routers/aoiPackageRouter.ts`

**Sự thật đo được:** `aoiPackage.presign` (`aoiPackageRouter.ts:411`) và `commit` (`:528`) là `publicProcedure`, xác thực `authenticateMachine({scope:"ingest:write"})`, gọi `persistInspectionAtomic` (`:847`). **10 bo `aoi-pkg:*`, 238 gói `committed`** trong DB test.

Nó **không** đi qua: `quyetDinhPhienBanIngest` · `verdictLuuTru`/`verdictXauHon` · `dungKhoaKhuTrungV2` · WAL.

**Hai census đều mù, vì hai lý do khác nhau:**
- `cuaIngestScan.ts` chỉ mở **một** file (`machineApiRouters.ts`) và dùng vị từ tên `/^submit/i || /^sync.*result/i` — `presign`/`commit` không khớp cả hai điều kiện.
- `ghiInspectionWalScan.ts` **có** thấy `commit` nhưng **miễn trừ** với lý do *"mutation DO NGƯỜI kích hoạt"* — **SAI**: docblock `aoiPackageRouter.ts:5-6` ghi *"presign: Tạo presigned URL để **Agent** upload ZIP"*. Agent là **máy**.

**Việc:**
1. **Sửa lý do miễn trừ sai trước hết.** Một lý do sai trong bảng dựng ra để trung thực còn nguy hiểm hơn không có lý do — nó khiến người sau tin câu hỏi đã được cân nhắc đúng.
2. Đưa cửa thứ sáu vào **cả hai** census (mở rộng tập file + vị từ, hoặc cách khác — **nêu lý do**).
3. **Quyết định** cửa này: gác như năm cửa kia, hay miễn trừ với lý do **đúng**? Ghi rõ lập luận. ⚠ Nếu chọn miễn trừ, phải trả lời được: *ngày bật `INGEST_REJECT_LEGACY_MACHINE_ENABLED`, một máy cũ bị chặn ở `submitInspection` và `submitInspectionBatch` vẫn ingest trọn vẹn qua ZIP — điều đó chấp nhận được không?*
4. **Sửa mức độ BG-34** trong spec: không phải rủi ro tương lai, cửa thứ sáu **đã tồn tại**.

**Đột biến bắt buộc:** thêm cửa thứ bảy giả **không gác** ⇒ **cả hai** census phải ĐỎ nêu đúng tên. **Phản-đột-biến**: cửa giả **có** gác ⇒ không báo nhầm.

---

### Task 3 (BG-27): `.max()` cho MỌI trường chuỗi đi vào cột `varchar`

**Files:** Modify `server/contracts/machineDataContractV2.ts`; Test: lưới census mới

**Vì sao gấp:** mỗi trường chuỗi **không** có `.max()` mà cột đích là `varchar(n)` là **một quả mìn chặn-đầu-hàng** (xem T1). Khối B sẽ ghi cấp component ⇒ thêm nhiều cột nữa.

**Đã biết hở:** `productModel` (cột `varchar(100)`) và `captureName` (cột `varchar(255)`) — cả hai `z.string().optional()` không `.max()`.

**Việc:**
1. **Kiểm kê ĐẦY ĐỦ**: mọi trường chuỗi trong hợp đồng v2.0 → cột đích → sức chứa. Đừng chỉ vá hai trường đã biết.
2. Thêm `.max()` khớp **đúng** sức chứa cột.
3. ⚠ **Ca canh BIÊN**: độ dài **đúng bằng** sức chứa phải **HỢP LỆ**. Ở Pha 1B đã có tiền lệ suýt siết nhầm biên; siết `.max(63)` cho cột `varchar(64)` là từ chối dữ liệu hợp lệ.
4. **Lưới census** đối chiếu hợp đồng ↔ cột DB: trường chuỗi nào vào cột `varchar` mà thiếu `.max()`, hoặc `.max()` **lệch** sức chứa ⇒ ĐỎ.

**Chống hồi quy bắt buộc:** parse mẫu máy THẬT `D:\SOURCES\AOIData\dashboard-sample.json` nguyên văn ⇒ vẫn `success: true`.

**Đột biến:** gỡ một `.max()` ⇒ census phải ĐỎ nêu đúng tên trường.

---

### Task 4 (BG-41 + BG-42): hai cột "trông có dữ liệu mà ngữ nghĩa sai"

**Files:** Modify `server/db/inspection.ts`, `server/routers/aoiPackageRouter.ts`; Test: lưới tương ứng

**BG-41 — `ntfSource` nói dối cho bo do NGƯỜI xác nhận.**
Đo: **119 bo có `ntfConfirmedAt` khác NULL; 119/119 có `ntfSource = NULL`; 0 hàng `human`/`both` trong toàn bảng.** `updateProductInspectionNTF` (`server/db/inspection.ts:797-805`) set `overallResult:"NTF"` + `ntfConfirmedBy/At` nhưng **không chạm `ntfSource`**.
⇒ Bo v2.0 đã mang `ntfSource='machine'` rồi được người xác nhận **vẫn khai `'machine'`** ⇒ truy vấn `WHERE ntfSource='machine'` **đếm thừa**.
**Việc:** `updateProductInspectionNTF` ghi `ntfSource` đúng: chưa có nguồn ⇒ `'human'`; đã có `'machine'` ⇒ `'both'`. Ca canh cả ba chuyển tiếp.

**BG-42 — `inferAoiOverallResult` là bản logic chép tay thứ hai, và nó xử lý NGƯỢC với v2.0.**
`aoiPackageRouter.ts:384`: `if (input.explicitResult) return input.explicitResult;` — **thắng vô điều kiện**. Gói khai `OK` với `summary.ng = 3` ⇒ ghi `OK`. Đây **đúng hình dạng Đ-21** mà Pha 1C vừa đóng cho v2.0 bằng `verdictXauHon`.
⇒ Sau Pha 1C, cùng một sản phẩm có **hai đường ingest xử lý ngược nhau**: một đường không bao giờ hạ cấp, đường kia luôn để lời khai thắng.
**Việc:** đường ZIP dùng `verdictXauHon(khai, cuộn-từ-summary)` thay vì để `explicitResult` thắng. **Ca canh:** gói khai `OK` với `summary.ng>0` ⇒ ghi **`NG`**.
**Chống hồi quy:** gói khai `OK` với `summary.ng=0` ⇒ vẫn `OK`; gói khai `NG` ⇒ vẫn `NG`.

---

## Cổng ra Pha 1D

- [ ] `isPermanentSubmitError(22001)` và `(23505)` ⇒ `true`; lỗi kết nối ⇒ vẫn `false`.
- [ ] 1 bo độc + 4 bo lành ⇒ **4 bo lành được ghi**, bo độc vào dead-letter (hiện: `drained=0`).
- [ ] Quá trần `attempts` ⇒ dead-letter **có ghi nhận**.
- [ ] Cửa thứ sáu **có trong cả hai census**; lý do miễn trừ sai **đã sửa**; đột biến cửa-giả ĐỎ ở **cả hai**, phản-đột-biến không báo nhầm.
- [ ] Census `.max()` xanh; đột biến gỡ một `.max()` ⇒ ĐỎ nêu đúng tên; **mẫu máy thật vẫn parse được**; **biên đúng-bằng-sức-chứa vẫn hợp lệ**.
- [ ] `updateProductInspectionNTF` ghi `ntfSource` đúng cho cả ba chuyển tiếp.
- [ ] Gói ZIP khai `OK` với `summary.ng>0` ⇒ ghi **`NG`**.
- [ ] `npm run check` sạch · hai cổng Pha 0 xanh (3/3, 4/4).

**Còn mở sau Pha 1D** (không được im): Đ-24 (đường v1.x không có phép cuộn — đo được **3 bo `OK` với 100% điểm NG**) · BG-5,6,12,15,16,19,29,30,32,33,36,38,43,44,45 · §6 giao thức version · §3.6 dọn mồ côi · join gói ảnh theo `captureId`.
