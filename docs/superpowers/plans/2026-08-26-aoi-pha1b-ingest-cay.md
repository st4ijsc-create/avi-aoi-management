# Pha 1B — Ingest cây 4 cấp cho máy AOI/AVI

> **Cho người thực thi:** dùng skill `superpowers:subagent-driven-development` để chạy từng task. Các bước dùng cú pháp checkbox `- [ ]`.

**Mục tiêu:** Đưa payload cây 4 cấp của máy v2.0 vào DB **đúng và an toàn** — bao gồm cầu nối NTF, khử trùng, và ba mục ⛔ chặn từ review toàn nhánh Pha 1A.

**Kiến trúc:** Pha 1A đã dựng nền (bảng, hợp đồng, hàm cuộn, bất biến) nhưng **chưa một byte dữ liệu cây nào đi qua hệ thống**. Pha 1B nối đường: `payload v2.0 → cuộn → ghi 4 cấp → gắn thẻ lệch chuẩn`. Ba quyết định thiết kế đã chốt trước (§QĐ dưới) vì mọi task phụ thuộc vào chúng.

**Công nghệ:** TypeScript, Drizzle ORM, PostgreSQL 16 + TimescaleDB 2.28.2, zod, vitest, tRPC + Express.

**Spec:** `docs/superpowers/specs/2026-08-24-aoi-5-cap-xuong-song-design.md` — đặc biệt §13 (Đ-6…Đ-17) và bảng bàn giao **BG-1…BG-14**.

---

## Global Constraints

- **Mã, chú thích, tên test, thông điệp lỗi: TIẾNG VIỆT.**
- **Nghiệm thu DB phải chạy bằng vai `avi_app`**, KHÔNG phải `aoi`. `aoi` là superuser + BYPASSRLS + owner ⇒ mọi phép đo quyền chạy bằng nó đều xanh giả. Mọi script migration phải tái dùng **cầu chì** của `scripts/apply-migration-0338.mjs:74-84` (đọc `rolsuper`/`rolbypassrls` của vai nghiệm thu, từ chối chạy nếu là superuser).
- **Migration chỉ thêm cột NULLABLE.** `NOT NULL DEFAULT` chưa được chứng minh an toàn trên hypertable đã nén ở bất kỳ quy mô nào (§13 Đ-6).
- **Migration TUYỆT ĐỐI không chứa lệnh xoá dữ liệu lịch sử.** Cùng một câu `DELETE` chạy đúng ý trên DB dev hôm nay sẽ xoá sạch lịch sử sản xuất ở nhà máy.
- **Mọi lưới phải chứng minh ĐỎ ĐƯỢC** bằng một đột biến đã chạy thật, kèm nguyên văn output. Lưới không chứng minh được là lưới chết.
- Test nằm trong glob vitest: `shared/**/*.test.ts` hoặc `server/**/*.test.ts`.
- Hai cổng Pha 0 phải xanh sau mỗi task: `server/utils/kpiCongThucCensus.test.ts` (3 ca), `server/db/khongBomInspectionBia.test.ts` (4 ca).
- **Không dùng `Math.random()` để sinh dữ liệu vào bảng WORM.** Pha 0 đã gỡ hai hàm seed vì lý do này.

---

## Bốn quyết định đã chốt — mọi task đọc phần này trước

### QĐ-BG6 — định danh `surface` bằng TÊN, trong phạm vi một `productModelId`

Ba mẫu máy thật định danh surface theo ba cách (§13 Đ-14): payload kết quả chỉ có `name`; teach data có `surfaceId` (GUID) + `surfaceName`; manifest ảnh có `surface` (tên). Gốc rễ: `HookProductContext` không có node Surface — generator tự gộp theo `HookPosition.SurfaceName`.

**Chốt:** khoá tự nhiên là `(productModelId, surfaceName)` — chỉ mục `uq_product_surfaces_model_name` đã tồn tại sẵn. `surfaceExtId` **giữ nullable**, chỉ điền từ đồng bộ teach data (Khối B), **không** phải từ đường ingest kết quả. Đổi tên surface = **nâng version + di trú**, thuộc giao thức §6 ở Pha 1C.

### QĐ-BG7 — cầu nối NTF: một hàm thuần RIÊNG, không sửa `rollupVerdict`

`rollupVerdict` (Pha 1A) trả `{result: "OK"|"NG"|"NTF", ntf: bool}`. Trên đường v2.0 nó **không bao giờ** trả `"NTF"` vì hợp đồng chỉ cho `result` nhận `OK|NG` — đã chứng minh bằng quét vét cạn 16 tổ hợp. Cột `product_inspections.overallResult` thì có bảng chữ cái **ba giá trị**, và **6,55%** bo hiện tại đang dùng `"NTF"`.

**Chốt:** thêm hàm thuần `verdictLuuTru()` trong `shared/rollupVerdict.ts`, ánh xạ cặp `{result, ntf}` về **một** giá trị lưu trữ:

```
result === "NG"  →  "NG"      (NG thắng NTF — luật cuộn của chủ dự án)
ntf === true     →  "NTF"
ngược lại        →  "OK"
```

**KHÔNG sửa `rollupVerdict`** — nó đúng việc của nó (cuộn cây). Cầu nối là việc khác, tách riêng để mỗi hàm có một trách nhiệm.

