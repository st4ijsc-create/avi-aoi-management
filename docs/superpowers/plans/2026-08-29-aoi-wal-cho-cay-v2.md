# WAL cho payload cây v2.0 — đường v2.0 hết mất trắng bo (BG-25)

> **Cho người thực thi:** dùng skill `superpowers:subagent-driven-development`. Các bước dùng checkbox `- [ ]`.

**Mục tiêu:** Đường ingest v2.0 hiện **mất trắng bo** khi DB chớp nháy. Nối nó vào cơ chế store-and-forward WAL **đã có sẵn và đã chín**, không dựng cơ chế thứ hai.

**Kiến trúc:** `server/services/inspection/inspectionStoreForward.ts` đã có WAL đĩa (JSONL + gương bộ nhớ), khử trùng, giới hạn, dead-letter, và điểm tiêm `setProcessFn`/`setDedupFn`. Đường v1.x đã nối. Đường v2.0 **chưa**. Việc của pha này là nối — và xử lý đúng **một chỗ khoá khử trùng không dùng lại được**.

**Spec:** `docs/superpowers/specs/2026-08-24-aoi-5-cap-xuong-song-design.md` §13 — BG-25.

---

## Global Constraints

- **Mã, chú thích, tên test, thông điệp lỗi: TIẾNG VIỆT.**
- **Cờ mặc định giữ nguyên trạng thái hiện tại.** `INSPECTION_STORE_FORWARD_ENABLED` (có dự phòng `OT_STORE_FORWARD_ENABLED`) — **không đổi mặc định**. Với cờ TẮT, mọi điểm vào là **no-op**, hành vi y hệt hôm nay (ném lỗi khi DB hỏng). Đây là cam kết "HONESTY" đã ghi trong docblock của module; giữ đúng.
- **KHÔNG đổi mặc định** `INGEST_REJECT_LEGACY_MACHINE_ENABLED` (giữ TẮT).
- ⚠ `avi_app` **KHÔNG có DELETE** trên `product_inspections` (WORM) ⇒ không dọn được bo test. **Đừng** viết `DELETE … .catch(() => {})` — đã đo **32 file test** làm thế và tất cả là **no-op câm** (Đ-18).
- Nghiệm thu DB bằng vai `avi_app`, KHÔNG phải `aoi`.
- **Mọi lưới phải chứng minh ĐỎ ĐƯỢC** bằng đột biến đã chạy thật. ⚠ **Hoàn tác và chứng minh** — `git status --short` sạch. Trong phiên trước một agent chết giữa chừng và để lại đột biến trong cây.
- ⚠ **NHỚ COMMIT.** Đã **ba lần** trong dự án công việc suýt mất vì báo "XONG" mà không commit.
- Hai cổng Pha 0 xanh sau mỗi task: `server/utils/kpiCongThucCensus.test.ts` (3), `server/db/khongBomInspectionBia.test.ts` (4).
- Cây làm việc **dùng chung** với tiến trình song song sửa `client/src/**`, `knowledge/**` — đừng đụng.

---

## Quyết định thiết kế — đọc trước

### QĐ-WAL-A — khoá gửi của v2.0 **KHÔNG dùng lại** công thức v1

`computeSubmissionKey` (`inspectionStoreForward.ts:195`) băm từ:
```
machine-identity | serialNumber | inspectionTime | overallResult | measurementCount
```
Với payload v2.0 thì **hai thành phần mất tác dụng**:
- `serialNumber` **rỗng là hợp lệ** (tài liệu máy: *"rỗng nếu máy chưa gửi"* — xem §13 Đ-23),
- `measurementCount` = **0**, vì đường v2.0 chưa ghi cấp component (§13 Đ-19).

⇒ Hai bo v2.0 khác nhau, cùng trạm, cùng `inspectionTime`, đều serial rỗng ⇒ **TRÙNG KHOÁ** ⇒ WAL sẽ **nuốt bo thứ hai** và coi là bản sao. Đó là mất dữ liệu **do chính cơ chế chống mất dữ liệu**.

**Chốt:** payload v2.0 dùng `dungKhoaKhuTrungV2()` (`machineApiRouters.ts`, đã có từ Pha 1C Task 2) làm khoá gửi. Khoá đó dựng từ `identity` (7 trường **bắt buộc**) + `productId` + `startedAt`, **không phụ thuộc serial**, đã được chứng minh tất định và không đụng độ ranh giới trường.

