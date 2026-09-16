/**
 * CỔNG CSDL THẬT — Task 18: **`twinCanh.canhThietKe` NHẬN DANH SÁCH MÃ NHÀ MÁY**.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO LƯỚI NÀY LÀ PHẦN NGUY HIỂM NHẤT CỦA TASK 18
 * ══════════════════════════════════════════════════════════════════════════════
 * Cho tới trước bản vá, `canhThietKe` nhận ĐÚNG MỘT `factoryId` và hàng rào tenant
 * là **một** phép hỏi `trongPhamVi("factory", id, scope)`. Nới đầu vào thành một
 * DANH SÁCH đổi câu hỏi từ "id này có trong phạm vi không" thành "những id nào
 * trong danh sách này còn sống sót" — và mọi lối viết tắt ở chỗ ấy đều là một lỗ
 * tenant:
 *
 *     ✗ `if (ids.some(trongPhamVi)) → phục vụ CẢ danh sách`   ⇒ một mã hợp lệ kéo
 *                                                               cả đám qua cổng
 *     ✗ `if (ids.some(ngoài)) → ném FORBIDDEN`                ⇒ lỗi riêng cho mã
 *                                                               ngoài phạm vi
 *                                                               **xác nhận nhà máy
 *                                                               ấy có thật** (G82)
 *     ✗ `if (!hopLe.length) → bỏ cổng`                        ⇒ 0 gán thành toàn quyền
 *
 * Thiết kế `docs/superpowers/specs/2026-09-16-twin-canh-nhieu-nha-may.md` §4.1 đặt
 * tên cho ba điều phải giữ. Lưới này là bản đo được của chúng:
 *
 *   **BB-1 (LỌC TỪNG MÃ)** — tập phục vụ = `factoryIds ∩ phamVi(người gọi)`, giao
 *     TỪNG PHẦN TỬ, cưỡng chế bằng một phép `filter` trên tập id ĐÃ PHÂN GIẢI.
 *   **BB-2 (IM LẶNG BỎ)** — mã ngoài phạm vi rơi khỏi danh sách, trả `200` với
 *     phần còn lại. Không lỗi, không thông điệp nêu đích danh, không đếm "đã bỏ N".
 *   **BB-3 (TOÀN NGOÀI ⇒ RỖNG, KHÔNG RÒ TÊN)** — năm mảng rỗng và chuỗi phản hồi
 *     không chứa mã/tên của bất kỳ nhà máy nào bị loại.
 *
 * ★ Bất biến phụ (§4.1, dễ quên nhất): **cổng TẦNG phải tự đứng vững.** `tangIds`
 *   vẫn do client tự khai; nó được kiểm qua `twin_tang → twin_toa_nha → factoryId`
 *   THẬT của nó (`locTangTrongPhamVi`), **không** qua `factoryIds` mà client gửi
 *   kèm. Ô "CỔNG TẦNG ĐỨNG ĐỘC LẬP" dưới đây ghim điều đó bằng hành vi, và ablation
 *   thứ hai (gỡ dòng lọc của `locTangTrongPhamVi`) chứng minh nó là một cổng RIÊNG.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI PHÉP ĐO PHẢI CÓ, KHÔNG PHẢI MỘT
 * ══════════════════════════════════════════════════════════════════════════════
 *   (A) HÀNG RÀO — hai chiều. Chiều (−) ngoài phạm vi KHÔNG thấy; chiều (+) trong
 *       phạm vi VẪN thấy đủ. Thiếu chiều (+) thì `return rỗng` vô điều kiện xanh hết.
 *   (B) CHI PHÍ — số câu SQL đếm bằng **bộ đếm CỦA SẢN PHẨM** (`getQueryStats`),
 *       không đếm tay. Bất biến: số câu **không tăng theo số nhà máy**. Đây là thứ
 *       phân biệt "gộp thật" với "vòng lặp ba lượt gọi giấu trong một thủ tục".
 *
 * ⚠ MỌI ô (−) đều xanh nếu dữ kiện nền rỗng. Nên mỗi ô (−) có một ô ĐỐI CHỨNG
 *   "BIẾT KÊU" đi kèm: CHÍNH tập dữ liệu ấy phải đọc được qua một lối khác (admin
 *   hoặc lối không mang danh tính). Không có nó thì lưới đo "không ai phát sóng"
 *   chứ không đo hàng rào (G22).
 *
 * ★ G22 — `vitest.setup.ts` ép `DATABASE_URL` sang `aoi_management_test`, nơi KHÔNG
 *   có dữ liệu QATD. Lưới TỰ DỰNG: 3 nhà máy đủ chuỗi `workshop → line → station →
 *   machine` + toà/tầng/đặt chỗ, 4 người dùng, rồi xoá đúng chừng ấy theo id.
 * ★ G20 — import CHÍNH `appRouter` của module giao hàng, gọi qua `createCaller`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { appRouter } from "../routers";
import { resolvePermissionModule } from "@shared/permissions";
import { traCayPhanCapNhieuNhaMay } from "../db/twinCanh";
import { trongPhamVi } from "../db/hierarchy";
import { getQueryStats } from "../queryMonitor";

const DB_URL = process.env.DATABASE_URL;

/** Hậu tố duy nhất cho mọi hàng lưới này tạo — để xoá lại đúng chừng ấy. */
const DAU = `T18-${Date.now()}`;

