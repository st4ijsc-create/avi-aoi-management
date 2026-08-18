/**
 * ★★★ 2026-08-17 — RÒ PHẠM VI Ở BA SERVICE BÁO CÁO (nợ đã khai tường minh trong mã).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * LỖ ĐÃ ĐO (trước bản vá này) — BA ĐƯỜNG, BA HÌNH DẠNG KHÁC NHAU
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *  ① `services/dataComparisonService.ts` — 4 truy vấn **SQL THÔ** (:154 · :204 · :277 · :354),
 *     KHÔNG cái nào mang mệnh đề tenant và hàm KHÔNG có trục `userId` để nhận. Với tới được từ
 *     `powerpoint.exportComparison` và `dataComparison.compare` (cả hai `protectedProcedure`).
 *  ② `services/externalReportService.ts` + `db/reportAggregators.ts` — với tới được từ
 *     `reportArtifact.generate` (`protectedProcedure`); `ctx.user.id` chỉ đi vào ô `createdBy`.
 *  ③ `services/scheduledReportService.ts` (:201, :206) — chạy KHÔNG có phiên người dùng.
 *
 * ⚠ Ba lỗ này KHÁC lỗ `or()` rỗng và KHÁC lỗ "router quên truyền `userId`" đã vá cùng ngày:
 * ở đây HÀM SẢN XUẤT KHÔNG CÓ CHỖ ĐỂ NHẬN danh tính. Vì vậy mọi lưới cũ (`accessControlScope`,
 * `reportExportScope`) đều XANH suốt trong khi ba lỗ mở toang — chúng đo những đường khác.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * LƯỚI NÀY ĐO GÌ — HAI CHIỀU
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * ÂM   : người gán nhà máy A không lấy được số của B; người 0 gán bị TỪ CHỐI, kèm ĐÚNG lý do.
 * DƯƠNG: admin vẫn lấy TOÀN BỘ; người gán A vẫn lấy ĐỦ số của A (chống "vá quá tay thành
 *        chặn tất cả" — lưới xanh mà tính năng chết).
 *
 * ⚠ CỬA SỔ RIÊNG CỦA LƯỢT CHẠY + LỌC THEO MÁY DUY NHẤT. Xem docblock của `INSPECTED_AT`:
 * một lưới nuốt dữ liệu của chính nó cho ra ĐỎ GIẢ, vô dụng y như XANH GIẢ.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

// ── Seam ghi-lại: bắt ĐÚNG đối tượng dữ liệu đi vào bộ dựng tài liệu ─────────────────────
const pptComparisonCalls: Array<{ data: any }> = [];
const renderCalls: Array<{ type: string; subtitle?: string; data: any[] }> = [];

vi.mock("../services/powerpointService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/powerpointService")>();
  return {
    ...actual,
    exportComparisonToPowerPoint: vi.fn(async (data: any) => {
      pptComparisonCalls.push({ data });
      return Buffer.from("PPTX-STUB");
    }),
  };
});

vi.mock("../services/universalExportService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/universalExportService")>();
  return {
    ...actual,
    renderReport: vi.fn(async (params: any) => {
      renderCalls.push({ type: params.type, subtitle: params.subtitle, data: params.data });
      return {
        buffer: Buffer.from(`REPORT-STUB-${renderCalls.length}`),
        mimeType: "application/pdf",
        fileName: "stub.pdf",
        truncated: false,
        totalRows: params.data.length,
      };
    }),
  };
});

vi.mock("../services/reportArtifactService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/reportArtifactService")>();
  let seq = 0;
  return {
    ...actual,
    persistArtifact: vi.fn(async (input: any) => ({
      id: ++seq,
      downloadUrl: `/api/reports/artifacts/${seq}/download`,
      fileSize: input.buffer.length,
      expiresAt: new Date(Date.now() + 86_400_000),
      deduped: false,
      params: input.params,
    })),
  };
});

// Không gửi email thật khi đo báo cáo hẹn giờ.
vi.mock("../_core/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_core/email")>();
  return { ...actual, sendEmail: vi.fn(async () => undefined) };
});

import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import * as db from "../db";
import { getDb } from "../db/connection";
import { clearAssignmentCache } from "../_core/accessControl";
import { SCOPED_EXPORT_NOTE } from "../_core/reportExportScope";
import { scheduledReportService } from "../services/scheduledReportService";
import { users, oeeMetrics, type InsertUser, type User } from "../../drizzle/schema";

const ts = Date.now();
const FAC_A = `RSS_FAC_A_${ts}`;
const FAC_B = `RSS_FAC_B_${ts}`;
const CORP_A = `RSS_CORP_A_${ts}`;
const CORP_B = `RSS_CORP_B_${ts}`;

/**
 * ★★ KHE THỜI GIAN RIÊNG (xem `reportExportScope.test.ts`, mục "SAI LẦN 2"): mốc rơi vào một khe
 * cách nhau MỘT GIỜ (`ts % 200_000` giờ kể từ 2001-09-09) ⇒ hai lượt chạy bất kỳ cách nhau ≥1 ms
 * có khe khác nhau, cửa sổ ±60 s không thể chạm nhau.
 *
 * ★ Lớp thứ hai, độc lập: mọi khẳng định của bộ báo cáo đi qua bộ lọc `machineId` của MÁY DUY
 * NHẤT của lượt chạy ⇒ kể cả khi một file test khác ghi vào đúng khe này, phép đo vẫn nói đúng
 * về 5 hàng mà file này tạo ra. Chỗ nào KHÔNG lọc được theo máy (báo cáo theo ca) thì đo theo
 * ĐỘ LỆCH so với baseline chụp ngay trước khi chèn.
 */
