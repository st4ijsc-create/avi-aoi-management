/**
 * ★★★ 2026-08-18 (nhóm B #2) — `getDailyStats(factoryId, workshopId, …)`: HAI THAM SỐ CHẾT.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỚP LỖI — **KHÔNG PHẢI RÒ, LÀ SAI SỐ**, và nó nguy hiểm hơn "thiếu tham số"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `resolveStatsScope` vẫn áp phạm vi ⇒ không ai đọc được dữ liệu ngoài phần mình. Nhưng
 * `factoryId`/`workshopId` **nhận vào rồi im lặng bỏ qua**: một người được gán **N nhà máy**, bấm
 * chọn nhà máy A trên trục ISA-95, nhận về **số của cả N nhà máy TRỘN LẪN — dán nhãn A**.
 *
 * ⚠ Một tham số nhận vào rồi bỏ qua nguy hiểm hơn KHÔNG CÓ tham số: nơi gọi tin nó hoạt động.
 * Ở đây cả ba nơi gọi đều tin — `Dashboard.tsx` chú thích *"sparkline theo trục phạm vi"*,
 * `Reports.tsx` nối thẳng dropdown nhà máy vào, và `dashboardStatsRouters` còn **đưa `factoryId`
 * vào KHOÁ NHỚ ĐỆM**, tức lưu hai bản ghi khác khoá mà nội dung hệt nhau.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BỐN CHIỀU PHẢI ĐO CÙNG LÚC (thiếu chiều nào cũng đổi lỗi này lấy lỗi khác)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   §1 CÓ LỌC THẬT      — admin chọn nhà máy A nhận ĐÚNG số của A (đột biến "bỏ lọc" ⇒ ĐỎ).
 *   §2 KHÔNG NỚI PHẠM VI — người gán A chọn xem B nhận **0**, KHÔNG phải số của B
 *                          (đột biến "lọc THAY vì AND với phạm vi" ⇒ ĐỎ). ★ chiều nguy hiểm nhất.
 *   §3 KHÔNG CHẶN NHẦM  — admin không truyền gì vẫn thấy ĐỦ; người CÓ gán vẫn thấy phần mình
 *                          (đột biến "vá quá tay thành chặn tất cả" ⇒ ĐỎ).
 *   §4 NHÃN + KHÔNG VÒNG — số 0 vẫn kèm lý do, và đáp ứng không mang ô `filter`
 *                          (đột biến `{...scope}` ⇒ superjson chết ⇒ ĐỎ).
 *
 * ⚠ Dữ liệu dựng sẵn RIÊNG (nhà máy/xưởng/chuyền/trạm/máy đều mang hậu tố `ts`) nên hai nhà máy
 * của file này cô lập tuyệt đối với `statisticsScope.test.ts` và với mọi file chạy song song —
 * chính vì thế các con số dưới đây là SỐ CHÍNH XÁC chứ không phải "lớn hơn 0".
 */
import { describe, it, expect, beforeAll } from "vitest";
import superjson from "superjson";
import * as db from "../db";
import { getDb } from "./connection";
import { clearAssignmentCache } from "../_core/accessControl";
import { users, type InsertUser } from "../../drizzle/schema";

const ts = Date.now() % 1_000_000;
const CORP = `CDS_C_${ts}`;
const FAC_A = `CDS_A_${ts}`;
const FAC_B = `CDS_B_${ts}`;

/** Cửa sổ đủ hẹp để chỉ trùm các hàng "bây giờ" của file này. */
const DAYS = 2;

let facAId = 0;
let facBId = 0;
let wsAId = 0;
let wsBId = 0;
let machineAId = 0;
let machineBId = 0;
let productModelId = 0;
let adminId = 0;
let userAId = 0;
let userNoneId = 0;

type Who = { userId?: number; userRole?: string };
let ADMIN: Who;
let USER_A: Who;
let USER_NONE: Who;

async function mkUser(role: InsertUser["role"], tag: string): Promise<number> {
  const conn = await getDb();
  const [u] = await conn!
    .insert(users)
    .values({
      openId: `cds_${tag}_${ts}`,
      username: `cds_${tag}_${ts}`,
      name: `daily scope ${tag}`,
      role,
      loginMethod: "local",
    })
    .returning({ id: users.id });
  return u.id;
}

