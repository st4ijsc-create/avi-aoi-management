/**
 * CỔNG CSDL THẬT — PH-45/PH-48: **BA TRUY VẤN TRẠNG THÁI NHẬN DANH SÁCH MÃ NHÀ MÁY**.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ KẾT CỤC ĐANG VÁ, ĐO ĐƯỢC TRƯỚC KHI VIẾT DÒNG NÀO
 * ══════════════════════════════════════════════════════════════════════════════
 * Sau Task 19/20 cảnh cấp Tập đoàn NẠP cả ba nhà máy QATD (**1.108 máy**), nhưng ba
 * trong bốn truy vấn của `useTrangThaiSong` vẫn hỏi **đúng một** `factoryId`:
 *
 *     factoryCommand.overview   ({ factoryId })   ← factoryCommandRouter.ts:50
 *     twinCanh.anToanRobot      ({ factoryId })   ← twinCanhRouter.ts:1219
 *     twinCanh.sucKhoeMay       ({ factoryId })   ← twinCanhRouter.ts:1305
 *
 * Hệ quả đã đo trên trình duyệt thật (`.qa-tapdoan/t21-sau.json`, vai `qatd_giamdoc`):
 *   · **PH-45** — 737/1.108 máy được VẼ ĐÚNG CHỖ mà **không có lời khai trạng thái**
 *     ⇒ màu "chưa rõ". 737 khối xám không lời giải thích bị đọc là 737 máy hỏng.
 *   · **PH-48** — thẻ `Metrics` in **371 machines** (một nhà máy) trong khi `dem-may`
 *     và cảnh nói về **1.108** (ba nhà máy).
 *
 * ⇒ MỘT gốc, hai triệu chứng. Mở ba thủ tục nhận DANH SÁCH thì cả hai đóng cùng lúc.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ CÙNG KHUÔN TASK 18 (`40f04457`), KHÔNG PHẢI KHUÔN THỨ HAI
 * ══════════════════════════════════════════════════════════════════════════════
 * `twinCanh.canhThietKe` đã mở theo đúng bài này, và lưới của nó
 * (`canhNhieuNhaMayPhamVi.db.test.ts`) đặt tên cho ba điều phải giữ. Lưới NÀY đo
 * đúng ba điều ấy trên ba thủ tục mới:
 *
 *   **BB-1 (LỌC TỪNG MÃ)** — tập phục vụ = `factoryIds ∩ phamVi(người gọi)`, giao
 *     TỪNG PHẦN TỬ. Không có đường nào để "có ít nhất một mã hợp lệ" kéo cả danh
 *     sách qua cổng.
 *   **BB-2 (IM LẶNG BỎ)** — mã ngoài phạm vi rơi khỏi danh sách, trả `200` với phần
 *     còn lại. Không `FORBIDDEN`, không thông điệp nêu đích danh, không ô đếm.
 *     Phát biểu mạnh nhất: `[A,B]` và `[A]` cho phản hồi **giống hệt từng byte**.
 *   **BB-3 (TOÀN NGOÀI ⇒ RỖNG, KHÔNG RÒ TÊN)** — không mã/tên nhà máy nào bị loại
 *     có đường ra trong chuỗi phản hồi.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ MỘT CHỖ LỆCH KHUÔN, VÀ NÓ ĐƯỢC GHIM RIÊNG — `overview` KHÔNG ĐÒI "ĐÚNG MỘT"
 * ══════════════════════════════════════════════════════════════════════════════
 * `canhThietKe` đòi **ĐÚNG MỘT** trong `factoryId`/`factoryIds` (vắng cả hai ⇒
 * `BAD_REQUEST`). Ba thủ tục ở đây KHÔNG đồng dạng, và sự khác nhau ấy là **hợp
 * đồng cũ còn sống**, không phải một lối tắt:
 *
 *   · `anToanRobot`/`sucKhoeMay` — `factoryId` vốn **BẮT BUỘC** (`z.number()` trần,
 *     không `.optional()`), nên "vắng cả hai" chưa bao giờ có nghĩa. ⇒ ĐÚNG MỘT.
 *   · `overview` — `input` vốn `.optional()` và `factoryId` cũng `.optional()`, và
 *     **`FactoryCommandView.tsx:232` GỌI KHÔNG MÃ THẬT** (`{ factoryId: undefined }`
 *     khi chưa chọn bộ lọc) với nghĩa *"mọi nhà máy trong phạm vi"*. Ép "đúng một"
 *     ở đây là **đổi hành vi của một màn khác** để cho gọn một bộ luật. ⇒ luật là
 *     **KHÔNG ĐƯỢC KHAI CẢ HAI**; vắng cả hai giữ nguyên nghĩa cũ.
 *
 * ⚠ Nửa nguy hiểm của ngoại lệ ấy được ghim bằng ô riêng: "vắng cả hai ⇒ vẫn lọc
 *   theo phạm vi", để "mọi nhà máy" không bao giờ trượt thành "mọi nhà máy CÓ THẬT".
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI PHÉP ĐO PHẢI CÓ, KHÔNG PHẢI MỘT
 * ══════════════════════════════════════════════════════════════════════════════
 *   (A) HÀNG RÀO — hai chiều. Chiều (−) ngoài phạm vi KHÔNG thấy; chiều (+) trong
 *       phạm vi VẪN thấy đủ. Thiếu chiều (+) thì `return rỗng` vô điều kiện xanh hết.
 *   (B) CHI PHÍ — số câu SQL đếm bằng **bộ đếm CỦA SẢN PHẨM** (`getQueryStats`),
 *       làm nóng trước. Bất biến: **3 nhà máy ≤ 1 nhà máy + một hằng nhỏ**. Đây là
 *       thứ phân biệt "gộp thật" với "lặp ba lượt giấu trong một thủ tục" — và bản
 *       lặp ba lượt ấy qua được MỌI ô hàng rào ở trên.
 *
 * ⚠ MỌI ô (−) đều xanh nếu dữ kiện nền rỗng. Nên mỗi ô (−) có một ô ĐỐI CHỨNG
 *   "BIẾT KÊU" đi kèm: CHÍNH tập dữ liệu ấy phải đọc được qua một lối khác (admin
 *   hoặc người được gán cả ba). Không có nó thì lưới đo "không ai phát sóng" (G22).
 *
 * ★ G22 — `vitest.setup.ts` ép `DATABASE_URL` sang `aoi_management_test`, nơi KHÔNG
 *   có dữ liệu QATD. Lưới TỰ DỰNG: 3 nhà máy đủ chuỗi `workshop → line → station →
 *   machine` + robot + lời khai sức khoẻ, 4 người dùng, rồi xoá đúng chừng ấy theo id.
 * ★ G20 — import CHÍNH `appRouter` của module giao hàng, gọi qua `createCaller`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { appRouter } from "../routers";
import { resolvePermissionModule } from "@shared/permissions";
import { getQueryStats } from "../queryMonitor";

const DB_URL = process.env.DATABASE_URL;

/** Hậu tố duy nhất cho mọi hàng lưới này tạo — để xoá lại đúng chừng ấy. */
const DAU = `PH45-${Date.now()}`;

