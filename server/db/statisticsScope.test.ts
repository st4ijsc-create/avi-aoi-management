/**
 * ★★★ 2026-08-17 (đợt hai) — LƯỚI VỊ TỪ cho TOÀN BỘ `server/db/statistics.ts`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * LỖ ĐÃ ĐO (trước bản vá này) — bằng HTTP THẬT, không phải suy luận
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * Đợt trước chỉ vá BẢY hàm. Đo lại trên `aoi_management` ngày 2026-08-17 (đăng nhập thật,
 * cookie thật), `supervisor1` — **0 gán nhà máy** — vẫn đọc được TOÀN BỘ 22.996 bản ghi kiểm
 * qua các bề mặt còn lại:
 *
 *   dashboard.getMachineStats            1.533  (đáng lẽ 0)
 *   dashboard.getDailyStats             22.996  (đáng lẽ 0)
 *   dashboard.getHourlyStats            22.996  (đáng lẽ 0)
 *   workstation.ngTrendDirect           22.996  (đáng lẽ 0)
 *   workstation.ngSummaryByMachine      22.996  (đáng lẽ 0)
 *   workstation.ngTrend                 27.599 kết quả đo  (đáng lẽ 0)
 *   workstation.topNGMeasurementPoints     531 NG          (đáng lẽ 0)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * LƯỚI NÀY PHÁT BIỂU GÌ
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * **∀ hàm XUẤT RA trong `statistics.ts` có đọc `product_inspections` — hoặc nó nằm trong BẢNG
 * DÒ (và khi đó một tài khoản 0 gán nhà máy gọi nó phải nhận ĐÚNG SỐ KHÔNG), hoặc nó nằm trong
 * tập MIỄN TRỪ được khai TÊN kèm LÝ DO ngay trong file này.**
 *
 * Thêm một hàm mới đọc bản ghi kiểm mà quên khai ⇒ **ĐỎ**, không cần ai nhớ.
 *
 * ⚠⚠ VÌ SAO PHẦN CƯỠNG CHẾ LÀ *CHẠY THẬT*, KHÔNG PHẢI QUÉT MÃ NGUỒN. Bài học đã trả giá tuần
 * này: *"đột biến SỐNG SÓT vì vị từ đọc TÊN ĐỊNH DANH thay vì thứ tên đó trỏ tới"*. Một lưới
 * kiểu `expect(source).toMatch(/resolveDataScope/)` sẽ XANH với cả một hàm gọi bộ phân giải rồi
 * **vứt** `filter` đi — tức đúng cái lỗi cần bắt. Ở đây phép quét mã nguồn CHỈ dùng để **LIỆT
 * KÊ** (không hàm nào lọt khỏi tầm mắt), còn phán quyết đúng/sai đến từ một lượt gọi THẬT xuống
 * CSDL: cái được canh là **số hàng đi ra**, tức chính thứ cưỡng chế.
 *
 * BA CHIỀU cho MỖI mục dò, cả ba đều cần:
 *   • ÂM tuyệt đối — người 0 gán nhà máy nhận ĐÚNG 0 (đột biến "gỡ trục phạm vi" ⇒ đỏ);
 *   • DƯƠNG — admin và người CÓ gán vẫn thấy ĐỦ phần của mình, theo SỐ CHÍNH XÁC
 *     (đột biến "chặn nhầm admin" hoặc "vá quá tay thành chặn tất cả" ⇒ đỏ);
 *   • KHÔNG VÒNG — đáp ứng serialise được bằng superjson VÀ không mang ô `filter`
 *     (đột biến `scope = resolved` nguyên khối ⇒ đỏ).
 *
 * Cửa sổ dữ liệu là một lát 2 GIÂY sinh từ `Date.now()` nên KHÔNG đụng dữ liệu của file kiểm
 * khác (vitest chạy song song theo file) và cũng không cộng dồn qua các lần chạy.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import superjson from "superjson";
import * as db from "../db";
import { getDb } from "./connection";
import { clearAssignmentCache } from "../_core/accessControl";
import { users, measurementPointDefs, type InsertUser } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

// ══════════════════════════════════════════════════════════════════════════════════════════
// PHẦN A — LIỆT KÊ: đọc chính mã nguồn `statistics.ts`
// ══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Tách `statistics.ts` thành các thân hàm XUẤT RA.
 *
 * Ranh giới là MỌI khai báo ở cột 0 (kể cả `const`/`interface`/hàm KHÔNG xuất ra), nên thân của
 * một hàm không bao giờ nuốt nhầm helper đứng sau nó — bản duyệt đầu tiên đã mắc đúng lỗi ấy và
 * gán nhầm "có trục phạm vi" cho `getMeasurementPointImagesByProduct` vì nó hút cả
 * `drillAccessCondition`. Chú thích bị bóc trước để một docblock có nhắc tên bảng không bị đếm
 * thành một lượt ĐỌC bảng.
 */
