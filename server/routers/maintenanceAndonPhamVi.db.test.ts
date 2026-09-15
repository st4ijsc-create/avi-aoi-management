/**
 * CỔNG CSDL THẬT — ĐỢT 15 LÔ R (L-1): **HÀNG RÀO TENANT CHO ĐƯỜNG GHI.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ LỖ ĐƯỢC ĐO, KHÔNG ĐƯỢC SUY
 * ══════════════════════════════════════════════════════════════════════════════
 * Lô Q1 vá đường ĐỌC (`digitalTwinRouter`). Cùng hình dạng còn nguyên ở đường
 * GHI, đo trên mã nguồn trước bản vá này:
 *
 *   `maintenanceRouter.createWorkOrder` khai `async ({ input })` — **KHÔNG bóc
 *     `ctx`**. `input.machineId` do client tự khai, chỉ dùng tra `machines.code`.
 *   `andonRouter.acknowledge` **CÓ** `ctx` nhưng chỉ để đóng dấu người tiếp
 *     nhận; **không kiểm `input.id` có thuộc phạm vi người gọi**.
 *
 * ⇒ Tài khoản có `machine_monitoring/canCreate` ở nhà máy A tạo được phiếu bảo
 *   trì cho máy của nhà máy B; tài khoản có `andon/canEdit` ở A tiếp nhận được
 *   cảnh báo của B. Cả hai chỉ cần đoán một số nguyên.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI CHIỀU — CHIỀU DƯƠNG LÀ CHIỀU DỄ MẤT
 * ══════════════════════════════════════════════════════════════════════════════
 *   (+) người gán nhà máy A ⇒ TẠO ĐƯỢC phiếu cho máy của A, và hàng có thật
 *       trong CSDL (xác nhận bằng SQL THÔ, không bằng giá trị router trả về)
 *   (−) CHÍNH người ấy      ⇒ BỊ CHẶN khi tạo phiếu cho máy của B
 *
 * Chiều (+) là đối chứng bắt buộc: một `throw` vô điều kiện làm chiều (−) xanh
 * hoàn hảo mà đã giết chức năng.
 *
 * ★ XÁC NHẬN BẰNG SQL THÔ, KHÔNG BẰNG GIÁ TRỊ TRẢ VỀ: router có thể trả một đối
 *   tượng trông đúng mà không ghi gì (hoặc ghi vào nơi khác). Đọc lại bằng một
 *   đường RỜI là mô hình thứ hai (BG-127).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★ G26 — CSDL CÓ **0 HÀNG `raised`** ⇒ LƯỚI TỰ DỰNG LẤY
 * ══════════════════════════════════════════════════════════════════════════════
 * Đo 2026-09-08: `SELECT count(*) FROM andon_events WHERE status='raised'` = 0.
 * `acknowledgeAndon` trả về NGUYÊN hàng (idempotent) khi `status <> 'raised'`,
 * nên một lưới mượn hàng có sẵn sẽ XANH vì một lý do SAI — nó không bao giờ chạm
 * nhánh ghi. Lưới này INSERT hàng `raised` của chính nó, rồi xoá lại.
 *
 * ★ G22 — không dựa vào bất kỳ dữ liệu seed nào: tự tạo 2 nhà máy · 2 xưởng ·
 *   2 chuyền · 2 trạm · 2 máy · 2 người dùng (một CÓ gán, một KHÔNG), rồi xoá
 *   đúng chừng ấy từ trong ra ngoài.
 *
 * ★ Ô **ĐỐI CHỨNG DANH TÍNH**: "0 gán" và "được gán A, hỏi B" cho CÙNG kết quả
 *   bị chặn. Không tách được hai câu ấy thì chiều (−) không chứng minh gì.
 *
 * ⚠ Vai đo là **KHÔNG-admin**. Admin BYPASS `requirePermission` ⇒ đo bằng admin
 *   chứng minh SỐ 0 về quyền. Có một ô riêng cho admin, nhưng để đo chiều DƯƠNG
 *   của `PhamViNguoiXem` (toàn quyền ⇒ không thêm mệnh đề nào).
 *
 * ★ G20 — import CHÍNH `maintenanceRouter` / `andonRouter` của module giao hàng.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { maintenanceRouter } from "./maintenanceRouter";
import { andonRouter } from "./andonRouter";
import { resolvePermissionModule } from "@shared/permissions";

const DB_URL = process.env.DATABASE_URL;

/** Hậu tố duy nhất cho mọi hàng lưới này tạo — để xoá lại đúng chừng ấy. */
const DAU = `R-L1-${Date.now()}`;

/** Vai KHÔNG phải admin. */
const VAI = "engineer";

let sql: ReturnType<typeof postgres>;

interface Fixture {
  facTrongId: number;
  facTrongCode: string;
  facNgoaiId: number;
  facNgoaiCode: string;
  userTrongId: number;
  userKhongGanId: number;
  workshopIds: number[];
  lineTrongId: number;
  lineNgoaiId: number;
  tramTrongId: number;
  tramNgoaiId: number;
  mayTrongId: number;
  mayNgoaiId: number;
  andonTrongId: number;
  andonNgoaiId: number;
  andonMoCoiId: number;
}
let fx: Fixture | null = null;
/** Mọi phiếu do lưới này tạo — xoá theo id ở `afterAll`. */
const phieuDaTao: number[] = [];
/**
 * ★ ĐỢT 25 — mọi `andon_events` do **THỦ TỤC** `raise`/`quickReport` tạo ra (khác
 * `taoAndonRaised`, vốn INSERT bằng SQL thô). Ghi lại id để `afterAll` xoá đúng
 * chừng ấy: một lưới để lại rác là một lưới làm hỏng phép đo của lần sau.
 */
const andonDaTao: number[] = [];

