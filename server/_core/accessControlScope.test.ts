/**
 * ★★★ 2026-08-17 — PHẠM VI DỮ LIỆU của `getAccessFilterConditions` và BA bề mặt dùng nó.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * LỖ ĐÃ ĐO (trước bản vá này)
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * `server/_core/accessControl.ts` tự khai trong docblock:
 *     "Non-admin with NO assignments: returns a condition that matches nothing (1=0)"
 * và mã viết:
 *     return or()!;   // empty or() produces FALSE
 *
 * **Câu chú thích ấy SAI.** `drizzle-orm/sql/expressions/conditions.js`:
 *     const conditions = unfilteredConditions.filter(c => c !== void 0);
 *     if (conditions.length === 0) return void 0;   // ← undefined, KHÔNG phải FALSE
 *
 * Dấu `!` (non-null assertion) dập tắt đúng cái cảnh báo TypeScript lẽ ra đã chỉ vào chỗ này.
 * Và cả 10 điểm gọi đều viết `if (accessFilter) conditions.push(accessFilter)` ⇒ `undefined`
 * = **KHÔNG có mệnh đề WHERE** = **thấy TẤT CẢ**, ngược hẳn ý định đã khai.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * LƯỚI NÀY ĐO GÌ — HAI TẦNG, HAI CHIỀU
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * TẦNG 1 — NEO vào hành vi THẬT của `or()` rỗng. Không canh kết quả truy vấn mà canh chính
 * giá trị trả về: hoàn nguyên về `or()!` ⇒ ĐỎ NGAY, không cần tới CSDL. Đây là ca chống đúng
 * cái đột biến đã sinh ra lỗ này.
 *
 * TẦNG 2 — BA bề mặt đọc dữ liệu, mỗi bề mặt một `.where()` riêng (gỡ lọc khỏi MỘT bề mặt
 * cũng phải ĐỎ):
 *   ① `/history`  → `server/db/inspection.ts` → `getProductInspectionsCursor`
 *   ② Thống kê    → `server/db/statistics.ts` → `getDashboardStats`
 *   ③ Bảng Andon  → `server/db/andonBoard.ts` → `getAndonBoardData`
 *
 * CHIỀU ÂM: người gán nhà máy A không thấy dữ liệu nhà máy B; người 0 gán thấy RỖNG.
 * CHIỀU DƯƠNG: admin vẫn thấy TOÀN BỘ; người gán A vẫn thấy ĐỦ dữ liệu A (chống "vá quá tay
 * thành chặn tất cả" — lưới xanh mà tính năng chết).
 *
 * ⚠ CÂU "RỖNG" PHẢI TRUNG THỰC: người 0 gán nhận `scopeEmptyReason:"no_factory_assignment"`
 * kèm câu nói rõ *"chưa được gán nhà máy"*. Nó TUYỆT ĐỐI không được nói "không có dữ liệu" /
 * "không có lỗi nào" — giả vờ không có dữ liệu dạy người vận hành rằng **hệ thống hỏng**
 * trong khi sự thật là **phạm vi của họ rỗng**.
 *
 * Lưới chạy trên CSDL test thật (vitest.setup.ts) với `_core/accessControl` THẬT — không mock
 * bộ phân giải phạm vi, vì thứ cần chứng minh chính là SQL sinh ra từ nó có tới nơi hay không.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { or } from "drizzle-orm";
import superjson from "superjson";
import {
  getAccessFilterConditions,
  clearAssignmentCache,
  NO_FACTORY_ASSIGNMENT_MESSAGE,
  SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT,
} from "./accessControl";
import * as db from "../db";
import { getDb } from "../db/connection";
import { users, type InsertUser } from "../../drizzle/schema";
/**
 * Rút phần CHỮ của một biểu thức SQL drizzle (bỏ qua cột/tham số).
 *
 * ⚠ Hai cái bẫy ĐÃ ĐO ở đây, ghi lại để lần sau không đi lại:
 *  1. `JSON.stringify` KHÔNG dùng được — `inArray(column, …)` nhúng đối tượng `Column` có
 *     tham chiếu vòng (`Converting circular structure to JSON`).
 *  2. Phải ĐỆ QUY — `or(x)` một điều kiện trả `new SQL([x])`, tức `queryChunks` chứa một
 *     `SQL` LỒNG chứ không phải `StringChunk`. Bản duyệt một tầng trả về chuỗi RỖNG, và một
 *     chuỗi rỗng thì "không chứa 1 = 0" ⇒ khẳng định phủ định sẽ XANH GIẢ.
 */
function sqlText(q: unknown): string {
  if (!q || typeof q !== "object") return "";
  const chunks = (q as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) return chunks.map(sqlText).join("");
  const v = (q as { value?: unknown }).value;
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v.join("");
  return "";
}

const ts = Date.now();
const FAC_A = `ACS_FAC_A_${ts}`;
const FAC_B = `ACS_FAC_B_${ts}`;
const CORP_A = `ACS_CORP_A_${ts}`;
const CORP_B = `ACS_CORP_B_${ts}`;

