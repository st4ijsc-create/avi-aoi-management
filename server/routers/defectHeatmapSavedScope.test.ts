/**
 * ★★★ 2026-08-17 — PHẠM VI NHÀ MÁY cho SÁU thủ tục còn hở của `defectHeatmapRouter`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * LỖ ĐÃ ĐO (trước bản vá này)
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * Lượt trước đã lọc BA truy vấn tính-trực-tiếp bên trong `services/defectSpatialHeatmap.ts`
 * (xem `defectSpatialHeatmap.scope.test.ts`). SÁU thủ tục vẫn hở, chia làm hai họ:
 *
 *   HỌ 1 — TÍNH TRỰC TIẾP, chưa lọc (`.where()` chỉ có ngày + máy):
 *     ④ `getMachineOverlay`        — COUNT NG theo máy
 *     ⑤ `getRealTimeHotspots`      — GROUP BY (máy, điểm đo) trong N giờ qua
 *     ⑥ `getProductDefectOverlay`  — COUNT NG/tổng theo điểm đo
 *
 *   HỌ 2 — PHÁT LẠI HEATMAP ĐÃ LƯU từ `defect_heatmap_data`:
 *     ⑦ `list`  ⑧ `getLatest`  ⑨ `getById`  (+ ⑩ `delete`, cùng một cơ chế)
 *     Trước migration 0324 bảng KHÔNG có cột phạm vi nào ⇒ không lọc được. Nay có
 *     `corporateCode`/`factoryCode` (cùng không gian mã với `product_inspections`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * HÀNG `NULL` = "KHÔNG RÕ NGUỒN GỐC" ⇒ FAIL-CLOSED
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * Một heatmap là con số GỘP. Khi tập hàng đóng góp trải trên ≥2 nhà máy (admin sinh bản toàn
 * cục) thì KHÔNG tồn tại một `factoryCode` đúng để ghi ⇒ NULL. Điền bừa một mã mặc định sẽ
 * biến "không biết" thành một LỜI KHAI SAI và phát một con số liên-nhà-máy cho người chỉ được
 * xem một nhà máy. Luật đọc vì thế: hàng NULL **chỉ admin thấy**.
 *
 * HAI CHIỀU, cho CẢ SÁU:
 *   ÂM   — người gán A không thấy dữ liệu/heatmap của B; hàng NULL không lọt; người 0 gán rỗng.
 *   DƯƠNG— admin thấy TOÀN BỘ **kể cả hàng NULL**; người gán A vẫn thấy ĐỦ của A.
 *
 * ⚠ CÂU "RỖNG" PHẢI TRUNG THỰC: người 0 gán nhận `scopeEmptyReason:"no_factory_assignment"`
 * + câu nói *"chưa được gán nhà máy"*. Nói "không có lỗi nào" là dạy người vận hành rằng dây
 * chuyền sạch trong khi sự thật là họ không được phép nhìn.
 *
 * Lưới chạy trên CSDL test THẬT với `_core/accessControl` THẬT — không mock bộ phân giải
 * phạm vi, vì thứ cần chứng minh chính là SQL sinh ra từ nó có tới nơi hay không.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

// Router đứng sau `moduleProcedure("MOD_QUALITY")`; cổng license mặc định BẬT và SKU của CSDL
// test không gồm MOD_QUALITY ⇒ mọi lượt gọi FEATURE_DISABLED trước khi tới đoạn cần đo.
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

import { defectHeatmapRouter } from "./defectHeatmapRouter";
import * as dbApi from "../db";
import { getDb } from "../db/connection";
import { clearAssignmentCache } from "../_core/accessControl";
import { defectHeatmapData, users, type InsertMeasurementResult, type InsertUser } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const ts = Date.now();
const FAC_A = `HMS_FAC_A_${ts}`;
const FAC_B = `HMS_FAC_B_${ts}`;
const CORP_A = `HMS_CORP_A_${ts}`;
const CORP_B = `HMS_CORP_B_${ts}`;

// Cửa sổ riêng của file này (không đụng cửa sổ 2031 của `defectSpatialHeatmap.scope.test.ts`).
//
// ⚠ ĐO ĐƯỢC khi dựng lưới này (và là lý do cửa sổ nằm ở QUÁ KHỨ, không phải tương lai):
// `getRealTimeHotspots` chỉ có CHẶN DƯỚI (`inspectionTime >= now - hours`) và KHÔNG có chặn
// trên. Với cửa sổ đặt ở 2033, các hàng "tương lai" ấy thoả `>= now-1h` nên lọt luôn vào
// "hotspot thời gian thực" (đo: điểm A ra 3 thay vì 1). Đó là một nét sẵn có của thủ tục, nằm
// ngoài trục phạm-vi của task này — nhưng lưới không được im lặng dựa vào nó, nên dữ liệu cửa
// sổ chuyển về 2019 để hai trục thời gian tách bạch hẳn.
const WIN_START = "2019-06-01T00:00:00.000Z";
const WIN_END = "2019-06-10T00:00:00.000Z";
const INSPECTED_AT = new Date("2019-06-05T03:00:00Z");
/** Ca "thời gian thực" cần nằm trong 1 giờ qua. */
const RECENT_AT = new Date(Date.now() - 10 * 60 * 1000);

