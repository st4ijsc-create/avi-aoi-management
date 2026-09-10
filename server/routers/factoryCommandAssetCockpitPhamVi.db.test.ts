/**
 * CỔNG CSDL THẬT — ĐỢT 40 (QA Đợt 39 Pareto #2, G113): **HÀNG RÀO TENANT CHO NGUỒN SỰ THẬT CỦA BA MÀN TWIN.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ LỖ ĐƯỢC ĐO, KHÔNG ĐƯỢC SUY
 * ══════════════════════════════════════════════════════════════════════════════
 * `.qa-dot39/qd18/B-1600x900.json` (dist, HTTP thật): `operator1` (id 48, **0 hàng**
 * `user_factory_assignments`) gọi `factoryCommand.overview(1)` ⇒ 200 / **41 máy**, `overview(18)` ⇒
 * 200 / 1, `assetCockpit.machineDetail(257)` ⇒ 200 + identity máy nhà máy 18. Hai router có **0** tham
 * chiếu `phamViCua`/`trongPhamVi`. Đợt 34 đưa nguồn trạng thái của `/twin`, Line, Máy về chính
 * `overview` — UI che được (EmptyState), dữ liệu vẫn rời server qua API.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI CHIỀU — CHIỀU DƯƠNG LÀ CHIỀU DỄ MẤT
 * ══════════════════════════════════════════════════════════════════════════════
 *   (+) người gán nhà máy A ⇒ THẤY máy/robot của A qua CẢ 5 thủ tục;
 *   (−) CHÍNH người ấy      ⇒ KHÔNG thấy máy/robot của B (danh sách RỖNG, theo id `NOT_FOUND`);
 *   (0) người 0 gán         ⇒ KHÔNG thấy gì, kể cả máy có thật;
 *   (∞) admin               ⇒ thấy cả hai (`PhamViNguoiXem` toàn quyền không thêm mệnh đề nào).
 *
 * ★ Ngoài phạm vi theo id ⇒ `ENTITY_NOT_FOUND`, KHÔNG phải `PERMISSION_DENIED` (G43: một mã 403/404
 *   không nói nó đến từ cổng nào — cấp ĐỦ quyền RBAC cho cả hai người, để cái duy nhất còn phân biệt
 *   họ là phạm vi nhà máy) và KHÔNG phải `FORBIDDEN` (G82: mã riêng xác nhận máy ấy có thật).
 *
 * ★ G22 — không dựa vào seed: tự tạo 2 nhà máy · 2 xưởng · 2 chuyền · 2 trạm · 2 máy · 2 robot ·
 *   2 người dùng, rồi xoá đúng chừng ấy từ trong ra ngoài. Robot KHÔNG có cột tenant — nối bằng
 *   `lineId`, đúng đường `robotFactoryGate` mô tả.
 *
 * ★ G20 — import CHÍNH `factoryCommandRouter` / `assetCockpitRouter` của module giao hàng.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { factoryCommandRouter } from "./factoryCommandRouter";
import { assetCockpitRouter } from "./assetCockpitRouter";
import { resolvePermissionModule } from "@shared/permissions";

const DB_URL = process.env.DATABASE_URL;

/** Hậu tố duy nhất cho mọi hàng lưới này tạo — để xoá lại đúng chừng ấy. */
const DAU = `D40-PV-${Date.now()}`;

/** Vai KHÔNG phải admin. */
const VAI = "engineer";

let sql: ReturnType<typeof postgres>;

interface Fixture {
  facTrongId: number;
  facTrongCode: string;
  facNgoaiId: number;
  userTrongId: number;
  userKhongGanId: number;
  workshopIds: number[];
  lineTrongId: number;
  lineNgoaiId: number;
  tramTrongId: number;
  tramNgoaiId: number;
  mayTrongId: number;
  mayNgoaiId: number;
  robotTrongId: number;
  robotNgoaiId: number;
  robotMoCoiId: number;
}
let fx: Fixture | null = null;

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
  // ⚠ `machineType` là enum NOT NULL; `isActive` mặc định true — `overview` chỉ lấy máy đang hoạt động.
  const m = await sql`
    INSERT INTO machines ("stationId", code, name, "machineType")
    VALUES (${stationId}, ${`${code}-M`}, ${`${ten} may`}, 'AOI') RETURNING id`;
  const machineId = (m[0] as unknown as { id: number }).id;
  return { factoryId, workshopId, lineId, stationId, machineId };
}