/**
 * Cửa sổ riêng của file này ⇒ khác biệt DUY NHẤT giữa ba người dùng là PHẠM VI.
 * ⚠ Cửa sổ đặt trong QUÁ KHỨ có chủ đích: `getAndonBoardData` chỉ chặn dưới
 * (`gte(inspectionTime, dayStart)`) và KHÔNG có chặn trên, nên bản ghi ngày tương lai sẽ lọt
 * vào phép đếm "hôm nay" của bề mặt ③ và làm nhiễu phép đo (đã đo: 8 thay vì 3 ở lượt đầu).
 */
const WINDOW_START = new Date("2019-05-01T00:00:00Z");
const WINDOW_END = new Date("2019-05-10T00:00:00Z");
const INSPECTED_AT = new Date("2019-05-05T03:00:00Z");

let machineId: number;
let machineCode: string;
let adminId: number;
let userAId: number;
let userNoneId: number;
let pointDefId: number;

async function mkUser(role: NonNullable<InsertUser["role"]>, tag: string): Promise<number> {
  const conn = await getDb();
  const [u] = await conn!
    .insert(users)
    .values({
      openId: `acs_${tag}_${ts}`,
      username: `acs_${tag}_${ts}`,
      name: `access scope ${tag}`,
      role,
      loginMethod: "local",
    })
    .returning({ id: users.id });
  return u.id;
}

/**
 * Bản ghi kiểm gắn nhãn tenant. `overallResult` khác nhau giữa hai nhà máy để một phép đếm
 * gộp cũng lộ ra ngay là dữ liệu của nhà máy nào đã lọt vào.
 */
async function mkInspection(
  corporateCode: string,
  factoryCode: string,
  overallResult: "OK" | "NG",
  at: Date,
  tag: string,
) {
  return db.createProductInspection({
    machineId,
    serialNumber: `SN_ACS_${tag}_${ts}`,
    overallResult,
    originalResult: overallResult,
    inspectionTime: at,
    corporateCode,
    factoryCode,
  });
}

