# AOI Pha 1A — Nền cây 4 cấp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng NỀN cho cây 4 cấp `surface → position → capture → component` — schema (3 bảng cấu hình + 3 bảng kết quả + mở rộng 3 bảng cũ), hàm cuộn `rollupVerdict`, và hợp đồng máy v2.0 — mà **chưa** nối đường ghi.

**Architecture:** Phía **cấu hình** chuẩn hoá thật (`product_surfaces → product_positions → product_captures → measurement_point_defs`, bảng thường, FK đầy đủ). Phía **kết quả** chuẩn hoá thành 3 bảng thường có FK giữa chúng, chỉ liên kết lên `product_inspections` là mềm (đích là hypertable ⇒ không FK được). `measurement_point_defs` **trở thành chính cấp component**, được neo lên trên bằng cột `captureRowId` nullable — phép cộng thuần, không phá `resolveEffectivePoints` / `variant_point_overrides` / spec-gate / `revertPointsConfigToVersion`.

**Tech Stack:** PostgreSQL 16 + TimescaleDB 2.28.2, Drizzle ORM, TypeScript, Vitest, zod.

**Spec:** `docs/superpowers/specs/2026-08-24-aoi-5-cap-xuong-song-design.md` — đọc §3 (mô hình dữ liệu), §4.1/§4.3 (hợp đồng + thứ tự cuộn), §13 (bốn dữ kiện mới sau Pha 0).

## Global Constraints

- **Nguồn sự thật cho yield/verdict:** `shared/kpiYield.ts` (`finalYield`). Quy ước **NTF = PASS** trong final yield; NTF **không** phải first-pass trong FPY. CẤM viết lại công thức yield bằng tay — cổng `server/utils/kpiCongThucCensus.test.ts` canh cả `server/` lẫn `client/src`.
- **Quy tắc cuộn kết quả:** có bất kỳ **NG → NG**; không NG mà có **NTF → NTF**; không cả hai → **OK**. Áp cho mọi cấp.
- **Mọi cột mới đều NULLABLE, không backfill.** §13 Đ-6 đã chứng minh `ADD COLUMN` nullable an toàn trên hypertable đã nén (Timescale 2.28.2, thử thật có 1 chunk nén). Cột `NOT NULL DEFAULT` **chưa** được chứng minh — không dùng.
- **⚠⚠ DDL chạy bằng owner `aoi`; NGHIỆM THU chạy bằng vai ứng dụng `avi_app`.** `aoi` là superuser + BYPASSRLS + chủ sở hữu bảng ⇒ mọi phép đo quyền/RLS chạy bằng `aoi` sẽ **xanh kể cả khi chính sách hỏng hoàn toàn**. Xem khuôn hai-kết-nối ở `scripts/apply-migration-0327.mjs`.
- **Migration kế tiếp: `0338`.** Đặt tên `drizzle/0338_<mo_ta>.sql`, script áp `scripts/apply-migration-0338.mjs` theo khuôn `apply-migration-0327.mjs`.
- **Không FK trỏ TỚI hypertable.** `product_inspections` và `measurement_results` là hypertable — FK **tới** chúng bị cấm; FK **từ** chúng tới bảng thường thì hợp lệ.
- **DB dev nay RỖNG** (§13 Đ-9). Mọi lưới phải **tự dựng dữ liệu trong phạm vi test của mình và tự dọn**. **CẤM dựng lại hàm seed** — Pha 0 vừa gỡ chúng vì bơm `Math.random()` vào bảng WORM; cổng `server/db/khongBomInspectionBia.test.ts` sẽ đỏ nếu tái phạm.
- **Bảng WORM:** `avi_app` không có `DELETE` trên `product_inspections`. Test đừng thiết kế teardown dựa vào DELETE bảng đó.
- Một commit mỗi task, chỉ `git add` file của task. Nhánh `feat/hmi-dep`, **không push**.
- `npm run check` phải sạch. Glob vitest: `server/**/*.test.ts`, `shared/**/*.test.ts`, `client/src/**/*.unit.test.ts`.

---

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `shared/rollupVerdict.ts` | **TẠO** — hàm THUẦN cuộn NG>NTF>OK, dùng chung server+client | 1 |
| `shared/rollupVerdict.test.ts` | **TẠO** — lưới cho hàm thuần | 1 |
| `drizzle/0338_product_config_tree.sql` | **TẠO** — 3 bảng cấu hình + 6 cột trên `measurement_point_defs` | 2 |
| `scripts/apply-migration-0338.mjs` | **TẠO** — áp 0338, hai kết nối (DDL owner / nghiệm thu app) | 2 |
| `drizzle/schema/productConfigTree.ts` | **TẠO** — khai Drizzle 3 bảng cấu hình | 2 |
| `drizzle/schema/product.ts` | **SỬA** — thêm 6 cột vào `measurementPointDefs` | 2 |
| `drizzle/0339_inspection_result_tree.sql` | **TẠO** — 3 bảng kết quả + cột trên 2 hypertable | 3 |
| `scripts/apply-migration-0339.mjs` | **TẠO** | 3 |
| `drizzle/schema/inspectionTree.ts` | **TẠO** — khai Drizzle 3 bảng kết quả | 3 |
| `drizzle/schema/inspection.ts` | **SỬA** — thêm cột vào `productInspections`, `measurementResults` | 3 |
| `drizzle/schema/index.ts` | **SỬA** — export hai file schema mới | 2, 3 |
| `server/contracts/machineDataContractV2.ts` | **TẠO** — hợp đồng v2.0 lồng 4 cấp | 4 |
| `server/contracts/machineDataContract.ts` | **SỬA** — đăng ký `"2.0"`, trỏ `LATEST`, từ chối v1.x có mã lỗi rõ | 4 |
| `server/contracts/machineDataContractV2.test.ts` | **TẠO** | 4 |
| `server/db/cayCauHinhBatBien.db.test.ts` | **TẠO** — bất biến "một sản phẩm không trộn phẳng/cây" | 5 |

---

