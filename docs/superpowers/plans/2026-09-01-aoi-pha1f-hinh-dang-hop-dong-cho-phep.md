# Pha 1F — Nghiệm thu theo HÌNH DẠNG HỢP ĐỒNG CHO PHÉP

> **Cho người thực thi:** dùng skill `superpowers:subagent-driven-development`. Các bước dùng checkbox `- [ ]`.

**Mục tiêu:** Đóng ba mục ⛔ từ review lượt 6, **và** dựng cổng chặn **lớp lỗi sinh ra chúng**.

**Spec:** `2026-08-24-aoi-5-cap-xuong-song-design.md` §13 · **Backlog toàn cảnh:** `2026-08-31-aoi-backlog-toan-canh.md`

---

## Vì sao pha này tồn tại — một câu

Sáu lượt review toàn nhánh, sáu lần tìm ra Critical. Lượt 6 tổng hợp được gốc rễ chung:

> **Mỗi lần đổi phân loại (nguồn verdict, độ vĩnh viễn của lỗi), phép nghiệm thu chạy trên những HÌNH DẠNG CÓ TRONG DB TEST, không chạy trên những hình dạng HỢP ĐỒNG CHO PHÉP.**

Bằng chứng:
- **254/254** gói trong DB test đều có `result` đầy đủ ⇒ lỗi "lá thiếu `result` bị tính NTF" **vô hình**.
- **Mẫu meta.json của máy thật** không nằm trong bộ nghiệm thu cửa ZIP ⇒ lỗi "gói máy thật chết `'dead'`" **vô hình**.

Đây là **L-4 (phạm vi đo sai) ở tầng sâu hơn**: không phải *"đo dev rồi khai cho test"*, mà **_"đo cái ĐANG CÓ rồi khai cho cái ĐƯỢC PHÉP CÓ"_**.

⇒ Task 4 dựng **cổng theo hình dạng** — nó chặn **cỗ máy sinh ra** lớp lỗi này, không chỉ ba thể hiện hôm nay.

---

## Global Constraints

- **Mã, chú thích, tên test, thông điệp lỗi: TIẾNG VIỆT.**
- **KHÔNG đổi mặc định** `INSPECTION_STORE_FORWARD_ENABLED`, `INGEST_REJECT_LEGACY_MACHINE_ENABLED`.
- **Nghiệm thu DB bằng vai `avi_app`**, KHÔNG phải `aoi`. ⚠ `avi_app` **KHÔNG có DELETE** trên `product_inspections` (**WORM**) — nói rõ để lại bao nhiêu hàng; **đừng** viết `DELETE … .catch(() => {})`.
- ⚠ `data/inspection-store-forward*.jsonl` là **tệp THẬT** (dead-letter **101 mục**, 6 tuần không ai đọc) — **đừng ghi vào**; dùng `INSPECTION_STORE_FORWARD_FILE` trỏ tệp tạm.
- **Mọi lưới phải chứng minh ĐỎ ĐƯỢC.** ⚠ **Hoàn tác đột biến và chứng minh** (`git status --short` sạch).
- ⚠ **NHỚ COMMIT.** Đã **ba lần** công việc suýt mất vì báo "XONG" mà không commit.
- **Câu hỏi bắt buộc trong mọi báo cáo:** *"bản vá này chuyển thứ gì từ lớp nào sang lớp nào, và ai đang phụ thuộc vào phân lớp cũ?"* — ba task Pha 1E, hai lần **tự bắt được một lỗ** nhờ nó.
- Hai cổng Pha 0 xanh (3/3, 4/4). `npm run check` sạch.
- Cây làm việc **dùng chung** với tiến trình song song (`client/src/**`, `knowledge/**`, `server/services/aiLocalTools/**`, `vscode-extension/**`) — **đừng đụng**.

---

### Task 1 (BG-78 ⛔) — bo TỐT bị ghi NTF vào bảng WORM

**File:** `server/routers/aoiPackageRouter.ts:850` + lưới

```js
ntf: normalizedMeasurements.filter((p) => !p.result || p.result === "NTF").length,
//                                        ^^^^^^^^^^ lá KHÔNG khai result → tính là NTF
```
`result` là **`.optional()`** ở cả hai nhánh (`measurements[]` và `points[]`), cột đích `package_images.result` **NULLABLE** ⇒ manifest ảnh không kèm phán quyết từng điểm là hình dạng **HỢP LỆ, ĐƯỢC HỖ TRỢ**.