async function taoNhanh(code: string, ten: string) {
  const f = await sql`INSERT INTO factories (code, name) VALUES (${code}, ${ten}) RETURNING id`;
  const factoryId = (f[0] as unknown as { id: number }).id;
  const w = await sql`
    INSERT INTO workshops ("factoryId", code, name)
    VALUES (${factoryId}, ${`${code}-W`}, ${`${ten} xuong`}) RETURNING id`;
  const workshopId = (w[0] as unknown as { id: number }).id;
  const l = await sql`
    INSERT INTO production_lines ("workshopId", code, name)
    VALUES (${workshopId}, ${`${code}-L`}, ${`${ten} chuyen`}) RETURNING id`;
  const lineId = (l[0] as unknown as { id: number }).id;
  const s = await sql`
    INSERT INTO stations ("lineId", code, name)
    VALUES (${lineId}, ${`${code}-S`}, ${`${ten} tram`}) RETURNING id`;
  const stationId = (s[0] as unknown as { id: number }).id;
  // ⚠ `machineType` là enum NOT NULL — bỏ ra thì INSERT ném 23502.
  const m = await sql`
    INSERT INTO machines ("stationId", code, name, "machineType")
    VALUES (${stationId}, ${`${code}-M`}, ${`${ten} may`}, 'AOI') RETURNING id`;
  const machineId = (m[0] as unknown as { id: number }).id;
  return { factoryId, workshopId, lineId, stationId, machineId };
}

/** ★ G26 — hàng `raised` do lưới TỰ DỰNG (CSDL có 0 hàng như thế). */
async function taoAndonRaised(
  nhan: string,
  machineId: number | null,
  stationId: number | null,
  lineId: number | null,
): Promise<number> {
  const r = await sql`
    INSERT INTO andon_events (state, reason, status, title, "machineId", "stationId", "lineId", "raisedBySystem", "raisedAt")
    VALUES ('red', 'quality', 'raised', ${`${DAU}-${nhan}`}, ${machineId}, ${stationId}, ${lineId}, true, now())
    RETURNING id`;
  return (r[0] as unknown as { id: number }).id;
}

/**
 * ★★★ G43 — "BỊ CHẶN" CHƯA ĐỦ; PHẢI CHẶN **TỪ CỔNG NÀO**.
 *
 * Một mã 403/404 không nói nó đến từ đâu. Nếu ô (−) chỉ khai `rejects.toThrow()`
 * thì nó xanh y hệt khi `requirePermission` chặn trước (`PERMISSION_DENIED`) —
 * tức xanh mà **chưa hề chạm** hàng rào tenant, và vẫn xanh khi bản vá bị gỡ.
 *
 * Hàm này bắt lỗi rồi ĐỌC `appCode`: phải là `ENTITY_NOT_FOUND` (cổng phạm vi),
 * và **KHÔNG được** là `PERMISSION_DENIED` (cổng RBAC).
 */
async function chanBoiPhamVi(p: Promise<unknown>): Promise<void> {
  let err: any = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, "phải BỊ CHẶN, nhưng lời gọi đã THÀNH CÔNG").not.toBeNull();
  const appCode = err?.cause?.appCode ?? err?.appCode ?? err?.shape?.data?.appCode;
  expect(appCode, `chặn bởi cổng SAI: appCode=${appCode}`).not.toBe("PERMISSION_DENIED");
  expect(appCode).toBe("ENTITY_NOT_FOUND");
}

/** Caller mang danh tính một người dùng cụ thể. */
function goiMaint(userId: number, role: string = VAI) {
  return maintenanceRouter.createCaller({ user: { id: userId, role, name: "probe" } } as any);
}
function goiAndon(userId: number, role: string = VAI) {
  return andonRouter.createCaller({ user: { id: userId, role, name: "probe" } } as any);
}