### Task 1: `rollupVerdict` — hàm thuần cuộn NG > NTF > OK

Làm TRƯỚC mọi thứ: nó không cần DB, không cần schema, và mọi task sau đều dựa vào nó. Đặt ở `shared/` vì cả server (ingest) lẫn client (hiển thị cây) đều cần.

**Files:**
- Create: `shared/rollupVerdict.ts`
- Test: `shared/rollupVerdict.test.ts`

**Interfaces:**
- Produces:
  - `type ResultVerdict = "OK" | "NG" | "NTF"`
  - `type NtfSource = "machine" | "human" | "both"`
  - `interface NutKetQua { result: ResultVerdict; ntf: boolean; ntfSource?: NtfSource | null }`
  - `function rollupVerdict(con: readonly NutKetQua[]): { result: ResultVerdict; ntf: boolean; ntfSource: NtfSource | null }`

- [ ] **Step 1: Viết lưới ĐỎ**

```typescript
// shared/rollupVerdict.test.ts
import { describe, it, expect } from "vitest";
import { rollupVerdict, type NutKetQua } from "./rollupVerdict";

const n = (result: "OK" | "NG" | "NTF", ntf = false, ntfSource: "machine" | "human" | "both" | null = null): NutKetQua =>
  ({ result, ntf, ntfSource });

describe("rollupVerdict — NG > NTF > OK", () => {
  it("có bất kỳ NG ⇒ NG, kể cả khi cũng có NTF", () => {
    expect(rollupVerdict([n("OK"), n("NTF", true, "machine"), n("NG")]).result).toBe("NG");
  });

  it("không NG mà có NTF ⇒ NTF", () => {
    expect(rollupVerdict([n("OK"), n("NTF", true, "machine"), n("OK")]).result).toBe("NTF");
  });

  it("toàn OK ⇒ OK", () => {
    expect(rollupVerdict([n("OK"), n("OK")]).result).toBe("OK");
  });

  it("cờ ntf THÔ cuộn theo OR, độc lập với result", () => {
    // con NG nhưng cũng bị đánh dấu ntf ⇒ cha là NG, nhưng ntf thô vẫn true
    const r = rollupVerdict([n("NG", true, "machine"), n("OK")]);
    expect(r.result).toBe("NG");
    expect(r.ntf).toBe(true);
  });

  it("ntfSource: chỉ machine ⇒ machine", () => {
    expect(rollupVerdict([n("NTF", true, "machine"), n("OK")]).ntfSource).toBe("machine");
  });

  it("ntfSource: chỉ human ⇒ human", () => {
    expect(rollupVerdict([n("NTF", true, "human"), n("OK")]).ntfSource).toBe("human");
  });

  it("ntfSource: có cả hai ⇒ both", () => {
    expect(rollupVerdict([n("NTF", true, "machine"), n("NTF", true, "human")]).ntfSource).toBe("both");
  });

  it("ntfSource: 'both' ở một con cũng ra both", () => {
    expect(rollupVerdict([n("NTF", true, "both"), n("OK")]).ntfSource).toBe("both");
  });

  it("không con nào có ntf ⇒ ntfSource null", () => {
    expect(rollupVerdict([n("OK"), n("NG")]).ntfSource).toBeNull();
  });

  it("MẢNG RỖNG ⇒ OK / false / null — KHÔNG ném lỗi", () => {
    expect(rollupVerdict([])).toEqual({ result: "OK", ntf: false, ntfSource: null });
  });
});
```

⚠ Ca cuối cùng quan trọng: một `capture` không có `component` nào là **hình dạng hợp lệ** trong payload máy (đèn chụp mà không có linh kiện nào trong vùng). Ném lỗi ở đó sẽ làm vỡ ingest trên dữ liệu thật.

- [ ] **Step 2: Chạy — phải ĐỎ**

Run: `npx vitest run shared/rollupVerdict.test.ts`
Expected: FAIL — `Cannot find module './rollupVerdict'`

- [ ] **Step 3: Viết hàm thuần**

```typescript
// shared/rollupVerdict.ts

/** Kết quả một nút trong cây kiểm tra. `result` là phán quyết, `ntf` là CỜ THÔ máy gửi. */
export type ResultVerdict = "OK" | "NG" | "NTF";

/** NTF đến từ đâu: máy tự khai, người xác nhận, hay cả hai. */
export type NtfSource = "machine" | "human" | "both";

export interface NutKetQua {
  result: ResultVerdict;
  ntf: boolean;
  ntfSource?: NtfSource | null;
}

/**
 * Cuộn kết quả từ các nút con lên nút cha. **NG > NTF > OK.**
 *
 * Hai giá trị trả về CỐ Ý tách rời:
 *  - `result`: phán quyết theo thứ tự ưu tiên nghiệp vụ.
 *  - `ntf`: cờ THÔ, OR của các con. Một bo có thể vừa NG vừa bị máy đánh dấu ntf —
 *    `result` cho NG thắng, nhưng mất cờ thô là mất dữ kiện "máy cũng nghi báo giả".
 *
 * Mảng rỗng trả OK/false/null, KHÔNG ném lỗi: một capture không có component nào là
 * hình dạng HỢP LỆ trong payload máy (đèn chụp mà vùng không có linh kiện).
 *
 * ⚠ Hàm này KHÔNG chạy spec-gate. Thứ tự bắt buộc ở tầng gọi (spec §4.3):
 * chạy `evaluatePointResult` cho TỪNG component TRƯỚC, rồi mới cuộn lên. Cuộn trước
 * rồi mới gate sẽ để cấp trên chốt OK trong khi cấp lá đã bị nâng thành NG.
 */
export function rollupVerdict(
  con: readonly NutKetQua[],
): { result: ResultVerdict; ntf: boolean; ntfSource: NtfSource | null } {
  let coNg = false;
  let coNtf = false;
  let ntfTho = false;
  let coMachine = false;
  let coHuman = false;

  for (const c of con) {
    if (c.result === "NG") coNg = true;
    else if (c.result === "NTF") coNtf = true;
    if (c.ntf) ntfTho = true;
    if (c.ntfSource === "machine") coMachine = true;
    else if (c.ntfSource === "human") coHuman = true;
    else if (c.ntfSource === "both") { coMachine = true; coHuman = true; }
  }

  const result: ResultVerdict = coNg ? "NG" : coNtf ? "NTF" : "OK";
  const ntfSource: NtfSource | null =
    coMachine && coHuman ? "both" : coMachine ? "machine" : coHuman ? "human" : null;

  return { result, ntf: ntfTho, ntfSource };
}
```

