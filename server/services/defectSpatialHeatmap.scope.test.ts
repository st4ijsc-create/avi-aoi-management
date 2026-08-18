/**
 * ★★★ 2026-08-17 — PHẠM VI DỮ LIỆU của heatmap lỗi.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * LỖ ĐÃ ĐO (trước bản vá này)
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * `defectSpatialHeatmap.ts` lọc ngày + `result='NG'` + machineId/productModelId, KHÔNG lọc
 * `corporateCode`/`factoryCode`. `/history` thì CÓ (`server/db/inspection.ts` →
 * `getAccessFilterConditions`). Hệ quả đo được trên `aoi_management` ngày 2026-08-17:
 * `supervisor1` — tài khoản DUY NHẤT đang giữ bit `analytics_defect_heatmap` ngoài admin —
 * có **0 gán nhà máy**, nên `/history` cho nó rỗng, còn heatmap cho nó tổng hợp NG trên
 * **toàn bộ 22.995 bản ghi kiểm**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * LƯỚI NÀY ĐO GÌ — BA TRUY VẤN, HAI CHIỀU
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * Ba truy vấn ĐỌC DỮ LIỆU của module (mỗi cái một `.where()` riêng, nên gỡ lọc khỏi MỘT cái
 * cũng phải ĐỎ):
 *   ① `fetchBboxRows` — SELECT các hàng NG **CÓ** bbox   → `totalDefects` / `grid`
 *   ② `fetchBboxRows` — COUNT các hàng NG **KHÔNG** bbox → `excludedNoBbox`
 *   ③ `computePointDefFallbackHeatmap` — GROUP BY pointDefId → `totalDefects` chế độ logic
 * (Truy vấn thứ tư trong module chỉ đọc `product_models.imageWidth/Height` — dữ liệu master
 * của sản phẩm, không phải bản ghi kiểm, nên không nằm trong trục phạm vi này.)
 *
 * CHIỀU ÂM: người gán nhà máy A không thấy dữ liệu nhà máy B; người 0 gán thấy RỖNG.
 * CHIỀU DƯƠNG: admin vẫn thấy TOÀN BỘ; người gán A vẫn thấy ĐỦ dữ liệu A (chống "vá quá tay
 * thành chặn tất cả" — bản vá phải hẹp đúng bằng phạm vi, không hẹp hơn).
 *
 * ⚠ CÂU "RỖNG" PHẢI TRUNG THỰC: người 0 gán nhận `scopeEmptyReason:"no_factory_assignment"`
 * kèm câu nói rõ *"chưa được gán nhà máy"*. Nó TUYỆT ĐỐI không được nói "không có lỗi nào" —
 * giả vờ không có dữ liệu dạy người vận hành rằng **hệ thống hỏng** trong khi sự thật là
 * **phạm vi của họ rỗng**, và họ sẽ đi tìm lỗi ở đúng chỗ không có lỗi.
 *
 * Lưới chạy trên CSDL test thật (vitest.setup.ts) với `_core/accessControl` THẬT — không mock
 * bộ phân giải phạm vi, vì thứ cần chứng minh chính là SQL sinh ra từ nó có tới nơi hay không.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { computeSpatialHeatmap } from "./defectSpatialHeatmap";
import * as db from "../db";
import { getDb } from "../db/connection";
import { clearAssignmentCache } from "../_core/accessControl";
import { users, type InsertMeasurementResult, type InsertUser } from "../../drizzle/schema";

const ts = Date.now();
const FAC_A = `SCP_FAC_A_${ts}`;
const FAC_B = `SCP_FAC_B_${ts}`;
const CORP_A = `SCP_CORP_A_${ts}`;
const CORP_B = `SCP_CORP_B_${ts}`;

// Cửa sổ riêng của file này (không đụng dữ liệu ca khác), và mọi truy vấn còn ghim thêm
// `productModelId` duy nhất ⇒ khác biệt DUY NHẤT giữa ba người dùng là PHẠM VI.
const WINDOW_START = new Date("2031-03-01T00:00:00Z");
const WINDOW_END = new Date("2031-03-10T00:00:00Z");
const INSPECTED_AT = new Date("2031-03-05T03:00:00Z");

let productModelId: number;
let adminId: number;
let userAId: number;
let userNoneId: number;

async function mkUser(role: NonNullable<InsertUser["role"]>, tag: string): Promise<number> {
  const conn = await getDb();
  const [u] = await conn!
    .insert(users)
    .values({
      openId: `scp_hm_${tag}_${ts}`,
      username: `scp_hm_${tag}_${ts}`,
      name: `scope heatmap ${tag}`,
      role,
      loginMethod: "local",
    })
    .returning({ id: users.id });
  return u.id;
}

/** Đối số chung: chỉ `scope` đổi giữa các ca. */
function q(scope: { userId: number; userRole: string }, mode: "bbox" | "pointDef" = "bbox") {
  return {
    startDate: WINDOW_START,
    endDate: WINDOW_END,
    productModelId,
    gridWidth: 10,
    gridHeight: 10,
    mode,
    scope,
  } as const;
}