/** Robot nối tenant CHỈ qua `lineId`/`stationId` (không có cột nhà máy). `null` cả hai = mồ côi. */
async function taoRobot(nhan: string, lineId: number | null, stationId: number | null): Promise<number> {
  const r = await sql`
    INSERT INTO robots (code, name, vendor, kind, endpoint, "lineId", "stationId")
    VALUES (${`${DAU}-${nhan}`}, ${`${DAU} robot ${nhan}`}, 'sim', 'arm', 'tcp://127.0.0.1:1', ${lineId}, ${stationId})
    RETURNING id`;
  return (r[0] as unknown as { id: number }).id;
}

/**
 * ★★★ G43 — "BỊ CHẶN" CHƯA ĐỦ; PHẢI CHẶN **TỪ CỔNG NÀO**: `ENTITY_NOT_FOUND` (cổng phạm vi), KHÔNG
 * `PERMISSION_DENIED` (RBAC — xanh mà chưa chạm hàng rào tenant, và vẫn xanh khi bản vá bị gỡ).
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
  expect(err?.code ?? err?.cause?.code, "ngoài phạm vi phải cùng hình dạng với KHÔNG TỒN TẠI (G82)").toBe("NOT_FOUND");
}

/** Caller mang danh tính một người dùng cụ thể. */
function goiFc(userId: number, role: string = VAI) {
  return factoryCommandRouter.createCaller({ user: { id: userId, role, name: "probe" } } as any);
}
function goiAc(userId: number, role: string = VAI) {
  return assetCockpitRouter.createCaller({ user: { id: userId, role, name: "probe" } } as any);
}
const idMay = (ov: { machines: Array<{ id: number }> }) => ov.machines.map((m) => m.id).sort((a, b) => a - b);