/** Một nhánh ISA-95 đầy đủ nhà máy→xưởng→chuyền→trạm→máy (bộ lọc đi qua ĐÚNG chuỗi join này). */
async function mkNhanh(code: string, tag: string) {
  const factoryId = await db.createFactory({ code, name: `Daily scope ${tag}` });
  const workshopId = await db.createWorkshop({ factoryId, code: `CDSW_${tag}_${ts}`, name: `ws ${tag}` });
  const lineId = await db.createProductionLine({ workshopId, code: `CDSL_${tag}_${ts}`, name: `line ${tag}` });
  const stationId = await db.createStation({ lineId, code: `CDSS_${tag}_${ts}`, name: `st ${tag}`, orderIndex: 1 });
  const machineId = await db.createMachine({
    stationId,
    code: `CDSM_${tag}_${ts}`,
    name: `Daily scope machine ${tag}`,
    machineType: "AOI",
    apiKey: `cds_${tag}_${ts}`,
  });
  return { factoryId, workshopId, machineId };
}

async function mkInspection(machineId: number, factoryCode: string, overallResult: "OK" | "NG", tag: string) {
  return db.createProductInspection({
    machineId,
    productModelId,
    serialNumber: `SN_CDS_${tag}_${ts}`,
    overallResult,
    originalResult: overallResult,
    inspectionTime: new Date(),
    corporateCode: CORP,
    factoryCode,
  });
}

/** Tổng sản lượng trên các hàng theo ngày mà `getDailyStats` trả về. */
const tong = (rows: readonly any[]) => rows.reduce((s, r) => s + Number(r?.totalProducts ?? 0), 0);