beforeAll(async () => {
  const factoryId = await db.createFactory({ code: `SCPF_${ts}`, name: "Scope fac" });
  const workshopId = await db.createWorkshop({ factoryId, code: `SCPW_${ts}`, name: "Scope ws" });
  const lineId = await db.createProductionLine({ workshopId, code: `SCPL_${ts}`, name: "Scope line" });
  const stationId = await db.createStation({ lineId, code: `SCPS_${ts}`, name: "Scope st", orderIndex: 1 });
  const machineId = await db.createMachine({
    stationId,
    code: `SCPM_${ts}`,
    name: "Scope machine",
    machineType: "AOI",
    apiKey: `scope_hm_${ts}`,
  });
  productModelId = await db.createProductModel({
    code: `SCPP_${ts}`,
    name: "Scope product",
    imageWidth: 1000,
    imageHeight: 800,
  });
  const pointDefId = await db.createMeasurementPointDef({
    productModelId,
    code: `SCPMP_${ts}`,
    name: "Scope point",
    measurementType: "VISUAL",
    positionX: 0,
    positionY: 0,
  });

  // ── Nhà máy A: 2 NG CÓ bbox (ô (0,0) và (5,5)) + 1 NG KHÔNG bbox ──────────────
  const inspA = await db.createProductInspection({
    machineId,
    productModelId,
    serialNumber: `SN_SCP_A_${ts}`,
    overallResult: "NG",
    originalResult: "NG",
    inspectionTime: INSPECTED_AT,
    corporateCode: CORP_A,
    factoryCode: FAC_A,
  });
  await db.createMeasurementResults([
    { inspectionId: inspA, pointDefId, result: "NG", defectBboxX: 40, defectBboxY: 30, defectBboxW: 20, defectBboxH: 20 },
    { inspectionId: inspA, pointDefId, result: "NG", defectBboxX: 540, defectBboxY: 430, defectBboxW: 20, defectBboxH: 20 },
    { inspectionId: inspA, pointDefId, result: "NG" },
  ] satisfies InsertMeasurementResult[]);

  // ── Nhà máy B: 3 NG CÓ bbox (ô (9,9)) + 2 NG KHÔNG bbox ───────────────────────
  const inspB = await db.createProductInspection({
    machineId,
    productModelId,
    serialNumber: `SN_SCP_B_${ts}`,
    overallResult: "NG",
    originalResult: "NG",
    inspectionTime: INSPECTED_AT,
    corporateCode: CORP_B,
    factoryCode: FAC_B,
  });
  await db.createMeasurementResults([
    { inspectionId: inspB, pointDefId, result: "NG", defectBboxX: 950, defectBboxY: 760, defectBboxW: 0, defectBboxH: 0 },
    { inspectionId: inspB, pointDefId, result: "NG", defectBboxX: 955, defectBboxY: 765, defectBboxW: 0, defectBboxH: 0 },
    { inspectionId: inspB, pointDefId, result: "NG", defectBboxX: 960, defectBboxY: 770, defectBboxW: 0, defectBboxH: 0 },
    { inspectionId: inspB, pointDefId, result: "NG" },
    { inspectionId: inspB, pointDefId, result: "NG" },
  ] satisfies InsertMeasurementResult[]);

  adminId = await mkUser("admin", "admin");
  userAId = await mkUser("engineer", "faca");
  userNoneId = await mkUser("engineer", "none");
  await db.createFactoryAssignment({ userId: userAId, factoryCode: FAC_A, assignedBy: adminId });
  // `userNoneId` cố ý KHÔNG có gán nào — đúng hình dạng operator1/maint1/supervisor1 hôm nay.
  clearAssignmentCache();
});

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ heatmap ① truy vấn hàng NG CÓ bbox — lọc theo phạm vi", () => {
  it("CHIỀU DƯƠNG: admin vẫn thấy TOÀN BỘ (A + B), không bị bản vá chặn nhầm", async () => {
    const conn = await getDb();
    const r = await computeSpatialHeatmap(conn!, q({ userId: adminId, userRole: "admin" }));

    expect(r.totalDefects).toBe(5); // 2 của A + 3 của B
    expect(r.grid[0][0]).toBe(1);
    expect(r.grid[5][5]).toBe(1);
    expect(r.grid[9][9]).toBe(3);
    expect(r.scopeApplied).toBe(false); // admin = toàn cục, KHÔNG có bộ lọc nào áp lên
    expect(r.scopeEmptyReason).toBeNull();
  });

  it("CHIỀU ÂM: người gán nhà máy A KHÔNG thấy một hàng nào của nhà máy B", async () => {
    const conn = await getDb();
    const r = await computeSpatialHeatmap(conn!, q({ userId: userAId, userRole: "engineer" }));

    expect(r.totalDefects).toBe(2);
    expect(r.grid[9][9]).toBe(0); // ô của nhà máy B — phải TRỐNG
    expect(r.scopeApplied).toBe(true);
  });

  it("CHIỀU DƯƠNG: người gán A vẫn thấy ĐỦ dữ liệu của A (không vá quá tay)", async () => {
    const conn = await getDb();
    const r = await computeSpatialHeatmap(conn!, q({ userId: userAId, userRole: "engineer" }));

    // Đúng bằng phần A của phép đo admin ở ca trên — không thiếu một hàng nào.
    expect(r.grid[0][0]).toBe(1);
    expect(r.grid[5][5]).toBe(1);
    expect(r.maxDefectsInCell).toBe(1);
    expect(r.hotspots.length).toBe(2);
    expect(r.scopeEmptyReason).toBeNull();
  });

  it("CHIỀU ÂM: người 0 gán nhà máy thấy RỖNG — và câu giải thích nói ĐÚNG lý do", async () => {
    const conn = await getDb();
    const r = await computeSpatialHeatmap(conn!, q({ userId: userNoneId, userRole: "engineer" }));

    expect(r.totalDefects).toBe(0);
    expect(r.hotspots).toEqual([]);
    expect(r.scopeApplied).toBe(true);
    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
    // Câu phải nói về GÁN NHÀ MÁY…
    expect(r.scopeMessage).toMatch(/gán nhà máy/i);
    // …và KHÔNG được nói "không có lỗi" (đột biến: đổi câu thành "không có lỗi nào" ⇒ ĐỎ).
    expect(r.scopeMessage ?? "").not.toMatch(/không có lỗi nào|không phát hiện lỗi/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ heatmap ② COUNT hàng NG KHÔNG bbox (`excludedNoBbox`) — lọc theo phạm vi", () => {
  it("admin đếm cả A lẫn B; người gán A chỉ đếm A; người 0 gán đếm 0", async () => {
    const conn = await getDb();
    const rAdmin = await computeSpatialHeatmap(conn!, q({ userId: adminId, userRole: "admin" }));
    const rA = await computeSpatialHeatmap(conn!, q({ userId: userAId, userRole: "engineer" }));
    const rNone = await computeSpatialHeatmap(conn!, q({ userId: userNoneId, userRole: "engineer" }));

    expect(rAdmin.excludedNoBbox).toBe(3); // 1 của A + 2 của B
    expect(rA.excludedNoBbox).toBe(1); // CHỈ của A — B không rò qua đường đếm
    expect(rNone.excludedNoBbox).toBe(0);

    // Tỉ lệ phái sinh cũng phải tính trên tập ĐÃ LỌC, không trên tập toàn cục.
    expect(rA.excludedNoBboxPct).toBe(33.33); // 1 / (2 + 1)
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ heatmap ③ GROUP BY pointDefId (chế độ logic `pointDef`) — lọc theo phạm vi", () => {
  it("admin thấy cả 8 NG; người gán A thấy 3; người 0 gán thấy 0 + câu trung thực", async () => {
    const conn = await getDb();
    const rAdmin = await computeSpatialHeatmap(conn!, q({ userId: adminId, userRole: "admin" }, "pointDef"));
    const rA = await computeSpatialHeatmap(conn!, q({ userId: userAId, userRole: "engineer" }, "pointDef"));
    const rNone = await computeSpatialHeatmap(conn!, q({ userId: userNoneId, userRole: "engineer" }, "pointDef"));

    expect(rAdmin.mode).toBe("pointDef");
    expect(rAdmin.totalDefects).toBe(8); // 3 của A + 5 của B (bbox không liên quan ở chế độ logic)
    expect(rA.totalDefects).toBe(3); // CHỈ của A
    expect(rNone.totalDefects).toBe(0);
    expect(rNone.scopeEmptyReason).toBe("no_factory_assignment");
    expect(rNone.scopeMessage).toMatch(/gán nhà máy/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★ chế độ panelBoard đi qua CÙNG hai truy vấn ① ② nên cũng phải bị lọc", () => {
  it("không có panel def ⇒ hạ về bbox — và phần hạ về ấy vẫn bị lọc theo phạm vi", async () => {
    const conn = await getDb();
    const rAdmin = await computeSpatialHeatmap(conn!, { ...q({ userId: adminId, userRole: "admin" }), mode: "panelBoard" });
    const rA = await computeSpatialHeatmap(conn!, { ...q({ userId: userAId, userRole: "engineer" }), mode: "panelBoard" });

    expect(rAdmin.panelAware).toBe(false); // sản phẩm test không có panel def
    expect(rAdmin.totalDefects).toBe(5);
    expect(rA.totalDefects).toBe(2);
  });
});
