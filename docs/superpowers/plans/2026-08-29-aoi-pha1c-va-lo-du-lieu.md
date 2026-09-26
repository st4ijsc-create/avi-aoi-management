# Pha 1C — Vá bốn lỗ dữ liệu đang SỐNG trên đường v2.0

> **Cho người thực thi:** dùng skill `superpowers:subagent-driven-development`. Các bước dùng cú pháp checkbox `- [ ]`.

**Mục tiêu:** Đóng **4 Critical** mà review toàn nhánh Pha 1B tìm ra. Cả bốn **đang sống** — không chờ cờ nào, không chờ pha nào. Máy đầu tiên nâng firmware lên payload cây kích hoạt tất cả.

**Kiến trúc:** Pha 1B nối được đường v2.0 nhưng để lại bốn lỗ ở chỗ các task **ghép** vào nhau. Pha 1C không thêm tính năng — nó **vá**, và mỗi bản vá phải kèm một lưới chứng minh lỗ đã đóng bằng **hành vi đo được**, không bằng lời khai.

**Công nghệ:** TypeScript, Drizzle ORM, PostgreSQL 16 + TimescaleDB, zod, vitest, tRPC.

**Spec:** `docs/superpowers/specs/2026-08-24-aoi-5-cap-xuong-song-design.md` — §13, đặc biệt **Đ-19…Đ-24** và bảng **BG-21…BG-33**.

---

## Global Constraints

- **Mã, chú thích, tên test, thông điệp lỗi: TIẾNG VIỆT.**
- **Nghiệm thu DB bằng vai `avi_app`**, KHÔNG phải `aoi` (superuser + BYPASSRLS ⇒ đo bằng nó thì xanh giả). Migration nào cũng phải tái dùng **cầu chì** của `scripts/apply-migration-0338.mjs:74-84`.
- ⚠ `avi_app` **KHÔNG có DELETE** trên `product_inspections` (WORM) ⇒ **không dọn được** bo test đã chèn. Đừng viết `DELETE … .catch(() => {})` — đã đo **32 file test** làm đúng thế và tất cả là **no-op câm** (Đ-18).
- **Mọi lưới phải chứng minh ĐỎ ĐƯỢC** bằng đột biến đã chạy thật, kèm nguyên văn output. ⚠ **Hoàn tác đột biến và chứng minh đã hoàn tác** (`git status --short` sạch) — trong phiên trước một agent chết giữa chừng và để lại đột biến trong cây; mã hỏng trông y hệt mã thật.
- Cây làm việc **dùng chung** với một tiến trình song song sửa `client/src/**` và `knowledge/**` — đừng đụng, đừng add.
- Hai cổng Pha 0 phải xanh sau mỗi task: `server/utils/kpiCongThucCensus.test.ts` (3), `server/db/khongBomInspectionBia.test.ts` (4).
- **KHÔNG đổi mặc định** `INGEST_REJECT_LEGACY_MACHINE_ENABLED` (giữ TẮT).

---

## Quyết định thiết kế — đọc trước, mọi task phụ thuộc

### QĐ-1C-A — một bản vá đóng CẢ BG-22 lẫn BG-24: **verdict lưu trữ = XẤU NHẤT của (khai, cuộn)**

Hai lỗ trông khác nhau nhưng cùng một gốc: **verdict lưu trữ hiện chỉ đọc kết quả cuộn-từ-lá, bỏ rơi lời khai cấp bo của máy.**

- **Đ-21**: máy khai `NG`, cây rỗng ⇒ cuộn ra `OK` ⇒ ghi `OK`. **Hạ cấp.**
- **Đ-22**: máy khai `ntf:true` cấp bo, không lá nào ntf ⇒ cuộn ra `ntf:false` ⇒ ghi `OK`. **Mất NTF.**

**Chốt:** đưa hai tín hiệu về cùng một bảng chữ cái rồi lấy **cái xấu hơn**.

```
mucDoNghiemTrong:  OK(0) < NTF(1) < NG(2)

khai  = verdictLuuTru({ result: payload.overallResult, ntf: payload.ntf })   ← BG-24: dùng payload.ntf
cuon  = verdictLuuTru({ result: cuộn.result,           ntf: cuộn.ntf       })
verdictLuuTru cuối = cái có mucDoNghiemTrong LỚN HƠN                          ← BG-22: không bao giờ hạ cấp
```

**Vì sao "xấu nhất" chứ không phải "khai thắng":** nếu máy khai `OK` mà cây có một component `NG`, ta **phải** ghi `NG` — đó chính là công dụng của phép cuộn, và Pha 1B làm đúng. Ngược lại nếu máy khai `NG` mà cây rỗng, ta **phải** giữ `NG` — máy biết thứ nó không gửi lên. Lấy cái xấu hơn thoả **cả hai chiều** bằng một luật.

