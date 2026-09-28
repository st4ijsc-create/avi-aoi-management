/**
 * doc 81 Đợt 1D Task 1 — `deviceAdapter.tags.setStopPin` + gỡ ghim tự động + `loadStopPins`, trên DB
 * `_test` THẬT (mig 0362 đã áp bằng `scripts/apply-migration-0362.mjs --test-only`).
 *
 * Nghiệm thu (brief Task 1 bước 6): cần canEdit; tag không ghi được / bị tắt bị từ chối; sai kiểu bị từ
 * chối; audit có trước/sau và KHÔNG có bí mật; gỡ được; tag thành không-ghi-được ⇒ ghim bị gỡ; tag của
 * adapter khác bị từ chối. Thêm: phạm vi adapter (máy ngoài phạm vi ⇒ không thấy), commissioning ⇒ vẫn
 * cho đổi + cờ `commissioningRecheckRequired`, audit hỏng ⇒ ghim KHÔNG đổi, `loadStopPins` fail-closed.
 *
 * Oracle độc lập: trạng thái đọc bằng `SELECT` thô qua kết nối `postgres` riêng; fixture dựng bằng
 * INSERT thô. Dấu chân: `control_audit_log`/`audit_logs` là WORM (không xoá được) — entityId = id tag thử.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import postgres from "postgres";

const h = vi.hoisted(() => ({ auditHong: false }));
vi.mock("../audit/controlAuditService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../audit/controlAuditService")>();
  return {
    ...actual,
    recordAuditEvent: async (...args: Parameters<typeof actual.recordAuditEvent>) => {
      const row = await actual.recordAuditEvent(...args);
      // Dòng audit ĐÃ ghi bằng handle được truyền vào, RỒI lỗi ⇒ nếu handle là `tx` thì cả dòng audit
      // lẫn thay đổi ghim rollback.
      if (h.auditHong) throw new Error("D1-forced-failure-after-audit");
      return row;
    },
  };
});

import { deviceAdapterRouter } from "../../routers/deviceAdapterRouter";
import { commissioningRouter } from "../../routers/commissioningRouter";
import { resolvePermissionModule } from "@shared/permissions";
import { getDb } from "../../db";
import { loadStopPins } from "./stopPin";

const DB_URL = process.env.DATABASE_URL;
const RUN = `D1SP${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
const SECRET = `Sup3r-Secret-${RUN}`;

let sql: ReturnType<typeof postgres>;
const fx = {
  factories: [] as number[], workshops: [] as number[], lines: [] as number[], stations: [] as number[],
  mTrong: 0, mNgoai: 0,
  aA: 0, aB: 0, aNgoai: 0,
  tStop: 0, tSpeed: 0, tRo: 0, tOff: 0, tMode: 0, tB: 0, tNgoai: 0,
  admin: 0, eng: 0, engView: 0,
};
const users: number[] = [];

function caller(userId: number, role: string) {
  return deviceAdapterRouter.createCaller({
    user: { id: userId, role, name: `probe-${role}`, twoFactorEnabled: true },
  } as any);
}
const tag = async (id: number) =>
  (await sql<{ stop_value: unknown; stop_pinned_by: string | null; stop_pinned_at: Date | null; writable: boolean; isEnabled: boolean }[]>`
    SELECT stop_value, stop_pinned_by, stop_pinned_at, writable, "isEnabled" FROM device_tags WHERE id = ${id}`)[0];
const auditRows = async (tagId: number) =>
  sql<{ id: number; action: string; actorId: number | null; beforeJson: any; afterJson: any; reason: string | null }[]>`
    SELECT id, action, "actorId", "beforeJson", "afterJson", reason FROM control_audit_log
     WHERE "entityType" = 'device_tag_stop_pin' AND "entityId" = ${String(tagId)} ORDER BY id`;
const auditLogRows = async (tagId: number) =>
  sql<{ action: string; userId: number | null; entityType: string; details: string }[]>`
    SELECT action, "userId", "entityType", details FROM audit_logs
     WHERE action = 'deviceTag.setStopPin' AND "entityType" = 'device_tag' AND "entityId" = ${tagId} ORDER BY id`;

function meta(err: any) {
  return {
    appCode: err?.cause?.appCode ?? err?.shape?.data?.appCode,
    appParams: err?.cause?.appParams ?? err?.shape?.data?.appParams,
  };
}
async function loi(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as any;
  }
  throw new Error("expected rejection");
}

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("doc 81 Đợt 1D Task 1 — setStopPin (DB _test thật)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    const [cot] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'device_tags' AND column_name IN ('stop_value','stop_pinned_by','stop_pinned_at')`;
    expect(cot.n, "mig 0362 chưa áp lên _test — chạy scripts/apply-migration-0362.mjs --test-only").toBe(3);

    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    const nhanh = async (hau: string) => {
      const f = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${`F-${RUN}${hau}`}, 'D1 f', true) RETURNING id`);
      const w = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f}, ${`W-${RUN}${hau}`}, 'D1 w') RETURNING id`);
      const l = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w}, ${`L-${RUN}${hau}`}, 'D1 l') RETURNING id`);
      const s = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l}, ${`S-${RUN}${hau}`}, 'D1 s') RETURNING id`);
      fx.factories.push(f); fx.workshops.push(w); fx.lines.push(l); fx.stations.push(s);
      return s;
    };
    const sTrong = await nhanh("");
    const sNgoai = await nhanh("-NGOAI");
    const may = (st: number, hau: string) =>
      one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
              VALUES (${st}, ${`${RUN}-${hau}`}, ${`D1 ${hau}`}, 'SCREWDRIVE', true) RETURNING id`);
    fx.mTrong = await may(sTrong, "M");
    fx.mNgoai = await may(sNgoai, "MN");

    const adapter = (hau: string, machineId: number) =>
      one(sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "connectionOptions", "machineId", "isEnabled")
              VALUES (${`${RUN}-${hau}`}, ${`D1 ${hau}`}, 'stub', 'stub://d1',
                      ${sql.json({ userName: "op", password: SECRET })}, ${machineId}, false) RETURNING id`);
    fx.aA = await adapter("A", fx.mTrong);
    fx.aB = await adapter("B", fx.mTrong);
    fx.aNgoai = await adapter("NGOAI", fx.mNgoai);

    const t = (adapterId: number, key: string, dataType: string, writable: boolean, isEnabled = true) =>
      one(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
              VALUES (${adapterId}, ${key}, ${`DB1.${key}`}, ${dataType}, ${writable}, ${isEnabled}) RETURNING id`);
    fx.tStop = await t(fx.aA, "stop_cmd", "bool", true);
    fx.tSpeed = await t(fx.aA, "speed_sp", "float", true);
    fx.tRo = await t(fx.aA, "ro_state", "bool", false);
    fx.tOff = await t(fx.aA, "off_cmd", "bool", true, false);
    fx.tMode = await t(fx.aA, "mode", "string", true);
    fx.tB = await t(fx.aB, "b_only", "bool", true);
    fx.tNgoai = await t(fx.aNgoai, "stop_cmd", "bool", true);

    const user = async (hau: string, role: string) => {
      const id = await one(sql`INSERT INTO users ("openId", username, name, role, "isActive")
              VALUES (${`${RUN}-${hau}`}, ${`${RUN}-${hau}`}, ${`D1 ${hau}`}, ${role}, true) RETURNING id`);
      users.push(id);
      return id;
    };
    fx.admin = await user("admin", "admin");
    fx.eng = await user("eng", "engineer");
    fx.engView = await user("engv", "engineer");
    const cap = async (uid: number, canEdit: boolean) =>
      sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport")
          VALUES (${uid}, 'machine_control', ${resolvePermissionModule("machine_control")}, true, false, ${canEdit}, true, false)`;
    await cap(fx.eng, true);
    await cap(fx.engView, false);
    for (const uid of [fx.eng, fx.engView]) {
      await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uid}, ${`F-${RUN}`})`;
    }
  }, 120_000);

  afterEach(() => {
    h.auditHong = false;
  });

  afterAll(async () => {
    if (!sql) return;
    const adapters = [fx.aA, fx.aB, fx.aNgoai].filter((x) => x > 0);
    await sql`DELETE FROM commissioning_records WHERE "adapterId" = ANY(${adapters})`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ANY(${adapters})`;
    await sql`DELETE FROM device_adapters WHERE id = ANY(${adapters})`;
    await sql`DELETE FROM machines WHERE id = ANY(${[fx.mTrong, fx.mNgoai].filter((x) => x > 0)})`;
    await sql`DELETE FROM stations WHERE id = ANY(${fx.stations})`;
    await sql`DELETE FROM production_lines WHERE id = ANY(${fx.lines})`;
    await sql`DELETE FROM workshops WHERE id = ANY(${fx.workshops})`;
    await sql`DELETE FROM factories WHERE id = ANY(${fx.factories})`;
    await sql`DELETE FROM permissions WHERE "userId" = ANY(${users})`;
    await sql`DELETE FROM user_factory_assignments WHERE "userId" = ANY(${users})`;
    await sql`DELETE FROM users WHERE id = ANY(${users})`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("thiếu canEdit (machine_control canView) ⇒ PERMISSION_DENIED, ghim không đổi", async () => {
    const e = await loi(caller(fx.engView, "engineer").tags.setStopPin({ adapterId: fx.aA, tagKey: "stop_cmd", stopValue: true, reason: "D1 thieu quyen" }));
    expect(meta(e).appCode).toBe("PERMISSION_DENIED");
    expect((await tag(fx.tStop)).stop_value).toBeNull();
  });

  it("lý do < 5 ký tự ⇒ bị từ chối ở input", async () => {
    await expect(
      caller(fx.eng, "engineer").tags.setStopPin({ adapterId: fx.aA, tagKey: "stop_cmd", stopValue: true, reason: "abc" }),
    ).rejects.toThrow();
    expect((await tag(fx.tStop)).stop_value).toBeNull();
  });

  it("tag KHÔNG writable ⇒ INVALID_VALUE stopPinTagNotWritable; tag bị TẮT ⇒ cùng lỗi", async () => {
    const e1 = await loi(caller(fx.eng, "engineer").tags.setStopPin({ adapterId: fx.aA, tagKey: "ro_state", stopValue: true, reason: "D1 ro tag" }));
    expect(meta(e1)).toEqual({ appCode: "INVALID_VALUE", appParams: { field: "stopValue", reason: "stopPinTagNotWritable" } });
    const e2 = await loi(caller(fx.eng, "engineer").tags.setStopPin({ adapterId: fx.aA, tagKey: "off_cmd", stopValue: true, reason: "D1 off tag" }));
    expect(meta(e2).appParams?.reason).toBe("stopPinTagNotWritable");
    expect((await tag(fx.tRo)).stop_value).toBeNull();
    expect((await tag(fx.tOff)).stop_value).toBeNull();
    expect(await auditRows(fx.tRo)).toHaveLength(0);
  });

  it("sai kiểu ⇒ INVALID_VALUE stopPinTypeMismatch (float nhận \"0\"; bool nhận \"true\"; string nhận 0; vắng stopValue)", async () => {
    const c = caller(fx.eng, "engineer");
    for (const [tagKey, stopValue] of [["speed_sp", "0"], ["stop_cmd", "true"], ["mode", 0]] as const) {
      const e = await loi(c.tags.setStopPin({ adapterId: fx.aA, tagKey, stopValue, reason: "D1 sai kieu" }));
      expect(meta(e), `${tagKey}=${JSON.stringify(stopValue)}`).toEqual({
        appCode: "INVALID_VALUE", appParams: { field: "stopValue", reason: "stopPinTypeMismatch" },
      });
    }
    const e = await loi(c.tags.setStopPin({ adapterId: fx.aA, tagKey: "stop_cmd", reason: "D1 vang gia tri" } as any));
    expect(meta(e).appParams?.reason).toBe("stopPinTypeMismatch");
    expect((await tag(fx.tSpeed)).stop_value).toBeNull();
    expect((await tag(fx.tStop)).stop_value).toBeNull();
  });

  it("★ tag của ADAPTER KHÁC (tagKey chỉ có ở B, gửi adapterId A) ⇒ ENTITY_NOT_FOUND; tag của B không đổi", async () => {
    const e = await loi(caller(fx.eng, "engineer").tags.setStopPin({ adapterId: fx.aA, tagKey: "b_only", stopValue: true, reason: "D1 cheo adapter" }));
    expect(meta(e)).toEqual({ appCode: "ENTITY_NOT_FOUND", appParams: { entity: "deviceTag" } });
    expect((await tag(fx.tB)).stop_value).toBeNull();
  });

  it("★ adapter của máy NGOÀI phạm vi người sửa ⇒ ENTITY_NOT_FOUND (adapter); admin (không lọc) thì được", async () => {
    const e = await loi(caller(fx.eng, "engineer").tags.setStopPin({ adapterId: fx.aNgoai, tagKey: "stop_cmd", stopValue: true, reason: "D1 ngoai pham vi" }));
    expect(meta(e)).toEqual({ appCode: "ENTITY_NOT_FOUND", appParams: { entity: "adapter" } });
    expect((await tag(fx.tNgoai)).stop_value).toBeNull();

    const r = await caller(fx.admin, "admin").tags.setStopPin({ adapterId: fx.aNgoai, tagKey: "stop_cmd", stopValue: true, reason: "D1 admin ghim" });
    expect(r.changed).toBe(true);
    expect((await tag(fx.tNgoai)).stop_value).toBe(true);
  });

  it("★ ghim bool 1 ⇒ lưu `true` (chuẩn hoá); MỘT dòng control_audit_log trước/sau/lý do/actor + MỘT dòng audit_logs; KHÔNG bí mật", async () => {
    const r = await caller(fx.eng, "engineer").tags.setStopPin({ adapterId: fx.aA, tagKey: "stop_cmd", stopValue: 1, reason: "D1 ghim stop_cmd" });
    expect(r).toMatchObject({ tagId: fx.tStop, adapterId: fx.aA, tagKey: "stop_cmd", stopValue: true, stopPinnedBy: String(fx.eng), changed: true, commissioningRecheckRequired: false });

    const row = await tag(fx.tStop);
    expect(row.stop_value).toBe(true);
    expect(row.stop_pinned_by).toBe(String(fx.eng));
    expect(row.stop_pinned_at).toBeInstanceOf(Date);

    const a = await auditRows(fx.tStop);
    expect(a).toHaveLength(1);
    expect(a[0].action).toBe("stop_pin_set");
    expect(a[0].actorId).toBe(fx.eng);
    expect(a[0].reason).toBe("D1 ghim stop_cmd");
    expect(a[0].beforeJson).toEqual({ tagKey: "stop_cmd", adapterId: fx.aA, dataType: "bool", stopValue: null });
    expect(a[0].afterJson).toEqual({ tagKey: "stop_cmd", adapterId: fx.aA, dataType: "bool", stopValue: true, commissioningRecheckRequired: false });

    const l = await auditLogRows(fx.tStop);
    expect(l).toHaveLength(1);
    expect(l[0].userId).toBe(fx.eng);
    const d = JSON.parse(l[0].details);
    expect(d.before.stopValue).toBeNull();
    expect(d.after.stopValue).toBe(true);
    expect(d.metadata.reason).toBe("D1 ghim stop_cmd");

    const tatCa = JSON.stringify({ a, l });
    expect(tatCa).not.toContain(SECRET);
    expect(tatCa).not.toContain("password");
    expect(tatCa).not.toContain("connectionOptions");
  });

  it("ghim lại CÙNG giá trị ⇒ changed:false, không audit thêm", async () => {
    const truoc = (await auditRows(fx.tStop)).length;
    const r = await caller(fx.eng, "engineer").tags.setStopPin({ adapterId: fx.aA, tagKey: "stop_cmd", stopValue: true, reason: "D1 ghim lai" });
    expect(r.changed).toBe(false);
    expect(await auditRows(fx.tStop)).toHaveLength(truoc);
  });

  it("★ audit hỏng SAU khi ghi ⇒ rollback: ghim không đổi, không dòng audit mồ côi", async () => {
    const truoc = await auditRows(fx.tSpeed);
    h.auditHong = true;
    await expect(
      caller(fx.eng, "engineer").tags.setStopPin({ adapterId: fx.aA, tagKey: "speed_sp", stopValue: 0, reason: "D1 audit hong" }),
    ).rejects.toThrow();
    expect((await tag(fx.tSpeed)).stop_value).toBeNull();
    expect(await auditRows(fx.tSpeed)).toHaveLength(truoc.length);
  });

  it("★ ghim chuỗi \"0\" cho tag string ⇒ lưu/đọc lại ĐÚNG chuỗi \"0\" (listByAdapter, loadStopPins) — không bị đọc thành số", async () => {
    const c = caller(fx.eng, "engineer");
    await c.tags.setStopPin({ adapterId: fx.aA, tagKey: "mode", stopValue: "0", reason: "D1 ghim chuoi 0" });
    const [raw] = await sql<{ t: string; kieu: string }[]>`SELECT stop_value::text AS t, jsonb_typeof(stop_value) AS kieu FROM device_tags WHERE id = ${fx.tMode}`;
    expect(raw).toEqual({ t: '"0"', kieu: "string" });
    const list = await c.tags.listByAdapter({ adapterId: fx.aA });
    expect(list.find((x) => x.id === fx.tMode)?.stopValue).toBe("0");
    const pins = await loadStopPins((await getDb())!, fx.aA);
    expect(pins.find((p) => p.tagKey === "mode")).toEqual({ tagKey: "mode", value: "0" });
    // before của lượt gỡ cũng phải là chuỗi "0".
    await c.tags.setStopPin({ adapterId: fx.aA, tagKey: "mode", stopValue: null, reason: "D1 go chuoi 0" });
    const a = await auditRows(fx.tMode);
    expect(a[a.length - 1].beforeJson.stopValue).toBe("0");
  });

  it("★ gỡ (stopValue null) ⇒ cột về NULL; audit stop_pin_clear trước true / sau null", async () => {
    const c = caller(fx.eng, "engineer");
    const r = await c.tags.setStopPin({ adapterId: fx.aA, tagKey: "stop_cmd", stopValue: null, reason: "D1 go ghim" });
    expect(r).toMatchObject({ changed: true, stopValue: null, stopPinnedBy: null, stopPinnedAt: null });
    const row = await tag(fx.tStop);
    expect(row.stop_value).toBeNull();
    expect(row.stop_pinned_by).toBeNull();
    expect(row.stop_pinned_at).toBeNull();
    // SQL NULL thật (không phải jsonb 'null' — postgres-js đọc cả hai thành null).
    const [isNull] = await sql<{ n: boolean }[]>`SELECT stop_value IS NULL AS n FROM device_tags WHERE id = ${fx.tStop}`;
    expect(isNull.n).toBe(true);
    const a = await auditRows(fx.tStop);
    const cuoi = a[a.length - 1];
    expect(cuoi.action).toBe("stop_pin_clear");
    expect(cuoi.beforeJson.stopValue).toBe(true);
    expect(cuoi.afterJson.stopValue).toBeNull();
    expect(cuoi.reason).toBe("D1 go ghim");
  });

  it("★ tags.update writable=false trên tag ĐANG ghim ⇒ ghim bị gỡ CÙNG transaction + audit autoClearedBy", async () => {
    const c = caller(fx.eng, "engineer");
    await c.tags.setStopPin({ adapterId: fx.aA, tagKey: "stop_cmd", stopValue: true, reason: "D1 ghim truoc khi tat ghi" });
    const truoc = (await auditRows(fx.tStop)).length;
    const upd = await c.tags.update({ id: fx.tStop, writable: false });
    expect(upd.writable).toBe(false);
    expect(upd.stopValue).toBeNull();
    const row = await tag(fx.tStop);
    expect(row.writable).toBe(false);
    expect(row.stop_value).toBeNull();
    expect(row.stop_pinned_by).toBeNull();
    const a = await auditRows(fx.tStop);
    expect(a).toHaveLength(truoc + 1);
    expect(a[a.length - 1].action).toBe("stop_pin_clear");
    expect(a[a.length - 1].afterJson).toMatchObject({ stopValue: null, autoClearedBy: "tag_not_writable" });
    expect(a[a.length - 1].beforeJson.stopValue).toBe(true);
    // Trả lại writable cho các ca sau.
    await c.tags.update({ id: fx.tStop, writable: true });
  });

  // ⚠ Nợ CÓ SẴN (không thuộc Task 1): `tagCreateInput.partial()` giữ `.default()` của zod 4 ⇒ một
  //   tags.update THIẾU `writable`/`isEnabled` bị điền writable=false / isEnabled=true. Form của trang gửi
  //   ĐỦ hai cờ; các ca dưới cũng gửi đủ như form. Ca cuối ghim hệ quả với ghim: chiều AN TOÀN (gỡ).
  it("tags.update isEnabled=false / đổi address ⇒ gỡ; đổi unit (form gửi đủ cờ) ⇒ GIỮ ghim (đường hợp lệ không bị gỡ oan)", async () => {
    const c = caller(fx.eng, "engineer");
    const co = { writable: true, isEnabled: true } as const;
    await c.tags.setStopPin({ adapterId: fx.aA, tagKey: "mode", stopValue: "STOP", reason: "D1 ghim mode" });
    await c.tags.update({ id: fx.tMode, unit: "-", ...co });
    expect((await tag(fx.tMode)).stop_value).toBe("STOP");

    await c.tags.update({ id: fx.tMode, address: "DB9.mode_moi", ...co });
    expect((await tag(fx.tMode)).stop_value).toBeNull();
    let a = await auditRows(fx.tMode);
    expect(a[a.length - 1].afterJson.autoClearedBy).toBe("tag_redefined");

    await c.tags.setStopPin({ adapterId: fx.aA, tagKey: "mode", stopValue: "STOP", reason: "D1 ghim mode lan 2" });
    await c.tags.update({ id: fx.tMode, writable: true, isEnabled: false });
    expect((await tag(fx.tMode)).stop_value).toBeNull();
    a = await auditRows(fx.tMode);
    expect(a[a.length - 1].afterJson.autoClearedBy).toBe("tag_disabled");
    await c.tags.update({ id: fx.tMode, ...co });
  });

  it("nợ có sẵn: tags.update chỉ gửi isEnabled (như công tắc trong bảng) ⇒ zod điền writable=false ⇒ ghim bị GỠ (chiều an toàn), có audit", async () => {
    const c = caller(fx.eng, "engineer");
    const co = { writable: true, isEnabled: true } as const;
    await c.tags.setStopPin({ adapterId: fx.aA, tagKey: "mode", stopValue: "STOP", reason: "D1 ghim mode lan 3" });
    await c.tags.update({ id: fx.tMode, isEnabled: true });
    const row = await tag(fx.tMode);
    expect(row.writable).toBe(false);
    expect(row.stop_value).toBeNull();
    const a = await auditRows(fx.tMode);
    expect(a[a.length - 1].afterJson.autoClearedBy).toBe("tag_not_writable");
    await c.tags.update({ id: fx.tMode, ...co });
  });

  it("★ adapter ĐÃ commissioning ⇒ vẫn cho đổi ghim, audit gắn commissioningRecheckRequired:true; bản ghi commissioning còn active", async () => {
    await sql`INSERT INTO commissioning_records ("adapterId", status, "signedBy", "fatReference") VALUES (${fx.aA}, 'active', ${fx.admin}, ${RUN})`;
    const r = await caller(fx.eng, "engineer").tags.setStopPin({ adapterId: fx.aA, tagKey: "speed_sp", stopValue: 0, reason: "D1 ghim khi da commissioning" });
    expect(r).toMatchObject({ changed: true, stopValue: 0, commissioningRecheckRequired: true });
    const a = await auditRows(fx.tSpeed);
    expect(a[a.length - 1].afterJson).toMatchObject({ stopValue: 0, commissioningRecheckRequired: true });
    const l = await auditLogRows(fx.tSpeed);
    expect(JSON.parse(l[l.length - 1].details).metadata.commissioningRecheckRequired).toBe(true);
    const [cr] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM commissioning_records WHERE "adapterId" = ${fx.aA} AND status = 'active'`;
    expect(cr.n).toBe(1);
    // Người ký commissioning THẤY các tag dừng đã ghim (commissioning.status).
    const st = await commissioningRouter.createCaller({ user: { id: fx.admin, role: "admin", name: "probe-admin", twoFactorEnabled: true } } as any)
      .status({ adapterId: fx.aA });
    expect(st.commissioned).toBe(true);
    expect(st.pinnedStopTags).toContainEqual({ tagKey: "speed_sp", value: 0 });
  });

  it("★ loadStopPins: chỉ tag enabled + writable + ghim hợp lệ với dataType HIỆN TẠI", async () => {
    const db = (await getDb())!;
    await caller(fx.eng, "engineer").tags.setStopPin({ adapterId: fx.aA, tagKey: "stop_cmd", stopValue: true, reason: "D1 ghim cho load" });
    // Dữ liệu lệch dựng bằng SQL thô (đường API không cho): ghim trên tag không writable / tắt; ghim sai kiểu.
    await sql`UPDATE device_tags SET stop_value = 'true'::jsonb WHERE id = ${fx.tRo}`;
    await sql`UPDATE device_tags SET stop_value = 'true'::jsonb WHERE id = ${fx.tOff}`;
    await sql`UPDATE device_tags SET stop_value = '"0"'::jsonb, writable = true, "isEnabled" = true WHERE id = ${fx.tMode}`; // string tag: "0" hợp lệ
    await sql`UPDATE device_tags SET stop_value = '0'::jsonb WHERE id = ${fx.tSpeed}`;
    const pins = await loadStopPins(db, fx.aA);
    expect(pins).toEqual([
      { tagKey: "mode", value: "0" },
      { tagKey: "speed_sp", value: 0 },
      { tagKey: "stop_cmd", value: true },
    ]);
    // Đổi dataType bằng SQL thô sang int với giá trị 12.5 (không nguyên) ⇒ ghim lệch kiểu ⇒ bị bỏ qua.
    await sql`UPDATE device_tags SET stop_value = '12.5'::jsonb, "dataType" = 'int' WHERE id = ${fx.tSpeed}`;
    const pins2 = await loadStopPins(db, fx.aA);
    expect(pins2.map((p) => p.tagKey)).toEqual(["mode", "stop_cmd"]);
    await sql`UPDATE device_tags SET stop_value = NULL WHERE id = ANY(${[fx.tRo, fx.tOff, fx.tMode]})`;
    await sql`UPDATE device_tags SET stop_value = '0'::jsonb, "dataType" = 'float' WHERE id = ${fx.tSpeed}`;
    expect(await loadStopPins(db, fx.aB)).toEqual([]);
  });

  it("★ tags.delete trên tag đang ghim ⇒ audit gỡ (tag_deleted) trong CÙNG transaction", async () => {
    const c = caller(fx.eng, "engineer");
    const tmp = Number((await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
                                   VALUES (${fx.aA}, 'tmp_stop', 'DB1.tmp', 'bool', true, true) RETURNING id`)[0].id);
    await c.tags.setStopPin({ adapterId: fx.aA, tagKey: "tmp_stop", stopValue: false, reason: "D1 ghim tmp" });
    await c.tags.delete({ id: tmp });
    const [con] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM device_tags WHERE id = ${tmp}`;
    expect(con.n).toBe(0);
    const a = await auditRows(tmp);
    expect(a.map((r) => r.action)).toEqual(["stop_pin_set", "stop_pin_clear"]);
    expect(a[1].beforeJson.stopValue).toBe(false);
    expect(a[1].afterJson.autoClearedBy).toBe("tag_deleted");
  });
});
