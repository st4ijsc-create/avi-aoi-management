/**
 * server/db/lienKetBoTrongBienThe.db.test.ts
 *
 * ★★★ BG-128 (Khối C, "nợ còn mở", 2026-09-05) — BẤT BIẾN "liên kết bỏ trống"
 * của đường revert: hàng `measurement_point_versions` sinh từ variant-override
 * (`recordVariantOverrideVersion`, `server/db/product.ts`) LUÔN mang
 * `productPointsConfigVersion IS NULL` — không phải vì ai thiết kế "biến thể
 * không có version sản phẩm", mà vì cột đó khai "phiên bản SẢN PHẨM lúc
 * snapshot" và một override VARIANT không có nghĩa rõ ràng dưới khái niệm đó
 * (xem docblock ngay tại write-site, `recordVariantOverrideVersion`). CHÍNH
 * cái NULL này là lý do `revertPointsConfigToVersion` (VERSION-EXACT revert)
 * KHÔNG BAO GIỜ kéo giới hạn của một biến thể đè lên điểm BASE khi phục hồi
 * theo version.
 *
 * Ai "cải tiến" bằng cách đóng dấu (stamp) `productPointsConfigVersion` thật
 * cho hàng biến thể (ví dụ nghĩ "ghi luôn version hiện tại cho đủ") sẽ MỞ lại
 * đúng lỗ này — `revertPointsConfigToVersion` sẽ coi hàng đó là một mốc
 * snapshot BASE hợp lệ và có thể phục hồi điểm base về giá trị CHỈ từng tồn
 * tại trên biến thể. Lưới dưới đây đo đúng hai vế:
 *   1) hàng do `recordVariantOverrideVersion` ghi có cột NULL (đo trực tiếp).
 *   2) NULL đó khiến `napLichSuGioiHanTheoDiem` (đường đọc v2) lọc bỏ hàng đó,
 *      VÀ khiến `revertPointsConfigToVersion` bỏ qua hoàn toàn hàng đó khi
 *      chọn mốc phục hồi — đo bằng hành vi THẬT (revert ra giá trị BASE, không
 *      phải giá trị "canary" chỉ có trên biến thể), không chỉ đọc cột.
 *
 * Đột biến (xem cuối file, KHÔNG chạy tự động — chép tay để tái hiện khi cần)
 * chứng minh lưới này ĐỎ khi bất biến bị phá.
 *
 * Chạy trên `aoi_management_test` qua `vitest.setup.ts` guard, vai `avi_app`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import {
  updateMeasurementPointDef,
  recordVariantOverrideVersion,
  createVariant,
  bumpPointsConfigVersion,
  revertPointsConfigToVersion,
  RE_TIEN_TO_VERSION_BIEN_THE,
} from "./product";
import { napLichSuGioiHanTheoDiem } from "./cayDay";

const DB_URL = process.env.DATABASE_URL;
const RUN = `BG128${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
let tenDb = "(chưa đo)";
const ids = { product: 0, point: 0, variant: 0 };

describe.skipIf(!DB_URL)(
  "BG-128 — hàng variant-override PHẢI productPointsConfigVersion=NULL, revert KHÔNG kéo giới hạn biến thể đè base (vai avi_app, DB thật)",
  () => {
    beforeAll(async () => {
      sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
      const [d] = await sql<{ db: string; usr: string }[]>`SELECT current_database() AS db, current_user AS usr`;
      tenDb = d.db;
      expect(d.usr, "phải đo bằng vai avi_app").toBe("avi_app");
      // eslint-disable-next-line no-console
      console.log(`[BG-128] current_database()=${d.db} current_user=${d.usr}`);

      const [pm] = await sql<{ id: number }[]>`
        INSERT INTO product_models (code, name, "lifecycleStatus")
        VALUES (${"BG128-" + RUN}, 'BG-128 lien ket bo trong', 'development') RETURNING id`;
      ids.product = pm.id;

      const [mp] = await sql<{ id: number }[]>`
        INSERT INTO measurement_point_defs
          ("productModelId", code, name, "measurementType", "positionX", "positionY")
        VALUES (${ids.product}, ${"PT-" + RUN}, 'BG-128 point', 'DIMENSION', 10, 10) RETURNING id`;
      ids.point = mp.id;

      const varId = await createVariant({ productModelId: ids.product, code: "EU", name: "EU", isBase: false } as never);
      ids.variant = varId;
    }, 60_000);

    afterAll(async () => {
      if (!sql) return;
      await sql`DELETE FROM measurement_point_versions WHERE "pointDefId" = ${ids.point}`;
      await sql`DELETE FROM variant_point_overrides WHERE "basePointDefId" = ${ids.point}`;
      await sql`DELETE FROM product_variants WHERE id = ${ids.variant}`;
      await sql`DELETE FROM measurement_point_defs WHERE "productModelId" = ${ids.product}`;
      await sql`DELETE FROM product_models WHERE id = ${ids.product}`;
      await sql.end({ timeout: 5 });
    }, 60_000);

    it("★★★ NULL trên hàng override + napLichSuGioiHanTheoDiem lọc bỏ + revert KHÔNG kéo giá trị biến thể đè base", async () => {
      // BƯỚC 1 — OVERRIDE biến thể khi sản phẩm còn ở pointsConfigVersion=1 (mặc
      // định lúc tạo, xem drizzle/schema/product.ts). "canary" upperLimit=777 —
      // giá trị CHỈ tồn tại trên biến thể, không bao giờ xuất hiện trên hàng
      // base thật (cùng khuôn "canary" mà lưới NEW-3 dùng).
      const canary = { lowerLimit: null, upperLimit: "777" };
      await recordVariantOverrideVersion(ids.point, ids.variant, canary, {
        changeReason: "BG-128 luoi: override canary",
      });

      // ── ĐO TRỰC TIẾP #1 — cột productPointsConfigVersion IS NULL ──────────
      const [hangOverride] = await sql<
        { id: number; changeReason: string | null; productPointsConfigVersion: number | null }[]
      >`
        SELECT id, "changeReason", "productPointsConfigVersion" FROM measurement_point_versions
         WHERE "pointDefId" = ${ids.point} ORDER BY version ASC LIMIT 1`;
      expect(hangOverride.changeReason ?? "", "hàng đầu tiên phải là hàng override (tiền tố [VARIANT:])").toMatch(
        RE_TIEN_TO_VERSION_BIEN_THE,
      );
      expect(
        hangOverride.productPointsConfigVersion,
        `[${tenDb}] BG-128: hàng variant-override PHẢI NULL productPointsConfigVersion`,
      ).toBeNull();

      // BƯỚC 2 — bump sản phẩm 1→2 (mô phỏng một lượt sửa khác đã xảy ra), rồi
      // dạy BASE (upperLimit "50") — snapshot TRƯỚC lượt sửa này (giá trị null
      // gốc) được stamp bằng version SẢN PHẨM lúc đó (2, đọc TRONG transaction,
      // TRƯỚC bump tiếp theo — đúng khuôn 0282 mirror `updateMeasurementPointDef`).
      const bump1 = await bumpPointsConfigVersion(ids.product);
      expect(bump1?.version, "bump lần 1 phải đưa version 1→2").toBe(2);
      await updateMeasurementPointDef(ids.point, { upperLimit: "50" } as never, {
        changeReason: "BG-128 luoi: day BASE sau override",
      });
      // Mô phỏng router: bump SAU khi ghi (giống measurementPoint.update thật).
      const bump2 = await bumpPointsConfigVersion(ids.product);
      expect(bump2?.version, "bump lần 2 phải đưa version 2→3").toBe(3);

      // ── ĐO TRỰC TIẾP #2 — đúng 2 hàng lịch sử, hàng dạy-base (thứ hai) stamp=2 ──
      const hangTho = await sql<
        { id: number; changeReason: string | null; productPointsConfigVersion: number | null }[]
      >`
        SELECT id, "changeReason", "productPointsConfigVersion" FROM measurement_point_versions
         WHERE "pointDefId" = ${ids.point} ORDER BY version ASC`;
      expect(hangTho.length, `[${tenDb}] phải có đúng 2 hàng lịch sử (1 override + 1 dạy base)`).toBe(2);
      expect(hangTho[0].productPointsConfigVersion, "hàng override VẪN NULL").toBeNull();
      expect(hangTho[1].productPointsConfigVersion, "hàng dạy base PHẢI stamp version SẢN PHẨM lúc đó (2)").toBe(2);

      // ★★★ BẰNG CHỨNG PHỤ — napLichSuGioiHanTheoDiem (đường ĐỌC v2) PHẢI lọc
      // bỏ hàng override (tiền tố [VARIANT:]) — chỉ còn hàng dạy base.
      const lichSu = await napLichSuGioiHanTheoDiem([ids.point]);
      const cuaDiem = lichSu.get(ids.point) ?? [];
      expect(cuaDiem.length, `[${tenDb}] v2 chỉ được thấy 1 hàng (dạy base) — hàng override phải bị lọc`).toBe(1);
      expect(cuaDiem[0].limits.upperLimit ?? null, "hàng còn lại là snapshot TRƯỚC lượt dạy base (null)").toBeNull();

      // ════════════════════════════════════════════════════════════════════
      // ★★★ BẰNG CHỨNG CHÍNH BG-128 — revertPointsConfigToVersion(targetVersion=1)
      // PHẢI bỏ qua HOÀN TOÀN hàng override (NULL ⇒ không lọt vào tập `stamped`
      // trong `revertPointsConfigToVersion`) — phục hồi điểm về giá trị BASE
      // (upperLimit=null, từ hàng dạy-base snapshot TRƯỚC lượt sửa lên "50"),
      // TUYỆT ĐỐI KHÔNG PHẢI canary "777" của biến thể.
      // ════════════════════════════════════════════════════════════════════
      const summary = await revertPointsConfigToVersion(ids.product, 1, {
        changeReason: "BG-128 luoi: revert ve version 1",
      });
      expect(summary, "revert phải thành công (sản phẩm chưa bị xoá mềm)").not.toBeNull();
      expect(summary!.pointsReverted, "điểm PHẢI được revert (có hàng stamp=2 >= targetVersion=1 hợp lệ)").toBe(1);

      const [sauRevert] = await sql<{ upperLimit: string | null }[]>`
        SELECT "upperLimit" FROM measurement_point_defs WHERE id = ${ids.point}`;
      expect(
        sauRevert.upperLimit,
        `[${tenDb}] ★★★ BG-128 — revert PHẢI phục hồi giá trị BASE (null), KHÔNG PHẢI canary "777" của biến thể`,
      ).toBeNull();
    }, 60_000);

    // ════════════════════════════════════════════════════════════════════════
    // ★ ĐỘT BIẾN — ĐÃ CHẠY TAY THẬT (không sống trong lưới tự động — sửa
    // `server/db/product.ts` tạm thời, chạy, rồi hoàn tác nguyên văn):
    //
    //   if (stampConfigVersion) {
    //     const [rowTamThoi] = await db
    //       .select({ v: productModels.pointsConfigVersion })
    //       .from(measurementPointDefs)
    //       .innerJoin(productModels, eq(productModels.id, measurementPointDefs.productModelId))
    //       .where(eq(measurementPointDefs.id, basePointDefId))
    //       .limit(1);
    //     versionRow.productPointsConfigVersion = rowTamThoi?.v != null ? Number(rowTamThoi.v) : null;
    //   }
    //
    // (thay cho `if (stampConfigVersion) versionRow.productPointsConfigVersion = null;`
    // — đóng dấu version SẢN PHẨM THẬT tại thời điểm ghi override thay vì null.)
    //
    // KẾT QUẢ ĐO ĐƯỢC (đã bắt ngay ở assertion ĐẦU TIÊN, chưa cần chạy tới
    // nhánh revert):
    //   FAIL server/db/lienKetBoTrongBienThe.db.test.ts > … > ★★★ NULL trên
    //   hàng override + napLichSuGioiHanTheoDiem lọc bỏ + revert KHÔNG kéo giá
    //   trị biến thể đè base
    //   AssertionError: [aoi_management_test] BG-128: hàng variant-override
    //   PHẢI NULL productPointsConfigVersion: expected 1 to be null
    //   - Expected: null
    //   + Received: 1
    //
    // Đã hoàn tác `server/db/product.ts` về nguyên văn (`= null`) ngay sau khi
    // xác nhận ĐỎ; chạy lại lưới → XANH trở lại (1 test passed).
    // ════════════════════════════════════════════════════════════════════════
  },
);