### QĐ-BG8 — đổi tên `measurement_results.captureRowId` và thêm FK THẬT

Hiện có **hai** cột cùng tên `captureRowId` kiểu `int4`, trỏ **hai bảng khác nhau**, chỉ **một** có FK (§13 Đ-16). Hai dãy id chồng khoảng ⇒ `JOIN` nhầm trả rác mà không gì bắt được.

**Chốt:** đổi tên `measurement_results.captureRowId` → **`inspectionCaptureRowId`**, và **thêm FK thật** tới `inspection_captures(id)` `ON DELETE SET NULL`.
**An toàn đã đo:** cột có **0 giá trị khác NULL** trên cả hai DB (dev 0/0, test 0/31.240) ⇒ đổi tên không cần di trú dữ liệu. FK **từ** hypertable **tới** bảng thường là hợp lệ trong Postgres (chiều ngược lại mới bị cấm).

### QĐ-BG14 — serial rỗng: hợp đồng nới, ingest KHÔNG nới ở pha này

Hợp đồng v2.0 đã bỏ `.min(1)` khỏi `serialNumber` (đúng theo tài liệu máy: *"rỗng nếu máy chưa gửi"*). Nhưng `machineApiRouters.ts:694` giữ `.min(1)` **có chủ đích**: `uq_inspections_machine_serial_time` là chỉ mục **riêng phần** `WHERE serialNumber <> ''` ⇒ serial rỗng **thoát khoá duy nhất** ⇒ nhận nó là **mở lại lỗ đếm trùng** (§13 Đ-17).

**Chốt:** Pha 1B **KHÔNG nới ingest**. Giữ nguyên `.min(1)` ở đó. Nhưng phải **biến sự lệch này thành một lưới nói ra thành lời**, thay vì để nó im lặng — Task 3.

---

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `shared/rollupVerdict.ts` (sửa) | thêm `verdictLuuTru()` — cầu nối NTF, hàm thuần | T1 |
| `shared/rollupVerdict.test.ts` (sửa) | ca cho `verdictLuuTru` + ca chống hồi quy 6,55% | T1 |
| `server/db/nftCauNoi.db.test.ts` (mới) | lưới đo trên dữ liệu THẬT: bo NTF không được biến mất | T1 |
| `drizzle/0340_capture_rowid_ro_nghia.sql` (mới) | đổi tên cột + FK thật + unique cây kết quả + unique component | T2 |
| `drizzle/schema/inspectionTree.ts`, `drizzle/schema/product.ts` (sửa) | khớp Drizzle với SQL | T2 |
| `scripts/apply-migration-0340.mjs` (mới) | áp + nghiệm thu bằng `avi_app`, tái dùng cầu chì | T2 |
| `server/contracts/machineDataContractV2.ts` (sửa) | `.max()` cho 3 khoá join + `surface.name` | T3 |
| `server/contracts/hopDongVsIngest.test.ts` (mới) | lưới NÓI RA cửa sổ lệch validate↔ingest | T3 |
| `drizzle/schema/inspection.ts` (sửa) | kiểu `summaryCounts` chứa được `summary` 4×4 | T3 |
| `server/services/ingestCayKetQua.ts` (mới) | dịch payload v2.0 → 4 cấp + cuộn + `declaredMismatch` | T4 |
| `server/services/ingestCayKetQua.test.ts` (mới) | lưới đơn vị cho bộ dịch | T4 |
| `server/db/ingestCayKetQua.db.test.ts` (mới) | lưới ghi thật vào DB + khử trùng | T5 |
| `server/routers/machineApiRouters.ts` (sửa) | nối v2.0 vào ingest + `loiMayChuaNangCap` | T6 |
| `server/routers/machineContractRouter.test.ts` (mới) | lưới đầu tiên cho router này (BG-3) | T7 |
| `server/api/v1/openapi.ts` (sửa) | đóng lệch doc↔endpoint (BG-2) | T7 |
| `server/db/cayCauHinhBatBien.db.test.ts` (sửa) | siết ca chống-tự-thoả: cây > 0 (BG-4) | T8 |
| `server/db/cayCauHinhSchema.db.test.ts`, `server/db/inspectionTreeSchema.db.test.ts` (sửa) | lưới khớp schema canh **kiểu + độ dài**, không chỉ tên (BG-4 bổ sung) | T8 |

---

### Task 1: `verdictLuuTru` — cầu nối NTF (BG-7 ⛔)

**Files:**
- Modify: `shared/rollupVerdict.ts`
- Test: `shared/rollupVerdict.test.ts` (sửa), `server/db/nftCauNoi.db.test.ts` (mới)

**Interfaces:**
- Consumes: `ResultVerdict`, `NutKetQua`, `rollupVerdict` (đã có ở Pha 1A)
- Produces: `export function verdictLuuTru(x: { result: ResultVerdict; ntf: boolean }): ResultVerdict` — T4 và T5 dùng

**Bối cảnh bắt buộc đọc:** `shared/kpiYield.ts:22` có `FINAL_YIELD_PASS_RESULTS = ["OK", "NTF"]` — công thức final yield đọc **cột** `overallResult`, không đọc **cờ** `ntf`. Trên DB test, `overallResult` phân bố `OK 30.385 · NG 9.002 · NTF 2.760` trên 42.147 bo. Nếu đường v2.0 không ánh xạ `ntf` về cột, 2.760 bo (6,55%) chuyển từ PASS sang NG.

