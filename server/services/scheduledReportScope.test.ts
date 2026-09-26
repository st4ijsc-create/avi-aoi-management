/**
 * ★★★ 2026-08-17 — NHÓM A: PHẠM VI CHO BA BỘ SINH NỘI DUNG BÁO CÁO HẸN GIỜ.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * Ba hàm dưới đây nằm trên đường **hẹn giờ**: chúng chạy từ cron, KHÔNG có phiên người dùng, và
 * kết quả đi thẳng vào email/tệp đính kèm gửi ra ngoài. Rò ở đây **không màn hình nào thấy** —
 * đó là lý do lưới phải neo vào chính ba hàm ấy chứ không vào router.
 *
 *   1. `scheduledReportService.generateOEEReportContent`      — `oee_metrics` + `downtime_events`
 *   2. `scheduledReportService.generateMachineHealthReportContent` — `getAllMachinesOEELive`
 *   3. `reportGenerator.generateNGVisualReport`               — NG trend / top-NG / heatmap
 *
 * File NÀY đo **đường dây** (danh tính có được truyền xuống không, cổng fail-closed có đứng
 * TRƯỚC truy vấn không, tài liệu có tự khai phạm vi không) với CSDL giả lập.
 * File `scheduledReportScope.db.test.ts` đo **CON SỐ** trên CSDL THẬT — bắt buộc, vì đúng lớp
 * lỗi "mock che sự cố toàn phần" đã để `fetchOeeReportRows` nhúng một `Date` làm tham số và
 * báo cáo OEE **chưa bao giờ chạy được trên CSDL thật** trong khi lưới cũ vẫn xanh.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  getUserById: vi.fn(),
  getDefaultEmailTemplateConfig: vi.fn(),
  getYieldRateByFactory: vi.fn(),
  getNGTrendByDay: vi.fn(),
  getTopNGMeasurementPoints: vi.fn(),
  getWorkstationHeatmap: vi.fn(),
  getFactoryById: vi.fn(),
  getWorkshopById: vi.fn(),
  getLineById: vi.fn(),
  resolveDataScope: vi.fn(),
  getAccessFilterConditions: vi.fn(),
  getDb: vi.fn(),
  getTenantScopedMachineIds: vi.fn(),
  getAllMachinesOEELive: vi.fn(),
  getMachineHealthScore: vi.fn(),
}));

vi.mock("../db", () => ({
  getUserById: mocks.getUserById,
  getDefaultEmailTemplateConfig: mocks.getDefaultEmailTemplateConfig,
  getYieldRateByFactory: mocks.getYieldRateByFactory,
  getNGTrendByDay: mocks.getNGTrendByDay,
  getTopNGMeasurementPoints: mocks.getTopNGMeasurementPoints,
  getWorkstationHeatmap: mocks.getWorkstationHeatmap,
  getFactoryById: mocks.getFactoryById,
  getWorkshopById: mocks.getWorkshopById,
  getLineById: mocks.getLineById,
}));
vi.mock("../_core/accessControl", async () => {
  // ⚠ CHỈ giả lập hai hàm phân giải. Nhãn (`scopeLabelsOf`, `NO_FACTORY_ASSIGNMENT_MESSAGE`)
  // phải là hàng THẬT — câu chữ trung thực chính là thứ đang được đo.
  const labels = await import("../_core/accessControlLabels");
  return {
    ...labels,
    resolveDataScope: mocks.resolveDataScope,
    getAccessFilterConditions: mocks.getAccessFilterConditions,
  };
});
vi.mock("../db/connection", () => ({ getDb: mocks.getDb, getReadDb: mocks.getDb }));
vi.mock("../db/reportAggregators", async (importOriginal) => ({
  // `tenantMachineGate` giữ HÀNG THẬT — chính mệnh đề SQL nó sinh ra là thứ đang được đo.
  ...(await importOriginal<typeof import("../db/reportAggregators")>()),
  getTenantScopedMachineIds: mocks.getTenantScopedMachineIds,
}));
vi.mock("./oeeService", () => ({ getAllMachinesOEELive: mocks.getAllMachinesOEELive }));
vi.mock("../_core/socket", () => ({ getMachineHealthScore: mocks.getMachineHealthScore }));

import { scheduledReportService, resolveScheduleScope } from "./scheduledReportService";
import { generateNGVisualReport, generateNGVisualEmailHTML } from "./reportGenerator";
import { NO_FACTORY_ASSIGNMENT_MESSAGE } from "../_core/accessControlLabels";
import { sql } from "drizzle-orm";

// ── Danh tính dùng chung ────────────────────────────────────────────────────────────────────
const ADMIN = { id: 1, username: "admin", role: "admin", isActive: true };
const ENGINEER_A = { id: 51, username: "engineer1", role: "engineer", isActive: true };
const NO_ASSIGN = { id: 49, username: "supervisor1", role: "supervisor", isActive: true };
const DISABLED = { id: 77, username: "cu_nhan_vien", role: "engineer", isActive: false };

/** Mệnh đề tenant giả — nhận diện được trong SQL kết xuất bằng chính mã nhà máy. */
const FILTER_A: SQL = sql`"product_inspections"."factoryCode" = ${"FAC-A"}`;