let machineId: number;
let productModelId: number;
let pointDefA: number;
let pointDefB: number;
let adminId: number;
let userAId: number;
let userNoneId: number;
/** Heatmap ĐÃ LƯU: của A, của B, và một hàng KHÔNG RÕ NGUỒN GỐC (NULL). */
let hmA: number;
let hmB: number;
let hmNull: number;
/** Ba hàng riêng cho ca `delete` (xoá là phá huỷ — không dùng chung với ca đọc). */
let delA: number;
let delB: number;

const ctxFor = (id: number, role: string) => ({ user: { id, role } }) as never;
const callerAdmin = () => defectHeatmapRouter.createCaller(ctxFor(adminId, "admin"));
const callerA = () => defectHeatmapRouter.createCaller(ctxFor(userAId, "engineer"));
const callerNone = () => defectHeatmapRouter.createCaller(ctxFor(userNoneId, "engineer"));

async function mkUser(role: NonNullable<InsertUser["role"]>, tag: string): Promise<number> {
  const conn = await getDb();
  const [u] = await conn!
    .insert(users)
    .values({
      openId: `hms_${tag}_${ts}`,
      username: `hms_${tag}_${ts}`,
      name: `heatmap saved ${tag}`,
      role,
      loginMethod: "local",
    })
    .returning({ id: users.id });
  return u.id;
}

/** Một heatmap ĐÃ LƯU với phạm vi cho trước (null = không rõ nguồn gốc). */
async function mkSavedHeatmap(
  corporateCode: string | null,
  factoryCode: string | null,
  generatedAt: Date,
): Promise<number> {
  const conn = await getDb();
  const [row] = await conn!
    .insert(defectHeatmapData)
    .values({
      machineId,
      productModelId,
      corporateCode,
      factoryCode,
      periodType: "DAILY",
      periodStart: new Date(WIN_START),
      periodEnd: new Date(WIN_END),
      gridWidth: 10,
      gridHeight: 10,
      heatmapGrid: [[1]],
      totalDefects: 1,
      maxDefectsInCell: 1,
      generatedAt,
    })
    .returning({ id: defectHeatmapData.id });
  return row.id;
}

async function savedRowExists(id: number): Promise<boolean> {
  const conn = await getDb();
  const rows = await conn!.select({ id: defectHeatmapData.id }).from(defectHeatmapData).where(eq(defectHeatmapData.id, id));
  return rows.length === 1;
}

