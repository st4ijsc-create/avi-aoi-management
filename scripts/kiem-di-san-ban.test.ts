/**
 * scripts/kiem-di-san-ban.test.ts
 *
 * ★★★ BG-127 v2 (Khối C, "nợ còn mở", 2026-09-05 — vá theo review coordinator,
 * Important 2) — lưới cho CHÍNH bộ dò `demDiSanBan` (`scripts/kiem-di-san-ban.mjs`).
 * v1 của bộ dò lọc SAI quần thể (`d."variantId" IS NOT NULL` — điểm variant TỰ
 * THÊM, trong khi `recordVariantOverrideVersion` LUÔN ghi vào điểm BASE,
 * `variantId IS NULL`) nên LUÔN trả 0 bất kể sự thật — "cổng xanh vì mù". Lưới
 * này buộc bộ dò phải KÊU trên MỘT ca dương đã biết trước khi được tin.
 *
 * Ca dương: seed một điểm BASE (`variantId` NULL) + một hàng
 * `measurement_point_versions` mang ĐÚNG chuỗi legacy mà
 * `recordVariantOverrideVersion` từng ghi TRƯỚC `02676ea2` (đo bằng git history,
 * xem docblock `kiem-di-san-ban.mjs`): `productVariant.setOverride (variant #<n>)`,
 * KHÔNG tiền tố `[VARIANT:]` — PHẢI được đếm.
 *
 * Ca âm (đối chứng, không được đếm):
 *   - hàng CÙNG điểm base nhưng ĐÃ mang tiền tố `[VARIANT:<n>]` (sau bản vá).
 *   - hàng base edit bình thường (changeReason tuỳ ý, không khớp dạng legacy).
 *   - hàng của một điểm VARIANT TỰ THÊM (`variantId` NOT NULL) mang y hệt chuỗi
 *     legacy — đây CHÍNH LÀ hình dạng mà v1 (sai) đã đếm nhầm; v2 PHẢI bỏ qua.
 *
 * Đo bằng HIỆU SỐ trước/sau (không phải giá trị tuyệt đối) — DB test dùng
 * chung với các lưới khác, có thể có sẵn hàng không liên quan.
 *
 * Chạy trên `aoi_management_test` qua `vitest.setup.ts` guard, vai `avi_app`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
// @ts-expect-error — plain .mjs module (script), no type declarations
import { demDiSanBan } from "./kiem-di-san-ban.mjs";

const DB_URL = process.env.DATABASE_URL;
const RUN = `BG127V2${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
let tenDb = "(chưa đo)";
const ids = { product: 0, base: 0, variantPoint: 0 };

describe.skipIf(!DB_URL)("BG-127 v2 — demDiSanBan (bộ dò di sản bẩn), DB thật vai avi_app", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const [d] = await sql<{ db: string; usr: string }[]>`SELECT current_database() AS db, current_user AS usr`;
    tenDb = d.db;
    expect(d.usr, "phải đo bằng vai avi_app").toBe("avi_app");
    // eslint-disable-next-line no-console
    console.log(`[BG-127 v2] current_database()=${d.db} current_user=${d.usr}`);

    const [pm] = await sql<{ id: number }[]>`
      INSERT INTO product_models (code, name, "lifecycleStatus")
      VALUES (${"BG127V2-" + RUN}, 'BG-127 v2 demDiSanBan', 'development') RETURNING id`;
    ids.product = pm.id;

    // Điểm BASE thật — variantId NULL (KHÔNG khai cột variantId ⇒ mặc định NULL),
    // đúng hình dạng mà recordVariantOverrideVersion LUÔN ghi vào.
    const [base] = await sql<{ id: number }[]>`
      INSERT INTO measurement_point_defs
        ("productModelId", code, name, "measurementType", "positionX", "positionY")
      VALUES (${ids.product}, ${"PBASE-" + RUN}, 'BG-127v2 base', 'DIMENSION', 10, 10) RETURNING id`;
    ids.base = base.id;

    // Điểm VARIANT TỰ THÊM — variantId NOT NULL. Soft-ref (không FK thật, xem
    // drizzle/schema/product.ts:397-398) nên dùng một số bất kỳ là đủ.
    const [vp] = await sql<{ id: number }[]>`
      INSERT INTO measurement_point_defs
        ("productModelId", code, name, "measurementType", "positionX", "positionY", "variantId")
      VALUES (${ids.product}, ${"PVAR-" + RUN}, 'BG-127v2 variant-added', 'DIMENSION', 20, 20, 999999) RETURNING id`;
    ids.variantPoint = vp.id;
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM measurement_point_versions WHERE "pointDefId" IN (${ids.base}, ${ids.variantPoint})`;
    await sql`DELETE FROM measurement_point_defs WHERE "productModelId" = ${ids.product}`;
    await sql`DELETE FROM product_models WHERE id = ${ids.product}`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("★★★ CA DƯƠNG — hàng legacy (điểm BASE, chuỗi 'productVariant.setOverride (variant #n)', không tiền tố) PHẢI được đếm", async () => {
    const before = await demDiSanBan(sql);

    await sql`
      INSERT INTO measurement_point_versions ("pointDefId", version, "snapshotJson", "changeReason")
      VALUES (${ids.base}, 1, ${sql.json({ upperLimit: "3" })}, ${"productVariant.setOverride (variant #7)"})
    `;

    const after = await demDiSanBan(sql);
    expect(after - before, `[${tenDb}] bộ dò PHẢI KÊU (+1) trên ca dương đã biết`).toBe(1);
  });

  it("ĐỐI CHỨNG #1 — hàng CÙNG điểm base nhưng ĐÃ mang tiền tố [VARIANT:n] KHÔNG được đếm thêm", async () => {
    const before = await demDiSanBan(sql);

    await sql`
      INSERT INTO measurement_point_versions ("pointDefId", version, "snapshotJson", "changeReason")
      VALUES (${ids.base}, 2, ${sql.json({ upperLimit: "3" })}, ${"[VARIANT:7] productVariant.setOverride"})
    `;

    const after = await demDiSanBan(sql);
    expect(after - before, `[${tenDb}] hàng ĐÃ tag không phải di sản bẩn`).toBe(0);
  });

  it("ĐỐI CHỨNG #2 — base edit bình thường (changeReason tuỳ ý) KHÔNG được đếm", async () => {
    const before = await demDiSanBan(sql);

    await sql`
      INSERT INTO measurement_point_versions ("pointDefId", version, "snapshotJson", "changeReason")
      VALUES (${ids.base}, 3, ${sql.json({ upperLimit: "5" })}, ${"day gioi han binh thuong"})
    `;

    const after = await demDiSanBan(sql);
    expect(after - before, `[${tenDb}] sửa base bình thường không phải di sản bẩn`).toBe(0);
  });

  it("★★★ ĐỐI CHỨNG #3 (chính hình dạng v1 đếm NHẦM) — hàng của điểm VARIANT TỰ THÊM mang y hệt chuỗi legacy KHÔNG được đếm", async () => {
    const before = await demDiSanBan(sql);

    await sql`
      INSERT INTO measurement_point_versions ("pointDefId", version, "snapshotJson", "changeReason")
      VALUES (${ids.variantPoint}, 1, ${sql.json({ upperLimit: "3" })}, ${"productVariant.setOverride (variant #7)"})
    `;

    const after = await demDiSanBan(sql);
    expect(
      after - before,
      `[${tenDb}] hàng của điểm variantId NOT NULL KHÔNG PHẢI quần thể mà recordVariantOverrideVersion ghi vào — v1 (sai) từng đếm nhầm đúng hình dạng này`,
    ).toBe(0);
  });
});
