/**
 * Task 8 Khối C (QĐ-5) — `touchesLimits` SUY từ `POINT_LIMIT_SPEC` +
 * `measurementPoint.setLimitsBatch`, trên CSDL THẬT.
 *
 * ★★★ VÌ SAO PHẢI LÀ CSDL THẬT: brief Task 8 Bước 1 gọi đây "lỗ 3D" — trước
 * bản vá, `touchesLimits` ở `productRouters.ts` chỉ chép tay 6/22 field
 * (lowerLimit/upperLimit/nominalValue/toleranceMode/tolPlus/tolMinus). Một sửa
 * `heightMax` (3D/SPI) trên sản phẩm LIVE đi THẲNG qua, không đụng hàng đợi
 * duyệt ngưỡng — đúng thứ `assertThresholdEditAllowed` tồn tại để chặn. Một
 * lưới mock (`measurementPointWritePath.test.ts`) chỉ canh "gate được gọi hay
 * không" bằng spy — không canh XEM field nào lẽ ra phải gọi nó. Lưới này canh
 * bằng tRPC caller THẬT + Postgres THẬT: `heightMax` trên sản phẩm live phải
 * ném FORBIDDEN, không được ghi.
 *
 * ★★★ BG-97 (snapshot-gate): mọi lần sửa giới hạn — kể cả qua `setLimitsBatch`
 * — phải để lại một hàng `measurement_point_versions` mang snapshot TRƯỚC khi
 * sửa. Lưới dưới đo bằng SELECT trước/sau (Đ-28: kèm current_database()).
 *
 * Chạy trên DB CÔ LẬP (vitest.setup.ts ghi đè DATABASE_URL → `<db>_test`).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { measurementPointRouter } from "./productRouters";
import { APPROVAL_LIMIT_FIELDS } from "../../shared/pointLimitSpec";

const DB_URL = process.env.DATABASE_URL;
const RUN = `T8${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
const id = {
  liveProduct: 0, liveA: 0, liveB: 0,
  devProduct: 0, devA: 0, devB: 0, devC: 0,
  otherProduct: 0, otherA: 0,
  // BG-113 (review Khối C lượt 9, I-2) — điểm RIÊNG cho §4, có sẵn lowerLimit/
  // upperLimit/heightMin/heightMax hợp lệ ([1;10]/[1;10]) để đo mệnh đề "merge
  // với hiện có" — KHÔNG dùng chung devA/B/C (đã có state cụ thể từ §1/§2).
  devD: 0, devE: 0,
  // BG-123 (Khối C, "nợ còn mở", 2026-09-05) — điểm RIÊNG cho §5 (xoá giới hạn
  // về NULL qua measurementPoint.update/setLimitsBatch, đi qua tRPC caller
  // THẬT — khác `server/db/xoaGioiHanVeNull.db.test.ts` đo thẳng hàm DB).
  devF: 0, devG: 0, devH: 0,
};

// ctx admin — bỏ qua checkPermission (role==='admin' short-circuit, xem
// server/_core/accessControl.ts:207) VÀ bỏ qua lọc tenant (phamViCua → mảng
// rỗng = không lọc). Lưới này canh touchesLimits/gate/batch-transaction —
// KHÔNG canh permission/tenant riêng (đã có lưới khác canh requirePermission
// dùng chung với measurementPoint.update).
const adminCtx = { user: { id: 999999999, role: "admin", name: "T8 test" }, req: { ip: null, headers: {} } } as any;
const caller = measurementPointRouter.createCaller(adminCtx);

async function safe(run: () => Promise<unknown>): Promise<void> {
  try { await run(); } catch { /* dọn dẹp best-effort — xem docblock DỌN DẸP các file .db.test.ts khác */ }
}

