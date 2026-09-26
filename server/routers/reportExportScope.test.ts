/**
 * ★★★ 2026-08-17 — ĐƯỜNG XUẤT BÁO CÁO (PDF · PowerPoint · report-builder) PHÁT SỐ TOÀN CỤC.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * LỖ ĐÃ ĐO (trước bản vá này)
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * `server/db/statistics.ts` chỉ lọc theo phạm vi khi nơi gọi TRUYỀN danh tính xuống:
 *     if (filters?.userId && filters?.userRole !== 'admin') { …áp bộ lọc… }
 * Mười một điểm gọi trên ba router xuất báo cáo không truyền `userId` ⇒ khối ấy KHÔNG BAO GIỜ
 * chạy ⇒ **mọi tài khoản đã đăng nhập tải về được số liệu TOÀN CỤC**, kể cả tài khoản 0 gán
 * nhà máy. Hai trong ba router thậm chí không hề nhận `ctx` vào tay
 * (`.mutation(async ({ input }) => …`); router thứ ba nhận `ctx` rồi chỉ dùng cho `author`.
 *
 * ⚠ **LỚP LỖI KHÁC** với lỗ `or()` rỗng vá cùng ngày: ở đó HÀM sai, ở đây hàm ĐÚNG mà NƠI GỌI
 * bỏ rơi danh tính. `accessControlScope.test.ts` gọi thẳng `getDashboardStats({userId,…})` —
 * tức nó trao tận tay đúng cái mà router quên trao, nên nó XANH suốt trong khi lỗ mở toang.
 * Lưới này vì thế đi qua **createCaller của tRPC**, không gọi tầng db, để đo đúng khoảng trống ấy.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * LƯỚI NÀY ĐO GÌ — HAI CHIỀU, BỐN BỀ MẶT
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * CHIỀU ÂM : người gán nhà máy A không lấy được số của B; người 0 gán không nhận file toàn cục.
 * CHIỀU DƯƠNG: admin vẫn xuất được TOÀN BỘ; người gán A vẫn lấy ĐỦ số của A (chống "vá quá tay
 * thành chặn tất cả" — lưới xanh mà tính năng chết).
 *
 * ⚠ SEAM: hai bộ dựng tài liệu (`generateQualityReportPDF`, `exportQualityReportToPowerPoint`)
 * bị thay bằng bản ghi-lại. Chúng là HÀM THUẦN của `data`; thứ cần chứng minh là **dữ liệu nào
 * đi vào tài liệu**, không phải byte PDF ra sao. Nghiệm thu HTTP thật (engineer1, cổng :3000)
 * chạy bộ dựng THẬT và được ghi ở báo cáo — lưới này không thay thế nó.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

// ── Seam ghi-lại: bắt ĐÚNG đối tượng dữ liệu đi vào bộ dựng tài liệu ─────────────────────
const pdfCalls: Array<{ data: any; config: any }> = [];
const pptCalls: Array<{ data: any; config: any }> = [];

vi.mock("../services/pdfTemplateService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/pdfTemplateService")>();
  return {
    ...actual,
    generateQualityReportPDF: vi.fn(async (data: any, config: any) => {
      pdfCalls.push({ data, config });
      return Buffer.from("PDF-STUB");
    }),
  };
});

vi.mock("../services/powerpointService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/powerpointService")>();
  return {
    ...actual,
    exportQualityReportToPowerPoint: vi.fn(async (data: any, config: any) => {
      pptCalls.push({ data, config });
      return Buffer.from("PPTX-STUB");
    }),
  };
});

import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import * as db from "../db";
import { getDb } from "../db/connection";
import { clearAssignmentCache } from "../_core/accessControl";
import { SCOPED_EXPORT_NOTE } from "../_core/reportExportScope";
import { users, type InsertUser, type User } from "../../drizzle/schema";

const ts = Date.now();
const FAC_A = `RES_FAC_A_${ts}`;
const FAC_B = `RES_FAC_B_${ts}`;
const CORP_A = `RES_CORP_A_${ts}`;
const CORP_B = `RES_CORP_B_${ts}`;

/**
 * ★★ CỬA SỔ RIÊNG CỦA LƯỢT CHẠY — hai lần đã đo SAI ở đây, ghi lại cả hai.
 *
 * SAI LẦN 1: cửa sổ CỐ ĐỊNH ("2018-03-05"). CSDL test không được dọn giữa các lượt, nên khẳng
 * định của **admin** (không lọc ⇒ đếm TOÀN CỤC) cộng dồn dữ liệu mọi lượt trước: lượt hai đọc
 * 10 thay vì 5.
 *
 * SAI LẦN 2 (tinh vi hơn, chỉ lộ ra khi CHẠY ĐỘT BIẾN LIÊN TIẾP): neo mốc vào `ts` nhưng cửa sổ
 * rộng ±60 s, trong khi hai lượt chạy cách nhau ~30 s ⇒ mốc của chúng cách nhau 30 s và **cửa sổ
 * của lượt sau nuốt trọn dữ liệu lượt trước**. Bảng đột biến đọc "15" và tôi suýt ghi nhận nó
 * thành *"đột biến bị bắt"* — một ô ĐỎ hoàn toàn thật về hình thức nhưng KHÔNG do đột biến gây
 * ra. Đúng lớp lỗi "thiết bị đo nói dối": ĐỎ giả cũng vô dụng y như XANH giả.
 *
 * Bản vá dùng HAI lớp độc lập, vì mỗi lớp một mình đều có lỗ:
 *  ① mốc rơi vào một KHE CÁCH NHAU MỘT GIỜ (`ts % 200_000` giờ kể từ 2001-09-09) ⇒ hai lượt bất
 *    kỳ cách nhau ≥1 ms có khe khác nhau, cửa sổ ±60 s không thể chạm nhau;
 *  ② mọi khẳng định TUYỆT ĐỐI đo theo ĐỘ LỆCH so với `baseline` chụp NGAY TRƯỚC khi chèn
 *    (xem `beforeAll`) ⇒ dù một file test khác có tình cờ ghi vào đúng khe này, phép đo vẫn
 *    nói đúng về 5 hàng mà file này tạo ra.
 */