const UNSCOPED = { scopeApplied: false, scopeEmptyReason: null, scopeMessage: null };
const SCOPED = { scopeApplied: true, scopeEmptyReason: null, scopeMessage: null };
const EMPTY_SCOPE = {
  scopeApplied: true,
  scopeEmptyReason: "no_factory_assignment" as const,
  scopeMessage: NO_FACTORY_ASSIGNMENT_MESSAGE,
};

/** Cấu hình bộ phân giải cho MỘT người tạo lịch. */
function asOwner(user: typeof ADMIN, scope: typeof UNSCOPED | typeof SCOPED | typeof EMPTY_SCOPE, filter?: SQL) {
  mocks.getUserById.mockResolvedValue(user);
  mocks.resolveDataScope.mockResolvedValue({ ...scope, filter });
  mocks.getAccessFilterConditions.mockResolvedValue(filter);
}

/** Kết xuất một điều kiện drizzle thành SQL text + params để soi mệnh đề tenant. */
function renderSql(cond: unknown): { text: string; params: unknown[] } {
  const q = new PgDialect().sqlToQuery(cond as SQL);
  return { text: q.sql, params: q.params };
}

/**
 * `getDb` giả: ghi lại MỌI điều kiện `.where(...)` để lưới soi được mệnh đề tenant.
 * ⚠ Đây CHÍNH LÀ cái mock đã che một sự cố toàn phần (tham số `Date`) ở lượt trước — nên nó chỉ
 * được dùng để đo ĐƯỜNG DÂY; con số thật do `scheduledReportScope.db.test.ts` canh.
 */
function fakeConn(oeeRows: any[], dtRows: any[]) {
  const captured: unknown[] = [];
  let n = 0;
  const builder = (rows: any[]) => {
    const b: any = {
      where(cond: unknown) { captured.push(cond); return b; },
      orderBy() { return b; },
      limit() { return Promise.resolve(rows); },
      then(res: any, rej: any) { return Promise.resolve(rows).then(res, rej); },
    };
    return b;
  };
  return {
    captured,
    conn: { select: () => ({ from: () => builder(n++ === 0 ? oeeRows : dtRows) }) },
  };
}

const OEE_ROW_A = {
  machineId: 101, machineCode: "MC-A", availability: 9000, performance: 8000,
  quality: 9500, oee: 6800, timestamp: new Date("2026-08-16T00:00:00Z"),
};
const OEE_ROW_B = { ...OEE_ROW_A, machineId: 202, machineCode: "MC-B" };