**Đối chiếu v1.x xác nhận hướng này:** `promoteOverallToNg` chỉ **NÂNG** OK→NG, `UPDATE` kèm `WHERE overallResult='OK'`. Lịch sử 42.431 bo: `NG→OK` = **0**. Đường v2.0 phải giữ đúng bất biến đó.

`declaredMismatch` **ở gốc** = `khai !== cuon`. `CayDaDich` hiện **chưa có** trường này — phải thêm.

### QĐ-1C-B — serial rỗng (Đ-23): đóng bằng **CƠ CHẾ**, không bằng chữ

Ba đường đều sai:
- Siết lại `.min(1)` trong hợp đồng ⇒ **chặn bo thật** mà máy chưa quét serial (tài liệu máy: *"rỗng nếu máy chưa gửi"*).
- Dựa vào lưới regex ⇒ đã chứng minh **xanh giả** vì soi nhầm nhánh.
- Để nguyên ⇒ **3 lượt retry = 3 bo**.

**Chốt:** đường v2.0 **luôn đặt `idempotencyKey`**, không phụ thuộc serial. Khoá dựng từ thứ máy **chắc chắn có**: `identity` (7 trường bắt buộc) + `productId` + `startedAt`. Serial rỗng khi đó vẫn khử trùng được, và serial có thì hai cơ chế chồng lên nhau — vô hại.

### QĐ-1C-C — thứ tự

`BG-22+BG-24` (một bản vá, thuần hàm) → `BG-23` (khử trùng) → `BG-21+BG-31` (gác **năm** cửa) → `BG-26` (nghiệm thu thật) → `BG-28` (luật integrityScan).
**BG-25 (WAL) tách sang kế hoạch riêng** — nó là tính năng, không phải bản vá, và đủ lớn để có kế hoạch của nó.

---

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `shared/rollupVerdict.ts` (sửa) | thêm `mucDoNghiemTrong()` + `verdictXauHon()` — thuần, 0 import | T1 |
| `server/services/ingestCayKetQua.ts` (sửa) | dùng luật xấu-nhất; thêm `declaredMismatch` gốc | T1 |
| `server/routers/machineApiRouters.ts` (sửa) | đặt `idempotencyKey` cho v2.0; gác 5 cửa | T2, T3 |
| `server/db/ingestV2KhuTrung.db.test.ts` (mới) | lưới DB THẬT: serial rỗng vẫn khử trùng | T2 |
| `server/routers/cuaIngestCensus.test.ts` (mới) | census: **mọi** cửa ingest phải gác | T3 |
| `server/db/ingestV2XuyenSuot.db.test.ts` (mới) | nghiệm thu end-to-end, **không mock `../db`** | T4 |
| `server/services/integrityScanService.ts` (sửa) | luật "header không có dòng đo" | T5 |

---

### Task 1: Verdict lưu trữ = XẤU NHẤT của (khai, cuộn) — đóng BG-22 ⛔ + BG-24 ⛔

**Files:**
- Modify: `shared/rollupVerdict.ts`, `shared/rollupVerdict.test.ts`, `server/services/ingestCayKetQua.ts`, `server/services/ingestCayKetQua.test.ts`

**Interfaces:**
- Produces: `export function verdictXauHon(a: ResultVerdict, b: ResultVerdict): ResultVerdict`; `CayDaDich` thêm `declaredMismatch: boolean` ở gốc. T2-T4 dùng.

- [ ] **Bước 1: Viết ca thất bại trong `shared/rollupVerdict.test.ts`**

```typescript
describe("verdictXauHon — không bao giờ hạ cấp phán quyết", () => {
  it("thứ tự nghiêm trọng: OK < NTF < NG", () => {
    expect(verdictXauHon("OK", "NTF")).toBe("NTF");
    expect(verdictXauHon("NTF", "NG")).toBe("NG");
    expect(verdictXauHon("OK", "NG")).toBe("NG");
  });

  it("đối xứng — thứ tự đối số không đổi kết quả", () => {
    for (const a of ["OK", "NG", "NTF"] as const)
      for (const b of ["OK", "NG", "NTF"] as const)
        expect(verdictXauHon(a, b)).toBe(verdictXauHon(b, a));
  });

  it("luỹ đẳng — cùng giá trị trả về chính nó", () => {
    for (const v of ["OK", "NG", "NTF"] as const) expect(verdictXauHon(v, v)).toBe(v);
  });
});
```

- [ ] **Bước 2: Chạy thấy ĐỎ.** `npx vitest run shared/rollupVerdict.test.ts` — `verdictXauHon is not a function`.

- [ ] **Bước 3: Cài đặt trong `shared/rollupVerdict.ts`** (giữ file **0 import**)