/** Vai KHÔNG phải admin — admin BYPASS cổng, đo bằng admin chứng minh số 0 vô nghĩa. */
const VAI = "engineer";

/**
 * Số máy KHÁC NHAU cho ba nhà máy — cố ý.
 *
 * ⚠ Nếu ba nhà máy cùng số máy thì một bản vá trả nhầm nhà máy vẫn cho ra ĐÚNG số
 *   lượng, và mọi ô đếm xanh. Ba con số rời nhau biến "đếm" thành một phép nhận
 *   dạng: 2 ⇒ chỉ A · 5 ⇒ A+B · 9 ⇒ cả ba.
 */
const SO_MAY = { A: 2, B: 3, C: 4 } as const;
/** Mỗi nhà máy 1 toà × 2 tầng × 2 đặt chỗ. */
const SO_TANG = 2;
const DAT_CHO_MOI_TANG = 2;

/** Trần đầu vào đang ghim ở router (§6.2 thiết kế). */
const TRAN_NHA_MAY = 8;
const TRAN_TANG = 300;

let sql: ReturnType<typeof postgres>;

interface NhaMay {
  /** `${DAU}-A` — dấu vết xuất hiện trong MỌI mã của nhà máy này. */
  ma: string;
  ten: string;
  factoryId: number;
  workshopId: number;
  lineId: number;
  tramId: number;
  mayIds: number[];
  toaNhaId: number;
  tangIds: number[];
  datChoIds: number[];
}

interface Fixture {
  A: NhaMay;
  B: NhaMay;
  C: NhaMay;
  /** Được gán ĐÚNG MỘT nhà máy (A). */
  userAId: number;
  /** Được gán CẢ BA — vai "giám đốc" của thiết kế, dùng cho ca thu hẹp tự nguyện. */
  userABCId: number;
  /** 0 gán, ĐỦ quyền — (G43) chỉ khác `userAId` ở bản gán. */
  userKhongGanId: number;
  /** role admin — phạm vi `null`, không thêm mệnh đề nào. */
  userAdminId: number;
}
let fx: Fixture | null = null;

const id1 = (r: unknown): number => (r as Array<{ id: number }>)[0].id;

async function taoNhaMay(nhan: "A" | "B" | "C", soMay: number): Promise<NhaMay> {
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
  /*
   * ⚠⚠ CHÈN THEO LÔ, KHÔNG PHẢI MỘT-HÀNG-MỘT-LƯỢT — và đây là một phép đo, không
   *   phải sở thích. Bản đầu của tệp này chèn ~56 lượt tuần tự trong `beforeAll`;
   *   khi chạy song song trong cổng `phamVi` (20 tệp, cùng MỘT Postgres), nó đẩy
   *   `phamViDocPatch > mqttClient.getAllMachineHealth` (vốn đã tốn 1,4 s trên trần
   *   5 s mặc định) vượt hạn ⇒ cổng ĐỎ CHẬP CHỜN ~1/3 lượt chạy. Đối chứng đã đo:
   *   cùng ba tệp ấy chạy với `congPhamViGop.db.test.ts` (một tệp CSDL nặng CÓ SẴN)
   *   xanh 3/3. Một cổng đỏ lúc được lúc không tệ hơn một cổng đỏ hẳn.
   */
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
  const toaNhaId = id1(await sql`
    INSERT INTO twin_toa_nha ("factoryId", ma, ten, nguon, "viTriXMm", "viTriYMm")
    VALUES (${factoryId}, ${`${ma}-TOA`}, ${`${ma} toa nha`}, 'tay', 0, 0) RETURNING id`);
  const tangRows = Array.from({ length: SO_TANG }, (_, i) => ({
    toaNhaId,
    capSo: i + 1,
    ten: `${ma} tang ${i + 1}`,
    nguon: "tay",
    caoDoMm: String(i * 6000),
  }));
  const tangIds = (
    (await sql`
      INSERT INTO twin_tang ${sql(tangRows, "toaNhaId", "capSo", "ten", "nguon", "caoDoMm")}
      RETURNING id, "capSo"`) as unknown as Array<{ id: number; capSo: number }>
  )
    .sort((a, b) => a.capSo - b.capSo)
    .map((r) => r.id);
  // ⚠ `uq_twin_dat_cho_thuc_the` DUY NHẤT trên (loaiThucThe, thucTheId): hàng đặt chỗ
  //   của máy dùng CHÍNH `mayIds`, phần dư dùng id nhân tạo ở nền cao.
  const datChoRows: Array<Record<string, unknown>> = [];
  let k = 0;
  for (const tangId of tangIds) {
    for (let j = 0; j < DAT_CHO_MOI_TANG; j++) {
      datChoRows.push({
        tangId,
        loaiThucThe: "machine",
        thucTheId: mayIds[k] ?? 1_500_000_000 + (Date.now() % 1_000_000) * 16 + k,
        viTriXMm: String(1000 + j * 10),
        viTriYMm: String(2000 + j * 10),
        viTriZMm: "0",
        nguon: "tay",
      });
      k++;
    }
  }
  const datChoIds = (
    (await sql`
      INSERT INTO twin_dat_cho ${sql(datChoRows, "tangId", "loaiThucThe", "thucTheId", "viTriXMm", "viTriYMm", "viTriZMm", "nguon")}
      RETURNING id`) as unknown as Array<{ id: number }>
  ).map((r) => r.id);
  return { ma, ten, factoryId, workshopId, lineId, tramId, mayIds, toaNhaId, tangIds, datChoIds };
}