- [ ] **Step 4: Chạy — phải XANH**

Run: `npx vitest run shared/rollupVerdict.test.ts`
Expected: PASS, 10/10.

- [ ] **Step 5: ĐỘT BIẾN — chứng minh lưới đỏ được**

Đổi tạm thứ tự ưu tiên: `const result = coNtf ? "NTF" : coNg ? "NG" : "OK";`
Run: `npx vitest run shared/rollupVerdict.test.ts`
Expected: **FAIL** ca "có bất kỳ NG ⇒ NG". Nếu XANH thì lưới vô dụng — sửa lưới trước.
Hoàn tác, chạy lại, xác nhận 10/10.

- [ ] **Step 6: Kiểm cổng census không tố nhầm + commit**

Run: `npm run check && npx vitest run server/utils/kpiCongThucCensus.test.ts`
Expected: check sạch, census 3/3 xanh.

```bash
git add shared/rollupVerdict.ts shared/rollupVerdict.test.ts
git commit -m "feat(aoi): rollupVerdict — hàm thuần cuộn NG>NTF>OK dùng chung server+client"
```

---

### Task 2: Migration 0338 — 3 bảng CẤU HÌNH + neo `measurement_point_defs`

**Files:**
- Create: `drizzle/0338_product_config_tree.sql`
- Create: `scripts/apply-migration-0338.mjs`
- Create: `drizzle/schema/productConfigTree.ts`
- Modify: `drizzle/schema/product.ts` (thêm 6 cột vào `measurementPointDefs`)
- Modify: `drizzle/schema/index.ts` (export file mới)

**Interfaces:**
- Produces (Drizzle): `productSurfaces`, `productPositions`, `productCaptures` từ `drizzle/schema/productConfigTree.ts`; `measurementPointDefs` có thêm `captureRowId`, `componentExtId`, `roiX`, `roiY`, `roiWidth`, `roiHeight`.

- [ ] **Step 1: Viết migration SQL**

```sql
-- drizzle/0338_product_config_tree.sql
-- Pha 1A — cây CẤU HÌNH 4 cấp: surface → position → capture → component.
--
-- `measurement_point_defs` TRỞ THÀNH chính cấp component (nó đã mang limits/tolerance/
-- criteria/variant/delta-sync/spec-gate/revert). KHÔNG tạo bảng component thứ hai —
-- hai bảng cùng chứa limits = hai nguồn sự thật cho ngưỡng phán NG.
--
-- Mọi cột thêm vào bảng cũ đều NULLABLE, không backfill: NULL = điểm đo phẳng cũ,
-- chạy y như trước.
--
-- ⚠ DDL phải chạy bằng owner `aoi` (`avi_app` → 42501).

CREATE TABLE IF NOT EXISTS product_surfaces (
  id                  serial PRIMARY KEY,
  "productModelId"    integer NOT NULL REFERENCES product_models(id) ON DELETE CASCADE,
  "surfaceName"       varchar(100) NOT NULL,
  "surfaceExtId"      varchar(64),
  "templateImageUrl"  text,
  "templateImageKey"  varchar(255),
  "orderIndex"        integer NOT NULL DEFAULT 0,
  "createdAt"         timestamp NOT NULL DEFAULT now(),
  "updatedAt"         timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_surfaces_model_name
  ON product_surfaces ("productModelId", "surfaceName");

CREATE TABLE IF NOT EXISTS product_positions (
  id                  serial PRIMARY KEY,
  "surfaceRowId"      integer NOT NULL REFERENCES product_surfaces(id) ON DELETE CASCADE,
  "positionId"        varchar(64) NOT NULL,
  "positionIndex"     integer,
  "name"              varchar(255),
  "shape"             varchar(20),
  "markerWidth"       numeric(10,4),
  "markerHeight"      numeric(10,4),
  "markerRadius"      numeric(10,4),
  -- Toạ độ TƯƠNG ĐỐI 0..1 trên ảnh template surface. Máy LUÔN gửi giá trị đã resolve
  -- (tài liệu mẫu ghi rõ), nên payload thiếu là lỗi hợp đồng, không phải cần suy đoán.
  -- Đặt tên relX/relY để không lẫn với roiX/roiY là PIXEL TUYỆT ĐỐI.
  "relX"              numeric(10,8),
  "relY"              numeric(10,8),
  "templateImageUrl"  text,
  "templateImageKey"  varchar(255),
  "createdAt"         timestamp NOT NULL DEFAULT now(),
  "updatedAt"         timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_positions_surface_posid
  ON product_positions ("surfaceRowId", "positionId");

CREATE TABLE IF NOT EXISTS product_captures (
  id                  serial PRIMARY KEY,
  "positionRowId"     integer NOT NULL REFERENCES product_positions(id) ON DELETE CASCADE,
  -- = Capture.Id phía máy (GUID). Khoá join sang manifest ảnh VÀ sang teach data.
  "captureExtId"      varchar(64) NOT NULL,
  "captureName"       varchar(255),
  "captureIndex"      integer,
  "templateImageUrl"  text,
  "templateImageKey"  varchar(255),
  "createdAt"         timestamp NOT NULL DEFAULT now(),
  "updatedAt"         timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_captures_position_extid
  ON product_captures ("positionRowId", "captureExtId");

-- Neo cấp component lên capture. NULL = điểm đo phẳng cũ.
ALTER TABLE measurement_point_defs ADD COLUMN IF NOT EXISTS "captureRowId"  integer REFERENCES product_captures(id) ON DELETE SET NULL;
ALTER TABLE measurement_point_defs ADD COLUMN IF NOT EXISTS "componentExtId" varchar(64);
ALTER TABLE measurement_point_defs ADD COLUMN IF NOT EXISTS "roiX"      integer;
ALTER TABLE measurement_point_defs ADD COLUMN IF NOT EXISTS "roiY"      integer;
ALTER TABLE measurement_point_defs ADD COLUMN IF NOT EXISTS "roiWidth"  integer;
ALTER TABLE measurement_point_defs ADD COLUMN IF NOT EXISTS "roiHeight" integer;

CREATE INDEX IF NOT EXISTS idx_point_defs_capture ON measurement_point_defs ("captureRowId")
  WHERE "captureRowId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_point_defs_component_ext ON measurement_point_defs ("componentExtId")
  WHERE "componentExtId" IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON product_surfaces, product_positions, product_captures TO avi_app;
GRANT USAGE, SELECT ON SEQUENCE product_surfaces_id_seq, product_positions_id_seq, product_captures_id_seq TO avi_app;
```