describe.skipIf(!DB_URL)("Đợt 40 — factoryCommand + assetCockpit lọc theo phạm vi tenant, hai chiều", () => {
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

    // ★★★ G43 — cấp ĐỦ quyền RBAC (`machine_status` = alias của `machine_monitoring`) cho CẢ HAI người,
    //   để ô (−) đỏ vì TENANT chứ không vì `requirePermission` chặn trước.
    for (const uid of [userTrongId, userKhongGanId]) {
      await sql`
        INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport")
        VALUES (${uid}, ${"machine_monitoring"}::permissioncategoryenum, ${resolvePermissionModule("machine_monitoring")},
                true, false, false, false, false)`;
    }
    // ⚠ Nối bằng `factoryCode`, KHÔNG phải `factoryId` — bảng này không có cột `factoryId` (42703).
    await sql`
      INSERT INTO user_factory_assignments ("userId", "factoryCode")
      VALUES (${userTrongId}, ${facTrongCode})`;

    fx = {
      facTrongId: trong.factoryId,
      facTrongCode,
      facNgoaiId: ngoai.factoryId,
      userTrongId,
      userKhongGanId,
      workshopIds: [trong.workshopId, ngoai.workshopId],
      lineTrongId: trong.lineId,
      lineNgoaiId: ngoai.lineId,
      tramTrongId: trong.stationId,
      tramNgoaiId: ngoai.stationId,
      mayTrongId: trong.machineId,
      mayNgoaiId: ngoai.machineId,
      robotTrongId: await taoRobot("trong", trong.lineId, null),
      robotNgoaiId: await taoRobot("ngoai", ngoai.lineId, null),
      // Cả hai khoá NULL — hình dạng mà luật fail-CLOSED nói về.
      robotMoCoiId: await taoRobot("mocoi", null, null),
    };
  }, 60_000);

  afterAll(async () => {
    if (fx) {
      await sql`DELETE FROM robots WHERE id = ANY(${[fx.robotTrongId, fx.robotNgoaiId, fx.robotMoCoiId]})`;
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
    expect(fx!.robotTrongId).not.toBe(fx!.robotNgoaiId);
  });

  it("★★★ ĐỐI CHỨNG DANH TÍNH — người thử được gán ĐÚNG MỘT nhà máy, người kia 0", async () => {
    const g = await sql`SELECT "factoryCode" FROM user_factory_assignments WHERE "userId" = ${fx!.userTrongId}`;
    expect((g as unknown as Array<{ factoryCode: string }>).map((r) => r.factoryCode)).toEqual([fx!.facTrongCode]);
    const g2 = await sql`SELECT "factoryCode" FROM user_factory_assignments WHERE "userId" = ${fx!.userKhongGanId}`;
    expect(g2).toHaveLength(0);
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("factoryCommand.overview — nguồn sự thật của ba màn twin", () => {
    it("★★★ CHIỀU (+) — người gán A hỏi A ⇒ thấy máy của A; danh sách nhà máy CHỈ có A", async () => {
      const ov = await goiFc(fx!.userTrongId).overview({ factoryId: fx!.facTrongId });
      expect(idMay(ov)).toEqual([fx!.mayTrongId]);
      expect(ov.factories.map((f) => f.id)).toEqual([fx!.facTrongId]);
    });

    it("★★★ CHIỀU (−) — CHÍNH người ấy hỏi B ⇒ RỖNG (không `FORBIDDEN`: mã riêng xác nhận B tồn tại — G82)", async () => {
      const ov = await goiFc(fx!.userTrongId).overview({ factoryId: fx!.facNgoaiId });
      expect(ov.machines).toEqual([]);
      expect(ov.factories).toEqual([]);
      expect(ov.issues).toEqual([]);
    });

    it("bỏ trống `factoryId` (toàn nhà máy) ⇒ chỉ máy của A, KHÔNG có máy của B", async () => {
      const ov = await goiFc(fx!.userTrongId).overview();
      const ids = idMay(ov);
      expect(ids).toContain(fx!.mayTrongId);
      expect(ids).not.toContain(fx!.mayNgoaiId);
      expect(ov.factories.map((f) => f.id)).toEqual([fx!.facTrongId]);
    });

    it("người 0 gán ⇒ RỖNG với A, với B và với toàn nhà máy — kể cả máy có thật", async () => {
      const c = goiFc(fx!.userKhongGanId);
      expect((await c.overview({ factoryId: fx!.facTrongId })).machines).toEqual([]);
      expect((await c.overview({ factoryId: fx!.facNgoaiId })).machines).toEqual([]);
      const tat = await c.overview();
      expect(tat.machines).toEqual([]);
      expect(tat.factories).toEqual([]);
    });

    it("admin thấy CẢ HAI (chiều dương của `PhamViNguoiXem` toàn quyền — không thêm mệnh đề nào)", async () => {
      const ad = goiFc(1, "admin");
      expect(idMay(await ad.overview({ factoryId: fx!.facTrongId }))).toEqual([fx!.mayTrongId]);
      expect(idMay(await ad.overview({ factoryId: fx!.facNgoaiId }))).toEqual([fx!.mayNgoaiId]);
      const tat = idMay(await ad.overview());
      expect(tat).toContain(fx!.mayTrongId);
      expect(tat).toContain(fx!.mayNgoaiId);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("factoryCommand.machineDetail — theo id TỰ KHAI", () => {
    it("CHIỀU (+) — máy của A mở được", async () => {
      const d = await goiFc(fx!.userTrongId).machineDetail({ machineId: fx!.mayTrongId });
      expect(d.identity.id).toBe(fx!.mayTrongId);
    });
    it("★★★ CHIỀU (−) — máy của B ⇒ NOT_FOUND / ENTITY_NOT_FOUND (cùng hình dạng với không tồn tại)", async () => {
      await chanBoiPhamVi(goiFc(fx!.userTrongId).machineDetail({ machineId: fx!.mayNgoaiId }));
    });
    it("người 0 gán ⇒ NOT_FOUND cho cả máy A lẫn B", async () => {
      await chanBoiPhamVi(goiFc(fx!.userKhongGanId).machineDetail({ machineId: fx!.mayTrongId }));
      await chanBoiPhamVi(goiFc(fx!.userKhongGanId).machineDetail({ machineId: fx!.mayNgoaiId }));
    });
    it("admin mở được máy của B", async () => {
      const d = await goiFc(1, "admin").machineDetail({ machineId: fx!.mayNgoaiId });
      expect(d.identity.id).toBe(fx!.mayNgoaiId);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("assetCockpit.machineDetail — cockpit `/machine/:id` + màn Máy twin", () => {
    it("CHIỀU (+) — máy của A mở được, identity đúng nhà máy A", async () => {
      const d = await goiAc(fx!.userTrongId).machineDetail({ machineId: fx!.mayTrongId });
      expect(d.identity.id).toBe(fx!.mayTrongId);
      expect(d.identity.factoryId).toBe(fx!.facTrongId);
    });
    it("★★★ CHIỀU (−) — máy của B ⇒ NOT_FOUND (đo trước vá: 200 + identity máy 257 của nhà máy 18)", async () => {
      await chanBoiPhamVi(goiAc(fx!.userTrongId).machineDetail({ machineId: fx!.mayNgoaiId }));
    });
    it("người 0 gán ⇒ NOT_FOUND cho cả máy A lẫn B", async () => {
      await chanBoiPhamVi(goiAc(fx!.userKhongGanId).machineDetail({ machineId: fx!.mayTrongId }));
      await chanBoiPhamVi(goiAc(fx!.userKhongGanId).machineDetail({ machineId: fx!.mayNgoaiId }));
    });
    it("admin mở được máy của B", async () => {
      const d = await goiAc(1, "admin").machineDetail({ machineId: fx!.mayNgoaiId });
      expect(d.identity.factoryId).toBe(fx!.facNgoaiId);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("assetCockpit.robotDetail — `robots` không có cột tenant, nối qua `lineId`", () => {
    it("CHIỀU (+) — robot trên chuyền của A mở được", async () => {
      const d = await goiAc(fx!.userTrongId).robotDetail({ robotId: fx!.robotTrongId });
      expect(d.identity.id).toBe(fx!.robotTrongId);
    });
    it("★★★ CHIỀU (−) — robot trên chuyền của B ⇒ NOT_FOUND", async () => {
      await chanBoiPhamVi(goiAc(fx!.userTrongId).robotDetail({ robotId: fx!.robotNgoaiId }));
    });
    it("robot MỒ CÔI (lineId = stationId = NULL) ⇒ NOT_FOUND cho người bị thu hẹp — fail-closed", async () => {
      await chanBoiPhamVi(goiAc(fx!.userTrongId).robotDetail({ robotId: fx!.robotMoCoiId }));
    });
    it("người 0 gán ⇒ NOT_FOUND cho robot A", async () => {
      await chanBoiPhamVi(goiAc(fx!.userKhongGanId).robotDetail({ robotId: fx!.robotTrongId }));
    });
    it("admin mở được cả robot của B lẫn robot mồ côi (không thêm mệnh đề nào)", async () => {
      expect((await goiAc(1, "admin").robotDetail({ robotId: fx!.robotNgoaiId })).identity.id).toBe(fx!.robotNgoaiId);
      expect((await goiAc(1, "admin").robotDetail({ robotId: fx!.robotMoCoiId })).identity.id).toBe(fx!.robotMoCoiId);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("assetCockpit.machineAlarms — feed theo máy (hình dạng danh sách)", () => {
    it("CHIỀU (+) — máy của A trả về mảng (rỗng vì lưới không tạo andon — nhưng KHÔNG ném)", async () => {
      const r = await goiAc(fx!.userTrongId).machineAlarms({ machineId: fx!.mayTrongId });
      expect(Array.isArray(r.alarms)).toBe(true);
    });
    it("★★★ CHIỀU (−) — máy của B ⇒ `[]` — và phải chặn Ở SERVICE, không phải vì máy không có cảnh báo", async () => {
      // ★ Đối chứng: chèn MỘT andon `raised` cho máy B, để `[]` thật sự đo hàng rào chứ không đo bảng trống (G26).
      const a = await sql`
        INSERT INTO andon_events (state, reason, status, title, "machineId", "stationId", "lineId", "raisedBySystem", "raisedAt")
        VALUES ('red', 'quality', 'raised', ${`${DAU}-andon-ngoai`}, ${fx!.mayNgoaiId}, ${fx!.tramNgoaiId}, ${fx!.lineNgoaiId}, true, now())
        RETURNING id`;
      const andonId = (a[0] as unknown as { id: number }).id;
      try {
        const admin = await goiAc(1, "admin").machineAlarms({ machineId: fx!.mayNgoaiId });
        expect(admin.alarms.length, "đối chứng: admin PHẢI thấy andon vừa chèn").toBeGreaterThanOrEqual(1);
        const ngoai = await goiAc(fx!.userTrongId).machineAlarms({ machineId: fx!.mayNgoaiId });
        expect(ngoai.alarms).toEqual([]);
        const khongGan = await goiAc(fx!.userKhongGanId).machineAlarms({ machineId: fx!.mayNgoaiId });
        expect(khongGan.alarms).toEqual([]);
      } finally {
        await sql`DELETE FROM andon_events WHERE id = ${andonId}`;
      }
    });
  });
});