`computeSubmissionKey` **giữ nguyên** cho v1.x. Hai họ payload, hai công thức khoá, **một** hàm điều phối chọn đúng công thức theo hình dạng.

### QĐ-WAL-B — phát lại phải đi qua ĐÚNG đường của nó

Đường v1.x phát lại qua `processInspectionSubmission`. Đường v2.0 phải phát lại qua chính chuỗi của nó: `dichCayKetQua` → `persistInspectionAtomic({cay})`. **Không** ép payload cây vào đường v1 — hình dạng khác nhau, và làm vậy sẽ mất cả ba cấp cây.

### QĐ-WAL-C — "ACK có điều kiện" phải nói thật với máy

Khi buffer thành công, máy nhận `{ success:true, queued:true, submissionId }`. Trường `queued:true` **bắt buộc có** — máy phải phân biệt được "đã ghi vào DB" với "đã nhận, sẽ ghi sau". Nếu ta ACK `success:true` mà giấu `queued`, máy sẽ tin bo đã an toàn trong khi nó mới nằm trên đĩa của server.

---

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `server/services/inspection/inspectionStoreForward.ts` (sửa) | nhận hai họ khoá; điều phối theo hình dạng | T1 |
| `server/routers/machineApiRouters.ts` (sửa) | bọc `submitInspectionTreeV2` bằng buffer-khi-lỗi-tạm-thời | T1 |
| `server/services/inspection/walCayV2.test.ts` (mới) | lưới đơn vị: khoá, buffer, ranh giới lỗi tạm/vĩnh viễn | T1 |
| `server/routers/machineApiRouters.ts` (sửa) | nối `setProcessFn` cho nhánh v2.0 | T2 |
| `server/db/walCayV2PhatLai.db.test.ts` (mới) | lưới DB THẬT: DB hỏng → phát lại → bo vào **đúng một lần** | T2 |
| `server/services/inspection/walDuongVaoCensus.test.ts` (mới) | census: mọi đường ingest ghi-DB đều có WAL hoặc miễn trừ **có ký lý do** | T3 |

---

### Task 1: Khoá gửi cho v2.0 + buffer khi lỗi tạm thời

**Interfaces:**
- Consumes: `dungKhoaKhuTrungV2(payload)`, `laHinhDangCayV2(raw)`, `computeSubmissionKey`, `inspectionStoreForwardEnabled()`, `isPermanentSubmitError()`
- Produces: hàm điều phối khoá (đặt tên tiếng Việt, xuất khẩu để T2/T3 dùng)

- [ ] **Bước 1: Viết ca thất bại** — bốn mệnh đề:
1. **Hai bo v2.0 KHÁC NHAU, cùng trạm, cùng `inspectionTime`, cả hai serial RỖNG ⇒ HAI khoá khác nhau.** Đây là mệnh đề trung tâm; với công thức v1 chúng **trùng khoá**. Hãy viết ca này **trước** và chạy nó với công thức v1 để **thấy nó đỏ** — đó là bằng chứng lỗ có thật, không phải suy đoán.
2. Cùng một payload v2.0 ⇒ **cùng** khoá (tất định).
3. Payload v1.x vẫn dùng `computeSubmissionKey` — **chống hồi quy**, không đổi hành vi đường cũ.
4. Điều phối chọn công thức **theo hình dạng** (`laHinhDangCayV2`), không theo `schemaVersion` (trường đó `optional()`, máy có thể không gửi).

- [ ] **Bước 2: Chạy thấy ĐỎ.** Chép nguyên văn — đặc biệt mệnh đề 1.

- [ ] **Bước 3: Cài đặt** hàm điều phối khoá + bọc `submitInspectionTreeV2`: khi lỗi **tạm thời** (dùng `isPermanentSubmitError()` để phân biệt — **không** tự chế cách phân loại mới), buffer vào WAL và trả `{ success:true, queued:true, submissionId }`.
  ⚠ Lỗi **vĩnh viễn** (xác thực, hợp đồng) **phải ném như cũ** — buffer chúng là làm nghẽn hàng đợi bằng payload không bao giờ ghi được.

- [ ] **Bước 4: Chạy thấy XANH.**