/** Vai KHÔNG phải admin — admin BYPASS cổng, đo bằng admin chứng minh số 0 vô nghĩa. */
const VAI = "engineer";

/**
 * BA con số MÁY rời nhau — và ba con số ROBOT cũng rời nhau, độc lập với chúng.
 *
 * ⚠ Nếu ba nhà máy cùng số máy thì một bản vá trả nhầm nhà máy vẫn cho ĐÚNG số
 *   lượng và mọi ô đếm xanh. Ba con số rời nhau biến "đếm" thành phép NHẬN DẠNG:
 *     máy   2 ⇒ chỉ A · 5 ⇒ A+B · 9 ⇒ cả ba
 *     robot 1 ⇒ chỉ A · 3 ⇒ A+B · 7 ⇒ cả ba
 *   Hai trục rời nhau còn bắt được bản vá "đúng máy nhưng sai robot" — một nhầm
 *   lẫn có thật khi hai thủ tục dùng chung một hàm tra cây.
 */
const SO_MAY = { A: 2, B: 3, C: 4 } as const;
const SO_ROBOT = { A: 1, B: 2, C: 4 } as const;

/** Trần đầu vào ghim ở router — CÙNG con số Task 18 (§6.2 thiết kế). */
const TRAN_NHA_MAY = 8;

let sql: ReturnType<typeof postgres>;

interface NhaMay {
  ma: string;
  ten: string;
  factoryId: number;
  workshopId: number;
  lineId: number;
  tramId: number;
  mayIds: number[];
  robotIds: number[];
}

interface Fixture {
  A: NhaMay;
  B: NhaMay;
  C: NhaMay;
  /** Được gán ĐÚNG MỘT nhà máy (A). */
  userAId: number;
  /** Được gán CẢ BA — vai "giám đốc" của kịch bản tập đoàn. */
  userABCId: number;
  /** 0 gán, ĐỦ quyền — (G43) chỉ khác `userAId` ở bản gán. */
  userKhongGanId: number;
  /** role admin — phạm vi `null`, không thêm mệnh đề nào. */
  userAdminId: number;
}
let fx: Fixture | null = null;

const id1 = (r: unknown): number => (r as Array<{ id: number }>)[0].id;

async function taoNhaMay(nhan: "A" | "B" | "C", soMay: number, soRobot: number): Promise<NhaMay> {
  const ma = `${DAU}-${nhan}`;
  const ten = `${ma} nha may`;
  const factoryId = id1(
    await sql`INSERT INTO factories (code, name) VALUES (${ma}, ${ten}) RETURNING id`,
  );
  const workshopId = id1(await sql`
    INSERT INTO workshops ("factoryId", code, name)
    VALUES (${factoryId}, ${`${ma}-W`}, ${`${ma} xuong`}) RETURNING id`);
  const lineId = id1(await sql`
    INSERT INTO production_lines ("workshopId", code, name)
    VALUES (${workshopId}, ${`${ma}-L`}, ${`${ma} chuyen`}) RETURNING id`);
  const tramId = id1(await sql`
    INSERT INTO stations ("lineId", code, name)
    VALUES (${lineId}, ${`${ma}-S`}, ${`${ma} tram`}) RETURNING id`);

  // ⚠ CHÈN THEO LÔ — xem ghi chú cùng tên ở `canhNhieuNhaMayPhamVi.db.test.ts`:
  //   ~50 lượt chèn tuần tự trong `beforeAll` đã từng làm cổng `phamVi` đỏ chập chờn.
  const mayRows = Array.from({ length: soMay }, (_, i) => ({
    stationId: tramId,
    code: `${ma}-M${i + 1}`,
    name: `${ma} may ${i + 1}`,
    machineType: "AOI",
  }));
  const mayIds = (
    (await sql`
      INSERT INTO machines ${sql(mayRows, "stationId", "code", "name", "machineType")}
      RETURNING id`) as unknown as Array<{ id: number }>
  ).map((r) => r.id);

  /*
   * ★ MỘT lời khai sức khoẻ cho MỖI máy ⇒ `sucKhoeMay.tong` = số máy của nhà máy.
   *   Nếu để bảng rỗng thì mọi ô (−) của `sucKhoeMay` xanh vì "không ai phát
   *   sóng" chứ không vì hàng rào (G5/G22).
   */
  const skRows = mayIds.map((mid, i) => ({
    machineId: mid,
    machineCode: `${ma}-M${i + 1}`,
    timestamp: new Date(Date.now() - 60_000),
    healthScore: 70 + i,
    oeeScore: 60,
    uptimeScore: 60,
    errorRateScore: 60,
    cycleTimeScore: 60,
    predictedFailureRisk: 10 + i,
  }));
  await sql`
    INSERT INTO machine_health_history ${sql(
      skRows,
      "machineId",
      "machineCode",
      "timestamp",
      "healthScore",
      "oeeScore",
      "uptimeScore",
      "errorRateScore",
      "cycleTimeScore",
      "predictedFailureRisk",
    )}`;

  /*
   * ★ Robot neo vào nhà máy qua `lineId` (đúng hình dạng dữ liệu thật — xem
   *   docblock `traAnToanRobot`). `isEnabled` PHẢI `true`: hàm loại robot đã vô
   *   hiệu hoá, nên một fixture mặc định (`false`) cho mọi ô robot ra 0 — tập rỗng.
   */
  const robotRows = Array.from({ length: soRobot }, (_, i) => ({
    code: `${ma}-R${i + 1}`,
    name: `${ma} robot ${i + 1}`,
    vendor: "sim",
    endpoint: `sim://${ma}/${i + 1}`,
    isEnabled: true,
    status: "idle",
    lineId,
  }));
  const robotIds = (
    (await sql`
      INSERT INTO robots ${sql(robotRows, "code", "name", "vendor", "endpoint", "isEnabled", "status", "lineId")}
      RETURNING id`) as unknown as Array<{ id: number }>
  ).map((r) => r.id);

  return { ma, ten, factoryId, workshopId, lineId, tramId, mayIds, robotIds };
}

async function xoaNhaMay(nm: NhaMay): Promise<void> {
  await sql`DELETE FROM robot_telemetry WHERE "robotId" = ANY(${nm.robotIds})`;
  await sql`DELETE FROM robots WHERE id = ANY(${nm.robotIds})`;
  await sql`DELETE FROM machine_health_history WHERE "machineId" = ANY(${nm.mayIds})`;
  await sql`DELETE FROM machines WHERE id = ANY(${nm.mayIds})`;
  await sql`DELETE FROM stations WHERE id = ${nm.tramId}`;
  await sql`DELETE FROM production_lines WHERE id = ${nm.lineId}`;
  await sql`DELETE FROM workshops WHERE id = ${nm.workshopId}`;
  await sql`DELETE FROM factories WHERE id = ${nm.factoryId}`;
}