- [ ] **Step 2: Viết script áp migration theo khuôn hai-kết-nối**

Đọc `scripts/apply-migration-0327.mjs` và bắt chước **nguyên khuôn**: đổi user sang `aoi` cho DDL, mở kết nối **thứ hai bằng `avi_app`** cho nghiệm thu, hỗ trợ `--dev-only` / `--test-only`.

⚠ **Nghiệm thu BẮT BUỘC chạy bằng `avi_app`**, không phải `aoi`. `aoi` là superuser + BYPASSRLS + chủ sở hữu bảng ⇒ mọi phép đo quyền chạy bằng nó sẽ xanh kể cả khi GRANT hỏng hoàn toàn.

Nghiệm thu tối thiểu (bằng `avi_app`):
```sql
SELECT count(*) FROM product_surfaces;   -- phải chạy được, không 42501
INSERT INTO product_surfaces ("productModelId","surfaceName") VALUES (<id thật>, '_probe') RETURNING id;
DELETE FROM product_surfaces WHERE "surfaceName" = '_probe';
```

- [ ] **Step 3: Áp migration lên dev + test**

Run: `node scripts/apply-migration-0338.mjs`
Expected: in rõ từng bước, và phần nghiệm thu bằng `avi_app` **thành công** (SELECT + INSERT + DELETE).
Nếu nghiệm thu báo `42501`, GRANT chưa đúng — sửa migration, đừng sửa phép đo.

- [ ] **Step 4: Khai Drizzle cho 3 bảng mới**

Tạo `drizzle/schema/productConfigTree.ts` khai `productSurfaces`, `productPositions`, `productCaptures` **khớp chính xác** SQL trên (dùng `pgTable`, `serial`, `varchar`, `integer`, `numeric`, `timestamp`, `index`, `uniqueIndex`, `references`). Bắt chước khuôn `drizzle/schema/product.ts`.

Thêm 6 cột vào `measurementPointDefs` trong `drizzle/schema/product.ts`, **tất cả nullable**, kèm chú thích nêu rõ `captureRowId IS NULL` = điểm phẳng cũ.

Export file mới trong `drizzle/schema/index.ts`.

- [ ] **Step 5: Lưới khớp schema ↔ SQL**

Tạo `server/db/cayCauHinhSchema.db.test.ts`: với mỗi bảng mới, khẳng định **mọi cột khai trong Drizzle đều tồn tại thật trong DB** (hỏi `pg_attribute`), và ngược lại không cột DB nào bị thiếu trong Drizzle. Cộng một ca chống-tự-thoả: số cột đọc được phải `> 5`.

Run: `npx vitest run server/db/cayCauHinhSchema.db.test.ts`
Expected: PASS.

- [ ] **Step 6: Đột biến**

Thêm tạm một cột giả vào khai Drizzle (`_khongCoThat: integer("_khong_co_that")`) → lưới phải **ĐỎ**. Xoá → xanh.

- [ ] **Step 7: Commit**

```bash
npm run check
git add drizzle/0338_product_config_tree.sql scripts/apply-migration-0338.mjs drizzle/schema/productConfigTree.ts drizzle/schema/product.ts drizzle/schema/index.ts server/db/cayCauHinhSchema.db.test.ts
git commit -m "feat(aoi): cây cấu hình 4 cấp — product_surfaces/positions/captures + neo point_defs"
```

---

### Task 3: Migration 0339 — 3 bảng KẾT QUẢ + mở rộng 2 hypertable

**Files:**
- Create: `drizzle/0339_inspection_result_tree.sql`
- Create: `scripts/apply-migration-0339.mjs`
- Create: `drizzle/schema/inspectionTree.ts`
- Modify: `drizzle/schema/inspection.ts`
- Modify: `drizzle/schema/index.ts`

**Interfaces:**
- Consumes: `product_captures` (Task 2) — không FK tới nó từ bảng kết quả (kết quả tham chiếu theo `captureExtId` văn bản, vì cấu hình có thể đổi version).
- Produces (Drizzle): `inspectionSurfaces`, `inspectionPositions`, `inspectionCaptures`; `productInspections` thêm `ntfSource`, `machineProductIndex`, `configDriftFlags`, `summaryCounts`; `measurementResults` thêm `captureRowId`, `componentExtId`, `ntf`, `ntfSource`, `errorCode`, `errorDesc`, `startedAt`, `completedAt`.

- [ ] **Step 1: Viết migration SQL**

