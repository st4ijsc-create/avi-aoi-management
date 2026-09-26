# Pha 1E — Sáu mục ⛔ từ lượt review thứ năm

> **Cho người thực thi:** dùng skill `superpowers:subagent-driven-development`. Các bước dùng checkbox `- [ ]`.

**Mục tiêu:** Đóng **BG-64…BG-69**. Ba trong sáu mục là **hậu quả của chính vòng vá trước** — mỗi bản vá đúng ở chỗ nó nhắm rồi mở một chiều khác.

**Spec:** `docs/superpowers/specs/2026-08-24-aoi-5-cap-xuong-song-design.md` §13 (BG-1…BG-75).

---

## Global Constraints

- **Mã, chú thích, tên test, thông điệp lỗi: TIẾNG VIỆT.**
- **KHÔNG đổi mặc định** `INSPECTION_STORE_FORWARD_ENABLED`, `INGEST_REJECT_LEGACY_MACHINE_ENABLED`.
- **Nghiệm thu DB bằng vai `avi_app`**, KHÔNG phải `aoi`. ⚠ `avi_app` **KHÔNG có DELETE** trên `product_inspections` (WORM) — nói rõ để lại bao nhiêu hàng; **đừng** viết `DELETE … .catch(() => {})` (32 file test đang làm thế, tất cả **no-op câm**).
- ⚠ `data/inspection-store-forward*.jsonl` là **tệp THẬT** (dead-letter đang có **101 mục**, 7,4 MB, nằm 6 tuần). **Đừng ghi vào chúng** — dùng `INSPECTION_STORE_FORWARD_FILE` trỏ tệp tạm.
- **Mọi lưới phải chứng minh ĐỎ ĐƯỢC** bằng đột biến đã chạy thật. ⚠ **Hoàn tác và chứng minh** (`git status --short` sạch).
- ⚠ **NHỚ COMMIT.** Đã **ba lần** công việc suýt mất vì báo "XONG" mà không commit.
- Hai cổng Pha 0 xanh sau mỗi task (3/3, 4/4). `npm run check` sạch.
- Cây làm việc **dùng chung** với tiến trình song song sửa `client/src/**`, `knowledge/**`, `server/services/aiLocalTools/**`, `vscode-extension/**` — **đừng đụng**.

---

## Bài học chi phối cả pha này

**Ba lần liên tiếp một bản vá đúng đã mở một chiều khác.** Trước khi viết mã, mỗi task phải trả lời: *"bản vá này chuyển thứ gì từ lớp nào sang lớp nào, và ai đang phụ thuộc vào phân lớp cũ?"*

Ví dụ cụ thể đã xảy ra: thêm `.max()` **đúng**, nhưng nó chuyển lỗi từ `Postgres 22001` (**vĩnh viễn**) sang `ZodError` (**tạm thời**) ⇒ chốt chặn retry **không còn bắn** cho đúng lớp payload nó sinh ra để chặn. Hai nửa của **cùng một commit** cắn nhau.

---

### Task 1 (BG-64 + BG-66 + BG-67) — ba lỗ trong cơ chế WAL

**Files:** `server/services/inspection/inspectionStoreForward.ts` + lưới

**BG-64 ⛔ — phân loại lỗi bỏ sót đúng lớp nguy hiểm nhất.** Đo được:
```
ZodError (chuỗi quá cỡ)   → isPermanentSubmitError = FALSE   ← sai
Postgres 22001            → TRUE                              ← đúng
JSZip "Can't find end of central directory" → FALSE           ← sai
JSON.parse SyntaxError    → FALSE                             ← sai
```
Ba chế độ hỏng phổ biến nhất của một payload — **quá cỡ, nén hỏng, JSON hỏng** — đều bị xếp **tạm thời** ⇒ retry vô hạn.
⚠ **Đừng siết quá:** lỗi kết nối/timeout vẫn phải là **tạm thời**. Ca chống-siết-quá bắt buộc.

**BG-66 ⛔ — `maxStuckMs` đo từ lúc XẾP HÀNG, không đo "kẹt".** Đo được: mục nằm 25h, `attempts=0`, gặp lỗi tạm thời **lần đầu tiên** → dead-letter ngay. Thông điệp tự tố cáo: *"kẹt quá 24.0h (đã thử **1** lượt)"*.
Kịch bản thật: tắt bảo trì cuối tuần → `restoreInspectionWal` khôi phục nguyên `enqueuedAt` từ đĩa → tick đầu sau khởi động gặp **một** lỗi tạm thời → **mọi mục > 24h chết cùng lúc**.
**Sửa:** mốc phải là **lần hỏng đầu tiên** (`lanHongDauMs`), **reset khi thành công**. Mục chưa từng hỏng **không** có đồng hồ chạy.

