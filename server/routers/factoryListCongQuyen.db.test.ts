/**
 * ★★★ Task 13 (PH-03) — **CỔNG QUYỀN cho `factory.list`.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖ ĐÃ ĐO (QA lần 11)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Tài khoản có **0 hàng trong bảng `permissions`** vẫn nhận về danh sách nhà máy mình được gán từ
 * `factory.list`, trong khi `factoryCommand.overview` và `twinCanh.danhSachToaNha` của **cùng
 * phiên ấy** trả về từ chối. `hierarchyRouters.ts` chỉ có `protectedProcedure` (đã đăng nhập) cộng
 * bộ lọc phạm vi (`db.getFactories({userId,userRole})`) — **không** một lượt kiểm quyền nào. Rò
 * **tên và mã** nhà máy được gán; không rò máy.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO KHOÁ LÀ "CÓ BẤT KỲ QUYỀN NÀO", **KHÔNG** PHẢI `machine_status`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Kế hoạch đề xuất `requirePermission("machine_status","canView")` — *"cùng khoá mà màn twin vốn
 * đã đòi, để không thu hẹp ai"*. **Đo lại thì đề xuất ấy SAI, và sai theo hướng nguy hiểm nhất:
 * nó THU HẸP người đang dùng được.** Hai phép đo:
 *
 * (A) **`factory.list` KHÔNG phải thủ tục của riêng màn twin.** Đếm nơi gọi ở client
 *     (`trpc.factory.list.useQuery`): 36 lượt khớp / 36 tệp, trừ 2 lượt KHÔNG phải nơi gọi thật
 *     (`pages/ApiDocs.tsx` in chuỗi mẫu trong `<CodeBlock>`; `tang1KhongTachDuoc.unit.test.ts` là
 *     lưới) ⇒ **34 nơi gọi thật**, trải khắp sản phẩm — Báo cáo (`Reports`,
 *     `PdfReports`, `PowerPointExport`, `ReportTemplates`, `ScheduledReports`), Phân tích
 *     (`ParetoAnalysis`, `CategoryAnalytics`, `RootCauseAnalysisPage`, `DataComparison`,
 *     `DrillDownDashboard`), MQTT (`MqttDashboard`, `MqttProfileManagement`), Cài đặt
 *     (`DataSettings`, `Settings`, `UserAssignments`, `WorkstationManagement`), Sản xuất
 *     (`ProductionDashboard`, `ProductionOrders`), bốn màn twin, và — nặng nhất —
 *     `components/patterns/EntityPicker.tsx`, một bộ chọn DÙNG CHUNG có thể nhúng vào bất kỳ màn
 *     nào. Không danh sách khoá hữu hạn nào bao nổi tập ấy một cách bền vững.
 *
 * (B) **Vai `quality_inspector` KHÔNG có `machine_status` lẫn `analytics_oee`.** Đọc
 *     `DEFAULT_ROLE_PERMISSIONS` (`permissionsRouter.ts`), đếm theo vai:
 *         admin 82 · supervisor 41 · quality_inspector 24 · operator 11 · maintenance 17 ·
 *         engineer 22 · viewer 6
 *     `machine_status` có ở supervisor/operator/maintenance/engineer/viewer — **vắng ở
 *     `quality_inspector`**, vai vốn sống trên Báo cáo/Phân tích và *đang* gọi `factory.list` mỗi
 *     lần mở bộ lọc nhà máy. Khoá `machine_status` sẽ cắt đúng vai ấy: **vá một lỗ, mở một lỗ
 *     khác** (một vai mất bộ lọc nhà máy trên 8 màn).
 *
 * ⇒ Khoá đã chọn: **"người gọi phải giữ ÍT NHẤT MỘT quyền còn hiệu lực"** (bất kỳ module, bất kỳ
 * hành động, chưa hết hạn). Đó là **phần bù ĐÚNG BẰNG** lớp rò đo được ("0 hàng quyền"): ai có dù
 * chỉ một ô tick vẫn đi qua, nên **không thu hẹp một ai** — kể cả `quality_inspector`, kể cả vai
 * tuỳ biến do chủ dự án tự nhân bản, kể cả màn chưa ai nghĩ tới. Ca ③ và ④ dưới đây là đối chứng
 * đo chính điều đó, bằng đúng bộ quyền của `quality_inspector` (0 `machine_status`, 0
 * `analytics_oee`) — chúng **ĐỎ** nếu ai đó sau này siết về một khoá module cụ thể.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * HÌNH DẠNG PHÉP ĐO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * · CSDL **THẬT** (`vitest.setup.ts` ép `DATABASE_URL` sang bản sao `_test`). Không mock `../db`
 *   cũng không mock `accessControl` — cổng tự đọc bảng `permissions` qua `getDb()`, giống
 *   `layoutRoutersPermissionKhoiD.db.test.ts`.
 * · Vai **KHÔNG-admin** ở mọi ca quyền: `checkPermission` short-circuit `true` cho admin
 *   (`accessControl.ts`), nên một lưới chạy bằng `role:"admin"` chứng minh ĐÚNG 0 về quyền.
 * · Gọi qua `factoryRouter.createCaller` — đo đúng chỗ bỏ rơi danh tính (nơi GỌI), không gọi
 *   thẳng `db.getFactories`.
 * · **Tập rỗng là HỎNG:** ca ⓪ neo dữ kiện nền (hai nhà máy + bốn tài khoản có thật) trước khi
 *   bất kỳ ca nào được phép tin vào `[]` hay vào một lần ném.
 * · Tự dọn: `afterAll` xoá đúng những hàng lưới này tạo (permissions → gán → users → factories).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 90 + 10)}`.toUpperCase();

const FAC_A = `T13-FA-${RUN}`;
const FAC_B = `T13-FB-${RUN}`;

let sql: ReturnType<typeof postgres>;
let coDb = false;

const ids = {
  facA: 0,
  facB: 0,
  /** 0 hàng quyền, CÓ gán nhà máy A — đúng hình dạng tài khoản QA lần 11 đo được. */
  uKhongQuyen: 0,
  /** Có `machine_status/canView` (vai twin điển hình), gán A. */
  uMachineStatus: 0,
  /** Bộ quyền `quality_inspector`: 0 `machine_status`, 0 `analytics_oee`. Gán A. */
  uQualityInspector: 0,
  /** Quyền DUY NHẤT đã HẾT HẠN — "có hàng" không đồng nghĩa "có quyền". Gán A. */
  uQuyenHetHan: 0,
  /** Quyền chỉ có `canExport` (canView=false) — grant thật, không phải hàng chết. Gán B. */
  uChiCanExport: 0,
  /** admin, 0 hàng quyền — vai toàn quyền phải giữ nguyên từng byte. */
  uAdmin: 0,
};