- [ ] **Bước 1: Viết ca thất bại trong `shared/rollupVerdict.test.ts`**

```typescript
describe("verdictLuuTru — cầu nối cờ ntf về bảng chữ cái BA giá trị của cột lưu trữ", () => {
  it("NG thắng NTF — đúng luật cuộn của chủ dự án", () => {
    expect(verdictLuuTru({ result: "NG", ntf: true })).toBe("NG");
    expect(verdictLuuTru({ result: "NG", ntf: false })).toBe("NG");
  });

  it("không NG mà có cờ ntf ⇒ NTF (đây chính là 6,55% bo sẽ biến mất nếu thiếu hàm này)", () => {
    expect(verdictLuuTru({ result: "OK", ntf: true })).toBe("NTF");
  });

  it("không NG, không ntf ⇒ OK", () => {
    expect(verdictLuuTru({ result: "OK", ntf: false })).toBe("OK");
  });

  it("nối THẲNG từ rollupVerdict: cây toàn OK nhưng một component gắn cờ ntf ⇒ lưu NTF", () => {
    const cuon = rollupVerdict([
      { result: "OK", ntf: false },
      { result: "OK", ntf: true, ntfSource: "machine" },
    ]);
    expect(cuon.result).toBe("OK");
    expect(cuon.ntf).toBe(true);
    expect(verdictLuuTru(cuon)).toBe("NTF");
  });

  it("giá trị trả về NẰM TRONG bảng chữ cái mà công thức final yield biết", () => {
    const ra = new Set<string>();
    for (const result of ["OK", "NG"] as const)
      for (const ntf of [true, false]) ra.add(verdictLuuTru({ result, ntf }));
    expect([...ra].sort()).toEqual(["NG", "NTF", "OK"]);
    expect(ra.has("NTF")).toBe(true);
  });
});
```

- [ ] **Bước 2: Chạy để thấy ĐỎ**

Chạy: `npx vitest run shared/rollupVerdict.test.ts`
Kỳ vọng: FAIL — `verdictLuuTru is not a function` (hoặc lỗi import).

- [ ] **Bước 3: Cài đặt tối thiểu trong `shared/rollupVerdict.ts`**

```typescript
/**
 * Cầu nối giữa HAI bảng chữ cái khác nhau:
 *   · Hợp đồng máy v2.0 — `result` chỉ `OK|NG`, NTF là cờ BOOL RIÊNG.
 *   · Cột lưu trữ `product_inspections.overallResult` — BA giá trị `OK|NG|NTF`,
 *     và `shared/kpiYield.ts` tính final yield bằng `["OK","NTF"]` trên chính cột đó.
 *
 * Thiếu hàm này thì 6,55% bo (2.760/42.147 đo trên DB test ngày 2026-08-26) chuyển
 * từ PASS sang NG lặng lẽ vào đúng ngày cắt sang v2.0 — không lưới nào đỏ, vì enum
 * DB vẫn NHẬN "NTF", chỉ là không ai ghi vào nữa.
 *
 * CỐ Ý TÁCH KHỎI `rollupVerdict`: cuộn cây và ánh xạ bảng chữ cái là hai việc khác nhau.
 */
export function verdictLuuTru(x: { result: ResultVerdict; ntf: boolean }): ResultVerdict {
  if (x.result === "NG") return "NG"; // NG thắng NTF — luật cuộn đã chốt với chủ dự án
  return x.ntf ? "NTF" : "OK";
}
```

- [ ] **Bước 4: Chạy để thấy XANH**

Chạy: `npx vitest run shared/rollupVerdict.test.ts`
Kỳ vọng: PASS, tổng số ca = 10 (cũ) + 5 (mới) = **15**.

- [ ] **Bước 5: Viết lưới chống hồi quy trên DỮ LIỆU THẬT — `server/db/nftCauNoi.db.test.ts`**

Lưới này canh một mệnh đề mà lưới đơn vị **không thể** canh: rằng bo NTF trong DB thật **không bằng 0**, nên phép đo có ý nghĩa; và rằng bảng chữ cái của cột khớp với thứ `verdictLuuTru` sinh ra.