beforeAll(async () => {
  const factoryId = await dbApi.createFactory({ code: `HMSF_${ts}`, name: "HMS fac" });
  const workshopId = await dbApi.createWorkshop({ factoryId, code: `HMSW_${ts}`, name: "HMS ws" });
  const lineId = await dbApi.createProductionLine({ workshopId, code: `HMSL_${ts}`, name: "HMS line" });
  const stationId = await dbApi.createStation({ lineId, code: `HMSS_${ts}`, name: "HMS st", orderIndex: 1 });
  machineId = await dbApi.createMachine({
    stationId,
    code: `HMSM_${ts}`,
    name: "HMS machine",
    machineType: "AOI",
    apiKey: `hms_${ts}`,
  });
  productModelId = await dbApi.createProductModel({
    code: `HMSP_${ts}`,
    name: "HMS product",
    imageWidth: 1000,
    imageHeight: 800,
  });
  // HAI điểm đo: A chỉ được nhà máy A dùng, B chỉ nhà máy B ⇒ `getRealTimeHotspots` (GROUP BY
  // điểm đo) và `getProductDefectOverlay` (theo điểm đo) phân biệt được hai nhà máy.
  pointDefA = await dbApi.createMeasurementPointDef({
    productModelId, code: `HMSPA_${ts}`, name: "HMS point A", measurementType: "VISUAL", positionX: 10, positionY: 10,
  });
  pointDefB = await dbApi.createMeasurementPointDef({
    productModelId, code: `HMSPB_${ts}`, name: "HMS point B", measurementType: "VISUAL", positionX: 90, positionY: 90,
  });

  // ── Nhà máy A — cửa sổ 2019: 2 NG + 1 OK trên điểm A ──────────────────────────
  const inspA = await dbApi.createProductInspection({
    machineId, productModelId, serialNumber: `SN_HMS_A_${ts}`,
    overallResult: "NG", originalResult: "NG", inspectionTime: INSPECTED_AT,
    corporateCode: CORP_A, factoryCode: FAC_A,
  });
  await dbApi.createMeasurementResults([
    { inspectionId: inspA, pointDefId: pointDefA, result: "NG", defectBboxX: 40, defectBboxY: 30, defectBboxW: 20, defectBboxH: 20 },
    { inspectionId: inspA, pointDefId: pointDefA, result: "NG", defectBboxX: 45, defectBboxY: 35, defectBboxW: 20, defectBboxH: 20 },
    { inspectionId: inspA, pointDefId: pointDefA, result: "OK" },
  ] satisfies InsertMeasurementResult[]);

  // ── Nhà máy B — cửa sổ 2019: 3 NG trên điểm B ─────────────────────────────────
  const inspB = await dbApi.createProductInspection({
    machineId, productModelId, serialNumber: `SN_HMS_B_${ts}`,
    overallResult: "NG", originalResult: "NG", inspectionTime: INSPECTED_AT,
    corporateCode: CORP_B, factoryCode: FAC_B,
  });
  await dbApi.createMeasurementResults([
    { inspectionId: inspB, pointDefId: pointDefB, result: "NG", defectBboxX: 950, defectBboxY: 760 },
    { inspectionId: inspB, pointDefId: pointDefB, result: "NG", defectBboxX: 955, defectBboxY: 765 },
    { inspectionId: inspB, pointDefId: pointDefB, result: "NG", defectBboxX: 960, defectBboxY: 770 },
  ] satisfies InsertMeasurementResult[]);

  // ── Cùng hai nhà máy nhưng trong 1 GIỜ QUA (cho `getRealTimeHotspots`) ────────
  const recentA = await dbApi.createProductInspection({
    machineId, productModelId, serialNumber: `SN_HMS_RA_${ts}`,
    overallResult: "NG", originalResult: "NG", inspectionTime: RECENT_AT,
    corporateCode: CORP_A, factoryCode: FAC_A,
  });
  await dbApi.createMeasurementResults([
    { inspectionId: recentA, pointDefId: pointDefA, result: "NG" },
  ] satisfies InsertMeasurementResult[]);
  const recentB = await dbApi.createProductInspection({
    machineId, productModelId, serialNumber: `SN_HMS_RB_${ts}`,
    overallResult: "NG", originalResult: "NG", inspectionTime: RECENT_AT,
    corporateCode: CORP_B, factoryCode: FAC_B,
  });
  await dbApi.createMeasurementResults([
    { inspectionId: recentB, pointDefId: pointDefB, result: "NG" },
    { inspectionId: recentB, pointDefId: pointDefB, result: "NG" },
  ] satisfies InsertMeasurementResult[]);

  adminId = await mkUser("admin", "admin");
  userAId = await mkUser("engineer", "faca");
  userNoneId = await mkUser("engineer", "none");
  await dbApi.createFactoryAssignment({ userId: userAId, factoryCode: FAC_A, assignedBy: adminId });
  clearAssignmentCache();

  // Heatmap ĐÃ LƯU. `generatedAt` tăng dần A → B → NULL để `getLatest` (ORDER BY DESC) trả
  // hàng NULL cho admin và hàng A cho người gán A ⇒ ca "nhảy qua B và NULL" đo được.
  hmA = await mkSavedHeatmap(CORP_A, FAC_A, new Date("2019-06-11T01:00:00Z"));
  hmB = await mkSavedHeatmap(CORP_B, FAC_B, new Date("2019-06-11T02:00:00Z"));
  hmNull = await mkSavedHeatmap(null, null, new Date("2019-06-11T03:00:00Z"));
  delA = await mkSavedHeatmap(CORP_A, FAC_A, new Date("2019-06-11T04:00:00Z"));
  delB = await mkSavedHeatmap(CORP_B, FAC_B, new Date("2019-06-11T05:00:00Z"));
});