function exportedFunctionBodies(): Array<{ name: string; body: string }> {
  const src = readFileSync(resolve(process.cwd(), "server/db/statistics.ts"), "utf8");
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const declRe =
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|interface|type|class|enum)\s+([A-Za-z0-9_$]+)/gm;
  const decls: Array<{ name: string; start: number; exportedFn: boolean }> = [];
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(clean))) {
    decls.push({
      name: m[1],
      start: m.index,
      exportedFn: /^export\s+(?:async\s+)?function/.test(m[0]),
    });
  }
  const out: Array<{ name: string; body: string }> = [];
  for (let i = 0; i < decls.length; i++) {
    if (!decls[i].exportedFn) continue;
    const end = i + 1 < decls.length ? decls[i + 1].start : clean.length;
    out.push({ name: decls[i].name, body: clean.slice(decls[i].start, end) });
  }
  return out;
}

/**
 * MIỄN TRỪ — khai TÊN kèm LÝ DO. Ba hàm này có chạm `product_inspections` nhưng KHÔNG phải bề
 * mặt ĐỌC của người dùng, nên một trục phạm vi ở đó không bảo vệ gì mà chỉ làm hỏng công cụ.
 *
 * ⚠ Danh sách này KHÔNG được nới ra để làm lưới xanh. Nới nó = tự cấp giấy miễn trừ.
 */
const MIEN_TRU: Record<string, string> = {
  seedInspectionData:
    "GHI, không đọc: sinh dữ liệu demo. Chỉ gọi được qua `seedDataRouter.seedInspections` " +
    "(adminProcedure). Một bộ lọc đọc ở đây không chặn gì — hàng do chính nó tạo ra.",
  seedWorkstationAnalyticsData:
    "GHI, không đọc: sinh dữ liệu demo cho phân tích trạm. `seedDataRouter` (adminProcedure).",
  getMeasurementPointImagesByProduct:
    "CÓ LỌC (cổng bán-nối `pi.id`), chỉ MIỄN TRỪ phần NHÃN: trả về `Record<pointDefId, …>` — " +
    "một bản đồ khoá theo số, không có chỗ đặt ba ô nhãn mà không đụng không gian khoá. Nơi gọi " +
    "duy nhất là tuyến REST ngoài (`validateExternalAuth`, máy-với-máy) — không có danh tính " +
    "người dùng và cũng không có giao diện nào để hiển thị lý do.",
};

// ══════════════════════════════════════════════════════════════════════════════════════════
// PHẦN B — DỮ LIỆU DỰNG SẴN
// ══════════════════════════════════════════════════════════════════════════════════════════

const ts = Date.now();
const FAC_A = `SS_FAC_A_${ts}`;
const FAC_B = `SS_FAC_B_${ts}`;
const CORP_A = `SS_CORP_A_${ts}`;
const CORP_B = `SS_CORP_B_${ts}`;

/**
 * Một lát 2 GIÂY trong quá khứ, vị trí sinh từ `ts` ⇒ hai lần chạy (hay hai file kiểm chạy song
 * song) không bao giờ dùng chung lát. Nhờ vậy các hàm KHÔNG có trục máy/điểm đo
 * (`getShiftStats`, `getNGComparisonDirect`, `getYieldRateByCorporate`, …) vẫn đếm được CHÍNH
 * XÁC. Mọi hàng nằm cùng một ngày 2017-11-08 nên không sinh thêm chunk Timescale mỗi lần chạy.
 */
const AT = new Date(Date.UTC(2017, 10, 8) + (ts % 86_400_000));
const WINDOW_START = new Date(AT.getTime() - 1000);
const WINDOW_END = new Date(AT.getTime() + 1000);
/** Kỳ "trước" của hai hàm so sánh — cố ý RỖNG, ca kiểm chỉ neo vào kỳ "hiện tại". */
const PREV_START = new Date(AT.getTime() - 10_000);
const PREV_END = new Date(AT.getTime() - 5000);

let machineId: number;
let machineCode: string;
let factoryId: number;
let productModelId: number;
let workstationId: number;
let pointDefId: number;
let adminId: number;
let userAId: number;
let userNoneId: number;

type Who = { userId: number; userRole: string };
let ADMIN: Who;
let USER_A: Who;
let USER_NONE: Who;

async function mkUser(role: NonNullable<InsertUser["role"]>, tag: string): Promise<number> {
  const conn = await getDb();
  const [u] = await conn!
    .insert(users)
    .values({
      openId: `ss_${tag}_${ts}`,
      username: `ss_${tag}_${ts}`,
      name: `stats scope ${tag}`,
      role,
      loginMethod: "local",
    })
    .returning({ id: users.id });
  return u.id;
}

async function mkInspection(
  corporateCode: string,
  factoryCode: string,
  overallResult: "OK" | "NG",
  at: Date,
  tag: string,
  panelSerial: string,
  boardIndex: number,
) {
  return db.createProductInspection({
    machineId,
    productModelId,
    serialNumber: `SN_SS_${tag}_${ts}`,
    overallResult,
    originalResult: overallResult,
    inspectionTime: at,
    corporateCode,
    factoryCode,
    panelSerial,
    boardIndex,
  });
}

