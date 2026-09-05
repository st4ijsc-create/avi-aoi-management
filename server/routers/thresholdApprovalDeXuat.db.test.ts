/**
 * server/routers/thresholdApprovalDeXuat.db.test.ts
 *
 * ★★★ Lô 7 Mục 2 (BG-111, 2026-09-05) — hợp đồng `thresholdApproval.request`
 * MỞ RỘNG (`deXuat: Record<field, string|null>`, đủ bộ `APPROVAL_LIMIT_FIELDS`)
 * + `decideApproval` (nhánh approve) áp TOÀN BỘ `deXuat` qua đường ghi giới hạn
 * CHUẨN (`updateMeasurementPointDef` — có version + bump), thay vì 3 cột tay
 * (lowerLimit/upperLimit/nominalValue) như TRƯỚC bản vá này.
 *
 * Đo qua tRPC caller THẬT + DB THẬT (`aoi_management_test` qua vitest.setup.ts
 * guard, vai `avi_app`) — không mock. Bốn mệnh đề brief Mục 2 §3:
 *   1. request với heightMax-only ⇒ ghi được (TRƯỚC migration 0348 — Mục 1 —
 *      cột proposedLsl/Usl NOT NULL sẽ ném 23502; ĐÃ đo RED thật bằng cách
 *      revert schema tạm thời, xem lo-7-report.md).
 *   2. approve ⇒ cột heightMax đổi + version row (measurement_point_versions)
 *      + qua gate (assertThresholdEditAllowed vẫn chạy bình thường — Lô 7
 *      KHÔNG đổi hành vi gate, chỉ đổi ĐƯỜNG GHI sau khi đã qua nó).
 *   3. request với deXuat null-XOÁ ⇒ approve xoá về NULL CÓ LỊCH SỬ (snapshot
 *      giá trị TRƯỚC khi xoá trong measurement_point_versions).
 *   4. từ chối (reject) ⇒ KHÔNG đổi gì ở measurement_point_defs.
 *
 * Sản phẩm `development` KHÔNG có released program ⇒ assertThresholdEditAllowed
 * trả 'direct' — approve/apply luôn được phép ghi (lưới này đo ĐƯỜNG GHI của
 * decideApproval, không đo lại gate — gate đã có lưới riêng ở
 * measurementPointLimits.db.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { thresholdApprovalRouter } from "./thresholdApprovalRouter";

const DB_URL = process.env.DATABASE_URL;
const RUN = `L7M2${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
let tenDb = "(chưa đo)";
const ids = { product: 0, pointHeight: 0, pointDelete: 0, pointReject: 0 };

// Requester (operator, protectedProcedure) và approver (quality, KHÁC người —
// assertApprovalSoD đòi decidedBy ≠ requestedBy) — cùng khuôn measurementPointLimits.db.test.ts.
const requesterCtx = { user: { id: 555000001, role: "operator", name: "L7M2 requester" }, req: { ip: null, headers: {} } } as any;
const approverCtx = { user: { id: 555000002, role: "quality_inspector", twoFactorEnabled: true, name: "L7M2 approver" }, req: { ip: null, headers: {} } } as any;
const requesterCaller = thresholdApprovalRouter.createCaller(requesterCtx);
const approverCaller = thresholdApprovalRouter.createCaller(approverCtx);

async function safe(run: () => Promise<unknown>): Promise<void> {
  try { await run(); } catch { /* dọn dẹp best-effort */ }
}

