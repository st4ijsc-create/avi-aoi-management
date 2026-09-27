/**
 * doc 81 Đợt 1C Task 4 — `machine.gatewayAllowlist.{get,set}` trên DB `_test` THẬT.
 *
 * Nghiệm thu: sửa allowlist ⇒ bảng `gateway_device_allowlist` đổi ĐÚNG; mỗi lượt sửa ghi MỘT dòng
 * `control_audit_log` (trước/sau/người sửa) trong CÙNG transaction — audit hỏng ⇒ allowlist KHÔNG đổi;
 * và một dòng `audit_logs` (màn Nhật ký). Cổng: admin/engineer + settings_factory canEdit; gateway
 * phải là IOT_GATEWAY; thiết bị phải tồn tại, đang hoạt động, trong phạm vi người sửa.
 *
 * Oracle độc lập: đọc bảng/audit bằng `SELECT` thô qua kết nối `postgres` riêng. Allowlist ban đầu
 * dựng bằng INSERT thô. Dấu chân: `control_audit_log` và `audit_logs` là WORM (mig 0224/0279) —
 * avi_app không xoá được; các dòng audit của lượt chạy mang entityId = id gateway thử (đã xoá).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import postgres from "postgres";

const h = vi.hoisted(() => ({ auditHong: false, hongSauAudit: false }));
vi.mock("../services/audit/controlAuditService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/audit/controlAuditService")>();
  return {
    ...actual,
    recordAuditEvent: async (...args: Parameters<typeof actual.recordAuditEvent>) => {
      if (h.auditHong) throw new Error("T4-forced-audit-failure");
      const row = await actual.recordAuditEvent(...args);
      // Dòng audit ĐÃ ghi bằng đúng handle được truyền vào, RỒI lỗi ⇒ nếu handle là `tx` thì dòng ấy
      // rollback cùng thay đổi; nếu là kết nối autocommit thì dòng audit "mồ côi" còn lại.
      if (h.hongSauAudit) throw new Error("T4-forced-failure-after-audit");
      return row;
    },
  };
});

import { gatewayAllowlistRouter } from "./gatewayAllowlistRouter";
import { resolvePermissionModule } from "@shared/permissions";

const DB_URL = process.env.DATABASE_URL;
const RUN = `T4GW${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
const fx = {
  factory: 0, factoryNgoai: 0, workshops: [] as number[], lines: [] as number[], stations: [] as number[],
  gw: 0, a: 0, b: 0, dead: 0, nonGw: 0, ngoai: 0,
  admin: 0, eng: 0, engKhongQuyen: 0, sup: 0,
};

function caller(userId: number, role: string) {
  return gatewayAllowlistRouter.createCaller({
    user: { id: userId, role, name: `probe-${role}`, twoFactorEnabled: true },
  } as any);
}
const allowlist = async (gw = fx.gw): Promise<number[]> =>
  (await sql<{ d: number }[]>`SELECT "deviceMachineId" AS d FROM gateway_device_allowlist WHERE "gatewayMachineId" = ${gw} ORDER BY 1`).map((r) => r.d);
const auditRows = async (gw = fx.gw) =>
  sql<{ id: number; action: string; actorId: number | null; beforeJson: any; afterJson: any; reason: string | null }[]>`
    SELECT id, action, "actorId", "beforeJson", "afterJson", reason FROM control_audit_log
     WHERE "entityType" = 'gateway_device_allowlist' AND "entityId" = ${String(gw)} ORDER BY id`;
const auditLogRows = async (gw = fx.gw) =>
  sql<{ action: string; userId: number | null; details: string }[]>`
    SELECT action, "userId", details FROM audit_logs
     WHERE action = 'machine.gatewayAllowlist.set' AND "entityId" = ${gw} ORDER BY id`;

describe.skipIf(!DB_URL)("doc 81 Đợt 1C Task 4 — machine.gatewayAllowlist (DB _test thật)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    const nhanh = async (hau: string) => {
      const f = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${`F-${RUN}${hau}`}, 'T4 f', true) RETURNING id`);
      const w = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f}, ${`W-${RUN}${hau}`}, 'T4 w') RETURNING id`);
      const l = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w}, ${`L-${RUN}${hau}`}, 'T4 l') RETURNING id`);
      const s = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l}, ${`S-${RUN}${hau}`}, 'T4 s') RETURNING id`);
      fx.workshops.push(w); fx.lines.push(l); fx.stations.push(s);
      return { f, s };
    };
    const trong = await nhanh("");
    const ngoai = await nhanh("-NGOAI");
    fx.factory = trong.f;
    fx.factoryNgoai = ngoai.f;
    const may = (st: number, hau: string, type: string, active = true) =>
      one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
              VALUES (${st}, ${`${RUN}-${hau}`}, ${`T4 ${hau}`}, ${type}, ${active}) RETURNING id`);
    fx.gw = await may(trong.s, "GW", "IOT_GATEWAY");
    fx.a = await may(trong.s, "A", "IOT_SENSOR");
    fx.b = await may(trong.s, "B", "SCREWDRIVE");
    fx.dead = await may(trong.s, "DEAD", "IOT_SENSOR", false);
    fx.nonGw = await may(trong.s, "NONGW", "IOT_SENSOR");
    fx.ngoai = await may(ngoai.s, "NGOAI", "IOT_SENSOR");

    const user = async (hau: string, role: string) =>
      one(sql`INSERT INTO users ("openId", username, name, role, "isActive")
              VALUES (${`${RUN}-${hau}`}, ${`${RUN}-${hau}`}, ${`T4 ${hau}`}, ${role}, true) RETURNING id`);
    fx.admin = await user("admin", "admin");
    fx.eng = await user("eng", "engineer");
    fx.engKhongQuyen = await user("eng0", "engineer");
    fx.sup = await user("sup", "supervisor");
    // `category` là ENUM; moduleName phải là tên ĐÃ resolve (alias doc 40).
    const cap = async (uid: number, canEdit: boolean) =>
      sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport")
          VALUES (${uid}, 'settings'::permissioncategoryenum, ${resolvePermissionModule("settings_factory")}, true, false, ${canEdit}, false, false)`;
    await cap(fx.eng, true);
    await cap(fx.engKhongQuyen, false);
    await cap(fx.sup, true);
    for (const uid of [fx.eng, fx.engKhongQuyen, fx.sup]) {
      await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uid}, ${`F-${RUN}`})`;
    }
    // Allowlist ban đầu {A} — INSERT thô.
    await sql`INSERT INTO gateway_device_allowlist ("gatewayMachineId", "deviceMachineId") VALUES (${fx.gw}, ${fx.a})`;
  }, 120_000);

  afterEach(() => {
    h.auditHong = false;
    h.hongSauAudit = false;
  });

  afterAll(async () => {
    if (!sql) return;
    const may = [fx.gw, fx.a, fx.b, fx.dead, fx.nonGw, fx.ngoai].filter((x) => x > 0);
    const uids = [fx.admin, fx.eng, fx.engKhongQuyen, fx.sup].filter((x) => x > 0);
    await sql`DELETE FROM gateway_device_allowlist WHERE "gatewayMachineId" = ANY(${may}) OR "deviceMachineId" = ANY(${may})`;
    await sql`DELETE FROM machines WHERE id = ANY(${may})`;
    await sql`DELETE FROM stations WHERE id = ANY(${fx.stations})`;
    await sql`DELETE FROM production_lines WHERE id = ANY(${fx.lines})`;
    await sql`DELETE FROM workshops WHERE id = ANY(${fx.workshops})`;
    await sql`DELETE FROM factories WHERE id = ANY(${[fx.factory, fx.factoryNgoai]})`;
    await sql`DELETE FROM permissions WHERE "userId" = ANY(${uids})`;
    await sql`DELETE FROM user_factory_assignments WHERE "userId" = ANY(${uids})`;
    await sql`DELETE FROM users WHERE id = ANY(${uids})`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("get: trả đúng allowlist hiện có (dựng bằng SQL thô)", async () => {
    const r = await caller(fx.admin, "admin").get({ gatewayId: fx.gw });
    expect(r.gatewayId).toBe(fx.gw);
    expect(r.devices.map((d) => d.id)).toEqual([fx.a]);
  });

  it("★ admin set [A, B] ⇒ bảng = {A, B}; MỘT dòng control_audit_log trước {A} / sau {A,B} / actor = admin; một dòng audit_logs", async () => {
    const truoc = (await auditRows()).length;
    const truocLog = (await auditLogRows()).length;
    const r = await caller(fx.admin, "admin").set({ gatewayId: fx.gw, deviceIds: [fx.b, fx.a, fx.b], reason: "T4 them B" });
    expect(r).toMatchObject({ gatewayId: fx.gw, deviceIds: [fx.a, fx.b].sort((x, y) => x - y), added: [fx.b], removed: [] });
    expect(await allowlist()).toEqual([fx.a, fx.b].sort((x, y) => x - y));
    const rows = await auditRows();
    expect(rows.length).toBe(truoc + 1);
    const moi = rows[rows.length - 1];
    expect(moi.action).toBe("allowlist_set");
    expect(moi.actorId).toBe(fx.admin);
    expect(moi.reason).toBe("T4 them B");
    expect(moi.beforeJson.deviceIds).toEqual([fx.a]);
    expect(moi.afterJson.deviceIds).toEqual([fx.a, fx.b].sort((x, y) => x - y));
    expect(moi.afterJson.added).toEqual([fx.b]);
    const logs = await auditLogRows();
    expect(logs.length).toBe(truocLog + 1);
    expect(logs[logs.length - 1].userId).toBe(fx.admin);
    expect(JSON.parse(logs[logs.length - 1].details).after.deviceIds).toEqual([fx.a, fx.b].sort((x, y) => x - y));
  });

  it("★ audit HỎNG giữa transaction ⇒ lệnh ném VÀ allowlist KHÔNG đổi (không có thay đổi lặng)", async () => {
    const truoc = await allowlist();
    h.auditHong = true;
    await expect(caller(fx.admin, "admin").set({ gatewayId: fx.gw, deviceIds: [] })).rejects.toThrow("T4-forced-audit-failure");
    expect(await allowlist()).toEqual(truoc);
  });

  it("★ audit CHUNG transaction: lỗi SAU khi dòng audit đã ghi ⇒ cả allowlist lẫn dòng control_audit_log đều rollback", async () => {
    const truoc = await allowlist();
    const soAudit = (await auditRows()).length;
    h.hongSauAudit = true;
    await expect(caller(fx.admin, "admin").set({ gatewayId: fx.gw, deviceIds: [] })).rejects.toThrow("T4-forced-failure-after-audit");
    expect(await allowlist()).toEqual(truoc);
    expect((await auditRows()).length).toBe(soAudit);
  });

  it("★ set [] ⇒ allowlist RỖNG (gateway thôi ghi), audit ghi trước/sau", async () => {
    const truoc = await allowlist();
    await caller(fx.admin, "admin").set({ gatewayId: fx.gw, deviceIds: [] });
    expect(await allowlist()).toEqual([]);
    const moi = (await auditRows()).at(-1)!;
    expect(moi.beforeJson.deviceIds).toEqual(truoc);
    expect(moi.afterJson.deviceIds).toEqual([]);
    expect(moi.afterJson.removed).toEqual(truoc);
  });

  it("★ engineer có settings_factory canEdit ⇒ sửa được, actor = engineer", async () => {
    await caller(fx.eng, "engineer").set({ gatewayId: fx.gw, deviceIds: [fx.a] });
    expect(await allowlist()).toEqual([fx.a]);
    expect((await auditRows()).at(-1)!.actorId).toBe(fx.eng);
  });

  it("engineer KHÔNG có canEdit ⇒ FORBIDDEN; supervisor (có canEdit) ⇒ FORBIDDEN (vai); không đổi, không audit", async () => {
    const truoc = await allowlist();
    const soAudit = (await auditRows()).length;
    await expect(caller(fx.engKhongQuyen, "engineer").set({ gatewayId: fx.gw, deviceIds: [fx.b] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(fx.sup, "supervisor").set({ gatewayId: fx.gw, deviceIds: [fx.b] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await allowlist()).toEqual(truoc);
    expect((await auditRows()).length).toBe(soAudit);
  });

  it("gateway không phải IOT_GATEWAY ⇒ BAD_REQUEST; thiết bị không tồn tại / đã ngừng ⇒ BAD_REQUEST; không đổi, không audit", async () => {
    const truoc = await allowlist();
    const soAudit = (await auditRows()).length;
    const ad = caller(fx.admin, "admin");
    await expect(ad.set({ gatewayId: fx.nonGw, deviceIds: [fx.a] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await allowlist(fx.nonGw)).toEqual([]);
    await expect(ad.set({ gatewayId: fx.gw, deviceIds: [fx.dead] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ad.set({ gatewayId: fx.gw, deviceIds: [2_000_000_000] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await allowlist()).toEqual(truoc);
    expect((await auditRows()).length).toBe(soAudit);
    expect((await auditRows(fx.nonGw)).length).toBe(0);
  });

  it("lớp SERVICE tự chặn (không dựa vào cổng router): datAllowlist trên máy không phải gateway / thiết bị đã ngừng ⇒ AllowlistLoi, không đổi, không audit", async () => {
    const { datAllowlist } = await import("../services/gatewayAllowlistService");
    const truoc = await allowlist();
    const soAudit = (await auditRows()).length;
    await expect(datAllowlist({ gatewayId: fx.nonGw, deviceIds: [fx.a], actorId: fx.admin })).rejects.toMatchObject({ loai: "not_a_gateway" });
    await expect(datAllowlist({ gatewayId: fx.gw, deviceIds: [fx.a, fx.dead], actorId: fx.admin })).rejects.toMatchObject({
      loai: "device_invalid",
      chiTiet: { deviceIds: [fx.dead] },
    });
    expect(await allowlist(fx.nonGw)).toEqual([]);
    expect(await allowlist()).toEqual(truoc);
    expect((await auditRows()).length).toBe(soAudit);
    expect((await auditRows(fx.nonGw)).length).toBe(0);
  });

  it("engineer không thêm được thiết bị của nhà máy NGOÀI phạm vi mình (admin thì được)", async () => {
    await expect(caller(fx.eng, "engineer").set({ gatewayId: fx.gw, deviceIds: [fx.a, fx.ngoai] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await allowlist()).toEqual([fx.a]);
    await caller(fx.admin, "admin").set({ gatewayId: fx.gw, deviceIds: [fx.a, fx.ngoai] });
    expect(await allowlist()).toEqual([fx.a, fx.ngoai].sort((x, y) => x - y));
  });

  // ── fix round 1 #4 — mục NGOÀI phạm vi người xem: không lộ ở `get`, không bị `set` xoá lặng lẽ ──
  // (nối tiếp ca trên: list hiện = {A, NGOAI}; NGOAI thuộc nhà máy engineer KHÔNG được gán.)
  it("★ get của engineer: chỉ trả ĐẦY ĐỦ thiết bị trong phạm vi; mục ngoài phạm vi chỉ là SỐ ĐẾM (không mã/tên/loại)", async () => {
    const r = await caller(fx.eng, "engineer").get({ gatewayId: fx.gw });
    expect(r.devices.map((d) => d.id)).toEqual([fx.a]);
    expect(r.outOfScopeCount).toBe(1);
    const json = JSON.stringify(r);
    expect(json).not.toContain(`${RUN}-NGOAI`);
    expect(json).not.toContain(`T4 NGOAI`);
    expect(json).not.toContain(String(fx.ngoai));
    // admin (không lọc) thấy cả hai
    const ad = await caller(fx.admin, "admin").get({ gatewayId: fx.gw });
    expect(ad.devices.map((d) => d.id).sort((x, y) => x - y)).toEqual([fx.a, fx.ngoai].sort((x, y) => x - y));
    expect(ad.outOfScopeCount).toBe(0);
  });

  it("★ set của engineer GIỮ mục ngoài phạm vi: lưu [] ⇒ bảng còn {NGOAI}; audit ghi keptOutOfScope; phản hồi không lộ id", async () => {
    const r = await caller(fx.eng, "engineer").set({ gatewayId: fx.gw, deviceIds: [] });
    expect(r.deviceIds).toEqual([]);
    expect(r.outOfScopeCount).toBe(1);
    expect(r.removed).toEqual([fx.a]);
    expect(JSON.stringify(r)).not.toContain(String(fx.ngoai));
    expect(await allowlist()).toEqual([fx.ngoai]);
    const moi = (await auditRows()).at(-1)!;
    expect(moi.actorId).toBe(fx.eng);
    expect(moi.afterJson.deviceIds).toEqual([fx.ngoai]);
    expect(moi.afterJson.keptOutOfScope).toEqual([fx.ngoai]);
    // engineer thêm lại A ⇒ {A, NGOAI}
    await caller(fx.eng, "engineer").set({ gatewayId: fx.gw, deviceIds: [fx.a] });
    expect(await allowlist()).toEqual([fx.a, fx.ngoai].sort((x, y) => x - y));
  });

  it("lớp SERVICE (fix #5): phạm vi truyền vào được kiểm TRONG transaction — gateway ngoài phạm vi ⇒ gateway_not_found; thiết bị ngoài phạm vi ⇒ device_invalid; không đổi", async () => {
    const { datAllowlist } = await import("../services/gatewayAllowlistService");
    const truoc = await allowlist();
    const soAudit = (await auditRows()).length;
    await expect(datAllowlist({ gatewayId: fx.gw, deviceIds: [fx.a], actorId: fx.admin, phamViIds: [fx.a] })).rejects.toMatchObject({ loai: "gateway_not_found" });
    await expect(datAllowlist({ gatewayId: fx.gw, deviceIds: [fx.b], actorId: fx.admin, phamViIds: [fx.gw, fx.a] })).rejects.toMatchObject({
      loai: "device_invalid",
      chiTiet: { deviceIds: [fx.b] },
    });
    expect(await allowlist()).toEqual(truoc);
    expect((await auditRows()).length).toBe(soAudit);
  });
});