```typescript
/**
 * Mức độ nghiêm trọng để so hai phán quyết. NG xấu nhất, OK tốt nhất.
 * NTF ở giữa: bo không lỗi thật, nhưng đã bị máy/người đánh dấu nghi ngờ.
 */
const MUC_DO_NGHIEM_TRONG: Record<ResultVerdict, number> = { OK: 0, NTF: 1, NG: 2 };

/**
 * Trả về phán quyết XẤU HƠN trong hai cái.
 *
 * Dùng để hợp nhất LỜI KHAI của máy với KẾT QUẢ CUỘN từ cây — hai tín hiệu
 * độc lập, được phép lệch nhau, và **không tín hiệu nào được phép làm nhẹ đi**
 * tín hiệu kia:
 *   · máy khai OK nhưng cây có component NG ⇒ NG  (công dụng của phép cuộn)
 *   · máy khai NG nhưng cây rỗng           ⇒ NG  (máy biết thứ nó không gửi lên)
 *
 * Bất biến này khớp đường v1.x: `promoteOverallToNg` chỉ NÂNG OK→NG và
 * `UPDATE` kèm `WHERE overallResult='OK'` — đo trên 42.431 bo lịch sử,
 * số lần `NG→OK` là **0**. Đường v2.0 phải giữ đúng bất biến đó.
 */
export function verdictXauHon(a: ResultVerdict, b: ResultVerdict): ResultVerdict {
  return MUC_DO_NGHIEM_TRONG[a] >= MUC_DO_NGHIEM_TRONG[b] ? a : b;
}
```

- [ ] **Bước 4: Chạy thấy XANH.**

- [ ] **Bước 5: Sửa `dichCayKetQua` để dùng luật xấu-nhất**

Hiện nó tính `verdictLuuTru` **chỉ từ cuộn-từ-lá**. Sửa thành:

```typescript
// LỜI KHAI cấp bo của máy, đưa về cùng bảng chữ cái với kết quả cuộn.
// `payload.ntf` là NGUỒN NTF THỨ HAI — bỏ nó là tái tạo đúng lỗ 6,55% (Đ-22).
const khai = verdictLuuTru({ result: payload.overallResult, ntf: payload.ntf });
const cuonRa = verdictLuuTru({ result: cuon.result, ntf: cuon.ntf });
// KHÔNG bên nào được làm nhẹ bên kia — xem `verdictXauHon` (Đ-21).
const verdict = verdictXauHon(khai, cuonRa);
```
và thêm `declaredMismatch: khai !== cuonRa` vào `CayDaDich` (khai kiểu trong `interface`).

- [ ] **Bước 6: Viết ca cho bộ dịch** — bốn mệnh đề, mỗi cái một ca:
1. `{overallResult:"NG", surfaces:[]}` ⇒ verdict **`"NG"`** (Đ-21 đóng) và `declaredMismatch === true`.
2. `{overallResult:"OK", ntf:true, surfaces:[]}` ⇒ verdict **`"NTF"`** (Đ-22 đóng).
3. Mẫu THẬT `D:\SOURCES\AOIData\dashboard-sample.json` ⇒ verdict **không đổi** so với trước bản vá (`"NG"`), `declaredMismatch === false` — **chống hồi quy**.
4. Máy khai `OK` nhưng một component `NG` ⇒ vẫn **`"NG"`** (phép cuộn vẫn nâng cấp — không bị bản vá làm hỏng).

- [ ] **Bước 7: Đột biến BẮT BUỘC.** Đổi `verdictXauHon(khai, cuonRa)` → `cuonRa` (tức quay lại hành vi cũ) ⇒ ca 1 và ca 2 phải **ĐỎ**. Chép nguyên văn. Hoàn tác, xác nhận `git diff` rỗng.

- [ ] **Bước 8: Cổng + commit.**
```bash
npm run check
npx vitest run shared/ server/services/ server/db/ingestCayKetQua.db.test.ts server/routers/machineApiIngestCayV2.test.ts server/utils/kpiCongThucCensus.test.ts server/db/khongBomInspectionBia.test.ts
git commit -m "fix(aoi): verdict luu tru = XAU NHAT cua (khai, cuon) - dong BG-22 va BG-24"
```

---

### Task 2: `idempotencyKey` cho đường v2.0 — đóng BG-23 ⛔

**Files:** Modify `server/routers/machineApiRouters.ts`; Create `server/db/ingestV2KhuTrung.db.test.ts`