Đo được (2 lá không khai `result`): công thức hiện tại `ntf=2` ⇒ **verdict NTF**; đúng phải `ntf=0` ⇒ `OK`. Review đo LIVE qua commit thật: `product_inspections.overallResult = NTF`, `originalResult = NG`.
⇒ Bo tốt vào **hàng đợi xác nhận NTF** như lỗi giả, trong bảng **WORM không xoá được**.

**Sửa:** bỏ `!p.result ||`. **Lá không khai `result` KHÔNG được sinh ra một phán quyết.**
⚠ `calculatedSummary.ntf` (`:1093`) mang **cùng biểu thức sai** nhưng có TRƯỚC Pha 1E và chỉ nuôi cột báo cáo. **Sửa cả hai** — và khi hợp nhất theo BG-76 **đừng chép cái đang sai**.

**Bốn mệnh đề (đo bằng `SELECT` sau commit thật):**
1. Lá **không khai** `result`, `overallResult:"OK"` ⇒ header **`OK`**. (Hiện: `NTF`.)
2. Lá khai `NTF` thật ⇒ vẫn **`NTF`** (chống-siết-ngược).
3. Lá khai `NG` ⇒ **`NG`**.
4. `calculatedSummary.ntf` khớp `overallResult` — không còn hai cột bất đồng.

**Đột biến:** hoàn nguyên `!p.result ||` ⇒ mệnh đề 1 đỏ.

---

### Task 2 (BG-73 + BG-72 ⛔) — hai hồi quy đã phát hành

**BG-73 ⛔ — gói máy THẬT chết `'dead'`, không lối về.**
`metaJsonSchema` bắt buộc `measurements`; mẫu `D:\SOURCES\AOIData\aoipackage-meta-sample.json` mang `images[]` ⇒ `safeParse = false`.
Chuỗi ba mắt xích đo được: `ZodError` → **vĩnh viễn** (T1) → đếm (`commit` dùng chính vị từ đó) → **`'dead'` sau 5 lượt** → `presign`/`commit`/`upload` **đều khoá** (T2).
**TRƯỚC Pha 1E:** `'failed'`, retry vô hạn — sửa schema máy chủ xong là commit lại được hết.
**SAU:** chết sau 5 lượt, **không có đường về từ phía máy chủ**.

**Chọn MỘT trong ba hướng, nêu lý do:**
- (a) `metaJsonSchema` **nhận hình dạng thật** của máy (đúng gốc rễ nhất, nhưng đổi hợp đồng);
- (b) `ZodError` ở cửa ZIP **không đếm** vào ngưỡng `'dead'` (lỗi hợp đồng ≠ lỗi hạ tầng);
- (c) có **tuyến hồi sinh** `'dead'` cho vận hành.
⚠ Dù chọn gì, phải trả lời: *"gói đã `'dead'` vì lý do sai — vận hành lấy lại bằng cách nào?"*

**BG-72 ⛔ — `.max(40)` từ chối chuỗi `new Date()` VẪN nhận.**
Đo được trên đường **v1.x — đường bận nhất**:
```
len=50  newDate=true  zodSauT3=false   «Sun Aug 30 2026 14:26:51 GMT+0700 (Indochina Time)»
len=45  newDate=true  zodSauT3=false   «Sunday, August 30, 2026 12:00:00 PM GMT+07:00»
len=33  newDate=true  zodSauT3=true
```
Trước T3 cả hai **được nhận và ghi**. Cột đích là `timestamp` ⇒ **không có rủi ro `22001` nào để đóng**. Và chú thích tại chỗ khẳng định ngược: *"không siết hơn HÀNH VI hôm nay"*.
**Sửa:** hoàn nguyên hoặc nới lên ≥64, và **sửa chú thích cho đúng sự thật**.

**Mệnh đề:** gói máy thật commit được (hoặc có tuyến hồi sinh rõ ràng) · `DateTime.ToString()` 50 và 45 ký tự **được nhận** · chống hồi quy: chuỗi thật sự quá cỡ cho cột `varchar` vẫn bị từ chối.

---

### Task 3 (BG-79 + BG-80) — hai lỗ trong chính lưới canh

**BG-79 — walker "hết mù im lặng" CÒN mù đúng lớp đó.** Đo:
```
union[number, object{beTrong:string}]   → throw? FALSE | lá tìm được: []  ← MÙ
array<union[number, object{…}]>          → throw? FALSE | lá tìm được: []  ← MÙ
record / any / unknown                   → THROW ✓
```
Chú thích biện minh *"không có schema nào hôm nay có union chứa object"* — **lập luận "hôm nay chưa có"**, đúng thứ đã hỏng **ba lần**. **Sửa: đệ quy MỌI nhánh union.**