**BG-67 ⛔ — một tick quét TOÀN hàng đợi.** Đo được: 20.000 mục = **40.000 lời gọi DB / 1 tick**. Trong bộ nhớ 137ms; chi phí thật: `ECONNREFUSED` 12,9ms/lượt ⇒ **518 giây**; DB "hố đen" (`connect_timeout:30`) ⇒ **333 giờ**. Suốt thời gian đó `draining=true` ⇒ mọi lượt rút khác làm **0 việc**.
**Sửa:** trần **quét** riêng (`maxScanPerTick`), tách khỏi `budget` (trần **thao-tác-có-hậu-quả**). Vòng 1 có trần quét nhưng gây đói hàng đuôi; vòng 2 gỡ trần và gây lỗ này. Cần **cả hai**: quét được hết theo lượt (không đói) **và** có trần chi phí mỗi tick.
⚠ Phải trả lời được: *"hàng đợi 20.000 mục, DB hố đen — một tick chạy bao lâu?"*

**Bảy mệnh đề:**
1. `ZodError` · lỗi giải nén · `SyntaxError` ⇒ **vĩnh viễn**.
2. **CHỐNG SIẾT QUÁ:** `ECONNREFUSED`, `08006`, `57P03` ⇒ vẫn **tạm thời**.
3. Mục nằm 25h, hỏng **lần đầu** ⇒ **KHÔNG** dead-letter.
4. Mục hỏng liên tục quá `maxStuckMs` ⇒ dead-letter, thông điệp nói đúng **thời gian KẸT**.
5. Mục hỏng → **thành công** → hỏng lại ⇒ đồng hồ **reset**.
6. 20.000 mục, một tick ⇒ số lời gọi DB **≤ trần quét**, không phải 40.000.
7. **CHỐNG HỒI QUY:** 200 mục toàn lỗi tạm thời, N lượt ⇒ **0 dead-letter**, **0 mục đứng ở `attempts`=0** (đây là mệnh đề vòng 2 vừa đạt — đừng phá).

**Đột biến:** (a) hoàn nguyên phân loại ⇒ mệnh đề 1 đỏ; (b) đổi mốc về `enqueuedAt` ⇒ mệnh đề 3 đỏ; (c) gỡ trần quét ⇒ mệnh đề 6 đỏ.

---

### Task 2 (BG-65 + BG-68) — cửa ZIP nói dối ở hai chỗ

**Files:** `server/routers/aoiPackageRouter.ts`, `server/_core/index.ts` + lưới

**BG-68 ⛔ (NẶNG NHẤT CẢ PHA) — cửa ZIP cuộn từ LỜI KHAI, không từ dữ liệu.**
```
inferAoiOverallResult({ explicitResult, ngCount, ntfCount })
                              ↑ ngCount = metaData.summary?.ng
```
`summary` là **lời khai thứ hai của cùng cái máy**, trong cùng tệp, trong cùng ZIP ⇒ `verdictXauHon(khai, khai)` chỉ bắt được máy **tự mâu thuẫn**. Máy khai **nhất quán sai** (`overallResult:"OK"` + `summary.ng:0` + `measurements[]` có `result:"NG"`) **đi lọt hoàn toàn** — đúng lỗ mà `614245c0` vừa đóng cho v1.x.
⚠ **Cùng file, cách 70 dòng, `calculatedSummary` ĐÃ đếm `measurements.filter(r => r.result === 'NG')`** — nhưng nó chỉ nuôi hook WIP sau commit, **không** nuôi header. Hai con số bất đồng sống cạnh nhau.
**Sửa:** header phải cuộn từ **`measurements[].result` thật**, giống v1.x. Dùng lại `rollupVerdict`/`verdictXauHon`, **đừng viết bản thứ tư**.

**BG-65 ⛔ — trạng thái CUỐI `'dead'` không cuối.**
`server/_core/index.ts:4730-4762` — đường `upload` chỉ ngắn mạch `'committed'` rồi `set({ status: "uploaded" })`. Agent đi lại `presign → upload → commit` là gói chết **sống lại**; cổng `if (status === "dead")` không bao giờ chạm tới. `presign` cũng chỉ có hai nhánh và **mời** Agent thử lại.
⚠ Lưới hiện có gọi thẳng `commit` lặp lại nên **mù hoàn toàn** với đường này — lưới mới phải đi **đúng vòng Agent thật**: `presign → upload → commit`.

**Năm mệnh đề:**
1. Gói khai `OK`, `summary.ng=0`, nhưng `measurements[]` có `NG` ⇒ header ghi **`NG`**. (Hiện: `OK`.)
2. **CHỐNG HỒI QUY:** gói khai `OK`, `summary.ng=0`, `measurements[]` toàn OK ⇒ vẫn **`OK`**.
3. **CHỐNG HỒI QUY:** gói khai `NG` ⇒ vẫn **`NG`**.
4. Gói `'dead'` đi lại **cả vòng** `presign → upload → commit` ⇒ **vẫn `'dead'`**, không sống lại.
5. **CHỐNG HỒI QUY:** gói `'failed'` bình thường vẫn retry được.