const OEE_REPORT = { id: 1, name: "r", type: "oee" as const, frequency: "daily" as const, recipients: [], isEnabled: true, createdAt: new Date() };
const HEALTH_REPORT = { ...OEE_REPORT, type: "machine_health" as const };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDefaultEmailTemplateConfig.mockResolvedValue(null);
  mocks.getMachineHealthScore.mockReturnValue(undefined);
  mocks.getTenantScopedMachineIds.mockResolvedValue([101]);
  mocks.getAllMachinesOEELive.mockResolvedValue([
    { machineId: 101, machineCode: "MC-A", oee: 55, availability: 90, quality: 95 },
    { machineId: 202, machineCode: "MC-B", oee: 40, availability: 70, quality: 80 },
  ]);
  mocks.getNGTrendByDay.mockResolvedValue([{ date: "2026-08-16", totalCount: 100, okCount: 90, ngCount: 10, ntfCount: 0, ngRate: 10 }]);
  mocks.getTopNGMeasurementPoints.mockResolvedValue([{ pointDefId: 1, code: "P1", name: "P1", ngCount: 4, percentage: 40 }]);
  mocks.getWorkstationHeatmap.mockResolvedValue([{ workstationId: 5, workstationName: "WS-1", ngCount: 4, inspectionCount: 10, ngRate: 40 }]);
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// 0. `resolveScheduleScope` — cổng fail-closed dùng chung của cả ba hàm (chưa có lưới nào)
// ════════════════════════════════════════════════════════════════════════════════════════════
describe("resolveScheduleScope — fail-closed 4 nhánh", () => {
  it("createdBy rỗng/0 ⇒ TỪ CHỐI, không rơi về tổng hợp toàn cục", async () => {
    await expect(resolveScheduleScope({ createdBy: 0 })).rejects.toThrow(/NGƯỜI TẠO LỊCH/);
    await expect(resolveScheduleScope({})).rejects.toThrow(/NGƯỜI TẠO LỊCH/);
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it("tài khoản không còn tồn tại ⇒ TỪ CHỐI", async () => {
    mocks.getUserById.mockResolvedValue(null);
    await expect(resolveScheduleScope({ createdBy: 999 })).rejects.toThrow(/không còn tồn tại/);
  });

  it("tài khoản bị TẮT ⇒ TỪ CHỐI dù còn nguyên gán nhà máy", async () => {
    asOwner(DISABLED, SCOPED, FILTER_A);
    await expect(resolveScheduleScope({ createdBy: DISABLED.id })).rejects.toThrow(/vô hiệu hoá/);
  });

  it("0 gán nhà máy ⇒ TỪ CHỐI với câu 'chưa được gán nhà máy', KHÔNG phải 'không có dữ liệu'", async () => {
    asOwner(NO_ASSIGN, EMPTY_SCOPE, sql`1 = 0`);
    await expect(resolveScheduleScope({ createdBy: NO_ASSIGN.id })).rejects.toThrow(/chưa được gán nhà máy/);
    await expect(resolveScheduleScope({ createdBy: NO_ASSIGN.id })).rejects.not.toThrow(/không có dữ liệu/);
  });

  it("DƯƠNG: admin đi qua, KHÔNG bị chặn và KHÔNG bị dán câu thu hẹp", async () => {
    asOwner(ADMIN, UNSCOPED, undefined);
    const s = await resolveScheduleScope({ createdBy: ADMIN.id });
    expect(s.actor).toEqual({ id: 1, role: "admin" });
    expect(s.scopeApplied).toBe(false);
    expect(s.scopeNote).toBeUndefined();
  });

  it("DƯƠNG: người CÓ gán đi qua và mang câu tự khai phạm vi", async () => {
    asOwner(ENGINEER_A, SCOPED, FILTER_A);
    const s = await resolveScheduleScope({ createdBy: ENGINEER_A.id });
    expect(s.scopeApplied).toBe(true);
    expect(s.scopeNote).toMatch(/KHÔNG phải toàn hệ thống/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// 1. generateOEEReportContent — `oee_metrics`/`downtime_events` KHÔNG có cột tenant
// ════════════════════════════════════════════════════════════════════════════════════════════
describe("generateOEEReportContent — phạm vi", () => {
  it("ÂM: lịch của người gán A nhúng mệnh đề tenant vào CẢ oee_metrics VÀ downtime_events", async () => {
    asOwner(ENGINEER_A, SCOPED, FILTER_A);
    const f = fakeConn([OEE_ROW_A], [{ category: "breakdown", duration: 30 }]);
    mocks.getDb.mockResolvedValue(f.conn);

    await scheduledReportService.generateOEEReportContent({ ...OEE_REPORT, createdBy: ENGINEER_A.id });

    expect(f.captured).toHaveLength(2);
    for (const cond of f.captured) {
      const { text, params } = renderSql(cond);
      // Dùng LẠI đúng mệnh đề của `getAccessFilterConditions` trong một truy vấn phụ trên
      // `product_inspections` — KHÔNG dựng lại luật qua machines→lines→factories.
      expect(text).toContain("product_inspections");
      expect(text).toMatch(/in \(select/i);
      expect(params).toContain("FAC-A");
    }
  });

  it("DƯƠNG: admin KHÔNG bị nhúng mệnh đề nào (chống vá quá tay)", async () => {
    asOwner(ADMIN, UNSCOPED, undefined);
    const f = fakeConn([OEE_ROW_A, OEE_ROW_B], []);
    mocks.getDb.mockResolvedValue(f.conn);

    const content = await scheduledReportService.generateOEEReportContent({ ...OEE_REPORT, createdBy: ADMIN.id });

    for (const cond of f.captured) {
      expect(renderSql(cond).text).not.toContain("product_inspections");
    }
    expect(content.machineOEE).toHaveLength(2);
    expect(content.scopeApplied).toBe(false);
    expect(content.scopeNote).toBeUndefined();
  });

  it("ÂM: người 0-gán ⇒ TỪ CHỐI TRƯỚC khi chạm CSDL, kèm câu đúng", async () => {
    asOwner(NO_ASSIGN, EMPTY_SCOPE, sql`1 = 0`);
    mocks.getDb.mockResolvedValue(fakeConn([OEE_ROW_A], []).conn);

    await expect(
      scheduledReportService.generateOEEReportContent({ ...OEE_REPORT, createdBy: NO_ASSIGN.id }),
    ).rejects.toThrow(/chưa được gán nhà máy/);
    // Cổng đứng TRƯỚC mọi truy vấn — một lượt bị từ chối không được chạm dữ liệu, kể cả để vứt đi.
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("tài liệu TỰ KHAI phạm vi khi bị thu hẹp — và câu ấy in RA HTML", async () => {
    asOwner(ENGINEER_A, SCOPED, FILTER_A);
    mocks.getDb.mockResolvedValue(fakeConn([OEE_ROW_A], []).conn);

    const content = await scheduledReportService.generateOEEReportContent({ ...OEE_REPORT, createdBy: ENGINEER_A.id });
    expect(content.scopeApplied).toBe(true);
    expect(content.scopeNote).toMatch(/KHÔNG phải toàn hệ thống/);

    const html = await scheduledReportService.formatOEEReportHtml(content);
    expect(html).toContain(content.scopeNote!);
  });

  it("KHÔNG rò `filter` (tham chiếu vòng) ra nội dung báo cáo", async () => {
    asOwner(ENGINEER_A, SCOPED, FILTER_A);
    mocks.getDb.mockResolvedValue(fakeConn([OEE_ROW_A], []).conn);
    const content = await scheduledReportService.generateOEEReportContent({ ...OEE_REPORT, createdBy: ENGINEER_A.id });
    expect(content).not.toHaveProperty("filter");
    expect(() => JSON.stringify(content)).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// 2. generateMachineHealthReportContent — không có cột tenant, lọc theo TẬP máy trong phạm vi
// ════════════════════════════════════════════════════════════════════════════════════════════
describe("generateMachineHealthReportContent — phạm vi", () => {
  it("ÂM: lịch của người gán A KHÔNG lấy máy của B", async () => {
    asOwner(ENGINEER_A, SCOPED, FILTER_A);
    const content = await scheduledReportService.generateMachineHealthReportContent({ ...HEALTH_REPORT, createdBy: ENGINEER_A.id });

    expect(content.machineHealth.map((m) => m.machineCode)).toEqual(["MC-A"]);
    expect(content.summary.totalMachines).toBe(1);
    expect(mocks.getTenantScopedMachineIds).toHaveBeenCalledTimes(1);
  });

  it("DƯƠNG: người gán A vẫn lấy ĐỦ máy của A (chống vá quá tay)", async () => {
    asOwner(ENGINEER_A, SCOPED, FILTER_A);
    mocks.getTenantScopedMachineIds.mockResolvedValue([101, 202]);
    const content = await scheduledReportService.generateMachineHealthReportContent({ ...HEALTH_REPORT, createdBy: ENGINEER_A.id });
    expect(content.machineHealth).toHaveLength(2);
  });

  it("DƯƠNG: admin lấy TOÀN BỘ và không đi qua truy vấn thu hẹp", async () => {
    asOwner(ADMIN, UNSCOPED, undefined);
    const content = await scheduledReportService.generateMachineHealthReportContent({ ...HEALTH_REPORT, createdBy: ADMIN.id });
    expect(content.machineHealth).toHaveLength(2);
    expect(content.scopeApplied).toBe(false);
    expect(mocks.getTenantScopedMachineIds).not.toHaveBeenCalled();
  });

  it("ÂM: người 0-gán ⇒ TỪ CHỐI TRƯỚC khi đọc bất kỳ số liệu máy nào", async () => {
    asOwner(NO_ASSIGN, EMPTY_SCOPE, sql`1 = 0`);
    await expect(
      scheduledReportService.generateMachineHealthReportContent({ ...HEALTH_REPORT, createdBy: NO_ASSIGN.id }),
    ).rejects.toThrow(/chưa được gán nhà máy/);
    expect(mocks.getAllMachinesOEELive).not.toHaveBeenCalled();
  });

  it("tài liệu tự khai phạm vi + không rò `filter`", async () => {
    asOwner(ENGINEER_A, SCOPED, FILTER_A);
    const content = await scheduledReportService.generateMachineHealthReportContent({ ...HEALTH_REPORT, createdBy: ENGINEER_A.id });
    expect(content.scopeNote).toMatch(/KHÔNG phải toàn hệ thống/);
    const html = await scheduledReportService.formatMachineHealthReportHtml(content);
    expect(html).toContain(content.scopeNote!);
    expect(content).not.toHaveProperty("filter");
    expect(() => JSON.stringify(content)).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// 3. generateNGVisualReport — ba nguồn đều ĐÃ có trục danh tính; lỗ là NƠI GỌI không truyền
// ════════════════════════════════════════════════════════════════════════════════════════════
describe("generateNGVisualReport — phạm vi", () => {
  const WINDOW = { startDate: new Date("2026-08-01T00:00:00Z"), endDate: new Date("2026-08-17T00:00:00Z") };

  it("ÂM: truyền danh tính người tạo lịch xuống CẢ BA nguồn dữ liệu", async () => {
    asOwner(ENGINEER_A, SCOPED, FILTER_A);
    await generateNGVisualReport({ ...WINDOW, actor: { id: ENGINEER_A.id, role: ENGINEER_A.role } });

    for (const m of [mocks.getNGTrendByDay, mocks.getTopNGMeasurementPoints, mocks.getWorkstationHeatmap]) {
      expect(m).toHaveBeenCalled();
      for (const call of m.mock.calls) {
        expect(call[0]).toMatchObject({ userId: ENGINEER_A.id, userRole: ENGINEER_A.role });
      }
    }
  });

  it("DƯƠNG: admin vẫn đi qua và nguồn nhận đúng vai 'admin' (không lọc)", async () => {
    asOwner(ADMIN, UNSCOPED, undefined);
    const data = await generateNGVisualReport({ ...WINDOW, actor: { id: ADMIN.id, role: "admin" } });
    expect(mocks.getNGTrendByDay.mock.calls[0][0]).toMatchObject({ userId: 1, userRole: "admin" });
    expect(data.scopeApplied).toBe(false);
    expect(data.scopeNote).toBeUndefined();
    expect(data.summary.totalInspections).toBe(100);
  });

  it("ÂM: người 0-gán ⇒ TỪ CHỐI trước khi đọc, kèm câu 'chưa được gán nhà máy'", async () => {
    asOwner(NO_ASSIGN, EMPTY_SCOPE, sql`1 = 0`);
    await expect(
      generateNGVisualReport({ ...WINDOW, actor: { id: NO_ASSIGN.id, role: NO_ASSIGN.role } }),
    ).rejects.toThrow(/chưa được gán nhà máy/);
    expect(mocks.getNGTrendByDay).not.toHaveBeenCalled();
  });

  it("tài liệu tự khai phạm vi trong HTML gửi đi", async () => {
    asOwner(ENGINEER_A, SCOPED, FILTER_A);
    const data = await generateNGVisualReport({ ...WINDOW, actor: { id: ENGINEER_A.id, role: ENGINEER_A.role } });
    expect(data.scopeNote).toMatch(/KHÔNG phải toàn hệ thống/);
    expect(generateNGVisualEmailHTML(data)).toContain(data.scopeNote!);
  });

  it("câu RỖNG không được nói 'không có dữ liệu' — kể cả ở vế phủ định", async () => {
    asOwner(ENGINEER_A, SCOPED, FILTER_A);
    mocks.getNGTrendByDay.mockResolvedValue([]);
    mocks.getTopNGMeasurementPoints.mockResolvedValue([]);
    mocks.getWorkstationHeatmap.mockResolvedValue([]);

    const data = await generateNGVisualReport({ ...WINDOW, actor: { id: ENGINEER_A.id, role: ENGINEER_A.role } });
    const html = generateNGVisualEmailHTML(data);
    expect(html.toLowerCase()).not.toContain("không có dữ liệu");
  });

  it("KHÔNG rò `filter` ra dữ liệu báo cáo", async () => {
    asOwner(ENGINEER_A, SCOPED, FILTER_A);
    const data = await generateNGVisualReport({ ...WINDOW, actor: { id: ENGINEER_A.id, role: ENGINEER_A.role } });
    expect(data).not.toHaveProperty("filter");
    expect(() => JSON.stringify(data)).not.toThrow();
  });
});