- [ ] **Bước 5: Đột biến BẮT BUỘC.** Đổi điều phối để v2.0 dùng `computeSubmissionKey` ⇒ mệnh đề 1 phải **ĐỎ**. Chép nguyên văn. Hoàn tác, xác nhận `git diff` rỗng.

- [ ] **Bước 6: Cổng + commit.**

---

### Task 2: Phát lại đúng đường + chứng minh ĐÚNG MỘT LẦN

- [ ] Nối nhánh v2.0 vào `setProcessFn` sao cho phát lại đi qua `dichCayKetQua` → `persistInspectionAtomic({cay})`, **không** ép vào đường v1.
- [ ] **Lưới DB THẬT** (không mock `../db`), bốn mệnh đề:
  1. DB lỗi tạm thời ⇒ máy nhận `queued:true`, **0 bo** trong DB.
  2. DB hồi phục + phát lại ⇒ **đúng 1 bo**, đủ **ba cấp cây**.
  3. **Máy gửi lại trong lúc đang xếp hàng** ⇒ vẫn **đúng 1 bo** (khử trùng hàng đợi).
  4. **Payload cũng đã vào live rồi mới phát lại** ⇒ vẫn **đúng 1 bo** (ledger + kiểm tồn tại).
- [ ] Mệnh đề 3 và 4 là hai đường đôi khác nhau — **đừng gộp**; chúng hỏng theo hai cách khác nhau.
- [ ] Đột biến: bỏ phép kiểm ledger ⇒ mệnh đề 4 phải ĐỎ.
- [ ] Nói rõ trong báo cáo: để lại bao nhiêu hàng WORM.

---

### Task 3: Census — mọi đường ingest ghi-DB đều có WAL hoặc miễn trừ có ký lý do

- [ ] Pha 1C đã dựng census cửa ingest (`server/routers/cuaIngestScan.ts`) bằng **TypeScript compiler API**. **Tái dùng khuôn đó**, đừng viết bộ quét thứ hai.
- [ ] Mệnh đề: mọi thủ tục **ghi vào `product_inspections`** phải hoặc đi qua WAL, hoặc có tên trong bảng miễn trừ **kèm lý do viết ra**.
- [ ] **Ca chống-tự-thoả bắt buộc:** census phải khẳng định nó **tìm thấy ≥2 đường** (v1.x và v2.0). Bộ quét hỏng trả 0 đường ⇒ mọi khẳng định "đều có WAL" **tự thoả**.
- [ ] Đột biến: thêm một đường ghi giả **không WAL** ⇒ census phải **ĐỎ và nêu tên**. Và **phản-đột-biến**: đường giả **có** WAL ⇒ census **không** báo nhầm.
- [ ] ⚠ Biết trần của cách này: census tìm theo **quy ước đặt tên** (BG-34), không phải bất biến tầng kiểu. **Ghi trần đó vào docblock**, đừng để người sau tin nó kín hơn thực tế.

---

## Cổng ra

- [ ] Hai bo v2.0 khác nhau, cùng trạm/thời điểm, serial rỗng ⇒ **hai** khoá (với công thức v1 là **một** — chứng minh bằng đột biến đã chạy).
- [ ] DB lỗi tạm thời ⇒ `queued:true`, 0 bo; hồi phục + phát lại ⇒ **đúng 1 bo**, đủ ba cấp cây.
- [ ] Gửi lại lúc đang xếp hàng ⇒ **1 bo**. Đã vào live rồi mới phát lại ⇒ **1 bo**.
- [ ] Lỗi **vĩnh viễn** (xác thực/hợp đồng) vẫn **ném như cũ**, không vào hàng đợi.
- [ ] **Cờ TẮT ⇒ hành vi y hệt hôm nay** (ném khi DB hỏng) — chống hồi quy.
- [ ] Census xanh; đột biến đường-giả ĐỎ nêu đúng tên; phản-đột-biến không báo nhầm.
- [ ] `npm run check` sạch · hai cổng Pha 0 xanh (3/3, 4/4).

**Còn mở sau pha này** (không được im): Đ-24 · BG-5,6,12,15,16,19,27,29,30,32,33,34,36 · §6 giao thức version · §3.6 dọn mồ côi · join gói ảnh theo `captureId` · và **Khối B** (mở khoá cấp component — §13 Đ-19).