const INSPECTED_AT = new Date(1_000_000_000_000 + (ts % 200_000) * 3_600_000);
const WINDOW_START = new Date(INSPECTED_AT.getTime() - 60_000);
const WINDOW_END = new Date(INSPECTED_AT.getTime() + 60_000);

/** Điểm đo mang tên DUY NHẤT của lượt chạy ⇒ lọc được đúng hàng của mình khỏi bảng Top NG. */
const POINT_NAME = `Điểm đo phạm vi ${ts}`;

/** Số đã có sẵn trong cửa sổ TRƯỚC KHI file này chèn gì — xem lớp ② ở trên. */
let baseTotal = 0;
let baseNg = 0;

let machineId: number;
let factoryAId: number;
let adminUser: User;
let userA: User;
let userNone: User;

async function mkUser(role: NonNullable<InsertUser["role"]>, tag: string): Promise<User> {
  const conn = await getDb();
  const [u] = await conn!
    .insert(users)
    .values({
      openId: `res_${tag}_${ts}`,
      username: `res_${tag}_${ts}`,
      name: `report export ${tag}`,
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

let pointDefId: number;

/**
 * Mỗi bản ghi kiểm kèm MỘT kết quả điểm đo cùng kết luận — để bề mặt `getTopNGMeasurementPoints`
 * (đường đi HOÀN TOÀN KHÁC: nó lọc `measurement_results` qua một truy vấn phụ lấy `inspectionId`)
 * cũng có dữ liệu để đo, chứ không im lặng trả mảng rỗng cho MỌI người dùng — một mảng rỗng ở cả
 * ba vai là thước TỰ THOẢ: nó xanh y hệt nhau dù bộ lọc có chạy hay không.
 */
async function mkInspection(
  corporateCode: string,
  factoryCode: string,
  overallResult: "OK" | "NG",
  tag: string,
) {
  const inspectionId = await db.createProductInspection({
    machineId,
    serialNumber: `SN_RES_${tag}_${ts}`,
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
  factoryAId = await db.createFactory({ code: `RESF_${ts}`, name: "Report export fac" });
  const workshopId = await db.createWorkshop({ factoryId: factoryAId, code: `RESW_${ts}`, name: "ws" });
  const lineId = await db.createProductionLine({ workshopId, code: `RESL_${ts}`, name: "line" });
  const stationId = await db.createStation({ lineId, code: `RESS_${ts}`, name: "st", orderIndex: 1 });
  machineId = await db.createMachine({
    stationId,
    code: `RESM_${ts}`,
    name: "Report export machine",
    machineType: "AOI",
    apiKey: `res_${ts}`,
  });
  const productModelId = await db.createProductModel({
    code: `RESP_${ts}`,
    name: "Report export product",
  });
  pointDefId = await db.createMeasurementPointDef({
    productModelId,
    machineId,
    code: `RESMP_${ts}`,
    name: POINT_NAME,
    measurementType: "DIMENSION",
    // `positionX`/`positionY` là NOT NULL trong schema hiện tại — bỏ đi thì insert vỡ 23502.
    positionX: 100,
    positionY: 100,
  });

  // Lớp ② chống nhiễm: chụp số ĐANG CÓ trong cửa sổ trước khi chèn (không truyền danh tính ⇒
  // đúng cái mà admin sẽ đọc). Cửa sổ sạch thì đây là 0 và mọi khẳng định đọc như số tuyệt đối.
  const base = await db.getDashboardStats({ startDate: WINDOW_START, endDate: WINDOW_END });
  baseTotal = base.total;
  baseNg = base.ng;

  // Nhà máy A: 2 bản ghi (1 OK, 1 NG). Nhà máy B: 3 bản ghi (2 OK, 1 NG).
  await mkInspection(CORP_A, FAC_A, "OK", "a1");
  await mkInspection(CORP_A, FAC_A, "NG", "a2");
  await mkInspection(CORP_B, FAC_B, "OK", "b1");
  await mkInspection(CORP_B, FAC_B, "OK", "b2");
  await mkInspection(CORP_B, FAC_B, "NG", "b3");

  adminUser = await mkUser("admin", "admin");
  userA = await mkUser("engineer", "faca");
  userNone = await mkUser("engineer", "none");
  await db.createFactoryAssignment({ userId: userA.id, factoryCode: FAC_A, assignedBy: adminUser.id });
  // `userNone` cố ý KHÔNG có gán nào — đúng hình dạng supervisor1/operator1/maint1 hôm nay.
  clearAssignmentCache();
});

const range = { startDate: WINDOW_START, endDate: WINDOW_END };

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ BỀ MẶT ① PDF — `pdfReport.generateQualityPDF`", () => {
  async function exportPdf(user: User) {
    pdfCalls.length = 0;
    await callerFor(user).pdfReport.generateQualityPDF({ ...range });
    return pdfCalls.at(-1)!.data;
  }

  it("CHIỀU DƯƠNG: admin vẫn xuất được TOÀN BỘ (A + B)", async () => {
    const data = await exportPdf(adminUser);

    expect(data.summary.totalInspections).toBe(baseTotal + 5);
    expect(data.summary.ngCount).toBe(baseNg + 2); // a2 + b3
    // Đột biến "chặn nhầm admin" ⇒ ĐỎ ở đây.
    expect(data.filters?.scopeNote).toBeUndefined();
  });

  it("★ CHIỀU ÂM: người gán A KHÔNG lấy được số của B qua đường PDF", async () => {
    const data = await exportPdf(userA);

    // Đột biến "gỡ userId khỏi pdfReportRouter" ⇒ 5, ĐỎ.
    expect(data.summary.totalInspections).toBe(2);
    expect(data.summary.ngCount).toBe(1); // chỉ a2; nếu b3 lọt vào sẽ là 2
  });

  it("★ CHIỀU DƯƠNG: người gán A vẫn lấy ĐỦ số của A (không vá quá tay)", async () => {
    const data = await exportPdf(userA);

    expect(data.summary.totalInspections).toBe(2);
    expect(data.summary.okCount).toBe(1);
  });

  it("★ bảng 'Top điểm NG' (getTopNGMeasurementPoints — ĐƯỜNG ĐI KHÁC) cũng phải bị thu hẹp", async () => {
    // Bề mặt này KHÔNG dùng chung mệnh đề WHERE với getDashboardStats: nó lọc
    // `measurement_results` qua một truy vấn phụ lấy `inspectionId`. Gỡ danh tính khỏi RIÊNG
    // điểm gọi này thì mọi khẳng định `summary.*` ở trên vẫn xanh — nên nó cần ca riêng.
    // Lọc theo TÊN ĐIỂM ĐO duy nhất của lượt chạy — bảng Top NG gộp mọi điểm đo trong CSDL
    // dùng chung, nên cộng cả bảng là cộng luôn dữ liệu của file test khác.
    const ngOf = (d: any) =>
      (d.topNGPoints ?? [])
        .filter((p: any) => p.pointName === POINT_NAME)
        .reduce((n: number, p: any) => n + Number(p.ngCount || 0), 0);

    const admin = await exportPdf(adminUser);
    const scoped = await exportPdf(userA);

    expect(ngOf(admin)).toBe(2); // a2 + b3
    expect(ngOf(scoped)).toBe(1); // chỉ a2 — nếu b3 lọt vào sẽ là 2
  });

  it("★ bảng 'So sánh theo máy' (getTopBottomMachines — ĐƯỜNG ĐI THỨ BA) cũng phải bị thu hẹp", async () => {
    // Ba bộ tổng hợp, ba mệnh đề WHERE ĐỘC LẬP. Đột biến gỡ danh tính khỏi RIÊNG bộ này từng
    // LỌT LƯỚI ở vòng đo đầu (bảng đột biến M3/M7/M12) — ca này là thứ đóng nó lại.
    const machineTotal = (d: any) =>
      (d.byMachine ?? [])
        .filter((m: any) => m.machineCode === `RESM_${ts}`)
        .reduce((n: number, m: any) => n + Number(m.totalInspections || 0), 0);

    expect(machineTotal(await exportPdf(adminUser))).toBe(5);
    expect(machineTotal(await exportPdf(userA))).toBe(2);
  });

  it("★ file của người BỊ THU HẸP phải TỰ KHAI phạm vi, không giả vờ toàn hệ thống", async () => {
    const data = await exportPdf(userA);

    // 22.995 của một nhà máy trông y hệt 22.996 toàn công ty — trang giấy phải nói ra.
    expect(data.filters?.scopeNote).toBe(SCOPED_EXPORT_NOTE);
    expect(data.filters?.scopeNote).toMatch(/KHÔNG phải toàn hệ thống/i);
  });

  it("★★★ CHIỀU ÂM: người 0 gán bị TỪ CHỐI XUẤT — không nhận file toàn số 0", async () => {
    pdfCalls.length = 0;

    await expect(callerFor(userNone).pdfReport.generateQualityPDF({ ...range })).rejects.toThrow(
      /gán nhà máy/i,
    );
    // Không được sinh ra tài liệu nào cả.
    expect(pdfCalls.length).toBe(0);
  });

  it("★★★ câu từ chối nói ĐÚNG lý do, KHÔNG nói 'không có dữ liệu'", async () => {
    // Đột biến: đổi câu thành "không có dữ liệu"/"chưa có sản lượng" ⇒ ĐỎ.
    // Đó là kết luận SAI và nguy hiểm: nó đẩy người vận hành đi tìm lỗi ở dây chuyền.
    const err: unknown = await callerFor(userNone)
      .pdfReport.generateQualityPDF({ ...range })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toMatch(/chưa được gán nhà máy/i);
    expect(message).not.toMatch(/không có dữ liệu|chưa có sản lượng|không có sản lượng/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ BỀ MẶT ② PowerPoint — `powerpoint.exportQualityReport`", () => {
  async function exportPpt(user: User) {
    pptCalls.length = 0;
    await callerFor(user).powerpoint.exportQualityReport({ ...range });
    return pptCalls.at(-1)!.data;
  }

  it("CHIỀU DƯƠNG: admin vẫn xuất được TOÀN BỘ (A + B)", async () => {
    const data = await exportPpt(adminUser);

    expect(data.summary.totalInspections).toBe(baseTotal + 5);
    expect(data.summary.ngCount).toBe(baseNg + 2);
    expect(data.filters?.scopeNote).toBeUndefined();
  });

  it("★ CHIỀU ÂM + DƯƠNG: người gán A lấy ĐÚNG 2 của A, KHÔNG lẫn 3 của B", async () => {
    const data = await exportPpt(userA);

    // Đột biến "gỡ userId khỏi powerpointRouter" ⇒ 5, ĐỎ.
    expect(data.summary.totalInspections).toBe(2);
    expect(data.summary.okCount).toBe(1);
    expect(data.summary.ngCount).toBe(1);
    expect(data.filters?.scopeNote).toBe(SCOPED_EXPORT_NOTE);
  });

  it("★ bảng 'Top điểm NG' + 'So sánh theo máy' của SLIDE cũng phải bị thu hẹp", async () => {
    // PPTX có ba bộ tổng hợp y như PDF; đột biến M7 (gỡ danh tính khỏi riêng `getTopNG…` ở
    // powerpointRouter) từng LỌT LƯỚI vì mọi khẳng định trước đó chỉ đọc `summary.*`.
    const ngOf = (d: any) =>
      (d.topNGPoints ?? [])
        .filter((p: any) => p.pointName === POINT_NAME)
        .reduce((n: number, p: any) => n + Number(p.ngCount || 0), 0);
    const machineTotal = (d: any) =>
      (d.byMachine ?? [])
        .filter((m: any) => m.machineCode === `RESM_${ts}`)
        .reduce((n: number, m: any) => n + Number(m.totalInspections || 0), 0);

    const admin = await exportPpt(adminUser);
    const scoped = await exportPpt(userA);

    expect(ngOf(admin)).toBe(2);
    expect(ngOf(scoped)).toBe(1);
    expect(machineTotal(admin)).toBe(5);
    expect(machineTotal(scoped)).toBe(2);
  });

  it("★★★ CHIỀU ÂM: người 0 gán bị TỪ CHỐI XUẤT, không sinh slide nào", async () => {
    pptCalls.length = 0;

    await expect(
      callerFor(userNone).powerpoint.exportQualityReport({ ...range }),
    ).rejects.toThrow(/chưa được gán nhà máy/i);
    expect(pptCalls.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
/**
 * Report-builder KHÁC hai bề mặt trên: nó trả JSON cho widget ĐANG SỐNG trên màn hình, không
 * sinh file rời hệ thống. Nên ở đây KHÔNG từ chối (từ chối = giết cả trang dựng báo cáo của
 * người 0 gán) mà **mang theo lý do** để widget nói đúng câu thay vì vẽ một ô "0" câm.
 */
describe("★★★ BỀ MẶT ③ report-builder — `reportBuilder.getWidgetData`", () => {
  const widget = (widgetType: string, config?: Record<string, unknown>) => ({
    widgetType,
    config,
    filters: { ...range },
  });

  it("CHIỀU DƯƠNG: admin vẫn thấy toàn cục ở kpi_card", async () => {
    const r: any = await callerFor(adminUser).reportBuilder.getWidgetData(
      widget("kpi_card", { metric: "total" }),
    );

    expect(r.value).toBe(baseTotal + 5);
    expect(r.scopeApplied).toBe(false);
    expect(r.scopeEmptyReason).toBeNull();
  });

  it("★ CHIỀU ÂM + DƯƠNG: người gán A thấy ĐÚNG 2 ở kpi_card", async () => {
    const r: any = await callerFor(userA).reportBuilder.getWidgetData(
      widget("kpi_card", { metric: "total" }),
    );

    expect(r.value).toBe(2); // đột biến gỡ danh tính ⇒ 5, ĐỎ
    expect(r.scopeApplied).toBe(true);
    expect(r.scopeEmptyReason).toBeNull();
  });

  it("★★★ CHIỀU ÂM: người 0 gán thấy 0 KÈM LÝ DO, không phải 0 câm", async () => {
    const r: any = await callerFor(userNone).reportBuilder.getWidgetData(
      widget("kpi_card", { metric: "total" }),
    );

    expect(r.value).toBe(0);
    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
    expect(r.scopeMessage).toMatch(/chưa được gán nhà máy/i);
    expect(r.scopeMessage ?? "").not.toMatch(/không có dữ liệu|chưa có sản lượng/i);
  });

  it("★ widget `table` (điểm gọi getDashboardStats THỨ HAI) cũng phải bị thu hẹp", async () => {
    // Hai điểm gọi riêng trong CÙNG một switch — gỡ danh tính khỏi chỉ một cái vẫn phải ĐỎ.
    const admin: any = await callerFor(adminUser).reportBuilder.getWidgetData(widget("table"));
    const scoped: any = await callerFor(userA).reportBuilder.getWidgetData(widget("table"));

    expect(admin.data.total).toBe(baseTotal + 5);
    expect(scoped.data.total).toBe(2);
    expect(scoped.scopeApplied).toBe(true);
  });

  it("★ widget `shift_analysis` (getShiftStats) cũng phải bị thu hẹp", async () => {
    const sum = (rows: any[]) => rows.reduce((n, r) => n + Number(r.total || 0), 0);

    const admin: any = await callerFor(adminUser).reportBuilder.getWidgetData(widget("shift_analysis"));
    const scoped: any = await callerFor(userA).reportBuilder.getWidgetData(widget("shift_analysis"));
    const none: any = await callerFor(userNone).reportBuilder.getWidgetData(widget("shift_analysis"));

    expect(sum(admin.data)).toBe(baseTotal + 5);
    expect(sum(scoped.data)).toBe(2);
    expect(sum(none.data)).toBe(0);
    expect(none.scopeEmptyReason).toBe("no_factory_assignment");
  });

  it("★ widget `ng_analysis` (getTopNGMeasurementPoints) cũng phải bị thu hẹp", async () => {
    // Đột biến M12 từng LỌT LƯỚI: không ca nào chạm tới nhánh `ng_analysis`/`bar_chart`.
    const ngOf = (r: any) =>
      (r.data ?? [])
        .filter((p: any) => (p.pointName ?? p.name) === POINT_NAME)
        .reduce((n: number, p: any) => n + Number(p.ngCount || 0), 0);

    const admin: any = await callerFor(adminUser).reportBuilder.getWidgetData(widget("ng_analysis"));
    const scoped: any = await callerFor(userA).reportBuilder.getWidgetData(widget("ng_analysis"));
    const none: any = await callerFor(userNone).reportBuilder.getWidgetData(widget("ng_analysis"));

    expect(ngOf(admin)).toBe(2);
    expect(ngOf(scoped)).toBe(1);
    expect(ngOf(none)).toBe(0);
    expect(none.scopeEmptyReason).toBe("no_factory_assignment");
  });

  it("★ widget `machine_comparison` (getTopBottomMachines) cũng phải bị thu hẹp", async () => {
    // Hàng của `getTopBottomMachines` có hình dạng `{ id, name, code, total, ok, ng, … }`.
    const totalOf = (r: any) =>
      [...(r.data?.top ?? []), ...(r.data?.bottom ?? [])]
        .filter((m: any) => m.id === machineId)
        .reduce((n: number, m: any) => Math.max(n, Number(m.total ?? 0)), 0);

    const admin: any = await callerFor(adminUser).reportBuilder.getWidgetData(widget("machine_comparison"));
    const scoped: any = await callerFor(userA).reportBuilder.getWidgetData(widget("machine_comparison"));

    // `as any` ở điểm gọi cũ đã che mất chính lỗi này với tsc — nên phải đo bằng chạy thật.
    // Máy là DUY NHẤT của lượt chạy ⇒ ô này miễn nhiễm với nhiễm chéo, giữ số tuyệt đối.
    expect(totalOf(admin)).toBe(5);
    expect(totalOf(scoped)).toBe(2);
  });
});
