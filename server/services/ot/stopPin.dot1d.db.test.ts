/**
 * doc 81 Đợt 1D Task 1 — `deviceAdapter.tags.setStopPin` + gỡ ghim tự động + `loadStopPins`, trên DB
 * `_test` THẬT (mig 0362 đã áp bằng `scripts/apply-migration-0362.mjs --test-only`).
 *
 * Nghiệm thu (brief Task 1 bước 6): cần canEdit; tag không ghi được / bị tắt bị từ chối; sai kiểu bị từ
 * chối; audit có trước/sau và KHÔNG có bí mật; gỡ được; tag thành không-ghi-được ⇒ ghim bị gỡ; tag của
 * adapter khác bị từ chối. Thêm: phạm vi adapter (máy ngoài phạm vi ⇒ không thấy), commissioning ⇒ vẫn
 * cho đổi + cờ `commissioningRecheckRequired`, audit hỏng ⇒ ghim KHÔNG đổi, `loadStopPins` fail-closed.
 * Fix round 1: ĐỘC LẬP THỨ TỰ (beforeEach đưa mọi fixture về trạng thái gốc; ca nào cần ghim tự ghim);
 * R-1D-a (adapter đổi đích ⇒ gỡ MỌI ghim); R-1D-b (update thiếu cờ = GIỮ NGUYÊN); tags.update đổi
 * dataType/scale/offset/adapterId; adapter delete; no-op trên adapter đã commissioning.
 *
 * Oracle độc lập: trạng thái đọc bằng `SELECT` thô qua kết nối `postgres` riêng; fixture dựng bằng
 * INSERT thô. Dấu chân: `control_audit_log`/`audit_logs` là WORM (không xoá được) — entityId = id tag thử.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
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
const OPTS_GOC = { userName: "op", password: SECRET, unitId: 1 };

let sql: ReturnType<typeof postgres>;
const fx = {
  factories: [] as number[], workshops: [] as number[], lines: [] as number[], stations: [] as number[],
  mTrong: 0, mTrong2: 0, mNgoai: 0,
  aA: 0, aB: 0, aNgoai: 0,
  tStop: 0, tSpeed: 0, tRo: 0, tOff: 0, tMode: 0, tB: 0, tNgoai: 0,
  admin: 0, eng: 0, engView: 0,
};
const users: number[] = [];
const tmpTags: number[] = [];
const tmpAdapters: number[] = [];

/** Định nghĩa GỐC của từng tag fixture — beforeEach đưa về đúng thế này. */
type TagGoc = { adapter: () => number; key: string; dataType: string; writable: boolean; isEnabled: boolean };
const TAG_GOC: Record<string, TagGoc> = {
  tStop: { adapter: () => fx.aA, key: "stop_cmd", dataType: "bool", writable: true, isEnabled: true },
  tSpeed: { adapter: () => fx.aA, key: "speed_sp", dataType: "float", writable: true, isEnabled: true },
  tRo: { adapter: () => fx.aA, key: "ro_state", dataType: "bool", writable: false, isEnabled: true },
  tOff: { adapter: () => fx.aA, key: "off_cmd", dataType: "bool", writable: true, isEnabled: false },
  tMode: { adapter: () => fx.aA, key: "mode", dataType: "string", writable: true, isEnabled: true },
  tB: { adapter: () => fx.aB, key: "b_only", dataType: "bool", writable: true, isEnabled: true },
  tNgoai: { adapter: () => fx.aNgoai, key: "stop_cmd", dataType: "bool", writable: true, isEnabled: true },
};

function caller(userId: number, role: string) {
  return deviceAdapterRouter.createCaller({
    user: { id: userId, role, name: `probe-${role}`, twoFactorEnabled: true },
  } as any);
}
const eng = () => caller(fx.eng, "engineer");
const tag = async (id: number) =>
  (await sql<{ stop_value: unknown; stop_pinned_by: string | null; stop_pinned_at: Date | null; writable: boolean; isEnabled: boolean }[]>`
    SELECT stop_value, stop_pinned_by, stop_pinned_at, writable, "isEnabled" FROM device_tags WHERE id = ${id}`)[0];
const auditRows = async (tagId: number) =>
  sql<{ id: number; action: string; actorId: number | null; beforeJson: any; afterJson: any; reason: string | null }[]>`
    SELECT id, action, "actorId", "beforeJson", "afterJson", reason FROM control_audit_log
     WHERE "entityType" = 'device_tag_stop_pin' AND "entityId" = ${String(tagId)} ORDER BY id`;