const ctxFor = (id: number, role: string) => ({ user: { id, role, name: `t13-u${id}` } }) as never;

const goi = async (userId: number, role: string) =>
  (await import("./hierarchyRouters")).factoryRouter.createCaller(ctxFor(userId, role));

const maCua = (rows: Array<{ code: string }>): string[] => rows.map((r) => r.code);

async function safe(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch {
    /* WORM / FK — có đường dọn thay thế */
  }
}

async function taoUser(suffix: string, role: string): Promise<number> {
  const [r] = await sql`
    INSERT INTO users ("openId", username, name, role, "isActive")
    VALUES (${`t13-${suffix}-${RUN}`}, ${`t13-${suffix}-${RUN}`}, ${`T13 ${suffix}`}, ${role}, true)
    RETURNING id`;
  return r!.id as number;
}

async function capQuyen(
  userId: number,
  category: string,
  moduleName: string,
  co: { canView?: boolean; canExport?: boolean } = { canView: true },
  hetHan?: Date,
): Promise<void> {
  await sql`
    INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport", "expiresAt")
    VALUES (${userId}, ${category}::permissioncategoryenum, ${moduleName},
            ${co.canView === true}, false, false, false, ${co.canExport === true}, ${hetHan ?? null})`;
}

/** Ném ⇒ mã lỗi tRPC; không ném ⇒ `null`. Dùng để phân biệt "bị chặn" với "trả rỗng". */
async function maLoiCua(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e: unknown) {
    const err = e as { code?: string; cause?: { code?: string; appCode?: string } };
    return err?.code ?? err?.cause?.code ?? "?";
  }
}