async function taoNguoi(ds: Array<{ nhan: string; role: string }>): Promise<number[]> {
  const rows = ds.map((d) => ({
    openId: `${DAU}-${d.nhan}`,
    username: `${DAU}-${d.nhan}`,
    name: `${DAU} ${d.nhan}`,
    role: d.role,
    isActive: true,
  }));
  const ra = (await sql`
    INSERT INTO users ${sql(rows, "openId", "username", "name", "role", "isActive")}
    RETURNING id, username`) as unknown as Array<{ id: number; username: string }>;
  return ds.map((d) => ra.find((r) => r.username === `${DAU}-${d.nhan}`)!.id);
}

/**
 * ★ G43 — ĐỦ quyền cho CẢ BA cổng đang đo, để ô (−) không xanh vì thiếu quyền:
 *     `factoryCommand.overview`  → `machine_status` (alias `machine_monitoring`)
 *     `twinCanh.anToanRobot`     → `quyenVanHanh` = `analytics_oee` HOẶC `machine_status`
 *     `twinCanh.sucKhoeMay`      → cùng cổng `quyenVanHanh`
 *   Ba người thử có quyền GIỐNG HỆT nhau; thứ DUY NHẤT phân biệt họ là bản gán.
 */
async function capDuQuyen(userIds: number[]): Promise<void> {
  const cap: Array<[string, string]> = [
    ["machine_monitoring", resolvePermissionModule("machine_monitoring")],
    ["analytics", "analytics_oee"],
    ["settings", "settings_factory"],
  ];
  for (const [category, moduleName] of cap) {
    await sql`
      INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport")
      SELECT u, ${category}::permissioncategoryenum, ${moduleName}, true, false, false, false, false
      FROM unnest(${userIds}::int[]) AS u`;
  }
}

type Caller = ReturnType<typeof appRouter.createCaller>;
const goiVoi = (userId: number, role: string = VAI): Caller =>
  appRouter.createCaller({ user: { id: userId, role, name: "probe" } } as never);

/* ─────────────────────────────────────────────────────────────────────────── */
/* Ba bộ gọi + hình dạng đọc                                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

interface OverviewRa {
  factories: Array<{ id: number; name: string; code: string }>;
  machines: Array<{ id: number; code: string; lineId: number }>;
  issues: Array<{ machineCode: string; ageMinutes: number }>;
}
interface RobotRa {
  robot: Array<{ id: number; ma: string; ten: string }>;
  bayGio: number;
  tong: number;
}
interface SucKhoeRa {
  khai: Array<{ machineId: number; ma: string }>;
  bayGio: number;
  tong: number;
  tongMayTrongPhamVi: number;
}

const ov = (c: Caller, i?: Record<string, unknown>): Promise<OverviewRa> =>
  c.factoryCommand.overview(i as never) as unknown as Promise<OverviewRa>;
const rb = (c: Caller, i: Record<string, unknown>): Promise<RobotRa> =>
  c.twinCanh.anToanRobot(i as never) as unknown as Promise<RobotRa>;
const sk = (c: Caller, i: Record<string, unknown>): Promise<SucKhoeRa> =>
  c.twinCanh.sucKhoeMay(i as never) as unknown as Promise<SucKhoeRa>;

async function thuLoi(p: Promise<unknown>): Promise<{ code: string; msg: string } | null> {
  try {
    await p;
    return null;
  } catch (e: unknown) {
    const err = e as { code?: string; cause?: { code?: string }; message?: string };
    return { code: err?.code ?? err?.cause?.code ?? "?", msg: String(err?.message ?? "").slice(0, 200) };
  }
}

/**
 * Gỡ ĐỒNG HỒ khỏi phản hồi trước khi so từng byte — và CHỈ đồng hồ.
 *
 * ⚠⚠ Đây là chỗ một phép so "giống hệt từng byte" dễ bị làm cho vô hại: gỡ quá tay
 *   thì hai phản hồi khác nhau vẫn bằng nhau. Nên (a) danh sách gỡ được VIẾT RA
 *   đích danh — `bayGio` (server tự đặt `Date.now()`), `ageMinutes` (tuổi tính từ
 *   `Date.now()`); (b) một ô riêng bên dưới đòi rằng phép gỡ này THẬT SỰ có gỡ gì
 *   đó, để nó không âm thầm thành hàm đồng nhất khi hợp đồng đổi tên trường.
 */
function boDongHo<T>(x: T): T {
  const s = JSON.stringify(x, (k, v) => (k === "bayGio" || k === "ageMinutes" ? undefined : v));
  return JSON.parse(s) as T;
}

/**
 * Đếm số câu SQL một lời gọi sinh ra, bằng bộ đếm CỦA SẢN PHẨM.
 *
 * ⚠ `lamNong` chạy TRƯỚC mốc đếm: `getUserAssignmentCodes` có bộ nhớ đệm TTL 30 s,
 *   nên lần gọi LẠNH tốn thêm câu và số đo nhảy tuỳ lúc.
 */
async function demCau<T>(lamNong: () => Promise<unknown>, f: () => Promise<T>) {
  await lamNong();
  const truoc = getQueryStats().totalQueries;
  const kq = await f();
  return { soCau: getQueryStats().totalQueries - truoc, kq };
}

