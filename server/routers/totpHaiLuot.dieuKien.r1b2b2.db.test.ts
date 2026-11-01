/**
 * SCADA R1b-2b-2a T5B fix 1 — BỐN ĐIỀU KIỆN của dieu-phoi khi phê chuẩn thiết kế hai lượt (`chayGiaoDichTotpNgoai`), trên CSDL `_test` THẬT
 * (router tRPC THẬT, 2FA THẬT — speakeasy + setup2FA / enable2FA, bộ kiểm `kiemXacThucTheoMuc` THẬT, sổ mã đã dùng + bộ đếm sai THẬT).
 *
 *   1. Lượt 2 TÍNH LẠI "có cần mã không" dưới khoá mới: lượt 1 cần (luật bảo vệ) → giữa hai lượt luật thành NHÁP → lượt 2 không cần ⇒ vẫn ghi,
 *      xác minh ĐÚNG MỘT lần.
 *   2. "Đã xác minh" là trạng thái NỘI BỘ của một lượt gọi — không trường đầu vào nào (`cuaTotp`, `daXacMinh`, `kiemCuoi`, `totpDaKiem`,
 *      `xacThucKenhDaKhai`) bỏ qua được TOTP: zod (không `.strict()`) BỎ khoá lạ ⇒ thủ tục thấy "không có mã" ⇒ SCADA_CONFIG_TOTP_REQUIRED, không
 *      ghi. Hai thủ tục này KHÔNG có lối REST (đo: `server/api/v1`, `server/routes` không gắn interlock.update / setStopPin).
 *   3. Lượt 1 không có tác dụng phụ NGOÀI giao dịch trước cửa TOTP: mã SAI ⇒ số hàng `control_audit_log` / `audit_logs` của thực thể KHÔNG đổi;
 *      bộ phát thay đổi ghim (`setStopPinChangeBroadcaster`), `getIO()` (socket) và `sendNotification` KHÔNG được gọi. Đối chứng (không trống):
 *      lượt THÀNH CÔNG làm số hàng audit tăng và bộ phát ghim được gọi. (Cho phép: `invalidateStopPinPresence` ở `finally` của datStopPin — xoá
 *      bộ nhớ đệm, fail-closed.)
 *   4. Lượt 2 hỏng SAU khi mã đã tiêu (dữ liệu đổi giữa xác minh và lượt 2 — RÀO: bọc `kiemTotpCauHinh` THẬT, chạy SQL đổi dữ liệu NGAY SAU khi
 *      nó xác minh xong) ⇒ CONFLICT OPERATION_FAILED {scadaConfigTotp, scadaTotpDaDungDuLieuDoi, maGoc}; mã đã tiêu (dùng lại ⇒ TOTP_SAI), không
 *      ghi. Không bao giờ "mã sai" cho lượt ấy.
 * Oracle: SELECT thô qua kết nối riêng (`postgres`, max 1).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  /** Rào: chạy NGAY SAU khi `kiemTotpCauHinh` THẬT xác minh xong (một lần, rồi tự gỡ). */
  sauXacMinh: null as null | (() => Promise<void>),
  soLanXacMinh: 0,
  getIO: 0,
  guiThongBao: 0,
}));

vi.mock("../services/scada/totpCauHinh", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/scada/totpCauHinh")>();
  return {
    ...real,
    kiemTotpCauHinh: async (...a: Parameters<typeof real.kiemTotpCauHinh>) => {
      H.soLanXacMinh++;
      await real.kiemTotpCauHinh(...a);
      const f = H.sauXacMinh;
      H.sauXacMinh = null;
      if (f) await f();
    },
  };
});
vi.mock("../_core/socket", async (importOriginal) => {
  const real = await importOriginal<typeof import("../_core/socket")>();
  return { ...real, getIO: () => (H.getIO++, null) };
});
vi.mock("../services/notificationService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/notificationService")>();
  return {
    ...real,
    sendNotification: (async (...a: Parameters<typeof real.sendNotification>) => {
      H.guiThongBao++;
      return real.sendNotification(...a);
    }) as typeof real.sendNotification,
  };
});