describe.skipIf(!DB_URL)("L-1 — đường GHI lọc theo phạm vi tenant, hai chiều", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });

    const facTrongCode = `${DAU}-TRONG`;
    const facNgoaiCode = `${DAU}-NGOAI`;
    const trong = await taoNhanh(facTrongCode, `${DAU} TRONG`);
    const ngoai = await taoNhanh(facNgoaiCode, `${DAU} NGOAI`);

    const mkUser = async (suffix: string) => {
      const u = await sql`
        INSERT INTO users ("openId", username, name, role, "isActive")
        VALUES (${`${DAU}-${suffix}`}, ${`${DAU}-${suffix}`}, ${`${DAU} ${suffix}`}, ${VAI}, true)
        RETURNING id`;
      return (u[0] as unknown as { id: number }).id;
    };
    const userTrongId = await mkUser("trong");
    const userKhongGanId = await mkUser("khonggan");

    // ══════════════════════════════════════════════════════════════════════
    // ★★★ G43 — CẤP QUYỀN RBAC THẬT, NẾU KHÔNG MỌI Ô (−) XANH VÌ LÝ DO SAI
    // ══════════════════════════════════════════════════════════════════════
    // Chạy thử lần đầu KHÔNG có khối này: 4 ô ĐỎ, và mã lỗi là
    // `appCode: 'PERMISSION_DENIED'` — tức `requirePermission` chặn TRƯỚC khi
    // cổng phạm vi kịp chạy. Nghĩa là mọi ô (−) khi ấy xanh vì **RBAC**, không
    // vì hàng rào tenant, và chúng vẫn xanh y hệt nếu bản vá bị gỡ sạch.
    //
    // ⇒ Hai trục phải tách rời được: cấp ĐỦ quyền module cho `userTrong` và
    //   `userKhongGan`, để cái duy nhất còn phân biệt hai người là **phạm vi
    //   nhà máy**. Ô nào đỏ sau đó là đỏ vì tenant, và ta kiểm `appCode` để
    //   chắc điều ấy (G43: một mã 403 không nói nó đến từ cổng nào).
    //
    // ⚠ `machine_monitoring` bị **ALIAS** sang `machine_status`
    //   (`resolvePermissionModule`, doc 40). Cấp theo chuỗi khai trong router
    //   sẽ ghi hàng `machine_monitoring` mà `checkPermission` không bao giờ
    //   đọc tới ⇒ vẫn 403. Gọi CHÍNH hàm alias thay vì chép tay tên đã suy.
    // ⚠ `category` là ENUM (`permissioncategoryenum`), KHÔNG phải varchar tự do:
    //   một giá trị bịa (`'system'`) ném `22P02` chứ không âm thầm bỏ qua. Giá
    //   trị dùng ở đây lấy từ ĐÚNG cặp (category, moduleName) đang có thật trong
    //   `permissions` của CSDL, không phải đoán.
    const capQuyen = async (userId: number, category: string, moduleName: string) => {
      await sql`
        INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport")
        VALUES (${userId}, ${category}::permissioncategoryenum, ${resolvePermissionModule(moduleName)},
                true, true, true, true, true)`;
    };
    for (const uid of [userTrongId, userKhongGanId]) {
      await capQuyen(uid, "machine_monitoring", "machine_monitoring");
      await capQuyen(uid, "andon", "andon");
    }
    // ⚠ Nối bằng `factoryCode`, KHÔNG phải `factoryId` — bảng này không có cột
    //   `factoryId`, dùng sai tên sẽ ném `42703`.
    await sql`
      INSERT INTO user_factory_assignments ("userId", "factoryCode")
      VALUES (${userTrongId}, ${facTrongCode})`;

    fx = {
      facTrongId: trong.factoryId,
      facTrongCode,
      facNgoaiId: ngoai.factoryId,
      facNgoaiCode,
      userTrongId,
      userKhongGanId,
      workshopIds: [trong.workshopId, ngoai.workshopId],
      lineTrongId: trong.lineId,
      lineNgoaiId: ngoai.lineId,
      tramTrongId: trong.stationId,
      tramNgoaiId: ngoai.stationId,
      mayTrongId: trong.machineId,
      mayNgoaiId: ngoai.machineId,
      andonTrongId: await taoAndonRaised("trong", trong.machineId, trong.stationId, trong.lineId),
      andonNgoaiId: await taoAndonRaised("ngoai", ngoai.machineId, ngoai.stationId, ngoai.lineId),
      // Hàng NULL cả ba trục — hình dạng mà luật fail-CLOSED nói về.
      andonMoCoiId: await taoAndonRaised("mocoi", null, null, null),
    };
  }, 60_000);

  afterAll(async () => {
    if (fx) {
      if (phieuDaTao.length) {
        await sql`DELETE FROM work_order_parts WHERE "workOrderId" = ANY(${phieuDaTao})`;
        await sql`DELETE FROM maintenance_work_orders WHERE id = ANY(${phieuDaTao})`;
      }
      await sql`DELETE FROM andon_events WHERE id = ANY(${[fx.andonTrongId, fx.andonNgoaiId, fx.andonMoCoiId, ...andonDaTao]})`;
      // ⚠⚠ DỌN THEO DẤU VẾT, KHÔNG CHỈ THEO ID ĐÃ GHI. Đo được 2026-09-15: khi chạy
      //   **ablation** (gỡ cổng phạm vi ra để xem lưới có đỏ lại không), các ô (−) ở
      //   khối "ĐỢT 25" THÀNH CÔNG và ghi hàng thật — nhưng chúng không bao giờ vào
      //   `andonDaTao`, vì nhánh ấy chỉ chạy khi lời gọi trả về. Ba lượt ablation để
      //   lại 7 hàng rác trên DB test. Một lưới chỉ dọn được dấu vết của mình khi bản
      //   vá còn nguyên là một lưới dọn dở đúng lúc cần nhất.
      await sql`DELETE FROM andon_events WHERE title LIKE ${`${DAU}%`}`;
      await sql`DELETE FROM machines WHERE id = ANY(${[fx.mayTrongId, fx.mayNgoaiId]})`;
      await sql`DELETE FROM stations WHERE id = ANY(${[fx.tramTrongId, fx.tramNgoaiId]})`;
      await sql`DELETE FROM production_lines WHERE id = ANY(${[fx.lineTrongId, fx.lineNgoaiId]})`;
      await sql`DELETE FROM workshops WHERE id = ANY(${fx.workshopIds})`;
      await sql`DELETE FROM permissions WHERE "userId" = ANY(${[fx.userTrongId, fx.userKhongGanId]})`;
      await sql`DELETE FROM user_factory_assignments WHERE "userId" = ANY(${[fx.userTrongId, fx.userKhongGanId]})`;
      await sql`DELETE FROM users WHERE id = ANY(${[fx.userTrongId, fx.userKhongGanId]})`;
      await sql`DELETE FROM factories WHERE id = ANY(${[fx.facTrongId, fx.facNgoaiId]})`;
    }
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("ca dương DỰNG ĐƯỢC THẬT — nếu không, mọi ô dưới đo trên tập rỗng", () => {
    expect(fx).not.toBeNull();
    expect(fx!.mayTrongId).not.toBe(fx!.mayNgoaiId);
    expect(fx!.andonTrongId).not.toBe(fx!.andonNgoaiId);
  });

  it("★★★ ĐỐI CHỨNG DANH TÍNH — người thử được gán ĐÚNG MỘT nhà máy, không phải 0", async () => {
    const g = await sql`
      SELECT "factoryCode" FROM user_factory_assignments WHERE "userId" = ${fx!.userTrongId}`;
    expect((g as unknown as Array<{ factoryCode: string }>).map((r) => r.factoryCode)).toEqual([
      fx!.facTrongCode,
    ]);
    const g2 = await sql`
      SELECT "factoryCode" FROM user_factory_assignments WHERE "userId" = ${fx!.userKhongGanId}`;
    expect(g2).toHaveLength(0);
  });

  it("★ G26 — hàng `raised` là do LƯỚI dựng, và nó THẬT SỰ ở trạng thái `raised`", async () => {
    // Nếu ô này đỏ, mọi ô `acknowledge` bên dưới đo nhánh idempotent, không đo
    // nhánh GHI — xanh vì lý do sai.
    const r = await sql`
      SELECT id, status FROM andon_events
       WHERE id = ANY(${[fx!.andonTrongId, fx!.andonNgoaiId, fx!.andonMoCoiId]})`;
    const rows = r as unknown as Array<{ id: number; status: string }>;
    expect(rows).toHaveLength(3);
    expect(rows.every((x) => x.status === "raised")).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("maintenance.createWorkOrder — LỖ L-1 CHÍNH", () => {
    it("★★★ CHIỀU (+) — người gán A TẠO ĐƯỢC phiếu cho máy của A, và hàng CÓ THẬT trong CSDL", async () => {
      const row: any = await goiMaint(fx!.userTrongId).createWorkOrder({
        machineId: fx!.mayTrongId,
        title: `${DAU} phieu hop le`,
        type: "CORRECTIVE",
        priority: 3,
        status: "OPEN",
      });
      expect(row?.id).toBeTypeOf("number");
      phieuDaTao.push(row.id);

      // ★ Mô hình thứ hai: đọc lại bằng SQL THÔ, không tin giá trị router trả về.
      const kt = await sql`
        SELECT "machineId" FROM maintenance_work_orders WHERE id = ${row.id}`;
      expect(kt).toHaveLength(1);
      expect((kt[0] as unknown as { machineId: number }).machineId).toBe(fx!.mayTrongId);
    });

    it("★★★ CHIỀU (−) — CHÍNH người ấy BỊ CHẶN khi tạo phiếu cho máy của B", async () => {
      await chanBoiPhamVi(
        goiMaint(fx!.userTrongId).createWorkOrder({
          machineId: fx!.mayNgoaiId,
          title: `${DAU} phieu xuyen tenant`,
          type: "CORRECTIVE",
          priority: 3,
          status: "OPEN",
        }),
      );

      // ★ Và KHÔNG có hàng nào được ghi — "bị chặn" phải nghĩa là 0 byte đổi.
      const kt = await sql`
        SELECT count(*)::int AS n FROM maintenance_work_orders
         WHERE "machineId" = ${fx!.mayNgoaiId} AND title LIKE ${`${DAU}%`}`;
      expect((kt[0] as unknown as { n: number }).n).toBe(0);
    });

    it("người 0 gán KHÔNG tạo được phiếu cho máy nào — kể cả máy có thật", async () => {
      await chanBoiPhamVi(
        goiMaint(fx!.userKhongGanId).createWorkOrder({
          machineId: fx!.mayTrongId,
          title: `${DAU} 0 gan`,
          type: "CORRECTIVE",
          priority: 3,
          status: "OPEN",
        }),
      );
    });

    it("admin KHÔNG bị thu hẹp — chiều DƯƠNG của `PhamViNguoiXem` (toàn quyền ⇒ không lọc)", async () => {
      // ⚠ Ô này KHÔNG chứng minh an toàn (admin bypass mọi cổng). Nó chặn bản vá
      //   quá tay làm hỏng vai toàn quyền.
      const row: any = await goiMaint(fx!.userTrongId, "admin").createWorkOrder({
        machineId: fx!.mayNgoaiId,
        title: `${DAU} admin`,
        type: "CORRECTIVE",
        priority: 3,
        status: "OPEN",
      });
      expect(row?.id).toBeTypeOf("number");
      phieuDaTao.push(row.id);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("maintenance — đường GHI theo `id` TỰ KHAI (update / close / delete)", () => {
    /** Phiếu của nhà máy B, dựng bằng SQL thô — người A không được chạm. */
    async function phieuCuaB(): Promise<number> {
      const r = await sql`
        INSERT INTO maintenance_work_orders
          ("workOrderNumber", "machineId", type, status, trigger, priority, title)
        VALUES (${`${DAU}-B-${Math.random().toString(36).slice(2, 8)}`}, ${fx!.mayNgoaiId},
                'CORRECTIVE', 'OPEN', 'MANUAL', 3, ${`${DAU} cua B`})
        RETURNING id`;
      const id = (r[0] as unknown as { id: number }).id;
      phieuDaTao.push(id);
      return id;
    }

    it("★★★ `updateWorkOrder` trên phiếu của B ⇒ BỊ CHẶN, và phiếu KHÔNG đổi", async () => {
      const id = await phieuCuaB();
      await chanBoiPhamVi(
        goiMaint(fx!.userTrongId).updateWorkOrder({ id, title: `${DAU} bi sua trom` }),
      );
      const kt = await sql`SELECT title FROM maintenance_work_orders WHERE id = ${id}`;
      expect((kt[0] as unknown as { title: string }).title).toBe(`${DAU} cua B`);
    });

    it("★★★ `deleteWorkOrder` trên phiếu của B ⇒ BỊ CHẶN, và phiếu VẪN CÒN", async () => {
      const id = await phieuCuaB();
      await chanBoiPhamVi(goiMaint(fx!.userTrongId).deleteWorkOrder({ id }));
      const kt = await sql`SELECT count(*)::int AS n FROM maintenance_work_orders WHERE id = ${id}`;
      expect((kt[0] as unknown as { n: number }).n).toBe(1);
    });

    it("★★★ `closeWorkOrder` trên phiếu của B ⇒ BỊ CHẶN, trạng thái VẪN `OPEN`", async () => {
      const id = await phieuCuaB();
      await chanBoiPhamVi(goiMaint(fx!.userTrongId).closeWorkOrder({ id }));
      const kt = await sql`SELECT status FROM maintenance_work_orders WHERE id = ${id}`;
      expect((kt[0] as unknown as { status: string }).status).toBe("OPEN");
    });

    it("★★★ CHIỀU (+) — chính người ấy SỬA ĐƯỢC phiếu của A (đối chứng chống vá quá tay)", async () => {
      const row: any = await goiMaint(fx!.userTrongId).createWorkOrder({
        machineId: fx!.mayTrongId,
        title: `${DAU} phieu de sua`,
        type: "CORRECTIVE",
        priority: 3,
        status: "OPEN",
      });
      phieuDaTao.push(row.id);
      const sua: any = await goiMaint(fx!.userTrongId).updateWorkOrder({
        id: row.id,
        title: `${DAU} da sua`,
      });
      expect(sua?.title).toBe(`${DAU} da sua`);
      const kt = await sql`SELECT title FROM maintenance_work_orders WHERE id = ${row.id}`;
      expect((kt[0] as unknown as { title: string }).title).toBe(`${DAU} da sua`);
    });

    it("`listWorkOrders` — KHÔNG thấy phiếu của B", async () => {
      const idB = await phieuCuaB();
      const rows: any[] = await goiMaint(fx!.userTrongId).listWorkOrders({ limit: 500 });
      const ids = rows.map((r) => r.id);
      expect(ids).not.toContain(idB);
    });

    it("`getWorkOrder` theo `id` TỰ KHAI của phiếu B ⇒ NOT_FOUND, không phải nội dung phiếu ấy", async () => {
      const idB = await phieuCuaB();
      await chanBoiPhamVi(goiMaint(fx!.userTrongId).getWorkOrder({ id: idB }));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("andon.acknowledge / resolve — `ctx` CÓ mà cổng KHÔNG", () => {
    it("★★★ CHIỀU (−) — người gán A BỊ CHẶN trên andon của B, và hàng B VẪN `raised`", async () => {
      await chanBoiPhamVi(goiAndon(fx!.userTrongId).acknowledge({ id: fx!.andonNgoaiId }));
      // "bị chặn" phải nghĩa là 0 byte đổi — kể cả `acknowledgedAt`/`mttaSeconds`.
      const kt = await sql`
        SELECT status, "acknowledgedBy", "acknowledgedAt" FROM andon_events WHERE id = ${fx!.andonNgoaiId}`;
      const row = kt[0] as unknown as { status: string; acknowledgedBy: number | null; acknowledgedAt: Date | null };
      expect(row.status).toBe("raised");
      expect(row.acknowledgedBy).toBeNull();
      expect(row.acknowledgedAt).toBeNull();
    });

    it("★★★ `resolve` trên andon của B ⇒ BỊ CHẶN (vá xong phải kiểm NHÁNH KIA)", async () => {
      await chanBoiPhamVi(goiAndon(fx!.userTrongId).resolve({ id: fx!.andonNgoaiId, notes: "trom" }));
      const kt = await sql`SELECT status FROM andon_events WHERE id = ${fx!.andonNgoaiId}`;
      expect((kt[0] as unknown as { status: string }).status).toBe("raised");
    });

    it("★★★ hàng NULL CẢ BA trục ⇒ fail-CLOSED cho người bị thu hẹp", async () => {
      // Quyết định đã ghi ở docblock `andonRouter`: không có đường nào truy ra
      // nhà máy ⇒ người bị thu hẹp KHÔNG chạm được.
      await chanBoiPhamVi(goiAndon(fx!.userTrongId).acknowledge({ id: fx!.andonMoCoiId }));
      const kt = await sql`SELECT status FROM andon_events WHERE id = ${fx!.andonMoCoiId}`;
      expect((kt[0] as unknown as { status: string }).status).toBe("raised");
    });

    it("người 0 gán BỊ CHẶN trên andon có thật của A", async () => {
      await chanBoiPhamVi(goiAndon(fx!.userKhongGanId).resolve({ id: fx!.andonTrongId }));
    });

    it("★★★ CHIỀU (+) — người gán A TIẾP NHẬN ĐƯỢC andon của A, và CSDL đổi thật", async () => {
      // ⚠ Ô này chạy SAU các ô (−) vì nó ĐỔI trạng thái hàng `andonTrongId` từ
      //   `raised` sang `acknowledged`; đặt trước sẽ làm ô "0 gán" ở trên đo
      //   nhánh idempotent thay vì nhánh ghi.
      const r: any = await goiAndon(fx!.userTrongId).acknowledge({ id: fx!.andonTrongId });
      expect(r?.status).toBe("acknowledged");
      // ★ Mô hình thứ hai — đọc lại bằng SQL thô.
      const kt = await sql`
        SELECT status, "acknowledgedBy" FROM andon_events WHERE id = ${fx!.andonTrongId}`;
      const row = kt[0] as unknown as { status: string; acknowledgedBy: number };
      expect(row.status).toBe("acknowledged");
      expect(row.acknowledgedBy).toBe(fx!.userTrongId);
    });

    it("★★★ …và vai TOÀN QUYỀN vẫn chạm được hàng mồ côi — nó không thành rác vĩnh viễn", async () => {
      const r: any = await goiAndon(fx!.userTrongId, "admin").acknowledge({ id: fx!.andonMoCoiId });
      expect(r?.status).toBe("acknowledged");
    });
  });
  /* ═══════════════════════════════════════════════════════════════════════ */
  /* ★★★ ĐỢT 24 VIỆC 1 — ĐƯỜNG **ĐỌC**, LỖ Ở VỎ ỨNG DỤNG                     */
  /* ═══════════════════════════════════════════════════════════════════════ */
  /*
   * Lô R (ở trên) vá đường GHI và DỪNG Ở ĐÓ. Bốn thủ tục ĐỌC vẫn khai
   * `async ({ input })` / `async ()` — không bóc `ctx`. Nguy hiểm nhất là
   * `active`: `ShellAlertChip.tsx:43` poll nó mỗi 15 s ở **header vỏ**, nên
   * MỌI màn của MỌI vai đọc andon của mọi tenant.
   *
   * ⚠ Vì sao ĐẾM THEO NHÃN chứ không đếm tổng: CSDL dev có andon THẬT của
   *   `SIM-FAC` (7 hàng mở, đo 2026-09-08) đứng cạnh hàng của lưới. Một phép
   *   `toHaveLength(n)` trên tổng sẽ đỏ/xanh theo dữ liệu dev chứ không theo
   *   bản vá — đúng lớp "lưới đo thứ mình không điều khiển". Ta lọc theo `DAU`
   *   (hậu tố duy nhất của lưới này) rồi mới đếm.
   */
  describe("★★★ ĐỢT 24 — andon.active / list / get / metrics: đường ĐỌC", () => {
    /** Chỉ giữ hàng do CHÍNH lưới này dựng — xem chú thích khối. */
    const cuaLuoi = (rows: any[]) =>
      (rows ?? []).filter((r) => typeof r?.title === "string" && r.title.startsWith(DAU));

    it("★★★ CHIỀU (−) — người gán A KHÔNG thấy andon của B trong `active`", async () => {
      const rows: any[] = await goiAndon(fx!.userTrongId).active();
      const ids = cuaLuoi(rows).map((r) => r.id);
      expect(ids).toContain(fx!.andonTrongId);
      expect(ids).not.toContain(fx!.andonNgoaiId);
      // Hàng mồ côi (NULL cả ba) — fail-CLOSED.
      expect(ids).not.toContain(fx!.andonMoCoiId);
    });

    it("★★★ người 0 gán thấy **ĐÚNG 0 hàng** — badge vỏ phải là 0", async () => {
      // ⚠ Ở đây đếm TỔNG là đúng và bắt buộc: phạm vi rỗng nghĩa là 0 hàng của
      //   BẤT KỲ ai, kể cả 7 hàng `SIM-FAC` có thật trong CSDL dev. Đây chính
      //   là con số badge đọc.
      const rows: any[] = await goiAndon(fx!.userKhongGanId).active();
      expect(rows).toHaveLength(0);
    });

    it("★ đối chứng: vai TOÀN QUYỀN vẫn thấy CẢ HAI (chống vá quá tay)", async () => {
      const rows: any[] = await goiAndon(fx!.userTrongId, "admin").active();
      const ids = cuaLuoi(rows).map((r) => r.id);
      expect(ids).toContain(fx!.andonTrongId);
      expect(ids).toContain(fx!.andonNgoaiId);
      expect(ids).toContain(fx!.andonMoCoiId);
    });

    it("★★★ `list` — không thấy andon của B, và thấy của A", async () => {
      const rows: any[] = await goiAndon(fx!.userTrongId).list({ limit: 500 });
      const ids = cuaLuoi(rows).map((r) => r.id);
      expect(ids).toContain(fx!.andonTrongId);
      expect(ids).not.toContain(fx!.andonNgoaiId);
    });

    it("★★★ `list` — bộ lọc TỰ KHAI `lineId` của B vẫn cho 0 hàng", async () => {
      // Cổng tenant phải ĐỨNG CẠNH bộ lọc tự khai, không bị nó thay thế.
      const rows: any[] = await goiAndon(fx!.userTrongId).list({ lineId: fx!.lineNgoaiId, limit: 500 });
      expect(cuaLuoi(rows)).toHaveLength(0);
    });

    it("★★★ `get` theo `id` TỰ KHAI của andon B ⇒ NOT_FOUND (không phải nội dung)", async () => {
      await chanBoiPhamVi(goiAndon(fx!.userTrongId).get({ id: fx!.andonNgoaiId }));
    });

    it("★ CHIỀU (+) — `get` andon của A vẫn ĐỌC ĐƯỢC", async () => {
      const r: any = await goiAndon(fx!.userTrongId).get({ id: fx!.andonTrongId });
      expect(r?.id).toBe(fx!.andonTrongId);
    });

    it("★★★ `metrics` — người 0 gán đọc ra **total 0**, không phải nhịp của nhà máy khác", async () => {
      const m: any = await goiAndon(fx!.userKhongGanId).metrics({ sinceHours: 24 * 90 });
      expect(m?.total).toBe(0);
      expect(m?.active).toBe(0);
    });

    it("★ đối chứng `metrics`: vai toàn quyền vẫn đếm được > 0", async () => {
      const m: any = await goiAndon(fx!.userTrongId, "admin").metrics({ sinceHours: 24 * 90 });
      expect(m?.total).toBeGreaterThan(0);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* ★★★ ĐỢT 25 VIỆC 1 — `raise` / `quickReport`: ĐƯỜNG **BẬT** CẢNH BÁO      */
  /* ═══════════════════════════════════════════════════════════════════════ */
  /*
   * ══════════════════════════════════════════════════════════════════════════
   * ★★★ LÔ R VÁ `acknowledge`/`resolve`, ĐỢT 24 VÁ ĐƯỜNG ĐỌC — HAI THỦ TỤC
   *     BẬT CẢNH BÁO VẪN CÒN NGUYÊN.
   * ══════════════════════════════════════════════════════════════════════════
   * Đo trên mã trước bản vá này (`andonRouter.ts:199` và `:239`): cả hai khai
   * `async ({ input, ctx })` và **có** `ctx` — nhưng `ctx` chỉ để đóng dấu
   * `raisedBy`, y hệt cái bẫy mà docblock đầu tệp đã đặt tên:
   *
   *       có `ctx`  ≠  có kiểm phạm vi.
   *
   * `input.machineId` / `input.lineId` / `input.stationId` / `input.machineCode`
   * đều do client TỰ KHAI, và KHÔNG có một lời gọi `congPhamViAndon` /
   * `trongPhamVi` nào trong thân hai thủ tục ⇒ một tài khoản có `andon/canCreate`
   * ở nhà máy A **bật được đèn đỏ trên máy của nhà máy B** bằng cách đoán một số
   * nguyên (hoặc gõ một mã máy). Đó là một thao tác DỪNG CHUYỀN tiềm năng: nó
   * hiện trên bảng Andon của B, dập MTTA của B, và (với `state: red`) kích luôn
   * đường thông báo của B.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * ★★★ VÌ SAO KHUÔN Ở ĐÂY LÀ **`createWorkOrder`** CHỨ KHÔNG PHẢI
   *     `congPhamViAndon` — HAI CHIỀU, HAI PHÉP GHÉP
   * ══════════════════════════════════════════════════════════════════════════
   * `congPhamViAndon` gác một hàng ĐÃ CÓ, và ghép ba trục bằng **HOẶC**: hàng
   * thuộc về ai thì chỉ cần MỘT trục khai đúng nhà máy ấy là đủ (một hàng khai
   * `machineId` của A mà `stationId` NULL vẫn là hàng của A).
   *
   * Đường GHI đi ngược chiều: ba trục là ĐÍCH do người gọi tự khai, và ghép bằng
   * HOẶC sẽ mở đúng cánh cửa vừa đóng — gửi `machineId` = máy của A **kèm**
   * `lineId` = chuyền của B thì vế A làm cả câu đúng, hàng ghi xuống mang
   * `lineId` của B, và vì cổng ĐỌC cũng là HOẶC nên nó hiện ngay trên bảng của
   * B. Nên cổng ghi phải là **VÀ trên các trục ĐÃ KHAI**: mọi trục người gọi
   * nêu tên đều phải nằm trong phạm vi của họ. Đó đúng là khuôn
   * `maintenance.createWorkOrder` (`maintenanceRouter.ts:195`) — `trongPhamVi`
   * cho ĐÍCH tự khai, `NOT_FOUND` khi trượt — chỉ nhân lên ba trục.
   *
   * ⚠ **KHÔNG khai trục nào ⇒ KHÔNG chặn.** `OperatorHome.tsx:193` ("Gọi bảo
   *   trì") gọi `andon.raise` với ĐÚNG `state`/`reason`/`title` và **không** máy,
   *   trạm, chuyền. Bắt nó fail-closed như hàng mồ côi ở đường ĐỌC sẽ giết một
   *   nút đang chạy thật của mọi vai không-admin — "vá quá tay thành chặn tất
   *   cả". Hàng vô chủ ấy KHÔNG rò sang tenant nào (cổng đọc fail-CLOSED đã
   *   giấu nó khỏi mọi người bị thu hẹp), nên ô cuối khối này ĐO điều đó thay vì
   *   suy đoán.
   */
  describe("★★★ ĐỢT 25 — andon.raise / quickReport: cổng phạm vi cho ĐÍCH TỰ KHAI", () => {
    /** Đếm andon gắn vào một máy, KHÔNG tính hàng fixture dựng sẵn. */
    async function demAndonCuaMay(machineId: number, tru: number[]): Promise<number> {
      const r = await sql`
        SELECT count(*)::int AS n FROM andon_events
         WHERE "machineId" = ${machineId} AND NOT (id = ANY(${tru}))`;
      return (r[0] as unknown as { n: number }).n;
    }

    it("ca dương DỰNG ĐƯỢC THẬT — hai máy/hai chuyền khác nhau (chống đo trên tập rỗng)", () => {
      expect(fx!.mayNgoaiId).not.toBe(fx!.mayTrongId);
      expect(fx!.lineNgoaiId).not.toBe(fx!.lineTrongId);
    });

    it("★★★ CHIỀU (−) — `raise` lên MÁY của B ⇒ NOT_FOUND, và 0 hàng được ghi", async () => {
      const truoc = await demAndonCuaMay(fx!.mayNgoaiId, [fx!.andonNgoaiId]);
      expect(truoc).toBe(0);
      await chanBoiPhamVi(
        goiAndon(fx!.userTrongId).raise({
          state: "red",
          reason: "quality",
          title: `${DAU} raise xuyen tenant`,
          machineId: fx!.mayNgoaiId,
        }),
      );
      expect(await demAndonCuaMay(fx!.mayNgoaiId, [fx!.andonNgoaiId])).toBe(0);
    });

    it("★★★ CHIỀU (−) — `raise` lên CHUYỀN của B ⇒ NOT_FOUND (trục chuyền, không chỉ trục máy)", async () => {
      await chanBoiPhamVi(
        goiAndon(fx!.userTrongId).raise({
          state: "yellow",
          reason: "material",
          title: `${DAU} raise chuyen B`,
          lineId: fx!.lineNgoaiId,
        }),
      );
      const kt = await sql`
        SELECT count(*)::int AS n FROM andon_events
         WHERE "lineId" = ${fx!.lineNgoaiId} AND title LIKE ${`${DAU}%`} AND id <> ${fx!.andonNgoaiId}`;
      expect((kt[0] as unknown as { n: number }).n).toBe(0);
    });

    it("★★★ CHIỀU (−) — `raise` TRỘN máy của A + chuyền của B ⇒ NOT_FOUND (VÀ, không phải HOẶC)", async () => {
      // ⚠ Đây là ô phân biệt hai phép ghép. Với HOẶC, vế "máy của A" làm cả câu
      //   đúng và hàng ghi xuống vẫn mang `lineId` của B — tức cảnh báo hiện
      //   trên bảng của B. Ô này phải ĐỎ ở bản HOẶC.
      await chanBoiPhamVi(
        goiAndon(fx!.userTrongId).raise({
          state: "red",
          reason: "safety",
          title: `${DAU} raise tron truc`,
          machineId: fx!.mayTrongId,
          lineId: fx!.lineNgoaiId,
        }),
      );
      const kt = await sql`
        SELECT count(*)::int AS n FROM andon_events
         WHERE title = ${`${DAU} raise tron truc`}`;
      expect((kt[0] as unknown as { n: number }).n).toBe(0);
    });

    it("★★★ CHIỀU (−) — `quickReport` với `machineId` của B ⇒ NOT_FOUND, và 0 hàng", async () => {
      await chanBoiPhamVi(
        goiAndon(fx!.userTrongId).quickReport({
          machineId: fx!.mayNgoaiId,
          description: `${DAU} quick xuyen tenant`,
        }),
      );
      expect(await demAndonCuaMay(fx!.mayNgoaiId, [fx!.andonNgoaiId])).toBe(0);
    });

    it("★★★ CHIỀU (−) — `quickReport` với **MÃ MÁY** của B ⇒ NOT_FOUND (đường tra mã, không chỉ đường id)", async () => {
      // `quickReport` tự tra `machines.code` → id. Vá ở nhánh `machineId` mà bỏ
      // nhánh `machineCode` là để nguyên cánh cửa ("vá xong kiểm NHÁNH KIA").
      const maB = `${fx!.facNgoaiCode}-M`;
      const kt0 = await sql`SELECT id FROM machines WHERE code = ${maB}`;
      expect(kt0, "mã máy của B phải TỒN TẠI, nếu không ô này đo hư không").toHaveLength(1);
      await chanBoiPhamVi(
        goiAndon(fx!.userTrongId).quickReport({
          machineCode: maB,
          description: `${DAU} quick theo ma`,
        }),
      );
      expect(await demAndonCuaMay(fx!.mayNgoaiId, [fx!.andonNgoaiId])).toBe(0);
    });

    it("người 0 gán BỊ CHẶN khi raise lên máy CÓ THẬT của A", async () => {
      await chanBoiPhamVi(
        goiAndon(fx!.userKhongGanId).raise({
          state: "red",
          reason: "quality",
          title: `${DAU} 0 gan raise`,
          machineId: fx!.mayTrongId,
        }),
      );
    });

    it("★★★ CHIỀU (+) — người gán A RAISE ĐƯỢC lên máy của A, và hàng CÓ THẬT trong CSDL", async () => {
      // ⚠ `reason: setup` để KHÔNG rơi vào cửa sổ idempotency 30 s của hàng
      //   fixture (`reason: quality` trên cùng máy) — nếu không, thủ tục UPDATE
      //   hàng cũ và ô này xanh mà chưa hề chạm nhánh INSERT.
      const r: any = await goiAndon(fx!.userTrongId).raise({
        state: "yellow",
        reason: "setup",
        title: `${DAU} raise hop le`,
        machineId: fx!.mayTrongId,
      });
      expect(r?.id).toBeTypeOf("number");
      andonDaTao.push(r.id);
      const kt = await sql`
        SELECT "machineId", "raisedBy", title FROM andon_events WHERE id = ${r.id}`;
      expect(kt).toHaveLength(1);
      const row = kt[0] as unknown as { machineId: number; raisedBy: number; title: string };
      expect(row.machineId).toBe(fx!.mayTrongId);
      expect(row.raisedBy).toBe(fx!.userTrongId);
    });

    it("★★★ CHIỀU (+) — người gán A `quickReport` ĐƯỢC lên máy của A", async () => {
      const r: any = await goiAndon(fx!.userTrongId).quickReport({
        machineId: fx!.mayTrongId,
        description: `${DAU} quick hop le`,
      });
      expect(r?.andonId).toBeTypeOf("number");
      andonDaTao.push(r.andonId);
      const kt = await sql`SELECT "machineId" FROM andon_events WHERE id = ${r.andonId}`;
      expect((kt[0] as unknown as { machineId: number }).machineId).toBe(fx!.mayTrongId);
    });

    it("★ ĐỐI CHỨNG CHỐNG VÁ QUÁ TAY — vai TOÀN QUYỀN vẫn raise được lên máy của B", async () => {
      const r: any = await goiAndon(fx!.userTrongId, "admin").raise({
        state: "yellow",
        reason: "setup",
        title: `${DAU} admin raise B`,
        machineId: fx!.mayNgoaiId,
      });
      expect(r?.id).toBeTypeOf("number");
      andonDaTao.push(r.id);
    });

    it("★★★ ĐỐI CHỨNG CHỐNG VÁ QUÁ TAY — 'Gọi bảo trì' (KHÔNG khai trục nào) VẪN raise được", async () => {
      // `OperatorHome.tsx:193` gọi đúng hình dạng này. Nếu ô này đỏ thì bản vá
      // đã giết một nút đang chạy thật của mọi vai không-admin.
      const r: any = await goiAndon(fx!.userTrongId).raise({
        state: "call",
        reason: "maintenance",
        title: `${DAU} goi bao tri khong dich`,
      });
      expect(r?.id).toBeTypeOf("number");
      andonDaTao.push(r.id);
      const kt = await sql`
        SELECT "machineId", "stationId", "lineId" FROM andon_events WHERE id = ${r.id}`;
      const row = kt[0] as unknown as { machineId: null; stationId: null; lineId: null };
      expect(row.machineId).toBeNull();
      expect(row.stationId).toBeNull();
      expect(row.lineId).toBeNull();
    });

    it("★★★ …và hàng vô chủ ấy KHÔNG rò sang ai — người 0 gán vẫn đọc ra ĐÚNG 0 hàng", async () => {
      // Đây là lý do "không khai trục nào ⇒ không chặn" KHÔNG phải một cái lỗ:
      // cổng ĐỌC fail-CLOSED giấu hàng mồ côi khỏi mọi người bị thu hẹp.
      const rows: any[] = await goiAndon(fx!.userKhongGanId).active();
      expect(rows).toHaveLength(0);
    });
  });
});