```typescript
import { describe, it, expect } from "vitest";
import { getDb } from "./connection";
import { sql } from "drizzle-orm";
import { verdictLuuTru } from "@shared/rollupVerdict";
import { FINAL_YIELD_PASS_RESULTS } from "@shared/kpiYield";

/**
 * BG-7 (§13 Đ-15). Canh cầu nối NTF bằng DỮ LIỆU THẬT, không bằng ví dụ tự chế.
 * Nếu ai đó bỏ `verdictLuuTru` khỏi đường ingest, lưới đơn vị vẫn xanh — nhưng
 * mệnh đề "cột lưu trữ còn dùng NTF" thì đo được trên DB thật.
 */
describe("cầu nối NTF — bảng chữ cái cột lưu trữ", () => {
  it("bo NTF trong DB KHÔNG bằng 0 — nếu bằng 0 thì mọi phép đo dưới đây tự thoả", async () => {
    const db = await getDb();
    if (!db) throw new Error("không có DB test — chạy: node scripts/setup-test-db.mjs");
    const r: any = await db.execute(sql`
      SELECT count(*) FILTER (WHERE "overallResult" = 'NTF')::int AS ntf,
             count(*)::int AS tong FROM product_inspections`);
    const { ntf, tong } = ((r.rows ?? r) as Array<{ ntf: number; tong: number }>)[0];
    expect(tong, "bảng rỗng ⇒ phép đo vô nghĩa").toBeGreaterThan(0);
    expect(ntf, `bo NTF = 0/${tong} ⇒ cầu nối NTF không còn gì để canh`).toBeGreaterThan(0);
  });

  it("MỌI giá trị verdictLuuTru sinh ra đều là giá trị cột đã thật sự dùng", async () => {
    const db = await getDb();
    const r: any = await db!.execute(sql`
      SELECT DISTINCT "overallResult" AS kq FROM product_inspections WHERE "overallResult" IS NOT NULL`);
    const trongDb = new Set(((r.rows ?? r) as Array<{ kq: string }>).map((x) => x.kq));
    const sinhRa = new Set<string>();
    for (const result of ["OK", "NG"] as const)
      for (const ntf of [true, false]) sinhRa.add(verdictLuuTru({ result, ntf }));
    for (const v of sinhRa)
      expect(trongDb.has(v), `verdictLuuTru sinh "${v}" nhưng cột chưa từng chứa giá trị này`).toBe(true);
  });

  it("NTF nằm trong tập PASS của final yield — nếu đổi, 6,55% bo đổi phe", () => {
    expect([...FINAL_YIELD_PASS_RESULTS]).toContain("NTF");
  });
});
```

- [ ] **Bước 6: Chạy lưới DB**

Chạy: `npx vitest run server/db/nftCauNoi.db.test.ts`
Kỳ vọng: PASS 3/3 trên DB test (2.760 bo NTF).

- [ ] **Bước 7: CHỨNG MINH lưới đỏ được — đột biến bắt buộc**

Đổi `verdictLuuTru` thành `return x.result;` (bỏ hẳn nhánh NTF — chính là lỗi mà BG-7 chống).
Chạy: `npx vitest run shared/rollupVerdict.test.ts server/db/nftCauNoi.db.test.ts`
Kỳ vọng: **≥3 ca ĐỎ**. Chép nguyên văn output. Hoàn tác, xác nhận `git diff` RỖNG, chạy lại thấy xanh.

- [ ] **Bước 8: Cổng + commit**

```bash
npm run check
npx vitest run server/utils/kpiCongThucCensus.test.ts server/db/khongBomInspectionBia.test.ts
git add shared/rollupVerdict.ts shared/rollupVerdict.test.ts server/db/nftCauNoi.db.test.ts
git commit -m "feat(aoi): cau noi NTF - 6,55% bo khong bien mat khi cat sang v2.0"
```

---

### Task 2: Migration 0340 — cột rõ nghĩa + FK thật + hai khoá duy nhất (BG-8 ⛔, BG-11, BG-13)

**Files:**
- Create: `drizzle/0340_capture_rowid_ro_nghia.sql`, `scripts/apply-migration-0340.mjs`
- Modify: `drizzle/schema/inspection.ts` (đổi tên cột), `drizzle/schema/inspectionTree.ts` (unique), `drizzle/schema/product.ts` (unique component)
- Test: `server/db/inspectionTreeSchema.db.test.ts` (sửa — khớp tên mới)

**Interfaces:**
- Produces: cột `measurement_results.inspectionCaptureRowId`; ràng buộc `uq_insp_surfaces_inspection_name`, `uq_insp_positions_surface_posid`, `uq_point_defs_capture_component`. T4/T5 dùng làm đích `ON CONFLICT`.

**An toàn đã đo (không cần đo lại, nhưng phải xác nhận trước khi đổi tên):** `measurement_results.captureRowId` có **0 giá trị khác NULL** — dev 0/0, test 0/31.240.

- [ ] **Bước 1: Xác nhận lại điều kiện an toàn TRƯỚC khi đổi tên**

Chạy trên **cả hai** DB bằng vai `avi_app`:
```sql
SELECT count(*) FILTER (WHERE "captureRowId" IS NOT NULL) AS dung, count(*) AS tong FROM measurement_results;
```
Kỳ vọng: `dung = 0`. **Nếu `dung > 0`, DỪNG và báo `BLOCKED`** — đổi tên khi đã có dữ liệu là việc khác hẳn, cần di trú.

- [ ] **Bước 2: Viết `drizzle/0340_capture_rowid_ro_nghia.sql`**