**BG-80 — "biên tựa vào census cửa ingest" là LỜI VĂN, không phải liên kết mã.**
`capChuoiVarcharDuongIngestMacDinh.test.ts` **không import gì** từ `cuaIngestScan.ts`; `laTenCuaIngest` **không được export**. `DANH_SACH_SCHEMA_INGEST` là **danh sách viết tay** + `expect(length).toBe(6)` — đúng thứ báo cáo khai là đã tránh.
Và **không lưới nào buộc cửa ↔ schema**: census duyệt `submitInspectionCoreObject` trong khi thủ tục đăng ký `submitInspectionRouterInputSchema` — một `.extend()` viết thẳng ở `.input()` sẽ **vô hình**.
**Sửa:** export vị từ, **nối bằng mã**, và thêm lưới buộc **mỗi cửa ↔ schema thật nó đăng ký**. Nếu không nối được rẻ, **sửa lời khai** thay vì để nó đứng.

---

### Task 4 (⭐ TRỌNG TÂM) — cổng theo **HÌNH DẠNG HỢP ĐỒNG CHO PHÉP**

Ba task trên vá **ba thể hiện**. Task này chặn **cỗ máy sinh ra chúng**.

**Dựng một lưới liệt kê các hình dạng mà SCHEMA THỪA NHẬN**, rồi chạy đường **verdict + phân loại lỗi** trên chúng:
- mọi trường `.optional()` **VẮNG MẶT** (đây là C-1: `result` vắng);
- bí danh cũ (`points[]` thay `measurements[]`);
- **mẫu meta.json của máy THẬT** (đây là C-2);
- các định dạng thời gian mà `new Date()` nhận (đây là BG-72);
- mảng **rỗng** ở mọi cấp (`surfaces:[]`, `components:[]`, `measurements:[]`).

**Ba mệnh đề:**
1. Với **mỗi** hình dạng, verdict ghi ra **khớp kỳ vọng ghi rõ** — không hình dạng nào cho verdict "tình cờ đúng vì dữ liệu test may mắn".
2. Với **mỗi** hình dạng, lỗi (nếu có) được phân **đúng lớp** vĩnh viễn/tạm thời.
3. **CHỐNG TỰ THOẢ:** lưới khẳng định nó sinh ra **≥N hình dạng** và **≥1 hình dạng KHÔNG có trong DB test** — nếu bộ sinh hỏng và trả 0, mọi khẳng định tự thoả.

⚠ **Đây là chỗ dễ viết lưới xanh giả nhất cả pha.** Một lưới chỉ liệt kê hình dạng rồi `expect(parse).toBeDefined()` **không đo gì**. Mỗi hình dạng phải có **kỳ vọng verdict ghi rõ**, và ít nhất một hình dạng phải **đỏ được** khi hoàn nguyên bản vá của Task 1/2.

**Đột biến:** hoàn nguyên Task 1 ⇒ cổng này phải **ĐỎ** — chứng minh nó bắt được lớp lỗi, không chỉ ca cụ thể.

---

## Cổng ra Pha 1F

- [ ] Lá không khai `result` ⇒ header **`OK`** (đo bằng `SELECT`); `calculatedSummary` khớp.
- [ ] Gói meta.json **máy thật** commit được, hoặc có **tuyến hồi sinh** ghi rõ.
- [ ] `DateTime.ToString()` 50 và 45 ký tự **được nhận** trên đường v1.x.
- [ ] Walker **đệ quy mọi nhánh union**; union chứa object **không còn mù**.
- [ ] Hai census **nối bằng mã**, hoặc lời khai "tựa vào nhau" **đã sửa cho đúng**.
- [ ] Cổng hình-dạng chạy ≥N hình dạng, có ≥1 hình dạng **không có trong DB test**, và **ĐỎ** khi hoàn nguyên Task 1.
- [ ] `npm run check` sạch · hai cổng Pha 0 xanh · **250 gói `committed` không đổi**.

**Còn mở sau Pha 1F:** BG-81/BG-61 (trần **thời gian** mỗi tick — đo được **16,7 giờ** ở kịch bản hố đen) · BG-36 · BG-70/71/74/75/76/77 · BG-53/54/55/57 · nhóm ★ · **Khối B** + BG-39 gđ2.