async function xoaNhaMay(nm: NhaMay): Promise<void> {
  await sql`DELETE FROM twin_dat_cho WHERE id = ANY(${nm.datChoIds})`;
  await sql`DELETE FROM twin_tang WHERE id = ANY(${nm.tangIds})`;
  await sql`DELETE FROM twin_toa_nha WHERE id = ${nm.toaNhaId}`;
  await sql`DELETE FROM machines WHERE id = ANY(${nm.mayIds})`;
  await sql`DELETE FROM stations WHERE id = ${nm.tramId}`;
  await sql`DELETE FROM production_lines WHERE id = ${nm.lineId}`;
  await sql`DELETE FROM workshops WHERE id = ${nm.workshopId}`;
  await sql`DELETE FROM factories WHERE id = ${nm.factoryId}`;
}

/** Bốn người thử trong MỘT lượt chèn — xem ghi chú "CHÈN THEO LÔ" ở trên. */
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
  // `RETURNING` KHÔNG hứa thứ tự — tra lại theo tên thay vì tin vị trí.
  return ds.map((d) => ra.find((r) => r.username === `${DAU}-${d.nhan}`)!.id);
}

/**
 * ★ G43 — ĐỦ quyền cho cổng `quyenDocHinhHoc` (hợp của bốn module ở
 *   `twinCanhRouter.MODULE_DOC_HINH_HOC`). Thiếu quyền thì ô (−) xanh vì
 *   `PERMISSION_DENIED` — tức đo cổng QUYỀN chứ không đo cổng PHẠM VI, hai trục
 *   hoàn toàn rời nhau. Ba người thử dưới đây có quyền GIỐNG HỆT nhau; thứ DUY
 *   NHẤT phân biệt họ là bản gán nhà máy.
 */