```sql
-- 0340 — Pha 1B. Ba việc, cùng một gốc rễ: cây KẾT QUẢ thiếu ràng buộc.
--
-- (1) BG-8 (§13 Đ-16): HAI cột cùng tên `captureRowId` kiểu int4 trỏ HAI bảng khác nhau,
--     chỉ MỘT có FK. Hai dãy id chồng khoảng ⇒ `JOIN ON r."captureRowId" = d."captureRowId"`
--     trông tự nhiên và trả về RÁC, không gì bắt được. Đổi tên + thêm FK thật.
--     An toàn: cột có 0 giá trị khác NULL trên cả hai DB (đo 2026-08-26).
-- (2) BG-11: cây KẾT QUẢ không có khử trùng, trong khi header CÓ. Gửi lại 1 bo ⇒ 2 cây.
-- (3) BG-13: cấp component là cấp DUY NHẤT không có unique ⇒ không có đích ON CONFLICT.
--
-- Mọi cột mới đều NULLABLE. KHÔNG có lệnh xoá dữ liệu.

-- ── (1) Đổi tên + FK thật ────────────────────────────────────────────────────
ALTER TABLE measurement_results RENAME COLUMN "captureRowId" TO "inspectionCaptureRowId";

ALTER TABLE measurement_results
  ADD CONSTRAINT fk_measurement_results_inspection_capture
  FOREIGN KEY ("inspectionCaptureRowId") REFERENCES inspection_captures(id) ON DELETE SET NULL;

COMMENT ON COLUMN measurement_results."inspectionCaptureRowId" IS
  'Trỏ inspection_captures(id) — cây KẾT QUẢ. KHÔNG phải product_captures (cây CẤU HÌNH); '
  'cột đó tên là measurement_point_defs."captureRowId". Hai dãy id chồng khoảng.';

-- ── (2) Khử trùng cây KẾT QUẢ ────────────────────────────────────────────────
-- surface định danh bằng TÊN trong phạm vi một bo (QĐ-BG6).
CREATE UNIQUE INDEX IF NOT EXISTS uq_insp_surfaces_inspection_name
  ON inspection_surfaces ("inspectionId", "surfaceName");

CREATE UNIQUE INDEX IF NOT EXISTS uq_insp_positions_surface_posid
  ON inspection_positions ("surfaceRowId", "positionId");

-- ── (3) Đích ON CONFLICT cho cấp component ───────────────────────────────────
-- Riêng phần: chỉ áp cho hàng ĐÃ chuyển sang cây và chưa xoá mềm.
CREATE UNIQUE INDEX IF NOT EXISTS uq_point_defs_capture_component
  ON measurement_point_defs ("captureRowId", "componentExtId")
  WHERE "captureRowId" IS NOT NULL AND "componentExtId" IS NOT NULL AND "deletedAt" IS NULL;
```

- [ ] **Bước 3: Viết `scripts/apply-migration-0340.mjs`**

Lấy **nguyên khuôn** `scripts/apply-migration-0339.mjs`: hai kết nối (owner để DDL, `avi_app` để nghiệm thu), **cầu chì** từ chối chạy nếu vai nghiệm thu là superuser, chạy trên **cả** dev và test. Phần nghiệm thu phải bao gồm:

1. Cột `inspectionCaptureRowId` tồn tại, cột `captureRowId` **không còn** trên `measurement_results`.
2. FK `fk_measurement_results_inspection_capture` có trong `pg_constraint`.
3. Ba chỉ mục duy nhất tồn tại và **thật sự là UNIQUE** (`pg_index.indisunique = true`).
4. **Thử hành vi thật, không đọc SQL:** chèn hai `inspection_surfaces` cùng `(inspectionId, surfaceName)` → lượt hai phải **thất bại với `23505`**. Dọn sạch sau khi thử.
5. In rõ vai nghiệm thu và `rolsuper`/`rolbypassrls` như 0338/0339.

- [ ] **Bước 4: Áp migration**

Chạy: `node scripts/apply-migration-0340.mjs`
Kỳ vọng: thành công trên cả hai DB, cầu chì in `vai "avi_app" (rolsuper=false, rolbypassrls=false)`, phép thử `23505` đúng.
**Nếu gặp lỗi liên quan nén/chunk: DỪNG và báo.**

- [ ] **Bước 5: Sửa Drizzle cho khớp**

`drizzle/schema/inspection.ts`: đổi tên cột `captureRowId` → `inspectionCaptureRowId` (giữ nguyên kiểu, vẫn không `.references()` để tránh import vòng — DB đã có FK thật; **ghi rõ điều đó trong chú thích**).
`drizzle/schema/inspectionTree.ts` và `drizzle/schema/product.ts`: khai hai/một unique index tương ứng.

- [ ] **Bước 6: Sửa lưới khớp schema + chạy**

`server/db/inspectionTreeSchema.db.test.ts` đang canh tên `captureRowId` — sửa sang tên mới.
Chạy: `npx vitest run server/db/`
Kỳ vọng: toàn bộ xanh.

- [ ] **Bước 7: CHỨNG MINH lưới đỏ được**

Đột biến: đổi tên cột trong Drizzle thành `inspectionCaptureRowID` (sai hoa/thường).
Kỳ vọng: lưới khớp schema **ĐỎ**, nêu đúng tên cột. Chép output. Hoàn tác, xác nhận `git diff` rỗng.

- [ ] **Bước 8: Cổng + commit**

```bash
npm run check
npx vitest run server/utils/kpiCongThucCensus.test.ts server/db/khongBomInspectionBia.test.ts
git add drizzle/0340_capture_rowid_ro_nghia.sql scripts/apply-migration-0340.mjs drizzle/schema/ server/db/inspectionTreeSchema.db.test.ts
git commit -m "feat(aoi): 0340 - cot ro nghia + FK that + khu trung cay ket qua"
```

---

### Task 3: Siết hợp đồng + nói ra cửa sổ lệch (BG-9, BG-10, BG-14 ⛔)