const auditCuoi = async (tagId: number) => {
  const a = await auditRows(tagId);
  return a[a.length - 1];
};
const auditLogRows = async (tagId: number) =>
  sql<{ action: string; userId: number | null; entityType: string; details: string }[]>`
    SELECT action, "userId", "entityType", details FROM audit_logs
     WHERE action = 'deviceTag.setStopPin' AND "entityType" = 'device_tag' AND "entityId" = ${tagId} ORDER BY id`;
/** Ghim bằng API (đường thật) — mỗi ca tự dựng ghim nó cần. */
const ghim = (tagKey: string, stopValue: unknown, adapterId = fx.aA) =>
  eng().tags.setStopPin({ adapterId, tagKey, stopValue, reason: `D1 ghim ${tagKey}` });

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
    // Khoá niêm phong mật khẩu connectionOptions (khuôn deviceAdapterRouter.race.db.test.ts) — chỉ trong tiến trình test.
    process.env.SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY || "d1-stoppin-test-key";
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
    fx.mTrong2 = await may(sTrong, "M2");
    fx.mNgoai = await may(sNgoai, "MN");

    const adapter = (hau: string, machineId: number) =>
      one(sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "connectionOptions", "machineId", "isEnabled")
              VALUES (${`${RUN}-${hau}`}, ${`D1 ${hau}`}, 'stub', 'stub://d1',
                      ${sql.json(OPTS_GOC)}, ${machineId}, false) RETURNING id`);
    fx.aA = await adapter("A", fx.mTrong);
    fx.aB = await adapter("B", fx.mTrong);
    fx.aNgoai = await adapter("NGOAI", fx.mNgoai);

    for (const [k, g] of Object.entries(TAG_GOC)) {
      (fx as any)[k] = await one(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
              VALUES (${g.adapter()}, ${g.key}, ${`DB1.${g.key}`}, ${g.dataType}, ${g.writable}, ${g.isEnabled}) RETURNING id`);
    }

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
          VALUES (${uid}, 'machine_control', ${resolvePermissionModule("machine_control")}, true, true, ${canEdit}, true, false)`;
    await cap(fx.eng, true);
    await cap(fx.engView, false);
    for (const uid of [fx.eng, fx.engView]) {
      await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uid}, ${`F-${RUN}`})`;
    }
  }, 120_000);

  // Fix round 1 (#8) — MỖI ca bắt đầu từ cùng một trạng thái gốc: không ca nào dựa vào ghim/cờ do ca trước để lại.
  beforeEach(async () => {
    for (const [k, g] of Object.entries(TAG_GOC)) {
      await sql`UPDATE device_tags SET "adapterId" = ${g.adapter()}, "tagKey" = ${g.key}, address = ${`DB1.${g.key}`},
                  "dataType" = ${g.dataType}, writable = ${g.writable}, "isEnabled" = ${g.isEnabled},
                  scale = 1, "offset" = 0, unit = NULL,
                  stop_value = NULL, stop_pinned_by = NULL, stop_pinned_at = NULL
                WHERE id = ${(fx as any)[k]}`;
    }
    for (const [a, m] of [[fx.aA, fx.mTrong], [fx.aB, fx.mTrong], [fx.aNgoai, fx.mNgoai]] as const) {
      await sql`UPDATE device_adapters SET protocol = 'stub', endpoint = 'stub://d1', "connectionOptions" = ${sql.json(OPTS_GOC)},
                  "machineId" = ${m}, "isEnabled" = false, "pollIntervalMs" = 5000, name = 'D1 goc' WHERE id = ${a}`;
    }
    await sql`DELETE FROM commissioning_records WHERE "adapterId" = ANY(${[fx.aA, fx.aB, fx.aNgoai]})`;
  });

  afterEach(() => {
    h.auditHong = false;
  });

  afterAll(async () => {
    if (!sql) return;
    const adapters = [fx.aA, fx.aB, fx.aNgoai, ...tmpAdapters].filter((x) => x > 0);
    await sql`DELETE FROM commissioning_records WHERE "adapterId" = ANY(${adapters})`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ANY(${adapters}) OR id = ANY(${tmpTags})`;
    await sql`DELETE FROM device_adapters WHERE id = ANY(${adapters})`;
    await sql`DELETE FROM machines WHERE id = ANY(${[fx.mTrong, fx.mTrong2, fx.mNgoai].filter((x) => x > 0)})`;
    await sql`DELETE FROM stations WHERE id = ANY(${fx.stations})`;
    await sql`DELETE FROM production_lines WHERE id = ANY(${fx.lines})`;
    await sql`DELETE FROM workshops WHERE id = ANY(${fx.workshops})`;
    await sql`DELETE FROM factories WHERE id = ANY(${fx.factories})`;
    await sql`DELETE FROM permissions WHERE "userId" = ANY(${users})`;
    await sql`DELETE FROM user_factory_assignments WHERE "userId" = ANY(${users})`;
    await sql`DELETE FROM users WHERE id = ANY(${users})`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  // ─── setStopPin: cổng ───────────────────────────────────────────────────────────────────────────

  it("thiếu canEdit (machine_control canView) ⇒ PERMISSION_DENIED, ghim không đổi", async () => {
    const e = await loi(caller(fx.engView, "engineer").tags.setStopPin({ adapterId: fx.aA, tagKey: "stop_cmd", stopValue: true, reason: "D1 thieu quyen" }));
    expect(meta(e).appCode).toBe("PERMISSION_DENIED");
    expect((await tag(fx.tStop)).stop_value).toBeNull();
  });

  it("lý do < 5 ký tự ⇒ bị từ chối ở input", async () => {
    await expect(eng().tags.setStopPin({ adapterId: fx.aA, tagKey: "stop_cmd", stopValue: true, reason: "abc" })).rejects.toThrow();
    expect((await tag(fx.tStop)).stop_value).toBeNull();
  });

  it("tag KHÔNG writable ⇒ INVALID_VALUE stopPinTagNotWritable; tag bị TẮT ⇒ cùng lỗi", async () => {
    const e1 = await loi(eng().tags.setStopPin({ adapterId: fx.aA, tagKey: "ro_state", stopValue: true, reason: "D1 ro tag" }));
    expect(meta(e1)).toEqual({ appCode: "INVALID_VALUE", appParams: { field: "stopValue", reason: "stopPinTagNotWritable" } });
    const e2 = await loi(eng().tags.setStopPin({ adapterId: fx.aA, tagKey: "off_cmd", stopValue: true, reason: "D1 off tag" }));
    expect(meta(e2).appParams?.reason).toBe("stopPinTagNotWritable");
    expect((await tag(fx.tRo)).stop_value).toBeNull();
    expect((await tag(fx.tOff)).stop_value).toBeNull();
    expect(await auditRows(fx.tRo)).toHaveLength(0);
  });

  it("sai kiểu ⇒ INVALID_VALUE stopPinTypeMismatch (float nhận \"0\"; bool nhận \"true\"; string nhận 0; vắng stopValue)", async () => {
    for (const [tagKey, stopValue] of [["speed_sp", "0"], ["stop_cmd", "true"], ["mode", 0]] as const) {
      const e = await loi(eng().tags.setStopPin({ adapterId: fx.aA, tagKey, stopValue, reason: "D1 sai kieu" }));
      expect(meta(e), `${tagKey}=${JSON.stringify(stopValue)}`).toEqual({
        appCode: "INVALID_VALUE", appParams: { field: "stopValue", reason: "stopPinTypeMismatch" },
      });
    }
    const e = await loi(eng().tags.setStopPin({ adapterId: fx.aA, tagKey: "stop_cmd", reason: "D1 vang gia tri" } as any));
    expect(meta(e).appParams?.reason).toBe("stopPinTypeMismatch");
    expect((await tag(fx.tSpeed)).stop_value).toBeNull();
    expect((await tag(fx.tStop)).stop_value).toBeNull();
  });

  it("★ tag của ADAPTER KHÁC (tagKey chỉ có ở B, gửi adapterId A) ⇒ ENTITY_NOT_FOUND; tag của B không đổi", async () => {
    const e = await loi(eng().tags.setStopPin({ adapterId: fx.aA, tagKey: "b_only", stopValue: true, reason: "D1 cheo adapter" }));
    expect(meta(e)).toEqual({ appCode: "ENTITY_NOT_FOUND", appParams: { entity: "deviceTag" } });
    expect((await tag(fx.tB)).stop_value).toBeNull();
  });

  it("★ adapter của máy NGOÀI phạm vi người sửa ⇒ ENTITY_NOT_FOUND (adapter); admin (không lọc) thì được", async () => {
    const e = await loi(eng().tags.setStopPin({ adapterId: fx.aNgoai, tagKey: "stop_cmd", stopValue: true, reason: "D1 ngoai pham vi" }));
    expect(meta(e)).toEqual({ appCode: "ENTITY_NOT_FOUND", appParams: { entity: "adapter" } });
    expect((await tag(fx.tNgoai)).stop_value).toBeNull();

    const r = await caller(fx.admin, "admin").tags.setStopPin({ adapterId: fx.aNgoai, tagKey: "stop_cmd", stopValue: true, reason: "D1 admin ghim" });
    expect(r.changed).toBe(true);
    expect((await tag(fx.tNgoai)).stop_value).toBe(true);
  });

  // ─── setStopPin: ghi + audit ────────────────────────────────────────────────────────────────────

  it("★ ghim bool 1 ⇒ lưu `true` (chuẩn hoá); MỘT dòng control_audit_log trước/sau/lý do/actor + MỘT dòng audit_logs; KHÔNG bí mật", async () => {
    const truocA = (await auditRows(fx.tStop)).length;
    const truocL = (await auditLogRows(fx.tStop)).length;
    const r = await eng().tags.setStopPin({ adapterId: fx.aA, tagKey: "stop_cmd", stopValue: 1, reason: "D1 ghim stop_cmd" });
    expect(r).toMatchObject({ tagId: fx.tStop, adapterId: fx.aA, tagKey: "stop_cmd", stopValue: true, stopPinnedBy: String(fx.eng), changed: true, commissioningRecheckRequired: false, adapterCommissioned: false });

    const row = await tag(fx.tStop);
    expect(row.stop_value).toBe(true);
    expect(row.stop_pinned_by).toBe(String(fx.eng));
    expect(row.stop_pinned_at).toBeInstanceOf(Date);

    const a = (await auditRows(fx.tStop)).slice(truocA);
    expect(a).toHaveLength(1);
    expect(a[0].action).toBe("stop_pin_set");
    expect(a[0].actorId).toBe(fx.eng);
    expect(a[0].reason).toBe("D1 ghim stop_cmd");
    expect(a[0].beforeJson).toEqual({ tagKey: "stop_cmd", adapterId: fx.aA, dataType: "bool", stopValue: null });
    expect(a[0].afterJson).toEqual({ tagKey: "stop_cmd", adapterId: fx.aA, dataType: "bool", stopValue: true, commissioningRecheckRequired: false });

    const l = (await auditLogRows(fx.tStop)).slice(truocL);
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
    await ghim("stop_cmd", true);
    const truoc = (await auditRows(fx.tStop)).length;
    const r = await eng().tags.setStopPin({ adapterId: fx.aA, tagKey: "stop_cmd", stopValue: true, reason: "D1 ghim lai" });
    expect(r).toMatchObject({ changed: false, commissioningRecheckRequired: false, adapterCommissioned: false });
    expect(await auditRows(fx.tStop)).toHaveLength(truoc);
  });

  it("★ audit hỏng SAU khi ghi ⇒ rollback: ghim không đổi, không dòng audit mồ côi", async () => {
    const truoc = await auditRows(fx.tSpeed);
    h.auditHong = true;
    await expect(eng().tags.setStopPin({ adapterId: fx.aA, tagKey: "speed_sp", stopValue: 0, reason: "D1 audit hong" })).rejects.toThrow();
    expect((await tag(fx.tSpeed)).stop_value).toBeNull();
    expect(await auditRows(fx.tSpeed)).toHaveLength(truoc.length);
  });

  it("★ ghim chuỗi \"0\" cho tag string ⇒ lưu/đọc lại ĐÚNG chuỗi \"0\" (listByAdapter, loadStopPins) — không bị đọc thành số", async () => {
    await ghim("mode", "0");
    const [raw] = await sql<{ t: string; kieu: string }[]>`SELECT stop_value::text AS t, jsonb_typeof(stop_value) AS kieu FROM device_tags WHERE id = ${fx.tMode}`;
    expect(raw).toEqual({ t: '"0"', kieu: "string" });
    const list = await eng().tags.listByAdapter({ adapterId: fx.aA });
    expect(list.find((x) => x.id === fx.tMode)?.stopValue).toBe("0");
    const pins = await loadStopPins((await getDb())!, fx.aA);
    expect(pins.find((p) => p.tagKey === "mode")).toEqual({ tagKey: "mode", value: "0" });
    await eng().tags.setStopPin({ adapterId: fx.aA, tagKey: "mode", stopValue: null, reason: "D1 go chuoi 0" });
    expect((await auditCuoi(fx.tMode)).beforeJson.stopValue).toBe("0");
  });

  it("★ gỡ (stopValue null) ⇒ cột về SQL NULL; audit stop_pin_clear trước true / sau null", async () => {
    await ghim("stop_cmd", true);
    const r = await eng().tags.setStopPin({ adapterId: fx.aA, tagKey: "stop_cmd", stopValue: null, reason: "D1 go ghim" });
    expect(r).toMatchObject({ changed: true, stopValue: null, stopPinnedBy: null, stopPinnedAt: null });
    const row = await tag(fx.tStop);
    expect(row.stop_value).toBeNull();
    expect(row.stop_pinned_by).toBeNull();
    expect(row.stop_pinned_at).toBeNull();
    const [isNull] = await sql<{ n: boolean }[]>`SELECT stop_value IS NULL AS n FROM device_tags WHERE id = ${fx.tStop}`;
    expect(isNull.n).toBe(true);
    const cuoi = await auditCuoi(fx.tStop);
    expect(cuoi.action).toBe("stop_pin_clear");
    expect(cuoi.beforeJson.stopValue).toBe(true);
    expect(cuoi.afterJson.stopValue).toBeNull();
    expect(cuoi.reason).toBe("D1 go ghim");
  });

  // ─── commissioning ──────────────────────────────────────────────────────────────────────────────

  it("★ adapter ĐÃ commissioning ⇒ vẫn cho đổi ghim, audit gắn commissioningRecheckRequired:true; bản ghi commissioning còn active; status liệt kê ghim", async () => {
    await sql`INSERT INTO commissioning_records ("adapterId", status, "signedBy", "fatReference") VALUES (${fx.aA}, 'active', ${fx.admin}, ${RUN})`;
    const r = await eng().tags.setStopPin({ adapterId: fx.aA, tagKey: "speed_sp", stopValue: 0, reason: "D1 ghim khi da commissioning" });
    expect(r).toMatchObject({ changed: true, stopValue: 0, commissioningRecheckRequired: true, adapterCommissioned: true });
    expect((await auditCuoi(fx.tSpeed)).afterJson).toMatchObject({ stopValue: 0, commissioningRecheckRequired: true });
    const l = await auditLogRows(fx.tSpeed);
    expect(JSON.parse(l[l.length - 1].details).metadata.commissioningRecheckRequired).toBe(true);
    const [cr] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM commissioning_records WHERE "adapterId" = ${fx.aA} AND status = 'active'`;
    expect(cr.n).toBe(1);
    const st = await commissioningRouter.createCaller({ user: { id: fx.admin, role: "admin", name: "probe-admin", twoFactorEnabled: true } } as any)
      .status({ adapterId: fx.aA });
    expect(st.commissioned).toBe(true);
    expect(st.pinnedStopTags).toEqual([{ tagKey: "speed_sp", value: 0 }]);
  });

  it("fix #5: no-op trên adapter ĐÃ commissioning ⇒ changed:false, KHÔNG audit, commissioningRecheckRequired:false (tập ghim không đổi) và adapterCommissioned:true", async () => {
    await ghim("speed_sp", 0);
    await sql`INSERT INTO commissioning_records ("adapterId", status, "signedBy", "fatReference") VALUES (${fx.aA}, 'active', ${fx.admin}, ${RUN})`;
    const truoc = (await auditRows(fx.tSpeed)).length;
    const r = await eng().tags.setStopPin({ adapterId: fx.aA, tagKey: "speed_sp", stopValue: 0, reason: "D1 no-op commissioned" });
    expect(r).toMatchObject({ changed: false, commissioningRecheckRequired: false, adapterCommissioned: true });
    expect(await auditRows(fx.tSpeed)).toHaveLength(truoc);
  });

  // ─── loadStopPins ───────────────────────────────────────────────────────────────────────────────

  it("★ loadStopPins: chỉ tag enabled + writable + ghim hợp lệ với dataType HIỆN TẠI", async () => {
    const db = (await getDb())!;
    await ghim("stop_cmd", true);
    await ghim("speed_sp", 0);
    // Dữ liệu lệch dựng bằng SQL thô (đường API không cho): ghim trên tag không writable / tắt.
    await sql`UPDATE device_tags SET stop_value = 'true'::jsonb WHERE id = ANY(${[fx.tRo, fx.tOff]})`;
    await sql`UPDATE device_tags SET stop_value = '"0"'::jsonb WHERE id = ${fx.tMode}`;
    expect(await loadStopPins(db, fx.aA)).toEqual([
      { tagKey: "mode", value: "0" },
      { tagKey: "speed_sp", value: 0 },
      { tagKey: "stop_cmd", value: true },
    ]);
    // Đổi dataType bằng SQL thô sang int với giá trị 12.5 (không nguyên) ⇒ ghim lệch kiểu ⇒ bị bỏ qua.
    await sql`UPDATE device_tags SET stop_value = '12.5'::jsonb, "dataType" = 'int' WHERE id = ${fx.tSpeed}`;
    expect((await loadStopPins(db, fx.aA)).map((p) => p.tagKey)).toEqual(["mode", "stop_cmd"]);
    expect(await loadStopPins(db, fx.aB)).toEqual([]);
  });

  // ─── tags.update: gỡ tự động ────────────────────────────────────────────────────────────────────

  it("★ tags.update writable=false trên tag ĐANG ghim ⇒ ghim bị gỡ CÙNG transaction + audit autoClearedBy", async () => {
    await ghim("stop_cmd", true);
    const truoc = (await auditRows(fx.tStop)).length;
    const upd = await eng().tags.update({ id: fx.tStop, writable: false });
    expect(upd.writable).toBe(false);
    expect(upd.stopValue).toBeNull();
    const row = await tag(fx.tStop);
    expect(row).toMatchObject({ writable: false, stop_value: null, stop_pinned_by: null });
    const a = await auditRows(fx.tStop);
    expect(a).toHaveLength(truoc + 1);
    expect(a[a.length - 1].action).toBe("stop_pin_clear");
    expect(a[a.length - 1].afterJson).toMatchObject({ stopValue: null, autoClearedBy: "tag_not_writable" });
    expect(a[a.length - 1].beforeJson.stopValue).toBe(true);
  });

  it("★ M4: tags.update gỡ ghim ⇒ trả stopPinAutoCleared + commissioningRecheckRequired (adapter ĐÃ commissioning ⇒ true, khớp audit); không gỡ ⇒ hàng như cũ (không cờ)", async () => {
    // Chưa commissioning ⇒ gỡ ghim, cờ nhắc = false.
    await ghim("stop_cmd", true);
    const u1 = (await eng().tags.update({ id: fx.tStop, isEnabled: false })) as Record<string, unknown>;
    expect(u1).toMatchObject({ stopPinAutoCleared: true, commissioningRecheckRequired: false, stopValue: null });
    expect((await auditCuoi(fx.tStop)).afterJson).toMatchObject({ autoClearedBy: "tag_disabled", commissioningRecheckRequired: false });
    // ĐÃ commissioning ⇒ cờ nhắc = true, audit (control_audit_log + audit_logs) ghi đúng cờ đó.
    await sql`UPDATE device_tags SET "isEnabled" = true WHERE id = ${fx.tStop}`;
    await sql`INSERT INTO commissioning_records ("adapterId", status, "signedBy", "fatReference") VALUES (${fx.aA}, 'active', ${fx.admin}, ${RUN})`;
    await ghim("stop_cmd", true);
    const u2 = (await eng().tags.update({ id: fx.tStop, writable: false })) as Record<string, unknown>;
    expect(u2).toMatchObject({ stopPinAutoCleared: true, commissioningRecheckRequired: true, writable: false, stopValue: null });
    expect((await auditCuoi(fx.tStop)).afterJson).toMatchObject({ autoClearedBy: "tag_not_writable", commissioningRecheckRequired: true });
    const l = await auditLogRows(fx.tStop);
    expect(JSON.parse(l[l.length - 1].details).metadata.commissioningRecheckRequired).toBe(true);
    // Sửa không gỡ ghim ⇒ không có trường mới.
    const u3 = (await eng().tags.update({ id: fx.tStop, unit: "-" })) as Record<string, unknown>;
    expect("stopPinAutoCleared" in u3).toBe(false);
    expect("commissioningRecheckRequired" in u3).toBe(false);
  });

  it("tags.update isEnabled=false ⇒ gỡ (tag_disabled); đổi unit ⇒ GIỮ ghim", async () => {
    await ghim("mode", "STOP");
    await eng().tags.update({ id: fx.tMode, unit: "-" });
    expect((await tag(fx.tMode)).stop_value).toBe("STOP");
    await eng().tags.update({ id: fx.tMode, isEnabled: false });
    expect((await tag(fx.tMode)).stop_value).toBeNull();
    expect((await auditCuoi(fx.tMode)).afterJson.autoClearedBy).toBe("tag_disabled");
  });

  it.each([
    ["address", { address: "DB9.moi" }],
    ["dataType", { dataType: "int" as const }],
    ["scale", { scale: 2 }],
    ["offset", { offset: 5 }],
  ])("★ fix #4: tags.update đổi %s trên tag đang ghim ⇒ gỡ (tag_redefined) + audit", async (_ten, doi) => {
    await ghim("speed_sp", 0);
    await eng().tags.update({ id: fx.tSpeed, ...doi });
    expect((await tag(fx.tSpeed)).stop_value).toBeNull();
    const c = await auditCuoi(fx.tSpeed);
    expect(c.action).toBe("stop_pin_clear");
    expect(c.afterJson.autoClearedBy).toBe("tag_redefined");
  });

  it("★ fix #4: tags.update đổi adapterId (chuyển tag sang adapter khác) ⇒ gỡ (tag_redefined) + audit", async () => {
    await ghim("stop_cmd", true);
    await eng().tags.update({ id: fx.tStop, adapterId: fx.aB });
    const row = await tag(fx.tStop);
    expect(row.stop_value).toBeNull();
    expect((await auditCuoi(fx.tStop)).afterJson.autoClearedBy).toBe("tag_redefined");
    expect(await loadStopPins((await getDb())!, fx.aB)).toEqual([]);
  });

  it("fix #4: tags.update gửi LẠI cùng scale/offset (form sửa, kể cả ô trống = null ≡ 1/0 hiệu lực) ⇒ GIỮ ghim", async () => {
    await ghim("speed_sp", 0);
    await eng().tags.update({ id: fx.tSpeed, scale: 1, offset: 0, address: "DB1.speed_sp", dataType: "float", writable: true, isEnabled: true });
    expect((await tag(fx.tSpeed)).stop_value).toBe(0);
    await eng().tags.update({ id: fx.tSpeed, scale: null, offset: null });
    expect((await tag(fx.tSpeed)).stop_value).toBe(0);
  });

  // ─── R-1D-b: update thiếu cờ = GIỮ NGUYÊN ───────────────────────────────────────────────────────

  it("★ R-1D-b: tags.update CHỈ gửi isEnabled (công tắc trong bảng) ⇒ writable GIỮ NGUYÊN, ghim GIỮ NGUYÊN", async () => {
    await ghim("mode", "STOP");
    const truoc = (await auditRows(fx.tMode)).length;
    const r = await eng().tags.update({ id: fx.tMode, isEnabled: true });
    expect(r.writable).toBe(true);
    const row = await tag(fx.tMode);
    expect(row).toMatchObject({ writable: true, isEnabled: true, stop_value: "STOP" });
    expect(await auditRows(fx.tMode)).toHaveLength(truoc);
  });

  it("R-1D-b: tags.update CHỈ gửi writable trên tag đang TẮT ⇒ isEnabled GIỮ false (không bị bật lại)", async () => {
    await eng().tags.update({ id: fx.tOff, writable: true });
    expect(await tag(fx.tOff)).toMatchObject({ writable: true, isEnabled: false });
  });

  it("R-1D-b: adapter.update CHỈ gửi isEnabled ⇒ pollIntervalMs GIỮ NGUYÊN (không về 5000)", async () => {
    await sql`UPDATE device_adapters SET "pollIntervalMs" = 1234 WHERE id = ${fx.aB}`;
    const r = await eng().update({ id: fx.aB, isEnabled: false });
    expect(r.pollIntervalMs).toBe(1234);
  });

  // ─── R-1D-a: adapter đổi đích ⇒ gỡ MỌI ghim ─────────────────────────────────────────────────────

  it.each([
    // Đổi endpoint phải nhập lại mật khẩu (luật secretReentryRequired) — gửi mật khẩu MỚI, đích options giữ nguyên.
    ["endpoint", () => ({ endpoint: "stub://thiet-bi-khac", connectionOptions: { userName: "op", password: "Pw-moi-1", unitId: 1 } })],
    ["protocol", () => ({ protocol: "modbus" as const })],
    ["machineId", () => ({ machineId: fx.mTrong2 })],
    ["connectionOptions (unitId)", () => ({ connectionOptions: { userName: "op", password: "[redacted]", unitId: 2 } })],
  ])("★ R-1D-a: adapter.update đổi %s ⇒ gỡ MỌI ghim của adapter trong CÙNG tx, audit TỪNG tag (adapter_redefined)", async (_ten, doi) => {
    await ghim("stop_cmd", true);
    await ghim("speed_sp", 0);
    const r = await eng().update({ id: fx.aA, ...doi() });
    // doc 81 Đợt 4 Task C1 — số ghim vừa gỡ được TRẢ VỀ (UI báo), đúng bằng số hàng bị gỡ.
    expect(r.stopPinsCleared).toBe(2);
    expect((await tag(fx.tStop)).stop_value).toBeNull();
    expect((await tag(fx.tSpeed)).stop_value).toBeNull();
    for (const t of [fx.tStop, fx.tSpeed]) {
      const c = await auditCuoi(t);
      expect(c.action).toBe("stop_pin_clear");
      expect(c.afterJson.autoClearedBy).toBe("adapter_redefined");
      expect(c.reason).toContain("deviceAdapter.update");
    }
    expect(await loadStopPins((await getDb())!, fx.aA)).toEqual([]);
  });

  it("R-1D-a: adapter.update KHÔNG đổi đích (đổi tên, pollIntervalMs, gửi lại nguyên endpoint/machineId/options, đổi mật khẩu) ⇒ GIỮ ghim", async () => {
    await ghim("stop_cmd", true);
    const truoc = (await auditRows(fx.tStop)).length;
    const r0 = await eng().update({
      id: fx.aA, name: "D1 doi ten", pollIntervalMs: 2000, endpoint: "stub://d1", protocol: "stub", machineId: fx.mTrong,
      connectionOptions: { userName: "op", password: "[redacted]", unitId: 1 },
    });
    const r1 = await eng().update({ id: fx.aA, connectionOptions: { userName: "op", password: "Mat-khau-moi-1", unitId: 1 } });
    // doc 81 Đợt 4 Task C1 — không gỡ ⇒ stopPinsCleared 0 (UI im).
    expect(r0.stopPinsCleared).toBe(0);
    expect(r1.stopPinsCleared).toBe(0);
    expect((await tag(fx.tStop)).stop_value).toBe(true);
    expect(await auditRows(fx.tStop)).toHaveLength(truoc);
  });

  // ─── xoá ────────────────────────────────────────────────────────────────────────────────────────

  it("★ tags.delete trên tag đang ghim ⇒ audit gỡ (tag_deleted) trong CÙNG transaction", async () => {
    const tmp = Number((await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
                                   VALUES (${fx.aA}, ${`tmp_${Date.now()}`}, 'DB1.tmp', 'bool', true, true) RETURNING id, "tagKey"`)[0].id);
    tmpTags.push(tmp);
    const [{ tagKey }] = await sql<{ tagKey: string }[]>`SELECT "tagKey" FROM device_tags WHERE id = ${tmp}`;
    await ghim(tagKey, false);
    await eng().tags.delete({ id: tmp });
    const [con] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM device_tags WHERE id = ${tmp}`;
    expect(con.n).toBe(0);
    const a = await auditRows(tmp);
    expect(a.map((r) => r.action)).toEqual(["stop_pin_set", "stop_pin_clear"]);
    expect(a[1].beforeJson.stopValue).toBe(false);
    expect(a[1].afterJson.autoClearedBy).toBe("tag_deleted");
  });

  it("★ fix #4: xoá ADAPTER có tag đang ghim ⇒ audit gỡ (adapter_deleted) cho tag đó trong CÙNG transaction", async () => {
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    const ad = await one(sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "machineId", "isEnabled")
                             VALUES (${`${RUN}-DEL${Date.now()}`}, 'D1 del', 'stub', 'stub://del', ${fx.mTrong}, false) RETURNING id`);
    tmpAdapters.push(ad);
    const tPin = await one(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
                               VALUES (${ad}, 'del_stop', 'DB1.del', 'bool', true, true) RETURNING id`);
    const tKhong = await one(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
                                 VALUES (${ad}, 'del_other', 'DB1.oth', 'bool', true, true) RETURNING id`);
    await ghim("del_stop", true, ad);
    await eng().delete({ id: ad });
    const [con] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM device_tags WHERE "adapterId" = ${ad}`;
    expect(con.n).toBe(0);
    const a = await auditRows(tPin);
    expect(a.map((r) => r.action)).toEqual(["stop_pin_set", "stop_pin_clear"]);
    expect(a[1].afterJson.autoClearedBy).toBe("adapter_deleted");
    expect(await auditRows(tKhong)).toHaveLength(0);
  });
});