const INSPECTED_AT = new Date(1_000_000_000_000 + (ts % 200_000) * 3_600_000);
const WINDOW_START = new Date(INSPECTED_AT.getTime() - 60_000);
const WINDOW_END = new Date(INSPECTED_AT.getTime() + 60_000);
const ISO = (d: Date) => d.toISOString();

let machineId: number;
/** Máy CHỈ chạy cho nhà máy B — hộ chiếu duy nhất để đo phạm vi của bảng `oee_metrics`. */
let machineBId: number;
let productModelId: number;
let pointDefId: number;
let adminUser: User;
let userA: User;
let userNone: User;
let userDisabled: User;

/** Tổng theo ca đã có sẵn trong cửa sổ TRƯỚC KHI file này chèn gì (đo theo độ lệch). */
let baseShiftTotal = 0;

async function mkUser(role: NonNullable<InsertUser["role"]>, tag: string): Promise<User> {
  const conn = await getDb();
  const [u] = await conn!
    .insert(users)
    .values({
      openId: `rss_${tag}_${ts}`,
      username: `rss_${tag}_${ts}`,
      name: `report scope ${tag}`,
      role,
      loginMethod: "local",
    })
    .returning();
  return u as User;
}

function callerFor(user: User) {
  const ctx: TrpcContext = {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

async function mkInspection(
  corporateCode: string,
  factoryCode: string,
  overallResult: "OK" | "NG",
  tag: string,
  onMachineId: number = machineId,
) {
  const inspectionId = await db.createProductInspection({
    machineId: onMachineId,
    productModelId,
    serialNumber: `SN_RSS_${tag}_${ts}`,
    overallResult,
    originalResult: overallResult,
    inspectionTime: INSPECTED_AT,
    corporateCode,
    factoryCode,
  });
  await db.createMeasurementResult({
    inspectionId,
    pointDefId,
    result: overallResult,
    measuredValue: "1",
  });
  return inspectionId;
}

beforeAll(async () => {
  const factoryId = await db.createFactory({ code: `RSSF_${ts}`, name: "Report scope fac" });
  const workshopId = await db.createWorkshop({ factoryId, code: `RSSW_${ts}`, name: "ws" });
  const lineId = await db.createProductionLine({ workshopId, code: `RSSL_${ts}`, name: "line" });
  const stationId = await db.createStation({ lineId, code: `RSSS_${ts}`, name: "st", orderIndex: 1 });
  machineId = await db.createMachine({
    stationId,
    code: `RSSM_${ts}`,
    name: "Report scope machine",
    machineType: "AOI",
    apiKey: `rss_${ts}`,
  });
  machineBId = await db.createMachine({
    stationId,
    code: `RSSMB_${ts}`,
    name: "Report scope machine B-only",
    machineType: "AOI",
    apiKey: `rssb_${ts}`,
  });
  productModelId = await db.createProductModel({
    code: `RSSP_${ts}`,
    name: "Report scope product",
  });
  pointDefId = await db.createMeasurementPointDef({
    productModelId,
    machineId,
    code: `RSSMP_${ts}`,
    name: `Điểm đo phạm vi báo cáo ${ts}`,
    measurementType: "DIMENSION",
    positionX: 100,
    positionY: 100,
  });

  const baseShift = await db.getShiftReport({ startDate: WINDOW_START, endDate: WINDOW_END });
  baseShiftTotal = baseShift.reduce((n, r) => n + Number(r.total || 0), 0);

  // Nhà máy A: 2 bản ghi (1 OK, 1 NG). Nhà máy B: 3 bản ghi (2 OK, 1 NG) — TRÊN CÙNG một máy,
  // nên mọi báo cáo lọc theo `machineId` đo được đúng 5 hàng của lượt chạy này.
  await mkInspection(CORP_A, FAC_A, "OK", "a1");
  await mkInspection(CORP_A, FAC_A, "NG", "a2");
  await mkInspection(CORP_B, FAC_B, "OK", "b1");
  await mkInspection(CORP_B, FAC_B, "OK", "b2");
  await mkInspection(CORP_B, FAC_B, "NG", "b3");
  // Máy thứ hai chỉ chạy cho nhà máy B — hộ chiếu để đo phạm vi của `oee_metrics` (bảng không
  // có cột tenant, nên nó được thu hẹp gián tiếp qua "máy nào có bản ghi kiểm trong phạm vi").
  await mkInspection(CORP_B, FAC_B, "OK", "b4", machineBId);

  const conn = await getDb();
  const oeeBase = {
    timestamp: INSPECTED_AT,
    availability: 9000,
    performance: 9000,
    quality: 9900,
    oee: 8000,
    plannedTime: 480,
    runTime: 440,
    idealCycleTime: 10,
    totalCount: 100,
    goodCount: 99,
    rejectCount: 1,
  };
  await conn!.insert(oeeMetrics).values([
    { ...oeeBase, machineId, machineCode: `RSSM_${ts}` },
    { ...oeeBase, machineId: machineBId, machineCode: `RSSMB_${ts}` },
  ]);

  adminUser = await mkUser("admin", "admin");
  userA = await mkUser("engineer", "faca");
  userNone = await mkUser("engineer", "none");
  userDisabled = await mkUser("engineer", "off");
  await db.createFactoryAssignment({ userId: userA.id, factoryCode: FAC_A, assignedBy: adminUser.id });
  await db.createFactoryAssignment({ userId: userDisabled.id, factoryCode: FAC_A, assignedBy: adminUser.id });
  await db.updateUser(userDisabled.id, { isActive: false });
  clearAssignmentCache();
});

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ ĐƯỜNG ① so sánh kỳ (SQL THÔ) — `powerpoint.exportComparison`", () => {
  const range = {
    periodType: "custom" as const,
    currentStart: WINDOW_START,
    currentEnd: WINDOW_END,
    previousStart: new Date(WINDOW_START.getTime() - 600_000),
    previousEnd: new Date(WINDOW_START.getTime() - 300_000),
  };

  async function exportComparison(user: User) {
    pptComparisonCalls.length = 0;
    await callerFor(user).powerpoint.exportComparison({ ...range, config: {} });
    return pptComparisonCalls.at(-1)!.data;
  }

  it("CHIỀU DƯƠNG: admin vẫn so sánh được TOÀN BỘ (A + B)", async () => {
    const data = await exportComparison(adminUser);
    // Đột biến "chặn nhầm admin" ⇒ ĐỎ.
    expect(data.currentPeriod.summary.totalInspections).toBeGreaterThanOrEqual(5);
    expect(machineTotalOf(data)).toBe(5);
  });

  it("★ CHIỀU ÂM + DƯƠNG: người gán A lấy ĐÚNG 2 của A, KHÔNG lẫn 3 của B", async () => {
    const data = await exportComparison(userA);
    // Đột biến "gỡ danh tính khỏi generateComparison" ⇒ 5, ĐỎ.
    expect(machineTotalOf(data)).toBe(2);
    expect(data.currentPeriod.summary.totalInspections).toBe(2);
    expect(data.currentPeriod.summary.okCount).toBe(1);
    expect(data.currentPeriod.summary.ngCount).toBe(1);
  });

  it("★ `dailyBreakdown` (truy vấn SQL THÔ THỨ HAI) cũng phải bị thu hẹp", async () => {
    const sumOf = (d: any) =>
      (d.dailyBreakdown ?? []).reduce((n: number, r: any) => n + Number(r.current.totalInspections || 0), 0);
    expect(sumOf(await exportComparison(userA))).toBe(2);
  });

  it("★ `topImprovedPoints` (truy vấn SQL THÔ THỨ TƯ, đi qua measurement_results) cũng phải bị thu hẹp", async () => {
    const ngOf = (d: any) =>
      (d.topImprovedPoints ?? [])
        .filter((p: any) => p.pointName === `Điểm đo phạm vi báo cáo ${ts}`)
        .reduce((n: number, p: any) => n + Number(p.currentNG || 0), 0);
    expect(ngOf(await exportComparison(adminUser))).toBe(2);
    expect(ngOf(await exportComparison(userA))).toBe(1);
  });

  it("★★★ CHIỀU ÂM: người 0 gán bị TỪ CHỐI, không sinh slide nào, câu nói ĐÚNG lý do", async () => {
    pptComparisonCalls.length = 0;
    const err: unknown = await callerFor(userNone)
      .powerpoint.exportComparison({ ...range, config: {} })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/chưa được gán nhà máy/i);
    // Đột biến "câu rỗng nói 'không có dữ liệu'" ⇒ ĐỎ.
    expect((err as Error).message).not.toMatch(/không có dữ liệu|chưa có sản lượng/i);
    expect(pptComparisonCalls.length).toBe(0);
  });

  it("★★★ `dataComparison.compare` (đường JSON) — nhãn phạm vi đi ra, `filter` thì KHÔNG", async () => {
    const r: any = await callerFor(userA).dataComparison.compare({ ...range });

    expect(r.scopeApplied).toBe(true);
    expect(r.scopeEmptyReason).toBeNull();
    // ⚠⚠ Bẫy đã cắn thật hôm nay: `scope = resolved` nguyên khối ⇒ `filter` (đối tượng SQL
    // drizzle có THAM CHIẾU VÒNG) lọt vào đáp ứng ⇒ superjson chết 500 cho MỌI người dùng.
    expect(r).not.toHaveProperty("filter");
    expect(() => JSON.stringify(r)).not.toThrow();

    const none: any = await callerFor(userNone).dataComparison.compare({ ...range });
    expect(none.currentPeriod.summary.totalInspections).toBe(0);
    expect(none.scopeEmptyReason).toBe("no_factory_assignment");
    expect(none.scopeMessage).toMatch(/chưa được gán nhà máy/i);
    expect(none.scopeMessage ?? "").not.toMatch(/không có dữ liệu|chưa có sản lượng/i);
  });
});