```sql
-- drizzle/0339_inspection_result_tree.sql
-- Pha 1A — cây KẾT QUẢ. Ba bảng thường, FK thật GIỮA CHÚNG; chỉ liên kết lên
-- product_inspections là MỀM (đích là hypertable ⇒ Postgres cấm FK tới hypertable).
--
-- inspectionTime được SAO xuống mọi cấp để dọn theo cửa sổ thời gian mà KHÔNG phải
-- join ngược vào hypertable.
--
-- Mỗi cấp lưu CẢ "cái máy KHAI" (result/ntf) LẪN "cái CUỘN ra từ con"
-- (rolledResult/rolledNtf) — lệch nhau ⇒ có bug ở máy hoặc ở ta, và PHÁT HIỆN ĐƯỢC.
--
-- ⚠ DDL bằng owner `aoi`.

CREATE TABLE IF NOT EXISTS inspection_surfaces (
  id                 serial PRIMARY KEY,
  "inspectionId"     integer NOT NULL,          -- SOFT ref → product_inspections.id
  "inspectionTime"   timestamp NOT NULL,
  "surfaceName"      varchar(100) NOT NULL,
  "surfaceExtId"     varchar(64),
  "result"           overallresultenum NOT NULL,
  "ntf"              boolean NOT NULL DEFAULT false,
  "ntfSource"        varchar(10),
  "rolledResult"     overallresultenum NOT NULL,
  "rolledNtf"        boolean NOT NULL DEFAULT false,
  "declaredMismatch" boolean NOT NULL DEFAULT false,
  "startedAt"        timestamp,
  "completedAt"      timestamp,
  "createdAt"        timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insp_surfaces_inspection ON inspection_surfaces ("inspectionId");
CREATE INDEX IF NOT EXISTS idx_insp_surfaces_time       ON inspection_surfaces ("inspectionTime");
CREATE INDEX IF NOT EXISTS idx_insp_surfaces_mismatch   ON inspection_surfaces ("declaredMismatch")
  WHERE "declaredMismatch";

CREATE TABLE IF NOT EXISTS inspection_positions (
  id                 serial PRIMARY KEY,
  "surfaceRowId"     integer NOT NULL REFERENCES inspection_surfaces(id) ON DELETE CASCADE,
  "inspectionId"     integer NOT NULL,
  "inspectionTime"   timestamp NOT NULL,
  "positionId"       varchar(64) NOT NULL,
  "positionNumber"   integer,
  "result"           overallresultenum NOT NULL,
  "ntf"              boolean NOT NULL DEFAULT false,
  "ntfSource"        varchar(10),
  "rolledResult"     overallresultenum NOT NULL,
  "rolledNtf"        boolean NOT NULL DEFAULT false,
  "declaredMismatch" boolean NOT NULL DEFAULT false,
  "startedAt"        timestamp,
  "completedAt"      timestamp,
  "createdAt"        timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insp_positions_surface ON inspection_positions ("surfaceRowId");
CREATE INDEX IF NOT EXISTS idx_insp_positions_time    ON inspection_positions ("inspectionTime");

CREATE TABLE IF NOT EXISTS inspection_captures (
  id                 serial PRIMARY KEY,
  "positionRowId"    integer NOT NULL REFERENCES inspection_positions(id) ON DELETE CASCADE,
  "inspectionId"     integer NOT NULL,
  "inspectionTime"   timestamp NOT NULL,
  "captureExtId"     varchar(64) NOT NULL,
  "captureName"      varchar(255),
  "captureIndex"     integer,
  -- Ở cấp capture, result/ntf là field TRỰC TIẾP từ pipeline máy (tài liệu mẫu ghi rõ:
  -- "không phải tự OR ngược từ components") ⇒ declaredMismatch ở đây có giá trị chẩn
  -- đoán mạnh nhất trong cả cây.
  "result"           overallresultenum NOT NULL,
  "ntf"              boolean NOT NULL DEFAULT false,
  "ntfSource"        varchar(10),
  "rolledResult"     overallresultenum NOT NULL,
  "rolledNtf"        boolean NOT NULL DEFAULT false,
  "declaredMismatch" boolean NOT NULL DEFAULT false,
  "startedAt"        timestamp,
  "completedAt"      timestamp,
  "createdAt"        timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_insp_captures_position_extid
  ON inspection_captures ("positionRowId", "captureExtId");
CREATE INDEX IF NOT EXISTS idx_insp_captures_time ON inspection_captures ("inspectionTime");

-- Mở rộng hai hypertable. §13 Đ-6: ADD COLUMN NULLABLE đã chứng minh an toàn trên
-- hypertable đã nén (Timescale 2.28.2). KHÔNG dùng NOT NULL DEFAULT.
ALTER TABLE product_inspections ADD COLUMN IF NOT EXISTS "ntfSource"           varchar(10);
ALTER TABLE product_inspections ADD COLUMN IF NOT EXISTS "machineProductIndex" integer;
ALTER TABLE product_inspections ADD COLUMN IF NOT EXISTS "configDriftFlags"    jsonb;
ALTER TABLE product_inspections ADD COLUMN IF NOT EXISTS "summaryCounts"       jsonb;

-- FK TỪ hypertable TỚI bảng thường là HỢP LỆ (chiều ngược lại mới bị cấm).
ALTER TABLE measurement_results ADD COLUMN IF NOT EXISTS "captureRowId"   integer;
ALTER TABLE measurement_results ADD COLUMN IF NOT EXISTS "componentExtId" varchar(64);
ALTER TABLE measurement_results ADD COLUMN IF NOT EXISTS "ntf"            boolean;
ALTER TABLE measurement_results ADD COLUMN IF NOT EXISTS "ntfSource"      varchar(10);
ALTER TABLE measurement_results ADD COLUMN IF NOT EXISTS "errorCode"      varchar(50);
ALTER TABLE measurement_results ADD COLUMN IF NOT EXISTS "errorDesc"      text;
ALTER TABLE measurement_results ADD COLUMN IF NOT EXISTS "startedAt"      timestamp;
ALTER TABLE measurement_results ADD COLUMN IF NOT EXISTS "completedAt"    timestamp;

CREATE INDEX IF NOT EXISTS idx_results_capture ON measurement_results ("captureRowId")
  WHERE "captureRowId" IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON inspection_surfaces, inspection_positions, inspection_captures TO avi_app;
GRANT USAGE, SELECT ON SEQUENCE inspection_surfaces_id_seq, inspection_positions_id_seq, inspection_captures_id_seq TO avi_app;
```