**Files:**
- Modify: `server/contracts/machineDataContractV2.ts`, `drizzle/schema/inspection.ts`
- Create: `server/contracts/hopDongVsIngest.test.ts`
- Test: `server/contracts/machineDataContractV2.test.ts` (thêm ca)

**Interfaces:**
- Consumes: hợp đồng v2.0 từ Pha 1A
- Produces: kiểu `SummaryCounts` cho `summaryCounts`; T4 dùng

- [ ] **Bước 1: Viết ca thất bại — độ dài khoá join (BG-9)**

Thêm vào `server/contracts/machineDataContractV2.test.ts`:

```typescript
it("khoá join dài quá sức chứa cột DB (64) ⇒ TỪ CHỐI NGAY CỬA, không để DB ném 22001", () => {
  const p = mauHopLe();
  p.surfaces[0].positions[0].captures[0].captureId = "x".repeat(80);
  expect(machineDataContractV2.safeParse(p).success).toBe(false);
});

it("surface.name dài quá sức chứa cột (100) ⇒ TỪ CHỐI", () => {
  const p = mauHopLe();
  p.surfaces[0].name = "y".repeat(150);
  expect(machineDataContractV2.safeParse(p).success).toBe(false);
});

it("độ dài ĐÚNG BẰNG sức chứa vẫn HỢP LỆ — biên không bị siết nhầm", () => {
  const p = mauHopLe();
  p.surfaces[0].positions[0].captures[0].captureId = "x".repeat(64);
  p.surfaces[0].name = "y".repeat(100);
  expect(machineDataContractV2.safeParse(p).success).toBe(true);
});
```

- [ ] **Bước 2: Chạy để thấy ĐỎ**

Chạy: `npx vitest run server/contracts/machineDataContractV2.test.ts`
Kỳ vọng: 2 ca đầu FAIL (hợp đồng đang nhận chuỗi dài).

- [ ] **Bước 3: Siết hợp đồng**

Trong `machineDataContractV2.ts`, thêm `.max(64)` cho **cả ba** khoá join (`captureId`, `componentId`, `positionId`) và `.max(100)` cho `surface.name`. Giữ nguyên `.trim().min(1)`.
Chú thích phải nêu **lý do bằng số**: cột DB là `varchar(64)`/`varchar(100)`; không có `.max()` thì lỗi rơi **sau** cửa hợp đồng dưới dạng `[22001]` mà kỹ sư hiện trường không đọc nổi.

- [ ] **Bước 4: Sửa kiểu `summaryCounts` (BG-10)**

`drizzle/schema/inspection.ts:190` hiện là `jsonb("summaryCounts").$type<Record<string, number>>()`. Hợp đồng khai `summary` là **4 nhóm × 4 bộ đếm** ⇒ gán vào sẽ ra `TS2322`.

Khai kiểu tường minh, đặt cạnh nhau để người đọc thấy quan hệ:

```typescript
/** Bộ đếm một cấp — khớp `summary.<nhóm>` của hợp đồng máy v2.0. */
export interface BoDemMotCap { total: number; pass: number; ng: number; ntf: number }

/**
 * `summaryCounts` — bộ đếm 4 cấp máy tự tính và gửi kèm.
 * CỐ Ý giữ nguyên cấu trúc 4×4 thay vì bẹt hoá: bẹt hoá cần một lược đồ khoá tự chế
 * ("surfaces.total"…), và lược đồ đó sẽ thành một hợp đồng ngầm không ai canh.
 */
export interface SummaryCounts {
  surfaces: BoDemMotCap; positions: BoDemMotCap; captures: BoDemMotCap; components: BoDemMotCap;
}
```
rồi đổi cột thành `.$type<SummaryCounts>()`.

- [ ] **Bước 5: Viết `server/contracts/hopDongVsIngest.test.ts` (BG-14)**

Lưới này **không sửa hành vi** — nó biến một sự lệch im lặng thành một phát biểu có tên:

```typescript
import { describe, it, expect } from "vitest";
import { machineDataContractV2 } from "./machineDataContractV2";
import { mauHopLe } from "./machineDataContractV2.test-helpers";

/**
 * BG-14 (§13 Đ-17). Hợp đồng v2.0 NHẬN `serialNumber` rỗng (đúng tài liệu máy:
 * "rỗng nếu máy chưa gửi"). Đường ingest thật thì TỪ CHỐI, và đó là CHỦ ĐÍCH:
 * `uq_inspections_machine_serial_time` là chỉ mục RIÊNG PHẦN `WHERE serialNumber <> ''`
 * ⇒ serial rỗng THOÁT khoá duy nhất ⇒ nhận nó là mở lại lỗ đếm trùng (doc 51 P0).
 *
 * Lưới này KHÔNG đòi hai bên phải giống nhau. Nó đòi sự KHÁC NHAU phải được NÓI RA,
 * để không ai "sửa cho nhất quán" mà vô tình mở lại lỗ.
 */
describe("cửa sổ lệch giữa hợp đồng và ingest — có CHỦ ĐÍCH, phải nói ra", () => {
  it("hợp đồng NHẬN serialNumber rỗng", () => {
    const p = mauHopLe();
    p.serialNumber = "";
    expect(machineDataContractV2.safeParse(p).success).toBe(true);
  });

  it("ingest thật vẫn ĐÒI serialNumber không rỗng — đừng nới cho tới khi có đường khử trùng khác", () => {
    const nguon = readFileSync("server/routers/machineApiRouters.ts", "utf8");
    expect(
      /serialNumber:\s*z\.string\(\)\.trim\(\)\.min\(1\)/.test(nguon),
      "ingest đã nới serialNumber mà chưa thấy đường khử trùng thay thế — xem §13 Đ-17 trước khi làm việc này",
    ).toBe(true);
  });
});
```