describe.skipIf(!DB_URL)("Lô 7 Mục 2 (BG-111) — deXuat đủ bộ, decideApproval áp qua đường có version (DB thật)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const [d] = await sql<{ db: string; usr: string }[]>`SELECT current_database() AS db, current_user AS usr`;
    tenDb = d.db;
    expect(d.usr, "phải đo bằng vai avi_app").toBe("avi_app");
    // eslint-disable-next-line no-console
    console.log(`[Lô 7 Mục 2] current_database()=${d.db} current_user=${d.usr}`);

    const [pm] = await sql<{ id: number }[]>`
      INSERT INTO product_models (code, name, "lifecycleStatus")
      VALUES (${"L7M2-" + RUN}, 'Lo 7 Muc 2 deXuat', 'development') RETURNING id`;
    ids.product = pm.id;

    const [ph] = await sql<{ id: number }[]>`
      INSERT INTO measurement_point_defs
        ("productModelId", code, name, "measurementType", "positionX", "positionY", "heightMax")
      VALUES (${ids.product}, ${"PH-" + RUN}, 'L7M2 heightMax-only', 'DIMENSION', 10, 10, '5.000000') RETURNING id`;
    ids.pointHeight = ph.id;

    const [pd] = await sql<{ id: number }[]>`
      INSERT INTO measurement_point_defs
        ("productModelId", code, name, "measurementType", "positionX", "positionY", "heightMax")
      VALUES (${ids.product}, ${"PD-" + RUN}, 'L7M2 null-xoa', 'DIMENSION', 20, 20, '7.000000') RETURNING id`;
    ids.pointDelete = pd.id;

    const [pr] = await sql<{ id: number }[]>`
      INSERT INTO measurement_point_defs
        ("productModelId", code, name, "measurementType", "positionX", "positionY", "lowerLimit", "upperLimit")
      VALUES (${ids.product}, ${"PR-" + RUN}, 'L7M2 reject', 'DIMENSION', 30, 30, '1.000000', '10.000000') RETURNING id`;
    ids.pointReject = pr.id;
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    await safe(async () => sql`DELETE FROM threshold_approvals WHERE "pointDefId" IN (${ids.pointHeight}, ${ids.pointDelete}, ${ids.pointReject})`);
    await safe(async () => sql`DELETE FROM measurement_point_versions WHERE "pointDefId" IN (${ids.pointHeight}, ${ids.pointDelete}, ${ids.pointReject})`);
    await safe(async () => sql`DELETE FROM measurement_point_defs WHERE "productModelId" = ${ids.product}`);
    await safe(async () => sql`DELETE FROM product_models WHERE id = ${ids.product}`);
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("★★★ (1) request với deXuat CHỈ heightMax ⇒ ghi được (0348 nới NOT NULL — TRƯỚC migration này INSERT sẽ 23502)", async () => {
    const row = await requesterCaller.request({
      pointDefId: ids.pointHeight,
      deXuat: { heightMax: "9.500000" },
      comment: "L7M2 tang heightMax",
    });
    expect(row.status, `[${tenDb}]`).toBe("requested");
    expect(row.proposedLsl, "yêu cầu KHÔNG chạm LSL ⇒ cột legacy vẫn NULL").toBeNull();
    expect(row.proposedUsl, "yêu cầu KHÔNG chạm USL ⇒ cột legacy vẫn NULL").toBeNull();
    expect((row.suggestion as any).deXuat).toEqual({ heightMax: "9.500000" });
  });

  it("★★★ (2) approve ⇒ heightMax đổi TRÊN measurement_point_defs + version row + qua gate (assertThresholdEditAllowed)", async () => {
    const [pending] = await sql<{ id: number }[]>`
      SELECT id FROM threshold_approvals WHERE "pointDefId" = ${ids.pointHeight} AND status = 'requested' ORDER BY id DESC LIMIT 1`;
    expect(pending, `[${tenDb}] phải có 1 hàng requested từ ca (1)`).toBeTruthy();

    const [mpvTruoc] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM measurement_point_versions WHERE "pointDefId" = ${ids.pointHeight}`;

    const decided = await approverCaller.approve({ id: pending.id, apply: true });
    expect(decided.status).toBe("applied");

    const [pointSau] = await sql<{ heightMax: string | null }[]>`
      SELECT "heightMax" FROM measurement_point_defs WHERE id = ${ids.pointHeight}`;
    expect(Number(pointSau.heightMax), `[${tenDb}] heightMax PHẢI đổi thành 9.5 — đường CŨ (3 cột tay LSL/USL/nominal) sẽ để nguyên 5`).toBe(9.5);

    const [mpvSau] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM measurement_point_versions WHERE "pointDefId" = ${ids.pointHeight}`;
    expect(mpvSau.c, `[${tenDb}] version PHẢI bump — đường ghi chuẩn (updateMeasurementPointDef) luôn snapshot`).toBe(mpvTruoc.c + 1);

    const [snap] = await sql<{ snapshotJson: any }[]>`
      SELECT "snapshotJson" FROM measurement_point_versions WHERE "pointDefId" = ${ids.pointHeight} ORDER BY version DESC LIMIT 1`;
    expect(Number(snap.snapshotJson.heightMax), "snapshot mang giá trị TRƯỚC khi duyệt (5)").toBe(5);
  });

  it("★★★ (3) request với deXuat null-XOÁ ⇒ approve xoá heightMax về NULL, CÓ LỊCH SỬ (snapshot giá trị cũ)", async () => {
    const reqRow = await requesterCaller.request({
      pointDefId: ids.pointDelete,
      deXuat: { heightMax: null },
      comment: "L7M2 xoa heightMax qua duyet",
    });
    expect((reqRow.suggestion as any).deXuat, "deXuat PHẢI giữ null tường minh, không bị lọc mất").toEqual({ heightMax: null });

    const decided = await approverCaller.approve({ id: reqRow.id, apply: true });
    expect(decided.status).toBe("applied");

    const [pointSau] = await sql<{ heightMax: string | null }[]>`
      SELECT "heightMax" FROM measurement_point_defs WHERE id = ${ids.pointDelete}`;
    expect(pointSau.heightMax, `[${tenDb}] heightMax PHẢI thành NULL (đề xuất XOÁ được áp)`).toBeNull();

    const [snap] = await sql<{ snapshotJson: any }[]>`
      SELECT "snapshotJson" FROM measurement_point_versions WHERE "pointDefId" = ${ids.pointDelete} ORDER BY version DESC LIMIT 1`;
    expect(Number(snap.snapshotJson.heightMax), "snapshot PHẢI mang giá trị TRƯỚC khi xoá (7), có lịch sử").toBe(7);
  });

  it("★★★ (4) từ chối (reject) ⇒ KHÔNG đổi gì ở measurement_point_defs, KHÔNG version row mới", async () => {
    const reqRow = await requesterCaller.request({
      pointDefId: ids.pointReject,
      deXuat: { lowerLimit: "2.000000" },
      comment: "L7M2 se bi tu choi",
    });

    const [mpvTruoc] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM measurement_point_versions WHERE "pointDefId" = ${ids.pointReject}`;

    const rejected = await approverCaller.reject({ id: reqRow.id, comment: "khong hop ly" });
    expect(rejected.status).toBe("rejected");

    const [pointSau] = await sql<{ lowerLimit: string | null; upperLimit: string | null }[]>`
      SELECT "lowerLimit", "upperLimit" FROM measurement_point_defs WHERE id = ${ids.pointReject}`;
    expect(Number(pointSau.lowerLimit), `[${tenDb}] lowerLimit KHÔNG đổi (vẫn 1) — bị từ chối`).toBe(1);
    expect(Number(pointSau.upperLimit), "upperLimit KHÔNG đổi (vẫn 10)").toBe(10);

    const [mpvSau] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM measurement_point_versions WHERE "pointDefId" = ${ids.pointReject}`;
    expect(mpvSau.c, "từ chối KHÔNG tạo version row nào (không có gì để snapshot)").toBe(mpvTruoc.c);
  });
});