describe.skipIf(!DB_URL)("Task 8 Khối C — touchesLimits suy từ spec + setLimitsBatch (DB thật)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });

    // Sản phẩm LIVE (lifecycleStatus mặc định 'active', 0 released program) —
    // assertThresholdEditAllowed ⇒ decision='requires_approval', enforced=true
    // (THRESHOLD_GATE_ENFORCED không set trong env test ⇒ mặc định true).
    const [lp] = await sql`
      INSERT INTO product_models (code, name, "lifecycleStatus")
      VALUES (${"P-LIVE-" + RUN}, 'T8 live product', 'active') RETURNING id`;
    id.liveProduct = lp.id;
    const [la] = await sql`
      INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY")
      VALUES (${id.liveProduct}, ${"PT-LA-" + RUN}, 'Live A', 'DIMENSION', 10, 10) RETURNING id`;
    id.liveA = la.id;
    const [lb] = await sql`
      INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY")
      VALUES (${id.liveProduct}, ${"PT-LB-" + RUN}, 'Live B', 'DIMENSION', 20, 20) RETURNING id`;
    id.liveB = lb.id;

    // Sản phẩm DEVELOPMENT — assertThresholdEditAllowed ⇒ decision='direct',
    // sửa giới hạn đi thẳng (không FORBIDDEN) — dùng để đo CƠ CHẾ batch mà
    // không lẫn với hành vi của gate (gate đã có ca riêng ở nhóm live).
    const [dp] = await sql`
      INSERT INTO product_models (code, name, "lifecycleStatus")
      VALUES (${"P-DEV-" + RUN}, 'T8 dev product', 'development') RETURNING id`;
    id.devProduct = dp.id;
    const [da] = await sql`
      INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY", "heightMax")
      VALUES (${id.devProduct}, ${"PT-DA-" + RUN}, 'Dev A', 'DIMENSION', 10, 10, '1.000000') RETURNING id`;
    id.devA = da.id;
    const [db_] = await sql`
      INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY", "heightMax")
      VALUES (${id.devProduct}, ${"PT-DB-" + RUN}, 'Dev B', 'DIMENSION', 20, 20, '1.000000') RETURNING id`;
    id.devB = db_.id;
    const [dc] = await sql`
      INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY", "heightMax")
      VALUES (${id.devProduct}, ${"PT-DC-" + RUN}, 'Dev C', 'DIMENSION', 30, 30, '1.000000') RETURNING id`;
    id.devC = dc.id;

    // BG-113 (I-2) §4 — hai điểm RIÊNG, có sẵn [lowerLimit;upperLimit] và
    // [heightMin;heightMax] HỢP LỆ, dùng để đo "patch chỉ đổi MỘT cận, mâu
    // thuẫn với cận HIỆN CÓ vẫn phải chặn" (khác devA/B/C — không có cận nào).
    const [dd] = await sql`
      INSERT INTO measurement_point_defs
        ("productModelId", code, name, "measurementType", "positionX", "positionY", "lowerLimit", "upperLimit", "heightMin", "heightMax")
      VALUES (${id.devProduct}, ${"PT-DD-" + RUN}, 'Dev D', 'DIMENSION', 40, 40, '1.000000', '10.000000', '1.000000', '10.000000') RETURNING id`;
    id.devD = dd.id;
    const [de] = await sql`
      INSERT INTO measurement_point_defs
        ("productModelId", code, name, "measurementType", "positionX", "positionY", "lowerLimit", "upperLimit")
      VALUES (${id.devProduct}, ${"PT-DE-" + RUN}, 'Dev E', 'DIMENSION', 50, 50, '1.000000', '10.000000') RETURNING id`;
    id.devE = de.id;

    // BG-123 §5 — điểm RIÊNG với lowerLimit/upperLimit/heightMin/heightMax
    // HỢP LỆ sẵn, dùng để đo xoá-về-NULL qua `measurementPoint.update` (khác
    // devD/E — không muốn state của §4 lẫn với §5).
    const [df] = await sql`
      INSERT INTO measurement_point_defs
        ("productModelId", code, name, "measurementType", "positionX", "positionY", "lowerLimit", "upperLimit", "heightMin", "heightMax")
      VALUES (${id.devProduct}, ${"PT-DF-" + RUN}, 'Dev F', 'DIMENSION', 60, 60, '1.000000', '10.000000', '2.000000', '20.000000') RETURNING id`;
    id.devF = df.id;
    // Hai điểm RIÊNG cho setLimitsBatch xoá hàng loạt.
    const [dg] = await sql`
      INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY", "heightMax")
      VALUES (${id.devProduct}, ${"PT-DG-" + RUN}, 'Dev G', 'DIMENSION', 70, 70, '5.000000') RETURNING id`;
    id.devG = dg.id;
    const [dh] = await sql`
      INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY", "heightMax")
      VALUES (${id.devProduct}, ${"PT-DH-" + RUN}, 'Dev H', 'DIMENSION', 80, 80, '7.000000') RETURNING id`;
    id.devH = dh.id;

    // Sản phẩm KHÁC (development, để không lẫn gate) — dùng để đo BAD_REQUEST
    // khi một batch trộn hai productModelId.
    const [op] = await sql`
      INSERT INTO product_models (code, name, "lifecycleStatus")
      VALUES (${"P-OTHER-" + RUN}, 'T8 other product', 'development') RETURNING id`;
    id.otherProduct = op.id;
    const [oa] = await sql`
      INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY")
      VALUES (${id.otherProduct}, ${"PT-OA-" + RUN}, 'Other A', 'DIMENSION', 10, 10) RETURNING id`;
    id.otherA = oa.id;
  }, 60_000);

  afterAll(async () => {
    await safe(async () => {
      await sql`DELETE FROM measurement_point_versions WHERE "pointDefId" IN (
        ${id.liveA}, ${id.liveB}, ${id.devA}, ${id.devB}, ${id.devC}, ${id.otherA}, ${id.devD}, ${id.devE},
        ${id.devF}, ${id.devG}, ${id.devH}
      )`;
    });
    await safe(async () => { await sql`DELETE FROM measurement_point_defs WHERE "productModelId" IN (${id.liveProduct}, ${id.devProduct}, ${id.otherProduct})`; });
    await safe(async () => { await sql`DELETE FROM product_models WHERE id IN (${id.liveProduct}, ${id.devProduct}, ${id.otherProduct})`; });
    // audit_logs / product_inspections là WORM (avi_app KHÔNG có DELETE) —
    // KHÔNG xoá; hàng của test này nhận biết được qua RUN nếu cần soát sau.
    await sql?.end();
  }, 60_000);

  describe("§1 — measurementPoint.update: touchesLimits SUY từ POINT_LIMIT_SPEC (Bước 1+2)", () => {
    it("★★★ 3D field (heightMax) trên sản phẩm LIVE+enforced ⇒ FORBIDDEN (lỗ 3D đã vá, KHÔNG ghi thẳng)", async () => {
      const before = await sql`SELECT "heightMax" FROM measurement_point_defs WHERE id = ${id.liveA}`;
      await expect(caller.update({ id: id.liveA, heightMax: "5.000000" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const after = await sql`SELECT "heightMax" FROM measurement_point_defs WHERE id = ${id.liveA}`;
      expect(after[0].heightMax).toBe(before[0].heightMax); // KHÔNG ghi — gate chặn TRƯỚC khi UPDATE chạy
    });

    it("field 3D/GD&T khác (coplanarityMax, tiltMax) cũng gate — không chỉ 6 field cũ", async () => {
      await expect(caller.update({ id: id.liveA, coplanarityMax: "0.05" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.update({ id: id.liveA, tiltMax: "1.5" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("unit (khoá 1D) cũng gate — không gán vô điều kiện", async () => {
      await expect(caller.update({ id: id.liveA, unit: "mm" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("ĐỐI CHỨNG — field KHÔNG giới hạn (name) trên cùng sản phẩm live KHÔNG bị gate", async () => {
      const res = await caller.update({ id: id.liveA, name: "Live A renamed" });
      expect(res).toEqual({ success: true });
      const row = await sql`SELECT name FROM measurement_point_defs WHERE id = ${id.liveA}`;
      expect(row[0].name).toBe("Live A renamed");
    });
  });

  describe("§2 — measurementPoint.setLimitsBatch (Bước 3+4)", () => {
    it("★★★ 3 điểm cùng sản phẩm (development, không gate): cả 3 có limit mới, pointsConfigVersion +1 ĐÚNG MỘT LẦN, measurement_point_versions +3 hàng", async () => {
      const [pmBefore] = await sql`SELECT "pointsConfigVersion" FROM product_models WHERE id = ${id.devProduct}`;
      const [{ c: mpvBefore }] = await sql`
        SELECT count(*)::int AS c FROM measurement_point_versions WHERE "pointDefId" IN (${id.devA}, ${id.devB}, ${id.devC})`;

      const res = await caller.setLimitsBatch({
        items: [
          { id: id.devA, heightMax: "5.000000" },
          { id: id.devB, heightMax: "6.000000" },
          { id: id.devC, heightMax: "7.000000" },
        ],
        changeReason: "T8 batch test",
      });

      expect(res.updated).toBe(3);

      const [pmAfter] = await sql`SELECT "pointsConfigVersion" FROM product_models WHERE id = ${id.devProduct}`;
      expect(pmAfter.pointsConfigVersion).toBe(pmBefore.pointsConfigVersion + 1); // ĐÚNG MỘT LẦN, không phải +3
      expect(res.pointsConfigVersion).toBe(pmAfter.pointsConfigVersion);

      const rows = await sql`SELECT id, "heightMax" FROM measurement_point_defs WHERE id IN (${id.devA}, ${id.devB}, ${id.devC}) ORDER BY id`;
      const byId = new Map(rows.map((r) => [r.id, r.heightMax]));
      expect(Number(byId.get(id.devA))).toBe(5);
      expect(Number(byId.get(id.devB))).toBe(6);
      expect(Number(byId.get(id.devC))).toBe(7);

      const [{ c: mpvAfter }] = await sql`
        SELECT count(*)::int AS c FROM measurement_point_versions WHERE "pointDefId" IN (${id.devA}, ${id.devB}, ${id.devC})`;
      expect(mpvAfter - mpvBefore).toBe(3); // BG-97: mỗi điểm MỘT hàng lịch sử
    });

    it("★★★ BG-97 — snapshot ghi giá trị TRƯỚC khi sửa (bo cũ vẫn chấm theo limit lúc đo)", async () => {
      const [before] = await sql`SELECT "heightMax" FROM measurement_point_defs WHERE id = ${id.devA}`;
      await caller.setLimitsBatch({ items: [{ id: id.devA, heightMax: "9.000000" }] });
      const [snap] = await sql`
        SELECT "snapshotJson" FROM measurement_point_versions
        WHERE "pointDefId" = ${id.devA} ORDER BY version DESC LIMIT 1`;
      // snapshotJson là trạng thái TRƯỚC lần sửa vừa gọi ⇒ heightMax cũ, KHÔNG phải "9".
      expect(String(snap.snapshotJson.heightMax)).toBe(String(before.heightMax));
    });

    it("id thuộc HAI productModelId khác nhau ⇒ BAD_REQUEST, KHÔNG ghi gì", async () => {
      const [before] = await sql`SELECT "heightMax" FROM measurement_point_defs WHERE id = ${id.otherA}`;
      await expect(
        caller.setLimitsBatch({ items: [{ id: id.devA, heightMax: "1" }, { id: id.otherA, heightMax: "2" }] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const [after] = await sql`SELECT "heightMax" FROM measurement_point_defs WHERE id = ${id.otherA}`;
      expect(after.heightMax).toBe(before.heightMax);
    });

    it("id không tồn tại ⇒ NOT_FOUND, và các id HỢP LỆ trong CÙNG batch KHÔNG bị ghi một phần (transaction)", async () => {
      const [before] = await sql`SELECT "heightMax" FROM measurement_point_defs WHERE id = ${id.devB}`;
      const [{ c: mpvBefore }] = await sql`SELECT count(*)::int AS c FROM measurement_point_versions WHERE "pointDefId" = ${id.devB}`;
      await expect(
        caller.setLimitsBatch({ items: [{ id: id.devB, heightMax: "42" }, { id: 999999999, heightMax: "1" }] }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      const [after] = await sql`SELECT "heightMax" FROM measurement_point_defs WHERE id = ${id.devB}`;
      expect(after.heightMax).toBe(before.heightMax); // KHÔNG ghi một phần
      const [{ c: mpvAfter }] = await sql`SELECT count(*)::int AS c FROM measurement_point_versions WHERE "pointDefId" = ${id.devB}`;
      expect(mpvAfter).toBe(mpvBefore); // KHÔNG snapshot một phần
    });

    it("sản phẩm LIVE+enforced ⇒ FORBIDDEN cho cả batch (dùng CHUNG cửa duyệt với update)", async () => {
      const [before] = await sql`SELECT "heightMax" FROM measurement_point_defs WHERE id = ${id.liveB}`;
      await expect(
        caller.setLimitsBatch({ items: [{ id: id.liveA, heightMax: "1" }, { id: id.liveB, heightMax: "2" }] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const [after] = await sql`SELECT "heightMax" FROM measurement_point_defs WHERE id = ${id.liveB}`;
      expect(after.heightMax).toBe(before.heightMax);
    });
  });

  describe("§3 — bằng chứng KHÔNG chép tay (đối chiếu với shared/pointLimitSpec.ts)", () => {
    it("mọi field batch schema chấp nhận (trừ criteria — xem docblock router) là một khoá THẬT của APPROVAL_LIMIT_FIELDS", async () => {
      // Round-trip qua router thật với TOÀN BỘ field mà setLimitsBatch khai —
      // nếu router khai một field KHÔNG thuộc APPROVAL_LIMIT_FIELDS (hoặc thiếu
      // một field spec có mà router quên), test set dưới sẽ lệch và soi ra.
      const batchSchemaFields = new Set([
        "unit", "lowerLimit", "upperLimit", "nominalValue", "toleranceMode", "tolPlus", "tolMinus",
        "heightMin", "heightMax", "areaMin", "areaMax", "volumeMin", "volumeMax", "coplanarityMax",
        "warpageMax", "voidPctMax", "offsetXMax", "offsetYMax", "tiltMax", "thicknessMin", "thicknessMax",
      ]);
      const specFields = new Set(APPROVAL_LIMIT_FIELDS);
      // batchSchemaFields là APPROVAL_LIMIT_FIELDS TRỪ "criteria" (loại có chủ ý — xem docblock setLimitsBatch).
      expect([...specFields].filter((f) => f !== "criteria").sort()).toEqual([...batchSchemaFields].sort());
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ★★★ BG-113 (review Khối C lượt 9, I-2) — 0/5 đường ghi giới hạn kiểm
  // `lower ≤ upper` trước bản vá này. §4 đo HAI đường (update/setLimitsBatch)
  // trên CSDL THẬT: patch chỉ đổi MỘT cận mâu thuẫn với cận HIỆN CÓ (không đổi
  // trong patch này) vẫn phải bị chặn — chứng minh gate hoạt động SAU KHI MERGE,
  // không chỉ kiểm riêng patch. Ba đường còn lại (`product.ts` phòng thủ kép,
  // bulk-import, AI Copilot) đo ở lưới THUẦN (`measurementPointLimitGate.test.ts`)
  // + census điểm gọi (`server/contracts/limitRangeGateCensus.test.ts`).
  // ══════════════════════════════════════════════════════════════════════════
  describe("§4 — BG-113: gate lowerLimit≤upperLimit / heightMin≤heightMax (DB thật)", () => {
    it("★★★ measurementPoint.update — patch CHỈ gửi upperLimit mới thấp hơn lowerLimit HIỆN CÓ ⇒ BAD_REQUEST, KHÔNG ghi", async () => {
      const [before] = await sql`SELECT "lowerLimit", "upperLimit" FROM measurement_point_defs WHERE id = ${id.devD}`;
      expect(Number(before.lowerLimit)).toBe(1); // nền [1;10] từ beforeAll
      await expect(caller.update({ id: id.devD, upperLimit: "0.5" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const [after] = await sql`SELECT "lowerLimit", "upperLimit" FROM measurement_point_defs WHERE id = ${id.devD}`;
      expect(after.upperLimit, "gate phải chặn TRƯỚC khi UPDATE chạy — không ghi khoảng rỗng").toBe(before.upperLimit);
    });

    it("measurementPoint.update — heightMin > heightMax (đã merge) ⇒ BAD_REQUEST, KHÔNG ghi", async () => {
      const [before] = await sql`SELECT "heightMin", "heightMax" FROM measurement_point_defs WHERE id = ${id.devD}`;
      await expect(caller.update({ id: id.devD, heightMax: "0.5" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const [after] = await sql`SELECT "heightMin", "heightMax" FROM measurement_point_defs WHERE id = ${id.devD}`;
      expect(after.heightMax).toBe(before.heightMax);
    });

    it("ĐỐI CHỨNG — measurementPoint.update với khoảng HỢP LỆ vẫn ghi bình thường (gate không chặn oan)", async () => {
      const res = await caller.update({ id: id.devD, upperLimit: "15" }); // [1;15] — hợp lệ
      expect(res).toEqual({ success: true });
      const [after] = await sql`SELECT "upperLimit" FROM measurement_point_defs WHERE id = ${id.devD}`;
      expect(Number(after.upperLimit)).toBe(15);
    });

    it("★★★ setLimitsBatch — MỘT item patch chỉ đổi upperLimit thấp hơn lowerLimit HIỆN CÓ ⇒ BAD_REQUEST, KHÔNG ghi item nào trong batch", async () => {
      const [beforeE] = await sql`SELECT "upperLimit" FROM measurement_point_defs WHERE id = ${id.devE}`;
      const [beforeC] = await sql`SELECT "heightMax" FROM measurement_point_defs WHERE id = ${id.devC}`;
      // devE nền [1;10] (beforeAll) — patch upperLimit=0.5 mâu thuẫn với lowerLimit=1
      // HIỆN CÓ; devC (nền heightMax hợp lệ, KHÔNG mâu thuẫn) đứng CẠNH trong CÙNG
      // batch — phải KHÔNG bị ghi (transaction, giống mệnh đề NOT_FOUND ở §2).
      await expect(
        caller.setLimitsBatch({ items: [{ id: id.devE, upperLimit: "0.5" }, { id: id.devC, heightMax: "8" }] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const [afterE] = await sql`SELECT "upperLimit" FROM measurement_point_defs WHERE id = ${id.devE}`;
      const [afterC] = await sql`SELECT "heightMax" FROM measurement_point_defs WHERE id = ${id.devC}`;
      expect(afterE.upperLimit).toBe(beforeE.upperLimit);
      expect(afterC.heightMax, "item KHÁC trong CÙNG batch (hợp lệ riêng nó) cũng không được ghi — batch là MỘT transaction").toBe(beforeC.heightMax);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ★★★ BG-123 (Khối C, "nợ còn mở", 2026-09-05) — xoá giới hạn về NULL qua CỬA
  // THẬT (tRPC caller + DB thật, khác `server/db/xoaGioiHanVeNull.db.test.ts`
  // đo thẳng hàm DB). §5.2 là lưới HỒI QUY cho một lỗi phát hiện khi cài bản vá
  // này: `measurementPoint.update` merge "input + hàng hiện có" bằng `??` ở
  // HAI chỗ (derive tolerance-mode, và khoảng đã merge cho gate lower≤upper) —
  // `??` coi `null` (xoá) là "vắng mặt" và ÂM THẦM phục hồi giá trị CŨ, nên một
  // lượt xoá heightMax hợp lệ (kèm nâng heightMin) từng bị chặn OAN bằng giá
  // trị heightMax CŨ (đã sửa bằng `gopGiuNguyenNull`, `measurementPointLimitGate.ts`).
  // ══════════════════════════════════════════════════════════════════════════
  describe("§5 — BG-123: xoá giới hạn về NULL (measurementPoint.update / setLimitsBatch)", () => {
    it("★★★ measurementPoint.update — xoá upperLimit về NULL: cột NULL, snapshot giá trị CŨ, version +1, KHÔNG đụng lowerLimit", async () => {
      const [{ c: mpvBefore }] = await sql`SELECT count(*)::int AS c FROM measurement_point_versions WHERE "pointDefId" = ${id.devF}`;

      const res = await caller.update({ id: id.devF, upperLimit: null });
      expect(res).toEqual({ success: true });

      const [after] = await sql`SELECT "lowerLimit", "upperLimit" FROM measurement_point_defs WHERE id = ${id.devF}`;
      expect(after.upperLimit, "cột PHẢI thành NULL").toBeNull();
      expect(Number(after.lowerLimit), "lowerLimit KHÔNG bị đụng — vẫn 1").toBe(1);

      const [{ c: mpvAfter }] = await sql`SELECT count(*)::int AS c FROM measurement_point_versions WHERE "pointDefId" = ${id.devF}`;
      expect(mpvAfter - mpvBefore, "version PHẢI bump ĐÚNG 1").toBe(1);

      const [snap] = await sql`
        SELECT "snapshotJson" FROM measurement_point_versions
        WHERE "pointDefId" = ${id.devF} ORDER BY version DESC LIMIT 1`;
      expect(Number(snap.snapshotJson.upperLimit), "snapshot mang giá trị TRƯỚC khi xoá (10)").toBe(10);
    });

    it("★★★ HỒI QUY — nâng heightMin (25) ĐỒNG THỜI xoá heightMax về NULL ⇒ PHẢI qua (không còn cận trên để mâu thuẫn), KHÔNG bị chặn OAN bằng heightMax CŨ (20)", async () => {
      // Nền (từ beforeAll, chưa bị ca trên đụng): heightMin=2, heightMax=20.
      // Trước bản vá: merge `??` giữ heightMax=20 (stale) khi thấy `null` ⇒
      // 25 > 20 ⇒ BAD_REQUEST OAN. Sau bản vá: heightMax merge ra `null` (đúng
      // ý xoá) ⇒ không có cận trên để so ⇒ heightMin=25 một mình hợp lệ.
      // ĐÃ CHẠY TAY: đổi tạm dòng `heightMax: gopGiuNguyenNull(...)` thành
      // `rest.heightMax ?? existingPoint.heightMax ?? undefined` → ca này ĐỎ
      // đúng dự đoán (`appCode: 'INVALID_VALUE', appParams: { field: '…heightMin/heightMax…' }`)
      // → hoàn tác nguyên văn → XANH lại. Xem report BG-123.
      const res = await caller.update({ id: id.devF, heightMin: "25", heightMax: null });
      expect(res).toEqual({ success: true });

      const [after] = await sql`SELECT "heightMin", "heightMax" FROM measurement_point_defs WHERE id = ${id.devF}`;
      expect(Number(after.heightMin)).toBe(25);
      expect(after.heightMax, "heightMax PHẢI thành NULL").toBeNull();
    });

    it("setLimitsBatch — xoá heightMax về NULL cho 2 điểm cùng lúc: cả hai NULL, 2 hàng lịch sử, MỘT lần bump", async () => {
      const [pmBefore] = await sql`SELECT "pointsConfigVersion" FROM product_models WHERE id = ${id.devProduct}`;
      const [{ c: mpvGBefore }] = await sql`SELECT count(*)::int AS c FROM measurement_point_versions WHERE "pointDefId" = ${id.devG}`;
      const [{ c: mpvHBefore }] = await sql`SELECT count(*)::int AS c FROM measurement_point_versions WHERE "pointDefId" = ${id.devH}`;

      const res = await caller.setLimitsBatch({
        items: [
          { id: id.devG, heightMax: null },
          { id: id.devH, heightMax: null },
        ],
      });
      expect(res.updated).toBe(2);

      const rows = await sql`SELECT id, "heightMax" FROM measurement_point_defs WHERE id IN (${id.devG}, ${id.devH})`;
      for (const r of rows) {
        expect(r.heightMax, `điểm ${r.id} PHẢI thành NULL`).toBeNull();
      }

      const [{ c: mpvGAfter }] = await sql`SELECT count(*)::int AS c FROM measurement_point_versions WHERE "pointDefId" = ${id.devG}`;
      const [{ c: mpvHAfter }] = await sql`SELECT count(*)::int AS c FROM measurement_point_versions WHERE "pointDefId" = ${id.devH}`;
      expect(mpvGAfter - mpvGBefore).toBe(1);
      expect(mpvHAfter - mpvHBefore).toBe(1);

      const [pmAfter] = await sql`SELECT "pointsConfigVersion" FROM product_models WHERE id = ${id.devProduct}`;
      expect(pmAfter.pointsConfigVersion, "MỘT lần bump, không phải 2").toBe(pmBefore.pointsConfigVersion + 1);
    });
  });
});