describe.skipIf(!DB_URL)("PH-45/PH-48 — ba truy vấn trạng thái nhận DANH SÁCH mã nhà máy", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const A = await taoNhaMay("A", SO_MAY.A, SO_ROBOT.A);
    const B = await taoNhaMay("B", SO_MAY.B, SO_ROBOT.B);
    const C = await taoNhaMay("C", SO_MAY.C, SO_ROBOT.C);

    const [userAId, userABCId, userKhongGanId, userAdminId] = await taoNguoi([
      { nhan: "nguoi-gan-A", role: VAI },
      { nhan: "nguoi-gan-ABC", role: VAI },
      { nhan: "nguoi-khong-gan", role: VAI },
      { nhan: "nguoi-admin", role: "admin" },
    ]);
    await capDuQuyen([userAId, userABCId, userKhongGanId]);

    const ganRows = [
      { userId: userAId, factoryCode: A.ma },
      ...[A, B, C].map((nm) => ({ userId: userABCId, factoryCode: nm.ma })),
    ];
    await sql`INSERT INTO user_factory_assignments ${sql(ganRows, "userId", "factoryCode")}`;

    fx = { A, B, C, userAId, userABCId, userKhongGanId, userAdminId };
  }, 180_000);

  afterAll(async () => {
    if (fx) {
      await sql`DELETE FROM user_factory_assignments WHERE "userId" = ANY(${[fx.userAId, fx.userABCId]})`;
      await sql`DELETE FROM permissions WHERE "userId" = ANY(${[fx.userAId, fx.userABCId, fx.userKhongGanId]})`;
      await sql`DELETE FROM users WHERE id = ANY(${[fx.userAId, fx.userABCId, fx.userKhongGanId, fx.userAdminId]})`;
      for (const nm of [fx.A, fx.B, fx.C]) await xoaNhaMay(nm);
    }
    await sql.end({ timeout: 5 });
  }, 120_000);

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* (0) DỮ KIỆN NỀN + THIẾT BỊ ĐO — không có nó, mọi ô (−) tự thoả trên tập rỗng */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it("dữ kiện nền DỰNG ĐƯỢC THẬT — 3 nhà máy, 2/3/4 máy, 1/2/4 robot, 9 lời khai sức khoẻ", async () => {
    expect(fx).not.toBeNull();
    expect(fx!.A.mayIds).toHaveLength(SO_MAY.A);
    expect(fx!.B.mayIds).toHaveLength(SO_MAY.B);
    expect(fx!.C.mayIds).toHaveLength(SO_MAY.C);
    expect(fx!.A.robotIds).toHaveLength(SO_ROBOT.A);
    expect(fx!.B.robotIds).toHaveLength(SO_ROBOT.B);
    expect(fx!.C.robotIds).toHaveLength(SO_ROBOT.C);
    expect(new Set([fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId]).size).toBe(3);
    const moiMay = [...fx!.A.mayIds, ...fx!.B.mayIds, ...fx!.C.mayIds];
    const n = (
      (await sql`SELECT count(*)::int AS n FROM machine_health_history WHERE "machineId" = ANY(${moiMay})`) as unknown as Array<{
        n: number;
      }>
    )[0].n;
    expect(n).toBe(SO_MAY.A + SO_MAY.B + SO_MAY.C);
  });

  it("★★★ ĐỐI CHỨNG DANH TÍNH — ba người thử khác nhau ĐÚNG ở bản gán, không ở quyền", async () => {
    const g = async (u: number) =>
      (
        (await sql`SELECT "factoryCode" FROM user_factory_assignments WHERE "userId" = ${u} ORDER BY "factoryCode"`) as unknown as Array<{
          factoryCode: string;
        }>
      ).map((r) => r.factoryCode);
    expect(await g(fx!.userAId)).toEqual([fx!.A.ma]);
    expect(await g(fx!.userABCId)).toEqual([fx!.A.ma, fx!.B.ma, fx!.C.ma].sort());
    expect(await g(fx!.userKhongGanId)).toEqual([]);
    const q = async (u: number) =>
      ((await sql`SELECT count(*)::int AS n FROM permissions WHERE "userId" = ${u}`) as unknown as Array<{ n: number }>)[0].n;
    expect(await q(fx!.userAId)).toBe(await q(fx!.userKhongGanId));
  });

  it("★★★ THIẾT BỊ ĐO TỰ CANH — `boDongHo` THẬT SỰ gỡ `bayGio`, không phải hàm đồng nhất", () => {
    // Nếu hợp đồng đổi tên trường đồng hồ, phép so "từng byte" dưới đây sẽ so cả
    // đồng hồ và đỏ chập chờn — hoặc tệ hơn, `boDongHo` thành no-op và phép so
    // trở nên chặt hơn mức nó tự khai. Ô này bắt cả hai chiều.
    const mau = { bayGio: 1, tong: 2, issues: [{ ageMinutes: 9, kind: "x" }] };
    expect(boDongHo(mau)).toEqual({ tong: 2, issues: [{ kind: "x" }] });
    expect(JSON.stringify(boDongHo(mau))).not.toBe(JSON.stringify(mau));
  });

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* BB-1 — LỌC TỪNG MÃ (ba thủ tục, mỗi thủ tục hai chiều)                       */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it("★★★ BB-1 (overview) — người gán A xin [A,B] ⇒ CHỈ máy của A, và ĐỦ máy của A", async () => {
    const kq = await ov(goiVoi(fx!.userAId), { factoryIds: [fx!.A.factoryId, fx!.B.factoryId] });
    expect(kq.machines).toHaveLength(SO_MAY.A);
    expect(kq.machines.every((m) => m.code.startsWith(`${fx!.A.ma}-`))).toBe(true);
  });

  it("★★★ BB-1 BIẾT KÊU (overview) — CHÍNH [A,B] ấy cho 5 máy khi người gọi có cả hai", async () => {
    const kq = await ov(goiVoi(fx!.userABCId), { factoryIds: [fx!.A.factoryId, fx!.B.factoryId] });
    expect(kq.machines).toHaveLength(SO_MAY.A + SO_MAY.B);
  });

  it("★★★ BB-1 (anToanRobot) — người gán A xin [A,B] ⇒ CHỈ robot của A", async () => {
    const kq = await rb(goiVoi(fx!.userAId), { factoryIds: [fx!.A.factoryId, fx!.B.factoryId] });
    expect(kq.robot).toHaveLength(SO_ROBOT.A);
    expect(kq.tong).toBe(SO_ROBOT.A);
    expect(kq.robot.every((r) => r.ma.startsWith(`${fx!.A.ma}-`))).toBe(true);
  });

  it("★★★ BB-1 BIẾT KÊU (anToanRobot) — CHÍNH [A,B] ấy cho 3 robot khi người gọi có cả hai", async () => {
    const kq = await rb(goiVoi(fx!.userABCId), { factoryIds: [fx!.A.factoryId, fx!.B.factoryId] });
    expect(kq.robot).toHaveLength(SO_ROBOT.A + SO_ROBOT.B);
  });

  it("★★★ BB-1 (sucKhoeMay) — người gán A xin [A,B] ⇒ CHỈ lời khai của A", async () => {
    const kq = await sk(goiVoi(fx!.userAId), { factoryIds: [fx!.A.factoryId, fx!.B.factoryId] });
    expect(kq.khai).toHaveLength(SO_MAY.A);
    expect(kq.tongMayTrongPhamVi).toBe(SO_MAY.A);
    expect(kq.khai.every((k) => k.ma.startsWith(`${fx!.A.ma}-`))).toBe(true);
  });

  it("★★★ BB-1 BIẾT KÊU (sucKhoeMay) — CHÍNH [A,B] ấy cho 5 lời khai khi người gọi có cả hai", async () => {
    const kq = await sk(goiVoi(fx!.userABCId), { factoryIds: [fx!.A.factoryId, fx!.B.factoryId] });
    expect(kq.khai).toHaveLength(SO_MAY.A + SO_MAY.B);
    expect(kq.tongMayTrongPhamVi).toBe(SO_MAY.A + SO_MAY.B);
  });

  it("★★★ BB-1 — KHÔNG có 'một mã hợp lệ kéo cả danh sách': [A,B,C] của người gán A", async () => {
    const c = goiVoi(fx!.userAId);
    const ba = [fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId];
    expect((await ov(c, { factoryIds: ba })).machines).toHaveLength(SO_MAY.A);
    expect((await rb(c, { factoryIds: ba })).robot).toHaveLength(SO_ROBOT.A);
    expect((await sk(c, { factoryIds: ba })).khai).toHaveLength(SO_MAY.A);
  });

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* BB-2 — IM LẶNG BỎ: [A,B] ≡ [A] TỪNG BYTE                                     */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it("★★★ BB-2 — [A,B] và [A] cho phản hồi GIỐNG HỆT TỪNG BYTE ở CẢ BA thủ tục", async () => {
    const c = goiVoi(fx!.userAId);
    const A = fx!.A.factoryId;
    const AB = [fx!.A.factoryId, fx!.B.factoryId];
    expect(JSON.stringify(boDongHo(await ov(c, { factoryIds: AB })))).toBe(
      JSON.stringify(boDongHo(await ov(c, { factoryIds: [A] }))),
    );
    expect(JSON.stringify(boDongHo(await rb(c, { factoryIds: AB })))).toBe(
      JSON.stringify(boDongHo(await rb(c, { factoryIds: [A] }))),
    );
    expect(JSON.stringify(boDongHo(await sk(c, { factoryIds: AB })))).toBe(
      JSON.stringify(boDongHo(await sk(c, { factoryIds: [A] }))),
    );
  });

  it("★★★ BB-2 — 200 chứ KHÔNG phải FORBIDDEN/NOT_FOUND khi danh sách có mã ngoài", async () => {
    const c = goiVoi(fx!.userAId);
    const AC = [fx!.A.factoryId, fx!.C.factoryId];
    expect(await thuLoi(ov(c, { factoryIds: AC }))).toBeNull();
    expect(await thuLoi(rb(c, { factoryIds: AC }))).toBeNull();
    expect(await thuLoi(sk(c, { factoryIds: AC }))).toBeNull();
  });

  it("★★★ BB-2 — phản hồi KHÔNG mang ô đếm 'đã bỏ N mã' nào", async () => {
    /*
     * Một bộ đếm tử tế cũng là một oracle tồn-tại: "đã bỏ 1" nói cho người gọi
     * biết đúng một trong hai mã họ hỏi là có thật (G82).
     *
     * ════════════════════════════════════════════════════════════════════════
     * ★★★ SỬA THIẾT BỊ ĐO — ĐỌC SỐ CŨ, ĐỌC SỐ MỚI, NÓI RA (luật "không đổi thước")
     * ════════════════════════════════════════════════════════════════════════
     * Bản đầu của ô này chép nguyên phép đo của `canhNhieuNhaMayPhamVi.db.test.ts`
     * (`k.includes("bo")` trên tên khoá đã hạ chữ thường). Ở đó nó đúng vì năm khoá
     * của `canhThietKe` là `xuong/chuyen/tram/may/datCho/vung`. Ở ĐÂY nó ĐỎ, và lý
     * do là một **va chạm chuỗi con**, không phải một lời khai của sản phẩm:
     *
     *     ro**bo**t   ⊃ "bo"     ⇒ khoá hợp đồng thật bị báo là "ô đếm đã bỏ"
     *     ĐO ĐƯỢC:  cũ → `expected [ 'robot' ] to deeply equal []`  (ĐỎ)
     *               mới → `[]`                                      (XANH)
     *
     * ⇒ Thước đổi từ "chuỗi con bất kỳ" sang "TỪ đứng riêng trong tên khoá"
     *   (ranh giới camelCase / gạch dưới / đầu-cuối). Đây KHÔNG phải nới lỏng: mọi
     *   tên có thật mà bất biến nhắm tới — `daBo`, `soBoQua`, `boQua`, `soLoai`,
     *   `skipped`, `denied` — vẫn bị bắt; thứ duy nhất thoát ra là chữ "bo" nằm
     *   GIỮA một từ khác. Ô đối chứng ngay dưới chứng minh thước mới BIẾT KÊU.
     */
    const laOBiBo = (khoa: string): boolean => {
      // Tách tên khoá thành TỪ theo ranh giới camelCase / gạch dưới, rồi hỏi từng
      // từ — chứ không quét chuỗi con trên cả tên. `robot` là MỘT từ và nó không
      // bắt đầu bằng "bo"; `daBo`/`soBoQua` có một từ ĐÚNG là "bo".
      const tu = khoa.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[_\W]+/).filter(Boolean);
      return tu.some((w) =>
        ["bo", "loai", "skip", "drop", "denied", "reject", "ngoai"].some((t) => w.startsWith(t)),
      );
    };
    // ĐỐI CHỨNG DƯƠNG — thước phải KÊU trên những cái tên nó sinh ra để bắt.
    for (const xau of ["daBo", "soBoQua", "boQua", "soLoai", "skipped", "denied", "maNgoai"]) {
      expect(laOBiBo(xau), `thước mù với '${xau}'`).toBe(true);
    }
    // …và KHÔNG kêu trên khoá hợp đồng thật.
    for (const that of ["robot", "khai", "machines", "tong", "tongMayTrongPhamVi", "bayGio"]) {
      expect(laOBiBo(that), `thước kêu oan với '${that}'`).toBe(false);
    }

    const AB = [fx!.A.factoryId, fx!.B.factoryId];
    for (const kq of [
      (await ov(goiVoi(fx!.userAId), { factoryIds: AB })) as unknown as Record<string, unknown>,
      (await rb(goiVoi(fx!.userAId), { factoryIds: AB })) as unknown as Record<string, unknown>,
      (await sk(goiVoi(fx!.userAId), { factoryIds: AB })) as unknown as Record<string, unknown>,
    ]) {
      expect(Object.keys(kq).filter(laOBiBo)).toEqual([]);
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* BB-3 — TOÀN NGOÀI ⇒ RỖNG, KHÔNG RÒ TÊN                                       */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it("★★★ BB-3 — người gán A xin [B,C] ⇒ RỖNG ở cả ba, không lỗi, KHÔNG rò mã/tên", async () => {
    const c = goiVoi(fx!.userAId);
    const BC = [fx!.B.factoryId, fx!.C.factoryId];
    const kqOv = await ov(c, { factoryIds: BC });
    const kqRb = await rb(c, { factoryIds: BC });
    const kqSk = await sk(c, { factoryIds: BC });
    expect(kqOv.machines).toHaveLength(0);
    expect(kqOv.factories).toHaveLength(0);
    expect(kqRb.robot).toHaveLength(0);
    expect(kqSk.khai).toHaveLength(0);
    expect(kqSk.tongMayTrongPhamVi).toBe(0);
    for (const kq of [kqOv, kqRb, kqSk]) {
      const chuoi = JSON.stringify(kq);
      for (const nm of [fx!.B, fx!.C]) {
        expect(chuoi).not.toContain(nm.ma);
        expect(chuoi).not.toContain(nm.ten);
      }
    }
  });

  it("★★★ BB-3 BIẾT KÊU — CHÍNH [B,C] ấy CÓ dữ liệu và CÓ mã B/C khi admin hỏi", async () => {
    const c = goiVoi(fx!.userAdminId, "admin");
    const BC = [fx!.B.factoryId, fx!.C.factoryId];
    const kqOv = await ov(c, { factoryIds: BC });
    expect(kqOv.machines).toHaveLength(SO_MAY.B + SO_MAY.C);
    expect(JSON.stringify(kqOv)).toContain(fx!.B.ma);
    expect((await rb(c, { factoryIds: BC })).robot).toHaveLength(SO_ROBOT.B + SO_ROBOT.C);
    expect((await sk(c, { factoryIds: BC })).khai).toHaveLength(SO_MAY.B + SO_MAY.C);
  });

  it("★★★ BB-3 — 0 gán xin [A,B,C] ⇒ RỖNG (`[]` là phạm vi rỗng TƯỜNG MINH)", async () => {
    const c = goiVoi(fx!.userKhongGanId);
    const ba = [fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId];
    expect((await ov(c, { factoryIds: ba })).machines).toHaveLength(0);
    expect((await rb(c, { factoryIds: ba })).robot).toHaveLength(0);
    expect((await sk(c, { factoryIds: ba })).khai).toHaveLength(0);
  });

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* ĐỐI CHỨNG DƯƠNG — KẾT CỤC PH-45: BA NHÀ MÁY, BA LỜI KHAI ĐẦY ĐỦ             */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it("★★★ PH-45 (kết cục) — người gán CẢ BA xin [A,B,C] ⇒ ĐỦ 9 máy · 7 robot · 9 lời khai", async () => {
    /*
     * Đây là ô mang chính KẾT CỤC của phiếu: trước bản vá, ba thủ tục nhận đúng
     * MỘT mã nên con số lớn nhất chúng trả được là của MỘT nhà máy (2 · 1 · 2).
     * Ba con số rời nhau ở đây biến "đếm" thành phép NHẬN DẠNG ba nhà máy.
     */
    const c = goiVoi(fx!.userABCId);
    const ba = [fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId];
    const kqOv = await ov(c, { factoryIds: ba });
    const kqRb = await rb(c, { factoryIds: ba });
    const kqSk = await sk(c, { factoryIds: ba });
    expect(kqOv.machines).toHaveLength(SO_MAY.A + SO_MAY.B + SO_MAY.C);
    expect(kqRb.robot).toHaveLength(SO_ROBOT.A + SO_ROBOT.B + SO_ROBOT.C);
    expect(kqSk.khai).toHaveLength(SO_MAY.A + SO_MAY.B + SO_MAY.C);
    expect(kqSk.tongMayTrongPhamVi).toBe(SO_MAY.A + SO_MAY.B + SO_MAY.C);
    // …và ĐỦ BA nhà máy có mặt, không phải 9 máy của một nhà máy nào đó.
    const ma = new Set(kqOv.machines.map((m) => m.code.split("-M")[0]));
    expect(ma).toEqual(new Set([fx!.A.ma, fx!.B.ma, fx!.C.ma]));
  });

  it("★★★ PH-48 (kết cục) — MẪU SỐ của `overview` bằng tập cảnh đang vẽ, không phải một nhà máy", async () => {
    /*
     * Thẻ `Metrics` lấy mẫu số từ `overview.machines` giao với tập id cảnh vẽ
     * (`locKpiTheoCanh`). Khi cảnh vẽ cả ba nhà máy mà `overview` chỉ trả một, giao
     * hai tập = một nhà máy — đúng "371 machines" của ảnh. Ô này ghim vế SERVER của
     * phép giao ấy: tập `overview` trả về PHẢI phủ được tập máy của cả ba nhà máy.
     */
    const c = goiVoi(fx!.userABCId);
    const ba = [fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId];
    const idOverview = new Set((await ov(c, { factoryIds: ba })).machines.map((m) => m.id));
    const idCanh = [...fx!.A.mayIds, ...fx!.B.mayIds, ...fx!.C.mayIds];
    const giao = idCanh.filter((id) => idOverview.has(id));
    expect(giao).toHaveLength(idCanh.length);
  });

  it("★★★ (L6) THU HẸP TỰ NGUYỆN — người có cả ba xin ĐÚNG [B] ⇒ chỉ B", async () => {
    // "Anh có quyền cả ba nên trả cả ba" là lỗi khác hướng: không rò tenant, nhưng
    // vẽ một cảnh KHÁC cảnh người dùng vừa chọn.
    const c = goiVoi(fx!.userABCId);
    expect((await ov(c, { factoryIds: [fx!.B.factoryId] })).machines).toHaveLength(SO_MAY.B);
    expect((await rb(c, { factoryIds: [fx!.B.factoryId] })).robot).toHaveLength(SO_ROBOT.B);
    expect((await sk(c, { factoryIds: [fx!.B.factoryId] })).khai).toHaveLength(SO_MAY.B);
  });

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* TƯƠNG THÍCH NGƯỢC — ĐƯỜNG MỘT MÃ GIỮ NGUYÊN TỪNG BYTE                       */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it("★★★ ĐƯỜNG CŨ — `factoryId: A` ≡ `factoryIds: [A]` TỪNG BYTE ở cả ba thủ tục", async () => {
    const c = goiVoi(fx!.userAId);
    const A = fx!.A.factoryId;
    const cuOv = await ov(c, { factoryId: A });
    expect(cuOv.machines).toHaveLength(SO_MAY.A);
    expect(JSON.stringify(boDongHo(await ov(c, { factoryIds: [A] })))).toBe(JSON.stringify(boDongHo(cuOv)));

    const cuRb = await rb(c, { factoryId: A });
    expect(cuRb.robot).toHaveLength(SO_ROBOT.A);
    expect(JSON.stringify(boDongHo(await rb(c, { factoryIds: [A] })))).toBe(JSON.stringify(boDongHo(cuRb)));

    const cuSk = await sk(c, { factoryId: A });
    expect(cuSk.khai).toHaveLength(SO_MAY.A);
    expect(JSON.stringify(boDongHo(await sk(c, { factoryIds: [A] })))).toBe(JSON.stringify(boDongHo(cuSk)));
  });

  it("★★★ ĐƯỜNG CŨ vẫn giữ hàng rào — `factoryId: B` của người gán A ⇒ rỗng, không rò", async () => {
    const c = goiVoi(fx!.userAId);
    const B = fx!.B.factoryId;
    for (const kq of [await ov(c, { factoryId: B }), await rb(c, { factoryId: B }), await sk(c, { factoryId: B })]) {
      expect(JSON.stringify(kq)).not.toContain(fx!.B.ma);
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* HÌNH DẠNG ĐẦU VÀO — HAI Ô, KHÔNG BAO GIỜ CẢ HAI                              */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it("★★★ khai CẢ HAI ô ⇒ BAD_REQUEST ở CẢ BA (hai nguồn sự thật trong một đầu vào)", async () => {
    const c = goiVoi(fx!.userAdminId, "admin");
    const hai = { factoryId: fx!.A.factoryId, factoryIds: [fx!.B.factoryId] };
    expect((await thuLoi(ov(c, hai)))?.code).toBe("BAD_REQUEST");
    expect((await thuLoi(rb(c, hai)))?.code).toBe("BAD_REQUEST");
    expect((await thuLoi(sk(c, hai)))?.code).toBe("BAD_REQUEST");
  });

  it("★★★ `anToanRobot`/`sucKhoeMay`: vắng CẢ HAI ⇒ BAD_REQUEST (câu hỏi thiếu vế)", async () => {
    const c = goiVoi(fx!.userAdminId, "admin");
    expect((await thuLoi(rb(c, {})))?.code).toBe("BAD_REQUEST");
    expect((await thuLoi(sk(c, {})))?.code).toBe("BAD_REQUEST");
  });

  it("★★★ NGOẠI LỆ CÓ CHỦ Ý — `overview` vắng cả hai KHÔNG phải lỗi, và VẪN lọc phạm vi", async () => {
    /*
     * ⚠⚠ Đây là chỗ lưới này CỐ Ý khác `canhThietKe`, và nửa nguy hiểm của ngoại lệ
     *   được đo ngay trong cùng một ô: "mọi nhà máy" phải là *mọi nhà máy TRONG PHẠM
     *   VI*, không phải mọi nhà máy CÓ THẬT. `FactoryCommandView.tsx:232` gọi đúng
     *   hình dạng này khi chưa chọn bộ lọc, nên ép "đúng một" ở đây là đổi hành vi
     *   của một màn khác để cho gọn một bộ luật.
     */
    const kqA = await ov(goiVoi(fx!.userAId), {});
    expect(kqA.machines).toHaveLength(SO_MAY.A);
    expect(JSON.stringify(kqA)).not.toContain(fx!.B.ma);
    // …và người 0 gán vẫn RỖNG, không phải "không lọc".
    expect((await ov(goiVoi(fx!.userKhongGanId), {})).machines).toHaveLength(0);
    // …trong khi người gán cả ba thấy đủ chín máy qua CÙNG lối gọi ấy (biết kêu).
    const kqABC = await ov(goiVoi(fx!.userABCId), {});
    const maABC = new Set(
      kqABC.machines.filter((m) => m.code.startsWith(DAU)).map((m) => m.code.split("-M")[0]),
    );
    expect(maABC).toEqual(new Set([fx!.A.ma, fx!.B.ma, fx!.C.ma]));
  });

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* TRẦN AN TOÀN + RÁC                                                          */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it(`★★★ ${TRAN_NHA_MAY + 1} nhà máy ⇒ BAD_REQUEST ở cả ba; ĐÚNG ${TRAN_NHA_MAY} ⇒ CHẤP NHẬN`, async () => {
    const c = goiVoi(fx!.userAdminId, "admin");
    const qua = Array.from({ length: TRAN_NHA_MAY + 1 }, (_, i) => i + 1);
    expect((await thuLoi(ov(c, { factoryIds: qua })))?.code).toBe("BAD_REQUEST");
    expect((await thuLoi(rb(c, { factoryIds: qua })))?.code).toBe("BAD_REQUEST");
    expect((await thuLoi(sk(c, { factoryIds: qua })))?.code).toBe("BAD_REQUEST");

    const day = [
      fx!.A.factoryId,
      fx!.B.factoryId,
      fx!.C.factoryId,
      ...Array.from({ length: TRAN_NHA_MAY - 3 }, (_, i) => 2_000_000_001 + i),
    ];
    expect(day).toHaveLength(TRAN_NHA_MAY);
    expect((await ov(c, { factoryIds: day })).machines).toHaveLength(SO_MAY.A + SO_MAY.B + SO_MAY.C);
    expect((await rb(c, { factoryIds: day })).robot).toHaveLength(SO_ROBOT.A + SO_ROBOT.B + SO_ROBOT.C);
  });

  it("★★★ danh sách RỖNG ⇒ BAD_REQUEST, KHÔNG phải 'mọi nhà máy'", async () => {
    const c = goiVoi(fx!.userAdminId, "admin");
    expect((await thuLoi(ov(c, { factoryIds: [] })))?.code).toBe("BAD_REQUEST");
    expect((await thuLoi(rb(c, { factoryIds: [] })))?.code).toBe("BAD_REQUEST");
    expect((await thuLoi(sk(c, { factoryIds: [] })))?.code).toBe("BAD_REQUEST");
  });

  it("★★★ (L8) [A, A, id-không-tồn-tại] ⇒ A ĐÚNG MỘT LẦN, im lặng bỏ id lạ, không lỗi", async () => {
    const c = goiVoi(fx!.userAId);
    const ds = [fx!.A.factoryId, fx!.A.factoryId, 2_000_000_099];
    const kqOv = await ov(c, { factoryIds: ds });
    expect(kqOv.machines).toHaveLength(SO_MAY.A);
    expect(new Set(kqOv.machines.map((m) => m.id)).size).toBe(SO_MAY.A);
    expect((await rb(c, { factoryIds: ds })).robot).toHaveLength(SO_ROBOT.A);
    expect((await sk(c, { factoryIds: ds })).khai).toHaveLength(SO_MAY.A);
  });

  it("★★★ (L8) id ÂM / 0 bị Zod chặn ở biên của cả ba", async () => {
    const c = goiVoi(fx!.userAdminId, "admin");
    const rac = { factoryIds: [fx!.A.factoryId, -1] };
    expect((await thuLoi(ov(c, rac)))?.code).toBe("BAD_REQUEST");
    expect((await thuLoi(rb(c, rac)))?.code).toBe("BAD_REQUEST");
    expect((await thuLoi(sk(c, rac)))?.code).toBe("BAD_REQUEST");
  });

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* CHI PHÍ — bộ đếm CỦA SẢN PHẨM, và thiết bị đo phải BIẾT KÊU trước            */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it("★★★ BỘ ĐẾM BIẾT KÊU — ba lượt gọi ĐƯỜNG MỘT MÃ tốn ~3 lần một lượt danh sách", async () => {
    /*
     * "Trước" ở đây KHÔNG phải một con số nhớ lại: nó là ĐƯỜNG MỘT MÃ **vẫn còn
     * sống** trong sản phẩm, gọi ba lượt — đúng hình dạng mà bản "gộp bằng vòng
     * lặp" sẽ trả tiền. Đo cả hai trong CÙNG một lần chạy, cùng bộ đếm, cùng trạng
     * thái nóng. Ô này cũng chứng minh `getQueryStats` KHÔNG mù (luôn 0).
     */
    const c = goiVoi(fx!.userABCId);
    const ba = [fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId];
    const cu = await demCau(
      () => sk(c, { factoryId: fx!.A.factoryId }),
      async () => {
        const ra: SucKhoeRa[] = [];
        for (const f of ba) ra.push(await sk(c, { factoryId: f }));
        return ra;
      },
    );
    const moi = await demCau(
      () => sk(c, { factoryIds: ba }),
      () => sk(c, { factoryIds: ba }),
    );
    console.log(`[PH45] sucKhoeMay 3 nhà máy: 3 lượt MỘT MÃ = ${cu.soCau} câu · 1 lượt DANH SÁCH = ${moi.soCau} câu`);
    expect(cu.soCau).toBeGreaterThan(0);
    expect(cu.kq.reduce((n, k) => n + k.khai.length, 0)).toBe(SO_MAY.A + SO_MAY.B + SO_MAY.C);
    expect(moi.kq.khai).toHaveLength(SO_MAY.A + SO_MAY.B + SO_MAY.C);
    expect(moi.soCau).toBeLessThan(cu.soCau / 2);
  });

  it("★★★ SỐ CÂU KHÔNG TĂNG THEO SỐ NHÀ MÁY — `overview` và `sucKhoeMay`: 3 ≤ 1 + 1", async () => {
    /*
     * BẤT BIẾN, không phải ngưỡng. Một bản "gộp" bằng cách lặp ba lượt bên trong
     * thủ tục vẫn qua MỌI ô hàng rào ở trên và vỡ ĐÚNG ô này.
     */
    const c = goiVoi(fx!.userABCId);
    const A = [fx!.A.factoryId];
    const ba = [fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId];
    for (const [ten, goi, demRa] of [
      ["overview", (ids: number[]) => ov(c, { factoryIds: ids }), (k: unknown) => (k as OverviewRa).machines.length],
      ["sucKhoeMay", (ids: number[]) => sk(c, { factoryIds: ids }), (k: unknown) => (k as SucKhoeRa).khai.length],
    ] as const) {
      const mot = await demCau(() => goi(A), () => goi(A));
      const tatCa = await demCau(() => goi(ba), () => goi(ba));
      console.log(`[PH45] ${ten}: 1 nhà máy = ${mot.soCau} câu · 3 nhà máy = ${tatCa.soCau} câu`);
      // Ràng buộc KÍCH THƯỚC trước khi khẳng định chi phí — "0 hàng, 0 câu" cũng qua.
      expect(demRa(mot.kq), `${ten}: lượt 1 nhà máy rỗng`).toBeGreaterThan(0);
      expect(demRa(tatCa.kq), `${ten}: lượt 3 nhà máy không nhiều hơn`).toBeGreaterThan(demRa(mot.kq));
      expect(tatCa.soCau, `${ten}: số câu tăng theo số nhà máy`).toBeLessThanOrEqual(mot.soCau + 1);
    }
  });

  it("★★★ `anToanRobot` — chi phí tăng theo số ROBOT (Đợt 50), KHÔNG theo số NHÀ MÁY", async () => {
    /*
     * ════════════════════════════════════════════════════════════════════════
     * ★★★ ĐƠN VỊ CỦA CON SỐ (G9) — ĐỌC SỐ CŨ, ĐỌC SỐ MỚI, NÓI RA
     * ════════════════════════════════════════════════════════════════════════
     * Bản đầu của lưới này áp CÙNG một câu `3 nhà máy ≤ 1 nhà máy + 1` cho cả ba
     * thủ tục, và `anToanRobot` ĐỎ:
     *
     *     ĐO ĐƯỢC: 1 nhà máy (1 robot) = **10 câu** · 3 nhà máy (7 robot) = **16 câu**
     *     thước cũ: 16 ≤ 10 + 1  ⇒ ĐỎ
     *
     * Đọc lại mã trước khi đổi bất cứ thứ gì: `traAnToanRobot` phát **MỘT câu
     * `LIMIT 1` cho MỖI robot** (`db/twinCanh.ts` `BUOC_TELE`, Đợt 50 mục B —
     * `DISTINCT ON` cả bảng tốn 190–206 ms, `LIMIT 1`/robot tốn 0,9–16 ms). Đó là
     * hình dạng ĐANG PHỤC VỤ và nó có ở CẢ đường một nhà máy, không phải thứ bản
     * vá này sinh ra. 10 = 9 + 1 robot; 16 = 9 + 7 robot ⇒ **phần theo nhà máy là
     * hằng 9**, phần còn lại là hằng nhân SỐ ROBOT.
     *
     * ⇒ Thước cũ đo SAI ĐƠN VỊ. Thước mới trừ đi đúng phần mà sản phẩm tự khai là
     *   theo-robot, rồi hỏi lại CÙNG một câu về phần theo-nhà-máy:
     *
     *       (câu(3 nhà máy) − robot(3)) ≤ (câu(1 nhà máy) − robot(1)) + 1
     *
     * ★ Thước mới KHÔNG yếu hơn ở chỗ nó cần mạnh: một bản "gộp" bằng vòng lặp ba
     *   lượt tốn 3 × (5 cây + 1 robots) + 7 telemetry = 25 câu ⇒ 25 − 7 = 18 > 6 + 1
     *   ⇒ vẫn ĐỎ. Ô đối chứng ngay dưới đo chính khuôn lặp ấy để câu trên không
     *   phải là một lời hứa.
     */
    const c = goiVoi(fx!.userABCId);
    const A = [fx!.A.factoryId];
    const ba = [fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId];
    const mot = await demCau(() => rb(c, { factoryIds: A }), () => rb(c, { factoryIds: A }));
    const tatCa = await demCau(() => rb(c, { factoryIds: ba }), () => rb(c, { factoryIds: ba }));
    console.log(
      `[PH45] anToanRobot: 1 nhà máy = ${mot.soCau} câu / ${mot.kq.robot.length} robot · ` +
        `3 nhà máy = ${tatCa.soCau} câu / ${tatCa.kq.robot.length} robot`,
    );
    expect(mot.kq.robot).toHaveLength(SO_ROBOT.A);
    expect(tatCa.kq.robot).toHaveLength(SO_ROBOT.A + SO_ROBOT.B + SO_ROBOT.C);
    const nenMot = mot.soCau - mot.kq.robot.length;
    const nenBa = tatCa.soCau - tatCa.kq.robot.length;
    console.log(`[PH45] anToanRobot phần THEO NHÀ MÁY: 1 ⇒ ${nenMot} câu · 3 ⇒ ${nenBa} câu`);
    expect(nenBa, "phần chi phí theo NHÀ MÁY tăng — đường gộp đang lặp").toBeLessThanOrEqual(nenMot + 1);
  });

  it("★★★ ĐỐI CHỨNG — khuôn 'gộp bằng vòng lặp' VỠ thước mới của `anToanRobot`", async () => {
    /*
     * ⚠ Không có ô này, thước mới chỉ là một lời hứa. Ở đây khuôn lặp được dựng
     *   LẠI TẠI CHỖ bằng CHÍNH đường một mã còn sống trong sản phẩm, đo bằng CÙNG
     *   bộ đếm, rồi áp CÙNG công thức — và nó phải ĐỎ.
     */
    const c = goiVoi(fx!.userABCId);
    const ba = [fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId];
    const mot = await demCau(
      () => rb(c, { factoryIds: [fx!.A.factoryId] }),
      () => rb(c, { factoryIds: [fx!.A.factoryId] }),
    );
    const lap = await demCau(
      () => rb(c, { factoryId: fx!.A.factoryId }),
      async () => {
        const ra: RobotRa[] = [];
        for (const f of ba) ra.push(await rb(c, { factoryId: f }));
        return ra;
      },
    );
    const soRobotLap = lap.kq.reduce((n, k) => n + k.robot.length, 0);
    const nenLap = lap.soCau - soRobotLap;
    const nenMot = mot.soCau - mot.kq.robot.length;
    console.log(`[PH45] khuôn LẶP: ${lap.soCau} câu / ${soRobotLap} robot ⇒ nền ${nenLap} (mốc ${nenMot} + 1)`);
    expect(soRobotLap).toBe(SO_ROBOT.A + SO_ROBOT.B + SO_ROBOT.C);
    expect(nenLap, "thước mới KHÔNG bắt được khuôn lặp — nó quá dễ").toBeGreaterThan(nenMot + 1);
  });
});