describe.skipIf(!DB_URL)("★★★ Task 13 (PH-03) — factory.list phải có cổng quyền, và cổng ấy KHÔNG được thu hẹp ai", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL as string, { max: 1, connect_timeout: 30, onnotice: () => {} });
    await sql`SET TIME ZONE 'UTC'`;
    coDb = true;

    const [a] = await sql`INSERT INTO factories (code, name) VALUES (${FAC_A}, ${`T13 factory A ${RUN}`}) RETURNING id`;
    const [b] = await sql`INSERT INTO factories (code, name) VALUES (${FAC_B}, ${`T13 factory B ${RUN}`}) RETURNING id`;
    ids.facA = a!.id as number;
    ids.facB = b!.id as number;

    ids.uKhongQuyen = await taoUser("khong-quyen", "engineer");
    ids.uMachineStatus = await taoUser("machine-status", "engineer");
    ids.uQualityInspector = await taoUser("qc", "quality_inspector");
    ids.uQuyenHetHan = await taoUser("het-han", "engineer");
    ids.uChiCanExport = await taoUser("chi-export", "engineer");
    ids.uAdmin = await taoUser("admin", "admin");

    for (const u of [ids.uKhongQuyen, ids.uMachineStatus, ids.uQualityInspector, ids.uQuyenHetHan]) {
      await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u}, ${FAC_A})`;
    }
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ids.uChiCanExport}, ${FAC_B})`;

    // `uKhongQuyen` CỐ Ý không nhận hàng quyền nào — đó là biến số của lưới này.
    await capQuyen(ids.uMachineStatus, "machine_monitoring", "machine_status");
    // Bộ của `quality_inspector` (rút gọn): KHÔNG có machine_status, KHÔNG có analytics_oee.
    await capQuyen(ids.uQualityInspector, "history", "history_view");
    await capQuyen(ids.uQualityInspector, "reports", "reports_view");
    await capQuyen(ids.uQualityInspector, "analytics", "analytics_spc");
    // Hàng DUY NHẤT của `uQuyenHetHan` đã hết hạn từ hôm qua.
    await capQuyen(ids.uQuyenHetHan, "history", "history_view", { canView: true }, new Date(Date.now() - 86_400_000));
    // `uChiCanExport`: canView=false nhưng canExport=true — vẫn là một quyền THẬT.
    await capQuyen(ids.uChiCanExport, "reports", "reports_export", { canView: false, canExport: true });

    const { clearAssignmentCache } = await import("../_core/accessControl");
    clearAssignmentCache();
  }, 180_000);

  afterAll(async () => {
    if (!sql) return;
    try {
      const users = [
        ids.uKhongQuyen, ids.uMachineStatus, ids.uQualityInspector,
        ids.uQuyenHetHan, ids.uChiCanExport, ids.uAdmin,
      ].filter(Boolean);
      if (users.length) {
        await safe(() => sql`DELETE FROM permissions WHERE "userId" IN ${sql(users)}`);
        await safe(() => sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(users)}`);
        await safe(() => sql`DELETE FROM users WHERE id IN ${sql(users)}`);
      }
      for (const f of [ids.facA, ids.facB]) if (f) await safe(() => sql`DELETE FROM factories WHERE id = ${f}`);
    } finally {
      await sql.end();
    }
  }, 120_000);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ⓪ DỮ KIỆN NỀN — không có khối này thì `[]` và "một lần ném" đều xanh vô nghĩa
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  it("⓪ dữ kiện nền — hai nhà máy + sáu tài khoản CÓ THẬT, và `uKhongQuyen` đúng là 0 hàng quyền", async () => {
    if (!coDb) throw new Error("HỎNG: không mở được CSDL test — phép đo không tồn tại");
    const [f] = await sql`SELECT count(*)::int AS n FROM factories WHERE code IN (${FAC_A}, ${FAC_B})`;
    expect(f!.n, "thiếu dữ kiện nền: factories").toBe(2);

    const uids = [ids.uKhongQuyen, ids.uMachineStatus, ids.uQualityInspector, ids.uQuyenHetHan, ids.uChiCanExport, ids.uAdmin];
    expect(uids.every((x) => x > 0), "thiếu dữ kiện nền: users").toBe(true);

    const [p0] = await sql`SELECT count(*)::int AS n FROM permissions WHERE "userId" = ${ids.uKhongQuyen}`;
    expect(p0!.n, "biến số của lưới hỏng: uKhongQuyen phải có ĐÚNG 0 hàng quyền").toBe(0);

    const [pQc] = await sql`
      SELECT count(*)::int AS n FROM permissions
      WHERE "userId" = ${ids.uQualityInspector} AND "moduleName" IN ('machine_status', 'analytics_oee')`;
    expect(pQc!.n, "đối chứng chống-thu-hẹp hỏng: uQualityInspector KHÔNG được có hai khoá ấy").toBe(0);

    const [pQcTong] = await sql`SELECT count(*)::int AS n FROM permissions WHERE "userId" = ${ids.uQualityInspector}`;
    expect(pQcTong!.n, "uQualityInspector phải có quyền khác ≥3 hàng").toBeGreaterThanOrEqual(3);

    const [ga] = await sql`SELECT count(*)::int AS n FROM user_factory_assignments WHERE "factoryCode" = ${FAC_A}`;
    expect(ga!.n, "thiếu dữ kiện nền: gán nhà máy A").toBe(4);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ① KẾT CỤC — lớp rò phải bị chặn
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  it("★ ① vai 0 hàng quyền ⇒ `factory.list` bị CHẶN (FORBIDDEN), không còn rò tên/mã nhà máy", async () => {
    if (!coDb) throw new Error("HỎNG: không mở được CSDL test");
    const ma = await maLoiCua((await goi(ids.uKhongQuyen, "engineer")).list());
    expect(ma, "0 hàng quyền vẫn đọc được danh sách nhà máy ⇒ lỗ PH-03 còn mở").toBe("FORBIDDEN");
  });

  it("★ ② quyền DUY NHẤT đã hết hạn ⇒ cũng bị CHẶN (hàng chết không phải quyền)", async () => {
    if (!coDb) throw new Error("HỎNG: không mở được CSDL test");
    const ma = await maLoiCua((await goi(ids.uQuyenHetHan, "engineer")).list());
    expect(ma).toBe("FORBIDDEN");
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ② CHỐNG VÁ QUÁ TAY — bốn đối chứng DƯƠNG. Đây là phần chứng minh "không thu hẹp ai"
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  it("★ ③ vai twin (`machine_status/canView`) VẪN nhận đúng tập được gán", async () => {
    if (!coDb) throw new Error("HỎNG: không mở được CSDL test");
    const ds = maCua(await (await goi(ids.uMachineStatus, "engineer")).list());
    expect(ds).toContain(FAC_A);
    expect(ds).not.toContain(FAC_B);
  });

  it("★★★ ④ CHỐNG THU HẸP — vai `quality_inspector` (0 machine_status, 0 analytics_oee) VẪN nhận đúng tập được gán", async () => {
    if (!coDb) throw new Error("HỎNG: không mở được CSDL test");
    const ds = maCua(await (await goi(ids.uQualityInspector, "quality_inspector")).list());
    expect(
      ds,
      "cổng đã siết về một khoá module cụ thể ⇒ vừa vá một lỗ vừa mở một lỗ khác (8 màn Báo cáo/Phân tích mất bộ lọc nhà máy)",
    ).toContain(FAC_A);
    expect(ds).not.toContain(FAC_B);
  });

  it("★ ⑤ CHỐNG THU HẸP — quyền chỉ có `canExport` (canView=false) VẪN đi qua được", async () => {
    if (!coDb) throw new Error("HỎNG: không mở được CSDL test");
    const ds = maCua(await (await goi(ids.uChiCanExport, "engineer")).list());
    expect(ds).toContain(FAC_B);
    expect(ds).not.toContain(FAC_A);
  });

  it("★ ⑥ admin (0 hàng quyền) thấy CẢ HAI — vai toàn quyền giữ nguyên từng byte", async () => {
    if (!coDb) throw new Error("HỎNG: không mở được CSDL test");
    const ds = maCua(await (await goi(ids.uAdmin, "admin")).list());
    expect(ds).toEqual(expect.arrayContaining([FAC_A, FAC_B]));
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ③ HÀNG RÀO PHẠM VI KHÔNG ĐƯỢC NỚI — cổng quyền CỘNG THÊM, không thay thế bộ lọc phạm vi
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  it("★ ⑦ cổng quyền KHÔNG nới phạm vi — người có quyền nhưng 0 gán vẫn thấy 0 nhà máy", async () => {
    if (!coDb) throw new Error("HỎNG: không mở được CSDL test");
    // Gỡ gán của `uMachineStatus` trong một khoảnh khắc: quyền còn nguyên, phạm vi rỗng.
    await sql`DELETE FROM user_factory_assignments WHERE "userId" = ${ids.uMachineStatus}`;
    const { clearAssignmentCache } = await import("../_core/accessControl");
    clearAssignmentCache();
    try {
      const ds = await (await goi(ids.uMachineStatus, "engineer")).list();
      expect(Array.isArray(ds), "phải trả MẢNG, không phải ném — phạm vi rỗng ≠ thiếu quyền").toBe(true);
      expect(maCua(ds as Array<{ code: string }>)).not.toContain(FAC_A);
      expect(maCua(ds as Array<{ code: string }>)).not.toContain(FAC_B);
    } finally {
      await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ids.uMachineStatus}, ${FAC_A})`;
      clearAssignmentCache();
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ④ ĐỐI CHỨNG BIẾT KÊU — lưới này có phân biệt được hai thế giới không
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  it("★ ⑧ đối chứng — CÙNG người, CÙNG phiên: thêm một hàng quyền thì từ CHẶN thành ĐỌC ĐƯỢC", async () => {
    if (!coDb) throw new Error("HỎNG: không mở được CSDL test");
    // Trước: 0 quyền ⇒ chặn.
    expect(await maLoiCua((await goi(ids.uKhongQuyen, "engineer")).list())).toBe("FORBIDDEN");
    // Cấp ĐÚNG MỘT hàng quyền (module không liên quan gì tới nhà máy) ⇒ qua.
    await capQuyen(ids.uKhongQuyen, "dashboard", "dashboard_view");
    try {
      const ds = maCua(await (await goi(ids.uKhongQuyen, "engineer")).list());
      expect(ds, "một hàng quyền BẤT KỲ phải đủ — nếu không, cổng đã ghim vào một module cụ thể").toContain(FAC_A);
    } finally {
      await sql`DELETE FROM permissions WHERE "userId" = ${ids.uKhongQuyen}`;
    }
    // Sau khi gỡ lại: chặn lại. Hai chiều ⇒ lưới KÊU được, không phải luôn-đỏ hay luôn-xanh.
    expect(await maLoiCua((await goi(ids.uKhongQuyen, "engineer")).list())).toBe("FORBIDDEN");
  });
});