Nếu `mauHopLe()` chưa tồn tại như một helper dùng chung, hãy tách nó ra khỏi `machineDataContractV2.test.ts` thành `machineDataContractV2.test-helpers.ts` và cho cả hai file dùng — **không chép đôi**.

- [ ] **Bước 6: Chạy, chứng minh đỏ được, cổng, commit**

```bash
npx vitest run server/contracts/
npm run check
```
Đột biến bắt buộc: bỏ `.max(64)` khỏi `captureId` ⇒ phải làm đúng 1 ca đỏ. Chép output, hoàn tác, xác nhận `git diff` rỗng.

```bash
git commit -m "feat(aoi): siet do dai khoa join, kieu summaryCounts, va noi ra cua so lech serial"
```

---

### Task 4: Bộ dịch payload v2.0 → cây 4 cấp (hàm THUẦN)

**Files:**
- Create: `server/services/ingestCayKetQua.ts`, `server/services/ingestCayKetQua.test.ts`

**Interfaces:**
- Consumes: `rollupVerdict`, `verdictLuuTru` (T1); kiểu `SummaryCounts` (T3); hợp đồng v2.0
- Produces: `export function dichCayKetQua(payload: MachinePayloadV2): CayDaDich` — T5 dùng để ghi DB

Task này **KHÔNG chạm DB**. Nó biến payload thành một cấu trúc phẳng sẵn sàng ghi, và tính `rolledResult`/`rolledNtf`/`declaredMismatch` ở cả ba cấp.

- [ ] **Bước 1: Viết ca thất bại**

Các mệnh đề phải canh (mỗi cái một ca riêng):
1. Cây 4 cấp từ mẫu thật `D:\SOURCES\AOIData\dashboard-sample.json` dịch ra **đúng số lượng** node ở từng cấp, khớp `summary` mà máy tự khai.
2. `rolledResult`/`rolledNtf` ở cấp capture tính từ components; ở cấp position tính từ captures; ở cấp surface tính từ positions.
3. `declaredMismatch = true` khi máy khai một đằng, cuộn ra một nẻo — dựng payload cố ý lệch để canh.
4. `declaredMismatch = false` trên mẫu thật (máy nhất quán).
5. **Cấp surface là cấp phái sinh** — tài liệu nguồn nói surface `result` là *"worst-case rollup từ positions[] con"* ⇒ `declaredMismatch` ở cấp này gần như luôn `false`. Ca này canh chính điều đó, và **ghi rõ trong tên ca** rằng đây là hệ quả cấu tạo, không phải bằng chứng cuộn đúng.
6. `verdictLuuTru` được áp cho verdict gốc ⇒ payload có `ntf: true` và mọi `result: "OK"` phải cho verdict lưu trữ `"NTF"`.
7. `components: []` rỗng ⇒ capture vẫn hợp lệ, cuộn ra OK.

- [ ] **Bước 2: Chạy để thấy ĐỎ.** `npx vitest run server/services/ingestCayKetQua.test.ts`

- [ ] **Bước 3: Cài đặt `dichCayKetQua`.**

Ràng buộc thiết kế:
- **Hàm thuần**, không import DB, không `Date.now()`.
- Cuộn **từ dưới lên**: components → capture → position → surface. Dùng `rollupVerdict` ở mỗi cấp, **không viết lại luật cuộn**.
- `declaredMismatch` = `declared.result !== rolled.result || declared.ntf !== rolled.ntf`.
- Surface định danh bằng `surfaceName` (QĐ-BG6) — **không** sinh `surfaceExtId`.
- Verdict gốc của cả bo = `verdictLuuTru(cuộn từ các surface)`.

- [ ] **Bước 4: Chạy để thấy XANH.**

- [ ] **Bước 5: CHỨNG MINH lưới đỏ được.** Đột biến: đảo `declaredMismatch` thành hằng `false`. Kỳ vọng ≥1 ca đỏ. Chép output, hoàn tác, xác nhận `git diff` rỗng.

- [ ] **Bước 6: Cổng + commit.**

```bash
npm run check && npx vitest run server/services/ingestCayKetQua.test.ts
git commit -m "feat(aoi): bo dich payload v2.0 thanh cay 4 cap, cuon tu duoi len"
```

---

### Task 5: Ghi cây vào DB + khử trùng

**Files:**
- Create: `server/db/ingestCayKetQua.db.test.ts`
- Modify: `server/db/inspection.ts` (thêm hàm ghi cây, trong CÙNG transaction với header)

**Interfaces:**
- Consumes: `dichCayKetQua` (T4); các unique index (T2)
- Produces: `export async function ghiCayKetQua(tx, inspectionId, inspectionTime, cay): Promise<void>`