beforeAll(async () => {
  const a = await mkNhanh(FAC_A, "a");
  const b = await mkNhanh(FAC_B, "b");
  facAId = a.factoryId;
  wsAId = a.workshopId;
  machineAId = a.machineId;
  facBId = b.factoryId;
  wsBId = b.workshopId;
  machineBId = b.machineId;

  productModelId = await db.createProductModel({ code: `CDSPM_${ts}`, name: "Daily scope product" });

  // Nhà máy A: 3 bản ghi kiểm · nhà máy B: 2. `factoryCode` trên bản ghi khớp nhà máy sở hữu MÁY,
  // để hai TRỤC KHÁC NHAU (`resolveDataScope` lọc theo `factoryCode`; bộ lọc mới lọc theo chuỗi
  // join máy→…→nhà máy) nói về cùng một thứ và chênh lệch nào cũng là chênh lệch THẬT.
  await mkInspection(machineAId, FAC_A, "OK", "a1");
  await mkInspection(machineAId, FAC_A, "OK", "a2");
  await mkInspection(machineAId, FAC_A, "NG", "a3");
  await mkInspection(machineBId, FAC_B, "OK", "b1");
  await mkInspection(machineBId, FAC_B, "NG", "b2");

  adminId = await mkUser("admin", "admin");
  userAId = await mkUser("engineer", "faca");
  userNoneId = await mkUser("engineer", "none");
  await db.createFactoryAssignment({ userId: userAId, factoryCode: FAC_A, assignedBy: adminId });
  // `userNoneId` cố ý KHÔNG có gán nào — đúng hình dạng `supervisor1` trên máy thật.
  clearAssignmentCache();

  ADMIN = { userId: adminId, userRole: "admin" };
  USER_A = { userId: userAId, userRole: "engineer" };
  USER_NONE = { userId: userNoneId, userRole: "engineer" };
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — `factoryId`/`workshopId` LỌC THẬT (tham số hết CHẾT)", () => {
  it("★★★ admin + factoryId=A ⇒ ĐÚNG 3 (đột biến 'bỏ lọc' ⇒ trả cả CSDL ⇒ ĐỎ)", async () => {
    const r = await db.getDailyStats(facAId, undefined, DAYS, ADMIN);
    expect(tong(r)).toBe(3);
  });

  it("★★★ admin + factoryId=B ⇒ ĐÚNG 2 (hai nhà máy KHÔNG trộn lẫn)", async () => {
    const r = await db.getDailyStats(facBId, undefined, DAYS, ADMIN);
    expect(tong(r)).toBe(2);
  });

  it("★ admin + workshopId=A ⇒ ĐÚNG 3 (trục XƯỞNG cũng thật, không chỉ trục nhà máy)", async () => {
    const r = await db.getDailyStats(undefined, wsAId, DAYS, ADMIN);
    expect(tong(r)).toBe(3);
  });

  it("★ admin + workshopId=B ⇒ ĐÚNG 2", async () => {
    const r = await db.getDailyStats(undefined, wsBId, DAYS, ADMIN);
    expect(tong(r)).toBe(2);
  });

  it("factoryId=A + workshopId=B ⇒ 0 (hai điều kiện AND với nhau, không phải OR)", async () => {
    const r = await db.getDailyStats(facAId, wsBId, DAYS, ADMIN);
    expect(tong(r)).toBe(0);
  });

  it("nhà máy KHÔNG TỒN TẠI ⇒ 0, không âm thầm rơi về 'toàn hệ thống'", async () => {
    const r = await db.getDailyStats(2_000_000_000, undefined, DAYS, ADMIN);
    expect(tong(r)).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ §2 — LỌC **KHÔNG ĐƯỢC NỚI** PHẠM VI (chiều nguy hiểm nhất)", () => {
  it("★★★ người gán A chọn xem B ⇒ **0**, KHÔNG phải 2", async () => {
    const r = await db.getDailyStats(facBId, undefined, DAYS, USER_A);
    expect(
      tong(r),
      "bộ lọc nhà máy đang THAY THẾ phạm vi thay vì AND vào phạm vi — đây là RÒ, không phải sai số",
    ).toBe(0);
  });

  it("★★★ …trục XƯỞNG cũng vậy: người gán A chọn xưởng của B ⇒ 0", async () => {
    const r = await db.getDailyStats(undefined, wsBId, DAYS, USER_A);
    expect(tong(r)).toBe(0);
  });

  it("★★ người 0 gán nhà máy + factoryId=A ⇒ 0 (bộ lọc không mở được cửa nào)", async () => {
    const r = await db.getDailyStats(facAId, undefined, DAYS, USER_NONE);
    expect(tong(r)).toBe(0);
  });

  it("★★ người 0 gán nhà máy, KHÔNG truyền gì ⇒ vẫn 0", async () => {
    const r = await db.getDailyStats(undefined, undefined, DAYS, USER_NONE);
    expect(tong(r)).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — CHỐNG VÁ QUÁ TAY: không chặn nhầm admin, không chặn nhầm người CÓ gán", () => {
  it("★ admin KHÔNG truyền gì ⇒ thấy CẢ HAI nhà máy (≥5) và NHIỀU HƠN bản đã lọc", async () => {
    const all = tong(await db.getDailyStats(undefined, undefined, DAYS, ADMIN));
    const chiA = tong(await db.getDailyStats(facAId, undefined, DAYS, ADMIN));
    expect(all).toBeGreaterThanOrEqual(5);
    expect(all, "đột biến 'bỏ lọc' làm hai số này BẰNG NHAU").toBeGreaterThan(chiA);
  });

  it("★ người gán A + factoryId=A ⇒ ĐÚNG 3 (phần của mình vẫn nguyên vẹn)", async () => {
    const r = await db.getDailyStats(facAId, undefined, DAYS, USER_A);
    expect(tong(r)).toBe(3);
  });

  it("★ người gán A KHÔNG truyền gì ⇒ ĐÚNG 3 (phạm vi vẫn áp, hành vi cũ không hồi quy)", async () => {
    const r = await db.getDailyStats(undefined, undefined, DAYS, USER_A);
    expect(tong(r)).toBe(3);
  });

  it("★ lối đi VÔ DANH (không userId — REST máy-với-máy) + factoryId=A ⇒ vẫn 3", async () => {
    const r = await db.getDailyStats(facAId, undefined, DAYS);
    expect(tong(r)).toBe(3);
  });

  it("FPY/finalYield vẫn tính trên ĐÚNG tập đã lọc (A: 2 OK / 3 ⇒ 66.67)", async () => {
    const r = await db.getDailyStats(facAId, undefined, DAYS, ADMIN);
    const ok = r.reduce((s, x) => s + Number(x.okCount), 0);
    const ng = r.reduce((s, x) => s + Number(x.ngCount), 0);
    expect([ok, ng]).toEqual([2, 1]);
    // 3 serial phân biệt, 2 lượt đầu OK ⇒ FPY thật = 66.67 trên ngày duy nhất có dữ liệu.
    const hom = r.find((x) => Number(x.totalProducts) === 3);
    expect(hom?.fpy).toBeCloseTo(66.67, 1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠ GIỚI HẠN TRUNG THỰC CỦA §4 — ĐỌC TRƯỚC KHI TIN NÓ.
 *
 * §4 đo nhãn trên **giá trị trả về của hàm CSDL**, và ở tầng đó nhãn có thật. Nhưng `getDailyStats`
 * trả `ScopedRows<T>` = **một MẢNG** có ba ô nhãn gắn thêm, mà superjson serialise mảng thành mảng
 * JSON ⇒ **ba ô nhãn RƠI MẤT trên đường dây**. Đo bằng HTTP thật ngày 2026-08-18, `supervisor1`
 * (0 gán nhà máy) gọi `dashboard.getDailyStats`:
 *
 *     {"result":{"data":{"json":[]}}}      ← đúng 0 hàng, nhưng KHÔNG một chữ lý do nào
 *
 * ⇒ Đây là nợ CÓ SẴN, chung cho MỌI bề mặt phạm vi hình dạng-mảng (`getDailyStats`,
 * `getHourlyStats`, `getNGTrendByDay…`, `getGalleryImages`, …), **không phải** thứ bản vá này gây
 * ra và **không** nằm trong uỷ nhiệm của nó. Ghi ra đây để §4 không bị đọc thành *"người dùng thấy
 * lý do"* — nó chỉ nói *"hàm CSDL phát ra lý do"*. `Reports.tsx` đã phải đi vòng đúng vì lỗ này:
 * nó lấy lý do rỗng của cả trang từ `getTopBottomMachines` (hình dạng ĐỐI TƯỢNG nên nhãn sống sót).
 */
describe("§4 — NHÃN trung thực + đáp ứng KHÔNG VÒNG", () => {
  it("★ số 0 của người 0 gán KÈM LÝ DO, và câu chữ nói về GÁN NHÀ MÁY", async () => {
    const r = await db.getDailyStats(facAId, undefined, DAYS, USER_NONE);
    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
    expect(r.scopeMessage).toMatch(/gán nhà máy/i);
    // Đột biến "đổi câu thành không-có-dữ-liệu" ⇒ ĐỎ (kể cả ở vế phủ định).
    expect(r.scopeMessage ?? "").not.toMatch(/không có dữ liệu|chưa có sản lượng|không tìm thấy kết quả/i);
  });

  it("★ người CÓ gán KHÔNG bị dán nhãn chưa-gán, kể cả khi bộ lọc nhà máy làm rỗng kết quả", async () => {
    const r = await db.getDailyStats(facBId, undefined, DAYS, USER_A);
    expect(tong(r)).toBe(0);
    // Rỗng vì NGƯỜI DÙNG chọn một nhà máy ngoài phạm vi — KHÔNG phải vì chưa được gán.
    expect(r.scopeEmptyReason).toBeNull();
    expect(r.scopeMessage).toBeNull();
    expect(r.scopeApplied).toBe(true);
  });

  it("★ đáp ứng serialise được và KHÔNG mang ô `filter` (đột biến `{...scope}` ⇒ ĐỎ)", async () => {
    const r = await db.getDailyStats(facAId, undefined, DAYS, USER_A);
    expect(() => superjson.stringify(r)).not.toThrow();
    // ⚠ KHÔNG viết `expect(r.filter).toBeUndefined()`: `ScopedRows<T>` LÀ một mảng, nên `r.filter`
    // luôn là `Array.prototype.filter` và ca sẽ đỏ vĩnh viễn vì lý do KHÔNG liên quan. Thứ cần
    // canh là **ô của chính đối tượng**, tức thứ mà `{...scope}` sẽ nhét vào.
    expect(Object.prototype.hasOwnProperty.call(r, "filter")).toBe(false);
  });
});