import postgres from "postgres";
import speakeasy from "speakeasy";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { setup2FA, enable2FA } from "../db/auth";
import { setStopPinChangeBroadcaster } from "../services/ot/stopPinPresence";
import { interlockRouter } from "./interlockRouter";
import { deviceAdapterRouter } from "./deviceAdapterRouter";

const DB_URL = process.env.DATABASE_URL;
const RUN = `t5bdk${process.pid}${Date.now().toString(36)}`;

let sql: ReturnType<typeof postgres>;
const ids = { fac: "", may: 0, ad: 0, tVan: 0, tGhim: 0 };
const nguoi = { A: 0 };
let A!: ReturnType<typeof interlockRouter.createCaller>;
let devA!: ReturnType<typeof deviceAdapterRouter.createCaller>;
const phatGhim: number[] = [];
let goBoPhat: (() => void) | null = null;

async function maMoi(): Promise<string> {
  const secret = speakeasy.generateSecret({ length: 20 }).base32;
  await setup2FA(nguoi.A, secret);
  await enable2FA(nguoi.A);
  return speakeasy.totp({ secret, encoding: "base32" });
}

async function loiCua(p: Promise<unknown>): Promise<{ code?: string; appCode?: string; appParams?: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
    return { code: x.code, appCode: x.cause?.appCode, appParams: x.cause?.appParams };
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}

const hangLuat = async (id: number) =>
  (await sql`SELECT threshold, enabled, description FROM interlock_rules WHERE id = ${id}`)[0] as
    | { threshold: string; enabled: boolean; description: string | null }
    | undefined;
const ghimCua = async (id: number) => (await sql`SELECT stop_value AS v FROM device_tags WHERE id = ${id}`)[0].v as unknown;
/** Số hàng audit của MỘT thực thể ở cả hai sổ (control_audit_log theo entityType + entityId; audit_logs theo entityType + entityId). */
async function demAudit(caType: string, alType: string, id: number): Promise<{ ca: number; al: number }> {
  const [ca] = await sql`SELECT count(*)::int AS n FROM control_audit_log WHERE "entityType" = ${caType} AND "entityId" = ${String(id)}`;
  const [al] = await sql`SELECT count(*)::int AS n FROM audit_logs WHERE "entityType" = ${alType} AND "entityId" = ${id}`;
  return { ca: Number(ca.n), al: Number(al.n) };
}