⚠ **`measurement_results.captureRowId` cố ý KHÔNG có FK trong migration này.** Lý do: Task 3 chỉ dựng schema; ràng buộc FK từ hypertable tới bảng thường tuy hợp lệ nhưng cần đo chi phí trên chunk đã nén — để Pha 1B quyết sau khi có dữ liệu thật. Ghi rõ trong chú thích SQL.

- [ ] **Step 2: Script áp + nghiệm thu bằng `avi_app`**

Cùng khuôn Task 2. Nghiệm thu tối thiểu: `avi_app` INSERT được vào cả ba bảng mới và SELECT được cột mới trên hai hypertable.

- [ ] **Step 3: Áp lên dev + test**

Run: `node scripts/apply-migration-0339.mjs`
Expected: nghiệm thu bằng `avi_app` thành công.

⚠ **Nếu `ALTER TABLE measurement_results ADD COLUMN` báo lỗi liên quan nén**, DỪNG và báo — §13 Đ-6 chỉ chứng minh với 1 chunk nén; nhiều chunk hơn có thể khác.

- [ ] **Step 4: Khai Drizzle cho 3 bảng kết quả**

Tạo `drizzle/schema/inspectionTree.ts` khai `inspectionSurfaces`, `inspectionPositions`, `inspectionCaptures` **khớp chính xác** SQL ở Step 1.

Ghi chú bắt buộc trong file:
- `inspectionSurfaces.inspectionId` là **soft ref**, KHÔNG `.references()` — đích `product_inspections` là hypertable, Postgres cấm FK tới nó.
- `inspectionPositions.surfaceRowId` và `inspectionCaptures.positionRowId` **CÓ** `.references(..., { onDelete: "cascade" })` — hai bảng thường, FK thật.
- Dùng `overallResultEnum` import từ `./enums` cho `result` và `rolledResult`.

Thêm 8 cột vào `measurementResults` và 4 cột vào `productInspections` trong `drizzle/schema/inspection.ts`, **tất cả nullable**, mỗi cột kèm một dòng chú thích nêu ý nghĩa (đặc biệt: `captureRowId` NULL = hàng lịch sử trước Pha 1; `componentExtId` = `ComponentProject.Id`, khoá join sang teach data).

Export `./inspectionTree` trong `drizzle/schema/index.ts`.

- [ ] **Step 5: Lưới khớp schema ↔ SQL**

Tạo `server/db/cayKetQuaSchema.db.test.ts`: với mỗi bảng trong `["inspection_surfaces","inspection_positions","inspection_captures"]`, hỏi `pg_attribute` lấy danh sách cột THẬT trong DB, rồi khẳng định **mọi cột khai trong Drizzle đều có mặt** và **không cột DB nào thiếu trong Drizzle**. Thêm hai ca nữa:
- khẳng định 8 cột mới của `measurement_results` và 4 cột mới của `product_inspections` **tồn tại thật** trong DB;
- ca chống-tự-thoả: tổng số cột đọc được từ `pg_attribute` cho ba bảng mới phải `> 30` (nếu truy vấn trả rỗng thì mọi so sánh bên trên tự thoả).

Run: `npx vitest run server/db/cayKetQuaSchema.db.test.ts`
Expected: PASS.

- [ ] **Step 6: Đột biến**

Thêm tạm vào khai Drizzle của `inspectionCaptures` một cột không tồn tại trong DB:
```typescript
_khongCoThat: integer("_khong_co_that"),
```
Run: `npx vitest run server/db/cayKetQuaSchema.db.test.ts`
Expected: **FAIL**, nêu đúng tên cột thừa. Nếu XANH thì lưới chỉ so một chiều — sửa lưới để so **cả hai chiều** rồi mới đi tiếp.
Xoá cột giả, chạy lại, xác nhận PASS.

- [ ] **Step 7: Commit**

```bash
npm run check
git add drizzle/0339_inspection_result_tree.sql scripts/apply-migration-0339.mjs drizzle/schema/inspectionTree.ts drizzle/schema/inspection.ts drizzle/schema/index.ts server/db/cayKetQuaSchema.db.test.ts
git commit -m "feat(aoi): cây kết quả 4 cấp — inspection_surfaces/positions/captures + mở rộng 2 hypertable"
```

---

### Task 4: Hợp đồng máy v2.0 — nhận cây lồng, từ chối v1.x CÓ MÃ LỖI RÕ

**Files:**
- Create: `server/contracts/machineDataContractV2.ts`
- Create: `server/contracts/machineDataContractV2.test.ts`
- Modify: `server/contracts/machineDataContract.ts`

**Interfaces:**
- Consumes: `rollupVerdict` (Task 1) — chỉ để test đối chiếu, hợp đồng không tự cuộn.
- Produces: `machineDataContractV2` (zod schema), `MACHINE_CONTRACT_VERSIONS["2.0"]`, `LATEST_MACHINE_CONTRACT_VERSION === "2.0"`, `loiMayChuaNangCap(schemaVersion: string): Error`.

- [ ] **Step 1: Đọc hợp đồng hiện có TRƯỚC khi viết**

Run: `sed -n '1,130p' server/contracts/machineDataContract.ts`
Ghi lại: khuôn `MACHINE_CONTRACT_VERSIONS`, `LATEST_MACHINE_CONTRACT_VERSION`, và hình dạng `measurementV11` (v1.1 là bản khớp ĐÚNG `submitInspection` thật).

- [ ] **Step 2: Viết lưới ĐỎ**