/** Bắt mã lỗi tRPC mà không nuốt mất lỗi lạ. */
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "NO_ERROR";
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ ④ getMachineOverlay — COUNT NG theo máy", () => {
  const input = { startDate: WIN_START, endDate: WIN_END };

  it("CHIỀU DƯƠNG: admin thấy cả A lẫn B (2 NG + 3 NG = 5, trên 6 lượt đo)", async () => {
    const r = await callerAdmin().getMachineOverlay(input);
    const mine = r.machines.find((m) => m.id === machineId);
    expect(mine).toBeDefined();
    expect(Number(mine!.defectCount)).toBe(5);
    expect(Number(mine!.totalCount)).toBe(6);
    expect(r.scopeApplied).toBe(false);
    expect(r.scopeEmptyReason).toBeNull();
  });

  it("CHIỀU ÂM+DƯƠNG: người gán A chỉ thấy A (2 NG / 3 lượt) — đủ của A, không một hàng nào của B", async () => {
    const r = await callerA().getMachineOverlay(input);
    const mine = r.machines.find((m) => m.id === machineId);
    expect(Number(mine!.defectCount)).toBe(2);
    expect(Number(mine!.totalCount)).toBe(3);
    expect(r.scopeApplied).toBe(true);
    expect(r.scopeEmptyReason).toBeNull();
  });

  it("CHIỀU ÂM: người 0 gán thấy 0 — và câu giải thích nói ĐÚNG lý do", async () => {
    const r = await callerNone().getMachineOverlay(input);
    const mine = r.machines.find((m) => m.id === machineId);
    expect(Number(mine?.defectCount ?? 0)).toBe(0);
    expect(r.summary.byMachine.find((b) => b.machineId === machineId)).toBeUndefined();
    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
    expect(r.scopeMessage).toMatch(/gán nhà máy/i);
    expect(r.scopeMessage ?? "").not.toMatch(/không có lỗi nào|không phát hiện lỗi/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ ⑤ getRealTimeHotspots — GROUP BY (máy, điểm đo) trong 1 giờ qua", () => {
  const input = { machineId: 0, hours: 1 as const };
  const withMachine = () => ({ ...input, machineId });

  it("CHIỀU DƯƠNG: admin thấy CẢ HAI điểm đo (A=1, B=2)", async () => {
    const r = await callerAdmin().getRealTimeHotspots(withMachine());
    const a = r.hotspots.find((h) => h.pointDefId === pointDefA);
    const b = r.hotspots.find((h) => h.pointDefId === pointDefB);
    expect(Number(a?.count)).toBe(1);
    expect(Number(b?.count)).toBe(2);
    expect(r.scopeApplied).toBe(false);
  });

  it("CHIỀU ÂM+DƯƠNG: người gán A thấy ĐÚNG điểm A, KHÔNG thấy điểm B", async () => {
    const r = await callerA().getRealTimeHotspots(withMachine());
    expect(r.hotspots.find((h) => h.pointDefId === pointDefA)).toBeDefined();
    expect(r.hotspots.find((h) => h.pointDefId === pointDefB)).toBeUndefined();
    expect(r.scopeApplied).toBe(true);
  });

  it("CHIỀU ÂM: người 0 gán thấy RỖNG + câu trung thực", async () => {
    const r = await callerNone().getRealTimeHotspots(withMachine());
    expect(r.hotspots).toEqual([]);
    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
    expect(r.scopeMessage).toMatch(/gán nhà máy/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ ⑥ getProductDefectOverlay — COUNT NG/tổng theo điểm đo", () => {
  const input = () => ({ productModelId, machineId, startDate: WIN_START, endDate: WIN_END });

  it("CHIỀU DƯƠNG: admin thấy cả hai điểm (A: 2NG/3, B: 3NG/3) — tổng 5", async () => {
    const r = await callerAdmin().getProductDefectOverlay(input());
    const a = r.points.find((p) => p.pointDefId === pointDefA);
    const b = r.points.find((p) => p.pointDefId === pointDefB);
    expect(a!.ngCount).toBe(2);
    expect(a!.totalCount).toBe(3);
    expect(b!.ngCount).toBe(3);
    expect(r.totalNg).toBe(5);
    expect(r.scopeApplied).toBe(false);
  });

  it("CHIỀU ÂM+DƯƠNG: người gán A giữ nguyên số của A, điểm B về 0", async () => {
    const r = await callerA().getProductDefectOverlay(input());
    const a = r.points.find((p) => p.pointDefId === pointDefA);
    const b = r.points.find((p) => p.pointDefId === pointDefB);
    expect(a!.ngCount).toBe(2);
    expect(a!.totalCount).toBe(3);
    expect(b!.ngCount).toBe(0);
    expect(b!.totalCount).toBe(0);
    expect(r.totalNg).toBe(2);
    expect(r.scopeApplied).toBe(true);
  });

  it("CHIỀU ÂM: người 0 gán — mọi điểm về 0 + câu trung thực (KHÔNG nói 'không có lỗi')", async () => {
    const r = await callerNone().getProductDefectOverlay(input());
    expect(r.totalNg).toBe(0);
    expect(r.totalInspected).toBe(0);
    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
    expect(r.scopeMessage).toMatch(/gán nhà máy/i);
    expect(r.scopeMessage ?? "").not.toMatch(/không có lỗi nào|không phát hiện lỗi/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ ⑦ list — phát lại heatmap ĐÃ LƯU", () => {
  const input = () => ({ machineId, limit: 100, offset: 0 });

  it("CHIỀU DƯƠNG: admin thấy TOÀN BỘ 5 hàng — KỂ CẢ hàng NULL (không bị chặn nhầm)", async () => {
    const r = await callerAdmin().list(input());
    const ids = r.heatmaps.map((h) => h.id);
    expect(ids).toEqual(expect.arrayContaining([hmA, hmB, hmNull, delA, delB]));
    expect(Number(r.total)).toBe(5);
    expect(r.scopeApplied).toBe(false);
  });

  it("CHIỀU ÂM: người gán A KHÔNG thấy hàng của B, và KHÔNG thấy hàng NULL (fail-closed)", async () => {
    const r = await callerA().list(input());
    const ids = r.heatmaps.map((h) => h.id);
    expect(ids).not.toContain(hmB);
    expect(ids).not.toContain(hmNull);
    expect(ids).not.toContain(delB);
  });

  it("CHIỀU DƯƠNG: người gán A vẫn thấy ĐỦ hàng của A (2/2) — không vá quá tay", async () => {
    const r = await callerA().list(input());
    expect(r.heatmaps.map((h) => h.id).sort()).toEqual([hmA, delA].sort());
    expect(Number(r.total)).toBe(2);
    expect(r.scopeApplied).toBe(true);
    expect(r.scopeEmptyReason).toBeNull();
  });

  it("CHIỀU ÂM: người 0 gán thấy RỖNG + `total` cũng 0 + câu trung thực", async () => {
    const r = await callerNone().list(input());
    expect(r.heatmaps).toEqual([]);
    expect(Number(r.total)).toBe(0);
    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
    expect(r.scopeMessage).toMatch(/gán nhà máy/i);
    expect(r.scopeMessage ?? "").not.toMatch(/không có dữ liệu|không có lỗi nào/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ ⑧ getLatest — hàng MỚI NHẤT trong phạm vi", () => {
  const input = () => ({ machineId });

  it("CHIỀU DƯƠNG: admin nhận hàng mới nhất — chính là hàng NULL", async () => {
    const r = await callerAdmin().getLatest(input());
    expect(r.heatmap?.id).toBe(delB);
    expect(r.scopeApplied).toBe(false);
  });

  it("CHIỀU ÂM+DƯƠNG: người gán A NHẢY QUA hàng NULL và hàng B, nhận hàng A mới nhất", async () => {
    const r = await callerA().getLatest(input());
    expect(r.heatmap?.id).toBe(delA);
    expect(r.scopeApplied).toBe(true);
  });

  it("CHIỀU ÂM: người 0 gán nhận null — kèm lý do, KHÔNG phải 'không có dữ liệu'", async () => {
    const r = await callerNone().getLatest(input());
    expect(r.heatmap).toBeNull();
    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
    expect(r.scopeMessage).toMatch(/gán nhà máy/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ ⑨ getById — đọc một heatmap đã lưu theo id", () => {
  it("CHIỀU DƯƠNG: admin đọc được CẢ BA (A, B, và hàng NULL)", async () => {
    const c = callerAdmin();
    expect((await c.getById({ id: hmA })).heatmap?.id).toBe(hmA);
    expect((await c.getById({ id: hmB })).heatmap?.id).toBe(hmB);
    expect((await c.getById({ id: hmNull })).heatmap?.id).toBe(hmNull);
  });

  it("CHIỀU DƯƠNG: người gán A đọc được hàng của A", async () => {
    expect((await callerA().getById({ id: hmA })).heatmap?.id).toBe(hmA);
  });

  it("CHIỀU ÂM: người gán A đọc hàng của B ⇒ NOT_FOUND (không tiết lộ là nó tồn tại)", async () => {
    expect(await codeOf(callerA().getById({ id: hmB }))).toBe("NOT_FOUND");
  });

  it("CHIỀU ÂM: người gán A đọc hàng NULL ⇒ NOT_FOUND (fail-closed)", async () => {
    expect(await codeOf(callerA().getById({ id: hmNull }))).toBe("NOT_FOUND");
  });

  it("CHIỀU ÂM: người 0 gán — không có oracle tồn tại, và câu nói ĐÚNG lý do", async () => {
    const r = await callerNone().getById({ id: hmA });
    expect(r.heatmap).toBeNull();
    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
    expect(r.scopeMessage).toMatch(/gán nhà máy/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★ ⑩ delete — cùng cơ chế (một lỗ để hở cạnh một lỗ đã vá vẫn là một lỗ)", () => {
  it("CHIỀU ÂM: người gán A KHÔNG xoá được hàng của B — và hàng đó VẪN CÒN", async () => {
    expect(await codeOf(callerA().delete({ id: delB }))).toBe("NOT_FOUND");
    expect(await savedRowExists(delB)).toBe(true);
  });

  it("CHIỀU DƯƠNG: người gán A xoá được hàng của CHÍNH A", async () => {
    const r = await callerA().delete({ id: delA });
    expect(r.success).toBe(true);
    expect(await savedRowExists(delA)).toBe(false);
  });

  it("CHIỀU DƯƠNG: admin xoá được hàng NULL (không bị chặn nhầm)", async () => {
    const r = await callerAdmin().delete({ id: delB });
    expect(r.success).toBe(true);
    expect(await savedRowExists(delB)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ generate — GHI cột phạm vi: chỉ khi có ĐÚNG MỘT nguồn, còn lại NULL", () => {
  const input = () => ({
    machineId,
    productModelId,
    startDate: WIN_START,
    endDate: WIN_END,
    gridWidth: 10,
    gridHeight: 10,
    mode: "bbox" as const,
    weightBySeverity: false,
    periodType: "DAILY" as const,
  });

  it("người gán A ⇒ hàng đóng góp CHỈ của A ⇒ ghi đúng mã của A", async () => {
    const gen = await callerA().generate(input());
    const conn = await getDb();
    const [row] = await conn!
      .select({ corporateCode: defectHeatmapData.corporateCode, factoryCode: defectHeatmapData.factoryCode })
      .from(defectHeatmapData)
      .where(eq(defectHeatmapData.id, gen.id));
    expect(row.factoryCode).toBe(FAC_A);
    expect(row.corporateCode).toBe(CORP_A);

    // …và đọc lại được bằng chính tài khoản ấy (vòng ghi→đọc khép kín).
    expect((await callerA().getById({ id: gen.id })).heatmap?.id).toBe(gen.id);
  });

  it("admin gộp HAI nhà máy ⇒ KHÔNG có mã nào đúng ⇒ NULL, và người gán A KHÔNG đọc lại được", async () => {
    const gen = await callerAdmin().generate(input());
    const conn = await getDb();
    const [row] = await conn!
      .select({ corporateCode: defectHeatmapData.corporateCode, factoryCode: defectHeatmapData.factoryCode })
      .from(defectHeatmapData)
      .where(eq(defectHeatmapData.id, gen.id));
    // ⚠ Đây là quyết định trung tâm: "không biết" phải ở lại là "không biết".
    expect(row.factoryCode).toBeNull();
    expect(row.corporateCode).toBeNull();

    expect((await callerAdmin().getById({ id: gen.id })).heatmap?.id).toBe(gen.id);
    expect(await codeOf(callerA().getById({ id: gen.id }))).toBe("NOT_FOUND");
  });
});