⚠ **238 gói `committed`** trong DB test là dữ liệu thật. Nếu bản vá làm gói hợp lệ bị từ chối hoặc đổi verdict — **DỪNG và báo**.

**Đột biến:** (a) hoàn nguyên nguồn cuộn về `summary` ⇒ mệnh đề 1 đỏ; (b) gỡ chốt `'dead'` ở đường upload ⇒ mệnh đề 4 đỏ.

---

### Task 3 (BG-69) — census schema-walk hẹp hơn lời khai, LẦN THỨ BA

**Files:** `server/contracts/capChuoiVarcharScan.ts` + lưới, `server/routers/machineApiRouters.ts`

**Đây là lần thứ BA trong dự án một census hẹp hơn lời khai của nó** (trước đó: census cửa ingest bỏ lọt cửa thứ sáu; census `.max()` cưỡng chế BẢNG thay vì SCHEMA).

Đo được: census soi đúng **2** schema (`machineDataContractV2`, `metaJsonSchema`). **Đường ingest MẶC ĐỊNH không nằm trong đó.** `submitInspectionCoreObject` đã được `export` với chú thích *"chỉ để census schema-walk soi được"* — nhưng **0 file import nó**. Sau bản vá 9 trường, nó còn **20 lá chuỗi không `.max()`**, trong đó **3 lá chạm cột thật**:
- `measurements[].pointId` / `pointCode` → `measurement_point_defs.code varchar(50)` + `.name varchar(255)` (qua `measurementPointResolver`, `autoCreate:true`)
- `measurements[].measuredValue` → `measurement_results.measuredValueText varchar(255)`
- `presign.inspectionId` → `inspection_packages.packageId varchar(100)` — lỗ `22001` ở bước **TRƯỚC** `metaJsonSchema`

Walker còn **mù im lặng** với `ZodDefault`, `ZodPipe`/`.transform()`, `ZodRecord`, `ZodDiscriminatedUnion`, `ZodTuple`, `ZodIntersection` (nhánh cuối `return []`).

**Bốn mệnh đề:**
1. Census soi **mọi** schema ghi vào `varchar`, không chỉ 2. Nêu rõ danh sách và **vì sao đủ**.
2. 20 lá chuỗi của `submitInspectionCoreObject` + `presign.input` có `.max()` khớp cột (3 lá chạm cột thật phải khớp **đo được**).
3. **CA BIÊN:** độ dài đúng bằng sức chứa ⇒ **HỢP LỆ**.
4. Walker gặp nhánh **chưa hỗ trợ** ⇒ **BÁO ĐỘNG (throw/đỏ)**, KHÔNG `return []` im lặng. Một walker im lặng bỏ qua là một census **xanh giả**.

**Đột biến:** (a) thêm trường chuỗi mới không `.max()` vào **bất kỳ** schema nào ⇒ census ĐỎ nêu đúng tên, **không** phải sửa bảng; (b) bọc một trường trong `.transform()` ⇒ census phải **BÁO ĐỘNG**, không im lặng bỏ qua.

---

## Cổng ra Pha 1E

- [ ] `ZodError`/lỗi giải nén/`SyntaxError` ⇒ vĩnh viễn; lỗi kết nối ⇒ vẫn tạm thời.
- [ ] Mục nằm 25h hỏng **lần đầu** ⇒ không dead-letter; hỏng→thành công→hỏng ⇒ đồng hồ reset.
- [ ] 20.000 mục, một tick ⇒ số lời gọi DB **≤ trần quét**; và 200 mục lỗi tạm thời ⇒ **0 dead-letter, 0 mục chưa thử**.
- [ ] Gói ZIP khai `OK` + `summary.ng=0` + `measurements[]` có NG ⇒ header **`NG`**.
- [ ] Gói `'dead'` đi **cả vòng** `presign → upload → commit` ⇒ vẫn `'dead'`.
- [ ] Census soi **mọi** schema ghi `varchar`; walker gặp nhánh lạ ⇒ **báo động**, không im lặng.
- [ ] `npm run check` sạch · hai cổng Pha 0 xanh · **238 gói `committed` không đổi**.

**Còn mở sau Pha 1E:** BG-70…BG-75 (★★) · BG-36 (dead-letter chưa có giao diện — **nâng mức** vì C-3 làm tốc độ nạp tăng) · BG-5,6,12,15,16,19,29,30,32,33,38,44,45,46,47,53…63 · §6 giao thức version · §3.6 dọn mồ côi · join gói ảnh · **Khối B** + BG-39 giai đoạn 2.