- [ ] **Bước 1: Viết ca thất bại** — bốn mệnh đề:
1. Ghi một bo có cây → đếm đúng số hàng ở cả ba bảng cây.
2. **Ghi LẠI cùng một bo → số hàng KHÔNG tăng** (đây là BG-11; trước T2 thì việc này sinh 2/2/2).
3. `inspectionCaptureRowId` trên `measurement_results` trỏ đúng `inspection_captures(id)`, **không** trỏ `product_captures`.
4. Xoá bo cha → cây con biến mất theo (CASCADE), không để lại mồ côi.

- [ ] **Bước 2..6:** đỏ → cài đặt → xanh → đột biến (bỏ `ON CONFLICT DO NOTHING` ⇒ ca số 2 phải đỏ) → cổng → commit.

Ràng buộc: hàm ghi phải chạy **trong cùng transaction** với `persistInspectionAtomic`, không phải một lượt ghi riêng — nếu không, một bo có header mà không có cây khi lỗi giữa chừng.

---

### Task 6: Nối v2.0 vào ingest thật + `loiMayChuaNangCap` (BG-1)

**Files:** Modify `server/routers/machineApiRouters.ts`

- [ ] Nhận diện phiên bản payload; v2.0 → đường cây; v1.x → **ném `loiMayChuaNangCap`** với mã lỗi rõ.
- [ ] Lưới phải canh **hành vi thật** (gọi endpoint, đọc mã trả về), không chỉ canh chuỗi lỗi được viết hay — đây chính là lỗi §13 Đ-11.
- [ ] Ca chống hồi quy: payload v1.1 gửi tới ingest → trả lỗi nêu rõ "cần 2.0", **không** phải một đống lỗi zod thô.
- [ ] Sau task này, §13 Đ-11 mới được phép đánh dấu ĐÃ ĐÓNG.

---

### Task 7: Đóng lệch OpenAPI + lưới đầu tiên cho `machineContractRouter` (BG-2, BG-3)

**Files:** Modify `server/api/v1/openapi.ts`; Create `server/routers/machineContractRouter.test.ts`

- [ ] Lưới mới phải phát biểu: **cái `validate()` khai xanh phải là cái ingest nhận**. Đây là lưới mà cả Pha 1A không có.
- [ ] Đo trước khi sửa: doc hiện công bố `required` gồm `["schemaVersion","identity","productId","serialNumber","overallResult","ntf","summary","surfaces"]` và **đã xoá** `machineCode`, `measurements` — đúng hai trường endpoint thật đang đòi.
- [ ] Sau task này, §13 Đ-10 và BG-2/BG-3 mới được phép đánh dấu ĐÃ ĐÓNG.

---

### Task 8: Siết hai lưới đã được chứng minh là yếu (BG-4)

**Files:** Modify `server/db/cayCauHinhBatBien.db.test.ts`, `server/db/cayCauHinhSchema.db.test.ts`, `server/db/inspectionTreeSchema.db.test.ts`

- [ ] **Ca chống-tự-thoả phải đòi cây > 0.** Hiện nó chỉ đòi `count(*) > 0`; sau khi T5 chạy, phải đòi `count(*) FILTER (WHERE "captureRowId" IS NOT NULL) > 0`. Trước T5 thì mệnh đề này không thoả được — nên task này **phải chạy sau T5**.
- [ ] **Lưới khớp schema phải canh KIỂU và ĐỘ DÀI, không chỉ TÊN cột.** Đã chứng minh yếu: thu `product_captures.captureExtId` xuống `varchar(8)` (không chứa nổi một GUID 36 ký tự) cho **27/27 vẫn xanh**.
- [ ] Đột biến bắt buộc: lặp lại đúng phép thu `varchar(8)` đó và xác nhận lưới **nay ĐỎ**.

---

## Cổng ra Pha 1B

Chỉ sang Pha 1C khi cả tám điều sau **đã chạy thật và có số**:

- [ ] `npx vitest run shared/rollupVerdict.test.ts` — 15/15, đột biến bỏ nhánh NTF đã chạy và làm ≥3 ca đỏ.
- [ ] `npx vitest run server/db/nftCauNoi.db.test.ts` — 3/3, và ca đầu xác nhận bo NTF **> 0** trên DB thật.
- [ ] `node scripts/apply-migration-0340.mjs` — thành công cả hai DB bằng vai `avi_app`, phép thử `23505` đúng.
- [ ] Ghi lại cùng một bo **hai lần** → số hàng cây **không tăng** (BG-11 đóng).
- [ ] Payload v1.1 gửi tới ingest thật → lỗi nêu rõ "cần 2.0" (BG-1 đóng, §13 Đ-11 đóng).
- [ ] Lưới `machineContractRouter` tồn tại và phát biểu "validate khai xanh = ingest nhận" (BG-3 đóng).
- [ ] Đột biến `varchar(8)` trên `captureExtId` làm lưới khớp schema **ĐỎ** (BG-4 đóng).
- [ ] `npm run check` sạch · hai cổng Pha 0 xanh (3/3, 4/4).

**Không khai "xong" nếu thiếu bất kỳ mục nào.** Mục nào không làm được thì nói rõ mục đó và lý do.

**Còn mở sau Pha 1B** (chuyển sang Pha 1C, không được im lặng): BG-5 (mồ côi cấu hình — 94 hàng), BG-6 (chốt di trú khi đổi tên surface), BG-12 (dời chỉ mục `declaredMismatch`), và join gói ảnh theo `captureId`.