- [ ] Đặt `idempotencyKey` cho **mọi** lượt ghi v2.0, dựng từ trường máy **chắc chắn có**: `identity` (7 trường bắt buộc) + `productId` + `startedAt`. **Không phụ thuộc `serialNumber`.**
- [ ] Lưới **DB THẬT** (không mock): gửi **cùng một payload serial RỖNG hai lượt** ⇒ lượt hai **không** tạo bo mới. Đây là mệnh đề trung tâm; hiện đo được **3 lượt = 3 bo**.
- [ ] Lưới thứ hai: hai payload **khác nhau** cùng serial rỗng ⇒ **hai** bo (không khử trùng nhầm bo khác nhau). Đây là ca chống-siết-quá.
- [ ] Đột biến: bỏ `idempotencyKey` ⇒ ca đầu phải ĐỎ.
- [ ] ⚠ `avi_app` không DELETE được `product_inspections` — nói rõ trong báo cáo bạn xử lý dọn dẹp thế nào.

---

### Task 3: Gác **NĂM** cửa ingest — đóng BG-21 ⛔ + BG-31

**Files:** Modify `server/routers/machineApiRouters.ts`; Create `server/routers/cuaIngestCensus.test.ts`

- [ ] Cờ hiện gác **nhánh TỪ CHỐI**, không gác **nhánh NHẬN** (`:3006` trả về trước `:3009`). Sửa để cả hai nhánh cùng nằm sau một chỗ quyết định.
- [ ] Bốn cửa còn lại **không kiểm gì**: `submitInspectionBatch` · `submitProcessResult` · `submitProcessResultBatch` · `syncEdgeResults`.
- [ ] **Lưới census**: liệt kê **mọi** thủ tục nhận dữ liệu kiểm tra từ máy và khẳng định mỗi cái đi qua đúng một điểm quyết định phiên bản. Census phải **quét trên MÃ (AST), không trên văn bản** — bài học BG-16: lưới regex của BG-14 đã xanh giả một lần.
- [ ] Đột biến: thêm một cửa giả không gác ⇒ census phải ĐỎ và **nêu tên cửa đó**.

---

### Task 4: Nghiệm thu END-TO-END THẬT cho đường NHẬN v2.0 — đóng BG-26

**Files:** Create `server/db/ingestV2XuyenSuot.db.test.ts`

- [ ] Hiện **không ca nào** ghi payload v2.0 xuyên suốt vào DB thật: `machineApiIngestCayV2.test.ts` mock `../db`; `ingestCayKetQua.db.test.ts` dựng header **bằng tay**. Hệ quả đo được: `summaryCounts` và `ntfSource` — hai cột **chỉ router ghi** — **NULL trên 6/6** bo có cây.
- [ ] Lưới mới gọi **thủ tục router thật** với DB thật, rồi `SELECT` lại và khẳng định: `overallResult` · `summaryCounts` khác NULL · `ntfSource` khác NULL · đủ 3 cấp cây · `declaredMismatch` đúng.
- [ ] Đột biến: bỏ `summaryCounts` khỏi lượt ghi ⇒ phải ĐỎ.

---

### Task 5: Luật `integrityScan` — bo có header mà 0 dòng đo (BG-28)

**Files:** Modify `server/services/integrityScanService.ts`

- [ ] Hiện chỉ có luật con→cha mồ côi; **0 luật** cho "header không có dòng đo" ⇒ Đ-19 là lỗ **vô hình** với giám sát.
- [ ] Thêm luật, kèm ngưỡng cấu hình được, và **đếm được** trên DB test hiện tại (đang có bo v2.0 với 0 dòng đo — dùng chính chúng làm ca thật).
- [ ] Đột biến: gỡ luật ⇒ lưới phải ĐỎ.

---

## Cổng ra Pha 1C

Chỉ sang Khối B khi cả bảy điều sau **đã chạy thật và có số**:

- [ ] `{overallResult:"NG", surfaces:[]}` → cột DB = **`"NG"`** (Đ-21 đóng, đo trên DB thật).
- [ ] `{overallResult:"OK", ntf:true, surfaces:[]}` → cột DB = **`"NTF"`** (Đ-22 đóng).
- [ ] Mẫu máy thật → verdict **không đổi** (`"NG"`) — chống hồi quy.
- [ ] Cùng payload serial **rỗng** gửi hai lượt → **một** bo (Đ-23 đóng).
- [ ] Census cửa ingest xanh, và đột biến "thêm cửa không gác" làm nó **ĐỎ nêu đúng tên**.
- [ ] Lưới end-to-end: `summaryCounts` và `ntfSource` **khác NULL** sau lượt ghi qua router thật.
- [ ] `npm run check` sạch · hai cổng Pha 0 xanh (3/3, 4/4).

**Không khai "xong" nếu thiếu bất kỳ mục nào.**

**Còn mở sau Pha 1C** (không được im lặng): BG-25 (WAL — kế hoạch riêng) · BG-27 · BG-29 · BG-30 · BG-32 · BG-33 · Đ-24 (hai đường ghi `overallResult` không qua `verdictLuuTru`) · §6 giao thức version · §3.6 dọn mồ côi · BG-5 · BG-6 · BG-12 · BG-15 · BG-16 · BG-19 · join gói ảnh theo `captureId`.