function machineTotalOf(d: any): number {
  return (d.machineComparison ?? [])
    .filter((m: any) => m.machineCode === `RSSM_${ts}`)
    .reduce((n: number, m: any) => n + Number(m.current.totalInspections || 0), 0);
}

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ ĐƯỜNG ② artefact báo cáo — `reportArtifact.generate`", () => {
  async function generate(user: User, reportType: string) {
    renderCalls.length = 0;
    const res: any = await callerFor(user).reportArtifact.generate({
      reportType,
      format: "pdf",
      dateFrom: ISO(WINDOW_START),
      dateTo: ISO(WINDOW_END),
      filters: { machineId },
    });
    return { rendered: renderCalls.at(-1)!, res };
  }

  const total = (rows: any[]) => rows.reduce((n, r) => n + Number(r.total ?? 0), 0);

  it("CHIỀU DƯƠNG: admin xuất `daily` với TOÀN BỘ 5 bản ghi", async () => {
    const { rendered } = await generate(adminUser, "daily");
    expect(total(rendered.data)).toBe(5);
  });

  it("★ CHIỀU ÂM + DƯƠNG: người gán A xuất `daily` ra ĐÚNG 2, không lẫn 3 của B", async () => {
    const { rendered } = await generate(userA, "daily");
    // Đột biến "gỡ actor khỏi externalReportService" ⇒ 5, ĐỎ.
    expect(total(rendered.data)).toBe(2);
    expect(rendered.data.reduce((n: number, r: any) => n + Number(r.ng ?? 0), 0)).toBe(1);
  });

  it("★ `weekly` (getYieldTrendByWeek) cũng phải bị thu hẹp", async () => {
    expect(total((await generate(adminUser, "weekly")).rendered.data)).toBe(5);
    expect(total((await generate(userA, "weekly")).rendered.data)).toBe(2);
  });

  it("★ `product` (getYieldByProduct) cũng phải bị thu hẹp", async () => {
    expect(total((await generate(adminUser, "product")).rendered.data)).toBe(5);
    expect(total((await generate(userA, "product")).rendered.data)).toBe(2);
  });

  it("★ `defect` (getDefectParetoByCategory — đi qua measurement_results) cũng phải bị thu hẹp", async () => {
    const count = (rows: any[]) => rows.reduce((n, r) => n + Number(r.count ?? 0), 0);
    expect(count((await generate(adminUser, "defect")).rendered.data)).toBe(2);
    expect(count((await generate(userA, "defect")).rendered.data)).toBe(1);
  });

  it("★ `station` (getWorkstationHeatmap — ĐƯỜNG ĐI KHÁC) cũng phải bị thu hẹp", async () => {
    const ng = (rows: any[]) => rows.reduce((n, r) => n + Number(r.ng ?? 0), 0);
    expect(ng((await generate(adminUser, "station")).rendered.data)).toBe(2);
    expect(ng((await generate(userA, "station")).rendered.data)).toBe(1);
  });

  it("★ `shift` (getShiftReport) cũng phải bị thu hẹp", async () => {
    // Không lọc được theo máy ⇒ đo theo ĐỘ LỆCH so với baseline (admin) và tuyệt đối (userA,
    // vì FAC_A là duy nhất của lượt chạy nên baseline của nó bằng 0 theo cấu tạo).
    // 6 = 5 hàng trên máy chính + 1 hàng của máy chỉ-thuộc-B.
    expect(total((await generate(adminUser, "shift")).rendered.data)).toBe(baseShiftTotal + 6);
    expect(total((await generate(userA, "shift")).rendered.data)).toBe(2);
  });

  it("★★ `oee` — bảng `oee_metrics` KHÔNG có cột tenant, vẫn phải bị thu hẹp", async () => {
    // Đường đi hoàn toàn khác ba bộ tổng hợp trên: một truy vấn phụ dùng LẠI đúng mệnh đề của
    // `getAccessFilterConditions` trên `product_inspections` để lọc `machineId`.
    // ⚠ Không truyền `filters.machineId` ở đây — chính cái phải đo là máy nào LỌT vào.
    const codesOf = async (user: User) => {
      renderCalls.length = 0;
      await callerFor(user).reportArtifact.generate({
        reportType: "oee",
        format: "pdf",
        dateFrom: ISO(WINDOW_START),
        dateTo: ISO(WINDOW_END),
      });
      return renderCalls
        .at(-1)!
        .data.map((r: any) => r.machineCode)
        .filter((c: string) => c.startsWith("RSSM"));
    };

    expect((await codesOf(adminUser)).sort()).toEqual([`RSSMB_${ts}`, `RSSM_${ts}`].sort());
    // Máy chỉ-thuộc-B phải BIẾN MẤT khỏi báo cáo của người gán A; máy chính vẫn còn (nó CÓ
    // chạy trong nhà máy A) — đây đồng thời là ô chống "vá quá tay thành chặn tất cả".
    expect(await codesOf(userA)).toEqual([`RSSM_${ts}`]);
  });

  it("★ tài liệu của người BỊ THU HẸP phải TỰ KHAI phạm vi (22.995 trông y hệt 22.996)", async () => {
    const scoped = await generate(userA, "daily");
    expect(scoped.rendered.subtitle).toContain(SCOPED_EXPORT_NOTE);

    const admin = await generate(adminUser, "daily");
    // Đột biến "dán nhãn cho cả admin" ⇒ ĐỎ: báo cáo của admin ĐÚNG là toàn hệ thống.
    expect(admin.rendered.subtitle).not.toContain(SCOPED_EXPORT_NOTE);
  });

  it("★★★ CHIỀU ÂM: người 0 gán bị TỪ CHỐI, không dựng tài liệu nào", async () => {
    renderCalls.length = 0;
    const err: unknown = await callerFor(userNone)
      .reportArtifact.generate({
        reportType: "daily",
        format: "pdf",
        dateFrom: ISO(WINDOW_START),
        dateTo: ISO(WINDOW_END),
      })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/chưa được gán nhà máy/i);
    expect((err as Error).message).not.toMatch(/không có dữ liệu|chưa có sản lượng/i);
    expect(renderCalls.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
/**
 * Lớp vỏ tRPC MỎNG phủ thẳng lên `db/reportAggregators.ts`. Nó KHÔNG đi qua
 * `externalReportService`, nên mọi ca ở ĐƯỜNG ② đều xanh dù ba thủ tục này rò — cần ca riêng.
 */
describe("★★ ĐƯỜNG ②b bộ tổng hợp trần — `reportAggregators.*`", () => {
  // ⚠ HÀM, không phải hằng: thân `describe` chạy lúc THU THẬP ca — trước `beforeAll` — nên một
  // `const win = { …, machineId }` sẽ chụp `undefined`, bộ lọc theo máy im lặng biến mất và
  // khẳng định của admin đọc 6 thay vì 5. Đã cắn thật ở lượt đo đầu của khối này.
  const win = () => ({ startDate: ISO(WINDOW_START), endDate: ISO(WINDOW_END), machineId });

  it("★ CHIỀU ÂM + DƯƠNG: `yieldByProduct` — admin 5, người gán A 2", async () => {
    const sum = (rows: any[]) => rows.reduce((n, r) => n + Number(r.total ?? 0), 0);
    expect(sum(await callerFor(adminUser).reportAggregators.yieldByProduct(win()))).toBe(5);
    expect(sum(await callerFor(userA).reportAggregators.yieldByProduct(win()))).toBe(2);
    expect(sum(await callerFor(userNone).reportAggregators.yieldByProduct(win()))).toBe(0);
  });

  it("★ `yieldTrendByWeek` + `defectParetoByCategory` cũng phải bị thu hẹp", async () => {
    const sum = (rows: any[]) => rows.reduce((n, r) => n + Number(r.total ?? 0), 0);
    expect(sum(await callerFor(adminUser).reportAggregators.yieldTrendByWeek(win()))).toBe(5);
    expect(sum(await callerFor(userA).reportAggregators.yieldTrendByWeek(win()))).toBe(2);

    const admin = await callerFor(adminUser).reportAggregators.defectParetoByCategory(win());
    const scoped = await callerFor(userA).reportAggregators.defectParetoByCategory(win());
    expect(admin.totalDefects).toBe(2);
    expect(scoped.totalDefects).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
/**
 * Báo cáo hẹn giờ chạy KHÔNG có phiên người dùng ⇒ phạm vi lấy từ NGƯỜI TẠO LỊCH, phân giải
 * LẠI Ở MỖI LƯỢT CHẠY (không đóng băng lúc tạo lịch). Người tạo mất quyền ⇒ lượt sau tự co lại;
 * mất HẾT quyền / bị tắt tài khoản / không xác định được ⇒ FAIL-CLOSED, từ chối gửi.
 */
describe("★★★ ĐƯỜNG ③ báo cáo hẹn giờ — `scheduledReportService.generateReportContent`", () => {
  const reportFor = (createdBy: number) => ({
    id: 1,
    name: `RSS ${ts}`,
    type: "statistics" as const,
    frequency: "daily" as const,
    recipients: [] as string[],
    isEnabled: true,
    createdBy,
    createdAt: new Date(),
    window: { start: WINDOW_START, end: WINDOW_END },
  });

  it("CHIỀU DƯƠNG: lịch do ADMIN tạo vẫn tổng hợp TOÀN BỘ (A + B)", async () => {
    const content = await scheduledReportService.generateReportContent(reportFor(adminUser.id));
    const a = content.factoryStats.find((f) => f.factoryCode === FAC_A);
    const b = content.factoryStats.find((f) => f.factoryCode === FAC_B);
    expect(a?.totalInspections).toBe(2);
    expect(b?.totalInspections).toBe(4); // b1..b4
    expect(content.scopeApplied).toBe(false);
  });

  it("★ CHIỀU ÂM + DƯƠNG: lịch do người gán A tạo chỉ thấy A", async () => {
    const content = await scheduledReportService.generateReportContent(reportFor(userA.id));
    // Đột biến "gỡ danh tính người tạo lịch" ⇒ thấy cả FAC_B, ĐỎ.
    expect(content.factoryStats.find((f) => f.factoryCode === FAC_B)).toBeUndefined();
    expect(content.factoryStats.find((f) => f.factoryCode === FAC_A)?.totalInspections).toBe(2);
    expect(content.summary.totalInspections).toBe(2);
    expect(content.summary.ngCount).toBe(1);
    expect(content.scopeApplied).toBe(true);
    // Email/tài liệu tự khai phạm vi.
    expect(content.scopeNote).toBe(SCOPED_EXPORT_NOTE);
  });

  it("★★★ FAIL-CLOSED: người tạo lịch 0 gán ⇒ TỪ CHỐI, câu nói đúng lý do", async () => {
    const err: unknown = await scheduledReportService
      .generateReportContent(reportFor(userNone.id))
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/chưa được gán nhà máy/i);
    expect((err as Error).message).not.toMatch(/không có dữ liệu|chưa có sản lượng/i);
  });

  it("★★★ FAIL-CLOSED: người tạo lịch BỊ TẮT tài khoản ⇒ TỪ CHỐI (dù vẫn còn gán nhà máy)", async () => {
    await expect(
      scheduledReportService.generateReportContent(reportFor(userDisabled.id)),
    ).rejects.toThrow(/người tạo lịch/i);
  });

  /**
   * ⚠ HAI ca dưới đây canh HAI CỔNG KHÁC NHAU, và chúng phải khẳng định ĐÚNG CÂU của cổng mình
   * — không phải một mẫu chung chung.
   *
   * Lượt đo đột biến ĐẦU TIÊN của bản vá này để LỌT một đột biến vì đúng lý do đó: cả hai ca
   * ban đầu chỉ khớp `/người tạo lịch/i`, mà CẢ BỐN câu từ chối đều chứa cụm ấy. Gỡ cổng thứ
   * nhất ⇒ `createdBy=0` rơi xuống cổng thứ hai ⇒ vẫn ném ra một câu khớp mẫu ⇒ lưới vẫn xanh
   * trong khi một cổng đã biến mất. Khẳng định theo ĐÚNG CÂU của từng cổng là thứ đóng nó lại.
   */
  it("★★★ FAIL-CLOSED ①: không xác định được người tạo (createdBy = 0) ⇒ TỪ CHỐI, KHÔNG chạy toàn cục", async () => {
    // Đây chính là giá trị mà `reportScheduler`/`previewReport` cũ ghi cứng. Nếu bản vá để lọt
    // nó thành "không lọc gì cả" thì mọi báo cáo hẹn giờ lại toàn cục như trước.
    await expect(scheduledReportService.generateReportContent(reportFor(0))).rejects.toThrow(
      /không xác định được người tạo lịch/i,
    );
  });

  it("★★★ FAIL-CLOSED ②: người tạo lịch KHÔNG CÒN TỒN TẠI ⇒ TỪ CHỐI", async () => {
    // Lịch sống lâu hơn tài khoản. Một hàng lịch trỏ tới một id đã bị xoá KHÔNG được rơi về
    // "không lọc gì cả" — đó là đường rò tồn tại đúng bằng tuổi thọ của hàng lịch.
    await expect(
      scheduledReportService.generateReportContent(reportFor(999_999_999)),
    ).rejects.toThrow(/không còn tồn tại/i);
  });

  it("★ `previewReport` của ADMIN vẫn chạy (chống vá quá tay thành chặn tất cả)", async () => {
    const { content } = await scheduledReportService.previewReport({
      frequency: "daily",
      actor: { id: adminUser.id, role: adminUser.role },
      window: { start: WINDOW_START, end: WINDOW_END },
    });
    expect(content.factoryStats.find((f) => f.factoryCode === FAC_B)?.totalInspections).toBe(4);
  });
});