```typescript
// server/contracts/machineDataContractV2.test.ts
import { describe, it, expect } from "vitest";
import { machineDataContractV2 } from "./machineDataContractV2";
import { LATEST_MACHINE_CONTRACT_VERSION, MACHINE_CONTRACT_VERSIONS, loiMayChuaNangCap } from "./machineDataContract";

const boHopLe = {
  schemaVersion: "2.0",
  apiKey: "mk_test",
  identity: { station: "AIC-MA3", machine: "ASSY 04", line: "JUNIPER", plant: "FAC-HN", country: "VN", solutionName: "MODEL-X-SOLUTION", appVersion: "1.0.0" },
  productId: "b3f1c2a0-1111-4a2b-9c3d-000000000001",
  serialNumber: "SN123456",
  productModel: "MODEL-X",
  overallResult: "NG",
  ntf: false,
  machineProductIndex: 128,
  startedAt: "2026-08-18T09:30:00.000",
  completedAt: "2026-08-18T09:30:14.400",
  summary: { surfaces: { total: 1, pass: 0, ng: 1, ntf: 0 }, positions: { total: 1, pass: 0, ng: 1, ntf: 0 }, captures: { total: 1, pass: 0, ng: 1, ntf: 0 }, components: { total: 1, pass: 0, ng: 1, ntf: 0 } },
  surfaces: [{
    name: "TOP", result: "NG", ntf: false,
    positions: [{
      positionId: "P01", positionNumber: 1, result: "NG", ntf: false,
      captures: [{
        captureId: "a1b2c3d4-0000-4000-8000-000000001011", captureName: "Default", index: 0, result: "NG", ntf: false,
        components: [{
          componentId: "a1b2c3d4-0000-4000-8000-000000010111", componentName: "R12",
          result: "NG", ntf: false, value: "12.5", lowerLimit: "9", upperLimit: "11",
          errorCode: "E-VAL-01", errorDesc: "vuot nguong tren",
        }],
      }],
    }],
  }],
};

describe("machineDataContractV2 — cây 4 cấp", () => {
  it("nhận payload hợp lệ đủ 4 cấp", () => {
    expect(machineDataContractV2.safeParse(boHopLe).success).toBe(true);
  });

  it("giữ NGUYÊN VĂN componentId — khoá join sang teach data", () => {
    const p = machineDataContractV2.parse(boHopLe);
    expect(p.surfaces[0].positions[0].captures[0].components[0].componentId)
      .toBe("a1b2c3d4-0000-4000-8000-000000010111");
  });

  it("giữ NGUYÊN VĂN captureId — khoá join sang manifest ảnh", () => {
    const p = machineDataContractV2.parse(boHopLe);
    expect(p.surfaces[0].positions[0].captures[0].captureId)
      .toBe("a1b2c3d4-0000-4000-8000-000000001011");
  });

  it("capture KHÔNG có component nào vẫn HỢP LỆ (đèn chụp vùng trống)", () => {
    const b = structuredClone(boHopLe);
    b.surfaces[0].positions[0].captures[0].components = [];
    expect(machineDataContractV2.safeParse(b).success).toBe(true);
  });

  it("`ntf` là BOOL riêng, KHÔNG phải giá trị của result", () => {
    const b = structuredClone(boHopLe);
    b.surfaces[0].positions[0].captures[0].components[0].result = "NTF";
    expect(machineDataContractV2.safeParse(b).success).toBe(false);
  });

  it("THIẾU captureId ⇒ TỪ CHỐI (sai hợp đồng, không phải lệch nội dung)", () => {
    const b = structuredClone(boHopLe);
    delete (b.surfaces[0].positions[0].captures[0] as any).captureId;
    expect(machineDataContractV2.safeParse(b).success).toBe(false);
  });

  it("LATEST trỏ 2.0 và 2.0 có trong map phiên bản", () => {
    expect(LATEST_MACHINE_CONTRACT_VERSION).toBe("2.0");
    expect(MACHINE_CONTRACT_VERSIONS["2.0"]).toBeDefined();
  });

  it("v1.0 và v1.1 vẫn CÓ trong map — để từ chối CÓ LÝ DO, không phải để nhận", () => {
    expect(MACHINE_CONTRACT_VERSIONS["1.0"]).toBeDefined();
    expect(MACHINE_CONTRACT_VERSIONS["1.1"]).toBeDefined();
  });

  it("lỗi từ chối máy cũ NÊU RÕ phiên bản cần, không phải lỗi zod thô", () => {
    const e = loiMayChuaNangCap("1.1");
    expect(e.message).toContain("1.1");
    expect(e.message).toContain("2.0");
  });
});
```

- [ ] **Step 3: Chạy — ĐỎ**

Run: `npx vitest run server/contracts/machineDataContractV2.test.ts`
Expected: FAIL — không import được `machineDataContractV2`.

- [ ] **Step 4: Viết hợp đồng v2.0**

Tạo `server/contracts/machineDataContractV2.ts` bằng zod, lồng đúng 4 cấp theo `D:\SOURCES\AOIData\dashboard-sample.json`. Yêu cầu chính xác:
- `result` ở MỌI cấp: `z.enum(["OK","NG"])` — **KHÔNG** có `"NTF"`. NTF là **cờ `ntf` bool riêng**.
- `captureId`, `componentId`: `z.string().min(1)` — **bắt buộc**, chúng là khoá join.
- `components`: `z.array(...)` cho phép **rỗng**.
- `identity`: object 7 trường như mẫu.
- `summary`: 4 nhóm × `{total, pass, ng, ntf}` — lưu nguyên văn để đối chiếu.

Trong `machineDataContract.ts`: thêm `"2.0"` vào `MACHINE_CONTRACT_VERSIONS`, trỏ `LATEST_MACHINE_CONTRACT_VERSION = "2.0"`, và thêm:

```typescript
/**
 * Máy gửi payload phiên bản CŨ. Trả lỗi NÊU RÕ phiên bản cần, thay vì để zod ném
 * một đống lỗi trường mà kỹ sư hiện trường không đọc nổi.
 * Giữ v1.0/v1.1 trong map KHÔNG phải để nhận — mà để nhận DIỆN và từ chối có lý do.
 */
export function loiMayChuaNangCap(schemaVersion: string): Error {
  return new Error(
    `Máy đang gửi hợp đồng phiên bản "${schemaVersion}". Server chỉ nhận từ "2.0" trở lên ` +
    `(payload cây 4 cấp surface→position→capture→component). Nâng phần mềm máy trước khi gửi.`,
  );
}
```

