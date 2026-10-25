/**
 * kiem-dinh R1b-1 H1 (a) (điều phối 2026-10-25) — `deviceAdapter.tags.setStopPin` là một CỬA GHI: `scadaCommands.dungMay` gửi ghim một bước
 * (mức 1, miễn chế độ / dải / policy / interlock). Trước: chỉ cần `machine_control.canEdit`, nhận bất kỳ tag writable + enabled với giá trị bất
 * kỳ trong dải ⇒ operator ghim tag mức 4 với giá trị X rồi bấm DỪNG ⇒ thiết bị nhận X (vượt TOTP, vượt sàn vai, vượt LOCAL).
 *
 * Nay (cả ĐẶT lẫn GỠ): sàn vai ACTUATION (admin / supervisor / engineer) TRƯỚC mọi đọc ⇒ kiểm hợp lệ ⇒ TOTP tươi mức 5 (`kiemTotpCauHinh`) CUỐI.
 *
 * CSDL `_test` THẬT; người dùng qua `taoNguoiDungTest`; 2FA thật (speakeasy + setup2FA/enable2FA); TOTP qua `kiemXacThucTheoMuc` THẬT (bộ đếm
 * T16 + sổ mã đã dùng thật). Oracle: SELECT thô.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import speakeasy from "speakeasy";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { setup2FA, enable2FA } from "../db/auth";
import { deviceAdapterRouter } from "./deviceAdapterRouter";

const DB_URL = process.env.DATABASE_URL;
const RUN = `r1bh1a${process.pid}${Date.now().toString(36)}`;

let sql: ReturnType<typeof postgres>;
const ids = { fac: "", may: 0, ad: 0, t4: 0, t1: 0, tRo: 0 };
const nguoi: Record<string, { id: number; role: string; tfa: boolean }> = {};
let secret = "";

async function maMoi(uid: number): Promise<string> {
  secret = speakeasy.generateSecret({ length: 20 }).base32;
  await setup2FA(uid, secret);
  await enable2FA(uid);
  return speakeasy.totp({ secret, encoding: "base32" });
}

const caller = (ten: string) => {
  const n = nguoi[ten];
  return deviceAdapterRouter.createCaller({ user: { id: n.id, role: n.role, name: `H1a ${ten}`, twoFactorEnabled: n.tfa } } as never);
};

async function loiCua(p: Promise<unknown>): Promise<{ code?: string; appCode?: string; appParams?: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
    return { code: x.code, appCode: x.cause?.appCode, appParams: x.cause?.appParams };
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}

const ghimCua = async (id: number) => (await sql`SELECT stop_value AS v FROM device_tags WHERE id = ${id}`)[0].v as unknown;

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("kiem-dinh R1b-1 H1 (a) — setStopPin: sàn vai ACTUATION + TOTP tươi mức 5", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const [f] = await sql`INSERT INTO factories (code, name) VALUES (${RUN}, ${RUN}) RETURNING id, code`;
    const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${RUN}, ${RUN}) RETURNING id`;
    const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${RUN}, ${RUN}) RETURNING id`;
    const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${RUN}, ${RUN}) RETURNING id`;
    const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${RUN}, ${RUN}, 'AOI', true) RETURNING id`;
    ids.fac = String(f.code);
    ids.may = Number(m.id);
    ids.ad = Number((await sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "isEnabled")
      VALUES (${ids.may}, ${RUN}, ${RUN}, 'stub', ${"stub://" + RUN}, false) RETURNING id`)[0].id);
    for (const [ten, role, tfa] of [
      ["op", "operator", false],
      ["eng", "engineer", true],
      ["engKhong2fa", "engineer", false],
    ] as const) {
      const u = await taoNguoiDungTest(ten, role, { tienTo: "r1bh1a", ts: RUN, ten: `H1a ${ten}` });
      await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${ids.fac})`;
      await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete")
        VALUES (${u.id}, 'machine_control', 'machine_control', true, true, true, true)`;
      nguoi[ten] = { id: u.id, role, tfa };
    }
  }, 60_000);

  beforeEach(async () => {
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${ids.ad}`;
    await sql`DELETE FROM totp_khoa_sai WHERE user_id IN ${sql(Object.values(nguoi).map((n) => n.id))}`;
    const tag = async (key: string, level: number | null, writable = true) =>
      Number((await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", actuation_level)
        VALUES (${ids.ad}, ${key}, ${"addr-" + key}, 'int', ${writable}, true, ${level}) RETURNING id`)[0].id);
    ids.t4 = await tag("van_m4", 4);
    ids.t1 = await tag("dung_m1", 1);
    ids.tRo = await tag("chi_doc", 1, false);
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${ids.ad}`;
    await sql`DELETE FROM device_adapters WHERE id = ${ids.ad}`;
    await sql`DELETE FROM machines WHERE code = ${RUN}`;
    await sql`DELETE FROM stations WHERE code = ${RUN}`;
    await sql`DELETE FROM production_lines WHERE code = ${RUN}`;
    await sql`DELETE FROM workshops WHERE code = ${RUN}`;
    await sql`DELETE FROM factories WHERE code = ${RUN}`;
    await sql`DELETE FROM totp_khoa_sai WHERE user_id IN ${sql(Object.values(nguoi).map((n) => n.id))}`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("★ operator (có machine_control.canEdit) ghim tag mức 4 ⇒ setStopPin TỪ CHỐI (SCADA_ROLE_FLOOR), ghim không đổi — kể cả có mã", async () => {
    const e = await loiCua(caller("op").tags.setStopPin({ adapterId: ids.ad, tagKey: "van_m4", stopValue: 77, reason: "op ghim muc 4", totpCode: "123456" }));
    expect(e).toMatchObject({ code: "FORBIDDEN", appCode: "SCADA_ROLE_FLOOR", appParams: { ma: "ROLE_FLOOR", level: 5 } });
    expect(await ghimCua(ids.t4)).toBeNull();
    // gỡ cũng là thay đổi ghim ⇒ cùng sàn vai
    const g = await loiCua(caller("op").tags.setStopPin({ adapterId: ids.ad, tagKey: "dung_m1", stopValue: null, reason: "op go ghim" }));
    expect(g).toMatchObject({ code: "FORBIDDEN", appCode: "SCADA_ROLE_FLOOR" });
    // sàn vai đứng TRƯỚC mọi đọc: tag chỉ đọc / tag không tồn tại ⇒ vẫn ROLE_FLOOR (không lộ tag, không lỗi kiểm hợp lệ)
    for (const tagKey of ["chi_doc", "khong_co_tag_nay"]) {
      const x = await loiCua(caller("op").tags.setStopPin({ adapterId: ids.ad, tagKey, stopValue: 0, reason: "op tag khac" }));
      expect(x, tagKey).toMatchObject({ code: "FORBIDDEN", appCode: "SCADA_ROLE_FLOOR" });
    }
  });

  it("★ engineer KHÔNG mã ⇒ TOTP_CAN (SCADA_CONFIG_TOTP_REQUIRED), ghim không đổi", async () => {
    await maMoi(nguoi.eng.id);
    const e = await loiCua(caller("eng").tags.setStopPin({ adapterId: ids.ad, tagKey: "dung_m1", stopValue: 0, reason: "eng khong ma" }));
    expect(e).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CONFIG_TOTP_REQUIRED", appParams: { ma: "TOTP_CAN" } });
    expect(await ghimCua(ids.t1)).toBeNull();
  });

  it("engineer mã SAI ⇒ TOTP_SAI; engineer chưa đăng ký 2FA ⇒ TOTP_NOT_ENROLLED; ghim không đổi", async () => {
    await maMoi(nguoi.eng.id);
    const sai = await loiCua(caller("eng").tags.setStopPin({ adapterId: ids.ad, tagKey: "dung_m1", stopValue: 0, reason: "eng ma sai", totpCode: "000000" }));
    expect(sai).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CONFIG_TOTP_INVALID" });
    const chua = await loiCua(caller("engKhong2fa").tags.setStopPin({ adapterId: ids.ad, tagKey: "dung_m1", stopValue: 0, reason: "eng chua 2fa", totpCode: "123456" }));
    expect(chua).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CONFIG_TOTP_NOT_ENROLLED" });
    expect(await ghimCua(ids.t1)).toBeNull();
  });

  it("★ kiểm hợp lệ ĐỨNG TRƯỚC mã: tag chỉ đọc ⇒ INVALID_VALUE stopPinTagNotWritable và mã KHÔNG bị tiêu (dùng lại được ngay cho lượt hợp lệ)", async () => {
    const ma = await maMoi(nguoi.eng.id);
    const e = await loiCua(caller("eng").tags.setStopPin({ adapterId: ids.ad, tagKey: "chi_doc", stopValue: 0, reason: "eng tag chi doc", totpCode: ma }));
    expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "INVALID_VALUE", appParams: { reason: "stopPinTagNotWritable" } });
    const r = await caller("eng").tags.setStopPin({ adapterId: ids.ad, tagKey: "dung_m1", stopValue: 0, reason: "eng ghim hop le", totpCode: ma });
    expect(r).toMatchObject({ changed: true, stopValue: 0 });
    expect(await ghimCua(ids.t1)).toBe(0);
  });

  it("★ engineer CÓ mã đúng ⇒ ghim được (kể cả tag mức 4 — lớp H1 b ở dungMay bỏ qua nó); mã dùng một lần; GỠ cũng cần mã mới", async () => {
    const ma = await maMoi(nguoi.eng.id);
    const r = await caller("eng").tags.setStopPin({ adapterId: ids.ad, tagKey: "van_m4", stopValue: 5, reason: "eng ghim m4", totpCode: ma });
    expect(r).toMatchObject({ changed: true, stopValue: 5 });
    expect(await ghimCua(ids.t4)).toBe(5);
    const lai = await loiCua(caller("eng").tags.setStopPin({ adapterId: ids.ad, tagKey: "van_m4", stopValue: null, reason: "eng go dung lai ma", totpCode: ma }));
    expect(lai).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_INVALID" });
    expect(await ghimCua(ids.t4)).toBe(5);
    const khong = await loiCua(caller("eng").tags.setStopPin({ adapterId: ids.ad, tagKey: "van_m4", stopValue: null, reason: "eng go khong ma" }));
    expect(khong).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_REQUIRED" });
    const ma2 = await maMoi(nguoi.eng.id);
    const go = await caller("eng").tags.setStopPin({ adapterId: ids.ad, tagKey: "van_m4", stopValue: null, reason: "eng go co ma", totpCode: ma2 });
    expect(go).toMatchObject({ changed: true, stopValue: null });
    expect(await ghimCua(ids.t4)).toBeNull();
  });
});
