/**
 * server/db/xoaGioiHanVeNull.db.test.ts
 *
 * ★★★ BG-123 (Khối C, "nợ còn mở", 2026-09-05, phần SERVER) — "xóa giới hạn về
 * NULL, có lịch sử". Trước bản vá này `measurementPoint.update`/`setLimitsBatch`
 * khai mọi cột giới hạn `z.string().optional()` ⇒ client KHÔNG có cách gửi
 * "xoá" (chỉ "để nguyên" hoặc "đặt giá trị mới"). Bản vá đổi sang
 * `z.string().nullable().optional()` (`undefined` = không đổi, `null` = XOÁ) —
 * xem `server/utils/measurementPointLimitGate.ts` (`xayZodShapeGioiHanNullable`)
 * + `server/routers/productRouters.ts`.
 *
 * Lưới NÀY đo tầng DB (`updateMeasurementPointDef`/`updateMeasurementPointLimitsBatch`,
 * `server/db/product.ts`) — hai hàm này ĐÃ đúng ngữ nghĩa "chỉ SET khi
 * `!== undefined`" từ trước (BG-108/Task 8 Khối C), nên `null` vốn đã chảy
 * xuống SET NULL mà KHÔNG cần sửa gì ở tầng này; lưới đo lại để CHỨNG MINH
 * (không chỉ suy luận) đúng ba mệnh đề brief đòi:
 *   1. cột SET NULL đúng.
 *   2. VẪN snapshot `measurement_point_versions` (giá trị TRƯỚC khi xoá) +
 *      bump version đúng 1.
 *   3. `evaluatePointResult` (hàm THUẦN) coi điểm hết limit là `evaluated:false`.
 * Đường ROUTER (bao gồm chặn `??` từng làm mất `null` — xem
 * `server/routers/measurementPointLimits.db.test.ts` §5) là nơi đo cửa duyệt
 * ngưỡng/gate qua tRPC caller thật.
 *
 * Chạy trên `aoi_management_test` qua `vitest.setup.ts` guard, vai `avi_app`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { updateMeasurementPointDef, updateMeasurementPointLimitsBatch } from "./product";
import { evaluatePointResult } from "../services/pointResultEvaluator";

const DB_URL = process.env.DATABASE_URL;
const RUN = `BG123${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
let tenDb = "(chưa đo)";
const ids = { product: 0, pointA: 0, pointB: 0, pointC: 0 };

describe.skipIf(!DB_URL)("BG-123 — xoá giới hạn về NULL, có lịch sử (tầng DB, vai avi_app, DB thật)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const [d] = await sql<{ db: string; usr: string }[]>`SELECT current_database() AS db, current_user AS usr`;
    tenDb = d.db;
    expect(d.usr, "phải đo bằng vai avi_app").toBe("avi_app");
    // eslint-disable-next-line no-console
    console.log(`[BG-123] current_database()=${d.db} current_user=${d.usr}`);

    const [pm] = await sql<{ id: number }[]>`
      INSERT INTO product_models (code, name, "lifecycleStatus")
      VALUES (${"BG123-" + RUN}, 'BG-123 xoa gioi han', 'development') RETURNING id`;
    ids.product = pm.id;

    const [pa] = await sql<{ id: number }[]>`
      INSERT INTO measurement_point_defs
        ("productModelId", code, name, "measurementType", "positionX", "positionY", "lowerLimit", "upperLimit")
      VALUES (${ids.product}, ${"PA-" + RUN}, 'BG-123 point A', 'DIMENSION', 10, 10, '1.000000', '10.000000') RETURNING id`;
    ids.pointA = pa.id;

    const [pb] = await sql<{ id: number }[]>`
      INSERT INTO measurement_point_defs
        ("productModelId", code, name, "measurementType", "positionX", "positionY", "heightMax")
      VALUES (${ids.product}, ${"PB-" + RUN}, 'BG-123 point B (batch 1)', 'DIMENSION', 20, 20, '5.000000') RETURNING id`;
    ids.pointB = pb.id;

    const [pc] = await sql<{ id: number }[]>`
      INSERT INTO measurement_point_defs
        ("productModelId", code, name, "measurementType", "positionX", "positionY", "heightMax")
      VALUES (${ids.product}, ${"PC-" + RUN}, 'BG-123 point C (batch 2)', 'DIMENSION', 30, 30, '7.000000') RETURNING id`;
    ids.pointC = pc.id;
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM measurement_point_versions WHERE "pointDefId" IN (${ids.pointA}, ${ids.pointB}, ${ids.pointC})`;
    await sql`DELETE FROM measurement_point_defs WHERE "productModelId" = ${ids.product}`;
    await sql`DELETE FROM product_models WHERE id = ${ids.product}`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("★★★ updateMeasurementPointDef: dạy upperLimit → xoá về NULL ⇒ cột NULL, snapshot giá trị CŨ, version +1", async () => {
    const [{ c: mpvBefore }] = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM measurement_point_versions WHERE "pointDefId" = ${ids.pointA}`;
    expect(mpvBefore, `[${tenDb}] chưa sửa gì — 0 hàng lịch sử`).toBe(0);

    await updateMeasurementPointDef(ids.pointA, { upperLimit: null } as never, {
      changeReason: "BG-123 luoi: xoa upperLimit ve NULL",
    });

    const [after] = await sql<{ lowerLimit: string | null; upperLimit: string | null }[]>`
      SELECT "lowerLimit", "upperLimit" FROM measurement_point_defs WHERE id = ${ids.pointA}`;
    expect(after.upperLimit, `[${tenDb}] cột PHẢI thành NULL`).toBeNull();
    expect(Number(after.lowerLimit), "lowerLimit KHÔNG bị đụng — vẫn 1").toBe(1);

    const hangTho = await sql<{ version: number; snapshotJson: any }[]>`
      SELECT version, "snapshotJson" FROM measurement_point_versions
       WHERE "pointDefId" = ${ids.pointA} ORDER BY version ASC`;
    expect(hangTho.length, `[${tenDb}] version PHẢI bump ĐÚNG 1 (đúng 1 hàng lịch sử mới)`).toBe(1);
    expect(hangTho[0].version).toBe(1);
    expect(
      Number(hangTho[0].snapshotJson.upperLimit),
      `[${tenDb}] snapshot PHẢI mang giá trị TRƯỚC khi xoá (10), KHÔNG PHẢI null`,
    ).toBe(10);
  });

  it("★★★ updateMeasurementPointLimitsBatch: xoá hàng loạt 2 điểm cùng lúc ⇒ cả hai NULL, 2 hàng lịch sử, version PRODUCT bump ĐÚNG 1", async () => {
    const [pmBefore] = await sql<{ pointsConfigVersion: number }[]>`
      SELECT "pointsConfigVersion" FROM product_models WHERE id = ${ids.product}`;

    const result = await updateMeasurementPointLimitsBatch(
      [
        { id: ids.pointB, heightMax: null },
        { id: ids.pointC, heightMax: null },
      ],
      { changeReason: "BG-123 luoi: xoa hang loat heightMax" },
    );
    expect(result.updated).toBe(2);

    const rows = await sql<{ id: number; heightMax: string | null }[]>`
      SELECT id, "heightMax" FROM measurement_point_defs WHERE id IN (${ids.pointB}, ${ids.pointC})`;
    for (const r of rows) {
      expect(r.heightMax, `[${tenDb}] điểm ${r.id} PHẢI thành NULL`).toBeNull();
    }

    const [{ c: mpvB }] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM measurement_point_versions WHERE "pointDefId" = ${ids.pointB}`;
    const [{ c: mpvC }] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM measurement_point_versions WHERE "pointDefId" = ${ids.pointC}`;
    expect(mpvB, "điểm B: đúng 1 hàng snapshot (giá trị CŨ trước khi xoá)").toBe(1);
    expect(mpvC, "điểm C: đúng 1 hàng snapshot (giá trị CŨ trước khi xoá)").toBe(1);

    const [snapB] = await sql<{ snapshotJson: any }[]>`SELECT "snapshotJson" FROM measurement_point_versions WHERE "pointDefId" = ${ids.pointB}`;
    const [snapC] = await sql<{ snapshotJson: any }[]>`SELECT "snapshotJson" FROM measurement_point_versions WHERE "pointDefId" = ${ids.pointC}`;
    expect(Number(snapB.snapshotJson.heightMax), "snapshot B mang giá trị CŨ (5)").toBe(5);
    expect(Number(snapC.snapshotJson.heightMax), "snapshot C mang giá trị CŨ (7)").toBe(7);

    const [pmAfter] = await sql<{ pointsConfigVersion: number }[]>`
      SELECT "pointsConfigVersion" FROM product_models WHERE id = ${ids.product}`;
    expect(
      pmAfter.pointsConfigVersion,
      "MỘT lần bump cho cả batch (2 điểm), KHÔNG phải 2 lần",
    ).toBe(pmBefore.pointsConfigVersion + 1);
  });

  it("★★★ evaluatePointResult (hàm THUẦN) — limit đã xoá về NULL tường minh ⇒ evaluated:false (KHÁC ca `{}` vắng mặt đã có)", () => {
    // ★ Khác với ca đã có `evaluatePointResult({}, ...)` (limit VẮNG MẶT hoàn
    // toàn) — ca này khẳng định limit NULL TƯỜNG MINH (đúng hình dạng bản ghi
    // SAU khi cột bị SET NULL bởi bản vá BG-123, đọc lại qua drizzle) cũng
    // được coi là "không có giới hạn", không phải bị hiểu nhầm thành "0".
    const def = { lowerLimit: null, upperLimit: null, heightMin: null, heightMax: null };
    const r = evaluatePointResult(def, { measuredValue: "999", valueHeight: "50" }, "OK");
    expect(r.evaluated, "điểm hết limit (null tường minh) ⇒ KHÔNG được chấm").toBe(false);
    expect(r.result, "verdict máy đi qua NGUYÊN VẸN, không bị ghi đè").toBe("OK");
  });
});