async function capDuQuyen(userIds: number[]): Promise<void> {
  const cap: Array<[string, string]> = [
    ["machine_monitoring", resolvePermissionModule("machine_monitoring")],
    ["analytics", "analytics_oee"],
    ["settings", "settings_factory"],
  ];
  // MỘT lượt chèn cho CẢ BA người mỗi module (3 lượt thay vì 9), và giữ nguyên
  // phép ép kiểu `::permissioncategoryenum` — cột là enum, không phải text.
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

/** Hình dạng phản hồi mà lưới này đọc — chỉ những mảng cần cho phép đo. */
interface CanhTraVe {
  xuong: Array<{ id: number; ma: string; ten: string; factoryId: number }>;
  chuyen: Array<{ id: number; workshopId: number }>;
  tram: Array<{ id: number; lineId: number }>;
  may: Array<{ id: number; ma: string; stationId: number }>;
  datCho: Array<{ id: number; tangId: number | null }>;
  vung: unknown[];
}

const canh = (c: Caller, input: Record<string, unknown>): Promise<CanhTraVe> =>
  c.twinCanh.canhThietKe(input as never) as unknown as Promise<CanhTraVe>;

/**
 * Nhà máy THẬT của một máy, suy NGƯỢC trên chính phản hồi:
 * `may → tram → chuyen → xuong.factoryId`.
 *
 * ⚠ KHÔNG viết được `m.factoryId`: bảng `machines` **không có** cột ấy (đo được
 *   2026-09-06). Đi ngược trên phản hồi có thêm một cái lợi: nó cũng chứng minh cây
 *   trả về TỰ NHẤT QUÁN — một máy mồ côi (trạm không có trong `tram`) cho `null` và
 *   làm ô đỏ, thay vì lặng lẽ được đếm là "của nhà máy đang xin".
 */
function nhaMayCuaMay(kq: CanhTraVe, may: { stationId: number }): number | null {
  const tram = kq.tram.find((t) => t.id === may.stationId);
  if (!tram) return null;
  const chuyen = kq.chuyen.find((c) => c.id === tram.lineId);
  if (!chuyen) return null;
  const xuong = kq.xuong.find((x) => x.id === chuyen.workshopId);
  return xuong ? xuong.factoryId : null;
}

const tapNhaMay = (kq: CanhTraVe): Set<number | null> =>
  new Set(kq.may.map((m) => nhaMayCuaMay(kq, m)));

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
 * Đếm số câu SQL một lời gọi sinh ra, bằng bộ đếm CỦA SẢN PHẨM.
 *
 * ⚠ `lamNong` chạy TRƯỚC mốc đếm: `getUserAssignmentCodes` có bộ nhớ đệm TTL 30 s
 *   (`server/_core/accessControl.ts`), nên lần gọi LẠNH tốn thêm câu và số đo nhảy
 *   tuỳ lúc. Làm nóng rồi mới đo là đo ĐÚNG trạng thái ổn định.
 */
async function demCau<T>(lamNong: () => Promise<unknown>, f: () => Promise<T>) {
  await lamNong();
  const truoc = getQueryStats().totalQueries;
  const kq = await f();
  return { soCau: getQueryStats().totalQueries - truoc, kq };
}

describe.skipIf(!DB_URL)("Task 18 — canhThietKe nhận DANH SÁCH mã nhà máy, lọc phạm vi TỪNG MÃ", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const A = await taoNhaMay("A", SO_MAY.A);
    const B = await taoNhaMay("B", SO_MAY.B);
    const C = await taoNhaMay("C", SO_MAY.C);

    const [userAId, userABCId, userKhongGanId, userAdminId] = await taoNguoi([
      { nhan: "nguoi-gan-A", role: VAI },
      { nhan: "nguoi-gan-ABC", role: VAI },
      { nhan: "nguoi-khong-gan", role: VAI },
      { nhan: "nguoi-admin", role: "admin" },
    ]);
    await capDuQuyen([userAId, userABCId, userKhongGanId]);

    // ⚠ Nối bằng `factoryCode` — bảng này KHÔNG có cột `factoryId` (42703 nếu sai).
    const ganRows = [
      { userId: userAId, factoryCode: A.ma },
      ...[A, B, C].map((nm) => ({ userId: userABCId, factoryCode: nm.ma })),
    ];
    await sql`
      INSERT INTO user_factory_assignments ${sql(ganRows, "userId", "factoryCode")}`;

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
  });

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* (0) DỮ KIỆN NỀN — không có nó, mọi ô (−) tự thoả trên tập rỗng              */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it("dữ kiện nền DỰNG ĐƯỢC THẬT — 3 nhà máy, 2/3/4 máy, 6 tầng, 12 đặt chỗ", () => {
    expect(fx).not.toBeNull();
    expect(fx!.A.mayIds).toHaveLength(SO_MAY.A);
    expect(fx!.B.mayIds).toHaveLength(SO_MAY.B);
    expect(fx!.C.mayIds).toHaveLength(SO_MAY.C);
    for (const nm of [fx!.A, fx!.B, fx!.C]) {
      expect(nm.tangIds).toHaveLength(SO_TANG);
      expect(nm.datChoIds).toHaveLength(SO_TANG * DAT_CHO_MOI_TANG);
    }
    expect(new Set([fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId]).size).toBe(3);
  });

  it("★★★ ĐỐI CHỨNG DANH TÍNH — ba người thử khác nhau ĐÚNG ở bản gán, không ở quyền", async () => {
    // "0 gán" và "được gán A, hỏi B" cho CÙNG kết quả rỗng. Ô này tách hai câu đó,
    // và đồng thời chứng minh chiều (−) không phải do thiếu quyền.
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

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* BB-1 — LỌC TỪNG MÃ                                                          */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it("★★★ BB-1 (L1) — người gán A xin [A,B] ⇒ CHỈ máy của A, và đủ máy của A", async () => {
    const kq = await canh(goiVoi(fx!.userAId), { factoryIds: [fx!.A.factoryId, fx!.B.factoryId] });
    // Ràng buộc số lượng: 0 máy thì `every` tự thoả (G5).
    expect(kq.may).toHaveLength(SO_MAY.A);
    expect(tapNhaMay(kq)).toEqual(new Set([fx!.A.factoryId]));
    expect(kq.may.every((m) => m.ma.startsWith(`${fx!.A.ma}-`))).toBe(true);
  });

  it("★★★ BB-1 BIẾT KÊU — CHÍNH tập [A,B] ấy cho 5 máy khi người gọi có cả hai", async () => {
    // Không có ô này, ô trên xanh y hệt khi nhà máy B vốn không có máy nào — tức đo
    // "không ai phát sóng" chứ không đo phép giao TỪNG PHẦN TỬ (G22).
    const kq = await canh(goiVoi(fx!.userABCId), { factoryIds: [fx!.A.factoryId, fx!.B.factoryId] });
    expect(kq.may).toHaveLength(SO_MAY.A + SO_MAY.B);
    expect(tapNhaMay(kq)).toEqual(new Set([fx!.A.factoryId, fx!.B.factoryId]));
  });

  it("★★★ BB-1 — KHÔNG có 'một mã hợp lệ kéo cả danh sách': [A,B,C] của người gán A vẫn ra 2", async () => {
    const kq = await canh(goiVoi(fx!.userAId), {
      factoryIds: [fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId],
    });
    expect(kq.may).toHaveLength(SO_MAY.A);
    expect(tapNhaMay(kq)).toEqual(new Set([fx!.A.factoryId]));
  });

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* BB-2 — IM LẶNG BỎ, KHÔNG NÉM LỖI, KHÔNG ĐẾM "ĐÃ BỎ N MÃ"                    */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it("★★★ BB-2 — [A,B] và [A] cho phản hồi GIỐNG HỆT TỪNG BYTE (mã ngoài không để lại vết)", async () => {
    /*
     * Đây là phát biểu MẠNH NHẤT của BB-2, và nó đo được: nếu thủ tục ném lỗi, thêm
     * một ô `daBo: 1`, hay đổi bất cứ thứ gì khi có mã ngoài phạm vi trong danh sách,
     * hai chuỗi sẽ khác nhau. Một phản hồi giống hệt nghĩa là người gọi KHÔNG có cách
     * nào biết nhà máy B có tồn tại hay không — đúng lý do G82.
     */
    const c = goiVoi(fx!.userAId);
    const chiA = await canh(c, { factoryIds: [fx!.A.factoryId] });
    const aVaB = await canh(c, { factoryIds: [fx!.A.factoryId, fx!.B.factoryId] });
    expect(JSON.stringify(aVaB)).toBe(JSON.stringify(chiA));
  });

  it("★★★ BB-2 — 200 chứ KHÔNG phải FORBIDDEN/NOT_FOUND khi danh sách có mã ngoài", async () => {
    const loi = await thuLoi(
      canh(goiVoi(fx!.userAId), { factoryIds: [fx!.A.factoryId, fx!.C.factoryId] }),
    );
    expect(loi).toBeNull();
  });

  it("★★★ BB-2 — phản hồi KHÔNG mang ô đếm 'đã bỏ N mã' nào", async () => {
    // Một bộ đếm tử tế cũng là một oracle tồn-tại: "đã bỏ 1" nói cho người gọi biết
    // đúng một trong hai mã họ hỏi là có thật.
    const kq = (await canh(goiVoi(fx!.userAId), {
      factoryIds: [fx!.A.factoryId, fx!.B.factoryId],
    })) as unknown as Record<string, unknown>;
    const khoa = Object.keys(kq).map((k) => k.toLowerCase());
    for (const xau of ["bo", "loai", "skip", "drop", "denied", "reject", "ngoai"]) {
      expect(khoa.filter((k) => k.includes(xau))).toEqual([]);
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* BB-3 — TOÀN NGOÀI ⇒ RỖNG, KHÔNG RÒ TÊN                                      */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it("★★★ BB-3 (L2) — người gán A xin [B,C] ⇒ cây RỖNG, không lỗi, KHÔNG rò mã/tên", async () => {
    const kq = await canh(goiVoi(fx!.userAId), { factoryIds: [fx!.B.factoryId, fx!.C.factoryId] });
    expect(kq.may).toHaveLength(0);
    expect(kq.xuong).toHaveLength(0);
    expect(kq.chuyen).toHaveLength(0);
    expect(kq.tram).toHaveLength(0);
    const chuoi = JSON.stringify(kq);
    for (const nm of [fx!.B, fx!.C]) {
      expect(chuoi).not.toContain(nm.ma);
      expect(chuoi).not.toContain(nm.ten);
    }
  });

  it("★★★ BB-3 BIẾT KÊU — CHÍNH [B,C] ấy cho 7 máy và CÓ mã B/C khi admin hỏi", async () => {
    const kq = await canh(goiVoi(fx!.userAdminId, "admin"), {
      factoryIds: [fx!.B.factoryId, fx!.C.factoryId],
    });
    expect(kq.may).toHaveLength(SO_MAY.B + SO_MAY.C);
    expect(JSON.stringify(kq)).toContain(fx!.B.ma);
  });

  it("★★★ BB-3 (L7) — 0 gán xin [A,B,C] ⇒ RỖNG (`[]` là phạm vi rỗng TƯỜNG MINH)", async () => {
    // Ca fail-closed mà một lối tắt `if (!hopLe.length) return tatCa` sẽ phá.
    const kq = await canh(goiVoi(fx!.userKhongGanId), {
      factoryIds: [fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId],
    });
    expect(kq.may).toHaveLength(0);
    expect(kq.xuong).toHaveLength(0);
    expect(kq.datCho).toHaveLength(0);
  });

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* ĐỐI CHỨNG DƯƠNG — chống "vá quá tay thành chặn tất cả"                       */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it("★★★ (L3) admin xin [A,B,C] ⇒ nhận ĐỦ BA nhà máy, 9 máy", async () => {
    const kq = await canh(goiVoi(fx!.userAdminId, "admin"), {
      factoryIds: [fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId],
    });
    expect(tapNhaMay(kq)).toEqual(new Set([fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId]));
    expect(kq.may).toHaveLength(SO_MAY.A + SO_MAY.B + SO_MAY.C);
  });

  it("★★★ (L3b) người gán CẢ BA xin [A,B,C] ⇒ cũng đủ ba — không phải đặc quyền admin", async () => {
    const kq = await canh(goiVoi(fx!.userABCId), {
      factoryIds: [fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId],
    });
    expect(tapNhaMay(kq)).toEqual(new Set([fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId]));
    expect(kq.may).toHaveLength(SO_MAY.A + SO_MAY.B + SO_MAY.C);
  });

  it("★★★ (L6) THU HẸP TỰ NGUYỆN — người có cả ba xin ĐÚNG [B] ⇒ chỉ B", async () => {
    // "Anh có quyền cả ba nên trả cả ba" là một lỗi khác hướng: nó không rò tenant
    // nhưng nó vẽ một cảnh KHÁC cảnh người dùng vừa chọn.
    const kq = await canh(goiVoi(fx!.userABCId), { factoryIds: [fx!.B.factoryId] });
    expect(kq.may).toHaveLength(SO_MAY.B);
    expect(tapNhaMay(kq)).toEqual(new Set([fx!.B.factoryId]));
  });

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* TƯƠNG THÍCH NGƯỢC — đường MỘT mã cũ giữ nguyên từng byte                     */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it("★★★ ĐƯỜNG CŨ — `factoryId: A` vẫn chạy và cho ĐÚNG cùng phản hồi với `factoryIds: [A]`", async () => {
    const c = goiVoi(fx!.userAId);
    const cu = await canh(c, { factoryId: fx!.A.factoryId, tangIds: fx!.A.tangIds });
    const moi = await canh(c, { factoryIds: [fx!.A.factoryId], tangIds: fx!.A.tangIds });
    expect(cu.may).toHaveLength(SO_MAY.A);
    expect(cu.datCho).toHaveLength(SO_TANG * DAT_CHO_MOI_TANG);
    expect(JSON.stringify(moi)).toBe(JSON.stringify(cu));
  });

  it("★★★ ĐƯỜNG CŨ vẫn giữ hàng rào — `factoryId: B` của người gán A ⇒ rỗng, không rò", async () => {
    const kq = await canh(goiVoi(fx!.userAId), { factoryId: fx!.B.factoryId });
    expect(kq.may).toHaveLength(0);
    expect(JSON.stringify(kq)).not.toContain(fx!.B.ma);
  });

  it("★★★ KHÔNG khai mã nào ⇒ BAD_REQUEST (không có nghĩa 'mọi nhà máy')", async () => {
    const loi = await thuLoi(canh(goiVoi(fx!.userAdminId, "admin"), {}));
    expect(loi?.code).toBe("BAD_REQUEST");
  });

  it("★★★ khai CẢ HAI ô ⇒ BAD_REQUEST (hai nguồn sự thật trong một đầu vào)", async () => {
    const loi = await thuLoi(
      canh(goiVoi(fx!.userAdminId, "admin"), {
        factoryId: fx!.A.factoryId,
        factoryIds: [fx!.B.factoryId],
      }),
    );
    expect(loi?.code).toBe("BAD_REQUEST");
  });

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* CỔNG TẦNG ĐỨNG ĐỘC LẬP                                                      */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it("★★★ (L5) xin [A,B] kèm tangIds của CẢ A LẪN B ⇒ datCho chỉ mang tầng của A", async () => {
    const kq = await canh(goiVoi(fx!.userAId), {
      factoryIds: [fx!.A.factoryId, fx!.B.factoryId],
      tangIds: [...fx!.A.tangIds, ...fx!.B.tangIds],
    });
    expect(kq.datCho).toHaveLength(SO_TANG * DAT_CHO_MOI_TANG);
    const tapB = new Set(fx!.B.tangIds);
    expect(kq.datCho.some((h) => h.tangId !== null && tapB.has(h.tangId))).toBe(false);
  });

  it("★★★ CỔNG TẦNG KHÔNG nhận mã nhà máy từ phía gọi — xin [A] kèm tầng B, admin VẪN thấy tầng B", async () => {
    /*
     * ⚠⚠ Ô này trông "ngược" nhưng nó chính là bất biến phụ của §4.1. Cổng tầng
     *   kiểm tầng qua `twin_tang → twin_toa_nha → factoryId` THẬT, KHÔNG qua
     *   `factoryIds` mà client gửi kèm. Nếu ai đó "siết cho chặt" bằng cách lọc tầng
     *   theo `factoryIds` của input, ô này đỏ — và đó là ĐÚNG cảnh báo: khi ấy hàng
     *   rào tầng đã chuyển sang phụ thuộc một giá trị CLIENT TỰ KHAI, tức mất hàng
     *   rào (bài học `pham-vi-tenant-dot-lon`). Hàng rào tầng THẬT được đo ở ô (L5)
     *   ngay trên và ở `congPhamViGop.db.test.ts`.
     */
    const kq = await canh(goiVoi(fx!.userAdminId, "admin"), {
      factoryIds: [fx!.A.factoryId],
      tangIds: fx!.B.tangIds,
    });
    expect(kq.datCho).toHaveLength(SO_TANG * DAT_CHO_MOI_TANG);
  });

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* TRẦN AN TOÀN — từ chối RÕ RÀNG, tuyệt đối không cắt im lặng                  */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it(`★★★ (L4) ${TRAN_NHA_MAY + 1} nhà máy ⇒ BAD_REQUEST, và KHÔNG có tập bị cắt nào trả về`, async () => {
    const day = Array.from({ length: TRAN_NHA_MAY + 1 }, (_, i) => i + 1);
    const loi = await thuLoi(canh(goiVoi(fx!.userAdminId, "admin"), { factoryIds: day }));
    expect(loi?.code).toBe("BAD_REQUEST");
    // Vế thứ hai: một lưới chỉ kiểm `rejects` vẫn xanh nếu ai đó thêm `.slice(0, 8)`.
    // Ô này đòi rằng KHÔNG có đường nào trả về dữ liệu cho một danh sách vượt trần.
    expect(loi?.msg ?? "").not.toContain("xuong");
  });

  it(`★★★ ĐÚNG BẰNG trần (${TRAN_NHA_MAY} nhà máy) ⇒ CHẤP NHẬN — trần không chặn sớm hơn`, async () => {
    const day = [
      fx!.A.factoryId,
      fx!.B.factoryId,
      fx!.C.factoryId,
      ...Array.from({ length: TRAN_NHA_MAY - 3 }, (_, i) => 2_000_000_001 + i),
    ];
    expect(day).toHaveLength(TRAN_NHA_MAY);
    const kq = await canh(goiVoi(fx!.userAdminId, "admin"), { factoryIds: day });
    expect(kq.may).toHaveLength(SO_MAY.A + SO_MAY.B + SO_MAY.C);
  });

  it("★★★ danh sách RỖNG ⇒ BAD_REQUEST, KHÔNG phải 'mọi nhà máy'", async () => {
    const loi = await thuLoi(canh(goiVoi(fx!.userAdminId, "admin"), { factoryIds: [] }));
    expect(loi?.code).toBe("BAD_REQUEST");
  });

  it(`★★★ TRẦN TẦNG nâng lên ${TRAN_TANG}: 51 tầng CHẤP NHẬN, ${TRAN_TANG + 1} tầng BAD_REQUEST`, async () => {
    /*
     * ⚠ Ba nhà máy QATD = 12 toà × 7 tầng = **84 tầng**. Giữ trần 50 thì đầu vào
     *   danh sách vừa nới ra đã chết ngay lượt dùng đầu tiên: hoặc client cắt 34 tầng,
     *   hoặc Zod ném `BAD_REQUEST` và cảnh trắng. Ô này ghim GIÁ TRỊ trần bằng hành
     *   vi ở CẢ HAI biên, không đếm chính tả một dòng mã.
     */
    const c = goiVoi(fx!.userAdminId, "admin");
    const gia = (n: number) => Array.from({ length: n }, (_, i) => 2_100_000_001 + i);
    expect(await thuLoi(canh(c, { factoryIds: [fx!.A.factoryId], tangIds: gia(51) }))).toBeNull();
    expect(await thuLoi(canh(c, { factoryIds: [fx!.A.factoryId], tangIds: gia(TRAN_TANG) }))).toBeNull();
    const loi = await thuLoi(canh(c, { factoryIds: [fx!.A.factoryId], tangIds: gia(TRAN_TANG + 1) }));
    expect(loi?.code).toBe("BAD_REQUEST");
  });

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* (L8) TRÙNG LẶP VÀ RÁC                                                       */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it("★★★ (L8) [A, A, id-không-tồn-tại] ⇒ A ĐÚNG MỘT LẦN, im lặng bỏ id lạ, không lỗi", async () => {
    const kq = await canh(goiVoi(fx!.userAId), {
      factoryIds: [fx!.A.factoryId, fx!.A.factoryId, 2_000_000_099],
    });
    expect(kq.may).toHaveLength(SO_MAY.A);
    expect(kq.xuong).toHaveLength(1);
    expect(new Set(kq.may.map((m) => m.id)).size).toBe(SO_MAY.A);
  });

  it("★★★ (L8) id ÂM / 0 bị Zod chặn ở biên, và hàm db cũng tự loại chúng", async () => {
    // Hai tầng, hai phép đo: thủ tục từ chối ở biên; hàm db (lối gọi trong máy chủ)
    // vẫn phải fail-closed nếu ai đó gọi thẳng nó với rác.
    const loi = await thuLoi(
      canh(goiVoi(fx!.userAdminId, "admin"), { factoryIds: [fx!.A.factoryId, -1] }),
    );
    expect(loi?.code).toBe("BAD_REQUEST");
    const cay = await traCayPhanCapNhieuNhaMay([fx!.A.factoryId, -1, 0, 2_000_000_099], {
      userId: fx!.userAId,
      userRole: VAI,
    });
    expect(cay.may).toHaveLength(SO_MAY.A);
    expect(cay.xuong).toHaveLength(1);
  });

  it("★★★ hàm db: danh sách RỖNG ⇒ cây rỗng, KHÔNG phải 'không lọc'", async () => {
    const cay = await traCayPhanCapNhieuNhaMay([], undefined);
    expect(cay.may).toHaveLength(0);
    expect(cay.xuong).toHaveLength(0);
  });

  /* ═══════════════════════════════════════════════════════════════════════════ */
  /* CHI PHÍ — bộ đếm CỦA SẢN PHẨM, và thiết bị đo phải BIẾT KÊU trước            */
  /* ═══════════════════════════════════════════════════════════════════════════ */

  it("★★★ BỘ ĐẾM BIẾT KÊU — khuôn N+1 dựng lại tại chỗ vẫn cho ≥ 2N câu", async () => {
    // Nếu `getQueryStats` mù (luôn 0) thì mọi ô đếm câu bên dưới xanh giả.
    const N = 8;
    const sc = { userId: fx!.userAId, userRole: VAI };
    const { soCau } = await demCau(
      () => trongPhamVi("factory", fx!.A.factoryId, sc),
      async () => {
        for (let i = 0; i < N; i++) await trongPhamVi("factory", fx!.A.factoryId, sc);
      },
    );
    console.log(`[T18] khuôn N+1 dựng lại: N=${N} ⇒ ${soCau} câu`);
    expect(soCau).toBeGreaterThanOrEqual(2 * N);
  });

  it("★★★ SỐ CÂU KHÔNG TĂNG THEO SỐ NHÀ MÁY — 3 nhà máy ≤ 1 nhà máy + 1", async () => {
    /*
     * Đây là BẤT BIẾN, không phải một ngưỡng. Một bản cài đặt "gộp" bằng cách lặp
     * `traCayPhanCapNhaMay` ba lần vẫn qua mọi ô hàng rào ở trên, nhưng vỡ ô này —
     * và đó đúng là hình dạng chi phí mà §2.3 K2 đo được (611 câu / 667 ms).
     */
    const c = goiVoi(fx!.userABCId);
    const ba = [fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId];
    const mot = await demCau(
      () => canh(c, { factoryIds: [fx!.A.factoryId], tangIds: fx!.A.tangIds }),
      () => canh(c, { factoryIds: [fx!.A.factoryId], tangIds: fx!.A.tangIds }),
    );
    const tatCa = await demCau(
      () => canh(c, { factoryIds: ba, tangIds: [...fx!.A.tangIds, ...fx!.B.tangIds, ...fx!.C.tangIds] }),
      () => canh(c, { factoryIds: ba, tangIds: [...fx!.A.tangIds, ...fx!.B.tangIds, ...fx!.C.tangIds] }),
    );
    console.log(`[T18] canhThietKe 1 nhà máy = ${mot.soCau} câu · 3 nhà máy = ${tatCa.soCau} câu`);
    // Ràng buộc số lượng trước, nếu không thì "0 hàng, 0 câu" cũng qua.
    expect(mot.kq.may).toHaveLength(SO_MAY.A);
    expect(tatCa.kq.may).toHaveLength(SO_MAY.A + SO_MAY.B + SO_MAY.C);
    expect(tatCa.kq.datCho).toHaveLength(3 * SO_TANG * DAT_CHO_MOI_TANG);
    expect(tatCa.soCau).toBeLessThanOrEqual(mot.soCau + 1);
  });

  it("★★★ TRƯỚC/SAU — 3 lượt gọi đường MỘT MÃ tốn gấp ~3 lần MỘT lượt danh sách", async () => {
    /*
     * ⚠ "Trước" ở đây KHÔNG phải một con số nhớ lại: nó là ĐƯỜNG MỘT MÃ **vẫn còn
     *   sống** trong sản phẩm, gọi ba lượt — đúng hình dạng mà PA-1 ("client gọi
     *   song song ba lượt") sẽ trả tiền. Đo cả hai trong CÙNG một lần chạy, cùng bộ
     *   đếm, cùng trạng thái nóng ⇒ so sánh có nghĩa.
     */
    const c = goiVoi(fx!.userABCId);
    const ba = [fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId];
    const tang = [...fx!.A.tangIds, ...fx!.B.tangIds, ...fx!.C.tangIds];
    const cu = await demCau(
      () => canh(c, { factoryId: fx!.A.factoryId, tangIds: fx!.A.tangIds }),
      async () => {
        const ra: CanhTraVe[] = [];
        for (const f of ba) {
          const t = f === fx!.A.factoryId ? fx!.A.tangIds : f === fx!.B.factoryId ? fx!.B.tangIds : fx!.C.tangIds;
          ra.push(await canh(c, { factoryId: f, tangIds: t }));
        }
        return ra;
      },
    );
    const moi = await demCau(
      () => canh(c, { factoryIds: ba, tangIds: tang }),
      () => canh(c, { factoryIds: ba, tangIds: tang }),
    );
    console.log(`[T18] 3 nhà máy: 3 lượt MỘT MÃ = ${cu.soCau} câu · 1 lượt DANH SÁCH = ${moi.soCau} câu`);
    // Cùng dữ liệu ra — nếu không thì con số nhanh chỉ là con số nhanh.
    expect(cu.kq.reduce((n, k) => n + k.may.length, 0)).toBe(SO_MAY.A + SO_MAY.B + SO_MAY.C);
    expect(moi.kq.may).toHaveLength(SO_MAY.A + SO_MAY.B + SO_MAY.C);
    expect(cu.kq.reduce((n, k) => n + k.datCho.length, 0)).toBe(moi.kq.datCho.length);
    expect(moi.soCau).toBeLessThan(cu.soCau / 2);
  });

  it("★★★ hàm db `traCayPhanCapNhieuNhaMay` — 3 nhà máy tốn ≤ 6 câu (4 đọc + 2 phân giải)", async () => {
    const sc = { userId: fx!.userABCId, userRole: VAI };
    const ba = [fx!.A.factoryId, fx!.B.factoryId, fx!.C.factoryId];
    const { soCau, kq } = await demCau(
      () => traCayPhanCapNhieuNhaMay([fx!.A.factoryId], sc),
      () => traCayPhanCapNhieuNhaMay(ba, sc),
    );
    console.log(`[T18] traCayPhanCapNhieuNhaMay(3) = ${soCau} câu, ${kq.may.length} máy`);
    expect(kq.may).toHaveLength(SO_MAY.A + SO_MAY.B + SO_MAY.C);
    expect(soCau).toBeLessThanOrEqual(6);
  });
});