beforeAll(async () => {
  // Mã nhà máy = FAC_A để `factoryId` (resolveFactoryCode) và `factoryCode` trên bản ghi kiểm
  // trỏ về cùng một thứ.
  factoryId = await db.createFactory({ code: FAC_A, name: "Stats scope fac" });
  const workshopId = await db.createWorkshop({ factoryId, code: `SSW_${ts}`, name: "ws" });
  const lineId = await db.createProductionLine({ workshopId, code: `SSL_${ts}`, name: "line" });
  const stationId = await db.createStation({ lineId, code: `SSS_${ts}`, name: "st", orderIndex: 1 });
  machineCode = `SSM_${ts}`;
  machineId = await db.createMachine({
    stationId,
    code: machineCode,
    name: "Stats scope machine",
    machineType: "AOI",
    apiKey: `ss_${ts}`,
  });

  productModelId = await db.createProductModel({ code: `SSPM_${ts}`, name: "Stats scope product" });
  workstationId = await db.createWorkstation({
    code: `SSWS_${ts}`,
    name: "Stats scope workstation",
    processType: "TESTING",
    orderIndex: 1,
    isActive: true,
  });
  pointDefId = await db.createMeasurementPointDef({
    productModelId,
    code: `SSPT_${ts}`,
    name: "Điểm đo phạm vi",
    measurementType: "VISUAL",
    positionX: 10,
    positionY: 10,
  });
  // `createMeasurementPointDef` không nhận `workstationId` ⇒ gắn trạm ngay sau khi tạo (các bề
  // mặt "theo trạm" nối qua đúng cột này).
  const conn = await getDb();
  await conn!
    .update(measurementPointDefs)
    .set({ workstationId })
    .where(eq(measurementPointDefs.id, pointDefId));

  // ── Lát 2 giây: nhà máy A có 2 bo, nhà máy B có 3 ────────────────────────────────────
  const a1 = await mkInspection(CORP_A, FAC_A, "OK", AT, "a1", `SSP_A_${ts}`, 1);
  const a2 = await mkInspection(CORP_A, FAC_A, "NG", AT, "a2", `SSP_A_${ts}`, 2);
  await mkInspection(CORP_B, FAC_B, "OK", AT, "b1", `SSP_B_${ts}`, 1);
  await mkInspection(CORP_B, FAC_B, "OK", AT, "b2", `SSP_B_${ts}`, 2);
  const b3 = await mkInspection(CORP_B, FAC_B, "NG", AT, "b3", `SSP_B_${ts}`, 3);

  // Kết quả đo: A có 2 (1 OK + 1 NG), B có 1 (NG). Đều có ảnh ⇒ thư viện ảnh cũng đo được.
  await db.createMeasurementResult({ inspectionId: a1, pointDefId, result: "OK", imageUrl: `ss_a1_${ts}.jpg`, measuredValue: "1.0" });
  await db.createMeasurementResult({ inspectionId: a2, pointDefId, result: "NG", imageUrl: `ss_a2_${ts}.jpg`, measuredValue: "0.5" });
  await db.createMeasurementResult({ inspectionId: b3, pointDefId, result: "NG", imageUrl: `ss_b3_${ts}.jpg`, measuredValue: "0.4" });

  // ★★★ MỘT KẾT QUẢ ĐO MỒ CÔI — `inspectionId` KHÔNG nối được về bản ghi kiểm nào.
  //
  // ⚠ Đây KHÔNG phải ca giả tưởng. `product_inspections` là hypertable Timescale nên Postgres
  // không cho đặt khoá ngoại trỏ vào nó; đo trên `aoi_management` ngày 2026-08-17: **383/588**
  // kết quả NG/NTF là mồ côi. Bản vá đầu tiên neo cổng "giữ danh mục" vào `pi.id IS NULL`, tức
  // vô tình mở đúng cho hình dạng này, và `supervisor1` (0 gán nhà máy) vẫn đọc được 383 NG qua
  // `workstation.topNGMeasurementPoints` — trong khi 138 ca của file này VẪN XANH, vì dữ liệu
  // dựng sẵn không hề chứa mồ côi. Lỗ chỉ lộ ở nghiệm thu HTTP thật.
  //
  // Từ nay hình dạng ấy nằm TRONG thước: gỡ neo `mr.id` về `pi.id` ⇒ ba ca ÂH bên dưới ĐỎ.
  // Mồ côi = KHÔNG xác định được nhà máy ⇒ không thuộc phạm vi của ai, nhưng admin (không có
  // `filter`, không đi qua cổng) vẫn phải thấy — nên số của admin cộng thêm 1.
  await db.createMeasurementResult({
    inspectionId: 2_100_000_000 - (ts % 1_000_000),
    pointDefId,
    result: "NG",
    measuredValue: "0.3",
  });

  // ── HÔM NAY: A 1 bo, B 2 bo — cho các hàm chỉ nhìn "N ngày/giờ gần đây" ──────────────
  const today = new Date();
  await mkInspection(CORP_A, FAC_A, "OK", today, "ta1", `SSP_TA_${ts}`, 1);
  await mkInspection(CORP_B, FAC_B, "OK", today, "tb1", `SSP_TB_${ts}`, 1);
  await mkInspection(CORP_B, FAC_B, "NG", today, "tb2", `SSP_TB_${ts}`, 2);

  adminId = await mkUser("admin", "admin");
  userAId = await mkUser("engineer", "faca");
  userNoneId = await mkUser("engineer", "none");
  // userA có CẢ hai loại gán: bốn hàm `…ByCorporate`/`…ByFactory` dùng khuôn phạm vi RIÊNG
  // (chỉ nhìn gán TẬP ĐOÀN) nên một người chỉ có gán nhà máy sẽ nhận rỗng ở đó — đó là hành vi
  // CÓ SẴN, không thuộc đợt vá này; cấp cả hai để chiều DƯƠNG đo được ở mọi mục dò.
  await db.createFactoryAssignment({ userId: userAId, factoryCode: FAC_A, assignedBy: adminId });
  await db.createCorporateAssignment({ userId: userAId, corporateCode: CORP_A, assignedBy: adminId });
  // `userNoneId` cố ý KHÔNG có gán nào — đúng hình dạng `supervisor1` trên máy thật.
  clearAssignmentCache();

  ADMIN = { userId: adminId, userRole: "admin" };
  USER_A = { userId: userAId, userRole: "engineer" };
  USER_NONE = { userId: userNoneId, userRole: "engineer" };
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// PHẦN C — BẢNG DÒ
// ══════════════════════════════════════════════════════════════════════════════════════════

const win = { startDate: WINDOW_START, endDate: WINDOW_END };
const cmpWin = {
  currentStartDate: WINDOW_START,
  currentEndDate: WINDOW_END,
  previousStartDate: PREV_START,
  previousEndDate: PREV_END,
};
/** Đủ xa để trùm cả lát 2017 lẫn các hàng "hôm nay" của máy riêng. */
const DAYS_BACK = 4000;
const HOURS_BACK = 100_000;

const sum = (rows: readonly any[], k: string) => rows.reduce((s, r) => s + Number(r?.[k] ?? 0), 0);

/**
 * `admin`/`userA` là SỐ CHÍNH XÁC khi dữ liệu dựng sẵn cô lập được (máy riêng, điểm đo riêng,
 * sản phẩm riêng, hoặc lát 2 giây riêng). `-1` nghĩa "chỉ đo được chiều lớn hơn 0" và khi đó
 * lưới đòi thêm `admin > userA` — dùng cho hàm KHÔNG có trục nào để cô lập.
 */
interface Probe {
  fn: string;
  label?: string;
  run: (w: Who) => Promise<{ n: number; res: unknown }>;
  admin: number;
  userA: number;
}

const PROBES: Probe[] = [
  { fn: "getDashboardStats", admin: 5, userA: 2,
    run: async (w) => { const r = await db.getDashboardStats({ ...win, machineId, ...w }); return { n: r.total, res: r }; } },

  { fn: "getMachineStats", admin: 5, userA: 2,
    run: async (w) => { const r = await db.getMachineStats(machineId, WINDOW_START, WINDOW_END, w); return { n: r.total, res: r }; } },

  { fn: "getPanelYieldStats", admin: 5, userA: 2,
    run: async (w) => { const r = await db.getPanelYieldStats({ ...win, machineId, ...w }); return { n: r.boardTotal, res: r }; } },

  { fn: "getShiftStats", admin: 5, userA: 2,
    run: async (w) => { const r = await db.getShiftStats({ ...win, ...w }); return { n: sum(r, "total"), res: r }; } },

  { fn: "getShiftReport", admin: 5, userA: 2,
    run: async (w) => { const r = await db.getShiftReport({ ...win, ...w }); return { n: sum(r, "total"), res: r }; } },

  { fn: "getTopBottomMachines", admin: 5, userA: 2,
    run: async (w) => {
      const r = await db.getTopBottomMachines({ ...win, limit: 50, ...w });
      return { n: r.top.find((m) => m.id === machineId)?.total ?? 0, res: r };
    } },

  // KHÔNG cô lập được **ở ĐÂY**: mục dò này cố ý gọi với `factoryId`/`workshopId` rỗng để đo
  // riêng TRỤC PHẠM VI, và hàm không có trục máy nào khác để thu hẹp.
  // ★ ĐÍNH CHÍNH 2026-08-18: câu cũ ở đây ghi *"`factoryId`/`workshopId` là tham số CHẾT"* — đúng
  // vào lúc viết, nay KHÔNG CÒN. Hai ô ấy đã lọc thật (`AND` vào SAU vị từ phạm vi, chỉ thu hẹp,
  // không nới); trục ấy được đo bằng SỐ CHÍNH XÁC trên CSDL thật ở `statisticsDailyScope.test.ts`.
  { fn: "getDailyStats", admin: -1, userA: -1,
    run: async (w) => { const r = await db.getDailyStats(undefined, undefined, DAYS_BACK, w); return { n: sum(r, "totalProducts"), res: r }; } },

  { fn: "getHourlyStats", admin: 8, userA: 3,
    run: async (w) => { const r = await db.getHourlyStats({ machineId, hours: HOURS_BACK, ...w }); return { n: sum(r, "total"), res: r }; } },

  { fn: "searchInspections", admin: 5, userA: 2,
    run: async (w) => { const r = await db.searchInspections({ ...win, machineCode, ...w }); return { n: Number(r.total), res: r }; } },

  { fn: "getTopNGMeasurementPoints", admin: 2, userA: 1,
    run: async (w) => {
      const r = await db.getTopNGMeasurementPoints({ ...win, machineId, limit: 50, ...w });
      return { n: r.find((p) => p.pointDefId === pointDefId)?.ngCount ?? 0, res: r };
    } },

  { fn: "getDefectsByWorkstation", admin: 4, userA: 2, // admin +1 = ket qua do MO COI (khong xac dinh duoc nha may)
    run: async (w) => {
      const r = await db.getDefectsByWorkstation({ ...win, machineId, ...w });
      return { n: sum(r.filter((x) => x.measurementPointId === pointDefId), "totalCount"), res: r };
    } },

  { fn: "getTopNGMeasurementPointsByWorkstation", admin: 3, userA: 1, // admin +1 = MO COI
    run: async (w) => {
      const r = await db.getTopNGMeasurementPointsByWorkstation({ ...win, limit: 500, ...w });
      return { n: sum(r.filter((x) => x.measurementPointId === pointDefId), "ngCount"), res: r };
    } },

  { fn: "getWorkstationSummary", admin: 4, userA: 2, // admin +1 = MO COI
    run: async (w) => {
      const r = await db.getWorkstationSummary({ ...win, ...w });
      return { n: sum(r.filter((x) => x.workstationId === workstationId), "totalInspections"), res: r };
    } },

  { fn: "getMeasurementPointsByWorkstation", admin: 4, userA: 2, // admin +1 = MO COI
    run: async (w) => {
      const r = await db.getMeasurementPointsByWorkstation({ workstationId, ...win, ...w });
      return { n: sum(r, "totalCount"), res: r };
    } },

  { fn: "getNGTrendByDay", admin: 3, userA: 2,
    run: async (w) => { const r = await db.getNGTrendByDay({ ...win, workstationId, ...w }); return { n: sum(r, "totalCount"), res: r }; } },

  { fn: "getNGComparison", admin: 3, userA: 2,
    run: async (w) => { const r = await db.getNGComparison({ ...cmpWin, ...w }); return { n: r?.current.totalCount ?? 0, res: r }; } },

  { fn: "getNGSummaryByMachine", admin: 5, userA: 2,
    run: async (w) => {
      const r = await db.getNGSummaryByMachine({ ...win, ...w });
      return { n: sum(r.filter((x) => Number(x.machineId) === machineId), "totalInspections"), res: r };
    } },

  { fn: "getNGTrendByDayDirect", admin: 5, userA: 2,
    run: async (w) => { const r = await db.getNGTrendByDayDirect({ ...win, machineId, ...w }); return { n: sum(r, "totalCount"), res: r }; } },

  { fn: "getNGComparisonDirect", admin: 5, userA: 2,
    run: async (w) => { const r = await db.getNGComparisonDirect({ ...cmpWin, ...w }); return { n: r?.current.totalCount ?? 0, res: r }; } },

  { fn: "getGalleryImages", admin: 3, userA: 2,
    run: async (w) => { const r = await db.getGalleryImages({ ...win, machineCode, ...w }); return { n: r.total, res: r }; } },

  { fn: "getYieldRateByCorporate", admin: 5, userA: 2,
    run: async (w) => {
      const r = await db.getYieldRateByCorporate({ ...win, ...w } as any);
      return { n: sum(r.filter((x) => x.corporateCode === CORP_A || x.corporateCode === CORP_B), "totalInspections"), res: r };
    } },

  { fn: "getYieldRateByFactory", admin: 5, userA: 2,
    run: async (w) => {
      const r = await db.getYieldRateByFactory({ ...win, ...w } as any);
      return { n: sum(r.filter((x) => x.factoryCode === FAC_A || x.factoryCode === FAC_B), "totalInspections"), res: r };
    } },

  { fn: "getThroughputByCorporate", admin: 5, userA: 2,
    run: async (w) => {
      const r = await db.getThroughputByCorporate({ ...win, ...w } as any);
      return { n: sum(r.filter((x) => x.corporateCode === CORP_A || x.corporateCode === CORP_B), "count"), res: r };
    } },

  { fn: "getThroughputByFactory", admin: 5, userA: 2,
    run: async (w) => {
      const r = await db.getThroughputByFactory({ ...win, ...w } as any);
      return { n: sum(r.filter((x) => x.factoryCode === FAC_A || x.factoryCode === FAC_B), "count"), res: r };
    } },

  { fn: "getTopNGMeasurementPointsEnhanced", admin: 2, userA: 1,
    run: async (w) => {
      const r = await db.getTopNGMeasurementPointsEnhanced({ ...win, machineId, limit: 50, ...w });
      return { n: sum(r.filter((x) => x.measurementPointId === pointDefId), "ngCount"), res: r };
    } },

  { fn: "getYieldTrendData", admin: 5, userA: 2,
    run: async (w) => {
      const r = await db.getYieldTrendData({ startDate: WINDOW_START, endDate: WINDOW_END, machineId, ...w });
      return { n: sum(r, "totalCount"), res: r };
    } },

  { fn: "getRecentYieldData", admin: 8, userA: 3,
    run: async (w) => { const r = await db.getRecentYieldData({ machineId, days: DAYS_BACK, ...w }); return { n: sum(r, "totalCount"), res: r }; } },

  { fn: "getNGByWorkstation", admin: 2, userA: 1,
    run: async (w) => {
      const r = await db.getNGByWorkstation({ ...win, machineId, ...w });
      return { n: sum(r.filter((x) => x.workstationId === workstationId), "ngCount"), res: r };
    } },

  { fn: "getNGByMeasurementPointForWorkstation", admin: 2, userA: 1,
    run: async (w) => {
      const r = await db.getNGByMeasurementPointForWorkstation({ workstationId, ...win, machineId, ...w });
      return { n: sum(r, "ngCount"), res: r };
    } },

  { fn: "getMeasurementPointStatsByProduct", admin: 3, userA: 2,
    run: async (w) => {
      const r = await db.getMeasurementPointStatsByProduct({ productModelId, startDate: WINDOW_START, endDate: WINDOW_END, ...w });
      return { n: sum(r, "totalCount"), res: r };
    } },

  { fn: "getMeasurementPointImagesByProduct", admin: 3, userA: 2,
    run: async (w) => {
      const r = await db.getMeasurementPointImagesByProduct({ productModelId, startDate: WINDOW_START, endDate: WINDOW_END, ...w }) as any;
      const g = r?.[pointDefId];
      return { n: g ? g.okImages.length + g.ngImages.length : 0, res: r };
    } },

  { fn: "getDrillStatsByCorporate", admin: 5, userA: 2,
    run: async (w) => {
      const r = await db.getDrillStatsByCorporate({ ...win, ...w } as any);
      return { n: sum(r.filter((x) => x.code === CORP_A || x.code === CORP_B), "total"), res: r };
    } },

  { fn: "getDrillStatsByFactory", admin: 5, userA: 2,
    run: async (w) => {
      const r = await db.getDrillStatsByFactory({ ...win, ...w } as any);
      return { n: sum(r.filter((x) => x.factoryCode === FAC_A || x.factoryCode === FAC_B), "total"), res: r };
    } },

  { fn: "getDrillStatsByLine", label: "nhà máy A (chiều DƯƠNG)", admin: 2, userA: 2,
    run: async (w) => { const r = await db.getDrillStatsByLine({ factoryCode: FAC_A, ...win, ...w } as any); return { n: sum(r, "total"), res: r }; } },

  { fn: "getDrillStatsByLine", label: "nhà máy B (chiều ÂM: A KHÔNG được thấy)", admin: 3, userA: 0,
    run: async (w) => { const r = await db.getDrillStatsByLine({ factoryCode: FAC_B, ...win, ...w } as any); return { n: sum(r, "total"), res: r }; } },
];

// ══════════════════════════════════════════════════════════════════════════════════════════
// LƯỚI VỊ TỪ
// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ VỊ TỪ — ∀ hàm đọc `product_inspections`: có mục dò, hoặc được khai MIỄN TRỪ", () => {
  it("phép quét bắt được cả hai phía (chống lưới tự thoả)", () => {
    const bodies = exportedFunctionBodies();
    // Nếu regex hỏng, mọi tập đều rỗng và mọi khẳng định "⊆" bên dưới sẽ XANH GIẢ.
    expect(bodies.length).toBeGreaterThan(35);
    expect(bodies.map((b) => b.name)).toContain("getDashboardStats");
    const reads = bodies.filter((b) => /\bproductInspections\b|\bproduct_inspections\b/.test(b.body));
    expect(reads.length).toBeGreaterThan(30);
    // …và phải phân biệt được: có hàm KHÔNG đọc bảng này.
    expect(reads.length).toBeLessThan(bodies.length);
    expect(reads.map((b) => b.name)).not.toContain("getOverviewEntityCounts");
  });

  it("★ KHÔNG hàm nào đọc bản ghi kiểm mà đứng ngoài cả bảng dò lẫn tập miễn trừ", () => {
    const reads = exportedFunctionBodies()
      .filter((b) => /\bproductInspections\b|\bproduct_inspections\b/.test(b.body))
      .map((b) => b.name);
    const probed = new Set(PROBES.map((p) => p.fn));

    const boHong = reads.filter((n) => !probed.has(n) && !(n in MIEN_TRU));

    // Thêm một hàm mới đọc `product_inspections` mà quên khai ⇒ ĐỎ ngay tại đây.
    expect(boHong).toEqual([]);
  });

  it("★ tập miễn trừ không được phình ra: mỗi tên phải CÓ THẬT và CÓ lý do", () => {
    const all = new Set(exportedFunctionBodies().map((b) => b.name));
    for (const [name, reason] of Object.entries(MIEN_TRU)) {
      // Miễn trừ cho một hàm đã bị xoá = rác che mắt lần rà sau.
      expect(all.has(name), `miễn trừ trỏ tới hàm không tồn tại: ${name}`).toBe(true);
      expect(reason.length, `miễn trừ ${name} thiếu lý do`).toBeGreaterThan(60);
    }
    // Một mục dò KHÔNG được đồng thời nằm trong miễn trừ, trừ `getMeasurementPointImagesByProduct`
    // (miễn trừ phần NHÃN, vẫn có mục dò cho phần LỌC).
    const both = PROBES.map((p) => p.fn).filter((n) => n in MIEN_TRU);
    expect([...new Set(both)]).toEqual(["getMeasurementPointImagesByProduct"]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// CƯỠNG CHẾ — chạy THẬT xuống CSDL
// ══════════════════════════════════════════════════════════════════════════════════════════
/** Có ô `filter` ở BẤT KỲ đâu (kể cả ô không liệt kê được đính trên mảng). */
function hasFilterProp(value: unknown, depth = 0): boolean {
  if (depth > 4 || value === null || typeof value !== "object") return false;
  if (Object.getOwnPropertyNames(value).includes("filter")) return true;
  if (Array.isArray(value)) return value.some((v) => hasFilterProp(v, depth + 1));
  return Object.values(value as Record<string, unknown>).some((v) => hasFilterProp(v, depth + 1));
}

describe("★★★ CƯỠNG CHẾ — mỗi mục dò, ba chiều", () => {
  for (const probe of PROBES) {
    const title = probe.label ? `${probe.fn} — ${probe.label}` : probe.fn;

    it(`${title}: ÂM — người 0 gán nhà máy nhận ĐÚNG 0`, async () => {
      const { n } = await probe.run(USER_NONE);
      // Đột biến "gỡ trục phạm vi khỏi hàm này" ⇒ ĐỎ ngay ở đây.
      expect(n).toBe(0);
    });

    it(`${title}: DƯƠNG — admin và người gán A vẫn thấy ĐỦ phần của mình`, async () => {
      const a = await probe.run(ADMIN);
      const u = await probe.run(USER_A);

      if (probe.admin >= 0) expect(a.n).toBe(probe.admin);
      else expect(a.n).toBeGreaterThan(0);

      if (probe.userA >= 0) expect(u.n).toBe(probe.userA);
      else expect(u.n).toBeGreaterThan(0);

      // Hàm không cô lập được vẫn phải chứng minh có PHẦN của B mà A không thấy.
      if (probe.admin < 0 || probe.userA < 0) expect(a.n).toBeGreaterThan(u.n);
    });

    it(`${title}: KHÔNG VÒNG — đáp ứng serialise được, không mang \`filter\``, async () => {
      for (const w of [ADMIN, USER_A, USER_NONE]) {
        const { res } = await probe.run(w);
        // Đột biến `scope = resolved` nguyên khối ở người CÓ gán ⇒ ném ở đây.
        expect(() => JSON.stringify(res)).not.toThrow();
        expect(() => superjson.stringify(res)).not.toThrow();
        // …và ở người 0 gán (vị từ `1 = 0` KHÔNG có vòng) hoặc trên kết quả MẢNG ⇒ bắt ở đây.
        expect(hasFilterProp(res)).toBe(false);
      }
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// NHÃN — số 0 phải KÈM LÝ DO
// ══════════════════════════════════════════════════════════════════════════════════════════
/**
 * Chín bề mặt mới vá có hình dạng trả về ĐẶT ĐƯỢC ba ô nhãn. Chặn đúng mà im lặng thì người
 * dùng đọc số 0 thành "chưa có sản lượng" và đi tìm lỗi ở dây chuyền — đúng chỗ không có lỗi.
 */
const LABELLED: Array<[string, (w: Who) => Promise<any>]> = [
  ["getMachineStats", (w) => db.getMachineStats(machineId, WINDOW_START, WINDOW_END, w)],
  ["getDailyStats", (w) => db.getDailyStats(undefined, undefined, DAYS_BACK, w)],
  ["getHourlyStats", (w) => db.getHourlyStats({ machineId, hours: HOURS_BACK, ...w })],
  ["getNGTrendByDay", (w) => db.getNGTrendByDay({ ...win, workstationId, ...w })],
  ["getNGTrendByDayDirect", (w) => db.getNGTrendByDayDirect({ ...win, machineId, ...w })],
  ["getNGComparisonDirect", (w) => db.getNGComparisonDirect({ ...cmpWin, ...w })],
  ["getNGSummaryByMachine", (w) => db.getNGSummaryByMachine({ ...win, ...w })],
  ["getWorkstationSummary", (w) => db.getWorkstationSummary({ ...win, ...w })],
  ["getGalleryImages", (w) => db.getGalleryImages({ ...win, machineCode, ...w })],
];

describe("★★ NHÃN — số 0 của người 0 gán phải nói ĐÚNG lý do", () => {
  for (const [name, call] of LABELLED) {
    it(`${name}: người 0 gán nhận \`no_factory_assignment\` + câu nói về GÁN NHÀ MÁY`, async () => {
      const r = await call(USER_NONE);
      expect(r.scopeEmptyReason).toBe("no_factory_assignment");
      expect(r.scopeMessage).toMatch(/gán nhà máy/i);
      // Đột biến "đổi câu thành không-có-dữ-liệu" ⇒ ĐỎ.
      expect(r.scopeMessage ?? "").not.toMatch(/không có dữ liệu|chưa có sản lượng|không tìm thấy kết quả/i);
    });

    it(`${name}: người CÓ gán KHÔNG bị dán nhãn chưa-gán (chống vá quá tay)`, async () => {
      const r = await call(USER_A);
      // Đột biến "gắn nhãn chưa-gán cho cả người CÓ gán" ⇒ ĐỎ.
      expect(r.scopeEmptyReason).toBeNull();
      expect(r.scopeMessage).toBeNull();
      expect(r.scopeApplied).toBe(true);
    });

    it(`${name}: admin KHÔNG bị áp bộ lọc nào (chống chặn nhầm admin)`, async () => {
      const r = await call(ADMIN);
      expect(r.scopeApplied).toBe(false);
      expect(r.scopeEmptyReason).toBeNull();
    });
  }

  it("★ các hàm trả MẢNG vẫn LÀ mảng thật — nơi gọi cũ (.map/JSON/toEqual) không đổi", async () => {
    const rows = await db.getNGTrendByDayDirect({ ...win, machineId, ...USER_A });

    expect(Array.isArray(rows)).toBe(true);
    expect(() => rows.map((r) => r.totalCount)).not.toThrow();
    // Nhãn KHÔNG liệt kê được ⇒ không lọt vào JSON, không làm đỏ `toEqual` của lưới cũ.
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows.map((r) => ({ ...r })));
    expect(Object.keys(rows)).not.toContain("scopeEmptyReason");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// KHOÁ NHỚ ĐỆM — lối rò độc lập với SQL
// ══════════════════════════════════════════════════════════════════════════════════════════
/**
 * `dashboard.getMachineStats` / `getAllMachinesStats` / `getDailyStats` đều đọc–ghi nhớ đệm
 * bằng khoá sinh từ `input`, trong khi GIÁ TRỊ nay đã lọc theo phạm vi người gọi. Ai nạp trước
 * thì người sau đọc số của người đó ⇒ bản vá SQL bị vô hiệu hoá hoàn toàn mà mọi ca ở trên vẫn
 * xanh. Ca này gọi CHÍNH bộ sinh khoá mà router dùng — không tự dựng lại (thước tự thoả).
 */
describe("★★ khoá nhớ đệm của các thủ tục thống kê phải mang danh tính người gọi", () => {
  it("hai người khác nhau, cùng `input` ⇒ HAI khoá khác nhau", async () => {
    const { scopedStatsCacheKey } = await import("../routers/dashboardStatsRouters");
    const input = { machineId, startDate: WINDOW_START, endDate: WINDOW_END };

    const kAdmin = scopedStatsCacheKey("machine_stats", input, { id: adminId, role: "admin" });
    const kNone = scopedStatsCacheKey("machine_stats", input, { id: userNoneId, role: "engineer" });

    expect(kAdmin).not.toBe(kNone);
    expect(kAdmin).toContain(String(adminId));
    expect(kNone).toContain(String(userNoneId));
  });

  it("cùng một người, cùng `input` ⇒ CÙNG khoá (nhớ đệm vẫn phải có tác dụng)", async () => {
    const { scopedStatsCacheKey } = await import("../routers/dashboardStatsRouters");
    const input = { machineId, startDate: WINDOW_START, endDate: WINDOW_END };
    const who = { id: userAId, role: "engineer" };

    expect(scopedStatsCacheKey("machine_stats", input, who))
      .toBe(scopedStatsCacheKey("machine_stats", input, who));
  });
});