- [ ] **Step 5: XANH**

Run: `npx vitest run server/contracts/machineDataContractV2.test.ts`
Expected: PASS, 9/9.

- [ ] **Step 6: Đột biến**

Đổi `result` ở cấp component thành `z.enum(["OK","NG","NTF"])` → ca "`ntf` là BOOL riêng" phải **ĐỎ**. Hoàn tác → xanh.

- [ ] **Step 7: Commit**

```bash
npm run check
git add server/contracts/machineDataContractV2.ts server/contracts/machineDataContractV2.test.ts server/contracts/machineDataContract.ts
git commit -m "feat(aoi): hợp đồng máy v2.0 cây 4 cấp, từ chối v1.x có mã lỗi rõ"
```

---

### Task 5: Bất biến "một sản phẩm KHÔNG trộn điểm phẳng và điểm cây"

Spec §3.3 đặt ra bất biến này ở tầng ứng dụng (không phải CHECK constraint, vì lúc *đang* chuyển đổi trong một transaction thì trạng thái nửa vời là hợp lệ). Task này dựng cổng canh nó.

**Files:**
- Create: `server/db/cayCauHinhBatBien.db.test.ts`

**Interfaces:**
- Consumes: `productSurfaces`, `productCaptures` (Task 2), `measurementPointDefs.captureRowId` (Task 2).

- [ ] **Step 1: Viết lưới**

```typescript
// server/db/cayCauHinhBatBien.db.test.ts
import { describe, it, expect } from "vitest";
import { getDb } from "./connection";
import { sql } from "drizzle-orm";

/**
 * BẤT BIẾN (spec §3.3): một `productModelId` HOẶC đã chuyển sang cây (mọi điểm live có
 * `captureRowId`), HOẶC còn phẳng (mọi điểm live có NULL). Trạng thái nửa vời là nguồn
 * của lỗi phân giải không thể chẩn đoán.
 *
 * Cố ý KHÔNG làm CHECK constraint: lúc ĐANG chuyển đổi trong một transaction thì nửa vời
 * là hợp lệ. Đây là cổng canh trạng thái ĐÃ COMMIT.
 */
describe("bất biến: sản phẩm không trộn điểm phẳng và điểm cây", () => {
  it("KHÔNG sản phẩm nào có CẢ điểm phẳng LẪN điểm cây", async () => {
    const db = await getDb();
    if (!db) throw new Error("không có DB test — chạy: node scripts/setup-test-db.mjs");
    const r: any = await db.execute(sql`
      SELECT "productModelId",
             count(*) FILTER (WHERE "captureRowId" IS NULL)     AS phang,
             count(*) FILTER (WHERE "captureRowId" IS NOT NULL) AS cay
      FROM measurement_point_defs
      WHERE "deletedAt" IS NULL
      GROUP BY "productModelId"
      HAVING count(*) FILTER (WHERE "captureRowId" IS NULL) > 0
         AND count(*) FILTER (WHERE "captureRowId" IS NOT NULL) > 0`);
    const rows = (r.rows ?? r) as Array<{ productModelId: number; phang: string; cay: string }>;
    expect(rows, `sản phẩm trộn hai loại: ${rows.map((x) => x.productModelId).join(", ")}`).toEqual([]);
  });

  it("mệnh đề KHÔNG tự thoả — phải có điểm đo trong bảng để phép đo có nghĩa", async () => {
    const db = await getDb();
    const r: any = await db!.execute(sql`
      SELECT count(*)::int AS n FROM measurement_point_defs WHERE "deletedAt" IS NULL`);
    const n = ((r.rows ?? r) as Array<{ n: number }>)[0].n;
    expect(n, "bảng rỗng ⇒ ca trên tự thoả, phép đo vô nghĩa").toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Chạy**

Run: `npx vitest run server/db/cayCauHinhBatBien.db.test.ts`
Expected: PASS 2/2.
⚠ Nếu ca thứ hai ĐỎ (bảng rỗng), **tự chèn vài điểm đo trong `beforeAll` và dọn ở `afterAll`** dùng `productModelId` riêng, rồi báo cáo rõ bạn đã làm vậy. `measurement_point_defs` **không** phải bảng WORM nên DELETE được.

- [ ] **Step 3: Đột biến**

Trong `beforeAll` tạm, dựng một sản phẩm có 1 điểm `captureRowId = NULL` và 1 điểm `captureRowId` trỏ tới một capture thật → ca thứ nhất phải **ĐỎ** và nêu đúng `productModelId`. Dọn → xanh.

- [ ] **Step 4: Commit**

```bash
npm run check
git add server/db/cayCauHinhBatBien.db.test.ts
git commit -m "test(aoi): bất biến sản phẩm không trộn điểm phẳng và điểm cây"
```

---

## Cổng ra Pha 1A

Chỉ sang Pha 1B khi cả sáu điều sau **đã chạy thật và có số**:

- [ ] `npx vitest run shared/rollupVerdict.test.ts` — 10/10, và **đột biến đảo thứ tự ưu tiên đã chạy thật** và làm nó đỏ.
- [ ] `node scripts/apply-migration-0338.mjs` và `0339` — nghiệm thu **bằng vai `avi_app`** thành công (không phải `aoi`).
- [ ] Hai lưới khớp schema↔SQL xanh, mỗi cái có đột biến cột-giả đã chạy.
- [ ] `npx vitest run server/contracts/machineDataContractV2.test.ts` — 9/9.
- [ ] `npx vitest run server/db/cayCauHinhBatBien.db.test.ts` — 2/2, ca chống-tự-thoả **có ý nghĩa** (bảng không rỗng).
- [ ] `npm run check` sạch · `npx vitest run server/utils/kpiCongThucCensus.test.ts` 3/3 · `npx vitest run server/db/khongBomInspectionBia.test.ts` 4/4 (hai cổng Pha 0 không bị đợt này phá).

**Không khai "xong" nếu thiếu bất kỳ mục nào.** Mục nào không làm được thì nói rõ mục đó và lý do.