/** Luật BẢO VỆ (ghi lệnh, ĐANG BẬT, đích tag): sửa / xoá cần TOTP mức 5. */
async function taoLuatBaoVe(ten: string): Promise<number> {
  const r = await A.create({
    name: `${RUN}-${ten}`,
    scope: "machine",
    machineId: ids.may,
    sourceType: "telemetry_tag",
    sourceKey: "nhiet",
    comparisonOperator: "gt",
    threshold: 80,
    action: "stop_line",
    targetAdapterId: ids.ad,
    commandTag: "van",
    commandValue: 0,
  });
  await sql`UPDATE interlock_rules SET enabled = true WHERE id = ${r.id}`;
  return r.id;
}

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("R1b-2b-2a T5B fix 1 — bốn điều kiện của thiết kế hai lượt (CSDL _test thật)", () => {
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
    const ua = await taoNguoiDungTest("a", "admin", { tienTo: "t5bdk", ts: RUN, ten: "T5B DK A" });
    nguoi.A = ua.id;
    A = interlockRouter.createCaller({ user: { id: ua.id, role: "admin", name: ua.name, twoFactorEnabled: true } } as never);
    devA = deviceAdapterRouter.createCaller({ user: { id: ua.id, role: "admin", name: ua.name, twoFactorEnabled: true } } as never);
    goBoPhat = setStopPinChangeBroadcaster((adapterId) => phatGhim.push(adapterId));
  }, 60_000);

  beforeEach(async () => {
    H.sauXacMinh = null;
    H.soLanXacMinh = 0;
    H.getIO = 0;
    H.guiThongBao = 0;
    phatGhim.length = 0;
    await sql`DELETE FROM interlock_rules WHERE name LIKE ${RUN + "-%"}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${ids.ad}`;
    await sql`DELETE FROM totp_khoa_sai WHERE user_id = ${nguoi.A}`;
    await sql`DELETE FROM totp_consumed WHERE "userId" = ${nguoi.A}`;
    const tag = async (key: string, writable: boolean, dataType: string) =>
      Number((await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
        VALUES (${ids.ad}, ${key}, ${"addr-" + key}, ${dataType}, ${writable}, true) RETURNING id`)[0].id);
    ids.tVan = await tag("van", true, "int");
    await tag("nhiet", false, "float");
    ids.tGhim = await tag("ghim", true, "int");
  });

  afterAll(async () => {
    goBoPhat?.();
    if (!sql) return;
    await sql`DELETE FROM interlock_rules WHERE name LIKE ${RUN + "-%"}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${ids.ad}`;
    await sql`DELETE FROM device_adapters WHERE id = ${ids.ad}`;
    await sql`DELETE FROM machines WHERE code = ${RUN}`;
    await sql`DELETE FROM stations WHERE code = ${RUN}`;
    await sql`DELETE FROM production_lines WHERE code = ${RUN}`;
    await sql`DELETE FROM workshops WHERE code = ${RUN}`;
    await sql`DELETE FROM factories WHERE code = ${RUN}`;
    await sql`DELETE FROM totp_khoa_sai WHERE user_id = ${nguoi.A}`;
    await sql`DELETE FROM totp_consumed WHERE "userId" = ${nguoi.A}`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("★ ĐK1 — lượt 1 CẦN mã, giữa hai lượt luật thành NHÁP ⇒ lượt 2 (tính lại dưới khoá) KHÔNG cần ⇒ vẫn ghi; xác minh ĐÚNG MỘT lần", async () => {
    const id = await taoLuatBaoVe("dk1");
    const ma = await maMoi();
    H.sauXacMinh = async () => {
      await sql`UPDATE interlock_rules SET enabled = false, "approvedBy" = NULL WHERE id = ${id}`;
    };
    const r = await A.update({ id, description: "dk1 sau khi thanh nhap", totpCode: ma });
    expect(r).toMatchObject({ description: "dk1 sau khi thanh nhap" });
    expect(H.soLanXacMinh).toBe(1);
    expect(H.sauXacMinh, "rào đã chạy").toBeNull();
    expect((await hangLuat(id))!.description).toBe("dk1 sau khi thanh nhap");
  });

  it("★ ĐK2 — trường lạ giả 'đã xác minh' (cuaTotp / daXacMinh / kiemCuoi / totpDaKiem / xacThucKenhDaKhai) KHÔNG bỏ qua TOTP: interlock.update + setStopPin ⇒ SCADA_CONFIG_TOTP_REQUIRED, không ghi", async () => {
    const id = await taoLuatBaoVe("dk2");
    await maMoi();
    const gia = {
      cuaTotp: () => undefined,
      daXacMinh: true,
      kiemCuoi: async () => undefined,
      totpDaKiem: true,
      xacThucKenhDaKhai: async () => undefined,
    };
    const e1 = await loiCua(A.update({ id, threshold: 99, ...gia } as never));
    expect(e1).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CONFIG_TOTP_REQUIRED", appParams: { ma: "TOTP_CAN" } });
    expect(Number((await hangLuat(id))!.threshold)).toBe(80);
    expect((await hangLuat(id))!.enabled).toBe(true);
    const e2 = await loiCua(devA.tags.setStopPin({ adapterId: ids.ad, tagKey: "ghim", stopValue: 0, reason: "gia da xac minh", ...gia } as never));
    expect(e2).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CONFIG_TOTP_REQUIRED", appParams: { ma: "TOTP_CAN" } });
    expect(await ghimCua(ids.tGhim)).toBeNull();
    expect(H.soLanXacMinh, "mỗi thủ tục đúng một lượt kiểm (trả TOTP_CAN)").toBe(2);
  });

  it("★ ĐK3 — mã SAI ⇒ lượt 1 rollback KHÔNG để lại audit (control_audit_log / audit_logs), không phát ghim / socket / thông báo; đối chứng: lượt đúng CÓ audit + phát ghim", async () => {
    const id = await taoLuatBaoVe("dk3");
    await maMoi();
    const truocLuat = await demAudit("interlock_rule", "interlock_rule", id);
    const e1 = await loiCua(A.update({ id, threshold: 91, totpCode: "000000" }));
    expect(e1).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_INVALID" });
    expect(await demAudit("interlock_rule", "interlock_rule", id)).toEqual(truocLuat);

    const truocGhim = await demAudit("device_tag_stop_pin", "device_tag", ids.tGhim);
    const e2 = await loiCua(devA.tags.setStopPin({ adapterId: ids.ad, tagKey: "ghim", stopValue: 0, reason: "ma sai dk3", totpCode: "000000" }));
    expect(e2).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_INVALID" });
    expect(await demAudit("device_tag_stop_pin", "device_tag", ids.tGhim)).toEqual(truocGhim);
    expect(await ghimCua(ids.tGhim)).toBeNull();
    expect(phatGhim, "bộ phát thay đổi ghim").toEqual([]);
    expect(H.getIO, "socket").toBe(0);
    expect(H.guiThongBao, "thông báo").toBe(0);

    // đối chứng: thiết bị đo KHÔNG trống — lượt đúng ghi audit ở cả hai sổ và phát ghim đúng một lần
    const ma = await maMoi();
    await devA.tags.setStopPin({ adapterId: ids.ad, tagKey: "ghim", stopValue: 0, reason: "ma dung dk3", totpCode: ma });
    const sau = await demAudit("device_tag_stop_pin", "device_tag", ids.tGhim);
    expect(sau.ca).toBe(truocGhim.ca + 1);
    expect(sau.al).toBe(truocGhim.al + 1);
    expect(phatGhim).toEqual([ids.ad]);
  });

  it("★ ĐK4 — interlock.update: luật bị XOÁ giữa xác minh và lượt 2 ⇒ CONFLICT scadaTotpDaDungDuLieuDoi (maGoc ENTITY_NOT_FOUND); mã đã tiêu (dùng lại ⇒ TOTP_SAI)", async () => {
    const id = await taoLuatBaoVe("dk4a");
    const id2 = await taoLuatBaoVe("dk4b");
    const ma = await maMoi();
    H.sauXacMinh = async () => {
      await sql`DELETE FROM interlock_rules WHERE id = ${id}`;
    };
    const e = await loiCua(A.update({ id, threshold: 92, totpCode: ma }));
    expect(e).toEqual({
      code: "CONFLICT",
      appCode: "OPERATION_FAILED",
      appParams: { operation: "scadaConfigTotp", reason: "scadaTotpDaDungDuLieuDoi", maGoc: "ENTITY_NOT_FOUND" },
    });
    const lai = await loiCua(A.update({ id: id2, threshold: 93, totpCode: ma }));
    expect(lai).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_INVALID" }); // đúng: mã ĐÃ tiêu ⇒ người dùng cần mã mới
    expect(Number((await hangLuat(id2))!.threshold)).toBe(80);
  });

  it("★ ĐK4 — setStopPin: tag thành KHÔNG GHI ĐƯỢC giữa xác minh và lượt 2 ⇒ CONFLICT scadaTotpDaDungDuLieuDoi (maGoc tag_not_writable), ghim không đổi, không phát", async () => {
    const ma = await maMoi();
    H.sauXacMinh = async () => {
      await sql`UPDATE device_tags SET writable = false WHERE id = ${ids.tGhim}`;
    };
    const e = await loiCua(devA.tags.setStopPin({ adapterId: ids.ad, tagKey: "ghim", stopValue: 0, reason: "du lieu doi dk4", totpCode: ma }));
    expect(e).toEqual({
      code: "CONFLICT",
      appCode: "OPERATION_FAILED",
      appParams: { operation: "scadaConfigTotp", reason: "scadaTotpDaDungDuLieuDoi", maGoc: "tag_not_writable" },
    });
    expect(await ghimCua(ids.tGhim)).toBeNull();
    expect(phatGhim).toEqual([]);
    expect(H.soLanXacMinh).toBe(1);
  });
});