beforeAll(async () => {
  const factoryId = await db.createFactory({ code: `ACSF_${ts}`, name: "Access scope fac" });
  const workshopId = await db.createWorkshop({ factoryId, code: `ACSW_${ts}`, name: "Access scope ws" });
  const lineId = await db.createProductionLine({ workshopId, code: `ACSL_${ts}`, name: "Access scope line" });
  const stationId = await db.createStation({ lineId, code: `ACSS_${ts}`, name: "Access scope st", orderIndex: 1 });
  machineCode = `ACSM_${ts}`;
  machineId = await db.createMachine({
    stationId,
    code: machineCode,
    name: "Access scope machine",
    machineType: "AOI",
    apiKey: `acs_${ts}`,
  });

  // ── Cửa sổ 2032 (bề mặt ① và ②): nhà máy A có 2 bản ghi, nhà máy B có 3 ──────────
  const a1 = await mkInspection(CORP_A, FAC_A, "OK", INSPECTED_AT, "a1");
  const a2 = await mkInspection(CORP_A, FAC_A, "NG", INSPECTED_AT, "a2");
  await mkInspection(CORP_B, FAC_B, "OK", INSPECTED_AT, "b1");
  await mkInspection(CORP_B, FAC_B, "OK", INSPECTED_AT, "b2");
  const b3 = await mkInspection(CORP_B, FAC_B, "NG", INSPECTED_AT, "b3");

  // Điểm đo NG cho bề mặt ④ (`getTopNGMeasurementPoints`): mỗi nhà máy một điểm hỏng, để
  // đường trả về KHÔNG rỗng cũng phải mang nhãn — nếu chỉ đo đường rỗng thì đột biến "gỡ nhãn
  // ở nhánh có dữ liệu" vẫn xanh.
  const productModelId = await db.createProductModel({
    code: `ACSPM_${ts}`,
    name: "Access scope product",
  });
  pointDefId = await db.createMeasurementPointDef({
    productModelId,
    code: `ACSPT_${ts}`,
    name: "Điểm đo phạm vi",
    measurementType: "VISUAL",
    positionX: 10,
    positionY: 10,
  });
  // a1 OK (không sinh điểm NG), a2 + b3 NG.
  await db.createMeasurementResult({ inspectionId: a1, pointDefId, result: "OK" });
  await db.createMeasurementResult({ inspectionId: a2, pointDefId, result: "NG" });
  await db.createMeasurementResult({ inspectionId: b3, pointDefId, result: "NG" });

  // ── HÔM NAY (bề mặt ③ chỉ nhìn ngày hiện tại): A 1 bản ghi, B 2 bản ghi ──────────
  // Máy là DUY NHẤT của file này nên ô máy trong bảng Andon cô lập khỏi dữ liệu ca khác.
  const today = new Date();
  await mkInspection(CORP_A, FAC_A, "OK", today, "ta1");
  await mkInspection(CORP_B, FAC_B, "OK", today, "tb1");
  await mkInspection(CORP_B, FAC_B, "NG", today, "tb2");

  adminId = await mkUser("admin", "admin");
  userAId = await mkUser("engineer", "faca");
  userNoneId = await mkUser("engineer", "none");
  await db.createFactoryAssignment({ userId: userAId, factoryCode: FAC_A, assignedBy: adminId });
  // `userNoneId` cố ý KHÔNG có gán nào — đúng hình dạng supervisor1/operator1/maint1 hôm nay.
  clearAssignmentCache();
});

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ TẦNG 1 — NEO vào hành vi thật của `or()` rỗng (không cần truy vấn)", () => {
  it("SỰ THẬT NỀN: `or()` rỗng của drizzle trả `undefined`, KHÔNG phải vị từ FALSE", () => {
    // Ca này KHÔNG đo mã của chúng ta — nó ghim tiền đề mà bản vá dựa lên. Nếu một bản nâng
    // cấp drizzle đổi hành vi này, ca sẽ đỏ và buộc đọc lại bản vá thay vì im lặng trôi qua.
    expect(or()).toBeUndefined();
  });

  it("★ ĐỘT BIẾN `or()!`: người 0 gán phải nhận vị từ CÓ THẬT, không phải `undefined`", async () => {
    const filter = await getAccessFilterConditions(userNoneId, "engineer");

    // `undefined` ở đây = không mệnh đề WHERE = thấy TẤT CẢ. Hoàn nguyên về `or()!` ⇒ ĐỎ NGAY.
    expect(filter).toBeDefined();
    // …và phải là vị từ FALSE tường minh, không phải một điều kiện bất kỳ.
    expect(sqlText(filter)).toContain("1 = 0");
  });

  it("★ CHIỀU DƯƠNG: admin vẫn nhận `undefined` (không bộ lọc) — không bị vá quá tay", async () => {
    // Đột biến "chặn luôn admin" ⇒ ĐỎ ở đây trước cả khi chạm CSDL.
    await expect(getAccessFilterConditions(adminId, "admin")).resolves.toBeUndefined();
  });

  it("★ CHIỀU DƯƠNG: người CÓ gán nhận điều kiện lọc, KHÔNG phải vị từ FALSE", async () => {
    const filter = await getAccessFilterConditions(userAId, "engineer");

    expect(filter).toBeDefined();
    expect(sqlText(filter)).not.toContain("1 = 0");
    // …và phải là điều kiện lọc THẬT trên cột tenant, không phải một biểu thức trống.
    expect(sqlText(filter)).toMatch(/ in /i);
  });

  it("câu giải thích phải nói về GÁN NHÀ MÁY, không được giả vờ 'không có dữ liệu'", () => {
    expect(SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT).toBe("no_factory_assignment");
    expect(NO_FACTORY_ASSIGNMENT_MESSAGE).toMatch(/gán nhà máy/i);
    expect(NO_FACTORY_ASSIGNMENT_MESSAGE).not.toMatch(/không có dữ liệu|không có lỗi nào|không tìm thấy kết quả/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ BỀ MẶT ① `/history` — `getProductInspectionsCursor`", () => {
  const q = (userId: number, userRole: string) => ({
    userId,
    userRole,
    machineId,
    startDate: WINDOW_START,
    endDate: WINDOW_END,
    limit: 100,
  });

  it("CHIỀU DƯƠNG: admin vẫn thấy TOÀN BỘ (A + B)", async () => {
    const r = await db.getProductInspectionsCursor(q(adminId, "admin"));

    expect(r.data.length).toBe(5); // 2 của A + 3 của B
    expect(r.scopeEmptyReason).toBeNull();
  });

  it("CHIỀU ÂM: người gán nhà máy A KHÔNG thấy một hàng nào của nhà máy B", async () => {
    const r = await db.getProductInspectionsCursor(q(userAId, "engineer"));

    expect(r.data.length).toBe(2);
    expect(r.data.every((row) => row.factoryCode === FAC_A)).toBe(true);
    expect(r.data.some((row) => row.factoryCode === FAC_B)).toBe(false);
  });

  it("CHIỀU DƯƠNG: người gán A vẫn thấy ĐỦ 2 hàng của A (không vá quá tay)", async () => {
    const r = await db.getProductInspectionsCursor(q(userAId, "engineer"));

    const serials = r.data.map((row) => row.serialNumber).sort();
    expect(serials).toEqual([`SN_ACS_a1_${ts}`, `SN_ACS_a2_${ts}`]);
    expect(r.scopeEmptyReason).toBeNull();
  });

  it("CHIỀU ÂM: người 0 gán thấy RỖNG — và câu giải thích nói ĐÚNG lý do", async () => {
    const r = await db.getProductInspectionsCursor(q(userNoneId, "engineer"));

    expect(r.data).toEqual([]);
    expect(r.hasMore).toBe(false);
    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
    expect(r.scopeMessage).toMatch(/gán nhà máy/i);
    // Đột biến: đổi câu thành "không có dữ liệu" ⇒ ĐỎ.
    expect(r.scopeMessage ?? "").not.toMatch(/không có dữ liệu|không tìm thấy kết quả/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ BỀ MẶT ② Thống kê — `getDashboardStats`", () => {
  const q = (userId: number, userRole: string) => ({
    userId,
    userRole,
    machineId,
    startDate: WINDOW_START,
    endDate: WINDOW_END,
  });

  it("CHIỀU DƯƠNG: admin vẫn cộng cả A lẫn B", async () => {
    const s = await db.getDashboardStats(q(adminId, "admin"));

    expect(s.total).toBe(5);
    expect(s.ng).toBe(2); // a2 + b3
    expect(s.scopeEmptyReason).toBeNull();
  });

  it("CHIỀU ÂM + DƯƠNG: người gán A cộng ĐÚNG 2 hàng của A, KHÔNG lẫn hàng của B", async () => {
    const s = await db.getDashboardStats(q(userAId, "engineer"));

    expect(s.total).toBe(2); // KHÔNG phải 5 — B không rò qua đường tổng hợp
    expect(s.ok).toBe(1);
    expect(s.ng).toBe(1); // chỉ a2; nếu b3 lọt vào sẽ là 2
    expect(s.scopeEmptyReason).toBeNull();
  });

  it("CHIỀU ÂM: người 0 gán nhận SỐ KHÔNG kèm lý do trung thực, không phải im lặng", async () => {
    const s = await db.getDashboardStats(q(userNoneId, "engineer"));

    expect(s.total).toBe(0);
    expect(s.ng).toBe(0);
    expect(s.scopeEmptyReason).toBe("no_factory_assignment");
    expect(s.scopeMessage).toMatch(/gán nhà máy/i);
    expect(s.scopeMessage ?? "").not.toMatch(/không có dữ liệu|không có lỗi nào/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★ LỐI RÒ THỨ HAI, ĐỘC LẬP với `getAccessFilterConditions` — tìm thấy khi rà điểm gọi.
 *
 * `dashboardRouter.getStats` sinh khoá cache từ `input` (factoryId/workshopId/lineId/ngày),
 * NHƯNG giá trị lại được tính VỚI `userId`/`userRole` của người gọi. Khoá không mang danh
 * tính ⇒ kết quả đã lọc theo phạm vi của người này được phục vụ lại cho người khác. Nếu admin
 * nạp cache trước, người 0 gán nhà máy nhận nguyên số toàn cục kèm `scopeEmptyReason: null` —
 * bản vá ở tầng dưới bị vô hiệu hoá HOÀN TOÀN mà mọi lưới ở tầng db vẫn xanh.
 *
 * ⚠ THƯỚC TỰ THOẢ — đã đo và đã sửa. Bản đầu của ca này TỰ DỰNG LẠI khoá trong test rồi so
 * hai khoá với nhau; đột biến "bỏ danh tính khỏi khoá của router" vẫn XANH vì ca kiểm không hề
 * chạm tới router. Nay ca gọi CHÍNH `dashboardStatsCacheKey` mà router dùng, nên đột biến ấy
 * đỏ thật.
 */
describe("★★ khoá cache của `dashboardRouter.getStats` phải mang danh tính người gọi", () => {
  it("hai người dùng khác nhau, cùng `input` ⇒ HAI khoá khác nhau", async () => {
    const { dashboardStatsCacheKey } = await import("../routers/dashboardStatsRouters");
    const input = { factoryId: 1, startDate: WINDOW_START, endDate: WINDOW_END };

    const keyAdmin = dashboardStatsCacheKey(input, { id: adminId, role: "admin" });
    const keyNone = dashboardStatsCacheKey(input, { id: userNoneId, role: "engineer" });

    // Cùng `input` mà chung khoá ⇒ số liệu toàn cục của admin được phục vụ lại cho người 0 gán.
    expect(keyAdmin).not.toBe(keyNone);
    expect(keyAdmin).toContain(String(adminId));
    expect(keyNone).toContain(String(userNoneId));
  });

  it("cùng một người, cùng `input` ⇒ CÙNG khoá (cache vẫn phải có tác dụng)", async () => {
    const { dashboardStatsCacheKey } = await import("../routers/dashboardStatsRouters");
    const input = { factoryId: 1, startDate: WINDOW_START, endDate: WINDOW_END };

    // Chiều DƯƠNG: đừng "sửa" bằng cách nhét thứ ngẫu nhiên vào khoá — thế là giết cache.
    expect(dashboardStatsCacheKey(input, { id: userAId, role: "engineer" }))
      .toBe(dashboardStatsCacheKey(input, { id: userAId, role: "engineer" }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ BỀ MẶT ③ Bảng Andon — `getAndonBoardData`", () => {
  /** Ô của MÁY DUY NHẤT thuộc file này ⇒ cô lập khỏi dữ liệu "hôm nay" của ca khác. */
  async function tileOf(userId: number, userRole: string) {
    const board = await db.getAndonBoardData({ userId, userRole });
    const tile = board.lines.flatMap((l) => l.machines).find((m) => m.machineId === machineId);
    return { board, tile };
  }

  it("CHIỀU DƯƠNG: admin đếm cả A lẫn B trên ô máy (3 hàng hôm nay)", async () => {
    const { board, tile } = await tileOf(adminId, "admin");

    expect(tile).toBeDefined();
    expect(tile!.total).toBe(3); // 1 của A + 2 của B
    expect(board.scopeEmptyReason).toBeNull();
  });

  it("CHIỀU ÂM + DƯƠNG: người gán A chỉ đếm 1 hàng của A, KHÔNG đếm 2 hàng của B", async () => {
    const { board, tile } = await tileOf(userAId, "engineer");

    expect(tile!.total).toBe(1);
    expect(tile!.ng).toBe(0); // hàng NG duy nhất hôm nay thuộc B — không được rò sang
    expect(board.scopeEmptyReason).toBeNull();
  });

  it("CHIỀU ÂM: người 0 gán thấy ô máy RỖNG — và bảng nói ĐÚNG lý do", async () => {
    const { board, tile } = await tileOf(userNoneId, "engineer");

    expect(tile!.total).toBe(0);
    expect(board.scopeEmptyReason).toBe("no_factory_assignment");
    expect(board.scopeMessage).toMatch(/gán nhà máy/i);
    expect(board.scopeMessage ?? "").not.toMatch(/không có dữ liệu|chưa có sản lượng/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ BỀ MẶT ④ — SÁU HÀM THỐNG KÊ CÒN LẠI: chặn ĐÚNG nhưng SỐ 0 IM LẶNG.
 *
 * Bản vá trước chỉ gắn nhãn cho `getDashboardStats`. Sáu hàm dưới đây cũng nhận
 * `userId`/`userRole`, cũng bị thu hẹp đúng, nhưng trả về số 0 / mảng rỗng KHÔNG kèm lý do ⇒
 * người dùng 0 gán nhà máy đọc chúng thành "chưa có sản lượng" và đi tìm lỗi ở dây chuyền.
 *
 * Mỗi hàm được đo theo ĐÚNG BA CHIỀU, và cả ba đều cần thiết:
 *   • ÂM   — người gán nhà máy A không thấy số của nhà máy B (đột biến "bỏ bộ lọc" ⇒ đỏ),
 *   • DƯƠNG— admin vẫn thấy đủ và người gán A vẫn thấy đủ phần của A (đột biến "vá quá tay
 *            thành chặn tất cả" ⇒ đỏ),
 *   • NHÃN — người 0 gán nhận `scopeEmptyReason` + câu nói về GÁN NHÀ MÁY (đột biến "gỡ nhãn
 *            khỏi hàm này" ⇒ đỏ, và đột biến "đổi câu thành không-có-dữ-liệu" cũng ⇒ đỏ).
 *
 * ⚠ Ba hàm trả MẢNG (`getShiftStats`, `getShiftReport`, `getTopNGMeasurementPoints`) mang nhãn
 * bằng thuộc tính đính lên chính mảng (`withScopeLabels`) chứ không đổi thành `{ rows, … }` — vì
 * `pdfReportRouter`/`powerpointRouter`/`reportBuilderRouter` tiêu thụ chúng NHƯ MẢNG. Ca cuối
 * của khối này neo luôn tính chất ấy: đổi hình dạng mảng ⇒ đỏ.
 */
describe("★★★ BỀ MẶT ④ — sáu hàm thống kê phải mang nhãn, không im lặng", () => {
  const win = { startDate: WINDOW_START, endDate: WINDOW_END };
  const who = (userId: number, userRole: string) => ({ userId, userRole });

  // ── ④.1 getPanelYieldStats ────────────────────────────────────────────────────────────
  describe("getPanelYieldStats", () => {
    const q = (userId: number, role: string) => ({ ...win, machineId, ...who(userId, role) });

    it("CHIỀU DƯƠNG: admin cộng cả A lẫn B (5 bo)", async () => {
      const s = await db.getPanelYieldStats(q(adminId, "admin"));
      expect(s.boardTotal).toBe(5);
      expect(s.scopeEmptyReason).toBeNull();
    });

    it("CHIỀU ÂM + DƯƠNG: người gán A cộng ĐÚNG 2 bo của A", async () => {
      const s = await db.getPanelYieldStats(q(userAId, "engineer"));
      expect(s.boardTotal).toBe(2); // KHÔNG phải 5
      expect(s.boardNg).toBe(1); // chỉ a2
      expect(s.scopeEmptyReason).toBeNull();
    });

    it("NHÃN: người 0 gán nhận số 0 KÈM lý do, không im lặng", async () => {
      const s = await db.getPanelYieldStats(q(userNoneId, "engineer"));
      expect(s.boardTotal).toBe(0);
      expect(s.scopeEmptyReason).toBe("no_factory_assignment");
      expect(s.scopeMessage).toMatch(/gán nhà máy/i);
      expect(s.scopeMessage ?? "").not.toMatch(/không có dữ liệu|chưa có sản lượng/i);
    });
  });

  // ── ④.2 getShiftStats ─────────────────────────────────────────────────────────────────
  describe("getShiftStats", () => {
    const sum = (rows: Array<{ total: number }>) => rows.reduce((s, r) => s + r.total, 0);

    it("CHIỀU DƯƠNG: admin KHÔNG bị lọc (thấy ít nhất cả 5 bản ghi của cửa sổ)", async () => {
      const rows = await db.getShiftStats({ ...win, ...who(adminId, "admin") });
      // ⚠ Không neo con số TUYỆT ĐỐI: hàm này không nhận `machineId`, nên cửa sổ có thể chứa
      // dữ liệu của ca kiểm khác. Neo vào chiều "admin không bị chặn" mới là thứ cần canh.
      expect(sum(rows)).toBeGreaterThanOrEqual(5);
      expect(rows.scopeEmptyReason).toBeNull();
    });

    it("CHIỀU ÂM + DƯƠNG: người gán A cộng ĐÚNG 2 (mã nhà máy A là duy nhất của file này)", async () => {
      const rows = await db.getShiftStats({ ...win, ...who(userAId, "engineer") });
      expect(sum(rows)).toBe(2);
      expect(rows.scopeEmptyReason).toBeNull();
    });

    it("NHÃN: người 0 gán — mọi ca đều 0 và mảng mang lý do", async () => {
      const rows = await db.getShiftStats({ ...win, ...who(userNoneId, "engineer") });
      expect(sum(rows)).toBe(0);
      expect(rows.scopeEmptyReason).toBe("no_factory_assignment");
      expect(rows.scopeMessage).toMatch(/gán nhà máy/i);
      expect(rows.scopeMessage ?? "").not.toMatch(/không có dữ liệu|chưa có sản lượng/i);
    });
  });

  // ── ④.3 getShiftReport ────────────────────────────────────────────────────────────────
  describe("getShiftReport", () => {
    const sum = (rows: Array<{ total: number }>) => rows.reduce((s, r) => s + r.total, 0);

    it("CHIỀU DƯƠNG: admin KHÔNG bị lọc", async () => {
      const rows = await db.getShiftReport({ ...win, ...who(adminId, "admin") });
      expect(sum(rows)).toBeGreaterThanOrEqual(5);
      expect(rows.scopeEmptyReason).toBeNull();
    });

    it("CHIỀU ÂM + DƯƠNG: người gán A cộng ĐÚNG 2", async () => {
      const rows = await db.getShiftReport({ ...win, ...who(userAId, "engineer") });
      expect(sum(rows)).toBe(2);
      expect(rows.scopeEmptyReason).toBeNull();
    });

    it("NHÃN: người 0 gán — các hàng ca vẫn hiện (đủ khung) nhưng tổng 0 kèm lý do", async () => {
      const rows = await db.getShiftReport({ ...win, ...who(userNoneId, "engineer") });
      expect(sum(rows)).toBe(0);
      expect(rows.scopeEmptyReason).toBe("no_factory_assignment");
      expect(rows.scopeMessage).toMatch(/gán nhà máy/i);
      expect(rows.scopeMessage ?? "").not.toMatch(/không có dữ liệu|chưa có sản lượng/i);
    });
  });

  // ── ④.4 getTopBottomMachines ──────────────────────────────────────────────────────────
  describe("getTopBottomMachines", () => {
    const ours = (r: { top: Array<{ id: number | null; total: number }> }) =>
      r.top.find((m) => m.id === machineId);

    it("CHIỀU DƯƠNG: admin xếp hạng máy này với ĐỦ 5 bản ghi", async () => {
      const r = await db.getTopBottomMachines({ ...win, limit: 50, ...who(adminId, "admin") });
      expect(ours(r)?.total).toBe(5);
      expect(r.scopeEmptyReason).toBeNull();
    });

    it("CHIỀU ÂM + DƯƠNG: người gán A xếp hạng cùng máy nhưng CHỈ 2 bản ghi của A", async () => {
      const r = await db.getTopBottomMachines({ ...win, limit: 50, ...who(userAId, "engineer") });
      expect(ours(r)?.total).toBe(2);
      expect(r.scopeEmptyReason).toBeNull();
    });

    it("NHÃN: người 0 gán nhận bảng xếp hạng RỖNG kèm lý do", async () => {
      const r = await db.getTopBottomMachines({ ...win, limit: 50, ...who(userNoneId, "engineer") });
      expect(r.top).toEqual([]);
      expect(r.bottom).toEqual([]);
      expect(r.scopeEmptyReason).toBe("no_factory_assignment");
      expect(r.scopeMessage).toMatch(/gán nhà máy/i);
      expect(r.scopeMessage ?? "").not.toMatch(/không có dữ liệu|chưa có sản lượng/i);
    });
  });

  // ── ④.5 searchInspections ─────────────────────────────────────────────────────────────
  describe("searchInspections", () => {
    const q = (userId: number, role: string) => ({ ...win, machineCode, ...who(userId, role) });

    it("CHIỀU DƯƠNG: admin tìm thấy cả 5", async () => {
      const r = await db.searchInspections(q(adminId, "admin"));
      expect(Number(r.total)).toBe(5);
      expect(r.scopeEmptyReason).toBeNull();
    });

    it("CHIỀU ÂM + DƯƠNG: người gán A chỉ thấy 2 hàng của A", async () => {
      const r = await db.searchInspections(q(userAId, "engineer"));
      expect(Number(r.total)).toBe(2);
      expect(r.data.every((row) => row.factoryCode === FAC_A)).toBe(true);
      expect(r.scopeEmptyReason).toBeNull();
    });

    it("NHÃN: người 0 gán nhận 0 hàng KÈM lý do", async () => {
      const r = await db.searchInspections(q(userNoneId, "engineer"));
      expect(Number(r.total)).toBe(0);
      expect(r.data).toEqual([]);
      expect(r.scopeEmptyReason).toBe("no_factory_assignment");
      expect(r.scopeMessage).toMatch(/gán nhà máy/i);
      expect(r.scopeMessage ?? "").not.toMatch(/không có dữ liệu|chưa có sản lượng/i);
    });
  });

  // ── ④.6 getTopNGMeasurementPoints ─────────────────────────────────────────────────────
  describe("getTopNGMeasurementPoints", () => {
    const q = (userId: number, role: string) => ({ ...win, machineId, limit: 50, ...who(userId, role) });
    const ourPoint = (rows: Array<{ pointDefId: number; ngCount: number }>) =>
      rows.find((r) => r.pointDefId === pointDefId);

    it("CHIỀU DƯƠNG: admin đếm 2 điểm NG (a2 + b3)", async () => {
      const rows = await db.getTopNGMeasurementPoints(q(adminId, "admin"));
      expect(ourPoint(rows)?.ngCount).toBe(2);
      expect(rows.scopeEmptyReason).toBeNull();
    });

    it("CHIỀU ÂM + DƯƠNG: người gán A đếm ĐÚNG 1 (a2), KHÔNG lẫn b3 — và hàng CÓ dữ liệu vẫn mang nhãn", async () => {
      const rows = await db.getTopNGMeasurementPoints(q(userAId, "engineer"));
      expect(ourPoint(rows)?.ngCount).toBe(1);
      // Nhãn phải có mặt cả trên đường KHÔNG rỗng — nếu chỉ gắn ở nhánh rỗng thì đột biến
      // "gỡ nhãn ở nhánh có dữ liệu" sẽ lọt.
      expect(rows.scopeApplied).toBe(true);
      expect(rows.scopeEmptyReason).toBeNull();
    });

    it("NHÃN: người 0 gán nhận danh sách RỖNG kèm lý do", async () => {
      const rows = await db.getTopNGMeasurementPoints(q(userNoneId, "engineer"));
      expect(rows).toHaveLength(0);
      expect(rows.scopeEmptyReason).toBe("no_factory_assignment");
      expect(rows.scopeMessage).toMatch(/gán nhà máy/i);
      expect(rows.scopeMessage ?? "").not.toMatch(/không có dữ liệu|chưa có sản lượng/i);
    });
  });

  // ── ④.7 hình dạng MẢNG phải giữ nguyên ────────────────────────────────────────────────
  it("★ ba hàm trả mảng vẫn LÀ mảng thật — nơi gọi cũ (`.map`, JSON, toEqual) không đổi", async () => {
    const rows = await db.getShiftStats({ ...win, ...who(userAId, "engineer") });

    // `pdfReportRouter`/`powerpointRouter` gọi `(rows || []).map(…)`; `reportBuilderRouter`
    // trả thẳng mảng làm payload widget. Đổi sang `{ rows, … }` là gãy ba file đó.
    expect(Array.isArray(rows)).toBe(true);
    expect(() => rows.map((r) => r.total)).not.toThrow();
    // Nhãn KHÔNG liệt kê được ⇒ không lọt vào JSON, không làm đỏ `toEqual` của lưới cũ.
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows.map((r) => ({ ...r })));
    expect(Object.keys(rows)).not.toContain("scopeEmptyReason");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ TẦNG 0 — CHỐNG LỖI VÒNG: `filter` TUYỆT ĐỐI không được đi ra đáp ứng.
 *
 * `resolveDataScope` trả CẢ `filter` (đối tượng SQL của drizzle) lẫn ba ô nhãn. Viết
 * `scope = resolved` rồi `return { ...scope }` sẽ spread luôn `filter` vào đáp ứng tRPC.
 * Với người dùng CÓ gán nhà máy, `filter` là `inArray(cột, [...])` mang tham chiếu vòng
 * `PgTable → PgSerial → table` ⇒ superjson chết `Converting circular structure to JSON` ⇒ **500
 * cho mọi người dùng**. Đã xảy ra thật ngày 2026-08-17 trên `dashboard.getStats`.
 *
 * ⚠ VÌ SAO PHẢI CÓ LƯỚI NÀY:
 *  • `tsc` KHÔNG bắt được — `ResolvedDataScope` gán được cho `ScopeLabels`; TypeScript chỉ cấm
 *    thuộc tính thừa với *object literal*, không cấm khi gán một BIẾN. Kiểu hẹp lại, giá trị lúc
 *    chạy vẫn mang `filter`.
 *  • 220 ca test cũ cũng không — không ca nào SERIALISE đáp ứng, mà chỉ đọc từng trường.
 *
 * ⚠ HAI KHẲNG ĐỊNH, KHÔNG PHẢI MỘT — và đây là chỗ lượt đầu suýt xanh giả:
 *  1. `JSON.stringify` ném ⇔ có VÒNG. Nhưng với người **0 gán**, `filter` là `sql\`1 = 0\`` —
 *     KHÔNG hề có vòng, stringify êm ru. Chỉ mình phép thử stringify sẽ mù đúng nửa số ca.
 *  2. Với MẢNG, `JSON.stringify` bỏ qua mọi thuộc tính không phải chỉ số ⇒ `filter` rò lên mảng
 *     cũng stringify êm.
 * Nên mỗi bề mặt bị đo BẰNG CẢ HAI: serialise được VÀ không có ô `filter`.
 */
describe("★★★ TẦNG 0 — `filter` (SQL drizzle) không bao giờ đi ra đáp ứng", () => {
  it("SỰ THẬT NỀN: `resolveDataScope` của người CÓ gán mang `filter` có VÒNG", async () => {
    const { resolveDataScope } = await import("./accessControl");
    const resolved = await resolveDataScope(userAId, "engineer");

    expect(resolved.filter).toBeDefined();
    // Chính phép spread đã gây sự cố 500. Nếu drizzle đổi cấu trúc và hết vòng, ca này đỏ và
    // buộc đọc lại bản vá thay vì để nó lặng lẽ mất ý nghĩa.
    expect(() => JSON.stringify({ ...resolved })).toThrow(/circular|convert/i);
  });

  it("SỰ THẬT NỀN 2: người 0 gán có `filter` KHÔNG vòng ⇒ chỉ đo stringify là MÙ", async () => {
    const { resolveDataScope } = await import("./accessControl");
    const resolved = await resolveDataScope(userNoneId, "engineer");

    expect(resolved.filter).toBeDefined();
    expect(() => JSON.stringify({ ...resolved })).not.toThrow();
  });

  /** Chín bề mặt mang phạm vi. Thêm bề mặt mới mà quên vào đây thì lỗ mở lại — đừng quên. */
  const surfaces: Array<[string, (u: number, r: string) => Promise<unknown>]> = [
    ["getDashboardStats", (u, r) => db.getDashboardStats({ machineId, startDate: WINDOW_START, endDate: WINDOW_END, userId: u, userRole: r })],
    ["getPanelYieldStats", (u, r) => db.getPanelYieldStats({ machineId, startDate: WINDOW_START, endDate: WINDOW_END, userId: u, userRole: r })],
    ["getShiftStats", (u, r) => db.getShiftStats({ startDate: WINDOW_START, endDate: WINDOW_END, userId: u, userRole: r })],
    ["getShiftReport", (u, r) => db.getShiftReport({ startDate: WINDOW_START, endDate: WINDOW_END, userId: u, userRole: r })],
    ["getTopBottomMachines", (u, r) => db.getTopBottomMachines({ startDate: WINDOW_START, endDate: WINDOW_END, userId: u, userRole: r })],
    ["searchInspections", (u, r) => db.searchInspections({ machineCode, startDate: WINDOW_START, endDate: WINDOW_END, userId: u, userRole: r })],
    ["getTopNGMeasurementPoints", (u, r) => db.getTopNGMeasurementPoints({ machineId, startDate: WINDOW_START, endDate: WINDOW_END, userId: u, userRole: r })],
    ["getProductInspectionsCursor", (u, r) => db.getProductInspectionsCursor({ machineId, startDate: WINDOW_START, endDate: WINDOW_END, limit: 10, userId: u, userRole: r })],
    ["getAndonBoardData", (u, r) => db.getAndonBoardData({ userId: u, userRole: r })],
  ];

  /** Có ô `filter` ở BẤT KỲ đâu trong đáp ứng (kể cả ô không liệt kê được trên mảng). */
  function hasFilterProp(value: unknown, depth = 0): boolean {
    if (depth > 4 || value === null || typeof value !== "object") return false;
    if (Object.getOwnPropertyNames(value).includes("filter")) return true;
    if (Array.isArray(value)) return value.some((v) => hasFilterProp(v, depth + 1));
    return Object.values(value as Record<string, unknown>).some((v) => hasFilterProp(v, depth + 1));
  }

  for (const [name, call] of surfaces) {
    for (const [role, userRef] of [["gán nhà máy A", () => userAId], ["0 gán", () => userNoneId]] as const) {
      it(`${name} (${role}): đáp ứng serialise được VÀ không mang \`filter\``, async () => {
        const res = await call(userRef(), "engineer");

        // Đột biến `scope = resolved` ở người CÓ gán ⇒ ném ở đây.
        expect(() => JSON.stringify(res)).not.toThrow();
        // superjson là bộ mã hoá THẬT của tRPC — đo chính nó, không đo vật thay thế.
        expect(() => superjson.stringify(res)).not.toThrow();
        // …và đột biến ấy ở người 0 gán / trên kết quả dạng MẢNG ⇒ ném ở đây.
        expect(hasFilterProp(res)).toBe(false);
      });
    }
  }
});
